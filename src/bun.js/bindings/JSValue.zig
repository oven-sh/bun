/// ABI-compatible with EncodedJSValue
/// In the future, this type will exclude `zero`, encoding it as `error.JSError` instead.
pub const JSValue = enum(i64) {
    // fields here are prefixed so they're not accidentally mixed up with Zig's undefined/null/etc.
    js_undefined = 0xa,
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
    /// Deleted is a special encoding used in jsc hash map internals used for
    /// the null state. It is re-used here for encoding the "not present" state
    /// in `JSC__JSValue__getIfPropertyExistsImpl`
    property_does_not_exist_on_object = 0x4,
    _,

    pub const is_pointer = false;
    pub const JSType = @import("./JSType.zig").JSType;

    pub fn format(_: JSValue, _: *std.Io.Writer) !void {
        @compileError("Formatting a JSValue directly is not allowed. Use jsc.ConsoleObject.Formatter");
    }

    pub inline fn cast(ptr: anytype) JSValue {
        return @as(JSValue, @enumFromInt(@as(i64, @bitCast(@intFromPtr(ptr)))));
    }

    pub fn isBigIntInUInt64Range(this: JSValue, min: u64, max: u64) bool {
        return bun.cpp.JSC__isBigIntInUInt64Range(this, min, max);
    }

    pub fn isBigIntInInt64Range(this: JSValue, min: i64, max: i64) bool {
        return bun.cpp.JSC__isBigIntInInt64Range(this, min, max);
    }
    pub fn coerceToInt32(this: JSValue, globalThis: *jsc.JSGlobalObject) bun.JSError!i32 {
        return bun.cpp.JSC__JSValue__coerceToInt32(this, globalThis);
    }

    pub fn coerceToInt64(this: JSValue, globalThis: *jsc.JSGlobalObject) bun.JSError!i64 {
        return bun.cpp.JSC__JSValue__coerceToInt64(this, globalThis);
    }

    pub fn getIndex(this: JSValue, globalThis: *JSGlobalObject, i: u32) JSError!JSValue {
        return jsc.JSObject.getIndex(this, globalThis, i);
    }

    extern fn JSC__JSValue__isJSXElement(JSValue, *JSGlobalObject) bool;
    pub fn isJSXElement(this: JSValue, globalThis: *jsc.JSGlobalObject) JSError!bool {
        return bun.jsc.fromJSHostCallGeneric(
            globalThis,
            @src(),
            JSC__JSValue__isJSXElement,
            .{ this, globalThis },
        );
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
    ) callconv(.c) void;

    extern fn JSC__JSValue__forEachPropertyNonIndexed(JSValue0: JSValue, arg1: *JSGlobalObject, arg2: ?*anyopaque, ArgFn3: ?*const fn (*JSGlobalObject, ?*anyopaque, *ZigString, JSValue, bool, bool) callconv(.c) void) void;

    pub fn forEachPropertyNonIndexed(
        this: JSValue,
        globalThis: *jsc.JSGlobalObject,
        ctx: ?*anyopaque,
        callback: PropertyIteratorFn,
    ) JSError!void {
        return bun.jsc.fromJSHostCallGeneric(globalThis, @src(), JSC__JSValue__forEachPropertyNonIndexed, .{ this, globalThis, ctx, callback });
    }

    pub fn forEachProperty(
        this: JSValue,
        globalThis: *jsc.JSGlobalObject,
        ctx: ?*anyopaque,
        callback: PropertyIteratorFn,
    ) JSError!void {
        return bun.cpp.JSC__JSValue__forEachProperty(this, globalThis, ctx, callback);
    }

    pub fn forEachPropertyOrdered(
        this: JSValue,
        globalThis: *jsc.JSGlobalObject,
        ctx: ?*anyopaque,
        callback: PropertyIteratorFn,
    ) JSError!void {
        return bun.cpp.JSC__JSValue__forEachPropertyOrdered(this, globalThis, ctx, callback);
    }

    extern fn Bun__JSValue__toNumber(value: JSValue, global: *JSGlobalObject) f64;

    /// Perform the ToNumber abstract operation, coercing a value to a number.
    /// Equivalent to `+value`
    /// https://tc39.es/ecma262/#sec-tonumber
    pub fn toNumber(this: JSValue, global: *JSGlobalObject) bun.JSError!f64 {
        return bun.jsc.fromJSHostCallGeneric(global, @src(), Bun__JSValue__toNumber, .{ this, global });
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
        return @trunc(d) == d and @abs(d) <= jsc.MAX_SAFE_INTEGER;
    }

    pub fn coerce(this: JSValue, comptime T: type, globalThis: *jsc.JSGlobalObject) bun.JSError!T {
        return switch (T) {
            f64 => {
                if (this.isDouble()) {
                    return this.asDouble();
                }
                return this.toNumber(globalThis);
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
                return @bitCast(try this.coerceToInt32(globalThis));
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
            const double = try this.toNumber(global);
            if (std.math.isNan(double)) {
                return jsc.Error.SOCKET_BAD_PORT.throw(global, "Invalid port number", .{});
            }

            const port = this.to(i64);
            if (0 <= port and port <= 65535) {
                return @as(u16, @truncate(@max(0, port)));
            } else {
                return jsc.Error.SOCKET_BAD_PORT.throw(global, "Port number out of range: {d}", .{port});
            }
        }

        return jsc.Error.SOCKET_BAD_PORT.throw(global, "Invalid port number", .{});
    }

    extern fn JSC__JSValue__isInstanceOf(this: JSValue, global: *JSGlobalObject, constructor: JSValue) bool;
    pub fn isInstanceOf(this: JSValue, global: *JSGlobalObject, constructor: JSValue) bool {
        if (!this.isCell())
            return false;

        return JSC__JSValue__isInstanceOf(this, global, constructor);
    }

    pub fn callWithGlobalThis(this: JSValue, globalThis: *JSGlobalObject, args: []const jsc.JSValue) !jsc.JSValue {
        return this.call(globalThis, globalThis.toJSValue(), args);
    }

    extern "c" fn Bun__JSValue__call(
        ctx: *JSGlobalObject,
        object: JSValue,
        thisObject: JSValue,
        argumentCount: usize,
        arguments: [*]const JSValue,
    ) JSValue;

    pub fn call(function: JSValue, global: *JSGlobalObject, thisValue: jsc.JSValue, args: []const jsc.JSValue) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        if (comptime bun.Environment.isDebug) {
            const loop = jsc.VirtualMachine.get().eventLoop();
            loop.debug.js_call_count_outside_tick_queue += @as(usize, @intFromBool(!loop.debug.is_inside_tick_queue));
            if (loop.debug.track_last_fn_name and !loop.debug.is_inside_tick_queue) {
                loop.debug.last_fn_name.deref();
                loop.debug.last_fn_name = try function.getName(global);
            }
            // Do not assert that the function is callable here.
            // The Bun__JSValue__call function will already assert that, and
            // this can be an async context so it's fine if it's not callable.
        }

        return fromJSHostCall(global, @src(), Bun__JSValue__call, .{
            global,
            function,
            thisValue,
            args.len,
            args.ptr,
        });
    }

    extern fn Bun__Process__queueNextTick1(*JSGlobalObject, func: JSValue, JSValue) void;
    extern fn Bun__Process__queueNextTick2(*JSGlobalObject, func: JSValue, JSValue, JSValue) void;

    pub inline fn callNextTick(function: JSValue, global: *JSGlobalObject, args: anytype) bun.JSError!void {
        return switch (comptime bun.len(@as(@TypeOf(args), undefined))) {
            1 => bun.jsc.fromJSHostCallGeneric(global, @src(), Bun__Process__queueNextTick1, .{ global, function, args[0] }),
            2 => bun.jsc.fromJSHostCallGeneric(global, @src(), Bun__Process__queueNextTick2, .{ global, function, args[0], args[1] }),
            else => @compileError("needs more copy paste"),
        };
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

    extern fn JSC__jsTypeStringForValue(globalObject: *JSGlobalObject, value: JSValue) *jsc.JSString;

    pub fn jsTypeString(this: JSValue, globalObject: *JSGlobalObject) *jsc.JSString {
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
    pub fn createEmptyArray(global: *JSGlobalObject, len: usize) bun.JSError!JSValue {
        return fromJSHostCall(global, @src(), JSC__JSValue__createEmptyArray, .{ global, len });
    }

    extern fn JSC__JSValue__putRecord(value: JSValue, global: *JSGlobalObject, key: *ZigString, values_array: [*]ZigString, values_len: usize) void;
    pub fn putRecord(value: JSValue, global: *JSGlobalObject, key: *ZigString, values_array: [*]ZigString, values_len: usize) void {
        return JSC__JSValue__putRecord(value, global, key, values_array, values_len);
    }
    extern fn JSC__JSValue__put(value: JSValue, global: *JSGlobalObject, key: *const ZigString, result: jsc.JSValue) void;
    pub fn putZigString(value: JSValue, global: *JSGlobalObject, key: *const ZigString, result: jsc.JSValue) void {
        JSC__JSValue__put(value, global, key, result);
    }

    extern fn JSC__JSValue__deleteProperty(target: JSValue, global: *JSGlobalObject, key: *const ZigString) bool;
    /// Delete a property from an object by key. Returns true if the property was deleted.
    pub fn deleteProperty(target: JSValue, global: *JSGlobalObject, key: anytype) bool {
        const Key = @TypeOf(key);
        if (comptime @typeInfo(Key) == .pointer) {
            const Elem = @typeInfo(Key).pointer.child;
            if (Elem == ZigString) {
                return JSC__JSValue__deleteProperty(target, global, key);
            } else if (std.meta.Elem(Key) == u8) {
                return JSC__JSValue__deleteProperty(target, global, &ZigString.init(key));
            } else {
                @compileError("Unsupported key type in deleteProperty(). Expected ZigString or string literal, got " ++ @typeName(Elem));
            }
        } else if (comptime Key == ZigString) {
            return JSC__JSValue__deleteProperty(target, global, &key);
        } else {
            @compileError("Unsupported key type in deleteProperty(). Expected ZigString or string literal, got " ++ @typeName(Key));
        }
    }

    extern "c" fn JSC__JSValue__putBunString(value: JSValue, global: *JSGlobalObject, key: *const bun.String, result: jsc.JSValue) void;
    fn putBunString(value: JSValue, global: *JSGlobalObject, key: *const bun.String, result: jsc.JSValue) void {
        if (comptime bun.Environment.isDebug)
            jsc.markBinding(@src());
        JSC__JSValue__putBunString(value, global, key, result);
    }

    extern "c" fn JSC__JSValue__upsertBunStringArray(value: JSValue, global: *JSGlobalObject, key: *const bun.String, result: jsc.JSValue) JSValue;

    /// Put key/val pair into `obj`. If `key` is already present on the object, create an array for the values.
    pub fn putBunStringOneOrArray(obj: JSValue, global: *JSGlobalObject, key: *const bun.String, value: jsc.JSValue) bun.JSError!JSValue {
        return fromJSHostCall(global, @src(), JSC__JSValue__upsertBunStringArray, .{ obj, global, key, value });
    }

    pub fn put(value: JSValue, global: *JSGlobalObject, key: anytype, result: jsc.JSValue) void {
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
    /// Note: key can't be numeric (if so, use putMayBeIndex instead)
    /// Same as `.put` but accepts both non-numeric and numeric keys.
    /// Prefer to use `.put` if the key is guaranteed to be non-numeric (e.g. known at comptime)
    pub fn putMayBeIndex(this: JSValue, globalObject: *JSGlobalObject, key: *const String, value: JSValue) bun.JSError!void {
        return bun.cpp.JSC__JSValue__putMayBeIndex(this, globalObject, key, value);
    }

    extern fn JSC__JSValue__putToPropertyKey(target: JSValue, globalObject: *JSGlobalObject, key: jsc.JSValue, value: jsc.JSValue) void;
    pub fn putToPropertyKey(target: JSValue, globalObject: *JSGlobalObject, key: jsc.JSValue, value: jsc.JSValue) bun.JSError!void {
        return bun.jsc.host_fn.fromJSHostCallGeneric(globalObject, @src(), JSC__JSValue__putToPropertyKey, .{ target, globalObject, key, value });
    }

    extern fn JSC__JSValue__putIndex(value: JSValue, globalObject: *JSGlobalObject, i: u32, out: JSValue) void;
    pub fn putIndex(value: JSValue, globalObject: *JSGlobalObject, i: u32, out: JSValue) bun.JSError!void {
        return bun.jsc.fromJSHostCallGeneric(globalObject, @src(), JSC__JSValue__putIndex, .{ value, globalObject, i, out });
    }

    extern fn JSC__JSValue__push(value: JSValue, globalObject: *JSGlobalObject, out: JSValue) void;
    pub fn push(value: JSValue, globalObject: *JSGlobalObject, out: JSValue) bun.JSError!void {
        return bun.jsc.fromJSHostCallGeneric(globalObject, @src(), JSC__JSValue__push, .{ value, globalObject, out });
    }

    extern fn JSC__JSValue__toISOString(*jsc.JSGlobalObject, jsc.JSValue, *[28]u8) c_int;
    pub fn toISOString(this: JSValue, globalObject: *jsc.JSGlobalObject, buf: *[28]u8) []const u8 {
        const count = JSC__JSValue__toISOString(globalObject, this, buf);
        if (count < 0) {
            return "";
        }

        return buf[0..@as(usize, @intCast(count))];
    }
    extern fn JSC__JSValue__DateNowISOString(*JSGlobalObject, f64) JSValue;
    pub fn getDateNowISOString(globalObject: *jsc.JSGlobalObject, buf: *[28]u8) []const u8 {
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

        if (comptime ZigType == jsc.WebCore.Body.Value) {
            if (value.as(jsc.WebCore.Request)) |req| {
                return req.getBodyValue();
            }

            if (value.as(jsc.WebCore.Response)) |res| {
                return res.getBodyValue();
            }

            return null;
        }

        if (comptime @hasDecl(ZigType, "fromJS") and @TypeOf(ZigType.fromJS) == fn (jsc.JSValue) ?*ZigType) {
            if (comptime ZigType == jsc.WebCore.Blob) {
                if (ZigType.fromJS(value)) |blob| {
                    return blob;
                }

                if (jsc.API.BuildArtifact.fromJS(value)) |build| {
                    return &build.blob;
                }

                return null;
            }

            return ZigType.fromJS(value);
        }
    }

    extern fn JSC__JSValue__dateInstanceFromNullTerminatedString(*JSGlobalObject, [*:0]const u8) JSValue;
    pub fn fromDateString(globalObject: *JSGlobalObject, str: [*:0]const u8) JSValue {
        jsc.markBinding(@src());
        return JSC__JSValue__dateInstanceFromNullTerminatedString(globalObject, str);
    }

    extern fn JSC__JSValue__dateInstanceFromNumber(*JSGlobalObject, f64) JSValue;

    pub fn fromDateNumber(globalObject: *JSGlobalObject, value: f64) JSValue {
        jsc.markBinding(@src());
        return JSC__JSValue__dateInstanceFromNumber(globalObject, value);
    }

    extern fn JSBuffer__isBuffer(*JSGlobalObject, JSValue) bool;
    pub fn isBuffer(value: JSValue, global: *JSGlobalObject) bool {
        jsc.markBinding(@src());
        return JSBuffer__isBuffer(global, value);
    }

    pub fn isRegExp(this: JSValue) bool {
        return this.jsType() == .RegExpObject;
    }

    pub fn isDate(this: JSValue) bool {
        return this.jsType() == .JSDate;
    }

    extern "c" fn Bun__JSValue__protect(value: JSValue) void;
    extern "c" fn Bun__JSValue__unprotect(value: JSValue) void;

    /// Protects a JSValue from garbage collection by storing it in a hash table that is strongly referenced and incrementing a reference count.
    ///
    /// This is useful when you want to store a JSValue in a global or on the
    /// heap, where the garbage collector will not be able to discover your
    /// reference to it.
    ///
    /// A value may be protected multiple times and must be unprotected an
    /// equal number of times before becoming eligible for garbage collection.
    ///
    /// Note: The isCell check is not done here because it's done in the
    /// bindings.cpp file.
    pub fn protect(this: JSValue) void {
        Bun__JSValue__protect(this);
    }

    /// Unprotects a JSValue from garbage collection by removing it from the hash table and decrementing a reference count.
    ///
    /// A value may be protected multiple times and must be unprotected an
    /// equal number of times before becoming eligible for garbage collection.
    ///
    /// This is the inverse of `protect`.
    ///
    /// Note: The isCell check is not done here because it's done in the
    /// bindings.cpp file.
    pub fn unprotect(this: JSValue) void {
        Bun__JSValue__unprotect(this);
    }

    extern fn JSC__JSValue__createObject2(global: *JSGlobalObject, key1: *const ZigString, key2: *const ZigString, value1: JSValue, value2: JSValue) JSValue;
    /// Create an object with exactly two properties
    pub fn createObject2(global: *JSGlobalObject, key1: *const ZigString, key2: *const ZigString, value1: JSValue, value2: JSValue) bun.JSError!JSValue {
        return bun.jsc.fromJSHostCall(global, @src(), JSC__JSValue__createObject2, .{ global, key1, key2, value1, value2 });
    }

    /// this must have been created by fromPtrAddress()
    pub fn asPromisePtr(this: JSValue, comptime T: type) *T {
        return @ptrFromInt(this.asPtrAddress());
    }

    extern fn JSC__JSValue__createRopeString(this: JSValue, rhs: JSValue, globalThis: *jsc.JSGlobalObject) JSValue;
    pub fn createRopeString(this: JSValue, rhs: JSValue, globalThis: *jsc.JSGlobalObject) JSValue {
        return JSC__JSValue__createRopeString(this, rhs, globalThis);
    }

    extern fn JSC__JSValue__getErrorsProperty(this: JSValue, globalObject: *JSGlobalObject) JSValue;
    pub fn getErrorsProperty(this: JSValue, globalObject: *JSGlobalObject) JSValue {
        return JSC__JSValue__getErrorsProperty(this, globalObject);
    }

    pub fn createBufferFromLength(globalObject: *JSGlobalObject, len: usize) bun.JSError!JSValue {
        jsc.markBinding(@src());
        return bun.jsc.fromJSHostCall(globalObject, @src(), JSBuffer__bufferFromLength, .{ globalObject, @intCast(len) });
    }

    pub fn jestSnapshotPrettyFormat(this: JSValue, out: *std.Io.Writer, globalObject: *JSGlobalObject) !void {
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
            out,
            fmt_options,
        );

        try out.flush();
    }

    extern fn JSBuffer__bufferFromLength(*JSGlobalObject, i64) JSValue;

    /// Must come from globally-allocated memory if allocator is not null
    pub fn createBuffer(globalObject: *JSGlobalObject, slice: []u8) JSValue {
        jsc.markBinding(@src());
        @setRuntimeSafety(false);
        return JSBuffer__bufferFromPointerAndLengthAndDeinit(globalObject, slice.ptr, slice.len, null, jsc.array_buffer.MarkedArrayBuffer_deallocator);
    }

    extern fn JSC__JSValue__createUninitializedUint8Array(globalObject: *JSGlobalObject, len: usize) JSValue;
    pub fn createUninitializedUint8Array(globalObject: *JSGlobalObject, len: usize) bun.JSError!JSValue {
        jsc.markBinding(@src());
        return bun.jsc.fromJSHostCall(globalObject, @src(), JSC__JSValue__createUninitializedUint8Array, .{ globalObject, len });
    }

    pub fn createBufferWithCtx(globalObject: *JSGlobalObject, slice: []u8, ptr: ?*anyopaque, func: jsc.C.JSTypedArrayBytesDeallocator) JSValue {
        jsc.markBinding(@src());
        @setRuntimeSafety(false);
        return JSBuffer__bufferFromPointerAndLengthAndDeinit(globalObject, slice.ptr, slice.len, ptr, func);
    }

    extern fn JSBuffer__bufferFromPointerAndLengthAndDeinit(*JSGlobalObject, [*]u8, usize, ?*anyopaque, jsc.C.JSTypedArrayBytesDeallocator) JSValue;

    pub fn jsNumberWithType(comptime Number: type, number: Number) JSValue {
        if (@typeInfo(Number) == .@"enum") {
            return jsNumberWithType(@typeInfo(Number).@"enum".tag_type, @intFromEnum(number));
        }
        return switch (comptime Number) {
            JSValue => number,
            u0 => jsNumberFromInt32(0),
            f32, f64 => {
                if (canBeStrictInt32(number)) {
                    return jsNumberFromInt32(@intFromFloat(number));
                }
                return jsDoubleNumber(number);
            },
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

    pub inline fn jsBoolean(i: bool) JSValue {
        return switch (i) {
            false => .false,
            true => .true,
        };
    }

    pub inline fn jsEmptyString(globalThis: *JSGlobalObject) JSValue {
        return bun.cpp.JSC__JSValue__jsEmptyString(globalThis);
    }

    pub inline fn jsNull() JSValue {
        return JSValue.null;
    }

    pub fn jsNumber(number: anytype) JSValue {
        return jsNumberWithType(@TypeOf(number), number);
    }

    pub fn jsBigInt(number: anytype) JSValue {
        const Number = @TypeOf(number);
        return switch (comptime Number) {
            u64 => JSValue.fromUInt64NoTruncate(number),
            i64 => JSValue.fromInt64NoTruncate(number),
            i32 => JSValue.fromInt64NoTruncate(number),
            u32 => JSValue.fromUInt64NoTruncate(number),
            else => @compileError("Expected u64, i64, u32 or i32, got " ++ @typeName(Number)),
        };
    }

    pub inline fn jsTDZValue() JSValue {
        return bun.cpp.JSC__JSValue__jsTDZValue();
    }

    pub fn className(this: JSValue, globalThis: *JSGlobalObject) bun.JSError!ZigString {
        var str = ZigString.init("");
        try this.getClassName(globalThis, &str);
        return str;
    }

    pub fn print(
        this: JSValue,
        globalObject: *JSGlobalObject,
        message_type: jsc.ConsoleObject.MessageType,
        message_level: jsc.ConsoleObject.MessageLevel,
    ) void {
        jsc.ConsoleObject.messageWithTypeAndLevel(
            undefined,
            message_type,
            message_level,
            globalObject,
            &[_]jsc.JSValue{this},
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
        switch (Output.enable_ansi_colors_stderr) {
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
    pub fn keys(value: JSValue, globalThis: *JSGlobalObject) JSError!JSValue {
        return fromJSHostCall(globalThis, @src(), JSC__JSValue__keys, .{
            globalThis,
            value,
        });
    }

    extern fn JSC__JSValue__values(globalThis: *JSGlobalObject, value: JSValue) JSValue;
    /// This is `Object.values`.
    /// `value` is assumed to be not empty, undefined, or null.
    pub fn values(value: JSValue, globalThis: *JSGlobalObject) JSError!JSValue {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(!value.isEmptyOrUndefinedOrNull());
        }
        return fromJSHostCall(globalThis, @src(), JSC__JSValue__values, .{
            globalThis,
            value,
        });
    }

    extern "c" fn JSC__JSValue__hasOwnPropertyValue(JSValue, *JSGlobalObject, JSValue) bool;
    /// Calls `Object.hasOwnProperty(value)`.
    /// Returns true if the object has the property, false otherwise
    ///
    /// If the object is not an object, it will crash. **You must check if the object is an object before calling this function.**
    pub fn hasOwnPropertyValue(this: JSValue, global: *JSGlobalObject, key: JSValue) JSError!bool {
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__hasOwnPropertyValue, .{ this, global, key });
    }

    pub inline fn arrayIterator(this: JSValue, global: *JSGlobalObject) JSError!JSArrayIterator {
        return JSArrayIterator.init(this, global);
    }

    pub fn jsDoubleNumber(i: f64) JSValue {
        return FFI.DOUBLE_TO_JSVALUE(i).asJSValue;
    }
    pub fn jsNumberFromChar(i: u8) JSValue {
        return bun.cpp.JSC__JSValue__jsNumberFromChar(i);
    }
    pub fn jsNumberFromU16(i: u16) JSValue {
        return bun.cpp.JSC__JSValue__jsNumberFromU16(i);
    }
    pub fn jsNumberFromInt32(i: i32) JSValue {
        return FFI.INT32_TO_JSVALUE(i).asJSValue;
    }

    pub fn jsNumberFromInt64(i: i64) JSValue {
        if (i <= std.math.maxInt(i32) and i >= std.math.minInt(i32)) {
            return jsNumberFromInt32(@as(i32, @intCast(i)));
        }

        return jsDoubleNumber(@floatFromInt(i));
    }

    pub fn jsNumberFromUint64(i: u64) JSValue {
        if (i <= std.math.maxInt(i32)) {
            return jsNumberFromInt32(@as(i32, @intCast(i)));
        }

        return jsDoubleNumber(@floatFromInt(i));
    }

    // https://github.com/oven-sh/WebKit/blob/df8aa4c4d01a1c2fe22ac599adfe0a582fce2b20/Source/JavaScriptCore/runtime/MathCommon.h#L243-L249
    pub fn canBeStrictInt32(value: f64) bool {
        if (std.math.isInf(value) or std.math.isNan(value)) {
            return false;
        }
        const int: i32 = int: {
            @setRuntimeSafety(false);
            break :int @intFromFloat(value);
        };
        return !(@as(f64, @floatFromInt(int)) != value or (int == 0 and std.math.signbit(value))); // true for -0.0
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

        if (num >= @as(f64, @as(comptime_float, std.math.maxInt(T))) or std.math.isPositiveInf(num)) {
            return std.math.maxInt(T);
        }

        return @intFromFloat(num);
    }

    pub fn coerceDoubleTruncatingIntoInt64(this: JSValue) i64 {
        return coerceJSValueDoubleTruncatingT(i64, this.asNumber());
    }

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

        return bun.cpp.JSC__JSValue__toInt64(this);
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
        return @intFromEnum(this) == 0xa;
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
    pub fn isAnyInt(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isAnyInt(this);
    }
    pub fn isUInt32AsAnyInt(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isUInt32AsAnyInt(this);
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

    pub fn isInt32AsAnyInt(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isInt32AsAnyInt(this);
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

    pub fn isBigInt(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isBigInt(this);
    }
    pub fn isHeapBigInt(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isHeapBigInt(this);
    }
    pub fn isBigInt32(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isBigInt32(this);
    }
    pub fn isSymbol(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isSymbol(this);
    }
    pub fn isPrimitive(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isPrimitive(this);
    }
    pub fn isGetterSetter(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isGetterSetter(this);
    }
    pub fn isCustomGetterSetter(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isCustomGetterSetter(this);
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
    pub fn isObjectEmpty(this: JSValue, globalObject: *JSGlobalObject) JSError!bool {
        const type_of_value = this.jsType();
        // https://github.com/jestjs/jest/blob/main/packages/jest-get-type/src/index.ts#L26
        // Map and Set are not considered as object in jest-extended
        if (type_of_value.isMap() or type_of_value.isSet() or this.isRegExp() or this.isDate()) {
            return false;
        }

        return this.jsType().isObject() and try (try this.keys(globalObject)).getLength(globalObject) == 0;
    }

    extern fn JSC__JSValue__isClass(this: JSValue, global: *JSGlobalObject) bool;
    pub fn isClass(this: JSValue, global: *JSGlobalObject) bool {
        return JSC__JSValue__isClass(this, global);
    }

    pub fn isConstructor(this: JSValue) bool {
        if (!this.isCell()) return false;
        return bun.cpp.JSC__JSValue__isConstructor(this);
    }

    extern fn JSC__JSValue__getNameProperty(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void;
    pub fn getNameProperty(this: JSValue, global: *JSGlobalObject, ret: *ZigString) bun.JSError!void {
        if (this.isEmptyOrUndefinedOrNull()) {
            return;
        }

        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__getNameProperty, .{ this, global, ret });
    }

    extern fn JSC__JSValue__getName(jsc.JSValue, *jsc.JSGlobalObject, *bun.String) void;
    pub fn getName(this: JSValue, global: *JSGlobalObject) JSError!bun.String {
        var ret = bun.String.empty;
        try bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__getName, .{ this, global, &ret });
        return ret;
    }

    extern fn JSC__JSValue__getClassName(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void;
    // TODO: absorb this into className()
    pub fn getClassName(this: JSValue, global: *JSGlobalObject, ret: *ZigString) bun.JSError!void {
        if (!this.isCell()) {
            ret.* = ZigString.static("[not a class]").*;
            return;
        }
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__getClassName, .{ this, global, ret });
    }

    pub inline fn isCell(this: JSValue) bool {
        return switch (this) {
            .zero, .js_undefined, .null, .true, .false => false,
            else => (@as(u64, @bitCast(@intFromEnum(this))) & FFI.NotCellMask) == 0,
        };
    }

    pub fn asCell(this: JSValue) *JSCell {
        // Asserting this lets Zig possibly optimize out other checks.
        bun.unsafeAssert(this.isCell());
        // We know `DecodedJSValue.asCell` cannot return null, since `isCell` already checked for
        // `.zero`.
        return this.decode().asCell().?;
    }

    pub fn isCallable(this: JSValue) bool {
        return bun.cpp.JSC__JSValue__isCallable(this);
    }

    /// Statically cast a value to a cell. Returns `null` for non-cells.
    pub fn toCell(this: JSValue) ?*JSCell {
        return if (this.isCell()) this.asCell() else null;
    }

    extern fn JSC__JSValue__isException(this: JSValue, vm: *VM) bool;
    pub fn isException(this: JSValue, vm: *VM) bool {
        return JSC__JSValue__isException(this, vm);
    }

    /// Cast to an Exception pointer, or null if not an Exception
    pub fn asException(this: JSValue, vm: *VM) ?*jsc.Exception {
        return if (this.isException(vm))
            this.uncheckedPtrCast(jsc.Exception)
        else
            null;
    }

    extern fn JSC__JSValue__isTerminationException(this: JSValue) bool;
    pub fn isTerminationException(this: JSValue) bool {
        return JSC__JSValue__isTerminationException(this);
    }

    pub fn toZigException(this: JSValue, global: *JSGlobalObject, exception: *ZigException) void {
        return bun.cpp.JSC__JSValue__toZigException(this, global, exception) catch return; // TODO: properly propagate termination
    }

    extern fn JSC__JSValue__toZigString(this: JSValue, out: *ZigString, global: *JSGlobalObject) void;
    pub fn toZigString(this: JSValue, out: *ZigString, global: *JSGlobalObject) JSError!void {
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__toZigString, .{ this, out, global });
    }

    /// Increments the reference count, you must call `.deref()` or it will leak memory.
    pub fn toBunString(this: JSValue, globalObject: *jsc.JSGlobalObject) JSError!bun.String {
        return bun.String.fromJS(this, globalObject);
    }

    /// this: RegExp value
    /// other: string value
    pub fn toMatch(this: JSValue, global: *JSGlobalObject, other: JSValue) !bool {
        return bun.cpp.JSC__JSValue__toMatch(this, global, other);
    }

    extern fn JSC__JSValue__asArrayBuffer(this: JSValue, global: *JSGlobalObject, out: *ArrayBuffer) bool;

    pub fn asArrayBuffer(this: JSValue, global: *JSGlobalObject) ?ArrayBuffer {
        var out: ArrayBuffer = undefined;
        if (JSC__JSValue__asArrayBuffer(this, global, &out)) {
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
    pub fn fromTimevalNoTruncate(globalObject: *JSGlobalObject, nsec: i64, sec: i64) bun.JSError!JSValue {
        return bun.jsc.fromJSHostCall(globalObject, @src(), JSC__JSValue__fromTimevalNoTruncate, .{ globalObject, nsec, sec });
    }
    extern fn JSC__JSValue__bigIntSum(globalObject: *JSGlobalObject, a: JSValue, b: JSValue) JSValue;
    /// Sums two JS BigInts
    pub fn bigIntSum(globalObject: *JSGlobalObject, a: JSValue, b: JSValue) JSValue {
        return JSC__JSValue__bigIntSum(globalObject, a, b);
    }

    /// Value must be either `isHeapBigInt` or `isNumber`
    pub fn toUInt64NoTruncate(this: JSValue) u64 {
        return JSC__JSValue__toUInt64NoTruncate(this);
    }
    extern fn JSC__JSValue__toUInt64NoTruncate(this: JSValue) u64;

    /// Deprecated: replace with 'toBunString'
    pub fn getZigString(this: JSValue, global: *JSGlobalObject) bun.JSError!ZigString {
        var str = ZigString.init("");
        try this.toZigString(&str, global);
        return str;
    }

    /// Convert a JSValue to a string, potentially calling `toString` on the
    /// JSValue in JavaScript. Can throw an error.
    ///
    /// This keeps the WTF::StringImpl alive if it was originally a latin1
    /// ASCII-only string.
    ///
    /// Otherwise, it will be cloned using the allocator.
    pub fn toSlice(this: JSValue, global: *JSGlobalObject, allocator: std.mem.Allocator) JSError!ZigString.Slice {
        const str = try bun.String.fromJS(this, global);
        defer str.deref();
        return str.toUTF8(allocator);
    }

    pub inline fn toSliceZ(this: JSValue, global: *JSGlobalObject, allocator: std.mem.Allocator) ZigString.Slice {
        return getZigString(this, global).toSliceZ(allocator);
    }

    /// The returned slice is always owned by `allocator`.
    pub fn toUTF8Bytes(this: JSValue, global: *JSGlobalObject, allocator: std.mem.Allocator) JSError![]u8 {
        const str: bun.String = try .fromJS(this, global);
        defer str.deref();
        return str.toUTF8Bytes(allocator);
    }

    pub fn toJSString(this: JSValue, globalThis: *JSGlobalObject) bun.JSError!*JSString {
        return bun.cpp.JSC__JSValue__toStringOrNull(this, globalThis);
    }

    extern fn JSC__JSValue__jsonStringify(this: JSValue, globalThis: *JSGlobalObject, indent: u32, out: *bun.String) void;
    pub fn jsonStringify(this: JSValue, globalThis: *JSGlobalObject, indent: u32, out: *bun.String) bun.JSError!void {
        return bun.jsc.fromJSHostCallGeneric(globalThis, @src(), JSC__JSValue__jsonStringify, .{ this, globalThis, indent, out });
    }

    extern fn JSC__JSValue__jsonStringifyFast(this: JSValue, globalThis: *JSGlobalObject, out: *bun.String) void;

    /// Fast version of JSON.stringify that uses JSC's FastStringifier optimization.
    /// When space is undefined (as opposed to 0), JSC uses a highly optimized SIMD-based
    /// serialization path. This is significantly faster for most common use cases.
    pub fn jsonStringifyFast(this: JSValue, globalThis: *JSGlobalObject, out: *bun.String) bun.JSError!void {
        return bun.jsc.fromJSHostCallGeneric(globalThis, @src(), JSC__JSValue__jsonStringifyFast, .{ this, globalThis, out });
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
    pub fn toSliceClone(this: JSValue, globalThis: *JSGlobalObject) bun.JSError!ZigString.Slice {
        return this.toSliceCloneWithAllocator(globalThis, bun.default_allocator);
    }

    /// On exception or out of memory, this returns null, to make exception checks clearer.
    pub fn toSliceCloneWithAllocator(
        this: JSValue,
        globalThis: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) JSError!ZigString.Slice {
        var str = try this.toJSString(globalThis);
        return str.toSliceClone(globalThis, allocator);
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

    /// Unwraps Number, Boolean, String, and BigInt objects to their primitive forms.
    pub fn unwrapBoxedPrimitive(this: JSValue, global: *JSGlobalObject) JSError!JSValue {
        var scope: TopExceptionScope = undefined;
        scope.init(global, @src());
        defer scope.deinit();
        const result = JSC__JSValue__unwrapBoxedPrimitive(global, this);
        try scope.returnIfException();
        return result;
    }
    extern fn JSC__JSValue__unwrapBoxedPrimitive(*JSGlobalObject, JSValue) JSValue;

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

    /// This must match the enum in C++ in src/bun.js/bindings/bindings.cpp BuiltinNamesMap
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
        cmd,

        pub fn has(property: []const u8) bool {
            return bun.ComptimeEnumMap(BuiltinName).has(property);
        }

        pub fn get(property: []const u8) ?BuiltinName {
            return bun.ComptimeEnumMap(BuiltinName).get(property);
        }
    };

    pub fn fastGetOrElse(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName, alternate: ?jsc.JSValue) ?JSValue {
        return (try this.fastGet(global, builtin_name)) orelse {
            if (alternate) |alt| return alt.fastGet(global, builtin_name);

            return null;
        };
    }

    // `this` must be known to be an object
    // intended to be more lightweight than ZigString.
    pub fn fastGet(this: JSValue, global: *JSGlobalObject, builtin_name: BuiltinName) JSError!?JSValue {
        if (bun.Environment.isDebug)
            bun.assert(this.isObject());

        return switch (try fromJSHostCall(
            global,
            @src(),
            JSC__JSValue__fastGet,
            .{ this, global, @intFromEnum(builtin_name) },
        )) {
            .zero => unreachable, // handled by fromJSHostCall
            .js_undefined, .property_does_not_exist_on_object => null,
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
    extern fn JSC__JSValue__getPropertyValue(target: JSValue, global: *JSGlobalObject, ptr: [*]const u8, len: u32) JSValue;
    extern fn JSC__JSValue__getIfPropertyExistsFromPath(this: JSValue, global: *JSGlobalObject, path: JSValue) JSValue;
    pub fn getIfPropertyExistsFromPath(this: JSValue, global: *JSGlobalObject, path: JSValue) JSError!JSValue {
        var scope: TopExceptionScope = undefined;
        scope.init(global, @src());
        defer scope.deinit();
        const result = JSC__JSValue__getIfPropertyExistsFromPath(this, global, path);
        try scope.returnIfException();
        return result;
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

    extern fn JSC__JSValue___then(this: JSValue, global: *JSGlobalObject, ctx: JSValue, resolve: *const jsc.JSHostFn, reject: *const jsc.JSHostFn) void;
    fn _then(this: JSValue, global: *JSGlobalObject, ctx: JSValue, resolve: jsc.JSHostFnZig, reject: jsc.JSHostFnZig) void {
        return JSC__JSValue___then(this, global, ctx, toJSHostFunction(resolve), toJSHostFunction(reject));
    }

    pub fn then2(this: JSValue, global: *JSGlobalObject, ctx: JSValue, resolve: *const jsc.JSHostFn, reject: *const jsc.JSHostFn) bun.JSTerminated!void {
        var scope: TopExceptionScope = undefined;
        scope.init(global, @src());
        defer scope.deinit();
        JSC__JSValue___then(this, global, ctx, resolve, reject);
        try scope.assertNoExceptionExceptTermination();
    }

    pub fn then(this: JSValue, global: *JSGlobalObject, ctx: ?*anyopaque, resolve: jsc.JSHostFnZig, reject: jsc.JSHostFnZig) bun.JSTerminated!void {
        var scope: TopExceptionScope = undefined;
        scope.init(global, @src());
        defer scope.deinit();
        this._then(global, JSValue.fromPtrAddress(@intFromPtr(ctx)), resolve, reject);
        try scope.assertNoExceptionExceptTermination();
    }

    pub fn getDescription(this: JSValue, global: *JSGlobalObject) ZigString {
        var zig_str = ZigString.init("");
        getSymbolDescription(this, global, &zig_str);
        return zig_str;
    }

    /// Equivalent to `target[property]`. Calls userland getters/proxies.  Can
    /// throw. Null indicates the property does not exist. JavaScript undefined
    /// and JavaScript null can exist as a property and is different than zig
    /// `null` (property does not exist), however javascript undefined will return
    /// zig null.
    ///
    /// `property` must be `[]const u8`. A comptime slice may defer to
    /// calling `fastGet`, which use a more optimal code path. This function is
    /// marked `inline` to allow Zig to determine if `fastGet` should be used
    /// per invocation.
    ///
    /// Cannot handle property names that are numeric indexes. (For this use `getPropertyValue` instead.)
    ///
    pub inline fn get(target: JSValue, global: *JSGlobalObject, property_slice: []const u8) JSError!?JSValue {
        bun.debugAssert(target.isObject());

        // This call requires `get` to be `inline`
        if (bun.isComptimeKnown(property_slice)) {
            if (comptime BuiltinName.get(property_slice)) |builtin_name| {
                return target.fastGet(global, builtin_name);
            }
        }

        return switch (try bun.cpp.JSC__JSValue__getIfPropertyExistsImpl(target, global, property_slice.ptr, property_slice.len)) {
            .zero => unreachable, // handled by fromJSHostCall
            .property_does_not_exist_on_object => null,

            // TODO: see bug described in ObjectBindings.cpp
            // since there are false positives, the better path is to make them
            // negatives, as the number of places that desire throwing on
            // existing undefined is extremely small, but non-zero.
            .js_undefined => null,
            else => |val| val,
        };
    }

    /// Equivalent to `target[property]`. Calls userland getters/proxies.  Can
    /// throw. Null indicates the property does not exist. JavaScript undefined
    /// and JavaScript null can exist as a property and is different than zig
    /// `null` (property does not exist).
    ///
    /// Can handle numeric index property names.
    ///
    /// If you know that the property name is not an integer index, use `get` instead.
    ///
    pub fn getPropertyValue(target: JSValue, global: *JSGlobalObject, property_name: []const u8) bun.JSError!?JSValue {
        if (bun.Environment.isDebug) bun.assert(target.isObject());

        return switch (try bun.jsc.fromJSHostCall(global, @src(), JSC__JSValue__getPropertyValue, .{ target, global, property_name.ptr, @intCast(property_name.len) })) {
            .property_does_not_exist_on_object => null,
            .js_undefined => null,
            else => |val| val,
        };
    }

    extern fn JSC__JSValue__getOwn(value: JSValue, globalObject: *JSGlobalObject, propertyName: *const bun.String) JSValue;

    /// Get *own* property value (i.e. does not resolve property in the prototype chain)
    pub fn getOwn(this: JSValue, global: *JSGlobalObject, property_name: anytype) bun.JSError!?JSValue {
        var property_name_str = bun.String.init(property_name);
        var scope: TopExceptionScope = undefined;
        scope.init(global, @src());
        defer scope.deinit();
        const value = JSC__JSValue__getOwn(this, global, &property_name_str);
        try scope.returnIfException();
        return if (value == .zero)
            null
        else
            value;
    }

    extern fn JSC__JSValue__getOwnByValue(value: JSValue, globalObject: *JSGlobalObject, propertyValue: JSValue) JSValue;

    pub fn getOwnByValue(this: JSValue, global: *JSGlobalObject, property_value: JSValue) ?JSValue {
        const value = JSC__JSValue__getOwnByValue(this, global, property_value);
        return if (@intFromEnum(value) != 0) value else return null;
    }

    pub fn getOwnTruthy(this: JSValue, global: *JSGlobalObject, property_name: anytype) bun.JSError!?JSValue {
        if (try getOwn(this, global, property_name)) |prop| {
            if (prop.isUndefined()) return null;
            return prop;
        }

        return null;
    }

    /// Safe to use on any JSValue, can error.
    pub fn implementsToString(this: JSValue, global: *JSGlobalObject) bun.JSError!bool {
        if (!this.isObject())
            return false;
        const function = (try this.fastGet(global, BuiltinName.toString)) orelse
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
            .null, .js_undefined => null,

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
            return truthyPropertyValue(try fastGet(this, global, @field(BuiltinName, property)) orelse return null);
        }

        return getTruthy(this, global, property);
    }

    // TODO: replace calls to this function with `getOptional`
    /// This Cannot handle numeric index property names safely. Please use `getTruthyPropertyValue` instead.
    pub fn getTruthy(this: JSValue, global: *JSGlobalObject, property: []const u8) bun.JSError!?JSValue {
        if (try get(this, global, property)) |prop| {
            return truthyPropertyValue(prop);
        }

        return null;
    }

    /// Get a property value handling numeric index property names safely.
    pub fn getTruthyPropertyValue(this: JSValue, global: *JSGlobalObject, property: []const u8) bun.JSError!?JSValue {
        if (try getPropertyValue(this, global, property)) |prop| {
            return truthyPropertyValue(prop);
        }

        return null;
    }
    /// Get a value that can be coerced to a string.
    ///
    /// Returns null when the value is:
    /// - JSValue.null
    /// - .false
    /// - .js_undefined
    /// - an empty string
    pub fn getStringish(this: JSValue, global: *JSGlobalObject, property: []const u8) bun.JSError!?bun.String {
        var scope: TopExceptionScope = undefined;
        scope.init(global, @src());
        defer scope.deinit();
        const prop = try get(this, global, property) orelse return null;
        if (prop.isNull() or prop == .false) {
            return null;
        }
        if (prop.isSymbol()) {
            return global.throwInvalidPropertyTypeValue(property, "string", prop);
        }

        const str = try prop.toBunString(global);
        errdefer str.deref();
        try scope.returnIfException();
        return if (str.isEmpty())
            null
        else
            str;
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
            if (try fastGet(this, globalThis, @field(BuiltinName, property_name))) |prop| {
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

        if (try prop.getLength(globalThis) == 0) {
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
        if (try getOwnTruthy(this, globalThis, property_name)) |prop| {
            return coerceToArray(prop, globalThis, property_name);
        }

        return null;
    }

    pub fn getOwnObject(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8) JSError!?*jsc.JSObject {
        if (try getOwnTruthy(this, globalThis, property_name)) |prop| {
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
                return jsc.Node.validators.throwErrInvalidArgType(global, property_name, .{}, "string", prop);
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
            .js_undefined => null,
            .false, .true => prop == .true,
            else => {
                return jsc.Node.validators.throwErrInvalidArgType(global, property_name, .{}, "boolean", prop);
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

    pub fn getOptionalInt(this: JSValue, globalThis: *JSGlobalObject, comptime property_name: []const u8, comptime Type: type) JSError!?Type {
        const value = try this.get(globalThis, property_name) orelse return null;
        const info = @typeInfo(Type);
        if (comptime info != .int) {
            @compileError("getOptionalInt only works with integer types");
        }
        const is_unsigned = info.int.signedness == .unsigned;
        const min: i64 = if (is_unsigned) 0 else @max(std.math.minInt(Type), -jsc.MAX_SAFE_INTEGER);
        const max: i64 = @min(std.math.maxInt(Type), jsc.MAX_SAFE_INTEGER);

        return try globalThis.validateIntegerRange(value, Type, 0, .{ .min = min, .max = max, .field_name = property_name });
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

    extern fn JSC__JSValue__isStrictEqual(JSValue, JSValue, *JSGlobalObject) bool;
    pub fn isStrictEqual(this: JSValue, other: JSValue, global: *JSGlobalObject) JSError!bool {
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__isStrictEqual, .{ this, other, global });
    }

    extern fn JSC__JSValue__isSameValue(this: JSValue, other: JSValue, global: *JSGlobalObject) bool;

    /// Object.is()
    ///
    /// This algorithm differs from the IsStrictlyEqual Algorithm by treating all NaN values as equivalent and by differentiating +0𝔽 from -0𝔽.
    /// https://tc39.es/ecma262/#sec-samevalue
    ///
    /// This can throw because it resolves rope strings
    pub fn isSameValue(this: JSValue, other: JSValue, global: *JSGlobalObject) JSError!bool {
        if (@intFromEnum(this) == @intFromEnum(other)) return true;
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__isSameValue, .{ this, other, global });
    }

    extern fn JSC__JSValue__deepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool;
    pub fn deepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) JSError!bool {
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__deepEquals, .{ this, other, global });
    }
    extern fn JSC__JSValue__jestDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool;
    /// same as `JSValue.deepEquals`, but with jest asymmetric matchers enabled
    pub fn jestDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) JSError!bool {
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__jestDeepEquals, .{ this, other, global });
    }

    extern fn JSC__JSValue__strictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool;
    pub fn strictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) JSError!bool {
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__strictDeepEquals, .{ this, other, global });
    }
    extern fn JSC__JSValue__jestStrictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) bool;
    /// same as `JSValue.strictDeepEquals`, but with jest asymmetric matchers enabled
    pub fn jestStrictDeepEquals(this: JSValue, other: JSValue, global: *JSGlobalObject) JSError!bool {
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__jestStrictDeepEquals, .{ this, other, global });
    }
    extern fn JSC__JSValue__jestDeepMatch(this: JSValue, subset: JSValue, global: *JSGlobalObject, replace_props_with_asymmetric_matchers: bool) bool;
    /// same as `JSValue.deepMatch`, but with jest asymmetric matchers enabled
    pub fn jestDeepMatch(this: JSValue, subset: JSValue, global: *JSGlobalObject, replace_props_with_asymmetric_matchers: bool) JSError!bool {
        return bun.jsc.fromJSHostCallGeneric(global, @src(), JSC__JSValue__jestDeepMatch, .{ this, subset, global, replace_props_with_asymmetric_matchers });
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

    extern fn JSC__JSValue__getUTCTimestamp(globalObject: *jsc.JSGlobalObject, this: JSValue) f64;
    /// Calls getTime() - getUTCT
    pub fn getUTCTimestamp(this: JSValue, globalObject: *jsc.JSGlobalObject) f64 {
        return JSC__JSValue__getUTCTimestamp(globalObject, this);
    }

    pub const StringFormatter = struct {
        value: jsc.JSValue,
        globalObject: *jsc.JSGlobalObject,

        pub fn format(this: StringFormatter, writer: *std.Io.Writer) std.Io.Writer.Error!void {
            const str = this.value.toBunString(this.globalObject) catch |e| return bun.deprecated.jsErrorToWriteError(e);
            defer str.deref();
            try str.format(writer);
        }
    };

    pub fn fmtString(this: JSValue, globalObject: *jsc.JSGlobalObject) StringFormatter {
        return .{
            .value = this,
            .globalObject = globalObject,
        };
    }

    pub fn toFmt(
        this: JSValue,
        formatter: *jsc.ConsoleObject.Formatter,
    ) jsc.ConsoleObject.Formatter.ZigFormatter {
        formatter.remaining_values = &[_]JSValue{};
        if (formatter.map_node != null) {
            formatter.deinit();
        }
        formatter.stack_check.update();

        return jsc.ConsoleObject.Formatter.ZigFormatter{
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

    /// Asserts this is a number, undefined, null, or a boolean
    pub fn asNumber(this: JSValue) f64 {
        bun.assert(this.isNumber() or this.isUndefinedOrNull() or this.isBoolean());
        if (this.isInt32()) {
            return @floatFromInt(this.asInt32());
        } else if (isNumber(this)) {
            // Don't need to check for !isInt32() because above
            return this.asDouble();
        } else if (this.isUndefinedOrNull()) {
            return 0.0;
        } else if (this.isBoolean()) {
            return @floatFromInt(@intFromBool(this.asBoolean()));
        }
        return std.math.nan(f64); // unreachable in assertion builds
    }

    pub fn asDouble(this: JSValue) f64 {
        bun.assert(this.isDouble());
        return FFI.JSVALUE_TO_DOUBLE(.{ .asJSValue = this });
    }

    /// Encodes addr as a double. Resulting value can be passed to asPtrAddress.
    pub fn fromPtrAddress(addr: usize) JSValue {
        return jsDoubleNumber(@floatFromInt(addr));
    }

    /// Interprets a numeric JSValue as a pointer address. Use on values returned by fromPtrAddress.
    pub fn asPtrAddress(this: JSValue) usize {
        return @intFromFloat(this.asNumber());
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
        return .fromUV(this.toInt32());
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
    pub fn getLength(this: JSValue, globalThis: *JSGlobalObject) JSError!u64 {
        const len = try this.getLengthIfPropertyExistsInternal(globalThis);
        if (len == std.math.floatMax(f64)) {
            return 0;
        }

        return @intFromFloat(std.math.clamp(len, 0, std.math.maxInt(i52)));
    }

    extern fn JSC__JSValue__getLengthIfPropertyExistsInternal(this: JSValue, globalThis: *JSGlobalObject) f64;
    /// Do not use this directly!
    ///
    /// If the property does not exist, this function will return max(f64) instead of 0.
    /// TODO this should probably just return an optional
    pub fn getLengthIfPropertyExistsInternal(this: JSValue, globalThis: *JSGlobalObject) JSError!f64 {
        return bun.jsc.fromJSHostCallGeneric(globalThis, @src(), JSC__JSValue__getLengthIfPropertyExistsInternal, .{ this, globalThis });
    }

    extern fn JSC__JSValue__isAggregateError(this: JSValue, globalObject: *JSGlobalObject) bool;
    pub fn isAggregateError(this: JSValue, globalObject: *JSGlobalObject) bool {
        return JSC__JSValue__isAggregateError(this, globalObject);
    }

    extern fn JSC__JSValue__forEach(this: JSValue, globalObject: *JSGlobalObject, ctx: ?*anyopaque, callback: *const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.c) void) void;
    pub fn forEach(
        this: JSValue,
        globalObject: *JSGlobalObject,
        ctx: ?*anyopaque,
        callback: *const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.c) void,
    ) bun.JSError!void {
        return bun.jsc.fromJSHostCallGeneric(globalObject, @src(), JSC__JSValue__forEach, .{ this, globalObject, ctx, callback });
    }

    /// Same as `forEach` but accepts a typed context struct without need for @ptrCasts
    pub inline fn forEachWithContext(
        this: JSValue,
        globalObject: *JSGlobalObject,
        ctx: anytype,
        callback: *const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: @TypeOf(ctx), nextValue: JSValue) callconv(.c) void,
    ) bun.JSError!void {
        const func = @as(*const fn (vm: *VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.c) void, @ptrCast(callback));
        return bun.jsc.fromJSHostCallGeneric(globalObject, @src(), JSC__JSValue__forEach, .{ this, globalObject, ctx, func });
    }

    extern fn JSC__JSValue__isIterable(this: JSValue, globalObject: *JSGlobalObject) bool;
    pub fn isIterable(this: JSValue, globalObject: *JSGlobalObject) JSError!bool {
        return bun.jsc.fromJSHostCallGeneric(globalObject, @src(), JSC__JSValue__isIterable, .{ this, globalObject });
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
        return @as(JSValue, @enumFromInt(@as(backing_int, @bitCast(@intFromPtr(this)))));
    }

    // TODO: remove this (no replacement)
    pub inline fn fromRef(this: C_API.JSValueRef) JSValue {
        return @as(JSValue, @enumFromInt(@as(backing_int, @bitCast(@intFromPtr(this)))));
    }

    // TODO: remove this (no replacement)
    pub inline fn asObjectRef(this: JSValue) C_API.JSObjectRef {
        return @ptrFromInt(@as(usize, @bitCast(@intFromEnum(this))));
    }

    /// When the GC sees a JSValue referenced in the stack, it knows not to free it
    /// This mimics the implementation in JavaScriptCore's C++
    pub inline fn ensureStillAlive(this: JSValue) void {
        if (!this.isCell()) return;
        std.mem.doNotOptimizeAway(this.asEncoded().asPtr);
    }

    pub fn uncheckedPtrCast(value: JSValue, comptime T: type) *T {
        return @ptrCast(@alignCast(value.asEncoded().asPtr));
    }

    /// For any callback JSValue created in JS that you will not call *immediately*, you must wrap it
    /// in an AsyncContextFrame with this function. This allows AsyncLocalStorage to work by
    /// snapshotting it's state and restoring it when called.
    /// - If there is no current context, this returns the callback as-is.
    /// - It is safe to run .call() on the resulting JSValue. This includes automatic unwrapping.
    /// - Do not pass the callback as-is to JS; The wrapped object is NOT a function.
    /// - If passed to C++, call it with AsyncContextFrame::call() instead of JSC::call()
    pub inline fn withAsyncContextIfNeeded(this: JSValue, global: *JSGlobalObject) JSValue {
        jsc.markBinding(@src());
        return AsyncContextFrame__withAsyncContextIfNeeded(global, this);
    }

    pub fn isAsyncContextFrame(this: JSValue) bool {
        return Bun__JSValue__isAsyncContextFrame(this);
    }

    extern "c" fn Bun__JSValue__deserialize(global: *JSGlobalObject, data: [*]const u8, len: usize) JSValue;

    /// Deserializes a JSValue from a serialized buffer. Zig version of `import('bun:jsc').deserialize`
    pub inline fn deserialize(bytes: []const u8, global: *JSGlobalObject) bun.JSError!JSValue {
        return bun.jsc.fromJSHostCall(global, @src(), Bun__JSValue__deserialize, .{ global, bytes.ptr, bytes.len });
    }

    extern fn Bun__serializeJSValue(global: *jsc.JSGlobalObject, value: JSValue, flags: u8) SerializedScriptValue.External;
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

    pub const SerializedFlags = packed struct(u8) {
        forCrossProcessTransfer: bool = false,
        forStorage: bool = false,
        _padding: u6 = 0,
    };

    /// Throws a JS exception and returns null if the serialization fails, otherwise returns a SerializedScriptValue.
    /// Must be freed when you are done with the bytes.
    pub inline fn serialize(this: JSValue, global: *JSGlobalObject, flags: SerializedFlags) bun.JSError!SerializedScriptValue {
        var flags_u8: u8 = 0;
        if (flags.forCrossProcessTransfer) flags_u8 |= 1 << 0;
        if (flags.forStorage) flags_u8 |= 1 << 1;

        const value = try bun.jsc.fromJSHostCallGeneric(global, @src(), Bun__serializeJSValue, .{ global, this, flags_u8 });
        return .{ .data = value.bytes.?[0..value.size], .handle = value.handle.? };
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

    pub const FromAnyLifetime = enum { allocated, temporary };

    /// Marshall a zig value into a JSValue using comptime reflection.
    ///
    /// - Primitives are converted to their JS equivalent.
    /// - Types with `toJS` or `toJSNewlyCreated` methods have them called
    /// - Slices are converted to JS arrays
    /// - Enums are converted to 32-bit numbers.
    ///
    /// `lifetime` describes the lifetime of `value`. If it must be copied, specify `temporary`.
    pub fn fromAny(
        globalObject: *jsc.JSGlobalObject,
        comptime T: type,
        value: T,
    ) bun.JSError!jsc.JSValue {
        const Type = comptime brk: {
            var CurrentType = T;
            if (@typeInfo(T) == .optional) {
                CurrentType = @typeInfo(T).optional.child;
            }
            break :brk if (@typeInfo(CurrentType) == .pointer and @typeInfo(CurrentType).pointer.size == .one)
                @typeInfo(CurrentType).pointer.child
            else
                CurrentType;
        };

        if (comptime bun.trait.isNumber(Type)) {
            return jsc.JSValue.jsNumberWithType(Type, if (comptime Type != T) value.* else value);
        }

        switch (comptime Type) {
            void => return .js_undefined,
            bool => return jsc.JSValue.jsBoolean(if (comptime Type != T) value.* else value),
            *jsc.JSGlobalObject => return value.toJSValue(),
            []const u8, [:0]const u8, [*:0]const u8, []u8, [:0]u8, [*:0]u8 => {
                return bun.String.createUTF8ForJS(globalObject, value);
            },
            []const bun.String => {
                defer {
                    for (value) |out| {
                        out.deref();
                    }
                    bun.default_allocator.free(value);
                }
                return bun.String.toJSArray(globalObject, value);
            },
            jsc.JSValue => return if (Type != T) value.* else value,

            inline []const u16, []const u32, []const i16, []const i8, []const i32, []const f32 => {
                var array = try jsc.JSValue.createEmptyArray(globalObject, value.len);
                for (value, 0..) |item, i| {
                    try array.putIndex(
                        globalObject,
                        @truncate(i),
                        .jsNumber(item),
                    );
                }
                return array;
            },

            else => {

                // Recursion can stack overflow here
                if (bun.trait.isSlice(Type)) {
                    const Child = comptime std.meta.Child(Type);

                    var array = try jsc.JSValue.createEmptyArray(globalObject, value.len);
                    for (value, 0..) |*item, i| {
                        const res = try fromAny(globalObject, *Child, item);
                        if (res == .zero) return .zero;
                        try array.putIndex(
                            globalObject,
                            @truncate(i),
                            res,
                        );
                    }
                    return array;
                }

                if (comptime @hasDecl(Type, "toJSNewlyCreated") and @typeInfo(@TypeOf(@field(Type, "toJSNewlyCreated"))).@"fn".params.len == 2) {
                    return value.toJSNewlyCreated(globalObject);
                }

                if (comptime @hasDecl(Type, "toJS") and @typeInfo(@TypeOf(@field(Type, "toJS"))).@"fn".params.len == 2) {
                    return value.toJS(globalObject);
                }

                // must come after toJS check in case this enum implements its own serializer.
                if (@typeInfo(Type) == .@"enum") {
                    // FIXME: creates non-normalized integers (e.g. u2), which
                    // aren't handled by `jsNumberWithType` rn
                    return jsc.JSValue.jsNumberWithType(u32, @as(u32, @intFromEnum(value)));
                }

                @compileError("dont know how to convert " ++ @typeName(T) ++ " to JS");
            },
        }
    }

    /// Print a JSValue to stdout; this is only meant for debugging purposes
    pub fn dump(value: jsc.WebCore.JSValue, globalObject: *jsc.JSGlobalObject) !void {
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalObject };
        defer formatter.deinit();
        try Output.errorWriter().print("{f}\n", .{value.toFmt(globalObject, &formatter)});
        Output.flush();
    }

    pub fn bind(this: JSValue, globalObject: *JSGlobalObject, bindThisArg: JSValue, name: *const bun.String, length: f64, args: []JSValue) bun.JSError!JSValue {
        return bun.cpp.Bun__JSValue__bind(this, globalObject, bindThisArg, name, length, args.ptr, args.len);
    }
    pub const setPrototypeDirect = bun.cpp.Bun__JSValue__setPrototypeDirect;

    pub const JSPropertyNameIterator = struct {
        array: jsc.C.JSPropertyNameArrayRef,
        count: u32,
        i: u32 = 0,

        pub fn next(this: *JSPropertyNameIterator) ?jsc.C.JSStringRef {
            if (this.i >= this.count) return null;
            const i = this.i;
            this.i += 1;

            return jsc.C.JSPropertyNameArrayGetNameAtIndex(this.array, i);
        }
    };

    pub const exposed_to_ffi = struct {
        pub const JSVALUE_TO_INT64 = bun.cpp.JSC__JSValue__toInt64;
        pub const JSVALUE_TO_UINT64 = JSValue.JSC__JSValue__toUInt64NoTruncate;
        pub const INT64_TO_JSVALUE = JSValue.JSC__JSValue__fromInt64NoTruncate;
        pub const UINT64_TO_JSVALUE = JSValue.JSC__JSValue__fromUInt64NoTruncate;
    };

    pub const backing_int = @typeInfo(JSValue).@"enum".tag_type;

    /// Equivalent to `JSC::JSValue::decode`.
    pub fn decode(self: JSValue) jsc.DecodedJSValue {
        var decoded: jsc.DecodedJSValue = undefined;
        decoded.u.asInt64 = @intFromEnum(self);
        return decoded;
    }
};

extern "c" fn AsyncContextFrame__withAsyncContextIfNeeded(global: *JSGlobalObject, callback: JSValue) JSValue;
extern "c" fn Bun__JSValue__isAsyncContextFrame(value: JSValue) bool;

const string = []const u8;

const FFI = @import("./FFI.zig");
const std = @import("std");
const JestPrettyFormat = @import("../test/pretty_format.zig").JestPrettyFormat;

const bun = @import("bun");
const Environment = bun.Environment;
const JSError = bun.JSError;
const MutableString = bun.MutableString;
const Output = bun.Output;
const String = bun.String;
const FetchHeaders = bun.webcore.FetchHeaders;

const jsc = bun.jsc;
const AnyPromise = jsc.AnyPromise;
const ArrayBuffer = jsc.ArrayBuffer;
const C_API = bun.jsc.C;
const DOMURL = jsc.DOMURL;
const JSArrayIterator = jsc.JSArrayIterator;
const JSCell = jsc.JSCell;
const JSGlobalObject = jsc.JSGlobalObject;
const JSInternalPromise = jsc.JSInternalPromise;
const JSObject = jsc.JSObject;
const JSPromise = jsc.JSPromise;
const JSString = jsc.JSString;
const TopExceptionScope = jsc.TopExceptionScope;
const VM = jsc.VM;
const ZigException = jsc.ZigException;
const ZigString = jsc.ZigString;
const fromJSHostCall = jsc.fromJSHostCall;
const toJSHostFunction = jsc.toJSHostFn;
