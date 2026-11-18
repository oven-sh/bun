use bun_engine_bytecode::Visibility;
use bun_engine_macros::export;
use bun_engine_text::{StringImpl, StringRef, names};
use bun_engine_vm::{
    Attributes, CallData, Cx, FunctionExecutable, Gc, GlobalObject, InternalFunction, Intrinsic,
    JsBoundFunction, JsCell, JsFunction, JsObject, JsResult, JsString, NativeExecutable,
    NativeFunction, Shape, Value, Vm, display_name,
};

use super::object::realm_of;
use super::scope::can_close_over;
use crate::abi::{or_undefined, returned_by_value};

returned_by_value! {
    Intrinsic = Intrinsic::None,
}

/// Scripts never see a global object but through its proxy, and a native function may pass its receiver on.
fn receiver(this: Value) -> Value {
    if this.is::<GlobalObject>() {
        return Value::UNDEFINED;
    }
    this
}

#[export]
fn call(cx: &mut Cx, callee: Value, this: Value, arguments: &[Value]) -> JsResult<Value> {
    if cx.is_execution_forbidden().get() && !cx.is_entered() {
        return Ok(Value::UNDEFINED);
    }
    or_undefined(cx.call(callee, receiver(this), arguments))
}

#[export]
fn construct(
    cx: &mut Cx,
    callee: Value,
    arguments: &[Value],
    new_target: Value,
) -> JsResult<Gc<JsObject>> {
    cx.construct(callee, arguments, new_target)
}

#[export]
fn call_data_for_call(callee: Value, data: &mut CallData) {
    *data = CallData::for_call(callee);
}

#[export]
fn call_data_for_construct(callee: Value, data: &mut CallData) {
    *data = CallData::for_construct(callee);
}

#[export]
fn native_executable_shared(
    vm: &Vm,
    length: u32,
    name: &StringImpl,
    function: NativeFunction,
    constructor: NativeFunction,
    intrinsic: Intrinsic,
    visibility: Visibility,
) -> Gc<NativeExecutable> {
    let name = StringRef::retain(name);
    NativeExecutable::shared(
        vm,
        length,
        name,
        function,
        constructor,
        intrinsic,
        visibility,
    )
}

#[export]
fn function_create_native(
    cx: &Cx,
    length: u32,
    name: &StringImpl,
    function: NativeFunction,
    constructor: NativeFunction,
    intrinsic: Intrinsic,
    visibility: Visibility,
) -> Gc<JsFunction> {
    let name = StringRef::retain(name);
    JsFunction::native_with(
        cx,
        length,
        &name,
        function,
        constructor,
        intrinsic,
        visibility,
    )
}

#[export]
fn function_create(
    cx: &Cx,
    executable: Gc<FunctionExecutable>,
    scope: Gc<JsCell>,
) -> Gc<JsFunction> {
    assert!(can_close_over(executable.info(), scope));
    // SAFETY: just checked.
    unsafe { JsFunction::create(cx, executable, scope) }
}

#[export]
unsafe fn function_create_with_shape(
    vm: &Vm,
    executable: Gc<FunctionExecutable>,
    scope: Gc<JsCell>,
    shape: Gc<Shape>,
) -> Gc<JsFunction> {
    assert!(can_close_over(executable.info(), scope));
    // SAFETY: just checked. C++ has a shape for functions.
    unsafe { JsFunction::create_with_shape(vm, executable, scope, shape) }
}

#[export]
fn function_is_native_or_builtin(function: &JsFunction) -> bool {
    function.is_native_or_builtin()
}

#[export]
fn function_intrinsic(function: &JsFunction) -> Intrinsic {
    function.intrinsic()
}

#[export]
fn function_name(function: &JsFunction) -> StringRef {
    function.name()
}

#[export]
fn function_display_name(function: &JsObject) -> StringRef {
    display_name(function)
}

#[export]
fn function_set_name(function: &JsFunction, cx: &Cx, name: Value) -> JsResult<()> {
    function.set_function_name(cx, name)
}

#[export]
fn function_realm(cx: &Cx, function: Gc<JsObject>) -> JsResult<Gc<GlobalObject>> {
    bun_engine_vm::function_realm(cx, function)
}

#[export]
fn function_realm_if_any(function: Gc<JsObject>) -> Option<Gc<GlobalObject>> {
    function.realm()?;
    let cx = realm_of(&function);
    bun_engine_vm::function_realm(cx, function)
        .map_err(|thrown| cx.discard_unless_termination(thrown))
        .ok()
}

#[export]
fn bound_function_create(
    cx: &mut Cx,
    target: Gc<JsObject>,
    bound_this: Value,
    arguments: &[Value],
    length: f64,
    name: Option<Gc<JsString>>,
) -> JsResult<Gc<JsBoundFunction>> {
    let length = (!length.is_nan()).then_some(length);
    JsBoundFunction::create(cx, target, receiver(bound_this), arguments, length, name)
}

#[export]
unsafe fn internal_function_finish_creation(
    function: &InternalFunction,
    vm: &Vm,
    length: u32,
    name: &StringImpl,
    shares_shape: bool,
) {
    let name = JsString::new(vm, StringRef::retain(name));
    if shares_shape {
        return function.define_length_and_name(vm, length, name);
    }
    function.set_original_name(Some(name));
    let attributes = Attributes::READ_ONLY | Attributes::DONT_ENUM;
    // SAFETY: a new object, which C++ knows to be the only one with the shape.
    unsafe {
        function.put_direct_without_transition(vm, names::length, length.into(), attributes);
        function.put_direct_without_transition(vm, names::name, name.into(), attributes);
    }
}

#[export]
fn subclass_shape(cx: &mut Cx, new_target: Gc<JsObject>, base: Gc<Shape>) -> JsResult<Gc<Shape>> {
    cx.subclass_shape(new_target, base)
}
