#![warn(unused_must_use)]
#![feature(core_io_borrowed_buf)]

use std::borrow::Cow;

mod error;
pub use error::NameTooLong;

// `bun.w_path_buffer_pool` — u16 sibling. Backed by the same generic
// thread-local pool as the u8 one (path_buffer_pool.rs already handles both
// via `PoolStorage`).
pub mod w_path_buffer_pool {
    use super::WPathBuffer;
    use super::path_buffer_pool::{PathBufferPoolT, PoolGuard};
    #[inline]
    pub fn get() -> PoolGuard<WPathBuffer> {
        PathBufferPoolT::<WPathBuffer>::get()
    }
}

// Native separator re-exports (PORTING.md §Crate map: never std::path).
pub use bun_alloc::SEP;
pub use bun_alloc::SEP_STR;

/// The name of the package in `node_modules` that the file at `path` is in
pub fn package_of(path: &[u8]) -> Option<Vec<u8>> {
    let separators: &[u8] = if cfg!(windows) { b"/\\" } else { b"/" };
    let names: Vec<&[u8]> = bun_core::strings::split_any(path, separators).collect();
    let at = names.iter().rposition(|it| *it == b"node_modules")?;
    match names[at + 1..] {
        [scope @ [b'@', ..], name, _, ..] => Some([scope, b"/", name].concat()),
        [name, _, ..] => Some(name.to_vec()),
        _ => None,
    }
}

/// `<SEP>node_modules<SEP>` — platform-dependent infix needle for detecting whether
/// a path passes through a `node_modules` directory.
pub const NODE_MODULES_NEEDLE: &[u8] =
    const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes();

mod path_char;
pub use path_char::PathChar;
pub const DELIMITER: u8 = if cfg!(windows) { b';' } else { b':' };

/// `bun.pathLiteral("a/b")` → NUL-terminated path with platform separators.
/// On POSIX returns the literal as-is; on
/// Windows rewrites `/` → `\` at compile time. Yields `&'static ZStr` so it
/// drops into `[:0]const u8` slots (`stringZ`).
#[macro_export]
macro_rules! path_literal {
    ($lit:expr) => {{
        // On Windows, const-eval `/`→`\` so
        // callers feeding `\\?\`-prefixed NT paths get backslashes (Win32 does
        // NOT normalize `/` under the `\\?\` namespace). On POSIX the rewrite
        // condition is `false` and bytes copy through unchanged.
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
        const __Z: &::bun_core::ZStr = ::bun_core::ZStr::from_slice_with_nul(&__OUT);
        __Z
    }};
}

/// `bun.OSPathLiteral` — like `path_literal!` but yields the platform path-char
/// width (`u8` on POSIX, `u16` on Windows).
///
/// Evaluates to `&'static OSPathSliceZ` (i.e. `&ZStr` on POSIX, `&WStr` on
/// Windows). Both deref to `&[OSPathChar]`, so call sites that want a bare
/// slice (e.g. `skip_dirnames: &[&OSPathSlice]`) get it via auto-deref.
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
            const __Z: &::bun_core::WStr = ::bun_core::WStr::from_slice_with_nul(&__W);
            __Z
        }
    }};
}

#[inline(always)]
pub fn is_sep<C: PathChar>(unit: C) -> bool {
    Host::is_sep(unit)
}

#[inline(always)]
pub fn has_leading_sep<C: PathChar>(path: &[C]) -> bool {
    Host::has_leading_sep(path)
}

#[inline(always)]
pub fn has_trailing_sep<C: PathChar>(path: &[C]) -> bool {
    Host::has_trailing_sep(path)
}

/// Removes all of them.
#[inline(always)]
pub fn without_leading_sep<C: PathChar>(path: &[C]) -> &[C] {
    Host::without_leading_sep(path)
}

/// Removes all of them, but a root keeps its own. `\\server\share` needs none.
#[inline]
pub fn without_trailing_sep<C: PathUnit>(path: &[C]) -> &[C] {
    Host::without_trailing_sep(path)
}

/// Removes one `./`.
#[inline(always)]
pub fn without_leading_dot_slash(path: &[u8]) -> &[u8] {
    Host::without_leading_dot_slash(path)
}

/// `/`, `C:\`, `C:`, `\\server\share\`, `\\?\C:\`, or empty.
#[inline]
pub fn root<C: PathUnit>(path: &[C]) -> &[C] {
    Host::root(path)
}

/// The root without its separator: `C:`, `\\server\share`, `\\?\C:`, or empty.
#[inline]
pub fn volume(path: &[u8]) -> &[u8] {
    Host::volume(path)
}

#[inline]
pub fn is_absolute<C: PathUnit>(path: &[C]) -> bool {
    Host::is_absolute(path)
}

/// False for `\a` on Windows, which depends on the current drive.
#[inline]
pub fn is_fully_qualified<C: PathUnit>(path: &[C]) -> bool {
    Host::is_fully_qualified(path)
}

/// `C:\a` for `\\?\C:\a` and `\??\C:\a`. A share needs `Path::strip_nt_prefix`.
#[inline]
pub fn without_nt_prefix(path: &[u8]) -> &[u8] {
    Host::without_nt_prefix(path)
}

/// `None` for a root or a single component.
#[inline]
pub fn dirname<C: PathUnit>(path: &[C]) -> Option<&[C]> {
    Host::dirname(path)
}

/// [`dirname`], but a root is its own parent. Empty for `a`, and `C:` for `C:a`.
#[inline]
pub fn dirname_or_root(path: &[u8]) -> &[u8] {
    Host::dirname_or_root(path)
}

/// Empty for `/` and `C:\`. `share` for `\\server\share`, as in Node.
#[inline]
pub fn basename<C: PathUnit>(path: &[C]) -> &[C] {
    Host::basename(path)
}

/// Includes the dot. `.gitignore` and `..` have none.
#[inline]
pub fn extension<C: PathUnit>(path: &[C]) -> &[C] {
    Host::extension(path)
}

/// The basename without its extension.
#[inline]
pub fn stem(path: &[u8]) -> &[u8] {
    Host::stem(path)
}

/// `path` relative to `dir`: empty if they are equal, `None` if `path` is outside of it. Both have to be normalized.
#[inline]
pub fn strip_prefix<'a>(path: &'a [u8], dir: &[u8]) -> Option<&'a [u8]> {
    Host::strip_prefix(path, dir)
}

/// The components after the root. `.` and `..` are kept.
#[inline]
pub fn components(path: &[u8]) -> impl DoubleEndedIterator<Item = &[u8]> {
    Host::components(path)
}

/// `path`, then each parent up to the root or the first component. Only a root ends with a separator.
#[inline]
pub fn ancestors<C: PathUnit>(path: &[C]) -> impl Iterator<Item = &[C]> {
    Host::ancestors(path)
}

/// Whether `path` has a root, or its `..` lead above the directory it starts in.
#[inline]
pub fn climbs_out<C: PathUnit>(path: &[C]) -> bool {
    Host::climbs_out(path)
}

/// The longest path that each of `paths` is in or equal to.
#[inline]
pub fn common_ancestor<'a>(paths: impl Iterator<Item = &'a [u8]>) -> Option<&'a [u8]> {
    Host::common_ancestor(paths)
}

/// `path` with this platform's separator, which is how the OS reports paths and how users expect to see them.
#[inline]
pub fn to_native(path: &[u8]) -> Cow<'_, [u8]> {
    if cfg!(not(windows)) {
        return Cow::Borrowed(path);
    }
    bun_core::strings::replace_char(path, b'/', b'\\')
}

/// See [`to_native`].
#[inline]
pub fn to_native_in_place<C: PathChar>(path: &mut [C]) {
    Host::to_native_in_place(path);
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ParentEqual {
    Parent,
    Equal,
    Unrelated,
}

/// Like [`strip_prefix`], but ASCII case is ignored wherever the file system is likely to, as on macOS.
pub fn is_parent_or_equal(parent: &[u8], child: &[u8]) -> ParentEqual {
    let ignores_case = cfg!(not(any(target_os = "linux", target_os = "android")));
    let parent = without_trailing_sep(parent);
    let parent = match child.get(..parent.len()) {
        Some(start) if ignores_case && start.eq_ignore_ascii_case(parent) => start,
        _ => parent,
    };
    match strip_prefix(child, parent) {
        Some(b"") => ParentEqual::Equal,
        Some(_) => ParentEqual::Parent,
        None => ParentEqual::Unrelated,
    }
}

// LAYERING: `PathBuffer` / `WPathBuffer` / `MAX_PATH_BYTES` / `PATH_MAX_WIDE`
// are defined once in `bun_core` (T0) and re-exported here so `bun_paths` and
// `bun_core` share a single nominal type.
pub use bun_core::{MAX_PATH_BYTES, PATH_MAX_WIDE, PathBuffer, WPathBuffer};

#[cfg(windows)]
pub type OSPathChar = u16;
#[cfg(not(windows))]
pub type OSPathChar = u8;

// NUL-terminated; callers borrow as `&OSPathSliceZ`.
#[cfg(windows)]
pub type OSPathSliceZ = bun_core::WStr;
#[cfg(not(windows))]
pub type OSPathSliceZ = bun_core::ZStr;

pub type OSPathSlice = [OSPathChar];

pub mod path_buffer_pool;

pub mod portable;
pub use portable::{from_portable, to_portable, to_portable_in_place};
#[path = "Path.rs"]
mod path;
pub use path::{OSPath, Path, StackPath};
mod path_backend;
mod path_ops;
mod path_style;
use path_style::{Host, PathStyle as _};
mod path_unit;
pub use path_unit::PathUnit;
#[path = "EnvPath.rs"]
pub mod env_path;
pub use env_path::EnvPath;

// ──────────────────────────────────────────────────────────────────────────
// `is_package_path` / `is_package_path_not_absolute` — pure path predicates
// with no resolver state. Lives here
// (not bun_resolver) so bun_install / bun_js_parser can drop their resolver
// edge; bun_resolver re-exports these for its own callers.
// ──────────────────────────────────────────────────────────────────────────

/// Returns true if `path` is a bare package specifier (e.g. `react`, `@scope/pkg`),
/// i.e. not absolute and not relative (`./`, `../`, `.`, `..`).
///
/// Always rejects POSIX-absolute (`/...`); on Windows additionally rejects
/// Windows-absolute forms via [`is_absolute`] semantics.
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
    let dot_relative = p.starts_with(b"./") || p.starts_with(b"../") || p == b"." || p == b"..";
    #[cfg(windows)]
    let dot_relative = dot_relative || p.starts_with(b".\\") || p.starts_with(b"..\\");
    !dot_relative
}

// ──────────────────────────────────────────────────────────────────────────
// `fs` — TYPE_ONLY subset of resolver fs.
//
// The full `FileSystem` (DirEntry cache, RealFS impl, FilenameStore/DirnameStore)
// stays in `bun_resolver`; only the path-shaped types (`Path`, `PathName`)
// and the `top_level_dir` singleton accessor move here so
// lower tiers (`bun_logger`, `bun_paths::Path`) can
// resolve them without a `bun_resolver` edge.
// ──────────────────────────────────────────────────────────────────────────
pub mod fs {
    use core::sync::atomic::{AtomicU32, Ordering};
    use std::sync::OnceLock;

    use bun_core::{ZStr, strings};

    use crate::is_sep;
    use crate::path_style::{Host, last_index_of_sep};

    /// Minimal `FileSystem` singleton: holds `top_level_dir` only. The dir-entry
    /// cache and filename arenas remain in `bun_resolver` and reach back here
    /// for the cwd string.
    ///
    /// Concurrency: init-once via `OnceLock<FileSystem>`.
    pub struct FileSystem {
        // Stored as raw bytes (not `String`): POSIX paths are arbitrary byte
        // sequences, not guaranteed UTF-8, and every reader
        // wants `&[u8]`.
        top_level_dir: Vec<u8>,
    }

    static INSTANCE: OnceLock<FileSystem> = OnceLock::new();

    /// Like [`FileSystem::top_level_dir`], but release builds get `.` before `init`.
    #[inline]
    pub(crate) fn top_level_dir() -> &'static [u8] {
        debug_assert!(INSTANCE.get().is_some());
        INSTANCE
            .get()
            .map_or_else(bun_core::top_level_dir, FileSystem::top_level_dir)
    }

    static TMPNAME_ID_NUMBER: AtomicU32 = AtomicU32::new(0);

    impl FileSystem {
        /// Panics if `init` has not been called.
        #[inline]
        pub fn instance() -> &'static FileSystem {
            INSTANCE
                .get()
                .expect("FileSystem.instance accessed before init")
        }

        /// Higher-tier `bun_resolver::fs` calls this during its own `initWithForce` after it
        /// resolves the cwd. Takes raw bytes — POSIX cwd is not guaranteed UTF-8.
        pub fn init(top_level_dir: &[u8]) -> &'static FileSystem {
            let _ = INSTANCE.set(FileSystem {
                top_level_dir: top_level_dir.to_vec(),
            });
            INSTANCE.get().unwrap()
        }

        /// `PackageManager.init` reassigns the top-level dir after walking up
        /// to the workspace root. The canonical
        /// writable storage lives in `bun_core::TOP_LEVEL_DIR` (updated by
        /// `bun_resolver::FileSystem::set_top_level_dir`). Delegate the read
        /// there so `Path::from_top_level_dir` observes the post-chdir value
        /// instead of the `OnceLock` snapshot taken at process start.
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

        /// The directory the process started in; `process.chdir()` does not move it.
        #[inline]
        pub fn initial_top_level_dir(&self) -> &[u8] {
            self.top_level_dir.as_slice()
        }

        /// Writes `.<hex(random^nanos)>-<HEX(counter)>.<extname>\0` into `buf` and returns
        /// the NUL-terminated borrow. Static (no `&self`).
        pub fn tmpname<'b>(
            extname: &[u8],
            buf: &'b mut [u8],
        ) -> Result<&'b ZStr, bun_errno::SystemErrno> {
            // `fast_random()` differs between processes but repeats between threads, so the counter separates threads and calls. The clock separates processes when `BUN_DEBUG_HASH_RANDOM_SEED` pins `fast_random()`.
            let hex_value: u64 =
                bun_core::fast_random() ^ (bun_core::time::nano_timestamp() as u64);

            // Fixed-width, zero-padded hex (u64 → 16 digits, u32 → 8).
            bun_core::fmt::buf_print_z(
                buf,
                format_args!(
                    ".{:016x}-{:08X}.{}",
                    hex_value,
                    TMPNAME_ID_NUMBER.fetch_add(1, Ordering::Relaxed),
                    bun_core::fmt::s(extname),
                ),
            )
            .map_err(|_| bun_errno::SystemErrno::ENOSPC)
        }
    }

    /// Parsed (dir, base, ext,
    /// filename) view over a borrowed path slice. All four fields point into the
    /// same backing allocation.
    ///
    /// CANONICAL: `bun_paths::fs::PathName<'static>` / `bun_resolver::fs::PathName` are
    /// re-exports of this type (D090).
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
        /// Returns the extension of `path` including the leading `.`, or `""`
        /// for extensionless / dotfile basenames.
        pub fn find_extname(path: &[u8]) -> &[u8] {
            let start = last_index_of_sep::<Host>(path).map(|i| i + 1).unwrap_or(0);
            let base = &path[start..];
            if let Some(dot) = strings::last_index_of_char(base, b'.') {
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

        /// `/bar/foo/index.js` → `foo`; `/bar/foo.js` → `foo`.
        pub fn non_unique_name_string_base(&self) -> &'a [u8] {
            // /bar/foo/index.js -> foo
            if !self.dir.is_empty() && self.base == b"index" {
                // "/index" -> "index"
                return PathName::init(self.dir).base;
            }
            debug_assert!(!strings::contains_char(self.base, b'/'));
            // /bar/foo.js -> foo
            self.base
        }

        /// Formats [`Self::non_unique_name_string_base`] as a valid JS
        /// identifier.
        #[inline]
        pub fn fmt_identifier(&self) -> bun_core::fmt::FormatValidIdentifier<'a> {
            bun_core::fmt::fmt_identifier(self.non_unique_name_string_base())
        }

        /// The dir component with its trailing separator restored
        /// (`"./"` when the dir is empty).
        #[inline]
        pub fn dir_with_trailing_slash(&self) -> &'a [u8] {
            // The three strings basically always point to the same underlying ptr
            // so if dir does not have a trailing slash, but is spaced one apart from the basename
            // we can assume there is a trailing slash there
            // so we extend the original slice's length by one
            if self.dir.is_empty() {
                return b"./";
            }
            let extend = (!is_sep(self.dir[self.dir.len() - 1])
                && (self.dir.as_ptr() as usize + self.dir.len() + 1) == self.base.as_ptr() as usize)
                as usize;
            // SAFETY: when `extend == 1`, `dir.ptr[dir.len]` is the separator byte
            // immediately preceding `base` — both slices borrow the same underlying
            // allocation (the `path_` passed to `init`).
            unsafe { core::slice::from_raw_parts(self.dir.as_ptr(), self.dir.len() + extend) }
        }

        /// Parses `path_` into its (dir, base, ext, filename) components; all
        /// returned slices borrow `path_`.
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
            let has_disk_designator = cfg!(windows)
                && path.len() > 2
                && path[1] == b':'
                && path[0].is_ascii_alphabetic()
                && is_sep(path[2]);
            if has_disk_designator {
                path = &path[2..];
            }

            while let Some(i) = last_index_of_sep::<Host>(path) {
                // Stop if we found a non-trailing slash
                if i + 1 != path.len() && path.len() > i + 1 {
                    base = &path[i + 1..];
                    dir = &path[0..i];
                    is_absolute = false;
                    break;
                }

                // Ignore trailing slashes
                path = &path[0..i];
                base = path;
            }

            // Strip off the extension
            if let Some(dot) = strings::last_index_of_char(base, b'.') {
                ext = &base[dot..];
                base = &base[0..dot];
            } else {
                ext = b"";
            }

            if is_absolute {
                dir = b"";
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

    /// The bundler/resolver's logical
    /// path (display `pretty`, canonical `text`, `namespace`, parsed `name`).
    ///
    /// NOTE: distinct from `crate::Path` (the buffer that paths are built in). This is
    /// the *resolver* `Path`; addressed as `bun_paths::fs::Path`.
    ///
    /// CANONICAL: `bun_resolver::fs::Path` is a re-export of this type (D090). Resolver-tier methods (`dupe_alloc`, `loader`, `hash_key`,
    /// …) live on `bun_resolver::fs::PathResolverExt`.
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

    /// True when `namespace` is the canonical `file` namespace (empty or `"file"`).
    #[inline]
    pub fn is_file_namespace(namespace: &[u8]) -> bool {
        namespace.is_empty() || namespace == b"file"
    }

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
        pub(crate) const EMPTY: Path<'static> = Path {
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

        /// Sets `text`/`pretty` to the same slice,
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

        /// Like [`Self::init`] but with a caller-supplied display (`pretty`)
        /// path.
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

        /// Like [`Self::init`] but with a caller-supplied namespace instead
        /// of `"file"`.
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

        /// `const_format::concatcp!` can't accept fn-param `&str`, so callers pass
        /// the precomputed `concatcp!` result as `pretty`.
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

        /// Debug-only check that `pretty`
        /// contains no backslashes (Windows). No-op on POSIX.
        #[inline]
        pub fn assert_pretty_is_valid(&self) {
            #[cfg(all(windows, debug_assertions))]
            if strings::contains_char(self.pretty, b'\\') {
                panic!(
                    "Expected pretty file path to have only forward slashes, got '{}'",
                    bstr::BStr::new(self.pretty)
                );
            }
        }

        /// CI-assert only.
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
        pub fn namespace(&self) -> &'a [u8] {
            self.namespace
        }

        #[inline]
        pub fn is_file(&self) -> bool {
            is_file_namespace(self.namespace)
        }

        #[inline]
        pub fn is_data_url(&self) -> bool {
            self.namespace == b"dataurl"
        }

        /// Directory of `text`, with trailing separator.
        #[inline]
        pub fn source_dir(&self) -> &'a [u8] {
            self.name().dir_with_trailing_slash()
        }

        /// Directory used for display purposes, with trailing separator.
        #[inline]
        pub fn pretty_dir(&self) -> &'a [u8] {
            self.name().dir_with_trailing_slash()
        }

        /// Checks for `<sep>node_modules<sep>` in the
        /// parsed dir component (`name.dir`, NOT `text`).
        pub fn is_node_module(&self) -> bool {
            strings::contains(self.name().dir, crate::NODE_MODULES_NEEDLE)
        }

        /// Checks for a package in `node_modules` (in any case) or in the install cache.
        pub fn is_dependency(&self) -> bool {
            let dir = self.name().dir;
            let share = strings::tokenize_any(crate::volume(dir), b"/\\");
            let mut components = share.chain(crate::components(dir)).peekable();
            while let Some(component) = components.next() {
                if strings::contains(component, b"@@@")
                    || component.starts_with(b"@G@")
                    || (component.eq_ignore_ascii_case(b"node_modules")
                        && components.peek().is_some())
                {
                    return true;
                }
            }
            false
        }

        /// Key used to identify this path in the incremental graph: the real
        /// `text` for `file:` paths, the `pretty` form otherwise.
        #[inline]
        pub fn key_for_incremental_graph(&self) -> &'a [u8] {
            if self.is_file() {
                self.text
            } else {
                self.pretty
            }
        }

        /// Records the resolved symlink target: `text` becomes `to`, the old
        /// path is kept as `pretty`, and `is_symlink` is set.
        pub fn set_realpath(&mut self, to: &'a [u8]) {
            let old_path = self.text;
            self.text = to;
            self.pretty = old_path;
            self.is_symlink = true;
        }
    }
}

#[cfg(test)]
mod path_tests;
