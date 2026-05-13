pub const panic = _bun.crash_handler.panic;
pub const std_options = std.Options{
    .enable_segfault_handler = false,
    // Use BoringSSL's RAND_bytes instead of the default getrandom() syscall.
    // BoringSSL falls back to /dev/urandom on older kernels (< 3.17) where
    // the getrandom syscall doesn't exist, avoiding a panic on ENOSYS.
    .cryptoRandomSeed = _bun.csprng,
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
        var act: _bun.sys.Sigaction = .{
            .handler = .{ .handler = std.posix.SIG.IGN },
            .mask = _bun.sys.sigemptyset(),
            .flags = 0,
        };
        _bun.sys.sigaction(std.posix.SIG.PIPE, &act, null);
        _bun.sys.sigaction(std.posix.SIG.XFSZ, &act, null);
    }

    if (Environment.isDebug) {
        _bun.debug_allocator_data.backing = .init;
    }

    // Both Bun and WebKit trust simdutf unconditionally for UTF-8/UTF-16
    // length computation, validation, and base64. If the runtime CPU lacks
    // every instruction set simdutf was compiled for, it silently dispatches
    // to a stub that returns 0/false for everything, and the process spends
    // ~16 seconds churning through ~4 GB of bad allocations before crashing
    // with an opaque SIGSEGV. Detect that up front and explain why.
    //
    // This must run before convertEnvToWTF8/initArgv on Windows — both
    // convert UTF-16 via simdutf and would panic on a null unwrap before
    // any diagnostic could be printed. It therefore cannot depend on
    // Output.Source being initialized and writes to raw stderr instead.
    if (!_bun.simdutf.hasAnyImplementation()) {
        abortForUnsupportedSimdutf();
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
    _bun.ParentDeathWatchdog.install();

    _bun.cli.Cli.start(_bun.default_allocator);
    _bun.Global.exit(0);
}

pub export fn Bun__panic(msg: [*]const u8, len: usize) noreturn {
    Output.panic("{s}", .{msg[0..len]});
}

/// Prints a CPU-requirement diagnostic and exits. Called from `main()` before
/// `Output.Source` is initialized and before Windows has converted its
/// environment block to UTF-8, so it writes to raw stderr and reads the
/// environment through the C runtime rather than `bun.getenvZ`.
fn abortForUnsupportedSimdutf() noreturn {
    @branchHint(.cold);

    // simdutf's minimum compiled-in kernel is westmere (SSE4.2) for the
    // baseline build and haswell (AVX2) for the default build — the lower
    // tiers are elided once __SSE4_2__ / __AVX2__ are defined.
    const requirement = if (Environment.isX64)
        (if (Environment.baseline) "SSE4.2" else "AVX2")
    else if (Environment.isAarch64)
        "NEON"
    else
        "SIMD";

    const hint = if (Environment.isX64 and Environment.baseline)
        "  Bun's baseline build targets Nehalem-class (2008+) x86_64 CPUs.\n" ++
            "  If this is a VM, enable host CPU passthrough (e.g. -cpu host for QEMU/KVM).\n"
    else if (Environment.isX64)
        "  Install the baseline build, which only requires SSE4.2:\n" ++
            "    " ++ _bun.cli.UpgradeCommand.Bun__githubBaselineURL ++ "\n"
    else
        "";

    var stderr = std.fs.File.stderr().writerStreaming(&.{});
    stderr.interface.print(
        "error: this CPU is missing {s} support, which Bun requires for UTF-8 processing.\n" ++
            "{s}",
        .{ requirement, hint },
    ) catch {};
    if (std.c.getenv("SIMDUTF_FORCE_IMPLEMENTATION")) |forced| {
        stderr.interface.print(
            "  note: SIMDUTF_FORCE_IMPLEMENTATION is set to \"{s}\"\n",
            .{_bun.sliceTo(forced, 0)},
        ) catch {};
    }

    std.process.exit(134);
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
