use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    pub(crate) fn to_contain_keys(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.contain_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toContainKeys", ExpectedArray::AfterValue, ContainMsgs::CONTAIN,
            |g, value, expected| {
                let count = expected.get_length(g)?;
                // jest-extended checks truthiness before hasOwnProperty; non-object passes only on empty expected.
                if !value.is_object() { return Ok(ContainOutcome::pass(count == 0)); }
                let mut i: u32 = 0;
                while u64::from(i) < count {
                    if !value.has_own_property_value(g, expected.get_index(g, i)?)? {
                        return Ok(ContainOutcome::pass(false));
                    }
                    i += 1;
                }
                Ok(ContainOutcome::pass(true))
            })
    }
}
