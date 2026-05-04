#![allow(non_camel_case_types, non_upper_case_globals, clippy::upper_case_acronyms)]

use core::ffi::c_int;

use bun_sys::windows::libuv as uv;
use bun_sys::windows::{self, Win32Error, NTSTATUS};

// ──────────────────────────────────────────────────────────────────────────
// E
// ──────────────────────────────────────────────────────────────────────────

#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug, strum::IntoStaticStr)]
pub enum E {
    SUCCESS = 0,
    PERM = 1,
    NOENT = 2,
    SRCH = 3,
    INTR = 4,
    IO = 5,
    NXIO = 6,
    // Zig: @"2BIG" — Rust identifiers cannot start with a digit.
    #[strum(serialize = "2BIG")]
    _2BIG = 7,
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

    UV_E2BIG = (-uv::UV_E2BIG) as u16,
    UV_EACCES = (-uv::UV_EACCES) as u16,
    UV_EADDRINUSE = (-uv::UV_EADDRINUSE) as u16,
    UV_EADDRNOTAVAIL = (-uv::UV_EADDRNOTAVAIL) as u16,
    UV_EAFNOSUPPORT = (-uv::UV_EAFNOSUPPORT) as u16,
    UV_EAGAIN = (-uv::UV_EAGAIN) as u16,
    UV_EAI_ADDRFAMILY = (-uv::UV_EAI_ADDRFAMILY) as u16,
    UV_EAI_AGAIN = (-uv::UV_EAI_AGAIN) as u16,
    UV_EAI_BADFLAGS = (-uv::UV_EAI_BADFLAGS) as u16,
    UV_EAI_BADHINTS = (-uv::UV_EAI_BADHINTS) as u16,
    UV_EAI_CANCELED = (-uv::UV_EAI_CANCELED) as u16,
    UV_EAI_FAIL = (-uv::UV_EAI_FAIL) as u16,
    UV_EAI_FAMILY = (-uv::UV_EAI_FAMILY) as u16,
    UV_EAI_MEMORY = (-uv::UV_EAI_MEMORY) as u16,
    UV_EAI_NODATA = (-uv::UV_EAI_NODATA) as u16,
    UV_EAI_NONAME = (-uv::UV_EAI_NONAME) as u16,
    UV_EAI_OVERFLOW = (-uv::UV_EAI_OVERFLOW) as u16,
    UV_EAI_PROTOCOL = (-uv::UV_EAI_PROTOCOL) as u16,
    UV_EAI_SERVICE = (-uv::UV_EAI_SERVICE) as u16,
    UV_EAI_SOCKTYPE = (-uv::UV_EAI_SOCKTYPE) as u16,
    UV_EALREADY = (-uv::UV_EALREADY) as u16,
    UV_EBADF = (-uv::UV_EBADF) as u16,
    UV_EBUSY = (-uv::UV_EBUSY) as u16,
    UV_ECANCELED = (-uv::UV_ECANCELED) as u16,
    UV_ECHARSET = (-uv::UV_ECHARSET) as u16,
    UV_ECONNABORTED = (-uv::UV_ECONNABORTED) as u16,
    UV_ECONNREFUSED = (-uv::UV_ECONNREFUSED) as u16,
    UV_ECONNRESET = (-uv::UV_ECONNRESET) as u16,
    UV_EDESTADDRREQ = (-uv::UV_EDESTADDRREQ) as u16,
    UV_EEXIST = (-uv::UV_EEXIST) as u16,
    UV_EFAULT = (-uv::UV_EFAULT) as u16,
    UV_EFBIG = (-uv::UV_EFBIG) as u16,
    UV_EHOSTUNREACH = (-uv::UV_EHOSTUNREACH) as u16,
    UV_EINVAL = (-uv::UV_EINVAL) as u16,
    UV_EINTR = (-uv::UV_EINTR) as u16,
    UV_EISCONN = (-uv::UV_EISCONN) as u16,
    UV_EIO = (-uv::UV_EIO) as u16,
    UV_ELOOP = (-uv::UV_ELOOP) as u16,
    UV_EISDIR = (-uv::UV_EISDIR) as u16,
    UV_EMSGSIZE = (-uv::UV_EMSGSIZE) as u16,
    UV_EMFILE = (-uv::UV_EMFILE) as u16,
    UV_ENETDOWN = (-uv::UV_ENETDOWN) as u16,
    UV_ENAMETOOLONG = (-uv::UV_ENAMETOOLONG) as u16,
    UV_ENFILE = (-uv::UV_ENFILE) as u16,
    UV_ENETUNREACH = (-uv::UV_ENETUNREACH) as u16,
    UV_ENODEV = (-uv::UV_ENODEV) as u16,
    UV_ENOBUFS = (-uv::UV_ENOBUFS) as u16,
    UV_ENOMEM = (-uv::UV_ENOMEM) as u16,
    UV_ENOENT = (-uv::UV_ENOENT) as u16,
    UV_ENOPROTOOPT = (-uv::UV_ENOPROTOOPT) as u16,
    UV_ENONET = (-uv::UV_ENONET) as u16,
    UV_ENOSYS = (-uv::UV_ENOSYS) as u16,
    UV_ENOSPC = (-uv::UV_ENOSPC) as u16,
    UV_ENOTDIR = (-uv::UV_ENOTDIR) as u16,
    UV_ENOTCONN = (-uv::UV_ENOTCONN) as u16,
    UV_ENOTSOCK = (-uv::UV_ENOTSOCK) as u16,
    UV_ENOTEMPTY = (-uv::UV_ENOTEMPTY) as u16,
    UV_EOVERFLOW = (-uv::UV_EOVERFLOW) as u16,
    UV_ENOTSUP = (-uv::UV_ENOTSUP) as u16,
    UV_EPIPE = (-uv::UV_EPIPE) as u16,
    UV_EPERM = (-uv::UV_EPERM) as u16,
    UV_EPROTONOSUPPORT = (-uv::UV_EPROTONOSUPPORT) as u16,
    UV_EPROTO = (-uv::UV_EPROTO) as u16,
    UV_ERANGE = (-uv::UV_ERANGE) as u16,
    UV_EPROTOTYPE = (-uv::UV_EPROTOTYPE) as u16,
    UV_ESHUTDOWN = (-uv::UV_ESHUTDOWN) as u16,
    UV_EROFS = (-uv::UV_EROFS) as u16,
    UV_ESRCH = (-uv::UV_ESRCH) as u16,
    UV_ESPIPE = (-uv::UV_ESPIPE) as u16,
    UV_ETXTBSY = (-uv::UV_ETXTBSY) as u16,
    UV_ETIMEDOUT = (-uv::UV_ETIMEDOUT) as u16,
    UV_UNKNOWN = (-uv::UV_UNKNOWN) as u16,
    UV_EXDEV = (-uv::UV_EXDEV) as u16,
    UV_ENXIO = (-uv::UV_ENXIO) as u16,
    UV_EOF = (-uv::UV_EOF) as u16,
    UV_EHOSTDOWN = (-uv::UV_EHOSTDOWN) as u16,
    UV_EMLINK = (-uv::UV_EMLINK) as u16,
    UV_ENOTTY = (-uv::UV_ENOTTY) as u16,
    UV_EREMOTEIO = (-uv::UV_EREMOTEIO) as u16,
    UV_EILSEQ = (-uv::UV_EILSEQ) as u16,
    UV_EFTYPE = (-uv::UV_EFTYPE) as u16,
    UV_ENODATA = (-uv::UV_ENODATA) as u16,
    UV_ESOCKTNOSUPPORT = (-uv::UV_ESOCKTNOSUPPORT) as u16,
    UV_ERRNO_MAX = (-uv::UV_ERRNO_MAX) as u16,
    UV_EUNATCH = (-uv::UV_EUNATCH) as u16,
    UV_ENOEXEC = (-uv::UV_ENOEXEC) as u16,
}

impl E {
    #[inline]
    pub const fn from_raw(n: u16) -> Self {
        // SAFETY: caller-guaranteed valid discriminant (matches Zig @enumFromInt UB semantics).
        unsafe { core::mem::transmute::<u16, E>(n) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// S — file mode bits (Zig namespace struct → Rust module)
// ──────────────────────────────────────────────────────────────────────────

pub mod s {
    pub const IFMT: i32 = 0o170000;

    pub const IFDIR: i32 = 0o040000;
    pub const IFCHR: i32 = 0o020000;
    pub const IFBLK: i32 = 0o060000;
    pub const IFREG: i32 = 0o100000;
    pub const IFIFO: i32 = 0o010000;
    pub const IFLNK: i32 = 0o120000;
    pub const IFSOCK: i32 = 0o140000;

    pub const ISUID: i32 = 0o4000;
    pub const ISGID: i32 = 0o2000;
    pub const ISVTX: i32 = 0o1000;
    pub const IRUSR: i32 = 0o400;
    pub const IWUSR: i32 = 0o200;
    pub const IXUSR: i32 = 0o100;
    pub const IRWXU: i32 = 0o700;
    pub const IRGRP: i32 = 0o040;
    pub const IWGRP: i32 = 0o020;
    pub const IXGRP: i32 = 0o010;
    pub const IRWXG: i32 = 0o070;
    pub const IROTH: i32 = 0o004;
    pub const IWOTH: i32 = 0o002;
    pub const IXOTH: i32 = 0o001;
    pub const IRWXO: i32 = 0o007;

    #[inline]
    pub const fn is_reg(m: i32) -> bool {
        m & IFMT == IFREG
    }

    #[inline]
    pub const fn is_dir(m: i32) -> bool {
        m & IFMT == IFDIR
    }

    #[inline]
    pub const fn is_chr(m: i32) -> bool {
        m & IFMT == IFCHR
    }

    #[inline]
    pub const fn is_blk(m: i32) -> bool {
        m & IFMT == IFBLK
    }

    #[inline]
    pub const fn is_fifo(m: i32) -> bool {
        m & IFMT == IFIFO
    }

    #[inline]
    pub const fn is_lnk(m: i32) -> bool {
        m & IFMT == IFLNK
    }

    #[inline]
    pub const fn is_sock(m: i32) -> bool {
        m & IFMT == IFSOCK
    }
}

// ──────────────────────────────────────────────────────────────────────────
// getErrno
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): Zig `getErrno(rc: anytype)` dispatches on `@TypeOf(rc)` at comptime:
//   - if NTSTATUS → translateNTStatusToErrno(rc)
//   - otherwise   → ignore rc, read Win32 GetLastError() then WSAGetLastError()
// Rust has no specialization on stable; callers must pick the right overload.

/// `getErrno(rc)` for the NTSTATUS case.
pub fn get_errno_ntstatus(rc: NTSTATUS) -> E {
    windows::translate_ntstatus_to_errno(rc)
}

/// `getErrno(rc)` for every non-NTSTATUS case (rc is ignored, mirrors Zig).
pub fn get_errno<T>(_rc: T) -> E {
    if let Some(sys) = Win32Error::get().to_system_errno() {
        return sys.to_e();
    }

    if let Some(wsa) = windows::wsa_get_last_error() {
        return wsa.to_e();
    }

    E::SUCCESS
}

// ──────────────────────────────────────────────────────────────────────────
// SystemErrno
// ──────────────────────────────────────────────────────────────────────────

#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug, strum::IntoStaticStr)]
pub enum SystemErrno {
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

    UV_E2BIG = (-uv::UV_E2BIG) as u16,
    UV_EACCES = (-uv::UV_EACCES) as u16,
    UV_EADDRINUSE = (-uv::UV_EADDRINUSE) as u16,
    UV_EADDRNOTAVAIL = (-uv::UV_EADDRNOTAVAIL) as u16,
    UV_EAFNOSUPPORT = (-uv::UV_EAFNOSUPPORT) as u16,
    UV_EAGAIN = (-uv::UV_EAGAIN) as u16,
    UV_EAI_ADDRFAMILY = (-uv::UV_EAI_ADDRFAMILY) as u16,
    UV_EAI_AGAIN = (-uv::UV_EAI_AGAIN) as u16,
    UV_EAI_BADFLAGS = (-uv::UV_EAI_BADFLAGS) as u16,
    UV_EAI_BADHINTS = (-uv::UV_EAI_BADHINTS) as u16,
    UV_EAI_CANCELED = (-uv::UV_EAI_CANCELED) as u16,
    UV_EAI_FAIL = (-uv::UV_EAI_FAIL) as u16,
    UV_EAI_FAMILY = (-uv::UV_EAI_FAMILY) as u16,
    UV_EAI_MEMORY = (-uv::UV_EAI_MEMORY) as u16,
    UV_EAI_NODATA = (-uv::UV_EAI_NODATA) as u16,
    UV_EAI_NONAME = (-uv::UV_EAI_NONAME) as u16,
    UV_EAI_OVERFLOW = (-uv::UV_EAI_OVERFLOW) as u16,
    UV_EAI_PROTOCOL = (-uv::UV_EAI_PROTOCOL) as u16,
    UV_EAI_SERVICE = (-uv::UV_EAI_SERVICE) as u16,
    UV_EAI_SOCKTYPE = (-uv::UV_EAI_SOCKTYPE) as u16,
    UV_EALREADY = (-uv::UV_EALREADY) as u16,
    UV_EBADF = (-uv::UV_EBADF) as u16,
    UV_EBUSY = (-uv::UV_EBUSY) as u16,
    UV_ECANCELED = (-uv::UV_ECANCELED) as u16,
    UV_ECHARSET = (-uv::UV_ECHARSET) as u16,
    UV_ECONNABORTED = (-uv::UV_ECONNABORTED) as u16,
    UV_ECONNREFUSED = (-uv::UV_ECONNREFUSED) as u16,
    UV_ECONNRESET = (-uv::UV_ECONNRESET) as u16,
    UV_EDESTADDRREQ = (-uv::UV_EDESTADDRREQ) as u16,
    UV_EEXIST = (-uv::UV_EEXIST) as u16,
    UV_EFAULT = (-uv::UV_EFAULT) as u16,
    UV_EFBIG = (-uv::UV_EFBIG) as u16,
    UV_EHOSTUNREACH = (-uv::UV_EHOSTUNREACH) as u16,
    UV_EINVAL = (-uv::UV_EINVAL) as u16,
    UV_EINTR = (-uv::UV_EINTR) as u16,
    UV_EISCONN = (-uv::UV_EISCONN) as u16,
    UV_EIO = (-uv::UV_EIO) as u16,
    UV_ELOOP = (-uv::UV_ELOOP) as u16,
    UV_EISDIR = (-uv::UV_EISDIR) as u16,
    UV_EMSGSIZE = (-uv::UV_EMSGSIZE) as u16,
    UV_EMFILE = (-uv::UV_EMFILE) as u16,
    UV_ENETDOWN = (-uv::UV_ENETDOWN) as u16,
    UV_ENAMETOOLONG = (-uv::UV_ENAMETOOLONG) as u16,
    UV_ENFILE = (-uv::UV_ENFILE) as u16,
    UV_ENETUNREACH = (-uv::UV_ENETUNREACH) as u16,
    UV_ENODEV = (-uv::UV_ENODEV) as u16,
    UV_ENOBUFS = (-uv::UV_ENOBUFS) as u16,
    UV_ENOMEM = (-uv::UV_ENOMEM) as u16,
    UV_ENOENT = (-uv::UV_ENOENT) as u16,
    UV_ENOPROTOOPT = (-uv::UV_ENOPROTOOPT) as u16,
    UV_ENONET = (-uv::UV_ENONET) as u16,
    UV_ENOSYS = (-uv::UV_ENOSYS) as u16,
    UV_ENOSPC = (-uv::UV_ENOSPC) as u16,
    UV_ENOTDIR = (-uv::UV_ENOTDIR) as u16,
    UV_ENOTCONN = (-uv::UV_ENOTCONN) as u16,
    UV_ENOTSOCK = (-uv::UV_ENOTSOCK) as u16,
    UV_ENOTEMPTY = (-uv::UV_ENOTEMPTY) as u16,
    UV_EOVERFLOW = (-uv::UV_EOVERFLOW) as u16,
    UV_ENOTSUP = (-uv::UV_ENOTSUP) as u16,
    UV_EPIPE = (-uv::UV_EPIPE) as u16,
    UV_EPERM = (-uv::UV_EPERM) as u16,
    UV_EPROTONOSUPPORT = (-uv::UV_EPROTONOSUPPORT) as u16,
    UV_EPROTO = (-uv::UV_EPROTO) as u16,
    UV_ERANGE = (-uv::UV_ERANGE) as u16,
    UV_EPROTOTYPE = (-uv::UV_EPROTOTYPE) as u16,
    UV_ESHUTDOWN = (-uv::UV_ESHUTDOWN) as u16,
    UV_EROFS = (-uv::UV_EROFS) as u16,
    UV_ESRCH = (-uv::UV_ESRCH) as u16,
    UV_ESPIPE = (-uv::UV_ESPIPE) as u16,
    UV_ETXTBSY = (-uv::UV_ETXTBSY) as u16,
    UV_ETIMEDOUT = (-uv::UV_ETIMEDOUT) as u16,
    UV_UNKNOWN = (-uv::UV_UNKNOWN) as u16,
    UV_EXDEV = (-uv::UV_EXDEV) as u16,
    UV_ENXIO = (-uv::UV_ENXIO) as u16,
    UV_EOF = (-uv::UV_EOF) as u16,
    UV_EHOSTDOWN = (-uv::UV_EHOSTDOWN) as u16,
    UV_EMLINK = (-uv::UV_EMLINK) as u16,
    UV_ENOTTY = (-uv::UV_ENOTTY) as u16,
    UV_EREMOTEIO = (-uv::UV_EREMOTEIO) as u16,
    UV_EILSEQ = (-uv::UV_EILSEQ) as u16,
    UV_EFTYPE = (-uv::UV_EFTYPE) as u16,
    UV_ENODATA = (-uv::UV_ENODATA) as u16,
    UV_ESOCKTNOSUPPORT = (-uv::UV_ESOCKTNOSUPPORT) as u16,
    UV_ERRNO_MAX = (-uv::UV_ERRNO_MAX) as u16,
    UV_EUNATCH = (-uv::UV_EUNATCH) as u16,
    UV_ENOEXEC = (-uv::UV_ENOEXEC) as u16,
}

/// Zig: `pub const Error = error{ ... };`
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug, thiserror::Error, strum::IntoStaticStr)]
#[error("{}", <&'static str>::from(*self))]
pub enum Error {
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
}

impl From<Error> for bun_core::Error {
    fn from(e: Error) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

impl SystemErrno {
    pub const MAX: usize = 138;

    #[inline]
    pub const fn to_e(self) -> E {
        // SAFETY: SystemErrno and E share identical #[repr(u16)] discriminant sets.
        unsafe { core::mem::transmute::<u16, E>(self as u16) }
    }

    #[inline]
    const fn from_raw(n: u16) -> Self {
        // SAFETY: caller-guaranteed valid discriminant (matches Zig @enumFromInt).
        unsafe { core::mem::transmute::<u16, SystemErrno>(n) }
    }

    pub fn from_error(err: bun_core::Error) -> Option<SystemErrno> {
        use bun_core::err;
        // PORT NOTE: Zig matches against `error.X` tags; bun_core::Error is an interned tag id.
        Some(match err {
            e if e == err!("EPERM") => SystemErrno::EPERM,
            e if e == err!("ENOENT") => SystemErrno::ENOENT,
            e if e == err!("ESRCH") => SystemErrno::ESRCH,
            e if e == err!("EINTR") => SystemErrno::EINTR,
            e if e == err!("EIO") => SystemErrno::EIO,
            e if e == err!("ENXIO") => SystemErrno::ENXIO,
            e if e == err!("E2BIG") => SystemErrno::E2BIG,
            e if e == err!("ENOEXEC") => SystemErrno::ENOEXEC,
            e if e == err!("EBADF") => SystemErrno::EBADF,
            e if e == err!("ECHILD") => SystemErrno::ECHILD,
            e if e == err!("EAGAIN") => SystemErrno::EAGAIN,
            e if e == err!("ENOMEM") => SystemErrno::ENOMEM,
            e if e == err!("EACCES") => SystemErrno::EACCES,
            e if e == err!("EFAULT") => SystemErrno::EFAULT,
            e if e == err!("ENOTBLK") => SystemErrno::ENOTBLK,
            e if e == err!("EBUSY") => SystemErrno::EBUSY,
            e if e == err!("EEXIST") => SystemErrno::EEXIST,
            e if e == err!("EXDEV") => SystemErrno::EXDEV,
            e if e == err!("ENODEV") => SystemErrno::ENODEV,
            e if e == err!("ENOTDIR") => SystemErrno::ENOTDIR,
            e if e == err!("EISDIR") => SystemErrno::EISDIR,
            e if e == err!("EINVAL") => SystemErrno::EINVAL,
            e if e == err!("ENFILE") => SystemErrno::ENFILE,
            e if e == err!("EMFILE") => SystemErrno::EMFILE,
            e if e == err!("ENOTTY") => SystemErrno::ENOTTY,
            e if e == err!("ETXTBSY") => SystemErrno::ETXTBSY,
            e if e == err!("EFBIG") => SystemErrno::EFBIG,
            e if e == err!("ENOSPC") => SystemErrno::ENOSPC,
            e if e == err!("ESPIPE") => SystemErrno::ESPIPE,
            e if e == err!("EROFS") => SystemErrno::EROFS,
            e if e == err!("EMLINK") => SystemErrno::EMLINK,
            e if e == err!("EPIPE") => SystemErrno::EPIPE,
            e if e == err!("EDOM") => SystemErrno::EDOM,
            e if e == err!("ERANGE") => SystemErrno::ERANGE,
            e if e == err!("EDEADLK") => SystemErrno::EDEADLK,
            e if e == err!("ENAMETOOLONG") => SystemErrno::ENAMETOOLONG,
            e if e == err!("ENOLCK") => SystemErrno::ENOLCK,
            e if e == err!("ENOSYS") => SystemErrno::ENOSYS,
            e if e == err!("ENOTEMPTY") => SystemErrno::ENOTEMPTY,
            e if e == err!("ELOOP") => SystemErrno::ELOOP,
            e if e == err!("EWOULDBLOCK") => SystemErrno::EWOULDBLOCK,
            e if e == err!("ENOMSG") => SystemErrno::ENOMSG,
            e if e == err!("EIDRM") => SystemErrno::EIDRM,
            e if e == err!("ECHRNG") => SystemErrno::ECHRNG,
            e if e == err!("EL2NSYNC") => SystemErrno::EL2NSYNC,
            e if e == err!("EL3HLT") => SystemErrno::EL3HLT,
            e if e == err!("EL3RST") => SystemErrno::EL3RST,
            e if e == err!("ELNRNG") => SystemErrno::ELNRNG,
            e if e == err!("EUNATCH") => SystemErrno::EUNATCH,
            e if e == err!("ENOCSI") => SystemErrno::ENOCSI,
            e if e == err!("EL2HLT") => SystemErrno::EL2HLT,
            e if e == err!("EBADE") => SystemErrno::EBADE,
            e if e == err!("EBADR") => SystemErrno::EBADR,
            e if e == err!("EXFULL") => SystemErrno::EXFULL,
            e if e == err!("ENOANO") => SystemErrno::ENOANO,
            e if e == err!("EBADRQC") => SystemErrno::EBADRQC,
            e if e == err!("EBADSLT") => SystemErrno::EBADSLT,
            e if e == err!("EDEADLOCK") => SystemErrno::EDEADLOCK,
            e if e == err!("EBFONT") => SystemErrno::EBFONT,
            e if e == err!("ENOSTR") => SystemErrno::ENOSTR,
            e if e == err!("ENODATA") => SystemErrno::ENODATA,
            e if e == err!("ETIME") => SystemErrno::ETIME,
            e if e == err!("ENOSR") => SystemErrno::ENOSR,
            e if e == err!("ENONET") => SystemErrno::ENONET,
            e if e == err!("ENOPKG") => SystemErrno::ENOPKG,
            e if e == err!("EREMOTE") => SystemErrno::EREMOTE,
            e if e == err!("ENOLINK") => SystemErrno::ENOLINK,
            e if e == err!("EADV") => SystemErrno::EADV,
            e if e == err!("ESRMNT") => SystemErrno::ESRMNT,
            e if e == err!("ECOMM") => SystemErrno::ECOMM,
            e if e == err!("EPROTO") => SystemErrno::EPROTO,
            e if e == err!("EMULTIHOP") => SystemErrno::EMULTIHOP,
            e if e == err!("EDOTDOT") => SystemErrno::EDOTDOT,
            e if e == err!("EBADMSG") => SystemErrno::EBADMSG,
            e if e == err!("EOVERFLOW") => SystemErrno::EOVERFLOW,
            e if e == err!("ENOTUNIQ") => SystemErrno::ENOTUNIQ,
            e if e == err!("EBADFD") => SystemErrno::EBADFD,
            e if e == err!("EREMCHG") => SystemErrno::EREMCHG,
            e if e == err!("ELIBACC") => SystemErrno::ELIBACC,
            e if e == err!("ELIBBAD") => SystemErrno::ELIBBAD,
            e if e == err!("ELIBSCN") => SystemErrno::ELIBSCN,
            e if e == err!("ELIBMAX") => SystemErrno::ELIBMAX,
            e if e == err!("ELIBEXEC") => SystemErrno::ELIBEXEC,
            e if e == err!("EILSEQ") => SystemErrno::EILSEQ,
            e if e == err!("ERESTART") => SystemErrno::ERESTART,
            e if e == err!("ESTRPIPE") => SystemErrno::ESTRPIPE,
            e if e == err!("EUSERS") => SystemErrno::EUSERS,
            e if e == err!("ENOTSOCK") => SystemErrno::ENOTSOCK,
            e if e == err!("EDESTADDRREQ") => SystemErrno::EDESTADDRREQ,
            e if e == err!("EMSGSIZE") => SystemErrno::EMSGSIZE,
            e if e == err!("EPROTOTYPE") => SystemErrno::EPROTOTYPE,
            e if e == err!("ENOPROTOOPT") => SystemErrno::ENOPROTOOPT,
            e if e == err!("EPROTONOSUPPORT") => SystemErrno::EPROTONOSUPPORT,
            e if e == err!("ESOCKTNOSUPPORT") => SystemErrno::ESOCKTNOSUPPORT,
            e if e == err!("ENOTSUP") => SystemErrno::ENOTSUP,
            e if e == err!("EPFNOSUPPORT") => SystemErrno::EPFNOSUPPORT,
            e if e == err!("EAFNOSUPPORT") => SystemErrno::EAFNOSUPPORT,
            e if e == err!("EADDRINUSE") => SystemErrno::EADDRINUSE,
            e if e == err!("EADDRNOTAVAIL") => SystemErrno::EADDRNOTAVAIL,
            e if e == err!("ENETDOWN") => SystemErrno::ENETDOWN,
            e if e == err!("ENETUNREACH") => SystemErrno::ENETUNREACH,
            e if e == err!("ENETRESET") => SystemErrno::ENETRESET,
            e if e == err!("ECONNABORTED") => SystemErrno::ECONNABORTED,
            e if e == err!("ECONNRESET") => SystemErrno::ECONNRESET,
            e if e == err!("ENOBUFS") => SystemErrno::ENOBUFS,
            e if e == err!("EISCONN") => SystemErrno::EISCONN,
            e if e == err!("ENOTCONN") => SystemErrno::ENOTCONN,
            e if e == err!("ESHUTDOWN") => SystemErrno::ESHUTDOWN,
            e if e == err!("ETOOMANYREFS") => SystemErrno::ETOOMANYREFS,
            e if e == err!("ETIMEDOUT") => SystemErrno::ETIMEDOUT,
            e if e == err!("ECONNREFUSED") => SystemErrno::ECONNREFUSED,
            e if e == err!("EHOSTDOWN") => SystemErrno::EHOSTDOWN,
            e if e == err!("EHOSTUNREACH") => SystemErrno::EHOSTUNREACH,
            e if e == err!("EALREADY") => SystemErrno::EALREADY,
            e if e == err!("EINPROGRESS") => SystemErrno::EINPROGRESS,
            e if e == err!("ESTALE") => SystemErrno::ESTALE,
            e if e == err!("EUCLEAN") => SystemErrno::EUCLEAN,
            e if e == err!("ENOTNAM") => SystemErrno::ENOTNAM,
            e if e == err!("ENAVAIL") => SystemErrno::ENAVAIL,
            e if e == err!("EISNAM") => SystemErrno::EISNAM,
            e if e == err!("EREMOTEIO") => SystemErrno::EREMOTEIO,
            e if e == err!("EDQUOT") => SystemErrno::EDQUOT,
            e if e == err!("ENOMEDIUM") => SystemErrno::ENOMEDIUM,
            e if e == err!("EMEDIUMTYPE") => SystemErrno::EMEDIUMTYPE,
            e if e == err!("ECANCELED") => SystemErrno::ECANCELED,
            e if e == err!("ENOKEY") => SystemErrno::ENOKEY,
            e if e == err!("EKEYEXPIRED") => SystemErrno::EKEYEXPIRED,
            e if e == err!("EKEYREVOKED") => SystemErrno::EKEYREVOKED,
            e if e == err!("EKEYREJECTED") => SystemErrno::EKEYREJECTED,
            e if e == err!("EOWNERDEAD") => SystemErrno::EOWNERDEAD,
            e if e == err!("ENOTRECOVERABLE") => SystemErrno::ENOTRECOVERABLE,
            e if e == err!("ERFKILL") => SystemErrno::ERFKILL,
            e if e == err!("EHWPOISON") => SystemErrno::EHWPOISON,
            e if e == err!("EUNKNOWN") => SystemErrno::EUNKNOWN,
            e if e == err!("ECHARSET") => SystemErrno::ECHARSET,
            e if e == err!("EOF") => SystemErrno::EOF,
            e if e == err!("EFTYPE") => SystemErrno::EFTYPE,
            _ => return None,
        })
    }

    pub fn to_error(self) -> Error {
        ERROR_MAP[self as u16 as usize]
    }

    // TODO(port): Zig `init(code: anytype)` is comptime type-dispatch over u16 / c_int /
    // Win32Error / std.os.windows.Win32Error / signed integers. Stable Rust has no
    // specialization, so this is split into typed entry points. Callers that passed
    // arbitrary integer types should pick `init_c_int`.

    /// `init(code: u16)` — Win32/WSA error codes and negated-uv codes encoded as u16.
    pub fn init_u16(code: u16) -> Option<SystemErrno> {
        Self::init_numeric(code)
    }

    /// `init(code: c_int)` — same as u16 path for positives; negatives are negated and retried.
    pub fn init_c_int(code: c_int) -> Option<SystemErrno> {
        if code > 0 {
            // Zig compared the c_int against u16 constants via peer-type widening, so any
            // code > u16::MAX would simply fail every range check and return null. Avoid a
            // truncating `as u16` (which could wrap into a valid Win32/uv code) by gating here.
            let Ok(code) = u16::try_from(code) else { return None };
            return Self::init_numeric(code);
        }
        if code < 0 {
            return Self::init_c_int(-code);
        }
        // code == 0
        Some(SystemErrno::from_raw(0))
    }

    fn init_numeric(code: u16) -> Option<SystemErrno> {
        // Win32Error and WSA Error codes
        if code <= Win32Error::IO_REISSUE_AS_CACHED as u16
            || (code >= Win32Error::WSAEINTR as u16
                && code <= Win32Error::WSA_QOS_RESERVED_PETYPE as u16)
        {
            return Self::init_win32_error(Win32Error::from_raw(code));
        }
        // uv error codes (negated to positive u16 in the SystemErrno discriminant space)
        if let Some(mapped) = uv_code_to_system_errno(code) {
            return Some(mapped);
        }
        if cfg!(debug_assertions) {
            bun_core::Output::debug_warn(format_args!("Unknown error code: {}\n", code));
        }
        None
    }

    /// `init(code: Win32Error)` (also covers `std.os.windows.Win32Error`).
    pub fn init_win32_error(code: Win32Error) -> Option<SystemErrno> {
        use Win32Error as W;
        Some(match code {
            W::NOACCESS => SystemErrno::EACCES,
            W::WSAEACCES => SystemErrno::EACCES,
            W::ELEVATION_REQUIRED => SystemErrno::EACCES,
            W::CANT_ACCESS_FILE => SystemErrno::EACCES,
            W::ADDRESS_ALREADY_ASSOCIATED => SystemErrno::EADDRINUSE,
            W::WSAEADDRINUSE => SystemErrno::EADDRINUSE,
            W::WSAEADDRNOTAVAIL => SystemErrno::EADDRNOTAVAIL,
            W::WSAEAFNOSUPPORT => SystemErrno::EAFNOSUPPORT,
            W::WSAEWOULDBLOCK => SystemErrno::EAGAIN,
            W::WSAEALREADY => SystemErrno::EALREADY,
            W::INVALID_FLAGS => SystemErrno::EBADF,
            W::INVALID_HANDLE => SystemErrno::EBADF,
            W::LOCK_VIOLATION => SystemErrno::EBUSY,
            W::PIPE_BUSY => SystemErrno::EBUSY,
            W::SHARING_VIOLATION => SystemErrno::EBUSY,
            W::OPERATION_ABORTED => SystemErrno::ECANCELED,
            W::WSAEINTR => SystemErrno::ECANCELED,
            W::NO_UNICODE_TRANSLATION => SystemErrno::ECHARSET,
            W::CONNECTION_ABORTED => SystemErrno::ECONNABORTED,
            W::WSAECONNABORTED => SystemErrno::ECONNABORTED,
            W::CONNECTION_REFUSED => SystemErrno::ECONNREFUSED,
            W::WSAECONNREFUSED => SystemErrno::ECONNREFUSED,
            W::NETNAME_DELETED => SystemErrno::ECONNRESET,
            W::WSAECONNRESET => SystemErrno::ECONNRESET,
            W::ALREADY_EXISTS => SystemErrno::EEXIST,
            W::FILE_EXISTS => SystemErrno::EEXIST,
            W::BUFFER_OVERFLOW => SystemErrno::EFAULT,
            W::WSAEFAULT => SystemErrno::EFAULT,
            W::HOST_UNREACHABLE => SystemErrno::EHOSTUNREACH,
            W::WSAEHOSTUNREACH => SystemErrno::EHOSTUNREACH,
            W::INSUFFICIENT_BUFFER => SystemErrno::EINVAL,
            W::INVALID_DATA => SystemErrno::EINVAL,
            W::INVALID_PARAMETER => SystemErrno::EINVAL,
            W::SYMLINK_NOT_SUPPORTED => SystemErrno::EINVAL,
            W::WSAEINVAL => SystemErrno::EINVAL,
            W::WSAEPFNOSUPPORT => SystemErrno::EINVAL,
            W::BEGINNING_OF_MEDIA => SystemErrno::EIO,
            W::BUS_RESET => SystemErrno::EIO,
            W::CRC => SystemErrno::EIO,
            W::DEVICE_DOOR_OPEN => SystemErrno::EIO,
            W::DEVICE_REQUIRES_CLEANING => SystemErrno::EIO,
            W::DISK_CORRUPT => SystemErrno::EIO,
            W::EOM_OVERFLOW => SystemErrno::EIO,
            W::FILEMARK_DETECTED => SystemErrno::EIO,
            W::GEN_FAILURE => SystemErrno::EIO,
            W::INVALID_BLOCK_LENGTH => SystemErrno::EIO,
            W::IO_DEVICE => SystemErrno::EIO,
            W::NO_DATA_DETECTED => SystemErrno::EIO,
            W::NO_SIGNAL_SENT => SystemErrno::EIO,
            W::OPEN_FAILED => SystemErrno::EIO,
            W::SETMARK_DETECTED => SystemErrno::EIO,
            W::SIGNAL_REFUSED => SystemErrno::EIO,
            W::WSAEISCONN => SystemErrno::EISCONN,
            W::CANT_RESOLVE_FILENAME => SystemErrno::ELOOP,
            W::TOO_MANY_OPEN_FILES => SystemErrno::EMFILE,
            W::WSAEMFILE => SystemErrno::EMFILE,
            W::WSAEMSGSIZE => SystemErrno::EMSGSIZE,
            W::FILENAME_EXCED_RANGE => SystemErrno::ENAMETOOLONG,
            W::NETWORK_UNREACHABLE => SystemErrno::ENETUNREACH,
            W::WSAENETUNREACH => SystemErrno::ENETUNREACH,
            W::WSAENOBUFS => SystemErrno::ENOBUFS,
            W::BAD_PATHNAME => SystemErrno::ENOENT,
            W::DIRECTORY => SystemErrno::ENOTDIR,
            W::ENVVAR_NOT_FOUND => SystemErrno::ENOENT,
            W::FILE_NOT_FOUND => SystemErrno::ENOENT,
            W::INVALID_NAME => SystemErrno::ENOENT,
            W::INVALID_DRIVE => SystemErrno::ENOENT,
            W::INVALID_REPARSE_DATA => SystemErrno::ENOENT,
            W::MOD_NOT_FOUND => SystemErrno::ENOENT,
            W::PATH_NOT_FOUND => SystemErrno::ENOENT,
            W::WSAHOST_NOT_FOUND => SystemErrno::ENOENT,
            W::WSANO_DATA => SystemErrno::ENOENT,
            W::NOT_ENOUGH_MEMORY => SystemErrno::ENOMEM,
            W::OUTOFMEMORY => SystemErrno::ENOMEM,
            W::CANNOT_MAKE => SystemErrno::ENOSPC,
            W::DISK_FULL => SystemErrno::ENOSPC,
            W::EA_TABLE_FULL => SystemErrno::ENOSPC,
            W::END_OF_MEDIA => SystemErrno::ENOSPC,
            W::HANDLE_DISK_FULL => SystemErrno::ENOSPC,
            W::NOT_CONNECTED => SystemErrno::ENOTCONN,
            W::WSAENOTCONN => SystemErrno::ENOTCONN,
            W::DIR_NOT_EMPTY => SystemErrno::ENOTEMPTY,
            W::WSAENOTSOCK => SystemErrno::ENOTSOCK,
            W::NOT_SUPPORTED => SystemErrno::ENOTSUP,
            W::WSAEOPNOTSUPP => SystemErrno::ENOTSUP,
            W::BROKEN_PIPE => SystemErrno::EPIPE,
            W::ACCESS_DENIED => SystemErrno::EPERM,
            W::PRIVILEGE_NOT_HELD => SystemErrno::EPERM,
            W::BAD_PIPE => SystemErrno::EPIPE,
            W::NO_DATA => SystemErrno::EPIPE,
            W::PIPE_NOT_CONNECTED => SystemErrno::EPIPE,
            W::WSAESHUTDOWN => SystemErrno::EPIPE,
            W::WSAEPROTONOSUPPORT => SystemErrno::EPROTONOSUPPORT,
            W::WRITE_PROTECT => SystemErrno::EROFS,
            W::SEM_TIMEOUT => SystemErrno::ETIMEDOUT,
            W::WSAETIMEDOUT => SystemErrno::ETIMEDOUT,
            W::NOT_SAME_DEVICE => SystemErrno::EXDEV,
            W::INVALID_FUNCTION => SystemErrno::EISDIR,
            W::META_EXPANSION_TOO_LONG => SystemErrno::E2BIG,
            W::WSAESOCKTNOSUPPORT => SystemErrno::ESOCKTNOSUPPORT,
            W::DELETE_PENDING => SystemErrno::EBUSY,
            _ => return None,
        })
    }
}

// Zig: `inline for (@typeInfo(SystemErrno).@"enum".fields) |field| { if startsWith "UV_" && @hasField(stripped) ... }`
// TODO(port): generated by hand from comptime reflection — keep in sync with the UV_* variant list above.
fn uv_code_to_system_errno(code: u16) -> Option<SystemErrno> {
    use SystemErrno as S;
    Some(match code {
        c if c == S::UV_E2BIG as u16 => S::E2BIG,
        c if c == S::UV_EACCES as u16 => S::EACCES,
        c if c == S::UV_EADDRINUSE as u16 => S::EADDRINUSE,
        c if c == S::UV_EADDRNOTAVAIL as u16 => S::EADDRNOTAVAIL,
        c if c == S::UV_EAFNOSUPPORT as u16 => S::EAFNOSUPPORT,
        c if c == S::UV_EAGAIN as u16 => S::EAGAIN,
        c if c == S::UV_EALREADY as u16 => S::EALREADY,
        c if c == S::UV_EBADF as u16 => S::EBADF,
        c if c == S::UV_EBUSY as u16 => S::EBUSY,
        c if c == S::UV_ECANCELED as u16 => S::ECANCELED,
        c if c == S::UV_ECHARSET as u16 => S::ECHARSET,
        c if c == S::UV_ECONNABORTED as u16 => S::ECONNABORTED,
        c if c == S::UV_ECONNREFUSED as u16 => S::ECONNREFUSED,
        c if c == S::UV_ECONNRESET as u16 => S::ECONNRESET,
        c if c == S::UV_EDESTADDRREQ as u16 => S::EDESTADDRREQ,
        c if c == S::UV_EEXIST as u16 => S::EEXIST,
        c if c == S::UV_EFAULT as u16 => S::EFAULT,
        c if c == S::UV_EFBIG as u16 => S::EFBIG,
        c if c == S::UV_EHOSTUNREACH as u16 => S::EHOSTUNREACH,
        c if c == S::UV_EINVAL as u16 => S::EINVAL,
        c if c == S::UV_EINTR as u16 => S::EINTR,
        c if c == S::UV_EISCONN as u16 => S::EISCONN,
        c if c == S::UV_EIO as u16 => S::EIO,
        c if c == S::UV_ELOOP as u16 => S::ELOOP,
        c if c == S::UV_EISDIR as u16 => S::EISDIR,
        c if c == S::UV_EMSGSIZE as u16 => S::EMSGSIZE,
        c if c == S::UV_EMFILE as u16 => S::EMFILE,
        c if c == S::UV_ENETDOWN as u16 => S::ENETDOWN,
        c if c == S::UV_ENAMETOOLONG as u16 => S::ENAMETOOLONG,
        c if c == S::UV_ENFILE as u16 => S::ENFILE,
        c if c == S::UV_ENETUNREACH as u16 => S::ENETUNREACH,
        c if c == S::UV_ENODEV as u16 => S::ENODEV,
        c if c == S::UV_ENOBUFS as u16 => S::ENOBUFS,
        c if c == S::UV_ENOMEM as u16 => S::ENOMEM,
        c if c == S::UV_ENOENT as u16 => S::ENOENT,
        c if c == S::UV_ENOPROTOOPT as u16 => S::ENOPROTOOPT,
        c if c == S::UV_ENONET as u16 => S::ENONET,
        c if c == S::UV_ENOSYS as u16 => S::ENOSYS,
        c if c == S::UV_ENOSPC as u16 => S::ENOSPC,
        c if c == S::UV_ENOTDIR as u16 => S::ENOTDIR,
        c if c == S::UV_ENOTCONN as u16 => S::ENOTCONN,
        c if c == S::UV_ENOTSOCK as u16 => S::ENOTSOCK,
        c if c == S::UV_ENOTEMPTY as u16 => S::ENOTEMPTY,
        c if c == S::UV_EOVERFLOW as u16 => S::EOVERFLOW,
        c if c == S::UV_ENOTSUP as u16 => S::ENOTSUP,
        c if c == S::UV_EPIPE as u16 => S::EPIPE,
        c if c == S::UV_EPERM as u16 => S::EPERM,
        c if c == S::UV_EPROTONOSUPPORT as u16 => S::EPROTONOSUPPORT,
        c if c == S::UV_EPROTO as u16 => S::EPROTO,
        c if c == S::UV_ERANGE as u16 => S::ERANGE,
        c if c == S::UV_EPROTOTYPE as u16 => S::EPROTOTYPE,
        c if c == S::UV_ESHUTDOWN as u16 => S::ESHUTDOWN,
        c if c == S::UV_EROFS as u16 => S::EROFS,
        c if c == S::UV_ESRCH as u16 => S::ESRCH,
        c if c == S::UV_ESPIPE as u16 => S::ESPIPE,
        c if c == S::UV_ETXTBSY as u16 => S::ETXTBSY,
        c if c == S::UV_ETIMEDOUT as u16 => S::ETIMEDOUT,
        c if c == S::UV_EXDEV as u16 => S::EXDEV,
        c if c == S::UV_ENXIO as u16 => S::ENXIO,
        c if c == S::UV_EOF as u16 => S::EOF,
        c if c == S::UV_EHOSTDOWN as u16 => S::EHOSTDOWN,
        c if c == S::UV_EMLINK as u16 => S::EMLINK,
        c if c == S::UV_ENOTTY as u16 => S::ENOTTY,
        c if c == S::UV_EREMOTEIO as u16 => S::EREMOTEIO,
        c if c == S::UV_EILSEQ as u16 => S::EILSEQ,
        c if c == S::UV_EFTYPE as u16 => S::EFTYPE,
        c if c == S::UV_ENODATA as u16 => S::ENODATA,
        c if c == S::UV_ESOCKTNOSUPPORT as u16 => S::ESOCKTNOSUPPORT,
        c if c == S::UV_EUNATCH as u16 => S::EUNATCH,
        c if c == S::UV_ENOEXEC as u16 => S::ENOEXEC,
        // UV_EAI_* / UV_UNKNOWN / UV_ERRNO_MAX have no non-UV_ counterpart (Zig @hasField was false).
        _ => return None,
    })
}

// Zig: `const error_map: [SystemErrno.max]Error = brk: { ... }`
// Index 0 (SUCCESS) is uninitialized in Zig; we fill it with `Unexpected` so the array is const.
static ERROR_MAP: [Error; SystemErrno::MAX] = {
    let mut errors = [Error::Unexpected; SystemErrno::MAX];
    errors[SystemErrno::EPERM as usize] = Error::EPERM;
    errors[SystemErrno::ENOENT as usize] = Error::ENOENT;
    errors[SystemErrno::ESRCH as usize] = Error::ESRCH;
    errors[SystemErrno::EINTR as usize] = Error::EINTR;
    errors[SystemErrno::EIO as usize] = Error::EIO;
    errors[SystemErrno::ENXIO as usize] = Error::ENXIO;
    errors[SystemErrno::E2BIG as usize] = Error::E2BIG;
    errors[SystemErrno::ENOEXEC as usize] = Error::ENOEXEC;
    errors[SystemErrno::EBADF as usize] = Error::EBADF;
    errors[SystemErrno::ECHILD as usize] = Error::ECHILD;
    errors[SystemErrno::EAGAIN as usize] = Error::EAGAIN;
    errors[SystemErrno::ENOMEM as usize] = Error::ENOMEM;
    errors[SystemErrno::EACCES as usize] = Error::EACCES;
    errors[SystemErrno::EFAULT as usize] = Error::EFAULT;
    errors[SystemErrno::ENOTBLK as usize] = Error::ENOTBLK;
    errors[SystemErrno::EBUSY as usize] = Error::EBUSY;
    errors[SystemErrno::EEXIST as usize] = Error::EEXIST;
    errors[SystemErrno::EXDEV as usize] = Error::EXDEV;
    errors[SystemErrno::ENODEV as usize] = Error::ENODEV;
    errors[SystemErrno::ENOTDIR as usize] = Error::ENOTDIR;
    errors[SystemErrno::EISDIR as usize] = Error::EISDIR;
    errors[SystemErrno::EINVAL as usize] = Error::EINVAL;
    errors[SystemErrno::ENFILE as usize] = Error::ENFILE;
    errors[SystemErrno::EMFILE as usize] = Error::EMFILE;
    errors[SystemErrno::ENOTTY as usize] = Error::ENOTTY;
    errors[SystemErrno::ETXTBSY as usize] = Error::ETXTBSY;
    errors[SystemErrno::EFBIG as usize] = Error::EFBIG;
    errors[SystemErrno::ENOSPC as usize] = Error::ENOSPC;
    errors[SystemErrno::ESPIPE as usize] = Error::ESPIPE;
    errors[SystemErrno::EROFS as usize] = Error::EROFS;
    errors[SystemErrno::EMLINK as usize] = Error::EMLINK;
    errors[SystemErrno::EPIPE as usize] = Error::EPIPE;
    errors[SystemErrno::EDOM as usize] = Error::EDOM;
    errors[SystemErrno::ERANGE as usize] = Error::ERANGE;
    errors[SystemErrno::EDEADLK as usize] = Error::EDEADLK;
    errors[SystemErrno::ENAMETOOLONG as usize] = Error::ENAMETOOLONG;
    errors[SystemErrno::ENOLCK as usize] = Error::ENOLCK;
    errors[SystemErrno::ENOSYS as usize] = Error::ENOSYS;
    errors[SystemErrno::ENOTEMPTY as usize] = Error::ENOTEMPTY;
    errors[SystemErrno::ELOOP as usize] = Error::ELOOP;
    errors[SystemErrno::EWOULDBLOCK as usize] = Error::EWOULDBLOCK;
    errors[SystemErrno::ENOMSG as usize] = Error::ENOMSG;
    errors[SystemErrno::EIDRM as usize] = Error::EIDRM;
    errors[SystemErrno::ECHRNG as usize] = Error::ECHRNG;
    errors[SystemErrno::EL2NSYNC as usize] = Error::EL2NSYNC;
    errors[SystemErrno::EL3HLT as usize] = Error::EL3HLT;
    errors[SystemErrno::EL3RST as usize] = Error::EL3RST;
    errors[SystemErrno::ELNRNG as usize] = Error::ELNRNG;
    errors[SystemErrno::EUNATCH as usize] = Error::EUNATCH;
    errors[SystemErrno::ENOCSI as usize] = Error::ENOCSI;
    errors[SystemErrno::EL2HLT as usize] = Error::EL2HLT;
    errors[SystemErrno::EBADE as usize] = Error::EBADE;
    errors[SystemErrno::EBADR as usize] = Error::EBADR;
    errors[SystemErrno::EXFULL as usize] = Error::EXFULL;
    errors[SystemErrno::ENOANO as usize] = Error::ENOANO;
    errors[SystemErrno::EBADRQC as usize] = Error::EBADRQC;
    errors[SystemErrno::EBADSLT as usize] = Error::EBADSLT;
    errors[SystemErrno::EDEADLOCK as usize] = Error::EDEADLOCK;
    errors[SystemErrno::EBFONT as usize] = Error::EBFONT;
    errors[SystemErrno::ENOSTR as usize] = Error::ENOSTR;
    errors[SystemErrno::ENODATA as usize] = Error::ENODATA;
    errors[SystemErrno::ETIME as usize] = Error::ETIME;
    errors[SystemErrno::ENOSR as usize] = Error::ENOSR;
    errors[SystemErrno::ENONET as usize] = Error::ENONET;
    errors[SystemErrno::ENOPKG as usize] = Error::ENOPKG;
    errors[SystemErrno::EREMOTE as usize] = Error::EREMOTE;
    errors[SystemErrno::ENOLINK as usize] = Error::ENOLINK;
    errors[SystemErrno::EADV as usize] = Error::EADV;
    errors[SystemErrno::ESRMNT as usize] = Error::ESRMNT;
    errors[SystemErrno::ECOMM as usize] = Error::ECOMM;
    errors[SystemErrno::EPROTO as usize] = Error::EPROTO;
    errors[SystemErrno::EMULTIHOP as usize] = Error::EMULTIHOP;
    errors[SystemErrno::EDOTDOT as usize] = Error::EDOTDOT;
    errors[SystemErrno::EBADMSG as usize] = Error::EBADMSG;
    errors[SystemErrno::EOVERFLOW as usize] = Error::EOVERFLOW;
    errors[SystemErrno::ENOTUNIQ as usize] = Error::ENOTUNIQ;
    errors[SystemErrno::EBADFD as usize] = Error::EBADFD;
    errors[SystemErrno::EREMCHG as usize] = Error::EREMCHG;
    errors[SystemErrno::ELIBACC as usize] = Error::ELIBACC;
    errors[SystemErrno::ELIBBAD as usize] = Error::ELIBBAD;
    errors[SystemErrno::ELIBSCN as usize] = Error::ELIBSCN;
    errors[SystemErrno::ELIBMAX as usize] = Error::ELIBMAX;
    errors[SystemErrno::ELIBEXEC as usize] = Error::ELIBEXEC;
    errors[SystemErrno::EILSEQ as usize] = Error::EILSEQ;
    errors[SystemErrno::ERESTART as usize] = Error::ERESTART;
    errors[SystemErrno::ESTRPIPE as usize] = Error::ESTRPIPE;
    errors[SystemErrno::EUSERS as usize] = Error::EUSERS;
    errors[SystemErrno::ENOTSOCK as usize] = Error::ENOTSOCK;
    errors[SystemErrno::EDESTADDRREQ as usize] = Error::EDESTADDRREQ;
    errors[SystemErrno::EMSGSIZE as usize] = Error::EMSGSIZE;
    errors[SystemErrno::EPROTOTYPE as usize] = Error::EPROTOTYPE;
    errors[SystemErrno::ENOPROTOOPT as usize] = Error::ENOPROTOOPT;
    errors[SystemErrno::EPROTONOSUPPORT as usize] = Error::EPROTONOSUPPORT;
    errors[SystemErrno::ESOCKTNOSUPPORT as usize] = Error::ESOCKTNOSUPPORT;
    errors[SystemErrno::ENOTSUP as usize] = Error::ENOTSUP;
    errors[SystemErrno::EPFNOSUPPORT as usize] = Error::EPFNOSUPPORT;
    errors[SystemErrno::EAFNOSUPPORT as usize] = Error::EAFNOSUPPORT;
    errors[SystemErrno::EADDRINUSE as usize] = Error::EADDRINUSE;
    errors[SystemErrno::EADDRNOTAVAIL as usize] = Error::EADDRNOTAVAIL;
    errors[SystemErrno::ENETDOWN as usize] = Error::ENETDOWN;
    errors[SystemErrno::ENETUNREACH as usize] = Error::ENETUNREACH;
    errors[SystemErrno::ENETRESET as usize] = Error::ENETRESET;
    errors[SystemErrno::ECONNABORTED as usize] = Error::ECONNABORTED;
    errors[SystemErrno::ECONNRESET as usize] = Error::ECONNRESET;
    errors[SystemErrno::ENOBUFS as usize] = Error::ENOBUFS;
    errors[SystemErrno::EISCONN as usize] = Error::EISCONN;
    errors[SystemErrno::ENOTCONN as usize] = Error::ENOTCONN;
    errors[SystemErrno::ESHUTDOWN as usize] = Error::ESHUTDOWN;
    errors[SystemErrno::ETOOMANYREFS as usize] = Error::ETOOMANYREFS;
    errors[SystemErrno::ETIMEDOUT as usize] = Error::ETIMEDOUT;
    errors[SystemErrno::ECONNREFUSED as usize] = Error::ECONNREFUSED;
    errors[SystemErrno::EHOSTDOWN as usize] = Error::EHOSTDOWN;
    errors[SystemErrno::EHOSTUNREACH as usize] = Error::EHOSTUNREACH;
    errors[SystemErrno::EALREADY as usize] = Error::EALREADY;
    errors[SystemErrno::EINPROGRESS as usize] = Error::EINPROGRESS;
    errors[SystemErrno::ESTALE as usize] = Error::ESTALE;
    errors[SystemErrno::EUCLEAN as usize] = Error::EUCLEAN;
    errors[SystemErrno::ENOTNAM as usize] = Error::ENOTNAM;
    errors[SystemErrno::ENAVAIL as usize] = Error::ENAVAIL;
    errors[SystemErrno::EISNAM as usize] = Error::EISNAM;
    errors[SystemErrno::EREMOTEIO as usize] = Error::EREMOTEIO;
    errors[SystemErrno::EDQUOT as usize] = Error::EDQUOT;
    errors[SystemErrno::ENOMEDIUM as usize] = Error::ENOMEDIUM;
    errors[SystemErrno::EMEDIUMTYPE as usize] = Error::EMEDIUMTYPE;
    errors[SystemErrno::ECANCELED as usize] = Error::ECANCELED;
    errors[SystemErrno::ENOKEY as usize] = Error::ENOKEY;
    errors[SystemErrno::EKEYEXPIRED as usize] = Error::EKEYEXPIRED;
    errors[SystemErrno::EKEYREVOKED as usize] = Error::EKEYREVOKED;
    errors[SystemErrno::EKEYREJECTED as usize] = Error::EKEYREJECTED;
    errors[SystemErrno::EOWNERDEAD as usize] = Error::EOWNERDEAD;
    errors[SystemErrno::ENOTRECOVERABLE as usize] = Error::ENOTRECOVERABLE;
    errors[SystemErrno::ERFKILL as usize] = Error::ERFKILL;
    errors[SystemErrno::EHWPOISON as usize] = Error::EHWPOISON;
    errors[SystemErrno::EUNKNOWN as usize] = Error::EUNKNOWN;
    errors[SystemErrno::ECHARSET as usize] = Error::ECHARSET;
    errors[SystemErrno::EOF as usize] = Error::EOF;
    errors[SystemErrno::EFTYPE as usize] = Error::EFTYPE;
    errors
};

// ──────────────────────────────────────────────────────────────────────────
// UV_E (Zig namespace struct → Rust module)
// ──────────────────────────────────────────────────────────────────────────

pub mod uv_e {
    use super::uv;
    // TODO(port): Zig type was `comptime_int`; pick concrete int width matching uv constants.
    type UvInt = i32;

    // Zig: @"2BIG" — Rust identifiers cannot start with a digit.
    pub const _2BIG: UvInt = -uv::UV_E2BIG;
    pub const ACCES: UvInt = -uv::UV_EACCES;
    pub const ADDRINUSE: UvInt = -uv::UV_EADDRINUSE;
    pub const ADDRNOTAVAIL: UvInt = -uv::UV_EADDRNOTAVAIL;
    pub const AFNOSUPPORT: UvInt = -uv::UV_EAFNOSUPPORT;
    pub const AGAIN: UvInt = -uv::UV_EAGAIN;
    pub const ALREADY: UvInt = -uv::UV_EALREADY;
    pub const BADF: UvInt = -uv::UV_EBADF;
    pub const BUSY: UvInt = -uv::UV_EBUSY;
    pub const CANCELED: UvInt = -uv::UV_ECANCELED;
    pub const CHARSET: UvInt = -uv::UV_ECHARSET;
    pub const CONNABORTED: UvInt = -uv::UV_ECONNABORTED;
    pub const CONNREFUSED: UvInt = -uv::UV_ECONNREFUSED;
    pub const CONNRESET: UvInt = -uv::UV_ECONNRESET;
    pub const DESTADDRREQ: UvInt = -uv::UV_EDESTADDRREQ;
    pub const EXIST: UvInt = -uv::UV_EEXIST;
    pub const FAULT: UvInt = -uv::UV_EFAULT;
    pub const HOSTUNREACH: UvInt = -uv::UV_EHOSTUNREACH;
    pub const INTR: UvInt = -uv::UV_EINTR;
    pub const INVAL: UvInt = -uv::UV_EINVAL;
    pub const IO: UvInt = -uv::UV_EIO;
    pub const ISCONN: UvInt = -uv::UV_EISCONN;
    pub const ISDIR: UvInt = -uv::UV_EISDIR;
    pub const LOOP: UvInt = -uv::UV_ELOOP;
    pub const MFILE: UvInt = -uv::UV_EMFILE;
    pub const MSGSIZE: UvInt = -uv::UV_EMSGSIZE;
    pub const NAMETOOLONG: UvInt = -uv::UV_ENAMETOOLONG;
    pub const NETDOWN: UvInt = -uv::UV_ENETDOWN;
    pub const NETUNREACH: UvInt = -uv::UV_ENETUNREACH;
    pub const NFILE: UvInt = -uv::UV_ENFILE;
    pub const NOBUFS: UvInt = -uv::UV_ENOBUFS;
    pub const NODEV: UvInt = -uv::UV_ENODEV;
    pub const NOENT: UvInt = -uv::UV_ENOENT;
    pub const NOMEM: UvInt = -uv::UV_ENOMEM;
    pub const NONET: UvInt = -uv::UV_ENONET;
    pub const NOSPC: UvInt = -uv::UV_ENOSPC;
    pub const NOSYS: UvInt = -uv::UV_ENOSYS;
    pub const NOTCONN: UvInt = -uv::UV_ENOTCONN;
    pub const NOTDIR: UvInt = -uv::UV_ENOTDIR;
    pub const NOTEMPTY: UvInt = -uv::UV_ENOTEMPTY;
    pub const NOTSOCK: UvInt = -uv::UV_ENOTSOCK;
    pub const NOTSUP: UvInt = -uv::UV_ENOTSUP;
    pub const PERM: UvInt = -uv::UV_EPERM;
    pub const PIPE: UvInt = -uv::UV_EPIPE;
    pub const PROTO: UvInt = -uv::UV_EPROTO;
    pub const PROTONOSUPPORT: UvInt = -uv::UV_EPROTONOSUPPORT;
    pub const PROTOTYPE: UvInt = -uv::UV_EPROTOTYPE;
    pub const ROFS: UvInt = -uv::UV_EROFS;
    pub const SHUTDOWN: UvInt = -uv::UV_ESHUTDOWN;
    pub const SPIPE: UvInt = -uv::UV_ESPIPE;
    pub const SRCH: UvInt = -uv::UV_ESRCH;
    pub const TIMEDOUT: UvInt = -uv::UV_ETIMEDOUT;
    pub const TXTBSY: UvInt = -uv::UV_ETXTBSY;
    pub const XDEV: UvInt = -uv::UV_EXDEV;
    pub const FBIG: UvInt = -uv::UV_EFBIG;
    pub const NOPROTOOPT: UvInt = -uv::UV_ENOPROTOOPT;
    pub const RANGE: UvInt = -uv::UV_ERANGE;
    pub const NXIO: UvInt = -uv::UV_ENXIO;
    pub const MLINK: UvInt = -uv::UV_EMLINK;
    pub const HOSTDOWN: UvInt = -uv::UV_EHOSTDOWN;
    pub const REMOTEIO: UvInt = -uv::UV_EREMOTEIO;
    pub const NOTTY: UvInt = -uv::UV_ENOTTY;
    pub const FTYPE: UvInt = -uv::UV_EFTYPE;
    pub const ILSEQ: UvInt = -uv::UV_EILSEQ;
    pub const OVERFLOW: UvInt = -uv::UV_EOVERFLOW;
    pub const SOCKTNOSUPPORT: UvInt = -uv::UV_ESOCKTNOSUPPORT;
    pub const NODATA: UvInt = -uv::UV_ENODATA;
    pub const UNATCH: UvInt = -uv::UV_EUNATCH;
    pub const NOEXEC: UvInt = -uv::UV_ENOEXEC;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/errno/windows_errno.zig (1180 lines)
//   confidence: medium
//   todos:      4
//   notes:      anytype dispatch in getErrno/init split into typed overloads; uv_code_to_system_errno hand-expanded from comptime reflection; UV_* enum discriminants depend on uv:: consts being const i32
// ──────────────────────────────────────────────────────────────────────────
