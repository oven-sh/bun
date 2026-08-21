//! HTTP server spans for Bun.serve and node:http.

use bun_http::Method;
use bun_jsc::JSGlobalObject;
use bun_telemetry::http_record as R;
use bun_telemetry::pool::{self, NativeSpan};
use bun_telemetry::{Instrument, ScopeId, SpanKind, SpanStub, Value, clock, propagation};

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
    let stub = SpanStub::start(parent.as_ref(), &st.sampler, now);
    let method_name = http::method_name(method).as_bytes();
    let span = pool::begin(stub, ScopeId::from(Instrument::HttpServer), b"", SpanKind::Server);
    let baggage = if st.propagate_baggage {
        h.baggage().filter(|b| propagation::baggage_is_reasonable(b))
    } else {
        None
    };
    // Facts only; attributes are encoded when the batch is exported
    // (bun_telemetry::http_record).
    pool::with(span, |s| {
        if !trace_state.is_empty() {
            s.trace_state.extend_from_slice(trace_state);
        }
        if let Some(b) = baggage {
            s.baggage.extend_from_slice(b);
        }
        let f = &mut s.http;
        f.active = true;
        f.set_method(method_name);
        if !stub.ctx.flags.sampled() {
            return;
        }
        f.flags = if is_https { R::FLAG_HTTPS } else { 0 };
        if let Some((ip, port)) = resp.get_remote_address_raw() {
            let raw = ip.bytes();
            f.ip_len = raw.len() as u8;
            f.ip[..raw.len()].copy_from_slice(raw);
            f.client_port = port;
        }
        let url = req.url();
        let host = h.host().unwrap_or(b"");
        let ua = h.user_agent().unwrap_or(b"");
        f.raw.reserve(9 + url.len() + host.len() + ua.len());
        f.push(R::S_URL, url);
        if !host.is_empty() {
            f.push(R::S_HOST, host);
        }
        if !ua.is_empty() {
            f.push(R::S_UA, ua);
        }
        if !st.capture_request_headers.is_empty() {
            let l = &st.limits;
            for name in &st.capture_request_headers {
                if let Some(v) = req.header(name) {
                    let mut key = Vec::with_capacity(20 + name.len());
                    key.extend_from_slice(b"http.request.header.");
                    key.extend_from_slice(name);
                    s.push_attribute(&key, &Value::Str(v), l);
                }
            }
        }
    });
    Some((span, Entered::new(global, super::native_context_value(span))))
}

/// Refine the span name to `METHOD /route` once the matched route is known.
pub fn set_route(span: NativeSpan, _method: Method, route: &[u8]) {
    if route.is_empty() {
        return;
    }
    pool::with(span, |s| {
        if s.stub.ctx.flags.sampled() {
            s.http.push(R::S_ROUTE, route);
        }
    });
}

/// Finish the request span. `status == 0` means no status line was written
/// (aborted before headers).
pub fn end(span: NativeSpan, status: u16, aborted: bool) {
    end_with(span, status, aborted, false)
}

/// `handler_error`: the JS handler threw or rejected (node:http), which is an
/// error even when the status line that went out was not 5xx.
pub fn end_with(span: NativeSpan, status: u16, aborted: bool, handler_error: bool) {
    pool::with(span, |s| {
        s.http.status = status;
        if aborted {
            s.http.flags |= R::FLAG_ABORTED;
        }
        if handler_error {
            s.http.flags |= R::FLAG_HANDLER_ERROR;
        }
    });
    super::end_native(span, 0, |_| {});
}
