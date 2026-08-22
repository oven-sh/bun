//! OTLP/JSON transcoding of an encoded `ExportTraceServiceRequest`, per the
//! OTLP spec's JSON mapping: lowerCamelCase field names, trace/span ids as
//! hex strings, int64/fixed64 as decimal strings, enums as integers.

use crate::otlp::field as f;
use crate::proto::{Reader, Value};

struct W {
    out: Vec<u8>,
}

impl W {
    fn str(&mut self, s: &[u8]) {
        let s = bstr::ByteSlice::to_str_lossy(s);
        let _ = bun_core::fmt::encode_json_string(
            &mut bun_core::fmt::VecWriter(&mut self.out),
            s.as_bytes(),
        );
    }
    fn hex(&mut self, b: &[u8]) {
        let at = self.out.len() + 1;
        self.out.resize(at + b.len() * 2 + 1, b'"');
        bun_core::fmt::bytes_to_hex_lower(b, &mut self.out[at..at + b.len() * 2]);
    }
    fn u64s(&mut self, v: u64) {
        self.out.push(b'"');
        self.out.extend_from_slice(v.to_string().as_bytes());
        self.out.push(b'"');
    }
    fn i64s(&mut self, v: i64) {
        self.out.push(b'"');
        self.out.extend_from_slice(v.to_string().as_bytes());
        self.out.push(b'"');
    }
    fn num(&mut self, v: u64) {
        self.out.extend_from_slice(v.to_string().as_bytes());
    }
    fn raw(&mut self, s: &str) {
        self.out.extend_from_slice(s.as_bytes());
    }
    fn key(&mut self, first: &mut bool, name: &str) {
        if !*first {
            self.out.push(b',');
        }
        *first = false;
        self.out.push(b'"');
        self.out.extend_from_slice(name.as_bytes());
        self.out.extend_from_slice(b"\":");
    }
    /// Emit `"name":[ ... ]` for every occurrence of `field` in `body`.
    fn repeated(
        &mut self,
        first: &mut bool,
        body: &[u8],
        field: u32,
        name: &str,
        mut each: impl FnMut(&mut W, Value<'_>),
    ) {
        let mut r = Reader::new(body);
        let mut opened = false;
        while let Ok(Some((fl, v))) = r.next() {
            if fl != field {
                continue;
            }
            if !opened {
                self.key(first, name);
                self.out.push(b'[');
                opened = true;
            } else {
                self.out.push(b',');
            }
            each(self, v);
        }
        if opened {
            self.out.push(b']');
        }
    }
}

fn any_value(w: &mut W, body: &[u8]) {
    w.out.push(b'{');
    let mut r = Reader::new(body);
    // AnyValue is a oneof; emit the last one present.
    let mut last = None;
    while let Ok(Some((fl, v))) = r.next() {
        last = Some((fl, v));
    }
    if let Some((fl, v)) = last {
        match fl {
            f::AV_STRING => {
                w.raw("\"stringValue\":");
                w.str(v.as_bytes());
            }
            f::AV_BOOL => {
                w.raw("\"boolValue\":");
                w.raw(if v.as_u64() != 0 { "true" } else { "false" });
            }
            f::AV_INT => {
                w.raw("\"intValue\":");
                w.i64s(v.as_u64() as i64);
            }
            f::AV_DOUBLE => {
                w.raw("\"doubleValue\":");
                let d = v.as_f64();
                if d.is_finite() {
                    w.out.extend_from_slice(format!("{d}").as_bytes());
                } else if d.is_nan() {
                    w.raw("\"NaN\"");
                } else if d > 0.0 {
                    w.raw("\"Infinity\"");
                } else {
                    w.raw("\"-Infinity\"");
                }
            }
            f::AV_ARRAY => {
                w.raw("\"arrayValue\":{");
                let mut first = true;
                w.repeated(
                    &mut first,
                    v.as_bytes(),
                    f::ARR_VALUES,
                    "values",
                    |w, item| any_value(w, item.as_bytes()),
                );
                w.out.push(b'}');
            }
            f::AV_KVLIST => {
                w.raw("\"kvlistValue\":{");
                let mut first = true;
                w.repeated(
                    &mut first,
                    v.as_bytes(),
                    f::KVLIST_VALUES,
                    "values",
                    |w, item| key_value(w, item.as_bytes()),
                );
                w.out.push(b'}');
            }
            f::AV_BYTES => {
                w.raw("\"bytesValue\":\"");
                let data = v.as_bytes();
                let at = w.out.len();
                w.out.resize(at + bun_core::base64::encode_len(data), 0);
                let n = bun_core::base64::encode(&mut w.out[at..], data);
                w.out.truncate(at + n);
                w.out.push(b'"');
            }
            _ => {}
        }
    }
    w.out.push(b'}');
}

fn key_value(w: &mut W, body: &[u8]) {
    let mut key: &[u8] = b"";
    let mut val: &[u8] = b"";
    let mut r = Reader::new(body);
    while let Ok(Some((fl, v))) = r.next() {
        match fl {
            f::KV_KEY => key = v.as_bytes(),
            f::KV_VALUE => val = v.as_bytes(),
            _ => {}
        }
    }
    w.raw("{\"key\":");
    w.str(key);
    w.raw(",\"value\":");
    any_value(w, val);
    w.out.push(b'}');
}

fn status(w: &mut W, body: &[u8]) {
    w.out.push(b'{');
    let mut first = true;
    let mut r = Reader::new(body);
    while let Ok(Some((fl, v))) = r.next() {
        match fl {
            f::STATUS_MESSAGE => {
                w.key(&mut first, "message");
                w.str(v.as_bytes());
            }
            f::STATUS_CODE => {
                w.key(&mut first, "code");
                w.num(v.as_u64());
            }
            _ => {}
        }
    }
    w.out.push(b'}');
}

fn event(w: &mut W, body: &[u8]) {
    w.out.push(b'{');
    let mut first = true;
    let mut r = Reader::new(body);
    while let Ok(Some((fl, v))) = r.next() {
        match fl {
            f::EV_TIME => {
                w.key(&mut first, "timeUnixNano");
                w.u64s(v.as_u64());
            }
            f::EV_NAME => {
                w.key(&mut first, "name");
                w.str(v.as_bytes());
            }
            f::EV_DROPPED_ATTRIBUTES => {
                w.key(&mut first, "droppedAttributesCount");
                w.num(v.as_u64());
            }
            _ => {}
        }
    }
    w.repeated(&mut first, body, f::EV_ATTRIBUTES, "attributes", |w, v| {
        key_value(w, v.as_bytes())
    });
    w.out.push(b'}');
}

fn link(w: &mut W, body: &[u8]) {
    w.out.push(b'{');
    let mut first = true;
    let mut r = Reader::new(body);
    while let Ok(Some((fl, v))) = r.next() {
        match fl {
            f::LINK_TRACE_ID => {
                w.key(&mut first, "traceId");
                w.hex(v.as_bytes());
            }
            f::LINK_SPAN_ID => {
                w.key(&mut first, "spanId");
                w.hex(v.as_bytes());
            }
            f::LINK_TRACE_STATE => {
                w.key(&mut first, "traceState");
                w.str(v.as_bytes());
            }
            f::LINK_DROPPED_ATTRIBUTES => {
                w.key(&mut first, "droppedAttributesCount");
                w.num(v.as_u64());
            }
            f::LINK_FLAGS => {
                w.key(&mut first, "flags");
                w.num(v.as_u64());
            }
            _ => {}
        }
    }
    w.repeated(
        &mut first,
        body,
        f::LINK_ATTRIBUTES,
        "attributes",
        |w, v| key_value(w, v.as_bytes()),
    );
    w.out.push(b'}');
}

fn span(w: &mut W, body: &[u8]) {
    w.out.push(b'{');
    let mut first = true;
    let mut r = Reader::new(body);
    while let Ok(Some((fl, v))) = r.next() {
        match fl {
            f::TRACE_ID => {
                w.key(&mut first, "traceId");
                w.hex(v.as_bytes());
            }
            f::SPAN_ID => {
                w.key(&mut first, "spanId");
                w.hex(v.as_bytes());
            }
            f::TRACE_STATE => {
                w.key(&mut first, "traceState");
                w.str(v.as_bytes());
            }
            f::PARENT_SPAN_ID => {
                w.key(&mut first, "parentSpanId");
                w.hex(v.as_bytes());
            }
            f::NAME => {
                w.key(&mut first, "name");
                w.str(v.as_bytes());
            }
            f::KIND => {
                w.key(&mut first, "kind");
                w.num(v.as_u64());
            }
            f::START_TIME => {
                w.key(&mut first, "startTimeUnixNano");
                w.u64s(v.as_u64());
            }
            f::END_TIME => {
                w.key(&mut first, "endTimeUnixNano");
                w.u64s(v.as_u64());
            }
            f::DROPPED_ATTRIBUTES => {
                w.key(&mut first, "droppedAttributesCount");
                w.num(v.as_u64());
            }
            f::DROPPED_EVENTS => {
                w.key(&mut first, "droppedEventsCount");
                w.num(v.as_u64());
            }
            f::DROPPED_LINKS => {
                w.key(&mut first, "droppedLinksCount");
                w.num(v.as_u64());
            }
            f::STATUS => {
                w.key(&mut first, "status");
                status(w, v.as_bytes());
            }
            f::FLAGS => {
                w.key(&mut first, "flags");
                w.num(v.as_u64());
            }
            _ => {}
        }
    }
    w.repeated(&mut first, body, f::ATTRIBUTES, "attributes", |w, v| {
        key_value(w, v.as_bytes())
    });
    w.repeated(&mut first, body, f::EVENTS, "events", |w, v| {
        event(w, v.as_bytes())
    });
    w.repeated(&mut first, body, f::LINKS, "links", |w, v| {
        link(w, v.as_bytes())
    });
    w.out.push(b'}');
}

fn scope(w: &mut W, body: &[u8]) {
    w.out.push(b'{');
    let mut first = true;
    let mut r = Reader::new(body);
    while let Ok(Some((fl, v))) = r.next() {
        match fl {
            f::SCOPE_NAME => {
                w.key(&mut first, "name");
                w.str(v.as_bytes());
            }
            f::SCOPE_VERSION => {
                w.key(&mut first, "version");
                w.str(v.as_bytes());
            }
            _ => {}
        }
    }
    w.repeated(
        &mut first,
        body,
        f::SCOPE_ATTRIBUTES,
        "attributes",
        |w, v| key_value(w, v.as_bytes()),
    );
    w.out.push(b'}');
}

fn scope_spans(w: &mut W, body: &[u8]) {
    w.out.push(b'{');
    let mut first = true;
    let mut r = Reader::new(body);
    while let Ok(Some((fl, v))) = r.next() {
        match fl {
            f::SS_SCOPE => {
                w.key(&mut first, "scope");
                scope(w, v.as_bytes());
            }
            f::SS_SCHEMA_URL => {
                w.key(&mut first, "schemaUrl");
                w.str(v.as_bytes());
            }
            _ => {}
        }
    }
    w.repeated(&mut first, body, f::SS_SPANS, "spans", |w, v| {
        span(w, v.as_bytes())
    });
    w.out.push(b'}');
}

fn resource_spans(w: &mut W, body: &[u8]) {
    w.out.push(b'{');
    let mut first = true;
    let mut r = Reader::new(body);
    while let Ok(Some((fl, v))) = r.next() {
        match fl {
            f::RS_RESOURCE => {
                w.key(&mut first, "resource");
                w.out.push(b'{');
                let mut f2 = true;
                w.repeated(
                    &mut f2,
                    v.as_bytes(),
                    f::RES_ATTRIBUTES,
                    "attributes",
                    |w, kv| key_value(w, kv.as_bytes()),
                );
                w.out.push(b'}');
            }
            f::RS_SCHEMA_URL => {
                w.key(&mut first, "schemaUrl");
                w.str(v.as_bytes());
            }
            _ => {}
        }
    }
    w.repeated(&mut first, body, f::RS_SCOPE_SPANS, "scopeSpans", |w, v| {
        scope_spans(w, v.as_bytes())
    });
    w.out.push(b'}');
}

/// `ExportTraceServiceRequest` protobuf → OTLP/JSON bytes.
pub fn to_json(request: &[u8]) -> Vec<u8> {
    let mut w = W {
        out: Vec::with_capacity(request.len() * 3),
    };
    w.out.push(b'{');
    let mut first = true;
    w.repeated(
        &mut first,
        request,
        f::RESOURCE_SPANS,
        "resourceSpans",
        |w, v| resource_spans(w, v.as_bytes()),
    );
    w.out.push(b'}');
    w.out
}
