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
            s.push_attribute(
                b"websocket.opcode",
                &Value::Str(if binary { b"binary" } else { b"text" }),
                l,
            );
            s.push_attribute(b"messaging.message.body.size", &Value::Int(size as i64), l);
            if link.is_valid() {
                s.add_link(link, &[], l);
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
        record_exception_value(span, global, err)
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

/// Record a thrown JS value as an `exception` event and set Error status.
pub fn record_exception_value(
    span: NativeSpan,
    global: &JSGlobalObject,
    err: JSValue,
) -> bun_jsc::JsResult<()> {
    let mut ty_s = None;
    let mut msg_s = None;
    let mut stack_s = None;
    // Describing the thrown value must not change what the application sees:
    // a throwing getter on it is ignored here (the error is still delivered
    // by the caller); only a pending termination is propagated.
    let read = |v: bun_jsc::JsResult<Option<JSValue>>| -> bun_jsc::JsResult<Option<bun_core::ZigStringSlice>> {
        match v {
            Ok(Some(v)) if v.is_string() => v.to_slice(global).map(Some),
            Ok(_) => Ok(None),
            Err(_) if global.clear_exception_except_termination() => Ok(None),
            Err(e) => Err(e),
        }
    };
    if err.is_object() {
        ty_s = read(err.get(global, "name"))?;
        msg_s = read(err.get(global, "message"))?;
        stack_s = read(err.get(global, "stack"))?;
    } else if err.is_string() {
        msg_s = read(Ok(Some(err)))?;
    }
    let ty = ty_s.as_ref().map(|s| s.slice()).unwrap_or(b"Error");
    let msg = msg_s.as_ref().map(|s| s.slice()).unwrap_or(b"");
    let stack = stack_s.as_ref().map(|s| s.slice()).unwrap_or(b"");
    if let Some(mut l) = local(global) {
        pool::with(&mut l.pool, span, |s| {
            bun_telemetry::otlp::with_exception_attrs(ty, msg, stack, |attrs| {
                s.add_event(b"exception", 0, attrs, super::span::limits())
            });
            s.set_status(StatusCode::Error, b"");
        });
    }
    Ok(())
}
