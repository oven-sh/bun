use bun_engine_vm::{JsFunction, indirect_eval};

use crate::prelude::*;

pub(super) fn initialize(cx: &Cx) {
    let name = names::eval.to_identifier().into_string();
    cx.global()
        .init_eval_function(JsFunction::native(cx, 1, &name, eval));
}

#[native_abi]
fn eval(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    indirect_eval(cx, frame.argument(0))
}
