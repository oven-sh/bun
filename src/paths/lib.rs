pub use self::path::Path;
pub use self::path::AbsPath;
pub use self::path::AutoAbsPath;
pub use self::path::RelPath;
pub use self::path::AutoRelPath;

pub use self::env_path::EnvPath;

pub use self::path_buffer_pool::path_buffer_pool;
pub use self::path_buffer_pool::w_path_buffer_pool;
pub use self::path_buffer_pool::os_path_buffer_pool;

// TODO(port): Zig's `std.fs.max_path_bytes` is platform-derived; values below mirror Zig std.
#[cfg(target_family = "wasm")]
pub const MAX_PATH_BYTES: usize = 1024;
#[cfg(target_os = "linux")]
pub const MAX_PATH_BYTES: usize = 4096;
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd", target_os = "openbsd", target_os = "netbsd", target_os = "dragonfly"))]
pub const MAX_PATH_BYTES: usize = 1024;
#[cfg(windows)]
pub const MAX_PATH_BYTES: usize = PATH_MAX_WIDE * 3 + 1;

/// `[MAX_PATH_BYTES]u8`. Newtype (not a bare alias) so callers get `PathBuffer::uninit()` /
/// `PathBuffer::ZEROED` per PORTING.md type/idiom map.
#[repr(transparent)]
pub struct PathBuffer(pub [u8; MAX_PATH_BYTES]);

impl PathBuffer {
    pub const ZEROED: Self = Self([0; MAX_PATH_BYTES]);
    #[inline]
    pub fn uninit() -> Self {
        // SAFETY: all-zero is a valid [u8; N].
        unsafe { core::mem::zeroed() }
    }
}
impl core::ops::Deref for PathBuffer {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] { &self.0 }
}
impl core::ops::DerefMut for PathBuffer {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u8] { &mut self.0 }
}

/// Mirrors Zig `std.os.windows.PATH_MAX_WIDE` (32767).
pub const PATH_MAX_WIDE: usize = 32767;

/// `[PATH_MAX_WIDE]u16`. Same newtype shape as `PathBuffer` so `OSPathBuffer::uninit()` works on Windows.
#[repr(transparent)]
pub struct WPathBuffer(pub [u16; PATH_MAX_WIDE]);

impl WPathBuffer {
    pub const ZEROED: Self = Self([0; PATH_MAX_WIDE]);
    #[inline]
    pub fn uninit() -> Self {
        // SAFETY: all-zero is a valid [u16; N].
        unsafe { core::mem::zeroed() }
    }
}
impl core::ops::Deref for WPathBuffer {
    type Target = [u16];
    #[inline]
    fn deref(&self) -> &[u16] { &self.0 }
}
impl core::ops::DerefMut for WPathBuffer {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u16] { &mut self.0 }
}

#[cfg(windows)]
pub type OSPathChar = u16;
#[cfg(not(windows))]
pub type OSPathChar = u8;

// Zig: `[:0]const OSPathChar`. Callers borrow as `&OSPathSliceZ`.
#[cfg(windows)]
pub type OSPathSliceZ = bun_str::WStr;
#[cfg(not(windows))]
pub type OSPathSliceZ = bun_str::ZStr;

pub type OSPathSlice = [OSPathChar];

#[cfg(windows)]
pub type OSPathBuffer = WPathBuffer;
#[cfg(not(windows))]
pub type OSPathBuffer = PathBuffer;

mod path;
mod env_path;
mod path_buffer_pool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/paths/paths.zig (27 lines)
//   confidence: high
//   todos:      1
//   notes:      thin re-export crate root; PathBuffer/WPathBuffer are #[repr(transparent)] newtypes (uninit/ZEROED + Deref to slice); MAX_PATH_BYTES cfg arms mirror Zig std values — verify in Phase B
// ──────────────────────────────────────────────────────────────────────────
