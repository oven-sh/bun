//! OTLP protobuf encoding for traces. Field numbers from
//! opentelemetry/proto/{common,resource,trace}/v1 and collector/trace/v1.
//!
//! The hot path is `SpanWriter`: an integration ends a span by streaming its
//! fields straight into the thread's batch buffer as a length-delimited
//! `ScopeSpans.spans` entry. Attributes are never materialised.

use crate::proto::{
    self, Nested, WireType, len_field_len, tag_len, varint_len, write_len_prefix, write_tag,
    write_varint,
};
use crate::span::{SpanContext, SpanKind, SpanStub, StatusCode};

pub mod field {
    // ExportTraceServiceRequest / TracesData
    pub const RESOURCE_SPANS: u32 = 1;
    // ResourceSpans
    pub const RS_RESOURCE: u32 = 1;
    pub const RS_SCOPE_SPANS: u32 = 2;
    pub const RS_SCHEMA_URL: u32 = 3;
    // Resource
    pub const RES_ATTRIBUTES: u32 = 1;
    // ScopeSpans
    pub const SS_SCOPE: u32 = 1;
    pub const SS_SPANS: u32 = 2;
    pub const SS_SCHEMA_URL: u32 = 3;
    // InstrumentationScope
    pub const SCOPE_NAME: u32 = 1;
    pub const SCOPE_VERSION: u32 = 2;
    // Span
    pub const TRACE_ID: u32 = 1;
    pub const SPAN_ID: u32 = 2;
    pub const TRACE_STATE: u32 = 3;
    pub const PARENT_SPAN_ID: u32 = 4;
    pub const NAME: u32 = 5;
    pub const KIND: u32 = 6;
    pub const START_TIME: u32 = 7;
    pub const END_TIME: u32 = 8;
    pub const ATTRIBUTES: u32 = 9;
    pub const DROPPED_ATTRIBUTES: u32 = 10;
    pub const EVENTS: u32 = 11;
    pub const DROPPED_EVENTS: u32 = 12;
    pub const LINKS: u32 = 13;
    pub const DROPPED_LINKS: u32 = 14;
    pub const STATUS: u32 = 15;
    pub const FLAGS: u32 = 16;
    // Event
    pub const EV_TIME: u32 = 1;
    pub const EV_NAME: u32 = 2;
    pub const EV_ATTRIBUTES: u32 = 3;
    // Link
    pub const LINK_TRACE_ID: u32 = 1;
    pub const LINK_SPAN_ID: u32 = 2;
    pub const LINK_TRACE_STATE: u32 = 3;
    pub const LINK_ATTRIBUTES: u32 = 4;
    pub const LINK_FLAGS: u32 = 6;
    // Status
    pub const STATUS_MESSAGE: u32 = 2;
    pub const STATUS_CODE: u32 = 3;
    // KeyValue
    pub const KV_KEY: u32 = 1;
    pub const KV_VALUE: u32 = 2;
    // AnyValue
    pub const AV_STRING: u32 = 1;
    pub const AV_BOOL: u32 = 2;
    pub const AV_INT: u32 = 3;
    pub const AV_DOUBLE: u32 = 4;
    pub const AV_ARRAY: u32 = 5;
    pub const AV_KVLIST: u32 = 6;
    pub const AV_BYTES: u32 = 7;
    // ArrayValue
    pub const ARR_VALUES: u32 = 1;
}
use field as f;

/// An attribute value as accepted by the writers. Arrays are homogeneous per
/// the OTel spec but the wire format doesn't care, so neither do we.
#[derive(Clone, Copy, Debug)]
pub enum Value<'a> {
    Str(&'a [u8]),
    Int(i64),
    Bool(bool),
    Double(f64),
    Array(&'a [Value<'a>]),
    Bytes(&'a [u8]),
}

impl<'a> From<&'a [u8]> for Value<'a> {
    #[inline]
    fn from(v: &'a [u8]) -> Self {
        Value::Str(v)
    }
}
impl<'a> From<&'a str> for Value<'a> {
    #[inline]
    fn from(v: &'a str) -> Self {
        Value::Str(v.as_bytes())
    }
}
impl From<i64> for Value<'_> {
    #[inline]
    fn from(v: i64) -> Self {
        Value::Int(v)
    }
}
impl From<u32> for Value<'_> {
    #[inline]
    fn from(v: u32) -> Self {
        Value::Int(v as i64)
    }
}
impl From<u16> for Value<'_> {
    #[inline]
    fn from(v: u16) -> Self {
        Value::Int(v as i64)
    }
}
impl From<bool> for Value<'_> {
    #[inline]
    fn from(v: bool) -> Self {
        Value::Bool(v)
    }
}
impl From<f64> for Value<'_> {
    #[inline]
    fn from(v: f64) -> Self {
        Value::Double(v)
    }
}

/// Body length of the `AnyValue` message for `v`.
#[inline]
fn any_value_body_len(v: &Value<'_>) -> usize {
    match *v {
        Value::Str(s) => len_field_len(f::AV_STRING, s.len()),
        Value::Bytes(s) => len_field_len(f::AV_BYTES, s.len()),
        Value::Bool(_) => tag_len(f::AV_BOOL) + 1,
        Value::Int(i) => tag_len(f::AV_INT) + varint_len(i as u64),
        Value::Double(_) => tag_len(f::AV_DOUBLE) + 8,
        Value::Array(items) => len_field_len(f::AV_ARRAY, array_body_len(items)),
    }
}

#[inline]
fn array_body_len(items: &[Value<'_>]) -> usize {
    let mut arr = 0;
    for v in items {
        arr += len_field_len(f::ARR_VALUES, any_value_body_len(v));
    }
    arr
}

#[inline]
fn write_any_value_body(out: &mut Vec<u8>, v: &Value<'_>) {
    match *v {
        Value::Str(s) => proto::write_bytes(out, f::AV_STRING, s),
        Value::Bytes(s) => proto::write_bytes(out, f::AV_BYTES, s),
        Value::Bool(b) => proto::write_bool_always(out, f::AV_BOOL, b),
        Value::Int(i) => {
            write_tag(out, f::AV_INT, WireType::Varint);
            write_varint(out, i as u64);
        }
        Value::Double(d) => proto::write_double(out, f::AV_DOUBLE, d),
        Value::Array(items) => {
            write_len_prefix(out, f::AV_ARRAY, array_body_len(items));
            for v in items {
                write_len_prefix(out, f::ARR_VALUES, any_value_body_len(v));
                write_any_value_body(out, v);
            }
        }
    }
}

/// Append one `KeyValue` as field number `field` of the enclosing message.
#[inline]
pub fn write_key_value(out: &mut Vec<u8>, field: u32, key: &[u8], v: &Value<'_>) {
    let av = any_value_body_len(v);
    let kv = len_field_len(f::KV_KEY, key.len()) + len_field_len(f::KV_VALUE, av);
    out.reserve(len_field_len(field, kv));
    if kv < 128 && field < 16 {
        // One-byte varints throughout: header bytes are pushed inline and the
        // key/value bytes copied straight into `out` (no staging buffer).
        out.push((field << 3 | 2) as u8);
        out.push(kv as u8);
        out.push((f::KV_KEY << 3 | 2) as u8);
        out.push(key.len() as u8);
        out.extend_from_slice(key);
        out.push((f::KV_VALUE << 3 | 2) as u8);
        out.push(av as u8);
        match *v {
            Value::Str(s) => {
                out.push((f::AV_STRING << 3 | 2) as u8);
                out.push(s.len() as u8);
                out.extend_from_slice(s);
            }
            Value::Bool(x) => {
                out.push((f::AV_BOOL << 3) as u8);
                out.push(x as u8);
            }
            Value::Int(i) if (0..128).contains(&i) => {
                out.push((f::AV_INT << 3) as u8);
                out.push(i as u8);
            }
            _ => write_any_value_body(out, v),
        }
        return;
    }
    write_len_prefix(out, field, kv);
    proto::write_bytes(out, f::KV_KEY, key);
    write_len_prefix(out, f::KV_VALUE, av);
    write_any_value_body(out, v);
}

/// Longest prefix of `s` that is at most `max` bytes and does not split a
/// UTF-8 sequence.
#[inline]
pub fn truncate_utf8(s: &[u8], max: usize) -> &[u8] {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && (s[end] & 0xC0) == 0x80 {
        end -= 1;
    }
    &s[..end]
}

/// Locate the encoded `KeyValue` for `key` in a buffer of concatenated
/// `Span.attributes` entries: `(offset, total_len)` of the whole entry.
pub fn find_attribute(attrs: &[u8], key: &[u8]) -> Option<(usize, usize)> {
    let mut r = proto::Reader::new(attrs);
    loop {
        let start = r.pos;
        let (_, entry) = r.next().ok()??;
        let mut kv = proto::Reader::new(entry.as_bytes());
        if let Ok(Some((f::KV_KEY, k))) = kv.next() {
            if k.as_bytes() == key {
                return Some((start, r.pos - start));
            }
        }
    }
}

/// Streams one `Span` as a `ScopeSpans.spans` entry into `out`.
pub struct SpanWriter<'a> {
    out: &'a mut Vec<u8>,
    nested: Nested,
}

impl<'a> SpanWriter<'a> {
    /// Writes identity, name, kind and timestamps. `end_ns == 0` is allowed
    /// for callers that set it later via [`Self::end_time`], but every span
    /// must have one before `finish`.
    #[inline]
    pub fn begin(
        out: &'a mut Vec<u8>,
        stub: &SpanStub,
        name: &[u8],
        kind: SpanKind,
        end_ns: u64,
    ) -> SpanWriter<'a> {
        out.reserve(128 + name.len());
        let nested = Nested::begin(out, f::SS_SPANS);
        // Fixed-shape prefix assembled on the stack, appended once.
        let mut b = [0u8; 64];
        let mut n = 0;
        b[n] = (f::TRACE_ID << 3 | 2) as u8;
        b[n + 1] = 16;
        b[n + 2..n + 18].copy_from_slice(&stub.ctx.trace_id.0);
        n += 18;
        b[n] = (f::SPAN_ID << 3 | 2) as u8;
        b[n + 1] = 8;
        b[n + 2..n + 10].copy_from_slice(&stub.ctx.span_id.0);
        n += 10;
        if stub.parent.is_valid() {
            b[n] = (f::PARENT_SPAN_ID << 3 | 2) as u8;
            b[n + 1] = 8;
            b[n + 2..n + 10].copy_from_slice(&stub.parent.0);
            n += 10;
        }
        b[n] = (f::KIND << 3) as u8;
        b[n + 1] = kind as u8;
        n += 2;
        b[n] = (f::START_TIME << 3 | 1) as u8;
        b[n + 1..n + 9].copy_from_slice(&stub.start_ns.to_le_bytes());
        n += 9;
        if end_ns != 0 {
            b[n] = (f::END_TIME << 3 | 1) as u8;
            b[n + 1..n + 9].copy_from_slice(&end_ns.to_le_bytes());
            n += 9;
        }
        // Field 16: two-byte tag.
        b[n] = ((f::FLAGS << 3 | 5) & 0x7f) as u8 | 0x80;
        b[n + 1] = ((f::FLAGS << 3 | 5) >> 7) as u8;
        b[n + 2..n + 6].copy_from_slice(&stub.ctx.flags.otlp().to_le_bytes());
        n += 6;
        out.extend_from_slice(&b[..n]);
        proto::write_bytes(out, f::NAME, name);
        SpanWriter { out, nested }
    }

    #[inline]
    pub fn end_time(&mut self, end_ns: u64) -> &mut Self {
        proto::write_fixed64(self.out, f::END_TIME, end_ns);
        self
    }

    #[inline]
    pub fn trace_state(&mut self, ts: &[u8]) -> &mut Self {
        proto::write_bytes_opt(self.out, f::TRACE_STATE, ts);
        self
    }

    #[inline]
    pub fn attr<'v>(&mut self, key: &str, v: impl Into<Value<'v>>) -> &mut Self {
        write_key_value(self.out, f::ATTRIBUTES, key.as_bytes(), &v.into());
        self
    }

    #[inline]
    pub fn attr_bytes_key<'v>(&mut self, key: &[u8], v: impl Into<Value<'v>>) -> &mut Self {
        write_key_value(self.out, f::ATTRIBUTES, key, &v.into());
        self
    }

    /// String attribute, skipped when the value is empty.
    #[inline]
    pub fn attr_opt(&mut self, key: &str, v: &[u8]) -> &mut Self {
        if !v.is_empty() {
            write_key_value(self.out, f::ATTRIBUTES, key.as_bytes(), &Value::Str(v));
        }
        self
    }

    /// Splice already-encoded `Span` fields (attributes/events/links produced
    /// by `write_key_value(.., ATTRIBUTES, ..)` / [`encode_event`]).
    #[inline]
    pub fn raw(&mut self, encoded: &[u8]) -> &mut Self {
        self.out.extend_from_slice(encoded);
        self
    }

    pub fn dropped_attributes(&mut self, n: u32) -> &mut Self {
        proto::write_uint(self.out, f::DROPPED_ATTRIBUTES, n as u64);
        self
    }
    pub fn dropped_events(&mut self, n: u32) -> &mut Self {
        proto::write_uint(self.out, f::DROPPED_EVENTS, n as u64);
        self
    }
    pub fn dropped_links(&mut self, n: u32) -> &mut Self {
        proto::write_uint(self.out, f::DROPPED_LINKS, n as u64);
        self
    }

    #[inline]
    pub fn event(&mut self, name: &[u8], time_ns: u64, attrs: &[(&[u8], Value<'_>)]) -> &mut Self {
        encode_event(self.out, name, time_ns, attrs);
        self
    }

    /// `exception` event per semconv: exception.type / exception.message /
    /// exception.stacktrace.
    pub fn exception(
        &mut self,
        time_ns: u64,
        ty: &[u8],
        message: &[u8],
        stack: &[u8],
    ) -> &mut Self {
        let mut attrs: [(&[u8], Value<'_>); 3] = [
            (b"exception.type", Value::Str(ty)),
            (b"exception.message", Value::Str(message)),
            (b"exception.stacktrace", Value::Str(stack)),
        ];
        let n = if stack.is_empty() { 2 } else { 3 };
        encode_event(self.out, b"exception", time_ns, &mut attrs[..n]);
        self
    }

    #[inline]
    pub fn link(&mut self, ctx: &SpanContext, attrs: &[(&[u8], Value<'_>)]) -> &mut Self {
        encode_link(self.out, ctx, b"", attrs);
        self
    }

    #[inline]
    pub fn status(&mut self, code: StatusCode, message: &[u8]) -> &mut Self {
        if code == StatusCode::Unset && message.is_empty() {
            return self;
        }
        // Spec: description is only meaningful for Error.
        let message = if code == StatusCode::Error {
            message
        } else {
            b""
        };
        let body = if message.is_empty() {
            0
        } else {
            len_field_len(f::STATUS_MESSAGE, message.len())
        } + if code == StatusCode::Unset {
            0
        } else {
            tag_len(f::STATUS_CODE) + 1
        };
        write_len_prefix(self.out, f::STATUS, body);
        proto::write_bytes_opt(self.out, f::STATUS_MESSAGE, message);
        proto::write_uint(self.out, f::STATUS_CODE, code as u64);
        self
    }

    #[inline]
    pub fn finish(self) {
        self.nested.finish(self.out);
    }
}

fn attrs_len(field: u32, attrs: &[(&[u8], Value<'_>)]) -> usize {
    let mut n = 0;
    for (k, v) in attrs {
        let av = any_value_body_len(v);
        let kv = len_field_len(f::KV_KEY, k.len()) + len_field_len(f::KV_VALUE, av);
        n += len_field_len(field, kv);
    }
    n
}

/// Append a `Span.events` entry.
pub fn encode_event(out: &mut Vec<u8>, name: &[u8], time_ns: u64, attrs: &[(&[u8], Value<'_>)]) {
    let body = tag_len(f::EV_TIME)
        + 8
        + len_field_len(f::EV_NAME, name.len())
        + attrs_len(f::EV_ATTRIBUTES, attrs);
    write_len_prefix(out, f::EVENTS, body);
    proto::write_fixed64(out, f::EV_TIME, time_ns);
    proto::write_bytes(out, f::EV_NAME, name);
    for (k, v) in attrs {
        write_key_value(out, f::EV_ATTRIBUTES, k, v);
    }
}

/// Append a `Span.links` entry.
pub fn encode_link(
    out: &mut Vec<u8>,
    ctx: &SpanContext,
    trace_state: &[u8],
    attrs: &[(&[u8], Value<'_>)],
) {
    let flags = (ctx.flags.w3c() as u32) | 0x100 | if ctx.flags.remote() { 0x200 } else { 0 };
    let body = len_field_len(f::LINK_TRACE_ID, 16)
        + len_field_len(f::LINK_SPAN_ID, 8)
        + if trace_state.is_empty() {
            0
        } else {
            len_field_len(f::LINK_TRACE_STATE, trace_state.len())
        }
        + attrs_len(f::LINK_ATTRIBUTES, attrs)
        + tag_len(f::LINK_FLAGS)
        + 4;
    write_len_prefix(out, f::LINKS, body);
    proto::write_bytes(out, f::LINK_TRACE_ID, &ctx.trace_id.0);
    proto::write_bytes(out, f::LINK_SPAN_ID, &ctx.span_id.0);
    proto::write_bytes_opt(out, f::LINK_TRACE_STATE, trace_state);
    for (k, v) in attrs {
        write_key_value(out, f::LINK_ATTRIBUTES, k, v);
    }
    write_tag(out, f::LINK_FLAGS, WireType::Fixed32);
    out.extend_from_slice(&flags.to_le_bytes());
}

/// Encoded `InstrumentationScope` message body.
pub fn encode_scope(name: &[u8], version: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(name.len() + version.len() + 6);
    proto::write_bytes(&mut out, f::SCOPE_NAME, name);
    proto::write_bytes_opt(&mut out, f::SCOPE_VERSION, version);
    out
}

/// Encoded `Resource` message body from attributes.
pub fn encode_resource(attrs: &[(&[u8], Value<'_>)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(attrs_len(f::RES_ATTRIBUTES, attrs));
    for (k, v) in attrs {
        write_key_value(&mut out, f::RES_ATTRIBUTES, k, v);
    }
    out
}

/// One scope's worth of encoded spans ready for the envelope.
pub struct ScopeChunk<'a> {
    /// Encoded `InstrumentationScope` body.
    pub scope: &'a [u8],
    /// Concatenated `ScopeSpans.spans` entries (each already tagged).
    pub spans: &'a [u8],
}

/// Build an `ExportTraceServiceRequest` around pre-encoded pieces. All sizes
/// are known so this is a single allocation and straight-line writes.
pub fn encode_request(resource: &[u8], scopes: &[ScopeChunk<'_>]) -> Vec<u8> {
    let mut scope_spans_total = 0;
    for s in scopes {
        let ss_body = len_field_len(f::SS_SCOPE, s.scope.len()) + s.spans.len();
        scope_spans_total += len_field_len(f::RS_SCOPE_SPANS, ss_body);
    }
    let rs_body = len_field_len(f::RS_RESOURCE, resource.len()) + scope_spans_total;
    let total = len_field_len(f::RESOURCE_SPANS, rs_body);
    let mut out = Vec::with_capacity(total);
    write_len_prefix(&mut out, f::RESOURCE_SPANS, rs_body);
    write_len_prefix(&mut out, f::RS_RESOURCE, resource.len());
    out.extend_from_slice(resource);
    for s in scopes {
        let ss_body = len_field_len(f::SS_SCOPE, s.scope.len()) + s.spans.len();
        write_len_prefix(&mut out, f::RS_SCOPE_SPANS, ss_body);
        write_len_prefix(&mut out, f::SS_SCOPE, s.scope.len());
        out.extend_from_slice(s.scope);
        out.extend_from_slice(s.spans);
    }
    debug_assert_eq!(out.len(), total);
    out
}

/// Number of `spans` entries in a concatenated buffer (walks tags only).
pub fn count_spans(mut spans: &[u8]) -> usize {
    let mut n = 0;
    let mut r = proto::Reader::new(spans);
    while let Ok(Some((field, _))) = r.next() {
        if field == f::SS_SPANS {
            n += 1;
        }
    }
    spans = &[];
    let _ = spans;
    n
}

