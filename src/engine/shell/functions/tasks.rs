//! Time, timers and microtasks.

use core::sync::atomic::{AtomicU64, Ordering::Relaxed};
use core::time::Duration;
use std::sync::OnceLock;
use std::time::{Instant, SystemTime};

use bun_engine_inspector::AsyncCallType;
use bun_engine_vm::{JsFunction, WorkKind};

use super::return_undefined;
use crate::global::{FIXED_TIME, ShellGlobal};
use crate::inspector;
use crate::prelude::*;

pub(super) const FUNCTIONS: Functions = &[
    ("preciseTime", precise_time, 0),
    ("sleepSeconds", sleep_seconds, 1),
    ("flashHeapAccess", sleep_milliseconds, 0),
    ("dropAllLocks", return_undefined, 1),
    ("setTimeout", set_timeout, 2),
    ("drainMicrotasks", call_drain_microtasks, 0),
    (
        "setUnhandledRejectionCallback",
        set_unhandled_rejection_callback,
        1,
    ),
    ("asyncTestStart", async_test_start, 1),
    ("asyncTestPassed", async_test_passed, 1),
];

pub(super) const PERFORMANCE: Functions = &[
    ("now", monotonic_now, 0),
    ("mark", return_undefined, 1),
    ("measure", return_undefined, 2),
];

#[native_abi]
fn precise_time(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    if State::of(cx).command_line().is_deterministic {
        return Ok((FIXED_TIME / 1000.0).into());
    }
    let since_epoch = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH);
    Ok(since_epoch.unwrap_or_default().as_secs_f64().into())
}

/// In milliseconds.
#[native_abi]
pub(super) fn monotonic_now(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    static ORIGIN: OnceLock<Instant> = OnceLock::new();
    if State::of(cx).command_line().is_deterministic {
        return Ok(Value::ZERO);
    }
    let elapsed = ORIGIN.get_or_init(Instant::now).elapsed();
    Ok((elapsed.as_secs_f64() * 1000.0).into())
}

fn duration(seconds: f64) -> Duration {
    Duration::try_from_secs_f64(seconds.clamp(0.0, 1e9)).unwrap_or_default()
}

#[native_abi]
fn sleep_seconds(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    std::thread::sleep(duration(frame.argument(0).to_number(cx)?));
    Ok(Value::UNDEFINED)
}

#[native_abi]
pub(super) fn sleep_milliseconds(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    std::thread::sleep(duration(frame.argument(0).to_number(cx)? / 1000.0));
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn set_timeout(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(callback) = frame.argument(0).downcast::<JsFunction>() else {
        return Err(cx.throw_type_error("First argument is not a JS function"));
    };
    let delay = duration(frame.argument(1).as_number().unwrap_or(0.0) / 1000.0);
    let ticket = cx.add_pending_work(WorkKind::AtSomePoint, callback.upcast(), &[]);
    static LAST_ID: AtomicU64 = AtomicU64::new(0);
    let (kind, id) = (AsyncCallType::DomTimer, LAST_ID.fetch_add(1, Relaxed));
    if let Some(inspector) = inspector::controller(cx) {
        inspector.did_schedule_async_call(cx, kind, id, true);
    }
    cx.timer_queue().start(delay, move |_| {
        ticket.schedule(move |cx, ticket| {
            let callback = ticket.target(cx).map_or_default(Into::into);
            let inspector = inspector::controller(cx);
            (inspector.iter()).for_each(|it| it.will_dispatch_async_call(kind, id));
            let result = cx.call(callback, Value::UNDEFINED, &[]);
            let result = result.and_then(|_| drain_microtasks(cx));
            (inspector.iter()).for_each(|it| it.did_dispatch_async_call(kind, id));
            result
        });
    });
    Ok(Value::UNDEFINED)
}

/// And reports the rejections that are left unhandled. Fails only if execution is terminated.
pub(crate) fn drain_microtasks(cx: &mut Cx) -> JsResult<()> {
    let state = State::of(cx);
    loop {
        cx.drain_microtasks()?;
        let rejected = state.rejected_promises.take();
        if rejected.is_empty() {
            return Ok(());
        }
        for promise in rejected {
            let promise = promise.get(cx);
            let global = promise.global().downcast::<ShellGlobal>();
            if !promise.is_handled()
                && let Some(callback) = global.and_then(|it| it.unhandled_rejection_callback())
                && let arguments = [promise.into(), promise.result()]
                && let Err(thrown) = cx.call(callback.into(), Value::NULL, &arguments)
            {
                cx.catch(thrown)?;
            }
        }
    }
}

#[native_abi]
fn call_drain_microtasks(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    drain_microtasks(cx).map(|()| Value::UNDEFINED)
}

#[native_abi]
fn set_unhandled_rejection_callback(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(callback) = frame.argument(0).as_object().filter(|it| it.is_callable()) else {
        return Err(cx.throw_type_error("Type error"));
    };
    (cx.global().cast::<ShellGlobal>()).set_unhandled_rejection_callback(Some(callback));
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn async_test_start(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(count) = frame.argument(0).as_index_int32() else {
        let message = "Expected first argument to be a uint32";
        return Err(cx.throw_error(ErrorType::Error, message));
    };
    (State::of(cx).expected_async_passes).update(|expected| expected + count);
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn async_test_passed(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    State::of(cx).async_passes.update(|passes| passes + 1);
    Ok(Value::UNDEFINED)
}
