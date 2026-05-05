//! JSC bridges for `url/url.zig` `URL`. The struct + parser stay in `url/`.

#![allow(unused, dead_code)]

use bun_string::{String as BunString, Tag};
use bun_url::URL;

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
) -> Result<URL<'static>, bun_core::Error> {
    // TODO(port): narrow error set (InvalidURL | OOM)
    // TODO(port): ownership — Zig returns a URL borrowing from a freshly-allocated
    // owned slice (`href.toOwnedSlice`). Per PORTING.md §Forbidden, no Box::leak;
    // needs an owning `OwnedURL` wrapper (or `(Vec<u8>, URL<'_>)` pair). See the
    // sibling note on `bun_url::URL::from_string`.
    #[cfg(any())]
    {
        // TODO(b2-blocked): bun_jsc::URL::href_from_js
        let href: BunString = bun_jsc::URL::href_from_js(js_value, global)?;
        if href.tag() == Tag::Dead {
            return Err(bun_core::err!(InvalidURL));
        }
        return Ok(URL::parse(href.to_owned_slice()));
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
//   notes:      allocator param dropped; body re-gated on bun_jsc (crate red);
//               'static lifetime is a lie until OwnedURL lands.
// ──────────────────────────────────────────────────────────────────────────
