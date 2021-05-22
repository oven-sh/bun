const std = @import("std");

pub fn ExactSizeMatcher(comptime max_bytes: usize) type {
    switch (max_bytes) {
        1, 2, 4, 8, 12 => {},
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
                    var tmp = std.mem.zeroes([max_bytes]u8);
                    std.mem.copy(u8, &tmp, str[0..str.len]);
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
                const slice_bytes = std.mem.sliceAsBytes(str);
                std.mem.copy(u8, &bytes, slice_bytes);
                return std.mem.readIntNative(T, &bytes);
            } else if (str.len == max_bytes) {
                return std.mem.readIntNative(T, str[0..str.len]);
            } else {
                @compileError("str is " ++ str.len ++ " bytes but expected " ++ max_bytes ++ " bytes");
            }
        }

        fn hash(comptime str: anytype) ?T {
            if (str.len > max_bytes) return null;
            var tmp = [_]u8{0} ** max_bytes;
            std.mem.copy(u8, &tmp, str[0..str.len]);
            return std.mem.readIntNative(T, &tmp);
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
    const word = "from";
    try expect(Four.match(word) == Four.case("from"));
    try expect(Four.match(word) != Four.case("fro"));
}
