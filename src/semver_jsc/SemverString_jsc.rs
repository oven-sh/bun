//! JSC bridge for `bun.Semver.String`. Keeps `src/semver/` free of JSC types.

use bun_semver::String as SemverString;

use bun_jsc::{JSGlobalObject, JSValue, JsResult, bun_string_jsc};

pub trait SemverStringJsc {
    fn to_js(&self, buffer: &[u8], global: &JSGlobalObject) -> JsResult<JSValue>;
}

impl SemverStringJsc for SemverString {
    fn to_js(&self, buffer: &[u8], global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::create_utf8_for_js(global, self.slice(buffer))
    }
}

// ported from: src/semver_jsc/SemverString_jsc.zig
