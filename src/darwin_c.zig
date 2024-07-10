const std = @import("std");
const bun = @import("root").bun;
const builtin = @import("builtin");
const posix = std.posix;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;
const off_t = std.c.off_t;
const errno = posix.errno;
const zeroes = mem.zeroes;
const This = @This();
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
pub extern "c" fn clonefileat(c_int, [*:0]const u8, c_int, [*:0]const u8, uint32_t: c_int) c_int;
// int fclonefileat(int srcfd, int dst_dirfd, const char * dst, int flags);
pub extern "c" fn fclonefileat(c_int, c_int, [*:0]const u8, uint32_t: c_int) c_int;
// int clonefile(const char * src, const char * dst, int flags);
pub extern "c" fn clonefile(src: [*:0]const u8, dest: [*:0]const u8, flags: c_int) c_int;

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

// benchmarking this did nothing on macOS
// i verified it wasn't returning -1
pub fn preallocate_file(_: posix.fd_t, _: off_t, _: off_t) !void {
    //     pub const struct_fstore = extern struct {
    //     fst_flags: c_uint,
    //     fst_posmode: c_int,
    //     fst_offset: off_t,
    //     fst_length: off_t,
    //     fst_bytesalloc: off_t,
    // };
    // pub const fstore_t = struct_fstore;

    // pub const F_ALLOCATECONTIG = @as(c_int, 0x00000002);
    // pub const F_ALLOCATEALL = @as(c_int, 0x00000004);
    // pub const F_PEOFPOSMODE = @as(c_int, 3);
    // pub const F_VOLPOSMODE = @as(c_int, 4);
    // var fstore = zeroes(fstore_t);
    // fstore.fst_flags = F_ALLOCATECONTIG;
    // fstore.fst_posmode = F_PEOFPOSMODE;
    // fstore.fst_offset = 0;
    // fstore.fst_length = len + offset;

    // // Based on https://api.kde.org/frameworks/kcoreaddons/html/posix__fallocate__mac_8h_source.html
    // var rc = os.system.fcntl(fd, os.F.PREALLOCATE, &fstore);

    // switch (rc) {
    //     0 => return,
    //     else => {
    //         fstore.fst_flags = F_ALLOCATEALL;
    //         rc = os.system.fcntl(fd, os.F.PREALLOCATE, &fstore);
    //     },
    // }

    // std.mem.doNotOptimizeAway(&fstore);
}

pub const SystemErrno = enum(u8) {
    SUCCESS = 0,
    EPERM = 1,
    ENOENT = 2,
    ESRCH = 3,
    EINTR = 4,
    EIO = 5,
    ENXIO = 6,
    E2BIG = 7,
    ENOEXEC = 8,
    EBADF = 9,
    ECHILD = 10,
    EDEADLK = 11,
    ENOMEM = 12,
    EACCES = 13,
    EFAULT = 14,
    ENOTBLK = 15,
    EBUSY = 16,
    EEXIST = 17,
    EXDEV = 18,
    ENODEV = 19,
    ENOTDIR = 20,
    EISDIR = 21,
    EINVAL = 22,
    ENFILE = 23,
    EMFILE = 24,
    ENOTTY = 25,
    ETXTBSY = 26,
    EFBIG = 27,
    ENOSPC = 28,
    ESPIPE = 29,
    EROFS = 30,
    EMLINK = 31,
    EPIPE = 32,
    EDOM = 33,
    ERANGE = 34,
    EAGAIN = 35,
    EINPROGRESS = 36,
    EALREADY = 37,
    ENOTSOCK = 38,
    EDESTADDRREQ = 39,
    EMSGSIZE = 40,
    EPROTOTYPE = 41,
    ENOPROTOOPT = 42,
    EPROTONOSUPPORT = 43,
    ESOCKTNOSUPPORT = 44,
    ENOTSUP = 45,
    EPFNOSUPPORT = 46,
    EAFNOSUPPORT = 47,
    EADDRINUSE = 48,
    EADDRNOTAVAIL = 49,
    ENETDOWN = 50,
    ENETUNREACH = 51,
    ENETRESET = 52,
    ECONNABORTED = 53,
    ECONNRESET = 54,
    ENOBUFS = 55,
    EISCONN = 56,
    ENOTCONN = 57,
    ESHUTDOWN = 58,
    ETOOMANYREFS = 59,
    ETIMEDOUT = 60,
    ECONNREFUSED = 61,
    ELOOP = 62,
    ENAMETOOLONG = 63,
    EHOSTDOWN = 64,
    EHOSTUNREACH = 65,
    ENOTEMPTY = 66,
    EPROCLIM = 67,
    EUSERS = 68,
    EDQUOT = 69,
    ESTALE = 70,
    EREMOTE = 71,
    EBADRPC = 72,
    ERPCMISMATCH = 73,
    EPROGUNAVAIL = 74,
    EPROGMISMATCH = 75,
    EPROCUNAVAIL = 76,
    ENOLCK = 77,
    ENOSYS = 78,
    EFTYPE = 79,
    EAUTH = 80,
    ENEEDAUTH = 81,
    EPWROFF = 82,
    EDEVERR = 83,
    EOVERFLOW = 84,
    EBADEXEC = 85,
    EBADARCH = 86,
    ESHLIBVERS = 87,
    EBADMACHO = 88,
    ECANCELED = 89,
    EIDRM = 90,
    ENOMSG = 91,
    EILSEQ = 92,
    ENOATTR = 93,
    EBADMSG = 94,
    EMULTIHOP = 95,
    ENODATA = 96,
    ENOLINK = 97,
    ENOSR = 98,
    ENOSTR = 99,
    EPROTO = 100,
    ETIME = 101,
    EOPNOTSUPP = 102,
    ENOPOLICY = 103,
    ENOTRECOVERABLE = 104,
    EOWNERDEAD = 105,
    EQFULL = 106,

    pub const max = 107;

    pub fn init(code: anytype) ?SystemErrno {
        if (code < 0) {
            if (code <= -max) {
                return null;
            }
            return @enumFromInt(-code);
        }
        if (code >= max) return null;
        return @enumFromInt(code);
    }

    pub fn label(this: SystemErrno) ?[]const u8 {
        return labels.get(this) orelse null;
    }

    const LabelMap = std.EnumMap(SystemErrno, []const u8);
    pub const labels: LabelMap = brk: {
        var map: LabelMap = LabelMap.initFull("");
        map.put(.E2BIG, "Argument list too long");
        map.put(.EACCES, "Permission denied");
        map.put(.EADDRINUSE, "Address already in use");
        map.put(.EADDRNOTAVAIL, "Can't assign requested address");
        map.put(.EAFNOSUPPORT, "Address family not supported by protocol family");
        map.put(.EAGAIN, "non-blocking and interrupt i/o. Resource temporarily unavailable");
        map.put(.EALREADY, "Operation already in progress");
        map.put(.EAUTH, "Authentication error");
        map.put(.EBADARCH, "Bad CPU type in executable");
        map.put(.EBADEXEC, "Program loading errors. Bad executable");
        map.put(.EBADF, "Bad file descriptor");
        map.put(.EBADMACHO, "Malformed Macho file");
        map.put(.EBADMSG, "Bad message");
        map.put(.EBADRPC, "RPC struct is bad");
        map.put(.EBUSY, "Device / Resource busy");
        map.put(.ECANCELED, "Operation canceled");
        map.put(.ECHILD, "No child processes");
        map.put(.ECONNABORTED, "Software caused connection abort");
        map.put(.ECONNREFUSED, "Connection refused");
        map.put(.ECONNRESET, "Connection reset by peer");
        map.put(.EDEADLK, "Resource deadlock avoided");
        map.put(.EDESTADDRREQ, "Destination address required");
        map.put(.EDEVERR, "Device error, for example paper out");
        map.put(.EDOM, "math software. Numerical argument out of domain");
        map.put(.EDQUOT, "Disc quota exceeded");
        map.put(.EEXIST, "File or folder exists");
        map.put(.EFAULT, "Bad address");
        map.put(.EFBIG, "File too large");
        map.put(.EFTYPE, "Inappropriate file type or format");
        map.put(.EHOSTDOWN, "Host is down");
        map.put(.EHOSTUNREACH, "No route to host");
        map.put(.EIDRM, "Identifier removed");
        map.put(.EILSEQ, "Illegal byte sequence");
        map.put(.EINPROGRESS, "Operation now in progress");
        map.put(.EINTR, "Interrupted system call");
        map.put(.EINVAL, "Invalid argument");
        map.put(.EIO, "Input/output error");
        map.put(.EISCONN, "Socket is already connected");
        map.put(.EISDIR, "Is a directory");
        map.put(.ELOOP, "Too many levels of symbolic links");
        map.put(.EMFILE, "Too many open files");
        map.put(.EMLINK, "Too many links");
        map.put(.EMSGSIZE, "Message too long");
        map.put(.EMULTIHOP, "Reserved");
        map.put(.ENAMETOOLONG, "File name too long");
        map.put(.ENEEDAUTH, "Need authenticator");
        map.put(.ENETDOWN, "ipc/network software - operational errors Network is down");
        map.put(.ENETRESET, "Network dropped connection on reset");
        map.put(.ENETUNREACH, "Network is unreachable");
        map.put(.ENFILE, "Too many open files in system");
        map.put(.ENOATTR, "Attribute not found");
        map.put(.ENOBUFS, "No buffer space available");
        map.put(.ENODATA, "No message available on STREAM");
        map.put(.ENODEV, "Operation not supported by device");
        map.put(.ENOENT, "No such file or directory");
        map.put(.ENOEXEC, "Exec format error");
        map.put(.ENOLCK, "No locks available");
        map.put(.ENOLINK, "Reserved");
        map.put(.ENOMEM, "Cannot allocate memory");
        map.put(.ENOMSG, "No message of desired type");
        map.put(.ENOPOLICY, "No such policy registered");
        map.put(.ENOPROTOOPT, "Protocol not available");
        map.put(.ENOSPC, "No space left on device");
        map.put(.ENOSR, "No STREAM resources");
        map.put(.ENOSTR, "Not a STREAM");
        map.put(.ENOSYS, "Function not implemented");
        map.put(.ENOTBLK, "Block device required");
        map.put(.ENOTCONN, "Socket is not connected");
        map.put(.ENOTDIR, "Not a directory");
        map.put(.ENOTEMPTY, "Directory not empty");
        map.put(.ENOTRECOVERABLE, "State not recoverable");
        map.put(.ENOTSOCK, "ipc/network software - argument errors. Socket operation on non-socket");
        map.put(.ENOTSUP, "Operation not supported");
        map.put(.ENOTTY, "Inappropriate ioctl for device");
        map.put(.ENXIO, "Device not configured");
        map.put(.EOVERFLOW, "Value too large to be stored in data type");
        map.put(.EOWNERDEAD, "Previous owner died");
        map.put(.EPERM, "Operation not permitted");
        map.put(.EPFNOSUPPORT, "Protocol family not supported");
        map.put(.EPIPE, "Broken pipe");
        map.put(.EPROCLIM, "quotas & mush. Too many processes");
        map.put(.EPROCUNAVAIL, "Bad procedure for program");
        map.put(.EPROGMISMATCH, "Program version wrong");
        map.put(.EPROGUNAVAIL, "RPC prog. not avail");
        map.put(.EPROTO, "Protocol error");
        map.put(.EPROTONOSUPPORT, "Protocol not supported");
        map.put(.EPROTOTYPE, "Protocol wrong type for socket");
        map.put(.EPWROFF, "Intelligent device errors. Device power is off");
        map.put(.EQFULL, "Interface output queue is full");
        map.put(.ERANGE, "Result too large");
        map.put(.EREMOTE, "Too many levels of remote in path");
        map.put(.EROFS, "Read-only file system");
        map.put(.ERPCMISMATCH, "RPC version wrong");
        map.put(.ESHLIBVERS, "Shared library version mismatch");
        map.put(.ESHUTDOWN, "Can’t send after socket shutdown");
        map.put(.ESOCKTNOSUPPORT, "Socket type not supported");
        map.put(.ESPIPE, "Illegal seek");
        map.put(.ESRCH, "No such process");
        map.put(.ESTALE, "Network File System. Stale NFS file handle");
        map.put(.ETIME, "STREAM ioctl timeout");
        map.put(.ETIMEDOUT, "Operation timed out");
        map.put(.ETOOMANYREFS, "Too many references: can't splice");
        map.put(.ETXTBSY, "Text file busy");
        map.put(.EUSERS, "Too many users");
        // map.put(.EWOULDBLOCK, "Operation would block");
        map.put(.EXDEV, "Cross-device link");
        break :brk map;
    };
};

// Courtesy of https://github.com/nodejs/node/blob/master/deps/uv/src/unix/darwin-stub.h
pub const struct_CFArrayCallBacks = opaque {};
pub const CFIndex = c_long;
pub const struct_CFRunLoopSourceContext = extern struct {
    version: CFIndex,
    info: ?*anyopaque,
    pad: [7]?*anyopaque,
    perform: ?*const fn (?*anyopaque) callconv(.C) void,
};
pub const struct_FSEventStreamContext = extern struct {
    version: CFIndex,
    info: ?*anyopaque,
    pad: [3]?*anyopaque,
};
pub const struct_CFRange = extern struct {
    location: CFIndex,
    length: CFIndex,
};
pub const CFAbsoluteTime = f64;
pub const CFTimeInterval = f64;
pub const FSEventStreamEventFlags = c_int;
pub const OSStatus = c_int;
pub const CFArrayCallBacks = struct_CFArrayCallBacks;
pub const CFRunLoopSourceContext = struct_CFRunLoopSourceContext;
pub const FSEventStreamContext = struct_FSEventStreamContext;
pub const FSEventStreamCreateFlags = u32;
pub const FSEventStreamEventId = u64;
pub const CFStringEncoding = c_uint;
pub const CFAllocatorRef = ?*anyopaque;
pub const CFArrayRef = ?*anyopaque;
pub const CFBundleRef = ?*anyopaque;
pub const CFDataRef = ?*anyopaque;
pub const CFDictionaryRef = ?*anyopaque;
pub const CFMutableDictionaryRef = ?*anyopaque;
pub const CFRange = struct_CFRange;
pub const CFRunLoopRef = ?*anyopaque;
pub const CFRunLoopSourceRef = ?*anyopaque;
pub const CFStringRef = ?*anyopaque;
pub const CFTypeRef = ?*anyopaque;
pub const FSEventStreamRef = ?*anyopaque;
pub const IOOptionBits = u32;
pub const io_iterator_t = c_uint;
pub const io_object_t = c_uint;
pub const io_service_t = c_uint;
pub const io_registry_entry_t = c_uint;
pub const FSEventStreamCallback = ?*const fn (FSEventStreamRef, ?*anyopaque, c_int, ?*anyopaque, [*c]const FSEventStreamEventFlags, [*c]const FSEventStreamEventId) callconv(.C) void;
pub const kCFStringEncodingUTF8: CFStringEncoding = @as(CFStringEncoding, @bitCast(@as(c_int, 134217984)));
pub const noErr: OSStatus = 0;
pub const kFSEventStreamEventIdSinceNow: FSEventStreamEventId = @as(FSEventStreamEventId, @bitCast(@as(c_longlong, -@as(c_int, 1))));
pub const kFSEventStreamCreateFlagNoDefer: c_int = 2;
pub const kFSEventStreamCreateFlagFileEvents: c_int = 16;
pub const kFSEventStreamEventFlagEventIdsWrapped: c_int = 8;
pub const kFSEventStreamEventFlagHistoryDone: c_int = 16;
pub const kFSEventStreamEventFlagItemChangeOwner: c_int = 16384;
pub const kFSEventStreamEventFlagItemCreated: c_int = 256;
pub const kFSEventStreamEventFlagItemFinderInfoMod: c_int = 8192;
pub const kFSEventStreamEventFlagItemInodeMetaMod: c_int = 1024;
pub const kFSEventStreamEventFlagItemIsDir: c_int = 131072;
pub const kFSEventStreamEventFlagItemModified: c_int = 4096;
pub const kFSEventStreamEventFlagItemRemoved: c_int = 512;
pub const kFSEventStreamEventFlagItemRenamed: c_int = 2048;
pub const kFSEventStreamEventFlagItemXattrMod: c_int = 32768;
pub const kFSEventStreamEventFlagKernelDropped: c_int = 4;
pub const kFSEventStreamEventFlagMount: c_int = 64;
pub const kFSEventStreamEventFlagRootChanged: c_int = 32;
pub const kFSEventStreamEventFlagUnmount: c_int = 128;
pub const kFSEventStreamEventFlagUserDropped: c_int = 2;

pub fn getFreeMemory() u64 {
    // NOT IMPLEMENTED YET
    return 1024 * 1024;
}

pub fn getTotalMemory() u64 {
    var memory_: [32]c_ulonglong = undefined;
    var size: usize = memory_.len;

    std.posix.sysctlbynameZ(
        "hw.memsize",
        &memory_,
        &size,
        null,
        0,
    ) catch |err| switch (err) {
        else => return 0,
    };

    return memory_[0];
}

pub const struct_BootTime = struct {
    sec: u32,
};
pub fn getSystemUptime() u64 {
    var uptime_: [16]struct_BootTime = undefined;
    var size: usize = uptime_.len;

    std.posix.sysctlbynameZ(
        "kern.boottime",
        &uptime_,
        &size,
        null,
        0,
    ) catch |err| switch (err) {
        else => return 0,
    };

    return @as(u64, @bitCast(std.time.timestamp() - uptime_[0].sec));
}

pub const struct_LoadAvg = struct {
    ldavg: [3]u32,
    fscale: c_long,
};
pub fn getSystemLoadavg() [3]f64 {
    var loadavg_: [24]struct_LoadAvg = undefined;
    var size: usize = loadavg_.len;

    std.posix.sysctlbynameZ(
        "vm.loadavg",
        &loadavg_,
        &size,
        null,
        0,
    ) catch |err| switch (err) {
        else => return [3]f64{ 0, 0, 0 },
    };

    const loadavg = loadavg_[0];
    const scale = @as(f64, @floatFromInt(loadavg.fscale));
    return .{
        if (scale == 0.0) 0 else @as(f64, @floatFromInt(loadavg.ldavg[0])) / scale,
        if (scale == 0.0) 0 else @as(f64, @floatFromInt(loadavg.ldavg[1])) / scale,
        if (scale == 0.0) 0 else @as(f64, @floatFromInt(loadavg.ldavg[2])) / scale,
    };
}

pub const processor_flavor_t = c_int;

// https://opensource.apple.com/source/xnu/xnu-792/osfmk/mach/processor_info.h.auto.html
pub const PROCESSOR_CPU_LOAD_INFO: processor_flavor_t = 2;
// https://opensource.apple.com/source/xnu/xnu-792/osfmk/mach/machine.h.auto.html
pub const CPU_STATE_MAX = 4;
pub const processor_cpu_load_info = extern struct {
    cpu_ticks: [CPU_STATE_MAX]c_uint,
};
pub const PROCESSOR_CPU_LOAD_INFO_COUNT = @as(std.c.mach_msg_type_number_t, @sizeOf(processor_cpu_load_info) / @sizeOf(std.c.natural_t));
pub const processor_info_array_t = [*]c_int;
pub const PROCESSOR_INFO_MAX = 1024;

pub extern fn host_processor_info(host: std.c.host_t, flavor: processor_flavor_t, out_processor_count: *std.c.natural_t, out_processor_info: *processor_info_array_t, out_processor_infoCnt: *std.c.mach_msg_type_number_t) std.c.E;

pub extern fn getuid(...) std.posix.uid_t;
pub extern fn getgid(...) std.posix.gid_t;

pub extern fn get_process_priority(pid: c_uint) i32;
pub extern fn set_process_priority(pid: c_uint, priority: c_int) i32;

pub fn get_version(buf: []u8) []const u8 {
    @memset(buf, 0);

    var size: usize = buf.len;

    if (std.c.sysctlbyname(
        "kern.version",
        buf.ptr,
        &size,
        null,
        0,
    ) == -1) return "unknown";

    return bun.sliceTo(buf, 0);
}

pub fn get_release(buf: []u8) []const u8 {
    @memset(buf, 0);

    var size: usize = buf.len;

    if (std.c.sysctlbyname(
        "kern.osrelease",
        buf.ptr,
        &size,
        null,
        0,
    ) == -1) return "unknown";

    return bun.sliceTo(buf, 0);
}

const IO_CTL_RELATED = struct {
    pub const IOCPARM_MASK = @as(c_int, 0x1fff);
    pub inline fn IOCPARM_LEN(x: anytype) @TypeOf((x >> @as(c_int, 16)) & IOCPARM_MASK) {
        return (x >> @as(c_int, 16)) & IOCPARM_MASK;
    }
    pub inline fn IOCBASECMD(x: anytype) @TypeOf(x & ~(IOCPARM_MASK << @as(c_int, 16))) {
        return x & ~(IOCPARM_MASK << @as(c_int, 16));
    }
    pub inline fn IOCGROUP(x: anytype) @TypeOf((x >> @as(c_int, 8)) & @as(c_int, 0xff)) {
        return (x >> @as(c_int, 8)) & @as(c_int, 0xff);
    }
    pub const IOCPARM_MAX = IOCPARM_MASK + @as(c_int, 1);
    pub const IOC_VOID = @import("std").zig.c_translation.cast(u32, @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x20000000, .hex));
    pub const IOC_OUT = @import("std").zig.c_translation.cast(u32, @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x40000000, .hex));
    pub const IOC_IN = @import("std").zig.c_translation.cast(u32, @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x80000000, .hex));
    pub const IOC_INOUT = IOC_IN | IOC_OUT;
    pub const IOC_DIRMASK = @import("std").zig.c_translation.cast(u32, @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xe0000000, .hex));
    pub inline fn _IOC(inout: anytype, group: anytype, num: anytype, len: anytype) @TypeOf(((inout | ((len & IOCPARM_MASK) << @as(c_int, 16))) | (group << @as(c_int, 8))) | num) {
        return ((inout | ((len & IOCPARM_MASK) << @as(c_int, 16))) | (group << @as(c_int, 8))) | num;
    }
    pub inline fn _IO(g: anytype, n: anytype) @TypeOf(_IOC(IOC_VOID, g, n, @as(c_int, 0))) {
        return _IOC(IOC_VOID, g, n, @as(c_int, 0));
    }
    pub inline fn _IOR(g: anytype, n: anytype, t: anytype) @TypeOf(_IOC(IOC_OUT, g, n, @import("std").zig.c_translation.sizeof(t))) {
        return _IOC(IOC_OUT, g, n, @import("std").zig.c_translation.sizeof(t));
    }
    pub inline fn _IOW(g: anytype, n: anytype, t: anytype) @TypeOf(_IOC(IOC_IN, g, n, @import("std").zig.c_translation.sizeof(t))) {
        return _IOC(IOC_IN, g, n, @import("std").zig.c_translation.sizeof(t));
    }
    pub inline fn _IOWR(g: anytype, n: anytype, t: anytype) @TypeOf(_IOC(IOC_INOUT, g, n, @import("std").zig.c_translation.sizeof(t))) {
        return _IOC(IOC_INOUT, g, n, @import("std").zig.c_translation.sizeof(t));
    }
    pub const TIOCMODG = _IOR('t', @as(c_int, 3), c_int);
    pub const TIOCMODS = _IOW('t', @as(c_int, 4), c_int);
    pub const TIOCM_LE = @as(c_int, 0o001);
    pub const TIOCM_DTR = @as(c_int, 0o002);
    pub const TIOCM_RTS = @as(c_int, 0o004);
    pub const TIOCM_ST = @as(c_int, 0o010);
    pub const TIOCM_SR = @as(c_int, 0o020);
    pub const TIOCM_CTS = @as(c_int, 0o040);
    pub const TIOCM_CAR = @as(c_int, 0o100);
    pub const TIOCM_CD = TIOCM_CAR;
    pub const TIOCM_RNG = @as(c_int, 0o200);
    pub const TIOCM_RI = TIOCM_RNG;
    pub const TIOCM_DSR = @as(c_int, 0o400);
    pub const TIOCEXCL = _IO('t', @as(c_int, 13));
    pub const TIOCNXCL = _IO('t', @as(c_int, 14));
    pub const TIOCFLUSH = _IOW('t', @as(c_int, 16), c_int);
    pub const TIOCGETD = _IOR('t', @as(c_int, 26), c_int);
    pub const TIOCSETD = _IOW('t', @as(c_int, 27), c_int);
    pub const TIOCIXON = _IO('t', @as(c_int, 129));
    pub const TIOCIXOFF = _IO('t', @as(c_int, 128));
    pub const TIOCSBRK = _IO('t', @as(c_int, 123));
    pub const TIOCCBRK = _IO('t', @as(c_int, 122));
    pub const TIOCSDTR = _IO('t', @as(c_int, 121));
    pub const TIOCCDTR = _IO('t', @as(c_int, 120));
    pub const TIOCGPGRP = _IOR('t', @as(c_int, 119), c_int);
    pub const TIOCSPGRP = _IOW('t', @as(c_int, 118), c_int);
    pub const TIOCOUTQ = _IOR('t', @as(c_int, 115), c_int);
    pub const TIOCSTI = _IOW('t', @as(c_int, 114), u8);
    pub const TIOCNOTTY = _IO('t', @as(c_int, 113));
    pub const TIOCPKT = _IOW('t', @as(c_int, 112), c_int);
    pub const TIOCPKT_DATA = @as(c_int, 0x00);
    pub const TIOCPKT_FLUSHREAD = @as(c_int, 0x01);
    pub const TIOCPKT_FLUSHWRITE = @as(c_int, 0x02);
    pub const TIOCPKT_STOP = @as(c_int, 0x04);
    pub const TIOCPKT_START = @as(c_int, 0x08);
    pub const TIOCPKT_NOSTOP = @as(c_int, 0x10);
    pub const TIOCPKT_DOSTOP = @as(c_int, 0x20);
    pub const TIOCPKT_IOCTL = @as(c_int, 0x40);
    pub const TIOCSTOP = _IO('t', @as(c_int, 111));
    pub const TIOCSTART = _IO('t', @as(c_int, 110));
    pub const TIOCMSET = _IOW('t', @as(c_int, 109), c_int);
    pub const TIOCMBIS = _IOW('t', @as(c_int, 108), c_int);
    pub const TIOCMBIC = _IOW('t', @as(c_int, 107), c_int);
    pub const TIOCMGET = _IOR('t', @as(c_int, 106), c_int);
    // pub const TIOCGWINSZ = _IOR('t', @as(c_int, 104), struct_winsize);
    // pub const TIOCSWINSZ = _IOW('t', @as(c_int, 103), struct_winsize);
    pub const TIOCUCNTL = _IOW('t', @as(c_int, 102), c_int);
    pub const TIOCSTAT = _IO('t', @as(c_int, 101));
    pub inline fn UIOCCMD(n: anytype) @TypeOf(_IO('u', n)) {
        return _IO('u', n);
    }
    pub const TIOCSCONS = _IO('t', @as(c_int, 99));
    pub const TIOCCONS = _IOW('t', @as(c_int, 98), c_int);
    pub const TIOCSCTTY = _IO('t', @as(c_int, 97));
    pub const TIOCEXT = _IOW('t', @as(c_int, 96), c_int);
    pub const TIOCSIG = _IO('t', @as(c_int, 95));
    pub const TIOCDRAIN = _IO('t', @as(c_int, 94));
    pub const TIOCMSDTRWAIT = _IOW('t', @as(c_int, 91), c_int);
    pub const TIOCMGDTRWAIT = _IOR('t', @as(c_int, 90), c_int);
    pub const TIOCSDRAINWAIT = _IOW('t', @as(c_int, 87), c_int);
    pub const TIOCGDRAINWAIT = _IOR('t', @as(c_int, 86), c_int);
    pub const TIOCDSIMICROCODE = _IO('t', @as(c_int, 85));
    pub const TIOCPTYGRANT = _IO('t', @as(c_int, 84));
    pub const TIOCPTYGNAME = _IOC(IOC_OUT, 't', @as(c_int, 83), @as(c_int, 128));
    pub const TIOCPTYUNLK = _IO('t', @as(c_int, 82));
    pub const TTYDISC = @as(c_int, 0);
    pub const TABLDISC = @as(c_int, 3);
    pub const SLIPDISC = @as(c_int, 4);
    pub const PPPDISC = @as(c_int, 5);
    // pub const TIOCGSIZE = TIOCGWINSZ;
    // pub const TIOCSSIZE = TIOCSWINSZ;
    pub const FIOCLEX = _IO('f', @as(c_int, 1));
    pub const FIONCLEX = _IO('f', @as(c_int, 2));
    pub const FIONREAD = _IOR('f', @as(c_int, 127), c_int);
    pub const FIONBIO = _IOW('f', @as(c_int, 126), c_int);
    pub const FIOASYNC = _IOW('f', @as(c_int, 125), c_int);
    pub const FIOSETOWN = _IOW('f', @as(c_int, 124), c_int);
    pub const FIOGETOWN = _IOR('f', @as(c_int, 123), c_int);
    pub const FIODTYPE = _IOR('f', @as(c_int, 122), c_int);
    pub const SIOCSHIWAT = _IOW('s', @as(c_int, 0), c_int);
    pub const SIOCGHIWAT = _IOR('s', @as(c_int, 1), c_int);
    pub const SIOCSLOWAT = _IOW('s', @as(c_int, 2), c_int);
    pub const SIOCGLOWAT = _IOR('s', @as(c_int, 3), c_int);
    pub const SIOCATMARK = _IOR('s', @as(c_int, 7), c_int);
    pub const SIOCSPGRP = _IOW('s', @as(c_int, 8), c_int);
    pub const SIOCGPGRP = _IOR('s', @as(c_int, 9), c_int);
    // pub const SIOCSETVLAN = SIOCSIFVLAN;
    // pub const SIOCGETVLAN = SIOCGIFVLAN;
};

pub usingnamespace IO_CTL_RELATED;

// As of Zig v0.11.0-dev.1393+38eebf3c4, ifaddrs.h is not included in the headers
pub const ifaddrs = extern struct {
    ifa_next: ?*ifaddrs,
    ifa_name: [*:0]u8,
    ifa_flags: c_uint,
    ifa_addr: ?*std.posix.sockaddr,
    ifa_netmask: ?*std.posix.sockaddr,
    ifa_dstaddr: ?*std.posix.sockaddr,
    ifa_data: *anyopaque,
};
pub extern fn getifaddrs(*?*ifaddrs) c_int;
pub extern fn freeifaddrs(?*ifaddrs) void;

const net_if_h = @cImport({
    @cInclude("net/if.h");
});
pub const IFF_RUNNING = net_if_h.IFF_RUNNING;
pub const IFF_UP = net_if_h.IFF_UP;
pub const IFF_LOOPBACK = net_if_h.IFF_LOOPBACK;
pub const sockaddr_dl = extern struct {
    sdl_len: u8, // Total length of sockaddr */
    sdl_family: u8, // AF_LINK */
    sdl_index: u16, // if != 0, system given index for interface */
    sdl_type: u8, // interface type */
    sdl_nlen: u8, // interface name length, no trailing 0 reqd. */
    sdl_alen: u8, // link level address length */
    sdl_slen: u8, // link layer selector length */
    sdl_data: [12]u8, // minimum work area, can be larger; contains both if name and ll address */
    //#ifndef __APPLE__
    //	/* For TokenRing */
    //	u_short sdl_rcf;        /* source routing control */
    //	u_short sdl_route[16];  /* source routing information */
    //#endif
};

pub usingnamespace @cImport({
    @cInclude("sys/spawn.h");
    @cInclude("sys/fcntl.h");
    @cInclude("sys/socket.h");
});

pub const F = struct {
    pub const DUPFD_CLOEXEC = This.F_DUPFD_CLOEXEC;
    pub const DUPFD = This.F_DUPFD;
};

// it turns out preallocating on APFS on an M1 is slower.
// so this is a linux-only optimization for now.
pub const preallocate_length = std.math.maxInt(u51);

pub const Mode = std.posix.mode_t;

pub const E = std.posix.E;
pub const S = std.posix.S;

pub fn getErrno(rc: anytype) E {
    if (rc == -1) {
        return @enumFromInt(std.c._errno().*);
    } else {
        return .SUCCESS;
    }
}

pub extern "c" fn umask(Mode) Mode;

// #define RENAME_SECLUDE                  0x00000001
// #define RENAME_SWAP                     0x00000002
// #define RENAME_EXCL                     0x00000004
// #define RENAME_RESERVED1                0x00000008
// #define RENAME_NOFOLLOW_ANY             0x00000010
pub const RENAME_SECLUDE = 0x00000001;
pub const RENAME_SWAP = 0x00000002;
pub const RENAME_EXCL = 0x00000004;
pub const RENAME_RESERVED1 = 0x00000008;
pub const RENAME_NOFOLLOW_ANY = 0x00000010;

// int renameatx_np(int fromfd, const char *from, int tofd, const char *to, unsigned int flags);
pub extern "c" fn renameatx_np(fromfd: c_int, from: ?[*:0]const u8, tofd: c_int, to: ?[*:0]const u8, flags: c_uint) c_int;

pub const CLOCK_REALTIME = 0;
pub const CLOCK_MONOTONIC = 6;
pub const CLOCK_MONOTONIC_RAW = 4;
pub const CLOCK_MONOTONIC_RAW_APPROX = 5;
pub const CLOCK_UPTIME_RAW = 8;
pub const CLOCK_UPTIME_RAW_APPROX = 9;
pub const CLOCK_PROCESS_CPUTIME_ID = 12;
pub const CLOCK_THREAD_CPUTIME_ID = 1;

pub const netdb = @cImport({
    @cInclude("netdb.h");
});
