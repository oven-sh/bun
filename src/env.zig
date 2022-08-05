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
pub const baseline = @import("build_options").baseline;
pub const enableSIMD: bool = !baseline;
pub const git_sha = @import("build_options").sha;
pub const is_canary = @import("build_options").is_canary;
