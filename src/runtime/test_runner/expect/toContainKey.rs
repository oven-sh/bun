use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome, make_formatter};

impl Expect {
    pub(crate) fn to_contain_key(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.contain_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toContainKey", ExpectedArray::None, ContainMsgs::CONTAIN,
            |g, value, expected| {
                if !value.is_object() {
                    let mut f = make_formatter(g);
                    return Err(g.throw_invalid_arguments(format_args!(
                        "Expected value must be an object\nReceived: {}", value.to_fmt(&mut f))));
                }
                Ok(ContainOutcome::pass(value.has_own_property_value(g, expected)?))
            })
    }
}
