// macOS-only descendant tracker for `bun run --no-orphans`.
//
// Problem: a script that `setsid()`s and double-forks produces a grandchild
// that has left our process group AND reparented to launchd, so neither
// `kill(-pgid)` nor a libproc child walk can reach it. macOS has no
// PR_SET_CHILD_SUBREAPER.
//
// Solution: `EVFILT_PROC` + `NOTE_TRACK`. xnu auto-registers the same
// `NOTE_TRACK|NOTE_EXIT` knote on every child *inside `fork1()`* before the
// child is schedulable, recursively (kern_fork.c:592 → `kqueue_kern_proc`
// `KNOTE_TRACK`). Each new pid produces a `NOTE_CHILD` event (`data` = parent
// pid). Non-SETEXEC `posix_spawn` goes through `fork1()`, so arming
// `NOTE_TRACK` on `getpid()` *before* `posix_spawn` means the script's knote
// is created atomically with the script — zero seed window. We `EV_DELETE`
// the self-knote right after spawn so unrelated bun-side forks aren't
// tracked; the descendant knotes are independent and survive.
//
// We record `(pid, p_uniqueid)` for every `NOTE_CHILD`. At kill time identity
// is verified by `p_uniqueid` (per-boot monotone, never recycled — exposed via
// the private-but-ABI-stable `proc_pidinfo(PROC_PIDUNIQIDENTIFIERINFO)`),
// which is strictly safer than the ppid recheck used elsewhere.
//
// `NOTE_TRACKERR` fires on the parent's event if xnu couldn't allocate the
// child's knote (kern_fork.c:601, ENOMEM). We fall back to a single
// proc_listallpids fixed-point sweep over `m_seen` (the immutable
// `p_puniqueid` spawn graph) and manually re-arm `NOTE_TRACK` on anything
// found so its subtree rejoins the auto-tracked set. Best-effort; cold path.
//
// All state is process-global; spawnSync is single-threaded by design (see
// Bun__currentSyncPID), so no locking.

#include "root.h"

#if OS(DARWIN)

#include <libproc.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/event.h>
#include <unistd.h>
#include <wtf/HashSet.h>
#include <wtf/Vector.h>

namespace Bun {

// Private flavor + struct from xnu bsd/sys/proc_info_private.h. The header
// `_Static_assert`s sizeof == 56, so the layout is ABI.
struct ProcUniqIdentifierInfo {
    static constexpr int flavor = 17; // PROC_PIDUNIQIDENTIFIERINFO
    uint8_t p_uuid[16];
    uint64_t p_uniqueid; // per-boot monotone counter, never recycled
    uint64_t p_puniqueid; // spawning parent's p_uniqueid; immutable
    int32_t p_idversion;
    int32_t p_orig_ppidversion;
    uint64_t p_reserve2;
    uint64_t p_reserve3;

    static bool read(pid_t pid, ProcUniqIdentifierInfo& out)
    {
        return proc_pidinfo(pid, flavor, 0, &out, sizeof out) == (int)sizeof out;
    }
};
static_assert(sizeof(ProcUniqIdentifierInfo) == 56, "xnu ABI");

class NoOrphansTracker {
public:
    // Function-local static: lazy first-use construction, no global ctor,
    // thread-safe per C++11 [stmt.dcl]. spawnSync is single-threaded anyway
    // (see Bun__currentSyncPID), but this keeps the binary's static-init
    // section clean.
    static NoOrphansTracker& get()
    {
        static NoOrphansTracker instance;
        return instance;
    }

    // Called once per spawnSync, after the kqueue's self-NOTE_TRACK is armed
    // and the script has been spawned. Seeds with the *script's* uniqueid (not
    // the current process's — we don't want to track or kill unrelated
    // siblings) and stashes kq for the killTracked() drain and any TRACKERR
    // fallback re-arms. The script's knote was kernel-created inside fork1().
    void begin(int kq, pid_t root)
    {
        m_seen.clear();
        m_tracked.clear();
        m_kq = kq;
        ProcUniqIdentifierInfo r;
        if (ProcUniqIdentifierInfo::read(root, r)) {
            m_seen.add(r.p_uniqueid);
            m_tracked.append({ root, r.p_uniqueid });
        }
    }

    // Detach from the borrowed kqueue before its owner closes it, so the
    // drain in killTracked() / re-arm in fallbackScan() don't kevent() on a
    // closed (or worse, reused) fd.
    void releaseKq() { m_kq = -1; }

    // NOTE_CHILD: kernel auto-attached NOTE_TRACK to `pid` inside fork1();
    // record its uniqueid for kill-time identity verification. ESRCH (already
    // gone) is fine — its own children's knotes were attached in-kernel, so
    // the chain continues; we just won't have this link's uid in m_seen,
    // which only matters for the TRACKERR fallback.
    void onChild(pid_t pid)
    {
        ProcUniqIdentifierInfo u;
        if (!ProcUniqIdentifierInfo::read(pid, u)) return;
        // m_tracked may already have it via a TRACKERR fallback that ran
        // before this NOTE_CHILD drained — m_seen dedups.
        if (!m_seen.add(u.p_uniqueid).isNewEntry) return;
        m_tracked.append({ pid, u.p_uniqueid });
    }

    // A tracked pid sent NOTE_EXIT. Drop it from the live list so we don't
    // try to signal a recycled pid later. Its uniqueid stays in `seen`.
    void onExit(pid_t pid)
    {
        for (size_t i = 0; i < m_tracked.size(); ++i) {
            if (m_tracked[i].pid == pid) {
                m_tracked.removeAt(i);
                return;
            }
        }
    }

    // NOTE_TRACKERR on `pid`: xnu couldn't allocate its child's knote
    // (ENOMEM). The child — and its whole subtree — are now untracked. Do a
    // bounded p_puniqueid fixed-point sweep over m_seen and manually re-arm
    // NOTE_TRACK on anything found so it rejoins the auto-tracked set.
    // Best-effort under memory pressure; cold path.
    void onTrackErr(pid_t)
    {
        fallbackScan();
    }

    // SIGKILL every tracked descendant. Freeze, drain the kq for any
    // NOTE_CHILD that raced the SIGSTOPs, freeze the new ones, repeat until
    // closed. Then verify each p_uniqueid still matches what we recorded
    // (uniqueids never recycle, unlike pids) — mismatch ⇒ pid was reused
    // between record and STOP; SIGCONT and skip.
    void killTracked()
    {
        size_t frozen = 0;
        do {
            for (; frozen < m_tracked.size(); ++frozen)
                kill(m_tracked[frozen].pid, SIGSTOP);
            // Drain any NOTE_CHILD that landed between the last drain and the
            // SIGSTOPs we just sent. Once a drain adds nothing, every tracked
            // pid is stopped and cannot fork — set is closed.
            if (m_kq < 0) break;
            struct kevent ev[32];
            struct timespec zero { 0, 0 };
            int n;
            while ((n = kevent(m_kq, nullptr, 0, ev, 32, &zero)) > 0)
                for (int i = 0; i < n; ++i)
                    if (ev[i].filter == EVFILT_PROC && (ev[i].fflags & NOTE_CHILD))
                        onChild((pid_t)ev[i].ident);
        } while (frozen < m_tracked.size());

        for (auto& t : m_tracked) {
            ProcUniqIdentifierInfo u;
            if (ProcUniqIdentifierInfo::read(t.pid, u) && u.p_uniqueid == t.uniqueid)
                kill(t.pid, SIGKILL);
            else // Recycled or already gone — if STOP hit a stranger, undo it.
                kill(t.pid, SIGCONT);
        }

        m_tracked.clear();
        m_seen.clear();
        m_kq = -1;
    }

private:
    NoOrphansTracker() = default;

    // p_puniqueid fixed-point sweep over the live process table — only used
    // on NOTE_TRACKERR (kernel ENOMEM). For any pid discovered, manually
    // EV_ADD NOTE_TRACK|NOTE_EXIT (udata 0) so its subtree rejoins the
    // auto-tracked set. Local pid buffer; this is a cold path.
    void fallbackScan()
    {
        if (m_seen.isEmpty()) return;

        int cap = proc_listallpids(nullptr, 0);
        if (cap <= 0) return;
        WTF::Vector<pid_t> pids;
        pids.grow(static_cast<size_t>(cap) + 64);

        bool grew;
        do {
            grew = false;
            int n = proc_listallpids(pids.mutableSpan().data(),
                static_cast<int>(pids.size() * sizeof(pid_t)));
            if (n <= 0) return;

            for (int i = 0; i < n; ++i) {
                pid_t pid = pids[static_cast<size_t>(i)];
                if (pid <= 1 || pid == getpid()) continue;

                ProcUniqIdentifierInfo u;
                if (!ProcUniqIdentifierInfo::read(pid, u)) continue;
                if (!m_seen.contains(u.p_puniqueid)) continue;
                if (!m_seen.add(u.p_uniqueid).isNewEntry) continue;

                m_tracked.append({ pid, u.p_uniqueid });
                grew = true;

                // Re-arm NOTE_TRACK so this pid's future forks rejoin the
                // kernel-tracked set. Best-effort — ESRCH (died already) is
                // fine, ENOMEM means we'll see another TRACKERR later.
                if (m_kq >= 0) {
                    struct kevent ch = {
                        .ident = static_cast<uintptr_t>(pid),
                        .filter = EVFILT_PROC,
                        .flags = EV_ADD | EV_CLEAR,
                        .fflags = NOTE_TRACK | NOTE_EXIT,
                        .data = 0,
                        .udata = nullptr,
                    };
                    struct timespec zero = { 0, 0 };
                    kevent(m_kq, &ch, 1, nullptr, 0, &zero);
                }
            }
        } while (grew);
    }

    struct Tracked {
        pid_t pid;
        uint64_t uniqueid;
    };

    // Uniqueids ever observed in our subtree. Never shrinks — dead
    // intermediates must stay so the TRACKERR fallback can chain through.
    WTF::HashSet<uint64_t> m_seen;
    // Live (pid, uniqueid) pairs we'll SIGKILL at cleanup. Pruned on NOTE_EXIT.
    WTF::Vector<Tracked> m_tracked;
    int m_kq = -1; // borrowed; owned by Zig's spawnPosix
};

} // namespace Bun

extern "C" void Bun__noOrphans_begin(int kq, pid_t root) { Bun::NoOrphansTracker::get().begin(kq, root); }
extern "C" void Bun__noOrphans_releaseKq() { Bun::NoOrphansTracker::get().releaseKq(); }
extern "C" void Bun__noOrphans_onChild(pid_t pid) { Bun::NoOrphansTracker::get().onChild(pid); }
extern "C" void Bun__noOrphans_onExit(pid_t pid) { Bun::NoOrphansTracker::get().onExit(pid); }
extern "C" void Bun__noOrphans_onTrackErr(pid_t pid) { Bun::NoOrphansTracker::get().onTrackErr(pid); }
extern "C" void Bun__noOrphans_killTracked() { Bun::NoOrphansTracker::get().killTracked(); }

#else // !OS(DARWIN)

extern "C" void Bun__noOrphans_begin(int, int) {}
extern "C" void Bun__noOrphans_releaseKq() {}
extern "C" void Bun__noOrphans_onChild(int) {}
extern "C" void Bun__noOrphans_onExit(int) {}
extern "C" void Bun__noOrphans_onTrackErr(int) {}
extern "C" void Bun__noOrphans_killTracked() {}

#endif
