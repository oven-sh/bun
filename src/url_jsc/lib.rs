//! JSC bridges for `bun_url::URL`. The struct + parser stay in `src/url/`.

#![allow(unused, dead_code)]
#![warn(unused_must_use)]

use bun_core::{String as BunString, Tag};
use bun_url::{OwnedURL, URL};

// ── bun_jsc surface ──────────────────────────────────────────────────────
// bun_jsc is green now; re-export the real opaque handles so downstream
// callers see the same types the rest of the JSC layer uses.
pub use bun_jsc::{JSGlobalObject, JSValue};

pub fn url_from_js(
    js_value: JSValue,
    global: &JSGlobalObject,
) -> Result<OwnedURL, bun_core::Error> {
    // TODO(port): narrow error set (InvalidURL | OOM | JSError)
    // PORT NOTE: ownership — per PORTING.md §Forbidden (no Box::leak / unsafe
    // lifetime extension), this returns `bun_url::OwnedURL`; callers borrow via
    // `.url()` and Drop frees the backing href slice.
    let href: BunString = bun_jsc::URL::href_from_js(js_value, global)
        // PORT NOTE: `href_from_js` also checks `has_exception()` (in addition
        // to the Dead-tag signal); surface that as a generic error for now.
        // TODO(port): revisit once bun_core::Error gains a JsError variant.
        .map_err(|_| bun_core::err!(JSError))?;
    if href.tag() == Tag::Dead {
        return Err(bun_core::err!(InvalidURL));
    }
    let owned = href.to_owned_slice().into_boxed_slice();
    href.deref();
    Ok(OwnedURL::from_href(owned))
}
