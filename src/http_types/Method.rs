use enumset::EnumSet;

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
    /// hot path hits the uppercase entries; the all-lower entries exist because
    /// uWS lower-cases the request line's method in place before `Bun.serve`
    /// looks it up. Lookup is exact-byte, so mixed case misses — JS-facing entry
    /// points go through [`Method::normalize`] / [`MethodBuf`] instead.
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

    pub fn has_request_body(self) -> bool {
        !matches!(
            self,
            Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE
        )
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

    /// `tchar` per RFC 9110 §5.6.2.
    const fn is_token_char(byte: u8) -> bool {
        matches!(byte,
            b'!' | b'#' | b'$' | b'%' | b'&' | b'\'' | b'*' | b'+' | b'-' | b'.'
            | b'^' | b'_' | b'`' | b'|' | b'~'
            | b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z')
    }

    /// A `method` per <https://fetch.spec.whatwg.org/#concept-method>: a
    /// non-empty RFC 9110 token.
    pub fn is_token(str: &[u8]) -> bool {
        !str.is_empty() && str.iter().copied().all(Method::is_token_char)
    }

    /// <https://fetch.spec.whatwg.org/#forbidden-method>
    pub fn is_forbidden(str: &[u8]) -> bool {
        [&b"CONNECT"[..], b"TRACE", b"TRACK"]
            .iter()
            .any(|forbidden| str.eq_ignore_ascii_case(forbidden))
    }

    /// <https://fetch.spec.whatwg.org/#concept-method-normalize>: only these
    /// six verbs are case-normalized; every other token is forwarded as given.
    pub fn normalize(str: &[u8]) -> Option<Method> {
        const NORMALIZED: [Method; 6] = [
            Method::DELETE,
            Method::GET,
            Method::HEAD,
            Method::OPTIONS,
            Method::POST,
            Method::PUT,
        ];
        NORMALIZED
            .into_iter()
            .find(|method| str.eq_ignore_ascii_case(method.as_str().as_bytes()))
    }
}

/// The method a request is sent with: a well-known verb, or a custom RFC 9110
/// token forwarded to the server byte-for-byte.
///
/// `Copy`, so `HTTPClient`/`AsyncHTTP` keep their bitwise-copy semantics; the
/// `Custom` token borrows storage owned by whoever built the request (a
/// `FetchTasklet`, for fetch).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum MethodRef<'a> {
    Known(Method),
    Custom(&'a [u8]),
}

impl<'a> MethodRef<'a> {
    /// The wire form of the method.
    pub fn as_bytes(self) -> &'a [u8] {
        match self {
            MethodRef::Known(method) => method.as_str().as_bytes(),
            MethodRef::Custom(token) => token,
        }
    }

    /// The wire form of the method. A `Custom` token is an RFC 9110 token, so
    /// it is always ASCII; a non-UTF-8 one renders as empty rather than panic.
    pub fn as_str(self) -> &'a str {
        match self {
            MethodRef::Known(method) => method.as_str(),
            MethodRef::Custom(token) => core::str::from_utf8(token).unwrap_or_default(),
        }
    }

    pub fn known(self) -> Option<Method> {
        match self {
            MethodRef::Known(method) => Some(method),
            MethodRef::Custom(_) => None,
        }
    }

    /// True when this is exactly `method`. A `Custom` token never compares
    /// equal to a known verb, which is what makes the redirect and
    /// body-allowed rules below treat custom verbs conservatively.
    pub fn is(self, method: Method) -> bool {
        self == MethodRef::Known(method)
    }

    /// Custom verbs are assumed to carry a body: the set of bodyless methods is
    /// closed (RFC 9110 §9.3) and an unknown verb is not in it.
    pub fn has_request_body(self) -> bool {
        match self {
            MethodRef::Known(method) => method.has_request_body(),
            MethodRef::Custom(_) => true,
        }
    }

    /// Whether a response to this method may carry a body.
    pub fn has_body(self) -> bool {
        match self {
            MethodRef::Known(method) => method.has_body(),
            MethodRef::Custom(_) => true,
        }
    }

    /// Custom verbs are never assumed idempotent, so they are not retried.
    pub fn is_idempotent(self) -> bool {
        match self {
            MethodRef::Known(method) => method.is_idempotent(),
            MethodRef::Custom(_) => false,
        }
    }
}

impl From<Method> for MethodRef<'_> {
    fn from(method: Method) -> Self {
        MethodRef::Known(method)
    }
}

/// Owning counterpart of [`MethodRef`], for the JS-side `Request`/`fetch`
/// objects that must keep a custom token alive.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MethodBuf {
    Known(Method),
    Custom(Box<[u8]>),
}

impl MethodBuf {
    pub fn as_ref(&self) -> MethodRef<'_> {
        match self {
            MethodBuf::Known(method) => MethodRef::Known(*method),
            MethodBuf::Custom(token) => MethodRef::Custom(token),
        }
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.as_ref().as_bytes()
    }

    pub fn known(&self) -> Option<Method> {
        self.as_ref().known()
    }

    pub fn is(&self, method: Method) -> bool {
        self.as_ref().is(method)
    }

    pub fn has_request_body(&self) -> bool {
        self.as_ref().has_request_body()
    }
}

impl Default for MethodBuf {
    fn default() -> Self {
        MethodBuf::Known(Method::GET)
    }
}

impl From<Method> for MethodBuf {
    fn from(method: Method) -> Self {
        MethodBuf::Known(method)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Optional {
    Any,
    Method(Set),
}

impl Optional {
    pub fn contains(&self, other: &Optional) -> bool {
        if matches!(self, Optional::Any) {
            return true;
        }
        if matches!(other, Optional::Any) {
            return true;
        }

        let Optional::Method(this_set) = self else {
            unreachable!()
        };
        let Optional::Method(other_set) = other else {
            unreachable!()
        };
        this_set.intersection(*other_set).len() > 0
    }

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
pub(crate) unsafe extern "C" fn Bun__HTTPMethod__from(str: *const u8, len: usize) -> i16 {
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
    use super::{Method, MethodBuf, MethodRef};

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

    #[test]
    fn normalize_only_the_six() {
        for (input, expected) in [
            (&b"delete"[..], Method::DELETE),
            (b"Get", Method::GET),
            (b"hEaD", Method::HEAD),
            (b"OPTIONS", Method::OPTIONS),
            (b"post", Method::POST),
            (b"Put", Method::PUT),
        ] {
            assert_eq!(Method::normalize(input), Some(expected), "{input:?}");
        }
        // Everything else is forwarded as-is, including verbs the table knows.
        for input in [&b"patch"[..], b"PATCH", b"Propfind", b"QUERY", b"BREW", b""] {
            assert_eq!(Method::normalize(input), None, "{input:?}");
        }
    }

    #[test]
    fn tokens_and_forbidden_methods() {
        for input in [&b"GET"[..], b"BREW", b"X-Custom_1", b"a!#$%&'*+-.^_`|~0"] {
            assert!(Method::is_token(input), "{input:?}");
        }
        for input in [&b""[..], b"GET POST", b"GET\r\n", b"GET/1", b"\x80"] {
            assert!(!Method::is_token(input), "{input:?}");
        }
        for input in [&b"CONNECT"[..], b"trace", b"TrAcK"] {
            assert!(Method::is_forbidden(input), "{input:?}");
        }
        for input in [&b"GET"[..], b"TRACER", b"CONNEC"] {
            assert!(!Method::is_forbidden(input), "{input:?}");
        }
    }

    #[test]
    fn custom_methods_carry_a_body_and_are_not_idempotent() {
        let custom = MethodRef::Custom(b"BREW");
        assert_eq!(custom.as_bytes(), b"BREW");
        assert!(custom.has_request_body());
        assert!(!custom.is_idempotent());
        assert!(!custom.is(Method::GET));
        assert_eq!(custom.known(), None);

        let known = MethodRef::Known(Method::GET);
        assert_eq!(known.as_bytes(), b"GET");
        assert!(!known.has_request_body());
        assert!(known.is_idempotent());
        assert!(known.is(Method::GET));

        assert_eq!(MethodBuf::default().as_bytes(), b"GET");
        assert_eq!(
            MethodBuf::Custom(Box::from(&b"pAtCh"[..])).as_bytes(),
            b"pAtCh"
        );
    }
}
