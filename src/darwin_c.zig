const std = @import("std");
usingnamespace std.c;
const builtin = @import("builtin");
const os = std.os;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;
const off_t = std.c.off_t;
const errno = os.errno;
const zeroes = mem.zeroes;

// int clonefileat(int src_dirfd, const char * src, int dst_dirfd, const char * dst, int flags);
pub extern "c" fn clonefileat(c_int, [*c]const u8, c_int, [*c]const u8, uint32_t: c_int) c_int;
// int fclonefileat(int srcfd, int dst_dirfd, const char * dst, int flags);
pub extern "c" fn fclonefileat(c_int, c_int, [*c]const u8, uint32_t: c_int) c_int;
// int clonefile(const char * src, const char * dst, int flags);
pub extern "c" fn clonefile([*c]const u8, [*c]const u8, uint32_t: c_int) c_int;

// pub fn stat_absolute(path: [:0]const u8) StatError!Stat {
//     if (builtin.os.tag == .windows) {
//         var io_status_block: windows.IO_STATUS_BLOCK = undefined;
//         var info: windows.FILE_ALL_INFORMATION = undefined;
//         const rc = windows.ntdll.NtQueryInformationFile(self.handle, &io_status_block, &info, @sizeOf(windows.FILE_ALL_INFORMATION), .FileAllInformation);
//         switch (rc) {
//             .SUCCESS => {},
//             .BUFFER_OVERFLOW => {},
//             .INVALID_PARAMETER => unreachable,
//             .ACCESS_DENIED => return error.AccessDenied,
//             else => return windows.unexpectedStatus(rc),
//         }
//         return Stat{
//             .inode = info.InternalInformation.IndexNumber,
//             .size = @bitCast(u64, info.StandardInformation.EndOfFile),
//             .mode = 0,
//             .kind = if (info.StandardInformation.Directory == 0) .File else .Directory,
//             .atime = windows.fromSysTime(info.BasicInformation.LastAccessTime),
//             .mtime = windows.fromSysTime(info.BasicInformation.LastWriteTime),
//             .ctime = windows.fromSysTime(info.BasicInformation.CreationTime),
//         };
//     }

//     var st = zeroes(libc_stat);
//     switch (errno(stat(path.ptr, &st))) {
//         0 => {},
//         // .EINVAL => unreachable,
//         .EBADF => unreachable, // Always a race condition.
//         .ENOMEM => return error.SystemResources,
//         .EACCES => return error.AccessDenied,
//         else => |err| return os.unexpectedErrno(err),
//     }

//     const atime = st.atime();
//     const mtime = st.mtime();
//     const ctime = st.ctime();
//     return Stat{
//         .inode = st.ino,
//         .size = @bitCast(u64, st.size),
//         .mode = st.mode,
//         .kind = switch (builtin.os.tag) {
//             .wasi => switch (st.filetype) {
//                 os.FILETYPE_BLOCK_DEVICE => Kind.BlockDevice,
//                 os.FILETYPE_CHARACTER_DEVICE => Kind.CharacterDevice,
//                 os.FILETYPE_DIRECTORY => Kind.Directory,
//                 os.FILETYPE_SYMBOLIC_LINK => Kind.SymLink,
//                 os.FILETYPE_REGULAR_FILE => Kind.File,
//                 os.FILETYPE_SOCKET_STREAM, os.FILETYPE_SOCKET_DGRAM => Kind.UnixDomainSocket,
//                 else => Kind.Unknown,
//             },
//             else => switch (st.mode & os.S_IFMT) {
//                 os.S_IFBLK => Kind.BlockDevice,
//                 os.S_IFCHR => Kind.CharacterDevice,
//                 os.S_IFDIR => Kind.Directory,
//                 os.S_IFIFO => Kind.NamedPipe,
//                 os.S_IFLNK => Kind.SymLink,
//                 os.S_IFREG => Kind.File,
//                 os.S_IFSOCK => Kind.UnixDomainSocket,
//                 else => Kind.Unknown,
//             },
//         },
//         .atime = @as(i128, atime.tv_sec) * std.time.ns_per_s + atime.tv_nsec,
//         .mtime = @as(i128, mtime.tv_sec) * std.time.ns_per_s + mtime.tv_nsec,
//         .ctime = @as(i128, ctime.tv_sec) * std.time.ns_per_s + ctime.tv_nsec,
//     };
// }

pub const struct_fstore = extern struct {
    fst_flags: c_uint,
    fst_posmode: c_int,
    fst_offset: off_t,
    fst_length: off_t,
    fst_bytesalloc: off_t,
};
pub const fstore_t = struct_fstore;

pub const F_ALLOCATECONTIG = @as(c_int, 0x00000002);
pub const F_ALLOCATEALL = @as(c_int, 0x00000004);
pub const F_PEOFPOSMODE = @as(c_int, 3);
pub const F_VOLPOSMODE = @as(c_int, 4);

pub fn preallocate_file(fd: os.fd_t, offset: off_t, len: off_t) !void {
    var fstore = zeroes(fstore_t);
    fstore.fst_flags = F_ALLOCATECONTIG;
    fstore.fst_posmode = F_PEOFPOSMODE;
    fstore.fst_offset = 0;
    fstore.fst_length = len + offset;

    // Based on https://api.kde.org/frameworks/kcoreaddons/html/posix__fallocate__mac_8h_source.html
    var rc = os.system.fcntl(fd, os.F_PREALLOCATE, &fstore);

    switch (rc) {
        0 => return,
        else => {
            fstore.fst_flags = F_ALLOCATEALL;
            rc = os.system.fcntl(fd, os.F_PREALLOCATE, &fstore);
        },
    }

    std.mem.doNotOptimizeAway(&fstore);
}
