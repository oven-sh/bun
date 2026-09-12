use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

/// True when each element of the array `from` has an element of the array `to` that `eq(from_item, to_item)` accepts.
fn each_has_match(g: &JSGlobalObject, from: JSValue, to: JSValue, eq: impl Fn(JSValue, JSValue) -> JsResult<bool>) -> JsResult<bool> {
    let to_len = to.get_length(g)?;
    let mut itr = from.array_iterator(g)?;
    'outer: while let Some(item) = itr.next()? {
        let mut i: u32 = 0;
        while u64::from(i) < to_len {
            if eq(item, to.get_index(g, i)?)? { continue 'outer; }
            i += 1;
        }
        return Ok(false);
    }
    Ok(true)
}

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_contain_all_keys(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.contain_matcher(global, frame, "toContainAllKeys", ExpectedArray::AfterValue,
            ContainMsgs { verb: "contain all keys", not_verb: "contain all keys" },
            |g, value, expected| {
                let count = expected.get_length(g)?;
                let keys = value.keys(g)?;
                let key_matches = |key: JSValue, item: JSValue| key.jest_deep_equals(item, g);
                // Keys are unique strings, so the first walk alone is exact for plain entries of `expected`.
                // An asymmetric matcher can match several keys and hide an entry that matches none: walk both ways.
                let pass = keys.get_length(g)? == count
                    && each_has_match(g, keys, expected, key_matches)?
                    && each_has_match(g, expected, keys, |item, key| key_matches(key, item))?;
                Ok(ContainOutcome { pass, received_override: Some(keys) })
            })
    }
}
