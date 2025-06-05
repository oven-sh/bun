const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const JSValue = JSC.JSValue;
const JSError = bun.JSError;
const JSGlobalObject = JSC.JSGlobalObject;
const Debugger = JSC.Debugger;
const Environment = bun.Environment;
const uv = bun.windows.libuv;
const api = bun.api;
const StatWatcherScheduler = @import("../node/node_fs_stat_watcher.zig").StatWatcherScheduler;
const Timer = @This();
const DNSResolver = @import("./bun/dns_resolver.zig").DNSResolver;
const trace_events = @import("../trace_events.zig");

/// TimeoutMap is map of i32 to nullable Timeout structs
/// i32 is exposed to JavaScript and can be used with clearTimeout, clearInterval, etc.
/// When Timeout is null, it means the tasks have been scheduled but not yet executed.
/// Timeouts are enqueued as a task to be run on the next tick of the task queue
/// The task queue runs after the event loop tasks have been run
/// Therefore, there is a race condition where you cancel the task after it has already been enqueued
/// In that case, it shouldn't run. It should be skipped.
pub const TimeoutMap = std.AutoArrayHashMapUnmanaged(
    i32,
    *EventLoopTimer,
);

const TimerHeap = heap.Intrusive(EventLoopTimer, void, EventLoopTimer.less);

pub const All = struct {
    last_id: i32 = 1,
    lock: bun.Mutex = .{},
    thread_id: std.Thread.Id,
    timers: TimerHeap = .{ .context = {} },
    active_timer_count: i32 = 0,
    uv_timer: if (Environment.isWindows) uv.Timer else void = if (Environment.isWindows) std.mem.zeroes(uv.Timer),
    /// Whether we have emitted a warning for passing a negative timeout duration
    warned_negative_number: bool = false,
    /// Whether we have emitted a warning for passing NaN for the timeout duration
    warned_not_number: bool = false,
    /// Incremented when timers are scheduled or rescheduled. See doc comment on
    /// TimerObjectInternals.epoch.
    epoch: u25 = 0,
    immediate_ref_count: i32 = 0,
    uv_idle: if (Environment.isWindows) uv.uv_idle_t else void = if (Environment.isWindows) std.mem.zeroes(uv.uv_idle_t),

    // We split up the map here to avoid storing an extra "repeat" boolean
    maps: struct {
        setTimeout: TimeoutMap = .{},
        setInterval: TimeoutMap = .{},
        setImmediate: TimeoutMap = .{},

        pub inline fn get(this: *@This(), kind: Kind) *TimeoutMap {
            return switch (kind) {
                .setTimeout => &this.setTimeout,
                .setInterval => &this.setInterval,
                .setImmediate => &this.setImmediate,
            };
        }
    } = .{},

    pub fn init() @This() {
        return .{
            .thread_id = std.Thread.getCurrentId(),
        };
    }

    pub fn insert(this: *All, timer: *EventLoopTimer) void {
        this.lock.lock();
        defer this.lock.unlock();
        this.timers.insert(timer);
        timer.state = .ACTIVE;

        if (Environment.isWindows) {
            this.ensureUVTimer(@alignCast(@fieldParentPtr("timer", this)));
        }
    }

    pub fn remove(this: *All, timer: *EventLoopTimer) void {
        this.lock.lock();
        defer this.lock.unlock();
        this.timers.remove(timer);

        timer.state = .CANCELLED;
    }

    /// Remove the EventLoopTimer if necessary.
    pub fn update(this: *All, timer: *EventLoopTimer, time: *const timespec) void {
        this.lock.lock();
        defer this.lock.unlock();
        if (timer.state == .ACTIVE) {
            this.timers.remove(timer);
        }

        timer.state = .ACTIVE;
        if (comptime Environment.isDebug) {
            if (&timer.next == time) {
                @panic("timer.next == time. For threadsafety reasons, time and timer.next must always be a different pointer.");
            }
        }

        timer.next = time.*;
        if (timer.jsTimerInternals()) |internals| {
            this.epoch +%= 1;
            internals.flags.epoch = this.epoch;
        }

        this.timers.insert(timer);
        if (Environment.isWindows) {
            this.ensureUVTimer(@alignCast(@fieldParentPtr("timer", this)));
        }
    }

    fn ensureUVTimer(this: *All, vm: *VirtualMachine) void {
        if (this.uv_timer.data == null) {
            this.uv_timer.init(vm.uvLoop());
            this.uv_timer.data = vm;
            this.uv_timer.unref();
        }

        if (this.timers.peek()) |timer| {
            uv.uv_update_time(vm.uvLoop());
            const now = timespec.now();
            const wait = if (timer.next.greater(&now))
                timer.next.duration(&now)
            else
                timespec{ .nsec = 0, .sec = 0 };

            // minimum 1ms
            // https://github.com/nodejs/node/blob/f552c86fecd6c2ba9e832ea129b731dd63abdbe2/src/env.cc#L1512
            const wait_ms = @max(1, wait.msUnsigned());

            this.uv_timer.start(wait_ms, 0, &onUVTimer);

            if (this.active_timer_count > 0) {
                this.uv_timer.ref();
            } else {
                this.uv_timer.unref();
            }
        }
    }

    pub fn onUVTimer(uv_timer_t: *uv.Timer) callconv(.C) void {
        const all: *All = @fieldParentPtr("uv_timer", uv_timer_t);
        const vm: *VirtualMachine = @alignCast(@fieldParentPtr("timer", all));
        all.drainTimers(vm);
        all.ensureUVTimer(vm);
    }

    pub fn incrementImmediateRef(this: *All, delta: i32) void {
        const old = this.immediate_ref_count;
        const new = old + delta;
        this.immediate_ref_count = new;
        const vm: *VirtualMachine = @alignCast(@fieldParentPtr("timer", this));

        if (old <= 0 and new > 0) {
            if (comptime Environment.isWindows) {
                if (this.uv_idle.data == null) {
                    this.uv_idle.init(uv.Loop.get());
                    this.uv_idle.data = vm;
                }

                // Matches Node.js behavior
                this.uv_idle.start(struct {
                    fn cb(_: *uv.uv_idle_t) callconv(.C) void {
                        // prevent libuv from polling forever
                    }
                }.cb);
            } else {
                vm.uwsLoop().ref();
            }
        } else if (old > 0 and new <= 0) {
            if (comptime Environment.isWindows) {
                if (this.uv_idle.data != null) {
                    this.uv_idle.stop();
                }
            } else {
                vm.uwsLoop().unref();
            }
        }
    }

    pub fn incrementTimerRef(this: *All, delta: i32) void {
        const vm: *JSC.VirtualMachine = @alignCast(@fieldParentPtr("timer", this));

        const old = this.active_timer_count;
        const new = old + delta;

        if (comptime Environment.isDebug) {
            assert(new >= 0);
        }

        this.active_timer_count = new;

        if (old <= 0 and new > 0) {
            if (comptime Environment.isWindows) {
                this.uv_timer.ref();
            } else {
                vm.uwsLoop().ref();
            }
        } else if (old > 0 and new <= 0) {
            if (comptime Environment.isWindows) {
                this.uv_timer.unref();
            } else {
                vm.uwsLoop().unref();
            }
        }
    }

    pub fn getNextID() callconv(.C) i32 {
        VirtualMachine.get().timer.last_id +%= 1;
        return VirtualMachine.get().timer.last_id;
    }

    pub fn getTimeout(this: *All, spec: *timespec, vm: *VirtualMachine) bool {
        if (this.active_timer_count == 0) {
            return false;
        }

        var maybe_now: ?timespec = null;
        while (this.timers.peek()) |min| {
            const now = maybe_now orelse now: {
                const real_now = timespec.now();
                maybe_now = real_now;
                break :now real_now;
            };

            switch (now.order(&min.next)) {
                .gt, .eq => {
                    // Side-effect: potentially call the StopIfNecessary timer.
                    if (min.tag == .WTFTimer) {
                        _ = this.timers.deleteMin();
                        _ = min.fire(&now, vm);
                        continue;
                    }

                    spec.* = .{ .nsec = 0, .sec = 0 };
                    return true;
                },
                .lt => {
                    spec.* = min.next.duration(&now);
                    return true;
                },
            }
        }

        return false;
    }

    export fn Bun__internal_drainTimers(vm: *VirtualMachine) callconv(.C) void {
        drainTimers(&vm.timer, vm);
    }

    comptime {
        _ = &Bun__internal_drainTimers;
    }

    // Getting the current time is expensive on certain platforms.
    // We don't want to call it when there are no timers.
    // And when we do call it, we want to be sure we only call it once.
    // and we do NOT want to hold the lock while the timer is running it's code.
    // This function has to be thread-safe.
    fn next(this: *All, has_set_now: *bool, now: *timespec) ?*EventLoopTimer {
        this.lock.lock();
        defer this.lock.unlock();

        if (this.timers.peek()) |timer| {
            if (!has_set_now.*) {
                now.* = timespec.now();
                has_set_now.* = true;
            }
            if (timer.next.greater(now)) {
                return null;
            }

            assert(this.timers.deleteMin().? == timer);

            return timer;
        }
        return null;
    }

    pub fn drainTimers(this: *All, vm: *VirtualMachine) void {
        // Emit RunTimers trace event
        const timer = trace_events.TraceTimer.begin("RunTimers", "node.environment");
        defer timer.end();

        // Set in next().
        var now: timespec = undefined;
        // Split into a separate variable to avoid increasing the size of the timespec type.
        var has_set_now: bool = false;

        while (this.next(&has_set_now, &now)) |t| {
            switch (t.fire(&now, vm)) {
                .disarm => {},
                .rearm => {},
            }
        }
    }

    const TimeoutWarning = enum {
        TimeoutOverflowWarning,
        TimeoutNegativeWarning,
        TimeoutNaNWarning,
    };

    fn warnInvalidCountdown(globalThis: *JSGlobalObject, countdown: f64, warning_type: TimeoutWarning) void {
        const suffix = ".\nTimeout duration was set to 1.";

        var warning_string = switch (warning_type) {
            .TimeoutOverflowWarning => if (std.math.isFinite(countdown))
                bun.String.createFormat(
                    "{d} does not fit into a 32-bit signed integer" ++ suffix,
                    .{countdown},
                ) catch bun.outOfMemory()
            else
                // -Infinity is handled by TimeoutNegativeWarning
                bun.String.ascii("Infinity does not fit into a 32-bit signed integer" ++ suffix),
            .TimeoutNegativeWarning => if (std.math.isFinite(countdown))
                bun.String.createFormat(
                    "{d} is a negative number" ++ suffix,
                    .{countdown},
                ) catch bun.outOfMemory()
            else
                bun.String.ascii("-Infinity is a negative number" ++ suffix),
            // std.fmt gives us "nan" but Node.js wants "NaN".
            .TimeoutNaNWarning => nan_warning: {
                assert(std.math.isNan(countdown));
                break :nan_warning bun.String.ascii("NaN is not a number" ++ suffix);
            },
        };
        var warning_type_string = bun.String.createAtomIfPossible(@tagName(warning_type));
        // these arguments are valid so emitWarning won't throw
        globalThis.emitWarning(
            warning_string.transferToJS(globalThis),
            warning_type_string.transferToJS(globalThis),
            .undefined,
            .undefined,
        ) catch unreachable;
    }

    const CountdownOverflowBehavior = enum(u8) {
        /// If the countdown overflows the range of int32_t, use a countdown of 1ms instead. Behavior of `setTimeout` and friends.
        one_ms,
        /// If the countdown overflows the range of int32_t, clamp to the nearest value within the range. Behavior of `Bun.sleep`.
        clamp,
    };

    /// Convert an arbitrary JavaScript value to a number of milliseconds used to schedule a timer.
    fn jsValueToCountdown(
        this: *All,
        globalThis: *JSGlobalObject,
        countdown: JSValue,
        overflow_behavior: CountdownOverflowBehavior,
        warn: bool,
    ) JSError!u31 {
        // We don't deal with nesting levels directly
        // but we do set the minimum timeout to be 1ms for repeating timers
        const countdown_double = try countdown.toNumber(globalThis);
        const countdown_int: u31 = switch (overflow_behavior) {
            .clamp => std.math.lossyCast(u31, countdown_double),
            .one_ms => if (!(countdown_double >= 1 and countdown_double <= std.math.maxInt(u31))) one: {
                if (warn) {
                    if (countdown_double > std.math.maxInt(u31)) {
                        warnInvalidCountdown(globalThis, countdown_double, .TimeoutOverflowWarning);
                    } else if (countdown_double < 0 and !this.warned_negative_number) {
                        this.warned_negative_number = true;
                        warnInvalidCountdown(globalThis, countdown_double, .TimeoutNegativeWarning);
                    } else if (!countdown.isUndefined() and countdown.isNumber() and std.math.isNan(countdown_double) and !this.warned_not_number) {
                        this.warned_not_number = true;
                        warnInvalidCountdown(globalThis, countdown_double, .TimeoutNaNWarning);
                    }
                }
                break :one 1;
            } else @intFromFloat(countdown_double),
        };

        return countdown_int;
    }

    /// Bun.sleep
    /// a setTimeout that uses a promise instead of a callback, and interprets the countdown
    /// slightly differently for historical reasons (see jsValueToCountdown)
    pub fn sleep(
        global: *JSGlobalObject,
        promise: JSValue,
        countdown: JSValue,
    ) JSError!JSValue {
        JSC.markBinding(@src());
        bun.debugAssert(promise != .zero and countdown != .zero);
        const vm = global.bunVM();
        const id = vm.timer.last_id;
        vm.timer.last_id +%= 1;

        const countdown_int = try vm.timer.jsValueToCountdown(global, countdown, .clamp, true);
        const wrapped_promise = promise.withAsyncContextIfNeeded(global);
        return TimeoutObject.init(global, id, .setTimeout, countdown_int, wrapped_promise, .undefined);
    }

    pub fn setImmediate(
        global: *JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
    ) JSError!JSValue {
        JSC.markBinding(@src());
        bun.debugAssert(callback != .zero and arguments != .zero);
        const vm = global.bunVM();
        const id = vm.timer.last_id;
        vm.timer.last_id +%= 1;

        const wrapped_callback = callback.withAsyncContextIfNeeded(global);
        return ImmediateObject.init(global, id, wrapped_callback, arguments);
    }

    pub fn setTimeout(
        global: *JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
        countdown: JSValue,
    ) JSError!JSValue {
        JSC.markBinding(@src());
        bun.debugAssert(callback != .zero and arguments != .zero and countdown != .zero);
        const vm = global.bunVM();
        const id = vm.timer.last_id;
        vm.timer.last_id +%= 1;

        const wrapped_callback = callback.withAsyncContextIfNeeded(global);
        const countdown_int = try global.bunVM().timer.jsValueToCountdown(global, countdown, .one_ms, true);
        return TimeoutObject.init(global, id, .setTimeout, countdown_int, wrapped_callback, arguments);
    }
    pub fn setInterval(
        global: *JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
        countdown: JSValue,
    ) JSError!JSValue {
        JSC.markBinding(@src());
        bun.debugAssert(callback != .zero and arguments != .zero and countdown != .zero);
        const vm = global.bunVM();
        const id = vm.timer.last_id;
        vm.timer.last_id +%= 1;

        const wrapped_callback = callback.withAsyncContextIfNeeded(global);
        const countdown_int = try global.bunVM().timer.jsValueToCountdown(global, countdown, .one_ms, true);
        return TimeoutObject.init(global, id, .setInterval, countdown_int, wrapped_callback, arguments);
    }

    fn removeTimerById(this: *All, id: i32) ?*TimeoutObject {
        if (this.maps.setTimeout.fetchSwapRemove(id)) |entry| {
            bun.assert(entry.value.tag == .TimeoutObject);
            return @fieldParentPtr("event_loop_timer", entry.value);
        } else if (this.maps.setInterval.fetchSwapRemove(id)) |entry| {
            bun.assert(entry.value.tag == .TimeoutObject);
            return @fieldParentPtr("event_loop_timer", entry.value);
        } else return null;
    }

    pub fn clearTimer(timer_id_value: JSValue, globalThis: *JSGlobalObject, kind: Kind) JSError!void {
        JSC.markBinding(@src());

        const vm = globalThis.bunVM();

        const timer: *TimerObjectInternals = brk: {
            if (timer_id_value.isInt32()) {
                // Immediates don't have numeric IDs in Node.js so we only have to look up timeouts and intervals
                break :brk &(vm.timer.removeTimerById(timer_id_value.asInt32()) orelse return).internals;
            } else if (timer_id_value.isStringLiteral()) {
                const string = try timer_id_value.toBunString(globalThis);
                defer string.deref();
                // Custom parseInt logic. I've done this because Node.js is very strict about string
                // parameters to this function: they can't have leading whitespace, trailing
                // characters, signs, or even leading zeroes. None of the readily-available string
                // parsing functions are this strict. The error case is to just do nothing (not
                // clear any timer).
                //
                // The reason is that in Node.js this function's parameter is used for an array
                // lookup, and array[0] is the same as array['0'] in JS but not the same as array['00'].
                const parsed = parsed: {
                    var accumulator: i32 = 0;
                    switch (string.encoding()) {
                        // We can handle all encodings the same way since the only permitted characters
                        // are ASCII.
                        inline else => |encoding| {
                            // Call the function named for this encoding (.latin1(), etc.)
                            const slice = @field(bun.String, @tagName(encoding))(string);
                            for (slice, 0..) |c, i| {
                                if (c < '0' or c > '9') {
                                    // Non-digit characters are not allowed
                                    return;
                                } else if (i == 0 and c == '0') {
                                    // Leading zeroes are not allowed
                                    return;
                                }
                                // Fail on overflow
                                accumulator = std.math.mul(i32, 10, accumulator) catch return;
                                accumulator = std.math.add(i32, accumulator, c - '0') catch return;
                            }
                        },
                    }
                    break :parsed accumulator;
                };
                break :brk &(vm.timer.removeTimerById(parsed) orelse return).internals;
            }

            break :brk if (TimeoutObject.fromJS(timer_id_value)) |timeout|
                &timeout.internals
            else if (ImmediateObject.fromJS(timer_id_value)) |immediate|
                // setImmediate can only be cleared by clearImmediate, not by clearTimeout or clearInterval.
                // setTimeout and setInterval can be cleared by any of the 3 clear functions.
                if (kind == .setImmediate) &immediate.internals else return
            else
                null;
        } orelse return;

        timer.cancel(vm);
    }

    pub fn clearImmediate(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) JSError!JSValue {
        JSC.markBinding(@src());
        try clearTimer(id, globalThis, .setImmediate);
        return JSValue.jsUndefined();
    }
    pub fn clearTimeout(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) JSError!JSValue {
        JSC.markBinding(@src());
        try clearTimer(id, globalThis, .setTimeout);
        return JSValue.jsUndefined();
    }
    pub fn clearInterval(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) JSError!JSValue {
        JSC.markBinding(@src());
        try clearTimer(id, globalThis, .setInterval);
        return JSValue.jsUndefined();
    }

    comptime {
        @export(&JSC.host_fn.wrap3(setImmediate), .{ .name = "Bun__Timer__setImmediate" });
        @export(&JSC.host_fn.wrap3(sleep), .{ .name = "Bun__Timer__sleep" });
        @export(&JSC.host_fn.wrap4(setTimeout), .{ .name = "Bun__Timer__setTimeout" });
        @export(&JSC.host_fn.wrap4(setInterval), .{ .name = "Bun__Timer__setInterval" });
        @export(&JSC.host_fn.wrap2(clearImmediate), .{ .name = "Bun__Timer__clearImmediate" });
        @export(&JSC.host_fn.wrap2(clearTimeout), .{ .name = "Bun__Timer__clearTimeout" });
        @export(&JSC.host_fn.wrap2(clearInterval), .{ .name = "Bun__Timer__clearInterval" });
        @export(&getNextID, .{ .name = "Bun__Timer__getNextID" });
    }
};

const uws = bun.uws;

pub const TimeoutObject = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    pub const js = JSC.Codegen.JSTimeout;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    ref_count: RefCount,
    event_loop_timer: EventLoopTimer = .{
        .next = .{},
        .tag = .TimeoutObject,
    },
    internals: TimerObjectInternals,

    pub fn init(
        globalThis: *JSGlobalObject,
        id: i32,
        kind: Kind,
        interval: u31,
        callback: JSValue,
        arguments: JSValue,
    ) JSValue {
        // internals are initialized by init()
        const timeout = bun.new(TimeoutObject, .{ .ref_count = .init(), .internals = undefined });
        const js_value = timeout.toJS(globalThis);
        defer js_value.ensureStillAlive();
        timeout.internals.init(
            js_value,
            globalThis,
            id,
            kind,
            interval,
            callback,
            arguments,
        );

        if (globalThis.bunVM().isInspectorEnabled()) {
            Debugger.didScheduleAsyncCall(
                globalThis,
                .DOMTimer,
                ID.asyncID(.{ .id = id, .kind = kind.big() }),
                kind != .setInterval,
            );
        }

        return js_value;
    }

    fn deinit(this: *TimeoutObject) void {
        this.internals.deinit();
        bun.destroy(this);
    }

    pub fn constructor(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) !*TimeoutObject {
        _ = callFrame;
        return globalObject.throw("Timeout is not constructible", .{});
    }

    pub fn toPrimitive(this: *TimeoutObject, _: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        return this.internals.toPrimitive();
    }

    pub fn doRef(this: *TimeoutObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
        return this.internals.doRef(globalThis, callFrame.this());
    }

    pub fn doUnref(this: *TimeoutObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
        return this.internals.doUnref(globalThis, callFrame.this());
    }

    pub fn doRefresh(this: *TimeoutObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
        return this.internals.doRefresh(globalThis, callFrame.this());
    }

    pub fn hasRef(this: *TimeoutObject, _: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        return this.internals.hasRef();
    }

    pub fn finalize(this: *TimeoutObject) void {
        this.internals.finalize();
    }

    pub fn getDestroyed(this: *TimeoutObject, globalThis: *JSGlobalObject) JSValue {
        _ = globalThis;
        return .jsBoolean(this.internals.getDestroyed());
    }

    pub fn close(this: *TimeoutObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) JSValue {
        this.internals.cancel(globalThis.bunVM());
        return callFrame.this();
    }

    pub fn get_onTimeout(_: *TimeoutObject, thisValue: JSValue, _: *JSGlobalObject) JSValue {
        return TimeoutObject.js.callbackGetCached(thisValue).?;
    }

    pub fn set_onTimeout(_: *TimeoutObject, thisValue: JSValue, globalThis: *JSGlobalObject, value: JSValue) void {
        TimeoutObject.js.callbackSetCached(thisValue, globalThis, value);
    }

    pub fn get_idleTimeout(_: *TimeoutObject, thisValue: JSValue, _: *JSGlobalObject) JSValue {
        return TimeoutObject.js.idleTimeoutGetCached(thisValue).?;
    }

    pub fn set_idleTimeout(_: *TimeoutObject, thisValue: JSValue, globalThis: *JSGlobalObject, value: JSValue) void {
        TimeoutObject.js.idleTimeoutSetCached(thisValue, globalThis, value);
    }

    pub fn get_repeat(_: *TimeoutObject, thisValue: JSValue, _: *JSGlobalObject) JSValue {
        return TimeoutObject.js.repeatGetCached(thisValue).?;
    }

    pub fn set_repeat(_: *TimeoutObject, thisValue: JSValue, globalThis: *JSGlobalObject, value: JSValue) void {
        TimeoutObject.js.repeatSetCached(thisValue, globalThis, value);
    }

    pub fn dispose(this: *TimeoutObject, globalThis: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        this.internals.cancel(globalThis.bunVM());
        return .undefined;
    }
};

pub const ImmediateObject = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    pub const js = JSC.Codegen.JSImmediate;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    ref_count: RefCount,
    event_loop_timer: EventLoopTimer = .{
        .next = .{},
        .tag = .ImmediateObject,
    },
    internals: TimerObjectInternals,

    pub fn init(
        globalThis: *JSGlobalObject,
        id: i32,
        callback: JSValue,
        arguments: JSValue,
    ) JSValue {
        // internals are initialized by init()
        const immediate = bun.new(ImmediateObject, .{ .ref_count = .init(), .internals = undefined });
        const js_value = immediate.toJS(globalThis);
        defer js_value.ensureStillAlive();
        immediate.internals.init(
            js_value,
            globalThis,
            id,
            .setImmediate,
            0,
            callback,
            arguments,
        );

        if (globalThis.bunVM().isInspectorEnabled()) {
            Debugger.didScheduleAsyncCall(
                globalThis,
                .DOMTimer,
                ID.asyncID(.{ .id = id, .kind = .setImmediate }),
                true,
            );
        }

        return js_value;
    }

    fn deinit(this: *ImmediateObject) void {
        this.internals.deinit();
        bun.destroy(this);
    }

    pub fn constructor(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) !*ImmediateObject {
        _ = callFrame;
        return globalObject.throw("Immediate is not constructible", .{});
    }

    /// returns true if an exception was thrown
    pub fn runImmediateTask(this: *ImmediateObject, vm: *VirtualMachine) bool {
        return this.internals.runImmediateTask(vm);
    }

    pub fn toPrimitive(this: *ImmediateObject, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        return this.internals.toPrimitive();
    }

    pub fn doRef(this: *ImmediateObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
        return this.internals.doRef(globalThis, callFrame.this());
    }

    pub fn doUnref(this: *ImmediateObject, globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
        return this.internals.doUnref(globalThis, callFrame.this());
    }

    pub fn hasRef(this: *ImmediateObject, _: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        return this.internals.hasRef();
    }

    pub fn finalize(this: *ImmediateObject) void {
        this.internals.finalize();
    }

    pub fn getDestroyed(this: *ImmediateObject, globalThis: *JSGlobalObject) JSValue {
        _ = globalThis;
        return .jsBoolean(this.internals.getDestroyed());
    }

    pub fn dispose(this: *ImmediateObject, globalThis: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        this.internals.cancel(globalThis.bunVM());
        return .undefined;
    }
};

/// Data that TimerObject and ImmediateObject have in common
pub const TimerObjectInternals = struct {
    /// Identifier for this timer that is exposed to JavaScript (by `+timer`)
    id: i32 = -1,
    interval: u31 = 0,
    strong_this: JSC.Strong.Optional = .empty,
    flags: Flags = .{},

    const Flags = packed struct(u32) {
        /// Whenever a timer is inserted into the heap (which happen on creation or refresh), the global
        /// epoch is incremented and the new epoch is set on the timer. For timers created by
        /// JavaScript, the epoch is used to break ties between timers scheduled for the same
        /// millisecond. This ensures that if you set two timers for the same amount of time, and
        /// refresh the first one, the first one will fire last. This mimics Node.js's behavior where
        /// the refreshed timer will be inserted at the end of a list, which makes it fire later.
        epoch: u25 = 0,

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

    extern "c" fn Bun__JSTimeout__call(globalObject: *JSC.JSGlobalObject, timer: JSValue, callback: JSValue, arguments: JSValue) bool;

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

        vm.eventLoop().exitMaybeDrainMicrotasks(!exception_thrown);

        return exception_thrown;
    }

    pub fn asyncID(this: *const TimerObjectInternals) u64 {
        return ID.asyncID(.{ .id = this.id, .kind = this.flags.kind.big() });
    }

    pub fn fire(this: *TimerObjectInternals, _: *const timespec, vm: *JSC.VirtualMachine) EventLoopTimer.Arm {
        const id = this.id;
        const kind = this.flags.kind.big();
        const async_id: ID = .{ .id = id, .kind = kind };
        const has_been_cleared = this.eventLoopTimer().state == .CANCELLED or this.flags.has_cleared_timer or vm.scriptExecutionStatus() != .running;

        this.eventLoopTimer().state = .FIRED;

        const globalThis = vm.global;
        const this_object = this.strong_this.get().?;

        const callback, const arguments, var idle_timeout, var repeat = switch (kind) {
            .setImmediate => .{
                ImmediateObject.js.callbackGetCached(this_object).?,
                ImmediateObject.js.argumentsGetCached(this_object).?,

                .undefined,
                .undefined,
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

            return .disarm;
        }

        var time_before_call: timespec = undefined;

        if (kind != .setInterval) {
            this.strong_this.clearWithoutDeallocation();
        } else {
            time_before_call = timespec.msFromNow(this.interval);
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

        return .disarm;
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
        this.reschedule(timer, vm);
    }

    pub fn run(this: *TimerObjectInternals, globalThis: *JSC.JSGlobalObject, timer: JSValue, callback: JSValue, arguments: JSValue, async_id: u64, vm: *JSC.VirtualMachine) bool {
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
            TimeoutObject.js.idleTimeoutSetCached(timer, global, JSC.jsNumber(interval));
            TimeoutObject.js.repeatSetCached(timer, global, if (kind == .setInterval) JSC.jsNumber(interval) else .null);

            // this increments the refcount
            this.reschedule(timer, vm);
        }

        this.strong_this.set(global, timer);
    }

    pub fn doRef(this: *TimerObjectInternals, _: *JSC.JSGlobalObject, this_value: JSValue) JSValue {
        this_value.ensureStillAlive();

        const did_have_js_ref = this.flags.has_js_ref;
        this.flags.has_js_ref = true;

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L256
        // and
        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L685-L687
        if (!did_have_js_ref and !this.flags.has_cleared_timer) {
            this.setEnableKeepingEventLoopAlive(JSC.VirtualMachine.get(), true);
        }

        return this_value;
    }

    pub fn doRefresh(this: *TimerObjectInternals, globalObject: *JSC.JSGlobalObject, this_value: JSValue) JSValue {
        // Immediates do not have a refresh function, and our binding generator should not let this
        // function be reached even if you override the `this` value calling a Timeout object's
        // `refresh` method
        assert(this.flags.kind != .setImmediate);

        // setImmediate does not support refreshing and we do not support refreshing after cleanup
        if (this.id == -1 or this.flags.kind == .setImmediate or this.flags.has_cleared_timer) {
            return this_value;
        }

        this.strong_this.set(globalObject, this_value);
        this.reschedule(this_value, VirtualMachine.get());

        return this_value;
    }

    pub fn doUnref(this: *TimerObjectInternals, _: *JSC.JSGlobalObject, this_value: JSValue) JSValue {
        this_value.ensureStillAlive();

        const did_have_js_ref = this.flags.has_js_ref;
        this.flags.has_js_ref = false;

        if (did_have_js_ref) {
            this.setEnableKeepingEventLoopAlive(JSC.VirtualMachine.get(), false);
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

    pub fn reschedule(this: *TimerObjectInternals, timer: JSValue, vm: *VirtualMachine) void {
        if (this.flags.kind == .setImmediate) return;

        const idle_timeout = TimeoutObject.js.idleTimeoutGetCached(timer).?;
        const repeat = TimeoutObject.js.repeatGetCached(timer).?;

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        if (!this.shouldRescheduleTimer(repeat, idle_timeout)) return;

        const now = timespec.msFromNow(this.interval);
        const was_active = this.eventLoopTimer().state == .ACTIVE;
        if (was_active) {
            vm.timer.remove(this.eventLoopTimer());
        } else {
            this.ref();
        }

        vm.timer.update(this.eventLoopTimer(), &now);
        this.flags.has_cleared_timer = false;

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
};

pub const Kind = enum(u2) {
    setTimeout = 0,
    setInterval = 1,
    setImmediate = 2,

    pub fn big(this: Kind) Big {
        return @enumFromInt(@intFromEnum(this));
    }

    pub const Big = enum(u32) {
        setTimeout = 0,
        setInterval = 1,
        setImmediate = 2,
    };
};

// this is sized to be the same as one pointer
pub const ID = extern struct {
    id: i32,

    kind: Kind.Big = .setTimeout,

    pub inline fn asyncID(this: ID) u64 {
        return @bitCast(this);
    }

    pub fn repeats(this: ID) bool {
        return this.kind == .setInterval;
    }
};

const assert = bun.assert;
const heap = bun.io.heap;

pub const EventLoopTimer = struct {
    /// The absolute time to fire this timer next.
    next: timespec,
    state: State = .PENDING,
    tag: Tag,
    /// Internal heap fields.
    heap: heap.IntrusiveField(EventLoopTimer) = .{},

    pub fn initPaused(tag: Tag) EventLoopTimer {
        return .{
            .next = .{},
            .tag = tag,
        };
    }

    pub fn less(_: void, a: *const EventLoopTimer, b: *const EventLoopTimer) bool {
        const sec_order = std.math.order(a.next.sec, b.next.sec);
        if (sec_order != .eq) return sec_order == .lt;

        // collapse sub-millisecond precision for JavaScript timers
        const maybe_a_internals = a.jsTimerInternals();
        const maybe_b_internals = b.jsTimerInternals();
        var a_ns = a.next.nsec;
        var b_ns = b.next.nsec;
        if (maybe_a_internals != null) a_ns = std.time.ns_per_ms * @divTrunc(a_ns, std.time.ns_per_ms);
        if (maybe_b_internals != null) b_ns = std.time.ns_per_ms * @divTrunc(b_ns, std.time.ns_per_ms);

        const order = std.math.order(a_ns, b_ns);
        if (order == .eq) {
            if (maybe_a_internals) |a_internals| {
                if (maybe_b_internals) |b_internals| {
                    // We expect that the epoch will overflow sometimes.
                    // If it does, we would ideally like timers with an epoch from before the
                    // overflow to be sorted *before* timers with an epoch from after the overflow
                    // (even though their epoch will be numerically *larger*).
                    //
                    // Wrapping subtraction gives us a distance that is consistent even if one
                    // epoch has overflowed and the other hasn't. If the distance from a to b is
                    // small, it's likely that b is really newer than a, so we consider a less than
                    // b. If the distance from a to b is large (greater than half the u25 range),
                    // it's more likely that b is older than a so the true distance is from b to a.
                    return b_internals.flags.epoch -% a_internals.flags.epoch < std.math.maxInt(u25) / 2;
                }
            }
        }
        return order == .lt;
    }

    pub const Tag = if (Environment.isWindows) enum {
        TimerCallback,
        TimeoutObject,
        ImmediateObject,
        TestRunner,
        StatWatcherScheduler,
        UpgradedDuplex,
        DNSResolver,
        WindowsNamedPipe,
        WTFTimer,
        PostgresSQLConnectionTimeout,
        PostgresSQLConnectionMaxLifetime,
        ValkeyConnectionTimeout,
        ValkeyConnectionReconnect,
        SubprocessTimeout,
        DevServerSweepSourceMaps,
        DevServerMemoryVisualizerTick,

        pub fn Type(comptime T: Tag) type {
            return switch (T) {
                .TimerCallback => TimerCallback,
                .TimeoutObject => TimeoutObject,
                .ImmediateObject => ImmediateObject,
                .TestRunner => JSC.Jest.TestRunner,
                .StatWatcherScheduler => StatWatcherScheduler,
                .UpgradedDuplex => uws.UpgradedDuplex,
                .DNSResolver => DNSResolver,
                .WindowsNamedPipe => uws.WindowsNamedPipe,
                .WTFTimer => WTFTimer,
                .PostgresSQLConnectionTimeout => JSC.Postgres.PostgresSQLConnection,
                .PostgresSQLConnectionMaxLifetime => JSC.Postgres.PostgresSQLConnection,
                .SubprocessTimeout => JSC.Subprocess,
                .ValkeyConnectionReconnect => JSC.API.Valkey,
                .ValkeyConnectionTimeout => JSC.API.Valkey,
                .DevServerSweepSourceMaps,
                .DevServerMemoryVisualizerTick,
                => bun.bake.DevServer,
            };
        }
    } else enum {
        TimerCallback,
        TimeoutObject,
        ImmediateObject,
        TestRunner,
        StatWatcherScheduler,
        UpgradedDuplex,
        WTFTimer,
        DNSResolver,
        PostgresSQLConnectionTimeout,
        PostgresSQLConnectionMaxLifetime,
        ValkeyConnectionTimeout,
        ValkeyConnectionReconnect,
        SubprocessTimeout,
        DevServerSweepSourceMaps,
        DevServerMemoryVisualizerTick,

        pub fn Type(comptime T: Tag) type {
            return switch (T) {
                .TimerCallback => TimerCallback,
                .TimeoutObject => TimeoutObject,
                .ImmediateObject => ImmediateObject,
                .TestRunner => JSC.Jest.TestRunner,
                .StatWatcherScheduler => StatWatcherScheduler,
                .UpgradedDuplex => uws.UpgradedDuplex,
                .WTFTimer => WTFTimer,
                .DNSResolver => DNSResolver,
                .PostgresSQLConnectionTimeout => JSC.Postgres.PostgresSQLConnection,
                .PostgresSQLConnectionMaxLifetime => JSC.Postgres.PostgresSQLConnection,
                .ValkeyConnectionTimeout => JSC.API.Valkey,
                .ValkeyConnectionReconnect => JSC.API.Valkey,
                .SubprocessTimeout => JSC.Subprocess,
                .DevServerSweepSourceMaps,
                .DevServerMemoryVisualizerTick,
                => bun.bake.DevServer,
            };
        }
    };

    const TimerCallback = struct {
        callback: *const fn (*TimerCallback) Arm,
        ctx: *anyopaque,
        event_loop_timer: EventLoopTimer,
    };

    pub const State = enum {
        /// The timer is waiting to be enabled.
        PENDING,

        /// The timer is active and will fire at the next time.
        ACTIVE,

        /// The timer has been cancelled and will not fire.
        CANCELLED,

        /// The timer has fired and the callback has been called.
        FIRED,
    };

    /// If self was created by set{Immediate,Timeout,Interval}, get a pointer to the common data
    /// for all those kinds of timers
    fn jsTimerInternals(self: anytype) switch (@TypeOf(self)) {
        *EventLoopTimer => ?*TimerObjectInternals,
        *const EventLoopTimer => ?*const TimerObjectInternals,
        else => |T| @compileError("wrong type " ++ @typeName(T) ++ " passed to jsTimerInternals"),
    } {
        switch (self.tag) {
            inline .TimeoutObject, .ImmediateObject => |tag| {
                const parent: switch (@TypeOf(self)) {
                    *EventLoopTimer => *tag.Type(),
                    *const EventLoopTimer => *const tag.Type(),
                    else => unreachable,
                } = @fieldParentPtr("event_loop_timer", self);
                return &parent.internals;
            },
            else => return null,
        }
    }

    fn ns(self: *const EventLoopTimer) u64 {
        return self.next.ns();
    }

    pub const Arm = union(enum) {
        rearm: timespec,
        disarm,
    };

    pub fn fire(this: *EventLoopTimer, now: *const timespec, vm: *VirtualMachine) Arm {
        switch (this.tag) {
            .PostgresSQLConnectionTimeout => return @as(*api.Postgres.PostgresSQLConnection, @alignCast(@fieldParentPtr("timer", this))).onConnectionTimeout(),
            .PostgresSQLConnectionMaxLifetime => return @as(*api.Postgres.PostgresSQLConnection, @alignCast(@fieldParentPtr("max_lifetime_timer", this))).onMaxLifetimeTimeout(),
            .ValkeyConnectionTimeout => return @as(*api.Valkey, @alignCast(@fieldParentPtr("timer", this))).onConnectionTimeout(),
            .ValkeyConnectionReconnect => return @as(*api.Valkey, @alignCast(@fieldParentPtr("reconnect_timer", this))).onReconnectTimer(),
            .DevServerMemoryVisualizerTick => return bun.bake.DevServer.emitMemoryVisualizerMessageTimer(this, now),
            .DevServerSweepSourceMaps => return bun.bake.DevServer.SourceMapStore.sweepWeakRefs(this, now),
            inline else => |t| {
                if (@FieldType(t.Type(), "event_loop_timer") != EventLoopTimer) {
                    @compileError(@typeName(t.Type()) ++ " has wrong type for 'event_loop_timer'");
                }
                var container: *t.Type() = @alignCast(@fieldParentPtr("event_loop_timer", this));
                if (comptime t.Type() == TimeoutObject or t.Type() == ImmediateObject) {
                    return container.internals.fire(now, vm);
                }

                if (comptime t.Type() == WTFTimer) {
                    return container.fire(now, vm);
                }

                if (comptime t.Type() == StatWatcherScheduler) {
                    return container.timerCallback();
                }
                if (comptime t.Type() == uws.UpgradedDuplex) {
                    return container.onTimeout();
                }
                if (Environment.isWindows) {
                    if (comptime t.Type() == uws.WindowsNamedPipe) {
                        return container.onTimeout();
                    }
                }

                if (comptime t.Type() == JSC.Jest.TestRunner) {
                    container.onTestTimeout(now, vm);
                    return .disarm;
                }

                if (comptime t.Type() == DNSResolver) {
                    return container.checkTimeouts(now, vm);
                }

                if (comptime t.Type() == JSC.Subprocess) {
                    return container.timeoutCallback();
                }

                return container.callback(container);
            },
        }
    }

    pub fn deinit(_: *EventLoopTimer) void {}
};

const timespec = bun.timespec;

/// A timer created by WTF code and invoked by Bun's event loop
pub const WTFTimer = @import("../WTFTimer.zig");

pub const internal_bindings = struct {
    /// Node.js has some tests that check whether timers fire at the right time. They check this
    /// with the internal binding `getLibuvNow()`, which returns an integer in milliseconds. This
    /// works because `getLibuvNow()` is also the clock that their timers implementation uses to
    /// choose when to schedule timers.
    ///
    /// I've tried changing those tests to use `performance.now()` or `Date.now()`. But that always
    /// introduces spurious failures, because neither of those functions use the same clock that the
    /// timers implementation uses (for Bun this is `bun.timespec.now()`), so the tests end up
    /// thinking that the timing is wrong (this also happens when I run the modified test in
    /// Node.js). So the best course of action is for Bun to also expose a function that reveals the
    /// clock that is used to schedule timers.
    pub fn timerClockMs(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
        _ = globalThis;
        _ = callFrame;
        const now = timespec.now().ms();
        return .jsNumberFromInt64(now);
    }
};
