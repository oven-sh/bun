use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_value(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.contain_matcher(global, frame, "toContainValue", ExpectedArray::None, ContainMsgs::CONTAIN,
            |g, value, expected| {
                if value.is_undefined_or_null() { return Ok(ContainOutcome::pass(false)); }
                let mut itr = value.values(g)?.array_iterator(g)?;
                while let Some(item) = itr.next()? {
                    if item.jest_deep_equals(expected, g)? { return Ok(ContainOutcome::pass(true)); }
                }
                Ok(ContainOutcome::pass(false))
            })
    }
}
// ported from: src/test_runner/expect/toContainValue.zig
