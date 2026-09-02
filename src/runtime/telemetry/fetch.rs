//! HTTP client spans for `fetch()` and the node:http client (which keeps the
//! stub on the ClientRequest between `httpClientBegin` and `httpClientEnd`).

use bun_http::Method;
use bun_http_types::ETag::Headers;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, bun_string_jsc};
use bun_telemetry::http_record::SemconvMethod;
use bun_telemetry::{Instrument, SpanKind, SpanStub, propagation};
use bun_url::URL;

use super::{local, state};

/// The request's propagation headers, as fetch (`Headers`) or node:http
/// (`NodeHeaders`) holds them.
pub trait PropagationHeaders {
    fn traceparent(&self) -> Option<&[u8]>;
    fn has_baggage(&self) -> bool;
    fn set_traceparent(&mut self, v: &[u8]);
    /// `None`: remove a caller-set tracestate (it belongs to another trace).
    fn set_tracestate(&mut self, v: Option<&[u8]>);
    fn set_baggage(&mut self, v: &[u8]);
}

impl PropagationHeaders for Headers {
    fn traceparent(&self) -> Option<&[u8]> {
        self.get(b"traceparent")
    }
    fn has_baggage(&self) -> bool {
        self.get(b"baggage").is_some()
    }
    fn set_traceparent(&mut self, v: &[u8]) {
        self.set(b"traceparent", v)
    }
    fn set_tracestate(&mut self, v: Option<&[u8]>) {
        match v {
            Some(v) => self.set(b"tracestate", v),
            None => self.remove(b"tracestate"),
        }
    }
    fn set_baggage(&mut self, v: &[u8]) {
        self.append(b"baggage", v)
    }
}

/// Start a CLIENT span for an outgoing request and inject `traceparent`
/// (+ `tracestate`, `baggage`). Returns `SpanStub::NONE` when disabled.
#[inline(always)]
pub fn begin(global: &JSGlobalObject, headers: &mut impl PropagationHeaders) -> SpanStub {
    if !bun_telemetry::enabled(Instrument::HttpClient) {
        return SpanStub::NONE;
    }
    begin_enabled(global, headers)
}

#[cold]
#[inline(never)]
fn begin_enabled(global: &JSGlobalObject, headers: &mut impl PropagationHeaders) -> SpanStub {
    let st = state();
    // Parent: the active span; failing that (manual propagation, no active
    // span) a `traceparent` the caller put on the request — which then also
    // supplies the tracestate. Either way the header is (re)written to name
    // the CLIENT span, as @opentelemetry/instrumentation-undici does.
    let active_stub = super::span::active(global);
    if active_stub.is_some_and(|s| s.ctx.flags.suppressed()) {
        return SpanStub::NONE;
    }
    let active = active_stub
        .map(|s| s.ctx)
        .filter(bun_telemetry::SpanContext::is_valid);
    if active.is_none() && !bun_telemetry::allows_root(Instrument::HttpClient) {
        // "nested": only under an active span (a caller-set header is not one).
        return SpanStub::NONE;
    }
    let from_caller = active.is_none();
    let parent_ctx = active.or_else(|| {
        headers
            .traceparent()
            .and_then(propagation::parse_traceparent)
    });
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
        headers.set_traceparent(&tp);
    }
    // tracestate rides with the traceparent (the active span's; a caller's
    // header is left as is when the caller's traceparent is the parent);
    // baggage is its own propagator (it can be active with no span, or with
    // trace context off). Values are re-validated: they may come from a JS
    // carrier and go into the request head verbatim.
    let want_tracestate = inject_traceparent && !from_caller;
    if want_tracestate || st.propagate_baggage {
        super::with_active_propagation(global, |trace_state, baggage| {
            if want_tracestate {
                if !trace_state.is_empty() && propagation::tracestate_is_reasonable(trace_state) {
                    headers.set_tracestate(Some(trace_state));
                } else {
                    // The traceparent now names our trace; a tracestate the
                    // caller set belongs to another one.
                    headers.set_tracestate(None);
                }
            }
            if st.propagate_baggage
                && !baggage.is_empty()
                && !headers.has_baggage()
                && propagation::baggage_is_reasonable(baggage)
            {
                headers.set_baggage(baggage);
            }
        });
    }
    stub
}

/// node:http's view for [`begin`]: what the caller set, and what to write
/// back (`internal/telemetry` applies it to the request).
#[derive(Default)]
pub struct NodeHeaders {
    pub caller_traceparent: Vec<u8>,
    pub caller_has_baggage: bool,
    pub traceparent: Option<[u8; propagation::TRACEPARENT_LEN]>,
    /// Some(None) = remove.
    pub tracestate: Option<Option<Vec<u8>>>,
    pub baggage: Option<Vec<u8>>,
}

impl PropagationHeaders for NodeHeaders {
    fn traceparent(&self) -> Option<&[u8]> {
        if self.caller_traceparent.is_empty() {
            None
        } else {
            Some(&self.caller_traceparent)
        }
    }
    fn has_baggage(&self) -> bool {
        self.caller_has_baggage
    }
    fn set_traceparent(&mut self, v: &[u8]) {
        let mut tp = [0u8; propagation::TRACEPARENT_LEN];
        tp.copy_from_slice(v);
        self.traceparent = Some(tp);
    }
    fn set_tracestate(&mut self, v: Option<&[u8]>) {
        self.tracestate = Some(v.map(<[u8]>::to_vec));
    }
    fn set_baggage(&mut self, v: &[u8]) {
        self.baggage = Some(v.to_vec());
    }
}

/// internal: `httpClientBegin(callerTraceparent, callerHasBaggage)` →
/// undefined (no span) or `[stub: Uint8Array, traceparent, tracestate | null
/// (remove) | undefined (leave), baggage | undefined]`.
pub fn http_client_begin(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    if !bun_telemetry::enabled(Instrument::HttpClient) {
        return Ok(JSValue::UNDEFINED);
    }
    let mut h = NodeHeaders::default();
    let tp = frame.argument(0);
    if tp.is_string() {
        h.caller_traceparent = tp.to_utf8(global)?.slice().to_vec();
    }
    h.caller_has_baggage = frame.argument(1).to_boolean();
    let stub = begin(global, &mut h);
    if !stub.is_some() {
        return Ok(JSValue::UNDEFINED);
    }
    let arr = JSValue::create_empty_array(global, 4)?;
    arr.put_index(
        global,
        0,
        bun_jsc::JSUint8Array::from_bytes_copy(global, &stub.to_bytes())?,
    )?;
    arr.put_index(
        global,
        1,
        match &h.traceparent {
            Some(tp) => bun_string_jsc::create_utf8_for_js(global, tp)?,
            None => JSValue::UNDEFINED,
        },
    )?;
    arr.put_index(
        global,
        2,
        match &h.tracestate {
            Some(Some(ts)) => bun_string_jsc::create_utf8_for_js(global, ts)?,
            Some(None) => JSValue::NULL,
            None => JSValue::UNDEFINED,
        },
    )?;
    arr.put_index(
        global,
        3,
        match &h.baggage {
            Some(b) => bun_string_jsc::create_utf8_for_js(global, b)?,
            None => JSValue::UNDEFINED,
        },
    )?;
    Ok(arr)
}

/// internal: `httpClientEnd(stub, method, url, status, httpMinor, errCode?, errMessage?)`.
pub fn http_client_end(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let Some(buf) = frame.argument(0).as_array_buffer(global) else {
        return Ok(JSValue::UNDEFINED);
    };
    let Some(stub) = SpanStub::from_bytes(buf.byte_slice()) else {
        return Ok(JSValue::UNDEFINED);
    };
    let token = frame.argument(1).to_utf8(global)?;
    let method = SemconvMethod::of(Method::which(token.slice()));
    let url = frame.argument(2).to_utf8(global)?;
    let status = frame.argument(3).as_number() as u16;
    let minor = frame.argument(4);
    let minor_version = if minor.is_number() {
        Some(minor.as_number() as u8)
    } else {
        None
    };
    let code = frame.argument(5);
    let message = frame.argument(6);
    let (code_s, msg_s);
    let error = if code.is_string() || message.is_string() {
        code_s = if code.is_string() {
            code.to_utf8(global)?
        } else {
            bun_core::Utf8Bytes::EMPTY
        };
        msg_s = if message.is_string() {
            message.to_utf8(global)?
        } else {
            bun_core::Utf8Bytes::EMPTY
        };
        Some((code_s.slice(), msg_s.slice()))
    } else {
        None
    };
    end(
        global,
        &stub,
        method,
        token.slice(),
        url.slice(),
        status,
        minor_version,
        error,
        0,
    );
    Ok(JSValue::UNDEFINED)
}

/// Finish the client span. `method_token`: the request method as sent
/// (recorded as `http.request.method_original` only when `method` is outside
/// semconv's known set). `url` is the request URL as originally given (before
/// redirects); `status == 0` means no response was received.
/// `minor_version`: HTTP/1.x minor version of the response, if one arrived.
/// `error`: the `(code, message)` the request rejected with. `end_ns == 0`
/// means now.
pub fn end(
    global: &JSGlobalObject,
    stub: &SpanStub,
    method: SemconvMethod,
    method_token: &[u8],
    url: &[u8],
    status: u16,
    minor_version: Option<u8>,
    error: Option<(&[u8], &[u8])>,
    end_ns: u64,
) {
    if !stub.is_recording() {
        return;
    }
    super::end_leaf_at(
        global,
        Instrument::HttpClient,
        stub,
        method.span_name(),
        SpanKind::Client,
        end_ns,
        |w| {
            w.attr("http.request.method", method.attr_value());
            if method.is_other() {
                w.attr("http.request.method_original", method_token);
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
