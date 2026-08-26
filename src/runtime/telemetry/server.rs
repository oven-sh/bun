//! HTTP server spans for Bun.serve and node:http.

use bun_http::Method;
use bun_jsc::JSGlobalObject;
use bun_telemetry::http_record as R;
use bun_telemetry::pool::{self, NativeSpan};
use bun_telemetry::{Instrument, ScopeId, SpanKind, SpanStub, Value, clock, propagation};
use bun_uws_sys::response::RawIp;

use super::{Entered, local, state};

/// Start a SERVER span for an incoming request and make it the active span.
/// Returns the span (stored on the request context and finished with
/// [`end`]) and the activation guard the dispatching frame must hold across
/// the JS handler call.
/// `method`: `None` when bun's `Method` cannot name the request's method.
pub fn begin(
    global: &JSGlobalObject,
    method: Option<Method>,
    req: &bun_uws::AnyRequest,
    resp: bun_uws::AnyResponse,
    is_https: bool,
) -> Option<(NativeSpan, Entered)> {
    if !bun_telemetry::enabled(Instrument::HttpServer) {
        return None;
    }
    let st = state();
    let h = req.telemetry_headers();
    let mut parent = None;
    let mut joined_trace_state: Option<Vec<u8>> = None;
    let mut trace_state: &[u8] = b"";
    if st.propagate_trace_context {
        if let Some(tp) = h.traceparent() {
            parent = propagation::parse_traceparent(tp);
            if parent.is_some() {
                if h.tracestate_repeated != 0 && h.tracestate().is_some() {
                    // W3C: several tracestate fields are one list, in order.
                    joined_trace_state = req.header_joined(b"tracestate");
                }
                let raw = joined_trace_state.as_deref().or_else(|| h.tracestate());
                if let Some(ts) = raw.and_then(propagation::tracestate_bounded) {
                    trace_state = ts;
                }
            }
        }
    }
    // `http: "nested"`: a server span's only possible parent is the caller's
    // traceparent, so record only requests that are part of a trace.
    if parent.is_none() && !bun_telemetry::allows_root(Instrument::HttpServer) {
        return None;
    }
    let now = clock::now_unix_nanos();
    let mut l = local(global)?;
    let stub = SpanStub::start(&mut l.rng, parent.as_ref(), &st.sampler, now);
    let joined_baggage: Option<Vec<u8>> =
        if st.propagate_baggage && h.baggage_repeated != 0 && h.baggage().is_some() {
            req.header_joined(b"baggage")
        } else {
            None
        };
    let baggage = if st.propagate_baggage {
        joined_baggage
            .as_deref()
            .or_else(|| h.baggage())
            .filter(|b| propagation::baggage_is_reasonable(b))
    } else {
        None
    };
    // Facts only; attributes are encoded when the batch is exported
    // (bun_telemetry::http_record).
    let span = pool::begin_with(
        &mut l.pool,
        stub,
        ScopeId::from(Instrument::HttpServer),
        b"",
        SpanKind::Server,
        |s| {
            if !trace_state.is_empty() {
                s.trace_state.extend_from_slice(trace_state);
            }
            if let Some(b) = baggage {
                s.baggage.extend_from_slice(b);
            }
            let mut flags = if is_https { R::FLAG_HTTPS } else { 0 };
            // A method `Method` cannot name (custom extension): `_OTHER` plus the original.
            if method.is_none() && stub.ctx.flags.sampled() {
                flags |= R::FLAG_METHOD_OTHER;
                s.push_attribute(
                    b"http.request.method_original",
                    &Value::Str(req.method()),
                    &st.limits,
                );
            }
            let f = &mut s.http;
            f.active = true;
            f.method = method.unwrap_or(Method::GET);
            if !stub.ctx.flags.sampled() {
                return;
            }
            f.flags = flags;
            // network.peer.*: the raw address is cached per connection by the
            // transport (one getpeername); it is formatted into the facts per
            // request (no per-connection encoded cache: that costs every
            // connection ~100 B whether tracing is on or not).
            let h1 = if h.http10 != 0 {
                R::HttpVersion::Http10
            } else {
                R::HttpVersion::Http11
            };
            (f.peer, f.peer_port, f.version) = match resp {
                bun_uws::AnyResponse::H3(_) => match resp.get_remote_socket_info() {
                    Some(a) => (
                        R::PeerIp::from_text(a.ip()),
                        u16::try_from(a.port).unwrap_or(0),
                        R::HttpVersion::Http3,
                    ),
                    None => (R::PeerIp::None, 0, R::HttpVersion::Http3),
                },
                _ => match resp.get_remote_address_raw() {
                    Some((RawIp::V4(b), port)) => (R::PeerIp::V4(b), port, h1),
                    // (a v4-mapped `::ffff:a.b.c.d` stays as such, like requestIP() / net.Socket.remoteAddress)
                    Some((RawIp::V6(b), port)) => (R::PeerIp::V6(b), port, h1),
                    None => (R::PeerIp::None, 0, h1),
                },
            };

            let url = req.url();
            let path_len = if h.path_len == u32::MAX {
                bun_core::strings::index_of_char_usize(url, b'?').unwrap_or(url.len())
            } else {
                h.path_len as usize
            };
            f.set_request(
                url,
                path_len,
                R::forwarded_client(h.forwarded(), h.x_forwarded_for()),
                h.host().unwrap_or(b""),
                h.user_agent().unwrap_or(b""),
            );
            if !st.capture_request_headers.is_empty() {
                let l = &st.limits;
                for name in &st.capture_request_headers {
                    // semconv: string[]; a repeated header's values are joined
                    // with ", " (one element), as Request.headers.get() shows them.
                    if let Some(v) = req.header_joined(name) {
                        let v = bun_telemetry::otlp::utf8_lossy(&v);
                        let mut key = Vec::with_capacity(20 + name.len());
                        key.extend_from_slice(b"http.request.header.");
                        key.extend_from_slice(name);
                        s.push_attribute(&key, &Value::Array(&[Value::Str(&v)]), l);
                    }
                }
            }
        },
    );
    drop(l);
    Some((
        span,
        Entered::new(global, super::native_context_value(span)),
    ))
}

/// Refine the span name to `METHOD /route` once the matched route is known.
pub fn set_route(global: &JSGlobalObject, span: NativeSpan, route: &[u8]) {
    if route.is_empty() {
        return;
    }
    if let Some(mut l) = local(global) {
        pool::with(&mut l.pool, span, |s| {
            if s.stub.ctx.flags.sampled() {
                s.http.set_route(route);
            }
        });
    }
}

/// Finish the request span. `status == 0` means no status line was written
/// (aborted before headers).
pub fn end(global: &JSGlobalObject, span: NativeSpan, status: u16, aborted: bool) {
    end_with(global, span, status, aborted, false)
}

/// `handler_error`: the JS handler threw or rejected (node:http), which is an
/// error even when the status line that went out was not 5xx.
pub fn end_with(
    global: &JSGlobalObject,
    span: NativeSpan,
    status: u16,
    aborted: bool,
    handler_error: bool,
) {
    super::end_native_with(
        global,
        span,
        0,
        &mut |s: &mut pool::Slot| {
            s.http.status = status;
            if aborted {
                s.http.flags |= R::FLAG_ABORTED;
            }
            if handler_error {
                s.http.flags |= R::FLAG_HANDLER_ERROR;
            }
        },
        &mut |_: &mut bun_telemetry::SpanWriter<'_>| {},
    );
}
