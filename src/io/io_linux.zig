const std = @import("std");
const assert = std.debug.assert;
const Platform = @import("root").bun.analytics.GenerateHeader.GeneratePlatform;
const os = struct {
    pub usingnamespace std.os;
    pub const EPERM = 1;
    pub const ENOENT = 2;
    pub const ESRCH = 3;
    pub const EINTR = 4;
    pub const EIO = 5;
    pub const ENXIO = 6;
    pub const E2BIG = 7;
    pub const ENOEXEC = 8;
    pub const EBADF = 9;
    pub const ECHILD = 10;
    pub const EAGAIN = 11;
    pub const ENOMEM = 12;
    pub const EACCES = 13;
    pub const EFAULT = 14;
    pub const ENOTBLK = 15;
    pub const EBUSY = 16;
    pub const EEXIST = 17;
    pub const EXDEV = 18;
    pub const ENODEV = 19;
    pub const ENOTDIR = 20;
    pub const EISDIR = 21;
    pub const EINVAL = 22;
    pub const ENFILE = 23;
    pub const EMFILE = 24;
    pub const ENOTTY = 25;
    pub const ETXTBSY = 26;
    pub const EFBIG = 27;
    pub const ENOSPC = 28;
    pub const ESPIPE = 29;
    pub const EROFS = 30;
    pub const EMLINK = 31;
    pub const EPIPE = 32;
    pub const EDOM = 33;
    pub const ERANGE = 34;
    pub const EDEADLK = 35;
    pub const ENAMETOOLONG = 36;
    pub const ENOLCK = 37;
    pub const ENOSYS = 38;
    pub const ENOTEMPTY = 39;
    pub const ELOOP = 40;
    pub const EWOULDBLOCK = 41;
    pub const ENOMSG = 42;
    pub const EIDRM = 43;
    pub const ECHRNG = 44;
    pub const EL2NSYNC = 45;
    pub const EL3HLT = 46;
    pub const EL3RST = 47;
    pub const ELNRNG = 48;
    pub const EUNATCH = 49;
    pub const ENOCSI = 50;
    pub const EL2HLT = 51;
    pub const EBADE = 52;
    pub const EBADR = 53;
    pub const EXFULL = 54;
    pub const ENOANO = 55;
    pub const EBADRQC = 56;
    pub const EBADSLT = 57;
    pub const EDEADLOCK = 58;
    pub const EBFONT = 59;
    pub const ENOSTR = 60;
    pub const ENODATA = 61;
    pub const ETIME = 62;
    pub const ENOSR = 63;
    pub const ENONET = 64;
    pub const ENOPKG = 65;
    pub const EREMOTE = 66;
    pub const ENOLINK = 67;
    pub const EADV = 68;
    pub const ESRMNT = 69;
    pub const ECOMM = 70;
    pub const EPROTO = 71;
    pub const EMULTIHOP = 72;
    pub const EDOTDOT = 73;
    pub const EBADMSG = 74;
    pub const EOVERFLOW = 75;
    pub const ENOTUNIQ = 76;
    pub const EBADFD = 77;
    pub const EREMCHG = 78;
    pub const ELIBACC = 79;
    pub const ELIBBAD = 80;
    pub const ELIBSCN = 81;
    pub const ELIBMAX = 82;
    pub const ELIBEXEC = 83;
    pub const EILSEQ = 84;
    pub const ERESTART = 85;
    pub const ESTRPIPE = 86;
    pub const EUSERS = 87;
    pub const ENOTSOCK = 88;
    pub const EDESTADDRREQ = 89;
    pub const EMSGSIZE = 90;
    pub const EPROTOTYPE = 91;
    pub const ENOPROTOOPT = 92;
    pub const EPROTONOSUPPORT = 93;
    pub const ESOCKTNOSUPPORT = 94;
    /// For Linux, EOPNOTSUPP is the real value
    /// but it's ~the same and is incompatible across operating systems
    /// https://lists.gnu.org/archive/html/bug-glibc/2002-08/msg00017.html
    pub const ENOTSUP = 95;
    pub const EOPNOTSUPP = ENOTSUP;
    pub const EPFNOSUPPORT = 96;
    pub const EAFNOSUPPORT = 97;
    pub const EADDRINUSE = 98;
    pub const EADDRNOTAVAIL = 99;
    pub const ENETDOWN = 100;
    pub const ENETUNREACH = 101;
    pub const ENETRESET = 102;
    pub const ECONNABORTED = 103;
    pub const ECONNRESET = 104;
    pub const ENOBUFS = 105;
    pub const EISCONN = 106;
    pub const ENOTCONN = 107;
    pub const ESHUTDOWN = 108;
    pub const ETOOMANYREFS = 109;
    pub const ETIMEDOUT = 110;
    pub const ECONNREFUSED = 111;
    pub const EHOSTDOWN = 112;
    pub const EHOSTUNREACH = 113;
    pub const EALREADY = 114;
    pub const EINPROGRESS = 115;
    pub const ESTALE = 116;
    pub const EUCLEAN = 117;
    pub const ENOTNAM = 118;
    pub const ENAVAIL = 119;
    pub const EISNAM = 120;
    pub const EREMOTEIO = 121;
    pub const EDQUOT = 122;
    pub const ENOMEDIUM = 123;
    pub const EMEDIUMTYPE = 124;
    pub const ECANCELED = 125;
    pub const ENOKEY = 126;
    pub const EKEYEXPIRED = 127;
    pub const EKEYREVOKED = 128;
    pub const EKEYREJECTED = 129;
    pub const EOWNERDEAD = 130;
    pub const ENOTRECOVERABLE = 131;
    pub const ERFKILL = 132;
    pub const EHWPOISON = 133;
};

pub const Waker = struct {
    fd: os.fd_t,

    pub fn init(allocator: std.mem.Allocator) !Waker {
        return initWithFileDescriptor(allocator, @as(os.fd_t, @intCast(try std.os.eventfd(0, 0))));
    }

    pub fn getFd(this: *const Waker) os.fd_t {
        return this.fd;
    }

    pub fn initWithFileDescriptor(_: std.mem.Allocator, fd: os.fd_t) Waker {
        return Waker{
            .fd = fd,
        };
    }

    pub fn wait(this: Waker) void {
        var bytes: usize = 0;
        _ = std.os.read(this.fd, @as(*[8]u8, @ptrCast(&bytes))) catch 0;
    }

    pub fn wake(this: *const Waker) void {
        var bytes: usize = 1;
        _ = std.os.write(
            this.fd,
            @as(*[8]u8, @ptrCast(&bytes)),
        ) catch 0;
    }
};

pub const Errno = error{
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
    Unexpected,
};
pub const errno_map: [135]Errno = brk: {
    var errors: [135]Errno = undefined;
    errors[0] = error.Unexpected;
    errors[1] = error.EPERM;
    errors[2] = error.ENOENT;
    errors[3] = error.ESRCH;
    errors[4] = error.EINTR;
    errors[5] = error.EIO;
    errors[6] = error.ENXIO;
    errors[7] = error.E2BIG;
    errors[8] = error.ENOEXEC;
    errors[9] = error.EBADF;
    errors[10] = error.ECHILD;
    errors[11] = error.EAGAIN;
    errors[12] = error.ENOMEM;
    errors[13] = error.EACCES;
    errors[14] = error.EFAULT;
    errors[15] = error.ENOTBLK;
    errors[16] = error.EBUSY;
    errors[17] = error.EEXIST;
    errors[18] = error.EXDEV;
    errors[19] = error.ENODEV;
    errors[20] = error.ENOTDIR;
    errors[21] = error.EISDIR;
    errors[22] = error.EINVAL;
    errors[23] = error.ENFILE;
    errors[24] = error.EMFILE;
    errors[25] = error.ENOTTY;
    errors[26] = error.ETXTBSY;
    errors[27] = error.EFBIG;
    errors[28] = error.ENOSPC;
    errors[29] = error.ESPIPE;
    errors[30] = error.EROFS;
    errors[31] = error.EMLINK;
    errors[32] = error.EPIPE;
    errors[33] = error.EDOM;
    errors[34] = error.ERANGE;
    errors[35] = error.EDEADLK;
    errors[36] = error.ENAMETOOLONG;
    errors[37] = error.ENOLCK;
    errors[38] = error.ENOSYS;
    errors[39] = error.ENOTEMPTY;
    errors[40] = error.ELOOP;
    errors[41] = error.EWOULDBLOCK;
    errors[42] = error.ENOMSG;
    errors[43] = error.EIDRM;
    errors[44] = error.ECHRNG;
    errors[45] = error.EL2NSYNC;
    errors[46] = error.EL3HLT;
    errors[47] = error.EL3RST;
    errors[48] = error.ELNRNG;
    errors[49] = error.EUNATCH;
    errors[50] = error.ENOCSI;
    errors[51] = error.EL2HLT;
    errors[52] = error.EBADE;
    errors[53] = error.EBADR;
    errors[54] = error.EXFULL;
    errors[55] = error.ENOANO;
    errors[56] = error.EBADRQC;
    errors[57] = error.EBADSLT;
    errors[58] = error.EDEADLOCK;
    errors[59] = error.EBFONT;
    errors[60] = error.ENOSTR;
    errors[61] = error.ENODATA;
    errors[62] = error.ETIME;
    errors[63] = error.ENOSR;
    errors[64] = error.ENONET;
    errors[65] = error.ENOPKG;
    errors[66] = error.EREMOTE;
    errors[67] = error.ENOLINK;
    errors[68] = error.EADV;
    errors[69] = error.ESRMNT;
    errors[70] = error.ECOMM;
    errors[71] = error.EPROTO;
    errors[72] = error.EMULTIHOP;
    errors[73] = error.EDOTDOT;
    errors[74] = error.EBADMSG;
    errors[75] = error.EOVERFLOW;
    errors[76] = error.ENOTUNIQ;
    errors[77] = error.EBADFD;
    errors[78] = error.EREMCHG;
    errors[79] = error.ELIBACC;
    errors[80] = error.ELIBBAD;
    errors[81] = error.ELIBSCN;
    errors[82] = error.ELIBMAX;
    errors[83] = error.ELIBEXEC;
    errors[84] = error.EILSEQ;
    errors[85] = error.ERESTART;
    errors[86] = error.ESTRPIPE;
    errors[87] = error.EUSERS;
    errors[88] = error.ENOTSOCK;
    errors[89] = error.EDESTADDRREQ;
    errors[90] = error.EMSGSIZE;
    errors[91] = error.EPROTOTYPE;
    errors[92] = error.ENOPROTOOPT;
    errors[93] = error.EPROTONOSUPPORT;
    errors[94] = error.ESOCKTNOSUPPORT;
    errors[95] = error.ENOTSUP;
    errors[96] = error.EPFNOSUPPORT;
    errors[97] = error.EAFNOSUPPORT;
    errors[98] = error.EADDRINUSE;
    errors[99] = error.EADDRNOTAVAIL;
    errors[100] = error.ENETDOWN;
    errors[101] = error.ENETUNREACH;
    errors[102] = error.ENETRESET;
    errors[103] = error.ECONNABORTED;
    errors[104] = error.ECONNRESET;
    errors[105] = error.ENOBUFS;
    errors[106] = error.EISCONN;
    errors[107] = error.ENOTCONN;
    errors[108] = error.ESHUTDOWN;
    errors[109] = error.ETOOMANYREFS;
    errors[110] = error.ETIMEDOUT;
    errors[111] = error.ECONNREFUSED;
    errors[112] = error.EHOSTDOWN;
    errors[113] = error.EHOSTUNREACH;
    errors[114] = error.EALREADY;
    errors[115] = error.EINPROGRESS;
    errors[116] = error.ESTALE;
    errors[117] = error.EUCLEAN;
    errors[118] = error.ENOTNAM;
    errors[119] = error.ENAVAIL;
    errors[120] = error.EISNAM;
    errors[121] = error.EREMOTEIO;
    errors[122] = error.EDQUOT;
    errors[123] = error.ENOMEDIUM;
    errors[124] = error.EMEDIUMTYPE;
    errors[125] = error.ECANCELED;
    errors[126] = error.ENOKEY;
    errors[127] = error.EKEYEXPIRED;
    errors[128] = error.EKEYREVOKED;
    errors[129] = error.EKEYREJECTED;
    errors[130] = error.EOWNERDEAD;
    errors[131] = error.ENOTRECOVERABLE;
    errors[132] = error.ERFKILL;
    errors[133] = error.EHWPOISON;
    errors[134] = error.Unexpected;
    break :brk errors;
};
pub fn asError(err: anytype) Errno {
    const errnum = if (@typeInfo(@TypeOf(err)) == .Enum)
        @intFromEnum(err)
    else
        err;
    return switch (errnum) {
        1...errno_map.len => errno_map[@as(u8, @intCast(errnum))],
        else => error.Unexpected,
    };
}
