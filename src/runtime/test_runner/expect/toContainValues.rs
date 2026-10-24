use super::{ContainMsgs, ContainOutcome, Expect, ExpectedArray};
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSArray, JsResult};

impl Expect {
    pub(crate) fn to_contain_values<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'_>,
        expected: Option<JsLocal<'_, JSArray>>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        self.contain_matcher(
            cx.global(),
            this_value,
            expected,
            "toContainValues",
            ExpectedArray::BeforeValue,
            ContainMsgs::CONTAIN,
            |g, value, expected| {
                let expected = expected.to_js();
                if value.is_undefined_or_null() {
                    return Ok(ContainOutcome::pass(true));
                }
                let values = value.values(g)?;
                let count = values.get_length(g)?;
                let mut itr = expected.array_iterator(g)?;
                'outer: while let Some(item) = itr.next()? {
                    let mut i: u32 = 0;
                    while (i as u64) < count {
                        if values.get_index(g, i)?.jest_deep_equals(item, g)? { continue 'outer; }
                        i += 1;
                    }
                    return Ok(ContainOutcome::pass(false));
                }
                Ok(ContainOutcome::pass(true))
            })
    }
}
