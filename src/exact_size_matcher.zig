const std = @import("std");
const bun = @import("root").bun;

pub fn ExactSizeMatcher(comptime max_bytes: usize) type {
    switch (max_bytes) {
        1, 2, 4, 8, 12, 16 => {},
        else => {
            @compileError("max_bytes must be 1, 2, 4, 8, 12, or 16.");
        },
    }

    const T = std.meta.Int(
        .unsigned,
        max_bytes * 8,
    );

    return struct {
        pub fn match(str: anytype) T {
            switch (str.len) {
                1...max_bytes - 1 => {
                    var tmp: [max_bytes]u8 = undefined;
                    if (comptime bun.trait.isSlice(@TypeOf(str))) {
                        @memcpy(tmp[0..str.len], str);
                        @memset(tmp[str.len..], 0);
                    } else {
                        @memcpy(tmp[0..str.len], str);
                        @memset(tmp[str.len..], 0);
                    }

                    return std.mem.readInt(T, &tmp, .little);
                },
                max_bytes => {
                    return std.mem.readInt(T, str[0..max_bytes], .little);
                },
                0 => {
                    return 0;
                },
                else => {
                    return std.math.maxInt(T);
                },
            }
        }

        pub fn matchLower(str: anytype) T {
            switch (str.len) {
                1...max_bytes - 1 => {
                    var tmp: [max_bytes]u8 = undefined;
                    for (str, 0..) |char, i| {
                        tmp[i] = std.ascii.toLower(char);
                    }
                    @memset(tmp[str.len..], 0);
                    return std.mem.readInt(T, &tmp, .little);
                },
                max_bytes => {
                    return std.mem.readInt(T, str[0..max_bytes], .little);
                },
                0 => {
                    return 0;
                },
                else => {
                    return std.math.maxInt(T);
                },
            }
        }

        pub fn case(comptime str: []const u8) T {
            if (str.len < max_bytes) {
                var bytes = std.mem.zeroes([max_bytes]u8);
                bytes[0..str.len].* = str[0..str.len].*;
                return std.mem.readInt(T, &bytes, .little);
            } else if (str.len == max_bytes) {
                return std.mem.readInt(T, str[0..str.len], .little);
            } else {
                @compileError("str: \"" ++ str ++ "\" too long");
            }
        }
    };
}

const eight = ExactSizeMatcher(8);
const expect = std.testing.expect;
