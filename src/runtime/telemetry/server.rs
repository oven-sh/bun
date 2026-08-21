//! HTTP server spans for Bun.serve and node:http.

use bun_http::Method;
use bun_jsc::JSGlobalObject;
use bun_telemetry::pool::{self, NativeSpan};
use bun_telemetry::{Instrument, ScopeId, SpanKind, SpanStub, StatusCode, Value, clock, propagation};

use super::{Entered, http, state};

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
) -> Option<(NativeSpan, Option<Entered>)> {
    if !bun_telemetry::enabled(Instrument::HttpServer) {
        return None;
    }
    let st = state();
    let mut parent = None;
    let mut trace_state: &[u8] = b"";
    if st.propagate_trace_context {
        if let Some(h) = req.header(b"traceparent") {
            parent = propagation::parse_traceparent(h);
            if parent.is_some() {
                if let Some(ts) = req.header(b"tracestate") {
                    if propagation::tracestate_is_reasonable(ts) {
                        trace_state = ts;
                    }
                }
            }
        }
    }
    let now = clock::now_unix_nanos();
    let stub = SpanStub::start(parent.as_ref(), &st.sampler, now);
    let method_name = http::method_name(method);
    let span = pool::begin(
        stub,
        ScopeId::from(Instrument::HttpServer),
        method_name.as_bytes(),
        SpanKind::Server,
    );
    let baggage = if st.propagate_baggage {
        req.header(b"baggage").filter(|b| propagation::baggage_is_reasonable(b))
    } else {
        None
    };
    pool::with(span, |s| {
        if !trace_state.is_empty() {
            s.trace_state.extend_from_slice(trace_state);
        }
        if let Some(b) = baggage {
            s.baggage.extend_from_slice(b);
        }
        if !stub.ctx.flags.sampled() || bun_telemetry::exp(2) {
            return;
        }
        let l = &st.limits;
        s.push_attribute(b"http.request.method", &Value::Str(method_name.as_bytes()), l);
        let url = req.url();
        // uWS gives us the path here; the query string (if any) follows '?'.
        let (path, query) = match bun_core::strings::index_of_char_usize(url, b'?') {
            Some(i) => (&url[..i], &url[i + 1..]),
            None => (url, &b""[..]),
        };
        s.push_attribute(b"url.path", &Value::Str(path), l);
        if !query.is_empty() {
            s.push_attribute(b"url.query", &Value::Str(query), l);
        }
        s.push_attribute(b"url.scheme", &Value::Str(if is_https { b"https" } else { b"http" }), l);
        if let Some(host) = req.header(b"host") {
            let (h, port) = http::split_host_port(host);
            s.push_attribute(b"server.address", &Value::Str(h), l);
            if let Some(p) = port {
                s.push_attribute(b"server.port", &Value::Int(p as i64), l);
            }
        }
        if let Some(ua) = req.header(b"user-agent") {
            s.push_attribute(b"user_agent.original", &Value::Str(ua), l);
        }
        if !bun_telemetry::exp(4) {
            if let Some((ip, port)) = resp.get_remote_address_raw() {
                let mut buf = [0u8; 46];
                s.push_attribute(b"client.address", &Value::Str(ip.format(&mut buf)), l);
                if port > 0 {
                    s.push_attribute(b"client.port", &Value::Int(port as i64), l);
                }
            }
        }
        for name in &st.capture_request_headers {
            if let Some(v) = req.header(name) {
                let mut key = Vec::with_capacity(20 + name.len());
                key.extend_from_slice(b"http.request.header.");
                key.extend_from_slice(name);
                s.push_attribute(&key, &Value::Str(v), l);
            }
        }
    });
    if bun_telemetry::exp(1) {
        return Some((span, None));
    }
    let js = super::create_native_cell(global, &stub, ScopeId::from(Instrument::HttpServer), SpanKind::Server, span);
    Some((span, Some(Entered::new(global, js))))
}

/// Refine the span name to `METHOD /route` once the matched route is known.
pub fn set_route(span: NativeSpan, method: Method, route: &[u8]) {
    if route.is_empty() {
        return;
    }
    pool::with(span, |s| {
        if !s.stub.ctx.flags.sampled() {
            return;
        }
        let m = http::method_name(method);
        s.name.clear();
        s.name.reserve(m.len() + 1 + route.len());
        s.name.extend_from_slice(m.as_bytes());
        s.name.push(b' ');
        s.name.extend_from_slice(route);
        s.push_attribute(b"http.route", &Value::Str(route), &state().limits);
    });
}

/// Finish the request span. `status == 0` means no status line was written
/// (aborted before headers).
pub fn end(span: NativeSpan, status: u16, aborted: bool) {
    if bun_telemetry::exp(8) {
        pool::discard(span);
        return;
    }
    super::end_native(span, 0, |w| {
        http::status_attrs(w, status, true);
        if aborted && status < 500 {
            w.attr("error.type", "aborted");
            w.status(StatusCode::Error, b"request aborted");
        }
    });
}
