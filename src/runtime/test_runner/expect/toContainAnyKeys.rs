use super::{ContainMsgs, ContainOutcome, Expect, ExpectedArray};
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSArray, JsResult};

impl Expect {
    pub(crate) fn to_contain_any_keys<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'_>,
        expected: Option<JsLocal<'_, JSArray>>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        self.contain_matcher(
            cx.global(),
            this_value,
            expected,
            "toContainAnyKeys",
            ExpectedArray::AfterValue,
            ContainMsgs::CONTAIN,
            |g, value, expected| {
                let expected = expected.to_js();
                if !value.is_object() {
                    return Ok(ContainOutcome::pass(false));
                }
                let count = expected.get_length(g)?;
                let mut i: u32 = 0;
                while u64::from(i) < count {
                    if value.has_own_property_value(g, expected.get_index(g, i)?)? {
                        return Ok(ContainOutcome::pass(true));
                    }
                    i += 1;
                }
                Ok(ContainOutcome::pass(false))
            })
    }
}
