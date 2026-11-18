use bun_engine_vm::{BigIntObject, JsBigInt, PreferredType, errors};

use super::number_prototype::to_radix;
use crate::prelude::*;

static_table!(static CONSTRUCTOR_PROPERTIES = [
    StaticProperty::function(names::asUintN, as_uint_n, 2)
        .with_intrinsic(Intrinsic::BigIntAsUintN),
    StaticProperty::function(names::asIntN, as_int_n, 2)
        .with_intrinsic(Intrinsic::BigIntAsIntN),
]);

define_constructor!(BigIntConstructor, CONSTRUCTOR_PROPERTIES, call, construct);

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::toString, to_string, 0)
        .with_intrinsic(Intrinsic::BigIntPrototypeToString),
    StaticProperty::function(names::toLocaleString, to_locale_string, 0),
    StaticProperty::function(names::valueOf, value_of, 0),
    StaticProperty::string(symbols::toStringTag, names::BigInt),
]);

define_object!(BigIntPrototype, "BigInt", PROTOTYPE_PROPERTIES);

pub(super) fn initialize(cx: &Cx) {
    let global = cx.global();
    let prototype = BigIntPrototype::create(cx, cx.object_prototype().into());
    let constructor =
        BigIntConstructor::create(cx, cx.function_prototype(), 1, names::BigInt, &prototype);
    let spec = ShapeSpec::of::<BigIntObject>();
    global.init_bigint_object_shape(Shape::create(cx, Some(global), prototype.into(), spec));
    global.init_bigint_prototype(prototype);
    global.init_bigint_constructor(constructor);
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let primitive = frame.argument(0).to_primitive(cx, PreferredType::Number)?;
    if let Some(integer) = primitive.as_int32() {
        return Ok(JsBigInt::from_small(cx, integer).into());
    }
    match primitive.as_double() {
        Some(number) => JsBigInt::from_number(cx, number),
        None => primitive.to_bigint(cx),
    }
    .map(Into::into)
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_not_a_constructor(cx, frame.callee().into()))
}

#[native_abi]
fn as_uint_n(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let bits = frame.argument(0).to_index(cx, "number of bits")?;
    let bigint = frame.argument(1).to_bigint(cx)?;
    JsBigInt::as_uint_n(cx, bits, &bigint).map(Into::into)
}

#[native_abi]
fn as_int_n(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let bits = frame.argument(0).to_index(cx, "number of bits")?;
    let bigint = frame.argument(1).to_bigint(cx)?;
    JsBigInt::as_int_n(cx, bits, &bigint).map(Into::into)
}

/// ThisBigIntValue
#[inline(always)]
fn this_bigint(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<JsBigInt>> {
    let this = frame.this_value();
    this.as_bigint()
        .or_else(|| {
            this.downcast::<BigIntObject>()?
                .internal_value()
                .as_bigint()
        })
        .ok_or_else(|| cx.throw_type_error("'this' value must be a BigInt or BigIntObject"))
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let bigint = this_bigint(cx, frame)?;
    let radix = to_radix(cx, frame.argument(0))?;
    bigint.to_js_string(cx, radix.get()).map(Into::into)
}

#[native_abi]
fn to_locale_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let bigint = this_bigint(cx, frame)?;
    let (locales, options) = (frame.argument(0), frame.argument(1));
    bun_engine_intl::bigint_to_locale_string(cx, bigint, locales, options).map(Into::into)
}

#[native_abi]
fn value_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_bigint(cx, frame).map(Into::into)
}
