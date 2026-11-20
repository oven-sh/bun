use bun_jsc::bindgen::{JsHeap, JsLocal};
use bun_jsc::js_promise::Status;
use bun_jsc::{JSGlobalObject, JSPromise, JSValue, JsResult};
use bun_removable_features::{removable_body_behind_value, removable_definition};
use bun_telemetry::{Instrument, Record, SpanKind};

use crate::engine;
use crate::generated_bindgen::telemetry_internals::{
    Bun__Telemetry__onReject, Bun__Telemetry__onResolve,
};
use crate::native;
use crate::outcome::{Outcome, PendingException};
use crate::span::{Span, global_of};

/// Ends `span` now, or when `result` settles if it is a promise.
#[inline]
pub(crate) fn end_with_value(global: &JSGlobalObject, span: JSValue, result: JSValue) {
    let native = Span::of(&span);
    if let Some(promise) = result.as_promise().map(JSPromise::opaque_mut) {
        match promise.status() {
            Status::Pending if native.is_recording() => {
                let (resolved, rejected) = (Bun__Telemetry__onResolve, Bun__Telemetry__onReject);
                return engine::observe(global, promise, span, resolved, rejected);
            }
            Status::Rejected => native.fail_in_passing(global, engine::rejection_reason(promise)),
            Status::Pending | Status::Fulfilled => {}
        }
    }
    native.finish(global, span, 0);
}

pub(crate) fn on_resolve<'a>(heap: &JsHeap<'a>, _: JsLocal<'a>, span: (&Span, JsLocal<'a>)) {
    span.0.finish(global_of(heap), span.1.to_js(), 0);
}

pub(crate) fn on_reject<'a>(heap: &JsHeap<'a>, error: JsLocal<'a>, span: (&Span, JsLocal<'a>)) {
    span.0.fail_in_passing(global_of(heap), error.to_js());
    on_resolve(heap, error, span);
}

/// Ends `span` with the call that gave `result`, or with the promise it returned.
#[inline]
pub(crate) fn end_with(
    global: &JSGlobalObject,
    span: JSValue,
    result: JsResult<JSValue>,
) -> JsResult<JSValue> {
    match result {
        Ok(value) => end_with_value(global, span, value),
        Err(_) => end_with_thrown(global, span),
    }
    result
}

#[cold]
fn end_with_thrown(global: &JSGlobalObject, span: JSValue) {
    let native = Span::of(&span);
    native.record(|r| PendingException(global).record(r));
    native.finish(global, span, 0);
}

/// The span of a native operation that returns a promise. It lives on the stack, where the GC finds it.
#[derive(Default)]
pub struct PromiseSpan(JSValue);

impl PromiseSpan {
    #[inline(always)]
    pub fn start(
        global: &JSGlobalObject,
        instrument: Instrument,
        kind: SpanKind,
        describe: impl FnOnce(&mut Record),
    ) -> PromiseSpan {
        if !bun_telemetry::enabled(instrument) {
            return PromiseSpan::default();
        }
        removable_body_behind_value!(Telemetry, {
            let Some(data) = native::start_leaf(global, instrument, kind) else {
                return PromiseSpan::default();
            };
            let span = Span::create(global, data, None);
            Span::of(&span).record(describe);
            PromiseSpan(span)
        })
    }

    /// Returns `result`.
    #[inline(always)]
    pub fn end_with(self, global: &JSGlobalObject, result: JsResult<JSValue>) -> JsResult<JSValue> {
        #[inline(never)]
        fn end_started(
            global: &JSGlobalObject,
            span: JSValue,
            result: JsResult<JSValue>,
        ) -> JsResult<JSValue> {
            removable_definition!(Telemetry, end_started);
            end_with(global, span, result)
        }
        if self.0.is_empty() {
            return result;
        }
        end_started(global, self.0, result)
    }
}
