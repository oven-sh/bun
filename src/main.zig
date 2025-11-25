pub const panic = _bun.crash_handler.panic;
pub const std_options = std.Options{
    .enable_segfault_handler = false,
};

pub const io_mode = .blocking;

comptime {
    _bun.assert(builtin.target.cpu.arch.endian() == .little);
}

extern fn bun_warn_avx_missing(url: [*:0]const u8) void;

pub extern "c" var _environ: ?*anyopaque;
pub extern "c" var environ: ?*anyopaque;

/// Check if the system page size is supported by the WebKit/JavaScriptCore engine.
/// WebKit uses compile-time constants for page sizes that vary by architecture:
/// - 4 KB: Windows, x86, x86_64, ARM, ARM64, RISC-V64
/// - 16 KB: Darwin/macOS, PlayStation, MIPS, MIPS64, LoongArch64, Linux ARM64
/// - 64 KB: PowerPC variants, or when USE(64KB_PAGE_BLOCK) is set
///
/// If the actual system page size exceeds these hardcoded limits, WebKit will crash.
/// This function provides a friendly error message before that happens.
fn checkPageSizeSupport() void {
    // Determine the expected maximum page size based on the target architecture
    // This mirrors the logic in WebKit's PageBlock.h (CeilingOnPageSize)
    const arch = @import("builtin").target.cpu.arch;
    const os_tag = @import("builtin").target.os.tag;

    const expected_max_page_size: usize = comptime blk: {
        // 16 KB architectures
        if (os_tag == .macos or
            os_tag == .ps4 or os_tag == .ps5 or
            arch == .mips or arch == .mips64 or arch == .mips64el or arch == .mipsel or
            arch == .loongarch64 or
            (os_tag == .linux and arch.isAARCH64()))
        {
            break :blk 16 * 1024; // 16 KB
        }

        // 64 KB architectures
        if (arch == .powerpc or arch == .powerpc64 or arch == .powerpc64le) {
            break :blk 64 * 1024; // 64 KB
        }

        // 4 KB architectures (most common)
        if (os_tag == .windows or
            arch.isX86() or
            arch == .arm or arch == .armeb or arch.isAARCH64() or
            arch == .riscv64)
        {
            break :blk 4 * 1024; // 4 KB
        }

        // Unknown architecture - be conservative
        break :blk 64 * 1024; // 64 KB
    };

    // Get the actual system page size at runtime
    const actual_page_size = @import("std").heap.defaultQueryPageSize();

    if (actual_page_size > expected_max_page_size) {
        const kb_actual = actual_page_size / 1024;
        const kb_expected = expected_max_page_size / 1024;

        @import("bun").Output.prettyErrorln("<r><red>error<r>: Unsupported system page size", .{});
        @import("bun").Output.prettyErrorln("", .{});
        @import("bun").Output.prettyErrorln("Your system is configured with a page size of <b>{d} KB<r>, but Bun's JavaScript", .{kb_actual});
        @import("bun").Output.prettyErrorln("engine (based on WebKit/JavaScriptCore) was built to support a maximum page", .{});
        @import("bun").Output.prettyErrorln("size of <b>{d} KB<r> for this architecture.", .{kb_expected});
        @import("bun").Output.prettyErrorln("", .{});
        @import("bun").Output.prettyErrorln("This typically happens on systems configured with non-standard page sizes, such as:", .{});
        @import("bun").Output.prettyErrorln("  - Linux systems with 64 KB pages on ARM64 (RHEL, Oracle Linux, etc.)", .{});
        @import("bun").Output.prettyErrorln("  - Systems using large pages for performance tuning", .{});
        @import("bun").Output.prettyErrorln("", .{});
        @import("bun").Output.prettyErrorln("<b>Possible solutions:<r>", .{});
        @import("bun").Output.prettyErrorln("  1. Use a system with a standard page size configuration", .{});
        @import("bun").Output.prettyErrorln("  2. Reconfigure your kernel to use a smaller page size", .{});
        @import("bun").Output.prettyErrorln("  3. Build Bun from source with USE(64KB_PAGE_BLOCK) enabled", .{});
        @import("bun").Output.prettyErrorln("", .{});
        @import("bun").Output.prettyErrorln("For more information, visit: <cyan>https://bun.sh/docs/project/development<r>", .{});
        @import("bun").Output.flush();
        @import("bun").Global.exit(1);
    }
}

pub fn main() void {
    _bun.crash_handler.init();

    // Check if the system page size is supported by JavaScriptCore/WebKit
    // WebKit has hardcoded constants for different architectures that must
    // match or exceed the actual system page size at runtime.
    checkPageSizeSupport();

    if (Environment.isPosix) {
        var act: std.posix.Sigaction = .{
            .handler = .{ .handler = std.posix.SIG.IGN },
            .mask = std.posix.sigemptyset(),
            .flags = 0,
        };
        std.posix.sigaction(std.posix.SIG.PIPE, &act, null);
        std.posix.sigaction(std.posix.SIG.XFSZ, &act, null);
    }

    if (Environment.isDebug) {
        _bun.debug_allocator_data.backing = .init;
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
    _bun.initArgv(_bun.default_allocator) catch |err| {
        Output.panic("Failed to initialize argv: {s}\n", .{@errorName(err)});
    };

    Output.Source.Stdio.init();
    defer Output.flush();
    if (Environment.isX64 and Environment.enableSIMD and Environment.isPosix) {
        bun_warn_avx_missing(_bun.cli.UpgradeCommand.Bun__githubBaselineURL.ptr);
    }

    _bun.StackCheck.configureThread();

    _bun.cli.Cli.start(_bun.default_allocator);
    _bun.Global.exit(0);
}

pub export fn Bun__panic(msg: [*]const u8, len: usize) noreturn {
    Output.panic("{s}", .{msg[0..len]});
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
