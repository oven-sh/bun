/// Checks if a path is missing a windows drive letter. For windows APIs,
/// this is used for an assertion, and PosixToWinNormalizer can help make
/// an absolute path contain a drive letter.
pub fn isWindowsAbsolutePathMissingDriveLetter(comptime T: type, chars: []const T) bool {
    bun.unsafeAssert(bun.path.Platform.windows.isAbsoluteT(T, chars));
    bun.unsafeAssert(chars.len > 0);

    // 'C:\hello' -> false
    // This is the most common situation, so we check it first
    if (!(chars[0] == '/' or chars[0] == '\\')) {
        bun.unsafeAssert(chars.len > 2);
        bun.unsafeAssert(chars[1] == ':');
        return false;
    }

    if (chars.len > 4) {
        // '\??\hello' -> false (has the NT object prefix)
        if (chars[1] == '?' and
            chars[2] == '?' and
            (chars[3] == '/' or chars[3] == '\\'))
            return false;
        // '\\?\hello' -> false (has the other NT object prefix)
        // '\\.\hello' -> false (has the NT device prefix)
        if ((chars[1] == '/' or chars[1] == '\\') and
            (chars[2] == '?' or chars[2] == '.') and
            (chars[3] == '/' or chars[3] == '\\'))
            return false;
    }

    // A path starting with `/` can be a UNC path with forward slashes,
    // or actually just a posix path.
    //
    // '\\Server\Share' -> false (unc)
    // '\\Server\\Share' -> true (not unc because extra slashes)
    // '\Server\Share' -> true (posix path)
    return bun.path.windowsFilesystemRootT(T, chars).len == 1;
}

pub fn fromWPath(buf: []u8, utf16: []const u16) [:0]const u8 {
    bun.unsafeAssert(buf.len > 0);
    const to_copy = trimPrefixComptime(u16, utf16, bun.windows.long_path_prefix);
    const encode_into_result = copyUTF16IntoUTF8(buf[0 .. buf.len - 1], []const u16, to_copy, false);
    bun.unsafeAssert(encode_into_result.written < buf.len);
    buf[encode_into_result.written] = 0;
    return buf[0..encode_into_result.written :0];
}

pub fn withoutNTPrefix(comptime T: type, path: []const T) []const T {
    if (comptime !Environment.isWindows) return path;
    const cmp = if (T == u8)
        hasPrefixComptime
    else
        hasPrefixComptimeUTF16;
    if (cmp(path, &bun.windows.nt_object_prefix_u8)) {
        return path[bun.windows.nt_object_prefix.len..];
    }
    if (cmp(path, &bun.windows.long_path_prefix_u8)) {
        return path[bun.windows.long_path_prefix.len..];
    }
    if (cmp(path, &bun.windows.nt_unc_object_prefix_u8)) {
        return path[bun.windows.nt_unc_object_prefix.len..];
    }
    return path;
}

pub fn toNTPath(wbuf: []u16, utf8: []const u8) [:0]u16 {
    if (!std.fs.path.isAbsoluteWindows(utf8)) {
        return toWPathNormalized(wbuf, utf8);
    }

    if (strings.hasPrefixComptime(utf8, &bun.windows.nt_object_prefix_u8) or
        strings.hasPrefixComptime(utf8, &bun.windows.nt_unc_object_prefix_u8))
    {
        return wbuf[0..toWPathNormalized(wbuf, utf8).len :0];
    }

    // UNC absolute path, replace leading '\\' with '\??\UNC\'
    if (strings.hasPrefixComptime(utf8, "\\\\")) {
        if (strings.hasPrefixComptime(utf8[2..], bun.windows.long_path_prefix_u8[2..])) {
            const prefix = bun.windows.nt_object_prefix;
            wbuf[0..prefix.len].* = prefix;
            return wbuf[0 .. toWPathNormalized(wbuf[prefix.len..], utf8[4..]).len + prefix.len :0];
        }
        const prefix = bun.windows.nt_unc_object_prefix;
        wbuf[0..prefix.len].* = prefix;
        return wbuf[0 .. toWPathNormalized(wbuf[prefix.len..], utf8[2..]).len + prefix.len :0];
    }

    const prefix = bun.windows.nt_object_prefix;
    wbuf[0..prefix.len].* = prefix;
    return wbuf[0 .. toWPathNormalized(wbuf[prefix.len..], utf8).len + prefix.len :0];
}

pub fn toNTPath16(wbuf: []u16, path: []const u16) [:0]u16 {
    if (!std.fs.path.isAbsoluteWindowsWTF16(path)) {
        return toWPathNormalized16(wbuf, path);
    }

    if (strings.hasPrefixComptimeUTF16(path, &bun.windows.nt_object_prefix_u8) or
        strings.hasPrefixComptimeUTF16(path, &bun.windows.nt_unc_object_prefix_u8))
    {
        return wbuf[0..toWPathNormalized16(wbuf, path).len :0];
    }

    if (strings.hasPrefixComptimeUTF16(path, "\\\\")) {
        if (strings.hasPrefixComptimeUTF16(path[2..], bun.windows.long_path_prefix_u8[2..])) {
            const prefix = bun.windows.nt_object_prefix;
            wbuf[0..prefix.len].* = prefix;
            return wbuf[0 .. toWPathNormalized16(wbuf[prefix.len..], path[4..]).len + prefix.len :0];
        }
        const prefix = bun.windows.nt_unc_object_prefix;
        wbuf[0..prefix.len].* = prefix;
        return wbuf[0 .. toWPathNormalized16(wbuf[prefix.len..], path[2..]).len + prefix.len :0];
    }

    const prefix = bun.windows.nt_object_prefix;
    wbuf[0..prefix.len].* = prefix;
    return wbuf[0 .. toWPathNormalized16(wbuf[prefix.len..], path).len + prefix.len :0];
}

pub fn toNTMaxPath(buf: []u8, utf8: []const u8) [:0]const u8 {
    if (!std.fs.path.isAbsoluteWindows(utf8) or utf8.len <= 260) {
        @memcpy(buf[0..utf8.len], utf8);
        buf[utf8.len] = 0;
        return buf[0..utf8.len :0];
    }

    const prefix = bun.windows.nt_maxpath_prefix_u8;
    buf[0..prefix.len].* = prefix;
    return buf[0 .. toPathNormalized(buf[prefix.len..], utf8).len + prefix.len :0];
}

pub fn addNTPathPrefix(wbuf: []u16, utf16: []const u16) [:0]u16 {
    wbuf[0..bun.windows.nt_object_prefix.len].* = bun.windows.nt_object_prefix;
    @memcpy(wbuf[bun.windows.nt_object_prefix.len..][0..utf16.len], utf16);
    wbuf[utf16.len + bun.windows.nt_object_prefix.len] = 0;
    return wbuf[0 .. utf16.len + bun.windows.nt_object_prefix.len :0];
}

pub fn addNTPathPrefixIfNeeded(wbuf: []u16, utf16: []const u16) [:0]u16 {
    if (hasPrefixComptimeType(u16, utf16, bun.windows.nt_object_prefix)) {
        @memcpy(wbuf[0..utf16.len], utf16);
        wbuf[utf16.len] = 0;
        return wbuf[0..utf16.len :0];
    }
    if (hasPrefixComptimeType(u16, utf16, bun.windows.long_path_prefix)) {
        // Replace prefix
        return addNTPathPrefix(wbuf, utf16[bun.windows.long_path_prefix.len..]);
    }
    return addNTPathPrefix(wbuf, utf16);
}

// These are the same because they don't have rules like needing a trailing slash
pub const toNTDir = toNTPath;

pub fn toExtendedPathNormalized(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    bun.unsafeAssert(wbuf.len > 4);
    wbuf[0..4].* = bun.windows.long_path_prefix;
    return wbuf[0 .. toWPathNormalized(wbuf[4..], utf8).len + 4 :0];
}

pub fn toWPathNormalizeAutoExtend(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    if (std.fs.path.isAbsoluteWindows(utf8)) {
        return toExtendedPathNormalized(wbuf, utf8);
    }

    return toWPathNormalized(wbuf, utf8);
}

pub fn toWPathNormalized(wbuf: []u16, utf8: []const u8) [:0]u16 {
    const renormalized = bun.PathBufferPool.get();
    defer bun.PathBufferPool.put(renormalized);

    var path_to_use = normalizeSlashesOnly(renormalized, utf8, '\\');

    // is there a trailing slash? Let's remove it before converting to UTF-16
    if (path_to_use.len > 3 and bun.path.isSepAny(path_to_use[path_to_use.len - 1])) {
        path_to_use = path_to_use[0 .. path_to_use.len - 1];
    }

    return toWPath(wbuf, path_to_use);
}

pub fn toWPathNormalized16(wbuf: []u16, path: []const u16) [:0]u16 {
    var path_to_use = normalizeSlashesOnlyT(u16, wbuf, path, '\\', true);

    // is there a trailing slash? Let's remove it before converting to UTF-16
    if (path_to_use.len > 3 and bun.path.isSepAnyT(u16, path_to_use[path_to_use.len - 1])) {
        path_to_use = path_to_use[0 .. path_to_use.len - 1];
    }

    wbuf[path_to_use.len] = 0;

    return wbuf[0..path_to_use.len :0];
}

pub fn toPathNormalized(buf: []u8, utf8: []const u8) [:0]const u8 {
    const renormalized = bun.PathBufferPool.get();
    defer bun.PathBufferPool.put(renormalized);

    var path_to_use = normalizeSlashesOnly(renormalized, utf8, '\\');

    // is there a trailing slash? Let's remove it before converting to UTF-16
    if (path_to_use.len > 3 and bun.path.isSepAny(path_to_use[path_to_use.len - 1])) {
        path_to_use = path_to_use[0 .. path_to_use.len - 1];
    }

    return toPath(buf, path_to_use);
}

pub fn normalizeSlashesOnlyT(comptime T: type, buf: []T, path: []const T, comptime desired_slash: u8, comptime always_copy: bool) []const T {
    comptime bun.unsafeAssert(desired_slash == '/' or desired_slash == '\\');
    const undesired_slash = if (desired_slash == '/') '\\' else '/';

    if (bun.strings.containsCharT(T, path, undesired_slash)) {
        @memcpy(buf[0..path.len], path);
        for (buf[0..path.len]) |*c| {
            if (c.* == undesired_slash) {
                c.* = desired_slash;
            }
        }
        return buf[0..path.len];
    }

    if (comptime always_copy) {
        @memcpy(buf[0..path.len], path);
        return buf[0..path.len];
    }
    return path;
}

pub fn normalizeSlashesOnly(buf: []u8, utf8: []const u8, comptime desired_slash: u8) []const u8 {
    return normalizeSlashesOnlyT(u8, buf, utf8, desired_slash, false);
}

pub fn toWDirNormalized(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    var renormalized: ?*bun.PathBuffer = null;
    defer if (renormalized) |r| bun.PathBufferPool.put(r);

    var path_to_use = utf8;

    if (bun.strings.containsChar(utf8, '/')) {
        renormalized = bun.PathBufferPool.get();
        @memcpy(renormalized.?[0..utf8.len], utf8);
        for (renormalized.?[0..utf8.len]) |*c| {
            if (c.* == '/') {
                c.* = '\\';
            }
        }
        path_to_use = renormalized.?[0..utf8.len];
    }

    return toWDirPath(wbuf, path_to_use);
}

pub fn toWPath(wbuf: []u16, utf8: []const u8) [:0]u16 {
    return toWPathMaybeDir(wbuf, utf8, false);
}

pub fn toPath(buf: []u8, utf8: []const u8) [:0]u8 {
    return toPathMaybeDir(buf, utf8, false);
}

pub fn toWDirPath(wbuf: []u16, utf8: []const u8) [:0]const u16 {
    return toWPathMaybeDir(wbuf, utf8, true);
}

pub fn toKernel32Path(wbuf: []u16, utf8: []const u8) [:0]u16 {
    const path = if (hasPrefixComptime(utf8, bun.windows.nt_object_prefix_u8))
        utf8[bun.windows.nt_object_prefix_u8.len..]
    else
        utf8;
    if (hasPrefixComptime(path, bun.windows.long_path_prefix_u8)) {
        return toWPath(wbuf, path);
    }
    if (utf8.len > 2 and bun.path.isDriveLetter(utf8[0]) and utf8[1] == ':' and bun.path.isSepAny(utf8[2])) {
        wbuf[0..4].* = bun.windows.long_path_prefix;
        const wpath = toWPath(wbuf[4..], path);
        return wbuf[0 .. wpath.len + 4 :0];
    }
    return toWPath(wbuf, path);
}

fn isUNCPath(comptime T: type, path: []const T) bool {
    return path.len >= 3 and
        bun.path.Platform.windows.isSeparatorT(T, path[0]) and
        bun.path.Platform.windows.isSeparatorT(T, path[1]) and
        !bun.path.Platform.windows.isSeparatorT(T, path[2]) and
        path[2] != '.';
}
pub fn assertIsValidWindowsPath(comptime T: type, path: []const T) void {
    if (Environment.allow_assert and Environment.isWindows) {
        if (bun.path.Platform.windows.isAbsoluteT(T, path) and
            isWindowsAbsolutePathMissingDriveLetter(T, path) and
            // is it a null device path? that's not an error. it's just a weird file path.
            !eqlComptimeT(T, path, "\\\\.\\NUL") and !eqlComptimeT(T, path, "\\\\.\\nul") and !eqlComptimeT(T, path, "\\nul") and !eqlComptimeT(T, path, "\\NUL") and !isUNCPath(T, path))
        {
            std.debug.panic("Internal Error: Do not pass posix paths to Windows APIs, was given '{s}'" ++ if (Environment.isDebug) " (missing a root like 'C:\\', see PosixToWinNormalizer for why this is an assertion)" else ". Please open an issue on GitHub with a reproduction.", .{
                if (T == u8) path else bun.fmt.utf16(path),
            });
        }
        if (hasPrefixComptimeType(T, path, ":/") and Environment.isDebug) {
            std.debug.panic("Path passed to windows API '{s}' is almost certainly invalid. Where did the drive letter go?", .{
                if (T == u8) path else bun.fmt.utf16(path),
            });
        }
    }
}

pub fn toWPathMaybeDir(wbuf: []u16, utf8: []const u8, comptime add_trailing_lash: bool) [:0]u16 {
    bun.unsafeAssert(wbuf.len > 0);

    var result = bun.simdutf.convert.utf8.to.utf16.with_errors.le(
        utf8,
        wbuf[0..wbuf.len -| (1 + @as(usize, @intFromBool(add_trailing_lash)))],
    );

    // Many Windows APIs expect normalized path slashes, particularly when the
    // long path prefix is added or the nt object prefix. To make this easier,
    // but a little redundant, this function always normalizes the slashes here.
    //
    // An example of this is GetFileAttributesW(L"C:\\hello/world.txt") being OK
    // but GetFileAttributesW(L"\\\\?\\C:\\hello/world.txt") is NOT
    bun.path.dangerouslyConvertPathToWindowsInPlace(u16, wbuf[0..result.count]);

    if (add_trailing_lash and result.count > 0 and wbuf[result.count - 1] != '\\') {
        wbuf[result.count] = '\\';
        result.count += 1;
    }

    wbuf[result.count] = 0;

    return wbuf[0..result.count :0];
}
pub fn toPathMaybeDir(buf: []u8, utf8: []const u8, comptime add_trailing_lash: bool) [:0]u8 {
    bun.unsafeAssert(buf.len > 0);

    var len = utf8.len;
    @memcpy(buf[0..len], utf8[0..len]);

    if (add_trailing_lash and len > 0 and buf[len - 1] != '\\') {
        buf[len] = '\\';
        len += 1;
    }
    buf[len] = 0;
    return buf[0..len :0];
}

pub fn cloneNormalizingSeparators(
    allocator: std.mem.Allocator,
    input: []const u8,
) ![]u8 {
    // remove duplicate slashes in the file path
    const base = withoutTrailingSlash(input);
    var tokenized = std.mem.tokenizeScalar(u8, base, std.fs.path.sep);
    var buf = try allocator.alloc(u8, base.len + 2);
    if (comptime Environment.allow_assert) assert(base.len > 0);
    if (base[0] == std.fs.path.sep) {
        buf[0] = std.fs.path.sep;
    }
    var remain = buf[@as(usize, @intFromBool(base[0] == std.fs.path.sep))..];

    while (tokenized.next()) |token| {
        if (token.len == 0) continue;
        bun.copy(u8, remain, token);
        remain[token.len..][0] = std.fs.path.sep;
        remain = remain[token.len + 1 ..];
    }
    if ((remain.ptr - 1) != buf.ptr and (remain.ptr - 1)[0] != std.fs.path.sep) {
        remain[0] = std.fs.path.sep;
        remain = remain[1..];
    }
    remain[0] = 0;

    return buf[0 .. @intFromPtr(remain.ptr) - @intFromPtr(buf.ptr)];
}

pub fn pathContainsNodeModulesFolder(path: []const u8) bool {
    return strings.contains(path, comptime std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str);
}

pub fn charIsAnySlash(char: u8) callconv(bun.callconv_inline) bool {
    return char == '/' or char == '\\';
}

pub fn startsWithWindowsDriveLetter(s: []const u8) callconv(bun.callconv_inline) bool {
    return startsWithWindowsDriveLetterT(u8, s);
}

pub fn startsWithWindowsDriveLetterT(comptime T: type, s: []const T) callconv(bun.callconv_inline) bool {
    return s.len > 2 and s[1] == ':' and switch (s[0]) {
        'a'...'z', 'A'...'Z' => true,
        else => false,
    };
}

pub fn withoutTrailingSlash(this: string) []const u8 {
    var href = this;
    while (href.len > 1 and (switch (href[href.len - 1]) {
        '/', '\\' => true,
        else => false,
    })) {
        href.len -= 1;
    }

    return href;
}

/// Does not strip the device root (C:\ or \\Server\Share\ portion off of the path)
pub fn withoutTrailingSlashWindowsPath(input: string) []const u8 {
    if (Environment.isPosix or input.len < 3 or input[1] != ':')
        return withoutTrailingSlash(input);

    const root_len = bun.path.windowsFilesystemRoot(input).len + 1;

    var path = input;
    while (path.len > root_len and (switch (path[path.len - 1]) {
        '/', '\\' => true,
        else => false,
    })) {
        path.len -= 1;
    }

    if (Environment.isDebug)
        bun.debugAssert(!std.fs.path.isAbsolute(path) or
            !isWindowsAbsolutePathMissingDriveLetter(u8, path));

    return path;
}

pub fn withoutLeadingSlash(this: string) []const u8 {
    return std.mem.trimLeft(u8, this, "/");
}

pub fn withoutLeadingPathSeparator(this: string) []const u8 {
    return std.mem.trimLeft(u8, this, &.{std.fs.path.sep});
}

pub fn removeLeadingDotSlash(slice: []const u8) callconv(bun.callconv_inline) []const u8 {
    if (slice.len >= 2) {
        if ((@as(u16, @bitCast(slice[0..2].*)) == comptime std.mem.readInt(u16, "./", .little)) or
            (Environment.isWindows and @as(u16, @bitCast(slice[0..2].*)) == comptime std.mem.readInt(u16, ".\\", .little)))
        {
            return slice[2..];
        }
    }
    return slice;
}

const bun = @import("bun");
const std = @import("std");
const Environment = bun.Environment;
const strings = bun.strings;
const hasPrefixComptime = strings.hasPrefixComptime;
const hasPrefixComptimeType = strings.hasPrefixComptimeType;
const trimPrefixComptime = strings.trimPrefixComptime;
const copyUTF16IntoUTF8 = strings.copyUTF16IntoUTF8;
const eqlComptimeT = strings.eqlComptimeT;
const string = []const u8;
const assert = bun.assert;
const hasPrefixComptimeUTF16 = strings.hasPrefixComptimeUTF16;
