const std = @import("std");
const bun = @import("root").bun;
const builtin = @import("builtin");
const os = std.os;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;
const off_t = std.c.off_t;
const errno = os.errno;
const zeroes = mem.zeroes;

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
    var memory_: u64 = 0;
    var size: usize = @sizeOf(@TypeOf(memory_));

    const HW_PHYSMEM64: [2]c_int = [_]c_int{ std.c.CTL.HW, std.c.HW.USERMEM64 };

    if (!(std.c.sysctl(&HW_PHYSMEM64, 2, &memory_, &size, null, 0) == 0)) {
        return 0;
    }

    return memory_;
}

pub fn getTotalMemory() u64 {
    var memory_: u64 = 0;
    var size: usize = @sizeOf(@TypeOf(memory_));

    const HW_PHYSMEM64: [2]c_int = [_]c_int{ std.c.CTL.HW, std.c.HW.PHYSMEM64 };

    if (!(std.c.sysctl(&HW_PHYSMEM64, 2, &memory_, &size, null, 0) == 0)) {
        return 0;
    }

    return memory_;
}

pub const struct_BootTime = struct {
    sec: u32,
};

pub fn getSystemUptime() u64 {
    var uptime_: [16]struct_BootTime = undefined;
    var size: usize = uptime_.len;

    const KERN_BOOTTIME: [2]c_int = [_]c_int{ std.c.CTL.KERN, std.c.KERN.BOOTTIME };

    if (!(std.c.sysctl(&KERN_BOOTTIME, 2, &uptime_, &size, null, 0) == 0)) {
        return 0;
    }

    return @as(u64, @bitCast(std.time.timestamp() - uptime_[0].sec));
}

pub const struct_LoadAvg = struct {
    ldavg: [3]u32,
    fscale: c_long,
};
pub fn getSystemLoadavg() [3]f64 {
    var loadavg_: [24]struct_LoadAvg = undefined;
    var size: usize = loadavg_.len;

    const VM_LOADAVG: [2]c_int = [_]c_int{ std.c.CTL.VM, 2 };

    if (!(std.c.sysctl(&VM_LOADAVG, 2, &loadavg_, &size, null, 0) == 0)) {
        return [3]f64{ 0.0, 0.0, 0.0 };
    }

    const loadavg = loadavg_[0];
    const scale = @as(f64, @floatFromInt(loadavg.fscale));
    return [3]f64{
        @as(f64, @floatFromInt(loadavg.ldavg[0])) / scale,
        @as(f64, @floatFromInt(loadavg.ldavg[1])) / scale,
        @as(f64, @floatFromInt(loadavg.ldavg[2])) / scale,
    };
}

pub extern fn getuid(...) std.c.uid_t;
pub extern fn getgid(...) std.c.gid_t;

pub fn get_version(buf: []u8) []const u8 {
    @memset(buf, 0);

    var size: usize = buf.len;
    const KERN_VERSION: [2]c_int = [_]c_int{ std.c.CTL.KERN, std.c.KERN.VERSION };

    if (!(std.c.sysctl(&KERN_VERSION, 2, buf.ptr, &size, null, 0) == 0)) {
        return "unknown";
    }

    return bun.sliceTo(buf, 0);
}

pub fn get_release(buf: []u8) []const u8 {
    @memset(buf, 0);

    var size: usize = buf.len;
    const KERN_OSRELEASE: [2]c_int = [_]c_int{ std.c.CTL.KERN, std.c.KERN.OSRELEASE };

    if (!(std.c.sysctl(&KERN_OSRELEASE, 2, buf.ptr, &size, null, 0) == 0)) {
        return "unknown";
    }

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
    ifa_addr: ?*std.os.sockaddr,
    ifa_netmask: ?*std.os.sockaddr,
    ifa_dstaddr: ?*std.os.sockaddr,
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
    sdl_data: [24]u8, // minimum work area, can be larger; contains both if name and ll address */
};

pub usingnamespace @cImport({
    @cInclude("spawn.h");
});

// it turns out preallocating on APFS on an M1 is slower.
// so this is a linux-only optimization for now.
pub const preallocate_length = std.math.maxInt(u51);

pub const Mode = std.os.mode_t;

pub const E = std.os.E;
pub const S = std.os.S;
pub fn getErrno(rc: anytype) E {
    return std.c.getErrno(rc);
}

pub const utsname = extern struct {
    sysname: [256:0]u8,
    nodename: [256:0]u8,
    release: [256:0]u8,
    version: [256:0]u8,
    machine: [256:0]u8,
};

//pub extern "c" fn umask(Mode) Mode;
