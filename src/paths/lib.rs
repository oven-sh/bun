#![allow(unused, non_snake_case, non_camel_case_types, clippy::all)]
// `Platform` is used as a const-generic param (Zig: `comptime _platform: Platform`)
// in resolve_path.rs and downstream (`bun_runtime::node::path::normalize_string_t`).
// Pinned nightly — enable the structural-match subset directly instead of the
// `PlatformT` sealed-trait workaround.
#![feature(adt_const_params)]
#![allow(incomplete_features)]

// `bun.w_path_buffer_pool` — u16 sibling. Backed by the same generic
// thread-local pool as the u8 one (path_buffer_pool.rs already handles both
// via `PoolStorage`).
#![warn(unreachable_pub)]
pub mod w_path_buffer_pool {
    use super::path_buffer_pool::{PathBufferPoolT, PoolGuard};
    use super::WPathBuffer;
    pub type Guard = PoolGuard<WPathBuffer>;
    #[inline] pub fn get() -> PoolGuard<WPathBuffer> { PathBufferPoolT::<WPathBuffer>::get() }
    #[inline] pub fn put(buf: Box<WPathBuffer>) { PathBufferPoolT::<WPathBuffer>::put(buf) }
}

// std.fs.path equivalents (PORTING.md §Crate map: never std::path).
pub const SEP: u8 = if cfg!(windows) { b'\\' } else { b'/' };
pub const SEP_STR: &str = if cfg!(windows) { "\\" } else { "/" };
pub const SEP_POSIX: u8 = b'/';
pub const SEP_WINDOWS: u8 = b'\\';

/// Port of `std.fs.path.isAbsolutePosix`.
#[inline]
pub fn is_absolute_posix(p: &[u8]) -> bool {
    !p.is_empty() && p[0] == b'/'
}

/// Generic over u8/u16. Port of `std.fs.path.isAbsoluteWindows{,WTF16}`.
pub fn is_absolute_windows_t<T: PathChar>(p: &[T]) -> bool {
    if p.is_empty() { return false; }
    let c0 = p[0];
    if c0 == T::from_u8(b'/') || c0 == T::from_u8(b'\\') { return true; }
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
pub fn is_absolute_windows(p: &[u8]) -> bool { is_absolute_windows_t::<u8>(p) }
/// `std.fs.path.isAbsoluteWindowsWTF16` — UTF-16 sibling.
#[inline]
pub fn is_absolute_windows_wtf16(p: &[u16]) -> bool { is_absolute_windows_t::<u16>(p) }

/// Port of `std.fs.path.diskDesignatorWindows` — returns the leading drive
/// designator (e.g. `C:` or `\\server\share`) or empty.
///
/// Faithful to Zig std `windowsParsePath`: no alphabetic gate on the drive
/// letter; UNC requires a *matching* separator pair (`//` or `\\`, not mixed),
/// rejects a third leading separator, and requires BOTH server and share
/// tokens — otherwise returns `b""`.
pub fn disk_designator_windows(p: &[u8]) -> &[u8] {
    if p.len() >= 2 && p[1] == b':' {
        return &p[..2];
    }
    // Single leading sep (not UNC) → no designator.
    if p.len() >= 1
        && (p[0] == b'/' || p[0] == b'\\')
        && (p.len() == 1 || (p[1] != b'/' && p[1] != b'\\'))
    {
        return b"";
    }
    if p.len() < b"//a/b".len() {
        return b"";
    }
    for &this_sep in b"/\\" {
        if p[0] == this_sep && p[1] == this_sep {
            if p[2] == this_sep {
                return b"";
            }
            // mem.tokenizeScalar(u8, p, this_sep): skip runs of `this_sep`,
            // yield non-sep tokens. Require two tokens (server + share);
            // designator is `p[..index_after_share]`.
            let mut idx = 0usize;
            let mut next = || -> Option<()> {
                while idx < p.len() && p[idx] == this_sep { idx += 1; }
                if idx == p.len() { return None; }
                while idx < p.len() && p[idx] != this_sep { idx += 1; }
                Some(())
            };
            if next().is_none() { return b""; } // server
            if next().is_none() { return b""; } // share
            return &p[..idx];
        }
    }
    b""
}

/// Character types valid in path slices (u8 / u16). Defined in resolve_path
/// (richer: IS_U16/to_ascii_upper/lit); re-exported here so `is_absolute_*_t`
/// shares the same trait as resolve_path's generics.
pub use resolve_path::PathChar;
pub const DELIMITER: u8 = if cfg!(windows) { b';' } else { b':' };

/// `bun.pathLiteral("a/b")` → NUL-terminated path with platform separators.
/// Port of `bun.zig:pathLiteral` — on POSIX returns the literal as-is; on
/// Windows rewrites `/` → `\` at compile time. Yields `&'static ZStr` so it
/// drops into `[:0]const u8` slots (`stringZ`).
#[macro_export]
macro_rules! path_literal {
    ($lit:expr) => {{
        // TODO(port-windows): const-eval `/`→`\` rewrite (const_format::str_replace).
        const __B: &[u8] = ::core::concat!($lit, "\0").as_bytes();
        // SAFETY: literal is NUL-terminated; len excludes the NUL.
        unsafe { ::bun_core::ZStr::from_raw(__B.as_ptr(), __B.len() - 1) }
    }};
}

/// `bun.OSPathLiteral` — like `path_literal!` but yields the platform path-char
/// width (`u8` on POSIX, `u16` on Windows). Port of `bun.zig:OSPathLiteral`.
#[macro_export]
macro_rules! os_path_literal {
    ($lit:literal) => {{
        #[cfg(not(windows))]
        { $crate::path_literal!($lit) }
        // TODO(port-windows): comptime UTF-16 path literal with sep rewrite.
        #[cfg(windows)]
        { ::bun_core::wstr!($lit) }
    }};
}

pub fn is_absolute(p: &[u8]) -> bool {
    #[cfg(not(windows))] { p.first() == Some(&b'/') }
    #[cfg(windows)] { is_absolute_windows(p) }
}
/// NOT a port of `std.fs.path.dirname` — this is the naive "slice before last
/// separator" used by a handful of callers that want exactly that. For Zig-std
/// `dirname` semantics (Option, trailing-slash handling, root preservation)
/// use `bun_core::dirname`.
pub fn dirname_simple(p: &[u8]) -> &[u8] {
    p.iter().rposition(|&c| c == b'/' || (cfg!(windows) && c == b'\\'))
        .map(|i| &p[..i]).unwrap_or(b"")
}
pub fn basename(p: &[u8]) -> &[u8] {
    p.iter().rposition(|&c| c == b'/' || (cfg!(windows) && c == b'\\'))
        .map(|i| &p[i+1..]).unwrap_or(p)
}

/// Port of `std.fs.path.basenamePosix` — strips trailing `/` then returns the
/// final component. `\` is NOT a separator.
pub fn basename_posix(p: &[u8]) -> &[u8] {
    if p.is_empty() { return b""; }
    let mut end = p.len();
    while end > 0 && p[end - 1] == b'/' { end -= 1; }
    if end == 0 { return b""; }
    let mut start = end;
    while start > 0 && p[start - 1] != b'/' { start -= 1; }
    &p[start..end]
}

/// Port of `std.fs.path.basenameWindows` — strips trailing `/`/`\`, treats a
/// drive designator (`X:`) as a boundary, then returns the final component.
pub fn basename_windows(p: &[u8]) -> &[u8] {
    if p.is_empty() { return b""; }
    let mut end = p.len();
    loop {
        let c = p[end - 1];
        if c == b'/' || c == b'\\' {
            end -= 1;
            if end == 0 { return b""; }
            continue;
        }
        if c == b':' && end == 2 { return b""; }
        break;
    }
    let mut start = end;
    while start > 0
        && p[start - 1] != b'/'
        && p[start - 1] != b'\\'
        && !(p[start - 1] == b':' && start - 1 == 1)
    {
        start -= 1;
    }
    &p[start..end]
}

#[inline]
fn std_basename(p: &[u8]) -> &[u8] {
    if cfg!(windows) { basename_windows(p) } else { basename_posix(p) }
}

/// Port of `std.fs.path.extension` — returns the file extension of `p`
/// **including** the leading dot, or `b""` if none. Dotfiles (`.gitignore`)
/// and basenames whose only `.` is at index 0 report no extension.
pub fn extension(p: &[u8]) -> &[u8] {
    let filename = std_basename(p);
    match filename.iter().rposition(|&c| c == b'.') {
        Some(dot) if dot > 0 => &filename[dot..],
        _ => &p[p.len()..],
    }
}

/// Port of `std.fs.path.stem` — returns the basename of `p` with the
/// extension (as defined by [`extension`]) stripped. Dotfiles keep their
/// leading dot (`.gitignore` → `.gitignore`).
pub fn stem(p: &[u8]) -> &[u8] {
    let filename = std_basename(p);
    match filename.iter().rposition(|&c| c == b'.') {
        Some(0) => p,
        Some(dot) => &filename[..dot],
        None => filename,
    }
}

// LAYERING: `PathBuffer` / `WPathBuffer` / `MAX_PATH_BYTES` / `PATH_MAX_WIDE`
// are defined once in `bun_core` (T0) and re-exported here so `bun_paths` and
// `bun_core` share a single nominal type — `bun_core::getcwd`, `bun_core::which`
// etc. accept a buffer obtained from this crate without a pointer cast.
pub use bun_core::{PathBuffer, WPathBuffer, MAX_PATH_BYTES, PATH_MAX_WIDE};

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

pub mod path_buffer_pool;

// resolve_path: enum const-generics lowered to sealed `PlatformT` trait + ZSTs
// (done). 46× E0106 remain — TLS-buf-returning wrappers need `'static` lifetime
// or out-param redesign. The `_buf`-suffixed fns (explicit `&mut [u8]` param)
// compile; the convenience wrappers don't yet. Gate the module; expose Platform.
// TODO(b2): annotate the 46 TLS-wrapper return lifetimes as `'static` (matches
// Zig "valid until next call" semantics).
pub mod resolve_path;
pub use resolve_path::{Platform, PlatformT, platform};
#[path = "Path.rs"] pub mod path;
pub use path::{AbsPath, RelPath, Path, AutoAbsPath, AutoRelPath, options as path_options, PathUnit};

/// Duck-typing surface for the `anytype` `buf` parameter on Zig path-builder
/// helpers (`appendStorePath`, `appendGlobalStoreEntryPath`, etc. in
/// `isolated_install/Installer.zig`). Zig accepted any `bun.Path(...)`
/// instantiation; Rust callers pass `Path<U, KIND, SEP, CHECK>` for arbitrary
/// const params, so expose the three operations the helpers need behind a
/// trait and blanket-impl it for every monomorphisation.
pub trait PathLike {
    fn clear(&mut self);
    fn append(&mut self, bytes: &[u8]);
    fn append_fmt(&mut self, args: core::fmt::Arguments<'_>);
}
impl<U: PathUnit, const KIND: u8, const SEP: u8, const CHK: u8> PathLike
    for path::Path<U, KIND, SEP, CHK>
{
    #[inline] fn clear(&mut self) { path::Path::clear(self) }
    #[inline] fn append(&mut self, bytes: &[u8]) { let _ = path::Path::append(self, bytes); }
    #[inline] fn append_fmt(&mut self, args: core::fmt::Arguments<'_>) {
        let _ = path::Path::append_fmt(self, args);
    }
}

/// Zig: `bun.Dirname` namespace — width-generic `std.fs.path.dirname`
/// (POSIX `/` on Unix, disk-designator-aware on Windows). Backed by
/// `path::dirname_generic`.
#[allow(non_snake_case)]
pub mod Dirname {
    use super::path::{dirname_generic, PathUnit};

    #[inline]
    pub fn dirname<U: PathUnit>(p: &[U]) -> Option<&[U]> {
        dirname_generic(p)
    }

    #[inline]
    pub fn dirname_u16(p: &[u16]) -> Option<&[u16]> {
        dirname_generic(p)
    }
}

/// Convenience: `std.fs.path.dirname` for `u8` paths (returns `None` for
/// root / no-parent). Prefer `Dirname::dirname::<T>` for width-generic use.
#[inline]
pub fn dirname(p: &[u8]) -> Option<&[u8]> {
    path::dirname_generic(p)
}
#[path = "EnvPath.rs"] pub mod env_path;
pub use env_path::{EnvPath, EnvPathInput, PathComponentBuilder};

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
    use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::io::Write as _;
    use std::sync::OnceLock;

    use bun_core::ZStr;

    use crate::resolve_path::{is_sep_any, last_index_of_sep};

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
            if d.len() > 1 && d.last() == Some(&crate::SEP) {
                &d[..d.len() - 1]
            } else {
                d
            }
        }

        /// Port of `FileSystem.tmpname` in `src/resolver/fs.zig`:
        /// `pub fn tmpname(extname: string, buf: []u8, hash: u64) std.fmt.BufPrintError![:0]u8`
        ///
        /// Writes `.<hex(hash|nanos)>-<HEX(counter)>.<extname>\0` into `buf` and returns
        /// the NUL-terminated borrow. Static (no `&self`) — matches the Zig.
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
                bstr::BStr::new(extname),
            )
            .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
            let written = len - cursor.len();
            if written >= len {
                return Err(bun_core::err!("NoSpaceLeft"));
            }
            buf[written] = 0;
            // SAFETY: `buf[written] == 0` written immediately above; `buf[..=written]` is
            // exclusively borrowed for `'b`.
            Ok(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), written) })
        }
    }

    /// Port of `PathName` in `src/resolver/fs.zig:1582` — parsed (dir, base, ext,
    /// filename) view over a borrowed path slice. All four fields point into the
    /// same backing allocation.
    // `#[repr(C)]`: field-identical mirror of `bun_logger::fs::PathName` /
    // `bun_resolver::fs::PathName`; `bun_bundler::bundle_v2` bit-casts between
    // them pending unification, so layout must be pinned.
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
            Self { base: b"", dir: b"", ext: b"", filename: b"" }
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
            if !self.ext.is_empty() && self.ext[0] == b'.' { &self.ext[1..] } else { self.ext }
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

        /// Zig: `PathName.dirWithTrailingSlash`.
        #[inline]
        pub fn dir_with_trailing_slash(&self) -> &'a [u8] {
            // The three strings basically always point to the same underlying ptr
            // so if dir does not have a trailing slash, but is spaced one apart from the basename
            // we can assume there is a trailing slash there
            // so we extend the original slice's length by one
            if self.dir.is_empty() {
                return b"./";
            }
            let extend = (!is_sep_any(self.dir[self.dir.len() - 1])
                && (self.dir.as_ptr() as usize + self.dir.len() + 1)
                    == self.base.as_ptr() as usize) as usize;
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
                && matches!(path[0], b'a'..=b'z' | b'A'..=b'Z')
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

            let filename = if !dir.is_empty() { &path_[dir.len() + 1..] } else { path_ };

            PathName { dir, base, ext, filename }
        }
    }

    /// Port of `Path` in `src/resolver/fs.zig:1727` — the bundler/resolver's logical
    /// path (display `pretty`, canonical `text`, `namespace`, parsed `name`).
    ///
    /// NOTE: distinct from `crate::Path` (the buffer-backed AbsPath/RelPath). This is
    /// the *resolver* `Path`; addressed as `bun_paths::fs::Path`.
    // `#[repr(C)]`: see note on `PathName` — bit-cast target across the three
    // `fs::Path` mirrors until they unify.
    #[repr(C)]
    #[derive(Debug, Clone)]
    pub struct Path<'a> {
        /// Display path — relative to cwd in the bundler; forward-slash on Windows.
        pub pretty: &'a [u8],
        /// Canonical location. For `file` namespace, usually absolute with native seps.
        pub text: &'a [u8],
        pub namespace: &'a [u8],
        // TODO(@paperclover): investigate removing or simplifying this property (it's 64 bytes)
        pub name: PathName<'a>,
        pub is_disabled: bool,
        pub is_symlink: bool,
    }

    impl<'a> Default for Path<'a> {
        #[inline]
        fn default() -> Self {
            Self {
                pretty: b"",
                text: b"",
                namespace: b"",
                name: PathName::default(),
                is_disabled: false,
                is_symlink: false,
            }
        }
    }

    impl<'a> Path<'a> {
        // Zig: `pub const empty = Fs.Path.init("");`
        pub const EMPTY: Path<'static> = Path {
            pretty: b"",
            text: b"",
            namespace: b"file",
            name: PathName { base: b"", dir: b"", ext: b"", filename: b"" },
            is_disabled: false,
            is_symlink: false,
        };

        /// Zig: `Path.init(text)` — sets `text`/`pretty` to the same slice, parses `name`,
        /// namespace defaults to `"file"`.
        pub fn init(text: &'a [u8]) -> Self {
            Self {
                pretty: text,
                text,
                namespace: b"file",
                name: PathName::init(text),
                is_disabled: false,
                is_symlink: false,
            }
        }

        /// Zig: `Path.initWithPretty`.
        pub fn init_with_pretty(text: &'a [u8], pretty: &'a [u8]) -> Self {
            Self {
                pretty,
                text,
                namespace: b"file",
                name: PathName::init(text),
                is_disabled: false,
                is_symlink: false,
            }
        }

        /// Zig: `Path.initWithNamespace`.
        pub fn init_with_namespace(text: &'a [u8], namespace: &'a [u8]) -> Self {
            Self {
                pretty: text,
                text,
                namespace,
                name: PathName::init(text),
                is_disabled: false,
                is_symlink: false,
            }
        }

        #[inline] pub fn empty() -> Path<'static> { Path::EMPTY }
        #[inline] pub fn text(&self) -> &'a [u8] { self.text }
        #[inline] pub fn pretty(&self) -> &'a [u8] { self.pretty }
        #[inline] pub fn namespace(&self) -> &'a [u8] { self.namespace }

        #[inline]
        pub fn is_file(&self) -> bool {
            self.namespace.is_empty() || self.namespace == b"file"
        }

        #[inline]
        pub fn is_data_url(&self) -> bool { self.namespace == b"dataurl" }

        #[inline]
        pub fn is_bun(&self) -> bool { self.namespace == b"bun" }

        #[inline]
        pub fn is_macro(&self) -> bool { self.namespace == b"macro" }

        /// Zig: `pub inline fn sourceDir(this: *const Path) string`
        #[inline]
        pub fn source_dir(&self) -> &'a [u8] {
            self.name.dir_with_trailing_slash()
        }

        /// Zig: `pub inline fn prettyDir(this: *const Path) string`
        #[inline]
        pub fn pretty_dir(&self) -> &'a [u8] {
            self.name.dir_with_trailing_slash()
        }

        /// Zig: `Path.isNodeModule` — checks for `<sep>node_modules<sep>` in the
        /// parsed dir component (`name.dir`, NOT `text`).
        pub fn is_node_module(&self) -> bool {
            use bstr::ByteSlice;
            const NEEDLE: &[u8] =
                const_format::concatcp!(crate::SEP_STR, "node_modules", crate::SEP_STR).as_bytes();
            self.name.dir.rfind(NEEDLE).is_some()
        }

        /// Zig: `Path.isJSXFile`.
        #[inline]
        pub fn is_jsx_file(&self) -> bool {
            let f = self.name.filename;
            f.ends_with(b".jsx") || f.ends_with(b".tsx")
        }

        /// Zig: `Path.keyForIncrementalGraph`.
        #[inline]
        pub fn key_for_incremental_graph(&self) -> &'a [u8] {
            if self.is_file() { self.text } else { self.pretty }
        }

        /// Zig: `Path.setRealpath`.
        pub fn set_realpath(&mut self, to: &'a [u8]) {
            let old_path = self.text;
            self.text = to;
            self.name = PathName::init(to);
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/paths/paths.zig (27 lines)
//   confidence: high
//   todos:      1
//   notes:      thin re-export crate root; PathBuffer/WPathBuffer are #[repr(transparent)] newtypes (uninit/ZEROED + Deref to slice); MAX_PATH_BYTES cfg arms mirror Zig std values — verify in Phase B
// ──────────────────────────────────────────────────────────────────────────
