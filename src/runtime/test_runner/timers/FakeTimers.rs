use bun_core::Environment;
use bun_core::Timespec;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSValue, JsResult};
use crate::api::cron::CronJob;
use crate::jsc::virtual_machine::VirtualMachine;
use crate::timer::{
    AbortSignalTimeout, ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag,
    InHeap, TimerObjectInternals, TimeoutObject, TimerHeap,
};

// JSMock C++ bindings (fake timers are only used by bun:test, so these stay local).
unsafe extern "C" {
    safe fn JSMock__setOverridenDateNow(global: &JSGlobalObject, value: f64);
    safe fn JSMock__getCurrentUnixTimeMs() -> f64;
}

#[derive(Default)]
pub struct FakeTimers {
    /// The sorted fake timers. TimerHeap is not optimal here because we need these operations:
    /// - peek/takeFirst (provided by TimerHeap)
    /// - peekLast (cannot be implemented efficiently with TimerHeap)
    /// - count (cannot be implemented efficiently with TimerHeap)
    pub(crate) timers: TimerHeap,
    /// The fake monotonic clock; starts at 0 on `useFakeTimers()`, `None`
    /// while real timers are in use.
    now: Option<Timespec>,
    /// `Date.now()` minus `now.ms()`.
    date_now_offset: f64,
    /// Bumped by every `useFakeTimers()`, so a drain loop can tell that a
    /// callback it fired swapped in a fresh clock and stop driving it.
    generation: u32,
}

impl FakeTimers {
    pub(crate) fn is_active(&self) -> bool {
        self.now.is_some()
    }

    fn generation() -> u32 {
        // SAFETY: per-thread `timer::All`, live for the VM lifetime.
        unsafe { (*timer_all()).fake_timers.generation }
    }

    fn set_now(&mut self, global: &JSGlobalObject, now: &Timespec, js: Option<f64>) {
        self.now = Some(*now);
        // Mirror into T0 storage so `Timespec::now(AllowMockedTime)` sees
        // the fake clock.
        bun_core::mock_time::set(now.ns() as i64);
        let timespec_ms: f64 = now.ms() as f64;
        if let Some(js) = js {
            self.date_now_offset = js.floor() - timespec_ms;
        }
        let date_now = self.date_now_offset + timespec_ms;
        JSMock__setOverridenDateNow(global, date_now);
        bun_core::mock_time::set_wall_ms(date_now);
        global.bun_vm().as_mut().overridden_performance_now = Some(now.ns());
    }

    fn clear_now(&mut self, global: &JSGlobalObject) {
        self.now = None;
        bun_core::mock_time::clear();
        bun_core::mock_time::clear_wall();
        // NaN is JSGlobalObject::overridenDateNow's "no override" sentinel; a
        // real -1 would pin Date.now() at 1969-12-31T23:59:59.999Z.
        JSMock__setOverridenDateNow(global, f64::NAN);
        global.bun_vm().as_mut().overridden_performance_now = None;
    }
}

/// `jest.setSystemTime` (C++ `JSMock__jsSetSystemTime`) writes
/// `globalObject->overridenDateNow` directly; rebase `date_now_offset` here so
/// the next `advanceTimersByTime` recomputes `Date.now` from the set time
/// instead of the stale activation-time offset. No-op when fake timers are
/// inactive or `ms` is NaN (the "clear override" sentinel).
#[unsafe(no_mangle)]
extern "C" fn Bun__FakeTimers__setSystemTime(ms: f64) {
    if ms.is_nan() {
        return;
    }
    // SAFETY: called from `jest.setSystemTime` on the JS thread, whose
    // per-thread `timer::All` is live; nothing here re-enters `All`.
    let fake_timers = unsafe { &mut (*timer_all()).fake_timers };
    let Some(current) = fake_timers.now else {
        return;
    };
    fake_timers.date_now_offset = ms - current.ms() as f64;
    bun_core::mock_time::set_wall_ms(ms);
}

use crate::jsc_hooks::timer_all;

#[inline]
fn from_el_timespec(t: &ElTimespec) -> Timespec {
    Timespec { sec: t.sec, nsec: t.nsec }
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
            unsafe { CronJob::stop_dropped_from_fake_heap(job) };
        }
    }
}

impl FakeTimers {
    /// Like Jest and Vitest, every `useFakeTimers()` installs a fresh clock:
    /// timers pending on a previous fake clock are dropped, not carried over.
    fn activate(&mut self, js_now: f64, global: &JSGlobalObject) -> ClearedTimers {
        let cleared = self.clear();
        self.generation = self.generation.wrapping_add(1);
        self.set_now(global, &Timespec::EPOCH, Some(js_now));
        cleared
    }

    fn deactivate(&mut self, global: &JSGlobalObject) -> ClearedTimers {
        let cleared = self.clear();
        self.clear_now(global);
        cleared
    }

    /// Restore real timers without draining the fake heap. Used by the
    /// `--isolate` file boundary so `swap_global_for_test_isolation`'s
    /// `cancel_all_timeout_objects` (which runs after the outgoing global's
    /// JS has stopped) can walk the still-populated fake heap and release
    /// `TimeoutObject` pins and discard `AbortSignalTimeout` timers.
    pub(crate) fn reset_for_isolation(&mut self, global: &JSGlobalObject) {
        self.clear_now(global);
    }

    /// Pop every fake timer. Popping only unlinks the nodes; the owners that
    /// need to hear about it are returned for the caller to release.
    fn clear(&mut self) -> ClearedTimers {
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

    fn execute_next(global: &JSGlobalObject) -> JsResult<bool> {
        // SAFETY: `timer_all()` is the live per-thread `All`; the borrow ends
        // at this statement, before `fire` re-enters `All::insert`.
        let next = match unsafe { (*timer_all()).fake_timers.timers.delete_min() } {
            Some(n) => n,
            None => return Ok(false),
        };

        Self::fire(global, next)?;
        Ok(true)
    }

    /// Fired from inside the `jest` timer-control host functions. The fake
    /// clock is a timer drain of its own: like `All::drain_timers`, a
    /// timer whose callback threw is reported and the drain goes on; only the
    /// VM's termination stops it, thrown to the `jest` host function driving it.
    fn fire(global: &JSGlobalObject, next: *mut EventLoopTimer) -> JsResult<()> {
        // SAFETY: `next` was just popped from our heap; live until callback completes.
        let now_el = unsafe { (*next).next };
        let now = from_el_timespec(&now_el);
        // SAFETY: `timer_all()` is the live per-thread `All`; the borrow ends
        // before `EventLoopTimer::fire` re-enters it.
        let this = unsafe { &mut (*timer_all()).fake_timers };
        if Environment::CI_ASSERT {
            debug_assert!(this.now.is_some_and(|prev| !prev.greater(&now)));
        }
        this.set_now(global, &now, None);
        // SAFETY: `next` is live; `fire` takes `*mut Self` (noalias re-entrancy)
        // and an erased `*mut ()` for the VM.
        let fired = unsafe { EventLoopTimer::fire(next, &now_el, bun_jsc::virtual_machine::VirtualMachine::get_mut_ptr().cast()) };
        match fired {
            Ok(()) => Ok(()),
            Err(err) => bun_jsc::task::report_error_or_terminate(global, err)
                .map_err(|stopped| stopped.throw(global)),
        }
    }

    fn execute_until(global: &JSGlobalObject, until: Timespec) -> JsResult<()> {
        let all = timer_all();
        let generation = Self::generation();
        'outer: loop {
            if Self::generation() != generation {
                break;
            }
            let next = 'blk: {
                // SAFETY: `all` is the live per-thread `All`; each borrow
                // lasts one statement and none spans `fire`.
                let Some(peek) = (unsafe { (*all).fake_timers.timers.peek() }) else {
                    break 'outer;
                };
                // SAFETY: `peek` is the heap root; live while linked.
                if from_el_timespec(unsafe { &(*peek).next }).greater(&until) {
                    break 'outer;
                }
                // bun.assert always evaluates its arg; debug_assert! does NOT in release.
                // Hoist the side-effecting delete_min() out so the timer is removed in all builds.
                // SAFETY: as above.
                let min = unsafe { (*all).fake_timers.timers.delete_min() }.expect("unreachable");
                debug_assert!(core::ptr::eq(min, peek));
                break 'blk min;
            };
            Self::fire(global, next)?;
        }
        Ok(())
    }

    fn execute_only_pending_timers(global: &JSGlobalObject) -> JsResult<()> {
        // SAFETY: `timer_all()` is the live per-thread `All`.
        let until = match unsafe { (*timer_all()).fake_timers.timers.find_max() } {
            // SAFETY: `t` is reachable in the heap and live while linked.
            Some(t) => from_el_timespec(unsafe { &(*t).next }),
            None => return Ok(()),
        };
        Self::execute_until(global, until)
    }

    fn execute_all_timers(global: &JSGlobalObject) -> JsResult<()> {
        let generation = Self::generation();
        while Self::execute_next(global)? && Self::generation() == generation {}
        Ok(())
    }
}

// ===
// JS Functions
// ===

/// The current fake clock, or a thrown "not active" error.
fn fake_now(global: &JSGlobalObject) -> JsResult<Timespec> {
    // SAFETY: per-thread `timer::All`, live for the VM lifetime.
    match unsafe { (*timer_all()).fake_timers.now } {
        Some(now) => Ok(now),
        None => Err(global.throw(format_args!(
            "Fake timers are not active. Call useFakeTimers() first."
        ))),
    }
}

fn error_unless_fake_timers(global: &JSGlobalObject) -> JsResult<()> {
    fake_now(global).map(|_| ())
}

/// Set or remove the "clock" property on setTimeout to indicate that fake timers are active.
/// This is used by testing-library/react's jestFakeTimersAreEnabled() function to detect
/// if jest.advanceTimersByTime() should be called when draining the microtask queue.
fn set_fake_timer_marker(global: &JSGlobalObject, enabled: bool) {
    let global_this = global.to_js_value();
    // `get()` (vs `get_own_truthy`) so the LUT-registered `setTimeout` is
    // resolved even before first reification — semantically equivalent on
    // the global since `setTimeout` is always an own property.
    let Ok(Some(set_timeout_fn)) = global_this.get(global, "setTimeout") else {
        return;
    };
    if !set_timeout_fn.is_object() {
        return;
    }
    // testing-library/react checks Object.hasOwnProperty.call(setTimeout, 'clock')
    // to detect if fake timers are enabled.
    if enabled {
        set_timeout_fn.put(global, "clock", JSValue::TRUE);
    } else {
        let _ = set_timeout_fn.delete_property(global, "clock");
    }
}

#[bun_jsc::host_fn]
fn use_fake_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: FFI call into C++ JSMock
    let mut js_now = JSMock__getCurrentUnixTimeMs();

    // Check if options object was provided
    let args = frame.arguments_as_array::<1>();
    if args.len() > 0 && !args[0].is_undefined() {
        let options_value = args[0];
        if options_value.is_string() {
            // Jest 26 compat: useFakeTimers("modern" | "legacy") is a no-op.
        } else if !options_value.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "useFakeTimers() expects an options object"
            )));
        } else if let Some(now) = options_value.get(global, "now")? {
            if now.is_number() {
                js_now = now.as_number();
            } else if now.is_date() {
                js_now = now.get_unix_timestamp();
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'now' must be a number or Date"
                )));
            }
        }
    }

    // SAFETY: per-thread `timer::All`; the borrow ends before `release`.
    let cleared = unsafe { (*timer_all()).fake_timers.activate(js_now, global) };
    cleared.release(global.bun_vm_ptr());

    // Set setTimeout.clock = true to signal that fake timers are enabled.
    // This is used by testing-library/react to detect if jest.advanceTimersByTime should be called.
    set_fake_timer_marker(global, true);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn use_real_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: per-thread `timer::All`; the borrow ends before `release`.
    let cleared = unsafe { (*timer_all()).fake_timers.deactivate(global) };
    cleared.release(global.bun_vm_ptr());

    // Remove the setTimeout.clock marker when switching back to real timers.
    set_fake_timer_marker(global, false);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn advance_timers_to_next_timer(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    FakeTimers::execute_next(global)?;

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn advance_timers_by_time(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let current = fake_now(global)?;

    let arg = frame.arguments_as_array::<1>()[0];
    if !arg.is_number() {
        return Err(global.throw_invalid_arguments(format_args!(
            "advanceTimersToNextTimer() expects a number of milliseconds"
        )));
    }
    let arg_number = arg.as_number();
    let max_advance = u32::MAX;
    if arg_number < 0.0 || arg_number > max_advance as f64 {
        return Err(global.throw_invalid_arguments(format_args!(
            "advanceTimersToNextTimer() ms is out of range. It must be >= 0 and <= {}. Received {:.0}",
            max_advance, arg_number
        )));
    }
    // When advanceTimersByTime(0) is called, advance by 1ms to fire setTimeout(fn, 0) timers.
    // This is because setTimeout(fn, 0) is internally scheduled with a 1ms delay per HTML spec,
    // and Jest/testing-library expect advanceTimersByTime(0) to fire such "immediate" timers.
    let effective_advance = if arg_number == 0.0 { 1.0 } else { arg_number };
    let target = current.add_ms_float(effective_advance);

    let generation = FakeTimers::generation();
    let advanced = FakeTimers::execute_until(global, target);
    // SAFETY: per-thread `timer::All`; `set_now` does not re-enter `All`.
    let fake_timers = unsafe { &mut (*timer_all()).fake_timers };
    // Land on `target` only if this is still the clock we were advancing: a
    // fired callback may have called `useRealTimers()` (or installed a fresh
    // clock with `useFakeTimers()`).
    if fake_timers.is_active() && fake_timers.generation == generation {
        fake_timers.set_now(global, &target, None);
    }
    advanced?;

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn run_only_pending_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    FakeTimers::execute_only_pending_timers(global)?;

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn run_all_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    FakeTimers::execute_all_timers(global)?;

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn get_timer_count(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    // SAFETY: per-thread `timer::All`, live for the VM lifetime.
    let count = unsafe { (*timer_all()).fake_timers.timers.count() };

    Ok(JSValue::js_number(count as f64))
}

#[bun_jsc::host_fn]
fn clear_all_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    // SAFETY: per-thread `timer::All`; the borrow ends before `release`.
    let cleared = unsafe { (*timer_all()).fake_timers.clear() };
    cleared.release(global.bun_vm_ptr());

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn is_fake_timers(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: per-thread `timer::All`, live for the VM lifetime.
    let is_active = unsafe { (*timer_all()).fake_timers.is_active() };

    Ok(JSValue::from(is_active))
}

// `#[bun_jsc::host_fn]` emits a `__jsc_host_{name}` shim with the raw
// `JSHostFn` ABI (`unsafe extern "C" fn(*mut JSGlobalObject, *mut CallFrame) -> JSValue`),
// which is what `JSFunction::create` expects.
const FAKE_TIMERS_FNS: &[(&str, u32, JSHostFn)] = &[
    ("useFakeTimers", 0, __jsc_host_use_fake_timers),
    ("useRealTimers", 0, __jsc_host_use_real_timers),
    ("advanceTimersToNextTimer", 0, __jsc_host_advance_timers_to_next_timer),
    ("advanceTimersByTime", 1, __jsc_host_advance_timers_by_time),
    ("runOnlyPendingTimers", 0, __jsc_host_run_only_pending_timers),
    ("runAllTimers", 0, __jsc_host_run_all_timers),
    ("getTimerCount", 0, __jsc_host_get_timer_count),
    ("clearAllTimers", 0, __jsc_host_clear_all_timers),
    ("isFakeTimers", 0, __jsc_host_is_fake_timers),
];

pub(crate) const TIMER_FNS_COUNT: usize = FAKE_TIMERS_FNS.len();

pub(crate) fn put_timers_fns(global: &JSGlobalObject, jest: JSValue, vi: JSValue) {
    for &(name, arity, func) in FAKE_TIMERS_FNS {
        let jsvalue = JSFunction::create(global, name, func, arity, Default::default());
        vi.put(global, name.as_bytes(), jsvalue);
        jest.put(global, name.as_bytes(), jsvalue);
    }
}
