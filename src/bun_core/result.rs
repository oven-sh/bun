// ─── bun_core::Error — Zig `anyerror` port ────────────────────────────────
//
// Zig's `anyerror` is a global error set: every distinct `error.Foo` name in
// the program is assigned a unique non-zero u16 at link time, `@intFromError`
// returns that code, `@errorName` recovers the string, and two `error.Foo`s
// from different modules compare equal because the *name* is the identity.
//
// Rust has no link-time global enum, so we intern at runtime: a process-wide
// append-only `&'static str` table guarded by an RwLock. The `err!()` macro
// caches each call-site's code in a `OnceLock`, so the lock is touched once
// per *name-site*, not once per call — matching Zig's zero-cost comparison
// (`e == err!(Foo)` is a u16 compare after first use).
//
// Layout is `#[repr(transparent)] NonZeroU16`, so `Option<Error>` is one u16
// and FFI/packed-struct slots that held a Zig `anyerror` keep the same width.

use core::fmt;
use core::num::NonZeroU16;
use parking_lot::RwLock;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Error(NonZeroU16);

// ── intern table ──────────────────────────────────────────────────────────
//
// Codes `1..=SEED.len()` index `SEED`; codes above that index the dynamic
// `EXTRA` vec at `code - SEED.len() - 1`. SEED is frozen so the handful of
// `pub const` Errors below have stable values without touching the lock.

/// Pre-seeded names. **Append only** — existing indices are load-bearing for
/// the `pub const` Errors below. (The errno→name map lives in the per-platform
/// `SYSTEM_ERRNO_NAMES` table; entries here are only fast-path intern hits.)
const SEED: &[&str] = &[
    // — well-known Zig error-set members the runtime matches on by value —
    "Unexpected",       // 1  (Zig's catch-all; also `errno_map` default)
    "OutOfMemory",      // 2
    "EndOfStream",      // 3
    "StreamTooLong",    // 4
    "NoSpaceLeft",      // 5
    "WriteFailed",      // 6
    "Overflow",         // 7
    "InvalidArgument",  // 8
    "Timeout",          // 9
    "Aborted",          // 10
    "WouldBlock",       // 11
    // — POSIX errno tag names (intern fast-path only; the actual errno→name
    //   mapping is `SYSTEM_ERRNO_NAMES`, which is per-platform and full-range) —
    "EPERM",   // 12
    "ENOENT",  // 13
    "ESRCH",   // 14
    "EINTR",   // 15
    "EIO",     // 16
    "ENXIO",   // 17
    "E2BIG",   // 18
    "ENOEXEC", // 19
    "EBADF",   // 20
    "ECHILD",  // 21
    "EAGAIN",  // 22
    "ENOMEM",  // 23
    "EACCES",  // 24
    "EFAULT",  // 25
    "ENOTBLK", // 26
    "EBUSY",   // 27
    "EEXIST",  // 28
    "EXDEV",   // 29
    "ENODEV",  // 30
    "ENOTDIR", // 31
    "EISDIR",  // 32
    "EINVAL",  // 33
    "ENFILE",  // 34
    "EMFILE",  // 35
    "ENOTTY",  // 36
    "ETXTBSY", // 37
    "EFBIG",   // 38
    "ENOSPC",  // 39
    "ESPIPE",  // 40
    "EROFS",   // 41
    "EMLINK",  // 42
    "EPIPE",   // 43
    "EDOM",    // 44
    "ERANGE",  // 45
];

// ── per-platform errno → tag-name table ───────────────────────────────────
//
// Mirrors the comptime `for (std.enums.values(sys.SystemErrno))` loop in
// bun.zig:2841-2851. Index = raw OS errno; value = `@tagName(SystemErrno)`.
// Index 0 ("SUCCESS") is the no-error hole. These tables are duplicated from
// `bun_errno`'s per-platform `SystemErrno` enums because `bun_errno` depends
// on `bun_core` (cycle); keep in lockstep with `src/errno/*_errno.rs`.

#[cfg(any(target_os = "linux", target_family = "wasm"))]
pub(crate) const SYSTEM_ERRNO_NAMES: &[&str] = &[
    "SUCCESS", "EPERM", "ENOENT", "ESRCH", "EINTR", "EIO", "ENXIO", "E2BIG", "ENOEXEC", "EBADF",
    "ECHILD", "EAGAIN", "ENOMEM", "EACCES", "EFAULT", "ENOTBLK", "EBUSY", "EEXIST", "EXDEV",
    "ENODEV", "ENOTDIR", "EISDIR", "EINVAL", "ENFILE", "EMFILE", "ENOTTY", "ETXTBSY", "EFBIG",
    "ENOSPC", "ESPIPE", "EROFS", "EMLINK", "EPIPE", "EDOM", "ERANGE", "EDEADLK", "ENAMETOOLONG",
    "ENOLCK", "ENOSYS", "ENOTEMPTY", "ELOOP", "EWOULDBLOCK", "ENOMSG", "EIDRM", "ECHRNG",
    "EL2NSYNC", "EL3HLT", "EL3RST", "ELNRNG", "EUNATCH", "ENOCSI", "EL2HLT", "EBADE", "EBADR",
    "EXFULL", "ENOANO", "EBADRQC", "EBADSLT", "EDEADLOCK", "EBFONT", "ENOSTR", "ENODATA", "ETIME",
    "ENOSR", "ENONET", "ENOPKG", "EREMOTE", "ENOLINK", "EADV", "ESRMNT", "ECOMM", "EPROTO",
    "EMULTIHOP", "EDOTDOT", "EBADMSG", "EOVERFLOW", "ENOTUNIQ", "EBADFD", "EREMCHG", "ELIBACC",
    "ELIBBAD", "ELIBSCN", "ELIBMAX", "ELIBEXEC", "EILSEQ", "ERESTART", "ESTRPIPE", "EUSERS",
    "ENOTSOCK", "EDESTADDRREQ", "EMSGSIZE", "EPROTOTYPE", "ENOPROTOOPT", "EPROTONOSUPPORT",
    "ESOCKTNOSUPPORT", "ENOTSUP", "EPFNOSUPPORT", "EAFNOSUPPORT", "EADDRINUSE", "EADDRNOTAVAIL",
    "ENETDOWN", "ENETUNREACH", "ENETRESET", "ECONNABORTED", "ECONNRESET", "ENOBUFS", "EISCONN",
    "ENOTCONN", "ESHUTDOWN", "ETOOMANYREFS", "ETIMEDOUT", "ECONNREFUSED", "EHOSTDOWN",
    "EHOSTUNREACH", "EALREADY", "EINPROGRESS", "ESTALE", "EUCLEAN", "ENOTNAM", "ENAVAIL", "EISNAM",
    "EREMOTEIO", "EDQUOT", "ENOMEDIUM", "EMEDIUMTYPE", "ECANCELED", "ENOKEY", "EKEYEXPIRED",
    "EKEYREVOKED", "EKEYREJECTED", "EOWNERDEAD", "ENOTRECOVERABLE", "ERFKILL", "EHWPOISON",
];

#[cfg(windows)]
pub(crate) const SYSTEM_ERRNO_NAMES: &[&str] = &[
    "SUCCESS", "EPERM", "ENOENT", "ESRCH", "EINTR", "EIO", "ENXIO", "E2BIG", "ENOEXEC", "EBADF",
    "ECHILD", "EAGAIN", "ENOMEM", "EACCES", "EFAULT", "ENOTBLK", "EBUSY", "EEXIST", "EXDEV",
    "ENODEV", "ENOTDIR", "EISDIR", "EINVAL", "ENFILE", "EMFILE", "ENOTTY", "ETXTBSY", "EFBIG",
    "ENOSPC", "ESPIPE", "EROFS", "EMLINK", "EPIPE", "EDOM", "ERANGE", "EDEADLK", "ENAMETOOLONG",
    "ENOLCK", "ENOSYS", "ENOTEMPTY", "ELOOP", "EWOULDBLOCK", "ENOMSG", "EIDRM", "ECHRNG",
    "EL2NSYNC", "EL3HLT", "EL3RST", "ELNRNG", "EUNATCH", "ENOCSI", "EL2HLT", "EBADE", "EBADR",
    "EXFULL", "ENOANO", "EBADRQC", "EBADSLT", "EDEADLOCK", "EBFONT", "ENOSTR", "ENODATA", "ETIME",
    "ENOSR", "ENONET", "ENOPKG", "EREMOTE", "ENOLINK", "EADV", "ESRMNT", "ECOMM", "EPROTO",
    "EMULTIHOP", "EDOTDOT", "EBADMSG", "EOVERFLOW", "ENOTUNIQ", "EBADFD", "EREMCHG", "ELIBACC",
    "ELIBBAD", "ELIBSCN", "ELIBMAX", "ELIBEXEC", "EILSEQ", "ERESTART", "ESTRPIPE", "EUSERS",
    "ENOTSOCK", "EDESTADDRREQ", "EMSGSIZE", "EPROTOTYPE", "ENOPROTOOPT", "EPROTONOSUPPORT",
    "ESOCKTNOSUPPORT", "ENOTSUP", "EPFNOSUPPORT", "EAFNOSUPPORT", "EADDRINUSE", "EADDRNOTAVAIL",
    "ENETDOWN", "ENETUNREACH", "ENETRESET", "ECONNABORTED", "ECONNRESET", "ENOBUFS", "EISCONN",
    "ENOTCONN", "ESHUTDOWN", "ETOOMANYREFS", "ETIMEDOUT", "ECONNREFUSED", "EHOSTDOWN",
    "EHOSTUNREACH", "EALREADY", "EINPROGRESS", "ESTALE", "EUCLEAN", "ENOTNAM", "ENAVAIL", "EISNAM",
    "EREMOTEIO", "EDQUOT", "ENOMEDIUM", "EMEDIUMTYPE", "ECANCELED", "ENOKEY", "EKEYEXPIRED",
    "EKEYREVOKED", "EKEYREJECTED", "EOWNERDEAD", "ENOTRECOVERABLE", "ERFKILL", "EHWPOISON",
    "EUNKNOWN", "ECHARSET", "EOF", "EFTYPE",
    // The sparse UV_* range (negated libuv codes) is handled out-of-line by
    // `uv_errno_name` below — the dense table stops at EFTYPE=137.
];

/// Sparse half of the Windows `SystemErrno` enum: discriminant `-uv.UV_*` →
/// `@tagName`. Mirrors windows_errno.zig:445-530; values are the Windows-side
/// `UV__*` constants from vendor/libuv/include/uv/errno.h (the `!defined(_WIN32)`
/// fallback arm). Consulted by `from_errno`/`system_errno_name` when `n` falls
/// outside the dense 0..=137 table, so the Zig `errno_map[@abs(uv_code)]`
/// lookup (bun.zig:2841-2851) round-trips on Windows too.
#[cfg(windows)]
fn uv_errno_name(n: u32) -> Option<&'static str> {
    Some(match n {
        4093 => "UV_E2BIG",
        4092 => "UV_EACCES",
        4091 => "UV_EADDRINUSE",
        4090 => "UV_EADDRNOTAVAIL",
        4089 => "UV_EAFNOSUPPORT",
        4088 => "UV_EAGAIN",
        3000 => "UV_EAI_ADDRFAMILY",
        3001 => "UV_EAI_AGAIN",
        3002 => "UV_EAI_BADFLAGS",
        3013 => "UV_EAI_BADHINTS",
        3003 => "UV_EAI_CANCELED",
        3004 => "UV_EAI_FAIL",
        3005 => "UV_EAI_FAMILY",
        3006 => "UV_EAI_MEMORY",
        3007 => "UV_EAI_NODATA",
        3008 => "UV_EAI_NONAME",
        3009 => "UV_EAI_OVERFLOW",
        3014 => "UV_EAI_PROTOCOL",
        3010 => "UV_EAI_SERVICE",
        3011 => "UV_EAI_SOCKTYPE",
        4084 => "UV_EALREADY",
        4083 => "UV_EBADF",
        4082 => "UV_EBUSY",
        4081 => "UV_ECANCELED",
        4080 => "UV_ECHARSET",
        4079 => "UV_ECONNABORTED",
        4078 => "UV_ECONNREFUSED",
        4077 => "UV_ECONNRESET",
        4076 => "UV_EDESTADDRREQ",
        4075 => "UV_EEXIST",
        4074 => "UV_EFAULT",
        4036 => "UV_EFBIG",
        4073 => "UV_EHOSTUNREACH",
        4071 => "UV_EINVAL",
        4072 => "UV_EINTR",
        4069 => "UV_EISCONN",
        4070 => "UV_EIO",
        4067 => "UV_ELOOP",
        4068 => "UV_EISDIR",
        4065 => "UV_EMSGSIZE",
        4066 => "UV_EMFILE",
        4063 => "UV_ENETDOWN",
        4064 => "UV_ENAMETOOLONG",
        4061 => "UV_ENFILE",
        4062 => "UV_ENETUNREACH",
        4059 => "UV_ENODEV",
        4060 => "UV_ENOBUFS",
        4057 => "UV_ENOMEM",
        4058 => "UV_ENOENT",
        4035 => "UV_ENOPROTOOPT",
        4056 => "UV_ENONET",
        4054 => "UV_ENOSYS",
        4055 => "UV_ENOSPC",
        4052 => "UV_ENOTDIR",
        4053 => "UV_ENOTCONN",
        4050 => "UV_ENOTSOCK",
        4051 => "UV_ENOTEMPTY",
        4026 => "UV_EOVERFLOW",
        4049 => "UV_ENOTSUP",
        4047 => "UV_EPIPE",
        4048 => "UV_EPERM",
        4045 => "UV_EPROTONOSUPPORT",
        4046 => "UV_EPROTO",
        4034 => "UV_ERANGE",
        4044 => "UV_EPROTOTYPE",
        4042 => "UV_ESHUTDOWN",
        4043 => "UV_EROFS",
        4040 => "UV_ESRCH",
        4041 => "UV_ESPIPE",
        4038 => "UV_ETXTBSY",
        4039 => "UV_ETIMEDOUT",
        4094 => "UV_UNKNOWN",
        4037 => "UV_EXDEV",
        4033 => "UV_ENXIO",
        4095 => "UV_EOF",
        4031 => "UV_EHOSTDOWN",
        4032 => "UV_EMLINK",
        4029 => "UV_ENOTTY",
        4030 => "UV_EREMOTEIO",
        4027 => "UV_EILSEQ",
        4028 => "UV_EFTYPE",
        4024 => "UV_ENODATA",
        4025 => "UV_ESOCKTNOSUPPORT",
        4096 => "UV_ERRNO_MAX",
        4023 => "UV_EUNATCH",
        4022 => "UV_ENOEXEC",
        _ => return None,
    })
}

#[cfg(target_os = "macos")]
pub(crate) const SYSTEM_ERRNO_NAMES: &[&str] = &[
    "SUCCESS", "EPERM", "ENOENT", "ESRCH", "EINTR", "EIO", "ENXIO", "E2BIG", "ENOEXEC", "EBADF",
    "ECHILD", "EDEADLK", "ENOMEM", "EACCES", "EFAULT", "ENOTBLK", "EBUSY", "EEXIST", "EXDEV",
    "ENODEV", "ENOTDIR", "EISDIR", "EINVAL", "ENFILE", "EMFILE", "ENOTTY", "ETXTBSY", "EFBIG",
    "ENOSPC", "ESPIPE", "EROFS", "EMLINK", "EPIPE", "EDOM", "ERANGE", "EAGAIN", "EINPROGRESS",
    "EALREADY", "ENOTSOCK", "EDESTADDRREQ", "EMSGSIZE", "EPROTOTYPE", "ENOPROTOOPT",
    "EPROTONOSUPPORT", "ESOCKTNOSUPPORT", "ENOTSUP", "EPFNOSUPPORT", "EAFNOSUPPORT", "EADDRINUSE",
    "EADDRNOTAVAIL", "ENETDOWN", "ENETUNREACH", "ENETRESET", "ECONNABORTED", "ECONNRESET",
    "ENOBUFS", "EISCONN", "ENOTCONN", "ESHUTDOWN", "ETOOMANYREFS", "ETIMEDOUT", "ECONNREFUSED",
    "ELOOP", "ENAMETOOLONG", "EHOSTDOWN", "EHOSTUNREACH", "ENOTEMPTY", "EPROCLIM", "EUSERS",
    "EDQUOT", "ESTALE", "EREMOTE", "EBADRPC", "ERPCMISMATCH", "EPROGUNAVAIL", "EPROGMISMATCH",
    "EPROCUNAVAIL", "ENOLCK", "ENOSYS", "EFTYPE", "EAUTH", "ENEEDAUTH", "EPWROFF", "EDEVERR",
    "EOVERFLOW", "EBADEXEC", "EBADARCH", "ESHLIBVERS", "EBADMACHO", "ECANCELED", "EIDRM", "ENOMSG",
    "EILSEQ", "ENOATTR", "EBADMSG", "EMULTIHOP", "ENODATA", "ENOLINK", "ENOSR", "ENOSTR", "EPROTO",
    "ETIME", "EOPNOTSUPP", "ENOPOLICY", "ENOTRECOVERABLE", "EOWNERDEAD", "EQFULL",
];

#[cfg(target_os = "freebsd")]
pub(crate) const SYSTEM_ERRNO_NAMES: &[&str] = &[
    "SUCCESS", "EPERM", "ENOENT", "ESRCH", "EINTR", "EIO", "ENXIO", "E2BIG", "ENOEXEC", "EBADF",
    "ECHILD", "EDEADLK", "ENOMEM", "EACCES", "EFAULT", "ENOTBLK", "EBUSY", "EEXIST", "EXDEV",
    "ENODEV", "ENOTDIR", "EISDIR", "EINVAL", "ENFILE", "EMFILE", "ENOTTY", "ETXTBSY", "EFBIG",
    "ENOSPC", "ESPIPE", "EROFS", "EMLINK", "EPIPE", "EDOM", "ERANGE", "EAGAIN", "EINPROGRESS",
    "EALREADY", "ENOTSOCK", "EDESTADDRREQ", "EMSGSIZE", "EPROTOTYPE", "ENOPROTOOPT",
    "EPROTONOSUPPORT", "ESOCKTNOSUPPORT", "EOPNOTSUPP", "EPFNOSUPPORT", "EAFNOSUPPORT",
    "EADDRINUSE", "EADDRNOTAVAIL", "ENETDOWN", "ENETUNREACH", "ENETRESET", "ECONNABORTED",
    "ECONNRESET", "ENOBUFS", "EISCONN", "ENOTCONN", "ESHUTDOWN", "ETOOMANYREFS", "ETIMEDOUT",
    "ECONNREFUSED", "ELOOP", "ENAMETOOLONG", "EHOSTDOWN", "EHOSTUNREACH", "ENOTEMPTY", "EPROCLIM",
    "EUSERS", "EDQUOT", "ESTALE", "EREMOTE", "EBADRPC", "ERPCMISMATCH", "EPROGUNAVAIL",
    "EPROGMISMATCH", "EPROCUNAVAIL", "ENOLCK", "ENOSYS", "EFTYPE", "EAUTH", "ENEEDAUTH", "EIDRM",
    "ENOMSG", "EOVERFLOW", "ECANCELED", "EILSEQ", "ENOATTR", "EDOOFUS", "EBADMSG", "EMULTIHOP",
    "ENOLINK", "EPROTO", "ENOTCAPABLE", "ECAPMODE", "ENOTRECOVERABLE", "EOWNERDEAD", "EINTEGRITY",
];

// Lock each table's length to the Zig `SystemErrno` enum's cardinality
// (`src/errno/*_errno.zig`). A mismatch here means the duplicated table has
// drifted from its source of truth — fix the table, not the assertion.
#[cfg(any(target_os = "linux", target_family = "wasm"))]
const _: () = assert!(SYSTEM_ERRNO_NAMES.len() == 134); // linux_errno.zig: 0..=EHWPOISON(133)
#[cfg(windows)]
const _: () = assert!(SYSTEM_ERRNO_NAMES.len() == 138); // windows_errno.zig: 0..=EFTYPE(137); UV_* sparse range in `uv_errno_name`
#[cfg(target_os = "macos")]
const _: () = assert!(SYSTEM_ERRNO_NAMES.len() == 107); // darwin_errno.zig: 0..=EQFULL(106)
#[cfg(target_os = "freebsd")]
const _: () = assert!(SYSTEM_ERRNO_NAMES.len() == 98); // freebsd_errno.zig: 0..=EINTEGRITY(97)

/// Platform errno integer → its `SystemErrno` tag name. `None` for 0/out-of-range.
#[inline]
pub(crate) fn system_errno_name(errno: i32) -> Option<&'static str> {
    let n = if cfg!(windows) { errno.unsigned_abs() } else {
        if errno <= 0 { return None; }
        errno as u32
    };
    match SYSTEM_ERRNO_NAMES.get(n as usize) {
        Some(&name) if n != 0 => Some(name),
        #[cfg(windows)]
        _ => uv_errno_name(n),
        #[cfg(not(windows))]
        _ => None,
    }
}

/// Dynamically interned names (codes `> SEED.len()`). Append-only; never
/// shrinks, never reorders, so a code handed out stays valid for the process.
static EXTRA: RwLock<Vec<&'static str>> = RwLock::new(Vec::new());

#[cold]
fn intern_slow(name: &'static str) -> NonZeroU16 {
    // Re-check SEED under no lock (callers may skip the fast path).
    if let Some(i) = SEED.iter().position(|&s| s == name) {
        // SAFETY: i + 1 ∈ 1..=SEED.len() ⊂ 1..=u16::MAX.
        return unsafe { NonZeroU16::new_unchecked((i + 1) as u16) };
    }
    let mut extra = EXTRA.write();
    // Double-checked: another thread may have inserted while we waited.
    if let Some(i) = extra.iter().position(|&s| s == name) {
        return unsafe { NonZeroU16::new_unchecked((SEED.len() + 1 + i) as u16) };
    }
    extra.push(name);
    let code = SEED.len() + extra.len();
    debug_assert!(code <= u16::MAX as usize, "error intern table overflow");
    // SAFETY: SEED.len() ≥ 1 and extra.len() ≥ 1 ⇒ code ≥ 2.
    unsafe { NonZeroU16::new_unchecked(code as u16) }
}

impl Error {
    // ── const handles into SEED (indices are load-bearing) ────────────────
    pub const UNEXPECTED: Self = Self(unsafe { NonZeroU16::new_unchecked(1) });
    pub const OUT_OF_MEMORY: Self = Self(unsafe { NonZeroU16::new_unchecked(2) });
    pub const WRITE_FAILED: Self = Self(unsafe { NonZeroU16::new_unchecked(6) });
    /// Phase-A placeholder retained for callers not yet migrated to `err!()`.
    /// Aliases `Unexpected` so it round-trips through `name()` sensibly.
    pub const TODO: Self = Self::UNEXPECTED;

    /// Intern `name`, returning its process-unique code. Idempotent: the same
    /// string (by value) always yields the same `Error`. This is the runtime
    /// half of Zig's link-time `anyerror` assignment.
    pub fn intern(name: &'static str) -> Self {
        // Fast path: SEED hit (covers all errno + common names) without locking.
        if let Some(i) = SEED.iter().position(|&s| s == name) {
            // SAFETY: see intern_slow.
            return Self(unsafe { NonZeroU16::new_unchecked((i + 1) as u16) });
        }
        // Read-locked probe of already-interned extras.
        {
            let extra = EXTRA.read();
            if let Some(i) = extra.iter().position(|&s| s == name) {
                return Self(unsafe { NonZeroU16::new_unchecked((SEED.len() + 1 + i) as u16) });
            }
        }
        Self(intern_slow(name))
    }

    /// Alias for [`intern`]; kept for `err!(from e)` and Phase-A call sites.
    #[inline]
    pub fn from_name(name: &'static str) -> Self { Self::intern(name) }

    /// Zig: `@errorName(e)`. Never allocates; the table only stores `'static`.
    pub fn name(self) -> &'static str {
        let code = self.0.get() as usize;
        if code <= SEED.len() {
            return SEED[code - 1];
        }
        let extra = EXTRA.read();
        extra
            .get(code - SEED.len() - 1)
            .copied()
            .unwrap_or("Unexpected")
    }

    /// Zig: `@intFromError(e)`.
    #[inline]
    pub const fn as_u16(self) -> u16 { self.0.get() }

    /// Zig: `@errorFromInt(n)`. `0` (the "no error" value Zig forbids) maps to
    /// `Unexpected` rather than panicking, since callers feed untrusted ints.
    #[inline]
    pub const fn from_raw(code: u16) -> Self {
        match NonZeroU16::new(code) {
            Some(nz) => Self(nz),
            None => Self::UNEXPECTED,
        }
    }

    /// Port of `bun.errnoToZigErr`: map a raw OS errno to its named error.
    /// Unknown errnos collapse to `Unexpected` (matching the Zig `@memset`).
    pub fn from_errno(errno: i32) -> Self {
        // Zig builds `errno_map: [max+1]anyerror` at comptime (bun.zig:2841);
        // we build the equivalent once at first use by interning every
        // platform `SystemErrno` tag name. After init, lookup is a plain
        // bounds-checked array index — same cost as the Zig version.
        static ERRNO_MAP: std::sync::OnceLock<Box<[Error]>> = std::sync::OnceLock::new();
        let map = ERRNO_MAP.get_or_init(|| {
            SYSTEM_ERRNO_NAMES
                .iter()
                .map(|&name| {
                    // Index 0 ("SUCCESS") is the no-error hole → Unexpected,
                    // matching the Zig `@memset(&map, error.Unexpected)`.
                    if name == "SUCCESS" { Error::UNEXPECTED } else { Error::intern(name) }
                })
                .collect()
        });

        // Windows libuv errnos are negative; normalise like the Zig original.
        let n = if cfg!(windows) { errno.unsigned_abs() } else {
            if errno <= 0 { return Self::UNEXPECTED; }
            errno as u32
        };
        if let Some(&e) = map.get(n as usize) {
            return e;
        }
        // Windows: fall through to the sparse UV_* range (3000..=4096) so e.g.
        // `from_errno(-4058)` → `error.UV_ENOENT`, matching Zig's full-width
        // `errno_map` (bun.zig:2841-2851 sizes it to `max(@intFromEnum)+1`).
        #[cfg(windows)]
        if let Some(name) = uv_errno_name(n) {
            return Self::intern(name);
        }
        Self::UNEXPECTED
    }
}

impl fmt::Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "error.{}", self.name())
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        match e.raw_os_error() {
            // POSIX: `raw_os_error()` is already a C `errno`, i.e. a
            // `SystemErrno`-domain integer — feed it straight through.
            #[cfg(not(windows))]
            Some(code) => Self::from_errno(code),
            // Windows: `raw_os_error()` returns the raw Win32 `GetLastError()`
            // code (ERROR_ACCESS_DENIED=5, ERROR_SHARING_VIOLATION=32, …),
            // NOT a `SystemErrno`. Indexing `SYSTEM_ERRNO_NAMES` by it would
            // alias garbage (5→EIO, 32→EPIPE). The Zig pipeline first runs
            // `Win32Error.toSystemErrno()` (windows_errno.zig:290) before any
            // `errno_map` lookup; that table lives in `bun_errno`, which is
            // tier-above `bun_core` (dep cycle), so we can't call it here.
            // Fall back to `Unexpected` rather than return a wrong name.
            // TODO(port): plumb a Win32→SystemErrno hook (or duplicate the
            // table) so `?`-propagated `io::Error`s name correctly on Windows.
            #[cfg(windows)]
            Some(_code) => Self::UNEXPECTED,
            None => Self::UNEXPECTED,
        }
    }
}
impl From<bun_alloc::AllocError> for Error {
    fn from(_: bun_alloc::AllocError) -> Self { Self::OUT_OF_MEMORY }
}

// ─── coreutils_error_map ─────────────────────────────────────────────────
// Zig builds a comptime `EnumMap<SystemErrno, []const u8>` with a per-OS
// `switch (Environment.os)` body (src/sys/coreutils_error_map.zig). The full
// EnumMap lives in `bun_sys::coreutils_error_map`; that crate is tier-above
// `bun_core`, so for `output.rs`'s integer-errno hot path we keep a parallel
// table here, keyed by `SystemErrno` *name* and resolved through the per-OS
// `SYSTEM_ERRNO_NAMES` index — i.e. the same `errno → SystemErrno → message`
// composition the Zig does, just without the cross-crate enum.
pub mod coreutils_error_map {
    /// Returns the GNU-coreutils-style short label for an errno, if known.
    #[inline]
    pub fn get(errno: i32) -> Option<&'static str> {
        super::system_errno_name(errno).and_then(|name| MESSAGES.get(name).copied())
    }

    // macOS and Linux have slightly different error messages.
    // Since windows is just an emulation of linux, it derives the linux messages.
    #[cfg(any(target_os = "linux", windows, target_family = "wasm"))]
    static MESSAGES: phf::Map<&'static str, &'static str> = phf::phf_map! {
        "EPERM" => "Operation not permitted",
        "ENOENT" => "No such file or directory",
        "ESRCH" => "No such process",
        "EINTR" => "Interrupted system call",
        "EIO" => "Input/output error",
        "ENXIO" => "No such device or address",
        "E2BIG" => "Argument list too long",
        "ENOEXEC" => "Exec format error",
        "EBADF" => "Bad file descriptor",
        "ECHILD" => "No child processes",
        "EAGAIN" => "Resource temporarily unavailable",
        "ENOMEM" => "Cannot allocate memory",
        "EACCES" => "Permission denied",
        "EFAULT" => "Bad address",
        "ENOTBLK" => "Block device required",
        "EBUSY" => "Device or resource busy",
        "EEXIST" => "File exists",
        "EXDEV" => "Invalid cross-device link",
        "ENODEV" => "No such device",
        "ENOTDIR" => "Not a directory",
        "EISDIR" => "Is a directory",
        "EINVAL" => "Invalid argument",
        "ENFILE" => "Too many open files in system",
        "EMFILE" => "Too many open files",
        "ENOTTY" => "Inappropriate ioctl for device",
        "ETXTBSY" => "Text file busy",
        "EFBIG" => "File too large",
        "ENOSPC" => "No space left on device",
        "ESPIPE" => "Illegal seek",
        "EROFS" => "Read-only file system",
        "EMLINK" => "Too many links",
        "EPIPE" => "Broken pipe",
        "EDOM" => "Numerical argument out of domain",
        "ERANGE" => "Numerical result out of range",
        "EDEADLK" => "Resource deadlock avoided",
        "ENAMETOOLONG" => "File name too long",
        "ENOLCK" => "No locks available",
        "ENOSYS" => "Function not implemented",
        "ENOTEMPTY" => "Directory not empty",
        "ELOOP" => "Too many levels of symbolic links",
        "ENOMSG" => "No message of desired type",
        "EIDRM" => "Identifier removed",
        "ECHRNG" => "Channel number out of range",
        "EL2NSYNC" => "Level 2 not synchronized",
        "EL3HLT" => "Level 3 halted",
        "EL3RST" => "Level 3 reset",
        "ELNRNG" => "Link number out of range",
        "EUNATCH" => "Protocol driver not attached",
        "ENOCSI" => "No CSI structure available",
        "EL2HLT" => "Level 2 halted",
        "EBADE" => "Invalid exchange",
        "EBADR" => "Invalid request descriptor",
        "EXFULL" => "Exchange full",
        "ENOANO" => "No anode",
        "EBADRQC" => "Invalid request code",
        "EBADSLT" => "Invalid slot",
        "EBFONT" => "Bad font file format",
        "ENOSTR" => "Device not a stream",
        "ENODATA" => "No data available",
        "ETIME" => "Timer expired",
        "ENOSR" => "Out of streams resources",
        "ENONET" => "Machine is not on the network",
        "ENOPKG" => "Package not installed",
        "EREMOTE" => "Object is remote",
        "ENOLINK" => "Link has been severed",
        "EADV" => "Advertise error",
        "ESRMNT" => "Srmount error",
        "ECOMM" => "Communication error on send",
        "EPROTO" => "Protocol error",
        "EMULTIHOP" => "Multihop attempted",
        "EDOTDOT" => "RFS specific error",
        "EBADMSG" => "Bad message",
        "EOVERFLOW" => "Value too large for defined data type",
        "ENOTUNIQ" => "Name not unique on network",
        "EBADFD" => "File descriptor in bad state",
        "EREMCHG" => "Remote address changed",
        "ELIBACC" => "Can not access a needed shared library",
        "ELIBBAD" => "Accessing a corrupted shared library",
        "ELIBSCN" => ".lib section in a.out corrupted",
        "ELIBMAX" => "Attempting to link in too many shared libraries",
        "ELIBEXEC" => "Cannot exec a shared library directly",
        "EILSEQ" => "Invalid or incomplete multibyte or wide character",
        "ERESTART" => "Interrupted system call should be restarted",
        "ESTRPIPE" => "Streams pipe error",
        "EUSERS" => "Too many users",
        "ENOTSOCK" => "Socket operation on non-socket",
        "EDESTADDRREQ" => "Destination address required",
        "EMSGSIZE" => "Message too long",
        "EPROTOTYPE" => "Protocol wrong type for socket",
        "ENOPROTOOPT" => "Protocol not available",
        "EPROTONOSUPPORT" => "Protocol not supported",
        "ESOCKTNOSUPPORT" => "Socket type not supported",
        "EOPNOTSUPP" => "Operation not supported",
        "EPFNOSUPPORT" => "Protocol family not supported",
        "EAFNOSUPPORT" => "Address family not supported by protocol",
        "EADDRINUSE" => "Address already in use",
        "EADDRNOTAVAIL" => "Cannot assign requested address",
        "ENETDOWN" => "Network is down",
        "ENETUNREACH" => "Network is unreachable",
        "ENETRESET" => "Network dropped connection on reset",
        "ECONNABORTED" => "Software caused connection abort",
        "ECONNRESET" => "Connection reset by peer",
        "ENOBUFS" => "No buffer space available",
        "EISCONN" => "Transport endpoint is already connected",
        "ENOTCONN" => "Transport endpoint is not connected",
        "ESHUTDOWN" => "Cannot send after transport endpoint shutdown",
        "ETOOMANYREFS" => "Too many references: cannot splice",
        "ETIMEDOUT" => "Connection timed out",
        "ECONNREFUSED" => "Connection refused",
        "EHOSTDOWN" => "Host is down",
        "EHOSTUNREACH" => "No route to host",
        "EALREADY" => "Operation already in progress",
        "EINPROGRESS" => "Operation now in progress",
        "ESTALE" => "Stale file handle",
        "EUCLEAN" => "Structure needs cleaning",
        "ENOTNAM" => "Not a XENIX named type file",
        "ENAVAIL" => "No XENIX semaphores available",
        "EISNAM" => "Is a named type file",
        "EREMOTEIO" => "Remote I/O error",
        "EDQUOT" => "Disk quota exceeded",
        "ENOMEDIUM" => "No medium found",
        "EMEDIUMTYPE" => "Wrong medium type",
        "ECANCELED" => "Operation canceled",
        "ENOKEY" => "Required key not available",
        "EKEYEXPIRED" => "Key has expired",
        "EKEYREVOKED" => "Key has been revoked",
        "EKEYREJECTED" => "Key was rejected by service",
        "EOWNERDEAD" => "Owner died",
        "ENOTRECOVERABLE" => "State not recoverable",
        "ERFKILL" => "Operation not possible due to RF-kill",
        "EHWPOISON" => "Memory page has hardware error",
    };

    // Mac has slightly different messages. To keep it consistent with
    // bash/coreutils, it uses those altered messages.
    #[cfg(target_os = "macos")]
    static MESSAGES: phf::Map<&'static str, &'static str> = phf::phf_map! {
        "E2BIG" => "Argument list too long",
        "EACCES" => "Permission denied",
        "EADDRINUSE" => "Address already in use",
        "EADDRNOTAVAIL" => "Can't assign requested address",
        "EAFNOSUPPORT" => "Address family not supported by protocol family",
        "EAGAIN" => "non-blocking and interrupt i/o. Resource temporarily unavailable",
        "EALREADY" => "Operation already in progress",
        "EAUTH" => "Authentication error",
        "EBADARCH" => "Bad CPU type in executable",
        "EBADEXEC" => "Program loading errors. Bad executable",
        "EBADF" => "Bad file descriptor",
        "EBADMACHO" => "Malformed Macho file",
        "EBADMSG" => "Bad message",
        "EBADRPC" => "RPC struct is bad",
        "EBUSY" => "Device / Resource busy",
        "ECANCELED" => "Operation canceled",
        "ECHILD" => "No child processes",
        "ECONNABORTED" => "Software caused connection abort",
        "ECONNREFUSED" => "Connection refused",
        "ECONNRESET" => "Connection reset by peer",
        "EDEADLK" => "Resource deadlock avoided",
        "EDESTADDRREQ" => "Destination address required",
        "EDEVERR" => "Device error, for example paper out",
        "EDOM" => "math software. Numerical argument out of domain",
        "EDQUOT" => "Disc quota exceeded",
        "EEXIST" => "File or folder exists",
        "EFAULT" => "Bad address",
        "EFBIG" => "File too large",
        "EFTYPE" => "Inappropriate file type or format",
        "EHOSTDOWN" => "Host is down",
        "EHOSTUNREACH" => "No route to host",
        "EIDRM" => "Identifier removed",
        "EILSEQ" => "Illegal byte sequence",
        "EINPROGRESS" => "Operation now in progress",
        "EINTR" => "Interrupted system call",
        "EINVAL" => "Invalid argument",
        "EIO" => "Input/output error",
        "EISCONN" => "Socket is already connected",
        "EISDIR" => "Is a directory",
        "ELOOP" => "Too many levels of symbolic links",
        "EMFILE" => "Too many open files",
        "EMLINK" => "Too many links",
        "EMSGSIZE" => "Message too long",
        "EMULTIHOP" => "Reserved",
        "ENAMETOOLONG" => "File name too long",
        "ENEEDAUTH" => "Need authenticator",
        "ENETDOWN" => "ipc/network software - operational errors Network is down",
        "ENETRESET" => "Network dropped connection on reset",
        "ENETUNREACH" => "Network is unreachable",
        "ENFILE" => "Too many open files in system",
        "ENOATTR" => "Attribute not found",
        "ENOBUFS" => "No buffer space available",
        "ENODATA" => "No message available on STREAM",
        "ENODEV" => "Operation not supported by device",
        "ENOENT" => "No such file or directory",
        "ENOEXEC" => "Exec format error",
        "ENOLCK" => "No locks available",
        "ENOLINK" => "Reserved",
        "ENOMEM" => "Out of memory",
        "ENOMSG" => "No message of desired type",
        "ENOPOLICY" => "No such policy registered",
        "ENOPROTOOPT" => "Protocol not available",
        "ENOSPC" => "No space left on device",
        "ENOSR" => "No STREAM resources",
        "ENOSTR" => "Not a STREAM",
        "ENOSYS" => "Function not implemented",
        "ENOTBLK" => "Block device required",
        "ENOTCONN" => "Socket is not connected",
        "ENOTDIR" => "Not a directory",
        "ENOTEMPTY" => "Directory not empty",
        "ENOTRECOVERABLE" => "State not recoverable",
        "ENOTSOCK" => "ipc/network software - argument errors. Socket operation on non-socket",
        "ENOTSUP" => "Operation not supported",
        "ENOTTY" => "Inappropriate ioctl for device",
        "ENXIO" => "Device not configured",
        "EOVERFLOW" => "Value too large to be stored in data type",
        "EOWNERDEAD" => "Previous owner died",
        "EPERM" => "Operation not permitted",
        "EPFNOSUPPORT" => "Protocol family not supported",
        "EPIPE" => "Broken pipe",
        "EPROCLIM" => "quotas & mush. Too many processes",
        "EPROCUNAVAIL" => "Bad procedure for program",
        "EPROGMISMATCH" => "Program version wrong",
        "EPROGUNAVAIL" => "RPC prog. not avail",
        "EPROTO" => "Protocol error",
        "EPROTONOSUPPORT" => "Protocol not supported",
        "EPROTOTYPE" => "Protocol wrong type for socket",
        "EPWROFF" => "Intelligent device errors. Device power is off",
        "EQFULL" => "Interface output queue is full",
        "ERANGE" => "Result too large",
        "EREMOTE" => "Too many levels of remote in path",
        "EROFS" => "Read-only file system",
        "ERPCMISMATCH" => "RPC version wrong",
        "ESHLIBVERS" => "Shared library version mismatch",
        "ESHUTDOWN" => "Can't send after socket shutdown",
        "ESOCKTNOSUPPORT" => "Socket type not supported",
        "ESPIPE" => "Illegal seek",
        "ESRCH" => "No such process",
        "ESTALE" => "Network File System. Stale NFS file handle",
        "ETIME" => "STREAM ioctl timeout",
        "ETIMEDOUT" => "Operation timed out",
        "ETOOMANYREFS" => "Too many references: can't splice",
        "ETXTBSY" => "Text file busy",
        "EUSERS" => "Too many users",
        "EWOULDBLOCK" => "Operation would block",
        "EXDEV" => "Cross-device link",
    };

    // From FreeBSD's libc strerror table (lib/libc/gen/errlst.c).
    #[cfg(target_os = "freebsd")]
    static MESSAGES: phf::Map<&'static str, &'static str> = phf::phf_map! {
        "EPERM" => "Operation not permitted",
        "ENOENT" => "No such file or directory",
        "ESRCH" => "No such process",
        "EINTR" => "Interrupted system call",
        "EIO" => "Input/output error",
        "ENXIO" => "Device not configured",
        "E2BIG" => "Argument list too long",
        "ENOEXEC" => "Exec format error",
        "EBADF" => "Bad file descriptor",
        "ECHILD" => "No child processes",
        "EDEADLK" => "Resource deadlock avoided",
        "ENOMEM" => "Cannot allocate memory",
        "EACCES" => "Permission denied",
        "EFAULT" => "Bad address",
        "ENOTBLK" => "Block device required",
        "EBUSY" => "Device busy",
        "EEXIST" => "File exists",
        "EXDEV" => "Cross-device link",
        "ENODEV" => "Operation not supported by device",
        "ENOTDIR" => "Not a directory",
        "EISDIR" => "Is a directory",
        "EINVAL" => "Invalid argument",
        "ENFILE" => "Too many open files in system",
        "EMFILE" => "Too many open files",
        "ENOTTY" => "Inappropriate ioctl for device",
        "ETXTBSY" => "Text file busy",
        "EFBIG" => "File too large",
        "ENOSPC" => "No space left on device",
        "ESPIPE" => "Illegal seek",
        "EROFS" => "Read-only file system",
        "EMLINK" => "Too many links",
        "EPIPE" => "Broken pipe",
        "EDOM" => "Numerical argument out of domain",
        "ERANGE" => "Result too large",
        "EAGAIN" => "Resource temporarily unavailable",
        "EINPROGRESS" => "Operation now in progress",
        "EALREADY" => "Operation already in progress",
        "ENOTSOCK" => "Socket operation on non-socket",
        "EDESTADDRREQ" => "Destination address required",
        "EMSGSIZE" => "Message too long",
        "EPROTOTYPE" => "Protocol wrong type for socket",
        "ENOPROTOOPT" => "Protocol not available",
        "EPROTONOSUPPORT" => "Protocol not supported",
        "ESOCKTNOSUPPORT" => "Socket type not supported",
        "EOPNOTSUPP" => "Operation not supported",
        "EPFNOSUPPORT" => "Protocol family not supported",
        "EAFNOSUPPORT" => "Address family not supported by protocol family",
        "EADDRINUSE" => "Address already in use",
        "EADDRNOTAVAIL" => "Can't assign requested address",
        "ENETDOWN" => "Network is down",
        "ENETUNREACH" => "Network is unreachable",
        "ENETRESET" => "Network dropped connection on reset",
        "ECONNABORTED" => "Software caused connection abort",
        "ECONNRESET" => "Connection reset by peer",
        "ENOBUFS" => "No buffer space available",
        "EISCONN" => "Socket is already connected",
        "ENOTCONN" => "Socket is not connected",
        "ESHUTDOWN" => "Can't send after socket shutdown",
        "ETOOMANYREFS" => "Too many references: can't splice",
        "ETIMEDOUT" => "Operation timed out",
        "ECONNREFUSED" => "Connection refused",
        "ELOOP" => "Too many levels of symbolic links",
        "ENAMETOOLONG" => "File name too long",
        "EHOSTDOWN" => "Host is down",
        "EHOSTUNREACH" => "No route to host",
        "ENOTEMPTY" => "Directory not empty",
        "EPROCLIM" => "Too many processes",
        "EUSERS" => "Too many users",
        "EDQUOT" => "Disc quota exceeded",
        "ESTALE" => "Stale NFS file handle",
        "EREMOTE" => "Too many levels of remote in path",
        "EBADRPC" => "RPC struct is bad",
        "ERPCMISMATCH" => "RPC version wrong",
        "EPROGUNAVAIL" => "RPC prog. not avail",
        "EPROGMISMATCH" => "Program version wrong",
        "EPROCUNAVAIL" => "Bad procedure for program",
        "ENOLCK" => "No locks available",
        "ENOSYS" => "Function not implemented",
        "EFTYPE" => "Inappropriate file type or format",
        "EAUTH" => "Authentication error",
        "ENEEDAUTH" => "Need authenticator",
        "EIDRM" => "Identifier removed",
        "ENOMSG" => "No message of desired type",
        "EOVERFLOW" => "Value too large to be stored in data type",
        "ECANCELED" => "Operation canceled",
        "EILSEQ" => "Illegal byte sequence",
        "ENOATTR" => "Attribute not found",
        "EDOOFUS" => "Programming error",
        "EBADMSG" => "Bad message",
        "EMULTIHOP" => "Multihop attempted",
        "ENOLINK" => "Link has been severed",
        "EPROTO" => "Protocol error",
        "ENOTCAPABLE" => "Capabilities insufficient",
        "ECAPMODE" => "Not permitted in capability mode",
        "ENOTRECOVERABLE" => "State not recoverable",
        "EOWNERDEAD" => "Previous owner died",
        "EINTEGRITY" => "Integrity check failed",
    };
}

/// Zig: `pub fn Result(comptime T: type, comptime E: type) type { return union(enum) { ok: T, err: E, ... } }`
pub enum Result<T, E> {
    Ok(T),
    Err(E),
}

impl<T, E> Result<T, E> {
    #[inline]
    pub fn as_err(&self) -> Option<&E> {
        if let Result::Err(e) = self {
            return Some(e);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intern_identity() {
        let a = Error::intern("HTTP2ProtocolError");
        let b = Error::intern("HTTP2ProtocolError");
        let c = Error::intern("HTTP2FrameSizeError");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.name(), "HTTP2ProtocolError");
        assert_eq!(c.name(), "HTTP2FrameSizeError");
    }

    #[test]
    fn seed_consts() {
        assert_eq!(Error::UNEXPECTED.name(), "Unexpected");
        assert_eq!(Error::OUT_OF_MEMORY.name(), "OutOfMemory");
        assert_eq!(Error::intern("OutOfMemory"), Error::OUT_OF_MEMORY);
        assert_eq!(Error::from_raw(Error::OUT_OF_MEMORY.as_u16()), Error::OUT_OF_MEMORY);
    }

    #[test]
    fn errno_mapping() {
        assert_eq!(Error::from_errno(2).name(), "ENOENT");
        assert_eq!(Error::from_errno(2), Error::intern("ENOENT"));
        assert_eq!(Error::from_errno(12), Error::intern("ENOMEM"));
        assert_eq!(Error::from_errno(0), Error::UNEXPECTED);
        assert_eq!(Error::from_errno(9999), Error::UNEXPECTED);
        // errno 11 is platform-specific: EAGAIN on linux/windows, EDEADLK on darwin/bsd.
        #[cfg(any(target_os = "linux", windows, target_family = "wasm"))]
        {
            assert_eq!(Error::from_errno(11), Error::intern("EAGAIN"));
            assert_eq!(Error::from_errno(104), Error::intern("ECONNRESET"));
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            assert_eq!(Error::from_errno(11), Error::intern("EDEADLK"));
            assert_eq!(Error::from_errno(35), Error::intern("EAGAIN"));
            assert_eq!(Error::from_errno(54), Error::intern("ECONNRESET"));
        }
    }

    /// Exhaustive: every slot in the per-platform table round-trips through
    /// `from_errno → name()` and matches the table entry, and the table covers
    /// the full Zig `SystemErrno` range (not just the 1..34 POSIX-common subset).
    #[test]
    fn errno_table_full_range() {
        // Slot 0 is the SUCCESS hole.
        assert_eq!(SYSTEM_ERRNO_NAMES[0], "SUCCESS");
        assert_eq!(system_errno_name(0), None);
        for (i, &name) in SYSTEM_ERRNO_NAMES.iter().enumerate().skip(1) {
            assert_eq!(system_errno_name(i as i32), Some(name), "slot {i}");
            assert_eq!(Error::from_errno(i as i32).name(), name, "slot {i}");
        }
        // One past the end → Unexpected.
        assert_eq!(Error::from_errno(SYSTEM_ERRNO_NAMES.len() as i32), Error::UNEXPECTED);

        // Spot-check the last entry on each platform against the Zig source.
        #[cfg(any(target_os = "linux", target_family = "wasm"))]
        assert_eq!(SYSTEM_ERRNO_NAMES[133], "EHWPOISON");
        #[cfg(windows)]
        {
            assert_eq!(SYSTEM_ERRNO_NAMES[137], "EFTYPE");
            // Sparse UV_* range round-trips (bun.zig errno_map covers 0..=4096).
            assert_eq!(Error::from_errno(-4058).name(), "UV_ENOENT");
            assert_eq!(Error::from_errno(-4092).name(), "UV_EACCES");
            assert_eq!(Error::from_errno(-4095).name(), "UV_EOF");
            assert_eq!(Error::from_errno(-3008).name(), "UV_EAI_NONAME");
            assert_eq!(system_errno_name(-4058), Some("UV_ENOENT"));
            assert_eq!(Error::from_errno(-5000), Error::UNEXPECTED);
        }
        #[cfg(target_os = "macos")]
        assert_eq!(SYSTEM_ERRNO_NAMES[106], "EQFULL");
        #[cfg(target_os = "freebsd")]
        assert_eq!(SYSTEM_ERRNO_NAMES[97], "EINTEGRITY");
    }

    #[test]
    fn coreutils_map() {
        assert_eq!(coreutils_error_map::get(2), Some("No such file or directory"));
        #[cfg(any(target_os = "linux", windows, target_family = "wasm"))]
        assert_eq!(coreutils_error_map::get(11), Some("Resource temporarily unavailable"));
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        assert_eq!(coreutils_error_map::get(11), Some("Resource deadlock avoided"));
        assert_eq!(coreutils_error_map::get(0), None);
    }

    #[test]
    fn err_macro_distinct() {
        let a = crate::err!(DistTagNotFound);
        let b = crate::err!("DistTagNotFound");
        let c = crate::err!(NoMatchingVersion);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_ne!(a, Error::TODO);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun.zig (anyerror / errno_map / errnoToZigErr)
//               src/sys/coreutils_error_map.zig
//               src/bun_core/result.zig (11 lines)
//   confidence: high
//   todos:      1 (Windows: From<io::Error> needs Win32→SystemErrno translation;
//               currently falls back to Unexpected to avoid mis-aliasing)
//   notes:      Error is #[repr(transparent)] NonZeroU16 string-interned;
//               err!() yields distinct comparable codes; name() round-trips.
//               errno_map / coreutils_error_map are cfg-gated per target_os
//               (tables duplicated from bun_errno because of the dep cycle;
//               const-asserted to match SystemErrno cardinality per platform).
//               VERIFIED: per-platform tables cover full SystemErrno range
//               (linux=134, win=138, darwin=107, freebsd=98); macOS/BSD
//               errno 11→EDEADLK / 35→EAGAIN swap is correct vs *_errno.zig.
// ──────────────────────────────────────────────────────────────────────────
