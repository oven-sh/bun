const std = @import("std");
const Enviroment = @import("./env.zig");

pub usingnamespace switch (std.Target.current.os.tag) {
    .macos => @import("./darwin_c.zig"),
    else => struct {},
};

usingnamespace std.c;
const builtin = @import("builtin");
const os = std.os;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;
const errno = os.errno;
const zeroes = mem.zeroes;

pub extern "c" fn chmod([*c]const u8, mode_t) c_int;
pub extern "c" fn fchmod(c_int, mode_t) c_int;
pub extern "c" fn umask(mode_t) mode_t;
pub extern "c" fn fchmodat(c_int, [*c]const u8, mode_t, c_int) c_int;

pub extern "c" fn lstat([*c]const u8, [*c]libc_stat) c_int;
pub extern "c" fn lstat64([*c]const u8, [*c]libc_stat) c_int;

pub fn lstat_absolute(path: [:0]const u8) StatError!Stat {
    if (builtin.os.tag == .windows) {
        var io_status_block: windows.IO_STATUS_BLOCK = undefined;
        var info: windows.FILE_ALL_INFORMATION = undefined;
        const rc = windows.ntdll.NtQueryInformationFile(self.handle, &io_status_block, &info, @sizeOf(windows.FILE_ALL_INFORMATION), .FileAllInformation);
        switch (rc) {
            .SUCCESS => {},
            .BUFFER_OVERFLOW => {},
            .INVALID_PARAMETER => unreachable,
            .ACCESS_DENIED => return error.AccessDenied,
            else => return windows.unexpectedStatus(rc),
        }
        return Stat{
            .inode = info.InternalInformation.IndexNumber,
            .size = @bitCast(u64, info.StandardInformation.EndOfFile),
            .mode = 0,
            .kind = if (info.StandardInformation.Directory == 0) .File else .Directory,
            .atime = windows.fromSysTime(info.BasicInformation.LastAccessTime),
            .mtime = windows.fromSysTime(info.BasicInformation.LastWriteTime),
            .ctime = windows.fromSysTime(info.BasicInformation.CreationTime),
        };
    }

    var st = zeroes(libc_stat);
    switch (errno(lstat64(path.ptr, &st))) {
        .SUCCESS => {},
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
            else => switch (st.mode & os.S_IFMT) {
                os.S_IFBLK => Kind.BlockDevice,
                os.S_IFCHR => Kind.CharacterDevice,
                os.S_IFDIR => Kind.Directory,
                os.S_IFIFO => Kind.NamedPipe,
                os.S_IFLNK => Kind.SymLink,
                os.S_IFREG => Kind.File,
                os.S_IFSOCK => Kind.UnixDomainSocket,
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

// On Linux, this will be fast because sendfile() supports copying between two file descriptors on disk
// On macOS & BSDs, this will be slow because it will attempt to copy with sendfile, fail, and then fallback to a copy loop
pub fn moveFileZSlow(from_dir: std.os.fd_t, filename: [*:0]const u8, to_dir: std.os.fd_t, destination: [*:0]const u8) !void {
    const flags = std.os.O_RDWR;
    const in_handle = try std.os.openatZ(from_dir, filename, flags, 0777);
    defer std.os.close(in_handle);
    const out_handle = try std.os.openatZ(to_dir, filename, flags | std.os.O_CREAT, 0777);
    defer std.os.close(out_handle);
    const written = try std.os.sendfile(out_handle, in_handle, 0, 0, &[_]std.c.iovec_const{}, &[_]std.c.iovec_const{}, 0);
    try std.os.ftruncate(out_handle, written);
}
