//! Opt-in self-termination when our parent goes away.
//!
//! Enabled via env var `BUN_DIE_WITH_PARENT`. When set, Bun captures its
//! original parent pid at startup and exits as soon as that parent is
//! gone — even if the parent was SIGKILLed and never got a chance to signal
//! us. On Linux this is implemented with `PR_SET_PDEATHSIG`, which tracks
//! the creating *thread* rather than the whole parent process; for the
//! single-threaded shims this feature targets the distinction is moot.
//!
//! Motivation: process supervisors that wrap Bun in a thin shim (e.g. a
//! macOS TCC "disclaimer" trampoline: Electron → shim → bun) can be
//! SIGKILLed by their own parent's timeout/abort logic. SIGKILL is
//! uncatchable, so the shim can't forward it, and Bun is silently
//! reparented to launchd/init where it keeps running forever. This watchdog
//! closes that gap from Bun's side without requiring the shim to cooperate.
//!
//! Linux: `prctl(PR_SET_PDEATHSIG)` — kernel delivers a signal when the
//! parent thread dies. Single syscall, no thread.
//! macOS: no PDEATHSIG. A `DISPATCH_SOURCE_TYPE_PROC` / `DISPATCH_PROC_EXIT`
//! source on the original ppid calls `_exit` when it fires. libdispatch's
//! manager thread owns the underlying kevent, so Bun does not spawn a thread
//! of its own.

/// Exit code used when the watchdog fires. 128 + SIGHUP, matching the
/// convention for "terminated because the controlling end went away".
const exit_code: u8 = 128 + 1;

pub fn install() void {
    if (comptime !Environment.isPosix) return;

    if (!bun.env_var.BUN_DIE_WITH_PARENT.get()) return;

    const original_ppid = std.c.getppid();
    // Already orphaned (parent died before we got here, or launchd/init
    // spawned us directly) — nothing to watch.
    if (original_ppid <= 1) return;

    if (comptime Environment.isLinux) {
        installLinux(original_ppid);
    } else if (comptime Environment.isMac) {
        installDarwin(original_ppid);
    }
}

fn installLinux(original_ppid: std.c.pid_t) void {
    if (comptime !Environment.isLinux) unreachable;
    // PR_SET_PDEATHSIG: kernel sends SIGKILL when the *thread* that forked
    // us exits. Persists across exec; cleared on fork (which is what we
    // want — Bun's own children should not inherit it). SIGKILL is
    // uncatchable so user code can't swallow it, matching the macOS path
    // which hard-_exit()s from the dispatch handler.
    _ = std.posix.prctl(.SET_PDEATHSIG, .{std.posix.SIG.KILL}) catch return;
    // Race: parent may have died between getppid() above and prctl() taking
    // effect. If so we've already been reparented and the kernel will never
    // deliver the signal — exit now.
    if (std.c.getppid() != original_ppid) {
        std.c._exit(exit_code);
    }
}

extern "c" fn Bun__registerParentDeathDispatchSource(ppid: std.c.pid_t, exit_code: c_int) void;

fn installDarwin(original_ppid: std.c.pid_t) void {
    if (comptime !Environment.isMac) unreachable;
    Bun__registerParentDeathDispatchSource(original_ppid, exit_code);
    // Race: parent may have died between getppid() and the dispatch source
    // arming. dispatch_source_create itself returns NULL for a dead pid (the
    // C side handles that), but a death in the gap after a successful create
    // and before resume is not guaranteed to fire — recheck.
    if (std.c.getppid() != original_ppid) {
        std.c._exit(exit_code);
    }
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
