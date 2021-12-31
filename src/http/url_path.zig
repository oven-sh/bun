const _global = @import("../global.zig");
const string = _global.string;
const Output = _global.Output;
const toMutable = _global.constStrToU8;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;

const PercentEncoding = @import("../query_string_map.zig").PercentEncoding;
const std = @import("std");
const allocators = @import("../allocators.zig");
const URLPath = @This();

extname: string = "",
path: string = "",
pathname: string = "",
first_segment: string = "",
query_string: string = "",
needs_redirect: bool = false,

// TODO: use a real URL parser
// this treats a URL like /_next/ identically to /
pub fn pathWithoutAssetPrefix(this: *const URLPath, asset_prefix: string) string {
    if (asset_prefix.len == 0) return this.path;
    const leading_slash_offset: usize = if (asset_prefix[0] == '/') 1 else 0;
    const base = this.path;
    const origin = asset_prefix[leading_slash_offset..];

    return if (base.len >= origin.len and strings.eql(base[0..origin.len], origin)) base[origin.len..] else base;
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

    if (strings.indexOfChar(decoded_pathname, '%') != null) {
        var possibly_encoded_pathname = switch (decoded_pathname.len) {
            0...1024 => &temp_path_buf,
            else => &big_temp_path_buf,
        };
        possibly_encoded_pathname = possibly_encoded_pathname[0..std.math.min(
            possibly_encoded_pathname_.len,
            possibly_encoded_pathname.len,
        )];

        std.mem.copy(u8, possibly_encoded_pathname, possibly_encoded_pathname_[0..possibly_encoded_pathname.len]);
        var clone = possibly_encoded_pathname[0..possibly_encoded_pathname.len];

        var fbs = std.io.fixedBufferStream(
            // This is safe because:
            // - this comes from a non-const buffer
            // - percent *decoding* will always be <= length of the original string (no buffer overflow)
            toMutable(
                possibly_encoded_pathname,
            ),
        );
        var writer = fbs.writer();

        decoded_pathname = possibly_encoded_pathname[0..try PercentEncoding.decodeFaultTolerant(@TypeOf(writer), writer, clone, &needs_redirect, true)];
    }

    var question_mark_i: i16 = -1;
    var period_i: i16 = -1;
    var first_segment_end: i16 = std.math.maxInt(i16);
    var last_slash: i16 = -1;

    var i: i16 = @intCast(i16, decoded_pathname.len) - 1;

    while (i >= 0) : (i -= 1) {
        const c = decoded_pathname[@intCast(usize, i)];

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
            break :brk decoded_pathname[@intCast(usize, period_i)..@intCast(usize, question_mark_i)];
        } else if (period_i > -1) {
            period_i += 1;
            break :brk decoded_pathname[@intCast(usize, period_i)..];
        } else {
            break :brk &([_]u8{});
        }
    };

    const path = if (question_mark_i < 0) decoded_pathname[1..] else decoded_pathname[1..@intCast(usize, question_mark_i)];

    const first_segment = decoded_pathname[1..std.math.min(@intCast(usize, first_segment_end), decoded_pathname.len)];

    return URLPath{
        .extname = extname,
        .pathname = decoded_pathname,
        .first_segment = first_segment,
        .path = if (decoded_pathname.len == 1) "." else path,
        .query_string = if (question_mark_i > -1) decoded_pathname[@intCast(usize, question_mark_i)..@intCast(usize, decoded_pathname.len)] else "",
        .needs_redirect = needs_redirect,
    };
}
