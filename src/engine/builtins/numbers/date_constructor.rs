use bun_engine_date::time_clip;
use bun_engine_vm::direct::date::{
    DEFAULT_INTEGERS, DEFAULT_NUMBERS, time_from_integers, time_from_numbers,
};
use bun_engine_vm::{DateInstance, GlobalObject, PreferredType};

use super::date_prototype;
use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::parse, parse, 1)
        .with_intrinsic(Intrinsic::DateParse),
    StaticProperty::function(names::UTC, utc, 7)
        .with_intrinsic(Intrinsic::DateUTC),
    StaticProperty::function(names::now, now, 0).with_intrinsic(Intrinsic::DateNow),
]);

define_constructor!(DateConstructor, PROPERTIES, call, construct);

pub(super) fn initialize(cx: &Cx) {
    let global = cx.global();
    let prototype = date_prototype::create(cx);
    let constructor =
        DateConstructor::create(cx, cx.function_prototype(), 7, names::Date, &prototype);
    let spec = ShapeSpec::of::<DateInstance>();
    global.init_date_shape(Shape::create(cx, Some(global), prototype.into(), spec));
    global.init_date_prototype(prototype);
    global.init_date_constructor(constructor);
}

fn integer_components(arguments: &[Value]) -> Option<[i32; 7]> {
    let mut components = DEFAULT_INTEGERS;
    for (component, argument) in components.iter_mut().zip(arguments) {
        *component = argument.as_int32()?;
    }
    (!arguments.is_empty()).then_some(components)
}

/// The time on the clock that the components are read from.
fn time_from_components(cx: &mut Cx, arguments: &[Value]) -> JsResult<f64> {
    if let Some(components) = integer_components(arguments) {
        return Ok(time_from_integers(&components));
    }
    let mut components = DEFAULT_NUMBERS;
    for (component, argument) in components.iter_mut().zip(arguments) {
        *component = argument.to_number(cx)?;
    }
    Ok(time_from_numbers(&components))
}

fn time_from_value(cx: &mut Cx, value: Value) -> JsResult<f64> {
    if let Some(number) = value.as_number() {
        return Ok(number);
    }
    if let Some(date) = value.downcast::<DateInstance>() {
        return Ok(date.time());
    }
    let primitive = value.to_primitive(cx, PreferredType::None)?;
    match primitive.as_string() {
        Some(string) => Ok(cx.date_cache().parse(string.view(cx)?.text())),
        None => primitive.to_number(cx),
    }
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let fields = cx.date_cache().local_fields(cx.global().date_now());
    let string = fields.map(|fields| cx.date_cache().date_time_string(fields));
    Ok(date_prototype::or_invalid_date(cx, string))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let time = match *frame.arguments() {
        [] => cx.global().date_now(),
        [value] => time_from_value(cx, value)?,
        ref components => {
            let local_time = time_from_components(cx, components)?;
            cx.date_cache().utc(local_time)
        }
    };
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::date_shape)?;
    Ok(DateInstance::create(cx, shape, time).into())
}

#[native_abi]
fn parse(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = frame.argument(0).to_string_view(cx)?;
    Ok(cx.date_cache().parse(string.text()).into())
}

#[native_abi]
fn utc(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(time_clip(time_from_components(cx, frame.arguments())?).into())
}

#[native_abi]
fn now(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(cx.global().date_now().into())
}
