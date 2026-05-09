// posix types live in `crate::posix` (moved from bun_sys).
pub use crate::posix::mode_t as Mode;
pub use crate::posix::E;
pub use crate::posix::S;

// ──────────────────────────────────────────────────────────────────────────
// posix — MOVE_DOWN landing for std.posix.{mode_t,E,S} + std.c._errno()
//
// Ground truth: Zig `std.posix` (linux) / `std.c` re-exports. Landed here so
// the errno crate stays leaf (T0) and bun_sys (T≥1) imports forward.
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_camel_case_types, non_snake_case)]
pub mod posix {
    use core::ffi::c_int;

    /// Linux `mode_t` (glibc/musl: `unsigned int`).
    pub type mode_t = u32;

    /// Kernel errno enum. Zig's `std.posix.E` and Bun's `SystemErrno` share the
    /// exact same discriminant space on Linux; we alias rather than duplicate.
    /// TODO(port): Zig's `E` uses unprefixed variant names (`PERM`, `NOENT`);
    /// `SystemErrno` uses `EPERM`, `ENOENT`. Callers matching on `E::PERM` must
    /// migrate to `E::EPERM` (or this becomes a distinct enum in Phase B).
    pub type E = super::SystemErrno;

    /// `stat` mode-flag constants and predicates (Zig: `std.posix.S`).
    /// Linux `mode_t` == `u32` == `bun_core::Mode`, so the canonical module is
    /// a drop-in re-export (constant types and predicate signatures unchanged).
    pub use bun_core::S;

    /// Read the thread-local libc errno (Zig: `std.c._errno().*`).
    /// Canonical impl lives in `bun_core::ffi` (single target_os→symbol ladder).
    pub use bun_core::ffi::errno;
    #[allow(unused_imports)] use c_int as _;
}

#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug, strum::IntoStaticStr, strum::EnumString, enum_map::Enum)]
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
}

impl SystemErrno {
    pub const MAX: u16 = 134;

    /// On Linux `EOPNOTSUPP` and `ENOTSUP` share value 95; the enum defines
    /// only `ENOTSUP`. Provide this alias so cross-platform call sites that
    /// match Zig's `.OPNOTSUPP` (npm.zig, copy_file) compile against one name.
    pub const EOPNOTSUPP: SystemErrno = SystemErrno::ENOTSUP;
}

#[allow(non_upper_case_globals)]
pub mod uv_e {
    use super::SystemErrno;

    // TODO(port): Zig name was `@"2BIG"`; Rust idents cannot start with a digit.
    pub const _2BIG: i32 = SystemErrno::E2BIG as i32;
    pub const ACCES: i32 = SystemErrno::EACCES as i32;
    pub const ADDRINUSE: i32 = SystemErrno::EADDRINUSE as i32;
    pub const ADDRNOTAVAIL: i32 = SystemErrno::EADDRNOTAVAIL as i32;
    pub const AFNOSUPPORT: i32 = SystemErrno::EAFNOSUPPORT as i32;
    pub const AGAIN: i32 = SystemErrno::EAGAIN as i32;
    pub const ALREADY: i32 = SystemErrno::EALREADY as i32;
    pub const BADF: i32 = SystemErrno::EBADF as i32;
    pub const BUSY: i32 = SystemErrno::EBUSY as i32;
    pub const CANCELED: i32 = SystemErrno::ECANCELED as i32;
    // Linux lacks ECHARSET; libuv uses synthetic UV_ECHARSET = -4080.
    pub const CHARSET: i32 = -bun_libuv_sys::UV_ECHARSET;
    pub const CONNABORTED: i32 = SystemErrno::ECONNABORTED as i32;
    pub const CONNREFUSED: i32 = SystemErrno::ECONNREFUSED as i32;
    pub const CONNRESET: i32 = SystemErrno::ECONNRESET as i32;
    pub const DESTADDRREQ: i32 = SystemErrno::EDESTADDRREQ as i32;
    pub const EXIST: i32 = SystemErrno::EEXIST as i32;
    pub const FAULT: i32 = SystemErrno::EFAULT as i32;
    pub const HOSTUNREACH: i32 = SystemErrno::EHOSTUNREACH as i32;
    pub const INTR: i32 = SystemErrno::EINTR as i32;
    pub const INVAL: i32 = SystemErrno::EINVAL as i32;
    pub const IO: i32 = SystemErrno::EIO as i32;
    pub const ISCONN: i32 = SystemErrno::EISCONN as i32;
    pub const ISDIR: i32 = SystemErrno::EISDIR as i32;
    pub const LOOP: i32 = SystemErrno::ELOOP as i32;
    pub const MFILE: i32 = SystemErrno::EMFILE as i32;
    pub const MSGSIZE: i32 = SystemErrno::EMSGSIZE as i32;
    pub const NAMETOOLONG: i32 = SystemErrno::ENAMETOOLONG as i32;
    pub const NETDOWN: i32 = SystemErrno::ENETDOWN as i32;
    pub const NETUNREACH: i32 = SystemErrno::ENETUNREACH as i32;
    pub const NFILE: i32 = SystemErrno::ENFILE as i32;
    pub const NOBUFS: i32 = SystemErrno::ENOBUFS as i32;
    pub const NODEV: i32 = SystemErrno::ENODEV as i32;
    pub const NOENT: i32 = SystemErrno::ENOENT as i32;
    pub const NOMEM: i32 = SystemErrno::ENOMEM as i32;
    pub const NONET: i32 = SystemErrno::ENONET as i32;
    pub const NOSPC: i32 = SystemErrno::ENOSPC as i32;
    pub const NOSYS: i32 = SystemErrno::ENOSYS as i32;
    pub const NOTCONN: i32 = SystemErrno::ENOTCONN as i32;
    pub const NOTDIR: i32 = SystemErrno::ENOTDIR as i32;
    pub const NOTEMPTY: i32 = SystemErrno::ENOTEMPTY as i32;
    pub const NOTSOCK: i32 = SystemErrno::ENOTSOCK as i32;
    pub const NOTSUP: i32 = SystemErrno::ENOTSUP as i32;
    pub const PERM: i32 = SystemErrno::EPERM as i32;
    pub const PIPE: i32 = SystemErrno::EPIPE as i32;
    pub const PROTO: i32 = SystemErrno::EPROTO as i32;
    pub const PROTONOSUPPORT: i32 = SystemErrno::EPROTONOSUPPORT as i32;
    pub const PROTOTYPE: i32 = SystemErrno::EPROTOTYPE as i32;
    pub const ROFS: i32 = SystemErrno::EROFS as i32;
    pub const SHUTDOWN: i32 = SystemErrno::ESHUTDOWN as i32;
    pub const SPIPE: i32 = SystemErrno::ESPIPE as i32;
    pub const SRCH: i32 = SystemErrno::ESRCH as i32;
    pub const TIMEDOUT: i32 = SystemErrno::ETIMEDOUT as i32;
    pub const TXTBSY: i32 = SystemErrno::ETXTBSY as i32;
    pub const XDEV: i32 = SystemErrno::EXDEV as i32;
    pub const FBIG: i32 = SystemErrno::EFBIG as i32;
    pub const NOPROTOOPT: i32 = SystemErrno::ENOPROTOOPT as i32;
    pub const RANGE: i32 = SystemErrno::ERANGE as i32;
    pub const NXIO: i32 = SystemErrno::ENXIO as i32;
    pub const MLINK: i32 = SystemErrno::EMLINK as i32;
    pub const HOSTDOWN: i32 = SystemErrno::EHOSTDOWN as i32;
    pub const REMOTEIO: i32 = SystemErrno::EREMOTEIO as i32;
    pub const NOTTY: i32 = SystemErrno::ENOTTY as i32;
    // Linux lacks EFTYPE; libuv uses synthetic UV_EFTYPE = -4028.
    pub const FTYPE: i32 = -bun_libuv_sys::UV_EFTYPE;
    pub const ILSEQ: i32 = SystemErrno::EILSEQ as i32;
    pub const OVERFLOW: i32 = SystemErrno::EOVERFLOW as i32;
    pub const SOCKTNOSUPPORT: i32 = SystemErrno::ESOCKTNOSUPPORT as i32;
    pub const NODATA: i32 = SystemErrno::ENODATA as i32;
    pub const UNATCH: i32 = SystemErrno::EUNATCH as i32;
    pub const NOEXEC: i32 = SystemErrno::ENOEXEC as i32;
}

use super::GetErrno;

// raw system calls from std.os.linux.* will return usize
// the errno is stored in this value
impl GetErrno for usize {
    #[inline]
    fn get_errno(self) -> E {
        // `as` between same-width usize/isize is a bit-reinterpretation (Zig: @bitCast)
        let signed = self as isize;
        let int = if signed > -4096 && signed < 0 { -signed } else { 0 };
        // SAFETY: int is in [0, 4096); E is #[repr] over the kernel errno range
        unsafe { core::mem::transmute::<u16, E>(int as u16) }
    }
}

// glibc system call wrapper returns i32/int
// the errno is stored in a thread local variable
//
// TODO: the inclusion of  'u32' and 'isize' seems suspicious
impl_get_errno_libc!(i32, u32, isize, i64);
// c_int == i32 on all our targets; Zig listed both explicitly but Rust impl coherence forbids the duplicate.
// may need to drop one or cfg-gate it. Zig listed both explicitly.

// ported from: src/errno/linux_errno.zig
