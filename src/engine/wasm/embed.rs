//! What an embedder does with the objects of WebAssembly.

use std::sync::Arc;

use bun_engine_text::StringRef;
use bun_engine_vm::{ArrayBuffer, Cx, Gc, JsCell, JsObject, SharedArrayBufferContents, Vm};

use crate::errors::{self, Kind};
use crate::memory::{self, WasmMemory};
use crate::module::WasmModule as ModuleObject;
use crate::namespace::{Namespace, Slot};
use crate::store::store;

/// For any thread.
pub type WasmModule = bun_engine_wasm_runtime::Module;

/// For any thread.
pub struct WasmSharedMemory(Arc<SharedArrayBufferContents>);

impl WasmSharedMemory {
    pub fn byte_length(&self) -> usize {
        self.0.byte_length()
    }
}

/// A new `WebAssembly.Module`.
pub fn module_object(cx: &Cx, module: Arc<WasmModule>) -> Gc<JsObject> {
    let shape = Namespace::of(cx).shape(cx, Slot::ModuleShape);
    ModuleObject::create(cx, shape, module).upcast()
}

/// `None` unless it is a `WebAssembly.Module`.
pub fn module_of_object(object: &JsObject) -> Option<Arc<WasmModule>> {
    Some(object.downcast::<ModuleObject>()?.compiled())
}

/// A new `WebAssembly.Memory`.
pub fn memory_object(cx: &Cx, shared: &WasmSharedMemory) -> Gc<JsObject> {
    let store = store(cx).expect("the engine has made the memory");
    let shape = Namespace::of(cx).shape(cx, Slot::MemoryShape);
    memory::create_for_shared(cx, shape, &store, Arc::clone(&shared.0)).upcast()
}

/// `None` unless it is a `WebAssembly.Memory` that is shared.
pub fn memory_share(object: &JsObject) -> Option<Arc<WasmSharedMemory>> {
    let block = object.downcast::<WasmMemory>()?.data_block()?;
    Some(Arc::new(WasmSharedMemory(block)))
}

/// The memory, not shared, whose bytes the buffer has.
pub fn memory_object_of_buffer(vm: &Vm, buffer: &ArrayBuffer) -> Option<Gc<JsObject>> {
    buffer.wrapper(vm)?.wasm_memory()
}

pub fn is_memory_object(cell: &JsCell) -> bool {
    cell.is::<WasmMemory>()
}

/// Until it grows. Panics unless it is a `WebAssembly.Memory`.
pub fn memory_base(object: &JsObject) -> *mut u8 {
    Gc::from(object)
        .cast::<WasmMemory>()
        .memory()
        .pages()
        .base()
}

/// Panics unless it is a `WebAssembly.Memory`.
pub fn memory_byte_length(object: &JsObject) -> usize {
    Gc::from(object).cast::<WasmMemory>().memory().len() as usize
}

pub fn compile_error(cx: &Cx, message: StringRef) -> Gc<JsObject> {
    errors::create(cx, Kind::Compile, message).upcast()
}
