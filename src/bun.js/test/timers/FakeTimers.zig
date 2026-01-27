#active: bool = false,
/// The sorted fake timers. TimerHeap is not optimal here because we need these operations:
/// - peek/takeFirst (provided by TimerHeap)
/// - peekLast (cannot be implemented efficiently with TimerHeap)
/// - count (cannot be implemented efficiently with TimerHeap)
timers: TimerHeap = .{ .context = {} },

/// Auto-advance timer that runs in real time and periodically advances fake time.
/// When advanceTimers option is enabled, this timer fires every N milliseconds of real time
/// and advances the fake clock by the same amount.
#auto_advance_timer: bun.api.Timer.EventLoopTimer = .{
    .tag = .FakeTimersAutoAdvance,
    .next = .epoch,
},
/// The interval in milliseconds for auto-advancing timers.
/// 0 means auto-advance is disabled.
#auto_advance_interval_ms: u32 = 0,

pub var current_time: struct {
    const min_timespec = bun.timespec{ .sec = std.math.minInt(i64), .nsec = std.math.minInt(i64) };
    /// starts at 0. offset in milliseconds.
    offset_raw: bun.timespec = min_timespec,
    offset_lock: std.Thread.RwLock = .{},
    date_now_offset: f64 = 0,
    pub fn getTimespecNow(this: *@This()) ?bun.timespec {
        this.offset_lock.lockShared();
        defer this.offset_lock.unlockShared();
        const value = this.offset_raw;
        if (value.eql(&min_timespec)) return null;
        return value;
    }
    pub fn set(this: *@This(), globalObject: *jsc.JSGlobalObject, v: struct {
        offset: *const bun.timespec,
        js: ?f64 = null,
    }) void {
        const vm = globalObject.bunVM();
        {
            this.offset_lock.lock();
            defer this.offset_lock.unlock();
            this.offset_raw = v.offset.*;
        }
        const timespec_ms: f64 = @floatFromInt(v.offset.ms());
        if (v.js) |js| {
            this.date_now_offset = @floor(js) - timespec_ms;
        }
        bun.cpp.JSMock__setOverridenDateNow(globalObject, this.date_now_offset + timespec_ms);

        vm.overridden_performance_now = @bitCast(v.offset.ns());
    }
    pub fn clear(this: *@This(), globalObject: *jsc.JSGlobalObject) void {
        const vm = globalObject.bunVM();
        {
            this.offset_lock.lock();
            defer this.offset_lock.unlock();
            this.offset_raw = min_timespec;
        }
        bun.cpp.JSMock__setOverridenDateNow(globalObject, -1);
        vm.overridden_performance_now = null;
    }
} = .{};

fn assertValid(this: *FakeTimers, mode: enum { locked, unlocked }) void {
    if (!bun.Environment.ci_assert) return;
    const owner: *bun.api.Timer.All = @fieldParentPtr("fake_timers", this);
    switch (mode) {
        .locked => bun.assert(owner.lock.tryLock() == false),
        .unlocked => {}, // can't assert unlocked because another thread could be holding the lock
    }
}

pub fn isActive(this: *FakeTimers) bool {
    this.assertValid(.locked);
    defer this.assertValid(.locked);

    return this.#active;
}
fn activate(this: *FakeTimers, js_now: f64, globalObject: *jsc.JSGlobalObject, auto_advance_ms: u32) void {
    this.assertValid(.locked);
    defer this.assertValid(.locked);

    this.#active = true;
    this.#auto_advance_interval_ms = auto_advance_ms;
    current_time.set(globalObject, .{ .offset = &.epoch, .js = js_now });
}
fn deactivate(this: *FakeTimers, globalObject: *jsc.JSGlobalObject) void {
    this.assertValid(.locked);
    defer this.assertValid(.locked);

    this.clear();
    this.stopAutoAdvanceTimer(globalObject);
    current_time.clear(globalObject);
    this.#active = false;
}
fn clear(this: *FakeTimers) void {
    this.assertValid(.locked);
    defer this.assertValid(.locked);

    while (this.timers.deleteMin()) |timer| {
        timer.state = .CANCELLED;
        timer.in_heap = .none;
    }
}
fn executeNext(this: *FakeTimers, globalObject: *jsc.JSGlobalObject) bool {
    this.assertValid(.unlocked);
    defer this.assertValid(.unlocked);
    const vm = globalObject.bunVM();
    const timers = &vm.timer;

    const next = blk: {
        timers.lock.lock();
        defer timers.lock.unlock();
        const timer = this.timers.deleteMin() orelse return false;
        timer.in_heap = .none;
        break :blk timer;
    };

    this.fire(globalObject, next);
    return true;
}
fn fire(this: *FakeTimers, globalObject: *jsc.JSGlobalObject, next: *bun.api.Timer.EventLoopTimer) void {
    this.assertValid(.unlocked);
    defer this.assertValid(.unlocked);
    const vm = globalObject.bunVM();

    if (bun.Environment.ci_assert) {
        const prev = current_time.getTimespecNow();
        bun.assert(prev != null);
        bun.assert(next.next.eql(&prev.?) or next.next.greater(&prev.?));
    }
    const now = next.next;
    current_time.set(globalObject, .{ .offset = &now });
    next.fire(&now, vm);
}
fn executeUntil(this: *FakeTimers, globalObject: *jsc.JSGlobalObject, until: bun.timespec) void {
    this.assertValid(.unlocked);
    defer this.assertValid(.unlocked);
    const vm = globalObject.bunVM();
    const timers = &vm.timer;

    while (true) {
        const next = blk: {
            timers.lock.lock();
            defer timers.lock.unlock();

            const peek = this.timers.peek() orelse break;
            if (peek.next.greater(&until)) break;
            bun.assert(this.timers.deleteMin() == peek);
            peek.in_heap = .none;
            break :blk peek;
        };
        this.fire(globalObject, next);
    }
}
fn executeOnlyPendingTimers(this: *FakeTimers, globalObject: *jsc.JSGlobalObject) void {
    this.assertValid(.unlocked);
    defer this.assertValid(.unlocked);
    const vm = globalObject.bunVM();
    const timers = &vm.timer;

    const target = blk: {
        timers.lock.lock();
        defer timers.lock.unlock();
        break :blk this.timers.findMax() orelse return;
    };
    const until = target.next;
    this.executeUntil(globalObject, until);
}
fn executeAllTimers(this: *FakeTimers, globalObject: *jsc.JSGlobalObject) void {
    this.assertValid(.unlocked);
    defer this.assertValid(.unlocked);

    while (this.executeNext(globalObject)) {}
}

// ===
// Auto-advance timer
// ===

/// Called when the auto-advance timer fires (in real time).
/// This advances fake time by the configured interval and fires any timers that are ready.
pub fn onAutoAdvanceTimer(this: *FakeTimers, vm: *jsc.VirtualMachine) void {
    this.assertValid(.unlocked);
    defer this.assertValid(.unlocked);

    const interval_ms = this.#auto_advance_interval_ms;
    if (interval_ms == 0) return;

    const globalObject = vm.global;
    const timers = &vm.timer;

    // Check if fake timers are still active
    {
        timers.lock.lock();
        defer timers.lock.unlock();
        if (!this.isActive()) return;
    }

    // Get current fake time and advance it
    const current = current_time.getTimespecNow() orelse return;
    const target = current.addMs(interval_ms);

    // Execute all timers up to the target time.
    // Note: This may trigger JavaScript callbacks that could call useRealTimers(),
    // so we need to check isActive() again after this returns.
    this.executeUntil(globalObject, target);

    // Re-check if fake timers are still active after executing timers.
    // JavaScript code in timer callbacks may have called useRealTimers().
    {
        timers.lock.lock();
        defer timers.lock.unlock();
        if (!this.isActive()) return;
    }

    current_time.set(globalObject, .{ .offset = &target });

    // Reschedule ourselves using real time
    this.scheduleAutoAdvanceTimer(vm);
}

/// Schedule the auto-advance timer to fire after the configured interval (in real time).
fn scheduleAutoAdvanceTimer(this: *FakeTimers, vm: *jsc.VirtualMachine) void {
    const interval_ms = this.#auto_advance_interval_ms;
    if (interval_ms == 0) return;

    const now = bun.timespec.now(.force_real_time);
    this.#auto_advance_timer.next = now.addMs(interval_ms);
    this.#auto_advance_timer.state = .PENDING;

    // Insert into the regular timer heap (not the fake heap) using real time.
    // The FakeTimersAutoAdvance tag has allowFakeTimers() == false so it goes
    // into the regular heap.
    vm.timer.insert(&this.#auto_advance_timer);
}

/// Stop the auto-advance timer. Must be called with timers.lock held.
fn stopAutoAdvanceTimer(this: *FakeTimers, globalObject: *jsc.JSGlobalObject) void {
    const vm = globalObject.bunVM();
    this.#auto_advance_interval_ms = 0;
    // Remove the timer from its heap based on where it's stored
    switch (this.#auto_advance_timer.in_heap) {
        .regular => vm.timer.timers.remove(&this.#auto_advance_timer),
        .fake => this.timers.remove(&this.#auto_advance_timer),
        .none => {}, // Timer is not in any heap (already fired or not yet started)
    }
    this.#auto_advance_timer.in_heap = .none;
    this.#auto_advance_timer.state = .CANCELLED;
}

// ===
// JS Functions
// ===

fn errorUnlessFakeTimers(globalObject: *jsc.JSGlobalObject) bun.JSError!void {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;

    {
        timers.lock.lock();
        defer timers.lock.unlock();
        if (this.isActive()) return;
    }
    return globalObject.throw("Fake timers are not active. Call useFakeTimers() first.", .{});
}

/// Set or remove the "clock" property on setTimeout to indicate that fake timers are active.
/// This is used by testing-library/react's jestFakeTimersAreEnabled() function to detect
/// if jest.advanceTimersByTime() should be called when draining the microtask queue.
fn setFakeTimerMarker(globalObject: *jsc.JSGlobalObject, enabled: bool) void {
    const globalThis_value = globalObject.toJSValue();
    const setTimeout_fn = (globalThis_value.getOwnTruthy(globalObject, "setTimeout") catch return) orelse return;
    // testing-library/react checks Object.hasOwnProperty.call(setTimeout, 'clock')
    // to detect if fake timers are enabled.
    if (enabled) {
        // Set setTimeout.clock = true when enabling fake timers.
        setTimeout_fn.put(globalObject, "clock", .true);
    } else {
        // Delete the clock property when disabling fake timers.
        // This ensures hasOwnProperty returns false, matching Jest/Sinon behavior.
        _ = setTimeout_fn.deleteProperty(globalObject, "clock");
    }
}

fn useFakeTimers(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;

    var js_now = bun.cpp.JSMock__getCurrentUnixTimeMs();
    var auto_advance_ms: u32 = 0;

    // Check if options object was provided
    const args = callframe.argumentsAsArray(1);
    if (args.len > 0 and !args[0].isUndefined()) {
        const options_value = args[0];
        var config = try bindgen_generated.FakeTimersConfig.fromJS(globalObject, options_value);
        defer config.deinit();

        // Check if 'now' field is provided
        if (!config.now.isUndefined()) {
            // Handle both number and Date
            if (config.now.isNumber()) {
                js_now = config.now.asNumber();
            } else if (config.now.isDate()) {
                js_now = config.now.getUnixTimestamp();
            } else {
                return globalObject.throwInvalidArguments("'now' must be a number or Date", .{});
            }
        }

        // Check if 'advanceTimers' field is provided
        // advanceTimers: true means advance by 20ms every 20ms (Jest default)
        // advanceTimers: <number> means advance by that many ms every that many ms
        if (!config.advanceTimers.isUndefined()) {
            if (config.advanceTimers.isBoolean()) {
                if (config.advanceTimers.toBoolean()) {
                    // Default to 20ms like Jest
                    auto_advance_ms = 20;
                }
            } else if (config.advanceTimers.isNumber()) {
                const advance_num = config.advanceTimers.asNumber();
                if (!std.math.isFinite(advance_num)) {
                    return globalObject.throwInvalidArguments("'advanceTimers' must be a finite number", .{});
                }
                if (advance_num < 1 or advance_num > std.math.maxInt(u32)) {
                    return globalObject.throwInvalidArguments("'advanceTimers' must be a positive number", .{});
                }
                auto_advance_ms = @intFromFloat(advance_num);
            } else {
                return globalObject.throwInvalidArguments("'advanceTimers' must be a boolean or number", .{});
            }
        }
    }

    {
        timers.lock.lock();
        defer timers.lock.unlock();
        this.activate(js_now, globalObject, auto_advance_ms);
    }

    // Start auto-advance timer if enabled (must be done outside the lock)
    if (auto_advance_ms > 0) {
        this.scheduleAutoAdvanceTimer(vm);
    }

    // Set setTimeout.clock = true to signal that fake timers are enabled.
    // This is used by testing-library/react to detect if jest.advanceTimersByTime should be called.
    setFakeTimerMarker(globalObject, true);

    return callframe.this();
}
fn useRealTimers(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;

    {
        timers.lock.lock();
        defer timers.lock.unlock();
        this.deactivate(globalObject);
    }

    // Remove the setTimeout.clock marker when switching back to real timers.
    setFakeTimerMarker(globalObject, false);

    return callframe.this();
}
fn advanceTimersToNextTimer(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;
    try errorUnlessFakeTimers(globalObject);

    _ = this.executeNext(globalObject);

    return callframe.this();
}
fn advanceTimersByTime(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;
    try errorUnlessFakeTimers(globalObject);

    const arg = callframe.argumentsAsArray(1)[0];
    if (!arg.isNumber()) {
        return globalObject.throwInvalidArguments("advanceTimersToNextTimer() expects a number of milliseconds", .{});
    }
    const current = current_time.getTimespecNow() orelse return globalObject.throwInvalidArguments("Fake timers not initialized. Initialize with useFakeTimers() first.", .{});
    const arg_number = arg.asNumber();
    const max_advance = std.math.maxInt(u32);
    if (arg_number < 0 or arg_number > max_advance) {
        return globalObject.throwInvalidArguments("advanceTimersToNextTimer() ms is out of range. It must be >= 0 and <= {d}. Received {d:.0}", .{ max_advance, arg_number });
    }
    // When advanceTimersByTime(0) is called, advance by 1ms to fire setTimeout(fn, 0) timers.
    // This is because setTimeout(fn, 0) is internally scheduled with a 1ms delay per HTML spec,
    // and Jest/testing-library expect advanceTimersByTime(0) to fire such "immediate" timers.
    const effective_advance = if (arg_number == 0) 1 else arg_number;
    const target = current.addMsFloat(effective_advance);

    this.executeUntil(globalObject, target);
    current_time.set(globalObject, .{ .offset = &target });

    return callframe.this();
}
fn runOnlyPendingTimers(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;
    try errorUnlessFakeTimers(globalObject);

    _ = this.executeOnlyPendingTimers(globalObject);

    return callframe.this();
}
fn runAllTimers(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;
    try errorUnlessFakeTimers(globalObject);

    _ = this.executeAllTimers(globalObject);

    return callframe.this();
}
fn getTimerCount(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;
    try errorUnlessFakeTimers(globalObject);

    const count = blk: {
        timers.lock.lock();
        defer timers.lock.unlock();
        break :blk this.timers.count();
    };

    return jsc.JSValue.jsNumber(count);
}
fn clearAllTimers(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;
    try errorUnlessFakeTimers(globalObject);

    {
        timers.lock.lock();
        defer timers.lock.unlock();
        this.clear();
    }

    return callframe.this();
}
fn isFakeTimers(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;

    const is_active = blk: {
        timers.lock.lock();
        defer timers.lock.unlock();
        break :blk this.isActive();
    };

    return jsc.JSValue.jsBoolean(is_active);
}

const fake_timers_fns: []const struct { [:0]const u8, u32, (fn (*jsc.JSGlobalObject, *jsc.CallFrame) bun.JSError!jsc.JSValue) } = &.{
    .{ "useFakeTimers", 0, useFakeTimers },
    .{ "useRealTimers", 0, useRealTimers },
    .{ "advanceTimersToNextTimer", 0, advanceTimersToNextTimer },
    .{ "advanceTimersByTime", 1, advanceTimersByTime },
    .{ "runOnlyPendingTimers", 0, runOnlyPendingTimers },
    .{ "runAllTimers", 0, runAllTimers },
    .{ "getTimerCount", 0, getTimerCount },
    .{ "clearAllTimers", 0, clearAllTimers },
    .{ "isFakeTimers", 0, isFakeTimers },
};
pub const timerFnsCount = fake_timers_fns.len;
pub fn putTimersFns(globalObject: *jsc.JSGlobalObject, jest: jsc.JSValue, vi: jsc.JSValue) void {
    inline for (fake_timers_fns) |fake_timer_fn| {
        const str = bun.ZigString.static(fake_timer_fn[0]);
        const jsvalue = jsc.JSFunction.create(globalObject, fake_timer_fn[0], fake_timer_fn[2], fake_timer_fn[1], .{});
        vi.put(globalObject, str, jsvalue);
        jest.put(globalObject, str, jsvalue);
    }
}

const bindgen_generated = @import("bindgen_generated");
const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const TimerHeap = bun.api.Timer.TimerHeap;
const FakeTimers = bun.jsc.Jest.bun_test.FakeTimers;
