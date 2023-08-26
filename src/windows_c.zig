const std = @import("std");
const bun = @import("root").bun;
const builtin = @import("builtin");
const os = std.os;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;

pub fn getTotalMemory() usize {
    return 0;
}
pub fn getSystemMemory() usize {
    return 0;
}

pub fn getFreeMemory() usize {
    return 0;
}

pub fn getSystemUptime() usize {
    return 0;
}

pub fn getSystemLoadavg() [3]i32 {
    return .{ 0, 0, 0 };
}

pub const Mode = i32;

pub const SystemErrno = enum(u8) {
    E2BIG = 7,
    EACCES = 13,
    EAGAIN = 11,
    EBADF = 9,
    EBUSY = 16,
    ECHILD = 10,
    EDEADLOCK = 36,
    EDOM = 33,
    EEXIST = 17,
    EFAULT = 14,
    EFBIG = 27,
    EILSEQ = 42,
    EINTR = 4,
    EINVAL = 22,
    EIO = 5,
    EISDIR = 21,
    EMFILE = 24,
    EMLINK = 31,
    ENAMETOOLONG = 38,
    ENFILE = 23,
    ENODEV = 19,
    ENOENT = 2,
    ENOEXEC = 8,
    ENOLCK = 39,
    ENOMEM = 12,
    ENOSPC = 28,
    ENOSYS = 40,
    ENOTDIR = 20,
    ENOTEMPTY = 41,
    ENOTTY = 25,
    ENXIO = 6,
    EPERM = 1,
    EPIPE = 32,
    ERANGE = 34,
    EROFS = 30,
    ESPIPE = 29,
    ESRCH = 3,
    EXDEV = 18,
    STRUNCATE = 80,

    EADDRINUSE = 100,
    EADDRNOTAVAIL = 101,
    EAFNOSUPPORT = 102,
    EALREADY = 103,
    EBADMSG = 104,
    ECANCELED = 105,
    ECONNABORTED = 106,
    ECONNREFUSED = 107,
    ECONNRESET = 108,
    EDESTADDRREQ = 109,
    EHOSTUNREACH = 110,
    EIDRM = 111,
    EINPROGRESS = 112,
    EISCONN = 113,
    ELOOP = 114,
    EMSGSIZE = 115,
    ENETDOWN = 116,
    ENETRESET = 117,
    ENETUNREACH = 118,
    ENOBUFS = 119,
    ENODATA = 120,
    ENOLINK = 121,
    ENOMSG = 122,
    ENOPROTOOPT = 123,
    ENOSR = 124,
    ENOSTR = 125,
    ENOTCONN = 126,
    ENOTRECOVERABLE = 127,
    ENOTSOCK = 128,
    ENOTSUP = 129,
    EOPNOTSUPP = 130,
    EOTHER = 131,
    EOVERFLOW = 132,
    EOWNERDEAD = 133,
    EPROTO = 134,
    EPROTONOSUPPORT = 135,
    EPROTOTYPE = 136,
    ETIME = 137,
    ETIMEDOUT = 138,
    ETXTBSY = 139,
    EWOULDBLOCK = 140,

    pub const max = @intFromEnum(SystemErrno.EWOULDBLOCK);
};
