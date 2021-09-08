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

pub const isAarch64 = std.Target.current.cpu.arch == .aarch64;