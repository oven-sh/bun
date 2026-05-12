// posix types live in `crate::posix` (moved from bun_sys).
pub use crate::posix::E;
pub use crate::posix::S;
pub use crate::posix::mode_t as Mode;

#[repr(u16)]
#[derive(
    Copy, Clone, Eq, PartialEq, Hash, Debug, strum::IntoStaticStr, strum::EnumString, enum_map::Enum,
)]
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
    // Native `SystemErrno::$e as i32`; libuv-synthetic fallback for codes
    // Linux lacks (no kernel ECHARSET / EFTYPE).
    macro_rules! __v {
        (CHARSET, $e:tt, $uv:tt) => { -::bun_libuv_sys::$uv };
        (FTYPE,   $e:tt, $uv:tt) => { -::bun_libuv_sys::$uv };
        ($i:tt,   $e:tt, $uv:tt) => { super::SystemErrno::$e as i32 };
    }
    crate::__uv_e_rows!(__v);
}

use super::GetErrno;

// raw system calls from std.os.linux.* will return usize
// the errno is stored in this value
impl GetErrno for usize {
    #[inline]
    fn get_errno(self) -> E {
        // `as` between same-width usize/isize is a bit-reinterpretation (Zig: @bitCast)
        let signed = self as isize;
        let int = if signed > -4096 && signed < 0 {
            -signed
        } else {
            0
        };
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
