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
/// An exception was recorded on the span (it carries `error.type` already).
pub const FLAG_HAS_ERROR_TYPE: u8 = 16;
/// The request method is not one `Method` can name: `http.request.method`
/// is `_OTHER` and the span already carries `http.request.method_original`.
pub const FLAG_METHOD_OTHER: u8 = 32;

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

    /// Dotted quad / RFC 5952. Runs per request, so v4 (the common case) is
    /// four itoas rather than `std::net`'s formatter.
    pub fn text<'b>(&'b self, buf: &'b mut [u8; 64]) -> &'b [u8] {
        use std::net::{Ipv6Addr, SocketAddrV6};
        match self {
            PeerIp::None => b"",
            PeerIp::Text { len, buf } => &buf[..*len as usize],
            PeerIp::V4(b) => {
                let mut n = 0;
                let mut ib = bun_core::fmt::ItoaBuf::new();
                for (i, octet) in b.iter().enumerate() {
                    if i != 0 {
                        buf[n] = b'.';
                        n += 1;
                    }
                    let d = bun_core::fmt::itoa(&mut ib, *octet);
                    buf[n..n + d.len()].copy_from_slice(d);
                    n += d.len();
                }
                &buf[..n]
            }
            PeerIp::V6(b) => {
                match bun_core::fmt::format_ip(&SocketAddrV6::new(Ipv6Addr::from(*b), 0, 0, 0), buf)
                {
                    Ok(s) => s,
                    Err(_) => b"",
                }
            }
        }
    }
}

/// Request facts captured at begin; lives in the pool slot.
pub struct Facts {
    /// url | client | host | user-agent | route, back to back (see `lens`).
    /// url and client (the forwarded-for address) vary per request; the
    /// rest key the template.
    raw: Vec<u8>,
    lens: [u32; 5],
    /// Length of the path part of the url (`url.len()` if no query).
    path_len: u32,
    pub method: Method,
    /// The socket peer (per request; not part of the template key).
    pub peer: PeerIp,
    pub peer_port: u16,
    /// Length of the encoded `network.peer.*` bytes at the front of `raw`
    /// ([`encode_peer_attrs`]; the transport caches them per connection and
    /// [`Facts::set_request`] copies them in). 0 = encode from `peer`.
    peer_encoded_len: u8,
    /// How many attributes those bytes hold (address, or address + port).
    peer_encoded_attrs: u8,
    pub version: HttpVersion,
    pub flags: u8,
    pub status: u16,
    /// This slot holds an HTTP server span rather than a generic one.
    pub active: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum HttpVersion {
    Unknown,
    Http11,
    Http2,
    Http3,
}

impl HttpVersion {
    fn text(self) -> &'static [u8] {
        match self {
            HttpVersion::Unknown => b"",
            HttpVersion::Http11 => b"1.1",
            HttpVersion::Http2 => b"2",
            HttpVersion::Http3 => b"3",
        }
    }
}

struct Strings<'a> {
    peer_encoded: &'a [u8],
    url: &'a [u8],
    /// First `X-Forwarded-For` / `Forwarded for=` hop, if any.
    client: &'a [u8],
    /// host | user-agent | route (part of the template key).
    keyed: &'a [u8],
    host: &'a [u8],
    user_agent: &'a [u8],
    route: &'a [u8],
}

impl Facts {
    pub const fn new() -> Facts {
        Facts {
            raw: Vec::new(),
            lens: [0; 5],
            path_len: 0,
            method: Method::GET,
            peer: PeerIp::None,
            peer_port: 0,
            peer_encoded_len: 0,
            peer_encoded_attrs: 0,
            version: HttpVersion::Unknown,
            flags: 0,
            status: 0,
            active: false,
        }
    }

    #[inline]
    pub fn reset(&mut self) {
        self.raw.clear();
        self.lens = [0; 5];
        self.active = false;
        self.flags = 0;
        self.status = 0;
        self.peer = PeerIp::None;
        self.peer_port = 0;
        self.peer_encoded_len = 0;
        self.peer_encoded_attrs = 0;
        self.version = HttpVersion::Unknown;
        if self.raw.capacity() > 16 * 1024 {
            self.raw = Vec::new();
        }
    }

    /// Set the request strings in one go (must be called before `set_route`).
    /// `peer_encoded`: the connection's cached [`encode_peer_attrs`] bytes
    /// (or empty); `client`: the first forwarded-for hop (empty if none).
    #[inline]
    pub fn set_request(
        &mut self,
        peer_encoded: &[u8],
        url: &[u8],
        path_len: usize,
        client: &[u8],
        host: &[u8],
        ua: &[u8],
    ) {
        let peer_encoded = if peer_encoded.len() > u8::MAX as usize {
            &b""[..]
        } else {
            peer_encoded
        };
        // Bounded so `lens` fits; cut on a UTF-8 boundary.
        let cap = |s| otlp::truncate_utf8(s, u16::MAX as usize);
        let (url, client, host, ua) = (
            cap(url),
            otlp::truncate_utf8(client, 256),
            cap(host),
            cap(ua),
        );
        self.raw.clear();
        self.raw
            .reserve(peer_encoded.len() + url.len() + client.len() + host.len() + ua.len());
        self.raw.extend_from_slice(peer_encoded);
        self.peer_encoded_len = peer_encoded.len() as u8;
        self.peer_encoded_attrs = match peer_encoded.len() {
            0 => 0,
            n => 1 + u8::from(n > PEER_TEXT_OFF + peer_encoded[PEER_TEXT_OFF - 1] as usize),
        };
        self.raw.extend_from_slice(url);
        self.raw.extend_from_slice(client);
        self.raw.extend_from_slice(host);
        self.raw.extend_from_slice(ua);
        self.lens = [
            url.len() as u32,
            client.len() as u32,
            host.len() as u32,
            ua.len() as u32,
            0,
        ];
        self.path_len = path_len.min(url.len()) as u32;
        if (self.path_len as usize) + 1 < url.len() {
            self.flags |= FLAG_HAS_QUERY;
        }
    }

    #[inline]
    pub fn set_route(&mut self, route: &[u8]) {
        let route = otlp::truncate_utf8(route, u16::MAX as usize);
        let end = self.peer_encoded_len as usize
            + (self.lens[0] + self.lens[1] + self.lens[2] + self.lens[3]) as usize;
        self.raw.truncate(end);
        self.raw.extend_from_slice(route);
        self.lens[4] = route.len() as u32;
    }

    #[inline]
    fn strings(&self) -> Strings<'_> {
        let [a, cl, b, c, d] = self.lens.map(|x| x as usize);
        let pe = (self.peer_encoded_len as usize).min(self.raw.len());
        let (peer_encoded, r) = self.raw.split_at(pe);
        if r.len() < a + cl + b + c + d {
            return Strings {
                peer_encoded: b"",
                url: b"",
                client: b"",
                keyed: b"",
                host: b"",
                user_agent: b"",
                route: b"",
            };
        }
        let k = a + cl;
        Strings {
            peer_encoded,
            url: &r[..a],
            client: &r[a..k],
            keyed: &r[k..],
            host: &r[k..k + b],
            user_agent: &r[k + b..k + b + c],
            route: &r[k + b + c..k + b + c + d],
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
    version: HttpVersion,
    /// Per-request (tail) attribute count; shapes droppedAttributesCount.
    tail_n: u8,
    status: u16,
    dropped: u16,
    dropped_events: u16,
    dropped_links: u16,
    lens: [u32; 3],
    /// keyed strings | attrs | extra | trace_state | name_override | status_message
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
            || self.version != facts.version
            || self.tail_n != tail_attr_count(facts) as u8
            || self.dropped != p.dropped_attrs
            || self.dropped_events != p.dropped_events
            || self.dropped_links != p.dropped_links
            || self.lens != [facts.lens[2], facts.lens[3], facts.lens[4]]
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
    /// The limits the templates were encoded under (they truncate values); a
    /// reconfigure with different limits invalidates them.
    limits: (u32, u16),
}

impl Cache {
    pub const fn new() -> Cache {
        Cache {
            entries: Vec::new(),
            limits: (0, 0),
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
    if c.limits != (limits.attribute_value_length, limits.attributes) {
        c.entries.clear();
        c.limits = (limits.attribute_value_length, limits.attributes);
    }
    let s = facts.strings();
    let has_parent = p.stub.parent.is_valid();
    let pieces: [&[u8]; 6] = [
        s.keyed,
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
    append_tail(
        out,
        start,
        &s,
        facts,
        limits,
        (limits.attributes as u32).saturating_sub(user_attr_count(p)),
    );
}

#[cold]
#[inline(never)]
fn encode_untemplated(out: &mut Vec<u8>, facts: &Facts, p: &SpanParts<'_>, limits: &Limits) {
    let s = facts.strings();
    let start = out.len();
    let len_at = encode_head(out, facts, p, &s, limits);
    debug_assert_eq!(len_at, start + OFF_LEN);
    append_tail(
        out,
        start,
        &s,
        facts,
        limits,
        (limits.attributes as u32).saturating_sub(user_attr_count(p)),
    );
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
        s.keyed,
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
    append_tail(
        out,
        start,
        &s,
        facts,
        limits,
        (limits.attributes as u32).saturating_sub(user_attr_count(p)),
    );
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
        version: facts.version,
        tail_n: tail_attr_count(facts) as u8,
        status: facts.status,
        dropped: p.dropped_attrs,
        dropped_events: p.dropped_events,
        dropped_links: p.dropped_links,
        lens: [facts.lens[2], facts.lens[3], facts.lens[4]],
        pieces: all,
        piece_len,
        bytes,
    };
    if c.entries.len() >= TEMPLATES {
        c.entries.pop();
    }
    c.entries.insert(0, t);
}

/// The originating client per RFC 7239 `Forwarded: for=` (first element) or,
/// failing that, the first `X-Forwarded-For` entry; empty if neither.
pub fn forwarded_client<'a>(
    forwarded: Option<&'a [u8]>,
    x_forwarded_for: Option<&'a [u8]>,
) -> &'a [u8] {
    use bun_core::strings;
    if let Some(f) = forwarded {
        // first element, `for=` parameter; value may be a quoted "[v6]:port".
        let first = strings::split(f, b",").next().unwrap_or(f);
        for param in strings::split(first, b";") {
            let param = strings::trim(param, b" \t");
            if param.len() > 4 && param[..4].eq_ignore_ascii_case(b"for=") {
                let mut v = strings::trim(&param[4..], b"\"");
                if v.first() == Some(&b'[') {
                    if let Some(end) = strings::index_of_char_usize(v, b']') {
                        return &v[1..end];
                    }
                } else if strings::count_char(v, b':') == 1 {
                    v = &v[..strings::index_of_char_usize(v, b':').unwrap_or(v.len())];
                }
                return v;
            }
        }
    }
    if let Some(x) = x_forwarded_for {
        let first = strings::split(x, b",").next().unwrap_or(x);
        return strings::trim(first, b" \t");
    }
    b""
}

const PEER_ADDRESS_KEY: &str = "network.peer.address";
const PEER_PORT_KEY: &str = "network.peer.port";
/// Offset of the address text inside [`encode_peer_attrs`] output
/// (4 header bytes + key + 4 value-header bytes; see `write_str_kv_small`).
const PEER_TEXT_OFF: usize = 4 + PEER_ADDRESS_KEY.len() + 4;
/// Upper bound of [`encode_peer_attrs`] output: the address KV with the
/// longest text plus the port KV (4 + key + 3 value header + 3-byte varint).
/// The transport's per-connection cache (uWS `HttpResponseData::peerAttrs`)
/// is sized from this.
pub const PEER_ATTRS_MAX: usize =
    PEER_TEXT_OFF + PeerIp::MAX_TEXT + 4 + PEER_PORT_KEY.len() + 3 + 3;

/// `network.peer.address` + `network.peer.port` for a connection. The
/// transport caches this per connection and hands it back in
/// `Facts::peer_encoded`, so steady-state requests copy instead of format.
pub fn encode_peer_attrs(peer: &PeerIp, port: u16, out: &mut Vec<u8>) {
    let mut ip_buf = [0u8; 64];
    let text = peer.text(&mut ip_buf);
    if text.is_empty() {
        return;
    }
    otlp::write_str_kv_small(out, f::ATTRIBUTES, PEER_ADDRESS_KEY, text);
    debug_assert_eq!(&out[PEER_TEXT_OFF..PEER_TEXT_OFF + text.len()], text);
    if port != 0 {
        otlp::write_key_value(
            out,
            f::ATTRIBUTES,
            PEER_PORT_KEY.as_bytes(),
            &Value::Int(port as i64),
        );
    }
}

/// The address text inside [`encode_peer_attrs`] output.
fn peer_text_of(encoded: &[u8]) -> &[u8] {
    let n = encoded.get(PEER_TEXT_OFF - 1).copied().unwrap_or(0) as usize;
    encoded.get(PEER_TEXT_OFF..PEER_TEXT_OFF + n).unwrap_or(b"")
}

/// Attributes appended per request rather than templated (see `append_tail`).
fn tail_attr_count(facts: &Facts) -> u32 {
    // url.path [+ url.query] [+ client.address] [+ network.peer.address [+ .port]]
    let peer_attrs = if facts.peer_encoded_attrs != 0 {
        facts.peer_encoded_attrs as u32
    } else if !matches!(facts.peer, PeerIp::None) {
        1 + u32::from(facts.peer_port != 0)
    } else {
        0
    };
    // client.address: the forwarded hop (lens[1]) or else the peer.
    let has_client = facts.lens[1] != 0 || peer_attrs != 0;
    1 + u32::from(facts.flags & FLAG_HAS_QUERY != 0) + u32::from(has_client) + peer_attrs
}

/// Attributes the span already carries from the request path (captured
/// headers, JS-set): they count first against `attributeCountLimit`.
#[inline]
fn user_attr_count(p: &SpanParts<'_>) -> u32 {
    if p.attrs.is_empty() {
        0
    } else {
        otlp::count_fields(p.attrs, f::ATTRIBUTES) as u32
    }
}

/// Per-request attributes after the templated part (at most `room` of them,
/// for `attributeCountLimit`), then the span length.
#[inline]
fn append_tail(
    out: &mut Vec<u8>,
    span_start: usize,
    s: &Strings<'_>,
    facts: &Facts,
    limits: &Limits,
    room: u32,
) {
    let max = limits.attribute_value_length as usize;
    let url = s.url;
    let pl = (facts.path_len as usize).min(url.len());
    let (path, query) = (&url[..pl], url.get(pl + 1..).unwrap_or(b""));
    // `room`: how many more attributes fit under attributeCountLimit.
    let mut room = room;
    let mut fresh = Vec::new();
    let (encoded, n): (&[u8], u32) = if !s.peer_encoded.is_empty() {
        (s.peer_encoded, facts.peer_encoded_attrs as u32)
    } else if !matches!(facts.peer, PeerIp::None) {
        fresh.reserve(PEER_ATTRS_MAX);
        encode_peer_attrs(&facts.peer, facts.peer_port, &mut fresh);
        (&fresh, 1 + u32::from(facts.peer_port != 0))
    } else {
        (b"", 0)
    };
    // semconv: client.address is the client behind any proxies (X-Forwarded-For
    // / Forwarded) — also the only identity on a unix-socket listener — and
    // network.peer.* the socket peer.
    let client = if s.client.is_empty() {
        peer_text_of(encoded)
    } else {
        s.client
    };
    if !client.is_empty() && room != 0 {
        otlp::write_str_kv_small(
            out,
            f::ATTRIBUTES,
            "client.address",
            otlp::truncate_utf8(client, max),
        );
        room -= 1;
    }
    if !encoded.is_empty() {
        if room >= n {
            out.extend_from_slice(encoded);
            room -= n;
        } else {
            room = 0;
        }
    }
    if room != 0 {
        otlp::write_str_kv_small(
            out,
            f::ATTRIBUTES,
            "url.path",
            otlp::truncate_utf8(path, max),
        );
        room -= 1;
    }
    if !query.is_empty() && room != 0 {
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
    let method: &[u8] = if facts.flags & FLAG_METHOD_OTHER != 0 {
        b"_OTHER"
    } else {
        method_name(facts.method).as_bytes()
    };
    // semconv: the span name uses `HTTP` for methods outside the known set.
    let method_in_name: &[u8] = if method == b"_OTHER" { b"HTTP" } else { method };
    let (host, ua, route) = (s.host, s.user_agent, s.route);
    let flags = facts.flags;
    let status = facts.status;
    let mut name_buf = [0u8; 8 + 256];
    let name: &[u8] = if !p.name_override.is_empty() {
        p.name_override
    } else if !route.is_empty() && route.len() <= 256 {
        let m = method_in_name;
        name_buf[..m.len()].copy_from_slice(m);
        name_buf[m.len()] = b' ';
        name_buf[m.len() + 1..m.len() + 1 + route.len()].copy_from_slice(route);
        &name_buf[..m.len() + 1 + route.len()]
    } else {
        method_in_name
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
    // Attributes already on the span (captured headers, JS-set) and the
    // per-request tail come first; the semconv set below fills what is left.
    let user = user_attr_count(p);
    let mut a = Attrs {
        w: &mut w,
        n: user + tail_attr_count(facts).min(budget.saturating_sub(user)),
        budget,
    };
    a.put("http.request.method", Value::Str(method));
    // (with FLAG_METHOD_OTHER the original was captured as a span attribute at begin)
    if method == b"_OTHER" && facts.flags & FLAG_METHOD_OTHER == 0 {
        a.put(
            "http.request.method_original",
            Value::Str(facts.method.as_str().as_bytes()),
        );
    }
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
        // semconv examples give IPv6 literals bare (as network.peer.address is).
        let hname = hname
            .strip_prefix(b"[")
            .and_then(|h| h.strip_suffix(b"]"))
            .unwrap_or(hname);
        a.put("server.address", Value::Str(lim(hname)));
        // semconv: required when server.address is set; the scheme default when Host has none.
        let port = port.unwrap_or(if flags & FLAG_HTTPS != 0 { 443 } else { 80 });
        a.put("server.port", Value::Int(port as i64));
    }
    if facts.version != HttpVersion::Unknown {
        a.put("network.protocol.version", Value::Str(facts.version.text()));
    }
    if !ua.is_empty() {
        a.put("user_agent.original", Value::Str(lim(ua)));
    }
    if !route.is_empty() {
        a.put("http.route", Value::Str(lim(route)));
    }
    // Attributes encoded on the request path (counted in `user` above).
    a.w.raw(p.attrs);
    let mut span_status = p.status;
    let mut msg: &[u8] = p.status_message;
    let has_error_type = flags & FLAG_HAS_ERROR_TYPE != 0;
    if status != 0 {
        a.put("http.response.status_code", Value::Int(status as i64));
        if status >= 500 {
            if !has_error_type {
                let mut buf = bun_core::fmt::ItoaBuf::new();
                a.put(
                    "error.type",
                    Value::Str(bun_core::fmt::itoa(&mut buf, status)),
                );
            }
            if span_status == StatusCode::Unset {
                span_status = StatusCode::Error;
            }
        }
    }
    if status < 500 && span_status != StatusCode::Ok {
        if flags & FLAG_ABORTED != 0 {
            if !has_error_type {
                a.put("error.type", Value::Str(b"aborted"));
            }
            if span_status == StatusCode::Unset {
                span_status = StatusCode::Error;
                msg = b"request aborted";
            }
        } else if flags & FLAG_HANDLER_ERROR != 0 {
            if !has_error_type {
                a.put("error.type", Value::Str(b"_OTHER"));
            }
            if span_status == StatusCode::Unset {
                span_status = StatusCode::Error;
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

pub use bun_core::fmt::split_host_port;

#[cfg(test)]
mod tests {
    use super::split_host_port;

    #[test]
    fn peer_attrs_fit_the_connection_cache() {
        use super::{PEER_ATTRS_MAX, PeerIp, encode_peer_attrs, peer_text_of};
        // uWS sizes HttpResponseData::peerAttrs with this number.
        assert_eq!(PEER_ATTRS_MAX, 100);
        let widest = PeerIp::from_text(&[b'f'; PeerIp::MAX_TEXT]);
        let mut out = Vec::new();
        encode_peer_attrs(&widest, u16::MAX, &mut out);
        assert!(
            out.len() <= PEER_ATTRS_MAX,
            "{} > {}",
            out.len(),
            PEER_ATTRS_MAX
        );
        assert_eq!(peer_text_of(&out), &[b'f'; PeerIp::MAX_TEXT][..]);
        let mut v6 = Vec::new();
        encode_peer_attrs(&PeerIp::V6([0xff; 16]), 65535, &mut v6);
        assert!(v6.len() <= PEER_ATTRS_MAX);
        let mut v4 = Vec::new();
        encode_peer_attrs(&PeerIp::V4([127, 0, 0, 1]), 8080, &mut v4);
        assert_eq!(peer_text_of(&v4), b"127.0.0.1");
    }

    #[test]
    fn host_port() {
        let cases: &[(&str, &str, Option<u16>)] = &[
            ("example.com", "example.com", None),
            ("example.com:8080", "example.com", Some(8080)),
            ("example.com:0", "example.com", Some(0)),
            ("example.com:", "example.com:", None),
            ("example.com:65536", "example.com:65536", None),
            ("example.com:abc", "example.com:abc", None),
            ("127.0.0.1:3000", "127.0.0.1", Some(3000)),
            ("[::1]:80", "[::1]", Some(80)),
            ("[::1]", "[::1]", None),
            ("[::1]x", "[::1]", None),
            ("[::1", "[::1", None),
            ("::1", "::1", None),
            ("2001:db8::1", "2001:db8::1", None),
            ("", "", None),
        ];
        for (input, host, port) in cases {
            let (h, p) = split_host_port(input.as_bytes());
            assert_eq!((h, p), (host.as_bytes(), *port), "{input:?}");
        }
    }
}
