const std = @import("std");
const bun = @import("root").bun;
const PosixToWinNormalizer = bun.path.PosixToWinNormalizer;

fn isValid(buf: *bun.PathBuffer, segment: []const u8, bin: []const u8) ?u16 {
    if (segment.len + 1 + bin.len > bun.MAX_PATH_BYTES) return null;
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
    if (bin.len > bun.MAX_PATH_BYTES) return null;
    bun.Output.scoped(.which, true)("path={s} cwd={s} bin={s}", .{ path, cwd, bin });

    if (bun.Environment.os == .windows) {
        var convert_buf: bun.WPathBuffer = undefined;
        const result = whichWin(&convert_buf, path, cwd, bin) orelse return null;
        const result_converted = bun.strings.convertUTF16toUTF8InBuffer(buf, result) catch unreachable;
        buf[result_converted.len] = 0;
        bun.assert(result_converted.ptr == buf.ptr);
        return buf[0..result_converted.len :0];
    }

    if (bin.len == 0) return null;

    // handle absolute paths
    if (std.fs.path.isAbsolute(bin)) {
        bun.copy(u8, buf, bin);
        buf[bin.len] = 0;
        const binZ: [:0]u8 = buf[0..bin.len :0];
        if (bun.sys.isExecutableFilePath(binZ)) return binZ;
        // Do not look absolute paths in $PATH
        return null;
    }

    if (bun.strings.containsChar(bin, '/')) {
        if (cwd.len > 0) {
            if (isValid(
                buf,
                std.mem.trimRight(u8, cwd, std.fs.path.sep_str),
                bun.strings.withoutPrefixComptime(bin, "./"),
            )) |len| {
                return buf[0..len :0];
            }
        }
        // Do not lookup paths with slashes in $PATH
        return null;
    }

    var path_iter = std.mem.tokenizeScalar(u8, path, std.fs.path.delimiter);
    while (path_iter.next()) |segment| {
        if (isValid(buf, segment, bin)) |len| {
            return buf[0..len :0];
        }
    }

    return null;
}

const win_extensionsW = [_][:0]const u16{
    bun.strings.w("exe"),
    bun.strings.w("cmd"),
    bun.strings.w("bat"),
};
const win_extensions = .{
    "exe",
    "cmd",
    "bat",
};

pub fn endsWithExtension(str: []const u8) bool {
    if (str.len < 4) return false;
    if (str[str.len - 4] != '.') return false;
    const file_ext = str[str.len - 3 ..];
    inline for (win_extensions) |ext| {
        comptime bun.assert(ext.len == 3);
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(file_ext, ext)) return true;
    }
    return false;
}

/// Check if the WPathBuffer holds a existing file path, checking also for windows extensions variants like .exe, .cmd and .bat (internally used by whichWin)
fn searchBin(buf: *bun.WPathBuffer, path_size: usize, check_windows_extensions: bool) ?[:0]u16 {
    if (!check_windows_extensions)
        // On Windows, files without extensions are not executable
        // Therefore, we should only care about this check when the file already has an extension.
        if (bun.sys.existsOSPath(buf[0..path_size :0], true))
            return buf[0..path_size :0];

    if (check_windows_extensions) {
        buf[path_size] = '.';
        buf[path_size + 1 + 3] = 0;
        inline for (win_extensionsW) |ext| {
            @memcpy(buf[path_size + 1 .. path_size + 1 + 3], ext);
            if (bun.sys.existsOSPath(buf[0 .. path_size + 1 + ext.len :0], true))
                return buf[0 .. path_size + 1 + ext.len :0];
        }
    }
    return null;
}

/// Check if bin file exists in this path (internally used by whichWin)
fn searchBinInPath(buf: *bun.WPathBuffer, path_buf: *bun.PathBuffer, path: []const u8, bin: []const u8, check_windows_extensions: bool) ?[:0]u16 {
    if (path.len == 0) return null;
    const segment = if (std.fs.path.isAbsolute(path)) (PosixToWinNormalizer.resolveCWDWithExternalBuf(path_buf, path) catch return null) else path;
    const segment_utf16 = bun.strings.convertUTF8toUTF16InBuffer(buf, segment);

    var segment_len = segment.len;
    var segment_utf16_len = segment_utf16.len;
    if (buf[segment.len - 1] != std.fs.path.sep) {
        buf[segment.len] = std.fs.path.sep;
        segment_len += 1;
        segment_utf16_len += 1;
    }

    const bin_utf16 = bun.strings.convertUTF8toUTF16InBuffer(buf[segment_len..], bin);
    const path_size = segment_utf16_len + bin_utf16.len;
    buf[path_size] = 0;

    return searchBin(buf, path_size, check_windows_extensions);
}

/// This is the windows version of `which`.
/// It operates on wide strings.
/// It is similar to Get-Command in powershell.
pub fn whichWin(buf: *bun.WPathBuffer, path: []const u8, cwd: []const u8, bin: []const u8) ?[:0]const u16 {
    if (bin.len == 0) return null;
    var path_buf: bun.PathBuffer = undefined;

    const check_windows_extensions = !endsWithExtension(bin);

    // handle absolute paths
    if (std.fs.path.isAbsolute(bin)) {
        const normalized_bin = PosixToWinNormalizer.resolveCWDWithExternalBuf(&path_buf, bin) catch return null;
        const bin_utf16 = bun.strings.convertUTF8toUTF16InBuffer(buf, normalized_bin);
        buf[bin_utf16.len] = 0;
        return searchBin(buf, bin_utf16.len, check_windows_extensions);
    }

    // check if bin is in cwd
    if (bun.strings.containsChar(bin, '/') or bun.strings.containsChar(bin, '\\')) {
        if (searchBinInPath(
            buf,
            &path_buf,
            cwd,
            bun.strings.withoutPrefixComptime(bin, "./"),
            check_windows_extensions,
        )) |bin_path| {
            bun.path.posixToPlatformInPlace(u16, bin_path);
            return bin_path;
        }
        // Do not lookup paths with slashes in $PATH
        return null;
    }

    // iterate over system path delimiter
    var path_iter = std.mem.tokenizeScalar(u8, path, ';');
    while (path_iter.next()) |segment_part| {
        if (searchBinInPath(buf, &path_buf, segment_part, bin, check_windows_extensions)) |bin_path| {
            return bin_path;
        }
    }

    return null;
}
