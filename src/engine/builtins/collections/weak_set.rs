use bun_engine_vm::{
    GlobalObject, JsCell, JsWeakSet, can_be_held_weakly, errors, for_each_in_iterable,
};

use super::{get_adder, instance_shape, realm_if_native, this_weak};
use crate::prelude::*;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::delete, delete, 1),
    StaticProperty::function(names::has, has, 1).with_intrinsic(Intrinsic::WeakSetHas),
    StaticProperty::function(names::add, add, 1).with_intrinsic(Intrinsic::WeakSetAdd),
    StaticProperty::string(symbols::toStringTag, names::WeakSet),
]);

define_object!(WeakSetPrototype, "WeakSet", PROTOTYPE_PROPERTIES);

static_table!(static CONSTRUCTOR_PROPERTIES = []);

define_constructor!(WeakSetConstructor, CONSTRUCTOR_PROPERTIES, call, construct);

pub(super) fn initialize(cx: &Cx) {
    let prototype = WeakSetPrototype::create(cx, cx.object_prototype().into());
    let parent = cx.function_prototype();
    let constructor = WeakSetConstructor::create(cx, parent, 0, names::WeakSet, &prototype);
    let shape = instance_shape::<JsWeakSet>(cx, prototype);
    cx.global().init_weak_set_shape(shape);
    cx.global().init_weak_set_constructor(constructor);
}

#[inline(always)]
fn to_key(cx: &Cx, value: Value) -> JsResult<Gc<JsCell>> {
    match value.as_cell() {
        Some(cell) if can_be_held_weakly(value) => Ok(cell),
        _ => Err(cx.throw_type_error("WeakSet values must be objects or non-registered symbols")),
    }
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_called_without_new(cx, "WeakSet"))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::weak_set_shape)?;
    let (set, iterable) = (JsWeakSet::create_with_shape(cx, shape), frame.argument(0));
    if iterable.is_undefined_or_null() {
        return Ok(set.into());
    }
    let message = "'add' property of a WeakSet should be callable.";
    let adder = get_adder(cx, &set, names::add, message)?;
    let realm_of_original = realm_if_native(adder, add);
    for_each_in_iterable(cx, iterable, |cx, value| match realm_of_original {
        Some(realm) => {
            let key = to_key(cx.in_realm_shared(realm), value)?;
            cx.or_out_of_memory(set.add(key))
        }
        None => cx.call(adder.into(), set.into(), &[value]).map(|_| ()),
    })?;
    Ok(set.into())
}

#[native_abi]
fn delete(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (set, key) = (this_weak::<JsWeakSet>(cx, frame)?, frame.argument(0));
    Ok(key.as_cell().is_some_and(|key| set.remove(key)).into())
}

#[native_abi]
fn has(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (set, key) = (this_weak::<JsWeakSet>(cx, frame)?, frame.argument(0));
    Ok(key.as_cell().is_some_and(|key| set.has(key)).into())
}

#[native_abi]
fn add(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let set = this_weak::<JsWeakSet>(cx, frame)?;
    let key = to_key(cx, frame.argument(0))?;
    cx.or_out_of_memory(set.add(key))?;
    Ok(set.into())
}
