//! Opt-in self-termination when our parent goes away, plus recursive
//! descendant cleanup on exit.
//!
//! Enabled via env var `BUN_FEATURE_FLAG_NO_ORPHANS`, `--no-orphans`, or
//! `bunfig.toml` `[run] noOrphans = true`. When set, Bun:
//!
//!   1. Captures its original parent pid at startup and exits as soon as that
//!      parent is gone — even if the parent was SIGKILLed and never got a
//!      chance to signal us.
//!      - Linux: `prctl(PR_SET_PDEATHSIG, SIGKILL)`. Kernel-delivered, no
//!        polling, no thread. Fires when the *thread* that forked us exits;
//!        for the single-threaded shims this targets that distinction is moot.
//!      - macOS: `EVFILT_PROC`/`NOTE_EXIT` on the original ppid, registered on
//!        the existing event loop's kqueue via `bun.Async.FilePoll` (same
//!        path Bun already uses to watch *child* process exits — see
//!        `bun.spawn.Process.watch`). No dedicated thread, no extra kqueue fd.
//!        Installed lazily from `VirtualMachine.init` so it only arms when the
//!        JS runtime actually starts; commands that never spin up an event
//!        loop are short-lived enough not to need it.
//!
//!   2. On any clean exit (`Global.exit` → `Bun__onExit`), walks the process
//!      tree rooted at `getpid()` and SIGKILLs every descendant so children
//!      Bun spawned don't outlive it.
//!      - macOS: libproc `proc_listchildpids()`.
//!      - Linux: `/proc/<pid>/task/*/children`.
//!
//! Motivation: process supervisors that wrap Bun in a thin shim (e.g. a macOS
//! TCC "disclaimer" trampoline: Electron → shim → bun) can be SIGKILLed by
//! their own parent's timeout/abort logic. SIGKILL is uncatchable, so the shim
//! can't forward it, and Bun is silently reparented to launchd/init where it
//! keeps running forever — along with anything Bun itself spawned. This
//! watchdog closes both gaps from Bun's side without requiring the shim to
//! cooperate.

use core::ffi::c_int;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::{ZStr, env_var};
use bun_sys::{self, Fd, O};

use crate::posix_event_loop::{EventLoopCtx, FilePoll, Owner, poll_tag};

/// Unit struct — `FilePoll.Owner` needs a real pointer, but we have no
/// per-instance state.
pub struct ParentDeathWatchdog;

/// Exit code used when the watchdog fires. 128 + SIGHUP, matching the
/// convention for "terminated because the controlling end went away".
pub const EXIT_CODE: u8 = 128 + 1;

// PORT NOTE: Zig used plain `var` globals (unsynchronized). Converted to
// atomics/OnceLock per docs/PORTING.md §Global mutable state — same
// single-writer-at-startup discipline, but no `static mut` aliasing.
static ENABLED: AtomicBool = AtomicBool::new(false);
static ORIGINAL_PPID: core::sync::atomic::AtomicI32 = core::sync::atomic::AtomicI32::new(0);

/// Whether no-orphans mode was enabled at startup. Read by the spawn path to
/// decide whether to default `linux_pdeathsig` on children.
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// The original parent pid to watch from contexts that have no event loop
/// (`bun run` blocking in `spawnSync`, etc.). Returns null when no-orphans
/// isn't enabled or there is no parent worth watching. Both Linux and macOS
/// use this from `spawnSync` so the pgroup-kill cleanup path runs even though
/// Linux already has a SIGKILL PDEATHSIG backstop.
pub fn ppid_to_watch() -> Option<libc::pid_t> {
    #[cfg(not(unix))]
    {
        return None;
    }
    #[cfg(unix)]
    {
        let ppid = ORIGINAL_PPID.load(Ordering::Relaxed);
        if !ENABLED.load(Ordering::Relaxed) || ppid <= 1 {
            return None;
        }
        Some(ppid)
    }
}

/// `bun run`/`bunx` set this to the script's pgid (= script pid, since we
/// `setpgid(0,0)` in the child) so the exit callback can `kill(-pgid, KILL)`.
/// Process-group membership survives reparenting to launchd/init, so this
/// reaches grandchildren that the libproc/procfs walk would miss once the
/// script itself has exited. Stack-disciplined for nested `spawnSync` (e.g.
/// `pre`/`post` lifecycle scripts) — though in practice depth is 1.
///
/// `[AtomicI32; 4]` instead of `RacyCell<[pid_t; 4]>`: `pid_t` is `i32` on
/// every Unix target, and per-slot atomics let push/read use safe
/// `.store()/.load()` instead of an `unsafe` raw-pointer deref. Ordering stays
/// Relaxed — `SYNC_PGIDS_LEN` is the publish point.
static SYNC_PGIDS_BUF: [core::sync::atomic::AtomicI32; 4] =
    [const { core::sync::atomic::AtomicI32::new(0) }; 4];
static SYNC_PGIDS_LEN: core::sync::atomic::AtomicUsize = core::sync::atomic::AtomicUsize::new(0);

/// Returns true if the push was recorded; caller must pop iff true. Depth >4
/// would lose stack discipline if push were a silent no-op while pop wasn't.
pub fn push_sync_pgid(pgid: libc::pid_t) -> bool {
    #[cfg(not(unix))]
    {
        let _ = pgid;
        return false;
    }
    #[cfg(unix)]
    {
        let len = SYNC_PGIDS_LEN.load(Ordering::Relaxed);
        if len >= 4 {
            return false;
        }
        SYNC_PGIDS_BUF[len].store(pgid, Ordering::Relaxed);
        SYNC_PGIDS_LEN.store(len + 1, Ordering::Relaxed);
        true
    }
}

pub fn pop_sync_pgid() {
    #[cfg(unix)]
    {
        let len = SYNC_PGIDS_LEN.load(Ordering::Relaxed);
        if len > 0 {
            SYNC_PGIDS_LEN.store(len - 1, Ordering::Relaxed);
        }
    }
}

/// SIGKILL every registered script pgroup + the macOS uniqueid-tracked set.
/// Scoped to the `spawnSync` script(s) — does NOT call `kill_descendants()`,
/// which is rooted at `getpid()` and would take out unrelated `Bun.spawn`
/// siblings when `spawnSync` is reached from inside a live VM (e.g.
/// `ffi.zig:getSystemRootDirOnce` shelling out to `xcrun`).
pub fn kill_sync_script_tree() {
    #[cfg(unix)]
    {
        let len = SYNC_PGIDS_LEN.load(Ordering::Relaxed);
        for slot in &SYNC_PGIDS_BUF[..len] {
            let pgid = slot.load(Ordering::Relaxed);
            if pgid > 1 {
                let _ = kill(-pgid, libc::SIGKILL);
            }
        }
        #[cfg(target_os = "macos")]
        Bun__noOrphans_killTracked();
        // Linux: subreaper-adopted setsid escapees are killed by
        // `kill_subreaper_adoptees()` in `spawnPosix`'s disarm defer (which can
        // tell them apart from `Bun.spawn` siblings via the pre-arm snapshot).
    }
}

/// Full-process teardown: pgroups + tracked + getpid()-rooted tree.
/// Only safe to call when the whole Bun process is exiting.
fn kill_sync_pgroups_and_descendants() {
    #[cfg(unix)]
    {
        kill_sync_script_tree();
        kill_descendants();
    }
}

// TODO(port): move to <aio>_sys
unsafe extern "C" {
    // safe: no args; no preconditions.
    safe fn Bun__noOrphans_killTracked();
}

#[cfg(unix)]
unsafe extern "C" {
    // safe: no args; read process IDs — no preconditions, never fail.
    safe fn getpid() -> libc::pid_t;
    safe fn getppid() -> libc::pid_t;
    // safe: by-value `pid_t`/`c_int` only; bad pid → `ESRCH`, bad sig →
    // `EINVAL`, never UB. Async-signal-safe.
    safe fn kill(pid: libc::pid_t, sig: c_int) -> c_int;
    // safe: out-param is `&mut c_int` (non-null, valid for write); kernel only
    // writes the slot and reports failure via the return value — bad pid →
    // `ECHILD`, never UB. Async-signal-safe.
    safe fn waitpid(pid: libc::pid_t, status: &mut c_int, options: c_int) -> libc::pid_t;
}

// `should_default_spawn_pdeathsig` moved down to `bun_spawn_sys::pdeathsig::
// should_default()` (lowest tier that reads it). The thread-scoping rationale
// — `PR_SET_PDEATHSIG` fires on the *thread*'s exit, so defaulting it from a
// JS Worker would kill children on `worker.terminate()` — is documented there.

static EVENT_LOOP_INSTALLED: AtomicBool = AtomicBool::new(false);
/// Singleton instance — `FilePoll.Owner` needs a real pointer, but we have no
/// per-instance state.
static INSTANCE: bun_core::RacyCell<ParentDeathWatchdog> =
    bun_core::RacyCell::new(ParentDeathWatchdog);

/// Called from `main()` before the CLI starts. Checks the env var and enables
/// the watchdog as early as possible so the Linux `prctl` window is minimal.
/// `bunfig.toml`'s `[run] noOrphans` and the `--no-orphans` flag call
/// `enable()` directly later in startup if the env var wasn't set.
///
/// `#[inline]`: this is on the unconditional startup path and is just an
/// env-var flag check that almost always early-returns. Folding it into
/// `main()` avoids a cross-crate call frame on every process start; the
/// rare-taken arm body lives in `#[cold] enable()`.
#[inline]
pub fn install() {
    #[cfg(unix)]
    {
        if !env_var::BUN_FEATURE_FLAG_NO_ORPHANS.get().unwrap_or(false) {
            return;
        }
        enable();
    }
}

/// Idempotent. Arms the watchdog: Linux `prctl(PR_SET_PDEATHSIG)`, exit-time
/// descendant reaper, and (lazily) the macOS kqueue parent watch. Safe to call
/// from `main()` (env-var path) and again from bunfig / CLI flag parsing.
///
/// `#[cold] #[inline(never)]`: only reached when no-orphans is opted into;
/// keeps the prctl/setenv/getppid body out of the inlined `install()` fast
/// path so `main()` stays small.
#[cold]
#[inline(never)]
pub fn enable() {
    #[cfg(unix)]
    // SAFETY: called only on the main thread during startup, before any
    // concurrent reader exists; idempotent guard prevents double-init.
    unsafe {
        if ENABLED.swap(true, Ordering::Relaxed) {
            return;
        }
        // Let `bun_spawn_sys::spawn_process_posix` default `linux_pdeathsig`
        // for children spawned from this thread. Storage lives in spawn_sys
        // (lowest tier that reads it); we just flip the flag.
        bun_spawn_sys::pdeathsig::set_default(true);
        // Export the env var so any Bun child we spawn (e.g. `bun run` → script →
        // nested bun) inherits no-orphans mode without the parent having to thread
        // the flag through. No-op if we got here via the env var.
        let _ = libc::setenv(c"BUN_FEATURE_FLAG_NO_ORPHANS".as_ptr(), c"1".as_ptr(), 1);

        // PR_SET_CHILD_SUBREAPER is NOT armed here — it's process-wide and would
        // make every orphaned grandchild reparent to us, but only the spawnSync
        // wait loop has a `wait4(-1, WNOHANG)` to reap them. `bun foo.js` /
        // `--filter` / `bun test` would accumulate zombies. Subreaper is armed
        // per-script in `spawnPosix` (just before the spawn) and cleared on return.
        // Descendant cleanup runs on every clean exit regardless of whether we end
        // up watching a parent (Bun may have been spawned directly by launchd/init).
        bun_core::add_exit_callback(on_process_exit);

        let ppid = libc::getppid();
        ORIGINAL_PPID.store(ppid, Ordering::Relaxed);
        // Already orphaned (parent died before we got here, or launchd/init
        // spawned us directly) — nothing to watch.
        if ppid <= 1 {
            return;
        }

        #[cfg(target_os = "linux")]
        {
            // PR_SET_PDEATHSIG: kernel sends SIGKILL when the thread that forked
            // us exits. Persists across exec; cleared on fork (Bun's own children
            // do not inherit it). SIGKILL is uncatchable so user code can't
            // swallow it. The macOS path goes through Global.exit instead and so
            // also runs the descendant reaper; on Linux the SIGKILL case relies on
            // env-var inheritance — Bun-spawning-Bun chains self-reap because each
            // link sets its own PDEATHSIG.
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as libc::c_ulong) != 0 {
                return;
            }
            // Race: parent may have died between getppid() above and prctl()
            // taking effect. If so we've already been reparented and the kernel
            // will never deliver the signal — exit now.
            if libc::getppid() != ppid {
                kill_descendants();
                libc::_exit(EXIT_CODE as c_int);
            }
        }
        // macOS: parent watch installs lazily via install_on_event_loop() once the
        // event loop's kqueue exists.
    }
}

/// Register `EVFILT_PROC`/`NOTE_EXIT` for the original parent on the main
/// event loop's kqueue. Called from `VirtualMachine.init` once the uws loop is
/// up. macOS-only; no-op elsewhere and on subsequent calls.
pub fn install_on_event_loop(handle: EventLoopCtx) {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = handle;
    }
    #[cfg(target_os = "macos")]
    {
        let (enabled, original_ppid) = (
            ENABLED.load(Ordering::Relaxed),
            ORIGINAL_PPID.load(Ordering::Relaxed),
        );
        if !enabled || original_ppid <= 1 {
            return;
        }
        if EVENT_LOOP_INSTALLED.swap(true, Ordering::Relaxed) {
            return;
        }

        // Race: parent may have died between install() and now (before the event
        // loop existed). We've been reparented; kqueue would ESRCH — exit now.
        if getppid() != original_ppid {
            bun_core::exit(EXIT_CODE as u32);
        }

        // INSTANCE is a 'static ZST singleton; `RacyCell::get()` yields a stable `*mut`.
        let instance_ptr: *mut ParentDeathWatchdog = INSTANCE.get();
        let poll = FilePoll::init(
            handle,
            Fd::from_native(original_ppid),
            Default::default(),
            Owner::new(poll_tag::PARENT_DEATH_WATCHDOG, instance_ptr.cast()),
        );
        // SAFETY: `poll` was just allocated by `FilePoll::init`; sole `&mut`
        // borrow; `register` does not re-derive the loop.
        match unsafe { &mut *poll }.register(
            handle.loop_mut(),
            crate::file_poll::Pollable::Process,
            true,
        ) {
            bun_sys::Result::Ok(()) => {
                // Do not keep the event loop alive on this poll's behalf — the
                // watchdog must never prevent Bun from exiting when there is no
                // other work. `register()` only bumps the *active* count when
                // `.keeps_event_loop_alive` was set beforehand, which we didn't.
            }
            Err(err) => {
                // ESRCH: parent already gone before we registered — treat as fired.
                if err.get_errno() == bun_sys::E::ESRCH {
                    bun_core::exit(EXIT_CODE as u32);
                }
                // Any other registration error: best-effort feature, just don't watch.
            }
        }
    }
}

/// `FilePoll.Owner` dispatch target — see the `ParentDeathWatchdog` arm in
/// `posix_event_loop.zig`'s `onUpdate`. The kqueue `NOTE_EXIT` for our parent
/// fired.
pub fn on_parent_exit(_this: &mut ParentDeathWatchdog) {
    // Global.exit → Bun__onExit → on_process_exit → kill_descendants.
    bun_core::exit(EXIT_CODE as u32);
}

/// Registered with `Global.addExitCallback` so it runs from `Bun__onExit`
/// (atexit on macOS, at_quick_exit on Linux, and the explicit `Global.exit`
/// path). C calling convention because that's the exit-callback ABI.
extern "C" fn on_process_exit() {
    kill_sync_pgroups_and_descendants();
}

/// Walk the process tree rooted at `getpid()` and SIGKILL every descendant.
///
/// Pid-reuse safety: enumeration is a point-in-time snapshot, so a pid we
/// collect could exit and be recycled by an unrelated process before we
/// signal it. To avoid killing an innocent process we use a
/// stop-verify-kill pattern:
///   1. Enumerate children of `parent`.
///   2. For each child `c`: SIGSTOP it, then re-read `c`'s ppid. If it's no
///      longer `parent`, the pid was recycled in the (microsecond) window
///      between enumerate and STOP — undo with SIGCONT and skip. Otherwise
///      `c` is now frozen and confirmed ours; recurse into it.
///   3. Once the whole tree is frozen, SIGKILL each pid (leaves-first).
///      SIGKILL terminates stopped processes directly — no SIGCONT needed —
///      and unlike SIGTERM can't be trapped or ignored.
/// A frozen process can neither exit (so its pid can't be reused) nor fork
/// (so its child set is stable while we recurse), which is what makes the
/// verify step sufficient. The only forking process is `self`, and we're in
/// the exit handler — not forking.
pub fn kill_descendants() {
    #[cfg(unix)]
    {
        let self_pid = getpid();

        let mut to_visit: Vec<libc::pid_t> = Vec::new();
        let mut to_kill: Vec<libc::pid_t> = Vec::new();

        to_visit.push(self_pid);

        let mut buf: [libc::pid_t; 4096] = [0; 4096];
        // Hard cap on tree size so a fork bomb under us can't make exit hang.
        while !to_visit.is_empty() && to_kill.len() < 4096 {
            let parent = to_visit.swap_remove(to_visit.len() - 1);
            let Some(n) = list_child_pids(parent, &mut buf) else {
                continue;
            };
            for &child in &buf[..n] {
                if child == self_pid || child <= 1 {
                    continue;
                }
                // Freeze first, then confirm it's still the process we enumerated.
                if kill(child, libc::SIGSTOP) != 0 {
                    continue;
                }
                if parent_pid_of(child) != parent {
                    // Recycled between enumerate and STOP — undo and skip.
                    let _ = kill(child, libc::SIGCONT);
                    continue;
                }
                if to_kill.try_reserve(1).is_err() {
                    // OOM after we've already STOPped+verified this child — kill it
                    // now rather than leaving it frozen and absent from to_kill.
                    let _ = kill(child, libc::SIGKILL);
                    break;
                }
                to_kill.push(child);
                if to_visit.try_reserve(1).is_err() {
                    break;
                }
                to_visit.push(child);
            }
        }

        // Reverse: leaves first. SIGKILL terminates stopped processes directly.
        let mut i = to_kill.len();
        while i > 0 {
            i -= 1;
            let _ = kill(to_kill[i], libc::SIGKILL);
        }
    }
}

/// Linux-only: enumerate our direct children into `out`. Used by `spawnPosix`
/// to snapshot pre-existing siblings before arming subreaper, so the post-wait
/// `kill_subreaper_adoptees` can tell adopted orphans apart from `Bun.spawn`
/// siblings (both have ppid==us). Returns the slice written; empty on
/// non-Linux or enumeration failure.
pub fn snapshot_children(out: &mut [libc::pid_t]) -> &[libc::pid_t] {
    #[cfg(not(target_os = "linux"))]
    {
        return &out[..0];
    }
    #[cfg(target_os = "linux")]
    {
        let self_pid = getpid();
        let n = list_child_pids(self_pid, out).unwrap_or(0);
        &out[..n]
    }
}

/// Linux-only: SIGKILL every direct child of ours that isn't in `siblings`,
/// plus its entire subtree. Called from `spawnPosix`'s defer *before*
/// disarming subreaper, so subreaper-adopted setsid daemons (ppid==us) are
/// killed while we can still find them — closing the window where the
/// daemon's intermediate parent exits between disarm and `on_process_exit` →
/// `kill_descendants()` and the daemon escapes to init.
///
/// `siblings` is the pre-arm `snapshot_children()` set; anything not in it was
/// either the script (already reaped) or adopted via subreaper during this
/// spawnSync. A `Bun.spawn` from a Worker thread *during* spawnSync would
/// also land here and be killed — `--no-orphans` is opt-in aggressive cleanup
/// and would kill it at process-exit via `kill_descendants()` anyway.
pub fn kill_subreaper_adoptees(siblings: &[libc::pid_t]) {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = siblings;
    }
    #[cfg(target_os = "linux")]
    {
        let self_pid = getpid();
        let mut buf: [libc::pid_t; 4096] = [0; 4096];

        // Iterate: kill non-sibling direct children's subtrees, reap, re-read.
        // After we kill an adoptee's subtree, anything that raced (forked between
        // enumerate and STOP) reparents to us and shows up next pass. Bounded by
        // tree depth; 64 is far past any sane chain.
        let mut rounds: u8 = 64;
        while rounds > 0 {
            let Some(n) = list_child_pids(self_pid, &mut buf) else {
                return;
            };
            let mut killed_any = false;
            for &child in &buf[..n] {
                if child <= 1 || child == self_pid {
                    continue;
                }
                if siblings.contains(&child) {
                    continue;
                }
                kill_tree_rooted_at(child, self_pid);
                killed_any = true;
            }
            // Reap what we just killed so their children (if any raced) reparent.
            loop {
                let mut st: c_int = 0;
                if waitpid(-1, &mut st, libc::WNOHANG) <= 0 {
                    break;
                }
            }
            if !killed_any {
                return;
            }
            rounds -= 1;
        }
    }
}

/// Freeze-walk-kill the subtree rooted at `root` (inclusive). Same SIGSTOP +
/// ppid-verify + leaves-first-SIGKILL discipline as `kill_descendants()`, just
/// not rooted at ourselves. `expected_ppid_of_root` lets the caller verify
/// `root` itself before recursing (ppid==us for subreaper adoptees).
#[cfg(unix)]
fn kill_tree_rooted_at(root: libc::pid_t, expected_ppid_of_root: libc::pid_t) {
    let mut to_visit: Vec<libc::pid_t> = Vec::new();
    let mut to_kill: Vec<libc::pid_t> = Vec::new();

    if kill(root, libc::SIGSTOP) != 0 {
        return;
    }
    if parent_pid_of(root) != expected_ppid_of_root {
        let _ = kill(root, libc::SIGCONT);
        return;
    }
    if to_kill.try_reserve(1).is_err() {
        let _ = kill(root, libc::SIGKILL);
        return;
    }
    to_kill.push(root);
    let _ = to_visit.try_reserve(1);
    to_visit.push(root);
    // PORT NOTE: Zig swallowed OOM on the to_visit push; Rust push() after a
    // failed try_reserve would still attempt (and abort on OOM). In practice
    // a 1-element reserve never fails; matching exact Zig OOM semantics is
    // not worth the complexity here.

    let mut buf: [libc::pid_t; 4096] = [0; 4096];
    while !to_visit.is_empty() && to_kill.len() < 4096 {
        let parent = to_visit.swap_remove(to_visit.len() - 1);
        let Some(n) = list_child_pids(parent, &mut buf) else {
            continue;
        };
        for &child in &buf[..n] {
            if child <= 1 {
                continue;
            }
            if kill(child, libc::SIGSTOP) != 0 {
                continue;
            }
            if parent_pid_of(child) != parent {
                let _ = kill(child, libc::SIGCONT);
                continue;
            }
            if to_kill.try_reserve(1).is_err() {
                let _ = kill(child, libc::SIGKILL);
                break;
            }
            to_kill.push(child);
            if to_visit.try_reserve(1).is_err() {
                break;
            }
            to_visit.push(child);
        }
    }

    let mut i = to_kill.len();
    while i > 0 {
        i -= 1;
        let _ = kill(to_kill[i], libc::SIGKILL);
    }
}

/// Best-effort ppid lookup for an arbitrary pid. Returns 0 if the process
/// doesn't exist or the lookup failed (which the caller treats as "not the
/// parent we expected").
#[cfg(unix)]
fn parent_pid_of(pid: libc::pid_t) -> libc::pid_t {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: info is fully written by proc_pidinfo on success (rc == size).
        unsafe {
            let mut info: bun_sys::c::struct_proc_bsdinfo = bun_core::ffi::zeroed();
            let size: c_int =
                c_int::try_from(core::mem::size_of::<bun_sys::c::struct_proc_bsdinfo>())
                    .expect("int cast");
            let rc = bun_sys::c::proc_pidinfo(
                pid,
                bun_sys::c::PROC_PIDTBSDINFO,
                0,
                core::ptr::from_mut::<bun_sys::c::struct_proc_bsdinfo>(&mut info).cast(),
                size,
            );
            if rc != size {
                return 0;
            }
            return libc::pid_t::try_from(info.pbi_ppid).expect("int cast");
        }
    }
    #[cfg(target_os = "linux")]
    {
        let mut path_buf = [0u8; 64];
        let Ok(path) = bun_core::fmt::buf_print_z(&mut path_buf, format_args!("/proc/{}/stat", pid)) else {
            return 0;
        };
        let mut read_buf = [0u8; 512];
        let Some(stat) = read_file_once(path, &mut read_buf) else {
            return 0;
        };
        // Format: "pid (comm) state ppid …". `comm` may contain spaces and
        // parens; the *last* ')' terminates it. Field 1 after that is state,
        // field 2 is ppid.
        let Some(rparen) = stat.iter().rposition(|&b| b == b')') else {
            return 0;
        };
        let mut it = stat[rparen + 1..]
            .split(|&b| b == b' ')
            .filter(|s| !s.is_empty());
        let _ = it.next(); // state
        let Some(ppid_str) = it.next() else {
            return 0;
        };
        return bun_core::fmt::parse_decimal::<libc::pid_t>(ppid_str).unwrap_or(0);
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = pid;
        0
    }
}

/// Enumerate direct children of `parent` into `out`. Returns the number of
/// pids written, or null if enumeration failed / is unsupported. May truncate
/// to `out.len`.
#[cfg(unix)]
fn list_child_pids(parent: libc::pid_t, out: &mut [libc::pid_t]) -> Option<usize> {
    #[cfg(target_os = "macos")]
    {
        // proc_listchildpids returns the *count* of pids written (libproc.c
        // already divides the kernel's byte count by sizeof(int)); buffersize
        // is in bytes.
        // SAFETY: out is a valid buffer of out.len() pid_t's.
        let rc = unsafe {
            bun_sys::c::proc_listchildpids(
                parent,
                out.as_mut_ptr().cast(),
                c_int::try_from(out.len() * core::mem::size_of::<libc::pid_t>()).expect("int cast"),
            )
        };
        if rc <= 0 {
            return None;
        }
        return Some((usize::try_from(rc).expect("int cast")).min(out.len()));
    }
    #[cfg(target_os = "linux")]
    {
        return list_child_pids_linux(parent, out);
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (parent, out);
        None
    }
}

/// Linux: read `/proc/<parent>/task/<tid>/children` for every thread of
/// `parent`. Each file is a space-separated list of child pids whose
/// `getppid()` is `parent` and which were created by that specific thread.
/// Requires CONFIG_PROC_CHILDREN (enabled on every distro kernel that matters).
#[cfg(target_os = "linux")]
fn list_child_pids_linux(parent: libc::pid_t, out: &mut [libc::pid_t]) -> Option<usize> {
    use std::io::Write;

    let mut path_buf = [0u8; 64];
    let task_path = {
        let mut w = &mut path_buf[..];
        write!(w, "/proc/{}/task", parent).ok()?;
        let n = 64 - w.len();
        // PORT NOTE: reshaped for borrowck — recompute slice after write.
        &path_buf[..n]
    };

    let task_fd = match bun_sys::open_dir_for_iteration_os_path(Fd::cwd(), task_path) {
        Ok(fd) => fd,
        Err(_) => return None,
    };
    // PORT NOTE: Zig `defer task_fd.close()`; `Fd` is Copy and does not impl Drop.
    let _task_fd_guard = scopeguard::guard(task_fd, |fd| {
        let _ = bun_sys::close(fd);
    });

    let mut written: usize = 0;
    // Sized so a single read can saturate the 4096-pid `out` buffer
    // (~8 bytes per "1234567 " entry × 4096).
    let mut read_buf = [0u8; 32 * 1024];
    let mut it = bun_sys::dir_iterator::iterate(task_fd);
    loop {
        // `it.next()` → `Maybe(?Entry)`; `.unwrap() catch null` → error/None both stop.
        let entry = match it.next() {
            Ok(Some(e)) => e,
            _ => break,
        };
        if written >= out.len() {
            break;
        }
        // Each entry is a tid (numeric directory).
        let Some(tid) = bun_core::fmt::parse_decimal::<libc::pid_t>(entry.name.slice()) else {
            continue;
        };
        let Ok(children_path) = bun_core::fmt::buf_print_z(
            &mut path_buf,
            format_args!("/proc/{}/task/{}/children", parent, tid),
        ) else {
            continue;
        };
        let Some(data) = read_file_once(children_path, &mut read_buf) else {
            continue;
        };
        let tok = data
            .split(|&b| b == b' ' || b == b'\n')
            .filter(|s| !s.is_empty());
        for pid_str in tok {
            if written >= out.len() {
                break;
            }
            let Some(child) = bun_core::fmt::parse_decimal::<libc::pid_t>(pid_str) else {
                continue;
            };
            out[written] = child;
            written += 1;
        }
    }
    Some(written)
}

/// Single-shot open+read+close into `buf`. Exit-handler helper — avoids
/// allocating (so no `File.readFrom`) and swallows the `bun.sys` error info
/// we don't need.
#[cfg(unix)]
fn read_file_once<'a>(path: &ZStr, buf: &'a mut [u8]) -> Option<&'a [u8]> {
    let fd = match bun_sys::open(path, O::RDONLY, 0) {
        Ok(fd) => fd,
        Err(_) => return None,
    };
    // PORT NOTE: Zig `defer file.close()`. `bun_sys::File` does not impl Drop;
    // close explicitly on every exit path.
    let _guard = scopeguard::guard(fd, |fd| {
        let _ = bun_sys::close(fd);
    });
    // Zig `file.readAll(buf)` — fixed-buffer read-until-EOF-or-full. The Rust
    // `File::read_all` grows a `Vec`, which would allocate; do the loop here.
    let mut written = 0usize;
    while written < buf.len() {
        match bun_sys::read(fd, &mut buf[written..]) {
            Ok(0) => break,
            Ok(n) => written += n,
            Err(_) => return None,
        }
    }
    Some(&buf[..written])
}

// ported from: src/aio/ParentDeathWatchdog.zig
