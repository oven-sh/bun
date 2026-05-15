use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_all_values(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.contain_matcher(global, frame, "toContainAllValues", ExpectedArray::BeforeValue,
            ContainMsgs { verb: "contain all values", not_verb: "contain all values" },
            |g, value, expected| {
                if value.is_undefined_or_null() { return Ok(ContainOutcome::pass(false)); }
                let values = value.values(g)?;
                let count = values.get_length(g)?;
                if count != expected.get_length(g)? { return Ok(ContainOutcome::pass(false)); }
                let mut itr = expected.array_iterator(g)?;
                let mut pass = false;
                'outer: while let Some(item) = itr.next()? {
                    let mut i: u32 = 0;
                    while u64::from(i) < count {
                        if values.get_index(g, i)?.jest_deep_equals(item, g)? { pass = true; continue 'outer; }
                        i += 1;
                    }
                    return Ok(ContainOutcome::pass(false));
                }
                Ok(ContainOutcome::pass(pass))
            })
    }
}
// ported from: src/test_runner/expect/toContainAllValues.zig
