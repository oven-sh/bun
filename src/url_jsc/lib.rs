//! JSC bridges for `url/url.zig` `URL`. The struct + parser stay in `url/`.

#![allow(unused, dead_code)]

use bun_url::URL;

// ── B-1 stub surface ─────────────────────────────────────────────────────
// TODO(b1): bun_jsc::{JSGlobalObject, JSValue} missing — bun_jsc dep is gated
// out (its transitive bun_http_jsc does not compile yet). Expose opaque local
// newtypes so downstream signatures keep type-checking; replace with real
// re-exports once bun_jsc is green.
pub struct JSGlobalObject(());
#[derive(Clone, Copy)]
pub struct JSValue(());

pub fn url_from_js(
    _js_value: JSValue,
    _global: &JSGlobalObject,
) -> Result<URL<'static>, bun_core::Error> {
    // TODO(port): narrow error set (InvalidURL | OOM)
    todo!("b1-stub: url_from_js — gated until bun_jsc compiles")
}

// ── Phase-A draft (preserved, gated) ─────────────────────────────────────
#[cfg(any())]
mod phase_a_draft {
    use bun_jsc::{JSGlobalObject, JSValue};
    use bun_str as str_;
    use bun_url::URL;

    pub fn url_from_js(
        js_value: JSValue,
        global: &JSGlobalObject,
    ) -> Result<URL, bun_core::Error> {
        // TODO(port): narrow error set (InvalidURL | OOM)
        let href = bun_jsc::Url::href_from_js(global, js_value);
        if href.tag() == str_::Tag::Dead {
            return Err(bun_core::err!("InvalidURL"));
        }

        Ok(URL::parse(href.to_owned_slice()?))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/url_jsc/url_jsc.zig (16 lines)
//   confidence: medium
//   todos:      1
//   notes:      allocator param dropped; bun_jsc::Url + bun_str::Tag::Dead names may need fixup
// ──────────────────────────────────────────────────────────────────────────
