use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

/// True when some element of `array` (of length `len`) passes `matches`.
fn any_index(g: &JSGlobalObject, array: JSValue, len: u64, mut matches: impl FnMut(JSValue) -> JsResult<bool>) -> JsResult<bool> {
    let mut i: u32 = 0;
    while u64::from(i) < len {
        if matches(array.get_index(g, i)?)? { return Ok(true); }
        i += 1;
    }
    Ok(false)
}

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_contain_all_keys(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.contain_matcher(global, frame, "toContainAllKeys", ExpectedArray::AfterValue,
            ContainMsgs { verb: "contain all keys", not_verb: "contain all keys" },
            |g, value, expected| {
                let count = expected.get_length(g)?;
                let keys = value.keys(g)?;
                let mut pass = keys.get_length(g)? == count;
                // Every key must match an expected item, and every expected item must match a key.
                // One asymmetric matcher can match several keys, so one direction alone is not enough.
                if pass {
                    let mut itr = keys.array_iterator(g)?;
                    while let Some(key) = itr.next()? {
                        if !any_index(g, expected, count, |item| key.jest_deep_equals(item, g))? { pass = false; break; }
                    }
                }
                if pass {
                    let mut itr = expected.array_iterator(g)?;
                    while let Some(item) = itr.next()? {
                        if !any_index(g, keys, count, |key| key.jest_deep_equals(item, g))? { pass = false; break; }
                    }
                }
                Ok(ContainOutcome { pass, received_override: Some(keys) })
            })
    }
}
