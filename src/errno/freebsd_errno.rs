// posix types live in `crate::posix` (moved from bun_sys).
pub use crate::posix::mode_t as Mode;
pub use crate::posix::E;
pub use crate::posix::S;

// ──────────────────────────────────────────────────────────────────────────
// posix — MOVE_DOWN landing for std.posix.{mode_t,E,S} + std.c._errno()
//
// Ground truth: Zig `std.posix` (freebsd) / `std.c` re-exports. Landed here so
// the errno crate stays leaf (T0) and bun_sys (T≥1) imports forward.
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_camel_case_types, non_snake_case)]
pub mod posix {
    use core::ffi::c_int;

    /// FreeBSD `mode_t` (`__uint16_t` in <sys/types.h>).
    pub type mode_t = u16;

    /// Kernel errno enum. Zig's `std.posix.E` and Bun's `SystemErrno` share the
    /// exact same discriminant space on FreeBSD; we alias rather than duplicate.
    /// TODO(port): Zig's `E` uses unprefixed variant names (`PERM`, `NOENT`);
    /// `SystemErrno` uses `EPERM`, `ENOENT`. Callers matching on `E::PERM` must
    /// migrate to `E::EPERM` (or this becomes a distinct enum in Phase B).
    pub type E = super::SystemErrno;

    /// `stat` mode-flag constants and predicates (Zig: `std.posix.S`).
    /// Constants are typed `u32` (the cross-platform `Mode` width) rather than
    /// FreeBSD's native `mode_t` (u16) so that `Mode`-typed expressions compile
    /// uniformly across platforms — i.e. byte-identical to the canonical
    /// `bun_core::S`, so re-export it directly.
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
    use super::SystemErrno;
    // libuv errno-space fallbacks for codes FreeBSD lacks natively. Values are
    // `-UV_E*` from libuv's <uv/errno.h> (see src/libuv_sys/libuv.zig:873-932).
    use bun_libuv_sys as libuv;

    // PORT NOTE: Zig `@"2BIG"` (raw ident starting with digit) — Rust idents
    // cannot start with a digit; prefixed with underscore.
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
    pub const CHARSET: i32 = -libuv::UV_ECHARSET;
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
    pub const NONET: i32 = -libuv::UV_ENONET;
    pub const NOSPC: i32 = SystemErrno::ENOSPC as i32;
    pub const NOSYS: i32 = SystemErrno::ENOSYS as i32;
    pub const NOTCONN: i32 = SystemErrno::ENOTCONN as i32;
    pub const NOTDIR: i32 = SystemErrno::ENOTDIR as i32;
    pub const NOTEMPTY: i32 = SystemErrno::ENOTEMPTY as i32;
    pub const NOTSOCK: i32 = SystemErrno::ENOTSOCK as i32;
    pub const NOTSUP: i32 = -libuv::UV_ENOTSUP;
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
    pub const REMOTEIO: i32 = -libuv::UV_EREMOTEIO;
    pub const NOTTY: i32 = SystemErrno::ENOTTY as i32;
    pub const FTYPE: i32 = SystemErrno::EFTYPE as i32;
    pub const ILSEQ: i32 = SystemErrno::EILSEQ as i32;
    pub const OVERFLOW: i32 = SystemErrno::EOVERFLOW as i32;
    pub const SOCKTNOSUPPORT: i32 = SystemErrno::ESOCKTNOSUPPORT as i32;
    pub const NODATA: i32 = -libuv::UV_ENODATA;
    pub const UNATCH: i32 = -libuv::UV_EUNATCH;
    pub const NOEXEC: i32 = SystemErrno::ENOEXEC as i32;
}
pub use uv_e as UV_E;

use super::GetErrno;

#[inline]
pub fn get_errno<T: GetErrno>(rc: T) -> E {
    rc.get_errno()
}

// FreeBSD has no raw-syscall return convention (unlike Linux's `-errno` in
// `usize`); every kernel entry goes through libc, so all widths route to the
// thread-local `__error()` slot.
macro_rules! impl_get_errno_libc {
    ($($t:ty),+ $(,)?) => {$(
        impl GetErrno for $t {
            #[inline]
            fn get_errno(self) -> E {
                // Zig bitcasts unsigned → SAME-width signed before `== -1`.
                // `as i64` would zero-extend u32, never matching -1. Compare
                // against the type's own all-ones value instead (== -1 for
                // signed, == MAX for unsigned — both are libc's failure rc).
                if self == !(0 as $t) {
                    return E::from_raw(crate::posix::errno() as u16);
                }
                E::SUCCESS
            }
        }
    )+};
}
impl_get_errno_libc!(i32, u32, isize, usize, i64);

// ported from: src/errno/freebsd_errno.zig
