//! OTLP/JSON rendering of an encoded `ExportTraceServiceRequest`, per the
//! OTLP spec's JSON mapping: lowerCamelCase field names, trace/span ids as
//! hex strings, 64-bit integers as decimal strings, enums as integers, and
//! proto3 defaults omitted.

use crate::decode::{
    AnyValue, Event, KeyValue, Link, Repeated, ResourceSpans, ScopeSpans, Span, TraceRequest,
};

/// `ExportTraceServiceRequest` protobuf → OTLP/JSON bytes.
#[cold]
#[inline(never)]
pub fn to_json(request: &[u8]) -> Vec<u8> {
    let mut w = Json {
        out: Vec::with_capacity(request.len() * 3),
    };
    let mut obj = w.object();
    w.array(
        &mut obj,
        "resourceSpans",
        TraceRequest::new(request).resource_spans(),
        resource_spans,
    );
    w.end(obj);
    w.out
}

struct Json {
    out: Vec<u8>,
}

/// An open `{ ... }`; tracks whether the next key needs a comma.
struct Object {
    first: bool,
}

impl Json {
    fn object(&mut self) -> Object {
        self.out.push(b'{');
        Object { first: true }
    }
    fn end(&mut self, _obj: Object) {
        self.out.push(b'}');
    }
    fn key(&mut self, obj: &mut Object, name: &str) {
        if !obj.first {
            self.out.push(b',');
        }
        obj.first = false;
        self.out.push(b'"');
        self.out.extend_from_slice(name.as_bytes());
        self.out.extend_from_slice(b"\":");
    }

    fn str(&mut self, s: &[u8]) {
        let s = bstr::ByteSlice::to_str_lossy(s);
        let _ = bun_core::fmt::encode_json_string(
            &mut bun_core::fmt::VecWriter(&mut self.out),
            s.as_bytes(),
        );
    }
    fn hex(&mut self, id: &[u8]) {
        let mut buf = [0u8; 64];
        self.out.push(b'"');
        self.out
            .extend_from_slice(crate::decode::hex_id(id, &mut buf));
        self.out.push(b'"');
    }
    fn base64(&mut self, data: &[u8]) {
        self.out.push(b'"');
        bun_base64::encode_append(&mut self.out, data);
        self.out.push(b'"');
    }
    fn quoted(&mut self, v: impl core::fmt::Display) {
        self.out.push(b'"');
        self.display(v);
        self.out.push(b'"');
    }
    fn display(&mut self, v: impl core::fmt::Display) {
        use std::io::Write;
        let _ = write!(&mut self.out, "{v}");
    }

    fn str_field(&mut self, obj: &mut Object, name: &str, s: &[u8]) {
        if !s.is_empty() {
            self.key(obj, name);
            self.str(s);
        }
    }
    fn hex_field(&mut self, obj: &mut Object, name: &str, id: &[u8]) {
        if !id.is_empty() {
            self.key(obj, name);
            self.hex(id);
        }
    }
    fn u32_field(&mut self, obj: &mut Object, name: &str, v: u32) {
        if v != 0 {
            self.key(obj, name);
            self.display(v);
        }
    }
    fn u64_field(&mut self, obj: &mut Object, name: &str, v: u64) {
        if v != 0 {
            self.key(obj, name);
            self.quoted(v);
        }
    }
    /// `"name":[ ... ]`, omitted when `items` is empty.
    fn array<'a, T: crate::decode::Message<'a>>(
        &mut self,
        obj: &mut Object,
        name: &str,
        items: Repeated<'a, T>,
        mut each: impl FnMut(&mut Json, &T),
    ) {
        let mut items = items.into_iter().peekable();
        if items.peek().is_none() {
            return;
        }
        self.key(obj, name);
        self.out.push(b'[');
        for (i, item) in items.enumerate() {
            if i != 0 {
                self.out.push(b',');
            }
            each(self, &item);
        }
        self.out.push(b']');
    }
    fn attributes<'a>(&mut self, obj: &mut Object, attrs: Repeated<'a, KeyValue<'a>>) {
        self.array(obj, "attributes", attrs, key_value);
    }
}

fn resource_spans(w: &mut Json, rs: &ResourceSpans<'_>) {
    let mut obj = w.object();
    if let Some(resource) = &rs.resource {
        w.key(&mut obj, "resource");
        let mut r = w.object();
        w.attributes(&mut r, resource.attributes());
        w.end(r);
    }
    w.str_field(&mut obj, "schemaUrl", rs.schema_url);
    w.array(&mut obj, "scopeSpans", rs.scope_spans(), scope_spans);
    w.end(obj);
}

fn scope_spans(w: &mut Json, ss: &ScopeSpans<'_>) {
    let mut obj = w.object();
    if let Some(scope) = &ss.scope {
        w.key(&mut obj, "scope");
        let mut s = w.object();
        w.str_field(&mut s, "name", scope.name);
        w.str_field(&mut s, "version", scope.version);
        w.attributes(&mut s, scope.attributes());
        w.end(s);
    }
    w.str_field(&mut obj, "schemaUrl", ss.schema_url);
    w.array(&mut obj, "spans", ss.spans(), span);
    w.end(obj);
}

fn span(w: &mut Json, s: &Span<'_>) {
    let mut obj = w.object();
    w.hex_field(&mut obj, "traceId", s.trace_id);
    w.hex_field(&mut obj, "spanId", s.span_id);
    w.str_field(&mut obj, "traceState", s.trace_state);
    w.hex_field(&mut obj, "parentSpanId", s.parent_span_id);
    w.str_field(&mut obj, "name", s.name);
    w.u32_field(&mut obj, "kind", s.kind);
    w.u64_field(&mut obj, "startTimeUnixNano", s.start_time_ns);
    w.u64_field(&mut obj, "endTimeUnixNano", s.end_time_ns);
    w.attributes(&mut obj, s.attributes());
    w.u32_field(
        &mut obj,
        "droppedAttributesCount",
        s.dropped_attributes_count,
    );
    w.array(&mut obj, "events", s.events(), event);
    w.u32_field(&mut obj, "droppedEventsCount", s.dropped_events_count);
    w.array(&mut obj, "links", s.links(), link);
    w.u32_field(&mut obj, "droppedLinksCount", s.dropped_links_count);
    if s.status.is_set() {
        w.key(&mut obj, "status");
        let mut st = w.object();
        w.str_field(&mut st, "message", s.status.message);
        w.u32_field(&mut st, "code", s.status.code);
        w.end(st);
    }
    w.u32_field(&mut obj, "flags", s.flags);
    w.end(obj);
}

fn event(w: &mut Json, e: &Event<'_>) {
    let mut obj = w.object();
    w.u64_field(&mut obj, "timeUnixNano", e.time_ns);
    w.str_field(&mut obj, "name", e.name);
    w.attributes(&mut obj, e.attributes());
    w.u32_field(
        &mut obj,
        "droppedAttributesCount",
        e.dropped_attributes_count,
    );
    w.end(obj);
}

fn link(w: &mut Json, l: &Link<'_>) {
    let mut obj = w.object();
    w.hex_field(&mut obj, "traceId", l.trace_id);
    w.hex_field(&mut obj, "spanId", l.span_id);
    w.str_field(&mut obj, "traceState", l.trace_state);
    w.attributes(&mut obj, l.attributes());
    w.u32_field(
        &mut obj,
        "droppedAttributesCount",
        l.dropped_attributes_count,
    );
    w.u32_field(&mut obj, "flags", l.flags);
    w.end(obj);
}

fn key_value(w: &mut Json, kv: &KeyValue<'_>) {
    let mut obj = w.object();
    w.key(&mut obj, "key");
    w.str(kv.key);
    w.key(&mut obj, "value");
    any_value(w, &kv.value);
    w.end(obj);
}

fn any_value(w: &mut Json, v: &AnyValue<'_>) {
    let mut obj = w.object();
    match *v {
        AnyValue::Empty => {}
        AnyValue::String(s) => {
            w.key(&mut obj, "stringValue");
            w.str(s);
        }
        AnyValue::Bool(b) => {
            w.key(&mut obj, "boolValue");
            w.display(b);
        }
        AnyValue::Int(i) => {
            w.key(&mut obj, "intValue");
            w.quoted(i);
        }
        AnyValue::Double(d) => {
            w.key(&mut obj, "doubleValue");
            if d.is_finite() {
                w.display(d);
            } else if d.is_nan() {
                w.quoted("NaN");
            } else if d > 0.0 {
                w.quoted("Infinity");
            } else {
                w.quoted("-Infinity");
            }
        }
        AnyValue::Array(items) => {
            w.key(&mut obj, "arrayValue");
            let mut arr = w.object();
            w.array(&mut arr, "values", items, any_value);
            w.end(arr);
        }
        AnyValue::KvList(items) => {
            w.key(&mut obj, "kvlistValue");
            let mut list = w.object();
            w.array(&mut list, "values", items, key_value);
            w.end(list);
        }
        AnyValue::Bytes(b) => {
            w.key(&mut obj, "bytesValue");
            w.base64(b);
        }
    }
    w.end(obj);
}
