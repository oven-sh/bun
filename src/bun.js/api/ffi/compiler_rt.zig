const Fs = @import("../../../fs.zig");
const TCC = @import("../../../deps/tcc.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const Offsets = @import("./common.zig").Offsets;

pub const CompilerRT = struct {
    var compiler_rt_dir: [:0]const u8 = "";
    const compiler_rt_sources = struct {
        pub const @"stdbool.h" = @embedFile("./ffi-stdbool.h");
        pub const @"stdarg.h" = @embedFile("./ffi-stdarg.h");
        pub const @"stdnoreturn.h" = @embedFile("./ffi-stdnoreturn.h");
        pub const @"stdalign.h" = @embedFile("./ffi-stdalign.h");
        pub const @"tgmath.h" = @embedFile("./ffi-tgmath.h");
        pub const @"stddef.h" = @embedFile("./ffi-stddef.h");
        pub const @"varargs.h" = "// empty";
    };

    fn createCompilerRTDir() void {
        const tmpdir = Fs.FileSystem.instance.tmpdir() catch return;
        var bunCC = tmpdir.makeOpenPath("bun-cc", .{}) catch return;
        defer bunCC.close();

        inline for (comptime std.meta.declarations(compiler_rt_sources)) |decl| {
            const source = @field(compiler_rt_sources, decl.name);
            bunCC.writeFile(.{
                .sub_path = decl.name,
                .data = source,
            }) catch {};
        }
        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        compiler_rt_dir = bun.handleOom(bun.default_allocator.dupeZ(u8, bun.getFdPath(.fromStdDir(bunCC), &path_buf) catch return));
    }
    var create_compiler_rt_dir_once = std.once(createCompilerRTDir);

    pub fn dir() ?[:0]const u8 {
        create_compiler_rt_dir_once.call();
        if (compiler_rt_dir.len == 0) return null;
        return compiler_rt_dir;
    }

    const MyFunctionSStructWorkAround = struct {
        JSVALUE_TO_INT64: *const fn (JSValue0: jsc.JSValue) callconv(.C) i64,
        JSVALUE_TO_UINT64: *const fn (JSValue0: jsc.JSValue) callconv(.C) u64,
        INT64_TO_JSVALUE: *const fn (arg0: *jsc.JSGlobalObject, arg1: i64) callconv(.C) jsc.JSValue,
        UINT64_TO_JSVALUE: *const fn (arg0: *jsc.JSGlobalObject, arg1: u64) callconv(.C) jsc.JSValue,
        bun_call: *const @TypeOf(jsc.C.JSObjectCallAsFunction),
    };
    const headers = JSValue.exposed_to_ffi;
    var workaround: MyFunctionSStructWorkAround = .{
        .JSVALUE_TO_INT64 = headers.JSVALUE_TO_INT64,
        .JSVALUE_TO_UINT64 = headers.JSVALUE_TO_UINT64,
        .INT64_TO_JSVALUE = headers.INT64_TO_JSVALUE,
        .UINT64_TO_JSVALUE = headers.UINT64_TO_JSVALUE,
        .bun_call = &jsc.C.JSObjectCallAsFunction,
    };

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

    pub fn define(state: *TCC.State) void {
        if (comptime Environment.isX64) {
            state.defineSymbol("NEEDS_COMPILER_RT_FUNCTIONS", "1");
            state.compileString(@embedFile(("libtcc1.c"))) catch {
                if (bun.Environment.isDebug) {
                    @panic("Failed to compile libtcc1.c");
                }
            };
        }

        const Sizes = @import("../../bindings/sizes.zig");
        const offsets = Offsets.get();
        state.defineSymbolsComptime(.{
            .Bun_FFI_PointerOffsetToArgumentsList = Sizes.Bun_FFI_PointerOffsetToArgumentsList,
            .JSArrayBufferView__offsetOfLength = offsets.JSArrayBufferView__offsetOfLength,
            .JSArrayBufferView__offsetOfVector = offsets.JSArrayBufferView__offsetOfVector,
            .JSCell__offsetOfType = offsets.JSCell__offsetOfType,
            .JSTypeArrayBufferViewMin = @intFromEnum(jsc.JSValue.JSType.min_typed_array),
            .JSTypeArrayBufferViewMax = @intFromEnum(jsc.JSValue.JSType.max_typed_array),
        });
    }

    pub fn inject(state: *TCC.State) void {
        state.addSymbol("memset", &memset) catch unreachable;
        state.addSymbol("memcpy", &memcpy) catch unreachable;
        state.addSymbol("NapiHandleScope__open", &bun.api.napi.NapiHandleScope.NapiHandleScope__open) catch unreachable;
        state.addSymbol("NapiHandleScope__close", &bun.api.napi.NapiHandleScope.NapiHandleScope__close) catch unreachable;

        state.addSymbol("JSVALUE_TO_INT64_SLOW", workaround.JSVALUE_TO_INT64) catch unreachable;
        state.addSymbol("JSVALUE_TO_UINT64_SLOW", workaround.JSVALUE_TO_UINT64) catch unreachable;
        state.addSymbol("INT64_TO_JSVALUE_SLOW", workaround.INT64_TO_JSVALUE) catch unreachable;
        state.addSymbol("UINT64_TO_JSVALUE_SLOW", workaround.UINT64_TO_JSVALUE) catch unreachable;
    }
};
