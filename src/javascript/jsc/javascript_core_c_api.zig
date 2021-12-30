const cpp = @import("./bindings/bindings.zig");
const generic = opaque {};
pub const Private = anyopaque;
pub const struct_OpaqueJSContextGroup = generic;
pub const JSContextGroupRef = ?*const struct_OpaqueJSContextGroup;
pub const struct_OpaqueJSContext = generic;
pub const JSContextRef = ?*const struct_OpaqueJSContext;
pub const JSGlobalContextRef = ?*struct_OpaqueJSContext;
pub const struct_OpaqueJSString = generic;
pub const JSStringRef = ?*struct_OpaqueJSString;
pub const struct_OpaqueJSClass = opaque {
    pub const name = "JSClassRef";
    pub const is_pointer = false;
    pub const Type = "JSClassRef";
};
pub const JSClassRef = ?*struct_OpaqueJSClass;
pub const struct_OpaqueJSPropertyNameArray = generic;
pub const JSPropertyNameArrayRef = ?*struct_OpaqueJSPropertyNameArray;
pub const struct_OpaqueJSPropertyNameAccumulator = generic;
pub const JSPropertyNameAccumulatorRef = ?*struct_OpaqueJSPropertyNameAccumulator;
pub const JSTypedArrayBytesDeallocator = ?fn (*anyopaque, *anyopaque) callconv(.C) void;
pub const OpaqueJSValue = generic;
pub const JSValueRef = ?*OpaqueJSValue;
pub const JSObjectRef = ?*OpaqueJSValue;
pub extern fn JSEvaluateScript(ctx: JSContextRef, script: JSStringRef, thisObject: JSObjectRef, sourceURL: JSStringRef, startingLineNumber: c_int, exception: ExceptionRef) JSValueRef;
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
pub const kJSTypeUndefined = @enumToInt(JSType.kJSTypeUndefined);
pub const kJSTypeNull = @enumToInt(JSType.kJSTypeNull);
pub const kJSTypeBoolean = @enumToInt(JSType.kJSTypeBoolean);
pub const kJSTypeNumber = @enumToInt(JSType.kJSTypeNumber);
pub const kJSTypeString = @enumToInt(JSType.kJSTypeString);
pub const kJSTypeObject = @enumToInt(JSType.kJSTypeObject);
pub const kJSTypeSymbol = @enumToInt(JSType.kJSTypeSymbol);
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
pub const kJSTypedArrayTypeInt8Array = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeInt8Array);
pub const kJSTypedArrayTypeInt16Array = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeInt16Array);
pub const kJSTypedArrayTypeInt32Array = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeInt32Array);
pub const kJSTypedArrayTypeUint8Array = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeUint8Array);
pub const kJSTypedArrayTypeUint8ClampedArray = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeUint8ClampedArray);
pub const kJSTypedArrayTypeUint16Array = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeUint16Array);
pub const kJSTypedArrayTypeUint32Array = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeUint32Array);
pub const kJSTypedArrayTypeFloat32Array = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeFloat32Array);
pub const kJSTypedArrayTypeFloat64Array = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeFloat64Array);
pub const kJSTypedArrayTypeArrayBuffer = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeArrayBuffer);
pub const kJSTypedArrayTypeNone = @enumToInt(JSTypedArrayType.kJSTypedArrayTypeNone);
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
pub extern fn JSValueProtect(ctx: JSContextRef, value: JSValueRef) void;
pub extern fn JSValueUnprotect(ctx: JSContextRef, value: JSValueRef) void;
pub const JSPropertyAttributes = enum(c_uint) {
    kJSPropertyAttributeNone = 0,
    kJSPropertyAttributeReadOnly = 2,
    kJSPropertyAttributeDontEnum = 4,
    kJSPropertyAttributeDontDelete = 8,
    _,
};
pub const kJSPropertyAttributeNone = @enumToInt(JSPropertyAttributes.kJSPropertyAttributeNone);
pub const kJSPropertyAttributeReadOnly = @enumToInt(JSPropertyAttributes.kJSPropertyAttributeReadOnly);
pub const kJSPropertyAttributeDontEnum = @enumToInt(JSPropertyAttributes.kJSPropertyAttributeDontEnum);
pub const kJSPropertyAttributeDontDelete = @enumToInt(JSPropertyAttributes.kJSPropertyAttributeDontDelete);
pub const JSClassAttributes = enum(c_uint) {
    kJSClassAttributeNone = 0,
    kJSClassAttributeNoAutomaticPrototype = 2,
    _,
};

pub const kJSClassAttributeNone = @enumToInt(JSClassAttributes.kJSClassAttributeNone);
pub const kJSClassAttributeNoAutomaticPrototype = @enumToInt(JSClassAttributes.kJSClassAttributeNoAutomaticPrototype);
pub const JSObjectInitializeCallback = ?fn (JSContextRef, JSObjectRef) callconv(.C) void;
pub const JSObjectFinalizeCallback = ?fn (JSObjectRef) callconv(.C) void;
pub const JSObjectHasPropertyCallback = ?fn (JSContextRef, JSObjectRef, JSStringRef) callconv(.C) bool;
pub const JSObjectGetPropertyCallback = ?fn (JSContextRef, JSObjectRef, JSStringRef, ExceptionRef) callconv(.C) JSValueRef;
pub const JSObjectSetPropertyCallback = ?fn (JSContextRef, JSObjectRef, JSStringRef, JSValueRef, ExceptionRef) callconv(.C) bool;
pub const JSObjectDeletePropertyCallback = ?fn (JSContextRef, JSObjectRef, JSStringRef, ExceptionRef) callconv(.C) bool;
pub const JSObjectGetPropertyNamesCallback = ?fn (JSContextRef, JSObjectRef, JSPropertyNameAccumulatorRef) callconv(.C) void;
pub const ExceptionRef = [*c]JSValueRef;
pub const JSObjectCallAsFunctionCallback = ?fn (
    ctx: JSContextRef,
    function: JSObjectRef,
    thisObject: JSObjectRef,
    argumentCount: usize,
    arguments: [*c]const JSValueRef,
    exception: ExceptionRef,
) callconv(.C) JSValueRef;
pub const JSObjectCallAsConstructorCallback = ?fn (JSContextRef, JSObjectRef, usize, [*c]const JSValueRef, ExceptionRef) callconv(.C) JSObjectRef;
pub const JSObjectHasInstanceCallback = ?fn (JSContextRef, JSObjectRef, JSValueRef, ExceptionRef) callconv(.C) bool;
pub const JSObjectConvertToTypeCallback = ?fn (JSContextRef, JSObjectRef, JSType, ExceptionRef) callconv(.C) JSValueRef;
pub const JSStaticValue = extern struct {
    name: [*c]const u8,
    getProperty: JSObjectGetPropertyCallback,
    setProperty: JSObjectSetPropertyCallback,
    attributes: JSPropertyAttributes,
};
pub const JSStaticFunction = extern struct {
    name: [*c]const u8,
    callAsFunction: JSObjectCallAsFunctionCallback,
    attributes: JSPropertyAttributes,
};
pub const JSClassDefinition = extern struct {
    version: c_int,
    attributes: JSClassAttributes,
    className: [*c]const u8,
    parentClass: JSClassRef,
    staticValues: [*c]const JSStaticValue,
    staticFunctions: [*c]const JSStaticFunction,
    initialize: JSObjectInitializeCallback,
    finalize: JSObjectFinalizeCallback,
    hasProperty: JSObjectHasPropertyCallback,
    getProperty: JSObjectGetPropertyCallback,
    setProperty: JSObjectSetPropertyCallback,
    deleteProperty: JSObjectDeletePropertyCallback,
    getPropertyNames: JSObjectGetPropertyNamesCallback,
    callAsFunction: JSObjectCallAsFunctionCallback,
    callAsConstructor: JSObjectCallAsConstructorCallback,
    hasInstance: JSObjectHasInstanceCallback,
    convertToType: JSObjectConvertToTypeCallback,
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
pub const JSChar = c_ushort;
pub extern fn JSStringCreateWithCharacters(chars: [*c]const JSChar, numChars: usize) JSStringRef;
pub extern fn JSStringCreateWithUTF8CString(string: [*c]const u8) JSStringRef;
pub extern fn JSStringRetain(string: JSStringRef) JSStringRef;
pub extern fn JSStringRelease(string: JSStringRef) void;
pub extern fn JSStringGetLength(string: JSStringRef) usize;
pub extern fn JSStringGetCharactersPtr(string: JSStringRef) [*c]const JSChar;
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
pub const OpaqueJSString = struct_OpaqueJSString;
pub const OpaqueJSClass = struct_OpaqueJSClass;
pub const OpaqueJSPropertyNameArray = struct_OpaqueJSPropertyNameArray;
pub const OpaqueJSPropertyNameAccumulator = struct_OpaqueJSPropertyNameAccumulator;

// This is a workaround for not receiving a JSException* object
// This function lets us use the C API but returns a plain old JSValue
// allowing us to have exceptions that include stack traces
pub extern "c" fn JSObjectCallAsFunctionReturnValue(ctx: JSContextRef, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef) cpp.JSValue;

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

pub const UTF8Ptr = [*c]const u8;
pub const UTF16Ptr = [*c]const u16;

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
    PureForwardingProxyType = 31,
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
    StringObjectType = 72,
    DerivedStringObjectType = 73,

    MaxJSType = 255,
    _,

    pub fn isString(this: CellType) bool {
        return switch (this) {
            .StringType => true,
            else => false,
        };
    }
};
pub const ExternalStringFinalizer = fn (finalize_ptr: ?*anyopaque, ref: JSStringRef, buffer: *anyopaque, byteLength: usize) callconv(.C) void;
pub extern fn JSStringCreate(string: UTF8Ptr, length: usize) JSStringRef;
pub extern fn JSStringCreateStatic(string: UTF8Ptr, length: usize) JSStringRef;
pub extern fn JSStringCreateExternal(string: UTF8Ptr, length: usize, finalize_ptr: ?*anyopaque, finalizer: ExternalStringFinalizer) JSStringRef;
pub extern fn JSStringIsEqualToString(a: JSStringRef, string: UTF8Ptr, length: usize) bool;
pub extern fn JSStringEncoding(string: JSStringRef) Encoding;
pub extern fn JSStringGetCharacters8Ptr(string: JSStringRef) UTF8Ptr;
extern fn JSStringIterate(string: JSCellValue, iter: *JSStringIterator_) void;
pub extern fn JSCellType(cell: JSCellValue) CellType;
pub extern fn JSStringIsStatic(ref: JSStringRef) bool;
pub extern fn JSStringIsExternal(ref: JSStringRef) bool;

pub const JStringIteratorAppendCallback = fn (ctx: *JSStringIterator_, ptr: *anyopaque, length: u32) callconv(.C) anyopaque;
pub const JStringIteratorWriteCallback = fn (ctx: *JSStringIterator_, ptr: *anyopaque, length: u32, offset: u32) callconv(.C) anyopaque;
const JSStringIterator_ = extern struct {
    ctx: *anyopaque,
    stop: u8,

    append8: JStringIteratorAppendCallback,
    append16: JStringIteratorAppendCallback,
    write8: JStringIteratorWriteCallback,
    write16: JStringIteratorWriteCallback,
};

pub const JSString = struct {
    pub const Callback = fn (finalize_ptr_: ?*anyopaque, ref: JSStringRef, buffer: *anyopaque, byteLength: usize) callconv(.C) void;
    _ref: JSStringRef = null,
    backing: Backing = .{ .gc = 0 },

    pub const Backing = union(Ownership) {
        external: ExternalString,
        static: []const u8,
        gc: u0,
    };

    pub fn deref(this: *JSString) void {
        if (this._ref == null) return;

        JSStringRetain(this._ref);
    }

    const ExternalString = struct {
        callback: Callback,
        external_callback: *anyopaque,
        external_ptr: ?*anyopaque = null,
        slice: []const u8,
    };

    pub fn External(comptime ExternalType: type, external_type: *ExternalType, str: []const u8, callback: fn (this: *ExternalType, buffer: []const u8) void) JSString {
        const CallbackFunctionType = @TypeOf(callback);

        const ExternalWrapper = struct {
            pub fn finalizer_callback(finalize_ptr_: ?*anyopaque, buffer: *anyopaque, byteLength: usize) callconv(.C) void {
                var finalize_ptr = finalize_ptr_ orelse return;

                var jsstring = @ptrCast(
                    *JSString,
                    @alignCast(
                        @alignOf(
                            *JSString,
                        ),
                        finalize_ptr,
                    ),
                );

                var cb = @as(CallbackFunctionType, jsstring.external_callback orelse return);
                var raw_external_ptr = jsstring.external_ptr orelse return;

                var external_ptr = @ptrCast(
                    *ExternalType,
                    @alignCast(
                        @alignOf(
                            *ExternalType,
                        ),
                        raw_external_ptr,
                    ),
                );

                cb(external_ptr, @ptrCast([*]u8, buffer)[0..byteLength]);
            }
        };

        return JSString{
            .backing = .{
                .external = .{
                    .slice = str,
                    .external_callback = callback,
                    .external_ptr = external_type,
                    .callback = ExternalWrapper.finalizer_callback,
                },
            },
        };
    }

    // pub fn Iterator(comptime WriterType: type) type {
    //     return struct {

    //     };
    // }

    pub const Ownership = enum { external, static, gc };

    pub fn Static(str: []const u8) JSString {
        return JSString{ ._ref = null, .backing = .{ .static = str } };
    }

    pub fn ref(this: *JSString) JSStringRef {
        if (this._ref == null) {
            switch (this.backing) {
                .External => |external| {
                    this._ref = JSStringCreateExternal(external.slice, external.slice.len, this, this.external_callback.?);
                },
                .Static => |slice| {
                    this._ref = JSStringCreateStatic(slice.ptr, slice.len);
                },
                .gc => {
                    return null;
                },
            }
        }

        JSStringRetain(this._ref);

        return this._ref;
    }

    pub fn fromStringRef(string_ref: JSStringRef) JSString {}

    pub fn init(str: []const u8) JSString {}

    pub fn static(str: []const u8) JSString {}

    pub fn finalize(this: *JSString) void {
        this.loaded = false;
    }

    pub fn value(this: *JSString, ctx: JSContextRef) JSValueRef {
        return JSValueMakeString(ctx, this.ref());
    }

    pub fn len(this: *const JSString) usize {
        return JSStringGetLength(this.ref);
    }

    pub fn encoding(this: *const JSString) Encoding {
        return JSStringEncoding(this.ref);
    }

    // pub fn eql(this: *const JSString, str: string)  {

    // }

    pub fn eqlJS(this: *const JSString, ctx: JSContextRef, comptime Type: type, that: Type) bool {
        switch (comptime Type) {
            JSValueRef => {},
            JSStringRef => {},
            JSString => {},
        }
    }
};

// not official api functions
pub extern "c" fn JSCInitialize() void;
