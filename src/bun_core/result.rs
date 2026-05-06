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
/// the `pub const` Errors and for `ERRNO_SEED` below.
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
    // — POSIX errno tag names (subset; full table arrives via bun_errno) —
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

/// `errno → SEED index` for the contiguous POSIX 1..=34 block. Index 0 is a
/// hole (errno 0 is "success"). Mirrors the comptime `errno_map` in bun.zig.
const ERRNO_SEED: &[u16] = &[
    0,  // 0: (no error)
    12, // 1: EPERM
    13, // 2: ENOENT
    14, // 3: ESRCH
    15, // 4: EINTR
    16, // 5: EIO
    17, // 6: ENXIO
    18, // 7: E2BIG
    19, // 8: ENOEXEC
    20, // 9: EBADF
    21, // 10: ECHILD
    22, // 11: EAGAIN
    23, // 12: ENOMEM
    24, // 13: EACCES
    25, // 14: EFAULT
    26, // 15: ENOTBLK
    27, // 16: EBUSY
    28, // 17: EEXIST
    29, // 18: EXDEV
    30, // 19: ENODEV
    31, // 20: ENOTDIR
    32, // 21: EISDIR
    33, // 22: EINVAL
    34, // 23: ENFILE
    35, // 24: EMFILE
    36, // 25: ENOTTY
    37, // 26: ETXTBSY
    38, // 27: EFBIG
    39, // 28: ENOSPC
    40, // 29: ESPIPE
    41, // 30: EROFS
    42, // 31: EMLINK
    43, // 32: EPIPE
    44, // 33: EDOM
    45, // 34: ERANGE
];

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
        // Windows libuv errnos are negative; normalise like the Zig original.
        let n = if cfg!(windows) { errno.unsigned_abs() } else { errno as u32 };
        if let Some(&seed) = ERRNO_SEED.get(n as usize) {
            if seed != 0 {
                // SAFETY: every non-zero ERRNO_SEED entry is a valid SEED index.
                return Self(unsafe { NonZeroU16::new_unchecked(seed) });
            }
        }
        // TODO(b2): full SystemErrno table from bun_errno for n > 34.
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
        e.raw_os_error().map(Self::from_errno).unwrap_or(Self::UNEXPECTED)
    }
}
impl From<bun_alloc::AllocError> for Error {
    fn from(_: bun_alloc::AllocError) -> Self { Self::OUT_OF_MEMORY }
}

// ─── coreutils_error_map (unchanged from Phase-A move-in) ─────────────────
// Zig builds a comptime EnumMap<SystemErrno, []const u8>. Port the lookup as a
// fn module so output.rs's `coreutils_error_map::get(errno)` resolves; the
// actual table is generated into bun_errno (T0 sibling) and referenced here.
pub mod coreutils_error_map {
    /// Returns the GNU-coreutils-style short label for an errno, if known.
    #[inline]
    pub fn get(errno: i32) -> Option<&'static str> {
        // TODO(port): Zig source builds this from src/sys/coreutils_error_map.zig
        // via a comptime block over SystemErrno. Phase B: codegen into bun_errno
        // and re-export. Minimal hand subset covers the hot output.rs path.
        Some(match errno {
            1  => "Operation not permitted",
            2  => "No such file or directory",
            3  => "No such process",
            4  => "Interrupted system call",
            5  => "Input/output error",
            9  => "Bad file descriptor",
            11 => "Resource temporarily unavailable",
            12 => "Cannot allocate memory",
            13 => "Permission denied",
            17 => "File exists",
            20 => "Not a directory",
            21 => "Is a directory",
            22 => "Invalid argument",
            24 => "Too many open files",
            28 => "No space left on device",
            32 => "Broken pipe",
            _ => return None,
        })
    }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun.zig (anyerror / errno_map / errnoToZigErr)
//               src/bun_core/result.zig (11 lines)
//   confidence: high
//   todos:      1 (full SystemErrno table via bun_errno)
//   notes:      Error is now #[repr(transparent)] NonZeroU16 string-interned;
//               err!() yields distinct comparable codes; name() round-trips.
// ──────────────────────────────────────────────────────────────────────────
