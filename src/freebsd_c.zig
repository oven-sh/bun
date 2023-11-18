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
    EOPNOTSUPP = 45,
    EPFNOSUPPORT = 46,
    EARNOSUPPORT = 47,
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
    EIDRM = 82,
    ENOMSG = 83,
    EOVERFLOW = 84,
    ECANCELED = 85,
    EILSEQ = 86,
    ENOATTR = 87,
    EDOOFUS = 88,
    EBADMSG = 89,
    EMULTIHOP = 90,
    ENOLINK = 91,
    EPROTO = 92,
    ENOTCAPABLE = 93,
    ECAPMODE = 94,
    ENOTRECOVERABLE = 95,
    EOWNERDEAD = 96,
    EINTEGRITY = 97,

    pub const max = 96;

    pub fn init(code: anytype) ?SystemErrno {
        if (comptime std.meta.trait.isSignedInt(@TypeOf(code))) {
            if (code == 59 or code == 71)
                return null;

            if (code < 0)
                return init(-code);
        }
        if (code >= max) return null;
        if (code == 59 or code == 71) return null;

        return @as(SystemErrno, @enumFromInt(code));
    }

    pub fn label(this: SystemErrno) ?[]const u8 {
        return labels.get(this) orelse null;
    }

    const LabelMap = bun.enums.EnumMap(SystemErrno, []const u8);
    pub const labels: LabelMap = brk: {
        @setEvalBranchQuota(20000069);
        var map: LabelMap = LabelMap.initFull("");
        map.put(.EPERM, "Operation not permitted");
        map.put(.ENOENT, "No such file or directory");
        map.put(.ESRCH, "No such process");
        map.put(.EINTR, "Interrupted system call");
        map.put(.EIO, "Input/output error");
        map.put(.ENXIO, "Device not configured");
        map.put(.E2BIG, "Argument list too long");
        map.put(.ENOEXEC, "Exec format error");
        map.put(.EBADF, "Bad file descriptor");
        map.put(.ECHILD, "No child processes");
        map.put(.EDEADLK, "Resource deadlock avoided");
        map.put(.ENOMEM, "Cannot allocate memory");
        map.put(.EACCES, "Permission denied");
        map.put(.EFAULT, "Bad address");
        map.put(.ENOTBLK, "Block device required");
        map.put(.EBUSY, "Device or resource busy");
        map.put(.EEXIST, "File exists");
        map.put(.EXDEV, "Cross-device link");
        map.put(.ENODEV, "Operation not supported by device");
        map.put(.ENOTDIR, "Not a directory");
        map.put(.EISDIR, "Is a directory");
        map.put(.EINVAL, "Invalid argument");
        map.put(.ENFILE, "Too many open files in system");
        map.put(.EMFILE, "Too many open files");
        map.put(.ENOTTY, "Inappropriate ioctl for device");
        map.put(.ETXTBSY, "Text file busy");
        map.put(.EFBIG, "File too large");
        map.put(.ENOSPC, "No space left on device");
        map.put(.ESPIPE, "Illegal seek");
        map.put(.EROFS, "Read-only file system");
        map.put(.EMLINK, "Too many links");
        map.put(.EPIPE, "Broken pipe");
        map.put(.EDOM, "Numerical argument out of domain");
        map.put(.ERANGE, "Result too large");
        map.put(.EAGAIN, "Resource temporarily unavailable");
        map.put(.EINPROGRESS, "Operation now in progress");
        map.put(.EALREADY, "Operation already in progress");
        map.put(.ENOTSOCK, "Socket operation on non-socket");
        map.put(.EDESTADDRREQ, "Destination address required");
        map.put(.EMSGSIZE, "Message too long");
        map.put(.EPROTOTYPE, "Protocol wrong type for socket");
        map.put(.ENOPROTOOPT, "Protocal not available");
        map.put(.ESOCKTNOSUPPORT, "Protocol not supported");
        map.put(.EOPNOTSUPP, "Operation not supported");
        map.put(.EPFNOSUPPORT, "Protocol family not supported");
        map.put(.EADDRINUSE, "Address already in use");
        map.put(.EADDRNOTAVAIL, "Can't assign requested address");
        map.put(.ENETDOWN, "Network is down");
        map.put(.ENETUNREACH, "Network is unreachable");
        map.put(.ENETRESET, "Network dropped connection on reset");
        map.put(.ECONNABORTED, "Software caused connection abort");
        map.put(.ECONNRESET, "Connection reset by peer");
        map.put(.ENOBUFS, "No buffer space available");
        map.put(.ENOTCONN, "Socket is not connected");
        map.put(.ESHUTDOWN, "Can't send after socket shutdown");
        map.put(.ETIMEDOUT, "Operation timed out");
        map.put(.ECONNREFUSED, "Connection refused");
        map.put(.ELOOP, "Too many levels of symbolic links");
        map.put(.ENAMETOOLONG, "File name too long");
        map.put(.EHOSTDOWN, "Host is down");
        map.put(.EHOSTUNREACH, "No route to host");
        map.put(.ENOTEMPTY, "Directory not empty");
        map.put(.EPROCLIM, "Too many processes");
        map.put(.EUSERS, "Too many users");
        map.put(.EDQUOT, "Disc quota exceeded");
        map.put(.ESTALE, "Stale NFS file handle");
        map.put(.EBADRPC, "RPC struct is bad");
        map.put(.ERPCMISMATCH, "RPC version wrong");
        map.put(.EPROGUNAVAIL, "RPC prog. not avail.");
        map.put(.EPROGMISMATCH, "Program version wrong");
        map.put(.EPROCUNAVAIL, "Bad procedure for program");
        map.put(.ENOSYS, "Function not implemented");
        map.put(.EFTYPE, "Inappropriate file type or format");
        map.put(.EAUTH, "Authentication error");
        map.put(.ENEEDAUTH, "Need authenticator");
        map.put(.EIDRM, "Identifier removed");
        map.put(.ENOMSG, "No message of desired type");
        map.put(.EOVERFLOW, "Value too large to be stored in data type");
        map.put(.ECANCELED, "Operation canceled");
        map.put(.EILSEQ, "Illegal byte sequence");
        map.put(.ENOATTR, "Attribute not found");
        map.put(.EDOOFUS, "Programming error");
        map.put(.EBADMSG, "Bad message");
        map.put(.EMULTIHOP, "Multihop attempted");
        map.put(.ENOLINK, "Link has been severed");
        map.put(.EPROTO, "Protocol error");
        map.put(.ENOTCAPABLE, "Capabilities insufficient");
        map.put(.ECAPMODE, "Not permitted in capability mode");
        map.put(.ENOTRECOVERABLE, "State not recoverable");
        map.put(.EOWNERDEAD, "Previous owner died");
        map.put(.EINTEGRITY, "Integrity check failed");
        break :brk map;
    };
};

pub fn preallocate_file(_: os.fd_t, _: off_t, _: off_t) !void {
}

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

    std.os.sysctlbynameZ(
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

    std.os.sysctlbynameZ(
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

    std.os.sysctlbynameZ(
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
    return [3]f64{
        @as(f64, @floatFromInt(loadavg.ldavg[0])) / scale,
        @as(f64, @floatFromInt(loadavg.ldavg[1])) / scale,
        @as(f64, @floatFromInt(loadavg.ldavg[2])) / scale,
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

pub extern fn getuid(...) std.os.uid_t;
pub extern fn getgid(...) std.os.gid_t;

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
    pub const IOC_VOID = @import("std").zig.c_translation.cast(u32, @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x20000000, .hexadecimal));
    pub const IOC_OUT = @import("std").zig.c_translation.cast(u32, @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x40000000, .hexadecimal));
    pub const IOC_IN = @import("std").zig.c_translation.cast(u32, @import("std").zig.c_translation.promoteIntLiteral(c_int, 0x80000000, .hexadecimal));
    pub const IOC_INOUT = IOC_IN | IOC_OUT;
    pub const IOC_DIRMASK = @import("std").zig.c_translation.cast(u32, @import("std").zig.c_translation.promoteIntLiteral(c_int, 0xe0000000, .hexadecimal));
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
    sdl_data: [12]u8, // minimum work area, can be larger; contains both if name and ll address */
    //#ifndef __APPLE__
    //	/* For TokenRing */
    //	u_short sdl_rcf;        /* source routing control */
    //	u_short sdl_route[16];  /* source routing information */
    //#endif
};

// it turns out preallocating on APFS on an M1 is slower.
// so this is a linux-only optimization for now.
pub const preallocate_length = std.math.maxInt(u51);

pub const Mode = std.os.mode_t;
pub const Flags = i32;
const fd_t = std.os.fd_t;
const pid_t = std.os.pid_t;
const mode_t = std.os.mode_t;
const sigset_t = std.c.sigset_t;
const sched_param = std.os.sched_param;

pub const posix_spawnattr_t = extern struct {
    __flags: c_short,
    __pgrp: pid_t,
    __sd: sigset_t,
    __ss: sigset_t,
    __sp: struct_sched_param,
    __policy: c_int,
    __pad: [16]c_int,
};
pub const struct_sched_param = extern struct {
    sched_priority: c_int,
};
pub const struct___spawn_action = opaque {};
pub const posix_spawn_file_actions_t = extern struct {
    __allocated: c_int,
    __used: c_int,
    __actions: ?*struct___spawn_action,
    __pad: [16]c_int,
};

pub extern "c" fn posix_spawn(
    pid: *pid_t,
    path: [*:0]const u8,
    actions: ?*const posix_spawn_file_actions_t,
    attr: ?*const posix_spawnattr_t,
    argv: [*:null]?[*:0]const u8,
    env: [*:null]?[*:0]const u8,
) c_int;
pub extern "c" fn posix_spawnp(
    pid: *pid_t,
    path: [*:0]const u8,
    actions: ?*const posix_spawn_file_actions_t,
    attr: ?*const posix_spawnattr_t,
    argv: [*:null]?[*:0]const u8,
    env: [*:null]?[*:0]const u8,
) c_int;
pub extern fn posix_spawnattr_init(__attr: *posix_spawnattr_t) c_int;
pub extern fn posix_spawnattr_destroy(__attr: *posix_spawnattr_t) c_int;
pub extern fn posix_spawnattr_getsigdefault(noalias __attr: [*c]const posix_spawnattr_t, noalias __sigdefault: [*c]sigset_t) c_int;
pub extern fn posix_spawnattr_setsigdefault(noalias __attr: [*c]posix_spawnattr_t, noalias __sigdefault: [*c]const sigset_t) c_int;
pub extern fn posix_spawnattr_getsigmask(noalias __attr: [*c]const posix_spawnattr_t, noalias __sigmask: [*c]sigset_t) c_int;
pub extern fn posix_spawnattr_setsigmask(noalias __attr: [*c]posix_spawnattr_t, noalias __sigmask: [*c]const sigset_t) c_int;
pub extern fn posix_spawnattr_getflags(noalias __attr: [*c]const posix_spawnattr_t, noalias __flags: [*c]c_short) c_int;
pub extern fn posix_spawnattr_setflags(_attr: [*c]posix_spawnattr_t, __flags: c_short) c_int;
pub extern fn posix_spawnattr_getpgroup(noalias __attr: [*c]const posix_spawnattr_t, noalias __pgroup: [*c]pid_t) c_int;
pub extern fn posix_spawnattr_setpgroup(__attr: [*c]posix_spawnattr_t, __pgroup: pid_t) c_int;
pub extern fn posix_spawnattr_getschedpolicy(noalias __attr: [*c]const posix_spawnattr_t, noalias __schedpolicy: [*c]c_int) c_int;
pub extern fn posix_spawnattr_setschedpolicy(__attr: [*c]posix_spawnattr_t, __schedpolicy: c_int) c_int;
pub extern fn posix_spawnattr_getschedparam(noalias __attr: [*c]const posix_spawnattr_t, noalias __schedparam: [*c]struct_sched_param) c_int;
pub extern fn posix_spawnattr_setschedparam(noalias __attr: [*c]posix_spawnattr_t, noalias __schedparam: [*c]const struct_sched_param) c_int;
pub extern fn posix_spawn_file_actions_init(__file_actions: *posix_spawn_file_actions_t) c_int;
pub extern fn posix_spawn_file_actions_destroy(__file_actions: *posix_spawn_file_actions_t) c_int;
pub extern fn posix_spawn_file_actions_addopen(noalias __file_actions: *posix_spawn_file_actions_t, __fd: c_int, noalias __path: [*:0]const u8, __oflag: c_int, __mode: mode_t) c_int;
pub extern fn posix_spawn_file_actions_addclose(__file_actions: *posix_spawn_file_actions_t, __fd: c_int) c_int;
pub extern fn posix_spawn_file_actions_adddup2(__file_actions: *posix_spawn_file_actions_t, __fd: c_int, __newfd: c_int) c_int;
pub const POSIX_SPAWN_RESETIDS = @as(c_int, 0x01);
pub const POSIX_SPAWN_SETPGROUP = @as(c_int, 0x02);
pub const POSIX_SPAWN_SETSIGDEF = @as(c_int, 0x04);
pub const POSIX_SPAWN_SETSIGMASK = @as(c_int, 0x08);
pub const POSIX_SPAWN_SETSCHEDPARAM = @as(c_int, 0x10);
pub const POSIX_SPAWN_SETSCHEDULER = @as(c_int, 0x20);
pub const POSIX_SPAWN_SETSID = @as(c_int, 0x80);

const posix_spawn_file_actions_addfchdir_np_type = *const fn (actions: *posix_spawn_file_actions_t, filedes: fd_t) c_int;
const posix_spawn_file_actions_addchdir_np_type = *const fn (actions: *posix_spawn_file_actions_t, path: [*:0]const u8) c_int;

/// When not available, these functions will return 0.
pub fn posix_spawn_file_actions_addfchdir_np(actions: *posix_spawn_file_actions_t, filedes: std.os.fd_t) c_int {
    var function = bun.C.dlsym(posix_spawn_file_actions_addfchdir_np_type, "posix_spawn_file_actions_addfchdir_np") orelse
        return 0;
    return function(actions, filedes);
}

/// When not available, these functions will return 0.
pub fn posix_spawn_file_actions_addchdir_np(actions: *posix_spawn_file_actions_t, path: [*:0]const u8) c_int {
    var function = bun.C.dlsym(posix_spawn_file_actions_addchdir_np_type, "posix_spawn_file_actions_addchdir_np") orelse
        return 0;
    return function(actions, path);
}



pub const E = std.os.E;
pub fn getErrno(rc: anytype) E {
    return std.c.getErrno(rc);
}
