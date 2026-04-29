//! Spawns and watches the WebView host subprocess. macOS only.
//!
//! WKWebView hard-asserts `pthread_main_np()` (MainThreadCocoa.mm). Bridging
//! CFRunLoop into kqueue on the JS thread was abandoned: CFRunLoopWakeUp's
//! ignoreWakeUps flag check is a userspace drop before the mach send — lldb on
//! hangs showed the CF wake port seqno=0 over the process lifetime. No wake
//! path exists for kqueue to observe.
//!
//! The host child runs CFRunLoopRun() as its real main loop. CF manages
//! ignoreWakeUps correctly when it owns the loop. Parent talks over a
//! socketpair; usockets handles the parent end (C++ side), CFFileDescriptor
//! handles the child end. Socket EOF = parent died = child exits.
//!
//! This file owns process lifetime only. The usockets client lives in C++
//! (WebKitBackend.cpp) — usockets is a C API and the frame protocol is C structs.

const HostProcess = @This();

process: *bun.spawn.Process,
var instance: ?*HostProcess = null;

/// Called from WebView.closeAll() and dispatchOnExit. Socket EOF handles
/// normal parent-death (including SIGKILL of Bun — kernel closes fds, child
/// reads 0, CFRunLoopStop). This catches the clean-exit path where the child
/// hasn't yet noticed EOF before we return from main(). WKWebView's own
/// WebContent/GPU/Network helpers are XPC-connected to the child — when the
/// child dies they get connection-invalidated and exit.
pub export fn Bun__WebViewHost__kill() void {
    if (instance) |i| {
        _ = i.process.kill(9);
    }
}

/// Lazy: first `new Bun.WebView()` calls this via C++. Returns the parent
/// socket fd (C++ adopts into usockets and owns it from then on), or -1.
/// C++'s HostClient::ensureSpawned checks its own sock before calling here,
/// so instance-already-exists → -1 means "you already have the fd, this is
/// a bug" not "spawn failed". We deliberately don't store the fd — usockets
/// owns it; re-returning a fd usockets may have already closed would be a
/// use-after-close. Zig only owns process lifetime (watch + kill).
pub export fn Bun__WebViewHost__ensure(global: *jsc.JSGlobalObject, stdoutInherit: bool, stderrInherit: bool, detached: bool) i32 {
    if (comptime !bun.Environment.isMac) return -1;
    if (instance != null) return -1; // C++ already holds the fd

    const fd = spawn(global.bunVM(), stdoutInherit, stderrInherit, detached) catch |err| {
        log("spawn failed: {s}", .{@errorName(err)});
        return -1;
    };
    return fd.cast();
}

/// Child died (EVFILT_PROC fired). Socket onClose may have fired already
/// (clean FIN) or may not have (SIGKILL, SIGSEGV). Tell C++ to reject any
/// pending promises and mark the host dead.
pub fn onProcessExit(this: *HostProcess, _: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
    log("child exited: {f}", .{status});
    const signo: i32 = if (status.signalCode()) |sig| @intFromEnum(sig) else 0;
    Bun__WebViewHost__childDied(signo);
    this.process.deref();
    bun.destroy(this);
    instance = null;
}

fn spawn(vm: *jsc.VirtualMachine, stdoutInherit: bool, stderrInherit: bool, detached: bool) !bun.FD {
    if (comptime !bun.Environment.isMac) return error.Unsupported;

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    // Both ends nonblocking — parent uses usockets; child sets O_NONBLOCK
    // again after dup2 (socketpair flags are per-fd, not per-pair).
    const fds = try bun.sys.socketpair(
        std.posix.AF.UNIX,
        std.posix.SOCK.STREAM,
        0,
        .nonblocking,
    ).unwrap();
    errdefer fds[0].close();
    // fds[1] is closed by spawnProcess after dup2 into the child.

    const exe = try bun.selfExePath();

    // Child sees fd 3 (first extra_fd → 3+0). The env var is the only
    // signal; no argv changes so `ps` shows a normal `bun` invocation.
    // Same pattern as NODE_CHANNEL_FD in js_bun_spawn_bindings.zig.
    var env: std.ArrayListUnmanaged(?[*:0]const u8) = .{};
    const base = try vm.transpiler.env.map.createNullDelimitedEnvMap(alloc);
    try env.ensureTotalCapacity(alloc, base.len + 2);
    env.appendSliceAssumeCapacity(@ptrCast(base));
    env.appendAssumeCapacity("BUN_INTERNAL_WEBVIEW_HOST=3");
    env.appendAssumeCapacity(null);

    var argv = [_:null]?[*:0]const u8{exe.ptr};

    var opts: bun.spawn.SpawnOptions = .{
        .stdin = .ignore,
        // Default ignore — the child runs no JS or user code, so output is
        // only panics/NSLog from WebKit. Opt-in via backend.stderr when
        // debugging a silent host crash.
        .stdout = if (stdoutInherit) .inherit else .ignore,
        .stderr = if (stderrInherit) .inherit else .ignore,
        .extra_fds = &.{.{ .pipe = fds[1] }},
        .argv0 = exe.ptr,
        // setsid() in the child — new session, no controlling TTY. Same
        // rationale as ChromeProcess.zig: keeps endpoint-protection /dev/tty
        // writes off the parent's terminal.
        .detached = detached,
    };

    var spawned = try (try bun.spawn.spawnProcess(
        &opts,
        @ptrCast(&argv),
        @ptrCast(env.items.ptr),
    )).unwrap();

    const self = bun.new(HostProcess, .{
        .process = spawned.toProcess(vm.eventLoop(), false),
    });
    self.process.setExitHandler(self);
    switch (self.process.watch()) {
        .result => {
            // Weak handle: parent exits when no views + nothing pending,
            // child gets socket EOF and exits, EVFILT_PROC fires into a
            // dead process (kernel discards). If we ref'd, parent would
            // stay alive forever waiting on a child that is waiting on us.
            // dispatchOnExit also SIGKILLs via Bun__WebViewHost__kill.
            self.process.disableKeepingEventLoopAlive();
        },
        .err => |e| {
            log("watch failed: {f}", .{e});
            self.process.deref();
            bun.destroy(self);
            // errdefer at the top closes fds[0]; don't double-close here.
            return error.WatchFailed;
        },
    }
    instance = self;
    // fd handed to C++ which adopts it into usockets. Not stored here —
    // usockets owns the socket; Zig only owns process lifetime.
    return fds[0];
}

// Implemented in WebKitBackend.cpp. Rejects all pending promises, marks the
// host socket dead. `signo` is the signal that killed the child (0 if it
// exited cleanly).
extern fn Bun__WebViewHost__childDied(signo: i32) void;

const log = bun.Output.scoped(.WebViewHost, .hidden);

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
