use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::strings;
use super::Expect;

pub fn to_end_with(this: &Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    this.run_string_affix_matcher(global, frame, "toEndWith", "end with", strings::ends_with)
}
// ported from: src/test_runner/expect/toEndWith.zig
