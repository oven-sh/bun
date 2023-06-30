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
        return @enumFromInt(cpp.JSValue, @bitCast(cpp.JSValue.Type, @intFromPtr(this)));
    }

    pub inline fn bunVM(this: *@This()) *@import("root").bun.JSC.VirtualMachine {
        return this.ptr().bunVM();
    }
};
pub const Private = anyopaque;
pub const struct_OpaqueJSContextGroup = generic;
pub const JSContextGroupRef = ?*const struct_OpaqueJSContextGroup;
pub const struct_OpaqueJSContext = generic;
pub const JSContextRef = *cpp.JSGlobalObject;
pub const JSGlobalContextRef = ?*cpp.JSGlobalObject;
pub const OpaqueJSString = opaque {
    pub fn len(this: *OpaqueJSString) usize {
        return JSStringGetLength(this);
    }

    pub fn is16Bit(this: *OpaqueJSString) bool {
        return JSStringEncoding(this) == Encoding.char16;
    }

    pub fn characters16(this: *OpaqueJSString) UTF16Ptr {
        if (comptime bun.Environment.allow_assert)
            std.debug.assert(this.is16Bit());

        return JSStringGetCharactersPtr(this);
    }

    pub fn characters8(this: *OpaqueJSString) UTF8Ptr {
        if (comptime bun.Environment.allow_assert)
            std.debug.assert(!this.is16Bit());

        return JSStringGetCharacters8Ptr(this);
    }

    pub fn latin1Slice(this: *OpaqueJSString) []const u8 {
        const _len = this.len();
        if (_len == 0) return "";
        return this.characters8()[0.._len];
    }

    pub fn utf16Slice(this: *OpaqueJSString) []const u16 {
        const _len = this.len();
        if (_len == 0) return &[_]u16{};
        return this.characters16()[0.._len];
    }

    pub fn toZigString(this: *OpaqueJSString) cpp.ZigString {
        if (this.is16Bit()) {
            return cpp.ZigString.init16(this.utf16Slice());
        } else {
            return cpp.ZigString.init(this.latin1Slice());
        }
    }

    pub fn fromZigString(zig_str: cpp.ZigString, allocator: std.mem.Allocator) *OpaqueJSString {
        if (zig_str.isEmpty()) {
            return JSStringCreateWithUTF8CString("");
        }

        if (zig_str.isUTF8()) {
            return JSValueToStringCopy(
                bun.JSC.VirtualMachine.get().global,
                zig_str.toValueGC(bun.JSC.VirtualMachine.get().global).asObjectRef(),
                null,
            );
        }

        if (zig_str.is16Bit()) {
            return JSStringCreateWithCharacters(zig_str.utf16SliceAligned().ptr, zig_str.len);
        }

        // also extremely inefficient
        var utf8Z = allocator.dupeZ(u8, zig_str.slice()) catch unreachable;
        const cloned = JSStringCreateWithUTF8CString(utf8Z);
        allocator.free(utf8Z);
        return cloned;
    }
};
pub const JSStringRef = *OpaqueJSString;
pub const struct_OpaqueJSClass = opaque {
    pub const name = "JSClassRef";
    pub const is_pointer = false;
    pub const Type = "JSClassRef";
};
pub const JSClassRef = ?*struct_OpaqueJSClass;
pub const JSPropertyNameArray = opaque {
    pub fn at(this: *@This(), i: usize) JSStringRef {
        return JSPropertyNameArrayGetNameAtIndex(this, i);
    }
};
pub const JSPropertyNameArrayRef = ?*JSPropertyNameArray;
pub const struct_OpaqueJSPropertyNameAccumulator = generic;
pub const JSPropertyNameAccumulatorRef = ?*struct_OpaqueJSPropertyNameAccumulator;
pub const JSTypedArrayBytesDeallocator = ?*const fn (*anyopaque, *anyopaque) callconv(.C) void;
pub const OpaqueJSValue = generic;
pub const JSValueRef = ?*OpaqueJSValue;
pub const JSObjectRef = ?*OpaqueJSValue;
pub extern fn JSEvaluateScript(ctx: JSContextRef, script: JSStringRef, thisObject: ?*anyopaque, sourceURL: ?JSStringRef, startingLineNumber: c_int, exception: ExceptionRef) JSValueRef;
pub extern fn JSCheckScriptSyntax(ctx: JSContextRef, script: JSStringRef, sourceURL: JSStringRef, startingLineNumber: c_int, exception: ExceptionRef) bool;
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
pub extern fn JSValueIsUndefined(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueIsNull(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueIsBoolean(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueIsNumber(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueIsString(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueIsSymbol(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueIsObject(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueIsObjectOfClass(ctx: JSContextRef, value: JSValueRef, jsClass: JSClassRef) bool;
pub extern fn JSValueIsArray(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueIsDate(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueGetTypedArrayType(ctx: JSContextRef, value: JSValueRef, exception: ExceptionRef) JSTypedArrayType;
pub extern fn JSValueIsEqual(ctx: JSContextRef, a: JSValueRef, b: JSValueRef, exception: ExceptionRef) bool;
pub extern fn JSValueIsStrictEqual(ctx: JSContextRef, a: JSValueRef, b: JSValueRef) bool;
pub extern fn JSValueIsInstanceOfConstructor(ctx: JSContextRef, value: JSValueRef, constructor: JSObjectRef, exception: ExceptionRef) bool;
pub extern fn JSValueMakeUndefined(ctx: JSContextRef) JSValueRef;
pub extern fn JSValueMakeNull(ctx: JSContextRef) JSValueRef;
pub extern fn JSValueMakeBoolean(ctx: JSContextRef, boolean: bool) JSValueRef;
pub extern fn JSValueMakeNumber(ctx: JSContextRef, number: f64) JSValueRef;
pub extern fn JSValueMakeString(ctx: JSContextRef, string: JSStringRef) JSValueRef;
pub extern fn JSValueMakeSymbol(ctx: JSContextRef, description: JSStringRef) JSValueRef;
pub extern fn JSValueMakeFromJSONString(ctx: JSContextRef, string: JSStringRef) JSValueRef;
pub extern fn JSValueCreateJSONString(ctx: JSContextRef, value: JSValueRef, indent: c_uint, exception: ExceptionRef) JSStringRef;
pub extern fn JSValueToBoolean(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueToNumber(ctx: JSContextRef, value: JSValueRef, exception: ExceptionRef) f64;
pub extern fn JSValueToStringCopy(ctx: JSContextRef, value: JSValueRef, exception: ExceptionRef) JSStringRef;
pub extern fn JSValueToObject(ctx: JSContextRef, value: JSValueRef, exception: ExceptionRef) JSObjectRef;

const log_protection = @import("root").bun.Environment.allow_assert and false;
pub inline fn JSValueUnprotect(ctx: JSContextRef, value: JSValueRef) void {
    const Wrapped = struct {
        pub extern fn JSValueUnprotect(ctx: JSContextRef, value: JSValueRef) void;
    };
    if (comptime log_protection) {
        const Output = @import("root").bun.Output;
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
        const Output = @import("root").bun.Output;
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
pub const JSObjectHasPropertyCallback = *const fn (JSContextRef, JSObjectRef, JSStringRef) callconv(.C) bool;
pub const JSObjectGetPropertyCallback = *const fn (JSContextRef, JSObjectRef, JSStringRef, ExceptionRef) callconv(.C) JSValueRef;
pub const JSObjectSetPropertyCallback = *const fn (JSContextRef, JSObjectRef, JSStringRef, JSValueRef, ExceptionRef) callconv(.C) bool;
pub const JSObjectDeletePropertyCallback = *const fn (JSContextRef, JSObjectRef, JSStringRef, ExceptionRef) callconv(.C) bool;
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
pub const JSStaticValue = extern struct {
    name: [*c]const u8 = null,
    getProperty: ?JSObjectGetPropertyCallback = null,
    setProperty: ?JSObjectSetPropertyCallback = null,
    attributes: JSPropertyAttributes = .kJSPropertyAttributeNone,
};
pub const JSStaticFunction = extern struct {
    name: [*c]const u8 = null,
    callAsFunction: ?JSObjectCallAsFunctionCallback = null,
    attributes: JSPropertyAttributes = .kJSPropertyAttributeNone,
};
pub const JSClassDefinition = extern struct {
    version: c_int = 0,
    attributes: JSClassAttributes = .kJSClassAttributeNone,
    className: [*:0]const u8 = "",
    parentClass: JSClassRef = null,
    staticValues: [*c]const JSStaticValue = null,
    staticFunctions: [*c]const JSStaticFunction = null,
    initialize: ?JSObjectInitializeCallback = null,
    finalize: ?JSObjectFinalizeCallback = null,
    hasProperty: ?JSObjectHasPropertyCallback = null,
    getProperty: ?JSObjectGetPropertyCallback = null,
    setProperty: ?JSObjectSetPropertyCallback = null,
    deleteProperty: ?JSObjectDeletePropertyCallback = null,
    getPropertyNames: ?JSObjectGetPropertyNamesCallback = null,
    callAsFunction: ?JSObjectCallAsFunctionCallback = null,
    callAsConstructor: ?JSObjectCallAsConstructorCallback = null,
    hasInstance: ?JSObjectHasInstanceCallback = null,
    convertToType: ?JSObjectConvertToTypeCallback = null,
};
pub extern const kJSClassDefinitionEmpty: JSClassDefinition;
pub extern "c" fn JSClassCreate(definition: [*c]const JSClassDefinition) JSClassRef;
pub extern "c" fn JSClassRetain(jsClass: JSClassRef) JSClassRef;
pub extern "c" fn JSClassRelease(jsClass: JSClassRef) void;
pub extern "c" fn JSObjectMake(ctx: JSContextRef, jsClass: JSClassRef, data: ?*anyopaque) JSObjectRef;
pub extern "c" fn JSObjectMakeFunctionWithCallback(ctx: JSContextRef, name: JSStringRef, callAsFunction: JSObjectCallAsFunctionCallback) JSObjectRef;
pub extern "c" fn JSObjectMakeConstructor(ctx: JSContextRef, jsClass: JSClassRef, callAsConstructor: JSObjectCallAsConstructorCallback) JSObjectRef;
pub extern "c" fn JSObjectMakeArray(ctx: JSContextRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub extern "c" fn JSObjectMakeDate(ctx: JSContextRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub extern "c" fn JSObjectMakeError(ctx: JSContextRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub extern "c" fn JSObjectMakeRegExp(ctx: JSContextRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub extern "c" fn JSObjectMakeDeferredPromise(ctx: JSContextRef, resolve: ?*JSObjectRef, reject: ?*JSObjectRef, exception: ExceptionRef) JSObjectRef;
pub extern "c" fn JSObjectMakeFunction(ctx: JSContextRef, name: JSStringRef, parameterCount: c_uint, parameterNames: [*c]const JSStringRef, body: JSStringRef, sourceURL: JSStringRef, startingLineNumber: c_int, exception: ExceptionRef) JSObjectRef;
pub extern "c" fn JSObjectGetPrototype(ctx: JSContextRef, object: JSObjectRef) JSValueRef;
pub extern "c" fn JSObjectSetPrototype(ctx: JSContextRef, object: JSObjectRef, value: JSValueRef) void;
pub extern "c" fn JSObjectHasProperty(ctx: JSContextRef, object: JSObjectRef, propertyName: JSStringRef) bool;
pub extern "c" fn JSObjectGetProperty(ctx: JSContextRef, object: JSObjectRef, propertyName: JSStringRef, exception: ExceptionRef) JSValueRef;
pub extern "c" fn JSObjectSetProperty(ctx: JSContextRef, object: JSObjectRef, propertyName: JSStringRef, value: JSValueRef, attributes: c_uint, exception: ExceptionRef) void;
pub extern "c" fn JSObjectDeleteProperty(ctx: JSContextRef, object: JSObjectRef, propertyName: JSStringRef, exception: ExceptionRef) bool;
pub extern "c" fn JSObjectHasPropertyForKey(ctx: JSContextRef, object: JSObjectRef, propertyKey: JSValueRef, exception: ExceptionRef) bool;
pub extern "c" fn JSObjectGetPropertyForKey(ctx: JSContextRef, object: JSObjectRef, propertyKey: JSValueRef, exception: ExceptionRef) JSValueRef;
pub extern "c" fn JSObjectSetPropertyForKey(ctx: JSContextRef, object: JSObjectRef, propertyKey: JSValueRef, value: JSValueRef, attributes: JSPropertyAttributes, exception: ExceptionRef) void;
pub extern "c" fn JSObjectDeletePropertyForKey(ctx: JSContextRef, object: JSObjectRef, propertyKey: JSValueRef, exception: ExceptionRef) bool;
pub extern "c" fn JSObjectGetPropertyAtIndex(ctx: JSContextRef, object: JSObjectRef, propertyIndex: c_uint, exception: ExceptionRef) JSValueRef;
pub extern "c" fn JSObjectSetPropertyAtIndex(ctx: JSContextRef, object: JSObjectRef, propertyIndex: c_uint, value: JSValueRef, exception: ExceptionRef) void;
pub extern "c" fn JSObjectGetPrivate(object: JSObjectRef) ?*anyopaque;
pub extern "c" fn JSObjectSetPrivate(object: JSObjectRef, data: ?*anyopaque) bool;
pub extern "c" fn JSObjectIsFunction(ctx: JSContextRef, object: JSObjectRef) bool;
pub extern "c" fn JSObjectCallAsFunction(ctx: JSContextRef, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSValueRef;
pub extern "c" fn JSObjectIsConstructor(ctx: JSContextRef, object: JSObjectRef) bool;
pub extern "c" fn JSObjectCallAsConstructor(ctx: JSContextRef, object: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: ExceptionRef) JSObjectRef;
pub extern "c" fn JSObjectCopyPropertyNames(ctx: JSContextRef, object: JSObjectRef) JSPropertyNameArrayRef;
pub extern "c" fn JSPropertyNameArrayRetain(array: JSPropertyNameArrayRef) JSPropertyNameArrayRef;
pub extern "c" fn JSPropertyNameArrayRelease(array: JSPropertyNameArrayRef) void;
pub extern "c" fn JSPropertyNameArrayGetCount(array: JSPropertyNameArrayRef) usize;
pub extern "c" fn JSPropertyNameArrayGetNameAtIndex(array: JSPropertyNameArrayRef, index: usize) JSStringRef;
pub extern "c" fn JSPropertyNameAccumulatorAddName(accumulator: JSPropertyNameAccumulatorRef, propertyName: JSStringRef) void;
pub extern "c" fn JSContextGroupCreate() JSContextGroupRef;
pub extern "c" fn JSContextGroupRetain(group: JSContextGroupRef) JSContextGroupRef;
pub extern "c" fn JSContextGroupRelease(group: JSContextGroupRef) void;
pub extern "c" fn JSGlobalContextCreate(globalObjectClass: JSClassRef) JSGlobalContextRef;
pub extern "c" fn JSGlobalContextCreateInGroup(group: JSContextGroupRef, globalObjectClass: JSClassRef) JSGlobalContextRef;
pub extern "c" fn JSGlobalContextRetain(ctx: JSGlobalContextRef) JSGlobalContextRef;
pub extern "c" fn JSGlobalContextRelease(ctx: JSGlobalContextRef) void;
pub extern "c" fn JSContextGetGlobalObject(ctx: JSContextRef) JSObjectRef;
pub extern "c" fn JSContextGetGroup(ctx: JSContextRef) JSContextGroupRef;
pub extern "c" fn JSContextGetGlobalContext(ctx: JSContextRef) JSGlobalContextRef;
pub extern "c" fn JSGlobalContextCopyName(ctx: JSGlobalContextRef) JSStringRef;
pub extern "c" fn JSGlobalContextSetName(ctx: JSGlobalContextRef, name: JSStringRef) void;
pub const JSChar = u16;
pub extern fn JSStringCreateWithCharacters(chars: [*c]const JSChar, numChars: usize) JSStringRef;
pub extern fn JSStringCreateWithUTF8CString(string: [*c]const u8) JSStringRef;
pub extern fn JSStringRetain(string: JSStringRef) JSStringRef;
pub extern fn JSStringRelease(string: JSStringRef) void;
pub extern fn JSStringGetLength(string: JSStringRef) usize;
pub extern fn JSStringGetCharactersPtr(string: JSStringRef) [*]const JSChar;
pub extern fn JSStringGetMaximumUTF8CStringSize(string: JSStringRef) usize;
pub extern fn JSStringGetUTF8CString(string: JSStringRef, buffer: [*c]u8, bufferSize: usize) usize;
pub extern fn JSStringIsEqual(a: JSStringRef, b: JSStringRef) bool;
pub extern fn JSStringIsEqualToUTF8CString(a: JSStringRef, b: [*c]const u8) bool;
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
pub const OpaqueJSClass = struct_OpaqueJSClass;
pub const OpaqueJSPropertyNameAccumulator = struct_OpaqueJSPropertyNameAccumulator;

// This is a workaround for not receiving a JSException* object
// This function lets us use the C API but returns a plain old JSValue
// allowing us to have exceptions that include stack traces
pub extern "c" fn JSObjectCallAsFunctionReturnValue(ctx: JSContextRef, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef) cpp.JSValue;
pub extern "c" fn JSObjectCallAsFunctionReturnValueHoldingAPILock(ctx: JSContextRef, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef) cpp.JSValue;

pub extern fn JSRemoteInspectorDisableAutoStart() void;
pub extern fn JSRemoteInspectorStart() void;
// JS_EXPORT void JSRemoteInspectorSetParentProcessInformation(JSProcessID, const uint8_t* auditData, size_t auditLength) JSC_API_AVAILABLE(macos(10.11), ios(9.0));

pub extern fn JSRemoteInspectorSetLogToSystemConsole(enabled: bool) void;
pub extern fn JSRemoteInspectorGetInspectionEnabledByDefault(void) bool;
pub extern fn JSRemoteInspectorSetInspectionEnabledByDefault(enabled: bool) void;

// -- Manual --

// StringImpl::createWithoutCopying
// https://github.com/WebKit/webkit/blob/main/Source/JavaScriptCore/API/JSStringRef.cpp#L62
pub extern fn JSStringCreateWithCharactersNoCopy(string: [*c]const JSChar, numChars: size_t) JSStringRef;
const size_t = usize;

const then_key = "then";
var thenable_string: JSStringRef = null;
pub fn isObjectOfClassAndResolveIfNeeded(ctx: JSContextRef, obj: JSObjectRef, class: JSClassRef) ?JSObjectRef {
    if (JSValueIsObjectOfClass(ctx, obj, class)) {
        return obj;
    }

    if (!JSValueIsObject(ctx, obj)) {
        return null;
    }

    if (thenable_string == null) {
        thenable_string = JSStringCreateWithUTF8CString(then_key[0.. :0]);
    }

    var prop = JSObjectGetPropertyForKey(ctx, obj, JSValueMakeString(ctx, thenable_string), null);
    if (prop == null) {
        return null;
    }
}

pub const UTF8Ptr = [*]const u8;
pub const UTF16Ptr = [*]const u16;

// --- Custom Methods! ----
pub const Encoding = enum(u8) {
    empty = 0,
    char8 = 8,
    char16 = 16,
};
pub const JSCellValue = u64;
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
pub const ExternalStringFinalizer = *const fn (finalize_ptr: ?*anyopaque, ref: JSStringRef, buffer: *anyopaque, byteLength: usize) callconv(.C) void;

/// **DEPRECATED**: USE from JSValue instead! This whole file should be used sparingly.
pub extern fn JSStringCreate(string: UTF8Ptr, length: usize) JSStringRef;
pub extern fn JSStringCreateStatic(string: UTF8Ptr, length: usize) JSStringRef;
pub extern fn JSStringCreateExternal(string: UTF8Ptr, length: usize, finalize_ptr: ?*anyopaque, finalizer: ExternalStringFinalizer) JSStringRef;
pub extern fn JSStringIsEqualToString(a: JSStringRef, string: UTF8Ptr, length: usize) bool;
pub extern fn JSStringEncoding(string: JSStringRef) Encoding;
pub extern fn JSStringGetCharacters8Ptr(string: JSStringRef) UTF8Ptr;
pub extern fn JSCellType(cell: JSCellValue) CellType;
pub extern fn JSStringIsStatic(ref: JSStringRef) bool;
pub extern fn JSStringIsExternal(ref: JSStringRef) bool;

pub const JStringIteratorAppendCallback = *const fn (ctx: *JSStringIterator_, ptr: *anyopaque, length: u32) callconv(.C) anyopaque;
pub const JStringIteratorWriteCallback = *const fn (ctx: *JSStringIterator_, ptr: *anyopaque, length: u32, offset: u32) callconv(.C) anyopaque;
const JSStringIterator_ = extern struct {
    ctx: *anyopaque,
    stop: u8,

    append8: JStringIteratorAppendCallback,
    append16: JStringIteratorAppendCallback,
    write8: JStringIteratorWriteCallback,
    write16: JStringIteratorWriteCallback,
};

pub extern "c" fn JSObjectGetProxyTarget(JSObjectRef) JSObjectRef;
