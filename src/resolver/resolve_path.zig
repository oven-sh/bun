const tester = @import("../test/tester.zig");
const std = @import("std");
const strings = @import("../string_immutable.zig");
const FeatureFlags = @import("../feature_flags.zig");
const default_allocator = @import("../memory_allocator.zig").c_allocator;
const bun = @import("root").bun;
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

inline fn nqlAtIndexCaseInsensitive(comptime string_count: comptime_int, index: usize, input: []const []const u8) bool {
    comptime var string_index = 1;

    inline while (string_index < string_count) : (string_index += 1) {
        if (std.ascii.toLower(input[0][index]) != std.ascii.toLower(input[string_index][index])) {
            return true;
        }
    }

    return false;
}

const IsSeparatorFunc = fn (char: u8) bool;
const LastSeparatorFunction = fn (slice: []const u8) ?usize;

inline fn @"is .."(slice: []const u8) bool {
    return slice.len >= 2 and @as(u16, @bitCast(slice[0..2].*)) == comptime std.mem.readInt(u16, "..", .little);
}

inline fn isDotSlash(slice: []const u8) bool {
    return @as(u16, @bitCast(slice[0..2].*)) == comptime std.mem.readInt(u16, "./", .little);
}

inline fn @"is ../"(slice: []const u8) bool {
    return strings.hasPrefixComptime(slice, "../");
}

pub fn getIfExistsLongestCommonPathGeneric(input: []const []const u8, comptime platform: Platform) ?[]const u8 {
    const separator = comptime platform.separator();
    const isPathSeparator = comptime platform.getSeparatorFunc();

    const nqlAtIndexFn = switch (platform) {
        else => nqlAtIndex,
        .windows => nqlAtIndexCaseInsensitive,
    };

    var min_length: usize = std.math.maxInt(usize);
    for (input) |str| {
        min_length = @min(str.len, min_length);
    }

    var index: usize = 0;
    var last_common_separator: ?usize = null;

    // try to use an unrolled version of this loop
    switch (input.len) {
        0 => {
            return "";
        },
        1 => {
            return input[0];
        },
        inline 2, 3, 4, 5, 6, 7, 8 => |N| {
            while (index < min_length) : (index += 1) {
                if (nqlAtIndexFn(comptime N, index, input)) {
                    if (last_common_separator == null) return null;
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
                    if (platform == .windows) {
                        if (std.ascii.toLower(input[0][index]) != std.ascii.toLower(input[string_index][index])) {
                            if (last_common_separator == null) return null;
                            break;
                        }
                    } else {
                        if (input[0][index] != input[string_index][index]) {
                            if (last_common_separator == null) return null;
                            break;
                        }
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

    if (last_common_separator == null) {
        return &([_]u8{'.'});
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

    return input[0][0 .. last_common_separator.? + 1];
}

// TODO: is it faster to determine longest_common_separator in the while loop
// or as an extra step at the end?
// only boether to check if this function appears in benchmarking
pub fn longestCommonPathGeneric(input: []const []const u8, comptime platform: Platform) []const u8 {
    const separator = comptime platform.separator();
    const isPathSeparator = comptime platform.getSeparatorFunc();

    const nqlAtIndexFn = switch (platform) {
        else => nqlAtIndex,
        .windows => nqlAtIndexCaseInsensitive,
    };

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
        inline 2, 3, 4, 5, 6, 7, 8 => |n| {
            // If volume IDs do not match on windows, we can't have a common path
            if (platform == .windows) {
                const first_root = windowsFilesystemRoot(input[0]);
                comptime var i = 1;
                inline while (i < n) : (i += 1) {
                    const root = windowsFilesystemRoot(input[i]);
                    if (!strings.eqlCaseInsensitiveASCIIICheckLength(first_root, root)) {
                        return "";
                    }
                }
            }

            while (index < min_length) : (index += 1) {
                if (nqlAtIndexFn(comptime n, index, input)) {
                    break;
                }
                if (@call(.always_inline, isPathSeparator, .{input[0][index]})) {
                    last_common_separator = index;
                }
            }
        },
        else => {
            // If volume IDs do not match on windows, we can't have a common path
            if (platform == .windows) {
                const first_root = windowsFilesystemRoot(input[0]);
                var i: usize = 1;
                while (i < input.len) : (i += 1) {
                    const root = windowsFilesystemRoot(input[i]);
                    if (!strings.eqlCaseInsensitiveASCIIICheckLength(first_root, root)) {
                        return "";
                    }
                }
            }

            var string_index: usize = 1;
            while (string_index < input.len) : (string_index += 1) {
                while (index < min_length) : (index += 1) {
                    if (platform == .windows) {
                        if (std.ascii.toLower(input[0][index]) != std.ascii.toLower(input[string_index][index])) {
                            break;
                        }
                    } else {
                        if (input[0][index] != input[string_index][index]) {
                            break;
                        }
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
    var idx = input.len; // Use this value as an invalid value.
    for (input, 0..) |str, i| {
        if (str.len > index) {
            if (@call(.always_inline, isPathSeparator, .{str[index]})) {
                idx = i;
            } else {
                idx = input.len;
                break;
            }
        }
    }
    if (idx != input.len) {
        return input[idx][0 .. index + 1];
    }

    return input[0][0 .. last_common_separator + 1];
}

pub fn longestCommonPath(input: []const []const u8) []const u8 {
    return longestCommonPathGeneric(input, .loose);
}

pub fn getIfExistsLongestCommonPath(input: []const []const u8) ?[]const u8 {
    return getIfExistsLongestCommonPathGeneric(input, .loose);
}

pub fn longestCommonPathWindows(input: []const []const u8) []const u8 {
    return longestCommonPathGeneric(input, .windows);
}

pub fn longestCommonPathPosix(input: []const []const u8) []const u8 {
    return longestCommonPathGeneric(input, .posix);
}

threadlocal var relative_to_common_path_buf: [4096]u8 = undefined;

/// Find a relative path from a common path
// Loosely based on Node.js' implementation of path.relative
// https://github.com/nodejs/node/blob/9a7cbe25de88d87429a69050a1a1971234558d97/lib/path.js#L1250-L1259
pub fn relativeToCommonPath(
    common_path_: []const u8,
    normalized_from_: []const u8,
    normalized_to_: []const u8,
    buf: []u8,
    comptime always_copy: bool,
    comptime platform: Platform,
) []const u8 {
    var normalized_from = normalized_from_;
    var normalized_to = normalized_to_;
    const win_root_len = if (platform == .windows) k: {
        const from_root = windowsFilesystemRoot(normalized_from_);
        const to_root = windowsFilesystemRoot(normalized_to_);

        if (common_path_.len == 0) {
            // the only case path.relative can return not a relative string
            if (!strings.eqlCaseInsensitiveASCIIICheckLength(from_root, to_root)) {
                if (normalized_to_.len > to_root.len and normalized_to_[normalized_to_.len - 1] == '\\') {
                    if (always_copy) {
                        bun.copy(u8, buf, normalized_to_[0 .. normalized_to_.len - 1]);
                        return buf[0 .. normalized_to_.len - 1];
                    } else {
                        return normalized_to_[0 .. normalized_to_.len - 1];
                    }
                } else {
                    if (always_copy) {
                        bun.copy(u8, buf, normalized_to_);
                        return buf[0..normalized_to_.len];
                    } else {
                        return normalized_to_;
                    }
                }
            }
        }

        normalized_from = normalized_from_[from_root.len..];
        normalized_to = normalized_to_[to_root.len..];

        break :k from_root.len;
    } else null;

    const separator = comptime platform.separator();

    const common_path = if (platform == .windows)
        common_path_[win_root_len..]
    else if (std.fs.path.isAbsolutePosix(common_path_))
        common_path_[1..]
    else
        common_path_;

    const shortest = @min(normalized_from.len, normalized_to.len);

    if (shortest == common_path.len) {
        if (normalized_to.len >= normalized_from.len) {
            if (common_path.len == 0) {
                if (platform == .windows and
                    normalized_to.len > 3 and
                    normalized_to[normalized_to.len - 1] == separator)
                {
                    normalized_to.len -= 1;
                }

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

                const without_trailing_slash = if (platform == .windows and
                    slice.len > 3 and
                    slice[slice.len - 1] == separator)
                    slice[0 .. slice.len - 1]
                else
                    slice;

                if (always_copy) {
                    // We get here if `from` is the exact base path for `to`.
                    // For example: from='/foo/bar'; to='/foo/bar/baz'
                    bun.copy(u8, buf, without_trailing_slash);
                    return buf[0..without_trailing_slash.len];
                } else {
                    return without_trailing_slash;
                }
            }
        }
    }

    const last_common_separator = strings.lastIndexOfChar(
        if (platform == .windows) common_path else common_path_,
        separator,
    ) orelse 0;

    // Generate the relative path based on the path difference between `to`
    // and `from`.

    var out_slice: []u8 = buf[0..0];

    if (normalized_from.len > 0) {
        var i: usize = @as(usize, @intCast(@intFromBool(normalized_from[0] == separator))) + 1 + last_common_separator;

        while (i <= normalized_from.len) : (i += 1) {
            if (i == normalized_from.len or (normalized_from[i] == separator and i + 1 < normalized_from.len)) {
                if (out_slice.len == 0) {
                    buf[0..2].* = "..".*;
                    out_slice.len = 2;
                } else {
                    buf[out_slice.len..][0..3].* = (&[_]u8{separator} ++ "..").*;
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

    if (out_slice.len > 3 and out_slice[out_slice.len - 1] == separator) {
        out_slice.len -= 1;
    }

    return out_slice;
}

pub fn relativeNormalized(from: []const u8, to: []const u8, comptime platform: Platform, comptime always_copy: bool) []const u8 {
    if ((if (platform == .windows)
        strings.eqlCaseInsensitiveASCII(from, to, true)
    else
        from.len == to.len and strings.eqlLong(from, to, true)))
    {
        return "";
    }

    const two = [_][]const u8{ from, to };
    const common_path = longestCommonPathGeneric(&two, platform);

    return relativeToCommonPath(common_path, from, to, &relative_to_common_path_buf, always_copy, platform);
}

pub fn dirname(str: []const u8, comptime platform: Platform) []const u8 {
    switch (comptime platform.resolve()) {
        .loose => {
            const separator = lastIndexOfSeparatorLoose(str) orelse return "";
            return str[0..separator];
        },
        .posix => {
            const separator = lastIndexOfSeparatorPosix(str) orelse return "";
            return str[0..separator];
        },
        .windows => {
            const separator = lastIndexOfSeparatorWindows(str) orelse return std.fs.path.diskDesignatorWindows(str);
            return str[0..separator];
        },
        else => @compileError("unreachable"),
    }
}

threadlocal var relative_from_buf: [4096]u8 = undefined;
threadlocal var relative_to_buf: [4096]u8 = undefined;
pub fn relative(from: []const u8, to: []const u8) []const u8 {
    return relativePlatform(from, to, .auto, false);
}

pub fn relativePlatform(from: []const u8, to: []const u8, comptime platform: Platform, comptime always_copy: bool) []const u8 {
    const normalized_from = if (platform.isAbsolute(from)) brk: {
        const path = normalizeStringBuf(from, relative_from_buf[1..], true, platform, true);
        if (platform == .windows) break :brk path;
        relative_from_buf[0] = platform.separator();
        break :brk relative_from_buf[0 .. path.len + 1];
    } else joinAbsStringBuf(
        Fs.FileSystem.instance.top_level_dir,
        &relative_from_buf,
        &[_][]const u8{
            normalizeStringBuf(from, relative_from_buf[1..], true, platform, true),
        },
        platform,
    );

    const normalized_to = if (platform.isAbsolute(to)) brk: {
        const path = normalizeStringBuf(to, relative_to_buf[1..], true, platform, true);
        if (platform == .windows) break :brk path;
        relative_to_buf[0] = platform.separator();
        break :brk relative_to_buf[0 .. path.len + 1];
    } else joinAbsStringBuf(
        Fs.FileSystem.instance.top_level_dir,
        &relative_to_buf,
        &[_][]const u8{
            normalizeStringBuf(to, relative_to_buf[1..], true, platform, true),
        },
        platform,
    );

    return relativeNormalized(normalized_from, normalized_to, platform, always_copy);
}

pub fn relativeAlloc(allocator: std.mem.Allocator, from: []const u8, to: []const u8) ![]const u8 {
    const result = relativePlatform(from, to, Platform.current, false);
    return try allocator.dupe(u8, result);
}

// This function is based on Go's volumeNameLen function
// https://cs.opensource.google/go/go/+/refs/tags/go1.17.6:src/path/filepath/path_windows.go;l=57
// volumeNameLen returns length of the leading volume name on Windows.
fn windowsVolumeNameLen(path: []const u8) struct { usize, usize } {
    if (path.len < 2) return .{ 0, 0 };
    // with drive letter
    const c = path[0];
    if (path[1] == ':') {
        if ('a' <= c and c <= 'z' or 'A' <= c and c <= 'Z') {
            return .{ 2, 0 };
        }
    }
    // UNC
    if (path.len >= 5 and
        Platform.windows.isSeparator(path[0]) and
        Platform.windows.isSeparator(path[1]) and
        !Platform.windows.isSeparator(path[2]) and
        path[2] != '.')
    {
        if (strings.indexOfAny(path[3..], "/\\")) |idx| {
            // TODO: handle input "//abc//def" should be picked up as a unc path
            if (path.len > idx + 4 and !Platform.windows.isSeparator(path[idx + 4])) {
                if (strings.indexOfAny(path[idx + 4 ..], "/\\")) |idx2| {
                    return .{ idx + idx2 + 4, idx + 3 };
                } else {
                    return .{ path.len, idx + 3 };
                }
            }
        }
    }
    return .{ 0, 0 };
}

pub fn windowsVolumeName(path: []const u8) []const u8 {
    return path[0..@call(.always_inline, windowsVolumeNameLen, .{path})[0]];
}

// path.relative lets you do relative across different share drives
pub fn windowsFilesystemRoot(path: []const u8) []const u8 {
    if (path.len < 3)
        return if (isSepAny(path[0])) path[0..1] else path[0..0];
    // with drive letter
    const c = path[0];
    if (path[1] == ':' and isSepAny(path[2])) {
        if ('a' <= c and c <= 'z' or 'A' <= c and c <= 'Z') {
            return path[0..3];
        }
    }
    // UNC
    if (path.len >= 5 and
        Platform.windows.isSeparator(path[0]) and
        Platform.windows.isSeparator(path[1]) and
        !Platform.windows.isSeparator(path[2]) and
        path[2] != '.')
    {
        if (strings.indexOfAny(path[3..], "/\\")) |idx| {
            // TODO: handle input "//abc//def" should be picked up as a unc path
            return path[0 .. idx + 4];
        }
    }
    if (isSepAny(path[0])) return path[0..1];
    return path[0..0];
}

// This function is based on Go's filepath.Clean function
// https://cs.opensource.google/go/go/+/refs/tags/go1.17.6:src/path/filepath/path.go;l=89
pub fn normalizeStringGeneric(
    path_: []const u8,
    buf: []u8,
    comptime allow_above_root: bool,
    comptime separator: u8,
    comptime isSeparator: anytype,
    _: anytype,
    comptime preserve_trailing_slash: bool,
) []u8 {
    const isWindows = comptime separator == std.fs.path.sep_windows;

    if (isWindows and bun.Environment.isDebug) {
        // this is here to catch a potential mistake by the caller
        //
        // since it is theoretically possible to get here in release
        // we will not do this check in release.
        std.debug.assert(!strings.startsWith(path_, ":\\"));
    }

    var buf_i: usize = 0;
    var dotdot: usize = 0;

    const volLen, const indexOfThirdUNCSlash = if (isWindows and !allow_above_root)
        windowsVolumeNameLen(path_)
    else
        .{ 0, 0 };

    if (isWindows and !allow_above_root) {
        if (volLen > 0) {
            if (path_[1] != ':') {
                // UNC paths
                buf[0..2].* = [_]u8{ separator, separator };
                @memcpy(buf[2 .. indexOfThirdUNCSlash + 1], path_[2 .. indexOfThirdUNCSlash + 1]);
                buf[indexOfThirdUNCSlash] = separator;
                @memcpy(
                    buf[indexOfThirdUNCSlash + 1 .. volLen],
                    path_[indexOfThirdUNCSlash + 1 .. volLen],
                );
                buf[volLen] = separator;
                buf_i = volLen + 1;

                // it is just a volume name
                if (buf_i >= path_.len)
                    return buf[0..buf_i];
            } else {
                // drive letter
                buf[0] = path_[0];
                buf[1] = ':';
                buf_i = 2;
                dotdot = buf_i;
            }
        } else if (path_.len > 0 and isSeparator(path_[0])) {
            buf[buf_i] = separator;
            buf_i += 1;
            dotdot = 1;
        }
    }
    if (isWindows and allow_above_root) {
        if (path_.len >= 2 and path_[1] == ':') {
            buf[0] = path_[0];
            buf[1] = ':';
            buf_i = 2;
            dotdot = buf_i;
        }
    }

    var r: usize = 0;
    var path, const buf_start = if (isWindows)
        .{ path_[buf_i..], buf_i }
    else
        .{ path_, 0 };

    const n = path.len;

    if (isWindows and (allow_above_root or volLen > 0)) {
        // consume leading slashes on windows
        if (r < n and isSeparator(path[r])) {
            r += 1;
            buf[buf_i] = separator;
            buf_i += 1;
        }
    }

    while (r < n) {
        // empty path element
        // or
        // . element
        if (isSeparator(path[r])) {
            r += 1;
            continue;
        }

        if (path[r] == '.' and (r + 1 == n or isSeparator(path[r + 1]))) {
            // skipping two is a windows-specific bugfix
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
                if (buf_i > buf_start) {
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
        if (buf_i != buf_start and !isSeparator(buf[buf_i - 1])) {
            buf[buf_i] = separator;
            buf_i += 1;
        }

        const from = r;
        while (r < n and !isSeparator(path[r])) : (r += 1) {}
        const count = r - from;
        @memcpy(buf[buf_i..][0..count], path[from..][0..count]);
        buf_i += count;
    }

    if (preserve_trailing_slash) {
        // Was there a trailing slash? Let's keep it.
        if (buf_i > 0 and path_[path_.len - 1] == separator and buf[buf_i] != separator) {
            buf[buf_i] = separator;
            buf_i += 1;
        }
    }

    if (isWindows and buf_i == 2 and buf[1] == ':') {
        // If the original path is just a relative path with a drive letter,
        // add .
        buf[buf_i] = if (path.len > 0 and path[0] == '\\') '\\' else '.';
        buf_i += 1;
    }

    const result = buf[0..buf_i];

    if (bun.Environment.allow_assert and isWindows) {
        std.debug.assert(!strings.startsWith(result, "\\:\\"));
    }

    return result;
}

pub const Platform = enum {
    auto,
    loose,
    windows,
    posix,

    pub fn isAbsolute(comptime platform: Platform, path: []const u8) bool {
        return switch (comptime platform) {
            .auto => (comptime platform.resolve()).isAbsolute(path),
            .posix => path.len > 0 and path[0] == '/',
            .windows,
            .loose,
            => std.fs.path.isAbsoluteWindows(path),
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
            .auto => comptime unreachable,
            .loose => {
                return isSepAny;
            },
            .windows => {
                return isSepAny;
            },
            .posix => {
                return isSepPosix;
            },
        }
    }

    pub fn getLastSeparatorFunc(comptime _platform: Platform) LastSeparatorFunction {
        switch (comptime _platform.resolve()) {
            .auto => comptime unreachable,
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
            .auto => comptime unreachable,
            .loose => {
                return isSepAny(char);
            },
            .windows => {
                return isSepAny(char);
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
    if (str.len == 0) {
        buf[0] = '.';
        return buf[0..1];
    }

    const is_absolute = _platform.isAbsolute(str);

    const trailing_separator = _platform.getLastSeparatorFunc()(str) == str.len - 1;

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
        .auto => @compileError("unreachable"),

        .windows => {
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
// This is the equivalent of path.resolve
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

pub threadlocal var join_buf: [4096]u8 = undefined;
pub fn join(_parts: anytype, comptime _platform: Platform) []const u8 {
    return joinStringBuf(&join_buf, _parts, _platform);
}
pub fn joinZ(_parts: anytype, comptime _platform: Platform) [:0]const u8 {
    return joinZBuf(&join_buf, _parts, _platform);
}

pub fn joinZBuf(buf: []u8, _parts: anytype, comptime _platform: Platform) [:0]const u8 {
    const joined = joinStringBuf(buf[0 .. buf.len - 1], _parts, _platform);
    std.debug.assert(bun.isSliceInBuffer(joined, buf));
    const start_offset = @intFromPtr(joined.ptr) - @intFromPtr(buf.ptr);
    buf[joined.len + start_offset] = 0;
    return buf[start_offset..][0..joined.len :0];
}
pub fn joinStringBuf(buf: []u8, parts: anytype, comptime _platform: Platform) []const u8 {
    const platform = comptime _platform.resolve();

    var written: usize = 0;
    var temp_buf_: [4096]u8 = undefined;
    var temp_buf: []u8 = &temp_buf_;
    var free_temp_buf = false;
    defer {
        if (free_temp_buf) {
            bun.default_allocator.free(temp_buf);
        }
    }

    var count: usize = 0;
    for (parts) |part| {
        count += if (part.len > 0) part.len + 1 else 0;
    }

    if (count * 2 > temp_buf.len) {
        temp_buf = bun.default_allocator.alloc(u8, count * 2) catch @panic("Out of memory");
        free_temp_buf = true;
    }

    temp_buf[0] = 0;

    for (parts) |part| {
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

pub fn joinAbsStringBuf(cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) []const u8 {
    return _joinAbsStringBuf(false, []const u8, cwd, buf, _parts, _platform);
}

pub fn joinAbsStringBufZ(cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) [:0]const u8 {
    return _joinAbsStringBuf(true, [:0]const u8, cwd, buf, _parts, _platform);
}

pub fn joinAbsStringBufZTrailingSlash(cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) [:0]const u8 {
    const out = _joinAbsStringBuf(true, [:0]const u8, cwd, buf, _parts, _platform);
    if (out.len + 2 < buf.len and out.len > 0 and out[out.len - 1] != _platform.separator()) {
        buf[out.len] = _platform.separator();
        buf[out.len + 1] = 0;
        return buf[0 .. out.len + 1 :0];
    }

    return out;
}

fn _joinAbsStringBuf(comptime is_sentinel: bool, comptime ReturnType: type, _cwd: []const u8, buf: []u8, _parts: anytype, comptime platform: Platform) ReturnType {
    if (platform.resolve() == .windows or
        (bun.Environment.os == .windows and platform == .loose))
    {
        return _joinAbsStringBufWindows(is_sentinel, ReturnType, _cwd, buf, _parts);
    }

    var parts: []const []const u8 = _parts;
    var temp_buf: [bun.MAX_PATH_BYTES * 2]u8 = undefined;
    if (parts.len == 0) {
        if (comptime is_sentinel) {
            unreachable;
        }
        return _cwd;
    }

    if ((comptime platform == .loose or platform == .posix) and
        parts.len == 1 and
        parts[0].len == 1 and
        parts[0][0] == std.fs.path.sep_posix)
    {
        return "/";
    }

    var out: usize = 0;
    var cwd = if (bun.Environment.isWindows and _cwd.len >= 3 and _cwd[1] == ':')
        _cwd[2..]
    else
        _cwd;

    {
        var part_i: u16 = 0;
        var part_len: u16 = @as(u16, @truncate(parts.len));

        while (part_i < part_len) {
            if (platform.isAbsolute(parts[part_i])) {
                cwd = parts[part_i];
                parts = parts[part_i + 1 ..];

                part_len = @as(u16, @truncate(parts.len));
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

        const part = _part;

        if (out > 0 and temp_buf[out - 1] != platform.separator()) {
            temp_buf[out] = platform.separator();
            out += 1;
        }

        bun.copy(u8, temp_buf[out..], part);
        out += part.len;
    }

    const leading_separator: []const u8 = if (platform.leadingSeparatorIndex(temp_buf[0..out])) |i| brk: {
        const outdir = temp_buf[0 .. i + 1];
        if (platform == .loose) {
            for (outdir) |*c| {
                if (c.* == '\\') {
                    c.* = '/';
                }
            }
        }

        break :brk outdir;
    } else "/";

    const result = normalizeStringBuf(
        temp_buf[leading_separator.len..out],
        buf[leading_separator.len..],
        false,
        platform,
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

fn _joinAbsStringBufWindows(
    comptime is_sentinel: bool,
    comptime ReturnType: type,
    cwd: []const u8,
    buf: []u8,
    parts: []const []const u8,
) ReturnType {
    std.debug.assert(std.fs.path.isAbsoluteWindows(cwd));

    if (parts.len == 0) {
        if (comptime is_sentinel) {
            unreachable;
        }
        return cwd;
    }

    // path.resolve is a bit different on Windows, as there are multiple possible filesystem roots.
    // When you resolve(`C:\hello`, `C:world`), the second arg is a drive letter relative path, so
    // the result of such is `C:\hello\world`, but if you used D:world, you would switch roots and
    // end up with `D:\world`. this root handling basically means a different algorithm.
    //
    // to complicate things, it seems node.js will first figure out what the last root is, then
    // in a separate search, figure out the last absolute path.
    //
    // Given the case `resolve("/one", "D:two", "three", "F:four", "five")`
    // Root is "F:", cwd is "/one", then join all paths that dont exist on other drives.
    //
    // Also, the special root "/" can match into anything, but we have to resolve it to a real
    // root at some point. That is what the `root_of_part.len == 0` check is doing.
    const root, const set_cwd, const n_start = base: {
        const root = root: {
            var n = parts.len;
            while (n > 0) {
                n -= 1;
                const len = windowsVolumeNameLen(parts[n])[0];
                if (len > 0) {
                    break :root parts[n][0..len];
                }
            }
            // use cwd
            const len = windowsVolumeNameLen(cwd)[0];
            break :root cwd[0..len];
        };

        var n = parts.len;
        while (n > 0) {
            n -= 1;
            if (std.fs.path.isAbsoluteWindows(parts[n])) {
                const root_of_part = parts[n][0..windowsVolumeNameLen(parts[n])[0]];
                if (root_of_part.len == 0 or strings.eql(root_of_part, root)) {
                    break :base .{ root, parts[n][root_of_part.len..], n + 1 };
                }
            }
        }
        // use cwd only if the root matches
        const cwd_root = cwd[0..windowsVolumeNameLen(cwd)[0]];
        if (strings.eql(cwd_root, root)) {
            break :base .{ root, cwd[cwd_root.len..], 0 };
        } else {
            break :base .{ root, "/", 0 };
        }
    };

    if (set_cwd.len > 0)
        std.debug.assert(isSepAny(set_cwd[0]));

    var temp_buf: [bun.MAX_PATH_BYTES * 2]u8 = undefined;

    @memcpy(temp_buf[0..root.len], root);
    @memcpy(temp_buf[root.len .. root.len + set_cwd.len], set_cwd);
    var out: usize = root.len + set_cwd.len;

    if (set_cwd.len == 0) {
        // when cwd is `//server/share` without a suffix `/`, the path is considered absolute
        temp_buf[out] = '\\';
        out += 1;
    }

    for (parts[n_start..]) |part| {
        if (part.len == 0) continue;

        if (out > 0 and temp_buf[out - 1] != '\\') {
            temp_buf[out] = '\\';
            out += 1;
        }

        // skip over volume name
        const volume = part[0..windowsVolumeNameLen(part)[0]];
        if (volume.len > 0 and !strings.eql(volume, root))
            continue;

        const part_without_vol = part[volume.len..];
        @memcpy(temp_buf[out .. out + part_without_vol.len], part_without_vol);
        out += part_without_vol.len;
    }

    // if (out > 0 and temp_buf[out - 1] != '\\') {
    //     temp_buf[out] = '\\';
    //     out += 1;
    // }

    const result = normalizeStringBuf(
        temp_buf[0..out],
        buf,
        false,
        .windows,
        true,
    );

    if (comptime is_sentinel) {
        buf.ptr[result.len] = 0;
        return buf[0..result.len :0];
    } else {
        return buf[0..result.len];
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
    return std.mem.lastIndexOfAny(u8, slice, "\\/");
}

pub fn lastIndexOfSeparatorPosix(slice: []const u8) ?usize {
    return std.mem.lastIndexOfScalar(u8, slice, std.fs.path.sep_posix);
}

pub fn lastIndexOfNonSeparatorPosix(slice: []const u8) ?u32 {
    var i: usize = slice.len;
    while (i != 0) : (i -= 1) {
        if (slice[i] != std.fs.path.sep_posix) {
            return @as(u32, @intCast(i));
        }
    }

    return null;
}

pub fn lastIndexOfSeparatorLoose(slice: []const u8) ?usize {
    return lastIndexOfSep(slice);
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
        isSepAny,
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

    // `normalizeStringGeneric` handles absolute path cases for windows
    // we should not prefix with /
    var buf_ = if (platform == .windows) buf else buf[1..];

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
        if (platform == .windows) {
            return out;
        }
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
        const buf = try default_allocator.alloc(u8, 2048);
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

pub fn basename(path: []const u8) []const u8 {
    if (path.len == 0)
        return &[_]u8{};

    var end_index: usize = path.len - 1;
    while (isSepAny(path[end_index])) {
        if (end_index == 0)
            return &[_]u8{};
        end_index -= 1;
    }
    var start_index: usize = end_index;
    end_index += 1;
    while (!isSepAny(path[start_index])) {
        if (start_index == 0)
            return path[0..end_index];
        start_index -= 1;
    }

    return path[start_index + 1 .. end_index];
}
pub fn lastIndexOfSep(path: []const u8) ?usize {
    if (comptime !bun.Environment.isWindows) {
        return strings.lastIndexOfChar(path, '/');
    }

    return std.mem.lastIndexOfAny(u8, path, "/\\");
}

pub fn nextDirname(path_: []const u8) ?[]const u8 {
    var path = path_;
    var root_prefix: []const u8 = "";
    if (path.len > 3) {
        // disk designator
        if (path[1] == ':' and isSepAny(path[2])) {
            root_prefix = path[0..3];
        }

        // TODO: unc path

    }

    if (path.len == 0)
        return if (root_prefix.len > 0) root_prefix else null;

    var end_index: usize = path.len - 1;
    while (isSepAny(path[end_index])) {
        if (end_index == 0)
            return if (root_prefix.len > 0) root_prefix else null;
        end_index -= 1;
    }

    while (!isSepAny(path[end_index])) {
        if (end_index == 0)
            return if (root_prefix.len > 0) root_prefix else null;
        end_index -= 1;
    }

    if (end_index == 0 and isSepAny(path[0]))
        return path[0..1];

    if (end_index == 0)
        return if (root_prefix.len > 0) root_prefix else null;

    return path[0 .. end_index + 1];
}

/// The use case of this is when you do
///     "import '/hello/world'"
/// The windows disk designator is missing!
///
/// Defaulting to C would work but the correct behavior is to use a known disk designator,
/// via an absolute path from the referrer or what not.
///
/// I've made it so that trying to read a file with a posix path is a debug assertion failure.
///
/// To use this, stack allocate the following struct, and then call `resolve`.
///
///     var normalizer = PosixToWinNormalizer{};
///     const result = normalizer.resolve("C:\\dev\\bun", "/dev/bun/test/etc.js");
///
/// When you are certain that using the current working directory is fine, you can use
///
///     const result = normalizer.resolveCWD("/dev/bun/test/etc.js");
///
/// This API does nothing on Linux (it has a size of zero)
pub const PosixToWinNormalizer = struct {
    const Buf = if (bun.Environment.isWindows) bun.PathBuffer else void;

    _raw_bytes: Buf = undefined,

    // methods on PosixToWinNormalizer, to be minimal yet stack allocate the PathBuffer
    // these do not force inline of much code
    pub inline fn resolve(
        this: *PosixToWinNormalizer,
        source_dir: []const u8,
        maybe_posix_path: []const u8,
    ) []const u8 {
        return resolveWithExternalBuf(&this._raw_bytes, source_dir, maybe_posix_path);
    }

    pub inline fn resolveCWD(
        this: *PosixToWinNormalizer,
        maybe_posix_path: []const u8,
    ) ![]const u8 {
        return resolveCWDWithExternalBuf(&this._raw_bytes, maybe_posix_path);
    }

    pub inline fn resolveCWDZ(
        this: *PosixToWinNormalizer,
        maybe_posix_path: []const u8,
    ) ![:0]const u8 {
        return resolveCWDWithExternalBufZ(&this._raw_bytes, maybe_posix_path);
    }

    // underlying implementation:

    fn resolveWithExternalBuf(
        buf: *Buf,
        source_dir: []const u8,
        maybe_posix_path: []const u8,
    ) []const u8 {
        std.debug.assert(std.fs.path.isAbsoluteWindows(maybe_posix_path));
        if (bun.Environment.isWindows) {
            const root = windowsFilesystemRoot(maybe_posix_path);
            if (root.len == 1) {
                std.debug.assert(isSepAny(root[0]));
                const source_root = windowsFilesystemRoot(source_dir);
                @memcpy(buf[0..source_root.len], source_root);
                @memcpy(buf[source_root.len..][0 .. maybe_posix_path.len - 1], maybe_posix_path[1..]);
                return buf[0 .. source_root.len + maybe_posix_path.len - 1];
            }
        }
        return maybe_posix_path;
    }

    fn resolveCWDWithExternalBuf(
        buf: *Buf,
        maybe_posix_path: []const u8,
    ) ![]const u8 {
        std.debug.assert(std.fs.path.isAbsoluteWindows(maybe_posix_path));

        if (bun.Environment.isWindows) {
            const root = windowsFilesystemRoot(maybe_posix_path);
            if (root.len == 1) {
                std.debug.assert(isSepAny(root[0]));
                // note: bun.getcwd will return forward slashes, not what we want.
                const cwd = try std.os.getcwd(buf);
                std.debug.assert(cwd.ptr == buf.ptr);
                const source_root = windowsFilesystemRoot(cwd);
                std.debug.assert(source_root.ptr == source_root.ptr);
                @memcpy(buf[source_root.len..][0 .. maybe_posix_path.len - 1], maybe_posix_path[1..]);
                return buf[0 .. source_root.len + maybe_posix_path.len - 1];
            }
        }

        return maybe_posix_path;
    }

    pub fn resolveCWDWithExternalBufZ(
        buf: *bun.PathBuffer,
        maybe_posix_path: []const u8,
    ) ![:0]const u8 {
        std.debug.assert(std.fs.path.isAbsoluteWindows(maybe_posix_path));

        if (bun.Environment.isWindows) {
            const root = windowsFilesystemRoot(maybe_posix_path);
            if (root.len == 1) {
                std.debug.assert(isSepAny(root[0]));
                // note: bun.getcwd will return forward slashes, not what we want.
                const cwd = try std.os.getcwd(buf);
                std.debug.assert(cwd.ptr == buf.ptr);
                const source_root = windowsFilesystemRoot(cwd);
                std.debug.assert(source_root.ptr == source_root.ptr);
                @memcpy(buf[source_root.len..][0 .. maybe_posix_path.len - 1], maybe_posix_path[1..]);
                buf[source_root.len + maybe_posix_path.len - 1] = 0;
                return buf[0 .. source_root.len + maybe_posix_path.len - 1 :0];
            }
        }

        @memcpy(buf.ptr, maybe_posix_path);
        buf[maybe_posix_path.len] = 0;
        return buf[0..maybe_posix_path.len :0];
    }
};

/// Used in PathInlines.h
/// gets cwd off of the global object
export fn ResolvePath__joinAbsStringBufCurrentPlatformBunString(
    globalObject: *bun.JSC.JSGlobalObject,
    in: bun.String,
) bun.String {
    const str = in.toUTF8WithoutRef(bun.default_allocator);
    defer str.deinit();

    const out_slice = joinAbsStringBuf(
        globalObject.bunVM().bundler.fs.top_level_dir,
        &join_buf,
        &.{str.slice()},
        comptime Platform.auto.resolve(),
    );

    return bun.String.createUTF8(out_slice);
}
