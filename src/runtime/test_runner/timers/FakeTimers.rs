use core::mem::offset_of;
use std::sync::RwLock;
use std::sync::atomic::{AtomicU64, Ordering};

use bun_core::Environment;
use bun_core::Timespec;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSValue, JsResult};
use crate::timer::{self, ElTimespec, EventLoopTimer, EventLoopTimerState, InHeap, TimerHeap};

// TODO(port): move to test_runner_sys / jsc_sys
unsafe extern "C" {
    safe fn JSMock__setOverridenDateNow(global: &JSGlobalObject, value: f64);
    safe fn JSMock__getCurrentUnixTimeMs() -> f64;
}

pub struct FakeTimers {
    active: bool,
    /// The sorted fake timers. TimerHeap is not optimal here because we need these operations:
    /// - peek/takeFirst (provided by TimerHeap)
    /// - peekLast (cannot be implemented efficiently with TimerHeap)
    /// - count (cannot be implemented efficiently with TimerHeap)
    pub timers: TimerHeap,
}

impl Default for FakeTimers {
    fn default() -> Self {
        Self { active: false, timers: TimerHeap::default() }
    }
}

// PORT NOTE: Zig `pub var current_time: struct { ... } = .{}` — anonymous-typed mutable global.
// Reshaped: `offset_lock` + `offset_raw` folded into `RwLock<Timespec>`; `date_now_offset`
// stored as `AtomicU64` (f64 bits) so the static is `Sync` without `static mut`.
pub struct CurrentTime {
    /// starts at 0. offset in milliseconds.
    offset_raw: RwLock<Timespec>,
    date_now_offset: AtomicU64,
}

const MIN_TIMESPEC: Timespec = Timespec { sec: i64::MIN, nsec: i64::MIN };

pub static CURRENT_TIME: CurrentTime = CurrentTime {
    offset_raw: RwLock::new(MIN_TIMESPEC),
    date_now_offset: AtomicU64::new(0f64.to_bits()),
};

impl CurrentTime {
    pub fn get_timespec_now(&self) -> Option<Timespec> {
        let value = *self.offset_raw.read().unwrap();
        if value.eql(&MIN_TIMESPEC) {
            return None;
        }
        Some(value)
    }

    // PORT NOTE: Zig took `v: struct { offset: *const timespec, js: ?f64 = null }` —
    // anonymous param struct inlined as separate args. LIFETIMES.tsv: offset = BORROW_PARAM → &Timespec.
    pub fn set(&self, global: &JSGlobalObject, offset: &Timespec, js: Option<f64>) {
        let vm = global.bun_vm().as_mut();
        {
            *self.offset_raw.write().unwrap() = *offset;
        }
        // Mirror into T0 storage so `Timespec::now(.allow_mocked_time)` sees
        // the fake clock (spec bun.zig:3223 — `getRoughTickCount`).
        bun_core::mock_time::set(offset.ns() as i64);
        let timespec_ms: f64 = offset.ms() as f64;
        let mut date_now_offset = f64::from_bits(self.date_now_offset.load(Ordering::Relaxed));
        if let Some(js) = js {
            date_now_offset = js.floor() - timespec_ms;
            self.date_now_offset.store(date_now_offset.to_bits(), Ordering::Relaxed);
        }
        // SAFETY: FFI call into C++ JSMock; global is a valid &JSGlobalObject
        JSMock__setOverridenDateNow(global, date_now_offset + timespec_ms);

        // PORT NOTE: Zig stored `@bitCast(v.offset.ns())` (i128 → u128). The Rust
        // `VirtualMachine.overridden_performance_now` is `Option<u64>` and
        // `Timespec::ns()` already returns `u64`, so no bitcast needed.
        // SAFETY: `vm` is the live per-thread VirtualMachine (never null).
        unsafe { (*vm).overridden_performance_now = Some(offset.ns()) };
    }

    pub fn clear(&self, global: &JSGlobalObject) {
        let vm = global.bun_vm().as_mut();
        {
            *self.offset_raw.write().unwrap() = MIN_TIMESPEC;
        }
        bun_core::mock_time::clear();
        // SAFETY: FFI call into C++ JSMock; global is a valid &JSGlobalObject
        JSMock__setOverridenDateNow(global, -1.0);
        // SAFETY: `vm` is the live per-thread VirtualMachine (never null).
        unsafe { (*vm).overridden_performance_now = None };
    }
}

#[derive(Copy, Clone)]
enum AssertMode {
    Locked,
    // PORT NOTE: `.unlocked` callers (`execute_*`/`fire`) were converted to
    // associated fns with no `self` (noalias re-entrancy — see below); the
    // Zig `.unlocked` arm was a no-op anyway.
    #[allow(dead_code)]
    Unlocked,
}

use crate::jsc_hooks::timer_all;

/// RAII `lock()`/`unlock()` for the per-thread `timer::All.lock`. Centralises
/// the single raw-pointer deref so call sites read `let _g = timers_lock_guard();`
/// with no `unsafe`. The returned [`bun_threading::MutexGuard`] holds the mutex
/// by raw pointer (no borrow), so it does not pin a `&timer::All` across the
/// re-entrant heap accesses documented on `execute_*` below.
#[inline]
fn timers_lock_guard() -> bun_threading::MutexGuard {
    // SAFETY: `timer_all()` returns the boxed per-thread `RuntimeState.timer`,
    // never null while a VM is installed (asserted above). `lock` is accessed
    // via shared `&Mutex` only (interior mutability), so this forms no aliased
    // `&mut` with the surrounding `fake_timers` writes.
    unsafe { &(*timer_all()).lock }.lock_guard()
}

/// Convert `bun_core::Timespec` → the low-tier `bun_event_loop` Timespec stub
/// (same `{sec,nsec}` shape, different nominal type until B-2 unifies them).
#[inline]
fn to_el_timespec(t: &Timespec) -> ElTimespec {
    ElTimespec { sec: t.sec, nsec: t.nsec }
}

#[inline]
fn from_el_timespec(t: &ElTimespec) -> Timespec {
    Timespec { sec: t.sec, nsec: t.nsec }
}

impl FakeTimers {
    fn assert_valid(&self, mode: AssertMode) {
        if !Environment::CI_ASSERT {
            return;
        }
        // SAFETY: self points to the `fake_timers` field of `timer::All` (always embedded there)
        let owner: &timer::All = unsafe {
            &*(bun_core::from_field_ptr!(timer::All, fake_timers, std::ptr::from_ref::<Self>(self)))
        };
        match mode {
            AssertMode::Locked => debug_assert!(owner.lock.try_lock() == false),
            // can't assert unlocked because another thread could be holding the lock
            AssertMode::Unlocked => {}
        }
    }

    pub fn is_active(&self) -> bool {
        self.assert_valid(AssertMode::Locked);
        // defer self.assert_valid(.locked) — re-checked at fn exit
        let r = self.active;
        self.assert_valid(AssertMode::Locked);
        r
    }

    fn activate(&mut self, js_now: f64, global: &JSGlobalObject) {
        self.assert_valid(AssertMode::Locked);

        self.active = true;
        CURRENT_TIME.set(global, &Timespec::EPOCH, Some(js_now));

        self.assert_valid(AssertMode::Locked);
    }

    fn deactivate(&mut self, global: &JSGlobalObject) {
        self.assert_valid(AssertMode::Locked);

        self.clear();
        CURRENT_TIME.clear(global);
        self.active = false;

        self.assert_valid(AssertMode::Locked);
    }

    fn clear(&mut self) {
        self.assert_valid(AssertMode::Locked);

        while let Some(timer) = self.timers.delete_min() {
            // SAFETY: `delete_min` returns a live `*mut EventLoopTimer` just unlinked.
            unsafe {
                (*timer).state = EventLoopTimerState::CANCELLED;
                (*timer).in_heap = InHeap::None;
            }
        }

        self.assert_valid(AssertMode::Locked);
    }

    // PORT NOTE (noalias re-entrancy): `execute_*` / `fire` do NOT take
    // `&mut self`. `EventLoopTimer::fire` dispatches into JS; a `setInterval`
    // callback's reschedule (`timer::All::update` → `insert_lock_held` →
    // `(*timer_all()).fake_timers.timers.insert`) writes back into *this
    // same* `FakeTimers::timers` heap through a fresh raw pointer. With a
    // live `&mut self` LLVM's `noalias` lets it cache `self.timers.root`
    // across the (inlined) `fire` body — `peek()` on the next loop iteration
    // then misses the re-inserted interval, so `advanceTimersByTime` /
    // `runOnlyPendingTimers` fire each interval at most once per call. Same
    // bug class as `TimerObjectInternals::fire` (see dc37f2018b34). Access
    // the heap via the raw `timer_all()` pointer instead so every iteration
    // reloads from memory.
    fn execute_next(global: &JSGlobalObject) -> bool {
        let timers = timer_all();

        let next = {
            let _g = timers_lock_guard();
            // SAFETY: `timers` is the boxed per-thread `RuntimeState.timer`;
            // single-threaded JS heap so no concurrent `&mut` to `.fake_timers`.
            let n = unsafe { (*timers).fake_timers.timers.delete_min() };
            match n {
                Some(n) => n,
                None => return false,
            }
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
        let timers = timer_all();

        'outer: loop {
            let next = 'blk: {
                let _g = timers_lock_guard();

                // SAFETY: `timers` is the boxed per-thread `RuntimeState.timer`;
                // single-threaded JS heap. Re-derive each iteration so the
                // re-entrant `insert` from setInterval rescheduling is observed.
                let Some(peek) = (unsafe { (*timers).fake_timers.timers.peek() }) else {
                    break 'outer;
                };
                // SAFETY: `peek` is the heap root; live while locked.
                if from_el_timespec(unsafe { &(*peek).next }).greater(&until) {
                    break 'outer;
                }
                // bun.assert always evaluates its arg; debug_assert! does NOT in release.
                // Hoist the side-effecting delete_min() out so the timer is removed in all builds.
                // SAFETY: as above.
                let min = unsafe { (*timers).fake_timers.timers.delete_min() }.expect("unreachable");
                debug_assert!(core::ptr::eq(min, peek));
                break 'blk min;
            };
            Self::fire(global, next);
        }
    }

    fn execute_only_pending_timers(global: &JSGlobalObject) {
        let timers = timer_all();

        let until = {
            let _g = timers_lock_guard();
            // SAFETY: `timers` is the boxed per-thread `RuntimeState.timer`.
            let target = unsafe { (*timers).fake_timers.timers.find_max() };
            drop(_g);
            match target {
                Some(t) => {
                    // SAFETY: `t` was reachable in the heap under the lock.
                    from_el_timespec(unsafe { &(*t).next })
                }
                None => return,
            }
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
    let timers = timer_all();
    // SAFETY: per-thread `timer::All`.
    let this = unsafe { &(*timers).fake_timers };

    {
        let _g = timers_lock_guard();
        let active = this.is_active();
        drop(_g);
        if active {
            return Ok(());
        }
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
    if !set_timeout_fn.is_cell() {
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
    let timers = timer_all();
    // SAFETY: per-thread `timer::All`.
    let this = unsafe { &mut (*timers).fake_timers };

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

    {
        let _g = timers_lock_guard();
        this.activate(js_now, global);
    }

    // Set setTimeout.clock = true to signal that fake timers are enabled.
    // This is used by testing-library/react to detect if jest.advanceTimersByTime should be called.
    set_fake_timer_marker(global, true);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn use_real_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let timers = timer_all();
    // SAFETY: per-thread `timer::All`.
    let this = unsafe { &mut (*timers).fake_timers };

    {
        let _g = timers_lock_guard();
        this.deactivate(global);
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
    let timers = timer_all();
    // SAFETY: per-thread `timer::All`.
    let this = unsafe { &(*timers).fake_timers };
    error_unless_fake_timers(global)?;

    let count = {
        let _g = timers_lock_guard();
        this.timers.count()
    };

    Ok(JSValue::js_number(count as f64))
}

#[bun_jsc::host_fn]
fn clear_all_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let timers = timer_all();
    // SAFETY: per-thread `timer::All`.
    let this = unsafe { &mut (*timers).fake_timers };
    error_unless_fake_timers(global)?;

    {
        let _g = timers_lock_guard();
        this.clear();
    }

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn is_fake_timers(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let timers = timer_all();
    // SAFETY: per-thread `timer::All`.
    let this = unsafe { &(*timers).fake_timers };

    let is_active = {
        let _g = timers_lock_guard();
        this.is_active()
    };

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

pub const TIMER_FNS_COUNT: usize = FAKE_TIMERS_FNS.len();

pub fn put_timers_fns(global: &JSGlobalObject, jest: JSValue, vi: JSValue) {
    // PORT NOTE: Zig `inline for` over homogeneous tuples → plain `for` over const slice.
    for &(name, arity, func) in FAKE_TIMERS_FNS {
        let jsvalue = JSFunction::create(global, name, func, arity, Default::default());
        vi.put(global, name.as_bytes(), jsvalue);
        jest.put(global, name.as_bytes(), jsvalue);
    }
}

// ported from: src/test_runner/timers/FakeTimers.zig
