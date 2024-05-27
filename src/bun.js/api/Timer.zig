const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Debugger = JSC.Debugger;
const Environment = bun.Environment;
const Async = @import("async");
const uv = bun.windows.libuv;
const Timer = @This();

last_id: i32 = 1,
warned: bool = false,

// We split up the map here to avoid storing an extra "repeat" boolean
maps: struct {
    setTimeout: TimeoutMap = .{},
    setInterval: TimeoutMap = .{},
    setImmediate: TimeoutMap = .{},

    pub inline fn get(this: *@This(), kind: Timeout.Kind) *TimeoutMap {
        return switch (kind) {
            .setTimeout => &this.setTimeout,
            .setInterval => &this.setInterval,
            .setImmediate => &this.setImmediate,
        };
    }
} = .{},

/// TimeoutMap is map of i32 to nullable Timeout structs
/// i32 is exposed to JavaScript and can be used with clearTimeout, clearInterval, etc.
/// When Timeout is null, it means the tasks have been scheduled but not yet executed.
/// Timeouts are enqueued as a task to be run on the next tick of the task queue
/// The task queue runs after the event loop tasks have been run
/// Therefore, there is a race condition where you cancel the task after it has already been enqueued
/// In that case, it shouldn't run. It should be skipped.
pub const TimeoutMap = std.AutoArrayHashMapUnmanaged(
    i32,
    ?Timeout,
);

pub fn getNextID() callconv(.C) i32 {
    VirtualMachine.get().timer.last_id +%= 1;
    return VirtualMachine.get().timer.last_id;
}

const uws = bun.uws;

// TODO: reference count to avoid multiple Strong references to the same
// object in setInterval
const CallbackJob = struct {
    id: i32 = 0,
    task: JSC.AnyTask = undefined,
    ref: JSC.Ref = JSC.Ref.init(),
    globalThis: *JSC.JSGlobalObject,
    callback: JSC.Strong = .{},
    arguments: JSC.Strong = .{},
    kind: Timeout.Kind = .setTimeout,

    pub const Task = JSC.AnyTask.New(CallbackJob, perform);

    pub export fn CallbackJob__onResolve(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callframe.arguments(2);
        if (args.len < 2) {
            return JSValue.jsUndefined();
        }

        var this = args.ptr[1].asPtr(CallbackJob);
        this.deinit();
        return JSValue.jsUndefined();
    }

    pub export fn CallbackJob__onReject(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callframe.arguments(2);
        if (args.len < 2) {
            return JSValue.jsUndefined();
        }

        var this = args.ptr[1].asPtr(CallbackJob);
        _ = globalThis.bunVM().uncaughtException(globalThis, args.ptr[0], true);
        this.deinit();
        return JSValue.jsUndefined();
    }

    pub fn deinit(this: *CallbackJob) void {
        this.callback.deinit();
        this.arguments.deinit();
        this.ref.unref(this.globalThis.bunVM());
        bun.default_allocator.destroy(this);
    }

    pub fn perform(this: *CallbackJob) void {
        var globalThis = this.globalThis;
        var vm = globalThis.bunVM();
        const kind = this.kind;
        var map: *TimeoutMap = vm.timer.maps.get(kind);

        const should_cancel_job = brk: {
            // This doesn't deinit the timer
            // Timers are deinit'd separately
            // We do need to handle when the timer is cancelled after the job has been enqueued
            if (kind != .setInterval) {
                if (map.get(this.id)) |tombstone_or_timer| {
                    break :brk tombstone_or_timer != null;
                } else {
                    // clearTimeout has been called
                    break :brk true;
                }
            } else {
                if (map.getPtr(this.id)) |tombstone_or_timer| {
                    // Disable thundering herd of setInterval() calls
                    if (tombstone_or_timer.* != null) {
                        tombstone_or_timer.*.?.has_scheduled_job = false;
                    }

                    // .refresh() was called after CallbackJob enqueued
                    break :brk tombstone_or_timer.* == null;
                }
            }

            break :brk false;
        };

        if (should_cancel_job) {
            if (vm.isInspectorEnabled()) {
                Debugger.didCancelAsyncCall(globalThis, .DOMTimer, Timeout.ID.asyncID(.{ .id = this.id, .kind = kind }));
            }
            this.deinit();
            return;
        } else if (kind != .setInterval) {
            _ = map.swapRemove(this.id);
        }

        var args_buf: [8]JSC.JSValue = undefined;
        var args: []JSC.JSValue = &.{};
        var args_needs_deinit = false;
        defer if (args_needs_deinit) bun.default_allocator.free(args);

        const callback = this.callback.get() orelse @panic("Expected CallbackJob to have a callback function");

        if (this.arguments.trySwap()) |arguments| {
            // Bun.sleep passes a Promise
            if (arguments.jsType() == .JSPromise) {
                args_buf[0] = arguments;
                args = args_buf[0..1];
            } else {
                const count = arguments.getLength(globalThis);
                if (count > 0) {
                    if (count > args_buf.len) {
                        args = bun.default_allocator.alloc(JSC.JSValue, count) catch unreachable;
                        args_needs_deinit = true;
                    } else {
                        args = args_buf[0..count];
                    }
                    for (args, 0..) |*arg, i| {
                        arg.* = JSC.JSObject.getIndex(arguments, globalThis, @as(u32, @truncate(i)));
                    }
                }
            }
        }

        if (vm.isInspectorEnabled()) {
            Debugger.willDispatchAsyncCall(globalThis, .DOMTimer, Timeout.ID.asyncID(.{ .id = this.id, .kind = kind }));
        }
        vm.eventLoop().enter();
        defer vm.eventLoop().exit();
        const result = callback.callWithGlobalThis(
            globalThis,
            args,
        );

        if (vm.isInspectorEnabled()) {
            Debugger.didDispatchAsyncCall(globalThis, .DOMTimer, Timeout.ID.asyncID(.{ .id = this.id, .kind = kind }));
        }

        if (result.isEmptyOrUndefinedOrNull() or !result.isCell()) {
            this.deinit();
            return;
        }

        if (result.isAnyError()) {
            _ = vm.uncaughtException(globalThis, result, false);
            this.deinit();
            return;
        }

        this.deinit();
    }
};

pub const TimerObject = struct {
    id: i32 = -1,
    kind: Timeout.Kind = .setTimeout,
    ref_count: u16 = 1,
    interval: i32 = 0,
    // we do not allow the timer to be refreshed after we call clearInterval/clearTimeout
    has_cleaned_up: bool = false,

    pub usingnamespace JSC.Codegen.JSTimeout;

    pub fn init(globalThis: *JSGlobalObject, id: i32, kind: Timeout.Kind, interval: i32, callback: JSValue, arguments: JSValue) JSValue {
        var timer = globalThis.allocator().create(TimerObject) catch unreachable;
        timer.* = .{
            .id = id,
            .kind = kind,
            .interval = interval,
        };
        var timer_js = timer.toJS(globalThis);
        timer_js.ensureStillAlive();
        TimerObject.argumentsSetCached(timer_js, globalThis, arguments);
        TimerObject.callbackSetCached(timer_js, globalThis, callback);
        timer_js.ensureStillAlive();
        return timer_js;
    }

    pub fn doRef(this: *TimerObject, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const this_value = callframe.this();
        this_value.ensureStillAlive();
        if (this.ref_count > 0)
            this.ref_count +|= 1;

        var vm = globalObject.bunVM();
        switch (this.kind) {
            .setTimeout, .setImmediate, .setInterval => {
                if (vm.timer.maps.get(this.kind).getPtr(this.id)) |val_| {
                    if (val_.*) |*val| {
                        val.poll_ref.ref(vm);

                        if (val.did_unref_timer) {
                            val.did_unref_timer = false;
                            if (comptime Environment.isPosix)
                                vm.event_loop_handle.?.num_polls += 1;
                        }
                    }
                }
            },
        }

        return this_value;
    }

    pub fn doRefresh(this: *TimerObject, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        // TODO: this is not the optimal way to do this but it works, we should revisit this and optimize it
        // like truly resetting the timer instead of removing and re-adding when possible
        const this_value = callframe.this();

        // setImmediate does not support refreshing and we do not support refreshing after cleanup
        if (this.has_cleaned_up or this.id == -1 or this.kind == .setImmediate) {
            return JSValue.jsUndefined();
        }
        const vm = globalThis.bunVM();
        var map = vm.timer.maps.get(this.kind);

        // reschedule the event
        if (TimerObject.callbackGetCached(this_value)) |callback| {
            callback.ensureStillAlive();

            const id: Timeout.ID = .{
                .id = this.id,
                .kind = this.kind,
            };

            if (this.kind == .setTimeout and this.interval == 0) {
                var cb: CallbackJob = .{
                    .callback = JSC.Strong.create(callback, globalThis),
                    .globalThis = globalThis,
                    .id = this.id,
                    .kind = this.kind,
                };

                if (TimerObject.argumentsGetCached(this_value)) |arguments| {
                    arguments.ensureStillAlive();
                    cb.arguments = JSC.Strong.create(arguments, globalThis);
                }

                var job = vm.allocator.create(CallbackJob) catch @panic(
                    "Out of memory while allocating Timeout",
                );

                job.* = cb;
                job.task = CallbackJob.Task.init(job);
                job.ref.ref(vm);

                // cancel the current event if exists before re-adding it
                if (map.fetchSwapRemove(this.id)) |timer| {
                    if (timer.value != null) {
                        var value = timer.value.?;
                        value.deinit();
                    }
                }

                vm.enqueueTask(JSC.Task.init(&job.task));
                if (vm.isInspectorEnabled()) {
                    Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, id.asyncID(), true);
                }

                map.put(vm.allocator, this.id, null) catch unreachable;
                return this_value;
            }

            var timeout = Timeout{
                .callback = JSC.Strong.create(callback, globalThis),
                .globalThis = globalThis,
                .timer = Timeout.TimerReference.create(
                    vm.eventLoop(),
                    id,
                ),
            };

            if (TimerObject.argumentsGetCached(this_value)) |arguments| {
                arguments.ensureStillAlive();
                timeout.arguments = JSC.Strong.create(arguments, globalThis);
            }
            timeout.timer.?.interval = this.interval;

            timeout.poll_ref.ref(vm);

            // cancel the current event if exists before re-adding it
            if (map.fetchSwapRemove(this.id)) |timer| {
                if (timer.value != null) {
                    var value = timer.value.?;
                    value.deinit();
                }
            }

            map.put(vm.allocator, this.id, timeout) catch unreachable;

            timeout.timer.?.schedule(this.interval);
            return this_value;
        }
        return JSValue.jsUndefined();
    }

    pub fn doUnref(this: *TimerObject, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const this_value = callframe.this();
        this_value.ensureStillAlive();
        this.ref_count -|= 1;
        var vm = globalObject.bunVM();
        switch (this.kind) {
            .setTimeout, .setImmediate, .setInterval => {
                if (vm.timer.maps.get(this.kind).getPtr(this.id)) |val_| {
                    if (val_.*) |*val| {
                        val.poll_ref.unref(vm);

                        if (!val.did_unref_timer) {
                            val.did_unref_timer = true;
                            if (comptime Environment.isPosix)
                                vm.event_loop_handle.?.num_polls -= 1;
                        }
                    }
                }
            },
        }

        return this_value;
    }
    pub fn hasRef(this: *TimerObject, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        return JSValue.jsBoolean(this.ref_count > 0 and globalObject.bunVM().timer.maps.get(this.kind).contains(this.id));
    }
    pub fn toPrimitive(this: *TimerObject, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        return JSValue.jsNumber(this.id);
    }

    pub fn markHasClear(this: *TimerObject) void {
        this.has_cleaned_up = true;
    }

    pub fn finalize(this: *TimerObject) callconv(.C) void {
        bun.default_allocator.destroy(this);
    }
};

pub const Timeout = struct {
    callback: JSC.Strong = .{},
    globalThis: *JSC.JSGlobalObject,
    timer: ?*TimerReference = null,
    did_unref_timer: bool = false,
    poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
    arguments: JSC.Strong = .{},
    has_scheduled_job: bool = false,
    pub const TimerReference = struct {
        id: ID = .{ .id = 0 },
        cancelled: bool = false,

        event_loop: *JSC.EventLoop,
        timer: if (Environment.isWindows) uv.uv_timer_t else bun.io.Timer = if (Environment.isWindows) std.mem.zeroes(uv.uv_timer_t) else .{
            .tag = .TimerReference,
            .next = std.mem.zeroes(std.os.timespec),
        },
        request: if (Environment.isWindows) u0 else bun.io.Request = if (Environment.isWindows) 0 else .{
            .callback = &onRequest,
        },
        interval: i32 = -1,
        concurrent_task: JSC.ConcurrentTask = undefined,
        scheduled_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

        pub const Pool = bun.HiveArray(TimerReference, 1024).Fallback;
        fn onUVRequest(handle: *uv.uv_timer_t) callconv(.C) void {
            const data = handle.data orelse @panic("Invalid data on uv timer");
            var this: *TimerReference = @ptrCast(@alignCast(data));
            if (this.cancelled) {
                _ = uv.uv_timer_stop(&this.timer);
            }
            this.runFromJSThread();
        }

        fn onRequest(req: *bun.io.Request) bun.io.Action {
            if (Environment.isWindows) {
                @panic("This should not be called on Windows");
            }
            var this: *TimerReference = @fieldParentPtr(TimerReference, "request", req);

            if (this.cancelled) {
                // We must free this on the main thread
                // deinit() is not thread-safe
                //
                // so we:
                //
                // 1) schedule a concurrent task to call `runFromJSThread`
                // 2) in `runFromJSThread`, we call `deinit` if `cancelled` is true
                //
                this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
                return bun.io.Action{
                    .timer_cancelled = {},
                };
            }
            return bun.io.Action{
                .timer = &this.timer,
            };
        }

        pub fn callback(this: *TimerReference) bun.io.Timer.Arm {
            _ = this;

            // TODO:
            return .{ .disarm = {} };
        }

        pub fn reschedule(this: *TimerReference) void {
            if (!Environment.isWindows) {
                this.request = .{
                    .callback = &onRequest,
                };
            }
            this.schedule(this.interval);
        }

        pub fn runFromJSThread(this: *TimerReference) void {
            const timer_id = this.id;
            const vm = this.event_loop.virtual_machine;
            _ = this.scheduled_count.fetchSub(1, .Monotonic);

            if (this.cancelled) {
                this.deinit();
                return;
            }

            if (comptime Environment.allow_assert)
                // If this is ever -1, it's invalid.
                // It should always be at least 1.
                assert(this.interval > 0);

            if (!Timeout.runFromConcurrentTask(timer_id, vm, this, reschedule) or this.cancelled) {
                this.deinit();
            }
        }

        pub fn deinit(this: *TimerReference) void {
            if (this.scheduled_count.load(.Monotonic) == 0)
                // Free it if there is no other scheduled job
                this.event_loop.timerReferencePool().put(this);
        }

        pub fn create(event_loop: *JSC.EventLoop, id: ID) *TimerReference {
            const this = event_loop.timerReferencePool().get();
            this.* = .{
                .id = id,
                .event_loop = event_loop,
            };
            if (Environment.isWindows) {
                this.timer.data = this;
                if (uv.uv_timer_init(uv.Loop.get(), &this.timer) != 0) {
                    bun.outOfMemory();
                }
                // we manage the ref/unref in the same way that linux does
                uv.uv_unref(@ptrCast(&this.timer));
            }
            return this;
        }

        pub fn schedule(this: *TimerReference, interval: ?i32) void {
            assert(!this.cancelled);
            _ = this.scheduled_count.fetchAdd(1, .Monotonic);
            const ms: usize = @max(interval orelse this.interval, 1);
            if (Environment.isWindows) {
                // we MUST update the timer so we avoid early firing
                uv.uv_update_time(uv.Loop.get());
                if (uv.uv_timer_start(&this.timer, TimerReference.onUVRequest, @intCast(ms), 0) != 0) @panic("unable to start timer");
                return;
            }

            this.timer.state = .PENDING;
            this.timer.next = msToTimespec(ms);
            bun.io.Loop.get().schedule(&this.request);
        }

        fn msToTimespec(ms: usize) std.os.timespec {
            var now: std.os.timespec = undefined;
            // std.time.Instant.now uses a different clock on macOS than monotonic
            bun.io.Loop.updateTimespec(&now);

            var increment = std.os.timespec{
                // nanosecond from ms milliseconds
                .tv_nsec = @intCast((ms % std.time.ms_per_s) *| std.time.ns_per_ms),
                .tv_sec = @intCast(ms / std.time.ms_per_s),
            };

            increment.tv_nsec +|= now.tv_nsec;
            increment.tv_sec +|= now.tv_sec;

            if (increment.tv_nsec >= std.time.ns_per_s) {
                increment.tv_nsec -= std.time.ns_per_s;
                increment.tv_sec +|= 1;
            }

            return increment;
        }
    };

    pub const Kind = enum(u32) {
        setTimeout,
        setInterval,
        setImmediate,
    };

    // this is sized to be the same as one pointer
    pub const ID = extern struct {
        id: i32,

        kind: Kind = Kind.setTimeout,

        pub inline fn asyncID(this: ID) u64 {
            return @bitCast(this);
        }

        pub fn repeats(this: ID) bool {
            return this.kind == .setInterval;
        }
    };

    pub fn run(timer: *uws.Timer) callconv(.C) void {
        const timer_id: ID = timer.as(ID);

        // use the threadlocal despite being slow on macOS
        // to handle the timeout being cancelled after already enqueued
        const vm = JSC.VirtualMachine.get();

        runWithIDAndVM(timer_id, vm);
    }

    pub fn runFromConcurrentTask(timer_id: ID, vm: *JSC.VirtualMachine, timer_ref: *TimerReference, comptime reschedule: fn (*TimerReference) void) bool {
        const repeats = timer_id.repeats();

        var map = vm.timer.maps.get(timer_id.kind);

        const this_: ?Timeout = map.get(
            timer_id.id,
        ) orelse return false;
        var this = this_ orelse
            return false;

        const globalThis = this.globalThis;

        // Disable thundering herd of setInterval() calls
        // Skip setInterval() calls when the previous one has not been run yet.
        if (repeats and this.has_scheduled_job) {
            return false;
        }

        const cb: CallbackJob = .{
            .callback = if (repeats)
                JSC.Strong.create(
                    this.callback.get() orelse {
                        // if the callback was freed, that's an error
                        if (comptime Environment.allow_assert)
                            unreachable;

                        this.deinit();
                        _ = map.swapRemove(timer_id.id);
                        return false;
                    },
                    globalThis,
                )
            else
                this.callback,
            .arguments = if (repeats and this.arguments.has())
                JSC.Strong.create(
                    this.arguments.get() orelse {
                        // if the arguments freed, that's an error
                        if (comptime Environment.allow_assert)
                            unreachable;

                        this.deinit();
                        _ = map.swapRemove(timer_id.id);
                        return false;
                    },
                    globalThis,
                )
            else
                this.arguments,
            .globalThis = globalThis,
            .id = timer_id.id,
            .kind = timer_id.kind,
        };

        // This allows us to:
        //  - free the memory before the job is run
        //  - reuse the JSC.Strong
        if (!repeats) {
            this.callback = .{};
            this.arguments = .{};
            map.put(vm.allocator, timer_id.id, null) catch unreachable;
            this.deinit();
        } else {
            this.has_scheduled_job = true;
            map.put(vm.allocator, timer_id.id, this) catch {};
            reschedule(timer_ref);
        }

        // TODO: remove this memory allocation!
        var job = vm.allocator.create(CallbackJob) catch @panic(
            "Out of memory while allocating Timeout",
        );
        job.* = cb;
        job.task = CallbackJob.Task.init(job);
        job.ref.ref(vm);

        if (vm.isInspectorEnabled()) {
            Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, timer_id.asyncID(), !repeats);
        }

        job.perform();

        return repeats;
    }

    pub fn runWithIDAndVM(timer_id: ID, vm: *JSC.VirtualMachine) void {
        const repeats = timer_id.repeats();

        var map = vm.timer.maps.get(timer_id.kind);

        const this_: ?Timeout = map.get(
            timer_id.id,
        ) orelse return;
        var this = this_ orelse
            return;

        const globalThis = this.globalThis;

        // Disable thundering herd of setInterval() calls
        // Skip setInterval() calls when the previous one has not been run yet.
        if (repeats and this.has_scheduled_job) {
            return;
        }

        const cb: CallbackJob = .{
            .callback = if (repeats)
                JSC.Strong.create(
                    this.callback.get() orelse {
                        // if the callback was freed, that's an error
                        if (comptime Environment.allow_assert)
                            unreachable;

                        this.deinit();
                        _ = map.swapRemove(timer_id.id);
                        return;
                    },
                    globalThis,
                )
            else
                this.callback,
            .arguments = if (repeats and this.arguments.has())
                JSC.Strong.create(
                    this.arguments.get() orelse {
                        // if the arguments freed, that's an error
                        if (comptime Environment.allow_assert)
                            unreachable;

                        this.deinit();
                        _ = map.swapRemove(timer_id.id);
                        return;
                    },
                    globalThis,
                )
            else
                this.arguments,
            .globalThis = globalThis,
            .id = timer_id.id,
            .kind = timer_id.kind,
        };

        // This allows us to:
        //  - free the memory before the job is run
        //  - reuse the JSC.Strong
        if (!repeats) {
            this.callback = .{};
            this.arguments = .{};
            map.put(vm.allocator, timer_id.id, null) catch unreachable;
            this.deinit();
        } else {
            this.has_scheduled_job = true;
            map.put(vm.allocator, timer_id.id, this) catch {};
        }

        var job = vm.allocator.create(CallbackJob) catch @panic(
            "Out of memory while allocating Timeout",
        );

        job.* = cb;
        job.task = CallbackJob.Task.init(job);
        job.ref.ref(vm);

        vm.enqueueTask(JSC.Task.init(&job.task));
        if (vm.isInspectorEnabled()) {
            Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, timer_id.asyncID(), !repeats);
        }
    }

    pub fn deinit(this: *Timeout) void {
        JSC.markBinding(@src());

        var vm = this.globalThis.bunVM();

        this.poll_ref.unref(vm);

        if (this.timer) |timer| {
            timer.cancelled = true;
        }

        if (comptime Environment.isPosix)
            // balance double unreffing in doUnref
            vm.event_loop_handle.?.num_polls += @as(i32, @intFromBool(this.did_unref_timer));

        this.callback.deinit();
        this.arguments.deinit();
    }
};

fn set(
    id: i32,
    globalThis: *JSGlobalObject,
    callback: JSValue,
    interval: i32,
    arguments_array_or_zero: JSValue,
    repeat: bool,
) !void {
    JSC.markBinding(@src());
    var vm = globalThis.bunVM();

    const kind: Timeout.Kind = if (repeat) .setInterval else .setTimeout;

    var map = vm.timer.maps.get(kind);

    // setImmediate(foo)
    if (kind == .setTimeout and interval == 0) {
        var cb: CallbackJob = .{
            .callback = JSC.Strong.create(callback, globalThis),
            .globalThis = globalThis,
            .id = id,
            .kind = kind,
        };

        if (arguments_array_or_zero != .zero) {
            cb.arguments = JSC.Strong.create(arguments_array_or_zero, globalThis);
        }

        var job = vm.allocator.create(CallbackJob) catch @panic(
            "Out of memory while allocating Timeout",
        );

        job.* = cb;
        job.task = CallbackJob.Task.init(job);
        job.ref.ref(vm);

        vm.enqueueImmediateTask(JSC.Task.init(&job.task));
        if (vm.isInspectorEnabled()) {
            Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, Timeout.ID.asyncID(.{ .id = id, .kind = kind }), !repeat);
        }
        map.put(vm.allocator, id, null) catch unreachable;
        return;
    }

    var timeout = Timeout{
        .callback = JSC.Strong.create(callback, globalThis),
        .globalThis = globalThis,
        .timer = Timeout.TimerReference.create(
            vm.eventLoop(),
            Timeout.ID{
                .id = id,
                .kind = kind,
            },
        ),
    };

    timeout.timer.?.interval = interval;

    if (arguments_array_or_zero != .zero) {
        timeout.arguments = JSC.Strong.create(arguments_array_or_zero, globalThis);
    }

    timeout.poll_ref.ref(vm);
    map.put(vm.allocator, id, timeout) catch unreachable;

    if (vm.isInspectorEnabled()) {
        Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, Timeout.ID.asyncID(.{ .id = id, .kind = kind }), !repeat);
    }

    timeout.timer.?.schedule(interval);
}

pub fn setImmediate(
    globalThis: *JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
) callconv(.C) JSValue {
    JSC.markBinding(@src());
    const id = globalThis.bunVM().timer.last_id;
    globalThis.bunVM().timer.last_id +%= 1;

    const interval: i32 = 0;

    const wrappedCallback = callback.withAsyncContextIfNeeded(globalThis);

    Timer.set(id, globalThis, wrappedCallback, interval, arguments, false) catch
        return JSValue.jsUndefined();

    return TimerObject.init(globalThis, id, .setTimeout, interval, wrappedCallback, arguments);
}

comptime {
    if (!JSC.is_bindgen) {
        @export(setImmediate, .{ .name = "Bun__Timer__setImmediate" });
    }
}

pub fn setTimeout(
    globalThis: *JSGlobalObject,
    callback: JSValue,
    countdown: JSValue,
    arguments: JSValue,
) callconv(.C) JSValue {
    JSC.markBinding(@src());
    const id = globalThis.bunVM().timer.last_id;
    globalThis.bunVM().timer.last_id +%= 1;

    const interval: i32 = @max(
        countdown.coerce(i32, globalThis),
        // It must be 1 at minimum or setTimeout(cb, 0) will seemingly hang
        1,
    );

    const wrappedCallback = callback.withAsyncContextIfNeeded(globalThis);

    Timer.set(id, globalThis, wrappedCallback, interval, arguments, false) catch
        return JSValue.jsUndefined();

    return TimerObject.init(globalThis, id, .setTimeout, interval, wrappedCallback, arguments);
}
pub fn setInterval(
    globalThis: *JSGlobalObject,
    callback: JSValue,
    countdown: JSValue,
    arguments: JSValue,
) callconv(.C) JSValue {
    JSC.markBinding(@src());
    const id = globalThis.bunVM().timer.last_id;
    globalThis.bunVM().timer.last_id +%= 1;

    const wrappedCallback = callback.withAsyncContextIfNeeded(globalThis);

    // We don't deal with nesting levels directly
    // but we do set the minimum timeout to be 1ms for repeating timers
    const interval: i32 = @max(
        countdown.coerce(i32, globalThis),
        1,
    );
    Timer.set(id, globalThis, wrappedCallback, interval, arguments, true) catch
        return JSValue.jsUndefined();

    return TimerObject.init(globalThis, id, .setInterval, interval, wrappedCallback, arguments);
}

pub fn clearTimer(timer_id_value: JSValue, globalThis: *JSGlobalObject, repeats: bool) void {
    JSC.markBinding(@src());

    const kind: Timeout.Kind = if (repeats) .setInterval else .setTimeout;
    var vm = globalThis.bunVM();
    var map = vm.timer.maps.get(kind);

    const id: Timeout.ID = .{
        .id = brk: {
            if (timer_id_value.isAnyInt()) {
                break :brk timer_id_value.coerce(i32, globalThis);
            }

            if (TimerObject.fromJS(timer_id_value)) |timer_obj| {
                timer_obj.markHasClear();
                break :brk timer_obj.id;
            }

            return;
        },
        .kind = kind,
    };

    var timer = map.fetchSwapRemove(id.id) orelse return;
    if (vm.isInspectorEnabled()) {
        Debugger.didCancelAsyncCall(globalThis, .DOMTimer, id.asyncID());
    }

    if (timer.value == null) {
        // this timer was scheduled to run but was cancelled before it was run
        // so long as the callback isn't already in progress, fetchSwapRemove will handle invalidating it
        return;
    }

    timer.value.?.deinit();
}

pub fn clearTimeout(
    globalThis: *JSGlobalObject,
    id: JSValue,
) callconv(.C) JSValue {
    JSC.markBinding(@src());
    Timer.clearTimer(id, globalThis, false);
    return JSValue.jsUndefined();
}
pub fn clearInterval(
    globalThis: *JSGlobalObject,
    id: JSValue,
) callconv(.C) JSValue {
    JSC.markBinding(@src());
    Timer.clearTimer(id, globalThis, true);
    return JSValue.jsUndefined();
}

const Shimmer = @import("../bindings/shimmer.zig").Shimmer;

pub const shim = Shimmer("Bun", "Timer", @This());
pub const name = "Bun__Timer";
pub const include = "";
pub const namespace = shim.namespace;

pub const Export = shim.exportFunctions(.{
    .setTimeout = setTimeout,
    .setInterval = setInterval,
    .clearTimeout = clearTimeout,
    .clearInterval = clearInterval,
    .getNextID = getNextID,
});

comptime {
    if (!JSC.is_bindgen) {
        @export(setTimeout, .{ .name = Export[0].symbol_name });
        @export(setInterval, .{ .name = Export[1].symbol_name });
        @export(clearTimeout, .{ .name = Export[2].symbol_name });
        @export(clearInterval, .{ .name = Export[3].symbol_name });
        @export(getNextID, .{ .name = Export[4].symbol_name });
    }
}

const assert = bun.assert;
