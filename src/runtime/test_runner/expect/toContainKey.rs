use super::{ContainMsgs, ContainOutcome, Expect, ExpectedArray, make_formatter};
use bun_jsc::JsResult;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};

impl Expect {
    pub(crate) fn to_contain_key<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        self.contain_matcher(
            cx.global(),
            this_value,
            Some(expected),
            "toContainKey",
            ExpectedArray::None,
            ContainMsgs::CONTAIN,
            |g, value, expected| {
                if !value.is_object() {
                    let mut f = make_formatter(g);
                    return Err(g.throw_invalid_arguments(format_args!(
                        "Expected value must be an object\nReceived: {}", value.to_fmt(&mut f))));
                }
                Ok(ContainOutcome::pass(
                    value.has_own_property_value(g, expected.to_js())?,
                ))
            },
        )
    }
}
