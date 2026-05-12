// ─── bun_core::Error — Zig `anyerror` port ────────────────────────────────
//
// Zig's `anyerror` is a global error set: every distinct `error.Foo` name in
// the program is assigned a unique non-zero u16 at link time, `@intFromError`
// returns that code, `@errorName` recovers the string, and two `error.Foo`s
// from different modules compare equal because the *name* is the identity.
//
// Rust has no link-time global enum, so we intern at runtime: a process-wide
// append-only `&'static str` table guarded by an RwLock. The `err!()` macro
// caches each call-site's code in a 2-byte `AtomicU16` slot (zero-init →
// `.bss`), so the lock is touched once per *name-site*, not once per call —
// matching Zig's zero-cost comparison (`e == err!(Foo)` is a u16 compare
// after first use).
//
// Layout is `#[repr(transparent)] NonZeroU16`, so `Option<Error>` is one u16
// and FFI/packed-struct slots that held a Zig `anyerror` keep the same width.

use core::fmt;
use core::num::NonZeroU16;
use crate::RwLock;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Error(NonZeroU16);

// ── intern table ──────────────────────────────────────────────────────────
//
// Codes `1..=SEED.len()` index `SEED`; codes above that index the dynamic
// `EXTRA` vec at `code - SEED.len() - 1`. SEED is frozen so the handful of
// `pub const` Errors below have stable values without touching the lock.

/// Pre-seeded names. **Append only** — existing indices are load-bearing for
/// the `pub const` Errors below. (The errno→name map lives in bun_errno via the
/// `ErrnoNames` hook; entries here are only fast-path intern hits.)
const SEED: &[&str] = &[
    // — well-known Zig error-set members the runtime matches on by value —
    "Unexpected",      // 1  (Zig's catch-all; also `errno_map` default)
    "OutOfMemory",     // 2
    "EndOfStream",     // 3
    "StreamTooLong",   // 4
    "NoSpaceLeft",     // 5
    "WriteFailed",     // 6
    "Overflow",        // 7
    "InvalidArgument", // 8
    "Timeout",         // 9
    "Aborted",         // 10
    "WouldBlock",      // 11
    // — POSIX errno tag names (intern fast-path only; the actual errno→name
    //   mapping is the per-platform table in bun_errno, via ErrnoNames hook) —
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

/// Platform errno integer → its `SystemErrno` tag name. `None` for 0/out-of-range.
/// The per-platform table lives in `bun_errno` (strum derive on `SystemErrno`);
/// reached through the `ErrnoNames` link-interface so this crate stays leaf.
#[inline]
pub(crate) fn system_errno_name(errno: i32) -> Option<&'static str> {
    crate::ErrnoNames::SYS.name(errno)
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

/// Cold half of the `err!()` macro: intern `name` and publish the code into
/// `slot`. Non-generic (`&AtomicU16` + `&'static str`) so every `err!` call
/// site shares ONE `.text` body — the previous `OnceLock::get_or_init(|| …)`
/// monomorphized a fresh closure type per site (~1.9k copies). `Relaxed` is
/// sufficient: the slot only caches an idempotent u16; a racing reader that
/// observes `0` simply re-interns to the same value.
#[cold]
#[inline(never)]
pub fn intern_cached(slot: &core::sync::atomic::AtomicU16, name: &'static str) -> Error {
    let e = Error::intern(name);
    slot.store(e.as_u16(), core::sync::atomic::Ordering::Relaxed);
    e
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
    ///
    /// `#[cold]`: only reached on a per-site cache miss (or `err!(from e)`);
    /// keeps the SEED scan + RwLock probe out of `.text.hot` so
    /// `--sort-section=name` groups it with the other unlikely paths.
    #[cold]
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
    pub fn from_name(name: &'static str) -> Self {
        Self::intern(name)
    }

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
    pub const fn as_u16(self) -> u16 {
        self.0.get()
    }

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
        static ERRNO_MAP: crate::Once<Box<[Error]>> = crate::Once::new();
        let map = ERRNO_MAP.get_or_init(|| {
            // Index 0 ("SUCCESS") is the no-error hole → Unexpected,
            // matching the Zig `@memset(&map, error.Unexpected)`.
            (0..crate::ErrnoNames::SYS.max_dense())
                .map(|i| match system_errno_name(i as i32) {
                    Some(name) => Error::intern(name),
                    None => Error::UNEXPECTED,
                })
                .collect()
        });

        // Windows libuv errnos are negative; normalise like the Zig original.
        let n = if cfg!(windows) {
            errno.unsigned_abs()
        } else {
            if errno <= 0 {
                return Self::UNEXPECTED;
            }
            errno as u32
        };
        if let Some(&e) = map.get(n as usize) {
            return e;
        }
        // Windows: fall through to the sparse UV_* range (3000..=4096) so e.g.
        // `from_errno(-4058)` → `error.UV_ENOENT`, matching Zig's full-width
        // `errno_map` (bun.zig:2841-2851 sizes it to `max(@intFromEnum)+1`).
        #[cfg(windows)]
        if let Some(name) = system_errno_name(errno) {
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
            // NOT a `SystemErrno`. Routing it through `ErrnoNames::SYS.name()` would
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
    fn from(_: bun_alloc::AllocError) -> Self {
        Self::OUT_OF_MEMORY
    }
}
/// Zig's `std.Io.Writer` error set surfaces as `error.WriteFailed` when
/// propagated through `try writer.print(…)`; the Rust port routes formatted
/// output through `core::fmt::Write`, whose only error value is the unit
/// `fmt::Error`. Map it to the same tag so `?`-propagation matches the spec.
impl From<core::fmt::Error> for Error {
    fn from(_: core::fmt::Error) -> Self {
        Self::WRITE_FAILED
    }
}

/// Extension for `?`-propagating non-`fmt::Error` write failures (e.g.
/// `std::io::Error` from `write!(&mut Vec<u8>, …)` / `Cursor` / `BufWriter`)
/// as the spec's `error.WriteFailed` tag. Bare `?` on those would route through
/// [`From<std::io::Error>`] → errno/`Unexpected`, which diverges from the Zig
/// `try writer.print(…)` contract. Replaces the open-coded
/// `.map_err(|_| err!("WriteFailed"))` pattern at ~20 call sites.
pub trait OrWriteFailed<T> {
    fn or_write_failed(self) -> core::result::Result<T, Error>;
}
impl<T, E> OrWriteFailed<T> for core::result::Result<T, E> {
    #[inline]
    fn or_write_failed(self) -> core::result::Result<T, Error> {
        self.map_err(|_| Error::WRITE_FAILED)
    }
}
impl<T, E> OrWriteFailed<T> for Result<T, E> {
    #[inline]
    fn or_write_failed(self) -> core::result::Result<T, Error> {
        match self {
            Result::Ok(v) => Ok(v),
            Result::Err(_) => Err(Error::WRITE_FAILED),
        }
    }
}

/// Stamp out `impl From<$t> for bun_core::Error` for one or more
/// `strum::IntoStaticStr`-deriving error enums, routing each variant through
/// [`Error::from_name`]. Expansion is byte-identical to the hand-written
/// 5-line impl this replaces, so codegen is unchanged.
///
/// A blanket `impl<E: Into<&'static str>> From<E> for Error` is intentionally
/// NOT provided: it would over-match (`&'static str` itself) and risk future
/// coherence overlap with the bespoke `From<io::Error>` / `From<AllocError>` /
/// `From<fmt::Error>` impls above.
#[macro_export]
macro_rules! named_error_set {
    ($($t:ty),+ $(,)?) => {
        $(
            impl ::core::convert::From<$t> for $crate::Error {
                #[inline]
                fn from(e: $t) -> Self {
                    $crate::Error::from_name(<&'static str>::from(e))
                }
            }
        )+
    };
}

/// Stamp out `impl Display + impl Error` for one or more
/// `strum::IntoStaticStr`-deriving error enums whose user-facing string is
/// exactly the variant tag (Zig `@errorName(e)` semantics). Replaces the
/// hand-rolled 5-line `f.write_str(<&'static str>::from(self))` boilerplate.
///
/// Kept separate from [`named_error_set!`] because not every named error set
/// wants the tag-as-Display behavior (some have bespoke `Display` impls).
#[macro_export]
macro_rules! impl_tag_error {
    ($($t:ty),+ $(,)?) => {$(
        impl ::core::fmt::Display for $t {
            #[inline]
            fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
                f.write_str(<&'static str>::from(self))
            }
        }
        impl ::core::error::Error for $t {}
    )+};
}

// ─── coreutils_error_map ─────────────────────────────────────────────────
// Zig builds a comptime `EnumMap<SystemErrno, []const u8>` with a per-OS
// `switch (Environment.os)` body (src/sys/coreutils_error_map.zig). The full
// EnumMap lives in `bun_sys::coreutils_error_map`; that crate is tier-above
// `bun_core`, so for `output.rs`'s integer-errno hot path we keep a parallel
// table here, keyed by `SystemErrno` *name* and resolved through the per-OS
// `ErrnoNames` hook — i.e. the same `errno → SystemErrno → message`
// composition the Zig does, just without the cross-crate enum.
//
// Layout: one shared BASE table (the glibc/coreutils strings — used as-is on
// linux/android/windows/wasm) plus a small per-OS DELTA on macOS/FreeBSD that
// overrides divergent texts and adds OS-only errnos. Because lookup is gated
// by the per-OS `SystemErrno` name space, BASE rows for Linux-only errnos are
// unreachable on macOS/FreeBSD and harmless to keep — so the three full per-OS
// `phf_map!`s collapse to BASE + two ~40-row deltas with identical behavior.
pub mod coreutils_error_map {
    /// Returns the GNU-coreutils-style short label for an errno, if known.
    #[inline]
    pub fn get(errno: i32) -> Option<&'static str> {
        super::system_errno_name(errno).and_then(get_by_name)
    }

    /// Look up by `SystemErrno` variant name (e.g. `"ENOENT"`). Used by
    /// `bun_sys::coreutils_error_map` to populate its typed `EnumMap` without
    /// duplicating the per-OS string tables.
    #[inline]
    pub fn get_by_name(name: &str) -> Option<&'static str> {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        if let Some(s) = DELTA.get(name) {
            return Some(*s);
        }
        BASE.get(name).copied()
    }

    // The glibc/coreutils strerror() texts. Linux/Android/Windows/wasm use this
    // table verbatim; macOS/FreeBSD consult DELTA first then fall back here.
    static BASE: phf::Map<&'static str, &'static str> = phf::phf_map! {
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

    // macOS DELTA: overrides where Apple's strerror() text diverges from glibc,
    // plus macOS-only errnos (EBADARCH, EBADMACHO, EPWROFF, …).
    #[cfg(target_os = "macos")]
    static DELTA: phf::Map<&'static str, &'static str> = phf::phf_map! {
        "EADDRNOTAVAIL" => "Can't assign requested address",
        "EAFNOSUPPORT" => "Address family not supported by protocol family",
        "EAGAIN" => "non-blocking and interrupt i/o. Resource temporarily unavailable",
        "EAUTH" => "Authentication error",
        "EBADARCH" => "Bad CPU type in executable",
        "EBADEXEC" => "Program loading errors. Bad executable",
        "EBADMACHO" => "Malformed Macho file",
        "EBADRPC" => "RPC struct is bad",
        "EBUSY" => "Device / Resource busy",
        "EDEVERR" => "Device error, for example paper out",
        "EDOM" => "math software. Numerical argument out of domain",
        "EDQUOT" => "Disc quota exceeded",
        "EEXIST" => "File or folder exists",
        "EFTYPE" => "Inappropriate file type or format",
        "EILSEQ" => "Illegal byte sequence",
        "EISCONN" => "Socket is already connected",
        "EMULTIHOP" => "Reserved",
        "ENEEDAUTH" => "Need authenticator",
        "ENETDOWN" => "ipc/network software - operational errors Network is down",
        "ENOATTR" => "Attribute not found",
        "ENODATA" => "No message available on STREAM",
        "ENODEV" => "Operation not supported by device",
        "ENOLINK" => "Reserved",
        "ENOMEM" => "Out of memory",
        "ENOPOLICY" => "No such policy registered",
        "ENOSR" => "No STREAM resources",
        "ENOSTR" => "Not a STREAM",
        "ENOTCONN" => "Socket is not connected",
        "ENOTSOCK" => "ipc/network software - argument errors. Socket operation on non-socket",
        "ENOTSUP" => "Operation not supported",
        "ENXIO" => "Device not configured",
        "EOVERFLOW" => "Value too large to be stored in data type",
        "EOWNERDEAD" => "Previous owner died",
        "EPROCLIM" => "quotas & mush. Too many processes",
        "EPROCUNAVAIL" => "Bad procedure for program",
        "EPROGMISMATCH" => "Program version wrong",
        "EPROGUNAVAIL" => "RPC prog. not avail",
        "EPWROFF" => "Intelligent device errors. Device power is off",
        "EQFULL" => "Interface output queue is full",
        "ERANGE" => "Result too large",
        "EREMOTE" => "Too many levels of remote in path",
        "ERPCMISMATCH" => "RPC version wrong",
        "ESHLIBVERS" => "Shared library version mismatch",
        "ESHUTDOWN" => "Can't send after socket shutdown",
        "ESTALE" => "Network File System. Stale NFS file handle",
        "ETIME" => "STREAM ioctl timeout",
        "ETIMEDOUT" => "Operation timed out",
        "ETOOMANYREFS" => "Too many references: can't splice",
        "EWOULDBLOCK" => "Operation would block",
        "EXDEV" => "Cross-device link",
    };

    // FreeBSD DELTA: overrides where FreeBSD's errlst.c diverges from glibc,
    // plus FreeBSD-only errnos (EDOOFUS, ECAPMODE, ENOTCAPABLE, EINTEGRITY, …).
    #[cfg(target_os = "freebsd")]
    static DELTA: phf::Map<&'static str, &'static str> = phf::phf_map! {
        "EADDRNOTAVAIL" => "Can't assign requested address",
        "EAFNOSUPPORT" => "Address family not supported by protocol family",
        "EAUTH" => "Authentication error",
        "EBADRPC" => "RPC struct is bad",
        "EBUSY" => "Device busy",
        "ECAPMODE" => "Not permitted in capability mode",
        "EDOOFUS" => "Programming error",
        "EDQUOT" => "Disc quota exceeded",
        "EFTYPE" => "Inappropriate file type or format",
        "EILSEQ" => "Illegal byte sequence",
        "EINTEGRITY" => "Integrity check failed",
        "EISCONN" => "Socket is already connected",
        "ENEEDAUTH" => "Need authenticator",
        "ENOATTR" => "Attribute not found",
        "ENODEV" => "Operation not supported by device",
        "ENOTCAPABLE" => "Capabilities insufficient",
        "ENOTCONN" => "Socket is not connected",
        "ENXIO" => "Device not configured",
        "EOVERFLOW" => "Value too large to be stored in data type",
        "EOWNERDEAD" => "Previous owner died",
        "EPROCLIM" => "Too many processes",
        "EPROCUNAVAIL" => "Bad procedure for program",
        "EPROGMISMATCH" => "Program version wrong",
        "EPROGUNAVAIL" => "RPC prog. not avail",
        "ERANGE" => "Result too large",
        "EREMOTE" => "Too many levels of remote in path",
        "ERPCMISMATCH" => "RPC version wrong",
        "ESHUTDOWN" => "Can't send after socket shutdown",
        "ESTALE" => "Stale NFS file handle",
        "ETIMEDOUT" => "Operation timed out",
        "ETOOMANYREFS" => "Too many references: can't splice",
        "EXDEV" => "Cross-device link",
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
        assert_eq!(
            Error::from_raw(Error::OUT_OF_MEMORY.as_u16()),
            Error::OUT_OF_MEMORY
        );
    }

    // `errno_mapping`, `errno_table_full_range`, `coreutils_map` moved to
    // `bun_errno::errno_name_tests` — they link through the `ErrnoNames` hook
    // and would fail `cargo test -p bun_core` (no provider in this crate).

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

// ported from: src/bun.zig
