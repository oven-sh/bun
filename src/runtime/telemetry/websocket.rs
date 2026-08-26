//! WebSocket spans: server message handling and client connect.

use bun_jsc::{JSGlobalObject, JSValue};
use bun_telemetry::pool::{self, NativeSpan};
use bun_telemetry::{Instrument, ScopeId, SpanContext, SpanKind, SpanStub, Value, clock};

use super::{Entered, local, state};

unsafe extern "C" {
    safe fn Bun__Telemetry__observeSettlement(
        global: &JSGlobalObject,
        promise: JSValue,
        span_cell: JSValue,
    ) -> JSValue;
}

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
/// Returns true when the span was left open to cover a pending promise.
pub fn end_message(
    span: NativeSpan,
    global: &JSGlobalObject,
    result: JSValue,
) -> bun_jsc::JsResult<bool> {
    if let Some(p) = result.as_any_promise() {
        match p.status() {
            bun_jsc::js_promise::Status::Pending => {
                // An async handler: the span covers the promise and records its
                // rejection, like Bun.otel.span(name, async fn).
                let cell = super::span::Bun__Telemetry__poolMaterialize(global, span.0);
                let derived = bun_jsc::host_fn::from_js_host_call(global, || {
                    Bun__Telemetry__observeSettlement(global, result, cell)
                })?;
                if !derived.is_undefined() {
                    // Observing marks the handler's promise handled; the derived
                    // promise rethrows the same reason and nobody handles it, so
                    // a late rejection still reaches `unhandledRejection` once.
                    return Ok(true);
                }
            }
            bun_jsc::js_promise::Status::Rejected => {
                let r = super::span::record_exception(global, span, p.result(global.vm()));
                super::end_native(global, span, 0, |_| {});
                return r.map(|()| false);
            }
            bun_jsc::js_promise::Status::Fulfilled => {}
        }
    }
    super::end_native(global, span, 0, |_| {});
    Ok(false)
}

pub fn is_live(global: &JSGlobalObject, span: NativeSpan) -> bool {
    local(global).is_some_and(|l| pool::is_live(&l.pool, span))
}

/// The socket closed while an async handler for this message was pending.
pub fn end_message_unsettled(span: NativeSpan, global: &JSGlobalObject) {
    if !is_live(global, span) {
        return;
    }
    if let Some(mut l) = local(global) {
        pool::with(&mut l.pool, span, |s| {
            s.set_status(
                bun_telemetry::StatusCode::Error,
                b"connection closed before the message handler settled",
            )
        });
    }
    super::end_native(global, span, 0, |_| {});
}

/// End a message span after the handler threw `err` (the thrown value).
pub fn end_message_thrown(
    span: NativeSpan,
    global: &JSGlobalObject,
    err: JSValue,
) -> bun_jsc::JsResult<()> {
    let r = super::span::record_exception(global, span, err);
    super::end_native(global, span, 0, |_| {});
    r
}
