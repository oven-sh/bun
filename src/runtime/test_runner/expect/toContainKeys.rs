use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_keys(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.contain_matcher(global, frame, "toContainKeys", ExpectedArray::AfterValue, ContainMsgs::CONTAIN,
            |g, value, expected| {
                let count = expected.get_length(g)?;
                // jest-extended checks truthiness before hasOwnProperty; non-object passes only on empty expected.
                if !value.is_object() { return Ok(ContainOutcome::pass(count == 0)); }
                let mut i: u32 = 0;
                while u64::from(i) < count {
                    if !value.has_own_property_value(g, expected.get_index(g, i)?)? {
                        return Ok(ContainOutcome::pass(false));
                    }
                    i += 1;
                }
                Ok(ContainOutcome::pass(true))
            })
    }
}
// ported from: src/test_runner/expect/toContainKeys.zig
