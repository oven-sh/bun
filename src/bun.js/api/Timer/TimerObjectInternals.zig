/// Data that TimerObject and ImmediateObject have in common
const TimerObjectInternals = @This();

/// Identifier for this timer that is exposed to JavaScript (by `+timer`)
id: i32 = -1,
interval: u31 = 0,
strong_this: jsc.Strong.Optional = .empty,
flags: Flags = .{},

/// Used by:
/// - setTimeout
/// - setInterval
/// - setImmediate
/// - AbortSignal.Timeout
pub const Flags = packed struct(u32) {
    /// Whenever a timer is inserted into the heap (which happen on creation or refresh), the global
    /// epoch is incremented and the new epoch is set on the timer. For timers created by
    /// JavaScript, the epoch is used to break ties between timers scheduled for the same
    /// millisecond. This ensures that if you set two timers for the same amount of time, and
    /// refresh the first one, the first one will fire last. This mimics Node.js's behavior where
    /// the refreshed timer will be inserted at the end of a list, which makes it fire later.
    epoch: u25 = 0,

    /// Kind does not include AbortSignal's timeout since it has no corresponding ID callback.
    kind: Kind = .setTimeout,

    // we do not allow the timer to be refreshed after we call clearInterval/clearTimeout
    has_cleared_timer: bool = false,
    is_keeping_event_loop_alive: bool = false,

    // if they never access the timer by integer, don't create a hashmap entry.
    has_accessed_primitive: bool = false,

    has_js_ref: bool = true,

    /// Set to `true` only during execution of the JavaScript function so that `_destroyed` can be
    /// false during the callback, even though the `state` will be `FIRED`.
    in_callback: bool = false,
};

fn eventLoopTimer(this: *TimerObjectInternals) *EventLoopTimer {
    switch (this.flags.kind) {
        .setImmediate => {
            const parent: *ImmediateObject = @fieldParentPtr("internals", this);
            assert(parent.event_loop_timer.tag == .ImmediateObject);
            return &parent.event_loop_timer;
        },
        .setTimeout, .setInterval => {
            const parent: *TimeoutObject = @fieldParentPtr("internals", this);
            assert(parent.event_loop_timer.tag == .TimeoutObject);
            return &parent.event_loop_timer;
        },
    }
}

fn ref(this: *TimerObjectInternals) void {
    switch (this.flags.kind) {
        .setImmediate => @as(*ImmediateObject, @fieldParentPtr("internals", this)).ref(),
        .setTimeout, .setInterval => @as(*TimeoutObject, @fieldParentPtr("internals", this)).ref(),
    }
}

fn deref(this: *TimerObjectInternals) void {
    switch (this.flags.kind) {
        .setImmediate => @as(*ImmediateObject, @fieldParentPtr("internals", this)).deref(),
        .setTimeout, .setInterval => @as(*TimeoutObject, @fieldParentPtr("internals", this)).deref(),
    }
}

extern "c" fn Bun__JSTimeout__call(globalObject: *jsc.JSGlobalObject, timer: JSValue, callback: JSValue, arguments: JSValue) bool;

/// returns true if an exception was thrown
pub fn runImmediateTask(this: *TimerObjectInternals, vm: *VirtualMachine) bool {
    if (this.flags.has_cleared_timer or
        // unref'd setImmediate callbacks should only run if there are things keeping the event
        // loop alive other than setImmediates
        (!this.flags.is_keeping_event_loop_alive and !vm.isEventLoopAliveExcludingImmediates()))
    {
        this.deref();
        return false;
    }

    const timer = this.strong_this.get() orelse {
        if (Environment.isDebug) {
            @panic("TimerObjectInternals.runImmediateTask: this_object is null");
        }
        return false;
    };
    const globalThis = vm.global;
    this.strong_this.deinit();
    this.eventLoopTimer().state = .FIRED;
    this.setEnableKeepingEventLoopAlive(vm, false);

    vm.eventLoop().enter();
    const callback = ImmediateObject.js.callbackGetCached(timer).?;
    const arguments = ImmediateObject.js.argumentsGetCached(timer).?;
    this.ref();
    const exception_thrown = this.run(globalThis, timer, callback, arguments, this.asyncID(), vm);
    this.deref();

    if (this.eventLoopTimer().state == .FIRED) {
        this.deref();
    }

    vm.eventLoop().exitMaybeDrainMicrotasks(!exception_thrown) catch return true;

    return exception_thrown;
}

pub fn asyncID(this: *const TimerObjectInternals) u64 {
    return ID.asyncID(.{ .id = this.id, .kind = this.flags.kind.big() });
}

pub fn fire(this: *TimerObjectInternals, _: *const timespec, vm: *jsc.VirtualMachine) void {
    const id = this.id;
    const kind = this.flags.kind.big();
    const async_id: ID = .{ .id = id, .kind = kind };
    const has_been_cleared = this.eventLoopTimer().state == .CANCELLED or this.flags.has_cleared_timer or vm.scriptExecutionStatus() != .running;

    this.eventLoopTimer().state = .FIRED;

    const globalThis = vm.global;
    const this_object = this.strong_this.get().?;

    const callback: JSValue, const arguments: JSValue, var idle_timeout: JSValue, var repeat: JSValue = switch (kind) {
        .setImmediate => .{
            ImmediateObject.js.callbackGetCached(this_object).?,
            ImmediateObject.js.argumentsGetCached(this_object).?,
            .js_undefined,
            .js_undefined,
        },
        .setTimeout, .setInterval => .{
            TimeoutObject.js.callbackGetCached(this_object).?,
            TimeoutObject.js.argumentsGetCached(this_object).?,
            TimeoutObject.js.idleTimeoutGetCached(this_object).?,
            TimeoutObject.js.repeatGetCached(this_object).?,
        },
    };

    if (has_been_cleared or !callback.toBoolean()) {
        if (vm.isInspectorEnabled()) {
            Debugger.didCancelAsyncCall(globalThis, .DOMTimer, ID.asyncID(async_id));
        }
        this.setEnableKeepingEventLoopAlive(vm, false);
        this.flags.has_cleared_timer = true;
        this.strong_this.deinit();
        this.deref();

        return;
    }

    var time_before_call: timespec = undefined;

    if (kind != .setInterval) {
        this.strong_this.clearWithoutDeallocation();
    } else {
        time_before_call = timespec.msFromNow(.allow_mocked_time, this.interval);
    }
    this_object.ensureStillAlive();

    vm.eventLoop().enter();
    {
        // Ensure it stays alive for this scope.
        this.ref();
        defer this.deref();

        _ = this.run(globalThis, this_object, callback, arguments, ID.asyncID(async_id), vm);

        switch (kind) {
            .setTimeout, .setInterval => {
                idle_timeout = TimeoutObject.js.idleTimeoutGetCached(this_object).?;
                repeat = TimeoutObject.js.repeatGetCached(this_object).?;
            },
            else => {},
        }

        const is_timer_done = is_timer_done: {
            // Node doesn't drain microtasks after each timer callback.
            if (kind == .setInterval) {
                if (!this.shouldRescheduleTimer(repeat, idle_timeout)) {
                    break :is_timer_done true;
                }
                switch (this.eventLoopTimer().state) {
                    .FIRED => {
                        // If we didn't clear the setInterval, reschedule it starting from
                        vm.timer.update(this.eventLoopTimer(), &time_before_call);

                        if (this.flags.has_js_ref) {
                            this.setEnableKeepingEventLoopAlive(vm, true);
                        }

                        // The ref count doesn't change. It wasn't decremented.
                    },
                    .ACTIVE => {
                        // The developer called timer.refresh() synchronously in the callback.
                        vm.timer.update(this.eventLoopTimer(), &time_before_call);

                        // Balance out the ref count.
                        // the transition from "FIRED" -> "ACTIVE" caused it to increment.
                        this.deref();
                    },
                    else => {
                        break :is_timer_done true;
                    },
                }
            } else {
                if (kind == .setTimeout and !repeat.isNull()) {
                    if (idle_timeout.getNumber()) |num| {
                        if (num != -1) {
                            this.convertToInterval(globalThis, this_object, repeat);
                            break :is_timer_done false;
                        }
                    }
                }

                if (this.eventLoopTimer().state == .FIRED) {
                    break :is_timer_done true;
                }
            }

            break :is_timer_done false;
        };

        if (is_timer_done) {
            this.setEnableKeepingEventLoopAlive(vm, false);
            // The timer will not be re-entered into the event loop at this point.
            this.deref();
        }
    }
    vm.eventLoop().exit();
}

fn convertToInterval(this: *TimerObjectInternals, global: *JSGlobalObject, timer: JSValue, repeat: JSValue) void {
    bun.debugAssert(this.flags.kind == .setTimeout);

    const vm = global.bunVM();

    const new_interval: u31 = if (repeat.getNumber()) |num| if (num < 1 or num > std.math.maxInt(u31)) 1 else @intFromFloat(num) else 1;

    // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L613
    TimeoutObject.js.idleTimeoutSetCached(timer, global, repeat);
    this.strong_this.set(global, timer);
    this.flags.kind = .setInterval;
    this.interval = new_interval;
    this.reschedule(timer, vm, global);
}

pub fn run(this: *TimerObjectInternals, globalThis: *jsc.JSGlobalObject, timer: JSValue, callback: JSValue, arguments: JSValue, async_id: u64, vm: *jsc.VirtualMachine) bool {
    if (vm.isInspectorEnabled()) {
        Debugger.willDispatchAsyncCall(globalThis, .DOMTimer, async_id);
    }

    defer {
        if (vm.isInspectorEnabled()) {
            Debugger.didDispatchAsyncCall(globalThis, .DOMTimer, async_id);
        }
    }

    // Bun__JSTimeout__call handles exceptions.
    this.flags.in_callback = true;
    defer this.flags.in_callback = false;
    return Bun__JSTimeout__call(globalThis, timer, callback, arguments);
}

pub fn init(
    this: *TimerObjectInternals,
    timer: JSValue,
    global: *JSGlobalObject,
    id: i32,
    kind: Kind,
    interval: u31,
    callback: JSValue,
    arguments: JSValue,
) void {
    const vm = global.bunVM();
    this.* = .{
        .id = id,
        .flags = .{ .kind = kind, .epoch = vm.timer.epoch },
        .interval = interval,
    };

    if (kind == .setImmediate) {
        ImmediateObject.js.argumentsSetCached(timer, global, arguments);
        ImmediateObject.js.callbackSetCached(timer, global, callback);
        const parent: *ImmediateObject = @fieldParentPtr("internals", this);
        vm.enqueueImmediateTask(parent);
        this.setEnableKeepingEventLoopAlive(vm, true);
        // ref'd by event loop
        parent.ref();
    } else {
        TimeoutObject.js.argumentsSetCached(timer, global, arguments);
        TimeoutObject.js.callbackSetCached(timer, global, callback);
        TimeoutObject.js.idleTimeoutSetCached(timer, global, .jsNumber(interval));
        TimeoutObject.js.repeatSetCached(timer, global, if (kind == .setInterval) .jsNumber(interval) else .null);

        // this increments the refcount and sets _idleStart
        this.reschedule(timer, vm, global);
    }

    this.strong_this.set(global, timer);
}

pub fn doRef(this: *TimerObjectInternals, _: *jsc.JSGlobalObject, this_value: JSValue) JSValue {
    this_value.ensureStillAlive();

    const did_have_js_ref = this.flags.has_js_ref;
    this.flags.has_js_ref = true;

    // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L256
    // and
    // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L685-L687
    if (!did_have_js_ref and !this.flags.has_cleared_timer) {
        this.setEnableKeepingEventLoopAlive(jsc.VirtualMachine.get(), true);
    }

    return this_value;
}

pub fn doRefresh(this: *TimerObjectInternals, globalObject: *jsc.JSGlobalObject, this_value: JSValue) JSValue {
    // Immediates do not have a refresh function, and our binding generator should not let this
    // function be reached even if you override the `this` value calling a Timeout object's
    // `refresh` method
    assert(this.flags.kind != .setImmediate);

    // setImmediate does not support refreshing and we do not support refreshing after cleanup
    if (this.id == -1 or this.flags.kind == .setImmediate or this.flags.has_cleared_timer) {
        return this_value;
    }

    this.strong_this.set(globalObject, this_value);
    this.reschedule(this_value, VirtualMachine.get(), globalObject);

    return this_value;
}

pub fn doUnref(this: *TimerObjectInternals, _: *jsc.JSGlobalObject, this_value: JSValue) JSValue {
    this_value.ensureStillAlive();

    const did_have_js_ref = this.flags.has_js_ref;
    this.flags.has_js_ref = false;

    if (did_have_js_ref) {
        this.setEnableKeepingEventLoopAlive(jsc.VirtualMachine.get(), false);
    }

    return this_value;
}

pub fn cancel(this: *TimerObjectInternals, vm: *VirtualMachine) void {
    this.setEnableKeepingEventLoopAlive(vm, false);
    this.flags.has_cleared_timer = true;

    if (this.flags.kind == .setImmediate) return;

    const was_active = this.eventLoopTimer().state == .ACTIVE;

    this.eventLoopTimer().state = .CANCELLED;
    this.strong_this.deinit();

    if (was_active) {
        vm.timer.remove(this.eventLoopTimer());
        this.deref();
    }
}

fn shouldRescheduleTimer(this: *TimerObjectInternals, repeat: JSValue, idle_timeout: JSValue) bool {
    if (this.flags.kind == .setInterval and repeat.isNull()) return false;
    if (idle_timeout.getNumber()) |num| {
        if (num == -1) return false;
    }
    return true;
}

pub fn reschedule(this: *TimerObjectInternals, timer: JSValue, vm: *VirtualMachine, globalThis: *JSGlobalObject) void {
    if (this.flags.kind == .setImmediate) return;

    const idle_timeout = TimeoutObject.js.idleTimeoutGetCached(timer).?;
    const repeat = TimeoutObject.js.repeatGetCached(timer).?;

    // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
    if (!this.shouldRescheduleTimer(repeat, idle_timeout)) return;

    const now = timespec.now(.allow_mocked_time);
    const scheduled_time = now.addMs(this.interval);
    const was_active = this.eventLoopTimer().state == .ACTIVE;
    if (was_active) {
        vm.timer.remove(this.eventLoopTimer());
    } else {
        this.ref();
    }

    vm.timer.update(this.eventLoopTimer(), &scheduled_time);
    this.flags.has_cleared_timer = false;

    // Set _idleStart to the current monotonic timestamp in milliseconds
    // This mimics Node.js's behavior where _idleStart is the libuv timestamp when the timer was scheduled
    TimeoutObject.js.idleStartSetCached(timer, globalThis, .jsNumber(now.msUnsigned()));

    if (this.flags.has_js_ref) {
        this.setEnableKeepingEventLoopAlive(vm, true);
    }
}

fn setEnableKeepingEventLoopAlive(this: *TimerObjectInternals, vm: *VirtualMachine, enable: bool) void {
    if (this.flags.is_keeping_event_loop_alive == enable) {
        return;
    }
    this.flags.is_keeping_event_loop_alive = enable;
    switch (this.flags.kind) {
        .setTimeout, .setInterval => vm.timer.incrementTimerRef(if (enable) 1 else -1),

        // setImmediate has slightly different event loop logic
        .setImmediate => vm.timer.incrementImmediateRef(if (enable) 1 else -1),
    }
}

pub fn hasRef(this: *TimerObjectInternals) JSValue {
    return JSValue.jsBoolean(this.flags.is_keeping_event_loop_alive);
}

pub fn toPrimitive(this: *TimerObjectInternals) bun.JSError!JSValue {
    if (!this.flags.has_accessed_primitive) {
        this.flags.has_accessed_primitive = true;
        const vm = VirtualMachine.get();
        try vm.timer.maps.get(this.flags.kind).put(bun.default_allocator, this.id, this.eventLoopTimer());
    }
    return JSValue.jsNumber(this.id);
}

/// This is the getter for `_destroyed` on JS Timeout and Immediate objects
pub fn getDestroyed(this: *TimerObjectInternals) bool {
    if (this.flags.has_cleared_timer) {
        return true;
    }
    if (this.flags.in_callback) {
        return false;
    }
    return switch (this.eventLoopTimer().state) {
        .ACTIVE, .PENDING => false,
        .FIRED, .CANCELLED => true,
    };
}

pub fn finalize(this: *TimerObjectInternals) void {
    this.strong_this.deinit();
    this.deref();
}

pub fn deinit(this: *TimerObjectInternals) void {
    this.strong_this.deinit();
    const vm = VirtualMachine.get();
    const kind = this.flags.kind;

    if (this.eventLoopTimer().state == .ACTIVE) {
        vm.timer.remove(this.eventLoopTimer());
    }

    if (this.flags.has_accessed_primitive) {
        const map = vm.timer.maps.get(kind);
        if (map.orderedRemove(this.id)) {
            // If this array gets large, let's shrink it down
            // Array keys are i32
            // Values are 1 ptr
            // Therefore, 12 bytes per entry
            // So if you created 21,000 timers and accessed them by ID, you'd be using 252KB
            const allocated_bytes = map.capacity() * @sizeOf(TimeoutMap.Data);
            const used_bytes = map.count() * @sizeOf(TimeoutMap.Data);
            if (allocated_bytes - used_bytes > 256 * 1024) {
                map.shrinkAndFree(bun.default_allocator, map.count() + 8);
            }
        }
    }

    this.setEnableKeepingEventLoopAlive(vm, false);
    switch (kind) {
        .setImmediate => (@as(*ImmediateObject, @fieldParentPtr("internals", this))).ref_count.assertNoRefs(),
        .setTimeout, .setInterval => (@as(*TimeoutObject, @fieldParentPtr("internals", this))).ref_count.assertNoRefs(),
    }
}

const Debugger = @import("../../Debugger.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const assert = bun.assert;
const timespec = bun.timespec;

const Timer = bun.api.Timer;
const EventLoopTimer = Timer.EventLoopTimer;
const ID = Timer.ID;
const ImmediateObject = Timer.ImmediateObject;
const Kind = Timer.Kind;
const TimeoutMap = Timer.TimeoutMap;
const TimeoutObject = Timer.TimeoutObject;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
