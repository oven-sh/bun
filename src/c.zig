const std = @import("std");
const Enviroment = @import("./env.zig");

const PlatformSpecific = switch (@import("builtin").target.os.tag) {
    .macos => @import("./darwin_c.zig"),
    .linux => @import("./linux_c.zig"),
    else => struct {},
};
pub usingnamespace PlatformSpecific;

const C = std.c;
const builtin = @import("builtin");
const os = std.os;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;
const errno = os.errno;
const mode_t = C.mode_t;
const libc_stat = C.Stat;
const zeroes = mem.zeroes;
pub const darwin = @import("./darwin_c.zig");
pub const linux = @import("./linux_c.zig");
pub extern "c" fn chmod([*c]const u8, mode_t) c_int;
pub extern "c" fn fchmod(std.c.fd_t, mode_t) c_int;
pub extern "c" fn umask(mode_t) mode_t;
pub extern "c" fn fchmodat(c_int, [*c]const u8, mode_t, c_int) c_int;
pub extern "c" fn fchown(std.c.fd_t, std.c.uid_t, std.c.gid_t) c_int;
pub extern "c" fn lchown(path: [*:0]const u8, std.c.uid_t, std.c.gid_t) c_int;
pub extern "c" fn chown(path: [*:0]const u8, std.c.uid_t, std.c.gid_t) c_int;
pub extern "c" fn lstat([*c]const u8, [*c]libc_stat) c_int;
pub extern "c" fn lstat64([*c]const u8, [*c]libc_stat) c_int;
pub extern "c" fn lchmod(path: [*:0]const u8, mode: mode_t) c_int;
pub extern "c" fn truncate(path: [*:0]const u8, len: os.off_t) c_int;
pub extern "c" fn lutimes(path: [*:0]const u8, times: *const [2]std.os.timeval) c_int;
pub extern "c" fn mkdtemp(template: [*c]u8) ?[*:0]u8;

pub fn lstat_absolute(path: [:0]const u8) !Stat {
    if (builtin.os.tag == .windows) {
        @compileError("Not implemented yet");
    }

    var st = zeroes(libc_stat);
    switch (errno(lstat64(path.ptr, &st))) {
        .SUCCESS => {},
        .NOENT => return error.FileNotFound,
        // .EINVAL => unreachable,
        .BADF => unreachable, // Always a race condition.
        .NOMEM => return error.SystemResources,
        .ACCES => return error.AccessDenied,
        else => |err| return os.unexpectedErrno(err),
    }

    const atime = st.atime();
    const mtime = st.mtime();
    const ctime = st.ctime();
    return Stat{
        .inode = st.ino,
        .size = @bitCast(u64, st.size),
        .mode = st.mode,
        .kind = switch (builtin.os.tag) {
            .wasi => switch (st.filetype) {
                os.FILETYPE_BLOCK_DEVICE => Kind.BlockDevice,
                os.FILETYPE_CHARACTER_DEVICE => Kind.CharacterDevice,
                os.FILETYPE_DIRECTORY => Kind.Directory,
                os.FILETYPE_SYMBOLIC_LINK => Kind.SymLink,
                os.FILETYPE_REGULAR_FILE => Kind.File,
                os.FILETYPE_SOCKET_STREAM, os.FILETYPE_SOCKET_DGRAM => Kind.UnixDomainSocket,
                else => Kind.Unknown,
            },
            else => switch (st.mode & os.S.IFMT) {
                os.S.IFBLK => Kind.BlockDevice,
                os.S.IFCHR => Kind.CharacterDevice,
                os.S.IFDIR => Kind.Directory,
                os.S.IFIFO => Kind.NamedPipe,
                os.S.IFLNK => Kind.SymLink,
                os.S.IFREG => Kind.File,
                os.S.IFSOCK => Kind.UnixDomainSocket,
                else => Kind.Unknown,
            },
        },
        .atime = @as(i128, atime.tv_sec) * std.time.ns_per_s + atime.tv_nsec,
        .mtime = @as(i128, mtime.tv_sec) * std.time.ns_per_s + mtime.tv_nsec,
        .ctime = @as(i128, ctime.tv_sec) * std.time.ns_per_s + ctime.tv_nsec,
    };
}

// renameatZ fails when renaming across mount points
// we assume that this is relatively uncommon
pub fn moveFileZ(from_dir: std.os.fd_t, filename: [*:0]const u8, to_dir: std.os.fd_t, destination: [*:0]const u8) !void {
    std.os.renameatZ(from_dir, filename, to_dir, destination) catch |err| {
        switch (err) {
            error.RenameAcrossMountPoints => {
                try moveFileZSlow(from_dir, filename, to_dir, destination);
            },
            else => {
                return err;
            },
        }
    };
}

pub fn moveFileZWithHandle(from_handle: std.os.fd_t, from_dir: std.os.fd_t, filename: [*:0]const u8, to_dir: std.os.fd_t, destination: [*:0]const u8) !void {
    std.os.renameatZ(from_dir, filename, to_dir, destination) catch |err| {
        switch (err) {
            error.RenameAcrossMountPoints => {
                try moveFileZSlowWithHandle(from_handle, to_dir, destination);
            },
            else => {
                return err;
            },
        }
    };
}

// On Linux, this will be fast because sendfile() supports copying between two file descriptors on disk
// macOS & BSDs will be slow because
pub fn moveFileZSlow(from_dir: std.os.fd_t, filename: [*:0]const u8, to_dir: std.os.fd_t, destination: [*:0]const u8) !void {
    const in_handle = try std.os.openatZ(from_dir, filename, std.os.O.RDONLY | std.os.O.CLOEXEC, 0600);
    try moveFileZSlowWithHandle(in_handle, to_dir, destination);
}

pub fn moveFileZSlowWithHandle(in_handle: std.os.fd_t, to_dir: std.os.fd_t, destination: [*:0]const u8) !void {
    const stat_ = try std.os.fstat(in_handle);
    // delete if exists, don't care if it fails. it may fail due to the file not existing
    // delete here because we run into weird truncation issues if we do not
    // ftruncate() instead didn't work.
    // this is technically racy because it could end up deleting the file without saving
    std.os.unlinkatZ(to_dir, destination, 0) catch {};
    const out_handle = try std.os.openatZ(to_dir, destination, std.os.O.WRONLY | std.os.O.CREAT | std.os.O.CLOEXEC, 022);
    defer std.os.close(out_handle);
    if (comptime Enviroment.isLinux) {
        _ = std.os.system.fallocate(out_handle, 0, 0, @intCast(i64, stat_.size));
        _ = try std.os.sendfile(out_handle, in_handle, 0, @intCast(usize, stat_.size), &[_]std.os.iovec_const{}, &[_]std.os.iovec_const{}, 0);
    } else {
        if (comptime Enviroment.isMac) {
            // if this fails, it doesn't matter
            // we only really care about read & write succeeding
            PlatformSpecific.preallocate_file(
                out_handle,
                @intCast(std.os.off_t, 0),
                @intCast(std.os.off_t, stat_.size),
            ) catch {};
        }

        var buf: [8092 * 2]u8 = undefined;
        var total_read: usize = 0;
        while (true) {
            const read = try std.os.pread(in_handle, &buf, total_read);
            total_read += read;
            if (read == 0) break;
            const bytes = buf[0..read];
            const written = try std.os.write(out_handle, bytes);
            if (written == 0) break;
        }
    }

    _ = fchmod(out_handle, stat_.mode);
    _ = fchown(out_handle, stat_.uid, stat_.gid);
}

pub fn kindFromMode(mode: os.mode_t) std.fs.File.Kind {
    return switch (mode & os.S.IFMT) {
        os.S.IFBLK => std.fs.File.Kind.BlockDevice,
        os.S.IFCHR => std.fs.File.Kind.CharacterDevice,
        os.S.IFDIR => std.fs.File.Kind.Directory,
        os.S.IFIFO => std.fs.File.Kind.NamedPipe,
        os.S.IFLNK => std.fs.File.Kind.SymLink,
        os.S.IFREG => std.fs.File.Kind.File,
        os.S.IFSOCK => std.fs.File.Kind.UnixDomainSocket,
        else => .Unknown,
    };
}
