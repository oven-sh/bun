//! The functions that `bun:grpc` calls.

use bun_jsc::JSValue;
use bun_jsc::bindgen::{Callable, JsLocal, JsPayload as _, JsScope};

use super::grpc_call::{GrpcMethod, GrpcRoute};
use crate::generated_bindgen::grpc_binding::js_GrpcRoute;
use crate::webcore::Response;
use crate::webcore::response::HeadersRef;

pub(crate) fn create_route<'a>(
    cx: &mut JsScope<'a>,
    request_stream: bool,
    limit: u32,
    start: Option<JsLocal<'a, Callable>>,
) -> JSValue {
    let method = GrpcMethod {
        request_stream,
        limit,
        is_implemented: start.is_some(),
    };
    let route = GrpcRoute { method }.into_js_wrapper(cx.global()).to_js();
    if let Some(start) = start {
        js_GrpcRoute::start_set_cached(route, cx.global(), start.to_js());
    }
    route
}

pub(crate) fn take_trailers(cx: &mut JsScope<'_>, response: &Response) -> JSValue {
    match response.trailers.take() {
        Some(trailers) => HeadersRef::create_from_headers(&trailers).to_js(cx.global()),
        None => JSValue::UNDEFINED,
    }
}
