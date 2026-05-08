//! Reacts to OS low-memory signals by shrinking the JSC heap and returning
//! mimalloc free segments to the OS. One per process, hooked into the
//! main-thread VM's event loop, never keeps the loop alive.
//!
//! Off by default — opt in with
//! `BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER=1` so downstreams can
//! A/B the change before it becomes default-on.
//!
//! Detection front-ends:
//! - Windows: `CreateMemoryResourceNotification(LowMemoryResourceNotification)`
//!   waited on via `RegisterWaitForSingleObject` (NT threadpool); the callback
//!   `uv_async_send`s the JS thread. Mirrors WebKit PR 63320.
//! - macOS: `dispatch_source_create(DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, …)` on
//!   a global concurrent queue; the handler enqueues a `ConcurrentTask`.
//!   Mirrors `MemoryPressureHandlerCocoa.mm`.
//! - Linux: a PSI trigger (`/proc/pressure/memory`, `POLLPRI`) blocked on by a
//!   dedicated thread which enqueues a `ConcurrentTask`. PSI signals via
//!   POLLPRI which `Async.FilePoll` doesn't yet expose, hence the thread.
//!
//! All three converge on `respond()` running on the JS thread.
//!
//! `WTF::MemoryPressureHandler` was considered but not used: in Bun's JSCOnly
//! WebKit build it is a no-op stub on macOS, has no OS hook on Linux, polls
//! every 60 s on Windows, and `releaseMemory()` does nothing without a
//! Bun-supplied `lowMemoryHandler` anyway — see `PlatformJSCOnly.cmake`.

const log = bun.Output.scoped(.MemoryPressure, .visible);

/// At most one `respond()` per holdoff window on platforms whose signal stays
/// asserted while pressure persists (Windows level-triggered handle, Linux PSI
/// re-firing each measurement window). macOS only fires on state transitions
/// so it doesn't need this.
const holdoff_ms: u64 = 30_000;

var installed = std.atomic.Value(bool).init(false);

/// Called from `VirtualMachine.init` once the main-thread VM and its event
/// loop exist. Single-shot; later VMs (workers) skip via `is_main_thread`.
pub fn installOnEventLoop(vm: *jsc.VirtualMachine) void {
    if (!bun.feature_flag.BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER.get()) return;
    if (installed.swap(true, .monotonic)) return;

    Backend.install(vm);
}

/// Called from `VirtualMachine.deinit` for the main-thread VM. Best-effort:
/// process exit will reclaim everything anyway, but this lets the JS-thread
/// `respond()` race against shutdown cleanly.
pub fn uninstall() void {
    if (!installed.swap(false, .monotonic)) return;
    Backend.uninstall();
}

/// Test seam — runs the JS-thread response path directly. Debug builds only.
/// Returns the post-increment `analytics.Features.memory_pressure` count.
pub fn simulate(vm: *jsc.VirtualMachine) usize {
    if (comptime !Environment.isDebug) return 0;
    respond(vm, true);
    return bun.analytics.Features.memory_pressure;
}

/// The platform-agnostic response. Always runs on the JS thread that owns
/// `vm`, so it's safe to touch the JSC heap directly.
fn respond(vm: *jsc.VirtualMachine, critical: bool) void {
    log("memory pressure ({s}); shrinking footprint", .{if (critical) "critical" else "warning"});
    bun.analytics.Features.memory_pressure += 1;
    // Synchronous full collection now — reclaims unreachable JS objects
    // immediately, regardless of whether we're inside an entryScope.
    _ = vm.global.vm().runGC(true);
    // Deferred deeper cleanup: shrinkFootprintWhenIdle() runs `deleteAllCode`
    // (drops JIT'd code) + another sync full GC + releaseFastMallocFreeMemory
    // via VM::whenIdle, i.e. immediately if no JS is on the stack, otherwise
    // when the current entryScope pops.
    vm.global.vm().shrinkFootprint();
    // Return mimalloc free segments to the OS.
    bun.Global.mimalloc_cleanup(critical);
}

const Backend = if (Environment.isWindows)
    Windows
else if (Environment.isMac)
    Darwin
else if (Environment.isLinux)
    Linux
else
    Noop;

const Noop = struct {
    fn install(_: *jsc.VirtualMachine) void {}
    fn uninstall() void {}
};

// ───────────────────────────────────── Windows ──────────────────────────────

const Windows = struct {
    var state: ?*State = null;

    const State = struct {
        notification: w32.HANDLE,
        wait: ?w32.HANDLE = null,
        wake: libuv.uv_async_t,
        rearm: libuv.Timer,
        vm: *jsc.VirtualMachine,
    };

    fn install(vm: *jsc.VirtualMachine) void {
        const notification = win_externs.CreateMemoryResourceNotification(.LowMemoryResourceNotification) orelse {
            log("CreateMemoryResourceNotification failed (err={d})", .{@intFromEnum(w32.GetLastError())});
            return;
        };

        const s = bun.new(State, .{
            .notification = notification,
            .wake = undefined,
            .rearm = undefined,
            .vm = vm,
        });
        state = s;

        s.wake.init(vm.uvLoop(), onWake);
        s.wake.unref();
        s.wake.setData(s);
        s.rearm.init(vm.uvLoop());
        s.rearm.unref();
        s.rearm.data = s;

        if (!arm(s)) {
            // Best-effort: leave the libuv handles up but never armed.
            log("RegisterWaitForSingleObject failed (err={d}); watcher disabled", .{@intFromEnum(w32.GetLastError())});
            return;
        }
        log("installed (RegisterWaitForSingleObject)", .{});
    }

    fn arm(s: *State) bool {
        var wait: w32.HANDLE = undefined;
        const ok = win_externs.RegisterWaitForSingleObject(
            &wait,
            s.notification,
            onLowMemoryThreadpool,
            s,
            w32.INFINITE,
            win_externs.WT_EXECUTEINWAITTHREAD | win_externs.WT_EXECUTEONLYONCE,
        );
        if (ok == 0) return false;
        s.wait = wait;
        return true;
    }

    /// NT threadpool thread. The notification handle is *level*-triggered: it
    /// stays signalled while memory remains low, so we registered ONLYONCE and
    /// re-arm from the JS thread after the holdoff.
    fn onLowMemoryThreadpool(ctx: ?*anyopaque, _: w32.BOOLEAN) callconv(.winapi) void {
        const s: *State = @ptrCast(@alignCast(ctx.?));
        var is_low: w32.BOOL = 0;
        // Spurious wake — re-arm happens from the JS side regardless.
        if (win_externs.QueryMemoryResourceNotification(s.notification, &is_low) != 0 and is_low == 0) return;
        s.wake.send();
    }

    /// JS thread.
    fn onWake(handle: [*c]libuv.uv_async_t) callconv(.c) void {
        const s: *State = @ptrCast(@alignCast(handle.*.data.?));
        // The ONLYONCE wait has self-completed; drop the stale handle now so
        // uninstall() during the holdoff doesn't try to UnregisterWaitEx it.
        s.wait = null;
        respond(s.vm, true);
        s.rearm.start(holdoff_ms, 0, onRearm);
        s.rearm.unref();
    }

    /// JS thread.
    fn onRearm(handle: *libuv.Timer) callconv(.c) void {
        const s: *State = @ptrCast(@alignCast(handle.data.?));
        if (state == null) return; // uninstall() raced
        if (!arm(s)) {
            log("RegisterWaitForSingleObject re-arm failed (err={d}); watcher disabled", .{@intFromEnum(w32.GetLastError())});
        }
    }

    fn uninstall() void {
        const s = state orelse return;
        state = null;
        if (s.wait) |w| {
            // INVALID_HANDLE_VALUE waits for any in-flight callback to drain.
            _ = win_externs.UnregisterWaitEx(w, w32.INVALID_HANDLE_VALUE);
        }
        _ = win_externs.CloseHandle(s.notification);
        s.rearm.stop();
        libuv.uv_close(@ptrCast(&s.rearm), null);
        libuv.uv_close(@ptrCast(&s.wake), onClosed);
    }

    fn onClosed(handle: *anyopaque) callconv(.c) void {
        const h: *libuv.Handle = @ptrCast(@alignCast(handle));
        const s: *State = @ptrCast(@alignCast(h.data.?));
        bun.destroy(s);
    }
};

// ───────────────────────────────────── Darwin ───────────────────────────────

const Darwin = struct {
    var state: ?*State = null;

    const State = struct {
        source: *anyopaque,
        vm: *jsc.VirtualMachine,
        /// Set on the dispatch thread, consumed on the JS thread.
        pending_critical: std.atomic.Value(bool) = .init(true),
    };

    fn install(vm: *jsc.VirtualMachine) void {
        const mask = DISPATCH_MEMORYPRESSURE_WARN | DISPATCH_MEMORYPRESSURE_CRITICAL |
            DISPATCH_MEMORYPRESSURE_PROC_LIMIT_WARN | DISPATCH_MEMORYPRESSURE_PROC_LIMIT_CRITICAL;
        const queue = dispatch_get_global_queue(QOS_CLASS_UTILITY, 0);
        const source = dispatch_source_create(&_dispatch_source_type_memorypressure, 0, mask, queue) orelse {
            log("dispatch_source_create(DISPATCH_SOURCE_TYPE_MEMORYPRESSURE) failed", .{});
            return;
        };
        const s = bun.new(State, .{ .source = source, .vm = vm });
        state = s;
        dispatch_set_context(source, s);
        dispatch_source_set_event_handler_f(source, onPressureDispatch);
        dispatch_resume(source);
        log("installed (DISPATCH_SOURCE_TYPE_MEMORYPRESSURE)", .{});
    }

    /// libdispatch worker thread. The kernel only fires on state
    /// *transitions*, so no holdoff is needed — one task per transition.
    fn onPressureDispatch(ctx: ?*anyopaque) callconv(.c) void {
        const s: *State = @ptrCast(@alignCast(ctx.?));
        const data = dispatch_source_get_data(s.source);
        const critical = (data & (DISPATCH_MEMORYPRESSURE_CRITICAL | DISPATCH_MEMORYPRESSURE_PROC_LIMIT_CRITICAL)) != 0;
        s.pending_critical.store(critical, .monotonic);
        s.vm.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(s, onJSThread));
    }

    /// JS thread.
    fn onJSThread(s: *State) void {
        if (state == null) return; // uninstall() raced
        respond(s.vm, s.pending_critical.load(.monotonic));
    }

    fn uninstall() void {
        const s = state orelse return;
        state = null;
        dispatch_source_cancel(s.source);
        dispatch_release(s.source);
        bun.destroy(s);
    }

    extern "c" const _dispatch_source_type_memorypressure: anyopaque;
    extern "c" fn dispatch_source_create(type: *const anyopaque, handle: usize, mask: c_ulong, queue: ?*anyopaque) ?*anyopaque;
    extern "c" fn dispatch_source_set_event_handler_f(source: *anyopaque, handler: *const fn (?*anyopaque) callconv(.c) void) void;
    extern "c" fn dispatch_set_context(object: *anyopaque, context: ?*anyopaque) void;
    extern "c" fn dispatch_source_get_data(source: *anyopaque) c_ulong;
    extern "c" fn dispatch_get_global_queue(identifier: c_long, flags: c_ulong) *anyopaque;
    extern "c" fn dispatch_resume(object: *anyopaque) void;
    extern "c" fn dispatch_source_cancel(source: *anyopaque) void;
    extern "c" fn dispatch_release(object: *anyopaque) void;
    const DISPATCH_MEMORYPRESSURE_WARN: c_ulong = 0x02;
    const DISPATCH_MEMORYPRESSURE_CRITICAL: c_ulong = 0x04;
    const DISPATCH_MEMORYPRESSURE_PROC_LIMIT_WARN: c_ulong = 0x10;
    const DISPATCH_MEMORYPRESSURE_PROC_LIMIT_CRITICAL: c_ulong = 0x20;
    const QOS_CLASS_UTILITY: c_long = 0x11;
};

// ───────────────────────────────────── Linux ────────────────────────────────

const Linux = struct {
    var state: ?*State = null;

    /// ≥150 ms some-stall in any 1 s window. "some" rather than "full" so we
    /// react before the whole process is blocked on reclaim.
    const trigger = "some 150000 1000000\n";

    const State = struct {
        fd: bun.FD,
        thread: std.Thread,
        vm: *jsc.VirtualMachine,
        shutdown: std.atomic.Value(bool) = .init(false),
    };

    fn install(vm: *jsc.VirtualMachine) void {
        // PSI triggers need O_RDWR | O_NONBLOCK and signal via POLLPRI.
        const fd = switch (bun.sys.open("/proc/pressure/memory", bun.O.RDWR | bun.O.NONBLOCK | bun.O.CLOEXEC, 0)) {
            .result => |fd| fd,
            .err => |err| {
                // ENOENT (no PSI), EACCES (some hardened kernels gate
                // unprivileged triggers), …: best-effort, just skip.
                log("PSI unavailable (open /proc/pressure/memory: {s}); watcher disabled", .{@tagName(err.getErrno())});
                return;
            },
        };
        switch (bun.sys.write(fd, trigger)) {
            .result => {},
            .err => |err| {
                // EOPNOTSUPP (psi=0 cmdline), EBUSY, …
                log("PSI unavailable (write trigger: {s}); watcher disabled", .{@tagName(err.getErrno())});
                fd.close();
                return;
            },
        }

        const s = bun.new(State, .{ .fd = fd, .thread = undefined, .vm = vm });
        state = s;
        s.thread = std.Thread.spawn(.{ .stack_size = 64 * 1024 }, run, .{s}) catch {
            log("PSI watcher thread spawn failed; watcher disabled", .{});
            fd.close();
            bun.destroy(s);
            state = null;
            return;
        };
        log("installed (/proc/pressure/memory PSI)", .{});
    }

    /// Dedicated thread. PSI fires POLLPRI which `Async.FilePoll` doesn't yet
    /// expose, so block in poll() here and post a `ConcurrentTask` to the JS
    /// thread when it does — same off-thread→enqueue shape as macOS/Windows.
    fn run(s: *State) void {
        bun.Output.Source.configureNamedThread("MemoryPressure");
        var fds = [1]std.posix.pollfd{.{ .fd = s.fd.cast(), .events = std.posix.POLL.PRI, .revents = 0 }};
        while (!s.shutdown.load(.monotonic)) {
            const n = std.posix.poll(&fds, -1) catch break;
            if (s.shutdown.load(.monotonic)) break;
            if (n == 0) continue;
            if (fds[0].revents & (std.posix.POLL.ERR | std.posix.POLL.HUP | std.posix.POLL.NVAL) != 0) break;
            if (fds[0].revents & std.posix.POLL.PRI == 0) continue;

            s.vm.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(s, onJSThread));

            // PSI re-fires every measurement window while the stall persists;
            // throttle so we don't sync-GC in a tight loop. Sleep in slices so
            // shutdown is reasonably prompt.
            var slept: u64 = 0;
            while (slept < holdoff_ms and !s.shutdown.load(.monotonic)) : (slept += 200) {
                std.Thread.sleep(200 * std.time.ns_per_ms);
            }
        }
    }

    /// JS thread.
    fn onJSThread(s: *State) void {
        if (state == null) return; // uninstall() raced
        respond(s.vm, true);
    }

    fn uninstall() void {
        const s = state orelse return;
        state = null;
        s.shutdown.store(true, .monotonic);
        // Wake the blocked poll() with POLLERR/POLLNVAL.
        s.fd.close();
        s.thread.join();
        bun.destroy(s);
    }
};

const w32 = if (Environment.isWindows) std.os.windows else struct {};
const libuv = if (Environment.isWindows) bun.windows.libuv else struct {};
const win_externs = if (Environment.isWindows) @import("../windows_sys/externs.zig") else struct {};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
