use bun_engine_bytecode::Visibility;
use bun_engine_number::MAX_SAFE_INTEGER;
use bun_engine_vm::{
    Attributes, GlobalObject, JsFunction, NativeExecutable, NumberObject, Numeric, RealmSlot,
    direct,
};

use super::number_prototype;
use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::isFinite, number_is_finite, 1)
        .with_intrinsic(Intrinsic::NumberIsFinite),
    StaticProperty::function(names::isNaN, number_is_nan, 1).with_intrinsic(Intrinsic::NumberIsNaN),
    StaticProperty::function(names::isSafeInteger, number_is_safe_integer, 1)
        .with_intrinsic(Intrinsic::NumberIsSafeInteger),
    StaticProperty::realm_slot(names::prototype, RealmSlot::number_prototype)
        .with(Attributes::CONSTANT),
    StaticProperty::number(names::EPSILON, f64::EPSILON),
    StaticProperty::number(names::MAX_VALUE, f64::MAX),
    StaticProperty::number(names::MIN_VALUE, f64::from_bits(1)),
    StaticProperty::number(names::MAX_SAFE_INTEGER, MAX_SAFE_INTEGER),
    StaticProperty::number(names::MIN_SAFE_INTEGER, -MAX_SAFE_INTEGER),
    StaticProperty::number(names::NEGATIVE_INFINITY, f64::NEG_INFINITY),
    StaticProperty::number(names::POSITIVE_INFINITY, f64::INFINITY),
    StaticProperty::number(names::NaN, f64::NAN),
    StaticProperty::realm_slot(names::parseInt, RealmSlot::parse_int_function),
    StaticProperty::realm_slot(names::parseFloat, RealmSlot::parse_float_function),
    StaticProperty::function(names::isInteger, number_is_integer, 1)
        .with_intrinsic(Intrinsic::NumberIsInteger),
]);

#[cell(name = "Function", static_table = PROPERTIES)]
struct NumberConstructor {
    base: JsFunction,
}

pub(super) fn initialize(cx: &Cx) {
    let global = cx.global();
    let prototype = number_prototype::create(cx);
    let (name, intrinsic) = (names::Number, Intrinsic::NumberConstructor);
    let name = name.to_identifier().into_string();
    let executable =
        NativeExecutable::shared(cx, 1, name, call, construct, intrinsic, Visibility::Public);
    let (parent, spec) = (
        cx.function_prototype(),
        ShapeSpec::of::<NumberConstructor>(),
    );
    let shape = Shape::create_dictionary(cx, Some(global), parent.into(), spec);
    let constructor = cx.allocate::<NumberConstructor>(NumberConstructorInit {
        base: JsFunction::native_init(cx, shape, executable),
    });
    let attributes = Attributes::DONT_ENUM;
    prototype.put_direct(cx, names::constructor, constructor.into(), attributes);
    let spec = ShapeSpec::of::<NumberObject>();
    global.init_number_object_shape(Shape::create(cx, Some(global), prototype.into(), spec));
    global.init_number_prototype(prototype);
    global.init_number_constructor(constructor.upcast());
}

fn number_from_arguments(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    match frame.arguments().first() {
        None => Ok(Value::ZERO),
        Some(&value) if value.is_number() => Ok(value),
        Some(value) => Ok(match value.to_numeric(cx)? {
            Numeric::Number(number) => number.into(),
            Numeric::BigInt(bigint) => bigint.value().to_number().into(),
        }),
    }
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    number_from_arguments(cx, frame)
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let value = number_from_arguments(cx, frame)?;
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::number_object_shape)?;
    Ok(NumberObject::create(cx, shape, value).into())
}

macro_rules! predicates {
    ($($name:ident = $test:ident,)*) => {$(
        #[native_abi]
        fn $name(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
            Ok(direct::number::$test(frame.argument(0)).into())
        }
    )*};
}

predicates! {
    number_is_finite = value_is_finite,
    number_is_nan = value_is_nan,
    number_is_integer = value_is_integer,
    number_is_safe_integer = value_is_safe_integer,
}
