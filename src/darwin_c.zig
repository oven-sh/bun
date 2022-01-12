const std = @import("std");
const builtin = @import("builtin");
const os = std.os;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;
const off_t = std.c.off_t;
const errno = os.errno;
const zeroes = mem.zeroes;

pub extern "c" fn copyfile(from: [*:0]const u8, to: [*:0]const u8, state: ?std.c.copyfile_state_t, flags: u32) c_int;
pub const COPYFILE_STATE_SRC_FD = @as(c_int, 1);
pub const COPYFILE_STATE_SRC_FILENAME = @as(c_int, 2);
pub const COPYFILE_STATE_DST_FD = @as(c_int, 3);
pub const COPYFILE_STATE_DST_FILENAME = @as(c_int, 4);
pub const COPYFILE_STATE_QUARANTINE = @as(c_int, 5);
pub const COPYFILE_STATE_STATUS_CB = @as(c_int, 6);
pub const COPYFILE_STATE_STATUS_CTX = @as(c_int, 7);
pub const COPYFILE_STATE_COPIED = @as(c_int, 8);
pub const COPYFILE_STATE_XATTRNAME = @as(c_int, 9);
pub const COPYFILE_STATE_WAS_CLONED = @as(c_int, 10);
pub const COPYFILE_DISABLE_VAR = "COPYFILE_DISABLE";
pub const COPYFILE_ACL = @as(c_int, 1) << @as(c_int, 0);
pub const COPYFILE_STAT = @as(c_int, 1) << @as(c_int, 1);
pub const COPYFILE_XATTR = @as(c_int, 1) << @as(c_int, 2);
pub const COPYFILE_DATA = @as(c_int, 1) << @as(c_int, 3);
pub const COPYFILE_SECURITY = COPYFILE_STAT | COPYFILE_ACL;
pub const COPYFILE_METADATA = COPYFILE_SECURITY | COPYFILE_XATTR;
pub const COPYFILE_ALL = COPYFILE_METADATA | COPYFILE_DATA;
/// Descend into hierarchies 
pub const COPYFILE_RECURSIVE = @as(c_int, 1) << @as(c_int, 15);
/// return flags for xattr or acls if set 
pub const COPYFILE_CHECK = @as(c_int, 1) << @as(c_int, 16);
/// fail if destination exists 
pub const COPYFILE_EXCL = @as(c_int, 1) << @as(c_int, 17);
/// don't follow if source is a symlink 
pub const COPYFILE_NOFOLLOW_SRC = @as(c_int, 1) << @as(c_int, 18);
/// don't follow if dst is a symlink 
pub const COPYFILE_NOFOLLOW_DST = @as(c_int, 1) << @as(c_int, 19);
/// unlink src after copy 
pub const COPYFILE_MOVE = @as(c_int, 1) << @as(c_int, 20);
/// unlink dst before copy 
pub const COPYFILE_UNLINK = @as(c_int, 1) << @as(c_int, 21);
pub const COPYFILE_NOFOLLOW = COPYFILE_NOFOLLOW_SRC | COPYFILE_NOFOLLOW_DST;
pub const COPYFILE_PACK = @as(c_int, 1) << @as(c_int, 22);
pub const COPYFILE_UNPACK = @as(c_int, 1) << @as(c_int, 23);
pub const COPYFILE_CLONE = @as(c_int, 1) << @as(c_int, 24);
pub const COPYFILE_CLONE_FORCE = @as(c_int, 1) << @as(c_int, 25);
pub const COPYFILE_RUN_IN_PLACE = @as(c_int, 1) << @as(c_int, 26);
pub const COPYFILE_DATA_SPARSE = @as(c_int, 1) << @as(c_int, 27);
pub const COPYFILE_PRESERVE_DST_TRACKED = @as(c_int, 1) << @as(c_int, 28);
pub const COPYFILE_VERBOSE = @as(c_int, 1) << @as(c_int, 30);
pub const COPYFILE_RECURSE_ERROR = @as(c_int, 0);
pub const COPYFILE_RECURSE_FILE = @as(c_int, 1);
pub const COPYFILE_RECURSE_DIR = @as(c_int, 2);
pub const COPYFILE_RECURSE_DIR_CLEANUP = @as(c_int, 3);
pub const COPYFILE_COPY_DATA = @as(c_int, 4);
pub const COPYFILE_COPY_XATTR = @as(c_int, 5);
pub const COPYFILE_START = @as(c_int, 1);
pub const COPYFILE_FINISH = @as(c_int, 2);
pub const COPYFILE_ERR = @as(c_int, 3);
pub const COPYFILE_PROGRESS = @as(c_int, 4);
pub const COPYFILE_CONTINUE = @as(c_int, 0);
pub const COPYFILE_SKIP = @as(c_int, 1);
pub const COPYFILE_QUIT = @as(c_int, 2);

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
//             else => switch (st.mode & os.S.IFMT) {
//                 os.S.IFBLK => Kind.BlockDevice,
//                 os.S.IFCHR => Kind.CharacterDevice,
//                 os.S.IFDIR => Kind.Directory,
//                 os.S.IFIFO => Kind.NamedPipe,
//                 os.S.IFLNK => Kind.SymLink,
//                 os.S.IFREG => Kind.File,
//                 os.S.IFSOCK => Kind.UnixDomainSocket,
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
    var rc = os.system.fcntl(fd, os.F.PREALLOCATE, &fstore);

    switch (rc) {
        0 => return,
        else => {
            fstore.fst_flags = F_ALLOCATEALL;
            rc = os.system.fcntl(fd, os.F.PREALLOCATE, &fstore);
        },
    }

    std.mem.doNotOptimizeAway(&fstore);
}
