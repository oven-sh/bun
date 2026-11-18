use bun_engine_macros::direct_form;

use super::operand::{Count, Radix};
use super::outcome::{Flat, Same};
use crate::{Cx, Gc, JsBigInt, JsResult, JsString, Vm};

#[direct_form]
fn bigint_itself(_: Gc<JsBigInt>) -> Same<0>;

#[direct_form(pure)]
fn bigint_of_int32(vm: &Vm, x: i32) -> Gc<JsBigInt> {
    JsBigInt::from_small(vm, x)
}

#[direct_form(pure)]
fn bigint_of_int52(vm: &Vm, x: i64) -> Gc<JsBigInt> {
    JsBigInt::from_small(vm, x)
}

#[direct_form(pure)]
fn bigint_of_number(cx: &Cx, x: f64) -> JsResult<Gc<JsBigInt>> {
    JsBigInt::from_number(cx, x)
}

#[direct_form(pure)]
fn bigint_of_string(cx: &Cx, string: Gc<JsString>) -> JsResult<Gc<JsBigInt>> {
    JsBigInt::parse(cx, string.view(cx)?.text())
}

#[direct_form(pure, only_lacks_room)]
fn as_int_n(cx: &Cx, bits: Count, x: Gc<JsBigInt>) -> JsResult<Gc<JsBigInt>> {
    JsBigInt::as_int_n(cx, bits.0 as u64, &x)
}

#[direct_form(pure)]
fn as_uint_n(cx: &Cx, bits: Count, x: Gc<JsBigInt>) -> JsResult<Gc<JsBigInt>> {
    JsBigInt::as_uint_n(cx, bits.0 as u64, &x)
}

#[direct_form(pure, only_lacks_room)]
fn bigint_to_string(cx: &Cx, this: Gc<JsBigInt>, radix: Radix) -> JsResult<Flat> {
    this.to_js_string(cx, radix.get().get()).map(Flat::made_by)
}
