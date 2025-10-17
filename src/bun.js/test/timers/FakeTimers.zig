#active: bool = false,
timers: TimerHeap = .{ .context = {} },
#current_time: bun.timespec = .epoch,

fn assertValid(this: *FakeTimers) void {
    if (!bun.Environment.ci_assert) return;
    const owner: *bun.api.Timer.All = @fieldParentPtr("fake_timers", this);
    bun.assert(owner.lock.tryLock() == false);
}

pub fn isActive(this: *FakeTimers) bool {
    this.assertValid();
    defer this.assertValid();

    return this.#active;
}
fn activate(this: *FakeTimers, time: bun.timespec) void {
    this.assertValid();
    defer this.assertValid();

    this.#active = true;
    this.#current_time = time;
}
fn deactivate(this: *FakeTimers) void {
    this.assertValid();
    defer this.assertValid();

    this.clear();
    this.#current_time = .epoch;
    this.#active = false;
}
fn clear(this: *FakeTimers) void {
    this.assertValid();
    defer this.assertValid();

    while (this.timers.deleteMin()) |timer| {
        timer.state = .CANCELLED;
        timer.in_heap = .none;
    }
}

fn useFakeTimers(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    timers.lock.lock();
    defer timers.lock.unlock();
    const fake_timers = &timers.fake_timers;

    fake_timers.activate(bun.timespec.now());

    return callframe.this();
}
fn useRealTimers(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const vm = globalObject.bunVM();
    const timers = &vm.timer;
    timers.lock.lock();
    defer timers.lock.unlock();
    const fake_timers = &timers.fake_timers;

    fake_timers.deactivate();

    return callframe.this();
}

const fake_timers_fns: []const struct { [:0]const u8, u32, (fn (*jsc.JSGlobalObject, *jsc.CallFrame) bun.JSError!jsc.JSValue) } = &.{
    .{ "useFakeTimers", 0, useFakeTimers },
    .{ "useRealTimers", 0, useRealTimers },
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

const bun = @import("bun");
const TimerHeap = bun.api.Timer.TimerHeap;
const jsc = bun.jsc;
const FakeTimers = bun.jsc.Jest.bun_test.FakeTimers;
