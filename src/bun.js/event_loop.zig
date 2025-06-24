const EventLoop = @This();

tasks: Queue = undefined,

/// setImmediate() gets it's own two task queues
/// When you call `setImmediate` in JS, it queues to the start of the next tick
/// This is confusing, but that is how it works in Node.js.
///
/// So we have two queues:
///   - next_immediate_tasks: tasks that will run on the next tick
///   - immediate_tasks: tasks that will run on the current tick
///
/// Having two queues avoids infinite loops creating by calling `setImmediate` in a `setImmediate` callback.
immediate_tasks: std.ArrayListUnmanaged(*Timer.ImmediateObject) = .{},
next_immediate_tasks: std.ArrayListUnmanaged(*Timer.ImmediateObject) = .{},

concurrent_tasks: ConcurrentTask.Queue = ConcurrentTask.Queue{},
global: *JSC.JSGlobalObject = undefined,
virtual_machine: *VirtualMachine = undefined,
waker: ?Waker = null,
forever_timer: ?*uws.Timer = null,
deferred_tasks: DeferredTaskQueue = .{},
uws_loop: if (Environment.isWindows) ?*uws.Loop else void = if (Environment.isWindows) null,

debug: Debug = .{},
entered_event_loop_count: isize = 0,
concurrent_ref: std.atomic.Value(i32) = std.atomic.Value(i32).init(0),
imminent_gc_timer: std.atomic.Value(?*Timer.WTFTimer) = .{ .raw = null },

signal_handler: if (Environment.isPosix) ?*PosixSignalHandle else void = if (Environment.isPosix) null,

pub const Debug = if (Environment.isDebug) struct {
    is_inside_tick_queue: bool = false,
    js_call_count_outside_tick_queue: usize = 0,
    drain_microtasks_count_outside_tick_queue: usize = 0,
    _prev_is_inside_tick_queue: bool = false,
    last_fn_name: bun.String = bun.String.empty,
    track_last_fn_name: bool = false,

    pub fn enter(this: *Debug) void {
        this._prev_is_inside_tick_queue = this.is_inside_tick_queue;
        this.is_inside_tick_queue = true;
        this.js_call_count_outside_tick_queue = 0;
        this.drain_microtasks_count_outside_tick_queue = 0;
    }

    pub fn exit(this: *Debug) void {
        this.is_inside_tick_queue = this._prev_is_inside_tick_queue;
        this._prev_is_inside_tick_queue = false;
        this.js_call_count_outside_tick_queue = 0;
        this.drain_microtasks_count_outside_tick_queue = 0;
        this.last_fn_name.deref();
        this.last_fn_name = bun.String.empty;
    }
} else struct {
    pub inline fn enter(_: Debug) void {}
    pub inline fn exit(_: Debug) void {}
};

pub fn enter(this: *EventLoop) void {
    log("enter() = {d}", .{this.entered_event_loop_count});
    this.entered_event_loop_count += 1;
    this.debug.enter();
}

pub fn exit(this: *EventLoop) void {
    const count = this.entered_event_loop_count;
    log("exit() = {d}", .{count - 1});

    defer this.debug.exit();

    if (count == 1 and !this.virtual_machine.is_inside_deferred_task_queue) {
        this.drainMicrotasksWithGlobal(this.global, this.virtual_machine.jsc) catch {};
    }

    this.entered_event_loop_count -= 1;
}

pub fn exitMaybeDrainMicrotasks(this: *EventLoop, allow_drain_microtask: bool) bun.JSExecutionTerminated!void {
    const count = this.entered_event_loop_count;
    log("exit() = {d}", .{count - 1});

    defer this.debug.exit();

    if (allow_drain_microtask and count == 1 and !this.virtual_machine.is_inside_deferred_task_queue) {
        try this.drainMicrotasksWithGlobal(this.global, this.virtual_machine.jsc);
    }

    this.entered_event_loop_count -= 1;
}

pub inline fn getVmImpl(this: *EventLoop) *VirtualMachine {
    return this.virtual_machine;
}

pub fn pipeReadBuffer(this: *const EventLoop) []u8 {
    return this.virtual_machine.rareData().pipeReadBuffer();
}

pub const Queue = std.fifo.LinearFifo(Task, .Dynamic);
const log = bun.Output.scoped(.EventLoop, false);

pub fn tickWhilePaused(this: *EventLoop, done: *bool) void {
    while (!done.*) {
        this.virtual_machine.event_loop_handle.?.tick();
    }
}

extern fn JSC__JSGlobalObject__drainMicrotasks(*JSC.JSGlobalObject) void;
pub fn drainMicrotasksWithGlobal(this: *EventLoop, globalObject: *JSC.JSGlobalObject, jsc_vm: *JSC.VM) bun.JSExecutionTerminated!void {
    JSC.markBinding(@src());
    var scope: JSC.CatchScope = undefined;
    scope.init(globalObject, @src(), .enabled);
    defer scope.deinit();

    jsc_vm.releaseWeakRefs();
    JSC__JSGlobalObject__drainMicrotasks(globalObject);
    try scope.assertNoExceptionExceptTermination();

    this.virtual_machine.is_inside_deferred_task_queue = true;
    this.deferred_tasks.run();
    this.virtual_machine.is_inside_deferred_task_queue = false;

    if (comptime bun.Environment.isDebug) {
        this.debug.drain_microtasks_count_outside_tick_queue += @as(usize, @intFromBool(!this.debug.is_inside_tick_queue));
    }
}

pub fn drainMicrotasks(this: *EventLoop) bun.JSExecutionTerminated!void {
    try this.drainMicrotasksWithGlobal(this.global, this.virtual_machine.jsc);
}

// should be called after exit()
pub fn maybeDrainMicrotasks(this: *EventLoop) void {
    if (this.entered_event_loop_count == 0 and !this.virtual_machine.is_inside_deferred_task_queue) {
        this.drainMicrotasksWithGlobal(this.global, this.virtual_machine.jsc) catch {};
    }
}

/// When you call a JavaScript function from outside the event loop task
/// queue
///
/// It has to be wrapped in `runCallback` to ensure that microtasks are
/// drained and errors are handled.
///
/// Otherwise, you will risk a large number of microtasks being queued and
/// not being drained, which can lead to catastrophic memory usage and
/// application slowdown.
pub fn runCallback(this: *EventLoop, callback: JSC.JSValue, globalObject: *JSC.JSGlobalObject, thisValue: JSC.JSValue, arguments: []const JSC.JSValue) void {
    this.enter();
    defer this.exit();
    _ = callback.call(globalObject, thisValue, arguments) catch |err|
        globalObject.reportActiveExceptionAsUnhandled(err);
}

fn externRunCallback1(global: *JSC.JSGlobalObject, callback: JSC.JSValue, thisValue: JSC.JSValue, arg0: JSC.JSValue) callconv(.c) void {
    const vm = global.bunVM();
    var loop = vm.eventLoop();
    loop.runCallback(callback, global, thisValue, &.{arg0});
}

fn externRunCallback2(global: *JSC.JSGlobalObject, callback: JSC.JSValue, thisValue: JSC.JSValue, arg0: JSC.JSValue, arg1: JSC.JSValue) callconv(.c) void {
    const vm = global.bunVM();
    var loop = vm.eventLoop();
    loop.runCallback(callback, global, thisValue, &.{ arg0, arg1 });
}

fn externRunCallback3(global: *JSC.JSGlobalObject, callback: JSC.JSValue, thisValue: JSC.JSValue, arg0: JSC.JSValue, arg1: JSC.JSValue, arg2: JSC.JSValue) callconv(.c) void {
    const vm = global.bunVM();
    var loop = vm.eventLoop();
    loop.runCallback(callback, global, thisValue, &.{ arg0, arg1, arg2 });
}

comptime {
    @export(&externRunCallback1, .{ .name = "Bun__EventLoop__runCallback1" });
    @export(&externRunCallback2, .{ .name = "Bun__EventLoop__runCallback2" });
    @export(&externRunCallback3, .{ .name = "Bun__EventLoop__runCallback3" });
}

pub fn runCallbackWithResult(this: *EventLoop, callback: JSC.JSValue, globalObject: *JSC.JSGlobalObject, thisValue: JSC.JSValue, arguments: []const JSC.JSValue) JSC.JSValue {
    this.enter();
    defer this.exit();

    const result = callback.call(globalObject, thisValue, arguments) catch |err| {
        globalObject.reportActiveExceptionAsUnhandled(err);
        return .zero;
    };
    return result;
}

const tickQueueWithCount = @import("./event_loop/Task.zig").tickQueueWithCount;

fn tickWithCount(this: *EventLoop, virtual_machine: *VirtualMachine) u32 {
    return this.tickQueueWithCount(virtual_machine);
}

pub fn tickImmediateTasks(this: *EventLoop, virtual_machine: *VirtualMachine) void {
    var to_run_now = this.immediate_tasks;

    this.immediate_tasks = this.next_immediate_tasks;
    this.next_immediate_tasks = .{};

    var exception_thrown = false;
    for (to_run_now.items) |task| {
        exception_thrown = task.runImmediateTask(virtual_machine);
    }

    // make sure microtasks are drained if the last task had an exception
    if (exception_thrown) {
        this.maybeDrainMicrotasks();
    }

    if (this.next_immediate_tasks.capacity > 0) {
        // this would only occur if we were recursively running tickImmediateTasks.
        @branchHint(.unlikely);
        this.immediate_tasks.appendSlice(bun.default_allocator, this.next_immediate_tasks.items) catch bun.outOfMemory();
        this.next_immediate_tasks.deinit(bun.default_allocator);
    }

    if (to_run_now.capacity > 1024 * 128) {
        // once in a while, deinit the array to free up memory
        to_run_now.clearAndFree(bun.default_allocator);
    } else {
        to_run_now.clearRetainingCapacity();
    }

    this.next_immediate_tasks = to_run_now;
}

fn tickConcurrent(this: *EventLoop) void {
    _ = this.tickConcurrentWithCount();
}

/// Check whether refConcurrently has been called but the change has not yet been applied to the
/// underlying event loop's `active` counter
pub fn hasPendingRefs(this: *const EventLoop) bool {
    return this.concurrent_ref.load(.seq_cst) > 0;
}

fn updateCounts(this: *EventLoop) void {
    const delta = this.concurrent_ref.swap(0, .seq_cst);
    const loop = this.virtual_machine.event_loop_handle.?;
    if (comptime Environment.isWindows) {
        if (delta > 0) {
            loop.active_handles += @intCast(delta);
        } else {
            loop.active_handles -= @intCast(-delta);
        }
    } else {
        if (delta > 0) {
            loop.num_polls += @intCast(delta);
            loop.active += @intCast(delta);
        } else {
            loop.num_polls -= @intCast(-delta);
            loop.active -= @intCast(-delta);
        }
    }
}

pub fn runImminentGCTimer(this: *EventLoop) void {
    if (this.imminent_gc_timer.swap(null, .seq_cst)) |timer| {
        timer.run(this.virtual_machine);
    }
}

pub fn tickConcurrentWithCount(this: *EventLoop) usize {
    this.updateCounts();

    if (comptime Environment.isPosix) {
        if (this.signal_handler) |signal_handler| {
            signal_handler.drain(this);
        }
    }

    this.runImminentGCTimer();

    var concurrent = this.concurrent_tasks.popBatch();
    const count = concurrent.count;
    if (count == 0)
        return 0;

    var iter = concurrent.iterator();
    const start_count = this.tasks.count;
    if (start_count == 0) {
        this.tasks.head = 0;
    }

    this.tasks.ensureUnusedCapacity(count) catch unreachable;
    var writable = this.tasks.writableSlice(0);

    // Defer destruction of the ConcurrentTask to avoid issues with pointer aliasing
    var to_destroy: ?*ConcurrentTask = null;

    while (iter.next()) |task| {
        if (to_destroy) |dest| {
            to_destroy = null;
            dest.deinit();
        }

        if (task.auto_delete) {
            to_destroy = task;
        }

        writable[0] = task.task;
        writable = writable[1..];
        this.tasks.count += 1;
        if (writable.len == 0) break;
    }

    if (to_destroy) |dest| {
        dest.deinit();
    }

    return this.tasks.count - start_count;
}

pub inline fn usocketsLoop(this: *const EventLoop) *uws.Loop {
    if (comptime Environment.isWindows) {
        return this.uws_loop.?;
    }

    return this.virtual_machine.event_loop_handle.?;
}

pub fn autoTick(this: *EventLoop) void {
    var loop = this.usocketsLoop();
    var ctx = this.virtual_machine;

    this.tickImmediateTasks(ctx);
    if (comptime Environment.isPosix) {
        if (this.immediate_tasks.items.len > 0) {
            this.wakeup();
        }
    }

    if (comptime Environment.isPosix) {
        // Some tasks need to keep the event loop alive for one more tick.
        // We want to keep the event loop alive long enough to process those ticks and any microtasks
        //
        // BUT. We don't actually have an idle event in that case.
        // That means the process will be waiting forever on nothing.
        // So we need to drain the counter immediately before entering uSockets loop
        const pending_unref = ctx.pending_unref_counter;
        if (pending_unref > 0) {
            ctx.pending_unref_counter = 0;
            loop.unrefCount(pending_unref);
        }
    }

    this.runImminentGCTimer();

    if (loop.isActive()) {
        this.processGCTimer();
        var event_loop_sleep_timer = if (comptime Environment.isDebug) std.time.Timer.start() catch unreachable;
        // for the printer, this is defined:
        var timespec: bun.timespec = if (Environment.isDebug) .{ .sec = 0, .nsec = 0 } else undefined;
        loop.tickWithTimeout(if (ctx.timer.getTimeout(&timespec, ctx)) &timespec else null);

        if (comptime Environment.isDebug) {
            log("tick {}, timeout: {}", .{ std.fmt.fmtDuration(event_loop_sleep_timer.read()), std.fmt.fmtDuration(timespec.ns()) });
        }
    } else {
        loop.tickWithoutIdle();
        if (comptime Environment.isDebug) {
            log("tickWithoutIdle", .{});
        }
    }

    if (Environment.isPosix) {
        ctx.timer.drainTimers(ctx);
    }

    ctx.onAfterEventLoop();
    this.global.handleRejectedPromises();
}

pub fn tickPossiblyForever(this: *EventLoop) void {
    var ctx = this.virtual_machine;
    var loop = this.usocketsLoop();

    if (comptime Environment.isPosix) {
        const pending_unref = ctx.pending_unref_counter;
        if (pending_unref > 0) {
            ctx.pending_unref_counter = 0;
            loop.unrefCount(pending_unref);
        }
    }

    if (!loop.isActive()) {
        if (this.forever_timer == null) {
            var t = uws.Timer.create(loop, this);
            t.set(this, &noopForeverTimer, 1000 * 60 * 4, 1000 * 60 * 4);
            this.forever_timer = t;
        }
    }

    this.processGCTimer();
    this.processGCTimer();
    loop.tick();

    ctx.onAfterEventLoop();
    this.tickConcurrent();
    this.tick();
}

fn noopForeverTimer(_: *uws.Timer) callconv(.C) void {
    // do nothing
}

pub fn autoTickActive(this: *EventLoop) void {
    var loop = this.usocketsLoop();
    var ctx = this.virtual_machine;

    this.tickImmediateTasks(ctx);
    if (comptime Environment.isPosix) {
        if (this.immediate_tasks.items.len > 0) {
            this.wakeup();
        }
    }

    if (comptime Environment.isPosix) {
        const pending_unref = ctx.pending_unref_counter;
        if (pending_unref > 0) {
            ctx.pending_unref_counter = 0;
            loop.unrefCount(pending_unref);
        }
    }

    if (loop.isActive()) {
        this.processGCTimer();
        var timespec: bun.timespec = undefined;

        loop.tickWithTimeout(if (ctx.timer.getTimeout(&timespec, ctx)) &timespec else null);
    } else {
        loop.tickWithoutIdle();
    }

    if (Environment.isPosix) {
        ctx.timer.drainTimers(ctx);
    }

    ctx.onAfterEventLoop();
}

pub fn processGCTimer(this: *EventLoop) void {
    this.virtual_machine.gc_controller.processGCTimer();
}

pub fn tick(this: *EventLoop) void {
    JSC.markBinding(@src());
    var scope: JSC.CatchScope = undefined;
    scope.init(this.global, @src(), .enabled);
    defer scope.deinit();
    this.entered_event_loop_count += 1;
    this.debug.enter();
    defer {
        this.entered_event_loop_count -= 1;
        this.debug.exit();
    }

    const ctx = this.virtual_machine;
    this.tickConcurrent();
    this.processGCTimer();

    const global = ctx.global;
    const global_vm = ctx.jsc;

    while (true) {
        while (this.tickWithCount(ctx) > 0) : (this.global.handleRejectedPromises()) {
            this.tickConcurrent();
        } else {
            this.drainMicrotasksWithGlobal(global, global_vm) catch return;
            if (scope.hasException()) return;
            this.tickConcurrent();
            if (this.tasks.count > 0) continue;
        }
        break;
    }

    while (this.tickWithCount(ctx) > 0) {
        this.tickConcurrent();
    }

    this.global.handleRejectedPromises();
}

pub fn waitForPromise(this: *EventLoop, promise: JSC.AnyPromise) void {
    const jsc_vm = this.virtual_machine.jsc;
    switch (promise.status(jsc_vm)) {
        .pending => {
            while (promise.status(jsc_vm) == .pending) {
                this.tick();

                if (promise.status(jsc_vm) == .pending) {
                    this.autoTick();
                }
            }
        },
        else => {},
    }
}

pub fn waitForPromiseWithTermination(this: *EventLoop, promise: JSC.AnyPromise) void {
    const worker = this.virtual_machine.worker orelse @panic("EventLoop.waitForPromiseWithTermination: worker is not initialized");
    const jsc_vm = this.virtual_machine.jsc;
    switch (promise.status(jsc_vm)) {
        .pending => {
            while (!worker.hasRequestedTerminate() and promise.status(jsc_vm) == .pending) {
                this.tick();

                if (!worker.hasRequestedTerminate() and promise.status(jsc_vm) == .pending) {
                    this.autoTick();
                }
            }
        },
        else => {},
    }
}

pub fn enqueueTask(this: *EventLoop, task: Task) void {
    this.tasks.writeItem(task) catch unreachable;
}

pub fn enqueueImmediateTask(this: *EventLoop, task: *Timer.ImmediateObject) void {
    this.immediate_tasks.append(bun.default_allocator, task) catch bun.outOfMemory();
}

pub fn enqueueTaskWithTimeout(this: *EventLoop, task: Task, timeout: i32) void {
    // TODO: make this more efficient!
    const loop = this.virtual_machine.uwsLoop();
    var timer = uws.Timer.createFallthrough(loop, task.ptr());
    timer.set(task.ptr(), callTask, timeout, 0);
}

pub fn callTask(timer: *uws.Timer) callconv(.C) void {
    const task = Task.from(timer.as(*anyopaque));
    defer timer.deinit(true);

    VirtualMachine.get().enqueueTask(task);
}

pub fn ensureWaker(this: *EventLoop) void {
    JSC.markBinding(@src());
    if (this.virtual_machine.event_loop_handle == null) {
        if (comptime Environment.isWindows) {
            this.uws_loop = bun.uws.Loop.get();
            this.virtual_machine.event_loop_handle = Async.Loop.get();
        } else {
            this.virtual_machine.event_loop_handle = bun.Async.Loop.get();
        }

        this.virtual_machine.gc_controller.init(this.virtual_machine);
        // _ = actual.addPostHandler(*JSC.EventLoop, this, JSC.EventLoop.afterUSocketsTick);
        // _ = actual.addPreHandler(*JSC.VM, this.virtual_machine.jsc, JSC.VM.drainMicrotasks);
    }
    bun.uws.Loop.get().internal_loop_data.setParentEventLoop(bun.JSC.EventLoopHandle.init(this));
}

/// Asynchronously run the garbage collector and track how much memory is now allocated
pub fn performGC(this: *EventLoop) void {
    this.virtual_machine.gc_controller.performGC();
}

pub fn wakeup(this: *EventLoop) void {
    if (comptime Environment.isWindows) {
        if (this.uws_loop) |loop| {
            loop.wakeup();
        }
        return;
    }

    if (this.virtual_machine.event_loop_handle) |loop| {
        loop.wakeup();
    }
}
pub fn enqueueTaskConcurrent(this: *EventLoop, task: *ConcurrentTask) void {
    if (comptime Environment.allow_assert) {
        if (this.virtual_machine.has_terminated) {
            @panic("EventLoop.enqueueTaskConcurrent: VM has terminated");
        }
    }

    if (comptime Environment.isDebug) {
        log("enqueueTaskConcurrent({s})", .{task.task.typeName() orelse "[unknown]"});
    }

    this.concurrent_tasks.push(task);
    this.wakeup();
}

pub fn enqueueTaskConcurrentBatch(this: *EventLoop, batch: ConcurrentTask.Queue.Batch) void {
    if (comptime Environment.allow_assert) {
        if (this.virtual_machine.has_terminated) {
            @panic("EventLoop.enqueueTaskConcurrent: VM has terminated");
        }
    }

    if (comptime Environment.isDebug) {
        log("enqueueTaskConcurrentBatch({d})", .{batch.count});
    }

    this.concurrent_tasks.pushBatch(batch.front.?, batch.last.?, batch.count);
    this.wakeup();
}

pub fn refConcurrently(this: *EventLoop) void {
    _ = this.concurrent_ref.fetchAdd(1, .seq_cst);
    this.wakeup();
}

pub fn unrefConcurrently(this: *EventLoop) void {
    // TODO maybe this should be AcquireRelease
    _ = this.concurrent_ref.fetchSub(1, .seq_cst);
    this.wakeup();
}

pub const AnyEventLoop = @import("./event_loop/AnyEventLoop.zig").AnyEventLoop;
pub const ConcurrentPromiseTask = @import("./event_loop/ConcurrentPromiseTask.zig").ConcurrentPromiseTask;
pub const WorkTask = @import("./event_loop/WorkTask.zig").WorkTask;
pub const AnyTask = @import("./event_loop/AnyTask.zig");
pub const ManagedTask = @import("./event_loop/ManagedTask.zig");
pub const AnyTaskWithExtraContext = @import("./event_loop/AnyTaskWithExtraContext.zig");
pub const CppTask = @import("./event_loop/CppTask.zig").CppTask;
pub const ConcurrentCppTask = @import("./event_loop/CppTask.zig").ConcurrentCppTask;
pub const JSCScheduler = @import("./event_loop/JSCScheduler.zig");
pub const Task = @import("./event_loop/Task.zig").Task;
pub const ConcurrentTask = @import("./event_loop/ConcurrentTask.zig");
pub const GarbageCollectionController = @import("./event_loop/GarbageCollectionController.zig");
pub const DeferredTaskQueue = @import("./event_loop/DeferredTaskQueue.zig");
pub const DeferredRepeatingTask = DeferredTaskQueue.DeferredRepeatingTask;
pub const PosixSignalHandle = @import("./event_loop/PosixSignalHandle.zig");
pub const PosixSignalTask = PosixSignalHandle.PosixSignalTask;
pub const MiniEventLoop = @import("./event_loop/MiniEventLoop.zig");
pub const MiniVM = MiniEventLoop.MiniVM;
pub const JsVM = MiniEventLoop.JsVM;
pub const EventLoopKind = MiniEventLoop.EventLoopKind;
pub const AbstractVM = MiniEventLoop.AbstractVM;

pub const EventLoopHandle = @import("./event_loop/EventLoopHandle.zig").EventLoopHandle;
pub const EventLoopTask = @import("./event_loop/EventLoopHandle.zig").EventLoopTask;
pub const EventLoopTaskPtr = @import("./event_loop/EventLoopHandle.zig").EventLoopTaskPtr;

pub const WorkPool = @import("../work_pool.zig").WorkPool;
pub const WorkPoolTask = @import("../work_pool.zig").Task;

const Timer = bun.api.Timer;
const std = @import("std");
const JSC = bun.JSC;
const VirtualMachine = bun.JSC.VirtualMachine;
const bun = @import("bun");
const Environment = bun.Environment;
const Waker = bun.Async.Waker;
const uws = bun.uws;
const Async = bun.Async;
