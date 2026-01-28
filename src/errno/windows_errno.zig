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
    FTYPE = 137,

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
    UV_ENOEXEC = -uv.UV_ENOEXEC,
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

pub fn getErrno(rc: anytype) E {
    if (comptime @TypeOf(rc) == bun.windows.NTSTATUS) {
        return bun.windows.translateNTStatusToErrno(rc);
    }

    if (Win32Error.get().toSystemErrno()) |sys| {
        return sys.toE();
    }

    if (bun.windows.WSAGetLastError()) |wsa| {
        return wsa.toE();
    }

    return .SUCCESS;
}

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
    EFTYPE = 137,

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
    UV_ENOEXEC = -uv.UV_ENOEXEC,

    pub const max = 138;

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
        EFTYPE,
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
        errors[@intFromEnum(SystemErrno.EFTYPE)] = error.EFTYPE;
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
            error.EFTYPE => SystemErrno.EFTYPE,
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
                // uv error codes
                inline for (@typeInfo(SystemErrno).@"enum".fields) |field| {
                    if (comptime std.mem.startsWith(u8, field.name, "UV_")) {
                        if (comptime @hasField(SystemErrno, field.name["UV_".len..])) {
                            if (code == field.value) {
                                return @field(SystemErrno, field.name["UV_".len..]);
                            }
                        }
                    }
                }
                if (comptime bun.Environment.allow_assert)
                    bun.Output.debugWarn("Unknown error code: {d}\n", .{code});

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

        return @as(SystemErrno, @enumFromInt(code));
    }
};

pub const UV_E = struct {
    pub const @"2BIG" = -uv.UV_E2BIG;
    pub const ACCES = -uv.UV_EACCES;
    pub const ADDRINUSE = -uv.UV_EADDRINUSE;
    pub const ADDRNOTAVAIL = -uv.UV_EADDRNOTAVAIL;
    pub const AFNOSUPPORT = -uv.UV_EAFNOSUPPORT;
    pub const AGAIN = -uv.UV_EAGAIN;
    pub const ALREADY = -uv.UV_EALREADY;
    pub const BADF = -uv.UV_EBADF;
    pub const BUSY = -uv.UV_EBUSY;
    pub const CANCELED = -uv.UV_ECANCELED;
    pub const CHARSET = -uv.UV_ECHARSET;
    pub const CONNABORTED = -uv.UV_ECONNABORTED;
    pub const CONNREFUSED = -uv.UV_ECONNREFUSED;
    pub const CONNRESET = -uv.UV_ECONNRESET;
    pub const DESTADDRREQ = -uv.UV_EDESTADDRREQ;
    pub const EXIST = -uv.UV_EEXIST;
    pub const FAULT = -uv.UV_EFAULT;
    pub const HOSTUNREACH = -uv.UV_EHOSTUNREACH;
    pub const INTR = -uv.UV_EINTR;
    pub const INVAL = -uv.UV_EINVAL;
    pub const IO = -uv.UV_EIO;
    pub const ISCONN = -uv.UV_EISCONN;
    pub const ISDIR = -uv.UV_EISDIR;
    pub const LOOP = -uv.UV_ELOOP;
    pub const MFILE = -uv.UV_EMFILE;
    pub const MSGSIZE = -uv.UV_EMSGSIZE;
    pub const NAMETOOLONG = -uv.UV_ENAMETOOLONG;
    pub const NETDOWN = -uv.UV_ENETDOWN;
    pub const NETUNREACH = -uv.UV_ENETUNREACH;
    pub const NFILE = -uv.UV_ENFILE;
    pub const NOBUFS = -uv.UV_ENOBUFS;
    pub const NODEV = -uv.UV_ENODEV;
    pub const NOENT = -uv.UV_ENOENT;
    pub const NOMEM = -uv.UV_ENOMEM;
    pub const NONET = -uv.UV_ENONET;
    pub const NOSPC = -uv.UV_ENOSPC;
    pub const NOSYS = -uv.UV_ENOSYS;
    pub const NOTCONN = -uv.UV_ENOTCONN;
    pub const NOTDIR = -uv.UV_ENOTDIR;
    pub const NOTEMPTY = -uv.UV_ENOTEMPTY;
    pub const NOTSOCK = -uv.UV_ENOTSOCK;
    pub const NOTSUP = -uv.UV_ENOTSUP;
    pub const PERM = -uv.UV_EPERM;
    pub const PIPE = -uv.UV_EPIPE;
    pub const PROTO = -uv.UV_EPROTO;
    pub const PROTONOSUPPORT = -uv.UV_EPROTONOSUPPORT;
    pub const PROTOTYPE = -uv.UV_EPROTOTYPE;
    pub const ROFS = -uv.UV_EROFS;
    pub const SHUTDOWN = -uv.UV_ESHUTDOWN;
    pub const SPIPE = -uv.UV_ESPIPE;
    pub const SRCH = -uv.UV_ESRCH;
    pub const TIMEDOUT = -uv.UV_ETIMEDOUT;
    pub const TXTBSY = -uv.UV_ETXTBSY;
    pub const XDEV = -uv.UV_EXDEV;
    pub const FBIG = -uv.UV_EFBIG;
    pub const NOPROTOOPT = -uv.UV_ENOPROTOOPT;
    pub const RANGE = -uv.UV_ERANGE;
    pub const NXIO = -uv.UV_ENXIO;
    pub const MLINK = -uv.UV_EMLINK;
    pub const HOSTDOWN = -uv.UV_EHOSTDOWN;
    pub const REMOTEIO = -uv.UV_EREMOTEIO;
    pub const NOTTY = -uv.UV_ENOTTY;
    pub const FTYPE = -uv.UV_EFTYPE;
    pub const ILSEQ = -uv.UV_EILSEQ;
    pub const OVERFLOW = -uv.UV_EOVERFLOW;
    pub const SOCKTNOSUPPORT = -uv.UV_ESOCKTNOSUPPORT;
    pub const NODATA = -uv.UV_ENODATA;
    pub const UNATCH = -uv.UV_EUNATCH;
    pub const NOEXEC = -uv.UV_ENOEXEC;
};

const bun = @import("bun");
const std = @import("std");

const Win32Error = bun.windows.Win32Error;
const uv = bun.windows.libuv;
