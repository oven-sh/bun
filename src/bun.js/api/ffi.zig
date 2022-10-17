const Bun = @This();
const default_allocator = @import("../../global.zig").default_allocator;
const bun = @import("../../global.zig");
const Environment = bun.Environment;
const NetworkThread = @import("http").NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("../../global.zig").Output;
const MutableString = @import("../../global.zig").MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = @import("../../bundler.zig").MacroEntryPoint;
const logger = @import("../../logger.zig");
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = @import("../../bundler.zig").Bundler;
const ServerEntryPoint = @import("../../bundler.zig").ServerEntryPoint;
const js_printer = @import("../../js_printer.zig");
const js_parser = @import("../../js_parser.zig");
const js_ast = @import("../../js_ast.zig");
const hash_map = @import("../../hash_map.zig");
const http = @import("../../http.zig");
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = @import("../../jsc.zig").ZigString;
const Runtime = @import("../../runtime.zig");
const Router = @import("./router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = @import("../../bundler.zig").ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;
const WebCore = @import("../../jsc.zig").WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = @import("../../jsc.zig").C;
const JSC = @import("../../jsc.zig");
const JSError = @import("../base.zig").JSError;
const d = @import("../base.zig").d;
const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = @import("../../jsc.zig").JSValue;
const NewClass = @import("../base.zig").NewClass;
const Microtask = @import("../../jsc.zig").Microtask;
const JSGlobalObject = @import("../../jsc.zig").JSGlobalObject;
const ExceptionValueRef = @import("../../jsc.zig").ExceptionValueRef;
const JSPrivateDataPtr = @import("../../jsc.zig").JSPrivateDataPtr;
const ZigConsoleClient = @import("../../jsc.zig").ZigConsoleClient;
const Node = @import("../../jsc.zig").Node;
const ZigException = @import("../../jsc.zig").ZigException;
const ZigStackTrace = @import("../../jsc.zig").ZigStackTrace;
const ErrorableResolvedSource = @import("../../jsc.zig").ErrorableResolvedSource;
const ResolvedSource = @import("../../jsc.zig").ResolvedSource;
const JSPromise = @import("../../jsc.zig").JSPromise;
const JSInternalPromise = @import("../../jsc.zig").JSInternalPromise;
const JSModuleLoader = @import("../../jsc.zig").JSModuleLoader;
const JSPromiseRejectionOperation = @import("../../jsc.zig").JSPromiseRejectionOperation;
const Exception = @import("../../jsc.zig").Exception;
const ErrorableZigString = @import("../../jsc.zig").ErrorableZigString;
const ZigGlobalObject = @import("../../jsc.zig").ZigGlobalObject;
const VM = @import("../../jsc.zig").VM;
const JSFunction = @import("../../jsc.zig").JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../url.zig").URL;
const Transpiler = @import("./transpiler.zig");
const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const IOTask = JSC.IOTask;
const ComptimeStringMap = @import("../../comptime_string_map.zig").ComptimeStringMap;

const TCC = @import("../../tcc.zig");

pub const FFI = struct {
    dylib: ?std.DynLib = null,
    functions: std.StringArrayHashMapUnmanaged(Function) = .{},
    closed: bool = false,

    pub const Class = JSC.NewClass(
        FFI,
        .{ .name = "class" },
        .{ .call = JSC.wrapWithHasContainer(FFI, "close", false, true, true) },
        .{},
    );

    pub fn callback(globalThis: *JSGlobalObject, interface: JSC.JSValue, js_callback: JSC.JSValue) JSValue {
        JSC.markBinding(@src());
        if (!interface.isObject()) {
            return JSC.toInvalidArguments("Expected object", .{}, globalThis);
        }

        if (js_callback.isEmptyOrUndefinedOrNull() or !js_callback.isCallable(globalThis.vm())) {
            return JSC.toInvalidArguments("Expected callback function", .{}, globalThis);
        }

        const allocator = VirtualMachine.vm.allocator;
        var function: Function = .{};
        var func = &function;

        if (generateSymbolForFunction(globalThis, allocator, interface, func) catch ZigString.init("Out of memory").toErrorInstance(globalThis)) |val| {
            return val;
        }

        // TODO: WeakRefHandle that automatically frees it?
        JSC.C.JSValueProtect(globalThis, js_callback.asObjectRef());
        func.base_name = "";

        func.compileCallback(allocator, globalThis, js_callback.asObjectRef().?) catch return ZigString.init("Out of memory").toErrorInstance(globalThis);
        switch (func.step) {
            .failed => |err| {
                JSC.C.JSValueUnprotect(globalThis, js_callback.asObjectRef());
                const message = ZigString.init(err.msg).toErrorInstance(globalThis);

                func.deinit(globalThis, allocator);

                return message;
            },
            .pending => {
                JSC.C.JSValueUnprotect(globalThis, js_callback.asObjectRef());
                func.deinit(globalThis, allocator);
                return ZigString.init("Failed to compile, but not sure why. Please report this bug").toErrorInstance(globalThis);
            },
            .compiled => {
                var function_ = bun.default_allocator.create(Function) catch unreachable;
                function_.* = func.*;
                return JSC.JSValue.fromPtrAddress(@ptrToInt(function_.step.compiled.ptr));
            },
        }
    }

    pub fn close(
        this: *FFI,
        globalThis: *JSC.JSGlobalObject,
    ) JSValue {
        JSC.markBinding(@src());
        if (this.closed) {
            return JSC.JSValue.jsUndefined();
        }
        this.closed = true;
        if (this.dylib) |*dylib| {
            dylib.close();
            this.dylib = null;
        }

        const allocator = VirtualMachine.vm.allocator;

        for (this.functions.values()) |*val| {
            val.deinit(globalThis, allocator);
        }
        this.functions.deinit(allocator);

        return JSC.JSValue.jsUndefined();
    }

    pub fn printCallback(global: *JSGlobalObject, object: JSC.JSValue) JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.vm.allocator;

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

        function.printCallbackSourceCode(&writer) catch {
            return ZigString.init("Error while printing code").toErrorInstance(global);
        };
        return ZigString.init(arraylist.items).toValueGC(global);
    }

    pub fn print(global: *JSGlobalObject, object: JSC.JSValue, is_callback_val: ?JSC.JSValue) JSValue {
        const allocator = VirtualMachine.vm.allocator;
        if (is_callback_val) |is_callback| {
            if (is_callback.toBoolean()) {
                return printCallback(global, object);
            }
        }

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
        }

        var symbols = std.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(bun.constStrToU8(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        JSC.markBinding(@src());
        var zig_strings = allocator.alloc(ZigString, symbols.count()) catch unreachable;
        for (symbols.values()) |*function, i| {
            var arraylist = std.ArrayList(u8).init(allocator);
            var writer = arraylist.writer();
            function.printSourceCode(&writer) catch {
                // an error while generating source code
                for (symbols.keys()) |key| {
                    allocator.free(bun.constStrToU8(key));
                }
                for (zig_strings) |zig_string| {
                    allocator.free(bun.constStrToU8(zig_string.slice()));
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
            allocator.free(bun.constStrToU8(key));
        }
        for (zig_strings) |zig_string| {
            allocator.free(bun.constStrToU8(zig_string.slice()));
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
    //     const allocator = VirtualMachine.vm.allocator;

    //     if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
    //         return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
    //     }

    //     var symbols = std.StringArrayHashMapUnmanaged(Function){};
    //     if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
    //         // an error while validating symbols
    //         for (symbols.keys()) |key| {
    //             allocator.free(bun.constStrToU8(key));
    //         }
    //         symbols.clearAndFree(allocator);
    //         return val;
    //     }

    // }

    pub fn open(global: *JSGlobalObject, name_str: ZigString, object: JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.vm.allocator;
        var name_slice = name_str.toSlice(allocator);
        defer name_slice.deinit();

        if (name_slice.len == 0) {
            return JSC.toInvalidArguments("Invalid library name", .{}, global);
        }

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
        }

        const name = name_slice.sliceZ();
        var symbols = std.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(bun.constStrToU8(key));
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
                        .code = ZigString.init(@tagName(JSC.Node.ErrorCode.ERR_DLOPEN_FAILED)),
                        .message = ZigString.init("Failed to open library. This is usually caused by a missing library or an invalid library path."),
                        .syscall = ZigString.init("dlopen"),
                    };
                    return system_error.toErrorInstance(global);
                };
            };
        };

        var obj = JSC.JSValue.c(JSC.C.JSObjectMake(global, null, null));
        JSC.C.JSValueProtect(global, obj.asObjectRef());
        defer JSC.C.JSValueUnprotect(global, obj.asObjectRef());
        for (symbols.values()) |*function| {
            const function_name = function.base_name.?;

            // optional if the user passed "ptr"
            if (function.symbol_from_dynamic_library == null) {
                var resolved_symbol = dylib.lookup(*anyopaque, function_name) orelse {
                    const ret = JSC.toInvalidArguments("Symbol \"{s}\" not found in \"{s}\"", .{ std.mem.span(function_name), name_slice.slice() }, global);
                    for (symbols.values()) |*value| {
                        allocator.free(bun.constStrToU8(std.mem.span(value.base_name.?)));
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
                    std.mem.span(@errorName(err)),
                    std.mem.span(function_name),
                    name_slice.slice(),
                }, global);
                for (symbols.values()) |*value| {
                    allocator.free(bun.constStrToU8(std.mem.span(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                dylib.close();
                return ret;
            };
            switch (function.step) {
                .failed => |err| {
                    for (symbols.values()) |*value| {
                        allocator.free(bun.constStrToU8(std.mem.span(value.base_name.?)));
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
                        allocator.free(bun.constStrToU8(std.mem.span(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }
                    symbols.clearAndFree(allocator);
                    dylib.close();
                    return ZigString.init("Failed to compile (nothing happend!)").toErrorInstance(global);
                },
                .compiled => |*compiled| {
                    const str = ZigString.init(std.mem.span(function_name));
                    const cb = JSC.NewFunction(
                        global,
                        &str,
                        @intCast(u32, function.arg_types.items.len),
                        compiled.ptr,
                        false,
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

        var close_object = JSC.JSValue.c(Class.make(global, lib));

        return JSC.JSValue.createObject2(global, &ZigString.init("close"), &ZigString.init("symbols"), close_object, obj);
    }

    pub fn linkSymbols(global: *JSGlobalObject, object: JSC.JSValue) JSC.JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.vm.allocator;

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global);
        }

        var symbols = std.StringArrayHashMapUnmanaged(Function){};
        if (generateSymbols(global, &symbols, object) catch JSC.JSValue.zero) |val| {
            // an error while validating symbols
            for (symbols.keys()) |key| {
                allocator.free(bun.constStrToU8(key));
            }
            symbols.clearAndFree(allocator);
            return val;
        }
        if (symbols.count() == 0) {
            return JSC.toInvalidArguments("Expected at least one symbol", .{}, global);
        }

        var obj = JSValue.createEmptyObject(global, if (symbols.count() < 64) symbols.count() else 0);
        obj.ensureStillAlive();
        defer obj.ensureStillAlive();
        for (symbols.values()) |*function| {
            const function_name = function.base_name.?;

            if (function.symbol_from_dynamic_library == null) {
                const ret = JSC.toInvalidArguments("Symbol for \"{s}\" not found", .{std.mem.span(function_name)}, global);
                for (symbols.values()) |*value| {
                    allocator.free(bun.constStrToU8(std.mem.span(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                return ret;
            }

            function.compile(allocator) catch |err| {
                const ret = JSC.toInvalidArguments("{s} when compiling symbol \"{s}\"", .{
                    std.mem.span(@errorName(err)),
                    std.mem.span(function_name),
                }, global);
                for (symbols.values()) |*value| {
                    allocator.free(bun.constStrToU8(std.mem.span(value.base_name.?)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                return ret;
            };
            switch (function.step) {
                .failed => |err| {
                    for (symbols.values()) |*value| {
                        allocator.free(bun.constStrToU8(std.mem.span(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }

                    const res = ZigString.init(err.msg).toErrorInstance(global);
                    function.deinit(global, allocator);
                    symbols.clearAndFree(allocator);
                    return res;
                },
                .pending => {
                    for (symbols.values()) |*value| {
                        allocator.free(bun.constStrToU8(std.mem.span(value.base_name.?)));
                        value.arg_types.clearAndFree(allocator);
                    }
                    symbols.clearAndFree(allocator);
                    return ZigString.static("Failed to compile (nothing happend!)").toErrorInstance(global);
                },
                .compiled => |*compiled| {
                    const name = &ZigString.init(std.mem.span(function_name));

                    const cb = JSC.NewFunction(
                        global,
                        name,
                        @intCast(u32, function.arg_types.items.len),
                        compiled.ptr,
                        false,
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

        var close_object = JSC.JSValue.c(Class.make(global, lib));

        return JSC.JSValue.createObject2(global, ZigString.static("close"), ZigString.static("symbols"), close_object, obj);
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
                    const int = val.toInt32();
                    switch (int) {
                        0...14 => {
                            abi_types.appendAssumeCapacity(@intToEnum(ABIType, int));
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
        var return_type = ABIType.@"void";

        if (value.get(global, "returns")) |ret_value| brk: {
            if (ret_value.isAnyInt()) {
                const int = ret_value.toInt32();
                switch (int) {
                    0...14 => {
                        return_type = @intToEnum(ABIType, int);
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

        function.* = Function{
            .base_name = null,
            .arg_types = abi_types,
            .return_type = return_type,
        };

        if (value.get(global, "ptr")) |ptr| {
            if (ptr.isNumber()) {
                const num = ptr.asPtrAddress();
                if (num > 0)
                    function.symbol_from_dynamic_library = @intToPtr(*anyopaque, num);
            } else {
                const num = ptr.toUInt64NoTruncate();
                if (num > 0) {
                    function.symbol_from_dynamic_library = @intToPtr(*anyopaque, num);
                }
            }
        }

        return null;
    }
    pub fn generateSymbols(global: *JSGlobalObject, symbols: *std.StringArrayHashMapUnmanaged(Function), object: JSC.JSValue) !?JSValue {
        JSC.markBinding(@src());
        const allocator = VirtualMachine.vm.allocator;

        var symbols_iter = JSC.JSPropertyIterator(.{
            .skip_empty_name = true,

            .include_value = true,
        }).init(global, object.asObjectRef());
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

            symbols.putAssumeCapacity(std.mem.span(function.base_name.?), function);
        }

        return null;
    }

    pub const Function = struct {
        symbol_from_dynamic_library: ?*anyopaque = null,
        base_name: ?[:0]const u8 = null,
        state: ?*TCC.TCCState = null,

        return_type: ABIType = ABIType.@"void",
        arg_types: std.ArrayListUnmanaged(ABIType) = .{},
        step: Step = Step{ .pending = {} },

        pub var lib_dirZ: [*:0]const u8 = "";

        pub fn deinit(val: *Function, globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator) void {
            if (val.base_name) |base_name| {
                if (std.mem.span(base_name).len > 0) {
                    allocator.free(bun.constStrToU8(std.mem.span(base_name)));
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
            }

            if (val.step == .failed and val.step.failed.allocated) {
                allocator.free(val.step.failed.msg);
            }
        }

        pub const Step = union(enum) {
            pending: void,
            compiled: struct {
                ptr: *anyopaque,
                fast_path_ptr: ?*anyopaque = null,
                buf: []u8,
                js_function: JSValue = JSValue.zero,
                js_context: ?*anyopaque = null,
            },
            failed: struct {
                msg: []const u8,
                allocated: bool = false,
            },
        };

        const FFI_HEADER: string = @embedFile("./FFI.h");
        pub inline fn ffiHeader() string {
            if (comptime Environment.isDebug) {
                var dirpath = std.fs.path.dirname(@src().file).?;
                var env = std.process.getEnvMap(default_allocator) catch unreachable;

                const dir = std.mem.replaceOwned(
                    u8,
                    default_allocator,
                    dirpath,
                    "jarred",
                    env.get("USER").?,
                ) catch unreachable;
                var runtime_path = std.fs.path.join(default_allocator, &[_]string{ dir, "FFI.h" }) catch unreachable;
                const file = std.fs.openFileAbsolute(runtime_path, .{}) catch @panic("Missing bun/src/bun.js/api/FFI.h.");
                defer file.close();
                return file.readToEndAlloc(default_allocator, (file.stat() catch unreachable).size) catch unreachable;
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

            this.step = .{ .failed = .{ .msg = VirtualMachine.vm.allocator.dupe(u8, msg) catch unreachable, .allocated = true } };
        }

        extern fn pthread_jit_write_protect_np(enable: bool) callconv(.C) void;

        const MyFunctionSStructWorkAround = struct {
            JSVALUE_TO_INT64: fn (JSValue0: JSC.JSValue) callconv(.C) i64,
            JSVALUE_TO_UINT64: fn (JSValue0: JSC.JSValue) callconv(.C) u64,
            INT64_TO_JSVALUE: fn (arg0: [*c]JSC.JSGlobalObject, arg1: i64) callconv(.C) JSC.JSValue,
            UINT64_TO_JSVALUE: fn (arg0: [*c]JSC.JSGlobalObject, arg1: u64) callconv(.C) JSC.JSValue,
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

            var state = TCC.tcc_new() orelse return error.TCCMissing;
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

            var relocation_size = TCC.tcc_relocate(state, null);
            if (this.step == .failed) {
                return;
            }

            if (relocation_size < 0) {
                this.step = .{ .failed = .{ .msg = "tcc_relocate returned a negative value" } };
                return;
            }

            var bytes: []u8 = try allocator.rawAlloc(@intCast(usize, relocation_size), 16, 16, 0);
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

            var symbol = TCC.tcc_get_symbol(state, "JSFunctionCall") orelse {
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
                @memset(dest, c, byte_count);
            }

            noinline fn memcpy(
                noalias dest: [*]u8,
                noalias source: [*]const u8,
                byte_count: usize,
            ) callconv(.C) void {
                @memcpy(dest, source, byte_count);
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
            js_context: *anyopaque,
            js_function: *anyopaque,
        ) !void {
            Output.debug("welcome", .{});
            var source_code = std.ArrayList(u8).init(allocator);
            var source_code_writer = source_code.writer();
            try this.printCallbackSourceCode(&source_code_writer);
            Output.debug("helllooo", .{});
            try source_code.append(0);
            // defer source_code.deinit();
            var state = TCC.tcc_new() orelse return error.TCCMissing;
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
            Output.debug("compile", .{});
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
            Output.debug("here", .{});
            _ = TCC.tcc_add_symbol(state, "bun_call", workaround.bun_call.*);
            _ = TCC.tcc_add_symbol(state, "cachedJSContext", js_context);
            _ = TCC.tcc_add_symbol(state, "cachedCallbackFunction", js_function);

            var relocation_size = TCC.tcc_relocate(state, null);
            if (relocation_size == 0) return;
            var bytes: []u8 = try allocator.rawAlloc(@intCast(usize, relocation_size), 16, 16, 0);
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

            var symbol = TCC.tcc_get_symbol(state, "my_callback_function") orelse {
                this.step = .{ .failed = .{ .msg = "missing generated symbol in source code" } };

                return;
            };

            this.step = .{
                .compiled = .{
                    .ptr = symbol,
                    .buf = bytes,
                    .js_function = JSC.JSValue.fromPtr(js_function),
                    .js_context = js_context,
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
                try writer.writeAll(std.mem.span(FFI_HEADER));
            } else {
                try writer.writeAll(ffiHeader());
            }

            // -- Generate the FFI function symbol
            try writer.writeAll("/* --- The Function To Call */\n");
            try this.return_type.typename(writer);
            try writer.writeAll(" ");
            try writer.writeAll(std.mem.span(this.base_name.?));
            try writer.writeAll("(");
            var first = true;
            for (this.arg_types.items) |arg, i| {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;
                try arg.typename(writer);
                try writer.print(" arg{d}", .{i});
            }
            try writer.writeAll(
                \\);
                \\
                \\
                \\/* ---- Your Wrapper Function ---- */
                \\ZIG_REPR_TYPE JSFunctionCall(void* globalObject, void* callFrame) {
                \\
            );

            if (this.arg_types.items.len > 0) {
                try writer.writeAll(
                    \\  LOAD_ARGUMENTS_FROM_CALL_FRAME;
                    \\
                );
                for (this.arg_types.items) |arg, i| {
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
            try writer.print("{s}(", .{std.mem.span(this.base_name.?)});
            first = true;
            arg_buf[0..3].* = "arg".*;
            for (this.arg_types.items) |arg, i| {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;

                try writer.writeAll("    ");
                const lengthBuf = std.fmt.bufPrintIntToSlice(arg_buf["arg".len..], i, 10, .lower, .{});
                const argName = arg_buf[0 .. 3 + lengthBuf.len];
                if (arg.needsACastInC()) {
                    try writer.print("{}", .{arg.toC(argName)});
                } else {
                    try writer.writeAll(argName);
                }
            }
            try writer.writeAll(");\n");

            if (!first) try writer.writeAll("\n");

            try writer.writeAll("    ");

            try writer.writeAll("return ");

            if (!(this.return_type == .void)) {
                try writer.print("{}.asZigRepr", .{this.return_type.toJS("return_value")});
            } else {
                try writer.writeAll("ValueUndefined.asZigRepr");
            }

            try writer.writeAll(";\n}\n\n");
        }

        pub fn printCallbackSourceCode(
            this: *Function,
            writer: anytype,
        ) !void {
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
                try writer.writeAll(std.mem.span(FFI_HEADER));
            } else {
                try writer.writeAll(ffiHeader());
            }

            // -- Generate the FFI function symbol
            try writer.writeAll("\n \n/* --- The Callback Function */\n");
            try writer.writeAll("/* --- The Callback Function */\n");
            try this.return_type.typename(writer);
            try writer.writeAll(" my_callback_function");
            try writer.writeAll("(");
            var first = true;
            for (this.arg_types.items) |arg, i| {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;
                try arg.typename(writer);
                try writer.print(" arg{d}", .{i});
            }
            try writer.writeAll(");\n\n");

            first = true;
            try this.return_type.typename(writer);

            try writer.writeAll(" my_callback_function");
            try writer.writeAll("(");
            for (this.arg_types.items) |arg, i| {
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
                try writer.print("  EncodedJSValue arguments[{d}] = {{\n", .{this.arg_types.items.len});

                var arg_buf: [512]u8 = undefined;
                arg_buf[0.."arg".len].* = "arg".*;
                for (this.arg_types.items) |arg, i| {
                    const printed = std.fmt.bufPrintIntToSlice(arg_buf["arg".len..], i, 10, .lower, .{});
                    const arg_name = arg_buf[0 .. "arg".len + printed.len];
                    try writer.print("    {}", .{arg.toJS(arg_name)});
                    if (i < this.arg_types.items.len - 1) {
                        try writer.writeAll(",\n");
                    }
                }
                try writer.writeAll("\n  };\n");
            } else {
                try writer.writeAll(" EncodedJSValue arguments[1] = {{0}};\n");
            }

            try writer.writeAll("  ");
            if (!(this.return_type == .void)) {
                try writer.writeAll("EncodedJSValue return_value = {");
            }
            // JSC.C.JSObjectCallAsFunction(
            //     ctx,
            //     object,
            //     thisObject,
            //     argumentCount,
            //     arguments,
            //     exception,
            // );
            try writer.writeAll("bun_call(cachedJSContext, cachedCallbackFunction, (void*)0, ");
            if (this.arg_types.items.len > 0) {
                try writer.print("{d}, &arguments[0], (void*)0)", .{this.arg_types.items.len});
            } else {
                try writer.writeAll("0, &arguments[0], (void*)0)");
            }

            if (this.return_type != .void) {
                try writer.print("}};\n  return {}", .{this.return_type.toC("return_value")});
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

        @"void" = 13,

        cstring = 14,

        i64_fast = 15,
        u64_fast = 16,

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
            .{ "void", ABIType.@"void" },
            .{ "cstring", ABIType.@"cstring" },
            .{ "i64_fast", ABIType.i64_fast },
            .{ "u64_fast", ABIType.u64_fast },
        };
        pub const label = ComptimeStringMap(ABIType, map);
        const EnumMapFormatter = struct {
            name: []const u8,
            entry: ABIType,
            pub fn format(self: EnumMapFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                try writer.writeAll("['");
                // these are not all valid identifiers
                try writer.writeAll(self.name);
                try writer.writeAll("']:");
                try std.fmt.formatInt(@enumToInt(self.entry), 10, .lower, .{}, writer);
                try writer.writeAll(",'");
                try std.fmt.formatInt(@enumToInt(self.entry), 10, .lower, .{}, writer);
                try writer.writeAll("':");
                try std.fmt.formatInt(@enumToInt(self.entry), 10, .lower, .{}, writer);
            }
        };
        pub const map_to_js_object = brk: {
            var count: usize = 2;
            for (map) |item, i| {
                var fmt = EnumMapFormatter{ .name = item.@"0", .entry = item.@"1" };
                count += std.fmt.count("{}", .{fmt});
                count += @boolToInt(i > 0);
            }

            var buf: [count]u8 = undefined;
            buf[0] = '{';
            buf[buf.len - 1] = '}';
            var end: usize = 1;
            for (map) |item, i| {
                var fmt = EnumMapFormatter{ .name = item.@"0", .entry = item.@"1" };
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

            pub fn format(self: ToCFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                switch (self.tag) {
                    .void => {},
                    .bool => {
                        try writer.print("JSVALUE_TO_BOOL({s})", .{self.symbol});
                    },
                    .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t, .uint32_t => {
                        try writer.print("JSVALUE_TO_INT32({s})", .{self.symbol});
                    },
                    .i64_fast, .int64_t => {
                        try writer.print("JSVALUE_TO_INT64({s})", .{self.symbol});
                    },
                    .u64_fast, .uint64_t => {
                        try writer.print("JSVALUE_TO_UINT64({s})", .{self.symbol});
                    },
                    .cstring, .ptr => {
                        try writer.print("JSVALUE_TO_PTR({s})", .{self.symbol});
                    },
                    .double => {
                        try writer.print("JSVALUE_TO_DOUBLE({s})", .{self.symbol});
                    },
                    .float => {
                        try writer.print("JSVALUE_TO_FLOAT({s})", .{self.symbol});
                    },
                }
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
                    .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t, .uint32_t => {
                        try writer.print("INT32_TO_JSVALUE({s})", .{self.symbol});
                    },
                    .i64_fast => {
                        try writer.print("INT64_TO_JSVALUE(globalObject, {s})", .{self.symbol});
                    },
                    .int64_t => {
                        try writer.print("INT64_TO_JSVALUE_SLOW(globalObject, {s})", .{self.symbol});
                    },
                    .u64_fast => {
                        try writer.print("UINT64_TO_JSVALUE(globalObject, {s})", .{self.symbol});
                    },
                    .uint64_t => {
                        try writer.print("UINT64_TO_JSVALUE_SLOW(globalObject, {s})", .{self.symbol});
                    },
                    .cstring, .ptr => {
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
                .cstring, .ptr => "void*",
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
    };
};
