pub const add_completions: []const u8 = @embedFile("add_completions.txt");
const std = @import("std");
const Environment = @import("../env.zig");

pub const FirstLetter = enum(u8) {
    a = 'a',
    b = 'b',
    c = 'c',
    d = 'd',
    e = 'e',
    f = 'f',
    g = 'g',
    h = 'h',
    i = 'i',
    j = 'j',
    k = 'k',
    l = 'l',
    m = 'm',
    n = 'n',
    o = 'o',
    p = 'p',
    q = 'q',
    r = 'r',
    s = 's',
    t = 't',
    u = 'u',
    v = 'v',
    w = 'w',
    x = 'x',
    y = 'y',
    z = 'z',
};

pub const Index = std.EnumArray(FirstLetter, []const []const u8);
pub const index: Index = if (Environment.isDebug) Index.initFill(&.{"OOMWorkAround"}) else brk: {
    var array: Index = Index.initFill(&[_][]const u8{});

    var i: u8 = 'a';
    var tokenizer = std.mem.tokenize(u8, add_completions, "\n");

    while (i <= 'z') {
        var init_tokenizer = tokenizer;
        var count: usize = 0;
        @setEvalBranchQuota(9999999);
        while (init_tokenizer.next()) |pkg| {
            if (pkg.len == 0) continue;
            if (pkg[0] == i) {
                count += 1;
            } else {
                break;
            }
        }

        var record: [count][]const u8 = undefined;
        var record_i: usize = 0;
        var next_i = i + 1;

        while (tokenizer.next()) |pkg| {
            if (pkg.len == 0) continue;

            if (pkg[0] == i) {
                record[record_i] = pkg;
                record_i += 1;
            } else {
                next_i = pkg[0];
                break;
            }
        }

        const cloned = record;
        array.set(@as(FirstLetter, @enumFromInt(i)), &cloned);

        @setEvalBranchQuota(999999);
        i = next_i;
    }
    break :brk array;
};
pub const biggest_list: usize = brk: {
    var a = index;
    var iter = a.iterator();
    var max: usize = 0;
    while (iter.next()) |list| {
        max = @max(list.value.len, max);
    }
    break :brk max;
};

const index_blob = "add_completions.index.blob";
