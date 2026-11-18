//! What only tests ask for.

use bun_engine_wasm_compiler::abi::MemoryMode;
pub use bun_engine_wasm_format::canonical_group_count;

use crate::instance_cell::WasmInstance;
use crate::memory::{self, WasmMemory};
use crate::namespace::{Namespace, Slot};
use crate::object::WasmStruct;
use crate::object_shape::ObjectShape;
use crate::prelude::*;
pub use crate::source::copy_bytes;

/// Of a memory, or of the first one of an instance. `None` for anything else.
pub fn is_guarded(value: Value) -> Option<bool> {
    let mode = match value.downcast::<WasmMemory>() {
        Some(memory) => memory.memory().mode(),
        None => value.downcast::<WasmInstance>()?.instance().mode(),
    };
    Some(mode == MemoryMode::Guarded)
}

pub fn new_memory(cx: &mut Cx, descriptor: Value, is_guarded: bool) -> JsResult<Value> {
    let mode = match is_guarded {
        true => MemoryMode::Guarded,
        false => MemoryMode::Checked,
    };
    let shape = Namespace::of(cx).shape(cx, Slot::MemoryShape);
    let memory = memory::from_descriptor(cx, shape, descriptor, mode)?;
    match memory.memory().mode() == mode {
        true => Ok(memory.into()),
        false => Err(cx.throw_out_of_memory()),
    }
}

/// The offsets of the fields from the first, and the bytes that all take. `None` unless it is a struct.
pub fn layout_of_struct(value: Value) -> Option<(Vec<u32>, u32)> {
    let shape = value.downcast::<WasmStruct>()?.cell().shape();
    let shape = shape.cell().downcast::<ObjectShape>()?;
    let offsets = shape.canonical().field_offsets().collect();
    Some((offsets, shape.canonical().rtt().struct_size()))
}

/// Whether all but the functions is valid.
pub fn parses(pieces: &[Vec<u8>]) -> bool {
    let compiler = crate::engine::engine().map(bun_engine_wasm_runtime::StreamingCompiler::new);
    compiler.is_some_and(|mut compiler| {
        pieces.iter().all(|it| compiler.feed(it).is_ok()) && compiler.finish().is_ok()
    })
}
