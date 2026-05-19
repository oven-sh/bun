use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

#[allow(unused_imports)]
use super::{Expect, JSValueTestExt};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_falsy(&self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        self.run_boolean_matcher_predicate(g, f, "toBeFalsy", |v| !v.to_boolean())
    }
}
// ported from: src/test_runner/expect/toBeFalsy.zig
