//! JSC bridge for `bun.Semver.String`. Keeps `src/semver/` free of JSC types.

use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_semver::String as SemverString;

pub trait SemverStringJsc {
    fn to_js(&self, buffer: &[u8], global: &JSGlobalObject) -> JsResult<JSValue>;
}

impl SemverStringJsc for SemverString {
    fn to_js(&self, buffer: &[u8], global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_str::String::create_utf8_for_js(global, self.slice(buffer))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/semver_jsc/SemverString_jsc.zig (9 lines)
//   confidence: high
//   todos:      0
//   notes:      extension-trait pattern; create_utf8_for_js may live on StringJsc ext trait in bun_str_jsc
// ──────────────────────────────────────────────────────────────────────────
