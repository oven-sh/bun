use bun_engine_number::{FormatError, Radix};
use bun_engine_text::Text;
use bun_engine_vm::direct::number::{try_to_fixed, try_to_precision};
use bun_engine_vm::{JsWrapperObject, NumberObject, Thrown};

use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::toLocaleString, to_locale_string, 0),
    StaticProperty::function(names::valueOf, value_of, 0)
        .with_intrinsic(Intrinsic::NumberPrototypeValueOf),
    StaticProperty::function(names::toFixed, to_fixed, 1)
        .with_intrinsic(Intrinsic::NumberPrototypeToFixed),
    StaticProperty::function(names::toExponential, to_exponential, 1),
    StaticProperty::function(names::toPrecision, to_precision, 1)
        .with_intrinsic(Intrinsic::NumberPrototypeToPrecision),
    StaticProperty::function(names::toString, to_string, 1)
        .with_intrinsic(Intrinsic::NumberPrototypeToString),
]);

#[cell(name = "Number", static_table = PROPERTIES)]
struct NumberPrototype {
    base: NumberObject,
}

pub(super) fn create(cx: &Cx) -> Gc<JsObject> {
    let (global, parent) = (cx.global(), cx.object_prototype().into());
    let spec = ShapeSpec::of::<NumberPrototype>();
    let shape = Shape::create_dictionary(cx, Some(global), parent, spec);
    let base = NumberObject::init(JsWrapperObject::init(cx, shape, Value::ZERO));
    cx.allocate::<NumberPrototype>(NumberPrototypeInit { base })
        .upcast()
}

/// ThisNumberValue
#[inline(always)]
fn this_number(cx: &Cx, frame: &CallFrame) -> JsResult<f64> {
    let this = frame.this_value();
    this.as_number()
        .or_else(|| {
            this.downcast::<NumberObject>()?
                .internal_value()
                .as_number()
        })
        .ok_or_else(|| throw_not_a_number(cx, this))
}

#[cold]
fn throw_not_a_number(cx: &Cx, this: Value) -> Thrown {
    let type_name = this.type_of(cx).to_string_without_resolving();
    let type_name = type_name.text();
    cx.throw_type_error(format_args!(
        "thisNumberValue called on incompatible {type_name}"
    ))
}

/// ToIntegerOrInfinity, as far as it matters to a range of small integers.
#[inline(always)]
fn to_small_integer(cx: &mut Cx, value: Value) -> JsResult<i32> {
    match value.as_int32() {
        Some(integer) => Ok(integer),
        None => Ok(value.to_number(cx)? as i32),
    }
}

#[inline(always)]
fn finish(cx: &Cx, string: Result<impl Into<Value>, FormatError>) -> JsResult<Value> {
    (string.map(Into::into)).map_err(|error| cx.throw_range_error(error.message()))
}

/// Of the argument of `toString`.
#[inline(always)]
pub(super) fn to_radix(cx: &mut Cx, value: Value) -> JsResult<Radix> {
    match value {
        Value::UNDEFINED => Ok(Radix::DECIMAL),
        radix => Radix::new(to_small_integer(cx, radix)?)
            .map_err(|error| cx.throw_range_error(error.message())),
    }
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let number = this_number(cx, frame)?;
    let radix = to_radix(cx, frame.argument(0))?;
    Ok(JsString::from_number_in_radix(cx, number, radix).into())
}

#[native_abi]
fn to_locale_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let number = this_number(cx, frame)?;
    let (locales, options) = (frame.argument(0), frame.argument(1));
    bun_engine_intl::number_to_locale_string(cx, number, locales, options).map(Into::into)
}

#[native_abi]
fn value_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_number(cx, frame).map(Value::number)
}

#[native_abi]
fn to_fixed(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let number = this_number(cx, frame)?;
    let digits = to_small_integer(cx, frame.argument(0))?;
    finish(cx, try_to_fixed(cx, number, digits))
}

#[native_abi]
fn to_exponential(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let number = this_number(cx, frame)?;
    let digits = match frame.argument(0) {
        Value::UNDEFINED => None,
        digits => Some(to_small_integer(cx, digits)?),
    };
    let mut buffer = [0; _];
    let text = bun_engine_number::to_exponential(number, digits, &mut buffer);
    finish(cx, text.map(|it| JsString::from_text(cx, Text::Latin1(it))))
}

#[native_abi]
fn to_precision(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let number = this_number(cx, frame)?;
    if frame.argument(0).is_undefined() {
        return Ok(JsString::from_number(cx, number).into());
    }
    let precision = to_small_integer(cx, frame.argument(0))?;
    finish(cx, try_to_precision(cx, number, precision))
}
