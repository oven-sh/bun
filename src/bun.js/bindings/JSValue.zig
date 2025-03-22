/// ABI-compatible with EncodedJSValue
/// In the future, this type will exclude `zero`, encoding it as `error.JSError` instead.
pub const JSValue = enum(i64) {
    undefined = 0xa,
    null = 0x2,
    true = FFI.TrueI64,
    false = 0x6,

    // TODO: Remove
    /// Typically means an exception was thrown.
    zero = 0,

    // TODO: Remove
    /// This corresponds to `JSValue::ValueDeleted` in C++ It is never OK to use
    /// this value except in the return value of `JSC__JSValue__getIfPropertyExistsImpl`
    /// and `JSC__JSValue__fastGet`
    ///
    /// Deleted is a special encoding used in JSC hash map internals used for
    /// the null state. It is re-used here for encoding the "not present" state
    /// in `JSC__JSValue__getIfPropertyExistsImpl`
    property_does_not_exist_on_object = 0x4,
    _,

    /// When JavaScriptCore throws something, it returns a null cell (0). The
    /// exception is set on the global object. ABI-compatible with EncodedJSValue.
    pub const MaybeException = enum(JSValueReprInt) {
        zero = 0,
        _,

        pub fn unwrap(val: JSValue.MaybeException) JSError!JSValue {
            return if (val != .zero) @enumFromInt(@intFromEnum(val)) else JSError.JSError;
        }
    };

    /// This function is a migration stepping stone to JSError
    /// Prefer annotating the type as `JSValue.MaybeException`
    pub fn unwrapZeroToJSError(val: JSValue) JSError!JSValue {
        return if (val != .zero) val else JSError.JSError;
    }

    pub const is_pointer = false;
    pub const JSType = enum(u8) {
        Cell = 0,
        Structure = 1,
        String = 2,
        HeapBigInt = 3,
        Symbol = 4,
        GetterSetter = 5,
        CustomGetterSetter = 6,
        APIValueWrapper = 7,
        NativeExecutable = 8,
        ProgramExecutable = 9,
        ModuleProgramExecutable = 10,
        EvalExecutable = 11,
        FunctionExecutable = 12,
        UnlinkedFunctionExecutable = 13,
        UnlinkedProgramCodeBlock = 14,
        UnlinkedModuleProgramCodeBlock = 15,
        UnlinkedEvalCodeBlock = 16,
        UnlinkedFunctionCodeBlock = 17,
        CodeBlock = 18,
        JSImmutableButterfly = 19,
        JSSourceCode = 20,
        JSScriptFetcher = 21,
        JSScriptFetchParameters = 22,
        Object = 23,
        FinalObject = 24,
        JSCallee = 25,
        JSFunction = 26,
        InternalFunction = 27,
        NullSetterFunction = 28,
        BooleanObject = 29,
        NumberObject = 30,
        ErrorInstance = 31,
        GlobalProxy = 32,
        DirectArguments = 33,
        ScopedArguments = 34,
        ClonedArguments = 35,
        Array = 36,
        DerivedArray = 37,
        ArrayBuffer = 38,
        Int8Array = 39,
        Uint8Array = 40,
        Uint8ClampedArray = 41,
        Int16Array = 42,
        Uint16Array = 43,
        Int32Array = 44,
        Uint32Array = 45,
        Float16Array = 46,
        Float32Array = 47,
        Float64Array = 48,
        BigInt64Array = 49,
        BigUint64Array = 50,
        DataView = 51,
        GlobalObject = 52,
        GlobalLexicalEnvironment = 53,
        LexicalEnvironment = 54,
        ModuleEnvironment = 55,
        StrictEvalActivation = 56,
        WithScope = 57,
        ModuleNamespaceObject = 58,
        ShadowRealm = 59,
        RegExpObject = 60,
        JSDate = 61,
        ProxyObject = 62,
        Generator = 63,
        AsyncGenerator = 64,
        JSArrayIterator = 65,
        Iterator = 66,
        IteratorHelper = 67,
        MapIterator = 68,
        SetIterator = 69,
        StringIterator = 70,
        WrapForValidIterator = 71,
        RegExpStringIterator = 72,
        AsyncFromSyncIterator = 73,
        JSPromise = 74,
        Map = 75,
        Set = 76,
        WeakMap = 77,
        WeakSet = 78,
        WebAssemblyModule = 79,
        WebAssemblyInstance = 80,
        WebAssemblyGCObject = 81,
        StringObject = 82,
        DerivedStringObject = 83,
        InternalFieldTuple = 84,

        MaxJS = 0b11111111,
        Event = 0b11101111,
        DOMWrapper = 0b11101110,

        /// This means that we don't have Zig bindings for the type yet, but it
        /// implements .toJSON()
        JSAsJSONType = 0b11110000 | 1,
        _,

        pub const min_typed_array: JSType = .Int8Array;
        pub const max_typed_array: JSType = .DataView;

        pub fn canGet(this: JSType) bool {
            return switch (this) {
                .Array,
                .ArrayBuffer,
                .BigInt64Array,
                .BigUint64Array,
                .BooleanObject,
                .DOMWrapper,
                .DataView,
                .DerivedArray,
                .DerivedStringObject,
                .ErrorInstance,
                .Event,
                .FinalObject,
                .Float32Array,
                .Float16Array,
                .Float64Array,
                .GlobalObject,
                .Int16Array,
                .Int32Array,
                .Int8Array,
                .InternalFunction,
                .JSArrayIterator,
                .AsyncGenerator,
                .JSDate,
                .JSFunction,
                .Generator,
                .Map,
                .MapIterator,
                .JSPromise,
                .Set,
                .SetIterator,
                .IteratorHelper,
                .Iterator,
                .StringIterator,
                .WeakMap,
                .WeakSet,
                .ModuleNamespaceObject,
                .NumberObject,
                .Object,
                .ProxyObject,
                .RegExpObject,
                .ShadowRealm,
                .StringObject,
                .Uint16Array,
                .Uint32Array,
                .Uint8Array,
                .Uint8ClampedArray,
                .WebAssemblyModule,
                .WebAssemblyInstance,
                .WebAssemblyGCObject,
                => true,
                else => false,
            };
        }

        pub inline fn isObject(this: JSType) bool {
            // inline constexpr bool isObjectType(JSType type) { return type >= ObjectType; }
            return @intFromEnum(this) >= @intFromEnum(JSType.Object);
        }

        pub fn isFunction(this: JSType) bool {
            return switch (this) {
                .JSFunction, .FunctionExecutable, .InternalFunction => true,
                else => false,
            };
        }

        pub fn isTypedArrayOrArrayBuffer(this: JSType) bool {
            return switch (this) {
                .ArrayBuffer,
                .BigInt64Array,
                .BigUint64Array,
                .Float32Array,
                .Float16Array,
                .Float64Array,
                .Int16Array,
                .Int32Array,
                .Int8Array,
                .Uint16Array,
                .Uint32Array,
                .Uint8Array,
                .Uint8ClampedArray,
                => true,
                else => false,
            };
        }

        pub fn isArrayBufferLike(this: JSType) bool {
            return switch (this) {
                .DataView,
                .ArrayBuffer,
                .BigInt64Array,
                .BigUint64Array,
                .Float32Array,
                .Float16Array,
                .Float64Array,
                .Int16Array,
                .Int32Array,
                .Int8Array,
                .Uint16Array,
                .Uint32Array,
                .Uint8Array,
                .Uint8ClampedArray,
                => true,
                else => false,
            };
        }

        pub fn toC(this: JSType) C_API.JSTypedArrayType {
            return switch (this) {
                .Int8Array => .kJSTypedArrayTypeInt8Array,
                .Int16Array => .kJSTypedArrayTypeInt16Array,
                .Int32Array => .kJSTypedArrayTypeInt32Array,
                .Uint8Array => .kJSTypedArrayTypeUint8Array,
                .Uint8ClampedArray => .kJSTypedArrayTypeUint8ClampedArray,
                .Uint16Array => .kJSTypedArrayTypeUint16Array,
                .Uint32Array => .kJSTypedArrayTypeUint32Array,
                .Float32Array => .kJSTypedArrayTypeFloat32Array,
                .Float64Array => .kJSTypedArrayTypeFloat64Array,
                .ArrayBuffer => .kJSTypedArrayTypeArrayBuffer,
                .BigInt64Array => .kJSTypedArrayTypeBigInt64Array,
                .BigUint64Array => .kJSTypedArrayTypeBigUint64Array,
                // .DataView => .kJSTypedArrayTypeDataView,
                else => .kJSTypedArrayTypeNone,
            };
        }

        pub fn isHidden(this: JSType) bool {
            return switch (this) {
                .APIValueWrapper,
                .NativeExecutable,
                .ProgramExecutable,
                .ModuleProgramExecutable,
                .EvalExecutable,
                .FunctionExecutable,
                .UnlinkedFunctionExecutable,
                .UnlinkedProgramCodeBlock,
                .UnlinkedModuleProgramCodeBlock,
                .UnlinkedEvalCodeBlock,
                .UnlinkedFunctionCodeBlock,
                .CodeBlock,
                .JSImmutableButterfly,
                .JSSourceCode,
                .JSScriptFetcher,
                .JSScriptFetchParameters,
                => true,
                else => false,
            };
        }

        pub const LastMaybeFalsyCellPrimitive = JSType.HeapBigInt;
        pub const LastJSCObject = JSType.DerivedStringObject; // This is the last "JSC" Object type. After this, we have embedder's (e.g., WebCore) extended object types.

        pub inline fn isString(this: JSType) bool {
            return this == .String;
        }

        pub inline fn isStringObject(this: JSType) bool {
            return this == .StringObject;
        }

        pub inline fn isDerivedStringObject(this: JSType) bool {
            return this == .DerivedStringObject;
        }

        pub inline fn isStringObjectLike(this: JSType) bool {
            return this == .StringObject or this == .DerivedStringObject;
        }

        pub inline fn isStringLike(this: JSType) bool {
            return switch (this) {
                .String, .StringObject, .DerivedStringObject => true,
                else => false,
            };
        }

        pub inline fn isArray(this: JSType) bool {
            return switch (this) {
                .Array, .DerivedArray => true,
                else => false,
            };
        }

        pub inline fn isArrayLike(this: JSType) bool {
            return switch (this) {
                .Array,
                .DerivedArray,

                .ArrayBuffer,
                .BigInt64Array,
                .BigUint64Array,
                .Float32Array,
                .Float16Array,
                .Float64Array,
                .Int16Array,
                .Int32Array,
                .Int8Array,
                .Uint16Array,
                .Uint32Array,
                .Uint8Array,
                .Uint8ClampedArray,
                => true,
                else => false,
            };
        }

        pub inline fn isSet(this: JSType) bool {
            return switch (this) {
                .Set, .WeakSet => true,
                else => false,
            };
        }

        pub inline fn isMap(this: JSType) bool {
            return switch (this) {
                .Map, .WeakMap => true,
                else => false,
            };
        }

        pub inline fn isIndexable(this: JSType) bool {
            return switch (this) {
                .Object,
                .FinalObject,
                .Array,
                .DerivedArray,
                .ErrorInstance,
                .JSFunction,
                .InternalFunction,

                .ArrayBuffer,
                .BigInt64Array,
                .BigUint64Array,
                .Float32Array,
                .Float16Array,
                .Float64Array,
                .Int16Array,
                .Int32Array,
                .Int8Array,
                .Uint16Array,
                .Uint32Array,
                .Uint8Array,
                .Uint8ClampedArray,
                => true,
                else => false,
            };
        }

        pub inline fn isArguments(this: JSType) bool {
            return switch (this) {
                .DirectArguments, .ClonedArguments, .ScopedArguments => true,
                else => false,
            };
        }
    };

    pub inline fn cast(ptr: anytype) JSValue {
        return @as(JSValue, @enumFromInt(@as(i64, @bitCast(@intFromPtr(ptr)))));
    }

    // TODO: use JSError! `toInt32` can throw
    extern fn JSC__JSValue__coerceToInt32(this: JSValue, globalThis: *JSC.JSGlobalObject) i32;
    pub fn coerceToInt32(this: JSValue, globalThis: *JSC.JSGlobalObject) i32 {
        return JSC__JSValue__coerceToInt32(this, globalThis);
    }

    // TODO: use  JSError! `toInt32` can throw
    extern fn JSC__JSValue__coerceToInt64(this: JSValue, globalThis: *JSC.JSGlobalObject) i64;
    pub fn coerceToInt64(this: JSValue, globalThis: *JSC.JSGlobalObject) i64 {
        return JSC__JSValue__coerceToInt64(this, globalThis);
    }

    pub fn getIndex(this: JSValue, globalThis: *JSGlobalObject, i: u32) JSValue {
        return JSC.JSObject.getIndex(this, globalThis, i);
    }

    extern fn JSC__JSValue__getDirectIndex(JSValue, *JSGlobalObject, u32) JSValue;
    pub fn getDirectIndex(this: JSValue, globalThis: *JSGlobalObject, i: u32) JSValue {
        return JSC__JSValue__getDirectIndex(this, globalThis, i);
    }

    pub fn isFalsey(this: JSValue) bool {
        return !this.toBoolean();
    }

    pub const isTruthy = toBoolean;

    const PropertyIteratorFn = *const fn (
        globalObject_: *JSGlobalObject,
        ctx_ptr: ?*anyopaque,
        key: *ZigString,
        value: JSValue,
        is_symbol: bool,
        is_private_symbol: bool,
    ) callconv(.C) void;

    extern fn JSC__JSValue__forEachPropertyNonIndexed(JSValue0: JSValue, arg1: *JSGlobalObject, arg2: ?*anyopaque, ArgFn3: ?*const fn (*JSGlobalObject, ?*anyopaque, *ZigString, JSValue, bool, bool) callconv(.C) void) void;
    extern fn JSC__JSValue__forEachProperty(JSValue0: JSValue, arg1: *JSGlobalObject, arg2: ?*anyopaque, ArgFn3: ?*const fn (*JSGlobalObject, ?*anyopaque, *ZigString, JSValue, bool, bool) callconv(.C) void) void;
    extern fn JSC__JSValue__forEachPropertyOrdered(JSValue0: JSValue, arg1: *JSGlobalObject, arg2: ?*anyopaque, ArgFn3: ?*const fn (*JSGlobalObject, ?*anyopaque, *ZigString, JSValue, bool, bool) callconv(.C) void) void;

    pub fn forEachPropertyNonIndexed(
        this: JSValue,
        globalThis: *JSC.JSGlobalObject,
        ctx: ?*anyopaque,
        callback: PropertyIteratorFn,
    ) void {
        JSC__JSValue__forEachPropertyNonIndexed(this, globalThis, ctx, callback);
    }

    pub fn forEachProperty(
        this: JSValue,
        globalThis: *JSC.JSGlobalObject,
        ctx: ?*anyopaque,
        callback: PropertyIteratorFn,
    ) void {
        JSC__JSValue__forEachProperty(this, globalThis, ctx, callback);
    }

    pub fn forEachPropertyOrdered(
        this: JSValue,
        globalObject: *JSC.JSGlobalObject,
        ctx: ?*anyopaque,
        callback: PropertyIteratorFn,
    ) void {
        JSC__JSValue__forEachPropertyOrdered(this, globalObject, ctx, callback);
    }

    extern fn JSC__JSValue__coerceToDouble(this: JSValue, globalObject: *JSC.JSGlobalObject) f64;
    /// Prefer toNumber over this function to
    /// - Match the underlying JSC api name
    /// - Match the underlying specification
    /// - Catch exceptions
    pub fn coerceToDouble(this: JSValue, globalObject: *JSC.JSGlobalObject) f64 {
        return JSC__JSValue__coerceToDouble(this, globalObject);
    }

    extern fn Bun__JSValue__toNumber(value: JSValue, global: *JSGlobalObject, had_error: *bool) f64;

    /// Perform the ToNumber abstract operation, coercing a value to a number.
    /// Equivalent to `+value`
    /// https://tc39.es/ecma262/#sec-tonumber
    pub fn toNumber(this: JSValue, global: *JSGlobalObject) bun.JSError!f64 {
        var had_error: bool = false;
        const result = Bun__JSValue__toNumber(this, global, &had_error);
        if (had_error) {
            return error.JSError;
        }
        return result;
    }

    // ECMA-262 20.1.2.3 Number.isInteger
    pub fn isInteger(this: JSValue) bool {
        if (this.isInt32()) {
            return true;
        }

        if (this.isDouble()) {
            const num = this.asDouble();
            if (std.math.isFinite(num) and @trunc(num) == num) {
                return true;
            }
        }

        return false;
    }

    // https://tc39.es/ecma262/#sec-number.issafeinteger
    pub fn isSafeInteger(this: JSValue) bool {
        if (this.isInt32()) {
            return true;
        }
        if (!this.isDouble()) {
            return false;
        }
        const d = this.asDouble();
        return @trunc(d) == d and @abs(d) <= JSC.MAX_SAFE_INTEGER;
    }

    pub fn coerce(this: JSValue, comptime T: type, globalThis: *JSC.JSGlobalObject) T {
        return switch (T) {
            bool => this.toBoolean(),
            f64 => {
                if (this.isDouble()) {
                    return this.asDouble();
                }
                return this.coerceToDouble(globalThis);
            },
            i64 => {
                return this.coerceToInt64(globalThis);
            },
            i32 => {
                if (this.isInt32()) {
                    return this.asInt32();
                }
                if (this.getNumber()) |num| {
                    return coerceJSValueDoubleTruncatingT(i32, num);
                }
                return this.coerceToInt32(globalThis);
            },
            std.c.AI,
            => {
                if (this.isInt32()) {
                    return @bitCast(this.asInt32());
                }
                if (this.getNumber()) |num| {
                    return @bitCast(coerceJSValueDoubleTruncatingT(i32, num));
                }
                return @bitCast(this.coerceToInt32(globalThis));
            },
            else => @compileError("Unsupported coercion type"),
        };
    }

    /// This does not call [Symbol.toPrimitive] or [Symbol.toStringTag].
    /// This is only safe when you don't want to do conversions across non-primitive types.
    pub fn to(this: JSValue, comptime T: type) T {
        if (@typeInfo(T) == .@"enum") {
            const Int = @typeInfo(T).@"enum".tag_type;
            return @enumFromInt(this.to(Int));
        }
        return switch (comptime T) {
            u32 => toU32(this),
            u16 => toU16(this),
            c_uint => @as(c_uint, @intCast(toU32(this))),
            c_int => @as(c_int, @intCast(toInt32(this))),
            ?AnyPromise => asAnyPromise(this),
            u52 => @as(u52, @truncate(@as(u64, @intCast(@max(this.toInt64(), 0))))),
            i52 => @as(i52, @truncate(@as(i52, @intCast(this.toInt64())))),
            u64 => toUInt64NoTruncate(this),
            u8 => @as(u8, @truncate(toU32(this))),
            i16 => @as(i16, @truncate(toInt32(this))),
            i8 => @as(i8, @truncate(toInt32(this))),
            i32 => @as(i32, @truncate(toInt32(this))),
            i64 => this.toInt64(),
            bool => this.toBoolean(),
            else => @compileError("Not implemented yet"),
        };
    }

    pub fn toPortNumber(this: JSValue, global: *JSGlobalObject) bun.JSError!u16 {
        if (this.isNumber()) {
            // const double = try this.toNumber(global);
            const double = this.coerceToDouble(global);
            if (std.math.isNan(double)) {
                return JSC.Error.ERR_SOCKET_BAD_PORT.throw(global, "Invalid port number", .{});
            }

            const port = this.to(i64);
            if (0 <= port and port <= 65535) {
                return @as(u16, @truncate(@max(0, port)));
            } else {
                return JSC.Error.ERR_SOCKET_BAD_PORT.throw(global, "Port number out of range: {d}", .{port});
            }
        }

        return JSC.Error.ERR_SOCKET_BAD_PORT.throw(global, "Invalid port number", .{});
    }

    extern fn JSC__JSValue__isInstanceOf(this: JSValue, global: *JSGlobalObject, constructor: JSValue) bool;
    pub fn isInstanceOf(this: JSValue, global: *JSGlobalObject, constructor: JSValue) bool {
        if (!this.isCell())
            return false;

        return JSC__JSValue__isInstanceOf(this, global, constructor);
    }

    pub fn callWithGlobalThis(this: JSValue, globalThis: *JSGlobalObject, args: []const JSC.JSValue) !JSC.JSValue {
        return this.call(globalThis, globalThis.toJSValue(), args);
    }

    pub extern "c" fn Bun__JSValue__call(
        ctx: *JSGlobalObject,
        object: JSValue,
        thisObject: JSValue,
        argumentCount: usize,
        arguments: [*]const JSValue,
    ) JSValue.MaybeException;

    pub fn call(function: JSValue, global: *JSGlobalObject, thisValue: JSC.JSValue, args: []const JSC.JSValue) bun.JSError!JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime bun.Environment.isDebug) {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.debug.js_call_count_outside_tick_queue += @as(usize, @intFromBool(!loop.debug.is_inside_tick_queue));
            if (loop.debug.track_last_fn_name and !loop.debug.is_inside_tick_queue) {
                loop.debug.last_fn_name.deref();
                loop.debug.last_fn_name = function.getName(global);
            }
            // Do not assert that the function is callable here.
            // The Bun__JSValue__call function will already assert that, and
            // this can be an async context so it's fine if it's not callable.
        }

        return Bun__JSValue__call(
            global,
            function,
            thisValue,
            args.len,
            args.ptr,
        ).unwrap();
    }

    pub fn callNextTick(function: JSValue, global: *JSGlobalObject, args: anytype) void {
        if (Environment.isDebug) {
            bun.assert(function.isCallable());
        }
        const num_args = @typeInfo(@TypeOf(args)).array.len;
        switch (num_args) {
            1 => JSC.Bun__Process__queueNextTick1(@ptrCast(global), function, args[0]),
            2 => JSC.Bun__Process__queueNextTick2(@ptrCast(global), function, args[0], args[1]),
            else => @compileError("needs more copy paste"),
        }
    }
    extern fn JSC__JSValue__jsType(this: JSValue) JSType;
    /// The value cannot be empty. Check `!this.isEmpty()` before calling this function
    pub fn jsType(
        this: JSValue,
    ) JSType {
        bun.assert(this != .zero);
        return JSC__JSValue__jsType(this);
    }

    pub fn jsTypeLoose(
        this: JSValue,
    ) JSType {
        if (this.isNumber()) {
            return JSType.NumberObject;
        }

        return this.jsType();
    }

    extern fn JSC__jsTypeStringForValue(globalObject: *JSGlobalObject, value: JSValue) *JSC.JSString;

    pub fn jsTypeString(this: JSValue, globalObject: *JSGlobalObject) *JSC.JSString {
        return JSC__jsTypeStringForValue(globalObject, this);
    }

    extern fn JSC__JSValue__createEmptyObjectWithNullPrototype(globalObject: *JSGlobalObject) JSValue;

    pub fn createEmptyObjectWithNullPrototype(global: *JSGlobalObject) JSValue {
        return JSC__JSValue__createEmptyObjectWithNullPrototype(global);
    }
    extern fn JSC__JSValue__createEmptyObject(global: *JSGlobalObject, len: usize) JSValue;
    /// Creates a new empty object, with Object as its prototype
    pub fn createEmptyObject(global: *JSGlobalObject, len: usize) JSValue {
        return JSC__JSValue__createEmptyObject(global, len);
    }

    extern fn JSC__JSValue__createEmptyArray(global: *JSGlobalObject, len: usize) JSValue;
    pub fn createEmptyArray(global: *JSGlobalObject, len: usize) JSValue {
        return JSC__JSValue__createEmptyArray(global, len);
    }

    extern fn JSC__JSValue__putRecord(value: JSValue, global: *JSGlobalObject, key: *ZigString, values_array: [*]ZigString, values_len: usize) void;
    pub fn putRecord(value: JSValue, global: *JSGlobalObject, key: *ZigString, values_array: [*]ZigString, values_len: usize) void {
        return JSC__JSValue__putRecord(value, global, key, values_array, values_len);
    }
    extern fn JSC__JSValue__put(value: JSValue, global: *JSGlobalObject, key: *const ZigString, result: JSC.JSValue) void;
    pub fn putZigString(value: JSValue, global: *JSGlobalObject, key: *const ZigString, result: JSC.JSValue) void {
        JSC__JSValue__put(value, global, key, result);
    }

    extern "c" fn JSC__JSValue__putBunString(value: JSValue, global: *JSGlobalObject, key: *const bun.String, result: JSC.JSValue) void;
    fn putBunString(value: JSValue, global: *JSGlobalObject, key: *const bun.String, result: JSC.JSValue) void {
        if (comptime bun.Environment.isDebug)
            JSC.markBinding(@src());
        JSC__JSValue__putBunString(value, global, key, result);
    }

    pub fn put(value: JSValue, global: *JSGlobalObject, key: anytype, result: JSC.JSValue) void {
        const Key = @TypeOf(key);
        if (comptime @typeInfo(Key) == .pointer) {
            const Elem = @typeInfo(Key).pointer.child;
            if (Elem == ZigString) {
                putZigString(value, global, key, result);
            } else if (Elem == bun.String) {
                putBunString(value, global, key, result);
            } else if (std.meta.Elem(Key) == u8) {
                putZigString(value, global, &ZigString.init(key), result);
            } else {
                @compileError("Unsupported key type in put(). Expected ZigString or bun.String, got " ++ @typeName(Elem));
            }
        } else if (comptime Key == ZigString) {
            putZigString(value, global, &key, result);
        } else if (comptime Key == bun.String) {
            putBunString(value, global, &key, result);
        } else {
            @compileError("Unsupported key type in put(). Expected ZigString or bun.String, got " ++ @typeName(Key));
        }
    }
    extern fn JSC__JSValue__putMayBeIndex(target: JSValue, globalObject: *JSGlobalObject, key: *const String, value: JSC.JSValue) void;
    /// Note: key can't be numeric (if so, use putMayBeIndex instead)
    /// Same as `.put` but accepts both non-numeric and numeric keys.
    /// Prefer to use `.put` if the key is guaranteed to be non-numeric (e.g. known at comptime)
    pub inline fn putMayBeIndex(this: JSValue, globalObject: *JSGlobalObject, key: *const String, value: JSValue) void {
        JSC__JSValue__putMayBeIndex(this, globalObject, key, value);
    }

    extern fn JSC__JSValue__putIndex(value: JSValue, globalObject: *JSGlobalObject, i: u32, out: JSValue) void;
    pub fn putIndex(value: JSValue, globalObject: *JSGlobalObject, i: u32, out: JSValue) void {
        JSC__JSValue__putIndex(value, globalObject, i, out);
    }

    extern fn JSC__JSValue__push(value: JSValue, globalObject: *JSGlobalObject, out: JSValue) void;
    pub fn push(value: JSValue, globalObject: *JSGlobalObject, out: JSValue) void {
        JSC__JSValue__push(value, globalObject, out);
    }

    extern fn JSC__JSValue__toISOString(*JSC.JSGlobalObject, JSC.JSValue, *[28]u8) c_int;
    pub fn toISOString(this: JSValue, globalObject: *JSC.JSGlobalObject, buf: *[28]u8) []const u8 {
        const count = JSC__JSValue__toISOString(globalObject, this, buf);
        if (count < 0) {
            return "";
        }

        return buf[0..@as(usize, @intCast(count))];
    }
    extern fn JSC__JSValue__DateNowISOString(*JSGlobalObject, f64) JSValue;
    pub fn getDateNowISOString(globalObject: *JSC.JSGlobalObject, buf: *[28]u8) []const u8 {
        const count = JSC__JSValue__DateNowISOString(globalObject, buf);
        if (count < 0) {
            return "";
        }

        return buf[0..@as(usize, @intCast(count))];
    }

    /// Return the pointer to the wrapped object only if it is a direct instance of the type.
    /// If the object does not match the type, return null.
    /// If the object is a subclass of the type or has mutated the structure, return null.
    /// Note: this may return null for direct instances of the type if the user adds properties to the object.
    pub fn asDirect(value: JSValue, comptime ZigType: type) ?*ZigType {
        bun.debugAssert(value.isCell()); // you must have already checked this.

        return ZigType.fromJSDirect(value);
    }

    pub fn as(value: JSValue, comptime ZigType: type) ?*ZigType {
        if (value.isEmptyOrUndefinedOrNull())
            return null;

        if (comptime ZigType == DOMURL) {
            return DOMURL.cast(value);
        }

        if (comptime ZigType == FetchHeaders) {
            return FetchHeaders.cast(value);
        }

        if (comptime ZigType == JSC.WebCore.Body.Value) {
            if (value.as(JSC.WebCore.Request)) |req| {
                return req.getBodyValue();
            }

            if (value.as(JSC.WebCore.Response)) |res| {
                return res.getBodyValue();
            }

            return null;
        }

        if (comptime @hasDecl(ZigType, "fromJS") and @TypeOf(ZigType.fromJS) == fn (JSC.JSValue) ?*ZigType) {
            if (comptime ZigType == JSC.WebCore.Blob) {
                if (ZigType.fromJS(value)) |blob| {
                    return blob;
                }

                if (JSC.API.BuildArtifact.fromJS(value)) |build| {
                    return &build.blob;
                }

                return null;
            }

            return ZigType.fromJS(value);
        }
    }

    extern fn JSC__JSValue__dateInstanceFromNullTerminatedString(*JSGlobalObject, [*:0]const u8) JSValue;
    pub fn fromDateString(globalObject: *JSGlobalObject, str: [*:0]const u8) JSValue {
        JSC.markBinding(@src());
        return JSC__JSValue__dateInstanceFromNullTerminatedString(globalObject, str);
    }

    extern fn JSC__JSValue__dateInstanceFromNumber(*JSGlobalObject, f64) JSValue;

    pub fn fromDateNumber(globalObject: *JSGlobalObject, value: f64) JSValue {
        JSC.markBinding(@src());
        return JSC__JSValue__dateInstanceFromNumber(globalObject, value);
    }

    extern fn JSBuffer__isBuffer(*JSGlobalObject, JSValue) bool;
    pub fn isBuffer(value: JSValue, global: *JSGlobalObject) bool {
        JSC.markBinding(@src());
        return JSBuffer__isBuffer(global, value);
    }

    pub fn isRegExp(this: JSValue) bool {
        return this.jsType() == .RegExpObject;
    }

    pub fn isDate(this: JSValue) bool {
        return this.jsType() == .JSDate;
    }

    /// Protects a JSValue from garbage collection.
    ///
    /// This is useful when you want to store a JSValue in a global or on the
    /// heap, where the garbage collector will not be able to discover your
    /// reference to it.
    ///
    /// A value may be protected multiple times and must be unprotected an
    /// equal number of times before becoming eligible for garbage collection.
    pub fn protect(this: JSValue) void {
        if (!this.isCell()) return;
        JSC.C.JSValueProtect(JSC.VirtualMachine.get().global, this.asObjectRef());
    }

    /// Unprotects a JSValue from garbage collection.
    ///
    /// A value may be protected multiple times and must be unprotected an
    /// equal number of times before becoming eligible for garbage collection.
    ///
    /// This is the inverse of `protect`.
    pub fn unprotect(this: JSValue) void {
        if (!this.isCell()) return;
        JSC.C.JSValueUnprotect(JSC.VirtualMachine.get().global, this.asObjectRef());
    }

    extern fn JSC__JSValue__JSONValueFromString(
        global: *JSGlobalObject,
        str: [*]const u8,
        len: usize,
        ascii: bool,
    ) JSValue;
    pub fn JSONValueFromString(
        global: *JSGlobalObject,
        str: [*]const u8,
        len: usize,
        ascii: bool,
    ) JSValue {
        return JSC__JSValue__JSONValueFromString(global, str, len, ascii);
    }
    extern fn JSC__JSValue__createObject2(global: *JSGlobalObject, key1: *const ZigString, key2: *const ZigString, value1: JSValue, value2: JSValue) JSValue;
    /// Create an object with exactly two properties
    pub fn createObject2(global: *JSGlobalObject, key1: *const ZigString, key2: *const ZigString, value1: JSValue, value2: JSValue) JSValue {
        return JSC__JSValue__createObject2(global, key1, key2, value1, value2);
    }

    pub fn asPromisePtr(this: JSValue, comptime T: type) *T {
        return asPtr(this, T);
    }

    extern fn JSC__JSValue__createRopeString(this: JSValue, rhs: JSValue, globalThis: *JSC.JSGlobalObject) JSValue;
    pub fn createRopeString(this: JSValue, rhs: JSValue, globalThis: *JSC.JSGlobalObject) JSValue {
        return JSC__JSValue__createRopeString(this, rhs, globalThis);
    }

    extern fn JSC__JSValue__getErrorsProperty(this: JSValue, globalObject: *JSGlobalObject) JSValue;
    pub fn getErrorsProperty(this: JSValue, globalObject: *JSGlobalObject) JSValue {
        return JSC__JSValue__getErrorsProperty(this, globalObject);
    }

    pub fn createBufferFromLength(globalObject: *JSGlobalObject, len: usize) JSValue {
        JSC.markBinding(@src());
        return JSBuffer__bufferFromLength(globalObject, @as(i64, @intCast(len)));
    }

    pub fn jestSnapshotPrettyFormat(this: JSValue, out: *MutableString, globalObject: *JSGlobalObject) !void {
        var buffered_writer = MutableString.BufferedWriter{ .context = out };
        const writer = buffered_writer.writer();
        const Writer = @TypeOf(writer);

        const fmt_options = JestPrettyFormat.FormatOptions{
            .enable_colors = false,
            .add_newline = false,
            .flush = false,
            .quote_strings = true,
        };

        try JestPrettyFormat.format(
            .Debug,
            globalObject,
            @as([*]const JSValue, @ptrCast(&this)),
            1,
            Writer,
            Writer,
            writer,
            fmt_options,
        );

        try buffered_writer.flush();
    }

    extern fn JSBuffer__bufferFromLength(*JSGlobalObject, i64) JSValue;

    /// Must come from globally-allocated memory if allocator is not null
    pub fn createBuffer(globalObject: *JSGlobalObject, slice: []u8, allocator: ?std.mem.Allocator) JSValue {
        JSC.markBinding(@src());
        @setRuntimeSafety(false);
        if (allocator) |alloc| {
            return JSBuffer__bufferFromPointerAndLengthAndDeinit(globalObject, slice.ptr, slice.len, alloc.ptr, JSC.MarkedArrayBuffer_deallocator);
        } else {
            return JSBuffer__bufferFromPointerAndLengthAndDeinit(globalObject, slice.ptr, slice.len, null, null);
        }
    }

    extern fn JSC__JSValue__createUninitializedUint8Array(globalObject: *JSGlobalObject, len: usize) JSValue;
    pub fn createUninitializedUint8Array(globalObject: *JSGlobalObject, len: usize) JSValue {
        JSC.markBinding(@src());
        return JSC__JSValue__createUninitializedUint8Array(globalObject, len);
    }

    pub fn createBufferWithCtx(globalObject: *JSGlobalObject, slice: []u8, ptr: ?*anyopaque, func: JSC.C.JSTypedArrayBytesDeallocator) JSValue {
        JSC.markBinding(@src());
        @setRuntimeSafety(false);
        return JSBuffer__bufferFromPointerAndLengthAndDeinit(globalObject, slice.ptr, slice.len, ptr, func);
    }

    extern fn JSBuffer__bufferFromPointerAndLengthAndDeinit(*JSGlobalObject, [*]u8, usize, ?*anyopaque, JSC.C.JSTypedArrayBytesDeallocator) JSValue;

    pub fn jsNumberWithType(comptime Number: type, number: Number) JSValue {
        if (@typeInfo(Number) == .@"enum") {
            return jsNumberWithType(@typeInfo(Number).@"enum".tag_type, @intFromEnum(number));
        }
        return switch (comptime Number) {
            JSValue => number,
            u0 => jsNumberFromInt32(0),
            f32, f64 => jsNumberFromDouble(@as(f64, number)),
            u31, c_ushort, u8, i16, i32, c_int, i8, u16 => jsNumberFromInt32(@as(i32, @intCast(number))),
            c_long, u32, u52, c_uint, i64, isize => jsNumberFromInt64(@as(i64, @intCast(number))),
            usize, u64 => jsNumberFromUint64(@as(u64, @intCast(number))),
            comptime_int => switch (number) {
                0...std.math.maxInt(i32) => jsNumberFromInt32(@as(i32, @intCast(number))),
                else => jsNumberFromInt64(@as(i64, @intCast(number))),
            },
            else => {
                @compileError("Type transformation missing for number of type: " ++ @typeName(Number));
            },
        };
    }

    extern fn JSC__JSValue__createInternalPromise(globalObject: *JSGlobalObject) JSValue;
    pub fn createInternalPromise(globalObject: *JSGlobalObject) JSValue {
        return JSC__JSValue__createInternalPromise(globalObject);
    }

    extern fn JSC__JSValue__asInternalPromise(JSValue0: JSValue) ?*JSInternalPromise;

    pub fn asInternalPromise(
        value: JSValue,
    ) ?*JSInternalPromise {
        return JSC__JSValue__asInternalPromise(value);
    }
    extern fn JSC__JSValue__asPromise(JSValue0: JSValue) ?*JSPromise;
    pub fn asPromise(
        value: JSValue,
    ) ?*JSPromise {
        return JSC__JSValue__asPromise(value);
    }

    pub fn asAnyPromise(
        value: JSValue,
    ) ?AnyPromise {
        if (value.isEmptyOrUndefinedOrNull()) return null;
        if (value.asInternalPromise()) |promise| {
            return AnyPromise{
                .internal = promise,
            };
        }
        if (value.asPromise()) |promise| {
            return AnyPromise{
                .normal = promise,
            };
        }
        return null;
    }

    extern fn JSC__JSValue__jsBoolean(i: bool) JSValue;
    pub inline fn jsBoolean(i: bool) JSValue {
        return JSC__JSValue__jsBoolean(i);
    }

    extern fn JSC__JSValue__jsDoubleNumber(i: f64) JSValue;
    pub fn jsDoubleNumber(i: f64) JSValue {
        return JSC__JSValue__jsDoubleNumber(i);
    }

    extern fn JSC__JSValue__jsEmptyString(globalThis: *JSGlobalObject) JSValue;
    pub inline fn jsEmptyString(globalThis: *JSGlobalObject) JSValue {
        return JSC__JSValue__jsEmptyString(globalThis);
    }

    pub inline fn jsNull() JSValue {
        return JSValue.null;
    }

    pub fn jsNumber(number: anytype) JSValue {
        return jsNumberWithType(@TypeOf(number), number);
    }

    extern fn JSC__JSValue__jsTDZValue() JSValue;
    pub inline fn jsTDZValue() JSValue {
        return JSC__JSValue__jsTDZValue();
    }

    pub inline fn jsUndefined() JSValue {
        return JSValue.undefined;
    }

    pub fn className(this: JSValue, globalThis: *JSGlobalObject) ZigString {
        var str = ZigString.init("");
        this.getClassName(globalThis, &str);
        return str;
    }

    pub fn print(
        this: JSValue,
        globalObject: *JSGlobalObject,
        message_type: JSC.ConsoleObject.MessageType,
        message_level: JSC.ConsoleObject.MessageLevel,
    ) void {
        JSC.ConsoleObject.messageWithTypeAndLevel(
            undefined,
            message_type,
            message_level,
            globalObject,
            &[_]JSC.JSValue{this},
            1,
        );
    }

    /// Create a JSValue string from a zig format-print (fmt + args)
    pub fn printString(globalThis: *JSGlobalObject, comptime stack_buffer_size: usize, comptime fmt: []const u8, args: anytype) !JSValue {
        var stack_fallback = std.heap.stackFallback(stack_buffer_size, globalThis.allocator());

        var buf = try bun.MutableString.init(stack_fallback.get(), stack_buffer_size);
        defer buf.deinit();

        var writer = buf.writer();
        try writer.print(fmt, args);
        return String.init(buf.slice()).toJS(globalThis);
    }

    /// Create a JSValue string from a zig format-print (fmt + args), with pretty format
    pub fn printStringPretty(globalThis: *JSGlobalObject, comptime stack_buffer_size: usize, comptime fmt: []const u8, args: anytype) !JSValue {
        var stack_fallback = std.heap.stackFallback(stack_buffer_size, globalThis.allocator());

        var buf = try bun.MutableString.init(stack_fallback.get(), stack_buffer_size);
        defer buf.deinit();

        var writer = buf.writer();
        switch (Output.enable_ansi_colors) {
            inline else => |enabled| try writer.print(Output.prettyFmt(fmt, enabled), args),
        }
        return String.init(buf.slice()).toJS(globalThis);
    }

    extern fn JSC__JSValue__fromEntries(globalThis: *JSGlobalObject, keys_array: [*c]ZigString, values_array: [*c]ZigString, strings_count: usize, clone: bool) JSValue;
    pub fn fromEntries(globalThis: *JSGlobalObject, keys_array: [*c]ZigString, values_array: [*c]ZigString, strings_count: usize, clone: bool) JSValue {
        return JSC__JSValue__fromEntries(
            globalThis,
            keys_array,
            values_array,
            strings_count,
            clone,
        );
    }

    extern fn JSC__JSValue__keys(globalThis: *JSGlobalObject, value: JSValue) JSValue;
    pub fn keys(value: JSValue, globalThis: *JSGlobalObject) JSValue {
        return JSC__JSValue__keys(
            globalThis,
            value,
        );
    }

    extern fn JSC__JSValue__values(globalThis: *JSGlobalObject, value: JSValue) JSValue;
    /// This is `Object.values`.
    /// `value` is assumed to be not empty, undefined, or null.
    pub fn values(value: JSValue, globalThis: *JSGlobalObject) JSValue {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(!value.isEmptyOrUndefinedOrNull());
        }
        return JSC__JSValue__values(
            globalThis,
            value,
        );
    }

    extern "c" fn JSC__JSValue__hasOwnPropertyValue(JSValue, *JSGlobalObject, JSValue) bool;
    /// Calls `Object.hasOwnProperty(value)`.
    /// Returns true if the object has the property, false otherwise
    ///
    /// If the object is not an object, it will crash. **You must check if the object is an object before calling this function.**
    pub const hasOwnPropertyValue = JSC__JSValue__hasOwnPropertyValue;

    pub inline fn arrayIterator(this: JSValue, global: *JSGlobalObject) JSArrayIterator {
        return JSArrayIterator.init(this, global);
    }

    pub fn jsNumberFromDouble(i: f64) JSValue {
        return FFI.DOUBLE_TO_JSVALUE(i).asJSValue;
    }
    extern fn JSC__JSValue__jsNumberFromChar(i: u8) JSValue;
    pub fn jsNumberFromChar(i: u8) JSValue {
        return JSC__JSValue__jsNumberFromChar(i);
    }
    extern fn JSC__JSValue__jsNumberFromU16(i: u16) JSValue;
    pub fn jsNumberFromU16(i: u16) JSValue {
        return JSC__JSValue__jsNumberFromU16(i);
    }
    pub fn jsNumberFromInt32(i: i32) JSValue {
        return FFI.INT32_TO_JSVALUE(i).asJSValue;
    }

    pub fn jsNumberFromInt64(i: i64) JSValue {
        if (i <= std.math.maxInt(i32) and i >= std.math.minInt(i32)) {
            return jsNumberFromInt32(@as(i32, @intCast(i)));
        }

        return jsNumberFromDouble(@floatFromInt(i));
    }

    pub inline fn toJS(this: JSValue, _: *const JSGlobalObject) JSValue {
        return this;
    }

    pub fn jsNumberFromUint64(i: u64) JSValue {
        if (i <= std.math.maxInt(i32)) {
            return jsNumberFromInt32(@as(i32, @intCast(i)));
        }

        return jsNumberFromPtrSize(i);
    }

    pub fn jsNumberFromPtrSize(i: usize) JSValue {
        return jsNumberFromDouble(@floatFromInt(i));
    }

    fn coerceJSValueDoubleTruncatingT(comptime T: type, num: f64) T {
        return coerceJSValueDoubleTruncatingTT(T, T, num);
    }

    fn coerceJSValueDoubleTruncatingTT(comptime T: type, comptime Out: type, num: f64) Out {
        if (std.math.isNan(num)) {
            return 0;
        }

        if (num <= std.math.minInt(T) or std.math.isNegativeInf(num)) {
            return std.math.minInt(T);
        }

        if (num >= std.math.maxInt(T) or std.math.isPositiveInf(num)) {
            return std.math.maxInt(T);
        }

        return @intFromFloat(num);
    }

    pub fn coerceDoubleTruncatingIntoInt64(this: JSValue) i64 {
        return coerceJSValueDoubleTruncatingT(i64, this.asNumber());
    }

    extern fn JSC__JSValue__toInt64(this: JSValue) i64;

    /// Decimal values are truncated without rounding.
    /// `-Infinity` and `NaN` coerce to -minInt(64)
    /// `Infinity` coerces to maxInt(64)
    pub fn toInt64(this: JSValue) i64 {
        if (this.isInt32()) {
            return this.asInt32();
        }

        if (this.isNumber()) {
            return this.coerceDoubleTruncatingIntoInt64();
        }

        return JSC__JSValue__toInt64(this);
    }

    pub const ComparisonResult = enum(u8) {
        equal,
        undefined_result,
        greater_than,
        less_than,
        invalid_comparison,
    };

    extern fn JSC__JSValue__asBigIntCompare(this: JSValue, global: *JSGlobalObject, other: JSValue) ComparisonResult;
    pub fn asBigIntCompare(this: JSValue, global: *JSGlobalObject, other: JSValue) ComparisonResult {
        if (!this.isBigInt() or (!other.isBigInt() and !other.isNumber())) {
            return .invalid_comparison;
        }
        return JSC__JSValue__asBigIntCompare(this, global, other);
    }

    pub inline fn isUndefined(this: JSValue) bool {
        return this == .undefined;
    }
    pub inline fn isNull(this: JSValue) bool {
        return this == .null;
    }
    pub inline fn isEmptyOrUndefinedOrNull(this: JSValue) bool {
        return switch (@intFromEnum(this)) {
            0, 0xa, 0x2 => true,
            else => false,
        };
    }
    pub fn isUndefinedOrNull(this: JSValue) bool {
        return switch (@intFromEnum(this)) {
            0xa, 0x2 => true,
            else => false,
        };
    }
    pub fn isBoolean(this: JSValue) bool {
        return this == .true or this == .false;
    }
    extern fn JSC__JSValue__isAnyInt(this: JSValue) bool;
    pub fn isAnyInt(this: JSValue) bool {
        return JSC__JSValue__isAnyInt(this);
    }
    extern fn JSC__JSValue__isUInt32AsAnyInt(this: JSValue) bool;
    pub fn isUInt32AsAnyInt(this: JSValue) bool {
        return JSC__JSValue__isUInt32AsAnyInt(this);
    }

    pub fn asEncoded(this: JSValue) FFI.EncodedJSValue {
        return FFI.EncodedJSValue{ .asJSValue = this };
    }

    pub fn fromCell(ptr: *anyopaque) JSValue {
        return (FFI.EncodedJSValue{ .asPtr = ptr }).asJSValue;
    }

    pub fn isInt32(this: JSValue) bool {
        return FFI.JSVALUE_IS_INT32(.{ .asJSValue = this });
    }

    extern fn JSC__JSValue__isInt32AsAnyInt(this: JSValue) bool;
    pub fn isInt32AsAnyInt(this: JSValue) bool {
        return JSC__JSValue__isInt32AsAnyInt(this);
    }

    pub fn isNumber(this: JSValue) bool {
        return FFI.JSVALUE_IS_NUMBER(.{ .asJSValue = this });
    }

    pub fn isDouble(this: JSValue) bool {
        return this.isNumber() and !this.isInt32();
    }

    /// [21.1.2.2 Number.isFinite](https://tc39.es/ecma262/#sec-number.isfinite)
    ///
    /// Returns `false` for non-numbers, `NaN`, `Infinity`, and `-Infinity`
    pub fn isFinite(this: JSValue) bool {
        if (!this.isNumber()) return false;
        return std.math.isFinite(this.asNumber());
    }

    pub fn isError(this: JSValue) bool {
        if (!this.isCell())
            return false;

        return this.jsType() == JSType.ErrorInstance;
    }

    extern fn JSC__JSValue__isAnyError(this: JSValue) bool;
    pub fn isAnyError(this: JSValue) bool {
        if (!this.isCell())
            return false;

        return JSC__JSValue__isAnyError(this);
    }

    extern fn JSC__JSValue__toError_(this: JSValue) JSValue;
    pub fn toError_(this: JSValue) JSValue {
        return JSC__JSValue__toError_(this);
    }

    pub fn toError(this: JSValue) ?JSValue {
        const res = this.toError_();
        if (res == .zero)
            return null;
        return res;
    }

    /// Returns true if
    /// - `" string literal"`
    /// - `new String("123")`
    /// - `class DerivedString extends String; new DerivedString("123")`
    pub inline fn isString(this: JSValue) bool {
        if (!this.isCell())
            return false;

        return jsType(this).isStringLike();
    }

    /// Returns true only for string literals
    /// - `" string literal"`
    pub inline fn isStringLiteral(this: JSValue) bool {
        if (!this.isCell()) {
            return false;
        }

        return jsType(this).isString();
    }

    /// Returns true if
    /// - `new String("123")`
    /// - `class DerivedString extends String; new DerivedString("123")`
    pub inline fn isStringObjectLike(this: JSValue) bool {
        if (!this.isCell()) {
            return false;
        }

        return jsType(this).isStringObjectLike();
    }

    extern fn JSC__JSValue__isBigInt(this: JSValue) bool;
    pub fn isBigInt(this: JSValue) bool {
        return JSC__JSValue__isBigInt(this);
    }
    extern fn JSC__JSValue__isHeapBigInt(this: JSValue) bool;
    pub fn isHeapBigInt(this: JSValue) bool {
        return JSC__JSValue__isHeapBigInt(this);
    }
    extern fn JSC__JSValue__isBigInt32(this: JSValue) bool;
    pub fn isBigInt32(this: JSValue) bool {
        return JSC__JSValue__isBigInt32(this);
    }
    extern fn JSC__JSValue__isSymbol(this: JSValue) bool;
    pub fn isSymbol(this: JSValue) bool {
        return JSC__JSValue__isSymbol(this);
    }
    extern fn JSC__JSValue__isPrimitive(this: JSValue) bool;
    pub fn isPrimitive(this: JSValue) bool {
        return JSC__JSValue__isPrimitive(this);
    }
    extern fn JSC__JSValue__isGetterSetter(this: JSValue) bool;
    pub fn isGetterSetter(this: JSValue) bool {
        return JSC__JSValue__isGetterSetter(this);
    }
    extern fn JSC__JSValue__isCustomGetterSetter(this: JSValue) bool;
    pub fn isCustomGetterSetter(this: JSValue) bool {
        return JSC__JSValue__isCustomGetterSetter(this);
    }
    pub inline fn isObject(this: JSValue) bool {
        return this.isCell() and this.jsType().isObject();
    }
    pub inline fn isArray(this: JSValue) bool {
        return this.isCell() and this.jsType().isArray();
    }
    pub inline fn isFunction(this: JSValue) bool {
        return this.isCell() and this.jsType().isFunction();
    }
    pub fn isObjectEmpty(this: JSValue, globalObject: *JSGlobalObject) bool {
        const type_of_value = this.jsType();
        // https://github.com/jestjs/jest/blob/main/packages/jest-get-type/src/index.ts#L26
        // Map and Set are not considered as object in jest-extended
        if (type_of_value.isMap() or type_of_value.isSet() or this.isRegExp() or this.isDate()) {
            return false;
        }

        return this.jsType().isObject() and keys(this, globalObject).getLength(globalObject) == 0;
    }

    extern fn JSC__JSValue__isClass(this: JSValue, global: *JSGlobalObject) bool;
    pub fn isClass(this: JSValue, global: *JSGlobalObject) bool {
        return JSC__JSValue__isClass(this, global);
    }

    extern fn JSC__JSValue__isConstructor(this: JSValue) bool;
    pub fn isConstructor(this: JSValue) bool {
        if (!this.isCell()) return false;
        return JSC__JSValue__isConstructor(this);
    }

    extern fn JSC__JSValue__getNameProperty(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void;
    pub fn getNameProperty(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void {
        if (this.isEmptyOrUndefinedOrNull()) {
            return;
        }

        JSC__JSValue__getNameProperty(this, global, ret);
    }

    extern fn JSC__JSValue__getName(JSC.JSValue, *JSC.JSGlobalObject, *bun.String) void;
    pub fn getName(this: JSValue, global: *JSGlobalObject) bun.String {
        var ret = bun.String.empty;
        JSC__JSValue__getName(this, global, &ret);
        return ret;
    }

    extern fn JSC__JSValue__getClassName(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void;
    pub fn getClassName(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void {
        JSC__JSValue__getClassName(this, global, ret);
    }

    pub inline fn isCell(this: JSValue) bool {
        return switch (this) {
            .zero, .undefined, .null, .true, .false => false,
            else => (@as(u64, @bitCast(@intFromEnum(this))) & FFI.NotCellMask) == 0,
        };
    }

    pub fn toJSString(globalObject: *JSC.JSGlobalObject, slice_: []const u8) JSC.JSValue {
        return JSC.ZigString.init(slice_).withEncoding().toJS(globalObject);
    }

    extern fn JSC__JSValue__asCell(this: JSValue) *JSCell;
    pub fn asCell(this: JSValue) *JSCell {
        // NOTE: asCell already asserts this, but since we're crossing an FFI
        // boundary, that assertion is opaque to the Zig compiler. By asserting
        // it twice we let Zig possibly optimize out other checks.
        bun.unsafeAssert(this.isCell());
        return JSC__JSValue__asCell(this);
    }

    extern fn JSC__JSValue__isCallable(this: JSValue) bool;
    pub fn isCallable(this: JSValue) bool {
        return JSC__JSValue__isCallable(this);
    }

    /// Statically cast a value to a cell. Returns `null` for non-cells.
    pub fn toCell(this: JSValue) ?*JSCell {
        return if (this.isCell()) this.asCell() else null;
    }

    extern fn JSC__JSValue__isException(this: JSValue, vm: *VM) bool;
    pub fn isException(this: JSValue, vm: *VM) bool {
        return JSC__JSValue__isException(this, vm);
    }

    extern fn JSC__JSValue__isTerminationException(this: JSValue, vm: *VM) bool;
    pub fn isTerminationException(this: JSValue, vm: *VM) bool {
        return JSC__JSValue__isTerminationException(this, vm);
    }

    extern fn JSC__JSValue__toZigException(this: JSValue, global: *JSGlobalObject, exception: *ZigException) void;
    pub fn toZigException(this: JSValue, global: *JSGlobalObject, exception: *ZigException) void {
        return JSC__JSValue__toZigException(this, global, exception);
    }

    extern fn JSC__JSValue__toZigString(this: JSValue, out: *ZigString, global: *JSGlobalObject) void;
    pub fn toZigString(this: JSValue, out: *ZigString, global: *JSGlobalObject) error{JSError}!void {
        JSC__JSValue__toZigString(this, out, global);
        if (global.hasException()) return error.JSError;
    }

    /// Increments the reference count, you must call `.deref()` or it will leak memory.
    pub fn toBunString(this: JSValue, globalObject: *JSC.JSGlobalObject) JSError!bun.String {
        return bun.String.fromJS(this, globalObject);
    }

    extern fn JSC__JSValue__toMatch(this: JSValue, global: *JSGlobalObject, other: JSValue) bool;

    /// this: RegExp value
    /// other: string value
    pub fn toMatch(this: JSValue, global: *JSGlobalObject, other: JSValue) bool {
        return JSC__JSValue__toMatch(this, global, other);
    }

    extern fn JSC__JSValue__asArrayBuffer_(this: JSValue, global: *JSGlobalObject, out: *ArrayBuffer) bool;
    pub fn asArrayBuffer_(this: JSValue, global: *JSGlobalObject, out: *ArrayBuffer) bool {
        return JSC__JSValue__asArrayBuffer_(this, global, out);
    }

    pub fn asArrayBuffer(this: JSValue, global: *JSGlobalObject) ?ArrayBuffer {
        var out: ArrayBuffer = .{
            .offset = 0,
            .len = 0,
            .byte_len = 0,
            .shared = false,
            .typed_array_type = .Uint8Array,
        };

        if (this.asArrayBuffer_(global, &out)) {
            out.value = this;
            return out;
        }

        return null;
    }
    extern fn JSC__JSValue__fromInt64NoTruncate(globalObject: *JSGlobalObject, i: i64) JSValue;
    /// This always returns a JS BigInt
    pub fn fromInt64NoTruncate(globalObject: *JSGlobalObject, i: i64) JSValue {
        return JSC__JSValue__fromInt64NoTruncate(globalObject, i);
    }
    extern fn JSC__JSValue__fromUInt64NoTruncate(globalObject: *JSGlobalObject, i: u64) JSValue;
    /// This always returns a JS BigInt
    pub fn fromUInt64NoTruncate(globalObject: *JSGlobalObject, i: u64) JSValue {
        return JSC__JSValue__fromUInt64NoTruncate(globalObject, i);
    }
    extern fn JSC__JSValue__fromTimevalNoTruncate(globalObject: *JSGlobalObject, nsec: i64, sec: i64) JSValue;
    /// This always returns a JS BigInt using std.posix.timeval from std.posix.rusage
    pub fn fromTimevalNoTruncate(globalObject: *JSGlobalObject, nsec: i64, sec: i64) JSValue {
        return JSC__JSValue__fromTimevalNoTruncate(globalObject, nsec, sec);
    }
    extern fn JSC__JSValue__bigIntSum(globalObject: *JSGlobalObject, a: JSValue, b: JSValue) JSValue;
    /// Sums two JS BigInts
    pub fn bigIntSum(globalObject: *JSGlobalObject, a: JSValue, b: JSValue) JSValue {
        return JSC__JSValue__bigIntSum(globalObject, a, b);
    }

    extern fn JSC__JSValue__toUInt64NoTruncate(this: JSValue) u64;
    pub fn toUInt64NoTruncate(this: JSValue) u64 {
        return JSC__JSValue__toUInt64NoTruncate(this);
    }

    /// Deprecated: replace with 'toBunString'
    pub fn getZigString(this: JSValue, global: *JSGlobalObject) bun.JSError!ZigString {
        var str = ZigString.init("");
        try this.toZigString(&str, global);
        return str;
    }

    /// Convert a JSValue to a string, potentially calling `toString` on the
    /// JSValue in JavaScript. Can throw an error.
    pub fn toSlice(this: JSValue, global: *JSGlobalObject, allocator: std.mem.Allocator) JSError!ZigString.Slice {
        const str = try bun.String.fromJS(this, global);
        defer str.deref();

        // This keeps the WTF::StringImpl alive if it was originally a latin1
        // ASCII-only string.
        //
        // Otherwise, it will be cloned using the allocator.
        return str.toUTF8(allocator);
    }

    pub inline fn toSliceZ(this: JSValue, global: *JSGlobalObject, allocator: std.mem.Allocator) ZigString.Slice {
        return getZigString(this, global).toSliceZ(allocator);
    }

    // On exception, this returns the empty string.
    extern fn JSC__JSValue__toString(this: JSValue, globalThis: *JSGlobalObject) *JSString;
    pub fn toString(this: JSValue, globalThis: *JSGlobalObject) *JSString {
        return JSC__JSValue__toString(this, globalThis);
    }

    extern fn JSC__JSValue__jsonStringify(this: JSValue, globalThis: *JSGlobalObject, indent: u32, out: *bun.String) void;
    pub fn jsonStringify(this: JSValue, globalThis: *JSGlobalObject, indent: u32, out: *bun.String) void {
        return JSC__JSValue__jsonStringify(this, globalThis, indent, out);
    }
    extern fn JSC__JSValue__toStringOrNull(this: JSValue, globalThis: *JSGlobalObject) ?*JSString;
    /// On exception, this returns null, to make exception checks clearer.
    pub fn toStringOrNull(this: JSValue, globalThis: *JSGlobalObject) ?*JSString {
        return JSC__JSValue__toStringOrNull(this, globalThis);
    }

    /// Call `toString()` on the JSValue and clone the result.
    pub fn toSliceOrNull(this: JSValue, globalThis: *JSGlobalObject) bun.JSError!ZigString.Slice {
        const str = try bun.String.fromJS(this, globalThis);
        defer str.deref();
        return str.toUTF8(bun.default_allocator);
    }

    /// Call `toString()` on the JSValue and clone the result.
    pub fn toSliceOrNullWithAllocator(this: JSValue, globalThis: *JSGlobalObject, allocator: std.mem.Allocator) bun.JSError!ZigString.Slice {
        const str = try bun.String.fromJS(this, globalThis);
        defer str.deref();
        return str.toUTF8(allocator);
    }

    /// Call `toString()` on the JSValue and clone the result.
    /// On exception or out of memory, this returns null.
    ///
    /// Remember that `Symbol` throws an exception when you call `toString()`.
    pub fn toSliceClone(this: JSValue, globalThis: *JSGlobalObject) ?ZigString.Slice {
        return this.toSliceCloneWithAllocator(globalThis, bun.default_allocator);
    }

    /// Call `toString()` on the JSValue and clone the result.
    /// On exception or out of memory, this returns null.
    ///
    /// Remember that `Symbol` throws an exception when you call `toString()`.
    pub fn toSliceCloneZ(this: JSValue, globalThis: *JSGlobalObject) JSError!?[:0]u8 {
        var str = try bun.String.fromJS(this, globalThis);
        return try str.toOwnedSliceZ(bun.default_allocator);
    }

    /// On exception or out of memory, this returns null, to make exception checks clearer.
    pub fn toSliceCloneWithAllocator(
        this: JSValue,
        globalThis: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) ?ZigString.Slice {
        var str = this.toStringOrNull(globalThis) orelse return null;
        return str.toSlice(globalThis, allocator).cloneIfNeeded(allocator) catch {
            globalThis.throwOutOfMemory() catch {}; // TODO: properly propagate exception upwards
            return null;
        };
    }

    /// Runtime conversion to an object. This can have side effects.
    ///
    /// For values that are already objects, this is effectively a reinterpret
    /// cast.
    ///
    /// ## References
    /// - [ECMA-262 7.1.18 ToObject](https://tc39.es/ecma262/#sec-toobject)
    extern fn JSC__JSValue__toObject(this: JSValue, globalThis: *JSGlobalObject) ?*JSObject;
    pub fn toObject(this: JSValue, globalThis: *JSGlobalObject) JSError!*JSObject {
        return JSC__JSValue__toObject(this, globalThis) orelse error.JSError;
    }

    /// Statically cast a value to a JSObject.
    ///
    /// Returns _null_ for non-objects. Use `toObject` to runtime-cast them instead.
    pub fn getObject(this: JSValue) ?*JSObject {
        return if (this.isObject()) this.uncheckedPtrCast(JSObject) else null;
    }

    extern fn JSC__JSValue__getPrototype(this: JSValue, globalObject: *JSGlobalObject) JSValue;
    pub fn getPrototype(this: JSValue, globalObject: *JSGlobalObject) JSValue {
        return JSC__JSValue__getPrototype(this, globalObject);
    }

    extern fn JSC__JSValue__eqlValue(this: JSValue, other: JSValue) bool;
    pub fn eqlValue(this: JSValue, other: JSValue) bool {
        return JSC__JSValue__eqlValue(this, other);
    }

    extern fn JSC__JSValue__eqlCell(this: JSValue, other: *JSCell) bool;
    pub fn eqlCell(this: JSValue, other: *JSCell) bool {
        return JSC__JSValue__eqlCell(this, other);
    }

    pub const BuiltinName = enum(u8) {
        method,
        headers,
        status,
        statusText,
        url,
        body,
        data,
        toString,
        redirect,
        inspectCustom,
        highWaterMark,
        path,
        stream,
        asyncIterator,
        name,
        message,
        @"error",
        default,
        encoding,
        fatal,
        ignoreBOM,
        type,
        signal,

        pub fn has(property: []const u8) bool {
            return bun.ComptimeEnumMap(BuiltinName).has(property);
        }

        pub fn get(property: []const u8) ?BuiltinName {
            return bun.ComptimeEnumMap(BuiltinName).get(property);
        }
    };

    pub fn fastGetOrElse(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName, alternate: ?JSC.JSValue) ?JSValue {
        return this.fastGet(global, builtin_name) orelse {
            if (alternate) |alt| return alt.fastGet(global, builtin_name);

            return null;
        };
    }

    // `this` must be known to be an object
    // intended to be more lightweight than ZigString.
    pub fn fastGet(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName) ?JSValue {
        if (bun.Environment.isDebug)
            bun.assert(this.isObject());

        return switch (JSC__JSValue__fastGet(this, global, @intFromEnum(builtin_name))) {
            .zero, .undefined, .property_does_not_exist_on_object => null,
            else => |val| val,
        };
    }

    pub fn fastGetWithError(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName) JSError!?JSValue {
        if (bun.Environment.isDebug)
            bun.assert(this.isObject());

        return switch (JSC__JSValue__fastGet(this, global, @intFromEnum(builtin_name))) {
            .zero => error.JSError,
            .undefined => null,
            .property_does_not_exist_on_object => null,
            else => |val| val,
        };
    }

    pub fn fastGetDirect(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName) ?JSValue {
        const result = fastGetDirect_(this, global, @intFromEnum(builtin_name));
        if (result == .zero) {
            return null;
        }

        return result;
    }

    extern fn JSC__JSValue__fastGet(value: JSValue, global: *JSGlobalObject, builtin_id: u8) JSValue;
    extern fn JSC__JSValue__fastGetOwn(value: JSValue, globalObject: *JSGlobalObject, property: BuiltinName) JSValue;
    pub fn fastGetOwn(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName) ?JSValue {
        const result = JSC__JSValue__fastGetOwn(this, global, builtin_name);
        if (result == .zero) {
            return null;
        }

        return result;
    }

    extern fn JSC__JSValue__fastGetDirect_(this: JSValue, global: *JSGlobalObject, builtin_name: u8) JSValue;
    pub fn fastGetDirect_(this: JSValue, global: *JSGlobalObject, builtin_name: u8) JSValue {
        return JSC__JSValue__fastGetDirect_(this, global, builtin_name);
    }

    extern fn JSC__JSValue__getIfPropertyExistsImpl(target: JSValue, global: *JSGlobalObject, ptr: [*]const u8, len: u32) JSValue;

    extern fn JSC__JSValue__getIfPropertyExistsFromPath(this: JSValue, global: *JSGlobalObject, path: JSValue) JSValue;
    pub fn getIfPropertyExistsFromPath(this: JSValue, global: *JSGlobalObject, path: JSValue) JSValue {
        return JSC__JSValue__getIfPropertyExistsFromPath(this, global, path);
    }

    extern fn JSC__JSValue__getSymbolDescription(this: JSValue, global: *JSGlobalObject, str: *ZigString) void;
    pub fn getSymbolDescription(this: JSValue, global: *JSGlobalObject, str: *ZigString) void {
        JSC__JSValue__getSymbolDescription(this, global, str);
    }

    extern fn JSC__JSValue__symbolFor(global: *JSGlobalObject, str: *ZigString) JSValue;
    pub fn symbolFor(global: *JSGlobalObject, str: *ZigString) JSValue {
        return JSC__JSValue__symbolFor(global, str);
    }

    extern fn JSC__JSValue__symbolKeyFor(this: JSValue, global: *JSGlobalObject, str: *ZigString) bool;
    pub fn symbolKeyFor(this: JSValue, global: *JSGlobalObject, str: *ZigString) bool {
        return JSC__JSValue__symbolKeyFor(this, global, str);
    }

    extern fn JSC__JSValue___then(this: JSValue, global: *JSGlobalObject, ctx: JSValue, resolve: JSC.JSHostFunctionPtr, reject: JSC.JSHostFunctionPtr) void;
    pub fn _then(this: JSValue, global: *JSGlobalObject, ctx: JSValue, resolve: JSNativeFn, reject: JSNativeFn) void {
        return JSC__JSValue___then(this, global, ctx, toJSHostFunction(resolve), toJSHostFunction(reject));
    }

    pub fn _then2(this: JSValue, global: *JSGlobalObject, ctx: JSValue, resolve: JSC.JSHostFunctionPtr, reject: JSC.JSHostFunctionPtr) void {
        return JSC__JSValue___then(this, global, ctx, resolve, reject);
    }

    pub fn then(this: JSValue, global: *JSGlobalObject, ctx: ?*anyopaque, resolve: JSNativeFn, reject: JSNativeFn) void {
        if (comptime bun.Environment.allow_assert)
            bun.assert(JSValue.fromPtr(ctx).asPtr(anyopaque) == ctx.?);
        return this._then(global, JSValue.fromPtr(ctx), resolve, reject);
    }

    pub fn getDescription(this: JSValue, global: *JSGlobalObject) ZigString {
        var zig_str = ZigString.init("");
        getSymbolDescription(this, global, &zig_str);
        return zig_str;
    }

    /// Equivalent to `obj.property` in JavaScript.
    /// Reminder: `undefined` is a value!
    ///
    /// Prefer `get` in new code, as this function is incapable of returning an exception
    pub fn get_unsafe(this: JSValue, global: *JSGlobalObject, property: []const u8) ?JSValue {
        if (comptime bun.Environment.isDebug) {
            if (BuiltinName.has(property)) {
                Output.debugWarn("get(\"{s}\") called. Please use fastGet(.{s}) instead!", .{ property, property });
            }
        }

        return switch (JSC__JSValue__getIfPropertyExistsImpl(this, global, property.ptr, @intCast(property.len))) {
            .undefined, .zero, .property_does_not_exist_on_object => null,
            else => |val| val,
        };
    }

    /// Equivalent to `target[property]`. Calls userland getters/proxies.  Can
    /// throw. Null indicates the property does not exist. JavaScript undefined
    /// and JavaScript null can exist as a property and is different than zig
    /// `null` (property does not exist).
    ///
    /// `property` must be either `[]const u8`. A comptime slice may defer to
    /// calling `fastGet`, which use a more optimal code path. This function is
    /// marked `inline` to allow Zig to determine if `fastGet` should be used
    /// per invocation.
    pub inline fn get(target: JSValue, global: *JSGlobalObject, property: anytype) JSError!?JSValue {
        if (bun.Environment.isDebug) bun.assert(target.isObject());
        const property_slice: []const u8 = property; // must be a slice!

        // This call requires `get` to be `inline`
        if (bun.isComptimeKnown(property_slice)) {
            if (comptime BuiltinName.get(property_slice)) |builtin_name| {
                return target.fastGetWithError(global, builtin_name);
            }
        }

        return switch (JSC__JSValue__getIfPropertyExistsImpl(target, global, property_slice.ptr, @intCast(property_slice.len))) {
            .zero => error.JSError,
            .property_does_not_exist_on_object => null,

            // TODO: see bug described in ObjectBindings.cpp
            // since there are false positives, the better path is to make them
            // negatives, as the number of places that desire throwing on
            // existing undefined is extremely small, but non-zero.
            .undefined => null,
            else => |val| val,
        };
    }

    extern fn JSC__JSValue__getOwn(value: JSValue, globalObject: *JSGlobalObject, propertyName: *const bun.String) JSValue;

    /// Get *own* property value (i.e. does not resolve property in the prototype chain)
    pub fn getOwn(this: JSValue, global: *JSGlobalObject, property_name: anytype) ?JSValue {
        var property_name_str = bun.String.init(property_name);
        const value = JSC__JSValue__getOwn(this, global, &property_name_str);
        return if (@intFromEnum(value) != 0) value else return null;
    }

    extern fn JSC__JSValue__getOwnByValue(value: JSValue, globalObject: *JSGlobalObject, propertyValue: JSValue) JSValue;

    pub fn getOwnByValue(this: JSValue, global: *JSGlobalObject, property_value: JSValue) ?JSValue {
        const value = JSC__JSValue__getOwnByValue(this, global, property_value);
        return if (@intFromEnum(value) != 0) value else return null;
    }

    pub fn getOwnTruthy(this: JSValue, global: *JSGlobalObject, property_name: anytype) ?JSValue {
        if (getOwn(this, global, property_name)) |prop| {
            if (prop == .undefined) return null;
            return prop;
        }

        return null;
    }

    /// Safe to use on any JSValue
    pub fn implementsToString(this: JSValue, global: *JSGlobalObject) bool {
        if (!this.isObject())
            return false;
        const function = this.fastGet(global, BuiltinName.toString) orelse
            return false;
        return function.isCell() and function.isCallable();
    }

    // TODO: replace calls to this function with `getOptional`
    pub fn getOwnTruthyComptime(this: JSValue, global: *JSGlobalObject, comptime property: []const u8) ?JSValue {
        if (comptime bun.ComptimeEnumMap(BuiltinName).has(property)) {
            return fastGetOwn(this, global, @field(BuiltinName, property));
        }

        return getOwnTruthy(this, global, property);
    }

    fn truthyPropertyValue(prop: JSValue) ?JSValue {
        return switch (prop) {
            .zero => unreachable,

            // Treat undefined and null as unspecified
            .null, .undefined => null,

            // false, 0, are deliberately not included in this list.
            // That would prevent you from passing `0` or `false` to various Bun APIs.

            else => {
                // Ignore empty string.
                if (prop.isString()) {
                    if (!prop.toBoolean()) {
                        return null;
                    }
                }

                return prop;
            },
        };
    }

    // TODO: replace calls to this function with `getOptional`
    pub fn getTruthyComptime(this: JSValue, global: *JSGlobalObject, comptime property: []const u8) bun.JSError!?JSValue {
        if (comptime BuiltinName.has(property)) {
            return truthyPropertyValue(fastGet(this, global, @field(BuiltinName, property)) orelse return null);
        }

        return getTruthy(this, global, property);
    }

    // TODO: replace calls to this function with `getOptional`
    pub fn getTruthy(this: JSValue, global: *JSGlobalObject, property: []const u8) bun.JSError!?JSValue {
        if (try get(this, global, property)) |prop| {
            return truthyPropertyValue(prop);
        }

        return null;
    }

    /// Get a value that can be coerced to a string.
    ///
    /// Returns null when the value is:
    /// - JSValue.null
    /// - JSValue.false
    /// - JSValue.undefined
    /// - an empty string
    pub fn getStringish(this: JSValue, global: *JSGlobalObject, property: []const u8) bun.JSError!?bun.String {
        const prop = try get(this, global, property) orelse return null;
        if (prop.isNull() or prop == .false) {
            return null;
        }
        if (prop.isSymbol()) {
            return global.throwInvalidPropertyTypeValue(property, "string", prop);
        }

        const str = try prop.toBunString(global);
        if (global.hasException()) {
            str.deref();
            return error.JSError;
        }
        if (str.isEmpty()) {
            return null;
        }
        return str;
    }

    pub fn toEnumFromMap(
        this: JSValue,
        globalThis: *JSGlobalObject,
        comptime property_name: []const u8,
        comptime Enum: type,
        comptime StringMap: anytype,
    ) JSError!Enum {
        if (!this.isString()) {
            return globalThis.throwInvalidArguments(property_name ++ " must be a string", .{});
        }

        return try StringMap.fromJS(globalThis, this) orelse {
            const one_of = struct {
                pub const list = brk: {
                    var str: []const u8 = "'";
                    const field_names = bun.meta.enumFieldNames(Enum);
                    for (field_names, 0..) |entry, i| {
                        str = str ++ entry ++ "'";
                        if (i < field_names.len - 2) {
                            str = str ++ ", '";
                        } else if (i == field_names.len - 2) {
                            str = str ++ " or '";
                        }
                    }
                    break :brk str;
                };

                pub const label = property_name ++ " must be one of " ++ list;
            }.label;

            return globalThis.throwInvalidArguments(one_of, .{});
        };
    }

    pub fn toEnum(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime Enum: type) JSError!Enum {
        return toEnumFromMap(this, globalThis, property_name, Enum, Enum.Map);
    }

    pub fn toOptionalEnum(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime Enum: type) JSError!?Enum {
        if (this.isEmptyOrUndefinedOrNull())
            return null;

        return toEnum(this, globalThis, property_name, Enum);
    }

    pub fn getOptionalEnum(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime Enum: type) JSError!?Enum {
        if (comptime BuiltinName.has(property_name)) {
            if (fastGet(this, globalThis, @field(BuiltinName, property_name))) |prop| {
                if (prop.isEmptyOrUndefinedOrNull())
                    return null;
                return try toEnum(prop, globalThis, property_name, Enum);
            }
            return null;
        }

        if (try get(this, globalThis, property_name)) |prop| {
            if (prop.isEmptyOrUndefinedOrNull())
                return null;
            return try toEnum(prop, globalThis, property_name, Enum);
        }
        return null;
    }

    pub fn getOwnOptionalEnum(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime Enum: type) JSError!?Enum {
        if (comptime BuiltinName.has(property_name)) {
            if (fastGetOwn(this, globalThis, @field(BuiltinName, property_name))) |prop| {
                if (prop.isEmptyOrUndefinedOrNull())
                    return null;
                return try toEnum(prop, globalThis, property_name, Enum);
            }
            return null;
        }

        if (getOwn(this, globalThis, property_name)) |prop| {
            if (prop.isEmptyOrUndefinedOrNull())
                return null;
            return try toEnum(prop, globalThis, property_name, Enum);
        }
        return null;
    }

    pub fn coerceToArray(prop: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8) JSError!?JSValue {
        if (!prop.jsTypeLoose().isArray()) {
            return globalThis.throwInvalidArguments(property_name ++ " must be an array", .{});
        }

        if (prop.getLength(globalThis) == 0) {
            return null;
        }

        return prop;
    }

    pub fn getArray(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8) JSError!?JSValue {
        if (try this.getOptional(globalThis, property_name, JSValue)) |prop| {
            return coerceToArray(prop, globalThis, property_name);
        }

        return null;
    }

    pub fn getOwnArray(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8) JSError!?JSValue {
        if (getOwnTruthy(this, globalThis, property_name)) |prop| {
            return coerceToArray(prop, globalThis, property_name);
        }

        return null;
    }

    pub fn getOwnObject(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8) JSError!?*JSC.JSObject {
        if (getOwnTruthy(this, globalThis, property_name)) |prop| {
            const obj = prop.getObject() orelse {
                return globalThis.throwInvalidArguments(property_name ++ " must be an object", .{});
            };

            return obj;
        }

        return null;
    }

    pub fn getFunction(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8) JSError!?JSValue {
        if (try this.getOptional(globalThis, property_name, JSValue)) |prop| {
            if (!prop.isCell() or !prop.isCallable()) {
                return globalThis.throwInvalidArguments(property_name ++ " must be a function", .{});
            }

            return prop;
        }

        return null;
    }

    pub fn getOwnFunction(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8) JSError!?JSValue {
        if (getOwnTruthy(this, globalThis, property_name)) |prop| {
            if (!prop.isCell() or !prop.isCallable()) {
                return globalThis.throwInvalidArguments(property_name ++ " must be a function", .{});
            }

            return prop;
        }

        return null;
    }

    fn coerceOptional(prop: JSValue, global: *JSGlobalObject, comptime property_name: []const u8, comptime T: type) JSError!T {
        switch (comptime T) {
            JSValue => return prop,
            bool => @compileError("ambiguous coercion: use getBooleanStrict (throw error if not boolean) or getBooleanLoose (truthy check, never throws)"),
            ZigString.Slice => {
                if (prop.isString()) {
                    return try prop.toSliceOrNull(global);
                }
                return JSC.Node.validators.throwErrInvalidArgType(global, property_name, .{}, "string", prop);
            },
            i32 => return prop.coerce(i32, global),
            i64 => return prop.coerce(i64, global),
            else => @compileError("TODO:" ++ @typeName(T)),
        }
    }

    /// Many Bun API are loose and simply want to check if a value is truthy
    /// Missing value, null, and undefined return `null`
    pub inline fn getBooleanLoose(this: JSValue, global: *JSGlobalObject, comptime property_name: []const u8) JSError!?bool {
        const prop = try this.get(global, property_name) orelse return null;
        return prop.toBoolean();
    }

    /// Many Node.js APIs use `validateBoolean`
    /// Missing value and undefined return `null`
    pub inline fn getBooleanStrict(this: JSValue, global: *JSGlobalObject, comptime property_name: []const u8) JSError!?bool {
        const prop = try this.get(global, property_name) orelse return null;

        return switch (prop) {
            .undefined => null,
            .false, .true => prop == .true,
            else => {
                return JSC.Node.validators.throwErrInvalidArgType(global, property_name, .{}, "boolean", prop);
            },
        };
    }

    pub inline fn getOptional(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime T: type) JSError!?T {
        const prop = try this.get(globalThis, property_name) orelse return null;
        bun.assert(prop != .zero);

        if (!prop.isUndefinedOrNull()) {
            return try coerceOptional(prop, globalThis, property_name, T);
        }

        return null;
    }

    pub fn getOwnOptional(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime T: type) JSError!?T {
        const prop = (if (comptime BuiltinName.has(property_name))
            fastGetOwn(this, globalThis, @field(BuiltinName, property_name))
        else
            getOwn(this, globalThis, property_name)) orelse return null;

        if (!prop.isEmptyOrUndefinedOrNull()) {
            return coerceOptional(prop, globalThis, property_name, T);
        }

        return null;
    }

    /// Alias for getIfPropertyExists
    pub const getIfPropertyExists = get;

    extern fn JSC__JSValue__createTypeError(message: *const ZigString, code: *const ZigString, global: *JSGlobalObject) JSValue;
    pub fn createTypeError(message: *const ZigString, code: *const ZigString, global: *JSGlobalObject) JSValue {
        return JSC__JSValue__createTypeError(message, code, global);
    }

    extern fn JSC__JSValue__createRangeError(message: *const ZigString, code: *const ZigString, global: *JSGlobalObject) JSValue;
    pub fn createRangeError(message: *const ZigString, code: *const ZigString, global: *JSGlobalObject) JSValue {
        return JSC__JSValue__createRangeError(message, code, global);
    }

    extern fn JSC__JSValue__isSameValue(this: JSValue, other: JSValue, global: *JSGlobalObject) bool;

    /// Object.is()
    ///
    /// This algorithm differs from the IsStrictlyEqual Algorithm by treating all NaN values as equivalent and by differentiating +0𝔽 from -0𝔽.
    /// https://tc39.es/ecma262/#sec-samevalue
    pub fn isSameValue(this: JSValue, other: JSValue, global: *JSGlobalObject) bool {
        return @intFromEnum(this) == @intFromEnum(other) or JSC__JSValue__isSameValue(this, other, global);
    }

    extern fn JSC__JSValue__deepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool;
    pub fn deepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) JSError!bool {
        const result = JSC__JSValue__deepEquals(this, other, global);
        if (global.hasException()) return error.JSError;
        return result;
    }
    extern fn JSC__JSValue__jestDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool;
    /// same as `JSValue.deepEquals`, but with jest asymmetric matchers enabled
    pub fn jestDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) JSError!bool {
        const result = JSC__JSValue__jestDeepEquals(this, other, global);
        if (global.hasException()) return error.JSError;
        return result;
    }

    extern fn JSC__JSValue__strictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool;
    pub fn strictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) JSError!bool {
        const result = JSC__JSValue__strictDeepEquals(this, other, global);
        if (global.hasException()) return error.JSError;
        return result;
    }
    extern fn JSC__JSValue__jestStrictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool;
    /// same as `JSValue.strictDeepEquals`, but with jest asymmetric matchers enabled
    pub fn jestStrictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) JSError!bool {
        const result = JSC__JSValue__jestStrictDeepEquals(this, other, global);
        if (global.hasException()) return error.JSError;
        return result;
    }
    extern fn JSC__JSValue__deepMatch(this: JSValue, subset: JSValue, global: *JSGlobalObject, replace_props_with_asymmetric_matchers: bool) bool;
    /// NOTE: can throw. Check for exceptions.
    pub fn deepMatch(this: JSValue, subset: JSValue, global: *JSGlobalObject, replace_props_with_asymmetric_matchers: bool) bool {
        return JSC__JSValue__deepMatch(this, subset, global, replace_props_with_asymmetric_matchers);
    }
    extern fn JSC__JSValue__jestDeepMatch(this: JSValue, subset: JSValue, global: *JSGlobalObject, replace_props_with_asymmetric_matchers: bool) bool;
    /// same as `JSValue.deepMatch`, but with jest asymmetric matchers enabled
    pub fn jestDeepMatch(this: JSValue, subset: JSValue, global: *JSGlobalObject, replace_props_with_asymmetric_matchers: bool) bool {
        return JSC__JSValue__jestDeepMatch(this, subset, global, replace_props_with_asymmetric_matchers);
    }

    pub const DiffMethod = enum(u8) {
        none,
        character,
        word,
        line,
    };

    pub fn determineDiffMethod(this: JSValue, other: JSValue, global: *JSGlobalObject) DiffMethod {
        if ((this.isString() and other.isString()) or (this.isBuffer(global) and other.isBuffer(global))) return .character;
        if ((this.isRegExp() and other.isObject()) or (this.isObject() and other.isRegExp())) return .character;
        if (this.isObject() and other.isObject()) return .line;

        return .none;
    }

    /// Static cast a value into a `JSC::JSString`. Casting a non-string results
    /// in safety-protected undefined behavior.
    ///
    /// - `this` is re-interpreted, so runtime casting does not occur (e.g. `this.toString()`)
    /// - Does not allocate
    /// - Does not increment ref count
    /// - Make sure `this` stays on the stack. If you're method chaining, you may need to call `this.ensureStillAlive()`.
    pub fn asString(this: JSValue) *JSString {
        return JSC__JSValue__asString(this);
    }
    extern fn JSC__JSValue__asString(this: JSValue) *JSString;

    extern fn JSC__JSValue__getUnixTimestamp(this: JSValue) f64;

    /// Get the internal number of the `JSC::DateInstance` object
    /// Returns NaN if the value is not a `JSC::DateInstance` (`Date` in JS)
    pub fn getUnixTimestamp(this: JSValue) f64 {
        return JSC__JSValue__getUnixTimestamp(this);
    }

    extern fn JSC__JSValue__getUTCTimestamp(globalObject: *JSC.JSGlobalObject, this: JSValue) f64;
    /// Calls getTime() - getUTCT
    pub fn getUTCTimestamp(this: JSValue, globalObject: *JSC.JSGlobalObject) f64 {
        return JSC__JSValue__getUTCTimestamp(globalObject, this);
    }

    pub const StringFormatter = struct {
        value: JSC.JSValue,
        globalObject: *JSC.JSGlobalObject,

        pub fn format(this: StringFormatter, comptime text: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
            const str = try this.value.toBunString(this.globalObject);
            defer str.deref();
            try str.format(text, opts, writer);
        }
    };

    pub fn fmtString(this: JSValue, globalObject: *JSC.JSGlobalObject) StringFormatter {
        return .{
            .value = this,
            .globalObject = globalObject,
        };
    }

    pub fn toFmt(
        this: JSValue,
        formatter: *Exports.ConsoleObject.Formatter,
    ) Exports.ConsoleObject.Formatter.ZigFormatter {
        formatter.remaining_values = &[_]JSValue{};
        if (formatter.map_node != null) {
            formatter.deinit();
        }
        formatter.stack_check.update();

        return Exports.ConsoleObject.Formatter.ZigFormatter{
            .formatter = formatter,
            .value = this,
        };
    }

    /// Check if the JSValue is either a signed 32-bit integer or a double and
    /// return the value as a f64
    ///
    /// This does not call `valueOf` on the JSValue
    pub fn getNumber(this: JSValue) ?f64 {
        if (this.isInt32()) {
            return @as(f64, @floatFromInt(this.asInt32()));
        }

        if (isNumber(this)) {
            // Don't need to check for !isInt32() because above
            return asDouble(this);
        }

        return null;
    }

    extern fn JSC__JSValue__asNumber(this: JSValue) f64;
    pub fn asNumber(this: JSValue) f64 {
        if (this.isInt32()) {
            return @as(f64, @floatFromInt(this.asInt32()));
        }

        if (isNumber(this)) {
            // Don't need to check for !isInt32() because above
            return asDouble(this);
        }

        if (this.isUndefinedOrNull()) {
            return 0.0;
        } else if (this.isBoolean()) {
            return if (asBoolean(this)) 1.0 else 0.0;
        }

        return JSC__JSValue__asNumber(this);
    }

    pub fn asDouble(this: JSValue) f64 {
        bun.assert(this.isDouble());
        return FFI.JSVALUE_TO_DOUBLE(.{ .asJSValue = this });
    }

    pub fn asPtr(this: JSValue, comptime Pointer: type) *Pointer {
        return @as(*Pointer, @ptrFromInt(this.asPtrAddress()));
    }

    pub fn fromPtrAddress(addr: anytype) JSValue {
        return jsNumber(@as(f64, @floatFromInt(@as(usize, @bitCast(@as(usize, addr))))));
    }

    pub fn asPtrAddress(this: JSValue) usize {
        return @as(usize, @bitCast(@as(usize, @intFromFloat(this.asDouble()))));
    }

    pub fn fromPtr(addr: anytype) JSValue {
        return fromPtrAddress(@intFromPtr(addr));
    }
    extern fn JSC__JSValue__toBoolean(this: JSValue) bool;
    /// Equivalent to the `!!` operator
    pub fn toBoolean(this: JSValue) bool {
        return this != .zero and JSC__JSValue__toBoolean(this);
    }

    pub fn asBoolean(this: JSValue) bool {
        if (comptime bun.Environment.allow_assert) {
            if (!this.isBoolean()) {
                Output.panic("Expected boolean but found {s}", .{@tagName(this.jsTypeLoose())});
            }
        }
        return FFI.JSVALUE_TO_BOOL(.{ .asJSValue = this });
    }

    pub inline fn asInt52(this: JSValue) i64 {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(this.isNumber());
        }
        return coerceJSValueDoubleTruncatingTT(i52, i64, this.asNumber());
    }

    extern fn JSC__JSValue__toInt32(this: JSValue) i32;
    pub fn toInt32(this: JSValue) i32 {
        if (this.isInt32()) {
            return asInt32(this);
        }

        if (this.getNumber()) |num| {
            return coerceJSValueDoubleTruncatingT(i32, num);
        }

        if (comptime bun.Environment.allow_assert) {
            bun.assert(!this.isString()); // use coerce() instead
            bun.assert(!this.isCell()); // use coerce() instead
        }

        // TODO: this shouldn't be reachable.
        return JSC__JSValue__toInt32(this);
    }

    pub fn asInt32(this: JSValue) i32 {
        // TODO: promote assertion to allow_assert. That has not been done because
        // the assertion was commented out until 2024-12-12
        if (bun.Environment.isDebug) {
            bun.assert(this.isInt32());
        }
        return FFI.JSVALUE_TO_INT32(.{ .asJSValue = this });
    }

    pub fn asFileDescriptor(this: JSValue) bun.FileDescriptor {
        bun.assert(this.isNumber());
        return bun.FDImpl.fromUV(this.toInt32()).encode();
    }

    pub inline fn toU16(this: JSValue) u16 {
        return @as(u16, @truncate(@max(this.toInt32(), 0)));
    }

    pub inline fn toU32(this: JSValue) u32 {
        return @as(u32, @intCast(@min(@max(this.toInt64(), 0), std.math.maxInt(u32))));
    }

    /// This function supports:
    /// - Array, DerivedArray & friends
    /// - String, DerivedString & friends
    /// - TypedArray
    /// - Map (size)
    /// - WeakMap (size)
    /// - Set (size)
    /// - WeakSet (size)
    /// - ArrayBuffer (byteLength)
    /// - anything with a .length property returning a number
    ///
    /// If the "length" property does not exist, this function will return 0.
    pub fn getLength(this: JSValue, globalThis: *JSGlobalObject) u64 {
        const len = this.getLengthIfPropertyExistsInternal(globalThis);
        if (len == std.math.floatMax(f64)) {
            return 0;
        }

        return @as(u64, @intFromFloat(@max(@min(len, std.math.maxInt(i52)), 0)));
    }

    /// This function supports:
    /// - Array, DerivedArray & friends
    /// - String, DerivedString & friends
    /// - TypedArray
    /// - Map (size)
    /// - WeakMap (size)
    /// - Set (size)
    /// - WeakSet (size)
    /// - ArrayBuffer (byteLength)
    /// - anything with a .length property returning a number
    ///
    /// If the "length" property does not exist, this function will return null.
    pub fn tryGetLength(this: JSValue, globalThis: *JSGlobalObject) ?f64 {
        const len = this.getLengthIfPropertyExistsInternal(globalThis);
        if (len == std.math.floatMax(f64)) {
            return null;
        }

        return @as(u64, @intFromFloat(@max(@min(len, std.math.maxInt(i52)), 0)));
    }

    extern fn JSC__JSValue__getLengthIfPropertyExistsInternal(this: JSValue, globalThis: *JSGlobalObject) f64;
    /// Do not use this directly!
    ///
    /// If the property does not exist, this function will return max(f64) instead of 0.
    pub fn getLengthIfPropertyExistsInternal(this: JSValue, globalThis: *JSGlobalObject) f64 {
        return JSC__JSValue__getLengthIfPropertyExistsInternal(this, globalThis);
    }

    extern fn JSC__JSValue__isAggregateError(this: JSValue, globalObject: *JSGlobalObject) bool;
    pub fn isAggregateError(this: JSValue, globalObject: *JSGlobalObject) bool {
        return JSC__JSValue__isAggregateError(this, globalObject);
    }

    extern fn JSC__JSValue__forEach(this: JSValue, globalObject: *JSGlobalObject, ctx: ?*anyopaque, callback: *const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void) void;
    pub fn forEach(
        this: JSValue,
        globalObject: *JSGlobalObject,
        ctx: ?*anyopaque,
        callback: *const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void,
    ) void {
        return JSC__JSValue__forEach(this, globalObject, ctx, callback);
    }

    /// Same as `forEach` but accepts a typed context struct without need for @ptrCasts
    pub inline fn forEachWithContext(
        this: JSValue,
        globalObject: *JSGlobalObject,
        ctx: anytype,
        callback: *const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: @TypeOf(ctx), nextValue: JSValue) callconv(.C) void,
    ) void {
        const func = @as(*const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void, @ptrCast(callback));
        return JSC__JSValue__forEach(this, globalObject, ctx, func);
    }

    extern fn JSC__JSValue__isIterable(this: JSValue, globalObject: *JSGlobalObject) bool;
    pub fn isIterable(this: JSValue, globalObject: *JSGlobalObject) bool {
        return JSC__JSValue__isIterable(this, globalObject);
    }

    extern fn JSC__JSValue__stringIncludes(this: JSValue, globalObject: *JSGlobalObject, other: JSValue) bool;
    pub fn stringIncludes(this: JSValue, globalObject: *JSGlobalObject, other: JSValue) bool {
        return JSC__JSValue__stringIncludes(this, globalObject, other);
    }

    // TODO: remove this (no replacement)
    pub inline fn asRef(this: JSValue) C_API.JSValueRef {
        return @as(C_API.JSValueRef, @ptrFromInt(@as(usize, @bitCast(@intFromEnum(this)))));
    }

    // TODO: remove this (no replacement)
    pub inline fn c(this: C_API.JSValueRef) JSValue {
        return @as(JSValue, @enumFromInt(@as(JSValueReprInt, @bitCast(@intFromPtr(this)))));
    }

    // TODO: remove this (no replacement)
    pub inline fn fromRef(this: C_API.JSValueRef) JSValue {
        return @as(JSValue, @enumFromInt(@as(JSValueReprInt, @bitCast(@intFromPtr(this)))));
    }

    // TODO: remove this (no replacement)
    pub inline fn asObjectRef(this: JSValue) C_API.JSObjectRef {
        return @as(C_API.JSObjectRef, @ptrCast(this.asVoid()));
    }

    /// When the GC sees a JSValue referenced in the stack, it knows not to free it
    /// This mimics the implementation in JavaScriptCore's C++
    pub inline fn ensureStillAlive(this: JSValue) void {
        if (!this.isCell()) return;
        std.mem.doNotOptimizeAway(this.asEncoded().asPtr);
    }

    pub inline fn asNullableVoid(this: JSValue) ?*anyopaque {
        return @as(?*anyopaque, @ptrFromInt(@as(usize, @bitCast(@intFromEnum(this)))));
    }

    pub inline fn asVoid(this: JSValue) *anyopaque {
        if (comptime bun.Environment.allow_assert) {
            if (@intFromEnum(this) == 0) {
                @panic("JSValue is null");
            }
        }
        return this.asNullableVoid().?;
    }

    pub fn uncheckedPtrCast(value: JSValue, comptime T: type) *T {
        return @alignCast(@ptrCast(value.asEncoded().asPtr));
    }

    /// For any callback JSValue created in JS that you will not call *immediately*, you must wrap it
    /// in an AsyncContextFrame with this function. This allows AsyncLocalStorage to work by
    /// snapshotting it's state and restoring it when called.
    /// - If there is no current context, this returns the callback as-is.
    /// - It is safe to run .call() on the resulting JSValue. This includes automatic unwrapping.
    /// - Do not pass the callback as-is to JS; The wrapped object is NOT a function.
    /// - If passed to C++, call it with AsyncContextFrame::call() instead of JSC::call()
    pub inline fn withAsyncContextIfNeeded(this: JSValue, global: *JSGlobalObject) JSValue {
        JSC.markBinding(@src());
        return AsyncContextFrame__withAsyncContextIfNeeded(global, this);
    }

    pub fn isAsyncContextFrame(this: JSValue) bool {
        return Bun__JSValue__isAsyncContextFrame(this);
    }

    extern "c" fn Bun__JSValue__deserialize(global: *JSGlobalObject, data: [*]const u8, len: usize) JSValue;

    /// Deserializes a JSValue from a serialized buffer. Zig version of `import('bun:jsc').deserialize`
    pub inline fn deserialize(bytes: []const u8, global: *JSGlobalObject) JSValue {
        return Bun__JSValue__deserialize(global, bytes.ptr, bytes.len);
    }

    extern fn Bun__serializeJSValue(global: *JSC.JSGlobalObject, value: JSValue) SerializedScriptValue.External;
    extern fn Bun__SerializedScriptSlice__free(*anyopaque) void;

    pub const SerializedScriptValue = struct {
        data: []const u8,
        handle: *anyopaque,

        const External = extern struct {
            bytes: ?[*]const u8,
            size: usize,
            handle: ?*anyopaque,
        };

        pub inline fn deinit(self: @This()) void {
            Bun__SerializedScriptSlice__free(self.handle);
        }
    };

    /// Throws a JS exception and returns null if the serialization fails, otherwise returns a SerializedScriptValue.
    /// Must be freed when you are done with the bytes.
    pub inline fn serialize(this: JSValue, global: *JSGlobalObject) ?SerializedScriptValue {
        const value = Bun__serializeJSValue(global, this);
        return if (value.bytes) |bytes|
            .{ .data = bytes[0..value.size], .handle = value.handle.? }
        else
            null;
    }

    extern fn Bun__ProxyObject__getInternalField(this: JSValue, field: ProxyInternalField) JSValue;

    const ProxyInternalField = enum(u32) {
        target = 0,
        handler = 1,
    };

    /// Asserts `this` is a proxy
    pub fn getProxyInternalField(this: JSValue, field: ProxyInternalField) JSValue {
        return Bun__ProxyObject__getInternalField(this, field);
    }

    extern fn JSC__JSValue__getClassInfoName(value: JSValue, out: *[*:0]const u8, len: *usize) bool;

    /// For native C++ classes extending JSCell, this retrieves s_info's name
    /// This is a readonly ASCII string.
    pub fn getClassInfoName(this: JSValue) ?[:0]const u8 {
        if (!this.isCell()) return null;
        var out: [:0]const u8 = "";
        if (!JSC__JSValue__getClassInfoName(this, &out.ptr, &out.len)) return null;
        return out;
    }

    pub const exposed_to_ffi = struct {
        pub const JSVALUE_TO_INT64 = JSValue.JSC__JSValue__toInt64;
        pub const JSVALUE_TO_UINT64 = JSValue.JSC__JSValue__toUInt64NoTruncate;
        pub const INT64_TO_JSVALUE = JSValue.JSC__JSValue__fromInt64NoTruncate;
        pub const UINT64_TO_JSVALUE = JSValue.JSC__JSValue__fromUInt64NoTruncate;
    };
};

pub const JSValueReprInt = JSC.JSValueReprInt;

const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const C_API = bun.JSC.C;
const JSC = bun.JSC;

const MutableString = bun.MutableString;
const String = bun.String;
const strings = bun.strings;
const ErrorableString = JSC.ErrorableString;
const JSError = bun.JSError;
const napi = @import("../../napi/napi.zig");

const ZigString = JSC.ZigString;
const VM = JSC.VM;
const FFI = @import("./FFI.zig");
const JSPromise = JSC.JSPromise;
const JSGlobalObject = JSC.JSGlobalObject;
const JSString = JSC.JSString;
const JSObject = JSC.JSObject;
const JSMap = JSC.JSMap;
const JSArrayIterator = JSC.JSArrayIterator;
const JSFunction = JSC.JSFunction;
const JSCell = JSC.JSCell;
const Exports = @import("./exports.zig");
const JSNativeFn = JSC.JSNativeFn;

const AnyPromise = JSC.AnyPromise;
const DOMURL = JSC.DOMURL;
const JestPrettyFormat = @import("../test/pretty_format.zig").JestPrettyFormat;
const JSInternalPromise = JSC.JSInternalPromise;
const ZigException = JSC.ZigException;
const ArrayBuffer = JSC.ArrayBuffer;
const toJSHostFunction = JSC.toJSHostFunction;
const JSHostFunctionType = JSC.JSHostFunctionType;
extern "c" fn AsyncContextFrame__withAsyncContextIfNeeded(global: *JSGlobalObject, callback: JSValue) JSValue;
extern "c" fn Bun__JSValue__isAsyncContextFrame(value: JSValue) bool;
const FetchHeaders = JSC.FetchHeaders;
const Environment = bun.Environment;
