//! WebSocket spans: server message handling and client connect.

use bun_jsc::{JSGlobalObject, JSValue};
use bun_telemetry::data::DEFAULT_LIMITS;
use bun_telemetry::{
    Instrument, ScopeId, Span, SpanContext, SpanKind, SpanStub, StatusCode, Value, clock,
};

use super::span::TelemetrySpan;
use super::{Entered, state};

/// Start a span for one incoming WebSocket message and make it active for
/// the handler. `link` is the upgrade request's context (may be invalid).
pub fn begin_message(
    global: &JSGlobalObject,
    link: &SpanContext,
    binary: bool,
    size: usize,
    server: bool,
) -> Option<(Span, Entered)> {
    if !bun_telemetry::enabled(Instrument::WebSocket) {
        return None;
    }
    let parent = super::active_context(global);
    if parent.is_none() && !bun_telemetry::allows_root(Instrument::WebSocket) {
        return None;
    }
    let stub = SpanStub::start(parent.as_ref(), &state().sampler, clock::now_unix_nanos());
    let span = Span::new(
        stub,
        ScopeId::from(Instrument::WebSocket),
        b"websocket.message",
        if server {
            SpanKind::Server
        } else {
            SpanKind::Client
        },
    );
    if stub.is_recording() {
        let l = &DEFAULT_LIMITS;
        span.set_attribute(
            b"websocket.opcode",
            &Value::Str(if binary { b"binary" } else { b"text" }),
            l,
        );
        span.set_attribute(b"messaging.message.body.size", &Value::Int(size as i64), l);
        if link.is_valid() {
            span.add_link(link, b"", &[], l);
        }
    }
    let js = TelemetrySpan::create(global, span.clone());
    Some((span, Entered::new(global, js)))
}

/// End a message span after the handler returned `result`.
pub fn end_message(span: Span, global: &JSGlobalObject, result: JSValue) {
    if result.to_error().is_some() {
        let _ = super::span::record_exception_value(&span, global, result, 0);
        span.set_status(StatusCode::Error, b"");
    } else if let Some(p) = result.as_any_promise() {
        if p.status() == bun_jsc::js_promise::Status::Rejected {
            span.set_status(StatusCode::Error, b"");
        }
    }
    super::end_span(&span, 0, |_| {});
}
