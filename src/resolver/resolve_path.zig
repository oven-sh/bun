const tester = @import("../test/tester.zig");

const std = @import("std");

threadlocal var parser_join_input_buffer: [1024]u8 = undefined;
threadlocal var parser_buffer: [1024]u8 = undefined;

// This function is based on Node.js' path.normalize function.
// https://github.com/nodejs/node/blob/36bb31be5f0b85a0f6cbcb36b64feb3a12c60984/lib/path.js#L66
pub fn normalizeStringGeneric(str: []const u8, buf: []u8, comptime allow_above_root: bool, comptime separator: u8, comptime isPathSeparator: anytype, lastIndexOfSeparator: anytype) []u8 {
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

                const slice = str[@intCast(usize, @intCast(usize, last_slash + 1))..i];
                std.mem.copy(u8, buf[written_len .. written_len + slice.len], slice);
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

    return buf[0..written_len];
}

pub const Platform = enum {
    auto,
    loose,
    windows,
    posix,

    pub fn isSeparator(comptime _platform: Platform, char: u8) bool {
        const platform = _platform.resolve();
        switch (platform) {
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
        switch (_platform.resolve()) {
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
        if (_platform == .auto) {
            switch (std.Target.current.os.tag) {
                .windows => {
                    return .windows;
                },

                .freestanding, .emscripten, .other => {
                    return .loose;
                },

                else => {
                    return .posix;
                },
            }
        }

        return _platform;
    }
};

pub fn normalizeString(str: []const u8, comptime allow_above_root: bool, comptime _platform: Platform) []u8 {
    return normalizeStringBuf(str, &parser_buffer, allow_above_root, _platform);
}

pub fn normalizeStringBuf(str: []const u8, buf: []u8, comptime allow_above_root: bool, comptime _platform: Platform) []u8 {
    comptime const platform = _platform.resolve();

    switch (platform) {
        .auto => unreachable,

        .windows => {
            return normalizeStringWindowsBuf(str, buf, allow_above_root);
        },
        .posix => {
            return normalizeStringPosixBuf(str, buf, allow_above_root);
        },

        .loose => {
            return normalizeStringLooseBuf(str, buf, allow_above_root);
        },
    }
}

pub fn normalizeStringAlloc(allocator: *std.mem.Allocator, str: []const u8, comptime allow_above_root: bool, comptime _platform: Platform) ![]const u8 {
    return try allocator.dupe(u8, normalizeString(str, allow_above_root, _platform));
}

pub fn normalizeAndJoin2(_cwd: []const u8, comptime _platform: Platform, part: anytype, part2: anytype) []const u8 {
    const parts = [_][]const u8{ part, part2 };
    const slice = normalizeAndJoinString(_cwd, &parts, _platform);
    return slice;
}

pub fn normalizeAndJoin(_cwd: []const u8, comptime _platform: Platform, part: anytype) []const u8 {
    const parts = [_][]const u8{
        part,
    };
    const slice = normalizeAndJoinString(_cwd, &parts, _platform);
    return slice;
}

// Convert parts of potentially invalid file paths into a single valid filpeath
// without querying the filesystem
// This is the equivalent of
pub fn normalizeAndJoinString(_cwd: []const u8, parts: anytype, comptime _platform: Platform) []const u8 {
    return normalizeAndJoinStringBuf(_cwd, &parser_join_input_buffer, parts, _platform);
}

pub fn normalizeAndJoinStringBuf(_cwd: []const u8, buf: []u8, parts: anytype, comptime _platform: Platform) []const u8 {
    if (parts.len == 0) {
        return _cwd;
    }

    if ((_platform == .loose or _platform == .posix) and parts.len == 1 and parts[0].len == 1 and parts[0] == std.fs.path.sep_posix) {
        return "/";
    }

    var cwd = _cwd;
    var out: usize = 0;
    // When parts[0] is absolute, we treat that as, effectively, the cwd
    var ignore_cwd = cwd.len == 0;

    // Windows leading separators can be a lot of things...
    // So we need to do this instead of just checking the first char.
    var leading_separator: []const u8 = "";
    if (_platform.leadingSeparatorIndex(parts[0])) |leading_separator_i| {
        leading_separator = parts[0][0 .. leading_separator_i + 1];
        ignore_cwd = true;
    }

    if (!ignore_cwd) {
        leading_separator = cwd[0 .. 1 + (_platform.leadingSeparatorIndex(_cwd) orelse unreachable)]; // cwd must be absolute
        cwd = _cwd[leading_separator.len..cwd.len];
        out = cwd.len;
        std.debug.assert(out < buf.len);
        std.mem.copy(u8, buf[0..out], cwd);
    }

    for (parts) |part, i| {
        // This never returns leading separators.
        var normalized_part = normalizeString(part, true, _platform);
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

        const start = out;
        out += normalized_part.len;
        std.debug.assert(out < buf.len);
        std.mem.copy(u8, buf[start..out], normalized_part);
    }

    // One last normalization, to remove any ../ added
    const result = normalizeStringBuf(buf[0..out], parser_buffer[leading_separator.len..parser_buffer.len], false, _platform);
    std.mem.copy(u8, buf[0..leading_separator.len], leading_separator);
    std.mem.copy(u8, buf[leading_separator.len .. result.len + leading_separator.len], result);

    return buf[0 .. result.len + leading_separator.len];
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

pub fn normalizeStringPosix(str: []const u8, comptime allow_above_root: bool) []u8 {
    return normalizeStringGenericBuf(str, &parser_buffer, allow_above_root, std.fs.path.sep_posix, isSepPosix, lastIndexOfSeparatorPosix);
}

pub fn normalizeStringPosixBuf(str: []const u8, buf: []u8, comptime allow_above_root: bool) []u8 {
    return normalizeStringGeneric(str, buf, allow_above_root, std.fs.path.sep_posix, isSepPosix, lastIndexOfSeparatorPosix);
}

pub fn normalizeStringWindows(str: []const u8, comptime allow_above_root: bool) []u8 {
    return normalizeStringGenericBuf(str, &parser_buffer, allow_above_root, std.fs.path.sep_windows, isSepWin32, lastIndexOfSeparatorWindows);
}

pub fn normalizeStringWindowsBuf(str: []const u8, buf: []u8, comptime allow_above_root: bool) []u8 {
    return normalizeStringGeneric(str, buf, allow_above_root, std.fs.path.sep_windows, isSepWin32, lastIndexOfSeparatorWindows);
}

pub fn normalizeStringLoose(str: []const u8, comptime allow_above_root: bool) []u8 {
    return normalizeStringGenericBuf(str, &parser_buffer, allow_above_root, std.fs.path.sep_posix, isSepAny, lastIndexOfSeparatorLoose);
}

pub fn normalizeStringLooseBuf(str: []const u8, buf: []u8, comptime allow_above_root: bool) []u8 {
    return normalizeStringGeneric(str, buf, allow_above_root, std.fs.path.sep_posix, isSepAny, lastIndexOfSeparatorLoose);
}

test "normalizeAndJoinStringPosix" {
    var t = tester.Tester.t(std.heap.c_allocator);
    defer t.report(@src());
    const string = []const u8;
    const cwd = "/Users/jarredsumner/Code/app";

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/bar/file.js",
        normalizeAndJoinString(cwd, [_]string{ "foo", "bar", "file.js" }, .posix),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "foo", "bar", "../file.js" }, .posix),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "foo", "./bar", "../file.js" }, .posix),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "././././foo", "././././bar././././", "../file.js" }, .posix),
        @src(),
    );
    _ = t.expect(
        "/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "/Code/app", "././././foo", "././././bar././././", "../file.js" }, .posix),
        @src(),
    );

    _ = t.expect(
        "/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "/Code/app", "././././foo", ".", "././././bar././././", ".", "../file.js" }, .posix),
        @src(),
    );

    _ = t.expect(
        "/Code/app/file.js",
        normalizeAndJoinString(cwd, [_]string{ "/Code/app", "././././foo", "..", "././././bar././././", ".", "../file.js" }, .posix),
        @src(),
    );
}

test "normalizeAndJoinStringLoose" {
    var t = tester.Tester.t(std.heap.c_allocator);
    defer t.report(@src());
    const string = []const u8;
    const cwd = "/Users/jarredsumner/Code/app";

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/bar/file.js",
        normalizeAndJoinString(cwd, [_]string{ "foo", "bar", "file.js" }, .loose),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "foo", "bar", "../file.js" }, .loose),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "foo", "./bar", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "././././foo", "././././bar././././", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "/Code/app", "././././foo", "././././bar././././", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "/Code/app", "././././foo", ".", "././././bar././././", ".", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/file.js",
        normalizeAndJoinString(cwd, [_]string{ "/Code/app", "././././foo", "..", "././././bar././././", ".", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/bar/file.js",
        normalizeAndJoinString(cwd, [_]string{ "foo", "bar", "file.js" }, .loose),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "foo", "bar", "../file.js" }, .loose),
        @src(),
    );
    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "foo", "./bar", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Users/jarredsumner/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ ".\\.\\.\\.\\foo", "././././bar././././", "..\\file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "/Code/app", "././././foo", "././././bar././././", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/foo/file.js",
        normalizeAndJoinString(cwd, [_]string{ "/Code/app", "././././foo", ".", "././././bar././././", ".", "../file.js" }, .loose),
        @src(),
    );

    _ = t.expect(
        "/Code/app/file.js",
        normalizeAndJoinString(cwd, [_]string{ "/Code/app", "././././foo", "..", "././././bar././././", ".", "../file.js" }, .loose),
        @src(),
    );
}

test "normalizeStringPosix" {
    var t = tester.Tester.t(std.heap.c_allocator);
    defer t.report(@src());

    // Don't mess up strings that
    _ = t.expect("foo/bar.txt", try normalizeStringAlloc(std.heap.c_allocator, "/foo/bar.txt", true, .posix), @src());
    _ = t.expect("foo/bar.txt", try normalizeStringAlloc(std.heap.c_allocator, "/foo/bar.txt", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(std.heap.c_allocator, "/foo/bar", true, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(std.heap.c_allocator, "/foo/bar", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(std.heap.c_allocator, "/././foo/././././././bar/../bar/../bar", true, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(std.heap.c_allocator, "/foo/bar", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(std.heap.c_allocator, "/foo/bar//////", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(std.heap.c_allocator, "/////foo/bar//////", false, .posix), @src());
    _ = t.expect("foo/bar", try normalizeStringAlloc(std.heap.c_allocator, "/////foo/bar", false, .posix), @src());
    _ = t.expect("", try normalizeStringAlloc(std.heap.c_allocator, "/////", false, .posix), @src());
    _ = t.expect("..", try normalizeStringAlloc(std.heap.c_allocator, "../boom/../", true, .posix), @src());
    _ = t.expect("", try normalizeStringAlloc(std.heap.c_allocator, "./", true, .posix), @src());
}

test "normalizeStringWindows" {
    var t = tester.Tester.t(std.heap.c_allocator);
    defer t.report(@src());

    // Don't mess up strings that
    _ = t.expect("foo\\bar.txt", try normalizeStringAlloc(std.heap.c_allocator, "\\foo\\bar.txt", true, .windows), @src());
    _ = t.expect("foo\\bar.txt", try normalizeStringAlloc(std.heap.c_allocator, "\\foo\\bar.txt", false, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(std.heap.c_allocator, "\\foo\\bar", true, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(std.heap.c_allocator, "\\foo\\bar", false, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(std.heap.c_allocator, "\\.\\.\\foo\\.\\.\\.\\.\\.\\.\\bar\\..\\bar\\..\\bar", true, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(std.heap.c_allocator, "\\foo\\bar", false, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(std.heap.c_allocator, "\\foo\\bar\\\\\\\\\\\\", false, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(std.heap.c_allocator, "\\\\\\\\\\foo\\bar\\\\\\\\\\\\", false, .windows), @src());
    _ = t.expect("foo\\bar", try normalizeStringAlloc(std.heap.c_allocator, "\\\\\\\\\\foo\\bar", false, .windows), @src());
    _ = t.expect("", try normalizeStringAlloc(std.heap.c_allocator, "\\\\\\\\\\", false, .windows), @src());
    _ = t.expect("..", try normalizeStringAlloc(std.heap.c_allocator, "..\\boom\\..\\", true, .windows), @src());
    _ = t.expect("", try normalizeStringAlloc(std.heap.c_allocator, ".\\", true, .windows), @src());
}
