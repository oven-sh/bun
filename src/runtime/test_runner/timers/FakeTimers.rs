use core::cell::Cell;

use bun_core::Timespec;
use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope};
use bun_jsc::{JSFunction, JSGlobalObject, JSHostFn, JSValue, JsResult};
use crate::api::cron::CronJob;
use crate::generated_bindgen::fake_timers::{
    Bun__FakeTimers__advanceTimersByTime, Bun__FakeTimers__advanceTimersToNextTimer,
    Bun__FakeTimers__clearAllTimers, Bun__FakeTimers__getTimerCount, Bun__FakeTimers__isFakeTimers,
    Bun__FakeTimers__runAllTimers, Bun__FakeTimers__runOnlyPendingTimers,
    Bun__FakeTimers__useFakeTimers, Bun__FakeTimers__useRealTimers, FakeTimersImplementationOrOptions,
};
use crate::jsc::virtual_machine::VirtualMachine;
use crate::timer::{
    AbortSignalTimeout, All, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, InHeap,
    TimerHeap, TimerObjectInternals, erase_vm,
};

// JSMock C++ bindings (fake timers are only used by bun:test, so these stay local).
unsafe extern "C" {
    safe fn JSMock__setOverridenDateNow(global: &JSGlobalObject, value: f64);
    safe fn JSMock__getCurrentUnixTimeMs() -> f64;
}

#[derive(Default)]
pub(crate) struct FakeTimers {
    /// Fake monotonic clock. `useFakeTimers()` starts it at 0. `None` means the real clock is in use.
    now: Cell<Option<Timespec>>,
    /// `Date.now()` minus `now.ms()`.
    date_now_offset: Cell<f64>,
    /// Depth of [`FakeTimers::fire`] calls on the stack; each covers the callback and its microtask drain.
    firing: Cell<u32>,
    /// The sorted fake timers. TimerHeap is not optimal here because we need these operations:
    /// - peek/takeFirst (provided by TimerHeap)
    /// - peekLast (cannot be implemented efficiently with TimerHeap)
    /// - count (cannot be implemented efficiently with TimerHeap)
    pub(crate) timers: TimerHeap,
}

impl FakeTimers {
    fn set_now(&self, global: &JSGlobalObject, now: &Timespec, js: Option<f64>) {
        let vm = global.bun_vm();
        self.now.set(Some(*now));
        // Mirror into T0 storage so `Timespec::now(AllowMockedTime)` sees
        // the fake clock.
        bun_core::mock_time::set(now.ns() as i64);
        let timespec_ms: f64 = now.ms() as f64;
        if let Some(js) = js {
            self.date_now_offset.set(js.floor() - timespec_ms);
        }
        let date_now = self.date_now_offset.get() + timespec_ms;
        JSMock__setOverridenDateNow(global, date_now);
        bun_core::mock_time::set_wall_ms(date_now);

        vm.overridden_performance_now.set(Some(now.ns()));
        // `Date.now() == date_now_offset + performance.now()`, so the offset is
        // the fake clock's `performance.timeOrigin`.
        vm.overridden_time_origin
            .set(Some(self.date_now_offset.get()));
    }

    fn clear_now(&self, global: &JSGlobalObject) {
        let vm = global.bun_vm();
        self.now.set(None);
        bun_core::mock_time::clear();
        bun_core::mock_time::clear_wall();
        // NaN is JSGlobalObject::overridenDateNow's "no override" sentinel; a
        // real -1 would pin Date.now() at 1969-12-31T23:59:59.999Z.
        JSMock__setOverridenDateNow(global, f64::NAN);
        vm.overridden_performance_now.set(None);
        vm.overridden_time_origin.set(None);
    }
}

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
    let vm = global.bun_vm();
    let fake_timers = &All::of(vm).fake_timers;
    let Some(current) = fake_timers.now.get() else {
        return;
    };
    if ms.is_nan() {
        bun_core::mock_time::clear_wall();
        vm.overridden_time_origin.set(None);
        return;
    }
    fake_timers.date_now_offset.set(ms - current.ms() as f64);
    bun_core::mock_time::set_wall_ms(ms);
    vm.overridden_time_origin
        .set(Some(fake_timers.date_now_offset.get()));
}

/// Owners of the nodes [`FakeTimers::clear`] popped, still to be told their
/// timer is gone.
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
    fn release(self, vm: &VirtualMachine) {
        for p in self.pinned {
            // SAFETY: `clear` popped `p`'s node from the fake heap, and a linked node holds the
            // ref of `reschedule()`, which nothing has released since.
            unsafe { TimerObjectInternals::release_heap_pin(p, vm) };
        }
        for t in self.signal_timeouts {
            // SAFETY: `clear` popped `t` from the fake heap, so its box is
            // still owned by a live signal; JS thread. `t` is freed by the call.
            unsafe { AbortSignalTimeout::discard(t) };
        }
        for job in self.cron_jobs {
            // SAFETY: `clear` popped `job`'s node from the fake heap, so the
            // job was scheduled and its JS wrapper (strong while scheduled)
            // keeps it alive; no JS has run since.
            CronJob::stop_dropped_from_fake_heap(unsafe { bun_ptr::ThisPtr::new(job) }, vm);
        }
    }
}

impl FakeTimers {
    pub(crate) fn is_active(&self) -> bool {
        self.now.get().is_some()
    }

    /// 1 while a fake timer's callback runs (sinon's `duringTick` rule): a zero-delay re-arm is due again in the drain that runs it.
    pub(crate) fn min_delay_ms(&self) -> u32 {
        if self.is_active() && self.firing.get() > 0 { 1 } else { 0 }
    }

    fn activate(&self, js_now: f64, global: &JSGlobalObject) {
        self.set_now(global, &Timespec::EPOCH, Some(js_now));
    }

    fn deactivate(&self, global: &JSGlobalObject) -> ClearedTimers {
        let cleared = self.clear();
        self.clear_now(global);
        cleared
    }

    /// Restore real timers without draining the fake heap. Used by the
    /// `--isolate` file boundary so `swap_global_for_test_isolation`'s
    /// `cancel_all_timeout_objects` (which runs after the outgoing global's
    /// JS has stopped) can walk the still-populated fake heap and release
    /// `TimeoutObject` pins and discard `AbortSignalTimeout` timers.
    pub(crate) fn reset_for_isolation(&self, global: &JSGlobalObject) {
        self.clear_now(global);
    }

    /// Pop every fake timer. Popping only unlinks the nodes; the owners that
    /// need to hear about it are returned for the caller to release.
    fn clear(&self) -> ClearedTimers {
        let mut cleared = ClearedTimers::default();
        // SAFETY: what it pops is marked `CANCELLED` first thing.
        while let Some(timer) = unsafe { self.timers.delete_min() } {
            // SAFETY: `delete_min` returned a live node; the owner it belongs
            // to stays live until the caller's release pass.
            unsafe {
                (*timer).in_heap = InHeap::None;
                (*timer).state = EventLoopTimerState::CANCELLED;
                match (*timer).tag {
                    EventLoopTimerTag::TimeoutObject => {
                        cleared.pinned.push(core::ptr::NonNull::new_unchecked(
                            TimerObjectInternals::from_timer_ptr(timer),
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

    fn execute_next(&self, global: &JSGlobalObject) -> JsResult<bool> {
        // SAFETY: what it pops is fired at once.
        unsafe {
            let Some(next) = self.timers.delete_min() else {
                return Ok(false);
            };
            self.fire(global, next)?;
        }
        Ok(true)
    }

    /// Fired from inside the `jest` timer-control host functions. The fake
    /// clock is a timer drain of its own: like `All::drain_timers`, a
    /// timer whose callback threw is reported and the drain goes on; only the
    /// VM's termination stops it, thrown to the `jest` host function driving it.
    ///
    /// # Safety
    /// `next` was just popped from `self.timers`, which are those of `global`'s VM.
    unsafe fn fire(&self, global: &JSGlobalObject, next: *mut EventLoopTimer) -> JsResult<()> {
        // SAFETY: a node is live until its handler has run.
        let deadline = unsafe { (*next).next };
        debug_assert!(self.is_active());
        // An earlier callback in this drain can advance the clock past `deadline` with a
        // `jest` timer call. The timer then fires late, like an overdue real timer.
        let now = match self.now.get() {
            Some(current) if current.greater(&deadline) => current,
            _ => deadline,
        };
        self.set_now(global, &now, None);
        self.firing.set(self.firing.get() + 1);
        // SAFETY: fn contract.
        let fired = unsafe { EventLoopTimer::fire(next, &now, erase_vm(global.bun_vm())) };
        self.firing.set(self.firing.get() - 1);
        match fired {
            Ok(()) => Ok(()),
            Err(err) => bun_jsc::task::report_error_or_terminate(global, err)
                .map_err(|stopped| stopped.throw(global)),
        }
    }

    fn execute_until(&self, global: &JSGlobalObject, until: Timespec) -> JsResult<()> {
        while let Some(peek) = self.timers.peek() {
            // SAFETY: `peek` is the heap root; live while linked.
            if unsafe { (*peek).next }.greater(&until) {
                break;
            }
            // SAFETY: what it pops is fired at once.
            unsafe {
                let min = self.timers.delete_min().expect("unreachable");
                debug_assert!(core::ptr::eq(min, peek));
                self.fire(global, min)?;
            }
        }
        Ok(())
    }

    fn execute_only_pending_timers(&self, global: &JSGlobalObject) -> JsResult<()> {
        let until = match self.timers.find_max() {
            // SAFETY: `t` is reachable in the heap and live while linked.
            Some(t) => unsafe { (*t).next },
            None => return Ok(()),
        };
        self.execute_until(global, until)
    }

    fn execute_all_timers(&self, global: &JSGlobalObject) -> JsResult<()> {
        while self.execute_next(global)? {}
        Ok(())
    }
}

// ===
// JS Functions
// ===

fn error_unless_fake_timers(global: &JSGlobalObject) -> JsResult<&FakeTimers> {
    let fake_timers = &All::of(global.bun_vm()).fake_timers;
    if fake_timers.is_active() {
        return Ok(fake_timers);
    }
    Err(global.throw(format_args!(
        "Fake timers are not active. Call useFakeTimers() first."
    )))
}

/// Set or remove the "clock" property on setTimeout to indicate that fake timers are active.
/// This is used by testing-library/react's jestFakeTimersAreEnabled() function to detect
/// if jest.advanceTimersByTime() should be called when draining the microtask queue.
fn set_fake_timer_marker(global: &JSGlobalObject, enabled: bool) -> JsResult<()> {
    let global_this = global.to_js_value();
    // `get()` (vs `get_own_truthy`) so the LUT-registered `setTimeout` is
    // resolved even before first reification — semantically equivalent on
    // the global since `setTimeout` is always an own property.
    let Some(set_timeout_fn) = global_this.get(global, "setTimeout")? else {
        return Ok(());
    };
    if !set_timeout_fn.is_object() {
        return Ok(());
    }
    // testing-library/react checks Object.hasOwnProperty.call(setTimeout, 'clock')
    // to detect if fake timers are enabled.
    if enabled {
        bun_jsc::cpp::JSMock__defineFakeTimersMarker(global, set_timeout_fn)?;
    } else {
        set_timeout_fn.delete_property(global, "clock")?;
    }
    Ok(())
}

pub(crate) fn use_fake_timers(
    cx: &mut JsScope<'_>,
    this_value: JsLocal<'_>,
    options: Option<FakeTimersImplementationOrOptions>,
) -> JsResult<JSValue> {
    let global = cx.global();
    // SAFETY: FFI call into C++ JSMock
    let mut js_now = JSMock__getCurrentUnixTimeMs();

    // Jest 26 compat: useFakeTimers("modern" | "legacy") is a no-op.
    if let Some(FakeTimersImplementationOrOptions::Options(options)) = options
        && let Some(now) = options.now
    {
        // NaN is `JSGlobalObject::overridenDateNow`'s "no override" sentinel.
        if !now.is_finite() {
            return Err(global.throw_invalid_arguments(format_args!(
                "'now' must be a finite number or a valid Date"
            )));
        }
        js_now = now;
    }

    // Set setTimeout.clock = true to signal that fake timers are enabled.
    // This is used by testing-library/react to detect if jest.advanceTimersByTime should be called.
    // This can run user code and throw, so do it before turning on the fake clock.
    set_fake_timer_marker(global, true)?;

    All::of(global.bun_vm()).fake_timers.activate(js_now, global);

    Ok(bun_jsc::cpp::JSMock__toThisStrict(
        global,
        this_value.to_js(),
    ))
}

pub(crate) fn use_real_timers(cx: &mut JsScope<'_>, this_value: JsLocal<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    let vm = global.bun_vm();
    let cleared = All::of(vm).fake_timers.deactivate(global);
    cleared.release(vm);

    // Remove the setTimeout.clock marker when switching back to real timers.
    set_fake_timer_marker(global, false)?;

    Ok(bun_jsc::cpp::JSMock__toThisStrict(
        global,
        this_value.to_js(),
    ))
}

pub(crate) fn advance_timers_to_next_timer(
    cx: &mut JsScope<'_>,
    this_value: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    error_unless_fake_timers(global)?.execute_next(global)?;

    Ok(bun_jsc::cpp::JSMock__toThisStrict(
        global,
        this_value.to_js(),
    ))
}

pub(crate) fn advance_timers_by_time(
    cx: &mut JsScope<'_>,
    this_value: JsLocal<'_>,
    milliseconds: f64,
) -> JsResult<JSValue> {
    let global = cx.global();
    let fake_timers = error_unless_fake_timers(global)?;

    let Some(current) = fake_timers.now.get() else {
        return Err(global.throw_invalid_arguments(format_args!(
            "Fake timers not initialized. Initialize with useFakeTimers() first."
        )));
    };
    let max_advance = u32::MAX;
    if milliseconds.is_nan() || milliseconds < 0.0 || milliseconds > max_advance as f64 {
        return Err(global.throw_invalid_arguments(format_args!(
            "advanceTimersByTime() ms is out of range. It must be >= 0 and <= {}. Received {:.0}",
            max_advance, milliseconds
        )));
    }
    // When advanceTimersByTime(0) is called, advance by 1ms to fire setTimeout(fn, 0) timers.
    // This is because setTimeout(fn, 0) is internally scheduled with a 1ms delay per HTML spec,
    // and Jest/testing-library expect advanceTimersByTime(0) to fire such "immediate" timers.
    let effective_advance = if milliseconds == 0.0 { 1.0 } else { milliseconds };
    let target = current.add_ms_float(effective_advance);

    let advanced = fake_timers.execute_until(global, target);
    // A fired callback can call `useRealTimers()` or move the clock past `target`.
    if fake_timers.now.get().is_some_and(|now| !now.greater(&target)) {
        fake_timers.set_now(global, &target, None);
    }
    advanced?;

    Ok(bun_jsc::cpp::JSMock__toThisStrict(
        global,
        this_value.to_js(),
    ))
}

pub(crate) fn run_only_pending_timers(
    cx: &mut JsScope<'_>,
    this_value: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    error_unless_fake_timers(global)?.execute_only_pending_timers(global)?;

    Ok(bun_jsc::cpp::JSMock__toThisStrict(
        global,
        this_value.to_js(),
    ))
}

pub(crate) fn run_all_timers(cx: &mut JsScope<'_>, this_value: JsLocal<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    error_unless_fake_timers(global)?.execute_all_timers(global)?;

    Ok(bun_jsc::cpp::JSMock__toThisStrict(
        global,
        this_value.to_js(),
    ))
}

pub(crate) fn get_timer_count(heap: &JsHeap<'_>) -> JsResult<usize> {
    // SAFETY: throws, and the body returns.
    Ok(error_unless_fake_timers(unsafe { heap.global() })?.timers.count())
}

pub(crate) fn clear_all_timers(cx: &mut JsScope<'_>, this_value: JsLocal<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    let cleared = error_unless_fake_timers(global)?.clear();
    cleared.release(global.bun_vm());

    Ok(bun_jsc::cpp::JSMock__toThisStrict(
        global,
        this_value.to_js(),
    ))
}

pub(crate) fn is_fake_timers() -> bool {
    All::of(VirtualMachine::get()).fake_timers.is_active()
}

const FAKE_TIMERS_FNS: &[(&str, u32, JSHostFn)] = &[
    ("useFakeTimers", 0, Bun__FakeTimers__useFakeTimers),
    ("useRealTimers", 0, Bun__FakeTimers__useRealTimers),
    ("advanceTimersToNextTimer", 0, Bun__FakeTimers__advanceTimersToNextTimer),
    ("advanceTimersByTime", 1, Bun__FakeTimers__advanceTimersByTime),
    ("runOnlyPendingTimers", 0, Bun__FakeTimers__runOnlyPendingTimers),
    ("runAllTimers", 0, Bun__FakeTimers__runAllTimers),
    ("getTimerCount", 0, Bun__FakeTimers__getTimerCount),
    ("clearAllTimers", 0, Bun__FakeTimers__clearAllTimers),
    ("isFakeTimers", 0, Bun__FakeTimers__isFakeTimers),
];

pub(crate) const TIMER_FNS_COUNT: usize = FAKE_TIMERS_FNS.len();

pub(crate) fn put_timers_fns(global: &JSGlobalObject, jest: JSValue, vi: JSValue) {
    for &(name, arity, func) in FAKE_TIMERS_FNS {
        let jsvalue = JSFunction::create(global, name, func, arity, Default::default());
        vi.put(global, name.as_bytes(), jsvalue);
        jest.put(global, name.as_bytes(), jsvalue);
    }
}
