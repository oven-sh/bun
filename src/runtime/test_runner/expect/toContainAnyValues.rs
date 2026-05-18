use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_any_values(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.contain_matcher(global, frame, "toContainAnyValues", ExpectedArray::BeforeValue,
            ContainMsgs { verb: "contain any of the following values", not_verb: "contain any of the following values" },
            |g, value, expected| {
                if value.is_undefined_or_null() { return Ok(ContainOutcome::pass(false)); }
                let values = value.values(g)?;
                let count = values.get_length(g)?;
                let mut itr = expected.array_iterator(g)?;
                while let Some(item) = itr.next()? {
                    let mut i: u32 = 0;
                    while (i as u64) < count {
                        if values.get_index(g, i)?.jest_deep_equals(item, g)? {
                            return Ok(ContainOutcome::pass(true));
                        }
                        i += 1;
                    }
                }
                Ok(ContainOutcome::pass(false))
            })
    }
}
// ported from: src/test_runner/expect/toContainAnyValues.zig
