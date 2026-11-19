//! HTTP server spans. The thread that serves the request copies what it knows of it, and whoever exports the span
//! encodes it: the queue holds a third of the bytes, and the names of the attributes are not among them.

use bun_core::fmt::split_host_port;
use bun_http_types::Method::Method;

use crate::otlp::{self, SpanWriter, Value};
use crate::span::SpanStub;
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

/// The other end of a connection.
#[derive(Clone, Copy)]
pub struct Peer {
    port: u16,
    len: u8,
    address: [u8; Peer::MAX_ADDRESS],
}

impl Peer {
    /// `ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255`
    const MAX_ADDRESS: usize = 45;
    pub const UNKNOWN: Peer = Peer {
        port: 0,
        len: 0,
        address: [0; Peer::MAX_ADDRESS],
    };

    pub fn new(address: &[u8], port: u16) -> Peer {
        let mut peer = Peer::UNKNOWN;
        if let Some(room) = peer.address.get_mut(..address.len()) {
            room.copy_from_slice(address);
            peer.len = address.len() as u8;
            peer.port = port;
        }
        peer
    }

    #[inline]
    fn address(&self) -> &[u8] {
        &self.address[..self.len as usize]
    }
}

/// Spares the later requests of a connection a system call. A connection that finds its place taken asks again.
pub struct PeerCache {
    last_tag: u32,
    places: Vec<(u32, Peer)>,
}

impl PeerCache {
    const MAX_PLACES: usize = 512;

    pub const fn new() -> PeerCache {
        PeerCache {
            last_tag: 0,
            places: Vec::new(),
        }
    }

    /// Never 0.
    pub fn next_tag(&mut self) -> u32 {
        if self.last_tag == u32::MAX {
            *self = PeerCache::new();
        }
        self.last_tag += 1;
        self.last_tag
    }

    #[inline]
    pub fn get(&mut self, tag: u32, ask: impl FnOnce() -> Peer) -> &Peer {
        let at = tag as usize % Self::MAX_PLACES;
        if at >= self.places.len() {
            self.places.resize(at + 1, (0, Peer::UNKNOWN));
        }
        let place = &mut self.places[at];
        if place.0 != tag {
            *place = (tag, ask());
        }
        &place.1
    }

    pub(crate) fn release_memory(&mut self) {
        self.places = Vec::new();
    }
}

/// Peer, path, query, client (the first hop of `Forwarded` or `X-Forwarded-For`), user agent, host, route.
const TEXTS: usize = 7;
const ROUTE: usize = TEXTS - 1;

#[derive(Clone, Copy)]
pub struct Exchange {
    lens: [u16; TEXTS],
    peer_port: u16,
    pub status: u16,
    /// Derived attributes JS has set on this span itself.
    pub(crate) user_keys: UserSetKeys,
    pub method: SemconvMethod,
    pub version: HttpVersion,
    pub https: bool,
    /// The response was never completed.
    pub is_aborted: bool,
}

impl Exchange {
    const NEW: Exchange = Exchange {
        lens: [0; TEXTS],
        peer_port: 0,
        status: 0,
        user_keys: UserSetKeys::NONE,
        method: SemconvMethod::Other,
        version: HttpVersion::Unknown,
        https: false,
        is_aborted: false,
    };

    fn split<'a>(&self, mut texts: &'a [u8]) -> [&'a [u8]; TEXTS] {
        self.lens.map(|len| take(&mut texts, len.into()))
    }
}

fn take<'a>(bytes: &mut &'a [u8], len: usize) -> &'a [u8] {
    bytes.split_off(..len).expect("what was queued")
}

pub struct Facts {
    /// As they came off the wire: they need not be UTF-8.
    texts: Vec<u8>,
    exchange: Exchange,
}

impl core::ops::Deref for Facts {
    type Target = Exchange;
    fn deref(&self) -> &Exchange {
        &self.exchange
    }
}

impl core::ops::DerefMut for Facts {
    fn deref_mut(&mut self) -> &mut Exchange {
        &mut self.exchange
    }
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

impl Facts {
    pub(crate) const fn new() -> Facts {
        Facts {
            texts: Vec::new(),
            exchange: Exchange::NEW,
        }
    }

    #[inline]
    pub(crate) fn clear(&mut self) {
        self.texts.clear();
        self.exchange = Exchange::NEW;
    }

    #[inline]
    pub(crate) fn capacity(&self) -> usize {
        self.texts.capacity()
    }

    /// Before [`set_route`](Self::set_route). `path_len`: where the query of `target` begins.
    #[inline]
    pub fn set_request(
        &mut self,
        peer: &Peer,
        target: &[u8],
        path_len: usize,
        client: &[u8],
        host: &[u8],
        user_agent: &[u8],
    ) {
        let (path, query) = target.split_at(path_len.min(target.len()));
        let path = &path[origin_len(path)..];
        let query = query.get(1..).unwrap_or_default();
        let client = otlp::truncate_utf8(client, 256);
        let texts = [peer.address(), path, query, client, user_agent, host]
            .map(|text| otlp::truncate_utf8(text, u16::MAX as usize));
        self.texts
            .reserve(texts.iter().map(|text| text.len()).sum());
        for (len, text) in self.exchange.lens.iter_mut().zip(texts) {
            *len = text.len() as u16;
            if !text.is_empty() {
                self.texts.extend_from_slice(text);
            }
        }
        self.exchange.peer_port = peer.port;
    }

    #[inline]
    pub fn set_route(&mut self, route: &[u8]) {
        let route = otlp::truncate_utf8(route, u16::MAX as usize);
        let len = &mut self.exchange.lens[ROUTE];
        self.texts.truncate(self.texts.len() - usize::from(*len));
        self.texts.extend_from_slice(route);
        *len = route.len() as u16;
    }

    /// The span name as it would be exported now.
    pub(crate) fn append_name(&self, out: &mut Vec<u8>) {
        let route = self.split(&self.texts)[ROUTE];
        out.extend_from_slice(span_name(self.method, route, &mut [0; NAME_MAX]));
    }
}

/// What the span has besides its facts.
pub(crate) struct SpanParts<'a> {
    pub(crate) stub: &'a SpanStub,
    pub(crate) end_ns: u64,
    pub(crate) name_override: &'a [u8],
    pub(crate) trace_state: &'a [u8],
    pub(crate) fields: &'a [u8],
    /// Attributes among `fields`.
    pub(crate) n_attrs: u16,
    /// Attributes, events, links.
    pub(crate) dropped: [u16; 3],
    pub(crate) status: StatusCode,
    pub(crate) status_message: &'a [u8],
}

#[derive(Clone, Copy)]
struct Queued {
    stub: SpanStub,
    end_ns: u64,
    exchange: Exchange,
    /// As they were when the span ended.
    limits: &'static Limits,
    n_attrs: u16,
    dropped: [u16; 3],
    status: StatusCode,
    /// The texts of the facts, the name, the tracestate, the status message, the fields.
    lens: [u32; 5],
}

const _: () = assert!(size_of::<Queued>() <= 120);

impl Queued {
    fn byte_len(&self) -> usize {
        self.lens.iter().map(|&len| len as usize).sum()
    }
}

#[derive(Clone, Default)]
pub(crate) struct Cursor {
    span: usize,
    byte: usize,
}

#[derive(Default)]
pub(crate) struct Queue {
    spans: Vec<Queued>,
    bytes: Vec<u8>,
}

impl Queue {
    #[inline]
    #[optimize(speed)]
    pub(crate) fn push(&mut self, facts: &Facts, p: &SpanParts<'_>, limits: &'static Limits) {
        let parts = [
            &facts.texts,
            p.name_override,
            p.trace_state,
            p.status_message,
            p.fields,
        ];
        for part in parts {
            if !part.is_empty() {
                self.bytes.extend_from_slice(part);
            }
        }
        self.spans.push(Queued {
            stub: *p.stub,
            end_ns: p.end_ns,
            exchange: facts.exchange,
            limits,
            n_attrs: p.n_attrs,
            dropped: p.dropped,
            status: p.status,
            lens: parts.map(|part| part.len() as u32),
        });
    }

    pub(crate) fn len(&self) -> usize {
        self.spans.len()
    }

    pub(crate) fn clear(&mut self) {
        self.spans.clear();
        self.bytes.clear();
    }

    /// Goes on from `at` by `n` spans at most, and copies them to `out`. Returns by how many.
    pub(crate) fn advance(&self, at: &mut Cursor, n: usize, out: Option<&mut Queue>) -> usize {
        let spans = &self.spans[at.span..];
        let spans = &spans[..n.min(spans.len())];
        let bytes = &self.bytes[at.byte..][..spans.iter().map(Queued::byte_len).sum()];
        if let Some(out) = out {
            out.spans.extend_from_slice(spans);
            out.bytes.extend_from_slice(bytes);
        }
        at.span += spans.len();
        at.byte += bytes.len();
        spans.len()
    }

    pub(crate) fn truncate(&mut self, at: &Cursor) {
        self.spans.truncate(at.span);
        self.bytes.truncate(at.byte);
    }

    pub(crate) fn encoded_len_hint(&self) -> usize {
        self.bytes.len() + self.spans.len() * 384
    }

    /// As `ScopeSpans.spans` entries.
    #[optimize(speed)]
    pub(crate) fn encode(&self, out: &mut Vec<u8>) {
        let mut bytes = &self.bytes[..];
        for span in &self.spans {
            span.encode(&span.lens.map(|len| take(&mut bytes, len as usize)), out);
        }
    }
}

/// How much of what precedes the query is no path: a proxy is sent `http://user:password@host/path`.
#[inline]
fn origin_len(target: &[u8]) -> usize {
    use bun_core::strings;
    if target.first() == Some(&b'/') {
        return 0;
    }
    match strings::index_of(target, b"://").map(|scheme| scheme + 3) {
        Some(authority) => strings::index_of_char_usize(&target[authority..], b'/')
            .map_or(target.len(), |i| authority + i),
        // CONNECT user:password@host:port
        None => strings::last_index_of_char(target, b'@').map_or(0, |at| at + 1),
    }
}

fn without_port(address: &[u8]) -> &[u8] {
    bun_core::ip_address::strip_ipv6_brackets(split_host_port(address).0)
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
                return without_port(strings::trim(&param[4..], b"\""));
            }
        }
    }
    if let Some(x) = x_forwarded_for {
        let first = strings::split(x, b",").next().unwrap_or(x);
        return without_port(strings::trim(first, b" \t"));
    }
    b""
}

const NAME_MAX: usize = 8 + 256;

/// `{METHOD} {route}`; the method alone when there is no route (or one over
/// 256 bytes), `HTTP` for methods outside the known set (semconv).
fn span_name<'b>(method: SemconvMethod, route: &[u8], buf: &'b mut [u8; NAME_MAX]) -> &'b [u8] {
    let m = method.span_name();
    buf[..m.len()].copy_from_slice(m);
    if route.is_empty() || route.len() > 256 {
        return &buf[..m.len()];
    }
    buf[m.len()] = b' ';
    buf[m.len() + 1..m.len() + 1 + route.len()].copy_from_slice(route);
    &buf[..m.len() + 1 + route.len()]
}

struct Derived<'w, 'a> {
    w: &'w mut SpanWriter<'a>,
    user_keys: UserSetKeys,
    room: u16,
    dropped: u32,
    max_len: usize,
}

impl Derived<'_, '_> {
    #[inline(always)]
    fn put<'v>(&mut self, bit: u16, key: &'static str, v: impl Into<Value<'v>>) {
        let v = v.into();
        if self.user_keys.has(bit) || matches!(v, Value::Str(b"")) {
            return;
        }
        match self.room.checked_sub(1) {
            Some(room) => {
                self.room = room;
                self.w.attr(key, &v, self.max_len);
            }
            None => self.dropped += 1,
        }
    }
}

impl Queued {
    #[optimize(speed)]
    fn encode(&self, parts: &[&[u8]; 5], out: &mut Vec<u8>) {
        use UserSetKeys as K;
        let [texts, name, trace_state, status_message, fields] = *parts;
        let x = &self.exchange;
        let [peer, path, query, client, user_agent, host, route] = x.split(texts);
        let mut name_buf = [0; NAME_MAX];
        let name = match name {
            b"" => span_name(x.method, route, &mut name_buf),
            given => given,
        };
        let mut w = SpanWriter::begin(out, &self.stub, name, self.end_ns);
        w.trace_state(trace_state).raw(fields);
        let mut a = Derived {
            w: &mut w,
            user_keys: x.user_keys,
            room: self.limits.attributes.saturating_sub(self.n_attrs),
            dropped: self.dropped[0].into(),
            max_len: self.limits.attribute_value_length as usize,
        };
        // In the order in which they are worth keeping under `attributeCountLimit`.
        a.put(K::METHOD, "http.request.method", x.method.attr_value());
        a.put(K::URL_PATH, "url.path", path);
        a.put(
            K::SCHEME,
            "url.scheme",
            if x.https { "https" } else { "http" },
        );
        if x.status != 0 {
            a.put(K::STATUS_CODE, "http.response.status_code", x.status);
        }
        let (mut status, mut message) = (self.status, status_message);
        if x.status >= 500 {
            let mut digits = bun_core::fmt::ItoaBuf::new();
            a.put(
                K::ERROR_TYPE,
                "error.type",
                bun_core::fmt::itoa(&mut digits, x.status),
            );
            if status == StatusCode::Unset {
                status = StatusCode::Error;
            }
        } else if x.is_aborted && status != StatusCode::Ok {
            a.put(K::ERROR_TYPE, "error.type", "aborted");
            if status == StatusCode::Unset {
                (status, message) = (StatusCode::Error, b"request aborted");
            }
        }
        a.put(K::ROUTE, "http.route", route);
        a.put(K::URL_QUERY, "url.query", &*otlp::redact_query(query));
        if !host.is_empty() {
            let userinfo = bun_core::strings::last_index_of_char(host, b'@');
            let (address, port) = split_host_port(&host[userinfo.map_or(0, |at| at + 1)..]);
            let address = bun_core::ip_address::strip_ipv6_brackets(address);
            a.put(K::SERVER_ADDRESS, "server.address", address);
            let port = port.unwrap_or(if x.https { 443 } else { 80 });
            a.put(K::SERVER_PORT, "server.port", port);
        }
        // semconv: the client behind any proxies.
        let client = if client.is_empty() { peer } else { client };
        a.put(K::CLIENT_ADDRESS, "client.address", client);
        a.put(K::PEER_ADDRESS, "network.peer.address", peer);
        if x.peer_port != 0 {
            a.put(K::PEER_PORT, "network.peer.port", x.peer_port);
        }
        a.put(
            K::PROTOCOL_VERSION,
            "network.protocol.version",
            x.version.text(),
        );
        a.put(K::USER_AGENT, "user_agent.original", user_agent);
        let dropped = a.dropped;
        w.dropped_attributes(dropped)
            .dropped_events(self.dropped[1].into())
            .dropped_links(self.dropped[2].into())
            .status(status, message);
    }
}

#[cfg(test)]
mod tests {
    use bun_core::fmt::split_host_port;

    #[test]
    fn the_path_of_every_form_of_target() {
        use super::{Facts, Peer};
        for (target, path, query) in [
            ("/a?b=c", "/a", "b=c"),
            ("/a?", "/a", ""),
            ("/http://x/y", "/http://x/y", ""),
            ("http://u:p@h/x?y", "/x", "y"),
            ("http://u:p@h?y", "", "y"),
            ("u:p@h:80", "h:80", ""),
            ("*", "*", ""),
        ] {
            let mut facts = Facts::new();
            let path_len = target.split('?').next().unwrap().len();
            facts.set_request(&Peer::UNKNOWN, target.as_bytes(), path_len, b"", b"h", b"");
            facts.set_route(b"/first");
            facts.set_route(b"/r");
            let [_, got @ .., _, _, host, route] = facts.split(&facts.texts);
            let got = [got[0], got[1], host, route];
            assert_eq!(got, [path, query, "h", "/r"].map(str::as_bytes), "{target}");
        }
    }

    #[test]
    fn a_connection_never_gets_the_peer_of_another() {
        use super::{Peer, PeerCache};
        let mut cache = PeerCache::new();
        let (first, rival) = (7, 7 + PeerCache::MAX_PLACES as u32);
        assert_eq!(cache.get(first, || Peer::new(b"a", 1)).address(), b"a");
        assert_eq!(cache.get(first, || unreachable!()).address(), b"a");
        assert_eq!(cache.get(rival, || Peer::new(b"b", 2)).address(), b"b");
        assert_eq!(cache.get(first, || Peer::new(b"a", 1)).address(), b"a");
        cache.last_tag = u32::MAX;
        assert_eq!(cache.next_tag(), 1);
        assert_eq!(cache.get(first, || Peer::new(b"c", 3)).address(), b"c");
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
