//! HTTP server spans: the request path captures raw facts (a few copies) and
//! the span is encoded at `end()` from a per-VM template. The template is
//! keyed on the low-cardinality shape of a request (method, status, host,
//! route, ...), so consecutive requests usually hit: one copy, id and time
//! patches at fixed offsets, then the per-request tail (path, user-agent,
//! JS-set attributes, events, tracestate).

use bun_http_types::Method::Method;

use crate::otlp::{self, SPAN_LEN_RESERVE, SpanWriter, Value, field as f};
use crate::proto::Nested;
use crate::span::{SpanKind, SpanStub};
use crate::{Limits, StatusCode};

/// `http.request.method` per semconv: the known set by name; anything else
/// is `_OTHER` (the request's own token recorded as
/// `http.request.method_original` at begin) and names the span `HTTP`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SemconvMethod {
    Get,
    Head,
    Post,
    Put,
    Delete,
    Connect,
    Options,
    Trace,
    Patch,
    Query,
    Other,
}

impl SemconvMethod {
    #[inline]
    pub const fn of(m: Option<Method>) -> SemconvMethod {
        match m {
            Some(Method::GET) => Self::Get,
            Some(Method::HEAD) => Self::Head,
            Some(Method::POST) => Self::Post,
            Some(Method::PUT) => Self::Put,
            Some(Method::DELETE) => Self::Delete,
            Some(Method::CONNECT) => Self::Connect,
            Some(Method::OPTIONS) => Self::Options,
            Some(Method::TRACE) => Self::Trace,
            Some(Method::PATCH) => Self::Patch,
            Some(Method::QUERY) => Self::Query,
            _ => Self::Other,
        }
    }

    /// The `http.request.method` attribute value.
    pub const fn attr_value(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Head => "HEAD",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Delete => "DELETE",
            Self::Connect => "CONNECT",
            Self::Options => "OPTIONS",
            Self::Trace => "TRACE",
            Self::Patch => "PATCH",
            Self::Query => "QUERY",
            Self::Other => "_OTHER",
        }
    }

    /// The span-name prefix: the method, or `HTTP` for `Other` (semconv).
    pub const fn span_name(self) -> &'static [u8] {
        match self {
            Self::Other => b"HTTP",
            m => m.attr_value().as_bytes(),
        }
    }

    #[inline]
    pub const fn is_other(self) -> bool {
        matches!(self, Self::Other)
    }
}

/// How the server finished the request (set once, at end).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Termination {
    /// A status line went out (or the exchange completed normally).
    Completed,
    /// The client went away / the response was never finished.
    Aborted,
    /// The JS handler threw or rejected (node:http): an error even when the
    /// status that went out was not 5xx.
    HandlerError,
}

/// The peer address as captured on the request path; formatted by
/// [`Facts::set_request`].
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

/// Byte lengths of the strings packed back to back in `Facts::raw` after the
/// peer attributes.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Lens {
    url: u32,
    client: u32,
    host: u32,
    user_agent: u32,
    route: u32,
}

impl Lens {
    const ZERO: Lens = Lens {
        url: 0,
        client: 0,
        host: 0,
        user_agent: 0,
        route: 0,
    };
}

/// Request facts captured at begin; lives in the pool slot.
pub struct Facts {
    /// The encoded peer attributes, then url | client | user-agent | host |
    /// route back to back (see [`Lens`]). url, client (the forwarded-for
    /// address) and user-agent vary per request; host | route key the template.
    raw: Vec<u8>,
    lens: Lens,
    /// Length of the path part of the url (`lens.url` if no query).
    path_len: u32,
    /// `Other`: the request's token went out as
    /// `http.request.method_original` at begin.
    pub method: SemconvMethod,
    /// Length of the encoded `network.peer.*` bytes at the front of `raw`
    /// ([`encode_peer_attrs`], written by [`Facts::set_request`]).
    peer_encoded_len: u8,
    /// How many attributes those bytes hold ([`encode_peer_attrs`]'s count).
    peer_encoded_attrs: u8,
    pub version: HttpVersion,
    pub https: bool,
    pub termination: Termination,
    pub status: u16,
    /// Derived attributes JS has set on this span itself.
    pub user_keys: UserSetKeys,
    /// This slot holds an HTTP server span rather than a generic one.
    pub active: bool,
}

/// The attributes the encoder derives for a request span at export time.
/// A bit is set once JS put that key on the span itself; the encoder then
/// leaves it alone (the user's value wins and the key is never written twice).
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct UserSetKeys(u16);

impl UserSetKeys {
    pub const NONE: UserSetKeys = UserSetKeys(0);
    const METHOD: u16 = 1 << 0;
    const SCHEME: u16 = 1 << 1;
    const SERVER_ADDRESS: u16 = 1 << 2;
    const SERVER_PORT: u16 = 1 << 3;
    const PROTOCOL_VERSION: u16 = 1 << 4;
    const USER_AGENT: u16 = 1 << 5;
    const STATUS_CODE: u16 = 1 << 6;
    const ERROR_TYPE: u16 = 1 << 7;
    const ROUTE: u16 = 1 << 8;
    const URL_PATH: u16 = 1 << 9;
    const URL_QUERY: u16 = 1 << 10;
    const CLIENT_ADDRESS: u16 = 1 << 11;
    const PEER_ADDRESS: u16 = 1 << 12;
    const PEER_PORT: u16 = 1 << 13;

    #[inline]
    fn bit(key: &[u8]) -> u16 {
        match key {
            b"http.request.method" => Self::METHOD,
            b"url.scheme" => Self::SCHEME,
            b"server.address" => Self::SERVER_ADDRESS,
            b"server.port" => Self::SERVER_PORT,
            b"network.protocol.version" => Self::PROTOCOL_VERSION,
            b"user_agent.original" => Self::USER_AGENT,
            b"http.response.status_code" => Self::STATUS_CODE,
            b"error.type" => Self::ERROR_TYPE,
            b"http.route" => Self::ROUTE,
            b"url.path" => Self::URL_PATH,
            b"url.query" => Self::URL_QUERY,
            b"client.address" => Self::CLIENT_ADDRESS,
            b"network.peer.address" => Self::PEER_ADDRESS,
            b"network.peer.port" => Self::PEER_PORT,
            _ => 0,
        }
    }
    #[inline]
    pub fn insert(&mut self, key: &[u8]) {
        self.0 |= Self::bit(key);
    }
    #[inline]
    pub fn remove(&mut self, key: &[u8]) {
        self.0 &= !Self::bit(key);
    }
    #[inline]
    fn has(self, bit: u16) -> bool {
        self.0 & bit != 0
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum HttpVersion {
    Unknown,
    Http11,
    Http2,
    Http3,
    Http10,
}

impl HttpVersion {
    fn text(self) -> &'static [u8] {
        match self {
            HttpVersion::Unknown => b"",
            HttpVersion::Http10 => b"1.0",
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
    user_agent: &'a [u8],
    /// host | route (part of the template key).
    keyed: &'a [u8],
    host: &'a [u8],
    route: &'a [u8],
}

impl Facts {
    pub const fn new() -> Facts {
        Facts {
            raw: Vec::new(),
            lens: Lens::ZERO,
            path_len: 0,
            method: SemconvMethod::Other,
            peer_encoded_len: 0,
            peer_encoded_attrs: 0,
            version: HttpVersion::Unknown,
            https: false,
            termination: Termination::Completed,
            status: 0,
            user_keys: UserSetKeys::NONE,
            active: false,
        }
    }

    #[inline]
    pub fn reset(&mut self) {
        self.raw.clear();
        self.lens = Lens::ZERO;
        self.path_len = 0;
        self.method = SemconvMethod::Other;
        self.active = false;
        self.https = false;
        self.termination = Termination::Completed;
        self.status = 0;
        self.user_keys = UserSetKeys::NONE;
        self.peer_encoded_len = 0;
        self.peer_encoded_attrs = 0;
        self.version = HttpVersion::Unknown;
        if self.raw.capacity() > 16 * 1024 {
            self.raw = Vec::new();
        }
    }

    /// Set the request strings in one go (must be called before `set_route`);
    /// the socket peer's `network.peer.*` attributes are encoded here.
    /// `client`: the first forwarded-for hop (empty if none).
    #[inline]
    pub fn set_request(
        &mut self,
        peer: &PeerIp,
        peer_port: u16,
        url: &[u8],
        path_len: usize,
        client: &[u8],
        host: &[u8],
        ua: &[u8],
    ) {
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
            .reserve(PEER_ATTRS_MAX + url.len() + client.len() + host.len() + ua.len());
        self.peer_encoded_attrs = encode_peer_attrs(peer, peer_port, &mut self.raw);
        debug_assert!(self.raw.len() <= u8::MAX as usize);
        self.peer_encoded_len = self.raw.len() as u8;
        // Wire bytes may not be UTF-8 (obs-text); proto3 strings must be.
        // The url goes in as path then query so `path_len` is measured on the
        // sanitized bytes (a replacement is longer than the byte it replaces).
        let path_len = path_len.min(url.len());
        let at = self.raw.len();
        otlp::extend_utf8_lossy(&mut self.raw, &url[..path_len]);
        self.path_len = (self.raw.len() - at) as u32;
        otlp::extend_utf8_lossy(&mut self.raw, &url[path_len..]);
        let url = (self.raw.len() - at) as u32;
        let mut put = |s: &[u8]| {
            let at = self.raw.len();
            otlp::extend_utf8_lossy(&mut self.raw, s);
            (self.raw.len() - at) as u32
        };
        let client = put(client);
        let user_agent = put(ua);
        let host = put(host);
        self.lens = Lens {
            url,
            client,
            host,
            user_agent,
            route: 0,
        };
    }

    /// The span name as it would be exported now (see [`span_name`]).
    pub fn append_name(&self, out: &mut Vec<u8>) {
        let mut buf = [0u8; NAME_MAX];
        out.extend_from_slice(span_name(self, self.strings().route, &mut buf));
    }

    #[inline]
    fn has_query(&self) -> bool {
        self.path_len + 1 < self.lens.url
    }

    /// Where the route starts in `raw` (everything before it is kept).
    #[inline]
    fn route_at(&self) -> usize {
        let l = &self.lens;
        self.peer_encoded_len as usize + (l.url + l.client + l.host + l.user_agent) as usize
    }

    #[inline]
    pub fn set_route(&mut self, route: &[u8]) {
        let route = otlp::truncate_utf8(route, u16::MAX as usize);
        self.raw.truncate(self.route_at());
        self.raw.extend_from_slice(route);
        self.lens.route = route.len() as u32;
    }

    /// Routes matched by their literal path: the recorded request path is the
    /// route.
    pub fn set_route_from_path(&mut self) {
        let start = self.peer_encoded_len as usize;
        let end = start + self.path_len as usize;
        self.raw.truncate(self.route_at());
        self.raw.extend_from_within(start..end);
        self.lens.route = self.path_len;
    }

    #[inline]
    fn strings(&self) -> Strings<'_> {
        let Lens {
            url: a,
            client: cl,
            host: b,
            user_agent: c,
            route: d,
        } = self.lens;
        let [a, cl, b, c, d] = [a, cl, b, c, d].map(|x| x as usize);
        let pe = (self.peer_encoded_len as usize).min(self.raw.len());
        let (peer_encoded, r) = self.raw.split_at(pe);
        if r.len() < a + cl + c + b + d {
            return Strings {
                peer_encoded: b"",
                url: b"",
                client: b"",
                user_agent: b"",
                keyed: b"",
                host: b"",
                route: b"",
            };
        }
        let k = a + cl + c;
        Strings {
            peer_encoded,
            url: &r[..a],
            client: &r[a..a + cl],
            user_agent: &r[a + cl..k],
            keyed: &r[k..],
            host: &r[k..k + b],
            route: &r[k + b..k + b + d],
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
    /// Attributes already encoded in `attrs`.
    pub n_attrs: u16,
    pub dropped_attrs: u16,
    pub dropped_events: u16,
    pub dropped_links: u16,
    pub extra: &'a [u8],
    pub status: StatusCode,
    pub status_message: &'a [u8],
}

/// What a cached encoding depends on besides `Template::pieces`: only
/// low-cardinality facts, so real traffic (diverse user-agents, per-request
/// JS-set attributes) still hits.
#[derive(Clone, Copy, PartialEq, Eq)]
struct TemplateKey {
    https: bool,
    termination: Termination,
    user_keys: UserSetKeys,
    status: u16,
    status_code: StatusCode,
    has_parent: bool,
    method: SemconvMethod,
    version: HttpVersion,
    /// Attributes already on the span and the per-request (tail) count: both
    /// take budget before the templated set and shape droppedAttributesCount.
    n_attrs: u16,
    tail_n: u8,
    dropped: u16,
    dropped_events: u16,
    dropped_links: u16,
    lens: [u32; 2],
}

impl TemplateKey {
    #[inline]
    fn of(facts: &Facts, p: &SpanParts<'_>) -> TemplateKey {
        TemplateKey {
            https: facts.https,
            termination: facts.termination,
            user_keys: facts.user_keys,
            status: facts.status,
            status_code: p.status,
            has_parent: p.stub.parent.is_valid(),
            method: facts.method,
            version: facts.version,
            n_attrs: p.n_attrs,
            tail_n: tail_attr_count(facts) as u8,
            dropped: p.dropped_attrs,
            dropped_events: p.dropped_events,
            dropped_links: p.dropped_links,
            lens: [facts.lens.host, facts.lens.route],
        }
    }
}

const PIECES: usize = 3;

struct Template {
    key: TemplateKey,
    /// keyed strings | name_override | status_message
    pieces: Vec<u8>,
    piece_len: [u32; PIECES],
    /// Encoded span up to (not including) the per-request tail.
    bytes: Vec<u8>,
}

impl Template {
    #[inline]
    fn matches(&self, key: &TemplateKey, pieces: &[&[u8]; PIECES]) -> bool {
        if self.key != *key {
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
    let key = TemplateKey::of(facts, p);
    let pieces: [&[u8]; PIECES] = [s.keyed, p.name_override, p.status_message];
    let Some(i) = c.entries.iter().position(|t| t.matches(&key, &pieces)) else {
        return encode_miss(c, out, facts, p, limits, &s, key, &pieces);
    };
    if i != 0 {
        c.entries.swap(0, i);
    }
    let t = &c.entries[0];
    let start = out.len();
    out.reserve(
        t.bytes.len()
            + 96
            + s.url.len()
            + s.user_agent.len()
            + p.attrs.len()
            + p.extra.len()
            + p.trace_state.len(),
    );
    out.extend_from_slice(&t.bytes);
    out[start + OFF_TRACE_ID..start + OFF_TRACE_ID + 16].copy_from_slice(&p.stub.ctx.trace_id.0);
    out[start + OFF_SPAN_ID..start + OFF_SPAN_ID + 8].copy_from_slice(&p.stub.ctx.span_id.0);
    if key.has_parent {
        out[start + OFF_PARENT..start + OFF_PARENT + 8].copy_from_slice(&p.stub.parent.0);
    }
    let st = start + off_start(key.has_parent);
    out[st..st + 8].copy_from_slice(&p.stub.start_ns.to_le_bytes());
    out[st + 9..st + 17].copy_from_slice(&p.end_ns.max(p.stub.start_ns).to_le_bytes());
    // flags: 2-byte tag then fixed32
    out[st + 19..st + 23].copy_from_slice(&p.stub.ctx.flags.otlp().to_le_bytes());
    append_tail(out, start, &s, facts, p, limits);
}

#[cold]
#[inline(never)]
fn encode_untemplated(out: &mut Vec<u8>, facts: &Facts, p: &SpanParts<'_>, limits: &Limits) {
    let s = facts.strings();
    let start = out.len();
    encode_head(out, facts, p, &s, limits);
    append_tail(out, start, &s, facts, p, limits);
}

#[cold]
#[inline(never)]
fn encode_miss(
    c: &mut Cache,
    out: &mut Vec<u8>,
    facts: &Facts,
    p: &SpanParts<'_>,
    limits: &Limits,
    s: &Strings<'_>,
    key: TemplateKey,
    pieces: &[&[u8]; PIECES],
) {
    let start = out.len();
    encode_head(out, facts, p, s, limits);
    // The evicted entry's buffers are reused.
    let mut t = if c.entries.len() >= TEMPLATES {
        let mut t = c.entries.pop().unwrap();
        t.key = key;
        t
    } else {
        Template {
            key,
            pieces: Vec::new(),
            piece_len: [0; PIECES],
            bytes: Vec::new(),
        }
    };
    // (captured before the tail: patching a long span's length can shift the body)
    t.bytes.clear();
    t.bytes.extend_from_slice(&out[start..]);
    append_tail(out, start, s, facts, p, limits);
    t.pieces.clear();
    for (i, piece) in pieces.iter().enumerate() {
        t.piece_len[i] = piece.len() as u32;
        t.pieces.extend_from_slice(piece);
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
pub(crate) const PEER_ATTRS_MAX: usize =
    PEER_TEXT_OFF + PeerIp::MAX_TEXT + 4 + PEER_PORT_KEY.len() + 3 + 3;

/// `network.peer.address` + `network.peer.port` encoded for `Facts`. Returns
/// how many attributes it wrote: 0 (no address text), 1 (address) or 2
/// (address and port).
pub(crate) fn encode_peer_attrs(peer: &PeerIp, port: u16, out: &mut Vec<u8>) -> u8 {
    let mut ip_buf = [0u8; 64];
    let text = peer.text(&mut ip_buf);
    if text.is_empty() {
        return 0;
    }
    otlp::write_str_kv_small(out, f::ATTRIBUTES, PEER_ADDRESS_KEY, text);
    debug_assert_eq!(&out[PEER_TEXT_OFF..PEER_TEXT_OFF + text.len()], text);
    if port == 0 {
        return 1;
    }
    otlp::write_key_value(
        out,
        f::ATTRIBUTES,
        PEER_PORT_KEY.as_bytes(),
        &Value::Int(port as i64),
    );
    2
}

/// The address text inside [`encode_peer_attrs`] output.
pub(crate) fn peer_text_of(encoded: &[u8]) -> &[u8] {
    let n = encoded.get(PEER_TEXT_OFF - 1).copied().unwrap_or(0) as usize;
    encoded.get(PEER_TEXT_OFF..PEER_TEXT_OFF + n).unwrap_or(b"")
}

/// Derived attributes appended per request rather than templated (see
/// `append_tail`).
fn tail_attr_count(facts: &Facts) -> u32 {
    // [client.address +] [network.peer.address [+ .port] +] url.path
    // [+ url.query] [+ user_agent.original], each unless JS set it itself
    let user = facts.user_keys;
    let (peer_addr, peer_port) = facts.derived_peer_attrs();
    // client.address: the forwarded hop or else the peer.
    let has_client = (facts.lens.client != 0 || facts.peer_encoded_attrs != 0)
        && !user.has(UserSetKeys::CLIENT_ADDRESS);
    u32::from(facts.derives_user_agent())
        + u32::from(!user.has(UserSetKeys::URL_PATH))
        + u32::from(facts.has_query() && !user.has(UserSetKeys::URL_QUERY))
        + u32::from(has_client)
        + u32::from(peer_addr)
        + u32::from(peer_port)
}

impl Facts {
    #[inline]
    fn derives_user_agent(&self) -> bool {
        self.lens.user_agent != 0 && !self.user_keys.has(UserSetKeys::USER_AGENT)
    }
    /// (network.peer.address, network.peer.port): encoded for this request and
    /// not overridden from JS.
    #[inline]
    fn derived_peer_attrs(&self) -> (bool, bool) {
        let n = self.peer_encoded_attrs;
        (
            n >= 1 && !self.user_keys.has(UserSetKeys::PEER_ADDRESS),
            n >= 2 && !self.user_keys.has(UserSetKeys::PEER_PORT),
        )
    }
}

/// Everything per-request after the templated part: tracestate, the
/// attributes already encoded on the slot (captured headers, JS-set), events
/// and links, then the derived per-request attributes (as many as still fit
/// under `attributeCountLimit`), then the span length. `Span` field order
/// is free, so these may follow the templated status.
#[inline]
fn append_tail(
    out: &mut Vec<u8>,
    span_start: usize,
    s: &Strings<'_>,
    facts: &Facts,
    p: &SpanParts<'_>,
    limits: &Limits,
) {
    crate::proto::write_bytes_opt(out, f::TRACE_STATE, p.trace_state);
    out.extend_from_slice(p.attrs);
    out.extend_from_slice(p.extra);
    let max = limits.attribute_value_length as usize;
    let url = s.url;
    let pl = (facts.path_len as usize).min(url.len());
    let (path, query) = (&url[..pl], url.get(pl + 1..).unwrap_or(b""));
    // `room`: how many more attributes fit under attributeCountLimit after the
    // ones the span already carries (`p.attrs`).
    let mut room = (limits.attributes as u32).saturating_sub(u32::from(p.n_attrs));
    let user = facts.user_keys;
    let encoded = s.peer_encoded;
    // semconv: client.address is the client behind any proxies (X-Forwarded-For
    // / Forwarded) — also the only identity on a unix-socket listener — and
    // network.peer.* the socket peer.
    let client = if s.client.is_empty() {
        peer_text_of(encoded)
    } else {
        s.client
    };
    if !client.is_empty() && !user.has(UserSetKeys::CLIENT_ADDRESS) && room != 0 {
        otlp::write_str_kv_small(
            out,
            f::ATTRIBUTES,
            "client.address",
            otlp::truncate_utf8(client, max),
        );
        room -= 1;
    }
    // Strictly in order, so the head's dropped_attributes_count (which assumes
    // the first `room` tail attributes are written) stays exact: with room for
    // one, keep network.peer.address and drop the port.
    let (peer_addr, peer_port) = facts.derived_peer_attrs();
    let addr_end = PEER_TEXT_OFF + peer_text_of(encoded).len();
    if peer_addr && room != 0 {
        out.extend_from_slice(&encoded[..addr_end.min(encoded.len())]);
        room -= 1;
    }
    if peer_port && room != 0 {
        out.extend_from_slice(&encoded[addr_end.min(encoded.len())..]);
        room -= 1;
    }
    if !user.has(UserSetKeys::URL_PATH) && room != 0 {
        otlp::write_str_kv_small(
            out,
            f::ATTRIBUTES,
            "url.path",
            otlp::truncate_utf8(path, max),
        );
        room -= 1;
    }
    if !query.is_empty() && !user.has(UserSetKeys::URL_QUERY) && room != 0 {
        let query = otlp::redact_query(query);
        otlp::write_str_kv_small(
            out,
            f::ATTRIBUTES,
            "url.query",
            otlp::truncate_utf8(&query, max),
        );
        room -= 1;
    }
    // Last: under attributeCountLimit pressure the addresses and the URL
    // (semconv-required) outrank the user agent.
    if facts.derives_user_agent() && room != 0 {
        otlp::write_str_kv_small(
            out,
            f::ATTRIBUTES,
            "user_agent.original",
            otlp::truncate_utf8(s.user_agent, max),
        );
    }
    Nested::<SPAN_LEN_RESERVE>::at(span_start + OFF_LEN).finish(out);
}

const NAME_MAX: usize = 8 + 256;

/// `{METHOD} {route}`; the method alone when there is no route (or one over
/// 256 bytes), `HTTP` for methods outside the known set (semconv).
fn span_name<'b>(facts: &Facts, route: &[u8], buf: &'b mut [u8; NAME_MAX]) -> &'b [u8] {
    let m = facts.method.span_name();
    buf[..m.len()].copy_from_slice(m);
    if route.is_empty() || route.len() > 256 {
        return &buf[..m.len()];
    }
    buf[m.len()] = b' ';
    buf[m.len() + 1..m.len() + 1 + route.len()].copy_from_slice(route);
    &buf[..m.len() + 1 + route.len()]
}

/// Encode everything except the per-request tail, leaving the span length
/// unpatched (append_tail patches it).
fn encode_head(
    out: &mut Vec<u8>,
    facts: &Facts,
    p: &SpanParts<'_>,
    s: &Strings<'_>,
    limits: &Limits,
) {
    let start = out.len();
    let (host, route) = (s.host, s.route);
    let status = facts.status;
    let mut name_buf = [0u8; NAME_MAX];
    let name: &[u8] = if p.name_override.is_empty() {
        span_name(facts, route, &mut name_buf)
    } else {
        p.name_override
    };
    let mut w = SpanWriter::begin(
        out,
        p.stub,
        name,
        SpanKind::Server,
        p.end_ns,
        limits.attribute_value_length,
    );
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
    // per-request tail take budget first; the semconv set below fills what
    // is left.
    let mut a = Attrs {
        w: &mut w,
        // (unclamped: tail attributes that did not fit count as dropped)
        n: u32::from(p.n_attrs) + tail_attr_count(facts),
        budget,
    };
    let user = facts.user_keys;
    if !user.has(UserSetKeys::METHOD) {
        a.put(
            "http.request.method",
            Value::Str(facts.method.attr_value().as_bytes()),
        );
    }
    if !user.has(UserSetKeys::SCHEME) {
        a.put(
            "url.scheme",
            Value::Str(if facts.https { b"https" } else { b"http" }),
        );
    }
    if !host.is_empty() {
        let (hname, port) = split_host_port(host);
        // semconv examples give IPv6 literals bare (as network.peer.address is).
        let hname = hname
            .strip_prefix(b"[")
            .and_then(|h| h.strip_suffix(b"]"))
            .unwrap_or(hname);
        if !user.has(UserSetKeys::SERVER_ADDRESS) {
            a.put("server.address", Value::Str(hname));
        }
        // semconv: required when server.address is set; the scheme default when Host has none.
        if !user.has(UserSetKeys::SERVER_PORT) {
            let port = port.unwrap_or(if facts.https { 443 } else { 80 });
            a.put("server.port", Value::Int(port as i64));
        }
    }
    if facts.version != HttpVersion::Unknown && !user.has(UserSetKeys::PROTOCOL_VERSION) {
        a.put("network.protocol.version", Value::Str(facts.version.text()));
    }
    if !route.is_empty() && !user.has(UserSetKeys::ROUTE) {
        a.put("http.route", Value::Str(route));
    }
    let mut span_status = p.status;
    let mut msg: &[u8] = p.status_message;
    let has_error_type = user.has(UserSetKeys::ERROR_TYPE);
    if status != 0 {
        if !user.has(UserSetKeys::STATUS_CODE) {
            a.put("http.response.status_code", Value::Int(status as i64));
        }
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
        match facts.termination {
            Termination::Aborted => {
                if !has_error_type {
                    a.put("error.type", Value::Str(b"aborted"));
                }
                if span_status == StatusCode::Unset {
                    span_status = StatusCode::Error;
                    msg = b"request aborted";
                }
            }
            Termination::HandlerError => {
                if !has_error_type {
                    a.put("error.type", Value::Str(b"_OTHER"));
                }
                if span_status == StatusCode::Unset {
                    span_status = StatusCode::Error;
                }
            }
            Termination::Completed => {}
        }
    }
    let n_attrs = a.n;
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
    let len_at = w.finish_unpatched();
    // The template hit path patches ids and times at these fixed offsets.
    debug_assert_eq!(len_at, start + OFF_LEN);
    if cfg!(debug_assertions) {
        let (b, st) = (&out[start..], off_start(p.stub.parent.is_valid()));
        debug_assert_eq!(&b[OFF_TRACE_ID..OFF_TRACE_ID + 16], &p.stub.ctx.trace_id.0);
        debug_assert_eq!(&b[OFF_SPAN_ID..OFF_SPAN_ID + 8], &p.stub.ctx.span_id.0);
        debug_assert_eq!(&b[st..st + 8], &p.stub.start_ns.to_le_bytes());
        debug_assert_eq!(
            &b[st + 9..st + 17],
            &p.end_ns.max(p.stub.start_ns).to_le_bytes()
        );
    }
}

pub use bun_core::fmt::split_host_port;

#[cfg(test)]
mod tests {
    use super::split_host_port;

    #[test]
    fn peer_attrs_bound() {
        use super::{PEER_ATTRS_MAX, PeerIp, encode_peer_attrs, peer_text_of};
        // `Facts::peer_encoded_len` is a u8.
        assert!(PEER_ATTRS_MAX <= u8::MAX as usize);
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
