//! HTTP server spans are recorded as a compact "facts" record on the request
//! path and expanded into an OTLP `Span` when the batch is exported, so the
//! per-request cost on the JS thread is a handful of copies rather than
//! attribute-by-attribute protobuf encoding.
//!
//! A record travels in the per-scope span buffer as `ScopeSpans` field
//! [`FIELD`] (unused by the OTLP schema); [`expand_into`] rewrites a buffer
//! that may contain records into plain `spans` entries.

use crate::data::Limits;
use crate::otlp::{self, SpanWriter, Value, field as f};
use crate::proto;
use crate::span::{Flags, SpanContext, SpanId, SpanKind, SpanStub, TraceId};
use crate::StatusCode;

/// `ScopeSpans` field number carrying a record (wire type LEN).
pub const FIELD: u32 = 15;
pub const TAG: u8 = (FIELD << 3 | 2) as u8;

pub const FLAG_HTTPS: u8 = 1;
pub const FLAG_ABORTED: u8 = 2;
pub const FLAG_HANDLER_ERROR: u8 = 4;

// Tags of the length-prefixed strings in `Facts::raw` (u8 tag, u16 le len).
pub const S_URL: u8 = 1;
pub const S_HOST: u8 = 2;
pub const S_UA: u8 = 3;
pub const S_ROUTE: u8 = 4;

const HEADER_LEN: usize = 82;

/// Request facts captured at begin; lives in the pool slot.
pub struct Facts {
    /// Tagged strings: url, host, user-agent, route.
    pub raw: Vec<u8>,
    pub method: [u8; 8],
    pub ip: [u8; 16],
    pub ip_len: u8,
    pub flags: u8,
    pub client_port: u16,
    pub status: u16,
    /// This slot holds an HTTP server record rather than a generic span.
    pub active: bool,
}

impl Facts {
    pub const fn new() -> Facts {
        Facts { raw: Vec::new(), method: [0; 8], ip: [0; 16], ip_len: 0, flags: 0, client_port: 0, status: 0, active: false }
    }

    #[inline]
    pub fn reset(&mut self) {
        self.raw.clear();
        self.active = false;
        self.flags = 0;
        self.status = 0;
        self.ip_len = 0;
        if self.raw.capacity() > 16 * 1024 {
            self.raw = Vec::new();
        }
    }

    #[inline]
    pub fn set_method(&mut self, m: &[u8]) {
        let n = m.len().min(7);
        self.method = [0; 8];
        self.method[0] = n as u8;
        self.method[1..1 + n].copy_from_slice(&m[..n]);
    }

    /// Append one tagged string (truncated to u16).
    #[inline]
    pub fn push(&mut self, tag: u8, s: &[u8]) {
        let s = &s[..s.len().min(u16::MAX as usize)];
        let n = s.len() as u16;
        self.raw.reserve(3 + s.len());
        self.raw.extend_from_slice(&[tag, n as u8, (n >> 8) as u8]);
        self.raw.extend_from_slice(s);
    }

    /// Emit the record for this span into `out` (a scope span buffer).
    pub fn write(
        &self,
        out: &mut Vec<u8>,
        stub: &SpanStub,
        end_ns: u64,
        name_override: &[u8],
        trace_state: &[u8],
        attrs: &[u8],
        dropped_attrs: u16,
        extra: &[u8],
        status: StatusCode,
        status_message: &[u8],
    ) {
        let name_override = &name_override[..name_override.len().min(u16::MAX as usize)];
        let trace_state = &trace_state[..trace_state.len().min(u16::MAX as usize)];
        let status_message = &status_message[..status_message.len().min(u16::MAX as usize)];
        let body = HEADER_LEN
            + 4 + self.raw.len()
            + 4 + attrs.len()
            + 4 + extra.len()
            + 2 + trace_state.len()
            + 2 + name_override.len()
            + 3 + status_message.len();
        out.reserve(6 + body);
        let mut h = [0u8; HEADER_LEN + 6];
        h[0] = TAG;
        let mut n = 1 + proto::write_varint_into(&mut h[1..6], body as u64);
        let base = n;
        h[n] = 1;
        h[n + 1] = self.flags;
        h[n + 2..n + 10].copy_from_slice(&self.method);
        h[n + 10] = self.ip_len;
        h[n + 11..n + 27].copy_from_slice(&self.ip);
        h[n + 27..n + 29].copy_from_slice(&self.client_port.to_le_bytes());
        h[n + 29..n + 31].copy_from_slice(&self.status.to_le_bytes());
        h[n + 31..n + 39].copy_from_slice(&stub.start_ns.to_le_bytes());
        h[n + 39..n + 47].copy_from_slice(&end_ns.to_le_bytes());
        h[n + 47..n + 63].copy_from_slice(&stub.ctx.trace_id.0);
        h[n + 63..n + 71].copy_from_slice(&stub.ctx.span_id.0);
        h[n + 71..n + 79].copy_from_slice(&stub.parent.0);
        h[n + 79] = stub.ctx.flags.0;
        h[n + 80..n + 82].copy_from_slice(&dropped_attrs.to_le_bytes());
        n += HEADER_LEN;
        debug_assert_eq!(n - base, HEADER_LEN);
        out.extend_from_slice(&h[..n]);
        put32(out, &self.raw);
        put32(out, attrs);
        put32(out, extra);
        put16(out, trace_state);
        put16(out, name_override);
        out.push(status as u8);
        put16(out, status_message);
    }
}

#[inline]
fn put32(out: &mut Vec<u8>, s: &[u8]) {
    out.extend_from_slice(&(s.len() as u32).to_le_bytes());
    out.extend_from_slice(s);
}

#[inline]
fn put16(out: &mut Vec<u8>, s: &[u8]) {
    out.extend_from_slice(&(s.len() as u16).to_le_bytes());
    out.extend_from_slice(s);
}

struct Cursor<'a> {
    b: &'a [u8],
}

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.b.len() < n {
            return None;
        }
        let (a, rest) = self.b.split_at(n);
        self.b = rest;
        Some(a)
    }
    fn u16(&mut self) -> Option<u16> {
        self.take(2).map(|b| u16::from_le_bytes([b[0], b[1]]))
    }
    fn u32(&mut self) -> Option<u32> {
        self.take(4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn str32(&mut self) -> Option<&'a [u8]> {
        let n = self.u32()? as usize;
        self.take(n)
    }
    fn str16(&mut self) -> Option<&'a [u8]> {
        let n = self.u16()? as usize;
        self.take(n)
    }
}

/// Whether `spans` (a scope buffer) contains any record needing expansion.
pub fn has_records(spans: &[u8]) -> bool {
    let mut r = proto::Reader::new(spans);
    while let Ok(Some((field, _))) = r.next() {
        if field == FIELD {
            return true;
        }
    }
    false
}

/// Copy `spans` into `out`, expanding records into `Span` entries.
pub fn expand_into(out: &mut Vec<u8>, spans: &[u8], limits: &Limits) {
    let mut x = Expander::new(limits);
    let mut r = proto::Reader::new(spans);
    let mut last = 0;
    loop {
        let start = r.pos;
        let Ok(Some((field, body))) = r.next() else { break };
        if field != FIELD {
            continue;
        }
        out.extend_from_slice(&spans[last..start]);
        last = r.pos;
        x.expand_one(out, body.as_bytes());
    }
    out.extend_from_slice(&spans[last..]);
}

/// Consecutive server spans usually differ only in ids, times, path and
/// client port. The encoding of everything else is cached as a template
/// keyed by the remaining record bytes; a hit is one copy plus fixed-offset
/// patches and the per-request attributes appended at the end.
struct Template {
    hash: u64,
    key: Vec<u8>,
    /// Encoded span up to (not including) the per-request tail.
    bytes: Vec<u8>,
    has_parent: bool,
}

const TEMPLATES: usize = 8;

pub struct Expander<'l> {
    limits: &'l Limits,
    templates: Vec<Template>,
    next_evict: usize,
    key: Vec<u8>,
}

struct Parsed<'a> {
    flags: u8,
    method: &'a [u8],
    ip: &'a [u8],
    client_port: u16,
    status: u16,
    start_ns: u64,
    end_ns: u64,
    trace_id: [u8; 16],
    span_id: [u8; 8],
    parent: [u8; 8],
    trace_flags: u8,
    dropped_attrs: u16,
    url: &'a [u8],
    host: &'a [u8],
    ua: &'a [u8],
    route: &'a [u8],
    attrs: &'a [u8],
    extra: &'a [u8],
    trace_state: &'a [u8],
    name_override: &'a [u8],
    status_code: u8,
    status_message: &'a [u8],
    /// `raw` minus the leading url entry (template key material).
    raw_rest: &'a [u8],
}

fn parse(body: &[u8]) -> Option<Parsed<'_>> {
    let mut c = Cursor { b: body };
    let h = c.take(HEADER_LEN)?;
    if h[0] != 1 {
        return None;
    }
    let raw = c.str32()?;
    let attrs = c.str32()?;
    let extra = c.str32()?;
    let trace_state = c.str16()?;
    let name_override = c.str16()?;
    let status_code = c.take(1)?[0];
    let status_message = c.str16()?;
    let (mut url, mut host, mut ua, mut route): (&[u8], &[u8], &[u8], &[u8]) = (b"", b"", b"", b"");
    let mut raw_rest = raw;
    let mut s = Cursor { b: raw };
    let mut first = true;
    while let Some(t) = s.take(3) {
        let n = u16::from_le_bytes([t[1], t[2]]) as usize;
        let Some(v) = s.take(n) else { break };
        match t[0] {
            S_URL => {
                url = v;
                if first {
                    raw_rest = s.b;
                }
            }
            S_HOST => host = v,
            S_UA => ua = v,
            S_ROUTE => route = v,
            _ => {}
        }
        first = false;
    }
    Some(Parsed {
        flags: h[1],
        method: &h[3..3 + (h[2].min(7) as usize)],
        ip: &h[11..11 + (h[10] as usize).min(16)],
        client_port: u16::from_le_bytes([h[27], h[28]]),
        status: u16::from_le_bytes([h[29], h[30]]),
        start_ns: u64::from_le_bytes(h[31..39].try_into().ok()?),
        end_ns: u64::from_le_bytes(h[39..47].try_into().ok()?),
        trace_id: h[47..63].try_into().ok()?,
        span_id: h[63..71].try_into().ok()?,
        parent: h[71..79].try_into().ok()?,
        trace_flags: h[79],
        dropped_attrs: u16::from_le_bytes([h[80], h[81]]),
        url,
        host,
        ua,
        route,
        attrs,
        extra,
        trace_state,
        name_override,
        status_code,
        status_message,
        raw_rest,
    })
}

// Byte offsets inside an encoded span (see SpanWriter::begin): tag, two
// length bytes, then the fixed-shape prefix.
const OFF_TRACE_ID: usize = 3 + 2;
const OFF_SPAN_ID: usize = OFF_TRACE_ID + 16 + 2;
const OFF_PARENT: usize = OFF_SPAN_ID + 8 + 2;
#[inline]
fn off_start(has_parent: bool) -> usize {
    (if has_parent { OFF_PARENT + 8 } else { OFF_SPAN_ID + 8 }) + 2 + 1
}

impl<'l> Expander<'l> {
    pub fn new(limits: &'l Limits) -> Self {
        Expander { limits, templates: Vec::with_capacity(TEMPLATES), next_evict: 0, key: Vec::with_capacity(256) }
    }

    pub fn expand_one(&mut self, out: &mut Vec<u8>, body: &[u8]) -> Option<()> {
        let p = parse(body)?;
        // Tiny attribute budgets make the appended tail interact with the
        // dropped count; not worth templating.
        if self.limits.attributes < 16 {
            return expand_slow(out, &p, self.limits, true).map(|_| ());
        }
        let has_parent = p.parent != [0u8; 8];
        let key = &mut self.key;
        key.clear();
        key.extend_from_slice(&[p.flags, has_parent as u8, p.status_code, p.method.len() as u8, p.ip.len() as u8]);
        key.extend_from_slice(p.method);
        key.extend_from_slice(p.ip);
        key.extend_from_slice(&p.status.to_le_bytes());
        key.extend_from_slice(&p.dropped_attrs.to_le_bytes());
        for part in [p.raw_rest, p.attrs, p.extra, p.trace_state, p.name_override, p.status_message] {
            key.extend_from_slice(&(part.len() as u32).to_le_bytes());
            key.extend_from_slice(part);
        }
        let hash = bun_wyhash::hash(key);
        let idx = self.templates.iter().position(|t| t.hash == hash && t.key == *key);
        let idx = match idx {
            Some(i) => i,
            None => {
                let start = out.len();
                let tail_at = expand_slow(out, &p, self.limits, false)?;
                let t = Template { hash, key: key.clone(), bytes: out[start..tail_at].to_vec(), has_parent };
                debug_assert_eq!(&t.bytes[OFF_TRACE_ID..OFF_TRACE_ID + 16], &p.trace_id);
                debug_assert_eq!(&t.bytes[OFF_SPAN_ID..OFF_SPAN_ID + 8], &p.span_id);
                debug_assert_eq!(&t.bytes[off_start(has_parent)..off_start(has_parent) + 8], &p.start_ns.to_le_bytes());
                debug_assert_eq!(&t.bytes[off_start(has_parent) + 9..off_start(has_parent) + 17], &p.end_ns.to_le_bytes());
                // Finish this span: append the per-request tail and patch the length.
                append_tail(out, start, &p, self.limits);
                if self.templates.len() < TEMPLATES {
                    self.templates.push(t);
                } else {
                    let i = self.next_evict;
                    self.templates[i] = t;
                    self.next_evict = (i + 1) % TEMPLATES;
                }
                return Some(());
            }
        };
        let t = &self.templates[idx];
        let s = out.len();
        out.extend_from_slice(&t.bytes);
        out[s + OFF_TRACE_ID..s + OFF_TRACE_ID + 16].copy_from_slice(&p.trace_id);
        out[s + OFF_SPAN_ID..s + OFF_SPAN_ID + 8].copy_from_slice(&p.span_id);
        if t.has_parent {
            out[s + OFF_PARENT..s + OFF_PARENT + 8].copy_from_slice(&p.parent);
        }
        let st = s + off_start(t.has_parent);
        out[st..st + 8].copy_from_slice(&p.start_ns.to_le_bytes());
        out[st + 9..st + 17].copy_from_slice(&p.end_ns.to_le_bytes());
        // flags: 2-byte tag then fixed32
        out[st + 19..st + 23].copy_from_slice(&Flags(p.trace_flags).otlp().to_le_bytes());
        append_tail(out, s, &p, self.limits);
        Some(())
    }
}

/// Per-request attributes after the templated part, then the span length.
fn append_tail(out: &mut Vec<u8>, span_start: usize, p: &Parsed<'_>, limits: &Limits) {
    let max = limits.attribute_value_length as usize;
    let (path, query) = match otlp_memchr(p.url, b'?') {
        Some(i) => (&p.url[..i], &p.url[i + 1..]),
        None => (p.url, &b""[..]),
    };
    otlp::write_key_value(out, f::ATTRIBUTES, b"url.path", &Value::Str(otlp::truncate_utf8(path, max)));
    if !query.is_empty() {
        otlp::write_key_value(out, f::ATTRIBUTES, b"url.query", &Value::Str(otlp::truncate_utf8(query, max)));
    }
    if (p.ip.len() == 4 || p.ip.len() == 16) && p.client_port > 0 {
        otlp::write_key_value(out, f::ATTRIBUTES, b"client.port", &Value::Int(p.client_port as i64));
    }
    let body_len = out.len() - span_start - 3;
    if body_len < (1 << 14) {
        out[span_start + 1] = (body_len as u8 & 0x7f) | 0x80;
        out[span_start + 2] = (body_len >> 7) as u8;
    } else {
        let need = proto::varint_len(body_len as u64);
        let extra = need - 2;
        let old_len = out.len();
        out.resize(old_len + extra, 0);
        out.copy_within(span_start + 3..old_len, span_start + 3 + extra);
        proto::write_varint_into(&mut out[span_start + 1..span_start + 1 + need], body_len as u64);
    }
}

/// Encode everything except the per-request tail; returns the offset where
/// the tail starts (== out.len()). With `with_tail`, also appends the tail
/// and finishes the span (used when templating is off).
fn expand_slow(out: &mut Vec<u8>, p: &Parsed<'_>, limits: &Limits, with_tail: bool) -> Option<usize> {
    let flags = p.flags;
    let method = p.method;
    let ip = p.ip;
    let status = p.status;
    let (host, ua, route) = (p.host, p.ua, p.route);
    let (attrs, extra, trace_state, name_override, status_code, status_message) =
        (p.attrs, p.extra, p.trace_state, p.name_override, p.status_code, p.status_message);
    let dropped_attrs = p.dropped_attrs;
    let stub = SpanStub {
        ctx: SpanContext { trace_id: TraceId(p.trace_id), span_id: SpanId(p.span_id), flags: Flags(p.trace_flags) },
        parent: SpanId(p.parent),
        start_ns: p.start_ns,
    };
    let end_ns = p.end_ns;
    let span_start = out.len();
    let mut name_buf = [0u8; 8 + 256];
    let name: &[u8] = if !name_override.is_empty() {
        name_override
    } else if !route.is_empty() && route.len() <= 256 {
        name_buf[..method.len()].copy_from_slice(method);
        name_buf[method.len()] = b' ';
        name_buf[method.len() + 1..method.len() + 1 + route.len()].copy_from_slice(route);
        &name_buf[..method.len() + 1 + route.len()]
    } else {
        method
    };
    let mut w = SpanWriter::begin(out, &stub, name, SpanKind::Server, end_ns);
    w.trace_state(trace_state);
    let max = limits.attribute_value_length as usize;
    let lim = |s| otlp::truncate_utf8(s, max);
    let budget = limits.attributes as u32;
    struct Attrs<'w, 'a> {
        w: &'w mut SpanWriter<'a>,
        n: u32,
        budget: u32,
    }
    impl Attrs<'_, '_> {
        #[inline]
        fn put(&mut self, key: &str, v: Value<'_>) {
            if self.n < self.budget {
                self.w.attr(key, v);
            }
            self.n += 1;
        }
    }
    let mut a = Attrs { w: &mut w, n: 0, budget };
    a.put("http.request.method", Value::Str(method));
    // url.path / url.query / client.port are appended per request (tail).
    a.n += 3;
    a.put("url.scheme", Value::Str(if flags & FLAG_HTTPS != 0 { b"https" } else { b"http" }));
    if !host.is_empty() {
        let (hname, port) = split_host_port(host);
        a.put("server.address", Value::Str(lim(hname)));
        if let Some(p) = port {
            a.put("server.port", Value::Int(p as i64));
        }
    }
    if !ua.is_empty() {
        a.put("user_agent.original", Value::Str(lim(ua)));
    }
    if ip.len() == 4 || ip.len() == 16 {
        let mut buf = [0u8; 46];
        let s = format_ip(ip, &mut buf);
        a.put("client.address", Value::Str(s));
    }
    if !route.is_empty() {
        a.put("http.route", Value::Str(lim(route)));
    }
    // Attributes encoded on the request path (captured headers, JS-set).
    a.w.raw(attrs);
    a.n += otlp::count_fields(attrs, f::ATTRIBUTES) as u32;
    let mut span_status = match status_code {
        1 => StatusCode::Ok,
        2 => StatusCode::Error,
        _ => StatusCode::Unset,
    };
    let mut msg: &[u8] = status_message;
    if status != 0 {
        a.put("http.response.status_code", Value::Int(status as i64));
        if status >= 500 {
            let code = [b'0' + ((status / 100) % 10) as u8, b'0' + ((status / 10) % 10) as u8, b'0' + (status % 10) as u8];
            a.put("error.type", Value::Str(&code));
            if span_status == StatusCode::Unset {
                span_status = StatusCode::Error;
            }
        }
    }
    if status < 500 && span_status != StatusCode::Ok {
        if flags & FLAG_ABORTED != 0 {
            a.put("error.type", Value::Str(b"aborted"));
            if span_status == StatusCode::Unset {
                span_status = StatusCode::Error;
                msg = b"request aborted";
            }
        } else if flags & FLAG_HANDLER_ERROR != 0 {
            a.put("error.type", Value::Str(b"uncaught exception"));
            if span_status == StatusCode::Unset {
                span_status = StatusCode::Error;
                msg = b"handler threw";
            }
        }
    }
    let n_attrs = a.n;
    w.raw(extra);
    let dropped = dropped_attrs as u32 + n_attrs.saturating_sub(budget);
    if dropped != 0 {
        w.dropped_attributes(dropped);
    }
    w.status(span_status, msg);
    w.leak();
    let tail_at = out.len();
    if with_tail {
        append_tail(out, span_start, p, limits);
    }
    Some(tail_at)
}

#[inline]
fn otlp_memchr(s: &[u8], c: u8) -> Option<usize> {
    bun_core::strings::index_of_char_usize(s, c)
}

/// Split `host[:port]` (Host header / URL authority).
pub fn split_host_port(host: &[u8]) -> (&[u8], Option<u16>) {
    if host.first() == Some(&b'[') {
        if let Some(end) = bun_core::strings::index_of_char_usize(host, b']') {
            let h = &host[..=end];
            let rest = &host[end + 1..];
            let port = rest.strip_prefix(b":").and_then(parse_port);
            return (h, port);
        }
        return (host, None);
    }
    // Only the last 6 bytes can hold ":65535".
    let tail_start = host.len().saturating_sub(6);
    match bun_core::strings::index_of_char_usize(&host[tail_start..], b':') {
        Some(i) => {
            let i = tail_start + i;
            match parse_port(&host[i + 1..]) {
                Some(p) => (&host[..i], Some(p)),
                None => (host, None),
            }
        }
        None => (host, None),
    }
}

fn parse_port(s: &[u8]) -> Option<u16> {
    if s.is_empty() || s.len() > 5 {
        return None;
    }
    let mut v: u32 = 0;
    for &c in s {
        if !c.is_ascii_digit() {
            return None;
        }
        v = v * 10 + (c - b'0') as u32;
    }
    u16::try_from(v).ok()
}

/// Dotted-quad / RFC 5952 text for a raw address (v4-mapped v6 prints as v4).
pub fn format_ip<'b>(ip: &[u8], buf: &'b mut [u8; 46]) -> &'b [u8] {
    fn v4<'b>(a: &[u8], buf: &'b mut [u8; 46]) -> &'b [u8] {
        let mut n = 0;
        for (i, &oct) in a.iter().enumerate() {
            if i > 0 {
                buf[n] = b'.';
                n += 1;
            }
            if oct >= 100 {
                buf[n] = b'0' + oct / 100;
                n += 1;
            }
            if oct >= 10 {
                buf[n] = b'0' + (oct / 10) % 10;
                n += 1;
            }
            buf[n] = b'0' + oct % 10;
            n += 1;
        }
        &buf[..n]
    }
    if ip.len() == 4 {
        return v4(ip, buf);
    }
    if ip.len() != 16 {
        return &buf[..0];
    }
    if ip[..10].iter().all(|&b| b == 0) && ip[10] == 0xff && ip[11] == 0xff {
        let mut tmp = [0u8; 46];
        let v = v4(&ip[12..16], &mut tmp);
        buf[..7].copy_from_slice(b"::ffff:");
        buf[7..7 + v.len()].copy_from_slice(v);
        return &buf[..7 + v.len()];
    }
    // RFC 5952: collapse the longest run of zero groups.
    let mut g = [0u16; 8];
    for i in 0..8 {
        g[i] = u16::from_be_bytes([ip[2 * i], ip[2 * i + 1]]);
    }
    let (mut best_at, mut best_len, mut at, mut len) = (usize::MAX, 0usize, usize::MAX, 0usize);
    for i in 0..8 {
        if g[i] == 0 {
            if at == usize::MAX {
                at = i;
                len = 0;
            }
            len += 1;
            if len > best_len {
                best_len = len;
                best_at = at;
            }
        } else {
            at = usize::MAX;
        }
    }
    if best_len < 2 {
        best_at = usize::MAX;
    }
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut n = 0;
    let mut i = 0;
    while i < 8 {
        if i == best_at {
            buf[n] = b':';
            buf[n + 1] = b':';
            n += 2;
            i += best_len;
            continue;
        }
        if i > 0 && !(best_at != usize::MAX && i == best_at + best_len) {
            buf[n] = b':';
            n += 1;
        }
        let v = g[i];
        let mut started = false;
        for shift in [12u16, 8, 4, 0] {
            let d = ((v >> shift) & 0xf) as usize;
            if d != 0 || started || shift == 0 {
                buf[n] = HEX[d];
                n += 1;
                started = true;
            }
        }
        i += 1;
    }
    &buf[..n]
}
