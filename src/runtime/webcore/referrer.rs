//! The `Request`/`fetch()` construction-time referrer parsing.
//!
//! A request's referrer is stored in its serialized form, which is exactly
//! what the `Request.referrer` getter returns:
//!   - `""`             == the spec's "no-referrer"
//!   - `"about:client"` == the spec's "client" (the default)
//!   - anything else    == a WHATWG-normalized referrer URL
//!
//! The header-computation algorithm lives in
//! `bun_http_types::ReferrerPolicy::determine_referer_header` so the HTTP
//! client can reach it to recompute `Referer` on each redirect hop.
//!
//! https://fetch.spec.whatwg.org/#dom-request-referrer

use bun_core::String as BunString;

pub use bun_http_types::ReferrerPolicy::determine_referer_header;

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
