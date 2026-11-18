//! What the stubs call.

use bun_engine_vm::{JsBigInt, Vm};

use crate::function::WasmFunction;
use crate::prelude::*;
use crate::values::{self, Expected};

#[native_abi]
pub(super) fn box_i64(vm: &Vm, value: i64) -> Value {
    JsBigInt::from_small(vm, value).into()
}

/// Zero if it is not of the type of the parameter, which is that of a reference.
#[native_abi]
pub(super) fn argument_to_reference(frame: &CallFrame, index: u32) -> u64 {
    let (instance, func) = frame.callee().cast::<WasmFunction>().origin();
    let module = instance.module();
    let ty = module.func_type(func).params[index as usize];
    let value = frame.argument(index as usize);
    let reference = values::try_to_reference(value, Expected::in_module(module, ty));
    reference.map_or(0, |it| it.0)
}
