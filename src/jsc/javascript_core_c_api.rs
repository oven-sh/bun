//! *************************************
//! **** DO NOT USE THIS ON NEW CODE ****
//! *************************************
//! To generate a new class exposed to JavaScript, look at *.classes.ts
//! Otherwise, use `bun_jsc::JSValue`.
//! ************************************
#![allow(non_camel_case_types, non_upper_case_globals, non_snake_case)]

use core::ffi::{c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};

use bun_jsc::{JSGlobalObject, JSValue};

/// Opaque FFI handle backing every `*Ref` typedef in the JavaScriptCore C API.
/// In Zig this is a single `opaque {}` aliased under many names; we mirror that.
#[repr(C)]
pub struct Generic {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl Generic {
    pub fn value(&self) -> JSValue {
        // Zig: @enumFromInt(@as(JSValue.backing_int, @bitCast(@intFromPtr(this))))
        // SAFETY: JSValue is #[repr(transparent)] over i64. The JSC C API hands out
        // JSValueRef as the cell pointer itself; reinterpreting the pointer bits as
        // an encoded JSValue is exactly what JSC::JSValue(JSCell*) does.
        unsafe { core::mem::transmute::<i64, JSValue>(self as *const Self as usize as i64) }
    }
}

pub type Private = c_void;
pub type struct_OpaqueJSContextGroup = Generic;
pub type JSContextGroupRef = *const struct_OpaqueJSContextGroup;
pub type struct_OpaqueJSContext = Generic;
pub type JSGlobalContextRef = *mut JSGlobalObject;

pub type struct_OpaqueJSPropertyNameAccumulator = Generic;
pub type JSPropertyNameAccumulatorRef = *mut struct_OpaqueJSPropertyNameAccumulator;
pub type JSTypedArrayBytesDeallocator = Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>;
pub type OpaqueJSValue = Generic;
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
pub const kJSTypeUndefined: c_uint = JSType::kJSTypeUndefined as c_uint;
pub const kJSTypeNull: c_uint = JSType::kJSTypeNull as c_uint;
pub const kJSTypeBoolean: c_uint = JSType::kJSTypeBoolean as c_uint;
pub const kJSTypeNumber: c_uint = JSType::kJSTypeNumber as c_uint;
pub const kJSTypeString: c_uint = JSType::kJSTypeString as c_uint;
pub const kJSTypeObject: c_uint = JSType::kJSTypeObject as c_uint;
pub const kJSTypeSymbol: c_uint = JSType::kJSTypeSymbol as c_uint;
pub const kJSTypeBigInt: c_uint = JSType::kJSTypeBigInt as c_uint;

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
pub const kJSTypedArrayTypeInt8Array: c_uint = JSTypedArrayType::kJSTypedArrayTypeInt8Array as c_uint;
pub const kJSTypedArrayTypeInt16Array: c_uint = JSTypedArrayType::kJSTypedArrayTypeInt16Array as c_uint;
pub const kJSTypedArrayTypeInt32Array: c_uint = JSTypedArrayType::kJSTypedArrayTypeInt32Array as c_uint;
pub const kJSTypedArrayTypeUint8Array: c_uint = JSTypedArrayType::kJSTypedArrayTypeUint8Array as c_uint;
pub const kJSTypedArrayTypeUint8ClampedArray: c_uint = JSTypedArrayType::kJSTypedArrayTypeUint8ClampedArray as c_uint;
pub const kJSTypedArrayTypeUint16Array: c_uint = JSTypedArrayType::kJSTypedArrayTypeUint16Array as c_uint;
pub const kJSTypedArrayTypeUint32Array: c_uint = JSTypedArrayType::kJSTypedArrayTypeUint32Array as c_uint;
pub const kJSTypedArrayTypeFloat32Array: c_uint = JSTypedArrayType::kJSTypedArrayTypeFloat32Array as c_uint;
pub const kJSTypedArrayTypeFloat64Array: c_uint = JSTypedArrayType::kJSTypedArrayTypeFloat64Array as c_uint;
pub const kJSTypedArrayTypeArrayBuffer: c_uint = JSTypedArrayType::kJSTypedArrayTypeArrayBuffer as c_uint;
pub const kJSTypedArrayTypeNone: c_uint = JSTypedArrayType::kJSTypedArrayTypeNone as c_uint;

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn JSValueGetType(ctx: *mut JSGlobalObject, value: JSValueRef) -> JSType;
    pub fn JSValueMakeNull(ctx: *mut JSGlobalObject) -> JSValueRef;
    pub fn JSValueToNumber(ctx: *mut JSGlobalObject, value: JSValueRef, exception: ExceptionRef) -> f64;
    pub fn JSValueToObject(ctx: *mut JSGlobalObject, value: JSValueRef, exception: ExceptionRef) -> JSObjectRef;
}

// TODO(port): Zig enum is non-exhaustive (`_`); never crosses FFI in this file.
#[repr(u32)] // c_uint
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum JSPropertyAttributes {
    kJSPropertyAttributeNone = 0,
    kJSPropertyAttributeReadOnly = 2,
    kJSPropertyAttributeDontEnum = 4,
    kJSPropertyAttributeDontDelete = 8,
}
pub const kJSPropertyAttributeNone: c_uint = JSPropertyAttributes::kJSPropertyAttributeNone as c_uint;
pub const kJSPropertyAttributeReadOnly: c_uint = JSPropertyAttributes::kJSPropertyAttributeReadOnly as c_uint;
pub const kJSPropertyAttributeDontEnum: c_uint = JSPropertyAttributes::kJSPropertyAttributeDontEnum as c_uint;
pub const kJSPropertyAttributeDontDelete: c_uint = JSPropertyAttributes::kJSPropertyAttributeDontDelete as c_uint;

// TODO(port): Zig enum is non-exhaustive (`_`); never crosses FFI in this file.
#[repr(u32)] // c_uint
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum JSClassAttributes {
    kJSClassAttributeNone = 0,
    kJSClassAttributeNoAutomaticPrototype = 2,
}

pub const kJSClassAttributeNone: c_uint = JSClassAttributes::kJSClassAttributeNone as c_uint;
pub const kJSClassAttributeNoAutomaticPrototype: c_uint = JSClassAttributes::kJSClassAttributeNoAutomaticPrototype as c_uint;

pub type JSObjectInitializeCallback = unsafe extern "C" fn(*mut JSGlobalObject, JSObjectRef);
pub type JSObjectFinalizeCallback = unsafe extern "C" fn(JSObjectRef);
pub type JSObjectGetPropertyNamesCallback =
    unsafe extern "C" fn(*mut JSGlobalObject, JSObjectRef, JSPropertyNameAccumulatorRef);
pub type ExceptionRef = *mut JSValueRef;
pub type JSObjectCallAsFunctionCallback = unsafe extern "C" fn(
    ctx: *mut JSGlobalObject,
    function: JSObjectRef,
    this_object: JSObjectRef,
    argument_count: usize,
    arguments: *const JSValueRef,
    exception: ExceptionRef,
) -> JSValueRef;
pub type JSObjectCallAsConstructorCallback =
    unsafe extern "C" fn(*mut JSGlobalObject, JSObjectRef, usize, *const JSValueRef, ExceptionRef) -> JSObjectRef;
pub type JSObjectHasInstanceCallback =
    unsafe extern "C" fn(*mut JSGlobalObject, JSObjectRef, JSValueRef, ExceptionRef) -> bool;
pub type JSObjectConvertToTypeCallback =
    unsafe extern "C" fn(*mut JSGlobalObject, JSObjectRef, JSType, ExceptionRef) -> JSValueRef;

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

pub type JSChar = u16;

// TODO(port): move to jsc_sys
unsafe extern "C" {
    pub fn JSObjectMakeTypedArray(
        ctx: *mut JSGlobalObject,
        array_type: JSTypedArrayType,
        length: usize,
        exception: ExceptionRef,
    ) -> JSObjectRef;
    pub fn JSObjectMakeTypedArrayWithArrayBuffer(
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

pub type OpaqueJSContextGroup = struct_OpaqueJSContextGroup;
pub type OpaqueJSContext = struct_OpaqueJSContext;
pub type OpaqueJSPropertyNameAccumulator = struct_OpaqueJSPropertyNameAccumulator;

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

    pub fn JSRemoteInspectorDisableAutoStart();
    pub fn JSRemoteInspectorStart();

    pub fn JSRemoteInspectorSetLogToSystemConsole(enabled: bool);
    pub fn JSRemoteInspectorGetInspectionEnabledByDefault() -> bool;
    pub fn JSRemoteInspectorSetInspectionEnabledByDefault(enabled: bool);

    pub fn JSObjectGetProxyTarget(object: JSObjectRef) -> JSObjectRef;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/javascript_core_c_api.zig (147 lines)
//   confidence: high
//   todos:      6
//   notes:      Legacy JSC C-API FFI shims; non-exhaustive Zig enums mapped to #[repr(u32)] (safe: input-only here). Phase B may fold into jsc_sys.
// ──────────────────────────────────────────────────────────────────────────
