use std::sync::atomic::{AtomicU64, Ordering};

use bun_threading::RwLock;

use bun_core::Environment;
use bun_core::Timespec;
use core::cell::Cell;

use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSValue, JsResult};
use crate::jsc::virtual_machine::VirtualMachine;
use crate::timer::{EventLoopTimerState, InHeap, TimerHeap, TimerRef};

// JSMock C++ bindings (fake timers are only used by bun:test, so these stay local).
unsafe extern "C" {
    safe fn JSMock__setOverridenDateNow(global: &JSGlobalObject, value: f64);
    safe fn JSMock__getCurrentUnixTimeMs() -> f64;
}

pub struct FakeTimers {
    active: Cell<bool>,
    /// The sorted fake timers. TimerHeap is not optimal here because we need these operations:
    /// - peek/takeFirst (provided by TimerHeap)
    /// - peekLast (cannot be implemented efficiently with TimerHeap)
    /// - count (cannot be implemented efficiently with TimerHeap)
    pub(crate) timers: TimerHeap,
}

impl Default for FakeTimers {
    fn default() -> Self {
        Self {
            active: Cell::new(false),
            timers: TimerHeap::new(InHeap::Fake),
        }
    }
}

// `date_now_offset` is stored as `AtomicU64` (f64 bits) so the static is `Sync`
// without `static mut`.
pub(crate) struct CurrentTime {
    /// starts at 0. offset in milliseconds.
    offset_raw: RwLock<Timespec>,
    date_now_offset: AtomicU64,
}

const MIN_TIMESPEC: Timespec = Timespec { sec: i64::MIN, nsec: i64::MIN };

static CURRENT_TIME: CurrentTime = CurrentTime {
    offset_raw: RwLock::new(MIN_TIMESPEC),
    date_now_offset: AtomicU64::new(0f64.to_bits()),
};

impl CurrentTime {
    pub(crate) fn get_timespec_now(&self) -> Option<Timespec> {
        let value = *self.offset_raw.read();
        if value.eql(&MIN_TIMESPEC) {
            return None;
        }
        Some(value)
    }

    pub(crate) fn set(&self, global: &JSGlobalObject, offset: &Timespec, js: Option<f64>) {
        let vm = global.bun_vm().as_mut();
        {
            *self.offset_raw.write() = *offset;
        }
        // Mirror into T0 storage so `Timespec::now(AllowMockedTime)` sees
        // the fake clock.
        bun_core::mock_time::set(offset.ns() as i64);
        let timespec_ms: f64 = offset.ms() as f64;
        let mut date_now_offset = f64::from_bits(self.date_now_offset.load(Ordering::Relaxed));
        if let Some(js) = js {
            date_now_offset = js.floor() - timespec_ms;
            self.date_now_offset.store(date_now_offset.to_bits(), Ordering::Relaxed);
        }
        let date_now = date_now_offset + timespec_ms;
        // SAFETY: FFI call into C++ JSMock; global is a valid &JSGlobalObject
        JSMock__setOverridenDateNow(global, date_now);
        bun_core::mock_time::set_wall_ms(date_now);

        vm.overridden_performance_now = Some(offset.ns());
        // `Date.now() == date_now_offset + performance.now()`, so the offset is
        // the fake clock's `performance.timeOrigin`.
        vm.overridden_time_origin = Some(date_now_offset);
    }

    pub(crate) fn clear(&self, global: &JSGlobalObject) {
        let vm = global.bun_vm().as_mut();
        {
            *self.offset_raw.write() = MIN_TIMESPEC;
        }
        bun_core::mock_time::clear();
        bun_core::mock_time::clear_wall();
        // NaN is JSGlobalObject::overridenDateNow's "no override" sentinel; a
        // real -1 would pin Date.now() at 1969-12-31T23:59:59.999Z.
        // SAFETY: FFI call into C++ JSMock; global is a valid &JSGlobalObject
        JSMock__setOverridenDateNow(global, f64::NAN);
        vm.overridden_performance_now = None;
        vm.overridden_time_origin = None;
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
    let Some(current) = CURRENT_TIME.get_timespec_now() else {
        return;
    };
    let vm = global.bun_vm().as_mut();
    if ms.is_nan() {
        bun_core::mock_time::clear_wall();
        vm.overridden_time_origin = None;
        return;
    }
    let date_now_offset = ms - current.ms() as f64;
    CURRENT_TIME
        .date_now_offset
        .store(date_now_offset.to_bits(), Ordering::Relaxed);
    bun_core::mock_time::set_wall_ms(ms);
    vm.overridden_time_origin = Some(date_now_offset);
}

use crate::jsc_hooks::timer_all;

/// Owners of the slots [`FakeTimers::clear`] popped, still to be told their
/// timer is gone: marking `state = CANCELLED` alone would strand a
/// `TimeoutObject` (the heap's ref and its `this_value` Strong pin each
/// other), leave an `AbortSignal.timeout()` box as its signal's `m_timeout`
/// (pinning an observed signal's wrapper), and leave a `Bun.cron()` job keeping
/// the event loop alive. Releasing re-enters `timer::All`.
#[derive(Default)]
#[must_use]
struct ClearedTimers(Vec<TimerRef>);

impl ClearedTimers {
    fn release(self, vm: &VirtualMachine) {
        for t in self.0 {
            crate::dispatch::cancel_js_timer(t, vm);
        }
    }
}

impl FakeTimers {
    pub(crate) fn is_active(&self) -> bool {
        self.active.get()
    }

    fn activate(&self, js_now: f64, global: &JSGlobalObject) {
        self.active.set(true);
        CURRENT_TIME.set(global, &Timespec::EPOCH, Some(js_now));
    }

    fn deactivate(&self, global: &JSGlobalObject) -> ClearedTimers {
        let cleared = self.clear();
        CURRENT_TIME.clear(global);
        self.active.set(false);
        cleared
    }

    /// Restore real timers without draining the fake heap. Used by the
    /// `--isolate` file boundary so `swap_global_for_test_isolation`'s
    /// `cancel_all_timeout_objects` (which runs after the outgoing global's
    /// JS has stopped) can walk the still-populated fake heap and release
    /// `TimeoutObject` pins and discard `AbortSignalTimeout` timers.
    pub(crate) fn reset_for_isolation(&self, global: &JSGlobalObject) {
        CURRENT_TIME.clear(global);
        self.active.set(false);
    }

    /// Pop every fake timer. Popping only unlinks the nodes; the owners that
    /// need to hear about it are returned for the caller to release.
    fn clear(&self) -> ClearedTimers {
        let mut cleared = ClearedTimers::default();
        while let Some(timer) = self.timers.delete_min() {
            timer.set_state(EventLoopTimerState::CANCELLED);
            debug_assert!(
                timer.tag().allow_fake_timers(),
                "{} timer in the fake heap has no release path",
                <&'static str>::from(timer.tag()),
            );
            cleared.0.push(timer);
        }

        cleared
    }

    fn execute_next(global: &JSGlobalObject) -> JsResult<bool> {
        let Some(next) = timer_all().fake_timers.timers.delete_min() else {
            return Ok(false);
        };

        Self::fire(global, next)?;
        Ok(true)
    }

    /// Fired from inside the `jest` timer-control host functions. The fake
    /// clock is a timer drain of its own: like `All::drain_timers`, a
    /// timer whose callback threw is reported and the drain goes on; only the
    /// VM's termination stops it, thrown to the `jest` host function driving it.
    fn fire(global: &JSGlobalObject, next: TimerRef) -> JsResult<()> {
        let vm = global.bun_vm();

        let now = next.next();
        if Environment::CI_ASSERT {
            let prev = CURRENT_TIME.get_timespec_now();
            debug_assert!(prev.is_some());
            debug_assert!(now.eql(&prev.unwrap()) || now.greater(&prev.unwrap()));
        }
        CURRENT_TIME.set(global, &now, None);
        let fired = crate::dispatch::fire_timer(next, &now, vm);
        match fired {
            Ok(()) => Ok(()),
            Err(err) => bun_jsc::task::report_error_or_terminate(global, err)
                .map_err(|stopped| stopped.throw(global)),
        }
    }

    fn execute_until(global: &JSGlobalObject, until: Timespec) -> JsResult<()> {
        let timers = &timer_all().fake_timers.timers;
        loop {
            let Some(peek) = timers.peek() else {
                break;
            };
            if peek.next().greater(&until) {
                break;
            }
            // bun.assert always evaluates its arg; debug_assert! does NOT in release.
            // Hoist the side-effecting delete_min() out so the timer is removed in all builds.
            let next = timers.delete_min().expect("unreachable");
            debug_assert!(next == peek);
            Self::fire(global, next)?;
        }
        Ok(())
    }

    fn execute_only_pending_timers(global: &JSGlobalObject) -> JsResult<()> {
        let Some(last) = timer_all().fake_timers.timers.find_max() else {
            return Ok(());
        };
        Self::execute_until(global, last.next())
    }

    fn execute_all_timers(global: &JSGlobalObject) -> JsResult<()> {
        while Self::execute_next(global)? {}
        Ok(())
    }
}

// ===
// JS Functions
// ===

fn error_unless_fake_timers(global: &JSGlobalObject) -> JsResult<()> {
    if timer_all().fake_timers.is_active() {
        return Ok(());
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
        set_timeout_fn.put(global, "clock", JSValue::TRUE);
    } else {
        set_timeout_fn.delete_property(global, "clock")?;
    }
    Ok(())
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
            // NaN is `JSGlobalObject::overridenDateNow`'s "no override" sentinel.
            if !js_now.is_finite() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'now' must be a finite number or a valid Date"
                )));
            }
        }
    }

    timer_all().fake_timers.activate(js_now, global);

    // Set setTimeout.clock = true to signal that fake timers are enabled.
    // This is used by testing-library/react to detect if jest.advanceTimersByTime should be called.
    set_fake_timer_marker(global, true)?;

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn use_real_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let cleared = timer_all().fake_timers.deactivate(global);
    cleared.release(global.bun_vm());

    // Remove the setTimeout.clock marker when switching back to real timers.
    set_fake_timer_marker(global, false)?;

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
    error_unless_fake_timers(global)?;

    let arg = frame.arguments_as_array::<1>()[0];
    if !arg.is_number() {
        return Err(global.throw_invalid_arguments(format_args!(
            "advanceTimersByTime() expects a number of milliseconds"
        )));
    }
    let Some(current) = CURRENT_TIME.get_timespec_now() else {
        return Err(global.throw_invalid_arguments(format_args!(
            "Fake timers not initialized. Initialize with useFakeTimers() first."
        )));
    };
    let arg_number = arg.as_number();
    let max_advance = u32::MAX;
    if arg_number.is_nan() || arg_number < 0.0 || arg_number > max_advance as f64 {
        return Err(global.throw_invalid_arguments(format_args!(
            "advanceTimersByTime() ms is out of range. It must be >= 0 and <= {}. Received {:.0}",
            max_advance, arg_number
        )));
    }
    // When advanceTimersByTime(0) is called, advance by 1ms to fire setTimeout(fn, 0) timers.
    // This is because setTimeout(fn, 0) is internally scheduled with a 1ms delay per HTML spec,
    // and Jest/testing-library expect advanceTimersByTime(0) to fire such "immediate" timers.
    let effective_advance = if arg_number == 0.0 { 1.0 } else { arg_number };
    let target = current.add_ms_float(effective_advance);

    let advanced = FakeTimers::execute_until(global, target);
    CURRENT_TIME.set(global, &target, None);
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

    let count = timer_all().fake_timers.timers.count();

    Ok(JSValue::js_number(count as f64))
}

#[bun_jsc::host_fn]
fn clear_all_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    let cleared = timer_all().fake_timers.clear();
    cleared.release(global.bun_vm());

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn is_fake_timers(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let is_active = timer_all().fake_timers.is_active();

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
