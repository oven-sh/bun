//! JSC bridge for lol-html `HTMLString`. Keeps `src/lolhtml_sys/` free of JSC types.

use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_lolhtml_sys::HTMLString;

pub fn html_string_to_js(this: HTMLString, global: &JSGlobalObject) -> JsResult<JSValue> {
    let str = this.to_string();
    // `defer str.deref()` — handled by `impl Drop for bun_str::String`.
    str.to_js(global)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/lolhtml_jsc.zig (10 lines)
//   confidence: high
//   todos:      0
//   notes:      Phase B may prefer an `HtmlStringJsc` extension trait over a free fn.
// ──────────────────────────────────────────────────────────────────────────
