const std = @import("std");
pub const Environment = @import("env.zig");

pub const use_mimalloc = !Environment.isTest;

pub const default_allocator: std.mem.Allocator = if (!use_mimalloc)
    std.heap.c_allocator
else
    @import("./allocators/memory_allocator.zig").c_allocator;

pub const huge_allocator: std.mem.Allocator = if (!use_mimalloc)
    std.heap.c_allocator
else
    @import("./allocators/memory_allocator.zig").huge_allocator;

pub const auto_allocator: std.mem.Allocator = if (!use_mimalloc)
    std.heap.c_allocator
else
    @import("./allocators/memory_allocator.zig").auto_allocator;

pub const huge_allocator_threshold: comptime_int = @import("./allocators/memory_allocator.zig").huge_threshold;

pub const C = @import("c.zig");

pub const FeatureFlags = @import("feature_flags.zig");
const root = @import("root");
pub const meta = @import("./meta.zig");
pub const ComptimeStringMap = @import("./comptime_string_map.zig").ComptimeStringMap;
pub const base64 = @import("./base64/base64.zig");
pub const path = @import("./resolver/resolve_path.zig");

pub const Output = @import("./output.zig");

pub const FileDescriptorType = if (Environment.isBrowser) u0 else std.os.fd_t;

// When we are on a computer with an absurdly high number of max open file handles
// such is often the case with macOS
// As a useful optimization, we can store file descriptors and just keep them open...forever
pub const StoredFileDescriptorType = if (Environment.isWindows or Environment.isBrowser) u0 else std.os.fd_t;

pub const StringTypes = @import("string_types.zig");
pub const stringZ = StringTypes.stringZ;
pub const string = StringTypes.string;
pub const CodePoint = StringTypes.CodePoint;
pub const PathString = StringTypes.PathString;
pub const HashedString = StringTypes.HashedString;
pub const strings = @import("string_immutable.zig");
pub const MutableString = @import("string_mutable.zig").MutableString;
pub const RefCount = @import("./ref_count.zig").RefCount;

pub inline fn constStrToU8(s: []const u8) []u8 {
    return @intToPtr([*]u8, @ptrToInt(s.ptr))[0..s.len];
}

pub const MAX_PATH_BYTES: usize = if (Environment.isWasm) 1024 else std.fs.MAX_PATH_BYTES;

pub const IdentityContext = @import("./identity_context.zig").IdentityContext;
pub const ArrayIdentityContext = @import("./identity_context.zig").ArrayIdentityContext;
pub const BabyList = @import("./baby_list.zig").BabyList;
pub const ByteList = BabyList(u8);

pub fn DebugOnly(comptime Type: type) type {
    if (comptime Environment.isDebug) {
        return Type;
    }

    return void;
}

pub fn DebugOnlyDefault(comptime val: anytype) if (Environment.isDebug) @TypeOf(val) else void {
    if (comptime Environment.isDebug) {
        return val;
    }

    return {};
}

pub usingnamespace @import("./global_utils.zig");

pub const StringBuilder = @import("./string_builder.zig");

pub const LinearFifo = @import("./linear_fifo.zig").LinearFifo;

pub const Global = struct {
    pub const build_id = std.fmt.parseInt(u64, std.mem.trim(u8, @embedFile("../build-id"), "\n \r\t"), 10) catch unreachable;

    pub const package_json_version = if (Environment.isDebug)
        std.fmt.comptimePrint("0.1.{d}_debug", .{build_id})
    else
        std.fmt.comptimePrint("0.1.{d}", .{build_id});

    pub const package_json_version_with_sha = if (Environment.git_sha.len == 0)
        package_json_version
    else if (Environment.isDebug)
        std.fmt.comptimePrint("0.1.{d}_debug ({s})", .{ build_id, Environment.git_sha[0..8] })
    else
        std.fmt.comptimePrint("0.1.{d} ({s})", .{ build_id, Environment.git_sha[0..8] });

    pub const os_name = if (Environment.isWindows)
        "win32"
    else if (Environment.isMac)
        "darwin"
    else if (Environment.isLinux)
        "linux"
    else if (Environment.isWasm)
        "wasm"
    else
        "unknown";

    pub const arch_name = if (Environment.isX64)
        "x64"
    else if (Environment.isAarch64)
        "arm64"
    else
        "unknown";

    pub inline fn getStartTime() i128 {
        if (Environment.isTest) return 0;
        return @import("root").start_time;
    }

    pub const version: @import("./install/semver.zig").Version = .{
        .major = 0,
        .minor = 1,
        .patch = build_id,
    };

    pub fn setThreadName(name: StringTypes.stringZ) void {
        if (Environment.isLinux) {
            _ = std.os.prctl(.SET_NAME, .{@ptrToInt(name.ptr)}) catch 0;
        } else if (Environment.isMac) {
            _ = std.c.pthread_setname_np(name);
        }
    }

    pub fn exit(code: u8) noreturn {
        Output.flush();
        std.os.exit(code);
    }

    pub const AllocatorConfiguration = struct {
        verbose: bool = false,
        long_running: bool = false,
    };

    pub const Mimalloc = @import("./allocators/mimalloc.zig");

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

    pub fn panic(comptime fmt: string, args: anytype) noreturn {
        @setCold(true);
        if (comptime Environment.isWasm) {
            Output.printErrorln(fmt, args);
            Output.flush();
            @panic(fmt);
        } else {
            Output.prettyErrorln(fmt, args);
            Output.flush();
            std.debug.panic(fmt, args);
        }
    }

    // std.debug.assert but happens at runtime
    pub fn invariant(condition: bool, comptime fmt: string, args: anytype) void {
        if (!condition) {
            _invariant(fmt, args);
        }
    }

    inline fn _invariant(comptime fmt: string, args: anytype) noreturn {
        @setCold(true);

        if (comptime Environment.isWasm) {
            Output.printErrorln(fmt, args);
            Output.flush();
            @panic(fmt);
        } else {
            Output.prettyErrorln(fmt, args);
            exit(1);
        }
    }

    pub fn notimpl() noreturn {
        @setCold(true);
        panic("Not implemented yet!!!!!", .{});
    }

    // Make sure we always print any leftover
    pub fn crash() noreturn {
        @setCold(true);
        exit(1);
    }

    pub const BunInfo = struct {
        bun_version: string,
        platform: Analytics.GenerateHeader.GeneratePlatform.Platform = undefined,
        framework: string = "",
        framework_version: string = "",

        const Analytics = @import("./analytics/analytics_thread.zig");
        const JSON = @import("./json_parser.zig");
        const JSAst = @import("./js_ast.zig");

        pub fn generate(comptime Bundler: type, bundler: Bundler, allocator: std.mem.Allocator) !JSAst.Expr {
            var info = BunInfo{
                .bun_version = Global.package_json_version,
                .platform = Analytics.GenerateHeader.GeneratePlatform.forOS(),
            };

            if (bundler.options.framework) |framework| {
                info.framework = framework.package;
                info.framework_version = framework.version;
            }

            return try JSON.toAST(allocator, BunInfo, info);
        }
    };
};
