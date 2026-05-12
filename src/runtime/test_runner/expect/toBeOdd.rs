use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{Expect, JSValueTestExt};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_odd(&self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        self.run_unary_predicate(g, f, "toBeOdd", |v| {
            if v.is_big_int32() {
                v.to_int32() & 1 == 1
            } else if v.is_big_int() {
                v.to_int64() & 1 == 1
            } else if v.is_int32() {
                v.to_int32().rem_euclid(2) == 1
            } else if v.is_any_int() {
                v.to_int64().rem_euclid(2) == 1
            } else if v.is_number() {
                let n = v.as_number();
                n.rem_euclid(1.0) == 0.0 && n.rem_euclid(2.0) == 1.0
            } else {
                false
            }
        })
    }
}
// ported from: src/test_runner/expect/toBeOdd.zig
