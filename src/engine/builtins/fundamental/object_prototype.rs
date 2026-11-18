use bun_engine_text::PropertyName;
use bun_engine_vm::{
    Attributes, InternalMethod, JsFinalObject, JsFunction, JsObjectInit, NativeFunction,
    PropertyDescriptor, PropertySlot, RealmSlot, TypeFlags, caches, errors,
};

use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::realm_slot(names::toString, RealmSlot::object_prototype_to_string),
    StaticProperty::function(names::toLocaleString, to_locale_string, 0),
    StaticProperty::realm_slot(names::valueOf, RealmSlot::object_prototype_value_of),
    StaticProperty::realm_slot(names::hasOwnProperty, RealmSlot::object_prototype_has_own_property),
    StaticProperty::function(names::propertyIsEnumerable, property_is_enumerable, 1),
    StaticProperty::function(names::isPrototypeOf, is_prototype_of, 1),
    StaticProperty::function(names::__defineGetter__, define_getter, 2),
    StaticProperty::function(names::__defineSetter__, define_setter, 2),
    StaticProperty::function(names::__lookupGetter__, lookup_getter, 1),
    StaticProperty::function(names::__lookupSetter__, lookup_setter, 1),
    StaticProperty::proto_accessor(get_proto, set_proto).with_intrinsic(Intrinsic::UnderscoreProto),
    StaticProperty::realm_slot(names::constructor, RealmSlot::object_constructor),
]);

#[cell(name = "Object", static_table = PROPERTIES,
    flags = TypeFlags::IS_IMMUTABLE_PROTOTYPE_EXOTIC_OBJECT)]
struct ObjectPrototype {
    base: JsObject,
}

pub(crate) fn initialize(cx: &Cx) {
    let (global, spec) = (cx.global(), ShapeSpec::of::<ObjectPrototype>());
    let shape = Shape::create(cx, Some(global), Value::NULL, spec);
    let base = JsObjectInit::new(cx, shape);
    let prototype = cx.allocate::<ObjectPrototype>(ObjectPrototypeInit { base });
    let capacity = JsFinalObject::DEFAULT_INLINE_CAPACITY;
    let shape = |prototype| JsFinalObject::create_shape(cx, global, prototype, capacity);
    global.init_object_prototype(prototype.upcast());
    global.init_object_shape(shape(prototype.into()));
    global.init_null_prototype_object_shape(shape(Value::NULL));
}

fn method(
    cx: &Cx,
    name: PropertyName<'_>,
    length: u32,
    function: NativeFunction,
    intrinsic: Intrinsic,
) -> Gc<JsFunction> {
    let name = name.to_identifier().into_string();
    JsFunction::native_with_intrinsic(cx, length, &name, function, intrinsic)
}

pub(super) fn initialize_to_string(cx: &Cx) {
    let function = method(cx, names::toString, 0, to_string, Intrinsic::ObjectToString);
    cx.global().init_object_prototype_to_string(function);
}

pub(super) fn initialize_value_of(cx: &Cx) {
    let function = method(cx, names::valueOf, 0, value_of, Intrinsic::None);
    cx.global().init_object_prototype_value_of(function);
}

pub(super) fn initialize_has_own_property(cx: &Cx) {
    let (name, intrinsic) = (names::hasOwnProperty, Intrinsic::HasOwnProperty);
    let function = method(cx, name, 1, has_own_property, intrinsic);
    cx.global().init_object_prototype_has_own_property(function);
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    frame.this_value().to_tagged_string(cx).map(Into::into)
}

#[native_abi]
fn to_locale_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = frame.this_value();
    match this.get(cx, names::toString)? {
        method if method.is_callable() => cx.call(method, this, &[]),
        _ => Err(cx.throw_type_error(errors::TYPE_ERROR)),
    }
}

#[native_abi]
fn value_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    frame.this_value().to_object(cx).map(Into::into)
}

#[native_abi]
fn has_own_property(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, key) = (frame.this_value(), frame.argument(0));
    if let Some(known) = caches::known_own_property(cx, this, key) {
        return Ok(known.into());
    }
    has_own_property_slow(cx, this, key)
}

#[inline(never)]
fn has_own_property_slow(cx: &mut Cx, this: Value, key: Value) -> JsResult<Value> {
    if let Some(index) = key.as_array_index() {
        return this.to_object(cx)?.has_own_index(cx, index).map(Into::into);
    }
    let key = key.to_property_key(cx)?;
    let object = this.to_object(cx)?;
    caches::has_own_property(cx, &object, key.name()).map(Into::into)
}

#[native_abi]
fn property_is_enumerable(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let key = frame.argument(0).to_property_key(cx)?;
    let object = frame.this_value().to_object(cx)?;
    let mut slot = PropertySlot::new(object.into(), InternalMethod::GetOwnProperty);
    let found = object.get_own_property_slot(cx, key.name(), &mut slot)?;
    Ok((found && slot.attributes().is_enumerable()).into())
}

#[native_abi]
fn is_prototype_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let value = frame.argument(0);
    if !value.is_object() {
        return Ok(Value::FALSE);
    }
    let this = frame.this_value().to_object(cx)?;
    JsObject::default_has_instance(cx, value, this.into()).map(Into::into)
}

fn define_accessor(
    cx: &mut Cx,
    frame: &CallFrame,
    set_function: fn(&mut PropertyDescriptor, Value),
    message: &'static str,
) -> JsResult<Value> {
    let object = frame.this_value().to_object(cx)?;
    let function = frame.argument(1);
    if !function.is_callable() {
        return Err(cx.throw_type_error(message));
    }
    let key = frame.argument(0).to_property_key(cx)?;
    let mut descriptor = PropertyDescriptor::default();
    set_function(&mut descriptor, function);
    descriptor.set_enumerable(true);
    descriptor.set_configurable(true);
    object.define_property_or_throw(cx, key.name(), &descriptor)?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn define_getter(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let set = PropertyDescriptor::set_getter;
    define_accessor(cx, frame, set, "invalid getter usage")
}

#[native_abi]
fn define_setter(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let set = PropertyDescriptor::set_setter;
    define_accessor(cx, frame, set, "invalid setter usage")
}

/// An empty descriptor unless the property is an accessor.
fn lookup_accessor(cx: &mut Cx, frame: &CallFrame) -> JsResult<PropertyDescriptor> {
    let object = frame.this_value().to_object(cx)?;
    let key = frame.argument(0).to_property_key(cx)?;
    let mut slot = PropertySlot::new(object.into(), InternalMethod::GetOwnProperty);
    if object.get_property_slot(cx, key.name(), &mut slot)?
        && (slot.attributes()).intersects(Attributes::ACCESSOR | Attributes::CUSTOM_ACCESSOR)
    {
        return PropertyDescriptor::from_slot(cx, key.name(), &slot);
    }
    Ok(PropertyDescriptor::default())
}

#[native_abi]
fn lookup_getter(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(lookup_accessor(cx, frame)?.getter().unwrap_or_default())
}

#[native_abi]
fn lookup_setter(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(lookup_accessor(cx, frame)?.setter().unwrap_or_default())
}

#[native_abi]
fn get_proto(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    frame.this_value().get_prototype_of(cx)
}

#[native_abi]
fn set_proto(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "Object.prototype.__proto__ called on null or undefined";
    let this = frame.this_value().require_object_coercible(cx, message)?;
    let prototype = frame.argument(0);
    if let Some(object) = this.as_object()
        && (prototype.is_object() || prototype.is_null())
    {
        object.set_prototype_of(cx, prototype, true)?;
    }
    Ok(Value::UNDEFINED)
}
