const std = @import("std");
pub const build_options = @import("build_options");

const panicky = @import("./panic_handler.zig");
const MainPanicHandler = panicky.NewPanicHandler(std.builtin.default_panic);

pub const io_mode = .blocking;

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

    if (Environment.isRelease and Environment.isPosix)
        CrashReporter.start() catch unreachable;
    if (Environment.isWindows) {
        environ = @ptrCast(std.os.environ.ptr);
        _environ = @ptrCast(std.os.environ.ptr);
        bun.win32.STDOUT_FD = bun.toFD(std.io.getStdOut().handle);
        bun.win32.STDERR_FD = bun.toFD(std.io.getStdErr().handle);
        bun.win32.STDIN_FD = bun.toFD(std.io.getStdIn().handle);

        // This fixes printing unicode characters
        _ = std.os.windows.kernel32.SetConsoleOutputCP(65001);
    }

    bun.start_time = std.time.nanoTimestamp();

    var stdout = std.io.getStdOut();
    var stderr = std.io.getStdErr();
    var output_source = Output.Source.init(stdout, stderr);

    Output.Source.set(&output_source);
    defer Output.flush();
    if (Environment.isX64 and Environment.enableSIMD) {
        bun_warn_avx_missing(@import("./cli/upgrade_command.zig").Version.Bun__githubBaselineURL.ptr);
    }

    bun.CLI.Cli.start(bun.default_allocator, stdout, stderr, MainPanicHandler);
}
