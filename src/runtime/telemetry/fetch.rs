//! HTTP client spans for `fetch()` (and node:http, which is built on it).

use bun_http::Method;
use bun_http_types::ETag::Headers;
use bun_jsc::JSGlobalObject;
use bun_telemetry::{Instrument, SpanKind, SpanStub, propagation};
use bun_url::URL;

use super::{local, state};

/// Start a CLIENT span for an outgoing request and inject `traceparent`
/// (+ `tracestate` / `baggage`) into `headers` unless the caller already set
/// one. Returns `SpanStub::NONE` when disabled.
pub fn begin(global: &JSGlobalObject, headers: &mut Headers) -> SpanStub {
    if !bun_telemetry::enabled(Instrument::HttpClient) {
        return SpanStub::NONE;
    }
    let st = state();
    // Parent: the active span; failing that (manual propagation, no active
    // span) a `traceparent` the caller put on the request — which then also
    // supplies the tracestate. Either way the header is (re)written to name
    // the CLIENT span, as @opentelemetry/instrumentation-undici does.
    let active_stub = super::span::active(global);
    if active_stub.is_some_and(|s| s.ctx.flags.suppressed()) {
        return SpanStub::NONE;
    }
    let active = active_stub.map(|s| s.ctx).filter(bun_telemetry::SpanContext::is_valid);
    if active.is_none() && !bun_telemetry::allows_root(Instrument::HttpClient) {
        // "nested": only under an active span (a caller-set header is not one).
        return SpanStub::NONE;
    }
    let from_caller = active.is_none();
    let parent_ctx = active.or_else(|| headers.get(b"traceparent").and_then(propagation::parse_traceparent));
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
    let inject_traceparent = st.propagate_trace_context;
    if inject_traceparent {
        let mut tp = [0u8; propagation::TRACEPARENT_LEN];
        propagation::format_traceparent(&stub.ctx, &mut tp);
        headers.set(b"traceparent", &tp);
    }
    // tracestate rides with the traceparent (the active span's; a caller's
    // header is left as is); baggage is its own propagator (it can be active
    // with no span, or with trace context off). Values are re-validated: they
    // may come from a JS carrier and go into the request head verbatim.
    let want_tracestate = inject_traceparent && !from_caller;
    if want_tracestate || st.propagate_baggage {
        super::with_active_propagation(global, |trace_state, baggage| {
            if want_tracestate {
                if !trace_state.is_empty() && propagation::tracestate_is_reasonable(trace_state) {
                    headers.set(b"tracestate", trace_state);
                }
            }
            if st.propagate_baggage
                && !baggage.is_empty()
                && headers.get(b"baggage").is_none()
                && propagation::baggage_is_reasonable(baggage)
            {
                headers.append(b"baggage", baggage);
            }
        });
    }
    stub
}

/// Finish the client span. `url` is the request URL as originally given
/// (before redirects); `status == 0` means no response was received.
/// `minor_version`: HTTP/1.x minor version of the response, if one arrived.
/// `error`: the `(code, message)` the request rejected with.
pub fn end(
    global: &JSGlobalObject,
    stub: &SpanStub,
    method: Method,
    url: &[u8],
    status: u16,
    minor_version: Option<u8>,
    error: Option<(&[u8], &[u8])>,
) {
    if !stub.is_recording() {
        return;
    }
    let name = bun_telemetry::http_record::method_name(method);
    super::end_leaf(
        global,
        Instrument::HttpClient,
        stub,
        // semconv: `HTTP` names a span whose method is outside the known set.
        if name == "_OTHER" {
            b"HTTP"
        } else {
            name.as_bytes()
        },
        SpanKind::Client,
        |w| {
            w.attr("http.request.method", name);
            if name == "_OTHER" {
                w.attr("http.request.method_original", method.as_str());
            }
            let u = URL::parse(url);
            // url.full MUST NOT contain credentials. (`bun_url` does not
            // recognise a bare `user@host`, so scan the authority directly.)
            let scheme_end = bun_core::strings::index_of(url, b"://")
                .map(|i| i + 3)
                .unwrap_or(0);
            let authority_end = bun_core::strings::index_of_any(&url[scheme_end..], b"/?#")
                .map(|i| i + scheme_end)
                .unwrap_or(url.len());
            // …nor credential-bearing query values (presigned URLs).
            let url_q = bun_telemetry::otlp::redact_url(url);
            let url: &[u8] = &url_q;
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
            w.server(u.display_hostname(), u.get_port_auto());
            if let Some(v) = minor_version {
                w.attr(
                    "network.protocol.version",
                    if v == 0 { "1.0" } else { "1.1" },
                );
            }
            if let Some((code, message)) = error {
                // The transport error is the outcome; a status that arrived
                // before it is recorded without its own error.type/status.
                if status != 0 {
                    w.attr("http.response.status_code", status);
                }
                w.fail(code, message);
            } else {
                w.http_client_status(status);
            }
        },
    );
}
