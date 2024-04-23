const std = @import("std");
const builtin = @import("builtin");
pub const build_options = @import("build_options");

const bun = @import("root").bun;
const Output = bun.Output;
const Environment = bun.Environment;

pub const panic = bun.crash_handler.panic;
pub const std_options = struct {
    pub const enable_segfault_handler = !bun.crash_handler.enable;
};

pub const io_mode = .blocking;

comptime {
    bun.assert(builtin.target.cpu.arch.endian() == .little);
}

extern fn bun_warn_avx_missing(url: [*:0]const u8) void;
pub extern "C" var _environ: ?*anyopaque;
pub extern "C" var environ: ?*anyopaque;

pub fn main() void {
    bun.crash_handler.init();

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

    bun.start_time = std.time.nanoTimestamp();
    bun.initArgv(bun.default_allocator) catch |err| {
        Output.panic("Failed to initialize argv: {s}\n", .{@errorName(err)});
    };

    Output.Source.Stdio.init();
    defer Output.flush();
    if (Environment.isX64 and Environment.enableSIMD and Environment.isPosix) {
        bun_warn_avx_missing(@import("./cli/upgrade_command.zig").Version.Bun__githubBaselineURL.ptr);
    }

    bun.CLI.Cli.start(bun.default_allocator);
    bun.Global.exit(0);
}
