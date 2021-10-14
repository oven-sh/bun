usingnamespace @import("./global.zig");

const which = @import("./which.zig").which;
const std = @import("std");

pub const NPMClient = struct {
    bin: string,
    tag: Tag,

    pub const Tag = enum {
        npm,
        yarn,
        pnpm,
    };

    pub fn isYarnBerry(allocator: *std.mem.Allocator, yarn_path: string) bool {
        var args = [_]string{ yarn_path, "--version" };
        var child_process = std.ChildProcess.init(&args, allocator) catch return true;
        defer child_process.deinit();
        child_process.cwd_dir = std.fs.cwd();
        child_process.expand_arg0 = .no_expand;
        child_process.stdout_behavior = .Pipe;
        child_process.stderr_behavior = .Pipe;
        child_process.spawn() catch return true;
        defer _ = child_process.kill() catch undefined;

        var path_buf: [512]u8 = undefined;
        var path_len = child_process.stdout.?.read(&path_buf) catch return true;

        if (path_len == 0) {
            return true;
        }

        return path_buf[0] != '1';
    }

    pub fn detect(allocator: *std.mem.Allocator, realpath_buf: *[std.fs.MAX_PATH_BYTES]u8, PATH: string, cwd: string, comptime allow_yarn: bool) !?NPMClient {

        // We say:
        // - pnpm if it exists, is the default. its most esoteric, so if you have it installed, you prob want it.
        // - yarn if it exists and it is yarn 1, its the default (yarn 2 or later is not supported)
        // - else npm
        var path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

        const path: [:0]const u8 = brk: {
            if (comptime allow_yarn) {
                break :brk which(
                    &path_buf,
                    PATH,
                    cwd,
                    "pnpm",
                ) orelse which(
                    &path_buf,
                    PATH,
                    cwd,
                    "yarn",
                ) orelse which(
                    &path_buf,
                    PATH,
                    cwd,
                    "npm",
                ) orelse "";
            } else {
                break :brk which(
                    &path_buf,
                    PATH,
                    cwd,
                    "pnpm",
                ) orelse which(
                    &path_buf,
                    PATH,
                    cwd,
                    "npm",
                ) orelse "";
            }
            unreachable;
        };

        var basename = std.fs.path.basename(path);
        if (basename.len == 0) return null;

        if (comptime allow_yarn) {
            if (std.mem.indexOf(u8, basename, "yarn") != null) {
                if (isYarnBerry(allocator, path)) {
                    return try detect(allocator, realpath_buf, PATH, cwd, false);
                }
            }
        }

        var file = std.fs.openFileAbsoluteZ(path, .{ .read = true }) catch return null;
        defer file.close();
        const out_path = std.os.getFdPath(file.handle, realpath_buf) catch return null;

        if (strings.contains(basename, "pnpm")) {
            return NPMClient{ .bin = out_path, .tag = .pnpm };
        }

        if (strings.contains(basename, "yarn")) {
            return NPMClient{ .bin = out_path, .tag = .yarn };
        }

        if (strings.contains(basename, "npm")) {
            return NPMClient{ .bin = out_path, .tag = .npm };
        }

        return null;
    }
};
