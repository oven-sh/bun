use std::collections::VecDeque;

use crate::api::cron::CronJob;
use crate::jsc::virtual_machine::VirtualMachine;
use crate::jsc_hooks::timer_all;
use crate::timer::{
    AbortSignalTimeout, Clock, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag,
    ImmediateObject, InHeap, TimeoutObject, TimerHeap, TimerObjectInternals,
};
use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::{
    CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSPromise, JSPromiseStrong, JSValue, JsError,
    JsResult, Strong, StrongOptional,
};

// JSMock C++ bindings (fake timers are only used by bun:test, so these stay local).
unsafe extern "C" {
    safe fn JSMock__setOverridenDateNow(global: &JSGlobalObject, value: f64);
    safe fn JSMock__getCurrentUnixTimeMs() -> f64;
}

/// What `toFake` and `doNotFake` name, as in @sinonjs/fake-timers.
#[derive(Copy, Clone, PartialEq, Eq)]
#[repr(u8)]
enum Api {
    // Functions, which another function object replaces. `FakeTimerFunction` in NodeTimers.cpp has the same values.
    SetTimeout,
    ClearTimeout,
    SetInterval,
    ClearInterval,
    SetImmediate,
    ClearImmediate,
    NextTick,
    QueueMicrotask,
    RequestAnimationFrame,
    CancelAnimationFrame,
    // Clocks, which the same objects read.
    Date,
    Performance,
    Hrtime,
}

impl Api {
    const FUNCTIONS: [Api; 10] = [
        Api::SetTimeout,
        Api::ClearTimeout,
        Api::SetInterval,
        Api::ClearInterval,
        Api::SetImmediate,
        Api::ClearImmediate,
        Api::NextTick,
        Api::QueueMicrotask,
        Api::RequestAnimationFrame,
        Api::CancelAnimationFrame,
    ];

    /// `None`: nothing to replace. `Intl` and `Temporal` follow `Date`; a DOM library's idle callbacks stay as they are.
    const NAMES: [(&'static str, Option<Api>); 17] = [
        ("setTimeout", Some(Api::SetTimeout)),
        ("clearTimeout", Some(Api::ClearTimeout)),
        ("setInterval", Some(Api::SetInterval)),
        ("clearInterval", Some(Api::ClearInterval)),
        ("setImmediate", Some(Api::SetImmediate)),
        ("clearImmediate", Some(Api::ClearImmediate)),
        ("nextTick", Some(Api::NextTick)),
        ("queueMicrotask", Some(Api::QueueMicrotask)),
        ("requestAnimationFrame", Some(Api::RequestAnimationFrame)),
        ("cancelAnimationFrame", Some(Api::CancelAnimationFrame)),
        ("Date", Some(Api::Date)),
        ("performance", Some(Api::Performance)),
        ("hrtime", Some(Api::Hrtime)),
        ("requestIdleCallback", None),
        ("cancelIdleCallback", None),
        ("Intl", None),
        ("Temporal", None),
    ];

    fn name(self) -> &'static str {
        Self::NAMES[self as usize].0
    }

    fn owner(self, global: &JSGlobalObject) -> JSValue {
        match self {
            Api::NextTick => bun_jsc::cpp::Bun__FakeTimers__processObject(global),
            _ => global.to_js_value(),
        }
    }
}

#[derive(Copy, Clone, Default)]
struct ApiSet(u16);

impl ApiSet {
    /// `setImmediate`, `process.nextTick` and `queueMicrotask` stay real unless `toFake` lists them.
    const DEFAULT: ApiSet = ApiSet(
        1 << Api::SetTimeout as u16
            | 1 << Api::ClearTimeout as u16
            | 1 << Api::SetInterval as u16
            | 1 << Api::ClearInterval as u16
            | 1 << Api::Date as u16
            | 1 << Api::Performance as u16
            | 1 << Api::Hrtime as u16,
    );

    fn contains(self, api: Api) -> bool {
        self.0 & (1 << api as u16) != 0
    }

    /// `None`: an empty list.
    fn from_js(global: &JSGlobalObject, option: &str, value: JSValue) -> JsResult<Option<ApiSet>> {
        if !value.is_array() {
            return Err(global
                .throw_invalid_arguments(format_args!("'{option}' must be an array of strings")));
        }
        let mut set = None;
        let mut names = value.array_iterator(global)?;
        while let Some(name) = names.next()? {
            if !name.is_string() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'{option}' must be an array of strings"
                )));
            }
            let name = name.to_bun_string(global)?;
            let Some((_, api)) = Api::NAMES
                .iter()
                .find(|(known, _)| name.eq_ascii(known.as_bytes()))
            else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'{option}' has \"{name}\", which is not a timer function or clock that can be faked"
                )));
            };
            let set = set.get_or_insert(ApiSet::default());
            if let Some(api) = api {
                set.0 |= 1 << *api as u16;
            }
        }
        Ok(set)
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum TickMode {
    Manual,
    /// Every turn of the event loop runs the next fake timer.
    NextAsync,
    /// Every so many real milliseconds the fake clock advances by as many.
    Interval(u32),
}

impl TickMode {
    const DEFAULT_INTERVAL_MS: u32 = 20;

    /// 0 is the default, as in @sinonjs/fake-timers.
    fn interval_from_js(global: &JSGlobalObject, what: &str, value: JSValue) -> JsResult<TickMode> {
        if !value.is_number() {
            return Err(global
                .throw_invalid_arguments(format_args!("{what} must be a number of milliseconds")));
        }
        let ms = value.as_number();
        if !(0.0..=f64::from(i32::MAX)).contains(&ms) {
            return Err(global.throw_invalid_arguments(format_args!(
                "{what} is out of range. It must be >= 0 and <= {}. Received {ms}",
                i32::MAX
            )));
        }
        Ok(TickMode::Interval(match ms as u32 {
            0 => Self::DEFAULT_INTERVAL_MS,
            ms => ms,
        }))
    }
}

/// Where vitest and Jest give the same function a different default or result.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Flavor {
    Vi,
    Jest,
}

struct Options {
    now: Option<f64>,
    faked: ApiSet,
    tick_mode: TickMode,
    loop_limit: u32,
}

impl Options {
    fn from_js(global: &JSGlobalObject, value: JSValue, flavor: Flavor) -> JsResult<Options> {
        let mut options = Options {
            now: None,
            faked: ApiSet::DEFAULT,
            tick_mode: TickMode::Manual,
            loop_limit: match flavor {
                Flavor::Vi => 10_000,
                Flavor::Jest => 100_000,
            },
        };
        // Jest 26 compat: useFakeTimers("modern" | "legacy") takes no options.
        if value.is_undefined() || value.is_string() {
            return Ok(options);
        }
        if !value.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "useFakeTimers() expects an options object"
            )));
        }

        if let Some(now) = value.get(global, "now")? {
            let now = if now.is_number() {
                now.as_number()
            } else if now.is_date() {
                now.get_unix_timestamp()
            } else {
                return Err(
                    global.throw_invalid_arguments(format_args!("'now' must be a number or Date"))
                );
            };
            // NaN is `JSGlobalObject::overridenDateNow`'s "no override" sentinel.
            if !now.is_finite() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'now' must be a finite number or a valid Date"
                )));
            }
            options.now = Some(now);
        }

        if let Some(to_fake) = value.get(global, "toFake")?.filter(|v| !v.is_null()) {
            // An empty list is no list, as in @sinonjs/fake-timers.
            if let Some(to_fake) = ApiSet::from_js(global, "toFake", to_fake)? {
                options.faked = to_fake;
            }
        }
        for option in ["toNotFake", "doNotFake"] {
            if let Some(not_faked) = value.get(global, option)?.filter(|v| !v.is_null()) {
                options.faked.0 &= !ApiSet::from_js(global, option, not_faked)?
                    .unwrap_or_default()
                    .0;
            }
        }

        let should_advance_time = match value.get(global, "shouldAdvanceTime")? {
            Some(should) if !should.is_boolean() => {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'shouldAdvanceTime' must be a boolean"
                )));
            }
            Some(should) => should.as_boolean(),
            None => false,
        };
        let advance_time_delta = match value.get(global, "advanceTimeDelta")? {
            Some(delta) => TickMode::interval_from_js(global, "'advanceTimeDelta'", delta)?,
            None => TickMode::Interval(TickMode::DEFAULT_INTERVAL_MS),
        };
        if should_advance_time {
            options.tick_mode = advance_time_delta;
        }
        if let Some(advance_timers) = value.get(global, "advanceTimers")? {
            if advance_timers.is_boolean() {
                if advance_timers.as_boolean() {
                    options.tick_mode = TickMode::Interval(TickMode::DEFAULT_INTERVAL_MS);
                }
            } else if !advance_timers.is_number() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'advanceTimers' must be a boolean or a number of milliseconds"
                )));
            } else if advance_timers.as_number() != 0.0 {
                options.tick_mode =
                    TickMode::interval_from_js(global, "'advanceTimers'", advance_timers)?;
            }
        }

        for option in ["loopLimit", "timerLimit"] {
            let Some(limit) = value.get(global, option)? else {
                continue;
            };
            if !limit.is_number() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'{option}' must be a number of timers"
                )));
            }
            let limit = limit.as_number();
            if !(0.0..=f64::from(u32::MAX)).contains(&limit) {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'{option}' is out of range. It must be >= 0 and <= {}. Received {limit}",
                    u32::MAX
                )));
            }
            // 0 is the default, as in @sinonjs/fake-timers.
            if limit as u32 != 0 {
                options.loop_limit = limit as u32;
            }
        }

        Ok(options)
    }
}

struct Replaced {
    api: Api,
    original: Strong,
    fake: Strong,
}

/// Where the originals go back.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Restore {
    /// Also over what script has assigned since, as in @sinonjs/fake-timers.
    Always,
    /// `vi.unstubAllGlobals()` ran first: where it took a fake away, `original` is what `vi.stubGlobal()` had put there.
    WhereStillInstalled,
}

/// A call of the faked `process.nextTick()` or `queueMicrotask()`.
struct Tick {
    callback: Strong,
    arguments: Strong,
}

/// `firing` counts it for as long as it lives.
struct Firing;

impl Firing {
    fn begin() -> Firing {
        // SAFETY: per-thread `timer::All`; the borrow ends at this statement.
        unsafe { (*timer_all()).fake_timers.firing += 1 };
        Firing
    }
}

impl Drop for Firing {
    fn drop(&mut self) {
        // SAFETY: as in `begin`.
        unsafe { (*timer_all()).fake_timers.firing -= 1 };
    }
}

/// What is left of a call of an `…Async` function. An event loop task runs at most one fake timer of it.
enum Drive {
    /// How much further the call moves the clock. `None`: as far as the last timer that is pending at the first step.
    Tick(Option<Timespec>),
    /// How many timers it has run.
    All(u32),
    /// How many steps are left.
    Next(u32, NextStep),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum NextStep {
    /// Run the next timer.
    First,
    /// What it threw ends the call. Then as `SameInstant`.
    AfterFirst,
    /// Run what else is due at the instant of that timer.
    SameInstant,
}

struct AsyncDrive {
    id: u32,
    drive: Drive,
    promise: JSPromiseStrong,
    result: Strong,
    /// The first thing a callback threw.
    thrown: StrongOptional,
    /// sinon's `duringTick`: a `Drive::Tick` has it from its first step to its last.
    during_tick: bool,
}

impl AsyncDrive {
    fn settle(mut self, global: &JSGlobalObject) -> JsResult<()> {
        match self.thrown.try_swap() {
            Some(thrown) => self.promise.reject(global, Ok(thrown)),
            None => self.promise.resolve(global, self.result.get()),
        }
    }
}

enum Step {
    Again,
    Finished,
}

pub(crate) struct FakeTimers {
    active: bool,
    /// Empty while not `active`.
    faked: ApiSet,
    /// A preload mocked what is mocked now: it is for every test file.
    from_preload: bool,
    /// Counts `activate` and `deactivate`. What is on the stack when it changes belongs to a clock that is gone.
    installs: u32,
    /// How many [`Firing`] are alive: sinon's `duringTick` of the functions that run timers before they return.
    firing: u32,
    /// The sorted fake timers. TimerHeap is not optimal here because we need these operations:
    /// - peek/takeFirst (provided by TimerHeap)
    /// - peekLast (cannot be implemented efficiently with TimerHeap)
    /// - count (cannot be implemented efficiently with TimerHeap)
    pub(crate) timers: TimerHeap,
    /// The fake clock: the time since `activate`.
    now: Timespec,
    /// `Date.now()` on the fake clock, minus `now`, in milliseconds.
    date_now_offset: f64,
    loop_limit: u32,
    replaced: Vec<Replaced>,
    ticks: VecDeque<Tick>,
    drives: Vec<AsyncDrive>,
    last_drive_id: u32,
    tick_mode: TickMode,
    /// In the real heap while `tick_mode` is `Interval`.
    tick_timer: EventLoopTimer,
    /// `TickMode::NextAsync`'s task is in the event loop's queue.
    auto_step_posted: bool,
}

impl Default for FakeTimers {
    fn default() -> Self {
        Self {
            active: false,
            faked: ApiSet::default(),
            from_preload: false,
            installs: 0,
            firing: 0,
            timers: TimerHeap::default(),
            now: Timespec::EPOCH,
            date_now_offset: 0.0,
            loop_limit: 0,
            replaced: Vec::new(),
            ticks: VecDeque::new(),
            drives: Vec::new(),
            last_drive_id: AUTO_STEP,
            tick_mode: TickMode::Manual,
            tick_timer: EventLoopTimer::init_paused(EventLoopTimerTag::FakeTimersTick),
            auto_step_posted: false,
        }
    }
}

/// The id of `TickMode::NextAsync`'s task. No [`AsyncDrive`] has it.
const AUTO_STEP: u32 = 0;

/// `jest.setSystemTime` (C++ `JSMock__jsSetSystemTime`) writes
/// `globalObject->overridenDateNow` directly; rebase `date_now_offset` here so
/// the next `advanceTimersByTime` recomputes `Date.now` from the set time
/// instead of the stale activation-time offset. `performance.now()` does not
/// move, so `performance.timeOrigin` follows the rebased offset. No-op when
/// fake timers are inactive. A NaN `ms` is the "clear override" sentinel:
/// `Date.now()` is real again until the next tick, so the mocked wall clock
/// and `performance.timeOrigin` go back to real as well.
#[unsafe(no_mangle)]
extern "C" fn Bun__FakeTimers__setSystemTime(global: &JSGlobalObject, ms: f64) {
    // SAFETY: per-thread `timer::All`; nothing below re-enters it.
    let this = unsafe { &mut (*timer_all()).fake_timers };
    let vm = global.bun_vm().as_mut();
    if !this.active {
        this.from_preload = vm.is_in_preload;
        return;
    }
    if ms.is_nan() {
        bun_core::mock_time::clear_wall();
        vm.overridden_time_origin = None;
        return;
    }
    this.date_now_offset = ms - this.now.ms() as f64;
    this.publish_clock(global);
    if !this.faked.contains(Api::Date) {
        JSMock__setOverridenDateNow(global, f64::NAN);
    }
}

/// Owners of the nodes [`FakeTimers::clear`] popped, still to be told their
/// timer is gone. Released only once the `FakeTimers` borrow has ended: these
/// paths re-enter `timer::All` (`TimerObjectInternals::cancel` → `All::remove`,
/// `Timeout` deinit → `timer_remove`).
#[derive(Default)]
#[must_use]
struct ClearedTimers {
    /// Marking `state = CANCELLED` alone strands the `Box<TimeoutObject>`: its
    /// refcount sticks at 2 (wrapper +1 from `init_with`, heap +1 from
    /// `reschedule`) and `internals.this_value` still GC-roots the wrapper, so
    /// neither side ever frees.
    pinned: Vec<core::ptr::NonNull<TimerObjectInternals>>,
    /// Likewise, an unlinked `AbortSignal.timeout()` timer is still its
    /// signal's `m_timeout`, and `JSAbortSignalOwner::isReachableFromOpaqueRoots`
    /// pins an observed signal's wrapper for as long as that is set. Only the
    /// signal's `cancelTimer()` clears it (and frees the box).
    signal_timeouts: Vec<*mut AbortSignalTimeout>,
    /// A `Bun.cron()` job keeps the event loop alive until it is stopped.
    cron_jobs: Vec<*mut CronJob>,
}

impl ClearedTimers {
    fn release(self, vm: *mut VirtualMachine) {
        for p in self.pinned {
            TimerObjectInternals::release_heap_pin(p, vm);
        }
        for t in self.signal_timeouts {
            // SAFETY: `clear` popped `t` from the fake heap, so its box is
            // still owned by a live signal; JS thread; the `FakeTimers` borrow
            // ended before this call. `t` is freed by the call.
            unsafe { AbortSignalTimeout::discard(t) };
        }
        for job in self.cron_jobs {
            // SAFETY: `clear` popped `job`'s node from the fake heap, so the
            // job was scheduled and its JS wrapper (strong while scheduled)
            // keeps it alive; no JS has run since; the `FakeTimers` borrow
            // ended before this call.
            CronJob::stop_dropped_from_fake_heap(unsafe { bun_ptr::ThisPtr::new(job) });
        }
    }
}

/// For [`FakeTimers::uninstall`] to finish with once the `FakeTimers` borrow has ended.
#[must_use]
struct Deactivated {
    cleared: ClearedTimers,
    replaced: Vec<Replaced>,
    drives: Vec<AsyncDrive>,
}

impl FakeTimers {
    /// How far apart the faked `requestAnimationFrame()` has its frames, as in @sinonjs/fake-timers.
    pub(crate) const FRAME_MS: u64 = 16;

    pub(crate) fn is_active(&self) -> bool {
        self.active
    }

    /// Also the clock of `AbortSignal.timeout()`, `Bun.sleep()` and `Bun.cron()`, which have no function object to replace.
    pub(crate) fn set_timeout_clock(&self) -> Clock {
        if self.faked.contains(Api::SetTimeout) {
            Clock::Fake
        } else {
            Clock::Real
        }
    }

    /// A fake function is one only for the `useFakeTimers()` that created it.
    pub(crate) fn is_installed(&self, function: JSValue) -> bool {
        self.replaced
            .iter()
            .any(|replaced| replaced.fake.get() == function)
    }

    /// The conversion of a timer function's arguments can run `useRealTimers()`.
    pub(crate) fn clock_while_active(&self, clock: Clock) -> Clock {
        if self.active { clock } else { Clock::Real }
    }

    pub(crate) fn installs(&self) -> u32 {
        self.installs
    }

    pub(crate) fn now(&self) -> Timespec {
        self.now
    }

    pub(crate) fn hrtime(&self) -> Option<u64> {
        self.faked.contains(Api::Hrtime).then(|| self.now.ns())
    }

    /// 1 while a fake timer's callback runs (sinon's `duringTick` rule): a zero-delay re-arm is due again in the drain that runs it.
    pub(crate) fn min_delay_ms(&self) -> u32 {
        let during_tick = self.firing > 0 || self.drives.iter().any(|drive| drive.during_tick);
        if self.active && during_tick { 1 } else { 0 }
    }

    fn date_now(&self) -> f64 {
        self.date_now_offset + self.now.ms() as f64
    }

    fn publish_clock(&self, global: &JSGlobalObject) {
        if self.faked.contains(Api::SetTimeout) {
            // `Timespec::now(AllowMockedTime)` and `Bun.cron()`'s calendar.
            bun_core::mock_time::set(self.now.ns() as i64);
            bun_core::mock_time::set_wall_ms(self.date_now());
        }
        if self.faked.contains(Api::Date) {
            JSMock__setOverridenDateNow(global, self.date_now());
        }
        if self.faked.contains(Api::Performance) {
            let vm = global.bun_vm().as_mut();
            vm.overridden_performance_now = Some(self.now.ns());
            // `Date.now() == date_now_offset + performance.now()`, so the offset is
            // the fake clock's `performance.timeOrigin`.
            vm.overridden_time_origin = Some(self.date_now_offset);
        }
    }

    fn hide_clock(global: &JSGlobalObject) {
        bun_core::mock_time::clear();
        bun_core::mock_time::clear_wall();
        // NaN is JSGlobalObject::overridenDateNow's "no override" sentinel; a
        // real -1 would pin Date.now() at 1969-12-31T23:59:59.999Z.
        JSMock__setOverridenDateNow(global, f64::NAN);
        let vm = global.bun_vm().as_mut();
        vm.overridden_performance_now = None;
        vm.overridden_time_origin = None;
    }

    /// The clock never goes back: a nested driver may have taken it past `to`.
    fn advance_clock_to(&mut self, global: &JSGlobalObject, to: Timespec) {
        if to.greater(&self.now) {
            self.now = to;
        }
        self.publish_clock(global);
    }

    fn activate(&mut self, global: &JSGlobalObject, options: &Options, date_now: f64) {
        self.active = true;
        self.faked = options.faked;
        self.from_preload = global.bun_vm().is_in_preload;
        self.installs = self.installs.wrapping_add(1);
        self.loop_limit = options.loop_limit;
        self.now = Timespec::EPOCH;
        self.date_now_offset = date_now.floor();
        self.publish_clock(global);
    }

    fn deactivate(&mut self, global: &JSGlobalObject) -> Deactivated {
        let cleared = self.clear();
        self.forget_installation(global);
        Deactivated {
            cleared,
            replaced: core::mem::take(&mut self.replaced),
            drives: core::mem::take(&mut self.drives),
        }
    }

    /// Leaves the heap, the globals and the pending promises alone.
    fn forget_installation(&mut self, global: &JSGlobalObject) {
        Self::hide_clock(global);
        self.active = false;
        self.faked = ApiSet::default();
        self.from_preload = false;
        self.installs = self.installs.wrapping_add(1);
        self.tick_mode = TickMode::Manual;
        if self.tick_timer.state == EventLoopTimerState::ACTIVE {
            let timer: *mut EventLoopTimer = &raw mut self.tick_timer;
            // SAFETY: single JS thread; what `All::remove` touches of `fake_timers` is only this node.
            unsafe { (*timer_all()).remove(timer) };
        }
    }

    /// Restore real timers without draining the fake heap. Used by the
    /// `--isolate` file boundary so `swap_global_for_test_isolation`'s
    /// `cancel_all_timeout_objects` (which runs after the outgoing global's
    /// JS has stopped) can walk the still-populated fake heap and release
    /// `TimeoutObject` pins and discard `AbortSignalTimeout` timers. The
    /// outgoing global keeps its fake functions: it goes away with them.
    pub(crate) fn reset_for_isolation(&mut self, global: &JSGlobalObject) {
        self.forget_installation(global);
        self.replaced.clear();
        self.ticks.clear();
        for drive in core::mem::take(&mut self.drives) {
            // The swap drains the microtasks of the outgoing file once more; VM teardown drops them.
            let _ = drive.settle(global);
        }
    }

    /// Pop every fake timer. Popping only unlinks the nodes; the owners that
    /// need to hear about it are returned for the caller to release.
    fn clear(&mut self) -> ClearedTimers {
        self.ticks.clear();
        let mut cleared = ClearedTimers::default();
        while let Some(timer) = self.timers.delete_min() {
            // SAFETY: `delete_min` returned a live node; the owner it belongs
            // to stays live until the caller's release pass.
            unsafe {
                (*timer).in_heap = InHeap::None;
                (*timer).state = EventLoopTimerState::CANCELLED;
                match (*timer).tag {
                    EventLoopTimerTag::TimeoutObject => {
                        let parent = TimeoutObject::from_timer_ptr(timer);
                        cleared.pinned.push(core::ptr::NonNull::new_unchecked(
                            core::ptr::addr_of_mut!((*parent).internals),
                        ));
                    }
                    EventLoopTimerTag::ImmediateObject => {
                        let parent = ImmediateObject::from_timer_ptr(timer);
                        cleared.pinned.push(core::ptr::NonNull::new_unchecked(
                            core::ptr::addr_of_mut!((*parent).internals),
                        ));
                    }
                    EventLoopTimerTag::AbortSignalTimeout => {
                        cleared
                            .signal_timeouts
                            .push(AbortSignalTimeout::from_timer_ptr(timer));
                    }
                    EventLoopTimerTag::CronJob => {
                        cleared.cron_jobs.push(CronJob::from_timer_ptr(timer));
                    }
                    tag => debug_assert!(
                        false,
                        "{} timer in the fake heap has no release path",
                        <&'static str>::from(tag),
                    ),
                }
            }
        }

        cleared
    }

    fn count(&self) -> usize {
        self.timers.count() + self.ticks.len()
    }

    fn is_empty(&self) -> bool {
        self.timers.peek().is_none() && self.ticks.is_empty()
    }

    fn pop_due(&mut self, until: &Timespec) -> Option<*mut EventLoopTimer> {
        let next = self.timers.peek()?;
        // SAFETY: `next` is the heap root; live while linked.
        if unsafe { (*next).next }.greater(until) {
            return None;
        }
        self.timers.delete_min()
    }

    /// Without fake timers it still ends `setSystemTime()`'s override.
    fn uninstall(global: &JSGlobalObject, restore: Restore) -> JsResult<()> {
        // SAFETY: per-thread `timer::All`; the borrow ends at this statement.
        let deactivated = unsafe { (*timer_all()).fake_timers.deactivate(global) };
        deactivated.cleared.release(global.bun_vm_ptr());
        for Replaced {
            api,
            original,
            fake,
        } in deactivated.replaced
        {
            let owner = api.owner(global);
            if restore == Restore::Always || owner.get(global, api.name())? == Some(fake.get()) {
                owner.put(global, api.name().as_bytes(), original.get());
            }
        }
        for drive in deactivated.drives {
            drive.settle(global)?;
        }
        Ok(())
    }

    fn install(global: &JSGlobalObject, options: &Options, date_now: f64) -> JsResult<()> {
        bun_jsc::cpp::Bun__FakeTimers__loadNodeTimers(global)?;
        // SAFETY: per-thread `timer::All`; the borrow ends at this statement.
        unsafe {
            (*timer_all())
                .fake_timers
                .activate(global, options, date_now)
        };
        for api in Api::FUNCTIONS {
            if !options.faked.contains(api) {
                continue;
            }
            if let Err(err) = Self::replace(global, api) {
                // Nothing is scheduled or pending yet, so this only puts the functions back: it cannot throw over `err`.
                let _ = Self::uninstall(global, Restore::Always);
                return Err(err);
            }
        }
        Self::set_tick_mode(options.tick_mode);
        Ok(())
    }

    fn replace(global: &JSGlobalObject, api: Api) -> JsResult<()> {
        let owner = api.owner(global);
        let original = owner.get(global, api.name())?.unwrap_or(JSValue::UNDEFINED);
        // Only a DOM library has these two.
        if matches!(api, Api::RequestAnimationFrame | Api::CancelAnimationFrame)
            && !original.is_callable()
        {
            return Ok(());
        }
        let fake = bun_jsc::cpp::Bun__FakeTimers__createFunction(global, api as u8)?;
        owner.put(global, api.name().as_bytes(), fake);
        let replaced = Replaced {
            api,
            original: Strong::create(original, global),
            fake: Strong::create(fake, global),
        };
        // SAFETY: per-thread `timer::All`; the borrow ends at this statement.
        unsafe { (*timer_all()).fake_timers.replaced.push(replaced) };
        Ok(())
    }

    // Below, a `JSValue` result is what a callback threw, or empty. `Err` is the VM's own: its termination.

    fn fire(global: &JSGlobalObject, timer: *mut EventLoopTimer) -> JsResult<JSValue> {
        // SAFETY: `timer` was just popped from our heap; live until its callback completes.
        let (tag, at) = unsafe { ((*timer).tag, (*timer).next) };
        // SAFETY: per-thread `timer::All`; the borrow ends at this statement.
        unsafe { (*timer_all()).fake_timers.advance_clock_to(global, at) };
        let _firing = Firing::begin();
        let vm = VirtualMachine::get_mut_ptr();
        let mut thrown = JSValue::ZERO;
        // SAFETY: `timer` is live and its tag names its owner; the callees take raw pointers (noalias re-entrancy).
        unsafe {
            match tag {
                EventLoopTimerTag::TimeoutObject => TimerObjectInternals::fire_catching(
                    core::ptr::addr_of_mut!((*TimeoutObject::from_timer_ptr(timer)).internals),
                    vm,
                    &raw mut thrown,
                ),
                EventLoopTimerTag::ImmediateObject => TimerObjectInternals::fire_catching(
                    core::ptr::addr_of_mut!((*ImmediateObject::from_timer_ptr(timer)).internals),
                    vm,
                    &raw mut thrown,
                ),
                // An abort listener or a cron job that throws is reported where a real timer's drain would report it.
                _ => {
                    if let Err(err) = EventLoopTimer::fire(timer, &at, vm.cast()) {
                        bun_jsc::task::report_error_or_terminate(global, err)
                            .map_err(|stopped| stopped.throw(global))?;
                    }
                }
            }
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(thrown)
    }

    /// Runs the faked `process.nextTick()` and `queueMicrotask()` callbacks, up to the first that throws.
    fn run_ticks(global: &JSGlobalObject) -> JsResult<JSValue> {
        let all = timer_all();
        // SAFETY: per-thread `timer::All`; each borrow lasts one statement and none spans a callback.
        let limit = unsafe { (*all).fake_timers.loop_limit };
        let mut ran: u32 = 0;
        // SAFETY: as above.
        while let Some(tick) = unsafe { (*all).fake_timers.ticks.pop_front() } {
            if ran == limit {
                // SAFETY: as above.
                unsafe { (*all).fake_timers.ticks.push_front(tick) };
                return loop_limit_error(global, limit);
            }
            ran += 1;
            let (callback, arguments) = (tick.callback.get(), tick.arguments.get());
            drop(tick);
            let thrown = TimerObjectInternals::call_catching(global, callback, arguments);
            if global.has_exception() {
                return Err(JsError::Thrown);
            }
            if !thrown.is_empty() {
                return Ok(thrown);
            }
        }
        Ok(JSValue::ZERO)
    }

    /// sinon's `next()`. `None`: there was no timer to run.
    fn run_next(global: &JSGlobalObject) -> JsResult<Option<JSValue>> {
        let _firing = Firing::begin();
        let thrown = Self::run_ticks(global)?;
        if !thrown.is_empty() {
            return Ok(Some(thrown));
        }
        // SAFETY: per-thread `timer::All`; the borrow ends at this statement.
        let Some(timer) = (unsafe { (*timer_all()).fake_timers.timers.delete_min() }) else {
            return Ok(None);
        };
        let thrown = Self::fire(global, timer)?;
        if !thrown.is_empty() {
            return Ok(Some(thrown));
        }
        Ok(Some(Self::run_ticks(global)?))
    }

    /// sinon's `tick()`: a callback that throws does not stop it, and it gives back the first thing thrown.
    fn run_until(global: &JSGlobalObject, until: Timespec) -> JsResult<JSValue> {
        let all = timer_all();
        // SAFETY: per-thread `timer::All`; each borrow lasts one statement and none spans a callback.
        let installs = unsafe { (*all).fake_timers.installs };
        let _firing = Firing::begin();
        let mut first_thrown = JSValue::ZERO;
        // `until` is a time on the clock this started on.
        // SAFETY: as above.
        while unsafe { (*all).fake_timers.installs } == installs {
            let mut thrown = Self::run_ticks(global)?;
            // SAFETY: as above.
            if thrown.is_empty() && unsafe { (*all).fake_timers.installs } == installs {
                // SAFETY: as above.
                let Some(timer) = (unsafe { (*all).fake_timers.pop_due(&until) }) else {
                    // SAFETY: as above.
                    unsafe { (*all).fake_timers.advance_clock_to(global, until) };
                    break;
                };
                thrown = Self::fire(global, timer)?;
            }
            if first_thrown.is_empty() {
                first_thrown = thrown;
            }
        }
        Ok(first_thrown)
    }

    /// sinon's `runToLast()`.
    fn run_only_pending(global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: per-thread `timer::All`.
        match unsafe { (*timer_all()).fake_timers.timers.find_max() } {
            // SAFETY: `last` is reachable in the heap and live while linked.
            Some(last) => Self::run_until(global, unsafe { (*last).next }),
            None => Self::run_ticks(global),
        }
    }

    /// sinon's `runAll()`.
    fn run_all(global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: per-thread `timer::All`.
        let limit = unsafe { (*timer_all()).fake_timers.loop_limit };
        for _ in 0..limit {
            match Self::run_next(global)? {
                None => return Ok(JSValue::ZERO),
                Some(thrown) if !thrown.is_empty() => return Ok(thrown),
                Some(_) => {}
            }
        }
        // SAFETY: per-thread `timer::All`.
        if unsafe { (*timer_all()).fake_timers.is_empty() } {
            return Ok(JSValue::ZERO);
        }
        loop_limit_error(global, limit)
    }

    fn run_to_next_timer(global: &JSGlobalObject, steps: u32) -> JsResult<JSValue> {
        for _ in 0..steps {
            match Self::run_next(global)? {
                None => break,
                Some(thrown) if !thrown.is_empty() => return Ok(thrown),
                Some(_) => {}
            }
            // SAFETY: per-thread `timer::All`.
            let thrown = Self::run_until(global, unsafe { (*timer_all()).fake_timers.now })?;
            if !thrown.is_empty() {
                return Ok(thrown);
            }
        }
        Ok(JSValue::ZERO)
    }

    /// Legacy Jest's `runAllImmediates()`.
    fn run_all_immediates(global: &JSGlobalObject) -> JsResult<JSValue> {
        let all = timer_all();
        // SAFETY: per-thread `timer::All`; each borrow lasts one statement and none spans a callback.
        let limit = unsafe { (*all).fake_timers.loop_limit };
        for _ in 0..limit {
            // SAFETY: as above.
            let Some(immediate) = (unsafe { (*all).fake_timers.timers.first_immediate() }) else {
                return Ok(JSValue::ZERO);
            };
            // SAFETY: as above; `immediate` is linked in this heap.
            unsafe { (*all).fake_timers.timers.remove(immediate) };
            let thrown = Self::fire(global, immediate)?;
            if !thrown.is_empty() {
                return Ok(thrown);
            }
        }
        // SAFETY: as above.
        if unsafe { (*all).fake_timers.timers.first_immediate() }.is_none() {
            return Ok(JSValue::ZERO);
        }
        loop_limit_error(global, limit)
    }

    fn drive_mut(&mut self, id: u32) -> Option<&mut AsyncDrive> {
        self.drives.iter_mut().find(|drive| drive.id == id)
    }

    fn start_drive(global: &JSGlobalObject, drive: Drive, result: JSValue) -> JSValue {
        let promise = JSPromiseStrong::init(global);
        let promise_value = promise.value();
        // SAFETY: per-thread `timer::All`; nothing below re-enters it.
        let this = unsafe { &mut (*timer_all()).fake_timers };
        this.last_drive_id = match this.last_drive_id.wrapping_add(1) {
            AUTO_STEP => AUTO_STEP + 1,
            id => id,
        };
        let id = this.last_drive_id;
        this.drives.push(AsyncDrive {
            id,
            drive,
            promise,
            result: Strong::create(result, global),
            thrown: StrongOptional::empty(),
            during_tick: false,
        });
        bun_jsc::cpp::Bun__FakeTimers__postStep(global, id);
        promise_value
    }

    /// Keeps `thrown` for the promise of drive `id`. A drive that `useRealTimers()` has settled has nobody left to tell.
    fn drive_threw(global: &JSGlobalObject, id: u32, thrown: JSValue) {
        if thrown.is_empty() {
            return;
        }
        // SAFETY: per-thread `timer::All`; the borrow ends before `uncaught_exception`.
        match unsafe { (*timer_all()).fake_timers.drive_mut(id) } {
            Some(drive) => {
                if !drive.thrown.has() {
                    drive.thrown.set(global, thrown);
                }
            }
            None => {
                let _ = global
                    .bun_vm()
                    .as_mut()
                    .uncaught_exception(global, thrown, false);
            }
        }
    }

    /// The timer a `Drive::Tick` runs next. `Some(None)`: there is none in its range, and the clock is at the end of it.
    fn next_of_tick(
        &mut self,
        global: &JSGlobalObject,
        id: u32,
    ) -> Option<Option<*mut EventLoopTimer>> {
        let now = self.now;
        // SAFETY: `last` is reachable in the heap and live while linked.
        let to_last = self
            .timers
            .find_max()
            .map(|last| unsafe { (*last).next }.duration(&now));
        let index = self.drives.iter().position(|drive| drive.id == id)?;
        let Drive::Tick(remaining) = self.drives[index].drive else {
            return None;
        };
        let until = plus(now, remaining.or(to_last).unwrap_or(Timespec::EPOCH));
        let Some(timer) = self.pop_due(&until) else {
            self.advance_clock_to(global, until);
            return Some(None);
        };
        // SAFETY: just unlinked, live until it is fired.
        let at = unsafe { (*timer).next };
        self.drives[index].drive = Drive::Tick(Some(until.duration(if at.greater(&now) {
            &at
        } else {
            &now
        })));
        Some(Some(timer))
    }

    /// One event loop task's worth of drive `id`. `None`: `useRealTimers()` settled it.
    fn step_drive(global: &JSGlobalObject, id: u32) -> JsResult<Option<Step>> {
        let all = timer_all();
        // SAFETY: per-thread `timer::All`; each borrow lasts one statement and none spans a callback.
        let Some(drive) = (unsafe { (*all).fake_timers.drive_mut(id) }) else {
            return Ok(None);
        };
        match drive.drive {
            Drive::Tick(_) => {
                drive.during_tick = true;
                let thrown = Self::run_ticks(global)?;
                if !thrown.is_empty() {
                    Self::drive_threw(global, id, thrown);
                    return Ok(Some(Step::Again));
                }
                // SAFETY: as above.
                match unsafe { (*all).fake_timers.next_of_tick(global, id) } {
                    None => Ok(None),
                    Some(None) => Ok(Some(Step::Finished)),
                    Some(Some(timer)) => {
                        Self::drive_threw(global, id, Self::fire(global, timer)?);
                        Ok(Some(Step::Again))
                    }
                }
            }
            Drive::All(ran) => {
                drive.drive = Drive::All(ran.saturating_add(1));
                // SAFETY: as above.
                let limit = unsafe { (*all).fake_timers.loop_limit };
                // SAFETY: as above.
                if ran >= limit && !unsafe { (*all).fake_timers.is_empty() } {
                    Self::drive_threw(global, id, loop_limit_error(global, limit)?);
                    return Ok(Some(Step::Finished));
                }
                match Self::run_next(global)? {
                    None => Ok(Some(Step::Finished)),
                    Some(thrown) if !thrown.is_empty() => {
                        Self::drive_threw(global, id, thrown);
                        Ok(Some(Step::Finished))
                    }
                    Some(_) => Ok(Some(Step::Again)),
                }
            }
            Drive::Next(0, _) => Ok(Some(Step::Finished)),
            Drive::Next(steps, NextStep::First) => {
                drive.drive = Drive::Next(steps, NextStep::AfterFirst);
                // SAFETY: as above.
                let Some(timer) = (unsafe { (*all).fake_timers.timers.delete_min() }) else {
                    return Ok(Some(Step::Finished));
                };
                Self::drive_threw(global, id, Self::fire(global, timer)?);
                Ok(Some(Step::Again))
            }
            Drive::Next(steps, step) => {
                if step == NextStep::AfterFirst && drive.thrown.has() {
                    return Ok(Some(Step::Finished));
                }
                drive.drive = Drive::Next(steps, NextStep::SameInstant);
                let _firing = Firing::begin();
                let mut thrown = Self::run_ticks(global)?;
                if thrown.is_empty() {
                    // SAFETY: as above.
                    let now = unsafe { (*all).fake_timers.now };
                    // SAFETY: as above.
                    let Some(timer) = (unsafe { (*all).fake_timers.pop_due(&now) }) else {
                        // SAFETY: as above.
                        let none_left = unsafe { (*all).fake_timers.is_empty() };
                        // SAFETY: as above.
                        let Some(drive) = (unsafe { (*all).fake_timers.drive_mut(id) }) else {
                            return Ok(None);
                        };
                        if steps == 1 || none_left || drive.thrown.has() {
                            return Ok(Some(Step::Finished));
                        }
                        drive.drive = Drive::Next(steps - 1, NextStep::First);
                        return Ok(Some(Step::Again));
                    };
                    thrown = Self::fire(global, timer)?;
                }
                Self::drive_threw(global, id, thrown);
                Ok(Some(Step::Again))
            }
        }
    }

    /// The event loop task `Bun__FakeTimers__postStep` posts.
    pub(crate) fn run_step(global: &JSGlobalObject, id: u32) -> JsResult<()> {
        if id == AUTO_STEP {
            return Self::run_auto_step(global);
        }
        match Self::step_drive(global, id)? {
            None => {}
            Some(Step::Again) => {
                // SAFETY: per-thread `timer::All`.
                if unsafe { (*timer_all()).fake_timers.drive_mut(id) }.is_some() {
                    bun_jsc::cpp::Bun__FakeTimers__postStep(global, id);
                }
            }
            Some(Step::Finished) => {
                // SAFETY: per-thread `timer::All`; the borrow ends before `settle`.
                let drives = unsafe { &mut (*timer_all()).fake_timers.drives };
                if let Some(index) = drives.iter().position(|drive| drive.id == id) {
                    drives.swap_remove(index).settle(global)?;
                }
                // SAFETY: per-thread `timer::All`.
                unsafe { (*timer_all()).fake_timers.post_auto_step() };
            }
        }
        Ok(())
    }

    fn set_tick_mode(mode: TickMode) {
        let all = timer_all();
        // SAFETY: per-thread `timer::All`; nothing in this block re-enters it.
        unsafe {
            let this = &mut (*all).fake_timers;
            if this.tick_mode == mode {
                return;
            }
            this.tick_mode = mode;
        }
        // SAFETY: per-thread `timer::All`; `tick_timer` is at a stable address in it.
        unsafe {
            let timer = &raw mut (*all).fake_timers.tick_timer;
            if (*timer).state == EventLoopTimerState::ACTIVE {
                (*all).remove(timer);
            }
            Self::arm_tick_timer();
            (*all).fake_timers.post_auto_step();
        }
    }

    fn arm_tick_timer() {
        let all = timer_all();
        // SAFETY: per-thread `timer::All`; `tick_timer` is at a stable address in it.
        unsafe {
            let TickMode::Interval(delta) = (*all).fake_timers.tick_mode else {
                return;
            };
            let timer = &raw mut (*all).fake_timers.tick_timer;
            if (*timer).state != EventLoopTimerState::ACTIVE {
                (*all).update(
                    timer,
                    &Timespec::now(TimespecMockMode::ForceRealTime).add_ms(i64::from(delta)),
                );
            }
        }
    }

    pub(crate) fn on_tick_timer(global: &JSGlobalObject) -> JsResult<()> {
        // SAFETY: per-thread `timer::All`; nothing in this block re-enters it.
        let mode = unsafe {
            let this = &mut (*timer_all()).fake_timers;
            this.tick_timer.state = EventLoopTimerState::FIRED;
            this.tick_mode
        };
        let TickMode::Interval(delta) = mode else {
            return Ok(());
        };
        // The promise jobs of the timers run once the clock has arrived, as after sinon's `tick()`.
        // SAFETY: the live event loop of the per-thread VM.
        let _entered =
            unsafe { bun_jsc::event_loop::EventLoop::enter_scope(global.bun_vm().event_loop()) };
        let advanced = advance_by_ms(global, f64::from(delta));
        Self::arm_tick_timer();
        advanced
    }

    /// Something for `TickMode::NextAsync` to run may have come up.
    pub(crate) fn post_auto_step(&mut self) {
        if self.tick_mode == TickMode::NextAsync
            && !self.auto_step_posted
            // sinon's `pauseAutoTickUntilFinished()`.
            && self.drives.is_empty()
            && !self.is_empty()
        {
            self.auto_step_posted = true;
            bun_jsc::cpp::Bun__FakeTimers__postStep(VirtualMachine::get().global(), AUTO_STEP);
        }
    }

    fn run_auto_step(global: &JSGlobalObject) -> JsResult<()> {
        // SAFETY: per-thread `timer::All`; nothing in this block re-enters it.
        let runs = unsafe {
            let this = &mut (*timer_all()).fake_timers;
            this.auto_step_posted = false;
            this.tick_mode == TickMode::NextAsync && this.drives.is_empty()
        };
        if !runs {
            return Ok(());
        }
        if let Some(thrown) = Self::run_next(global)? {
            if !thrown.is_empty() {
                let _ = global
                    .bun_vm()
                    .as_mut()
                    .uncaught_exception(global, thrown, false);
            }
        }
        // SAFETY: per-thread `timer::All`.
        unsafe { (*timer_all()).fake_timers.post_auto_step() };
        Ok(())
    }

    pub(crate) fn queue_tick(
        &mut self,
        global: &JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
    ) {
        debug_assert!(self.active);
        self.ticks.push_back(Tick {
            callback: Strong::create(callback, global),
            arguments: Strong::create(arguments, global),
        });
        self.post_auto_step();
    }
}

fn plus(a: Timespec, b: Timespec) -> Timespec {
    const NS_PER_S: i64 = bun_core::time::NS_PER_S as i64;
    let nsec = a.nsec + b.nsec;
    Timespec {
        sec: a.sec + b.sec + nsec / NS_PER_S,
        nsec: nsec % NS_PER_S,
    }
}

/// The text of @sinonjs/fake-timers.
fn loop_limit_error(global: &JSGlobalObject, limit: u32) -> JsResult<JSValue> {
    let error = global.create_error_instance(format_args!(
        "Aborting after running {limit} timers, assuming an infinite loop!"
    ));
    if error.is_empty() {
        return Err(JsError::Thrown);
    }
    Ok(error)
}

// ===
// JS Functions
// ===

fn error_unless_fake_timers(global: &JSGlobalObject) -> JsResult<()> {
    if is_active() {
        return Ok(());
    }
    Err(global.throw(format_args!(
        "Fake timers are not active. Call useFakeTimers() first."
    )))
}

/// `vi` or `jest`, for calls to chain. `frame.this()` itself is a scope object when the function is called by a bare name.
fn chainable_this(global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
    bun_jsc::cpp::JSMock__strictThis(global, frame.this())
}

fn rethrow(global: &JSGlobalObject, frame: &CallFrame, thrown: JSValue) -> JsResult<JSValue> {
    if thrown.is_empty() {
        return Ok(chainable_this(global, frame));
    }
    Err(global.throw_value(thrown))
}

fn use_fake_timers(
    global: &JSGlobalObject,
    frame: &CallFrame,
    flavor: Flavor,
) -> JsResult<JSValue> {
    let options = Options::from_js(global, frame.argument(0), flavor)?;
    let date_now = options.now.unwrap_or_else(|| match flavor {
        // What `Date.now()` says: `setSystemTime()`'s time, or that of the fake clock this one replaces.
        Flavor::Vi => bun_jsc::cpp::JSC__JSGlobalObject__jsDateNow(global),
        Flavor::Jest => JSMock__getCurrentUnixTimeMs(),
    });
    FakeTimers::uninstall(global, Restore::Always)?;
    FakeTimers::install(global, &options, date_now)?;
    Ok(chainable_this(global, frame))
}

#[bun_jsc::host_fn]
fn use_real_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    FakeTimers::uninstall(global, Restore::Always)?;
    Ok(chainable_this(global, frame))
}

fn steps_argument(global: &JSGlobalObject, frame: &CallFrame, function: &str) -> JsResult<u32> {
    let arg = frame.argument(0);
    if arg.is_undefined() {
        return Ok(1);
    }
    if !arg.is_number() {
        return Err(
            global.throw_invalid_arguments(format_args!("{function}() expects a number of steps"))
        );
    }
    let steps = arg.as_number();
    if !(0.0..=f64::from(u32::MAX)).contains(&steps) {
        return Err(global.throw_invalid_arguments(format_args!(
            "{function}() steps is out of range. It must be >= 0 and <= {}. Received {steps}",
            u32::MAX
        )));
    }
    Ok(steps.ceil() as u32)
}

fn milliseconds_argument(
    global: &JSGlobalObject,
    frame: &CallFrame,
    function: &str,
) -> JsResult<f64> {
    let arg = frame.argument(0);
    if !arg.is_number() {
        return Err(global.throw_invalid_arguments(format_args!(
            "{function}() expects a number of milliseconds"
        )));
    }
    let ms = arg.as_number();
    let max_advance = u32::MAX;
    if ms.is_nan() || ms < 0.0 || ms > max_advance as f64 {
        return Err(global.throw_invalid_arguments(format_args!(
            "{function}() ms is out of range. It must be >= 0 and <= {max_advance}. Received {ms:.0}"
        )));
    }
    // When advanceTimersByTime(0) is called, advance by 1ms to fire setTimeout(fn, 0) timers.
    // This is because setTimeout(fn, 0) is internally scheduled with a 1ms delay per HTML spec,
    // and Jest/testing-library expect advanceTimersByTime(0) to fire such "immediate" timers.
    Ok(if ms == 0.0 { 1.0 } else { ms })
}

#[bun_jsc::host_fn]
fn advance_timers_to_next_timer(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;
    let steps = steps_argument(global, frame, "advanceTimersToNextTimer")?;
    rethrow(global, frame, FakeTimers::run_to_next_timer(global, steps)?)
}

#[bun_jsc::host_fn]
fn advance_timers_by_time(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;
    let ms = milliseconds_argument(global, frame, "advanceTimersByTime")?;
    rethrow(global, frame, advance(global, ms)?)
}

fn advance(global: &JSGlobalObject, ms: f64) -> JsResult<JSValue> {
    // SAFETY: per-thread `timer::All`, live for the VM lifetime.
    let now = unsafe { (*timer_all()).fake_timers.now };
    FakeTimers::run_until(global, now.add_ms_float(ms))
}

/// The next test file shares `global`. No script is on the stack.
pub(crate) fn on_test_file_end(global: &JSGlobalObject) {
    // SAFETY: per-thread `timer::All`; field read only.
    if unsafe { (*timer_all()).fake_timers.from_preload } {
        return;
    }
    // What waits for an `…Async` call goes on while this is still the file it belongs to.
    // SAFETY: the live event loop of the per-thread VM.
    let _entered =
        unsafe { bun_jsc::event_loop::EventLoop::enter_scope(global.bun_vm().event_loop()) };
    crate::dispatch::fold(FakeTimers::uninstall(global, Restore::WhereStillInstalled));
}

pub(crate) fn is_active() -> bool {
    // SAFETY: per-thread `timer::All`, live for the VM lifetime.
    unsafe { (*timer_all()).fake_timers.is_active() }
}

/// No-op unless fake timers are active. `ms` must be finite and in `0..=u32::MAX`.
pub(crate) fn advance_by_ms(global: &JSGlobalObject, ms: f64) -> JsResult<()> {
    if !is_active() {
        return Ok(());
    }
    let thrown = advance(global, if ms == 0.0 { 1.0 } else { ms })?;
    if thrown.is_empty() {
        return Ok(());
    }
    Err(global.throw_value(thrown))
}

#[bun_jsc::host_fn]
fn advance_timers_to_next_frame(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;
    // SAFETY: per-thread `timer::All`, live for the VM lifetime.
    let now_ms = unsafe { (*timer_all()).fake_timers.now }.ms_unsigned();
    let to_next_frame = FakeTimers::FRAME_MS - now_ms % FakeTimers::FRAME_MS;
    rethrow(global, frame, advance(global, to_next_frame as f64)?)
}

#[bun_jsc::host_fn]
fn run_only_pending_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;
    rethrow(global, frame, FakeTimers::run_only_pending(global)?)
}

#[bun_jsc::host_fn]
fn run_all_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;
    rethrow(global, frame, FakeTimers::run_all(global)?)
}

#[bun_jsc::host_fn]
fn run_all_ticks(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;
    rethrow(global, frame, FakeTimers::run_ticks(global)?)
}

#[bun_jsc::host_fn]
fn run_all_immediates(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;
    rethrow(global, frame, FakeTimers::run_all_immediates(global)?)
}

/// An `…Async` function is an `async` function in vitest and Jest: it rejects where its namesake throws.
fn drive_async(
    global: &JSGlobalObject,
    frame: &CallFrame,
    flavor: Flavor,
    drive: impl FnOnce() -> JsResult<Drive>,
) -> JsResult<JSValue> {
    match error_unless_fake_timers(global).and_then(|()| drive()) {
        Ok(drive) => Ok(FakeTimers::start_drive(
            global,
            drive,
            match flavor {
                Flavor::Vi => chainable_this(global, frame),
                Flavor::Jest => JSValue::UNDEFINED,
            },
        )),
        Err(err) => Ok(JSPromise::rejected_promise_with_caught_exception(global, err)?.to_js()),
    }
}

fn advance_timers_by_time_async(
    global: &JSGlobalObject,
    frame: &CallFrame,
    flavor: Flavor,
) -> JsResult<JSValue> {
    drive_async(global, frame, flavor, || {
        let ms = milliseconds_argument(global, frame, "advanceTimersByTimeAsync")?;
        Ok(Drive::Tick(Some(Timespec::EPOCH.add_ms_float(ms))))
    })
}

fn advance_timers_to_next_timer_async(
    global: &JSGlobalObject,
    frame: &CallFrame,
    flavor: Flavor,
) -> JsResult<JSValue> {
    drive_async(global, frame, flavor, || {
        Ok(Drive::Next(
            steps_argument(global, frame, "advanceTimersToNextTimerAsync")?,
            NextStep::First,
        ))
    })
}

fn run_all_timers_async(
    global: &JSGlobalObject,
    frame: &CallFrame,
    flavor: Flavor,
) -> JsResult<JSValue> {
    drive_async(global, frame, flavor, || Ok(Drive::All(0)))
}

fn run_only_pending_timers_async(
    global: &JSGlobalObject,
    frame: &CallFrame,
    flavor: Flavor,
) -> JsResult<JSValue> {
    drive_async(global, frame, flavor, || Ok(Drive::Tick(None)))
}

macro_rules! both_flavors {
    ($($function:ident => $vi:ident, $jest:ident;)+) => {$(
        #[bun_jsc::host_fn]
        fn $vi(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
            $function(global, frame, Flavor::Vi)
        }

        #[bun_jsc::host_fn]
        fn $jest(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
            $function(global, frame, Flavor::Jest)
        }
    )+};
}

both_flavors! {
    use_fake_timers => vi_use_fake_timers, jest_use_fake_timers;
    advance_timers_by_time_async => vi_advance_timers_by_time_async, jest_advance_timers_by_time_async;
    advance_timers_to_next_timer_async => vi_advance_timers_to_next_timer_async, jest_advance_timers_to_next_timer_async;
    run_all_timers_async => vi_run_all_timers_async, jest_run_all_timers_async;
    run_only_pending_timers_async => vi_run_only_pending_timers_async, jest_run_only_pending_timers_async;
}

/// vitest: `setTimerTickMode("manual" | "nextTimerAsync" | "interval", interval?)`.
/// Jest: `setTimerTickMode({ mode: "manual" | "nextAsync" | "interval", delta? })`.
#[bun_jsc::host_fn]
fn set_timer_tick_mode(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [mut mode, mut interval] = frame.arguments_as_array::<2>();
    if mode.is_object() {
        let config = mode;
        mode = config.get(global, "mode")?.unwrap_or(JSValue::UNDEFINED);
        interval = config.get(global, "delta")?.unwrap_or(JSValue::UNDEFINED);
    }
    if !mode.is_string() {
        return Err(global.throw_invalid_arguments(format_args!(
            "setTimerTickMode() expects \"manual\", \"nextTimerAsync\" or \"interval\""
        )));
    }
    let mode = mode.to_bun_string(global)?;
    let mode = if mode.eq_ascii(b"manual") {
        TickMode::Manual
    } else if mode.eq_ascii(b"nextTimerAsync") || mode.eq_ascii(b"nextAsync") {
        TickMode::NextAsync
    } else if !mode.eq_ascii(b"interval") {
        return Err(global.throw_invalid_arguments(format_args!(
            "setTimerTickMode() expects \"manual\", \"nextTimerAsync\" or \"interval\". Received \"{mode}\""
        )));
    } else if interval.is_undefined() {
        TickMode::Interval(TickMode::DEFAULT_INTERVAL_MS)
    } else {
        TickMode::interval_from_js(global, "setTimerTickMode() interval", interval)?
    };
    error_unless_fake_timers(global)?;
    FakeTimers::set_tick_mode(mode);
    Ok(chainable_this(global, frame))
}

#[bun_jsc::host_fn]
fn get_timer_count(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    // SAFETY: per-thread `timer::All`, live for the VM lifetime.
    let count = unsafe { (*timer_all()).fake_timers.count() };

    Ok(JSValue::js_number(count as f64))
}

#[bun_jsc::host_fn]
fn clear_all_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    // SAFETY: per-thread `timer::All`; the borrow ends before `release`.
    let cleared = unsafe { (*timer_all()).fake_timers.clear() };
    cleared.release(global.bun_vm_ptr());

    Ok(chainable_this(global, frame))
}

#[bun_jsc::host_fn]
fn is_fake_timers(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::from(is_active()))
}

#[bun_jsc::host_fn]
fn get_mocked_system_time(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: per-thread `timer::All`, live for the VM lifetime.
    let this = unsafe { &(*timer_all()).fake_timers };
    let mocked = if this.active {
        this.date_now()
    } else {
        bun_jsc::cpp::Bun__FakeTimers__overriddenDateNow(global)
    };
    if mocked.is_nan() {
        return Ok(JSValue::NULL);
    }
    Ok(JSValue::from_date_number(global, mocked))
}

#[bun_jsc::host_fn]
fn get_real_system_time(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::js_number(JSMock__getCurrentUnixTimeMs().floor()))
}

// `#[bun_jsc::host_fn]` emits a `__jsc_host_{name}` shim with the raw
// `JSHostFn` ABI (`unsafe extern "C" fn(*mut JSGlobalObject, *mut CallFrame) -> JSValue`),
// which is what `JSFunction::create` expects.
const FAKE_TIMERS_FNS: &[(&str, u32, JSHostFn)] = &[
    ("useRealTimers", 0, __jsc_host_use_real_timers),
    (
        "advanceTimersToNextTimer",
        0,
        __jsc_host_advance_timers_to_next_timer,
    ),
    ("advanceTimersByTime", 1, __jsc_host_advance_timers_by_time),
    (
        "advanceTimersToNextFrame",
        0,
        __jsc_host_advance_timers_to_next_frame,
    ),
    (
        "runOnlyPendingTimers",
        0,
        __jsc_host_run_only_pending_timers,
    ),
    ("runAllTimers", 0, __jsc_host_run_all_timers),
    ("runAllTicks", 0, __jsc_host_run_all_ticks),
    ("runAllImmediates", 0, __jsc_host_run_all_immediates),
    ("setTimerTickMode", 1, __jsc_host_set_timer_tick_mode),
    ("getTimerCount", 0, __jsc_host_get_timer_count),
    ("clearAllTimers", 0, __jsc_host_clear_all_timers),
    ("isFakeTimers", 0, __jsc_host_is_fake_timers),
    ("getMockedSystemTime", 0, __jsc_host_get_mocked_system_time),
    ("getRealSystemTime", 0, __jsc_host_get_real_system_time),
];

/// (name, length, `vi`'s, `jest`'s)
const FLAVORED_FAKE_TIMERS_FNS: &[(&str, u32, JSHostFn, JSHostFn)] = &[
    (
        "useFakeTimers",
        0,
        __jsc_host_vi_use_fake_timers,
        __jsc_host_jest_use_fake_timers,
    ),
    (
        "advanceTimersByTimeAsync",
        1,
        __jsc_host_vi_advance_timers_by_time_async,
        __jsc_host_jest_advance_timers_by_time_async,
    ),
    (
        "advanceTimersToNextTimerAsync",
        0,
        __jsc_host_vi_advance_timers_to_next_timer_async,
        __jsc_host_jest_advance_timers_to_next_timer_async,
    ),
    (
        "runAllTimersAsync",
        0,
        __jsc_host_vi_run_all_timers_async,
        __jsc_host_jest_run_all_timers_async,
    ),
    (
        "runOnlyPendingTimersAsync",
        0,
        __jsc_host_vi_run_only_pending_timers_async,
        __jsc_host_jest_run_only_pending_timers_async,
    ),
];

pub(crate) fn put_timers_fns(global: &JSGlobalObject, jest: JSValue, vi: JSValue) {
    for &(name, arity, func) in FAKE_TIMERS_FNS {
        let jsvalue = JSFunction::create(global, name, func, arity, Default::default());
        vi.put(global, name.as_bytes(), jsvalue);
        jest.put(global, name.as_bytes(), jsvalue);
    }
    for &(name, arity, vi_func, jest_func) in FLAVORED_FAKE_TIMERS_FNS {
        vi.put(
            global,
            name.as_bytes(),
            JSFunction::create(global, name, vi_func, arity, Default::default()),
        );
        jest.put(
            global,
            name.as_bytes(),
            JSFunction::create(global, name, jest_func, arity, Default::default()),
        );
    }
}
