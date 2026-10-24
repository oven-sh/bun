use super::{ContainMsgs, ContainOutcome, Expect, ExpectedArray};
use bun_jsc::JsResult;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};

impl Expect {
    pub(crate) fn to_contain_value<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        self.contain_matcher(
            cx.global(),
            this_value,
            Some(expected),
            "toContainValue",
            ExpectedArray::None,
            ContainMsgs::CONTAIN,
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
