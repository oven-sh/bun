use core::ffi::c_void;
use core::ptr::NonNull;
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_macros::export;
use bun_engine_text::{StringImpl, StringRef};
use bun_engine_vm::{ArrayBuffer, Cx, Gc, JsCell, JsObject, JsPromise, Value, Vm};
use bun_engine_wasm::{WasmModule, WasmSharedMemory, WasmStreamingCompiler};

use crate::abi::returned_as_pointer;

macro_rules! counted_references {
    ($($name:ident = $counter:ident<$target:ty>,)*) => {$(
        /// A counted reference that points at its value.
        #[repr(transparent)]
        struct $name(NonNull<$target>);

        impl From<$counter<$target>> for $name {
            fn from(value: $counter<$target>) -> $name {
                // SAFETY: points into an allocation.
                $name(unsafe { NonNull::new_unchecked($counter::into_raw(value).cast_mut()) })
            }
        }

        returned_as_pointer! {
            $name,
        }
    )*};
}

counted_references! {
    WasmModuleRef = Arc<WasmModule>,
    WasmSharedMemoryRef = Arc<WasmSharedMemory>,
    WasmStreamingCompilerRef = Rc<WasmStreamingCompiler>,
}

#[export]
unsafe fn wasm_module_retain(module: *const WasmModule) {
    // SAFETY: all that C++ has are counted.
    unsafe { Arc::increment_strong_count(module) }
}

#[export]
unsafe fn wasm_module_release(module: *const WasmModule) {
    // SAFETY: a reference that C++ holds.
    unsafe { Arc::decrement_strong_count(module) }
}

#[export]
unsafe fn wasm_shared_memory_retain(memory: *const WasmSharedMemory) {
    // SAFETY: as for modules.
    unsafe { Arc::increment_strong_count(memory) }
}

#[export]
unsafe fn wasm_shared_memory_release(memory: *const WasmSharedMemory) {
    // SAFETY: as for modules.
    unsafe { Arc::decrement_strong_count(memory) }
}

#[export]
fn wasm_shared_memory_byte_length(memory: &WasmSharedMemory) -> usize {
    memory.byte_length()
}

#[export]
fn wasm_streaming_compiler_create(
    cx: &Cx,
    promise: Gc<JsPromise>,
    wants_instance: bool,
    imports: Option<Gc<JsObject>>,
    options: Value,
) -> WasmStreamingCompilerRef {
    let compiler = WasmStreamingCompiler::new(cx, promise, wants_instance, imports, options);
    Rc::new(compiler).into()
}

#[export]
unsafe fn wasm_streaming_compiler_retain(compiler: *const WasmStreamingCompiler) {
    // SAFETY: as for modules.
    unsafe { Rc::increment_strong_count(compiler) }
}

#[export]
unsafe fn wasm_streaming_compiler_release(compiler: *const WasmStreamingCompiler) {
    // SAFETY: as for modules.
    unsafe { Rc::decrement_strong_count(compiler) }
}

#[export]
fn wasm_streaming_compiler_add_bytes(compiler: &WasmStreamingCompiler, bytes: &[u8]) {
    compiler.add_bytes(bytes);
}

#[export]
fn wasm_streaming_compiler_finish(compiler: &WasmStreamingCompiler, cx: &Cx) {
    compiler.finish(cx);
}

#[export]
fn wasm_streaming_compiler_fail(compiler: &WasmStreamingCompiler, cx: &Cx, error: Value) {
    compiler.fail(cx, error);
}

#[export]
fn wasm_streaming_compiler_cancel(compiler: &WasmStreamingCompiler) {
    compiler.cancel();
}

#[export]
fn wasm_module_object_create(cx: &Cx, module: WasmModuleRef) -> Gc<JsObject> {
    // SAFETY: from `into_raw`, with a reference of its own.
    bun_engine_wasm::module_object(cx, unsafe { Arc::from_raw(module.0.as_ptr()) })
}

#[export]
fn wasm_module_object_module(object: &JsObject) -> WasmModuleRef {
    let module = bun_engine_wasm::module_of_object(object);
    module.expect("a module").into()
}

#[export]
fn wasm_memory_object_create(cx: &Cx, memory: &WasmSharedMemory) -> Gc<JsObject> {
    bun_engine_wasm::memory_object(cx, memory)
}

#[export]
fn wasm_memory_object_of_buffer(vm: &Vm, buffer: &ArrayBuffer) -> Option<Gc<JsObject>> {
    bun_engine_wasm::memory_object_of_buffer(vm, buffer)
}

#[export]
fn wasm_memory_object_base(object: &JsObject) -> *mut c_void {
    bun_engine_wasm::memory_base(object).cast()
}

#[export]
fn wasm_memory_object_byte_length(object: &JsObject) -> usize {
    bun_engine_wasm::memory_byte_length(object)
}

#[export]
fn wasm_memory_object_share(object: &JsObject) -> Option<WasmSharedMemoryRef> {
    bun_engine_wasm::memory_share(object).map(Into::into)
}

#[export]
fn wasm_is_memory_object(cell: &JsCell) -> bool {
    bun_engine_wasm::is_memory_object(cell)
}

#[export]
fn wasm_compile_error_create(cx: &Cx, message: &StringImpl) -> Gc<JsObject> {
    bun_engine_wasm::compile_error(cx, StringRef::retain(message))
}
