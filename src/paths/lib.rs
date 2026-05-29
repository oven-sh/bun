#![warn(unused_must_use)]
#![feature(adt_const_params)]
#![allow(incomplete_features)]
// `bun.w_path_buffer_pool` — u16 sibling. Backed by the same generic
// thread-local pool as the u8 one (path_buffer_pool.rs already handles both
// via `PoolStorage`).
pub mod w_path_buffer_pool {
    use super::WPathBuffer;
    use super::path_buffer_pool::{PathBufferPoolT, PoolGuard};
    pub type Guard = PoolGuard<WPathBuffer>;
    #[inline]
    pub fn get() -> PoolGuard<WPathBuffer> {
        PathBufferPoolT::<WPathBuffer>::get()
    }
    #[inline]
    pub fn put(buf: Box<WPathBuffer>) {
        PathBufferPoolT::<WPathBuffer>::put(buf)
    }
}

pub mod string_paths;
pub mod strings {
    pub use super::string_paths as paths;
    pub use super::string_paths::from_w_path as from_wpath;
    pub use super::string_paths::to_w_path_normalized as to_wpath_normalized;
    pub use super::string_paths::*;
    pub use super::string_paths::{
        basename, is_windows_absolute_path_missing_drive_letter, remove_leading_dot_slash,
        starts_with_windows_drive_letter_t, without_trailing_slash,
    };
    pub use bun_core::strings::*;
}

// std.fs.path equivalents (PORTING.md §Crate map: never std::path).
pub use bun_alloc::SEP;
pub use bun_alloc::SEP_STR;

pub const NODE_MODULES_NEEDLE: &[u8] =
    const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes();

/// `node_modules<SEP>` — trailing-separator-only variant, used where the byte
/// immediately before `node_modules` is not guaranteed to be a separator (start of
/// a relative segment, or when the leading sep was already consumed).
pub const NODE_MODULES_TRAILING: &[u8] =
    const_format::concatcp!("node_modules", SEP_STR).as_bytes();

pub(crate) const SEP_POSIX: u8 = b'/';
pub const SEP_WINDOWS: u8 = b'\\';

/// Port of `std.fs.path.isAbsolutePosix`.
#[inline]
pub fn is_absolute_posix(p: &[u8]) -> bool {
    !p.is_empty() && p[0] == b'/'
}

/// Generic over u8/u16. Port of `std.fs.path.isAbsoluteWindows{,WTF16}`.
pub fn is_absolute_windows_t<T: PathChar>(p: &[T]) -> bool {
    if p.is_empty() {
        return false;
    }
    let c0 = p[0];
    if c0 == T::from_u8(b'/') || c0 == T::from_u8(b'\\') {
        return true;
    }
    // Drive letter: `X:\` or `X:/` — Zig std does NOT require `X` be alphabetic.
    if p.len() >= 3
        && p[1] == T::from_u8(b':')
        && (p[2] == T::from_u8(b'/') || p[2] == T::from_u8(b'\\'))
    {
        return true;
    }
    false
}
#[inline]
pub fn is_absolute_windows(p: &[u8]) -> bool {
    is_absolute_windows_t::<u8>(p)
}
/// `std.fs.path.isAbsoluteWindowsWTF16` — UTF-16 sibling.
#[inline]
pub fn is_absolute_windows_wtf16(p: &[u16]) -> bool {
    is_absolute_windows_t::<u16>(p)
}

#[inline]
pub(crate) fn disk_designator_windows(p: &[u8]) -> &[u8] {
    &p[..crate::path::disk_designator_len_windows::<u8>(p)]
}

/// Character types valid in path slices (u8 / u16). Canonical definition;
/// `resolve_path`, `Path::PathUnit`, `bun_sys::make_path::MakePathUnit`,
/// `bun_runtime::node::path::PathCharCwd`, and `bun_core::Ch` all extend it.
mod path_char;
pub use path_char::PathChar;
pub const DELIMITER: u8 = if cfg!(windows) { b';' } else { b':' };

#[macro_export]
macro_rules! path_literal {
    ($lit:expr) => {{
        const __B: &[u8] = $lit.as_bytes();
        const __N: usize = __B.len();
        const __OUT: [u8; __N + 1] = {
            let mut o = [0u8; __N + 1];
            let mut i = 0;
            while i < __N {
                o[i] = if cfg!(windows) && __B[i] == b'/' {
                    b'\\'
                } else {
                    __B[i]
                };
                i += 1;
            }
            o // o[__N] == 0 (NUL terminator)
        };
        // Explicit `&__OUT` borrow for guaranteed rvalue static promotion
        // (mirrors `os_path_literal!`).
        const __REF: &[u8; __N + 1] = &__OUT;
        // SAFETY: __REF[__N] == 0 (NUL terminator); len excludes it.
        unsafe { ::bun_core::ZStr::from_raw(__REF.as_ptr(), __N) }
    }};
}

#[macro_export]
macro_rules! os_path_literal {
    ($lit:literal) => {{
        #[cfg(not(windows))]
        {
            $crate::path_literal!($lit)
        }
        #[cfg(windows)]
        {
            // Const-eval ASCII→UTF-16LE widening with `/`→`\` rewrite, then
            // wrap as `&'static WStr` (NUL-terminated). The literal is always
            // a hard-coded path component so the ASCII restriction holds.
            const __B: &[u8] = $lit.as_bytes();
            const __N: usize = __B.len();
            const __W: [u16; __N + 1] = {
                let mut out = [0u16; __N + 1];
                let mut i = 0;
                while i < __N {
                    debug_assert!(__B[i].is_ascii(), "os_path_literal!() must be ASCII");
                    out[i] = if __B[i] == b'/' {
                        b'\\' as u16
                    } else {
                        __B[i] as u16
                    };
                    i += 1;
                }
                out
            };
            const __WREF: &[u16; __N + 1] = &__W;
            // SAFETY: __WREF[__N] == 0 (NUL terminator); len excludes it.
            unsafe { ::bun_core::WStr::from_raw(__WREF.as_ptr(), __N) }
        }
    }};
}

#[inline]
pub fn is_absolute(p: &[u8]) -> bool {
    bun_core::path_sep::is_absolute_native(p)
}

#[inline]
pub fn is_absolute_loose(p: &[u8]) -> bool {
    resolve_path::Platform::Loose.is_absolute(p)
}

fn join_sep_vec(parts: &[&[u8]]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut prev_last: Option<u8> = None;
    for p in parts {
        if p.is_empty() {
            continue;
        }
        let this = match prev_last {
            None => *p,
            Some(prev) => {
                let prev_sep = is_sep_native(prev);
                let this_sep = is_sep_native(p[0]);
                if !prev_sep && !this_sep {
                    out.push(SEP);
                }
                if prev_sep && this_sep { &p[1..] } else { *p }
            }
        };
        out.extend_from_slice(this);
        prev_last = Some(p[p.len() - 1]);
    }
    out
}
/// `std.fs.path.join` / `std.fs.path.joinZ` — non-normalizing concatenation
/// with the native separator. When `SENTINEL` the trailing NUL is included in
/// the returned slice (Zig: `[:0]u8` coerced to `[]u8`).
#[inline]
pub fn join_sep_maybe_z<const SENTINEL: bool>(parts: &[&[u8]]) -> Box<[u8]> {
    let mut out = join_sep_vec(parts);
    if SENTINEL {
        out.push(0);
    }
    out.into_boxed_slice()
}
pub fn dirname_simple(p: &[u8]) -> &[u8] {
    p.iter()
        .rposition(|&c| c == b'/' || (cfg!(windows) && c == b'\\'))
        .map(|i| &p[..i])
        .unwrap_or(b"")
}
/// Port of `std.fs.path.basename` — strips trailing separators before slicing
/// the final component (so `basename("/a/b/")` is `"b"`, not `""`).
/// Canonical impls (width-generic over `PathByte`) live in `bun_core::strings`.
pub use bun_core::strings::{PathByte, basename, basename_posix, basename_windows};

/// Port of `std.fs.path.extension` — returns the file extension of `p`
/// **including** the leading dot, or `b""` if none. Dotfiles (`.gitignore`)
/// and basenames whose only `.` is at index 0 report no extension.
pub fn extension(p: &[u8]) -> &[u8] {
    let filename = basename(p);
    match filename.iter().rposition(|&c| c == b'.') {
        Some(dot) if dot > 0 => &filename[dot..],
        _ => &p[p.len()..],
    }
}

/// Port of `std.fs.path.stem` — returns the basename of `p` with the
/// extension (as defined by [`extension`]) stripped. Dotfiles keep their
/// leading dot (`.gitignore` → `.gitignore`).
pub fn stem(p: &[u8]) -> &[u8] {
    let filename = basename(p);
    match filename.iter().rposition(|&c| c == b'.') {
        Some(0) => p,
        Some(dot) => &filename[..dot],
        None => filename,
    }
}

pub use bun_core::{MAX_PATH_BYTES, PATH_MAX_WIDE, PathBuffer, WPathBuffer};
/// Zig spells the wide-path capacity `bun.MAX_WPATH` (`libuv.zig` uses the same
/// alias); keep both names so ported call sites resolve without churn.
pub const MAX_WPATH: usize = PATH_MAX_WIDE;

#[cfg(windows)]
pub type OSPathChar = u16;
#[cfg(not(windows))]
pub type OSPathChar = u8;

// Zig: `[:0]const OSPathChar`. Callers borrow as `&OSPathSliceZ`.
#[cfg(windows)]
pub type OSPathSliceZ = bun_core::WStr;
#[cfg(not(windows))]
pub type OSPathSliceZ = bun_core::ZStr;

pub type OSPathSlice = [OSPathChar];

#[cfg(windows)]
pub type OSPathBuffer = WPathBuffer;
#[cfg(not(windows))]
pub type OSPathBuffer = PathBuffer;

pub mod path_buffer_pool;

pub mod resolve_path;
pub use resolve_path::{Platform, PlatformT, platform};
pub mod component_iterator;
pub use component_iterator::{
    Component, ComponentIterator, MakePathStep, PathFormat, component_iterator, make_path_with,
};
pub use path_buffer_pool::os_path_buffer_pool;
pub use resolve_path::{
    dangerously_convert_path_to_posix_in_place, dangerously_convert_path_to_windows_in_place,
    dirname_w, is_drive_letter, is_drive_letter_t, is_sep_any, is_sep_any_t, is_sep_native,
    is_sep_native_t, is_sep_posix, is_sep_posix_t, is_sep_win32, is_sep_win32_t,
    join_abs_string_buf, join_abs_string_buf_z, join_string_buf_wz, path_to_posix_buf,
    relative_to_common_path_buf, slashes_to_posix_in_place, slashes_to_windows_in_place,
    windows_volume_name_len,
};
#[path = "Path.rs"]
pub mod path;
pub use path::{
    AbsPath, AutoAbsPath, AutoRelPath, Path, PathUnit, RelPath, options as path_options,
};

pub trait PathLike {
    fn clear(&mut self);
    fn append(&mut self, bytes: &[u8]);
    fn append_fmt(&mut self, args: core::fmt::Arguments<'_>);
}
impl<U: PathUnit, const KIND: u8, const SEP: u8> PathLike
    for path::Path<U, KIND, SEP, { path::options::CheckLength::ASSUME }>
{
    #[inline]
    fn clear(&mut self) {
        path::Path::clear(self)
    }
    #[inline]
    fn append(&mut self, bytes: &[u8]) {
        use path::options::AssumeOk as _;
        path::Path::append(self, bytes).assume_ok()
    }
    #[inline]
    fn append_fmt(&mut self, args: core::fmt::Arguments<'_>) {
        use path::options::AssumeOk as _;
        path::Path::append_fmt(self, args).assume_ok()
    }
}

/// Zig: `bun.Dirname` namespace — width-generic `std.fs.path.dirname`
/// (POSIX `/` on Unix, disk-designator-aware on Windows). Backed by
/// `path::dirname_generic`.
#[allow(non_snake_case)]
pub mod Dirname {
    use super::path::{PathUnit, dirname_generic};

    #[inline]
    pub fn dirname<U: PathUnit>(p: &[U]) -> Option<&[U]> {
        dirname_generic(p)
    }

    #[inline]
    pub fn dirname_u16(p: &[u16]) -> Option<&[u16]> {
        dirname_generic(p)
    }
}

#[cfg(not(windows))]
pub use bun_core::dirname;
#[cfg(windows)]
#[inline]
pub fn dirname(p: &[u8]) -> Option<&[u8]> {
    path::dirname_generic(p)
}
#[path = "EnvPath.rs"]
pub mod env_path;
pub use env_path::{EnvPath, EnvPathInput, PathComponentBuilder};

pub mod windows {
    /// `\??\` — NT object-manager prefix (UTF-16).
    pub(crate) const NT_OBJECT_PREFIX: [u16; 4] =
        ['\\' as u16, '?' as u16, '?' as u16, '\\' as u16];
    /// `\??\UNC\` — NT object-manager UNC prefix (UTF-16).
    pub(crate) const NT_UNC_OBJECT_PREFIX: [u16; 8] = [
        '\\' as u16,
        '?' as u16,
        '?' as u16,
        '\\' as u16,
        'U' as u16,
        'N' as u16,
        'C' as u16,
        '\\' as u16,
    ];
    /// `\\?\` — Win32 long-path prefix (UTF-16).
    pub(crate) const LONG_PATH_PREFIX: [u16; 4] =
        ['\\' as u16, '\\' as u16, '?' as u16, '\\' as u16];

    /// `\??\` — NT object-manager prefix (UTF-8/ASCII).
    pub(crate) const NT_OBJECT_PREFIX_U8: [u8; 4] = *b"\\??\\";
    /// `\??\UNC\` — NT object-manager UNC prefix (UTF-8/ASCII).
    pub(crate) const NT_UNC_OBJECT_PREFIX_U8: [u8; 8] = *b"\\??\\UNC\\";
    /// `\\?\` — Win32 long-path prefix (UTF-8/ASCII).
    pub const LONG_PATH_PREFIX_U8: [u8; 4] = *b"\\\\?\\";

    /// `src/paths/Path.zig` so `Path::<U, ..>::from_long_path` stays width-generic.
    #[inline]
    pub fn long_path_prefix_for<U: crate::path::PathUnit>() -> &'static [U] {
        U::LONG_PATH_PREFIX
    }
}

#[inline]
pub fn is_package_path(path: &[u8]) -> bool {
    !is_absolute(path) && is_package_path_not_absolute(path)
}

/// Precondition: `non_absolute_path` is known to not be absolute.
#[inline]
pub fn is_package_path_not_absolute(non_absolute_path: &[u8]) -> bool {
    debug_assert!(!is_absolute(non_absolute_path));
    debug_assert!(!non_absolute_path.starts_with(b"/"));

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

pub mod fs {
    use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::io::Write as _;
    use std::sync::OnceLock;

    use bun_core::ZStr;

    use crate::resolve_path::{is_sep_any, last_index_of_sep};

    pub struct FileSystem {
        top_level_dir: Vec<u8>,
    }

    static INSTANCE: OnceLock<FileSystem> = OnceLock::new();
    // Kept as a separate flag so `instance_loaded()` is a cheap relaxed load that
    // mirrors the Zig `pub var instance_loaded: bool`.
    static INSTANCE_LOADED: AtomicBool = AtomicBool::new(false);

    // Zig: `var tmpname_id_number = std.atomic.Value(u32).init(0);`
    static TMPNAME_ID_NUMBER: AtomicU32 = AtomicU32::new(0);

    impl FileSystem {
        #[inline]
        pub fn instance_loaded() -> bool {
            INSTANCE_LOADED.load(Ordering::Relaxed)
        }

        /// Panics if `init` has not been called. Mirrors Zig's `&instance` after
        /// `instance_loaded` is asserted.
        #[inline]
        pub fn instance() -> &'static FileSystem {
            INSTANCE
                .get()
                .expect("FileSystem.instance accessed before init")
        }

        /// Zig: `FileSystem.init(top_level_dir)` (force=false path). Higher-tier
        /// `bun_resolver::fs` calls this during its own `initWithForce` after it
        /// resolves the cwd. Takes raw bytes — POSIX cwd is not guaranteed UTF-8.
        pub fn init(top_level_dir: &[u8]) -> &'static FileSystem {
            let _ = INSTANCE.set(FileSystem {
                top_level_dir: top_level_dir.to_vec(),
            });
            INSTANCE_LOADED.store(true, Ordering::Release);
            INSTANCE.get().unwrap()
        }

        #[inline]
        pub fn top_level_dir(&self) -> &[u8] {
            let d = bun_core::top_level_dir();
            // Fallback to the seeded value only if `bun_core` was never set
            // (unit tests that init this module directly).
            if d == b"." {
                self.top_level_dir.as_slice()
            } else {
                d
            }
        }

        /// Zig: `topLevelDirWithoutTrailingSlash`.
        pub fn top_level_dir_without_trailing_slash(&self) -> &[u8] {
            let d = self.top_level_dir();
            if d.len() > 1 && d.last() == Some(&crate::SEP) {
                &d[..d.len() - 1]
            } else {
                d
            }
        }

        pub fn tmpname<'b>(
            extname: &[u8],
            buf: &'b mut [u8],
            hash: u64,
        ) -> Result<&'b mut ZStr, bun_core::Error> {
            // Zig: `@as(u64, @truncate(@as(u128, hash) | @as(u128, std.time.nanoTimestamp())))`
            let hex_value: u64 =
                (u128::from(hash) | (bun_core::time::nano_timestamp() as u128)) as u64;

            let len = buf.len();
            let mut cursor = &mut buf[..];
            // Zig: bun.fmt.hexIntLower / hexIntUpper — fixed-width, zero-padded
            // to `@bitSizeOf(Int)/4` digits (u64 → 16, u32 → 8).
            write!(
                &mut cursor,
                ".{:016x}-{:08X}.{}",
                hex_value,
                TMPNAME_ID_NUMBER.fetch_add(1, Ordering::Relaxed),
                bun_core::fmt::s(extname),
            )
            .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
            let written = len - cursor.len();
            if written >= len {
                return Err(bun_core::err!("NoSpaceLeft"));
            }
            buf[written] = 0;
            Ok(ZStr::from_buf_mut(buf, written))
        }
    }

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    pub struct PathName<'a> {
        pub base: &'a [u8],
        pub dir: &'a [u8],
        /// includes the leading `.`; extensionless files report `""`
        pub ext: &'a [u8],
        pub filename: &'a [u8],
    }

    impl<'a> Default for PathName<'a> {
        #[inline]
        fn default() -> Self {
            Self {
                base: b"",
                dir: b"",
                ext: b"",
                filename: b"",
            }
        }
    }

    impl<'a> PathName<'a> {
        /// Zig: `PathName.findExtname`.
        pub fn find_extname(path: &[u8]) -> &[u8] {
            let start = last_index_of_sep(path).map(|i| i + 1).unwrap_or(0);
            let base = &path[start..];
            if let Some(dot) = base.iter().rposition(|&c| c == b'.') {
                if dot > 0 {
                    return &base[dot..];
                }
            }
            b""
        }

        #[inline]
        pub fn ext_without_leading_dot(&self) -> &'a [u8] {
            if !self.ext.is_empty() && self.ext[0] == b'.' {
                &self.ext[1..]
            } else {
                self.ext
            }
        }

        /// Zig: `PathName.nonUniqueNameStringBase`.
        /// `/bar/foo/index.js` → `foo`; `/bar/foo.js` → `foo`.
        pub fn non_unique_name_string_base(&self) -> &'a [u8] {
            // /bar/foo/index.js -> foo
            if !self.dir.is_empty() && self.base == b"index" {
                // "/index" -> "index"
                return PathName::init(self.dir).base;
            }
            debug_assert!(!self.base.contains(&b'/'));
            // /bar/foo.js -> foo
            self.base
        }

        /// Zig: `PathName.dirOrDot`.
        #[inline]
        pub fn dir_or_dot(&self) -> &'a [u8] {
            if self.dir.is_empty() { b"." } else { self.dir }
        }

        /// Zig: `PathName.fmtIdentifier`.
        #[inline]
        pub fn fmt_identifier(&self) -> bun_core::fmt::FormatValidIdentifier<'a> {
            bun_core::fmt::fmt_identifier(self.non_unique_name_string_base())
        }

        /// Zig: `PathName.dirWithTrailingSlash`.
        #[inline]
        pub fn dir_with_trailing_slash(&self) -> &'a [u8] {
            if self.dir.is_empty() {
                return b"./";
            }
            let extend = (!is_sep_any(self.dir[self.dir.len() - 1])
                && (self.dir.as_ptr() as usize + self.dir.len() + 1) == self.base.as_ptr() as usize)
                as usize;
            // SAFETY: when `extend == 1`, `dir.ptr[dir.len]` is the separator byte
            // immediately preceding `base` — both slices borrow the same underlying
            // allocation (the `path_` passed to `init`).
            unsafe { core::slice::from_raw_parts(self.dir.as_ptr(), self.dir.len() + extend) }
        }

        /// Zig: `PathName.init`.
        pub fn init(path_: &'a [u8]) -> PathName<'a> {
            #[cfg(all(windows, debug_assertions))]
            {
                // This path is likely incorrect. I think it may be *possible*
                // but it is almost entirely certainly a bug.
                debug_assert!(!path_.starts_with(b"/:/"));
                debug_assert!(!path_.starts_with(b"\\:\\"));
            }

            let mut path = path_;
            let mut base = path;
            let ext: &[u8];
            let mut dir = path;
            let mut is_absolute = true;
            let has_disk_designator = path.len() > 2
                && path[1] == b':'
                && path[0].is_ascii_alphabetic()
                && is_sep_any(path[2]);
            if has_disk_designator {
                path = &path[2..];
            }

            while let Some(i) = last_index_of_sep(path) {
                // Stop if we found a non-trailing slash
                if i + 1 != path.len() && path.len() > i + 1 {
                    base = &path[i + 1..];
                    dir = &path[0..i];
                    is_absolute = false;
                    break;
                }

                // Ignore trailing slashes
                path = &path[0..i];
            }

            // Strip off the extension
            if let Some(dot) = base.iter().rposition(|&c| c == b'.') {
                ext = &base[dot..];
                base = &base[0..dot];
            } else {
                ext = b"";
            }

            if is_absolute {
                dir = b"";
            }

            if base.len() > 1 && is_sep_any(base[base.len() - 1]) {
                base = &base[0..base.len() - 1];
            }

            if !is_absolute && has_disk_designator {
                dir = &path_[0..dir.len() + 2];
            }

            let filename = if !dir.is_empty() {
                &path_[dir.len() + 1..]
            } else {
                path_
            };

            PathName {
                dir,
                base,
                ext,
                filename,
            }
        }
    }

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    pub struct Path<'a> {
        /// Display path — relative to cwd in the bundler; forward-slash on Windows.
        pub pretty: &'a [u8],
        /// Canonical location. For `file` namespace, usually absolute with native seps.
        pub text: &'a [u8],
        pub namespace: &'a [u8],
        pub is_disabled: bool,
        pub is_symlink: bool,
    }

    const _: () = assert!(core::mem::size_of::<Path<'static>>() <= 56);

    impl<'a> Default for Path<'a> {
        #[inline]
        fn default() -> Self {
            Self {
                pretty: b"",
                text: b"",
                namespace: b"",
                is_disabled: false,
                is_symlink: false,
            }
        }
    }

    impl<'a> Path<'a> {
        /// Erase the borrow lifetime — some storage types
        /// (`ImportRecord.path`, `Graph.input_files`) are pinned to
        /// `Path<'static>` until the arena lifetime is re-threaded crate-wide.
        ///
        /// # Safety
        /// Every borrowed slice in `self` (text/pretty/namespace) must outlive
        /// every read through the returned `Path<'static>`.
        #[inline]
        pub unsafe fn into_static(self) -> Path<'static> {
            #[inline(always)]
            unsafe fn d(s: &[u8]) -> &'static [u8] {
                // SAFETY: caller contract on `into_static`.
                unsafe { &*core::ptr::from_ref::<[u8]>(s) }
            }
            // SAFETY: caller contract — see fn doc.
            unsafe {
                Path {
                    pretty: d(self.pretty),
                    text: d(self.text),
                    namespace: d(self.namespace),
                    is_disabled: self.is_disabled,
                    is_symlink: self.is_symlink,
                }
            }
        }

        // Zig: `pub const empty = Fs.Path.init("");`
        pub const EMPTY: Path<'static> = Path {
            pretty: b"",
            text: b"",
            namespace: b"file",
            is_disabled: false,
            is_symlink: false,
        };

        /// Parsed (dir/base/ext/filename) view of `text`. Computed on demand —
        /// the four slices borrow `text`, so the returned `PathName` carries
        /// lifetime `'a` (same as the old stored field).
        #[inline]
        pub fn name(&self) -> PathName<'a> {
            PathName::init(self.text)
        }

        /// Zig: `Path.init(text)` — sets `text`/`pretty` to the same slice,
        /// namespace defaults to `"file"`.
        #[inline]
        pub const fn init(text: &'a [u8]) -> Self {
            Self {
                pretty: text,
                text,
                namespace: b"file",
                is_disabled: false,
                is_symlink: false,
            }
        }

        /// Zig: `Path.initWithPretty`.
        #[inline]
        pub const fn init_with_pretty(text: &'a [u8], pretty: &'a [u8]) -> Self {
            Self {
                pretty,
                text,
                namespace: b"file",
                is_disabled: false,
                is_symlink: false,
            }
        }

        /// Zig: `Path.initWithNamespace`.
        #[inline]
        pub const fn init_with_namespace(text: &'a [u8], namespace: &'a [u8]) -> Self {
            Self {
                pretty: text,
                text,
                namespace,
                is_disabled: false,
                is_symlink: false,
            }
        }

        #[inline]
        pub const fn init_with_namespace_virtual(
            text: &'static [u8],
            namespace: &'static [u8],
            pretty: &'static [u8],
        ) -> Path<'static> {
            Path {
                pretty,
                is_symlink: true,
                text,
                namespace,
                is_disabled: false,
            }
        }

        /// Zig: `Path.initForKitBuiltIn`.
        /// PORT NOTE: same comptime-concat caveat as `init_with_namespace_virtual`.
        #[inline]
        pub const fn init_for_kit_built_in(
            namespace: &'static [u8],
            pretty: &'static [u8],
            text: &'static [u8],
        ) -> Path<'static> {
            Path {
                pretty,
                is_symlink: true,
                text,
                namespace,
                is_disabled: false,
            }
        }

        /// Zig: `Path.assertPrettyIsValid` — debug-only check that `pretty`
        /// contains no backslashes (Windows). No-op on POSIX.
        #[inline]
        pub fn assert_pretty_is_valid(&self) {
            #[cfg(all(windows, debug_assertions))]
            if self.pretty.contains(&b'\\') {
                panic!(
                    "Expected pretty file path to have only forward slashes, got '{}'",
                    bstr::BStr::new(self.pretty)
                );
            }
        }

        /// Zig: `Path.assertFilePathIsAbsolute` — CI-assert only.
        #[inline]
        pub fn assert_file_path_is_absolute(&self) {
            if bun_core::Environment::CI_ASSERT && self.is_file() {
                debug_assert!(crate::is_absolute(self.text));
            }
        }

        #[inline]
        pub fn empty() -> Path<'static> {
            Path::EMPTY
        }
        #[inline]
        pub fn text(&self) -> &'a [u8] {
            self.text
        }
        #[inline]
        pub fn pretty(&self) -> &'a [u8] {
            self.pretty
        }
        #[inline]
        pub fn namespace(&self) -> &'a [u8] {
            self.namespace
        }

        #[inline]
        pub fn is_file(&self) -> bool {
            self.namespace.is_empty() || self.namespace == b"file"
        }

        #[inline]
        pub fn is_data_url(&self) -> bool {
            self.namespace == b"dataurl"
        }

        #[inline]
        pub fn is_bun(&self) -> bool {
            self.namespace == b"bun"
        }

        #[inline]
        pub fn is_macro(&self) -> bool {
            self.namespace == b"macro"
        }

        /// Zig: `pub inline fn sourceDir(this: *const Path) string`
        #[inline]
        pub fn source_dir(&self) -> &'a [u8] {
            self.name().dir_with_trailing_slash()
        }

        /// Zig: `pub inline fn prettyDir(this: *const Path) string`
        #[inline]
        pub fn pretty_dir(&self) -> &'a [u8] {
            self.name().dir_with_trailing_slash()
        }

        /// Zig: `Path.isNodeModule` — checks for `<sep>node_modules<sep>` in the
        /// parsed dir component (`name.dir`, NOT `text`).
        pub fn is_node_module(&self) -> bool {
            use bstr::ByteSlice;
            self.name().dir.rfind(crate::NODE_MODULES_NEEDLE).is_some()
        }

        /// Zig: `Path.isJSXFile`.
        #[inline]
        pub fn is_jsx_file(&self) -> bool {
            let f = self.name().filename;
            f.ends_with(b".jsx") || f.ends_with(b".tsx")
        }

        /// Zig: `Path.keyForIncrementalGraph`.
        #[inline]
        pub fn key_for_incremental_graph(&self) -> &'a [u8] {
            if self.is_file() {
                self.text
            } else {
                self.pretty
            }
        }

        /// Zig: `Path.setRealpath`.
        pub fn set_realpath(&mut self, to: &'a [u8]) {
            let old_path = self.text;
            self.text = to;
            self.pretty = old_path;
            self.is_symlink = true;
        }
    }

    /// Port of `PathContentsPair` in `src/resolver/fs.zig:1505`.
    #[derive(Debug, Clone, Default)]
    pub struct PathContentsPair<'a> {
        pub path: Path<'a>,
        // Zig: `contents: string` (`[]const u8`).
        pub contents: &'a [u8],
    }
}

pub use self::fs::PathContentsPair;

// ported from: src/paths/paths.zig
