use core::ffi::c_void;
use core::fmt::Write;

use bun_engine_bytecode::Visibility;
use bun_engine_macros::export;
use bun_engine_text::{StringBuilder, StringRef};
use bun_engine_vm::{
    CallFrame, JsAsyncFunctionGenerator, JsPromise, LineColumn, StackFrame, StackTrace,
    StackTraceRequest, StackVisitor, Vm,
};

/// Until `visit` returns false. Nothing is visited if `first` is no frame on the stack.
#[export]
unsafe fn stack_visit(
    vm: &Vm,
    first: *const CallFrame,
    visit: unsafe extern "C" fn(*const c_void, &StackFrame, Visibility) -> bool,
    context: *const c_void,
) {
    // SAFETY: the two go together.
    StackVisitor::frames_from(vm, first)
        .all(|frame| unsafe { visit(context, &(&frame).into(), frame.visibility()) });
}

/// In place of the frames that it has. There is no filter if that is null.
#[export]
unsafe fn stack_trace_capture(
    vm: &Vm,
    frames: &mut StackTrace,
    skip: usize,
    limit: usize,
    is_wanted: unsafe extern "C" fn(*const c_void, &StackFrame) -> bool,
    filter: *const c_void,
) {
    // SAFETY: the two go together.
    let mut ask = |frame: &StackFrame| unsafe { is_wanted(filter, frame) };
    let request = StackTraceRequest {
        skip,
        limit,
        below: None,
        filter: (!filter.is_null()).then_some(&mut ask),
    };
    *frames = StackTrace::capture(vm, request);
}

#[export]
fn stack_trace_of_awaiters(promise: &JsPromise, frames: &mut StackTrace, limit: usize) {
    *frames = StackTrace::of_awaiters(promise, limit);
}

#[export]
fn vm_resumed_async_function_count(vm: &Vm) -> usize {
    (vm.entry_contexts())
        .filter(|it| it.is::<JsAsyncFunctionGenerator>())
        .count()
}

#[export]
fn stack_frame_position(frame: &StackFrame, position: &mut LineColumn) {
    *position = frame.line_column().unwrap_or_default();
}

#[export]
fn stack_frame_source_url(frame: &StackFrame, vm: &Vm) -> StringRef {
    frame.source_url(vm)
}

#[export]
fn stack_frame_wasm_function_name(frame: &StackFrame, vm: &Vm) -> StringRef {
    let Some(names) = frame.wasm_names(vm) else {
        return StringRef::from_literal("wasm-stub");
    };
    let mut name = StringBuilder::new();
    name.push_text(names.module.text());
    name.push_ascii(".wasm-function[");
    match names.function {
        Some(function) => name.push_text(function.text()),
        None => {
            let _ = write!(name, "{}", frame.bytecode_offset);
        }
    }
    name.push_latin1(b']');
    name.finish().unwrap_or_default()
}
