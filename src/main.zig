const std = @import("std");
const builtin = @import("builtin");
pub const build_options = @import("build_options");

const panicky = @import("./panic_handler.zig");
const MainPanicHandler = panicky.NewPanicHandler(std.builtin.default_panic);

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
    const bun = @import("root").bun;
    const Output = bun.Output;
    const Environment = bun.Environment;

    bun.initArgv(bun.default_allocator) catch |err| {
        Output.panic("Failed to initialize argv: {s}\n", .{@errorName(err)});
    };

    if (Environment.isRelease and Environment.isPosix)
        CrashReporter.start() catch unreachable;
    if (Environment.isWindows) {
        environ = @ptrCast(std.os.environ.ptr);
        _environ = @ptrCast(std.os.environ.ptr);
        bun.win32.STDOUT_FD = bun.toFD(std.io.getStdOut().handle);
        bun.win32.STDERR_FD = bun.toFD(std.io.getStdErr().handle);
        bun.win32.STDIN_FD = bun.toFD(std.io.getStdIn().handle);

        const w = std.os.windows;

        // https://learn.microsoft.com/en-us/windows/console/setconsoleoutputcp
        const CP_UTF8 = 65001;
        _ = w.kernel32.SetConsoleOutputCP(CP_UTF8);
        // var mode: w.DWORD = undefined;
        // if (w.kernel32.GetConsoleMode(bun.win32.STDOUT_FD)) {
        //     _ = w.kernel32.SetConsoleMode(bun.win32.STDOUT_FD, mode | std.os.windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING);
        // }
    }

    bun.start_time = std.time.nanoTimestamp();

    const stdout = std.io.getStdOut();
    const stderr = std.io.getStdErr();
    var output_source = Output.Source.init(stdout, stderr);

    Output.Source.set(&output_source);
    defer Output.flush();
    if (Environment.isX64 and Environment.enableSIMD) {
        bun_warn_avx_missing(@import("./cli/upgrade_command.zig").Version.Bun__githubBaselineURL.ptr);
    }

    bun.CLI.Cli.start(bun.default_allocator, stdout, stderr, MainPanicHandler);
}
