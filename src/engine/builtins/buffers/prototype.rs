use bun_engine_vm::{
    IterationKind, JsArrayIterator, JsFunction, JsTypedArray, RealmSlot, Thrown, with_bits_type,
};

use super::{copy, join, relative_index, search, sort};
use crate::js::typed_array_prototype as js;
use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::realm_slot(names::toString, RealmSlot::array_prototype_to_string),
    StaticProperty::getter(names::buffer, buffer),
    StaticProperty::getter(names::byteLength, byte_length).with_intrinsic(Intrinsic::TypedArrayByteLength),
    StaticProperty::getter(names::byteOffset, byte_offset).with_intrinsic(Intrinsic::TypedArrayByteOffset),
    StaticProperty::function(names::copyWithin, copy::copy_within, 2),
    StaticProperty::function(names::sort, sort::sort, 1),
    StaticProperty::builtin(names::every, js::every),
    StaticProperty::builtin(names::filter, js::filter),
    StaticProperty::function(names::entries, entries, 0).with_intrinsic(Intrinsic::TypedArrayEntries),
    StaticProperty::function(names::includes, search::includes, 1),
    StaticProperty::function(names::fill, fill, 1),
    StaticProperty::builtin(names::find, js::find),
    StaticProperty::builtin(names::findLast, js::findLast),
    StaticProperty::builtin(names::findIndex, js::findIndex),
    StaticProperty::builtin(names::findLastIndex, js::findLastIndex),
    StaticProperty::builtin(names::forEach, js::forEach),
    StaticProperty::function(names::indexOf, search::index_of, 1),
    StaticProperty::function(names::join, join::join, 1),
    StaticProperty::function(names::keys, keys, 0).with_intrinsic(Intrinsic::TypedArrayKeys),
    StaticProperty::function(names::lastIndexOf, search::last_index_of, 1),
    StaticProperty::getter(names::length, length).with_intrinsic(Intrinsic::TypedArrayLength),
    StaticProperty::builtin(names::map, js::map),
    StaticProperty::builtin(names::reduce, js::reduce),
    StaticProperty::builtin(names::reduceRight, js::reduceRight),
    StaticProperty::function(names::reverse, reverse, 0),
    StaticProperty::function(names::set, copy::set, 1).with_intrinsic(Intrinsic::TypedArraySet),
    StaticProperty::function(names::slice, copy::slice, 2),
    StaticProperty::builtin(names::some, js::some),
    StaticProperty::function(names::subarray, copy::subarray, 2),
    StaticProperty::builtin(names::toLocaleString, js::toLocaleString),
    StaticProperty::function(names::toReversed, copy::to_reversed, 0),
    StaticProperty::function(names::toSorted, sort::to_sorted, 1),
    StaticProperty::function(names::with, copy::with, 2),
    StaticProperty::function(names::at, at, 1),
    StaticProperty::realm_slot(names::values, RealmSlot::typed_array_prototype_values),
    StaticProperty::getter(symbols::toStringTag, to_string_tag),
    StaticProperty::realm_slot(symbols::iterator, RealmSlot::typed_array_prototype_values),
]);

define_object!(TypedArrayPrototype, "Prototype", PROPERTIES);

pub(super) fn initialize_values(cx: &Cx) {
    let name = names::values.to_identifier().into_string();
    let intrinsic = Intrinsic::TypedArrayValues;
    let function = JsFunction::native_with_intrinsic(cx, 0, &name, values, intrinsic);
    cx.global().init_typed_array_prototype_values(function);
}

const NOT_A_TYPED_ARRAY: &str = "Receiver should be a typed array view";

#[cold]
fn throw_not_a_typed_array(cx: &Cx, this: Value) -> Thrown {
    cx.throw_type_error(if this.is_object() {
        NOT_A_TYPED_ARRAY
    } else {
        "Receiver should be a typed array view but was not an object"
    })
}

/// RequireInternalSlot(this value, [[TypedArrayName]])
#[inline(always)]
pub(super) fn this_array(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<JsTypedArray>> {
    let this = frame.this_value();
    this.downcast()
        .ok_or_else(|| throw_not_a_typed_array(cx, this))
}

/// ValidateTypedArray(this value), and the length.
#[inline(always)]
pub(super) fn valid_this(cx: &Cx, frame: &CallFrame) -> JsResult<(Gc<JsTypedArray>, usize)> {
    let this = this_array(cx, frame)?;
    Ok((this, this.validate(cx)?))
}

/// The same for any value, with one message for all that is no typed array.
#[inline(always)]
pub(super) fn valid_receiver(cx: &Cx, value: Value) -> JsResult<(Gc<JsTypedArray>, usize)> {
    match value.downcast::<JsTypedArray>() {
        Some(array) => Ok((array, array.validate(cx)?)),
        None => Err(cx.throw_type_error(NOT_A_TYPED_ARRAY)),
    }
}

#[native_abi]
fn buffer(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_array(cx, frame)?.js_buffer(cx).map(Into::into)
}

#[native_abi]
fn byte_length(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(this_array(cx, frame)?.byte_length().into())
}

#[native_abi]
fn byte_offset(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(this_array(cx, frame)?.byte_offset().into())
}

#[native_abi]
fn length(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(this_array(cx, frame)?.length().into())
}

#[native_abi]
fn to_string_tag(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = frame.this_value().downcast::<JsTypedArray>();
    Ok(this.map_or_default(|it| JsString::from_name(cx, it.element_type().name()).into()))
}

fn create_iterator(cx: &Cx, frame: &CallFrame, kind: IterationKind) -> JsResult<Value> {
    let (this, _) = valid_receiver(cx, frame.this_value())?;
    Ok(JsArrayIterator::create(cx, this.upcast(), kind).into())
}

#[native_abi]
fn keys(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    create_iterator(cx, frame, IterationKind::Keys)
}

#[native_abi]
fn values(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    create_iterator(cx, frame, IterationKind::Values)
}

#[native_abi]
fn entries(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    create_iterator(cx, frame, IterationKind::Entries)
}

#[native_abi]
fn at(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, length) = valid_receiver(cx, frame.this_value())?;
    let mut index = frame.argument(0).to_integer_or_infinity(cx)?;
    if index < 0.0 {
        index += length as f64;
    }
    if !(0.0..length as f64).contains(&index) {
        return Ok(Value::UNDEFINED);
    }
    Ok(this.get_element(cx, index as usize).unwrap_or_default())
}

#[native_abi]
fn fill(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, length) = valid_this(cx, frame)?;
    let bits = (this.element_type()).bits_from_value(cx, frame.argument(0))?;
    let start = relative_index(cx, frame.argument(1), length, 0)?;
    let end = relative_index(cx, frame.argument(2), length, length)?;
    this.validate(cx)?;
    with_bits_type!(this.element_type(), K => {
        this.bytes(&cx.no_gc()).cast().clamped(start..end).fill(bits as K);
    });
    Ok(this.into())
}

#[native_abi]
fn reverse(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, _) = valid_this(cx, frame)?;
    with_bits_type!(this.element_type(), K => this.bytes(&cx.no_gc()).cast::<K>().reverse());
    Ok(this.into())
}
