const generic = opaque {};
pub const Private = c_void;
pub const struct_OpaqueJSContextGroup = opaque {};
pub const JSContextGroupRef = ?*const struct_OpaqueJSContextGroup;
pub const struct_OpaqueJSContext = opaque {};
pub const JSContextRef = ?*const struct_OpaqueJSContext;
pub const JSGlobalContextRef = ?*struct_OpaqueJSContext;
pub const struct_OpaqueJSString = generic;
pub const JSStringRef = ?*struct_OpaqueJSString;
pub const struct_OpaqueJSClass = generic;
pub const JSClassRef = ?*struct_OpaqueJSClass;
pub const struct_OpaqueJSPropertyNameArray = generic;
pub const JSPropertyNameArrayRef = ?*struct_OpaqueJSPropertyNameArray;
pub const struct_OpaqueJSPropertyNameAccumulator = generic;
pub const JSPropertyNameAccumulatorRef = ?*struct_OpaqueJSPropertyNameAccumulator;
pub const JSTypedArrayBytesDeallocator = ?fn (?*c_void, ?*c_void) callconv(.C) void;
pub const struct_OpaqueJSValue = generic;
pub const JSValueRef = ?*struct_OpaqueJSValue;
pub const JSObjectRef = ?*struct_OpaqueJSValue;
pub extern fn JSEvaluateScript(ctx: JSContextRef, script: JSStringRef, thisObject: JSObjectRef, sourceURL: JSStringRef, startingLineNumber: c_int, exception: [*c]JSValueRef) JSValueRef;
pub extern fn JSCheckScriptSyntax(ctx: JSContextRef, script: JSStringRef, sourceURL: JSStringRef, startingLineNumber: c_int, exception: [*c]JSValueRef) bool;
pub extern fn JSGarbageCollect(ctx: JSContextRef) void;
pub const JSType = enum(c_uint) {
    kJSTypeUndefined,
    kJSTypeNull,
    kJSTypeBoolean,
    kJSTypeNumber,
    kJSTypeString,
    kJSTypeObject,
    kJSTypeSymbol,
    _,
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
pub extern fn JSValueGetTypedArrayType(ctx: JSContextRef, value: JSValueRef, exception: [*c]JSValueRef) JSTypedArrayType;
pub extern fn JSValueIsEqual(ctx: JSContextRef, a: JSValueRef, b: JSValueRef, exception: [*c]JSValueRef) bool;
pub extern fn JSValueIsStrictEqual(ctx: JSContextRef, a: JSValueRef, b: JSValueRef) bool;
pub extern fn JSValueIsInstanceOfConstructor(ctx: JSContextRef, value: JSValueRef, constructor: JSObjectRef, exception: [*c]JSValueRef) bool;
pub extern fn JSValueMakeUndefined(ctx: JSContextRef) JSValueRef;
pub extern fn JSValueMakeNull(ctx: JSContextRef) JSValueRef;
pub extern fn JSValueMakeBoolean(ctx: JSContextRef, boolean: bool) JSValueRef;
pub extern fn JSValueMakeNumber(ctx: JSContextRef, number: f64) JSValueRef;
pub extern fn JSValueMakeString(ctx: JSContextRef, string: JSStringRef) JSValueRef;
pub extern fn JSValueMakeSymbol(ctx: JSContextRef, description: JSStringRef) JSValueRef;
pub extern fn JSValueMakeFromJSONString(ctx: JSContextRef, string: JSStringRef) JSValueRef;
pub extern fn JSValueCreateJSONString(ctx: JSContextRef, value: JSValueRef, indent: c_uint, exception: [*c]JSValueRef) JSStringRef;
pub extern fn JSValueToBoolean(ctx: JSContextRef, value: JSValueRef) bool;
pub extern fn JSValueToNumber(ctx: JSContextRef, value: JSValueRef, exception: [*c]JSValueRef) f64;
pub extern fn JSValueToStringCopy(ctx: JSContextRef, value: JSValueRef, exception: [*c]JSValueRef) JSStringRef;
pub extern fn JSValueToObject(ctx: JSContextRef, value: JSValueRef, exception: [*c]JSValueRef) JSObjectRef;
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
pub const JSObjectGetPropertyCallback = ?fn (JSContextRef, JSObjectRef, JSStringRef, [*c]JSValueRef) callconv(.C) JSValueRef;
pub const JSObjectSetPropertyCallback = ?fn (JSContextRef, JSObjectRef, JSStringRef, JSValueRef, [*c]JSValueRef) callconv(.C) bool;
pub const JSObjectDeletePropertyCallback = ?fn (JSContextRef, JSObjectRef, JSStringRef, [*c]JSValueRef) callconv(.C) bool;
pub const JSObjectGetPropertyNamesCallback = ?fn (JSContextRef, JSObjectRef, JSPropertyNameAccumulatorRef) callconv(.C) void;

pub const JSObjectCallAsFunctionCallback = ?fn (
    ctx: JSContextRef,
    function: JSObjectRef,
    thisObject: JSObjectRef,
    argumentCount: usize,
    arguments: [*c]const JSValueRef,
    exception: [*c]JSValueRef,
) callconv(.C) JSValueRef;
pub const JSObjectCallAsConstructorCallback = ?fn (JSContextRef, JSObjectRef, usize, [*c]const JSValueRef, [*c]JSValueRef) callconv(.C) JSObjectRef;
pub const JSObjectHasInstanceCallback = ?fn (JSContextRef, JSObjectRef, JSValueRef, [*c]JSValueRef) callconv(.C) bool;
pub const JSObjectConvertToTypeCallback = ?fn (JSContextRef, JSObjectRef, JSType, [*c]JSValueRef) callconv(.C) JSValueRef;
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
pub extern "c" fn JSObjectMake(ctx: JSContextRef, jsClass: JSClassRef, data: ?*c_void) JSObjectRef;
pub extern "c" fn JSObjectMakeFunctionWithCallback(ctx: JSContextRef, name: JSStringRef, callAsFunction: JSObjectCallAsFunctionCallback) JSObjectRef;
pub extern "c" fn JSObjectMakeConstructor(ctx: JSContextRef, jsClass: JSClassRef, callAsConstructor: JSObjectCallAsConstructorCallback) JSObjectRef;
pub extern "c" fn JSObjectMakeArray(ctx: JSContextRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: [*c]JSValueRef) JSObjectRef;
pub extern "c" fn JSObjectMakeDate(ctx: JSContextRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: [*c]JSValueRef) JSObjectRef;
pub extern "c" fn JSObjectMakeError(ctx: JSContextRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: [*c]JSValueRef) JSObjectRef;
pub extern "c" fn JSObjectMakeRegExp(ctx: JSContextRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: [*c]JSValueRef) JSObjectRef;
pub extern "c" fn JSObjectMakeDeferredPromise(ctx: JSContextRef, resolve: [*c]JSObjectRef, reject: [*c]JSObjectRef, exception: [*c]JSValueRef) JSObjectRef;
pub extern "c" fn JSObjectMakeFunction(ctx: JSContextRef, name: JSStringRef, parameterCount: c_uint, parameterNames: [*c]const JSStringRef, body: JSStringRef, sourceURL: JSStringRef, startingLineNumber: c_int, exception: [*c]JSValueRef) JSObjectRef;
pub extern "c" fn JSObjectGetPrototype(ctx: JSContextRef, object: JSObjectRef) JSValueRef;
pub extern "c" fn JSObjectSetPrototype(ctx: JSContextRef, object: JSObjectRef, value: JSValueRef) void;
pub extern "c" fn JSObjectHasProperty(ctx: JSContextRef, object: JSObjectRef, propertyName: JSStringRef) bool;
pub extern "c" fn JSObjectGetProperty(ctx: JSContextRef, object: JSObjectRef, propertyName: JSStringRef, exception: [*c]JSValueRef) JSValueRef;
pub extern "c" fn JSObjectSetProperty(ctx: JSContextRef, object: JSObjectRef, propertyName: JSStringRef, value: JSValueRef, attributes: c_uint, exception: [*c]JSValueRef) void;
pub extern "c" fn JSObjectDeleteProperty(ctx: JSContextRef, object: JSObjectRef, propertyName: JSStringRef, exception: [*c]JSValueRef) bool;
pub extern "c" fn JSObjectHasPropertyForKey(ctx: JSContextRef, object: JSObjectRef, propertyKey: JSValueRef, exception: [*c]JSValueRef) bool;
pub extern "c" fn JSObjectGetPropertyForKey(ctx: JSContextRef, object: JSObjectRef, propertyKey: JSValueRef, exception: [*c]JSValueRef) JSValueRef;
pub extern "c" fn JSObjectSetPropertyForKey(ctx: JSContextRef, object: JSObjectRef, propertyKey: JSValueRef, value: JSValueRef, attributes: JSPropertyAttributes, exception: [*c]JSValueRef) void;
pub extern "c" fn JSObjectDeletePropertyForKey(ctx: JSContextRef, object: JSObjectRef, propertyKey: JSValueRef, exception: [*c]JSValueRef) bool;
pub extern "c" fn JSObjectGetPropertyAtIndex(ctx: JSContextRef, object: JSObjectRef, propertyIndex: c_uint, exception: [*c]JSValueRef) JSValueRef;
pub extern "c" fn JSObjectSetPropertyAtIndex(ctx: JSContextRef, object: JSObjectRef, propertyIndex: c_uint, value: JSValueRef, exception: [*c]JSValueRef) void;
pub extern "c" fn JSObjectGetPrivate(object: JSObjectRef) ?*c_void;
pub extern "c" fn JSObjectSetPrivate(object: JSObjectRef, data: ?*c_void) bool;
pub extern "c" fn JSObjectIsFunction(ctx: JSContextRef, object: JSObjectRef) bool;
pub extern "c" fn JSObjectCallAsFunction(ctx: JSContextRef, object: JSObjectRef, thisObject: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: [*c]JSValueRef) JSValueRef;
pub extern "c" fn JSObjectIsConstructor(ctx: JSContextRef, object: JSObjectRef) bool;
pub extern "c" fn JSObjectCallAsConstructor(ctx: JSContextRef, object: JSObjectRef, argumentCount: usize, arguments: [*c]const JSValueRef, exception: [*c]JSValueRef) JSObjectRef;
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
pub extern fn JSObjectMakeTypedArray(ctx: JSContextRef, arrayType: JSTypedArrayType, length: usize, exception: [*c]JSValueRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithBytesNoCopy(ctx: JSContextRef, arrayType: JSTypedArrayType, bytes: ?*c_void, byteLength: usize, bytesDeallocator: JSTypedArrayBytesDeallocator, deallocatorContext: ?*c_void, exception: [*c]JSValueRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithArrayBuffer(ctx: JSContextRef, arrayType: JSTypedArrayType, buffer: JSObjectRef, exception: [*c]JSValueRef) JSObjectRef;
pub extern fn JSObjectMakeTypedArrayWithArrayBufferAndOffset(ctx: JSContextRef, arrayType: JSTypedArrayType, buffer: JSObjectRef, byteOffset: usize, length: usize, exception: [*c]JSValueRef) JSObjectRef;
pub extern fn JSObjectGetTypedArrayBytesPtr(ctx: JSContextRef, object: JSObjectRef, exception: [*c]JSValueRef) ?*c_void;
pub extern fn JSObjectGetTypedArrayLength(ctx: JSContextRef, object: JSObjectRef, exception: [*c]JSValueRef) usize;
pub extern fn JSObjectGetTypedArrayByteLength(ctx: JSContextRef, object: JSObjectRef, exception: [*c]JSValueRef) usize;
pub extern fn JSObjectGetTypedArrayByteOffset(ctx: JSContextRef, object: JSObjectRef, exception: [*c]JSValueRef) usize;
pub extern fn JSObjectGetTypedArrayBuffer(ctx: JSContextRef, object: JSObjectRef, exception: [*c]JSValueRef) JSObjectRef;
pub extern fn JSObjectMakeArrayBufferWithBytesNoCopy(ctx: JSContextRef, bytes: ?*c_void, byteLength: usize, bytesDeallocator: JSTypedArrayBytesDeallocator, deallocatorContext: ?*c_void, exception: [*c]JSValueRef) JSObjectRef;
pub extern fn JSObjectGetArrayBufferBytesPtr(ctx: JSContextRef, object: JSObjectRef, exception: [*c]JSValueRef) ?*c_void;
pub extern fn JSObjectGetArrayBufferByteLength(ctx: JSContextRef, object: JSObjectRef, exception: [*c]JSValueRef) usize;
pub extern fn JSStringCreateWithCFString(string: CFStringRef) JSStringRef;
pub const OpaqueJSContextGroup = struct_OpaqueJSContextGroup;
pub const OpaqueJSContext = struct_OpaqueJSContext;
pub const OpaqueJSString = struct_OpaqueJSString;
pub const OpaqueJSClass = struct_OpaqueJSClass;
pub const OpaqueJSPropertyNameArray = struct_OpaqueJSPropertyNameArray;
pub const OpaqueJSPropertyNameAccumulator = struct_OpaqueJSPropertyNameAccumulator;
pub const OpaqueJSValue = struct_OpaqueJSValue;

// -- Manual --

// StringImpl::createWithoutCopying
// https://github.com/WebKit/webkit/blob/main/Source/JavaScriptCore/API/JSStringRef.cpp#L62
pub extern fn JSStringCreateWithCharactersNoCopy(string: [*c]const JSChar, numChars: size_t) JSStringRef;
const size_t = usize;
