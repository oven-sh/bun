const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const FeatureFlags = bun.FeatureFlags;
const C = bun.C;

const sync = @import("../sync.zig");
const std = @import("std");
const HTTP = bun.http;

const URL = @import("../url.zig").URL;
const Fs = @import("../fs.zig");
const Analytics = @import("./analytics_schema.zig").analytics;
const Writer = @import("./analytics_schema.zig").Writer;
const Headers = bun.http.Headers;
const Futex = @import("../futex.zig");
const Semver = @import("../install/semver.zig");

/// Enables analytics. This is used by:
/// - crash_handler.zig's `report` function to anonymously report crashes
///
/// Since this field can be .unknown, it makes more sense to call `isEnabled`
/// instead of processing this field directly.
pub var enabled: enum { yes, no, unknown } = .unknown;
pub var is_ci: enum { yes, no, unknown } = .unknown;

pub fn isEnabled() bool {
    return switch (enabled) {
        .yes => true,
        .no => false,
        .unknown => {
            enabled = detect: {
                if (bun.getenvZ("DO_NOT_TRACK")) |x| {
                    if (x.len == 1 and x[0] == '1') {
                        break :detect .no;
                    }
                }
                if (bun.getenvZ("HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET") != null) {
                    break :detect .no;
                }
                break :detect .yes;
            };
            bun.assert(enabled == .yes or enabled == .no);
            return enabled == .yes;
        },
    };
}

pub fn isCI() bool {
    return switch (is_ci) {
        .yes => true,
        .no => false,
        .unknown => {
            is_ci = detect: {
                inline for (.{
                    "CI",
                    "TDDIUM",
                    "GITHUB_ACTIONS",
                    "JENKINS_URL",
                    "bamboo.buildKey",
                }) |key| {
                    if (bun.getenvZ(key) != null) {
                        break :detect .yes;
                    }
                }
                break :detect .no;
            };
            bun.assert(is_ci == .yes or is_ci == .no);
            return is_ci == .yes;
        },
    };
}

/// This answers, "What parts of bun are people actually using?"
pub const Features = struct {
    pub var builtin_modules = std.enums.EnumSet(bun.JSC.HardcodedModule).initEmpty();

    pub var @"Bun.stderr": usize = 0;
    pub var @"Bun.stdin": usize = 0;
    pub var @"Bun.stdout": usize = 0;
    pub var WebSocket: usize = 0;
    pub var abort_signal: usize = 0;
    pub var binlinks: usize = 0;
    pub var bunfig: usize = 0;
    pub var define: usize = 0;
    pub var dotenv: usize = 0;
    pub var external: usize = 0;
    pub var extracted_packages: usize = 0;
    pub var fetch: usize = 0;
    pub var git_dependencies: usize = 0;
    pub var html_rewriter: usize = 0;
    pub var http_server: usize = 0;
    pub var https_server: usize = 0;
    /// Set right before JSC::initialize is called
    pub var jsc: usize = 0;
    /// Set when bake.DevServer is initialized
    pub var dev_server: usize = 0;
    pub var lifecycle_scripts: usize = 0;
    pub var loaders: usize = 0;
    pub var lockfile_migration_from_package_lock: usize = 0;
    pub var text_lockfile: usize = 0;
    pub var macros: usize = 0;
    pub var no_avx2: usize = 0;
    pub var no_avx: usize = 0;
    pub var shell: usize = 0;
    pub var spawn: usize = 0;
    pub var standalone_executable: usize = 0;
    pub var standalone_shell: usize = 0;
    /// Set when invoking a todo panic
    pub var todo_panic: usize = 0;
    pub var transpiler_cache: usize = 0;
    pub var tsconfig: usize = 0;
    pub var tsconfig_paths: usize = 0;
    pub var virtual_modules: usize = 0;
    pub var workers_spawned: usize = 0;
    pub var workers_terminated: usize = 0;
    pub var napi_module_register: usize = 0;
    pub var process_dlopen: usize = 0;

    comptime {
        @export(napi_module_register, .{ .name = "Bun__napi_module_register_count" });
        @export(process_dlopen, .{ .name = "Bun__process_dlopen_count" });
    }

    pub fn formatter() Formatter {
        return Formatter{};
    }

    pub const Formatter = struct {
        pub fn format(_: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const fields = comptime brk: {
                const info: std.builtin.Type = @typeInfo(Features);
                var buffer: [info.Struct.decls.len][]const u8 = .{""} ** info.Struct.decls.len;
                var count: usize = 0;
                for (info.Struct.decls) |decl| {
                    var f = &@field(Features, decl.name);
                    _ = &f;
                    const Field = @TypeOf(f);
                    const FieldT: std.builtin.Type = @typeInfo(Field);
                    if (FieldT.Pointer.child != usize) continue;
                    buffer[count] = decl.name;
                    count += 1;
                }

                break :brk buffer[0..count];
            };

            var is_first_feature = true;
            inline for (fields) |field| {
                const count = @field(Features, field);
                if (count > 0) {
                    if (is_first_feature) {
                        try writer.writeAll("Features: ");
                        is_first_feature = false;
                    }
                    try writer.writeAll(field);
                    if (count > 1) {
                        try writer.print("({d}) ", .{count});
                    } else {
                        try writer.writeAll(" ");
                    }
                }
            }
            if (!is_first_feature) {
                try writer.writeAll("\n");
            }

            var builtins = builtin_modules.iterator();
            if (builtins.next()) |first| {
                try writer.writeAll("Builtins: \"");
                try writer.writeAll(@tagName(first));
                try writer.writeAll("\" ");

                while (builtins.next()) |key| {
                    try writer.writeAll("\"");
                    try writer.writeAll(@tagName(key));
                    try writer.writeAll("\" ");
                }

                try writer.writeAll("\n");
            }
        }
    };
};

pub fn validateFeatureName(name: []const u8) void {
    if (name.len > 64) @compileError("Invalid feature name: " ++ name);
    for (name) |char| {
        switch (char) {
            'a'...'z', 'A'...'Z', '0'...'9', '_', '.', ':', '-' => {},
            else => @compileError("Invalid feature name: " ++ name),
        }
    }
}

pub const packed_features_list = brk: {
    const decls = std.meta.declarations(Features);
    var names: [decls.len][:0]const u8 = undefined;
    var i = 0;
    for (decls) |decl| {
        if (@TypeOf(@field(Features, decl.name)) == usize) {
            validateFeatureName(decl.name);
            names[i] = decl.name;
            i += 1;
        }
    }
    break :brk names[0..i].*;
};

pub const PackedFeatures = @Type(.{
    .Struct = .{
        .layout = .@"packed",
        .backing_integer = u64,
        .fields = brk: {
            var fields: [64]std.builtin.Type.StructField = undefined;
            var i: usize = 0;
            for (packed_features_list) |name| {
                fields[i] = .{
                    .name = name,
                    .type = bool,
                    .default_value = &false,
                    .is_comptime = false,
                    .alignment = 0,
                };
                i += 1;
            }
            while (i < fields.len) : (i += 1) {
                fields[i] = .{
                    .name = std.fmt.comptimePrint("_{d}", .{i}),
                    .type = bool,
                    .default_value = &false,
                    .is_comptime = false,
                    .alignment = 0,
                };
            }
            break :brk &fields;
        },
        .decls = &.{},
        .is_tuple = false,
    },
});

pub fn packedFeatures() PackedFeatures {
    var bits = PackedFeatures{};
    inline for (packed_features_list) |name| {
        if (@field(Features, name) > 0) {
            @field(bits, name) = true;
        }
    }
    return bits;
}

pub const EventName = enum(u8) {
    bundle_success,
    bundle_fail,
    bundle_start,
    http_start,
    http_build,
};

var random: std.rand.DefaultPrng = undefined;
const DotEnv = @import("../env_loader.zig");

const platform_arch = if (Environment.isAarch64) Analytics.Architecture.arm else Analytics.Architecture.x64;

// TODO: move this code somewhere more appropriate, and remove it from "analytics"
// The following code is not currently even used for analytics, just feature-detection
// in order to determine if certain APIs are usable.
pub const GenerateHeader = struct {
    pub const GeneratePlatform = struct {
        var osversion_name: [32]u8 = undefined;
        fn forMac() Analytics.Platform {
            @memset(&osversion_name, 0);

            var platform = Analytics.Platform{ .os = Analytics.OperatingSystem.macos, .version = &[_]u8{}, .arch = platform_arch };
            var len = osversion_name.len - 1;
            // this previously used "kern.osrelease", which was the darwin xnu kernel version
            // That is less useful than "kern.osproductversion", which is the macOS version
            if (std.c.sysctlbyname("kern.osproductversion", &osversion_name, &len, null, 0) == -1) return platform;

            platform.version = bun.sliceTo(&osversion_name, 0);
            return platform;
        }

        pub var linux_os_name: std.c.utsname = undefined;
        var platform_: Analytics.Platform = undefined;
        pub const Platform = Analytics.Platform;
        var linux_kernel_version: Semver.Version = undefined;
        var run_once = std.once(struct {
            fn run() void {
                if (comptime Environment.isMac) {
                    platform_ = forMac();
                } else if (comptime Environment.isPosix) {
                    platform_ = forLinux();

                    const release = bun.sliceTo(&linux_os_name.release, 0);
                    const sliced_string = Semver.SlicedString.init(release, release);
                    const result = Semver.Version.parse(sliced_string);
                    linux_kernel_version = result.version.min();
                } else if (Environment.isWindows) {
                    platform_ = Platform{
                        .os = Analytics.OperatingSystem.windows,
                        .version = &[_]u8{},
                        .arch = platform_arch,
                    };
                }
            }
        }.run);

        pub fn forOS() Analytics.Platform {
            run_once.call();
            return platform_;
        }

        // On macOS 13, tests that use sendmsg_x or recvmsg_x hang.
        var use_msgx_on_macos_14_or_later: bool = undefined;
        var detectUseMsgXOnMacOS14OrLater_once = std.once(detectUseMsgXOnMacOS14OrLater);
        fn detectUseMsgXOnMacOS14OrLater() void {
            const version = Semver.Version.parseUTF8(forOS().version);
            use_msgx_on_macos_14_or_later = version.valid and version.version.max().major >= 14;
        }
        pub export fn Bun__doesMacOSVersionSupportSendRecvMsgX() i32 {
            if (comptime !Environment.isMac) {
                // this should not be used on non-mac platforms.
                return 0;
            }

            detectUseMsgXOnMacOS14OrLater_once.call();
            return @intFromBool(use_msgx_on_macos_14_or_later);
        }

        pub fn kernelVersion() Semver.Version {
            if (comptime !Environment.isLinux) {
                @compileError("This function is only implemented on Linux");
            }
            _ = forOS();

            return linux_kernel_version;
        }

        export fn Bun__isEpollPwait2SupportedOnLinuxKernel() i32 {
            if (comptime !Environment.isLinux) {
                return 0;
            }

            // https://man.archlinux.org/man/epoll_pwait2.2.en#HISTORY
            const min_epoll_pwait2 = Semver.Version{
                .major = 5,
                .minor = 11,
                .patch = 0,
            };

            return switch (kernelVersion().order(min_epoll_pwait2, "", "")) {
                .gt => 1,
                .eq => 1,
                .lt => 0,
            };
        }

        fn forLinux() Analytics.Platform {
            linux_os_name = std.mem.zeroes(@TypeOf(linux_os_name));

            _ = std.c.uname(&linux_os_name);

            // Confusingly, the "release" tends to contain the kernel version much more frequently than the "version" field.
            const release = bun.sliceTo(&linux_os_name.release, 0);

            // Linux DESKTOP-P4LCIEM 5.10.16.3-microsoft-standard-WSL2 #1 SMP Fri Apr 2 22:23:49 UTC 2021 x86_64 x86_64 x86_64 GNU/Linux
            if (std.mem.indexOf(u8, release, "microsoft") != null) {
                return Analytics.Platform{ .os = Analytics.OperatingSystem.wsl, .version = release, .arch = platform_arch };
            }

            return Analytics.Platform{ .os = Analytics.OperatingSystem.linux, .version = release, .arch = platform_arch };
        }
    };
};
