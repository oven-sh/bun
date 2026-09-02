//! Server-side WebSocket message spans (client connect spans live in http_jsc WebSocketUpgradeClient).

use bun_jsc::{JSGlobalObject, JSValue};
use bun_telemetry::pool::{self, NativeSpan};
use bun_telemetry::{Instrument, SpanContext, SpanKind, Value};

use super::{Entered, local};

unsafe extern "C" {
    safe fn Bun__Telemetry__observeSettlement(
        global: &JSGlobalObject,
        promise: JSValue,
        span_cell: JSValue,
    ) -> JSValue;
}

/// Start a span for one incoming WebSocket message and make it active for
/// the handler. `link` is the upgrade request's context (may be invalid).
#[inline(always)]
pub fn begin_message(
    global: &JSGlobalObject,
    link: &SpanContext,
    binary: bool,
    size: usize,
) -> Option<(NativeSpan, Entered)> {
    if !bun_telemetry::enabled(Instrument::WebSocket) {
        return None;
    }
    begin_message_enabled(global, link, binary, size)
}

#[cold]
#[inline(never)]
fn begin_message_enabled(
    global: &JSGlobalObject,
    link: &SpanContext,
    binary: bool,
    size: usize,
) -> Option<(NativeSpan, Entered)> {
    let g = global.as_ptr().cast();
    let stub = bun_telemetry::rt::start_leaf(g, Instrument::WebSocket);
    if !stub.is_some() {
        return None;
    }
    // A non-recording message span still takes a slot: it is the handler's active parent.
    let span = bun_telemetry::rt::begin_pooled(
        g,
        Instrument::WebSocket,
        stub,
        b"websocket.message",
        SpanKind::Server,
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
                s.begin_link(link, b"", l);
            }
        },
    );
    if !span.is_some() {
        return None;
    }
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
                let cell = super::span::Bun__Telemetry__poolMaterialize(global, span);
                let observing = match bun_jsc::host_fn::from_js_host_call(global, || {
                    Bun__Telemetry__observeSettlement(global, result, cell)
                }) {
                    Ok(d) => d,
                    Err(e) => {
                        // The cell was just pinned; an exception here must not strand the slot.
                        super::end_native(global, span, 0, |_| {});
                        return Err(e);
                    }
                };
                if observing.to_boolean() {
                    // A rejection nobody handles is still reported, against the
                    // handler's own promise (telemetryObserveSettled).
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
