const TCC = @import("../../../deps/tcc.zig");
const napi = @import("../../../napi/napi.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const string = []const u8;

const ABIType = @import("./abi_type.zig").ABIType;
const CompilerRT = @import("./compiler_rt.zig").CompilerRT;

pub const Function = struct {
    symbol_from_dynamic_library: ?*anyopaque = null,
    base_name: ?[:0]const u8 = null,
    state: ?*TCC.State = null,

    return_type: ABIType = ABIType.void,
    arg_types: std.ArrayListUnmanaged(ABIType) = .{},
    step: Step = Step{ .pending = {} },
    threadsafe: bool = false,
    allocator: Allocator,

    pub var lib_dirZ: [*:0]const u8 = "";

    pub fn needsHandleScope(val: *const Function) bool {
        for (val.arg_types.items) |arg| {
            if (arg == ABIType.napi_env or arg == ABIType.napi_value) {
                return true;
            }
        }
        return val.return_type == ABIType.napi_value;
    }

    extern "c" fn FFICallbackFunctionWrapper_destroy(*anyopaque) void;

    pub fn deinit(val: *Function, globalThis: *jsc.JSGlobalObject) void {
        jsc.markBinding(@src());

        if (val.base_name) |base_name| {
            if (bun.asByteSlice(base_name).len > 0) {
                val.allocator.free(@constCast(bun.asByteSlice(base_name)));
            }
        }

        val.arg_types.clearAndFree(val.allocator);

        if (val.state) |state| {
            state.deinit();
            val.state = null;
        }

        if (val.step == .compiled) {
            // val.allocator.free(val.step.compiled.buf);
            if (val.step.compiled.js_function != .zero) {
                _ = globalThis;
                // _ = jsc.untrackFunction(globalThis, val.step.compiled.js_function);
                val.step.compiled.js_function = .zero;
            }

            if (val.step.compiled.ffi_callback_function_wrapper) |wrapper| {
                FFICallbackFunctionWrapper_destroy(wrapper);
                val.step.compiled.ffi_callback_function_wrapper = null;
            }
        }

        if (val.step == .failed and val.step.failed.allocated) {
            val.allocator.free(val.step.failed.msg);
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

    fn fail(this: *Function, comptime msg: []const u8) void {
        if (this.step != .failed) {
            @branchHint(.likely);
            this.step = .{ .failed = .{ .msg = msg, .allocated = false } };
        }
    }

    pub fn ffiHeader() string {
        return if (Environment.codegen_embed)
            @embedFile("./FFI.h")
        else
            bun.runtimeEmbedFile(.src, "bun.js/api/FFI.h");
    }

    pub fn handleTCCError(ctx: ?*Function, message: [*c]const u8) callconv(.C) void {
        var this = ctx.?;
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

        this.step = .{ .failed = .{ .msg = this.allocator.dupe(u8, msg) catch unreachable, .allocated = true } };
    }

    const tcc_options = "-std=c11 -nostdlib -Wl,--export-all-symbols" ++ if (Environment.isDebug) " -g" else "";

    pub fn compile(this: *Function, napiEnv: ?*napi.NapiEnv) !void {
        var source_code = std.ArrayList(u8).init(this.allocator);
        var source_code_writer = source_code.writer();
        try this.printSourceCode(&source_code_writer);

        try source_code.append(0);
        defer source_code.deinit();
        const state = TCC.State.init(Function, .{
            .options = tcc_options,
            .err = .{ .ctx = this, .handler = handleTCCError },
        }, false) catch return error.TCCMissing;

        this.state = state;
        defer {
            if (this.step == .failed) {
                state.deinit();
                this.state = null;
            }
        }

        if (napiEnv) |env| {
            _ = state.addSymbol("Bun__thisFFIModuleNapiEnv", env) catch {
                this.fail("Failed to add NAPI env symbol");
                return;
            };
        }

        CompilerRT.define(state);

        state.compileString(@ptrCast(source_code.items)) catch {
            this.fail("Failed to compile source code");
            return;
        };

        CompilerRT.inject(state);
        state.addSymbol(this.base_name.?, this.symbol_from_dynamic_library.?) catch {
            bun.debugAssert(this.step == .failed);
            return;
        };

        const relocation_size = state.relocate(null) catch {
            this.fail("tcc_relocate returned a negative value");
            return;
        };

        const bytes: []u8 = try this.allocator.alloc(u8, relocation_size);
        defer {
            if (this.step == .failed) this.allocator.free(bytes);
        }

        const dangerouslyRunWithoutJitProtections = @import("./common.zig").dangerouslyRunWithoutJitProtections;
        _ = dangerouslyRunWithoutJitProtections(TCC.Error!usize, TCC.State.relocate, .{ state, bytes.ptr }) catch {
            this.fail("tcc_relocate returned a negative value");
            return;
        };

        const symbol = state.getSymbol("JSFunctionCall") orelse {
            this.fail("missing generated symbol in source code");
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

    pub fn compileCallback(
        this: *Function,
        js_context: *jsc.JSGlobalObject,
        js_function: JSValue,
        is_threadsafe: bool,
    ) !void {
        jsc.markBinding(@src());
        var source_code = std.ArrayList(u8).init(this.allocator);
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

        const state = TCC.State.init(Function, .{
            .options = tcc_options,
            .err = .{ .ctx = this, .handler = handleTCCError },
        }, false) catch |e| switch (e) {
            error.OutOfMemory => return error.TCCMissing,
            // 1. .Memory is always a valid option, so InvalidOptions is
            //    impossible
            // 2. other throwable functions arent called, so their errors
            //    aren't possible
            else => unreachable,
        };
        this.state = state;
        defer {
            if (this.step == .failed) {
                state.deinit();
                this.state = null;
            }
        }

        if (this.needsNapiEnv()) {
            state.addSymbol("Bun__thisFFIModuleNapiEnv", js_context.makeNapiEnvForFFI()) catch {
                this.fail("Failed to add NAPI env symbol");
                return;
            };
        }

        CompilerRT.define(state);

        state.compileString(@ptrCast(source_code.items)) catch {
            this.fail("Failed to compile source code");
            return;
        };

        CompilerRT.inject(state);
        _ = state.addSymbol(
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
        ) catch {
            this.fail("Failed to add FFI callback symbol");
            return;
        };
        const relocation_size = state.relocate(null) catch {
            this.fail("tcc_relocate returned a negative value");
            return;
        };

        const bytes: []u8 = try this.allocator.alloc(u8, relocation_size);
        defer {
            if (this.step == .failed) {
                this.allocator.free(bytes);
            }
        }

        const dangerouslyRunWithoutJitProtections = @import("./common.zig").dangerouslyRunWithoutJitProtections;
        _ = dangerouslyRunWithoutJitProtections(TCC.Error!usize, TCC.State.relocate, .{ state, bytes.ptr }) catch {
            this.fail("tcc_relocate returned a negative value");
            return;
        };

        const symbol = state.getSymbol("my_callback_function") orelse {
            this.fail("missing generated symbol in source code");
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

        try writer.writeAll(ffiHeader());

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

        if (this.needsHandleScope()) {
            try writer.writeAll(
                \\  void* handleScope = NapiHandleScope__open(&Bun__thisFFIModuleNapiEnv, false);
                \\
            );
        }

        if (this.arg_types.items.len > 0) {
            try writer.writeAll(
                \\  LOAD_ARGUMENTS_FROM_CALL_FRAME;
                \\
            );
            for (this.arg_types.items, 0..) |arg, i| {
                if (arg == .napi_env) {
                    try writer.print(
                        \\  napi_env arg{d} = (napi_env)&Bun__thisFFIModuleNapiEnv;
                        \\  argsPtr++;
                        \\
                    ,
                        .{
                            i,
                        },
                    );
                } else if (arg == .napi_value) {
                    try writer.print(
                        \\  EncodedJSValue arg{d} = {{ .asInt64 = *argsPtr++ }};
                        \\
                    ,
                        .{
                            i,
                        },
                    );
                } else if (arg.needsACastInC()) {
                    if (i < this.arg_types.items.len - 1) {
                        try writer.print(
                            \\  EncodedJSValue arg{d} = {{ .asInt64 = *argsPtr++ }};
                            \\
                        ,
                            .{
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

        if (this.needsHandleScope()) {
            try writer.writeAll(
                \\  NapiHandleScope__close(&Bun__thisFFIModuleNapiEnv, handleScope);
                \\
            );
        }

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
    extern fn Bun__createFFICallbackFunction(*jsc.JSGlobalObject, JSValue) *anyopaque;

    pub fn printCallbackSourceCode(
        this: *Function,
        globalObject: ?*jsc.JSGlobalObject,
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

        try writer.writeAll(ffiHeader());

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
                    .{fmt},
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

    pub fn needsNapiEnv(this: *const Function) bool {
        for (this.arg_types.items) |arg| {
            if (arg == .napi_env or arg == .napi_value) {
                return true;
            }
        }

        return false;
    }
};
