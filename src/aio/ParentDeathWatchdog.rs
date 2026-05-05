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

use bun_core::{env_var, Global};
use bun_str::ZStr;
use bun_sys::{self, Fd, File, O};

use crate::posix_event_loop::{poll_tag, EventLoopCtx, Owner};
use crate::FilePoll;

/// Unit struct — `FilePoll.Owner` needs a real pointer, but we have no
/// per-instance state.
pub struct ParentDeathWatchdog;

/// Exit code used when the watchdog fires. 128 + SIGHUP, matching the
/// convention for "terminated because the controlling end went away".
pub const EXIT_CODE: u8 = 128 + 1;

// PORT NOTE: Zig used plain `var` globals (unsynchronized). Mirrored here as
// `static mut` with the same single-writer-at-startup discipline; reads after
// `enable()` are technically racy in both languages.
// TODO(port): consider AtomicBool/AtomicI32 if Phase B wants strict soundness.
static mut ENABLED: bool = false;
static mut ORIGINAL_PPID: libc::pid_t = 0;
static mut INSTALL_THREAD_ID: Option<std::thread::ThreadId> = None;

/// Whether no-orphans mode was enabled at startup. Read by the spawn path to
/// decide whether to default `linux_pdeathsig` on children.
pub fn is_enabled() -> bool {
    // SAFETY: written once on main thread at startup before any reader.
    unsafe { ENABLED }
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
        // SAFETY: written once on main thread at startup before any reader.
        unsafe {
            if !ENABLED || ORIGINAL_PPID <= 1 {
                return None;
            }
            Some(ORIGINAL_PPID)
        }
    }
}

/// `bun run`/`bunx` set this to the script's pgid (= script pid, since we
/// `setpgid(0,0)` in the child) so the exit callback can `kill(-pgid, KILL)`.
/// Process-group membership survives reparenting to launchd/init, so this
/// reaches grandchildren that the libproc/procfs walk would miss once the
/// script itself has exited. Stack-disciplined for nested `spawnSync` (e.g.
/// `pre`/`post` lifecycle scripts) — though in practice depth is 1.
static mut SYNC_PGIDS_BUF: [libc::pid_t; 4] = [0; 4];
static mut SYNC_PGIDS_LEN: usize = 0;

/// Returns true if the push was recorded; caller must pop iff true. Depth >4
/// would lose stack discipline if push were a silent no-op while pop wasn't.
pub fn push_sync_pgid(pgid: libc::pid_t) -> bool {
    #[cfg(not(unix))]
    {
        let _ = pgid;
        return false;
    }
    #[cfg(unix)]
    // SAFETY: single-threaded spawnSync stack discipline; mirrors Zig globals.
    unsafe {
        if SYNC_PGIDS_LEN >= SYNC_PGIDS_BUF.len() {
            return false;
        }
        SYNC_PGIDS_LEN += 1;
        SYNC_PGIDS_BUF[SYNC_PGIDS_LEN - 1] = pgid;
        true
    }
}

pub fn pop_sync_pgid() {
    #[cfg(unix)]
    // SAFETY: single-threaded spawnSync stack discipline; mirrors Zig globals.
    unsafe {
        if SYNC_PGIDS_LEN > 0 {
            SYNC_PGIDS_LEN -= 1;
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
        // SAFETY: read-only iteration of startup-populated globals.
        let pgids = unsafe { &SYNC_PGIDS_BUF[..SYNC_PGIDS_LEN] };
        for &pgid in pgids {
            if pgid > 1 {
                // SAFETY: FFI call; kill(2) is async-signal-safe.
                unsafe {
                    let _ = libc::kill(-pgid, libc::SIGKILL);
                }
            }
        }
        #[cfg(target_os = "macos")]
        // SAFETY: extern "C" fn with no preconditions.
        unsafe {
            Bun__noOrphans_killTracked();
        }
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
    fn Bun__noOrphans_killTracked();
}

/// Whether the spawn-side `linux_pdeathsig` default should apply to a child
/// being spawned *right now*. `PR_SET_PDEATHSIG` is thread-scoped: it fires
/// when the *thread* that vforked the child exits, not when the parent
/// process exits. A `Bun.spawn()` from a JS `Worker` vforks on that Worker's
/// OS thread, so defaulting PDEATHSIG there would kill the child on
/// `worker.terminate()` while Bun itself is still alive. Restricting the
/// default to the main thread keeps "die with Bun" semantics; Workers can
/// still opt in explicitly via the (Zig-level) `linux_pdeathsig` option.
pub fn should_default_spawn_pdeathsig() -> bool {
    // SAFETY: globals written once at startup before any worker thread exists.
    unsafe { ENABLED && Some(std::thread::current().id()) == INSTALL_THREAD_ID }
}

static EVENT_LOOP_INSTALLED: AtomicBool = AtomicBool::new(false);
/// Singleton instance — `FilePoll.Owner` needs a real pointer, but we have no
/// per-instance state.
static mut INSTANCE: ParentDeathWatchdog = ParentDeathWatchdog;

/// Called from `main()` before the CLI starts. Checks the env var and enables
/// the watchdog as early as possible so the Linux `prctl` window is minimal.
/// `bunfig.toml`'s `[run] noOrphans` and the `--no-orphans` flag call
/// `enable()` directly later in startup if the env var wasn't set.
pub fn install() {
    #[cfg(unix)]
    {
        if !env_var::BUN_FEATURE_FLAG_NO_ORPHANS.get() {
            return;
        }
        enable();
    }
}

/// Idempotent. Arms the watchdog: Linux `prctl(PR_SET_PDEATHSIG)`, exit-time
/// descendant reaper, and (lazily) the macOS kqueue parent watch. Safe to call
/// from `main()` (env-var path) and again from bunfig / CLI flag parsing.
pub fn enable() {
    #[cfg(unix)]
    // SAFETY: called only on the main thread during startup, before any
    // concurrent reader exists; idempotent guard prevents double-init.
    unsafe {
        if ENABLED {
            return;
        }

        ENABLED = true;
        INSTALL_THREAD_ID = Some(std::thread::current().id());
        // Export the env var so any Bun child we spawn (e.g. `bun run` → script →
        // nested bun) inherits no-orphans mode without the parent having to thread
        // the flag through. No-op if we got here via the env var.
        let _ = libc::setenv(
            c"BUN_FEATURE_FLAG_NO_ORPHANS".as_ptr(),
            c"1".as_ptr(),
            1,
        );

        // PR_SET_CHILD_SUBREAPER is NOT armed here — it's process-wide and would
        // make every orphaned grandchild reparent to us, but only the spawnSync
        // wait loop has a `wait4(-1, WNOHANG)` to reap them. `bun foo.js` /
        // `--filter` / `bun test` would accumulate zombies. Subreaper is armed
        // per-script in `spawnPosix` (just before the spawn) and cleared on return.
        // Descendant cleanup runs on every clean exit regardless of whether we end
        // up watching a parent (Bun may have been spawned directly by launchd/init).
        Global::add_exit_callback(on_process_exit);

        ORIGINAL_PPID = libc::getppid();
        // Already orphaned (parent died before we got here, or launchd/init
        // spawned us directly) — nothing to watch.
        if ORIGINAL_PPID <= 1 {
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
            if libc::getppid() != ORIGINAL_PPID {
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
        // SAFETY: globals written once at startup; read-only here.
        let (enabled, original_ppid) = unsafe { (ENABLED, ORIGINAL_PPID) };
        if !enabled || original_ppid <= 1 {
            return;
        }
        if EVENT_LOOP_INSTALLED.swap(true, Ordering::Relaxed) {
            return;
        }

        // Race: parent may have died between install() and now (before the event
        // loop existed). We've been reparented; kqueue would ESRCH — exit now.
        // SAFETY: FFI call.
        if unsafe { libc::getppid() } != original_ppid {
            Global::exit(EXIT_CODE);
        }

        // SAFETY: INSTANCE is a 'static singleton with no fields.
        let instance_ptr = unsafe { core::ptr::addr_of_mut!(INSTANCE) };
        let poll = FilePoll::init(
            handle,
            Fd::from_native(original_ppid),
            Default::default(),
            Owner::new(poll_tag::PARENT_DEATH_WATCHDOG, instance_ptr.cast()),
        );
        match poll.register(handle.platform_event_loop(), crate::file_poll::Pollable::Process, true) {
            bun_sys::Result::Ok(()) => {
                // Do not keep the event loop alive on this poll's behalf — the
                // watchdog must never prevent Bun from exiting when there is no
                // other work. `register()` only bumps the *active* count when
                // `.keeps_event_loop_alive` was set beforehand, which we didn't.
            }
            bun_sys::Result::Err(err) => {
                // ESRCH: parent already gone before we registered — treat as fired.
                if err.errno() == bun_sys::Errno::SRCH {
                    Global::exit(EXIT_CODE);
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
    Global::exit(EXIT_CODE);
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
    // SAFETY: FFI calls below are async-signal-safe libc.
    unsafe {
        let self_pid = libc::getpid();

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
                if libc::kill(child, libc::SIGSTOP) != 0 {
                    continue;
                }
                if parent_pid_of(child) != parent {
                    // Recycled between enumerate and STOP — undo and skip.
                    let _ = libc::kill(child, libc::SIGCONT);
                    continue;
                }
                if to_kill.try_reserve(1).is_err() {
                    // OOM after we've already STOPped+verified this child — kill it
                    // now rather than leaving it frozen and absent from to_kill.
                    let _ = libc::kill(child, libc::SIGKILL);
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
            let _ = libc::kill(to_kill[i], libc::SIGKILL);
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
        // SAFETY: FFI call.
        let self_pid = unsafe { libc::getpid() };
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
    // SAFETY: FFI calls below are async-signal-safe libc.
    unsafe {
        let self_pid = libc::getpid();
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
                if libc::waitpid(-1, &mut st, libc::WNOHANG) <= 0 {
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
    // SAFETY: FFI calls below are async-signal-safe libc.
    unsafe {
        let mut to_visit: Vec<libc::pid_t> = Vec::new();
        let mut to_kill: Vec<libc::pid_t> = Vec::new();

        if libc::kill(root, libc::SIGSTOP) != 0 {
            return;
        }
        if parent_pid_of(root) != expected_ppid_of_root {
            let _ = libc::kill(root, libc::SIGCONT);
            return;
        }
        if to_kill.try_reserve(1).is_err() {
            let _ = libc::kill(root, libc::SIGKILL);
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
                if libc::kill(child, libc::SIGSTOP) != 0 {
                    continue;
                }
                if parent_pid_of(child) != parent {
                    let _ = libc::kill(child, libc::SIGCONT);
                    continue;
                }
                if to_kill.try_reserve(1).is_err() {
                    let _ = libc::kill(child, libc::SIGKILL);
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
            let _ = libc::kill(to_kill[i], libc::SIGKILL);
        }
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
            let mut info: bun_sys::c::struct_proc_bsdinfo = core::mem::zeroed();
            let size: c_int =
                c_int::try_from(core::mem::size_of::<bun_sys::c::struct_proc_bsdinfo>()).unwrap();
            let rc = bun_sys::c::proc_pidinfo(
                pid,
                bun_sys::c::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut bun_sys::c::struct_proc_bsdinfo).cast(),
                size,
            );
            if rc != size {
                return 0;
            }
            return libc::pid_t::try_from(info.pbi_ppid).unwrap();
        }
    }
    #[cfg(target_os = "linux")]
    {
        let mut path_buf = [0u8; 64];
        let Some(path) = buf_print_z(&mut path_buf, format_args!("/proc/{}/stat", pid)) else {
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
        return parse_pid(ppid_str).unwrap_or(0);
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
                c_int::try_from(out.len() * core::mem::size_of::<libc::pid_t>()).unwrap(),
            )
        };
        if rc <= 0 {
            return None;
        }
        return Some((usize::try_from(rc).unwrap()).min(out.len()));
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
        let n = path_buf.len() - w.len();
        // PORT NOTE: reshaped for borrowck — recompute slice after write.
        &path_buf[..n]
    };

    let task_fd = match bun_sys::open_dir_for_iteration(Fd::cwd(), task_path) {
        bun_sys::Result::Ok(fd) => fd,
        bun_sys::Result::Err(_) => return None,
    };
    // PORT NOTE: Zig `defer task_fd.close()`; assume Fd impls Drop. If not,
    // Phase B should add an explicit close.
    let _task_fd_guard = scopeguard::guard((), |_| {
        task_fd.close();
    });
    // TODO(port): if bun_sys::Fd implements Drop, remove the scopeguard above.

    let mut written: usize = 0;
    // Sized so a single read can saturate the 4096-pid `out` buffer
    // (~8 bytes per "1234567 " entry × 4096).
    let mut read_buf = [0u8; 32 * 1024];
    let mut it = bun_sys::iterate_dir(task_fd);
    loop {
        // `it.next()` → `Maybe(?Entry)`; `.unwrap() catch null` → error/None both stop.
        let entry = match it.next() {
            bun_sys::Result::Ok(Some(e)) => e,
            _ => break,
        };
        if written >= out.len() {
            break;
        }
        // Each entry is a tid (numeric directory).
        let Some(tid) = parse_pid(entry.name.as_bytes()) else {
            continue;
        };
        let Some(children_path) = buf_print_z(
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
            let Some(child) = parse_pid(pid_str) else {
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
    let file = match File::open(path, O::RDONLY, 0) {
        bun_sys::Result::Ok(f) => f,
        bun_sys::Result::Err(_) => return None,
    };
    // PORT NOTE: Zig `defer file.close()` — File should impl Drop in bun_sys.
    let _guard = scopeguard::guard((), |_| {
        file.close();
    });
    // TODO(port): if bun_sys::File implements Drop, remove the scopeguard above.
    match file.read_all(buf) {
        bun_sys::Result::Ok(n) => Some(&buf[..n]),
        bun_sys::Result::Err(_) => None,
    }
}

// ─── port-local helpers ──────────────────────────────────────────────────────

/// Format `args` into `buf`, NUL-terminate, return a `&ZStr` borrowing `buf`.
/// Returns None if the formatted output (plus NUL) doesn't fit.
/// Port helper for `std.fmt.bufPrintZ`.
#[cfg(unix)]
fn buf_print_z<'a>(buf: &'a mut [u8], args: core::fmt::Arguments<'_>) -> Option<&'a ZStr> {
    use std::io::Write;
    let cap = buf.len();
    let mut w = &mut buf[..];
    w.write_fmt(args).ok()?;
    let n = cap - w.len();
    if n >= cap {
        return None;
    }
    buf[n] = 0;
    // SAFETY: buf[n] == 0 written immediately above; buf[..n] is valid for 'a.
    Some(unsafe { ZStr::from_raw(buf.as_ptr(), n) })
}

/// Parse an ASCII decimal pid from bytes. Port helper for
/// `std.fmt.parseInt(pid_t, s, 10)`.
#[cfg(unix)]
fn parse_pid(s: &[u8]) -> Option<libc::pid_t> {
    // Input is /proc-sourced ASCII digits; from_utf8 cannot fail on valid pids
    // and is only used to reach `str::parse`.
    core::str::from_utf8(s).ok()?.parse().ok()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/aio/ParentDeathWatchdog.zig (501 lines)
//   confidence: medium
//   todos:      6
//   notes:      static mut globals mirror Zig vars (racy by design); FilePoll::init/register + bun_sys::Result/Fd-Drop API shapes need Phase-B verification; added buf_print_z/parse_pid helpers for std.fmt.bufPrintZ/parseInt
// ──────────────────────────────────────────────────────────────────────────
