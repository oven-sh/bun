const Path = @This();

// Allow on the stack:
// - 8 string slices
// - 3 path buffers
// - extra padding
const stack_fallback_size_large = 8 * @sizeOf([]const u8) + ((stack_fallback_size_small * 3) + 64);

const PATH_MIN_WIDE = 4096; // 4 KB
const stack_fallback_size_small = switch (Environment.os) {
    // Up to 4 KB, instead of MAX_PATH_BYTES which is 96 KB on Windows, ouch!
    .windows => PATH_MIN_WIDE,
    else => bun.MAX_PATH_BYTES,
};

/// Taken from Zig 0.11.0 zig/src/resinator/rc.zig
/// https://github.com/ziglang/zig/blob/776cd673f206099012d789fd5d05d49dd72b9faa/src/resinator/rc.zig#L266
///
/// Compares ASCII values case-insensitively, non-ASCII values are compared directly
fn eqlIgnoreCaseT(comptime T: type, a: []const T, b: []const T) bool {
    if (T != u16) {
        return bun.strings.eqlCaseInsensitiveASCII(a, b, true);
    }
}

/// Taken from Zig 0.11.0 zig/src/resinator/rc.zig
/// https://github.com/ziglang/zig/blob/776cd673f206099012d789fd5d05d49dd72b9faa/src/resinator/rc.zig#L266
///
/// Lowers ASCII values, non-ASCII values are returned directly
inline fn toLowerT(comptime T: type, a_c: T) T {
    if (T != u16) {
        return std.ascii.toLower(a_c);
    }
    return if (a_c < 128) @intCast(std.ascii.toLower(@intCast(a_c))) else a_c;
}

fn MaybeBuf(comptime T: type) type {
    return jsc.Node.Maybe([]T, Syscall.Error);
}

fn MaybeSlice(comptime T: type) type {
    return jsc.Node.Maybe([:0]const T, Syscall.Error);
}

fn validatePathT(comptime T: type, comptime methodName: []const u8) void {
    comptime switch (T) {
        u8, u16 => return,
        else => @compileError("Unsupported type for " ++ methodName ++ ": " ++ typeBaseNameT(T)),
    };
}

const CHAR_BACKWARD_SLASH = '\\';
const CHAR_COLON = ':';
const CHAR_DOT = '.';
const CHAR_FORWARD_SLASH = '/';
const CHAR_QUESTION_MARK = '?';

const CHAR_STR_BACKWARD_SLASH = "\\";
const CHAR_STR_FORWARD_SLASH = "/";
const CHAR_STR_DOT = ".";

/// Based on Node v21.6.1 path.parse:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L919
/// The structs returned by parse methods.
fn PathParsed(comptime T: type) type {
    return struct {
        root: []const T = "",
        dir: []const T = "",
        base: []const T = "",
        ext: []const T = "",
        name: []const T = "",

        pub fn toJSObject(this: @This(), globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
            var jsObject = jsc.JSValue.createEmptyObject(globalObject, 5);
            jsObject.put(globalObject, jsc.ZigString.static("root"), try bun.String.createUTF8ForJS(globalObject, this.root));
            jsObject.put(globalObject, jsc.ZigString.static("dir"), try bun.String.createUTF8ForJS(globalObject, this.dir));
            jsObject.put(globalObject, jsc.ZigString.static("base"), try bun.String.createUTF8ForJS(globalObject, this.base));
            jsObject.put(globalObject, jsc.ZigString.static("ext"), try bun.String.createUTF8ForJS(globalObject, this.ext));
            jsObject.put(globalObject, jsc.ZigString.static("name"), try bun.String.createUTF8ForJS(globalObject, this.name));
            return jsObject;
        }
    };
}

pub fn MAX_PATH_SIZE(comptime T: type) usize {
    return if (T == u16) windows.PATH_MAX_WIDE else bun.MAX_PATH_BYTES;
}

pub fn PATH_SIZE(comptime T: type) usize {
    return if (T == u16) PATH_MIN_WIDE else bun.MAX_PATH_BYTES;
}

pub const sep_posix = CHAR_FORWARD_SLASH;
pub const sep_windows = CHAR_BACKWARD_SLASH;
pub const sep_str_posix = CHAR_STR_FORWARD_SLASH;
pub const sep_str_windows = CHAR_STR_BACKWARD_SLASH;

/// Based on Node v21.6.1 private helper formatExt:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L130C10-L130C19
inline fn formatExtT(comptime T: type, ext: []const T, buf: []T) []const T {
    const len = ext.len;
    if (len == 0) {
        return &.{};
    }
    if (ext[0] == CHAR_DOT) {
        return ext;
    }
    const bufSize = len + 1;
    buf[0] = CHAR_DOT;
    bun.memmove(buf[1..bufSize], ext);
    return buf[0..bufSize];
}

/// Based on Node v21.6.1 private helper posixCwd:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1074
inline fn posixCwdT(comptime T: type, buf: []T) MaybeBuf(T) {
    const cwd = switch (getCwdT(T, buf)) {
        .result => |r| r,
        .err => |e| return MaybeBuf(T){ .err = e },
    };
    const len = cwd.len;
    if (len == 0) {
        return MaybeBuf(T){ .result = cwd };
    }
    if (comptime Environment.isWindows) {
        // Converts Windows' backslash path separators to POSIX forward slashes
        // and truncates any drive indicator

        // Translated from the following JS code:
        //   const cwd = StringPrototypeReplace(process.cwd(), regexp, '/');
        for (0..len) |i| {
            if (cwd[i] == CHAR_BACKWARD_SLASH) {
                buf[i] = CHAR_FORWARD_SLASH;
            } else {
                buf[i] = cwd[i];
            }
        }
        var normalizedCwd = buf[0..len];

        // Translated from the following JS code:
        //   return StringPrototypeSlice(cwd, StringPrototypeIndexOf(cwd, '/'));
        const index = std.mem.indexOfScalar(T, normalizedCwd, CHAR_FORWARD_SLASH);
        // Account for the -1 case of String#slice in JS land
        if (index) |_index| {
            return MaybeBuf(T){ .result = normalizedCwd[_index..len] };
        }
        return MaybeBuf(T){ .result = normalizedCwd[len - 1 .. len] };
    }

    // We're already on POSIX, no need for any transformations
    return MaybeBuf(T){ .result = cwd };
}

const withoutTrailingSlash = if (Environment.isWindows) strings.withoutTrailingSlashWindowsPath else strings.withoutTrailingSlash;

pub fn getCwdWindowsU16(buf: []u16) MaybeBuf(u16) {
    const len: u32 = strings.convertUTF8toUTF16InBuffer(&buf, withoutTrailingSlash(bun.fs.FileSystem.instance.top_level_dir));
    if (len == 0) {
        // Indirectly calls std.os.windows.kernel32.GetLastError().
        return MaybeBuf(u16).errnoSys(0, Syscall.Tag.getcwd).?;
    }
    return MaybeBuf(u16){ .result = buf[0..len] };
}

pub fn getCwdU8(buf: []u8) MaybeBuf(u8) {
    const cached_cwd = withoutTrailingSlash(bun.fs.FileSystem.instance.top_level_dir);
    @memcpy(buf[0..cached_cwd.len], cached_cwd);
    return MaybeBuf(u8){ .result = buf[0..cached_cwd.len] };
}

pub fn getCwdU16(buf: []u16) MaybeBuf(u16) {
    const result = strings.convertUTF8toUTF16InBuffer(&buf, withoutTrailingSlash(bun.fs.FileSystem.instance.top_level_dir));
    return MaybeBuf(u16){ .result = result };
}

pub fn getCwdT(comptime T: type, buf: []T) MaybeBuf(T) {
    comptime validatePathT(T, "getCwdT");
    return if (T == u16)
        getCwdU16(buf)
    else
        getCwdU8(buf);
}

// Alias for naming consistency.
pub const getCwd = getCwdU8;

/// Based on Node v21.6.1 path.posix.basename:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1309
pub fn basenamePosixT(comptime T: type, path: []const T, suffix: ?[]const T) []const T {
    comptime validatePathT(T, "basenamePosixT");

    // validateString of `path` is performed in pub fn basename.
    const len = path.len;
    // Exit early for easier number type use.
    if (len == 0) {
        return &.{};
    }
    var start: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var end: ?usize = null;
    var matchedSlash: bool = true;

    const _suffix = if (suffix) |_s| _s else &.{};
    const _suffixLen = _suffix.len;
    if (suffix != null and _suffixLen > 0 and _suffixLen <= len) {
        if (std.mem.eql(T, _suffix, path)) {
            return &.{};
        }
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var extIdx: ?usize = _suffixLen - 1;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var firstNonSlashEnd: ?usize = null;
        var i_i64 = @as(i64, @intCast(len - 1));
        while (i_i64 >= start) : (i_i64 -= 1) {
            const i = @as(usize, @intCast(i_i64));
            const byte = path[i];
            if (byte == CHAR_FORWARD_SLASH) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else {
                if (firstNonSlashEnd == null) {
                    // We saw the first non-path separator, remember this index in case
                    // we need it if the extension ends up not matching
                    matchedSlash = false;
                    firstNonSlashEnd = i + 1;
                }
                if (extIdx) |_extIx| {
                    // Try to match the explicit extension
                    if (byte == _suffix[_extIx]) {
                        if (_extIx == 0) {
                            // We matched the extension, so mark this as the end of our path
                            // component
                            end = i;
                            extIdx = null;
                        } else {
                            extIdx = _extIx - 1;
                        }
                    } else {
                        // Extension does not match, so our result is the entire path
                        // component
                        extIdx = null;
                        end = firstNonSlashEnd;
                    }
                }
            }
        }

        if (end) |_end| {
            if (start == _end) {
                return path[start..firstNonSlashEnd.?];
            } else {
                return path[start.._end];
            }
        }
        return path[start..len];
    }

    var i_i64 = @as(i64, @intCast(len - 1));
    while (i_i64 > -1) : (i_i64 -= 1) {
        const i = @as(usize, @intCast(i_i64));
        const byte = path[i];
        if (byte == CHAR_FORWARD_SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
                start = i + 1;
                break;
            }
        } else if (end == null) {
            // We saw the first non-path separator, mark this as the end of our
            // path component
            matchedSlash = false;
            end = i + 1;
        }
    }

    return if (end) |_end|
        path[start.._end]
    else
        &.{};
}

/// Based on Node v21.6.1 path.win32.basename:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L753
pub fn basenameWindowsT(comptime T: type, path: []const T, suffix: ?[]const T) []const T {
    comptime validatePathT(T, "basenameWindowsT");

    // validateString of `path` is performed in pub fn basename.
    const len = path.len;
    // Exit early for easier number type use.
    if (len == 0) {
        return &.{};
    }

    const isSepT = isSepWindowsT;

    var start: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var end: ?usize = null;
    var matchedSlash: bool = true;

    // Check for a drive letter prefix so as not to mistake the following
    // path separator as an extra separator at the end of the path that can be
    // disregarded
    if (len >= 2 and isWindowsDeviceRootT(T, path[0]) and path[1] == CHAR_COLON) {
        start = 2;
    }

    const _suffix = if (suffix) |_s| _s else &.{};
    const _suffixLen = _suffix.len;
    if (suffix != null and _suffixLen > 0 and _suffixLen <= len) {
        if (std.mem.eql(T, _suffix, path)) {
            return &.{};
        }
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var extIdx: ?usize = _suffixLen - 1;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var firstNonSlashEnd: ?usize = null;
        var i_i64 = @as(i64, @intCast(len - 1));
        while (i_i64 >= start) : (i_i64 -= 1) {
            const i = @as(usize, @intCast(i_i64));
            const byte = path[i];
            if (isSepT(T, byte)) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else {
                if (firstNonSlashEnd == null) {
                    // We saw the first non-path separator, remember this index in case
                    // we need it if the extension ends up not matching
                    matchedSlash = false;
                    firstNonSlashEnd = i + 1;
                }
                if (extIdx) |_extIx| {
                    // Try to match the explicit extension
                    if (byte == _suffix[_extIx]) {
                        if (_extIx == 0) {
                            // We matched the extension, so mark this as the end of our path
                            // component
                            end = i;
                            extIdx = null;
                        } else {
                            extIdx = _extIx - 1;
                        }
                    } else {
                        // Extension does not match, so our result is the entire path
                        // component
                        extIdx = null;
                        end = firstNonSlashEnd;
                    }
                }
            }
        }

        if (end) |_end| {
            if (start == _end) {
                return path[start..firstNonSlashEnd.?];
            } else {
                return path[start.._end];
            }
        }
        return path[start..len];
    }

    var i_i64 = @as(i64, @intCast(len - 1));
    while (i_i64 >= start) : (i_i64 -= 1) {
        const i = @as(usize, @intCast(i_i64));
        const byte = path[i];
        if (isSepT(T, byte)) {
            if (!matchedSlash) {
                start = i + 1;
                break;
            }
        } else if (end == null) {
            matchedSlash = false;
            end = i + 1;
        }
    }

    return if (end) |_end|
        path[start.._end]
    else
        &.{};
}

pub fn basenamePosixJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T, suffix: ?[]const T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, basenamePosixT(T, path, suffix));
}

pub fn basenameWindowsJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T, suffix: ?[]const T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, basenameWindowsT(T, path, suffix));
}

pub fn basenameJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, isWindows: bool, path: []const T, suffix: ?[]const T) bun.JSError!jsc.JSValue {
    return if (isWindows)
        basenameWindowsJS_T(T, globalObject, path, suffix)
    else
        basenamePosixJS_T(T, globalObject, path, suffix);
}

pub fn basename(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    const suffix_ptr: ?jsc.JSValue = if (args_len > 1 and !args_ptr[1].isUndefined()) args_ptr[1] else null;

    if (suffix_ptr) |_suffix_ptr| {
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        try validateString(globalObject, _suffix_ptr, "ext", .{});
    }

    const path_ptr: jsc.JSValue = if (args_len > 0) args_ptr[0] else .js_undefined;
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    try validateString(globalObject, path_ptr, "path", .{});

    const pathZStr = try path_ptr.getZigString(globalObject);
    if (pathZStr.len == 0) return path_ptr;

    var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, bun.default_allocator);
    const allocator = stack_fallback.get();

    const pathZSlice = pathZStr.toSlice(allocator);
    defer pathZSlice.deinit();

    var suffixZSlice: ?jsc.ZigString.Slice = null;
    if (suffix_ptr) |_suffix_ptr| {
        const suffixZStr = try _suffix_ptr.getZigString(globalObject);
        if (suffixZStr.len > 0 and suffixZStr.len <= pathZStr.len) {
            suffixZSlice = suffixZStr.toSlice(allocator);
        }
    }
    defer if (suffixZSlice) |_s| _s.deinit();
    return basenameJS_T(u8, globalObject, isWindows, pathZSlice.slice(), if (suffixZSlice) |_s| _s.slice() else null);
}

/// Based on Node v21.6.1 path.posix.dirname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1278
pub fn dirnamePosixT(comptime T: type, path: []const T) []const T {
    comptime validatePathT(T, "dirnamePosixT");

    // validateString of `path` is performed in pub fn dirname.
    const len = path.len;
    if (len == 0) {
        return comptime L(T, CHAR_STR_DOT);
    }

    const hasRoot = path[0] == CHAR_FORWARD_SLASH;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var end: ?usize = null;
    var matchedSlash: bool = true;
    var i: usize = len - 1;
    while (i >= 1) : (i -= 1) {
        if (path[i] == CHAR_FORWARD_SLASH) {
            if (!matchedSlash) {
                end = i;
                break;
            }
        } else {
            // We saw the first non-path separator
            matchedSlash = false;
        }
    }

    if (end) |_end| {
        return if (hasRoot and _end == 1)
            comptime L(T, "//")
        else
            path[0.._end];
    }
    return if (hasRoot)
        comptime L(T, CHAR_STR_FORWARD_SLASH)
    else
        comptime L(T, CHAR_STR_DOT);
}

/// Based on Node v21.6.1 path.win32.dirname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L657
pub fn dirnameWindowsT(comptime T: type, path: []const T) []const T {
    comptime validatePathT(T, "dirnameWindowsT");

    // validateString of `path` is performed in pub fn dirname.
    const len = path.len;
    if (len == 0) {
        return comptime L(T, CHAR_STR_DOT);
    }

    const isSepT = isSepWindowsT;

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var rootEnd: ?usize = null;
    var offset: usize = 0;
    const byte0 = path[0];

    if (len == 1) {
        // `path` contains just a path separator, exit early to avoid
        // unnecessary work or a dot.
        return if (isSepT(T, byte0)) path else comptime L(T, CHAR_STR_DOT);
    }

    // Try to match a root
    if (isSepT(T, byte0)) {
        // Possible UNC root

        rootEnd = 1;
        offset = 1;

        if (isSepT(T, path[1])) {
            // Matched double path separator at the beginning
            var j: usize = 2;
            var last: usize = j;

            // Match 1 or more non-path separators
            while (j < len and !isSepT(T, path[j])) {
                j += 1;
            }

            if (j < len and j != last) {
                // Matched!
                last = j;

                // Match 1 or more path separators
                while (j < len and isSepT(T, path[j])) {
                    j += 1;
                }

                if (j < len and j != last) {
                    // Matched!
                    last = j;

                    // Match 1 or more non-path separators
                    while (j < len and !isSepT(T, path[j])) {
                        j += 1;
                    }

                    if (j == len) {
                        // We matched a UNC root only
                        return path;
                    }

                    if (j != last) {
                        // We matched a UNC root with leftovers

                        // Offset by 1 to include the separator after the UNC root to
                        // treat it as a "normal root" on top of a (UNC) root
                        offset = j + 1;
                        rootEnd = offset;
                    }
                }
            }
        }
        // Possible device root
    } else if (isWindowsDeviceRootT(T, byte0) and path[1] == CHAR_COLON) {
        offset = if (len > 2 and isSepT(T, path[2])) 3 else 2;
        rootEnd = offset;
    }

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var end: ?usize = null;
    var matchedSlash: bool = true;

    var i_i64 = @as(i64, @intCast(len - 1));
    while (i_i64 >= offset) : (i_i64 -= 1) {
        const i = @as(usize, @intCast(i_i64));
        if (isSepT(T, path[i])) {
            if (!matchedSlash) {
                end = i;
                break;
            }
        } else {
            // We saw the first non-path separator
            matchedSlash = false;
        }
    }

    if (end) |_end| {
        return path[0.._end];
    }

    return if (rootEnd) |_rootEnd|
        path[0.._rootEnd]
    else
        comptime L(T, CHAR_STR_DOT);
}

pub fn dirnamePosixJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, dirnamePosixT(T, path));
}

pub fn dirnameWindowsJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, dirnameWindowsT(T, path));
}

pub fn dirnameJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, isWindows: bool, path: []const T) bun.JSError!jsc.JSValue {
    return if (isWindows)
        dirnameWindowsJS_T(T, globalObject, path)
    else
        dirnamePosixJS_T(T, globalObject, path);
}

pub fn dirname(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    const path_ptr: jsc.JSValue = if (args_len > 0) args_ptr[0] else .js_undefined;
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    try validateString(globalObject, path_ptr, "path", .{});

    const pathZStr = try path_ptr.getZigString(globalObject);
    if (pathZStr.len == 0) return bun.String.createUTF8ForJS(globalObject, CHAR_STR_DOT);

    var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, bun.default_allocator);
    const allocator = stack_fallback.get();

    const pathZSlice = pathZStr.toSlice(allocator);
    defer pathZSlice.deinit();
    return dirnameJS_T(u8, globalObject, isWindows, pathZSlice.slice());
}

/// Based on Node v21.6.1 path.posix.extname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1278
pub fn extnamePosixT(comptime T: type, path: []const T) []const T {
    comptime validatePathT(T, "extnamePosixT");

    // validateString of `path` is performed in pub fn extname.
    const len = path.len;
    // Exit early for easier number type use.
    if (len == 0) {
        return &.{};
    }
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var startDot: ?usize = null;
    var startPart: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var end: ?usize = null;
    var matchedSlash: bool = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var preDotState: ?usize = 0;

    var i_i64 = @as(i64, @intCast(len - 1));
    while (i_i64 > -1) : (i_i64 -= 1) {
        const i = @as(usize, @intCast(i_i64));
        const byte = path[i];
        if (byte == CHAR_FORWARD_SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }

        if (end == null) {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matchedSlash = false;
            end = i + 1;
        }

        if (byte == CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if (startDot == null) {
                startDot = i;
            } else if (preDotState != null and preDotState.? != 1) {
                preDotState = 1;
            }
        } else if (startDot != null) {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            preDotState = null;
        }
    }

    const _end = if (end) |_e| _e else 0;
    const _preDotState = if (preDotState) |_p| _p else 0;
    const _startDot = if (startDot) |_s| _s else 0;
    if (startDot == null or
        end == null or
        // We saw a non-dot character immediately before the dot
        (preDotState != null and _preDotState == 0) or
        // The (right-most) trimmed path component is exactly '..'
        (_preDotState == 1 and
            _startDot == _end - 1 and
            _startDot == startPart + 1))
    {
        return &.{};
    }

    return path[_startDot.._end];
}

/// Based on Node v21.6.1 path.win32.extname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L840
pub fn extnameWindowsT(comptime T: type, path: []const T) []const T {
    comptime validatePathT(T, "extnameWindowsT");

    // validateString of `path` is performed in pub fn extname.
    const len = path.len;
    // Exit early for easier number type use.
    if (len == 0) {
        return &.{};
    }
    var start: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var startDot: ?usize = null;
    var startPart: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var end: ?usize = null;
    var matchedSlash: bool = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var preDotState: ?usize = 0;

    // Check for a drive letter prefix so as not to mistake the following
    // path separator as an extra separator at the end of the path that can be
    // disregarded

    if (len >= 2 and
        path[1] == CHAR_COLON and
        isWindowsDeviceRootT(T, path[0]))
    {
        start = 2;
        startPart = start;
    }

    var i_i64 = @as(i64, @intCast(len - 1));
    while (i_i64 >= start) : (i_i64 -= 1) {
        const i = @as(usize, @intCast(i_i64));
        const byte = path[i];
        if (isSepWindowsT(T, byte)) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end == null) {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matchedSlash = false;
            end = i + 1;
        }
        if (byte == CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if (startDot == null) {
                startDot = i;
            } else if (preDotState) |_preDotState| {
                if (_preDotState != 1) {
                    preDotState = 1;
                }
            }
        } else if (startDot != null) {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            preDotState = null;
        }
    }

    const _end = if (end) |_e| _e else 0;
    const _preDotState = if (preDotState) |_p| _p else 0;
    const _startDot = if (startDot) |_s| _s else 0;
    if (startDot == null or
        end == null or
        // We saw a non-dot character immediately before the dot
        (preDotState != null and _preDotState == 0) or
        // The (right-most) trimmed path component is exactly '..'
        (_preDotState == 1 and
            _startDot == _end - 1 and
            _startDot == startPart + 1))
    {
        return &.{};
    }

    return path[_startDot.._end];
}

pub fn extnamePosixJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, extnamePosixT(T, path));
}

pub fn extnameWindowsJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, extnameWindowsT(T, path));
}

pub fn extnameJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, isWindows: bool, path: []const T) bun.JSError!jsc.JSValue {
    return if (isWindows)
        extnameWindowsJS_T(T, globalObject, path)
    else
        extnamePosixJS_T(T, globalObject, path);
}

pub fn extname(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    const path_ptr: jsc.JSValue = if (args_len > 0) args_ptr[0] else .js_undefined;
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    try validateString(globalObject, path_ptr, "path", .{});

    const pathZStr = try path_ptr.getZigString(globalObject);
    if (pathZStr.len == 0) return path_ptr;

    var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, bun.default_allocator);
    const allocator = stack_fallback.get();

    const pathZSlice = pathZStr.toSlice(allocator);
    defer pathZSlice.deinit();
    return extnameJS_T(u8, globalObject, isWindows, pathZSlice.slice());
}

/// Based on Node v21.6.1 private helper _format:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L145
fn _formatT(comptime T: type, pathObject: PathParsed(T), sep: T, buf: []T) []const T {
    comptime validatePathT(T, "_formatT");

    // validateObject of `pathObject` is performed in pub fn format.
    const root = pathObject.root;
    const dir = pathObject.dir;
    const base = pathObject.base;
    const ext = pathObject.ext;
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    const _name = pathObject.name;

    // Translated from the following JS code:
    //   const dir = pathObject.dir || pathObject.root;
    const dirIsRoot = dir.len == 0 or std.mem.eql(u8, dir, root);
    const dirOrRoot = if (dirIsRoot) root else dir;
    const dirLen = dirOrRoot.len;

    var bufOffset: usize = 0;
    var bufSize: usize = 0;

    // Translated from the following JS code:
    //   const base = pathObject.base ||
    //     `${pathObject.name || ''}${formatExt(pathObject.ext)}`;
    var baseLen = base.len;
    var baseOrNameExt = base;
    if (baseLen > 0) {
        bun.memmove(buf[0..baseLen], base);
    } else {
        const formattedExt = formatExtT(T, ext, buf);
        const nameLen = _name.len;
        const extLen = formattedExt.len;
        bufOffset = nameLen;
        bufSize = bufOffset + extLen;
        if (extLen > 0) {
            // Move all bytes to the right by _name.len.
            // Use bun.copy because formattedExt and buf overlap.
            bun.copy(T, buf[bufOffset..bufSize], formattedExt);
        }
        if (nameLen > 0) {
            bun.memmove(buf[0..nameLen], _name);
        }
        if (bufSize > 0) {
            baseOrNameExt = buf[0..bufSize];
        }
    }

    // Translated from the following JS code:
    //   if (!dir) {
    //     return base;
    //   }
    if (dirLen == 0) {
        return baseOrNameExt;
    }

    // Translated from the following JS code:
    //   return dir === pathObject.root ? `${dir}${base}` : `${dir}${sep}${base}`;
    baseLen = baseOrNameExt.len;
    if (baseLen > 0) {
        bufOffset = if (dirIsRoot) dirLen else dirLen + 1;
        bufSize = bufOffset + baseLen;
        // Move all bytes to the right by dirLen + (maybe 1 for the separator).
        // Use bun.copy because baseOrNameExt and buf overlap.
        bun.copy(T, buf[bufOffset..bufSize], baseOrNameExt);
    }
    bun.memmove(buf[0..dirLen], dirOrRoot);
    bufSize = dirLen + baseLen;
    if (!dirIsRoot) {
        bufSize += 1;
        buf[dirLen] = sep;
    }
    return buf[0..bufSize];
}

pub fn formatPosixJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, pathObject: PathParsed(T), buf: []T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, _formatT(T, pathObject, CHAR_FORWARD_SLASH, buf));
}

pub fn formatWindowsJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, pathObject: PathParsed(T), buf: []T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, _formatT(T, pathObject, CHAR_BACKWARD_SLASH, buf));
}

pub fn formatJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, pathObject: PathParsed(T)) bun.JSError!jsc.JSValue {
    const baseLen = pathObject.base.len;
    const dirLen = pathObject.dir.len;
    // Add one for the possible separator.
    const bufLen: usize = @max(1 +
        (if (dirLen > 0) dirLen else pathObject.root.len) +
        (if (baseLen > 0) baseLen else pathObject.name.len + pathObject.ext.len), PATH_SIZE(T));
    const buf = bun.handleOom(allocator.alloc(T, bufLen));
    defer allocator.free(buf);
    return if (isWindows) formatWindowsJS_T(T, globalObject, pathObject, buf) else formatPosixJS_T(T, globalObject, pathObject, buf);
}

pub fn format(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    const pathObject_ptr: jsc.JSValue = if (args_len > 0) args_ptr[0] else .js_undefined;
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    try validateObject(globalObject, pathObject_ptr, "pathObject", .{}, .{});

    var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, bun.default_allocator);
    const allocator = stack_fallback.get();

    var root: []const u8 = "";
    var root_slice: ?jsc.ZigString.Slice = null;
    defer if (root_slice) |slice| slice.deinit();

    if (try pathObject_ptr.getTruthy(globalObject, "root")) |jsValue| {
        root_slice = try jsValue.toSlice(globalObject, allocator);
        root = root_slice.?.slice();
    }
    var dir: []const u8 = "";
    var dir_slice: ?jsc.ZigString.Slice = null;
    defer if (dir_slice) |slice| slice.deinit();

    if (try pathObject_ptr.getTruthy(globalObject, "dir")) |jsValue| {
        dir_slice = try jsValue.toSlice(globalObject, allocator);
        dir = dir_slice.?.slice();
    }
    var base: []const u8 = "";
    var base_slice: ?jsc.ZigString.Slice = null;
    defer if (base_slice) |slice| slice.deinit();

    if (try pathObject_ptr.getTruthy(globalObject, "base")) |jsValue| {
        base_slice = try jsValue.toSlice(globalObject, allocator);
        base = base_slice.?.slice();
    }
    var _name: []const u8 = "";
    var _name_slice: ?jsc.ZigString.Slice = null;
    defer if (_name_slice) |slice| slice.deinit();

    if (try pathObject_ptr.getTruthy(globalObject, "name")) |jsValue| {
        _name_slice = try jsValue.toSlice(globalObject, allocator);
        _name = _name_slice.?.slice();
    }
    var ext: []const u8 = "";
    var ext_slice: ?jsc.ZigString.Slice = null;
    defer if (ext_slice) |slice| slice.deinit();

    if (try pathObject_ptr.getTruthy(globalObject, "ext")) |jsValue| {
        ext_slice = try jsValue.toSlice(globalObject, allocator);
        ext = ext_slice.?.slice();
    }
    return formatJS_T(u8, globalObject, allocator, isWindows, .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name });
}

/// Based on Node v21.6.1 path.posix.isAbsolute:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1159
pub fn isAbsolutePosixT(comptime T: type, path: []const T) bool {
    // validateString of `path` is performed in pub fn isAbsolute.
    return path.len > 0 and path[0] == CHAR_FORWARD_SLASH;
}

/// Based on Node v21.6.1 path.win32.isAbsolute:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L406
pub fn isAbsoluteWindowsT(comptime T: type, path: []const T) bool {
    // validateString of `path` is performed in pub fn isAbsolute.
    const len = path.len;
    if (len == 0)
        return false;

    const byte0 = path[0];
    return isSepWindowsT(T, byte0) or
        // Possible device root
        (len > 2 and
            isWindowsDeviceRootT(T, byte0) and
            path[1] == CHAR_COLON and
            isSepWindowsT(T, path[2]));
}

pub fn isAbsolutePosixZigString(pathZStr: jsc.ZigString) bool {
    const pathZStrTrunc = pathZStr.trunc(1);
    return if (pathZStrTrunc.len > 0 and pathZStrTrunc.is16Bit())
        isAbsolutePosixT(u16, pathZStrTrunc.utf16SliceAligned())
    else
        isAbsolutePosixT(u8, pathZStrTrunc.slice());
}

pub fn isAbsoluteWindowsZigString(pathZStr: jsc.ZigString) bool {
    return if (pathZStr.len > 0 and pathZStr.is16Bit())
        isAbsoluteWindowsT(u16, @alignCast(pathZStr.utf16Slice()))
    else
        isAbsoluteWindowsT(u8, pathZStr.slice());
}

pub fn isAbsolute(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    const path_ptr: jsc.JSValue = if (args_len > 0) args_ptr[0] else .js_undefined;
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    try validateString(globalObject, path_ptr, "path", .{});

    const pathZStr = try path_ptr.getZigString(globalObject);
    if (pathZStr.len == 0) return .false;
    if (isWindows) return jsc.JSValue.jsBoolean(isAbsoluteWindowsZigString(pathZStr));
    return jsc.JSValue.jsBoolean(isAbsolutePosixZigString(pathZStr));
}

pub fn isSepPosixT(comptime T: type, byte: T) bool {
    return byte == CHAR_FORWARD_SLASH;
}

pub fn isSepWindowsT(comptime T: type, byte: T) bool {
    return byte == CHAR_FORWARD_SLASH or byte == CHAR_BACKWARD_SLASH;
}

/// Based on Node v21.6.1 private helper isWindowsDeviceRoot:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L60C10-L60C29
pub fn isWindowsDeviceRootT(comptime T: type, byte: T) bool {
    return (byte >= 'A' and byte <= 'Z') or (byte >= 'a' and byte <= 'z');
}

/// Based on Node v21.6.1 path.posix.join:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1169
pub fn joinPosixT(comptime T: type, paths: []const []const T, buf: []T, buf2: []T) []const T {
    comptime validatePathT(T, "joinPosixT");

    if (paths.len == 0) {
        return comptime L(T, CHAR_STR_DOT);
    }

    var bufSize: usize = 0;
    var bufOffset: usize = 0;

    // Back joined by expandable buf2 in case it is long.
    var joined: []const T = &.{};

    for (paths) |path| {
        // validateString of `path is performed in pub fn join.
        // Back our virtual "joined" string by expandable buf2 in
        // case it is long.
        const len = path.len;
        if (len > 0) {
            // Translated from the following JS code:
            //   if (joined === undefined)
            //     joined = arg;
            //   else
            //     joined += `/${arg}`;
            if (bufSize != 0) {
                bufOffset = bufSize;
                bufSize += 1;
                buf2[bufOffset] = CHAR_FORWARD_SLASH;
            }
            bufOffset = bufSize;
            bufSize += len;
            bun.memmove(buf2[bufOffset..bufSize], path);

            joined = buf2[0..bufSize];
        }
    }
    if (bufSize == 0) {
        return comptime L(T, CHAR_STR_DOT);
    }
    return normalizePosixT(T, joined, buf);
}

export fn Bun__Node__Path_joinWTF(lhs: *bun.String, rhs_ptr: [*]const u8, rhs_len: usize, result: *bun.String) void {
    const rhs = rhs_ptr[0..rhs_len];
    var buf: [PATH_SIZE(u8)]u8 = undefined;
    var buf2: [PATH_SIZE(u8)]u8 = undefined;
    var slice = lhs.toUTF8(bun.default_allocator);
    defer slice.deinit();
    if (Environment.isWindows) {
        const win = joinWindowsT(u8, &.{ slice.slice(), rhs }, &buf, &buf2);
        result.* = bun.String.cloneUTF8(win);
    } else {
        const posix = joinPosixT(u8, &.{ slice.slice(), rhs }, &buf, &buf2);
        result.* = bun.String.cloneUTF8(posix);
    }
}

/// Based on Node v21.6.1 path.win32.join:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L425
pub fn joinWindowsT(comptime T: type, paths: []const []const T, buf: []T, buf2: []T) []const T {
    comptime validatePathT(T, "joinWindowsT");

    if (paths.len == 0) {
        return comptime L(T, CHAR_STR_DOT);
    }

    const isSepT = isSepWindowsT;

    var bufSize: usize = 0;
    var bufOffset: usize = 0;

    // Backed by expandable buf2 in case it is long.
    var joined: []const T = &.{};
    var firstPart: []const T = &.{};

    for (paths) |path| {
        // validateString of `path` is performed in pub fn join.
        const len = path.len;
        if (len > 0) {
            // Translated from the following JS code:
            //   if (joined === undefined)
            //     joined = firstPart = arg;
            //   else
            //     joined += `\\${arg}`;
            bufOffset = bufSize;
            if (bufSize == 0) {
                bufSize = len;
                bun.memmove(buf2[0..bufSize], path);

                joined = buf2[0..bufSize];
                firstPart = joined;
            } else {
                bufOffset = bufSize;
                bufSize += 1;
                buf2[bufOffset] = CHAR_BACKWARD_SLASH;
                bufOffset = bufSize;
                bufSize += len;
                bun.memmove(buf2[bufOffset..bufSize], path);

                joined = buf2[0..bufSize];
            }
        }
    }
    if (bufSize == 0) {
        return comptime L(T, CHAR_STR_DOT);
    }

    // Make sure that the joined path doesn't start with two slashes, because
    // normalize() will mistake it for a UNC path then.
    //
    // This step is skipped when it is very clear that the user actually
    // intended to point at a UNC path. This is assumed when the first
    // non-empty string arguments starts with exactly two slashes followed by
    // at least one more non-slash character.
    //
    // Note that for normalize() to treat a path as a UNC path it needs to
    // have at least 2 components, so we don't filter for that here.
    // This means that the user can use join to construct UNC paths from
    // a server name and a share name; for example:
    //   path.join('//server', 'share') -> '\\\\server\\share\\')
    var needsReplace: bool = true;
    var slashCount: usize = 0;
    if (isSepT(T, firstPart[0])) {
        slashCount += 1;
        const firstLen = firstPart.len;
        if (firstLen > 1 and
            isSepT(T, firstPart[1]))
        {
            slashCount += 1;
            if (firstLen > 2) {
                if (isSepT(T, firstPart[2])) {
                    slashCount += 1;
                } else {
                    // We matched a UNC path in the first part
                    needsReplace = false;
                }
            }
        }
    }
    if (needsReplace) {
        // Find any more consecutive slashes we need to replace
        while (slashCount < bufSize and
            isSepT(T, joined[slashCount]))
        {
            slashCount += 1;
        }
        // Replace the slashes if needed
        if (slashCount >= 2) {
            // Translated from the following JS code:
            //   joined = `\\${StringPrototypeSlice(joined, slashCount)}`;
            bufOffset = 1;
            bufSize = bufOffset + (bufSize - slashCount);
            // Move all bytes to the right by slashCount - 1.
            // Use bun.copy because joined and buf2 overlap.
            bun.copy(u8, buf2[bufOffset..bufSize], joined[slashCount..]);
            // Prepend the separator.
            buf2[0] = CHAR_BACKWARD_SLASH;

            joined = buf2[0..bufSize];
        }
    }
    return normalizeWindowsT(T, joined, buf);
}

pub fn joinPosixJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, paths: []const []const T, buf: []T, buf2: []T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, joinPosixT(T, paths, buf, buf2));
}

pub fn joinWindowsJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, paths: []const []const T, buf: []T, buf2: []T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, joinWindowsT(T, paths, buf, buf2));
}

pub fn joinJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, paths: []const []const T) bun.JSError!jsc.JSValue {
    // Adding 8 bytes when Windows for the possible UNC root.
    var bufLen: usize = if (isWindows) 8 else 0;
    for (paths) |path| bufLen += if (path.len > 0) path.len + 1 else path.len;
    bufLen = @max(bufLen, PATH_SIZE(T));
    const buf = bun.handleOom(allocator.alloc(T, bufLen));
    defer allocator.free(buf);
    const buf2 = bun.handleOom(allocator.alloc(T, bufLen));
    defer allocator.free(buf2);
    return if (isWindows) joinWindowsJS_T(T, globalObject, paths, buf, buf2) else joinPosixJS_T(T, globalObject, paths, buf, buf2);
}

pub fn join(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    if (args_len == 0) return bun.String.createUTF8ForJS(globalObject, CHAR_STR_DOT);

    var arena = bun.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();

    var stack_fallback = std.heap.stackFallback(stack_fallback_size_large, arena.allocator());
    const allocator = stack_fallback.get();

    var paths = bun.handleOom(allocator.alloc(string, args_len));
    defer allocator.free(paths);

    for (0..args_len, args_ptr) |i, path_ptr| {
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        try validateString(globalObject, path_ptr, "paths[{d}]", .{i});
        const pathZStr = try path_ptr.getZigString(globalObject);
        paths[i] = if (pathZStr.len > 0) pathZStr.toSlice(allocator).slice() else "";
    }
    return joinJS_T(u8, globalObject, allocator, isWindows, paths);
}

/// Based on Node v21.6.1 private helper normalizeString:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L65C1-L66C77
///
/// Resolves . and .. elements in a path with directory names
fn normalizeStringT(comptime T: type, path: []const T, allowAboveRoot: bool, separator: T, comptime platform: bun.path.Platform, buf: []T) [:0]T {
    const len = path.len;
    const isSepT =
        if (platform == .posix)
            isSepPosixT
        else
            isSepWindowsT;

    var bufOffset: usize = 0;
    var bufSize: usize = 0;

    var lastSegmentLength: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var lastSlash: ?usize = null;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var dots: ?usize = 0;
    var byte: T = 0;

    var i: usize = 0;
    while (i <= len) : (i += 1) {
        if (i < len) {
            byte = path[i];
        } else if (isSepT(T, byte)) {
            break;
        } else {
            byte = CHAR_FORWARD_SLASH;
        }

        if (isSepT(T, byte)) {
            // Translated from the following JS code:
            //   if (lastSlash === i - 1 || dots === 1) {
            if ((lastSlash == null and i == 0) or
                (lastSlash != null and i > 0 and lastSlash.? == i - 1) or
                (dots != null and dots.? == 1))
            {
                // NOOP
            } else if (dots != null and dots.? == 2) {
                if (bufSize < 2 or
                    lastSegmentLength != 2 or
                    buf[bufSize - 1] != CHAR_DOT or
                    buf[bufSize - 2] != CHAR_DOT)
                {
                    if (bufSize > 2) {
                        const lastSlashIndex = std.mem.lastIndexOfScalar(T, buf[0..bufSize], separator);
                        if (lastSlashIndex == null) {
                            bufSize = 0;
                            lastSegmentLength = 0;
                        } else {
                            bufSize = lastSlashIndex.?;
                            // Translated from the following JS code:
                            //   lastSegmentLength =
                            //     res.length - 1 - StringPrototypeLastIndexOf(res, separator);
                            const lastIndexOfSep = std.mem.lastIndexOfScalar(T, buf[0..bufSize], separator);
                            if (lastIndexOfSep == null) {
                                // Yes (>ლ), Node relies on the -1 result of
                                // StringPrototypeLastIndexOf(res, separator).
                                // A - -1 is a positive 1.
                                // So the code becomes
                                //   lastSegmentLength = res.length - 1 + 1;
                                // or
                                //   lastSegmentLength = res.length;
                                lastSegmentLength = bufSize;
                            } else {
                                lastSegmentLength = bufSize - 1 - lastIndexOfSep.?;
                            }
                        }
                        lastSlash = i;
                        dots = 0;
                        continue;
                    } else if (bufSize != 0) {
                        bufSize = 0;
                        lastSegmentLength = 0;
                        lastSlash = i;
                        dots = 0;
                        continue;
                    }
                }
                if (allowAboveRoot) {
                    // Translated from the following JS code:
                    //   res += res.length > 0 ? `${separator}..` : '..';
                    if (bufSize > 0) {
                        bufOffset = bufSize;
                        bufSize += 1;
                        buf[bufOffset] = separator;
                        bufOffset = bufSize;
                        bufSize += 2;
                        buf[bufOffset] = CHAR_DOT;
                        buf[bufOffset + 1] = CHAR_DOT;
                    } else {
                        bufSize = 2;
                        buf[0] = CHAR_DOT;
                        buf[1] = CHAR_DOT;
                    }

                    lastSegmentLength = 2;
                }
            } else {
                // Translated from the following JS code:
                //   if (res.length > 0)
                //     res += `${separator}${StringPrototypeSlice(path, lastSlash + 1, i)}`;
                //   else
                //     res = StringPrototypeSlice(path, lastSlash + 1, i);
                if (bufSize > 0) {
                    bufOffset = bufSize;
                    bufSize += 1;
                    buf[bufOffset] = separator;
                }
                const sliceStart = if (lastSlash != null) lastSlash.? + 1 else 0;
                const slice = path[sliceStart..i];

                bufOffset = bufSize;
                bufSize += slice.len;
                bun.memmove(buf[bufOffset..bufSize], slice);

                // Translated from the following JS code:
                //   lastSegmentLength = i - lastSlash - 1;
                const subtract = if (lastSlash != null) lastSlash.? + 1 else 2;
                lastSegmentLength = if (i >= subtract) i - subtract else 0;
            }
            lastSlash = i;
            dots = 0;
            continue;
        } else if (byte == CHAR_DOT and dots != null) {
            dots = if (dots != null) dots.? + 1 else 0;
            continue;
        } else {
            dots = null;
        }
    }

    buf[bufSize] = 0;
    return buf[0..bufSize :0];
}

/// Based on Node v21.6.1 path.posix.normalize
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1130
pub fn normalizePosixT(comptime T: type, path: []const T, buf: []T) []const T {
    comptime validatePathT(T, "normalizePosixT");

    // validateString of `path` is performed in pub fn normalize.
    const len = path.len;
    if (len == 0) {
        return comptime L(T, CHAR_STR_DOT);
    }

    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    const _isAbsolute = path[0] == CHAR_FORWARD_SLASH;
    const trailingSeparator = path[len - 1] == CHAR_FORWARD_SLASH;

    // Normalize the path
    var normalizedPath = normalizeStringT(T, path, !_isAbsolute, CHAR_FORWARD_SLASH, .posix, buf);

    var bufSize: usize = normalizedPath.len;
    if (bufSize == 0) {
        if (_isAbsolute) {
            return comptime L(T, CHAR_STR_FORWARD_SLASH);
        }
        return if (trailingSeparator)
            comptime L(T, "./")
        else
            comptime L(T, CHAR_STR_DOT);
    }

    var bufOffset: usize = 0;

    // Translated from the following JS code:
    //   if (trailingSeparator)
    //     path += '/';
    if (trailingSeparator) {
        bufOffset = bufSize;
        bufSize += 1;
        buf[bufOffset] = CHAR_FORWARD_SLASH;
        buf[bufSize] = 0;
        normalizedPath = buf[0..bufSize :0];
    }

    // Translated from the following JS code:
    //   return isAbsolute ? `/${path}` : path;
    if (_isAbsolute) {
        bufOffset = 1;
        bufSize += 1;
        // Move all bytes to the right by 1 for the separator.
        // Use bun.copy because normalizedPath and buf overlap.
        bun.copy(T, buf[bufOffset..bufSize], normalizedPath);
        // Prepend the separator.
        buf[0] = CHAR_FORWARD_SLASH;
        buf[bufSize] = 0;
        normalizedPath = buf[0..bufSize :0];
    }
    return normalizedPath;
}

/// Based on Node v21.6.1 path.win32.normalize
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L308
pub fn normalizeWindowsT(comptime T: type, path: []const T, buf: []T) []const T {
    comptime validatePathT(T, "normalizeWindowsT");

    // validateString of `path` is performed in pub fn normalize.
    const len = path.len;
    if (len == 0) {
        return comptime L(T, CHAR_STR_DOT);
    }

    const isSepT = isSepWindowsT;

    // Moved `rootEnd`, `device`, and `_isAbsolute` initialization after
    // the `if (len == 1)` check.
    const byte0: T = path[0];

    // Try to match a root
    if (len == 1) {
        // `path` contains just a single char, exit early to avoid
        // unnecessary work
        return if (isSepT(T, byte0)) comptime L(T, CHAR_STR_BACKWARD_SLASH) else path;
    }

    var rootEnd: usize = 0;
    // Backed by buf.
    var device: ?[]const T = null;
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    var _isAbsolute: bool = false;

    var bufOffset: usize = 0;
    var bufSize: usize = 0;

    if (isSepT(T, byte0)) {
        // Possible UNC root

        // If we started with a separator, we know we at least have an absolute
        // path of some kind (UNC or otherwise)
        _isAbsolute = true;

        if (isSepT(T, path[1])) {
            // Matched double path separator at beginning
            var j: usize = 2;
            var last: usize = j;
            // Match 1 or more non-path separators
            while (j < len and
                !isSepT(T, path[j]))
            {
                j += 1;
            }
            if (j < len and j != last) {
                const firstPart: []const u8 = path[last..j];
                // Matched!
                last = j;
                // Match 1 or more path separators
                while (j < len and
                    isSepT(T, path[j]))
                {
                    j += 1;
                }
                if (j < len and j != last) {
                    // Matched!
                    last = j;
                    // Match 1 or more non-path separators
                    while (j < len and
                        !isSepT(T, path[j]))
                    {
                        j += 1;
                    }
                    if (j == len) {
                        // We matched a UNC root only
                        // Return the normalized version of the UNC root since there
                        // is nothing left to process

                        // Translated from the following JS code:
                        //   return `\\\\${firstPart}\\${StringPrototypeSlice(path, last)}\\`;
                        bufSize = 2;
                        buf[0] = CHAR_BACKWARD_SLASH;
                        buf[1] = CHAR_BACKWARD_SLASH;
                        bufOffset = bufSize;
                        bufSize += firstPart.len;
                        bun.memmove(buf[bufOffset..bufSize], firstPart);
                        bufOffset = bufSize;
                        bufSize += 1;
                        buf[bufOffset] = CHAR_BACKWARD_SLASH;
                        bufOffset = bufSize;
                        bufSize += len - last;
                        bun.memmove(buf[bufOffset..bufSize], path[last..len]);
                        bufOffset = bufSize;
                        bufSize += 1;
                        buf[bufOffset] = CHAR_BACKWARD_SLASH;
                        return buf[0..bufSize];
                    }
                    if (j != last) {
                        // We matched a UNC root with leftovers

                        // Translated from the following JS code:
                        //   device =
                        //     `\\\\${firstPart}\\${StringPrototypeSlice(path, last, j)}`;
                        //   rootEnd = j;
                        bufSize = 2;
                        buf[0] = CHAR_BACKWARD_SLASH;
                        buf[1] = CHAR_BACKWARD_SLASH;
                        bufOffset = bufSize;
                        bufSize += firstPart.len;
                        bun.memmove(buf[bufOffset..bufSize], firstPart);
                        bufOffset = bufSize;
                        bufSize += 1;
                        buf[bufOffset] = CHAR_BACKWARD_SLASH;
                        bufOffset = bufSize;
                        bufSize += j - last;
                        bun.memmove(buf[bufOffset..bufSize], path[last..j]);

                        device = buf[0..bufSize];
                        rootEnd = j;
                    }
                }
            }
        } else {
            rootEnd = 1;
        }
    } else if (isWindowsDeviceRootT(T, byte0) and
        path[1] == CHAR_COLON)
    {
        // Possible device root
        buf[0] = byte0;
        buf[1] = CHAR_COLON;
        device = buf[0..2];
        rootEnd = 2;
        if (len > 2 and isSepT(T, path[2])) {
            // Treat separator following drive name as an absolute path
            // indicator
            _isAbsolute = true;
            rootEnd = 3;
        }
    }

    bufOffset = (if (device) |_d| _d.len else 0) + @intFromBool(_isAbsolute);
    // Backed by buf at an offset of  device.len + 1 if _isAbsolute is true.
    var tailLen = if (rootEnd < len) normalizeStringT(T, path[rootEnd..len], !_isAbsolute, CHAR_BACKWARD_SLASH, .windows, buf[bufOffset..]).len else 0;
    if (tailLen == 0 and !_isAbsolute) {
        buf[bufOffset] = CHAR_DOT;
        tailLen = 1;
    }

    if (tailLen > 0 and
        isSepT(T, path[len - 1]))
    {
        // Translated from the following JS code:
        //   tail += '\\';
        buf[bufOffset + tailLen] = CHAR_BACKWARD_SLASH;
        tailLen += 1;
    }

    bufSize = bufOffset + tailLen;
    // Translated from the following JS code:
    //   if (device === undefined) {
    //     return isAbsolute ? `\\${tail}` : tail;
    //   }
    //   return isAbsolute ? `${device}\\${tail}` : `${device}${tail}`;
    if (_isAbsolute) {
        bufOffset -= 1;
        // Prepend the separator.
        buf[bufOffset] = CHAR_BACKWARD_SLASH;
    }
    return buf[0..bufSize];
}

pub fn normalizeT(comptime T: type, path: []const T, buf: []T) []const T {
    return switch (Environment.os) {
        .windows => normalizeWindowsT(T, path, buf),
        else => normalizePosixT(T, path, buf),
    };
}

pub fn normalizePosixJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T, buf: []T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, normalizePosixT(T, path, buf));
}

pub fn normalizeWindowsJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T, buf: []T) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalObject, normalizeWindowsT(T, path, buf));
}

pub fn normalizeJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, path: []const T) bun.JSError!jsc.JSValue {
    const bufLen = @max(path.len, PATH_SIZE(T));
    // +1 for null terminator
    const buf = bun.handleOom(allocator.alloc(T, bufLen + 1));
    defer allocator.free(buf);
    return if (isWindows) normalizeWindowsJS_T(T, globalObject, path, buf) else normalizePosixJS_T(T, globalObject, path, buf);
}

pub fn normalize(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    const path_ptr: jsc.JSValue = if (args_len > 0) args_ptr[0] else .js_undefined;
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    try validateString(globalObject, path_ptr, "path", .{});
    const pathZStr = try path_ptr.getZigString(globalObject);
    const len = pathZStr.len;
    if (len == 0) return bun.String.createUTF8ForJS(globalObject, CHAR_STR_DOT);

    var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, bun.default_allocator);
    const allocator = stack_fallback.get();

    const pathZSlice = pathZStr.toSlice(allocator);
    defer pathZSlice.deinit();
    return normalizeJS_T(u8, globalObject, allocator, isWindows, pathZSlice.slice());
}

// Based on Node v21.6.1 path.posix.parse
// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1452
pub fn parsePosixT(comptime T: type, path: []const T) PathParsed(T) {
    comptime validatePathT(T, "parsePosixT");

    // validateString of `path` is performed in pub fn parse.
    const len = path.len;
    if (len == 0) {
        return .{};
    }

    var root: []const T = &.{};
    var dir: []const T = &.{};
    var base: []const T = &.{};
    var ext: []const T = &.{};
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    var _name: []const T = &.{};
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    const _isAbsolute = path[0] == CHAR_FORWARD_SLASH;
    var start: usize = 0;
    if (_isAbsolute) {
        root = comptime L(T, CHAR_STR_FORWARD_SLASH);
        start = 1;
    }

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var startDot: ?usize = null;
    var startPart: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var end: ?usize = null;
    var matchedSlash = true;
    var i_i64 = @as(i64, @intCast(len - 1));

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var preDotState: ?usize = 0;

    // Get non-dir info
    while (i_i64 >= start) : (i_i64 -= 1) {
        const i = @as(usize, @intCast(i_i64));
        const byte = path[i];
        if (byte == CHAR_FORWARD_SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end == null) {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matchedSlash = false;
            end = i + 1;
        }
        if (byte == CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if (startDot == null) {
                startDot = i;
            } else if (preDotState) |_preDotState| {
                if (_preDotState != 1) {
                    preDotState = 1;
                }
            }
        } else if (startDot != null) {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            preDotState = null;
        }
    }

    if (end) |_end| {
        const _preDotState = if (preDotState) |_p| _p else 0;
        const _startDot = if (startDot) |_s| _s else 0;
        start = if (startPart == 0 and _isAbsolute) 1 else startPart;
        if (startDot == null or
            // We saw a non-dot character immediately before the dot
            (preDotState != null and _preDotState == 0) or
            // The (right-most) trimmed path component is exactly '..'
            (_preDotState == 1 and
                _startDot == _end - 1 and
                _startDot == startPart + 1))
        {
            _name = path[start.._end];
            base = _name;
        } else {
            _name = path[start.._startDot];
            base = path[start.._end];
            ext = path[_startDot.._end];
        }
    }

    if (startPart > 0) {
        dir = path[0..(startPart - 1)];
    } else if (_isAbsolute) {
        dir = comptime L(T, CHAR_STR_FORWARD_SLASH);
    }

    return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
}

// Based on Node v21.6.1 path.win32.parse
// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L916
pub fn parseWindowsT(comptime T: type, path: []const T) PathParsed(T) {
    comptime validatePathT(T, "parseWindowsT");

    // validateString of `path` is performed in pub fn parse.
    var root: []const T = &.{};
    var dir: []const T = &.{};
    var base: []const T = &.{};
    var ext: []const T = &.{};
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    var _name: []const T = &.{};

    const len = path.len;
    if (len == 0) {
        return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
    }

    const isSepT = isSepWindowsT;

    var rootEnd: usize = 0;
    var byte = path[0];

    if (len == 1) {
        if (isSepT(T, byte)) {
            // `path` contains just a path separator, exit early to avoid
            // unnecessary work
            root = path;
            dir = path;
        } else {
            base = path;
            _name = path;
        }
        return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
    }

    // Try to match a root
    if (isSepT(T, byte)) {
        // Possible UNC root

        rootEnd = 1;
        if (isSepT(T, path[1])) {
            // Matched double path separator at the beginning
            var j: usize = 2;
            var last: usize = j;
            // Match 1 or more non-path separators
            while (j < len and
                !isSepT(T, path[j]))
            {
                j += 1;
            }
            if (j < len and j != last) {
                // Matched!
                last = j;
                // Match 1 or more path separators
                while (j < len and
                    isSepT(T, path[j]))
                {
                    j += 1;
                }
                if (j < len and j != last) {
                    // Matched!
                    last = j;
                    // Match 1 or more non-path separators
                    while (j < len and
                        !isSepT(T, path[j]))
                    {
                        j += 1;
                    }
                    if (j == len) {
                        // We matched a UNC root only
                        rootEnd = j;
                    } else if (j != last) {
                        // We matched a UNC root with leftovers
                        rootEnd = j + 1;
                    }
                }
            }
        }
    } else if (isWindowsDeviceRootT(T, byte) and
        path[1] == CHAR_COLON)
    {
        // Possible device root
        if (len <= 2) {
            // `path` contains just a drive root, exit early to avoid
            // unnecessary work
            root = path;
            dir = path;
            return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
        }
        rootEnd = 2;
        if (isSepT(T, path[2])) {
            if (len == 3) {
                // `path` contains just a drive root, exit early to avoid
                // unnecessary work
                root = path;
                dir = path;
                return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
            }
            rootEnd = 3;
        }
    }
    if (rootEnd > 0) {
        root = path[0..rootEnd];
    }

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var startDot: ?usize = null;
    var startPart = rootEnd;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var end: ?usize = null;
    var matchedSlash = true;
    var i_i64 = @as(i64, @intCast(len - 1));

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var preDotState: ?usize = 0;

    // Get non-dir info
    while (i_i64 >= rootEnd) : (i_i64 -= 1) {
        const i = @as(usize, @intCast(i_i64));
        byte = path[i];
        if (isSepT(T, byte)) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end == null) {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matchedSlash = false;
            end = i + 1;
        }
        if (byte == CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if (startDot == null) {
                startDot = i;
            } else if (preDotState) |_preDotState| {
                if (_preDotState != 1) {
                    preDotState = 1;
                }
            }
        } else if (startDot != null) {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            preDotState = null;
        }
    }

    if (end) |_end| {
        const _preDotState = if (preDotState) |_p| _p else 0;
        const _startDot = if (startDot) |_s| _s else 0;
        if (startDot == null or
            // We saw a non-dot character immediately before the dot
            (preDotState != null and _preDotState == 0) or
            // The (right-most) trimmed path component is exactly '..'
            (_preDotState == 1 and
                _startDot == _end - 1 and
                _startDot == startPart + 1))
        {
            // Prefix with _ to avoid shadowing the identifier in the outer scope.
            _name = path[startPart.._end];
            base = _name;
        } else {
            _name = path[startPart.._startDot];
            base = path[startPart.._end];
            ext = path[_startDot.._end];
        }
    }

    // If the directory is the root, use the entire root as the `dir` including
    // the trailing slash if any (`C:\abc` -> `C:\`). Otherwise, strip out the
    // trailing slash (`C:\abc\def` -> `C:\abc`).
    if (startPart > 0 and startPart != rootEnd) {
        dir = path[0..(startPart - 1)];
    } else {
        dir = root;
    }

    return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
}

pub fn parsePosixJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T) bun.JSError!jsc.JSValue {
    return parsePosixT(T, path).toJSObject(globalObject);
}

pub fn parseWindowsJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T) bun.JSError!jsc.JSValue {
    return parseWindowsT(T, path).toJSObject(globalObject);
}

pub fn parseJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, isWindows: bool, path: []const T) bun.JSError!jsc.JSValue {
    return if (isWindows) parseWindowsJS_T(T, globalObject, path) else parsePosixJS_T(T, globalObject, path);
}

pub fn parse(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    const path_ptr: jsc.JSValue = if (args_len > 0) args_ptr[0] else .js_undefined;
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    try validateString(globalObject, path_ptr, "path", .{});

    const pathZStr = try path_ptr.getZigString(globalObject);
    if (pathZStr.len == 0) return (PathParsed(u8){}).toJSObject(globalObject);

    var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, bun.default_allocator);
    const allocator = stack_fallback.get();

    const pathZSlice = pathZStr.toSlice(allocator);
    defer pathZSlice.deinit();
    return parseJS_T(u8, globalObject, isWindows, pathZSlice.slice());
}

/// Based on Node v21.6.1 path.posix.relative:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1193
pub fn relativePosixT(comptime T: type, from: []const T, to: []const T, buf: []T, buf2: []T, buf3: []T) MaybeSlice(T) {
    comptime validatePathT(T, "relativePosixT");

    // validateString of `from` and `to` are performed in pub fn relative.
    if (std.mem.eql(T, from, to)) {
        return MaybeSlice(T){ .result = &.{} };
    }

    // Trim leading forward slashes.
    // Backed by expandable buf2 because fromOrig may be long.
    const fromOrig = switch (resolvePosixT(T, &.{from}, buf2, buf3)) {
        .result => |r| r,
        .err => |e| return MaybeSlice(T){ .err = e },
    };
    const fromOrigLen = fromOrig.len;
    // Backed by buf.
    const toOrig = switch (resolvePosixT(T, &.{to}, buf, buf3)) {
        .result => |r| r,
        .err => |e| return MaybeSlice(T){ .err = e },
    };

    if (std.mem.eql(T, fromOrig, toOrig)) {
        return MaybeSlice(T){ .result = &.{} };
    }

    const fromStart = 1;
    const fromEnd = fromOrigLen;
    const fromLen = fromEnd - fromStart;
    const toOrigLen = toOrig.len;
    var toStart: usize = 1;
    const toLen = toOrigLen - toStart;

    // Compare paths to find the longest common path from root
    const smallestLength = @min(fromLen, toLen);
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var lastCommonSep: ?usize = null;

    var matchesAllOfSmallest = false;
    // Add a block to isolate `i`.
    {
        var i: usize = 0;
        while (i < smallestLength) : (i += 1) {
            const fromByte = fromOrig[fromStart + i];
            if (fromByte != toOrig[toStart + i]) {
                break;
            } else if (fromByte == CHAR_FORWARD_SLASH) {
                lastCommonSep = i;
            }
        }
        matchesAllOfSmallest = i == smallestLength;
    }
    if (matchesAllOfSmallest) {
        if (toLen > smallestLength) {
            if (toOrig[toStart + smallestLength] == CHAR_FORWARD_SLASH) {
                // We get here if `from` is the exact base path for `to`.
                // For example: from='/foo/bar'; to='/foo/bar/baz'
                return MaybeSlice(T){ .result = toOrig[toStart + smallestLength + 1 .. toOrigLen :0] };
            }
            if (smallestLength == 0) {
                // We get here if `from` is the root
                // For example: from='/'; to='/foo'
                return MaybeSlice(T){ .result = toOrig[toStart + smallestLength .. toOrigLen :0] };
            }
        } else if (fromLen > smallestLength) {
            if (fromOrig[fromStart + smallestLength] == CHAR_FORWARD_SLASH) {
                // We get here if `to` is the exact base path for `from`.
                // For example: from='/foo/bar/baz'; to='/foo/bar'
                lastCommonSep = smallestLength;
            } else if (smallestLength == 0) {
                // We get here if `to` is the root.
                // For example: from='/foo/bar'; to='/'
                lastCommonSep = 0;
            }
        }
    }

    var bufOffset: usize = 0;
    var bufSize: usize = 0;

    // Backed by buf3.
    var out: []const T = &.{};
    // Add a block to isolate `i`.
    {
        // Generate the relative path based on the path difference between `to`
        // and `from`.

        // Translated from the following JS code:
        //  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
        var i: usize = fromStart + (if (lastCommonSep != null) lastCommonSep.? + 1 else 0);
        while (i <= fromEnd) : (i += 1) {
            if (i == fromEnd or fromOrig[i] == CHAR_FORWARD_SLASH) {
                // Translated from the following JS code:
                //   out += out.length === 0 ? '..' : '/..';
                if (out.len > 0) {
                    bufOffset = bufSize;
                    bufSize += 3;
                    buf3[bufOffset] = CHAR_FORWARD_SLASH;
                    buf3[bufOffset + 1] = CHAR_DOT;
                    buf3[bufOffset + 2] = CHAR_DOT;
                } else {
                    bufSize = 2;
                    buf3[0] = CHAR_DOT;
                    buf3[1] = CHAR_DOT;
                }
                out = buf3[0..bufSize];
            }
        }
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts.

    // Translated from the following JS code:
    //   return `${out}${StringPrototypeSlice(to, toStart + lastCommonSep)}`;
    toStart = if (lastCommonSep != null) toStart + lastCommonSep.? else 0;
    const sliceSize = toOrigLen - toStart;
    const outLen = out.len;
    bufSize = outLen;
    if (sliceSize > 0) {
        bufOffset = bufSize;
        bufSize += sliceSize;
        // Use bun.copy because toOrig and buf overlap.
        bun.copy(T, buf[bufOffset..bufSize], toOrig[toStart..toOrigLen]);
    }
    if (outLen > 0) {
        bun.memmove(buf[0..outLen], out);
    }
    buf[bufSize] = 0;
    return MaybeSlice(T){ .result = buf[0..bufSize :0] };
}

/// Based on Node v21.6.1 path.win32.relative:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L500
pub fn relativeWindowsT(comptime T: type, from: []const T, to: []const T, buf: []T, buf2: []T, buf3: []T) MaybeSlice(T) {
    comptime validatePathT(T, "relativeWindowsT");

    // validateString of `from` and `to` are performed in pub fn relative.
    if (std.mem.eql(T, from, to)) {
        return MaybeSlice(T){ .result = &.{} };
    }

    // Backed by expandable buf2 because fromOrig may be long.
    const fromOrig = switch (resolveWindowsT(T, &.{from}, buf2, buf3)) {
        .result => |r| r,
        .err => |e| return MaybeSlice(T){ .err = e },
    };
    const fromOrigLen = fromOrig.len;
    // Backed by buf.
    const toOrig = switch (resolveWindowsT(T, &.{to}, buf, buf3)) {
        .result => |r| r,
        .err => |e| return MaybeSlice(T){ .err = e },
    };

    if (std.mem.eql(T, fromOrig, toOrig) or
        eqlIgnoreCaseT(T, fromOrig, toOrig))
    {
        return MaybeSlice(T){ .result = &.{} };
    }

    const toOrigLen = toOrig.len;

    // Trim leading backslashes
    var fromStart: usize = 0;
    while (fromStart < fromOrigLen and
        fromOrig[fromStart] == CHAR_BACKWARD_SLASH)
    {
        fromStart += 1;
    }

    // Trim trailing backslashes (applicable to UNC paths only)
    var fromEnd = fromOrigLen;
    while (fromEnd - 1 > fromStart and
        fromOrig[fromEnd - 1] == CHAR_BACKWARD_SLASH)
    {
        fromEnd -= 1;
    }

    const fromLen = fromEnd - fromStart;

    // Trim leading backslashes
    var toStart: usize = 0;
    while (toStart < toOrigLen and
        toOrig[toStart] == CHAR_BACKWARD_SLASH)
    {
        toStart = toStart + 1;
    }

    // Trim trailing backslashes (applicable to UNC paths only)
    var toEnd = toOrigLen;
    while (toEnd - 1 > toStart and
        toOrig[toEnd - 1] == CHAR_BACKWARD_SLASH)
    {
        toEnd -= 1;
    }

    const toLen = toEnd - toStart;

    // Compare paths to find the longest common path from root
    const smallestLength = @min(fromLen, toLen);
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    var lastCommonSep: ?usize = null;

    var matchesAllOfSmallest = false;
    // Add a block to isolate `i`.
    {
        var i: usize = 0;
        while (i < smallestLength) : (i += 1) {
            const fromByte = fromOrig[fromStart + i];
            if (toLowerT(T, fromByte) != toLowerT(T, toOrig[toStart + i])) {
                break;
            } else if (fromByte == CHAR_BACKWARD_SLASH) {
                lastCommonSep = i;
            }
        }
        matchesAllOfSmallest = i == smallestLength;
    }

    // We found a mismatch before the first common path separator was seen, so
    // return the original `to`.
    if (!matchesAllOfSmallest) {
        if (lastCommonSep == null) {
            return MaybeSlice(T){ .result = toOrig };
        }
    } else {
        if (toLen > smallestLength) {
            if (toOrig[toStart + smallestLength] == CHAR_BACKWARD_SLASH) {
                // We get here if `from` is the exact base path for `to`.
                // For example: from='C:\foo\bar'; to='C:\foo\bar\baz'
                return MaybeSlice(T){ .result = toOrig[toStart + smallestLength + 1 .. toOrigLen :0] };
            }
            if (smallestLength == 2) {
                // We get here if `from` is the device root.
                // For example: from='C:\'; to='C:\foo'
                return MaybeSlice(T){ .result = toOrig[toStart + smallestLength .. toOrigLen :0] };
            }
        }
        if (fromLen > smallestLength) {
            if (fromOrig[fromStart + smallestLength] == CHAR_BACKWARD_SLASH) {
                // We get here if `to` is the exact base path for `from`.
                // For example: from='C:\foo\bar'; to='C:\foo'
                lastCommonSep = smallestLength;
            } else if (smallestLength == 2) {
                // We get here if `to` is the device root.
                // For example: from='C:\foo\bar'; to='C:\'
                lastCommonSep = 3;
            }
        }
        if (lastCommonSep == null) {
            lastCommonSep = 0;
        }
    }

    var bufOffset: usize = 0;
    var bufSize: usize = 0;

    // Backed by buf3.
    var out: []const T = &.{};
    // Add a block to isolate `i`.
    {
        // Generate the relative path based on the path difference between `to`
        // and `from`.
        var i: usize = fromStart + (if (lastCommonSep != null) lastCommonSep.? + 1 else 0);
        while (i <= fromEnd) : (i += 1) {
            if (i == fromEnd or fromOrig[i] == CHAR_BACKWARD_SLASH) {
                // Translated from the following JS code:
                //   out += out.length === 0 ? '..' : '\\..';
                if (out.len > 0) {
                    bufOffset = bufSize;
                    bufSize += 3;
                    buf3[bufOffset] = CHAR_BACKWARD_SLASH;
                    buf3[bufOffset + 1] = CHAR_DOT;
                    buf3[bufOffset + 2] = CHAR_DOT;
                } else {
                    bufSize = 2;
                    buf3[0] = CHAR_DOT;
                    buf3[1] = CHAR_DOT;
                }
                out = buf3[0..bufSize];
            }
        }
    }

    // Translated from the following JS code:
    //   toStart += lastCommonSep;
    if (lastCommonSep == null) {
        // If toStart would go negative make it toOrigLen - 1 to
        // mimic String#slice with a negative start.
        toStart = if (toStart > 0) toStart - 1 else toOrigLen - 1;
    } else {
        toStart += lastCommonSep.?;
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts
    const outLen = out.len;
    if (outLen > 0) {
        const sliceSize = toEnd - toStart;
        bufSize = outLen;
        if (sliceSize > 0) {
            bufOffset = bufSize;
            bufSize += sliceSize;
            // Use bun.copy because toOrig and buf overlap.
            bun.copy(T, buf[bufOffset..bufSize], toOrig[toStart..toEnd]);
        }
        bun.memmove(buf[0..outLen], out);
        buf[bufSize] = 0;
        return MaybeSlice(T){ .result = buf[0..bufSize :0] };
    }

    if (toOrig[toStart] == CHAR_BACKWARD_SLASH) {
        toStart += 1;
    }
    return MaybeSlice(T){ .result = toOrig[toStart..toEnd :0] };
}

pub fn relativePosixJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, from: []const T, to: []const T, buf: []T, buf2: []T, buf3: []T) bun.JSError!jsc.JSValue {
    return switch (relativePosixT(T, from, to, buf, buf2, buf3)) {
        .result => |r| bun.String.createUTF8ForJS(globalObject, r),
        .err => |e| e.toJS(globalObject),
    };
}

pub fn relativeWindowsJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, from: []const T, to: []const T, buf: []T, buf2: []T, buf3: []T) bun.JSError!jsc.JSValue {
    return switch (relativeWindowsT(T, from, to, buf, buf2, buf3)) {
        .result => |r| bun.String.createUTF8ForJS(globalObject, r),
        .err => |e| e.toJS(globalObject),
    };
}

pub fn relativeJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, from: []const T, to: []const T) bun.JSError!jsc.JSValue {
    const bufLen = @max(from.len + to.len, PATH_SIZE(T));
    // +1 for null terminator
    const buf = bun.handleOom(allocator.alloc(T, bufLen + 1));
    defer allocator.free(buf);
    const buf2 = bun.handleOom(allocator.alloc(T, bufLen + 1));
    defer allocator.free(buf2);
    const buf3 = bun.handleOom(allocator.alloc(T, bufLen + 1));
    defer allocator.free(buf3);
    return if (isWindows) relativeWindowsJS_T(T, globalObject, from, to, buf, buf2, buf3) else relativePosixJS_T(T, globalObject, from, to, buf, buf2, buf3);
}

pub fn relative(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    const from_ptr: jsc.JSValue = if (args_len > 0) args_ptr[0] else .js_undefined;
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    try validateString(globalObject, from_ptr, "from", .{});
    const to_ptr: jsc.JSValue = if (args_len > 1) args_ptr[1] else .js_undefined;
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    try validateString(globalObject, to_ptr, "to", .{});

    const fromZigStr = try from_ptr.getZigString(globalObject);
    const toZigStr = try to_ptr.getZigString(globalObject);
    if ((fromZigStr.len + toZigStr.len) == 0) return from_ptr;

    var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, bun.default_allocator);
    const allocator = stack_fallback.get();

    var fromZigSlice = fromZigStr.toSlice(allocator);
    defer fromZigSlice.deinit();
    var toZigSlice = toZigStr.toSlice(allocator);
    defer toZigSlice.deinit();
    return relativeJS_T(u8, globalObject, allocator, isWindows, fromZigSlice.slice(), toZigSlice.slice());
}

/// Based on Node v21.6.1 path.posix.resolve:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1095
pub fn resolvePosixT(comptime T: type, paths: []const []const T, buf: []T, buf2: []T) MaybeSlice(T) {
    comptime validatePathT(T, "resolvePosixT");

    // Backed by expandable buf2 because resolvedPath may be long.
    // We use buf2 here because resolvePosixT is called by other methods and using
    // buf2 here avoids stepping on others' toes.
    var resolvedPath: [:0]const T = undefined;
    resolvedPath.len = 0;
    var resolvedPathLen: usize = 0;
    var resolvedAbsolute: bool = false;

    var bufOffset: usize = 0;
    var bufSize: usize = 0;

    var i_i64: i64 = if (paths.len == 0) -1 else @as(i64, @intCast(paths.len - 1));
    while (i_i64 > -2 and !resolvedAbsolute) : (i_i64 -= 1) {
        var path: []const T = &.{};
        if (i_i64 >= 0) {
            path = paths[@as(usize, @intCast(i_i64))];
        } else {
            // cwd is limited to MAX_PATH_BYTES.
            var tmpBuf: [MAX_PATH_SIZE(T)]T = undefined;
            path = switch (posixCwdT(T, &tmpBuf)) {
                .result => |r| r,
                .err => |e| return MaybeSlice(T){ .err = e },
            };
        }
        // validateString of `path` is performed in pub fn resolve.
        const len = path.len;

        // Skip empty paths.
        if (len == 0) {
            continue;
        }

        // Translated from the following JS code:
        //   resolvedPath = `${path}/${resolvedPath}`;
        if (resolvedPathLen > 0) {
            bufOffset = len + 1;
            bufSize = bufOffset + resolvedPathLen;
            // Move all bytes to the right by path.len + 1 for the separator.
            // Use bun.copy because resolvedPath and buf2 overlap.
            bun.copy(u8, buf2[bufOffset..bufSize], resolvedPath);
        }
        bufSize = len;
        bun.memmove(buf2[0..bufSize], path);
        bufSize += 1;
        buf2[len] = CHAR_FORWARD_SLASH;
        bufSize += resolvedPathLen;

        buf2[bufSize] = 0;
        resolvedPath = buf2[0..bufSize :0];
        resolvedPathLen = bufSize;
        resolvedAbsolute = path[0] == CHAR_FORWARD_SLASH;
    }

    // Exit early for empty path.
    if (resolvedPathLen == 0) {
        return MaybeSlice(T){ .result = comptime L(T, CHAR_STR_DOT) };
    }

    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)

    // Normalize the path
    resolvedPath = normalizeStringT(T, resolvedPath, !resolvedAbsolute, CHAR_FORWARD_SLASH, .posix, buf);
    // resolvedPath is now backed by buf.
    resolvedPathLen = resolvedPath.len;

    // Translated from the following JS code:
    //   if (resolvedAbsolute) {
    //     return `/${resolvedPath}`;
    //   }
    if (resolvedAbsolute) {
        bufSize = resolvedPathLen + 1;
        // Use bun.copy because resolvedPath and buf overlap.
        bun.copy(T, buf[1..bufSize], resolvedPath);
        buf[0] = CHAR_FORWARD_SLASH;
        buf[bufSize] = 0;
        return MaybeSlice(T){ .result = buf[0..bufSize :0] };
    }
    // Translated from the following JS code:
    //   return resolvedPath.length > 0 ? resolvedPath : '.';
    return MaybeSlice(T){ .result = if (resolvedPathLen > 0) resolvedPath else comptime L(T, CHAR_STR_DOT) };
}

/// Based on Node v21.6.1 path.win32.resolve:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L162
pub fn resolveWindowsT(comptime T: type, paths: []const []const T, buf: []T, buf2: []T) MaybeSlice(T) {
    comptime validatePathT(T, "resolveWindowsT");

    const isSepT = isSepWindowsT;
    var tmpBuf: [MAX_PATH_SIZE(T):0]T = undefined;

    // Backed by tmpBuf.
    var resolvedDevice: []const T = &.{};
    var resolvedDeviceLen: usize = 0;
    // Backed by expandable buf2 because resolvedTail may be long.
    // We use buf2 here because resolvePosixT is called by other methods and using
    // buf2 here avoids stepping on others' toes.
    var resolvedTail: []const T = &.{};
    var resolvedTailLen: usize = 0;
    var resolvedAbsolute: bool = false;

    var bufOffset: usize = 0;
    var bufSize: usize = 0;
    var envPath: ?[]const T = null;

    var i_i64: i64 = if (paths.len == 0) -1 else @as(i64, @intCast(paths.len - 1));
    while (i_i64 > -2) : (i_i64 -= 1) {
        // Backed by expandable buf2, to not conflict with buf2 backed resolvedTail,
        // because path may be long.
        var path: []const T = &.{};
        if (i_i64 >= 0) {
            path = paths[@as(usize, @intCast(i_i64))];
            // validateString of `path` is performed in pub fn resolve.

            // Skip empty paths.
            if (path.len == 0) {
                continue;
            }
        } else if (resolvedDeviceLen == 0) {
            // cwd is limited to MAX_PATH_BYTES.
            path = switch (getCwdT(T, &tmpBuf)) {
                .result => |r| r,
                .err => |e| return MaybeSlice(T){ .err = e },
            };
        } else {
            // Translated from the following JS code:
            //   path = process.env[`=${resolvedDevice}`] || process.cwd();
            if (comptime Environment.isWindows) {
                var u16Buf: bun.WPathBuffer = undefined;
                // Windows has the concept of drive-specific current working
                // directories. If we've resolved a drive letter but not yet an
                // absolute path, get cwd for that drive, or the process cwd if
                // the drive cwd is not available. We're sure the device is not
                // a UNC path at this points, because UNC paths are always absolute.

                // Translated from the following JS code:
                //   process.env[`=${resolvedDevice}`]
                const key_w: [*:0]const u16 = brk: {
                    if (resolvedDeviceLen == 2 and resolvedDevice[1] == CHAR_COLON) {
                        // Fast path for device roots
                        break :brk &[3:0]u16{ '=', resolvedDevice[0], CHAR_COLON };
                    }
                    bufSize = 1;
                    // Reuse buf2 for the env key because it's used to get the path.
                    buf2[0] = '=';
                    bufOffset = bufSize;
                    bufSize += resolvedDeviceLen;
                    bun.memmove(buf2[bufOffset..bufSize], resolvedDevice);
                    if (T == u16) {
                        break :brk buf2[0..bufSize];
                    } else {
                        bufSize = std.unicode.wtf16LeToWtf8(buf2[0..bufSize], &u16Buf);
                        break :brk u16Buf[0..bufSize :0];
                    }
                };
                // Zig's std.posix.getenvW has logic to support keys like `=${resolvedDevice}`:
                // https://github.com/ziglang/zig/blob/7bd8b35a3dfe61e59ffea39d464e84fbcdead29a/lib/std/os.zig#L2126-L2130
                //
                // TODO: Enable test once spawnResult.stdout works on Windows.
                // test/js/node/path/resolve.test.js
                if (std.process.getenvW(key_w)) |r| {
                    if (T == u16) {
                        bufSize = r.len;
                        bun.memmove(buf2[0..bufSize], r);
                    } else {
                        // Reuse buf2 because it's used for path.
                        bufSize = std.unicode.wtf16LeToWtf8(buf2, r);
                    }
                    envPath = buf2[0..bufSize];
                }
            }
            if (envPath) |_envPath| {
                path = _envPath;
            } else {
                // cwd is limited to MAX_PATH_BYTES.
                path = switch (getCwdT(T, &tmpBuf)) {
                    .result => |r| r,
                    .err => |e| return MaybeSlice(T){ .err = e },
                };
                // We must set envPath here so that it doesn't hit the null check just below.
                envPath = path;
            }

            // Verify that a cwd was found and that it actually points
            // to our drive. If not, default to the drive's root.

            // Translated from the following JS code:
            //   if (path === undefined ||
            //     (StringPrototypeToLowerCase(StringPrototypeSlice(path, 0, 2)) !==
            //     StringPrototypeToLowerCase(resolvedDevice) &&
            //     StringPrototypeCharCodeAt(path, 2) === CHAR_BACKWARD_SLASH)) {
            if (envPath == null or
                (path[2] == CHAR_BACKWARD_SLASH and
                    !eqlIgnoreCaseT(T, path[0..2], resolvedDevice)))
            {
                // Translated from the following JS code:
                //   path = `${resolvedDevice}\\`;
                bufSize = resolvedDeviceLen;
                bun.memmove(buf2[0..bufSize], resolvedDevice);
                bufOffset = bufSize;
                bufSize += 1;
                buf2[bufOffset] = CHAR_BACKWARD_SLASH;
                path = buf2[0..bufSize];
            }
        }

        const len = path.len;
        var rootEnd: usize = 0;
        // Backed by tmpBuf or an anonymous buffer.
        var device: []const T = &.{};
        // Prefix with _ to avoid shadowing the identifier in the outer scope.
        var _isAbsolute: bool = false;
        const byte0 = if (len > 0) path[0] else 0;

        // Try to match a root
        if (len == 1) {
            if (isSepT(T, byte0)) {
                // `path` contains just a path separator
                rootEnd = 1;
                _isAbsolute = true;
            }
        } else if (isSepT(T, byte0)) {
            // Possible UNC root

            // If we started with a separator, we know we at least have an
            // absolute path of some kind (UNC or otherwise)
            _isAbsolute = true;

            if (isSepT(T, path[1])) {
                // Matched double path separator at the beginning
                var j: usize = 2;
                var last: usize = j;
                // Match 1 or more non-path separators
                while (j < len and
                    !isSepT(T, path[j]))
                {
                    j += 1;
                }
                if (j < len and j != last) {
                    const firstPart = path[last..j];
                    // Matched!
                    last = j;
                    // Match 1 or more path separators
                    while (j < len and
                        isSepT(T, path[j]))
                    {
                        j += 1;
                    }
                    if (j < len and j != last) {
                        // Matched!
                        last = j;
                        // Match 1 or more non-path separators
                        while (j < len and
                            !isSepT(T, path[j]))
                        {
                            j += 1;
                        }
                        if (j == len or j != last) {
                            // We matched a UNC root

                            // Translated from the following JS code:
                            //   device =
                            //     `\\\\${firstPart}\\${StringPrototypeSlice(path, last, j)}`;
                            //   rootEnd = j;
                            bufSize = 2;
                            tmpBuf[0] = CHAR_BACKWARD_SLASH;
                            tmpBuf[1] = CHAR_BACKWARD_SLASH;
                            bufOffset = bufSize;
                            bufSize += firstPart.len;
                            bun.memmove(tmpBuf[bufOffset..bufSize], firstPart);
                            bufOffset = bufSize;
                            bufSize += 1;
                            tmpBuf[bufOffset] = CHAR_BACKWARD_SLASH;
                            const slice = path[last..j];
                            bufOffset = bufSize;
                            bufSize += slice.len;
                            bun.memmove(tmpBuf[bufOffset..bufSize], slice);

                            device = tmpBuf[0..bufSize];
                            rootEnd = j;
                        }
                    }
                }
            } else {
                rootEnd = 1;
            }
        } else if (isWindowsDeviceRootT(T, byte0) and
            path[1] == CHAR_COLON)
        {
            // Possible device root
            device = &[2]T{ byte0, CHAR_COLON };
            rootEnd = 2;
            if (len > 2 and isSepT(T, path[2])) {
                // Treat separator following the drive name as an absolute path
                // indicator
                _isAbsolute = true;
                rootEnd = 3;
            }
        }

        const deviceLen = device.len;
        if (deviceLen > 0) {
            if (resolvedDeviceLen > 0) {
                // Translated from the following JS code:
                //   if (StringPrototypeToLowerCase(device) !==
                //     StringPrototypeToLowerCase(resolvedDevice))
                if (!eqlIgnoreCaseT(T, device, resolvedDevice)) {
                    // This path points to another device, so it is not applicable
                    continue;
                }
            } else {
                // Translated from the following JS code:
                //   resolvedDevice = device;
                bufSize = device.len;
                // Copy device over if it's backed by an anonymous buffer.
                if (device.ptr != tmpBuf[0..].ptr) {
                    bun.memmove(tmpBuf[0..bufSize], device);
                }
                resolvedDevice = tmpBuf[0..bufSize];
                resolvedDeviceLen = bufSize;
            }
        }

        if (resolvedAbsolute) {
            if (resolvedDeviceLen > 0) {
                break;
            }
        } else {
            // Translated from the following JS code:
            //   resolvedTail = `${StringPrototypeSlice(path, rootEnd)}\\${resolvedTail}`;
            const sliceLen = len - rootEnd;
            if (resolvedTailLen > 0) {
                bufOffset = sliceLen + 1;
                bufSize = bufOffset + resolvedTailLen;
                // Move all bytes to the right by path slice.len + 1 for the separator
                // Use bun.copy because resolvedTail and buf2 overlap.
                bun.copy(u8, buf2[bufOffset..bufSize], resolvedTail);
            }
            bufSize = sliceLen;
            if (sliceLen > 0) {
                bun.memmove(buf2[0..bufSize], path[rootEnd..len]);
            }
            bufOffset = bufSize;
            bufSize += 1;
            buf2[bufOffset] = CHAR_BACKWARD_SLASH;
            bufSize += resolvedTailLen;

            resolvedTail = buf2[0..bufSize];
            resolvedTailLen = bufSize;
            resolvedAbsolute = _isAbsolute;

            if (_isAbsolute and resolvedDeviceLen > 0) {
                break;
            }
        }
    }

    // Exit early for empty path.
    if (resolvedTailLen == 0) {
        return MaybeSlice(T){ .result = comptime L(T, CHAR_STR_DOT) };
    }

    // At this point, the path should be resolved to a full absolute path,
    // but handle relative paths to be safe (might happen when std.process.cwdAlloc()
    // fails)

    // Normalize the tail path
    resolvedTail = normalizeStringT(T, resolvedTail, !resolvedAbsolute, CHAR_BACKWARD_SLASH, .windows, buf);
    // resolvedTail is now backed by buf.
    resolvedTailLen = resolvedTail.len;

    // Translated from the following JS code:
    //   resolvedAbsolute ? `${resolvedDevice}\\${resolvedTail}`
    if (resolvedAbsolute) {
        bufOffset = resolvedDeviceLen + 1;
        bufSize = bufOffset + resolvedTailLen;
        // Use bun.copy because resolvedTail and buf overlap.
        bun.copy(T, buf[bufOffset..bufSize], resolvedTail);
        buf[resolvedDeviceLen] = CHAR_BACKWARD_SLASH;
        bun.memmove(buf[0..resolvedDeviceLen], resolvedDevice);
        buf[bufSize] = 0;
        return MaybeSlice(T){ .result = buf[0..bufSize :0] };
    }
    // Translated from the following JS code:
    //   : `${resolvedDevice}${resolvedTail}` || '.'
    if ((resolvedDeviceLen + resolvedTailLen) > 0) {
        bufOffset = resolvedDeviceLen;
        bufSize = bufOffset + resolvedTailLen;
        // Use bun.copy because resolvedTail and buf overlap.
        bun.copy(T, buf[bufOffset..bufSize], resolvedTail);
        bun.memmove(buf[0..resolvedDeviceLen], resolvedDevice);
        buf[bufSize] = 0;
        return MaybeSlice(T){ .result = buf[0..bufSize :0] };
    }
    return MaybeSlice(T){ .result = comptime L(T, CHAR_STR_DOT) };
}

pub fn resolvePosixJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, paths: []const []const T, buf: []T, buf2: []T) bun.JSError!jsc.JSValue {
    return switch (resolvePosixT(T, paths, buf, buf2)) {
        .result => |r| bun.String.createUTF8ForJS(globalObject, r),
        .err => |e| e.toJS(globalObject),
    };
}

pub fn resolveWindowsJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, paths: []const []const T, buf: []T, buf2: []T) bun.JSError!jsc.JSValue {
    return switch (resolveWindowsT(T, paths, buf, buf2)) {
        .result => |r| bun.String.createUTF8ForJS(globalObject, r),
        .err => |e| e.toJS(globalObject),
    };
}

pub fn resolveJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, paths: []const []const T) bun.JSError!jsc.JSValue {
    // Adding 8 bytes when Windows for the possible UNC root.
    var bufLen: usize = if (isWindows) 8 else 0;
    for (paths) |path| bufLen += if (bufLen > 0 and path.len > 0) path.len + 1 else path.len;
    bufLen = @max(bufLen, PATH_SIZE(T));
    // +2 to account for separator and null terminator during path resolution
    const buf = try allocator.alloc(T, bufLen + 2);
    defer allocator.free(buf);
    const buf2 = try allocator.alloc(T, bufLen + 2);
    defer allocator.free(buf2);
    return if (isWindows) resolveWindowsJS_T(T, globalObject, paths, buf, buf2) else resolvePosixJS_T(T, globalObject, paths, buf, buf2);
}

extern "c" fn Process__getCachedCwd(*jsc.JSGlobalObject) jsc.JSValue;

pub fn resolve(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    var arena = bun.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();

    var stack_fallback = std.heap.stackFallback(stack_fallback_size_large, arena.allocator());
    const allocator = stack_fallback.get();

    var paths_buf = try allocator.alloc(string, args_len);
    defer allocator.free(paths_buf);
    var paths_offset: usize = args_len;
    var resolved_root = false;

    var i = args_len;
    while (i > 0) {
        i -= 1;

        if (resolved_root) {
            break;
        }

        const path = args_ptr[i];
        try validateString(globalObject, path, "paths[{d}]", .{i});
        const path_str = try path.toBunString(globalObject);
        defer path_str.deref();

        if (path_str.length() == 0) {
            continue;
        }

        paths_offset -= 1;
        paths_buf[paths_offset] = try path_str.toOwnedSlice(allocator);

        if (!isWindows) {
            if (path_str.charAt(0) == CHAR_FORWARD_SLASH) {
                resolved_root = true;
            }
        }
    }

    const paths = paths_buf[paths_offset..];

    if (comptime Environment.isPosix) {
        if (!isWindows) {
            // Micro-optimization #1: avoid creating a new string when passing no arguments or only empty strings.
            if (paths.len == 0) {
                return Process__getCachedCwd(globalObject);
            }

            // Micro-optimization #2: path.resolve(".") and path.resolve("./") === process.cwd()
            else if (paths.len == 1 and (strings.eqlComptime(paths[0], ".") or strings.eqlComptime(paths[0], "./"))) {
                return Process__getCachedCwd(globalObject);
            }
        }
    }

    return resolveJS_T(u8, globalObject, allocator, isWindows, paths);
}

/// Based on Node v21.6.1 path.win32.toNamespacedPath:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L622
pub fn toNamespacedPathWindowsT(comptime T: type, path: []const T, buf: []T, buf2: []T) MaybeSlice(T) {
    comptime validatePathT(T, "toNamespacedPathWindowsT");

    // validateString of `path` is performed in pub fn toNamespacedPath.
    // Backed by buf.
    const resolvedPath = switch (resolveWindowsT(T, &.{path}, buf, buf2)) {
        .result => |r| r,
        .err => |e| return MaybeSlice(T){ .err = e },
    };

    const len = resolvedPath.len;
    if (len <= 2) {
        @memcpy(buf[0..path.len], path);
        buf[path.len] = 0;
        return MaybeSlice(T){ .result = buf[0..path.len :0] };
    }

    var bufOffset: usize = 0;
    var bufSize: usize = 0;

    const byte0 = resolvedPath[0];
    if (byte0 == CHAR_BACKWARD_SLASH) {
        // Possible UNC root
        if (resolvedPath[1] == CHAR_BACKWARD_SLASH) {
            const byte2 = resolvedPath[2];
            if (byte2 != CHAR_QUESTION_MARK and byte2 != CHAR_DOT) {
                // Matched non-long UNC root, convert the path to a long UNC path

                // Translated from the following JS code:
                //   return `\\\\?\\UNC\\${StringPrototypeSlice(resolvedPath, 2)}`;
                bufOffset = 6;
                bufSize = len + 6;
                // Move all bytes to the right by 6 so that the first two bytes are
                // overwritten by "\\\\?\\UNC\\" which is 8 bytes long.
                // Use bun.copy because resolvedPath and buf overlap.
                bun.copy(T, buf[bufOffset..bufSize], resolvedPath);
                // Equiv to std.os.windows.NamespacePrefix.verbatim
                // https://github.com/ziglang/zig/blob/dcaf43674e35372e1d28ab12c4c4ff9af9f3d646/lib/std/os/windows.zig#L2358-L2374
                buf[0] = CHAR_BACKWARD_SLASH;
                buf[1] = CHAR_BACKWARD_SLASH;
                buf[2] = CHAR_QUESTION_MARK;
                buf[3] = CHAR_BACKWARD_SLASH;
                buf[4] = 'U';
                buf[5] = 'N';
                buf[6] = 'C';
                buf[7] = CHAR_BACKWARD_SLASH;
                buf[bufSize] = 0;
                return MaybeSlice(T){ .result = buf[0..bufSize :0] };
            }
        }
    } else if (isWindowsDeviceRootT(T, byte0) and
        resolvedPath[1] == CHAR_COLON and
        resolvedPath[2] == CHAR_BACKWARD_SLASH)
    {
        // Matched device root, convert the path to a long UNC path

        // Translated from the following JS code:
        //   return `\\\\?\\${resolvedPath}`
        bufOffset = 4;
        bufSize = len + 4;
        // Move all bytes to the right by 4
        // Use bun.copy because resolvedPath and buf overlap.
        bun.copy(T, buf[bufOffset..bufSize], resolvedPath);
        // Equiv to std.os.windows.NamespacePrefix.verbatim
        // https://github.com/ziglang/zig/blob/dcaf43674e35372e1d28ab12c4c4ff9af9f3d646/lib/std/os/windows.zig#L2358-L2374
        buf[0] = CHAR_BACKWARD_SLASH;
        buf[1] = CHAR_BACKWARD_SLASH;
        buf[2] = CHAR_QUESTION_MARK;
        buf[3] = CHAR_BACKWARD_SLASH;
        buf[bufSize] = 0;
        return MaybeSlice(T){ .result = buf[0..bufSize :0] };
    }
    return MaybeSlice(T){ .result = resolvedPath };
}

pub fn toNamespacedPathWindowsJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, path: []const T, buf: []T, buf2: []T) bun.JSError!jsc.JSValue {
    return switch (toNamespacedPathWindowsT(T, path, buf, buf2)) {
        .result => |r| bun.String.createUTF8ForJS(globalObject, r),
        .err => |e| e.toJS(globalObject),
    };
}

pub fn toNamespacedPathJS_T(comptime T: type, globalObject: *jsc.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, path: []const T) bun.JSError!jsc.JSValue {
    if (!isWindows or path.len == 0) return bun.String.createUTF8ForJS(globalObject, path);
    const bufLen = @max(path.len, PATH_SIZE(T));
    // +8 for possible UNC prefix, +1 for null terminator
    const buf = try allocator.alloc(T, bufLen + 8 + 1);
    defer allocator.free(buf);
    const buf2 = try allocator.alloc(T, bufLen + 8 + 1);
    defer allocator.free(buf2);
    return toNamespacedPathWindowsJS_T(T, globalObject, path, buf, buf2);
}

pub fn toNamespacedPath(globalObject: *jsc.JSGlobalObject, isWindows: bool, args_ptr: [*]jsc.JSValue, args_len: u16) bun.JSError!jsc.JSValue {
    if (args_len == 0) return .js_undefined;
    var path_ptr = args_ptr[0];

    // Based on Node v21.6.1 path.win32.toNamespacedPath and path.posix.toNamespacedPath:
    // https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L624
    // https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1269
    //
    // Act as an identity function for non-string values and non-Windows platforms.
    if (!isWindows or !path_ptr.isString()) return path_ptr;
    const pathZStr = try path_ptr.getZigString(globalObject);
    const len = pathZStr.len;
    if (len == 0) return path_ptr;

    var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, bun.default_allocator);
    const allocator = stack_fallback.get();

    const pathZSlice = pathZStr.toSlice(allocator);
    defer pathZSlice.deinit();
    return toNamespacedPathJS_T(u8, globalObject, allocator, isWindows, pathZSlice.slice());
}

comptime {
    @export(&bun.jsc.host_fn.wrap4v(Path.basename), .{ .name = "Bun__Path__basename" });
    @export(&bun.jsc.host_fn.wrap4v(Path.dirname), .{ .name = "Bun__Path__dirname" });
    @export(&bun.jsc.host_fn.wrap4v(Path.extname), .{ .name = "Bun__Path__extname" });
    @export(&bun.jsc.host_fn.wrap4v(Path.format), .{ .name = "Bun__Path__format" });
    @export(&bun.jsc.host_fn.wrap4v(Path.isAbsolute), .{ .name = "Bun__Path__isAbsolute" });
    @export(&bun.jsc.host_fn.wrap4v(Path.join), .{ .name = "Bun__Path__join" });
    @export(&bun.jsc.host_fn.wrap4v(Path.normalize), .{ .name = "Bun__Path__normalize" });
    @export(&bun.jsc.host_fn.wrap4v(Path.parse), .{ .name = "Bun__Path__parse" });
    @export(&bun.jsc.host_fn.wrap4v(Path.relative), .{ .name = "Bun__Path__relative" });
    @export(&bun.jsc.host_fn.wrap4v(Path.resolve), .{ .name = "Bun__Path__resolve" });
    @export(&bun.jsc.host_fn.wrap4v(Path.toNamespacedPath), .{ .name = "Bun__Path__toNamespacedPath" });
}

const string = []const u8;

const std = @import("std");

const validators = @import("./util/validators.zig");
const validateObject = validators.validateObject;
const validateString = validators.validateString;

const bun = @import("bun");
const Environment = bun.Environment;
const Syscall = bun.sys;
const jsc = bun.jsc;
const windows = bun.windows;
const typeBaseNameT = bun.meta.typeBaseNameT;

const strings = bun.strings;
const L = strings.literal;
