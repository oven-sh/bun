const tester = @import("../test/tester.zig");
const std = @import("std");
const strings = @import("../string_immutable.zig");
const FeatureFlags = @import("../feature_flags.zig");
const default_allocator = @import("../memory_allocator.zig").c_allocator;
const bun = @import("bun");
const Fs = @import("../fs.zig");

threadlocal var parser_join_input_buffer: [4096]u8 = undefined;
threadlocal var parser_buffer: [1024]u8 = undefined;

inline fn nqlAtIndex(comptime string_count: comptime_int, index: usize, input: []const []const u8) bool {
    comptime var string_index = 1;

    inline while (string_index < string_count) : (string_index += 1) {
        if (input[0][index] != input[string_index][index]) {
            return true;
        }
    }

    return false;
}

const IsSeparatorFunc = fn (char: u8) bool;
const LastSeparatorFunction = fn (slice: []const u8) ?usize;

inline fn @"is .."(slice: []const u8) bool {
    return slice.len >= 2 and @bitCast(u16, slice[0..2].*) == comptime std.mem.readIntNative(u16, "..");
}

inline fn isDotSlash(slice: []const u8) bool {
    return @bitCast(u16, slice[0..2].*) == comptime std.mem.readIntNative(u16, "./");
}

inline fn @"is ../"(slice: []const u8) bool {
    return strings.hasPrefixComptime(slice, "../");
}

// TODO: is it faster to determine longest_common_separator in the while loop
// or as an extra step at the end?
// only boether to check if this function appears in benchmarking
pub fn longestCommonPathGeneric(input: []const []const u8, comptime separator: u8, comptime isPathSeparator: IsSeparatorFunc) []const u8 {
    var min_length: usize = std.math.maxInt(usize);
    for (input) |str| {
        min_length = @min(str.len, min_length);
    }

    var index: usize = 0;
    var last_common_separator: usize = 0;

    // try to use an unrolled version of this loop
    switch (input.len) {
        0 => {
            return "";
        },
        1 => {
            return input[0];
        },
        2 => {
            while (index < min_length) : (index += 1) {
                if (input[0][index] != input[1][index]) {
                    break;
                }
                if (@call(.always_inline, isPathSeparator, .{input[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        3 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(3, index, input)) {
                    break;
                }
                if (@call(.always_inline, isPathSeparator, .{input[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        4 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(4, index, input)) {
                    break;
                }
                if (@call(.always_inline, isPathSeparator, .{input[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        5 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(5, index, input)) {
                    break;
                }
                if (@call(.always_inline, isPathSeparator, .{input[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        6 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(6, index, input)) {
                    break;
                }
                if (@call(.always_inline, isPathSeparator, .{input[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        7 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(7, index, input)) {
                    break;
                }
                if (@call(.always_inline, isPathSeparator, .{input[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        8 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(8, index, input)) {
                    break;
                }
                if (@call(.always_inline, isPathSeparator, .{input[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        else => {
            var string_index: usize = 1;
            while (string_index < input.len) : (string_index += 1) {
                while (index < min_length) : (index += 1) {
                    if (input[0][index] != input[string_index][index]) {
                        break;
                    }
                }
                if (index == min_length) index -= 1;
                if (@call(.always_inline, isPathSeparator, .{input[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
    }

    if (index == 0) {
        return &([_]u8{separator});
    }

    // The above won't work for a case like this:
    // /app/public/index.js
    // /app/public
    // It will return:
    // /app/
    // It should return:
    // /app/public/
    // To detect /app/public is actually a folder, we do one more loop through the strings
    // and say, "do one of you have a path separator after what we thought was the end?"
    for (input) |str| {
        if (str.len > index) {
            if (@call(.always_inline, isPathSeparator, .{str[index]})) {
                return str[0 .. index + 1];
            }
        }
    }

    return input[0][0 .. last_common_separator + 1];
}

pub fn longestCommonPath(input: []const []const u8) []const u8 {
    return longestCommonPathGeneric(input, '/', isSepAny);
}

pub fn longestCommonPathWindows(input: []const []const u8) []const u8 {
    return longestCommonPathGeneric(input, std.fs.path.sep_windows, isSepWin32);
}

pub fn longestCommonPathPosix(input: []const []const u8) []const u8 {
    return longestCommonPathGeneric(input, std.fs.path.sep_posix, isSepPosix);
}

threadlocal var relative_to_common_path_buf: [4096]u8 = undefined;

/// Find a relative path from a common path
// Loosely based on Node.js' implementation of path.relative
// https://github.com/nodejs/node/blob/9a7cbe25de88d87429a69050a1a1971234558d97/lib/path.js#L1250-L1259
pub fn relativeToCommonPath(
    _common_path: []const u8,
    normalized_from: []const u8,
    normalized_to: []const u8,
    buf: []u8,
    comptime separator: u8,
    comptime always_copy: bool,
) []const u8 {
    const has_leading_separator = _common_path.len > 0 and _common_path[0] == separator;

    const common_path = if (has_leading_separator) _common_path[1..] else _common_path;

    const shortest = @min(normalized_from.len, normalized_to.len);

    var last_common_separator = strings.lastIndexOfChar(_common_path, separator) orelse 0;

    if (shortest == common_path.len) {
        if (normalized_to.len > normalized_from.len) {
            if (common_path.len == 0) {
                // We get here if `from` is the root
                // For example: from='/'; to='/foo'
                if (always_copy) {
                    bun.copy(u8, buf, normalized_to);
                    return buf[0..normalized_to.len];
                } else {
                    return normalized_to;
                }
            }

            if (normalized_to[common_path.len - 1] == separator) {
                const slice = normalized_to[common_path.len..];

                if (always_copy) {
                    // We get here if `from` is the exact base path for `to`.
                    // For example: from='/foo/bar'; to='/foo/bar/baz'
                    bun.copy(u8, buf, slice);
                    return buf[0..slice.len];
                } else {
                    return slice;
                }
            }
        }
    }

    // Generate the relative path based on the path difference between `to`
    // and `from`.

    var out_slice: []u8 = buf[0..0];

    if (normalized_from.len > 0) {
        var i: usize = @intCast(usize, @boolToInt(normalized_from[0] == separator)) + 1 + last_common_separator;

        while (i <= normalized_from.len) : (i += 1) {
            if (i == normalized_from.len or (normalized_from[i] == separator and i + 1 < normalized_from.len)) {
                if (out_slice.len == 0) {
                    buf[0..2].* = "..".*;
                    out_slice.len = 2;
                } else {
                    buf[out_slice.len..][0..3].* = "/..".*;
                    out_slice.len += 3;
                }
            }
        }
    }

    if (normalized_to.len > last_common_separator + 1) {
        var tail = normalized_to[last_common_separator..];
        if (normalized_from.len > 0 and (last_common_separator == normalized_from.len or (last_common_separator == normalized_from.len - 1))) {
            if (tail[0] == separator) {
                tail = tail[1..];
            }
        }

        // avoid making non-absolute paths absolute
        const insert_leading_slash = tail[0] != separator and out_slice.len > 0 and out_slice[out_slice.len - 1] != separator;
        if (insert_leading_slash) {
            buf[out_slice.len] = separator;
            out_slice.len += 1;
        }

        // Lastly, append the rest of the destination (`to`) path that comes after
        // the common path parts.
        bun.copy(u8, buf[out_slice.len..], tail);
        out_slice.len += tail.len;
    }

    return out_slice;
}

pub fn relativeNormalized(from: []const u8, to: []const u8, comptime platform: Platform, comptime always_copy: bool) []const u8 {
    if (from.len == to.len and strings.eqlLong(from, to, true)) {
        return "";
    }

    const two = [_][]const u8{ from, to };
    const common_path = longestCommonPathGeneric(&two, comptime platform.separator(), comptime platform.getSeparatorFunc());

    return relativeToCommonPath(common_path, from, to, &relative_to_common_path_buf, comptime platform.separator(), always_copy);
}

pub fn dirname(str: []const u8, comptime platform: Platform) []const u8 {
    switch (comptime platform.resolve()) {
        .loose => {
            const separator = lastIndexOfSeparatorLoose(str);
            return str[0 .. separator + 1];
        },
        .posix => {
            const separator = lastIndexOfSeparatorPosix(str);
            return str[0 .. separator + 1];
        },
        .windows => {
            const separator = lastIndexOfSeparatorWindows(str) orelse return std.fs.path.diskDesignatorWindows(str);
            return str[0 .. separator + 1];
        },
        else => unreachable,
    }
}

threadlocal var relative_from_buf: [4096]u8 = undefined;
threadlocal var relative_to_buf: [4096]u8 = undefined;
pub fn relative(from: []const u8, to: []const u8) []const u8 {
    if (comptime FeatureFlags.use_std_path_relative) {
        var relative_allocator = std.heap.FixedBufferAllocator.init(&relative_from_buf);
        return relativeAlloc(&relative_allocator.allocator, from, to) catch unreachable;
    } else {
        return relativePlatform(from, to, .auto, false);
    }
}

pub fn relativePlatform(from: []const u8, to: []const u8, comptime platform: Platform, comptime always_copy: bool) []const u8 {
    const normalized_from = if (from.len > 0 and from[0] == platform.separator()) brk: {
        var path = normalizeStringBuf(from, relative_from_buf[1..], true, platform, true);
        relative_from_buf[0] = platform.separator();
        break :brk relative_from_buf[0 .. path.len + 1];
    } else joinAbsStringBuf(
        Fs.FileSystem.instance.top_level_dir,
        &relative_from_buf,
        &[_][]const u8{
            normalizeStringBuf(from, relative_from_buf[1..], false, platform, true),
        },
        platform,
    );

    const normalized_to = if (to.len > 0 and to[0] == platform.separator()) brk: {
        var path = normalizeStringBuf(to, relative_to_buf[1..], true, platform, true);
        relative_to_buf[0] = platform.separator();
        break :brk relative_to_buf[0 .. path.len + 1];
    } else joinAbsStringBuf(
        Fs.FileSystem.instance.top_level_dir,
        &relative_to_buf,
        &[_][]const u8{
            normalizeStringBuf(to, relative_to_buf[1..], false, platform, true),
        },
        platform,
    );

    return relativeNormalized(normalized_from, normalized_to, platform, always_copy);
}

pub fn relativeAlloc(allocator: std.mem.Allocator, from: []const u8, to: []const u8) ![]const u8 {
    if (comptime FeatureFlags.use_std_path_relative) {
        return try std.fs.path.relative(allocator, from, to);
    } else {
        const result = relativePlatform(from, to, Platform.current, false);
        return try allocator.dupe(u8, result);
    }
}

// This function is based on Go's filepath.Clean function
// https://cs.opensource.google/go/go/+/refs/tags/go1.17.6:src/path/filepath/path.go;l=89
pub fn normalizeStringGeneric(path: []const u8, buf: []u8, comptime allow_above_root: bool, comptime separator: u8, comptime isSeparator: anytype, _: anytype, comptime preserve_trailing_slash: bool) []u8 {
    var r: usize = 0;
    var dotdot: usize = 0;
    var buf_i: usize = 0;

    const n = path.len;

    while (r < n) {
        // empty path element
        // or
        // . element
        if (isSeparator(path[r])) {
            r += 1;
            continue;
        }

        if (path[r] == '.' and (r + 1 == n or isSeparator(path[r + 1]))) {
            r += 1;
            continue;
        }

        if (@"is .."(path[r..]) and (r + 2 == n or isSeparator(path[r + 2]))) {
            r += 2;
            // .. element: remove to last separator
            if (buf_i > dotdot) {
                buf_i -= 1;
                while (buf_i > dotdot and !isSeparator(buf[buf_i])) {
                    buf_i -= 1;
                }
            } else if (allow_above_root) {
                if (buf_i > 0) {
                    buf[buf_i..][0..3].* = [_]u8{ separator, '.', '.' };
                    buf_i += 3;
                } else {
                    buf[buf_i..][0..2].* = [_]u8{ '.', '.' };
                    buf_i += 2;
                }
                dotdot = buf_i;
            }

            continue;
        }

        // real path element.
        // add slash if needed
        if (buf_i != 0 and !isSeparator(buf[buf_i - 1])) {
            buf[buf_i] = separator;
            buf_i += 1;
        }

        const from = r;
        while (r < n and !isSeparator(path[r])) : (r += 1) {}
        const count = r - from;
        @memcpy(buf[buf_i..].ptr, path[from..].ptr, count);
        buf_i += count;
    }

    if (preserve_trailing_slash) {
        // Was there a trailing slash? Let's keep it.
        if (buf_i > 0 and path[path.len - 1] == separator and buf[buf_i] != separator) {
            buf[buf_i] = separator;
            buf_i += 1;
        }
    }

    return buf[0..buf_i];
}

pub const Platform = enum {
    auto,
    loose,
    windows,
    posix,

    pub fn isAbsolute(comptime platform: Platform, path: []const u8) bool {
        return switch (comptime platform) {
            .auto => (comptime platform.resolve()).isAbsolute(path),
            .loose, .posix => path.len > 0 and path[0] == '/',
            .windows => std.fs.path.isAbsoluteWindows(path),
        };
    }

    pub fn separator(comptime platform: Platform) u8 {
        return comptime switch (platform) {
            .auto => platform.resolve().separator(),
            .loose, .posix => std.fs.path.sep_posix,
            .windows => std.fs.path.sep_windows,
        };
    }

    pub fn separatorString(comptime platform: Platform) []const u8 {
        return comptime switch (platform) {
            .auto => platform.resolve().separatorString(),
            .loose, .posix => std.fs.path.sep_str_posix,
            .windows => std.fs.path.sep_str_windows,
        };
    }

    pub const current: Platform = switch (@import("builtin").target.os.tag) {
        .windows => Platform.windows,
        else => Platform.posix,
    };

    pub fn getSeparatorFunc(comptime _platform: Platform) IsSeparatorFunc {
        switch (comptime _platform.resolve()) {
            .auto => unreachable,
            .loose => {
                return isSepAny;
            },
            .windows => {
                return isSepWin32;
            },
            .posix => {
                return isSepPosix;
            },
        }
    }

    pub fn getLastSeparatorFunc(comptime _platform: Platform) LastSeparatorFunction {
        switch (comptime _platform.resolve()) {
            .auto => unreachable,
            .loose => {
                return lastIndexOfSeparatorLoose;
            },
            .windows => {
                return lastIndexOfSeparatorWindows;
            },
            .posix => {
                return lastIndexOfSeparatorPosix;
            },
        }
    }

    pub inline fn isSeparator(comptime _platform: Platform, char: u8) bool {
        switch (comptime _platform.resolve()) {
            .auto => unreachable,
            .loose => {
                return isSepAny(char);
            },
            .windows => {
                return isSepWin32(char);
            },
            .posix => {
                return isSepPosix(char);
            },
        }
    }

    pub fn trailingSeparator(comptime _platform: Platform) [2]u8 {
        return comptime switch (_platform) {
            .auto => _platform.resolve().trailingSeparator(),
            .windows => ".\\".*,
            .posix, .loose => "./".*,
        };
    }

    pub fn leadingSeparatorIndex(comptime _platform: Platform, path: anytype) ?usize {
        switch (comptime _platform.resolve()) {
            .windows => {
                if (path.len < 1)
                    return null;

                if (path[0] == '/')
                    return 0;

                if (path[0] == '\\')
                    return 0;

                if (path.len < 3)
                    return null;

                // C:\
                // C:/
                if (path[0] >= 'A' and path[0] <= 'Z' and path[1] == ':') {
                    if (path[2] == '/')
                        return 2;
                    if (path[2] == '\\')
                        return 2;

                    return 1;
                }

                return null;
            },
            .posix => {
                if (path.len > 0 and path[0] == '/') {
                    return 0;
                } else {
                    return null;
                }
            },
            else => {
                return leadingSeparatorIndex(.windows, path) orelse leadingSeparatorIndex(.posix, path);
            },
        }
    }

    pub fn resolve(comptime _platform: Platform) Platform {
        if (comptime _platform == .auto) {
            return switch (@import("builtin").target.os.tag) {
                .windows => Platform.windows,

                .freestanding, .emscripten, .other => Platform.loose,

                else => Platform.posix,
            };
        }

        return _platform;
    }
};

pub fn normalizeString(str: []const u8, comptime allow_above_root: bool, comptime _platform: Platform) []u8 {
    return normalizeStringBuf(str, &parser_buffer, allow_above_root, _platform, false);
}

pub fn normalizeBuf(str: []const u8, buf: []u8, comptime _platform: Platform) []u8 {
    if (buf.len == 0) {
        buf[0] = '.';
        return buf[0..1];
    }

    const is_absolute = _platform.isAbsolute(str);

    const trailing_separator =
        buf[buf.len - 1] == _platform.separator();

    if (is_absolute and trailing_separator)
        return normalizeStringBuf(str, buf, true, _platform, true);

    if (is_absolute and !trailing_separator)
        return normalizeStringBuf(str, buf, true, _platform, false);

    if (!is_absolute and !trailing_separator)
        return normalizeStringBuf(str, buf, false, _platform, false);

    return normalizeStringBuf(str, buf, false, _platform, true);
}

pub fn normalizeStringBuf(str: []const u8, buf: []u8, comptime allow_above_root: bool, comptime _platform: Platform, comptime preserve_trailing_slash: anytype) []u8 {
    const platform = comptime _platform.resolve();

    switch (comptime platform) {
        .auto => unreachable,

        .windows => {
            // @compileError("Not implemented");
            return normalizeStringWindows(
                str,
                buf,
                allow_above_root,
                preserve_trailing_slash,
            );
        },
        .posix => {
            return normalizeStringLooseBuf(
                str,
                buf,
                allow_above_root,
                preserve_trailing_slash,
            );
        },

        .loose => {
            return normalizeStringLooseBuf(
                str,
                buf,
                allow_above_root,
                preserve_trailing_slash,
            );
        },
    }
}

pub fn normalizeStringAlloc(allocator: std.mem.Allocator, str: []const u8, comptime allow_above_root: bool, comptime _platform: Platform) ![]const u8 {
    return try allocator.dupe(u8, normalizeString(str, allow_above_root, _platform));
}

pub fn joinAbs2(_cwd: []const u8, comptime _platform: Platform, part: anytype, part2: anytype) []const u8 {
    const parts = [_][]const u8{ part, part2 };
    const slice = joinAbsString(_cwd, &parts, _platform);
    return slice;
}

pub fn joinAbs(_cwd: []const u8, comptime _platform: Platform, part: anytype) []const u8 {
    const parts = [_][]const u8{
        part,
    };
    const slice = joinAbsString(_cwd, &parts, _platform);
    return slice;
}

// Convert parts of potentially invalid file paths into a single valid filpeath
// without querying the filesystem
// This is the equivalent of
pub fn joinAbsString(_cwd: []const u8, parts: anytype, comptime _platform: Platform) []const u8 {
    return joinAbsStringBuf(
        _cwd,
        &parser_join_input_buffer,
        parts,
        _platform,
    );
}

pub fn joinAbsStringZ(_cwd: []const u8, parts: anytype, comptime _platform: Platform) [:0]const u8 {
    return joinAbsStringBufZ(
        _cwd,
        &parser_join_input_buffer,
        parts,
        _platform,
    );
}

threadlocal var join_buf: [4096]u8 = undefined;
pub fn join(_parts: anytype, comptime _platform: Platform) []const u8 {
    return joinStringBuf(&join_buf, _parts, _platform);
}

pub fn joinStringBuf(buf: []u8, _parts: anytype, comptime _platform: Platform) []const u8 {
    if (FeatureFlags.use_std_path_join) {
        var alloc = std.heap.FixedBufferAllocator.init(buf);
        return std.fs.path.join(&alloc.allocator, _parts) catch unreachable;
    }

    var written: usize = 0;
    const platform = comptime _platform.resolve();
    var temp_buf: [4096]u8 = undefined;
    temp_buf[0] = 0;

    for (_parts) |part| {
        if (part.len == 0) {
            continue;
        }

        if (written > 0) {
            temp_buf[written] = platform.separator();
            written += 1;
        }

        bun.copy(u8, temp_buf[written..], part);
        written += part.len;
    }

    if (written == 0) {
        buf[0] = '.';
        return buf[0..1];
    }

    return normalizeStringNode(temp_buf[0..written], buf, platform);
}

pub fn joinAbsStringBuf(_cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) []const u8 {
    return _joinAbsStringBuf(false, []const u8, _cwd, buf, _parts, _platform);
}

pub fn joinAbsStringBufZ(_cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) [:0]const u8 {
    return _joinAbsStringBuf(true, [:0]const u8, _cwd, buf, _parts, _platform);
}

inline fn _joinAbsStringBuf(comptime is_sentinel: bool, comptime ReturnType: type, _cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) ReturnType {
    var parts: []const []const u8 = _parts;
    var temp_buf: [bun.MAX_PATH_BYTES * 2]u8 = undefined;
    if (parts.len == 0) {
        if (comptime is_sentinel) {
            unreachable;
        }
        return _cwd;
    }

    if ((comptime _platform == .loose or _platform == .posix) and
        parts.len == 1 and
        parts[0].len == 1 and
        parts[0][0] == std.fs.path.sep_posix)
    {
        return "/";
    }

    var out: usize = 0;
    var cwd = _cwd;

    {
        var part_i: u16 = 0;
        var part_len: u16 = @truncate(u16, parts.len);

        while (part_i < part_len) {
            if (_platform.isAbsolute(parts[part_i])) {
                cwd = parts[part_i];
                parts = parts[part_i + 1 ..];

                part_len = @truncate(u16, parts.len);
                part_i = 0;
                continue;
            }
            part_i += 1;
        }
    }

    bun.copy(u8, &temp_buf, cwd);
    out = cwd.len;

    for (parts) |_part| {
        if (_part.len == 0) {
            continue;
        }

        var part = _part;

        if (out > 0 and temp_buf[out - 1] != _platform.separator()) {
            temp_buf[out] = _platform.separator();
            out += 1;
        }

        bun.copy(u8, temp_buf[out..], part);
        out += part.len;
    }

    const leading_separator: []const u8 = if (_platform.leadingSeparatorIndex(temp_buf[0..out])) |i|
        temp_buf[0 .. i + 1]
    else
        "/";

    const result = normalizeStringBuf(
        temp_buf[leading_separator.len..out],
        buf[leading_separator.len..],
        false,
        _platform,
        true,
    );

    bun.copy(u8, buf, leading_separator);

    if (comptime is_sentinel) {
        buf.ptr[result.len + leading_separator.len] = 0;
        return buf[0 .. result.len + leading_separator.len :0];
    } else {
        return buf[0 .. result.len + leading_separator.len];
    }
}

pub fn isSepPosix(char: u8) bool {
    return char == std.fs.path.sep_posix;
}

pub fn isSepWin32(char: u8) bool {
    return char == std.fs.path.sep_windows;
}

pub fn isSepAny(char: u8) bool {
    return @call(.always_inline, isSepPosix, .{char}) or @call(.always_inline, isSepWin32, .{char});
}

pub fn lastIndexOfSeparatorWindows(slice: []const u8) ?usize {
    return std.mem.lastIndexOfScalar(u8, slice, std.fs.path.sep_windows);
}

pub fn lastIndexOfSeparatorPosix(slice: []const u8) ?usize {
    return std.mem.lastIndexOfScalar(u8, slice, std.fs.path.sep_posix);
}

pub fn lastIndexOfNonSeparatorPosix(slice: []const u8) ?u32 {
    var i: usize = slice.len;
    while (i != 0) : (i -= 1) {
        if (slice[i] != std.fs.path.sep_posix) {
            return @intCast(u32, i);
        }
    }

    return null;
}

pub fn lastIndexOfSeparatorLoose(slice: []const u8) ?usize {
    return std.mem.lastIndexOfAny(u8, slice, "/\\");
}

pub fn normalizeStringLooseBuf(
    str: []const u8,
    buf: []u8,
    comptime allow_above_root: bool,
    comptime preserve_trailing_slash: bool,
) []u8 {
    return normalizeStringGeneric(
        str,
        buf,
        allow_above_root,
        std.fs.path.sep_posix,
        isSepAny,
        lastIndexOfSeparatorLoose,
        preserve_trailing_slash,
    );
}

pub fn normalizeStringWindows(
    str: []const u8,
    buf: []u8,
    comptime allow_above_root: bool,
    comptime preserve_trailing_slash: bool,
) []u8 {
    return normalizeStringGeneric(
        str,
        buf,
        allow_above_root,
        std.fs.path.sep_windows,
        isSepWin32,
        lastIndexOfSeparatorWindows,
        preserve_trailing_slash,
    );
}

pub fn normalizeStringNode(
    str: []const u8,
    buf: []u8,
    comptime platform: Platform,
) []u8 {
    if (str.len == 0) {
        buf[0] = '.';
        return buf[0..1];
    }

    const is_absolute = platform.isAbsolute(str);
    const trailing_separator = platform.isSeparator(str[str.len - 1]);
    var buf_ = buf[1..];

    var out = if (!is_absolute) normalizeStringGeneric(
        str,
        buf_,
        true,
        comptime platform.resolve().separator(),
        comptime platform.getSeparatorFunc(),
        comptime platform.getLastSeparatorFunc(),
        false,
    ) else normalizeStringGeneric(
        str,
        buf_,
        false,
        comptime platform.resolve().separator(),
        comptime platform.getSeparatorFunc(),
        comptime platform.getLastSeparatorFunc(),
        false,
    );

    if (out.len == 0) {
        if (is_absolute) {
            buf[0] = platform.separator();
            return buf[0..1];
        }

        if (trailing_separator) {
            buf[0..2].* = platform.trailingSeparator();
            return buf[0..2];
        }

        buf[0] = '.';
        return buf[0..1];
    }

    if (trailing_separator) {
        if (!platform.isSeparator(out[out.len - 1])) {
            buf_[out.len] = platform.separator();
            out = buf_[0 .. out.len + 1];
        }
    }

    if (is_absolute) {
        buf[0] = platform.separator();
        out = buf[0 .. out.len + 1];
    }

    return out;
}

test "joinAbsStringPosix" {
    var t = tester.Tester.t(default_allocator);
    defer t.report(@src());
    const string = []const u8;
    const cwd = "/Users/jarredsumner/Code/app/";

    _ = t.expect(
        "/project/.pnpm/lodash@4.17.21/node_modules/lodash/eq",
        try default_allocator.dupe(u8, joinAbsString(cwd, &[_]string{
            "/project/.pnpm/lodash@4.17.21/node_modules/lodash/",
            "./eq",
        }, .posix)),
        @src(),
    );

    _ = t.expect(
        "/foo/lodash/eq.js",
        joinAbsString(cwd, &[_]string{ "/foo/lodash/", "./eq.js" }, .posix),
        @src(),
    );

    _ = t.expect(
        "/foo/lodash/eq.js",
        joinAbsString(cwd, &[_]string{ "/foo/lodash", "./eq.js" }, .posix),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/bar/file.js",
        joinAbsString(cwd, &[_]string{ "foo", "bar", "file.js" }, .posix),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "foo", "bar", "../file.js" }, .posix),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "foo", "./bar", "../file.js" }, .posix),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/file.js",
        joinAbsString(cwd, &[_]string{ "", "../../file.js" }, .posix),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "././././foo", "././././bar././././", "../file.js" }, .posix),
        @src(),
    );
    _ = t.expect(
        "/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "/Code/app", "././././foo", "././././bar././././", "../file.js" }, .posix),
        @src(),
    );

    _ = t.expect(
        "/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "/Code/app", "././././foo", ".", "././././bar././././", ".", "../file.js" }, .posix),
        @src(),
    );

    _ = t.expect(
        "/Code/app/file.js",
        joinAbsString(cwd, &[_]string{ "/Code/app", "././././foo", "..", "././././bar././././", ".", "../file.js" }, .posix),
        @src(),
    );
}

test "joinAbsStringLoose" {
    var t = tester.Tester.t(default_allocator);
    defer t.report(@src());
    const string = []const u8;
    const cwd = "/Users/jarredsumner/Code/app";

    _ = t.expect(
        "/bar/foo",
        joinAbsString(cwd, &[_]string{
            "/bar/foo",
            "/bar/foo",
        }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/bar/file.js",
        joinAbsString(cwd, &[_]string{ "foo", "bar", "file.js" }, .loose),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "foo", "bar", "../file.js" }, .loose),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "foo", "./bar", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "././././foo", "././././bar././././", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "/Code/app", "././././foo", "././././bar././././", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "/Code/app", "././././foo", ".", "././././bar././././", ".", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/file.js",
        joinAbsString(cwd, &[_]string{ "/Code/app", "././././foo", "..", "././././bar././././", ".", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/bar/file.js",
        joinAbsString(cwd, &[_]string{ "foo", "bar", "file.js" }, .loose),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "foo", "bar", "../file.js" }, .loose),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "foo", "./bar", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ ".\\.\\.\\.\\foo", "././././bar././././", "..\\file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "/Code/app", "././././foo", "././././bar././././", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/foo/file.js",
        joinAbsString(cwd, &[_]string{ "/Code/app", "././././foo", ".", "././././bar././././", ".", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/file.js",
        joinAbsString(cwd, &[_]string{ "/Code/app", "././././foo", "..", "././././bar././././", ".", "../file.js" }, .loose),
        @src(),
    );
}

test "joinStringBuf" {
    var t = tester.Tester.t(default_allocator);
    defer t.report(@src());

    const fixtures = .{
        .{ &[_][]const u8{ ".", "x/b", "..", "/b/c.js" }, "x/b/c.js" },
        .{ &[_][]const u8{}, "." },
        .{ &[_][]const u8{ "/.", "x/b", "..", "/b/c.js" }, "/x/b/c.js" },
        .{ &[_][]const u8{ "/foo", "../../../bar" }, "/bar" },
        .{ &[_][]const u8{ "foo", "../../../bar" }, "../../bar" },
        .{ &[_][]const u8{ "foo/", "../../../bar" }, "../../bar" },
        .{ &[_][]const u8{ "foo/x", "../../../bar" }, "../bar" },
        .{ &[_][]const u8{ "foo/x", "./bar" }, "foo/x/bar" },
        .{ &[_][]const u8{ "foo/x/", "./bar" }, "foo/x/bar" },
        .{ &[_][]const u8{ "foo/x/", ".", "bar" }, "foo/x/bar" },
        .{ &[_][]const u8{"./"}, "./" },
        .{ &[_][]const u8{ ".", "./" }, "./" },
        .{ &[_][]const u8{ ".", ".", "." }, "." },
        .{ &[_][]const u8{ ".", "./", "." }, "." },
        .{ &[_][]const u8{ ".", "/./", "." }, "." },
        .{ &[_][]const u8{ ".", "/////./", "." }, "." },
        .{ &[_][]const u8{"."}, "." },
        .{ &[_][]const u8{ "", "." }, "." },
        .{ &[_][]const u8{ "", "foo" }, "foo" },
        .{ &[_][]const u8{ "foo", "/bar" }, "foo/bar" },
        .{ &[_][]const u8{ "", "/foo" }, "/foo" },
        .{ &[_][]const u8{ "", "", "/foo" }, "/foo" },
        .{ &[_][]const u8{ "", "", "foo" }, "foo" },
        .{ &[_][]const u8{ "foo", "" }, "foo" },
        .{ &[_][]const u8{ "foo/", "" }, "foo/" },
        .{ &[_][]const u8{ "foo", "", "/bar" }, "foo/bar" },
        .{ &[_][]const u8{ "./", "..", "/foo" }, "../foo" },
        .{ &[_][]const u8{ "./", "..", "..", "/foo" }, "../../foo" },
        .{ &[_][]const u8{ ".", "..", "..", "/foo" }, "../../foo" },
        .{ &[_][]const u8{ "", "..", "..", "/foo" }, "../../foo" },

        .{ &[_][]const u8{"/"}, "/" },
        .{ &[_][]const u8{ "/", "." }, "/" },
        .{ &[_][]const u8{ "/", ".." }, "/" },
        .{ &[_][]const u8{ "/", "..", ".." }, "/" },
        .{ &[_][]const u8{""}, "." },
        .{ &[_][]const u8{ "", "" }, "." },
        .{ &[_][]const u8{" /foo"}, " /foo" },
        .{ &[_][]const u8{ " ", "foo" }, " /foo" },
        .{ &[_][]const u8{ " ", "." }, " " },
        .{ &[_][]const u8{ " ", "/" }, " /" },
        .{ &[_][]const u8{ " ", "" }, " " },
        .{ &[_][]const u8{ "/", "foo" }, "/foo" },
        .{ &[_][]const u8{ "/", "/foo" }, "/foo" },
        .{ &[_][]const u8{ "/", "//foo" }, "/foo" },
        .{ &[_][]const u8{ "/", "", "/foo" }, "/foo" },
        .{ &[_][]const u8{ "", "/", "foo" }, "/foo" },
        .{ &[_][]const u8{ "", "/", "/foo" }, "/foo" },

        .{ &[_][]const u8{ "", "..", "..", "..", "/foo" }, "../../../foo" },
        .{ &[_][]const u8{ "", "..", "..", "bar", "/foo" }, "../../bar/foo" },
        .{ &[_][]const u8{ "", "..", "..", "bar", "/foo", "../" }, "../../bar/" },
    };
    inline for (fixtures) |fixture| {
        const expected = fixture[1];
        var buf = try default_allocator.alloc(u8, 2048);
        _ = t.expect(expected, joinStringBuf(buf, fixture[0], .posix), @src());
    }
}

test "normalizeStringPosix" {
    var t = tester.Tester.t(default_allocator);
    defer t.report(@src());
    var buf: [2048]u8 = undefined;
    var buf2: [2048]u8 = undefined;
    // Don't mess up strings that
    _ = t.expect("../../bar", normalizeStringNode("../foo../../../bar", &buf, .posix), @src());
    _ = t.expect("foo/bar.txt", try normalizeStringAlloc(default_allocator, "/foo/bar.txt", true, .posix), @src());
    _ = t.expect("foo/bar.txt", try normalizeStringAlloc(default_allocator, "/foo/bar.txt", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(default_allocator, "/foo/bar", true, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(default_allocator, "/foo/bar", false, .posix), @src());
    _ = t.expect("/foo/bar", normalizeStringNode("/././foo/././././././bar/../bar/../bar", &buf2, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(default_allocator, "/foo/bar", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(default_allocator, "/foo/bar//////", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(default_allocator, "/////foo/bar//////", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(default_allocator, "/////foo/bar", false, .posix), @src());
    _ = t.expect("", try normalizeStringAlloc(default_allocator, "/////", false, .posix), @src());
    _ = t.expect("..", try normalizeStringAlloc(default_allocator, "../boom/../", true, .posix), @src());
    _ = t.expect("", try normalizeStringAlloc(default_allocator, "./", true, .posix), @src());
}

test "normalizeStringWindows" {
    var t = tester.Tester.t(default_allocator);
    defer t.report(@src());

    // Don't mess up strings that
    _ = t.expect("foo\\bar.txt", try normalizeStringAlloc(default_allocator, "\\foo\\bar.txt", true, .windows), @src());
    _ = t.expect("foo\\bar.txt", try normalizeStringAlloc(default_allocator, "\\foo\\bar.txt", false, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(default_allocator, "\\foo\\bar", true, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(default_allocator, "\\foo\\bar", false, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(default_allocator, "\\.\\.\\foo\\.\\.\\.\\.\\.\\.\\bar\\..\\bar\\..\\bar", true, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(default_allocator, "\\foo\\bar", false, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(default_allocator, "\\foo\\bar\\\\\\\\\\\\", false, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(default_allocator, "\\\\\\\\\\foo\\bar\\\\\\\\\\\\", false, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(default_allocator, "\\\\\\\\\\foo\\bar", false, .windows), @src());
    _ = t.expect("", try normalizeStringAlloc(default_allocator, "\\\\\\\\\\", false, .windows), @src());
    _ = t.expect("..", try normalizeStringAlloc(default_allocator, "..\\boom\\..\\", true, .windows), @src());
    _ = t.expect("", try normalizeStringAlloc(default_allocator, ".\\", true, .windows), @src());
}

test "relative" {
    var t = tester.Tester.t(default_allocator);
    defer t.report(@src());

    const fixtures = .{
        .{ "/var/lib", "/var", ".." },
        .{ "/var/lib", "/bin", "../../bin" },
        .{ "/var/lib", "/var/lib", "" },
        .{ "/var/lib", "/var/apache", "../apache" },
        .{ "/var/", "/var/lib", "lib" },
        .{ "/", "/var/lib", "var/lib" },
        .{ "/foo/test", "/foo/test/bar/package.json", "bar/package.json" },
        .{ "/Users/a/web/b/test/mails", "/Users/a/web/b", "../.." },
        .{ "/foo/bar/baz-quux", "/foo/bar/baz", "../baz" },
        .{ "/foo/bar/baz", "/foo/bar/baz-quux", "../baz-quux" },
        .{ "/baz-quux", "/baz", "../baz" },
        .{ "/baz", "/baz-quux", "../baz-quux" },
        .{ "/page1/page2/foo", "/", "../../.." },
    };

    inline for (fixtures) |fixture| {
        const from = fixture[0];
        const to = fixture[1];
        const expected = fixture[2];
        _ = t.expect(expected, try relativeAlloc(default_allocator, from, to), @src());
    }

    _ = t.expect("index.js", try relativeAlloc(default_allocator, "/app/public/", "/app/public/index.js"), @src());
    _ = t.expect("..", try relativeAlloc(default_allocator, "/app/public/index.js", "/app/public/"), @src());
    _ = t.expect("../../src/bacon.ts", try relativeAlloc(default_allocator, "/app/public/index.html", "/app/src/bacon.ts"), @src());
    _ = t.expect("../../../../bacon/foo/baz", try relativeAlloc(default_allocator, "/app/foo/bar/baz.js", "/bacon/foo/baz"), @src());
}

test "longestCommonPath" {
    var t = tester.Tester.t(default_allocator);
    defer t.report(@src());

    const strs = [_][]const u8{
        "/var/boo/foo/",
        "/var/boo/foo/baz/",
        "/var/boo/foo/beep/",
        "/var/boo/foo/beep/bleep",
        "/bar/baz",
        "/bar/not-related",
        "/bar/file.txt",
    };
    _ = t.expect("/var/boo/foo/", longestCommonPath(strs[0..2]), @src());
    _ = t.expect("/var/boo/foo/", longestCommonPath(strs[0..4]), @src());
    _ = t.expect("/var/boo/foo/beep/", longestCommonPath(strs[2..3]), @src());
    _ = t.expect("/bar/", longestCommonPath(strs[5..strs.len]), @src());
    _ = t.expect("/", longestCommonPath(&strs), @src());

    const more = [_][]const u8{ "/app/public/index.html", "/app/public/index.js", "/app/public", "/app/src/bacon.ts" };
    _ = t.expect("/app/", longestCommonPath(&more), @src());
    _ = t.expect("/app/public/", longestCommonPath(more[0..2]), @src());
}
