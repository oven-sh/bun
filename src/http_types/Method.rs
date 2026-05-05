use enumset::EnumSet;

#[allow(non_camel_case_types)]
#[repr(u8)]
#[derive(enumset::EnumSetType, Debug)]
// TODO(port): EnumSetType derive auto-impls Copy/Clone/Eq/PartialEq; verify it coexists with #[repr(u8)] (needed for FFI @intFromEnum)
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
    /// Zig: `@"M-SEARCH"`
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

// Zig: `pub const fromJS = Map.fromJS;` and `pub const toJS = @import("../http_jsc/method_jsc.zig").toJS;`
// Deleted per PORTING.md — to_js/from_js live as extension-trait methods in the `bun_http_jsc` crate.

pub type Set = EnumSet<Method>;

// TODO(port): verify EnumSet::all()/.remove() are usable in const context; if not, switch to `enum_set!(...)` complement or a once-init static.
const WITH_BODY: Set = {
    let mut values = Set::all();
    values.remove(Method::HEAD);
    values.remove(Method::TRACE);
    values
};

const WITH_REQUEST_BODY: Set = {
    let mut values = Set::all();
    values.remove(Method::GET);
    values.remove(Method::HEAD);
    values.remove(Method::OPTIONS);
    values.remove(Method::TRACE);
    values
};

impl Method {
    pub fn has_body(self) -> bool {
        WITH_BODY.contains(self)
    }

    pub fn has_request_body(self) -> bool {
        WITH_REQUEST_BODY.contains(self)
    }

    pub fn find(str: &[u8]) -> Option<Method> {
        MAP.get(str).copied()
    }

    pub fn which(str: &[u8]) -> Option<Method> {
        MAP.get(str).copied()
    }
}

static MAP: phf::Map<&'static [u8], Method> = phf::phf_map! {
    b"ACL" => Method::ACL,
    b"BIND" => Method::BIND,
    b"CHECKOUT" => Method::CHECKOUT,
    b"CONNECT" => Method::CONNECT,
    b"COPY" => Method::COPY,
    b"DELETE" => Method::DELETE,
    b"GET" => Method::GET,
    b"HEAD" => Method::HEAD,
    b"LINK" => Method::LINK,
    b"LOCK" => Method::LOCK,
    b"M-SEARCH" => Method::M_SEARCH,
    b"MERGE" => Method::MERGE,
    b"MKACTIVITY" => Method::MKACTIVITY,
    b"MKADDRESSBOOK" => Method::MKADDRESSBOOK,
    b"MKCALENDAR" => Method::MKCALENDAR,
    b"MKCOL" => Method::MKCOL,
    b"MOVE" => Method::MOVE,
    b"NOTIFY" => Method::NOTIFY,
    b"OPTIONS" => Method::OPTIONS,
    b"PATCH" => Method::PATCH,
    b"POST" => Method::POST,
    b"PROPFIND" => Method::PROPFIND,
    b"PROPPATCH" => Method::PROPPATCH,
    b"PURGE" => Method::PURGE,
    b"PUT" => Method::PUT,
    b"QUERY" => Method::QUERY,
    b"REBIND" => Method::REBIND,
    b"REPORT" => Method::REPORT,
    b"SEARCH" => Method::SEARCH,
    b"SOURCE" => Method::SOURCE,
    b"SUBSCRIBE" => Method::SUBSCRIBE,
    b"TRACE" => Method::TRACE,
    b"UNBIND" => Method::UNBIND,
    b"UNLINK" => Method::UNLINK,
    b"UNLOCK" => Method::UNLOCK,
    b"UNSUBSCRIBE" => Method::UNSUBSCRIBE,

    b"acl" => Method::ACL,
    b"bind" => Method::BIND,
    b"checkout" => Method::CHECKOUT,
    b"connect" => Method::CONNECT,
    b"copy" => Method::COPY,
    b"delete" => Method::DELETE,
    b"get" => Method::GET,
    b"head" => Method::HEAD,
    b"link" => Method::LINK,
    b"lock" => Method::LOCK,
    b"m-search" => Method::M_SEARCH,
    b"merge" => Method::MERGE,
    b"mkactivity" => Method::MKACTIVITY,
    b"mkaddressbook" => Method::MKADDRESSBOOK,
    b"mkcalendar" => Method::MKCALENDAR,
    b"mkcol" => Method::MKCOL,
    b"move" => Method::MOVE,
    b"notify" => Method::NOTIFY,
    b"options" => Method::OPTIONS,
    b"patch" => Method::PATCH,
    b"post" => Method::POST,
    b"propfind" => Method::PROPFIND,
    b"proppatch" => Method::PROPPATCH,
    b"purge" => Method::PURGE,
    b"put" => Method::PUT,
    b"query" => Method::QUERY,
    b"rebind" => Method::REBIND,
    b"report" => Method::REPORT,
    b"search" => Method::SEARCH,
    b"source" => Method::SOURCE,
    b"subscribe" => Method::SUBSCRIBE,
    b"trace" => Method::TRACE,
    b"unbind" => Method::UNBIND,
    b"unlink" => Method::UNLINK,
    b"unlock" => Method::UNLOCK,
    b"unsubscribe" => Method::UNSUBSCRIBE,
};

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

        let Optional::Method(this_set) = self else { unreachable!() };
        let Optional::Method(other_set) = other else { unreachable!() };
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
pub extern "C" fn Bun__HTTPMethod__from(str: *const u8, len: usize) -> i16 {
    // SAFETY: caller (C++) guarantees `str` points to `len` valid bytes.
    let slice = unsafe { core::slice::from_raw_parts(str, len) };
    let Some(method) = Method::find(slice) else { return -1 };
    method as i16
}

// Zig `comptime { _ = Bun__HTTPMethod__from; }` force-reference dropped — Rust links what's `pub`.

// ═══════════════════════════════════════════════════════════════════════
// TYPE_ONLY: bun_runtime::webcore::FetchHeaders::HTTPHeaderName → http_types
// (CYCLEBREAK.md §→http_types, requested by `http`)
// Source: src/jsc/FetchHeaders.zig
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_types/Method.zig (192 lines)
//   confidence: medium
//   todos:      2
//   notes:      EnumSetType vs #[repr(u8)] interaction + const-eval of Set::all()/.remove() need Phase-B verification; from_js/to_js moved to bun_http_jsc extension trait.
// ──────────────────────────────────────────────────────────────────────────
