//! src/jsc/bindings/TelemetryBindings.cpp

use core::ffi::c_void;

use bun_core::{String as BunString, StringView};
use bun_jsc::host_fn::{JSHostFn, from_js_host_call, from_js_host_call_generic};
use bun_jsc::{JSGlobalObject, JSPromise, JSType, JSValue, JsResult};

#[repr(C)]
#[derive(Default)]
pub struct ErrorDescription {
    pub(crate) ty: BunString,
    pub(crate) message: BunString,
    pub(crate) stack: BunString,
    pub(crate) errno: BunString,
    pub(crate) is_nullish: bool,
}

type AttributeCallback = unsafe extern "C" fn(*mut c_void, &StringView<'_>, JSValue);

unsafe extern "C" {
    safe fn Bun__Telemetry__activeBinding(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Telemetry__setActiveBinding(global: &JSGlobalObject, binding: JSValue);
    safe fn Bun__Telemetry__contextKeptFor(global: &JSGlobalObject, span: JSValue) -> JSValue;
    safe fn Bun__Telemetry__keepContextFor(
        global: &JSGlobalObject,
        span: JSValue,
        context: JSValue,
    );
    safe fn Bun__Telemetry__enter(
        global: &JSGlobalObject,
        binding: JSValue,
        prior: &mut JSValue,
    ) -> JSValue;
    safe fn Bun__Telemetry__exit(global: &JSGlobalObject, entered: JSValue, prior: JSValue);
    safe fn Bun__Telemetry__callbackUnderActiveSpan(
        global: &JSGlobalObject,
        callback: JSValue,
    ) -> JSValue;
    fn Bun__Telemetry__forEachAttribute(
        global: &JSGlobalObject,
        object: JSValue,
        context: *mut c_void,
        each: AttributeCallback,
    );
    fn Bun__Telemetry__borrowString(string: JSValue) -> StringView<'static>;
    fn Bun__Telemetry__arrayLength(array: JSValue) -> u32;
    fn Bun__Telemetry__arrayElement(array: JSValue, index: u32) -> JSValue;
    safe fn Bun__Telemetry__describeError(
        global: &JSGlobalObject,
        error: JSValue,
        runs_getters: bool,
        out: &mut ErrorDescription,
    );
    safe fn Bun__Telemetry__describePassingError(
        global: &JSGlobalObject,
        error: JSValue,
        out: &mut ErrorDescription,
    ) -> bool;
    fn Bun__Telemetry__assign(
        global: &JSGlobalObject,
        object: JSValue,
        key: &BunString,
        value: JSValue,
    );
    safe fn Bun__Telemetry__processEnv(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Telemetry__kindOfFunction(function: JSValue) -> FunctionKind;
    safe fn Bun__Telemetry__createForwarder(
        global: &JSGlobalObject,
        body: JSHostFn,
        name: &BunString,
        length: u32,
        target: JSValue,
        data: JSValue,
    ) -> JSValue;
    fn Bun__Telemetry__forwarderTarget(forwarder: JSValue, data: &mut JSValue) -> JSValue;
    safe fn Bun__Telemetry__isForwarder(value: JSValue, body: JSHostFn) -> bool;
    safe fn Bun__Telemetry__observe(
        global: &JSGlobalObject,
        promise: &JSPromise,
        span: JSValue,
        on_resolve: JSHostFn,
        on_reject: JSHostFn,
    );
    safe fn Bun__Telemetry__adoptThenable(global: &JSGlobalObject, value: JSValue) -> JSValue;
    safe fn Bun__Telemetry__rejectionReason(promise: &JSPromise) -> JSValue;
    safe fn Bun__Telemetry__rootContext(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Telemetry__registerWithApi(global: &JSGlobalObject);
}

/// See [`crate::context::active_binding`].
#[inline]
pub(crate) fn binding_in_place(global: &JSGlobalObject) -> Option<JSValue> {
    Some(Bun__Telemetry__activeBinding(global)).filter(|binding| !binding.is_empty())
}

pub(crate) fn set_active_binding(global: &JSGlobalObject, binding: Option<JSValue>) {
    Bun__Telemetry__setActiveBinding(global, binding.unwrap_or_default());
}

/// What [`keep_context_for`] has left in the frame that binds `span`.
pub(crate) fn context_kept_for(global: &JSGlobalObject, span: JSValue) -> Option<JSValue> {
    Some(Bun__Telemetry__contextKeptFor(global, span)).filter(|context| context.is_cell())
}

pub(crate) fn keep_context_for(global: &JSGlobalObject, span: JSValue, context: JSValue) {
    Bun__Telemetry__keepContextFor(global, span, context);
}

/// Keeps a span active until it drops. It lives on the stack, where the GC finds what it puts back.
pub(crate) struct Entered<'a> {
    global: &'a JSGlobalObject,
    entered: JSValue,
    prior: JSValue,
}

impl<'a> Entered<'a> {
    #[inline]
    pub(crate) fn new(global: &'a JSGlobalObject, binding: Option<JSValue>) -> Entered<'a> {
        let mut prior = JSValue::UNDEFINED;
        let entered = Bun__Telemetry__enter(global, binding.unwrap_or_default(), &mut prior);
        Entered {
            global,
            entered,
            prior,
        }
    }

    #[inline]
    pub(crate) fn adopt(&self, callback: JSValue) -> JSValue {
        // An AsyncContextFrame is no function.
        if callback.is_cell() && callback.js_type() != JSType::Object {
            return callback;
        }
        Bun__Telemetry__callbackUnderActiveSpan(self.global, callback)
    }
}

impl Drop for Entered<'_> {
    #[inline]
    fn drop(&mut self) {
        Bun__Telemetry__exit(self.global, self.entered, self.prior);
    }
}

/// `Object.entries(object)`. `each` must not run JavaScript.
pub(crate) fn for_each_attribute<F: FnMut(&[u8], JSValue) -> JsResult<()>>(
    global: &JSGlobalObject,
    object: JSValue,
    each: F,
) -> JsResult<()> {
    #[optimize(speed)]
    unsafe extern "C" fn call<F: FnMut(&[u8], JSValue) -> JsResult<()>>(
        context: *mut c_void,
        key: &StringView<'_>,
        value: JSValue,
    ) {
        // SAFETY: the pair below, which nothing else uses during the call.
        let (each, result) = unsafe { &mut *context.cast::<(F, JsResult<()>)>() };
        if result.is_ok() {
            *result = each(&key.to_utf8(), value);
        }
    }
    assert!(object.is_object());
    let mut context = (each, Ok(()));
    from_js_host_call_generic(global, || {
        // SAFETY: `object` is an object, and `context` is what `call::<F>` takes.
        unsafe {
            Bun__Telemetry__forEachAttribute(global, object, (&raw mut context).cast(), call::<F>)
        }
    })?;
    context.1
}

/// The characters of `string`, which the caller keeps alive. Empty if there is no memory to resolve a rope.
#[inline]
pub(crate) fn borrow_string<'a>(string: JSValue) -> StringView<'a> {
    assert!(string.is_string_literal());
    // SAFETY: a string, whose cell owns the characters.
    unsafe { Bun__Telemetry__borrowString(string) }
}

/// An array whose elements are read without running JavaScript.
#[derive(Clone, Copy)]
pub(crate) struct PlainArray(JSValue);

impl PlainArray {
    #[inline]
    pub(crate) fn new(value: JSValue) -> Option<PlainArray> {
        value.is_array().then_some(PlainArray(value))
    }

    pub(crate) fn len(self) -> u32 {
        // SAFETY: `new` tested for an array.
        unsafe { Bun__Telemetry__arrayLength(self.0) }
    }

    /// `None` for a hole or an accessor.
    pub(crate) fn get(self, index: u32) -> Option<JSValue> {
        // SAFETY: `new` tested for an array.
        Some(unsafe { Bun__Telemetry__arrayElement(self.0, index) }).filter(|v| !v.is_empty())
    }
}

/// For an error that script handed over to be described.
pub(crate) fn describe_error(
    global: &JSGlobalObject,
    error: JSValue,
) -> JsResult<ErrorDescription> {
    let mut out = ErrorDescription::default();
    from_js_host_call_generic(global, || {
        Bun__Telemetry__describeError(global, error, true, &mut out)
    })?;
    Ok(out)
}

/// For a thrown value or its `Exception` on its way to somebody else. Runs no script.
pub(crate) fn describe_passing_error(global: &JSGlobalObject, error: JSValue) -> ErrorDescription {
    let mut out = ErrorDescription::default();
    Bun__Telemetry__describePassingError(global, error, &mut out);
    out
}

/// It stays pending.
pub(crate) fn describe_pending_exception(global: &JSGlobalObject) -> Option<ErrorDescription> {
    let mut out = ErrorDescription::default();
    Bun__Telemetry__describePassingError(global, JSValue::ZERO, &mut out).then_some(out)
}

/// `object[key] = value`
pub(crate) fn assign(
    global: &JSGlobalObject,
    object: JSValue,
    key: &'static str,
    value: JSValue,
) -> JsResult<()> {
    assert!(object.is_object());
    from_js_host_call_generic(global, || {
        // SAFETY: `object` is an object.
        unsafe { Bun__Telemetry__assign(global, object, &BunString::static_(key), value) }
    })
}

pub(crate) fn process_env(global: &JSGlobalObject) -> JsResult<JSValue> {
    from_js_host_call(global, || Bun__Telemetry__processEnv(global))
}

#[repr(transparent)]
#[derive(PartialEq, Eq)]
pub(crate) struct FunctionKind(u8);

impl FunctionKind {
    pub(crate) const GENERATOR: FunctionKind = FunctionKind(1);
    pub(crate) const CLASS: FunctionKind = FunctionKind(2);
}

pub(crate) fn kind_of_function(function: JSValue) -> FunctionKind {
    Bun__Telemetry__kindOfFunction(function)
}

/// A function that runs `body`, which gets `target` and `data` back from [`forwarder_parts`].
pub(crate) fn create_forwarder(
    global: &JSGlobalObject,
    body: JSHostFn,
    name: &BunString,
    length: u32,
    target: JSValue,
    data: JSValue,
) -> JSValue {
    Bun__Telemetry__createForwarder(global, body, name, length, target, data)
}

/// # Safety
/// `forwarder` came from [`create_forwarder`].
pub(crate) unsafe fn forwarder_parts(forwarder: JSValue) -> (JSValue, JSValue) {
    let mut data = JSValue::UNDEFINED;
    // SAFETY: forwarded.
    let target = unsafe { Bun__Telemetry__forwarderTarget(forwarder, &mut data) };
    (target, data)
}

pub(crate) fn is_forwarder(value: JSValue, body: JSHostFn) -> bool {
    Bun__Telemetry__isForwarder(value, body)
}

/// Calls one of the two with `(value, span)`, and leaves `promise`, which is pending, as unhandled as it is.
pub(crate) fn observe(
    global: &JSGlobalObject,
    promise: &JSPromise,
    span: JSValue,
    on_resolve: JSHostFn,
    on_reject: JSHostFn,
) {
    Bun__Telemetry__observe(global, promise, span, on_resolve, on_reject);
}

/// A promise for a thenable with a `then()` of its own, which runs in the async context of this call. Anything else as it is.
#[inline]
pub(crate) fn adopt_thenable(global: &JSGlobalObject, value: JSValue) -> JsResult<JSValue> {
    if !value.is_object() {
        return Ok(value);
    }
    from_js_host_call(global, || Bun__Telemetry__adoptThenable(global, value))
}

/// Unlike `JSPromise::result`, it does not mark the rejection as handled.
pub(crate) fn rejection_reason(promise: &JSPromise) -> JSValue {
    Bun__Telemetry__rejectionReason(promise)
}

pub(crate) fn root_context(global: &JSGlobalObject) -> JsResult<JSValue> {
    from_js_host_call(global, || Bun__Telemetry__rootContext(global))
}

pub(crate) fn register_with_api(global: &JSGlobalObject) -> JsResult<()> {
    from_js_host_call_generic(global, || Bun__Telemetry__registerWithApi(global))
}
