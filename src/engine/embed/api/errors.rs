use core::time::Duration;
use std::sync::Arc;

use bun_engine_macros::export;
use bun_engine_text::{PropertyName, StringBuilder, StringImpl, StringRef, Text};
use bun_engine_vm::{
    AsciiLiteral, Class, Cx, ErrorInstance, ErrorLocation, ErrorType, Exception, Gc, JsArray,
    JsObject, JsResult, JsString, LineColumn, Message, Shape, SourceProvider, StackTrace,
    TerminationDeadline, Thrown, Value, Vm, add_error_info, errors,
};

use super::object::realm_of;

unsafe extern "C" {
    safe fn engine_host_compute_stack(
        vm: &Vm,
        error: Gc<ErrorInstance>,
        position: &mut LineColumn,
        source_url: &mut Option<StringRef>,
    ) -> Option<Value>;
    safe fn engine_host_format_stack_frames(
        vm: &Vm,
        frames: &StackTrace,
        position: &mut LineColumn,
        source_url: &mut Option<StringRef>,
    ) -> Option<StringRef>;
    safe fn engine_host_map_position(
        vm: &Vm,
        provider: &SourceProvider,
        position: &mut LineColumn,
        source_url: &mut Option<StringRef>,
    );
}

#[export]
fn vm_hook_compute_stack(vm: &Vm) {
    fn compute(cx: &mut Cx, error: Gc<ErrorInstance>, location: &mut ErrorLocation) -> Value {
        engine_host_compute_stack(cx, error, &mut location.position, &mut location.source_url)
            .unwrap_or_default()
    }
    vm.embedder().errors.compute_stack.set(Some(compute));
}

#[export]
fn vm_hook_format_stack_frames(vm: &Vm) {
    fn format(vm: &Vm, frames: &StackTrace, location: &mut ErrorLocation) -> StringRef {
        engine_host_format_stack_frames(
            vm,
            frames,
            &mut location.position,
            &mut location.source_url,
        )
        .unwrap_or_default()
    }
    vm.embedder().errors.format_frames.set(Some(format));
}

#[export]
fn vm_hook_map_position(vm: &Vm) {
    (vm.embedder().errors.map_position).set(Some(|vm, provider, position, source_url| {
        engine_host_map_position(vm, provider, position, source_url);
    }));
}

#[inline(always)]
fn pending(cx: &mut Cx, _: Thrown) -> Option<Gc<Exception>> {
    cx.notify_debugger_of_exception();
    cx.exception()
}

#[export]
fn throw_error(
    cx: &mut Cx,
    error_type: ErrorType,
    message: Option<&StringImpl>,
) -> Option<Gc<Exception>> {
    let thrown = cx.throw(error_new(cx, error_type, message).into());
    pending(cx, thrown)
}

#[export]
fn throw_type_error_literal(cx: &mut Cx, message: AsciiLiteral) -> Option<Gc<Exception>> {
    let thrown = cx.throw_type_error(message.as_str());
    pending(cx, thrown)
}

#[export]
fn throw_type_error(cx: &mut Cx) -> Option<Gc<Exception>> {
    let thrown = cx.throw_type_error(errors::TYPE_ERROR);
    pending(cx, thrown)
}

#[export]
fn throw_out_of_memory(cx: &mut Cx) -> Option<Gc<Exception>> {
    let thrown = cx.throw_out_of_memory();
    pending(cx, thrown)
}

#[export]
fn throw_stack_overflow(cx: &mut Cx) -> Option<Gc<Exception>> {
    let thrown = cx.throw_stack_overflow();
    pending(cx, thrown)
}

#[export]
fn throw_called_without_new(cx: &mut Cx, constructor: AsciiLiteral) -> Option<Gc<Exception>> {
    let thrown = errors::throw_called_without_new(cx, constructor.as_str());
    pending(cx, thrown)
}

#[export]
fn throw_getter_type_error(
    cx: &mut Cx,
    class: &Class,
    name: PropertyName<'_>,
) -> Option<Gc<Exception>> {
    let thrown = errors::throw_getter_type_error(cx, class, name);
    pending(cx, thrown)
}

#[export]
fn throw_setter_type_error(
    cx: &mut Cx,
    class: &Class,
    name: PropertyName<'_>,
) -> Option<Gc<Exception>> {
    let thrown = errors::throw_setter_type_error(cx, class, name);
    pending(cx, thrown)
}

#[export]
fn getter_type_error_message(class: Text<'_>, name: Text<'_>) -> StringRef {
    errors::wrong_receiver_message(class, name, "getter")
}

#[export]
fn describe_value_for_error(cx: &Cx, value: Value) -> Option<StringRef> {
    let mut text = StringBuilder::new();
    errors::describe_value(cx, value, &mut text);
    text.finish().ok()
}

#[export]
fn error_new(cx: &Cx, error_type: ErrorType, message: Option<&StringImpl>) -> Gc<ErrorInstance> {
    ErrorInstance::new(cx, error_type, message.map(StringRef::retain))
}

#[export]
fn error_create(
    vm: &Vm,
    shape: Gc<Shape>,
    error_type: ErrorType,
    message: Option<&StringImpl>,
    cause: Option<Value>,
    skip: usize,
    below: Option<Gc<JsObject>>,
) -> Gc<ErrorInstance> {
    let error = ErrorInstance::create(vm, shape, error_type, skip, below);
    if let Some(message) = message {
        error.define_message(vm, JsString::new(vm, StringRef::retain(message)));
    }
    if let Some(cause) = cause {
        error.define_cause(vm, cause);
    }
    error
}

#[export]
fn error_with_info(
    cx: &Cx,
    error_type: ErrorType,
    message: Option<StringRef>,
    position: &LineColumn,
    source_url: Option<StringRef>,
    stack: Option<StringRef>,
) -> Gc<ErrorInstance> {
    ErrorInstance::with_info(cx, error_type, message, *position, source_url, stack)
}

#[export]
fn error_define_errors(error: &ErrorInstance, vm: &Vm, errors: Gc<JsArray>) {
    error.define_errors(vm, errors);
}

#[export]
fn error_out_of_memory(cx: &Cx, detail: Text<'_>) -> Gc<ErrorInstance> {
    let message = (!detail.is_empty())
        .then(|| StringRef::try_concat(&[Text::from_ascii("Out of memory: "), detail]).ok())
        .flatten();
    let message = message.unwrap_or_else(|| errors::OUT_OF_MEMORY.into_string());
    ErrorInstance::out_of_memory(cx, message)
}

#[export]
fn error_stack_overflow(cx: &Cx) -> Gc<ErrorInstance> {
    ErrorInstance::stack_overflow(cx)
}

#[export]
fn error_not_a_function(cx: &Cx, value: Value) -> Gc<ErrorInstance> {
    errors::create_not_a_function(cx, value)
}

#[export]
fn error_not_a_constructor(cx: &Cx, value: Value) -> Gc<ErrorInstance> {
    errors::create_not_a_constructor(cx, value)
}

#[export]
fn error_not_an_object(cx: &Cx, value: Value) -> Gc<ErrorInstance> {
    errors::create_not_an_object(cx, value)
}

#[export]
fn error_invalid_in_parameter(cx: &Cx, value: Value) -> Gc<ErrorInstance> {
    errors::create_invalid_in_parameter(cx, value)
}

#[export]
fn error_undefined_variable(cx: &Cx, name: PropertyName<'_>) -> Gc<ErrorInstance> {
    errors::create_undefined_variable(cx, name)
}

#[export]
fn error_add_info_to_object(vm: &Vm, object: &JsObject) {
    add_error_info(vm, object);
}

#[export]
fn error_set_native_getter_type_error(error: &ErrorInstance) {
    error.set_native_getter_type_error();
}

#[export]
fn error_set_stack_is_provided(error: &ErrorInstance) {
    error.set_stack_is_provided();
}

#[export]
fn error_capture_stack_trace(error: &ErrorInstance, cx: &Cx, skip: usize) {
    error.capture_stack_trace(cx, skip);
}

#[export]
fn error_stack_trace(error: &ErrorInstance) -> *mut StackTrace {
    (error.stack_trace_ptr()).map_or(core::ptr::null_mut(), |it| it.as_ptr())
}

#[export]
unsafe fn error_set_stack_trace(error: &ErrorInstance, vm: &Vm, frames: &mut StackTrace) {
    // SAFETY: C++ has them from the stack, or from a cell that is alive.
    unsafe { error.set_stack_trace(vm, frames.take()) }
}

#[export]
fn error_set_info(
    error: &ErrorInstance,
    position: &LineColumn,
    source_url: Option<StringRef>,
    stack: Option<StringRef>,
) {
    error.set_info(realm_of(error), *position, source_url, stack);
}

/// May leave an exception. Whether properties have been defined, or may be later.
#[export]
fn error_materialize(error: &ErrorInstance) -> bool {
    error.materialize(realm_of(error)).unwrap_or(true)
}

#[export]
fn error_is_lazy_property(name: PropertyName<'_>) -> bool {
    ErrorInstance::is_lazy_property(name)
}

#[export]
fn error_sanitized_message(error: &ErrorInstance, cx: &mut Cx) -> JsResult<Option<StringRef>> {
    error.sanitized_message(cx)
}

#[export]
fn error_sanitized_name(error: &ErrorInstance, cx: &mut Cx) -> JsResult<StringRef> {
    error.sanitized_name(cx)
}

#[export]
fn error_sanitized_to_string(error: &ErrorInstance, cx: &mut Cx) -> JsResult<StringRef> {
    error.sanitized_to_string(cx)
}

#[export]
fn exception_create(vm: &Vm, value: Value, captures_stack: bool) -> Gc<Exception> {
    if captures_stack {
        Exception::create(vm, value)
    } else {
        Exception::create_without_stack(vm, value)
    }
}

/// Afterwards it has the frames that there are to report.
#[export]
fn exception_prepare_stack_for_reporting(exception: &Exception, vm: &Vm) {
    exception.stack_for_reporting(vm);
}

/// With one reference.
#[export]
fn termination_deadline_add(vm: &Vm, seconds: f64) -> *const TerminationDeadline {
    let after = Duration::try_from_secs_f64(seconds.max(0.0)).unwrap_or(Duration::MAX);
    Arc::into_raw(vm.add_termination_deadline(after))
}

#[export]
unsafe fn termination_deadline_retain(deadline: *const TerminationDeadline) {
    // SAFETY: C++ holds a reference.
    unsafe { Arc::increment_strong_count(deadline) }
}

#[export]
unsafe fn termination_deadline_release(deadline: *const TerminationDeadline) {
    // SAFETY: as above.
    unsafe { Arc::decrement_strong_count(deadline) }
}

#[export]
fn termination_deadline_cancel(deadline: &TerminationDeadline) {
    deadline.cancel();
}

#[export]
fn termination_deadline_did_fire(deadline: &TerminationDeadline) -> bool {
    deadline.did_fire()
}
