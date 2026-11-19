//! An OTLP request as JS objects.

use bun_jsc::bindgen::JsScope;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, bun_string_jsc};
use bun_telemetry_cold::decode::{self, AnyValue, KeyValue, Repeated, Scope, Span, TraceRequest};

#[allow(clippy::needless_pass_by_value, reason = "the schema asks for a copy")]
pub(crate) fn decode(cx: &mut JsScope<'_>, request: Vec<u8>) -> JsResult<JSValue> {
    decode_to_js(cx.global(), &request)
}

fn str_js(global: &JSGlobalObject, s: &[u8]) -> JsResult<JSValue> {
    bun_string_jsc::create_utf8_for_js(global, s)
}

fn hex_js(global: &JSGlobalObject, id: &[u8]) -> JsResult<JSValue> {
    let mut buf = [0u8; 64];
    str_js(global, decode::hex_id(id, &mut buf))
}

/// Epoch milliseconds, split to keep sub-microsecond precision in the f64.
fn ns_to_ms_js(ns: u64) -> JSValue {
    JSValue::js_number((ns / 1_000_000) as f64 + (ns % 1_000_000) as f64 / 1_000_000.0)
}

fn any_value_to_js(global: &JSGlobalObject, v: AnyValue<'_>) -> JsResult<JSValue> {
    Ok(match v {
        AnyValue::Empty => JSValue::UNDEFINED,
        AnyValue::String(s) => str_js(global, s)?,
        AnyValue::Bool(b) => JSValue::from(b),
        AnyValue::Int(i) => JSValue::js_number(i as f64),
        AnyValue::Double(d) => JSValue::js_number(JSValue::purify_nan(d)),
        AnyValue::Bytes(b) => bun_jsc::JSUint8Array::from_bytes_copy(global, b)?,
        AnyValue::Array(items) => {
            let arr = JSValue::create_empty_array(global, 0)?;
            for item in items {
                arr.push(global, any_value_to_js(global, item)?)?;
            }
            arr
        }
        AnyValue::KvList(items) => attributes_to_js(global, items)?,
    })
}

fn attributes_to_js<'a>(
    global: &JSGlobalObject,
    attrs: Repeated<'a, KeyValue<'a>>,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 0);
    for kv in attrs {
        let key = bun_core::StringView::borrow_utf8(kv.key);
        obj.put_may_be_index(global, &key, any_value_to_js(global, kv.value)?)?;
    }
    Ok(obj)
}

/// Atomized once per batch.
struct Keys {
    trace_id: bun_core::String,
    span_id: bun_core::String,
    parent_span_id: bun_core::String,
    name: bun_core::String,
    kind: bun_core::String,
    start_time: bun_core::String,
    end_time: bun_core::String,
    attributes: bun_core::String,
    events: bun_core::String,
    links: bun_core::String,
    status: bun_core::String,
    trace_flags: bun_core::String,
    trace_state: bun_core::String,
    dropped_attributes_count: bun_core::String,
    dropped_events_count: bun_core::String,
    dropped_links_count: bun_core::String,
    scope: bun_core::String,
    resource: bun_core::String,
    time: bun_core::String,
    flags: bun_core::String,
    code: bun_core::String,
    message: bun_core::String,
    version: bun_core::String,
}

impl Keys {
    fn new() -> Self {
        let atom = bun_core::String::create_atom;
        Keys {
            trace_id: atom(b"traceId"),
            span_id: atom(b"spanId"),
            parent_span_id: atom(b"parentSpanId"),
            name: atom(b"name"),
            kind: atom(b"kind"),
            start_time: atom(b"startTime"),
            end_time: atom(b"endTime"),
            attributes: atom(b"attributes"),
            events: atom(b"events"),
            links: atom(b"links"),
            status: atom(b"status"),
            trace_flags: atom(b"traceFlags"),
            trace_state: atom(b"traceState"),
            dropped_attributes_count: atom(b"droppedAttributesCount"),
            dropped_events_count: atom(b"droppedEventsCount"),
            dropped_links_count: atom(b"droppedLinksCount"),
            scope: atom(b"scope"),
            resource: atom(b"resource"),
            time: atom(b"time"),
            flags: atom(b"flags"),
            code: atom(b"code"),
            message: atom(b"message"),
            version: atom(b"version"),
        }
    }
}

fn scope_to_js(global: &JSGlobalObject, k: &Keys, scope: Option<&Scope<'_>>) -> JsResult<JSValue> {
    let o = JSValue::create_empty_object(global, 2);
    let (name, version) = scope.map_or((&b""[..], &b""[..]), |s| (s.name, s.version));
    o.put(global, &k.name, str_js(global, name)?);
    if !version.is_empty() {
        o.put(global, &k.version, str_js(global, version)?);
    }
    Ok(o)
}

fn span_to_js(
    global: &JSGlobalObject,
    k: &Keys,
    span: &Span<'_>,
    scope: JSValue,
    resource: JSValue,
) -> JsResult<JSValue> {
    let o = JSValue::create_empty_object(global, 14);
    o.put(global, &k.trace_id, hex_js(global, span.trace_id)?);
    o.put(global, &k.span_id, hex_js(global, span.span_id)?);
    o.put(
        global,
        &k.parent_span_id,
        if span.parent_span_id.is_empty() {
            JSValue::UNDEFINED
        } else {
            hex_js(global, span.parent_span_id)?
        },
    );
    o.put(global, &k.name, str_js(global, span.name)?);
    let kind = bun_telemetry::SpanKind::from_otlp(u8::try_from(span.kind).unwrap_or(0));
    o.put(
        global,
        &k.kind,
        JSValue::js_number_from_int32(kind.to_api() as i32),
    );
    o.put(global, &k.start_time, ns_to_ms_js(span.start_time_ns));
    o.put(global, &k.end_time, ns_to_ms_js(span.end_time_ns));
    o.put(
        global,
        &k.attributes,
        attributes_to_js(global, span.attributes())?,
    );

    let events = JSValue::create_empty_array(global, 0)?;
    for ev in span.events() {
        let e = JSValue::create_empty_object(global, 3);
        e.put(global, &k.time, ns_to_ms_js(ev.time_ns));
        e.put(global, &k.name, str_js(global, ev.name)?);
        e.put(
            global,
            &k.attributes,
            attributes_to_js(global, ev.attributes())?,
        );
        events.push(global, e)?;
    }
    o.put(global, &k.events, events);

    let links = JSValue::create_empty_array(global, 0)?;
    for link in span.links() {
        let l = JSValue::create_empty_object(global, 5);
        l.put(global, &k.trace_id, hex_js(global, link.trace_id)?);
        l.put(global, &k.span_id, hex_js(global, link.span_id)?);
        l.put(global, &k.flags, JSValue::js_number(link.flags as f64));
        if !link.trace_state.is_empty() {
            l.put(global, &k.trace_state, str_js(global, link.trace_state)?);
        }
        l.put(
            global,
            &k.attributes,
            attributes_to_js(global, link.attributes())?,
        );
        links.push(global, l)?;
    }
    o.put(global, &k.links, links);

    let status = JSValue::create_empty_object(global, 2);
    status.put(
        global,
        &k.code,
        JSValue::js_number_from_int32(span.status.code as i32),
    );
    if !span.status.message.is_empty() {
        status.put(global, &k.message, str_js(global, span.status.message)?);
    }
    o.put(global, &k.status, status);
    o.put(
        global,
        &k.trace_flags,
        JSValue::js_number_from_int32((span.flags & 0xff) as i32),
    );
    if !span.trace_state.is_empty() {
        o.put(global, &k.trace_state, str_js(global, span.trace_state)?);
    }
    for (key, count) in [
        (&k.dropped_attributes_count, span.dropped_attributes_count),
        (&k.dropped_events_count, span.dropped_events_count),
        (&k.dropped_links_count, span.dropped_links_count),
    ] {
        if count != 0 {
            o.put(global, key, JSValue::js_number_from_int32(count as i32));
        }
    }
    o.put(global, &k.scope, scope);
    o.put(global, &k.resource, resource);
    Ok(o)
}

/// `Bun.otel.ExportedSpan[]`
#[optimize(size)]
pub(crate) fn decode_to_js(global: &JSGlobalObject, request: &[u8]) -> JsResult<JSValue> {
    let k = Keys::new();
    let out = JSValue::create_empty_array(global, 0)?;
    for rs in TraceRequest::new(request).resource_spans() {
        let resource = match &rs.resource {
            Some(r) => {
                let o = JSValue::create_empty_object(global, 1);
                o.put(
                    global,
                    &k.attributes,
                    attributes_to_js(global, r.attributes())?,
                );
                o
            }
            None => JSValue::UNDEFINED,
        };
        for ss in rs.scope_spans() {
            let scope = scope_to_js(global, &k, ss.scope.as_ref())?;
            for span in ss.spans() {
                out.push(global, span_to_js(global, &k, &span, scope, resource)?)?;
            }
        }
    }
    Ok(out)
}
