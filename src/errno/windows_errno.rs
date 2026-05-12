#![allow(
    non_camel_case_types,
    non_upper_case_globals,
    clippy::upper_case_acronyms
)]

use core::ffi::c_int;

// `uv::UV_E*` constants come from `bun_libuv_sys` (leaf);
// `Win32Error` / `NTSTATUS` / the NTSTATUS→errno mapper live locally in this
// module (their only external use is via `SystemErrno::init`, defined here).
pub use self::windows::{NTSTATUS, Win32Error, Win32ErrorExt};
use bun_libuv_sys as uv;

// ──────────────────────────────────────────────────────────────────────────
// E
// ──────────────────────────────────────────────────────────────────────────

#[repr(u16)]
#[derive(
    Copy,
    Clone,
    Eq,
    PartialEq,
    Hash,
    Debug,
    strum::IntoStaticStr,
    strum::EnumString,
    strum::FromRepr,
    enum_map::Enum,
)]
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
        // `E` is sparse (dense 0..=137 plus isolated UV_* tags ~3000–4095), so
        // `n < MAX` is NOT a sufficient validity check. `strum::FromRepr`
        // generates a `const fn from_repr` matching every declared variant.
        debug_assert!(Self::from_repr(n).is_some(), "invalid E discriminant");
        // SAFETY: caller guarantees `n` is a declared `#[repr(u16)]` discriminant
        // of `E` (Zig `@enumFromInt` precondition). Debug-asserted above; for
        // untrusted input use `try_from_raw` instead.
        unsafe { core::mem::transmute::<u16, E>(n) }
    }

    /// Checked discriminant lookup. Port of Zig `std.meta.intToEnum(E, n)` —
    /// returns `None` for any `n` that is not a declared variant. The `E` enum
    /// is sparse (dense 0..=137, then isolated UV_* values in the 3000–4095
    /// range), so a `< UV_ERRNO_MAX` range check is NOT sufficient.
    #[inline]
    pub fn try_from_raw(n: u16) -> Option<Self> {
        // `strum::FromRepr` generates a checked `match` on every discriminant.
        E::from_repr(n)
    }

    // Cross-platform aliases: on POSIX `E` is a `type` alias for `SystemErrno`
    // (whose variants are `EPERM`/`ENOENT`/…), so call sites uniformly write
    // `E::ENOENT`. On Windows `E` is its own enum with bare names; expose the
    // E-prefixed spellings as zero-cost associated consts so the same source
    // compiles on both targets.
    pub const EPERM: E = E::PERM;
    pub const ENOENT: E = E::NOENT;
    pub const ESRCH: E = E::SRCH;
    pub const EINTR: E = E::INTR;
    pub const EIO: E = E::IO;
    pub const ENXIO: E = E::NXIO;
    pub const E2BIG: E = E::_2BIG;
    pub const ENOEXEC: E = E::NOEXEC;
    pub const EBADF: E = E::BADF;
    pub const ECHILD: E = E::CHILD;
    pub const EAGAIN: E = E::AGAIN;
    pub const ENOMEM: E = E::NOMEM;
    pub const EACCES: E = E::ACCES;
    pub const EFAULT: E = E::FAULT;
    pub const EBUSY: E = E::BUSY;
    pub const EEXIST: E = E::EXIST;
    pub const EXDEV: E = E::XDEV;
    pub const ENODEV: E = E::NODEV;
    pub const ENOTDIR: E = E::NOTDIR;
    pub const EISDIR: E = E::ISDIR;
    pub const EINVAL: E = E::INVAL;
    pub const ENFILE: E = E::NFILE;
    pub const EMFILE: E = E::MFILE;
    pub const ENOTTY: E = E::NOTTY;
    pub const ETXTBSY: E = E::TXTBSY;
    pub const EFBIG: E = E::FBIG;
    pub const ENOSPC: E = E::NOSPC;
    pub const ESPIPE: E = E::SPIPE;
    pub const EROFS: E = E::ROFS;
    pub const EMLINK: E = E::MLINK;
    pub const EPIPE: E = E::PIPE;
    pub const ERANGE: E = E::RANGE;
    pub const ENAMETOOLONG: E = E::NAMETOOLONG;
    pub const ENOSYS: E = E::NOSYS;
    pub const ENOTEMPTY: E = E::NOTEMPTY;
    pub const ELOOP: E = E::LOOP;
    pub const EWOULDBLOCK: E = E::WOULDBLOCK;
    pub const EOVERFLOW: E = E::OVERFLOW;
    pub const ENOTSOCK: E = E::NOTSOCK;
    pub const EMSGSIZE: E = E::MSGSIZE;
    pub const EPROTONOSUPPORT: E = E::PROTONOSUPPORT;
    pub const ENOTSUP: E = E::NOTSUP;
    pub const EOPNOTSUPP: E = E::NOTSUP;
    pub const EAFNOSUPPORT: E = E::AFNOSUPPORT;
    pub const EADDRINUSE: E = E::ADDRINUSE;
    pub const EADDRNOTAVAIL: E = E::ADDRNOTAVAIL;
    pub const ENETUNREACH: E = E::NETUNREACH;
    pub const ECONNABORTED: E = E::CONNABORTED;
    pub const ECONNRESET: E = E::CONNRESET;
    pub const ENOBUFS: E = E::NOBUFS;
    pub const EISCONN: E = E::ISCONN;
    pub const ENOTCONN: E = E::NOTCONN;
    pub const ETIMEDOUT: E = E::TIMEDOUT;
    pub const ECONNREFUSED: E = E::CONNREFUSED;
    pub const EHOSTUNREACH: E = E::HOSTUNREACH;
    pub const EALREADY: E = E::ALREADY;
    pub const EINPROGRESS: E = E::INPROGRESS;
    pub const ECANCELED: E = E::CANCELED;
    pub const EUNKNOWN: E = E::UNKNOWN;
    pub const ECHARSET: E = E::CHARSET;
    pub const EFTYPE: E = E::FTYPE;
}

/// Mirrors `bun_errno::posix` on POSIX targets so callers can `use
/// bun_errno::posix::*` unconditionally. Windows has no real `mode_t`/kernel
/// `errno`, so this is the minimal subset higher tiers reach for.
pub mod posix {
    use super::SystemErrno;
    pub type mode_t = i32;

    /// Zig: `std.posix.E` — alias to the platform errno enum so cross-platform
    /// `posix::E::FOO` paths resolve on Windows too.
    pub type E = super::E;
    /// Zig: `std.posix.S` — file-mode bits. Re-export the canonical module so
    /// `posix::S::IFDIR` / `posix::S::ISREG(m)` resolve identically to POSIX.
    pub use super::s as S;

    pub const ACCES: i32 = SystemErrno::EACCES as i32;
    pub const AGAIN: i32 = SystemErrno::EAGAIN as i32;
    pub const BADF: i32 = SystemErrno::EBADF as i32;
    pub const BUSY: i32 = SystemErrno::EBUSY as i32;
    pub const EXIST: i32 = SystemErrno::EEXIST as i32;
    pub const INTR: i32 = SystemErrno::EINTR as i32;
    pub const INVAL: i32 = SystemErrno::EINVAL as i32;
    pub const ISDIR: i32 = SystemErrno::EISDIR as i32;
    pub const MFILE: i32 = SystemErrno::EMFILE as i32;
    pub const NAMETOOLONG: i32 = SystemErrno::ENAMETOOLONG as i32;
    pub const NOENT: i32 = SystemErrno::ENOENT as i32;
    pub const NOMEM: i32 = SystemErrno::ENOMEM as i32;
    pub const NOSPC: i32 = SystemErrno::ENOSPC as i32;
    pub const NOSYS: i32 = SystemErrno::ENOSYS as i32;
    pub const NOTDIR: i32 = SystemErrno::ENOTDIR as i32;
    pub const NOTSUP: i32 = SystemErrno::ENOTSUP as i32;
    pub const PERM: i32 = SystemErrno::EPERM as i32;
    pub const PIPE: i32 = SystemErrno::EPIPE as i32;
    pub const XDEV: i32 = SystemErrno::EXDEV as i32;
}

/// Uppercase re-export so `bun_errno::S::IFDIR` compiles cross-platform.
pub use self::s as S;

use super::GetErrno;

// Windows errno comes from `GetLastError()` regardless of `rc`, so every impl
// ignores `self`. Kept to the same concrete-type set as POSIX — a blanket impl
// would shadow `bun_sys::Error::get_errno` (inherent method) via autoref.
macro_rules! impl_win_get_errno {
    ($($t:ty),*) => {$(
        impl GetErrno for $t {
            #[inline] fn get_errno(self) -> E { get_errno(self) }
        }
    )*};
}
impl_win_get_errno!(i8, i16, i32, i64, isize, u8, u16, u32, u64, usize);

// ──────────────────────────────────────────────────────────────────────────
// S — file mode bits (Zig namespace struct → Rust module)
// ──────────────────────────────────────────────────────────────────────────

/// Lowercase alias kept for path stability; canonical defs live in `bun_core::S`.
/// Constants are `u32` (== `Mode`); the former `i32` typing and snake_case
/// `is_*` predicates had zero callers and were dropped during dedup.
pub use bun_core::S as s;

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

    // Zig: `if (bun.windows.WSAGetLastError()) |wsa| return wsa.toE();` where
    // `WSAGetLastError()` is `?SystemErrno` (already routed through the
    // Win32Error→errno switch). An unmapped non-zero WSA code yields `null`
    // there and falls through to `.SUCCESS` — it must NOT surface as
    // `E::UNKNOWN` (which `Win32ErrorExt::to_e`'s `unwrap_or` would do).
    if let Some(wsa) = windows::wsa_get_last_error() {
        return wsa.to_e();
    }

    E::SUCCESS
}

// ──────────────────────────────────────────────────────────────────────────
// SystemErrno
// ──────────────────────────────────────────────────────────────────────────

#[repr(u16)]
#[derive(
    Copy,
    Clone,
    Eq,
    PartialEq,
    Hash,
    Debug,
    strum::IntoStaticStr,
    strum::EnumString,
    strum::FromRepr,
    enum_map::Enum,
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

bun_core::named_error_set!(Error);

/// Type-dispatch shim for `SystemErrno::init` (Zig: `init(code: anytype)`).
/// Covers every concrete type the codebase actually passes — `i64` (shared
/// `Error.rs` paths), `u32`/`DWORD` (`GetLastError()`), `c_int` (libuv rc),
/// `u16`, and `Win32Error`.
pub trait SystemErrnoInit {
    fn into_system_errno(self) -> Option<SystemErrno>;
}
impl SystemErrnoInit for i64 {
    #[inline]
    fn into_system_errno(self) -> Option<SystemErrno> {
        // Zig `init(anytype)` only enters the Win32/uv mapping branch when
        // `@TypeOf(code) == u16` or `(@TypeOf(code) == c_int and code > 0)`.
        // For every other signed width (i64 here) it falls through to
        // `if (code < 0) return init(-code); return @enumFromInt(code);` — a
        // direct discriminant cast, NOT the Win32Error mapper. Routing i64
        // through `init_c_int` would mis-map e.g. 13 → EINVAL (Win32
        // ERROR_INVALID_DATA) instead of EACCES (discriminant 13).
        //
        // CHECKED, not `from_raw`: the Rust i64 impl is a cross-platform shim
        // and some Windows-reachable callers (`Listener.rs`, `udp_socket.rs`)
        // widened a `c_int` holding `WSAGetLastError()` (e.g. 10048). Those are
        // NOT valid `SystemErrno` discriminants, so an unchecked transmute is
        // immediate UB. Validate first; on miss, fall through to the Win32/uv
        // mapper so WSA codes still resolve (10048 → EADDRINUSE) instead of
        // silently degrading to `None`.
        let n = u16::try_from(self.unsigned_abs()).ok()?;
        if let Some(e) = SystemErrno::from_repr(n) {
            return Some(e);
        }
        SystemErrno::init_c_int(self as c_int)
    }
}
impl SystemErrnoInit for i32 {
    #[inline]
    fn into_system_errno(self) -> Option<SystemErrno> {
        SystemErrno::init_c_int(self)
    }
}
impl SystemErrnoInit for u32 {
    #[inline]
    fn into_system_errno(self) -> Option<SystemErrno> {
        // GetLastError()/WSAGetLastError() return DWORD; HRESULT-shaped facility
        // codes and some installer/WinHTTP errors exceed 0xFFFF. Those are
        // intentionally unmapped → None (matches Zig peer-widening, which would
        // also fall through every range check). Codes that DO fit u16 route via
        // the Win32Error→errno table.
        u16::try_from(self).ok().and_then(SystemErrno::init_u16)
    }
}
impl SystemErrnoInit for u16 {
    #[inline]
    fn into_system_errno(self) -> Option<SystemErrno> {
        SystemErrno::init_u16(self)
    }
}
impl SystemErrnoInit for Win32Error {
    #[inline]
    fn into_system_errno(self) -> Option<SystemErrno> {
        SystemErrno::init_win32_error(self)
    }
}

impl SystemErrno {
    pub const MAX: usize = 138;

    /// Windows' libuv-mapped errno set spells this `ENOTSUP`; alias the POSIX
    /// `EOPNOTSUPP` name so cross-platform `match` arms compile unchanged.
    pub const EOPNOTSUPP: SystemErrno = SystemErrno::ENOTSUP;

    #[inline]
    pub const fn to_e(self) -> E {
        // SystemErrno and E share identical #[repr(u16)] discriminant sets.
        E::from_raw(self as u16)
    }

    /// Cross-platform `SystemErrno::init` — POSIX targets define a single
    /// `init(i64)`; Windows split it into typed entry points (`init_u16` /
    /// `init_c_int` / `init_win32_error`) because Zig's `anytype` dispatch has
    /// no stable-Rust equivalent. Re-unified here behind `SystemErrnoInit` so
    /// shared call sites can keep writing `SystemErrno::init(code)`.
    #[inline]
    pub fn init<C: SystemErrnoInit>(code: C) -> Option<SystemErrno> {
        code.into_system_errno()
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
            let Ok(code) = u16::try_from(code) else {
                return None;
            };
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
        if code <= Win32Error::IO_REISSUE_AS_CACHED.0
            || (code >= Win32Error::WSAEINTR.0 && code <= Win32Error::WSA_QOS_RESERVED_PETYPE.0)
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
    // Zig: @"2BIG" — Rust identifiers cannot start with a digit → `_2BIG`.
    crate::__decl_uv_e! {
        _2BIG          = -uv::UV_E2BIG          => "E2BIG",
        ACCES          = -uv::UV_EACCES         => "EACCES",
        ADDRINUSE      = -uv::UV_EADDRINUSE     => "EADDRINUSE",
        ADDRNOTAVAIL   = -uv::UV_EADDRNOTAVAIL  => "EADDRNOTAVAIL",
        AFNOSUPPORT    = -uv::UV_EAFNOSUPPORT   => "EAFNOSUPPORT",
        AGAIN          = -uv::UV_EAGAIN         => "EAGAIN",
        ALREADY        = -uv::UV_EALREADY       => "EALREADY",
        BADF           = -uv::UV_EBADF          => "EBADF",
        BUSY           = -uv::UV_EBUSY          => "EBUSY",
        CANCELED       = -uv::UV_ECANCELED      => "ECANCELED",
        CHARSET        = -uv::UV_ECHARSET       => "ECHARSET",
        CONNABORTED    = -uv::UV_ECONNABORTED   => "ECONNABORTED",
        CONNREFUSED    = -uv::UV_ECONNREFUSED   => "ECONNREFUSED",
        CONNRESET      = -uv::UV_ECONNRESET     => "ECONNRESET",
        DESTADDRREQ    = -uv::UV_EDESTADDRREQ   => "EDESTADDRREQ",
        EXIST          = -uv::UV_EEXIST         => "EEXIST",
        FAULT          = -uv::UV_EFAULT         => "EFAULT",
        HOSTUNREACH    = -uv::UV_EHOSTUNREACH   => "EHOSTUNREACH",
        INTR           = -uv::UV_EINTR          => "EINTR",
        INVAL          = -uv::UV_EINVAL         => "EINVAL",
        IO             = -uv::UV_EIO            => "EIO",
        ISCONN         = -uv::UV_EISCONN        => "EISCONN",
        ISDIR          = -uv::UV_EISDIR         => "EISDIR",
        LOOP           = -uv::UV_ELOOP          => "ELOOP",
        MFILE          = -uv::UV_EMFILE         => "EMFILE",
        MSGSIZE        = -uv::UV_EMSGSIZE       => "EMSGSIZE",
        NAMETOOLONG    = -uv::UV_ENAMETOOLONG   => "ENAMETOOLONG",
        NETDOWN        = -uv::UV_ENETDOWN       => "ENETDOWN",
        NETUNREACH     = -uv::UV_ENETUNREACH    => "ENETUNREACH",
        NFILE          = -uv::UV_ENFILE         => "ENFILE",
        NOBUFS         = -uv::UV_ENOBUFS        => "ENOBUFS",
        NODEV          = -uv::UV_ENODEV         => "ENODEV",
        NOENT          = -uv::UV_ENOENT         => "ENOENT",
        NOMEM          = -uv::UV_ENOMEM         => "ENOMEM",
        NONET          = -uv::UV_ENONET         => "ENONET",
        NOSPC          = -uv::UV_ENOSPC         => "ENOSPC",
        NOSYS          = -uv::UV_ENOSYS         => "ENOSYS",
        NOTCONN        = -uv::UV_ENOTCONN       => "ENOTCONN",
        NOTDIR         = -uv::UV_ENOTDIR        => "ENOTDIR",
        NOTEMPTY       = -uv::UV_ENOTEMPTY      => "ENOTEMPTY",
        NOTSOCK        = -uv::UV_ENOTSOCK       => "ENOTSOCK",
        NOTSUP         = -uv::UV_ENOTSUP        => "ENOTSUP",
        PERM           = -uv::UV_EPERM          => "EPERM",
        PIPE           = -uv::UV_EPIPE          => "EPIPE",
        PROTO          = -uv::UV_EPROTO         => "EPROTO",
        PROTONOSUPPORT = -uv::UV_EPROTONOSUPPORT => "EPROTONOSUPPORT",
        PROTOTYPE      = -uv::UV_EPROTOTYPE     => "EPROTOTYPE",
        ROFS           = -uv::UV_EROFS          => "EROFS",
        SHUTDOWN       = -uv::UV_ESHUTDOWN      => "ESHUTDOWN",
        SPIPE          = -uv::UV_ESPIPE         => "ESPIPE",
        SRCH           = -uv::UV_ESRCH          => "ESRCH",
        TIMEDOUT       = -uv::UV_ETIMEDOUT      => "ETIMEDOUT",
        TXTBSY         = -uv::UV_ETXTBSY        => "ETXTBSY",
        XDEV           = -uv::UV_EXDEV          => "EXDEV",
        FBIG           = -uv::UV_EFBIG          => "EFBIG",
        NOPROTOOPT     = -uv::UV_ENOPROTOOPT    => "ENOPROTOOPT",
        RANGE          = -uv::UV_ERANGE         => "ERANGE",
        NXIO           = -uv::UV_ENXIO          => "ENXIO",
        MLINK          = -uv::UV_EMLINK         => "EMLINK",
        HOSTDOWN       = -uv::UV_EHOSTDOWN      => "EHOSTDOWN",
        REMOTEIO       = -uv::UV_EREMOTEIO      => "EREMOTEIO",
        NOTTY          = -uv::UV_ENOTTY         => "ENOTTY",
        FTYPE          = -uv::UV_EFTYPE         => "EFTYPE",
        ILSEQ          = -uv::UV_EILSEQ         => "EILSEQ",
        OVERFLOW       = -uv::UV_EOVERFLOW      => "EOVERFLOW",
        SOCKTNOSUPPORT = -uv::UV_ESOCKTNOSUPPORT => "ESOCKTNOSUPPORT",
        NODATA         = -uv::UV_ENODATA        => "ENODATA",
        UNATCH         = -uv::UV_EUNATCH        => "EUNATCH",
        NOEXEC         = -uv::UV_ENOEXEC        => "ENOEXEC",
    }
}

// ported from: src/errno/windows_errno.zig

// ──────────────────────────────────────────────────────────────────────────
// `windows` — Win32Error / NTSTATUS / kernel32 surface moved DOWN from
// `bun_sys::windows` (cycle-break per PORTING.md §Dep-cycle fixes). Only the
// subset referenced by `SystemErrno::init` / `get_errno` is mirrored; the full
// 1100-variant table stays in `bun_sys::windows` and re-exports this newtype.
// ──────────────────────────────────────────────────────────────────────────
pub mod windows {
    use super::{E, SystemErrno};

    /// `enum(u16) Win32Error` — newtype over `GetLastError()`'s low word.
    /// Re-exported from the tier-0 `bun_windows_sys` leaf crate (no cycle:
    /// that crate has zero workspace deps), so this module and
    /// `bun_sys::windows` share one nominal type.
    pub use bun_windows_sys::Win32Error;

    /// `NTSTATUS` — `enum(u32) { …, _ }`. Same provenance as `Win32Error`.
    pub use bun_windows_sys::NTSTATUS;

    use bun_windows_sys::ws2_32::WSAGetLastError;

    /// Extension trait for `Win32Error` → `SystemErrno`/`E` mapping.
    /// `bun_windows_sys` is tier-0 and cannot name `SystemErrno`, so the
    /// inherent `to_system_errno()` from the Zig API surfaces here instead.
    pub trait Win32ErrorExt: Copy {
        fn to_system_errno(self) -> Option<SystemErrno>;
        /// Convenience: Win32 error → `E`, falling back to `E::UNKNOWN` for
        /// codes not in the Win32→errno table.
        ///
        /// **Spec note:** Zig's `Win32Error` has `toSystemErrno()` only — no
        /// `toE()`. This helper ports the *call-site* idiom from
        /// `bun.windows.getLastErrno()` (windows.zig:3010), which spells out
        /// `Win32Error.get().toSystemErrno() orelse SystemErrno.EUNKNOWN`.
        /// It is NOT appropriate where Zig spec falls through to `.SUCCESS`
        /// on unmapped codes (e.g. the WSA path of `getErrno`); those callers
        /// must use `to_system_errno()` and choose their own fallback.
        #[inline]
        fn to_e(self) -> E {
            self.to_system_errno()
                .map(SystemErrno::to_e)
                .unwrap_or(E::UNKNOWN)
        }
    }
    impl Win32ErrorExt for Win32Error {
        #[inline]
        fn to_system_errno(self) -> Option<SystemErrno> {
            SystemErrno::init_win32_error(self)
        }
    }

    /// Port of `bun.windows.WSAGetLastError() ?SystemErrno` (windows.zig:3303).
    ///
    /// Zig: `return SystemErrno.init(@intFromEnum(ws2_32.WSAGetLastError()));`
    /// — feeds the raw WSA code (`c_int`) through the Win32→errno switch.
    /// Returns `Some(SUCCESS)` for `0` and `None` for any non-zero code with
    /// no mapping (e.g. `WSANOTINITIALISED`/`WSAEDISCON`); callers that need
    /// a success-on-unmapped fallthrough (`getErrno`) rely on that `None`.
    #[inline]
    pub fn wsa_get_last_error() -> Option<SystemErrno> {
        SystemErrno::init_c_int(WSAGetLastError())
    }

    /// `bun.windows.translateNTStatusToErrno` (windows.zig) — moved DOWN so
    /// `bun_errno` owns the only NTSTATUS→`E` mapping (cycle-break).
    pub fn translate_ntstatus_to_errno(err: NTSTATUS) -> E {
        match err {
            NTSTATUS::SUCCESS => E::SUCCESS,
            NTSTATUS::ACCESS_DENIED => E::PERM,
            NTSTATUS::INVALID_HANDLE => E::BADF,
            NTSTATUS::INVALID_PARAMETER => E::INVAL,
            NTSTATUS::OBJECT_NAME_COLLISION => E::EXIST,
            NTSTATUS::FILE_IS_A_DIRECTORY => E::ISDIR,
            NTSTATUS::OBJECT_PATH_NOT_FOUND | NTSTATUS::OBJECT_NAME_NOT_FOUND => E::NOENT,
            NTSTATUS::NOT_A_DIRECTORY => E::NOTDIR,
            NTSTATUS::RETRY => E::AGAIN,
            NTSTATUS::DIRECTORY_NOT_EMPTY => E::NOTEMPTY,
            NTSTATUS::FILE_TOO_LARGE => E::_2BIG,
            NTSTATUS::NOT_SAME_DEVICE => E::XDEV,
            NTSTATUS::DELETE_PENDING => E::BUSY,
            NTSTATUS::SHARING_VIOLATION => E::BUSY,
            NTSTATUS::OBJECT_NAME_INVALID => E::INVAL,
            _ => E::UNKNOWN,
        }
    }
}

// `Win32Error::{to_system_errno, to_e}` are provided via `windows::Win32ErrorExt`
// (extension trait — `Win32Error` is now a foreign type from `bun_windows_sys`).
