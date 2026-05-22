//! JSC bridge for lol-html `HTMLString`. Keeps `src/lolhtml_sys/` free of JSC types.

use bun_core::{String as BunString, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_lolhtml_sys::HTMLString;

/// `HTMLString.toString` — port of `lol_html.zig:HTMLString.toString`.
///
/// Lives here (not in `bun_lolhtml_sys`) because the `*_sys` crate is a leaf
/// FFI crate with no `bun_string` dependency; pulling one in would invert the
/// layering. This module is the higher-tier wrapper that owns the
/// `HTMLString` → `bun.String` bridge.
///
/// Zero-copies all-ASCII payloads as a Latin-1 external string (ownership of
/// the lol-html buffer transfers to WTF and is freed by
/// [`HTMLString::deinit_external`]); otherwise clones as UTF-8 and frees the
/// original.
pub fn html_string_to_string(this: HTMLString) -> BunString {
    let bytes = this.slice();
    if !bytes.is_empty() && strings::is_all_ascii(bytes) {
        // SAFETY: `bytes` aliases `this.ptr[..this.len]`, which lol-html keeps
        // valid until `lol_html_str_free`. Ownership moves to the external
        // string; `deinit_external` reconstructs the `HTMLString` from
        // (ctx=ptr, len) and frees it when WTF drops the impl.
        return BunString::create_external::<*mut u8>(
            bytes,
            true,
            this.ptr.cast_mut(),
            HTMLString::deinit_external,
        );
    }
    let s = BunString::clone_utf8(bytes);
    this.deinit();
    s
}

pub fn html_string_to_js(this: HTMLString, global: &JSGlobalObject) -> JsResult<JSValue> {
    // Zig: `var str = this.toString(); defer str.deref();` — `bun_core::String`
    // is `Copy` with NO `Drop`; `OwnedString` is the RAII wrapper that releases
    // the +1 ref returned by `html_string_to_string` on scope exit.
    let str = bun_core::OwnedString::new(html_string_to_string(this));
    str.to_js(global)
}

// ported from: src/runtime/api/lolhtml_jsc.zig
