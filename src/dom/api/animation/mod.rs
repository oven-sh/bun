//! <https://drafts.csswg.org/web-animations/>. The engine has the animations and their timing.

mod document;
mod effect;
mod keyframes;
mod player;
mod range;
mod timeline;
mod trigger;

pub(crate) use document::*;
pub(crate) use effect::AnimationEffect;
pub(crate) use player::{Animation, notify_finished};
pub(crate) use timeline::AnimationTimeline;
pub(crate) use trigger::AnimationTrigger;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsInterface, JsScope, Result};
use bun_jsc::js_promise::Status;

use crate::api::typed::CSSNumericValue;
use crate::calc::{Kind, Unit};

fn percent(heap: &JsHeap<'_>, value: f64) -> JSValue {
    CSSNumericValue::of_unit(heap, value, Unit::Percent).to_js()
}

fn milliseconds<'a>(heap: &JsHeap<'a>, value: &'a CSSNumericValue) -> Result<'a, f64> {
    value.amount(
        heap,
        if value.numeric_type().matches(Kind::Number) {
            Unit::Number
        } else {
            Unit::Ms
        },
    )
}

fn is_pending(promise: JSValue) -> bool {
    // SAFETY: the value keeps it alive.
    promise
        .as_promise()
        .is_some_and(|it| unsafe { &*it }.status() == Status::Pending)
}

/// Nothing is told of a rejection that has no handler.
fn settle(cx: &mut JsScope<'_>, promise: JSValue, result: core::result::Result<JSValue, JSValue>) {
    let (global, Some(promise)) = (
        cx.global(),
        promise.as_promise().filter(|_| is_pending(promise)),
    ) else {
        return;
    };
    // SAFETY: as above, and it is an opaque handle.
    let promise = unsafe { &mut *promise };
    _ = match result {
        Ok(value) => promise.resolve(global, value),
        Err(reason) => promise.reject_as_handled(global, reason),
    };
}

/// `None` if it is missing.
fn nullable<'a, T: JsInterface>(
    heap: &JsHeap<'a>,
    value: JSValue,
) -> Result<'a, Option<Option<&'a T>>> {
    if value.is_undefined_or_null() {
        return Ok(value.is_null().then_some(None));
    }
    T::from_js(heap, value)
        .map(|it| Some(Some(it)))
        .ok_or_else(|| {
            heap.type_error(format_args!(
                "The provided value is not of the expected type."
            ))
        })
}
