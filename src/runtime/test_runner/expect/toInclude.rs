use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::strings;
use super::Expect;

pub fn to_include(this: &Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    this.run_string_affix_matcher(global, frame, "toInclude", "include", strings::contains)
}
// ported from: src/test_runner/expect/toInclude.zig
