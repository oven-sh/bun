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
use crate::span::{SpanContext, SpanStub, StatusCode};

/// Length bytes reserved after the `ScopeSpans.spans` tag by [`SpanWriter`].
const SPAN_LEN_RESERVE: usize = 2;

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
    /// A `null` in an array.
    Empty,
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
impl From<bool> for Value<'_> {
    #[inline]
    fn from(v: bool) -> Self {
        Value::Bool(v)
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
#[optimize(speed)]
fn any_value_body_len(v: &Value<'_>) -> usize {
    match *v {
        Value::Str(s) => len_field_len(f::AV_STRING, utf8_lossy_len(s)),
        Value::Bool(_) => tag_len(f::AV_BOOL) + 1,
        Value::Int(i) => tag_len(f::AV_INT) + varint_len(i as u64),
        Value::Double(_) => tag_len(f::AV_DOUBLE) + 8,
        Value::Array(items) => len_field_len(f::AV_ARRAY, array_body_len(items)),
        Value::Empty => 0,
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
#[optimize(speed)]
fn write_any_value_body(out: &mut Vec<u8>, v: &Value<'_>) {
    match *v {
        Value::Str(s) => write_string(out, f::AV_STRING, s),
        Value::Bool(b) => proto::write_bool(out, f::AV_BOOL, b),
        Value::Int(i) => {
            write_tag(out, f::AV_INT, WireType::Varint);
            write_varint(out, i as u64);
        }
        Value::Double(d) => proto::write_double(out, f::AV_DOUBLE, d),
        Value::Empty => {}
        Value::Array(items) => {
            write_len_prefix(out, f::AV_ARRAY, array_body_len(items));
            for v in items {
                write_len_prefix(out, f::ARR_VALUES, any_value_body_len(v));
                write_any_value_body(out, v);
            }
        }
    }
}

/// [`write_key_value`] with `attributeValueLengthLimit` applied to string
/// values, including the string elements of an array value.
#[optimize(speed)]
pub fn write_key_value_limited(
    out: &mut Vec<u8>,
    field: u32,
    key: &[u8],
    v: &Value<'_>,
    max: usize,
) {
    match *v {
        Value::Str(s) if s.len() > max => {
            write_key_value(out, field, key, &Value::Str(truncate_chars(s, max)))
        }
        Value::Array(items)
            if items
                .iter()
                .any(|i| matches!(i, Value::Str(s) if s.len() > max)) =>
        {
            let limited: Vec<Value<'_>> = items
                .iter()
                .map(|i| match *i {
                    Value::Str(s) => Value::Str(truncate_chars(s, max)),
                    other => other,
                })
                .collect();
            write_key_value(out, field, key, &Value::Array(&limited))
        }
        _ => write_key_value(out, field, key, v),
    }
}

#[optimize(speed)]
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

/// Query-string keys whose values are credentials (the semconv url.full /
/// url.query redaction set; also what @opentelemetry/instrumentation-http uses).
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

/// `url` without the credentials in its userinfo and, through [`redact_query`], in its query.
pub fn redact_url(url: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    use bun_core::strings;
    use std::borrow::Cow;
    let authority = strings::index_of(url, b"://").map_or(0, |i| i + 3);
    let after = |from: usize, ends: &[u8]| {
        strings::index_of_any(&url[from..], ends).map_or(url.len(), |i| from + i)
    };
    let path = after(authority, b"/?#");
    let at = strings::last_index_of_char(&url[authority..path], b'@').map(|i| authority + i);
    let path_end = after(path, b"?#");
    let query_start = (path_end + 1).min(url.len());
    let query_end = match url.get(path_end) {
        Some(b'?') => after(query_start, b"#"),
        _ => query_start,
    };
    let query = redact_query(&url[query_start..query_end]);
    if at.is_none() && matches!(query, Cow::Borrowed(_)) {
        return Cow::Borrowed(url);
    }
    let (userinfo, host): (&[u8], _) = match at {
        Some(at) => (b"REDACTED:REDACTED", at),
        None => (b"", authority),
    };
    let parts = [
        &url[..authority],
        userinfo,
        &url[host..query_start],
        &query,
        &url[query_end..],
    ];
    Cow::Owned(parts.concat())
}

/// `text` without what [`redact_url`] takes out of a URL. Where one ends is not known: URLs may follow one another
/// behind a quote, or lie in a query.
#[optimize(size)]
pub fn redact_urls_in(text: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    use bun_core::strings;
    use std::borrow::Cow;
    const SPACE: &[u8] = b" \t\r\n\"`<>";
    let until = |from: usize, end: usize, any: &[u8]| {
        strings::index_of_any(&text[from..end], any).map_or(end, |i| from + i)
    };
    let (mut out, mut copied, mut word_end) = (Vec::new(), 0, 0);
    while let Some(first) = strings::index_of(&text[word_end..], b"://") {
        let mut at = word_end + first;
        word_end = until(at, text.len(), SPACE);
        while at < word_end {
            let rest = &text[at..word_end];
            let secret = if rest.starts_with(b"://") {
                let authority = &text[at + 3..until(at + 3, word_end, b"/?#")];
                strings::last_index_of_char(authority, b'@')
                    .map(|len| (at + 3..at + 3 + len, &b"REDACTED:REDACTED"[..]))
            } else if matches!(rest[0], b'?' | b'&') {
                (REDACTED_QUERY_KEYS.iter())
                    .find(|key| {
                        rest[1..].starts_with(key) && rest.get(1 + key.len()) == Some(&b'=')
                    })
                    .map(|key| at + key.len() + 2)
                    .map(|value| {
                        let secret = &text[value..until(value, word_end, b"&#'")];
                        let len = strings::trim_right(secret, b"),.;").len();
                        (value..value + len, &b"REDACTED"[..])
                    })
            } else {
                None
            };
            if let Some((range, replacement)) = secret {
                out.extend_from_slice(&text[copied..range.start]);
                out.extend_from_slice(replacement);
                (copied, at) = (range.end, range.end);
            } else {
                at = until(at + 1, word_end, b":?&");
            }
        }
    }
    if copied == 0 {
        return Cow::Borrowed(text);
    }
    out.extend_from_slice(&text[copied..]);
    Cow::Owned(out)
}

/// Append `s` (bytes off the wire: a request target, a header value) to
/// `out` as valid UTF-8, replacing invalid sequences with U+FFFD. proto3
/// `string` fields must be UTF-8 or receivers reject the whole request; the
/// ASCII case (nearly always) is one SIMD scan and a copy.
#[inline]
#[optimize(speed)]
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

/// The first `max` characters of `s`. What is no UTF-8 counts as the U+FFFD that replaces it.
fn truncate_chars(s: &[u8], max: usize) -> &[u8] {
    let lengths = s.utf8_chunks().flat_map(|chunk| {
        let invalid = Some(chunk.invalid().len()).filter(|&len| len != 0);
        chunk.valid().chars().map(char::len_utf8).chain(invalid)
    });
    &s[..lengths.take(max).sum()]
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
    if (s[end] & 0xC0) == 0x80 {
        &s[..max]
    } else {
        &s[..end]
    }
}

/// The semconv `exception.*` attributes. An empty one is left out.
#[derive(Clone, Copy)]
pub struct Exception<'a> {
    pub ty: &'a [u8],
    pub message: &'a [u8],
    pub stack: &'a [u8],
}

impl Exception<'_> {
    pub(crate) fn write(&self, event: &mut EntryWriter<'_>) {
        for (key, value) in [
            ("exception.type", self.ty),
            ("exception.message", self.message),
            ("exception.stacktrace", self.stack),
        ] {
            if !value.is_empty() {
                event.attr(key.as_bytes(), &Value::Str(&redact_urls_in(value)));
            }
        }
    }
}

/// The whole `Span.attributes` entry for `key` among encoded `Span` fields.
#[optimize(speed)]
pub fn find_attribute(fields: &[u8], key: &[u8]) -> Option<core::ops::Range<usize>> {
    let mut r = proto::Reader::new(fields);
    loop {
        let start = r.pos;
        let (field, entry) = r.next().ok()??;
        if field == f::ATTRIBUTES
            && let Ok(Some((f::KV_KEY, k))) = proto::Reader::new(entry.as_bytes()).next()
            && k.as_bytes() == key
        {
            return Some(start..r.pos);
        }
    }
}

/// Streams one `Span` as a `ScopeSpans.spans` entry into `out`. The span's
/// length prefix is patched when the writer is finished or dropped.
pub struct SpanWriter<'a> {
    out: &'a mut Vec<u8>,
    nested: Nested<SPAN_LEN_RESERVE>,
}

impl<'a> SpanWriter<'a> {
    /// Writes identity, name, kind and timestamps.
    #[inline]
    #[optimize(speed)]
    pub fn begin(
        out: &'a mut Vec<u8>,
        stub: &SpanStub,
        name: &[u8],
        end_ns: u64,
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
        b[n + 1] = stub.kind as u8;
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
        SpanWriter { out, nested }
    }

    #[inline]
    pub fn trace_state(&mut self, ts: &[u8]) -> &mut Self {
        proto::write_bytes_opt(self.out, f::TRACE_STATE, ts);
        self
    }

    #[inline]
    pub fn attr(&mut self, key: &str, v: &Value<'_>, max_len: usize) -> &mut Self {
        write_key_value_limited(self.out, f::ATTRIBUTES, key.as_bytes(), v, max_len);
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
    /// Attributes that are encoded already.
    #[inline]
    pub fn raw(&mut self, encoded: &[u8]) {
        self.out.extend_from_slice(encoded);
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

/// An `ExportTraceServiceRequest`.
pub struct RequestWriter {
    out: Vec<u8>,
    resource_spans: Nested<5>,
}

impl RequestWriter {
    /// `out` is there for its capacity.
    pub fn new(mut out: Vec<u8>, resource: &[u8], spans_len_hint: usize) -> RequestWriter {
        out.clear();
        out.reserve(17 + resource.len() + spans_len_hint);
        let resource_spans = Nested::begin(&mut out, f::RESOURCE_SPANS);
        proto::write_bytes(&mut out, f::RS_RESOURCE, resource);
        RequestWriter {
            out,
            resource_spans,
        }
    }

    /// `write_spans` appends `ScopeSpans.spans` entries.
    pub fn scope(&mut self, scope: &[u8], write_spans: impl FnOnce(&mut Vec<u8>)) {
        let scope_spans = Nested::<5>::begin(&mut self.out, f::RS_SCOPE_SPANS);
        proto::write_bytes(&mut self.out, f::SS_SCOPE, scope);
        write_spans(&mut self.out);
        scope_spans.finish(&mut self.out);
    }

    pub fn finish(mut self) -> Vec<u8> {
        self.resource_spans.finish(&mut self.out);
        self.out
    }
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
    fn urls_in_a_text() {
        for (text, redacted) in [
            (
                "'http://a/','http://u:p@b/'",
                "'http://a/','http://REDACTED:REDACTED@b/'",
            ),
            (
                "'http://a/?x=1','http://b/?sig=1'",
                "'http://a/?x=1','http://b/?sig=REDACTED'",
            ),
            (
                "http://a/?to=http://u:p@b/&sig=1&y",
                "http://a/?to=http://REDACTED:REDACTED@b/&sig=REDACTED&y",
            ),
            ("http://a/?sig=", "http://a/?sig=REDACTED"),
            ("(http://a/?sig=,a,b).", "(http://a/?sig=REDACTED)."),
            (
                "http://@a ://:// ?sig=1",
                "http://REDACTED:REDACTED@a ://:// ?sig=1",
            ),
        ] {
            assert_eq!(
                &*super::redact_urls_in(text.as_bytes()),
                redacted.as_bytes()
            );
        }
        assert_eq!(
            &*super::redact_urls_in(b"'ws://u:a'b@h/?sig=1', x"),
            b"'ws://REDACTED:REDACTED@h/?sig=REDACTED', x"
        );
        assert_eq!(
            &*super::redact_urls_in(b"a \"http://h/?sig=1\" b ws://u:p@h c http://h/ok\n://"),
            b"a \"http://h/?sig=REDACTED\" b ws://REDACTED:REDACTED@h c http://h/ok\n://"
        );
    }

    #[test]
    fn url_query_and_fragment() {
        assert_eq!(
            &*redact_url(b"https://s3/x?X-Amz-Date=1&X-Amz-Signature=abc&X-Amz-Credential=c&X-Amz-Security-Token=t#frag"),
            b"https://s3/x?X-Amz-Date=1&X-Amz-Signature=REDACTED&X-Amz-Credential=REDACTED&X-Amz-Security-Token=REDACTED#frag"
        );
        assert_eq!(
            &*redact_url(b"https://u:p@h/a@b?sig=1#x?sig=2"),
            b"https://REDACTED:REDACTED@h/a@b?sig=REDACTED#x?sig=2"
        );
        assert_eq!(
            &*redact_url(b"http://token@h"),
            b"http://REDACTED:REDACTED@h"
        );
        assert_eq!(&*redact_url(b"http://h/#?sig=1"), b"http://h/#?sig=1");
        assert_eq!(&*redact_url(b"http://h/?"), b"http://h/?");
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
    }
}

#[cfg(test)]
mod span_writer_tests {
    use super::{SpanWriter, field as f};
    use crate::proto::Reader;
    use crate::span::{SpanContext, SpanStub, StatusCode};

    /// `Unset` writes no `Status` at all; a non-Error description is dropped.
    #[test]
    fn status_unset_and_ok() {
        let mut out = Vec::new();
        let prefix = {
            let stub = SpanStub::carrier(SpanContext::default(), false);
            let mut w = SpanWriter::begin(&mut out, &stub, b"op", 0);
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
