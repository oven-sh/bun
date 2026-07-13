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
// errno X-macros
//
// BOTH `enum E` and `enum SystemErrno` are generated from the same two lists
// so they cannot drift:
//   • `for_each_linux_errno!` — the dense Linux-numbered `0..=137` head
//   • `for_each_uv_errno!`    — the 86 UV_* variants forming the tail
//     (the UV_*→E* fold-down lives in `bun_libuv_sys::uv_err_to_e_discriminant`)
//
// UV entry shape:
//   [UV_X => EX]   — UV_X has a non-UV_ counterpart `SystemErrno::EX`
//   [UV_X]         — no counterpart (EAI_* resolver codes, UNKNOWN, ERRNO_MAX)
//
// ORDER IS LOAD-BEARING: `enum_map::Enum` derives ordinals from declaration
// order, and `SystemErrno::to_e` transmutes by discriminant, so the two enums
// MUST stay in lockstep. Editing these lists updates both atomically.
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

/// X-macro: invokes `$cb! { $($pre)* @linux [PERM EPERM = 1] … }`.
///
/// Row shape: `[<bare> <E-prefixed> = N]` — `enum E` uses the bare spelling
/// (`PERM`), `enum SystemErrno` the prefixed one (`EPERM`). Optional leading
/// `#[meta]` attributes apply to the bare variant only.
macro_rules! for_each_linux_errno {
    ($cb:ident { $($pre:tt)* }) => {
        $cb! { $($pre)* @linux
            [SUCCESS SUCCESS = 0] [PERM EPERM = 1] [NOENT ENOENT = 2] [SRCH ESRCH = 3]
            [INTR EINTR = 4] [IO EIO = 5] [NXIO ENXIO = 6]
            // Rust identifiers cannot start with a digit.
            [#[strum(serialize = "2BIG")] _2BIG E2BIG = 7]
            [NOEXEC ENOEXEC = 8] [BADF EBADF = 9] [CHILD ECHILD = 10] [AGAIN EAGAIN = 11]
            [NOMEM ENOMEM = 12] [ACCES EACCES = 13] [FAULT EFAULT = 14] [NOTBLK ENOTBLK = 15]
            [BUSY EBUSY = 16] [EXIST EEXIST = 17] [XDEV EXDEV = 18] [NODEV ENODEV = 19]
            [NOTDIR ENOTDIR = 20] [ISDIR EISDIR = 21] [INVAL EINVAL = 22] [NFILE ENFILE = 23]
            [MFILE EMFILE = 24] [NOTTY ENOTTY = 25] [TXTBSY ETXTBSY = 26] [FBIG EFBIG = 27]
            [NOSPC ENOSPC = 28] [SPIPE ESPIPE = 29] [ROFS EROFS = 30] [MLINK EMLINK = 31]
            [PIPE EPIPE = 32] [DOM EDOM = 33] [RANGE ERANGE = 34] [DEADLK EDEADLK = 35]
            [NAMETOOLONG ENAMETOOLONG = 36] [NOLCK ENOLCK = 37] [NOSYS ENOSYS = 38]
            [NOTEMPTY ENOTEMPTY = 39] [LOOP ELOOP = 40] [WOULDBLOCK EWOULDBLOCK = 41]
            [NOMSG ENOMSG = 42] [IDRM EIDRM = 43] [CHRNG ECHRNG = 44] [L2NSYNC EL2NSYNC = 45]
            [L3HLT EL3HLT = 46] [L3RST EL3RST = 47] [LNRNG ELNRNG = 48] [UNATCH EUNATCH = 49]
            [NOCSI ENOCSI = 50] [L2HLT EL2HLT = 51] [BADE EBADE = 52] [BADR EBADR = 53]
            [XFULL EXFULL = 54] [NOANO ENOANO = 55] [BADRQC EBADRQC = 56] [BADSLT EBADSLT = 57]
            [DEADLOCK EDEADLOCK = 58] [BFONT EBFONT = 59] [NOSTR ENOSTR = 60]
            [NODATA ENODATA = 61] [TIME ETIME = 62] [NOSR ENOSR = 63] [NONET ENONET = 64]
            [NOPKG ENOPKG = 65] [REMOTE EREMOTE = 66] [NOLINK ENOLINK = 67] [ADV EADV = 68]
            [SRMNT ESRMNT = 69] [COMM ECOMM = 70] [PROTO EPROTO = 71] [MULTIHOP EMULTIHOP = 72]
            [DOTDOT EDOTDOT = 73] [BADMSG EBADMSG = 74] [OVERFLOW EOVERFLOW = 75]
            [NOTUNIQ ENOTUNIQ = 76] [BADFD EBADFD = 77] [REMCHG EREMCHG = 78]
            [LIBACC ELIBACC = 79] [LIBBAD ELIBBAD = 80] [LIBSCN ELIBSCN = 81]
            [LIBMAX ELIBMAX = 82] [LIBEXEC ELIBEXEC = 83] [ILSEQ EILSEQ = 84]
            [RESTART ERESTART = 85] [STRPIPE ESTRPIPE = 86] [USERS EUSERS = 87]
            [NOTSOCK ENOTSOCK = 88] [DESTADDRREQ EDESTADDRREQ = 89] [MSGSIZE EMSGSIZE = 90]
            [PROTOTYPE EPROTOTYPE = 91] [NOPROTOOPT ENOPROTOOPT = 92]
            [PROTONOSUPPORT EPROTONOSUPPORT = 93] [SOCKTNOSUPPORT ESOCKTNOSUPPORT = 94]
            // On Linux EOPNOTSUPP is the real value, but it's ~the same and is
            // incompatible across operating systems:
            // https://lists.gnu.org/archive/html/bug-glibc/2002-08/msg00017.html
            [NOTSUP ENOTSUP = 95]
            [PFNOSUPPORT EPFNOSUPPORT = 96] [AFNOSUPPORT EAFNOSUPPORT = 97]
            [ADDRINUSE EADDRINUSE = 98] [ADDRNOTAVAIL EADDRNOTAVAIL = 99]
            [NETDOWN ENETDOWN = 100] [NETUNREACH ENETUNREACH = 101] [NETRESET ENETRESET = 102]
            [CONNABORTED ECONNABORTED = 103] [CONNRESET ECONNRESET = 104]
            [NOBUFS ENOBUFS = 105] [ISCONN EISCONN = 106] [NOTCONN ENOTCONN = 107]
            [SHUTDOWN ESHUTDOWN = 108] [TOOMANYREFS ETOOMANYREFS = 109]
            [TIMEDOUT ETIMEDOUT = 110] [CONNREFUSED ECONNREFUSED = 111]
            [HOSTDOWN EHOSTDOWN = 112] [HOSTUNREACH EHOSTUNREACH = 113]
            [ALREADY EALREADY = 114] [INPROGRESS EINPROGRESS = 115] [STALE ESTALE = 116]
            [UCLEAN EUCLEAN = 117] [NOTNAM ENOTNAM = 118] [NAVAIL ENAVAIL = 119]
            [ISNAM EISNAM = 120] [REMOTEIO EREMOTEIO = 121] [DQUOT EDQUOT = 122]
            [NOMEDIUM ENOMEDIUM = 123] [MEDIUMTYPE EMEDIUMTYPE = 124]
            [CANCELED ECANCELED = 125] [NOKEY ENOKEY = 126] [KEYEXPIRED EKEYEXPIRED = 127]
            [KEYREVOKED EKEYREVOKED = 128] [KEYREJECTED EKEYREJECTED = 129]
            [OWNERDEAD EOWNERDEAD = 130] [NOTRECOVERABLE ENOTRECOVERABLE = 131]
            [RFKILL ERFKILL = 132] [HWPOISON EHWPOISON = 133]
            // 134..=137 are made-up / libuv-synthetic codes with no Linux number.
            [UNKNOWN EUNKNOWN = 134] [CHARSET ECHARSET = 135] [EOF EOF = 136]
            [FTYPE EFTYPE = 137]
        }
    };
}

/// Relay: forwards `$pre` (which already carries the `@linux` head) into
/// `for_each_uv_errno!` so `__errno_enum!` sees both row lists at once.
macro_rules! __errno_enum_add_uv_tail {
    ($($toks:tt)*) => {
        for_each_uv_errno! { __errno_enum { $($toks)* } }
    };
}

/// Emits one `#[repr(u16)]` errno enum from the Linux head + UV_* tail.
/// `@bare` picks each head row's first ident (`E`); `@prefixed` picks the
/// second (`SystemErrno`) and drops the bare-only attributes.
macro_rules! __errno_enum {
    (
        @bare $vis:vis enum $name:ident
        @linux $( [ $(#[$bm:meta])* $bare:ident $sys:ident = $val:literal ] )*
        @uv $( [ $uv:ident $(=> $uv_sys:ident)? ] )*
    ) => {
        __errno_enum! { @emit $vis enum $name {
            $( $(#[$bm])* $bare = $val, )*
            $( $uv = (-uv::$uv) as u16, )*
        } }
    };
    (
        @prefixed $vis:vis enum $name:ident
        @linux $( [ $(#[$bm:meta])* $bare:ident $sys:ident = $val:literal ] )*
        @uv $( [ $uv:ident $(=> $uv_sys:ident)? ] )*
    ) => {
        __errno_enum! { @emit $vis enum $name {
            $( $sys = $val, )*
            $( $uv = (-uv::$uv) as u16, )*
        } }
    };
    (@emit $vis:vis enum $name:ident { $($body:tt)* }) => {
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
        $vis enum $name { $($body)* }
    };
}

// ──────────────────────────────────────────────────────────────────────────
// E
// ──────────────────────────────────────────────────────────────────────────

for_each_linux_errno! { __errno_enum_add_uv_tail { @bare pub enum E } }

impl E {
    #[inline]
    pub const fn from_raw(n: u16) -> Self {
        // `E` is sparse (dense 0..=137 plus isolated UV_* tags ~3000–4095), so
        // `n < MAX` is NOT a sufficient validity check. `strum::FromRepr`
        // generates a `const fn from_repr` matching every declared variant.
        debug_assert!(Self::from_repr(n).is_some(), "invalid E discriminant");
        // SAFETY: caller guarantees `n` is a declared `#[repr(u16)]` discriminant
        // of `E`. Debug-asserted above; for
        // untrusted input use `try_from_raw` instead.
        unsafe { core::mem::transmute::<u16, E>(n) }
    }

    /// Checked discriminant lookup —
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
    pub type mode_t = i32;

    /// Alias to the platform errno enum so cross-platform
    /// `posix::E::FOO` paths resolve on Windows too.
    pub type E = super::E;
    /// File-mode bits. Re-export the canonical module so
    /// `posix::S::IFDIR` / `posix::S::ISREG(m)` resolve identically to POSIX.
    pub use super::s as S;
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
// S — file mode bits
// ──────────────────────────────────────────────────────────────────────────

/// Lowercase alias kept for path stability; canonical defs live in `bun_core::S`.
/// Constants are `u32` (== `Mode`); the former `i32` typing and snake_case
/// `is_*` predicates had zero callers and were dropped during dedup.
pub use bun_core::S as s;

// ──────────────────────────────────────────────────────────────────────────
// getErrno
// ──────────────────────────────────────────────────────────────────────────

/// `get_errno(rc)` — `rc` is ignored;
/// NTSTATUS callers use `windows::translate_ntstatus_to_errno` directly.
pub fn get_errno<T>(_rc: T) -> E {
    if let Some(sys) = Win32Error::get().to_system_errno() {
        return sys.to_e();
    }

    // `wsa_get_last_error()` returns `Option<SystemErrno>` (already routed
    // through the Win32Error→errno switch). An unmapped non-zero WSA code
    // yields `None` there and falls through to `SUCCESS` — it must NOT surface
    // as `E::UNKNOWN` (which `Win32ErrorExt::to_e`'s `unwrap_or` would do).
    if let Some(wsa) = windows::wsa_get_last_error() {
        return wsa.to_e();
    }

    E::SUCCESS
}

// ──────────────────────────────────────────────────────────────────────────
// SystemErrno
// ──────────────────────────────────────────────────────────────────────────

for_each_linux_errno! { __errno_enum_add_uv_tail { @prefixed pub enum SystemErrno } }

/// Type-dispatch shim for `SystemErrno::init`.
/// Covers every concrete type the codebase actually passes — `i64` (shared
/// `Error.rs` paths), `u32`/`DWORD` (`GetLastError()`), `c_int` (libuv rc),
/// `u16`, and `Win32Error`.
pub trait SystemErrnoInit {
    fn into_system_errno(self) -> Option<SystemErrno>;
}
impl SystemErrnoInit for i64 {
    #[inline]
    fn into_system_errno(self) -> Option<SystemErrno> {
        // Only `u16` / positive `c_int` inputs enter the Win32/uv mapping
        // branch; `i64` is a direct discriminant cast, NOT the Win32Error
        // mapper. Routing i64 through `init_c_int` would mis-map e.g. 13 →
        // EINVAL (Win32 ERROR_INVALID_DATA) instead of EACCES (discriminant 13).
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
        // intentionally unmapped → None. Codes that DO fit u16 route via
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
    /// `init(i64)`; Windows splits it into typed entry points (`init_u16` /
    /// `init_c_int` / `init_win32_error`). Re-unified here behind `SystemErrnoInit` so
    /// shared call sites can keep writing `SystemErrno::init(code)`.
    #[inline]
    pub fn init<C: SystemErrnoInit>(code: C) -> Option<SystemErrno> {
        code.into_system_errno()
    }

    /// `init(code: u16)` — Win32/WSA error codes and negated-uv codes encoded as u16.
    pub fn init_u16(code: u16) -> Option<SystemErrno> {
        Self::init_numeric(code)
    }

    /// `init(code: c_int)` — same as u16 path for positives; negatives are negated and retried.
    pub fn init_c_int(code: c_int) -> Option<SystemErrno> {
        if code > 0 {
            // Any code > u16::MAX is unmapped. Avoid a truncating `as u16`
            // (which could wrap into a valid Win32/uv code) by gating here.
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
            bun_core::debug_warn!("Unknown error code: {}\n", code);
        }
        None
    }

    /// Maps a `Win32Error` code to the corresponding `SystemErrno`.
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

/// Thin typed adapter over the canonical row table in `bun_libuv_sys`.
pub fn translate_uv_error_to_e(code: c_int) -> E {
    uv::uv_err_to_e_discriminant(code)
        .and_then(E::try_from_raw)
        .or_else(|| {
            u16::try_from(code.wrapping_neg())
                .ok()
                .and_then(E::try_from_raw)
        })
        .unwrap_or(E::UNKNOWN)
}

// Thin adapter over the canonical row table in `bun_libuv_sys::uv_err_to_e_discriminant`.
#[inline]
fn uv_code_to_system_errno(mag: u16) -> Option<SystemErrno> {
    let d = uv::uv_err_to_e_discriminant(-c_int::from(mag))?;
    // UV_EAI_* (≥3000) / UV_UNKNOWN have no non-UV_ counterpart.
    if d >= 3000 || d == SystemErrno::EUNKNOWN as u16 {
        return None;
    }
    SystemErrno::from_repr(d)
}

// ──────────────────────────────────────────────────────────────────────────
// UV_E
// ──────────────────────────────────────────────────────────────────────────

pub mod uv_e {
    // Windows has no native errno for any of these — every value is the
    // libuv-synthetic `-UV_E*` constant.
    macro_rules! __v {
        ($i:tt, $e:tt, $uv:tt) => {
            -::bun_libuv_sys::$uv
        };
    }
    crate::__uv_e_rows!(__v);
}

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
    /// `bun_windows_sys` is tier-0 and cannot name `SystemErrno`, so
    /// `to_system_errno()` surfaces here as an extension method instead.
    pub trait Win32ErrorExt: Copy {
        fn to_system_errno(self) -> Option<SystemErrno>;
        /// Convenience: Win32 error → `E`, falling back to `E::UNKNOWN` for
        /// codes not in the Win32→errno table.
        ///
        /// **Note:** NOT appropriate where unmapped codes must fall through
        /// to `SUCCESS` (e.g. the WSA path of `get_errno`); those callers
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

    /// Feeds the raw WSA code (`c_int`) through the Win32→errno switch.
    /// Returns `Some(SUCCESS)` for `0` and `None` for any non-zero code with
    /// no mapping (e.g. `WSANOTINITIALISED`/`WSAEDISCON`); callers that need
    /// a success-on-unmapped fallthrough (`getErrno`) rely on that `None`.
    #[inline]
    pub(crate) fn wsa_get_last_error() -> Option<SystemErrno> {
        SystemErrno::init_c_int(WSAGetLastError())
    }

    /// Moved DOWN so `bun_errno` owns the only NTSTATUS→`E` mapping (cycle-break).
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
            NTSTATUS::CANNOT_DELETE => E::PERM,
            // Any other error status: ask ntdll for the equivalent Win32 error
            // and run it through the same libuv-derived table Node.js uses.
            // Filter drivers and cloud-sync placeholders return many NTSTATUS
            // codes that are not enumerated above; without this fallthrough
            // they would all surface as `UNKNOWN`. Codes `RtlNtStatusToDosError`
            // cannot map still fall back to `E::UNKNOWN` via `to_e()`.
            //
            // Exception: the libuv Win32 table maps `ERROR_INVALID_FUNCTION`
            // to `EISDIR` (because Win32 `DeleteFileW` returns it when called
            // on a directory). At the NTSTATUS layer that case is
            // `STATUS_FILE_IS_A_DIRECTORY`, handled explicitly above; anything
            // else that `RtlNtStatusToDosError` collapses to
            // `ERROR_INVALID_FUNCTION` (`STATUS_NOT_IMPLEMENTED`,
            // `STATUS_INVALID_DEVICE_REQUEST`, `STATUS_ILLEGAL_FUNCTION`) means
            // the driver did not implement the request, not that the target
            // is a directory. Returning `EISDIR` here would make recursive
            // `fs.rm` flip `treat_as_dir` forever, so override it to `ENOTSUP`.
            _ => match Win32Error::from_ntstatus(err).to_e() {
                E::ISDIR => E::NOTSUP,
                e => e,
            },
        }
    }
}

// `Win32Error::{to_system_errno, to_e}` are provided via `windows::Win32ErrorExt`
// (extension trait — `Win32Error` is now a foreign type from `bun_windows_sys`).
