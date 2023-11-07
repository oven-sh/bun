const std = @import("std");
const bun = @import("root").bun;

fn isValid(buf: *bun.PathBuffer, segment: []const u8, bin: []const u8) ?u16 {
    bun.copy(u8, buf, segment);
    buf[segment.len] = std.fs.path.sep;
    bun.copy(u8, buf[segment.len + 1 ..], bin);
    buf[segment.len + 1 + bin.len ..][0] = 0;
    const filepath = buf[0 .. segment.len + 1 + bin.len :0];
    if (!bun.sys.isExecutableFilePath(filepath)) return null;
    return @as(u16, @intCast(filepath.len));
}

// Like /usr/bin/which but without needing to exec a child process
// Remember to resolve the symlink if necessary
pub fn which(buf: *bun.PathBuffer, path: []const u8, cwd: []const u8, bin: []const u8) ?[:0]const u8 {
    if (bun.Environment.os == .windows) {
        var convert_buf: bun.WPathBuffer = undefined;
        const result = whichWin(&convert_buf, path, cwd, bin) orelse return null;
        const result_converted = bun.strings.convertUTF16toUTF8InBuffer(buf, result) catch unreachable;
        buf[result_converted.len] = 0;
        std.debug.assert(result_converted.ptr == buf.ptr);
        return buf[0..result_converted.len :0];
    }
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

const win_extensionsW = .{
    bun.strings.w("exe"),
    bun.strings.w("cmd"),
    bun.strings.w("bat"),
};
const win_extensions = .{ "exe", "cmd", "bat" };

pub fn endsWithExtension(str: []const u8) bool {
    if (str.len < 4) return false;
    if (str[str.len - 4] != '.') return false;
    const file_ext = str[str.len - 3 ..];
    inline for (win_extensions) |ext| {
        comptime std.debug.assert(ext.len == 3);
        if (bun.strings.eqlComptimeCheckLenWithType(u8, file_ext, ext, false)) return true;
    }
    return false;
}

/// This is the windows version of `which`.
/// It operates on wide strings.
/// It is similar to Get-Command in powershell.
pub fn whichWin(buf: *bun.WPathBuffer, path: []const u8, cwd: []const u8, bin: []const u8) ?[:0]const u16 {
    _ = cwd;
    if (bin.len == 0) return null;

    // handle absolute paths
    if (std.fs.path.isAbsolute(bin)) {
        const bin_utf16 = bun.strings.convertUTF8toUTF16InBuffer(buf, bin);
        if (endsWithExtension(bin)) {
            buf[bin_utf16.len] = 0;
            if (bun.sys.existsOSPath(buf[0..bin.len :0]))
                return buf[0..bin.len :0];
        }
        buf[bin_utf16.len] = '.';
        buf[bin_utf16.len + 1 + 3] = 0;
        inline for (win_extensionsW) |ext| {
            @memcpy(buf[bin.len + 1 .. bin_utf16.len + 1 + ext.len], ext);
            if (bun.sys.existsOSPath(buf[0 .. bin.len + 1 + ext.len :0]))
                return buf[0 .. bin.len + 1 + ext.len :0];
        }
        return null;
    }

    // TODO: cwd. This snippet does not work yet.
    // if (cwd.len > 0) {
    //     const cwd_utf16 = bun.strings.convertUTF8toUTF16InBuffer(buf, cwd);
    //     const bin_utf16 = bun.strings.convertUTF8toUTF16InBuffer(buf[cwd_utf16.len + 1 ..], bin);
    //     if (endsWithExtension(bin)) {
    //         buf[cwd_utf16.len + 1 + bin_utf16.len] = 0;
    //         if (bun.sys.existsOSPath(buf[0 .. cwd_utf16.len + 1 + bin_utf16.len :0]))
    //             return buf[0 .. cwd_utf16.len + 1 + bin_utf16.len :0];
    //     }
    //     buf[cwd_utf16.len + 1 + bin_utf16.len] = '.';
    //     buf[cwd_utf16.len + 1 + bin_utf16.len + 1 + 3] = 0;
    //     inline for (win_extensionsW) |ext| {
    //         @memcpy(buf[cwd_utf16.len + 1 + bin_utf16.len + 1 .. cwd_utf16.len + 1 + bin_utf16.len + 1 + 3], ext);
    //         if (bun.sys.existsOSPath(buf[0 .. cwd_utf16.len + 1 + bin_utf16.len + 1 + ext.len :0]))
    //             return buf[0 .. cwd_utf16.len + 1 + bin_utf16.len + 1 + ext.len :0];
    //     }
    // }

    const check_without_append_ext = endsWithExtension(bin);
    var path_iter = std.mem.tokenizeScalar(u8, path, std.fs.path.delimiter);
    while (path_iter.next()) |segment| {
        const segment_utf16 = bun.strings.convertUTF8toUTF16InBuffer(buf, segment);
        buf[segment.len] = std.fs.path.sep;
        const bin_utf16 = bun.strings.convertUTF8toUTF16InBuffer(buf[segment.len + 1 ..], bin);
        if (check_without_append_ext) {
            buf[segment_utf16.len + 1 + bin_utf16.len] = 0;
            if (bun.sys.existsOSPath(buf[0 .. segment_utf16.len + 1 + bin_utf16.len :0]))
                return buf[0 .. segment_utf16.len + 1 + bin_utf16.len :0];
        }
        buf[segment_utf16.len + 1 + bin_utf16.len] = '.';
        buf[segment_utf16.len + 1 + bin_utf16.len + 1 + 3] = 0;
        inline for (win_extensionsW) |ext| {
            @memcpy(buf[segment_utf16.len + 1 + bin_utf16.len + 1 .. segment_utf16.len + 1 + bin_utf16.len + 1 + 3], ext);
            if (bun.sys.existsOSPath(buf[0 .. segment_utf16.len + 1 + bin_utf16.len + 1 + ext.len :0]))
                return buf[0 .. segment_utf16.len + 1 + bin_utf16.len + 1 + ext.len :0];
        }
    }

    return null;
}

test "which" {
    var buf: bun.fs.PathBuffer = undefined;
    var realpath = bun.getenvZ("PATH") orelse unreachable;
    var whichbin = which(&buf, realpath, try bun.getcwdAlloc(std.heap.c_allocator), "which");
    try std.testing.expectEqualStrings(whichbin orelse return std.debug.assert(false), "/usr/bin/which");
    try std.testing.expect(null == which(&buf, realpath, try bun.getcwdAlloc(std.heap.c_allocator), "baconnnnnn"));
    try std.testing.expect(null != which(&buf, realpath, try bun.getcwdAlloc(std.heap.c_allocator), "zig"));
    try std.testing.expect(null == which(&buf, realpath, try bun.getcwdAlloc(std.heap.c_allocator), "bin"));
    try std.testing.expect(null == which(&buf, realpath, try bun.getcwdAlloc(std.heap.c_allocator), "usr"));
}
