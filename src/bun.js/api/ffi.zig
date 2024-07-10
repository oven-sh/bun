const Bun = @This();
const root = @import("root");
const default_allocator = bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;

const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const MutableString = bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");

const MacroEntryPoint = bun.bundler.MacroEntryPoint;
const logger = bun.logger;
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = bun.Bundler;
const ServerEntryPoint = bun.bundler.ServerEntryPoint;
const js_printer = bun.js_printer;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = bun.JSC.ZigString;
const Runtime = @import("../../runtime.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = bun.bundler.ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;
const WebCore = bun.JSC.WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = bun.JSC.C;
const JSC = bun.JSC;
const JSError = @import("../base.zig").JSError;

const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = bun.JSC.JSValue;

const JSGlobalObject = bun.JSC.JSGlobalObject;
const ExceptionValueRef = bun.JSC.ExceptionValueRef;
const JSPrivateDataPtr = bun.JSC.JSPrivateDataPtr;
const ConsoleObject = bun.JSC.ConsoleObject;
const Node = bun.JSC.Node;
const ZigException = bun.JSC.ZigException;
const ZigStackTrace = bun.JSC.ZigStackTrace;
const ErrorableResolvedSource = bun.JSC.ErrorableResolvedSource;
const ResolvedSource = bun.JSC.ResolvedSource;
const JSPromise = bun.JSC.JSPromise;
const JSInternalPromise = bun.JSC.JSInternalPromise;
const JSModuleLoader = bun.JSC.JSModuleLoader;
const JSPromiseRejectionOperation = bun.JSC.JSPromiseRejectionOperation;
const Exception = bun.JSC.Exception;
const ErrorableZigString = bun.JSC.ErrorableZigString;
const ZigGlobalObject = bun.JSC.ZigGlobalObject;
const VM = bun.JSC.VM;
const JSFunction = bun.JSC.JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../url.zig").URL;
const VirtualMachine = JSC.VirtualMachine;
const IOTask = JSC.IOTask;

const TCC = @import("../../tcc.zig");

pub const FFI = struct {
    dylib: ?std.DynLib = null,
    functions: bun.StringArrayHashMapUnmanaged(Function) = .{},
    closed: bool = false,

    pub usingnamespace JSC.Codegen.JSFFI;

    pub fn finalize(_: *FFI) callconv(.C) void {}

    pub fn closeCallback(globalThis: *JSGlobalObject, ctx: JSValue) JSValue {
        var function = ctx.asPtr(Function);
        function.deinit(globalThis, bun.default_allocator);
        return JSValue.jsUndefined();
    }

    pub fn callback(globalThis: *JSGlobalObject, interface: JSC.JSValue, js_callback: JSC.JSValue) JSValue {
        JSC.markBinding(@src());
        if (!interface.isObject()) {
            return JSC.toInvalidArguments("Expected object", .{}, globalThis);
        }

        if (js_callback.isEmptyOrUndefinedOrNull() or !js_callback.isCallable(globalThis.vm())) {
            return JSC.toInvalidArguments("Expected callback function", .{}, globalThis);
        }

        const allocator = VirtualMachine.get().allocator;
        var function: Function = .{};
        var func = &function;

        if (generateSymbolForFunction(globalThis, allocator, interface, func) catch ZigString.init("Out of memory").toErrorInstance(globalThis)) |val| {
            return val;
        }

        // TODO: WeakRefHandle that automatically frees it?
        func.base_name = "";
        js_callback.ensureStillAlive();

        func.compileCallback(allocator, globalThis, js_callback, func.threadsafe) catch return ZigString.init("Out of memory").toErrorInstance(globalThis);
        switch (func.step) {
            .failed => |err| {
                const message = ZigString.init(err.msg).toErrorInstance(globalThis);

                func.deinit(globalThis, allocator);

                return message;
            },
            .pending => {
                func.deinit(globalThis, allocator);
                return ZigString.init("Failed to compile, but not sure why. Please report this bug").toErrorInstance(globalThis);
            },
            .compiled => {
                const function_ = bun.default_allocator.create(Function) catch unreachable;
                function_.* = func.*;
                return JSValue.createObject2(
                    globalThis,
                    ZigString.static("ptr"),
                    ZigString.static("ctx"),
                    JSC.JSValue.fromPtrAddress(@intFromPtr(function_.step.compiled.ptr)),
                    JSC.JSValue.fromPtrAddress(@intFromPtr(function_)),
                );
            },
        }
    }

    pub fn close(
        this: *FFI,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        JSC.markBinding(@src());
        if (this.closed) {
            return JSC.JSValue.jsUndefined();
        }
        this.closed = true;
        if (this.dylib) |*dylib| {
            dylib.close();
            this.dylib = null;
        }

        const allocator = VirtualMachine.get().allocator;

        for (this.functions.values()) |*val| {
            val.deinit(globalThis, allocator);
        }
        this.functions.deinit(allocator);

        return JSC.JSValue.jsUndefined();
    }

    pub fn printCallback(global: *JSGlobalObject, object: JSC.JSValue) JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.get().allocator;

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an object", .{}, global);
        }

        var function: Function = .{};
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

    pub fn print(global: *JSGlobalObject, object: JSC.JSValue, is_callback_val: ?JSC.JSValue) JSValue {
        const allocator = VirtualMachine.get().allocator;
        if (is_callback_val) |is_callback| {
            if (is_callback.toBoolean()) {
                return printCallback(global, object);
            }
        }

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
        }

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(@constCast(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        JSC.markBinding(@src());
        var zig_strings = allocator.alloc(ZigString, symbols.count()) catch unreachable;
        for (symbols.values(), 0..) |*function, i| {
            var arraylist = std.ArrayList(u8).init(allocator);
            var writer = arraylist.writer();
            function.printSourceCode(&writer) catch {
                // an error while generating source code
                for (symbols.keys()) |key| {
                    allocator.free(@constCast(key));
                }
                for (zig_strings) |zig_string| {
                    allocator.free(@constCast(zig_string.slice()));
                }
                for (symbols.values()) |*function_| {
                    function_.arg_types.deinit(allocator);
                }

                symbols.clearAndFree(allocator);
                return ZigString.init("Error while printing code").toErrorInstance(global);
            };
            zig_strings[i] = ZigString.init(arraylist.items);
        }

        const ret = JSC.JSValue.createStringArray(global, zig_strings.ptr, zig_strings.len, true);

        for (symbols.keys()) |key| {
            allocator.free(@constCast(key));
        }
        for (zig_strings) |zig_string| {
            allocator.free(@constCast(zig_string.slice()));
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

    // pub fn dlcompile(global: *JSGlobalObject, object: JSC.JSValue) JSValue {
    //     const allocator = VirtualMachine.get().allocator;

    //     if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
    //         return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
    //     }

    //     var symbols = bun.StringArrayHashMapUnmanaged(Function){};
    //     if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
    //         // an error while validating symbols
    //         for (symbols.keys()) |key| {
    //             allocator.free(@constCast(key));
    //         }
    //         symbols.clearAndFree(allocator);
    //         return val;
    //     }

    // }

    pub fn open(global: *JSGlobalObject, name_str: ZigString, object: JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        const vm = VirtualMachine.get();
        const allocator = bun.default_allocator;
        var name_slice = name_str.toSlice(allocator);
        defer name_slice.deinit();

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
        }

        var filepath_buf: bun.PathBuffer = undefined;
        const name = brk: {
            if (JSC.ModuleLoader.resolveEmbeddedFile(
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
            return JSC.toInvalidArguments("Invalid library name", .{}, global);
        }

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(@constCast(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        if (symbols.count() == 0) {
            return JSC.toInvalidArguments("Expected at least one symbol", .{}, global);
        }

        var dylib: std.DynLib = brk: {
            // First try using the name directly
            break :brk std.DynLib.open(name) catch {
                const backup_name = Fs.FileSystem.instance.abs(&[1]string{name});
                // if that fails, try resolving the filepath relative to the current working directory
                break :brk std.DynLib.open(backup_name) catch {
                    // Then, if that fails, report an error.
                    const system_error = JSC.SystemError{
                        .code = bun.String.createUTF8(@tagName(JSC.Node.ErrorCode.ERR_DLOPEN_FAILED)),
                        .message = bun.String.createUTF8("Failed to open library. This is usually caused by a missing library or an invalid library path."),
                        .syscall = bun.String.createUTF8("dlopen"),
                    };
                    return system_error.toErrorInstance(global);
                };
            };
        };

        var size = symbols.values().len;
        if (size >= 63) {
            size = 0;
        }
        var obj = JSC.JSValue.createEmptyObject(global, size);
        obj.protect();
        defer obj.unprotect();
        for (symbols.values()) |*function| {
            const function_name = function.base_name.?;

            // optional if the user passed "ptr"
            if (function.symbol_from_dynamic_library == null) {
                const resolved_symbol = dylib.lookup(*anyopaque, function_name) orelse {
                    const ret = JSC.toInvalidArguments("Symbol \"{s}\" not found in \"{s}\"", .{ bun.asByteSlice(function_name), name }, global);
                    for (symbols.values()) |*value| {
                        allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }
                    symbols.clearAndFree(allocator);
                    dylib.close();
                    return ret;
                };

                function.symbol_from_dynamic_library = resolved_symbol;
            }

            function.compile(allocator) catch |err| {
                const ret = JSC.toInvalidArguments("{s} when compiling symbol \"{s}\" in \"{s}\"", .{
                    bun.asByteSlice(@errorName(err)),
                    bun.asByteSlice(function_name),
                    name,
                }, global);
                for (symbols.values()) |*value| {
                    allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                dylib.close();
                return ret;
            };
            switch (function.step) {
                .failed => |err| {
                    for (symbols.values()) |*value| {
                        allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }

                    const res = ZigString.init(err.msg).toErrorInstance(global);
                    function.deinit(global, allocator);
                    symbols.clearAndFree(allocator);
                    dylib.close();
                    return res;
                },
                .pending => {
                    for (symbols.values()) |*value| {
                        allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }
                    symbols.clearAndFree(allocator);
                    dylib.close();
                    return ZigString.init("Failed to compile (nothing happend!)").toErrorInstance(global);
                },
                .compiled => |*compiled| {
                    const str = ZigString.init(bun.asByteSlice(function_name));
                    const cb = JSC.NewRuntimeFunction(
                        global,
                        &str,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(JSC.JSHostFunctionPtr, compiled.ptr),
                        false,
                        true,
                    );
                    compiled.js_function = cb;
                    obj.put(global, &str, cb);
                },
            }
        }

        var lib = allocator.create(FFI) catch unreachable;
        lib.* = .{
            .dylib = dylib,
            .functions = symbols,
        };

        const js_object = lib.toJS(global);
        JSC.Codegen.JSFFI.symbolsValueSetCached(js_object, global, obj);
        return js_object;
    }

    pub fn getSymbols(_: *FFI, _: *JSC.JSGlobalObject) JSC.JSValue {
        // This shouldn't be called. The cachedValue is what should be called.
        return .undefined;
    }

    pub fn linkSymbols(global: *JSGlobalObject, object: JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.get().allocator;

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
        }

        var symbols = bun.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(@constCast(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        if (symbols.count() == 0) {
            return JSC.toInvalidArguments("Expected at least one symbol", .{}, global);
        }

        var obj = JSValue.createEmptyObject(global, symbols.count());
        obj.ensureStillAlive();
        defer obj.ensureStillAlive();
        for (symbols.values()) |*function| {
            const function_name = function.base_name.?;

            if (function.symbol_from_dynamic_library == null) {
                const ret = JSC.toInvalidArguments("Symbol for \"{s}\" not found", .{bun.asByteSlice(function_name)}, global);
                for (symbols.values()) |*value| {
                    allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                return ret;
            }

            function.compile(allocator) catch |err| {
                const ret = JSC.toInvalidArguments("{s} when compiling symbol \"{s}\"", .{
                    bun.asByteSlice(@errorName(err)),
                    bun.asByteSlice(function_name),
                }, global);
                for (symbols.values()) |*value| {
                    allocator.free(@constCast(bun.asByteSlice(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
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
                    function.deinit(global, allocator);
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

                    const cb = JSC.NewRuntimeFunction(
                        global,
                        name,
                        @as(u32, @intCast(function.arg_types.items.len)),
                        bun.cast(JSC.JSHostFunctionPtr, compiled.ptr),
                        false,
                        true,
                    );
                    compiled.js_function = cb;

                    obj.put(global, name, cb);
                },
            }
        }

        var lib = allocator.create(FFI) catch unreachable;
        lib.* = .{
            .dylib = null,
            .functions = symbols,
        };

        const js_object = lib.toJS(global);
        JSC.Codegen.JSFFI.symbolsValueSetCached(js_object, global, obj);
        return js_object;
    }
    pub fn generateSymbolForFunction(global: *JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue, function: *Function) !?JSValue {
        JSC.markBinding(@src());

        var abi_types = std.ArrayListUnmanaged(ABIType){};

        if (value.get(global, "args")) |args| {
            if (args.isEmptyOrUndefinedOrNull() or !args.jsType().isArray()) {
                return ZigString.static("Expected an object with \"args\" as an array").toErrorInstance(global);
            }

            var array = args.arrayIterator(global);

            try abi_types.ensureTotalCapacityPrecise(allocator, array.len);
            while (array.next()) |val| {
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

                var type_name = val.toSlice(global, allocator);
                defer type_name.deinit();
                abi_types.appendAssumeCapacity(ABIType.label.get(type_name.slice()) orelse {
                    abi_types.clearAndFree(allocator);
                    return JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_VALUE, "Unknown type {s}", .{type_name.slice()}, global);
                });
            }
        }
        // var function
        var return_type = ABIType.void;

        var threadsafe = false;

        if (value.get(global, "threadsafe")) |threadsafe_value| {
            threadsafe = threadsafe_value.toBoolean();
        }

        if (value.get(global, "returns")) |ret_value| brk: {
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

            var ret_slice = ret_value.toSlice(global, allocator);
            defer ret_slice.deinit();
            return_type = ABIType.label.get(ret_slice.slice()) orelse {
                abi_types.clearAndFree(allocator);
                return JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_VALUE, "Unknown return type {s}", .{ret_slice.slice()}, global);
            };
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
        };

        if (value.get(global, "ptr")) |ptr| {
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
    pub fn generateSymbols(global: *JSGlobalObject, symbols: *bun.StringArrayHashMapUnmanaged(Function), object: JSC.JSValue) !?JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.get().allocator;

        var symbols_iter = JSC.JSPropertyIterator(.{
            .skip_empty_name = true,

            .include_value = true,
        }).init(global, object);
        defer symbols_iter.deinit();

        try symbols.ensureTotalCapacity(allocator, symbols_iter.len);

        while (symbols_iter.next()) |prop| {
            const value = symbols_iter.value;

            if (value.isEmptyOrUndefinedOrNull()) {
                return JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_VALUE, "Expected an object for key \"{any}\"", .{prop}, global);
            }

            var function: Function = .{};
            if (try generateSymbolForFunction(global, allocator, value, &function)) |val| {
                return val;
            }
            function.base_name = try prop.toOwnedSliceZ(allocator);

            symbols.putAssumeCapacity(bun.asByteSlice(function.base_name.?), function);
        }

        return null;
    }

    pub const Function = struct {
        symbol_from_dynamic_library: ?*anyopaque = null,
        base_name: ?[:0]const u8 = null,
        state: ?*TCC.TCCState = null,

        return_type: ABIType = ABIType.void,
        arg_types: std.ArrayListUnmanaged(ABIType) = .{},
        step: Step = Step{ .pending = {} },
        threadsafe: bool = false,

        pub var lib_dirZ: [*:0]const u8 = "";

        extern "C" fn FFICallbackFunctionWrapper_destroy(*anyopaque) void;

        pub fn deinit(val: *Function, globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator) void {
            JSC.markBinding(@src());

            if (val.base_name) |base_name| {
                if (bun.asByteSlice(base_name).len > 0) {
                    allocator.free(@constCast(bun.asByteSlice(base_name)));
                }
            }

            val.arg_types.clearAndFree(allocator);

            if (val.state) |state| {
                TCC.tcc_delete(state);
                val.state = null;
            }

            if (val.step == .compiled) {
                // allocator.free(val.step.compiled.buf);
                if (val.step.compiled.js_function != .zero) {
                    _ = globalThis;
                    // _ = JSC.untrackFunction(globalThis, val.step.compiled.js_function);
                    val.step.compiled.js_function = .zero;
                }

                if (val.step.compiled.ffi_callback_function_wrapper) |wrapper| {
                    FFICallbackFunctionWrapper_destroy(wrapper);
                    val.step.compiled.ffi_callback_function_wrapper = null;
                }
            }

            if (val.step == .failed and val.step.failed.allocated) {
                allocator.free(val.step.failed.msg);
            }
        }

        pub const Step = union(enum) {
            pending: void,
            compiled: struct {
                ptr: *anyopaque,
                buf: []u8,
                js_function: JSValue = JSValue.zero,
                js_context: ?*anyopaque = null,
                ffi_callback_function_wrapper: ?*anyopaque = null,
            },
            failed: struct {
                msg: []const u8,
                allocated: bool = false,
            },
        };

        const FFI_HEADER: string = @embedFile("./FFI.h");
        pub inline fn ffiHeader() string {
            if (comptime Environment.isDebug) {
                const dirpath = comptime bun.Environment.base_path ++ (bun.Dirname.dirname(u8, @src().file) orelse "");
                var buf: bun.PathBuffer = undefined;
                const user = bun.getUserName(&buf) orelse "";
                const dir = std.mem.replaceOwned(
                    u8,
                    default_allocator,
                    dirpath,
                    "jarred",
                    user,
                ) catch unreachable;
                const runtime_path = std.fs.path.join(default_allocator, &[_]string{ dir, "FFI.h" }) catch unreachable;
                const file = std.fs.openFileAbsolute(runtime_path, .{}) catch @panic("Missing bun/src/bun.js/api/FFI.h.");
                defer file.close();
                return file.readToEndAlloc(default_allocator, file.getEndPos() catch unreachable) catch unreachable;
            } else {
                return FFI_HEADER;
            }
        }

        pub fn handleTCCError(ctx: ?*anyopaque, message: [*c]const u8) callconv(.C) void {
            var this = bun.cast(*Function, ctx.?);
            var msg = std.mem.span(message);
            if (msg.len > 0) {
                var offset: usize = 0;
                // the message we get from TCC sometimes has garbage in it
                // i think because we're doing in-memory compilation
                while (offset < msg.len) : (offset += 1) {
                    if (msg[offset] > 0x20 and msg[offset] < 0x7f) break;
                }
                msg = msg[offset..];
            }

            this.step = .{ .failed = .{ .msg = VirtualMachine.get().allocator.dupe(u8, msg) catch unreachable, .allocated = true } };
        }

        extern fn pthread_jit_write_protect_np(enable: bool) callconv(.C) void;

        const MyFunctionSStructWorkAround = struct {
            JSVALUE_TO_INT64: *const fn (JSValue0: JSC.JSValue) callconv(.C) i64,
            JSVALUE_TO_UINT64: *const fn (JSValue0: JSC.JSValue) callconv(.C) u64,
            INT64_TO_JSVALUE: *const fn (arg0: *JSC.JSGlobalObject, arg1: i64) callconv(.C) JSC.JSValue,
            UINT64_TO_JSVALUE: *const fn (arg0: *JSC.JSGlobalObject, arg1: u64) callconv(.C) JSC.JSValue,
            bun_call: *const @TypeOf(JSC.C.JSObjectCallAsFunction),
        };
        const headers = @import("../bindings/headers.zig");
        var workaround: MyFunctionSStructWorkAround = if (!JSC.is_bindgen) .{
            .JSVALUE_TO_INT64 = headers.JSC__JSValue__toInt64,
            .JSVALUE_TO_UINT64 = headers.JSC__JSValue__toUInt64NoTruncate,
            .INT64_TO_JSVALUE = headers.JSC__JSValue__fromInt64NoTruncate,
            .UINT64_TO_JSVALUE = headers.JSC__JSValue__fromUInt64NoTruncate,
            .bun_call = &JSC.C.JSObjectCallAsFunction,
        } else undefined;

        const tcc_options = "-std=c11 -nostdlib -Wl,--export-all-symbols" ++ if (Environment.isDebug) " -g" else "";

        pub fn compile(
            this: *Function,
            allocator: std.mem.Allocator,
        ) !void {
            var source_code = std.ArrayList(u8).init(allocator);
            var source_code_writer = source_code.writer();
            try this.printSourceCode(&source_code_writer);

            try source_code.append(0);
            defer source_code.deinit();

            const state = TCC.tcc_new() orelse return error.TCCMissing;
            TCC.tcc_set_options(state, tcc_options);
            // addSharedLibPaths(state);
            TCC.tcc_set_error_func(state, this, handleTCCError);
            this.state = state;
            defer {
                if (this.step == .failed) {
                    TCC.tcc_delete(state);
                    this.state = null;
                }
            }

            _ = TCC.tcc_set_output_type(state, TCC.TCC_OUTPUT_MEMORY);
            const Sizes = @import("../bindings/sizes.zig");

            var symbol_buf: [256]u8 = undefined;
            TCC.tcc_define_symbol(
                state,
                "Bun_FFI_PointerOffsetToArgumentsList",
                std.fmt.bufPrintZ(&symbol_buf, "{d}", .{Sizes.Bun_FFI_PointerOffsetToArgumentsList}) catch unreachable,
            );
            CompilerRT.define(state);

            // TCC.tcc_define_symbol(
            //     state,
            //     "Bun_FFI_PointerOffsetToArgumentsCount",
            //     std.fmt.bufPrintZ(symbol_buf[8..], "{d}", .{Bun_FFI_PointerOffsetToArgumentsCount}) catch unreachable,
            // );

            const compilation_result = TCC.tcc_compile_string(
                state,
                source_code.items.ptr,
            );
            // did tcc report an error?
            if (this.step == .failed) {
                return;
            }

            // did tcc report failure but never called the error callback?
            if (compilation_result == -1) {
                this.step = .{ .failed = .{ .msg = "tcc returned -1, which means it failed" } };
                return;
            }
            CompilerRT.inject(state);
            _ = TCC.tcc_add_symbol(state, this.base_name.?, this.symbol_from_dynamic_library.?);

            if (this.step == .failed) {
                return;
            }

            const relocation_size = TCC.tcc_relocate(state, null);
            if (this.step == .failed) {
                return;
            }

            if (relocation_size < 0) {
                if (this.step != .failed)
                    this.step = .{ .failed = .{ .msg = "tcc_relocate returned a negative value" } };
                return;
            }

            const bytes: []u8 = try allocator.alloc(u8, @as(usize, @intCast(relocation_size)));
            defer {
                if (this.step == .failed) {
                    allocator.free(bytes);
                }
            }

            if (comptime Environment.isAarch64 and Environment.isMac) {
                pthread_jit_write_protect_np(false);
            }
            _ = TCC.tcc_relocate(state, bytes.ptr);
            if (comptime Environment.isAarch64 and Environment.isMac) {
                pthread_jit_write_protect_np(true);
            }

            const symbol = TCC.tcc_get_symbol(state, "JSFunctionCall") orelse {
                this.step = .{ .failed = .{ .msg = "missing generated symbol in source code" } };

                return;
            };

            this.step = .{
                .compiled = .{
                    .ptr = symbol,
                    .buf = bytes,
                },
            };
            return;
        }
        const CompilerRT = struct {
            noinline fn memset(
                dest: [*]u8,
                c: u8,
                byte_count: usize,
            ) callconv(.C) void {
                @memset(dest[0..byte_count], c);
            }

            noinline fn memcpy(
                noalias dest: [*]u8,
                noalias source: [*]const u8,
                byte_count: usize,
            ) callconv(.C) void {
                @memcpy(dest[0..byte_count], source[0..byte_count]);
            }

            pub fn define(state: *TCC.TCCState) void {
                if (comptime Environment.isX64) {
                    _ = TCC.tcc_define_symbol(state, "NEEDS_COMPILER_RT_FUNCTIONS", "1");
                    // there
                    _ = TCC.tcc_compile_string(state, @embedFile(("libtcc1.c")));
                }
            }

            pub fn inject(state: *TCC.TCCState) void {
                JSC.markBinding(@src());
                _ = TCC.tcc_add_symbol(state, "memset", &memset);
                _ = TCC.tcc_add_symbol(state, "memcpy", &memcpy);

                _ = TCC.tcc_add_symbol(
                    state,
                    "JSVALUE_TO_INT64_SLOW",
                    workaround.JSVALUE_TO_INT64,
                );
                _ = TCC.tcc_add_symbol(
                    state,
                    "JSVALUE_TO_UINT64_SLOW",
                    workaround.JSVALUE_TO_UINT64,
                );
                if (!comptime JSC.is_bindgen) {
                    std.mem.doNotOptimizeAway(headers.JSC__JSValue__toUInt64NoTruncate);
                    std.mem.doNotOptimizeAway(headers.JSC__JSValue__toInt64);
                    std.mem.doNotOptimizeAway(headers.JSC__JSValue__fromInt64NoTruncate);
                    std.mem.doNotOptimizeAway(headers.JSC__JSValue__fromUInt64NoTruncate);
                }
                _ = TCC.tcc_add_symbol(
                    state,
                    "INT64_TO_JSVALUE_SLOW",
                    workaround.INT64_TO_JSVALUE,
                );
                _ = TCC.tcc_add_symbol(
                    state,
                    "UINT64_TO_JSVALUE_SLOW",
                    workaround.UINT64_TO_JSVALUE,
                );
            }
        };

        pub fn compileCallback(
            this: *Function,
            allocator: std.mem.Allocator,
            js_context: *JSC.JSGlobalObject,
            js_function: JSValue,
            is_threadsafe: bool,
        ) !void {
            JSC.markBinding(@src());
            var source_code = std.ArrayList(u8).init(allocator);
            var source_code_writer = source_code.writer();
            const ffi_wrapper = Bun__createFFICallbackFunction(js_context, js_function);
            try this.printCallbackSourceCode(js_context, ffi_wrapper, &source_code_writer);

            if (comptime Environment.isDebug and Environment.isPosix) {
                debug_write: {
                    const fd = std.posix.open("/tmp/bun-ffi-callback-source.c", .{ .CREAT = true, .ACCMODE = .WRONLY }, 0o644) catch break :debug_write;
                    _ = std.posix.write(fd, source_code.items) catch break :debug_write;
                    std.posix.ftruncate(fd, source_code.items.len) catch break :debug_write;
                    std.posix.close(fd);
                }
            }

            try source_code.append(0);
            // defer source_code.deinit();
            const state = TCC.tcc_new() orelse return error.TCCMissing;
            TCC.tcc_set_options(state, tcc_options);
            TCC.tcc_set_error_func(state, this, handleTCCError);
            this.state = state;
            defer {
                if (this.step == .failed) {
                    TCC.tcc_delete(state);
                    this.state = null;
                }
            }

            _ = TCC.tcc_set_output_type(state, TCC.TCC_OUTPUT_MEMORY);

            CompilerRT.define(state);

            const compilation_result = TCC.tcc_compile_string(
                state,
                source_code.items.ptr,
            );
            // did tcc report an error?
            if (this.step == .failed) {
                return;
            }

            // did tcc report failure but never called the error callback?
            if (compilation_result == -1) {
                this.step = .{ .failed = .{ .msg = "tcc returned -1, which means it failed" } };

                return;
            }

            CompilerRT.inject(state);
            _ = TCC.tcc_add_symbol(
                state,
                "FFI_Callback_call",
                // TODO: stage2 - make these ptrs
                if (is_threadsafe)
                    FFI_Callback_threadsafe_call
                else switch (this.arg_types.items.len) {
                    0 => FFI_Callback_call_0,
                    1 => FFI_Callback_call_1,
                    2 => FFI_Callback_call_2,
                    3 => FFI_Callback_call_3,
                    4 => FFI_Callback_call_4,
                    5 => FFI_Callback_call_5,
                    6 => FFI_Callback_call_6,
                    7 => FFI_Callback_call_7,
                    else => FFI_Callback_call,
                },
            );
            const relocation_size = TCC.tcc_relocate(state, null);

            if (relocation_size < 0) {
                if (this.step != .failed)
                    this.step = .{ .failed = .{ .msg = "tcc_relocate returned a negative value" } };
                return;
            }

            const bytes: []u8 = try allocator.alloc(u8, @as(usize, @intCast(relocation_size)));
            defer {
                if (this.step == .failed) {
                    allocator.free(bytes);
                }
            }

            if (comptime Environment.isAarch64 and Environment.isMac) {
                pthread_jit_write_protect_np(false);
            }
            _ = TCC.tcc_relocate(state, bytes.ptr);
            if (comptime Environment.isAarch64 and Environment.isMac) {
                pthread_jit_write_protect_np(true);
            }

            const symbol = TCC.tcc_get_symbol(state, "my_callback_function") orelse {
                this.step = .{ .failed = .{ .msg = "missing generated symbol in source code" } };

                return;
            };

            this.step = .{
                .compiled = .{
                    .ptr = symbol,
                    .buf = bytes,
                    .js_function = js_function,
                    .js_context = js_context,
                    .ffi_callback_function_wrapper = ffi_wrapper,
                },
            };
        }

        pub fn printSourceCode(
            this: *Function,
            writer: anytype,
        ) !void {
            if (this.arg_types.items.len > 0) {
                try writer.writeAll("#define HAS_ARGUMENTS\n");
            }

            brk: {
                if (this.return_type.isFloatingPoint()) {
                    try writer.writeAll("#define USES_FLOAT 1\n");
                    break :brk;
                }

                for (this.arg_types.items) |arg| {
                    // conditionally include math.h
                    if (arg.isFloatingPoint()) {
                        try writer.writeAll("#define USES_FLOAT 1\n");
                        break;
                    }
                }
            }

            if (comptime Environment.isRelease) {
                try writer.writeAll(bun.asByteSlice(FFI_HEADER));
            } else {
                try writer.writeAll(ffiHeader());
            }

            // -- Generate the FFI function symbol
            try writer.writeAll("/* --- The Function To Call */\n");
            try this.return_type.typename(writer);
            try writer.writeAll(" ");
            try writer.writeAll(bun.asByteSlice(this.base_name.?));
            try writer.writeAll("(");
            var first = true;
            for (this.arg_types.items, 0..) |arg, i| {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;
                try arg.paramTypename(writer);
                try writer.print(" arg{d}", .{i});
            }
            try writer.writeAll(
                \\);
                \\
                \\/* ---- Your Wrapper Function ---- */
                \\ZIG_REPR_TYPE JSFunctionCall(void* JS_GLOBAL_OBJECT, void* callFrame) {
                \\
            );

            if (this.arg_types.items.len > 0) {
                try writer.writeAll(
                    \\  LOAD_ARGUMENTS_FROM_CALL_FRAME;
                    \\
                );
                for (this.arg_types.items, 0..) |arg, i| {
                    if (arg.needsACastInC()) {
                        if (i < this.arg_types.items.len - 1) {
                            try writer.print(
                                \\  EncodedJSValue arg{d};
                                \\  arg{d}.asInt64 = *argsPtr++;
                                \\
                            ,
                                .{
                                    i,
                                    i,
                                },
                            );
                        } else {
                            try writer.print(
                                \\  EncodedJSValue arg{d};
                                \\  arg{d}.asInt64 = *argsPtr;
                                \\
                            ,
                                .{
                                    i,
                                    i,
                                },
                            );
                        }
                    } else {
                        if (i < this.arg_types.items.len - 1) {
                            try writer.print(
                                \\  int64_t arg{d} = *argsPtr++;
                                \\
                            ,
                                .{
                                    i,
                                },
                            );
                        } else {
                            try writer.print(
                                \\  int64_t arg{d} = *argsPtr;
                                \\
                            ,
                                .{
                                    i,
                                },
                            );
                        }
                    }
                }
            }

            // try writer.writeAll(
            //     "(JSContext ctx, void* function, void* thisObject, size_t argumentCount, const EncodedJSValue arguments[], void* exception);\n\n",
            // );

            var arg_buf: [512]u8 = undefined;

            try writer.writeAll("    ");
            if (!(this.return_type == .void)) {
                try this.return_type.typename(writer);
                try writer.writeAll(" return_value = ");
            }
            try writer.print("{s}(", .{bun.asByteSlice(this.base_name.?)});
            first = true;
            arg_buf[0..3].* = "arg".*;
            for (this.arg_types.items, 0..) |arg, i| {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;
                try writer.writeAll("    ");

                const lengthBuf = std.fmt.bufPrintIntToSlice(arg_buf["arg".len..], i, 10, .lower, .{});
                const argName = arg_buf[0 .. 3 + lengthBuf.len];
                if (arg.needsACastInC()) {
                    try writer.print("{any}", .{arg.toC(argName)});
                } else {
                    try writer.writeAll(argName);
                }
            }
            try writer.writeAll(");\n");

            if (!first) try writer.writeAll("\n");

            try writer.writeAll("    ");

            try writer.writeAll("return ");

            if (!(this.return_type == .void)) {
                try writer.print("{any}.asZigRepr", .{this.return_type.toJS("return_value")});
            } else {
                try writer.writeAll("ValueUndefined.asZigRepr");
            }

            try writer.writeAll(";\n}\n\n");
        }

        extern fn FFI_Callback_call(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_0(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_1(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_2(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_3(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_4(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_5(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_threadsafe_call(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_6(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn FFI_Callback_call_7(*anyopaque, usize, [*]JSValue) JSValue;
        extern fn Bun__createFFICallbackFunction(*JSC.JSGlobalObject, JSValue) *anyopaque;

        pub fn printCallbackSourceCode(
            this: *Function,
            globalObject: ?*JSC.JSGlobalObject,
            context_ptr: ?*anyopaque,
            writer: anytype,
        ) !void {
            {
                const ptr = @intFromPtr(globalObject);
                const fmt = bun.fmt.hexIntUpper(ptr);
                try writer.print("#define JS_GLOBAL_OBJECT (void*)0x{any}ULL\n", .{fmt});
            }

            try writer.writeAll("#define IS_CALLBACK 1\n");

            brk: {
                if (this.return_type.isFloatingPoint()) {
                    try writer.writeAll("#define USES_FLOAT 1\n");
                    break :brk;
                }

                for (this.arg_types.items) |arg| {
                    // conditionally include math.h
                    if (arg.isFloatingPoint()) {
                        try writer.writeAll("#define USES_FLOAT 1\n");
                        break;
                    }
                }
            }

            if (comptime Environment.isRelease) {
                try writer.writeAll(bun.asByteSlice(FFI_HEADER));
            } else {
                try writer.writeAll(ffiHeader());
            }

            // -- Generate the FFI function symbol
            try writer.writeAll("\n \n/* --- The Callback Function */\n");
            var first = true;
            try this.return_type.typename(writer);

            try writer.writeAll(" my_callback_function");
            try writer.writeAll("(");
            for (this.arg_types.items, 0..) |arg, i| {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;
                try arg.typename(writer);
                try writer.print(" arg{d}", .{i});
            }
            try writer.writeAll(") {\n");

            if (comptime Environment.isDebug) {
                try writer.writeAll("#ifdef INJECT_BEFORE\n");
                try writer.writeAll("INJECT_BEFORE;\n");
                try writer.writeAll("#endif\n");
            }

            first = true;

            if (this.arg_types.items.len > 0) {
                var arg_buf: [512]u8 = undefined;
                try writer.print(" ZIG_REPR_TYPE arguments[{d}];\n", .{this.arg_types.items.len});

                arg_buf[0.."arg".len].* = "arg".*;
                for (this.arg_types.items, 0..) |arg, i| {
                    const printed = std.fmt.bufPrintIntToSlice(arg_buf["arg".len..], i, 10, .lower, .{});
                    const arg_name = arg_buf[0 .. "arg".len + printed.len];
                    try writer.print("arguments[{d}] = {any}.asZigRepr;\n", .{ i, arg.toJS(arg_name) });
                }
            }

            try writer.writeAll("  ");
            var inner_buf_: [372]u8 = undefined;
            var inner_buf: []u8 = &.{};

            {
                const ptr = @intFromPtr(context_ptr);
                const fmt = bun.fmt.hexIntUpper(ptr);

                if (this.arg_types.items.len > 0) {
                    inner_buf = try std.fmt.bufPrint(
                        inner_buf_[1..],
                        "FFI_Callback_call((void*)0x{any}ULL, {d}, arguments)",
                        .{ fmt, this.arg_types.items.len },
                    );
                } else {
                    inner_buf = try std.fmt.bufPrint(
                        inner_buf_[1..],
                        "FFI_Callback_call((void*)0x{any}ULL, 0, (ZIG_REPR_TYPE*)0)",
                        .{
                            fmt,
                        },
                    );
                }
            }

            if (this.return_type == .void) {
                try writer.writeAll(inner_buf);
            } else {
                const len = inner_buf.len + 1;
                inner_buf = inner_buf_[0..len];
                inner_buf[0] = '_';
                try writer.print("return {s}", .{this.return_type.toCExact(inner_buf)});
            }

            try writer.writeAll(";\n}\n\n");
        }
    };

    // Must be kept in sync with JSFFIFunction.h version
    pub const ABIType = enum(i32) {
        char = 0,

        int8_t = 1,
        uint8_t = 2,

        int16_t = 3,
        uint16_t = 4,

        int32_t = 5,
        uint32_t = 6,

        int64_t = 7,
        uint64_t = 8,

        double = 9,
        float = 10,

        bool = 11,

        ptr = 12,

        void = 13,

        cstring = 14,

        i64_fast = 15,
        u64_fast = 16,

        function = 17,

        pub const max = @intFromEnum(ABIType.function);

        /// Types that we can directly pass through as an `int64_t`
        pub fn needsACastInC(this: ABIType) bool {
            return switch (this) {
                .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t, .uint32_t => false,
                else => true,
            };
        }

        const map = .{
            .{ "bool", ABIType.bool },
            .{ "c_int", ABIType.int32_t },
            .{ "c_uint", ABIType.uint32_t },
            .{ "char", ABIType.char },
            .{ "char*", ABIType.ptr },
            .{ "double", ABIType.double },
            .{ "f32", ABIType.float },
            .{ "f64", ABIType.double },
            .{ "float", ABIType.float },
            .{ "i16", ABIType.int16_t },
            .{ "i32", ABIType.int32_t },
            .{ "i64", ABIType.int64_t },
            .{ "i8", ABIType.int8_t },
            .{ "int", ABIType.int32_t },
            .{ "int16_t", ABIType.int16_t },
            .{ "int32_t", ABIType.int32_t },
            .{ "int64_t", ABIType.int64_t },
            .{ "int8_t", ABIType.int8_t },
            .{ "isize", ABIType.int64_t },
            .{ "u16", ABIType.uint16_t },
            .{ "u32", ABIType.uint32_t },
            .{ "u64", ABIType.uint64_t },
            .{ "u8", ABIType.uint8_t },
            .{ "uint16_t", ABIType.uint16_t },
            .{ "uint32_t", ABIType.uint32_t },
            .{ "uint64_t", ABIType.uint64_t },
            .{ "uint8_t", ABIType.uint8_t },
            .{ "usize", ABIType.uint64_t },
            .{ "void*", ABIType.ptr },
            .{ "ptr", ABIType.ptr },
            .{ "pointer", ABIType.ptr },
            .{ "void", ABIType.void },
            .{ "cstring", ABIType.cstring },
            .{ "i64_fast", ABIType.i64_fast },
            .{ "u64_fast", ABIType.u64_fast },
            .{ "function", ABIType.function },
            .{ "callback", ABIType.function },
            .{ "fn", ABIType.function },
        };
        pub const label = bun.ComptimeStringMap(ABIType, map);
        const EnumMapFormatter = struct {
            name: []const u8,
            entry: ABIType,
            pub fn format(self: EnumMapFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                try writer.writeAll("['");
                // these are not all valid identifiers
                try writer.writeAll(self.name);
                try writer.writeAll("']:");
                try std.fmt.formatInt(@intFromEnum(self.entry), 10, .lower, .{}, writer);
                try writer.writeAll(",'");
                try std.fmt.formatInt(@intFromEnum(self.entry), 10, .lower, .{}, writer);
                try writer.writeAll("':");
                try std.fmt.formatInt(@intFromEnum(self.entry), 10, .lower, .{}, writer);
            }
        };
        pub const map_to_js_object = brk: {
            var count: usize = 2;
            for (map, 0..) |item, i| {
                const fmt = EnumMapFormatter{ .name = item.@"0", .entry = item.@"1" };
                count += std.fmt.count("{}", .{fmt});
                count += @intFromBool(i > 0);
            }

            var buf: [count]u8 = undefined;
            buf[0] = '{';
            buf[buf.len - 1] = '}';
            var end: usize = 1;
            for (map, 0..) |item, i| {
                const fmt = EnumMapFormatter{ .name = item.@"0", .entry = item.@"1" };
                if (i > 0) {
                    buf[end] = ',';
                    end += 1;
                }
                end += (std.fmt.bufPrint(buf[end..], "{}", .{fmt}) catch unreachable).len;
            }

            break :brk buf;
        };

        pub fn isFloatingPoint(this: ABIType) bool {
            return switch (this) {
                .double, .float => true,
                else => false,
            };
        }

        const ToCFormatter = struct {
            symbol: string,
            tag: ABIType,
            exact: bool = false,

            pub fn format(self: ToCFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                switch (self.tag) {
                    .void => {
                        return;
                    },
                    .bool => {
                        if (self.exact)
                            try writer.writeAll("(bool)");
                        try writer.writeAll("JSVALUE_TO_BOOL(");
                    },
                    .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t, .uint32_t => {
                        if (self.exact)
                            try writer.print("({s})", .{bun.asByteSlice(@tagName(self.tag))});

                        try writer.writeAll("JSVALUE_TO_INT32(");
                    },
                    .i64_fast, .int64_t => {
                        if (self.exact)
                            try writer.writeAll("(int64_t)");
                        try writer.writeAll("JSVALUE_TO_INT64(");
                    },
                    .u64_fast, .uint64_t => {
                        if (self.exact)
                            try writer.writeAll("(uint64_t)");
                        try writer.writeAll("JSVALUE_TO_UINT64(");
                    },
                    .function, .cstring, .ptr => {
                        if (self.exact)
                            try writer.writeAll("(void*)");
                        try writer.writeAll("JSVALUE_TO_PTR(");
                    },
                    .double => {
                        if (self.exact)
                            try writer.writeAll("(double)");
                        try writer.writeAll("JSVALUE_TO_DOUBLE(");
                    },
                    .float => {
                        if (self.exact)
                            try writer.writeAll("(float)");
                        try writer.writeAll("JSVALUE_TO_FLOAT(");
                    },
                }
                // if (self.fromi64) {
                //     try writer.writeAll("EncodedJSValue{ ");
                // }
                try writer.writeAll(self.symbol);
                // if (self.fromi64) {
                //     try writer.writeAll(", }");
                // }
                try writer.writeAll(")");
            }
        };

        const ToJSFormatter = struct {
            symbol: []const u8,
            tag: ABIType,

            pub fn format(self: ToJSFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                switch (self.tag) {
                    .void => {},
                    .bool => {
                        try writer.print("BOOLEAN_TO_JSVALUE({s})", .{self.symbol});
                    },
                    .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t => {
                        try writer.print("INT32_TO_JSVALUE((int32_t){s})", .{self.symbol});
                    },
                    .uint32_t => {
                        try writer.print("UINT32_TO_JSVALUE({s})", .{self.symbol});
                    },
                    .i64_fast => {
                        try writer.print("INT64_TO_JSVALUE(JS_GLOBAL_OBJECT, (int64_t){s})", .{self.symbol});
                    },
                    .int64_t => {
                        try writer.print("INT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {s})", .{self.symbol});
                    },
                    .u64_fast => {
                        try writer.print("UINT64_TO_JSVALUE(JS_GLOBAL_OBJECT, {s})", .{self.symbol});
                    },
                    .uint64_t => {
                        try writer.print("UINT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {s})", .{self.symbol});
                    },
                    .function, .cstring, .ptr => {
                        try writer.print("PTR_TO_JSVALUE({s})", .{self.symbol});
                    },
                    .double => {
                        try writer.print("DOUBLE_TO_JSVALUE({s})", .{self.symbol});
                    },
                    .float => {
                        try writer.print("FLOAT_TO_JSVALUE({s})", .{self.symbol});
                    },
                }
            }
        };

        pub fn toC(this: ABIType, symbol: string) ToCFormatter {
            return ToCFormatter{ .tag = this, .symbol = symbol };
        }

        pub fn toCExact(this: ABIType, symbol: string) ToCFormatter {
            return ToCFormatter{ .tag = this, .symbol = symbol, .exact = true };
        }

        pub fn toJS(
            this: ABIType,
            symbol: string,
        ) ToJSFormatter {
            return ToJSFormatter{
                .tag = this,
                .symbol = symbol,
            };
        }

        pub fn typename(this: ABIType, writer: anytype) !void {
            try writer.writeAll(this.typenameLabel());
        }

        pub fn typenameLabel(this: ABIType) []const u8 {
            return switch (this) {
                .function, .cstring, .ptr => "void*",
                .bool => "bool",
                .int8_t => "int8_t",
                .uint8_t => "uint8_t",
                .int16_t => "int16_t",
                .uint16_t => "uint16_t",
                .int32_t => "int32_t",
                .uint32_t => "uint32_t",
                .i64_fast, .int64_t => "int64_t",
                .u64_fast, .uint64_t => "uint64_t",
                .double => "double",
                .float => "float",
                .char => "char",
                .void => "void",
            };
        }

        pub fn paramTypename(this: ABIType, writer: anytype) !void {
            try writer.writeAll(this.typenameLabel());
        }

        pub fn paramTypenameLabel(this: ABIType) []const u8 {
            return switch (this) {
                .function, .cstring, .ptr => "void*",
                .bool => "bool",
                .int8_t => "int8_t",
                .uint8_t => "uint8_t",
                .int16_t => "int16_t",
                .uint16_t => "uint16_t",
                // see the comment in ffi.ts about why `uint32_t` acts as `int32_t`
                .int32_t,
                .uint32_t,
                => "int32_t",
                .i64_fast, .int64_t => "int64_t",
                .u64_fast, .uint64_t => "uint64_t",
                .double => "double",
                .float => "float",
                .char => "char",
                .void => "void",
            };
        }
    };
};
