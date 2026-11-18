//! The JavaScript API of WebAssembly, and its objects in the heap.

#![feature(negative_impls)]
#![allow(improper_ctypes_definitions)]

mod calls;
mod compile;
mod compile_options;
mod define;
mod descriptor;
mod embed;
mod engine;
mod errors;
mod exception;
mod frames;
mod function;
mod global;
mod host;
mod instance;
mod instance_cell;
mod memory;
mod module;
mod module_record;
mod namespace;
mod object;
mod object_shape;
mod owned;
mod reflection;
mod source;
mod store;
mod streaming;
mod string_builtins;
mod stubs;
mod suspension;
mod table;
mod tag;
pub mod testing;
mod traps;
mod values;

pub use embed::{
    WasmModule, WasmSharedMemory, compile_error, is_memory_object, memory_base, memory_byte_length,
    memory_object, memory_object_of_buffer, memory_share, module_object, module_of_object,
};
pub use frames::{find_handler, frame_catches, sampled_wasm_frame, wasm_frame, wasm_names};
pub use function::describe_callee;
pub use memory::grow_memory;
pub use module::describe_module;
pub use module_record::make_module;
pub use namespace::{initialize_slot, kept_result_of_getter};
pub use store::{release_code_not_on_stack, will_mark};
pub use streaming::WasmStreamingCompiler;

/// What nearly every module of this crate uses.
mod prelude {
    pub(crate) use bun_engine_macros::{cell, native_abi};
    pub(crate) use bun_engine_text::{PropertyName, names, symbols};
    pub(crate) use bun_engine_vm::{
        CallFrame, CellKind, Cx, Gc, InternalFunction, JsObject, JsObjectInit, JsResult, JsString,
        Shape, ShapeSpec, StaticProperty, Value, anchor, static_table,
    };

    pub(crate) use crate::define::{
        append, define_constructor, define_object, member, new_constructor, read_only_attribute,
    };
}
