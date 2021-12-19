const std = @import("std");

pub const BuildTarget = enum { native, wasm, wasi };
pub const build_target: BuildTarget = brk: {
    if (std.Target.current.isWasm() and std.Target.current.getOsTag() == .wasi) {
        break :brk BuildTarget.wasi;
    } else if (std.Target.current.isWasm()) {
        break :brk BuildTarget.wasm;
    } else {
        break :brk BuildTarget.native;
    }
};

pub const isWasm = build_target == .wasm;
pub const isNative = build_target == .native;
pub const isWasi = build_target == .wasi;
pub const isMac = build_target == .native and std.Target.current.os.tag == .macos;
pub const isBrowser = !isWasi and isWasm;
pub const isWindows = std.Target.current.os.tag == .windows;
pub const isDebug = std.builtin.Mode.Debug == std.builtin.mode;
pub const isRelease = std.builtin.Mode.Debug != std.builtin.mode and !isTest;
pub const isTest = std.builtin.is_test;
pub const isLinux = std.Target.current.os.tag == .linux;
pub const isAarch64 = std.Target.current.cpu.arch.isAARCH64();
pub const isX86 = std.Target.current.cpu.arch.isX86();
pub const isX64 = std.Target.current.cpu.arch == .x86_64;
pub const allow_assert = isDebug or isTest;
pub const analytics_url = if (isDebug) "http://localhost:4000/events" else "http://i.bun.sh/events";
