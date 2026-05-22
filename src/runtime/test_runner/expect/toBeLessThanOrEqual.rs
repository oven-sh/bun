use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::{Expect, OrderingRelation};

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_less_than_or_equal(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.numeric_ordering_matcher(global, frame, "toBeLessThanOrEqual", OrderingRelation::Le)
    }
}

// ported from: src/test_runner/expect/toBeLessThanOrEqual.zig
