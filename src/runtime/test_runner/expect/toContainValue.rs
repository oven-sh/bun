use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    pub(crate) fn to_contain_value(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.contain_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toContainValue", ExpectedArray::None, ContainMsgs::CONTAIN,
            |g, value, expected| {
                if value.is_undefined_or_null() { return Ok(ContainOutcome::pass(false)); }
                let mut itr = value.values(g)?.array_iterator(g)?;
                while let Some(item) = itr.next()? {
                    if item.jest_deep_equals(expected, g)? { return Ok(ContainOutcome::pass(true)); }
                }
                Ok(ContainOutcome::pass(false))
            })
    }
}
