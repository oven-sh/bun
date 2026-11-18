//! `String` as a function and as a constructor.

use bun_engine_macros::direct_form;

use super::operand::{Original, Primitive};
use super::outcome::{Flat, Same};
use crate::{Cx, Gc, JsResult, JsString, JsSymbol, StringObject, Vm};

#[direct_form]
fn string_itself(_: Gc<JsString>) -> Same<0>;

#[direct_form(pure)]
fn string_of_int32(vm: &Vm, x: i32) -> Flat {
    Flat::made_by(JsString::from_int32(vm, x))
}

#[direct_form(pure)]
fn string_of_number(vm: &Vm, x: f64) -> Flat {
    Flat::made_by(JsString::from_number(vm, x))
}

#[direct_form(pure, only_lacks_room)]
fn string_of_primitive(cx: &Cx, x: Primitive) -> JsResult<Gc<JsString>> {
    x.0.primitive_to_string(cx)
}

#[direct_form(pure, only_lacks_room)]
fn string_of_symbol(cx: &Cx, x: Gc<JsSymbol>) -> JsResult<Flat> {
    x.to_descriptive_string(cx).map(Flat::made_by)
}

#[direct_form(pure, needs(StringSymbolToPrimitive, StringToString))]
fn string_of_string_object(x: Original<StringObject>) -> Gc<JsString> {
    x.0.string()
}

#[direct_form(pure, makes(string_object_shape), gives_new)]
fn new_string_object(cx: &Cx, string: Gc<JsString>) -> Gc<StringObject> {
    StringObject::create(cx, cx.string_object_shape(), string)
}
