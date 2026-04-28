//! Opt-in self-termination when our parent process dies.
//!
//! Enabled via env var `BUN_DIE_WITH_PARENT`. When set, Bun captures its
//! parent pid at startup and exits as soon as that process is gone — even if
//! the parent was SIGKILLed and never got a chance to signal us.
//!
//! Motivation: process supervisors that wrap Bun in a thin shim (e.g. a
//! macOS TCC "disclaimer" trampoline: Electron → shim → bun) can be
//! SIGKILLed by their own parent's timeout/abort logic. SIGKILL is
//! uncatchable, so the shim can't forward it, and Bun is silently
//! reparented to launchd/init where it keeps running forever. This watchdog
//! closes that gap from Bun's side without requiring the shim to cooperate.
//!
//! Linux: `prctl(PR_SET_PDEATHSIG)` — kernel delivers a signal when the
//! parent thread dies.
//! macOS: no PDEATHSIG. A detached thread blocks on a kqueue
//! `EVFILT_PROC`/`NOTE_EXIT` for the original ppid and calls `_exit` when
//! it fires.

/// Exit code used when the watchdog fires. 128 + SIGHUP, matching the
/// convention for "terminated because the controlling end went away".
const exit_code: u8 = 128 + 1;

pub fn install() void {
    if (comptime !Environment.isPosix) return;

    const raw = bun.getenvZ("BUN_DIE_WITH_PARENT") orelse return;
    if (raw.len == 0 or std.mem.eql(u8, raw, "0") or std.mem.eql(u8, raw, "false")) return;

    const original_ppid = std.c.getppid();
    // Already orphaned (parent died before we got here, or launchd/init
    // spawned us directly) — nothing to watch.
    if (original_ppid <= 1) return;

    if (comptime Environment.isLinux) {
        installLinux(original_ppid);
    } else if (comptime Environment.isMac) {
        installKqueue(original_ppid);
    }
}

fn installLinux(original_ppid: std.c.pid_t) void {
    if (comptime !Environment.isLinux) unreachable;
    // PR_SET_PDEATHSIG: kernel sends SIGTERM when the *thread* that forked
    // us exits. Persists across exec; cleared on fork (which is what we
    // want — Bun's own children should not inherit it).
    _ = std.posix.prctl(.SET_PDEATHSIG, .{std.posix.SIG.TERM}) catch return;
    // Race: parent may have died between getppid() above and prctl() taking
    // effect. If so we've already been reparented and the kernel will never
    // deliver the signal — exit now.
    if (std.c.getppid() != original_ppid) {
        std.c._exit(exit_code);
    }
}

fn installKqueue(original_ppid: std.c.pid_t) void {
    // Race: parent may have died between exec and here.
    if (std.c.getppid() != original_ppid) {
        std.c._exit(exit_code);
    }
    var thread = std.Thread.spawn(.{}, kqueueThread, .{original_ppid}) catch return;
    thread.detach();
}

fn kqueueThread(original_ppid: std.c.pid_t) void {
    // Don't let process-directed signals land on this thread and EINTR the
    // kevent wait; the main thread owns signal handling.
    var all = std.posix.sigfillset();
    var old: std.c.sigset_t = undefined;
    _ = std.c.pthread_sigmask(std.c.SIG.BLOCK, &all, &old);

    bun.Output.Source.configureNamedThread("ParentDeathWatchdog");

    const kq = std.posix.kqueue() catch return;
    defer std.posix.close(kq);

    var changes = [_]std.posix.Kevent{.{
        .ident = @intCast(original_ppid),
        .filter = std.c.EVFILT.PROC,
        .flags = std.c.EV.ADD | std.c.EV.ONESHOT,
        .fflags = std.c.NOTE.EXIT,
        .data = 0,
        .udata = 0,
    }};
    var events: [1]std.posix.Kevent = undefined;

    // Register + block in one call. std.posix.kevent retries EINTR for us.
    const n = std.posix.kevent(kq, &changes, &events, null) catch |err| switch (err) {
        // ESRCH at the syscall level: parent already gone before we
        // registered — treat as fired.
        error.ProcessNotFound => {
            std.c._exit(exit_code);
        },
        else => return,
    };

    if (n != 1) return;
    if (events[0].flags & std.c.EV.ERROR != 0) {
        // ESRCH delivered via EV_ERROR in the eventlist (kernel had room to
        // report it inline rather than failing the syscall).
        const errno: std.posix.E = @enumFromInt(events[0].data);
        if (errno != .SRCH) return;
    }

    std.c._exit(exit_code);
}

const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
