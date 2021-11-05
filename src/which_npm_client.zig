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

    // This check adds around 150ms
    // so...if we do do this, we should do it in a separate thread
    pub fn isYarnBerry(allocator: *std.mem.Allocator, cwd_dir: string, yarn_path: string) bool {
        var args = [_]string{ yarn_path, "--version" };
        var term = std.ChildProcess.exec(.{
            .argv = &args,
            .allocator = allocator,
            .cwd = if (cwd_dir.len > 1) std.mem.trimRight(u8, cwd_dir, "/") else cwd_dir,
        }) catch return true;
        defer allocator.free(term.stderr);
        defer allocator.free(term.stdout);

        if (term.stdout.len == 0) return true;
        return term.stdout[0] != '1';
    }

    pub fn detect(allocator: *std.mem.Allocator, realpath_buf: *[std.fs.MAX_PATH_BYTES]u8, PATH: string, cwd: string, comptime allow_yarn: bool) !?NPMClient {

        // We say:
        // - pnpm if it exists, is the default. its most esoteric, so if you have it installed, you prob want it.
        // - yarn if it exists and it is yarn 1, its the default (yarn 2 or later is not supported)
        // - else npm

        const out_path = brk: {
            var path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

            const path: [:0]const u8 = if (comptime allow_yarn)
                which(
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
                ) orelse ""
            else
                which(
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

            std.mem.copy(u8, realpath_buf, std.mem.span(path));
            // It's important we don't resolve the symlink
            // That breaks volta.
            break :brk realpath_buf[0..path.len];   
        };

        const basename = std.fs.path.basename(std.mem.span(out_path));
        if (basename.len == 0) return null;

        // if (comptime allow_yarn) {
        //     if (std.mem.indexOf(u8, basename, "yarn") != null) {
        //         if (isYarnBerry(allocator, cwd, out_path)) {
        //             return try detect(allocator, realpath_buf, PATH, cwd, false);
        //         }
        //     }
        // }

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
