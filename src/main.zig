const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;
const Output = bun.Output;
const Environment = bun.Environment;

pub const panic = bun.crash_handler.panic;
pub const std_options = std.Options{
    .enable_segfault_handler = false,
};

pub const io_mode = .blocking;

comptime {
    bun.assert(builtin.target.cpu.arch.endian() == .little);
}

extern fn bun_warn_avx_missing(url: [*:0]const u8) void;
pub extern "c" var _environ: ?*anyopaque;
pub extern "c" var environ: ?*anyopaque;
/// Linux only: Change the signal used by GC to suspend and resume threads to `signal`.
/// Returns true on success.
extern "C" fn JSConfigureSignalForGC(signal: c_int) bool;
pub fn main() void {
    bun.crash_handler.init();

    if (Environment.isPosix) {
        var act: std.posix.Sigaction = .{
            .handler = .{ .handler = std.posix.SIG.IGN },
            .mask = std.posix.empty_sigset,
            .flags = 0,
        };
        std.posix.sigaction(std.posix.SIG.PIPE, &act, null);
        std.posix.sigaction(std.posix.SIG.XFSZ, &act, null);
    }

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
    bun.StackCheck.configureThread();
    if (Environment.isLinux) {
        // By default, JavaScriptCore's garbage collector sends SIGUSR1 to the JS thread to suspend
        // and resume it in order to scan its stack memory. Whatever signal it uses can't be
        // reliably intercepted by JS code, and several npm packages use SIGUSR1 for various
        // features. We tell it to use SIGPWR instead, which we assume is unlikely to be reliable
        // for its stated purpose. Mono's garbage collector also uses SIGPWR:
        // https://www.mono-project.com/docs/advanced/embedding/#signal-handling
        //
        // This call needs to be before any of the other JSC initialization, as we can't
        // reconfigure which signal is used once the signal handler has already been registered.
        const configure_signal_success = JSConfigureSignalForGC(std.posix.SIG.PWR);
        if (!configure_signal_success) {
            Output.panic("Failed to configure signal for GC thread", .{});
        }
    }
    bun.CLI.Cli.start(bun.default_allocator);
    bun.Global.exit(0);
}

pub export fn Bun__panic(msg: [*]const u8, len: usize) noreturn {
    Output.panic("{s}", .{msg[0..len]});
}
