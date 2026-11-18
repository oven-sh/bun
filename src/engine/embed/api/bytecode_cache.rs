use core::ffi::c_void;
use core::ptr::NonNull;
use std::rc::Rc;

use bun_engine_bytecode::cache::Payload;
use bun_engine_bytecode::{FunctionRef, Host, Instrumentation, Script};
use bun_engine_macros::export;
use bun_engine_vm::scope::static_scope_of;
use bun_engine_vm::{
    Cx, DetachedHost, FunctionExecutable, Gc, JsCell, JsFunction, JsResult, SourceCode,
    SourceProvider, UnlinkedFunction, Value, Vm, evaluate_compiled_script,
};

use super::code::ParserError;
use super::scope::can_close_over;
use crate::abi::returned_as_pointer;

/// For `bun_bundler::bytecode`.
#[unsafe(no_mangle)]
fn __bun_engine_embed_detached_host() -> Box<dyn Host> {
    Box::new(DetachedHost::default())
}

/// Calls `take` unless it fails.
#[export]
unsafe fn bytecode_generate(
    vm: &Vm,
    source: &SourceCode,
    is_module: bool,
    context: *mut c_void,
    take: unsafe extern "C" fn(*mut c_void, *const u8, usize),
) {
    if let Some(bytes) = vm.encode_program(&source.provider, is_module, u32::MAX) {
        // SAFETY: the two go together.
        unsafe { take(context, bytes.as_ptr(), bytes.len()) }
    }
}

#[export]
fn bytecode_is_of(source: &SourceCode, is_module: bool, bytes: &[u8]) -> bool {
    source.provider.is_source_of(bytes, is_module)
}

#[export]
fn bytecode_load_for_builtin(
    vm: &Vm,
    function: &UnlinkedFunction,
    source_stamp: u32,
    bytes: &'static [u8],
    entry: u32,
) -> bool {
    vm.load_builtin(function, source_stamp, &Payload::embedded(bytes), entry)
}

#[export]
fn bytecode_set_embedded(provider: &SourceProvider, bytes: &'static [u8], entry: u32) {
    provider.set_bytecode(Payload::embedded(bytes), entry);
}

#[export]
fn bytecode_set_lasting(provider: &SourceProvider, bytes: &'static [u8]) {
    provider.set_bytecode(Payload::intact_and_lasting(bytes), 0);
}

#[export]
unsafe fn bytecode_adopt(provider: &SourceProvider, bytes: *mut u8, size: usize) {
    // SAFETY: what is left of a `Box<[u8]>`, which is handed over.
    let bytes = unsafe { Box::from_raw(core::ptr::slice_from_raw_parts_mut(bytes, size)) };
    provider.set_bytecode(Payload::intact(bytes), 0);
}

#[export]
fn code_cache_max_entries(vm: &Vm) -> usize {
    vm.code_cache_max_entries()
}

#[export]
fn code_cache_set_max_entries(vm: &Vm, count: usize) {
    vm.set_code_cache_max_entries(count);
}

struct CompiledScript {
    source: SourceCode,
    script: Rc<Script>,
    instrumentation: Instrumentation,
}

/// An `Rc` that points at its value.
#[repr(transparent)]
struct CompiledScriptRef(NonNull<CompiledScript>);

returned_as_pointer! {
    CompiledScriptRef,
}

#[export]
fn compiled_script_create(
    cx: &Cx,
    source: &SourceCode,
    error: &mut ParserError,
    scope: Option<Gc<JsCell>>,
) -> Option<CompiledScriptRef> {
    let (provider, outer) = (&source.provider, scope.and_then(static_scope_of));
    let compiled = Rc::new(CompiledScript {
        source: source.clone(),
        script: error.take(cx.compile_script(provider, outer.as_ref()), provider)?,
        instrumentation: cx.global().instrumentation(cx),
    });
    NonNull::new(Rc::into_raw(compiled).cast_mut()).map(CompiledScriptRef)
}

#[export]
unsafe fn compiled_script_retain(compiled: *const CompiledScript) {
    // SAFETY: all of them are in an `Rc`.
    unsafe { Rc::increment_strong_count(compiled) }
}

#[export]
unsafe fn compiled_script_release(compiled: *const CompiledScript) {
    // SAFETY: a reference that C++ holds.
    unsafe { Rc::decrement_strong_count(compiled) }
}

#[export]
fn compiled_script_is_usable_in(compiled: &CompiledScript, cx: &Cx) -> bool {
    compiled.instrumentation == cx.global().instrumentation(cx)
}

#[export]
fn compiled_script_create_first_function(
    compiled: &CompiledScript,
    cx: &Cx,
    scope: Gc<JsCell>,
) -> Option<Gc<JsFunction>> {
    let functions = &compiled.script.code.functions;
    let (index, function) = ((0..).zip(&**functions)).min_by_key(|it| it.1.range().start)?;
    if !can_close_over(function, scope) {
        return None;
    }
    let (provider, info) = (
        compiled.source.provider.clone(),
        FunctionRef::new(Rc::clone(functions), index),
    );
    let executable = FunctionExecutable::create(cx, provider, info);
    // SAFETY: just checked.
    Some(unsafe { JsFunction::create(cx, executable, scope) })
}

/// In the realm of `this`.
#[export]
fn compiled_script_evaluate(
    compiled: CompiledScriptRef,
    cx: &mut Cx,
    this: Value,
) -> JsResult<Value> {
    // SAFETY: from `into_raw`, with a reference of its own.
    let compiled = unsafe { Rc::from_raw(compiled.0.as_ptr()) };
    let this = this.to_sloppy_this(cx);
    let cx = cx.in_realm_of(&this);
    cx.check_stack()?;
    let (script, scope) = (Rc::clone(&compiled.script), cx.global().cell());
    // SAFETY: compiled from that text.
    unsafe { evaluate_compiled_script(cx, &compiled.source, script, scope, this.into()) }
}
