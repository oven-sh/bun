use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    pub(crate) fn to_contain_any_values(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.contain_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toContainAnyValues", ExpectedArray::BeforeValue,
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
