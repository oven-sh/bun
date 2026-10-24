use super::{ContainMsgs, ContainOutcome, Expect, ExpectedArray};
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSArray, JsResult};

impl Expect {
    pub(crate) fn to_contain_any_values<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'_>,
        expected: Option<JsLocal<'_, JSArray>>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        self.contain_matcher(
            cx.global(),
            this_value,
            expected,
            "toContainAnyValues",
            ExpectedArray::BeforeValue,
            ContainMsgs {
                verb: "contain any of the following values",
                not_verb: "contain any of the following values",
            },
            |g, value, expected| {
                let expected = expected.to_js();
                if value.is_undefined_or_null() {
                    return Ok(ContainOutcome::pass(false));
                }
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
