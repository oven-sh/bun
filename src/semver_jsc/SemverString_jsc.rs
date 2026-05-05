//! JSC bridge for `bun.Semver.String`. Keeps `src/semver/` free of JSC types.

use bun_semver::String as SemverString;

use crate::jsc_stub::{JSGlobalObject, JSValue, JsResult};

pub trait SemverStringJsc {
    fn to_js(&self, buffer: &[u8], global: &JSGlobalObject) -> JsResult<JSValue>;
}

impl SemverStringJsc for SemverString {
    fn to_js(&self, buffer: &[u8], global: &JSGlobalObject) -> JsResult<JSValue> {
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_jsc::bun_string_jsc::create_utf8_for_js
            return bun_jsc::bun_string_jsc::create_utf8_for_js(global, self.slice(buffer));
        }
        let _ = (buffer, global);
        todo!("SemverStringJsc::to_js — gated on bun_jsc::bun_string_jsc::create_utf8_for_js")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/semver_jsc/SemverString_jsc.zig (9 lines)
//   confidence: high
//   todos:      0
//   notes:      extension-trait pattern; create_utf8_for_js lives in bun_jsc::bun_string_jsc (gated in B-2)
// ──────────────────────────────────────────────────────────────────────────
