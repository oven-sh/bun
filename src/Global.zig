const std = @import("std");
const Environment = @import("./env.zig");

const Output = @import("output.zig");
const use_mimalloc = bun.use_mimalloc;
const Mimalloc = bun.Mimalloc;
const bun = @import("bun");

const version_string = Environment.version_string;

/// Does not have the canary tag, because it is exposed in `Bun.version`
/// "1.0.0" or "1.0.0-debug"
pub const package_json_version = if (Environment.isDebug)
    version_string ++ "-debug"
else
    version_string;

/// This is used for `bun` without any arguments, it `package_json_version` but with canary if it is a canary build.
/// like "1.0.0-canary.12"
pub const package_json_version_with_canary = if (Environment.isDebug)
    version_string ++ "-debug"
else if (Environment.is_canary)
    std.fmt.comptimePrint("{s}-canary.{d}", .{ version_string, Environment.canary_revision })
else
    version_string;

/// The version and a short hash in parenthesis.
pub const package_json_version_with_sha = if (Environment.git_sha.len == 0)
    package_json_version
else if (Environment.isDebug)
    std.fmt.comptimePrint("{s} ({s})", .{ version_string, Environment.git_sha[0..@min(Environment.git_sha.len, 8)] })
else if (Environment.is_canary)
    std.fmt.comptimePrint("{s}-canary.{d} ({s})", .{ version_string, Environment.canary_revision, Environment.git_sha[0..@min(Environment.git_sha.len, 8)] })
else
    std.fmt.comptimePrint("{s} ({s})", .{ version_string, Environment.git_sha[0..@min(Environment.git_sha.len, 8)] });

/// What is printed by `bun --revision`
/// "1.0.0+abcdefghi" or "1.0.0-canary.12+abcdefghi"
pub const package_json_version_with_revision = if (Environment.git_sha.len == 0)
    package_json_version
else if (Environment.isDebug)
    std.fmt.comptimePrint(version_string ++ "-debug+{s}", .{Environment.git_sha_short})
else if (Environment.is_canary)
    std.fmt.comptimePrint(version_string ++ "-canary.{d}+{s}", .{ Environment.canary_revision, Environment.git_sha_short })
else
    std.fmt.comptimePrint(version_string ++ "+{s}", .{Environment.git_sha_short});

pub const os_name = Environment.os.nameString();

// Bun v1.0.0 (Linux x64 baseline)
// Bun v1.0.0-debug (Linux x64)
// Bun v1.0.0-canary.0+44e09bb7f (Linux x64)
pub const unhandled_error_bun_version_string = "Bun v" ++
    (if (Environment.is_canary) package_json_version_with_revision else package_json_version) ++
    " (" ++ Environment.os.displayString() ++ " " ++ arch_name ++
    (if (Environment.baseline) " baseline)" else ")");

pub const arch_name = if (Environment.isX64)
    "x64"
else if (Environment.isX86)
    "x86"
else if (Environment.isAarch64)
    "arm64"
else
    "unknown";

pub inline fn getStartTime() i128 {
    return bun.start_time;
}

extern "kernel32" fn SetThreadDescription(thread: std.os.windows.HANDLE, name: [*:0]const u16) callconv(std.os.windows.WINAPI) std.os.windows.HRESULT;

pub fn setThreadName(name: [:0]const u8) void {
    if (Environment.isLinux) {
        _ = std.posix.prctl(.SET_NAME, .{@intFromPtr(name.ptr)}) catch 0;
    } else if (Environment.isMac) {
        _ = std.c.pthread_setname_np(name);
    } else if (Environment.isWindows) {
        // TODO: use SetThreadDescription or NtSetInformationThread with 0x26 (ThreadNameInformation)
        // without causing exit code 0xC0000409 (stack buffer overrun) in child process
    }
}

const ExitFn = *const fn () callconv(.C) void;

var on_exit_callbacks = std.ArrayListUnmanaged(ExitFn){};
export fn Bun__atexit(function: ExitFn) void {
    if (std.mem.indexOfScalar(ExitFn, on_exit_callbacks.items, function) == null) {
        on_exit_callbacks.append(bun.default_allocator, function) catch {};
    }
}

pub fn addExitCallback(function: ExitFn) void {
    Bun__atexit(function);
}

pub fn runExitCallbacks() void {
    for (on_exit_callbacks.items) |callback| {
        callback();
    }
    on_exit_callbacks.items.len = 0;
}

var is_exiting = std.atomic.Value(bool).init(false);
export fn bun_is_exiting() c_int {
    return @intFromBool(isExiting());
}
pub fn isExiting() bool {
    return is_exiting.load(.monotonic);
}

/// Flushes stdout and stderr (in exit/quick_exit callback) and exits with the given code.
pub fn exit(code: u32) noreturn {
    is_exiting.store(true, .monotonic);

    // If we are crashing, allow the crash handler to finish it's work.
    bun.crash_handler.sleepForeverIfAnotherThreadIsCrashing();

    if (Environment.isDebug) {
        bun.assert(bun.debug_allocator_data.backing.?.deinit() == .ok);
        bun.debug_allocator_data.backing = null;
    }

    switch (Environment.os) {
        .mac => std.c.exit(@bitCast(code)),
        .windows => {
            Bun__onExit();
            std.os.windows.kernel32.ExitProcess(code);
        },
        else => {
            bun.c.quick_exit(@bitCast(code));
            std.c.abort(); // quick_exit should be noreturn
        },
    }
}

pub fn raiseIgnoringPanicHandler(sig: bun.SignalCode) noreturn {
    Output.flush();
    Output.Source.Stdio.restore();

    // clear segfault handler
    bun.crash_handler.resetSegfaultHandler();

    // clear signal handler
    if (bun.Environment.os != .windows) {
        var sa: std.c.Sigaction = .{
            .handler = .{ .handler = std.posix.SIG.DFL },
            .mask = std.posix.empty_sigset,
            .flags = std.posix.SA.RESETHAND,
        };
        _ = std.c.sigaction(@intFromEnum(sig), &sa, null);
    }

    // kill self
    _ = std.c.raise(@intFromEnum(sig));
    std.c.abort();
}

pub const AllocatorConfiguration = struct {
    verbose: bool = false,
    long_running: bool = false,
};

pub inline fn mimalloc_cleanup(force: bool) void {
    if (comptime use_mimalloc) {
        Mimalloc.mi_collect(force);
    }
}
pub const versions = @import("./generated_versions_list.zig");

// Enabling huge pages slows down bun by 8x or so
// Keeping this code for:
// 1. documentation that an attempt was made
// 2. if I want to configure allocator later
pub inline fn configureAllocator(_: AllocatorConfiguration) void {
    // if (comptime !use_mimalloc) return;
    // const Mimalloc = @import("./allocators/mimalloc.zig");
    // Mimalloc.mi_option_set_enabled(Mimalloc.mi_option_verbose, config.verbose);
    // Mimalloc.mi_option_set_enabled(Mimalloc.mi_option_large_os_pages, config.long_running);
    // if (!config.long_running) Mimalloc.mi_option_set(Mimalloc.mi_option_reset_delay, 0);
}

pub fn notimpl() noreturn {
    @branchHint(.cold);
    Output.panic("Not implemented yet!!!!!", .{});
}

// Make sure we always print any leftover
pub fn crash() noreturn {
    @branchHint(.cold);
    Global.exit(1);
}

const Global = @This();
const string = bun.string;

pub const BunInfo = struct {
    bun_version: string,
    platform: Analytics.GenerateHeader.GeneratePlatform.Platform,

    const Analytics = @import("./analytics/analytics_thread.zig");
    const JSON = bun.JSON;
    const JSAst = bun.JSAst;
    pub fn generate(comptime Bundler: type, _: Bundler, allocator: std.mem.Allocator) !JSAst.Expr {
        const info = BunInfo{
            .bun_version = Global.package_json_version,
            .platform = Analytics.GenerateHeader.GeneratePlatform.forOS(),
        };

        return try JSON.toAST(allocator, BunInfo, info);
    }
};

pub const user_agent = "Bun/" ++ Global.package_json_version;
pub export const Bun__userAgent: [*:0]const u8 = Global.user_agent;

comptime {
    _ = Bun__userAgent;
}

pub export fn Bun__onExit() void {
    bun.JSC.Node.FSEvents.closeAndWait();

    runExitCallbacks();
    Output.flush();
    std.mem.doNotOptimizeAway(&Bun__atexit);

    Output.Source.Stdio.restore();
}

comptime {
    _ = Bun__onExit;
}
