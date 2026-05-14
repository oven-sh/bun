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
    EAFNOSUPPORT = 47,
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
    ETOOMANYREFS = 59,
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
    EREMOTE = 71,
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
}

impl SystemErrno {
    pub const MAX: u16 = 98;

    /// On FreeBSD `ENOTSUP` is not a distinct errno; libc aliases it to
    /// `EOPNOTSUPP` (45). Provide the alias so cross-platform call sites that
    /// match `ENOTSUP` compile.
    pub const ENOTSUP: SystemErrno = SystemErrno::EOPNOTSUPP;
}

#[allow(non_upper_case_globals)]
pub mod uv_e {
    // Native `SystemErrno::$e as i32`; libuv-synthetic fallback for codes
    // FreeBSD lacks (ECHARSET / ENONET / ENOTSUP / EREMOTEIO / ENODATA / EUNATCH).
    macro_rules! __v {
        (CHARSET,  $e:tt, $uv:tt) => { -::bun_libuv_sys::$uv };
        (NONET,    $e:tt, $uv:tt) => { -::bun_libuv_sys::$uv };
        (NOTSUP,   $e:tt, $uv:tt) => { -::bun_libuv_sys::$uv };
        (REMOTEIO, $e:tt, $uv:tt) => { -::bun_libuv_sys::$uv };
        (NODATA,   $e:tt, $uv:tt) => { -::bun_libuv_sys::$uv };
        (UNATCH,   $e:tt, $uv:tt) => { -::bun_libuv_sys::$uv };
        ($i:tt,    $e:tt, $uv:tt) => { super::SystemErrno::$e as i32 };
    }
    crate::__uv_e_rows!(__v);
}
pub use uv_e as UV_E;

use super::GetErrno;

// FreeBSD has no raw-syscall return convention (unlike Linux's `-errno` in
// `usize`); every kernel entry goes through libc, so all widths route to the
// thread-local `__error()` slot.
impl_get_errno_libc!(i32, u32, isize, usize, i64);

// ported from: src/errno/freebsd_errno.zig
