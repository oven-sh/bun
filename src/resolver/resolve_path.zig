const tester = @import("../test/tester.zig");
const std = @import("std");
const FeatureFlags = @import("../feature_flags.zig");
const default_allocator = @import("../memory_allocator.zig").c_allocator;

threadlocal var parser_join_input_buffer: [1024]u8 = undefined;
threadlocal var parser_buffer: [1024]u8 = undefined;

inline fn nqlAtIndex(comptime string_count: comptime_int, index: usize, strings: []const []const u8) bool {
    comptime var string_index = 1;

    inline while (string_index < string_count) : (string_index += 1) {
        if (strings[0][index] != strings[string_index][index]) {
            return true;
        }
    }

    return false;
}

const IsSeparatorFunc = fn (char: u8) bool;

// TODO: is it faster to determine longest_common_separator in the while loop
// or as an extra step at the end?
// only boether to check if this function appears in benchmarking
pub fn longestCommonPathGeneric(strings: []const []const u8, comptime separator: u8, comptime isPathSeparator: IsSeparatorFunc) []const u8 {
    var min_length: usize = std.math.maxInt(usize);
    for (strings) |str| {
        min_length = @minimum(str.len, min_length);
    }

    var index: usize = 0;
    var last_common_separator: usize = 0;

    // try to use an unrolled version of this loop
    switch (strings.len) {
        0 => {
            return "";
        },
        1 => {
            return strings[0];
        },
        2 => {
            while (index < min_length) : (index += 1) {
                if (strings[0][index] != strings[1][index]) {
                    break;
                }
                if (@call(.{ .modifier = .always_inline }, isPathSeparator, .{strings[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        3 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(3, index, strings)) {
                    break;
                }
                if (@call(.{ .modifier = .always_inline }, isPathSeparator, .{strings[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        4 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(4, index, strings)) {
                    break;
                }
                if (@call(.{ .modifier = .always_inline }, isPathSeparator, .{strings[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        5 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(5, index, strings)) {
                    break;
                }
                if (@call(.{ .modifier = .always_inline }, isPathSeparator, .{strings[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        6 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(6, index, strings)) {
                    break;
                }
                if (@call(.{ .modifier = .always_inline }, isPathSeparator, .{strings[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        7 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(7, index, strings)) {
                    break;
                }
                if (@call(.{ .modifier = .always_inline }, isPathSeparator, .{strings[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        8 => {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndex(8, index, strings)) {
                    break;
                }
                if (@call(.{ .modifier = .always_inline }, isPathSeparator, .{strings[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        else => {
            var string_index: usize = 1;
            while (index < min_length) : (index += 1) {
                while (string_index < strings.len) : (string_index += 1) {
                    if (strings[0][index] != strings[index][string_index]) {
                        break;
                    }
                }
                if (@call(.{ .modifier = .always_inline }, isPathSeparator, .{strings[0][index]})) {
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
    for (strings) |str| {
        if (str.len > index + 1) {
            if (@call(.{ .modifier = .always_inline }, isPathSeparator, .{str[index]})) {
                return str[0 .. index + 2];
            }
        }
    }

    return strings[0][0 .. last_common_separator + 1];
}

pub fn longestCommonPath(strings: []const []const u8) []const u8 {
    return longestCommonPathGeneric(strings, '/', isSepAny);
}

pub fn longestCommonPathWindows(strings: []const []const u8) []const u8 {
    return longestCommonPathGeneric(strings, std.fs.path.sep_windows, isSepWin32);
}

pub fn longestCommonPathPosix(strings: []const []const u8) []const u8 {
    return longestCommonPathGeneric(strings, std.fs.path.sep_posix, isSepPosix);
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

    var shortest = @minimum(normalized_from.len, normalized_to.len);

    var last_common_separator = @maximum(common_path.len, 1) - 1;

    if (shortest == common_path.len) {
        if (normalized_to.len > normalized_from.len) {
            if (common_path.len == 0) {
                // We get here if `from` is the root
                // For example: from='/'; to='/foo'
                if (always_copy) {
                    std.mem.copy(u8, buf, normalized_to);
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
                    std.mem.copy(u8, buf, slice);
                    return buf[0..slice.len];
                } else {
                    return slice;
                }
            }
        }

        if (normalized_from.len > normalized_to.len) {
            // We get here if `to` is the exact base path for `from`.
            // For example: from='/foo/bar/baz'; to='/foo/bar'
            if (normalized_from[common_path.len - 1] == separator) {
                last_common_separator = common_path.len - 1;
            } else if (normalized_from[common_path.len] == separator) {
                last_common_separator = common_path.len;
            } else if (common_path.len == 0) {
                // We get here if `to` is the root.
                // For example: from='/foo/bar'; to='/'
                last_common_separator = 0;
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
                    out_slice = buf[0 .. out_slice.len + 2];
                    out_slice[0] = '.';
                    out_slice[1] = '.';
                } else {
                    var old_len = out_slice.len;
                    out_slice = buf[0 .. out_slice.len + 3];
                    out_slice[old_len] = separator;
                    old_len += 1;
                    out_slice[old_len] = '.';
                    old_len += 1;
                    out_slice[old_len] = '.';
                }
            }
        }
    }

    if (normalized_to.len > last_common_separator + 1) {
        const tail = normalized_to[last_common_separator..];
        const insert_leading_slash = last_common_separator > 0 and normalized_to[last_common_separator - 1] != separator;

        if (insert_leading_slash) {
            buf[out_slice.len] = separator;
            out_slice = buf[0 .. out_slice.len + 1];
        }

        // Lastly, append the rest of the destination (`to`) path that comes after
        // the common path parts.
        const start = out_slice.len;
        out_slice = buf[0 .. out_slice.len + tail.len];

        std.mem.copy(u8, out_slice[start..], tail);
    }

    return buf[0..out_slice.len];
}

pub fn relativeNormalized(from: []const u8, to: []const u8, comptime platform: Platform, comptime always_copy: bool) []const u8 {
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
    if (FeatureFlags.use_std_path_relative) {
        var relative_allocator = std.heap.FixedBufferAllocator.init(&relative_from_buf);
        return relativeAlloc(&relative_allocator.allocator, from, to) catch unreachable;
    } else {
        return relativePlatform(from, to, .auto, false);
    }
}

pub fn relativePlatform(from: []const u8, to: []const u8, comptime platform: Platform, comptime always_copy: bool) []const u8 {
    const normalized_from = normalizeStringBuf(from, &relative_from_buf, true, platform, true);
    const normalized_to = normalizeStringBuf(to, &relative_to_buf, true, platform, true);

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

// This function is based on Node.js' path.normalize function.
// https://github.com/nodejs/node/blob/36bb31be5f0b85a0f6cbcb36b64feb3a12c60984/lib/path.js#L66
pub fn normalizeStringGeneric(str: []const u8, buf: []u8, comptime allow_above_root: bool, comptime separator: u8, comptime isPathSeparator: anytype, lastIndexOfSeparator: anytype, comptime preserve_trailing_slash: bool) []u8 {
    var i: usize = 0;
    var last_segment_length: i32 = 0;
    var last_slash: i32 = -1;
    var dots: i32 = 0;
    var code: u8 = 0;

    var written_len: usize = 0;
    const stop_len = str.len;

    while (i <= stop_len) : (i += 1) {
        if (i < stop_len) {
            code = str[i];
        } else if (@call(std.builtin.CallOptions{ .modifier = .always_inline }, isPathSeparator, .{code})) {
            break;
        } else {
            code = separator;
        }

        if (@call(std.builtin.CallOptions{ .modifier = .always_inline }, isPathSeparator, .{code})) {
            if (last_slash == @intCast(i32, i) - 1 or dots == 1) {
                // NOOP
            } else if (dots == 2) {
                if (written_len < 2 or last_segment_length != 2 or buf[written_len - 1] != '.' or buf[written_len - 2] != '.') {
                    if (written_len > 2) {
                        if (lastIndexOfSeparator(buf[0..written_len])) |last_slash_index| {
                            written_len = last_slash_index;
                            last_segment_length = @intCast(i32, written_len - 1 - (lastIndexOfSeparator(buf[0..written_len]) orelse 0));
                        } else {
                            written_len = 0;
                        }
                        last_slash = @intCast(i32, i);
                        dots = 0;
                        continue;
                    } else if (written_len != 0) {
                        written_len = 0;
                        last_segment_length = 0;
                        last_slash = @intCast(i32, i);
                        dots = 0;
                        continue;
                    }

                    if (allow_above_root) {
                        if (written_len > 0) {
                            buf[written_len] = separator;
                            written_len += 1;
                        }

                        buf[written_len] = '.';
                        written_len += 1;
                        buf[written_len] = '.';
                        written_len += 1;

                        last_segment_length = 2;
                    }
                }
            } else {
                if (written_len > 0) {
                    buf[written_len] = separator;
                    written_len += 1;
                }

                const slice = str[@intCast(usize, last_slash + 1)..i];
                const base = buf[written_len..];
                std.mem.copy(u8, base[0..slice.len], slice);
                written_len += slice.len;
                last_segment_length = @intCast(i32, i) - last_slash - 1;
            }

            last_slash = @intCast(i32, i);
            dots = 0;
        } else if (code == '.' and dots != -1) {
            dots += 1;
        } else {
            dots = -1;
        }
    }

    if (preserve_trailing_slash) {
        // Was there a trailing slash? Let's keep it.
        if (stop_len == last_slash + 1 and last_segment_length > 0) {
            buf[written_len] = separator;
            written_len += 1;
        }
    }

    return buf[0..written_len];
}

pub const Platform = enum {
    auto,
    loose,
    windows,
    posix,

    pub fn separator(comptime platform: Platform) u8 {
        return comptime switch (platform) {
            .auto => platform.resolve().separator(),
            .loose, .posix => std.fs.path.sep_posix,
            .windows => std.fs.path.sep_windows,
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

pub fn normalizeStringBuf(str: []const u8, buf: []u8, comptime allow_above_root: bool, comptime _platform: Platform, comptime preserve_trailing_slash: anytype) []u8 {
    const platform = comptime _platform.resolve();

    switch (comptime platform) {
        .auto => unreachable,

        .windows => {
            @compileError("Not implemented");
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

pub fn joinStringBuf(buf: []u8, _parts: anytype, comptime _platform: Platform) []const u8 {
    if (FeatureFlags.use_std_path_join) {
        var alloc = std.heap.FixedBufferAllocator.init(buf);
        return std.fs.path.join(&alloc.allocator, _parts) catch unreachable;
    }

    var written: usize = 0;
    const platform = comptime _platform.resolve();

    for (_parts) |part| {
        if (part.len == 0 or (part.len == 1 and part[0] == '.')) {
            continue;
        }

        if (!platform.isSeparator(part[part.len - 1])) {
            parser_join_input_buffer[written] = platform.separator();
            written += 1;
        }

        std.mem.copy(
            u8,
            parser_join_input_buffer[written..],
            part,
        );
        written += part.len;
    }

    // Preserve leading separator
    if (_parts[0].len > 0 and _parts[0][0] == _platform.separator()) {
        const out = switch (comptime platform) {
            // .loose =>
            .windows => @compileError("Not implemented yet"),
            else => normalizeStringLooseBuf(parser_join_input_buffer[0..written], buf[1..], false, false),
        };
        buf[0] = _platform.separator();

        return buf[0 .. out.len + 1];
    } else {
        return switch (platform) {
            else => normalizeStringLooseBuf(parser_join_input_buffer[0..written], buf[0..], false, false),
            .windows => @compileError("Not implemented yet"),
        };
    }
}

pub fn joinAbsStringBuf(_cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) []const u8 {
    return _joinAbsStringBuf(false, []const u8, _cwd, buf, _parts, _platform);
}

pub fn joinAbsStringBufZ(_cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) [:0]const u8 {
    return _joinAbsStringBuf(true, [:0]const u8, _cwd, buf, _parts, _platform);
}

inline fn _joinAbsStringBuf(comptime is_sentinel: bool, comptime ReturnType: type, _cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) ReturnType {
    var parts: []const []const u8 = _parts;
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

    var cwd = _cwd;
    var out: usize = 0;
    // When parts[0] is absolute, we treat that as, effectively, the cwd

    // Windows leading separators can be a lot of things...
    // So we need to do this instead of just checking the first char.
    var leading_separator: []const u8 = "";

    var start_part: i32 = -1;
    for (parts) |part, i| {
        if (part.len > 0) {
            if (_platform.leadingSeparatorIndex(parts[i])) |leading_separator_i| {
                leading_separator = parts[i][0 .. leading_separator_i + 1];
                start_part = @intCast(i32, i);
            }
        }
    }
    var start: []const u8 = "";

    // Handle joining absolute strings
    // Any string which starts with a leading separator is considered absolute
    if (start_part > -1) {
        const start_part_i = @intCast(usize, start_part);
        start = parts[start_part_i];
        if (parts.len > start_part_i + 1) {
            parts = parts[start_part_i + 1 ..];
        } else {
            parts = &([_][]const u8{});
        }
    } else {
        leading_separator = cwd[0 .. 1 + (_platform.leadingSeparatorIndex(_cwd) orelse unreachable)]; // cwd must be absolute
        start = _cwd;
    }

    out = start.len;
    std.debug.assert(out < buf.len);
    std.mem.copy(u8, buf[0..out], start);

    for (parts) |part| {
        // Do not normalize here
        // It will break stuff!
        var normalized_part = part;
        if (normalized_part.len == 0) {
            continue;
        }
        switch (_platform.resolve()) {
            .windows => {
                buf[out] = std.fs.path.sep_windows;
            },
            else => {
                buf[out] = std.fs.path.sep_posix;
            },
        }

        out += 1;

        const offset = out;
        out += normalized_part.len;
        std.debug.assert(out <= buf.len);
        std.mem.copy(u8, buf[offset..out], normalized_part);
    }

    // One last normalization, to remove any ../ added
    const result = normalizeStringBuf(buf[0..out], parser_buffer[leading_separator.len..parser_buffer.len], false, _platform, false);
    std.mem.copy(u8, buf[0..leading_separator.len], leading_separator);

    std.mem.copy(u8, buf[leading_separator.len .. result.len + leading_separator.len], result);

    if (comptime is_sentinel) {
        buf.ptr[result.len + leading_separator.len + 1] = 0;
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
    return @call(.{ .modifier = .always_inline }, isSepPosix, .{char}) or @call(.{ .modifier = .always_inline }, isSepWin32, .{char});
}

pub fn lastIndexOfSeparatorWindows(slice: []const u8) ?usize {
    return std.mem.lastIndexOfScalar(u8, slice, std.fs.path.sep_windows);
}

pub fn lastIndexOfSeparatorPosix(slice: []const u8) ?usize {
    return std.mem.lastIndexOfScalar(u8, slice, std.fs.path.sep_posix);
}

pub fn lastIndexOfSeparatorLoose(slice: []const u8) ?usize {
    return std.mem.lastIndexOfAny(u8, slice, "/\\");
}

pub fn normalizeStringLooseBuf(str: []const u8, buf: []u8, comptime allow_above_root: bool, comptime preserve_trailing_slash: bool) []u8 {
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

test "joinAbsStringPosix" {
    var t = tester.Tester.t(default_allocator);
    defer t.report(@src());
    const string = []const u8;
    const cwd = "/Users/jarredsumner/Code/app/";

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

test "normalizeStringPosix" {
    var t = tester.Tester.t(default_allocator);
    defer t.report(@src());

    // Don't mess up strings that
    _ = t.expect("foo/bar.txt", try normalizeStringAlloc(default_allocator, "/foo/bar.txt", true, .posix), @src());
    _ = t.expect("foo/bar.txt", try normalizeStringAlloc(default_allocator, "/foo/bar.txt", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(default_allocator, "/foo/bar", true, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(default_allocator, "/foo/bar", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(default_allocator, "/././foo/././././././bar/../bar/../bar", true, .posix), @src());
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

    _ = t.expect("var/foo", try relativeAlloc(default_allocator, "/", "/var/foo/"), @src());
    _ = t.expect("index.js", try relativeAlloc(default_allocator, "/app/public/", "/app/public/index.js"), @src());
    _ = t.expect("..", try relativeAlloc(default_allocator, "/app/public/index.js", "/app/public/"), @src());
    _ = t.expect("../../src/bacon.ts", try relativeAlloc(default_allocator, "/app/public/index.html", "/app/src/bacon.ts"), @src());
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

test "" {
    @import("std").testing.refAllDecls(@This());
}
