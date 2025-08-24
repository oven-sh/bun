pub fn isSameFilesystem(path1: []const u8, path2: []const u8) !bool {
    if (comptime Environment.isWindows) {
        var volume1: bun.PathBuffer = undefined;
        var volume2: bun.PathBuffer = undefined;

        const vol1 = try getVolumePathName(path1, &volume1);
        const vol2 = try getVolumePathName(path2, &volume2);

        return strings.eql(vol1, vol2);
    } else {
        var path1_buf: bun.PathBuffer = undefined;
        var path2_buf: bun.PathBuffer = undefined;
        const path1_z = bun.path.joinZBuf(&path1_buf, &[_][]const u8{path1}, .auto);
        const path2_z = bun.path.joinZBuf(&path2_buf, &[_][]const u8{path2}, .auto);

        const stat1 = try bun.sys.stat(path1_z).unwrap();
        const stat2 = try bun.sys.stat(path2_z).unwrap();
        return stat1.dev == stat2.dev;
    }
}

pub fn getMountPoint(path: []const u8) ![]const u8 {
    if (comptime Environment.isWindows) {
        var volume: bun.PathBuffer = undefined;
        return try getVolumePathName(path, &volume);
    } else {
        return try getMountPointUnix(path);
    }
}

fn getVolumePathName(path: []const u8, buf: *bun.PathBuffer) ![]const u8 {
    if (comptime !Environment.isWindows) {
        @compileError("Windows only");
    }

    var path_buf: bun.PathBuffer = undefined;
    const abs_path = Path.joinAbsStringBuf(Fs.FileSystem.instance.cwd, &path_buf, &[_][]const u8{path}, .windows);

    var wide_path: bun.WPathBuffer = undefined;
    const wide_len = bun.strings.toWPathNormalized(&wide_path, abs_path);

    var volume_wide: bun.WPathBuffer = undefined;
    const result = bun.windows.GetVolumePathNameW(wide_path[0..wide_len :0].ptr, &volume_wide, volume_wide.len);

    if (result == 0) {
        return error.GetVolumePathNameFailed;
    }

    const volume_len = bun.strings.fromWPath(buf, volume_wide[0..result]);
    return buf[0..volume_len];
}

fn getMountPointUnix(path: []const u8) ![]const u8 {
    var current_path = try std.fs.realpathAlloc(bun.default_allocator, path);
    defer bun.default_allocator.free(current_path);

    var path_buf: bun.PathBuffer = undefined;
    const current_path_z = bun.path.joinZBuf(&path_buf, &[_][]const u8{current_path}, .auto);
    const initial_stat = try bun.sys.stat(current_path_z).unwrap();
    var current_dev = initial_stat.dev;

    while (true) {
        const parent = std.fs.path.dirname(current_path) orelse return current_path;

        if (strings.eql(parent, current_path)) {
            return current_path;
        }

        var parent_buf: bun.PathBuffer = undefined;
        const parent_z = bun.path.joinZBuf(&parent_buf, &[_][]const u8{parent}, .auto);
        const parent_stat = try bun.sys.stat(parent_z).unwrap();

        if (parent_stat.dev != current_dev) {
            return current_path;
        }

        const new_path = try bun.default_allocator.dupe(u8, parent);
        bun.default_allocator.free(current_path);
        current_path = new_path;
        current_dev = parent_stat.dev;
    }
}

pub fn canCreateDir(path: []const u8) bool {
    std.fs.cwd().makePath(path) catch |err| {
        switch (err) {
            error.PathAlreadyExists => {
                std.fs.cwd().access(path, .{ .mode = .write_only }) catch {
                    return false;
                };
                return true;
            },
            else => return false,
        }
    };

    std.fs.cwd().deleteDir(path) catch {};
    return true;
}

pub fn getNextPathComponent(from: []const u8, to: []const u8) ?[]const u8 {
    if (!strings.startsWith(to, from)) return null;

    var remainder = to[from.len..];
    if (remainder.len == 0) return null;

    if (remainder[0] == std.fs.path.sep) {
        remainder = remainder[1..];
    }

    const sep_index = strings.indexOfChar(remainder, std.fs.path.sep) orelse remainder.len;
    if (sep_index == 0) return null;

    return remainder[0..sep_index];
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Fs = bun.fs;
const Path = bun.path;
const strings = bun.strings;
