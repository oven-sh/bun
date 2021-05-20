const std = @import("std");

pub fn ExactSizeMatcher(comptime max_bytes: usize) type {
    const T = std.meta.Int(
        .unsigned,
        max_bytes * 8,
    );

    return struct {
        pub fn match(str: anytype) T {
            return hash(str) orelse std.math.maxInt(T);
        }

        pub fn case(comptime str: []const u8) T {
            return hash(str) orelse std.math.maxInt(T);
        }

        pub fn hash(str: anytype) ?T {
            if (str.len > max_bytes) return null;
            var tmp = [_]u8{0} ** max_bytes;
            std.mem.copy(u8, &tmp, str[0..str.len]);
            return std.mem.readIntNative(T, &tmp);
        }

        pub fn hashUnsafe(str: anytype) T {
            var tmp = [_]u8{0} ** max_bytes;
            std.mem.copy(u8, &tmp, str[0..str.len]);
            return std.mem.readIntNative(T, &tmp);
        }
    };
}

const eight = ExactSizeMatcher(8);

test "ExactSizeMatcher 5 letter" {
    const word = "yield";
    expect(eight.match(word) == eight.case("yield"));
    expect(eight.match(word) != eight.case("yields"));
}

test "ExactSizeMatcher 4 letter" {
    const Four = ExactSizeMatcher(4);
    const word = "from";
    expect(Four.match(word) == Four.case("from"));
    expect(Four.match(word) != Four.case("fro"));
}
