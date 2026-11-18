use bun_engine_macros::direct_form;
use bun_engine_number::{FormatError, NumberText};
use bun_engine_text::{StringImpl, Text};

use super::operand::{
    FractionDigits, NumberLike, Original, ParseRadix, Precision, Primitive, Radix, Ten, ToNumber,
};
use super::outcome::{Always, Flat, Number, Ranged, Real, Same, Time};
use crate::{Cx, DateInstance, Gc, JsBigInt, JsResult, JsString, Value, Vm};

#[direct_form]
fn true_of_int32(_: i32) -> Always<true>;

#[direct_form]
fn false_of_int32(_: i32) -> Always<false>;

macro_rules! predicates {
    ($($of_number:ident, $of_value:ident = $test:path, $of_int32:literal;)*) => {$(
        #[direct_form(pure)]
        fn $of_number(x: f64) -> bool {
            $test(x)
        }

        #[direct_form(pure)]
        pub fn $of_value(x: Value) -> bool {
            ($of_int32 && x.is_int32()) || x.as_double().is_some_and($test)
        }
    )*};
}

predicates! {
    number_is_finite, value_is_finite = f64::is_finite, true;
    number_is_nan, value_is_nan = f64::is_nan, false;
    number_is_integer, value_is_integer = bun_engine_number::is_integer, true;
    number_is_safe_integer, value_is_safe_integer = bun_engine_number::is_safe_integer, true;
}

macro_rules! converting_predicates {
    ($($of_number:ident, $of_primitive:ident = $test:path;)*) => {$(
        #[direct_form(pure)]
        fn $of_number(x: ToNumber) -> bool {
            $test(x.0)
        }

        #[direct_form(pure, only_lacks_room)]
        fn $of_primitive(cx: &Cx, x: NumberLike) -> JsResult<bool> {
            x.0.primitive_to_number(cx).map($test)
        }
    )*};
}

converting_predicates! {
    is_finite_of_number, is_finite_of_primitive = f64::is_finite;
    is_nan_of_number, is_nan_of_primitive = f64::is_nan;
}

#[direct_form]
fn parse_int_of_int32(_: i32, _: Ten) -> Same<0>;

#[direct_form(pure)]
pub fn parse_int_of_number(x: f64, radix: ParseRadix) -> Number {
    let without_text = matches!(radix.0, 0 | 10).then(|| bun_engine_number::parse_int_of_number(x));
    (without_text.flatten())
        .unwrap_or_else(|| bun_engine_number::parse_int(NumberText::from(x).text(), radix.0))
        .into()
}

#[direct_form(pure)]
fn parse_int_of_characters(string: &StringImpl, radix: ParseRadix) -> Number {
    bun_engine_number::parse_int(string.text(), radix.0).into()
}

#[direct_form(pure, only_lacks_room)]
fn parse_int_of_string(cx: &Cx, string: Gc<JsString>, radix: ParseRadix) -> JsResult<Number> {
    string.parse_int(cx, radix.0).map(Into::into)
}

#[direct_form(pure, only_lacks_room)]
fn parse_int_of_primitive(cx: &Cx, x: Primitive, radix: ParseRadix) -> JsResult<Number> {
    match x.0.as_number() {
        Some(number) => Ok(parse_int_of_number(number, radix)),
        None => parse_int_of_string(cx, x.0.primitive_to_string(cx)?, radix),
    }
}

#[direct_form(pure)]
pub fn parse_float_of_number(x: f64) -> f64 {
    x + 0.0
}

#[direct_form(pure)]
fn parse_float_of_characters(string: &StringImpl) -> f64 {
    bun_engine_number::parse_float(string.text())
}

#[direct_form(pure, only_lacks_room)]
pub fn parse_float_of_string(cx: &Cx, string: Gc<JsString>) -> JsResult<Number> {
    Ok(bun_engine_number::parse_float(string.view(cx)?.text()).into())
}

#[direct_form(pure, only_lacks_room)]
fn parse_float_of_primitive(cx: &Cx, x: Primitive) -> JsResult<Number> {
    match x.0.as_number() {
        Some(number) => Ok(parse_float_of_number(number).into()),
        None => parse_float_of_string(cx, x.0.primitive_to_string(cx)?),
    }
}

#[direct_form(pure)]
fn number_of_characters(string: &StringImpl) -> Number {
    bun_engine_number::string_to_number(string.text()).into()
}

#[direct_form(pure, only_lacks_room)]
fn number_of_string(cx: &Cx, string: Gc<JsString>) -> JsResult<Number> {
    string.to_number(cx).map(Into::into)
}

#[direct_form(pure)]
fn number_of_bigint(bigint: Gc<JsBigInt>) -> Real {
    Real::new(bigint.value().to_number())
}

#[direct_form(reads(DATE), needs(DateConversions))]
fn number_of_date(date: Original<DateInstance>) -> Time {
    Time::clipped(date.0.time())
}

#[direct_form(pure, only_lacks_room)]
fn number_of_primitive(cx: &Cx, x: NumberLike) -> JsResult<Number> {
    x.0.primitive_to_number(cx).map(Into::into)
}

#[direct_form(pure)]
fn int32_to_string(vm: &Vm, this: i32, _: Ten) -> Flat {
    Flat::made_by(JsString::from_int32(vm, this))
}

#[direct_form(pure)]
fn int32_to_radix(vm: &Vm, this: i32, radix: Radix) -> Flat {
    Flat::made_by(JsString::from_integer_in_radix(
        vm,
        this.into(),
        radix.get(),
    ))
}

#[direct_form(pure)]
fn int52_to_radix(vm: &Vm, this: i64, radix: Radix) -> Flat {
    Flat::made_by(JsString::from_integer_in_radix(vm, this, radix.get()))
}

#[direct_form(pure)]
fn number_to_string(vm: &Vm, this: f64, _: Ten) -> Flat {
    Flat::made_by(JsString::from_number(vm, this))
}

#[direct_form(pure)]
fn number_to_radix(vm: &Vm, this: f64, radix: Radix) -> Flat {
    Flat::made_by(JsString::from_number_in_radix(vm, this, radix.get()))
}

#[direct_form]
fn this_int32(_this: i32) -> Same<0>;

#[direct_form]
fn this_number(_this: f64) -> Same<0>;

macro_rules! formats {
    ($($name:ident, $fallible:ident($argument:ty);)*) => {$(
        #[inline]
        pub fn $fallible(vm: &Vm, number: f64, argument: i32) -> Result<Flat, FormatError> {
            let mut buffer = [0; _];
            let text = bun_engine_number::$name(number, argument, &mut buffer)?;
            Ok(Flat::made_by(JsString::from_text(vm, Text::Latin1(text))))
        }

        #[direct_form(pure)]
        fn $name(vm: &Vm, this: f64, argument: $argument) -> Flat {
            $fallible(vm, this, argument.0).expect("in range")
        }
    )*};
}

formats! {
    to_fixed, try_to_fixed(FractionDigits);
    to_precision, try_to_precision(Precision);
}

#[direct_form(pure)]
fn to_integer_or_infinity_of_number(x: ToNumber) -> Real {
    Real::new(bun_engine_number::to_integer_or_infinity(x.0))
}

#[direct_form(pure)]
fn to_length_of_int32(x: i32) -> Ranged<0, { i32::MAX }> {
    Ranged::new(x.max(0))
}

#[direct_form(pure)]
fn to_length_of_number(x: ToNumber) -> Real {
    Real::new(bun_engine_number::to_length(x.0) as i64 as f64)
}
