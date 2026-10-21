use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    pub(crate) fn to_contain_values(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.contain_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toContainValues", ExpectedArray::BeforeValue, ContainMsgs::CONTAIN,
            |g, value, expected| {
                if value.is_undefined_or_null() { return Ok(ContainOutcome::pass(true)); }
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
