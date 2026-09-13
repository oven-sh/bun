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
                let key_matches = |key: JSValue, item: JSValue| key.jest_deep_equals(item, g);
                let all_match = || -> JsResult<bool> {
                    if keys.get_length(g)? != count { return Ok(false); }
                    // `selected[i]`: a key took entry `i` of `expected` as its match.
                    let mut selected = vec![false; count as usize];
                    let mut itr = keys.array_iterator(g)?;
                    'keys: while let Some(key) = itr.next()? {
                        let mut i: u32 = 0;
                        while u64::from(i) < count {
                            if key_matches(key, expected.get_index(g, i)?)? { selected[i as usize] = true; continue 'keys; }
                            i += 1;
                        }
                        return Ok(false);
                    }
                    // Keys are unique strings, so each key takes its own plain entry and no entry is left.
                    // An asymmetric matcher can match several keys and leave an entry that matches no key.
                    // Compare only the entries that are left: a matcher can keep state (a `g` regex in
                    // `expect.stringMatching` keeps `lastIndex`), so a pair that matched must not run again.
                    for (i, _) in selected.iter().enumerate().filter(|&(_, &taken)| !taken) {
                        let item = expected.get_index(g, i as u32)?;
                        let mut found = false;
                        let mut itr = keys.array_iterator(g)?;
                        while let Some(key) = itr.next()? {
                            if key_matches(key, item)? { found = true; break; }
                        }
                        if !found { return Ok(false); }
                    }
                    Ok(true)
                };
                Ok(ContainOutcome { pass: all_match()?, received_override: Some(keys) })
            })
    }
}
