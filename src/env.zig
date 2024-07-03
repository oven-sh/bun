const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;

pub const BuildTarget = enum { native, wasm, wasi };
pub const build_target: BuildTarget = brk: {
    if (@import("builtin").target.isWasm()) {
        break :brk BuildTarget.wasm;
    } else {
        break :brk BuildTarget.native;
    }
};

pub const isWasm = build_target == .wasm;
pub const isNative = build_target == .native;
pub const isWasi = build_target == .wasi;
pub const isMac = build_target == .native and @import("builtin").target.os.tag == .macos;
pub const isBrowser = !isWasi and isWasm;
pub const isWindows = @import("builtin").target.os.tag == .windows;
pub const isPosix = !isWindows and !isWasm;
pub const isDebug = std.builtin.Mode.Debug == @import("builtin").mode;
pub const isRelease = std.builtin.Mode.Debug != @import("builtin").mode and !isTest;
pub const isTest = @import("builtin").is_test;
pub const isLinux = @import("builtin").target.os.tag == .linux;
pub const isAarch64 = @import("builtin").target.cpu.arch.isAARCH64();
pub const isX86 = @import("builtin").target.cpu.arch.isX86();
pub const isX64 = @import("builtin").target.cpu.arch == .x86_64;
pub const allow_assert = isDebug or isTest or std.builtin.Mode.ReleaseSafe == @import("builtin").mode;

const BuildOptions = if (isTest) struct {
    pub const baseline = false;
    pub const sha = "0000000000000000000000000000000000000000";
    pub const is_canary = false;
    pub const base_path = "/tmp";
    pub const canary_revision = 0;
    pub const reported_nodejs_version = "22.3.0";
} else @import("root").build_options;

pub const reported_nodejs_version = BuildOptions.reported_nodejs_version;
pub const baseline = BuildOptions.baseline;
pub const enableSIMD: bool = !baseline;
pub const git_sha = BuildOptions.sha;
pub const git_sha_short = if (BuildOptions.sha.len > 0) BuildOptions.sha[0..9] else "";
pub const git_sha_shorter = if (BuildOptions.sha.len > 0) BuildOptions.sha[0..6] else "";
pub const is_canary = BuildOptions.is_canary;
pub const canary_revision = if (is_canary) BuildOptions.canary_revision else "";
pub const dump_source = isDebug and !isTest;
pub const base_path = BuildOptions.base_path ++ "/";
pub const enable_logs = BuildOptions.enable_logs or isDebug;

pub const version: std.SemanticVersion = BuildOptions.version;
pub const version_string = std.fmt.comptimePrint("{d}.{d}.{d}", .{ version.major, version.minor, version.patch });

pub inline fn onlyMac() void {
    if (comptime !isMac) {
        unreachable;
    }
}

pub const OperatingSystem = enum {
    mac,
    linux,
    windows,
    // wAsM is nOt aN oPeRaTiNg SyStEm
    wasm,

    pub const names = bun.ComptimeStringMap(OperatingSystem, &.{
        .{ "windows", .windows },
        .{ "win32", .windows },
        .{ "win", .windows },
        .{ "win64", .windows },
        .{ "win_x64", .windows },
        .{ "darwin", .mac },
        .{ "macos", .mac },
        .{ "macOS", .mac },
        .{ "mac", .mac },
        .{ "apple", .mac },
        .{ "linux", .linux },
        .{ "Linux", .linux },
        .{ "linux-gnu", .linux },
        .{ "gnu/linux", .linux },
        .{ "wasm", .wasm },
    });

    /// user-facing name with capitalization
    pub fn displayString(self: OperatingSystem) []const u8 {
        return switch (self) {
            .mac => "macOS",
            .linux => "Linux",
            .windows => "Windows",
            .wasm => "WASM",
        };
    }

    /// same format as `process.platform`
    pub fn nameString(self: OperatingSystem) []const u8 {
        return switch (self) {
            .mac => "darwin",
            .linux => "linux",
            .windows => "win32",
            .wasm => "wasm",
        };
    }

    pub fn stdOSTag(self: OperatingSystem) std.Target.Os.Tag {
        return switch (self) {
            .mac => .macos,
            .linux => .linux,
            .windows => .windows,
            .wasm => unreachable,
        };
    }

    /// npm package name, `@oven-sh/bun-{os}-{arch}`
    pub fn npmName(self: OperatingSystem) []const u8 {
        return switch (self) {
            .mac => "darwin",
            .linux => "linux",
            .windows => "windows",
            .wasm => "wasm",
        };
    }
};

pub const os: OperatingSystem = if (isMac)
    .mac
else if (isLinux)
    .linux
else if (isWindows)
    .windows
else if (isWasm)
    .wasm
else
    @compileError("Please add your OS to the OperatingSystem enum");

pub const Architecture = enum {
    x64,
    arm64,
    wasm,

    /// npm package name, `@oven-sh/bun-{os}-{arch}`
    pub fn npmName(this: Architecture) []const u8 {
        return switch (this) {
            .x64 => "x64",
            .arm64 => "aarch64",
            .wasm => "wasm",
        };
    }

    pub const names = bun.ComptimeStringMap(Architecture, &.{
        .{ "x86_64", .x64 },
        .{ "x64", .x64 },
        .{ "amd64", .x64 },
        .{ "aarch64", .arm64 },
        .{ "arm64", .arm64 },
        .{ "wasm", .wasm },
    });
};

pub const arch: Architecture = if (isWasm)
    .wasm
else if (isX64)
    .x64
else if (isAarch64)
    .arm64
else
    @compileError("Please add your architecture to the Architecture enum");
