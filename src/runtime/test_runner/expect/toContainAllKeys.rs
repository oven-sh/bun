use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_all_keys(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.contain_matcher(global, frame, "toContainAllKeys", ExpectedArray::AfterValue,
            ContainMsgs { verb: "contain all keys", not_verb: "contain all keys" },
            |g, value, expected| {
                let count = expected.get_length(g)?;
                let keys = value.keys(g)?;
                let mut pass = false;
                if keys.get_length(g)? == count {
                    pass = true;
                    let mut itr = keys.array_iterator(g)?;
                    'outer: while let Some(item) = itr.next()? {
                        let mut i: u32 = 0;
                        while u64::from(i) < count {
                            if item.jest_deep_equals(expected.get_index(g, i)?, g)? { continue 'outer; }
                            i += 1;
                        }
                        pass = false; break;
                    }
                }
                Ok(ContainOutcome { pass, received_override: Some(keys) })
            })
    }
}
// ported from: src/test_runner/expect/toContainAllKeys.zig
