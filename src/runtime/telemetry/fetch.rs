//! HTTP client spans for `fetch()` (and node:http, which is built on it).

use bun_http::Method;
use bun_http_types::ETag::Headers;
use bun_jsc::JSGlobalObject;
use bun_telemetry::{Instrument, SpanKind, SpanStub, propagation};
use bun_url::URL;

use super::{http, local, state};

/// Start a CLIENT span for an outgoing request and inject `traceparent`
/// (+ `tracestate` / `baggage`) into `headers` unless the caller already set
/// one. Returns `SpanStub::NONE` when disabled.
pub fn begin(global: &JSGlobalObject, headers: &mut Headers) -> SpanStub {
    if !bun_telemetry::enabled(Instrument::HttpClient) {
        return SpanStub::NONE;
    }
    let st = state();
    let parent_ctx = super::active_context(global);
    if parent_ctx.is_none() && !bun_telemetry::allows_root(Instrument::HttpClient) {
        return SpanStub::NONE;
    }
    let Some(mut l) = local(global) else {
        return SpanStub::NONE;
    };
    let stub = SpanStub::start(
        &mut l.rng,
        parent_ctx.as_ref(),
        &st.sampler,
        bun_telemetry::clock::now_unix_nanos(),
    );
    drop(l);
    if st.propagate_trace_context && headers.get(b"traceparent").is_none() {
        let mut tp = [0u8; propagation::TRACEPARENT_LEN];
        propagation::format_traceparent(&stub.ctx, &mut tp);
        headers.append(b"traceparent", &tp);
        if parent_ctx.is_some() {
            super::with_active_propagation(global, |trace_state, baggage| {
                if !trace_state.is_empty() && headers.get(b"tracestate").is_none() {
                    headers.append(b"tracestate", trace_state);
                }
                if st.propagate_baggage && !baggage.is_empty() && headers.get(b"baggage").is_none()
                {
                    headers.append(b"baggage", baggage);
                }
            });
        }
    }
    stub
}

/// Finish the client span. `url` is the request URL as originally given
/// (before redirects); `status == 0` means no response was received.
pub fn end(
    global: &JSGlobalObject,
    stub: &SpanStub,
    method: Method,
    url: &[u8],
    status: u16,
    error: Option<&str>,
) {
    if !stub.is_recording() {
        return;
    }
    let name = http::method_name(method);
    super::end_leaf(
        global,
        Instrument::HttpClient,
        stub,
        name.as_bytes(),
        SpanKind::Client,
        |w| {
            w.attr("http.request.method", name);
            let u = URL::parse(url);
            // url.full MUST NOT contain credentials.
            let scheme_end = bun_core::strings::index_of(url, b"://")
                .map(|i| i + 3)
                .unwrap_or(0);
            let authority_end = bun_core::strings::index_of_any(&url[scheme_end..], b"/?#")
                .map(|i| i + scheme_end)
                .unwrap_or(url.len());
            match bun_core::strings::last_index_of_char(&url[scheme_end..authority_end], b'@') {
                None => {
                    w.attr("url.full", url);
                }
                Some(at) => {
                    let mut redacted = Vec::with_capacity(url.len());
                    redacted.extend_from_slice(&url[..scheme_end]);
                    redacted.extend_from_slice(b"REDACTED:REDACTED");
                    redacted.extend_from_slice(&url[scheme_end + at..]);
                    w.attr("url.full", &redacted[..]);
                }
            }
            w.attr_opt("server.address", u.display_hostname());
            let port = u.get_port_auto();
            if port != 0 {
                w.attr("server.port", port);
            }
            http::status_attrs(w, status, false);
            if let Some(e) = error {
                w.error(e.as_bytes(), e.as_bytes());
            }
        },
    );
}
