const tester = @import("../test/tester.zig");
const std = @import("std");
const strings = @import("../string_immutable.zig");
const FeatureFlags = @import("../feature_flags.zig");
const default_allocator = @import("../allocators/memory_allocator.zig").c_allocator;
const bun = @import("root").bun;
const Fs = @import("../fs.zig");

threadlocal var parser_join_input_buffer: [4096]u8 = undefined;
threadlocal var parser_buffer: [1024]u8 = undefined;

pub fn z(input: []const u8, output: *bun.PathBuffer) [:0]const u8 {
    if (input.len > bun.MAX_PATH_BYTES) {
        if (comptime bun.Environment.allow_assert) @panic("path too long");
        return "";
    }

    @memcpy(output[0..input.len], input);
    output[input.len] = 0;

    return output[0..input.len :0];
}

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
const IsSeparatorFuncT = fn (comptime T: type, char: anytype) bool;
const LastSeparatorFunction = fn (slice: []const u8) ?usize;
const LastSeparatorFunctionT = fn (comptime T: type, slice: anytype) ?usize;

inline fn @"is .."(slice: []const u8) bool {
    return slice.len >= 2 and @as(u16, @bitCast(slice[0..2].*)) == comptime std.mem.readInt(u16, "..", .little);
}

inline fn @"is .. with type"(comptime T: type, slice: []const T) bool {
    if (comptime T == u8) return @"is .."(slice);
    return slice.len >= 2 and slice[0] == '.' and slice[1] == '.';
}

inline fn @"is ../"(slice: []const u8) bool {
    return strings.hasPrefixComptime(slice, "../");
}

const ParentEqual = enum {
    parent,
    equal,
    unrelated,
};

pub fn isParentOrEqual(parent_: []const u8, child: []const u8) ParentEqual {
    var parent = parent_;
    while (parent.len > 0 and isSepAny(parent[parent.len - 1])) {
        parent = parent[0 .. parent.len - 1];
    }

    const contains = if (comptime !bun.Environment.isLinux)
        strings.containsCaseInsensitiveASCII
    else
        strings.contains;
    if (!contains(child, parent)) return .unrelated;

    if (child.len == parent.len) return .equal;
    if (isSepAny(child[parent.len])) return .parent;
    return .unrelated;
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
                if (@call(bun.callmod_inline, isPathSeparator, .{input[0][index]})) {
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
                if (@call(bun.callmod_inline, isPathSeparator, .{input[0][index]})) {
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
            if (@call(bun.callmod_inline, isPathSeparator, .{str[index]})) {
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
                if (@call(bun.callmod_inline, isPathSeparator, .{input[0][index]})) {
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
                if (@call(bun.callmod_inline, isPathSeparator, .{input[0][index]})) {
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
            if (@call(bun.callmod_inline, isPathSeparator, .{str[index]})) {
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

threadlocal var relative_to_common_path_buf: bun.PathBuffer = undefined;

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
        var i: usize = @as(usize, @intCast(@intFromBool(platform.isSeparator(normalized_from[0])))) + 1 + last_common_separator;

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
            if (platform.isSeparator(tail[0])) {
                tail = tail[1..];
            }
        }

        // avoid making non-absolute paths absolute
        const insert_leading_slash = !platform.isSeparator(tail[0]) and
            out_slice.len > 0 and !platform.isSeparator(out_slice[out_slice.len - 1]);

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

pub fn relativeNormalizedBuf(buf: []u8, from: []const u8, to: []const u8, comptime platform: Platform, comptime always_copy: bool) []const u8 {
    if ((if (platform == .windows)
        strings.eqlCaseInsensitiveASCII(from, to, true)
    else
        from.len == to.len and strings.eqlLong(from, to, true)))
    {
        return "";
    }

    const two = [_][]const u8{ from, to };
    const common_path = longestCommonPathGeneric(&two, platform);

    return relativeToCommonPath(common_path, from, to, buf, always_copy, platform);
}

pub fn relativeNormalized(from: []const u8, to: []const u8, comptime platform: Platform, comptime always_copy: bool) []const u8 {
    return relativeNormalizedBuf(&relative_to_common_path_buf, from, to, platform, always_copy);
}

pub fn dirname(str: []const u8, comptime platform: Platform) []const u8 {
    switch (comptime platform.resolve()) {
        .loose => {
            const separator = lastIndexOfSeparatorLoose(str) orelse return "";
            return str[0..separator];
        },
        .posix => {
            const separator = lastIndexOfSeparatorPosix(str) orelse return "";
            if (separator == 0) return "/";
            if (separator == str.len - 1) return dirname(str[0 .. str.len - 1], platform);
            return str[0..separator];
        },
        .windows => {
            const separator = lastIndexOfSeparatorWindows(str) orelse return std.fs.path.diskDesignatorWindows(str);
            return str[0..separator];
        },
        else => @compileError("unreachable"),
    }
}

pub fn dirnameW(str: []const u16) []const u16 {
    const separator = lastIndexOfSeparatorWindowsT(u16, str) orelse {
        // return disk designator instead
        if (str.len < 2) return &.{};
        if (!(str[1] == ':')) return &.{};
        if (!bun.path.isDriveLetterT(u16, str[0])) return &.{};
        return str[0..2];
    };
    return str[0..separator];
}

threadlocal var relative_from_buf: bun.PathBuffer = undefined;
threadlocal var relative_to_buf: bun.PathBuffer = undefined;

pub fn relative(from: []const u8, to: []const u8) []const u8 {
    return relativePlatform(from, to, .auto, false);
}

pub fn relativeZ(from: []const u8, to: []const u8) [:0]const u8 {
    return relativeBufZ(&relative_to_common_path_buf, from, to, .auto, true);
}

pub fn relativeBufZ(buf: []u8, from: []const u8, to: []const u8) [:0]const u8 {
    const rel = relativePlatformBuf(buf, from, to, .auto, true);
    buf[rel.len] = 0;
    return buf[0..rel.len :0];
}

pub fn relativePlatformBuf(buf: []u8, from: []const u8, to: []const u8, comptime platform: Platform, comptime always_copy: bool) []const u8 {
    const normalized_from = if (platform.isAbsolute(from)) brk: {
        if (platform == .loose and bun.Environment.isWindows) {
            // we want to invoke the windows resolution behavior but end up with a
            // string with forward slashes.
            const normalized = normalizeStringBuf(from, relative_from_buf[1..], true, .windows, true);
            platformToPosixInPlace(u8, normalized);
            break :brk normalized;
        }
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
        if (platform == .loose and bun.Environment.isWindows) {
            const normalized = normalizeStringBuf(to, relative_to_buf[1..], true, .windows, true);
            platformToPosixInPlace(u8, normalized);
            break :brk normalized;
        }
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

    return relativeNormalizedBuf(buf, normalized_from, normalized_to, platform, always_copy);
}

pub fn relativePlatform(from: []const u8, to: []const u8, comptime platform: Platform, comptime always_copy: bool) []const u8 {
    return relativePlatformBuf(&relative_to_common_path_buf, from, to, platform, always_copy);
}

pub fn relativeAlloc(allocator: std.mem.Allocator, from: []const u8, to: []const u8) ![]const u8 {
    const result = relativePlatform(from, to, Platform.current, false);
    return try allocator.dupe(u8, result);
}

// This function is based on Go's volumeNameLen function
// https://cs.opensource.google/go/go/+/refs/tags/go1.17.6:src/path/filepath/path_windows.go;l=57
// volumeNameLen returns length of the leading volume name on Windows.
pub fn windowsVolumeNameLen(path: []const u8) struct { usize, usize } {
    return windowsVolumeNameLenT(u8, path);
}
pub fn windowsVolumeNameLenT(comptime T: type, path: []const T) struct { usize, usize } {
    if (path.len < 2) return .{ 0, 0 };
    // with drive letter
    const c = path[0];
    if (path[1] == ':') {
        if (isDriveLetterT(T, c)) {
            return .{ 2, 0 };
        }
    }
    // UNC
    if (path.len >= 5 and
        Platform.windows.isSeparatorT(T, path[0]) and
        Platform.windows.isSeparatorT(T, path[1]) and
        !Platform.windows.isSeparatorT(T, path[2]) and
        path[2] != '.')
    {
        if (T == u8) {
            if (strings.indexOfAny(path[3..], "/\\")) |idx| {
                // TODO: handle input "//abc//def" should be picked up as a unc path
                if (path.len > idx + 4 and !Platform.windows.isSeparatorT(T, path[idx + 4])) {
                    if (strings.indexOfAny(path[idx + 4 ..], "/\\")) |idx2| {
                        return .{ idx + idx2 + 4, idx + 3 };
                    } else {
                        return .{ path.len, idx + 3 };
                    }
                }
            }

            return .{ path.len, 0 };
        } else {
            if (bun.strings.indexAnyComptimeT(T, path[3..], strings.literal(T, "/\\"))) |idx| {
                // TODO: handle input "//abc//def" should be picked up as a unc path
                if (path.len > idx + 4 and !Platform.windows.isSeparatorT(T, path[idx + 4])) {
                    if (bun.strings.indexAnyComptimeT(T, path[idx + 4 ..], strings.literal(T, "/\\"))) |idx2| {
                        return .{ idx + idx2 + 4, idx + 3 };
                    } else {
                        return .{ path.len, idx + 3 };
                    }
                }
            }
            return .{ path.len, 0 };
        }
    }
    return .{ 0, 0 };
}

pub fn windowsVolumeName(path: []const u8) []const u8 {
    return path[0..@call(bun.callmod_inline, windowsVolumeNameLen, .{path})[0]];
}

pub fn windowsFilesystemRoot(path: []const u8) []const u8 {
    return windowsFilesystemRootT(u8, path);
}

pub fn isDriveLetter(c: u8) bool {
    return isDriveLetterT(u8, c);
}

pub fn isDriveLetterT(comptime T: type, c: T) bool {
    return 'a' <= c and c <= 'z' or 'A' <= c and c <= 'Z';
}

pub fn hasAnyIllegalChars(maybe_path: []const u8) bool {
    if (!bun.Environment.isWindows) return false;
    var maybe_path_ = maybe_path;
    // check for disk discrimnator; remove it since it has a ':'
    if (startsWithDiskDiscriminator(maybe_path_)) maybe_path_ = maybe_path_[2..];
    // guard against OBJECT_NAME_INVALID => unreachable
    return bun.strings.indexAnyComptime(maybe_path_, "<>:\"|?*") != null;
}

pub fn startsWithDiskDiscriminator(maybe_path: []const u8) bool {
    if (!bun.Environment.isWindows) return false;
    if (maybe_path.len < 3) return false;
    if (!isDriveLetter(maybe_path[0])) return false;
    if (maybe_path[1] != ':') return false;
    if (maybe_path[2] != '\\') return false;
    return true;
}

// path.relative lets you do relative across different share drives
pub fn windowsFilesystemRootT(comptime T: type, path: []const T) []const T {
    // minimum: `C:`
    if (path.len < 2)
        return if (isSepAnyT(T, path[0])) path[0..1] else path[0..0];
    // with drive letter
    const c = path[0];
    if (path[1] == ':') {
        if (isDriveLetterT(T, c)) {
            if (path.len > 2 and isSepAnyT(T, path[2]))
                return path[0..3]
            else
                return path[0..2];
        }
    }

    // UNC
    if (path.len >= 5 and
        Platform.windows.isSeparatorT(T, path[0]) and
        Platform.windows.isSeparatorT(T, path[1]) and
        !Platform.windows.isSeparatorT(T, path[2]) and
        path[2] != '.')
    {
        if (bun.strings.indexOfAnyT(T, path[3..], "/\\")) |idx| {
            if (bun.strings.indexOfAnyT(T, path[4 + idx ..], "/\\")) |idx_second| {
                return path[0 .. idx + idx_second + 4 + 1]; // +1 to skip second separator
            }
        }
        return path[0..];
    }

    if (isSepAnyT(T, path[0])) return path[0..1];
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
    comptime preserve_trailing_slash: bool,
) []u8 {
    return normalizeStringGenericT(u8, path_, buf, allow_above_root, separator, isSeparator, preserve_trailing_slash);
}

fn separatorAdapter(comptime T: type, func: anytype) fn (T) bool {
    return struct {
        fn call(char: T) bool {
            return func(T, char);
        }
    }.call;
}

pub fn normalizeStringGenericT(
    comptime T: type,
    path_: []const T,
    buf: []T,
    comptime allow_above_root: bool,
    comptime separator: T,
    comptime isSeparatorT: anytype,
    comptime preserve_trailing_slash: bool,
) []T {
    return normalizeStringGenericTZ(T, path_, buf, .{
        .allow_above_root = allow_above_root,
        .separator = separator,
        .isSeparator = separatorAdapter(T, isSeparatorT),
        .preserve_trailing_slash = preserve_trailing_slash,
        .zero_terminate = false,
        .add_nt_prefix = false,
    });
}

pub fn NormalizeOptions(comptime T: type) type {
    return struct {
        allow_above_root: bool = false,
        separator: T = std.fs.path.sep,
        isSeparator: fn (T) bool = struct {
            fn call(char: T) bool {
                return if (comptime std.fs.path.sep == std.fs.path.sep_windows)
                    char == '\\' or char == '/'
                else
                    char == '/';
            }
        }.call,
        preserve_trailing_slash: bool = false,
        zero_terminate: bool = false,
        add_nt_prefix: bool = false,
    };
}

pub fn normalizeStringGenericTZ(
    comptime T: type,
    path_: []const T,
    buf: []T,
    comptime options: NormalizeOptions(T),
) if (options.zero_terminate) [:0]T else []T {
    const isWindows, const sep_str = comptime .{ options.separator == std.fs.path.sep_windows, &[_]u8{options.separator} };

    if (isWindows and bun.Environment.isDebug) {
        // this is here to catch a potential mistake by the caller
        //
        // since it is theoretically possible to get here in release
        // we will not do this check in release.
        assert(!strings.hasPrefixComptimeType(T, path_, strings.literal(T, ":\\")));
    }

    var buf_i: usize = 0;
    var dotdot: usize = 0;
    var path_begin: usize = 0;

    const volLen, const indexOfThirdUNCSlash = if (isWindows and !options.allow_above_root)
        windowsVolumeNameLenT(T, path_)
    else
        .{ 0, 0 };

    if (isWindows and !options.allow_above_root) {
        if (volLen > 0) {
            if (options.add_nt_prefix) {
                @memcpy(buf[buf_i .. buf_i + 4], strings.literal(T, "\\??\\"));
                buf_i += 4;
            }
            if (path_[1] != ':') {
                // UNC paths
                if (options.add_nt_prefix) {
                    @memcpy(buf[buf_i .. buf_i + 4], strings.literal(T, "UNC" ++ sep_str));
                    buf_i += 2;
                } else {
                    @memcpy(buf[buf_i .. buf_i + 2], strings.literal(T, sep_str ++ sep_str));
                }
                if (indexOfThirdUNCSlash > 0) {
                    // we have the ending slash
                    @memcpy(buf[buf_i + 2 .. buf_i + indexOfThirdUNCSlash + 1], path_[2 .. indexOfThirdUNCSlash + 1]);
                    buf[buf_i + indexOfThirdUNCSlash] = options.separator;
                    @memcpy(
                        buf[buf_i + indexOfThirdUNCSlash + 1 .. buf_i + volLen],
                        path_[indexOfThirdUNCSlash + 1 .. volLen],
                    );
                } else {
                    // we dont have the ending slash
                    @memcpy(buf[buf_i + 2 .. buf_i + volLen], path_[2..volLen]);
                }
                buf[buf_i + volLen] = options.separator;
                buf_i += volLen + 1;
                path_begin = volLen + 1;

                // it is just a volume name
                if (path_begin >= path_.len) {
                    if (options.zero_terminate) {
                        buf[buf_i] = 0;
                        return buf[0..buf_i :0];
                    } else {
                        return buf[0..buf_i];
                    }
                }
            } else {
                // drive letter
                buf[buf_i] = switch (path_[0]) {
                    'a'...'z' => path_[0] & (std.math.maxInt(T) ^ (1 << 5)),
                    else => path_[0],
                };
                buf[buf_i + 1] = ':';
                buf_i += 2;
                dotdot = buf_i;
                path_begin = 2;
            }
        } else if (path_.len > 0 and options.isSeparator(path_[0])) {
            buf[buf_i] = options.separator;
            buf_i += 1;
            dotdot = buf_i;
            path_begin = 1;
        }
    }
    if (isWindows and options.allow_above_root) {
        if (path_.len >= 2 and path_[1] == ':') {
            if (options.add_nt_prefix) {
                @memcpy(buf[buf_i .. buf_i + 4], &strings.literalBuf(T, "\\??\\"));
                buf_i += 4;
            }
            buf[buf_i] = path_[0];
            buf[buf_i + 1] = ':';
            buf_i += 2;
            dotdot = buf_i;
            path_begin = 2;
        }
    }

    var r: usize = 0;
    var path, const buf_start = if (isWindows)
        .{ path_[path_begin..], buf_i }
    else
        .{ path_, 0 };

    const n = path.len;

    if (isWindows and (options.allow_above_root or volLen > 0)) {
        // consume leading slashes on windows
        if (r < n and options.isSeparator(path[r])) {
            r += 1;
            buf[buf_i] = options.separator;
            buf_i += 1;

            // win32.resolve("C:\\Users\\bun", "C:\\Users\\bun", "/..\\bar")
            // should be "C:\\bar" not "C:bar"
            dotdot = buf_i;
        }
    }

    while (r < n) {
        // empty path element
        // or
        // . element
        if (options.isSeparator(path[r])) {
            r += 1;
            continue;
        }

        if (path[r] == '.' and (r + 1 == n or options.isSeparator(path[r + 1]))) {
            // skipping two is a windows-specific bugfix
            r += 1;
            continue;
        }

        if (@"is .. with type"(T, path[r..]) and (r + 2 == n or options.isSeparator(path[r + 2]))) {
            r += 2;
            // .. element: remove to last separator
            if (buf_i > dotdot) {
                buf_i -= 1;
                while (buf_i > dotdot and !options.isSeparator(buf[buf_i])) {
                    buf_i -= 1;
                }
            } else if (options.allow_above_root) {
                if (buf_i > buf_start) {
                    buf[buf_i..][0..3].* = (strings.literal(T, sep_str ++ "..")).*;
                    buf_i += 3;
                } else {
                    buf[buf_i..][0..2].* = (strings.literal(T, "..")).*;
                    buf_i += 2;
                }
                dotdot = buf_i;
            }

            continue;
        }

        // real path element.
        // add slash if needed
        if (buf_i != buf_start and buf_i > 0 and !options.isSeparator(buf[buf_i - 1])) {
            buf[buf_i] = options.separator;
            buf_i += 1;
        }

        const from = r;
        while (r < n and !options.isSeparator(path[r])) : (r += 1) {}
        const count = r - from;
        @memcpy(buf[buf_i..][0..count], path[from..][0..count]);
        buf_i += count;
    }

    if (options.preserve_trailing_slash) {
        // Was there a trailing slash? Let's keep it.
        if (buf_i > 0 and path_[path_.len - 1] == options.separator and buf[buf_i - 1] != options.separator) {
            buf[buf_i] = options.separator;
            buf_i += 1;
        }
    }

    if (isWindows and buf_i == 2 and buf[1] == ':') {
        // If the original path is just a relative path with a drive letter,
        // add .
        buf[buf_i] = if (path.len > 0 and path[0] == '\\') '\\' else '.';
        buf_i += 1;
    }

    if (options.zero_terminate) {
        buf[buf_i] = 0;
    }

    const result = if (options.zero_terminate) buf[0..buf_i :0] else buf[0..buf_i];

    if (bun.Environment.allow_assert and isWindows) {
        assert(!strings.hasPrefixComptimeType(T, result, strings.literal(T, "\\:\\")));
    }

    return result;
}

pub const Platform = enum {
    auto,
    loose,
    windows,
    posix,
    nt,

    pub fn isAbsolute(comptime platform: Platform, path: []const u8) bool {
        return isAbsoluteT(platform, u8, path);
    }

    pub fn isAbsoluteT(comptime platform: Platform, comptime T: type, path: []const T) bool {
        if (comptime T != u8 and T != u16) @compileError("Unsupported type given to isAbsoluteT");
        return switch (comptime platform) {
            .auto => (comptime platform.resolve()).isAbsoluteT(T, path),
            .posix => path.len > 0 and path[0] == '/',
            .nt,
            .windows,
            .loose,
            => if (T == u8)
                std.fs.path.isAbsoluteWindows(path)
            else
                std.fs.path.isAbsoluteWindowsWTF16(path),
        };
    }

    pub fn separator(comptime platform: Platform) u8 {
        return comptime switch (platform) {
            .auto => platform.resolve().separator(),
            .loose, .posix => std.fs.path.sep_posix,
            .nt, .windows => std.fs.path.sep_windows,
        };
    }

    pub fn separatorString(comptime platform: Platform) []const u8 {
        return comptime switch (platform) {
            .auto => platform.resolve().separatorString(),
            .loose, .posix => std.fs.path.sep_str_posix,
            .nt, .windows => std.fs.path.sep_str_windows,
        };
    }

    pub const current: Platform = switch (@import("builtin").target.os.tag) {
        .windows => Platform.windows,
        else => Platform.posix,
    };

    pub fn getSeparatorFunc(comptime _platform: Platform) IsSeparatorFunc {
        switch (comptime _platform.resolve()) {
            .auto => @compileError("unreachable"),
            .loose => {
                return isSepAny;
            },
            .nt, .windows => {
                return isSepAny;
            },
            .posix => {
                return isSepPosix;
            },
        }
    }

    pub fn getSeparatorFuncT(comptime _platform: Platform) IsSeparatorFuncT {
        switch (comptime _platform.resolve()) {
            .auto => @compileError("unreachable"),
            .loose => {
                return isSepAnyT;
            },
            .nt, .windows => {
                return isSepAnyT;
            },
            .posix => {
                return isSepPosixT;
            },
        }
    }

    pub fn getLastSeparatorFunc(comptime _platform: Platform) LastSeparatorFunction {
        switch (comptime _platform.resolve()) {
            .auto => @compileError("unreachable"),
            .loose => {
                return lastIndexOfSeparatorLoose;
            },
            .nt, .windows => {
                return lastIndexOfSeparatorWindows;
            },
            .posix => {
                return lastIndexOfSeparatorPosix;
            },
        }
    }

    pub fn getLastSeparatorFuncT(comptime _platform: Platform) LastSeparatorFunctionT {
        switch (comptime _platform.resolve()) {
            .auto => @compileError("unreachable"),
            .loose => {
                return lastIndexOfSeparatorLooseT;
            },
            .nt, .windows => {
                return lastIndexOfSeparatorWindowsT;
            },
            .posix => {
                return lastIndexOfSeparatorPosixT;
            },
        }
    }

    pub inline fn isSeparator(comptime _platform: Platform, char: u8) bool {
        return isSeparatorT(_platform, u8, char);
    }

    pub inline fn isSeparatorT(comptime _platform: Platform, comptime T: type, char: T) bool {
        switch (comptime _platform.resolve()) {
            .auto => @compileError("unreachable"),
            .loose => {
                return isSepAnyT(T, char);
            },
            .nt, .windows => {
                return isSepAnyT(T, char);
            },
            .posix => {
                return isSepPosixT(T, char);
            },
        }
    }

    pub fn trailingSeparator(comptime _platform: Platform) [2]u8 {
        return comptime switch (_platform) {
            .auto => _platform.resolve().trailingSeparator(),
            .nt, .windows => ".\\".*,
            .posix, .loose => "./".*,
        };
    }

    pub fn leadingSeparatorIndex(comptime _platform: Platform, path: anytype) ?usize {
        switch (comptime _platform.resolve()) {
            .nt, .windows => {
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
pub fn normalizeStringZ(str: []const u8, comptime allow_above_root: bool, comptime _platform: Platform) [:0]u8 {
    const normalized = normalizeStringBuf(str, &parser_buffer, allow_above_root, _platform, false);
    parser_buffer[normalized.len] = 0;
    return parser_buffer[0..normalized.len :0];
}

pub fn normalizeBuf(str: []const u8, buf: []u8, comptime _platform: Platform) []u8 {
    return normalizeBufT(u8, str, buf, _platform);
}

pub fn normalizeBufZ(str: []const u8, buf: []u8, comptime _platform: Platform) [:0]u8 {
    const norm = normalizeBufT(u8, str, buf, _platform);
    buf[norm.len] = 0;
    return buf[0..norm.len :0];
}

pub fn normalizeBufT(comptime T: type, str: []const T, buf: []T, comptime _platform: Platform) []T {
    if (str.len == 0) {
        buf[0] = '.';
        return buf[0..1];
    }

    const is_absolute = _platform.isAbsoluteT(T, str);

    const trailing_separator = _platform.getLastSeparatorFuncT()(T, str) == str.len - 1;

    if (is_absolute and trailing_separator)
        return normalizeStringBufT(T, str, buf, true, _platform, true);

    if (is_absolute and !trailing_separator)
        return normalizeStringBufT(T, str, buf, true, _platform, false);

    if (!is_absolute and !trailing_separator)
        return normalizeStringBufT(T, str, buf, false, _platform, false);

    return normalizeStringBufT(T, str, buf, false, _platform, true);
}

pub fn normalizeStringBuf(
    str: []const u8,
    buf: []u8,
    comptime allow_above_root: bool,
    comptime platform: Platform,
    comptime preserve_trailing_slash: bool,
) []u8 {
    return normalizeStringBufT(u8, str, buf, allow_above_root, platform, preserve_trailing_slash);
}

pub fn normalizeStringBufT(
    comptime T: type,
    str: []const T,
    buf: []T,
    comptime allow_above_root: bool,
    comptime platform: Platform,
    comptime preserve_trailing_slash: bool,
) []T {
    switch (comptime platform.resolve()) {
        .nt, .auto => @compileError("unreachable"),

        .windows => {
            return normalizeStringWindowsT(
                T,
                str,
                buf,
                allow_above_root,
                preserve_trailing_slash,
            );
        },
        .posix => {
            return normalizeStringLooseBufT(
                T,
                str,
                buf,
                allow_above_root,
                preserve_trailing_slash,
            );
        },

        .loose => {
            return normalizeStringLooseBufT(
                T,
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

pub fn joinAbs(cwd: []const u8, comptime _platform: Platform, part: []const u8) []const u8 {
    return joinAbsString(cwd, &.{part}, _platform);
}

/// Convert parts of potentially invalid file paths into a single valid filpeath
/// without querying the filesystem
/// This is the equivalent of path.resolve
///
/// Returned path is stored in a temporary buffer. It must be copied if it needs to be stored.
pub fn joinAbsString(_cwd: []const u8, parts: anytype, comptime _platform: Platform) []const u8 {
    return joinAbsStringBuf(
        _cwd,
        &parser_join_input_buffer,
        parts,
        _platform,
    );
}

/// Convert parts of potentially invalid file paths into a single valid filpeath
/// without querying the filesystem
/// This is the equivalent of path.resolve
///
/// Returned path is stored in a temporary buffer. It must be copied if it needs to be stored.
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
    assert(bun.isSliceInBuffer(joined, buf));
    const start_offset = @intFromPtr(joined.ptr) - @intFromPtr(buf.ptr);
    buf[joined.len + start_offset] = 0;
    return buf[start_offset..][0..joined.len :0];
}
pub fn joinStringBuf(buf: []u8, parts: anytype, comptime _platform: Platform) []const u8 {
    return joinStringBufT(u8, buf, parts, _platform);
}
pub fn joinStringBufW(buf: []u16, parts: anytype, comptime _platform: Platform) []const u16 {
    return joinStringBufT(u16, buf, parts, _platform);
}

pub fn joinStringBufWZ(buf: []u16, parts: anytype, comptime _platform: Platform) [:0]const u16 {
    const joined = joinStringBufT(u16, buf[0 .. buf.len - 1], parts, _platform);
    assert(bun.isSliceInBufferT(u16, joined, buf));
    const start_offset = @intFromPtr(joined.ptr) / 2 - @intFromPtr(buf.ptr) / 2;
    buf[joined.len + start_offset] = 0;
    return buf[start_offset..][0..joined.len :0];
}

pub fn joinStringBufT(comptime T: type, buf: []T, parts: anytype, comptime _platform: Platform) []const T {
    const platform = comptime _platform.resolve();

    var written: usize = 0;
    var temp_buf_: [4096]T = undefined;
    var temp_buf: []T = &temp_buf_;
    var free_temp_buf = false;
    defer {
        if (free_temp_buf) {
            bun.default_allocator.free(temp_buf);
        }
    }

    var count: usize = 0;
    for (parts) |part| {
        if (part.len == 0) continue;
        count += part.len + 1;
    }

    if (count * 2 > temp_buf.len) {
        temp_buf = bun.default_allocator.alloc(T, count * 2) catch bun.outOfMemory();
        free_temp_buf = true;
    }

    temp_buf[0] = 0;

    for (parts) |part| {
        if (part.len == 0) continue;

        if (written > 0) {
            temp_buf[written] = platform.separator();
            written += 1;
        }

        const Element = std.meta.Elem(@TypeOf(part));
        if (comptime T == u16 and Element == u8) {
            const wrote = bun.strings.convertUTF8toUTF16InBuffer(temp_buf[written..], part);
            written += wrote.len;
        } else {
            bun.copy(T, temp_buf[written..], part);
            written += part.len;
        }
    }

    if (written == 0) {
        buf[0] = '.';
        return buf[0..1];
    }

    return normalizeStringNodeT(T, temp_buf[0..written], buf, platform);
}

pub fn joinAbsStringBuf(cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) []const u8 {
    return _joinAbsStringBuf(false, []const u8, cwd, buf, _parts, _platform);
}

pub fn joinAbsStringBufZ(cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) [:0]const u8 {
    return _joinAbsStringBuf(true, [:0]const u8, cwd, buf, _parts, _platform);
}

pub fn joinAbsStringBufZNT(cwd: []const u8, buf: []u8, _parts: anytype, comptime _platform: Platform) [:0]const u8 {
    if ((_platform == .auto or _platform == .loose or _platform == .windows) and bun.Environment.isWindows) {
        return _joinAbsStringBuf(true, [:0]const u8, cwd, buf, _parts, .nt);
    }

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

    if (comptime platform.resolve() == .nt) {
        const end_path = _joinAbsStringBufWindows(is_sentinel, ReturnType, _cwd, buf[4..], _parts);
        buf[0..4].* = "\\\\?\\".*;
        if (comptime is_sentinel) {
            buf[end_path.len + 4] = 0;
            return buf[0 .. end_path.len + 4 :0];
        }
        return buf[0 .. end_path.len + 4];
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
    assert(std.fs.path.isAbsoluteWindows(cwd));

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
        assert(isSepAny(set_cwd[0]));

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
        if (volume.len > 0 and !strings.eqlLong(volume, root, true))
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
    return isSepPosixT(u8, char);
}

pub fn isSepPosixT(comptime T: type, char: T) bool {
    return char == std.fs.path.sep_posix;
}

pub fn isSepWin32(char: u8) bool {
    return isSepWin32T(u8, char);
}

pub fn isSepWin32T(comptime T: type, char: T) bool {
    return char == std.fs.path.sep_windows;
}

pub fn isSepAny(char: u8) bool {
    return isSepAnyT(u8, char);
}

pub fn isSepAnyT(comptime T: type, char: T) bool {
    return @call(bun.callmod_inline, isSepPosixT, .{ T, char }) or @call(bun.callmod_inline, isSepWin32T, .{ T, char });
}

pub fn lastIndexOfSeparatorWindows(slice: []const u8) ?usize {
    return lastIndexOfSeparatorWindowsT(u8, slice);
}

pub fn lastIndexOfSeparatorWindowsT(comptime T: type, slice: []const T) ?usize {
    return std.mem.lastIndexOfAny(T, slice, strings.literal(T, "\\/"));
}

pub fn lastIndexOfSeparatorPosix(slice: []const u8) ?usize {
    return lastIndexOfSeparatorPosixT(u8, slice);
}

pub fn lastIndexOfSeparatorPosixT(comptime T: type, slice: []const T) ?usize {
    return std.mem.lastIndexOfScalar(T, slice, std.fs.path.sep_posix);
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
    return lastIndexOfSeparatorLooseT(u8, slice);
}

pub fn lastIndexOfSeparatorLooseT(comptime T: type, slice: []const T) ?usize {
    return lastIndexOfSepT(T, slice);
}

pub fn normalizeStringLooseBuf(
    str: []const u8,
    buf: []u8,
    comptime allow_above_root: bool,
    comptime preserve_trailing_slash: bool,
) []u8 {
    return normalizeStringLooseBufT(u8, str, buf, allow_above_root, preserve_trailing_slash);
}

pub fn normalizeStringLooseBufT(
    comptime T: type,
    str: []const T,
    buf: []T,
    comptime allow_above_root: bool,
    comptime preserve_trailing_slash: bool,
) []T {
    return normalizeStringGenericT(
        T,
        str,
        buf,
        allow_above_root,
        std.fs.path.sep_posix,
        isSepAnyT,
        preserve_trailing_slash,
    );
}

pub fn normalizeStringWindows(
    str: []const u8,
    buf: []u8,
    comptime allow_above_root: bool,
    comptime preserve_trailing_slash: bool,
) []u8 {
    return normalizeStringWindowsT(u8, str, buf, allow_above_root, preserve_trailing_slash);
}

pub fn normalizeStringWindowsT(
    comptime T: type,
    str: []const T,
    buf: []T,
    comptime allow_above_root: bool,
    comptime preserve_trailing_slash: bool,
) []T {
    return normalizeStringGenericT(
        T,
        str,
        buf,
        allow_above_root,
        std.fs.path.sep_windows,
        isSepAnyT,
        preserve_trailing_slash,
    );
}

pub fn normalizeStringNode(
    str: []const u8,
    buf: []u8,
    comptime platform: Platform,
) []u8 {
    return normalizeStringNodeT(u8, str, buf, platform);
}

pub fn normalizeStringNodeT(
    comptime T: type,
    str: []const T,
    buf: []T,
    comptime platform: Platform,
) []const T {
    if (str.len == 0) {
        buf[0] = '.';
        return buf[0..1];
    }

    const is_absolute = platform.isAbsoluteT(T, str);
    const trailing_separator = platform.isSeparatorT(T, str[str.len - 1]);

    // `normalizeStringGeneric` handles absolute path cases for windows
    // we should not prefix with /
    var buf_ = if (platform == .windows) buf else buf[1..];

    var out = if (!is_absolute) normalizeStringGenericT(
        T,
        str,
        buf_,
        true,
        comptime platform.resolve().separator(),
        comptime platform.getSeparatorFuncT(),
        false,
    ) else normalizeStringGenericT(
        T,
        str,
        buf_,
        false,
        comptime platform.resolve().separator(),
        comptime platform.getSeparatorFuncT(),
        false,
    );

    if (out.len == 0) {
        if (is_absolute) {
            buf[0] = platform.separator();
            return buf[0..1];
        }

        if (trailing_separator) {
            const sep = platform.trailingSeparator();
            buf[0..2].* = .{ sep[0], sep[1] };
            return buf[0..2];
        }

        buf[0] = '.';
        return buf[0..1];
    }

    if (trailing_separator) {
        if (!platform.isSeparatorT(T, out[out.len - 1])) {
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

pub fn basename(path: []const u8) []const u8 {
    if (path.len == 0)
        return &[_]u8{};

    var end_index: usize = path.len - 1;
    while (isSepAny(path[end_index])) {
        if (end_index == 0)
            return "/";
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
    return lastIndexOfSepT(u8, path);
}

pub fn lastIndexOfSepT(comptime T: type, path: []const T) ?usize {
    if (comptime !bun.Environment.isWindows) {
        return strings.lastIndexOfCharT(T, path, '/');
    }

    return std.mem.lastIndexOfAny(T, path, "/\\");
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

    pub inline fn resolveZ(
        this: *PosixToWinNormalizer,
        source_dir: []const u8,
        maybe_posix_path: [:0]const u8,
    ) [:0]const u8 {
        return resolveWithExternalBufZ(&this._raw_bytes, source_dir, maybe_posix_path);
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
        assert(std.fs.path.isAbsoluteWindows(maybe_posix_path));
        if (bun.Environment.isWindows) {
            const root = windowsFilesystemRoot(maybe_posix_path);
            if (root.len == 1) {
                assert(isSepAny(root[0]));
                if (bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, maybe_posix_path)) {
                    const source_root = windowsFilesystemRoot(source_dir);
                    @memcpy(buf[0..source_root.len], source_root);
                    @memcpy(buf[source_root.len..][0 .. maybe_posix_path.len - 1], maybe_posix_path[1..]);
                    const res = buf[0 .. source_root.len + maybe_posix_path.len - 1];
                    assert(!bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, res));
                    assert(std.fs.path.isAbsoluteWindows(res));
                    return res;
                }
            }
            assert(!bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, maybe_posix_path));
        }
        return maybe_posix_path;
    }

    fn resolveWithExternalBufZ(
        buf: *Buf,
        source_dir: []const u8,
        maybe_posix_path: [:0]const u8,
    ) [:0]const u8 {
        assert(std.fs.path.isAbsoluteWindows(maybe_posix_path));
        if (bun.Environment.isWindows) {
            const root = windowsFilesystemRoot(maybe_posix_path);
            if (root.len == 1) {
                assert(isSepAny(root[0]));
                if (bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, maybe_posix_path)) {
                    const source_root = windowsFilesystemRoot(source_dir);
                    @memcpy(buf[0..source_root.len], source_root);
                    @memcpy(buf[source_root.len..][0 .. maybe_posix_path.len - 1], maybe_posix_path[1..]);
                    buf[source_root.len + maybe_posix_path.len - 1] = 0;
                    const res = buf[0 .. source_root.len + maybe_posix_path.len - 1 :0];
                    assert(!bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, res));
                    assert(std.fs.path.isAbsoluteWindows(res));
                    return res;
                }
            }
            assert(!bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, maybe_posix_path));
        }
        return maybe_posix_path;
    }

    pub fn resolveCWDWithExternalBuf(
        buf: *Buf,
        maybe_posix_path: []const u8,
    ) ![]const u8 {
        assert(std.fs.path.isAbsoluteWindows(maybe_posix_path));

        if (bun.Environment.isWindows) {
            const root = windowsFilesystemRoot(maybe_posix_path);
            if (root.len == 1) {
                assert(isSepAny(root[0]));
                if (bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, maybe_posix_path)) {
                    const cwd = try std.posix.getcwd(buf);
                    assert(cwd.ptr == buf.ptr);
                    const source_root = windowsFilesystemRoot(cwd);
                    assert(source_root.ptr == source_root.ptr);
                    @memcpy(buf[source_root.len..][0 .. maybe_posix_path.len - 1], maybe_posix_path[1..]);
                    const res = buf[0 .. source_root.len + maybe_posix_path.len - 1];
                    assert(!bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, res));
                    assert(std.fs.path.isAbsoluteWindows(res));
                    return res;
                }
            }
            assert(!bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, maybe_posix_path));
        }

        return maybe_posix_path;
    }

    pub fn resolveCWDWithExternalBufZ(
        buf: *bun.PathBuffer,
        maybe_posix_path: []const u8,
    ) ![:0]u8 {
        assert(std.fs.path.isAbsoluteWindows(maybe_posix_path));

        if (bun.Environment.isWindows) {
            const root = windowsFilesystemRoot(maybe_posix_path);
            if (root.len == 1) {
                assert(isSepAny(root[0]));
                if (bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, maybe_posix_path)) {
                    const cwd = try std.posix.getcwd(buf);
                    assert(cwd.ptr == buf.ptr);
                    const source_root = windowsFilesystemRoot(cwd);
                    assert(source_root.ptr == source_root.ptr);
                    @memcpy(buf[source_root.len..][0 .. maybe_posix_path.len - 1], maybe_posix_path[1..]);
                    buf[source_root.len + maybe_posix_path.len - 1] = 0;
                    const res = buf[0 .. source_root.len + maybe_posix_path.len - 1 :0];
                    assert(!bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, res));
                    assert(std.fs.path.isAbsoluteWindows(res));
                    return res;
                }
            }

            assert(!bun.strings.isWindowsAbsolutePathMissingDriveLetter(u8, maybe_posix_path));
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
        globalObject.bunVM().transpiler.fs.top_level_dir,
        &join_buf,
        &.{str.slice()},
        comptime Platform.auto.resolve(),
    );

    return bun.String.createUTF8(out_slice);
}

pub fn platformToPosixInPlace(comptime T: type, path_buffer: []T) void {
    if (std.fs.path.sep == '/') return;
    var idx: usize = 0;
    while (std.mem.indexOfScalarPos(T, path_buffer, idx, std.fs.path.sep)) |index| : (idx = index + 1) {
        path_buffer[index] = '/';
    }
}

pub fn dangerouslyConvertPathToPosixInPlace(comptime T: type, path: []T) void {
    var idx: usize = 0;
    if (comptime bun.Environment.isWindows) {
        if (path.len > "C:".len and isDriveLetter(path[0]) and path[1] == ':' and isSepAny(path[2])) {
            // Uppercase drive letter
            switch (path[0]) {
                'a'...'z' => path[0] = 'A' + (path[0] - 'a'),
                'A'...'Z' => {},
                else => unreachable,
            }
        }
    }

    while (std.mem.indexOfScalarPos(T, path, idx, std.fs.path.sep_windows)) |index| : (idx = index + 1) {
        path[index] = '/';
    }
}

pub fn dangerouslyConvertPathToWindowsInPlace(comptime T: type, path: []T) void {
    var idx: usize = 0;
    while (std.mem.indexOfScalarPos(T, path, idx, std.fs.path.sep_posix)) |index| : (idx = index + 1) {
        path[index] = '\\';
    }
}

pub fn pathToPosixBuf(comptime T: type, path: []const T, buf: []T) []T {
    var idx: usize = 0;
    while (std.mem.indexOfScalarPos(T, path, idx, std.fs.path.sep_windows)) |index| : (idx = index + 1) {
        @memcpy(buf[idx..index], path[idx..index]);
        buf[index] = std.fs.path.sep_posix;
    }
    @memcpy(buf[idx..path.len], path[idx..path.len]);
    return buf[0..path.len];
}

pub fn platformToPosixBuf(comptime T: type, path: []const T, buf: []T) []const T {
    if (std.fs.path.sep == '/') return path;
    var idx: usize = 0;
    while (std.mem.indexOfScalarPos(T, path, idx, std.fs.path.sep)) |index| : (idx = index + 1) {
        @memcpy(buf[idx..index], path[idx..index]);
        buf[index] = '/';
    }
    @memcpy(buf[idx..path.len], path[idx..path.len]);
    return buf[0..path.len];
}

pub fn posixToPlatformInPlace(comptime T: type, path_buffer: []T) void {
    if (std.fs.path.sep == '/') return;
    var idx: usize = 0;
    while (std.mem.indexOfScalarPos(T, path_buffer, idx, '/')) |index| : (idx = index + 1) {
        path_buffer[index] = std.fs.path.sep;
    }
}

const assert = bun.assert;
