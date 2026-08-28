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
/// `https`: the listener terminates TLS (the response variant cannot say:
/// HTTP/2 runs both over TLS and as cleartext prior-knowledge).
pub fn begin(
    global: &JSGlobalObject,
    req: &bun_uws::AnyRequest,
    resp: bun_uws::AnyResponse,
    https: bool,
) -> Option<(NativeSpan, Entered)> {
    if !bun_telemetry::enabled(Instrument::HttpServer) {
        return None;
    }
    let st = state();
    let known = Method::find(req.method());
    let method = R::SemconvMethod::of(known);
    let h = req.telemetry_headers();
    let mut parent = None;
    let mut raw_ts = None;
    if st.propagate_trace_context {
        if let Some(tp) = h.traceparent() {
            parent = propagation::parse_traceparent(tp);
            if parent.is_some() {
                raw_ts = list_header(req, b"tracestate", h.tracestate(), h.tracestate_repeated);
            }
        }
    }
    let trace_state: &[u8] = raw_ts
        .as_deref()
        .and_then(propagation::tracestate_bounded)
        .unwrap_or(b"");
    // `http: "nested"`: a server span's only possible parent is the caller's
    // traceparent, so record only requests that are part of a trace.
    if parent.is_none() && !bun_telemetry::allows_root(Instrument::HttpServer) {
        return None;
    }
    let now = clock::now_unix_nanos();
    let mut l = local(global)?;
    let stub = SpanStub::start(&mut l.rng, parent.as_ref(), &st.sampler, now);
    let raw_bg = if st.propagate_baggage {
        list_header(req, b"baggage", h.baggage(), h.baggage_repeated)
    } else {
        None
    };
    let baggage: Option<&[u8]> = raw_bg
        .as_deref()
        .filter(|b| propagation::baggage_is_reasonable(b));
    debug_assert!(
        match resp {
            bun_uws::AnyResponse::TCP(_) => !https,
            bun_uws::AnyResponse::SSL(_) | bun_uws::AnyResponse::H3(_) => https,
            bun_uws::AnyResponse::H2(_) => true,
        },
        "url.scheme disagrees with the transport"
    );
    // Facts only; attributes are encoded when the batch is exported
    // (bun_telemetry::http_record).
    let span = pool::begin_with(
        &mut l.pool,
        stub,
        ScopeId::from(Instrument::HttpServer),
        b"",
        SpanKind::Server,
        trace_state,
        |s| {
            if let Some(b) = baggage {
                s.baggage.extend_from_slice(b);
            }
            s.http.active = true;
            s.http.method = method;
            s.http.https = https;
            if !stub.is_recording() {
                return;
            }
            if method.is_other() {
                // (uWS lower-cases the request line's token; a method bun's
                // `Method` knows keeps its canonical spelling)
                let original = known.map_or(req.method(), |m| m.as_str().as_bytes());
                s.push_attribute(
                    b"http.request.method_original",
                    &Value::Str(original),
                    &st.limits,
                );
            }
            let f = &mut s.http;
            // network.peer.*: the raw address is cached per connection by the
            // transport (one getpeername); it is formatted into the facts per
            // request (no per-connection encoded cache: that costs every
            // connection ~100 B whether tracing is on or not).
            let h1 = if h.http10 != 0 {
                R::HttpVersion::Http10
            } else {
                R::HttpVersion::Http11
            };
            // Exhaustive on purpose: a new transport must decide its protocol
            // version and peer-address source here, not inherit HTTP/1.1's.
            let (peer, peer_port, version) = match resp {
                bun_uws::AnyResponse::H3(_) | bun_uws::AnyResponse::H2(_) => {
                    let version = if matches!(resp, bun_uws::AnyResponse::H3(_)) {
                        R::HttpVersion::Http3
                    } else {
                        R::HttpVersion::Http2
                    };
                    // (multiplexed transports report the peer as text per stream)
                    match resp.get_remote_socket_info() {
                        Some(a) => (
                            R::PeerIp::from_text(a.ip()),
                            u16::try_from(a.port).unwrap_or(0),
                            version,
                        ),
                        None => (R::PeerIp::None, 0, version),
                    }
                }
                bun_uws::AnyResponse::TCP(_) | bun_uws::AnyResponse::SSL(_) => {
                    match resp.get_remote_address_raw() {
                        Some((RawIp::V4(b), port)) => (R::PeerIp::V4(b), port, h1),
                        // (a v4-mapped `::ffff:a.b.c.d` stays as such, like requestIP() / net.Socket.remoteAddress)
                        Some((RawIp::V6(b), port)) => (R::PeerIp::V6(b), port, h1),
                        None => (R::PeerIp::None, 0, h1),
                    }
                }
            };
            f.version = version;

            let url = req.url();
            let path_len = if h.path_len == u32::MAX {
                bun_core::strings::index_of_char_usize(url, b'?').unwrap_or(url.len())
            } else {
                h.path_len as usize
            };
            f.set_request(
                &peer,
                peer_port,
                url,
                path_len,
                R::forwarded_client(h.forwarded(), h.x_forwarded_for()),
                h.host().unwrap_or(b""),
                h.user_agent().unwrap_or(b""),
            );
            for header in &st.capture_request_headers {
                // semconv: string[]; a repeated header's values are joined
                // with ", " (one element), as Request.headers.get() shows them.
                if let Some(v) = req.header_joined(header.name()) {
                    let v = bun_telemetry::otlp::utf8_lossy(&v);
                    s.push_attribute(
                        header.attribute_key(),
                        &Value::Array(&[Value::Str(&v)]),
                        &st.limits,
                    );
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

/// A list-valued header: the single field, or every field joined with ", "
/// when it repeats (W3C: several fields are one list, in order).
fn list_header<'a>(
    req: &'a bun_uws::AnyRequest,
    name: &[u8],
    single: Option<&'a [u8]>,
    repeated: u8,
) -> Option<std::borrow::Cow<'a, [u8]>> {
    let single = single?;
    if repeated != 0 {
        req.header_joined(name)
    } else {
        Some(std::borrow::Cow::Borrowed(single))
    }
}

/// [`begin`] for a route matched by its literal path (static and HTML-bundle
/// routes): the query-stripped path `begin` recorded is the route.
pub fn begin_static(
    global: &JSGlobalObject,
    req: &bun_uws::AnyRequest,
    resp: bun_uws::AnyResponse,
    https: bool,
) -> Option<(NativeSpan, Entered)> {
    let (span, entered) = begin(global, req, resp, https)?;
    if let Some(mut l) = local(global) {
        pool::with(&mut l.pool, span, |s| {
            if s.is_recording() {
                s.http.set_route_from_path();
            }
        });
    }
    Some((span, entered))
}

/// Refine the span name to `METHOD /route` once the matched route is known.
pub fn set_route(global: &JSGlobalObject, span: NativeSpan, route: &[u8]) {
    if route.is_empty() {
        return;
    }
    if let Some(mut l) = local(global) {
        pool::with(&mut l.pool, span, |s| {
            if s.is_recording() {
                s.http.set_route(route);
            }
        });
    }
}

/// Finish the request span. `status == 0` means no status line was written
/// (aborted before headers).
pub fn end(global: &JSGlobalObject, span: NativeSpan, status: u16, termination: R::Termination) {
    if let Some(mut l) = local(global) {
        pool::with(&mut l.pool, span, |s| {
            s.http.status = status;
            s.http.termination = termination;
        });
    }
    super::end_native(global, span, 0, |_| {});
}
