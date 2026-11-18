use bun_engine_macros::export;
use bun_engine_number::Radix;
use bun_engine_text::{Atom, Identifier, PropertyName, StringBuilder, StringRef, Text};
use bun_engine_vm::{
    AsciiLiteral, Cx, Gc, JsArray, JsObject, JsResult, JsString, PreferredType, PropertySlot,
    PutPropertySlot, Value, Vm, errors,
};

use crate::abi::or_undefined;

#[export]
fn value_is_callable(value: Value) -> bool {
    value.is_callable()
}

#[export]
fn value_is_constructor(value: Value) -> bool {
    value.is_constructor()
}

#[export]
fn value_to_primitive(value: Value, cx: &mut Cx, preferred: PreferredType) -> JsResult<Value> {
    value.to_primitive(cx, preferred)
}

#[export]
fn value_to_number(value: Value, cx: &mut Cx) -> JsResult<f64> {
    value.to_number(cx)
}

#[export]
fn value_to_numeric(value: Value, cx: &mut Cx) -> JsResult<Value> {
    value.to_numeric(cx).map(Into::into)
}

#[export]
fn value_to_bigint64(value: Value, cx: &mut Cx) -> JsResult<i64> {
    value.to_bigint64(cx)
}

#[export]
fn value_to_string(value: Value, cx: &mut Cx) -> JsResult<Gc<JsString>> {
    value.to_string(cx)
}

#[export]
fn value_to_string_or_empty(value: Value, cx: &mut Cx) -> JsResult<Gc<JsString>> {
    Ok((value.to_string(cx)).unwrap_or_else(|_| cx.small_strings.empty()))
}

#[export]
fn value_to_string_ref(value: Value, cx: &mut Cx) -> JsResult<StringRef> {
    value.to_string_ref(cx)
}

#[export]
fn value_to_string_for_console(value: Value, cx: &mut Cx) -> JsResult<Option<StringRef>> {
    let (before, after) = if value.is_string() {
        ("\"", "\"")
    } else if value.is::<JsArray>() {
        ("[", "]")
    } else if value.is_bigint() {
        ("", "n")
    } else {
        return value.to_string_ref(cx).map(Some);
    };
    let mut text = StringBuilder::new();
    text.push_ascii(before);
    text.push_text(value.to_string_view(cx)?.text());
    text.push_ascii(after);
    Ok(text.finish().ok())
}

#[export]
fn value_to_property_key(value: Value, cx: &mut Cx) -> JsResult<Identifier> {
    Ok((value.to_property_key(cx)).map_or_else(|_| Atom::empty().into(), |it| it.to_identifier()))
}

#[export]
fn value_to_object(value: Value, cx: &Cx) -> JsResult<Gc<JsObject>> {
    value.to_object(cx)
}

#[export]
fn value_to_sloppy_this(value: Value, cx: &Cx) -> Value {
    value.to_sloppy_this(cx).into()
}

#[export]
fn value_type_of(value: Value, cx: &Cx) -> Gc<JsString> {
    value.type_of(cx)
}

#[export]
fn value_get(value: Value, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Value> {
    or_undefined(value.get(cx, name))
}

#[export]
fn value_get_index(value: Value, cx: &mut Cx, index: u32) -> JsResult<Value> {
    or_undefined(value.get_index(cx, index))
}

#[export]
fn value_get_own_property_slot(
    value: Value,
    cx: &mut Cx,
    name: PropertyName<'_>,
    slot: &mut PropertySlot,
) -> JsResult<bool> {
    if let Some(object) = value.as_object() {
        object.get_own_property_slot(cx, name, slot)
    } else if let Some(string) = value.as_string() {
        string.get_string_property_slot(cx, name, slot)
    } else if value.is_undefined_or_null() {
        Err(errors::throw_not_an_object(cx, value))
    } else {
        Ok(false)
    }
}

#[export]
fn value_put(
    target: Value,
    cx: &mut Cx,
    name: PropertyName<'_>,
    value: Value,
    slot: &mut PutPropertySlot,
) -> JsResult<bool> {
    target.put(cx, name, value, slot)
}

#[export]
fn value_get_prototype_of(value: Value, cx: &mut Cx) -> JsResult<Value> {
    value.get_prototype_of(cx)
}

#[export]
fn value_loose_equals(a: Value, cx: &mut Cx, b: Value) -> JsResult<bool> {
    a.loose_equals(cx, b)
}

#[export]
fn value_add(cx: &mut Cx, a: Value, b: Value) -> JsResult<Value> {
    bun_engine_vm::arithmetic::add(cx, a, b)
}

#[export]
fn value_from_name(vm: &Vm, name: PropertyName<'_>) -> Value {
    Value::from_name(vm, name)
}

#[export]
fn identifier_from_literal(literal: AsciiLiteral) -> Identifier {
    Identifier::from_literal(literal.as_str())
}

#[export]
fn identifier_from_index(index: u32) -> Identifier {
    Identifier::from_index(index)
}

#[export]
fn is_canonical_numeric_index(text: Text<'_>) -> bool {
    bun_engine_number::canonical_numeric_index(text).is_some()
}

#[export]
fn is_str_white_space(character: u32) -> bool {
    bun_engine_unicode::is_str_white_space(character)
}

#[export]
fn text_to_number(text: Text<'_>) -> f64 {
    bun_engine_number::string_to_number(text)
}

#[export]
fn number_to_string(vm: &Vm, number: f64, radix: i32) -> Gc<JsString> {
    JsString::from_number_in_radix(vm, number, Radix::new(radix).expect("from 2 to 36"))
}

#[export]
fn number_to_int32(number: f64) -> i32 {
    bun_engine_number::to_int32(number)
}

#[export]
fn number_to_uint64(number: f64) -> u64 {
    bun_engine_number::to_uint64(number)
}

#[export]
fn number_pow(base: f64, exponent: f64) -> f64 {
    bun_engine_number::math::pow(base, exponent)
}

#[export]
fn value_describe(value: Value) -> StringRef {
    value.describe()
}
