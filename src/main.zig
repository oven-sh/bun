const std = @import("std");
const builtin = @import("builtin");
pub const build_options = @import("build_options");

const bun = @import("root").bun;
const Output = bun.Output;
const Environment = bun.Environment;

const panic_handler = @import("./panic_handler.zig");
const MainPanicHandler = panic_handler.NewPanicHandler(std.builtin.default_panic);

pub const io_mode = .blocking;

comptime {
    std.debug.assert(builtin.target.cpu.arch.endian() == .little);
}

pub fn panic(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace, addr: ?usize) noreturn {
    MainPanicHandler.handle_panic(msg, error_return_trace, addr);
}

const CrashReporter = @import("./crash_reporter.zig");
extern fn bun_warn_avx_missing(url: [*:0]const u8) void;
pub extern "C" var _environ: ?*anyopaque;
pub extern "C" var environ: ?*anyopaque;

pub fn main() void {
    // This should appear before we make any calls at all to libuv.
    // So it's safest to put it very early in the main function.
    if (Environment.isWindows) {
        _ = bun.windows.libuv.uv_replace_allocator(
            @ptrCast(&bun.Mimalloc.mi_malloc),
            @ptrCast(&bun.Mimalloc.mi_realloc),
            @ptrCast(&bun.Mimalloc.mi_calloc),
            @ptrCast(&bun.Mimalloc.mi_free),
        );
        environ = @ptrCast(std.os.environ.ptr);
        _environ = @ptrCast(std.os.environ.ptr);
    }

    bun.initArgv(bun.default_allocator) catch |err| {
        Output.panic("Failed to initialize argv: {s}\n", .{@errorName(err)});
    };

    if (Environment.isRelease and Environment.isPosix)
        CrashReporter.start() catch unreachable;

    bun.start_time = std.time.nanoTimestamp();
    Output.Source.Stdio.init();
    defer Output.flush();
    if (Environment.isX64 and Environment.enableSIMD and Environment.isPosix) {
        bun_warn_avx_missing(@import("./cli/upgrade_command.zig").Version.Bun__githubBaselineURL.ptr);
    }

    bun.CLI.Cli.start(bun.default_allocator, MainPanicHandler);
}
