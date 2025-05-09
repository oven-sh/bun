pub const Mode = std.posix.mode_t;
pub const E = std.posix.E;
pub const S = std.posix.S;
pub const SystemErrno = enum(u16) {
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
    EAGAIN = 11,
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
    EDEADLK = 35,
    ENAMETOOLONG = 36,
    ENOLCK = 37,
    ENOSYS = 38,
    ENOTEMPTY = 39,
    ELOOP = 40,
    EWOULDBLOCK = 41,
    ENOMSG = 42,
    EIDRM = 43,
    ECHRNG = 44,
    EL2NSYNC = 45,
    EL3HLT = 46,
    EL3RST = 47,
    ELNRNG = 48,
    EUNATCH = 49,
    ENOCSI = 50,
    EL2HLT = 51,
    EBADE = 52,
    EBADR = 53,
    EXFULL = 54,
    ENOANO = 55,
    EBADRQC = 56,
    EBADSLT = 57,
    EDEADLOCK = 58,
    EBFONT = 59,
    ENOSTR = 60,
    ENODATA = 61,
    ETIME = 62,
    ENOSR = 63,
    ENONET = 64,
    ENOPKG = 65,
    EREMOTE = 66,
    ENOLINK = 67,
    EADV = 68,
    ESRMNT = 69,
    ECOMM = 70,
    EPROTO = 71,
    EMULTIHOP = 72,
    EDOTDOT = 73,
    EBADMSG = 74,
    EOVERFLOW = 75,
    ENOTUNIQ = 76,
    EBADFD = 77,
    EREMCHG = 78,
    ELIBACC = 79,
    ELIBBAD = 80,
    ELIBSCN = 81,
    ELIBMAX = 82,
    ELIBEXEC = 83,
    EILSEQ = 84,
    ERESTART = 85,
    ESTRPIPE = 86,
    EUSERS = 87,
    ENOTSOCK = 88,
    EDESTADDRREQ = 89,
    EMSGSIZE = 90,
    EPROTOTYPE = 91,
    ENOPROTOOPT = 92,
    EPROTONOSUPPORT = 93,
    ESOCKTNOSUPPORT = 94,
    /// For Linux, EOPNOTSUPP is the real value
    /// but it's ~the same and is incompatible across operating systems
    /// https://lists.gnu.org/archive/html/bug-glibc/2002-08/msg00017.html
    ENOTSUP = 95,
    EPFNOSUPPORT = 96,
    EAFNOSUPPORT = 97,
    EADDRINUSE = 98,
    EADDRNOTAVAIL = 99,
    ENETDOWN = 100,
    ENETUNREACH = 101,
    ENETRESET = 102,
    ECONNABORTED = 103,
    ECONNRESET = 104,
    ENOBUFS = 105,
    EISCONN = 106,
    ENOTCONN = 107,
    ESHUTDOWN = 108,
    ETOOMANYREFS = 109,
    ETIMEDOUT = 110,
    ECONNREFUSED = 111,
    EHOSTDOWN = 112,
    EHOSTUNREACH = 113,
    EALREADY = 114,
    EINPROGRESS = 115,
    ESTALE = 116,
    EUCLEAN = 117,
    ENOTNAM = 118,
    ENAVAIL = 119,
    EISNAM = 120,
    EREMOTEIO = 121,
    EDQUOT = 122,
    ENOMEDIUM = 123,
    EMEDIUMTYPE = 124,
    ECANCELED = 125,
    ENOKEY = 126,
    EKEYEXPIRED = 127,
    EKEYREVOKED = 128,
    EKEYREJECTED = 129,
    EOWNERDEAD = 130,
    ENOTRECOVERABLE = 131,
    ERFKILL = 132,
    EHWPOISON = 133,

    pub const max = 134;

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
pub const UV_E = struct {
    pub const @"2BIG": i32 = @intFromEnum(SystemErrno.E2BIG);
    pub const ACCES: i32 = @intFromEnum(SystemErrno.EACCES);
    pub const ADDRINUSE: i32 = @intFromEnum(SystemErrno.EADDRINUSE);
    pub const ADDRNOTAVAIL: i32 = @intFromEnum(SystemErrno.EADDRNOTAVAIL);
    pub const AFNOSUPPORT: i32 = @intFromEnum(SystemErrno.EAFNOSUPPORT);
    pub const AGAIN: i32 = @intFromEnum(SystemErrno.EAGAIN);
    pub const ALREADY: i32 = @intFromEnum(SystemErrno.EALREADY);
    pub const BADF: i32 = @intFromEnum(SystemErrno.EBADF);
    pub const BUSY: i32 = @intFromEnum(SystemErrno.EBUSY);
    pub const CANCELED: i32 = @intFromEnum(SystemErrno.ECANCELED);
    pub const CHARSET: i32 = -bun.windows.libuv.UV_ECHARSET;
    pub const CONNABORTED: i32 = @intFromEnum(SystemErrno.ECONNABORTED);
    pub const CONNREFUSED: i32 = @intFromEnum(SystemErrno.ECONNREFUSED);
    pub const CONNRESET: i32 = @intFromEnum(SystemErrno.ECONNRESET);
    pub const DESTADDRREQ: i32 = @intFromEnum(SystemErrno.EDESTADDRREQ);
    pub const EXIST: i32 = @intFromEnum(SystemErrno.EEXIST);
    pub const FAULT: i32 = @intFromEnum(SystemErrno.EFAULT);
    pub const HOSTUNREACH: i32 = @intFromEnum(SystemErrno.EHOSTUNREACH);
    pub const INTR: i32 = @intFromEnum(SystemErrno.EINTR);
    pub const INVAL: i32 = @intFromEnum(SystemErrno.EINVAL);
    pub const IO: i32 = @intFromEnum(SystemErrno.EIO);
    pub const ISCONN: i32 = @intFromEnum(SystemErrno.EISCONN);
    pub const ISDIR: i32 = @intFromEnum(SystemErrno.EISDIR);
    pub const LOOP: i32 = @intFromEnum(SystemErrno.ELOOP);
    pub const MFILE: i32 = @intFromEnum(SystemErrno.EMFILE);
    pub const MSGSIZE: i32 = @intFromEnum(SystemErrno.EMSGSIZE);
    pub const NAMETOOLONG: i32 = @intFromEnum(SystemErrno.ENAMETOOLONG);
    pub const NETDOWN: i32 = @intFromEnum(SystemErrno.ENETDOWN);
    pub const NETUNREACH: i32 = @intFromEnum(SystemErrno.ENETUNREACH);
    pub const NFILE: i32 = @intFromEnum(SystemErrno.ENFILE);
    pub const NOBUFS: i32 = @intFromEnum(SystemErrno.ENOBUFS);
    pub const NODEV: i32 = @intFromEnum(SystemErrno.ENODEV);
    pub const NOENT: i32 = @intFromEnum(SystemErrno.ENOENT);
    pub const NOMEM: i32 = @intFromEnum(SystemErrno.ENOMEM);
    pub const NONET: i32 = @intFromEnum(SystemErrno.ENONET);
    pub const NOSPC: i32 = @intFromEnum(SystemErrno.ENOSPC);
    pub const NOSYS: i32 = @intFromEnum(SystemErrno.ENOSYS);
    pub const NOTCONN: i32 = @intFromEnum(SystemErrno.ENOTCONN);
    pub const NOTDIR: i32 = @intFromEnum(SystemErrno.ENOTDIR);
    pub const NOTEMPTY: i32 = @intFromEnum(SystemErrno.ENOTEMPTY);
    pub const NOTSOCK: i32 = @intFromEnum(SystemErrno.ENOTSOCK);
    pub const NOTSUP: i32 = @intFromEnum(SystemErrno.ENOTSUP);
    pub const PERM: i32 = @intFromEnum(SystemErrno.EPERM);
    pub const PIPE: i32 = @intFromEnum(SystemErrno.EPIPE);
    pub const PROTO: i32 = @intFromEnum(SystemErrno.EPROTO);
    pub const PROTONOSUPPORT: i32 = @intFromEnum(SystemErrno.EPROTONOSUPPORT);
    pub const PROTOTYPE: i32 = @intFromEnum(SystemErrno.EPROTOTYPE);
    pub const ROFS: i32 = @intFromEnum(SystemErrno.EROFS);
    pub const SHUTDOWN: i32 = @intFromEnum(SystemErrno.ESHUTDOWN);
    pub const SPIPE: i32 = @intFromEnum(SystemErrno.ESPIPE);
    pub const SRCH: i32 = @intFromEnum(SystemErrno.ESRCH);
    pub const TIMEDOUT: i32 = @intFromEnum(SystemErrno.ETIMEDOUT);
    pub const TXTBSY: i32 = @intFromEnum(SystemErrno.ETXTBSY);
    pub const XDEV: i32 = @intFromEnum(SystemErrno.EXDEV);
    pub const FBIG: i32 = @intFromEnum(SystemErrno.EFBIG);
    pub const NOPROTOOPT: i32 = @intFromEnum(SystemErrno.ENOPROTOOPT);
    pub const RANGE: i32 = @intFromEnum(SystemErrno.ERANGE);
    pub const NXIO: i32 = @intFromEnum(SystemErrno.ENXIO);
    pub const MLINK: i32 = @intFromEnum(SystemErrno.EMLINK);
    pub const HOSTDOWN: i32 = @intFromEnum(SystemErrno.EHOSTDOWN);
    pub const REMOTEIO: i32 = @intFromEnum(SystemErrno.EREMOTEIO);
    pub const NOTTY: i32 = @intFromEnum(SystemErrno.ENOTTY);
    pub const FTYPE: i32 = -bun.windows.libuv.UV_EFTYPE;
    pub const ILSEQ: i32 = @intFromEnum(SystemErrno.EILSEQ);
    pub const OVERFLOW: i32 = @intFromEnum(SystemErrno.EOVERFLOW);
    pub const SOCKTNOSUPPORT: i32 = @intFromEnum(SystemErrno.ESOCKTNOSUPPORT);
    pub const NODATA: i32 = @intFromEnum(SystemErrno.ENODATA);
    pub const UNATCH: i32 = @intFromEnum(SystemErrno.EUNATCH);
};
pub fn getErrno(rc: anytype) E {
    const Type = @TypeOf(rc);

    return switch (Type) {
        // raw system calls from std.os.linux.* will return usize
        // the errno is stored in this value
        usize => {
            const signed: isize = @bitCast(rc);
            const int = if (signed > -4096 and signed < 0) -signed else 0;
            return @enumFromInt(int);
        },

        // glibc system call wrapper returns i32/int
        // the errno is stored in a thread local variable
        //
        // TODO: the inclusion of  'u32' and 'isize' seems suspicious
        i32, c_int, u32, isize, i64 => if (rc == -1)
            @enumFromInt(std.c._errno().*)
        else
            .SUCCESS,

        else => @compileError("Not implemented yet for type " ++ @typeName(Type)),
    };
}
const std = @import("std");
const bun = @import("bun");
