use core::ffi::{c_char, c_void};

use bun_engine_ffi::{
    Dispatch, FfiCallback, FfiFunction, Invocation, NativeType, Signature, value_to_slot,
};
use bun_engine_macros::export;
use bun_engine_text::{StringImpl, StringRef};
use bun_engine_vm::{Cx, Gc, JsFunction, JsObject, JsResult, Value, Vm};

fn signature(arguments: &[u8], result: u8) -> Option<&'static Signature> {
    let arguments: Option<Vec<NativeType>> = arguments
        .iter()
        .map(|&it| NativeType::from_number(it))
        .collect();
    Signature::new(&arguments?, NativeType::from_number(result)?)
}

#[export]
fn ffi_type_name(number: u8) -> *const c_char {
    (NativeType::from_number(number).map_or(c"invalid", NativeType::c_name)).as_ptr()
}

#[export]
fn ffi_is_signature_supported(arguments: &[u8], result: u8) -> bool {
    signature(arguments, result).is_some()
}

#[export]
fn ffi_value_to_slot(cx: &mut Cx, number: u8, value: Value) -> JsResult<u64> {
    value_to_slot(
        cx,
        NativeType::from_number(number).expect("a type"),
        value,
        None,
    )
}

#[export]
unsafe fn ffi_function_create(
    cx: &Cx,
    arguments: &[u8],
    result: u8,
    target: *mut c_void,
    name: &StringImpl,
    owner: Option<Gc<JsObject>>,
) -> JsResult<Gc<JsFunction>> {
    let signature = signature(arguments, result).expect("supported");
    let (target, name) = (target.expose_provenance(), StringRef::retain(name));
    // SAFETY: the script has asked for it.
    unsafe { FfiFunction::create(cx, signature, target, name, owner) }.map(Gc::upcast)
}

#[export]
unsafe fn ffi_callback_create(
    cx: &Cx,
    arguments: &[u8],
    result: u8,
    callable: Gc<JsObject>,
    dispatch: Option<unsafe extern "C" fn(*mut Invocation, *mut c_void)>,
    context: *mut c_void,
) -> JsResult<Gc<FfiCallback>> {
    let signature = signature(arguments, result).expect("supported");
    let dispatch = dispatch.map(|function| Dispatch { function, context });
    // SAFETY: as above.
    unsafe { FfiCallback::create(cx, signature, callable, dispatch) }
}

#[export]
fn ffi_callback_close(callback: &FfiCallback, vm: &Vm) {
    callback.close(vm);
}

/// Leaves what is thrown pending.
#[export]
unsafe fn ffi_invocation_run(invocation: &Invocation) {
    // SAFETY: a task of the thread that made the callback.
    let _ = unsafe { invocation.run() };
}

#[export]
unsafe fn ffi_invocation_destroy(invocation: *mut Invocation) {
    // SAFETY: what `dispatch` came to own.
    drop(unsafe { Box::from_raw(invocation) });
}
