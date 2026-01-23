const Timer = @This();

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

pub const TimerHeap = heap.Intrusive(EventLoopTimer, void, EventLoopTimer.less);

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

    // Event loop delay monitoring (not exposed to JS)
    event_loop_delay: EventLoopDelayMonitor = .{},

    fake_timers: FakeTimers = .{},

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

    /// Updates the "Date" header.
    date_header_timer: DateHeaderTimer = .{},

    pub fn init() @This() {
        return .{
            .thread_id = std.Thread.getCurrentId(),
        };
    }

    pub fn insert(this: *All, timer: *EventLoopTimer) void {
        this.lock.lock();
        defer this.lock.unlock();
        this.insertLockHeld(timer);
    }

    fn insertLockHeld(this: *All, timer: *EventLoopTimer) void {
        if (Environment.ci_assert) bun.assert(this.lock.tryLock() == false);
        if (this.fake_timers.isActive() and timer.tag.allowFakeTimers()) {
            this.fake_timers.timers.insert(timer);
            timer.state = .ACTIVE;
            timer.in_heap = .fake;
        } else {
            this.timers.insert(timer);
            timer.state = .ACTIVE;
            timer.in_heap = .regular;

            if (Environment.isWindows) {
                this.ensureUVTimer(@alignCast(@fieldParentPtr("timer", this)));
            }
        }
    }

    pub fn remove(this: *All, timer: *EventLoopTimer) void {
        this.lock.lock();
        defer this.lock.unlock();
        this.removeLockHeld(timer);
    }
    fn removeLockHeld(this: *All, timer: *EventLoopTimer) void {
        if (Environment.ci_assert) bun.assert(this.lock.tryLock() == false);
        switch (timer.in_heap) {
            .none => if (Environment.ci_assert) bun.assert(false), // can't remove a timer that was not inserted
            .regular => this.timers.remove(timer),
            .fake => this.fake_timers.timers.remove(timer),
        }
        timer.in_heap = .none;
        timer.state = .CANCELLED;
    }

    /// Remove the EventLoopTimer if necessary.
    pub fn update(this: *All, timer: *EventLoopTimer, time: *const timespec) void {
        this.lock.lock();
        defer this.lock.unlock();
        if (timer.state == .ACTIVE) {
            this.removeLockHeld(timer);
        }

        if (Environment.ci_assert) {
            if (&timer.next == time) {
                @panic("timer.next == time. For threadsafety reasons, time and timer.next must always be a different pointer.");
            }
        }

        timer.next = time.*;
        if (timer.jsTimerInternalsFlags()) |flags| {
            this.epoch +%= 1;
            flags.epoch = this.epoch;
        }

        this.insertLockHeld(timer);
    }

    fn ensureUVTimer(this: *All, vm: *VirtualMachine) void {
        if (this.uv_timer.data == null) {
            this.uv_timer.init(vm.uvLoop());
            this.uv_timer.data = vm;
            this.uv_timer.unref();
        }

        if (this.timers.peek()) |timer| {
            uv.uv_update_time(vm.uvLoop());
            const now = timespec.now(.force_real_time);
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

    pub fn onUVTimer(uv_timer_t: *uv.Timer) callconv(.c) void {
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
                    fn cb(_: *uv.uv_idle_t) callconv(.c) void {
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
        const vm: *jsc.VirtualMachine = @alignCast(@fieldParentPtr("timer", this));

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

    pub fn getNextID() callconv(.c) i32 {
        VirtualMachine.get().timer.last_id +%= 1;
        return VirtualMachine.get().timer.last_id;
    }

    fn isDateTimerActive(this: *const All) bool {
        return this.date_header_timer.event_loop_timer.state == .ACTIVE;
    }

    pub fn updateDateHeaderTimerIfNecessary(this: *All, loop: *const uws.Loop, vm: *VirtualMachine) void {
        if (loop.shouldEnableDateHeaderTimer()) {
            if (!this.isDateTimerActive()) {
                this.date_header_timer.enable(
                    vm,
                    // Be careful to avoid adding extra calls to bun.timespec.now()
                    // when it's not needed.
                    &bun.timespec.now(.allow_mocked_time),
                );
            }
        } else {
            // don't un-schedule it here.
            // it's better to wake up an extra 1 time after a second idle
            // than to have to check a date potentially on every single HTTP request.
        }
    }

    pub fn getTimeout(this: *All, spec: *timespec, vm: *VirtualMachine) bool {
        var maybe_now: ?timespec = null;
        while (this.timers.peek()) |min| {
            const now = maybe_now orelse now: {
                const real_now = timespec.now(.allow_mocked_time);
                maybe_now = real_now;
                break :now real_now;
            };

            switch (now.order(&min.next)) {
                .gt, .eq => {
                    // Side-effect: potentially call the StopIfNecessary timer.
                    if (min.tag == .WTFTimer) {
                        _ = this.timers.deleteMin();
                        min.fire(&now, vm);
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

    export fn Bun__internal_drainTimers(vm: *VirtualMachine) callconv(.c) void {
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
                now.* = timespec.now(.allow_mocked_time);
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
        // Set in next().
        var now: timespec = undefined;
        // Split into a separate variable to avoid increasing the size of the timespec type.
        var has_set_now: bool = false;

        while (this.next(&has_set_now, &now)) |t| {
            t.fire(&now, vm);
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
                ) catch |err| bun.handleOom(err)
            else
                // -Infinity is handled by TimeoutNegativeWarning
                bun.String.ascii("Infinity does not fit into a 32-bit signed integer" ++ suffix),
            .TimeoutNegativeWarning => if (std.math.isFinite(countdown))
                bun.String.createFormat(
                    "{d} is a negative number" ++ suffix,
                    .{countdown},
                ) catch |err| bun.handleOom(err)
            else
                bun.String.ascii("-Infinity is a negative number" ++ suffix),
            // std.fmt gives us "nan" but Node.js wants "NaN".
            .TimeoutNaNWarning => nan_warning: {
                assert(std.math.isNan(countdown));
                break :nan_warning bun.String.ascii("NaN is not a number" ++ suffix);
            },
        };
        var warning_type_string = bun.String.createAtomIfPossible(@tagName(warning_type));
        // Ignore errors from transferToJS since this is just a warning and shouldn't interrupt execution
        const warning_js = warning_string.transferToJS(globalThis) catch return;
        const warning_type_js = warning_type_string.transferToJS(globalThis) catch return;
        globalThis.emitWarning(
            warning_js,
            warning_type_js,
            .js_undefined,
            .js_undefined,
        ) catch {};
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
        jsc.markBinding(@src());
        bun.debugAssert(promise != .zero and countdown != .zero);
        const vm = global.bunVM();
        const id = vm.timer.last_id;
        vm.timer.last_id +%= 1;

        const countdown_int = try vm.timer.jsValueToCountdown(global, countdown, .clamp, true);
        const wrapped_promise = promise.withAsyncContextIfNeeded(global);
        return TimeoutObject.init(global, id, .setTimeout, countdown_int, wrapped_promise, .js_undefined);
    }

    pub fn setImmediate(
        global: *JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
    ) JSError!JSValue {
        jsc.markBinding(@src());
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
        jsc.markBinding(@src());
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
        jsc.markBinding(@src());
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
        jsc.markBinding(@src());

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
                // clearImmediate should be a noop if anything other than an Immediate is passed to it.
                if (kind != .setImmediate) &timeout.internals else return
            else if (ImmediateObject.fromJS(timer_id_value)) |immediate|
                // setImmediate can only be cleared by clearImmediate, not by clearTimeout or clearInterval.
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
        jsc.markBinding(@src());
        try clearTimer(id, globalThis, .setImmediate);
        return .js_undefined;
    }
    pub fn clearTimeout(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) JSError!JSValue {
        jsc.markBinding(@src());
        try clearTimer(id, globalThis, .setTimeout);
        return .js_undefined;
    }
    pub fn clearInterval(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) JSError!JSValue {
        jsc.markBinding(@src());
        try clearTimer(id, globalThis, .setInterval);
        return .js_undefined;
    }

    comptime {
        @export(&jsc.host_fn.wrap3(setImmediate), .{ .name = "Bun__Timer__setImmediate" });
        @export(&jsc.host_fn.wrap3(sleep), .{ .name = "Bun__Timer__sleep" });
        @export(&jsc.host_fn.wrap4(setTimeout), .{ .name = "Bun__Timer__setTimeout" });
        @export(&jsc.host_fn.wrap4(setInterval), .{ .name = "Bun__Timer__setInterval" });
        @export(&jsc.host_fn.wrap2(clearImmediate), .{ .name = "Bun__Timer__clearImmediate" });
        @export(&jsc.host_fn.wrap2(clearTimeout), .{ .name = "Bun__Timer__clearTimeout" });
        @export(&jsc.host_fn.wrap2(clearInterval), .{ .name = "Bun__Timer__clearInterval" });
        @export(&getNextID, .{ .name = "Bun__Timer__getNextID" });
    }
};

pub const EventLoopTimer = @import("./Timer/EventLoopTimer.zig");

pub const TimeoutObject = @import("./Timer/TimeoutObject.zig");
pub const ImmediateObject = @import("./Timer/ImmediateObject.zig");
pub const TimerObjectInternals = @import("./Timer/TimerObjectInternals.zig");

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

/// A timer created by WTF code and invoked by Bun's event loop
pub const WTFTimer = @import("./Timer/WTFTimer.zig");

pub const DateHeaderTimer = @import("./Timer/DateHeaderTimer.zig");

pub const EventLoopDelayMonitor = @import("./Timer/EventLoopDelayMonitor.zig");

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
    pub fn timerClockMs(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
        _ = globalThis;
        _ = callFrame;
        const now = timespec.now(.allow_mocked_time).ms();
        return .jsNumberFromInt64(now);
    }
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const JSError = bun.JSError;
const assert = bun.assert;
const timespec = bun.timespec;
const uws = bun.uws;
const heap = bun.io.heap;
const uv = bun.windows.libuv;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const FakeTimers = bun.jsc.Jest.bun_test.FakeTimers;
