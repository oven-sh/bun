pub const linux = struct {

    // On linux, bun overrides the libc symbols for various functions.
    // This is to compensate for older glibc versions.

    fn simulateLibcErrno(rc: usize) c_int {
        const signed: isize = @bitCast(rc);
        const int: c_int = @intCast(if (signed > -4096 and signed < 0) -signed else 0);
        std.c._errno().* = int;
        return if (signed > -4096 and signed < 0) -1 else int;
    }

    pub export fn stat(path: [*:0]const u8, buf: *std.os.linux.Stat) c_int {
        // https://git.musl-libc.org/cgit/musl/tree/src/stat/stat.c
        const rc = std.os.linux.fstatat(std.os.linux.AT.FDCWD, path, buf, 0);
        return simulateLibcErrno(rc);
    }

    pub const stat64 = stat;
    pub const lstat64 = lstat;
    pub const fstat64 = fstat;
    pub const fstatat64 = fstatat;

    pub export fn lstat(path: [*:0]const u8, buf: *std.os.linux.Stat) c_int {
        // https://git.musl-libc.org/cgit/musl/tree/src/stat/lstat.c
        const rc = std.os.linux.fstatat(std.os.linux.AT.FDCWD, path, buf, std.os.linux.AT.SYMLINK_NOFOLLOW);
        return simulateLibcErrno(rc);
    }

    pub export fn fstat(fd: c_int, buf: *std.os.linux.Stat) c_int {
        const rc = std.os.linux.fstat(fd, buf);
        return simulateLibcErrno(rc);
    }

    pub export fn fstatat(dirfd: i32, path: [*:0]const u8, buf: *std.os.linux.Stat, flags: u32) c_int {
        const rc = std.os.linux.fstatat(dirfd, path, buf, flags);
        return simulateLibcErrno(rc);
    }

    pub export fn statx(dirfd: i32, path: [*:0]const u8, flags: u32, mask: u32, buf: *std.os.linux.Statx) c_int {
        const rc = std.os.linux.statx(dirfd, path, flags, mask, buf);
        return simulateLibcErrno(rc);
    }

    pub const memmem = bun.c.memmem;

    comptime {
        _ = stat;
        _ = stat64;
        _ = lstat;
        _ = lstat64;
        _ = fstat;
        _ = fstat64;
        _ = fstatat;
        _ = statx;
        @export(&stat, .{ .name = "stat64" });
        @export(&lstat, .{ .name = "lstat64" });
        @export(&fstat, .{ .name = "fstat64" });
        @export(&fstatat, .{ .name = "fstatat64" });
    }
};
pub const darwin = struct {
    pub const memmem = bun.c.memmem;

    // The symbol name depends on the arch.

    pub const lstat = blk: {
        const T = *const fn (?[*:0]const u8, ?*bun.Stat) callconv(.c) c_int;
        break :blk @extern(T, .{ .name = if (bun.Environment.isAarch64) "lstat" else "lstat64" });
    };
    pub const fstat = blk: {
        const T = *const fn (i32, ?*bun.Stat) callconv(.c) c_int;
        break :blk @extern(T, .{ .name = if (bun.Environment.isAarch64) "fstat" else "fstat64" });
    };
    pub const stat = blk: {
        const T = *const fn (?[*:0]const u8, ?*bun.Stat) callconv(.c) c_int;
        break :blk @extern(T, .{ .name = if (bun.Environment.isAarch64) "stat" else "stat64" });
    };
};
pub const windows = struct {
    /// Windows doesn't have memmem, so we need to implement it
    /// This is used in src/string/immutable.zig
    pub export fn memmem(haystack: ?[*]const u8, haystacklen: usize, needle: ?[*]const u8, needlelen: usize) ?[*]const u8 {
        // Handle null pointers
        if (haystack == null or needle == null) return null;

        // Handle empty needle case
        if (needlelen == 0) return haystack;

        // Handle case where needle is longer than haystack
        if (needlelen > haystacklen) return null;

        const hay = haystack.?[0..haystacklen];
        const nee = needle.?[0..needlelen];

        const i = std.mem.indexOf(u8, hay, nee) orelse return null;
        return hay.ptr + i;
    }

    /// lstat is implemented in workaround-missing-symbols.cpp
    pub const lstat = blk: {
        const T = *const fn ([*c]const u8, [*c]std.c.Stat) callconv(.c) c_int;
        break :blk @extern(T, .{ .name = "lstat64" });
    };
    /// fstat is implemented in workaround-missing-symbols.cpp
    pub const fstat = blk: {
        const T = *const fn ([*c]const u8, [*c]std.c.Stat) callconv(.c) c_int;
        break :blk @extern(T, .{ .name = "fstat64" });
    };
    /// stat is implemented in workaround-missing-symbols.cpp
    pub const stat = blk: {
        const T = *const fn ([*c]const u8, [*c]std.c.Stat) callconv(.c) c_int;
        break :blk @extern(T, .{ .name = "stat64" });
    };
};

pub const current = switch (bun.Environment.os) {
    .linux => linux,
    .windows => windows,
    .mac => darwin,
    else => struct {},
};

const bun = @import("bun");
const std = @import("std");
