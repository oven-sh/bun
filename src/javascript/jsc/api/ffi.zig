const Bun = @This();
const default_allocator = @import("../../../global.zig").default_allocator;
const bun = @import("../../../global.zig");
const Environment = bun.Environment;
const NetworkThread = @import("http").NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("../../../global.zig").Output;
const MutableString = @import("../../../global.zig").MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../../identity_context.zig").IdentityContext;
const Fs = @import("../../../fs.zig");
const Resolver = @import("../../../resolver/resolver.zig");
const ast = @import("../../../import_record.zig");
const NodeModuleBundle = @import("../../../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = @import("../../../bundler.zig").MacroEntryPoint;
const logger = @import("../../../logger.zig");
const Api = @import("../../../api/schema.zig").Api;
const options = @import("../../../options.zig");
const Bundler = @import("../../../bundler.zig").Bundler;
const ServerEntryPoint = @import("../../../bundler.zig").ServerEntryPoint;
const js_printer = @import("../../../js_printer.zig");
const js_parser = @import("../../../js_parser.zig");
const js_ast = @import("../../../js_ast.zig");
const hash_map = @import("../../../hash_map.zig");
const http = @import("../../../http.zig");
const NodeFallbackModules = @import("../../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../../analytics/analytics_thread.zig");
const ZigString = @import("../../../jsc.zig").ZigString;
const Runtime = @import("../../../runtime.zig");
const Router = @import("./router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../../env_loader.zig");
const ParseResult = @import("../../../bundler.zig").ParseResult;
const PackageJSON = @import("../../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../../resolver/package_json.zig").MacroMap;
const WebCore = @import("../../../jsc.zig").WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = @import("../../../jsc.zig").C;
const JSC = @import("../../../jsc.zig");
const JSError = @import("../base.zig").JSError;
const d = @import("../base.zig").d;
const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = @import("../../../jsc.zig").JSValue;
const NewClass = @import("../base.zig").NewClass;
const Microtask = @import("../../../jsc.zig").Microtask;
const JSGlobalObject = @import("../../../jsc.zig").JSGlobalObject;
const ExceptionValueRef = @import("../../../jsc.zig").ExceptionValueRef;
const JSPrivateDataPtr = @import("../../../jsc.zig").JSPrivateDataPtr;
const ZigConsoleClient = @import("../../../jsc.zig").ZigConsoleClient;
const Node = @import("../../../jsc.zig").Node;
const ZigException = @import("../../../jsc.zig").ZigException;
const ZigStackTrace = @import("../../../jsc.zig").ZigStackTrace;
const ErrorableResolvedSource = @import("../../../jsc.zig").ErrorableResolvedSource;
const ResolvedSource = @import("../../../jsc.zig").ResolvedSource;
const JSPromise = @import("../../../jsc.zig").JSPromise;
const JSInternalPromise = @import("../../../jsc.zig").JSInternalPromise;
const JSModuleLoader = @import("../../../jsc.zig").JSModuleLoader;
const JSPromiseRejectionOperation = @import("../../../jsc.zig").JSPromiseRejectionOperation;
const Exception = @import("../../../jsc.zig").Exception;
const ErrorableZigString = @import("../../../jsc.zig").ErrorableZigString;
const ZigGlobalObject = @import("../../../jsc.zig").ZigGlobalObject;
const VM = @import("../../../jsc.zig").VM;
const JSFunction = @import("../../../jsc.zig").JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../../url.zig").URL;
const Transpiler = @import("./transpiler.zig");
const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const IOTask = JSC.IOTask;
const ComptimeStringMap = @import("../../../comptime_string_map.zig").ComptimeStringMap;

const TCC = @import("../../../../tcc.zig");

pub const FFI = struct {
    dylib: std.DynLib,
    functions: std.StringArrayHashMapUnmanaged(Function) = .{},
    closed: bool = false,

    pub const Class = JSC.NewClass(
        FFI,
        .{ .name = "class" },
        .{ .call = JSC.wrapWithHasContainer(FFI, "close", false, true) },
        .{},
    );

    pub fn close(this: *FFI) JSValue {
        if (this.closed) {
            return JSC.JSValue.jsUndefined();
        }
        this.closed = true;
        this.dylib.close();

        for (this.functions.values()) |*val| {
            VirtualMachine.vm.allocator.free(bun.constStrToU8(std.mem.span(val.base_name)));

            val.arg_types.deinit(VirtualMachine.vm.allocator);
        }
        this.functions.deinit(VirtualMachine.vm.allocator);

        return JSC.JSValue.jsUndefined();
    }

    pub fn print(global: *JSGlobalObject, object: JSC.JSValue) JSValue {
        const allocator = VirtualMachine.vm.allocator;

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global.ref());
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
                allocator.free(zig_strings);
                return ZigString.init("Error while printing code").toErrorInstance(global);
            };
            zig_strings[i] = ZigString.init(arraylist.toOwnedSlice());
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
    //         return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global.ref());
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
        const allocator = VirtualMachine.vm.allocator;
        var name_slice = name_str.toSlice(allocator);
        defer name_slice.deinit();

        if (name_slice.len == 0) {
            return JSC.toInvalidArguments("Invalid library name", .{}, global.ref());
        }

        if (object.isEmptyOrUndefinedOrNull() or !object.isObject()) {
            return JSC.toInvalidArguments("Expected an options object with symbol names", .{}, global.ref());
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
            return JSC.toInvalidArguments("Expected at least one symbol", .{}, global.ref());
        }

        var dylib = std.DynLib.open(name) catch {
            return JSC.toInvalidArguments("Failed to open library", .{}, global.ref());
        };

        var obj = JSC.JSValue.c(JSC.C.JSObjectMake(global.ref(), null, null));
        JSC.C.JSValueProtect(global.ref(), obj.asObjectRef());
        defer JSC.C.JSValueUnprotect(global.ref(), obj.asObjectRef());
        for (symbols.values()) |*function| {
            var resolved_symbol = dylib.lookup(*anyopaque, function.base_name) orelse {
                const ret = JSC.toInvalidArguments("Symbol \"{s}\" not found in \"{s}\"", .{ std.mem.span(function.base_name), name_slice.slice() }, global.ref());
                for (symbols.values()) |*value| {
                    allocator.free(bun.constStrToU8(std.mem.span(value.base_name)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                dylib.close();
                return ret;
            };

            function.symbol_from_dynamic_library = resolved_symbol;
            function.compile(allocator) catch {
                const ret = JSC.toInvalidArguments("Failed to compile symbol \"{s}\" in \"{s}\"", .{ std.mem.span(function.base_name), name_slice.slice() }, global.ref());
                for (symbols.values()) |*value| {
                    allocator.free(bun.constStrToU8(std.mem.span(value.base_name)));
                    value.arg_types.clearAndFree(allocator);
                }
                symbols.clearAndFree(allocator);
                dylib.close();
                return ret;
            };
            switch (function.step) {
                .failed => |err| {
                    for (symbols.values()) |*value| {
                        allocator.free(bun.constStrToU8(std.mem.span(value.base_name)));
                        value.arg_types.clearAndFree(allocator);
                    }
                    symbols.clearAndFree(allocator);
                    dylib.close();
                    return ZigString.init(err).toErrorInstance(global);
                },
                .pending => {
                    for (symbols.values()) |*value| {
                        allocator.free(bun.constStrToU8(std.mem.span(value.base_name)));
                        value.arg_types.clearAndFree(allocator);
                    }
                    symbols.clearAndFree(allocator);
                    dylib.close();
                    return ZigString.init("Failed to compile (nothing happend!)").toErrorInstance(global);
                },
                .compiled => |compiled| {
                    var callback = JSC.C.JSObjectMakeFunctionWithCallback(global.ref(), null, @ptrCast(JSC.C.JSObjectCallAsFunctionCallback, compiled.ptr));

                    obj.put(global, &ZigString.init(std.mem.span(function.base_name)), JSC.JSValue.cast(callback));
                },
            }
        }

        var lib = allocator.create(FFI) catch unreachable;
        lib.* = .{
            .dylib = dylib,
            .functions = symbols,
        };

        var close_object = JSC.JSValue.c(Class.make(global.ref(), lib));

        return JSC.JSValue.createObject2(global, &ZigString.init("close"), &ZigString.init("symbols"), close_object, obj);
    }
    pub fn generateSymbols(global: *JSGlobalObject, symbols: *std.StringArrayHashMapUnmanaged(Function), object: JSC.JSValue) !?JSValue {
        const allocator = VirtualMachine.vm.allocator;

        var keys = JSC.C.JSObjectCopyPropertyNames(global.ref(), object.asObjectRef());
        defer JSC.C.JSPropertyNameArrayRelease(keys);
        const count = JSC.C.JSPropertyNameArrayGetCount(keys);

        try symbols.ensureTotalCapacity(allocator, count);

        var i: usize = 0;
        while (i < count) : (i += 1) {
            var property_name_ref = JSC.C.JSPropertyNameArrayGetNameAtIndex(keys, i);
            defer JSC.C.JSStringRelease(property_name_ref);
            const len = JSC.C.JSStringGetLength(property_name_ref);
            if (len == 0) continue;
            var prop = JSC.C.JSStringGetCharacters8Ptr(property_name_ref)[0..len];

            var value = JSC.JSValue.c(JSC.C.JSObjectGetProperty(global.ref(), object.asObjectRef(), property_name_ref, null));
            if (value.isEmptyOrUndefinedOrNull()) {
                return JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_VALUE, "Expected an object for key \"{s}\"", .{prop}, global.ref());
            }

            var abi_types = std.ArrayListUnmanaged(ABIType){};

            if (value.get(global, "params")) |params| {
                if (params.isEmptyOrUndefinedOrNull() or !params.jsType().isArray()) {
                    return ZigString.init("Expected an object with \"params\" as an array").toErrorInstance(global);
                }

                var array = params.arrayIterator(global);

                try abi_types.ensureTotalCapacityPrecise(allocator, array.len);
                while (array.next()) |val| {
                    if (val.isEmptyOrUndefinedOrNull() or !val.jsType().isStringLike()) {
                        abi_types.clearAndFree(allocator);
                        return ZigString.init("param must be a string (type name)").toErrorInstance(global);
                    }

                    var type_name = val.toSlice(global, allocator);
                    defer type_name.deinit();
                    abi_types.appendAssumeCapacity(ABIType.label.get(type_name.slice()) orelse {
                        abi_types.clearAndFree(allocator);
                        return JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_VALUE, "Unknown type {s}", .{type_name.slice()}, global.ref());
                    });
                }
            }
            // var function
            var return_type = ABIType{ .primitive = .@"void" };

            if (value.get(global, "return_type")) |ret_value| {
                var ret_slice = ret_value.toSlice(global, allocator);
                defer ret_slice.deinit();
                return_type = ABIType.label.get(ret_slice.slice()) orelse {
                    abi_types.clearAndFree(allocator);
                    return JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_VALUE, "Unknown return type {s}", .{ret_slice.slice()}, global.ref());
                };
            }

            const function = Function{
                .base_name = try allocator.dupeZ(u8, prop),
                .arg_types = abi_types,
                .return_type = return_type,
            };
            symbols.putAssumeCapacity(std.mem.span(function.base_name), function);
        }

        return null;
    }

    pub const Function = struct {
        symbol_from_dynamic_library: ?*anyopaque = null,
        base_name: [:0]const u8 = "",

        return_type: ABIType,
        arg_types: std.ArrayListUnmanaged(ABIType) = .{},
        step: Step = Step{ .pending = {} },

        pub const Step = union(enum) {
            pending: void,
            compiled: struct {
                ptr: *anyopaque,
                buf: []u8,
            },
            failed: []const u8,
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
                const file = std.fs.openFileAbsolute(runtime_path, .{}) catch @panic("Missing bun/src/javascript/jsc/api/FFI.h.");
                defer file.close();
                return file.readToEndAlloc(default_allocator, (file.stat() catch unreachable).size) catch unreachable;
            } else {
                return FFI_HEADER;
            }
        }

        pub fn handleTCCError(ctx: ?*anyopaque, message: [*c]const u8) callconv(.C) void {
            var this = bun.cast(*Function, ctx.?);
            this.step = .{ .failed = std.mem.span(message) };
        }

        extern fn pthread_jit_write_protect_np(enable: bool) callconv(.C) void;

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
            TCC.tcc_set_error_func(state, this, handleTCCError);
            // defer TCC.tcc_delete(state);
            _ = TCC.tcc_set_output_type(state, TCC.TCC_OUTPUT_MEMORY);

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
                this.step = .{ .failed = "tcc returned -1, which means it failed" };
                return;
            }

            _ = TCC.tcc_add_symbol(state, this.base_name, this.symbol_from_dynamic_library.?);

            // i don't fully understand this, why it needs two calls
            // but that is the API
            var relocation_size = TCC.tcc_relocate(state, null);
            if (relocation_size > 0) {
                var bytes: []u8 = try allocator.rawAlloc(@intCast(usize, relocation_size), 16, 16, 0);
                if (comptime Environment.isAarch64 and Environment.isMac) {
                    pthread_jit_write_protect_np(false);
                }
                _ = TCC.tcc_relocate(state, bytes.ptr);
                if (comptime Environment.isAarch64 and Environment.isMac) {
                    pthread_jit_write_protect_np(true);
                }
                if (this.step == .failed) {
                    allocator.free(bytes);
                    return;
                }

                var formatted_symbol_name = try std.fmt.allocPrintZ(allocator, "bun_gen_{s}", .{std.mem.span(this.base_name)});
                defer allocator.free(formatted_symbol_name);
                var symbol = TCC.tcc_get_symbol(state, formatted_symbol_name) orelse {
                    this.step = .{ .failed = "missing generated symbol in source code" };
                    allocator.free(bytes);

                    return;
                };
                if (this.step == .failed) {
                    allocator.free(bytes);
                    return;
                }

                this.step = .{
                    .compiled = .{
                        .ptr = symbol,
                        .buf = bytes,
                    },
                };
                return;
            }
        }

        pub fn printSourceCode(
            this: *Function,
            writer: anytype,
        ) !void {
            if (comptime Environment.isRelease) {
                try writer.writeAll(std.mem.span(FFI_HEADER));
            } else {
                try writer.writeAll(ffiHeader());
            }

            // -- Generate the FFI function symbol
            try writer.writeAll("/* --- The Function To Call */\n");
            try this.return_type.typename(writer);
            try writer.writeAll(" ");
            try writer.writeAll(std.mem.span(this.base_name));
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

            // -- Generate JavaScriptCore's C wrapper function
            try writer.writeAll("/* ---- Your Wrapper Function ---- */\nvoid* bun_gen_");
            try writer.writeAll(std.mem.span(this.base_name));
            try writer.writeAll("(JSContext ctx, EncodedJSValue function, EncodedJSValue thisObject, size_t argumentCount, const EncodedJSValue arguments[], void* exception);\n\n");

            try writer.writeAll("void* bun_gen_");
            try writer.writeAll(std.mem.span(this.base_name));
            try writer.writeAll("(JSContext ctx, EncodedJSValue function, EncodedJSValue thisObject, size_t argumentCount, const EncodedJSValue arguments[], void* exception) {\n\n");
            var arg_buf: [512]u8 = undefined;
            arg_buf[0.."arguments[".len].* = "arguments[".*;
            for (this.arg_types.items) |arg, i| {
                try writer.writeAll("    ");
                try arg.typename(writer);
                var printed = std.fmt.bufPrintIntToSlice(arg_buf["arguments[".len..], i, 10, .lower, .{});
                arg_buf["arguments[".len + printed.len] = ']';
                try writer.print(" arg{d} = {};\n", .{ i, arg.toC(arg_buf[0 .. printed.len + "arguments[]".len]) });
            }

            try writer.writeAll("    ");
            if (!(this.return_type == .primitive and this.return_type.primitive == .void)) {
                try this.return_type.typename(writer);
                try writer.writeAll(" return_value = ");
            }
            try writer.print("{s}(", .{std.mem.span(this.base_name)});
            first = true;
            for (this.arg_types.items) |_, i| {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;
                try writer.print("arg{d}", .{i});
            }
            try writer.writeAll(");\n\n");

            try writer.writeAll("    ");

            try writer.writeAll("return ");

            if (!(this.return_type == .primitive and this.return_type.primitive == .void)) {
                try writer.print("{}.asPtr", .{this.return_type.toJS("return_value")});
            } else {
                try writer.writeAll("ValueUndefined.asPtr");
            }

            try writer.writeAll(";\n}\n\n");
        }
    };

    pub const ABIType = union(enum) {
        primitive: Primitive.Tag,
        pointer: Pointer,

        pub const label = ComptimeStringMap(
            ABIType,
            .{
                .{ "char", ABIType{ .primitive = Primitive.Tag.char } },
                .{ "bool", ABIType{ .primitive = Primitive.Tag.@"bool" } },

                .{ "i8", ABIType{ .primitive = Primitive.Tag.int8_t } },
                .{ "u8", ABIType{ .primitive = Primitive.Tag.uint8_t } },
                .{ "i16", ABIType{ .primitive = Primitive.Tag.int16_t } },
                .{ "int", ABIType{ .primitive = Primitive.Tag.int32_t } },
                .{ "c_int", ABIType{ .primitive = Primitive.Tag.int32_t } },
                .{ "c_uint", ABIType{ .primitive = Primitive.Tag.uint32_t } },
                .{ "i32", ABIType{ .primitive = Primitive.Tag.int32_t } },
                .{ "i64", ABIType{ .primitive = Primitive.Tag.int64_t } },
                .{ "u16", ABIType{ .primitive = Primitive.Tag.uint16_t } },
                .{ "u32", ABIType{ .primitive = Primitive.Tag.uint32_t } },
                .{ "u64", ABIType{ .primitive = Primitive.Tag.uint64_t } },
                .{ "int8_t", ABIType{ .primitive = Primitive.Tag.int8_t } },
                .{ "isize", ABIType{ .primitive = Primitive.Tag.int64_t } },
                .{ "usize", ABIType{ .primitive = Primitive.Tag.uint64_t } },
                .{ "int16_t", ABIType{ .primitive = Primitive.Tag.int16_t } },
                .{ "int32_t", ABIType{ .primitive = Primitive.Tag.int32_t } },
                .{ "int64_t", ABIType{ .primitive = Primitive.Tag.int64_t } },
                .{ "uint8_t", ABIType{ .primitive = Primitive.Tag.uint8_t } },
                .{ "uint16_t", ABIType{ .primitive = Primitive.Tag.uint16_t } },
                .{ "uint32_t", ABIType{ .primitive = Primitive.Tag.uint32_t } },
                .{ "uint64_t", ABIType{ .primitive = Primitive.Tag.uint64_t } },

                .{ "char*", ABIType{ .pointer = .{ .primitive = Primitive.Tag.char } } },
                .{ "void*", ABIType{ .pointer = .{ .primitive = Primitive.Tag.@"void" } } },
                .{ "const char*", ABIType{ .pointer = .{ .is_const = true, .primitive = Primitive.Tag.char } } },
                .{ "const void*", ABIType{ .pointer = .{ .is_const = true, .primitive = Primitive.Tag.@"void" } } },
            },
        );

        const ToJSFormatter = struct {
            symbol: []const u8,
            abi: ABIType,

            pub fn format(self: ToJSFormatter, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                switch (self.abi) {
                    .pointer => |ptr| {
                        _ = ptr;
                    },
                    .primitive => |prim| {
                        try prim.toJS(self.symbol).format(comptime fmt, opts, writer);
                    },
                }
            }
        };

        const ToCFormatter = struct {
            symbol: []const u8,
            abi: ABIType,

            pub fn format(self: ToCFormatter, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                try self.abi.primitive.toC(self.symbol).format(
                    comptime fmt,
                    opts,
                    writer,
                );
            }
        };

        pub fn toJS(
            this: ABIType,
            symbol: string,
        ) ToJSFormatter {
            return ToJSFormatter{
                .symbol = symbol,
                .abi = this,
            };
        }

        pub fn toC(this: ABIType, symbol: string) ToCFormatter {
            return ToCFormatter{
                .symbol = symbol,
                .abi = this,
            };
        }

        pub fn typename(this: ABIType, writer: anytype) !void {
            switch (this) {
                .primitive => |prim| {
                    try writer.writeAll(prim.typename());
                },
                .pointer => |ptr| {
                    try ptr.typename(writer);
                },
            }
        }
    };

    pub const Pointer = struct {
        count: u8 = 1,
        primitive: Primitive.Tag,
        is_const: bool = false,

        pub fn typename(this: Pointer, writer: anytype) !void {
            if (this.is_const) {
                try writer.writeAll("const ");
            }

            var i: u8 = 0;
            while (i < this.count) {
                try writer.writeAll("*");
                i = i + 1;
            }

            try writer.writeAll(" ");
            try writer.writeAll(this.primitive.typename());
        }
    };

    pub const Primitive = union(Tag) {
        char: i8,
        int8_t: i8,
        uint8_t: u8,

        int16_t: i16,
        uint16_t: u16,

        int32_t: c_int,
        uint32_t: c_uint,

        int64_t: i64,
        uint64_t: u64,

        double: f64,
        float: f32,

        void: *anyopaque,

        bool: bool,

        dynamic: struct {
            size: u32,
            alignment: u21,
            name: []const u8,
        },

        pub const Tag = enum(i32) {
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

            void = 11,
            dynamic = 12,

            bool = 13,

            const ToCFormatter = struct {
                symbol: string,
                tag: Tag,

                pub fn format(self: ToCFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                    switch (self.tag) {
                        .void => {},
                        .bool => {
                            try writer.print("JSVALUE_IS_TRUE({s})", .{self.symbol});
                        },
                        .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t, .uint32_t => {
                            try writer.print("JSVALUE_TO_INT32({s})", .{self.symbol});
                        },
                        .int64_t => {},
                        .uint64_t => {},
                        .double => {
                            try writer.print("JSVALUE_TO_DOUBLE({s})", .{self.symbol});
                        },
                        .float => {
                            try writer.print("JSVALUE_TO_FLOAT({s})", .{self.symbol});
                        },
                        else => unreachable,
                    }
                }
            };

            const ToJSFormatter = struct {
                symbol: []const u8,
                tag: Tag,

                pub fn format(self: ToJSFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                    switch (self.tag) {
                        .void => {},
                        .bool => {
                            try writer.print("BOOLEAN_TO_JSVALUE({s})", .{self.symbol});
                        },
                        .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t, .uint32_t => {
                            try writer.print("INT32_TO_JSVALUE({s})", .{self.symbol});
                        },
                        .int64_t => {},
                        .uint64_t => {},
                        .double => {
                            try writer.print("DOUBLE_to_JSVALUE({s})", .{self.symbol});
                        },
                        .float => {
                            try writer.print("FLOAT_to_JSVALUE({s})", .{self.symbol});
                        },
                        else => unreachable,
                    }
                }
            };

            pub fn toC(this: Tag, symbol: string) ToCFormatter {
                return ToCFormatter{ .tag = this, .symbol = symbol };
            }

            pub fn toJS(
                this: Tag,
                symbol: string,
            ) ToJSFormatter {
                return ToJSFormatter{
                    .tag = this,
                    .symbol = symbol,
                };
            }

            pub fn typename(this: Tag) []const u8 {
                return switch (this) {
                    .void => "void",
                    .bool => "bool",
                    .int8_t => "int8_t",
                    .uint8_t => "uint8_t",
                    .int16_t => "int16_t",
                    .uint16_t => "uint16_t",
                    .int32_t => "int32_t",
                    .uint32_t => "uint32_t",
                    .int64_t => "int64_t",
                    .uint64_t => "uint64_t",
                    .double => "float",
                    .float => "double",
                    .char => "int8_t",
                    else => unreachable,
                };
            }
        };
    };
};
