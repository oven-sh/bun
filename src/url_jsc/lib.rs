//! JSC bridges for `url/url.zig` `URL`. The struct + parser stay in `url/`.

#![allow(unused, dead_code)]

use bun_string::{String as BunString, Tag};
use bun_url::{OwnedURL, URL};

// ── bun_jsc surface ──────────────────────────────────────────────────────
// TODO(b2-blocked): bun_jsc::JSGlobalObject / bun_jsc::JSValue — the bun_jsc
// crate does not compile yet (stub_ty! vs un-gated module name collisions).
// Keep opaque local newtypes so the public signature type-checks; swap to
// `pub use bun_jsc::{JSGlobalObject, JSValue}` once bun_jsc is green.
#[repr(transparent)]
pub struct JSGlobalObject(usize);
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct JSValue(usize);

pub fn url_from_js(
    js_value: JSValue,
    global: &JSGlobalObject,
) -> Result<OwnedURL, bun_core::Error> {
    // TODO(port): narrow error set (InvalidURL | OOM)
    // PORT NOTE: ownership — Zig returns a `URL` borrowing from a freshly-allocated
    // owned slice (`href.toOwnedSlice`); caller frees `url.href` later. Per
    // PORTING.md §Forbidden (no Box::leak / unsafe lifetime extension), Rust
    // returns `bun_url::OwnedURL`; callers borrow via `.url()` and Drop frees it.
    #[cfg(any())]
    {
        // TODO(b2-blocked): bun_jsc::URL::href_from_js — bun_jsc red (transitive
        // bun_css E0119s). Swap local `JSValue`/`JSGlobalObject` newtypes to
        // `bun_jsc::{JSValue, JSGlobalObject}` at the same time.
        let href: BunString = bun_jsc::URL::href_from_js(js_value, global)?;
        if href.tag() == Tag::Dead {
            return Err(bun_core::err!(InvalidURL));
        }
        let owned = href.to_owned_slice().into_boxed_slice();
        href.deref();
        // TODO(b2-blocked): bun_url::OwnedURL::from_href — `OwnedURL { href }` is
        // private; needs a pub bytes-ctor (mirror of `URL::from_string`'s tail).
        return Ok(OwnedURL::from_href(owned));
    }
    #[allow(unreachable_code)]
    {
        let _ = (js_value, global);
        todo!("b2-blocked: bun_jsc::URL::href_from_js")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/url_jsc/url_jsc.zig (16 lines)
//   confidence: medium
//   todos:      2
//   notes:      allocator param dropped; return type now OwnedURL (no 'static
//               lie); body re-gated on bun_jsc (transitive bun_css red) +
//               bun_url::OwnedURL::from_href ctor.
// ──────────────────────────────────────────────────────────────────────────
