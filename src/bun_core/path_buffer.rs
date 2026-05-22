// ─── Path primitives (from bun_paths) ─────────────────────────────────────
// Zig: src/paths/paths.zig lines 13-20.
// Zig uses `std.fs.max_path_bytes` which is platform-dependent.
pub const MAX_PATH_BYTES: usize = if cfg!(target_arch = "wasm32") {
    1024
} else if cfg!(windows) {
    // std.os.windows.PATH_MAX_WIDE * 3 + 1 (UTF-8 worst-case from UTF-16).
    32767 * 3 + 1
} else if cfg!(any(target_os = "linux", target_os = "android")) {
    4096 // Linux libc::PATH_MAX
} else {
    // macOS / iOS / FreeBSD / OpenBSD / NetBSD / DragonFly / Solaris (std/c.zig PATH_MAX)
    1024
};
pub const PATH_MAX_WIDE: usize = 32767;

#[cfg(windows)]
pub type OSPathChar = u16;
#[cfg(not(windows))]
pub type OSPathChar = u8;

pub type OSPathSlice<'a> = &'a [OSPathChar];
#[cfg(windows)]
pub type OSPathSliceZ = crate::zstr::WStr;
#[cfg(not(windows))]
pub type OSPathSliceZ = crate::zstr::ZStr;

pub use bun_alloc::SEP;

/// Zig: `[MAX_PATH_BYTES]u8` stack buffer (`var buf: bun.PathBuffer = undefined`).
///
/// Canonical definition; `bun_paths::PathBuffer` re-exports this so the two
/// crates share ONE nominal type and callers can pass a `bun_paths` buffer to
/// `bun_sys::getcwd` / `bun_which::which` without a pointer cast.
///
/// NOTE on alignment: `os_path_kernel32` (Windows) reinterprets a
/// `&mut PathBuffer` as `&mut [u16]` via [`bytes_as_slice_mut`]. The language
/// only guarantees align=1 for `[u8; N]`, so that reinterpret is guarded by a
/// hard `assert!` (mirroring Zig `@alignCast`). We do *not* bump this struct
/// to `#[repr(align(2))]` because several call sites reinterpret an arbitrary
/// `&mut [u8]` *as* `PathBuffer`, and raising the nominal alignment would
/// make *those* casts unsound instead. In practice every `PathBuffer` fed to
/// the `[u16]` view is a fresh stack local or a pooled heap allocation, both
/// of which are ≥8-byte aligned on every supported target.
#[repr(transparent)]
pub struct PathBuffer(pub [u8; MAX_PATH_BYTES]);
impl PathBuffer {
    pub const ZEROED: Self = Self([0; MAX_PATH_BYTES]);
    /// Zig `= undefined`. The bytes are immediately overwritten by the syscall
    /// that fills it, so the initial contents are never observed.
    ///
    /// On Windows `MAX_PATH_BYTES` is 98 302 (vs 4 096 Linux / 1 024 macOS), so
    /// the previous `Self::ZEROED` body here was a ~100 KB `memset` at every
    /// one of the ~400 call sites — turning hot loops (glob scan, module load,
    /// stack-trace formatting) into multi-GB zero-fill workloads and timing out
    /// the leak/stress tests. Match the Zig spec and leave the bytes uninit.
    #[inline]
    #[allow(invalid_value, clippy::uninit_assumed_init)]
    pub fn uninit() -> Self {
        // SAFETY: `PathBuffer` is `repr(transparent)` over `[u8; N]`; every bit
        // pattern is a valid `u8`, and callers treat this as a write-only
        // scratch buffer (length-tracked) exactly like Zig
        // `var buf: bun.PathBuffer = undefined`. No byte is read before being
        // written by the consuming syscall / encoder.
        unsafe { core::mem::MaybeUninit::uninit().assume_init() }
    }
    #[inline]
    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        &mut self.0
    }
    #[inline]
    pub fn as_slice(&self) -> &[u8] {
        &self.0
    }
}
impl Default for PathBuffer {
    #[inline]
    fn default() -> Self {
        Self::uninit()
    }
}
impl core::ops::Deref for PathBuffer {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        &self.0
    }
}
impl core::ops::DerefMut for PathBuffer {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u8] {
        &mut self.0
    }
}

/// Zig: `[PATH_MAX_WIDE]u16`. Same newtype shape as [`PathBuffer`].
#[repr(transparent)]
pub struct WPathBuffer(pub [u16; PATH_MAX_WIDE]);
impl WPathBuffer {
    pub const ZEROED: Self = Self([0; PATH_MAX_WIDE]);
    /// Zig `= undefined`. See [`PathBuffer::uninit`] — `PATH_MAX_WIDE` is
    /// 32 767 `u16`s (~64 KB), and these are allocated per Windows syscall
    /// for UTF-8→UTF-16 path conversion, so zero-initialising dominated the
    /// hot path on Windows.
    #[inline]
    #[allow(invalid_value, clippy::uninit_assumed_init)]
    pub fn uninit() -> Self {
        // SAFETY: `repr(transparent)` over `[u16; N]`; every bit pattern is a
        // valid `u16`. Callers treat this as a write-only scratch buffer and
        // track the written length out-of-band — mirrors Zig
        // `var wbuf: bun.WPathBuffer = undefined`.
        unsafe { core::mem::MaybeUninit::uninit().assume_init() }
    }
    /// Inherent `as_slice` so `wbuf.as_slice()` resolves here instead of the
    /// unstable `<[u16]>::as_slice` (`str_as_str` feature) via `Deref`.
    #[inline]
    pub fn as_slice(&self) -> &[u16] {
        &self.0
    }
    #[inline]
    pub fn as_mut_slice(&mut self) -> &mut [u16] {
        &mut self.0
    }
}
impl Default for WPathBuffer {
    #[inline]
    fn default() -> Self {
        Self::uninit()
    }
}
impl core::ops::Deref for WPathBuffer {
    type Target = [u16];
    #[inline]
    fn deref(&self) -> &[u16] {
        &self.0
    }
}
impl core::ops::DerefMut for WPathBuffer {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u16] {
        &mut self.0
    }
}
#[cfg(windows)]
pub type OSPathBuffer = WPathBuffer;
#[cfg(not(windows))]
pub type OSPathBuffer = PathBuffer;

/// Zig: `bun.Dirname.dirname(u8, path)` → `std.fs.path.dirnamePosix` /
/// `dirnameWindows`. Faithful port (handles trailing-sep stripping and root).
pub fn dirname(path: &[u8]) -> Option<&[u8]> {
    use crate::path_sep::is_sep_native as is_sep;

    if path.is_empty() {
        return None;
    }
    // Strip trailing separators.
    let mut end = path.len();
    while end > 1 && is_sep(path[end - 1]) {
        end -= 1;
    }
    // Windows: skip drive prefix `X:` so `C:\foo` → `C:\`, `C:foo` → None.
    let root_end: usize =
        if cfg!(windows) && end >= 2 && path[1] == b':' && path[0].is_ascii_alphabetic() {
            if end >= 3 && is_sep(path[2]) { 3 } else { 2 }
        } else if is_sep(path[0]) {
            1
        } else {
            0
        };
    // Scan back for last separator after the root.
    let mut i = end;
    while i > root_end {
        i -= 1;
        if is_sep(path[i]) {
            // Zig `std.fs.path.dirnamePosix/Windows` returns up to (excluding)
            // the separator found — it does NOT collapse a preceding run of
            // separators, so `/foo//bar` → `/foo/`. Preserve that contract for
            // re-export parity with `bun_paths::dirname`.
            return Some(&path[..i]);
        }
    }
    // No separator AFTER root, but content past it (e.g. "/foo", "C:\foo"):
    // Zig returns the root prefix iff the root itself ends in a separator
    // (`"/foo"` → `"/"`, `"C:\\foo"` → `"C:\\"`). A bare drive prefix with no
    // separator (`"C:foo"`, root_end==2) falls through to `None`, matching
    // `std.fs.path.dirnameWindows`. Root-only inputs ("/", "C:\") have
    // `end == root_end` and also fall through.
    if root_end > 0 && end > root_end && is_sep(path[root_end - 1]) {
        return Some(&path[..root_end]);
    }
    None
}
