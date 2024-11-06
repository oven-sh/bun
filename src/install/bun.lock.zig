const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const strings = bun.strings;
const URL = bun.URL;
const PackageManager = bun.install.PackageManager;
const OOM = bun.OOM;

pub const Spec = struct {
    raw: string,

    /// raw must be valid
    /// fills buf with the path to dependency in node_modules.
    /// e.g. loose-envify/js-tokens@4.0.0 -> node_modules/loose-envify/node_modules/js-tokens
    pub fn path(this: *const Spec, path_buf: []u8, comptime sep: u8) string {
        var buf = path_buf;
        var remain = this.raw;

        const end = loop: while (true) {
            @memcpy(buf[0.."node_modules/".len], "node_modules" ++ [1]u8{sep});
            buf = buf["node_modules/".len..];

            var at = strings.indexOfChar(remain, '@') orelse unreachable;
            var slash = strings.indexOfChar(remain, '/') orelse break :loop at;

            if (at == 0) {
                // scoped package, find next '@' and '/'
                at += 1 + (strings.indexOfChar(remain[1..], '@') orelse unreachable);
                slash += 1 + (strings.indexOfChar(remain[slash + 1 ..], '/') orelse {
                    break :loop at;
                });
            }

            if (at < slash) {
                // slash is in the version
                break :loop at;
            }

            @memcpy(buf[0..slash], remain[0..slash]);
            buf[slash] = sep;
            buf = buf[slash + 1 ..];
            remain = remain[slash + 1 ..];
        };

        @memcpy(buf[0..end], remain[0..end]);
        buf = buf[end..];
        return path_buf[0 .. @intFromPtr(buf.ptr) - @intFromPtr(path_buf.ptr)];
    }
};

pub const Pkg = struct {
    spec: string,
    integrity: u64,

    // `isEmpty()` for default
    registry: URL = .{},

    // peer and optional can be active at the same time
    behavior: std.enums.EnumSet(enum { prod, dev, peer, optional }) = .{},
};

pub const Lockfile = struct {
    packages: std.ArrayList(Pkg),

    const Diff = struct {
        added: usize = 0,
        removed: usize = 0,
        changed: usize = 0,
    };

    pub fn diff(prev: *const Lockfile) Diff {
        _ = prev;
    }

    pub fn save(this: *const Lockfile) void {
        _ = this;
    }

    pub fn loadFromSource(lockfile: *Lockfile, allocator: std.mem.Allocator) OOM!void {
        _ = lockfile;
        _ = allocator;
    }
};
