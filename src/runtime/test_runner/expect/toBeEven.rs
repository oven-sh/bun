use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::Expect;

impl Expect {
    pub(crate) fn to_be_even(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        self.run_unary_predicate(cx.global(), this_value.to_js(), "toBeEven", |v| {
            if v.is_any_int() {
                let n = v.to_int64();
                n == 0 || n.rem_euclid(2) == 0
            } else if v.is_big_int() {
                let n = v.to_int64();
                n == 0 || n & 1 == 0
            } else if v.is_number() {
                let n = v.as_number();
                n.rem_euclid(1.0) == 0.0 && n.rem_euclid(2.0) == 0.0
            } else {
                false
            }
        })
    }
}
