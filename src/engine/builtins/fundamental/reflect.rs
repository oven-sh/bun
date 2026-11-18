use bun_engine_vm::{
    DontEnumMode, JsFunction, PropertyDescriptor, PropertyNameMode, PutContext, PutPropertySlot,
    RealmSlot, arguments_from_array_like,
};

use super::object_constructor::describe_own_property;
use crate::js;
use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::builtin(names::apply, js::reflect::apply),
    StaticProperty::realm_slot(names::construct, RealmSlot::reflect_construct),
    StaticProperty::function(names::defineProperty, define_property, 3),
    StaticProperty::function(names::deleteProperty, delete_property, 2),
    StaticProperty::builtin(names::get, js::reflect::get),
    StaticProperty::function(names::getOwnPropertyDescriptor, get_own_property_descriptor, 2),
    StaticProperty::function(names::getPrototypeOf, get_prototype_of, 1)
        .with_intrinsic(Intrinsic::ReflectGetPrototypeOf),
    StaticProperty::builtin(names::has, js::reflect::has),
    StaticProperty::function(names::isExtensible, is_extensible, 1),
    StaticProperty::function(names::ownKeys, own_keys, 1).with_intrinsic(Intrinsic::ReflectOwnKeys),
    StaticProperty::function(names::preventExtensions, prevent_extensions, 1),
    StaticProperty::function(names::set, set, 3),
    StaticProperty::function(names::setPrototypeOf, set_prototype_of, 2),
    StaticProperty::string(symbols::toStringTag, names::Reflect),
]);

define_object!(ReflectObject, "Reflect", PROPERTIES);

pub(super) fn initialize(cx: &Cx) {
    let object = ReflectObject::create(cx, cx.object_prototype().into());
    cx.global().init_reflect_object(object);
}

pub(super) fn initialize_construct(cx: &Cx) {
    let name = names::construct.to_identifier().into_string();
    let function = JsFunction::native(cx, 2, &name, construct);
    cx.global().init_reflect_construct(function);
}

#[inline]
fn target(cx: &Cx, frame: &CallFrame, function: &str) -> JsResult<Gc<JsObject>> {
    frame.argument(0).as_object().ok_or_else(|| {
        cx.throw_type_error(format_args!(
            "Reflect.{function} requires the first argument be an object"
        ))
    })
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = frame.argument(0);
    if !target.is_constructor() {
        let message = "Reflect.construct requires the first argument be a constructor";
        return Err(cx.throw_type_error(message));
    }
    let new_target = frame.arguments().get(2).copied().unwrap_or(target);
    if !new_target.is_constructor() {
        let message = "Reflect.construct requires the third argument be a constructor if present";
        return Err(cx.throw_type_error(message));
    }
    let Some(list) = frame.argument(1).as_object() else {
        let message = "Reflect.construct requires the second argument be an object";
        return Err(cx.throw_type_error(message));
    };
    let arguments = arguments_from_array_like(cx, &list)?;
    cx.construct(target, &arguments, new_target).map(Into::into)
}

#[native_abi]
fn define_property(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = target(cx, frame, "defineProperty")?;
    let key = frame.argument(1).to_property_key(cx)?;
    let descriptor = PropertyDescriptor::from_value(cx, frame.argument(2))?;
    (target.define_own_property(cx, key.name(), &descriptor, false)).map(Into::into)
}

#[native_abi]
fn delete_property(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = target(cx, frame, "deleteProperty")?;
    let key = frame.argument(1).to_property_key(cx)?;
    target.delete(cx, key.name()).map(Into::into)
}

#[native_abi]
fn get_own_property_descriptor(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = target(cx, frame, "getOwnPropertyDescriptor")?;
    describe_own_property(cx, &target, frame.argument(1))
}

#[native_abi]
fn get_prototype_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    target(cx, frame, "getPrototypeOf")?.get_prototype_of(cx)
}

#[native_abi]
fn is_extensible(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = target(cx, frame, "isExtensible")?;
    target.is_extensible(cx).map(Into::into)
}

#[native_abi]
fn own_keys(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = target(cx, frame, "ownKeys")?;
    let kinds = PropertyNameMode::StringsAndSymbols;
    (target.own_keys_array(cx, kinds, DontEnumMode::Include)).map(Into::into)
}

#[native_abi]
fn prevent_extensions(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = target(cx, frame, "preventExtensions")?;
    target.prevent_extensions(cx).map(Into::into)
}

#[native_abi]
fn set(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = target(cx, frame, "set")?;
    let key = frame.argument(1).to_property_key(cx)?;
    let receiver = (frame.arguments().get(3).copied()).unwrap_or_else(|| target.into());
    let mut slot = PutPropertySlot::with_context(receiver, false, PutContext::ReflectSet);
    (target.put(cx, key.name(), frame.argument(2), &mut slot)).map(Into::into)
}

#[native_abi]
fn set_prototype_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = target(cx, frame, "setPrototypeOf")?;
    let prototype = frame.argument(1);
    if !prototype.is_object() && !prototype.is_null() {
        return Err(cx.throw_type_error(
            "Reflect.setPrototypeOf requires the second argument be either an object or null",
        ));
    }
    (target.set_prototype_of(cx, prototype, false)).map(Into::into)
}
