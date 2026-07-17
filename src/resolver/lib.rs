#![allow(non_snake_case)]
#![allow(non_camel_case_types, non_upper_case_globals)]
#![allow(static_mut_refs, private_interfaces, private_bounds)]
#![warn(unused_must_use)]
#![allow(incomplete_features)]
#![feature(adt_const_params)]
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
pub use resolver::{AnyResolveWatcher, BrowserMapPathKind, Bufs, Dirname, Resolver, RootPathPair};
pub use result::{
    DebugLogs, DebugMeta, DirEntryResolveQueueItem, FlushMode, LoadResult, MatchResult,
    MatchStatus, PathPair, PendingResolution, PendingResolutionTag, Result, ResultFlags,
    ResultUnion, SideEffectsData,
};
pub use standalone_module_graph::StandaloneModuleGraph;

/// `bun_resolver::fs` namespace; re-exports from `fs_full` plus the
/// in-tree types (`FileSystem`, `RealFS`, `Entry`, ...).
pub mod fs {
    use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::io::Write as _;

    use bun_core::ZStr;

    // ── DirnameStore / FilenameStore ─────────────────────────────────────
    // The resolver body interns paths via `dirname_store.append_slice` /
    // `append_parts`. Backed by `bun_alloc::BSSStringList` singletons emitted
    // via `bss_string_list!` (per-monomorphization static + first-call init).

    // `BSSStringList(2048, 128)` → `<{2048*2}, {128+1}>`
    bun_alloc::bss_string_list! { pub dirname_store_backing : 4096, 129 }
    // `BSSStringList(4096, 64)` → `<{4096*2}, {64+1}>`
    bun_alloc::bss_string_list! { pub filename_store_backing : 8192, 65 }

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
                    let s = unsafe { bun_alloc::BSSStringList::print($backing(), args)? };
                    // SAFETY: storage owned by the process-lifetime `BSSStringList`
                    // singleton (never freed); `Interned` is the canonical proof type.
                    Ok(unsafe { bun_ptr::Interned::assume(s) }.as_bytes())
                }
                #[inline]
                pub fn exists(&self, value: &[u8]) -> bool {
                    // SAFETY: see `append_slice`.
                    unsafe { &*$backing() }.exists(value)
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

    /// Process-global filesystem facade for the resolver: holds the cached
    /// top-level dir, the real-FS backend, and the dirname/filename interning
    /// stores.
    pub struct FileSystem {
        pub top_level_dir: &'static [u8],

        // used on subsequent updates (process.chdir writes here and re-slices
        // `top_level_dir` to point into it).
        pub top_level_dir_buf: bun_paths::PathBuffer,

        pub fs: Implementation,
        pub dirname_store: &'static DirnameStore,
        pub filename_store: &'static FilenameStore,
    }

    // Global mutable singleton.
    // `RacyCell` is the alias-safe static cell — `init()` is the only writer,
    // serialized at startup; readers go through `instance()`.
    pub(crate) static INSTANCE: bun_core::RacyCell<core::mem::MaybeUninit<FileSystem>> =
        bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());
    pub static INSTANCE_LOADED: AtomicBool = AtomicBool::new(false);

    // Windows uses `HANDLE` (no monotone ordering); tracked POSIX-only.
    #[cfg(not(windows))]
    pub(crate) static MAX_FD: core::sync::atomic::AtomicI32 = core::sync::atomic::AtomicI32::new(0);

    static TMPNAME_ID_NUMBER: AtomicU32 = AtomicU32::new(0);

    impl FileSystem {
        /// Generates a unique NUL-terminated temp filename into `buf` from
        /// `extname`, `hash`, a per-process counter, and the current time.
        pub fn tmpname<'b>(
            extname: &[u8],
            buf: &'b mut [u8],
            hash: u64,
        ) -> crate::CrateResult<&'b mut ZStr> {
            // bun_core has no `time` module yet; use std directly.
            let nanos: u128 = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let hex_value: u64 = (u128::from(hash) | nanos) as u64;

            let len = buf.len();
            let mut cursor = &mut buf[..];
            write!(
                &mut cursor,
                ".{:x}-{:X}.{}",
                hex_value,
                TMPNAME_ID_NUMBER.fetch_add(1, Ordering::Relaxed),
                bstr::BStr::new(extname),
            )
            .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))?;
            let written = len - cursor.len();
            if written >= len {
                return Err(crate::Error::Sys(bun_errno::SystemErrno::ENOSPC));
            }
            buf[written] = 0;
            Ok(ZStr::from_buf_mut(buf, written))
        }

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
        pub fn init_with_force<const FORCE: bool>(
            top_level_dir: Option<&[u8]>,
        ) -> crate::CrateResult<*mut FileSystem> {
            // SAFETY: single-threaded startup; called from
            // `Transpiler::init` before any worker spawn.
            unsafe {
                if INSTANCE_LOADED.load(Ordering::Acquire) && !FORCE {
                    return Ok((*INSTANCE.get()).as_mut_ptr());
                }
            }
            let cwd: &'static [u8] = match top_level_dir {
                // intern into the process-lifetime `DirnameStore` so
                // callers may pass a borrowed path without leaking it themselves
                // (the singleton outlives every caller).
                Some(d) => DirnameStore::instance().append_slice(d)?,
                None => {
                    let mut buf = bun_paths::PathBuffer::default();
                    let n = bun_sys::getcwd(&mut buf[..])?;
                    DirnameStore::instance().append_slice(&buf[..n])?
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
            // SAFETY: see above.
            unsafe {
                (*INSTANCE.get()).write(FileSystem {
                    top_level_dir: cwd,
                    top_level_dir_buf: bun_paths::PathBuffer::uninit(),
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
        pub fn max_fd() -> bun_sys::RawFd {
            MAX_FD.load(Ordering::Relaxed)
        }

        /// Joins `parts` against `top_level_dir` into `buf`, returning the
        /// absolute path slice.
        pub fn abs_buf<'b>(&self, parts: &[&[u8]], buf: &'b mut [u8]) -> &'b [u8] {
            use bun_paths::resolve_path::{join_abs_string_buf, platform};
            join_abs_string_buf::<platform::Loose>(self.top_level_dir, buf, parts)
        }

        /// Returns `None` on overflow.
        pub fn abs_buf_checked<'b>(&self, parts: &[&[u8]], buf: &'b mut [u8]) -> Option<&'b [u8]> {
            use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
            join_abs_string_buf_checked::<platform::Loose>(self.top_level_dir, buf, parts)
        }

        /// Like `abs_buf` but writes a
        /// NUL sentinel and returns a `ZStr` borrowing `buf`.
        pub fn abs_buf_z<'b>(&self, parts: &[&[u8]], buf: &'b mut [u8]) -> &'b ZStr {
            use bun_paths::resolve_path::{join_abs_string_buf_z, platform};
            join_abs_string_buf_z::<platform::Loose>(self.top_level_dir, buf, parts)
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
            join_abs_string::<platform::Loose>(self.top_level_dir, parts)
        }

        /// Like `abs`, but interns the joined path into `DirnameStore` and
        /// returns the `'static` copy.
        pub fn abs_alloc(
            &self,
            parts: &[&[u8]],
        ) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
            use bun_paths::resolve_path::{join_abs_string, platform};
            let joined = join_abs_string::<platform::Loose>(self.top_level_dir, parts);
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
            bun_paths::resolve_path::relative(self.top_level_dir, to)
        }

        /// Relative path from `from` to `top_level_dir`; same threadlocal
        /// buffer caveat as `relative`.
        pub fn relative_from(&self, from: &[u8]) -> &'static [u8] {
            bun_paths::resolve_path::relative(from, self.top_level_dir)
        }

        /// Cached cwd captured at `FileSystem::init`.
        #[inline]
        pub fn top_level_dir(&self) -> &'static [u8] {
            self.top_level_dir
        }

        /// `dir` must be
        /// `'static` (interned in `DirnameStore` or a process-lifetime buffer
        /// like `cwd_buf`). Takes `&mut self` — callers hold `&'static mut
        /// FileSystem` from `instance()`; only called during single-threaded
        /// CLI init.
        #[inline]
        pub fn set_top_level_dir(&mut self, dir: &'static [u8]) {
            self.top_level_dir = dir;
            bun_core::set_top_level_dir(dir);
        }

        /// `top_level_dir` with any trailing separator stripped (root `/` is
        /// left intact).
        pub fn top_level_dir_without_trailing_slash(&self) -> &'static [u8] {
            let d = self.top_level_dir;
            if d.len() > 1 && d.last() == Some(&bun_paths::SEP) {
                &d[..d.len() - 1]
            } else {
                d
            }
        }

        /// Normalizes `str` in the shared scratch space, returning the input
        /// unchanged when already normalized.
        #[inline]
        pub fn normalize<'a>(&self, str: &'a [u8]) -> &'a [u8] {
            use bun_paths::resolve_path::{normalize_string, platform};
            normalize_string::<true, platform::Auto>(str)
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
        ) -> crate::CrateResult<&'static mut EntriesOption> {
            let r = self.fs.read_directory(dir, None, generation, store_fd)?;
            // SAFETY: `r` borrows the BSSMap singleton (process-lifetime); re-erase
            // to `'static` so `&mut self` is dropped before the caller binds the slot.
            Ok(unsafe { &mut *std::ptr::from_mut::<EntriesOption>(r) })
        }
    }

    // ── PathName / Path ──────────────────────────────────────────────────
    // CANONICAL: re-exported from `bun_paths::fs` (D090). The struct defs,
    // `init`/`is_file`/`source_dir`/etc, and `Default`/`Clone`/`Copy` derives
    // live there; only resolver-tier methods (those needing `FilenameStore`,
    // `bun_wyhash`, `bun_options_types`) remain here as an extension trait.
    pub use bun_paths::fs::{Path, PathName};

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
    /// reach (`FilenameStore`/`DirnameStore`, `bun_wyhash`, `bun_options_types`,
    /// `bun_string`). Import this trait to call `.loader()` / `.dupe_alloc()` /
    /// `.hash_key()` on a `Path`.
    pub trait PathResolverExt<'a> {
        /// Intern `text`/`pretty` into the process-lifetime `FilenameStore`,
        /// falling back to `alloc` (the per-build bundle arena) for the
        /// disjoint-`text`/`pretty` case — see the impl for why.
        fn dupe_alloc(&self, alloc: &bun_alloc::MimallocArena)
        -> crate::CrateResult<Path<'static>>;
        fn dupe_alloc_fix_pretty(
            &self,
            alloc: &bun_alloc::MimallocArena,
        ) -> crate::CrateResult<Path<'static>>;
        fn hash_key(&self) -> u64;
        fn hash_for_kit(&self) -> u64;
        fn package_name(&self) -> Option<&[u8]>;
        fn loader(&self, loaders: &bun_ast::LoaderHashTable) -> Option<bun_ast::Loader>;
    }

    impl<'a> PathResolverExt<'a> for Path<'a> {
        /// Interns `text`/`pretty` into the
        /// process-static `FilenameStore` so the returned `Path` borrows `'static`
        /// data.
        ///
        /// Short-circuit: if `text` (and, where relevant,
        /// `pretty`) already points into a process-lifetime store
        /// (`FilenameStore` or `DirnameStore`), the slices are already `'static`
        /// and we return the path unchanged instead of appending a duplicate.
        /// Skipping this check makes the append-only `FilenameStore` grow without
        /// bound across repeated in-process `Bun.build()` calls, eventually
        /// tripping the overflow-block cap (index-out-of-bounds panic).
        fn dupe_alloc(
            &self,
            alloc: &bun_alloc::MimallocArena,
        ) -> crate::CrateResult<Path<'static>> {
            let is_interned = |slice: &[u8]| {
                FilenameStore::instance().exists(slice) || DirnameStore::instance().exists(slice)
            };
            // Returning `self` unchanged widens `text`/`pretty`/`namespace` to
            // `'static`; the caller has already proven `text`/`pretty` are
            // interned, so assert `namespace` is too (static literal or store-
            // interned) — a transient namespace here would dangle.
            let return_self_static = || {
                debug_assert!(
                    matches!(self.namespace, b"" | b"file") || is_interned(self.namespace),
                    "dupe_alloc: returning interned path with transient namespace",
                );
                // SAFETY: `text`/`pretty` point into a process-lifetime store
                // (checked by the caller), and `namespace` is static/interned
                // (asserted above). All three outlive the program.
                Ok(unsafe { (*self).into_static() })
            };

            if core::ptr::eq(self.text.as_ptr(), self.pretty.as_ptr())
                && self.text.len() == self.pretty.len()
            {
                if is_interned(self.text) {
                    return return_self_static();
                }
                // `Path::init` sets `pretty == text`, matching the aliased input.
                let text = FilenameStore::instance().append_slice(self.text)?;
                let mut new_path = Path::<'static>::init(text);
                new_path.namespace = dupe_namespace(self.namespace)?;
                new_path.is_symlink = self.is_symlink;
                new_path.is_disabled = self.is_disabled;
                Ok(new_path)
            } else if self.pretty.is_empty() {
                if is_interned(self.text) {
                    return return_self_static();
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
                if is_interned(self.text) {
                    return return_self_static();
                }
                let text = FilenameStore::instance().append_slice(self.text)?;
                let mut new_path = Path::<'static>::init(text);
                new_path.pretty = &text[offset as usize..][..len as usize];
                new_path.namespace = dupe_namespace(self.namespace)?;
                new_path.is_symlink = self.is_symlink;
                new_path.is_disabled = self.is_disabled;
                Ok(new_path)
            } else {
                if is_interned(self.text) && is_interned(self.pretty) {
                    return return_self_static();
                }
                let mut new_path =
                    if let Some(offset) = bun_core::strings::index_of(self.text, self.pretty) {
                        // `text` contains `pretty`; intern `text` once and re-slice.
                        let text = FilenameStore::instance().append_slice(self.text)?;
                        let mut p = Path::<'static>::init(text);
                        p.pretty = &text[offset..][..self.pretty.len()];
                        p
                    } else {
                        // Disjoint `text`/`pretty`. Allocate one combined
                        // `text\0pretty\0` buffer from the per-build arena (NOT the
                        // process-lifetime `FilenameStore`): `pretty` here is a
                        // freshly-relativized display path recomputed every build, so
                        // interning it permanently would leak one copy per
                        // `Bun.build()` call. The arena is reset per build; every path
                        // that escapes to JS is copied into an owned buffer first.
                        let text_len = self.text.len();
                        let buf: &mut [u8] =
                            alloc.alloc_slice_fill_copy(text_len + self.pretty.len() + 2, 0u8);
                        buf[..text_len].copy_from_slice(self.text);
                        buf[text_len + 1..text_len + 1 + self.pretty.len()]
                            .copy_from_slice(self.pretty);
                        // SAFETY: arena memory lives for the whole bundle pass; the
                        // consuming `Path` (graph/import-record) never outlives it.
                        let buf: &'static [u8] =
                            unsafe { core::slice::from_raw_parts(buf.as_ptr(), buf.len()) };
                        let mut p = Path::<'static>::init(&buf[..text_len]);
                        p.pretty = &buf[text_len + 1..text_len + 1 + self.pretty.len()];
                        p
                    };
                new_path.namespace = dupe_namespace(self.namespace)?;
                new_path.is_symlink = self.is_symlink;
                new_path.is_disabled = self.is_disabled;
                Ok(new_path)
            }
        }

        fn dupe_alloc_fix_pretty(
            &self,
            alloc: &bun_alloc::MimallocArena,
        ) -> crate::CrateResult<Path<'static>> {
            #[cfg(not(windows))]
            {
                self.dupe_alloc(alloc)
            }
            #[cfg(windows)]
            {
                // If `pretty` contains no backslashes it is already POSIX-style.
                // Short-circuiting preserves the `pretty.ptr == text.ptr` aliasing
                // optimisation inside `dupe_alloc` and avoids a fresh FilenameStore alloc.
                if !self.pretty.iter().any(|&b| b == b'\\') {
                    return self.dupe_alloc(alloc);
                }
                let mut new = self.clone();
                new.pretty = b"";
                let mut new = new.dupe_alloc(alloc)?;
                // The posix-normalized
                // display path goes into the per-build arena, not the
                // process-lifetime `FilenameStore` (it is recomputed each build).
                let pretty: &mut [u8] = alloc.alloc_slice_copy(self.pretty);
                bun_paths::resolve_path::platform_to_posix_in_place::<u8>(pretty);
                // SAFETY: arena memory lives for the whole bundle pass; the
                // consuming `Path` never outlives it.
                new.pretty = unsafe { core::slice::from_raw_parts(pretty.as_ptr(), pretty.len()) };
                new.assert_pretty_is_valid();
                Ok(new)
            }
        }

        fn hash_key(&self) -> u64 {
            if self.is_file() {
                return bun_wyhash::hash(self.text);
            }

            // PERF: bun_wyhash
            // exposes only the stateless `WyhashStateless` (aligned-chunk update +
            // tail final) and one-shot `hash`. Concat to a temp and one-shot.
            let mut buf = Vec::with_capacity(self.namespace.len() + 8 + self.text.len());
            buf.extend_from_slice(self.namespace);
            buf.extend_from_slice(b"::::::::");
            buf.extend_from_slice(self.text);
            bun_wyhash::hash(&buf)
        }

        /// This hash is used by the hot-module-reloading client in order to
        /// identify modules. Since that code is JavaScript, the hash must remain in
        /// range [-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER] or else information is lost
        /// due to floating-point precision.
        fn hash_for_kit(&self) -> u64 {
            // u52 — truncate to 52 bits
            self.hash_key() & ((1u64 << 52) - 1)
        }

        fn package_name(&self) -> Option<&[u8]> {
            let mut name_to_use = self.pretty;
            // SEP_STR ++ "node_modules" ++ SEP_STR
            let needle =
                const_format::concatcp!(bun_paths::SEP_STR, "node_modules", bun_paths::SEP_STR)
                    .as_bytes();
            if let Some(node_modules) = bun_core::strings::last_index_of(self.text, needle) {
                name_to_use = &self.text[node_modules + 14..];
            }

            let pkgname = parse_package_name(name_to_use);
            if pkgname.is_empty() || !pkgname[0].is_ascii_alphanumeric() {
                return None;
            }

            Some(pkgname)
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

    /// Port of `options.JSX.Pragma.parsePackageName` (a pure byte-slice helper).
    /// D042: canonical body lives in `bun_options_types::jsx::Pragma`.
    #[inline]
    pub fn parse_package_name(str: &[u8]) -> &[u8] {
        bun_options_types::jsx::Pragma::parse_package_name(str)
    }

    // ── Entry / DirEntry / EntryKind ─────────────────────────────────────
    // Canonical definitions live in `fs.rs` (mounted as `crate::fs_full`).
    // Re-exported here so the public path `bun_resolver::fs::*` is preserved.
    pub use crate::fs_full::{
        DifferentCase, DirEntry, DirEntryErr, DirEntryIterator, Entry, EntryCache, EntryKind,
        EntryKindResolver, EntryLookup, FilenameStoreAppender, FsEntryKind, dir_entry,
    };

    use bun_core::Generation;
    use bun_paths::strings;
    use bun_ptr::Interned;
    use bun_sys::Fd;
    use bun_threading::Mutex;

    // `StringOrTinyString::init*_append_if_needed` needs an `Appender`; route the
    // ZST `FilenameStore` handle through to the backing `BSSStringList` singleton.
    impl strings::Appender for &FilenameStore {
        fn append(&mut self, s: &[u8]) -> core::result::Result<&[u8], bun_alloc::AllocError> {
            // Route through the inherent method (which already handles the
            // singleton deref + `'static` widening) instead of open-coding it.
            FilenameStore::append(self, s)
        }
        fn append_lower_case(
            &mut self,
            s: &[u8],
        ) -> core::result::Result<&[u8], bun_alloc::AllocError> {
            FilenameStore::append_lower_case(self, s)
        }
    }

    // Port of `threadlocal var temp_entries_option: EntriesOption = undefined` —
    // `read_directory*` returns a pointer into this when the entry-cache is
    // disabled or the path is `mark_not_found`. `RefCell` (not `UnsafeCell`) so
    // the per-thread unique-borrow is debug-checked; matches the sibling
    // `TEMP_ENTRIES_OPTION` in `fs.rs`.
    thread_local! {
        static TEMP_ENTRIES_OPTION: core::cell::RefCell<core::mem::MaybeUninit<EntriesOption>> =
            const { core::cell::RefCell::new(core::mem::MaybeUninit::uninit()) };
    }

    fn temp_entries_option_write(value: EntriesOption) -> &'static mut EntriesOption {
        TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
            slot.write(value);
            // SAFETY: just wrote; threadlocal storage outlives the caller.
            // Re-erase to 'static for the BSSMap-shaped
            // unbounded `&mut EntriesOption` return type — the `RefMut` guard
            // drops immediately on return, so no live `RefCell` borrow aliases
            // the escaped reference.
            unsafe { &mut *slot.as_mut_ptr() }
        })
    }

    // ── RealFS.Tmpfile ───────────────────────────────────────────────────
    /// Temporary-file helper. The POSIX impl opens at cwd; the Windows impl
    /// only needs the temp-dir path, which routes via `tmpdir_path`.
    pub struct RealFsTmpfile {
        pub fd: bun_sys::Fd,
        pub dir_fd: bun_sys::Fd,
        #[cfg(windows)]
        pub existing_path: Box<[u8]>,
    }
    impl Default for RealFsTmpfile {
        fn default() -> Self {
            Self {
                fd: bun_sys::Fd::INVALID,
                dir_fd: bun_sys::Fd::INVALID,
                #[cfg(windows)]
                existing_path: Box::default(),
            }
        }
    }
    impl RealFsTmpfile {
        #[inline]
        pub fn file(&self) -> &bun_sys::File {
            bun_sys::File::borrow(&self.fd)
        }

        pub fn close(&mut self) {
            if self.fd.is_valid() {
                let _ = bun_sys::close(self.fd);
                self.fd = bun_sys::Fd::INVALID;
            }
        }

        /// POSIX path opens at cwd; Windows opens under the
        /// process temp dir.
        pub fn create(&mut self, name: &ZStr) -> crate::CrateResult<()> {
            #[cfg(not(windows))]
            {
                // We originally used a temporary directory, but it caused EXDEV.
                let dir_fd = bun_sys::Fd::cwd();
                self.dir_fd = dir_fd;
                let flags = bun_sys::O::CREAT | bun_sys::O::RDWR | bun_sys::O::CLOEXEC;
                // S_IRWXU == 0o700
                self.fd = bun_sys::openat(dir_fd, name, flags, 0o700)?;
                Ok(())
            }
            #[cfg(windows)]
            {
                // Open the temp dir iterable + read-only, with delete/rename
                // sharing denied. The temp dir path honours BUN_TMPDIR only
                // when it is non-empty (an empty env var falls through to the
                // platform temp dir).
                let tmp = RealFS::tmpdir_path();
                let tmp_dir = bun_sys::open_dir_at_windows_a(
                    bun_sys::Fd::INVALID,
                    tmp,
                    bun_sys::WindowsOpenDirOptions {
                        iterable: true,
                        can_rename_or_delete: false,
                        read_only: true,
                        ..Default::default()
                    },
                )?;
                // Spec's `TmpfileWindows` has no `dir_fd` field — the handle is
                // local. Close it once we've captured the absolute path so we
                // don't leak a directory HANDLE per tmpfile.
                scopeguard::defer! { let _ = bun_sys::close(tmp_dir); }
                let flags = bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::CLOEXEC;
                self.fd = bun_sys::openat(tmp_dir, name, flags, 0)?;
                let mut buf = bun_paths::PathBuffer::uninit();
                let existing_path = bun_sys::get_fd_path(self.fd, &mut buf)?;
                self.existing_path = Box::<[u8]>::from(&*existing_path);
                Ok(())
            }
        }

        /// Renames the temp file from `from_name` to `name` relative to the
        /// current working directory.
        pub fn promote_to_cwd(&mut self, from_name: &ZStr, name: &ZStr) -> crate::CrateResult<()> {
            #[cfg(not(windows))]
            {
                debug_assert!(self.fd != bun_sys::Fd::INVALID);
                debug_assert!(self.dir_fd != bun_sys::Fd::INVALID);
                bun_sys::move_file_z_with_handle(
                    self.fd,
                    self.dir_fd,
                    from_name,
                    bun_sys::Fd::cwd(),
                    name,
                )?;
                self.close();
                Ok(())
            }
            #[cfg(windows)]
            {
                use bun_sys::windows as w;
                use w::Win32ErrorUnwrap as _;
                let _ = from_name;
                let mut existing_buf = bun_paths::WPathBuffer::uninit();
                let mut new_buf = bun_paths::WPathBuffer::uninit();
                self.close();
                let existing = bun_paths::strings::paths::to_extended_path_normalized(
                    &mut new_buf.0[..],
                    &self.existing_path,
                );
                let new = if bun_paths::is_absolute_windows(name.as_bytes()) {
                    bun_paths::strings::paths::to_extended_path_normalized(
                        &mut existing_buf.0[..],
                        name.as_bytes(),
                    )
                } else {
                    bun_paths::strings::paths::to_w_path_normalized(
                        &mut existing_buf.0[..],
                        name.as_bytes(),
                    )
                };
                // SAFETY: `existing`/`new` are NUL-terminated WTF-16 backed by
                // stack `WPathBuffer`s alive for this frame.
                if unsafe {
                    w::kernel32::MoveFileExW(
                        existing.as_ptr(),
                        new.as_ptr(),
                        w::MOVEFILE_COPY_ALLOWED
                            | w::MOVEFILE_REPLACE_EXISTING
                            | w::MOVEFILE_WRITE_THROUGH,
                    )
                } == w::FALSE
                {
                    w::Win32Error::get().unwrap()?;
                }
                Ok(())
            }
        }
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
    }

    pub type ReadDirResult = EntriesOption;

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
    pub(crate) type EntriesOptionMap = bun_alloc::BSSMapInner<EntriesOption, 2048, true>;

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
        pub fn get_or_put(&mut self, key: &[u8]) -> crate::CrateResult<bun_alloc::Result> {
            self.inner()
                .get_or_put(key)
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))
        }
        pub fn at_index(&mut self, index: bun_alloc::IndexType) -> Option<&mut EntriesOption> {
            self.inner().at_index(index)
        }
        pub fn put(
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
        pub fn mark_not_found(&mut self, result: bun_alloc::Result) {
            self.inner().mark_not_found(result)
        }
        pub fn remove(&mut self, key: &[u8]) -> bool {
            self.inner().remove(key)
        }
    }

    /// The active filesystem backend (always the real filesystem).
    pub type Implementation = RealFS;

    // ── RealFS ───────────────────────────────────────────────────────────

    /// Real-filesystem backend: directory-entry cache plus fd-limit
    /// bookkeeping.
    pub struct RealFS {
        pub entries_mutex: Mutex,
        /// Port of `entries: *EntriesOption.Map`. The resolver body addresses
        /// this directly (`rfs.entries.get_or_put(..)`); modeled as the wrapper
        /// `EntriesMap` (bun_alloc has no BSSMap equivalent).
        pub entries: EntriesMap,
        pub cwd: &'static [u8],
        pub file_limit: usize,
        pub file_quota: usize,
    }

    impl RealFS {
        /// Raise RLIMIT_NOFILE and
        /// record the resulting fd budget so `need_to_close_files` can decide
        /// whether to cache directory fds.
        pub fn init(cwd: &'static [u8]) -> RealFS {
            let file_limit = Self::adjust_ulimit().expect("unreachable");
            RealFS {
                entries_mutex: Mutex::default(),
                entries: EntriesMap::new(),
                cwd,
                file_limit,
                file_quota: file_limit,
            }
        }

        /// Port of `RealFS.adjustUlimit` — always try to max out how many
        /// files we can keep open.
        pub fn adjust_ulimit() -> crate::CrateResult<usize> {
            #[cfg(not(unix))]
            {
                Ok(usize::MAX)
            }
            #[cfg(unix)]
            {
                let resource = bun_sys::posix::RlimitResource::NOFILE;
                let mut lim = bun_sys::posix::getrlimit(resource)?;

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
                Ok(usize::try_from(lim.cur).expect("int cast"))
            }
        }

        /// `open(path, O_DIRECTORY)`.
        pub fn open_dir(&self, unsafe_dir_string: &[u8]) -> crate::CrateResult<Fd> {
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
                        read_only: true,
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
            &mut self,
            store_fd: bool,
            mut prev_map: Option<&mut dir_entry::EntryMap>,
            dir_: &'static [u8],
            generation: Generation,
            handle: Fd,
            iterator: I,
        ) -> crate::CrateResult<DirEntry> {
            let mut iter = bun_sys::iterate_dir(handle);
            let mut dir = DirEntry::init(dir_, generation);

            if store_fd {
                FileSystem::set_max_fd(bun_sys::Fd::native(handle));
                dir.fd = handle;
            }

            let mut filename_store = FilenameStoreAppender::new();
            while let Some(entry_) = iter.next()? {
                // debug("readdir entry {}", BStr::new(entry_.name.slice()));
                dir.add_entry_with_store(
                    prev_map.as_deref_mut(),
                    &entry_,
                    &mut filename_store,
                    &iterator,
                )?;
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
        ) -> crate::CrateResult<&'static mut EntriesOption> {
            if bun_core::FeatureFlags::ENABLE_ENTRY_CACHE {
                let mut get_or_put_result = self.entries.get_or_put(dir)?;
                if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                    self.entries.mark_not_found(get_or_put_result);
                    return Ok(temp_entries_option_write(EntriesOption::Err(
                        dir_entry::Err {
                            original_err: err,
                            canonical_error: err,
                        },
                    )));
                } else {
                    let opt = self.entries.put(
                        &mut get_or_put_result,
                        EntriesOption::Err(dir_entry::Err {
                            original_err: err,
                            canonical_error: err,
                        }),
                    )?;
                    // SAFETY: BSSMap-owned slot; outlives caller (process-static singleton).
                    return Ok(unsafe { &mut *opt });
                }
            }

            Ok(temp_entries_option_write(EntriesOption::Err(
                dir_entry::Err {
                    original_err: err,
                    canonical_error: err,
                },
            )))
        }

        pub fn read_directory(
            &mut self,
            dir_: &[u8],
            handle_: Option<Fd>,
            generation: Generation,
            store_fd: bool,
        ) -> crate::CrateResult<&mut EntriesOption> {
            self.read_directory_with_iterator(dir_, handle_, generation, store_fd, ())
        }

        // One of the learnings here
        //
        //   Closing file descriptors yields significant performance benefits on Linux
        //
        // It was literally a 300% performance improvement to bundling.
        // https://twitter.com/jarredsumner/status/1655787337027309568
        // https://twitter.com/jarredsumner/status/1655714084569120770
        // https://twitter.com/jarredsumner/status/1655464485245845506
        /// Caller borrows the returned `EntriesOption`. When `FeatureFlags::ENABLE_ENTRY_CACHE`
        /// is `false`, it is not safe to store this pointer past the current function call.
        pub fn read_directory_with_iterator<I: DirEntryIterator>(
            &mut self,
            dir_maybe_trail_slash: &[u8],
            maybe_handle: Option<Fd>,
            generation: Generation,
            store_fd: bool,
            iterator: I,
        ) -> crate::CrateResult<&'static mut EntriesOption> {
            let dir = strings::paths::without_trailing_slash_windows_path(dir_maybe_trail_slash);

            crate::Resolver::assert_valid_cache_key(dir);
            let mut cache_result: Option<bun_alloc::Result> = None;
            let _unlock_guard = if bun_core::FeatureFlags::ENABLE_ENTRY_CACHE {
                Some(self.entries_mutex.lock_guard())
            } else {
                None
            };

            let mut in_place: Option<*mut DirEntry> = None;

            if bun_core::FeatureFlags::ENABLE_ENTRY_CACHE {
                cache_result = Some(self.entries.get_or_put(dir)?);

                let cr = cache_result.as_ref().unwrap();
                if cr.has_checked_if_exists() {
                    if let Some(cached_result) = self.entries.at_index(cr.index) {
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
                    } else if cr.status == bun_alloc::ItemStatus::NotFound && generation == 0 {
                        return Ok(temp_entries_option_write(EntriesOption::Err(
                            dir_entry::Err {
                                original_err: crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                                canonical_error: crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                            },
                        )));
                    }
                }
            }

            let had_handle = maybe_handle.is_some();
            let handle: Fd = match maybe_handle {
                Some(h) => h,
                None => match self.open_dir(dir) {
                    Ok(h) => h,
                    Err(err) => return self.read_directory_error(dir, err),
                },
            };

            // Close the handle on every exit path. Use
            // scopeguard so close happens even if `readdir`/`put` early-return with `?`.
            let should_close_handle = !had_handle && (!store_fd || self.need_to_close_files());
            let _close_guard = scopeguard::guard(handle, move |h| {
                if should_close_handle {
                    let _ = bun_sys::close(h);
                }
            });

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
            let mut entries = match self.readdir(store_fd, prev, dir, generation, handle, iterator)
            {
                Ok(e) => e,
                Err(err) => {
                    if let Some(existing) = in_place {
                        // SAFETY: see above.
                        unsafe { (*existing).data.clear() };
                    }
                    return self.read_directory_error(dir, err);
                }
            };

            if bun_core::FeatureFlags::ENABLE_ENTRY_CACHE {
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
                if store_fd && !entries.fd.is_valid() {
                    entries.fd = handle;
                }

                // SAFETY: `entries_ptr` is either a live BSSMap slot (`in_place`) or a fresh
                // leaked Box; exclusively owned here under `entries_mutex`.
                unsafe { *entries_ptr = entries };
                let result = EntriesOption::Entries(
                    // SAFETY: see above — re-borrow as 'static for the BSSMap slot.
                    unsafe { &mut *entries_ptr },
                );

                let out = self.entries.put(cache_result.as_mut().unwrap(), result)?;
                // SAFETY: BSSMap-owned slot; outlives caller (process-static singleton).
                return Ok(unsafe { &mut *out });
            }

            // ENABLE_ENTRY_CACHE = false: stash in the threadlocal and hand back its
            // address. The leaked Box lives until the next `read_directory` call on
            // this thread.
            let entries_ptr = bun_core::heap::into_raw(Box::new(entries));
            // SAFETY: freshly-leaked Box; re-borrow as 'static for the threadlocal slot.
            Ok(temp_entries_option_write(EntriesOption::Entries(unsafe {
                &mut *entries_ptr
            })))
        }

        /// Evicts `file_path` from the directory-entry cache; returns whether
        /// an entry was removed.
        pub fn bust_entries_cache(&mut self, file_path: &[u8]) -> bool {
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
        pub fn kind(
            &mut self,
            dir_: &[u8],
            base: &[u8],
            existing_fd: Fd,
            store_fd: bool,
        ) -> crate::CrateResult<EntryCache> {
            use bun_paths::resolve_path::{join_abs_string_buf, platform};
            #[cfg(not(windows))]
            use bun_sys::{FileKind, kind_from_mode};

            let mut cache = EntryCache {
                kind: EntryKind::File,
                symlink: Interned::EMPTY,
                fd: Fd::INVALID,
            };

            let combo: [&[u8]; 2] = [dir_, base];
            let mut outpath = bun_paths::PathBuffer::uninit();
            let entry_path_len =
                join_abs_string_buf::<platform::Auto>(self.cwd, &mut outpath[..], &combo).len();

            outpath[entry_path_len + 1] = 0;
            outpath[entry_path_len] = 0;
            let absolute_path_c = ZStr::from_buf(&outpath[..], entry_path_len);

            #[cfg(windows)]
            {
                use bun_sys::windows as w;
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
                // SAFETY: `wpath` is NUL-terminated UTF-16; null security/template handles.
                let handle = unsafe {
                    w::CreateFileW(
                        wpath.as_ptr(),
                        0,
                        w::FILE_SHARE_READ | w::FILE_SHARE_WRITE | w::FILE_SHARE_DELETE,
                        core::ptr::null_mut(),
                        w::OPEN_EXISTING,
                        // FILE_FLAG_BACKUP_SEMANTICS lets us open directories;
                        // omitting FILE_FLAG_OPEN_REPARSE_POINT makes Windows
                        // follow the full reparse chain to the final target.
                        w::FILE_FLAG_BACKUP_SEMANTICS,
                        core::ptr::null_mut(),
                    )
                };
                // Dangling link / loop / EACCES: `cache.kind` is already set
                // from the link's own directory bit, which is correct for all
                // of those. `Entry.kind`/`Entry.symlink` swallow errors and
                // fall back to the `.file` placeholder anyway, so returning
                // the half-populated cache is strictly better than `try`.
                // Empty `cache.symlink` makes the resolver fall back to
                // `parent.abs_real_path + base`.
                if handle == w::INVALID_HANDLE_VALUE {
                    return Ok(cache);
                }
                scopeguard::defer! {
                    // SAFETY: `handle` is a valid HANDLE from CreateFileW above.
                    unsafe { let _ = w::CloseHandle(handle); }
                }

                let mut info: w::BY_HANDLE_FILE_INFORMATION = bun_core::ffi::zeroed();
                // SAFETY: `handle` is valid; `info` is a valid out-param.
                if unsafe { w::GetFileInformationByHandle(handle, &mut info) } != 0 {
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
                    let file: Fd = if let Some(valid) = existing_fd.unwrap_valid() {
                        valid
                    } else if store_fd {
                        bun_sys::open_file_absolute_z(
                            absolute_path_c,
                            bun_sys::OpenFlags::READ_ONLY,
                        )?
                        .into_raw()
                    } else {
                        // O_PATH is
                        // Linux-only; macOS/BSD use O_RDONLY. Both add O_NOCTTY|O_CLOEXEC.
                        #[cfg(any(target_os = "linux", target_os = "android"))]
                        let flags = bun_sys::O::PATH | bun_sys::O::CLOEXEC | bun_sys::O::NOCTTY;
                        #[cfg(not(any(target_os = "linux", target_os = "android")))]
                        let flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NOCTTY;
                        bun_sys::open(absolute_path_c, flags, 0)?
                    };
                    FileSystem::set_max_fd(file.native());

                    // The close-or-store cleanup runs on
                    // BOTH success and error paths — use scopeguard so close-or-store happens even if
                    // fstat()/get_fd_path() return early with `?`.
                    let need_to_close_files = self.need_to_close_files();
                    let cache_ptr: *mut EntryCache = &raw mut cache;
                    let _guard = scopeguard::guard(file, move |file| {
                        if (!store_fd || need_to_close_files) && !existing_fd.is_valid() {
                            let _ = bun_sys::close(file);
                        } else if bun_core::feature_flags::STORE_FILE_DESCRIPTORS {
                            // SAFETY: `cache_ptr` points into a stack local that outlives this guard.
                            unsafe { (*cache_ptr).fd = file };
                        }
                    });

                    let file_stat = bun_sys::fstat(*_guard)?;
                    symlink = bun_sys::get_fd_path(*_guard, &mut outpath)?;
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

    impl crate::fs_full::EntryKindResolver for RealFS {
        #[inline(always)]
        fn resolve_kind(
            &mut self,
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
        /// re-read (open + readdir + cache replace) when the cached listing is stale.
        ///
        /// Takes `entries_mutex` for the whole lookup: the generation-stale branch
        /// drops the existing `DirEntry` (and the bucket allocation behind its
        /// `data` map) in place, and the route loaders iterate that map under the
        /// same lock. Call [`entries_at_locked`](Self::entries_at_locked) instead
        /// from inside a critical section that already holds `entries_mutex`.
        pub fn entries_at(
            &mut self,
            index: bun_alloc::IndexType,
            generation: Generation,
        ) -> Option<&mut EntriesOption> {
            // `MutexGuard` stores the mutex by raw pointer (see `EntriesGuard`),
            // so holding it does not keep `&mut self` borrowed.
            let _g = self.entries_mutex.lock_guard();
            self.entries_at_locked(index, generation)
        }

        /// [`entries_at`](Self::entries_at) for call sites that already hold
        /// `entries_mutex` (the mutex is non-recursive).
        pub fn entries_at_locked(
            &mut self,
            index: bun_alloc::IndexType,
            generation: Generation,
        ) -> Option<&mut EntriesOption> {
            debug_assert!(
                self.entries_mutex.is_held_by_current_thread(),
                "entries_at_locked: caller must hold entries_mutex",
            );
            // erase to raw immediately so re-borrowing `&mut self` for
            // `open_dir`/`readdir`/`read_directory_error` doesn't conflict.
            // `entries_mutex` held (by `entries_at` or the caller); sole `&mut` to this slot.
            let result_ptr = std::ptr::from_mut::<EntriesOption>(self.entries.at_index(index)?);
            // SAFETY: BSSMap-owned slot; uniquely held under `entries_mutex`.
            if let EntriesOption::Entries(existing) = unsafe { &mut *result_ptr } {
                if existing.generation < generation {
                    let e_ptr: *mut DirEntry = std::ptr::from_mut::<DirEntry>(*existing);
                    // SAFETY: BSSMap-owned `DirEntry` (boxed/leaked into `EntriesOption`); `entries_mutex` held.
                    let dir = unsafe { (*e_ptr).dir };
                    // `open_dir_for_iteration`, NOT
                    // `RealFS.openDir`. On Windows the two diverge: `open_dir` passes
                    // `read_only: true` (no DELETE access on the handle), whereas
                    // `openDirForIteration` uses the default `WindowsOpenDirOptions`
                    // (`can_rename_or_delete: true`). On POSIX it's `O_DIRECTORY` only
                    // vs `O_RDONLY|O_DIRECTORY`.
                    let handle = match bun_sys::open_dir_for_iteration(Fd::cwd(), dir) {
                        Ok(h) => h,
                        Err(err) => {
                            // SAFETY: see above.
                            unsafe { (*e_ptr).data.clear() };
                            return self.read_directory_error(dir, err.into()).ok();
                        }
                    };
                    let _close_guard = scopeguard::guard(handle, |h| {
                        let _ = bun_sys::close(h);
                    });
                    // SAFETY: see above — exclusive `&mut` on the prev map for the duration of `readdir`.
                    let prev = Some(unsafe { &mut (*e_ptr).data });
                    match self.readdir(false, prev, dir, generation, handle, ()) {
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
            Some(unsafe { &mut *result_ptr })
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
                            let mut buf = bun_paths::PathBuffer::uninit();
                            let parts: [&[u8]; 1] = [b"AppData\\Local\\Temp"];
                            let out = bun_paths::resolve_path::join_abs_string_buf::<
                                bun_paths::resolve_path::platform::Loose,
                            >(profile, &mut buf[..], &parts);
                            return out.to_vec();
                        }
                        let mut tmp_buf = bun_paths::PathBuffer::uninit();
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
        BOM, PathContentsPair, read_file_contents, read_file_contents_in_arena,
        read_file_with_handle_impl,
    };

    /// Re-export `StatHash` from the full `fs.rs` port so `bun_runtime::server::FileRoute`
    /// can hash mtimes/sizes without inlining the formatter.
    pub use super::fs_full::stat_hash;
    pub use super::fs_full::stat_hash::StatHash;

    /// Re-export `ModKey` from the full `fs.rs` port so `linker::get_mod_key`
    /// can hash files without depending on `fs_full::RealFS` (a distinct type
    /// from this inline `RealFS`).
    pub use super::fs_full::ModKey;
    impl ModKey {
        /// RealFS-agnostic constructor. `fs_full::ModKey::generate`'s
        /// `&mut RealFS` / `path` args are unread (fs.rs:1386); callers
        /// reaching `ModKey` via this re-export hold the inline-`fs` `RealFS`,
        /// which is a different type, so they need an entry point that doesn't
        /// require `fs_full::RealFS`. Body is the spec `generate` minus the
        /// dead args.
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
                inode: stat.st_ino,
                size: stat.st_size as u64,
                mtime,
                mode: stat.st_mode as bun_sys::Mode,
            })
        }
    }

    pub mod file_system {
        pub use super::{DirEntry, DirnameStore, Entry, EntryKind, FilenameStore, RealFS};
        pub mod entry {
            pub mod lookup {
                pub use crate::fs::DifferentCase;
            }
        }
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
    use crate::fs::{DirEntry, EntriesOption, Entry, EntryKind, FileSystem as FS, Implementation};
    use bun_core::ZStr;
    use bun_glob::walk::{Accessor, AccessorDirEntry, AccessorDirIter, AccessorHandle};
    use bun_paths::{PathBuffer, Platform, resolve_path};
    use bun_sys::{self as Syscall, Error as SysError, Result as Maybe, Stat};

    pub struct DirEntryAccessor;

    #[derive(Clone, Copy)]
    pub struct DirEntryHandle {
        pub value: Option<&'static DirEntry>,
    }

    impl AccessorHandle for DirEntryHandle {
        const EMPTY: Self = DirEntryHandle { value: None };

        fn is_empty(self) -> bool {
            self.value.is_none()
        }

        fn eql(self, other: Self) -> bool {
            // TODO this might not be quite right, we're comparing pointers, not the underlying directory
            // On the other hand, DirEntries are only ever created once (per generation), so this should be fine?
            // Realistically, as closing the handle is a no-op, this should be fine either way.
            match (self.value, other.value) {
                (Some(a), Some(b)) => core::ptr::eq(a, b),
                (None, None) => true,
                _ => false,
            }
        }
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

    pub struct DirEntryIterResult {
        pub name: DirEntryNameWrapper,
        pub kind: bun_sys::FileKind,
        /// Resolver-cached real path of a symlink entry's target
        /// (`Interned::EMPTY` for non-symlinks).
        pub symlink_target: bun_ptr::Interned,
    }

    pub(crate) struct DirEntryNameWrapper {
        // BACKREF: borrowed slice into a `Box<[u8]>` key owned by
        // `DirEntry.data: HashMap`. Valid only while the parent `DirEntry`
        // is live and not regenerated by `read_directory`. Stored as
        // [`bun_ptr::RawSlice`] (not `&'static [u8]`) per PORTING.md
        // §Forbidden — the key is individually heap-allocated by the HashMap,
        // not a BSS-arena slice, so minting a `'static` borrow via
        // `from_raw_parts` would be a lifetime lie. `RawSlice` encapsulates
        // the outlives-holder invariant so `slice()` is safe.
        pub value: bun_ptr::RawSlice<u8>,
    }

    impl DirEntryNameWrapper {
        #[inline]
        pub(crate) fn slice(&self) -> &[u8] {
            // BACKREF — see field comment. The GlobWalker consumes
            // `name_slice()` before advancing the iterator or reopening the
            // directory, so the pointee `Box<[u8]>` is still alive here.
            self.value.slice()
        }
    }

    impl AccessorDirEntry for DirEntryIterResult {
        fn name_slice(&self) -> &[u8] {
            self.name.slice()
        }
        fn kind(&self) -> bun_sys::FileKind {
            self.kind
        }
        fn symlink_target(&self) -> Option<&[u8]> {
            let target = self.symlink_target.as_bytes();
            (!target.is_empty()).then_some(target)
        }
    }

    impl AccessorDirIter for DirEntryDirIter {
        type Handle = DirEntryHandle;
        type Entry = DirEntryIterResult;

        #[inline]
        fn next(&mut self) -> Maybe<Option<DirEntryIterResult>> {
            if let Some(value) = &mut self.value {
                let Some((key, val)) = value.next() else {
                    return Ok(None);
                };
                // BACKREF: ARENA — `*mut Entry` points into the EntryStore
                // BSSList singleton ('static lifetime); `RealFS.entries_mutex`
                // serializes access. `BackRef::from(NonNull)` + `Deref` keeps
                // the read site safe.
                let entry = bun_ptr::BackRef::<Entry>::from(
                    core::ptr::NonNull::new(*val).expect("EntryStore slot"),
                );
                let fs: *mut Implementation = &raw mut FS::instance().fs;
                // SAFETY: entries_mutex held; fs points at the process-global RealFS.
                let kind = unsafe { entry.kind(fs, true) };
                let fskind = match kind {
                    EntryKind::File => bun_sys::FileKind::File,
                    EntryKind::Dir => bun_sys::FileKind::Directory,
                };
                // `Entry::kind` resolved through symlinks above; a non-empty
                // cached realpath is what records the entry as a symlink.
                let symlink_target = entry.cache().symlink;
                // BACKREF: wrap the HashMap key's bytes in a `RawSlice`
                // instead of fabricating `&'static [u8]` (PORTING.md §Forbidden).
                // The key is a `Box<[u8]>` owned by `DirEntry.data` and valid
                // until the next `read_directory` regeneration; `name_slice()`
                // re-narrows the lifetime so it never escapes the iter result.
                Ok(Some(DirEntryIterResult {
                    name: DirEntryNameWrapper {
                        value: bun_ptr::RawSlice::new(&**key),
                    },
                    kind: fskind,
                    symlink_target,
                }))
            } else {
                Ok(None)
            }
        }

        #[inline]
        fn iterate(dir: DirEntryHandle) -> Self {
            let Some(entry) = dir.value else {
                return DirEntryDirIter { value: None };
            };
            DirEntryDirIter {
                value: Some(entry.data.iter()),
            }
        }
    }

    impl Accessor for DirEntryAccessor {
        const COUNT_FDS: bool = false;
        type Handle = DirEntryHandle;
        type DirIter = DirEntryDirIter;

        fn statat(handle: DirEntryHandle, path_: &ZStr) -> Maybe<Stat> {
            let mut buf = PathBuffer::uninit();
            let path: &ZStr = if !Platform::AUTO.is_absolute(path_.as_bytes()) {
                if let Some(entry) = handle.value {
                    let slice = resolve_path::join_string_buf::<bun_paths::platform::Auto>(
                        &mut buf,
                        &[entry.dir, path_.as_bytes()],
                    );
                    let len = slice.len();
                    buf[len] = 0;
                    // SAFETY: buf[len] == 0 written above
                    ZStr::from_buf(&buf[..], len)
                } else {
                    path_
                }
            } else {
                path_
            };
            Syscall::stat(path)
        }

        /// Like statat but does not follow symlinks.
        fn lstatat(handle: DirEntryHandle, path_: &ZStr) -> Maybe<Stat> {
            let mut buf = PathBuffer::uninit();
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
                    buf[len] = 0;
                    // SAFETY: buf[len] == 0 written above
                    ZStr::from_buf(&buf[..], len)
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
            let mut buf = PathBuffer::uninit();
            let mut path: &[u8] = path_.as_bytes();

            if !Platform::AUTO.is_absolute(path) {
                if let Some(entry) = handle.value {
                    path = resolve_path::join_string_buf::<bun_paths::platform::Auto>(
                        &mut buf,
                        &[entry.dir, path],
                    );
                }
            }
            // TODO do we want to propagate ENOTDIR through the 'Maybe' to match the SyscallAccessor?
            // The glob implementation specifically checks for this error when dealing with symlinks
            // return Err(SysError::from_code(E::NOTDIR, Syscall::Tag::open));
            let res = FS::instance()
                .fs
                .read_directory(path, None, 0, false)
                .map_err(crate::Error::into_core)?;
            match res {
                EntriesOption::Entries(entry) => {
                    let p: *const DirEntry = &raw const **entry;
                    // SAFETY: ARENA — `entry` (unbounded `&mut DirEntry`) borrows the BSSMap
                    // singleton; reborrow as shared 'static for the Copy handle.
                    let value = unsafe { &*p };
                    Ok(Ok(DirEntryHandle { value: Some(value) }))
                }
                EntriesOption::Err(err) => Err(err.original_err.into_core()),
            }
        }

        #[inline]
        fn close(_handle: DirEntryHandle) -> Option<SysError> {
            // TODO is this a noop?
            None
        }

        fn getcwd(path_buf: &mut PathBuffer) -> Maybe<&[u8]> {
            let cwd = FS::instance().fs.cwd;
            path_buf[..cwd.len()].copy_from_slice(cwd);
            // Returning the copied slice is what every Accessor caller expects
            // (it matches the syscall-backed Accessor's contract).
            Ok(&path_buf[..cwd.len()])
        }
    }
}
pub use dir_entry_accessor::DirEntryAccessor;

// ──────────────────────────────────────────────────────────────────────────
// `cache` — `Set`/`Fs`/`Entry`/`JavaScript`/
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

    use crate::fs as fs_mod;
    pub use crate::tsconfig_json::JsonCache as Json;

    bun_core::declare_scope!(CacheFs, visible);

    /// Bundle of the per-transpiler caches: JavaScript parse cache, file
    /// cache, and JSON cache.
    pub struct Set {
        pub js: JavaScript,
        pub fs: Fs,
        pub json: Json,
    }

    impl Set {
        pub fn init() -> Set {
            Set {
                js: JavaScript::init(),
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
        pub shared_buffer: MutableString,
        pub macro_shared_buffer: MutableString,

        pub use_alternate_source_cache: bool,
        pub stream: bool,
    }

    impl Default for Fs {
        fn default() -> Self {
            Self {
                shared_buffer: MutableString::init(0).expect("unreachable"),
                macro_shared_buffer: MutableString::init(0).expect("unreachable"),
                use_alternate_source_cache: false,
                stream: false,
            }
        }
    }

    /// Optional external destructor (`function(ctx)`) for foreign-owned
    /// source bytes; `NONE` when there is nothing external to free.
    #[repr(C)]
    pub struct ExternalFreeFunction {
        pub ctx: *mut c_void,
        pub function: Option<unsafe extern "C" fn(*mut c_void)>,
    }

    impl ExternalFreeFunction {
        pub const NONE: ExternalFreeFunction = ExternalFreeFunction {
            ctx: core::ptr::null_mut(),
            function: None,
        };

        pub fn call(&self) {
            if let Some(func) = self.function {
                // SAFETY: ctx was provided by the same native plugin that provided `function`.
                unsafe { func(self.ctx) };
            }
        }
    }

    impl Default for ExternalFreeFunction {
        fn default() -> Self {
            Self::NONE
        }
    }

    /// Provenance-tagged backing for [`Entry`] source bytes.
    ///
    /// Replaces the prior `&'static [u8]` + `Box::leak`/`heap::take` pair
    /// (forbidden per docs/PORTING.md §Forbidden patterns). The enum makes
    /// provenance explicit so `deinit` matches on the variant instead of
    /// guessing — the old scheme would `heap::take` a `MutableString`-owned
    /// pointer on the `use_shared_buffer=true` path (UB).
    #[derive(Default)]
    pub enum Contents {
        /// Empty / static literal. No-op on `deinit`.
        #[default]
        Empty,
        /// Heap-owned buffer (default-allocator path). Freed when this variant
        /// drops. Stored as `Vec<u8>` (not `Box<[u8]>`) so a sentinel NUL can
        /// sit in spare capacity past `len`.
        Owned(Vec<u8>),
        /// Bytes live in a caller-supplied `bun_alloc::Arena` (the per-call
        /// `MimallocArena` from `ParseOptions.arena`). NOT freed on `deinit` —
        /// bulk-reclaimed by `mi_heap_destroy` when the arena drops. This is
        /// the arena arm of
        /// `read_file_with_allocator`: the
        /// concurrent-transpiler path passes a per-job arena so the
        /// 1.6 MB vite chunk source landed in the per-job arena, not the
        /// worker thread's default mimalloc heap (which is never destroyed).
        Arena {
            ptr: core::ptr::NonNull<u8>,
            len: usize,
        },
        /// Borrows the per-thread `shared_buffer` (or other caller-kept-alive
        /// storage). Caller guarantees the pointee outlives all reads through
        /// this `Entry`. NOT freed on `deinit`.
        SharedBuffer { ptr: *const u8, len: usize },
        /// Externally-owned bytes the producer keeps alive past this `Entry`
        /// (native-plugin buffers are freed by the bundler's
        /// `BundleV2.finalizers`); NOT freed on `deinit`.
        External { ptr: *const u8, len: usize },
    }

    impl Contents {
        #[inline]
        pub fn as_slice(&self) -> &[u8] {
            match self {
                Contents::Empty => b"",
                Contents::Owned(v) => v.as_slice(),
                // SAFETY: FFI/ARENA — single encapsulation point for foreign-
                // owned bytes. `SharedBuffer` points into the caller-owned
                // per-thread `MutableString` (reset only after this `Entry` is
                // dropped); `External` is producer-owned memory the producer
                // keeps alive past the `Entry` (native-plugin buffers are
                // freed later by the bundler's `BundleV2.finalizers`, via
                // `ParseTask.external_free_function`). In both cases
                // `ptr` is non-null, aligned, and `ptr[..len]` is initialized
                // and valid for shared reads for at least `'_`. Cannot be a
                // `bun_ptr::RawSlice` field without breaking `src/bundler/`
                // struct-literal constructors (out-of-shard).
                Contents::SharedBuffer { ptr, len } | Contents::External { ptr, len } => unsafe {
                    core::slice::from_raw_parts(*ptr, *len)
                },
                // SAFETY: ARENA — `ptr[..len]` lives in the caller-supplied
                // `MimallocArena`, which the caller guarantees outlives every
                // read through this `Entry` (the arena is dropped only after
                // the `ParseResult` carrying this `Contents` is recycled).
                Contents::Arena { ptr, len } => unsafe {
                    core::slice::from_raw_parts(ptr.as_ptr(), *len)
                },
            }
        }

        #[inline]
        pub fn is_empty(&self) -> bool {
            match self {
                Contents::Empty => true,
                Contents::Owned(v) => v.is_empty(),
                Contents::Arena { len, .. }
                | Contents::SharedBuffer { len, .. }
                | Contents::External { len, .. } => *len == 0,
            }
        }

        #[inline]
        pub fn len(&self) -> usize {
            match self {
                Contents::Empty => 0,
                Contents::Owned(v) => v.len(),
                Contents::Arena { len, .. }
                | Contents::SharedBuffer { len, .. }
                | Contents::External { len, .. } => *len,
            }
        }

        #[inline]
        pub fn as_ptr(&self) -> *const u8 {
            self.as_slice().as_ptr()
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
    /// `Cow<'buf,[u8]>` per the spec `PathContentsPair` shape). `Borrowed`
    /// always points into the per-thread `shared_buffer` on the
    /// `use_shared_buffer=true` path → tag as `SharedBuffer` so `deinit` is a
    /// no-op; `Owned` is the heap arm.
    impl<'buf> From<std::borrow::Cow<'buf, [u8]>> for Contents {
        fn from(c: std::borrow::Cow<'buf, [u8]>) -> Self {
            match c {
                std::borrow::Cow::Borrowed([]) => Contents::Empty,
                std::borrow::Cow::Borrowed(s) => Contents::SharedBuffer {
                    ptr: s.as_ptr(),
                    len: s.len(),
                },
                std::borrow::Cow::Owned(v) => Contents::from(v),
            }
        }
    }

    /// `contents` is provenance-tagged (see
    /// [`Contents`]); callers feed `entry.contents()` into `bun_ast::Source`.
    /// Ownership is **manual** (`deinit`) — callers frequently
    /// hand the bytes off to a `Source` that outlives the `Entry`.
    pub struct Entry {
        pub contents: Contents,
        pub fd: Fd,
    }

    impl Default for Entry {
        fn default() -> Self {
            Entry {
                contents: Contents::Empty,
                fd: Fd::INVALID,
            }
        }
    }

    impl Entry {
        #[inline]
        pub fn contents(&self) -> &[u8] {
            self.contents.as_slice()
        }

        /// NOT `Drop` — callers free
        /// explicitly (and frequently hand `contents` off to a `Source` that
        /// outlives the `Entry`).
        pub fn deinit(&mut self) {
            self.contents = Contents::Empty;
        }

        /// Closes the entry's cached fd (if open) and marks it invalid;
        /// returns the close error, if any.
        pub fn close_fd(&mut self) -> Option<bun_sys::Error> {
            use bun_sys::FdExt as _;
            if self.fd.is_valid() {
                let fd = self.fd;
                self.fd = Fd::INVALID;
                // `bun_core::return_address()` is called directly from this
                // frame so the PC anchors our caller.
                return fd.close_allowing_bad_file_descriptor(Some(bun_core::return_address()));
            }
            None
        }
    }

    impl Fs {
        // When we are in a macro, the shared buffer may be in use by the in-progress macro.
        // so we have to dynamically switch it out.
        #[inline]
        pub fn shared_buffer(&mut self) -> &mut MutableString {
            if !self.use_alternate_source_cache {
                &mut self.shared_buffer
            } else {
                &mut self.macro_shared_buffer
            }
        }

        /// When we need to suspend/resume something that has pointers into the shared buffer, we need to
        /// switch out the shared buffer so that it is not in use.
        ///
        /// Ownership transfer: the suspended parse keeps pointers into the old buffer, so plain
        /// field assignment would drop+free the old buffer → use-after-free on resume. So we return
        /// the detached buffer; the caller MUST take ownership of it and keep it alive for as long as
        /// `parse_result.source.contents` may be read.
        pub fn reset_shared_buffer(&mut self, buffer: *const MutableString) -> MutableString {
            if core::ptr::eq(buffer, &raw const self.shared_buffer) {
                core::mem::replace(&mut self.shared_buffer, MutableString::init_empty())
            } else if core::ptr::eq(buffer, &raw const self.macro_shared_buffer) {
                core::mem::replace(&mut self.macro_shared_buffer, MutableString::init_empty())
            } else {
                unreachable!("resetSharedBuffer: invalid buffer");
            }
        }

        /// Read `path` into the
        /// caller's `shared` buffer (HMR / dev-server path).
        pub fn read_file_shared(
            &mut self,
            _fs: &mut fs_mod::FileSystem,
            path: &bun_core::ZStr,
            cached_file_descriptor: Option<Fd>,
            shared: &mut MutableString,
        ) -> crate::CrateResult<Entry> {
            let rfs = &_fs.fs;

            let mut owned: Option<bun_sys::File> = None;
            let fd: Fd = if let Some(fd) = cached_file_descriptor {
                // `try handle.seekTo(0)` — rewind a cached fd before re-reading.
                bun_sys::lseek(fd, 0, libc::SEEK_SET).map_err(crate::Error::from)?;
                fd
            } else {
                let f = bun_sys::open_file_absolute_z(path, bun_sys::OpenFlags::READ_ONLY)
                    .map_err(crate::Error::from)?;
                let raw = f.handle();
                owned = Some(f);
                raw
            };
            let file_handle = bun_sys::File::borrow(&fd);

            let contents = match fs_mod::read_file_contents(
                file_handle,
                path.as_bytes(),
                true,
                shared,
                self.stream,
            )
            .map(Contents::from)
            {
                Ok(c) => c,
                Err(err) => {
                    if cfg!(debug_assertions) {
                        Output::print_error(format_args!(
                            "{}: readFile error -- {}",
                            bstr::BStr::new(path.as_bytes()),
                            bstr::BStr::new(err.name()),
                        ));
                    }
                    return Err(err);
                }
            };

            let will_close = cached_file_descriptor.is_none() && rfs.need_to_close_files();
            let publish_fd = feature_flags::STORE_FILE_DESCRIPTORS && !will_close;
            if publish_fd {
                if let Some(f) = owned.take() {
                    let _ = f.into_raw();
                }
            }
            Ok(Entry {
                contents,
                fd: if publish_fd { fd } else { Fd::INVALID },
            })
        }

        /// Opens and reads `path` (relative to `dirname_fd`), optionally into
        /// the shared buffer, returning a cache `Entry` with the contents and
        /// possibly the kept-open fd.
        pub fn read_file(
            &mut self,
            _fs: &mut fs_mod::FileSystem,
            path: &[u8],
            dirname_fd: Fd,
            use_shared_buffer: bool,
            _file_handle: Option<Fd>,
        ) -> crate::CrateResult<Entry> {
            self.read_file_with_allocator(
                _fs,
                path,
                dirname_fd,
                use_shared_buffer,
                _file_handle,
                None,
            )
        }

        /// `use_shared_buffer` is taken at runtime — the live
        /// callers (`ParseTask::get_code_for_parse_task_without_plugins`,
        /// `Transpiler::parse`) pass a value computed from runtime state, and the
        /// resolver's earlier forward-decl already pinned this shape.
        /// PERF: re-monomorphize once both callers stabilize.
        ///
        /// `arena`: when
        /// `!use_shared_buffer && arena.is_some()` the file body is read
        /// directly into `arena` (`Contents::Arena`), so the bytes are
        /// bulk-freed by `mi_heap_destroy` when the per-call `MimallocArena`
        /// drops instead of landing in the worker thread's default mimalloc
        /// heap (which is never destroyed). `None` keeps the global-heap
        /// `Contents::Owned(Vec<u8>)` path.
        pub fn read_file_with_allocator(
            &mut self,
            _fs: &mut fs_mod::FileSystem,
            path: &[u8],
            dirname_fd: Fd,
            use_shared_buffer: bool,
            _file_handle: Option<Fd>,
            arena: Option<&bun_alloc::Arena>,
        ) -> crate::CrateResult<Entry> {
            let rfs = &_fs.fs;

            let will_close = rfs.need_to_close_files() && _file_handle.is_none();

            // A single let-expression avoids `mem::zeroed()` on a
            // type that may have niche (NonZero) fields.
            let file_handle: bun_sys::File = if let Some(f) = _file_handle {
                bun_sys::lseek(f, 0, libc::SEEK_SET).map_err(crate::Error::from)?;
                bun_sys::File::from_fd(f)
            } else if feature_flags::STORE_FILE_DESCRIPTORS && dirname_fd.is_valid() {
                match bun_sys::openat_a(
                    dirname_fd,
                    bun_paths::basename(path),
                    bun_sys::O::RDONLY,
                    0,
                ) {
                    Ok(fd) => bun_sys::File::from_fd(fd),
                    Err(err) if err.get_errno() == bun_sys::E::ENOENT => {
                        let handle = bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)
                            .map_err(crate::Error::from)?;
                        bun_core::pretty_errorln!(
                            "<r><d>Internal error: directory mismatch for directory \"{}\", fd {}<r>. You don't need to do anything, but this indicates a bug.",
                            bstr::BStr::new(path),
                            dirname_fd,
                        );
                        handle
                    }
                    Err(err) => return Err(err.into()),
                }
            } else {
                bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)
                    .map_err(crate::Error::from)?
            };

            let mut owned: Option<bun_sys::File> = None;
            let fd: Fd = if _file_handle.is_some() {
                file_handle.into_raw()
            } else {
                let raw = file_handle.handle();
                owned = Some(file_handle);
                raw
            };
            let file_handle = bun_sys::File::borrow(&fd);

            #[cfg(not(windows))] // skip on Windows because NTCreateFile will do it.
            bun_core::scoped_log!(
                CacheFs,
                "openat({}, {}) = {}",
                dirname_fd,
                bstr::BStr::new(path),
                fd
            );

            // reshaped for borrowck — capture `stream` scalar before borrowing
            // the shared buffer.
            let stream = self.stream;

            let contents = match (use_shared_buffer, arena) {
                // Read straight into the per-call arena so the source bytes
                // are reclaimed by `mi_heap_destroy` instead of pinning a
                // segment in the worker thread's default heap.
                (false, Some(arena)) => {
                    match fs_mod::read_file_contents_in_arena(file_handle, path, arena) {
                        Ok((_, 0)) => Contents::Empty,
                        Ok((ptr, len)) => Contents::Arena { ptr, len },
                        Err(err) => {
                            if cfg!(debug_assertions) {
                                Output::print_error(format_args!(
                                    "{}: readFile error -- {}",
                                    bstr::BStr::new(path),
                                    bstr::BStr::new(err.name()),
                                ));
                            }
                            return Err(err);
                        }
                    }
                }
                _ => {
                    let shared = self.shared_buffer();
                    match fs_mod::read_file_contents(
                        file_handle,
                        path,
                        use_shared_buffer,
                        shared,
                        stream,
                    )
                    .map(Contents::from)
                    {
                        Ok(c) => c,
                        Err(err) => {
                            if cfg!(debug_assertions) {
                                Output::print_error(format_args!(
                                    "{}: readFile error -- {}",
                                    bstr::BStr::new(path),
                                    bstr::BStr::new(err.name()),
                                ));
                            }
                            return Err(err);
                        }
                    }
                }
            };

            let publish_fd = feature_flags::STORE_FILE_DESCRIPTORS && !will_close;
            if publish_fd {
                if let Some(f) = owned.take() {
                    let _ = f.into_raw();
                }
            } else if will_close {
                bun_core::scoped_log!(CacheFs, "readFileWithAllocator close({})", fd);
            }
            Ok(Entry {
                contents,
                fd: if publish_fd { fd } else { Fd::INVALID },
            })
        }
    }

    /// Unit struct; AST caching is
    /// probably only relevant when bundling for production,
    /// so the struct is empty and `parse`/`scan` are stateless.
    ///
    /// CYCLEBREAK: `parse`/`scan` need `bun_js_parser::Parser::init` + the
    /// `Define` table type, both of which are mid-unification with the bundler's
    /// `defines.rs`. Until that lands, the bodies live in
    /// `bun_bundler::cache::JavaScript` (which can name those types directly);
    /// the resolver only needs the field shape so `Resolver.caches.js` exists.
    #[derive(Default)]
    pub(crate) struct JavaScript {}

    impl JavaScript {
        #[inline]
        pub(crate) fn init() -> JavaScript {
            JavaScript {}
        }
    }
}

pub use ::bun_paths::{is_package_path, is_package_path_not_absolute};

// Resolver implementation modules. Each file declares the sibling-crate `use`s
// it needs; cross-file references go through `crate::*` paths.
pub mod options;
pub mod resolver;
pub mod result;
pub mod standalone_module_graph;
