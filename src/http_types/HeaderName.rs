//! WebCore's `HTTPHeaderName`: the well-known field names `FetchHeaders`
//! stores by enum rather than by string.
//!
//! The `u8` discriminant crosses FFI to `WebCore__FetchHeaders__put` /
//! `fastGet` / `fastHas` and to `PicoHTTPHeader.name_id`, so the order MUST
//! match `src/jsc/bindings/webcore/HTTPHeaderNames.in` exactly.

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

impl HeaderName {
    pub const COUNT: usize = Self::NAMES.len();

    #[inline]
    pub const fn as_str(self) -> &'static str {
        Self::NAMES[self as usize]
    }

    #[inline]
    pub const fn from_index(index: u8) -> Option<Self> {
        if (index as usize) < Self::COUNT {
            // SAFETY: `#[repr(u8)]` with contiguous discriminants `0..COUNT`.
            Some(unsafe { core::mem::transmute::<u8, Self>(index) })
        } else {
            None
        }
    }

    /// Case-insensitive lookup of a wire field name. Generated from
    /// `HTTPHeaderNames.in` (bucket by length, branch on one distinguishing
    /// byte, then a single case-insensitive compare).
    pub const fn classify(name: &[u8]) -> Option<Self> {
        let (variant, expect): (Self, &[u8]) = match name.len() {
            2 => (Self::TE, b"te"),
            3 => match name[0] | 0x20 {
                b'a' => (Self::Age, b"age"),
                b'd' => (Self::DNT, b"dnt"),
                b'v' => (Self::Via, b"via"),
                _ => return None,
            },
            4 => match name[0] | 0x20 {
                b'd' => (Self::Date, b"date"),
                b'e' => (Self::ETag, b"etag"),
                b'h' => (Self::Host, b"host"),
                b'l' => (Self::Link, b"link"),
                b'v' => (Self::Vary, b"vary"),
                _ => return None,
            },
            5 => (Self::Range, b"range"),
            6 => match name[0] | 0x20 {
                b'a' => (Self::Accept, b"accept"),
                b'c' => (Self::Cookie, b"cookie"),
                b'e' => (Self::Expect, b"expect"),
                b'o' => (Self::Origin, b"origin"),
                b'p' => (Self::Pragma, b"pragma"),
                _ => return None,
            },
            7 => match name[1] | 0x20 {
                b'e' => match name[3] | 0x20 {
                    b'e' => (Self::Referer, b"referer"),
                    b'r' => (Self::Refresh, b"refresh"),
                    _ => return None,
                },
                b'i' => (Self::PingTo, b"ping-to"),
                b'o' => (Self::Cookie2, b"cookie2"),
                b'p' => (Self::Upgrade, b"upgrade"),
                b'r' => (Self::Trailer, b"trailer"),
                b'u' => (Self::Purpose, b"purpose"),
                b'x' => (Self::Expires, b"expires"),
                _ => return None,
            },
            8 => match name[3] | 0x20 {
                b'a' => (Self::Location, b"location"),
                b'm' => (Self::IfMatch, b"if-match"),
                b'r' => (Self::IfRange, b"if-range"),
                _ => return None,
            },
            9 => match name[0] | 0x20 {
                b'p' => (Self::PingFrom, b"ping-from"),
                b'r' => (Self::ReportTo, b"report-to"),
                b's' => (Self::SourceMap, b"sourcemap"),
                _ => return None,
            },
            10 => match name[0] | 0x20 {
                b'c' => (Self::Connection, b"connection"),
                b'k' => (Self::KeepAlive, b"keep-alive"),
                b's' => (Self::SetCookie, b"set-cookie"),
                b'u' => (Self::UserAgent, b"user-agent"),
                _ => return None,
            },
            11 => match name[0] | 0x20 {
                b'i' => (Self::IcyMetaInt, b"icy-metaint"),
                b's' => (Self::SetCookie2, b"set-cookie2"),
                b'x' => (Self::XSourceMap, b"x-sourcemap"),
                _ => return None,
            },
            12 => match name[0] | 0x20 {
                b'c' => (Self::ContentType, b"content-type"),
                b'i' => (Self::IcyMetadata, b"icy-metadata"),
                _ => return None,
            },
            13 => match name[5] | 0x20 {
                b'-' => (Self::CacheControl, b"cache-control"),
                b'e' => (Self::LastEventID, b"last-event-id"),
                b'l' => (Self::DefaultStyle, b"default-style"),
                b'm' => (Self::LastModified, b"last-modified"),
                b'n' => match name[0] | 0x20 {
                    b'c' => (Self::ContentRange, b"content-range"),
                    b'i' => (Self::IfNoneMatch, b"if-none-match"),
                    _ => return None,
                },
                b'p' => (Self::XTempTablet, b"x-temp-tablet"),
                b'r' => match name[0] | 0x20 {
                    b'a' => (Self::Authorization, b"authorization"),
                    b's' => (Self::ServerTiming, b"server-timing"),
                    _ => return None,
                },
                b't' => (Self::AcceptRanges, b"accept-ranges"),
                _ => return None,
            },
            14 => match name[11] | 0x20 {
                b'e' => (Self::SecFetchDest, b"sec-fetch-dest"),
                b'g' => (Self::ContentLength, b"content-length"),
                b'k' => (Self::ServiceWorker, b"service-worker"),
                b'o' => (Self::SecFetchMode, b"sec-fetch-mode"),
                b's' => (Self::AcceptCharset, b"accept-charset"),
                _ => return None,
            },
            15 => match name[7] | 0x20 {
                b'-' => (Self::XFrameOptions, b"x-frame-options"),
                b'e' => (Self::AcceptEncoding, b"accept-encoding"),
                b'l' => (Self::AcceptLanguage, b"accept-language"),
                b'r' => (Self::ReferrerPolicy, b"referrer-policy"),
                _ => return None,
            },
            16 => match name[8] | 0x20 {
                b'e' => (Self::ContentEncoding, b"content-encoding"),
                b'l' => match name[9] | 0x20 {
                    b'a' => (Self::ContentLanguage, b"content-language"),
                    b'o' => (Self::ContentLocation, b"content-location"),
                    _ => return None,
                },
                b'n' => (Self::ProxyConnection, b"proxy-connection"),
                b'o' => (Self::XXSSProtection, b"x-xss-protection"),
                _ => return None,
            },
            17 => match name[0] | 0x20 {
                b'i' => (Self::IfModifiedSince, b"if-modified-since"),
                b's' => (Self::SecWebSocketKey, b"sec-websocket-key"),
                b't' => (Self::TransferEncoding, b"transfer-encoding"),
                _ => return None,
            },
            19 => match name[0] | 0x20 {
                b'c' => (Self::ContentDisposition, b"content-disposition"),
                b'i' => (Self::IfUnmodifiedSince, b"if-unmodified-since"),
                b'p' => (Self::ProxyAuthorization, b"proxy-authorization"),
                b't' => (Self::TimingAllowOrigin, b"timing-allow-origin"),
                _ => return None,
            },
            20 => (Self::SecWebSocketAccept, b"sec-websocket-accept"),
            21 => (Self::SecWebSocketVersion, b"sec-websocket-version"),
            22 => match name[3] | 0x20 {
                b'-' => (Self::SecWebSocketProtocol, b"sec-websocket-protocol"),
                b'e' => (Self::AccessControlMaxAge, b"access-control-max-age"),
                b'n' => (Self::XDNSPrefetchControl, b"x-dns-prefetch-control"),
                b'o' => (Self::XContentTypeOptions, b"x-content-type-options"),
                b'v' => (Self::ServiceWorkerAllowed, b"service-worker-allowed"),
                _ => return None,
            },
            23 => (Self::ContentSecurityPolicy, b"content-security-policy"),
            24 => (Self::SecWebSocketExtensions, b"sec-websocket-extensions"),
            25 => match name[0] | 0x20 {
                b's' => (Self::StrictTransportSecurity, b"strict-transport-security"),
                b'u' => (Self::UpgradeInsecureRequests, b"upgrade-insecure-requests"),
                _ => return None,
            },
            26 => (Self::CrossOriginOpenerPolicy, b"cross-origin-opener-policy"),
            27 => (
                Self::AccessControlAllowOrigin,
                b"access-control-allow-origin",
            ),
            28 => match name[13] | 0x20 {
                b'e' => (
                    Self::CrossOriginEmbedderPolicy,
                    b"cross-origin-embedder-policy",
                ),
                b'l' => match name[21] | 0x20 {
                    b'h' => (
                        Self::AccessControlAllowHeaders,
                        b"access-control-allow-headers",
                    ),
                    b'm' => (
                        Self::AccessControlAllowMethods,
                        b"access-control-allow-methods",
                    ),
                    _ => return None,
                },
                b'r' => (
                    Self::CrossOriginResourcePolicy,
                    b"cross-origin-resource-policy",
                ),
                _ => return None,
            },
            29 => match name[15] | 0x20 {
                b'e' => (
                    Self::AccessControlExposeHeaders,
                    b"access-control-expose-headers",
                ),
                b'r' => (
                    Self::AccessControlRequestMethod,
                    b"access-control-request-method",
                ),
                _ => return None,
            },
            30 => (
                Self::AccessControlRequestHeaders,
                b"access-control-request-headers",
            ),
            32 => (
                Self::AccessControlAllowCredentials,
                b"access-control-allow-credentials",
            ),
            33 => (
                Self::ServiceWorkerNavigationPreload,
                b"service-worker-navigation-preload",
            ),
            35 => (
                Self::ContentSecurityPolicyReportOnly,
                b"content-security-policy-report-only",
            ),
            38 => (
                Self::CrossOriginOpenerPolicyReportOnly,
                b"cross-origin-opener-policy-report-only",
            ),
            40 => (
                Self::CrossOriginEmbedderPolicyReportOnly,
                b"cross-origin-embedder-policy-report-only",
            ),
            _ => return None,
        };
        if eq_ignore_ascii_case_lower(name, expect) {
            Some(variant)
        } else {
            None
        }
    }

    /// Canonical spelling, indexed by discriminant (matches WebCore `headerNameStrings`).
    pub const NAMES: [&'static str; 94] = [
        "Accept",
        "Accept-Charset",
        "Accept-Encoding",
        "Accept-Language",
        "Accept-Ranges",
        "Access-Control-Allow-Credentials",
        "Access-Control-Allow-Headers",
        "Access-Control-Allow-Methods",
        "Access-Control-Allow-Origin",
        "Access-Control-Expose-Headers",
        "Access-Control-Max-Age",
        "Access-Control-Request-Headers",
        "Access-Control-Request-Method",
        "Age",
        "Authorization",
        "Cache-Control",
        "Connection",
        "Content-Disposition",
        "Content-Encoding",
        "Content-Language",
        "Content-Length",
        "Content-Location",
        "Content-Range",
        "Content-Security-Policy",
        "Content-Security-Policy-Report-Only",
        "Content-Type",
        "Cookie",
        "Cookie2",
        "Cross-Origin-Embedder-Policy",
        "Cross-Origin-Embedder-Policy-Report-Only",
        "Cross-Origin-Opener-Policy",
        "Cross-Origin-Opener-Policy-Report-Only",
        "Cross-Origin-Resource-Policy",
        "DNT",
        "Date",
        "Default-Style",
        "ETag",
        "Expect",
        "Expires",
        "Host",
        "Icy-MetaInt",
        "Icy-Metadata",
        "If-Match",
        "If-Modified-Since",
        "If-None-Match",
        "If-Range",
        "If-Unmodified-Since",
        "Keep-Alive",
        "Last-Event-ID",
        "Last-Modified",
        "Link",
        "Location",
        "Origin",
        "Ping-From",
        "Ping-To",
        "Pragma",
        "Proxy-Authorization",
        "Proxy-Connection",
        "Purpose",
        "Range",
        "Referer",
        "Referrer-Policy",
        "Refresh",
        "Report-To",
        "Sec-Fetch-Dest",
        "Sec-Fetch-Mode",
        "Sec-WebSocket-Accept",
        "Sec-WebSocket-Extensions",
        "Sec-WebSocket-Key",
        "Sec-WebSocket-Protocol",
        "Sec-WebSocket-Version",
        "Server-Timing",
        "Service-Worker",
        "Service-Worker-Allowed",
        "Service-Worker-Navigation-Preload",
        "Set-Cookie",
        "Set-Cookie2",
        "SourceMap",
        "Strict-Transport-Security",
        "TE",
        "Timing-Allow-Origin",
        "Trailer",
        "Transfer-Encoding",
        "Upgrade",
        "Upgrade-Insecure-Requests",
        "User-Agent",
        "Vary",
        "Via",
        "X-Content-Type-Options",
        "X-DNS-Prefetch-Control",
        "X-Frame-Options",
        "X-SourceMap",
        "X-Temp-Tablet",
        "X-XSS-Protection",
    ];
}

// `from_index` transmutes anything below `COUNT`.
const _: () = assert!(HeaderName::COUNT == HeaderName::XXSSProtection as usize + 1);

/// `a` compared ASCII-case-insensitively against already-lowercase `lower`.
const fn eq_ignore_ascii_case_lower(a: &[u8], lower: &[u8]) -> bool {
    if a.len() != lower.len() {
        return false;
    }
    let mut i = 0;
    while i < a.len() {
        if a[i].to_ascii_lowercase() != lower[i] {
            return false;
        }
        i += 1;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::HeaderName;

    #[test]
    fn classify_round_trips_every_name() {
        for i in 0..HeaderName::COUNT as u8 {
            let name = HeaderName::from_index(i).unwrap();
            assert_eq!(name as u8, i);
            let s = name.as_str();
            assert_eq!(HeaderName::classify(s.as_bytes()), Some(name), "{s}");
            assert_eq!(
                HeaderName::classify(s.to_ascii_lowercase().as_bytes()),
                Some(name),
                "{s}"
            );
            assert_eq!(
                HeaderName::classify(s.to_ascii_uppercase().as_bytes()),
                Some(name),
                "{s}"
            );
            // One byte off in either direction is a different (or no) name.
            let mut longer = s.as_bytes().to_vec();
            longer.push(b'x');
            assert_ne!(HeaderName::classify(&longer), Some(name), "{s}");
            assert_ne!(
                HeaderName::classify(&s.as_bytes()[..s.len() - 1]),
                Some(name),
                "{s}"
            );
            // Flipping any single byte to '_' misses.
            for j in 0..s.len() {
                let mut m = s.as_bytes().to_vec();
                m[j] = b'_';
                assert_eq!(HeaderName::classify(&m), None, "{s} @{j}");
            }
        }
        assert_eq!(HeaderName::from_index(HeaderName::COUNT as u8), None);
    }

    #[test]
    fn classify_rejects_near_misses() {
        for name in [
            &b""[..],
            b"x",
            b"Server",
            b"Alt-Svc",
            b"Content_Type",
            b"Content-Typ",
            b"Content-Types",
            b"X-Request-Id",
            b"Sec-WebSocket-Kez",
            b"

",
            b"t\xc5", // 0xC5 | 0x20 == 'e'
        ] {
            assert_eq!(
                HeaderName::classify(name),
                None,
                "{:?}",
                bstr::BStr::new(name)
            );
        }
    }

    #[test]
    fn discriminants_match_webcore_order() {
        // Spot-check anchors of the WebCore enum; a reordering in
        // HTTPHeaderNames.in must be mirrored here and in C++ together.
        assert_eq!(HeaderName::Accept as u8, 0);
        assert_eq!(HeaderName::ContentType as u8, 25);
        assert_eq!(HeaderName::SetCookie as u8, 75);
        assert_eq!(HeaderName::XXSSProtection as u8, 93);
        assert_eq!(HeaderName::COUNT, 94);
    }
}
