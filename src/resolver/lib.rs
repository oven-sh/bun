#![allow(non_snake_case)]
#![allow(non_upper_case_globals)]
#![warn(unused_must_use)]
#![feature(adt_const_params)]
#![feature(core_io_borrowed_buf)]
// ──────────────────────────────────────────────────────────────────────────
// Resolver body. Higher-tier deps are reached via lower-tier crates:
// bun_install -> bun_install_types::AutoInstaller trait; bun_standalone_graph ->
// crate::StandaloneModuleGraph trait; HardcodedModule -> bun_resolve_builtins.
// ──────────────────────────────────────────────────────────────────────────

// Submodules. `fs.rs` (full RealFS readdir/stat/kind path) is mounted as
// `fs_full`; the inline `pub mod fs` below remains the canonical type surface
// (FileSystem, RealFS, Path, PathName, Entry, DirEntry, EntryLookup,
// EntriesOption, Implementation) and re-exports from `fs_full`.
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
pub use dir_info::DirInfoRef;
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
pub use resolver::{BrowserMapPathKind, Bufs, Dirname, Resolver, module_type_from_ext};
pub use result::{
    DebugLogs, DirEntryResolveQueueItem, ExternalKind, FlushMode, LoadResult, MatchResult,
    MatchStatus, PathPair, Result, ResultFlags, ResultUnion,
};
pub use standalone_module_graph::{
    BytecodeModule, LINKED_BYTECODE_REGION_COUNT, StandaloneModuleGraph,
};

/// `bun_resolver::fs` namespace; re-exports from `fs_full` plus the
/// in-tree types (`FileSystem`, `RealFS`, `Entry`, ...).
pub mod fs {
    use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

    use bun_core::ZStr;

    // ── DirnameStore / FilenameStore ─────────────────────────────────────
    // The resolver body interns paths via `dirname_store.append_slice` /
    // `append_parts`. Backed by `bun_alloc::BSSStringList` singletons emitted
    // via `bss_string_list!` (per-monomorphization static + first-call init).

    // `BSSStringList(2048, 128)` → `<{2048*2}, {128+1}>`
    bun_alloc::bss_string_list! { pub dirname_store_backing : 4096, 129 }
    // `bss_singleton!` emits one private `STORAGE` per declare site, so the
    // filename store is declared once, in `fs_full`, and shared with the
    // `readdir` appender (`FilenameStoreAppender`). A second declaration here
    // would be a separate store that `exists`/`as_interned` cannot see into.
    pub use crate::fs_full::filename_store_backing;

    /// Port of `FileSystem.DirnameStore` (`BSSStringList<2048,128>`).
    pub struct DirnameStore(());
    /// Port of `FileSystem.FilenameStore` (`BSSStringList<4096,64>`).
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
                    // SAFETY: `$backing()` returns the raw `*mut` process-lifetime singleton;
                    // `BSSStringList::append` takes `*mut Self` and serializes
                    // all mutation through its internal `mutex` (no aliased `&mut` is ever
                    // formed). The returned slice borrows its never-freed backing storage
                    // (heap-owned by a `'static` `BSSStringList` or a leaked mi_malloc), so
                    // widening to `'static` is sound.
                    unsafe { bun_alloc::BSSStringList::append($backing(), &value) }
                        .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))
                }
                pub fn append_parts(&self, parts: &[&[u8]]) -> crate::CrateResult<&'static [u8]> {
                    // SAFETY: see `append_slice`.
                    unsafe { bun_alloc::BSSStringList::append($backing(), &parts) }
                        .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))
                }
                /// Format directly into the store's tail; no intermediate `String`.
                pub fn print(
                    &self,
                    args: core::fmt::Arguments<'_>,
                ) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
                    // SAFETY: see `append_slice`.
                    unsafe { bun_alloc::BSSStringList::print($backing(), args) }
                }
                #[inline]
                pub fn exists(&self, value: &[u8]) -> bool {
                    // SAFETY: see `append_slice`.
                    unsafe { &*$backing() }.exists(value)
                }
                /// `value` with the store's lifetime, if it already points into the store.
                #[inline]
                pub fn as_interned(&self, value: &[u8]) -> Option<&'static [u8]> {
                    // SAFETY: see `append_slice`; the singleton is `'static`.
                    unsafe { &*$backing() }.as_interned(value)
                }
            }
        };
    }
    string_store_impl!(DirnameStore, DIRNAME_STORE_ZST, dirname_store_backing);
    string_store_impl!(FilenameStore, FILENAME_STORE_ZST, filename_store_backing);

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
                    // SAFETY: `$backing()` returns the raw `*mut` process-lifetime singleton;
                    // `BSSStringList::append` takes `*mut Self` and serializes all mutation
                    // through its internal `mutex`. Returned slice borrows its never-freed
                    // storage, so widening to `'static` is sound.
                    unsafe { bun_alloc::BSSStringList::append($backing(), &value) }
                        .map_err(|_| bun_alloc::AllocError)
                }
                /// Like `append`, but ASCII-lowercases `value` while copying
                /// it into the store.
                #[inline]
                pub fn append_lower_case(
                    &self,
                    value: &[u8],
                ) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
                    // SAFETY: see `append`.
                    unsafe { bun_alloc::BSSStringList::append_lower_case($backing(), value) }
                        .map_err(|_| bun_alloc::AllocError)
                }
            }
        };
    }
    string_store_append_impl!(DirnameStore, dirname_store_backing);
    string_store_append_impl!(FilenameStore, filename_store_backing);

    // ── FileSystem ───────────────────────────────────────────────────────

    /// Process-global filesystem facade for the resolver. Wraps the real-FS
    /// backend and the dirname/filename interning stores.
    pub struct FileSystem {
        pub fs: Implementation,
        pub dirname_store: &'static DirnameStore,
        pub filename_store: &'static FilenameStore,
    }

    // Global mutable singleton.
    // `RacyCell` is the alias-safe static cell — `init()` is the only writer,
    // serialized at startup; readers go through `get()`.
    static INSTANCE: bun_core::RacyCell<core::mem::MaybeUninit<FileSystem>> =
        bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());
    pub static INSTANCE_LOADED: AtomicBool = AtomicBool::new(false);

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

        /// Only for `RealFS::entries`, whose methods take `&mut self`; otherwise use [`get`](Self::get).
        #[inline]
        pub fn instance() -> &'static mut FileSystem {
            // SAFETY: caller guarantees init() was called, so INSTANCE is initialized.
            unsafe { (*INSTANCE.get()).assume_init_mut() }
        }

        /// Shared-ref accessor for the process-lifetime singleton. Prefer this
        /// over [`instance`] for read-only access (e.g. `top_level_dir`,
        /// `dirname_store`): the resolver runs on a thread pool and a `&'static`
        /// is the only sound shape for concurrent readers.
        ///
        /// # Panics (debug)
        /// If `init()` has not been called yet.
        #[track_caller]
        #[inline]
        pub fn get() -> &'static FileSystem {
            debug_assert!(
                INSTANCE_LOADED.load(core::sync::atomic::Ordering::Acquire),
                "FileSystem::get() before FileSystem::init()"
            );
            // SAFETY: `INSTANCE` is written exactly once by `init()` during
            // single-threaded startup (Release-paired with the Acquire above)
            // and never freed; shared `&` aliases freely across threads.
            unsafe { (*INSTANCE.get()).assume_init_ref() }
        }

        /// First call writes the
        /// global `INSTANCE`; subsequent calls return it untouched. Delegates
        /// `Implementation` construction to `RealFS::init` so the process
        /// RLIMIT_NOFILE is raised and `file_limit`/`file_quota` carry the
        /// real fd budget — `need_to_close_files` depends on that to enable
        /// directory-fd caching.
        pub fn init(top_level_dir: Option<&[u8]>) -> crate::CrateResult<*mut FileSystem> {
            Self::init_with_force::<false>(top_level_dir)
        }

        /// When `FORCE`, re-seeds
        /// the singleton even if already loaded — used by the router test
        /// harness which `chdir`s between fixtures and needs a fresh
        /// `top_level_dir`.
        pub(crate) fn init_with_force<const FORCE: bool>(
            top_level_dir: Option<&[u8]>,
        ) -> crate::CrateResult<*mut FileSystem> {
            if INSTANCE_LOADED.load(Ordering::Acquire) && !FORCE {
                return Ok(INSTANCE.get().cast::<FileSystem>());
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
            // Seed the lower-tier `bun_paths::fs::FileSystem` singleton with the
            // same cwd. `bun_paths::resolve_path::relative*` and
            // `Path::init_top_level_dir` reach `bun_paths::fs::FileSystem::
            // instance()` (a strict `OnceLock` — panics if unset), and the
            // doc-comment on that `init` names this as the intended seeding
            // point. This keeps both halves in lockstep.
            // The call is a no-op on subsequent inits (`OnceLock::set` returns
            // `Err`). `cwd` is passed as raw bytes — POSIX paths are not
            // guaranteed UTF-8, and the lower tier stores/serves bytes.
            bun_paths::fs::FileSystem::init(cwd);
            bun_core::set_top_level_dir(cwd);
            // SAFETY: single-threaded startup; called from
            // `Transpiler::init` before any worker spawn.
            unsafe {
                (*INSTANCE.get()).write(FileSystem {
                    fs: Implementation::init(cwd),
                    dirname_store: DirnameStore::instance(),
                    filename_store: FilenameStore::instance(),
                });
                INSTANCE_LOADED.store(true, Ordering::Release);
                // Spec `Implementation.init` calls `DirEntry.EntryStore.init`;
                // touch the singleton so it's initialized before any resolver
                // worker hits it.
                let _ = dir_entry::EntryStore::instance();
                Ok((*INSTANCE.get()).as_mut_ptr())
            }
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

        /// Joins against `top_level_dir`
        /// into the resolver-shared threadlocal join buffer.
        pub fn abs(&self, parts: &[&[u8]]) -> &[u8] {
            use bun_paths::resolve_path::{join_abs_string, platform};
            join_abs_string::<platform::Loose>(self.top_level_dir(), parts)
        }

        /// `ENAMETOOLONG` on overflow.
        pub(crate) fn abs_checked(
            &self,
            parts: &[&[u8]],
        ) -> core::result::Result<&[u8], bun_errno::SystemErrno> {
            use bun_paths::resolve_path::{join_abs_string_checked, platform};
            join_abs_string_checked::<platform::Loose>(self.top_level_dir(), parts)
                .ok_or(bun_errno::SystemErrno::ENAMETOOLONG)
        }

        /// Like `abs`, but interns the joined path into `DirnameStore` and
        /// returns the `'static` copy.
        pub(crate) fn abs_alloc(
            &self,
            parts: &[&[u8]],
        ) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
            use bun_paths::resolve_path::{join_abs_string, platform};
            let joined = join_abs_string::<platform::Loose>(self.top_level_dir(), parts);
            // Route through DirnameStore so
            // the resolver's `&'static [u8]` storage contract holds.
            DirnameStore::instance()
                .append_slice(joined)
                .map_err(|_| bun_alloc::AllocError)
        }

        /// Relative path from `from` to `to`. Returns a slice into the
        /// resolver-shared threadlocal relative buffer; caller must dup
        /// before the next call.
        pub fn relative(&self, from: &[u8], to: &[u8]) -> &'static [u8] {
            bun_paths::resolve_path::relative(from, to)
        }

        /// Relative path from
        /// `top_level_dir` to `to`. Returns a slice into the resolver-shared
        /// threadlocal relative buffer; caller must dup before the next call.
        pub fn relative_to(&self, to: &[u8]) -> &'static [u8] {
            bun_paths::resolve_path::relative(self.top_level_dir(), to)
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

        /// Returns the cached
        /// `*EntriesOption` slot owned by the resolver's BSSMap singleton
        /// (process-lifetime).
        #[inline]
        pub fn read_directory(
            &mut self,
            dir: &[u8],
            generation: Generation,
            store_fd: bool,
        ) -> crate::CrateResult<&'static EntriesOption> {
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
        /// bound across repeated in-process `Bun.build()` calls, eventually
        /// tripping the overflow-block cap (index-out-of-bounds panic).
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
    pub use crate::fs_full::{
        DirEntry, DirEntryIterator, Entry, EntryCache, EntryKind, EntryKindResolver, EntryLookup,
        FilenameStoreAppender, dir_entry,
    };

    use bun_core::Generation;
    use bun_paths::strings;
    use bun_ptr::Interned;
    use bun_sys::Fd;
    use bun_threading::Mutex;

    // Port of `threadlocal var temp_entries_option: EntriesOption = undefined` —
    // `read_directory*` returns a pointer into this when the entry-cache is
    // disabled or the path is `mark_not_found`. `RefCell` (not `UnsafeCell`) so
    // the per-thread unique-borrow is debug-checked; matches the sibling
    // `TEMP_ENTRIES_OPTION` in `fs.rs`.
    thread_local! {
        static TEMP_ENTRIES_OPTION: core::cell::RefCell<core::mem::MaybeUninit<EntriesOption>> =
            const { core::cell::RefCell::new(core::mem::MaybeUninit::uninit()) };
    }

    fn temp_entries_option_write(value: EntriesOption) -> &'static EntriesOption {
        TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
            slot.write(value);
            // SAFETY: just wrote; threadlocal storage outlives the caller.
            // Re-erase to 'static for the BSSMap-shaped
            // unbounded `&EntriesOption` return type — the `RefMut` guard
            // drops immediately on return, so no live `RefCell` borrow aliases
            // the escaped reference.
            unsafe { &*slot.as_ptr() }
        })
    }

    // Modeled as
    // an unbounded `&mut DirEntry` so resolver match arms (`Entries(entries) =>
    // entries.dir`) auto-deref. The backing storage is the BSSMap singleton;
    // `'static` is the ARENA lifetime.
    pub enum EntriesOption {
        Entries(&'static mut DirEntry),
        Err(dir_entry::Err),
    }

    impl EntriesOption {
        // Payload is `&'static mut DirEntry`; auto-deref coerces to `&DirEntry` / `&mut DirEntry`.
        bun_core::enum_unwrap!(pub EntriesOption, Entries => fn entries / entries_mut -> DirEntry);

        /// The listing, or the error that reading the directory gave.
        pub fn try_entries(&self) -> crate::CrateResult<&DirEntry> {
            match self {
                EntriesOption::Entries(entries) => Ok(&**entries),
                EntriesOption::Err(err) => Err(err.canonical_error),
            }
        }

        pub(crate) fn as_entries(&self) -> Option<&DirEntry> {
            match self {
                EntriesOption::Entries(entries) => Some(&**entries),
                EntriesOption::Err(_) => None,
            }
        }

        /// Probe the cached listing for `query` and return the lookup plus the
        /// listing fd, in one `entries_mutex` critical section. A
        /// stale-generation re-read rewrites the slot's `DirEntry` (and frees
        /// the old map's buckets) in place under that lock, so the map must
        /// not be walked after unlock; the returned entry pointer is
        /// EntryStore-owned and stays valid. The caller must NOT already hold
        /// `entries_mutex` (it is non-recursive).
        pub(crate) fn lookup(&self, query: &[u8]) -> (Option<crate::fs_full::EntryLookup>, Fd) {
            let _lock = FileSystem::get().fs.entries_mutex.lock_guard();
            match self {
                EntriesOption::Entries(entries) => (entries.get(query), entries.fd),
                EntriesOption::Err(_) => (None, Fd::INVALID),
            }
        }

        /// Listing dir snapshot under `entries_mutex` (watch
        /// registration); `None` when the slot holds a read error.
        pub(crate) fn dir(&self) -> Option<&'static [u8]> {
            let _lock = FileSystem::get().fs.entries_mutex.lock_guard();
            match self {
                EntriesOption::Entries(entries) => Some(entries.dir),
                EntriesOption::Err(_) => None,
            }
        }
    }

    // SAFETY: ARENA — `EntriesOption` holds an unbounded `&mut DirEntry` (whose `data`
    // map stores `*mut Entry` into the BSSMap singleton). All access is serialized
    // through `RealFS.entries_mutex`. The
    // raw-pointer fields are the only thing blocking auto-Sync.
    unsafe impl Sync for EntriesOption {}
    // SAFETY: the `&'static mut DirEntry` points into the process-lifetime BSSMap
    // singleton; ownership may cross threads under the same `entries_mutex` serialization.
    unsafe impl Send for EntriesOption {}

    /// Fixed-capacity (2048-entry) BSS-backed hash map for the directory-entry
    /// cache. Keys are not stored — only their hashes — so lookups cannot
    /// recover key bytes (`BSSMapInner` is the keyless inner shape).
    type EntriesOptionMap = bun_alloc::BSSMapInner<EntriesOption, 2048, true>;

    // Per-monomorphization singleton storage for `EntriesOption.Map`.
    bun_alloc::bss_map_inner! { pub entries_option_map : EntriesOption, 2048, true }

    /// Resolver-side wrapper over `EntriesOptionMap` exposing the BSSMap surface
    /// (`get`, `get_or_put`, `at_index`, `put`, `mark_not_found`). ZST handle —
    /// every call resolves to the `entries_option_map()` singleton; this keeps
    /// `RealFS.entries` field-shaped without inlining the (large) backing array.
    ///
    /// **Uniqueness invariant**: this is a ZST proxy for a process-global, so a
    /// freely-mintable value would let two threads each hold a "unique" `&mut
    /// EntriesMap` and alias the same backing storage. Construction is therefore
    /// module-private (`new()` below) and the *only* instance lives at
    /// `FileSystem::INSTANCE.fs.entries`, written once by `RealFS::init` during
    /// single-threaded startup. `&mut self` on the methods below is thus a real
    /// uniqueness witness — obtaining it requires `&mut` to that singleton field.
    pub struct EntriesMap(());
    impl EntriesMap {
        /// Module-private: only `RealFS::init` may construct the singleton handle.
        /// Widening this to `pub` re-opens the aliased-`&mut` hazard described on
        /// the struct.
        #[inline]
        const fn new() -> Self {
            Self(())
        }
        #[inline]
        fn inner(&mut self) -> &mut EntriesOptionMap {
            // NOTE(73d79707): the data-race fix had a debug_assert here
            // requiring `entries_mutex` OR `RESOLVER_MUTEX` held. Too strict —
            // `&mut self` callers (every callsite) already prove exclusivity
            // via borrowck; the runtime transpile path
            // (`jsc_hooks::transpile_source_code`) reaches here via
            // `&mut RealFS` without either mutex and is safe. The assert fired
            // on every `bun-debug` invocation. Removed; the singleton's
            // raw-ptr backdoor is covered by the `&mut self` receiver.
            // SAFETY: `entries_option_map()` yields the process-static `*mut`
            // singleton. `&mut self` proves the caller holds the unique
            // `RealFS.entries` field (see struct invariant), and the returned
            // borrow is bounded by that `&mut self` — it cannot outlive the
            // field borrow nor be sent to another thread independently of it.
            // Cross-thread exclusion is provided by the mutex asserted above.
            unsafe { &mut *entries_option_map() }
        }
        pub fn get(&mut self, key: &[u8]) -> Option<&mut EntriesOption> {
            self.inner().get(key)
        }
        pub(crate) fn get_or_put(&mut self, key: &[u8]) -> crate::CrateResult<bun_alloc::Result> {
            self.inner()
                .get_or_put(key)
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))
        }
        pub(crate) fn at_index(
            &mut self,
            index: bun_alloc::IndexType,
        ) -> Option<&mut EntriesOption> {
            self.inner().at_index(index)
        }
        pub(crate) fn put(
            &mut self,
            result: &mut bun_alloc::Result,
            value: EntriesOption,
        ) -> crate::CrateResult<*mut EntriesOption> {
            // `BSSMapInner::put` mutates `result.index` to record placement; callers
            // (e.g. `dir_info_cached_maybe_log`) re-read `result.index` post-`put`, so the
            // mutation must be visible — pass through directly.
            self.inner()
                .put(result, value)
                .map(std::ptr::from_mut::<EntriesOption>)
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))
        }
        pub(crate) fn mark_not_found(&mut self, result: bun_alloc::Result) {
            self.inner().mark_not_found(result)
        }
        pub(crate) fn remove(&mut self, key: &[u8]) -> bool {
            self.inner().remove(key)
        }
    }

    /// The active filesystem backend (always the real filesystem).
    pub(crate) type Implementation = RealFS;

    // ── RealFS ───────────────────────────────────────────────────────────

    /// Real-filesystem backend: directory-entry cache plus fd-limit
    /// bookkeeping.
    pub struct RealFS {
        pub entries_mutex: Mutex,
        /// Port of `entries: *EntriesOption.Map`. The resolver body addresses
        /// this directly (`rfs.entries.get_or_put(..)`); modeled as the wrapper
        /// `EntriesMap` (bun_alloc has no BSSMap equivalent).
        pub entries: EntriesMap,
        pub(crate) cwd: &'static [u8],
        #[cfg(not(windows))]
        pub(crate) file_limit: usize,
    }

    impl RealFS {
        /// Raise RLIMIT_NOFILE and
        /// record the resulting fd budget so `need_to_close_files` can decide
        /// whether to cache directory fds.
        pub(crate) fn init(cwd: &'static [u8]) -> RealFS {
            let file_limit = Self::adjust_ulimit();
            #[cfg(windows)]
            let _ = file_limit;
            RealFS {
                entries_mutex: Mutex::default(),
                entries: EntriesMap::new(),
                cwd,
                #[cfg(not(windows))]
                file_limit,
            }
        }

        /// Port of `RealFS.adjustUlimit` — always try to max out how many
        /// files we can keep open. Returns 0 when the limit cannot be read:
        /// `need_to_close_files` is then always true and no fd stays cached.
        /// `--watch`/`--hot` register an imported module through its cached
        /// fd, so they then only see the entry point.
        pub(crate) fn adjust_ulimit() -> usize {
            #[cfg(not(unix))]
            {
                usize::MAX
            }
            #[cfg(unix)]
            {
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
            &self,
            mut prev_map: Option<&mut dir_entry::EntryMap>,
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
                    dir.add_entry_with_store(prev_map.as_deref_mut(), &entry_, &mut filename_store)?
                {
                    iterator.next(self, entry);
                }
            }

            // debug("readdir({}, {}) = {}", handle, dir_, dir.data.count());

            Ok(dir)
        }

        /// Cache (or threadlocal-
        /// stash) an `EntriesOption::Err` for `dir` and hand back its address.
        fn read_directory_error(
            &mut self,
            dir: &[u8],
            err: crate::Error,
        ) -> crate::CrateResult<&'static EntriesOption> {
            let mut get_or_put_result = self.entries.get_or_put(dir)?;
            if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                self.entries.mark_not_found(get_or_put_result);
                return Ok(temp_entries_option_write(EntriesOption::Err(
                    dir_entry::Err {
                        original_err: err,
                        canonical_error: err,
                    },
                )));
            }
            let opt = self.entries.put(
                &mut get_or_put_result,
                EntriesOption::Err(dir_entry::Err {
                    original_err: err,
                    canonical_error: err,
                }),
            )?;
            // SAFETY: BSSMap-owned slot; outlives caller (process-static singleton).
            Ok(unsafe { &*opt })
        }

        /// A missing directory's `Err` is this thread's scratch slot; read it before the next call.
        pub fn read_directory(
            &mut self,
            dir_: &[u8],
            handle_: Option<Fd>,
            generation: Generation,
            store_fd: bool,
        ) -> crate::CrateResult<&'static EntriesOption> {
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
            &mut self,
            dir_maybe_trail_slash: &[u8],
            maybe_handle: Option<Fd>,
            generation: Generation,
            store_fd: bool,
            iterator: &mut I,
        ) -> crate::CrateResult<&'static EntriesOption> {
            let dir = strings::paths::without_trailing_slash_windows_path(dir_maybe_trail_slash);

            crate::Resolver::assert_valid_cache_key(dir);
            let _unlock_guard = self.entries_mutex.lock_guard();

            let mut in_place: Option<*mut DirEntry> = None;

            let mut cache_result = self.entries.get_or_put(dir)?;
            if cache_result.has_checked_if_exists() {
                if let Some(cached_result) = self.entries.at_index(cache_result.index) {
                    // erase to raw immediately so the early-return reborrow
                    // doesn't conflict with the `&mut self.entries` borrow above.
                    let cached_ptr = std::ptr::from_mut::<EntriesOption>(cached_result);
                    // SAFETY: BSSMap-owned slot; uniquely held under `entries_mutex`.
                    // Single `&mut` reborrow — the catch-all arm binds and returns the
                    // scrutinee directly so no second `&mut *cached_ptr` is materialized
                    // while the first is on the borrow stack (Stacked Borrows hygiene).
                    match unsafe { &mut *cached_ptr } {
                        EntriesOption::Entries(e) if e.generation < generation => {
                            in_place = Some(std::ptr::from_mut::<DirEntry>(*e));
                        }
                        cached => return Ok(cached),
                    }
                } else if cache_result.status == bun_alloc::ItemStatus::NotFound && generation == 0
                {
                    return Ok(temp_entries_option_write(EntriesOption::Err(
                        dir_entry::Err {
                            original_err: crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                            canonical_error: crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                        },
                    )));
                }
            }

            let had_handle = maybe_handle.is_some();
            let mut opened = None;
            let handle: &bun_sys::Dir = match &maybe_handle {
                Some(lent) => bun_sys::Dir::borrow(lent),
                None => match self.open_dir(dir) {
                    Ok(fd) => opened.insert(bun_sys::Dir::from_fd(fd)),
                    Err(err) => return self.read_directory_error(dir, err),
                },
            };

            // if we get this far, it's a real directory, so we can just store the dir name.
            // An in-place refresh always keeps the slot's existing interned name: callers
            // spell the same directory with and without a trailing slash, and rewriting
            // `dir` to the other spelling races every unlocked `Entry::dir()` reader.
            let dir: &'static [u8] = if let Some(existing) = in_place {
                // SAFETY: `in_place` points to a `DirEntry` inside the BSSMap singleton;
                // its `dir` field is DirnameStore-interned (&'static).
                unsafe { (*existing).dir }
            } else if !had_handle {
                DirnameStore::instance().append_slice(dir_maybe_trail_slash)?
            } else {
                // Intern into DirnameStore so the cache entry never dangles —
                // `append_slice` is a bump-pointer copy, cost is bounded.
                DirnameStore::instance().append_slice(dir)?
            };

            // Cache miss: read the directory entries
            let prev = in_place.map(|p| {
                // SAFETY: BSSMap-owned, no aliasing here (entries_mutex held).
                unsafe { &mut (*p).data }
            });
            let mut entries = match self.readdir(prev, dir, generation, handle, iterator) {
                Ok(e) => e,
                Err(err) => {
                    if let Some(existing) = in_place {
                        // SAFETY: see above.
                        unsafe { (*existing).data.clear() };
                    }
                    return self.read_directory_error(dir, err);
                }
            };

            // `EntriesOption::Entries` here holds an unbounded `&mut DirEntry` (raw, BSSMap-stored
            // pointer), so a fresh slot is a leaked `Box<DirEntry>` whose lifetime is the
            // `entries_option_map()` singleton (process-static).
            let entries_ptr: *mut DirEntry = match in_place {
                Some(p) => p,
                None => bun_core::heap::into_raw(Box::new(DirEntry::init(dir, generation))),
            };
            if let Some(original) = in_place {
                // SAFETY: BSSMap-owned; entries_mutex held.
                unsafe { (*original).data.clear() };
            }
            if let Some(opened) = opened.filter(|_| store_fd && !self.need_to_close_files()) {
                entries.fd = opened.into_raw();
                FileSystem::set_max_fd(entries.fd.native());
            }

            // SAFETY: `entries_ptr` is either a live BSSMap slot (`in_place`) or a fresh
            // leaked Box; exclusively owned here under `entries_mutex`.
            unsafe { *entries_ptr = entries };
            let result = EntriesOption::Entries(
                // SAFETY: see above — re-borrow as 'static for the BSSMap slot.
                unsafe { &mut *entries_ptr },
            );

            let out = self.entries.put(&mut cache_result, result)?;
            // SAFETY: BSSMap-owned slot; outlives caller (process-static singleton).
            Ok(unsafe { &*out })
        }

        /// Evicts `file_path` from the directory-entry cache; returns whether
        /// an entry was removed.
        pub(crate) fn bust_entries_cache(&mut self, file_path: &[u8]) -> bool {
            // `entries` is the process-global
            // BSSMap singleton and `remove` mutates it; callers (transpiler /
            // hot-reloader / VM) reach this without `RESOLVER_MUTEX`, so take
            // `entries_mutex` to satisfy `EntriesMap::inner`'s aliasing
            // invariant. No caller already holds it (no re-entry from
            // `read_directory`/`dir_info_cached_maybe_log`).
            let _g = self.entries_mutex.lock_guard();
            self.entries.remove(file_path)
        }

        /// lstat + (if symlink) open + fstat +
        /// readlink to populate an `EntryCache`. Windows: `GetFileAttributesW` +
        /// (if reparse point) `CreateFileW`-follow + `GetFinalPathNameByHandle`
        /// realpath.
        pub(crate) fn kind(
            &self,
            dir_: &[u8],
            base: &[u8],
            existing_fd: Fd,
            store_fd: bool,
        ) -> crate::CrateResult<EntryCache> {
            use bun_paths::resolve_path::{join_abs_string_buf_z_checked, platform};
            #[cfg(not(windows))]
            use bun_sys::{FileKind, kind_from_mode};

            let mut cache = EntryCache {
                kind: EntryKind::File,
                symlink: Interned::EMPTY,
                fd: Fd::INVALID,
            };

            let combo: [&[u8]; 2] = [dir_, base];
            let mut outpath = bun_paths::path_buffer_pool::get();
            let join_capacity = outpath.len() - 1;
            let Some(absolute_path_c) = join_abs_string_buf_z_checked::<platform::Auto>(
                self.cwd,
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

                let mut buf2 = bun_paths::path_buffer_pool::get();
                if let Ok(real) = bun_sys::get_fd_path(Fd::from_system(handle), &mut buf2) {
                    cache.symlink =
                        Interned::from_static(FilenameStore::instance().append_slice(real)?);
                }
                return Ok(cache);
            }

            #[cfg(not(windows))]
            {
                let stat_ = bun_sys::lstat(absolute_path_c)?;
                let is_symlink =
                    kind_from_mode(stat_.st_mode as bun_sys::Mode) == FileKind::SymLink;
                let mut file_kind = kind_from_mode(stat_.st_mode as bun_sys::Mode);

                let mut symlink: &[u8] = b"";

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
                    symlink = bun_sys::get_fd_path(file.fd(), &mut outpath)?;
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
                if !symlink.is_empty() {
                    cache.symlink =
                        Interned::from_static(FilenameStore::instance().append_slice(symlink)?);
                }

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

    impl crate::fs_full::EntryKindResolver for RealFS {
        #[inline(always)]
        fn resolve_kind(
            &self,
            dir: &[u8],
            base: &[u8],
            existing_fd: bun_sys::Fd,
            store_fd: bool,
        ) -> crate::CrateResult<EntryCache> {
            self.kind(dir, base, existing_fd, store_fd)
        }
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
                !(self.file_limit > 254
                    && self.file_limit > (FileSystem::max_fd() as usize + 1) * 2)
            }
        }

        /// Index lookup with generation-check
        /// re-read (open + readdir + cache replace) when the cached listing is
        /// stale. The generation-stale branch drops the existing `DirEntry`
        /// (and the bucket allocation behind its `data` map) in place, and
        /// every `.data` reader holds `entries_mutex` for the probe, so the
        /// caller must already hold it (the mutex is non-recursive).
        pub(crate) fn entries_at_locked(
            &mut self,
            index: bun_alloc::IndexType,
            generation: Generation,
        ) -> Option<&EntriesOption> {
            debug_assert!(
                self.entries_mutex.is_held_by_current_thread(),
                "entries_at_locked: caller must hold entries_mutex",
            );
            // erase to raw immediately so re-borrowing `&mut self` for
            // `open_dir`/`readdir`/`read_directory_error` doesn't conflict.
            // `entries_mutex` held by the caller; sole `&mut` to this slot.
            let result_ptr = std::ptr::from_mut::<EntriesOption>(self.entries.at_index(index)?);
            // SAFETY: BSSMap-owned slot; uniquely held under `entries_mutex`.
            if let EntriesOption::Entries(existing) = unsafe { &mut *result_ptr } {
                if existing.generation < generation {
                    let e_ptr: *mut DirEntry = std::ptr::from_mut::<DirEntry>(*existing);
                    // SAFETY: BSSMap-owned `DirEntry` (boxed/leaked into `EntriesOption`); `entries_mutex` held.
                    let dir = unsafe { (*e_ptr).dir };
                    let handle = match bun_sys::Dir::open(dir) {
                        Ok(handle) => handle,
                        Err(err) => {
                            // SAFETY: see above.
                            unsafe { (*e_ptr).data.clear() };
                            return self.read_directory_error(dir, err.into()).ok();
                        }
                    };
                    // SAFETY: see above — exclusive `&mut` on the prev map for the duration of `readdir`.
                    let prev = Some(unsafe { &mut (*e_ptr).data });
                    match self.readdir(prev, dir, generation, &handle, &mut ()) {
                        Ok(new_entry) => {
                            // SAFETY: see above.
                            unsafe { (*e_ptr).data.clear() };
                            // SAFETY: see above — slot is exclusively owned here.
                            unsafe { *e_ptr = new_entry };
                        }
                        Err(err) => {
                            // SAFETY: see above.
                            unsafe { (*e_ptr).data.clear() };
                            return self.read_directory_error(dir, err).ok();
                        }
                    }
                }
            }
            // SAFETY: BSSMap-owned slot; outlives caller (process-static singleton).
            Some(unsafe { &*result_ptr })
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
        pub use super::{DirEntry, DirnameStore, Entry, EntryKind, FilenameStore, RealFS};
        pub mod real_fs {
            pub use crate::fs::EntriesOption;
        }
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
    use crate::fs::{DirEntry, EntriesOption, Entry, EntryKind, FileSystem as FS};
    use bun_core::ZStr;
    use bun_glob::walk::{self, Accessor, AccessorDirIter};
    use bun_paths::{Platform, resolve_path};
    use bun_sys::{self as Syscall, Result as Maybe, Stat};

    pub struct DirEntryAccessor;

    pub struct DirEntryHandle {
        pub(crate) value: Option<&'static DirEntry>,
    }

    // `dir_entry::EntryMap` = `StringHashMap<*mut Entry>` which derefs to
    // `std::collections::HashMap<Box<[u8]>, *mut Entry>`; iterate that directly.
    type EntryMapIter = bun_collections::hashbrown::hash_map::Iter<
        'static,
        bun_collections::StringHashMapKey,
        *mut Entry,
    >;

    pub struct DirEntryDirIter {
        value: Option<EntryMapIter>,
    }

    impl AccessorDirIter for DirEntryDirIter {
        type Handle = DirEntryHandle;

        #[inline]
        fn next(&mut self) -> Maybe<Option<walk::AccessorDirEntry<'_>>> {
            if let Some(value) = &mut self.value {
                let Some((key, val)) = value.next() else {
                    return Ok(None);
                };
                // BACKREF: ARENA — `*mut Entry` points into the EntryStore
                // BSSList singleton ('static lifetime). This iterator holds a
                // live `.data` iterator across calls, which `entries_mutex`
                // cannot cover; it is only sound on the single-threaded CLI
                // glob walk (`bun run --filter`), before any concurrent
                // resolver exists to rewrite the map.
                let entry = bun_ptr::BackRef::<Entry>::from(
                    core::ptr::NonNull::new(*val).expect("EntryStore slot"),
                );
                let kind = entry.kind(&FS::get().fs, true);
                let fskind = match kind {
                    EntryKind::File => bun_sys::FileKind::File,
                    EntryKind::Dir => bun_sys::FileKind::Directory,
                    // The walker gets to apply its own broken-symlink handling.
                    EntryKind::Dangling => bun_sys::FileKind::SymLink,
                };
                // `Entry::kind` resolved through symlinks above; a non-empty
                // cached realpath is what records the entry as a symlink.
                let symlink_target = entry.cache().symlink.as_bytes();
                Ok(Some(walk::AccessorDirEntry {
                    name: key,
                    kind: fskind,
                    symlink_target: (!symlink_target.is_empty()).then_some(symlink_target),
                }))
            } else {
                Ok(None)
            }
        }

        #[inline]
        fn iterate(dir: &DirEntryHandle) -> Self {
            let Some(entry) = dir.value else {
                return DirEntryDirIter { value: None };
            };
            DirEntryDirIter {
                value: Some(entry.data.iter()),
            }
        }
    }

    impl DirEntryAccessor {
        /// Joins `path` onto the handle's directory. The result can be longer than a path buffer.
        fn full_path<'a>(
            handle: &DirEntryHandle,
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
        type Handle = DirEntryHandle;
        type DirIter = DirEntryDirIter;

        fn statat(handle: &DirEntryHandle, path_: &ZStr) -> Maybe<Stat> {
            let mut buf = bun_paths::path_buffer_pool::get();
            let mut spill = Vec::new();
            Syscall::stat(Self::full_path(handle, path_, &mut buf[..], &mut spill))
        }

        /// Like statat but does not follow symlinks.
        fn lstatat(handle: &DirEntryHandle, path_: &ZStr) -> Maybe<Stat> {
            let mut buf = bun_paths::path_buffer_pool::get();
            if let Some(entry) = handle.value {
                return Syscall::lstatat(entry.fd, path_);
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
            Self::openat(&DirEntryHandle { value: None }, path)
        }

        fn openat(
            handle: &DirEntryHandle,
            path_: &ZStr,
        ) -> Result<Maybe<DirEntryHandle>, bun_core::Error> {
            let mut buf = bun_paths::path_buffer_pool::get();
            let mut spill = Vec::new();
            let path = Self::full_path(handle, path_, &mut buf[..], &mut spill);
            // TODO do we want to propagate ENOTDIR through the 'Maybe' to match the SyscallAccessor?
            // The glob implementation specifically checks for this error when dealing with symlinks
            // return Err(SysError::from_code(E::NOTDIR, Syscall::Tag::open));
            let res = FS::instance()
                .fs
                .read_directory(path.as_bytes(), None, 0, false)
                .map_err(crate::Error::into_core)?;
            match res {
                EntriesOption::Entries(entry) => Ok(Ok(DirEntryHandle {
                    value: Some(&**entry),
                })),
                EntriesOption::Err(err) => Err(err.original_err.into_core()),
            }
        }
    }
}
pub use dir_entry_accessor::DirEntryAccessor;

// ──────────────────────────────────────────────────────────────────────────
// `cache` — `Set`/`Fs`/`Entry`/
// `Json`). These types live below `bun_bundler` in
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
    pub use crate::tsconfig_json::JsonCache as Json;

    bun_core::declare_scope!(CacheFs, visible);

    /// Bundle of the per-transpiler caches: file cache and JSON cache.
    pub struct Set {
        pub fs: Fs,
        pub json: Json,
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
                json: Json::init(),
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
        /// Points into `Fs::shared_buffer` or the caller's arena; neither is reset before the last read.
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

        /// `arena`: when
        /// `!use_shared_buffer && arena.is_some()` the file body is read
        /// directly into `arena`, so the bytes are
        /// bulk-freed by `mi_heap_destroy` when the per-call `MimallocArena`
        /// drops instead of landing in the worker thread's default mimalloc
        /// heap (which is never destroyed). `None` keeps the global-heap
        /// `Contents::Owned(Vec<u8>)` path.
        pub fn read_file_with_allocator(
            &mut self,
            path: &[u8],
            dirname_fd: Fd,
            use_shared_buffer: bool,
            file_handle: Option<Fd>,
            arena: Option<&bun_alloc::Arena>,
        ) -> crate::CrateResult<Entry> {
            Self::read_file(path, dirname_fd, file_handle, |file| {
                let contents = match (use_shared_buffer, arena) {
                    (false, Some(arena)) => std::borrow::Cow::Borrowed(
                        read_file_contents_in_arena(file, arena, ByteOrderMark::Converted)?,
                    ),
                    _ => {
                        let stream = self.stream;
                        read_file_contents(file, use_shared_buffer, self.shared_buffer(), stream)?
                    }
                };
                Ok(Contents::from(contents))
            })
        }

        /// For a caller with no use for the descriptor.
        pub(crate) fn read_file_and_close(
            &mut self,
            path: &[u8],
            dirname_fd: Fd,
        ) -> crate::CrateResult<Vec<u8>> {
            let entry = self.read_file_with_allocator(path, dirname_fd, false, None, None)?;
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
