//! OS-level functionality.
//! Designed to be slightly higher level than sys.zig
const c = @cImport({
    @cInclude("pwd.h");
    @cInclude("unistd.h");
    @cInclude("sys/types.h");
    @cInclude("errno.h");
});

pub const ManagedHomeDir = union(enum) {
    const Self = @This();

    _system_managed: struct {
        value: []const u8,
    },

    _manually_managed: struct {
        value: []const u8,
        buf: []u8,
        allocator: std.mem.Allocator,
    },

    pub fn slice(self: Self) []const u8 {
        return switch (self) {
            ._system_managed => |s| s.value,
            ._manually_managed => |m| m.value,
        };
    }

    pub fn deinit(self: Self) !Self {
        switch (self) {
            ._system_managed => {
                // System managed the home directory for us, so we don't need to free it.
            },
            ._manually_managed => |*m| {
                m.allocator.free(m.buf);
            },
        }
    }
};

/// Opaque type representing the user ID.
pub const Uid = struct {
    const Self = @This();

    _underlying: c.uid_t,

    pub fn queryEffective() Self {
        return .{ ._underlying = c.geteuid() };
    }

    pub fn queryReal() Self {
        return .{ ._underlying = c.getuid() };
    }

    /// Falls back to queryEffective.
    pub fn queryCurrent() Self {
        return queryEffective();
    }
};

/// Deduces the current user's home directory.
///
/// This function follows
pub fn queryHomeDir(allocator: std.mem.Allocator, user: ?[]const u8) ![]u8 {
    if (user != null) {
        // There is actually a reasonable desire to be able to query other users' home directories.
        // However, we don't have a need to do that. See doi:10.1109/IEEESTD.2018.8277153 2.6.1 for
        // further details.
        @panic("Not implemented");
    }

    return if (bun.Environment.is_windows)
        queryHomeDirWindows(allocator, null);
}

/// Deduces the current user's home directory on POSIX systems.
///
/// Whichever of the following returns a value is returned.
/// - Per doi:10.1109/IEEESTD.2018.8277153, the `$HOME` variable.
/// - The `getpwuid_r` function.
pub fn queryHomeDirPosix(allocator: std.mem.Allocator, user: ?[]const u8) !ManagedHomeDir {
    if (bun.Environment.is_windows) {
        @compileError("You cannot call queryHomeDirPosix on Windows");
    }

    if (user != null) {
        // There is actually a reasonable desire to be able to query other users' home directories.
        // However, we don't have a need to do that. See doi:10.1109/IEEESTD.2018.8277153 2.6.1 for
        // further details.
        @panic("Not implemented");
    }

    if (bun.EnvVar.home.get()) |h| {
        return .{ ._system_managed = .{
            .value = h,
        } };
    }

    const max_attempts = 8; // The maximum total number of attempts we will have at reading
    // getpwuid_r before giving up. There are a few cases which benefit
    // from re-attempting a read.
    const initial_buf_size = c.sysconf(c._SC_GETPW_R_SIZE_MAX);
    const buf_size_gain = 4;

    var buffer_size: usize = initial_buf_size;
    var managed_dir: ManagedHomeDir = .{ ._manually_managed = .{
        .buf = allocator.alloc(u8, buffer_size),
        .value = undefined,
        .allocator = allocator,
    } };
    var m = &managed_dir._manually_managed;
    errdefer m.allocator.free(m.buf);

    for (0..max_attempts) |_| {
        var passwd: c.struct_passwd = undefined;
        var result: *c.struct_passwd = undefined;

        // On success, getpwnam_r() and getpwuid_r() return zero, and set *result to pwd.
        if (c.getpwuid_r(Uid.queryCurrent()._underlying, &passwd, m.buf, m.buf.len, &result) == 0) {
            // Great, we found a password entry, with a home directory. Let's patch up
            // ManagedHomeDir and ship it.
            m.value = result.pw_dir;
            return managed_dir;
        }

        switch (c.errno) {
            c.EINTR => {
                // We got hit by a signal, let's just try again.
                continue;
            },
            c.EIO => {
                // I/O error.
                //
                // Perhaps trying again later will work?
                return error.TryAgainLater;
            },
            c.EMFILE => {
                // The maximum number (OPEN_MAX) of files was open already in the calling process.
                //
                // Perhaps trying again later will work?
                return error.TryAgainLater;
            },
            c.ENFILE => {
                // The maximum number of files was open already in the system.
                //
                // Perhaps trying again later will work?
                return error.TryAgainLater;
            },
            c.ENOMEM, c.ERANGE => {
                // ENOMEM -- Insufficient memory to allocate passwd structure.
                // ERANGE -- Insufficient buffer space supplied.
                buffer_size *= buf_size_gain;
                m.buf = try m.allocator.realloc(m.buf, buffer_size);
                continue;
            },
            else => {
                // 0 or ENOENT or ESRCH or EBADF or EPERM or ...
                // The given name or uid was not found -- there's really no point in trying again.
                break;
            },
        }
    }

    return error.FailedToFindHomeDir;
}

/// Deduces the current user's home directory on POSIX systems.
///
/// Whichever of the following returns a value is returned.
/// - Per doi:10.1109/IEEESTD.2018.8277153, the %UserProfile% environment variable.
pub fn queryHomeDirWindows(allocator: std.mem.Allocator, user: ?[]const u8) !ManagedHomeDir {
    if (!bun.Environment.is_windows) {
        @compileError("You cannot call queryHomeDirWindows on POSIX");
    }

    if (user != null) {
        // There is actually a reasonable desire to be able to query other users' home directories.
        // However, we don't have a need to do that. See doi:10.1109/IEEESTD.2018.8277153 2.6.1 for
        // further details.
        @panic("Not implemented");
    }

    _ = allocator;

    if (bun.EnvVar.home.get()) |h| {
        return .{ ._system_managed = .{
            .value = h,
        } };
    }

    return error.FailedToFindHomeDir;
}

const bun = @import("./bun.zig");
const std = @import("std");
