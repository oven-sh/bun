//! HTTP server spans: the request path captures raw facts (a few copies) and
//! the span is encoded at `end()` from a per-thread template. Consecutive
//! requests usually differ only in ids, times and path, so the
//! encoding of everything else is cached and a hit is one copy plus
//! fixed-offset patches and a short per-request tail.

use core::cell::RefCell;

use crate::StatusCode;
use crate::data::Limits;
use crate::otlp::{self, SpanWriter, Value, field as f};
use crate::proto;
use crate::span::{SpanKind, SpanStub};

pub const FLAG_HTTPS: u8 = 1;
pub const FLAG_ABORTED: u8 = 2;
pub const FLAG_HANDLER_ERROR: u8 = 4;
pub const FLAG_HAS_QUERY: u8 = 8;

// Indexes into `Facts::lens` (strings live back-to-back in `Facts::raw`).
pub const S_URL: usize = 0;
pub const S_HOST: usize = 1;
pub const S_UA: usize = 2;
pub const S_ROUTE: usize = 3;

/// Request facts captured at begin; lives in the pool slot.
pub struct Facts {
    /// url, host, user-agent, route back to back (see `lens`).
    pub raw: Vec<u8>,
    pub lens: [u32; 4],
    /// Length of the path part of the url (`url.len()` if no query).
    pub path_len: u32,
    pub method: [u8; 8],
    pub ip: [u8; 16],
    pub ip_len: u8,
    pub flags: u8,
    pub status: u16,
    /// This slot holds an HTTP server span rather than a generic one.
    pub active: bool,
}

impl Facts {
    pub const fn new() -> Facts {
        Facts {
            raw: Vec::new(),
            lens: [0; 4],
            path_len: 0,
            method: [0; 8],
            ip: [0; 16],
            ip_len: 0,
            flags: 0,
            status: 0,
            active: false,
        }
    }

    #[inline]
    pub fn reset(&mut self) {
        self.raw.clear();
        self.lens = [0; 4];
        self.active = false;
        self.flags = 0;
        self.status = 0;
        self.ip_len = 0;
        self.ip = [0; 16];
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

    #[inline]
    fn method(&self) -> &[u8] {
        &self.method[1..1 + (self.method[0].min(7) as usize)]
    }

    #[inline]
    fn ip(&self) -> &[u8] {
        &self.ip[..(self.ip_len as usize).min(16)]
    }

    /// Set the request strings in one go (must be called before `set_route`).
    #[inline]
    pub fn set_request(&mut self, url: &[u8], path_len: usize, host: &[u8], ua: &[u8]) {
        let url = &url[..url.len().min(u16::MAX as usize)];
        let host = &host[..host.len().min(u16::MAX as usize)];
        let ua = &ua[..ua.len().min(u16::MAX as usize)];
        self.raw.clear();
        self.raw.reserve(url.len() + host.len() + ua.len());
        self.raw.extend_from_slice(url);
        self.raw.extend_from_slice(host);
        self.raw.extend_from_slice(ua);
        self.lens = [url.len() as u32, host.len() as u32, ua.len() as u32, 0];
        self.path_len = path_len.min(url.len()) as u32;
        if (self.path_len as usize) + 1 < url.len() {
            self.flags |= FLAG_HAS_QUERY;
        }
    }

    #[inline]
    pub fn set_route(&mut self, route: &[u8]) {
        let route = &route[..route.len().min(u16::MAX as usize)];
        let end = (self.lens[0] + self.lens[1] + self.lens[2]) as usize;
        self.raw.truncate(end);
        self.raw.extend_from_slice(route);
        self.lens[3] = route.len() as u32;
    }

    /// (url, everything after the url, host, ua, route)
    #[inline]
    fn strings(&self) -> (&[u8], &[u8], &[u8], &[u8], &[u8]) {
        let [a, b, c, d] = self.lens.map(|x| x as usize);
        let r = &self.raw[..];
        if r.len() < a + b + c + d {
            return (b"", b"", b"", b"", b"");
        }
        (
            &r[..a],
            &r[a..],
            &r[a..a + b],
            &r[a + b..a + b + c],
            &r[a + b + c..a + b + c + d],
        )
    }
}

/// Everything `encode` needs besides the facts.
pub struct SpanParts<'a> {
    pub stub: &'a SpanStub,
    pub end_ns: u64,
    pub name_override: &'a [u8],
    pub trace_state: &'a [u8],
    pub attrs: &'a [u8],
    pub dropped_attrs: u16,
    pub dropped_events: u16,
    pub dropped_links: u16,
    pub extra: &'a [u8],
    pub status: StatusCode,
    pub status_message: &'a [u8],
}

struct Template {
    // Key.
    flags: u8,
    status_code: u8,
    has_parent: bool,
    method: [u8; 8],
    ip: [u8; 16],
    ip_len: u8,
    status: u16,
    dropped: u16,
    dropped_events: u16,
    dropped_links: u16,
    lens: [u32; 3],
    /// after_url | attrs | extra | trace_state | name_override | status_message
    pieces: Vec<u8>,
    piece_len: [u32; 6],
    /// Encoded span up to (not including) the per-request tail.
    bytes: Vec<u8>,
}

impl Template {
    #[inline]
    fn matches(
        &self,
        facts: &Facts,
        p: &SpanParts<'_>,
        has_parent: bool,
        pieces: &[&[u8]; 6],
    ) -> bool {
        if self.flags != facts.flags
            || self.status != facts.status
            || self.status_code != p.status as u8
            || self.has_parent != has_parent
            || self.method != facts.method
            || self.ip_len != facts.ip_len
            || self.ip != facts.ip
            || self.dropped != p.dropped_attrs
            || self.dropped_events != p.dropped_events
            || self.dropped_links != p.dropped_links
            || self.lens != [facts.lens[1], facts.lens[2], facts.lens[3]]
        {
            return false;
        }
        let mut off = 0usize;
        for (i, piece) in pieces.iter().enumerate() {
            let n = self.piece_len[i] as usize;
            if n != piece.len() {
                return false;
            }
            // (empty pieces are the common case; skip the memcmp call)
            if n != 0 && self.pieces.get(off..off + n) != Some(*piece) {
                return false;
            }
            off += n;
        }
        true
    }
}

const TEMPLATES: usize = 4;

struct Cache {
    entries: Vec<Template>,
}

thread_local! {
    static CACHE: RefCell<Cache> = const { RefCell::new(Cache { entries: Vec::new() }) };
}

// Byte offsets inside an encoded span (see SpanWriter::begin): tag, two
// length bytes, then the fixed-shape prefix.
const OFF_TRACE_ID: usize = 3 + 2;
const OFF_SPAN_ID: usize = OFF_TRACE_ID + 16 + 2;
const OFF_PARENT: usize = OFF_SPAN_ID + 8 + 2;
#[inline]
fn off_start(has_parent: bool) -> usize {
    (if has_parent {
        OFF_PARENT + 8
    } else {
        OFF_SPAN_ID + 8
    }) + 2
        + 1
}

/// Encode one server span into `out` (a scope span buffer).
#[inline]
pub fn encode(out: &mut Vec<u8>, facts: &Facts, p: &SpanParts<'_>, limits: &Limits) {
    if limits.attributes < 16 {
        return encode_untemplated(out, facts, p, limits);
    }
    let (url, after_url, _, _, _) = facts.strings();
    let has_parent = p.stub.parent.is_valid();
    let pieces: [&[u8]; 6] = [
        after_url,
        p.attrs,
        p.extra,
        p.trace_state,
        p.name_override,
        p.status_message,
    ];
    let hit = CACHE.with(|c| {
        let mut c = c.borrow_mut();
        let Some(i) = c
            .entries
            .iter()
            .position(|t| t.matches(facts, p, has_parent, &pieces))
        else {
            return false;
        };
        if i != 0 {
            c.entries.swap(0, i);
        }
        let t = &c.entries[0];
        let s = out.len();
        out.reserve(t.bytes.len() + 64 + url.len());
        out.extend_from_slice(&t.bytes);
        out[s + OFF_TRACE_ID..s + OFF_TRACE_ID + 16].copy_from_slice(&p.stub.ctx.trace_id.0);
        out[s + OFF_SPAN_ID..s + OFF_SPAN_ID + 8].copy_from_slice(&p.stub.ctx.span_id.0);
        if has_parent {
            out[s + OFF_PARENT..s + OFF_PARENT + 8].copy_from_slice(&p.stub.parent.0);
        }
        let st = s + off_start(has_parent);
        out[st..st + 8].copy_from_slice(&p.stub.start_ns.to_le_bytes());
        out[st + 9..st + 17].copy_from_slice(&p.end_ns.to_le_bytes());
        // flags: 2-byte tag then fixed32
        out[st + 19..st + 23].copy_from_slice(&p.stub.ctx.flags.otlp().to_le_bytes());
        append_tail(out, s, url, facts, limits);
        true
    });
    if !hit {
        encode_miss(out, facts, p, limits, has_parent);
    }
}

#[cold]
#[inline(never)]
fn encode_untemplated(out: &mut Vec<u8>, facts: &Facts, p: &SpanParts<'_>, limits: &Limits) {
    let (url, _, host, ua, route) = facts.strings();
    let start = out.len();
    encode_head(out, facts, p, host, ua, route, limits);
    append_tail(out, start, url, facts, limits);
}

#[cold]
#[inline(never)]
fn encode_miss(
    out: &mut Vec<u8>,
    facts: &Facts,
    p: &SpanParts<'_>,
    limits: &Limits,
    has_parent: bool,
) {
    let (url, after_url, host, ua, route) = facts.strings();
    let pieces: [&[u8]; 6] = [
        after_url,
        p.attrs,
        p.extra,
        p.trace_state,
        p.name_override,
        p.status_message,
    ];
    let start = out.len();
    encode_head(out, facts, p, host, ua, route, limits);
    let bytes = out[start..].to_vec();
    debug_assert_eq!(
        &bytes[OFF_TRACE_ID..OFF_TRACE_ID + 16],
        &p.stub.ctx.trace_id.0
    );
    debug_assert_eq!(&bytes[OFF_SPAN_ID..OFF_SPAN_ID + 8], &p.stub.ctx.span_id.0);
    debug_assert_eq!(
        &bytes[off_start(has_parent)..off_start(has_parent) + 8],
        &p.stub.start_ns.to_le_bytes()
    );
    debug_assert_eq!(
        &bytes[off_start(has_parent) + 9..off_start(has_parent) + 17],
        &p.end_ns.to_le_bytes()
    );
    append_tail(out, start, url, facts, limits);
    let mut piece_len = [0u32; 6];
    let mut all = Vec::with_capacity(pieces.iter().map(|x| x.len()).sum());
    for (i, piece) in pieces.iter().enumerate() {
        piece_len[i] = piece.len() as u32;
        all.extend_from_slice(piece);
    }
    let t = Template {
        flags: facts.flags,
        status_code: p.status as u8,
        has_parent,
        method: facts.method,
        ip: facts.ip,
        ip_len: facts.ip_len,
        status: facts.status,
        dropped: p.dropped_attrs,
        dropped_events: p.dropped_events,
        dropped_links: p.dropped_links,
        lens: [facts.lens[1], facts.lens[2], facts.lens[3]],
        pieces: all,
        piece_len,
        bytes,
    };
    CACHE.with(|c| {
        let mut c = c.borrow_mut();
        if c.entries.len() >= TEMPLATES {
            c.entries.pop();
        }
        c.entries.insert(0, t);
    });
}

/// Per-request attributes after the templated part, then the span length.
#[inline]
fn append_tail(out: &mut Vec<u8>, span_start: usize, url: &[u8], facts: &Facts, limits: &Limits) {
    let max = limits.attribute_value_length as usize;
    let pl = (facts.path_len as usize).min(url.len());
    let (path, query) = (&url[..pl], url.get(pl + 1..).unwrap_or(b""));
    let path = otlp::truncate_utf8(path, max);
    // url.path header and bytes in one reserve; url.query only when present.
    if path.len() < 128 - 16 {
        let kv = 2 + 8 + 2 + 2 + path.len();
        let head: [u8; 16] = [
            (f::ATTRIBUTES << 3 | 2) as u8,
            kv as u8,
            (f::KV_KEY << 3 | 2) as u8,
            8,
            b'u',
            b'r',
            b'l',
            b'.',
            b'p',
            b'a',
            b't',
            b'h',
            (f::KV_VALUE << 3 | 2) as u8,
            (2 + path.len()) as u8,
            (f::AV_STRING << 3 | 2) as u8,
            path.len() as u8,
        ];
        out.reserve(16 + path.len() + 8);
        out.extend_from_slice(&head);
        out.extend_from_slice(path);
    } else {
        otlp::write_key_value(out, f::ATTRIBUTES, b"url.path", &Value::Str(path));
    }
    if !query.is_empty() {
        push_str(out, b"url.query", otlp::truncate_utf8(query, max));
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
        proto::write_varint_into(
            &mut out[span_start + 1..span_start + 1 + need],
            body_len as u64,
        );
    }
}

/// `KeyValue{key, AnyValue{string}}` with a short literal key.
#[inline]
fn push_str(out: &mut Vec<u8>, key: &[u8], v: &[u8]) {
    let kv = 2 + key.len() + 2 + 2 + v.len();
    if kv >= 128 {
        return otlp::write_key_value(out, f::ATTRIBUTES, key, &Value::Str(v));
    }
    out.reserve(kv + 2);
    out.extend_from_slice(&[
        (f::ATTRIBUTES << 3 | 2) as u8,
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

/// Encode everything except the per-request tail, leaving the span length
/// unpatched (append_tail patches it).
fn encode_head(
    out: &mut Vec<u8>,
    facts: &Facts,
    p: &SpanParts<'_>,
    host: &[u8],
    ua: &[u8],
    route: &[u8],
    limits: &Limits,
) {
    let method = facts.method();
    let flags = facts.flags;
    let status = facts.status;
    let mut name_buf = [0u8; 8 + 256];
    let name: &[u8] = if !p.name_override.is_empty() {
        p.name_override
    } else if !route.is_empty() && route.len() <= 256 {
        name_buf[..method.len()].copy_from_slice(method);
        name_buf[method.len()] = b' ';
        name_buf[method.len() + 1..method.len() + 1 + route.len()].copy_from_slice(route);
        &name_buf[..method.len() + 1 + route.len()]
    } else {
        method
    };
    let mut w = SpanWriter::begin(out, p.stub, name, SpanKind::Server, p.end_ns);
    w.trace_state(p.trace_state);
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
    let mut a = Attrs {
        w: &mut w,
        n: 0,
        budget,
    };
    a.put("http.request.method", Value::Str(method));
    // url.path / url.query are appended per request (tail).
    a.n += if flags & FLAG_HAS_QUERY != 0 { 2 } else { 1 };
    a.put(
        "url.scheme",
        Value::Str(if flags & FLAG_HTTPS != 0 {
            b"https"
        } else {
            b"http"
        }),
    );
    if !host.is_empty() {
        let (hname, port) = split_host_port(host);
        a.put("server.address", Value::Str(lim(hname)));
        if let Some(port) = port {
            a.put("server.port", Value::Int(port as i64));
        }
    }
    if !ua.is_empty() {
        a.put("user_agent.original", Value::Str(lim(ua)));
    }
    let ip = facts.ip();
    if ip.len() == 4 || ip.len() == 16 {
        let mut buf = [0u8; 46];
        let s = format_ip(ip, &mut buf);
        a.put("client.address", Value::Str(s));
    }
    if !route.is_empty() {
        a.put("http.route", Value::Str(lim(route)));
    }
    // Attributes encoded on the request path (captured headers, JS-set).
    a.w.raw(p.attrs);
    a.n += otlp::count_fields(p.attrs, f::ATTRIBUTES) as u32;
    let mut span_status = p.status;
    let mut msg: &[u8] = p.status_message;
    if status != 0 {
        a.put("http.response.status_code", Value::Int(status as i64));
        if status >= 500 {
            let code = [
                b'0' + ((status / 100) % 10) as u8,
                b'0' + ((status / 10) % 10) as u8,
                b'0' + (status % 10) as u8,
            ];
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
    w.raw(p.extra);
    let dropped = p.dropped_attrs as u32 + n_attrs.saturating_sub(budget);
    if dropped != 0 {
        w.dropped_attributes(dropped);
    }
    if p.dropped_events != 0 {
        w.dropped_events(p.dropped_events as u32);
    }
    if p.dropped_links != 0 {
        w.dropped_links(p.dropped_links as u32);
    }
    w.status(span_status, msg);
    w.leak();
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

/// Dotted-quad / RFC 5952 text for a raw address (v4-mapped v6 prints as
/// `::ffff:a.b.c.d`, matching `requestIP()`).
pub fn format_ip<'b>(ip: &[u8], buf: &'b mut [u8; 46]) -> &'b [u8] {
    fn v4(a: &[u8], buf: &mut [u8], at: usize) -> usize {
        let mut n = at;
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
        n
    }
    if ip.len() == 4 {
        let n = v4(ip, buf, 0);
        return &buf[..n];
    }
    if ip.len() != 16 {
        return &buf[..0];
    }
    if ip[..10].iter().all(|&b| b == 0) && ip[10] == 0xff && ip[11] == 0xff {
        buf[..7].copy_from_slice(b"::ffff:");
        let n = v4(&ip[12..16], buf, 7);
        return &buf[..n];
    }
    // RFC 5952: collapse the longest run (>= 2) of zero groups.
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
