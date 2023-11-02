const std = @import("std");
const bun = @import("root").bun;

fn isValid(buf: *[bun.MAX_PATH_BYTES]u8, segment: []const u8, bin: []const u8) ?u16 {
    @memcpy(buf[0..segment.len], segment);
    buf[segment.len] = std.fs.path.sep;
    @memcpy(buf[segment.len + 1 .. segment.len + 1 + bin.len], bin);

    if (!bun.Environment.isWindows) {
        buf[segment.len + 1 + bin.len] = 0;
        const filepath = buf[0 .. segment.len + 1 + bin.len :0];
        if (!bun.sys.isExecutableFilePath(filepath)) return null;
        return @as(u16, @intCast(filepath.len));
    } else {
        buf[segment.len + 1 + bin.len] = '.';
        inline for (.{ "cmd", "exe", "bat" }) |ext| {
            @memcpy(buf[segment.len + 1 + bin.len + 1 .. segment.len + 1 + bin.len + 1 + ext.len], ext);
            buf[segment.len + 1 + bin.len + 1 + ext.len] = 0;
            const filepath = buf[0 .. segment.len + 1 + bin.len + 1 + ext.len :0];
            if (bun.sys.isExecutableFilePath(filepath))
                return @as(u16, @intCast(filepath.len));
        }
        return null;
    }
}

// Like /usr/bin/which but without needing to exec a child process
// Remember to resolve the symlink if necessary
pub fn which(buf: *[bun.MAX_PATH_BYTES]u8, path: []const u8, cwd: []const u8, bin: []const u8) ?[:0]const u8 {
    if (bin.len == 0) return null;

    // handle absolute paths
    if (std.fs.path.isAbsolute(bin)) {
        bun.copy(u8, buf, bin);
        buf[bin.len] = 0;
        var binZ: [:0]u8 = buf[0..bin.len :0];
        if (bun.sys.isExecutableFilePath(binZ)) return binZ;

        // note that directories are often executable
        // TODO: should we return null here? What about the case where ytou have
        //   /foo/bar/baz as a path and you're in /home/jarred?
    }

    if (cwd.len > 0) {
        if (isValid(buf, std.mem.trimRight(u8, cwd, std.fs.path.sep_str), bin)) |len| {
            return buf[0..len :0];
        }
    }

    var path_iter = std.mem.tokenizeScalar(u8, path, std.fs.path.delimiter);
    while (path_iter.next()) |segment| {
        if (isValid(buf, segment, bin)) |len| {
            return buf[0..len :0];
        }
    }

    return null;
}

test "which" {
    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    var realpath = bun.getenvZ("PATH") orelse unreachable;
    var whichbin = which(&buf, realpath, try bun.getcwdAlloc(std.heap.c_allocator), "which");
    try std.testing.expectEqualStrings(whichbin orelse return std.debug.assert(false), "/usr/bin/which");
    try std.testing.expect(null == which(&buf, realpath, try bun.getcwdAlloc(std.heap.c_allocator), "baconnnnnn"));
    try std.testing.expect(null != which(&buf, realpath, try bun.getcwdAlloc(std.heap.c_allocator), "zig"));
    try std.testing.expect(null == which(&buf, realpath, try bun.getcwdAlloc(std.heap.c_allocator), "bin"));
    try std.testing.expect(null == which(&buf, realpath, try bun.getcwdAlloc(std.heap.c_allocator), "usr"));
}
