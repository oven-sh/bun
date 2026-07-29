/// https://developer.mozilla.org/en-US/docs/Web/API/Request/referrerPolicy
/// https://w3c.github.io/webappsec-referrer-policy/#referrer-policy
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default, strum::IntoStaticStr)]
pub enum ReferrerPolicy {
    /// The empty string: defer to the environment's default policy, which for
    /// `fetch()` is `strict-origin-when-cross-origin`.
    #[default]
    #[strum(serialize = "")]
    Empty,
    #[strum(serialize = "no-referrer")]
    NoReferrer,
    #[strum(serialize = "no-referrer-when-downgrade")]
    NoReferrerWhenDowngrade,
    #[strum(serialize = "same-origin")]
    SameOrigin,
    #[strum(serialize = "origin")]
    Origin,
    #[strum(serialize = "strict-origin")]
    StrictOrigin,
    #[strum(serialize = "origin-when-cross-origin")]
    OriginWhenCrossOrigin,
    #[strum(serialize = "strict-origin-when-cross-origin")]
    StrictOriginWhenCrossOrigin,
    #[strum(serialize = "unsafe-url")]
    UnsafeUrl,
}

bun_core::comptime_string_map! {
    pub static MAP: ReferrerPolicy = {
        b"" => ReferrerPolicy::Empty,
        b"no-referrer" => ReferrerPolicy::NoReferrer,
        b"no-referrer-when-downgrade" => ReferrerPolicy::NoReferrerWhenDowngrade,
        b"same-origin" => ReferrerPolicy::SameOrigin,
        b"origin" => ReferrerPolicy::Origin,
        b"strict-origin" => ReferrerPolicy::StrictOrigin,
        b"origin-when-cross-origin" => ReferrerPolicy::OriginWhenCrossOrigin,
        b"strict-origin-when-cross-origin" => ReferrerPolicy::StrictOriginWhenCrossOrigin,
        b"unsafe-url" => ReferrerPolicy::UnsafeUrl,
    };
}

impl ReferrerPolicy {
    /// The map type is a zero-sized handle, so this is the same map as the
    /// module-level `MAP` static.
    pub const MAP: __ComptimeStringMap_MAP = __ComptimeStringMap_MAP(());

    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// Parses a `Referrer-Policy` response header: the last token naming a
    /// valid non-empty policy wins, `None` if none does.
    /// https://w3c.github.io/webappsec-referrer-policy/#parse-referrer-policy-from-header
    pub fn from_response_header(value: &[u8]) -> Option<ReferrerPolicy> {
        let mut result = None;
        for token in value.split(|&b| b == b',') {
            let token = bun_core::strings::trim(token, b" \t");
            if let Some(&policy) = Self::MAP.get(token)
                && policy != ReferrerPolicy::Empty
            {
                result = Some(policy);
            }
        }
        result
    }
    // to_js lives as an extension-trait method in bun_http_jsc (see PORTING.md §Idiom map).
}

use bun_core::strings;
use bun_url::URL as ZigURL;

/// The `Referer` request-header value (or `None` for no header). `referrer` is
/// the stored serialized form (`b""` / `b"about:client"` / normalized URL).
/// https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer
pub fn determine_referer_header(
    referrer: &[u8],
    policy: ReferrerPolicy,
    request_url: &ZigURL<'_>,
) -> Option<Vec<u8>> {
    // "no-referrer"
    if referrer.is_empty() {
        return None;
    }
    // "client": Bun has no environment creation URL to resolve against.
    if referrer == b"about:client" {
        return None;
    }
    // Local schemes yield no referrer. Matched on the href because `ZigURL`
    // mis-parses the browser form `blob:https://origin/uuid` as `blob:https`.
    if strings::has_prefix_comptime(referrer, b"about:")
        || strings::has_prefix_comptime(referrer, b"blob:")
        || strings::has_prefix_comptime(referrer, b"data:")
    {
        return None;
    }

    let referrer_url = ZigURL::parse(referrer);
    // A referrer with no `scheme://` authority cannot produce a Referer.
    let scheme = referrer_url.protocol;
    if scheme.is_empty() {
        return None;
    }

    let referrer_host = strip_userinfo(referrer_url.host);
    let request_host = strip_userinfo(request_url.host);

    // `scheme "://" host pathname` is the stripped referrer (`pathname` has no
    // fragment, and credentials were stripped above). Up to `origin_len` plus
    // a `/` is the origin-only form.
    let origin_len = scheme.len() + b"://".len() + referrer_host.len();
    let mut value: Vec<u8> = Vec::with_capacity(origin_len + referrer_url.pathname.len());
    value.extend_from_slice(scheme);
    value.extend_from_slice(b"://");
    value.extend_from_slice(referrer_host);
    value.extend_from_slice(referrer_url.pathname);

    let same_origin = scheme == request_url.protocol && referrer_host == request_host;
    // "referrerURL is a potentially trustworthy URL and request's current URL
    // is not a potentially trustworthy URL" -- the strict/downgrade guard.
    let downgrade = is_potentially_trustworthy(scheme, strip_userinfo(referrer_url.hostname))
        && !is_potentially_trustworthy(request_url.protocol, strip_userinfo(request_url.hostname));

    let send_full = match policy {
        ReferrerPolicy::NoReferrer => return None,
        ReferrerPolicy::Origin => false,
        ReferrerPolicy::UnsafeUrl => true,
        ReferrerPolicy::StrictOrigin => {
            if downgrade {
                return None;
            }
            false
        }
        ReferrerPolicy::NoReferrerWhenDowngrade => {
            if downgrade {
                return None;
            }
            true
        }
        ReferrerPolicy::SameOrigin => {
            if !same_origin {
                return None;
            }
            true
        }
        ReferrerPolicy::OriginWhenCrossOrigin => same_origin,
        // Empty policy == the default, `strict-origin-when-cross-origin`.
        ReferrerPolicy::Empty | ReferrerPolicy::StrictOriginWhenCrossOrigin => {
            if same_origin {
                true
            } else if downgrade {
                return None;
            } else {
                false
            }
        }
    };

    // "If the result of serializing referrerURL is a string whose length is
    // greater than 4096, set referrerURL to referrerOrigin."
    if !send_full || value.len() > 4096 {
        value.truncate(origin_len);
        value.push(b'/');
    }
    Some(value)
}

/// `ZigURL` leaves `user@` inside `host` when there is no password. Userinfo
/// ends at the last `@` (any `@` within it is percent-encoded when normalized).
fn strip_userinfo(host: &[u8]) -> &[u8] {
    match strings::last_index_of_char(host, b'@') {
        Some(at) => &host[at + 1..],
        None => host,
    }
}

/// `hostname` must come from a WHATWG-normalized href (loopbacks canonical).
/// https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy
fn is_potentially_trustworthy(scheme: &[u8], hostname: &[u8]) -> bool {
    if scheme == b"https" || scheme == b"wss" || scheme == b"file" {
        return true;
    }
    hostname == b"localhost"
        || strings::has_suffix_comptime(hostname, b".localhost")
        // Only an IPv4 127/8 address is loopback, not any `127.*` domain name.
        || (strings::has_prefix_comptime(hostname, b"127.") && strings::is_ip_address(hostname))
        || hostname == b"[::1]"
}
