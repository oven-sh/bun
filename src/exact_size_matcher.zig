const std = @import("std");

pub fn ExactSizeMatcher(comptime max_bytes: usize) type {
    switch (max_bytes) {
        1, 2, 4, 8, 12, 16 => {},
        else => {
            @compileError("max_bytes must be 1, 2, 4, 8, or 12.");
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
                    if (comptime std.meta.trait.isSlice(@TypeOf(str))) {
                        @memcpy(&tmp, str.ptr, str.len);
                        @memset(tmp[str.len..].ptr, 0, tmp[str.len..].len);
                    } else {
                        @memcpy(&tmp, str, str.len);
                        @memset(tmp[str.len..], 0, tmp[str.len..].len);
                    }

                    return std.mem.readIntNative(T, &tmp);
                },
                max_bytes => {
                    return std.mem.readIntSliceNative(T, str[0..]);
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
                    @memset(tmp[str.len..].ptr, 0, tmp[str.len..].len);
                    return std.mem.readIntNative(T, &tmp);
                },
                max_bytes => {
                    return std.mem.readIntSliceNative(T, str);
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
                return std.mem.readIntNative(T, &bytes);
            } else if (str.len == max_bytes) {
                return std.mem.readIntNative(T, str[0..str.len]);
            } else {
                @compileError("str: \"" ++ str ++ "\" too long");
            }
        }
    };
}

const eight = ExactSizeMatcher(8);
const expect = std.testing.expect;
test "ExactSizeMatcher 5 letter" {
    const word = "yield";
    try expect(eight.match(word) == eight.case("yield"));
    try expect(eight.match(word) != eight.case("yields"));
}

test "ExactSizeMatcher 4 letter" {
    const Four = ExactSizeMatcher(4);
    var word = "from".*;
    try expect(Four.match(word) == Four.case("from"));
    try expect(Four.match(word) != Four.case("fro"));
}

test "ExactSizeMatcher 12 letter" {
    const Four = ExactSizeMatcher(12);
    const word = "from";
    try expect(Four.match(word) == Four.case("from"));
    try expect(Four.match(word) != Four.case("fro"));
}
