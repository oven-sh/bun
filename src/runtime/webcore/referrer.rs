//! The fetch-spec referrer plumbing shared by `Request` and `fetch()`.
//!
//! A request's referrer is stored in its serialized form, which is exactly
//! what the `Request.referrer` getter returns:
//!   - `""`             == the spec's "no-referrer"
//!   - `"about:client"` == the spec's "client" (the default)
//!   - anything else    == a WHATWG-normalized referrer URL
//!
//! https://fetch.spec.whatwg.org/#dom-request-referrer

use bun_core::{String as BunString, strings};
use bun_http_types::ReferrerPolicy::ReferrerPolicy;
use bun_url::URL as ZigURL;

/// The serialization of the "client" referrer.
pub const CLIENT_SERIALIZED: &[u8] = b"about:client";

/// A request's default referrer ("client"), in stored form.
#[inline]
pub fn client() -> BunString {
    BunString::static_(CLIENT_SERIALIZED)
}

/// Fetch spec `new Request(input, init)` step 14 ("If `init["referrer"]`
/// exists"): turn `init.referrer` into the request's stored referrer.
///
/// `None` means `referrer` is not a parsable absolute URL; the caller throws
/// a `TypeError`. (Bun has no base URL, so relative referrers fail here.)
///
/// Bun has no environment settings object, so step 14.3.3's "parsedReferrer's
/// origin is not same origin with [the environment's] origin" branch never
/// applies; undici skips it the same way when no global origin is configured.
pub fn parse_init_referrer(referrer: &BunString) -> Option<BunString> {
    // Step 14.2: the empty string means "no-referrer".
    if referrer.is_empty() {
        return Some(BunString::empty());
    }
    let href = bun_url::href_from_string(referrer);
    if href.is_empty() {
        return None;
    }
    // Step 14.3.3: `about:client` is the "client" sentinel.
    if href.eql_comptime(CLIENT_SERIALIZED) {
        href.deref();
        return Some(client());
    }
    Some(href)
}

/// The `Referer` request-header value for a request whose stored referrer is
/// `referrer` and whose current URL is `request_url`, or `None` when no
/// `Referer` header should be sent.
///
/// Implements "determine request's referrer"
/// (https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer)
/// followed by the fetch spec's "HTTP-network-or-cache fetch" Referer step.
/// Both `referrer` and `request_url` must be WHATWG-normalized hrefs.
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
    if referrer == CLIENT_SERIALIZED {
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
        || strings::ends_with_comptime(hostname, b".localhost")
        // Only an IPv4 address in 127/8 is loopback; a domain name whose first
        // label happens to be `127` is not.
        || (strings::has_prefix_comptime(hostname, b"127.") && strings::is_ip_address(hostname))
        || hostname == b"[::1]"
}
