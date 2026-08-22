//! HTTP server spans: the request path captures raw facts (a few copies) and
//! the span is encoded at `end()` from a per-VM template. Consecutive
//! requests usually differ only in ids, times and path, so the
//! encoding of everything else is cached and a hit is one copy plus
//! fixed-offset patches and a short per-request tail.

use bun_http_types::Method::Method;

use crate::StatusCode;
use crate::data::Limits;
use crate::otlp::{self, SPAN_LEN_RESERVE, SpanWriter, Value, field as f};
use crate::proto::Nested;
use crate::span::{SpanKind, SpanStub};

pub const FLAG_HTTPS: u8 = 1;
pub const FLAG_ABORTED: u8 = 2;
pub const FLAG_HANDLER_ERROR: u8 = 4;
pub const FLAG_HAS_QUERY: u8 = 8;

/// `http.request.method`: the canonical token for known methods, `_OTHER`
/// otherwise (semconv requires a bounded set).
#[inline]
pub const fn method_name(m: Method) -> &'static str {
    match m {
        Method::GET
        | Method::HEAD
        | Method::POST
        | Method::PUT
        | Method::DELETE
        | Method::CONNECT
        | Method::OPTIONS
        | Method::TRACE
        | Method::PATCH
        | Method::QUERY => m.as_str(),
        _ => "_OTHER",
    }
}

/// The peer address as captured on the request path; formatted only when a
/// span is encoded without a template hit.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PeerIp {
    None,
    V4([u8; 4]),
    V6([u8; 16]),
    /// Already text (HTTP/3 reports it that way).
    Text {
        len: u8,
        buf: [u8; PeerIp::MAX_TEXT],
    },
}

impl PeerIp {
    pub const MAX_TEXT: usize = 45;

    pub fn from_text(s: &[u8]) -> PeerIp {
        if s.is_empty() || s.len() > Self::MAX_TEXT {
            return PeerIp::None;
        }
        let mut buf = [0u8; Self::MAX_TEXT];
        buf[..s.len()].copy_from_slice(s);
        PeerIp::Text {
            len: s.len() as u8,
            buf,
        }
    }

    /// Dotted quad / RFC 5952 (v4-mapped v6 as `::ffff:a.b.c.d`, matching
    /// `requestIP()`).
    fn text<'b>(&'b self, buf: &'b mut [u8; 64]) -> &'b [u8] {
        use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV4, SocketAddrV6};
        let addr: SocketAddr = match self {
            PeerIp::None => return b"",
            PeerIp::Text { len, buf } => return &buf[..*len as usize],
            PeerIp::V4(b) => SocketAddrV4::new(Ipv4Addr::from(*b), 0).into(),
            PeerIp::V6(b) => SocketAddrV6::new(Ipv6Addr::from(*b), 0, 0, 0).into(),
        };
        match bun_core::fmt::format_ip(&addr, buf) {
            Ok(s) => s,
            Err(_) => b"",
        }
    }
}

/// Request facts captured at begin; lives in the pool slot.
pub struct Facts {
    /// url | host | user-agent | route, back to back (see `lens`).
    raw: Vec<u8>,
    lens: [u32; 4],
    /// Length of the path part of the url (`url.len()` if no query).
    path_len: u32,
    pub method: Method,
    pub peer: PeerIp,
    pub flags: u8,
    pub status: u16,
    /// This slot holds an HTTP server span rather than a generic one.
    pub active: bool,
}

struct Strings<'a> {
    url: &'a [u8],
    /// host | user-agent | route (part of the template key).
    after_url: &'a [u8],
    host: &'a [u8],
    user_agent: &'a [u8],
    route: &'a [u8],
}

impl Facts {
    pub const fn new() -> Facts {
        Facts {
            raw: Vec::new(),
            lens: [0; 4],
            path_len: 0,
            method: Method::GET,
            peer: PeerIp::None,
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
        self.peer = PeerIp::None;
        if self.raw.capacity() > 16 * 1024 {
            self.raw = Vec::new();
        }
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

    #[inline]
    fn strings(&self) -> Strings<'_> {
        let [a, b, c, d] = self.lens.map(|x| x as usize);
        let r = &self.raw[..];
        if r.len() < a + b + c + d {
            return Strings {
                url: b"",
                after_url: b"",
                host: b"",
                user_agent: b"",
                route: b"",
            };
        }
        Strings {
            url: &r[..a],
            after_url: &r[a..],
            host: &r[a..a + b],
            user_agent: &r[a + b..a + b + c],
            route: &r[a + b + c..a + b + c + d],
        }
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
    status_code: StatusCode,
    has_parent: bool,
    method: Method,
    peer: PeerIp,
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
            || self.status_code != p.status
            || self.has_parent != has_parent
            || self.method != facts.method
            || self.peer != facts.peer
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

/// Most-recently-used encoded span templates (see [`crate::Local`]).
pub struct Cache {
    entries: Vec<Template>,
}

impl Cache {
    pub const fn new() -> Cache {
        Cache {
            entries: Vec::new(),
        }
    }
}

// Byte offsets inside an encoded span (see SpanWriter::begin): tag, the
// reserved length bytes, then the fixed-shape prefix.
const OFF_LEN: usize = 1;
const OFF_TRACE_ID: usize = OFF_LEN + SPAN_LEN_RESERVE + 2;
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
pub fn encode(c: &mut Cache, out: &mut Vec<u8>, facts: &Facts, p: &SpanParts<'_>, limits: &Limits) {
    if limits.attributes < 16 {
        return encode_untemplated(out, facts, p, limits);
    }
    let s = facts.strings();
    let has_parent = p.stub.parent.is_valid();
    let pieces: [&[u8]; 6] = [
        s.after_url,
        p.attrs,
        p.extra,
        p.trace_state,
        p.name_override,
        p.status_message,
    ];
    let Some(i) = c
        .entries
        .iter()
        .position(|t| t.matches(facts, p, has_parent, &pieces))
    else {
        return encode_miss(c, out, facts, p, limits, has_parent);
    };
    if i != 0 {
        c.entries.swap(0, i);
    }
    let t = &c.entries[0];
    let start = out.len();
    out.reserve(t.bytes.len() + 64 + s.url.len());
    out.extend_from_slice(&t.bytes);
    out[start + OFF_TRACE_ID..start + OFF_TRACE_ID + 16].copy_from_slice(&p.stub.ctx.trace_id.0);
    out[start + OFF_SPAN_ID..start + OFF_SPAN_ID + 8].copy_from_slice(&p.stub.ctx.span_id.0);
    if has_parent {
        out[start + OFF_PARENT..start + OFF_PARENT + 8].copy_from_slice(&p.stub.parent.0);
    }
    let st = start + off_start(has_parent);
    out[st..st + 8].copy_from_slice(&p.stub.start_ns.to_le_bytes());
    out[st + 9..st + 17].copy_from_slice(&p.end_ns.to_le_bytes());
    // flags: 2-byte tag then fixed32
    out[st + 19..st + 23].copy_from_slice(&p.stub.ctx.flags.otlp().to_le_bytes());
    append_tail(out, start, s.url, facts, limits);
}

#[cold]
#[inline(never)]
fn encode_untemplated(out: &mut Vec<u8>, facts: &Facts, p: &SpanParts<'_>, limits: &Limits) {
    let s = facts.strings();
    let start = out.len();
    let len_at = encode_head(out, facts, p, &s, limits);
    debug_assert_eq!(len_at, start + OFF_LEN);
    append_tail(out, start, s.url, facts, limits);
}

#[cold]
#[inline(never)]
fn encode_miss(
    c: &mut Cache,
    out: &mut Vec<u8>,
    facts: &Facts,
    p: &SpanParts<'_>,
    limits: &Limits,
    has_parent: bool,
) {
    let s = facts.strings();
    let pieces: [&[u8]; 6] = [
        s.after_url,
        p.attrs,
        p.extra,
        p.trace_state,
        p.name_override,
        p.status_message,
    ];
    let start = out.len();
    let len_at = encode_head(out, facts, p, &s, limits);
    debug_assert_eq!(len_at, start + OFF_LEN);
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
    append_tail(out, start, s.url, facts, limits);
    let mut piece_len = [0u32; 6];
    let mut all = Vec::with_capacity(pieces.iter().map(|x| x.len()).sum());
    for (i, piece) in pieces.iter().enumerate() {
        piece_len[i] = piece.len() as u32;
        all.extend_from_slice(piece);
    }
    let t = Template {
        flags: facts.flags,
        status_code: p.status,
        has_parent,
        method: facts.method,
        peer: facts.peer,
        status: facts.status,
        dropped: p.dropped_attrs,
        dropped_events: p.dropped_events,
        dropped_links: p.dropped_links,
        lens: [facts.lens[1], facts.lens[2], facts.lens[3]],
        pieces: all,
        piece_len,
        bytes,
    };
    if c.entries.len() >= TEMPLATES {
        c.entries.pop();
    }
    c.entries.insert(0, t);
}

/// Per-request attributes after the templated part, then the span length.
#[inline]
fn append_tail(out: &mut Vec<u8>, span_start: usize, url: &[u8], facts: &Facts, limits: &Limits) {
    let max = limits.attribute_value_length as usize;
    let pl = (facts.path_len as usize).min(url.len());
    let (path, query) = (&url[..pl], url.get(pl + 1..).unwrap_or(b""));
    otlp::write_str_kv_small(
        out,
        f::ATTRIBUTES,
        "url.path",
        otlp::truncate_utf8(path, max),
    );
    if !query.is_empty() {
        otlp::write_str_kv_small(
            out,
            f::ATTRIBUTES,
            "url.query",
            otlp::truncate_utf8(query, max),
        );
    }
    Nested::<SPAN_LEN_RESERVE>::at(span_start + OFF_LEN).finish(out);
}

/// Encode everything except the per-request tail, leaving the span length
/// unpatched (append_tail patches it). Returns where the length bytes are.
fn encode_head(
    out: &mut Vec<u8>,
    facts: &Facts,
    p: &SpanParts<'_>,
    s: &Strings<'_>,
    limits: &Limits,
) -> usize {
    let method = method_name(facts.method).as_bytes();
    let (host, ua, route) = (s.host, s.user_agent, s.route);
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
    let mut ip_buf = [0u8; 64];
    let ip = facts.peer.text(&mut ip_buf);
    if !ip.is_empty() {
        a.put("client.address", Value::Str(ip));
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
            let mut buf = bun_core::fmt::ItoaBuf::new();
            a.put(
                "error.type",
                Value::Str(bun_core::fmt::itoa(&mut buf, status)),
            );
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
    w.finish_unpatched()
}

/// Split `host[:port]` (Host header / URL authority).
pub fn split_host_port(host: &[u8]) -> (&[u8], Option<u16>) {
    let port = |s: &[u8]| bun_core::fmt::parse_unsigned::<u16>(s, 10).ok();
    if host.first() == Some(&b'[') {
        return match bun_core::strings::index_of_char_usize(host, b']') {
            Some(end) => (
                &host[..=end],
                host[end + 1..].strip_prefix(b":").and_then(port),
            ),
            None => (host, None),
        };
    }
    match bun_core::strings::last_index_of_char(host, b':') {
        // A second ':' means an unbracketed IPv6 literal, which has no port.
        Some(i) if !bun_core::strings::contains_char(&host[..i], b':') => {
            match port(&host[i + 1..]) {
                Some(p) => (&host[..i], Some(p)),
                None => (host, None),
            }
        }
        _ => (host, None),
    }
}
