//! *************************************
//! **** DO NOT USE THIS ON NEW CODE ****
//! *************************************
//! To generate a new class exposed to JavaScript, look at *.classes.ts
//! Otherwise, use `bun_jsc::JSValue`.
//! ************************************
#![allow(non_camel_case_types, non_upper_case_globals, non_snake_case)]

use core::ffi::{c_uint, c_void};

use bun_jsc::{JSGlobalObject, JSValue};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle backing every `*Ref` typedef in the JavaScriptCore C API.
    /// In Zig this is a single `opaque {}` aliased under many names; we mirror that.
    pub struct Generic;
}

impl Generic {
    pub fn value(&self) -> JSValue {
        // Zig: @enumFromInt(@as(JSValue.backing_int, @bitCast(@intFromPtr(this))))
        // The JSC C API hands out JSValueRef as the cell pointer itself; reinterpreting the
        // pointer bits as an encoded JSValue is exactly what JSC::JSValue(JSCell*) does.
        JSValue::from_encoded(std::ptr::from_ref::<Self>(self) as usize)
    }
}

pub type Private = c_void;

pub type JSTypedArrayBytesDeallocator = Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>;
pub(crate) type OpaqueJSValue = Generic;
pub type JSValueRef = *mut OpaqueJSValue;
pub type JSObjectRef = *mut OpaqueJSValue;

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn JSGarbageCollect(ctx: *mut JSGlobalObject);
}

#[repr(u32)] // c_uint
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum JSType {
    kJSTypeUndefined,
    kJSTypeNull,
    kJSTypeBoolean,
    kJSTypeNumber,
    kJSTypeString,
    kJSTypeObject,
    kJSTypeSymbol,
    kJSTypeBigInt,
}

/// From JSValueRef.h:81
// TODO(port): Zig enum is non-exhaustive (`_`); only ever passed *to* C in this file so a
// #[repr(u32)] enum is sound here. If a future extern returns this, switch to a newtype.
#[repr(u32)] // c_uint
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum JSTypedArrayType {
    kJSTypedArrayTypeInt8Array,
    kJSTypedArrayTypeInt16Array,
    kJSTypedArrayTypeInt32Array,
    kJSTypedArrayTypeUint8Array,
    kJSTypedArrayTypeUint8ClampedArray,
    kJSTypedArrayTypeUint16Array,
    kJSTypedArrayTypeUint32Array,
    kJSTypedArrayTypeFloat32Array,
    kJSTypedArrayTypeFloat64Array,
    kJSTypedArrayTypeArrayBuffer,
    kJSTypedArrayTypeNone,
    kJSTypedArrayTypeBigInt64Array,
    kJSTypedArrayTypeBigUint64Array,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn JSValueGetType(ctx: *mut JSGlobalObject, value: JSValueRef) -> JSType;
    pub fn JSValueMakeNull(ctx: *mut JSGlobalObject) -> JSValueRef;
    pub fn JSValueToNumber(
        ctx: *mut JSGlobalObject,
        value: JSValueRef,
        exception: ExceptionRef,
    ) -> f64;
    pub fn JSValueToObject(
        ctx: *mut JSGlobalObject,
        value: JSValueRef,
        exception: ExceptionRef,
    ) -> JSObjectRef;
}

#[repr(u32)] // c_uint
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum JSPropertyAttributes {
    kJSPropertyAttributeNone = 0,
    kJSPropertyAttributeReadOnly = 2,
    kJSPropertyAttributeDontEnum = 4,
    kJSPropertyAttributeDontDelete = 8,
}

#[repr(u32)] // c_uint
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum JSClassAttributes {
    kJSClassAttributeNone = 0,
    kJSClassAttributeNoAutomaticPrototype = 2,
}

pub type ExceptionRef = *mut JSValueRef;

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn JSObjectGetPrototype(ctx: *mut JSGlobalObject, object: JSObjectRef) -> JSValueRef;
    pub fn JSObjectGetPropertyAtIndex(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        property_index: c_uint,
        exception: ExceptionRef,
    ) -> JSValueRef;
    pub fn JSObjectSetPropertyAtIndex(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        property_index: c_uint,
        value: JSValueRef,
        exception: ExceptionRef,
    );
    pub fn JSObjectCallAsFunction(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        this_object: JSObjectRef,
        argument_count: usize,
        arguments: *const JSValueRef,
        exception: ExceptionRef,
    ) -> JSValueRef;
    pub fn JSObjectIsConstructor(ctx: *mut JSGlobalObject, object: JSObjectRef) -> bool;
    pub fn JSObjectCallAsConstructor(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        argument_count: usize,
        arguments: *const JSValueRef,
        exception: ExceptionRef,
    ) -> JSObjectRef;
    pub fn JSObjectMakeDate(
        ctx: *mut JSGlobalObject,
        argument_count: usize,
        arguments: *const JSValueRef,
        exception: ExceptionRef,
    ) -> JSObjectRef;
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn JSObjectMakeTypedArray(
        ctx: *mut JSGlobalObject,
        array_type: JSTypedArrayType,
        length: usize,
        exception: ExceptionRef,
    ) -> JSObjectRef;
    pub(crate) fn JSObjectMakeTypedArrayWithArrayBuffer(
        ctx: *mut JSGlobalObject,
        array_type: JSTypedArrayType,
        buffer: JSObjectRef,
        exception: ExceptionRef,
    ) -> JSObjectRef;
    pub fn JSObjectMakeTypedArrayWithArrayBufferAndOffset(
        ctx: *mut JSGlobalObject,
        array_type: JSTypedArrayType,
        buffer: JSObjectRef,
        byte_offset: usize,
        length: usize,
        exception: ExceptionRef,
    ) -> JSObjectRef;
    pub fn JSObjectGetTypedArrayBytesPtr(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        exception: ExceptionRef,
    ) -> *mut c_void;
    pub fn JSObjectGetTypedArrayLength(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        exception: ExceptionRef,
    ) -> usize;
    pub fn JSObjectGetTypedArrayByteLength(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        exception: ExceptionRef,
    ) -> usize;
    pub fn JSObjectGetTypedArrayByteOffset(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        exception: ExceptionRef,
    ) -> usize;
    pub fn JSObjectGetTypedArrayBuffer(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        exception: ExceptionRef,
    ) -> JSObjectRef;
    pub fn JSObjectGetArrayBufferBytesPtr(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        exception: ExceptionRef,
    ) -> *mut c_void;
    pub fn JSObjectGetArrayBufferByteLength(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        exception: ExceptionRef,
    ) -> usize;
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    /// This is a workaround for not receiving a JSException* object
    /// This function lets us use the C API but returns a plain old JSValue
    /// allowing us to have exceptions that include stack traces
    pub fn JSObjectCallAsFunctionReturnValueHoldingAPILock(
        ctx: *mut JSGlobalObject,
        object: JSObjectRef,
        this_object: JSObjectRef,
        argument_count: usize,
        arguments: *const JSValueRef,
    ) -> JSValue;

    // safe: no parameters / by-value `bool` only — process-global JSC inspector
    // toggles with no Rust-side preconditions.
    pub safe fn JSRemoteInspectorDisableAutoStart();
    pub safe fn JSRemoteInspectorStart();

    pub safe fn JSRemoteInspectorSetLogToSystemConsole(enabled: bool);
    pub safe fn JSRemoteInspectorGetInspectionEnabledByDefault() -> bool;
    pub safe fn JSRemoteInspectorSetInspectionEnabledByDefault(enabled: bool);

    pub fn JSObjectGetProxyTarget(object: JSObjectRef) -> JSObjectRef;
}

// ported from: src/jsc/javascript_core_c_api.zig
