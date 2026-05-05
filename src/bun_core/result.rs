// ─── MOVE-IN: crate::Error (TYPE_ONLY from bun_sys::Error) ────────────────
// bun_core only needs the errno-carrying shell so output.rs / Progress.rs can
// type their Result<_, crate::Error>. The full `withPath`/`toSystemError`/JS
// surface stays in bun_sys (which `impl ErrName for bun_core::Error` per
// movein-skipped [bun_core] entry).
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Error {
    pub errno: i32,
    pub syscall: u16, // bun_sys::Syscall::Tag — opaque at this tier
    pub fd: i32,
    pub path_ptr: *const u8,
    pub path_len: u32,
}
impl Error {
    pub const fn from_errno(errno: i32) -> Self {
        Self { errno, syscall: 0, fd: -1, path_ptr: core::ptr::null(), path_len: 0 }
    }
    /// B-1: Phase-A `err!()` placeholder. Real impl: NonZeroU16 interning table.
    pub const TODO: Self = Self::from_errno(-1);
    /// B-1: Phase-A `bun_core::Error::from_name("...")`. Real impl: name→code lookup.
    pub fn from_name(_name: &'static str) -> Self { Self::TODO }
}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self { Self::from_errno(e.raw_os_error().unwrap_or(-1)) }
}
// SAFETY: path_ptr is always a borrow of 'static or arena-owned bytes; matches
// Zig's `path: []const u8` which is freely Send across threads.
unsafe impl Send for Error {}
unsafe impl Sync for Error {}

// ─── MOVE-IN: coreutils_error_map (from bun_sys) ──────────────────────────
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
//   source:     src/bun_core/result.zig (11 lines)
//   confidence: high
//   todos:      0
//   notes:      Generic union(enum) → Rust enum; as_err returns Option<&E> (borrow) to avoid Clone bound — Phase B may want Option<E> with E: Copy if callers need owned.
// ──────────────────────────────────────────────────────────────────────────
