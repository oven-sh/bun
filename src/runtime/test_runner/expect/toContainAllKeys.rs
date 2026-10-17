use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_contain_all_keys(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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
                            let mut key = expected.get_index(g, i)?;
                            // Object.keys() gives strings. hasOwnProperty() converts a number key for the sibling matchers.
                            if key.is_number() { key = JSValue::from_cell(key.to_js_string(g)?); }
                            if item.jest_deep_equals(key, g)? { continue 'outer; }
                            i += 1;
                        }
                        pass = false; break;
                    }
                }
                Ok(ContainOutcome { pass, received_override: Some(keys) })
            })
    }
}
