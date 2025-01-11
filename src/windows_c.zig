const std = @import("std");
const bun = @import("root").bun;
const builtin = @import("builtin");
const win32 = std.os.windows;
const posix = std.posix;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;

// Windows doesn't have memmem, so we need to implement it
pub export fn memmem(haystack: ?[*]const u8, haystacklen: usize, needle: ?[*]const u8, needlelen: usize) ?[*]const u8 {
    // Handle null pointers
    if (haystack == null or needle == null) return null;

    // Handle empty needle case
    if (needlelen == 0) return haystack;

    // Handle case where needle is longer than haystack
    if (needlelen > haystacklen) return null;

    const hay = haystack.?[0..haystacklen];
    const nee = needle.?[0..needlelen];

    const i = std.mem.indexOf(u8, hay, nee) orelse return null;
    return hay.ptr + i;
}

comptime {
    @export(memmem, .{ .name = "zig_memmem" });
}

pub const lstat = blk: {
    const T = *const fn ([*c]const u8, [*c]std.c.Stat) callconv(.C) c_int;
    break :blk @extern(T, .{ .name = "lstat64" });
};

pub const fstat = blk: {
    const T = *const fn ([*c]const u8, [*c]std.c.Stat) callconv(.C) c_int;
    break :blk @extern(T, .{ .name = "fstat64" });
};
pub const stat = blk: {
    const T = *const fn ([*c]const u8, [*c]std.c.Stat) callconv(.C) c_int;
    break :blk @extern(T, .{ .name = "stat64" });
};

pub fn getTotalMemory() usize {
    return uv.uv_get_total_memory();
}

pub fn getFreeMemory() usize {
    return uv.uv_get_free_memory();
}

pub fn getSystemLoadavg() [3]f32 {
    // loadavg is not supported on windows even in node
    return .{ 0, 0, 0 };
}

pub const Mode = i32;
const Win32Error = bun.windows.Win32Error;

// The way we do errors in Bun needs to get cleaned up.
// This is way too complicated.
// The problem is because we use libc in some cases and we use zig's std lib in other places and other times we go direct.
// So we end up with a lot of redundant code.
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
    // made up erropr
    EUNKNOWN = 134,
    ECHARSET = 135,
    EOF = 136,

    UV_E2BIG = -uv.UV_E2BIG,
    UV_EACCES = -uv.UV_EACCES,
    UV_EADDRINUSE = -uv.UV_EADDRINUSE,
    UV_EADDRNOTAVAIL = -uv.UV_EADDRNOTAVAIL,
    UV_EAFNOSUPPORT = -uv.UV_EAFNOSUPPORT,
    UV_EAGAIN = -uv.UV_EAGAIN,
    UV_EAI_ADDRFAMILY = -uv.UV_EAI_ADDRFAMILY,
    UV_EAI_AGAIN = -uv.UV_EAI_AGAIN,
    UV_EAI_BADFLAGS = -uv.UV_EAI_BADFLAGS,
    UV_EAI_BADHINTS = -uv.UV_EAI_BADHINTS,
    UV_EAI_CANCELED = -uv.UV_EAI_CANCELED,
    UV_EAI_FAIL = -uv.UV_EAI_FAIL,
    UV_EAI_FAMILY = -uv.UV_EAI_FAMILY,
    UV_EAI_MEMORY = -uv.UV_EAI_MEMORY,
    UV_EAI_NODATA = -uv.UV_EAI_NODATA,
    UV_EAI_NONAME = -uv.UV_EAI_NONAME,
    UV_EAI_OVERFLOW = -uv.UV_EAI_OVERFLOW,
    UV_EAI_PROTOCOL = -uv.UV_EAI_PROTOCOL,
    UV_EAI_SERVICE = -uv.UV_EAI_SERVICE,
    UV_EAI_SOCKTYPE = -uv.UV_EAI_SOCKTYPE,
    UV_EALREADY = -uv.UV_EALREADY,
    UV_EBADF = -uv.UV_EBADF,
    UV_EBUSY = -uv.UV_EBUSY,
    UV_ECANCELED = -uv.UV_ECANCELED,
    UV_ECHARSET = -uv.UV_ECHARSET,
    UV_ECONNABORTED = -uv.UV_ECONNABORTED,
    UV_ECONNREFUSED = -uv.UV_ECONNREFUSED,
    UV_ECONNRESET = -uv.UV_ECONNRESET,
    UV_EDESTADDRREQ = -uv.UV_EDESTADDRREQ,
    UV_EEXIST = -uv.UV_EEXIST,
    UV_EFAULT = -uv.UV_EFAULT,
    UV_EFBIG = -uv.UV_EFBIG,
    UV_EHOSTUNREACH = -uv.UV_EHOSTUNREACH,
    UV_EINVAL = -uv.UV_EINVAL,
    UV_EINTR = -uv.UV_EINTR,
    UV_EISCONN = -uv.UV_EISCONN,
    UV_EIO = -uv.UV_EIO,
    UV_ELOOP = -uv.UV_ELOOP,
    UV_EISDIR = -uv.UV_EISDIR,
    UV_EMSGSIZE = -uv.UV_EMSGSIZE,
    UV_EMFILE = -uv.UV_EMFILE,
    UV_ENETDOWN = -uv.UV_ENETDOWN,
    UV_ENAMETOOLONG = -uv.UV_ENAMETOOLONG,
    UV_ENFILE = -uv.UV_ENFILE,
    UV_ENETUNREACH = -uv.UV_ENETUNREACH,
    UV_ENODEV = -uv.UV_ENODEV,
    UV_ENOBUFS = -uv.UV_ENOBUFS,
    UV_ENOMEM = -uv.UV_ENOMEM,
    UV_ENOENT = -uv.UV_ENOENT,
    UV_ENOPROTOOPT = -uv.UV_ENOPROTOOPT,
    UV_ENONET = -uv.UV_ENONET,
    UV_ENOSYS = -uv.UV_ENOSYS,
    UV_ENOSPC = -uv.UV_ENOSPC,
    UV_ENOTDIR = -uv.UV_ENOTDIR,
    UV_ENOTCONN = -uv.UV_ENOTCONN,
    UV_ENOTSOCK = -uv.UV_ENOTSOCK,
    UV_ENOTEMPTY = -uv.UV_ENOTEMPTY,
    UV_EOVERFLOW = -uv.UV_EOVERFLOW,
    UV_ENOTSUP = -uv.UV_ENOTSUP,
    UV_EPIPE = -uv.UV_EPIPE,
    UV_EPERM = -uv.UV_EPERM,
    UV_EPROTONOSUPPORT = -uv.UV_EPROTONOSUPPORT,
    UV_EPROTO = -uv.UV_EPROTO,
    UV_ERANGE = -uv.UV_ERANGE,
    UV_EPROTOTYPE = -uv.UV_EPROTOTYPE,
    UV_ESHUTDOWN = -uv.UV_ESHUTDOWN,
    UV_EROFS = -uv.UV_EROFS,
    UV_ESRCH = -uv.UV_ESRCH,
    UV_ESPIPE = -uv.UV_ESPIPE,
    UV_ETXTBSY = -uv.UV_ETXTBSY,
    UV_ETIMEDOUT = -uv.UV_ETIMEDOUT,
    UV_UNKNOWN = -uv.UV_UNKNOWN,
    UV_EXDEV = -uv.UV_EXDEV,
    UV_ENXIO = -uv.UV_ENXIO,
    UV_EOF = -uv.UV_EOF,
    UV_EHOSTDOWN = -uv.UV_EHOSTDOWN,
    UV_EMLINK = -uv.UV_EMLINK,
    UV_ENOTTY = -uv.UV_ENOTTY,
    UV_EREMOTEIO = -uv.UV_EREMOTEIO,
    UV_EILSEQ = -uv.UV_EILSEQ,
    UV_EFTYPE = -uv.UV_EFTYPE,
    UV_ENODATA = -uv.UV_ENODATA,
    UV_ESOCKTNOSUPPORT = -uv.UV_ESOCKTNOSUPPORT,
    UV_ERRNO_MAX = -uv.UV_ERRNO_MAX,
    UV_EUNATCH = -uv.UV_EUNATCH,

    pub const max = 137;

    pub const Error = error{
        EPERM,
        ENOENT,
        ESRCH,
        EINTR,
        EIO,
        ENXIO,
        E2BIG,
        ENOEXEC,
        EBADF,
        ECHILD,
        EAGAIN,
        ENOMEM,
        EACCES,
        EFAULT,
        ENOTBLK,
        EBUSY,
        EEXIST,
        EXDEV,
        ENODEV,
        ENOTDIR,
        EISDIR,
        EINVAL,
        ENFILE,
        EMFILE,
        ENOTTY,
        ETXTBSY,
        EFBIG,
        ENOSPC,
        ESPIPE,
        EROFS,
        EMLINK,
        EPIPE,
        EDOM,
        ERANGE,
        EDEADLK,
        ENAMETOOLONG,
        ENOLCK,
        ENOSYS,
        ENOTEMPTY,
        ELOOP,
        EWOULDBLOCK,
        ENOMSG,
        EIDRM,
        ECHRNG,
        EL2NSYNC,
        EL3HLT,
        EL3RST,
        ELNRNG,
        EUNATCH,
        ENOCSI,
        EL2HLT,
        EBADE,
        EBADR,
        EXFULL,
        ENOANO,
        EBADRQC,
        EBADSLT,
        EDEADLOCK,
        EBFONT,
        ENOSTR,
        ENODATA,
        ETIME,
        ENOSR,
        ENONET,
        ENOPKG,
        EREMOTE,
        ENOLINK,
        EADV,
        ESRMNT,
        ECOMM,
        EPROTO,
        EMULTIHOP,
        EDOTDOT,
        EBADMSG,
        EOVERFLOW,
        ENOTUNIQ,
        EBADFD,
        EREMCHG,
        ELIBACC,
        ELIBBAD,
        ELIBSCN,
        ELIBMAX,
        ELIBEXEC,
        EILSEQ,
        ERESTART,
        ESTRPIPE,
        EUSERS,
        ENOTSOCK,
        EDESTADDRREQ,
        EMSGSIZE,
        EPROTOTYPE,
        ENOPROTOOPT,
        EPROTONOSUPPORT,
        ESOCKTNOSUPPORT,
        ENOTSUP,
        EPFNOSUPPORT,
        EAFNOSUPPORT,
        EADDRINUSE,
        EADDRNOTAVAIL,
        ENETDOWN,
        ENETUNREACH,
        ENETRESET,
        ECONNABORTED,
        ECONNRESET,
        ENOBUFS,
        EISCONN,
        ENOTCONN,
        ESHUTDOWN,
        ETOOMANYREFS,
        ETIMEDOUT,
        ECONNREFUSED,
        EHOSTDOWN,
        EHOSTUNREACH,
        EALREADY,
        EINPROGRESS,
        ESTALE,
        EUCLEAN,
        ENOTNAM,
        ENAVAIL,
        EISNAM,
        EREMOTEIO,
        EDQUOT,
        ENOMEDIUM,
        EMEDIUMTYPE,
        ECANCELED,
        ENOKEY,
        EKEYEXPIRED,
        EKEYREVOKED,
        EKEYREJECTED,
        EOWNERDEAD,
        ENOTRECOVERABLE,
        ERFKILL,
        EHWPOISON,
        EUNKNOWN,
        ECHARSET,
        EOF,
        Unexpected,
    };

    pub inline fn toE(this: SystemErrno) E {
        return @enumFromInt(@intFromEnum(this));
    }

    const error_map: [SystemErrno.max]Error = brk: {
        var errors: [SystemErrno.max]Error = undefined;
        errors[@intFromEnum(SystemErrno.EPERM)] = error.EPERM;
        errors[@intFromEnum(SystemErrno.ENOENT)] = error.ENOENT;
        errors[@intFromEnum(SystemErrno.ESRCH)] = error.ESRCH;
        errors[@intFromEnum(SystemErrno.EINTR)] = error.EINTR;
        errors[@intFromEnum(SystemErrno.EIO)] = error.EIO;
        errors[@intFromEnum(SystemErrno.ENXIO)] = error.ENXIO;
        errors[@intFromEnum(SystemErrno.E2BIG)] = error.E2BIG;
        errors[@intFromEnum(SystemErrno.ENOEXEC)] = error.ENOEXEC;
        errors[@intFromEnum(SystemErrno.EBADF)] = error.EBADF;
        errors[@intFromEnum(SystemErrno.ECHILD)] = error.ECHILD;
        errors[@intFromEnum(SystemErrno.EAGAIN)] = error.EAGAIN;
        errors[@intFromEnum(SystemErrno.ENOMEM)] = error.ENOMEM;
        errors[@intFromEnum(SystemErrno.EACCES)] = error.EACCES;
        errors[@intFromEnum(SystemErrno.EFAULT)] = error.EFAULT;
        errors[@intFromEnum(SystemErrno.ENOTBLK)] = error.ENOTBLK;
        errors[@intFromEnum(SystemErrno.EBUSY)] = error.EBUSY;
        errors[@intFromEnum(SystemErrno.EEXIST)] = error.EEXIST;
        errors[@intFromEnum(SystemErrno.EXDEV)] = error.EXDEV;
        errors[@intFromEnum(SystemErrno.ENODEV)] = error.ENODEV;
        errors[@intFromEnum(SystemErrno.ENOTDIR)] = error.ENOTDIR;
        errors[@intFromEnum(SystemErrno.EISDIR)] = error.EISDIR;
        errors[@intFromEnum(SystemErrno.EINVAL)] = error.EINVAL;
        errors[@intFromEnum(SystemErrno.ENFILE)] = error.ENFILE;
        errors[@intFromEnum(SystemErrno.EMFILE)] = error.EMFILE;
        errors[@intFromEnum(SystemErrno.ENOTTY)] = error.ENOTTY;
        errors[@intFromEnum(SystemErrno.ETXTBSY)] = error.ETXTBSY;
        errors[@intFromEnum(SystemErrno.EFBIG)] = error.EFBIG;
        errors[@intFromEnum(SystemErrno.ENOSPC)] = error.ENOSPC;
        errors[@intFromEnum(SystemErrno.ESPIPE)] = error.ESPIPE;
        errors[@intFromEnum(SystemErrno.EROFS)] = error.EROFS;
        errors[@intFromEnum(SystemErrno.EMLINK)] = error.EMLINK;
        errors[@intFromEnum(SystemErrno.EPIPE)] = error.EPIPE;
        errors[@intFromEnum(SystemErrno.EDOM)] = error.EDOM;
        errors[@intFromEnum(SystemErrno.ERANGE)] = error.ERANGE;
        errors[@intFromEnum(SystemErrno.EDEADLK)] = error.EDEADLK;
        errors[@intFromEnum(SystemErrno.ENAMETOOLONG)] = error.ENAMETOOLONG;
        errors[@intFromEnum(SystemErrno.ENOLCK)] = error.ENOLCK;
        errors[@intFromEnum(SystemErrno.ENOSYS)] = error.ENOSYS;
        errors[@intFromEnum(SystemErrno.ENOTEMPTY)] = error.ENOTEMPTY;
        errors[@intFromEnum(SystemErrno.ELOOP)] = error.ELOOP;
        errors[@intFromEnum(SystemErrno.EWOULDBLOCK)] = error.EWOULDBLOCK;
        errors[@intFromEnum(SystemErrno.ENOMSG)] = error.ENOMSG;
        errors[@intFromEnum(SystemErrno.EIDRM)] = error.EIDRM;
        errors[@intFromEnum(SystemErrno.ECHRNG)] = error.ECHRNG;
        errors[@intFromEnum(SystemErrno.EL2NSYNC)] = error.EL2NSYNC;
        errors[@intFromEnum(SystemErrno.EL3HLT)] = error.EL3HLT;
        errors[@intFromEnum(SystemErrno.EL3RST)] = error.EL3RST;
        errors[@intFromEnum(SystemErrno.ELNRNG)] = error.ELNRNG;
        errors[@intFromEnum(SystemErrno.EUNATCH)] = error.EUNATCH;
        errors[@intFromEnum(SystemErrno.ENOCSI)] = error.ENOCSI;
        errors[@intFromEnum(SystemErrno.EL2HLT)] = error.EL2HLT;
        errors[@intFromEnum(SystemErrno.EBADE)] = error.EBADE;
        errors[@intFromEnum(SystemErrno.EBADR)] = error.EBADR;
        errors[@intFromEnum(SystemErrno.EXFULL)] = error.EXFULL;
        errors[@intFromEnum(SystemErrno.ENOANO)] = error.ENOANO;
        errors[@intFromEnum(SystemErrno.EBADRQC)] = error.EBADRQC;
        errors[@intFromEnum(SystemErrno.EBADSLT)] = error.EBADSLT;
        errors[@intFromEnum(SystemErrno.EDEADLOCK)] = error.EDEADLOCK;
        errors[@intFromEnum(SystemErrno.EBFONT)] = error.EBFONT;
        errors[@intFromEnum(SystemErrno.ENOSTR)] = error.ENOSTR;
        errors[@intFromEnum(SystemErrno.ENODATA)] = error.ENODATA;
        errors[@intFromEnum(SystemErrno.ETIME)] = error.ETIME;
        errors[@intFromEnum(SystemErrno.ENOSR)] = error.ENOSR;
        errors[@intFromEnum(SystemErrno.ENONET)] = error.ENONET;
        errors[@intFromEnum(SystemErrno.ENOPKG)] = error.ENOPKG;
        errors[@intFromEnum(SystemErrno.EREMOTE)] = error.EREMOTE;
        errors[@intFromEnum(SystemErrno.ENOLINK)] = error.ENOLINK;
        errors[@intFromEnum(SystemErrno.EADV)] = error.EADV;
        errors[@intFromEnum(SystemErrno.ESRMNT)] = error.ESRMNT;
        errors[@intFromEnum(SystemErrno.ECOMM)] = error.ECOMM;
        errors[@intFromEnum(SystemErrno.EPROTO)] = error.EPROTO;
        errors[@intFromEnum(SystemErrno.EMULTIHOP)] = error.EMULTIHOP;
        errors[@intFromEnum(SystemErrno.EDOTDOT)] = error.EDOTDOT;
        errors[@intFromEnum(SystemErrno.EBADMSG)] = error.EBADMSG;
        errors[@intFromEnum(SystemErrno.EOVERFLOW)] = error.EOVERFLOW;
        errors[@intFromEnum(SystemErrno.ENOTUNIQ)] = error.ENOTUNIQ;
        errors[@intFromEnum(SystemErrno.EBADFD)] = error.EBADFD;
        errors[@intFromEnum(SystemErrno.EREMCHG)] = error.EREMCHG;
        errors[@intFromEnum(SystemErrno.ELIBACC)] = error.ELIBACC;
        errors[@intFromEnum(SystemErrno.ELIBBAD)] = error.ELIBBAD;
        errors[@intFromEnum(SystemErrno.ELIBSCN)] = error.ELIBSCN;
        errors[@intFromEnum(SystemErrno.ELIBMAX)] = error.ELIBMAX;
        errors[@intFromEnum(SystemErrno.ELIBEXEC)] = error.ELIBEXEC;
        errors[@intFromEnum(SystemErrno.EILSEQ)] = error.EILSEQ;
        errors[@intFromEnum(SystemErrno.ERESTART)] = error.ERESTART;
        errors[@intFromEnum(SystemErrno.ESTRPIPE)] = error.ESTRPIPE;
        errors[@intFromEnum(SystemErrno.EUSERS)] = error.EUSERS;
        errors[@intFromEnum(SystemErrno.ENOTSOCK)] = error.ENOTSOCK;
        errors[@intFromEnum(SystemErrno.EDESTADDRREQ)] = error.EDESTADDRREQ;
        errors[@intFromEnum(SystemErrno.EMSGSIZE)] = error.EMSGSIZE;
        errors[@intFromEnum(SystemErrno.EPROTOTYPE)] = error.EPROTOTYPE;
        errors[@intFromEnum(SystemErrno.ENOPROTOOPT)] = error.ENOPROTOOPT;
        errors[@intFromEnum(SystemErrno.EPROTONOSUPPORT)] = error.EPROTONOSUPPORT;
        errors[@intFromEnum(SystemErrno.ESOCKTNOSUPPORT)] = error.ESOCKTNOSUPPORT;
        errors[@intFromEnum(SystemErrno.ENOTSUP)] = error.ENOTSUP;
        errors[@intFromEnum(SystemErrno.EPFNOSUPPORT)] = error.EPFNOSUPPORT;
        errors[@intFromEnum(SystemErrno.EAFNOSUPPORT)] = error.EAFNOSUPPORT;
        errors[@intFromEnum(SystemErrno.EADDRINUSE)] = error.EADDRINUSE;
        errors[@intFromEnum(SystemErrno.EADDRNOTAVAIL)] = error.EADDRNOTAVAIL;
        errors[@intFromEnum(SystemErrno.ENETDOWN)] = error.ENETDOWN;
        errors[@intFromEnum(SystemErrno.ENETUNREACH)] = error.ENETUNREACH;
        errors[@intFromEnum(SystemErrno.ENETRESET)] = error.ENETRESET;
        errors[@intFromEnum(SystemErrno.ECONNABORTED)] = error.ECONNABORTED;
        errors[@intFromEnum(SystemErrno.ECONNRESET)] = error.ECONNRESET;
        errors[@intFromEnum(SystemErrno.ENOBUFS)] = error.ENOBUFS;
        errors[@intFromEnum(SystemErrno.EISCONN)] = error.EISCONN;
        errors[@intFromEnum(SystemErrno.ENOTCONN)] = error.ENOTCONN;
        errors[@intFromEnum(SystemErrno.ESHUTDOWN)] = error.ESHUTDOWN;
        errors[@intFromEnum(SystemErrno.ETOOMANYREFS)] = error.ETOOMANYREFS;
        errors[@intFromEnum(SystemErrno.ETIMEDOUT)] = error.ETIMEDOUT;
        errors[@intFromEnum(SystemErrno.ECONNREFUSED)] = error.ECONNREFUSED;
        errors[@intFromEnum(SystemErrno.EHOSTDOWN)] = error.EHOSTDOWN;
        errors[@intFromEnum(SystemErrno.EHOSTUNREACH)] = error.EHOSTUNREACH;
        errors[@intFromEnum(SystemErrno.EALREADY)] = error.EALREADY;
        errors[@intFromEnum(SystemErrno.EINPROGRESS)] = error.EINPROGRESS;
        errors[@intFromEnum(SystemErrno.ESTALE)] = error.ESTALE;
        errors[@intFromEnum(SystemErrno.EUCLEAN)] = error.EUCLEAN;
        errors[@intFromEnum(SystemErrno.ENOTNAM)] = error.ENOTNAM;
        errors[@intFromEnum(SystemErrno.ENAVAIL)] = error.ENAVAIL;
        errors[@intFromEnum(SystemErrno.EISNAM)] = error.EISNAM;
        errors[@intFromEnum(SystemErrno.EREMOTEIO)] = error.EREMOTEIO;
        errors[@intFromEnum(SystemErrno.EDQUOT)] = error.EDQUOT;
        errors[@intFromEnum(SystemErrno.ENOMEDIUM)] = error.ENOMEDIUM;
        errors[@intFromEnum(SystemErrno.EMEDIUMTYPE)] = error.EMEDIUMTYPE;
        errors[@intFromEnum(SystemErrno.ECANCELED)] = error.ECANCELED;
        errors[@intFromEnum(SystemErrno.ENOKEY)] = error.ENOKEY;
        errors[@intFromEnum(SystemErrno.EKEYEXPIRED)] = error.EKEYEXPIRED;
        errors[@intFromEnum(SystemErrno.EKEYREVOKED)] = error.EKEYREVOKED;
        errors[@intFromEnum(SystemErrno.EKEYREJECTED)] = error.EKEYREJECTED;
        errors[@intFromEnum(SystemErrno.EOWNERDEAD)] = error.EOWNERDEAD;
        errors[@intFromEnum(SystemErrno.ENOTRECOVERABLE)] = error.ENOTRECOVERABLE;
        errors[@intFromEnum(SystemErrno.ERFKILL)] = error.ERFKILL;
        errors[@intFromEnum(SystemErrno.EHWPOISON)] = error.EHWPOISON;
        errors[@intFromEnum(SystemErrno.EUNKNOWN)] = error.EUNKNOWN;
        errors[@intFromEnum(SystemErrno.ECHARSET)] = error.ECHARSET;
        errors[@intFromEnum(SystemErrno.EOF)] = error.EOF;
        break :brk errors;
    };

    pub fn fromError(err: anyerror) ?SystemErrno {
        return switch (err) {
            error.EPERM => SystemErrno.EPERM,
            error.ENOENT => SystemErrno.ENOENT,
            error.ESRCH => SystemErrno.ESRCH,
            error.EINTR => SystemErrno.EINTR,
            error.EIO => SystemErrno.EIO,
            error.ENXIO => SystemErrno.ENXIO,
            error.E2BIG => SystemErrno.E2BIG,
            error.ENOEXEC => SystemErrno.ENOEXEC,
            error.EBADF => SystemErrno.EBADF,
            error.ECHILD => SystemErrno.ECHILD,
            error.EAGAIN => SystemErrno.EAGAIN,
            error.ENOMEM => SystemErrno.ENOMEM,
            error.EACCES => SystemErrno.EACCES,
            error.EFAULT => SystemErrno.EFAULT,
            error.ENOTBLK => SystemErrno.ENOTBLK,
            error.EBUSY => SystemErrno.EBUSY,
            error.EEXIST => SystemErrno.EEXIST,
            error.EXDEV => SystemErrno.EXDEV,
            error.ENODEV => SystemErrno.ENODEV,
            error.ENOTDIR => SystemErrno.ENOTDIR,
            error.EISDIR => SystemErrno.EISDIR,
            error.EINVAL => SystemErrno.EINVAL,
            error.ENFILE => SystemErrno.ENFILE,
            error.EMFILE => SystemErrno.EMFILE,
            error.ENOTTY => SystemErrno.ENOTTY,
            error.ETXTBSY => SystemErrno.ETXTBSY,
            error.EFBIG => SystemErrno.EFBIG,
            error.ENOSPC => SystemErrno.ENOSPC,
            error.ESPIPE => SystemErrno.ESPIPE,
            error.EROFS => SystemErrno.EROFS,
            error.EMLINK => SystemErrno.EMLINK,
            error.EPIPE => SystemErrno.EPIPE,
            error.EDOM => SystemErrno.EDOM,
            error.ERANGE => SystemErrno.ERANGE,
            error.EDEADLK => SystemErrno.EDEADLK,
            error.ENAMETOOLONG => SystemErrno.ENAMETOOLONG,
            error.ENOLCK => SystemErrno.ENOLCK,
            error.ENOSYS => SystemErrno.ENOSYS,
            error.ENOTEMPTY => SystemErrno.ENOTEMPTY,
            error.ELOOP => SystemErrno.ELOOP,
            error.EWOULDBLOCK => SystemErrno.EWOULDBLOCK,
            error.ENOMSG => SystemErrno.ENOMSG,
            error.EIDRM => SystemErrno.EIDRM,
            error.ECHRNG => SystemErrno.ECHRNG,
            error.EL2NSYNC => SystemErrno.EL2NSYNC,
            error.EL3HLT => SystemErrno.EL3HLT,
            error.EL3RST => SystemErrno.EL3RST,
            error.ELNRNG => SystemErrno.ELNRNG,
            error.EUNATCH => SystemErrno.EUNATCH,
            error.ENOCSI => SystemErrno.ENOCSI,
            error.EL2HLT => SystemErrno.EL2HLT,
            error.EBADE => SystemErrno.EBADE,
            error.EBADR => SystemErrno.EBADR,
            error.EXFULL => SystemErrno.EXFULL,
            error.ENOANO => SystemErrno.ENOANO,
            error.EBADRQC => SystemErrno.EBADRQC,
            error.EBADSLT => SystemErrno.EBADSLT,
            error.EDEADLOCK => SystemErrno.EDEADLOCK,
            error.EBFONT => SystemErrno.EBFONT,
            error.ENOSTR => SystemErrno.ENOSTR,
            error.ENODATA => SystemErrno.ENODATA,
            error.ETIME => SystemErrno.ETIME,
            error.ENOSR => SystemErrno.ENOSR,
            error.ENONET => SystemErrno.ENONET,
            error.ENOPKG => SystemErrno.ENOPKG,
            error.EREMOTE => SystemErrno.EREMOTE,
            error.ENOLINK => SystemErrno.ENOLINK,
            error.EADV => SystemErrno.EADV,
            error.ESRMNT => SystemErrno.ESRMNT,
            error.ECOMM => SystemErrno.ECOMM,
            error.EPROTO => SystemErrno.EPROTO,
            error.EMULTIHOP => SystemErrno.EMULTIHOP,
            error.EDOTDOT => SystemErrno.EDOTDOT,
            error.EBADMSG => SystemErrno.EBADMSG,
            error.EOVERFLOW => SystemErrno.EOVERFLOW,
            error.ENOTUNIQ => SystemErrno.ENOTUNIQ,
            error.EBADFD => SystemErrno.EBADFD,
            error.EREMCHG => SystemErrno.EREMCHG,
            error.ELIBACC => SystemErrno.ELIBACC,
            error.ELIBBAD => SystemErrno.ELIBBAD,
            error.ELIBSCN => SystemErrno.ELIBSCN,
            error.ELIBMAX => SystemErrno.ELIBMAX,
            error.ELIBEXEC => SystemErrno.ELIBEXEC,
            error.EILSEQ => SystemErrno.EILSEQ,
            error.ERESTART => SystemErrno.ERESTART,
            error.ESTRPIPE => SystemErrno.ESTRPIPE,
            error.EUSERS => SystemErrno.EUSERS,
            error.ENOTSOCK => SystemErrno.ENOTSOCK,
            error.EDESTADDRREQ => SystemErrno.EDESTADDRREQ,
            error.EMSGSIZE => SystemErrno.EMSGSIZE,
            error.EPROTOTYPE => SystemErrno.EPROTOTYPE,
            error.ENOPROTOOPT => SystemErrno.ENOPROTOOPT,
            error.EPROTONOSUPPORT => SystemErrno.EPROTONOSUPPORT,
            error.ESOCKTNOSUPPORT => SystemErrno.ESOCKTNOSUPPORT,
            error.ENOTSUP => SystemErrno.ENOTSUP,
            error.EPFNOSUPPORT => SystemErrno.EPFNOSUPPORT,
            error.EAFNOSUPPORT => SystemErrno.EAFNOSUPPORT,
            error.EADDRINUSE => SystemErrno.EADDRINUSE,
            error.EADDRNOTAVAIL => SystemErrno.EADDRNOTAVAIL,
            error.ENETDOWN => SystemErrno.ENETDOWN,
            error.ENETUNREACH => SystemErrno.ENETUNREACH,
            error.ENETRESET => SystemErrno.ENETRESET,
            error.ECONNABORTED => SystemErrno.ECONNABORTED,
            error.ECONNRESET => SystemErrno.ECONNRESET,
            error.ENOBUFS => SystemErrno.ENOBUFS,
            error.EISCONN => SystemErrno.EISCONN,
            error.ENOTCONN => SystemErrno.ENOTCONN,
            error.ESHUTDOWN => SystemErrno.ESHUTDOWN,
            error.ETOOMANYREFS => SystemErrno.ETOOMANYREFS,
            error.ETIMEDOUT => SystemErrno.ETIMEDOUT,
            error.ECONNREFUSED => SystemErrno.ECONNREFUSED,
            error.EHOSTDOWN => SystemErrno.EHOSTDOWN,
            error.EHOSTUNREACH => SystemErrno.EHOSTUNREACH,
            error.EALREADY => SystemErrno.EALREADY,
            error.EINPROGRESS => SystemErrno.EINPROGRESS,
            error.ESTALE => SystemErrno.ESTALE,
            error.EUCLEAN => SystemErrno.EUCLEAN,
            error.ENOTNAM => SystemErrno.ENOTNAM,
            error.ENAVAIL => SystemErrno.ENAVAIL,
            error.EISNAM => SystemErrno.EISNAM,
            error.EREMOTEIO => SystemErrno.EREMOTEIO,
            error.EDQUOT => SystemErrno.EDQUOT,
            error.ENOMEDIUM => SystemErrno.ENOMEDIUM,
            error.EMEDIUMTYPE => SystemErrno.EMEDIUMTYPE,
            error.ECANCELED => SystemErrno.ECANCELED,
            error.ENOKEY => SystemErrno.ENOKEY,
            error.EKEYEXPIRED => SystemErrno.EKEYEXPIRED,
            error.EKEYREVOKED => SystemErrno.EKEYREVOKED,
            error.EKEYREJECTED => SystemErrno.EKEYREJECTED,
            error.EOWNERDEAD => SystemErrno.EOWNERDEAD,
            error.ENOTRECOVERABLE => SystemErrno.ENOTRECOVERABLE,
            error.ERFKILL => SystemErrno.ERFKILL,
            error.EHWPOISON => SystemErrno.EHWPOISON,
            error.EUNKNOWN => SystemErrno.EUNKNOWN,
            error.ECHARSET => SystemErrno.ECHARSET,
            error.EOF => SystemErrno.EOF,
            else => return null,
        };
    }
    pub fn toError(this: SystemErrno) Error {
        return error_map[@intFromEnum(this)];
    }

    pub fn init(code: anytype) ?SystemErrno {
        if (@TypeOf(code) == u16 or (@TypeOf(code) == c_int and code > 0)) {
            // Win32Error and WSA Error codes
            if (code <= @intFromEnum(Win32Error.IO_REISSUE_AS_CACHED) or (code >= @intFromEnum(Win32Error.WSAEINTR) and code <= @intFromEnum(Win32Error.WSA_QOS_RESERVED_PETYPE))) {
                return init(@as(Win32Error, @enumFromInt(code)));
            } else {
                if (comptime bun.Environment.allow_assert)
                    bun.Output.debugWarn("Unknown error code: {any}\n", .{code});

                return null;
            }
        }

        if (comptime @TypeOf(code) == Win32Error or @TypeOf(code) == std.os.windows.Win32Error) {
            return switch (@as(Win32Error, @enumFromInt(@intFromEnum(code)))) {
                Win32Error.NOACCESS => SystemErrno.EACCES,
                Win32Error.WSAEACCES => SystemErrno.EACCES,
                Win32Error.ELEVATION_REQUIRED => SystemErrno.EACCES,
                Win32Error.CANT_ACCESS_FILE => SystemErrno.EACCES,
                Win32Error.ADDRESS_ALREADY_ASSOCIATED => SystemErrno.EADDRINUSE,
                Win32Error.WSAEADDRINUSE => SystemErrno.EADDRINUSE,
                Win32Error.WSAEADDRNOTAVAIL => SystemErrno.EADDRNOTAVAIL,
                Win32Error.WSAEAFNOSUPPORT => SystemErrno.EAFNOSUPPORT,
                Win32Error.WSAEWOULDBLOCK => SystemErrno.EAGAIN,
                Win32Error.WSAEALREADY => SystemErrno.EALREADY,
                Win32Error.INVALID_FLAGS => SystemErrno.EBADF,
                Win32Error.INVALID_HANDLE => SystemErrno.EBADF,
                Win32Error.LOCK_VIOLATION => SystemErrno.EBUSY,
                Win32Error.PIPE_BUSY => SystemErrno.EBUSY,
                Win32Error.SHARING_VIOLATION => SystemErrno.EBUSY,
                Win32Error.OPERATION_ABORTED => SystemErrno.ECANCELED,
                Win32Error.WSAEINTR => SystemErrno.ECANCELED,
                Win32Error.NO_UNICODE_TRANSLATION => SystemErrno.ECHARSET,
                Win32Error.CONNECTION_ABORTED => SystemErrno.ECONNABORTED,
                Win32Error.WSAECONNABORTED => SystemErrno.ECONNABORTED,
                Win32Error.CONNECTION_REFUSED => SystemErrno.ECONNREFUSED,
                Win32Error.WSAECONNREFUSED => SystemErrno.ECONNREFUSED,
                Win32Error.NETNAME_DELETED => SystemErrno.ECONNRESET,
                Win32Error.WSAECONNRESET => SystemErrno.ECONNRESET,
                Win32Error.ALREADY_EXISTS => SystemErrno.EEXIST,
                Win32Error.FILE_EXISTS => SystemErrno.EEXIST,
                Win32Error.BUFFER_OVERFLOW => SystemErrno.EFAULT,
                Win32Error.WSAEFAULT => SystemErrno.EFAULT,
                Win32Error.HOST_UNREACHABLE => SystemErrno.EHOSTUNREACH,
                Win32Error.WSAEHOSTUNREACH => SystemErrno.EHOSTUNREACH,
                Win32Error.INSUFFICIENT_BUFFER => SystemErrno.EINVAL,
                Win32Error.INVALID_DATA => SystemErrno.EINVAL,
                Win32Error.INVALID_PARAMETER => SystemErrno.EINVAL,
                Win32Error.SYMLINK_NOT_SUPPORTED => SystemErrno.EINVAL,
                Win32Error.WSAEINVAL => SystemErrno.EINVAL,
                Win32Error.WSAEPFNOSUPPORT => SystemErrno.EINVAL,
                Win32Error.BEGINNING_OF_MEDIA => SystemErrno.EIO,
                Win32Error.BUS_RESET => SystemErrno.EIO,
                Win32Error.CRC => SystemErrno.EIO,
                Win32Error.DEVICE_DOOR_OPEN => SystemErrno.EIO,
                Win32Error.DEVICE_REQUIRES_CLEANING => SystemErrno.EIO,
                Win32Error.DISK_CORRUPT => SystemErrno.EIO,
                Win32Error.EOM_OVERFLOW => SystemErrno.EIO,
                Win32Error.FILEMARK_DETECTED => SystemErrno.EIO,
                Win32Error.GEN_FAILURE => SystemErrno.EIO,
                Win32Error.INVALID_BLOCK_LENGTH => SystemErrno.EIO,
                Win32Error.IO_DEVICE => SystemErrno.EIO,
                Win32Error.NO_DATA_DETECTED => SystemErrno.EIO,
                Win32Error.NO_SIGNAL_SENT => SystemErrno.EIO,
                Win32Error.OPEN_FAILED => SystemErrno.EIO,
                Win32Error.SETMARK_DETECTED => SystemErrno.EIO,
                Win32Error.SIGNAL_REFUSED => SystemErrno.EIO,
                Win32Error.WSAEISCONN => SystemErrno.EISCONN,
                Win32Error.CANT_RESOLVE_FILENAME => SystemErrno.ELOOP,
                Win32Error.TOO_MANY_OPEN_FILES => SystemErrno.EMFILE,
                Win32Error.WSAEMFILE => SystemErrno.EMFILE,
                Win32Error.WSAEMSGSIZE => SystemErrno.EMSGSIZE,
                Win32Error.FILENAME_EXCED_RANGE => SystemErrno.ENAMETOOLONG,
                Win32Error.NETWORK_UNREACHABLE => SystemErrno.ENETUNREACH,
                Win32Error.WSAENETUNREACH => SystemErrno.ENETUNREACH,
                Win32Error.WSAENOBUFS => SystemErrno.ENOBUFS,
                Win32Error.BAD_PATHNAME => SystemErrno.ENOENT,
                Win32Error.DIRECTORY => SystemErrno.ENOTDIR,
                Win32Error.ENVVAR_NOT_FOUND => SystemErrno.ENOENT,
                Win32Error.FILE_NOT_FOUND => SystemErrno.ENOENT,
                Win32Error.INVALID_NAME => SystemErrno.ENOENT,
                Win32Error.INVALID_DRIVE => SystemErrno.ENOENT,
                Win32Error.INVALID_REPARSE_DATA => SystemErrno.ENOENT,
                Win32Error.MOD_NOT_FOUND => SystemErrno.ENOENT,
                Win32Error.PATH_NOT_FOUND => SystemErrno.ENOENT,
                Win32Error.WSAHOST_NOT_FOUND => SystemErrno.ENOENT,
                Win32Error.WSANO_DATA => SystemErrno.ENOENT,
                Win32Error.NOT_ENOUGH_MEMORY => SystemErrno.ENOMEM,
                Win32Error.OUTOFMEMORY => SystemErrno.ENOMEM,
                Win32Error.CANNOT_MAKE => SystemErrno.ENOSPC,
                Win32Error.DISK_FULL => SystemErrno.ENOSPC,
                Win32Error.EA_TABLE_FULL => SystemErrno.ENOSPC,
                Win32Error.END_OF_MEDIA => SystemErrno.ENOSPC,
                Win32Error.HANDLE_DISK_FULL => SystemErrno.ENOSPC,
                Win32Error.NOT_CONNECTED => SystemErrno.ENOTCONN,
                Win32Error.WSAENOTCONN => SystemErrno.ENOTCONN,
                Win32Error.DIR_NOT_EMPTY => SystemErrno.ENOTEMPTY,
                Win32Error.WSAENOTSOCK => SystemErrno.ENOTSOCK,
                Win32Error.NOT_SUPPORTED => SystemErrno.ENOTSUP,
                Win32Error.BROKEN_PIPE => SystemErrno.EPIPE,
                Win32Error.ACCESS_DENIED => SystemErrno.EPERM,
                Win32Error.PRIVILEGE_NOT_HELD => SystemErrno.EPERM,
                Win32Error.BAD_PIPE => SystemErrno.EPIPE,
                Win32Error.NO_DATA => SystemErrno.EPIPE,
                Win32Error.PIPE_NOT_CONNECTED => SystemErrno.EPIPE,
                Win32Error.WSAESHUTDOWN => SystemErrno.EPIPE,
                Win32Error.WSAEPROTONOSUPPORT => SystemErrno.EPROTONOSUPPORT,
                Win32Error.WRITE_PROTECT => SystemErrno.EROFS,
                Win32Error.SEM_TIMEOUT => SystemErrno.ETIMEDOUT,
                Win32Error.WSAETIMEDOUT => SystemErrno.ETIMEDOUT,
                Win32Error.NOT_SAME_DEVICE => SystemErrno.EXDEV,
                Win32Error.INVALID_FUNCTION => SystemErrno.EISDIR,
                Win32Error.META_EXPANSION_TOO_LONG => SystemErrno.E2BIG,
                Win32Error.WSAESOCKTNOSUPPORT => SystemErrno.ESOCKTNOSUPPORT,
                Win32Error.DELETE_PENDING => SystemErrno.EBUSY,
                else => null,
            };
        }

        if (code < 0)
            return init(-code);

        if (code >= max) return null;
        return @as(SystemErrno, @enumFromInt(code));
    }

    pub fn label(this: SystemErrno) ?[:0]const u8 {
        return labels.get(this) orelse null;
    }

    const LabelMap = std.enums.EnumMap(SystemErrno, [:0]const u8);
    pub const labels: LabelMap = brk: {
        var map: LabelMap = LabelMap.initFull("");

        map.put(.EPERM, "Operation not permitted");
        map.put(.ENOENT, "No such file or directory");
        map.put(.ESRCH, "No such process");
        map.put(.EINTR, "Interrupted system call");
        map.put(.EIO, "I/O error");
        map.put(.ENXIO, "No such device or address");
        map.put(.E2BIG, "Argument list too long");
        map.put(.ENOEXEC, "Exec format error");
        map.put(.EBADF, "Bad file descriptor");
        map.put(.ECHILD, "No child processes");
        map.put(.EAGAIN, "Try again");
        map.put(.EOF, "End of file");
        map.put(.ENOMEM, "Out of memory");
        map.put(.EACCES, "Permission denied");
        map.put(.EFAULT, "Bad address");
        map.put(.ENOTBLK, "Block device required");
        map.put(.EBUSY, "Device or resource busy");
        map.put(.EEXIST, "File or folder exists");
        map.put(.EXDEV, "Cross-device link");
        map.put(.ENODEV, "No such device");
        map.put(.ENOTDIR, "Not a directory");
        map.put(.EISDIR, "Is a directory");
        map.put(.EINVAL, "Invalid argument");
        map.put(.ENFILE, "File table overflow");
        map.put(.EMFILE, "Too many open files");
        map.put(.ECHARSET, "Invalid or incomplete multibyte or wide character");
        map.put(.ENOTTY, "Not a typewriter");
        map.put(.ETXTBSY, "Text file busy");
        map.put(.EFBIG, "File too large");
        map.put(.ENOSPC, "No space left on device");
        map.put(.ESPIPE, "Illegal seek");
        map.put(.EROFS, "Read-only file system");
        map.put(.EMLINK, "Too many links");
        map.put(.EPIPE, "Broken pipe");
        map.put(.EDOM, "Math argument out of domain of func");
        map.put(.ERANGE, "Math result not representable");
        map.put(.EDEADLK, "Resource deadlock would occur");
        map.put(.ENAMETOOLONG, "File name too long");
        map.put(.ENOLCK, "No record locks available");
        map.put(.EUNKNOWN, "An unknown error occurred");
        map.put(.ENOSYS, "Function not implemented");
        map.put(.ENOTEMPTY, "Directory not empty");
        map.put(.ELOOP, "Too many symbolic links encountered");
        map.put(.ENOMSG, "No message of desired type");
        map.put(.EIDRM, "Identifier removed");
        map.put(.ECHRNG, "Channel number out of range");
        map.put(.EL2NSYNC, "Level 2 not synchronized");
        map.put(.EL3HLT, "Level 3 halted");
        map.put(.EL3RST, "Level 3 reset");
        map.put(.ELNRNG, "Link number out of range");
        map.put(.EUNATCH, "Protocol driver not attached");
        map.put(.ENOCSI, "No CSI structure available");
        map.put(.EL2HLT, "Level 2 halted");
        map.put(.EBADE, "Invalid exchange");
        map.put(.EBADR, "Invalid request descriptor");
        map.put(.EXFULL, "Exchange full");
        map.put(.ENOANO, "No anode");
        map.put(.EBADRQC, "Invalid request code");
        map.put(.EBADSLT, "Invalid slot");
        map.put(.EBFONT, "Bad font file format");
        map.put(.ENOSTR, "Device not a stream");
        map.put(.ENODATA, "No data available");
        map.put(.ETIME, "Timer expired");
        map.put(.ENOSR, "Out of streams resources");
        map.put(.ENONET, "Machine is not on the network");
        map.put(.ENOPKG, "Package not installed");
        map.put(.EREMOTE, "Object is remote");
        map.put(.ENOLINK, "Link has been severed");
        map.put(.EADV, "Advertise error");
        map.put(.ESRMNT, "Srmount error");
        map.put(.ECOMM, "Communication error on send");
        map.put(.EPROTO, "Protocol error");
        map.put(.EMULTIHOP, "Multihop attempted");
        map.put(.EDOTDOT, "RFS specific error");
        map.put(.EBADMSG, "Not a data message");
        map.put(.EOVERFLOW, "Value too large for defined data type");
        map.put(.ENOTUNIQ, "Name not unique on network");
        map.put(.EBADFD, "File descriptor in bad state");
        map.put(.EREMCHG, "Remote address changed");
        map.put(.ELIBACC, "Can not access a needed shared library");
        map.put(.ELIBBAD, "Accessing a corrupted shared library");
        map.put(.ELIBSCN, "lib section in a.out corrupted");
        map.put(.ELIBMAX, "Attempting to link in too many shared libraries");
        map.put(.ELIBEXEC, "Cannot exec a shared library directly");
        map.put(.EILSEQ, "Illegal byte sequence");
        map.put(.ERESTART, "Interrupted system call should be restarted");
        map.put(.ESTRPIPE, "Streams pipe error");
        map.put(.EUSERS, "Too many users");
        map.put(.ENOTSOCK, "Socket operation on non-socket");
        map.put(.EDESTADDRREQ, "Destination address required");
        map.put(.EMSGSIZE, "Message too long");
        map.put(.EPROTOTYPE, "Protocol wrong type for socket");
        map.put(.ENOPROTOOPT, "Protocol not available");
        map.put(.EPROTONOSUPPORT, "Protocol not supported");
        map.put(.ESOCKTNOSUPPORT, "Socket type not supported");
        map.put(.ENOTSUP, "Operation not supported on transport endpoint");
        map.put(.EPFNOSUPPORT, "Protocol family not supported");
        map.put(.EAFNOSUPPORT, "Address family not supported by protocol");
        map.put(.EADDRINUSE, "Address already in use");
        map.put(.EADDRNOTAVAIL, "Cannot assign requested address");
        map.put(.ENETDOWN, "Network is down");
        map.put(.ENETUNREACH, "Network is unreachable");
        map.put(.ENETRESET, "Network dropped connection because of reset");
        map.put(.ECONNABORTED, "Software caused connection abort");
        map.put(.ECONNRESET, "Connection reset by peer");
        map.put(.ENOBUFS, "No buffer space available");
        map.put(.EISCONN, "Transport endpoint is already connected");
        map.put(.ENOTCONN, "Transport endpoint is not connected");
        map.put(.ESHUTDOWN, "Cannot send after transport endpoint shutdown");
        map.put(.ETOOMANYREFS, "Too many references: cannot splice");
        map.put(.ETIMEDOUT, "Connection timed out");
        map.put(.ECONNREFUSED, "Connection refused");
        map.put(.EHOSTDOWN, "Host is down");
        map.put(.EHOSTUNREACH, "No route to host");
        map.put(.EALREADY, "Operation already in progress");
        map.put(.EINPROGRESS, "Operation now in progress");
        map.put(.ESTALE, "Stale NFS file handle");
        map.put(.EUCLEAN, "Structure needs cleaning");
        map.put(.ENOTNAM, "Not a XENIX named type file");
        map.put(.ENAVAIL, "No XENIX semaphores available");
        map.put(.EISNAM, "Is a named type file");
        map.put(.EREMOTEIO, "Remote I/O error");
        map.put(.EDQUOT, "Quota exceeded");
        map.put(.ENOMEDIUM, "No medium found");
        map.put(.EMEDIUMTYPE, "Wrong medium type");
        map.put(.ECANCELED, "Operation Canceled");
        map.put(.ENOKEY, "Required key not available");
        map.put(.EKEYEXPIRED, "Key has expired");
        map.put(.EKEYREVOKED, "Key has been revoked");
        map.put(.EKEYREJECTED, "Key was rejected by service");
        map.put(.EOWNERDEAD, "Owner died");
        map.put(.ENOTRECOVERABLE, "State not recoverable");
        break :brk map;
    };
};

pub const UV_E2BIG = -uv.UV_E2BIG;
pub const UV_EACCES = -uv.UV_EACCES;
pub const UV_EADDRINUSE = -uv.UV_EADDRINUSE;
pub const UV_EADDRNOTAVAIL = -uv.UV_EADDRNOTAVAIL;
pub const UV_EAFNOSUPPORT = -uv.UV_EAFNOSUPPORT;
pub const UV_EAGAIN = -uv.UV_EAGAIN;
pub const UV_EALREADY = -uv.UV_EALREADY;
pub const UV_EBADF = -uv.UV_EBADF;
pub const UV_EBUSY = -uv.UV_EBUSY;
pub const UV_ECANCELED = -uv.UV_ECANCELED;
pub const UV_ECHARSET = -uv.UV_ECHARSET;
pub const UV_ECONNABORTED = -uv.UV_ECONNABORTED;
pub const UV_ECONNREFUSED = -uv.UV_ECONNREFUSED;
pub const UV_ECONNRESET = -uv.UV_ECONNRESET;
pub const UV_EDESTADDRREQ = -uv.UV_EDESTADDRREQ;
pub const UV_EEXIST = -uv.UV_EEXIST;
pub const UV_EFAULT = -uv.UV_EFAULT;
pub const UV_EHOSTUNREACH = -uv.UV_EHOSTUNREACH;
pub const UV_EINTR = -uv.UV_EINTR;
pub const UV_EINVAL = -uv.UV_EINVAL;
pub const UV_EIO = -uv.UV_EIO;
pub const UV_EISCONN = -uv.UV_EISCONN;
pub const UV_EISDIR = -uv.UV_EISDIR;
pub const UV_ELOOP = -uv.UV_ELOOP;
pub const UV_EMFILE = -uv.UV_EMFILE;
pub const UV_EMSGSIZE = -uv.UV_EMSGSIZE;
pub const UV_ENAMETOOLONG = -uv.UV_ENAMETOOLONG;
pub const UV_ENETDOWN = -uv.UV_ENETDOWN;
pub const UV_ENETUNREACH = -uv.UV_ENETUNREACH;
pub const UV_ENFILE = -uv.UV_ENFILE;
pub const UV_ENOBUFS = -uv.UV_ENOBUFS;
pub const UV_ENODEV = -uv.UV_ENODEV;
pub const UV_ENOENT = -uv.UV_ENOENT;
pub const UV_ENOMEM = -uv.UV_ENOMEM;
pub const UV_ENONET = -uv.UV_ENONET;
pub const UV_ENOSPC = -uv.UV_ENOSPC;
pub const UV_ENOSYS = -uv.UV_ENOSYS;
pub const UV_ENOTCONN = -uv.UV_ENOTCONN;
pub const UV_ENOTDIR = -uv.UV_ENOTDIR;
pub const UV_ENOTEMPTY = -uv.UV_ENOTEMPTY;
pub const UV_ENOTSOCK = -uv.UV_ENOTSOCK;
pub const UV_ENOTSUP = -uv.UV_ENOTSUP;
pub const UV_EPERM = -uv.UV_EPERM;
pub const UV_EPIPE = -uv.UV_EPIPE;
pub const UV_EPROTO = -uv.UV_EPROTO;
pub const UV_EPROTONOSUPPORT = -uv.UV_EPROTONOSUPPORT;
pub const UV_EPROTOTYPE = -uv.UV_EPROTOTYPE;
pub const UV_EROFS = -uv.UV_EROFS;
pub const UV_ESHUTDOWN = -uv.UV_ESHUTDOWN;
pub const UV_ESPIPE = -uv.UV_ESPIPE;
pub const UV_ESRCH = -uv.UV_ESRCH;
pub const UV_ETIMEDOUT = -uv.UV_ETIMEDOUT;
pub const UV_ETXTBSY = -uv.UV_ETXTBSY;
pub const UV_EXDEV = -uv.UV_EXDEV;
pub const UV_EFBIG = -uv.UV_EFBIG;
pub const UV_ENOPROTOOPT = -uv.UV_ENOPROTOOPT;
pub const UV_ERANGE = -uv.UV_ERANGE;
pub const UV_ENXIO = -uv.UV_ENXIO;
pub const UV_EMLINK = -uv.UV_EMLINK;
pub const UV_EHOSTDOWN = -uv.UV_EHOSTDOWN;
pub const UV_EREMOTEIO = -uv.UV_EREMOTEIO;
pub const UV_ENOTTY = -uv.UV_ENOTTY;
pub const UV_EFTYPE = -uv.UV_EFTYPE;
pub const UV_EILSEQ = -uv.UV_EILSEQ;
pub const UV_EOVERFLOW = -uv.UV_EOVERFLOW;
pub const UV_ESOCKTNOSUPPORT = -uv.UV_ESOCKTNOSUPPORT;
pub const UV_ENODATA = -uv.UV_ENODATA;
pub const UV_EUNATCH = -uv.UV_EUNATCH;

pub const off_t = i64;
pub fn preallocate_file(_: posix.fd_t, _: off_t, _: off_t) !void {}

const uv = @import("./deps/libuv.zig");

pub const E = enum(u16) {
    SUCCESS = 0,
    PERM = 1,
    NOENT = 2,
    SRCH = 3,
    INTR = 4,
    IO = 5,
    NXIO = 6,
    @"2BIG" = 7,
    NOEXEC = 8,
    BADF = 9,
    CHILD = 10,
    AGAIN = 11,
    NOMEM = 12,
    ACCES = 13,
    FAULT = 14,
    NOTBLK = 15,
    BUSY = 16,
    EXIST = 17,
    XDEV = 18,
    NODEV = 19,
    NOTDIR = 20,
    ISDIR = 21,
    INVAL = 22,
    NFILE = 23,
    MFILE = 24,
    NOTTY = 25,
    TXTBSY = 26,
    FBIG = 27,
    NOSPC = 28,
    SPIPE = 29,
    ROFS = 30,
    MLINK = 31,
    PIPE = 32,
    DOM = 33,
    RANGE = 34,
    DEADLK = 35,
    NAMETOOLONG = 36,
    NOLCK = 37,
    NOSYS = 38,
    NOTEMPTY = 39,
    LOOP = 40,
    WOULDBLOCK = 41,
    NOMSG = 42,
    IDRM = 43,
    CHRNG = 44,
    L2NSYNC = 45,
    L3HLT = 46,
    L3RST = 47,
    LNRNG = 48,
    UNATCH = 49,
    NOCSI = 50,
    L2HLT = 51,
    BADE = 52,
    BADR = 53,
    XFULL = 54,
    NOANO = 55,
    BADRQC = 56,
    BADSLT = 57,
    DEADLOCK = 58,
    BFONT = 59,
    NOSTR = 60,
    NODATA = 61,
    TIME = 62,
    NOSR = 63,
    NONET = 64,
    NOPKG = 65,
    REMOTE = 66,
    NOLINK = 67,
    ADV = 68,
    SRMNT = 69,
    COMM = 70,
    PROTO = 71,
    MULTIHOP = 72,
    DOTDOT = 73,
    BADMSG = 74,
    OVERFLOW = 75,
    NOTUNIQ = 76,
    BADFD = 77,
    REMCHG = 78,
    LIBACC = 79,
    LIBBAD = 80,
    LIBSCN = 81,
    LIBMAX = 82,
    LIBEXEC = 83,
    ILSEQ = 84,
    RESTART = 85,
    STRPIPE = 86,
    USERS = 87,
    NOTSOCK = 88,
    DESTADDRREQ = 89,
    MSGSIZE = 90,
    PROTOTYPE = 91,
    NOPROTOOPT = 92,
    PROTONOSUPPORT = 93,
    SOCKTNOSUPPORT = 94,
    NOTSUP = 95,
    PFNOSUPPORT = 96,
    AFNOSUPPORT = 97,
    ADDRINUSE = 98,
    ADDRNOTAVAIL = 99,
    NETDOWN = 100,
    NETUNREACH = 101,
    NETRESET = 102,
    CONNABORTED = 103,
    CONNRESET = 104,
    NOBUFS = 105,
    ISCONN = 106,
    NOTCONN = 107,
    SHUTDOWN = 108,
    TOOMANYREFS = 109,
    TIMEDOUT = 110,
    CONNREFUSED = 111,
    HOSTDOWN = 112,
    HOSTUNREACH = 113,
    ALREADY = 114,
    INPROGRESS = 115,
    STALE = 116,
    UCLEAN = 117,
    NOTNAM = 118,
    NAVAIL = 119,
    ISNAM = 120,
    REMOTEIO = 121,
    DQUOT = 122,
    NOMEDIUM = 123,
    MEDIUMTYPE = 124,
    CANCELED = 125,
    NOKEY = 126,
    KEYEXPIRED = 127,
    KEYREVOKED = 128,
    KEYREJECTED = 129,
    OWNERDEAD = 130,
    NOTRECOVERABLE = 131,
    RFKILL = 132,
    HWPOISON = 133,
    UNKNOWN = 134,
    CHARSET = 135,
    EOF = 136,

    UV_E2BIG = -uv.UV_E2BIG,
    UV_EACCES = -uv.UV_EACCES,
    UV_EADDRINUSE = -uv.UV_EADDRINUSE,
    UV_EADDRNOTAVAIL = -uv.UV_EADDRNOTAVAIL,
    UV_EAFNOSUPPORT = -uv.UV_EAFNOSUPPORT,
    UV_EAGAIN = -uv.UV_EAGAIN,
    UV_EAI_ADDRFAMILY = -uv.UV_EAI_ADDRFAMILY,
    UV_EAI_AGAIN = -uv.UV_EAI_AGAIN,
    UV_EAI_BADFLAGS = -uv.UV_EAI_BADFLAGS,
    UV_EAI_BADHINTS = -uv.UV_EAI_BADHINTS,
    UV_EAI_CANCELED = -uv.UV_EAI_CANCELED,
    UV_EAI_FAIL = -uv.UV_EAI_FAIL,
    UV_EAI_FAMILY = -uv.UV_EAI_FAMILY,
    UV_EAI_MEMORY = -uv.UV_EAI_MEMORY,
    UV_EAI_NODATA = -uv.UV_EAI_NODATA,
    UV_EAI_NONAME = -uv.UV_EAI_NONAME,
    UV_EAI_OVERFLOW = -uv.UV_EAI_OVERFLOW,
    UV_EAI_PROTOCOL = -uv.UV_EAI_PROTOCOL,
    UV_EAI_SERVICE = -uv.UV_EAI_SERVICE,
    UV_EAI_SOCKTYPE = -uv.UV_EAI_SOCKTYPE,
    UV_EALREADY = -uv.UV_EALREADY,
    UV_EBADF = -uv.UV_EBADF,
    UV_EBUSY = -uv.UV_EBUSY,
    UV_ECANCELED = -uv.UV_ECANCELED,
    UV_ECHARSET = -uv.UV_ECHARSET,
    UV_ECONNABORTED = -uv.UV_ECONNABORTED,
    UV_ECONNREFUSED = -uv.UV_ECONNREFUSED,
    UV_ECONNRESET = -uv.UV_ECONNRESET,
    UV_EDESTADDRREQ = -uv.UV_EDESTADDRREQ,
    UV_EEXIST = -uv.UV_EEXIST,
    UV_EFAULT = -uv.UV_EFAULT,
    UV_EFBIG = -uv.UV_EFBIG,
    UV_EHOSTUNREACH = -uv.UV_EHOSTUNREACH,
    UV_EINVAL = -uv.UV_EINVAL,
    UV_EINTR = -uv.UV_EINTR,
    UV_EISCONN = -uv.UV_EISCONN,
    UV_EIO = -uv.UV_EIO,
    UV_ELOOP = -uv.UV_ELOOP,
    UV_EISDIR = -uv.UV_EISDIR,
    UV_EMSGSIZE = -uv.UV_EMSGSIZE,
    UV_EMFILE = -uv.UV_EMFILE,
    UV_ENETDOWN = -uv.UV_ENETDOWN,
    UV_ENAMETOOLONG = -uv.UV_ENAMETOOLONG,
    UV_ENFILE = -uv.UV_ENFILE,
    UV_ENETUNREACH = -uv.UV_ENETUNREACH,
    UV_ENODEV = -uv.UV_ENODEV,
    UV_ENOBUFS = -uv.UV_ENOBUFS,
    UV_ENOMEM = -uv.UV_ENOMEM,
    UV_ENOENT = -uv.UV_ENOENT,
    UV_ENOPROTOOPT = -uv.UV_ENOPROTOOPT,
    UV_ENONET = -uv.UV_ENONET,
    UV_ENOSYS = -uv.UV_ENOSYS,
    UV_ENOSPC = -uv.UV_ENOSPC,
    UV_ENOTDIR = -uv.UV_ENOTDIR,
    UV_ENOTCONN = -uv.UV_ENOTCONN,
    UV_ENOTSOCK = -uv.UV_ENOTSOCK,
    UV_ENOTEMPTY = -uv.UV_ENOTEMPTY,
    UV_EOVERFLOW = -uv.UV_EOVERFLOW,
    UV_ENOTSUP = -uv.UV_ENOTSUP,
    UV_EPIPE = -uv.UV_EPIPE,
    UV_EPERM = -uv.UV_EPERM,
    UV_EPROTONOSUPPORT = -uv.UV_EPROTONOSUPPORT,
    UV_EPROTO = -uv.UV_EPROTO,
    UV_ERANGE = -uv.UV_ERANGE,
    UV_EPROTOTYPE = -uv.UV_EPROTOTYPE,
    UV_ESHUTDOWN = -uv.UV_ESHUTDOWN,
    UV_EROFS = -uv.UV_EROFS,
    UV_ESRCH = -uv.UV_ESRCH,
    UV_ESPIPE = -uv.UV_ESPIPE,
    UV_ETXTBSY = -uv.UV_ETXTBSY,
    UV_ETIMEDOUT = -uv.UV_ETIMEDOUT,
    UV_UNKNOWN = -uv.UV_UNKNOWN,
    UV_EXDEV = -uv.UV_EXDEV,
    UV_ENXIO = -uv.UV_ENXIO,
    UV_EOF = -uv.UV_EOF,
    UV_EHOSTDOWN = -uv.UV_EHOSTDOWN,
    UV_EMLINK = -uv.UV_EMLINK,
    UV_ENOTTY = -uv.UV_ENOTTY,
    UV_EREMOTEIO = -uv.UV_EREMOTEIO,
    UV_EILSEQ = -uv.UV_EILSEQ,
    UV_EFTYPE = -uv.UV_EFTYPE,
    UV_ENODATA = -uv.UV_ENODATA,
    UV_ESOCKTNOSUPPORT = -uv.UV_ESOCKTNOSUPPORT,
    UV_ERRNO_MAX = -uv.UV_ERRNO_MAX,
    UV_EUNATCH = -uv.UV_EUNATCH,
};

pub const S = struct {
    pub const IFMT = 0o170000;

    pub const IFDIR = 0o040000;
    pub const IFCHR = 0o020000;
    pub const IFBLK = 0o060000;
    pub const IFREG = 0o100000;
    pub const IFIFO = 0o010000;
    pub const IFLNK = 0o120000;
    pub const IFSOCK = 0o140000;

    pub const ISUID = 0o4000;
    pub const ISGID = 0o2000;
    pub const ISVTX = 0o1000;
    pub const IRUSR = 0o400;
    pub const IWUSR = 0o200;
    pub const IXUSR = 0o100;
    pub const IRWXU = 0o700;
    pub const IRGRP = 0o040;
    pub const IWGRP = 0o020;
    pub const IXGRP = 0o010;
    pub const IRWXG = 0o070;
    pub const IROTH = 0o004;
    pub const IWOTH = 0o002;
    pub const IXOTH = 0o001;
    pub const IRWXO = 0o007;

    pub inline fn ISREG(m: i32) bool {
        return m & IFMT == IFREG;
    }

    pub inline fn ISDIR(m: i32) bool {
        return m & IFMT == IFDIR;
    }

    pub inline fn ISCHR(m: i32) bool {
        return m & IFMT == IFCHR;
    }

    pub inline fn ISBLK(m: i32) bool {
        return m & IFMT == IFBLK;
    }

    pub inline fn ISFIFO(m: i32) bool {
        return m & IFMT == IFIFO;
    }

    pub inline fn ISLNK(m: i32) bool {
        return m & IFMT == IFLNK;
    }

    pub inline fn ISSOCK(m: i32) bool {
        return m & IFMT == IFSOCK;
    }
};

pub fn getErrno(_: anytype) E {
    if (Win32Error.get().toSystemErrno()) |sys| {
        return sys.toE();
    }

    if (bun.windows.WSAGetLastError()) |wsa| {
        return wsa.toE();
    }
    return .SUCCESS;
}

const Maybe = bun.JSC.Maybe;

const w = std.os.windows;

extern "c" fn _umask(Mode) Mode;
pub const umask = _umask;

/// Derived from std.os.windows.renameAtW
/// Allows more errors
pub fn renameAtW(
    old_dir_fd: bun.FileDescriptor,
    old_path_w: []const u16,
    new_dir_fd: bun.FileDescriptor,
    new_path_w: []const u16,
    replace_if_exists: bool,
) Maybe(void) {
    const src_fd = brk: {
        switch (bun.sys.openFileAtWindows(
            old_dir_fd,
            old_path_w,
            w.SYNCHRONIZE | w.GENERIC_WRITE | w.DELETE | w.FILE_TRAVERSE,
            w.FILE_OPEN,
            w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_REPARSE_POINT,
        )) {
            .err => {
                // retry, wtihout FILE_TRAVERSE flag
                switch (bun.sys.openFileAtWindows(
                    old_dir_fd,
                    old_path_w,
                    w.SYNCHRONIZE | w.GENERIC_WRITE | w.DELETE,
                    w.FILE_OPEN,
                    w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_REPARSE_POINT,
                )) {
                    .err => |err2| return .{ .err = err2 },
                    .result => |fd| break :brk fd,
                }
            },
            .result => |fd| break :brk fd,
        }
    };
    defer _ = bun.sys.close(src_fd);

    return moveOpenedFileAt(src_fd, new_dir_fd, new_path_w, replace_if_exists);
}

const log = bun.sys.syslog;

/// With an open file source_fd, move it into the directory new_dir_fd with the name new_path_w.
/// Does not close the file descriptor.
///
/// For this to succeed
/// - source_fd must have been opened with access_mask=w.DELETE
/// - new_path_w must be the name of a file. it cannot be a path relative to new_dir_fd. see moveOpenedFileAtLoose
pub fn moveOpenedFileAt(
    src_fd: bun.FileDescriptor,
    new_dir_fd: bun.FileDescriptor,
    new_file_name: []const u16,
    replace_if_exists: bool,
) Maybe(void) {
    // FILE_RENAME_INFORMATION_EX and FILE_RENAME_POSIX_SEMANTICS require >= win10_rs1,
    // but FILE_RENAME_IGNORE_READONLY_ATTRIBUTE requires >= win10_rs5. We check >= rs5 here
    // so that we only use POSIX_SEMANTICS when we know IGNORE_READONLY_ATTRIBUTE will also be
    // supported in order to avoid either (1) using a redundant call that we can know in advance will return
    // STATUS_NOT_SUPPORTED or (2) only setting IGNORE_READONLY_ATTRIBUTE when >= rs5
    // and therefore having different behavior when the Windows version is >= rs1 but < rs5.
    comptime bun.assert(builtin.target.os.version_range.windows.min.isAtLeast(.win10_rs5));

    if (bun.Environment.allow_assert) {
        bun.assert(std.mem.indexOfScalar(u16, new_file_name, '/') == null); // Call moveOpenedFileAtLoose
    }

    const struct_buf_len = @sizeOf(w.FILE_RENAME_INFORMATION_EX) + (bun.MAX_PATH_BYTES - 1);
    var rename_info_buf: [struct_buf_len]u8 align(@alignOf(w.FILE_RENAME_INFORMATION_EX)) = undefined;

    const struct_len = @sizeOf(w.FILE_RENAME_INFORMATION_EX) - 1 + new_file_name.len * 2;
    if (struct_len > struct_buf_len) return Maybe(void).errno(bun.C.E.NAMETOOLONG, .NtSetInformationFile);

    const rename_info = @as(*w.FILE_RENAME_INFORMATION_EX, @ptrCast(&rename_info_buf));
    var io_status_block: w.IO_STATUS_BLOCK = undefined;

    var flags: w.ULONG = w.FILE_RENAME_POSIX_SEMANTICS | w.FILE_RENAME_IGNORE_READONLY_ATTRIBUTE;
    if (replace_if_exists) flags |= w.FILE_RENAME_REPLACE_IF_EXISTS;
    rename_info.* = .{
        .Flags = flags,
        .RootDirectory = if (std.fs.path.isAbsoluteWindowsWTF16(new_file_name)) null else new_dir_fd.cast(),
        .FileNameLength = @intCast(new_file_name.len * 2), // already checked error.NameTooLong
        .FileName = undefined,
    };
    @memcpy(@as([*]u16, &rename_info.FileName)[0..new_file_name.len], new_file_name);
    const rc = w.ntdll.NtSetInformationFile(
        src_fd.cast(),
        &io_status_block,
        rename_info,
        @intCast(struct_len), // already checked for error.NameTooLong
        .FileRenameInformationEx,
    );
    log("moveOpenedFileAt({} ->> {} '{}', {s}) = {s}", .{ src_fd, new_dir_fd, bun.fmt.utf16(new_file_name), if (replace_if_exists) "replace_if_exists" else "no flag", @tagName(rc) });

    if (bun.Environment.isDebug) {
        if (rc == .ACCESS_DENIED) {
            bun.Output.debugWarn("moveOpenedFileAt was called on a file descriptor without access_mask=w.DELETE", .{});
        }
    }

    return if (rc == .SUCCESS)
        Maybe(void).success
    else
        Maybe(void).errno(rc, .NtSetInformationFile);
}

/// Same as moveOpenedFileAt but allows new_path to be a path relative to new_dir_fd.
///
/// Aka: moveOpenedFileAtLoose(fd, dir, ".\\a\\relative\\not-normalized-path.txt", false);
pub fn moveOpenedFileAtLoose(
    src_fd: bun.FileDescriptor,
    new_dir_fd: bun.FileDescriptor,
    new_path: []const u16,
    replace_if_exists: bool,
) Maybe(void) {
    bun.assert(std.mem.indexOfScalar(u16, new_path, '/') == null); // Call bun.strings.toWPathNormalized first

    const without_leading_dot_slash = if (new_path.len >= 2 and new_path[0] == '.' and new_path[1] == '\\')
        new_path[2..]
    else
        new_path;

    if (std.mem.lastIndexOfScalar(u16, new_path, '\\')) |last_slash| {
        const dirname = new_path[0..last_slash];
        const fd = switch (bun.sys.openDirAtWindows(new_dir_fd, dirname, .{ .can_rename_or_delete = true, .iterable = false })) {
            .err => |e| return .{ .err = e },
            .result => |fd| fd,
        };
        defer _ = bun.sys.close(fd);

        const basename = new_path[last_slash + 1 ..];
        return moveOpenedFileAt(src_fd, fd, basename, replace_if_exists);
    }

    // easy mode
    return moveOpenedFileAt(src_fd, new_dir_fd, without_leading_dot_slash, replace_if_exists);
}

const FILE_DISPOSITION_DO_NOT_DELETE: w.ULONG = 0x00000000;
const FILE_DISPOSITION_DELETE: w.ULONG = 0x00000001;
const FILE_DISPOSITION_POSIX_SEMANTICS: w.ULONG = 0x00000002;
const FILE_DISPOSITION_FORCE_IMAGE_SECTION_CHECK: w.ULONG = 0x00000004;
const FILE_DISPOSITION_ON_CLOSE: w.ULONG = 0x00000008;
const FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE: w.ULONG = 0x00000010;

/// Extracted from standard library except this takes an open file descriptor
///
/// NOTE: THE FILE MUST BE OPENED WITH ACCESS_MASK "DELETE" OR THIS WILL FAIL
pub fn deleteOpenedFile(fd: bun.FileDescriptor) Maybe(void) {
    comptime bun.assert(builtin.target.os.version_range.windows.min.isAtLeast(.win10_rs5));
    var info = w.FILE_DISPOSITION_INFORMATION_EX{
        .Flags = FILE_DISPOSITION_DELETE |
            FILE_DISPOSITION_POSIX_SEMANTICS |
            FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };

    var io: w.IO_STATUS_BLOCK = undefined;
    const rc = w.ntdll.NtSetInformationFile(
        fd.cast(),
        &io,
        &info,
        @sizeOf(w.FILE_DISPOSITION_INFORMATION_EX),
        .FileDispositionInformationEx,
    );

    log("deleteOpenedFile({}) = {s}", .{ fd, @tagName(rc) });

    return if (rc == .SUCCESS)
        Maybe(void).success
    else
        Maybe(void).errno(rc, .NtSetInformationFile);
}

pub extern fn windows_enable_stdio_inheritance() void;

pub extern "c" fn quick_exit(code: c_int) noreturn;
