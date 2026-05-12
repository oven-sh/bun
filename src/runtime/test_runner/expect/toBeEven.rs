use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{Expect, JSValueTestExt};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_even(&self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        self.run_unary_predicate(g, f, "toBeEven", |v| {
            if v.is_any_int() {
                let n = v.to_int64();
                n == 0 || n.rem_euclid(2) == 0
            } else if v.is_big_int() || v.is_big_int32() {
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
// ported from: src/test_runner/expect/toBeEven.zig
