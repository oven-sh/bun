fn NewTimer() type {
    if (Environment.isWasm) {
        return struct {
            pub fn start() anyerror!@This() {
                return @This(){};
            }

            pub fn read(_: anytype) u64 {
                @compileError("FeatureFlags.tracing should be disabled in WASM");
            }

            pub fn lap(_: anytype) u64 {
                @compileError("FeatureFlags.tracing should be disabled in WASM");
            }

            pub fn reset(_: anytype) u64 {
                @compileError("FeatureFlags.tracing should be disabled in WASM");
            }
        };
    }

    return std.time.Timer;
}
pub const Timer = NewTimer();

const Environment = @import("./env.zig");
const std = @import("std");
