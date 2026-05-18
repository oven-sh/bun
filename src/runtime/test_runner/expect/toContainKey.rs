use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome, make_formatter};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_key(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.contain_matcher(global, frame, "toContainKey", ExpectedArray::None, ContainMsgs::CONTAIN,
            |g, value, expected| {
                if !value.is_object() {
                    let mut f = make_formatter(g);
                    return Err(g.throw_invalid_arguments(format_args!(
                        "Expected value must be an object\nReceived: {}", value.to_fmt(&mut f))));
                }
                Ok(ContainOutcome::pass(value.has_own_property_value(g, expected)?))
            })
    }
}
// ported from: src/test_runner/expect/toContainKey.zig
