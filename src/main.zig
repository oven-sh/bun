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

// TODO: when https://github.com/ziglang/zig/pull/18692 merges, use std.os.windows for this
extern fn SetConsoleMode(console_handle: *anyopaque, mode: u32) u32;

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
        const peb = std.os.windows.peb();
        const stdout = peb.ProcessParameters.hStdOutput;
        const stderr = peb.ProcessParameters.hStdError;
        const stdin = peb.ProcessParameters.hStdInput;

        bun.win32.STDERR_FD = if (stderr != std.os.windows.INVALID_HANDLE_VALUE) bun.toFD(stderr) else bun.invalid_fd;
        bun.win32.STDOUT_FD = if (stdout != std.os.windows.INVALID_HANDLE_VALUE) bun.toFD(stdout) else bun.invalid_fd;
        bun.win32.STDIN_FD = if (stdin != std.os.windows.INVALID_HANDLE_VALUE) bun.toFD(stdin) else bun.invalid_fd;

        bun.buffered_stdin.unbuffered_reader.context.handle = stdin;

        const w = std.os.windows;

        // https://learn.microsoft.com/en-us/windows/console/setconsoleoutputcp
        const CP_UTF8 = 65001;
        _ = w.kernel32.SetConsoleOutputCP(CP_UTF8);

        var mode: w.DWORD = undefined;
        if (w.kernel32.GetConsoleMode(stdout, &mode) != 0) {
            _ = SetConsoleMode(stdout, mode | w.ENABLE_VIRTUAL_TERMINAL_PROCESSING);
        }
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

    if (Environment.isWindows) {
        _ = bun.windows.libuv.uv_replace_allocator(
            @ptrCast(&bun.Mimalloc.mi_malloc),
            @ptrCast(&bun.Mimalloc.mi_realloc),
            @ptrCast(&bun.Mimalloc.mi_calloc),
            @ptrCast(&bun.Mimalloc.mi_free),
        );
    }

    bun.CLI.Cli.start(bun.default_allocator, MainPanicHandler);
}
