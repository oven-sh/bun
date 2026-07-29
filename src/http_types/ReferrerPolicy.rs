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

    /// Parses a `Referrer-Policy` response header.
    /// https://w3c.github.io/webappsec-referrer-policy/#parse-referrer-policy-from-header
    ///
    /// The header is a comma-separated list of tokens; the *last* token that
    /// names a valid non-empty policy wins. Returns `None` if no token does.
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

/// The `Referer` request-header value for a request whose stored referrer is
/// `referrer` and whose current URL is `request_url`, or `None` when no
/// `Referer` header should be sent.
///
/// Implements "determine request's referrer"
/// (https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer)
/// followed by the fetch spec's "HTTP-network-or-cache fetch" Referer step.
///
/// `referrer` is the request's stored referrer in its serialized form: `b""`
/// for "no-referrer", `b"about:client"` for "client", otherwise a
/// WHATWG-normalized referrer URL. `request_url` must likewise be parsed from
/// a WHATWG-normalized href.
///
/// Lives here rather than in `bun_runtime` so the HTTP client can recompute
/// the header on each redirect hop.
pub fn determine_referer_header(
    referrer: &[u8],
    policy: ReferrerPolicy,
    request_url: &ZigURL<'_>,
) -> Option<Vec<u8>> {
    // "no-referrer"
    if referrer.is_empty() {
        return None;
    }
    // "client": Bun has no document or environment creation URL to resolve it
    // against, so a "client" referrer yields no referrer. (undici behaves the
    // same way when no global origin is configured.)
    if referrer == b"about:client" {
        return None;
    }
    // "Strip url for use as a referrer" step 2: the local schemes yield no
    // referrer. Matched on the normalized href rather than on the parsed
    // scheme because `ZigURL` only recognizes a scheme spelled `scheme://`,
    // so the browser form `blob:https://origin/uuid` parses as `blob:https`.
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

    // The stripped referrer URL: `scheme "://" host[":" port] path ["?" query]`.
    // `ZigURL.pathname` is path + query with the fragment excluded, so together
    // with the credential-stripped host this is the spec's "strip url for use
    // as a referrer".
    let origin_len = scheme.len() + b"://".len() + referrer_host.len();
    let mut value: Vec<u8> = Vec::with_capacity(origin_len + referrer_url.pathname.len());
    value.extend_from_slice(scheme);
    value.extend_from_slice(b"://");
    value.extend_from_slice(referrer_host);
    // `pathname` always begins with `/`, so truncating to `origin_len` and
    // pushing a `/` yields the origin-only form ("set url's path to the empty
    // string" serializes as origin + "/").
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
        // The empty policy resolves to the policy container's default,
        // `strict-origin-when-cross-origin`.
        // https://w3c.github.io/webappsec-referrer-policy/#default-referrer-policy
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

/// `ZigURL::parse` only splits off credentials when a `:` precedes the `@`, so
/// a URL with a username but no password keeps `user@` inside `host` and
/// `hostname`. Userinfo ends at the authority's last `@` (any `@` within it is
/// percent-encoded in a normalized href).
fn strip_userinfo(host: &[u8]) -> &[u8] {
    match strings::last_index_of_char(host, b'@') {
        Some(at) => &host[at + 1..],
        None => host,
    }
}

/// https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy
///
/// `hostname` must come from a WHATWG-normalized href, so an IPv4 loopback is a
/// canonical dotted quad (`127.x.y.z`) and the IPv6 loopback serializes as
/// `[::1]`.
fn is_potentially_trustworthy(scheme: &[u8], hostname: &[u8]) -> bool {
    if scheme == b"https" || scheme == b"wss" || scheme == b"file" {
        return true;
    }
    hostname == b"localhost"
        || strings::has_suffix_comptime(hostname, b".localhost")
        // Only an IPv4 address in 127/8 is loopback; a domain name whose first
        // label happens to be `127` is not.
        || (strings::has_prefix_comptime(hostname, b"127.") && strings::is_ip_address(hostname))
        || hostname == b"[::1]"
}
