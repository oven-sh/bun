//! JSC bridge for lol-html `HTMLString`. Keeps `src/lolhtml_sys/` free of JSC types.

use bun_core::{String as BunString, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_lolhtml_sys::HTMLString;

pub(crate) fn html_string_to_string(this: HTMLString) -> BunString {
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

pub(crate) fn html_string_to_js(this: HTMLString, global: &JSGlobalObject) -> JsResult<JSValue> {
    // Zig: `var str = this.toString(); defer str.deref();` — `bun_core::String`
    // is `Copy` with NO `Drop`; `OwnedString` is the RAII wrapper that releases
    // the +1 ref returned by `html_string_to_string` on scope exit.
    let str = bun_core::OwnedString::new(html_string_to_string(this));
    str.to_js(global)
}

// ported from: src/runtime/api/lolhtml_jsc.zig
