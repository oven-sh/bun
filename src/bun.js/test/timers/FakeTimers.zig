#active: bool = false,
timers: TimerHeap = .{ .context = {} },

pub var current_time: struct {
    const PackedTime = packed struct(u128) {
        sec: i64,
        nsec: i64,
        const min: PackedTime = .{ .sec = std.math.minInt(i64), .nsec = std.math.minInt(i64) };
    };
    #time: std.atomic.Value(PackedTime) = .init(.min),
    pub fn get(this: *@This()) ?bun.timespec {
        const value = this.#time.load(.seq_cst);
        if (value == PackedTime.min) return null;
        return .{ .sec = value.sec, .nsec = value.nsec };
    }
    pub fn set(this: *@This(), _: *jsc.JSGlobalObject, time: ?*const bun.timespec) void {
        if (time) |t| {
            this.#time.store(.{ .sec = t.sec, .nsec = t.nsec }, .seq_cst);
        } else {
            this.#time.store(.min, .seq_cst);
        }
        // TODO: also set the override time for Date.now()
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
fn activate(this: *FakeTimers, time: bun.timespec, globalObject: *jsc.JSGlobalObject) void {
    this.assertValid(.locked);
    defer this.assertValid(.locked);

    this.#active = true;
    current_time.set(globalObject, &time);
}
fn deactivate(this: *FakeTimers, globalObject: *jsc.JSGlobalObject) void {
    this.assertValid(.locked);
    defer this.assertValid(.locked);

    this.clear();
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
        const prev = current_time.get();
        bun.assert(prev != null);
        bun.assert(next.next.eql(&prev.?) or next.next.greater(&prev.?));
    }
    const now = next.next;
    current_time.set(globalObject, &now);
    const arm = next.fire(&now, vm);
    switch (arm) {
        .disarm => {},
        .rearm => {},
    }
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

    {
        timers.lock.lock();
        defer timers.lock.unlock();
        this.activate(bun.timespec.now(), globalObject);
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
    current_time.set(globalObject, &target);

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

const fake_timers_fns: []const struct { [:0]const u8, u32, (fn (*jsc.JSGlobalObject, *jsc.CallFrame) bun.JSError!jsc.JSValue) } = &.{
    .{ "useFakeTimers", 0, useFakeTimers },
    .{ "useRealTimers", 0, useRealTimers },
    .{ "advanceTimersToNextTimer", 0, advanceTimersToNextTimer },
    .{ "advanceTimersByTime", 1, advanceTimersByTime },
    .{ "runOnlyPendingTimers", 0, runOnlyPendingTimers },
    .{ "runAllTimers", 0, runAllTimers },
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
