//! Calls of any type between scripts and WebAssembly (js-api "call an Exported Function", "run a host function").

use bun_engine_vm::ValueVec;
use bun_engine_wasm_format::{FuncType, ValType};
use bun_engine_wasm_runtime::{Bits, HostCall, Incoming, Instance, Module, Outgoing};

use crate::function::{self, SUSPENDS, WasmFunction};
use crate::prelude::*;
use crate::suspension;
use crate::values::{self, Expected};

fn check_signature(cx: &Cx, ty: FuncType<'_>) -> JsResult<()> {
    match (ty.params.iter().chain(ty.results)).all(|&it| values::can_cross(it)) {
        true => Ok(()),
        false => Err(cx.throw_type_error(values::INVALID_SIGNATURE)),
    }
}

pub(crate) fn put_arguments(
    cx: &mut Cx,
    function: Gc<WasmFunction>,
    frame: &CallFrame,
    mut arguments: Outgoing<'_>,
) -> JsResult<()> {
    let (instance, func) = function.origin();
    check_signature(cx, instance.module().func_type(func))?;
    function.prepare_for_more_calls();
    for (index, &ty) in arguments.types().iter().enumerate() {
        let expected = Expected::in_module(instance.module(), ty);
        arguments.set(index, values::to_bits(cx, frame.argument(index), expected)?);
    }
    Ok(())
}

fn list_of(cx: &Cx, incoming: &Incoming<'_>) -> JsResult<ValueVec> {
    let mut list = ValueVec::new();
    for (index, &ty) in incoming.types().iter().enumerate() {
        list.push(values::from_bits(cx, incoming.get(index), ty)?);
    }
    Ok(list)
}

pub(crate) fn take_results(cx: &Cx, results: &Incoming<'_>) -> JsResult<Value> {
    match *results.types() {
        [] => Ok(Value::UNDEFINED),
        [ty] => values::from_bits(cx, results.get(0), ty),
        _ => Ok(cx.new_array_from(&list_of(cx, results)?)?.into()),
    }
}

fn result_to_bits(cx: &mut Cx, value: Value, module: &Module, ty: ValType) -> JsResult<Bits> {
    if value.is_null() && ty.is_ref() && !ty.is_defaultable() {
        let message = "Host function incorrectly returned null for a nonnullable reference type";
        return Err(cx.throw_type_error(message));
    }
    values::to_bits(cx, value, Expected::in_module(module, ty))
}

pub(crate) enum Called {
    Returned,
    Suspended,
    Redirected,
}

pub(crate) fn call_import(cx: &mut Cx, call: HostCall<'_>) -> JsResult<Called> {
    let instance = call.instance();
    check_signature(cx, instance.module().func_type(call.func()))?;
    let (callee, data) = call.function();
    let callee = values::from_reference(callee);
    if data != SUSPENDS && function::give_import_its_own_stub(instance, call.func(), callee) {
        return Ok(Called::Redirected);
    }
    let arguments = list_of(cx, call.arguments())?;
    if data == SUSPENDS {
        suspension::suspend(cx, call.frames(), callee, &arguments)?;
        return Ok(Called::Suspended);
    }
    let returned = cx.call(callee, Value::UNDEFINED, &arguments)?;
    put_results(cx, instance, returned, call.into_results())?;
    Ok(Called::Returned)
}

pub(crate) fn put_results(
    cx: &mut Cx,
    instance: &Instance,
    returned: Value,
    mut results: Outgoing<'_>,
) -> JsResult<()> {
    cx.check_traps()?;
    let types = results.types();
    if let [ty] = *types {
        let bits = result_to_bits(cx, returned, instance.module(), ty)?;
        results.set(0, bits);
    }
    if types.len() < 2 {
        return Ok(());
    }
    let Some(list) = values::list_of_length(cx, returned, types.len())? else {
        return Err(cx.throw_type_error("Incorrect number of values returned to Wasm from JS"));
    };
    for (index, (&ty, &value)) in types.iter().zip(list.iter()).enumerate() {
        let bits = result_to_bits(cx, value, instance.module(), ty)?;
        results.set(index, bits);
    }
    Ok(())
}
