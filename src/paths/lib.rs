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
// MOVE_DOWN(CYCLEBREAK): ZStr/WStr live in bun_core (T0).
#[cfg(windows)]
pub type OSPathSliceZ = bun_core::WStr;
#[cfg(not(windows))]
pub type OSPathSliceZ = bun_core::ZStr;

pub type OSPathSlice = [OSPathChar];

#[cfg(windows)]
pub type OSPathBuffer = WPathBuffer;
#[cfg(not(windows))]
pub type OSPathBuffer = PathBuffer;

#[path = "Path.rs"]
mod path;
#[path = "EnvPath.rs"]
mod env_path;
mod path_buffer_pool;

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN(CYCLEBREAK): Windows path-prefix constants — relocated from
// `bun_sys::windows` (src/sys/windows/windows.zig) so tier-1 callers
// (`bun_str::immutable::paths`, this crate's `Path.rs`) can resolve them
// without depending upward on `bun_sys`.
// ──────────────────────────────────────────────────────────────────────────
pub mod windows {
    /// `\??\` — NT object-manager prefix (UTF-16).
    pub const NT_OBJECT_PREFIX: [u16; 4] = ['\\' as u16, '?' as u16, '?' as u16, '\\' as u16];
    /// `\??\UNC\` — NT object-manager UNC prefix (UTF-16).
    pub const NT_UNC_OBJECT_PREFIX: [u16; 8] = [
        '\\' as u16, '?' as u16, '?' as u16, '\\' as u16,
        'U' as u16, 'N' as u16, 'C' as u16, '\\' as u16,
    ];
    /// `\\?\` — Win32 long-path prefix (UTF-16).
    pub const LONG_PATH_PREFIX: [u16; 4] = ['\\' as u16, '\\' as u16, '?' as u16, '\\' as u16];

    /// `\??\` — NT object-manager prefix (UTF-8/ASCII).
    pub const NT_OBJECT_PREFIX_U8: [u8; 4] = *b"\\??\\";
    /// `\??\UNC\` — NT object-manager UNC prefix (UTF-8/ASCII).
    pub const NT_UNC_OBJECT_PREFIX_U8: [u8; 8] = *b"\\??\\UNC\\";
    /// `\\?\` — Win32 long-path prefix (UTF-8/ASCII).
    pub const LONG_PATH_PREFIX_U8: [u8; 4] = *b"\\\\?\\";

    /// Generic accessor: returns `&LONG_PATH_PREFIX_U8` for `U = u8`, `&LONG_PATH_PREFIX` for
    /// `U = u16`. Replaces the Zig comptime `match (Unit) { .u8 => ..., .u16 => ... }` arms in
    /// `src/paths/Path.zig` so `Path::<U, ..>::from_long_path` stays width-generic.
    #[inline]
    pub fn long_path_prefix_for<U: crate::path::PathUnit>() -> &'static [U] {
        U::LONG_PATH_PREFIX
    }
}

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN(CYCLEBREAK): `bun_resolver::is_package_path` /
// `is_package_path_not_absolute` — pure path predicates with no resolver
// state. Source: src/resolver/resolver.zig:6-26. Pulled down so `bun_install`
// and `bun_js_parser` can drop their `bun_resolver` edge.
// ──────────────────────────────────────────────────────────────────────────

/// Returns true if `path` is a bare package specifier (e.g. `react`, `@scope/pkg`),
/// i.e. not absolute and not relative (`./`, `../`, `.`, `..`).
///
/// Always rejects POSIX-absolute (`/...`); on Windows additionally rejects
/// Windows-absolute forms via `std.fs.path.isAbsolute` semantics.
pub fn is_package_path(path: &[u8]) -> bool {
    // Zig: `!std.fs.path.isAbsolute(path)` — platform-dependent.
    #[cfg(not(windows))]
    let absolute = path.first() == Some(&b'/');
    #[cfg(windows)]
    let absolute = is_absolute_windows(path);

    !absolute && is_package_path_not_absolute(path)
}

/// Precondition: `non_absolute_path` is known to not be absolute.
pub fn is_package_path_not_absolute(non_absolute_path: &[u8]) -> bool {
    #[cfg(debug_assertions)]
    {
        debug_assert!(!non_absolute_path.starts_with(b"/"));
    }

    let p = non_absolute_path;
    if p.starts_with(b"./") || p.starts_with(b"../") || p == b"." || p == b".." {
        return false;
    }
    #[cfg(windows)]
    if p.starts_with(b".\\") || p.starts_with(b"..\\") {
        return false;
    }
    true
}

// Local mirror of `std.fs.path.isAbsoluteWindows` for `is_package_path` only;
// the full `Platform::is_absolute_t` lives in `resolve_path.rs`.
#[cfg(windows)]
#[inline]
fn is_absolute_windows(path: &[u8]) -> bool {
    if path.is_empty() {
        return false;
    }
    if path[0] == b'/' || path[0] == b'\\' {
        return true;
    }
    // Drive designator: `X:\` or `X:/`
    path.len() >= 3
        && path[0].is_ascii_alphabetic()
        && path[1] == b':'
        && (path[2] == b'/' || path[2] == b'\\')
}

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN(CYCLEBREAK): `bun_resolver::fs` — TYPE_ONLY subset.
// Source: src/resolver/fs.zig.
//
// The full `FileSystem` (DirEntry cache, RealFS impl, FilenameStore/DirnameStore)
// stays in `bun_resolver`; only the path-shaped types (`Path`, `PathName`,
// `PathContentsPair`) and the `top_level_dir` singleton accessor move here so
// lower tiers (`bun_logger`, `bun_paths::resolve_path`, `bun_paths::Path`) can
// resolve them without a `bun_resolver` edge.
// ──────────────────────────────────────────────────────────────────────────
pub mod fs {
    use core::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;

    /// Minimal `FileSystem` singleton: holds `top_level_dir` only. The Zig original
    /// (`src/resolver/fs.zig:14`) also owns the dir-entry cache and filename arenas;
    /// those remain in `bun_resolver` and reach back here for the cwd string.
    ///
    /// Concurrency: Zig's `instance_loaded: bool` + `instance: FileSystem = undefined`
    /// init-once pair → `OnceLock<FileSystem>` per PORTING.md §Concurrency.
    pub struct FileSystem {
        // Zig: `top_level_dir: stringZ` — owned, NUL-terminated. Owned `String` here;
        // callers receive `&[u8]` (matches `[]const u8` callsites in resolve_path.rs).
        top_level_dir: String,
    }

    static INSTANCE: OnceLock<FileSystem> = OnceLock::new();
    // Kept as a separate flag so `instance_loaded()` is a cheap relaxed load that
    // mirrors the Zig `pub var instance_loaded: bool`.
    static INSTANCE_LOADED: AtomicBool = AtomicBool::new(false);

    impl FileSystem {
        #[inline]
        pub fn instance_loaded() -> bool {
            INSTANCE_LOADED.load(Ordering::Relaxed)
        }

        /// Panics if `init` has not been called. Mirrors Zig's `&instance` after
        /// `instance_loaded` is asserted.
        #[inline]
        pub fn instance() -> &'static FileSystem {
            INSTANCE.get().expect("FileSystem.instance accessed before init")
        }

        /// Zig: `FileSystem.init(top_level_dir)` (force=false path). Higher-tier
        /// `bun_resolver::fs` calls this during its own `initWithForce` after it
        /// resolves the cwd.
        pub fn init(top_level_dir: impl Into<String>) -> &'static FileSystem {
            let _ = INSTANCE.set(FileSystem { top_level_dir: top_level_dir.into() });
            INSTANCE_LOADED.store(true, Ordering::Release);
            INSTANCE.get().unwrap()
        }

        #[inline]
        pub fn top_level_dir(&self) -> &[u8] {
            self.top_level_dir.as_bytes()
        }

        /// Zig: `topLevelDirWithoutTrailingSlash`.
        pub fn top_level_dir_without_trailing_slash(&self) -> &[u8] {
            let d = self.top_level_dir.as_bytes();
            if d.len() > 1 && matches!(d.last(), Some(b'/') | Some(b'\\')) {
                &d[..d.len() - 1]
            } else {
                d
            }
        }
    }

    /// TYPE_ONLY: `src/resolver/fs.zig:1582` — parsed (dir, base, ext, filename) view
    /// over a borrowed path slice. All four fields point into the same backing string.
    // TODO(port): Zig `string` is `[]const u8` borrowed; modelled as `&'static str` for
    // now so `Default`/const-init work. Phase B introduces a lifetime param if callers
    // need non-'static borrows.
    #[derive(Debug, Clone, Copy, Default)]
    pub struct PathName {
        pub base: &'static str,
        pub dir: &'static str,
        /// includes the leading `.`; extensionless files report `""`
        pub ext: &'static str,
        pub filename: &'static str,
    }

    /// TYPE_ONLY: `src/resolver/fs.zig:1727` — the bundler/resolver's logical path
    /// (display `pretty`, canonical `text`, `namespace`, parsed `name`).
    ///
    /// NOTE: distinct from `crate::Path` (the buffer-backed AbsPath/RelPath). This is
    /// the *resolver* `Path`; addressed as `bun_paths::fs::Path`.
    #[derive(Debug, Clone, Default)]
    pub struct Path {
        /// Display path — relative to cwd in the bundler; forward-slash on Windows.
        pub pretty: &'static str,
        /// Canonical location. For `file` namespace, usually absolute with native seps.
        pub text: &'static str,
        pub namespace: &'static str,
        // TODO(@paperclover): investigate removing or simplifying this property (it's 64 bytes)
        pub name: PathName,
        pub is_disabled: bool,
        pub is_symlink: bool,
    }

    impl Path {
        /// Zig: `Path.init(text)` — sets `text`/`pretty` to the same slice, parses `name`,
        /// namespace defaults to `"file"`.
        pub fn init(text: &'static str) -> Self {
            Self {
                pretty: text,
                text,
                namespace: "file",
                name: PathName::default(), // TODO(port): wire PathName::init(text) once ported
                is_disabled: false,
                is_symlink: false,
            }
        }

        #[inline]
        pub fn is_file(&self) -> bool {
            self.namespace.is_empty() || self.namespace == "file"
        }
    }

    /// TYPE_ONLY: `src/resolver/fs.zig:1505`.
    #[derive(Debug, Clone, Default)]
    pub struct PathContentsPair {
        pub path: Path,
        // Zig: `contents: string` (`[]const u8`).
        pub contents: &'static str,
    }
}

pub use self::fs::PathContentsPair;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/paths/paths.zig (27 lines)
//   confidence: high
//   todos:      1
//   notes:      thin re-export crate root; PathBuffer/WPathBuffer are #[repr(transparent)] newtypes (uninit/ZEROED + Deref to slice); MAX_PATH_BYTES cfg arms mirror Zig std values — verify in Phase B
// ──────────────────────────────────────────────────────────────────────────
