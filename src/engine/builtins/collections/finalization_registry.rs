use bun_engine_vm::{GlobalObject, JsCell, JsFinalizationRegistry, can_be_held_weakly, errors};

use super::{instance_shape, this_weak};
use crate::prelude::*;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::register, register, 2),
    StaticProperty::function(names::unregister, unregister, 1),
    StaticProperty::string(symbols::toStringTag, names::FinalizationRegistry),
]);

define_object!(
    FinalizationRegistryPrototype,
    "FinalizationRegistry",
    PROTOTYPE_PROPERTIES
);

static_table!(static CONSTRUCTOR_PROPERTIES = []);

define_constructor!(
    FinalizationRegistryConstructor,
    CONSTRUCTOR_PROPERTIES,
    call,
    construct
);

pub(super) fn initialize(cx: &Cx) {
    let prototype = FinalizationRegistryPrototype::create(cx, cx.object_prototype().into());
    let (parent, name) = (cx.function_prototype(), names::FinalizationRegistry);
    let constructor = FinalizationRegistryConstructor::create(cx, parent, 1, name, &prototype);
    let shape = instance_shape::<JsFinalizationRegistry>(cx, prototype);
    cx.global().init_finalization_registry_shape(shape);
    cx.global()
        .init_finalization_registry_constructor(constructor);
}

fn held_weakly(cx: &Cx, value: Value, message: &'static str) -> JsResult<Gc<JsCell>> {
    match value.as_cell() {
        Some(cell) if can_be_held_weakly(value) => Ok(cell),
        _ => Err(cx.throw_type_error(message)),
    }
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_called_without_new(cx, "FinalizationRegistry"))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let callback = frame.argument(0).as_object();
    let Some(callback) = callback.filter(|it| it.is_callable()) else {
        let message = "First argument to FinalizationRegistry should be a function";
        return Err(cx.throw_type_error(message));
    };
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let base = GlobalObject::finalization_registry_shape;
    let shape = cx.shape_from_new_target(new_target, &callee, base)?;
    Ok(JsFinalizationRegistry::create_with_shape(cx, shape, callback).into())
}

#[native_abi]
fn register(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let registry = this_weak::<JsFinalizationRegistry>(cx, frame)?;
    let message = "register requires an object or a non-registered symbol as the target";
    let target = held_weakly(cx, frame.argument(0), message)?;
    let (held, token) = (frame.argument(1), frame.argument(2));
    if held == target.into() {
        let message = "register expects the target object and the holdings parameter are not the same. Otherwise, the target can never be collected";
        return Err(cx.throw_type_error(message));
    }
    let message =
        "register requires an object or a non-registered symbol as the unregistration token";
    let token = match token {
        Value::UNDEFINED => None,
        token => Some(held_weakly(cx, token, message)?),
    };
    registry.register(cx, target, held, token)?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn unregister(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let registry = this_weak::<JsFinalizationRegistry>(cx, frame)?;
    let message =
        "unregister requires an object or a non-registered symbol as the unregistration token";
    let token = held_weakly(cx, frame.argument(0), message)?;
    Ok(registry.unregister(cx, token).into())
}
