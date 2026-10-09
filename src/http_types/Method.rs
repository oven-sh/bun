use bun_core::StringPointer;
use enumset::EnumSet;

use crate::ETag::Headers;

#[allow(non_camel_case_types)]
#[repr(u8)]
#[derive(enumset::EnumSetType, Debug)]
pub enum Method {
    ACL = 0,
    BIND = 1,
    CHECKOUT = 2,
    CONNECT = 3,
    COPY = 4,
    DELETE = 5,
    GET = 6,
    HEAD = 7,
    LINK = 8,
    LOCK = 9,
    M_SEARCH = 10,
    MERGE = 11,
    MKACTIVITY = 12,
    MKADDRESSBOOK = 13,
    MKCALENDAR = 14,
    MKCOL = 15,
    MOVE = 16,
    NOTIFY = 17,
    OPTIONS = 18,
    PATCH = 19,
    POST = 20,
    PROPFIND = 21,
    PROPPATCH = 22,
    PURGE = 23,
    PUT = 24,
    /// https://httpwg.org/http-extensions/draft-ietf-httpbis-safe-method-w-body.html
    QUERY = 25,
    REBIND = 26,
    REPORT = 27,
    SEARCH = 28,
    SOURCE = 29,
    SUBSCRIBE = 30,
    TRACE = 31,
    UNBIND = 32,
    UNLINK = 33,
    UNLOCK = 34,
    UNSUBSCRIBE = 35,
}

// Per PORTING.md, to_js/from_js live as extension-trait methods in the `bun_http_jsc` crate.

pub type Set = EnumSet<Method>;

bun_core::comptime_string_map! {
    /// The wire form is RFC 9110 case-sensitive uppercase, so the per-request
    /// hot path hits the uppercase entries; the all-lower entries exist only
    /// for `new Request("get", …)` JS-side convenience (mixed-case still
    /// rejects).
    #[inline]
    static METHOD_MAP: Method = {
        b"ACL" => Method::ACL,
        b"acl" => Method::ACL,
        b"BIND" => Method::BIND,
        b"bind" => Method::BIND,
        b"CHECKOUT" => Method::CHECKOUT,
        b"checkout" => Method::CHECKOUT,
        b"CONNECT" => Method::CONNECT,
        b"connect" => Method::CONNECT,
        b"COPY" => Method::COPY,
        b"copy" => Method::COPY,
        b"DELETE" => Method::DELETE,
        b"delete" => Method::DELETE,
        b"GET" => Method::GET,
        b"get" => Method::GET,
        b"HEAD" => Method::HEAD,
        b"head" => Method::HEAD,
        b"LINK" => Method::LINK,
        b"link" => Method::LINK,
        b"LOCK" => Method::LOCK,
        b"lock" => Method::LOCK,
        b"M-SEARCH" => Method::M_SEARCH,
        b"m-search" => Method::M_SEARCH,
        b"MERGE" => Method::MERGE,
        b"merge" => Method::MERGE,
        b"MKACTIVITY" => Method::MKACTIVITY,
        b"mkactivity" => Method::MKACTIVITY,
        b"MKADDRESSBOOK" => Method::MKADDRESSBOOK,
        b"mkaddressbook" => Method::MKADDRESSBOOK,
        b"MKCALENDAR" => Method::MKCALENDAR,
        b"mkcalendar" => Method::MKCALENDAR,
        b"MKCOL" => Method::MKCOL,
        b"mkcol" => Method::MKCOL,
        b"MOVE" => Method::MOVE,
        b"move" => Method::MOVE,
        b"NOTIFY" => Method::NOTIFY,
        b"notify" => Method::NOTIFY,
        b"OPTIONS" => Method::OPTIONS,
        b"options" => Method::OPTIONS,
        b"PATCH" => Method::PATCH,
        b"patch" => Method::PATCH,
        b"POST" => Method::POST,
        b"post" => Method::POST,
        b"PROPFIND" => Method::PROPFIND,
        b"propfind" => Method::PROPFIND,
        b"PROPPATCH" => Method::PROPPATCH,
        b"proppatch" => Method::PROPPATCH,
        b"PURGE" => Method::PURGE,
        b"purge" => Method::PURGE,
        b"PUT" => Method::PUT,
        b"put" => Method::PUT,
        b"QUERY" => Method::QUERY,
        b"query" => Method::QUERY,
        b"REBIND" => Method::REBIND,
        b"rebind" => Method::REBIND,
        b"REPORT" => Method::REPORT,
        b"report" => Method::REPORT,
        b"SEARCH" => Method::SEARCH,
        b"search" => Method::SEARCH,
        b"SOURCE" => Method::SOURCE,
        b"source" => Method::SOURCE,
        b"SUBSCRIBE" => Method::SUBSCRIBE,
        b"subscribe" => Method::SUBSCRIBE,
        b"TRACE" => Method::TRACE,
        b"trace" => Method::TRACE,
        b"UNBIND" => Method::UNBIND,
        b"unbind" => Method::UNBIND,
        b"UNLINK" => Method::UNLINK,
        b"unlink" => Method::UNLINK,
        b"UNLOCK" => Method::UNLOCK,
        b"unlock" => Method::UNLOCK,
        b"UNSUBSCRIBE" => Method::UNSUBSCRIBE,
        b"unsubscribe" => Method::UNSUBSCRIBE,
    };
}

impl Method {
    /// Uppercase HTTP method token. `M_SEARCH` renders as `"M-SEARCH"` (the
    /// wire form).
    pub const fn as_str(self) -> &'static str {
        match self {
            Method::ACL => "ACL",
            Method::BIND => "BIND",
            Method::CHECKOUT => "CHECKOUT",
            Method::CONNECT => "CONNECT",
            Method::COPY => "COPY",
            Method::DELETE => "DELETE",
            Method::GET => "GET",
            Method::HEAD => "HEAD",
            Method::LINK => "LINK",
            Method::LOCK => "LOCK",
            Method::M_SEARCH => "M-SEARCH",
            Method::MERGE => "MERGE",
            Method::MKACTIVITY => "MKACTIVITY",
            Method::MKADDRESSBOOK => "MKADDRESSBOOK",
            Method::MKCALENDAR => "MKCALENDAR",
            Method::MKCOL => "MKCOL",
            Method::MOVE => "MOVE",
            Method::NOTIFY => "NOTIFY",
            Method::OPTIONS => "OPTIONS",
            Method::PATCH => "PATCH",
            Method::POST => "POST",
            Method::PROPFIND => "PROPFIND",
            Method::PROPPATCH => "PROPPATCH",
            Method::PURGE => "PURGE",
            Method::PUT => "PUT",
            Method::QUERY => "QUERY",
            Method::REBIND => "REBIND",
            Method::REPORT => "REPORT",
            Method::SEARCH => "SEARCH",
            Method::SOURCE => "SOURCE",
            Method::SUBSCRIBE => "SUBSCRIBE",
            Method::TRACE => "TRACE",
            Method::UNBIND => "UNBIND",
            Method::UNLINK => "UNLINK",
            Method::UNLOCK => "UNLOCK",
            Method::UNSUBSCRIBE => "UNSUBSCRIBE",
        }
    }

    pub fn has_body(self) -> bool {
        !matches!(self, Method::HEAD | Method::TRACE)
    }

    /// RFC 9110: GET/HEAD have no defined body semantics; TRACE "MUST NOT
    /// send content" (§9.3.8). OPTIONS MAY include content (§9.3.7) so it is
    /// not excluded here; servers must read it and clients must frame it.
    pub fn has_request_body(self) -> bool {
        !matches!(self, Method::GET | Method::HEAD | Method::TRACE)
    }

    /// Per RFC 7231 §4.2.2, idempotent methods are safe to retry on
    /// keep-alive connection resets. POST and PATCH are NOT idempotent
    /// and must not be silently retried.
    pub fn is_idempotent(self) -> bool {
        matches!(
            self,
            Method::GET
                | Method::HEAD
                | Method::PUT
                | Method::DELETE
                | Method::OPTIONS
                | Method::TRACE
                | Method::QUERY
        )
    }

    #[inline]
    pub fn find(str: &[u8]) -> Option<Method> {
        Self::which(str)
    }

    /// Looks up the method in `METHOD_MAP` (length dispatch + constant-length
    /// word compares; no hashing — a `phf::Map` here cost a SipHash13 round per
    /// lookup, ≈ 0.6 % self-time in a Bun.serve hello-world profile, called
    /// twice per request).
    ///
    /// `#[inline]`: this lookup should be fully
    /// inlined into `NodeHTTPResponse.createForJS` (no separate symbol in the
    /// release binary). Without the hint LLVM keeps this as a ~600-byte
    /// out-of-line call because the full compare tree looks heavy, even though
    /// every per-request caller only ever exercises the len=3 `b"GET"` arm —
    /// trivially branch-predicted once the length dispatch is visible
    /// at the call site. Showed up as 8 self-time samples (0.09 %) in the
    /// `server/node-http` bench from the call alone.
    #[inline]
    pub fn which(str: &[u8]) -> Option<Method> {
        METHOD_MAP.get(str).copied()
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Request methods outside the table.
//
// `fetch`, `Request` and `server.fetch` take any RFC 9110 token as a method
// (<https://fetch.spec.whatwg.org/#methods>). `Method` stays the closed set
// that `Bun.serve` routes on. A token outside it is carried as bytes:
// `OwnedMethod` where JS holds it, `MethodRef` in the HTTP client.
// ═══════════════════════════════════════════════════════════════════════

/// RFC 9110 §5.6.2 `token`: one or more `tchar`.
pub fn is_token(bytes: &[u8]) -> bool {
    !bytes.is_empty()
        && bytes.iter().all(|&c| {
            c.is_ascii_alphanumeric()
                || matches!(
                    c,
                    b'!' | b'#'
                        | b'$'
                        | b'%'
                        | b'&'
                        | b'\''
                        | b'*'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
        })
}

/// What a method string that [`Method::which`] does not have names for
/// `fetch` and `Request`. See [`Method::classify_miss`].
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Classified {
    /// DELETE, GET, HEAD, OPTIONS, POST or PUT in mixed case.
    Known(Method),
    /// Any other token. It goes to the wire as written.
    Token,
    /// CONNECT, TRACE or TRACK. Fetch forbids these three in any case.
    Forbidden,
    /// Not a token, so not a method.
    Invalid,
}

impl Method {
    /// Reads a method string that [`which`] does not have, as `fetch` and
    /// `Request` take it: DELETE, GET, HEAD, OPTIONS, POST and PUT match in
    /// any case (<https://fetch.spec.whatwg.org/#concept-method-normalize>),
    /// and every other token is kept as written.
    ///
    /// A caller asks [`which`] first. Its hits keep their verb, so a request
    /// with a method of the table costs what it did before.
    ///
    /// [`which`]: Method::which
    #[cold]
    pub fn classify_miss(bytes: &[u8]) -> Classified {
        const NORMALIZED: [Method; 6] = [
            Method::DELETE,
            Method::GET,
            Method::HEAD,
            Method::OPTIONS,
            Method::POST,
            Method::PUT,
        ];
        for method in NORMALIZED {
            if bytes.eq_ignore_ascii_case(method.as_str().as_bytes()) {
                return Classified::Known(method);
            }
        }
        // <https://fetch.spec.whatwg.org/#forbidden-method>. The table holds
        // CONNECT and TRACE in two spellings, and those stay accepted.
        for forbidden in [&b"CONNECT"[..], b"TRACE", b"TRACK"] {
            if bytes.eq_ignore_ascii_case(forbidden) {
                return Classified::Forbidden;
            }
        }
        if is_token(bytes) {
            Classified::Token
        } else {
            Classified::Invalid
        }
    }
}

/// A request method as JS names it: a verb of the table, or any other token
/// kept as written. [`MethodRef`] is the `Copy` form the HTTP client holds.
#[derive(Clone)]
pub enum OwnedMethod {
    Known(Method),
    /// [`Method::classify_miss`] answered [`Classified::Token`] for these bytes.
    Token(Box<[u8]>),
}

impl From<Method> for OwnedMethod {
    #[inline]
    fn from(method: Method) -> Self {
        OwnedMethod::Known(method)
    }
}

impl OwnedMethod {
    /// The verb, or `None` for a token.
    #[inline]
    pub fn known(&self) -> Option<Method> {
        match self {
            OwnedMethod::Known(method) => Some(*method),
            OwnedMethod::Token(_) => None,
        }
    }

    /// The method as it goes to the wire.
    pub fn as_bytes(&self) -> &[u8] {
        match self {
            OwnedMethod::Known(method) => method.as_str().as_bytes(),
            OwnedMethod::Token(token) => token,
        }
    }

    /// This method for the HTTP client. A token is stored after the headers
    /// in `headers.buf`, the buffer the client resolves every `StringPointer`
    /// of the request against.
    #[inline]
    pub fn to_ref(&self, headers: &mut Headers) -> MethodRef {
        match self {
            OwnedMethod::Known(method) => MethodRef::Known(*method),
            OwnedMethod::Token(token) => MethodRef::Token(store_token(token, headers)),
        }
    }
}

#[cold]
fn store_token(token: &[u8], headers: &mut Headers) -> StringPointer {
    // `StringPointer`s index `buf`, so its length fits one, as in `Headers::append`.
    let offset = u32::try_from(headers.buf.len()).unwrap();
    headers.buf.extend_from_slice(token);
    StringPointer {
        offset,
        length: u32::try_from(token.len()).unwrap(),
    }
}

impl core::fmt::Display for OwnedMethod {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // A verb and a token are ASCII.
        f.write_str(core::str::from_utf8(self.as_bytes()).map_err(|_| core::fmt::Error)?)
    }
}

/// The method of an outgoing request, as the HTTP client holds it. `Copy`: a
/// method outside the table is a [`StringPointer`] into the request's header
/// buffer, which the header names and values already point into.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MethodRef {
    Known(Method),
    Token(StringPointer),
}

impl From<Method> for MethodRef {
    #[inline]
    fn from(method: Method) -> Self {
        MethodRef::Known(method)
    }
}

/// A token is never equal to a verb: the table lookup comes first.
impl PartialEq<Method> for MethodRef {
    #[inline]
    fn eq(&self, other: &Method) -> bool {
        matches!(*self, MethodRef::Known(method) if method == *other)
    }
}

impl MethodRef {
    /// The verb, or `None` for a token.
    #[inline]
    pub fn known(self) -> Option<Method> {
        match self {
            MethodRef::Known(method) => Some(method),
            MethodRef::Token(_) => None,
        }
    }

    /// The method as it goes to the wire. `header_buf` is the buffer that a
    /// token was stored in.
    #[inline]
    pub fn bytes(self, header_buf: &[u8]) -> &[u8] {
        match self {
            MethodRef::Known(method) => method.as_str().as_bytes(),
            MethodRef::Token(ptr) => &header_buf[ptr.offset as usize..][..ptr.length as usize],
        }
    }

    /// Whether `header_buf` holds this method. A verb needs no buffer.
    #[inline]
    pub fn is_in(self, header_buf: &[u8]) -> bool {
        match self {
            MethodRef::Known(_) => true,
            MethodRef::Token(ptr) => header_buf
                .get(ptr.offset as usize..)
                .and_then(|rest| rest.get(..ptr.length as usize))
                .is_some_and(is_token),
        }
    }

    /// Whether the response has a body. The table names the methods whose
    /// response has none.
    #[inline]
    pub fn has_body(self) -> bool {
        self.known().is_none_or(Method::has_body)
    }

    /// Whether a request of this method may carry a body. A token may.
    #[inline]
    pub fn has_request_body(self) -> bool {
        self.known().is_none_or(Method::has_request_body)
    }

    /// Whether a request that failed on a reused connection is sent again.
    /// Nothing says that a token is idempotent.
    #[inline]
    pub fn is_idempotent(self) -> bool {
        self.known().is_some_and(Method::is_idempotent)
    }
}

#[cfg(test)]
mod request_method_tests {
    use super::*;

    #[test]
    fn is_token_is_the_rfc_9110_tchar_set() {
        for c in 0..=u8::MAX {
            let expected = c.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&c);
            assert_eq!(is_token(&[c]), expected, "byte {c:#04x}");
            assert_eq!(is_token(&[b'A', c, b'Z']), expected, "byte {c:#04x} inside");
        }
        assert!(!is_token(b""));
    }

    /// The table lookup, then the rest: what the JS bridge does.
    fn classify(bytes: &[u8]) -> Classified {
        match Method::which(bytes) {
            Some(method) => Classified::Known(method),
            None => Method::classify_miss(bytes),
        }
    }

    #[test]
    fn classify_reads_a_method_as_fetch_does() {
        use Classified::{Forbidden, Invalid, Known, Token};
        for m in enumset::EnumSet::<Method>::all() {
            let upper = m.as_str();
            assert_eq!(classify(upper.as_bytes()), Known(m), "upper {upper}");
            let lower = upper.to_ascii_lowercase();
            assert_eq!(classify(lower.as_bytes()), Known(m), "lower {lower}");
        }
        for (input, expected) in [
            // Any case of the six that Fetch normalizes.
            (&b"Delete"[..], Known(Method::DELETE)),
            (b"gEt", Known(Method::GET)),
            (b"hEaD", Known(Method::HEAD)),
            (b"oPtIoNs", Known(Method::OPTIONS)),
            (b"pOsT", Known(Method::POST)),
            (b"Put", Known(Method::PUT)),
            // Every other token is kept as written, a mixed-case table verb too.
            (b"PatCh", Token),
            (b"Propfind", Token),
            (b"BREW", Token),
            (b"LIST", Token),
            (b"M-search", Token),
            (b"GETS", Token),
            (b"TRACKS", Token),
            (b"0", Token),
            // The three that Fetch forbids, in the spellings the table lacks.
            (b"Connect", Forbidden),
            (b"Trace", Forbidden),
            (b"TRACK", Forbidden),
            (b"track", Forbidden),
            (b"tRaCk", Forbidden),
            (b"", Invalid),
            (b"GET POST", Invalid),
            (b" GET", Invalid),
            (b"GET\r\n", Invalid),
            (b"G\0T", Invalid),
            (b"caf\xc3\xa9", Invalid),
            (b"(GET)", Invalid),
        ] {
            assert_eq!(classify(input), expected, "{:?}", bstr::BStr::new(input));
        }
    }

    #[test]
    fn owned_method_holds_a_verb_or_a_token() {
        // `Request` holds one of these: with it the struct is 112 bytes.
        assert_eq!(size_of::<OwnedMethod>(), 16);
        for m in enumset::EnumSet::<Method>::all() {
            let owned = OwnedMethod::from(m);
            assert_eq!(owned.known(), Some(m));
            assert_eq!(owned.as_bytes(), m.as_str().as_bytes());
            assert_eq!(owned.clone().known(), Some(m));
            let mut headers = Headers::default();
            assert_eq!(owned.to_ref(&mut headers), MethodRef::Known(m));
            assert!(headers.buf.is_empty());
        }
        let owned = OwnedMethod::Token(Box::from(&b"PatCh"[..]));
        assert_eq!(owned.known(), None);
        assert_eq!(owned.as_bytes(), b"PatCh");
        assert_eq!(owned.to_string(), "PatCh");
        assert_eq!(owned.clone().as_bytes(), b"PatCh");
    }

    #[test]
    fn method_ref_token_points_after_the_headers() {
        let mut headers = Headers::default();
        headers.append(b"Accept", b"*/*");
        let before = headers.buf.clone();

        let method = OwnedMethod::Token(Box::from(&b"BREW"[..])).to_ref(&mut headers);
        assert_eq!(
            method,
            MethodRef::Token(StringPointer {
                offset: before.len() as u32,
                length: 4
            })
        );
        assert_eq!(method.known(), None);
        assert_eq!(method.bytes(&headers.buf), b"BREW");
        assert!(method.is_in(&headers.buf));
        // The bytes of the headers do not move.
        assert_eq!(&headers.buf[..before.len()], &before[..]);
        assert_eq!(headers.get(b"accept"), Some(&b"*/*"[..]));

        // A pointer that is not for this buffer, or that does not name a token.
        assert!(!method.is_in(&before));
        let not_a_token = MethodRef::Token(StringPointer {
            offset: 0,
            length: before.len() as u32,
        });
        assert!(!not_a_token.is_in(&headers.buf));
        let overflows = MethodRef::Token(StringPointer {
            offset: u32::MAX,
            length: u32::MAX,
        });
        assert!(!overflows.is_in(&headers.buf));

        assert_eq!(MethodRef::from(Method::PUT).bytes(b""), b"PUT");
        assert!(MethodRef::from(Method::PUT).is_in(b""));
    }

    #[test]
    fn method_ref_treats_a_token_as_an_unknown_method() {
        let token = MethodRef::Token(StringPointer {
            offset: 0,
            length: 4,
        });
        // It may carry a body, its response has one, and it is not sent twice.
        assert!(token.has_request_body());
        assert!(token.has_body());
        assert!(!token.is_idempotent());
        for m in enumset::EnumSet::<Method>::all() {
            let known = MethodRef::from(m);
            assert_eq!(known.known(), Some(m));
            assert_eq!(known.has_request_body(), m.has_request_body(), "{m:?}");
            assert_eq!(known.has_body(), m.has_body(), "{m:?}");
            assert_eq!(known.is_idempotent(), m.is_idempotent(), "{m:?}");
            assert!(known == m);
            assert!(token != m);
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Optional {
    Any,
    Method(Set),
}

impl Optional {
    pub fn insert(&mut self, method: Method) {
        match self {
            Optional::Any => {}
            Optional::Method(set) => {
                set.insert(method);
                if *set == Set::all() {
                    *self = Optional::Any;
                }
            }
        }
    }
}

#[unsafe(no_mangle)]
/// # Safety
/// `str` must point to `len` initialised bytes for the duration of the call.
unsafe extern "C" fn Bun__HTTPMethod__from(str: *const u8, len: usize) -> i16 {
    // SAFETY: genuine FFI boundary — C++ caller passes a non-null, byte-aligned
    // pointer to `len` initialised bytes. The (ptr,len) pair cannot be a `&[u8]` across
    // the C ABI, so `from_raw_parts` is irreducible here; the borrow does not
    // outlive this stack frame.
    let slice = unsafe { core::slice::from_raw_parts(str, len) };
    let Some(method) = Method::find(slice) else {
        return -1;
    };
    method as i16
}

// ═══════════════════════════════════════════════════════════════════════
// HTTPHeaderName — moved from bun_runtime::webcore::FetchHeaders.
//
// `enum(u8)` discriminant crosses the FFI boundary to
// `WebCore__FetchHeaders__put`/`fastHas`/`fastGet` — order MUST match
// WebCore's `HTTPHeaderNames.in` exactly. The `fastGet`/`fastHas`/`put`
// methods that consume this enum stay on `FetchHeaders` (T6).
// ═══════════════════════════════════════════════════════════════════════

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum HeaderName {
    Accept,
    AcceptCharset,
    AcceptEncoding,
    AcceptLanguage,
    AcceptRanges,
    AccessControlAllowCredentials,
    AccessControlAllowHeaders,
    AccessControlAllowMethods,
    AccessControlAllowOrigin,
    AccessControlExposeHeaders,
    AccessControlMaxAge,
    AccessControlRequestHeaders,
    AccessControlRequestMethod,
    Age,
    Authorization,
    CacheControl,
    Connection,
    ContentDisposition,
    ContentEncoding,
    ContentLanguage,
    ContentLength,
    ContentLocation,
    ContentRange,
    ContentSecurityPolicy,
    ContentSecurityPolicyReportOnly,
    ContentType,
    Cookie,
    Cookie2,
    CrossOriginEmbedderPolicy,
    CrossOriginEmbedderPolicyReportOnly,
    CrossOriginOpenerPolicy,
    CrossOriginOpenerPolicyReportOnly,
    CrossOriginResourcePolicy,
    DNT,
    Date,
    DefaultStyle,
    ETag,
    Expect,
    Expires,
    Host,
    IcyMetaInt,
    IcyMetadata,
    IfMatch,
    IfModifiedSince,
    IfNoneMatch,
    IfRange,
    IfUnmodifiedSince,
    KeepAlive,
    LastEventID,
    LastModified,
    Link,
    Location,
    Origin,
    PingFrom,
    PingTo,
    Pragma,
    ProxyAuthorization,
    ProxyConnection,
    Purpose,
    Range,
    Referer,
    ReferrerPolicy,
    Refresh,
    ReportTo,
    SecFetchDest,
    SecFetchMode,
    SecWebSocketAccept,
    SecWebSocketExtensions,
    SecWebSocketKey,
    SecWebSocketProtocol,
    SecWebSocketVersion,
    ServerTiming,
    ServiceWorker,
    ServiceWorkerAllowed,
    ServiceWorkerNavigationPreload,
    SetCookie,
    SetCookie2,
    SourceMap,
    StrictTransportSecurity,
    TE,
    TimingAllowOrigin,
    Trailer,
    TransferEncoding,
    Upgrade,
    UpgradeInsecureRequests,
    UserAgent,
    Vary,
    Via,
    XContentTypeOptions,
    XDNSPrefetchControl,
    XFrameOptions,
    XSourceMap,
    XTempTablet,
    XXSSProtection,
}

#[cfg(test)]
mod tests {
    use super::Method;

    /// Exhaustive parity check for `Method::which`: every variant round-trips
    /// via its uppercase wire form and the all-lower convenience form, and
    /// nothing else slips through. Guards `METHOD_MAP` against transcription
    /// mistakes (a typo'd key or an entry mapped to the wrong variant still
    /// compiles).
    #[test]
    fn which_roundtrip() {
        for m in enumset::EnumSet::<Method>::all() {
            let upper = m.as_str();
            assert_eq!(Method::which(upper.as_bytes()), Some(m), "upper {upper}");
            let lower = upper.to_ascii_lowercase();
            assert_eq!(Method::which(lower.as_bytes()), Some(m), "lower {lower}");
        }
        // Mixed case must reject (only all-upper / all-lower are accepted).
        assert_eq!(Method::which(b"Get"), None);
        assert_eq!(Method::which(b"OPtions"), None);
        // Out-of-range lengths and unknown tokens.
        assert_eq!(Method::which(b""), None);
        assert_eq!(Method::which(b"GE"), None);
        assert_eq!(Method::which(b"GETS"), None);
        assert_eq!(Method::which(b"BREW"), None);
        assert_eq!(Method::which(b"MKADDRESSBOOKS"), None);
    }
}
