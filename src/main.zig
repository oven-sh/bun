pub const panic = _bun.crash_handler.panic;
pub const std_options = std.Options{
    .enable_segfault_handler = false,
};

pub const io_mode = .blocking;

comptime {
    _bun.assert(builtin.target.cpu.arch.endian() == .little);
}

extern fn bun_warn_avx_missing(url: [*:0]const u8) void;

pub extern "c" var _environ: ?*anyopaque;
pub extern "c" var environ: ?*anyopaque;

pub fn main() void {
    _bun.crash_handler.init();

    if (Environment.isPosix) {
        var act: std.posix.Sigaction = .{
            .handler = .{ .handler = std.posix.SIG.IGN },
            .mask = std.posix.sigemptyset(),
            .flags = 0,
        };
        std.posix.sigaction(std.posix.SIG.PIPE, &act, null);
        std.posix.sigaction(std.posix.SIG.XFSZ, &act, null);
    }

    if (Environment.isDebug) {
        _bun.debug_allocator_data.backing = .init;
    }

    // This should appear before we make any calls at all to libuv.
    // So it's safest to put it very early in the main function.
    if (Environment.isWindows) {
        _ = _bun.windows.libuv.uv_replace_allocator(
            &_bun.mimalloc.mi_malloc,
            &_bun.mimalloc.mi_realloc,
            &_bun.mimalloc.mi_calloc,
            &_bun.mimalloc.mi_free,
        );
        _bun.handleOom(_bun.windows.env.convertEnvToWTF8());
        environ = @ptrCast(std.os.environ.ptr);
        _environ = @ptrCast(std.os.environ.ptr);
    }

    _bun.start_time = std.time.nanoTimestamp();
    _bun.initArgv() catch |err| {
        Output.panic("Failed to initialize argv: {s}\n", .{@errorName(err)});
    };

    Output.Source.Stdio.init();
    defer Output.flush();
    if (Environment.isX64 and Environment.enableSIMD and Environment.isPosix) {
        bun_warn_avx_missing(_bun.cli.UpgradeCommand.Bun__githubBaselineURL.ptr);
    }

    _bun.StackCheck.configureThread();

    _bun.cli.Cli.start(_bun.default_allocator);
    _bun.Global.exit(0);
}

pub export fn Bun__panic(msg: [*]const u8, len: usize) noreturn {
    Output.panic("{s}", .{msg[0..len]});
}

// -- Zig Standard Library Additions --
pub fn copyForwards(comptime T: type, dest: []T, source: []const T) void {
    if (source.len == 0) {
        return;
    }
    _bun.copy(T, dest[0..source.len], source);
}
pub fn copyBackwards(comptime T: type, dest: []T, source: []const T) void {
    if (source.len == 0) {
        return;
    }
    _bun.copy(T, dest[0..source.len], source);
}
pub fn eqlBytes(src: []const u8, dest: []const u8) bool {
    return _bun.c.memcmp(src.ptr, dest.ptr, src.len) == 0;
}
// -- End Zig Standard Library Additions --

// Claude thinks its @import("root").bun when it's @import("bun").
const bun = @compileError("Deprecated: Use @import(\"bun\") instead");

const builtin = @import("builtin");
const std = @import("std");

const _bun = @import("bun");
const Environment = _bun.Environment;
const Output = _bun.Output;
