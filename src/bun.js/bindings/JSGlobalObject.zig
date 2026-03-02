pub const JSGlobalObject = opaque {
    pub fn allocator(this: *JSGlobalObject) std.mem.Allocator {
        return this.bunVM().allocator;
    }
    extern fn JSGlobalObject__throwStackOverflow(this: *JSGlobalObject) void;
    pub fn throwStackOverflow(this: *JSGlobalObject) bun.JSError {
        JSGlobalObject__throwStackOverflow(this);
        return error.JSError;
    }
    extern fn JSGlobalObject__throwOutOfMemoryError(this: *JSGlobalObject) void;
    pub fn throwOutOfMemory(this: *JSGlobalObject) bun.JSError {
        JSGlobalObject__throwOutOfMemoryError(this);
        return error.JSError;
    }

    extern fn JSGlobalObject__createOutOfMemoryError(this: *JSGlobalObject) JSValue;
    pub fn createOutOfMemoryError(this: *JSGlobalObject) JSValue {
        return JSGlobalObject__createOutOfMemoryError(this);
    }

    pub fn throwOutOfMemoryValue(this: *JSGlobalObject) JSValue {
        JSGlobalObject__throwOutOfMemoryError(this);
        return .zero;
    }
    pub fn gregorianDateTimeToMS(this: *jsc.JSGlobalObject, year: i32, month: i32, day: i32, hour: i32, minute: i32, second: i32, millisecond: i32) bun.JSError!f64 {
        jsc.markBinding(@src());
        return bun.cpp.Bun__gregorianDateTimeToMS(this, year, month, day, hour, minute, second, millisecond);
    }

    pub fn throwTODO(this: *JSGlobalObject, msg: []const u8) bun.JSError {
        const err = this.createErrorInstance("{s}", .{msg});
        err.put(this, ZigString.static("name"), (bun.String.static("TODOError").toJS(this)) catch return error.JSError);
        return this.throwValue(err);
    }

    pub const requestTermination = JSGlobalObject__requestTermination;
    pub const clearTerminationException = JSGlobalObject__clearTerminationException;

    pub fn setTimeZone(this: *JSGlobalObject, timeZone: *const ZigString) bool {
        return JSGlobalObject__setTimeZone(this, timeZone);
    }

    pub inline fn toJSValue(globalThis: *JSGlobalObject) JSValue {
        return @enumFromInt(@intFromPtr(globalThis));
    }

    pub fn throwInvalidArguments(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) bun.JSError {
        const err = this.toInvalidArguments(fmt, args);
        return this.throwValue(err);
    }

    pub inline fn throwMissingArgumentsValue(this: *JSGlobalObject, comptime arg_names: []const []const u8) bun.JSError {
        return switch (arg_names.len) {
            0 => @compileError("requires at least one argument"),
            1 => this.ERR(.MISSING_ARGS, "The \"{s}\" argument must be specified", .{arg_names[0]}).throw(),
            2 => this.ERR(.MISSING_ARGS, "The \"{s}\" and \"{s}\" arguments must be specified", .{ arg_names[0], arg_names[1] }).throw(),
            3 => this.ERR(.MISSING_ARGS, "The \"{s}\", \"{s}\", and \"{s}\" arguments must be specified", .{ arg_names[0], arg_names[1], arg_names[2] }).throw(),
            else => @compileError("implement this message"),
        };
    }

    /// "Expected {field} to be a {typename} for '{name}'."
    pub fn createInvalidArgumentType(
        this: *JSGlobalObject,
        comptime name_: []const u8,
        comptime field: []const u8,
        comptime typename: []const u8,
    ) jsc.JSValue {
        return this.ERR(.INVALID_ARG_TYPE, comptime std.fmt.comptimePrint("Expected {s} to be a {s} for '{s}'.", .{ field, typename, name_ }), .{}).toJS();
    }

    pub fn toJS(this: *jsc.JSGlobalObject, value: anytype) bun.JSError!jsc.JSValue {
        return .fromAny(this, @TypeOf(value), value);
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
        return this.ERR(.INVALID_ARG_VALUE, "The \"{s}\" argument is invalid. Received {f}", .{ argname, actual_string_value }).throw();
    }

    pub fn throwInvalidArgumentValueCustom(
        this: *JSGlobalObject,
        argname: []const u8,
        value: JSValue,
        message: []const u8,
    ) bun.JSError {
        const actual_string_value = try determineSpecificType(this, value);
        defer actual_string_value.deref();
        return this.ERR(.INVALID_ARG_VALUE, "The \"{s}\" argument {s}. Received {f}", .{ argname, message, actual_string_value }).throw();
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
            return this.ERR(.INVALID_ARG_VALUE, "The property \"{s}\" is invalid. Expected {s}, received {f}", .{ argname, _expected, actual_string_value }).throw();
        } else {
            return this.ERR(.INVALID_ARG_VALUE, "The property \"{s}\" is invalid. Received {f}", .{ argname, actual_string_value }).throw();
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

    pub fn throwIncompatibleOptionPair(
        this: *JSGlobalObject,
        opt1: []const u8,
        opt2: []const u8,
    ) JSError {
        return this.ERR(.INCOMPATIBLE_OPTION_PAIR, "Option \"{s}\" cannot be used in combination with option \"{s}\"", .{ opt1, opt2 }).throw();
    }

    pub fn throwInvalidScryptParams(
        this: *JSGlobalObject,
    ) JSError {
        const err = bun.BoringSSL.c.ERR_peek_last_error();
        if (err != 0) {
            var buf: [256]u8 = undefined;
            const msg = bun.BoringSSL.c.ERR_error_string_n(err, &buf, buf.len);
            return this.ERR(.CRYPTO_INVALID_SCRYPT_PARAMS, "Invalid scrypt params: {s}", .{msg}).throw();
        }

        return this.ERR(.CRYPTO_INVALID_SCRYPT_PARAMS, "Invalid scrypt params", .{}).throw();
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
        return this.ERR(.INVALID_ARG_TYPE, "The \"{s}\" argument must be of type {s}. Received {f}", .{ argname, typename, actual_string_value }).throw();
    }

    pub fn throwInvalidArgumentTypeValue2(
        this: *JSGlobalObject,
        argname: []const u8,
        typename: []const u8,
        value: JSValue,
    ) JSError {
        const actual_string_value = try determineSpecificType(this, value);
        defer actual_string_value.deref();
        return this.ERR(.INVALID_ARG_TYPE, "The \"{s}\" argument must be {s}. Received {f}", .{ argname, typename, actual_string_value }).throw();
    }

    /// "The <argname> argument must be one of type <typename>. Received <value>"
    pub fn throwInvalidArgumentTypeValueOneOf(
        this: *JSGlobalObject,
        argname: []const u8,
        typename: []const u8,
        value: JSValue,
    ) bun.JSError {
        const actual_string_value = try determineSpecificType(this, value);
        defer actual_string_value.deref();
        return this.ERR(.INVALID_ARG_TYPE, "The \"{s}\" argument must be one of type {s}. Received {f}", .{ argname, typename, actual_string_value }).throw();
    }

    pub fn throwInvalidArgumentRangeValue(
        this: *JSGlobalObject,
        argname: []const u8,
        typename: []const u8,
        value: i64,
    ) bun.JSError {
        return this.ERR(.OUT_OF_RANGE, "The \"{s}\" is out of range. {s}. Received {f}", .{ argname, typename, value }).throw();
    }

    pub fn throwInvalidPropertyTypeValue(
        this: *JSGlobalObject,
        field: []const u8,
        typename: []const u8,
        value: JSValue,
    ) bun.JSError {
        const ty_str = value.jsTypeString(this).toSlice(this, bun.default_allocator);
        defer ty_str.deinit();
        return this.ERR(.INVALID_ARG_TYPE, "The \"{s}\" property must be of type {s}. Received {s}", .{ field, typename, ty_str.slice() }).throw();
    }

    pub fn createNotEnoughArguments(
        this: *JSGlobalObject,
        comptime name_: []const u8,
        comptime expected: usize,
        got: usize,
    ) jsc.JSValue {
        return this.toTypeError(.MISSING_ARGS, "Not enough arguments to '" ++ name_ ++ "'. Expected {d}, got {d}.", .{ expected, got });
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

    pub fn reload(this: *jsc.JSGlobalObject) !void {
        this.vm().drainMicrotasks();
        this.vm().collectAsync();
        try bun.cpp.JSC__JSGlobalObject__reload(this);
    }

    pub const BunPluginTarget = enum(u8) {
        bun = 0,
        node = 1,
        browser = 2,
    };
    extern fn Bun__runOnLoadPlugins(*jsc.JSGlobalObject, ?*const bun.String, *const bun.String, BunPluginTarget) JSValue;
    extern fn Bun__runOnResolvePlugins(*jsc.JSGlobalObject, ?*const bun.String, *const bun.String, *const String, BunPluginTarget) JSValue;

    pub fn runOnLoadPlugins(this: *JSGlobalObject, namespace_: bun.String, path: bun.String, target: BunPluginTarget) bun.JSError!?JSValue {
        jsc.markBinding(@src());
        const result = try bun.jsc.fromJSHostCall(this, @src(), Bun__runOnLoadPlugins, .{ this, if (namespace_.length() > 0) &namespace_ else null, &path, target });
        if (result.isUndefinedOrNull()) return null;
        return result;
    }

    pub fn runOnResolvePlugins(this: *JSGlobalObject, namespace_: bun.String, path: bun.String, source: bun.String, target: BunPluginTarget) bun.JSError!?JSValue {
        jsc.markBinding(@src());
        const result = try bun.jsc.fromJSHostCall(this, @src(), Bun__runOnResolvePlugins, .{ this, if (namespace_.length() > 0) &namespace_ else null, &path, &source, target });
        if (result.isUndefinedOrNull()) return null;
        return result;
    }

    pub fn createErrorInstance(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) JSValue {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len > 0) {
            var stack_fallback = std.heap.stackFallback(1024 * 4, this.allocator());
            var buf = std.Io.Writer.Allocating.initCapacity(stack_fallback.get(), 2048) catch unreachable;
            defer buf.deinit();
            var writer = &buf.writer;
            writer.print(fmt, args) catch
                // if an exception occurs in the middle of formatting the error message, it's better to just return the formatting string than an error about an error
                return ZigString.static(fmt).toErrorInstance(this);

            // Ensure we clone it.
            var str = ZigString.initUTF8(buf.written());

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

    pub fn createDOMExceptionInstance(this: *JSGlobalObject, code: jsc.WebCore.DOMExceptionCode, comptime fmt: [:0]const u8, args: anytype) JSError!JSValue {
        if (comptime std.meta.fieldNames(@TypeOf(args)).len > 0) {
            var stack_fallback = std.heap.stackFallback(1024 * 4, this.allocator());
            var buf = try bun.MutableString.init2048(stack_fallback.get());
            defer buf.deinit();
            var writer = buf.writer();
            try writer.print(fmt, args);
            var str = ZigString.fromUTF8(buf.slice());
            return str.toDOMExceptionInstance(this, code);
        } else {
            return ZigString.static(fmt).toDOMExceptionInstance(this, code);
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
        err.put(this, ZigString.static("code"), ZigString.static(@tagName(jsc.Node.ErrorCode.ERR_OUT_OF_RANGE)).toJS(this));
        return err;
    }

    pub fn createInvalidArgs(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) JSValue {
        return jsc.Error.INVALID_ARG_TYPE.fmt(this, fmt, args);
    }

    pub const SysErrOptions = struct {
        code: jsc.Node.ErrorCode,
        errno: ?i32 = null,
        name: ?string = null,
    };
    pub fn throwSysError(
        this: *JSGlobalObject,
        opts: SysErrOptions,
        comptime message: [:0]const u8,
        args: anytype,
    ) JSError {
        const err = createErrorInstance(this, message, args);
        err.put(this, ZigString.static("code"), ZigString.init(@tagName(opts.code)).toJS(this));
        if (opts.name) |name| err.put(this, ZigString.static("name"), ZigString.init(name).toJS(this));
        if (opts.errno) |errno| err.put(this, ZigString.static("errno"), try .fromAny(this, i32, errno));
        return this.throwValue(err);
    }

    /// Throw an Error from a formatted string.
    ///
    /// Note: If you are throwing an error within somewhere in the Bun API,
    /// chances are you should be using `.ERR(...).throw()` instead.
    pub fn throw(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) JSError {
        const instance = this.createErrorInstance(fmt, args);
        bun.assert(instance != .zero);
        return this.throwValue(instance);
    }

    pub fn throwPretty(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) bun.JSError {
        const instance = switch (Output.enable_ansi_colors_stderr) {
            inline else => |enabled| this.createErrorInstance(Output.prettyFmt(fmt, enabled), args),
        };
        bun.assert(instance != .zero);
        return this.throwValue(instance);
    }

    extern fn JSC__JSGlobalObject__queueMicrotaskCallback(*JSGlobalObject, *anyopaque, Function: *const (fn (*anyopaque) callconv(.c) void)) void;
    pub fn queueMicrotaskCallback(
        this: *JSGlobalObject,
        ctx_val: anytype,
        comptime Function: fn (ctx: @TypeOf(ctx_val)) void,
    ) void {
        jsc.markBinding(@src());
        const Fn = Function;
        const ContextType = @TypeOf(ctx_val);
        const Wrapper = struct {
            pub fn call(p: *anyopaque) callconv(.c) void {
                Fn(bun.cast(ContextType, p));
            }
        };

        JSC__JSGlobalObject__queueMicrotaskCallback(this, ctx_val, &Wrapper.call);
    }

    pub fn queueMicrotask(this: *JSGlobalObject, function: JSValue, args: []const jsc.JSValue) void {
        this.queueMicrotaskJob(
            function,
            if (args.len > 0) args[0] else .zero,
            if (args.len > 1) args[1] else .zero,
        );
    }

    extern fn Bun__Process__emitWarning(globalObject: *JSGlobalObject, warning: JSValue, @"type": JSValue, code: JSValue, ctor: JSValue) void;
    pub fn emitWarning(globalObject: *JSGlobalObject, warning: JSValue, @"type": JSValue, code: JSValue, ctor: JSValue) JSError!void {
        return bun.jsc.fromJSHostCallGeneric(globalObject, @src(), Bun__Process__emitWarning, .{ globalObject, warning, @"type", code, ctor });
    }

    extern fn JSC__JSGlobalObject__queueMicrotaskJob(JSC__JSGlobalObject__ptr: *JSGlobalObject, JSValue, JSValue, JSValue) void;
    pub fn queueMicrotaskJob(this: *JSGlobalObject, function: JSValue, first: JSValue, second: JSValue) void {
        JSC__JSGlobalObject__queueMicrotaskJob(this, function, first, second);
    }

    pub fn throwValue(this: *JSGlobalObject, value: jsc.JSValue) JSError {
        return this.vm().throwError(this, value);
    }

    pub fn throwTypeError(this: *JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) bun.JSError {
        const instance = this.createTypeErrorInstance(fmt, args);
        return this.throwValue(instance);
    }

    pub fn throwDOMException(this: *JSGlobalObject, code: jsc.WebCore.DOMExceptionCode, comptime fmt: [:0]const u8, args: anytype) bun.JSError {
        const instance = try this.createDOMExceptionInstance(code, fmt, args);
        return this.throwValue(instance);
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
        return this.vm().throwError(this, err_value);
    }

    // TODO: delete these two fns
    pub fn ref(this: *JSGlobalObject) *JSGlobalObject {
        return this;
    }
    pub const ctx = ref;

    extern fn JSC__JSGlobalObject__createAggregateError(*JSGlobalObject, [*]const JSValue, usize, *const ZigString) JSValue;
    pub fn createAggregateError(globalObject: *JSGlobalObject, errors: []const JSValue, message: *const ZigString) bun.JSError!JSValue {
        return bun.jsc.fromJSHostCall(globalObject, @src(), JSC__JSGlobalObject__createAggregateError, .{ globalObject, errors.ptr, errors.len, message });
    }

    extern fn JSC__JSGlobalObject__createAggregateErrorWithArray(*JSGlobalObject, JSValue, bun.String, JSValue) JSValue;
    pub fn createAggregateErrorWithArray(
        globalObject: *JSGlobalObject,
        message: bun.String,
        error_array: JSValue,
    ) bun.JSError!JSValue {
        if (bun.Environment.allow_assert) bun.assert(error_array.isArray());
        return bun.jsc.fromJSHostCall(globalObject, @src(), JSC__JSGlobalObject__createAggregateErrorWithArray, .{ globalObject, error_array, message, .js_undefined });
    }

    extern fn JSC__JSGlobalObject__generateHeapSnapshot(*JSGlobalObject) JSValue;
    pub fn generateHeapSnapshot(this: *JSGlobalObject) JSValue {
        return JSC__JSGlobalObject__generateHeapSnapshot(this);
    }

    // DEPRECATED - use TopExceptionScope to check for exceptions and signal exceptions by returning JSError
    pub fn hasException(this: *JSGlobalObject) bool {
        return JSGlobalObject__hasException(this);
    }

    pub fn clearException(this: *JSGlobalObject) void {
        return JSGlobalObject__clearException(this);
    }

    /// Clear the currently active exception off the VM unless it is a
    /// termination exception.
    ///
    /// Returns `true` if the exception was cleared, `false` if it was a
    /// termination exception. Use `clearException` to unconditionally clear
    /// exceptions.
    ///
    /// It is safe to call this function when no exception is present.
    pub fn clearExceptionExceptTermination(this: *JSGlobalObject) bool {
        return JSGlobalObject__clearExceptionExceptTermination(this);
    }

    /// Clears the current exception and returns that value. Requires compile-time
    /// proof of an exception via `error.JSError`
    pub fn takeException(this: *JSGlobalObject, proof: bun.JSError) JSValue {
        switch (proof) {
            error.JSError => {},
            error.OutOfMemory => this.throwOutOfMemory() catch {},
            error.JSTerminated => {},
        }

        return this.tryTakeException() orelse {
            @panic("A JavaScript exception was thrown, but it was cleared before it could be read.");
        };
    }

    pub fn takeError(this: *JSGlobalObject, proof: bun.JSError) JSValue {
        switch (proof) {
            error.JSError => {},
            error.OutOfMemory => this.throwOutOfMemory() catch {},
            error.JSTerminated => {},
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
        const exception = this.takeException(err);
        if (!exception.isTerminationException()) {
            _ = this.bunVM().uncaughtException(this, exception, false);
        }
    }

    pub fn vm(this: *JSGlobalObject) *VM {
        return JSC__JSGlobalObject__vm(this);
    }

    pub fn deleteModuleRegistryEntry(this: *JSGlobalObject, name_: *ZigString) bun.JSError!void {
        return bun.jsc.fromJSHostCallGeneric(this, @src(), JSC__JSGlobalObject__deleteModuleRegistryEntry, .{ this, name_ });
    }

    fn bunVMUnsafe(this: *JSGlobalObject) *anyopaque {
        return JSC__JSGlobalObject__bunVM(this);
    }

    pub fn bunVM(this: *JSGlobalObject) *jsc.VirtualMachine {
        if (comptime bun.Environment.allow_assert) {
            // if this fails
            // you most likely need to run
            //   make clean-jsc-bindings
            //   make bindings -j10
            if (jsc.VirtualMachine.VMHolder.vm) |vm_| {
                bun.assert(this.bunVMUnsafe() == @as(*anyopaque, @ptrCast(vm_)));
            } else {
                @panic("This thread lacks a Bun VM");
            }
        }
        return @as(*jsc.VirtualMachine, @ptrCast(@alignCast(this.bunVMUnsafe())));
    }

    pub const ThreadKind = enum {
        main,
        other,
    };

    pub fn tryBunVM(this: *JSGlobalObject) struct { *jsc.VirtualMachine, ThreadKind } {
        const vmPtr = @as(*jsc.VirtualMachine, @ptrCast(@alignCast(this.bunVMUnsafe())));

        if (jsc.VirtualMachine.VMHolder.vm) |vm_| {
            if (comptime bun.Environment.allow_assert) {
                bun.assert(this.bunVMUnsafe() == @as(*anyopaque, @ptrCast(vm_)));
            }
        } else {
            return .{ vmPtr, .other };
        }

        return .{ vmPtr, .main };
    }

    /// We can't do the threadlocal check when queued from another thread
    pub fn bunVMConcurrently(this: *JSGlobalObject) *jsc.VirtualMachine {
        return @as(*jsc.VirtualMachine, @ptrCast(@alignCast(this.bunVMUnsafe())));
    }

    extern fn JSC__JSGlobalObject__handleRejectedPromises(*JSGlobalObject) void;
    pub fn handleRejectedPromises(this: *JSGlobalObject) void {
        return bun.jsc.fromJSHostCallGeneric(this, @src(), JSC__JSGlobalObject__handleRejectedPromises, .{this}) catch @panic("unreachable");
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
        return this.ERR(.OUT_OF_RANGE, "{f}", .{bun.fmt.outOfRange(value, options)}).throw();
    }

    pub const IntegerRange = struct {
        min: comptime_int = jsc.MIN_SAFE_INTEGER,
        max: comptime_int = jsc.MAX_SAFE_INTEGER,
        field_name: []const u8 = "",
        always_allow_zero: bool = false,
    };

    pub fn validateBigIntRange(this: *JSGlobalObject, value: JSValue, comptime T: type, default: T, comptime range: IntegerRange) bun.JSError!T {
        if (value.isUndefined() or value == .zero) {
            return 0;
        }

        const TypeInfo = @typeInfo(T);
        if (TypeInfo != .int) {
            @compileError("T must be an integer type");
        }
        const signed = TypeInfo.int.signedness == .signed;

        const min_t = comptime @max(range.min, std.math.minInt(T));
        const max_t = comptime @min(range.max, std.math.maxInt(T));
        if (value.isBigInt()) {
            if (signed) {
                if (value.isBigIntInInt64Range(min_t, max_t)) {
                    return value.toInt64();
                }
            } else {
                if (value.isBigIntInUInt64Range(min_t, max_t)) {
                    return value.toUInt64NoTruncate();
                }
            }
            return this.ERR(.OUT_OF_RANGE, "The value is out of range. It must be >= {d} and <= {d}.", .{ min_t, max_t }).throw();
        }

        return try this.validateIntegerRange(value, T, default, .{
            .min = comptime @max(min_t, jsc.MIN_SAFE_INTEGER),
            .max = comptime @min(max_t, jsc.MAX_SAFE_INTEGER),
            .field_name = range.field_name,
            .always_allow_zero = range.always_allow_zero,
        });
    }

    pub fn validateIntegerRange(this: *JSGlobalObject, value: JSValue, comptime T: type, default: T, comptime range: IntegerRange) bun.JSError!T {
        if (value.isUndefined() or value == .zero) {
            return default;
        }

        const min_t = comptime @max(range.min, std.math.minInt(T), jsc.MIN_SAFE_INTEGER);
        const max_t = comptime @min(range.max, std.math.maxInt(T), jsc.MAX_SAFE_INTEGER);

        comptime {
            if (min_t > max_t) {
                @compileError("max must be less than min");
            }

            if (max_t < min_t) {
                @compileError("max must be less than min");
            }
        }
        const field_name = comptime range.field_name;
        if (comptime field_name.len == 0) {
            @compileError("field_name must not be empty");
        }
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

    /// Get a lazily-initialized `JSC::String` from `BunCommonStrings.h`.
    pub inline fn commonStrings(this: *jsc.JSGlobalObject) CommonStrings {
        jsc.markBinding(@src());
        return .{ .globalObject = this };
    }

    /// Throw an error from within the Bun runtime.
    ///
    /// The set of errors accepted by `ERR()` is defined in `ErrorCode.ts`.
    pub fn ERR(global: *JSGlobalObject, comptime code: jsc.Error, comptime fmt: [:0]const u8, args: anytype) @import("ErrorCode").ErrorBuilder(code, fmt, @TypeOf(args)) {
        return .{ .global = global, .args = args };
    }

    extern fn JSC__JSGlobalObject__bunVM(*JSGlobalObject) *VM;
    extern fn JSC__JSGlobalObject__vm(*JSGlobalObject) *VM;
    extern fn JSC__JSGlobalObject__deleteModuleRegistryEntry(*JSGlobalObject, *const ZigString) void;
    extern fn JSGlobalObject__clearException(*JSGlobalObject) void;
    extern fn JSGlobalObject__clearExceptionExceptTermination(*JSGlobalObject) bool;
    extern fn JSGlobalObject__clearTerminationException(this: *JSGlobalObject) void;
    extern fn JSGlobalObject__hasException(*JSGlobalObject) bool;
    extern fn JSGlobalObject__setTimeZone(this: *JSGlobalObject, timeZone: *const ZigString) bool;
    extern fn JSGlobalObject__tryTakeException(*JSGlobalObject) JSValue;
    extern fn JSGlobalObject__requestTermination(this: *JSGlobalObject) void;

    extern fn Zig__GlobalObject__create(*anyopaque, i32, bool, bool, ?*anyopaque) *JSGlobalObject;
    pub fn create(
        v: *jsc.VirtualMachine,
        console: *anyopaque,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: ?*anyopaque,
    ) *JSGlobalObject {
        const trace = bun.perf.trace("JSGlobalObject.create");
        defer trace.end();

        v.eventLoop().ensureWaker();
        const global = Zig__GlobalObject__create(console, context_id, mini_mode, eval_mode, worker_ptr);

        // JSC might mess with the stack size.
        bun.StackCheck.configureThread();

        return global;
    }

    extern fn Zig__GlobalObject__getModuleRegistryMap(*JSGlobalObject) *anyopaque;
    pub fn getModuleRegistryMap(global: *JSGlobalObject) *anyopaque {
        return Zig__GlobalObject__getModuleRegistryMap(global);
    }

    extern fn Zig__GlobalObject__resetModuleRegistryMap(*JSGlobalObject, *anyopaque) bool;
    pub fn resetModuleRegistryMap(global: *JSGlobalObject, map: *anyopaque) bool {
        return Zig__GlobalObject__resetModuleRegistryMap(global, map);
    }

    pub fn resolve(res: *ErrorableString, global: *JSGlobalObject, specifier: *bun.String, source: *bun.String, query: *ZigString) callconv(.c) void {
        jsc.markBinding(@src());
        return jsc.VirtualMachine.resolve(res, global, specifier.*, source.*, query, true) catch {
            bun.debugAssert(res.success == false);
        };
    }

    pub fn reportUncaughtException(global: *JSGlobalObject, exception: *jsc.Exception) callconv(.c) JSValue {
        jsc.markBinding(@src());
        return jsc.VirtualMachine.reportUncaughtException(global, exception);
    }

    pub fn reportUncaughtExceptionFromError(global: *JSGlobalObject, proof: bun.JSError) void {
        jsc.markBinding(@src());
        _ = global.reportUncaughtException(global.takeException(proof).asException(global.vm()).?);
    }

    pub fn onCrash() callconv(.c) void {
        jsc.markBinding(@src());
        bun.Output.flush();
        @panic("A C++ exception occurred");
    }

    extern fn JSC__Wasm__StreamingCompiler__addBytes(streaming_compiler: *anyopaque, bytes_ptr: [*]const u8, bytes_len: usize) void;

    fn getBodyStreamOrBytesForWasmStreaming(
        this: *jsc.JSGlobalObject,
        response_value: jsc.JSValue,
        streaming_compiler: *anyopaque,
    ) bun.JSError!jsc.JSValue {
        const response = jsc.WebCore.Response.fromJS(response_value) orelse return this.throwInvalidArgumentTypeValue2(
            "source",
            "an instance of Response or an Promise resolving to Response",
            response_value,
        );

        const content_type = if (try response.getContentType()) |content_type|
            content_type.toZigString()
        else
            ZigString.static("null").*;

        if (!content_type.eqlComptime("application/wasm")) {
            return this.ERR(.WEBASSEMBLY_RESPONSE, "WebAssembly response has unsupported MIME type '{f}'", .{content_type}).throw();
        }

        if (!response.isOK()) {
            return this.ERR(.WEBASSEMBLY_RESPONSE, "WebAssembly response has status code {}", .{response.statusCode()}).throw();
        }

        if (response.getBodyUsed(this).toBoolean()) {
            return this.ERR(.WEBASSEMBLY_RESPONSE, "WebAssembly response body has already been used", .{}).throw();
        }

        const body = response.getBodyValue();
        if (body.* == .Error) {
            return this.throwValue(body.Error.toJS(this));
        }

        // We're done validating. From now on, deal with extracting the body.
        body.toBlobIfPossible();

        if (body.* == .Locked) {
            if (response.getBodyReadableStream(this)) |stream| {
                return stream.value;
            }
        }

        var any_blob = switch (body.*) {
            .Locked => body.tryUseAsAnyBlob() orelse return body.toReadableStream(this),
            else => body.useAsAnyBlob(),
        };

        if (any_blob.store()) |store| {
            if (store.data != .bytes) {
                // This is a file or an S3 object, which aren't accessible synchronously.
                // (using any_blob.slice() would return a bogus empty slice)

                // Logic from JSC.WebCore.Body.Value.toReadableStream
                var blob = any_blob.Blob;
                defer blob.detach();

                blob.resolveSize();
                return jsc.WebCore.ReadableStream.fromBlobCopyRef(this, &blob, blob.size);
            }
        }

        defer any_blob.detach();

        // Push the blob contents into the streaming compiler by passing a pointer and
        // length, and return null to signify this has been done.
        const slice = any_blob.slice();
        JSC__Wasm__StreamingCompiler__addBytes(streaming_compiler, slice.ptr, slice.len);

        return .null;
    }

    pub fn createError(
        globalThis: *jsc.JSGlobalObject,
        comptime fmt: string,
        args: anytype,
    ) jsc.JSValue {
        if (comptime std.meta.fields(@TypeOf(args)).len == 0) {
            var zig_str = jsc.ZigString.init(fmt);
            if (comptime !strings.isAllASCII(fmt)) {
                zig_str.markUTF16();
            }

            return zig_str.toErrorInstance(globalThis);
        } else {
            var fallback = std.heap.stackFallback(256, bun.default_allocator);
            var alloc = fallback.get();

            const buf = std.fmt.allocPrint(alloc, fmt, args) catch unreachable;
            var zig_str = jsc.ZigString.init(buf);
            zig_str.detectEncoding();
            // it alwayas clones
            const res = zig_str.toErrorInstance(globalThis);
            alloc.free(buf);
            return res;
        }
    }

    pub fn toTypeError(
        global: *jsc.JSGlobalObject,
        code: jsc.Error,
        comptime fmt: [:0]const u8,
        args: anytype,
    ) jsc.JSValue {
        return code.fmt(global, fmt, args);
    }

    pub fn toInvalidArguments(
        global: *jsc.JSGlobalObject,
        comptime fmt: [:0]const u8,
        args: anytype,
    ) jsc.JSValue {
        @branchHint(.cold);
        return jsc.Error.INVALID_ARG_TYPE.fmt(global, fmt, args);
    }

    extern fn ScriptExecutionContextIdentifier__forGlobalObject(global: *jsc.JSGlobalObject) u32;

    pub fn scriptExecutionContextIdentifier(global: *jsc.JSGlobalObject) bun.webcore.ScriptExecutionContext.Identifier {
        return @enumFromInt(ScriptExecutionContextIdentifier__forGlobalObject(global));
    }

    pub const Extern = [_][]const u8{ "create", "getModuleRegistryMap", "resetModuleRegistryMap" };

    comptime {
        @export(&resolve, .{ .name = "Zig__GlobalObject__resolve" });
        @export(&reportUncaughtException, .{ .name = "Zig__GlobalObject__reportUncaughtException" });
        @export(&onCrash, .{ .name = "Zig__GlobalObject__onCrash" });
        @export(&jsc.host_fn.wrap3(getBodyStreamOrBytesForWasmStreaming), .{ .name = "Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming" });
    }
};

const string = []const u8;

const napi = @import("../../napi/napi.zig");
const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const MutableString = bun.MutableString;
const Output = bun.Output;
const String = bun.String;
const strings = bun.strings;

const jsc = bun.jsc;
const CommonStrings = jsc.CommonStrings;
const ErrorableString = jsc.ErrorableString;
const JSValue = jsc.JSValue;
const VM = jsc.VM;
const ZigString = jsc.ZigString;
