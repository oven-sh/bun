use core::mem::offset_of;
use std::sync::RwLock;
use std::sync::atomic::{AtomicU64, Ordering};

use bun_core::Environment;
use bun_core::Timespec;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};
use bun_runtime::api::timer::{self, EventLoopTimer, TimerHeap};
use bun_str::ZigString;

// TODO(port): move to test_runner_sys / jsc_sys
unsafe extern "C" {
    fn JSMock__setOverridenDateNow(global: *const JSGlobalObject, value: f64);
    fn JSMock__getCurrentUnixTimeMs() -> f64;
}

// TODO(port): bindgen_generated — codegen output; Phase B wires the generator to emit .rs
mod bindgen_generated {
    pub struct FakeTimersConfig;
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
        let vm = global.bun_vm();
        {
            *self.offset_raw.write().unwrap() = *offset;
        }
        let timespec_ms: f64 = offset.ms() as f64;
        let mut date_now_offset = f64::from_bits(self.date_now_offset.load(Ordering::Relaxed));
        if let Some(js) = js {
            date_now_offset = js.floor() - timespec_ms;
            self.date_now_offset.store(date_now_offset.to_bits(), Ordering::Relaxed);
        }
        // SAFETY: FFI call into C++ JSMock; global is a valid &JSGlobalObject
        unsafe { JSMock__setOverridenDateNow(global, date_now_offset + timespec_ms) };

        // SAFETY: i128 → u128 same-size bitcast, mirrors Zig `@bitCast(v.offset.ns())`
        vm.overridden_performance_now = Some(unsafe { core::mem::transmute::<i128, u128>(offset.ns()) });
    }

    pub fn clear(&self, global: &JSGlobalObject) {
        let vm = global.bun_vm();
        {
            *self.offset_raw.write().unwrap() = MIN_TIMESPEC;
        }
        // SAFETY: FFI call into C++ JSMock; global is a valid &JSGlobalObject
        unsafe { JSMock__setOverridenDateNow(global, -1.0) };
        vm.overridden_performance_now = None;
    }
}

#[derive(Copy, Clone)]
enum AssertMode {
    Locked,
    Unlocked,
}

impl FakeTimers {
    fn assert_valid(&self, mode: AssertMode) {
        if !Environment::CI_ASSERT {
            return;
        }
        // SAFETY: self points to the `fake_timers` field of `timer::All` (always embedded there)
        let owner: &timer::All = unsafe {
            &*((self as *const Self as *const u8)
                .sub(offset_of!(timer::All, fake_timers))
                .cast::<timer::All>())
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
            timer.state = EventLoopTimer::State::CANCELLED; // TODO(port): exact enum path on EventLoopTimer
            timer.in_heap = EventLoopTimer::InHeap::None; // TODO(port): exact enum path on EventLoopTimer
        }

        self.assert_valid(AssertMode::Locked);
    }

    fn execute_next(&mut self, global: &JSGlobalObject) -> bool {
        self.assert_valid(AssertMode::Unlocked);
        let vm = global.bun_vm();
        let timers = &vm.timer;

        let next = {
            let _guard = timers.lock.lock();
            match self.timers.delete_min() {
                Some(n) => n,
                None => {
                    self.assert_valid(AssertMode::Unlocked);
                    return false;
                }
            }
        };

        self.fire(global, next);
        self.assert_valid(AssertMode::Unlocked);
        true
    }

    fn fire(&mut self, global: &JSGlobalObject, next: &mut EventLoopTimer) {
        self.assert_valid(AssertMode::Unlocked);
        let vm = global.bun_vm();

        if Environment::CI_ASSERT {
            let prev = CURRENT_TIME.get_timespec_now();
            debug_assert!(prev.is_some());
            debug_assert!(next.next.eql(&prev.unwrap()) || next.next.greater(&prev.unwrap()));
        }
        let now = next.next;
        CURRENT_TIME.set(global, &now, None);
        next.fire(&now, vm);

        self.assert_valid(AssertMode::Unlocked);
    }

    fn execute_until(&mut self, global: &JSGlobalObject, until: Timespec) {
        self.assert_valid(AssertMode::Unlocked);
        let vm = global.bun_vm();
        let timers = &vm.timer;

        loop {
            let next = 'blk: {
                let _guard = timers.lock.lock();

                let Some(peek) = self.timers.peek() else { break };
                if peek.next.greater(&until) {
                    break;
                }
                // bun.assert always evaluates its arg; debug_assert! does NOT in release.
                // Hoist the side-effecting delete_min() out so the timer is removed in all builds.
                let min = self.timers.delete_min().expect("unreachable");
                debug_assert!(core::ptr::eq(min, peek));
                break 'blk min;
            };
            self.fire(global, next);
        }

        self.assert_valid(AssertMode::Unlocked);
    }

    fn execute_only_pending_timers(&mut self, global: &JSGlobalObject) {
        self.assert_valid(AssertMode::Unlocked);
        let vm = global.bun_vm();
        let timers = &vm.timer;

        let target = {
            let _guard = timers.lock.lock();
            match self.timers.find_max() {
                Some(t) => t,
                None => {
                    self.assert_valid(AssertMode::Unlocked);
                    return;
                }
            }
        };
        let until = target.next;
        self.execute_until(global, until);

        self.assert_valid(AssertMode::Unlocked);
    }

    fn execute_all_timers(&mut self, global: &JSGlobalObject) {
        self.assert_valid(AssertMode::Unlocked);

        while self.execute_next(global) {}

        self.assert_valid(AssertMode::Unlocked);
    }
}

// ===
// JS Functions
// ===

fn error_unless_fake_timers(global: &JSGlobalObject) -> JsResult<()> {
    let vm = global.bun_vm();
    let timers = &vm.timer;
    let this = &timers.fake_timers;

    {
        let _guard = timers.lock.lock();
        if this.is_active() {
            return Ok(());
        }
    }
    global.throw("Fake timers are not active. Call useFakeTimers() first.", &[])
}

/// Set or remove the "clock" property on setTimeout to indicate that fake timers are active.
/// This is used by testing-library/react's jestFakeTimersAreEnabled() function to detect
/// if jest.advanceTimersByTime() should be called when draining the microtask queue.
fn set_fake_timer_marker(global: &JSGlobalObject, enabled: bool) {
    let global_this_value = global.to_js_value();
    let Ok(Some(set_timeout_fn)) = global_this_value.get_own_truthy(global, "setTimeout") else {
        return;
    };
    // testing-library/react checks Object.hasOwnProperty.call(setTimeout, 'clock')
    // to detect if fake timers are enabled.
    if enabled {
        // Set setTimeout.clock = true when enabling fake timers.
        set_timeout_fn.put(global, "clock", JSValue::TRUE);
    } else {
        // Delete the clock property when disabling fake timers.
        // This ensures hasOwnProperty returns false, matching Jest/Sinon behavior.
        let _ = set_timeout_fn.delete_property(global, "clock");
    }
}

#[bun_jsc::host_fn]
fn use_fake_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    let timers = &vm.timer;
    let this = &mut timers.fake_timers;

    // SAFETY: FFI call into C++ JSMock
    let mut js_now = unsafe { JSMock__getCurrentUnixTimeMs() };

    // Check if options object was provided
    let args = frame.arguments_as_array::<1>();
    if args.len() > 0 && !args[0].is_undefined() {
        let options_value = args[0];
        // TODO(port): bindgen_generated::FakeTimersConfig::from_js — generated bindings
        let config = bindgen_generated::FakeTimersConfig::from_js(global, options_value)?;
        // config drops at scope end (Zig: defer config.deinit())

        // Check if 'now' field is provided
        if !config.now.is_undefined() {
            // Handle both number and Date
            if config.now.is_number() {
                js_now = config.now.as_number();
            } else if config.now.is_date() {
                js_now = config.now.get_unix_timestamp();
            } else {
                return global.throw_invalid_arguments("'now' must be a number or Date", &[]);
            }
        }
    }

    {
        let _guard = timers.lock.lock();
        this.activate(js_now, global);
    }

    // Set setTimeout.clock = true to signal that fake timers are enabled.
    // This is used by testing-library/react to detect if jest.advanceTimersByTime should be called.
    set_fake_timer_marker(global, true);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn use_real_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    let timers = &vm.timer;
    let this = &mut timers.fake_timers;

    {
        let _guard = timers.lock.lock();
        this.deactivate(global);
    }

    // Remove the setTimeout.clock marker when switching back to real timers.
    set_fake_timer_marker(global, false);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn advance_timers_to_next_timer(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    let timers = &vm.timer;
    let this = &mut timers.fake_timers;
    error_unless_fake_timers(global)?;

    let _ = this.execute_next(global);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn advance_timers_by_time(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    let timers = &vm.timer;
    let this = &mut timers.fake_timers;
    error_unless_fake_timers(global)?;

    let arg = frame.arguments_as_array::<1>()[0];
    if !arg.is_number() {
        return global.throw_invalid_arguments(
            "advanceTimersToNextTimer() expects a number of milliseconds",
            &[],
        );
    }
    let Some(current) = CURRENT_TIME.get_timespec_now() else {
        return global.throw_invalid_arguments(
            "Fake timers not initialized. Initialize with useFakeTimers() first.",
            &[],
        );
    };
    let arg_number = arg.as_number();
    let max_advance = u32::MAX;
    if arg_number < 0.0 || arg_number > max_advance as f64 {
        // TODO(port): confirm throw_invalid_arguments accepts core::fmt::Arguments
        return global.throw_invalid_arguments(
            format_args!(
                "advanceTimersToNextTimer() ms is out of range. It must be >= 0 and <= {}. Received {:.0}",
                max_advance, arg_number
            ),
            &[],
        );
    }
    // When advanceTimersByTime(0) is called, advance by 1ms to fire setTimeout(fn, 0) timers.
    // This is because setTimeout(fn, 0) is internally scheduled with a 1ms delay per HTML spec,
    // and Jest/testing-library expect advanceTimersByTime(0) to fire such "immediate" timers.
    let effective_advance = if arg_number == 0.0 { 1.0 } else { arg_number };
    let target = current.add_ms_float(effective_advance);

    this.execute_until(global, target);
    CURRENT_TIME.set(global, &target, None);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn run_only_pending_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    let timers = &vm.timer;
    let this = &mut timers.fake_timers;
    error_unless_fake_timers(global)?;

    this.execute_only_pending_timers(global);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn run_all_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    let timers = &vm.timer;
    let this = &mut timers.fake_timers;
    error_unless_fake_timers(global)?;

    this.execute_all_timers(global);

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn get_timer_count(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    let timers = &vm.timer;
    let this = &timers.fake_timers;
    error_unless_fake_timers(global)?;

    let count = {
        let _guard = timers.lock.lock();
        this.timers.count()
    };

    Ok(JSValue::js_number(count))
}

#[bun_jsc::host_fn]
fn clear_all_timers(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    let timers = &vm.timer;
    let this = &mut timers.fake_timers;
    error_unless_fake_timers(global)?;

    {
        let _guard = timers.lock.lock();
        this.clear();
    }

    Ok(frame.this())
}

#[bun_jsc::host_fn]
fn is_fake_timers(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    let timers = &vm.timer;
    let this = &timers.fake_timers;

    let is_active = {
        let _guard = timers.lock.lock();
        this.is_active()
    };

    Ok(JSValue::from(is_active))
}

// TODO(port): exact host-fn pointer type for the array (raw `JSHostFn` emitted by #[bun_jsc::host_fn])
type HostFn = fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

const FAKE_TIMERS_FNS: &[(&str, u32, HostFn)] = &[
    ("useFakeTimers", 0, use_fake_timers),
    ("useRealTimers", 0, use_real_timers),
    ("advanceTimersToNextTimer", 0, advance_timers_to_next_timer),
    ("advanceTimersByTime", 1, advance_timers_by_time),
    ("runOnlyPendingTimers", 0, run_only_pending_timers),
    ("runAllTimers", 0, run_all_timers),
    ("getTimerCount", 0, get_timer_count),
    ("clearAllTimers", 0, clear_all_timers),
    ("isFakeTimers", 0, is_fake_timers),
];

pub const TIMER_FNS_COUNT: usize = FAKE_TIMERS_FNS.len();

pub fn put_timers_fns(global: &JSGlobalObject, jest: JSValue, vi: JSValue) {
    // PORT NOTE: Zig `inline for` over homogeneous tuples → plain `for` over const slice.
    for &(name, arity, func) in FAKE_TIMERS_FNS {
        let str = ZigString::static_(name);
        let jsvalue = JSFunction::create(global, name, func, arity, Default::default());
        vi.put(global, &str, jsvalue);
        jest.put(global, &str, jsvalue);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/timers/FakeTimers.zig (375 lines)
//   confidence: medium
//   todos:      7
//   notes:      CURRENT_TIME reshaped (RwLock+AtomicU64) from `pub var` static; timer::All lock & EventLoopTimer enum paths need verification; bindgen_generated stubbed; vm field mutability (&mut through bun_vm()) will need borrowck reshaping in Phase B; execute_until peek/delete_min overlap will need borrowck reshape
// ──────────────────────────────────────────────────────────────────────────
