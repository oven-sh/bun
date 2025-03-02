pub const JSGlobalObject = opaque {
    pub fn allocator(this: *JSGlobalObject) std.mem.Allocator {
        return this.bunVM().allocator;
    }
    extern fn JSGlobalObject__throwStackOverflow(this: *JSGlobalObject) void;
    pub fn throwStackOverflow(this: *JSGlobalObject) void {
        JSGlobalObject__throwStackOverflow(this);
    }
    extern fn JSGlobalObject__throwOutOfMemoryError(this: *JSGlobalObject) void;
    pub fn throwOutOfMemory(this: *JSGlobalObject) bun.JSError {
        JSGlobalObject__throwOutOfMemoryError(this);
        return error.JSError;
    }

    pub fn throwOutOfMemoryValue(this: *JSGlobalObject) JSValue {
        JSGlobalObject__throwOutOfMemoryError(this);
        return .zero;
    }

    pub fn throwTODO(this: *JSGlobalObject, msg: []const u8) bun.JSError {
        const err = this.createErrorInstance("{s}", .{msg});
        err.put(this, ZigString.static("name"), bun.String.static("TODOError").toJS(this));
        return this.throwValue(err);
    }

    pub const throwTerminationException = JSGlobalObject__throwTerminationException;
    pub const clearTerminationException = JSGlobalObject__clearTerminationException;

    pub fn setTimeZone(this: *JSGlobalObject, timeZone: *const ZigString) bool {
        return JSGlobalObject__setTimeZone(this, timeZone);
    }

    pub inline fn toJSValue(globalThis: *JSGlobalObject) JSValue {
        return @enumFromInt(@intFromPtr(globalThis));
    }

    pub fn throwInvalidArguments(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) bun.JSError {
        const err = JSC.toInvalidArguments(fmt, args, this);
        return this.throwValue(err);
    }

    pub inline fn throwMissingArgumentsValue(this: *JSGlobalObject, comptime arg_names: []const []const u8) bun.JSError {
        return switch (arg_names.len) {
            0 => @compileError("requires at least one argument"),
            1 => this.ERR_MISSING_ARGS("The \"{s}\" argument must be specified", .{arg_names[0]}).throw(),
            2 => this.ERR_MISSING_ARGS("The \"{s}\" and \"{s}\" arguments must be specified", .{ arg_names[0], arg_names[1] }).throw(),
            3 => this.ERR_MISSING_ARGS("The \"{s}\", \"{s}\", and \"{s}\" arguments must be specified", .{ arg_names[0], arg_names[1], arg_names[2] }).throw(),
            else => @compileError("implement this message"),
        };
    }

    /// "Expected {field} to be a {typename} for '{name}'."
    pub fn createInvalidArgumentType(
        this: *JSGlobalObject,
        comptime name_: []const u8,
        comptime field: []const u8,
        comptime typename: []const u8,
    ) JSC.JSValue {
        return this.ERR_INVALID_ARG_TYPE(comptime std.fmt.comptimePrint("Expected {s} to be a {s} for '{s}'.", .{ field, typename, name_ }), .{}).toJS();
    }

    pub fn toJS(this: *JSC.JSGlobalObject, value: anytype, comptime lifetime: JSC.Lifetime) JSC.JSValue {
        return JSC.toJS(this, @TypeOf(value), value, lifetime);
    }

    /// "Expected {field} to be a {typename} for '{name}'."
    pub fn throwInvalidArgumentType(
        this: *JSGlobalObject,
        comptime name_: []const u8,
        comptime field: []const u8,
        comptime typename: []const u8,
    ) bun.JSError {
        return this.throwValue(this.createInvalidArgumentType(name_, field, typename));
    }

    /// "The {argname} argument is invalid. Received {value}"
    pub fn throwInvalidArgumentValue(
        this: *JSGlobalObject,
        argname: []const u8,
        value: JSValue,
    ) bun.JSError {
        const actual_string_value = try determineSpecificType(this, value);
        defer actual_string_value.deref();
        return this.ERR_INVALID_ARG_VALUE("The \"{s}\" argument is invalid. Received {}", .{ argname, actual_string_value }).throw();
    }

    /// Throw an `ERR_INVALID_ARG_VALUE` when the invalid value is a property of an object.
    /// Message depends on whether `expected` is present.
    /// - "The property "{argname}" is invalid. Received {value}"
    /// - "The property "{argname}" is invalid. Expected {expected}, received {value}"
    pub fn throwInvalidArgumentPropertyValue(
        this: *JSGlobalObject,
        argname: []const u8,
        comptime expected: ?[]const u8,
        value: JSValue,
    ) bun.JSError {
        const actual_string_value = try determineSpecificType(this, value);
        defer actual_string_value.deref();
        if (comptime expected) |_expected| {
            return this.ERR_INVALID_ARG_VALUE("The property \"{s}\" is invalid. Expected {s}, received {}", .{ argname, _expected, actual_string_value }).throw();
        } else {
            return this.ERR_INVALID_ARG_VALUE("The property \"{s}\" is invalid. Received {}", .{ argname, actual_string_value }).throw();
        }
    }

    extern "c" fn Bun__ErrorCode__determineSpecificType(*JSGlobalObject, JSValue) String;

    pub fn determineSpecificType(global: *JSGlobalObject, value: JSValue) JSError!String {
        const str = Bun__ErrorCode__determineSpecificType(global, value);
        errdefer str.deref();
        if (global.hasException()) {
            return error.JSError;
        }
        return str;
    }

    /// "The {argname} argument must be of type {typename}. Received {value}"
    pub fn throwInvalidArgumentTypeValue(
        this: *JSGlobalObject,
        argname: []const u8,
        typename: []const u8,
        value: JSValue,
    ) bun.JSError {
        const actual_string_value = try determineSpecificType(this, value);
        defer actual_string_value.deref();
        return this.ERR_INVALID_ARG_TYPE("The \"{s}\" argument must be of type {s}. Received {}", .{ argname, typename, actual_string_value }).throw();
    }

    pub fn throwInvalidArgumentRangeValue(
        this: *JSGlobalObject,
        argname: []const u8,
        typename: []const u8,
        value: i64,
    ) bun.JSError {
        return this.ERR_OUT_OF_RANGE("The \"{s}\" is out of range. {s}. Received {}", .{ argname, typename, value }).throw();
    }

    pub fn throwInvalidPropertyTypeValue(
        this: *JSGlobalObject,
        field: []const u8,
        typename: []const u8,
        value: JSValue,
    ) bun.JSError {
        const ty_str = value.jsTypeString(this).toSlice(this, bun.default_allocator);
        defer ty_str.deinit();
        return this.ERR_INVALID_ARG_TYPE("The \"{s}\" property must be of type {s}. Received {s}", .{ field, typename, ty_str.slice() }).throw();
    }

    pub fn createNotEnoughArguments(
        this: *JSGlobalObject,
        comptime name_: []const u8,
        comptime expected: usize,
        got: usize,
    ) JSC.JSValue {
        return JSC.toTypeError(.ERR_MISSING_ARGS, "Not enough arguments to '" ++ name_ ++ "'. Expected {d}, got {d}.", .{ expected, got }, this);
    }

    /// Not enough arguments passed to function named `name_`
    pub fn throwNotEnoughArguments(
        this: *JSGlobalObject,
        comptime name_: []const u8,
        comptime expected: usize,
        got: usize,
    ) bun.JSError {
        return this.throwValue(this.createNotEnoughArguments(name_, expected, got));
    }

    extern fn JSC__JSGlobalObject__reload(JSC__JSGlobalObject__ptr: *JSGlobalObject) void;
    pub fn reload(this: *JSC.JSGlobalObject) void {
        this.vm().drainMicrotasks();
        this.vm().collectAsync();

        JSC__JSGlobalObject__reload(this);
    }

    pub const BunPluginTarget = enum(u8) {
        bun = 0,
        node = 1,
        browser = 2,
    };
    extern fn Bun__runOnLoadPlugins(*JSC.JSGlobalObject, ?*const bun.String, *const bun.String, BunPluginTarget) JSValue;
    extern fn Bun__runOnResolvePlugins(*JSC.JSGlobalObject, ?*const bun.String, *const bun.String, *const String, BunPluginTarget) JSValue;

    pub fn runOnLoadPlugins(this: *JSGlobalObject, namespace_: bun.String, path: bun.String, target: BunPluginTarget) ?JSValue {
        JSC.markBinding(@src());
        const result = Bun__runOnLoadPlugins(this, if (namespace_.length() > 0) &namespace_ else null, &path, target);
        if (result.isEmptyOrUndefinedOrNull()) {
            return null;
        }

        return result;
    }

    pub fn runOnResolvePlugins(this: *JSGlobalObject, namespace_: bun.String, path: bun.String, source: bun.String, target: BunPluginTarget) ?JSValue {
        JSC.markBinding(@src());

        const result = Bun__runOnResolvePlugins(this, if (namespace_.length() > 0) &namespace_ else null, &path, &source, target);
        if (result.isEmptyOrUndefinedOrNull()) {
            return null;
        }

        return result;
    }

    pub fn createErrorInstance(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) JSValue {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len > 0) {
            var stack_fallback = std.heap.stackFallback(1024 * 4, this.allocator());
            var buf = bun.MutableString.init2048(stack_fallback.get()) catch unreachable;
            defer buf.deinit();
            var writer = buf.writer();
            writer.print(fmt, args) catch
            // if an exception occurs in the middle of formatting the error message, it's better to just return the formatting string than an error about an error
                return ZigString.static(fmt).toErrorInstance(this);

            // Ensure we clone it.
            var str = ZigString.initUTF8(buf.slice());

            return str.toErrorInstance(this);
        } else {
            if (comptime strings.isAllASCII(fmt)) {
                return String.static(fmt).toErrorInstance(this);
            } else {
                return ZigString.initUTF8(fmt).toErrorInstance(this);
            }
        }
    }

    pub fn createTypeErrorInstance(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) JSValue {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len > 0) {
            var stack_fallback = std.heap.stackFallback(1024 * 4, this.allocator());
            var buf = bun.MutableString.init2048(stack_fallback.get()) catch unreachable;
            defer buf.deinit();
            var writer = buf.writer();
            writer.print(fmt, args) catch return ZigString.static(fmt).toErrorInstance(this);
            var str = ZigString.fromUTF8(buf.slice());
            return str.toTypeErrorInstance(this);
        } else {
            return ZigString.static(fmt).toTypeErrorInstance(this);
        }
    }

    pub fn createSyntaxErrorInstance(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) JSValue {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len > 0) {
            var stack_fallback = std.heap.stackFallback(1024 * 4, this.allocator());
            var buf = bun.MutableString.init2048(stack_fallback.get()) catch unreachable;
            defer buf.deinit();
            var writer = buf.writer();
            writer.print(fmt, args) catch return ZigString.static(fmt).toErrorInstance(this);
            var str = ZigString.fromUTF8(buf.slice());
            return str.toSyntaxErrorInstance(this);
        } else {
            return ZigString.static(fmt).toSyntaxErrorInstance(this);
        }
    }

    pub fn createRangeErrorInstance(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) JSValue {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len > 0) {
            var stack_fallback = std.heap.stackFallback(1024 * 4, this.allocator());
            var buf = bun.MutableString.init2048(stack_fallback.get()) catch unreachable;
            defer buf.deinit();
            var writer = buf.writer();
            writer.print(fmt, args) catch return ZigString.static(fmt).toErrorInstance(this);
            var str = ZigString.fromUTF8(buf.slice());
            return str.toRangeErrorInstance(this);
        } else {
            return ZigString.static(fmt).toRangeErrorInstance(this);
        }
    }

    pub fn createRangeError(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) JSValue {
        const err = createErrorInstance(this, fmt, args);
        err.put(this, ZigString.static("code"), ZigString.static(@tagName(JSC.Node.ErrorCode.ERR_OUT_OF_RANGE)).toJS(this));
        return err;
    }

    pub fn createInvalidArgs(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) JSValue {
        return JSC.Error.ERR_INVALID_ARG_TYPE.fmt(this, fmt, args);
    }

    pub const SysErrOptions = struct {
        code: JSC.Node.ErrorCode,
        errno: ?i32 = null,
        name: ?string = null,
    };
    pub fn throwSysError(
        this: *JSGlobalObject,
        opts: SysErrOptions,
        comptime message: bun.stringZ,
        args: anytype,
    ) JSError {
        const err = createErrorInstance(this, message, args);
        err.put(this, ZigString.static("code"), ZigString.init(@tagName(opts.code)).toJS(this));
        if (opts.name) |name| err.put(this, ZigString.static("name"), ZigString.init(name).toJS(this));
        if (opts.errno) |errno| err.put(this, ZigString.static("errno"), JSC.toJS(this, i32, errno, .temporary));
        return this.throwValue(err);
    }

    pub fn throw(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) JSError {
        const instance = this.createErrorInstance(fmt, args);
        bun.assert(instance != .zero);
        return this.throwValue(instance);
    }

    pub fn throwPretty(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) bun.JSError {
        const instance = switch (Output.enable_ansi_colors) {
            inline else => |enabled| this.createErrorInstance(Output.prettyFmt(fmt, enabled), args),
        };
        bun.assert(instance != .zero);
        return this.throwValue(instance);
    }

    extern fn JSC__JSGlobalObject__queueMicrotaskCallback(*JSGlobalObject, *anyopaque, Function: *const (fn (*anyopaque) callconv(.C) void)) void;
    pub fn queueMicrotaskCallback(
        this: *JSGlobalObject,
        ctx_val: anytype,
        comptime Function: fn (ctx: @TypeOf(ctx_val)) void,
    ) void {
        JSC.markBinding(@src());
        const Fn = Function;
        const ContextType = @TypeOf(ctx_val);
        const Wrapper = struct {
            pub fn call(p: *anyopaque) callconv(.C) void {
                Fn(bun.cast(ContextType, p));
            }
        };

        JSC__JSGlobalObject__queueMicrotaskCallback(this, ctx_val, &Wrapper.call);
    }

    pub fn queueMicrotask(this: *JSGlobalObject, function: JSValue, args: []const JSC.JSValue) void {
        this.queueMicrotaskJob(
            function,
            if (args.len > 0) args[0] else .zero,
            if (args.len > 1) args[1] else .zero,
        );
    }

    extern fn Bun__Process__emitWarning(globalObject: *JSGlobalObject, warning: JSValue, @"type": JSValue, code: JSValue, ctor: JSValue) void;
    pub fn emitWarning(globalObject: *JSGlobalObject, warning: JSValue, @"type": JSValue, code: JSValue, ctor: JSValue) JSError!void {
        Bun__Process__emitWarning(globalObject, warning, @"type", code, ctor);
        if (globalObject.hasException()) return error.JSError;
    }

    extern fn JSC__JSGlobalObject__queueMicrotaskJob(JSC__JSGlobalObject__ptr: *JSGlobalObject, JSValue, JSValue, JSValue) void;
    pub fn queueMicrotaskJob(this: *JSGlobalObject, function: JSValue, first: JSValue, second: JSValue) void {
        JSC__JSGlobalObject__queueMicrotaskJob(this, function, first, second);
    }

    pub fn throwValue(this: *JSGlobalObject, value: JSC.JSValue) JSError {
        this.vm().throwError(this, value);
        return error.JSError;
    }

    pub fn throwError(this: *JSGlobalObject, err: anyerror, comptime fmt: [:0]const u8) bun.JSError {
        if (err == error.OutOfMemory) {
            return this.throwOutOfMemory();
        }

        // If we're throwing JSError, that means either:
        // - We're throwing an exception while another exception is already active
        // - We're incorrectly returning JSError from a function that did not throw.
        bun.debugAssert(err != error.JSError);

        // Avoid tiny extra allocation
        var stack = std.heap.stackFallback(128, bun.default_allocator);
        const allocator_ = stack.get();
        const buffer = try std.fmt.allocPrint(allocator_, comptime "{s} " ++ fmt, .{@errorName(err)});
        defer allocator_.free(buffer);
        const str = ZigString.initUTF8(buffer);
        const err_value = str.toErrorInstance(this);
        this.vm().throwError(this, err_value);
        return error.JSError;
    }

    pub fn ref(this: *JSGlobalObject) C_API.JSContextRef {
        return @as(C_API.JSContextRef, @ptrCast(this));
    }
    pub const ctx = ref;

    extern fn JSC__JSGlobalObject__createAggregateError(*JSGlobalObject, [*]const JSValue, usize, *const ZigString) JSValue;
    pub fn createAggregateError(globalObject: *JSGlobalObject, errors: []const JSValue, message: *const ZigString) JSValue {
        return JSC__JSGlobalObject__createAggregateError(globalObject, errors.ptr, errors.len, message);
    }

    extern fn JSC__JSGlobalObject__createAggregateErrorWithArray(*JSGlobalObject, JSValue, bun.String, JSValue) JSValue;
    pub fn createAggregateErrorWithArray(
        globalObject: *JSGlobalObject,
        message: bun.String,
        error_array: JSValue,
    ) JSValue {
        if (bun.Environment.allow_assert)
            bun.assert(error_array.isArray());
        return JSC__JSGlobalObject__createAggregateErrorWithArray(globalObject, error_array, message, .undefined);
    }

    extern fn JSC__JSGlobalObject__generateHeapSnapshot(*JSGlobalObject) JSValue;
    pub fn generateHeapSnapshot(this: *JSGlobalObject) JSValue {
        return JSC__JSGlobalObject__generateHeapSnapshot(this);
    }

    pub fn hasException(this: *JSGlobalObject) bool {
        return JSGlobalObject__hasException(this);
    }

    pub fn clearException(this: *JSGlobalObject) void {
        return JSGlobalObject__clearException(this);
    }

    /// Clears the current exception and returns that value. Requires compile-time
    /// proof of an exception via `error.JSError`
    pub fn takeException(this: *JSGlobalObject, proof: bun.JSError) JSValue {
        switch (proof) {
            error.JSError => {},
            error.OutOfMemory => this.throwOutOfMemory() catch {},
        }

        return this.tryTakeException() orelse {
            @panic("A JavaScript exception was thrown, but it was cleared before it could be read.");
        };
    }

    pub fn takeError(this: *JSGlobalObject, proof: bun.JSError) JSValue {
        switch (proof) {
            error.JSError => {},
            error.OutOfMemory => this.throwOutOfMemory() catch {},
        }

        return (this.tryTakeException() orelse {
            @panic("A JavaScript exception was thrown, but it was cleared before it could be read.");
        }).toError() orelse {
            @panic("Couldn't convert a JavaScript exception to an Error instance.");
        };
    }

    pub fn tryTakeException(this: *JSGlobalObject) ?JSValue {
        const value = JSGlobalObject__tryTakeException(this);
        if (value == .zero) return null;
        return value;
    }

    /// This is for the common scenario you are calling into JavaScript, but there is
    /// no logical way to handle a thrown exception other than to treat it as unhandled.
    ///
    /// The pattern:
    ///
    ///     const result = value.call(...) catch |err|
    ///         return global.reportActiveExceptionAsUnhandled(err);
    ///
    pub fn reportActiveExceptionAsUnhandled(this: *JSGlobalObject, err: bun.JSError) void {
        _ = this.bunVM().uncaughtException(this, this.takeException(err), false);
    }

    pub fn vm(this: *JSGlobalObject) *VM {
        return JSC__JSGlobalObject__vm(this);
    }

    pub fn deleteModuleRegistryEntry(this: *JSGlobalObject, name_: *ZigString) void {
        return JSC__JSGlobalObject__deleteModuleRegistryEntry(this, name_);
    }

    fn bunVMUnsafe(this: *JSGlobalObject) *anyopaque {
        return JSC__JSGlobalObject__bunVM(this);
    }

    pub fn bunVM(this: *JSGlobalObject) *JSC.VirtualMachine {
        if (comptime bun.Environment.allow_assert) {
            // if this fails
            // you most likely need to run
            //   make clean-jsc-bindings
            //   make bindings -j10
            const assertion = this.bunVMUnsafe() == @as(*anyopaque, @ptrCast(JSC.VirtualMachine.get()));
            bun.assert(assertion);
        }
        return @as(*JSC.VirtualMachine, @ptrCast(@alignCast(this.bunVMUnsafe())));
    }

    /// We can't do the threadlocal check when queued from another thread
    pub fn bunVMConcurrently(this: *JSGlobalObject) *JSC.VirtualMachine {
        return @as(*JSC.VirtualMachine, @ptrCast(@alignCast(this.bunVMUnsafe())));
    }

    extern fn JSC__JSGlobalObject__handleRejectedPromises(*JSGlobalObject) void;
    pub fn handleRejectedPromises(this: *JSGlobalObject) void {
        return JSC__JSGlobalObject__handleRejectedPromises(this);
    }

    extern fn ZigGlobalObject__readableStreamToArrayBuffer(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToBytes(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToText(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToJSON(*JSGlobalObject, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToFormData(*JSGlobalObject, JSValue, JSValue) JSValue;
    extern fn ZigGlobalObject__readableStreamToBlob(*JSGlobalObject, JSValue) JSValue;

    pub fn readableStreamToArrayBuffer(this: *JSGlobalObject, value: JSValue) JSValue {
        return ZigGlobalObject__readableStreamToArrayBuffer(this, value);
    }

    pub fn readableStreamToBytes(this: *JSGlobalObject, value: JSValue) JSValue {
        return ZigGlobalObject__readableStreamToBytes(this, value);
    }

    pub fn readableStreamToText(this: *JSGlobalObject, value: JSValue) JSValue {
        return ZigGlobalObject__readableStreamToText(this, value);
    }

    pub fn readableStreamToJSON(this: *JSGlobalObject, value: JSValue) JSValue {
        return ZigGlobalObject__readableStreamToJSON(this, value);
    }

    pub fn readableStreamToBlob(this: *JSGlobalObject, value: JSValue) JSValue {
        return ZigGlobalObject__readableStreamToBlob(this, value);
    }

    pub fn readableStreamToFormData(this: *JSGlobalObject, value: JSValue, content_type: JSValue) JSValue {
        return ZigGlobalObject__readableStreamToFormData(this, value, content_type);
    }

    extern fn ZigGlobalObject__makeNapiEnvForFFI(*JSGlobalObject) *napi.NapiEnv;

    pub fn makeNapiEnvForFFI(this: *JSGlobalObject) *napi.NapiEnv {
        return ZigGlobalObject__makeNapiEnvForFFI(this);
    }

    pub inline fn assertOnJSThread(this: *JSGlobalObject) void {
        if (bun.Environment.allow_assert) this.bunVM().assertOnJSThread();
    }

    // returns false if it throws
    pub fn validateObject(
        this: *JSGlobalObject,
        comptime arg_name: [:0]const u8,
        value: JSValue,
        opts: struct {
            allowArray: bool = false,
            allowFunction: bool = false,
            nullable: bool = false,
        },
    ) bun.JSError!void {
        if ((!opts.nullable and value.isNull()) or
            (!opts.allowArray and value.isArray()) or
            (!value.isObject() and (!opts.allowFunction or !value.isFunction())))
        {
            return this.throwInvalidArgumentTypeValue(arg_name, "object", value);
        }
    }

    pub fn throwRangeError(this: *JSGlobalObject, value: anytype, options: bun.fmt.OutOfRangeOptions) bun.JSError {
        // TODO:
        // This works around a Zig compiler bug
        // when using this.ERR_OUT_OF_RANGE.
        return JSC.Error.ERR_OUT_OF_RANGE.throw(this, "{}", .{bun.fmt.outOfRange(value, options)});
    }

    pub const IntegerRange = struct {
        min: comptime_int = JSC.MIN_SAFE_INTEGER,
        max: comptime_int = JSC.MAX_SAFE_INTEGER,
        field_name: []const u8 = "",
        always_allow_zero: bool = false,
    };

    pub fn validateIntegerRange(this: *JSGlobalObject, value: JSValue, comptime T: type, default: T, comptime range: IntegerRange) bun.JSError!T {
        if (value == .undefined or value == .zero) {
            return default;
        }

        const min_t = comptime @max(range.min, std.math.minInt(T), JSC.MIN_SAFE_INTEGER);
        const max_t = comptime @min(range.max, std.math.maxInt(T), JSC.MAX_SAFE_INTEGER);

        comptime {
            if (min_t > max_t) {
                @compileError("max must be less than min");
            }

            if (max_t < min_t) {
                @compileError("max must be less than min");
            }
        }
        const field_name = comptime range.field_name;
        const always_allow_zero = comptime range.always_allow_zero;
        const min = range.min;
        const max = range.max;

        if (value.isInt32()) {
            const int = value.toInt32();
            if (always_allow_zero and int == 0) {
                return 0;
            }
            if (int < min_t or int > max_t) {
                return this.throwRangeError(int, .{ .field_name = field_name, .min = min, .max = max });
            }
            return @intCast(int);
        }

        if (!value.isNumber()) {
            return this.throwInvalidPropertyTypeValue(field_name, "number", value);
        }
        const f64_val = value.asNumber();
        if (always_allow_zero and f64_val == 0) {
            return 0;
        }

        if (std.math.isNan(f64_val)) {
            // node treats NaN as default
            return default;
        }
        if (@floor(f64_val) != f64_val) {
            return this.throwInvalidPropertyTypeValue(field_name, "integer", value);
        }
        if (f64_val < min_t or f64_val > max_t) {
            return this.throwRangeError(f64_val, .{ .field_name = comptime field_name, .min = min, .max = max });
        }

        return @intFromFloat(f64_val);
    }

    pub fn getInteger(this: *JSGlobalObject, obj: JSValue, comptime T: type, default: T, comptime range: IntegerRange) ?T {
        if (obj.get(this, range.field_name)) |val| {
            return this.validateIntegerRange(val, T, default, range);
        }
        if (this.hasException()) return null;
        return default;
    }

    pub inline fn createHostFunction(
        global: *JSGlobalObject,
        comptime display_name: [:0]const u8,
        // when querying from JavaScript, 'func.name'
        comptime function: anytype,
        // when querying from JavaScript, 'func.len'
        comptime argument_count: u32,
    ) JSValue {
        return JSC.NewRuntimeFunction(global, ZigString.static(display_name), argument_count, JSC.toJSHostFunction(function), false, false, null);
    }

    /// Get a lazily-initialized `JSC::String` from `BunCommonStrings.h`.
    pub inline fn commonStrings(this: *JSC.JSGlobalObject) CommonStrings {
        JSC.markBinding(@src());
        return .{ .globalObject = this };
    }

    pub usingnamespace @import("ErrorCode").JSGlobalObjectExtensions;

    extern fn JSC__JSGlobalObject__bunVM(*JSGlobalObject) *VM;
    extern fn JSC__JSGlobalObject__vm(*JSGlobalObject) *VM;
    extern fn JSC__JSGlobalObject__deleteModuleRegistryEntry(*JSGlobalObject, *const ZigString) void;
    extern fn JSGlobalObject__clearException(*JSGlobalObject) void;
    extern fn JSGlobalObject__clearTerminationException(this: *JSGlobalObject) void;
    extern fn JSGlobalObject__hasException(*JSGlobalObject) bool;
    extern fn JSGlobalObject__setTimeZone(this: *JSGlobalObject, timeZone: *const ZigString) bool;
    extern fn JSGlobalObject__tryTakeException(*JSGlobalObject) JSValue;
    extern fn JSGlobalObject__throwTerminationException(this: *JSGlobalObject) void;
};

const CommonStrings = JSC.CommonStrings;

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
const JSValue = JSC.JSValue;
const VM = JSC.VM;
const JSPromise = JSC.JSPromise;
