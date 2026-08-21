//! WebSocket spans: server message handling and client connect.

use bun_jsc::{JSGlobalObject, JSValue};
use bun_telemetry::pool::{self, NativeSpan};
use bun_telemetry::{
    DEFAULT_LIMITS, Instrument, ScopeId, SpanContext, SpanKind, SpanStub, StatusCode, Value, clock,
};

use super::{Entered, state};

/// Start a span for one incoming WebSocket message and make it active for
/// the handler. `link` is the upgrade request's context (may be invalid).
pub fn begin_message(
    global: &JSGlobalObject,
    link: &SpanContext,
    binary: bool,
    size: usize,
    server: bool,
) -> Option<(NativeSpan, Entered)> {
    if !bun_telemetry::enabled(Instrument::WebSocket) {
        return None;
    }
    let parent = super::active_context(global);
    if parent.is_none() && !bun_telemetry::allows_root(Instrument::WebSocket) {
        return None;
    }
    let stub = SpanStub::start(parent.as_ref(), &state().sampler, clock::now_unix_nanos());
    let kind = if server {
        SpanKind::Server
    } else {
        SpanKind::Client
    };
    let span = pool::begin(
        stub,
        ScopeId::from(Instrument::WebSocket),
        b"websocket.message",
        kind,
    );
    if stub.is_recording() {
        let l = &DEFAULT_LIMITS;
        pool::with(span, |s| {
            s.push_attribute(
                b"websocket.opcode",
                &Value::Str(if binary { b"binary" } else { b"text" }),
                l,
            );
            s.push_attribute(b"messaging.message.body.size", &Value::Int(size as i64), l);
            if link.is_valid() {
                bun_telemetry::otlp::encode_link(&mut s.extra, link, b"", &[]);
            }
        });
    }
    Some((
        span,
        Entered::new(global, super::native_context_value(span)),
    ))
}

/// End a message span after the handler returned `result`.
pub fn end_message(
    span: NativeSpan,
    global: &JSGlobalObject,
    result: JSValue,
) -> bun_jsc::JsResult<()> {
    let r = if result.to_error().is_some() {
        record_exception_value(span, global, result)
    } else {
        if let Some(p) = result.as_any_promise() {
            if p.status() == bun_jsc::js_promise::Status::Rejected {
                pool::with(span, |s| s.set_status(StatusCode::Error, b""));
            }
        }
        Ok(())
    };
    super::end_native(span, 0, |_| {});
    r
}

/// Record a thrown JS value as an `exception` event and set Error status.
pub fn record_exception_value(
    span: NativeSpan,
    global: &JSGlobalObject,
    err: JSValue,
) -> bun_jsc::JsResult<()> {
    let mut ty_s = None;
    let mut msg_s = None;
    let mut stack_s = None;
    if err.is_object() {
        for (key, out) in [
            ("name", &mut ty_s),
            ("message", &mut msg_s),
            ("stack", &mut stack_s),
        ] {
            if let Some(v) = err.get(global, key)? {
                if v.is_string() {
                    *out = Some(v.to_slice(global)?);
                }
            }
        }
    } else if err.is_string() {
        msg_s = Some(err.to_slice(global)?);
    }
    let ty = ty_s.as_ref().map(|s| s.slice()).unwrap_or(b"Error");
    let msg = msg_s.as_ref().map(|s| s.slice()).unwrap_or(b"");
    let stack = stack_s.as_ref().map(|s| s.slice()).unwrap_or(b"");
    let attrs: [(&[u8], Value<'_>); 3] = [
        (b"exception.type", Value::Str(ty)),
        (b"exception.message", Value::Str(msg)),
        (b"exception.stacktrace", Value::Str(stack)),
    ];
    let n = if stack.is_empty() { 2 } else { 3 };
    pool::with(span, |s| {
        s.add_event(b"exception", 0, &attrs[..n]);
        s.set_status(StatusCode::Error, b"");
    });
    Ok(())
}
