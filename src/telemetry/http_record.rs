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
        expand_one(out, body.as_bytes(), limits);
    }
    out.extend_from_slice(&spans[last..]);
}

fn expand_one(out: &mut Vec<u8>, body: &[u8], limits: &Limits) -> Option<()> {
    let mut c = Cursor { b: body };
    let h = c.take(HEADER_LEN)?;
    if h[0] != 1 {
        return None;
    }
    let flags = h[1];
    let method = &h[3..3 + (h[2].min(7) as usize)];
    let ip_len = h[10] as usize;
    let ip = &h[11..11 + ip_len.min(16)];
    let client_port = u16::from_le_bytes([h[27], h[28]]);
    let status = u16::from_le_bytes([h[29], h[30]]);
    let start_ns = u64::from_le_bytes(h[31..39].try_into().ok()?);
    let end_ns = u64::from_le_bytes(h[39..47].try_into().ok()?);
    let mut trace_id = [0u8; 16];
    trace_id.copy_from_slice(&h[47..63]);
    let mut span_id = [0u8; 8];
    span_id.copy_from_slice(&h[63..71]);
    let mut parent = [0u8; 8];
    parent.copy_from_slice(&h[71..79]);
    let trace_flags = h[79];
    let dropped_attrs = u16::from_le_bytes([h[80], h[81]]);
    let raw = c.str32()?;
    let attrs = c.str32()?;
    let extra = c.str32()?;
    let trace_state = c.str16()?;
    let name_override = c.str16()?;
    let status_code = c.take(1)?[0];
    let status_message = c.str16()?;

    let (mut url, mut host, mut ua, mut route): (&[u8], &[u8], &[u8], &[u8]) = (b"", b"", b"", b"");
    let mut s = Cursor { b: raw };
    while let Some(t) = s.take(3) {
        let n = u16::from_le_bytes([t[1], t[2]]) as usize;
        let Some(v) = s.take(n) else { break };
        match t[0] {
            S_URL => url = v,
            S_HOST => host = v,
            S_UA => ua = v,
            S_ROUTE => route = v,
            _ => {}
        }
    }

    let stub = SpanStub {
        ctx: SpanContext { trace_id: TraceId(trace_id), span_id: SpanId(span_id), flags: Flags(trace_flags) },
        parent: SpanId(parent),
        start_ns,
    };
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
    let (path, query) = match otlp_memchr(url, b'?') {
        Some(i) => (&url[..i], &url[i + 1..]),
        None => (url, &b""[..]),
    };
    a.put("url.path", Value::Str(lim(path)));
    if !query.is_empty() {
        a.put("url.query", Value::Str(lim(query)));
    }
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
    if ip_len == 4 || ip_len == 16 {
        let mut buf = [0u8; 46];
        let s = format_ip(ip, &mut buf);
        a.put("client.address", Value::Str(s));
        if client_port > 0 {
            a.put("client.port", Value::Int(client_port as i64));
        }
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
    w.finish();
    Some(())
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
