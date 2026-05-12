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
// UV_* errno X-macro
//
// Single source of truth for the 86 UV_* variants that form the tail of BOTH
// `enum E` and `enum SystemErrno`. Zig keeps two literal enum tails; Rust
// drives both from this one list so they cannot drift. (The UV_*→E* fold-down
// lives in `bun_libuv_sys::uv_err_to_e_discriminant`.)
//
// Entry shape:
//   [UV_X => EX]   — UV_X has a non-UV_ counterpart `SystemErrno::EX`
//   [UV_X]         — no counterpart (EAI_* resolver codes, UNKNOWN, ERRNO_MAX)
//
// ORDER IS LOAD-BEARING: `enum_map::Enum` derives ordinals from declaration
// order, and `SystemErrno::to_e` transmutes by discriminant, so the two enums
// MUST stay in lockstep. Editing this list updates both atomically.
// ──────────────────────────────────────────────────────────────────────────

/// X-macro: invokes `$cb! { $($pre)* @uv [UV_X => EX] [UV_Y] … }`.
macro_rules! for_each_uv_errno {
    ($cb:ident { $($pre:tt)* }) => {
        $cb! { $($pre)* @uv
            [UV_E2BIG => E2BIG] [UV_EACCES => EACCES] [UV_EADDRINUSE => EADDRINUSE]
            [UV_EADDRNOTAVAIL => EADDRNOTAVAIL] [UV_EAFNOSUPPORT => EAFNOSUPPORT]
            [UV_EAGAIN => EAGAIN] [UV_EAI_ADDRFAMILY] [UV_EAI_AGAIN] [UV_EAI_BADFLAGS]
            [UV_EAI_BADHINTS] [UV_EAI_CANCELED] [UV_EAI_FAIL] [UV_EAI_FAMILY]
            [UV_EAI_MEMORY] [UV_EAI_NODATA] [UV_EAI_NONAME] [UV_EAI_OVERFLOW]
            [UV_EAI_PROTOCOL] [UV_EAI_SERVICE] [UV_EAI_SOCKTYPE] [UV_EALREADY => EALREADY]
            [UV_EBADF => EBADF] [UV_EBUSY => EBUSY] [UV_ECANCELED => ECANCELED]
            [UV_ECHARSET => ECHARSET] [UV_ECONNABORTED => ECONNABORTED]
            [UV_ECONNREFUSED => ECONNREFUSED] [UV_ECONNRESET => ECONNRESET]
            [UV_EDESTADDRREQ => EDESTADDRREQ] [UV_EEXIST => EEXIST] [UV_EFAULT => EFAULT]
            [UV_EFBIG => EFBIG] [UV_EHOSTUNREACH => EHOSTUNREACH] [UV_EINVAL => EINVAL]
            [UV_EINTR => EINTR] [UV_EISCONN => EISCONN] [UV_EIO => EIO] [UV_ELOOP => ELOOP]
            [UV_EISDIR => EISDIR] [UV_EMSGSIZE => EMSGSIZE] [UV_EMFILE => EMFILE]
            [UV_ENETDOWN => ENETDOWN] [UV_ENAMETOOLONG => ENAMETOOLONG] [UV_ENFILE => ENFILE]
            [UV_ENETUNREACH => ENETUNREACH] [UV_ENODEV => ENODEV] [UV_ENOBUFS => ENOBUFS]
            [UV_ENOMEM => ENOMEM] [UV_ENOENT => ENOENT] [UV_ENOPROTOOPT => ENOPROTOOPT]
            [UV_ENONET => ENONET] [UV_ENOSYS => ENOSYS] [UV_ENOSPC => ENOSPC]
            [UV_ENOTDIR => ENOTDIR] [UV_ENOTCONN => ENOTCONN] [UV_ENOTSOCK => ENOTSOCK]
            [UV_ENOTEMPTY => ENOTEMPTY] [UV_EOVERFLOW => EOVERFLOW] [UV_ENOTSUP => ENOTSUP]
            [UV_EPIPE => EPIPE] [UV_EPERM => EPERM] [UV_EPROTONOSUPPORT => EPROTONOSUPPORT]
            [UV_EPROTO => EPROTO] [UV_ERANGE => ERANGE] [UV_EPROTOTYPE => EPROTOTYPE]
            [UV_ESHUTDOWN => ESHUTDOWN] [UV_EROFS => EROFS] [UV_ESRCH => ESRCH]
            [UV_ESPIPE => ESPIPE] [UV_ETXTBSY => ETXTBSY] [UV_ETIMEDOUT => ETIMEDOUT]
            [UV_UNKNOWN] [UV_EXDEV => EXDEV] [UV_ENXIO => ENXIO] [UV_EOF => EOF]
            [UV_EHOSTDOWN => EHOSTDOWN] [UV_EMLINK => EMLINK] [UV_ENOTTY => ENOTTY]
            [UV_EREMOTEIO => EREMOTEIO] [UV_EILSEQ => EILSEQ] [UV_EFTYPE => EFTYPE]
            [UV_ENODATA => ENODATA] [UV_ESOCKTNOSUPPORT => ESOCKTNOSUPPORT] [UV_ERRNO_MAX]
            [UV_EUNATCH => EUNATCH] [UV_ENOEXEC => ENOEXEC]
        }
    };
}

/// Callback: emit `$pre` enum decl with the UV_* tail appended verbatim.
macro_rules! __errno_enum_with_uv_tail {
    (
        $(#[$m:meta])* $vis:vis enum $name:ident { $($head:tt)* }
        @uv $( [ $uv:ident $(=> $sys:ident)? ] )*
    ) => {
        $(#[$m])*
        $vis enum $name {
            $($head)*
            $( $uv = (-uv::$uv) as u16, )*
        }
    };
}

// ──────────────────────────────────────────────────────────────────────────
// E
// ──────────────────────────────────────────────────────────────────────────

for_each_uv_errno! { __errno_enum_with_uv_tail {
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
}
}} // ← UV_* tail appended by `for_each_uv_errno!`

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

for_each_uv_errno! { __errno_enum_with_uv_tail {
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
}
}} // ← UV_* tail appended by `for_each_uv_errno!`

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

    /// Zig: `pub fn toError(self) Error` — the local `Error` enum + 137-row
    /// `ERROR_MAP` were a hand-typed identity bijection over the same tag names
    /// `bun_core::Error::from_errno` already interns via the `ErrnoNames` link
    /// hook this crate populates. POSIX targets always went through `from_errno`;
    /// Windows now does too. (`from_error` — the inverse — had zero callers and
    /// was deleted outright.)
    #[inline]
    pub fn to_error(self) -> bun_core::Error {
        bun_core::Error::from_errno(self as u16 as i32)
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

/// Port of Zig `bun.windows.libuv.translateUVErrorToE` (libuv.zig:2776).
/// Thin typed adapter over the canonical row table in `bun_libuv_sys`.
pub fn translate_uv_error_to_e(code: c_int) -> E {
    uv::uv_err_to_e_discriminant(code)
        .and_then(E::try_from_raw)
        .or_else(|| u16::try_from(code.wrapping_neg()).ok().and_then(E::try_from_raw))
        .unwrap_or(E::UNKNOWN)
}

// Zig: `inline for (@typeInfo(SystemErrno).@"enum".fields) |field| { if startsWith "UV_" && @hasField(stripped) ... }`
// Thin adapter over the canonical row table in `bun_libuv_sys::uv_err_to_e_discriminant`.
#[inline]
fn uv_code_to_system_errno(mag: u16) -> Option<SystemErrno> {
    let d = uv::uv_err_to_e_discriminant(-c_int::from(mag))?;
    // UV_EAI_* (≥3000) / UV_UNKNOWN have no non-UV_ counterpart (Zig @hasField was false).
    if d >= 3000 || d == SystemErrno::EUNKNOWN as u16 {
        return None;
    }
    SystemErrno::from_repr(d)
}

// ──────────────────────────────────────────────────────────────────────────
// UV_E (Zig namespace struct → Rust module)
// ──────────────────────────────────────────────────────────────────────────

pub mod uv_e {
    // Windows has no native errno for any of these — every value is the
    // libuv-synthetic `-UV_E*` constant.
    macro_rules! __v {
        ($i:tt, $e:tt, $uv:tt) => { -::bun_libuv_sys::$uv };
    }
    crate::__uv_e_rows!(__v);
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
