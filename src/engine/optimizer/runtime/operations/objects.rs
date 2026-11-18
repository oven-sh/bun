//! For questions about objects, and for making them.

use bun_engine_macros::native_abi;
use bun_engine_vm::{Cx, Gc, JsObject, JsResult, Value};

use super::{Address, Answer, Operation, Returned};

operations! {
    CREATE_THIS: fn create_this(cx: &mut Cx, new_target: Gc<JsObject>, capacity: u32) -> JsResult<Gc<JsObject>> {
        new_target.create_this(cx, capacity)
    }
    GET_PROTOTYPE_OF: fn get_prototype_of(cx: &mut Cx, value: Value) -> JsResult<Value> {
        value.get_prototype_of(cx)
    }
    HAS_INSTANCE: fn has_instance(cx: &mut Cx, constructor: Gc<JsObject>, value: Value, method: Value) -> Answer {
        constructor.has_instance_with(cx, value, method).into()
    }
}
