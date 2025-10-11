//! Unified module for controlling and managing environment variables in Bun.

pub const home = new("home", "HOME", "UserProfile");

fn new(
    comptime name: []const u8,
    comptime posix_key: ?[:0]const u8,
    comptime windows_key: ?[:0]const u8,
) type {
    if (posix_key == null and windows_key == null) {
        @compileError("Environment variable " ++ name ++ " has no keys for POSIX nor Windows " ++
            "specified. Provide a key for either POSIX or Windows.");
    }

    return struct {
        const PtrType = ?[*]const u8;
        const LengthType = u64;

        /// Indicates an environment variable hasn't been loaded yet.
        const undefined_sentinel: LengthType = std.math.maxInt(LengthType);

        /// Indicates an environment variable isn't set from the outside.
        const null_sentinel: PtrType = @ptrFromInt(0x0);

        var value: std.atomic.Value(PtrType) = std.atomic.Value(PtrType).init(null_sentinel);
        var value_len: std.atomic.Value(u64) = .init(std.math.maxInt(LengthType));

        pub fn get() ?[]const u8 {
            assertPlatformSupported();

            const len = value_len.load(.monotonic);
            if (len == undefined_sentinel) {
                return getForceReload();
            }

            const v: PtrType = value.load(.monotonic);
            if (v == null) {
                return null;
            }

            return v.?[0..len];
        }

        pub fn getForceReload() ?[]const u8 {
            assertPlatformSupported();

            const env_var = bun.getenvZ(platformKey());

            if (env_var) |ev| {
                value.store(ev.ptr, .monotonic);
                value_len.store(ev.len, .monotonic);
            } else {
                value.store(null_sentinel, .monotonic);
                value_len.store(0, .monotonic);
            }

            return env_var;
        }

        fn platformKey() [:0]const u8 {
            return if (bun.Environment.isWindows) windows_key.? else posix_key.?;
        }

        fn assertPlatformSupported() void {
            const missing_key_fmt = "Cannot retrieve the value of " ++ name ++ " for {} " ++
                "since no {} key is associated with it.";
            if (comptime bun.Environment.isWindows and windows_key == null) {
                @compileError(std.fmt.comptimePrint(missing_key_fmt, .{ "Windows", "Windows" }));
            } else if (posix_key == null) {
                @compileError(std.fmt.comptimePrint(missing_key_fmt, .{ "POSIX", "POSIX" }));
            }
        }
    };
}

const bun = @import("bun");
const std = @import("std");
