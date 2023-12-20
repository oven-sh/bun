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

const bun = @import("root").bun;
const Output = bun.Output;
const Environment = bun.Environment;

pub fn main() void {
    bun.start_time = std.time.nanoTimestamp();

    if (Environment.isX64 and Environment.enableSIMD) {
        bun_warn_avx_missing(@import("./cli/upgrade_command.zig").Version.Bun__githubBaselineURL.ptr);
    }

    if (Environment.isWindows) {
        environ = @ptrCast(std.os.environ.ptr);
        _environ = @ptrCast(std.os.environ.ptr);

        const process_parameters = std.os.windows.peb().ProcessParameters;

        bun.win32.STDIN_FD = process_parameters.hStdInput;
        bun.win32.STDOUT_FD = process_parameters.hStdOutput;
        bun.win32.STDERR_FD = process_parameters.hStdError;

        // This allows printing utf8 data
        _ = std.os.windows.kernel32.SetConsoleOutputCP(65001);
    }

    const stdout = std.io.getStdOut();
    const stderr = std.io.getStdErr();
    var output_source = Output.Source.init(stdout, stderr);
    Output.Source.set(&output_source);
    defer Output.flush();

    if (Environment.isRelease and Environment.isPosix)
        CrashReporter.start() catch {};

    var log = bun.logger.Log.init(bun.default_allocator);

    var panicker = MainPanicHandler.init(&log);
    MainPanicHandler.Singleton = &panicker;

    bun.CLI.Command.start(bun.default_allocator, &log) catch |err| {
        log.printForLogLevel(Output.errorWriter()) catch {};
        @import("./report.zig").globalError(err, @errorReturnTrace());
    };
}
