#![allow(
    non_camel_case_types,
    non_upper_case_globals,
    clippy::upper_case_acronyms
)]

use core::ffi::c_int;

// `uv::UV_E*` constants come from `crate::uv_codes`;
// `Win32Error` / `NTSTATUS` / the NTSTATUS→errno mapper live locally in this
// module (their only external use is via `SystemErrno::init`, defined here).
pub use self::windows::{NTSTATUS, Win32Error, Win32ErrorExt};
use crate::uv_codes as uv;

/// As on POSIX.
pub type E = SystemErrno;

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

// ──────────────────────────────────────────────────────────────────────────
// S — file mode bits
// ──────────────────────────────────────────────────────────────────────────

/// Lowercase alias kept for path stability; canonical defs live in `bun_core::S`.
/// Constants are `u32` (== `Mode`); the former `i32` typing and snake_case
/// `is_*` predicates had zero callers and were dropped during dedup.
pub use bun_core::S as s;

// ──────────────────────────────────────────────────────────────────────────
// last_error
// ──────────────────────────────────────────────────────────────────────────

/// `GetLastError()` as `E`: `SUCCESS` when no code is recorded, else
/// `Win32ErrorExt::to_e`. For the error of a call known to have failed use
/// `bun_sys::Error::from_win32` / `bun_sys::windows::last_system_errno`.
#[inline]
pub fn last_error() -> E {
    match Win32Error::get() {
        Win32Error::SUCCESS => E::SUCCESS,
        code => code.to_e(),
    }
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
}

/// Type-dispatch shim for `SystemErrno::init`.
/// Covers every concrete type the codebase actually passes — `i64`
/// (POSIX-shaped shared call sites), `u32`/`DWORD` (a Win32/WSA code carried
/// as an integer), and `c_int` (`Bun__errnoName`, which may receive a negative
/// `UV_E*` number). A typed `Win32Error` uses `Win32ErrorExt` instead.
pub trait SystemErrnoInit {
    fn into_system_errno(self) -> Option<SystemErrno>;
}
impl SystemErrnoInit for i64 {
    #[inline]
    fn into_system_errno(self) -> Option<SystemErrno> {
        // Only `u32` / positive `c_int` inputs enter the Win32/uv mapping
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
        // A DWORD from GetLastError() and friends: values above 0xFFFF are
        // unmapped unless they are a `FACILITY_WIN32` HRESULT wrapping a Win32
        // code (see `Win32Error::from_u32`).
        match Win32Error::from_u32(self) {
            Win32Error(u16::MAX) => None,
            code => SystemErrno::init_numeric(code.0),
        }
    }
}

impl SystemErrno {
    pub(crate) const MAX: usize = 138;

    /// Windows' libuv-mapped errno set spells this `ENOTSUP`; alias the POSIX
    /// `EOPNOTSUPP` name so cross-platform `match` arms compile unchanged.
    pub const EOPNOTSUPP: SystemErrno = SystemErrno::ENOTSUP;

    /// Cross-platform `SystemErrno::init` — POSIX targets define a single
    /// `init(i64)`; Windows dispatches on the integer type via
    /// `SystemErrnoInit` so shared call sites can keep writing
    /// `SystemErrno::init(code)`.
    #[inline]
    pub fn init<C: SystemErrnoInit>(code: C) -> Option<SystemErrno> {
        code.into_system_errno()
    }

    /// `init(code: c_int)` — same as u16 path for positives; negatives are negated and retried.
    pub(crate) fn init_c_int(code: c_int) -> Option<SystemErrno> {
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
        if let Some(mapped) = uv_to_e(-c_int::from(code))
            && mapped != SystemErrno::EUNKNOWN
        {
            return Some(mapped);
        }
        if cfg!(debug_assertions) {
            bun_core::debug_warn!("Unknown error code: {}\n", code);
        }
        None
    }

    /// Maps a `Win32Error` code to the corresponding `SystemErrno`.
    pub(crate) fn init_win32_error(code: Win32Error) -> Option<SystemErrno> {
        use Win32Error as W;
        Some(match code {
            W::NOACCESS => SystemErrno::EFAULT,
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
            W::DELETE_PENDING => SystemErrno::EBUSY,
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
            W::BUFFER_OVERFLOW => SystemErrno::ENAMETOOLONG,
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
            W::DIRECTORY => SystemErrno::ENOENT,
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
            W::BROKEN_PIPE => SystemErrno::EOF,
            W::ACCESS_DENIED => SystemErrno::EPERM,
            W::PRIVILEGE_NOT_HELD => SystemErrno::EPERM,
            W::BAD_PIPE => SystemErrno::EPIPE,
            W::NO_DATA => SystemErrno::EAGAIN,
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
            W::BAD_EXE_FORMAT => SystemErrno::EFTYPE,
            _ => return None,
        })
    }
}

/// A Win32 error code → the negative `UV_E*` number Node reports for it
/// (`UV_UNKNOWN` when the table has no row). A value that is already `<= 0`
/// is returned as is.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__translateWin32ErrorToUV(code: u32) -> c_int {
    if code as c_int <= 0 {
        return code as c_int;
    }
    let Ok(code) = u16::try_from(code) else {
        return uv::UV_UNKNOWN;
    };
    e_to_uv(Win32Error(code).to_e() as u16).unwrap_or(uv::UV_UNKNOWN)
}

/// `__uv_e_rows!` sink: the rows as `(errno, UV_E*)` pairs.
#[macro_export]
#[doc(hidden)]
macro_rules! __decl_uv_pairs {
    ( $( $ident:ident = $pair:expr => $display:literal ),+ $(,)? ) => {
        static UV_PAIRS: &[(SystemErrno, c_int)] = &[
            $( $pair, )+
            (SystemErrno::EOF, uv::UV_EOF),
            (SystemErrno::EUNKNOWN, uv::UV_UNKNOWN),
        ];
    };
}
macro_rules! __pair {
    ($i:tt, $e:tt, $uv:tt) => {
        (SystemErrno::$e, uv::$uv)
    };
}
crate::__uv_e_rows!(__pair => __decl_uv_pairs);

/// A `SystemErrno` discriminant → the negative `UV_E*` number Node reports for
/// it in `err.errno` on Windows (`2` → `UV_ENOENT`, -4058).
pub fn e_to_uv(errno: u16) -> Option<c_int> {
    UV_PAIRS
        .iter()
        .find(|(e, _)| *e as u16 == errno)
        .map(|&(_, uv)| uv)
}

/// The reverse of [`e_to_uv`].
pub fn uv_to_e(code: c_int) -> Option<E> {
    UV_PAIRS.iter().find(|(_, uv)| *uv == code).map(|&(e, _)| e)
}

// ──────────────────────────────────────────────────────────────────────────
// UV_E
// ──────────────────────────────────────────────────────────────────────────

pub mod uv_e {
    // Windows has no native errno for any of these — every value is the
    // libuv-synthetic `-UV_E*` constant.
    macro_rules! __v {
        ($i:tt, $e:tt, $uv:tt) => {
            -$crate::uv_codes::$uv
        };
    }
    crate::__uv_e_rows!(__v);
}

// ──────────────────────────────────────────────────────────────────────────
// `windows` — `Win32Error` / `NTSTATUS` mappings that need `SystemErrno`.
// ──────────────────────────────────────────────────────────────────────────
pub mod windows {
    use super::{E, SystemErrno};

    /// `enum(u16) Win32Error` — newtype over `GetLastError()` (see `Win32Error::get`).
    /// Re-exported from the tier-0 `bun_windows_sys` leaf crate (no cycle:
    /// that crate has zero workspace deps), so this module and
    /// `bun_sys::windows` share one nominal type.
    pub use bun_windows_sys::Win32Error;

    /// `NTSTATUS` — `enum(u32) { …, _ }`. Same provenance as `Win32Error`.
    pub use bun_windows_sys::NTSTATUS;

    /// Extension trait for the `Win32Error` → `E` mapping.
    /// `bun_windows_sys` is tier-0 and cannot name `SystemErrno`, so the
    /// mapping surfaces here as an extension method instead.
    pub trait Win32ErrorExt: Copy {
        /// The errno for a failed call whose `GetLastError()` is `self`: its row
        /// in the Win32→errno table (`init_win32_error`), else `EUNKNOWN` —
        /// including `SUCCESS`, a failure that set no code. Compare against
        /// `Win32Error::SUCCESS` first when the call may have succeeded.
        fn to_e(self) -> E;
    }
    impl Win32ErrorExt for Win32Error {
        #[inline]
        fn to_e(self) -> E {
            SystemErrno::init_win32_error(self).unwrap_or(SystemErrno::EUNKNOWN)
        }
    }

    /// Moved DOWN so `bun_errno` owns the only NTSTATUS→`E` mapping (cycle-break).
    pub fn translate_ntstatus_to_errno(err: NTSTATUS) -> E {
        match err {
            NTSTATUS::SUCCESS => E::SUCCESS,
            NTSTATUS::ACCESS_DENIED => E::EPERM,
            NTSTATUS::INVALID_HANDLE => E::EBADF,
            NTSTATUS::INVALID_PARAMETER => E::EINVAL,
            NTSTATUS::OBJECT_NAME_COLLISION => E::EEXIST,
            NTSTATUS::FILE_IS_A_DIRECTORY => E::EISDIR,
            NTSTATUS::OBJECT_PATH_NOT_FOUND | NTSTATUS::OBJECT_NAME_NOT_FOUND => E::ENOENT,
            NTSTATUS::NOT_A_DIRECTORY => E::ENOTDIR,
            NTSTATUS::RETRY => E::EAGAIN,
            NTSTATUS::DIRECTORY_NOT_EMPTY => E::ENOTEMPTY,
            NTSTATUS::FILE_TOO_LARGE => E::E2BIG,
            NTSTATUS::NOT_SAME_DEVICE => E::EXDEV,
            NTSTATUS::DELETE_PENDING => E::EBUSY,
            NTSTATUS::SHARING_VIOLATION => E::EBUSY,
            NTSTATUS::OBJECT_NAME_INVALID => E::EINVAL,
            NTSTATUS::CANNOT_DELETE => E::EPERM,
            // Any other error status: ask ntdll for the equivalent Win32 error
            // and run it through the same libuv-derived table Node.js uses.
            // Filter drivers and cloud-sync placeholders return many NTSTATUS
            // codes that are not enumerated above; without this fallthrough
            // they would all surface as `UNKNOWN`. Codes `RtlNtStatusToDosError`
            // cannot map still fall back to `E::EUNKNOWN` via `to_e()`.
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
                E::EISDIR => E::ENOTSUP,
                e => e,
            },
        }
    }
}

// `Win32Error::to_e` is provided via `windows::Win32ErrorExt`
// (extension trait — `Win32Error` is now a foreign type from `bun_windows_sys`).
