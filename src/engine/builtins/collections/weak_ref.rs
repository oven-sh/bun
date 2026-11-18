use bun_engine_vm::{GlobalObject, JsWeakRef, can_be_held_weakly, errors};

use super::{instance_shape, this_weak};
use crate::prelude::*;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::deref, deref, 0),
    StaticProperty::string(symbols::toStringTag, names::WeakRef),
]);

define_object!(WeakRefPrototype, "WeakRef", PROTOTYPE_PROPERTIES);

static_table!(static CONSTRUCTOR_PROPERTIES = []);

define_constructor!(WeakRefConstructor, CONSTRUCTOR_PROPERTIES, call, construct);

pub(super) fn initialize(cx: &Cx) {
    let prototype = WeakRefPrototype::create(cx, cx.object_prototype().into());
    let parent = cx.function_prototype();
    let constructor = WeakRefConstructor::create(cx, parent, 1, names::WeakRef, &prototype);
    let shape = instance_shape::<JsWeakRef>(cx, prototype);
    cx.global().init_weak_ref_shape(shape);
    cx.global().init_weak_ref_constructor(constructor);
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_called_without_new(cx, "WeakRef"))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = frame.argument(0);
    let Some(target) = target.as_cell().filter(|_| can_be_held_weakly(target)) else {
        let message = "First argument to WeakRef should be an object or a non-registered symbol";
        return Err(cx.throw_type_error(message));
    };
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::weak_ref_shape)?;
    Ok(JsWeakRef::create_with_shape(cx, shape, target).into())
}

#[native_abi]
fn deref(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let reference = this_weak::<JsWeakRef>(cx, frame)?;
    Ok(reference.deref_target(cx).map_or_default(Into::into))
}
