use core::mem::MaybeUninit;

use bun_engine_text::private_names;
use bun_engine_vm::heap::RootStack;
use bun_engine_vm::{
    DontEnumMode, IntegrityLevel, JsFinalObject, PropertyDescriptor, PropertyNameMode, caches,
    errors,
};

use crate::js;
use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::getPrototypeOf, get_prototype_of, 1)
        .with_intrinsic(Intrinsic::ObjectGetPrototypeOf),
    StaticProperty::function(names::setPrototypeOf, set_prototype_of, 2),
    StaticProperty::function(names::getOwnPropertyDescriptor, get_own_property_descriptor, 2),
    StaticProperty::function(names::getOwnPropertyDescriptors, get_own_property_descriptors, 1),
    StaticProperty::function(names::getOwnPropertyNames, get_own_property_names, 1)
        .with_intrinsic(Intrinsic::ObjectGetOwnPropertyNames),
    StaticProperty::function(names::getOwnPropertySymbols, get_own_property_symbols, 1)
        .with_intrinsic(Intrinsic::ObjectGetOwnPropertySymbols),
    StaticProperty::function(names::keys, keys, 1).with_intrinsic(Intrinsic::ObjectKeys),
    StaticProperty::function(names::defineProperty, define_property, 3)
        .with_intrinsic(Intrinsic::ObjectDefineProperty),
    StaticProperty::function(names::defineProperties, define_properties, 2),
    StaticProperty::function(names::create, create, 2).with_intrinsic(Intrinsic::ObjectCreate),
    StaticProperty::function(names::seal, seal, 1),
    StaticProperty::function(names::freeze, freeze, 1),
    StaticProperty::function(names::preventExtensions, prevent_extensions, 1),
    StaticProperty::function(names::isSealed, is_sealed, 1),
    StaticProperty::function(names::isFrozen, is_frozen, 1),
    StaticProperty::function(names::isExtensible, is_extensible, 1),
    StaticProperty::function(names::is, is, 2).with_intrinsic(Intrinsic::ObjectIs),
    StaticProperty::function(names::assign, assign, 2).with_intrinsic(Intrinsic::ObjectAssign),
    StaticProperty::function(names::values, values, 1),
    StaticProperty::function(names::entries, entries, 1),
    StaticProperty::builtin(names::fromEntries, js::object_constructor::fromEntries),
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::position_of(names::prototype),
    StaticProperty::function(names::hasOwn, has_own, 2).with_intrinsic(Intrinsic::ObjectHasOwn),
    StaticProperty::builtin(names::groupBy, js::object_constructor::groupBy),
    StaticProperty::function(private_names::create, create, 2)
        .with_intrinsic(Intrinsic::ObjectCreate),
    StaticProperty::function(private_names::defineProperty, define_property, 3)
        .with_intrinsic(Intrinsic::ObjectDefineProperty),
    StaticProperty::function(private_names::getOwnPropertyDescriptor, get_own_property_descriptor, 2),
    StaticProperty::function(private_names::getOwnPropertyNames, get_own_property_names, 1)
        .with_intrinsic(Intrinsic::ObjectGetOwnPropertyNames),
    StaticProperty::function(private_names::getOwnPropertySymbols, get_own_property_symbols, 1)
        .with_intrinsic(Intrinsic::ObjectGetOwnPropertySymbols),
    StaticProperty::function(private_names::getPrototypeOf, get_prototype_of, 1)
        .with_intrinsic(Intrinsic::ObjectGetPrototypeOf),
    StaticProperty::function(private_names::keys, keys, 1).with_intrinsic(Intrinsic::ObjectKeys),
]);

define_constructor!(ObjectConstructor, PROPERTIES, call, construct);

pub(super) fn initialize(cx: &Cx) {
    let (parent, prototype) = (cx.function_prototype(), cx.object_prototype());
    let constructor = ObjectConstructor::create(cx, parent, 1, names::Object, &prototype);
    cx.global().init_object_constructor(constructor);
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    match frame.argument(0) {
        value if value.is_undefined_or_null() => Ok(cx.new_object().into()),
        value => value.to_object(cx).map(Into::into),
    }
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    if new_target == callee.into() {
        return call(cx, frame);
    }
    let shape = cx.shape_from_new_target(new_target, &callee, |realm, _| realm.object_shape())?;
    Ok(JsFinalObject::create(cx, shape).into())
}

#[native_abi]
fn get_prototype_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    frame.argument(0).get_prototype_of(cx)
}

#[native_abi]
fn set_prototype_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "Cannot set prototype of undefined or null";
    let value = frame.argument(0).require_object_coercible(cx, message)?;
    let prototype = frame.argument(1);
    if !prototype.is_object() && !prototype.is_null() {
        return Err(cx.throw_type_error(errors::PROTOTYPE_NOT_OBJECT_OR_NULL));
    }
    if let Some(object) = value.as_object() {
        object.set_prototype_of(cx, prototype, true)?;
    }
    Ok(value)
}

pub(super) fn describe_own_property(cx: &mut Cx, object: &JsObject, key: Value) -> JsResult<Value> {
    let key = key.to_property_key(cx)?;
    let descriptor = object.get_own_property_descriptor(cx, key.name())?;
    Ok(descriptor.map_or_default(|it| it.to_object(cx).into()))
}

#[native_abi]
fn get_own_property_descriptor(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = frame.argument(0).to_object(cx)?;
    describe_own_property(cx, &object, frame.argument(1))
}

#[native_abi]
fn get_own_property_descriptors(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = frame.argument(0).to_object(cx)?;
    let kinds = PropertyNameMode::StringsAndSymbols;
    let keys = object.snapshot_own_keys(cx, kinds, DontEnumMode::Include)?;
    let capacity = keys.max_len().max(JsFinalObject::DEFAULT_INLINE_CAPACITY);
    let descriptors = JsFinalObject::create(cx, Shape::for_new_object(cx, capacity));
    for key in keys.iter() {
        if let Some(descriptor) = object.get_own_property_descriptor(cx, key)? {
            let descriptor = descriptor.to_object(cx);
            descriptors.put_direct_may_be_index(cx, key, descriptor.into())?;
        }
    }
    Ok(descriptors.into())
}

#[inline(always)]
fn own_keys(
    cx: &mut Cx,
    frame: &CallFrame,
    kinds: PropertyNameMode,
    mode: DontEnumMode,
) -> JsResult<Value> {
    let object = frame.argument(0).to_object(cx)?;
    object.own_keys_array(cx, kinds, mode).map(Into::into)
}

#[native_abi]
fn get_own_property_names(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    own_keys(cx, frame, PropertyNameMode::Strings, DontEnumMode::Include)
}

#[native_abi]
fn get_own_property_symbols(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    own_keys(cx, frame, PropertyNameMode::Symbols, DontEnumMode::Include)
}

#[native_abi]
fn keys(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    own_keys(cx, frame, PropertyNameMode::Strings, DontEnumMode::Exclude)
}

fn object_to_define_on(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<JsObject>> {
    (frame.argument(0).as_object())
        .ok_or_else(|| cx.throw_type_error("Properties can only be defined on Objects."))
}

#[native_abi]
fn define_property(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = object_to_define_on(cx, frame)?;
    let key = frame.argument(1).to_property_key(cx)?;
    let descriptor = PropertyDescriptor::from_value(cx, frame.argument(2))?;
    object.define_property_or_throw(cx, key.name(), &descriptor)?;
    Ok(object.into())
}

/// ObjectDefineProperties
fn define_all(cx: &mut Cx, object: Gc<JsObject>, properties: Value) -> JsResult<Value> {
    let properties = properties.to_object(cx)?;
    let kinds = PropertyNameMode::StringsAndSymbols;
    let keys = properties.snapshot_own_keys(cx, kinds, DontEnumMode::Include)?;
    let mut first_descriptors = [const { MaybeUninit::uninit() }; 8];
    let mut descriptors = RootStack::new(&mut first_descriptors);
    for key in keys.iter() {
        if let Some(description) = properties.get_if_own_and_enumerable(cx, key)? {
            let descriptor = PropertyDescriptor::from_value(cx, description)?;
            cx.or_out_of_memory(descriptors.try_push((key, descriptor)))?;
        }
    }
    for &(key, ref descriptor) in descriptors.iter() {
        object.define_property_or_throw(cx, key, descriptor)?;
    }
    Ok(object.into())
}

#[native_abi]
fn define_properties(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = object_to_define_on(cx, frame)?;
    define_all(cx, object, frame.argument(1))
}

#[native_abi]
fn create(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let prototype = frame.argument(0);
    if !prototype.is_object() && !prototype.is_null() {
        return Err(cx.throw_type_error("Object prototype may only be an Object or null."));
    }
    let object = cx.new_object_with_prototype(prototype.as_object());
    match frame.argument(1) {
        Value::UNDEFINED => Ok(object.into()),
        properties => define_all(cx, object, properties),
    }
}

#[native_abi]
fn seal(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(object) = frame.argument(0).as_object() {
        object.seal_or_throw(cx)?;
    }
    Ok(frame.argument(0))
}

#[native_abi]
fn freeze(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(object) = frame.argument(0).as_object() {
        object.freeze_or_throw(cx)?;
    }
    Ok(frame.argument(0))
}

#[native_abi]
fn prevent_extensions(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(object) = frame.argument(0).as_object()
        && !object.prevent_extensions(cx)?
    {
        let message = "Unable to prevent extension in Object.preventExtensions";
        return Err(cx.throw_type_error(message));
    }
    Ok(frame.argument(0))
}

fn test_integrity(cx: &mut Cx, frame: &CallFrame, level: IntegrityLevel) -> JsResult<Value> {
    match frame.argument(0).as_object() {
        Some(object) => object.test_integrity_level(cx, level).map(Into::into),
        None => Ok(Value::TRUE),
    }
}

#[native_abi]
fn is_sealed(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    test_integrity(cx, frame, IntegrityLevel::Sealed)
}

#[native_abi]
fn is_frozen(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    test_integrity(cx, frame, IntegrityLevel::Frozen)
}

#[native_abi]
fn is_extensible(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    match frame.argument(0).as_object() {
        Some(object) => object.is_extensible(cx).map(Into::into),
        None => Ok(Value::FALSE),
    }
}

#[native_abi]
fn is(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    (frame.argument(0).same_value(cx, frame.argument(1))).map(Into::into)
}

#[native_abi]
fn assign(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "Object.assign requires that input parameter not be null or undefined";
    let target = frame.argument(0).require_object_coercible(cx, message)?;
    let target = target.to_object(cx)?;
    for source in frame.rest(1) {
        if !source.is_undefined_or_null() {
            let source = source.to_object(cx)?;
            target.assign(cx, &source)?;
        }
    }
    Ok(target.into())
}

#[native_abi]
fn values(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "Object.values requires that input parameter not be null or undefined";
    let value = frame.argument(0).require_object_coercible(cx, message)?;
    let object = value.to_object(cx)?;
    object.enumerable_own_values(cx).map(Into::into)
}

#[native_abi]
fn entries(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "Object.entries requires that input parameter not be null or undefined";
    let value = frame.argument(0).require_object_coercible(cx, message)?;
    let object = value.to_object(cx)?;
    object.enumerable_own_entries(cx).map(Into::into)
}

#[native_abi]
fn has_own(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (object, key) = (frame.argument(0), frame.argument(1));
    if let Some(known) = caches::known_own_property(cx, object, key) {
        return Ok(known.into());
    }
    has_own_slow(cx, object, key)
}

#[inline(never)]
fn has_own_slow(cx: &mut Cx, object: Value, key: Value) -> JsResult<Value> {
    let object = object.to_object(cx)?;
    if let Some(index) = key.as_array_index() {
        return object.has_own_index(cx, index).map(Into::into);
    }
    let key = key.to_property_key(cx)?;
    caches::has_own_property(cx, &object, key.name()).map(Into::into)
}
