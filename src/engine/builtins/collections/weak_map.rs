use bun_engine_vm::{
    GlobalObject, JsCell, JsWeakMap, can_be_held_weakly, errors, for_each_in_iterable,
};

use super::{get_adder, instance_shape, key_and_value, realm_if_native, this_weak};
use crate::prelude::*;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::delete, delete, 1),
    StaticProperty::function(names::get, get, 1).with_intrinsic(Intrinsic::WeakMapGet),
    StaticProperty::function(names::has, has, 1).with_intrinsic(Intrinsic::WeakMapHas),
    StaticProperty::function(names::set, set, 2).with_intrinsic(Intrinsic::WeakMapSet),
    StaticProperty::function(names::getOrInsert, get_or_insert, 2),
    StaticProperty::function(names::getOrInsertComputed, get_or_insert_computed, 2),
    StaticProperty::string(symbols::toStringTag, names::WeakMap),
]);

define_object!(WeakMapPrototype, "WeakMap", PROTOTYPE_PROPERTIES);

static_table!(static CONSTRUCTOR_PROPERTIES = []);

define_constructor!(WeakMapConstructor, CONSTRUCTOR_PROPERTIES, call, construct);

pub(super) fn initialize(cx: &Cx) {
    let prototype = WeakMapPrototype::create(cx, cx.object_prototype().into());
    let parent = cx.function_prototype();
    let constructor = WeakMapConstructor::create(cx, parent, 0, names::WeakMap, &prototype);
    let shape = instance_shape::<JsWeakMap>(cx, prototype);
    cx.global().init_weak_map_shape(shape);
    cx.global().init_weak_map_constructor(constructor);
}

#[inline(always)]
fn to_key(cx: &Cx, key: Value) -> JsResult<Gc<JsCell>> {
    match key.as_cell() {
        Some(cell) if can_be_held_weakly(key) => Ok(cell),
        _ => Err(cx.throw_type_error("WeakMap keys must be objects or non-registered symbols")),
    }
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_called_without_new(cx, "WeakMap"))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::weak_map_shape)?;
    let (map, iterable) = (JsWeakMap::create_with_shape(cx, shape), frame.argument(0));
    if iterable.is_undefined_or_null() {
        return Ok(map.into());
    }
    let message = "'set' property of a WeakMap should be callable.";
    let adder = get_adder(cx, &map, names::set, message)?;
    let realm_of_original = realm_if_native(adder, set);
    for_each_in_iterable(cx, iterable, |cx, entry| {
        let message = "WeakMap requires that an entry be an Object.";
        let (key, value) = key_and_value(cx, entry, message)?;
        match realm_of_original {
            Some(realm) => {
                let key = to_key(cx.in_realm_shared(realm), key)?;
                cx.or_out_of_memory(map.set(key, value))
            }
            None => cx.call(adder.into(), map.into(), &[key, value]).map(|_| ()),
        }
    })?;
    Ok(map.into())
}

#[native_abi]
fn delete(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (map, key) = (this_weak::<JsWeakMap>(cx, frame)?, frame.argument(0));
    Ok(key.as_cell().is_some_and(|key| map.remove(key)).into())
}

#[native_abi]
fn get(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (map, key) = (this_weak::<JsWeakMap>(cx, frame)?, frame.argument(0));
    Ok(key.as_cell().map_or_default(|key| map.get(key)))
}

#[native_abi]
fn has(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (map, key) = (this_weak::<JsWeakMap>(cx, frame)?, frame.argument(0));
    Ok(key.as_cell().is_some_and(|key| map.has(key)).into())
}

#[native_abi]
fn set(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let map = this_weak::<JsWeakMap>(cx, frame)?;
    let key = to_key(cx, frame.argument(0))?;
    cx.or_out_of_memory(map.set(key, frame.argument(1)))?;
    Ok(map.into())
}

#[native_abi]
fn get_or_insert(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let map = this_weak::<JsWeakMap>(cx, frame)?;
    let key = to_key(cx, frame.argument(0))?;
    cx.or_out_of_memory(map.get_or_insert(key, frame.argument(1)))
}

#[native_abi]
fn get_or_insert_computed(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let map = this_weak::<JsWeakMap>(cx, frame)?;
    let (key, callback) = (to_key(cx, frame.argument(0))?, frame.argument(1));
    if !callback.is_callable() {
        let message =
            "WeakMap.prototype.getOrInsertComputed requires the callback argument to be callable.";
        return Err(cx.throw_type_error(message));
    }
    if let Some(existing) = map.find(key) {
        return Ok(existing);
    }
    let value = cx.call(callback, Value::UNDEFINED, &[key.into()])?;
    cx.or_out_of_memory(map.set(key, value))?;
    Ok(value)
}
