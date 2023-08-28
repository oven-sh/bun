const std = @import("std");
const bun = @import("root").bun;
const builtin = @import("builtin");
const win32 = std.os.windows;
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

pub fn getSystemLoadavg() [3]f32 {
    return .{ 0, 0, 0 };
}

pub const Mode = i32;
const Win32Error = bun.windows.Win32Error;

// The way we do errors in Bun needs to get cleaned up.
// This is way too complicated.
// The problem is because we use libc in some cases and we use zig's std lib in other places and other times we go direct.
// So we end up with a lot of redundant code.
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

    pub const max = 137;

    pub const Error = error{
        PERM,
        NOENT,
        SRCH,
        INTR,
        IO,
        NXIO,
        @"2BIG",
        NOEXEC,
        BADF,
        CHILD,
        AGAIN,
        NOMEM,
        ACCES,
        FAULT,
        NOTBLK,
        BUSY,
        EXIST,
        XDEV,
        NODEV,
        NOTDIR,
        ISDIR,
        INVAL,
        NFILE,
        MFILE,
        NOTTY,
        TXTBSY,
        FBIG,
        NOSPC,
        SPIPE,
        ROFS,
        MLINK,
        PIPE,
        DOM,
        RANGE,
        DEADLK,
        NAMETOOLONG,
        NOLCK,
        NOSYS,
        NOTEMPTY,
        LOOP,
        WOULDBLOCK,
        NOMSG,
        IDRM,
        CHRNG,
        L2NSYNC,
        L3HLT,
        L3RST,
        LNRNG,
        UNATCH,
        NOCSI,
        L2HLT,
        BADE,
        BADR,
        XFULL,
        NOANO,
        BADRQC,
        BADSLT,
        DEADLOCK,
        BFONT,
        NOSTR,
        NODATA,
        TIME,
        NOSR,
        NONET,
        NOPKG,
        REMOTE,
        NOLINK,
        ADV,
        SRMNT,
        COMM,
        PROTO,
        MULTIHOP,
        DOTDOT,
        BADMSG,
        OVERFLOW,
        NOTUNIQ,
        BADFD,
        REMCHG,
        LIBACC,
        LIBBAD,
        LIBSCN,
        LIBMAX,
        LIBEXEC,
        ILSEQ,
        RESTART,
        STRPIPE,
        USERS,
        NOTSOCK,
        DESTADDRREQ,
        MSGSIZE,
        PROTOTYPE,
        NOPROTOOPT,
        PROTONOSUPPORT,
        SOCKTNOSUPPORT,
        NOTSUP,
        PFNOSUPPORT,
        AFNOSUPPORT,
        ADDRINUSE,
        ADDRNOTAVAIL,
        NETDOWN,
        NETUNREACH,
        NETRESET,
        CONNABORTED,
        CONNRESET,
        NOBUFS,
        ISCONN,
        NOTCONN,
        SHUTDOWN,
        TOOMANYREFS,
        TIMEDOUT,
        CONNREFUSED,
        HOSTDOWN,
        HOSTUNREACH,
        ALREADY,
        INPROGRESS,
        STALE,
        UCLEAN,
        NOTNAM,
        NAVAIL,
        ISNAM,
        REMOTEIO,
        DQUOT,
        NOMEDIUM,
        MEDIUMTYPE,
        CANCELED,
        NOKEY,
        KEYEXPIRED,
        KEYREVOKED,
        KEYREJECTED,
        OWNERDEAD,
        NOTRECOVERABLE,
        RFKILL,
        HWPOISON,
        UNKNOWN,
        CHARSET,
        OF,
        Unexpected,
    };

    pub inline fn toE(this: SystemErrno) E {
        return @enumFromInt(@intFromEnum(this));
    }

    const error_map: [SystemErrno.max]Error = brk: {
        var errors: [SystemErrno.max]Error = undefined;
        errors[@intFromEnum(SystemErrno.EPERM)] = error.PERM;
        errors[@intFromEnum(SystemErrno.ENOENT)] = error.NOENT;
        errors[@intFromEnum(SystemErrno.ESRCH)] = error.SRCH;
        errors[@intFromEnum(SystemErrno.EINTR)] = error.INTR;
        errors[@intFromEnum(SystemErrno.EIO)] = error.IO;
        errors[@intFromEnum(SystemErrno.ENXIO)] = error.NXIO;
        errors[@intFromEnum(SystemErrno.E2BIG)] = error.@"2BIG";
        errors[@intFromEnum(SystemErrno.ENOEXEC)] = error.NOEXEC;
        errors[@intFromEnum(SystemErrno.EBADF)] = error.BADF;
        errors[@intFromEnum(SystemErrno.ECHILD)] = error.CHILD;
        errors[@intFromEnum(SystemErrno.EAGAIN)] = error.AGAIN;
        errors[@intFromEnum(SystemErrno.ENOMEM)] = error.NOMEM;
        errors[@intFromEnum(SystemErrno.EACCES)] = error.ACCES;
        errors[@intFromEnum(SystemErrno.EFAULT)] = error.FAULT;
        errors[@intFromEnum(SystemErrno.ENOTBLK)] = error.NOTBLK;
        errors[@intFromEnum(SystemErrno.EBUSY)] = error.BUSY;
        errors[@intFromEnum(SystemErrno.EEXIST)] = error.EXIST;
        errors[@intFromEnum(SystemErrno.EXDEV)] = error.XDEV;
        errors[@intFromEnum(SystemErrno.ENODEV)] = error.NODEV;
        errors[@intFromEnum(SystemErrno.ENOTDIR)] = error.NOTDIR;
        errors[@intFromEnum(SystemErrno.EISDIR)] = error.ISDIR;
        errors[@intFromEnum(SystemErrno.EINVAL)] = error.INVAL;
        errors[@intFromEnum(SystemErrno.ENFILE)] = error.NFILE;
        errors[@intFromEnum(SystemErrno.EMFILE)] = error.MFILE;
        errors[@intFromEnum(SystemErrno.ENOTTY)] = error.NOTTY;
        errors[@intFromEnum(SystemErrno.ETXTBSY)] = error.TXTBSY;
        errors[@intFromEnum(SystemErrno.EFBIG)] = error.FBIG;
        errors[@intFromEnum(SystemErrno.ENOSPC)] = error.NOSPC;
        errors[@intFromEnum(SystemErrno.ESPIPE)] = error.SPIPE;
        errors[@intFromEnum(SystemErrno.EROFS)] = error.ROFS;
        errors[@intFromEnum(SystemErrno.EMLINK)] = error.MLINK;
        errors[@intFromEnum(SystemErrno.EPIPE)] = error.PIPE;
        errors[@intFromEnum(SystemErrno.EDOM)] = error.DOM;
        errors[@intFromEnum(SystemErrno.ERANGE)] = error.RANGE;
        errors[@intFromEnum(SystemErrno.EDEADLK)] = error.DEADLK;
        errors[@intFromEnum(SystemErrno.ENAMETOOLONG)] = error.NAMETOOLONG;
        errors[@intFromEnum(SystemErrno.ENOLCK)] = error.NOLCK;
        errors[@intFromEnum(SystemErrno.ENOSYS)] = error.NOSYS;
        errors[@intFromEnum(SystemErrno.ENOTEMPTY)] = error.NOTEMPTY;
        errors[@intFromEnum(SystemErrno.ELOOP)] = error.LOOP;
        errors[@intFromEnum(SystemErrno.EWOULDBLOCK)] = error.WOULDBLOCK;
        errors[@intFromEnum(SystemErrno.ENOMSG)] = error.NOMSG;
        errors[@intFromEnum(SystemErrno.EIDRM)] = error.IDRM;
        errors[@intFromEnum(SystemErrno.ECHRNG)] = error.CHRNG;
        errors[@intFromEnum(SystemErrno.EL2NSYNC)] = error.L2NSYNC;
        errors[@intFromEnum(SystemErrno.EL3HLT)] = error.L3HLT;
        errors[@intFromEnum(SystemErrno.EL3RST)] = error.L3RST;
        errors[@intFromEnum(SystemErrno.ELNRNG)] = error.LNRNG;
        errors[@intFromEnum(SystemErrno.EUNATCH)] = error.UNATCH;
        errors[@intFromEnum(SystemErrno.ENOCSI)] = error.NOCSI;
        errors[@intFromEnum(SystemErrno.EL2HLT)] = error.L2HLT;
        errors[@intFromEnum(SystemErrno.EBADE)] = error.BADE;
        errors[@intFromEnum(SystemErrno.EBADR)] = error.BADR;
        errors[@intFromEnum(SystemErrno.EXFULL)] = error.XFULL;
        errors[@intFromEnum(SystemErrno.ENOANO)] = error.NOANO;
        errors[@intFromEnum(SystemErrno.EBADRQC)] = error.BADRQC;
        errors[@intFromEnum(SystemErrno.EBADSLT)] = error.BADSLT;
        errors[@intFromEnum(SystemErrno.EDEADLOCK)] = error.DEADLOCK;
        errors[@intFromEnum(SystemErrno.EBFONT)] = error.BFONT;
        errors[@intFromEnum(SystemErrno.ENOSTR)] = error.NOSTR;
        errors[@intFromEnum(SystemErrno.ENODATA)] = error.NODATA;
        errors[@intFromEnum(SystemErrno.ETIME)] = error.TIME;
        errors[@intFromEnum(SystemErrno.ENOSR)] = error.NOSR;
        errors[@intFromEnum(SystemErrno.ENONET)] = error.NONET;
        errors[@intFromEnum(SystemErrno.ENOPKG)] = error.NOPKG;
        errors[@intFromEnum(SystemErrno.EREMOTE)] = error.REMOTE;
        errors[@intFromEnum(SystemErrno.ENOLINK)] = error.NOLINK;
        errors[@intFromEnum(SystemErrno.EADV)] = error.ADV;
        errors[@intFromEnum(SystemErrno.ESRMNT)] = error.SRMNT;
        errors[@intFromEnum(SystemErrno.ECOMM)] = error.COMM;
        errors[@intFromEnum(SystemErrno.EPROTO)] = error.PROTO;
        errors[@intFromEnum(SystemErrno.EMULTIHOP)] = error.MULTIHOP;
        errors[@intFromEnum(SystemErrno.EDOTDOT)] = error.DOTDOT;
        errors[@intFromEnum(SystemErrno.EBADMSG)] = error.BADMSG;
        errors[@intFromEnum(SystemErrno.EOVERFLOW)] = error.OVERFLOW;
        errors[@intFromEnum(SystemErrno.ENOTUNIQ)] = error.NOTUNIQ;
        errors[@intFromEnum(SystemErrno.EBADFD)] = error.BADFD;
        errors[@intFromEnum(SystemErrno.EREMCHG)] = error.REMCHG;
        errors[@intFromEnum(SystemErrno.ELIBACC)] = error.LIBACC;
        errors[@intFromEnum(SystemErrno.ELIBBAD)] = error.LIBBAD;
        errors[@intFromEnum(SystemErrno.ELIBSCN)] = error.LIBSCN;
        errors[@intFromEnum(SystemErrno.ELIBMAX)] = error.LIBMAX;
        errors[@intFromEnum(SystemErrno.ELIBEXEC)] = error.LIBEXEC;
        errors[@intFromEnum(SystemErrno.EILSEQ)] = error.ILSEQ;
        errors[@intFromEnum(SystemErrno.ERESTART)] = error.RESTART;
        errors[@intFromEnum(SystemErrno.ESTRPIPE)] = error.STRPIPE;
        errors[@intFromEnum(SystemErrno.EUSERS)] = error.USERS;
        errors[@intFromEnum(SystemErrno.ENOTSOCK)] = error.NOTSOCK;
        errors[@intFromEnum(SystemErrno.EDESTADDRREQ)] = error.DESTADDRREQ;
        errors[@intFromEnum(SystemErrno.EMSGSIZE)] = error.MSGSIZE;
        errors[@intFromEnum(SystemErrno.EPROTOTYPE)] = error.PROTOTYPE;
        errors[@intFromEnum(SystemErrno.ENOPROTOOPT)] = error.NOPROTOOPT;
        errors[@intFromEnum(SystemErrno.EPROTONOSUPPORT)] = error.PROTONOSUPPORT;
        errors[@intFromEnum(SystemErrno.ESOCKTNOSUPPORT)] = error.SOCKTNOSUPPORT;
        errors[@intFromEnum(SystemErrno.ENOTSUP)] = error.NOTSUP;
        errors[@intFromEnum(SystemErrno.EPFNOSUPPORT)] = error.PFNOSUPPORT;
        errors[@intFromEnum(SystemErrno.EAFNOSUPPORT)] = error.AFNOSUPPORT;
        errors[@intFromEnum(SystemErrno.EADDRINUSE)] = error.ADDRINUSE;
        errors[@intFromEnum(SystemErrno.EADDRNOTAVAIL)] = error.ADDRNOTAVAIL;
        errors[@intFromEnum(SystemErrno.ENETDOWN)] = error.NETDOWN;
        errors[@intFromEnum(SystemErrno.ENETUNREACH)] = error.NETUNREACH;
        errors[@intFromEnum(SystemErrno.ENETRESET)] = error.NETRESET;
        errors[@intFromEnum(SystemErrno.ECONNABORTED)] = error.CONNABORTED;
        errors[@intFromEnum(SystemErrno.ECONNRESET)] = error.CONNRESET;
        errors[@intFromEnum(SystemErrno.ENOBUFS)] = error.NOBUFS;
        errors[@intFromEnum(SystemErrno.EISCONN)] = error.ISCONN;
        errors[@intFromEnum(SystemErrno.ENOTCONN)] = error.NOTCONN;
        errors[@intFromEnum(SystemErrno.ESHUTDOWN)] = error.SHUTDOWN;
        errors[@intFromEnum(SystemErrno.ETOOMANYREFS)] = error.TOOMANYREFS;
        errors[@intFromEnum(SystemErrno.ETIMEDOUT)] = error.TIMEDOUT;
        errors[@intFromEnum(SystemErrno.ECONNREFUSED)] = error.CONNREFUSED;
        errors[@intFromEnum(SystemErrno.EHOSTDOWN)] = error.HOSTDOWN;
        errors[@intFromEnum(SystemErrno.EHOSTUNREACH)] = error.HOSTUNREACH;
        errors[@intFromEnum(SystemErrno.EALREADY)] = error.ALREADY;
        errors[@intFromEnum(SystemErrno.EINPROGRESS)] = error.INPROGRESS;
        errors[@intFromEnum(SystemErrno.ESTALE)] = error.STALE;
        errors[@intFromEnum(SystemErrno.EUCLEAN)] = error.UCLEAN;
        errors[@intFromEnum(SystemErrno.ENOTNAM)] = error.NOTNAM;
        errors[@intFromEnum(SystemErrno.ENAVAIL)] = error.NAVAIL;
        errors[@intFromEnum(SystemErrno.EISNAM)] = error.ISNAM;
        errors[@intFromEnum(SystemErrno.EREMOTEIO)] = error.REMOTEIO;
        errors[@intFromEnum(SystemErrno.EDQUOT)] = error.DQUOT;
        errors[@intFromEnum(SystemErrno.ENOMEDIUM)] = error.NOMEDIUM;
        errors[@intFromEnum(SystemErrno.EMEDIUMTYPE)] = error.MEDIUMTYPE;
        errors[@intFromEnum(SystemErrno.ECANCELED)] = error.CANCELED;
        errors[@intFromEnum(SystemErrno.ENOKEY)] = error.NOKEY;
        errors[@intFromEnum(SystemErrno.EKEYEXPIRED)] = error.KEYEXPIRED;
        errors[@intFromEnum(SystemErrno.EKEYREVOKED)] = error.KEYREVOKED;
        errors[@intFromEnum(SystemErrno.EKEYREJECTED)] = error.KEYREJECTED;
        errors[@intFromEnum(SystemErrno.EOWNERDEAD)] = error.OWNERDEAD;
        errors[@intFromEnum(SystemErrno.ENOTRECOVERABLE)] = error.NOTRECOVERABLE;
        errors[@intFromEnum(SystemErrno.ERFKILL)] = error.RFKILL;
        errors[@intFromEnum(SystemErrno.EHWPOISON)] = error.HWPOISON;
        errors[@intFromEnum(SystemErrno.EUNKNOWN)] = error.UNKNOWN;
        errors[@intFromEnum(SystemErrno.ECHARSET)] = error.CHARSET;
        errors[@intFromEnum(SystemErrno.EOF)] = error.OF;
        break :brk errors;
    };

    pub fn fromError(err: anyerror) ?SystemErrno {
        return switch (err) {
            error.PERM => SystemErrno.EPERM,
            error.NOENT => SystemErrno.ENOENT,
            error.SRCH => SystemErrno.ESRCH,
            error.INTR => SystemErrno.EINTR,
            error.IO => SystemErrno.EIO,
            error.NXIO => SystemErrno.ENXIO,
            error.@"2BIG" => SystemErrno.E2BIG,
            error.NOEXEC => SystemErrno.ENOEXEC,
            error.BADF => SystemErrno.EBADF,
            error.CHILD => SystemErrno.ECHILD,
            error.AGAIN => SystemErrno.EAGAIN,
            error.NOMEM => SystemErrno.ENOMEM,
            error.ACCES => SystemErrno.EACCES,
            error.FAULT => SystemErrno.EFAULT,
            error.NOTBLK => SystemErrno.ENOTBLK,
            error.BUSY => SystemErrno.EBUSY,
            error.EXIST => SystemErrno.EEXIST,
            error.XDEV => SystemErrno.EXDEV,
            error.NODEV => SystemErrno.ENODEV,
            error.NOTDIR => SystemErrno.ENOTDIR,
            error.ISDIR => SystemErrno.EISDIR,
            error.INVAL => SystemErrno.EINVAL,
            error.NFILE => SystemErrno.ENFILE,
            error.MFILE => SystemErrno.EMFILE,
            error.NOTTY => SystemErrno.ENOTTY,
            error.TXTBSY => SystemErrno.ETXTBSY,
            error.FBIG => SystemErrno.EFBIG,
            error.NOSPC => SystemErrno.ENOSPC,
            error.SPIPE => SystemErrno.ESPIPE,
            error.ROFS => SystemErrno.EROFS,
            error.MLINK => SystemErrno.EMLINK,
            error.PIPE => SystemErrno.EPIPE,
            error.DOM => SystemErrno.EDOM,
            error.RANGE => SystemErrno.ERANGE,
            error.DEADLK => SystemErrno.EDEADLK,
            error.NAMETOOLONG => SystemErrno.ENAMETOOLONG,
            error.NOLCK => SystemErrno.ENOLCK,
            error.NOSYS => SystemErrno.ENOSYS,
            error.NOTEMPTY => SystemErrno.ENOTEMPTY,
            error.LOOP => SystemErrno.ELOOP,
            error.WOULDBLOCK => SystemErrno.EWOULDBLOCK,
            error.NOMSG => SystemErrno.ENOMSG,
            error.IDRM => SystemErrno.EIDRM,
            error.CHRNG => SystemErrno.ECHRNG,
            error.L2NSYNC => SystemErrno.EL2NSYNC,
            error.L3HLT => SystemErrno.EL3HLT,
            error.L3RST => SystemErrno.EL3RST,
            error.LNRNG => SystemErrno.ELNRNG,
            error.UNATCH => SystemErrno.EUNATCH,
            error.NOCSI => SystemErrno.ENOCSI,
            error.L2HLT => SystemErrno.EL2HLT,
            error.BADE => SystemErrno.EBADE,
            error.BADR => SystemErrno.EBADR,
            error.XFULL => SystemErrno.EXFULL,
            error.NOANO => SystemErrno.ENOANO,
            error.BADRQC => SystemErrno.EBADRQC,
            error.BADSLT => SystemErrno.EBADSLT,
            error.DEADLOCK => SystemErrno.EDEADLOCK,
            error.BFONT => SystemErrno.EBFONT,
            error.NOSTR => SystemErrno.ENOSTR,
            error.NODATA => SystemErrno.ENODATA,
            error.TIME => SystemErrno.ETIME,
            error.NOSR => SystemErrno.ENOSR,
            error.NONET => SystemErrno.ENONET,
            error.NOPKG => SystemErrno.ENOPKG,
            error.REMOTE => SystemErrno.EREMOTE,
            error.NOLINK => SystemErrno.ENOLINK,
            error.ADV => SystemErrno.EADV,
            error.SRMNT => SystemErrno.ESRMNT,
            error.COMM => SystemErrno.ECOMM,
            error.PROTO => SystemErrno.EPROTO,
            error.MULTIHOP => SystemErrno.EMULTIHOP,
            error.DOTDOT => SystemErrno.EDOTDOT,
            error.BADMSG => SystemErrno.EBADMSG,
            error.OVERFLOW => SystemErrno.EOVERFLOW,
            error.NOTUNIQ => SystemErrno.ENOTUNIQ,
            error.BADFD => SystemErrno.EBADFD,
            error.REMCHG => SystemErrno.EREMCHG,
            error.LIBACC => SystemErrno.ELIBACC,
            error.LIBBAD => SystemErrno.ELIBBAD,
            error.LIBSCN => SystemErrno.ELIBSCN,
            error.LIBMAX => SystemErrno.ELIBMAX,
            error.LIBEXEC => SystemErrno.ELIBEXEC,
            error.ILSEQ => SystemErrno.EILSEQ,
            error.RESTART => SystemErrno.ERESTART,
            error.STRPIPE => SystemErrno.ESTRPIPE,
            error.USERS => SystemErrno.EUSERS,
            error.NOTSOCK => SystemErrno.ENOTSOCK,
            error.DESTADDRREQ => SystemErrno.EDESTADDRREQ,
            error.MSGSIZE => SystemErrno.EMSGSIZE,
            error.PROTOTYPE => SystemErrno.EPROTOTYPE,
            error.NOPROTOOPT => SystemErrno.ENOPROTOOPT,
            error.PROTONOSUPPORT => SystemErrno.EPROTONOSUPPORT,
            error.SOCKTNOSUPPORT => SystemErrno.ESOCKTNOSUPPORT,
            error.NOTSUP => SystemErrno.ENOTSUP,
            error.PFNOSUPPORT => SystemErrno.EPFNOSUPPORT,
            error.AFNOSUPPORT => SystemErrno.EAFNOSUPPORT,
            error.ADDRINUSE => SystemErrno.EADDRINUSE,
            error.ADDRNOTAVAIL => SystemErrno.EADDRNOTAVAIL,
            error.NETDOWN => SystemErrno.ENETDOWN,
            error.NETUNREACH => SystemErrno.ENETUNREACH,
            error.NETRESET => SystemErrno.ENETRESET,
            error.CONNABORTED => SystemErrno.ECONNABORTED,
            error.CONNRESET => SystemErrno.ECONNRESET,
            error.NOBUFS => SystemErrno.ENOBUFS,
            error.ISCONN => SystemErrno.EISCONN,
            error.NOTCONN => SystemErrno.ENOTCONN,
            error.SHUTDOWN => SystemErrno.ESHUTDOWN,
            error.TOOMANYREFS => SystemErrno.ETOOMANYREFS,
            error.TIMEDOUT => SystemErrno.ETIMEDOUT,
            error.CONNREFUSED => SystemErrno.ECONNREFUSED,
            error.HOSTDOWN => SystemErrno.EHOSTDOWN,
            error.HOSTUNREACH => SystemErrno.EHOSTUNREACH,
            error.ALREADY => SystemErrno.EALREADY,
            error.INPROGRESS => SystemErrno.EINPROGRESS,
            error.STALE => SystemErrno.ESTALE,
            error.UCLEAN => SystemErrno.EUCLEAN,
            error.NOTNAM => SystemErrno.ENOTNAM,
            error.NAVAIL => SystemErrno.ENAVAIL,
            error.ISNAM => SystemErrno.EISNAM,
            error.REMOTEIO => SystemErrno.EREMOTEIO,
            error.DQUOT => SystemErrno.EDQUOT,
            error.NOMEDIUM => SystemErrno.ENOMEDIUM,
            error.MEDIUMTYPE => SystemErrno.EMEDIUMTYPE,
            error.CANCELED => SystemErrno.ECANCELED,
            error.NOKEY => SystemErrno.ENOKEY,
            error.KEYEXPIRED => SystemErrno.EKEYEXPIRED,
            error.KEYREVOKED => SystemErrno.EKEYREVOKED,
            error.KEYREJECTED => SystemErrno.EKEYREJECTED,
            error.OWNERDEAD => SystemErrno.EOWNERDEAD,
            error.NOTRECOVERABLE => SystemErrno.ENOTRECOVERABLE,
            error.RFKILL => SystemErrno.ERFKILL,
            error.HWPOISON => SystemErrno.EHWPOISON,
            error.UNKNOWN => SystemErrno.EUNKNOWN,
            error.CHARSET => SystemErrno.ECHARSET,
            error.OF => SystemErrno.EOF,
            else => return null,
        };
    }
    pub fn toError(this: SystemErrno) Error {
        return error_map[@intFromEnum(this)];
    }

    pub fn init(code: anytype) ?SystemErrno {
        if (comptime @TypeOf(code) == u16) {
            if (code <= 3950) {
                return init(@as(Win32Error, @enumFromInt(code)));
            } else {
                if (comptime bun.Environment.allow_assert)
                    bun.Output.debug("Unknown error code: {}\n", .{code});

                return null;
            }
        }

        if (comptime @TypeOf(code) == Win32Error) {
            return switch (code) {
                Win32Error.NOACCESS => SystemErrno.EACCES,
                @as(Win32Error, @enumFromInt(10013)) => SystemErrno.EACCES,
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
                Win32Error.DIRECTORY => SystemErrno.ENOENT,
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
                Win32Error.BROKEN_PIPE => SystemErrno.EOF,
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
                else => return null,
            };
        }

        if (comptime std.meta.trait.isSignedInt(@TypeOf(code))) {
            if (code < 0)
                return init(-code);
        }

        if (code >= max) return null;
        return @as(SystemErrno, @enumFromInt(code));
    }

    pub fn label(this: SystemErrno) ?[]const u8 {
        return labels.get(this) orelse null;
    }

    const LabelMap = std.EnumMap(SystemErrno, []const u8);
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
        map.put(.EBADF, "Bad file number");
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

pub const off_t = i64;
pub fn preallocate_file(_: os.fd_t, _: off_t, _: off_t) !void {}

pub const E = enum(u8) {
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
    OF = 136,
};

pub fn getErrno(_: anytype) E {
    if (Win32Error.get().toSystemErrno()) |sys| {
        return sys.toE();
    }

    return .SUCCESS;
}
