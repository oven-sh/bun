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
pub fn begin(
    global: &JSGlobalObject,
    method: Method,
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
    let mut trace_state: &[u8] = b"";
    if st.propagate_trace_context {
        if let Some(tp) = h.traceparent() {
            parent = propagation::parse_traceparent(tp);
            if parent.is_some() {
                if let Some(ts) = h.tracestate() {
                    if propagation::tracestate_is_reasonable(ts) {
                        trace_state = ts;
                    }
                }
            }
        }
    }
    let now = clock::now_unix_nanos();
    let mut l = local(global)?;
    let stub = SpanStub::start(&mut l.rng, parent.as_ref(), &st.sampler, now);
    let baggage = if st.propagate_baggage {
        h.baggage()
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
            let f = &mut s.http;
            f.active = true;
            f.method = method;
            if !stub.ctx.flags.sampled() {
                return;
            }
            f.flags = if is_https { R::FLAG_HTTPS } else { 0 };
            // network.peer.* are per connection: encoded once and cached on the
            // connection (H1); each request copies the bytes into its facts.
            let mut fresh = Vec::new();
            let cache = resp.peer_attrs_cache();
            let cached: &[u8] = cache.as_ref().map_or(b"", |c| c.get());
            let peer_encoded: &[u8] = if !cached.is_empty() {
                f.version = R::HttpVersion::Http11;
                cached
            } else {
                {
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
                            Some((RawIp::V4(b), port)) => {
                                (R::PeerIp::V4(b), port, R::HttpVersion::Http11)
                            }
                            // v4-mapped (::ffff:a.b.c.d) reads as the v4 address, as node reports it.
                            Some((RawIp::V6(b), port)) => (
                                match b {
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, a, b_, c, d] => {
                                        R::PeerIp::V4([a, b_, c, d])
                                    }
                                    _ => R::PeerIp::V6(b),
                                },
                                port,
                                R::HttpVersion::Http11,
                            ),
                            None => (R::PeerIp::None, 0, R::HttpVersion::Http11),
                        },
                    };
                    match (&cache, &f.peer) {
                        (None, _) | (_, R::PeerIp::None) => &b""[..],
                        (Some(cache), _) => {
                            fresh.reserve(R::PEER_ATTRS_MAX);
                            R::encode_peer_attrs(&f.peer, f.peer_port, &mut fresh);
                            cache.set(&fresh);
                            &fresh[..]
                        }
                    }
                }
            };
            let url = req.url();
            let path_len = if h.path_len == u32::MAX {
                bun_core::strings::index_of_char_usize(url, b'?').unwrap_or(url.len())
            } else {
                h.path_len as usize
            };
            f.set_request(
                peer_encoded,
                url,
                path_len,
                R::forwarded_client(h.forwarded(), h.x_forwarded_for()),
                h.host().unwrap_or(b""),
                h.user_agent().unwrap_or(b""),
            );
            if !st.capture_request_headers.is_empty() {
                let l = &st.limits;
                for name in &st.capture_request_headers {
                    if let Some(v) = req.header(name) {
                        let mut key = Vec::with_capacity(20 + name.len());
                        key.extend_from_slice(b"http.request.header.");
                        key.extend_from_slice(name);
                        // semconv: header values are string[].
                        s.push_attribute(&key, &Value::Array(&[Value::Str(v)]), l);
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
