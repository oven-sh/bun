const std = @import("std");
const bun = @import("global");

fn isValid(buf: *[bun.MAX_PATH_BYTES]u8, segment: []const u8, bin: []const u8) ?u16 {
    std.mem.copy(u8, buf, segment);
    buf[segment.len] = std.fs.path.sep;
    std.mem.copy(u8, buf[segment.len + 1 ..], bin);
    buf[segment.len + 1 + bin.len ..][0] = 0;
    const filepath = buf[0 .. segment.len + 1 + bin.len :0];
    // we cannot use access() here even though all we want to do now here is check it is executable
    // directories can be considered executable
    std.os.accessZ(filepath, std.os.X_OK) catch return null;
    return @intCast(u16, filepath.len);
}

// Like /usr/bin/which but without needing to exec a child process
// Remember to resolve the symlink if necessary
pub fn which(buf: *[bun.MAX_PATH_BYTES]u8, path: []const u8, cwd: []const u8, bin: []const u8) ?[:0]const u8 {
    if (isValid(buf, std.mem.trimRight(u8, cwd, std.fs.path.sep_str), bin)) |len| {
        return buf[0..len :0];
    }

    var path_iter = std.mem.tokenize(u8, path, ":");
    while (path_iter.next()) |segment| {
        if (isValid(buf, segment, bin)) |len| {
            return buf[0..len :0];
        }
    }

    return null;
}

test "which" {
    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    var realpath = std.os.getenv("PATH") orelse unreachable;
    var whichbin = which(&buf, realpath, try std.process.getCwdAlloc(std.heap.c_allocator), "which");
    try std.testing.expectEqualStrings(whichbin orelse return std.debug.assert(false), "/usr/bin/which");
    try std.testing.expect(null == which(&buf, realpath, try std.process.getCwdAlloc(std.heap.c_allocator), "baconnnnnn"));
    try std.testing.expect(null != which(&buf, realpath, try std.process.getCwdAlloc(std.heap.c_allocator), "zig"));
    try std.testing.expect(null == which(&buf, realpath, try std.process.getCwdAlloc(std.heap.c_allocator), "bin"));
    try std.testing.expect(null == which(&buf, realpath, try std.process.getCwdAlloc(std.heap.c_allocator), "usr"));
}
