#active: bool = false,
/// The sorted fake timers. TimerHeap is not optimal here because we need these operations:
/// - peek/takeFirst (provided by TimerHeap)
/// - peekLast (cannot be implemented efficiently with TimerHeap)
/// - count (cannot be implemented efficiently with TimerHeap)
timers: TimerHeap = .{ .context = {} },
/// Promises returned from timer callbacks (for async methods)
#tracked_promises: std.ArrayListUnmanaged(jsc.Strong) = .{},

pub var current_time: struct {
    const PackedTime = packed struct(u128) {
        sec: i64,
        nsec: i64,
        const min: PackedTime = .{ .sec = std.math.minInt(i64), .nsec = std.math.minInt(i64) };
    };
    #timespec_now: std.atomic.Value(PackedTime) = .init(.min),
    date_now_offset: f64 = 0,
    pub fn getTimespecNow(this: *@This()) ?bun.timespec {
        const value = this.#timespec_now.load(.seq_cst);
        if (value == PackedTime.min) return null;
        return .{ .sec = value.sec, .nsec = value.nsec };
    }
    pub fn set(this: *@This(), globalObject: *jsc.JSGlobalObject, value: ?struct {
        timespec: *const bun.timespec,
        js: ?f64,
    }) void {
        const vm = globalObject.bunVM();
        if (value) |v| {
            this.#timespec_now.store(.{ .sec = v.timespec.sec, .nsec = v.timespec.nsec }, .seq_cst);
            const timespec_ms: f64 = @floatFromInt(v.timespec.ms());
            if (v.js) |js| {
                this.date_now_offset = js - timespec_ms;
            }
            bun.cpp.JSMock__setOverridenDateNow(globalObject, this.date_now_offset + timespec_ms);

            // Also override performance.now() with the same time (in nanoseconds)
            const timespec_nano: u64 = @as(u64, @intCast(v.timespec.sec)) * std.time.ns_per_s + @as(u64, @intCast(v.timespec.nsec));
            vm.overridden_performance_now = timespec_nano;
        } else {
            this.#timespec_now.store(.min, .seq_cst);
            bun.cpp.JSMock__setOverridenDateNow(globalObject, -1.0);
            // Clear the performance.now() override
            vm.overridden_performance_now = null;
        }
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
fn activate(this: *FakeTimers, timespec_now: bun.timespec, js_now: f64, globalObject: *jsc.JSGlobalObject) void {
    this.assertValid(.locked);
    defer this.assertValid(.locked);

    this.#active = true;
    current_time.set(globalObject, .{ .timespec = &timespec_now, .js = js_now });
}
fn deactivate(this: *FakeTimers, globalObject: *jsc.JSGlobalObject) void {
    this.assertValid(.locked);
    defer this.assertValid(.locked);

    this.clear();
    this.clearTrackedPromises();
    current_time.set(globalObject, null);
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
fn advanceTimeWithoutFiringTimers(this: *FakeTimers, ms: i64) void {
    this.assertValid(.locked);
    defer this.assertValid(.locked);

    this.#current_time = this.#current_time.addMs(ms);
}
fn executeNext(this: *FakeTimers, globalObject: *jsc.JSGlobalObject) bool {
    this.assertValid(.unlocked);
    defer this.assertValid(.unlocked);
    const vm = globalObject.bunVM();
    const timers = &vm.timer;

    const next = blk: {
        timers.lock.lock();
        defer timers.lock.unlock();
        break :blk this.timers.deleteMin() orelse return false;
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
    current_time.set(globalObject, .{ .timespec = &now, .js = null });
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

fn useFakeTimers(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;

    const js_now = bun.cpp.JSMock__getCurrentUnixTimeMs();
    const timespec_now = bun.timespec.now();

    {
        timers.lock.lock();
        defer timers.lock.unlock();
        this.activate(timespec_now, js_now, globalObject);
    }

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
    const timeoutAdd = try globalObject.validateIntegerRange(arg, u32, 0, .{ .min = 0, .field_name = "ms" });
    const target = bun.timespec.now().addMs(timeoutAdd);

    this.executeUntil(globalObject, target);
    current_time.set(globalObject, .{ .timespec = &target, .js = null });

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

// ===
// Promise Tracking for Async Methods
// ===

fn clearTrackedPromises(this: *FakeTimers) void {
    for (this.#tracked_promises.items) |*strong| {
        strong.deinit();
    }
    this.#tracked_promises.clearRetainingCapacity();
}

fn trackPromise(this: *FakeTimers, globalObject: *jsc.JSGlobalObject, promise: jsc.JSValue) void {
    const strong = jsc.Strong.create(promise, globalObject);
    this.#tracked_promises.append(bun.default_allocator, strong) catch bun.outOfMemory();
}

export fn Bun__FakeTimers__trackPromise(globalObject: *jsc.JSGlobalObject, promise_value: jsc.JSValue) callconv(.C) void {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;

    const is_active = blk: {
        timers.lock.lock();
        defer timers.lock.unlock();
        break :blk this.isActive();
    };

    if (!is_active) return;

    this.trackPromise(globalObject, promise_value);
}

extern "c" fn Bun__FakeTimers__createPromiseAll(globalObject: *jsc.JSGlobalObject, promises_array: jsc.JSValue, vitest_obj: jsc.JSValue) jsc.JSValue;

fn createPromiseAllForTrackedPromises(this: *FakeTimers, globalObject: *jsc.JSGlobalObject, vitest_obj: jsc.JSValue) jsc.JSValue {
    defer this.clearTrackedPromises();

    if (this.#tracked_promises.items.len == 0) {
        // No promises to wait for, return a resolved promise with vitest_obj
        const promise = jsc.JSPromise.create(globalObject);
        const value = promise.asValue(globalObject);
        promise.resolve(globalObject, vitest_obj) catch {
            // VM terminated, just return the promise
        };
        return value;
    }

    // Create an array of promises
    const promises_array = jsc.JSValue.createEmptyArray(globalObject, this.#tracked_promises.items.len) catch {
        // Failed to create array, return a resolved promise
        const promise = jsc.JSPromise.create(globalObject);
        const value = promise.asValue(globalObject);
        promise.resolve(globalObject, vitest_obj) catch {};
        return value;
    };
    for (this.#tracked_promises.items, 0..) |*strong, i| {
        const promise_val = strong.get();
        promises_array.putIndex(globalObject, @intCast(i), promise_val) catch {};
    }

    return Bun__FakeTimers__createPromiseAll(globalObject, promises_array, vitest_obj);
}

// ===
// Async Timer Functions
// ===

fn advanceTimersToNextTimerAsync(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;
    try errorUnlessFakeTimers(globalObject);

    this.clearTrackedPromises();
    _ = this.executeNext(globalObject);

    return this.createPromiseAllForTrackedPromises(globalObject, callframe.this());
}

fn advanceTimersByTimeAsync(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;
    try errorUnlessFakeTimers(globalObject);

    const arg = callframe.argumentsAsArray(1)[0];
    if (!arg.isNumber()) {
        return globalObject.throwInvalidArguments("advanceTimersByTimeAsync() expects a number of milliseconds", .{});
    }
    const timeoutAdd = try globalObject.validateIntegerRange(arg, u32, 0, .{ .min = 0, .field_name = "ms" });
    const target = bun.timespec.now().addMs(timeoutAdd);

    this.clearTrackedPromises();
    this.executeUntil(globalObject, target);
    current_time.set(globalObject, .{ .timespec = &target, .js = null });

    return this.createPromiseAllForTrackedPromises(globalObject, callframe.this());
}

fn runOnlyPendingTimersAsync(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;
    try errorUnlessFakeTimers(globalObject);

    this.clearTrackedPromises();
    _ = this.executeOnlyPendingTimers(globalObject);

    return this.createPromiseAllForTrackedPromises(globalObject, callframe.this());
}

fn runAllTimersAsync(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    const this = &timers.fake_timers;
    try errorUnlessFakeTimers(globalObject);

    this.clearTrackedPromises();
    _ = this.executeAllTimers(globalObject);

    return this.createPromiseAllForTrackedPromises(globalObject, callframe.this());
}

const fake_timers_fns: []const struct { [:0]const u8, u32, (fn (*jsc.JSGlobalObject, *jsc.CallFrame) bun.JSError!jsc.JSValue) } = &.{
    .{ "useFakeTimers", 0, useFakeTimers },
    .{ "useRealTimers", 0, useRealTimers },
    .{ "advanceTimersToNextTimer", 0, advanceTimersToNextTimer },
    .{ "advanceTimersByTime", 1, advanceTimersByTime },
    .{ "runOnlyPendingTimers", 0, runOnlyPendingTimers },
    .{ "runAllTimers", 0, runAllTimers },
    .{ "advanceTimersToNextTimerAsync", 0, advanceTimersToNextTimerAsync },
    .{ "advanceTimersByTimeAsync", 1, advanceTimersByTimeAsync },
    .{ "runOnlyPendingTimersAsync", 0, runOnlyPendingTimersAsync },
    .{ "runAllTimersAsync", 0, runAllTimersAsync },
    .{ "getTimerCount", 0, getTimerCount },
    .{ "clearAllTimers", 0, clearAllTimers },
    .{ "isFakeTimers", 0, isFakeTimers },
};
pub const timerFnsCount = fake_timers_fns.len;
pub fn putTimersFns(globalObject: *jsc.JSGlobalObject, jest: jsc.JSValue, vi: jsc.JSValue) void {
    inline for (fake_timers_fns) |fake_timer_fn| {
        const str = bun.ZigString.static(fake_timer_fn[0]);
        const jsvalue = jsc.host_fn.NewFunction(globalObject, str, fake_timer_fn[1], fake_timer_fn[2], false);
        vi.put(globalObject, str, jsvalue);
        jest.put(globalObject, str, jsvalue);
    }
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const TimerHeap = bun.api.Timer.TimerHeap;
const FakeTimers = bun.jsc.Jest.bun_test.FakeTimers;

comptime {
    _ = &Bun__FakeTimers__trackPromise;
}
