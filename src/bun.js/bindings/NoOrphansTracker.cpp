// macOS-only descendant tracker for `bun run --no-orphans`.
//
// Problem: a script that `setsid()`s and double-forks produces a grandchild
// that has left our process group AND reparented to launchd, so neither
// `kill(-pgid)` nor a libproc child walk can reach it. macOS has no
// PR_SET_CHILD_SUBREAPER.
//
// Solution: xnu records each process's *spawning* parent's per-boot unique id
// in `p_puniqueid`, set inside `pinsertchild()` (kern_proc.c) at
// fork/vfork/posix_spawn time and **never updated by `proc_reparentlocked`**
// (kern_exit.c). Exposed via the private-but-ABI-stable
// `proc_pidinfo(PROC_PIDUNIQIDENTIFIERINFO)`. So the immutable spawn graph is
// reconstructible from `proc_listallpids()` even after reparenting and
// session/pgroup changes.
//
// We grow a transitive closure `seen = {self.uniqueid}`: on every NOTE_FORK
// (which the kernel posts for fork/vfork/posix_spawn alike — kern_fork.c:603,
// kern_exec.c:4897), do a fixed-point pass over all pids adding any whose
// `p_puniqueid ∈ seen`. Dead intermediates' uniqueids stay in `seen`, so a
// daemon's chain stays intact as long as we observed each link once.
//
// At kill time, identity is verified by `p_uniqueid` (never recycled per
// boot), which is strictly safer than the ppid recheck used elsewhere.
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

    // Called once per spawnSync, after the kqueue is created and the script
    // has been spawned. Seeds `seen` with our own uniqueid (so the script —
    // and anything we ourselves spawned — chains) and stashes kq for later
    // NOTE_FORK|NOTE_EXIT registrations on newly discovered descendants.
    void begin(int kq)
    {
        m_seen.clear();
        m_tracked.clear();
        m_kq = kq;
        ProcUniqIdentifierInfo self;
        if (ProcUniqIdentifierInfo::read(getpid(), self))
            m_seen.add(self.p_uniqueid);
    }

    // Fixed-point scan: enumerate all pids, pull anyone whose p_puniqueid is
    // already in `seen` into the tracked set (and into `seen` so the next
    // pass finds *their* children). Loops until a pass adds nothing — so a
    // fork chain of any depth that completed before we ran is still captured,
    // as long as every link is either still alive or was recorded by an
    // earlier scan. Called on every NOTE_FORK plus once at cleanup.
    void scan()
    {
        if (m_seen.isEmpty()) return;

        int cap = proc_listallpids(nullptr, 0);
        if (cap <= 0) return;
        // Headroom for pids born between the size probe and the real call.
        // grow() asserts on shrink, so only grow.
        if (m_pidbuf.size() < static_cast<size_t>(cap) + 64)
            m_pidbuf.grow(static_cast<size_t>(cap) + 64);

        bool grew;
        do {
            grew = false;
            int n = proc_listallpids(m_pidbuf.mutableSpan().data(),
                static_cast<int>(m_pidbuf.size() * sizeof(pid_t)));
            if (n <= 0) return;

            for (int i = 0; i < n; ++i) {
                pid_t pid = m_pidbuf[static_cast<size_t>(i)];
                if (pid <= 1 || pid == getpid()) continue;

                ProcUniqIdentifierInfo u;
                if (!ProcUniqIdentifierInfo::read(pid, u)) continue;
                if (!m_seen.contains(u.p_puniqueid)) continue;
                if (m_seen.contains(u.p_uniqueid)) continue; // already tracked

                m_seen.add(u.p_uniqueid);
                m_tracked.append({ pid, u.p_uniqueid });
                grew = true;

                // Register NOTE_FORK|NOTE_EXIT on the new pid so its forks
                // wake us too. Best-effort — ESRCH (died already) just means
                // this link won't trigger future scans; its ancestor's
                // NOTE_FORK still will.
                if (m_kq >= 0) {
                    struct kevent ch = {
                        .ident = static_cast<uintptr_t>(pid),
                        .filter = EVFILT_PROC,
                        .flags = EV_ADD | EV_CLEAR,
                        .fflags = NOTE_FORK | NOTE_EXIT,
                        .data = 0,
                        .udata = nullptr,
                    };
                    struct timespec zero = { 0, 0 };
                    kevent(m_kq, &ch, 1, nullptr, 0, &zero);
                }
            }
        } while (grew);
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

    // SIGKILL every tracked descendant. SIGSTOP first, then verify the
    // p_uniqueid still matches what we recorded (proves it's the same
    // process — uniqueids never recycle, unlike pids). Mismatch ⇒ pid was
    // reused between scan and STOP; SIGCONT and skip.
    void killTracked()
    {
        // One last sweep to pick up anything spawned since the last NOTE_FORK.
        scan();

        // Freeze first so nothing in the set can fork while we iterate.
        for (auto& t : m_tracked)
            kill(t.pid, SIGSTOP);

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

    struct Tracked {
        pid_t pid;
        uint64_t uniqueid;
    };

    // Closure of uniqueids ever observed in our subtree. Never shrinks — dead
    // intermediates must stay so their grandchildren still chain.
    WTF::HashSet<uint64_t> m_seen;
    // Live (pid, uniqueid) pairs we'll SIGKILL at cleanup. Pruned on NOTE_EXIT.
    WTF::Vector<Tracked> m_tracked;
    WTF::Vector<pid_t> m_pidbuf;
    int m_kq = -1; // borrowed; owned by Zig's waitForChildNoOrphans
};

} // namespace Bun

extern "C" void Bun__noOrphans_begin(int kq) { Bun::NoOrphansTracker::get().begin(kq); }
extern "C" void Bun__noOrphans_scan() { Bun::NoOrphansTracker::get().scan(); }
extern "C" void Bun__noOrphans_onExit(pid_t pid) { Bun::NoOrphansTracker::get().onExit(pid); }
extern "C" void Bun__noOrphans_killTracked() { Bun::NoOrphansTracker::get().killTracked(); }

#else // !OS(DARWIN)

extern "C" void Bun__noOrphans_begin(int) {}
extern "C" void Bun__noOrphans_scan() {}
extern "C" void Bun__noOrphans_onExit(int) {}
extern "C" void Bun__noOrphans_killTracked() {}

#endif
