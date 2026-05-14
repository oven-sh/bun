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

// PORT NOTE: Zig's private `with_body`/`with_request_body` EnumSet consts are
// folded directly into `has_body()`/`has_request_body()` as `matches!` —
// `EnumSet::remove` is not const on stable, and the consts were never read
// outside those two predicates.

impl Method {
    /// Port of Zig `@tagName(method)` — uppercase HTTP method token. `M_SEARCH`
    /// renders as `"M-SEARCH"` (the wire form, matching the Zig enum name
    /// `@"M-SEARCH"`).
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

    /// Port of Zig `bun.ComptimeStringMap(Method, …).get`: length-gated, then a
    /// flat byte-pattern match on the entries of that exact length. Zig builds
    /// the dispatch at `comptime`; the previous Rust port used a `phf::Map`,
    /// which costs a SipHash13 round per lookup (`phf_shared::hash` ≈ 0.6 %
    /// self-time in a Bun.serve hello-world profile, called twice per request).
    /// The wire form is RFC 9110 case-sensitive uppercase, so the per-request
    /// hot path takes the upper arm; the all-lower entries exist only for
    /// `new Request("get", …)` JS-side convenience and match the Zig table
    /// exactly (mixed-case still rejects).
    ///
    /// `#[inline]`: the Zig `ComptimeStringMapWithKeyType` lookup is fully
    /// inlined into `NodeHTTPResponse.createForJS` (no separate symbol in the
    /// release binary). Without the hint LLVM keeps this as a ~600-byte
    /// out-of-line call because the full match tree looks heavy, even though
    /// every per-request caller only ever exercises the len=3 `b"GET"` arm —
    /// trivially branch-predicted once the outer `match str.len()` is visible
    /// at the call site. Showed up as 8 self-time samples (0.09 %) in the
    /// `server/node-http` bench from the call alone.
    #[inline]
    pub fn which(str: &[u8]) -> Option<Method> {
        use Method::*;
        Some(match str.len() {
            3 => match str {
                b"GET" | b"get" => GET,
                b"PUT" | b"put" => PUT,
                b"ACL" | b"acl" => ACL,
                _ => return None,
            },
            4 => match str {
                b"POST" | b"post" => POST,
                b"HEAD" | b"head" => HEAD,
                b"BIND" | b"bind" => BIND,
                b"COPY" | b"copy" => COPY,
                b"LINK" | b"link" => LINK,
                b"LOCK" | b"lock" => LOCK,
                b"MOVE" | b"move" => MOVE,
                _ => return None,
            },
            5 => match str {
                b"PATCH" | b"patch" => PATCH,
                b"TRACE" | b"trace" => TRACE,
                b"QUERY" | b"query" => QUERY,
                b"MERGE" | b"merge" => MERGE,
                b"MKCOL" | b"mkcol" => MKCOL,
                b"PURGE" | b"purge" => PURGE,
                _ => return None,
            },
            6 => match str {
                b"DELETE" | b"delete" => DELETE,
                b"NOTIFY" | b"notify" => NOTIFY,
                b"REBIND" | b"rebind" => REBIND,
                b"REPORT" | b"report" => REPORT,
                b"SEARCH" | b"search" => SEARCH,
                b"SOURCE" | b"source" => SOURCE,
                b"UNBIND" | b"unbind" => UNBIND,
                b"UNLINK" | b"unlink" => UNLINK,
                b"UNLOCK" | b"unlock" => UNLOCK,
                _ => return None,
            },
            7 => match str {
                b"OPTIONS" | b"options" => OPTIONS,
                b"CONNECT" | b"connect" => CONNECT,
                _ => return None,
            },
            8 => match str {
                b"CHECKOUT" | b"checkout" => CHECKOUT,
                b"M-SEARCH" | b"m-search" => M_SEARCH,
                b"PROPFIND" | b"propfind" => PROPFIND,
                _ => return None,
            },
            9 => match str {
                b"PROPPATCH" | b"proppatch" => PROPPATCH,
                b"SUBSCRIBE" | b"subscribe" => SUBSCRIBE,
                _ => return None,
            },
            10 => match str {
                b"MKACTIVITY" | b"mkactivity" => MKACTIVITY,
                b"MKCALENDAR" | b"mkcalendar" => MKCALENDAR,
                _ => return None,
            },
            11 => match str {
                b"UNSUBSCRIBE" | b"unsubscribe" => UNSUBSCRIBE,
                _ => return None,
            },
            13 => match str {
                b"MKADDRESSBOOK" | b"mkaddressbook" => MKADDRESSBOOK,
                _ => return None,
            },
            _ => return None,
        })
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
pub extern "C" fn Bun__HTTPMethod__from(str: *const u8, len: usize) -> i16 {
    // SAFETY: genuine FFI boundary — C++ caller passes a non-null, byte-aligned
    // pointer to `len` initialised bytes (Zig signature `[*]const u8`, which is
    // non-null by construction). The (ptr,len) pair cannot be a `&[u8]` across
    // the C ABI, so `from_raw_parts` is irreducible here; the borrow does not
    // outlive this stack frame.
    let slice = unsafe { core::slice::from_raw_parts(str, len) };
    let Some(method) = Method::find(slice) else {
        return -1;
    };
    method as i16
}

// Zig `comptime { _ = Bun__HTTPMethod__from; }` force-reference dropped — Rust links what's `pub`.

// ═══════════════════════════════════════════════════════════════════════
// HTTPHeaderName — moved from bun_runtime::webcore::FetchHeaders.
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

// ported from: src/http_types/Method.zig

#[cfg(test)]
mod tests {
    use super::Method;

    /// Exhaustive parity check for `Method::which`: every variant round-trips
    /// via its uppercase wire form and the all-lower convenience form, and
    /// nothing else slips through. Guards the length-gated match against
    /// transcription mistakes (the previous `phf::Map` build would have
    /// rejected typos at compile time; the open-coded match does not).
    #[test]
    fn which_roundtrip() {
        for m in enumset::EnumSet::<Method>::all() {
            let upper = m.as_str();
            assert_eq!(Method::which(upper.as_bytes()), Some(m), "upper {upper}");
            let lower = upper.to_ascii_lowercase();
            assert_eq!(Method::which(lower.as_bytes()), Some(m), "lower {lower}");
        }
        // Mixed case must reject (Zig table has only all-upper / all-lower).
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
