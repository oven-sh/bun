const std = @import("std");
const builtin = @import("builtin");

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
pub const isDebug = std.builtin.Mode.Debug == @import("builtin").mode;
pub const isRelease = std.builtin.Mode.Debug != @import("builtin").mode and !isTest;
pub const isTest = @import("builtin").is_test;
pub const isLinux = @import("builtin").target.os.tag == .linux;
pub const isAarch64 = @import("builtin").target.cpu.arch.isAARCH64();
pub const isX86 = @import("builtin").target.cpu.arch.isX86();
pub const isX64 = @import("builtin").target.cpu.arch == .x86_64;
pub const allow_assert = isDebug or isTest;
pub const analytics_url = if (isDebug) "http://localhost:4000/events" else "http://i.bun.sh/events";

const BuildOptions = if (isTest) struct {
    pub const baseline = false;
    pub const sha = "0000000000000000000000000000000000000000";
    pub const is_canary = false;
} else @import("build_options");

pub const baseline = BuildOptions.baseline;
pub const enableSIMD: bool = !baseline;
pub const git_sha = BuildOptions.sha;
pub const is_canary = BuildOptions.is_canary;
pub const dump_source = isDebug and !isTest;
