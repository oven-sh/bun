//! `setTimeout`, `setInterval`, `setImmediate`, `Bun.sleep` and the `clear*` functions.

use bun_core::String as BunString;
use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::bindgen::{self, JsHeap};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_uws::Loop as UwsLoop;

use super::timeout_object::Kind;
use super::{
    All, Clock, CountdownOverflowBehavior, DateHeaderTimer, EventLoopTimerState, FakeTimers,
    ImmediateObject, TimeoutObject, TimeoutWarning,
};
use crate::jsc_hooks::timer_all;

impl All {
    pub(crate) fn update_date_header_timer_if_necessary(
        &self,
        loop_: &UwsLoop,
        vm: &VirtualMachine,
    ) {
        if loop_.should_enable_date_header_timer() {
            if self.date_header_timer.event_loop_timer.state.get() != EventLoopTimerState::ACTIVE {
                self.date_header_timer.enable(
                    self,
                    vm,
                    // Be careful to avoid adding extra calls to bun.timespec.now()
                    // when it's not needed.
                    &Timespec::now(TimespecMockMode::ForceRealTime),
                );
            }
        } else {
            // don't un-schedule it here.
            // it's better to wake up an extra 1 time after a second idle
            // than to have to check a date potentially on every single HTTP request.
        }
    }

    fn warn_invalid_countdown(
        global_this: &JSGlobalObject,
        countdown: f64,
        warning_type: TimeoutWarning,
    ) -> JsResult<()> {
        const SUFFIX: &str = ".\nTimeout duration was set to 1.";

        let warning_string = match warning_type {
            TimeoutWarning::TimeoutOverflowWarning => {
                if countdown.is_finite() {
                    BunString::create_format(format_args!(
                        "{countdown} does not fit into a 32-bit signed integer{SUFFIX}"
                    ))
                } else {
                    // -Infinity is handled by TimeoutNegativeWarning
                    BunString::static_(const_format::concatcp!(
                        "Infinity does not fit into a 32-bit signed integer",
                        SUFFIX
                    ))
                }
            }
            TimeoutWarning::TimeoutNegativeWarning => {
                if countdown.is_finite() {
                    BunString::create_format(format_args!(
                        "{countdown} is a negative number{SUFFIX}"
                    ))
                } else {
                    BunString::static_(const_format::concatcp!(
                        "-Infinity is a negative number",
                        SUFFIX
                    ))
                }
            }
            TimeoutWarning::TimeoutNaNWarning => {
                debug_assert!(countdown.is_nan());
                BunString::static_(const_format::concatcp!("NaN is not a number", SUFFIX))
            }
        };
        let warning_type_string =
            BunString::create_atom_if_possible(<&'static str>::from(warning_type).as_bytes());
        let warning_js = warning_string.into_js(global_this)?;
        let warning_type_js = warning_type_string.into_js(global_this)?;
        global_this.emit_warning(
            warning_js,
            warning_type_js,
            JSValue::UNDEFINED,
            JSValue::UNDEFINED,
        )?;
        Ok(())
    }

    /// Convert an arbitrary JavaScript value to a number of milliseconds used to schedule a timer.
    fn js_value_to_countdown(
        &self,
        global_this: &JSGlobalObject,
        countdown: JSValue,
        overflow_behavior: CountdownOverflowBehavior,
        minimum_ms: u32,
    ) -> JsResult<u32> {
        // Both match arms below enforce the [0, i32::MAX] range (Clamp
        // saturates to i32::MAX; OneMs yields either 1 or a value already
        // validated to be <= i32::MAX), so callers always receive a value
        // in that range.
        // We don't deal with nesting levels directly
        // but we do set the minimum timeout to be 1ms for repeating timers
        let countdown_double = countdown.to_number(global_this)?;
        let countdown_int: u32 = match overflow_behavior {
            CountdownOverflowBehavior::Clamp => {
                // Saturating cast to [0, i32::MAX]: Rust `as` saturates
                // float→int and maps NaN→0,
                // so `setTimeout(fn, NaN)` behaves like `setTimeout(fn, 0)`.
                (countdown_double as u32).min(i32::MAX as u32)
            }
            CountdownOverflowBehavior::OneMs => {
                if !(countdown_double >= 1.0 && countdown_double <= i32::MAX as f64) {
                    if countdown_double > i32::MAX as f64 {
                        Self::warn_invalid_countdown(
                            global_this,
                            countdown_double,
                            TimeoutWarning::TimeoutOverflowWarning,
                        )?;
                    } else if countdown_double < 0.0 && !self.warned_negative_number.get() {
                        self.warned_negative_number.set(true);
                        Self::warn_invalid_countdown(
                            global_this,
                            countdown_double,
                            TimeoutWarning::TimeoutNegativeWarning,
                        )?;
                    } else if !countdown.is_undefined()
                        && countdown.is_number()
                        && countdown_double.is_nan()
                        && !self.warned_not_number.get()
                    {
                        self.warned_not_number.set(true);
                        Self::warn_invalid_countdown(
                            global_this,
                            countdown_double,
                            TimeoutWarning::TimeoutNaNWarning,
                        )?;
                    }
                    let is_too_long = countdown_double > i32::MAX as f64;
                    if is_too_long { 1 } else { minimum_ms }
                } else {
                    countdown_double as u32
                }
            }
        };

        Ok(countdown_int)
    }

    /// Bun.sleep
    /// a setTimeout that uses a promise instead of a callback, and interprets the countdown
    /// slightly differently for historical reasons (see jsValueToCountdown)
    pub(crate) fn sleep(
        cx: &bun_jsc::JsThread<'_>,
        promise: JSValue,
        countdown: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!promise.is_empty() && !countdown.is_empty());
        let all = timer_all();
        let id = all.next_id();

        let countdown_int =
            all.js_value_to_countdown(cx.global(), countdown, CountdownOverflowBehavior::Clamp, 0)?;
        let wrapped_promise = promise.with_async_context_if_needed(cx.global());
        Ok(TimeoutObject::init(
            cx,
            id,
            Kind::SetTimeout,
            countdown_int,
            wrapped_promise,
            JSValue::UNDEFINED,
            all.fake_timers.set_timeout_clock(),
        )
        .to_js())
    }

    pub(crate) fn set_immediate(
        cx: &bun_jsc::JsThread<'_>,
        callback: JSValue,
        arguments: JSValue,
        clock: Clock,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!callback.is_empty() && !arguments.is_empty());
        let all = timer_all();
        let id = all.next_id();

        let wrapped_callback = callback.with_async_context_if_needed(cx.global());
        Ok(ImmediateObject::init(
            cx,
            id,
            wrapped_callback,
            arguments,
            all.fake_timers.clock_while_active(clock),
        ))
    }

    pub(crate) fn set_timeout(
        cx: &bun_jsc::JsThread<'_>,
        callback: JSValue,
        arguments: JSValue,
        countdown: JSValue,
        clock: Clock,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!callback.is_empty() && !arguments.is_empty() && !countdown.is_empty());
        let all = timer_all();
        let id = all.next_id();

        let wrapped_callback = callback.with_async_context_if_needed(cx.global());
        let countdown_int =
            all.js_value_to_countdown(cx.global(), countdown, CountdownOverflowBehavior::OneMs, 0)?;
        let clock = all.fake_timers.clock_while_active(clock);
        // As in @sinonjs/fake-timers, a fake timer without a delay is due now. See `FakeTimers::min_delay_ms()`.
        let may_be_zero = clock == Clock::Fake || all.zero_delay_is_due_when_idle.get();
        let countdown_int = countdown_int.max(u32::from(!may_be_zero));
        let is_due_when_idle = clock == Clock::Real && countdown_int == 0;
        let timeout = TimeoutObject::init(
            cx,
            id,
            Kind::SetTimeout,
            if is_due_when_idle { 1 } else { countdown_int },
            wrapped_callback,
            arguments,
            clock,
        );
        if is_due_when_idle {
            timeout.event_loop_timer.is_due_when_idle.set(true);
        }
        Ok(timeout.to_js())
    }

    pub(crate) fn set_interval(
        cx: &bun_jsc::JsThread<'_>,
        callback: JSValue,
        arguments: JSValue,
        countdown: JSValue,
        clock: Clock,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!callback.is_empty() && !arguments.is_empty() && !countdown.is_empty());
        let all = timer_all();
        let id = all.next_id();

        let wrapped_callback = callback.with_async_context_if_needed(cx.global());
        // Never 0, on either clock: it would be due again at the time it fired, so advancing the fake clock wouldn't end.
        let countdown_int =
            all.js_value_to_countdown(cx.global(), countdown, CountdownOverflowBehavior::OneMs, 1)?;
        Ok(TimeoutObject::init(
            cx,
            id,
            Kind::SetInterval,
            countdown_int,
            wrapped_callback,
            arguments,
            all.fake_timers.clock_while_active(clock),
        )
        .to_js())
    }

    /// Largest id a JS number can represent exactly. A larger number or numeric string never matches a timer.
    const MAX_ID: u64 = bun_jsc::MAX_SAFE_INTEGER as u64;

    /// The id a JS number names, whether JSC holds it as an int32 or as a double.
    fn timer_id_from_number(value: JSValue) -> Option<u64> {
        let number = value.as_number();
        // `as` saturates and maps NaN to 0. The range check and the round trip reject those and fractions.
        let id = number as i64;
        ((1..=Self::MAX_ID as i64).contains(&id) && id as f64 == number).then_some(id as u64)
    }

    /// Node uses the string as a property key, so only the canonical spelling of an id names a timer.
    fn timer_id_from_digits<C: Copy + Into<u32>>(digits: &[C]) -> Option<u64> {
        let mut id: u64 = 0;
        for &c in digits {
            let digit = char::from_u32(c.into())?.to_digit(10)?;
            if id == 0 && digit == 0 {
                return None;
            }
            id = id.checked_mul(10)?.checked_add(u64::from(digit))?;
        }
        (id <= Self::MAX_ID).then_some(id)
    }

    /// `clearTimeout()` and `clearInterval()`.
    fn clear_timeout(global: &JSGlobalObject, timer: JSValue) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        let id = if timer.is_number() {
            Self::timer_id_from_number(timer)
        } else if timer.is_string_literal() {
            let string = timer.to_bun_string(global)?;
            if string.is_utf16() {
                Self::timer_id_from_digits(string.utf16())
            } else {
                Self::timer_id_from_digits(string.latin1())
            }
        } else {
            if let Some(timeout) = timer.as_class_ref::<TimeoutObject>() {
                timeout.cancel();
            }
            None
        };
        if let Some(id) = id {
            TimeoutObject::cancel_by_id(global.bun_vm(), id);
        }
        Ok(JSValue::UNDEFINED)
    }
}

impl DateHeaderTimer {
    /// Schedule the "Date" header timer.
    ///
    /// The logic handles two scenarios:
    /// 1. If the timer was recently updated (< 1 second ago), just reschedule it
    /// 2. If the timer is stale (> 1 second since last update), update the date
    ///    immediately and reschedule
    fn enable(&self, timers: &All, vm: &VirtualMachine, now: &Timespec) {
        debug_assert!(self.event_loop_timer.state.get() != EventLoopTimerState::ACTIVE);

        let last_update = self.event_loop_timer.next.get();
        let elapsed = now.duration(&last_update).ms();

        // If the last update was more than 1 second ago, the date is stale
        if elapsed >= 1000 {
            // Update the date immediately since it's stale
            // updateDate() is an expensive function.
            vm.uws_loop().update_date();

            self.event_loop_timer.next.set(now.add_ms(1000));
        }
        timers.insert(&raw const self.event_loop_timer);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// C-ABI export thunks
// ════════════════════════════════════════════════════════════════════════════

// `generate-host-exports.ts`
// scrapes the `// HOST_EXPORT` markers below and emits the thunks into
// `generated_host_exports.rs`, each routing through `host_fn::to_js_host_call`.
//
// C++ callers (`src/jsc/bindings/node/NodeTimers.cpp`, `BunObject.cpp`) declare
// these in `headers.h` as `(JSGlobalObject*, EncodedJSValue…) -> EncodedJSValue`.

// HOST_EXPORT(Bun__Timer__setImmediate, c)
pub(crate) fn set_immediate_export(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
) -> JsResult<JSValue> {
    let context = global.bun_vm().context_of_caller();
    All::set_immediate(&global.js_thread(context), callback, arguments, Clock::Real)
}

// HOST_EXPORT(Bun__FakeTimers__setImmediate, c)
pub(crate) fn fake_set_immediate_export(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
) -> JsResult<JSValue> {
    let context = global.bun_vm().context_of_caller();
    All::set_immediate(&global.js_thread(context), callback, arguments, Clock::Fake)
}

// HOST_EXPORT(Bun__Timer__sleep, c)
pub(crate) fn sleep_export(
    global: &JSGlobalObject,
    promise: JSValue,
    countdown: JSValue,
) -> JsResult<JSValue> {
    let context = global.bun_vm().context_of_caller();
    All::sleep(&global.js_thread(context), promise, countdown)
}

// HOST_EXPORT(Bun__Timer__setTimeout, c)
pub(crate) fn set_timeout_export(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
    countdown: JSValue,
) -> JsResult<JSValue> {
    let context = global.bun_vm().context_of_caller();
    All::set_timeout(
        &global.js_thread(context),
        callback,
        arguments,
        countdown,
        Clock::Real,
    )
}

// HOST_EXPORT(Bun__FakeTimers__setTimeout, c)
pub(crate) fn fake_set_timeout_export(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
    countdown: JSValue,
) -> JsResult<JSValue> {
    let context = global.bun_vm().context_of_caller();
    All::set_timeout(
        &global.js_thread(context),
        callback,
        arguments,
        countdown,
        Clock::Fake,
    )
}

// HOST_EXPORT(Bun__Timer__setInterval, c)
pub(crate) fn set_interval_export(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
    countdown: JSValue,
) -> JsResult<JSValue> {
    let context = global.bun_vm().context_of_caller();
    All::set_interval(
        &global.js_thread(context),
        callback,
        arguments,
        countdown,
        Clock::Real,
    )
}

// HOST_EXPORT(Bun__FakeTimers__setInterval, c)
pub(crate) fn fake_set_interval_export(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
    countdown: JSValue,
) -> JsResult<JSValue> {
    let context = global.bun_vm().context_of_caller();
    All::set_interval(
        &global.js_thread(context),
        callback,
        arguments,
        countdown,
        Clock::Fake,
    )
}

// HOST_EXPORT(Bun__FakeTimers__requestAnimationFrame, c)
pub(crate) fn fake_request_animation_frame_export(
    global: &JSGlobalObject,
    function: JSValue,
    callback: JSValue,
) -> JsResult<JSValue> {
    const NS_PER_MS: u64 = bun_core::time::NS_PER_MS as u64;
    let vm = global.bun_vm();
    let all = timer_all();
    let id = all.next_id();

    let clock = if all.fake_timers.is_installed(function) {
        Clock::Fake
    } else {
        Clock::Real
    };
    let now_ns = match clock {
        Clock::Fake => all.fake_timers.now().ns(),
        Clock::Real => bun_jsc::virtual_machine_exports::read_origin_timer(vm),
    };
    let to_next_frame = FakeTimers::FRAME_MS - (now_ns / NS_PER_MS) % FakeTimers::FRAME_MS;
    let timeout = TimeoutObject::init(
        &global.js_thread(vm.context_of_caller()),
        id,
        Kind::SetTimeout,
        to_next_frame as u32,
        callback.with_async_context_if_needed(global),
        JSValue::js_number((now_ns + to_next_frame * NS_PER_MS) as f64 / NS_PER_MS as f64),
        clock,
    );
    timeout.to_primitive().map(JSValue::js_number_from_uint64)
}

// HOST_EXPORT(Bun__FakeTimers__queueTick, c)
pub(crate) fn fake_queue_tick_export(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
) {
    timer_all()
        .fake_timers
        .queue_tick(global, callback, arguments);
}

// HOST_EXPORT(Bun__FakeTimers__isInstalled, c)
pub(crate) fn fake_timers_is_installed_export(function: JSValue) -> bool {
    timer_all().fake_timers.is_installed(function)
}

// HOST_EXPORT(Bun__FakeTimers__fakes, c)
pub(crate) fn fake_timers_fakes_export(api: u8) -> bool {
    timer_all().fake_timers.fakes_api(api)
}

// HOST_EXPORT(Bun__FakeTimers__runStep, c)
pub(crate) fn fake_timers_run_step_export(global: &JSGlobalObject, id: u32) {
    if let Err(err) = FakeTimers::run_step(global, id) {
        let _ = bun_jsc::task::report_error_or_terminate(global, err);
    }
}

// HOST_EXPORT(Bun__readHRTime, c)
pub(crate) fn read_hrtime_export(vm: &VirtualMachine) -> u64 {
    let fake = crate::jsc_hooks::timer_all_of(vm).fake_timers.hrtime();
    fake.unwrap_or_else(|| vm.origin_timer.elapsed().as_nanos() as u64)
}

// HOST_EXPORT(Bun__Timer__clearImmediate, c)
pub(crate) fn clear_immediate_export(global: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
    if id.is_number() || id.is_string_literal() {
        return All::clear_timeout(global, id);
    }
    if let Some(immediate) = id.as_class_ref::<ImmediateObject>() {
        immediate.cancel();
    }
    Ok(JSValue::UNDEFINED)
}

// HOST_EXPORT(Bun__Timer__clearTimeout, c)
pub(crate) fn clear_timeout_export(global: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
    All::clear_timeout(global, id)
}

// HOST_EXPORT(Bun__Timer__clearInterval, c)
pub(crate) fn clear_interval_export(global: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
    All::clear_timeout(global, id)
}

pub(crate) mod internal_bindings {
    use super::*;

    /// Node.js has some tests that check whether timers fire at the right time. They check this
    /// with the internal binding `getLibuvNow()`, which returns an integer in milliseconds. This
    /// works because `getLibuvNow()` is also the clock that their timers implementation uses to
    /// choose when to schedule timers.
    ///
    /// I've tried changing those tests to use `performance.now()` or `Date.now()`. But that always
    /// introduces spurious failures, because neither of those functions use the same clock that the
    /// timers implementation uses (for Bun this is `bun.timespec.now()`), so the tests end up
    /// thinking that the timing is wrong (this also happens when I run the modified test in
    /// Node.js). So the best course of action is for Bun to also expose a function that reveals the
    /// clock that is used to schedule timers.
    pub(crate) fn timer_clock_ms() -> f64 {
        Timespec::now(TimespecMockMode::AllowMockedTime).ms() as f64
    }

    /// Unlike `Date.now()` and `performance.now()`, this ignores bun:test's fake timers.
    pub(crate) fn monotonic_now_ms() -> f64 {
        Timespec::now(TimespecMockMode::ForceRealTime).ms() as f64
    }

    /// Implements `timerInternals.setNextTimerId(id)`. The id can only increase, so ids never repeat.
    pub(crate) fn set_next_timer_id<'a>(
        heap: &JsHeap<'a>,
        id: Option<u64>,
    ) -> bindgen::Result<'a, ()> {
        let Some(id) = id else { return Ok(()) };
        let current = timer_all().last_id.get();
        if id < current {
            return Err(heap.error_with_code(
                bun_jsc::ErrorCode::OUT_OF_RANGE,
                format_args!(
                    "{}",
                    bun_core::fmt::out_of_range(
                        id as i64,
                        bun_core::fmt::OutOfRangeOptions {
                            field_name: b"id",
                            min: current as i64,
                            max: All::MAX_ID as i64,
                            ..Default::default()
                        },
                    )
                ),
            ));
        }
        timer_all().last_id.set(id);
        Ok(())
    }
}
