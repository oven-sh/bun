#![allow(non_snake_case)]
#![allow(non_upper_case_globals)]
#![warn(unused_must_use)]
#![feature(adt_const_params)]
#![feature(core_io_borrowed_buf)]
#![feature(exclusive_wrapper)]
// ──────────────────────────────────────────────────────────────────────────
// Resolver body. Higher-tier deps are reached via lower-tier crates:
// bun_install -> bun_install_types::AutoInstaller trait; bun_standalone_graph ->
// crate::StandaloneModuleGraph trait; HardcodedModule -> bun_resolve_builtins.
// ──────────────────────────────────────────────────────────────────────────

// Submodules. `fs.rs` (full RealFS readdir/stat/kind path) is mounted as
// `fs_full`; the inline `pub mod fs` below remains the canonical type surface
// (FileSystem, RealFS, Path, PathName, Entry, DirEntry,
// EntriesMap, Implementation) and re-exports from `fs_full`.
pub mod data_url;
pub mod dir_info;
pub mod error;
#[path = "fs.rs"]
mod fs_full;
mod import_meta_glob;
pub mod node_fallbacks;
pub mod package_json;
pub mod tsconfig_json;

pub use error::Error;
pub use error::Result as CrateResult;

// ── Re-exported resolver surface ──────────────────────────────────────────
// Real types live in the `resolver` / `result` / `options` /
// `standalone_module_graph` sibling modules; the header re-exports them so
// dependents see the same paths as the old stub surface.

/// Re-export real `GlobalCache`.
pub use bun_options_types::global_cache::GlobalCache;
/// Re-export real `DataURL`.
pub use data_url::DataURL;
/// Re-export real `DirInfo`.
pub use dir_info::DirInfo;
/// Re-export real filesystem `Path`.
pub use fs::Path;
/// Re-export real `PackageJSON`.
pub use package_json::PackageJSON;
/// Re-export real `TSConfigJSON`.
pub use tsconfig_json::TSConfigJSON;

// Re-export the resolver implementation. `Resolver`, `Result`, `MatchResult`,
// `PathPair`, `DebugLogs`, `SideEffects`, etc. are defined in the `resolver` /
// `result` / `standalone_module_graph` sibling modules.
/// Re-export so dependents can spell `bun_resolver::install_types::AutoInstaller`.
pub use ::bun_install_types::resolver_hooks as install_types;
pub use resolver::{BrowserMapPathKind, Dirname, Resolver, module_type_from_ext};
pub use result::{
    DebugLogs, ExternalKind, FlushMode, LoadResult, MatchResult, MatchStatus, PathPair, Result,
    ResultFlags, ResultUnion,
};
pub use standalone_module_graph::{
    BytecodeModule, LINKED_BYTECODE_REGION_COUNT, StandaloneModuleGraph,
};

/// `bun_resolver::fs` namespace; re-exports from `fs_full` plus the
/// in-tree types (`FileSystem`, `RealFS`, `Entry`, ...).
pub mod fs {
    use core::hash::BuildHasherDefault;
    #[cfg(not(windows))]
    use core::sync::atomic::AtomicUsize;
    use core::sync::atomic::{AtomicU32, Ordering};

    use bun_alloc::BSSStringList;
    use bun_core::ZStr;

    use crate::dir_info::{self, ByHash, Cached};
    pub(crate) use crate::fs_full::filename_store;
    use crate::fs_full::{EntryStat, dir_entry};

    // ── DirnameStore / FilenameStore ─────────────────────────────────────
    // The resolver body interns paths via `dirname_store.append_slice` /
    // `append_parts`.

    static DIRNAME_STORE: bun_core::Once<BSSStringList> = bun_core::Once::new();

    #[inline]
    pub(crate) fn dirname_store() -> &'static BSSStringList {
        DIRNAME_STORE.get_or_init(|| BSSStringList::new(4096 * 129))
    }

    /// Port of `FileSystem.DirnameStore`.
    pub struct DirnameStore(());
    /// Port of `FileSystem.FilenameStore`.
    pub struct FilenameStore(());

    static DIRNAME_STORE_ZST: DirnameStore = DirnameStore(());
    static FILENAME_STORE_ZST: FilenameStore = FilenameStore(());

    macro_rules! string_store_impl {
        ($t:ty, $zst:ident, $backing:ident) => {
            impl $t {
                #[inline]
                pub fn instance() -> &'static Self {
                    &$zst
                }
                pub fn append_slice(&self, value: &[u8]) -> crate::CrateResult<&'static [u8]> {
                    $backing().append(value).map_err(crate::Error::Alloc)
                }
                pub fn append_parts(&self, parts: &[&[u8]]) -> crate::CrateResult<&'static [u8]> {
                    $backing().append_parts(parts).map_err(crate::Error::Alloc)
                }
                /// Format directly into the store's tail; no intermediate `String`.
                pub fn print(
                    &self,
                    args: core::fmt::Arguments<'_>,
                ) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
                    $backing().print(args)
                }
                /// `value` with the store's lifetime, if it already points into the store.
                #[inline]
                pub fn as_interned(&self, value: &[u8]) -> Option<&'static [u8]> {
                    $backing().as_interned(value)
                }
            }
        };
    }
    string_store_impl!(DirnameStore, DIRNAME_STORE_ZST, dirname_store);
    string_store_impl!(FilenameStore, FILENAME_STORE_ZST, filename_store);

    macro_rules! string_store_append_impl {
        ($t:ty, $backing:ident) => {
            impl $t {
                /// Interns `value` into the never-freed backing store and
                /// returns the `'static` copy.
                #[inline]
                pub fn append(
                    &self,
                    value: &[u8],
                ) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
                    $backing().append(value)
                }
                /// Like `append`, but ASCII-lowercases `value` while copying
                /// it into the store.
                #[inline]
                pub fn append_lower_case(
                    &self,
                    value: &[u8],
                ) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
                    $backing().append_lower_case(value)
                }
            }
        };
    }
    string_store_append_impl!(DirnameStore, dirname_store);
    string_store_append_impl!(FilenameStore, filename_store);

    // ── FileSystem ───────────────────────────────────────────────────────

    /// Process-global filesystem facade for the resolver. Wraps the real-FS
    /// backend and the dirname/filename interning stores.
    pub struct FileSystem {
        pub fs: Implementation,
        pub dirname_store: &'static DirnameStore,
        pub filename_store: &'static FilenameStore,
    }

    static INSTANCE: FileSystem = FileSystem {
        fs: RealFS {
            entries: Guarded::new(EntriesMap::new()),
            cwd: bun_core::Once::new(),
            #[cfg(not(windows))]
            file_limit: AtomicUsize::new(0),
        },
        dirname_store: &DIRNAME_STORE_ZST,
        filename_store: &FILENAME_STORE_ZST,
    };

    // Windows uses `HANDLE` (no monotone ordering); tracked POSIX-only.
    #[cfg(not(windows))]
    static MAX_FD: core::sync::atomic::AtomicI32 = core::sync::atomic::AtomicI32::new(0);

    static TMPNAME_ID_NUMBER: AtomicU32 = AtomicU32::new(0);

    impl FileSystem {
        /// Generates a unique NUL-terminated temp filename into `buf` from
        /// `extname`, `hash`, a per-process counter, and the current time.
        pub fn tmpname<'b>(
            extname: &[u8],
            buf: &'b mut [u8],
            hash: u64,
        ) -> crate::CrateResult<&'b ZStr> {
            // bun_core has no `time` module yet; use std directly.
            let nanos: u128 = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let hex_value: u64 = hash ^ (nanos as u64);

            bun_core::fmt::buf_print_z(
                buf,
                format_args!(
                    ".{:x}-{:X}.{}",
                    hex_value,
                    TMPNAME_ID_NUMBER.fetch_add(1, Ordering::Relaxed),
                    bstr::BStr::new(extname),
                ),
            )
            .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))
        }

        /// # Panics (debug)
        /// If `init()` has not been called yet.
        #[track_caller]
        #[inline]
        pub fn get() -> &'static FileSystem {
            debug_assert!(
                Self::instance_loaded(),
                "FileSystem::get() before FileSystem::init()"
            );
            &INSTANCE
        }

        pub fn instance_loaded() -> bool {
            INSTANCE.fs.cwd.get().is_some()
        }

        /// The first call records `top_level_dir` and raises RLIMIT_NOFILE. Later calls change nothing.
        pub fn init(top_level_dir: Option<&[u8]>) -> crate::CrateResult<&'static FileSystem> {
            if Self::instance_loaded() {
                return Ok(&INSTANCE);
            }
            let cwd: &'static [u8] = match top_level_dir {
                // intern into the process-lifetime `DirnameStore` so
                // callers may pass a borrowed path without leaking it themselves
                // (the singleton outlives every caller).
                Some(d) => DirnameStore::instance().append_slice(d)?,
                None => {
                    let mut buf = bun_paths::path_buffer_pool::get();
                    DirnameStore::instance().append_slice(bun_core::getcwd(&mut buf)?.as_bytes())?
                }
            };
            INSTANCE.fs.cwd.get_or_init(|| {
                // `bun_paths::fs::FileSystem::instance()` panics until it is seeded.
                bun_paths::fs::FileSystem::init(cwd);
                bun_core::set_top_level_dir(cwd);
                #[cfg(not(windows))]
                (INSTANCE.fs.file_limit).store(RealFS::adjust_ulimit(), Ordering::Relaxed);
                cwd
            });
            Ok(&INSTANCE)
        }

        /// Records `_fd` as the highest file descriptor seen so far
        /// (POSIX-only; no-op on Windows).
        #[inline]
        pub fn set_max_fd(_fd: bun_sys::RawFd) {
            #[cfg(windows)]
            {
                return;
            }
            #[cfg(not(windows))]
            {
                if !bun_core::feature_flags::STORE_FILE_DESCRIPTORS {
                    return;
                }
                MAX_FD.fetch_max(_fd, Ordering::Relaxed);
            }
        }

        /// Highest fd seen via `set_max_fd`.
        #[inline]
        #[cfg(not(windows))]
        pub(crate) fn max_fd() -> bun_sys::RawFd {
            MAX_FD.load(Ordering::Relaxed)
        }

        /// Joins `parts` against `top_level_dir` into `buf`, returning the
        /// absolute path slice.
        pub fn abs_buf<'b>(&self, parts: &[&[u8]], buf: &'b mut [u8]) -> &'b [u8] {
            use bun_paths::resolve_path::{join_abs_string_buf, platform};
            join_abs_string_buf::<platform::Loose>(self.top_level_dir(), buf, parts)
        }

        /// Returns `None` on overflow.
        pub fn abs_buf_checked<'b>(&self, parts: &[&[u8]], buf: &'b mut [u8]) -> Option<&'b [u8]> {
            use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
            join_abs_string_buf_checked::<platform::Loose>(self.top_level_dir(), buf, parts)
        }

        /// Normalizes `str` (separators, `.`/`..` segments) into `buf`.
        pub fn normalize_buf<'b>(&self, buf: &'b mut [u8], str: &[u8]) -> &'b [u8] {
            use bun_paths::resolve_path::{normalize_string_buf, platform};
            normalize_string_buf::<false, platform::Auto, false>(str, buf)
        }

        /// Like `abs_buf`, for a result of any length.
        pub fn abs_spill<'b>(
            &self,
            parts: &[&[u8]],
            buf: &'b mut bun_paths::resolve_path::SpillBuf<'_>,
        ) -> &'b [u8] {
            use bun_paths::resolve_path::{join_abs_string_spill, platform};
            join_abs_string_spill::<platform::Loose>(self.top_level_dir(), buf, parts)
        }

        /// Returns the process cwd. `process.chdir()` on any thread replaces it.
        #[inline]
        pub fn top_level_dir(&self) -> &'static [u8] {
            bun_core::top_level_dir()
        }

        /// `dir` must be `'static` and never written again (interned in
        /// `DirnameStore` or a process-lifetime buffer like `cwd_buf`).
        #[inline]
        pub fn set_top_level_dir(&self, dir: &'static [u8]) {
            bun_core::set_top_level_dir(dir);
        }

        /// `top_level_dir` with any trailing separator stripped (root `/` is
        /// left intact).
        pub fn top_level_dir_without_trailing_slash(&self) -> &'static [u8] {
            let d = self.top_level_dir();
            if d.len() > 1 && d.last() == Some(&bun_paths::SEP) {
                &d[..d.len() - 1]
            } else {
                d
            }
        }

        /// The process-global directory-name interning store.
        #[inline]
        pub fn dirname_store(&self) -> &'static DirnameStore {
            self.dirname_store
        }
        /// The process-global file-name interning store.
        #[inline]
        pub fn filename_store(&self) -> &'static FilenameStore {
            self.filename_store
        }

        /// `BUN_TMPDIR` or the
        /// platform fallback. Process-static once-computed.
        #[inline]
        pub fn get_default_temp_dir() -> &'static [u8] {
            RealFS::get_default_temp_dir()
        }

        #[inline]
        pub fn read_directory(
            &self,
            dir: &[u8],
            generation: Generation,
            store_fd: bool,
        ) -> crate::CrateResult<DirEntryRef> {
            self.fs.read_directory(dir, None, generation, store_fd)
        }
    }

    // ── PathName / Path ──────────────────────────────────────────────────
    // CANONICAL: re-exported from `bun_paths::fs` (D090). The struct defs,
    // `init`/`is_file`/`source_dir`/etc, and `Default`/`Clone`/`Copy` derives
    // live there; only resolver-tier methods (those needing `FilenameStore`,
    // `bun_wyhash`, `bun_options_types`) remain here as an extension trait.
    pub use bun_paths::fs::{Path, PathName};

    /// `value` with the stores' lifetime, if it already points into the
    /// process-lifetime `DirnameStore` or `FilenameStore`. Only their fixed
    /// backing buffers are checked; a path that spilled into an overflow
    /// allocation reads as not interned.
    #[inline]
    pub fn as_interned_path(value: &[u8]) -> Option<&'static [u8]> {
        DirnameStore::instance()
            .as_interned(value)
            .or_else(|| FilenameStore::instance().as_interned(value))
    }

    /// Intern a `Path.namespace` for `dupe_alloc`. The common `file`/empty
    /// namespace is a static literal (no allocation); anything else is interned
    /// into the process-lifetime `FilenameStore`.
    #[inline]
    fn dupe_namespace(namespace: &[u8]) -> crate::CrateResult<&'static [u8]> {
        match namespace {
            b"" | b"file" => Ok(b"file"),
            ns => FilenameStore::instance().append_slice(ns),
        }
    }

    /// Resolver-tier `Path` methods that pull deps `bun_paths` can't
    /// reach (`FilenameStore`/`DirnameStore`, `bun_options_types`,
    /// `bun_string`). Import this trait to call `.loader()` / `.dupe_alloc()`
    /// on a `Path`.
    pub trait PathResolverExt<'a> {
        /// Intern `text`/`pretty` into the process-lifetime `FilenameStore`
        /// (reusing an already-interned `text`); when `pretty` is not a
        /// sub-string of `text`, `pretty` and any not-yet-interned
        /// `text`/`namespace` go in `alloc` (the per-build bundle arena)
        /// instead. See the impl for why.
        fn dupe_alloc<'b>(
            &self,
            alloc: &'b bun_alloc::MimallocArena,
        ) -> crate::CrateResult<Path<'b>>;
        fn dupe_alloc_fix_pretty<'b>(
            &self,
            alloc: &'b bun_alloc::MimallocArena,
        ) -> crate::CrateResult<Path<'b>>;
        fn loader(&self, loaders: &bun_ast::LoaderHashTable) -> Option<bun_ast::Loader>;
    }

    impl<'a> PathResolverExt<'a> for Path<'a> {
        /// Interns `text`/`pretty` into the
        /// process-static `FilenameStore`, or copies them into `alloc`.
        ///
        /// Short-circuit: if `text` (and, where relevant,
        /// `pretty`) already points into a process-lifetime store
        /// (`FilenameStore` or `DirnameStore`), the slices are already `'static`
        /// and we return the path unchanged instead of appending a duplicate.
        /// Skipping this check makes the append-only `FilenameStore` grow without
        /// bound across repeated in-process `Bun.build()` calls.
        fn dupe_alloc<'b>(
            &self,
            alloc: &'b bun_alloc::MimallocArena,
        ) -> crate::CrateResult<Path<'b>> {
            let already_interned = |text: &'static [u8], pretty: &'static [u8]| Path::<'b> {
                text,
                pretty,
                namespace: match self.namespace {
                    b"" => b"",
                    b"file" => b"file",
                    ns => as_interned_path(ns).unwrap_or_else(|| alloc.alloc_slice_copy(ns)),
                },
                is_symlink: self.is_symlink,
                is_disabled: self.is_disabled,
            };

            if core::ptr::eq(self.text.as_ptr(), self.pretty.as_ptr())
                && self.text.len() == self.pretty.len()
            {
                if let Some(text) = as_interned_path(self.text) {
                    return Ok(already_interned(text, text));
                }
                // `Path::init` sets `pretty == text`, matching the aliased input.
                let text = FilenameStore::instance().append_slice(self.text)?;
                let mut new_path = Path::<'static>::init(text);
                new_path.namespace = dupe_namespace(self.namespace)?;
                new_path.is_symlink = self.is_symlink;
                new_path.is_disabled = self.is_disabled;
                Ok(new_path)
            } else if self.pretty.is_empty() {
                if let Some(text) = as_interned_path(self.text) {
                    return Ok(already_interned(text, b""));
                }
                let text = FilenameStore::instance().append_slice(self.text)?;
                let mut new_path = Path::<'static>::init(text);
                new_path.pretty = b"";
                new_path.namespace = dupe_namespace(self.namespace)?;
                new_path.is_symlink = self.is_symlink;
                new_path.is_disabled = self.is_disabled;
                Ok(new_path)
            } else if let Some([offset, len]) =
                bun_alloc::range_of_slice_in_buffer(self.pretty, self.text)
            {
                // `pretty` is a sub-slice of `text`.
                if let Some(text) = as_interned_path(self.text) {
                    return Ok(already_interned(
                        text,
                        &text[offset as usize..][..len as usize],
                    ));
                }
                let text = FilenameStore::instance().append_slice(self.text)?;
                let mut new_path = Path::<'static>::init(text);
                new_path.pretty = &text[offset as usize..][..len as usize];
                new_path.namespace = dupe_namespace(self.namespace)?;
                new_path.is_symlink = self.is_symlink;
                new_path.is_disabled = self.is_disabled;
                Ok(new_path)
            } else {
                if let (Some(text), Some(pretty)) =
                    (as_interned_path(self.text), as_interned_path(self.pretty))
                {
                    return Ok(already_interned(text, pretty));
                }
                let mut new_path =
                    if let Some(offset) = bun_core::strings::index_of(self.text, self.pretty) {
                        // `text` contains `pretty`; re-slice the interned copy.
                        let text = match as_interned_path(self.text) {
                            Some(text) => text,
                            None => FilenameStore::instance().append_slice(self.text)?,
                        };
                        let mut p = Path::<'static>::init(text);
                        p.pretty = &text[offset..][..self.pretty.len()];
                        p
                    } else {
                        // Disjoint `text`/`pretty`: a file outside `top_level_dir`
                        // (`pretty` starts with `../`) or a plugin module in a
                        // non-`file` namespace (`pretty` is `<ns>:<text>`). `pretty` is
                        // recomputed every build, and so are `text`/`namespace` unless
                        // the resolver already interned them, so they go in the
                        // per-build arena rather than growing the append-only stores
                        // on every `Bun.build()`. Holders that outlive the bundle (the
                        // file watcher) copy.
                        let arena_z = |s: &[u8]| -> &'b [u8] {
                            let buf: &'b mut [u8] = alloc.alloc_slice_fill_copy(s.len() + 1, 0u8);
                            buf[..s.len()].copy_from_slice(s);
                            &buf[..s.len()]
                        };
                        let mut p = Path::<'b>::init(
                            as_interned_path(self.text).unwrap_or_else(|| arena_z(self.text)),
                        );
                        p.pretty = arena_z(self.pretty);
                        p.namespace = match self.namespace {
                            b"" | b"file" => b"file",
                            ns => as_interned_path(ns).unwrap_or_else(|| arena_z(ns)),
                        };
                        p.is_symlink = self.is_symlink;
                        p.is_disabled = self.is_disabled;
                        return Ok(p);
                    };
                new_path.namespace = dupe_namespace(self.namespace)?;
                new_path.is_symlink = self.is_symlink;
                new_path.is_disabled = self.is_disabled;
                Ok(new_path)
            }
        }

        fn dupe_alloc_fix_pretty<'b>(
            &self,
            alloc: &'b bun_alloc::MimallocArena,
        ) -> crate::CrateResult<Path<'b>> {
            #[cfg(not(windows))]
            {
                self.dupe_alloc(alloc)
            }
            #[cfg(windows)]
            {
                // If `pretty` contains no backslashes it is already POSIX-style.
                // Short-circuiting preserves the `pretty.ptr == text.ptr` aliasing
                // optimisation inside `dupe_alloc` and avoids a fresh FilenameStore alloc.
                if !bun_core::strings::contains_char(self.pretty, b'\\') {
                    return self.dupe_alloc(alloc);
                }
                let mut new = self.clone();
                new.pretty = b"";
                let mut new = new.dupe_alloc(alloc)?;
                // The posix-normalized
                // display path goes into the per-build arena, not the
                // process-lifetime `FilenameStore` (it is recomputed each build).
                let pretty: &'b mut [u8] = alloc.alloc_slice_copy(self.pretty);
                bun_paths::resolve_path::platform_to_posix_in_place::<u8>(pretty);
                new.pretty = pretty;
                new.assert_pretty_is_valid();
                Ok(new)
            }
        }

        fn loader(&self, loaders: &bun_ast::LoaderHashTable) -> Option<bun_ast::Loader> {
            use bun_ast::Loader;
            if self.is_data_url() {
                return Some(Loader::Dataurl);
            }

            let name = self.name();
            let ext = name.ext;

            let result = loaders
                .get(ext)
                .copied()
                .or_else(|| Loader::from_string(ext));
            if result.is_none() || result == Some(Loader::Json) {
                let str = name.filename;
                if str == b"package.json" || str == b"bun.lock" {
                    return Some(Loader::Jsonc);
                }

                if str.ends_with(b".jsonc") {
                    return Some(Loader::Jsonc);
                }

                if str.starts_with(b"tsconfig.") || str.starts_with(b"jsconfig.") {
                    if str.ends_with(b".json") {
                        return Some(Loader::Jsonc);
                    }
                }
            }
            result
        }
    }

    // ── Entry / DirEntry / EntryKind ─────────────────────────────────────
    // Canonical definitions live in `fs.rs` (mounted as `crate::fs_full`).
    // Re-exported here so the public path `bun_resolver::fs::*` is preserved.
    pub use crate::fs_full::{DirEntry, DirEntryIterator, Entry, EntryKind, FilenameStoreAppender};

    use bun_core::Generation;
    use bun_paths::{PathBuffer, strings};
    use bun_sys::Fd;
    use bun_threading::Guarded;

    /// A slot of [`EntriesMap`]. It stays valid after the directory is busted.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct DirEntryIndex(u32);

    /// A cached listing, for a reader that does not hold the lock of `RealFS::entries`.
    #[derive(Clone, Copy)]
    pub struct DirEntryRef {
        pub dir: &'static [u8],
        pub index: DirEntryIndex,
    }

    /// The directory-entry cache. Keys are not stored, only their hashes.
    pub struct EntriesMap {
        by_hash: ByHash<DirEntryIndex>,
        slots: Vec<crate::CrateResult<DirEntry>>,
    }

    impl EntriesMap {
        const fn new() -> Self {
            Self {
                by_hash: ByHash::with_hasher(BuildHasherDefault::new()),
                slots: Vec::new(),
            }
        }

        fn cached(&self, hash: u64) -> Cached<DirEntryIndex> {
            self.by_hash.get(&hash).copied().unwrap_or_default()
        }

        pub fn index_of(&self, key: &[u8]) -> Option<DirEntryIndex> {
            match self.cached(dir_info::Cache::hash(key)) {
                Cached::Exists(index) => Some(index),
                Cached::Unknown | Cached::NotFound => None,
            }
        }

        /// `None` if the slot holds a read error.
        pub fn at_index(&self, index: DirEntryIndex) -> Option<&DirEntry> {
            self.slots[index.0 as usize].as_ref().ok()
        }

        /// The listing at `index`, read again first if it is older than `generation`.
        pub(crate) fn at_generation(
            &mut self,
            index: DirEntryIndex,
            generation: Generation,
        ) -> Option<&DirEntry> {
            let existing = self.at_index(index)?;
            if existing.generation < generation {
                let dir = existing.dir;
                let new_entry = bun_sys::Dir::open(dir)
                    .map_err(Into::into)
                    .and_then(|handle| {
                        RealFS::readdir(Some(&existing.data), dir, generation, &handle, &mut ())
                    });
                match new_entry {
                    Ok(new_entry) => self.slots[index.0 as usize] = Ok(new_entry),
                    Err(err) => {
                        self.clear_at_index(index);
                        self.put_error(dir_info::Cache::hash(dir), err);
                        return None;
                    }
                }
            }
            self.at_index(index)
        }

        pub(crate) fn get(&self, hash: u64) -> Option<&crate::CrateResult<DirEntry>> {
            match self.cached(hash) {
                Cached::Exists(index) => Some(&self.slots[index.0 as usize]),
                Cached::Unknown | Cached::NotFound => None,
            }
        }

        /// Replaces the slot of `hash`, or adds one.
        fn put(&mut self, hash: u64, value: crate::CrateResult<DirEntry>) -> DirEntryIndex {
            let cached = self.by_hash.entry(hash).or_default();
            if let Cached::Exists(index) = *cached {
                self.slots[index.0 as usize] = value;
                return index;
            }
            let index = DirEntryIndex(u32::try_from(self.slots.len()).expect("int cast"));
            self.slots.push(value);
            *cached = Cached::Exists(index);
            index
        }

        pub(crate) fn mark_not_found(&mut self, hash: u64) {
            self.by_hash.insert(hash, Cached::NotFound);
        }

        fn clear_at_index(&mut self, index: DirEntryIndex) {
            if let Ok(entries) = &mut self.slots[index.0 as usize] {
                entries.data.clear();
            }
        }

        /// Caches `err` as the result of reading the directory, and returns it.
        fn put_error(&mut self, hash: u64, err: crate::Error) -> crate::Error {
            if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                self.mark_not_found(hash);
            } else {
                self.put(hash, Err(err));
            }
            err
        }

        /// The listing of `dir_path`, read from `open_dir` if it is missing or older than `generation`.
        pub(crate) fn get_or_read(
            &mut self,
            hash: u64,
            dir_path: &[u8],
            open_dir: Fd,
            generation: Generation,
            store_fd: bool,
        ) -> DirEntryRef {
            let mut in_place = None;
            if let Cached::Exists(index) = self.cached(hash)
                && let Some(entries) = self.at_index(index)
            {
                if entries.generation >= generation {
                    return DirEntryRef {
                        dir: entries.dir,
                        index,
                    };
                }
                in_place = Some(entries);
            }

            let dir = match in_place {
                Some(existing) => existing.dir,
                None => DirnameStore::instance()
                    .append_slice(dir_path)
                    .expect("unreachable"),
            };
            let mut new_entry = DirEntry::init(dir, generation);

            // Covers a typical package directory without a rehash.
            new_entry.data.reserve(64);

            // A permission-denied ancestor has no fd to enumerate, and stays empty.
            if open_dir.is_valid() {
                let prev_map = in_place.map(|existing| &existing.data);
                let mut dir_iterator = bun_sys::iterate_dir(open_dir);
                let mut filename_store = FilenameStoreAppender::new();
                while let Ok(Some(entry)) = dir_iterator.next() {
                    new_entry
                        .add_entry_with_store(prev_map, &entry, &mut filename_store)
                        .expect("unreachable");
                }
            }
            if store_fd {
                new_entry.fd = open_dir;
            }

            bun_core::scoped_log!(
                crate::fs_full::Fs,
                "readdir({}, {}) = {}",
                open_dir,
                bstr::BStr::new(dir_path),
                new_entry.data.count(),
            );

            let index = self.put(hash, Ok(new_entry));
            DirEntryRef { dir, index }
        }
    }

    /// The active filesystem backend (always the real filesystem).
    pub(crate) type Implementation = RealFS;

    // ── RealFS ───────────────────────────────────────────────────────────

    /// Real-filesystem backend: directory-entry cache plus fd-limit
    /// bookkeeping.
    pub struct RealFS {
        /// Lock order: `RESOLVER_MUTEX`, this, then `Entry::mutex`.
        pub entries: Guarded<EntriesMap>,
        cwd: bun_core::Once<&'static [u8]>,
        /// Relaxed: 0 until `FileSystem::init` stores it, and 0 keeps no fd open.
        #[cfg(not(windows))]
        file_limit: AtomicUsize,
    }

    impl RealFS {
        /// Port of `RealFS.adjustUlimit` — always try to max out how many
        /// files we can keep open. Returns 0 when the limit cannot be read:
        /// `need_to_close_files` is then always true and no fd stays cached.
        /// `--watch`/`--hot` register an imported module through its cached
        /// fd, so they then only see the entry point.
        #[cfg(not(windows))]
        fn adjust_ulimit() -> usize {
            let resource = bun_sys::posix::RlimitResource::NOFILE;
            // Node ignores a failed getrlimit(RLIMIT_NOFILE) too (`PlatformInit`).
            let Ok(mut lim) = bun_sys::posix::getrlimit(resource) else {
                return 0;
            };

            // Cap at 1<<20 to match Node.js. On macOS the hard limit defaults to
            // RLIM_INFINITY; raising soft anywhere near INT_MAX breaks child processes
            // that read the limit into an int.
            let target = {
                // musl has extremely low defaults, so ensure at least 163840 there.
                #[cfg(target_env = "musl")]
                let max = lim.max.max(163_840);
                #[cfg(not(target_env = "musl"))]
                let max = lim.max;
                max.min(1 << 20)
            };
            if lim.cur < target {
                let mut raised = lim;
                raised.cur = target;
                // Don't lower the hard limit (Node only touches rlim_cur). The @max
                // is for the musl branch above, which may raise past the current hard.
                raised.max = lim.max.max(target);
                if bun_sys::posix::setrlimit(resource, raised).is_ok() {
                    lim.cur = raised.cur;
                }
            }
            usize::try_from(lim.cur).expect("int cast")
        }

        /// `open(path, O_DIRECTORY)`.
        pub(crate) fn open_dir(&self, unsafe_dir_string: &[u8]) -> crate::CrateResult<Fd> {
            #[cfg(windows)]
            {
                // NtCreateFile with FILE_DIRECTORY_FILE/FILE_LIST_DIRECTORY so
                // the resulting handle is iterable for `readdir`.
                return bun_sys::open_dir_at_windows_a(
                    bun_sys::Fd::INVALID,
                    unsafe_dir_string,
                    bun_sys::WindowsOpenDirOptions {
                        iterable: true,
                        no_follow: false,
                        ..Default::default()
                    },
                )
                .map_err(Into::into);
            }
            #[cfg(not(windows))]
            {
                // `open(path, O_DIRECTORY)`; route through
                // `bun_sys::open_a` for the NUL-termination handling.
                bun_sys::open_a(unsafe_dir_string, bun_sys::O::DIRECTORY, 0).map_err(Into::into)
            }
        }

        /// Iterate `handle` and populate a
        /// fresh `DirEntry` (re-using `prev_map` Entry slots where the name matches).
        fn readdir<I: DirEntryIterator>(
            prev_map: Option<&dir_entry::EntryMap>,
            dir_: &'static [u8],
            generation: Generation,
            handle: &bun_sys::Dir,
            iterator: &mut I,
        ) -> crate::CrateResult<DirEntry> {
            let mut iter = bun_sys::iterate_dir(handle.fd());
            let mut dir = DirEntry::init(dir_, generation);
            let mut filename_store = FilenameStoreAppender::new();
            while let Some(entry_) = iter.next()? {
                // debug("readdir entry {}", BStr::new(entry_.name.slice()));
                if let Some(entry) =
                    dir.add_entry_with_store(prev_map, &entry_, &mut filename_store)?
                {
                    iterator.next(entry);
                }
            }

            // debug("readdir({}, {}) = {}", handle, dir_, dir.data.count());

            Ok(dir)
        }

        pub fn read_directory(
            &self,
            dir_: &[u8],
            handle_: Option<Fd>,
            generation: Generation,
            store_fd: bool,
        ) -> crate::CrateResult<DirEntryRef> {
            self.read_directory_with_iterator(dir_, handle_, generation, store_fd, &mut ())
        }

        // One of the learnings here
        //
        //   Closing file descriptors yields significant performance benefits on Linux
        //
        // It was literally a 300% performance improvement to bundling.
        // https://twitter.com/jarredsumner/status/1655787337027309568
        // https://twitter.com/jarredsumner/status/1655714084569120770
        // https://twitter.com/jarredsumner/status/1655464485245845506
        pub fn read_directory_with_iterator<I: DirEntryIterator>(
            &self,
            dir_maybe_trail_slash: &[u8],
            maybe_handle: Option<Fd>,
            generation: Generation,
            store_fd: bool,
            iterator: &mut I,
        ) -> crate::CrateResult<DirEntryRef> {
            let dir = strings::paths::without_trailing_slash_windows_path(dir_maybe_trail_slash);

            crate::Resolver::assert_valid_cache_key(dir);
            let hash = dir_info::Cache::hash(dir);
            let mut entries_map = self.entries.lock();

            let mut in_place = None;

            match entries_map.cached(hash) {
                Cached::Exists(index) => match &entries_map.slots[index.0 as usize] {
                    Ok(e) if e.generation < generation => in_place = Some(index),
                    Ok(e) => return Ok(DirEntryRef { dir: e.dir, index }),
                    Err(err) => return Err(*err),
                },
                Cached::NotFound if generation == 0 => {
                    return Err(crate::Error::Sys(bun_errno::SystemErrno::ENOENT));
                }
                Cached::NotFound | Cached::Unknown => {}
            }

            let had_handle = maybe_handle.is_some();
            let mut opened = None;
            let handle: &bun_sys::Dir = match &maybe_handle {
                Some(lent) => bun_sys::Dir::borrow(lent),
                None => match self.open_dir(dir) {
                    Ok(fd) => opened.insert(bun_sys::Dir::from_fd(fd)),
                    Err(err) => return Err(entries_map.put_error(hash, err)),
                },
            };

            // if we get this far, it's a real directory, so we can just store the dir name.
            // An in-place refresh keeps the spelling (trailing slash or not) that its reused entries have.
            let prev = in_place.and_then(|index| entries_map.at_index(index));
            let dir: &'static [u8] = if let Some(prev) = prev {
                prev.dir
            } else if !had_handle {
                DirnameStore::instance().append_slice(dir_maybe_trail_slash)?
            } else {
                // Intern into DirnameStore so the cache entry never dangles —
                // `append_slice` is a bump-pointer copy, cost is bounded.
                DirnameStore::instance().append_slice(dir)?
            };

            // Cache miss: read the directory entries
            let prev_map = prev.map(|prev| &prev.data);
            let mut entries = match Self::readdir(prev_map, dir, generation, handle, iterator) {
                Ok(e) => e,
                Err(err) => {
                    if let Some(index) = in_place {
                        entries_map.clear_at_index(index);
                    }
                    return Err(entries_map.put_error(hash, err));
                }
            };

            if let Some(opened) = opened.filter(|_| store_fd && !self.need_to_close_files()) {
                entries.fd = opened.into_raw();
                FileSystem::set_max_fd(entries.fd.native());
            }

            let index = entries_map.put(hash, Ok(entries));
            Ok(DirEntryRef { dir, index })
        }

        /// Looks `query` up in a listing, and reads its fd, in one critical section.
        pub fn lookup(&self, index: DirEntryIndex, query: &[u8]) -> (Option<&'static Entry>, Fd) {
            match self.entries.lock().at_index(index) {
                Some(entries) => (entries.get(query), entries.fd),
                None => (None, Fd::INVALID),
            }
        }

        /// A copy of the entries, for a caller that locks `entries` while it iterates.
        pub fn snapshot_entries(&self, index: DirEntryIndex) -> Vec<&'static Entry> {
            match self.entries.lock().at_index(index) {
                Some(entries) => entries.data.values().copied().collect(),
                None => Vec::new(),
            }
        }

        /// Returns whether an entry was removed.
        pub(crate) fn bust_entries_cache(&self, hash: u64) -> bool {
            self.entries.lock().by_hash.remove(&hash).is_some()
        }

        /// lstat + (if symlink) open + fstat +
        /// readlink to populate an `EntryStat`. Windows: `GetFileAttributesW` +
        /// (if reparse point) `CreateFileW`-follow + `GetFinalPathNameByHandle`
        /// realpath.
        /// Runs with the entry's `mutex` held, so it must not ask for that entry's kind or symlink.
        pub(crate) fn kind<'b>(
            &self,
            dir_: &[u8],
            base: &[u8],
            existing_fd: Fd,
            store_fd: bool,
            outpath: &'b mut PathBuffer,
        ) -> crate::CrateResult<EntryStat<'b>> {
            use bun_paths::resolve_path::{join_abs_string_buf_z_checked, platform};
            #[cfg(not(windows))]
            use bun_sys::{FileKind, kind_from_mode};

            let mut cache = EntryStat {
                kind: EntryKind::File,
                symlink: b"",
                fd: Fd::INVALID,
            };

            let combo: [&[u8]; 2] = [dir_, base];
            let join_capacity = outpath.len() - 1;
            let Some(absolute_path_c) = join_abs_string_buf_z_checked::<platform::Auto>(
                self.cwd.get().copied().unwrap_or_default(),
                &mut outpath[..join_capacity],
                &combo,
            ) else {
                return Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
            };

            #[cfg(windows)]
            {
                use bun_sys::windows::{self as w, Win32ErrorExt as _};
                use std::os::windows::io::AsRawHandle as _;
                let _ = (existing_fd, store_fd);
                let file = bun_sys::get_file_attributes(absolute_path_c)
                    .ok_or(crate::Error::Sys(bun_errno::SystemErrno::ENOENT))?;
                // A Windows reparse point carries FILE_ATTRIBUTE_DIRECTORY iff
                // the link is a directory link (junctions always do; symlinks
                // do iff created with SYMBOLIC_LINK_FLAG_DIRECTORY; AppExec
                // links and file symlinks don't), so this is already the
                // correct `Entry.Kind` without following the chain.
                cache.kind = if file.is_directory {
                    EntryKind::Dir
                } else {
                    EntryKind::File
                };
                if !file.is_reparse_point {
                    return Ok(cache);
                }

                // For the realpath, open the path and let the kernel follow
                // every hop, then `GetFinalPathNameByHandle` (same as libuv's
                // `uv_fs_realpath`). The previous manual readlink+join loop
                // resolved relative targets against `dirname(absolute_path_c)`,
                // but that path may itself contain unresolved intermediate
                // symlinks (e.g. with the isolated linker's global virtual
                // store, `node_modules/.bun/<pkg>` is a symlink into
                // `<cache>/links/`, and the dep symlinks inside point at
                // siblings via `..\..\<dep>-<hash>`). Windows resolves
                // relative reparse targets against the *real* parent, so the
                // join landed in the project-side `.bun/` instead of
                // `<cache>/links/`, the re-stat returned FileNotFound, the
                // error was swallowed at `Entry.kind`, and a directory symlink
                // was permanently misclassified as `.file` — surfacing as
                // EISDIR at module load time.
                let mut wbuf = bun_paths::w_path_buffer_pool::get();
                let wpath = bun_paths::strings::paths::to_kernel32_path(
                    &mut wbuf.0[..],
                    absolute_path_c.as_bytes(),
                );
                let owned = match w::CreateFileW(
                    wpath,
                    0,
                    w::FILE_SHARE_READ | w::FILE_SHARE_WRITE | w::FILE_SHARE_DELETE,
                    w::OPEN_EXISTING,
                    // FILE_FLAG_BACKUP_SEMANTICS lets us open directories;
                    // omitting FILE_FLAG_OPEN_REPARSE_POINT makes Windows
                    // follow the full reparse chain to the final target.
                    w::FILE_FLAG_BACKUP_SEMANTICS,
                ) {
                    Ok(owned) => owned,
                    Err(err) => {
                        if is_dangling_link_error(err.to_e()) {
                            cache.kind = EntryKind::Dangling;
                        }
                        // anything else keeps the kind from the link's own directory bit
                        return Ok(cache);
                    }
                };
                let handle = owned.as_raw_handle();

                if let Ok(info) = w::GetFileInformationByHandle(handle) {
                    cache.kind = if info.dwFileAttributes & w::FILE_ATTRIBUTE_DIRECTORY != 0 {
                        EntryKind::Dir
                    } else {
                        EntryKind::File
                    };
                }

                if let Ok(real) = bun_sys::get_fd_path(Fd::from_system(handle), outpath) {
                    cache.symlink = real;
                }
                return Ok(cache);
            }

            #[cfg(not(windows))]
            {
                let stat_ = bun_sys::lstat(absolute_path_c)?;
                let is_symlink =
                    kind_from_mode(stat_.st_mode as bun_sys::Mode) == FileKind::SymLink;
                let mut file_kind = kind_from_mode(stat_.st_mode as bun_sys::Mode);

                if is_symlink {
                    let mut opened = None;
                    let file: &bun_sys::File = if existing_fd.is_valid() {
                        bun_sys::File::borrow(&existing_fd)
                    } else {
                        let result = if store_fd {
                            bun_sys::open_file_absolute_z(
                                absolute_path_c,
                                bun_sys::OpenFlags::READ_ONLY,
                            )
                            .map(bun_sys::File::into_raw)
                        } else {
                            #[cfg(any(target_os = "linux", target_os = "android"))]
                            let access = bun_sys::O::PATH;
                            #[cfg(not(any(target_os = "linux", target_os = "android")))]
                            let access = bun_sys::O::RDONLY;
                            bun_sys::open(absolute_path_c, access | bun_sys::O::NOCTTY, 0)
                        };
                        match result {
                            Ok(fd) => opened.insert(bun_sys::CloseOnDrop::new(fd)),
                            Err(err) if is_dangling_link_error(err.get_errno()) => {
                                cache.kind = EntryKind::Dangling;
                                return Ok(cache);
                            }
                            Err(err) => return Err(err.into()),
                        }
                    };
                    FileSystem::set_max_fd(file.fd().native());

                    let file_stat = file.stat()?;
                    cache.symlink = bun_sys::get_fd_path(file.fd(), outpath)?;
                    cache.fd = opened
                        .filter(|_| store_fd && !self.need_to_close_files())
                        .map_or(existing_fd, bun_sys::CloseOnDrop::into_raw);
                    file_kind = kind_from_mode(file_stat.st_mode as bun_sys::Mode);
                }

                debug_assert!(file_kind != FileKind::SymLink);

                cache.kind = if file_kind == FileKind::Directory {
                    EntryKind::Dir
                } else {
                    EntryKind::File
                };

                Ok(cache)
            }
        }
    }

    /// Returns true for the errors that `stat()` returns for a dangling symlink or a symlink loop.
    /// Other errors surface when the entry is read.
    fn is_dangling_link_error(errno: bun_sys::E) -> bool {
        matches!(
            errno,
            bun_sys::E::ENOENT | bun_sys::E::ENOTDIR | bun_sys::E::ELOOP
        )
    }

    impl RealFS {
        /// Whether cached file descriptors should be closed eagerly instead
        /// of kept open (fd budget exceeded or fd-storing disabled).
        #[inline]
        pub fn need_to_close_files(&self) -> bool {
            if !bun_core::feature_flags::STORE_FILE_DESCRIPTORS {
                return true;
            }

            #[cfg(windows)]
            {
                // 'false' is okay here because windows gives you a seemingly unlimited number of
                // open file handles, while posix has a lower limit. Handles are automatically
                // closed when the process exits. Handle ordering on Windows is non-monotone, so
                // MAX_FD tracking doesn't apply.
                return false;
            }

            #[cfg(not(windows))]
            {
                // If we're not near the max amount of open files, don't worry about it.
                let file_limit = self.file_limit.load(Ordering::Relaxed);
                !(file_limit > 254 && file_limit > (FileSystem::max_fd() as usize + 1) * 2)
            }
        }

        fn platform_temp_dir_compute() -> &'static [u8] {
            use bun_core::env_var;
            // Try TMPDIR, TMP, and TEMP in that order, matching Node.js.
            // https://github.com/nodejs/node/blob/e172be269890702bf2ad06252f2f152e7604d76c/src/node_credentials.cc#L132
            if let Some(dir) = env_var::TMPDIR
                .get_not_empty()
                .or_else(|| env_var::TMP.get_not_empty())
                .or_else(|| env_var::TEMP.get_not_empty())
            {
                if dir.len() > 1 && dir[dir.len() - 1] == bun_paths::SEP {
                    return &dir[0..dir.len() - 1];
                }
                return dir;
            }

            #[cfg(target_os = "windows")]
            {
                // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-gettemppathw#remarks
                // The computed path borrows env-var storage joined with a literal,
                // so it must own its buffer. This runs once for the process via
                // `bun_core::Once` in `platform_temp_dir()`; the `OnceLock` here is
                // the allowed process-lifetime singleton (PORTING.md §Forbidden
                // exception), not a per-call leak.
                static OWNED: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
                return OWNED
                    .get_or_init(|| {
                        if let Some(windir) =
                            env_var::SYSTEMROOT.get().or_else(|| env_var::WINDIR.get())
                        {
                            let mut out =
                                bun_core::strings::without_trailing_slash(windir).to_vec();
                            out.extend_from_slice(b"\\Temp");
                            return out;
                        }
                        if let Some(profile) = env_var::HOME.get() {
                            let mut buf = bun_paths::path_buffer_pool::get();
                            let parts: [&[u8]; 1] = [b"AppData\\Local\\Temp"];
                            let out = bun_paths::resolve_path::join_abs_string_buf::<
                                bun_paths::resolve_path::platform::Loose,
                            >(profile, &mut buf[..], &parts);
                            return out.to_vec();
                        }
                        let mut tmp_buf = bun_paths::path_buffer_pool::get();
                        let cwd = match bun_sys::getcwd(&mut tmp_buf[..]) {
                            Ok(len) => &tmp_buf[..len],
                            Err(_) => panic!("Failed to get cwd for platformTempDir"),
                        };
                        let root = bun_paths::resolve_path::windows_filesystem_root(cwd);
                        let mut out = bun_core::strings::without_trailing_slash(root).to_vec();
                        out.extend_from_slice(b"\\Windows\\Temp");
                        out
                    })
                    .as_slice();
            }
            #[cfg(target_os = "macos")]
            {
                return b"/private/tmp";
            }
            #[cfg(target_os = "android")]
            {
                return b"/data/local/tmp";
            }
            #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "android")))]
            {
                b"/tmp"
            }
        }

        /// Platform temp directory, computed once per process.
        pub fn platform_temp_dir() -> &'static [u8] {
            static ONCE: bun_core::Once<&'static [u8]> = bun_core::Once::new();
            ONCE.call(Self::platform_temp_dir_compute)
        }

        /// Non-empty `BUN_TMPDIR`, falling back to `platform_temp_dir`.
        pub fn tmpdir_path() -> &'static [u8] {
            bun_core::env_var::BUN_TMPDIR
                .get_not_empty()
                .unwrap_or_else(Self::platform_temp_dir)
        }

        pub fn get_default_temp_dir() -> &'static [u8] {
            bun_core::env_var::BUN_TMPDIR
                .get()
                .unwrap_or_else(Self::platform_temp_dir)
        }
    }

    // ── `file_system` namespace shim ─────────────────────────────────────
    // The resolver body addresses types via `Fs::file_system::*`. Re-export the
    // flat types under the nested module paths the body expects.
    /// Re-exports from the full `fs.rs` port: `BOM` (detect/strip tables) and
    /// the canonical read-file helpers, so `cache::Fs` (here and in
    /// `bun_bundler::cache`) routes through ONE body instead of inlining a
    /// subset of `readFileWithHandleAndAllocator`.
    pub use super::fs_full::{
        BOM, ByteOrderMark, PathContentsPair, read_file_contents, read_file_contents_in_arena,
        read_file_with_handle_impl,
    };

    /// Re-export `StatHash` from the full `fs.rs` port so `bun_runtime::server::FileRoute`
    /// can hash mtimes/sizes without inlining the formatter.
    pub use super::fs_full::stat_hash;
    pub use super::fs_full::stat_hash::StatHash;

    /// Re-export `ModKey` from the full `fs.rs` port so `linker::get_mod_key`
    /// can hash files.
    pub use super::fs_full::ModKey;
    impl ModKey {
        /// Builds a `ModKey` from an open file's stat.
        pub fn from_file(file: &bun_sys::File) -> crate::CrateResult<Self> {
            let stat = file.stat()?;

            const NS_PER_S: i128 = 1_000_000_000;
            // `bun_sys::Stat` is `libc::stat`.
            // Reconstruct `mtime` (i128 ns) from `st_mtime` (sec) +
            // `st_mtime_nsec` (ns). The `libc` crate flattens BSD/Darwin
            // `st_mtimespec` into `st_mtime`/`st_mtime_nsec`, so the access is
            // uniform on all `unix`.
            #[cfg(unix)]
            let mtime: i128 = (stat.st_mtime as i128) * NS_PER_S + stat.st_mtime_nsec as i128;
            #[cfg(windows)]
            let mtime: i128 = (stat.mtim.sec as i128) * NS_PER_S + stat.mtim.nsec as i128;
            let seconds = mtime / NS_PER_S;

            // We can't detect changes if the file system zeros out the
            // modification time
            if seconds == 0 && NS_PER_S == 0 {
                return Err(crate::Error::Unusable);
            }

            // Don't generate a modification key if the file is too new
            let now = bun_core::time::nano_timestamp();
            let now_seconds = now / NS_PER_S;
            // `seconds > seconds` is always false — intentionally kept
            #[allow(clippy::eq_op)]
            if seconds > seconds || (seconds == now_seconds && mtime > now) {
                return Err(crate::Error::Unusable);
            }

            Ok(ModKey {
                size: stat.st_size as u64,
                mtime,
            })
        }
    }

    pub mod file_system {
        pub use super::{DirnameStore, Entry, EntryKind, FilenameStore, RealFS};
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DirEntryAccessor — `bun_glob::walk::Accessor` impl backed by the resolver's
// DirEntry cache.
//
// Lives here (not in `bun_glob`) because it needs `fs::DirEntry`/
// `RealFS::read_directory`, and `bun_resolver` already depends on `bun_glob`.
// Low-tier crate owns the trait (`bun_glob::walk::Accessor`); high-tier crate
// owns this impl. See PORTING.md §Dispatch.
// ──────────────────────────────────────────────────────────────────────────
pub mod dir_entry_accessor {
    use crate::fs::{DirEntryRef, Entry, EntryKind, FileSystem as FS};
    use bun_core::ZStr;
    use bun_glob::walk::{self, Accessor, AccessorDirIter, AccessorHandle};
    use bun_paths::{Platform, resolve_path};
    use bun_sys::{self as Syscall, Error as SysError, Fd, Result as Maybe, Stat};

    pub struct DirEntryAccessor;

    #[derive(Clone, Copy)]
    pub struct DirEntryHandle {
        pub(crate) value: Option<DirEntryRef>,
    }

    impl AccessorHandle for DirEntryHandle {
        const EMPTY: Self = DirEntryHandle { value: None };

        fn is_empty(self) -> bool {
            self.value.is_none()
        }

        fn eql(self, other: Self) -> bool {
            // TODO this might not be quite right, we're comparing indices, not the underlying directory
            // On the other hand, DirEntries are only ever created once (per generation), so this should be fine?
            // Realistically, as closing the handle is a no-op, this should be fine either way.
            match (self.value, other.value) {
                (Some(a), Some(b)) => a.index == b.index,
                (None, None) => true,
                _ => false,
            }
        }
    }

    pub struct DirEntryDirIter {
        value: std::vec::IntoIter<&'static Entry>,
    }

    impl AccessorDirIter for DirEntryDirIter {
        type Handle = DirEntryHandle;

        #[inline]
        fn next(&mut self) -> Maybe<Option<walk::AccessorDirEntry<'_>>> {
            let Some(entry) = self.value.next() else {
                return Ok(None);
            };
            let kind = entry.kind(&FS::get().fs, true);
            let fskind = match kind {
                EntryKind::File => bun_sys::FileKind::File,
                EntryKind::Dir => bun_sys::FileKind::Directory,
                // The walker gets to apply its own broken-symlink handling.
                EntryKind::Dangling => bun_sys::FileKind::SymLink,
            };
            // `kind` follows symlinks, so only the cached realpath tells that the entry is one.
            let symlink_target = entry.cached_symlink();
            Ok(Some(walk::AccessorDirEntry {
                name: entry.base_lowercase(),
                kind: fskind,
                symlink_target: (!symlink_target.is_empty()).then_some(symlink_target),
            }))
        }

        #[inline]
        fn iterate(dir: DirEntryHandle) -> Self {
            let entries = (dir.value)
                .map_or_else(Vec::new, |entry| FS::get().fs.snapshot_entries(entry.index));
            DirEntryDirIter {
                value: entries.into_iter(),
            }
        }
    }

    impl DirEntryAccessor {
        /// Joins `path` onto the handle's directory. The result can be longer than a path buffer.
        fn full_path<'a>(
            handle: DirEntryHandle,
            path: &'a ZStr,
            buf: &'a mut [u8],
            spill: &'a mut Vec<u8>,
        ) -> &'a ZStr {
            match handle.value {
                Some(entry) if !Platform::AUTO.is_absolute(path.as_bytes()) => {
                    resolve_path::join_z_buf_spill::<bun_paths::platform::Auto>(
                        buf,
                        spill,
                        &[entry.dir, path.as_bytes()],
                    )
                }
                _ => path,
            }
        }
    }

    impl Accessor for DirEntryAccessor {
        const COUNT_FDS: bool = false;
        type Handle = DirEntryHandle;
        type DirIter = DirEntryDirIter;

        fn statat(handle: DirEntryHandle, path_: &ZStr) -> Maybe<Stat> {
            let mut buf = bun_paths::path_buffer_pool::get();
            let mut spill = Vec::new();
            Syscall::stat(Self::full_path(handle, path_, &mut buf[..], &mut spill))
        }

        /// Like statat but does not follow symlinks.
        fn lstatat(handle: DirEntryHandle, path_: &ZStr) -> Maybe<Stat> {
            let mut buf = bun_paths::path_buffer_pool::get();
            if let Some(entry) = handle.value {
                let fd = (FS::get().fs.entries.lock())
                    .at_index(entry.index)
                    .map_or(Fd::INVALID, |entries| entries.fd);
                return Syscall::lstatat(fd, path_);
            }

            let path: &ZStr = if !Platform::AUTO.is_absolute(path_.as_bytes()) {
                if let Some(entry) = handle.value {
                    let slice = resolve_path::join_string_buf::<bun_paths::platform::Auto>(
                        &mut buf,
                        &[entry.dir, path_.as_bytes()],
                    );
                    let len = slice.len();
                    ZStr::nul_terminate(&mut buf, len)
                } else {
                    path_
                }
            } else {
                path_
            };
            Syscall::lstat(path)
        }

        fn open(path: &ZStr) -> Result<Maybe<DirEntryHandle>, bun_core::Error> {
            Self::openat(DirEntryHandle::EMPTY, path)
        }

        fn openat(
            handle: DirEntryHandle,
            path_: &ZStr,
        ) -> Result<Maybe<DirEntryHandle>, bun_core::Error> {
            let mut buf = bun_paths::path_buffer_pool::get();
            let mut spill = Vec::new();
            let path = Self::full_path(handle, path_, &mut buf[..], &mut spill);
            // TODO do we want to propagate ENOTDIR through the 'Maybe' to match the SyscallAccessor?
            // The glob implementation specifically checks for this error when dealing with symlinks
            // return Err(SysError::from_code(E::NOTDIR, Syscall::Tag::open));
            let entry = FS::get()
                .fs
                .read_directory(path.as_bytes(), None, 0, false)
                .map_err(crate::Error::into_core)?;
            Ok(Ok(DirEntryHandle { value: Some(entry) }))
        }

        #[inline]
        fn close(_handle: DirEntryHandle) -> Option<SysError> {
            // TODO is this a noop?
            None
        }
    }
}
pub use dir_entry_accessor::DirEntryAccessor;

// ──────────────────────────────────────────────────────────────────────────
// `cache` — `Set`/`Fs`/`Entry`. These types live below `bun_bundler` in
// the crate graph because `Resolver.caches` is typed by them and the bundler
// constructs/assigns it (`transpiler.resolver.caches = Set::init()`). The
// bundler crate re-exports/extends these as `bun_bundler::cache::*`.
// ──────────────────────────────────────────────────────────────────────────
pub mod cache {
    use core::ffi::c_void;

    use bun_core::MutableString;
    use bun_core::{Output, feature_flags};
    use bun_sys::{self, Fd};

    use crate::fs::{
        self as fs_mod, ByteOrderMark, read_file_contents, read_file_contents_in_arena,
    };

    bun_core::declare_scope!(CacheFs, visible);

    /// Bundle of the per-transpiler caches.
    pub struct Set {
        pub fs: Fs,
    }

    impl Set {
        pub(crate) fn init() -> Set {
            Set {
                fs: Fs {
                    shared_buffer: MutableString::init(0).expect("unreachable"),
                    macro_shared_buffer: MutableString::init(0).expect("unreachable"),
                    use_alternate_source_cache: false,
                    stream: false,
                },
            }
        }
    }

    /// File-read cache: shared read buffers plus flags controlling buffer
    /// reuse and streaming reads.
    pub struct Fs {
        pub(crate) shared_buffer: MutableString,
        pub(crate) macro_shared_buffer: MutableString,

        pub use_alternate_source_cache: bool,
        pub(crate) stream: bool,
    }

    /// Runs the external destructor (`function(ctx)`) on drop, for foreign-owned
    /// source bytes; `NONE` when there is nothing external to free.
    #[repr(C)]
    pub struct ExternalFreeFunction {
        pub ctx: *mut c_void,
        pub function: Option<extern "C" fn(*mut c_void)>,
    }

    impl ExternalFreeFunction {
        pub const NONE: ExternalFreeFunction = ExternalFreeFunction {
            ctx: core::ptr::null_mut(),
            function: None,
        };
    }

    impl Drop for ExternalFreeFunction {
        fn drop(&mut self) {
            if let Some(function) = self.function {
                function(self.ctx);
            }
        }
    }

    impl Default for ExternalFreeFunction {
        fn default() -> Self {
            Self::NONE
        }
    }

    /// Provenance-tagged backing for [`Entry`] source bytes.
    #[derive(Default)]
    pub enum Contents {
        /// Empty / static literal.
        #[default]
        Empty,
        /// Heap-owned buffer (default-allocator path). Freed when this variant
        /// drops. Stored as `Vec<u8>` (not `Box<[u8]>`) so a sentinel NUL can
        /// sit in spare capacity past `len`.
        Owned(Vec<u8>),
        /// Points into `Fs::shared_buffer`, which is not reset before the last read.
        Borrowed { ptr: *const u8, len: usize },
    }

    impl Contents {
        #[inline]
        pub fn as_slice(&self) -> &[u8] {
            match self {
                Contents::Empty => b"",
                Contents::Owned(v) => v.as_slice(),
                // SAFETY: the per-thread `MutableString` is reset, and the arena dropped, only
                // after the last read through this value.
                Contents::Borrowed { ptr, len } => unsafe {
                    core::slice::from_raw_parts(*ptr, *len)
                },
            }
        }
    }

    impl From<Vec<u8>> for Contents {
        fn from(v: Vec<u8>) -> Self {
            if v.is_empty() {
                Contents::Empty
            } else {
                Contents::Owned(v)
            }
        }
    }

    impl From<Box<[u8]>> for Contents {
        fn from(b: Box<[u8]>) -> Self {
            if b.is_empty() {
                Contents::Empty
            } else {
                Contents::Owned(b.into_vec())
            }
        }
    }

    /// Adapter for the canonical `fs::read_file_contents` (returns
    /// `Cow<'buf,[u8]>` per the spec `PathContentsPair` shape).
    impl<'buf> From<std::borrow::Cow<'buf, [u8]>> for Contents {
        fn from(c: std::borrow::Cow<'buf, [u8]>) -> Self {
            match c {
                std::borrow::Cow::Borrowed([]) => Contents::Empty,
                std::borrow::Cow::Borrowed(s) => Contents::Borrowed {
                    ptr: s.as_ptr(),
                    len: s.len(),
                },
                std::borrow::Cow::Owned(v) => Contents::from(v),
            }
        }
    }

    /// What the contents of an [`Entry`] were read from.
    pub enum SourceFd {
        /// The caller's, such as one from the resolver's entry cache. Never closed here.
        Borrowed(Fd),
        Owned(bun_sys::File),
    }

    impl SourceFd {
        /// As [`bun_sys::File::into_raw`].
        pub fn into_raw(self) -> Fd {
            match self {
                SourceFd::Borrowed(fd) => fd,
                SourceFd::Owned(file) => file.into_raw(),
            }
        }
    }

    impl core::ops::Deref for SourceFd {
        type Target = bun_sys::File;
        fn deref(&self) -> &bun_sys::File {
            match self {
                SourceFd::Borrowed(fd) => bun_sys::File::borrow(fd),
                SourceFd::Owned(file) => file,
            }
        }
    }

    pub struct Entry<C = Contents> {
        pub contents: C,
        /// `None`: no file was read, or it is already closed.
        pub file: Option<SourceFd>,
    }

    impl Entry {
        #[inline]
        pub fn contents(&self) -> &[u8] {
            self.contents.as_slice()
        }
    }

    impl Fs {
        // When we are in a macro, the shared buffer may be in use by the in-progress macro.
        // so we have to dynamically switch it out.
        #[inline]
        fn shared_buffer(&mut self) -> &mut MutableString {
            if !self.use_alternate_source_cache {
                &mut self.shared_buffer
            } else {
                &mut self.macro_shared_buffer
            }
        }

        pub fn read_file_with_allocator(
            &mut self,
            path: &[u8],
            dirname_fd: Fd,
            use_shared_buffer: bool,
            file_handle: Option<Fd>,
        ) -> crate::CrateResult<Entry> {
            Self::read_file(path, dirname_fd, file_handle, |file| {
                let stream = self.stream;
                let contents =
                    read_file_contents(file, use_shared_buffer, self.shared_buffer(), stream)?;
                Ok(Contents::from(contents))
            })
        }

        /// For a caller with no use for the descriptor.
        pub(crate) fn read_file_and_close(
            &mut self,
            path: &[u8],
            dirname_fd: Fd,
        ) -> crate::CrateResult<Vec<u8>> {
            let entry = self.read_file_with_allocator(path, dirname_fd, false, None)?;
            Ok(match entry.contents {
                Contents::Owned(contents) => contents,
                other => other.as_slice().to_vec(),
            })
        }

        pub fn read_file_into_arena<'a>(
            path: &[u8],
            dirname_fd: Fd,
            file_handle: Option<Fd>,
            arena: &'a bun_alloc::Arena,
            byte_order_mark: ByteOrderMark,
        ) -> crate::CrateResult<Entry<&'a [u8]>> {
            Self::read_file(path, dirname_fd, file_handle, |file| {
                read_file_contents_in_arena(file, arena, byte_order_mark)
            })
        }

        fn read_file<C>(
            path: &[u8],
            dirname_fd: Fd,
            file_handle: Option<Fd>,
            read: impl FnOnce(&bun_sys::File) -> crate::CrateResult<C>,
        ) -> crate::CrateResult<Entry<C>> {
            let will_close =
                fs_mod::FileSystem::get().fs.need_to_close_files() && file_handle.is_none();

            let file = if let Some(f) = file_handle {
                bun_sys::lseek(f, 0, libc::SEEK_SET).map_err(crate::Error::from)?;
                SourceFd::Borrowed(f)
            } else if feature_flags::STORE_FILE_DESCRIPTORS && dirname_fd.is_valid() {
                match bun_sys::File::openat(
                    dirname_fd,
                    bun_paths::basename(path),
                    bun_sys::O::RDONLY,
                    0,
                ) {
                    Ok(file) => SourceFd::Owned(file),
                    Err(err) if err.get_errno() == bun_sys::E::ENOENT => {
                        let handle = bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)
                            .map_err(crate::Error::from)?;
                        bun_core::pretty_errorln!(
                            "<r><d>Internal error: directory mismatch for directory \"{}\", fd {}<r>. You don't need to do anything, but this indicates a bug.",
                            bstr::BStr::new(path),
                            dirname_fd,
                        );
                        SourceFd::Owned(handle)
                    }
                    Err(err) => return Err(err.into()),
                }
            } else {
                let handle = bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)
                    .map_err(crate::Error::from)?;
                SourceFd::Owned(handle)
            };

            #[cfg(not(windows))] // skip on Windows because NTCreateFile will do it.
            bun_core::scoped_log!(
                CacheFs,
                "openat({}, {}) = {}",
                dirname_fd,
                bstr::BStr::new(path),
                file.fd()
            );

            let contents = read(&file).inspect_err(|err| {
                if cfg!(debug_assertions) {
                    Output::print_error(format_args!(
                        "{}: readFile error -- {}",
                        bstr::BStr::new(path),
                        bstr::BStr::new(err.name()),
                    ));
                }
            })?;

            if will_close {
                bun_core::scoped_log!(CacheFs, "readFileWithAllocator close({})", file.fd());
            }
            Ok(Entry {
                contents,
                file: (feature_flags::STORE_FILE_DESCRIPTORS && !will_close).then_some(file),
            })
        }
    }
}

pub use ::bun_paths::{is_package_path, is_package_path_not_absolute};

// Resolver implementation modules. Each file declares the sibling-crate `use`s
// it needs; cross-file references go through `crate::*` paths.
pub mod compiled_program;
pub mod options;
pub mod package_names;
pub mod resolver;
pub mod result;
pub mod standalone_module_graph;
