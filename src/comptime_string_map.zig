const std = @import("std");
const mem = std.mem;
const strings = @import("./string_immutable.zig");

/// Comptime string map optimized for small sets of disparate string keys.
/// Works by separating the keys by length at comptime and only checking strings of
/// equal length at runtime.
///
/// `kvs` expects a list literal containing list literals or an array/slice of structs
/// where `.@"0"` is the `[]const u8` key and `.@"1"` is the associated value of type `V`.
/// TODO: https://github.com/ziglang/zig/issues/4335
pub fn ComptimeStringMapWithKeyType(comptime KeyType: type, comptime V: type, comptime kvs_list: anytype) type {
    const KV = struct {
        key: []const KeyType,
        value: V,
    };

    const precomputed = comptime blk: {
        @setEvalBranchQuota(99999);

        var sorted_kvs: [kvs_list.len]KV = undefined;
        const lenAsc = (struct {
            fn lenAsc(context: void, a: KV, b: KV) bool {
                _ = context;
                if (a.key.len != b.key.len) {
                    return a.key.len < b.key.len;
                }
                // https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array
                @setEvalBranchQuota(99999);
                return std.mem.order(KeyType, a.key, b.key) == .lt;
            }
        }).lenAsc;
        if (KeyType == u8) {
            for (kvs_list) |kv, i| {
                if (V != void) {
                    sorted_kvs[i] = .{ .key = kv.@"0", .value = kv.@"1" };
                } else {
                    sorted_kvs[i] = .{ .key = kv.@"0", .value = {} };
                }
            }
        } else {
            @compileError("Not implemented for this key type");
        }
        std.sort.sort(KV, &sorted_kvs, {}, lenAsc);
        const min_len = sorted_kvs[0].key.len;
        const max_len = sorted_kvs[sorted_kvs.len - 1].key.len;
        var len_indexes: [max_len + 1]usize = undefined;
        var len: usize = 0;
        var i: usize = 0;

        while (len <= max_len) : (len += 1) {
            @setEvalBranchQuota(99999);

            // find the first keyword len == len
            while (len > sorted_kvs[i].key.len) {
                i += 1;
            }
            len_indexes[len] = i;
        }
        break :blk .{
            .min_len = min_len,
            .max_len = max_len,
            .sorted_kvs = sorted_kvs,
            .len_indexes = len_indexes,
        };
    };

    return struct {
        const len_indexes = precomputed.len_indexes;
        pub const kvs = precomputed.sorted_kvs;

        pub fn has(str: []const KeyType) bool {
            return get(str) != null;
        }

        pub fn getWithLength(str: []const KeyType, comptime len: usize) ?V {
            const end = comptime brk: {
                var i = len_indexes[len];
                @setEvalBranchQuota(99999);

                while (i < kvs.len and kvs[i].key.len == len) : (i += 1) {}

                break :brk i;
            };

            comptime var i = len_indexes[len];

            // This benchmarked faster for both small and large lists of strings than using a big switch statement
            // But only so long as the keys are a sorted list.
            inline while (i < end) : (i += 1) {
                if (strings.eqlComptimeCheckLenWithType(KeyType, str, kvs[i].key, false)) {
                    return kvs[i].value;
                }
            }

            return null;
        }

        pub fn getWithLengthAndEql(str: anytype, comptime len: usize, comptime eqls: anytype) ?V {
            const end = comptime brk: {
                var i = len_indexes[len];
                @setEvalBranchQuota(99999);

                while (i < kvs.len and kvs[i].key.len == len) : (i += 1) {}

                break :brk i;
            };

            comptime var i = len_indexes[len];

            // This benchmarked faster for both small and large lists of strings than using a big switch statement
            // But only so long as the keys are a sorted list.
            inline while (i < end) : (i += 1) {
                if (eqls(str, kvs[i].key)) {
                    return kvs[i].value;
                }
            }

            return null;
        }

        pub fn get(str: []const KeyType) ?V {
            if (str.len < precomputed.min_len or str.len > precomputed.max_len)
                return null;

            comptime var i: usize = precomputed.min_len;
            inline while (i <= precomputed.max_len) : (i += 1) {
                if (str.len == i) {
                    return getWithLength(str, i);
                }
            }

            return null;
        }

        pub fn getWithEql(input: anytype, comptime eql: anytype) ?V {
            if (input.len < precomputed.min_len or input.len > precomputed.max_len)
                return null;

            comptime var i: usize = precomputed.min_len;
            inline while (i <= precomputed.max_len) : (i += 1) {
                if (input.len == i) {
                    return getWithLengthAndEql(input, i, eql);
                }
            }

            return null;
        }
    };
}

pub fn ComptimeStringMap(comptime V: type, comptime kvs_list: anytype) type {
    return ComptimeStringMapWithKeyType(u8, V, kvs_list);
}

pub fn ComptimeStringMap16(comptime V: type, comptime kvs_list: anytype) type {
    return ComptimeStringMapWithKeyType(u16, V, kvs_list);
}

const TestEnum = enum {
    A,
    B,
    C,
    D,
    E,
};

test "ComptimeStringMap list literal of list literals" {
    const map = ComptimeStringMap(TestEnum, .{
        .{ "these", .D },
        .{ "have", .A },
        .{ "nothing", .B },
        .{ "incommon", .C },
        .{ "samelen", .E },
    });

    try testMap(map);
}

test "ComptimeStringMap array of structs" {
    const KV = struct {
        @"0": []const u8,
        @"1": TestEnum,
    };
    const map = ComptimeStringMap(TestEnum, [_]KV{
        .{ .@"0" = "these", .@"1" = .D },
        .{ .@"0" = "have", .@"1" = .A },
        .{ .@"0" = "nothing", .@"1" = .B },
        .{ .@"0" = "incommon", .@"1" = .C },
        .{ .@"0" = "samelen", .@"1" = .E },
    });

    try testMap(map);
}

test "ComptimeStringMap slice of structs" {
    const KV = struct {
        @"0": []const u8,
        @"1": TestEnum,
    };
    const slice: []const KV = &[_]KV{
        .{ .@"0" = "these", .@"1" = .D },
        .{ .@"0" = "have", .@"1" = .A },
        .{ .@"0" = "nothing", .@"1" = .B },
        .{ .@"0" = "incommon", .@"1" = .C },
        .{ .@"0" = "samelen", .@"1" = .E },
    };
    const map = ComptimeStringMap(TestEnum, slice);

    try testMap(map);
}

fn testMap(comptime map: anytype) !void {
    try std.testing.expectEqual(TestEnum.A, map.get("have").?);
    try std.testing.expectEqual(TestEnum.B, map.get("nothing").?);
    try std.testing.expect(null == map.get("missing"));
    try std.testing.expectEqual(TestEnum.D, map.get("these").?);
    try std.testing.expectEqual(TestEnum.E, map.get("samelen").?);

    try std.testing.expect(!map.has("missing"));
    try std.testing.expect(map.has("these"));
}

test "ComptimeStringMap void value type, slice of structs" {
    const KV = struct {
        @"0": []const u8,
    };
    const slice: []const KV = &[_]KV{
        .{ .@"0" = "these" },
        .{ .@"0" = "have" },
        .{ .@"0" = "nothing" },
        .{ .@"0" = "incommon" },
        .{ .@"0" = "samelen" },
    };
    const map = ComptimeStringMap(void, slice);

    try testSet(map);
}

test "ComptimeStringMap void value type, list literal of list literals" {
    const map = ComptimeStringMap(void, .{
        .{"these"},
        .{"have"},
        .{"nothing"},
        .{"incommon"},
        .{"samelen"},
    });

    try testSet(map);
}

fn testSet(comptime map: anytype) !void {
    try std.testing.expectEqual({}, map.get("have").?);
    try std.testing.expectEqual({}, map.get("nothing").?);
    try std.testing.expect(null == map.get("missing"));
    try std.testing.expectEqual({}, map.get("these").?);
    try std.testing.expectEqual({}, map.get("samelen").?);

    try std.testing.expect(!map.has("missing"));
    try std.testing.expect(map.has("these"));
}

const TestEnum2 = enum {
    A,
    B,
    C,
    D,
    E,
    F,
    G,
    H,
    I,
    J,
    K,
    L,
    M,
    N,
    O,
    P,
    Q,
    R,
    S,
    T,
    U,
    V,
    W,
    X,
    Y,
    FZ,
    FA,
    FB,
    FC,
    FD,
    FE,
    FF,
    FG,
    FH,
    FI,
    FJ,
    FK,
    FL,

    pub const map = ComptimeStringMap(TestEnum2, .{
        .{ "these", .A },
        .{ "have", .B },
        .{ "nothing", .C },
        .{ "nothinz", .D },
        .{ "nothinc", .E },
        .{ "nothina", .F },
        .{ "nothinb", .G },
        .{ "nothiaa", .H },
        .{ "nothaaa", .I },
        .{ "notaaaa", .J },
        .{ "noaaaaa", .K },
        .{ "naaaaaa", .L },
        .{ "incommon", .M },
        .{ "ancommon", .N },
        .{ "ab1ommon", .O },
        .{ "ab2ommon", .P },
        .{ "ab3ommon", .Q },
        .{ "ab4ommon", .R },
        .{ "ab5ommon", .S },
        .{ "ab6ommon", .T },
        .{ "ab7ommon", .U },
        .{ "ab8ommon", .V },
        .{ "ab9ommon", .W },
        .{ "abAommon", .X },
        .{ "abBommon", .Y },
        .{ "abCommon", .FZ },
        .{ "abZommon", .FA },
        .{ "abEommon", .FB },
        .{ "abFommon", .FC },
        .{ "ab10omon", .FD },
        .{ "ab11omon", .FE },
        .{ "ab12omon", .FF },
        .{ "ab13omon", .FG },
        .{ "ab14omon", .FH },
        .{ "ab15omon", .FI },
        .{ "ab16omon", .FJ },
        .{ "ab16omon1", .FH },
        .{ "samelen", .FK },
        .{ "0", .FL },
        .{ "00", .FL },
    });

    pub const official = std.ComptimeStringMap(TestEnum2, .{
        .{ "these", .A },
        .{ "have", .B },
        .{ "naaaaaa", .L },
        .{ "noaaaaa", .K },
        .{ "notaaaa", .J },
        .{ "nothaaa", .I },
        .{ "nothiaa", .H },
        .{ "nothina", .F },
        .{ "nothinb", .G },
        .{ "nothinc", .E },
        .{ "nothing", .C },
        .{ "nothinz", .D },
        .{ "incommon", .M },
        .{ "ancommon", .N },
        .{ "ab1ommon", .O },
        .{ "ab2ommon", .P },
        .{ "ab3ommon", .Q },
        .{ "ab4ommon", .R },
        .{ "ab5ommon", .S },
        .{ "ab6ommon", .T },
        .{ "ab7ommon", .U },
        .{ "ab8ommon", .V },
        .{ "ab9ommon", .W },
        .{ "abAommon", .X },
        .{ "abBommon", .Y },
        .{ "abCommon", .FZ },
        .{ "abZommon", .FA },
        .{ "abEommon", .FB },
        .{ "abFommon", .FC },
        .{ "ab10omon", .FD },
        .{ "ab11omon", .FE },
        .{ "ab12omon", .FF },
        .{ "ab13omon", .FG },
        .{ "ab14omon", .FH },
        .{ "ab15omon", .FI },
        .{ "ab16omon", .FJ },
        .{ "samelen", .FK },
        .{ "ab16omon1", .FH },
        .{ "0", .FL },
        .{ "00", .FL },
    });
};

pub fn compareString(input: []const u8) !void {
    var str = try std.heap.page_allocator.dupe(u8, input);
    if (TestEnum2.map.has(str) != TestEnum2.official.has(str)) {
        std.debug.panic("{s} - TestEnum2.map.has(str) ({d}) != TestEnum2.official.has(str) ({d})", .{
            str,
            @boolToInt(TestEnum2.map.has(str)),
            @boolToInt(TestEnum2.official.has(str)),
        });
    }

    std.debug.print("For string: \"{s}\" (has a match? {d})\n", .{ str, @boolToInt(TestEnum2.map.has(str)) });

    var i: usize = 0;
    var is_eql = false;
    var timer = try std.time.Timer.start();

    while (i < 99999999) : (i += 1) {
        is_eql = @call(.{ .modifier = .never_inline }, TestEnum2.map.has, .{str});
    }
    const new = timer.lap();

    std.debug.print("- new {}\n", .{std.fmt.fmtDuration(new)});

    i = 0;
    while (i < 99999999) : (i += 1) {
        is_eql = @call(.{ .modifier = .never_inline }, TestEnum2.official.has, .{str});
    }

    const _std = timer.lap();

    std.debug.print("- std {}\n\n", .{std.fmt.fmtDuration(_std)});
}

pub fn main() anyerror!void {
    try compareString("naaaaaa");
    try compareString("nothinz");
    try compareString("these");
    try compareString("incommon");
    try compareString("noMatch");
    try compareString("0");
    try compareString("00");
}
