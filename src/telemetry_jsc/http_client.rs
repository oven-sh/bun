//! `fetch()`, the client of node:http, and the handshake of a WebSocket.

use bun_http_types::ETag::Headers;
use bun_http_types::Method::Method;
use bun_jsc::bindgen::{JsHeap, JsLocal};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, bun_string_jsc};
use bun_removable_features::{removable_body_behind_value, removable_definition};
use bun_telemetry::http_record::SemconvMethod;
use bun_telemetry::{Carried, Instrument, Record, SpanData, SpanKind, propagation};
use bun_url::URL;

use crate::context::{self, Binding, Parent};
use crate::native::{self, NativeSpan};
use crate::span::{Span, global_of};

pub trait RequestHeaders {
    fn get(&self, name: &'static str) -> Option<&[u8]>;
    fn set(&mut self, name: &'static str, value: &[u8]);
    fn remove(&mut self, name: &'static str);
}

impl RequestHeaders for Headers {
    fn get(&self, name: &'static str) -> Option<&[u8]> {
        Headers::get(self, name.as_bytes())
    }
    fn set(&mut self, name: &'static str, value: &[u8]) {
        Headers::set(self, name.as_bytes(), value)
    }
    fn remove(&mut self, name: &'static str) {
        Headers::remove(self, name.as_bytes())
    }
}

/// The parent is the active span, or else the `traceparent` that the caller has set. Either way the header then
/// names the new span, as with @opentelemetry/instrumentation-undici.
fn start(
    global: &JSGlobalObject,
    instrument: Instrument,
    headers: &mut dyn RequestHeaders,
) -> Option<SpanData> {
    let state = bun_telemetry::state();
    let active = context::active_binding(global);
    let binding = Binding::of(&active);
    let mut parent = native::parent_for(instrument, &binding)?;
    let has_active_parent = parent.ctx.is_some();
    if !has_active_parent && state.propagate_trace_context {
        let ctx = (headers.get("traceparent")).and_then(propagation::parse_traceparent);
        let trace_state = (headers.get("tracestate"))
            .filter(|_| ctx.is_some())
            .and_then(propagation::tracestate_bounded);
        let carried = Carried::new(trace_state.unwrap_or_default(), b"");
        parent = Parent { ctx, carried };
    }
    let has_parent = parent.ctx.is_some();
    let data = native::start_under(global, parent, instrument, SpanKind::Client)?;
    if state.propagate_trace_context {
        headers.set(
            "traceparent",
            &propagation::format_traceparent(&data.stub.ctx),
        );
        if !data.trace_state().is_empty() {
            headers.set("tracestate", data.trace_state());
        } else if has_active_parent || !has_parent {
            // It belongs to another trace.
            headers.remove("tracestate");
        }
    }
    let baggage = binding.baggage().unwrap_or_else(|| data.baggage());
    if state.propagate_baggage
        && headers.get("baggage").is_none()
        && propagation::baggage_is_reasonable(baggage)
    {
        headers.set("baggage", baggage);
    }
    Some(data)
}

/// Starts a CLIENT span and writes its context into `headers`.
#[inline(always)]
pub fn begin(
    global: &JSGlobalObject,
    instrument: Instrument,
    headers: &mut impl RequestHeaders,
) -> NativeSpan {
    #[cold]
    #[inline(never)]
    fn begin_enabled(
        global: &JSGlobalObject,
        instrument: Instrument,
        headers: &mut dyn RequestHeaders,
    ) -> NativeSpan {
        removable_definition!(Telemetry, begin_enabled);
        start(global, instrument, headers).map_or(NativeSpan::NONE, NativeSpan::if_recording)
    }
    if !bun_telemetry::enabled(instrument) {
        return NativeSpan::NONE;
    }
    begin_enabled(global, instrument, headers)
}

/// Another tracer has changed `begun`, the headers as [`begin`] left them. Of two `traceparent`s neither is valid.
pub fn drop_second_context(begun: &Headers, changed: &mut Headers) {
    if !bun_telemetry::enabled(Instrument::HttpClient) {
        return;
    }
    removable_body_behind_value!(Telemetry, {
        let count = (changed.iter())
            .filter(|header| header.name().eq_ignore_ascii_case(b"traceparent"))
            .count();
        if count > 1
            && bun_telemetry::state().propagate_trace_context
            && let Some(traceparent) = begun.get(b"traceparent")
        {
            changed.set(b"traceparent", traceparent);
            match begun.get(b"tracestate") {
                Some(trace_state) => changed.set(b"tracestate", trace_state),
                None => changed.remove(b"tracestate"),
            }
        }
    })
}

pub struct Exchange<'a> {
    pub method: &'a [u8],
    /// As it was given, before any redirect.
    pub url: &'a [u8],
    /// 0 without a response.
    pub status: u16,
    pub protocol_version: &'a [u8],
}

impl Exchange<'_> {
    pub fn record(&self, r: &mut Record) {
        let method = SemconvMethod::of(Method::which(self.method));
        r.set_name(method.span_name());
        r.attr("http.request.method", method.attr_value());
        if method.is_other() {
            r.attr("http.request.method_original", self.method);
        }
        let url = URL::parse(self.url);
        r.url(self.url)
            .server(url.display_hostname(), url.get_port_auto())
            .attr_opt("network.protocol.version", self.protocol_version);
        if self.status != 0 {
            r.attr("http.response.status_code", self.status);
        }
        if self.status >= 400 {
            let mut digits = bun_core::fmt::ItoaBuf::new();
            r.error(bun_core::fmt::itoa(&mut digits, self.status), b"");
        }
    }
}

pub(crate) fn node_enabled(heap: &JsHeap<'_>) -> bool {
    bun_telemetry::enabled(Instrument::HttpClient)
        && removable_body_behind_value!(Telemetry, {
            let active = context::active_binding(global_of(heap));
            native::parent_for(Instrument::HttpClient, &Binding::of(&active)).is_some()
        })
}

/// The span, then `name, value` for each header to set, with `null` for one to remove.
pub(crate) fn node_begin<'a>(
    heap: &JsHeap<'a>,
    traceparent: Option<&[u8]>,
    tracestate: Option<&[u8]>,
    has_baggage: bool,
) -> JsResult<JSValue> {
    struct Changes<'h> {
        given: [(&'static str, Option<&'h [u8]>); 3],
        changes: Vec<(&'static str, Option<Vec<u8>>)>,
    }
    impl RequestHeaders for Changes<'_> {
        fn get(&self, name: &'static str) -> Option<&[u8]> {
            self.given.iter().find(|(given, _)| *given == name)?.1
        }
        fn set(&mut self, name: &'static str, value: &[u8]) {
            self.changes.push((name, Some(value.to_vec())));
        }
        fn remove(&mut self, name: &'static str) {
            self.changes.push((name, None));
        }
    }
    removable_body_behind_value!(Telemetry, {
        let global = global_of(heap);
        let mut headers = Changes {
            given: [
                ("traceparent", traceparent),
                ("tracestate", tracestate),
                ("baggage", has_baggage.then_some(b"")),
            ],
            changes: Vec::new(),
        };
        let Some(data) = start(global, Instrument::HttpClient, &mut headers) else {
            return Ok(JSValue::UNDEFINED);
        };
        let result = JSValue::create_array_from_slice(global, &[Span::create(global, data, None)])?;
        for (name, value) in headers.changes {
            let string = |s: &[u8]| bun_string_jsc::create_utf8_for_js(global, s);
            result.push(global, string(name.as_bytes())?)?;
            result.push(global, value.map_or(Ok(JSValue::NULL), |v| string(&v))?)?;
        }
        Ok(result)
    })
}

pub(crate) fn node_end<'a>(
    heap: &JsHeap<'a>,
    (span, span_value): (&Span, JsLocal<'a>),
    method: &[u8],
    url: &[u8],
    status: Option<f64>,
    http_version: Option<&[u8]>,
    error: JsLocal<'a>,
) {
    removable_body_behind_value!(Telemetry, {
        let global = global_of(heap);
        let exchange = Exchange {
            method,
            url,
            status: status.unwrap_or(0.0) as u16,
            protocol_version: http_version.unwrap_or_default(),
        };
        span.record(|r| exchange.record(r));
        if !error.is_undefined() {
            span.fail_in_passing(global, error.to_js());
        }
        span.finish(global, span_value.to_js(), 0);
    })
}
