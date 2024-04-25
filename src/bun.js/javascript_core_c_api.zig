/// *************************************
/// **** DO NOT USE THIS ON NEW CODE ****
/// *************************************
/// To generate a new class exposed to JavaScript, look at *.classes.ts
/// Otherwise, use `JSC.JSValue`.
/// ************************************
const bun = @import("root").bun;
const std = @import("std");
const cpp = @import("./bindings/bindings.zig");
const generic = opaque {
    pub fn value(this: *const @This()) cpp.JSValue {
        return @as(cpp.JSValue, @enumFromInt(@as(cpp.JSValue.Type, @bitCast(@intFromPtr(this)))));
    }

    pub inline fn bunVM(this: *@This()) *bun.JSC.VirtualMachine {
        return this.ptr().bunVM();
    }
};
pub const Private = anyopaque;
pub const struct_OpaqueJSContextGroup = generic;
pub const JSContextGroupRef = ?*const struct_OpaqueJSContextGroup;
pub const struct_OpaqueJSContext = generic;
pub const JSContextRef = *cpp.JSGlobalObject;
pub const JSGlobalContextRef = ?*cpp.JSGlobalObject;

pub const struct_OpaqueJSPropertyNameAccumulator = generic;
pub const JSPropertyNameAccumulatorRef = ?*struct_OpaqueJSPropertyNameAccumulator;
pub const JSTypedArrayBytesDeallocator = ?*const fn (*anyopaque, *anyopaque) callconv(.C) void;
pub const OpaqueJSValue = generic;
pub const JSValueRef = ?*OpaqueJSValue;
pub const JSObjectRef = ?*OpaqueJSValue;
pub extern fn JSGarbageCollect(ctx: JSContextRef) void;
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
pub extern fn JSValueGetType(ctx: JSContextRef, value: JSValueRef) JSType;
pub extern fn JSValueMakeNull(ctx: JSContextRef) JSValueRef;
pub extern fn JSValueToNumber(ctx: JSContextRef, value: JSValueRef, exception: ExceptionRef) f64;
pub extern fn JSValueToObject(ctx: JSContextRef, value: JSValueRef, exception: ExceptionRef) JSObjectRef;

const log_protection = bun.Environment.allow_assert and false;
pub inline fn JSValueUnprotect(ctx: JSContextRef, value: JSValueRef) void {
    const Wrapped = struct {
        pub extern fn JSValueUnprotect(ctx: JSContextRef, value: JSValueRef) void;
    };
    if (comptime log_protection) {
        const Output = bun.Output;
        Output.debug("[unprotect] {d}\n", .{@intFromPtr(value)});
    }
    // wrapper exists to make it easier to set a breakpoint
    Wrapped.JSValueUnprotect(ctx, value);
}

pub inline fn JSValueProtect(ctx: JSContextRef, value: JSValueRef) void {
    const Wrapped = struct {
        pub extern fn JSValueProtect(ctx: JSContextRef, value: JSValueRef) void;
    };
    if (comptime log_protection) {
        const Output = bun.Output;
        Output.debug("[protect] {d}\n", .{@intFromPtr(value)});
    }
    // wrapper exists to make it easier to set a breakpoint
    Wrapped.JSValueProtect(ctx, value);
}

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
pub const JSObjectInitializeCallback = *const fn (JSContextRef, JSObjectRef) callconv(.C) void;
pub const JSObjectFinalizeCallback = *const fn (JSObjectRef) callconv(.C) void;
pub const JSObjectGetPropertyNamesCallback = *const fn (JSContextRef, JSObjectRef, JSPropertyNameAccumulatorRef) callconv(.C) void;
pub const ExceptionRef = [*c]JSValueRef;
pub const JSObjectCallAsFunctionCallback = *const fn (
    ctx: JSContextRef,
    function: JSObjectRef,
    thisObject: JSObjectRef,
    argumentCount: usize,
    arguments: [*c]const JSValueRef,
    exception: ExceptionRef,
) callconv(.C) JSValueRef;
pub const JSObjectCallAsConstructorCallback = *const fn (JSContextRef, JSObjectRef, usize, [*c]const JSValueRef, ExceptionRef) callconv(.C) JSObjectRef;
pub const JSObjectHasInstanceCallback = *const fn (JSContextRef, JSObjectRef, JSValueRef, ExceptionRef) callconv(.C) bool;
pub const JSObjectConvertToTypeCallback = *const fn (JSContextRef, JSObjectRef, JSType, ExceptionRef) callconv(.C) JSValueRef;

pub extern "c" fn JSObjectGetPrototype(ctx: JSContextRef, object: JSObjectRef) JSValueRef;
pub extern "c" fn JSObjectGetPropertyAtIndex(ctx: JSContextRef, object: JSObjectRef, propertyIndex: c_uint, exception: ExceptionRef) JSValueRef;
pub extern "c" fn JSObjectSetPropertyAtIndex(ctx: JSContextRef, object: JSObjectRef, propertyIndex: c_uint, value: JSValueRef, exception: ExceptionRef) void;
pub extern "c" fn JSObjectCallAsFunction(ctx: JSContextRef, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSValueRef;
pub extern "c" fn JSObjectIsConstructor(ctx: JSContextRef, object: JSObjectRef) bool;
pub extern "c" fn JSObjectCallAsConstructor(ctx: JSContextRef, object: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub extern "c" fn JSObjectMakeDate(ctx: JSContextRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub const JSChar = u16;
pub extern fn JSObjectMakeTypedArray(ctx: JSContextRef, arrayType: JSTypedArrayType, length: usize, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithBytesNoCopy(ctx: JSContextRef, arrayType: JSTypedArrayType, bytes: ?*anyopaque, byteLength: usize, bytesDeallocator: JSTypedArrayBytesDeallocator, deallocatorContext: ?*anyopaque, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithArrayBuffer(ctx: JSContextRef, arrayType: JSTypedArrayType, buffer: JSObjectRef, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithArrayBufferAndOffset(ctx: JSContextRef, arrayType: JSTypedArrayType, buffer: JSObjectRef, byteOffset: usize, length: usize, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectGetTypedArrayBytesPtr(ctx: JSContextRef, object: JSObjectRef, exception: ExceptionRef) ?*anyopaque;
pub extern fn JSObjectGetTypedArrayLength(ctx: JSContextRef, object: JSObjectRef, exception: ExceptionRef) usize;
pub extern fn JSObjectGetTypedArrayByteLength(ctx: JSContextRef, object: JSObjectRef, exception: ExceptionRef) usize;
pub extern fn JSObjectGetTypedArrayByteOffset(ctx: JSContextRef, object: JSObjectRef, exception: ExceptionRef) usize;
pub extern fn JSObjectGetTypedArrayBuffer(ctx: JSContextRef, object: JSObjectRef, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectMakeArrayBufferWithBytesNoCopy(ctx: JSContextRef, bytes: ?*anyopaque, byteLength: usize, bytesDeallocator: JSTypedArrayBytesDeallocator, deallocatorContext: ?*anyopaque, exception: ExceptionRef) JSObjectRef;
pub extern fn JSObjectGetArrayBufferBytesPtr(ctx: JSContextRef, object: JSObjectRef, exception: ExceptionRef) ?*anyopaque;
pub extern fn JSObjectGetArrayBufferByteLength(ctx: JSContextRef, object: JSObjectRef, exception: ExceptionRef) usize;
pub const OpaqueJSContextGroup = struct_OpaqueJSContextGroup;
pub const OpaqueJSContext = struct_OpaqueJSContext;
pub const OpaqueJSPropertyNameAccumulator = struct_OpaqueJSPropertyNameAccumulator;

// This is a workaround for not receiving a JSException* object
// This function lets us use the C API but returns a plain old JSValue
// allowing us to have exceptions that include stack traces
pub extern "c" fn JSObjectCallAsFunctionReturnValue(ctx: JSContextRef, object: cpp.JSValue, thisObject: cpp.JSValue, argumentCount: usize, arguments: [*c]const JSValueRef) cpp.JSValue;
pub extern "c" fn JSObjectCallAsFunctionReturnValueHoldingAPILock(ctx: JSContextRef, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef) cpp.JSValue;

pub extern fn JSRemoteInspectorDisableAutoStart() void;
pub extern fn JSRemoteInspectorStart() void;

pub extern fn JSRemoteInspectorSetLogToSystemConsole(enabled: bool) void;
pub extern fn JSRemoteInspectorGetInspectionEnabledByDefault(void) bool;
pub extern fn JSRemoteInspectorSetInspectionEnabledByDefault(enabled: bool) void;

// -- Manual --

const size_t = usize;

pub const CellType = enum(u8) {
    pub const LastMaybeFalsyCellPrimitive = 2;
    pub const LastJSCObjectType = 73;

    CellType = 0,
    StringType = 1,
    HeapBigIntType = 2,

    SymbolType = 3,
    GetterSetterType = 4,
    CustomGetterSetterType = 5,
    APIValueWrapperType = 6,
    NativeExecutableType = 7,
    ProgramExecutableType = 8,
    ModuleProgramExecutableType = 9,
    EvalExecutableType = 10,
    FunctionExecutableType = 11,
    UnlinkedFunctionExecutableType = 12,
    UnlinkedProgramCodeBlockType = 13,
    UnlinkedModuleProgramCodeBlockType = 14,
    UnlinkedEvalCodeBlockType = 15,
    UnlinkedFunctionCodeBlockType = 16,
    CodeBlockType = 17,
    JSImmutableButterflyType = 18,
    JSSourceCodeType = 19,
    JSScriptFetcherType = 20,
    JSScriptFetchParametersType = 21,
    ObjectType = 22,
    FinalObjectType = 23,
    JSCalleeType = 24,
    JSFunctionType = 25,
    InternalFunctionType = 26,
    NullSetterFunctionType = 27,
    BooleanObjectType = 28,
    NumberObjectType = 29,
    ErrorInstanceType = 30,
    GlobalProxyType = 31,
    DirectArgumentsType = 32,
    ScopedArgumentsType = 33,
    ClonedArgumentsType = 34,
    ArrayType = 35,
    DerivedArrayType = 36,
    ArrayBufferType = 37,
    Int8ArrayType = 38,
    Uint8ArrayType = 39,
    Uint8ClampedArrayType = 40,
    Int16ArrayType = 41,
    Uint16ArrayType = 42,
    Int32ArrayType = 43,
    Uint32ArrayType = 44,
    Float32ArrayType = 45,
    Float64ArrayType = 46,
    BigInt64ArrayType = 47,
    BigUint64ArrayType = 48,
    DataViewType = 49,
    GlobalObjectType = 50,
    GlobalLexicalEnvironmentType = 51,
    LexicalEnvironmentType = 52,
    ModuleEnvironmentType = 53,
    StrictEvalActivationType = 54,
    WithScopeType = 55,
    ModuleNamespaceObjectType = 56,
    RegExpObjectType = 57,
    JSDateType = 58,
    ProxyObjectType = 59,
    JSGeneratorType = 60,
    JSAsyncGeneratorType = 61,
    JSArrayIteratorType = 62,
    JSMapIteratorType = 63,
    JSSetIteratorType = 64,
    JSStringIteratorType = 65,
    JSPromiseType = 66,
    JSMapType = 67,
    JSSetType = 68,
    JSWeakMapType = 69,
    JSWeakSetType = 70,
    WebAssemblyModuleType = 71,
    WebAssemblyInstanceType = 72,
    WebAssemblyGCObjectType = 73,
    StringObjectType = 74,
    DerivedStringObjectType = 75,

    MaxJSType = 255,
    _,

    pub fn isString(this: CellType) bool {
        return switch (this) {
            .StringType => true,
            else => false,
        };
    }
};

pub extern "c" fn JSObjectGetProxyTarget(JSObjectRef) JSObjectRef;
