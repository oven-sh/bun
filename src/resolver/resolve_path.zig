// https://github.com/MasterQ32/ftz/blob/3183b582211f8e38c1c3363c56753026ca45c11f/src/main.zig#L431-L509
// Thanks, Felix!  We should get this into std perhaps.

const std = @import("std");

/// Resolves a unix-like path and removes all "." and ".." from it. Will not escape the root and can be used to sanitize inputs.
pub fn resolvePath(buffer: []u8, src_path: []const u8) ?[]u8 {
    var end: usize = 0;
    buffer[0] = '.';

    var iter = std.mem.tokenize(src_path, "/");
    while (iter.next()) |segment| {
        if (end >= buffer.len) break;

        if (std.mem.eql(u8, segment, ".")) {
            continue;
        } else if (std.mem.eql(u8, segment, "..")) {
            while (true) {
                if (end == 0)
                    break;
                if (buffer[end] == '/') {
                    break;
                }
                end -= 1;
            }
        } else {
            if (end + segment.len + 1 > buffer.len)
                return null;

            const start = end;
            buffer[end] = '/';
            end += segment.len + 1;
            std.mem.copy(u8, buffer[start + 1 .. end], segment);
        }
    }

    const result = if (end == 0)
        buffer[0 .. end + 1]
    else
        buffer[0..end];

    if (std.mem.eql(u8, result, src_path)) {
        return null;
    }

    return result;
}

fn testResolve(expected: []const u8, input: []const u8) !void {
    var buffer: [1024]u8 = undefined;

    const actual = try resolvePath(&buffer, input);
    std.testing.expectEqualStrings(expected, actual);
}

test "resolvePath" {
    try testResolve("/", "");
    try testResolve("/", "/");
    try testResolve("/", "////////////");

    try testResolve("/a", "a");
    try testResolve("/a", "/a");
    try testResolve("/a", "////////////a");
    try testResolve("/a", "////////////a///");

    try testResolve("/a/b/c/d", "/a/b/c/d");

    try testResolve("/a/b/d", "/a/b/c/../d");

    try testResolve("/", "..");
    try testResolve("/", "/..");
    try testResolve("/", "/../../../..");
    try testResolve("/a/b/c", "a/b/c/");

    try testResolve("/new/date.txt", "/new/../../new/date.txt");
}

test "resolvePath overflow" {
    var buf: [1]u8 = undefined;

    std.testing.expectEqualStrings("/", try resolvePath(&buf, "/"));
    std.testing.expectError(error.BufferTooSmall, resolvePath(&buf, "a")); // will resolve to "/a"
}
