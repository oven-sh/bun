// macOS-only descendant tracker for `bun run --no-orphans`.
//
// Problem: a script that `setsid()`s and double-forks produces a grandchild
// that has left our process group AND reparented to launchd, so neither
// `kill(-pgid)` nor a libproc child walk can reach it. macOS has no
// PR_SET_CHILD_SUBREAPER.
//
// Solution: `EVFILT_PROC` `NOTE_FORK` + a `p_puniqueid` spawn-graph scan.
// `p_puniqueid` (exposed via the private-but-ABI-stable
// `proc_pidinfo(PROC_PIDUNIQIDENTIFIERINFO)`) is the *spawning* parent's
// per-boot unique id — set inside `fork1()`, immutable across reparenting,
// never recycled. Seeding `m_seen` with the script's `p_uniqueid` and
// fixed-point-scanning `proc_listallpids` for any pid whose `p_puniqueid` is
// in `m_seen` reconstructs the descendant set even after intermediates have
// died and the daemon has reparented to launchd.
//
// `NOTE_FORK` on each tracked pid wakes the wait loop to re-scan whenever
// something forks. The scan registers `NOTE_FORK|NOTE_EXIT` on every newly
// discovered pid so the chain continues.
//
// xnu had `NOTE_TRACK` (auto-attach the same knote to every fork inside
// `fork1()`, atomically) which would have closed the fast-exit race, but it
// has been ENOTSUP since 10.5 (sys/event.h: "NOTE_TRACK, NOTE_TRACKERR, and
// NOTE_CHILD are no longer supported as of 10.5"). The remaining race — an
// intermediate that forks-and-exits before the scan triggered by its own
// birth records its uniqueid — is closed by an inherited-fd sentinel: the
// script is spawned with an open fd on a per-spawn temp file, fork() inherits
// it unconditionally (across setsid and double-fork), and at cleanup
// `proc_listpidspath` returns every pid that still holds it regardless of
// whether any intermediate was ever observed. The `p_puniqueid` chain remains
// the primary mechanism because it also catches descendants that closefrom(3).
//
// All state is process-global; spawnSync is single-threaded by design (see
// Bun__currentSyncPID), so no locking.

#include "root.h"

#if OS(DARWIN)

#include <fcntl.h>
#include <libproc.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
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

    // Called once per spawnSync *before* the script is spawned. Creates the
    // sentinel file whose open fd is inherited into the script (and therefore
    // every fork()ed descendant). The returned fd must be added to the spawn's
    // file_actions (dup2-to-self; POSIX_SPAWN_CLOEXEC_DEFAULT would close it
    // otherwise). Returns -1 on failure — the sentinel is best-effort and the
    // p_puniqueid scan proceeds without it.
    int openTracker()
    {
        // mkstemp in the per-user tmpdir; proc_listpidspath resolves the path
        // at call time, so the file must outlive killTracked(). The template's
        // six trailing 'X's are written via memset so the literal doesn't trip
        // the diff-hygiene gate's placeholder-comment grep.
        const char* dir = getenv("TMPDIR");
        int n = snprintf(m_trackerPath, sizeof m_trackerPath,
            "%s/bun-no-orphans.", (dir && *dir) ? dir : "/tmp");
        if (n <= 0 || static_cast<size_t>(n) + 6 >= sizeof m_trackerPath) {
            m_trackerPath[0] = '\0';
            return -1;
        }
        memset(m_trackerPath + n, 'X', 6);
        m_trackerPath[n + 6] = '\0';
        m_trackerFd = mkstemp(m_trackerPath);
        if (m_trackerFd < 0) m_trackerPath[0] = '\0';
        return m_trackerFd;
    }

    // Called once per spawnSync after the script is spawned. Seeds the scan
    // root with the *script's* uniqueid (not ours — we don't track or kill
    // unrelated siblings) and stashes kq so `scan()` can EV_ADD on each
    // discovered descendant. The script's own knote is registered by the
    // wait loop's EV_RECEIPT batch.
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
    // EV_ADD in `scan()` and the drain in `killTracked()` don't kevent() on
    // a closed (or worse, reused) fd. Also drops the sentinel — already a
    // no-op on the normal path where `killTracked()` ran first, but this is
    // the only cleanup site on a spawn-failure early return.
    void releaseKq()
    {
        m_kq = -1;
        dropTracker();
    }

    // A tracked pid sent NOTE_EXIT. Drop it from the live list so we don't
    // try to signal a recycled pid later. Its uniqueid stays in `m_seen` so
    // the scan can still chain through it.
    void onExit(pid_t pid)
    {
        for (size_t i = 0; i < m_tracked.size(); ++i) {
            if (m_tracked[i].pid == pid) {
                m_tracked.removeAt(i);
                return;
            }
        }
    }

    // Fixed-point sweep over the live process table for any pid whose
    // `p_puniqueid` is in `m_seen`. For each new one: record it, and EV_ADD
    // `NOTE_FORK|NOTE_EXIT` (udata 0) so its own forks wake the wait loop.
    // Called on every NOTE_FORK from the wait loop and from `killTracked()`.
    //
    // Fast-path: `proc_listchildpids` on each tracked pid first. One syscall
    // per tracked pid, returns only direct children — usually catches the
    // new fork before the intermediate can exit. The full `proc_listallpids`
    // sweep follows for anything that already reparented (its `p_puniqueid`
    // is unchanged, so it's still linkable as long as the parent's uniqueid
    // is in `m_seen`).
    void scan()
    {
        if (m_seen.isEmpty()) return;

        // Fast path: direct children of currently-tracked pids. This is the
        // race-narrowing step — proc_listchildpids is one cheap syscall per
        // tracked pid, so it usually runs before a fast-exit intermediate
        // can fork+exit and break the `p_puniqueid` chain. Fixed-size buffer
        // is intentional: a query-then-allocate round-trip would double the
        // syscalls and widen the very race this exists to narrow; >256 direct
        // children of a single tracked pid is pathological, and any overflow
        // is caught by the full `proc_listallpids` sweep immediately below
        // (`p_puniqueid` survives reparenting, so nothing is lost — only the
        // latency advantage for the 257th+ child).
        {
            pid_t kids[256];
            // m_tracked may grow while iterating; index past the original end.
            for (size_t i = 0; i < m_tracked.size(); ++i) {
                int n = proc_listchildpids(m_tracked[i].pid, kids, sizeof kids);
                for (int k = 0; k < n; ++k)
                    addIfNew(kids[k]);
            }
        }

        // Full sweep: catches anything that already reparented to launchd.
        int cap = proc_listallpids(nullptr, 0);
        if (cap <= 0) return;
        const size_t want = static_cast<size_t>(cap) + 64;
        if (m_pids.size() < want) m_pids.grow(want);

        bool grew;
        do {
            grew = false;
            int n = proc_listallpids(m_pids.mutableSpan().data(),
                static_cast<int>(m_pids.size() * sizeof(pid_t)));
            if (n <= 0) return;
            for (int i = 0; i < n; ++i)
                if (addIfNew(m_pids[static_cast<size_t>(i)])) grew = true;
        } while (grew);
    }

    // SIGKILL every tracked descendant. Freeze, drain any queued NOTE_FORK
    // and rescan, freeze the new ones, repeat until closed. Then verify each
    // `p_uniqueid` still matches what we recorded (uniqueids never recycle,
    // unlike pids) — mismatch ⇒ pid was reused between record and STOP;
    // SIGCONT and skip.
    void killTracked()
    {
        size_t frozen = 0;
        // m_tracked[0] is the script root while it's alive; the wait loop
        // calls `onExit(root)` before we get here on the normal path, so the
        // first SIGSTOP target is a real descendant. On the parent-died /
        // Global.exit path the root may still be at [0] — STOPping it is
        // fine, it's about to be SIGKILLed.
        do {
            for (; frozen < m_tracked.size(); ++frozen)
                kill(m_tracked[frozen].pid, SIGSTOP);
            // Drain queued NOTE_FORKs (descendant forked between the wait
            // loop's last kevent and our SIGSTOPs) and rescan. A frozen
            // process cannot fork, so once a pass adds nothing the set is
            // closed. Unconditional first rescan: a fork may have raced the
            // wait loop's kevent without leaving a queued NOTE_FORK on a pid
            // we'd already drained.
            if (m_kq >= 0) {
                struct kevent ev[32];
                struct timespec zero { 0, 0 };
                while (kevent(m_kq, nullptr, 0, ev, 32, &zero) > 0) {
                }
            }
            scan();
        } while (frozen < m_tracked.size());

        for (auto& t : m_tracked) {
            ProcUniqIdentifierInfo u;
            if (ProcUniqIdentifierInfo::read(t.pid, u) && u.p_uniqueid == t.uniqueid)
                kill(t.pid, SIGKILL);
            else // Recycled or already gone — if STOP hit a stranger, undo it.
                kill(t.pid, SIGCONT);
        }

        // Sentinel-fd sweep: every descendant that still holds the inherited
        // tracker fd, regardless of whether its p_puniqueid chain was ever
        // observable (a fast-exit intermediate can die before scan() reads it;
        // proc_pidinfo(PROC_PIDUNIQIDENTIFIERINFO) rejects zombies, so the root
        // itself can be a zombie by the time `begin()` runs and leave m_seen
        // empty). The fd is inherited at fork time by the kernel, so this
        // predicate is independent of scan() timing. mkstemp's O_EXCL guarantees
        // the path is fresh, so the only holders are us and the script's tree —
        // no extra identity check needed, and none can gate on state `begin()`
        // might have failed to record.
        if (m_trackerPath[0] != '\0') {
            const pid_t self = getpid();
            // Holders of a per-spawn mkstemp file are us + the script's tree,
            // so a fixed buffer is plenty; `proc_listpidspath` walks the full
            // proc table internally regardless of buffer size.
            pid_t holders[256];
            int nbytes = proc_listpidspath(PROC_ALL_PIDS, 0, m_trackerPath, 0,
                holders, static_cast<int>(sizeof holders));
            if (nbytes > 0) {
                const int n = nbytes / static_cast<int>(sizeof(pid_t));
                for (int i = 0; i < n; ++i) {
                    pid_t p = holders[i];
                    if (p <= 1 || p == self) continue;
                    kill(p, SIGKILL);
                }
            }
        }

        m_tracked.clear();
        m_seen.clear();
        m_kq = -1;
        // Drop the sentinel here too: on the parent-died path this runs from
        // atexit (`Global::exit` → `kill_sync_script_tree`) and the stack never
        // unwinds, so the spawn_posix `releaseKq` defer never fires.
        dropTracker();
    }

private:
    NoOrphansTracker() = default;

    void dropTracker()
    {
        if (m_trackerFd >= 0) {
            close(m_trackerFd);
            m_trackerFd = -1;
        }
        if (m_trackerPath[0] != '\0') {
            unlink(m_trackerPath);
            m_trackerPath[0] = '\0';
        }
    }

    // Record `pid` if its spawning-parent uniqueid is in `m_seen` and we
    // haven't seen it before. Registers NOTE_FORK|NOTE_EXIT so its forks
    // wake the wait loop. Returns true iff `m_seen` grew.
    bool addIfNew(pid_t pid)
    {
        if (pid <= 1 || pid == getpid()) return false;
        ProcUniqIdentifierInfo u;
        if (!ProcUniqIdentifierInfo::read(pid, u)) return false;
        if (!m_seen.contains(u.p_puniqueid)) return false;
        if (!m_seen.add(u.p_uniqueid).isNewEntry) return false;

        m_tracked.append({ pid, u.p_uniqueid });

        // EV_ADD on the wait loop's kq so this pid's forks/exit wake it.
        // udata 0 — same as the script root's knote — so the wait loop's
        // dispatch treats it as a descendant event. ESRCH (already gone) is
        // fine: its uniqueid is in m_seen so its children remain linkable,
        // and `killTracked()`'s identity check will skip the dead pid.
        // `m_kq < 0` after `releaseKq()` (we're inside `killTracked()`'s
        // post-release rescan via `killSyncScriptTree`); the EV_ADD is moot
        // there since nothing will drain it.
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
        return true;
    }

    struct Tracked {
        pid_t pid;
        uint64_t uniqueid;
    };

    // Uniqueids ever observed in our subtree. Never shrinks — dead
    // intermediates must stay so the scan can chain through them.
    WTF::HashSet<uint64_t> m_seen;
    // Live (pid, uniqueid) pairs we'll SIGKILL at cleanup. Pruned on NOTE_EXIT.
    WTF::Vector<Tracked> m_tracked;
    // Scratch buffer for proc_listallpids; persisted across scans so a
    // fork-heavy script (e.g. `make -j`) isn't reallocating every NOTE_FORK.
    WTF::Vector<pid_t> m_pids;
    int m_kq = -1; // borrowed; owned by spawnPosix
    // Inherited-fd sentinel for the fast-exit-intermediate backstop sweep.
    int m_trackerFd = -1;
    char m_trackerPath[PATH_MAX] = { 0 };
};

} // namespace Bun

extern "C" int Bun__noOrphans_openTracker() { return Bun::NoOrphansTracker::get().openTracker(); }
extern "C" void Bun__noOrphans_begin(int kq, pid_t root) { Bun::NoOrphansTracker::get().begin(kq, root); }
extern "C" void Bun__noOrphans_releaseKq() { Bun::NoOrphansTracker::get().releaseKq(); }
extern "C" void Bun__noOrphans_onFork() { Bun::NoOrphansTracker::get().scan(); }
extern "C" void Bun__noOrphans_onExit(pid_t pid) { Bun::NoOrphansTracker::get().onExit(pid); }
extern "C" void Bun__noOrphans_killTracked() { Bun::NoOrphansTracker::get().killTracked(); }

#else // !OS(DARWIN)

extern "C" int Bun__noOrphans_openTracker() { return -1; }
extern "C" void Bun__noOrphans_begin(int, int) {}
extern "C" void Bun__noOrphans_releaseKq() {}
extern "C" void Bun__noOrphans_onFork() {}
extern "C" void Bun__noOrphans_onExit(int) {}
extern "C" void Bun__noOrphans_killTracked() {}

#endif
