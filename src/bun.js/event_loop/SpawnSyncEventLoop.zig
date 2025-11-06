//! Isolated event loop for spawnSync operations.
//!
//! This provides a completely separate event loop instance to ensure that:
//! - JavaScript timers don't fire during spawnSync
//! - stdin/stdout from the main process aren't affected
//! - The subprocess runs in complete isolation
//! - We don't recursively run the main event loop
//!
//! Implementation approach:
//! - Creates a separate uws.Loop instance with its own kqueue/epoll fd (POSIX) or libuv loop (Windows)
//! - Wraps it in a full jsc.EventLoop instance
//! - On POSIX: temporarily overrides vm.event_loop_handle to point to isolated loop
//! - On Windows: stores isolated loop pointer in EventLoop.uws_loop
//! - Minimal handler callbacks (wakeup/pre/post are no-ops)
//!
//! Similar to Node.js's approach in vendor/node/src/spawn_sync.cc but adapted for Bun's architecture.

const SpawnSyncEventLoop = @This();

/// Separate JSC EventLoop instance for this spawnSync
/// This is a FULL event loop, not just a handle
event_loop: jsc.EventLoop,

/// Completely separate uws.Loop instance - critical for avoiding recursive event loop execution
uws_loop: *uws.Loop,

/// On POSIX, we need to temporarily override the VM's event_loop_handle
/// Store the original so we can restore it
original_event_loop_handle: if (bun.Environment.isWindows) void else ?*uws.Loop = if (bun.Environment.isWindows) {} else null,

uv_timer: if (bun.Environment.isWindows) ?*bun.windows.libuv.Timer else void = if (bun.Environment.isWindows) null else {},
did_timeout: bool = false,

/// Minimal handler for the isolated loop
const Handler = struct {
    pub fn wakeup(loop: *uws.Loop) callconv(.C) void {
        _ = loop;
        // No-op: we don't need to wake up from another thread for spawnSync
    }

    pub fn pre(loop: *uws.Loop) callconv(.C) void {
        _ = loop;
        // No-op: no pre-tick work needed for spawnSync
    }

    pub fn post(loop: *uws.Loop) callconv(.C) void {
        _ = loop;
        // No-op: no post-tick work needed for spawnSync
    }
};

pub fn init() !*SpawnSyncEventLoop {
    const self = try bun.default_allocator.create(SpawnSyncEventLoop);

    // Create a COMPLETELY SEPARATE uws.Loop for spawnSync
    // This is critical - we cannot use the main loop as that would cause recursive execution
    // This creates a new kqueue/epoll fd (POSIX) or new libuv loop (Windows)
    const loop = uws.Loop.create(Handler);

    self.* = .{
        .event_loop = undefined,
        .uws_loop = loop,
    };

    // Initialize the JSC EventLoop with empty state
    // CRITICAL: On Windows, store our isolated loop pointer
    self.event_loop = .{
        .tasks = jsc.EventLoop.Queue.init(bun.default_allocator),
        .global = undefined, // Will be set when used
        .virtual_machine = undefined, // Will be set when used
        .uws_loop = if (bun.Environment.isWindows) self.uws_loop else {},
    };

    // Set up the loop's internal data to point to this isolated event loop
    self.uws_loop.internal_loop_data.setParentEventLoop(jsc.EventLoopHandle.init(&self.event_loop));

    // Critically: Set jsc_vm to null to prevent JavaScript from running
    self.uws_loop.internal_loop_data.jsc_vm = null;

    return self;
}

fn onCloseUVTimer(timer: *bun.windows.libuv.Timer) callconv(.C) void {
    bun.default_allocator.destroy(timer);
}

pub fn deinit(this: *SpawnSyncEventLoop) void {
    // Clean up tasks queue
    this.event_loop.tasks.deinit();

    if (comptime bun.Environment.isWindows) {
        if (this.uv_timer) |timer| {
            timer.stop();
            timer.unref();
            libuv.uv_close(@alignCast(@ptrCast(&timer)), &onCloseUVTimer);
        }
    }
}

/// Configure the event loop for a specific VM context
pub fn prepare(this: *SpawnSyncEventLoop, vm: *jsc.VirtualMachine) void {
    this.event_loop.global = vm.global;
    this.did_timeout = false;
    this.event_loop.virtual_machine = vm;

    // CRITICAL: On POSIX, temporarily override the VM's event_loop_handle to point to our isolated loop
    // This ensures that when code calls usocketsLoop(), it gets our isolated loop instead of the main one
    // We'll restore this after spawnSync completes
    if (comptime !bun.Environment.isWindows) {
        // Store the original handle so we can restore it later
        this.original_event_loop_handle = vm.event_loop_handle;
        vm.event_loop_handle = this.uws_loop;
    }
}

/// Restore the original event loop handle after spawnSync completes
pub fn cleanup(this: *SpawnSyncEventLoop, vm: *jsc.VirtualMachine, prev_event_loop: *jsc.EventLoop) void {
    if (comptime !bun.Environment.isWindows) {
        if (this.original_event_loop_handle) |orig| {
            vm.event_loop_handle = orig;
        }
    }

    vm.event_loop = prev_event_loop;

    if (bun.Environment.isWindows) {
        if (this.uv_timer) |timer| {
            timer.stop();
            timer.unref();
        }
    }
}

/// Get an EventLoopHandle for this isolated loop
pub fn handle(this: *SpawnSyncEventLoop) jsc.EventLoopHandle {
    return jsc.EventLoopHandle.init(&this.event_loop);
}

fn onUVTimer(timer_: *bun.windows.libuv.Timer) callconv(.C) void {
    const timer: ?*bun.windows.libuv.Timer = @alignCast(@ptrCast(timer_));
    const this: *SpawnSyncEventLoop = @fieldParentPtr("uv_timer", timer);
    this.did_timeout = true;
    this.uws_loop.uv_loop.stop();
}

const TickState = enum { timeout, completed };

fn prepareTimerOnWindows(this: *SpawnSyncEventLoop, ts: *const bun.timespec) void {
    const timer: *bun.windows.libuv.Timer = this.uv_timer orelse brk: {
        const uv_timer: *bun.windows.libuv.Timer = bun.default_allocator.create(bun.windows.libuv.Timer) catch |e| bun.handleOom(e);
        uv_timer.* = std.mem.zeroes(bun.windows.libuv.Timer);
        uv_timer.init(this.uws_loop.uv_loop);
        break :brk uv_timer;
    };

    timer.start(ts.msUnsigned(), 0, &onUVTimer);
    timer.ref();
    this.uv_timer = timer;
}

/// Tick the isolated event loop with an optional timeout
/// This is similar to the main event loop's tick but completely isolated
pub fn tickWithTimeout(this: *SpawnSyncEventLoop, timeout: ?*const bun.timespec) TickState {
    if (bun.Environment.isWindows) {
        if (timeout) |ts| {
            prepareTimerOnWindows(this, ts);
        }
    }

    // Tick the isolated uws loop with the specified timeout
    // This will only process I/O related to this subprocess
    // and will NOT interfere with the main event loop
    this.uws_loop.tickWithTimeout(timeout);

    if (timeout) |ts| {
        if (bun.Environment.isWindows) {
            this.uv_timer.?.unref();
            this.uv_timer.?.stop();
        } else {
            this.did_timeout = bun.timespec.now().order(ts) == .lt;
        }
    }

    this.event_loop.tickWithoutJS();

    const did_timeout = this.did_timeout;
    this.did_timeout = false;

    if (did_timeout) {
        return .timeout;
    }

    return .completed;
}

/// Check if the loop has any active handles
pub fn isActive(this: *const SpawnSyncEventLoop) bool {
    return this.uws_loop.isActive();
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const uws = bun.uws;
const TimerHeap = @import("../api/Timer.zig").TimerHeap;
const libuv = bun.windows.libuv;
