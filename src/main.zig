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
extern fn SetStdHandle(nStdHandle: u32, hHandle: *anyopaque) u32;
pub extern "kernel32" fn SetConsoleCP(wCodePageID: std.os.windows.UINT) callconv(std.os.windows.WINAPI) std.os.windows.BOOL;
pub fn main() void {
    const bun = @import("root").bun;
    const Output = bun.Output;
    const Environment = bun.Environment;
    // This should appear before we make any calls at all to libuv.
    // So it's safest to put it very early in the main function.
    if (Environment.isWindows) {
        _ = bun.windows.libuv.uv_replace_allocator(
            @ptrCast(&bun.Mimalloc.mi_malloc),
            @ptrCast(&bun.Mimalloc.mi_realloc),
            @ptrCast(&bun.Mimalloc.mi_calloc),
            @ptrCast(&bun.Mimalloc.mi_free),
        );
    }

    bun.initArgv(bun.default_allocator) catch |err| {
        Output.panic("Failed to initialize argv: {s}\n", .{@errorName(err)});
    };

    if (Environment.isRelease and Environment.isPosix)
        CrashReporter.start() catch unreachable;

    if (Environment.isWindows) {
        environ = @ptrCast(std.os.environ.ptr);
        _environ = @ptrCast(std.os.environ.ptr);
        const peb = std.os.windows.peb();
        var stdout = peb.ProcessParameters.hStdOutput;
        var stderr = peb.ProcessParameters.hStdError;
        var stdin = peb.ProcessParameters.hStdInput;

        const handle_identifiers = &.{ std.os.windows.STD_INPUT_HANDLE, std.os.windows.STD_OUTPUT_HANDLE, std.os.windows.STD_ERROR_HANDLE };
        const handles = &.{ &stdin, &stdout, &stderr };
        inline for (0..3) |fd_i| {
            if (handles[fd_i].* == std.os.windows.INVALID_HANDLE_VALUE) {
                handles[fd_i].* = bun.windows.CreateFileW(
                    comptime bun.strings.w("NUL" ++ .{0}).ptr,
                    if (fd_i > 0) std.os.windows.GENERIC_WRITE else std.os.windows.GENERIC_READ,
                    0,
                    null,
                    std.os.windows.OPEN_EXISTING,
                    0,
                    null,
                );
                _ = SetStdHandle(handle_identifiers[fd_i], handles[fd_i].*);
            }
        }

        bun.win32.STDERR_FD = if (stderr != std.os.windows.INVALID_HANDLE_VALUE) bun.toFD(stderr) else bun.invalid_fd;
        bun.win32.STDOUT_FD = if (stdout != std.os.windows.INVALID_HANDLE_VALUE) bun.toFD(stdout) else bun.invalid_fd;
        bun.win32.STDIN_FD = if (stdin != std.os.windows.INVALID_HANDLE_VALUE) bun.toFD(stdin) else bun.invalid_fd;

        bun.Output.buffered_stdin.unbuffered_reader.context.handle = bun.win32.STDIN_FD;

        const w = std.os.windows;

        // https://learn.microsoft.com/en-us/windows/console/setconsoleoutputcp
        const CP_UTF8 = 65001;
        _ = w.kernel32.SetConsoleOutputCP(CP_UTF8);
        _ = SetConsoleCP(CP_UTF8);
        const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x200;
        const ENABLE_PROCESSED_OUTPUT = 0x0001;

        var mode: w.DWORD = undefined;
        if (w.kernel32.GetConsoleMode(stdout, &mode) != 0) {
            _ = SetConsoleMode(stdout, mode | ENABLE_PROCESSED_OUTPUT | w.ENABLE_VIRTUAL_TERMINAL_PROCESSING | 0);
        }

        if (w.kernel32.GetConsoleMode(stderr, &mode) != 0) {
            _ = SetConsoleMode(stderr, mode | ENABLE_PROCESSED_OUTPUT | w.ENABLE_VIRTUAL_TERMINAL_PROCESSING | 0);
        }

        if (w.kernel32.GetConsoleMode(stdin, &mode) != 0) {
            _ = SetConsoleMode(stdin, mode | ENABLE_VIRTUAL_TERMINAL_INPUT);
        }
    }

    bun.start_time = std.time.nanoTimestamp();

    const stdout = bun.sys.File.from(std.io.getStdOut());
    const stderr = bun.sys.File.from(std.io.getStdErr());
    var output_source = Output.Source.init(stdout, stderr);

    Output.Source.set(&output_source);

    if (comptime Environment.isDebug) {
        bun.Output.initScopedDebugWriterAtStartup();
    }

    defer Output.flush();
    if (Environment.isX64 and Environment.enableSIMD and Environment.isPosix) {
        bun_warn_avx_missing(@import("./cli/upgrade_command.zig").Version.Bun__githubBaselineURL.ptr);
    }

    bun.CLI.Cli.start(bun.default_allocator, MainPanicHandler);
}
