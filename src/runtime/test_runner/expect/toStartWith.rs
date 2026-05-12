use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::strings;
use super::Expect;

pub fn to_start_with(this: &Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    this.run_string_affix_matcher(global, frame, "toStartWith", "start with", strings::starts_with)
}
// ported from: src/test_runner/expect/toStartWith.zig
