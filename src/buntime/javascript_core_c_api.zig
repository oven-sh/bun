/// *************************************
/// **** DO NOT USE THIS ON NEW CODE ****
/// *************************************
/// To generate a new class exposed to JavaScript, look at *.classes.ts
/// Otherwise, use `jsc.JSValue`.
/// ************************************
const bun = @import("bun");
const jsc = bun.jsc;
const generic = opaque {
    pub fn value(this: *const generic) jsc.JSValue {
        return @enumFromInt(@as(jsc.JSValue.backing_int, @bitCast(@intFromPtr(this))));
    }
};
pub const Private = anyopaque;
pub const struct_OpaqueJSContextGroup = generic;
pub const JSContextGroupRef = ?*const struct_OpaqueJSContextGroup;
pub const struct_OpaqueJSContext = generic;
pub const JSGlobalContextRef = ?*jsc.JSGlobalObject;

pub const struct_OpaqueJSPropertyNameAccumulator = generic;
pub const JSPropertyNameAccumulatorRef = ?*struct_OpaqueJSPropertyNameAccumulator;
pub const JSTypedArrayBytesDeallocator = ?*const fn (*anyopaque, *anyopaque) callconv(.c) void;
pub const OpaqueJSValue = generic;
pub const JSValueRef = ?*OpaqueJSValue;
pub const JSObjectRef = ?*OpaqueJSValue;
pub extern fn JSGarbageCollect(ctx: *jsc.JSGlobalObject) void;
pub const JSType = enum(c_uint) {
    kJSTypeUndefined,
    kJSTypeNull,
    kJSTypeBoolean,
    kJSTypeNumber,
    kJSTypeString,
    kJSTypeObject,
    kJSTypeSymbol,
};
pub const kJSTypeUndefined = @intFromEnum(JSType.kJSTypeUndefined);
pub const kJSTypeNull = @intFromEnum(JSType.kJSTypeNull);
pub const kJSTypeBoolean = @intFromEnum(JSType.kJSTypeBoolean);
pub const kJSTypeNumber = @intFromEnum(JSType.kJSTypeNumber);
pub const kJSTypeString = @intFromEnum(JSType.kJSTypeString);
pub const kJSTypeObject = @intFromEnum(JSType.kJSTypeObject);
pub const kJSTypeSymbol = @intFromEnum(JSType.kJSTypeSymbol);
/// From JSValueRef.h:81
pub const JSTypedArrayType = enum(c_uint) {
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
    _,
};
pub const kJSTypedArrayTypeInt8Array = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeInt8Array);
pub const kJSTypedArrayTypeInt16Array = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeInt16Array);
pub const kJSTypedArrayTypeInt32Array = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeInt32Array);
pub const kJSTypedArrayTypeUint8Array = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeUint8Array);
pub const kJSTypedArrayTypeUint8ClampedArray = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeUint8ClampedArray);
pub const kJSTypedArrayTypeUint16Array = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeUint16Array);
pub const kJSTypedArrayTypeUint32Array = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeUint32Array);
pub const kJSTypedArrayTypeFloat32Array = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeFloat32Array);
pub const kJSTypedArrayTypeFloat64Array = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeFloat64Array);
pub const kJSTypedArrayTypeArrayBuffer = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeArrayBuffer);
pub const kJSTypedArrayTypeNone = @intFromEnum(JSTypedArrayType.kJSTypedArrayTypeNone);
pub extern fn JSValueGetType(ctx: *jsc.JSGlobalObject, value: JSValueRef) JSType;
pub extern fn JSValueMakeNull(ctx: *jsc.JSGlobalObject) JSValueRef;
pub extern fn JSValueToNumber(ctx: *jsc.JSGlobalObject, value: JSValueRef, exception: ExceptionRef) f64;
pub extern fn JSValueToObject(ctx: *jsc.JSGlobalObject, value: JSValueRef, exception: ExceptionRef) JSObjectRef;

pub const JSPropertyAttributes = enum(c_uint) {
    kJSPropertyAttributeNone = 0,
    kJSPropertyAttributeReadOnly = 2,
    kJSPropertyAttributeDontEnum = 4,
    kJSPropertyAttributeDontDelete = 8,
    _,
};
pub const kJSPropertyAttributeNone = @intFromEnum(JSPropertyAttributes.kJSPropertyAttributeNone);
pub const kJSPropertyAttributeReadOnly = @intFromEnum(JSPropertyAttributes.kJSPropertyAttributeReadOnly);
pub const kJSPropertyAttributeDontEnum = @intFromEnum(JSPropertyAttributes.kJSPropertyAttributeDontEnum);
pub const kJSPropertyAttributeDontDelete = @intFromEnum(JSPropertyAttributes.kJSPropertyAttributeDontDelete);
pub const JSClassAttributes = enum(c_uint) {
    kJSClassAttributeNone = 0,
    kJSClassAttributeNoAutomaticPrototype = 2,
    _,
};

pub const kJSClassAttributeNone = @intFromEnum(JSClassAttributes.kJSClassAttributeNone);
pub const kJSClassAttributeNoAutomaticPrototype = @intFromEnum(JSClassAttributes.kJSClassAttributeNoAutomaticPrototype);
pub const JSObjectInitializeCallback = *const fn (*jsc.JSGlobalObject, JSObjectRef) callconv(.c) void;
pub const JSObjectFinalizeCallback = *const fn (JSObjectRef) callconv(.c) void;
pub const JSObjectGetPropertyNamesCallback = *const fn (*jsc.JSGlobalObject, JSObjectRef, JSPropertyNameAccumulatorRef) callconv(.c) void;
pub const ExceptionRef = [*c]JSValueRef;
pub const JSObjectCallAsFunctionCallback = *const fn (
    ctx: *jsc.JSGlobalObject,
    function: JSObjectRef,
    thisObject: JSObjectRef,
    argumentCount: usize,
    arguments: [*c]const JSValueRef,
    exception: ExceptionRef,
) callconv(.c) JSValueRef;
pub const JSObjectCallAsConstructorCallback = *const fn (*jsc.JSGlobalObject, JSObjectRef, usize, [*c]const JSValueRef, ExceptionRef) callconv(.c) JSObjectRef;
pub const JSObjectHasInstanceCallback = *const fn (*jsc.JSGlobalObject, JSObjectRef, JSValueRef, ExceptionRef) callconv(.c) bool;
pub const JSObjectConvertToTypeCallback = *const fn (*jsc.JSGlobalObject, JSObjectRef, JSType, ExceptionRef) callconv(.c) JSValueRef;

pub extern "c" fn JSObjectGetPrototype(ctx: *jsc.JSGlobalObject, object: JSObjectRef) JSValueRef;
pub extern "c" fn JSObjectGetPropertyAtIndex(ctx: *jsc.JSGlobalObject, object: JSObjectRef, propertyIndex: c_uint, exception: ExceptionRef) JSValueRef;
pub extern "c" fn JSObjectSetPropertyAtIndex(ctx: *jsc.JSGlobalObject, object: JSObjectRef, propertyIndex: c_uint, value: JSValueRef, exception: ExceptionRef) void;
pub extern "c" fn JSObjectCallAsFunction(ctx: *jsc.JSGlobalObject, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSValueRef;
pub extern "c" fn JSObjectIsConstructor(ctx: *jsc.JSGlobalObject, object: JSObjectRef) bool;
pub extern "c" fn JSObjectCallAsConstructor(ctx: *jsc.JSGlobalObject, object: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub extern "c" fn JSObjectMakeDate(ctx: *jsc.JSGlobalObject, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub const JSChar = u16;
pub extern fn JSObjectMakeTypedArray(ctx: *jsc.JSGlobalObject, arrayType: JSTypedArrayType, length: usize, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithArrayBuffer(ctx: *jsc.JSGlobalObject, arrayType: JSTypedArrayType, buffer: JSObjectRef, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithArrayBufferAndOffset(ctx: *jsc.JSGlobalObject, arrayType: JSTypedArrayType, buffer: JSObjectRef, byteOffset: usize, length: usize, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectGetTypedArrayBytesPtr(ctx: *jsc.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) ?*anyopaque;
pub extern fn JSObjectGetTypedArrayLength(ctx: *jsc.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) usize;
pub extern fn JSObjectGetTypedArrayByteLength(ctx: *jsc.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) usize;
pub extern fn JSObjectGetTypedArrayByteOffset(ctx: *jsc.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) usize;
pub extern fn JSObjectGetTypedArrayBuffer(ctx: *jsc.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectGetArrayBufferBytesPtr(ctx: *jsc.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) ?*anyopaque;
pub extern fn JSObjectGetArrayBufferByteLength(ctx: *jsc.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) usize;
pub const OpaqueJSContextGroup = struct_OpaqueJSContextGroup;
pub const OpaqueJSContext = struct_OpaqueJSContext;
pub const OpaqueJSPropertyNameAccumulator = struct_OpaqueJSPropertyNameAccumulator;

// This is a workaround for not receiving a JSException* object
// This function lets us use the C API but returns a plain old JSValue
// allowing us to have exceptions that include stack traces
pub extern "c" fn JSObjectCallAsFunctionReturnValueHoldingAPILock(ctx: *jsc.JSGlobalObject, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef) jsc.JSValue;

pub extern fn JSRemoteInspectorDisableAutoStart() void;
pub extern fn JSRemoteInspectorStart() void;

pub extern fn JSRemoteInspectorSetLogToSystemConsole(enabled: bool) void;
pub extern fn JSRemoteInspectorGetInspectionEnabledByDefault(void) bool;
pub extern fn JSRemoteInspectorSetInspectionEnabledByDefault(enabled: bool) void;

pub extern "c" fn JSObjectGetProxyTarget(JSObjectRef) JSObjectRef;
