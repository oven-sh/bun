use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome, WalkFirst};

impl Expect {
    #[optimize(size)]
    pub(crate) fn to_contain_all_keys(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.contain_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toContainAllKeys", ExpectedArray::AfterValue,
            ContainMsgs { verb: "contain all keys", not_verb: "contain all keys" },
            |g, value, expected| {
                let count = expected.get_length(g)?;
                let keys = value.keys(g)?;
                let pass = keys.get_length(g)? == count
                    && Self::lists_cover_each_other(g, keys, expected, count, WalkFirst::Received)?;
                Ok(ContainOutcome { pass, received_override: Some(keys) })
            })
    }
}
