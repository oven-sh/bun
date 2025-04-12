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

pub extern "c" fn memmem(haystack: [*]const u8, haystacklen: usize, needle: [*]const u8, needlelen: usize) ?[*]const u8;

// int clonefileat(int src_dirfd, const char * src, int dst_dirfd, const char * dst, int flags);
pub extern "c" fn clonefileat(c_int, [*:0]const u8, c_int, [*:0]const u8, uint32_t: c_int) c_int;
// int fclonefileat(int srcfd, int dst_dirfd, const char * dst, int flags);
pub extern "c" fn fclonefileat(c_int, c_int, [*:0]const u8, uint32_t: c_int) c_int;
// int clonefile(const char * src, const char * dst, int flags);
pub extern "c" fn clonefile(src: [*:0]const u8, dest: [*:0]const u8, flags: c_int) c_int;

pub const lstat = blk: {
    const T = *const fn (?[*:0]const u8, ?*bun.Stat) callconv(.C) c_int;
    break :blk @extern(T, .{ .name = if (bun.Environment.isAarch64) "lstat" else "lstat64" });
};

pub const fstat = blk: {
    const T = *const fn (i32, ?*bun.Stat) callconv(.C) c_int;
    break :blk @extern(T, .{ .name = if (bun.Environment.isAarch64) "fstat" else "fstat64" });
};
pub const stat = blk: {
    const T = *const fn (?[*:0]const u8, ?*bun.Stat) callconv(.C) c_int;
    break :blk @extern(T, .{ .name = if (bun.Environment.isAarch64) "stat" else "stat64" });
};
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
};

pub const UV_E2BIG: i32 = @intFromEnum(SystemErrno.E2BIG);
pub const UV_EACCES: i32 = @intFromEnum(SystemErrno.EACCES);
pub const UV_EADDRINUSE: i32 = @intFromEnum(SystemErrno.EADDRINUSE);
pub const UV_EADDRNOTAVAIL: i32 = @intFromEnum(SystemErrno.EADDRNOTAVAIL);
pub const UV_EAFNOSUPPORT: i32 = @intFromEnum(SystemErrno.EAFNOSUPPORT);
pub const UV_EAGAIN: i32 = @intFromEnum(SystemErrno.EAGAIN);
pub const UV_EALREADY: i32 = @intFromEnum(SystemErrno.EALREADY);
pub const UV_EBADF: i32 = @intFromEnum(SystemErrno.EBADF);
pub const UV_EBUSY: i32 = @intFromEnum(SystemErrno.EBUSY);
pub const UV_ECANCELED: i32 = @intFromEnum(SystemErrno.ECANCELED);
pub const UV_ECHARSET: i32 = -bun.windows.libuv.UV__ECHARSET;
pub const UV_ECONNABORTED: i32 = @intFromEnum(SystemErrno.ECONNABORTED);
pub const UV_ECONNREFUSED: i32 = @intFromEnum(SystemErrno.ECONNREFUSED);
pub const UV_ECONNRESET: i32 = @intFromEnum(SystemErrno.ECONNRESET);
pub const UV_EDESTADDRREQ: i32 = @intFromEnum(SystemErrno.EDESTADDRREQ);
pub const UV_EEXIST: i32 = @intFromEnum(SystemErrno.EEXIST);
pub const UV_EFAULT: i32 = @intFromEnum(SystemErrno.EFAULT);
pub const UV_EHOSTUNREACH: i32 = @intFromEnum(SystemErrno.EHOSTUNREACH);
pub const UV_EINTR: i32 = @intFromEnum(SystemErrno.EINTR);
pub const UV_EINVAL: i32 = @intFromEnum(SystemErrno.EINVAL);
pub const UV_EIO: i32 = @intFromEnum(SystemErrno.EIO);
pub const UV_EISCONN: i32 = @intFromEnum(SystemErrno.EISCONN);
pub const UV_EISDIR: i32 = @intFromEnum(SystemErrno.EISDIR);
pub const UV_ELOOP: i32 = @intFromEnum(SystemErrno.ELOOP);
pub const UV_EMFILE: i32 = @intFromEnum(SystemErrno.EMFILE);
pub const UV_EMSGSIZE: i32 = @intFromEnum(SystemErrno.EMSGSIZE);
pub const UV_ENAMETOOLONG: i32 = @intFromEnum(SystemErrno.ENAMETOOLONG);
pub const UV_ENETDOWN: i32 = @intFromEnum(SystemErrno.ENETDOWN);
pub const UV_ENETUNREACH: i32 = @intFromEnum(SystemErrno.ENETUNREACH);
pub const UV_ENFILE: i32 = @intFromEnum(SystemErrno.ENFILE);
pub const UV_ENOBUFS: i32 = @intFromEnum(SystemErrno.ENOBUFS);
pub const UV_ENODEV: i32 = @intFromEnum(SystemErrno.ENODEV);
pub const UV_ENOENT: i32 = @intFromEnum(SystemErrno.ENOENT);
pub const UV_ENOMEM: i32 = @intFromEnum(SystemErrno.ENOMEM);
pub const UV_ENONET: i32 = -bun.windows.libuv.UV_ENONET;
pub const UV_ENOSPC: i32 = @intFromEnum(SystemErrno.ENOSPC);
pub const UV_ENOSYS: i32 = @intFromEnum(SystemErrno.ENOSYS);
pub const UV_ENOTCONN: i32 = @intFromEnum(SystemErrno.ENOTCONN);
pub const UV_ENOTDIR: i32 = @intFromEnum(SystemErrno.ENOTDIR);
pub const UV_ENOTEMPTY: i32 = @intFromEnum(SystemErrno.ENOTEMPTY);
pub const UV_ENOTSOCK: i32 = @intFromEnum(SystemErrno.ENOTSOCK);
pub const UV_ENOTSUP: i32 = @intFromEnum(SystemErrno.ENOTSUP);
pub const UV_EPERM: i32 = @intFromEnum(SystemErrno.EPERM);
pub const UV_EPIPE: i32 = @intFromEnum(SystemErrno.EPIPE);
pub const UV_EPROTO: i32 = @intFromEnum(SystemErrno.EPROTO);
pub const UV_EPROTONOSUPPORT: i32 = @intFromEnum(SystemErrno.EPROTONOSUPPORT);
pub const UV_EPROTOTYPE: i32 = @intFromEnum(SystemErrno.EPROTOTYPE);
pub const UV_EROFS: i32 = @intFromEnum(SystemErrno.EROFS);
pub const UV_ESHUTDOWN: i32 = @intFromEnum(SystemErrno.ESHUTDOWN);
pub const UV_ESPIPE: i32 = @intFromEnum(SystemErrno.ESPIPE);
pub const UV_ESRCH: i32 = @intFromEnum(SystemErrno.ESRCH);
pub const UV_ETIMEDOUT: i32 = @intFromEnum(SystemErrno.ETIMEDOUT);
pub const UV_ETXTBSY: i32 = @intFromEnum(SystemErrno.ETXTBSY);
pub const UV_EXDEV: i32 = @intFromEnum(SystemErrno.EXDEV);
pub const UV_EFBIG: i32 = @intFromEnum(SystemErrno.EFBIG);
pub const UV_ENOPROTOOPT: i32 = @intFromEnum(SystemErrno.ENOPROTOOPT);
pub const UV_ERANGE: i32 = @intFromEnum(SystemErrno.ERANGE);
pub const UV_ENXIO: i32 = @intFromEnum(SystemErrno.ENXIO);
pub const UV_EMLINK: i32 = @intFromEnum(SystemErrno.EMLINK);
pub const UV_EHOSTDOWN: i32 = @intFromEnum(SystemErrno.EHOSTDOWN);
pub const UV_EREMOTEIO: i32 = -bun.windows.libuv.UV_EREMOTEIO;
pub const UV_ENOTTY: i32 = @intFromEnum(SystemErrno.ENOTTY);
pub const UV_EFTYPE: i32 = @intFromEnum(SystemErrno.EFTYPE);
pub const UV_EILSEQ: i32 = @intFromEnum(SystemErrno.EILSEQ);
pub const UV_EOVERFLOW: i32 = @intFromEnum(SystemErrno.EOVERFLOW);
pub const UV_ESOCKTNOSUPPORT: i32 = @intFromEnum(SystemErrno.ESOCKTNOSUPPORT);
pub const UV_ENODATA: i32 = @intFromEnum(SystemErrno.ENODATA);
pub const UV_EUNATCH: i32 = -bun.windows.libuv.UV_EUNATCH;

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
    return @extern(*const fn () callconv(.C) u64, .{ .name = "Bun__Os__getFreeMemory" })();
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

pub fn getSystemUptime() u64 {
    var boot_time: std.posix.timeval = undefined;
    var size: usize = @sizeOf(@TypeOf(boot_time));

    std.posix.sysctlbynameZ(
        "kern.boottime",
        &boot_time,
        &size,
        null,
        0,
    ) catch |err| switch (err) {
        else => return 0,
    };

    return @intCast(std.time.timestamp() - boot_time.sec);
}

pub fn getSystemLoadavg() [3]f64 {
    var loadavg: bun.c.struct_loadavg = undefined;
    var size: usize = @sizeOf(@TypeOf(loadavg));

    std.posix.sysctlbynameZ(
        "vm.loadavg",
        &loadavg,
        &size,
        null,
        0,
    ) catch |err| switch (err) {
        else => return [3]f64{ 0, 0, 0 },
    };

    const scale: f64 = @floatFromInt(loadavg.fscale);
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

pub const IFF_RUNNING = bun.c.IFF_RUNNING;
pub const IFF_UP = bun.c.IFF_UP;
pub const IFF_LOOPBACK = bun.c.IFF_LOOPBACK;
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
    //    /* For TokenRing */
    //    u_short sdl_rcf;        /* source routing control */
    //    u_short sdl_route[16];  /* source routing information */
    //#endif
};

pub const F = struct {
    pub const DUPFD_CLOEXEC = bun.c.F_DUPFD_CLOEXEC;
    pub const DUPFD = bun.c.F_DUPFD;
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

pub extern fn memset_pattern4(buf: [*]u8, pattern: [*]const u8, len: usize) void;
pub extern fn memset_pattern8(buf: [*]u8, pattern: [*]const u8, len: usize) void;
pub extern fn memset_pattern16(buf: [*]u8, pattern: [*]const u8, len: usize) void;

pub const OSLog = opaque {
    pub const Category = enum(u8) {
        PointsOfInterest = 0,
        Dynamicity = 1,
        SizeAndThroughput = 2,
        TimeProfile = 3,
        SystemReporting = 4,
        UserCustom = 5,
    };

    // Common subsystems that Instruments recognizes
    pub const Subsystem = struct {
        pub const Network = "com.apple.network";
        pub const FileIO = "com.apple.disk_io";
        pub const Graphics = "com.apple.graphics";
        pub const Memory = "com.apple.memory";
        pub const Performance = "com.apple.performance";
    };

    extern "C" fn os_log_create(subsystem: ?[*:0]const u8, category: ?[*:0]const u8) ?*OSLog;

    pub fn init() ?*OSLog {
        return os_log_create("com.bun.bun", "PointsOfInterest");
    }

    // anything except 0 and ~0 is a valid signpost id
    var signpost_id_counter = std.atomic.Value(u64).init(1);

    pub fn signpost(log: *OSLog, name: i32) Signpost {
        return .{
            .id = signpost_id_counter.fetchAdd(1, .monotonic),
            .name = name,
            .log = log,
        };
    }

    const SignpostType = enum(u8) {
        Event = 0,
        IntervalBegin = 1,
        IntervalEnd = 2,
    };

    pub extern "C" fn Bun__signpost_emit(log: *OSLog, id: u64, signpost_type: SignpostType, name: i32, category: u8) void;

    pub const Signpost = struct {
        id: u64,
        name: i32,
        log: *OSLog,

        pub fn emit(this: *const Signpost, category: Category) void {
            Bun__signpost_emit(this.log, this.id, .Event, this.name, @intFromEnum(category));
        }

        pub const Interval = struct {
            signpost: Signpost,
            category: Category,

            pub fn end(this: *const Interval) void {
                Bun__signpost_emit(this.signpost.log, this.signpost.id, .IntervalEnd, this.signpost.name, @intFromEnum(this.category));
            }
        };

        pub fn interval(this: Signpost, category: Category) Interval {
            Bun__signpost_emit(this.log, this.id, .IntervalBegin, this.name, @intFromEnum(category));
            return Interval{
                .signpost = this,
                .category = category,
            };
        }
    };
};
