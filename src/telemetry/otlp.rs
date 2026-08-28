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

/// Length bytes reserved after the `ScopeSpans.spans` tag by [`SpanWriter`].
pub const SPAN_LEN_RESERVE: usize = 2;

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
    pub const SCOPE_ATTRIBUTES: u32 = 3;
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
    pub const EV_DROPPED_ATTRIBUTES: u32 = 4;
    // Link
    pub const LINK_TRACE_ID: u32 = 1;
    pub const LINK_SPAN_ID: u32 = 2;
    pub const LINK_TRACE_STATE: u32 = 3;
    pub const LINK_ATTRIBUTES: u32 = 4;
    pub const LINK_DROPPED_ATTRIBUTES: u32 = 5;
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
    // KeyValueList
    pub const KVLIST_VALUES: u32 = 1;
}
use field as f;

/// An attribute value as accepted by the writers. Arrays are homogeneous per
/// the OTel spec but the wire format doesn't care, so neither do we.
#[derive(Clone, Copy, Debug)]
pub enum Value<'a> {
    /// Written as a proto3 `string`: valid UTF-8 goes out as is (an ASCII
    /// check, nearly always), anything else with invalid sequences replaced
    /// by U+FFFD — one invalid `string` makes a receiver drop the whole
    /// export request, and paths, Buffer keys and OS strings need not be UTF-8.
    Str(&'a [u8]),
    Int(i64),
    Bool(bool),
    Double(f64),
    Array(&'a [Value<'a>]),
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
impl From<u16> for Value<'_> {
    #[inline]
    fn from(v: u16) -> Self {
        Value::Int(v as i64)
    }
}

/// Body length of the `AnyValue` message for `v`.
#[inline]
fn any_value_body_len(v: &Value<'_>) -> usize {
    match *v {
        Value::Str(s) => len_field_len(f::AV_STRING, utf8_lossy_len(s)),
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
        Value::Str(s) => write_string(out, f::AV_STRING, s),
        Value::Bool(b) => proto::write_bool(out, f::AV_BOOL, b),
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
/// [`write_key_value`] with `attributeValueLengthLimit` applied to string
/// values, including the string elements of an array value.
pub fn write_key_value_limited(
    out: &mut Vec<u8>,
    field: u32,
    key: &[u8],
    v: &Value<'_>,
    max: usize,
) {
    match *v {
        Value::Str(s) if s.len() > max => {
            write_key_value(out, field, key, &Value::Str(truncate_utf8(s, max)))
        }
        Value::Array(items)
            if items
                .iter()
                .any(|i| matches!(i, Value::Str(s) if s.len() > max)) =>
        {
            let limited: Vec<Value<'_>> = items
                .iter()
                .map(|i| match *i {
                    Value::Str(s) => Value::Str(truncate_utf8(s, max)),
                    other => other,
                })
                .collect();
            write_key_value(out, field, key, &Value::Array(&limited))
        }
        _ => write_key_value(out, field, key, v),
    }
}

pub fn write_key_value(out: &mut Vec<u8>, field: u32, key: &[u8], v: &Value<'_>) {
    let av = any_value_body_len(v);
    let kv = len_field_len(f::KV_KEY, key.len()) + len_field_len(f::KV_VALUE, av);
    out.reserve(len_field_len(field, kv));
    if kv < 128 && field < 16 {
        // One-byte varints throughout: the headers are fixed-size stores and
        // the key/value bytes are copied straight into `out`.
        out.extend_from_slice(&[
            (field << 3 | 2) as u8,
            kv as u8,
            (f::KV_KEY << 3 | 2) as u8,
            key.len() as u8,
        ]);
        out.extend_from_slice(key);
        let value_tag = (f::KV_VALUE << 3 | 2) as u8;
        match *v {
            Value::Str(s) => {
                // (`av` was computed from the lossy length, so this holds for
                // invalid input too)
                out.extend_from_slice(&[
                    value_tag,
                    av as u8,
                    (f::AV_STRING << 3 | 2) as u8,
                    (av - 2) as u8,
                ]);
                extend_utf8_lossy(out, s);
            }
            Value::Bool(x) => {
                out.extend_from_slice(&[value_tag, av as u8, (f::AV_BOOL << 3) as u8, x as u8]);
            }
            Value::Int(i) if (0..128).contains(&i) => {
                out.extend_from_slice(&[value_tag, av as u8, (f::AV_INT << 3) as u8, i as u8]);
            }
            // ports, status codes, sizes: a 2–3 byte varint without the generic path
            Value::Int(i) if (128..1 << 21).contains(&i) => {
                let i = i as u32;
                if i < 1 << 14 {
                    out.extend_from_slice(&[
                        value_tag,
                        av as u8,
                        (f::AV_INT << 3) as u8,
                        (i | 0x80) as u8,
                        (i >> 7) as u8,
                    ]);
                } else {
                    out.extend_from_slice(&[
                        value_tag,
                        av as u8,
                        (f::AV_INT << 3) as u8,
                        (i | 0x80) as u8,
                        (i >> 7 | 0x80) as u8,
                        (i >> 14) as u8,
                    ]);
                }
            }
            _ => {
                out.extend_from_slice(&[value_tag, av as u8]);
                write_any_value_body(out, v);
            }
        }
        return;
    }
    write_len_prefix(out, field, kv);
    proto::write_bytes(out, f::KV_KEY, key);
    write_len_prefix(out, f::KV_VALUE, av);
    write_any_value_body(out, v);
}

/// [`write_key_value`] for a string value under a short literal key: with the
/// key known at compile time the header and key become immediate stores,
/// leaving one copy for the value.
#[inline(always)]
pub fn write_str_kv_small(out: &mut Vec<u8>, field: u32, key: &'static str, v: &[u8]) {
    let key = key.as_bytes();
    let kv = 2 + key.len() + 2 + 2 + v.len();
    if kv >= 128 || field >= 16 {
        return write_key_value(out, field, key, &Value::Str(v));
    }
    out.reserve(kv + 2);
    out.extend_from_slice(&[
        (field << 3 | 2) as u8,
        kv as u8,
        (f::KV_KEY << 3 | 2) as u8,
        key.len() as u8,
    ]);
    out.extend_from_slice(key);
    out.extend_from_slice(&[
        (f::KV_VALUE << 3 | 2) as u8,
        (2 + v.len()) as u8,
        (f::AV_STRING << 3 | 2) as u8,
        v.len() as u8,
    ]);
    out.extend_from_slice(v);
}

/// Query-string keys whose values are credentials (the semconv url.full /
/// url.query redaction set; also what @opentelemetry/instrumentation-http uses).
/// Mirrored in src/js/internal/telemetry.ts `REDACTED_QUERY_KEYS`.
pub const REDACTED_QUERY_KEYS: [&[u8]; 7] = [
    b"AWSAccessKeyId",
    b"Signature",
    b"sig",
    b"X-Goog-Signature",
    b"X-Amz-Signature",
    b"X-Amz-Credential",
    b"X-Amz-Security-Token",
];

/// A bare query string (`a=1&sig=2`, no leading `?`) with the values of
/// [`REDACTED_QUERY_KEYS`] replaced by `REDACTED`. Borrows when there is
/// nothing to redact, which is nearly always.
pub fn redact_query(query: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    use bun_core::strings;
    let is_secret = |pair: &[u8]| {
        let key = strings::split_once_char(pair, b'=').map_or(pair, |(k, _)| k);
        REDACTED_QUERY_KEYS.contains(&key)
    };
    if !strings::split(query, b"&").any(is_secret) {
        return std::borrow::Cow::Borrowed(query);
    }
    let mut out = Vec::with_capacity(query.len());
    for (i, pair) in strings::split(query, b"&").enumerate() {
        if i != 0 {
            out.push(b'&');
        }
        match strings::split_once_char(pair, b'=') {
            Some((k, _)) if REDACTED_QUERY_KEYS.contains(&k) => {
                out.extend_from_slice(k);
                out.extend_from_slice(b"=REDACTED");
            }
            _ => out.extend_from_slice(pair),
        }
    }
    std::borrow::Cow::Owned(out)
}

/// A full URL with its query (first `?` to `#`/end) run through [`redact_query`].
pub fn redact_url(url: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    use bun_core::strings;
    let Some(q) = strings::index_of_char_usize(url, b'?').map(|i| i + 1) else {
        return std::borrow::Cow::Borrowed(url);
    };
    let end = strings::index_of_char_usize(&url[q..], b'#').map_or(url.len(), |i| q + i);
    match redact_query(&url[q..end]) {
        std::borrow::Cow::Borrowed(_) => std::borrow::Cow::Borrowed(url),
        std::borrow::Cow::Owned(rq) => {
            let mut out = Vec::with_capacity(url.len());
            out.extend_from_slice(&url[..q]);
            out.extend_from_slice(&rq);
            out.extend_from_slice(&url[end..]);
            std::borrow::Cow::Owned(out)
        }
    }
}

/// Append `s` (bytes off the wire: a request target, a header value) to
/// `out` as valid UTF-8, replacing invalid sequences with U+FFFD. proto3
/// `string` fields must be UTF-8 or receivers reject the whole request; the
/// ASCII case (nearly always) is one SIMD scan and a copy.
#[inline]
pub fn extend_utf8_lossy(out: &mut Vec<u8>, s: &[u8]) {
    if s.is_ascii() || core::str::from_utf8(s).is_ok() {
        out.extend_from_slice(s);
        return;
    }
    for chunk in s.utf8_chunks() {
        out.extend_from_slice(chunk.valid().as_bytes());
        if !chunk.invalid().is_empty() {
            out.extend_from_slice("\u{FFFD}".as_bytes());
        }
    }
}

/// A proto3 `string` field: `s` if it is valid UTF-8, else a lossy copy
/// (see [`Value::Str`]).
#[inline]
pub fn write_string(out: &mut Vec<u8>, field: u32, s: &[u8]) {
    write_len_prefix(out, field, utf8_lossy_len(s));
    extend_utf8_lossy(out, s);
}

/// Length of what [`extend_utf8_lossy`] writes for `s`.
#[inline]
pub fn utf8_lossy_len(s: &[u8]) -> usize {
    if s.is_ascii() || core::str::from_utf8(s).is_ok() {
        return s.len();
    }
    s.utf8_chunks()
        .map(|c| c.valid().len() + if c.invalid().is_empty() { 0 } else { 3 })
        .sum()
}

/// `s` if it is valid UTF-8 (borrowed), else a lossy copy.
#[inline]
pub fn utf8_lossy(s: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    if s.is_ascii() || core::str::from_utf8(s).is_ok() {
        std::borrow::Cow::Borrowed(s)
    } else {
        let mut v = Vec::with_capacity(s.len() + 8);
        extend_utf8_lossy(&mut v, s);
        std::borrow::Cow::Owned(v)
    }
}

/// Longest prefix of `s` that is at most `max` bytes and does not split a
/// UTF-8 sequence.
#[inline]
pub fn truncate_utf8(s: &[u8], max: usize) -> &[u8] {
    if s.len() <= max {
        return s;
    }
    // Back off at most 3 continuation bytes so a code point is not split; input
    // that is not UTF-8 (a run of 0x80..0xBF bytes) is then simply cut at `max`.
    let mut end = max;
    while end > 0 && max - end < 3 && (s[end] & 0xC0) == 0x80 {
        end -= 1;
    }
    if (s[end] & 0xC0) == 0x80 { &s[..max] } else { &s[..end] }
}

/// The semconv `exception.*` attribute set (stacktrace omitted when empty).
#[inline]
pub fn with_exception_attrs<R>(
    ty: &[u8],
    message: &[u8],
    stack: &[u8],
    f: impl FnOnce(&[(&[u8], Value<'_>)]) -> R,
) -> R {
    let attrs: [(&[u8], Value<'_>); 3] = [
        (b"exception.type", Value::Str(ty)),
        (b"exception.message", Value::Str(message)),
        (b"exception.stacktrace", Value::Str(stack)),
    ];
    f(&attrs[..if stack.is_empty() { 2 } else { 3 }])
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

/// Streams one `Span` as a `ScopeSpans.spans` entry into `out`. The span's
/// length prefix is patched when the writer is finished or dropped.
pub struct SpanWriter<'a> {
    out: &'a mut Vec<u8>,
    nested: Nested<SPAN_LEN_RESERVE>,
    /// `attributeValueLengthLimit`, applied to every string value written
    /// through this writer and the event/link writers it opens.
    value_limit: usize,
}

impl<'a> SpanWriter<'a> {
    /// Writes identity, name, kind and timestamps.
    #[inline]
    pub fn begin(
        out: &'a mut Vec<u8>,
        stub: &SpanStub,
        name: &[u8],
        kind: SpanKind,
        end_ns: u64,
        value_limit: u32,
    ) -> SpanWriter<'a> {
        out.reserve(128 + name.len());
        let nested = Nested::begin(out, f::SS_SPANS);
        // Fixed-shape prefix assembled on the stack, appended once.
        const PREFIX_MAX: usize = 18 + 10 + 10 + 2 + 9 + 9 + 6;
        let mut b = [0u8; PREFIX_MAX];
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
        {
            // Never export end < start (an epoch re-anchor after a backward
            // clock step between the two reads; see clock.rs).
            let end_ns = end_ns.max(stub.start_ns);
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
        write_string(out, f::NAME, name);
        SpanWriter {
            out,
            nested,
            value_limit: value_limit as usize,
        }
    }

    #[inline]
    pub fn trace_state(&mut self, ts: &[u8]) -> &mut Self {
        proto::write_bytes_opt(self.out, f::TRACE_STATE, ts);
        self
    }

    #[inline]
    pub fn attr<'v>(&mut self, key: &str, v: impl Into<Value<'v>>) -> &mut Self {
        write_key_value_limited(
            self.out,
            f::ATTRIBUTES,
            key.as_bytes(),
            &v.into(),
            self.value_limit,
        );
        self
    }

    #[inline]
    pub fn attr_bytes_key<'v>(&mut self, key: &[u8], v: impl Into<Value<'v>>) -> &mut Self {
        write_key_value_limited(self.out, f::ATTRIBUTES, key, &v.into(), self.value_limit);
        self
    }

    /// String attribute, skipped when the value is empty.
    #[inline]
    pub fn attr_opt(&mut self, key: &str, v: &[u8]) -> &mut Self {
        if !v.is_empty() {
            write_key_value_limited(
                self.out,
                f::ATTRIBUTES,
                key.as_bytes(),
                &Value::Str(v),
                self.value_limit,
            );
        }
        self
    }

    /// semconv `server.address` (+ `server.port` when known, i.e. non-zero).
    #[inline]
    pub fn server(&mut self, host: &[u8], port: u16) -> &mut Self {
        self.attr_opt("server.address", host);
        if port != 0 {
            self.attr("server.port", port);
        }
        self
    }

    /// Splice already-encoded `Span` fields (attributes/events/links produced
    /// by `write_key_value(.., ATTRIBUTES, ..)` / [`EntryWriter`]).
    #[inline]
    pub fn raw(&mut self, encoded: &[u8]) -> &mut Self {
        self.out.extend_from_slice(encoded);
        self
    }

    pub fn dropped_attributes(&mut self, n: u32) -> &mut Self {
        proto::write_uint_opt(self.out, f::DROPPED_ATTRIBUTES, n as u64);
        self
    }
    pub fn dropped_events(&mut self, n: u32) -> &mut Self {
        proto::write_uint_opt(self.out, f::DROPPED_EVENTS, n as u64);
        self
    }
    pub fn dropped_links(&mut self, n: u32) -> &mut Self {
        proto::write_uint_opt(self.out, f::DROPPED_LINKS, n as u64);
        self
    }

    #[inline]
    pub fn begin_event(&mut self, name: &[u8], time_ns: u64) -> EntryWriter<'_> {
        EntryWriter::event(self.out, name, time_ns, self.value_limit)
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
        with_exception_attrs(ty, message, stack, |attrs| {
            self.begin_event(b"exception", crate::clock::or_now(time_ns))
                .attrs(attrs);
        });
        self
    }

    /// HTTP client semconv: `http.response.status_code`, and 4xx/5xx mark the
    /// span as an error with `error.type` = the status. (Server spans go
    /// through `http_record`, where only 5xx is an error.)
    pub fn http_client_status(&mut self, status: u16) -> &mut Self {
        if status != 0 {
            self.attr("http.response.status_code", status);
            if status >= 400 {
                let mut buf = bun_core::fmt::ItoaBuf::new();
                self.error(bun_core::fmt::itoa(&mut buf, status), b"");
            }
        }
        self
    }

    #[inline]
    pub fn begin_link(&mut self, ctx: &SpanContext, trace_state: &[u8]) -> EntryWriter<'_> {
        EntryWriter::link(self.out, ctx, trace_state, self.value_limit)
    }

    /// `Status{code, message}`; nothing for `Unset`. The description is only
    /// meaningful for `Error` (spec) and is dropped otherwise.
    #[inline]
    pub fn status(&mut self, code: StatusCode, message: &[u8]) -> &mut Self {
        if code == StatusCode::Unset {
            return self;
        }
        let message = if code == StatusCode::Error {
            message
        } else {
            b""
        };
        let body = if message.is_empty() {
            0
        } else {
            len_field_len(f::STATUS_MESSAGE, utf8_lossy_len(message))
        } + tag_len(f::STATUS_CODE)
            + 1;
        write_len_prefix(self.out, f::STATUS, body);
        if !message.is_empty() {
            write_string(self.out, f::STATUS_MESSAGE, message);
        }
        proto::write_uint(self.out, f::STATUS_CODE, code as u64);
        self
    }

    /// `error.type` attribute plus `Status{Error, message}`.
    #[inline]
    pub fn error(&mut self, ty: &[u8], message: &[u8]) -> &mut Self {
        self.attr("error.type", ty);
        self.status(StatusCode::Error, message)
    }

    /// A failed operation per semconv: `exception` event (type = `code`),
    /// `error.type` = `code`, status Error described by `message`
    /// (`code` when there is no message).
    pub fn fail(&mut self, code: &[u8], message: &[u8]) -> &mut Self {
        let message = if message.is_empty() { code } else { message };
        self.exception(0, code, message, b"");
        self.error(code, message)
    }

    /// Close the span (also happens on drop).
    #[inline]
    pub fn finish(self) {}

    /// End without patching the span length: the caller appends more `Span`
    /// fields and then runs `Nested::<SPAN_LEN_RESERVE>::at(len_at).finish()`
    /// with the returned `len_at`.
    pub fn finish_unpatched(self) -> usize {
        let me = core::mem::ManuallyDrop::new(self);
        me.nested.len_at()
    }
}

impl Drop for SpanWriter<'_> {
    #[inline]
    fn drop(&mut self) {
        Nested::<SPAN_LEN_RESERVE>::at(self.nested.len_at()).finish(self.out);
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

/// Streams one `Span.events` / `Span.links` entry: the fixed fields are
/// written by [`event`](Self::event) / [`link`](Self::link), then `attr`s.
/// The entry's length prefix is patched when the writer drops.
pub struct EntryWriter<'a> {
    out: &'a mut Vec<u8>,
    nested: Nested<2>,
    field: u32,
    /// `attributeValueLengthLimit` for string values written through `attr`.
    value_limit: usize,
}

impl<'a> EntryWriter<'a> {
    #[inline]
    pub fn event(
        out: &'a mut Vec<u8>,
        name: &[u8],
        time_ns: u64,
        value_limit: usize,
    ) -> EntryWriter<'a> {
        let nested = Nested::begin(out, f::EVENTS);
        proto::write_fixed64(out, f::EV_TIME, time_ns);
        write_string(out, f::EV_NAME, name);
        EntryWriter {
            out,
            nested,
            field: f::EV_ATTRIBUTES,
            value_limit,
        }
    }
    #[inline]
    pub fn link(
        out: &'a mut Vec<u8>,
        ctx: &SpanContext,
        trace_state: &[u8],
        value_limit: usize,
    ) -> EntryWriter<'a> {
        let nested = Nested::begin(out, f::LINKS);
        proto::write_bytes(out, f::LINK_TRACE_ID, &ctx.trace_id.0);
        proto::write_bytes(out, f::LINK_SPAN_ID, &ctx.span_id.0);
        proto::write_bytes_opt(out, f::LINK_TRACE_STATE, trace_state);
        proto::write_fixed32(
            out,
            f::LINK_FLAGS,
            ctx.flags.otlp_with_remote(ctx.flags.remote()),
        );
        EntryWriter {
            out,
            nested,
            field: f::LINK_ATTRIBUTES,
            value_limit,
        }
    }
    #[inline]
    pub fn attr(&mut self, key: &[u8], v: &Value<'_>) {
        write_key_value_limited(self.out, self.field, key, v, self.value_limit);
    }
    #[inline]
    pub fn attrs(&mut self, attrs: &[(&[u8], Value<'_>)]) -> &mut Self {
        for (k, v) in attrs {
            self.attr(k, v);
        }
        self
    }
}

impl Drop for EntryWriter<'_> {
    #[inline]
    fn drop(&mut self) {
        Nested::<2>::at(self.nested.len_at()).finish(self.out);
    }
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
    let total: usize = 17
        + resource.len()
        + scopes
            .iter()
            .map(|s| 13 + s.scope.len() + s.spans.len())
            .sum::<usize>();
    let mut out = Vec::with_capacity(total);
    let rs = Nested::<5>::begin(&mut out, f::RESOURCE_SPANS);
    write_len_prefix(&mut out, f::RS_RESOURCE, resource.len());
    out.extend_from_slice(resource);
    for s in scopes {
        let ss = Nested::<5>::begin(&mut out, f::RS_SCOPE_SPANS);
        write_len_prefix(&mut out, f::SS_SCOPE, s.scope.len());
        out.extend_from_slice(s.scope);
        out.extend_from_slice(s.spans);
        ss.finish(&mut out);
    }
    rs.finish(&mut out);
    out
}

#[cfg(test)]
mod redact_tests {
    use super::{redact_query, redact_url};

    #[test]
    fn bare_query_is_never_reparsed_as_a_url() {
        assert_eq!(
            &*redact_query(b"redirect_uri=https://app.example.com&sig=SECRET"),
            b"redirect_uri=https://app.example.com&sig=REDACTED"
        );
        assert_eq!(
            &*redact_query(b"sig=SECRET&next=/a?b=c"),
            b"sig=REDACTED&next=/a?b=c"
        );
        assert_eq!(&*redact_query(b"a=1&b=2"), b"a=1&b=2");
        assert!(matches!(
            redact_query(b"a=1"),
            std::borrow::Cow::Borrowed(_)
        ));
    }

    #[test]
    fn url_query_and_fragment() {
        assert_eq!(
            &*redact_url(b"https://s3/x?X-Amz-Date=1&X-Amz-Signature=abc&X-Amz-Credential=c&X-Amz-Security-Token=t#frag"),
            b"https://s3/x?X-Amz-Date=1&X-Amz-Signature=REDACTED&X-Amz-Credential=REDACTED&X-Amz-Security-Token=REDACTED#frag"
        );
        assert!(matches!(
            redact_url(b"https://h/p?q=1"),
            std::borrow::Cow::Borrowed(_)
        ));
        assert!(matches!(
            redact_url(b"https://h/p"),
            std::borrow::Cow::Borrowed(_)
        ));
    }
}

#[cfg(test)]
mod utf8_tests {
    #[test]
    fn lossy() {
        let mut out = Vec::new();
        super::extend_utf8_lossy(&mut out, b"curl/\xff8.0 \xe2\x82\xac");
        assert_eq!(out, "curl/\u{FFFD}8.0 €".as_bytes());
        assert!(matches!(
            super::utf8_lossy(b"plain"),
            std::borrow::Cow::Borrowed(_)
        ));
    }
}

#[cfg(test)]
mod span_writer_tests {
    use super::{SpanWriter, field as f};
    use crate::proto::Reader;
    use crate::span::{Flags, SpanContext, SpanId, SpanKind, SpanStub, StatusCode, TraceId};

    /// A dropped (never `finish`ed) writer still leaves a well-formed span, and
    /// the value limit given at `begin` reaches event attributes.
    #[test]
    fn dropped_writer_patches_length_and_limits_event_values() {
        let stub = SpanStub {
            ctx: SpanContext {
                trace_id: TraceId([1; 16]),
                span_id: SpanId([2; 8]),
                flags: Flags::from_w3c(Flags::SAMPLED),
            },
            parent: SpanId([0; 8]),
            start_ns: 5,
        };
        let mut out = Vec::new();
        {
            let mut w = SpanWriter::begin(&mut out, &stub, b"op", SpanKind::Client, 9, 4);
            w.fail(b"CODE", b"a-long-message");
        }
        let mut r = Reader::new(&out);
        let (field, span) = r.next().unwrap().unwrap();
        assert_eq!(field, f::SS_SPANS);
        assert!(r.next().unwrap().is_none(), "exactly one span");

        let mut exception_message = None;
        let mut error_type = None;
        let mut status = None;
        let mut span = Reader::new(span.as_bytes());
        while let Some((field, v)) = span.next().unwrap() {
            let string_attr = |kv: &[u8]| {
                let mut kv = Reader::new(kv);
                let (_, k) = kv.next().unwrap().unwrap();
                let (_, av) = kv.next().unwrap().unwrap();
                let (_, s) = Reader::new(av.as_bytes()).next().unwrap().unwrap();
                (k.as_bytes().to_vec(), s.as_bytes().to_vec())
            };
            match field {
                f::ATTRIBUTES => {
                    let (k, v) = string_attr(v.as_bytes());
                    if k == b"error.type" {
                        error_type = Some(v);
                    }
                }
                f::EVENTS => {
                    let mut ev = Reader::new(v.as_bytes());
                    while let Some((field, v)) = ev.next().unwrap() {
                        if field == f::EV_ATTRIBUTES {
                            let (k, v) = string_attr(v.as_bytes());
                            if k == b"exception.message" {
                                exception_message = Some(v);
                            }
                        }
                    }
                }
                f::STATUS => {
                    let mut st = Reader::new(v.as_bytes());
                    let mut code = 0;
                    let mut message = Vec::new();
                    while let Some((field, v)) = st.next().unwrap() {
                        match field {
                            f::STATUS_CODE => code = v.as_u64(),
                            f::STATUS_MESSAGE => message = v.as_bytes().to_vec(),
                            _ => {}
                        }
                    }
                    status = Some((code, message));
                }
                _ => {}
            }
        }
        assert_eq!(exception_message.as_deref(), Some(&b"a-lo"[..]));
        assert_eq!(error_type.as_deref(), Some(&b"CODE"[..]));
        // The status description is not an attribute: the limit does not apply.
        assert_eq!(
            status,
            Some((StatusCode::Error as u64, b"a-long-message".to_vec()))
        );
    }

    /// `Unset` writes no `Status` at all; a non-Error description is dropped.
    #[test]
    fn status_unset_and_ok() {
        let mut out = Vec::new();
        let prefix = {
            let mut w =
                SpanWriter::begin(&mut out, &SpanStub::NONE, b"op", SpanKind::Internal, 0, 9);
            let prefix = w.out.len();
            w.status(StatusCode::Unset, b"ignored")
                .status(StatusCode::Ok, b"dropped");
            prefix
        };
        let mut tail = Reader::new(&out[prefix..]);
        let (field, st) = tail.next().unwrap().unwrap();
        assert_eq!(field, f::STATUS);
        assert!(tail.next().unwrap().is_none(), "one Status message");
        let mut st = Reader::new(st.as_bytes());
        let (field, code) = st.next().unwrap().unwrap();
        assert_eq!(
            (field, code.as_u64()),
            (f::STATUS_CODE, StatusCode::Ok as u64)
        );
        assert!(st.next().unwrap().is_none(), "no message");
    }
}
