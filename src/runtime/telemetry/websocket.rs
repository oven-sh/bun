//! WebSocket spans: server message handling and client connect.

use bun_jsc::{JSGlobalObject, JSValue};
use bun_telemetry::pool::{self, NativeSpan};
use bun_telemetry::{
    Instrument, ScopeId, SpanContext, SpanKind, SpanStub, StatusCode, Value, clock,
};

use super::{Entered, local, state};

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
    let mut lo = local(global)?;
    let stub = SpanStub::start(
        &mut lo.rng,
        parent.as_ref(),
        &state().sampler,
        clock::now_unix_nanos(),
    );
    let kind = if server {
        SpanKind::Server
    } else {
        SpanKind::Client
    };
    let span = pool::begin_with(
        &mut lo.pool,
        stub,
        ScopeId::from(Instrument::WebSocket),
        b"websocket.message",
        kind,
        |s| {
            if !stub.is_recording() {
                return;
            }
            let l = super::span::limits();
            // No websocket semconv yet; these mirror dd-trace's ws plugin.
            s.push_attribute(
                b"websocket.message.type",
                &Value::Str(if binary { b"binary" } else { b"text" }),
                l,
            );
            s.push_attribute(b"websocket.message.length", &Value::Int(size as i64), l);
            if link.is_valid() {
                s.add_link(link, b"", &[], l);
            }
        },
    );
    drop(lo);
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
    // `to_error` unwraps a JSC::Exception to the thrown value.
    let r = if let Some(err) = result.to_error() {
        super::span::record_exception(global, span, err)
    } else {
        if let Some(p) = result.as_any_promise() {
            if p.status() == bun_jsc::js_promise::Status::Rejected {
                if let Some(mut l) = local(global) {
                    pool::with(&mut l.pool, span, |s| s.set_status(StatusCode::Error, b""));
                }
            }
        }
        Ok(())
    };
    super::end_native(global, span, 0, |_| {});
    r
}
