const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;

const PercentEncoding = @import("../url.zig").PercentEncoding;
const std = @import("std");
const allocators = @import("../allocators.zig");
const URLPath = @This();

extname: string = "",
path: string = "",
pathname: string = "",
first_segment: string = "",
query_string: string = "",
needs_redirect: bool = false,
/// Treat URLs as non-sourcemap URLS
/// Then at the very end, we check.
is_source_map: bool = false,

pub fn isRoot(this: *const URLPath, asset_prefix: string) bool {
    const without = this.pathWithoutAssetPrefix(asset_prefix);
    if (without.len == 1 and without[0] == '.') return true;
    return strings.eqlComptime(without, "index");
}

// TODO: use a real URL parser
// this treats a URL like /_next/ identically to /
pub fn pathWithoutAssetPrefix(this: *const URLPath, asset_prefix: string) string {
    if (asset_prefix.len == 0) return this.path;
    const leading_slash_offset: usize = if (asset_prefix[0] == '/') 1 else 0;
    const base = this.path;
    const origin = asset_prefix[leading_slash_offset..];

    const out = if (base.len >= origin.len and strings.eql(base[0..origin.len], origin)) base[origin.len..] else base;
    if (this.is_source_map and strings.endsWithComptime(out, ".map")) {
        return out[0 .. out.len - 4];
    }

    return out;
}

// optimization: very few long strings will be URL-encoded
// we're allocating virtual memory here, so if we never use it, it won't be allocated
// and even when they're, they're probably rarely going to be > 1024 chars long
// so we can have a big and little one and almost always use the little one
threadlocal var temp_path_buf: [1024]u8 = undefined;
threadlocal var big_temp_path_buf: [16384]u8 = undefined;

pub fn parse(possibly_encoded_pathname_: string) !URLPath {
    var decoded_pathname = possibly_encoded_pathname_;
    var needs_redirect = false;

    if (strings.containsChar(decoded_pathname, '%')) {
        // https://github.com/ziglang/zig/issues/14148
        var possibly_encoded_pathname: []u8 = switch (decoded_pathname.len) {
            0...1024 => &temp_path_buf,
            else => &big_temp_path_buf,
        };
        possibly_encoded_pathname = possibly_encoded_pathname[0..@min(
            possibly_encoded_pathname_.len,
            possibly_encoded_pathname.len,
        )];

        bun.copy(u8, possibly_encoded_pathname, possibly_encoded_pathname_[0..possibly_encoded_pathname.len]);
        const clone = possibly_encoded_pathname[0..possibly_encoded_pathname.len];

        var fbs = std.io.fixedBufferStream(possibly_encoded_pathname);
        const writer = fbs.writer();

        decoded_pathname = possibly_encoded_pathname[0..try PercentEncoding.decodeFaultTolerant(@TypeOf(writer), writer, clone, &needs_redirect, true)];
    }

    var question_mark_i: i16 = -1;
    var period_i: i16 = -1;

    var first_segment_end: i16 = std.math.maxInt(i16);
    var last_slash: i16 = -1;

    var i: i16 = @as(i16, @intCast(decoded_pathname.len)) - 1;

    while (i >= 0) : (i -= 1) {
        const c = decoded_pathname[@as(usize, @intCast(i))];

        switch (c) {
            '?' => {
                question_mark_i = @max(question_mark_i, i);
                if (question_mark_i < period_i) {
                    period_i = -1;
                }

                if (last_slash > question_mark_i) {
                    last_slash = -1;
                }
            },
            '.' => {
                period_i = @max(period_i, i);
            },
            '/' => {
                last_slash = @max(last_slash, i);

                if (i > 0) {
                    first_segment_end = @min(first_segment_end, i);
                }
            },
            else => {},
        }
    }

    if (last_slash > period_i) {
        period_i = -1;
    }

    // .js.map
    //    ^
    const extname = brk: {
        if (question_mark_i > -1 and period_i > -1) {
            period_i += 1;
            break :brk decoded_pathname[@as(usize, @intCast(period_i))..@as(usize, @intCast(question_mark_i))];
        } else if (period_i > -1) {
            period_i += 1;
            break :brk decoded_pathname[@as(usize, @intCast(period_i))..];
        } else {
            break :brk &([_]u8{});
        }
    };

    var path = if (question_mark_i < 0) decoded_pathname[1..] else decoded_pathname[1..@as(usize, @intCast(question_mark_i))];

    const first_segment = decoded_pathname[1..@min(@as(usize, @intCast(first_segment_end)), decoded_pathname.len)];
    const is_source_map = strings.eqlComptime(extname, "map");
    var backup_extname: string = extname;
    if (is_source_map and path.len > ".map".len) {
        if (std.mem.lastIndexOfScalar(u8, path[0 .. path.len - ".map".len], '.')) |j| {
            backup_extname = path[j + 1 ..];
            backup_extname = backup_extname[0 .. backup_extname.len - ".map".len];
            path = path[0 .. j + backup_extname.len + 1];
        }
    }

    return URLPath{
        .extname = if (!is_source_map) extname else backup_extname,
        .is_source_map = is_source_map,
        .pathname = decoded_pathname,
        .first_segment = first_segment,
        .path = if (decoded_pathname.len == 1) "." else path,
        .query_string = if (question_mark_i > -1) decoded_pathname[@as(usize, @intCast(question_mark_i))..@as(usize, @intCast(decoded_pathname.len))] else "",
        .needs_redirect = needs_redirect,
    };
}
