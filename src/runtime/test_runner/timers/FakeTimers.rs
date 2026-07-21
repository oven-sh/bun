use std::sync::atomic::{AtomicU64, Ordering};

use bun_threading::RwLock;

use bun_core::Environment;
use bun_core::Timespec;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSValue, JsResult};
use crate::timer::{
    ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, InHeap,
    TimerObjectInternals, TimeoutObject, TimerHeap,
};

// JSMock C++ bindings (fake timers are only used by bun:test, so these stay local).
unsafe extern "C" {
    safe fn JSMock__setOverridenDateNow(global: &JSGlobalObject, value: f64);
    safe fn JSMock__getCurrentUnixTimeMs() -> f64;
}

#[derive(Default)]
pub struct FakeTimers {
    active: bool,
    /// The sorted fake timers. TimerHeap is not optimal here because we need these operations:
    /// - peek/takeFirst (provided by TimerHeap)
    /// - peekLast (cannot be implemented efficiently with TimerHeap)
    /// - count (cannot be implemented efficiently with TimerHeap)
    pub timers: TimerHeap,
}

// `date_now_offset` is stored as `AtomicU64` (f64 bits) so the static is `Sync`
// without `static mut`.
pub struct CurrentTime {
    /// starts at 0. offset in milliseconds.
    offset_raw: RwLock<Timespec>,
    date_now_offset: AtomicU64,
}

const MIN_TIMESPEC: Timespec = Timespec { sec: i64::MIN, nsec: i64::MIN };

pub(crate) static CURRENT_TIME: CurrentTime = CurrentTime {
    offset_raw: RwLock::new(MIN_TIMESPEC),
    date_now_offset: AtomicU64::new(0f64.to_bits()),
};

impl CurrentTime {
    pub fn get_timespec_now(&self) -> Option<Timespec> {
        let value = *self.offset_raw.read();
        if value.eql(&MIN_TIMESPEC) {
            return None;
        }
        Some(value)
    }

    pub fn set(&self, global: &JSGlobalObject, offset: &Timespec, js: Option<f64>) {
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
    }

    pub fn clear(&self, global: &JSGlobalObject) {
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
    }
}

/// `jest.setSystemTime` (C++ `JSMock__jsSetSystemTime`) writes
/// `globalObject->overridenDateNow` directly; rebase `date_now_offset` here so
/// the next `advanceTimersByTime` recomputes `Date.now` from the set time
/// instead of the stale activation-time offset. No-op when fake timers are
/// inactive or `ms` is NaN (the "clear override" sentinel).
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__FakeTimers__setSystemTime(ms: f64) {
    if ms.is_nan() {
        return;
    }
    let Some(current) = CURRENT_TIME.get_timespec_now() else {
        return;
    };
    let date_now_offset = ms - current.ms() as f64;
    CURRENT_TIME
        .date_now_offset
        .store(date_now_offset.to_bits(), Ordering::Relaxed);
    bun_core::mock_time::set_wall_ms(ms);
}

use crate::jsc_hooks::timer_all;

#[inline]
fn from_el_timespec(t: &ElTimespec) -> Timespec {
    Timespec { sec: t.sec, nsec: t.nsec }
}

impl FakeTimers {
    pub fn is_active(&self) -> bool {
        self.active
    }

    fn activate(&mut self, js_now: f64, global: &JSGlobalObject) {
        self.active = true;
        CURRENT_TIME.set(global, &Timespec::EPOCH, Some(js_now));
    }

    fn deactivate(
        &mut self,
        global: &JSGlobalObject,
    ) -> Vec<core::ptr::NonNull<TimerObjectInternals>> {
        let pinned = self.clear();
        CURRENT_TIME.clear(global);
        self.active = false;
        pinned
    }

    /// Marking `state = CANCELLED` alone strands the `Box<TimeoutObject>`: its
    /// refcount sticks at 2 (wrapper +1 from `init_with`, heap +1 from
    /// `reschedule`) and `internals.this_value` still GC-roots the wrapper, so
    /// neither side ever frees.
    #[must_use]
    fn clear(&mut self) -> Vec<core::ptr::NonNull<TimerObjectInternals>> {
        let mut pinned = Vec::new();
        while let Some(timer) = self.timers.delete_min() {
            // SAFETY: `delete_min` returned a live node; the `TimeoutObject`
            // it belongs to stays live until the caller's release pass.
            unsafe {
                (*timer).in_heap = InHeap::None;
                (*timer).state = EventLoopTimerState::CANCELLED;
                if (*timer).tag == EventLoopTimerTag::TimeoutObject {
                    let parent = TimeoutObject::from_timer_ptr(timer);
                    pinned.push(core::ptr::NonNull::new_unchecked(
                        core::ptr::addr_of_mut!((*parent).internals),
                    ));
                }
            }
        }

        pinned
    }

    fn execute_next(global: &JSGlobalObject) -> bool {
        // SAFETY: `timer_all()` is the live per-thread `All`; the borrow ends
        // at this statement, before `fire` re-enters `All::insert`.
        let next = match unsafe { (*timer_all()).fake_timers.timers.delete_min() } {
            Some(n) => n,
            None => return false,
        };

        Self::fire(global, next);
        true
    }

    fn fire(global: &JSGlobalObject, next: *mut EventLoopTimer) {
        let _vm = global.bun_vm();

        // SAFETY: `next` was just popped from our heap; live until callback completes.
        let now_el = unsafe { (*next).next };
        let now = from_el_timespec(&now_el);
        if Environment::CI_ASSERT {
            let prev = CURRENT_TIME.get_timespec_now();
            debug_assert!(prev.is_some());
            debug_assert!(now.eql(&prev.unwrap()) || now.greater(&prev.unwrap()));
        }
        CURRENT_TIME.set(global, &now, None);
        // SAFETY: `next` is live; `fire` takes `*mut Self` (noalias re-entrancy)
        // and an erased `*mut ()` for the VM.
        unsafe { EventLoopTimer::fire(next, &now_el, bun_jsc::virtual_machine::VirtualMachine::get_mut_ptr().cast()) };
    }

    fn execute_until(global: &JSGlobalObject, until: Timespec) {
        let all = timer_all();
        'outer: loop {
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
            Self::fire(global, next);
        }
    }

    fn execute_only_pending_timers(global: &JSGlobalObject) {
        // SAFETY: `timer_all()` is the live per-thread `All`.
        let until = match unsafe { (*timer_all()).fake_timers.timers.find_max() } {
            // SAFETY: `t` is reachable in the heap and live while linked.
            Some(t) => from_el_timespec(unsafe { &(*t).next }),
            None => return,
        };
        Self::execute_until(global, until);
    }

    fn execute_all_timers(global: &JSGlobalObject) {
        while Self::execute_next(global) {}
    }
}

// ===
// JS Functions
// ===

fn error_unless_fake_timers(global: &JSGlobalObject) -> JsResult<()> {
    // SAFETY: per-thread `timer::All`, live for the VM lifetime.
    if unsafe { (*timer_all()).fake_timers.is_active() } {
        return Ok(());
    }
    Err(global.throw(format_args!(
        "Fake timers are not active. Call useFakeTimers() first."
    )))
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
        if !options_value.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "useFakeTimers() expects an options object"
            )));
        }
        if let Some(now) = options_value.get(global, "now")? {
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

    // SAFETY: per-thread `timer::All`; `activate` does not re-enter `All`.
    unsafe { (*timer_all()).fake_timers.activate(js_now, global) };

    // Set setTimeout.clock = true to signal that fake timers are enabled.
    // This is used by testing-library/react to detect if jest.advanceTimersByTime should be called.
    set_fake_timer_marker(global, true);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn use_real_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: per-thread `timer::All`; the borrow ends before `release_heap_pin`.
    let pinned = unsafe { (*timer_all()).fake_timers.deactivate(global) };
    let vm = global.bun_vm_ptr();
    for p in pinned {
        TimerObjectInternals::release_heap_pin(p, vm);
    }

    // Remove the setTimeout.clock marker when switching back to real timers.
    set_fake_timer_marker(global, false);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn advance_timers_to_next_timer(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    let _ = FakeTimers::execute_next(global);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn advance_timers_by_time(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    let arg = frame.arguments_as_array::<1>()[0];
    if !arg.is_number() {
        return Err(global.throw_invalid_arguments(format_args!(
            "advanceTimersToNextTimer() expects a number of milliseconds"
        )));
    }
    let Some(current) = CURRENT_TIME.get_timespec_now() else {
        return Err(global.throw_invalid_arguments(format_args!(
            "Fake timers not initialized. Initialize with useFakeTimers() first."
        )));
    };
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

    FakeTimers::execute_until(global, target);
    CURRENT_TIME.set(global, &target, None);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn run_only_pending_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    FakeTimers::execute_only_pending_timers(global);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn run_all_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    error_unless_fake_timers(global)?;

    FakeTimers::execute_all_timers(global);

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

    // SAFETY: per-thread `timer::All`; the borrow ends before `release_heap_pin`.
    let pinned = unsafe { (*timer_all()).fake_timers.clear() };
    let vm = global.bun_vm_ptr();
    for p in pinned {
        TimerObjectInternals::release_heap_pin(p, vm);
    }

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
