// Re-export common utilities
pub const getDlError = @import("./ffi/common.zig").getDlError;
pub const dangerouslyRunWithoutJitProtections = @import("./ffi/common.zig").dangerouslyRunWithoutJitProtections;
pub const Offsets = @import("./ffi/common.zig").Offsets;

// Re-export sub-modules
pub const StringArray = @import("./ffi/string_array.zig").StringArray;
pub const SymbolsMap = @import("./ffi/symbols_map.zig").SymbolsMap;
pub const ABIType = @import("./ffi/abi_type.zig").ABIType;
pub const CompilerRT = @import("./ffi/compiler_rt.zig").CompilerRT;
pub const CompileC = @import("./ffi/compile.zig").CompileC;
pub const Function = @import("./ffi/function.zig").Function;

const debug = Output.scoped(.TCC, .visible);

pub const FFI = struct {
    pub const js = jsc.Codegen.JSFFI;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    dylib: ?std.DynLib = null,
    relocated_bytes_to_free: ?[]u8 = null,
    functions: bun.StringArrayHashMapUnmanaged(Function) = .{},
    closed: bool = false,
    shared_state: ?*TCC.State = null,

    pub fn finalize(_: *FFI) callconv(.C) void {}

    pub fn Bun__FFI__cc(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(1).slice();
        if (arguments.len == 0 or !arguments[0].isObject()) {
            return globalThis.throwInvalidArguments("Expected object", .{});
        }
        const allocator = bun.default_allocator;

        // Step 1. compile the user's code

        const object = arguments[0];

        var compile_c = CompileC{};
        defer {
            if (globalThis.hasException()) {
                compile_c.deinit();
            }
        }

        const symbols_object: JSValue = try object.getOwn(globalThis, "symbols") orelse .js_undefined;
        if (!globalThis.hasException() and (symbols_object == .zero or !symbols_object.isObject())) {
            return globalThis.throwInvalidArgumentTypeValue("symbols", "object", symbols_object);
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        // SAFETY: already checked that symbols_object is an object
        if (try generateSymbols(globalThis, allocator, &compile_c.symbols.map, symbols_object.getObject().?)) |val| {
            if (val != .zero and !globalThis.hasException())
                return globalThis.throwValue(val);
            return error.JSError;
        }

        if (compile_c.symbols.map.count() == 0) {
            return globalThis.throw("Expected at least one exported symbol", .{});
        }

        if (try object.getOwn(globalThis, "library")) |library_value| {
            compile_c.libraries = try StringArray.fromJS(globalThis, library_value, "library");
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try object.getTruthy(globalThis, "flags")) |flags_value| {
            if (flags_value.isArray()) {
                var iter = try flags_value.arrayIterator(globalThis);

                var flags = std.ArrayList(u8).init(allocator);
                defer flags.deinit();
                bun.handleOom(flags.appendSlice(CompileC.default_tcc_options));

                while (try iter.next()) |value| {
                    if (!value.isString()) {
                        return globalThis.throwInvalidArgumentTypeValue("flags", "array of strings", value);
                    }
                    const slice = try value.toSlice(globalThis, allocator);
                    if (slice.len == 0) continue;
                    defer slice.deinit();
                    bun.handleOom(flags.append(' '));
                    bun.handleOom(flags.appendSlice(slice.slice()));
                }
                bun.handleOom(flags.append(0));
                compile_c.flags = flags.items[0 .. flags.items.len - 1 :0];
                flags = std.ArrayList(u8).init(allocator);
            } else {
                if (!flags_value.isString()) {
                    return globalThis.throwInvalidArgumentTypeValue("flags", "string", flags_value);
                }

                const str = try flags_value.getZigString(globalThis);
                if (!str.isEmpty()) {
                    compile_c.flags = bun.handleOom(str.toOwnedSliceZ(allocator));
                }
            }
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try object.getTruthy(globalThis, "define")) |define_value| {
            if (define_value.getObject()) |define_obj| {
                const Iter = jsc.JSPropertyIterator(.{ .include_value = true, .skip_empty_name = true });
                var iter = try Iter.init(globalThis, define_obj);
                defer iter.deinit();
                while (try iter.next()) |entry| {
                    const key = bun.handleOom(entry.toOwnedSliceZ(allocator));
                    var owned_value: [:0]const u8 = "";
                    if (!iter.value.isUndefinedOrNull()) {
                        if (iter.value.isString()) {
                            const value = try iter.value.getZigString(globalThis);
                            if (value.len > 0) {
                                owned_value = bun.handleOom(value.toOwnedSliceZ(allocator));
                            }
                        }
                    }
                    if (globalThis.hasException()) {
                        allocator.free(key);
                        return error.JSError;
                    }

                    bun.handleOom(compile_c.define.append(allocator, .{ key, owned_value }));
                }
            }
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try object.getTruthy(globalThis, "include")) |include_value| {
            compile_c.include_dirs = try StringArray.fromJS(globalThis, include_value, "include");
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (try object.getOwn(globalThis, "source")) |source_value| {
            if (source_value.isArray()) {
                compile_c.source = .{ .files = .{} };
                var iter = try source_value.arrayIterator(globalThis);
                while (try iter.next()) |value| {
                    if (!value.isString()) {
                        return globalThis.throwInvalidArgumentTypeValue("source", "array of strings", value);
                    }
                    try compile_c.source.files.append(bun.default_allocator, try (try value.getZigString(globalThis)).toOwnedSliceZ(bun.default_allocator));
                }
            } else if (!source_value.isString()) {
                return globalThis.throwInvalidArgumentTypeValue("source", "string", source_value);
            } else {
                const source_path = try (try source_value.getZigString(globalThis)).toOwnedSliceZ(bun.default_allocator);
                compile_c.source.file = source_path;
            }
        }

        if (globalThis.hasException()) {
            return error.JSError;
        }

        // Now we compile the code with tinycc.
        var tcc_state: ?*TCC.State, var bytes_to_free_on_error = compile_c.compile(globalThis) catch |err| {
            switch (err) {
                error.DeferredErrors => {
                    var combined = std.ArrayList(u8).init(bun.default_allocator);
                    defer combined.deinit();
                    var writer = combined.writer();
                    bun.handleOom(writer.print("{d} errors while compiling {s}\n", .{ compile_c.deferred_errors.items.len, if (compile_c.current_file_for_errors.len > 0) compile_c.current_file_for_errors else compile_c.source.first() }));

                    for (compile_c.deferred_errors.items) |deferred_error| {
                        bun.handleOom(writer.print("{s}\n", .{deferred_error}));
                    }

                    return globalThis.throw("{s}", .{combined.items});
                },
                error.JSError => |e| return e,
                error.OutOfMemory => |e| return e,
                error.JSTerminated => |e| return e,
            }
        };
        defer {
            if (tcc_state) |state| state.deinit();

            // TODO: upgrade tinycc because they improved the way memory management works for this
            // we are unable to free memory safely in certain cases here.
        }

        const napi_env = makeNapiEnvIfNeeded(compile_c.symbols.map.values(), globalThis);

        var obj = jsc.JSValue.createEmptyObject(globalThis, compile_c.symbols.map.count());
        for (compile_c.symbols.map.values()) |*function| {
            const function_name = function.base_name.?;

            function.compile(napi_env) catch |err| {
                if (!globalThis.hasException()) {
                    const ret = globalThis.toInvalidArguments("{s} when translating symbol \"{s}\"", .{
                        @errorName(err),
                        function_name,
                    });
                    return globalThis.throwValue(ret);
                }
                return error.JSError;
            };
            switch (function.step) {
                .failed => |err| {
                    const res = ZigString.init(err.msg).toErrorInstance(globalThis);
                    return globalThis.throwValue(res);
                },
                .pending => {
                    return globalThis.throw("Failed to compile (nothing happend!)", .{});
                },
                .compiled => |*compiled| {
                    const str = ZigString.init(bun.asByteSlice(function_name));
                    const cb = jsc.host_fn.NewRuntimeFunction(
                        globalThis,
                        &str,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(*const jsc.JSHostFn, compiled.ptr),
                        false,
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;
                    obj.put(globalThis, &str, cb);
                },
            }
        }

        // TODO: pub const new = bun.TrivialNew(FFI)
        var lib = bun.handleOom(bun.default_allocator.create(FFI));
        lib.* = .{
            .dylib = null,
            .shared_state = tcc_state,
            .functions = compile_c.symbols.map,
            .relocated_bytes_to_free = bytes_to_free_on_error,
        };
        tcc_state = null;
        bytes_to_free_on_error = "";
        compile_c.symbols = .{};

        const js_object = lib.toJS(globalThis);
        jsc.Codegen.JSFFI.symbolsValueSetCached(js_object, globalThis, obj);
        return js_object;
    }

    pub fn closeCallback(globalThis: *JSGlobalObject, ctx: JSValue) JSValue {
        var function: *Function = @ptrFromInt(ctx.asPtrAddress());
        function.deinit(globalThis);
        return .js_undefined;
    }

    pub fn callback(globalThis: *JSGlobalObject, interface: jsc.JSValue, js_callback: jsc.JSValue) bun.JSError!JSValue {
        jsc.markBinding(@src());
        if (!interface.isObject()) {
            return globalThis.toInvalidArguments("Expected object", .{});
        }

        if (js_callback.isEmptyOrUndefinedOrNull() or !js_callback.isCallable()) {
            return globalThis.toInvalidArguments("Expected callback function", .{});
        }

        const allocator = VirtualMachine.get().allocator;
        var function: Function = .{ .allocator = allocator };
        var func = &function;

        if (generateSymbolForFunction(globalThis, allocator, interface, func) catch ZigString.init("Out of memory").toErrorInstance(globalThis)) |val| {
            return val;
        }

        // TODO: WeakRefHandle that automatically frees it?
        func.base_name = "";
        js_callback.ensureStillAlive();

        func.compileCallback(globalThis, js_callback, func.threadsafe) catch return ZigString.init("Out of memory").toErrorInstance(globalThis);
        switch (func.step) {
            .failed => |err| {
                const message = ZigString.init(err.msg).toErrorInstance(globalThis);

                func.deinit(globalThis);

                return message;
            },
            .pending => {
                func.deinit(globalThis);
                return ZigString.init("Failed to compile, but not sure why. Please report this bug").toErrorInstance(globalThis);
            },
            .compiled => {
                const function_ = bun.default_allocator.create(Function) catch unreachable;
                function_.* = func.*;
                return JSValue.createObject2(
                    globalThis,
                    ZigString.static("ptr"),
                    ZigString.static("ctx"),
                    jsc.JSValue.fromPtrAddress(@intFromPtr(function_.step.compiled.ptr)),
                    jsc.JSValue.fromPtrAddress(@intFromPtr(function_)),
                );
            },
        }
    }

    pub fn close(
        this: *FFI,
        globalThis: *jsc.JSGlobalObject,
        _: *jsc.CallFrame,
    ) bun.JSError!JSValue {
        jsc.markBinding(@src());
        if (this.closed) {
            return .js_undefined;
        }
        this.closed = true;
        if (this.dylib) |*dylib| {
            dylib.close();
            this.dylib = null;
        }

        if (this.shared_state) |state| {
            this.shared_state = null;
            state.deinit();
        }

        const allocator = VirtualMachine.get().allocator;

        for (this.functions.values()) |*val| {
            val.deinit(globalThis);
        }
        this.functions.deinit(allocator);

        // NOTE: `relocated_bytes_to_free` points to a memory region that was
        // relocated by tinycc. Attempts to free it will cause a bus error,
        // even if jit protections are disabled.
        // if (this.relocated_bytes_to_free) |relocated_bytes_to_free| {
        //     this.relocated_bytes_to_free = null;
        //     bun.default_allocator.free(relocated_bytes_to_free);
        // }

        return .js_undefined;
    }

    pub fn printCallback(global: *JSGlobalObject, object: jsc.JSValue) JSValue {
        jsc.markBinding(@src());
        const allocator = VirtualMachine.get().allocator;

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return global.toInvalidArguments("Expected an object", .{});
        }

        var function: Function = .{ .allocator = allocator };
        if (generateSymbolForFunction(global, allocator, object, &function) catch ZigString.init("Out of memory").toErrorInstance(global)) |val| {
            return val;
        }

        var arraylist = std.ArrayList(u8).init(allocator);
        defer arraylist.deinit();
        var writer = arraylist.writer();

        function.base_name = "my_callback_function";

        function.printCallbackSourceCode(null, null, &writer) catch {
            return ZigString.init("Error while printing code").toErrorInstance(global);
        };
        return ZigString.init(arraylist.items).toJS(global);
    }

    pub fn print(global: *JSGlobalObject, object: jsc.JSValue, is_callback_val: ?jsc.JSValue) bun.JSError!JSValue {
        const allocator = bun.default_allocator;
        if (is_callback_val) |is_callback| {
            if (is_callback.toBoolean()) {
                return printCallback(global, object);
            }
        }

        if (object.isEmptyOrUndefinedOrNull()) return invalidOptionsArg(global);
        const obj = object.getObject() orelse return invalidOptionsArg(global);

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, bun.default_allocator, &symbols, obj) catch jsc.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(@constCast(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        jsc.markBinding(@src());
        var strs = bun.handleOom(std.ArrayList(bun.String).initCapacity(allocator, symbols.count()));
        defer {
            for (strs.items) |str| {
                str.deref();
            }
            strs.deinit();
        }
        for (symbols.values()) |*function| {
            var arraylist = std.ArrayList(u8).init(allocator);
            var writer = arraylist.writer();
            function.printSourceCode(&writer) catch {
                // an error while generating source code
                for (symbols.keys()) |key| {
                    allocator.free(@constCast(key));
                }
                for (symbols.values()) |*function_| {
                    function_.arg_types.deinit(allocator);
                }

                symbols.clearAndFree(allocator);
                return ZigString.init("Error while printing code").toErrorInstance(global);
            };
            strs.appendAssumeCapacity(bun.String.cloneUTF8(arraylist.items));
        }

        const ret = try bun.String.toJSArray(global, strs.items);

        for (symbols.keys()) |key| {
            allocator.free(@constCast(key));
        }
        for (symbols.values()) |*function_| {
            function_.arg_types.deinit(allocator);
            if (function_.step == .compiled) {
                allocator.free(function_.step.compiled.buf);
            }
        }
        symbols.clearAndFree(allocator);

        return ret;
    }

    /// Creates an Exception object indicating that options object is invalid.
    /// The exception is not thrown on the VM.
    fn invalidOptionsArg(global: *JSGlobalObject) JSValue {
        return global.toInvalidArguments("Expected an options object with symbol names", .{});
    }

    pub fn open(global: *JSGlobalObject, name_str: ZigString, object_value: jsc.JSValue) jsc.JSValue {
        jsc.markBinding(@src());
        const vm = VirtualMachine.get();
        var name_slice = name_str.toSlice(bun.default_allocator);
        defer name_slice.deinit();

        if (object_value.isEmptyOrUndefinedOrNull()) return invalidOptionsArg(global);
        const object = object_value.getObject() orelse return invalidOptionsArg(global);

        var filepath_buf: bun.PathBuffer = undefined;
        const name = brk: {
            if (jsc.ModuleLoader.resolveEmbeddedFile(
                vm,
                name_slice.slice(),
                switch (Environment.os) {
                    .linux => "so",
                    .mac => "dylib",
                    .windows => "dll",
                    else => @compileError("TODO"),
                },
            )) |resolved| {
                @memcpy(filepath_buf[0..resolved.len], resolved);
                filepath_buf[resolved.len] = 0;
                break :brk filepath_buf[0..resolved.len];
            }

            break :brk name_slice.slice();
        };

        if (name.len == 0) {
            return global.toInvalidArguments("Invalid library name", .{});
        }

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, bun.default_allocator, &symbols, object) catch jsc.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                bun.default_allocator.free(@constCast(key));
            }
            symbols.clearAndFree(bun.default_allocator);
            return val;
        }
        if (symbols.count() == 0) {
            return global.toInvalidArguments("Expected at least one symbol", .{});
        }

        var dylib: std.DynLib = brk: {
            // First try using the name directly
            break :brk std.DynLib.open(name) catch {
                const backup_name = Fs.FileSystem.instance.abs(&[1]string{name});
                // if that fails, try resolving the filepath relative to the current working directory
                break :brk std.DynLib.open(backup_name) catch {
                    // Then, if that fails, report an error with the library name and system error
                    const dlerror_buf = getDlError(bun.default_allocator) catch null;
                    defer if (dlerror_buf) |buf| bun.default_allocator.free(buf);
                    const dlerror_msg = dlerror_buf orelse "unknown error";

                    const msg = bun.handleOom(std.fmt.allocPrint(
                        bun.default_allocator,
                        "Failed to open library \"{s}\": {s}",
                        .{ name, dlerror_msg },
                    ));
                    defer bun.default_allocator.free(msg);
                    const system_error = jsc.SystemError{
                        .code = bun.String.cloneUTF8(@tagName(.ERR_DLOPEN_FAILED)),
                        .message = bun.String.cloneUTF8(msg),
                        .syscall = bun.String.cloneUTF8("dlopen"),
                    };
                    return system_error.toErrorInstance(global);
                };
            };
        };

        var size = symbols.values().len;
        if (size >= 63) {
            size = 0;
        }
        var obj = jsc.JSValue.createEmptyObject(global, size);
        obj.protect();
        defer obj.unprotect();

        const napi_env = makeNapiEnvIfNeeded(symbols.values(), global);

        for (symbols.values()) |*function| {
            const function_name = function.base_name.?;

            // optional if the user passed "ptr"
            if (function.symbol_from_dynamic_library == null) {
                const resolved_symbol = dylib.lookup(*anyopaque, function_name) orelse {
                    const ret = global.toInvalidArguments("Symbol \"{s}\" not found in \"{s}\"", .{ bun.asByteSlice(function_name), name });
                    for (symbols.values()) |*value| {
                        bun.default_allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(bun.default_allocator);
                    }
                    symbols.clearAndFree(bun.default_allocator);
                    dylib.close();
                    return ret;
                };

                function.symbol_from_dynamic_library = resolved_symbol;
            }

            function.compile(napi_env) catch |err| {
                const ret = global.toInvalidArguments("{s} when compiling symbol \"{s}\" in \"{s}\"", .{
                    bun.asByteSlice(@errorName(err)),
                    bun.asByteSlice(function_name),
                    name,
                });
                for (symbols.values()) |*value| {
                    value.deinit(global);
                }
                symbols.clearAndFree(bun.default_allocator);
                dylib.close();
                return ret;
            };
            switch (function.step) {
                .failed => |err| {
                    defer for (symbols.values()) |*other_function| {
                        other_function.deinit(global);
                    };

                    const res = ZigString.init(err.msg).toErrorInstance(global);
                    symbols.clearAndFree(bun.default_allocator);
                    dylib.close();
                    return res;
                },
                .pending => {
                    for (symbols.values()) |*other_function| {
                        other_function.deinit(global);
                    }
                    symbols.clearAndFree(bun.default_allocator);
                    dylib.close();
                    return ZigString.init("Failed to compile (nothing happend!)").toErrorInstance(global);
                },
                .compiled => |*compiled| {
                    const str = ZigString.init(bun.asByteSlice(function_name));
                    const cb = jsc.host_fn.NewRuntimeFunction(
                        global,
                        &str,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(*const jsc.JSHostFn, compiled.ptr),
                        false,
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;
                    obj.put(global, &str, cb);
                },
            }
        }

        const lib = bun.new(FFI, .{
            .dylib = dylib,
            .functions = symbols,
        });

        const js_object = lib.toJS(global);
        jsc.Codegen.JSFFI.symbolsValueSetCached(js_object, global, obj);
        return js_object;
    }

    pub fn getSymbols(_: *FFI, _: *jsc.JSGlobalObject) jsc.JSValue {
        // This shouldn't be called. The cachedValue is what should be called.
        return .js_undefined;
    }

    pub fn linkSymbols(global: *JSGlobalObject, object_value: jsc.JSValue) jsc.JSValue {
        jsc.markBinding(@src());
        const allocator = VirtualMachine.get().allocator;

        if (object_value.isEmptyOrUndefinedOrNull()) return invalidOptionsArg(global);
        const object = object_value.getObject() orelse return invalidOptionsArg(global);

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, allocator, &symbols, object) catch jsc.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(@constCast(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        if (symbols.count() == 0) {
            return global.toInvalidArguments("Expected at least one symbol", .{});
        }

        var obj = JSValue.createEmptyObject(global, symbols.count());
        obj.ensureStillAlive();
        defer obj.ensureStillAlive();

        const napi_env = makeNapiEnvIfNeeded(symbols.values(), global);

        for (symbols.values()) |*function| {
            const function_name = function.base_name.?;

            if (function.symbol_from_dynamic_library == null) {
                const ret = global.toInvalidArguments("Symbol \"{s}\" is missing a \"ptr\" field. When using linkSymbols() or CFunction(), you must provide a \"ptr\" field with the memory address of the native function.", .{bun.asByteSlice(function_name)});
                for (symbols.values()) |*value| {
                    allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                return ret;
            }

            function.compile(napi_env) catch |err| {
                const ret = global.toInvalidArguments("{s} when compiling symbol \"{s}\"", .{
                    bun.asByteSlice(@errorName(err)),
                    bun.asByteSlice(function_name),
                });
                for (symbols.values()) |*value| {
                    value.deinit(global);
                }
                symbols.clearAndFree(allocator);
                return ret;
            };
            switch (function.step) {
                .failed => |err| {
                    for (symbols.values()) |*value| {
                        allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }

                    const res = ZigString.init(err.msg).toErrorInstance(global);
                    function.deinit(global);
                    symbols.clearAndFree(allocator);
                    return res;
                },
                .pending => {
                    for (symbols.values()) |*value| {
                        allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }
                    symbols.clearAndFree(allocator);
                    return ZigString.static("Failed to compile (nothing happend!)").toErrorInstance(global);
                },
                .compiled => |*compiled| {
                    const name = &ZigString.init(bun.asByteSlice(function_name));

                    const cb = jsc.host_fn.NewRuntimeFunction(
                        global,
                        name,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(*jsc.JSHostFn, compiled.ptr),
                        false,
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;

                    obj.put(global, name, cb);
                },
            }
        }

        const lib = bun.new(FFI, .{
            .dylib = null,
            .functions = symbols,
        });

        const js_object = lib.toJS(global);
        jsc.Codegen.JSFFI.symbolsValueSetCached(js_object, global, obj);
        return js_object;
    }
    pub fn generateSymbolForFunction(global: *JSGlobalObject, allocator: std.mem.Allocator, value: jsc.JSValue, function: *Function) bun.JSError!?JSValue {
        jsc.markBinding(@src());

        var abi_types = std.ArrayListUnmanaged(ABIType){};

        if (try value.getOwn(global, "args")) |args| {
            if (args.isEmptyOrUndefinedOrNull() or !args.jsType().isArray()) {
                return ZigString.static("Expected an object with \"args\" as an array").toErrorInstance(global);
            }

            var array = try args.arrayIterator(global);

            try abi_types.ensureTotalCapacityPrecise(allocator, array.len);
            while (try array.next()) |val| {
                if (val.isEmptyOrUndefinedOrNull()) {
                    abi_types.clearAndFree(allocator);
                    return ZigString.static("param must be a string (type name) or number").toErrorInstance(global);
                }

                if (val.isAnyInt()) {
                    const int = val.to(i32);
                    switch (int) {
                        0...ABIType.max => {
                            abi_types.appendAssumeCapacity(@as(ABIType, @enumFromInt(int)));
                            continue;
                        },
                        else => {
                            abi_types.clearAndFree(allocator);
                            return ZigString.static("invalid ABI type").toErrorInstance(global);
                        },
                    }
                }

                if (!val.jsType().isStringLike()) {
                    abi_types.clearAndFree(allocator);
                    return ZigString.static("param must be a string (type name) or number").toErrorInstance(global);
                }

                var type_name = try val.toSlice(global, allocator);
                defer type_name.deinit();
                abi_types.appendAssumeCapacity(ABIType.label.get(type_name.slice()) orelse {
                    abi_types.clearAndFree(allocator);
                    return global.toTypeError(.INVALID_ARG_VALUE, "Unknown type {s}", .{type_name.slice()});
                });
            }
        }
        // var function
        var return_type = ABIType.void;

        var threadsafe = false;

        if (try value.getTruthy(global, "threadsafe")) |threadsafe_value| {
            threadsafe = threadsafe_value.toBoolean();
        }

        if (try value.getTruthy(global, "returns")) |ret_value| brk: {
            if (ret_value.isAnyInt()) {
                const int = ret_value.toInt32();
                switch (int) {
                    0...ABIType.max => {
                        return_type = @as(ABIType, @enumFromInt(int));
                        break :brk;
                    },
                    else => {
                        abi_types.clearAndFree(allocator);
                        return ZigString.static("invalid ABI type").toErrorInstance(global);
                    },
                }
            }

            var ret_slice = try ret_value.toSlice(global, allocator);
            defer ret_slice.deinit();
            return_type = ABIType.label.get(ret_slice.slice()) orelse {
                abi_types.clearAndFree(allocator);
                return global.toTypeError(.INVALID_ARG_VALUE, "Unknown return type {s}", .{ret_slice.slice()});
            };
        }

        if (return_type == ABIType.napi_env) {
            abi_types.clearAndFree(allocator);
            return ZigString.static("Cannot return napi_env to JavaScript").toErrorInstance(global);
        }

        if (return_type == .buffer) {
            abi_types.clearAndFree(allocator);
            return ZigString.static("Cannot return a buffer to JavaScript (since byteLength and byteOffset are unknown)").toErrorInstance(global);
        }

        if (function.threadsafe and return_type != ABIType.void) {
            abi_types.clearAndFree(allocator);
            return ZigString.static("Threadsafe functions must return void").toErrorInstance(global);
        }

        function.* = Function{
            .base_name = null,
            .arg_types = abi_types,
            .return_type = return_type,
            .threadsafe = threadsafe,
            .allocator = allocator,
        };

        if (try value.get(global, "ptr")) |ptr| {
            if (ptr.isNumber()) {
                const num = ptr.asPtrAddress();
                if (num > 0)
                    function.symbol_from_dynamic_library = @as(*anyopaque, @ptrFromInt(num));
            } else {
                const num = ptr.toUInt64NoTruncate();
                if (num > 0) {
                    function.symbol_from_dynamic_library = @as(*anyopaque, @ptrFromInt(num));
                }
            }
        }

        return null;
    }

    pub fn generateSymbols(global: *JSGlobalObject, allocator: Allocator, symbols: *bun.StringArrayHashMapUnmanaged(Function), object: *jsc.JSObject) bun.JSError!?JSValue {
        jsc.markBinding(@src());

        var symbols_iter = try jsc.JSPropertyIterator(.{
            .skip_empty_name = true,

            .include_value = true,
        }).init(global, object);
        defer symbols_iter.deinit();

        try symbols.ensureTotalCapacity(allocator, symbols_iter.len);

        while (try symbols_iter.next()) |prop| {
            const value = symbols_iter.value;

            if (value.isEmptyOrUndefinedOrNull()) {
                return global.toTypeError(.INVALID_ARG_VALUE, "Expected an object for key \"{any}\"", .{prop});
            }

            var function: Function = .{ .allocator = allocator };
            if (try generateSymbolForFunction(global, allocator, value, &function)) |val| {
                return val;
            }
            function.base_name = try prop.toOwnedSliceZ(allocator);

            symbols.putAssumeCapacity(bun.asByteSlice(function.base_name.?), function);
        }

        return null;
    }
};

pub const Bun__FFI__cc = FFI.Bun__FFI__cc;

fn makeNapiEnvIfNeeded(functions: []const Function, globalThis: *JSGlobalObject) ?*napi.NapiEnv {
    for (functions) |function| {
        if (function.needsNapiEnv()) {
            return globalThis.makeNapiEnvForFFI();
        }
    }

    return null;
}

const string = []const u8;

const Fs = @import("../../fs.zig");
const TCC = @import("../../deps/tcc.zig");
const napi = @import("../../napi/napi.zig");
const options = @import("../../options.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const VM = bun.jsc.VM;
const VirtualMachine = jsc.VirtualMachine;
const ZigString = bun.jsc.ZigString;
