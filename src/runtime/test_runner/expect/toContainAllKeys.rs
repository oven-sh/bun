use super::{ContainMsgs, ContainOutcome, Expect, ExpectedArray};
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSArray, JsResult};

impl Expect {
    pub(crate) fn to_contain_all_keys<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'_>,
        expected: Option<JsLocal<'_, JSArray>>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        self.contain_matcher(
            cx.global(),
            this_value,
            expected,
            "toContainAllKeys",
            ExpectedArray::AfterValue,
            ContainMsgs {
                verb: "contain all keys",
                not_verb: "contain all keys",
            },
            |g, value, expected| {
                let expected = expected.to_js();
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
