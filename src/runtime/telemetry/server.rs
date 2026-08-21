//! HTTP server spans for Bun.serve and node:http.

use bun_http::Method;
use bun_jsc::JSGlobalObject;
use bun_telemetry::{
    Flags, Instrument, ScopeId, Span, SpanContext, SpanKind, SpanStub, StatusCode, Value, clock,
    propagation,
};

use super::span::TelemetrySpan;
use super::{Entered, http, state};

/// Start a SERVER span for an incoming request and make it the active span.
/// Returns the span (to be stored on the request context and finished with
/// [`end`]) and the activation guard the dispatching frame must hold across
/// the JS handler call.
pub fn begin(
    global: &JSGlobalObject,
    method: Method,
    req: &bun_uws::AnyRequest,
    resp: bun_uws::AnyResponse,
    is_https: bool,
) -> Option<(Span, Entered)> {
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
    let span = Span::new(
        stub,
        ScopeId::from(Instrument::HttpServer),
        method_name.as_bytes(),
        SpanKind::Server,
    );
    if !trace_state.is_empty() {
        span.set_trace_state(trace_state);
    }
    if st.propagate_baggage {
        if let Some(b) = req.header(b"baggage") {
            if propagation::baggage_is_reasonable(b) {
                span.set_baggage(b);
            }
        }
    }
    if stub.ctx.flags.sampled() {
        let l = &st.limits;
        span.set_attribute(
            b"http.request.method",
            &Value::Str(method_name.as_bytes()),
            l,
        );
        let url = req.url();
        // uWS gives us the path here; the query string (if any) follows '?'.
        let (path, query) = match bun_core::strings::index_of_char_usize(url, b'?') {
            Some(i) => (&url[..i], &url[i + 1..]),
            None => (url, &b""[..]),
        };
        span.set_attribute(b"url.path", &Value::Str(path), l);
        if !query.is_empty() {
            span.set_attribute(b"url.query", &Value::Str(query), l);
        }
        span.set_attribute(
            b"url.scheme",
            &Value::Str(if is_https { b"https" } else { b"http" }),
            l,
        );
        if let Some(host) = req.header(b"host") {
            let (h, port) = http::split_host_port(host);
            span.set_attribute(b"server.address", &Value::Str(h), l);
            if let Some(p) = port {
                span.set_attribute(b"server.port", &Value::Int(p as i64), l);
            }
        }
        if let Some(ua) = req.header(b"user-agent") {
            span.set_attribute(b"user_agent.original", &Value::Str(ua), l);
        }
        if let Some(info) = resp.get_remote_socket_info() {
            span.set_attribute(b"client.address", &Value::Str(info.ip()), l);
            if info.port > 0 {
                span.set_attribute(b"client.port", &Value::Int(info.port as i64), l);
            }
        }
        for name in &st.capture_request_headers {
            if let Some(v) = req.header(name) {
                let mut key = Vec::with_capacity(20 + name.len());
                key.extend_from_slice(b"http.request.header.");
                key.extend_from_slice(name);
                span.set_attribute(&key, &Value::Str(v), l);
            }
        }
    }
    let js = TelemetrySpan::create(global, span.clone());
    Some((span, Entered::new(global, js)))
}

/// Refine the span name to `METHOD /route` once the matched route is known.
pub fn set_route(span: &Span, method: Method, route: &[u8]) {
    if route.is_empty() || !span.stub.ctx.flags.sampled() {
        return;
    }
    let m = http::method_name(method);
    let mut name = Vec::with_capacity(m.len() + 1 + route.len());
    name.extend_from_slice(m.as_bytes());
    name.push(b' ');
    name.extend_from_slice(route);
    span.set_name(&name);
    span.set_attribute(b"http.route", &Value::Str(route), &state().limits);
}

/// Finish the request span. `status == 0` means no status line was written
/// (aborted before headers).
pub fn end(span: Span, status: u16, aborted: bool) {
    super::end_span(&span, 0, |w| {
        http::status_attrs(w, status, true);
        if aborted && status < 500 {
            w.attr("error.type", "aborted");
            w.status(StatusCode::Error, b"request aborted");
        }
    });
}

#[allow(dead_code)]
fn _assert(_: Flags, _: SpanContext) {}
