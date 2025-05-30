/// *************************************
/// **** DO NOT USE THIS ON NEW CODE ****
/// *************************************
/// To generate a new class exposed to JavaScript, look at *.classes.ts
/// Otherwise, use `JSC.JSValue`.
/// ************************************
const bun = @import("bun");
const JSC = bun.JSC;
const generic = opaque {
    pub fn value(this: *const generic) JSC.JSValue {
        return @enumFromInt(@as(JSC.JSValue.backing_int, @bitCast(@intFromPtr(this))));
    }
};
pub const Private = anyopaque;
pub const struct_OpaqueJSContextGroup = generic;
pub const JSContextGroupRef = ?*const struct_OpaqueJSContextGroup;
pub const struct_OpaqueJSContext = generic;
pub const JSGlobalContextRef = ?*JSC.JSGlobalObject;

pub const struct_OpaqueJSPropertyNameAccumulator = generic;
pub const JSPropertyNameAccumulatorRef = ?*struct_OpaqueJSPropertyNameAccumulator;
pub const JSTypedArrayBytesDeallocator = ?*const fn (*anyopaque, *anyopaque) callconv(.C) void;
pub const OpaqueJSValue = generic;
pub const JSValueRef = ?*OpaqueJSValue;
pub const JSObjectRef = ?*OpaqueJSValue;
pub extern fn JSGarbageCollect(ctx: *JSC.JSGlobalObject) void;
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
pub extern fn JSValueGetType(ctx: *JSC.JSGlobalObject, value: JSValueRef) JSType;
pub extern fn JSValueMakeNull(ctx: *JSC.JSGlobalObject) JSValueRef;
pub extern fn JSValueToNumber(ctx: *JSC.JSGlobalObject, value: JSValueRef, exception: ExceptionRef) f64;
pub extern fn JSValueToObject(ctx: *JSC.JSGlobalObject, value: JSValueRef, exception: ExceptionRef) JSObjectRef;

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
pub const JSObjectInitializeCallback = *const fn (*JSC.JSGlobalObject, JSObjectRef) callconv(.C) void;
pub const JSObjectFinalizeCallback = *const fn (JSObjectRef) callconv(.C) void;
pub const JSObjectGetPropertyNamesCallback = *const fn (*JSC.JSGlobalObject, JSObjectRef, JSPropertyNameAccumulatorRef) callconv(.C) void;
pub const ExceptionRef = [*c]JSValueRef;
pub const JSObjectCallAsFunctionCallback = *const fn (
    ctx: *JSC.JSGlobalObject,
    function: JSObjectRef,
    thisObject: JSObjectRef,
    argumentCount: usize,
    arguments: [*c]const JSValueRef,
    exception: ExceptionRef,
) callconv(.C) JSValueRef;
pub const JSObjectCallAsConstructorCallback = *const fn (*JSC.JSGlobalObject, JSObjectRef, usize, [*c]const JSValueRef, ExceptionRef) callconv(.C) JSObjectRef;
pub const JSObjectHasInstanceCallback = *const fn (*JSC.JSGlobalObject, JSObjectRef, JSValueRef, ExceptionRef) callconv(.C) bool;
pub const JSObjectConvertToTypeCallback = *const fn (*JSC.JSGlobalObject, JSObjectRef, JSType, ExceptionRef) callconv(.C) JSValueRef;

pub extern "c" fn JSObjectGetPrototype(ctx: *JSC.JSGlobalObject, object: JSObjectRef) JSValueRef;
pub extern "c" fn JSObjectGetPropertyAtIndex(ctx: *JSC.JSGlobalObject, object: JSObjectRef, propertyIndex: c_uint, exception: ExceptionRef) JSValueRef;
pub extern "c" fn JSObjectSetPropertyAtIndex(ctx: *JSC.JSGlobalObject, object: JSObjectRef, propertyIndex: c_uint, value: JSValueRef, exception: ExceptionRef) void;
pub extern "c" fn JSObjectCallAsFunction(ctx: *JSC.JSGlobalObject, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSValueRef;
pub extern "c" fn JSObjectIsConstructor(ctx: *JSC.JSGlobalObject, object: JSObjectRef) bool;
pub extern "c" fn JSObjectCallAsConstructor(ctx: *JSC.JSGlobalObject, object: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub extern "c" fn JSObjectMakeDate(ctx: *JSC.JSGlobalObject, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub const JSChar = u16;
pub extern fn JSObjectMakeTypedArray(ctx: *JSC.JSGlobalObject, arrayType: JSTypedArrayType, length: usize, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithBytesNoCopy(ctx: *JSC.JSGlobalObject, arrayType: JSTypedArrayType, bytes: ?*anyopaque, byteLength: usize, bytesDeallocator: JSTypedArrayBytesDeallocator, deallocatorContext: ?*anyopaque, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithArrayBuffer(ctx: *JSC.JSGlobalObject, arrayType: JSTypedArrayType, buffer: JSObjectRef, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithArrayBufferAndOffset(ctx: *JSC.JSGlobalObject, arrayType: JSTypedArrayType, buffer: JSObjectRef, byteOffset: usize, length: usize, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectGetTypedArrayBytesPtr(ctx: *JSC.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) ?*anyopaque;
pub extern fn JSObjectGetTypedArrayLength(ctx: *JSC.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) usize;
pub extern fn JSObjectGetTypedArrayByteLength(ctx: *JSC.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) usize;
pub extern fn JSObjectGetTypedArrayByteOffset(ctx: *JSC.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) usize;
pub extern fn JSObjectGetTypedArrayBuffer(ctx: *JSC.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectMakeArrayBufferWithBytesNoCopy(ctx: *JSC.JSGlobalObject, bytes: ?*anyopaque, byteLength: usize, bytesDeallocator: JSTypedArrayBytesDeallocator, deallocatorContext: ?*anyopaque, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectGetArrayBufferBytesPtr(ctx: *JSC.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) ?*anyopaque;
pub extern fn JSObjectGetArrayBufferByteLength(ctx: *JSC.JSGlobalObject, object: JSObjectRef, exception: ExceptionRef) usize;
pub const OpaqueJSContextGroup = struct_OpaqueJSContextGroup;
pub const OpaqueJSContext = struct_OpaqueJSContext;
pub const OpaqueJSPropertyNameAccumulator = struct_OpaqueJSPropertyNameAccumulator;

// This is a workaround for not receiving a JSException* object
// This function lets us use the C API but returns a plain old JSValue
// allowing us to have exceptions that include stack traces
pub extern "c" fn JSObjectCallAsFunctionReturnValueHoldingAPILock(ctx: *JSC.JSGlobalObject, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef) JSC.JSValue;

pub extern fn JSRemoteInspectorDisableAutoStart() void;
pub extern fn JSRemoteInspectorStart() void;

pub extern fn JSRemoteInspectorSetLogToSystemConsole(enabled: bool) void;
pub extern fn JSRemoteInspectorGetInspectionEnabledByDefault(void) bool;
pub extern fn JSRemoteInspectorSetInspectionEnabledByDefault(enabled: bool) void;

pub extern "c" fn JSObjectGetProxyTarget(JSObjectRef) JSObjectRef;
