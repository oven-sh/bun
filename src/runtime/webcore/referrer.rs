//! A request's referrer is stored in its serialized form, which is exactly
//! what the `Request.referrer` getter returns: `""` for "no-referrer",
//! `"about:client"` for "client" (the default), otherwise a normalized URL.
//! https://fetch.spec.whatwg.org/#dom-request-referrer
//!
//! The header algorithm (`determine_referer_header`) lives in `bun_http_types`
//! so the HTTP client can recompute `Referer` on each redirect hop.

use bun_core::String as BunString;

pub use bun_http_types::ReferrerPolicy::determine_referer_header;

/// The serialization of the "client" referrer.
pub const CLIENT_SERIALIZED: &[u8] = b"about:client";

/// A request's default referrer ("client"), in stored form.
#[inline]
pub fn client() -> BunString {
    BunString::static_(CLIENT_SERIALIZED)
}

/// Request ctor step 14: turn `init.referrer` into the stored referrer.
/// `None` means the value is not a parsable absolute URL; the caller throws.
/// Bun has no environment origin, so step 14.3.3 never applies.
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
