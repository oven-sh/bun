usingnamespace @import("../global.zig");
const std = @import("std");

const URLPath = @This();

extname: string = "",
path: string = "",
pathname: string = "",
first_segment: string = "",
query_string: string = "",

// This does one pass over the URL path instead of like 4
pub fn parse(raw_path: string) URLPath {
    var question_mark_i: i16 = -1;
    var period_i: i16 = -1;
    var first_segment_end: i16 = std.math.maxInt(i16);
    var last_slash: i16 = -1;

    var i: i16 = @intCast(i16, raw_path.len) - 1;
    while (i >= 0) : (i -= 1) {
        const c = raw_path[@intCast(usize, i)];

        switch (c) {
            '?' => {
                question_mark_i = std.math.max(question_mark_i, i);
                if (question_mark_i < period_i) {
                    period_i = -1;
                }

                if (last_slash > question_mark_i) {
                    last_slash = -1;
                }
            },
            '.' => {
                period_i = std.math.max(period_i, i);
            },
            '/' => {
                last_slash = std.math.max(last_slash, i);

                if (i > 0) {
                    first_segment_end = std.math.min(first_segment_end, i);
                }
            },
            else => {},
        }
    }

    if (last_slash > period_i) {
        period_i = -1;
    }

    const extname = brk: {
        if (question_mark_i > -1 and period_i > -1) {
            period_i += 1;
            break :brk raw_path[@intCast(usize, period_i)..@intCast(usize, question_mark_i)];
        } else if (period_i > -1) {
            period_i += 1;
            break :brk raw_path[@intCast(usize, period_i)..];
        } else {
            break :brk &([_]u8{});
        }
    };

    const path = if (question_mark_i < 0) raw_path[1..] else raw_path[1..@intCast(usize, question_mark_i)];

    const first_segment = raw_path[1..std.math.min(@intCast(usize, first_segment_end), raw_path.len)];

    return URLPath{
        .extname = extname,
        .pathname = raw_path,
        .first_segment = first_segment,
        .path = if (raw_path.len == 1) "." else path,
        .query_string = if (question_mark_i > -1) raw_path[@intCast(usize, question_mark_i)..@intCast(usize, raw_path.len)] else "",
    };
}
