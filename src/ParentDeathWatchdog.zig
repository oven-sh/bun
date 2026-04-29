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

pub const ParentDeathWatchdog = @This();

/// Exit code used when the watchdog fires. 128 + SIGHUP, matching the
/// convention for "terminated because the controlling end went away".
pub const exit_code: u8 = 128 + 1;

var enabled: bool = false;
var original_ppid: std.c.pid_t = 0;
var install_thread_id: std.Thread.Id = 0;

/// Whether no-orphans mode was enabled at startup. Read by the spawn path to
/// decide whether to default `linux_pdeathsig` on children.
pub fn isEnabled() bool {
    return enabled;
}

/// The original parent pid to watch from contexts that have no event loop
/// (`bun run` blocking in `spawnSync`, etc.). Returns null when no-orphans
/// isn't enabled or there is no parent worth watching. Both Linux and macOS
/// use this from `spawnSync` so the pgroup-kill cleanup path runs even though
/// Linux already has a SIGKILL PDEATHSIG backstop.
pub fn ppidToWatch() ?std.c.pid_t {
    if (comptime !Environment.isPosix) return null;
    if (!enabled or original_ppid <= 1) return null;
    return original_ppid;
}

/// `bun run`/`bunx` set this to the script's pgid (= script pid, since we
/// `setpgid(0,0)` in the child) so the exit callback can `kill(-pgid, KILL)`.
/// Process-group membership survives reparenting to launchd/init, so this
/// reaches grandchildren that the libproc/procfs walk would miss once the
/// script itself has exited. Stack-disciplined for nested `spawnSync` (e.g.
/// `pre`/`post` lifecycle scripts) — though in practice depth is 1.
var sync_pgids_buf: [4]std.c.pid_t = .{0} ** 4;
var sync_pgids: []std.c.pid_t = sync_pgids_buf[0..0];

/// Returns true if the push was recorded; caller must pop iff true. Depth >4
/// would lose stack discipline if push were a silent no-op while pop wasn't.
pub fn pushSyncPgid(pgid: std.c.pid_t) bool {
    if (comptime !Environment.isPosix) return false;
    if (sync_pgids.len >= sync_pgids_buf.len) return false;
    sync_pgids.len += 1;
    sync_pgids[sync_pgids.len - 1] = pgid;
    return true;
}

pub fn popSyncPgid() void {
    if (comptime !Environment.isPosix) return;
    if (sync_pgids.len > 0) sync_pgids.len -= 1;
}

/// SIGKILL every registered script pgroup + the macOS uniqueid-tracked set.
/// Scoped to the `spawnSync` script(s) — does NOT call `killDescendants()`,
/// which is rooted at `getpid()` and would take out unrelated `Bun.spawn`
/// siblings when `spawnSync` is reached from inside a live VM (e.g.
/// `ffi.zig:getSystemRootDirOnce` shelling out to `xcrun`).
pub fn killSyncScriptTree() void {
    if (comptime !Environment.isPosix) return;
    for (sync_pgids) |pgid| {
        if (pgid > 1) _ = std.c.kill(-pgid, std.posix.SIG.KILL);
    }
    if (comptime Environment.isMac) Bun__noOrphans_killTracked();
    // Linux: subreaper-adopted setsid escapees are visible as ppid==us, but
    // so are unrelated `Bun.spawn` siblings — sweeping by ppid here would
    // kill those when spawnSync runs inside a live VM. They're caught by the
    // getpid()-rooted `killDescendants()` at full-process exit instead.
}

/// Full-process teardown: pgroups + tracked + getpid()-rooted tree.
/// Only safe to call when the whole Bun process is exiting.
fn killSyncPgroupsAndDescendants() void {
    if (comptime !Environment.isPosix) return;
    killSyncScriptTree();
    killDescendants();
}

extern "c" fn Bun__noOrphans_killTracked() void;

/// Whether the spawn-side `linux_pdeathsig` default should apply to a child
/// being spawned *right now*. `PR_SET_PDEATHSIG` is thread-scoped: it fires
/// when the *thread* that vforked the child exits, not when the parent
/// process exits. A `Bun.spawn()` from a JS `Worker` vforks on that Worker's
/// OS thread, so defaulting PDEATHSIG there would kill the child on
/// `worker.terminate()` while Bun itself is still alive. Restricting the
/// default to the main thread keeps "die with Bun" semantics; Workers can
/// still opt in explicitly via the (Zig-level) `linux_pdeathsig` option.
pub fn shouldDefaultSpawnPdeathsig() bool {
    return enabled and std.Thread.getCurrentId() == install_thread_id;
}
var event_loop_installed = std.atomic.Value(bool).init(false);
/// Singleton instance — `FilePoll.Owner` needs a real pointer, but we have no
/// per-instance state.
var instance: ParentDeathWatchdog = .{};

/// Called from `main()` before the CLI starts. Checks the env var and enables
/// the watchdog as early as possible so the Linux `prctl` window is minimal.
/// `bunfig.toml`'s `[run] noOrphans` and the `--no-orphans` flag call
/// `enable()` directly later in startup if the env var wasn't set.
pub fn install() void {
    if (comptime !Environment.isPosix) return;
    if (!bun.env_var.BUN_FEATURE_FLAG_NO_ORPHANS.get()) return;
    enable();
}

/// Idempotent. Arms the watchdog: Linux `prctl(PR_SET_PDEATHSIG)`, exit-time
/// descendant reaper, and (lazily) the macOS kqueue parent watch. Safe to call
/// from `main()` (env-var path) and again from bunfig / CLI flag parsing.
pub fn enable() void {
    if (comptime !Environment.isPosix) return;
    if (enabled) return;

    enabled = true;
    install_thread_id = std.Thread.getCurrentId();
    // Export the env var so any Bun child we spawn (e.g. `bun run` → script →
    // nested bun) inherits no-orphans mode without the parent having to thread
    // the flag through. No-op if we got here via the env var.
    _ = setenv("BUN_FEATURE_FLAG_NO_ORPHANS", "1", 1);

    // PR_SET_CHILD_SUBREAPER is NOT armed here — it's process-wide and would
    // make every orphaned grandchild reparent to us, but only the spawnSync
    // wait loop has a `wait4(-1, WNOHANG)` to reap them. `bun foo.js` /
    // `--filter` / `bun test` would accumulate zombies. Subreaper is armed
    // per-script in `spawnPosix` (just before the spawn) and cleared on return.
    // Descendant cleanup runs on every clean exit regardless of whether we end
    // up watching a parent (Bun may have been spawned directly by launchd/init).
    bun.Global.addExitCallback(&onProcessExit);

    original_ppid = std.c.getppid();
    // Already orphaned (parent died before we got here, or launchd/init
    // spawned us directly) — nothing to watch.
    if (original_ppid <= 1) return;

    if (comptime Environment.isLinux) {
        // PR_SET_PDEATHSIG: kernel sends SIGKILL when the thread that forked
        // us exits. Persists across exec; cleared on fork (Bun's own children
        // do not inherit it). SIGKILL is uncatchable so user code can't
        // swallow it. The macOS path goes through Global.exit instead and so
        // also runs the descendant reaper; on Linux the SIGKILL case relies on
        // env-var inheritance — Bun-spawning-Bun chains self-reap because each
        // link sets its own PDEATHSIG.
        _ = std.posix.prctl(.SET_PDEATHSIG, .{std.posix.SIG.KILL}) catch return;
        // Race: parent may have died between getppid() above and prctl()
        // taking effect. If so we've already been reparented and the kernel
        // will never deliver the signal — exit now.
        if (std.c.getppid() != original_ppid) {
            killDescendants();
            std.c._exit(exit_code);
        }
    }
    // macOS: parent watch installs lazily via installOnEventLoop() once the
    // event loop's kqueue exists.
}

/// Register `EVFILT_PROC`/`NOTE_EXIT` for the original parent on the main
/// event loop's kqueue. Called from `VirtualMachine.init` once the uws loop is
/// up. macOS-only; no-op elsewhere and on subsequent calls.
pub fn installOnEventLoop(handle: jsc.EventLoopHandle) void {
    if (comptime !Environment.isMac) return;
    if (!enabled or original_ppid <= 1) return;
    if (event_loop_installed.swap(true, .monotonic)) return;

    // Race: parent may have died between install() and now (before the event
    // loop existed). We've been reparented; kqueue would ESRCH — exit now.
    if (std.c.getppid() != original_ppid) {
        bun.Global.exit(exit_code);
    }

    const poll = bun.Async.FilePoll.init(handle, .fromNative(original_ppid), .{}, ParentDeathWatchdog, &instance);
    switch (poll.register(handle.loop(), .process, true)) {
        .result => {
            // Do not keep the event loop alive on this poll's behalf — the
            // watchdog must never prevent Bun from exiting when there is no
            // other work. `register()` only bumps the *active* count when
            // `.keeps_event_loop_alive` was set beforehand, which we didn't.
        },
        .err => |err| {
            // ESRCH: parent already gone before we registered — treat as fired.
            if (err.getErrno() == .SRCH) {
                bun.Global.exit(exit_code);
            }
            // Any other registration error: best-effort feature, just don't watch.
        },
    }
}

/// `FilePoll.Owner` dispatch target — see the `ParentDeathWatchdog` arm in
/// `posix_event_loop.zig`'s `onUpdate`. The kqueue `NOTE_EXIT` for our parent
/// fired.
pub fn onParentExit(_: *ParentDeathWatchdog) void {
    // Global.exit → Bun__onExit → onProcessExit → killDescendants.
    bun.Global.exit(exit_code);
}

/// Registered with `Global.addExitCallback` so it runs from `Bun__onExit`
/// (atexit on macOS, at_quick_exit on Linux, and the explicit `Global.exit`
/// path). C calling convention because that's the exit-callback ABI.
fn onProcessExit() callconv(.c) void {
    killSyncPgroupsAndDescendants();
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
pub fn killDescendants() void {
    if (comptime !Environment.isPosix) return;

    const self_pid = std.c.getpid();

    var to_visit: std.ArrayListUnmanaged(std.c.pid_t) = .{};
    defer to_visit.deinit(bun.default_allocator);
    var to_kill: std.ArrayListUnmanaged(std.c.pid_t) = .{};
    defer to_kill.deinit(bun.default_allocator);

    to_visit.append(bun.default_allocator, self_pid) catch return;

    var buf: [4096]std.c.pid_t = undefined;
    // Hard cap on tree size so a fork bomb under us can't make exit hang.
    while (to_visit.items.len > 0 and to_kill.items.len < 4096) {
        const parent = to_visit.swapRemove(to_visit.items.len - 1);
        const n = listChildPids(parent, &buf) orelse continue;
        for (buf[0..n]) |child| {
            if (child == self_pid or child <= 1) continue;
            // Freeze first, then confirm it's still the process we enumerated.
            if (std.c.kill(child, std.posix.SIG.STOP) != 0) continue;
            if (parentPidOf(child) != parent) {
                // Recycled between enumerate and STOP — undo and skip.
                _ = std.c.kill(child, std.posix.SIG.CONT);
                continue;
            }
            to_kill.append(bun.default_allocator, child) catch {
                // OOM after we've already STOPped+verified this child — kill it
                // now rather than leaving it frozen and absent from to_kill.
                _ = std.c.kill(child, std.posix.SIG.KILL);
                break;
            };
            to_visit.append(bun.default_allocator, child) catch break;
        }
    }

    // Reverse: leaves first. SIGKILL terminates stopped processes directly.
    var i = to_kill.items.len;
    while (i > 0) {
        i -= 1;
        _ = std.c.kill(to_kill.items[i], std.posix.SIG.KILL);
    }
}

/// Best-effort ppid lookup for an arbitrary pid. Returns 0 if the process
/// doesn't exist or the lookup failed (which the caller treats as "not the
/// parent we expected").
fn parentPidOf(pid: std.c.pid_t) std.c.pid_t {
    if (comptime Environment.isMac) {
        var info: bun.c.struct_proc_bsdinfo = undefined;
        const size: c_int = @sizeOf(bun.c.struct_proc_bsdinfo);
        const rc = bun.c.proc_pidinfo(pid, bun.c.PROC_PIDTBSDINFO, 0, &info, size);
        if (rc != size) return 0;
        return @intCast(info.pbi_ppid);
    }
    if (comptime Environment.isLinux) {
        var path_buf: [64]u8 = undefined;
        const path = std.fmt.bufPrintZ(&path_buf, "/proc/{d}/stat", .{pid}) catch return 0;
        var read_buf: [512]u8 = undefined;
        const stat = readFileOnce(path, &read_buf) orelse return 0;
        // Format: "pid (comm) state ppid …". `comm` may contain spaces and
        // parens; the *last* ')' terminates it. Field 1 after that is state,
        // field 2 is ppid.
        const rparen = std.mem.lastIndexOfScalar(u8, stat, ')') orelse return 0;
        var it = std.mem.tokenizeScalar(u8, stat[rparen + 1 ..], ' ');
        _ = it.next(); // state
        const ppid_str = it.next() orelse return 0;
        return std.fmt.parseInt(std.c.pid_t, ppid_str, 10) catch 0;
    }
    return 0;
}

/// Enumerate direct children of `parent` into `out`. Returns the number of
/// pids written, or null if enumeration failed / is unsupported. May truncate
/// to `out.len`.
fn listChildPids(parent: std.c.pid_t, out: []std.c.pid_t) ?usize {
    if (comptime Environment.isMac) {
        // proc_listchildpids returns the *count* of pids written (libproc.c
        // already divides the kernel's byte count by sizeof(int)); buffersize
        // is in bytes.
        const rc = bun.c.proc_listchildpids(parent, out.ptr, @intCast(out.len * @sizeOf(std.c.pid_t)));
        if (rc <= 0) return null;
        return @intCast(@min(@as(usize, @intCast(rc)), out.len));
    }
    if (comptime Environment.isLinux) {
        return listChildPidsLinux(parent, out);
    }
    return null;
}

/// Linux: read `/proc/<parent>/task/<tid>/children` for every thread of
/// `parent`. Each file is a space-separated list of child pids whose
/// `getppid()` is `parent` and which were created by that specific thread.
/// Requires CONFIG_PROC_CHILDREN (enabled on every distro kernel that matters).
fn listChildPidsLinux(parent: std.c.pid_t, out: []std.c.pid_t) ?usize {
    if (comptime !Environment.isLinux) unreachable;

    var path_buf: [64]u8 = undefined;
    const task_path = std.fmt.bufPrint(&path_buf, "/proc/{d}/task", .{parent}) catch return null;

    const task_fd = switch (bun.openDirForIteration(bun.FD.cwd(), task_path)) {
        .result => |fd| fd,
        .err => return null,
    };
    defer task_fd.close();

    var written: usize = 0;
    // Sized so a single read can saturate the 4096-pid `out` buffer
    // (~8 bytes per "1234567 " entry × 4096).
    var read_buf: [32 * 1024]u8 = undefined;
    var it = bun.iterateDir(task_fd);
    while (it.next().unwrap() catch null) |entry| {
        if (written >= out.len) break;
        // Each entry is a tid (numeric directory).
        const tid = std.fmt.parseInt(std.c.pid_t, entry.name.slice(), 10) catch continue;
        const children_path = std.fmt.bufPrintZ(&path_buf, "/proc/{d}/task/{d}/children", .{ parent, tid }) catch continue;
        const data = readFileOnce(children_path, &read_buf) orelse continue;
        var tok = std.mem.tokenizeAny(u8, data, " \n");
        while (tok.next()) |pid_str| {
            if (written >= out.len) break;
            const child = std.fmt.parseInt(std.c.pid_t, pid_str, 10) catch continue;
            out[written] = child;
            written += 1;
        }
    }
    return written;
}

/// Single-shot open+read+close into `buf`. Exit-handler helper — avoids
/// allocating (so no `File.readFrom`) and swallows the `bun.sys` error info
/// we don't need.
fn readFileOnce(path: [:0]const u8, buf: []u8) ?[]const u8 {
    const file = switch (bun.sys.File.open(path, bun.O.RDONLY, 0)) {
        .result => |f| f,
        .err => return null,
    };
    defer file.close();
    return switch (file.readAll(buf)) {
        .result => |n| buf[0..n],
        .err => null,
    };
}

extern "c" fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
