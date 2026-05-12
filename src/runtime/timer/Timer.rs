//! Timer subsystem JS-facing surface: setTimeout/setInterval/setImmediate/
//! Bun.sleep/clear* host functions.
//!
//! PORT NOTE: this file is loaded as `pub mod timer;` from `mod.rs` (codegen
//! path `crate::timer::timer::*`). The canonical struct definitions (`All`,
//! `Kind`, `Maps`, `TimeoutObject`, `ImmediateObject`, `TimerObjectInternals`,
//! `DateHeaderTimer`, …) live in `mod.rs`; this module only adds the JS-facing
//! `impl super::All { … }` surface plus the C-ABI export thunks.

#![allow(clippy::missing_safety_doc)]

use core::mem::offset_of;

use bun_core::String as BunString;
use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::host_fn::to_js_host_call;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsClass as _, JsResult, StringJsc as _};
use bun_uws::Loop as UwsLoop;

use super::{
    All, CountdownOverflowBehavior, DateHeaderTimer, EventLoopTimer, EventLoopTimerState,
    EventLoopTimerTag, ImmediateObject, Kind, TimeoutObject, TimeoutWarning, TimerObjectInternals,
};
use crate::jsc_hooks::{timer_all, timer_all_mut};

// ════════════════════════════════════════════════════════════════════════════
// JS-facing surface on `super::All`
// ════════════════════════════════════════════════════════════════════════════

impl All {
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__Timer__getNextID() -> i32 {
        let all = timer_all();
        if all.is_null() {
            return 0;
        }
        // SAFETY: `all` is the live per-thread `All`; single-threaded JS heap.
        unsafe {
            (*all).last_id = (*all).last_id.wrapping_add(1);
            (*all).last_id
        }
    }

    pub fn update_date_header_timer_if_necessary(
        &mut self,
        loop_: &UwsLoop,
        vm: *mut VirtualMachine,
    ) {
        if loop_.should_enable_date_header_timer() {
            // PORT NOTE: `is_date_timer_active()` is private to mod.rs; inline.
            if self.date_header_timer.event_loop_timer.state != EventLoopTimerState::ACTIVE {
                self.date_header_timer.enable(
                    vm,
                    // Be careful to avoid adding extra calls to bun.timespec.now()
                    // when it's not needed.
                    &Timespec::now(TimespecMockMode::AllowMockedTime),
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
    ) {
        const SUFFIX: &str = ".\nTimeout duration was set to 1.";

        let mut warning_string = match warning_type {
            TimeoutWarning::TimeoutOverflowWarning => {
                if countdown.is_finite() {
                    BunString::create_format(format_args!(
                        "{countdown} does not fit into a 32-bit signed integer{SUFFIX}"
                    ))
                } else {
                    // -Infinity is handled by TimeoutNegativeWarning
                    BunString::ascii(
                        const_format::concatcp!(
                            "Infinity does not fit into a 32-bit signed integer",
                            SUFFIX
                        )
                        .as_bytes(),
                    )
                }
            }
            TimeoutWarning::TimeoutNegativeWarning => {
                if countdown.is_finite() {
                    BunString::create_format(format_args!(
                        "{countdown} is a negative number{SUFFIX}"
                    ))
                } else {
                    BunString::ascii(
                        const_format::concatcp!("-Infinity is a negative number", SUFFIX)
                            .as_bytes(),
                    )
                }
            }
            // std.fmt gives us "nan" but Node.js wants "NaN".
            TimeoutWarning::TimeoutNaNWarning => {
                debug_assert!(countdown.is_nan());
                BunString::ascii(const_format::concatcp!("NaN is not a number", SUFFIX).as_bytes())
            }
        };
        let mut warning_type_string =
            BunString::create_atom_if_possible(<&'static str>::from(warning_type).as_bytes());
        // Emitting a warning should never interrupt execution, but the emit path calls
        // into user-observable JS (process.nextTick, getters, etc.) which can throw.
        // Swallowing error.JSError alone leaves the exception pending on the VM and
        // trips assertExceptionPresenceMatches in the host-call wrapper, so clear it.
        let warning_js = match warning_string.transfer_to_js(global_this) {
            Ok(v) => v,
            Err(_) => {
                let _ = global_this.clear_exception_except_termination();
                return;
            }
        };
        let warning_type_js = match warning_type_string.transfer_to_js(global_this) {
            Ok(v) => v,
            Err(_) => {
                let _ = global_this.clear_exception_except_termination();
                return;
            }
        };
        if global_this
            .emit_warning(
                warning_js,
                warning_type_js,
                JSValue::UNDEFINED,
                JSValue::UNDEFINED,
            )
            .is_err()
        {
            let _ = global_this.clear_exception_except_termination();
        }
    }

    /// Convert an arbitrary JavaScript value to a number of milliseconds used to schedule a timer.
    fn js_value_to_countdown(
        &mut self,
        global_this: &JSGlobalObject,
        countdown: JSValue,
        overflow_behavior: CountdownOverflowBehavior,
        warn: bool,
    ) -> JsResult<u32> {
        // TODO(port): Zig return type is `u31`; using u32 here, callers must respect the [0, i32::MAX] range.
        // We don't deal with nesting levels directly
        // but we do set the minimum timeout to be 1ms for repeating timers
        let countdown_double = countdown.to_number(global_this)?;
        let countdown_int: u32 = match overflow_behavior {
            CountdownOverflowBehavior::Clamp => {
                // std.math.lossyCast(u31, countdown_double): saturating cast to [0, i32::MAX]
                // Rust `as` saturates float→int; clamp upper to u31 max.
                (countdown_double as u32).min(i32::MAX as u32)
                // TODO(port): verify NaN→0 behavior matches std.math.lossyCast
            }
            CountdownOverflowBehavior::OneMs => {
                if !(countdown_double >= 1.0 && countdown_double <= i32::MAX as f64) {
                    if warn {
                        if countdown_double > i32::MAX as f64 {
                            Self::warn_invalid_countdown(
                                global_this,
                                countdown_double,
                                TimeoutWarning::TimeoutOverflowWarning,
                            );
                        } else if countdown_double < 0.0 && !self.warned_negative_number {
                            self.warned_negative_number = true;
                            Self::warn_invalid_countdown(
                                global_this,
                                countdown_double,
                                TimeoutWarning::TimeoutNegativeWarning,
                            );
                        } else if !countdown.is_undefined()
                            && countdown.is_number()
                            && countdown_double.is_nan()
                            && !self.warned_not_number
                        {
                            self.warned_not_number = true;
                            Self::warn_invalid_countdown(
                                global_this,
                                countdown_double,
                                TimeoutWarning::TimeoutNaNWarning,
                            );
                        }
                    }
                    1
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
    pub fn sleep(
        global: &JSGlobalObject,
        promise: JSValue,
        countdown: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!promise.is_empty() && !countdown.is_empty());
        let all = timer_all_mut();
        let id = all.last_id;
        all.last_id = all.last_id.wrapping_add(1);

        let countdown_int =
            all.js_value_to_countdown(global, countdown, CountdownOverflowBehavior::Clamp, true)?;
        let wrapped_promise = promise.with_async_context_if_needed(global);
        Ok(TimeoutObject::init(
            global,
            id,
            Kind::SetTimeout,
            countdown_int,
            wrapped_promise,
            JSValue::UNDEFINED,
        ))
    }

    pub fn set_immediate(
        global: &JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!callback.is_empty() && !arguments.is_empty());
        let all = timer_all_mut();
        let id = all.last_id;
        all.last_id = all.last_id.wrapping_add(1);

        let wrapped_callback = callback.with_async_context_if_needed(global);
        Ok(ImmediateObject::init(
            global,
            id,
            wrapped_callback,
            arguments,
        ))
    }

    pub fn set_timeout(
        global: &JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
        countdown: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!callback.is_empty() && !arguments.is_empty() && !countdown.is_empty());
        let all = timer_all_mut();
        let id = all.last_id;
        all.last_id = all.last_id.wrapping_add(1);

        let wrapped_callback = callback.with_async_context_if_needed(global);
        let countdown_int =
            all.js_value_to_countdown(global, countdown, CountdownOverflowBehavior::OneMs, true)?;
        Ok(TimeoutObject::init(
            global,
            id,
            Kind::SetTimeout,
            countdown_int,
            wrapped_callback,
            arguments,
        ))
    }

    pub fn set_interval(
        global: &JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
        countdown: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!callback.is_empty() && !arguments.is_empty() && !countdown.is_empty());
        let all = timer_all_mut();
        let id = all.last_id;
        all.last_id = all.last_id.wrapping_add(1);

        let wrapped_callback = callback.with_async_context_if_needed(global);
        let countdown_int =
            all.js_value_to_countdown(global, countdown, CountdownOverflowBehavior::OneMs, true)?;
        Ok(TimeoutObject::init(
            global,
            id,
            Kind::SetInterval,
            countdown_int,
            wrapped_callback,
            arguments,
        ))
    }

    fn remove_timer_by_id(&mut self, id: i32) -> Option<*mut TimeoutObject> {
        // PORT NOTE: Zig `fetchSwapRemove` returns the entry; ArrayHashMap
        // exposes `get_index` + `swap_remove_at`, so combine them.
        let value: *mut EventLoopTimer = if let Some(idx) = self.maps.set_timeout.get_index(&id) {
            self.maps.set_timeout.swap_remove_at(idx).1
        } else if let Some(idx) = self.maps.set_interval.get_index(&id) {
            self.maps.set_interval.swap_remove_at(idx).1
        } else {
            return None;
        };
        // SAFETY: entry value points to EventLoopTimer embedded in a TimeoutObject
        debug_assert!(unsafe { (*value).tag } == EventLoopTimerTag::TimeoutObject);
        // SAFETY: entry value points to TimeoutObject.event_loop_timer
        Some(unsafe { TimeoutObject::from_timer_ptr(value) })
    }

    pub fn clear_timer(
        timer_id_value: JSValue,
        global_this: &JSGlobalObject,
        kind: Kind,
    ) -> JsResult<()> {
        bun_jsc::mark_binding!();

        let vm = global_this.bun_vm_ptr();
        let all = timer_all_mut();

        let timer: Option<*mut TimerObjectInternals> = 'brk: {
            if timer_id_value.is_int32() {
                // Immediates don't have numeric IDs in Node.js so we only have to look up timeouts and intervals
                let Some(t) = all.remove_timer_by_id(timer_id_value.as_int32()) else {
                    return Ok(());
                };
                // SAFETY: t is a valid TimeoutObject pointer
                break 'brk Some(unsafe { core::ptr::addr_of_mut!((*t).internals) });
            } else if timer_id_value.is_string_literal() {
                // Primitive string only (JSType::String) — boxed `new String(..)`
                // must fall through to `from_js` below and be a no-op, matching
                // Node.js array-index semantics.
                // RAII for Zig's `defer string.deref()` — `to_bun_string` returns
                // a +1 ref and there are several early `return Ok(())` exits below.
                let string = bun_core::OwnedString::new(timer_id_value.to_bun_string(global_this)?);
                // Custom parseInt logic. I've done this because Node.js is very strict about string
                // parameters to this function: they can't have leading whitespace, trailing
                // characters, signs, or even leading zeroes. None of the readily-available string
                // parsing functions are this strict. The error case is to just do nothing (not
                // clear any timer).
                //
                // The reason is that in Node.js this function's parameter is used for an array
                // lookup, and array[0] is the same as array['0'] in JS but not the same as array['00'].
                let parsed: i32 = {
                    let mut accumulator: i32 = 0;
                    // We can handle all encodings the same way since the only permitted characters
                    // are ASCII.
                    macro_rules! parse_slice {
                        ($slice:expr) => {{
                            let slice = $slice;
                            for (i, &c) in slice.iter().enumerate() {
                                let c = c as u32;
                                if c < ('0' as u32) || c > ('9' as u32) {
                                    // Non-digit characters are not allowed
                                    return Ok(());
                                } else if i == 0 && c == ('0' as u32) {
                                    // Leading zeroes are not allowed
                                    return Ok(());
                                }
                                // Fail on overflow
                                accumulator = match accumulator.checked_mul(10) {
                                    Some(v) => v,
                                    None => return Ok(()),
                                };
                                accumulator = match accumulator
                                    .checked_add(i32::try_from(c - '0' as u32).expect("int cast"))
                                {
                                    Some(v) => v,
                                    None => return Ok(()),
                                };
                            }
                        }};
                    }
                    // PORT NOTE: bun_core::String has no `encoding()` accessor;
                    // dispatch on `is_utf16()` and treat the 8-bit case via
                    // `latin1()` (digit chars are in the ASCII range either way).
                    if string.is_utf16() {
                        parse_slice!(string.utf16());
                    } else {
                        parse_slice!(string.latin1());
                    }
                    accumulator
                };
                let Some(t) = all.remove_timer_by_id(parsed) else {
                    return Ok(());
                };
                // SAFETY: t is a valid TimeoutObject pointer
                break 'brk Some(unsafe { core::ptr::addr_of_mut!((*t).internals) });
            }

            if let Some(timeout) = TimeoutObject::from_js(timer_id_value) {
                // clearImmediate should be a noop if anything other than an Immediate is passed to it.
                if kind != Kind::SetImmediate {
                    // SAFETY: `timeout` is a valid TimeoutObject pointer
                    break 'brk Some(unsafe { core::ptr::addr_of_mut!((*timeout).internals) });
                } else {
                    return Ok(());
                }
            } else if let Some(immediate) = ImmediateObject::from_js(timer_id_value) {
                // setImmediate can only be cleared by clearImmediate, not by clearTimeout or clearInterval.
                if kind == Kind::SetImmediate {
                    // SAFETY: `immediate` is a valid ImmediateObject pointer
                    break 'brk Some(unsafe { core::ptr::addr_of_mut!((*immediate).internals) });
                } else {
                    return Ok(());
                }
            } else {
                break 'brk None;
            }
        };

        let Some(timer) = timer else { return Ok(()) };
        // SAFETY: timer points to a live TimerObjectInternals
        unsafe { (*timer).cancel(vm) };
        Ok(())
    }

    pub fn clear_immediate(global_this: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        Self::clear_timer(id, global_this, Kind::SetImmediate)?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn clear_timeout(global_this: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        Self::clear_timer(id, global_this, Kind::SetTimeout)?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn clear_interval(global_this: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        Self::clear_timer(id, global_this, Kind::SetInterval)?;
        Ok(JSValue::UNDEFINED)
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Method bodies on canonical sibling types (`mod.rs` definitions).
// Ported from DateHeaderTimer.zig.
// ════════════════════════════════════════════════════════════════════════════

// `TimeoutObject::{init, from_js}` and `ImmediateObject::{init, from_js}` now
// live in `super::{timeout_object, immediate_object}` (canonical ports of
// `TimeoutObject.zig` / `ImmediateObject.zig`); the inherent `init` constructor
// and the `JsClass`-derived `from_js` are re-exported via
// `super::{TimeoutObject, ImmediateObject}`.

impl DateHeaderTimer {
    /// Schedule the "Date" header timer.
    ///
    /// The logic handles two scenarios:
    /// 1. If the timer was recently updated (< 1 second ago), just reschedule it
    /// 2. If the timer is stale (> 1 second since last update), update the date
    ///    immediately and reschedule
    pub fn enable(&mut self, vm: *mut VirtualMachine, now: &Timespec) {
        debug_assert!(self.event_loop_timer.state != EventLoopTimerState::ACTIVE);

        // PORT NOTE: `EventLoopTimer.next` is the lower-tier `ElTimespec` stub
        // (same `{sec,nsec}` layout) until bun_event_loop switches to bun_core::Timespec.
        let last_update = Timespec {
            sec: self.event_loop_timer.next.sec,
            nsec: self.event_loop_timer.next.nsec,
        };
        let elapsed = now.duration(&last_update).ms();

        // If the last update was more than 1 second ago, the date is stale
        if elapsed >= 1000 {
            // Update the date immediately since it's stale
            // updateDate() is an expensive function.
            // SAFETY: `vm` is the live per-thread VM; `uws_loop()` returns its
            // owned uws loop, which outlives this call.
            unsafe { (*(*vm).uws_loop()).update_date() };

            let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
            // SAFETY: single JS thread; `All::update` only touches `lock`/`timers`/
            // `fake_timers`/`epoch`, disjoint from `date_header_timer` which `self`
            // aliases (raw-ptr-per-field re-entry pattern, see jsc_hooks.rs).
            unsafe { (*Self::timer_all()).update(elt, &now.add_ms(1000)) };
        } else {
            // The date was updated recently, just reschedule for the next second
            let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
            // SAFETY: see above — disjoint-field access on `All`.
            unsafe { (*Self::timer_all()).insert(elt) };
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// C-ABI export thunks
// ════════════════════════════════════════════════════════════════════════════

// HOST_EXPORT(Bun__internal_drainTimers, c)
pub fn drain_timers_export(vm: *mut VirtualMachine) {
    let all = timer_all();
    if all.is_null() {
        return;
    }
    // SAFETY: `all` is the live per-thread `All`; `vm` is the erased VM pointer
    // (mod.rs::All::drain_timers takes `*mut ()`).
    unsafe { (*all).drain_timers(vm.cast::<()>()) };
}

// Zig used `jsc.host_fn.wrapN(...)` + `@export` to generate these C-ABI shims.
// `wrapN` reflects on the Zig fn signature and emits an `extern "C" fn` that
// forwards through `toJSHostCall` (ExceptionValidationScope + JsResult→JSValue
// normalization). Rust has no signature reflection; `generate-host-exports.ts`
// scrapes the `// HOST_EXPORT` markers below and emits the seven thunks into
// `generated_host_exports.rs`, each routing through `host_fn::host_fn_result`.
//
// C++ callers (`src/jsc/bindings/node/NodeTimers.cpp`, `BunObject.cpp`) declare
// these in `headers.h` as `(JSGlobalObject*, EncodedJSValue…) -> EncodedJSValue`.

// HOST_EXPORT(Bun__Timer__setImmediate, c)
pub fn set_immediate_export(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
) -> JsResult<JSValue> {
    All::set_immediate(global, callback, arguments)
}

// HOST_EXPORT(Bun__Timer__sleep, c)
pub fn sleep_export(
    global: &JSGlobalObject,
    promise: JSValue,
    countdown: JSValue,
) -> JsResult<JSValue> {
    All::sleep(global, promise, countdown)
}

// HOST_EXPORT(Bun__Timer__setTimeout, c)
pub fn set_timeout_export(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
    countdown: JSValue,
) -> JsResult<JSValue> {
    All::set_timeout(global, callback, arguments, countdown)
}

// HOST_EXPORT(Bun__Timer__setInterval, c)
pub fn set_interval_export(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
    countdown: JSValue,
) -> JsResult<JSValue> {
    All::set_interval(global, callback, arguments, countdown)
}

// HOST_EXPORT(Bun__Timer__clearImmediate, c)
pub fn clear_immediate_export(global: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
    All::clear_immediate(global, id)
}

// HOST_EXPORT(Bun__Timer__clearTimeout, c)
pub fn clear_timeout_export(global: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
    All::clear_timeout(global, id)
}

// HOST_EXPORT(Bun__Timer__clearInterval, c)
pub fn clear_interval_export(global: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
    All::clear_interval(global, id)
}

pub mod internal_bindings {
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
    #[bun_jsc::host_fn]
    pub fn timer_clock_ms(
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let _ = global_this;
        let _ = call_frame;
        let now = Timespec::now(TimespecMockMode::AllowMockedTime).ms();
        // PORT NOTE: bun_jsc::JSValue has no `js_number_from_int64`; route via
        // `js_number(f64)` (i64 → f64 is lossless for the millisecond range).
        Ok(JSValue::js_number(now as f64))
    }
}

// ported from: src/runtime/timer/Timer.zig
