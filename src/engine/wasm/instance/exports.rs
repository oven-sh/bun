//! The exports object.

use bun_engine_wasm_format::Extern;
use bun_engine_wasm_runtime::Instance;

use crate::function;
use crate::global::WasmGlobal;
use crate::instance_cell::WasmInstance;
use crate::memory::WasmMemory;
use crate::prelude::*;
use crate::table::WasmTable;
use crate::tag::WasmTag;

fn object_for(cx: &Cx, instance: &Instance, item: Extern) -> JsResult<Value> {
    Ok(match item {
        Extern::Func(func) => function::exported(cx, instance, func)?,
        Extern::Memory(index) => WasmMemory::of(instance.memory(index)).into(),
        Extern::Table(index) => WasmTable::of(instance.table(index)).into(),
        Extern::Global(index) => match instance.global(index) {
            Ok(global) => WasmGlobal::of(global).into(),
            Err(_) => return Err(cx.throw_out_of_memory()),
        },
        Extern::Tag(index) => WasmTag::of_instance(instance, index).into(),
    })
}

pub(super) fn create(
    cx: &mut Cx,
    object: Gc<WasmInstance>,
    mut bind: impl FnMut(&Cx, Extern, Value) -> JsResult<()>,
) -> JsResult<()> {
    let names = object.module().names(cx)?;
    let instance = object.instance();
    let exports = cx.new_object_with_null_prototype();
    for (export, name) in instance.module().exports().iter().zip(&names.exports) {
        let value = object_for(cx, instance, export.item)?;
        bind(cx, export.item, value)?;
        exports.put_direct_may_be_index(cx, name.name(), value)?;
    }
    exports.freeze_or_throw(cx)?;
    object.set_exports(Some(exports));
    Ok(())
}
