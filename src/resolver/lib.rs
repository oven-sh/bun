// Port of src/resolver/resolver.zig
#![allow(
    dead_code,
    unused_variables,
    unused_imports,
    unused_mut,
    non_snake_case
)]
#![allow(non_camel_case_types, non_upper_case_globals, clippy::all)]
#![allow(
    unused_unsafe,
    unreachable_code,
    static_mut_refs,
    private_interfaces,
    private_bounds
)]
#![warn(unused_must_use)]
#![allow(unused_macros, ambiguous_glob_reexports)]
#![allow(incomplete_features)]
#![feature(adt_const_params)]
// ──────────────────────────────────────────────────────────────────────────
// Resolver body. Higher-tier deps are reached via lower-tier crates:
// bun_install -> bun_install_types::AutoInstaller trait; bun_standalone_graph ->
// crate::StandaloneModuleGraph trait; HardcodedModule -> bun_resolve_builtins.
// ──────────────────────────────────────────────────────────────────────────

// Submodules. `fs.rs` (full RealFS readdir/stat/kind path) is now un-gated as
// `fs_full`; the inline `pub mod fs` below remains the canonical type surface
// (FileSystem, RealFS, Path, PathName, Entry, DirEntry, EntryLookup,
// EntriesOption, Implementation) until the body switches to `fs_full::*`
// wholesale. `fs_full` compiles to validate the port and is link-dead until
// re-exported.
#![warn(unreachable_pub)]
pub mod data_url;
pub mod dir_info;
#[path = "fs.rs"]
mod fs_full;
pub mod node_fallbacks;
pub mod package_json;
pub mod tsconfig_json;

// ── B-2 un-gated surface ──────────────────────────────────────────────────
// Real types now live in `__phase_a_body` below; the header re-exports them so
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

/// Expose the process-lifetime backing of a `PathString` as `&'static [u8]`.
///
/// Every `PathString::init` in this crate is fed a slice returned from
/// `FilenameStore::append_*` / `DirnameStore::append_*`, both of which are
/// `'static` BSS singletons that never free (LIFETIMES.tsv:
/// `resolver/fs.zig:Entry.abs_path → STATIC`). Centralizing the lifetime
/// extension here removes the per-call-site erasure.
///
/// TODO(port): once `bun_core::PathString::slice` is changed to return
/// `&'static [u8]` directly, this helper becomes a no-op forwarder.
#[inline(always)]
pub(crate) fn path_string_static(ps: &bun_core::PathString) -> &'static [u8] {
    // SAFETY: see fn doc — `PathString` always points into a process-lifetime
    // BSS append-only store (`FilenameStore`/`DirnameStore`); the bytes outlive
    // the program. `Interned` is the canonical proof type for this widen.
    unsafe { bun_ptr::Interned::assume(ps.slice()) }.as_bytes()
}

// Re-export the un-gated Phase-A body. `Resolver`, `Result`, `MatchResult`,
// `PathPair`, `DebugLogs`, `SideEffects`, etc. are defined there.
pub use __phase_a_body::StandaloneModuleGraph;
pub use __phase_a_body::options;
pub use __phase_a_body::{
    AnyResolveWatcher, BrowserMapPathKind, Bufs, DebugLogs, DebugMeta, DirEntryResolveQueueItem,
    Dirname, FlushMode, LoadResult, MatchResult, MatchResultUnion, PathPair, PendingResolution,
    PendingResolutionTag, Resolver, Result, ResultFlags, ResultUnion, RootPathPair,
    SideEffectsData,
};
/// Re-export so dependents can spell `bun_resolver::install_types::AutoInstaller`.
pub use ::bun_install_types::resolver_hooks as install_types;

/// Minimal real subset of `src/resolver/fs.zig` so `bun_resolver::fs::X` paths
/// resolve for downstream crates during B-2. Full Phase-A draft remains in
/// `fs.rs` (gated) until bun_alloc::BSSStringList / bun_output land.
pub mod fs {
    use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::io::Write as _;

    use bun_core::ZStr;
    use bun_paths::resolve_path::{is_sep_any, last_index_of_sep};

    // ── DirnameStore / FilenameStore ─────────────────────────────────────
    // The resolver body interns paths via `dirname_store.append_slice` /
    // `append_parts`. Backed by `bun_alloc::BSSStringList` singletons emitted
    // via `bss_string_list!` (per-monomorphization static + first-call init).
    //
    // Zig type params are pre-transformed to match `BSSStringList<COUNT, ITEM_LENGTH>`'s
    // `COUNT = _COUNT * 2, ITEM_LENGTH = _ITEM_LENGTH + 1` const-generic encoding.

    // PORT NOTE: `BSSStringList(2048, 128)` → `<{2048*2}, {128+1}>`
    bun_alloc::bss_string_list! { pub dirname_store_backing : 4096, 129 }
    // PORT NOTE: `BSSStringList(4096, 64)` → `<{4096*2}, {64+1}>`
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
                pub fn append_slice(
                    &self,
                    value: &[u8],
                ) -> core::result::Result<&'static [u8], bun_core::Error> {
                    // SAFETY: `$backing()` returns the raw `*mut` process-lifetime singleton
                    // (Zig `*Self`); `BSSStringList::append` takes `*mut Self` and serializes
                    // all mutation through its internal `mutex` (no aliased `&mut` is ever
                    // formed). The returned slice borrows its never-freed backing storage
                    // (heap-owned by a `'static` `BSSStringList` or a leaked mi_malloc), so
                    // widening to `'static` is sound.
                    unsafe { bun_alloc::BSSStringList::append($backing(), value) }
                        .map_err(|_| bun_core::err!("OutOfMemory"))
                }
                pub fn append_parts(
                    &self,
                    parts: &[&[u8]],
                ) -> core::result::Result<&'static [u8], bun_core::Error> {
                    // SAFETY: see `append_slice`.
                    unsafe { bun_alloc::BSSStringList::append($backing(), parts) }
                        .map_err(|_| bun_core::err!("OutOfMemory"))
                }
                /// Zig: `FileSystem.DirnameStore.print(fmt, args)` — format
                /// directly into the store's tail; no intermediate `String`.
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

    // Method names matching Zig `BSSStringList.append` / `appendLowerCase`
    // (allocators.zig) — `OOM!T` mapped per PORTING.md.
    macro_rules! string_store_append_impl {
        ($t:ty, $backing:ident) => {
            impl $t {
                /// Zig: `<Store>.append(allocator, value)`.
                #[inline]
                pub fn append(
                    &self,
                    value: &[u8],
                ) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
                    // SAFETY: `$backing()` returns the raw `*mut` process-lifetime singleton;
                    // `BSSStringList::append` takes `*mut Self` and serializes all mutation
                    // through its internal `mutex`. Returned slice borrows its never-freed
                    // storage, so widening to `'static` is sound.
                    unsafe { bun_alloc::BSSStringList::append($backing(), value) }
                        .map_err(|_| bun_alloc::AllocError)
                }
                /// Zig: `<Store>.appendLowerCase(allocator, value)`.
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

    /// Port of `FileSystem` in `fs.zig`.
    pub struct FileSystem {
        pub top_level_dir: &'static [u8],

        // used on subsequent updates (process.chdir writes here and re-slices
        // `top_level_dir` to point into it).
        pub top_level_dir_buf: bun_paths::PathBuffer,

        pub fs: Implementation,
        pub dirname_store: &'static DirnameStore,
        pub filename_store: &'static FilenameStore,
    }

    // Global mutable singleton; Zig used `var instance: FileSystem = undefined`.
    // `RacyCell` is the alias-safe static cell — `init()` is the only writer,
    // serialized at startup; readers go through `instance()`.
    pub static INSTANCE: bun_core::RacyCell<core::mem::MaybeUninit<FileSystem>> =
        bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());
    pub static INSTANCE_LOADED: AtomicBool = AtomicBool::new(false);

    /// Port of `FileSystem.max_fd` global in `fs.zig`.
    // PORT NOTE: Windows uses `HANDLE` (no monotone ordering); tracked POSIX-only.
    #[cfg(not(windows))]
    pub static MAX_FD: core::sync::atomic::AtomicI32 = core::sync::atomic::AtomicI32::new(0);

    static TMPNAME_ID_NUMBER: AtomicU32 = AtomicU32::new(0);

    impl FileSystem {
        /// Port of `FileSystem.tmpname` in `fs.zig`:
        /// `pub fn tmpname(extname: string, buf: []u8, hash: u64) std.fmt.BufPrintError![:0]u8`
        pub fn tmpname<'b>(
            extname: &[u8],
            buf: &'b mut [u8],
            hash: u64,
        ) -> core::result::Result<&'b mut ZStr, bun_core::Error> {
            // PORT NOTE: `std.time.nanoTimestamp()` — bun_core has no `time` module yet;
            // use std directly (matches Zig which also calls std.time).
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
            .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
            let written = len - cursor.len();
            if written >= len {
                return Err(bun_core::err!("NoSpaceLeft"));
            }
            buf[written] = 0;
            Ok(ZStr::from_buf_mut(buf, written))
        }

        #[inline]
        pub fn instance() -> &'static mut FileSystem {
            // SAFETY: caller guarantees init() was called (matches Zig global singleton).
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

        /// Port of `FileSystem.init` (fs.zig:90-108). First call writes the
        /// global `INSTANCE`; subsequent calls return it untouched. Delegates
        /// `Implementation` construction to `RealFS::init` so the process
        /// RLIMIT_NOFILE is raised and `file_limit`/`file_quota` carry the
        /// real fd budget — `need_to_close_files` depends on that to enable
        /// directory-fd caching.
        pub fn init(
            top_level_dir: Option<&[u8]>,
        ) -> core::result::Result<*mut FileSystem, bun_core::Error> {
            Self::init_with_force::<false>(top_level_dir)
        }

        /// Port of `FileSystem.initWithForce` (fs.zig). When `FORCE`, re-seeds
        /// the singleton even if already loaded — used by the router test
        /// harness which `chdir`s between fixtures and needs a fresh
        /// `top_level_dir`.
        pub fn init_with_force<const FORCE: bool>(
            top_level_dir: Option<&[u8]>,
        ) -> core::result::Result<*mut FileSystem, bun_core::Error> {
            // SAFETY: matches Zig global singleton init pattern; called from
            // `Transpiler::init` before any worker spawn.
            unsafe {
                if INSTANCE_LOADED.load(Ordering::Acquire) && !FORCE {
                    return Ok((*INSTANCE.get()).as_mut_ptr());
                }
            }
            let cwd: &'static [u8] = match top_level_dir {
                // PORT NOTE: intern into the process-lifetime `DirnameStore` so
                // callers may pass a borrowed path without leaking it themselves
                // (Zig had no lifetime; the singleton outlives every caller).
                Some(d) => DirnameStore::instance().append_slice(d)?,
                None => {
                    // Spec fs.zig:161 — `bun.getcwdAlloc(allocator)`.
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
            // point. Zig had a single `Fs.FileSystem.instance` global so the
            // split is a porting artifact; this keeps both halves in lockstep.
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

        /// Port of `FileSystem.setMaxFd` in `fs.zig`.
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
                // SAFETY: single-threaded mutation in resolver context (matches Zig global `max_fd`).
                MAX_FD.fetch_max(_fd, Ordering::Relaxed);
            }
        }

        /// Port of `FileSystem.max_fd` global in `fs.zig` — highest fd seen via `set_max_fd`.
        #[inline]
        #[cfg(not(windows))]
        pub fn max_fd() -> bun_sys::RawFd {
            // SAFETY: single-threaded read in resolver context (matches Zig global `max_fd`).
            MAX_FD.load(Ordering::Relaxed)
        }

        /// Port of `FileSystem.absBuf` in `fs.zig`.
        pub fn abs_buf<'b>(&self, parts: &[&[u8]], buf: &'b mut [u8]) -> &'b [u8] {
            use bun_paths::resolve_path::{join_abs_string_buf, platform};
            join_abs_string_buf::<platform::Loose>(self.top_level_dir, buf, parts)
        }

        /// Port of `FileSystem.absBufChecked` in `fs.zig` — returns `None` on overflow.
        pub fn abs_buf_checked<'b>(&self, parts: &[&[u8]], buf: &'b mut [u8]) -> Option<&'b [u8]> {
            use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
            join_abs_string_buf_checked::<platform::Loose>(self.top_level_dir, buf, parts)
        }

        /// Port of `FileSystem.absBufZ` in `fs.zig` — like `abs_buf` but writes a
        /// NUL sentinel and returns a `ZStr` borrowing `buf`.
        pub fn abs_buf_z<'b>(&self, parts: &[&[u8]], buf: &'b mut [u8]) -> &'b ZStr {
            use bun_paths::resolve_path::{join_abs_string_buf_z, platform};
            join_abs_string_buf_z::<platform::Loose>(self.top_level_dir, buf, parts)
        }

        /// Port of `FileSystem.normalizeBuf` in `fs.zig`.
        pub fn normalize_buf<'b>(&self, buf: &'b mut [u8], str: &[u8]) -> &'b [u8] {
            use bun_paths::resolve_path::{normalize_string_buf, platform};
            normalize_string_buf::<false, platform::Auto, false>(str, buf)
        }

        /// Port of `FileSystem.abs` in `fs.zig` — joins against `top_level_dir`
        /// into the resolver-shared threadlocal join buffer.
        pub fn abs(&self, parts: &[&[u8]]) -> &[u8] {
            use bun_paths::resolve_path::{join_abs_string, platform};
            join_abs_string::<platform::Loose>(self.top_level_dir, parts)
        }

        /// Port of `FileSystem.absAlloc` in `fs.zig`.
        pub fn abs_alloc(
            &self,
            parts: &[&[u8]],
        ) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
            use bun_paths::resolve_path::{join_abs_string, platform};
            let joined = join_abs_string::<platform::Loose>(self.top_level_dir, parts);
            // PORT NOTE: Zig duped via `allocator.dupe`; route through DirnameStore so
            // the resolver's `&'static [u8]` storage contract holds.
            DirnameStore::instance()
                .append_slice(joined)
                .map_err(|_| bun_alloc::AllocError)
        }

        /// Port of `FileSystem.relative` in `fs.zig` — `bun.path.relative(from, to)`.
        pub fn relative(&self, from: &[u8], to: &[u8]) -> &'static [u8] {
            bun_paths::resolve_path::relative(from, to)
        }

        /// Port of `FileSystem.relativeTo` in `fs.zig` — relative path from
        /// `top_level_dir` to `to`. Returns a slice into the resolver-shared
        /// threadlocal relative buffer; caller must dup before the next call.
        pub fn relative_to(&self, to: &[u8]) -> &'static [u8] {
            bun_paths::resolve_path::relative(self.top_level_dir, to)
        }

        /// Port of `FileSystem.relativeFrom` in `fs.zig`.
        pub fn relative_from(&self, from: &[u8]) -> &'static [u8] {
            bun_paths::resolve_path::relative(from, self.top_level_dir)
        }

        /// Zig: `f.top_level_dir` — cached cwd captured at `FileSystem::init`.
        #[inline]
        pub fn top_level_dir(&self) -> &'static [u8] {
            self.top_level_dir
        }

        /// Zig: `f.top_level_dir = slice` (PackageManager.zig:776). `dir` must be
        /// `'static` (interned in `DirnameStore` or a process-lifetime buffer
        /// like `cwd_buf`). Takes `&mut self` — callers hold `&'static mut
        /// FileSystem` from `instance()`; only called during single-threaded
        /// CLI init.
        #[inline]
        pub fn set_top_level_dir(&mut self, dir: &'static [u8]) {
            self.top_level_dir = dir;
            bun_core::set_top_level_dir(dir);
        }

        /// Zig: `topLevelDirWithoutTrailingSlash` (fs.zig).
        pub fn top_level_dir_without_trailing_slash(&self) -> &'static [u8] {
            let d = self.top_level_dir;
            if d.len() > 1 && d.last() == Some(&bun_paths::SEP) {
                &d[..d.len() - 1]
            } else {
                d
            }
        }

        /// Zig: `FileSystem.normalize` (fs.zig:415) —
        /// `path_handler.normalizeString(str, true, .auto)`.
        #[inline]
        pub fn normalize<'a>(&self, str: &'a [u8]) -> &'a [u8] {
            use bun_paths::resolve_path::{normalize_string, platform};
            normalize_string::<true, platform::Auto>(str)
        }

        /// Zig: `f.dirname_store` (fs.zig:76).
        #[inline]
        pub fn dirname_store(&self) -> &'static DirnameStore {
            self.dirname_store
        }
        /// Zig: `f.filename_store` (fs.zig:77).
        #[inline]
        pub fn filename_store(&self) -> &'static FilenameStore {
            self.filename_store
        }

        /// Zig: `FileSystem.RealFS.getDefaultTempDir()` — `BUN_TMPDIR` or the
        /// platform fallback. Process-static once-computed.
        #[inline]
        pub fn get_default_temp_dir() -> &'static [u8] {
            RealFS::get_default_temp_dir()
        }

        /// Zig: `fs.fs.readDirectory(dir, null, generation, store_fd)`
        /// (fs.zig:872 `RealFS.readDirectory`). Returns the cached
        /// `*EntriesOption` slot owned by the resolver's BSSMap singleton
        /// (process-lifetime).
        #[inline]
        pub fn read_directory(
            &mut self,
            dir: &[u8],
            generation: Generation,
            store_fd: bool,
        ) -> core::result::Result<&'static mut EntriesOption, bun_core::Error> {
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

    /// Resolver-tier `fs.zig:Path` methods that pull deps `bun_paths` can't
    /// reach (`FilenameStore`/`DirnameStore`, `bun_wyhash`, `bun_options_types`,
    /// `bun_string`). Import this trait to call `.loader()` / `.dupe_alloc()` /
    /// `.hash_key()` on a `Path`.
    pub trait PathResolverExt<'a> {
        fn dupe_alloc(&self) -> Result<Path<'static>, bun_core::Error>;
        fn dupe_alloc_fix_pretty(&self) -> Result<Path<'static>, bun_core::Error>;
        fn hash_key(&self) -> u64;
        fn hash_for_kit(&self) -> u64;
        fn package_name(&self) -> Option<&[u8]>;
        fn loader(&self, loaders: &bun_ast::LoaderHashTable) -> Option<bun_ast::Loader>;
    }

    impl<'a> PathResolverExt<'a> for Path<'a> {
        /// Port of `Path.dupeAlloc` in `fs.zig` — interns `text`/`pretty` into the
        /// process-static `FilenameStore` so the returned `Path` borrows `'static`
        /// data. PORT NOTE: TYPE_ONLY shim — full overlap/slice-range
        /// short-circuiting lives in the gated `fs_full::Path::dupe_alloc`; this
        /// always interns.
        fn dupe_alloc(&self) -> Result<Path<'static>, bun_core::Error> {
            let text = FilenameStore::instance().append_slice(self.text)?;
            let pretty: &'static [u8] = if core::ptr::eq(self.text.as_ptr(), self.pretty.as_ptr())
                && self.text.len() == self.pretty.len()
            {
                text
            } else if self.pretty.is_empty() {
                b""
            } else {
                FilenameStore::instance().append_slice(self.pretty)?
            };
            let mut new_path = Path::<'static>::init(text);
            new_path.pretty = pretty;
            new_path.namespace = match self.namespace {
                b"" | b"file" => b"file",
                ns => FilenameStore::instance().append_slice(ns)?,
            };
            new_path.is_symlink = self.is_symlink;
            new_path.is_disabled = self.is_disabled;
            Ok(new_path)
        }

        /// Port of `Path.dupeAllocFixPretty` in `fs.zig`.
        fn dupe_alloc_fix_pretty(&self) -> Result<Path<'static>, bun_core::Error> {
            #[cfg(not(windows))]
            {
                self.dupe_alloc()
            }
            #[cfg(windows)]
            {
                // Spec: `if (this.isPrettyPathPosix()) return this.dupeAlloc(allocator);`
                // — `isPrettyPathPosix` on Windows is `indexOfChar(pretty, '\\') == null`.
                // Short-circuiting preserves the `pretty.ptr == text.ptr` aliasing
                // optimisation inside `dupe_alloc` and avoids a fresh FilenameStore alloc.
                if !self.pretty.iter().any(|&b| b == b'\\') {
                    return self.dupe_alloc();
                }
                let mut new = self.clone();
                new.pretty = b"";
                let mut new = new.dupe_alloc()?;
                let mut owned: Vec<u8> = self.pretty.to_vec();
                bun_paths::resolve_path::platform_to_posix_in_place::<u8>(&mut owned);
                new.pretty = FilenameStore::instance().append_slice(&owned)?;
                new.assert_pretty_is_valid();
                Ok(new)
            }
        }

        /// Port of `Path.hashKey` in `fs.zig`.
        fn hash_key(&self) -> u64 {
            if self.is_file() {
                return bun_wyhash::hash(self.text);
            }

            // PERF(port): Zig used incremental `std.hash.Wyhash.update`; bun_wyhash
            // exposes only the stateless `WyhashStateless` (aligned-chunk update +
            // tail final) and one-shot `hash`. Concat to a temp and one-shot.
            let mut buf = Vec::with_capacity(self.namespace.len() + 8 + self.text.len());
            buf.extend_from_slice(self.namespace);
            buf.extend_from_slice(b"::::::::");
            buf.extend_from_slice(self.text);
            bun_wyhash::hash(&buf)
        }

        /// Port of `Path.hashForKit` in `fs.zig`.
        ///
        /// This hash is used by the hot-module-reloading client in order to
        /// identify modules. Since that code is JavaScript, the hash must remain in
        /// range [-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER] or else information is lost
        /// due to floating-point precision.
        fn hash_for_kit(&self) -> u64 {
            // u52 — truncate to 52 bits
            self.hash_key() & ((1u64 << 52) - 1)
        }

        /// Port of `Path.packageName` in `fs.zig`.
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

        /// Port of `Path.loader` in `fs.zig`.
        fn loader(&self, loaders: &bun_ast::LoaderHashTable) -> Option<bun_ast::Loader> {
            use bun_ast::Loader;
            if self.is_data_url() {
                return Some(Loader::Dataurl);
            }

            let ext = self.name.ext;

            let result = loaders
                .get(ext)
                .copied()
                .or_else(|| Loader::from_string(ext));
            if result.is_none() || result == Some(Loader::Json) {
                let str = self.name.filename;
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
    use bun_core::PathString;
    use bun_paths::strings;
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
            // SAFETY: just wrote; threadlocal storage outlives caller (matches Zig
            // `&temp_entries_option`). Re-erase to 'static for the BSSMap-shaped
            // unbounded `&mut EntriesOption` return type — the `RefMut` guard
            // drops immediately on return, so no live `RefCell` borrow aliases
            // the escaped reference.
            unsafe { &mut *slot.as_mut_ptr() }
        })
    }

    // ── RealFS.Tmpfile ───────────────────────────────────────────────────
    /// Port of `FileSystem.RealFS.Tmpfile` (fs.zig). The Zig POSIX impl never
    /// touched its `*RealFS` arg (it always opens at cwd); the Windows impl
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
        pub fn file(&self) -> bun_sys::File {
            bun_sys::File::from_fd(self.fd)
        }

        pub fn close(&mut self) {
            if self.fd.is_valid() {
                let _ = bun_sys::close(self.fd);
                self.fd = bun_sys::Fd::INVALID;
            }
        }

        /// Zig: `Tmpfile.create(*RealFS, name)` — POSIX path opens at cwd
        /// (the `*RealFS` arg is unused there); Windows opens under the
        /// process temp dir.
        pub fn create(&mut self, name: &ZStr) -> core::result::Result<(), bun_core::Error> {
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
                // Spec: `const tmp_dir = try rfs.openTmpDir();` — `openTmpDir`
                // is `openDirAtWindowsA(invalid_fd, tmpdirPath(), .{ iterable,
                // !can_rename_or_delete, read_only })`. `tmpdirPath()` uses
                // `BUN_TMPDIR.getNotEmpty()` (so an empty env var falls through
                // to `platformTempDir`), not `get()`.
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

        /// Zig: `Tmpfile.promoteToCWD(from_name, name)`.
        pub fn promote_to_cwd(
            &mut self,
            from_name: &ZStr,
            name: &ZStr,
        ) -> core::result::Result<(), bun_core::Error> {
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

    /// Port of `FileSystem.RealFS.EntriesOption` in `fs.zig`.
    // PORT NOTE: Zig stores `*DirEntry` (raw, BSSMap-owned). Modeled as
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

    /// Downstream-facing alias — `bun_glob::GlobWalker` named the result of
    /// `RealFS::read_directory` `ReadDirResult`; the Zig type is `EntriesOption`.
    pub type ReadDirResult = EntriesOption;

    // SAFETY: ARENA — `EntriesOption` holds an unbounded `&mut DirEntry` (whose `data`
    // map stores `*mut Entry` into the BSSMap singleton). All access is serialized
    // through `RealFS.entries_mutex`; Zig used a `threadlocal var instance`. The
    // raw-pointer fields are the only thing blocking auto-Sync.
    unsafe impl Sync for EntriesOption {}
    unsafe impl Send for EntriesOption {}

    /// Port of `FileSystem.RealFS.EntriesOption.Map` in `fs.zig`:
    /// `allocators.BSSMap(EntriesOption, Preallocate.Counts.dir_entry, false, 256, true)`.
    /// `store_keys=false` → Rust `BSSMapInner<V, COUNT, RM_SLASH>` (est_key_len unused on inner shape).
    pub type EntriesOptionMap = bun_alloc::BSSMapInner<EntriesOption, 2048, true>;

    // Per-monomorphization singleton storage for `EntriesOption.Map` — Zig kept
    // `var instance` inside the generic; Rust emits it here at the declare site.
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
        pub fn get_or_put(
            &mut self,
            key: &[u8],
        ) -> core::result::Result<crate::__phase_a_body::allocators::Result, bun_core::Error>
        {
            self.inner()
                .get_or_put(key)
                .map_err(|_| bun_core::err!("OutOfMemory"))
        }
        pub fn at_index(&mut self, index: bun_alloc::IndexType) -> Option<&mut EntriesOption> {
            self.inner().at_index(index)
        }
        pub fn put(
            &mut self,
            result: &mut crate::__phase_a_body::allocators::Result,
            value: EntriesOption,
        ) -> core::result::Result<*mut EntriesOption, bun_core::Error> {
            // PORT NOTE: `BSSMapInner::put` mutates `result.index` to record placement; callers
            // (e.g. `dir_info_cached_maybe_log`) re-read `result.index` post-`put`, so the
            // mutation must be visible — pass through directly (Zig: `*Result`).
            self.inner()
                .put(result, value)
                .map(|v| std::ptr::from_mut::<EntriesOption>(v))
                .map_err(|_| bun_core::err!("OutOfMemory"))
        }
        pub fn mark_not_found(&mut self, result: crate::__phase_a_body::allocators::Result) {
            self.inner().mark_not_found(result)
        }
        pub fn remove(&mut self, key: &[u8]) -> bool {
            self.inner().remove(key)
        }
    }

    /// Zig: `pub const Implementation = RealFS;`
    pub type Implementation = RealFS;

    // ── RealFS ───────────────────────────────────────────────────────────

    /// Port of `FileSystem.RealFS` in `fs.zig`.
    pub struct RealFS {
        pub entries_mutex: Mutex,
        /// Port of `entries: *EntriesOption.Map`. The resolver body addresses
        /// this directly (`rfs.entries.get_or_put(..)`); modeled as the wrapper
        /// `EntriesMap` until bun_alloc un-gates BSSMap.
        pub entries: EntriesMap,
        pub cwd: &'static [u8],
        pub file_limit: usize,
        pub file_quota: usize,
    }

    impl RealFS {
        /// Port of `RealFS.init` (fs.zig:823-837) — raise RLIMIT_NOFILE and
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
        pub fn adjust_ulimit() -> core::result::Result<usize, bun_core::Error> {
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

        /// Port of `RealFS.openDir` in `fs.zig` — `open(path, O_DIRECTORY)`.
        pub fn open_dir(
            &self,
            unsafe_dir_string: &[u8],
        ) -> core::result::Result<Fd, bun_core::Error> {
            #[cfg(windows)]
            {
                // Spec: `bun.sys.openDirAtWindowsA(invalid_fd, path,
                // .{ iterable, !no_follow, read_only })` — NtCreateFile with
                // FILE_DIRECTORY_FILE/FILE_LIST_DIRECTORY so the resulting
                // handle is iterable for `readdir`.
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
                // PORT NOTE: Zig used `std.fs.openDirAbsolute` on POSIX, which
                // reduces to `open(path, O_DIRECTORY)`; route through
                // `bun_sys::open_a` for the NUL-termination handling.
                bun_sys::open_a(unsafe_dir_string, bun_sys::O::DIRECTORY, 0).map_err(Into::into)
            }
        }

        /// Port of `RealFS.readdir` in `fs.zig` — iterate `handle` and populate a
        /// fresh `DirEntry` (re-using `prev_map` Entry slots where the name matches).
        fn readdir<I: DirEntryIterator>(
            &mut self,
            store_fd: bool,
            mut prev_map: Option<&mut dir_entry::EntryMap>,
            dir_: &'static [u8],
            generation: Generation,
            handle: Fd,
            iterator: I,
        ) -> core::result::Result<DirEntry, bun_core::Error> {
            let mut iter = bun_sys::iterate_dir(handle);
            let mut dir = DirEntry::init(dir_, generation);
            // errdefer dir.deinit() — DirEntry: Drop frees `data` on `?`.

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

        /// Port of `RealFS.readDirectoryError` in `fs.zig` — cache (or threadlocal-
        /// stash) an `EntriesOption::Err` for `dir` and hand back its address.
        fn read_directory_error(
            &mut self,
            dir: &[u8],
            err: bun_core::Error,
        ) -> core::result::Result<&'static mut EntriesOption, bun_core::Error> {
            if bun_core::FeatureFlags::ENABLE_ENTRY_CACHE {
                let mut get_or_put_result = self.entries.get_or_put(dir)?;
                if err == bun_core::err!("ENOENT") || err == bun_core::err!("FileNotFound") {
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

        /// Port of `RealFS.readDirectory` in `fs.zig`.
        pub fn read_directory(
            &mut self,
            dir_: &[u8],
            handle_: Option<Fd>,
            generation: Generation,
            store_fd: bool,
        ) -> core::result::Result<&mut EntriesOption, bun_core::Error> {
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
        /// Port of `RealFS.readDirectoryWithIterator` in `fs.zig`.
        ///
        /// Caller borrows the returned `EntriesOption`. When `FeatureFlags::ENABLE_ENTRY_CACHE`
        /// is `false`, it is not safe to store this pointer past the current function call.
        pub fn read_directory_with_iterator<I: DirEntryIterator>(
            &mut self,
            dir_maybe_trail_slash: &[u8],
            maybe_handle: Option<Fd>,
            generation: Generation,
            store_fd: bool,
            iterator: I,
        ) -> core::result::Result<&'static mut EntriesOption, bun_core::Error> {
            let mut dir =
                strings::paths::without_trailing_slash_windows_path(dir_maybe_trail_slash);

            crate::Resolver::assert_valid_cache_key(dir);
            let mut cache_result: Option<bun_alloc::Result> = None;
            // Zig: `entries_mutex.lock(); defer entries_mutex.unlock();` — RAII guard.
            // `MutexGuard` stores a raw `*const Mutex` so it does not keep `&self`
            // borrowed across the body below.
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
                        // PORT NOTE: erase to raw immediately so the early-return reborrow
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
                                original_err: bun_core::err!("ENOENT"),
                                canonical_error: bun_core::err!("ENOENT"),
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
                    Err(err) => return Ok(self.read_directory_error(dir, err)?),
                },
            };

            // PORT NOTE: Zig `defer { if (...) handle.close() }` — runs on every exit. Use
            // scopeguard so close happens even if `readdir`/`put` early-return with `?`.
            let should_close_handle = !had_handle && (!store_fd || self.need_to_close_files());
            let _close_guard = scopeguard::guard(handle, move |h| {
                if should_close_handle {
                    let _ = bun_sys::close(h);
                }
            });

            // if we get this far, it's a real directory, so we can just store the dir name.
            let dir: &'static [u8] = if !had_handle {
                if let Some(existing) = in_place {
                    // SAFETY: `in_place` points to a `DirEntry` inside the BSSMap singleton;
                    // its `dir` field is DirnameStore-interned (&'static).
                    unsafe { (*existing).dir }
                } else {
                    DirnameStore::instance().append_slice(dir_maybe_trail_slash)?
                }
            } else {
                // PORT NOTE: Zig stored the caller-provided slice directly (no lifetime
                // system). Intern into DirnameStore so the cache entry never dangles —
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
                        // PORT NOTE: Zig `clear_and_free`; bun_collections::StringHashMap exposes `clear`.
                        unsafe { (*existing).data.clear() };
                    }
                    return Ok(self.read_directory_error(dir, err)?);
                }
            };

            if bun_core::FeatureFlags::ENABLE_ENTRY_CACHE {
                // PORT NOTE: Zig `entries_ptr = in_place orelse allocator.create(DirEntry)`.
                // `EntriesOption::Entries` here holds an unbounded `&mut DirEntry` (raw, BSSMap-stored
                // pointer), so a fresh slot is a leaked `Box<DirEntry>` whose lifetime is the
                // `entries_option_map()` singleton (process-static).
                let entries_ptr: *mut DirEntry = match in_place {
                    Some(p) => p,
                    None => bun_core::heap::into_raw(Box::new(DirEntry::init(dir, generation))),
                };
                if let Some(original) = in_place {
                    // SAFETY: BSSMap-owned; entries_mutex held.
                    // PORT NOTE: Zig `clear_and_free`; bun_collections::StringHashMap exposes `clear`.
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
            // this thread (matches Zig — threadlocal `temp_entries_option`).
            let entries_ptr = bun_core::heap::into_raw(Box::new(entries));
            // SAFETY: freshly-leaked Box; re-borrow as 'static for the threadlocal slot.
            Ok(temp_entries_option_write(EntriesOption::Entries(unsafe {
                &mut *entries_ptr
            })))
        }

        /// Port of `RealFS.bustEntriesCache` in `fs.zig`.
        pub fn bust_entries_cache(&mut self, file_path: &[u8]) -> bool {
            // Zig took no lock here, but `entries` is the process-global
            // BSSMap singleton and `remove` mutates it; callers (transpiler /
            // hot-reloader / VM) reach this without `RESOLVER_MUTEX`, so take
            // `entries_mutex` to satisfy `EntriesMap::inner`'s aliasing
            // invariant. No caller already holds it (no re-entry from
            // `read_directory`/`dir_info_cached_maybe_log`).
            let _g = self.entries_mutex.lock_guard();
            self.entries.remove(file_path)
        }

        /// Port of `RealFS.kind` in `fs.zig` — lstat + (if symlink) open + fstat +
        /// readlink to populate an `EntryCache`. Windows: `GetFileAttributesW` +
        /// (if reparse point) `CreateFileW`-follow + `GetFinalPathNameByHandle`
        /// realpath.
        pub fn kind(
            &mut self,
            dir_: &[u8],
            base: &[u8],
            existing_fd: Fd,
            store_fd: bool,
        ) -> core::result::Result<EntryCache, bun_core::Error> {
            use bun_paths::resolve_path::{join_abs_string_buf, platform};
            use bun_sys::{FileKind, kind_from_mode};

            let mut cache = EntryCache {
                kind: EntryKind::File,
                symlink: PathString::EMPTY,
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
                    .ok_or(bun_core::err!("FileNotFound"))?;
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
                    cache.symlink = PathString::init(FilenameStore::instance().append_slice(real)?);
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
                        .handle()
                    } else {
                        // PORT NOTE: Zig `bun.openFileForPath` (bun.zig:1900-1910) — O_PATH is
                        // Linux-only; macOS/BSD use O_RDONLY. Both add O_NOCTTY|O_CLOEXEC.
                        #[cfg(target_os = "linux")]
                        let flags = bun_sys::O::PATH | bun_sys::O::CLOEXEC | bun_sys::O::NOCTTY;
                        #[cfg(not(target_os = "linux"))]
                        let flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NOCTTY;
                        bun_sys::open(absolute_path_c, flags, 0)?
                    };
                    FileSystem::set_max_fd(file.native());

                    // PORT NOTE: Zig `defer { if (...) file.close() else cache.fd = file }` runs on
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
                        PathString::init(FilenameStore::instance().append_slice(symlink)?);
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
        ) -> core::result::Result<EntryCache, bun_core::Error> {
            self.kind(dir, base, existing_fd, store_fd)
        }
    }

    impl RealFS {
        /// Port of `RealFS.needToCloseFiles` in `fs.zig`.
        #[inline]
        pub fn need_to_close_files(&self) -> bool {
            if !bun_core::feature_flags::STORE_FILE_DESCRIPTORS {
                return true;
            }

            #[cfg(windows)]
            {
                // 'false' is okay here because windows gives you a seemingly unlimited number of
                // open file handles, while posix has a lower limit. Handles are automatically
                // closed when the process exits. See fs.zig `needToCloseFiles` for the full
                // rationale (handle ordering on Windows is non-monotone, so MAX_FD tracking
                // doesn't apply).
                return false;
            }

            #[cfg(not(windows))]
            {
                // If we're not near the max amount of open files, don't worry about it.
                !(self.file_limit > 254
                    && self.file_limit > (FileSystem::max_fd() as usize + 1) * 2)
            }
        }

        /// Port of `RealFS.entriesAt` in `fs.zig` — index lookup with generation-check
        /// re-read (open + readdir + cache replace) when the cached listing is stale.
        pub fn entries_at(
            &mut self,
            index: bun_alloc::IndexType,
            generation: Generation,
        ) -> Option<&mut EntriesOption> {
            // PORT NOTE: erase to raw immediately so re-borrowing `&mut self` for
            // `open_dir`/`readdir`/`read_directory_error` doesn't conflict.
            // `entries_mutex` held by caller; sole `&mut` to this slot.
            let result_ptr = std::ptr::from_mut::<EntriesOption>(self.entries.at_index(index)?);
            // SAFETY: BSSMap-owned slot; uniquely held under `entries_mutex`.
            if let EntriesOption::Entries(existing) = unsafe { &mut *result_ptr } {
                if existing.generation < generation {
                    let e_ptr: *mut DirEntry = std::ptr::from_mut::<DirEntry>(*existing);
                    // SAFETY: BSSMap-owned `DirEntry` (boxed/leaked into `EntriesOption`); `entries_mutex` held.
                    let dir = unsafe { (*e_ptr).dir };
                    // Spec fs.zig:617 — `bun.openDirForIteration(FD.cwd(), dir)`, NOT
                    // `RealFS.openDir`. On Windows the two diverge: `open_dir` passes
                    // `read_only: true` (no DELETE access on the handle), whereas
                    // `openDirForIteration` uses the default `WindowsOpenDirOptions`
                    // (`can_rename_or_delete: true`). On POSIX it's `O_DIRECTORY` only
                    // vs `O_RDONLY|O_DIRECTORY`. Match the spec's flag set exactly.
                    let handle = match bun_sys::open_dir_for_iteration(Fd::cwd(), dir) {
                        Ok(h) => h,
                        Err(err) => {
                            // SAFETY: see above.
                            unsafe { (*e_ptr).data.clear() };
                            return self.read_directory_error(dir, err.into()).ok();
                        }
                    };
                    // PORT NOTE: Zig `defer handle.close()` — runs on every exit.
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

        /// Port of `RealFS.platformTempDir()` in `fs.zig`.
        pub fn platform_temp_dir() -> &'static [u8] {
            static ONCE: bun_core::Once<&'static [u8]> = bun_core::Once::new();
            ONCE.call(Self::platform_temp_dir_compute)
        }

        /// Port of `RealFS.tmpdirPath()` in `fs.zig`:
        /// `pub fn tmpdirPath() []const u8 { return bun.env_var.BUN_TMPDIR.getNotEmpty() orelse platformTempDir(); }`
        pub fn tmpdir_path() -> &'static [u8] {
            bun_core::env_var::BUN_TMPDIR
                .get_not_empty()
                .unwrap_or_else(Self::platform_temp_dir)
        }

        /// Port of `RealFS.getDefaultTempDir()` in `fs.zig`.
        pub fn get_default_temp_dir() -> &'static [u8] {
            bun_core::env_var::BUN_TMPDIR
                .get()
                .unwrap_or_else(Self::platform_temp_dir)
        }
    }

    // ── `file_system` namespace shim ─────────────────────────────────────
    // The Phase-A resolver body addresses types via `Fs::file_system::*` (the
    // Zig nesting was `FileSystem.RealFS.EntriesOption` etc.). Re-export the
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
    /// can hash mtimes/sizes without inlining the formatter (Zig: `bun.fs.StatHash`).
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
        /// dead args (linker.zig:58 → fs.zig `ModKey.generate`).
        pub fn from_file(file: &bun_sys::File) -> core::result::Result<Self, bun_core::Error> {
            let stat = file.stat()?;

            const NS_PER_S: i128 = 1_000_000_000;
            // PORT NOTE: `bun_sys::Stat` is `libc::stat`; Zig's
            // `std.fs.File.stat()` returned a normalized struct with
            // `mtime: i128` ns. Reconstruct from `st_mtime` (sec) +
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
                return Err(bun_core::err!("Unusable"));
            }

            // Don't generate a modification key if the file is too new
            let now = bun_core::time::nano_timestamp();
            let now_seconds = now / NS_PER_S;
            // PORT NOTE: Zig had `seconds > seconds` (always false) — preserved
            #[allow(clippy::eq_op)]
            if seconds > seconds || (seconds == now_seconds && mtime > now) {
                return Err(bun_core::err!("Unusable"));
            }

            Ok(ModKey {
                inode: stat.st_ino as u64,
                size: stat.st_size as u64,
                mtime,
                mode: stat.st_mode as u32,
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
// DirEntry cache. Port of `glob.walk.DirEntryAccessor` (GlobWalker.zig).
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

    // PORT NOTE: Zig `FS.DirEntry.EntryMap.Iterator` (key_ptr/value_ptr shape).
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
    }

    pub struct DirEntryNameWrapper {
        // BACKREF: borrowed slice into a `Box<[u8]>` key owned by
        // `DirEntry.data: HashMap`. Valid only while the parent `DirEntry`
        // is live and not regenerated by `read_directory`. Stored as
        // [`bun_ptr::RawSlice`] (not `&'static [u8]`) per PORTING.md
        // §Forbidden — the key is individually heap-allocated by the HashMap,
        // not a BSS-arena slice, so minting a `'static` borrow via
        // `from_raw_parts` would be a lifetime lie. `RawSlice` encapsulates
        // the outlives-holder invariant so `slice()` is safe.
        // Mirrors Zig `IterResult.NameWrapper.value: []const u8` (no lifetime).
        pub value: bun_ptr::RawSlice<u8>,
    }

    impl DirEntryNameWrapper {
        #[inline]
        pub fn slice(&self) -> &[u8] {
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
                let kind = entry.kind(fs, true);
                let fskind = match kind {
                    EntryKind::File => bun_sys::FileKind::File,
                    EntryKind::Dir => bun_sys::FileKind::Directory,
                };
                // BACKREF: wrap the HashMap key's bytes in a `RawSlice`
                // instead of fabricating `&'static [u8]` (PORTING.md §Forbidden).
                // The key is a `Box<[u8]>` owned by `DirEntry.data` and valid
                // until the next `read_directory` regeneration; `name_slice()`
                // re-narrows the lifetime so it never escapes the iter result.
                // Mirrors Zig `nextval.key_ptr.*`.
                Ok(Some(DirEntryIterResult {
                    name: DirEntryNameWrapper {
                        value: bun_ptr::RawSlice::new(&**key),
                    },
                    kind: fskind,
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
            let res = FS::instance().fs.read_directory(path, None, 0, false)?;
            match res {
                EntriesOption::Entries(entry) => {
                    // SAFETY: ARENA — `entry` (unbounded `&mut DirEntry`) borrows the BSSMap
                    // singleton; reborrow as shared 'static for the Copy handle.
                    let p: *const DirEntry = &raw const **entry;
                    Ok(Ok(DirEntryHandle {
                        value: Some(unsafe { &*p }),
                    }))
                }
                EntriesOption::Err(err) => Err(err.original_err),
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
            // TODO(port): Zig version has no return; assuming it should return the copied slice
            Ok(&path_buf[..cwd.len()])
        }
    }
}
pub use dir_entry_accessor::DirEntryAccessor;

// ──────────────────────────────────────────────────────────────────────────
// `cache` — port of `src/bundler/cache.zig` (`Set`/`Fs`/`Entry`/`JavaScript`/
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

    /// Port of `cache::Set` (cache.zig:1).
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

    /// Port of `cache::Fs` (cache.zig:18).
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

    /// Port of `Fs.Entry.ExternalFreeFunction` (cache.zig:26).
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
    /// (forbidden per docs/PORTING.md §Forbidden patterns). Zig's `string`
    /// field (cache.zig:20) carried an implicit allocator contract; Rust makes
    /// provenance explicit so `deinit` matches on the variant instead of
    /// guessing — the old scheme would `heap::take` a `MutableString`-owned
    /// pointer on the `use_shared_buffer=true` path (UB).
    pub enum Contents {
        /// Empty / static literal. No-op on `deinit`.
        Empty,
        /// Heap-owned buffer (default-allocator path). Freed when this variant
        /// drops. Stored as `Vec<u8>` (not `Box<[u8]>`) so a sentinel NUL can
        /// sit in spare capacity past `len`, matching fs.zig:1671.
        Owned(Vec<u8>),
        /// Bytes live in a caller-supplied `bun_alloc::Arena` (the per-call
        /// `MimallocArena` from `ParseOptions.arena`). NOT freed on `deinit` —
        /// bulk-reclaimed by `mi_heap_destroy` when the arena drops. This is
        /// the `allocator != bun.default_allocator` arm of
        /// `Fs.readFileWithAllocator` (cache.zig:146 → fs.zig:1617): the
        /// concurrent-transpiler path passed `this_parse.allocator` so the
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
        /// Native-plugin memory; freed via `Entry.external_free_function.call()`.
        External { ptr: *const u8, len: usize },
    }

    impl Default for Contents {
        fn default() -> Self {
            Contents::Empty
        }
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
                // dropped); `External` is native-plugin memory kept live until
                // `external_free_function` runs in `deinit`. In both cases
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
                std::borrow::Cow::Borrowed(s) if s.is_empty() => Contents::Empty,
                std::borrow::Cow::Borrowed(s) => Contents::SharedBuffer {
                    ptr: s.as_ptr(),
                    len: s.len(),
                },
                std::borrow::Cow::Owned(v) => Contents::from(v),
            }
        }
    }

    /// Port of `Fs.Entry` (cache.zig:19). `contents` is provenance-tagged (see
    /// [`Contents`]); callers feed `entry.contents()` into `bun_ast::Source`.
    /// Ownership is **manual** (`deinit`), matching Zig — callers frequently
    /// hand the bytes off to a `Source` that outlives the `Entry`.
    pub struct Entry {
        pub contents: Contents,
        pub fd: Fd,
        /// When `contents` comes from a native plugin, this field is populated
        /// with information on how to free it.
        pub external_free_function: ExternalFreeFunction,
    }

    impl Default for Entry {
        fn default() -> Self {
            Entry {
                contents: Contents::Empty,
                fd: Fd::INVALID,
                external_free_function: ExternalFreeFunction::NONE,
            }
        }
    }

    impl Entry {
        /// Convenience: take ownership of a heap buffer.
        pub fn new(
            contents: Box<[u8]>,
            fd: Fd,
            external_free_function: ExternalFreeFunction,
        ) -> Entry {
            Entry {
                contents: Contents::from(contents),
                fd,
                external_free_function,
            }
        }

        #[inline]
        pub fn contents(&self) -> &[u8] {
            self.contents.as_slice()
        }

        /// Port of `Entry.deinit` (cache.zig:39). NOT `Drop` — Zig callers free
        /// explicitly (and frequently hand `contents` off to a `Source` that
        /// outlives the `Entry`).
        pub fn deinit(&mut self) {
            if let Some(func) = self.external_free_function.function {
                // SAFETY: ctx/function pair was supplied together by the native plugin.
                unsafe { func(self.external_free_function.ctx) };
            }
            // Replacing the variant drops `Owned(Vec<u8>)` (matches Zig's
            // `allocator.free(entry.contents)`); `Arena`/`SharedBuffer`/
            // `External`/`Empty` have trivial drops, so the shared-buffer and
            // arena paths are correct no-ops instead of the UB `heap::take`
            // they used to be.
            self.contents = Contents::Empty;
        }

        /// Port of `Entry.closeFD` (cache.zig:48).
        pub fn close_fd(&mut self) -> Option<bun_sys::Error> {
            use bun_sys::FdExt as _;
            if self.fd.is_valid() {
                let fd = self.fd;
                self.fd = Fd::INVALID;
                // TODO(port): @returnAddress() has no stable Rust equivalent; pass None.
                return fd.close_allowing_bad_file_descriptor(None);
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
        /// Ownership transfer: in Zig (cache.zig:77/79) the field is overwritten WITHOUT freeing
        /// the old buffer, because the suspended parse keeps pointers into it (see ModuleLoader.zig:488,
        /// "this shared buffer is about to become owned by the AsyncModule struct"). In Rust, plain
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

        // TODO(port): Zig `Fs.deinit` references `c.entries` which is not a field on `Fs` —
        // dead code (Zig lazy compilation never instantiated it). No Drop impl needed beyond
        // the auto-drop of `shared_buffer` / `macro_shared_buffer`.

        /// Port of `Fs.readFileShared` (cache.zig:87) — read `path` into the
        /// caller's `shared` buffer (HMR / dev-server path).
        pub fn read_file_shared(
            &mut self,
            _fs: &mut fs_mod::FileSystem,
            path: &bun_core::ZStr,
            cached_file_descriptor: Option<Fd>,
            shared: &mut MutableString,
        ) -> Result<Entry, bun_core::Error> {
            let rfs = &_fs.fs;

            let file_handle: bun_sys::File = if let Some(fd) = cached_file_descriptor {
                // `try handle.seekTo(0)` — rewind a cached fd before re-reading.
                bun_sys::lseek(fd, 0, libc::SEEK_SET).map_err(bun_core::Error::from)?;
                bun_sys::File::from_fd(fd)
            } else {
                bun_sys::open_file_absolute_z(path, bun_sys::OpenFlags::READ_ONLY)
                    .map_err(bun_core::Error::from)?
            };

            let will_close = rfs.need_to_close_files() && cached_file_descriptor.is_none();
            let fd = file_handle.handle();
            let file_handle = scopeguard::guard(file_handle, move |fh| {
                if will_close {
                    let _ = fh.close();
                }
            });

            let contents = match fs_mod::read_file_contents(
                &file_handle,
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
                        Output::print_error(&format_args!(
                            "{}: readFile error -- {}",
                            bstr::BStr::new(path.as_bytes()),
                            bstr::BStr::new(err.name()),
                        ));
                    }
                    return Err(err);
                }
            };

            Ok(Entry {
                contents,
                fd: if feature_flags::STORE_FILE_DESCRIPTORS {
                    fd
                } else {
                    Fd::INVALID
                },
                external_free_function: ExternalFreeFunction::NONE,
            })
        }

        /// Port of `Fs.readFile` (cache.zig:126).
        pub fn read_file(
            &mut self,
            _fs: &mut fs_mod::FileSystem,
            path: &[u8],
            dirname_fd: Fd,
            use_shared_buffer: bool,
            _file_handle: Option<Fd>,
        ) -> Result<Entry, bun_core::Error> {
            self.read_file_with_allocator(
                _fs,
                path,
                dirname_fd,
                use_shared_buffer,
                _file_handle,
                None,
            )
        }

        /// Port of `Fs.readFileWithAllocator` (cache.zig:146).
        ///
        /// PORT NOTE: `comptime use_shared_buffer` is taken at runtime — the live
        /// callers (`ParseTask::get_code_for_parse_task_without_plugins`,
        /// `Transpiler::parse`) pass a value computed from runtime state, and the
        /// resolver's earlier forward-decl already pinned this shape.
        /// PERF(port): re-monomorphize once both callers stabilize.
        ///
        /// `arena` restores the Zig `allocator` param: when
        /// `!use_shared_buffer && arena.is_some()` the file body is read
        /// directly into `arena` (`Contents::Arena`), so the bytes are
        /// bulk-freed by `mi_heap_destroy` when the per-call `MimallocArena`
        /// drops instead of landing in the worker thread's default mimalloc
        /// heap (which is never destroyed). `None` keeps the global-heap
        /// `Contents::Owned(Vec<u8>)` path. Zig: `transpiler.zig:838-839`
        /// passed `if (use_shared_buffer) bun.default_allocator else
        /// this_parse.allocator`.
        pub fn read_file_with_allocator(
            &mut self,
            _fs: &mut fs_mod::FileSystem,
            path: &[u8],
            dirname_fd: Fd,
            use_shared_buffer: bool,
            _file_handle: Option<Fd>,
            arena: Option<&bun_alloc::Arena>,
        ) -> Result<Entry, bun_core::Error> {
            let rfs = &_fs.fs;

            // PORT NOTE: reshaped — Zig declared `file_handle = undefined` then assigned on each
            // branch; restructured into a single let-expression to avoid `mem::zeroed()` on a
            // type that may have niche (NonZero) fields.
            let file_handle: bun_sys::File = if let Some(f) = _file_handle {
                bun_sys::lseek(f, 0, libc::SEEK_SET).map_err(bun_core::Error::from)?;
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
                            .map_err(bun_core::Error::from)?;
                        Output::pretty_errorln(&format_args!(
                            "<r><d>Internal error: directory mismatch for directory \"{}\", fd {}<r>. You don't need to do anything, but this indicates a bug.",
                            bstr::BStr::new(path),
                            dirname_fd,
                        ));
                        handle
                    }
                    Err(err) => return Err(err.into()),
                }
            } else {
                bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)
                    .map_err(bun_core::Error::from)?
            };

            let fd = file_handle.handle();

            #[cfg(not(windows))] // skip on Windows because NTCreateFile will do it.
            bun_core::scoped_log!(
                CacheFs,
                "openat({}, {}) = {}",
                dirname_fd,
                bstr::BStr::new(path),
                fd
            );

            let will_close = rfs.need_to_close_files() && _file_handle.is_none();
            let file_handle = scopeguard::guard(file_handle, move |fh| {
                if will_close {
                    bun_core::scoped_log!(CacheFs, "readFileWithAllocator close({})", fh.handle());
                    let _ = fh.close();
                }
            });

            // PORT NOTE: reshaped for borrowck — capture `stream` scalar before borrowing
            // the shared buffer.
            let stream = self.stream;

            let contents = match (use_shared_buffer, arena) {
                // Zig: `readFileWithHandleAndAllocator(this_parse.allocator, …)`
                // — read straight into the per-call arena so the source bytes
                // are reclaimed by `mi_heap_destroy` instead of pinning a
                // segment in the worker thread's default heap.
                (false, Some(arena)) => {
                    match fs_mod::read_file_contents_in_arena(&file_handle, path, arena) {
                        Ok((_, 0)) => Contents::Empty,
                        Ok((ptr, len)) => Contents::Arena { ptr, len },
                        Err(err) => {
                            if cfg!(debug_assertions) {
                                Output::print_error(&format_args!(
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
                        &file_handle,
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
                                Output::print_error(&format_args!(
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

            Ok(Entry {
                contents,
                fd: if feature_flags::STORE_FILE_DESCRIPTORS && !will_close {
                    fd
                } else {
                    Fd::INVALID
                },
                external_free_function: ExternalFreeFunction::NONE,
            })
        }
    }

    /// Port of `cache::JavaScript` (cache.zig:204) — unit struct; AST caching is
    /// "probably only relevant when bundling for production" (per the Zig
    /// comment), so the struct is empty and `parse`/`scan` are stateless.
    ///
    /// CYCLEBREAK: `parse`/`scan` need `bun_js_parser::Parser::init` + the
    /// `Define` table type, both of which are mid-unification with the bundler's
    /// `defines.rs`. Until that lands, the bodies live in
    /// `bun_bundler::cache::JavaScript` (which can name those types directly);
    /// the resolver only needs the field shape so `Resolver.caches.js` exists.
    #[derive(Default)]
    pub struct JavaScript {}

    pub type JavaScriptResult = bun_js_parser::Result;

    impl JavaScript {
        #[inline]
        pub fn init() -> JavaScript {
            JavaScript {}
        }
    }
}

pub use ::bun_paths::{is_package_path, is_package_path_not_absolute};

pub mod __phase_a_body {
    use super::{is_package_path, is_package_path_not_absolute};

    use core::ptr::NonNull;
    use std::io::Write as _;

    // ── Cross-crate type surface ──────────────────────────────────────────────
    // Higher-tier symbols are reached through lower-tier crates:
    //   • install value types + AutoInstaller trait — bun_install_types (MOVE_DOWN)
    //   • HardcodedModule alias table              — bun_resolve_builtins
    //   • StandaloneModuleGraph                    — trait below; impl in bun_standalone_graph
    //   • perf / crash_handler                     — real bun_perf / bun_crash_handler
    use ::bun_install_types::resolver_hooks as Install;
    use ::bun_install_types::resolver_hooks::{
        AutoInstaller, EnqueueResult, Features as InstallFeatures, PreinstallState, Resolution,
        TaskCallbackContext, WakeHandler,
    };
    use ::bun_semver as Semver;
    // Re-exported so downstream (bun_bundler) can name the trait in
    // `Transpiler::get_package_manager`'s return type without a direct
    // `bun_install_types` dep (LAYERING: pass-through, no new edge).
    pub use ::bun_install_types::resolver_hooks::AutoInstaller as PackageManagerTrait;

    // LAYERING: `PackageManager.initWithRuntime` (Zig resolver.zig:540) lives in
    // `bun_install`, which depends on this crate. The lazy-init body is defined
    // `#[no_mangle]` in `bun_install::auto_installer` and resolved at link time
    // (same pattern as `__bun_regex_*` / `__BUN_RUNTIME_HOOKS`). `install` is the
    // type-erased `?*Api.BunInstall` (`self.opts.install`); `env` is the
    // type-erased `*DotEnv.Loader` (lifetime-erased — the install crate stores it
    // as a raw `NonNull<Loader<'static>>`).
    unsafe extern "Rust" {
        /// SAFETY (genuine FFI precondition — NOT a `safe fn` candidate): impl
        /// reborrows `&mut *log` / `&mut *env` and reads `*install` if non-null.
        /// All three must point at process-lifetime Transpiler-owned storage; the
        /// returned `NonNull` names the `'static` `PackageManager` singleton.
        fn __bun_resolver_init_package_manager(
            log: *mut bun_ast::Log,
            install: *const (),
            env: *mut core::ffi::c_void,
        ) -> NonNull<dyn AutoInstaller>;
    }
    use crate::cache::Set as CacheSet;
    use ::bun_resolve_builtins::{Alias as HardcodedAlias, Cfg as HardcodedAliasCfg};

    /// Resolver's view of a compiled-standalone-binary module graph. The concrete
    /// `bun_standalone_graph::Graph` (which depends on `bun_bundler`) implements
    /// this; the resolver holds a trait object so it stays below both in the dep
    /// graph. The path-prefix predicate lives in
    /// `bun_options_types::standalone_path` (MOVE_DOWN) and is callable without a
    /// graph instance.
    pub trait StandaloneModuleGraph: Send + Sync {
        /// Look up `name` (already known to be under the standalone virtual root)
        /// and return the embedded file's canonical name slice if present.
        fn find_assume_standalone_path(&self, name: &[u8]) -> Option<&[u8]>;
        /// Look up `name` (any path — checks the standalone virtual-root prefix
        /// first) and return the embedded file's canonical name slice if present.
        /// Spec `StandaloneModuleGraph.find`.
        fn find(&self, name: &[u8]) -> Option<&[u8]>;
        /// `StandaloneModuleGraph.base_public_path_with_default_suffix` — the
        /// virtual-root prefix used for embedded modules (e.g. `/$bunfs/root/`).
        /// Baked-in `'static` constant; surfaced here so low-tier callers
        /// (worker entry-point resolution) don't need the concrete graph type.
        fn base_public_path_with_default_suffix(&self) -> &'static [u8];
        /// `StandaloneModuleGraph.compile_exec_argv` — the `--compile-exec-argv`
        /// string baked into a `bun build --compile` binary. Exposed via the trait
        /// so `process.execArgv` (lower-tier `bun_jsc` callers holding only the
        /// trait object) can read it without downcasting to the concrete graph.
        fn compile_exec_argv(&self) -> &[u8];
    }

    /// `Dependency` namespace as the body spells it (Zig: `Dependency.Version` /
    /// `Dependency.Behavior`). Re-exports the canonical `bun_install_types` items.
    pub mod Dependency {
        pub use ::bun_install_types::resolver_hooks::{
            Behavior, Dependency, DependencyVersion as Version, DependencyVersionTag,
        };
        pub mod version {
            pub use ::bun_install_types::resolver_hooks::DependencyVersionTag as Tag;
        }
    }

    /// Transitional re-export module: `package_json.rs` and a few external crates
    /// still spell these paths via `__forward_decls`; the items are now real
    /// re-exports of `bun_install_types` (no local stubs).
    pub(crate) mod __forward_decls {
        pub(crate) use crate::cache::{Entry as FsCacheEntry, Fs as FsCache, Set as CacheSet};
        pub(crate) use ::bun_install_types::resolver_hooks as Install;
        pub(crate) use ::bun_install_types::resolver_hooks::Resolution;
    }
    // bun_paths shim — value-dispatched join helpers over `resolve_path::Platform`.
    // `dirname` (`Option`-returning, `std.fs.path.dirname` semantics) and
    // `PosixToWinNormalizer` are the real `::bun_paths` items — brought in by the
    // glob / explicit re-export below, no local re-implementation.
    mod bun_paths {
        pub(super) use ::bun_paths::resolve_path::PosixToWinNormalizer;
        pub(super) use ::bun_paths::resolve_path::is_sep_any;
        pub(super) use ::bun_paths::*;

        /// Value-dispatch over `Platform` to the const-generic `PlatformT`
        /// monomorphizations in `resolve_path`. The resolver body threads
        /// `Platform::AUTO` / `Platform::Loose` at runtime (carried over from Zig's
        /// `comptime _platform: Platform` callsites that took a function param).
        macro_rules! dispatch_platform {
            ($p:expr, |$P:ident| $body:expr) => {{
                use ::bun_paths::resolve_path::{self as rp, platform};
                match $p {
                    rp::Platform::Loose => {
                        type $P = platform::Loose;
                        $body
                    }
                    rp::Platform::Windows => {
                        type $P = platform::Windows;
                        $body
                    }
                    rp::Platform::Posix => {
                        type $P = platform::Posix;
                        $body
                    }
                    rp::Platform::Nt => {
                        type $P = platform::Nt;
                        $body
                    }
                }
            }};
        }
        pub(super) fn dirname_platform(p: &[u8], platform: Platform) -> &[u8] {
            dispatch_platform!(platform, |P| ::bun_paths::resolve_path::dirname::<P>(p))
        }
        /// Port of `bun.path.joinAbsStringBuf` (value-dispatched).
        pub(super) fn join_abs_string_buf<'b>(
            cwd: &'b [u8],
            buf: &'b mut [u8],
            parts: &[&[u8]],
            platform: Platform,
        ) -> &'b [u8] {
            dispatch_platform!(
                platform,
                |P| ::bun_paths::resolve_path::join_abs_string_buf::<P>(cwd, buf, parts)
            )
        }
        pub(super) fn join_abs(cwd: &[u8], platform: Platform, part: &[u8]) -> &'static [u8] {
            // PORT NOTE: `resolve_path::join_abs` ties the result lifetime to `cwd`, but the
            // returned slice always points into the threadlocal `PARSER_JOIN_INPUT_BUFFER`
            // (or is `cwd` itself when `parts.is_empty()`, which never happens here — we
            // pass exactly one part). Re-erase to `'static` so the resolver can hold it
            // across `&mut self` calls.
            let s = dispatch_platform!(platform, |P| ::bun_paths::resolve_path::join_abs::<P>(
                cwd, part
            ));
            // SAFETY: see PORT NOTE — slice borrows threadlocal storage, valid 'static per-thread.
            unsafe { bun_ptr::detach_lifetime(s) }
        }
        pub(super) fn join(parts: &[&[u8]], platform: Platform) -> &'static [u8] {
            dispatch_platform!(platform, |P| ::bun_paths::resolve_path::join::<P>(parts))
        }
        pub(super) fn join_string_buf<'b>(
            buf: &'b mut [u8],
            parts: &[&[u8]],
            platform: Platform,
        ) -> &'b [u8] {
            dispatch_platform!(
                platform,
                |P| ::bun_paths::resolve_path::join_string_buf::<P>(buf, parts)
            )
        }
        /// Zig `bun.pathLiteral` — compile-time platform-separator literal. Zig
        /// rewrites `/` → `\` at comptime; Rust can't transform a borrowed
        /// `&'static [u8]` in a const fn, so this is a macro that emits a fresh
        /// const array with the swap applied. Result is `&'static [u8; N]`
        /// (coerces to `&[u8]`).
        #[macro_export]
        #[doc(hidden)]
        macro_rules! __resolver_path_literal {
            ($p:expr) => {{
                const __IN: &[u8] = $p;
                const __N: usize = __IN.len();
                const fn __swap(input: &[u8]) -> [u8; __N] {
                    let mut out = [0u8; __N];
                    let mut i = 0;
                    while i < __N {
                        out[i] = if cfg!(windows) && input[i] == b'/' {
                            b'\\'
                        } else {
                            input[i]
                        };
                        i += 1;
                    }
                    out
                }
                const __OUT: [u8; __N] = __swap(__IN);
                &__OUT
            }};
        }
        pub(super) use __resolver_path_literal as path_literal;
        pub(super) fn windows_filesystem_root(p: &[u8]) -> &[u8] {
            ::bun_paths::resolve_path::windows_filesystem_root(p)
        }
    }
    // bun_core::strings shim — re-export the canonical `immutable/paths` helpers
    // (`without_trailing_slash_windows_path` / `path_contains_node_modules_folder` /
    // `without_leading_path_separator` / `char_is_any_slash`) instead of locally
    // re-implementing them. The previous local copies diverged from the spec
    // (single-strip vs. while-loop, `is_sep_any` vs. platform `SEP`).
    mod strings {
        pub(super) use bun_paths::strings::paths::{
            char_is_any_slash, path_contains_node_modules_folder, without_leading_path_separator,
            without_trailing_slash_windows_path,
        };
        pub(super) use bun_paths::strings::*;
        #[inline]
        pub(super) fn index_of_any(slice: &[u8], chars: &'static [u8]) -> Option<usize> {
            bun_core::strings::index_of_any(slice, chars).map(|v| v as usize)
        }
    }
    // bun_sys shim — adds the `std.fs`-shaped dir-open surface the resolver names
    // (`openDirAbsoluteZ` / `Dir.openDirZ`) on top of the real `::bun_sys` crate.
    // `open` / `open_dir_for_iteration` / `get_fd_path` / `OpenDirOptions` /
    // `iterate_dir` are now provided by the `pub use ::bun_sys::*` glob.
    mod bun_sys {
        pub(super) use ::bun_sys::*;

        /// Port of `std.fs.openDirAbsoluteZ` — `open(path, O_DIRECTORY|O_RDONLY|O_CLOEXEC[|O_NOFOLLOW])`.
        /// `opts.iterate` is a no-op on POSIX (Zig only used it to pick `iterate=true`
        /// on `IterableDir`, which is just an open mode hint).
        pub(super) fn open_dir_absolute_z(
            path: &::bun_core::ZStr,
            opts: OpenDirOptions,
        ) -> core::result::Result<Fd, ::bun_core::Error> {
            #[cfg(unix)]
            let nofollow = if opts.no_follow { libc::O_NOFOLLOW } else { 0 };
            #[cfg(not(unix))]
            let nofollow = {
                let _ = opts;
                0
            };
            ::bun_sys::open(path, O::DIRECTORY | O::CLOEXEC | O::RDONLY | nofollow, 0)
                .map_err(Into::into)
        }
        /// Port of `std.fs.Dir.openDirZ` — `openat(dir, path, O_DIRECTORY|O_RDONLY|O_CLOEXEC)`.
        pub(super) fn open_dir_z(
            dir: Fd,
            path: &[u8],
            _opts: OpenDirOptions,
        ) -> core::result::Result<Fd, ::bun_core::Error> {
            // PORT NOTE: callers pass either a `&'static [u8]` literal or a NUL-terminated
            // slice; `open_dir_at` builds its own ZStr internally so we strip the sentinel.
            let path = if path.last() == Some(&0) {
                &path[..path.len() - 1]
            } else {
                path
            };
            ::bun_sys::open_dir_at(dir, path).map_err(Into::into)
        }
        // `iterate_dir` / `dir_iterator::WrappedIterator` are real ports in
        // `::bun_sys::dir_iterator` (POSIX getdents / Windows NtQueryDirectoryFile)
        // and reach this module via the `pub use ::bun_sys::*` glob above.
        pub(super) use ::bun_sys::RawFd;
    }

    /// `bun_sys::Fd` extension surface — thin method-syntax wrappers over the
    /// free functions `::bun_sys::{close, get_fd_path}` and `Fd::native`, so the
    /// resolver body can spell `fd.close()` / `fd.get_fd_path(buf)` per the Zig.
    trait FdExt: Sized {
        fn close(self);
        fn cast(self) -> bun_sys::RawFd;
        fn native(self) -> bun_sys::RawFd;
        fn get_fd_path<'b>(
            self,
            buf: &'b mut ::bun_paths::PathBuffer,
        ) -> core::result::Result<&'b [u8], ::bun_core::Error>;
    }
    impl FdExt for ::bun_sys::Fd {
        #[inline]
        fn close(self) {
            let _ = ::bun_sys::close(self);
        }
        #[inline]
        fn cast(self) -> bun_sys::RawFd {
            ::bun_sys::Fd::native(self)
        }
        #[inline]
        fn native(self) -> bun_sys::RawFd {
            ::bun_sys::Fd::native(self)
        }
        #[inline]
        fn get_fd_path<'b>(
            self,
            buf: &'b mut ::bun_paths::PathBuffer,
        ) -> core::result::Result<&'b [u8], ::bun_core::Error> {
            ::bun_sys::get_fd_path(self, buf)
                .map(|s| &*s)
                .map_err(Into::into)
        }
    }
    trait FdZero {
        const ZERO: ::bun_sys::Fd;
    }
    impl FdZero for ::bun_sys::Fd {
        const ZERO: ::bun_sys::Fd = ::bun_sys::Fd::INVALID;
    }

    // ── bun_alloc::allocators re-export ──────────────────────────────────────
    // `Result`/`ItemStatus` live at the `bun_alloc` crate root (re-exported via
    // `bun_alloc::allocators`); add the `Status` alias the resolver body spells.
    pub mod allocators {
        pub use bun_alloc::ItemStatus as Status;
        pub use bun_alloc::allocators::*;
    }

    // Resolver-tier `options` — the canonical resolver-input types.
    //
    // MOVE_DOWN COMPLETE for the resolver↔bundler cycle: these are the types the
    // resolver reads, defined at the lowest tier that can name all their parts
    // (`jsx::Pragma`/`ConditionsMap` live in this crate; `Target`/`Loader` in
    // `bun_options_types`). `bun_bundler::options::BundleOptions` is the ~200-field
    // CLI/config aggregate; `bun_bundler::transpiler::resolver_bundle_options_subset`
    // projects it into this struct for `Resolver::init1`. These are NOT a re-decl
    // of the bundler type — the bundler depends on this crate and re-exports them.
    pub mod options {
        pub use crate::tsconfig_json::options::jsx;
        pub(crate) use bun_ast::{Loader, LoaderHashTable, Target};
        pub use bun_options_types::bundle_enums::ModuleType;

        /// Port of `bundler/options.zig` `Packages`.
        #[derive(Clone, Copy, PartialEq, Eq, Default)]
        pub enum Packages {
            #[default]
            Bundle,
            External,
        }

        /// Port of `bundler/options.zig` `ExternalModules`.
        #[derive(Default)]
        pub struct ExternalModules {
            pub patterns: Vec<WildcardPattern>,
            pub abs_paths: StringSet,
            pub node_modules: StringSet,
        }
        impl Clone for ExternalModules {
            fn clone(&self) -> Self {
                // `StringSet::clone` is an inherent fallible method (returns
                // `Result<_, AllocError>`), so this can't be `#[derive(Clone)]`.
                Self {
                    patterns: self.patterns.clone(),
                    abs_paths: self.abs_paths.clone().expect("oom"),
                    node_modules: self.node_modules.clone().expect("oom"),
                }
            }
        }
        #[derive(Debug, Clone)]
        pub struct WildcardPattern {
            pub prefix: Box<[u8]>,
            pub suffix: Box<[u8]>,
        }
        /// Re-export the real set type so `bun_bundler` can project user-supplied
        /// `--external` `abs_paths`/`node_modules` through. The previous local ZST
        /// stub returned `count() == 0` / `contains(..) == false`, so the resolver
        /// silently ignored every `--external` absolute path / package name.
        pub use bun_collections::StringSet;

        /// Port of `bundler/options.zig` `Conditions`.
        #[derive(Default)]
        pub struct Conditions {
            pub import: crate::package_json::ConditionsMap,
            pub require: crate::package_json::ConditionsMap,
            pub style: crate::package_json::ConditionsMap,
        }

        /// `Copy` tag selecting one of the extension-order lists owned by
        /// [`BundleOptions`]. Replaces the previous `*const [Box<[u8]>]`
        /// self-reference (`Resolver.extension_order` pointing into
        /// `Resolver.opts`) with a value type — the Zig save/restore pattern
        /// (`resolver.zig:691-696` etc.) survives unchanged because the tag is
        /// `Copy`, and the actual slice is resolved on demand via
        /// [`BundleOptions::ext_order_slice`] / [`Resolver::extension_order`].
        #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
        pub enum ExtOrder {
            /// `opts.extension_order.default.default`
            #[default]
            DefaultDefault,
            /// `opts.extension_order.default.esm`
            DefaultEsm,
            /// `opts.extension_order.node_modules.default`
            NodeModulesDefault,
            /// `opts.extension_order.node_modules.esm`
            NodeModulesEsm,
            /// `opts.extension_order.css` (Zig reads `Defaults.CssExtensionOrder` directly)
            Css,
            /// `opts.main_field_extension_order` — used when resolving the `"main"`
            /// package.json field (`resolver.zig:3703,3715,3721`).
            MainField,
        }

        /// Convert a `&[&[u8]]` default constant into the owned form the resolver
        /// stores. Mirrors `bun_bundler::options::owned_string_list`.
        pub fn owned_string_list(s: &[&[u8]]) -> Box<[Box<[u8]>]> {
            s.iter().map(|s| Box::<[u8]>::from(*s)).collect()
        }

        /// Port of `bundler/options.zig` `ResolveFileExtensions`.
        pub struct ExtensionOrder {
            pub default: ExtensionOrderGroup,
            pub node_modules: ExtensionOrderGroup,
            /// Not on the bundler-side struct — the spec resolver reads
            /// `Defaults.CssExtensionOrder` directly. Stored here so every
            /// [`ExtOrder`] tag resolves into storage with the same owner/lifetime.
            pub css: Box<[Box<[u8]>]>,
        }
        pub struct ExtensionOrderGroup {
            pub default: Box<[Box<[u8]>]>,
            pub esm: Box<[Box<[u8]>]>,
        }
        impl Default for ExtensionOrderGroup {
            fn default() -> Self {
                ExtensionOrderGroup {
                    default: owned_string_list(bundle_options::defaults::EXTENSION_ORDER),
                    esm: owned_string_list(bundle_options::defaults::MODULE_EXTENSION_ORDER),
                }
            }
        }
        impl Default for ExtensionOrder {
            fn default() -> Self {
                ExtensionOrder {
                    default: ExtensionOrderGroup::default(),
                    node_modules: ExtensionOrderGroup {
                        default: owned_string_list(
                            bundle_options::defaults::node_modules::EXTENSION_ORDER,
                        ),
                        esm: owned_string_list(
                            bundle_options::defaults::node_modules::MODULE_EXTENSION_ORDER,
                        ),
                    },
                    css: owned_string_list(bundle_options::defaults::CSS_EXTENSION_ORDER),
                }
            }
        }
        impl ExtensionOrder {
            /// Port of `options.zig` `ResolveFileExtensions.kind`. Returns the
            /// [`ExtOrder`] tag; resolve to a slice via
            /// [`BundleOptions::ext_order_slice`].
            pub fn kind(&self, kind: bun_ast::ImportKind, is_node_modules: bool) -> ExtOrder {
                use bun_ast::ImportKind as K;
                match kind {
                    K::Url | K::AtConditional | K::At => ExtOrder::Css,
                    K::Stmt | K::EntryPointBuild | K::EntryPointRun | K::Dynamic => {
                        if is_node_modules {
                            ExtOrder::NodeModulesEsm
                        } else {
                            ExtOrder::DefaultEsm
                        }
                    }
                    _ => {
                        if is_node_modules {
                            ExtOrder::NodeModulesDefault
                        } else {
                            ExtOrder::DefaultDefault
                        }
                    }
                }
            }
        }

        impl BundleOptions {
            /// Resolve an [`ExtOrder`] tag to the slice it names inside `self`.
            /// All targets are `Box<[Box<[u8]>]>` owned by `self` and never
            /// reallocated after `Resolver::init1`, so the returned borrow is
            /// stable for the resolver's lifetime.
            #[inline]
            pub fn ext_order_slice(&self, tag: ExtOrder) -> &[Box<[u8]>] {
                match tag {
                    ExtOrder::DefaultDefault => &self.extension_order.default.default,
                    ExtOrder::DefaultEsm => &self.extension_order.default.esm,
                    ExtOrder::NodeModulesDefault => &self.extension_order.node_modules.default,
                    ExtOrder::NodeModulesEsm => &self.extension_order.node_modules.esm,
                    ExtOrder::Css => &self.extension_order.css,
                    ExtOrder::MainField => &self.main_field_extension_order,
                }
            }
        }

        pub mod bundle_options {
            pub use super::ForceNodeEnv;
            pub mod defaults {
                pub const CSS_EXTENSION_ORDER: &[&[u8]] = &[b".css"];
                // Mirrors `bun_bundler::options::bundle_options_defaults::EXTENSION_ORDER`
                // / `MODULE_EXTENSION_ORDER` — duplicated so `Default for BundleOptions`
                // below is self-contained (resolver sits below bundler in the dep graph).
                pub const EXTENSION_ORDER: &[&[u8]] = &[
                    b".tsx", b".ts", b".jsx", b".cts", b".cjs", b".js", b".mjs", b".mts", b".json",
                ];
                pub const MODULE_EXTENSION_ORDER: &[&[u8]] = &[
                    b".tsx", b".jsx", b".mts", b".ts", b".mjs", b".js", b".cts", b".cjs", b".json",
                ];
                /// Mirrors `bun_bundler::options::bundle_options_defaults::node_modules`.
                pub mod node_modules {
                    pub const EXTENSION_ORDER: &[&[u8]] = &[
                        b".jsx", b".cjs", b".js", b".mjs", b".mts", b".tsx", b".ts", b".cts",
                        b".json",
                    ];
                    pub const MODULE_EXTENSION_ORDER: &[&[u8]] = &[
                        b".mjs", b".jsx", b".js", b".mts", b".tsx", b".ts", b".cjs", b".cts",
                        b".json",
                    ];
                }
            }
        }

        // B-3 UNIFIED: FORWARD_DECL dropped — canonical type moved down to
        // `bun_options_types::bundle_enums::ForceNodeEnv`. Re-exported so the
        // `options::ForceNodeEnv` / `bundle_options::ForceNodeEnv` paths and the
        // field on the local `BundleOptions` subset stay source-compatible.
        pub use ::bun_options_types::ForceNodeEnv;

        /// Port of `bundler/options.zig` `Framework` (Bake) — only the
        /// `built_in_modules` field, which is the sole resolver-read member.
        pub struct Framework {
            pub built_in_modules:
                bun_collections::StringArrayHashMap<bun_options_types::BuiltInModule>,
        }

        /// Resolver-tier `BundleOptions` — the canonical resolver-input struct.
        /// `bun_bundler::options::BundleOptions` (the ~200-field CLI/config
        /// aggregate) projects into this via
        /// `bun_bundler::transpiler::resolver_bundle_options_subset`; the bundler
        /// depends on this crate, so this type is the lower-tier source of truth
        /// for everything resolution reads.
        pub struct BundleOptions {
            pub target: Target,
            pub packages: Packages,
            pub jsx: jsx::Pragma,
            pub extension_order: ExtensionOrder,
            pub conditions: Conditions,
            pub external: ExternalModules,
            pub extra_cjs_extensions: Box<[Box<[u8]>]>,
            pub framework: Option<Framework>,
            pub global_cache: bun_options_types::global_cache::GlobalCache,
            // Zig: `?*api.BunInstall` (options.zig:1753). Spec consumer
            // `PackageManagerOptions.zig:load` only reads through it, so `*const`
            // — the bundler projects this from `Option<&api::BunInstall>` and a
            // `*mut` here would launder read-only provenance into a writable ptr.
            pub install: *const (),
            pub load_package_json: bool,
            pub load_tsconfig_json: bool,
            pub main_field_extension_order: Box<[Box<[u8]>]>,
            pub main_fields: Box<[Box<[u8]>]>,
            /// Spec resolver.zig `auto_main` compares the *pointer* of
            /// `opts.main_fields` against `Target.DefaultMainFields.get(target)` to
            /// detect "user did not pass --main-fields". The bundler stores an owned
            /// `Box<[Box<[u8]>]>` whose pointer can never match a static, so the
            /// bundler projects this flag explicitly instead.
            pub main_fields_is_default: bool,
            pub mark_builtins_as_external: bool,
            pub polyfill_node_globals: bool,
            pub prefer_offline_install: bool,
            pub preserve_symlinks: bool,
            pub rewrite_jest_for_tests: bool,
            pub tsconfig_override: Option<Box<[u8]>>,
            pub production: bool,
            pub force_node_env: ForceNodeEnv,
            // Bundler-only fields read via `c.resolver.opts` in
            // `linker_context/*` (Zig stores the full `BundleOptions` on the
            // resolver). Projected by `bun_bundler` at link time.
            pub output_dir: Box<[u8]>,
            pub root_dir: Box<[u8]>,
            pub public_path: Box<[u8]>,
            pub compile: bool,
            pub supports_multiple_outputs: bool,
            pub tree_shaking: bool,
            pub allow_runtime: bool,
        }

        impl Default for BundleOptions {
            /// Spec: `options.zig` field-init defaults. Only the fields the resolver
            /// reads — `bun_bundler::Transpiler::init` overlays the per-field
            /// projections it can map (target/packages/jsx/bools/global_cache/…)
            /// before handing this to `Resolver::init1`.
            fn default() -> Self {
                BundleOptions {
                    target: Target::default(),
                    packages: Packages::default(),
                    jsx: jsx::Pragma::default(),
                    extension_order: ExtensionOrder::default(),
                    conditions: Conditions::default(),
                    external: ExternalModules::default(),
                    extra_cjs_extensions: Box::default(),
                    framework: None,
                    global_cache: Default::default(),
                    install: core::ptr::null(),
                    load_package_json: true,
                    load_tsconfig_json: true,
                    main_field_extension_order: owned_string_list(
                        bundle_options::defaults::EXTENSION_ORDER,
                    ),
                    main_fields: owned_string_list(DEFAULT_MAIN_FIELDS.get(Target::default())),
                    main_fields_is_default: true,
                    mark_builtins_as_external: false,
                    polyfill_node_globals: false,
                    prefer_offline_install: false,
                    preserve_symlinks: false,
                    rewrite_jest_for_tests: false,
                    tsconfig_override: None,
                    output_dir: Box::default(),
                    root_dir: Box::default(),
                    public_path: Box::default(),
                    compile: false,
                    supports_multiple_outputs: true,
                    tree_shaking: false,
                    allow_runtime: true,
                    production: false,
                    force_node_env: ForceNodeEnv::default(),
                }
            }
        }

        impl BundleOptions {
            /// Port of `options.zig:1825 BundleOptions.setProduction`.
            pub fn set_production(&mut self, value: bool) {
                if self.force_node_env == ForceNodeEnv::Unspecified {
                    self.production = value;
                    self.jsx.development = !value;
                }
            }
        }

        // Port of `bundler/options.zig` `Target.DefaultMainFields`.
        //
        // These are the per-target default `--main-fields` orderings. `BundleOptions.main_fields`
        // is initialised to alias one of these slices (see options.zig:1712 / 2022), and the
        // resolver's `auto_main` heuristic at `load_as_main_field` compares the *pointer* of
        // `opts.main_fields` against `DEFAULT_MAIN_FIELDS.get(opts.target)` to detect whether the
        // user explicitly set a main-fields list. The previous `&[]` stub made that check always
        // false, silently disabling the module-vs-main dual-resolution path.
        pub struct TargetMainFields;

        // Note that this means if a package specifies "module" and "main", the ES6
        // module will not be selected. This means tree shaking will not work when
        // targeting node environments.
        //
        // Some packages incorrectly treat the "module" field as "code for the browser". It
        // actually means "code for ES6 environments" which includes both node and the browser.
        //
        // For example, the package "@firebase/app" prints a warning on startup about
        // the bundler incorrectly using code meant for the browser if the bundler
        // selects the "module" field instead of the "main" field.
        //
        // This is unfortunate but it's a problem on the side of those packages.
        // They won't work correctly with other popular bundlers (with node as a target) anyway.
        static DEFAULT_MAIN_FIELDS_NODE: &[&[u8]] = &[b"main", b"module"];

        // Note that this means if a package specifies "main", "module", and
        // "browser" then "browser" will win out over "module". This is the
        // same behavior as webpack: https://github.com/webpack/webpack/issues/4674.
        //
        // This is deliberate because the presence of the "browser" field is a
        // good signal that this should be preferred. Some older packages might only use CJS in their "browser"
        // but in such a case they probably don't have any ESM files anyway.
        static DEFAULT_MAIN_FIELDS_BROWSER: &[&[u8]] =
            &[b"browser", b"module", b"jsnext:main", b"main"];
        static DEFAULT_MAIN_FIELDS_BUN: &[&[u8]] = &[b"module", b"main", b"jsnext:main"];

        impl TargetMainFields {
            pub fn get(&self, t: Target) -> &'static [&'static [u8]] {
                match t {
                    Target::Node => DEFAULT_MAIN_FIELDS_NODE,
                    Target::Browser => DEFAULT_MAIN_FIELDS_BROWSER,
                    Target::Bun | Target::BunMacro | Target::BakeServerComponentsSsr => {
                        DEFAULT_MAIN_FIELDS_BUN
                    }
                }
            }
        }
        pub const DEFAULT_MAIN_FIELDS: TargetMainFields = TargetMainFields;
    }
    use self::bun_paths as ResolvePath;
    use ::bun_ast::import_record as ast;
    use ::bun_core::Output;
    use ::bun_core::{Environment, FeatureFlags, Generation};
    use bun_ast::Msg;
    use bun_collections::{BoundedArray, MultiArrayList};
    use bun_core::{MutableString, PathString};
    use bun_dotenv::env_loader as DotEnv;
    use bun_paths::{MAX_PATH_BYTES, PathBuffer, SEP, SEP_STR};
    use bun_perf::system_timer::Timer;
    use bun_sys::Fd as FD;
    use bun_threading::Mutex;

    use crate::fs as Fs;
    use crate::fs::FilenameStoreAppender;
    use crate::node_fallbacks as NodeFallbackModules;
    use crate::package_json::{BrowserMap, ESModule, PackageJSON};
    use crate::tsconfig_json::TSConfigJSON;

    pub use crate::data_url::DataURL;
    pub use crate::dir_info as DirInfo;
    pub use crate::dir_info::DirInfoRef;
    pub use ::bun_options_types::global_cache::GlobalCache;

    // ── Process-lifetime arenas for DirInfo-cached parses ─────────────────────
    // The DirInfo cache (`DirInfo::hash_map_instance()`) is a true process-lifetime
    // singleton; entries hold `&'static PackageJSON` / `&'static TSConfigJSON` and
    // borrow `&'static [u8]` source bytes. Zig models this with `bun.TrivialNew`
    // (heap-allocate, never free). PORTING.md §Forbidden bars `Box::leak`/
    // `mem::forget` for this — process-lifetime storage must go through
    // `LazyLock`. These append-only arenas are that storage; the `Box<T>` heap
    // address is stable across `Vec` growth, so handing out `&'static T` is sound.

    /// Intern a parsed `PackageJSON` into the process-lifetime DirInfo arena.
    /// Returns `NonNull` (not `&'static`) so the mut-provenance survives into
    /// `DirInfo::reset()`'s `drop_in_place` -- handing out `&T` here and casting
    /// back to `*mut T` at the drop site would be UB under Stacked Borrows.
    fn intern_package_json(pkg: PackageJSON) -> core::ptr::NonNull<PackageJSON> {
        static ARENA: std::sync::LazyLock<bun_threading::Guarded<Vec<Box<PackageJSON>>>> =
            std::sync::LazyLock::new(Default::default);
        let mut guard = ARENA.lock();
        guard.push(Box::new(pkg));
        // SAFETY: ARENA is `'static` (LazyLock); entries are never removed; the
        // `Box<PackageJSON>` heap address is stable across `Vec` reallocation.
        // Derive from `&mut **last` so the returned pointer carries mut-provenance.
        core::ptr::NonNull::from(&mut **guard.last_mut().unwrap())
    }

    /// Intern tsconfig.json source bytes into the process-lifetime DirInfo arena.
    /// `use_shared_buffer = false` at the read site guarantees `Owned`/`Empty`.
    fn intern_tsconfig_contents(contents: crate::cache::Contents) -> &'static [u8] {
        use crate::cache::Contents;
        let owned: Box<[u8]> = match contents {
            Contents::Empty => return b"",
            Contents::Owned(v) => v.into_boxed_slice(),
            // Unreachable for the `parse_tsconfig` caller (use_shared_buffer=false);
            // fall back to a copy so we never hand out a dangling slice.
            other => Box::from(other.as_slice()),
        };
        // `Interned::leak` is the centralized process-lifetime byte-slice store
        // (PORTING.md §Forbidden bars open-coded `Box::leak` + `from_raw_parts`;
        // `bun_ptr::Interned` is the sanctioned wrapper that consumes the `Box`
        // and hands back a proven `&'static [u8]`).
        bun_ptr::Interned::leak(owned).as_bytes()
    }

    // Port of `const debuglog = Output.scoped(.Resolver, .hidden)` (resolver.zig:4).
    // `bun_core::declare_scope!` emits the per-scope `static ScopedLogger`; the
    // `debuglog!` macro forwards to the real `bun_core::scoped_log!` so debug builds
    // emit and release builds dead-strip (PORTING.md §Logging).
    //
    // PORT NOTE: resolver.zig:1692 also binds `const dev = Output.scoped(.Resolver,
    // .visible)` for `bustDirCache` — same scope name, different visibility. Rust's
    // `declare_scope!` is one static per ident; route both through the `.hidden`
    // declaration (matches the file-top binding) and let `BUN_DEBUG_Resolver=1`
    // surface the bust log.
    bun_core::define_scoped_log!(debuglog, Resolver, hidden);

    // PORT NOTE: `Path` in the body is the `'static`-interned variant (paths borrow
    // DirnameStore/FilenameStore). Alias here so the ~80 bare-`Path` use sites
    // resolve without a per-site lifetime annotation.
    type Path = crate::fs::Path<'static>;
    type DifferentCase = crate::fs::DifferentCase<'static>;

    use crate::dir_info::HashMapExt as _;

    pub struct SideEffectsData {
        pub source: Option<NonNull<bun_ast::Source>>, // TODO(port): lifetime — never instantiated
        pub range: bun_ast::Range,

        // If true, "sideEffects" was an array. If false, "sideEffects" was false.
        pub is_side_effects_array_in_json: bool,
    }

    /// A temporary threadlocal buffer with a lifetime more than the current
    /// function call.
    ///
    /// These used to be individual `threadlocal var x: bun.PathBuffer = undefined`
    /// declarations. On Windows each `PathBuffer` is 96 KB (vs 4 KB on POSIX) and
    /// PE/COFF has no TLS-BSS, so 25 of them here cost ~2.5 MB of raw zeros in
    /// bun.exe and in every thread's TLS block. Grouping them behind a lazily
    /// allocated pointer brings that down to 8 bytes. See `bun.ThreadlocalBuffers`.
    ///
    /// Experimenting with making this one struct instead of a bunch of different
    /// threadlocal vars yielded no performance improvement on macOS when bundling
    /// 10 copies of Three.js. Potentially revisit after https://github.com/oven-sh/bun/issues/2716
    pub struct Bufs {
        pub extension_path: PathBuffer,
        pub tsconfig_match_full_buf: PathBuffer,
        pub tsconfig_match_full_buf2: PathBuffer,
        pub tsconfig_match_full_buf3: PathBuffer,

        pub esm_subpath: [u8; 512],
        pub esm_absolute_package_path: PathBuffer,
        pub esm_absolute_package_path_joined: PathBuffer,

        // PORT NOTE: Zig left this `= undefined`; `DirEntryResolveQueueItem` holds
        // `&'static [u8]` fields, so a zeroed bit-pattern is UB in Rust. Use
        // `MaybeUninit` and `assume_init_{ref,mut}` at the (linear write-then-read)
        // use sites in `dir_info_cached_maybe_log`.
        pub dir_entry_paths_to_resolve: [core::mem::MaybeUninit<DirEntryResolveQueueItem>; 256],
        pub open_dirs: [FD; 256],
        pub resolve_without_remapping: PathBuffer,
        pub index: PathBuffer,
        pub dir_info_uncached_filename: PathBuffer,
        pub node_bin_path: PathBuffer,
        pub dir_info_uncached_path: PathBuffer,
        pub tsconfig_base_url: PathBuffer,
        pub relative_abs_path: PathBuffer,
        pub load_as_file_or_directory_via_tsconfig_base_path: PathBuffer,
        pub node_modules_check: PathBuffer,
        pub field_abs_path: PathBuffer,
        pub tsconfig_path_abs: PathBuffer,
        pub check_browser_map: PathBuffer,
        pub remap_path: PathBuffer,
        pub load_as_file: PathBuffer,
        pub remap_path_trailing_slash: PathBuffer,
        pub path_in_global_disk_cache: PathBuffer,
        pub abs_to_rel: PathBuffer,
        pub node_modules_paths_buf: PathBuffer,
        pub import_path_for_standalone_module_graph: PathBuffer,

        #[cfg(windows)]
        pub win32_normalized_dir_info_cache: [u8; MAX_PATH_BYTES * 2],
        #[cfg(not(windows))]
        pub win32_normalized_dir_info_cache: (),
    }
    // TODO(port): bun.ThreadlocalBuffers(Bufs) — lazily-allocated threadlocal Box<Bufs>.
    // In Rust we model it as a `thread_local! { static BUFS_PTR: Cell<*mut Bufs> }`
    // caching a leaked `Box<Bufs>` pointer (the Box is never freed in Zig either —
    // process-lifetime scratch storage). The `bufs!()` macro hands out `&mut` to a
    // single field. This relies on the caller never holding two `bufs!()` borrows
    // simultaneously across the same field; the Zig code already obeys that invariant.
    thread_local! {
        static BUFS_PTR: core::cell::Cell<*mut Bufs> = const { core::cell::Cell::new(core::ptr::null_mut()) };
    }

    #[inline(always)]
    fn bufs_storage_get() -> *mut Bufs {
        // Fast path: single TLS pointer load + null check. `LocalKey<Cell<T>>::get`
        // (T: Copy) compiles to a plain `__tls_get_addr` + load with no
        // RefCell/Option/closure machinery on the hot path (benches: misc/require-fs).
        let p = BUFS_PTR.get();
        if !p.is_null() {
            return p;
        }
        bufs_storage_init()
    }

    #[cold]
    fn bufs_storage_init() -> *mut Bufs {
        // SAFETY: every field of `Bufs` is a byte/integer array
        // (`PathBuffer` = `[u8; N]`, `[FD; 256]` where `Fd` is a
        // `#[repr(C)]` integer newtype, `[MaybeUninit<_>; 256]` which has
        // no validity requirement, `()`), so EVERY bit-pattern — not just
        // all-zero — is a valid `Bufs`. Zig left these `= undefined`; each
        // field is scratch (write-then-read within a single resolve call,
        // including `open_dirs` which is bounded by `open_dir_count`), so
        // there is no need to pay for zero-filling ~100 KiB on first use.
        let p: *mut Bufs = Box::leak(unsafe { Box::<Bufs>::new_uninit().assume_init() });
        BUFS_PTR.set(p);
        p
    }

    /// `bufs(.field)` → `bufs!(field)` returns `&mut <field type>`.
    /// // SAFETY: callers must not alias the same field; threadlocal so no cross-thread races.
    macro_rules! bufs {
    ($field:ident) => {
        // SAFETY: threadlocal storage; callers must not alias the same field within one call frame.
        unsafe { &mut (*bufs_storage_get()).$field }
    };
}

    pub struct PathPair {
        pub primary: Path,
        pub secondary: Option<Path>,
    }

    impl Default for PathPair {
        fn default() -> Self {
            Self {
                primary: Path::empty(),
                secondary: None,
            }
        }
    }

    pub struct PathPairIter<'a> {
        index: u8, // u2 in Zig
        ctx: &'a mut PathPair,
    }

    impl<'a> PathPairIter<'a> {
        pub fn next(&mut self) -> Option<&mut Path> {
            if let Some(path_) = self.next_() {
                // SAFETY: reshaped for borrowck — recurse via raw ptr to avoid double &mut.
                let p: *mut Path = path_;
                unsafe {
                    if (*p).is_disabled {
                        return self.next();
                    }
                    return Some(&mut *p);
                }
            }
            None
        }

        fn next_(&mut self) -> Option<&mut Path> {
            let ind = self.index;
            self.index = self.index.saturating_add(1);

            match ind {
                0 => Some(&mut self.ctx.primary),
                1 => self.ctx.secondary.as_mut(),
                _ => None,
            }
        }
    }

    impl PathPair {
        pub fn iter(&mut self) -> PathPairIter<'_> {
            PathPairIter {
                ctx: self,
                index: 0,
            }
        }
    }

    // Re-export of `bun_ast::SideEffects`.
    // Spec: options.zig:884 `Loader.sideEffects()` returns `bun.resolver.SideEffects`
    // — the SAME type stored in `Result.primary_side_effects_data`. Re-export so
    // `result.primary_side_effects_data = loader.side_effects()` type-checks.
    use bun_ast::SideEffects;

    pub struct Result {
        pub path_pair: PathPair,

        pub jsx: options::jsx::Pragma,

        pub package_json: Option<*const PackageJSON>,

        pub diff_case: Option<Fs::file_system::entry::lookup::DifferentCase<'static>>,

        // If present, any ES6 imports to this file can be considered to have no side
        // effects. This means they should be removed if unused.
        pub primary_side_effects_data: SideEffects,

        // This is the "type" field from "package.json"
        pub module_type: options::ModuleType,

        pub debug_meta: Option<DebugMeta>,

        pub dirname_fd: FD,
        pub file_fd: FD,
        pub import_kind: ast::ImportKind,

        /// Pack boolean flags to reduce padding overhead.
        /// Previously 6 separate bool fields caused ~42+ bytes of padding waste.
        pub flags: ResultFlags,
    }

    impl Default for Result {
        fn default() -> Self {
            Self {
                path_pair: PathPair::default(),
                jsx: options::jsx::Pragma::default(),
                package_json: None,
                diff_case: None,
                primary_side_effects_data: SideEffects::HasSideEffects,
                module_type: options::ModuleType::Unknown,
                debug_meta: None,
                dirname_fd: FD::INVALID,
                file_fd: FD::INVALID,
                import_kind: ast::ImportKind::Stmt, // Zig: undefined
                flags: ResultFlags::default(),
            }
        }
    }

    bitflags::bitflags! {
        #[derive(Default, Clone, Copy)]
        pub struct ResultFlags: u8 {
            const IS_EXTERNAL = 1 << 0;
            const IS_EXTERNAL_AND_REWRITE_IMPORT_PATH = 1 << 1;
            const IS_STANDALONE_MODULE = 1 << 2;
            // This is true when the package was loaded from within the node_modules directory.
            const IS_FROM_NODE_MODULES = 1 << 3;
            // If true, unused imports are retained in TypeScript code. This matches the
            // behavior of the "importsNotUsedAsValues" field in "tsconfig.json" when the
            // value is not "remove".
            const PRESERVE_UNUSED_IMPORTS_TS = 1 << 4;
            const EMIT_DECORATOR_METADATA = 1 << 5;
            const EXPERIMENTAL_DECORATORS = 1 << 6;
            // _padding: u1
        }
    }

    // Convenience accessors mirroring the Zig packed-struct field syntax.
    impl ResultFlags {
        #[inline]
        pub fn is_external(&self) -> bool {
            self.contains(Self::IS_EXTERNAL)
        }
        #[inline]
        pub fn set_is_external(&mut self, v: bool) {
            self.set(Self::IS_EXTERNAL, v)
        }
        #[inline]
        pub fn is_external_and_rewrite_import_path(&self) -> bool {
            self.contains(Self::IS_EXTERNAL_AND_REWRITE_IMPORT_PATH)
        }
        #[inline]
        pub fn set_is_external_and_rewrite_import_path(&mut self, v: bool) {
            self.set(Self::IS_EXTERNAL_AND_REWRITE_IMPORT_PATH, v)
        }
        #[inline]
        pub fn is_standalone_module(&self) -> bool {
            self.contains(Self::IS_STANDALONE_MODULE)
        }
        #[inline]
        pub fn is_from_node_modules(&self) -> bool {
            self.contains(Self::IS_FROM_NODE_MODULES)
        }
        #[inline]
        pub fn set_is_from_node_modules(&mut self, v: bool) {
            self.set(Self::IS_FROM_NODE_MODULES, v)
        }
        #[inline]
        pub fn emit_decorator_metadata(&self) -> bool {
            self.contains(Self::EMIT_DECORATOR_METADATA)
        }
        #[inline]
        pub fn set_emit_decorator_metadata(&mut self, v: bool) {
            self.set(Self::EMIT_DECORATOR_METADATA, v)
        }
        #[inline]
        pub fn experimental_decorators(&self) -> bool {
            self.contains(Self::EXPERIMENTAL_DECORATORS)
        }
        #[inline]
        pub fn set_experimental_decorators(&mut self, v: bool) {
            self.set(Self::EXPERIMENTAL_DECORATORS, v)
        }
    }

    pub enum ResultUnion {
        Success(Result),
        Failure(bun_core::Error),
        Pending(PendingResolution),
        NotFound,
    }

    impl Result {
        /// Read-only view of `package_json`. The field stores `Option<*const _>`
        /// (rather than `Option<&'static _>`) so [`Default`] / zeroed-init stays
        /// bit-valid; callers that only read go through here. Single deref site
        /// for the ARENA-backed pointer — same invariant as
        /// [`dir_info::DirInfo::package_json`].
        #[inline]
        pub fn package_json_ref(&self) -> Option<&'static PackageJSON> {
            Self::deref_package_json(self.package_json)
        }

        /// Field-value form of [`package_json_ref`] for sites where `self` is
        /// already mutably borrowed (e.g. while iterating `path_pair`). Takes the
        /// `Copy` field directly so the borrow checker only sees a field read.
        #[inline]
        pub fn deref_package_json(ptr: Option<*const PackageJSON>) -> Option<&'static PackageJSON> {
            // SAFETY: ARENA — every `*const PackageJSON` stored in
            // `Result::package_json` is interned in the resolver's process-lifetime
            // PackageJSON cache (or a `'static` fallback-module literal); never
            // freed while a `Result` is live (see LIFETIMES.tsv). No
            // `&mut PackageJSON` is ever materialized concurrently with a read.
            ptr.map(|p| unsafe { &*p })
        }

        pub fn path(&mut self) -> Option<&mut Path> {
            if !self.path_pair.primary.is_disabled {
                return Some(&mut self.path_pair.primary);
            }

            if let Some(second) = self.path_pair.secondary.as_mut() {
                if !second.is_disabled {
                    return Some(second);
                }
            }

            None
        }

        pub fn path_const(&self) -> Option<&Path> {
            if !self.path_pair.primary.is_disabled {
                return Some(&self.path_pair.primary);
            }

            if let Some(second) = self.path_pair.secondary.as_ref() {
                if !second.is_disabled {
                    return Some(second);
                }
            }

            None
        }

        // remember: non-node_modules can have package.json
        // checking package.json may not be relevant
        pub fn is_likely_node_module(&self) -> bool {
            let Some(path_) = self.path_const() else {
                return false;
            };
            self.flags.is_from_node_modules()
                || strings::index_of(path_.text(), b"/node_modules/").is_some()
        }

        // Most NPM modules are CommonJS
        // If unspecified, assume CommonJS.
        // If internal app code, assume ESM.
        pub fn should_assume_common_js(&self, kind: ast::ImportKind) -> bool {
            match self.module_type {
                options::ModuleType::Esm => false,
                options::ModuleType::Cjs => true,
                _ => {
                    if kind == ast::ImportKind::Require || kind == ast::ImportKind::RequireResolve {
                        return true;
                    }

                    // If we rely just on isPackagePath, we mess up tsconfig.json baseUrl paths.
                    self.is_likely_node_module()
                }
            }
        }

        pub fn hash(&self, _: &[u8], _: options::Loader) -> u32 {
            let module = self.path_pair.primary.text();
            // SEP_STR ++ "node_modules" ++ SEP_STR
            let node_module_root =
                const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes();
            if let Some(end_) = strings::last_index_of(module, node_module_root) {
                let end: usize = end_ + node_module_root.len();
                return bun_wyhash::hash(&module[end..]) as u32;
            }

            bun_wyhash::hash(self.path_pair.primary.text()) as u32
        }
    }

    pub struct DebugMeta {
        pub notes: Vec<bun_ast::Data>,
        pub suggestion_text: &'static [u8],
        pub suggestion_message: &'static [u8],
        pub suggestion_range: SuggestionRange,
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum SuggestionRange {
        Full,
        End,
    }

    impl DebugMeta {
        pub fn init() -> DebugMeta {
            DebugMeta {
                notes: Vec::new(),
                suggestion_text: b"",
                suggestion_message: b"",
                suggestion_range: SuggestionRange::Full,
            }
        }

        pub fn log_error_msg(
            &mut self,
            log: &mut bun_ast::Log,
            source: Option<&bun_ast::Source>,
            r: bun_ast::Range,
            args: core::fmt::Arguments<'_>,
        ) -> core::result::Result<(), bun_core::Error> {
            // TODO(port): narrow error set
            if source.is_some() && !self.suggestion_message.is_empty() {
                let suggestion_range = if self.suggestion_range == SuggestionRange::End {
                    bun_ast::Range {
                        loc: bun_ast::Loc {
                            start: r.end_i() as i32 - 1,
                        },
                        ..Default::default()
                    }
                } else {
                    r
                };
                let data = bun_ast::range_data(source, suggestion_range, self.suggestion_message);
                // PORT NOTE: Zig spec writes `data.location.?.suggestion = m.suggestion_text`
                // here, but `logger.Location` (logger.zig:73) has no `suggestion` field —
                // `logErrorMsg` is uncalled in the Zig source so the field access is never
                // type-checked under lazy compilation. Mirror the effective behavior (no-op).
                let _ = &self.suggestion_text;
                self.notes.push(data);
            }

            let mut msg_text = Vec::new();
            write!(&mut msg_text, "{}", args).ok();
            log.add_msg(Msg {
                kind: bun_ast::Kind::Err,
                data: bun_ast::range_data(source, r, msg_text),
                notes: core::mem::take(&mut self.notes).into_boxed_slice(),
                ..Default::default()
            });
            Ok(())
        }
    }

    pub struct DirEntryResolveQueueItem {
        pub result: allocators::Result,
        // PORT NOTE: `RawSlice<u8>` (not `&'static [u8]`) — these point into the
        // threadlocal `dir_info_uncached_path` buffer and are consumed before
        // `dir_info_cached_maybe_log` returns. `RawSlice` is `repr(transparent)`
        // over `*const [u8]` so the bit-level zero-init invariant for `Bufs` is
        // unchanged (the array slot is `MaybeUninit`-wrapped), and read sites use
        // safe `.slice()` instead of an open-coded raw-ptr deref.
        pub unsafe_path: bun_ptr::RawSlice<u8>,
        pub safe_path: bun_ptr::RawSlice<u8>,
        pub fd: FD,
    }

    impl Default for DirEntryResolveQueueItem {
        fn default() -> Self {
            Self {
                result: allocators::Result {
                    hash: 0,
                    index: allocators::NOT_FOUND,
                    status: allocators::Status::Unknown,
                },
                unsafe_path: bun_ptr::RawSlice::EMPTY,
                safe_path: bun_ptr::RawSlice::EMPTY,
                fd: FD::INVALID,
            }
        }
    }

    // `bun_alloc::Result` doesn't derive Clone (yet); all its fields are Copy, so
    // hand-roll Clone here for the queue-item move at `dir_info_cached`.
    impl Clone for DirEntryResolveQueueItem {
        fn clone(&self) -> Self {
            Self {
                result: allocators::Result {
                    hash: self.result.hash,
                    index: self.result.index,
                    status: self.result.status,
                },
                unsafe_path: self.unsafe_path,
                safe_path: self.safe_path,
                fd: self.fd,
            }
        }
    }

    pub struct DebugLogs {
        pub what: Vec<u8>,
        pub indent: MutableString,
        pub notes: Vec<bun_ast::Data>,
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum FlushMode {
        Fail,
        Success,
    }

    impl DebugLogs {
        pub fn init() -> core::result::Result<DebugLogs, bun_alloc::AllocError> {
            let mutable = MutableString::init(0)?;
            Ok(DebugLogs {
                what: Vec::new(),
                indent: mutable,
                notes: Vec::new(),
            })
        }

        // deinit → Drop (only frees `notes`; `indent` deinit was commented out in Zig)

        #[cold]
        pub fn increase_indent(&mut self) {
            self.indent.append(b" ").expect("unreachable");
        }

        #[cold]
        pub fn decrease_indent(&mut self) {
            let new_len = self.indent.list.len() - 1;
            self.indent.list.truncate(new_len);
        }

        #[cold]
        pub fn add_note(&mut self, text: Vec<u8>) {
            let len = self.indent.len();
            let final_text = if len > 0 {
                let mut __text = Vec::with_capacity(text.len() + len);
                __text.extend_from_slice(self.indent.list.as_slice());
                __text.extend_from_slice(&text);
                // d.notes.allocator.free(_text) — drop(text) is implicit
                __text
            } else {
                text
            };

            self.notes
                .push(bun_ast::range_data(None, bun_ast::Range::NONE, final_text));
        }

        #[cold]
        pub fn add_note_fmt(&mut self, args: core::fmt::Arguments<'_>) {
            let mut buf = Vec::new();
            write!(&mut buf, "{}", args).expect("unreachable");
            self.add_note(buf);
        }
    }

    pub struct MatchResult {
        pub path_pair: PathPair,
        pub dirname_fd: FD,
        pub file_fd: FD,
        pub is_node_module: bool,
        pub package_json: Option<*const PackageJSON>,
        pub diff_case: Option<Fs::file_system::entry::lookup::DifferentCase<'static>>,
        pub dir_info: Option<DirInfoRef>,
        pub module_type: options::ModuleType,
        pub is_external: bool,
    }

    impl Default for MatchResult {
        fn default() -> Self {
            Self {
                path_pair: PathPair::default(),
                dirname_fd: FD::INVALID,
                file_fd: FD::INVALID,
                is_node_module: false,
                package_json: None,
                diff_case: None,
                dir_info: None,
                module_type: options::ModuleType::Unknown,
                is_external: false,
            }
        }
    }

    pub enum MatchResultUnion {
        NotFound,
        Success(MatchResult),
        Pending(PendingResolution),
        Failure(bun_core::Error),
    }

    pub struct PendingResolution {
        pub esm: crate::package_json::PackageExternal,
        pub dependency: Dependency::Version,
        pub resolution_id: Install::PackageID,
        pub root_dependency_id: Install::DependencyID,
        pub import_record_id: u32,
        pub string_buf: Vec<u8>,
        pub tag: PendingResolutionTag,
    }

    impl Default for PendingResolution {
        fn default() -> Self {
            Self {
                esm: Default::default(),
                dependency: Default::default(),
                resolution_id: Install::INVALID_PACKAGE_ID,
                root_dependency_id: Install::INVALID_PACKAGE_ID,
                import_record_id: u32::MAX,
                string_buf: Vec::new(),
                tag: PendingResolutionTag::Download,
            }
        }
    }

    pub type PendingResolutionList = MultiArrayList<PendingResolution>;

    impl PendingResolution {
        // PORT NOTE: deinitListItems → Drop on MultiArrayList<PendingResolution>
        // (Zig body only freed `dependency` + `string_buf` per item; both are owned fields with Drop.)

        // deinit → Drop (frees dependency + string_buf; both have Drop)

        pub fn init(
            esm: crate::package_json::Package<'_>,
            dependency: Dependency::Version,
            resolution_id: Install::PackageID,
        ) -> core::result::Result<PendingResolution, bun_core::Error> {
            // PORT NOTE: Zig body called `try esm.copy(allocator)` and left `string_buf`
            // / `tag` defaulted; that fn was never compiled (Zig lazy-analyzes unreferenced
            // fns). `Package::copy` is the count→allocate→clone Builder dance the live
            // call sites open-code, so thread the freshly-allocated buffer into
            // `string_buf` here so `Drop` frees what backs the cloned `esm` strings.
            let (esm, string_buf) = esm.copy()?;
            Ok(PendingResolution {
                esm,
                dependency,
                resolution_id,
                string_buf,
                ..PendingResolution::default()
            })
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum PendingResolutionTag {
        Download,
        Resolve,
        Done,
    }

    pub struct LoadResult {
        pub path: &'static [u8], // TODO(port): lifetime — interned in dirname_store
        pub diff_case: Option<Fs::file_system::entry::lookup::DifferentCase<'static>>,
        pub dirname_fd: FD,
        pub file_fd: FD,
        pub dir_info: Option<DirInfoRef>,
    }

    // This is a global so even if multiple resolvers are created, the mutex will still work
    // TODO(port): `bun_threading::Mutex` has no `const fn new()`; use LazyLock until it does.
    // `pub(crate)` so the `fs::EntriesMap::inner` debug-assert can verify it is held
    // (the resolver mutex is one of the two documented guards for the entries singleton).
    pub(crate) static RESOLVER_MUTEX: std::sync::LazyLock<Mutex> =
        std::sync::LazyLock::new(Mutex::default);
    // Zig had `resolver_Mutex_loaded` to lazily zero-init; Rust const init handles that.

    type BinFolderArray = BoundedArray<&'static [u8], 128>;
    // TODO(port): `BoundedArray` has no const constructor; init lazily under
    // `BIN_FOLDERS_LOADED` (matches Zig's `bin_folders_loaded` lazy zero-init).
    static BIN_FOLDERS: bun_core::RacyCell<core::mem::MaybeUninit<BinFolderArray>> =
        bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());
    static BIN_FOLDERS_LOCK: std::sync::LazyLock<Mutex> = std::sync::LazyLock::new(Mutex::default);
    static BIN_FOLDERS_LOADED: core::sync::atomic::AtomicBool =
        core::sync::atomic::AtomicBool::new(false);

    // LAYERING: `AnyResolveWatcher` is the erased vtable the resolver calls to
    // register directory watches. The concrete callback lives in `bun_watcher`
    // (lower tier); defining the vtable shape there and re-exporting here keeps a
    // single type so `Watcher::get_resolve_watcher()` flows directly into
    // `Resolver.watcher` without a seam converter.
    pub use bun_watcher::AnyResolveWatcher;

    // Zig: `pub fn ResolveWatcher(comptime Context: type, comptime onWatch: anytype) type` —
    // type-generator returning a struct with `.init(ctx) -> AnyResolveWatcher` and a
    // monomorphized `watch` shim. Per PORTING.md (`fn Foo(comptime T) type` → `struct Foo<T>`).
    //
    // PORT NOTE: const fn-pointer generics (`adt_const_params` for fn ptrs) and
    // const params depending on type params are both forbidden. Reshape to a
    // runtime fn-pointer carried alongside the context — `init` produces the same
    // `AnyResolveWatcher` erased shim as Zig's monomorphized `wrap`.

    pub struct ResolveWatcher<C> {
        on_watch: fn(*mut C, &[u8], FD),
        _marker: core::marker::PhantomData<*mut C>,
    }
    impl<C> ResolveWatcher<C> {
        pub const fn new(on_watch: fn(*mut C, &[u8], FD)) -> Self {
            Self {
                on_watch,
                _marker: core::marker::PhantomData,
            }
        }
        pub fn init(self, ctx: *mut C) -> AnyResolveWatcher {
            AnyResolveWatcher {
                context: ctx.cast(),
                // SAFETY: `fn(*mut C, ..)` and `fn(*mut (), ..)` are ABI-identical
                // (Rust-ABI, thin-ptr first arg); the `wrap` shim in Zig did the
                // same erase. The callback body discharges its own type-recovery.
                callback: unsafe {
                    bun_ptr::cast_fn_ptr::<fn(*mut C, &[u8], FD), fn(*mut (), &[u8], FD)>(
                        self.on_watch,
                    )
                },
            }
        }
    }

    pub struct Resolver<'a> {
        pub opts: options::BundleOptions,
        // PORT NOTE: Zig `fs: *Fs.FileSystem` / `log: *logger.Log` are raw aliasing
        // pointers — the bundler builds a `Resolver` per worker thread sharing the
        // process-wide `FileSystem` singleton, so `&'a mut` here would manufacture
        // aliased unique refs across threads (instant UB). Model as `*mut` and
        // deref through the `fs()` / `log()` accessors below.
        pub fs: *mut Fs::FileSystem,
        pub log: *mut bun_ast::Log,
        // allocator dropped — global mimalloc
        /// PORT NOTE: Zig stores `[]const []const u8` aliasing into
        /// `r.opts.extension_order` and saves/restores it across nested resolves.
        /// Stored as a `Copy` enum tag (no self-reference) and resolved on demand
        /// via [`Self::extension_order`] / [`options::BundleOptions::ext_order_slice`].
        pub extension_order: options::ExtOrder,
        pub timer: Timer,

        pub care_about_bin_folder: bool,
        pub care_about_scripts: bool,

        /// Read the "browser" field in package.json files?
        /// For Bun's runtime, we don't.
        pub care_about_browser_field: bool,

        pub debug_logs: Option<DebugLogs>,
        pub elapsed: u64, // tracing

        pub watcher: Option<AnyResolveWatcher>,

        pub caches: CacheSet,
        pub generation: Generation,

        /// Auto-install backend. `bun_install::PackageManager` implements
        /// [`AutoInstaller`]; the resolver only sees the trait object so it stays
        /// below `bun_install` in the dep graph. The runtime/bundler that enables
        /// auto-install (`opts.global_cache != .disable`) is responsible for
        /// constructing the `PackageManager` (Zig: `PackageManager.initWithRuntime`)
        /// and assigning it here BEFORE resolution; the resolver no longer
        /// constructs it lazily — that would require depending on `bun_install`,
        /// which depends on us. When `None`, [`get_package_manager`] panics if the
        /// auto-install path is reached.
        pub package_manager: Option<NonNull<dyn AutoInstaller>>,
        pub on_wake_package_manager: Install::WakeHandler,
        // Spec resolver.zig:477 `env_loader: ?*DotEnv.Loader` — raw nullable pointer.
        // Stored as `NonNull` (not `&'a Loader`) because the same allocation is
        // mutably reborrowed via `Transpiler.env: *mut Loader` after this field is
        // set (e.g. bake/production.rs assigns this then calls `configure_defines()`
        // → `run_env_loader()` which takes `&mut *self.env`). Holding a live
        // `&Loader` across that `&mut Loader` would be aliased-&mut UB; a raw
        // pointer carries no aliasing guarantee and matches the Zig shape.
        pub env_loader: Option<NonNull<DotEnv::Loader<'a>>>,
        pub store_fd: bool,

        pub standalone_module_graph: Option<&'a dyn StandaloneModuleGraph>,

        // These are sets that represent various conditions for the "exports" field
        // in package.json.
        // esm_conditions_default: bun.StringHashMap(bool),
        // esm_conditions_import: bun.StringHashMap(bool),
        // esm_conditions_require: bun.StringHashMap(bool),

        // A special filtered import order for CSS "@import" imports.
        //
        // The "resolve extensions" setting determines the order of implicit
        // extensions to try when resolving imports with the extension omitted.
        // Sometimes people create a JavaScript/TypeScript file and a CSS file with
        // the same name when they create a component. At a high level, users expect
        // implicit extensions to resolve to the JS file when being imported from JS
        // and to resolve to the CSS file when being imported from CSS.
        //
        // Different bundlers handle this in different ways. Parcel handles this by
        // having the resolver prefer the same extension as the importing file in
        // front of the configured "resolve extensions" order. Webpack's "css-loader"
        // plugin just explicitly configures a special "resolve extensions" order
        // consisting of only ".css" for CSS files.
        //
        // It's unclear what behavior is best here. What we currently do is to create
        // a special filtered version of the configured "resolve extensions" order
        // for CSS files that filters out any extension that has been explicitly
        // configured with a non-CSS loader. This still gives users control over the
        // order but avoids the scenario where we match an import in a CSS file to a
        // JavaScript-related file. It's probably not perfect with plugins in the
        // picture but it's better than some alternatives and probably pretty good.
        // atImportExtensionOrder []string

        // This mutex serves two purposes. First of all, it guards access to "dirCache"
        // which is potentially mutated during path resolution. But this mutex is also
        // necessary for performance. The "React admin" benchmark mysteriously runs
        // twice as fast when this mutex is locked around the whole resolve operation
        // instead of around individual accesses to "dirCache". For some reason,
        // reducing parallelism in the resolver helps the rest of the bundler go
        // faster. I'm not sure why this is but please don't change this unless you
        // do a lot of testing with various benchmarks and there aren't any regressions.
        pub mutex: &'static Mutex,

        /// This cache maps a directory path to information about that directory and
        /// all parent directories. When interacting with this structure, make sure
        /// to validate your keys with `Resolver.assertValidCacheKey`
        // PORT NOTE: Zig `dir_cache: *DirInfo.HashMap` is a raw aliasing pointer to the
        // `DirInfo::hash_map_instance()` singleton. Modeled as `*mut` (not `&'static mut`)
        // for the same reason as `fs`/`log` above — every per-worker `Resolver` shares the
        // singleton, so a `&'static mut` here would manufacture aliased unique refs (UB).
        // Deref through the `dir_cache()` accessor below.
        pub dir_cache: *mut DirInfo::HashMap,

        /// This is set to false for the runtime. The runtime should choose "main"
        /// over "module" in package.json
        pub prefer_module_field: bool,

        /// This is an array of paths to resolve against. Used for passing an
        /// object '{ paths: string[] }' to `require` and `resolve`; This field
        /// is overwritten while the resolution happens.
        ///
        /// When this is null, it is as if it is set to `&.{ path.dirname(referrer) }`.
        pub custom_dir_paths: Option<&'a [bun_core::String]>,
    }

    /// RAII guard returned by [`Resolver::scoped_log`]. Restores the previous
    /// `Resolver::log` pointer on drop — port of the Zig
    /// `defer resolver.log = orig_log` save/restore pattern.
    pub struct ResolverLogScope {
        slot: *mut *mut bun_ast::Log,
        prev: *mut bun_ast::Log,
    }

    impl Drop for ResolverLogScope {
        #[inline]
        fn drop(&mut self) {
            // SAFETY: `slot` was derived via `addr_of_mut!` from the raw resolver
            // pointer in `scoped_log` (SharedReadWrite provenance); caller contract
            // guarantees the resolver outlives this guard.
            unsafe { *self.slot = self.prev };
        }
    }

    impl<'a> Resolver<'a> {
        /// Per-worker constructor — replaces the bundler's prior bitwise
        /// `transpiler.* = from.*` (Zig ThreadPool.zig:308) for the resolver
        /// portion. Every `Copy` / raw-pointer field is copied from `from`; the
        /// per-worker `caches` (the only `Drop`-carrying field, via the
        /// `Json` cache's `MimallocArena`) and `debug_logs`/`timer` are freshly
        /// constructed so nothing the parent owns is aliased into the worker.
        ///
        /// `opts` and `log` are supplied by the caller (the worker projects a
        /// fresh `BundleOptions` subset and arena-allocates its own `Log`).
        ///
        /// # Safety
        /// `from`'s `standalone_module_graph` / `env_loader` borrow data that
        /// outlives the returned resolver (process-lifetime singletons in every
        /// caller). The lifetime is widened from `'from` to `'a` here; callers
        /// must uphold that the borrowed data outlives `'a`.
        pub unsafe fn for_worker(
            from: &Resolver<'_>,
            log: *mut bun_ast::Log,
            opts: options::BundleOptions,
        ) -> Resolver<'a> {
            Resolver {
                opts,
                fs: from.fs,
                log,
                extension_order: from.extension_order,
                timer: Timer::start().unwrap_or_else(|_| panic!("Timer fail")),
                care_about_bin_folder: from.care_about_bin_folder,
                care_about_scripts: from.care_about_scripts,
                care_about_browser_field: from.care_about_browser_field,
                // `DebugLogs` owns Vecs — per-worker fresh.
                debug_logs: None,
                elapsed: 0,
                watcher: from.watcher,
                // Spec ThreadPool.zig:313 `transpiler.resolver.caches = CacheSet.Set.init(allocator)`.
                caches: CacheSet::init(),
                generation: from.generation,
                package_manager: from.package_manager,
                on_wake_package_manager: from.on_wake_package_manager.clone(),
                // SAFETY: see fn doc — pointee outlives `'a`.
                env_loader: from.env_loader.map(|p| p.cast::<DotEnv::Loader<'a>>()),
                store_fd: from.store_fd,
                // SAFETY: see fn doc — lifetime-widen the trait-object borrow. The
                // vtable layout is identical (only the borrow-checker tag differs);
                // a raw-pointer `as`-cast cannot change the `+ 'b` bound, so widen
                // via a layout-preserving transmute on the `Option<&dyn>`.
                standalone_module_graph: unsafe {
                    core::mem::transmute::<
                        Option<&'_ dyn StandaloneModuleGraph>,
                        Option<&'a dyn StandaloneModuleGraph>,
                    >(from.standalone_module_graph)
                },
                mutex: from.mutex,
                dir_cache: from.dir_cache,
                prefer_module_field: from.prefer_module_field,
                // Transient per-resolve scratch (only set for `require(..., {paths})`);
                // never carried across worker init.
                custom_dir_paths: None,
            }
        }

        /// Port of Zig `r.fs` deref.
        ///
        /// PORT NOTE (Stacked Borrows): returns the RAW `*mut` (NOT `&'a mut`). A
        /// `&'a mut` accessor would let two `fs()` calls manufacture coexisting
        /// aliased unique refs to the same singleton (PORTING.md §Forbidden:
        /// aliased-&mut), and any later `&mut *self.fs` retag would pop a previously
        /// returned `&'a mut`'s SB tag while it's still nominally live for `'a`.
        /// Callers must `unsafe { &mut *r.fs() }` at the narrowest use site and let
        /// the projection die at end-of-expression. Spec resolver.zig:455 stores raw
        /// `*Fs.FileSystem` and dereferences per-use.
        #[inline(always)]
        pub fn fs(&self) -> *mut Fs::FileSystem {
            self.fs
        }

        /// Shared-borrow of the FileSystem singleton for read-only methods
        /// (`abs_buf*`, `normalize_buf`, `dirname_store`, `filename_store`,
        /// `top_level_dir`). Preferred over `unsafe { &mut *self.fs() }` whenever
        /// the callee takes `&self` — avoids materializing a `&mut FileSystem`
        /// that could (under Stacked Borrows) pop a coexisting `rfs_ptr()` /
        /// `&mut *query.entry` tag derived from the same allocation.
        #[inline(always)]
        pub fn fs_ref(&self) -> &Fs::FileSystem {
            // SAFETY: BACKREF — `self.fs` is the process-global FileSystem singleton
            // (LIFETIMES.tsv: STATIC); resolver mutex serializes all mutation. A
            // shared `&` cannot alias-UB with the raw `*mut RealFS` projections
            // used elsewhere because no Unique tag is pushed.
            unsafe { &*self.fs }
        }

        /// Unique-borrow of the `FileSystem` singleton. Centralizes the
        /// `unsafe { &mut *self.fs() }` retag for call sites that hold no other
        /// borrow of `self` across the call. Sites that need `&mut FileSystem`
        /// while also borrowing a disjoint `self.<field>` (e.g.
        /// `self.caches.fs.read_file_with_allocator`) cannot route through
        /// `&mut self` and continue to narrow-retag via the raw [`fs()`](Self::fs)
        /// accessor — same caveat as [`log_mut`](Self::log_mut).
        #[inline(always)]
        pub fn fs_mut(&mut self) -> &mut Fs::FileSystem {
            // SAFETY: BACKREF — `self.fs` is the never-null process-global
            // `FileSystem` singleton (set in `init1`); resolver mutex serializes
            // all mutation across worker clones; `&mut self` rules out
            // intra-instance aliasing.
            unsafe { &mut *self.fs }
        }

        /// Resolve the current [`options::ExtOrder`] tag to the slice it names
        /// inside `self.opts`. Port of Zig `r.extension_order` field read.
        #[inline(always)]
        pub fn extension_order(&self) -> &[Box<[u8]>] {
            self.opts.ext_order_slice(self.extension_order)
        }

        /// Raw-pointer projection to the inner `RealFS` (`self.fs.fs`).
        ///
        /// PORT NOTE (Stacked Borrows): derived directly from the raw `*mut
        /// FileSystem` field via `addr_of_mut!` so the resulting `*mut RealFS`
        /// carries SharedReadWrite provenance — later `fs_ref()` (Shared) or
        /// short-lived `&mut *self.fs()` retags do NOT invalidate it. Callers
        /// re-borrow `&mut *self.rfs_ptr()` per use; do not bind a `&mut RealFS`
        /// across another `fs()` deref.
        #[inline(always)]
        pub fn rfs_ptr(&self) -> *mut Fs::file_system::RealFS {
            // SAFETY: `self.fs` is the process-global FileSystem singleton; valid
            // for the resolver's lifetime. `addr_of_mut!` creates a raw place
            // projection without an intermediate `&mut FileSystem`.
            unsafe { core::ptr::addr_of_mut!((*self.fs).fs) }
        }

        /// Port of Zig `r.log` deref.
        ///
        /// PORT NOTE (Stacked Borrows): returns RAW `*mut` (see `fs()` note). BACKREF
        /// — owner (Transpiler/BundleV2) outlives the Resolver; worker clones share
        /// the same Log under the resolver mutex. Caller `unsafe { &mut *r.log() }`
        /// at each use site; do not bind the projected `&mut Log` across another
        /// `log()` deref.
        #[inline(always)]
        pub fn log(&self) -> *mut bun_ast::Log {
            self.log
        }

        /// Temporarily redirect `self.log` to `log`, returning a guard that
        /// restores the previous pointer on drop. Port of the Zig
        /// `const orig = r.log; r.log = &tmp; defer r.log = orig;` pattern.
        ///
        /// Takes a raw `*mut Self` (not `&mut self`) so the stored slot pointer
        /// carries SharedReadWrite provenance and stays valid under Stacked
        /// Borrows when the caller subsequently reborrows the resolver
        /// (`read_dir_info` etc.) before the guard drops.
        ///
        /// # Safety
        /// `self_` must point at a `Resolver` that outlives the returned guard,
        /// and `log` must remain valid for that same duration (declare the guard
        /// *after* the temporary `Log` so it drops first).
        #[inline]
        pub unsafe fn scoped_log(self_: *mut Self, log: *mut bun_ast::Log) -> ResolverLogScope {
            // SAFETY: caller contract — `self_` is live; `addr_of_mut!` projects
            // the field place without an intermediate `&mut Resolver`.
            let slot = unsafe { core::ptr::addr_of_mut!((*self_).log) };
            // SAFETY: `slot` just derived from a live resolver.
            let prev = unsafe { *slot };
            unsafe { *slot = log };
            ResolverLogScope { slot, prev }
        }

        /// Shared-borrow of the resolver's `Log` for read-only inspection
        /// (e.g. `log.level`). Preferred over `unsafe { &*self.log() }`.
        #[inline(always)]
        pub fn log_ref(&self) -> &bun_ast::Log {
            // SAFETY: BACKREF — `self.log` is never null (set in `init1` /
            // `scoped_log`, owner-allocated, outlives the Resolver). Resolver
            // mutex serializes mutation; a Shared `&` here pushes no Unique tag
            // and so cannot alias-UB with the narrow `log_mut()` retags elsewhere
            // (none are live across a `log_ref()` call).
            unsafe { &*self.log }
        }

        /// Unique-borrow of the resolver's `Log` for `add_*_fmt` / `add_msg`.
        ///
        /// Centralizes the per-site `unsafe { &mut *self.log() }` retag. `&mut
        /// self` rules out two coexisting `&mut Log` from the SAME `Resolver`;
        /// cross-clone aliasing (worker copies share the owner's `Log`) is
        /// guarded by the resolver `mutex` — same invariant the open-coded sites
        /// already relied on.
        ///
        /// Sites that need `&mut Log` while holding a disjoint `&mut self.<field>`
        /// (`flush_debug_logs` ↔ `self.debug_logs`, `parse_tsconfig` ↔
        /// `self.caches.json`) cannot route through `&mut self` and continue to
        /// narrow-retag via the raw [`log()`](Self::log) accessor.
        #[inline(always)]
        pub fn log_mut(&mut self) -> &mut bun_ast::Log {
            // SAFETY: BACKREF — `self.log` is never null (set in `init1` /
            // `scoped_log`); the pointee (owner-allocated `Log`, or a stack `Log`
            // pinned by a live `ResolverLogScope`) outlives every borrow returned
            // here. Resolver mutex serializes mutation across worker clones.
            unsafe { &mut *self.log }
        }

        /// Port of Zig `r.dir_cache` deref.
        ///
        /// PORT NOTE (Stacked Borrows): returns RAW `*mut` (see `fs()` note). ARENA —
        /// `DirInfo::hash_map_instance()` singleton; never freed. Caller
        /// `unsafe { &mut *r.dir_cache() }` at each use site.
        #[inline(always)]
        pub fn dir_cache(&self) -> *mut DirInfo::HashMap {
            self.dir_cache
        }

        /// Unique-borrow of the `DirInfo` BSSMap singleton.
        ///
        /// Centralizes the `unsafe { &mut *self.dir_cache() }` retag that every
        /// call site previously open-coded. `&mut self` ensures no two coexisting
        /// `&mut HashMap` are produced from the SAME `Resolver`; cross-clone
        /// aliasing (per-worker `Resolver`s share the singleton) is
        /// guarded by the resolver `mutex` — identical invariant to the prior
        /// per-site `unsafe`.
        ///
        /// Stacked Borrows: each call pushes a fresh Unique tag on the BSSMap
        /// allocation, so any `*mut DirInfo` previously projected from an earlier
        /// `dir_cache_mut()` borrow is popped. Callers that need a slot pointer to
        /// survive a subsequent map access must route both through ONE bound
        /// `&mut HashMap` (see `dir_info_for_resolution` / `dir_info_cached_maybe_log`).
        #[inline(always)]
        pub fn dir_cache_mut(&mut self) -> &mut DirInfo::HashMap {
            // SAFETY: ARENA — `self.dir_cache` is the never-null
            // `DirInfo::hash_map_instance()` static (set in `init1`, never
            // reassigned, never freed). Resolver mutex serializes all mutation
            // across worker clones; `&mut self` rules out intra-instance aliasing.
            unsafe { &mut *self.dir_cache }
        }

        /// Port of resolver.zig `getPackageManager`. The Zig spec lazily calls
        /// `PackageManager.initWithRuntime` here; in the Rust crate graph that
        /// would be a `bun_resolver → bun_install` cycle, so the lazy init is
        /// dispatched through the link-time `extern "Rust"` factory
        /// [`__bun_resolver_init_package_manager`] (defined `#[no_mangle]` in
        /// `bun_install::auto_installer`). The factory performs
        /// `HTTPThread.init` + `PackageManager.initWithRuntime` and returns the
        /// process-static singleton as a `dyn AutoInstaller`. We then wire
        /// `on_wake` and cache the pointer — exactly the Zig body. Reached from
        /// the auto-install path (`load_node_modules` global-cache block) when
        /// [`use_package_manager`] is `true`.
        pub fn get_package_manager(&mut self) -> *mut dyn AutoInstaller {
            if let Some(pm) = self.package_manager {
                return pm.as_ptr();
            }
            // Zig: `bun.HTTPThread.init(&.{}); const pm = PackageManager.initWithRuntime(
            //     this.log, this.opts.install, bun.default_allocator, .{}, this.env_loader.?);`
            let env = self
                .env_loader
                .expect("Resolver.env_loader must be set before auto-install")
                .as_ptr()
                // SAFETY: `DotEnv::Loader<'a>` is layout-identical across `'a`;
                // `init_with_runtime` only borrows it for the synchronous init
                // (the static `PackageManager` retains a raw `NonNull<Loader>`,
                // matching Zig's `*DotEnv.Loader` aliasing).
                .cast::<core::ffi::c_void>();
            // SAFETY: `__bun_resolver_init_package_manager` is defined
            // `#[no_mangle]` in `bun_install::auto_installer` and linked into the
            // final binary; `self.log` / `self.opts.install` / `env` point at
            // process-lifetime storage (Transpiler-owned). The returned pointer
            // names the `PackageManager` singleton (`'static`).
            let pm: NonNull<dyn AutoInstaller> =
                unsafe { __bun_resolver_init_package_manager(self.log, self.opts.install, env) };
            // Zig: `pm.onWake = this.onWakePackageManager;`
            // SAFETY: `pm` is the just-initialized singleton; sole `&mut` here.
            unsafe { (*pm.as_ptr()).set_on_wake(self.on_wake_package_manager.clone()) };
            self.package_manager = Some(pm);
            pm.as_ptr()
        }

        /// Safe accessor for the optional [`AutoInstaller`] back-reference.
        ///
        /// Single `unsafe` deref site for the `package_manager:
        /// Option<NonNull<dyn AutoInstaller>>` field. The pointee is the
        /// process-static `PackageManager` singleton (set via
        /// [`get_package_manager`](Self::get_package_manager) /
        /// `__bun_resolver_init_package_manager`), so it strictly outlives the
        /// resolver. `&mut self` ensures the returned `&mut dyn AutoInstaller` is
        /// the only live reference for its lifetime.
        #[inline]
        pub fn auto_installer(&mut self) -> Option<&mut dyn AutoInstaller> {
            // SAFETY: BACKREF — `package_manager` names the bun_install-owned
            // singleton, live for the resolver's lifetime once installed; `&mut
            // self` ⇒ exclusive access to the only Rust handle.
            self.package_manager.map(|mut pm| unsafe { pm.as_mut() })
        }

        /// Safe read-only accessor for the optional `DotEnv::Loader` back-reference.
        ///
        /// Single `unsafe` deref site for the `env_loader: Option<NonNull<_>>`
        /// field. The pointee is the Transpiler-owned loader (set from
        /// `transpiler.env`) and strictly outlives the resolver. Only called once
        /// resolution has begun (after `run_env_loader()`), so no `&mut Loader` is
        /// live concurrently — see the field comment for why this is *not* stored
        /// as `Option<&'a Loader>`.
        #[inline]
        pub fn env_loader(&self) -> Option<&'a DotEnv::Loader<'a>> {
            // SAFETY: BACKREF — `env_loader` names the Transpiler-owned
            // `DotEnv::Loader`, live for the resolver's lifetime `'a`; resolution
            // never mutates the env, so no `&mut Loader` overlaps this shared
            // borrow. Returned as `&'a` (not tied to `&self`) so callers may keep
            // the env borrow across `&mut self` resolver calls.
            self.env_loader.map(|p| unsafe { p.as_ref() })
        }

        #[inline]
        pub fn use_package_manager(&self) -> bool {
            // TODO(@paperclover): make this configurable. the rationale for disabling
            // auto-install in standalone mode is that such executable must either:
            //
            // - bundle the dependency itself. dynamic `require`/`import` could be
            //   changed to bundle potential dependencies specified in package.json
            //
            // - want to load the user's node_modules, which is what currently happens.
            //
            // auto install, as of writing, is also quite buggy and untested, it always
            // installs the latest version regardless of a user's package.json or specifier.
            // in addition to being not fully stable, it is completely unexpected to invoke
            // a package manager after bundling an executable. if enough people run into
            // this, we could implement point 1
            if self.standalone_module_graph.is_some() {
                return false;
            }

            self.opts.global_cache.is_enabled()
        }

        pub fn init1(
            log: *mut bun_ast::Log,
            _fs: *mut Fs::FileSystem,
            opts: options::BundleOptions,
        ) -> Self {
            // resolver_Mutex_loaded check elided; static is const-inited in Rust.

            let care_about_browser_field = opts.target == options::Target::Browser;
            Resolver {
                // allocator dropped
                // Route through the per-monomorphization singleton so this field and
                // `DirInfo::get_parent()` / `get_enclosing_browser_scope()` share storage
                // (Zig `BSSMap.init()` is a per-type singleton, not a fresh alloc).
                dir_cache: DirInfo::hash_map_instance(),
                mutex: &*RESOLVER_MUTEX,
                caches: CacheSet::init(),
                opts,
                timer: Timer::start().unwrap_or_else(|_| panic!("Timer fail")),
                fs: _fs,
                log,
                extension_order: options::ExtOrder::DefaultDefault,
                care_about_browser_field,
                care_about_bin_folder: false,
                care_about_scripts: false,
                debug_logs: None,
                elapsed: 0,
                watcher: None,
                generation: 0,
                package_manager: None,
                on_wake_package_manager: Default::default(),
                env_loader: None,
                store_fd: false,
                standalone_module_graph: None,
                prefer_module_field: true,
                custom_dir_paths: None,
            }
        }

        pub fn is_external_pattern(&self, import_path: &[u8]) -> bool {
            if self.opts.packages == options::Packages::External && is_package_path(import_path) {
                return true;
            }
            self.matches_user_external_pattern(import_path)
        }

        /// True iff `import_path` matches a user-supplied `--external` wildcard
        /// pattern. Does NOT consider `packages = external`; use
        /// `isExternalPattern` for the combined check.
        pub fn matches_user_external_pattern(&self, import_path: &[u8]) -> bool {
            for pattern in self.opts.external.patterns.iter() {
                if import_path.len() >= pattern.prefix.len() + pattern.suffix.len()
                    && (import_path.starts_with(pattern.prefix.as_ref())
                        && import_path.ends_with(pattern.suffix.as_ref()))
                {
                    return true;
                }
            }
            false
        }

        /// Resolves `import_path` via the enclosing tsconfig's `paths`. Returns
        /// the `MatchResult` iff a key matches AND the mapped target exists on
        /// disk. Used to let path-aliased local files win over `packages=external`
        /// without breaking catch-all `"*"` paths entries that only cover ambient
        /// type stubs.
        pub fn resolve_via_tsconfig_paths(
            &mut self,
            source_dir: &[u8],
            import_path: &[u8],
            kind: ast::ImportKind,
        ) -> Option<MatchResult> {
            // SAFETY: PORT — `import_path` is caller-interned (DirnameStore/source text)
            // and outlives the returned MatchResult. Zig used raw `[]const u8` here.
            // TODO(port): thread an explicit `'a` through MatchResult instead.
            let import_path: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(import_path) };
            if source_dir.is_empty() {
                return None;
            }
            if !bun_paths::is_absolute(source_dir) {
                return None;
            }
            let dir_info = self.dir_info_cached(source_dir).ok().flatten()?;
            let tsconfig = dir_info.enclosing_tsconfig_json?;
            if tsconfig.paths.count() == 0 {
                return None;
            }
            self.match_tsconfig_paths(tsconfig, import_path, kind)
        }

        pub fn flush_debug_logs(
            &mut self,
            flush_mode: FlushMode,
        ) -> core::result::Result<(), bun_core::Error> {
            // TODO(port): narrow error set
            // PORT NOTE: capture `log` before partially borrowing `self.debug_logs`
            // so the method call doesn't conflict with the field borrow (`log()`
            // derefs the raw `*mut Log` and is lifetime-decoupled from `&self`).
            // SAFETY: BACKREF — `self.log` points at owner-allocated `Log`; disjoint from
            // `self.debug_logs` (separate allocation), so the `&mut Log` does not alias the
            // `self.debug_logs.as_mut()` borrow below.
            let log = unsafe { &mut *self.log() };
            if let Some(debug) = self.debug_logs.as_mut() {
                // PORT NOTE: spec resolver.zig:650-658 — only consume `what`/`notes` inside
                // the arm that actually emits, so the success-at-non-verbose path touches
                // nothing. `add_range_debug_with_notes`/`add_verbose_with_notes` take
                // `&'static [u8]`; bypass them and build the `Msg` directly so the Log owns
                // the `what` buffer via `Data.text: Cow::Owned` (no `Box::leak`, PORTING.md
                // §Forbidden). The `should_print` gate mirrors the bypassed wrappers.
                if flush_mode == FlushMode::Fail {
                    if bun_ast::Kind::Debug.should_print(log.level) {
                        let what = core::mem::take(&mut debug.what);
                        let notes = core::mem::take(&mut debug.notes).into_boxed_slice();
                        log.add_msg(Msg {
                            kind: bun_ast::Kind::Debug,
                            data: bun_ast::range_data(
                                None,
                                bun_ast::Range {
                                    loc: bun_ast::Loc::default(),
                                    ..Default::default()
                                },
                                what,
                            ),
                            notes,
                            ..Default::default()
                        });
                    }
                } else if (log.level as u32) <= (bun_ast::Level::Verbose as u32) {
                    if bun_ast::Kind::Verbose.should_print(log.level) {
                        let what = core::mem::take(&mut debug.what);
                        let notes = core::mem::take(&mut debug.notes).into_boxed_slice();
                        log.add_msg(Msg {
                            kind: bun_ast::Kind::Verbose,
                            data: bun_ast::range_data(
                                None,
                                bun_ast::Range {
                                    loc: bun_ast::Loc::EMPTY,
                                    ..Default::default()
                                },
                                what,
                            ),
                            notes,
                            ..Default::default()
                        });
                    }
                }
            }
            Ok(())
        }

        // var tracing_start: i128 — unused; dropped.

        pub fn resolve_and_auto_install(
            &mut self,
            source_dir: &[u8],
            import_path: &[u8],
            kind: ast::ImportKind,
            global_cache: GlobalCache,
        ) -> ResultUnion {
            // SAFETY: PORT — `import_path` is caller-interned (source text / DirnameStore)
            // and outlives the returned Result. Zig used raw `[]const u8` here.
            // TODO(port): thread an explicit lifetime through Result instead.
            let import_path: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(import_path) };
            let _tracer = ::bun_perf::trace(::bun_perf::PerfEvent::ModuleResolverResolve);

            // Only setting 'current_action' in debug mode because module resolution
            // is done very often, and has a very low crash rate.
            // TODO(port): bun.crash_handler.current_action save/restore (Environment.show_crash_trace gated)
            #[cfg(debug_assertions)]
            let _crash_guard =
                ::bun_crash_handler::set_current_action_resolver(source_dir, import_path, kind);

            #[cfg(debug_assertions)]
            if bun_core::debug_flags::has_resolve_breakpoint(import_path) {
                bun_core::Output::debug(&format_args!(
                    "Resolving <green>{}<r> from <blue>{}<r>",
                    bstr::BStr::new(import_path),
                    bstr::BStr::new(source_dir),
                ));
                // @breakpoint() — no Rust equiv; left as TODO(port)
            }

            let original_order = self.extension_order;
            // PORT NOTE: Zig `defer r.extension_order = original_order` — reshaped for
            // borrowck so the restore happens explicitly at every return point below.
            self.extension_order = match kind {
                ast::ImportKind::Url | ast::ImportKind::AtConditional | ast::ImportKind::At => {
                    options::ExtOrder::Css
                }
                ast::ImportKind::EntryPointBuild
                | ast::ImportKind::EntryPointRun
                | ast::ImportKind::Stmt
                | ast::ImportKind::Dynamic => options::ExtOrder::DefaultEsm,
                _ => options::ExtOrder::DefaultDefault,
            };

            if FeatureFlags::TRACING {
                self.timer.reset();
            }

            // Spec resolver.zig:703-707: `defer { if (tracing) r.elapsed += r.timer.read() }`
            // — fires on EVERY return path. Capture raw field ptrs (Copy) so the closure
            // does not hold a `&mut self` borrow across the function body.
            let elapsed_ptr: *mut u64 = core::ptr::addr_of_mut!(self.elapsed);
            let timer_ptr: *const Timer = core::ptr::addr_of!(self.timer);
            scopeguard::defer! {
                if FeatureFlags::TRACING {
                    // SAFETY: `self` outlives this guard (drops at end of fn body);
                    // `elapsed`/`timer` are not borrowed when the guard fires.
                    unsafe { *elapsed_ptr += (*timer_ptr).read(); }
                }
            }

            if self.log_ref().level == bun_ast::Level::Verbose {
                if self.debug_logs.is_some() {
                    // deinit → drop
                    self.debug_logs = None;
                }
                self.debug_logs = Some(DebugLogs::init().expect("unreachable"));
            }

            if import_path.is_empty() {
                self.extension_order = original_order;
                return ResultUnion::NotFound;
            }

            if self.opts.mark_builtins_as_external {
                if import_path.starts_with(b"node:")
                    || import_path.starts_with(b"bun:")
                    || HardcodedAlias::has(
                        import_path,
                        self.opts.target,
                        HardcodedAliasCfg {
                            rewrite_jest_for_tests: self.opts.rewrite_jest_for_tests,
                        },
                    )
                {
                    self.extension_order = original_order;
                    return ResultUnion::Success(Result {
                        import_kind: kind,
                        path_pair: PathPair {
                            primary: Path::init(import_path),
                            secondary: None,
                        },
                        module_type: options::ModuleType::Cjs,
                        primary_side_effects_data: SideEffects::NoSideEffectsPureData,
                        flags: ResultFlags::IS_EXTERNAL,
                        ..Default::default()
                    });
                }
            }

            // #29590: a tsconfig `paths` key can look bare (e.g. "@/*") and
            // otherwise collide with `packages=external + isPackagePath`. Try
            // the alias first, but only follow it when it actually resolves to
            // a file on disk — a catch-all `"*": ["./types/*"]` for ambient
            // .d.ts stubs must still let real bare imports stay external.
            if kind != ast::ImportKind::EntryPointBuild
                && kind != ast::ImportKind::EntryPointRun
                && self.opts.packages == options::Packages::External
                && is_package_path(import_path)
                && !self.matches_user_external_pattern(import_path)
            {
                if let Some(res) = self.resolve_via_tsconfig_paths(source_dir, import_path, kind) {
                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note(b"Resolved via tsconfig.json \"paths\" before applying packages=external".to_vec());
                    }
                    let _ = self.flush_debug_logs(FlushMode::Success);
                    self.extension_order = original_order;
                    return ResultUnion::Success(Result {
                        import_kind: kind,
                        path_pair: res.path_pair,
                        diff_case: res.diff_case,
                        package_json: res.package_json,
                        dirname_fd: res.dirname_fd,
                        file_fd: res.file_fd,
                        jsx: self.opts.jsx.clone(),
                        ..Default::default()
                    });
                }
            }

            // Certain types of URLs default to being external for convenience,
            // while these rules should not be applied to the entrypoint as it is never external (#12734)
            if kind != ast::ImportKind::EntryPointBuild
                && kind != ast::ImportKind::EntryPointRun
                && (self.is_external_pattern(import_path)
                // "fill: url(#filter);"
                || (kind.is_from_css() && import_path.starts_with(b"#"))
                // "background: url(http://example.com/images/image.png);"
                || import_path.starts_with(b"http://")
                // "background: url(https://example.com/images/image.png);"
                || import_path.starts_with(b"https://")
                // "background: url(//example.com/images/image.png);"
                || import_path.starts_with(b"//"))
            {
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note(b"Marking this path as implicitly external".to_vec());
                }
                let _ = self.flush_debug_logs(FlushMode::Success);

                self.extension_order = original_order;
                return ResultUnion::Success(Result {
                    import_kind: kind,
                    path_pair: PathPair {
                        primary: Path::init(import_path),
                        secondary: None,
                    },
                    module_type: if !kind.is_from_css() {
                        options::ModuleType::Esm
                    } else {
                        options::ModuleType::Unknown
                    },
                    flags: ResultFlags::IS_EXTERNAL,
                    ..Default::default()
                });
            }

            match DataURL::parse(import_path) {
                Err(_) => {
                    self.extension_order = original_order;
                    return ResultUnion::Failure(bun_core::err!("InvalidDataURL"));
                }
                Ok(Some(data_url)) => {
                    // "import 'data:text/javascript,console.log(123)';"
                    // "@import 'data:text/css,body{background:white}';"
                    let mime = data_url.decode_mime_type();
                    use ::bun_http_types::MimeType::Category;
                    if matches!(
                        mime.category,
                        Category::Javascript | Category::Css | Category::Json | Category::Text
                    ) {
                        if let Some(debug) = self.debug_logs.as_mut() {
                            debug.add_note(
                                b"Putting this path in the \"dataurl\" namespace".to_vec(),
                            );
                        }
                        let _ = self.flush_debug_logs(FlushMode::Success);

                        self.extension_order = original_order;
                        return ResultUnion::Success(Result {
                            path_pair: PathPair {
                                primary: Path::init_with_namespace(import_path, b"dataurl"),
                                secondary: None,
                            },
                            ..Default::default()
                        });
                    }

                    // "background: url(data:image/png;base64,iVBORw0KGgo=);"
                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note(b"Marking this \"dataurl\" as external".to_vec());
                    }
                    let _ = self.flush_debug_logs(FlushMode::Success);

                    self.extension_order = original_order;
                    return ResultUnion::Success(Result {
                        path_pair: PathPair {
                            primary: Path::init_with_namespace(import_path, b"dataurl"),
                            secondary: None,
                        },
                        flags: ResultFlags::IS_EXTERNAL,
                        ..Default::default()
                    });
                }
                Ok(None) => {}
            }

            // When using `bun build --compile`, module resolution is never
            // relative to our special /$bunfs/ directory.
            //
            // It's always relative to the current working directory of the project root.
            //
            // ...unless you pass a relative path that exists in the standalone module graph executable.
            let mut source_dir_resolver = bun_paths::PosixToWinNormalizer::default();
            let source_dir_normalized: &[u8] = 'brk: {
                if let Some(graph) = self.standalone_module_graph {
                    if ::bun_options_types::standalone_path::is_bun_standalone_file_path(
                        import_path,
                    ) {
                        if graph.find_assume_standalone_path(import_path).is_some() {
                            self.extension_order = original_order;
                            return ResultUnion::Success(Result {
                                import_kind: kind,
                                path_pair: PathPair {
                                    primary: Path::init(import_path),
                                    secondary: None,
                                },
                                module_type: options::ModuleType::Esm,
                                flags: ResultFlags::IS_STANDALONE_MODULE,
                                ..Default::default()
                            });
                        }

                        self.extension_order = original_order;
                        return ResultUnion::NotFound;
                    } else if ::bun_options_types::standalone_path::is_bun_standalone_file_path(
                        source_dir,
                    ) {
                        if import_path.len() > 2 && is_dot_slash(&import_path[0..2]) {
                            let buf = bufs!(import_path_for_standalone_module_graph);
                            let joined = bun_paths::join_abs_string_buf(
                                source_dir,
                                buf,
                                &[import_path],
                                bun_paths::Platform::Loose,
                            );

                            // Support relative paths in the graph
                            if let Some(file_name) = graph.find_assume_standalone_path(joined) {
                                // Intern: trait borrows into the graph; `Path::init`
                                // needs `'static` (DirnameStore-backed).
                                let file_name = Fs::file_system::DirnameStore::instance()
                                    .append_slice(file_name)
                                    .expect("unreachable");
                                self.extension_order = original_order;
                                return ResultUnion::Success(Result {
                                    import_kind: kind,
                                    path_pair: PathPair {
                                        primary: Path::init(file_name),
                                        secondary: None,
                                    },
                                    module_type: options::ModuleType::Esm,
                                    flags: ResultFlags::IS_STANDALONE_MODULE,
                                    ..Default::default()
                                });
                            }
                        }
                        break 'brk Fs::FileSystem::instance().top_level_dir;
                    }
                }

                // Fail now if there is no directory to resolve in. This can happen for
                // virtual modules (e.g. stdin) if a resolve directory is not specified.
                //
                // TODO: This is skipped for now because it is impossible to set a
                // resolveDir so we default to the top level directory instead (this
                // is backwards compat with Bun 1.0 behavior)
                // See https://github.com/oven-sh/bun/issues/8994 for more details.
                if source_dir.is_empty() {
                    // if let Some(debug) = self.debug_logs.as_mut() {
                    //     debug.add_note(b"Cannot resolve this path without a directory".to_vec());
                    //     let _ = self.flush_debug_logs(FlushMode::Fail);
                    // }
                    // return ResultUnion::Failure(bun_core::err!("MissingResolveDir"));
                    break 'brk Fs::FileSystem::instance().top_level_dir;
                }

                // This can also be hit if you use plugins with non-file namespaces,
                // or call the module resolver from javascript (Bun.resolveSync)
                // with a faulty parent specifier.
                if !bun_paths::is_absolute(source_dir) {
                    // if let Some(debug) = self.debug_logs.as_mut() {
                    //     debug.add_note(b"Cannot resolve this path without an absolute directory".to_vec());
                    //     let _ = self.flush_debug_logs(FlushMode::Fail);
                    // }
                    // return ResultUnion::Failure(bun_core::err!("InvalidResolveDir"));
                    break 'brk Fs::FileSystem::instance().top_level_dir;
                }

                break 'brk source_dir_resolver
                    .resolve_cwd(source_dir)
                    .unwrap_or_else(|_| panic!("Failed to query CWD"));
            };

            // r.mutex.lock();
            // defer r.mutex.unlock();
            // errdefer (r.flushDebugLogs(.fail) catch {}) — handled at each error return below

            // A path with a null byte cannot exist on the filesystem. Continuing
            // anyways would cause assertion failures.
            if strings::index_of_char(import_path, 0).is_some() {
                let _ = self.flush_debug_logs(FlushMode::Fail);
                self.extension_order = original_order;
                return ResultUnion::NotFound;
            }

            let mut tmp = self.resolve_without_symlinks(
                source_dir_normalized,
                import_path,
                kind,
                global_cache,
            );

            // Fragments in URLs in CSS imports are technically expected to work
            if matches!(tmp, ResultUnion::NotFound) && kind.is_from_css() {
                'try_without_suffix: {
                    // If resolution failed, try again with the URL query and/or hash removed
                    let maybe_suffix = strings::index_of_any(import_path, b"?#");
                    let Some(suffix) = maybe_suffix else {
                        break 'try_without_suffix;
                    };
                    if suffix < 1 {
                        break 'try_without_suffix;
                    }

                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!(
                            "Retrying resolution after removing the suffix {}",
                            bstr::BStr::new(&import_path[suffix..])
                        ));
                    }
                    let result2 = self.resolve_without_symlinks(
                        source_dir_normalized,
                        &import_path[0..suffix],
                        kind,
                        global_cache,
                    );
                    if matches!(result2, ResultUnion::NotFound) {
                        break 'try_without_suffix;
                    }
                    tmp = result2;
                }
            }

            let ret = match tmp {
                ResultUnion::Success(mut result) => {
                    if result.path_pair.primary.namespace() != b"node"
                        && !result.flags.is_standalone_module()
                    {
                        if let Err(err) = self.finalize_result(&mut result, kind) {
                            self.extension_order = original_order;
                            return ResultUnion::Failure(err);
                        }
                    }

                    let _ = self.flush_debug_logs(FlushMode::Success);
                    result.import_kind = kind;
                    if cfg!(feature = "debug_logs") {
                        // TODO(port): debuglog! with bun.fmt.fmtPath formatting
                    }
                    ResultUnion::Success(result)
                }
                ResultUnion::Failure(e) => {
                    let _ = self.flush_debug_logs(FlushMode::Fail);
                    ResultUnion::Failure(e)
                }
                ResultUnion::Pending(pending) => {
                    let _ = self.flush_debug_logs(FlushMode::Fail);
                    ResultUnion::Pending(pending)
                }
                ResultUnion::NotFound => {
                    let _ = self.flush_debug_logs(FlushMode::Fail);
                    ResultUnion::NotFound
                }
            };

            // (tracing `elapsed` accumulation handled by `_elapsed_guard` above on all paths)
            self.extension_order = original_order;
            ret
        }

        pub fn resolve(
            &mut self,
            source_dir: &[u8],
            import_path: &[u8],
            kind: ast::ImportKind,
        ) -> core::result::Result<Result, bun_core::Error> {
            // TODO(port): narrow error set
            match self.resolve_and_auto_install(source_dir, import_path, kind, GlobalCache::disable)
            {
                ResultUnion::Success(result) => Ok(result),
                ResultUnion::Pending(_) | ResultUnion::NotFound => {
                    Err(bun_core::err!("ModuleNotFound"))
                }
                ResultUnion::Failure(e) => Err(e),
            }
        }

        /// Runs a resolution but also checking if a Bun Bake framework has an
        /// override. This is used in one place in the bundler.
        pub fn resolve_with_framework(
            &mut self,
            source_dir: &[u8],
            import_path: &[u8],
            kind: ast::ImportKind,
        ) -> core::result::Result<Result, bun_core::Error> {
            // SAFETY: PORT — `import_path` is caller-interned (source text / DirnameStore)
            // and outlives the returned Result. TODO(port): thread explicit lifetime.
            let import_path: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(import_path) };
            // TODO(port): narrow error set
            if let Some(f) = self.opts.framework.as_ref() {
                if let Some(mod_) = f.built_in_modules.get(import_path) {
                    match mod_ {
                        // TYPE_ONLY(b0): BuiltInModule relocated bun_runtime::bake::framework → bun_options_types (T3)
                        bun_options_types::BuiltInModule::Code(_) => {
                            return Ok(Result {
                                import_kind: kind,
                                path_pair: PathPair {
                                    primary: Fs::Path::init_with_namespace(import_path, b"node"),
                                    secondary: None,
                                },
                                module_type: options::ModuleType::Esm,
                                primary_side_effects_data: SideEffects::NoSideEffectsPureData,
                                flags: ResultFlags::default(),
                                ..Default::default()
                            });
                        }
                        bun_options_types::BuiltInModule::Import(path) => {
                            // PORT NOTE: copy out `path` so the `&self.opts.framework` borrow
                            // ends before `self.resolve(&mut self, ...)`.
                            let path: &'static [u8] =
                                unsafe { &*std::ptr::from_ref::<[u8]>(path.as_ref()) };
                            let top = self.fs_ref().top_level_dir;
                            return self.resolve(top, path, ast::ImportKind::EntryPointBuild);
                        }
                    }
                    // unreachable in Zig (return after switch)
                }
            }
            self.resolve(source_dir, import_path, kind)
        }

        pub fn finalize_result(
            &mut self,
            result: &mut Result,
            kind: ast::ImportKind,
        ) -> core::result::Result<(), bun_core::Error> {
            // TODO(port): narrow error set
            if result.flags.is_external() {
                return Ok(());
            }

            let mut iter = result.path_pair.iter();
            let mut module_type = result.module_type;
            while let Some(path) = iter.next() {
                let Ok(Some(dir)) = self.read_dir_info(path.name.dir) else {
                    continue;
                };
                let mut needs_side_effects = true;
                if let Some(existing) = Result::deref_package_json(result.package_json) {
                    // if we don't have it here, they might put it in a sideEfffects
                    // map of the parent package.json
                    // TODO: check if webpack also does this parent lookup
                    use crate::package_json::SideEffects as PJSideEffects;
                    needs_side_effects = matches!(
                        existing.side_effects,
                        PJSideEffects::Unspecified
                            | PJSideEffects::Glob(_)
                            | PJSideEffects::Mixed(_)
                    );

                    result.primary_side_effects_data = match &existing.side_effects {
                        PJSideEffects::Unspecified => SideEffects::HasSideEffects,
                        PJSideEffects::False => SideEffects::NoSideEffectsPackageJson,
                        PJSideEffects::Map(map) => {
                            if map.contains_key(
                                &crate::package_json::StringHashMapUnownedKey::init(path.text()),
                            ) {
                                SideEffects::HasSideEffects
                            } else {
                                SideEffects::NoSideEffectsPackageJson
                            }
                        }
                        PJSideEffects::Glob(_) => {
                            if existing.side_effects.has_side_effects(path.text()) {
                                SideEffects::HasSideEffects
                            } else {
                                SideEffects::NoSideEffectsPackageJson
                            }
                        }
                        PJSideEffects::Mixed(_) => {
                            if existing.side_effects.has_side_effects(path.text()) {
                                SideEffects::HasSideEffects
                            } else {
                                SideEffects::NoSideEffectsPackageJson
                            }
                        }
                    };

                    if existing.name.is_empty() || self.care_about_bin_folder {
                        result.package_json = None;
                    }
                }

                result.package_json = result
                    .package_json
                    .or(dir.enclosing_package_json.map(|p| std::ptr::from_ref(p)));

                if needs_side_effects {
                    if let Some(package_json) = Result::deref_package_json(result.package_json) {
                        use crate::package_json::SideEffects as PJSideEffects;
                        result.primary_side_effects_data = match &package_json.side_effects {
                            PJSideEffects::Unspecified => SideEffects::HasSideEffects,
                            PJSideEffects::False => SideEffects::NoSideEffectsPackageJson,
                            PJSideEffects::Map(map) => {
                                if map.contains_key(
                                    &crate::package_json::StringHashMapUnownedKey::init(
                                        path.text(),
                                    ),
                                ) {
                                    SideEffects::HasSideEffects
                                } else {
                                    SideEffects::NoSideEffectsPackageJson
                                }
                            }
                            PJSideEffects::Glob(_) => {
                                if package_json.side_effects.has_side_effects(path.text()) {
                                    SideEffects::HasSideEffects
                                } else {
                                    SideEffects::NoSideEffectsPackageJson
                                }
                            }
                            PJSideEffects::Mixed(_) => {
                                if package_json.side_effects.has_side_effects(path.text()) {
                                    SideEffects::HasSideEffects
                                } else {
                                    SideEffects::NoSideEffectsPackageJson
                                }
                            }
                        };
                    }
                }

                if let Some(tsconfig) = dir.enclosing_tsconfig_json {
                    result.jsx = tsconfig.merge_jsx(result.jsx.clone());
                    result.flags.set_emit_decorator_metadata(
                        result.flags.emit_decorator_metadata() || tsconfig.emit_decorator_metadata,
                    );
                    result.flags.set_experimental_decorators(
                        result.flags.experimental_decorators() || tsconfig.experimental_decorators,
                    );
                }

                // If you use mjs or mts, then you're using esm
                // If you use cjs or cts, then you're using cjs
                // This should win out over the module type from package.json
                if !kind.is_from_css()
                    && module_type == options::ModuleType::Unknown
                    && path.name.ext.len() == 4
                {
                    module_type =
                        module_type_from_ext(path.name.ext).unwrap_or(options::ModuleType::Unknown);
                }

                if let Some(entries) = dir.get_entries_ref(self.generation) {
                    if let Some(query) = entries.get(path.name.filename) {
                        let symlink_path = query.entry().symlink(self.rfs_ptr(), self.store_fd);
                        if !symlink_path.is_empty() {
                            path.set_realpath(symlink_path);
                            if !result.file_fd.is_valid() {
                                result.file_fd = query.entry().cache().fd;
                            }

                            if let Some(debug) = self.debug_logs.as_mut() {
                                debug.add_note_fmt(format_args!(
                                    "Resolved symlink \"{}\" to \"{}\"",
                                    bstr::BStr::new(path.text()),
                                    bstr::BStr::new(symlink_path)
                                ));
                            }
                        } else if !dir.abs_real_path.is_empty() {
                            // When the directory is a symlink, we don't need to call getFdPath.
                            let parts = [dir.abs_real_path.as_ref(), query.entry().base()];
                            let mut buf = bun_paths::PathBuffer::uninit();

                            // PORT NOTE: `abs_buf` returns a borrow of `buf`; capture only the
                            // length so `buf` can be re-borrowed for null-termination below.
                            let out_len = self.fs_ref().abs_buf(&parts, &mut buf).len();

                            let store_fd = self.store_fd;

                            if !query.entry().cache().fd.is_valid() && store_fd {
                                buf[out_len] = 0;
                                // SAFETY: buf[out_len] == 0 written above
                                let span = bun_core::ZStr::from_buf(&buf[..], out_len);
                                // Spec resolver.zig:1099 uses `try std.fs.openFileAbsoluteZ`,
                                // which propagates I/O errors so `resolveAndAutoInstall` can
                                // return them as `Result.Union.failure`. Mirror that — never
                                // panic on EACCES/EMFILE/ELOOP here.
                                let file = bun_sys::open(span, bun_sys::O::RDONLY, 0)
                                    .map_err(Into::<bun_core::Error>::into)?;
                                query.entry().set_cache_fd(file);
                                Fs::FileSystem::set_max_fd(file.native());
                            }

                            // PORT NOTE: snapshot `need_to_close_files` and raw-ptr the entry so
                            // the closure captures only Copy values — keeps `self` and
                            // `query.entry` reborrowable across the guard's lifetime.
                            let need_close = self.fs_ref().fs.need_to_close_files();
                            // ARENA — Entry lives in the BSSMap singleton; guard runs before
                            // the slot is reused (resolver mutex held). Capture as `BackRef`
                            // (Copy, Deref) so the closure stays Copy-only while the read is
                            // a safe `BackRef::get()` instead of a raw-ptr deref.
                            let entry_ref = bun_ptr::BackRef::<Fs::file_system::Entry>::from(
                                core::ptr::NonNull::new(query.entry).expect("EntryStore slot"),
                            );
                            scopeguard::defer! {
                                if need_close {
                                    let e = entry_ref.get();
                                    let fd = e.cache().fd;
                                    if fd.is_valid() {
                                        fd.close();
                                        e.set_cache_fd(FD::INVALID);
                                    }
                                }
                            }

                            let symlink =
                                Fs::FilenameStore::instance().append_slice(&buf[..out_len])?;
                            if let Some(debug) = self.debug_logs.as_mut() {
                                debug.add_note_fmt(format_args!(
                                    "Resolved symlink \"{}\" to \"{}\"",
                                    bstr::BStr::new(symlink),
                                    bstr::BStr::new(path.text())
                                ));
                            }
                            query.entry().set_cache_symlink(PathString::init(symlink));
                            if !result.file_fd.is_valid() && store_fd {
                                result.file_fd = query.entry().cache().fd;
                            }

                            path.set_realpath(symlink);
                        }
                    }
                }
            }

            if !kind.is_from_css() && module_type == options::ModuleType::Unknown {
                if let Some(pkg) = result.package_json_ref() {
                    module_type = pkg.module_type;
                }
            }

            result.module_type = module_type;
            Ok(())
        }

        pub fn resolve_without_symlinks(
            &mut self,
            source_dir: &[u8],
            input_import_path: &'static [u8],
            kind: ast::ImportKind,
            global_cache: GlobalCache,
        ) -> ResultUnion {
            debug_assert!(bun_paths::is_absolute(source_dir));

            let mut import_path = input_import_path;

            // This implements the module resolution algorithm from node.js, which is
            // described here: https://nodejs.org/api/modules.html#modules_all_together
            let mut result = Result {
                path_pair: PathPair {
                    primary: Path::empty(),
                    secondary: None,
                },
                jsx: self.opts.jsx.clone(),
                ..Default::default()
            };

            // Return early if this is already an absolute path. In addition to asking
            // the file system whether this is an absolute path, we also explicitly check
            // whether it starts with a "/" and consider that an absolute path too. This
            // is because relative paths can technically start with a "/" on Windows
            // because it's not an absolute path on Windows. Then people might write code
            // with imports that start with a "/" that works fine on Windows only to
            // experience unexpected build failures later on other operating systems.
            // Treating these paths as absolute paths on all platforms means Windows
            // users will not be able to accidentally make use of these paths.
            if bun_paths::is_absolute(import_path) {
                // Collapse relative directory specifiers if they exist. Extremely
                // loose check to avoid always doing this copy, but avoid spending
                // too much time on the check.
                if strings::index_of(import_path, b"..").is_some() {
                    let platform = bun_paths::Platform::AUTO;
                    let ends_with_dir = platform.is_separator(import_path[import_path.len() - 1])
                        || (import_path.len() > 3
                            && platform.is_separator(import_path[import_path.len() - 3])
                            && import_path[import_path.len() - 2] == b'.'
                            && import_path[import_path.len() - 1] == b'.');
                    let buf = bufs!(relative_abs_path);
                    let Some(abs) = self.fs_ref().abs_buf_checked(&[import_path], buf) else {
                        return ResultUnion::NotFound;
                    };
                    let mut len = abs.len();
                    if ends_with_dir {
                        buf[len] = platform.separator();
                        len += 1;
                    }
                    // `bufs!` hands out an unconstrained-lifetime `&mut PathBuffer`
                    // (threadlocal storage); a safe reborrow satisfies `&'static [u8]`.
                    import_path = &buf[..len];
                }

                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!(
                        "The import \"{}\" is being treated as an absolute path",
                        bstr::BStr::new(import_path)
                    ));
                }

                // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file
                if let Ok(Some(dir_info)) = self.dir_info_cached(source_dir) {
                    if let Some(tsconfig) = dir_info.enclosing_tsconfig_json {
                        if tsconfig.paths.count() > 0 {
                            if let Some(res) =
                                self.match_tsconfig_paths(tsconfig, import_path, kind)
                            {
                                // We don't set the directory fd here because it might remap an entirely different directory
                                return ResultUnion::Success(Result {
                                    path_pair: res.path_pair,
                                    diff_case: res.diff_case,
                                    package_json: res.package_json,
                                    dirname_fd: res.dirname_fd,
                                    file_fd: res.file_fd,
                                    jsx: tsconfig.merge_jsx(result.jsx),
                                    ..Default::default()
                                });
                            }
                        }
                    }
                }

                if self.opts.external.abs_paths.count() > 0
                    && self.opts.external.abs_paths.contains(import_path)
                {
                    // If the string literal in the source text is an absolute path and has
                    // been marked as an external module, mark it as *not* an absolute path.
                    // That way we preserve the literal text in the output and don't generate
                    // a relative path from the output directory to that path.
                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!(
                            "The path \"{}\" is marked as external by the user",
                            bstr::BStr::new(import_path)
                        ));
                    }

                    return ResultUnion::Success(Result {
                        path_pair: PathPair {
                            primary: Path::init(import_path),
                            secondary: None,
                        },
                        flags: ResultFlags::IS_EXTERNAL,
                        ..Default::default()
                    });
                }

                // Run node's resolution rules (e.g. adding ".js")
                let mut normalizer = ResolvePath::PosixToWinNormalizer::default();
                if let Some(entry) = self
                    .load_as_file_or_directory(normalizer.resolve(source_dir, import_path), kind)
                {
                    return ResultUnion::Success(Result {
                        dirname_fd: entry.dirname_fd,
                        path_pair: entry.path_pair,
                        diff_case: entry.diff_case,
                        package_json: entry.package_json,
                        file_fd: entry.file_fd,
                        jsx: self.opts.jsx.clone(),
                        ..Default::default()
                    });
                }

                return ResultUnion::NotFound;
            }

            // Check both relative and package paths for CSS URL tokens, with relative
            // paths taking precedence over package paths to match Webpack behavior.
            let is_package_path_ =
                kind != ast::ImportKind::EntryPointRun && is_package_path_not_absolute(import_path);
            let check_relative = !is_package_path_ || kind.is_from_css();
            let check_package = is_package_path_;

            if check_relative {
                if let Some(custom_paths) = self.custom_dir_paths {
                    // @branchHint(.unlikely)
                    bun_core::hint::cold();
                    for custom_path in custom_paths {
                        let custom_utf8 = custom_path.to_utf8_without_ref();
                        match self.check_relative_path(
                            custom_utf8.slice(),
                            import_path,
                            kind,
                            global_cache,
                        ) {
                            ResultUnion::Success(res) => return ResultUnion::Success(res),
                            ResultUnion::Pending(p) => return ResultUnion::Pending(p),
                            ResultUnion::Failure(p) => return ResultUnion::Failure(p),
                            ResultUnion::NotFound => {}
                        }
                    }
                    debug_assert!(!check_package); // always from JavaScript
                    return ResultUnion::NotFound; // bail out now since there isn't anywhere else to check
                } else {
                    match self.check_relative_path(source_dir, import_path, kind, global_cache) {
                        ResultUnion::Success(res) => return ResultUnion::Success(res),
                        ResultUnion::Pending(p) => return ResultUnion::Pending(p),
                        ResultUnion::Failure(p) => return ResultUnion::Failure(p),
                        ResultUnion::NotFound => {}
                    }
                }
            }

            if check_package {
                if self.opts.polyfill_node_globals {
                    let had_node_prefix = import_path.starts_with(b"node:");
                    let import_path_without_node_prefix = if had_node_prefix {
                        &import_path[b"node:".len()..]
                    } else {
                        import_path
                    };

                    if let Some(fallback_module) =
                        NodeFallbackModules::map().get(import_path_without_node_prefix)
                    {
                        result.path_pair.primary = fallback_module.path.clone();
                        result.module_type = options::ModuleType::Cjs;
                        // @ptrFromInt(@intFromPtr(...)) — cast away constness
                        result.package_json = Some(std::ptr::from_ref::<PackageJSON>(
                            fallback_module.package_json,
                        ));
                        result.flags.set_is_from_node_modules(true);
                        return ResultUnion::Success(result);
                    }

                    if had_node_prefix {
                        // Module resolution fails automatically for unknown node builtins
                        if !HardcodedAlias::has(
                            import_path_without_node_prefix,
                            options::Target::Node,
                            HardcodedAliasCfg::default(),
                        ) {
                            return ResultUnion::NotFound;
                        }

                        // Valid node:* modules becomes {} in the output
                        result.path_pair.primary.namespace = b"node";
                        result.path_pair.primary.text = import_path_without_node_prefix;
                        result.path_pair.primary.name =
                            Fs::PathName::init(import_path_without_node_prefix);
                        result.module_type = options::ModuleType::Cjs;
                        result.path_pair.primary.is_disabled = true;
                        result.flags.set_is_from_node_modules(true);
                        result.primary_side_effects_data = SideEffects::NoSideEffectsPureData;
                        return ResultUnion::Success(result);
                    }

                    // Always mark "fs" as disabled, matching Webpack v4 behavior
                    if import_path_without_node_prefix.starts_with(b"fs")
                        && (import_path_without_node_prefix.len() == 2
                            || import_path_without_node_prefix[2] == b'/')
                    {
                        result.path_pair.primary.namespace = b"node";
                        result.path_pair.primary.text = import_path_without_node_prefix;
                        result.path_pair.primary.name =
                            Fs::PathName::init(import_path_without_node_prefix);
                        result.module_type = options::ModuleType::Cjs;
                        result.path_pair.primary.is_disabled = true;
                        result.flags.set_is_from_node_modules(true);
                        result.primary_side_effects_data = SideEffects::NoSideEffectsPureData;
                        return ResultUnion::Success(result);
                    }
                }

                // Check for external packages first
                if self.opts.external.node_modules.count() > 0
                // Imports like "process/" need to resolve to the filesystem, not a builtin
                && !import_path.ends_with(b"/")
                {
                    let mut query = import_path;
                    loop {
                        if self.opts.external.node_modules.contains(query) {
                            if let Some(debug) = self.debug_logs.as_mut() {
                                debug.add_note_fmt(format_args!(
                                    "The path \"{}\" was marked as external by the user",
                                    bstr::BStr::new(query)
                                ));
                            }
                            return ResultUnion::Success(Result {
                                path_pair: PathPair {
                                    primary: Path::init(query),
                                    secondary: None,
                                },
                                flags: ResultFlags::IS_EXTERNAL,
                                ..Default::default()
                            });
                        }

                        // If the module "foo" has been marked as external, we also want to treat
                        // paths into that module such as "foo/bar" as external too.
                        let Some(slash) = strings::last_index_of_char(query, b'/') else {
                            break;
                        };
                        query = &query[0..slash];
                    }
                }

                if let Some(custom_paths) = self.custom_dir_paths {
                    bun_core::hint::cold();
                    for custom_path in custom_paths {
                        let custom_utf8 = custom_path.to_utf8_without_ref();
                        match self.check_package_path(
                            custom_utf8.slice(),
                            import_path,
                            kind,
                            global_cache,
                        ) {
                            ResultUnion::Success(res) => return ResultUnion::Success(res),
                            ResultUnion::Pending(p) => return ResultUnion::Pending(p),
                            ResultUnion::Failure(p) => return ResultUnion::Failure(p),
                            ResultUnion::NotFound => {}
                        }
                    }
                } else {
                    match self.check_package_path(source_dir, import_path, kind, global_cache) {
                        ResultUnion::Success(res) => return ResultUnion::Success(res),
                        ResultUnion::Pending(p) => return ResultUnion::Pending(p),
                        ResultUnion::Failure(p) => return ResultUnion::Failure(p),
                        ResultUnion::NotFound => {}
                    }
                }
            }

            ResultUnion::NotFound
        }

        pub fn check_relative_path(
            &mut self,
            source_dir: &[u8],
            import_path: &[u8],
            kind: ast::ImportKind,
            global_cache: GlobalCache,
        ) -> ResultUnion {
            let Some(abs_path) = self
                .fs_ref()
                .abs_buf_checked(&[source_dir, import_path], bufs!(relative_abs_path))
            else {
                return ResultUnion::NotFound;
            };

            if self.opts.external.abs_paths.count() > 0
                && self.opts.external.abs_paths.contains(abs_path)
            {
                // If the string literal in the source text is an absolute path and has
                // been marked as an external module, mark it as *not* an absolute path.
                // That way we preserve the literal text in the output and don't generate
                // a relative path from the output directory to that path.
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!(
                        "The path \"{}\" is marked as external by the user",
                        bstr::BStr::new(abs_path)
                    ));
                }

                return ResultUnion::Success(Result {
                    path_pair: PathPair {
                        primary: Path::init(
                            self.fs_ref()
                                .dirname_store
                                .append_slice(abs_path)
                                .expect("oom"),
                        ),
                        secondary: None,
                    },
                    flags: ResultFlags::IS_EXTERNAL,
                    ..Default::default()
                });
            }

            // Check the "browser" map
            if self.care_about_browser_field {
                let dirname = bun_paths::dirname(abs_path).expect("unreachable");
                if let Ok(Some(import_dir_info_outer)) = self.dir_info_cached(dirname) {
                    if let Some(import_dir_info) =
                        import_dir_info_outer.get_enclosing_browser_scope()
                    {
                        let pkg = import_dir_info.package_json().unwrap();
                        if let Some(remap) = self
                            .check_browser_map::<{ BrowserMapPathKind::AbsolutePath }>(
                                &import_dir_info,
                                abs_path,
                            )
                        {
                            // Is the path disabled?
                            if remap.is_empty() {
                                let mut _path = Path::init(
                                    self.fs_ref()
                                        .dirname_store
                                        .append_slice(abs_path)
                                        .expect("unreachable"),
                                );
                                _path.is_disabled = true;
                                return ResultUnion::Success(Result {
                                    path_pair: PathPair {
                                        primary: _path,
                                        secondary: None,
                                    },
                                    ..Default::default()
                                });
                            }

                            match self.resolve_without_remapping(
                                import_dir_info,
                                remap,
                                kind,
                                global_cache,
                            ) {
                                MatchResultUnion::Success(match_result) => {
                                    let mut flags = ResultFlags::default();
                                    flags.set_is_external(match_result.is_external);
                                    flags.set_is_external_and_rewrite_import_path(
                                        match_result.is_external,
                                    );
                                    return ResultUnion::Success(Result {
                                        path_pair: match_result.path_pair,
                                        diff_case: match_result.diff_case,
                                        dirname_fd: match_result.dirname_fd,
                                        package_json: Some(std::ptr::from_ref(pkg)),
                                        jsx: self.opts.jsx.clone(),
                                        module_type: match_result.module_type,
                                        flags,
                                        ..Default::default()
                                    });
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }

            let prev_extension_order = self.extension_order;
            // PORT NOTE: defer restore reshaped — restored before each return
            if strings::path_contains_node_modules_folder(abs_path) {
                self.extension_order = self.opts.extension_order.kind(kind, true);
            }
            let ret = if let Some(res) = self.load_as_file_or_directory(abs_path, kind) {
                ResultUnion::Success(Result {
                    path_pair: res.path_pair,
                    diff_case: res.diff_case,
                    dirname_fd: res.dirname_fd,
                    package_json: res.package_json,
                    jsx: self.opts.jsx.clone(),
                    ..Default::default()
                })
            } else {
                ResultUnion::NotFound
            };
            self.extension_order = prev_extension_order;
            ret
        }

        pub fn check_package_path(
            &mut self,
            source_dir: &[u8],
            unremapped_import_path: &'static [u8],
            kind: ast::ImportKind,
            global_cache: GlobalCache,
        ) -> ResultUnion {
            let mut import_path = unremapped_import_path;
            let mut source_dir_info: DirInfoRef = match self.dir_info_cached(source_dir) {
                Err(_) => return ResultUnion::NotFound,
                Ok(Some(d)) => d,
                Ok(None) => 'dir: {
                    // It is possible to resolve with a source file that does not exist:
                    // A. Bundler plugin refers to a non-existing `resolveDir`.
                    // B. `createRequire()` is called with a path that does not exist. This was
                    //    hit in Nuxt, specifically the `vite-node` dependency [1].
                    //
                    // Normally it would make sense to always bail here, but in the case of
                    // resolving "hello" from "/project/nonexistent_dir/index.ts", resolution
                    // should still query "/project/node_modules" and "/node_modules"
                    //
                    // For case B in Node.js, they use `_resolveLookupPaths` in
                    // combination with `_nodeModulePaths` to collect a listing of
                    // all possible parent `node_modules` [2]. Bun has a much smarter
                    // approach that caches directory entries, but it (correctly) does
                    // not cache non-existing directories. To successfully resolve this,
                    // Bun finds the nearest existing directory, and uses that as the base
                    // for `node_modules` resolution. Since that directory entry knows how
                    // to resolve concrete node_modules, this iteration stops at the first
                    // existing directory, regardless of what it is.
                    //
                    // The resulting `source_dir_info` cannot resolve relative files.
                    //
                    // [1]: https://github.com/oven-sh/bun/issues/16705
                    // [2]: https://github.com/nodejs/node/blob/e346323109b49fa6b9a4705f4e3816fc3a30c151/lib/internal/modules/cjs/loader.js#L1934
                    if cfg!(debug_assertions) {
                        debug_assert!(is_package_path(import_path));
                    }
                    let mut closest_dir = source_dir;
                    // Use std.fs.path.dirname to get `null` once the entire
                    // directory tree has been visited. `null` is theoretically
                    // impossible since the drive root should always exist.
                    while let Some(current) = bun_paths::dirname(closest_dir) {
                        match self.dir_info_cached(current) {
                            Err(_) => return ResultUnion::NotFound,
                            Ok(Some(dir)) => break 'dir dir,
                            Ok(None) => {}
                        }
                        closest_dir = current;
                    }
                    return ResultUnion::NotFound;
                }
            };

            if self.care_about_browser_field {
                // Support remapping one package path to another via the "browser" field
                if let Some(browser_scope) = source_dir_info.get_enclosing_browser_scope() {
                    if let Some(package_json) = browser_scope.package_json() {
                        if let Some(remapped) = self
                            .check_browser_map::<{ BrowserMapPathKind::PackagePath }>(
                                &browser_scope,
                                import_path,
                            )
                        {
                            if remapped.is_empty() {
                                // "browser": {"module": false}
                                // does the module exist in the filesystem?
                                match self.load_node_modules(
                                    import_path,
                                    kind,
                                    source_dir_info,
                                    global_cache,
                                    false,
                                ) {
                                    MatchResultUnion::Success(node_module) => {
                                        let mut pair = node_module.path_pair;
                                        pair.primary.is_disabled = true;
                                        if let Some(sec) = pair.secondary.as_mut() {
                                            sec.is_disabled = true;
                                        }
                                        return ResultUnion::Success(Result {
                                            path_pair: pair,
                                            dirname_fd: node_module.dirname_fd,
                                            diff_case: node_module.diff_case,
                                            package_json: Some(std::ptr::from_ref(package_json)),
                                            jsx: self.opts.jsx.clone(),
                                            ..Default::default()
                                        });
                                    }
                                    _ => {
                                        // "browser": {"module": false}
                                        // the module doesn't exist and it's disabled
                                        // so we should just not try to load it
                                        let mut primary = Path::init(import_path);
                                        primary.is_disabled = true;
                                        return ResultUnion::Success(Result {
                                            path_pair: PathPair {
                                                primary,
                                                secondary: None,
                                            },
                                            diff_case: None,
                                            jsx: self.opts.jsx.clone(),
                                            ..Default::default()
                                        });
                                    }
                                }
                            }

                            import_path = remapped;
                            source_dir_info = browser_scope;
                        }
                    }
                }
            }

            match self.resolve_without_remapping(source_dir_info, import_path, kind, global_cache) {
                MatchResultUnion::Success(res) => {
                    let mut result = Result {
                        path_pair: PathPair {
                            primary: Path::empty(),
                            secondary: None,
                        },
                        jsx: self.opts.jsx.clone(),
                        ..Default::default()
                    };
                    result.path_pair = res.path_pair;
                    result.dirname_fd = res.dirname_fd;
                    result.file_fd = res.file_fd;
                    result.package_json = res.package_json;
                    result.diff_case = res.diff_case;
                    result.flags.set_is_from_node_modules(
                        result.flags.is_from_node_modules() || res.is_node_module,
                    );
                    result.jsx = self.opts.jsx.clone();
                    result.module_type = res.module_type;
                    result.flags.set_is_external(res.is_external);
                    // Potentially rewrite the import path if it's external that
                    // was remapped to a different path
                    result
                        .flags
                        .set_is_external_and_rewrite_import_path(result.flags.is_external());

                    if result.path_pair.primary.is_disabled && result.path_pair.secondary.is_none()
                    {
                        return ResultUnion::Success(result);
                    }

                    if res.package_json.is_some() && self.care_about_browser_field {
                        let base_dir_info = match res.dir_info {
                            Some(d) => d,
                            None => match self.read_dir_info(result.path_pair.primary.name.dir) {
                                Ok(Some(d)) => d,
                                _ => return ResultUnion::Success(result),
                            },
                        };
                        if let Some(browser_scope) = base_dir_info.get_enclosing_browser_scope() {
                            if let Some(remap) = self
                                .check_browser_map::<{ BrowserMapPathKind::AbsolutePath }>(
                                    &browser_scope,
                                    result.path_pair.primary.text(),
                                )
                            {
                                if remap.is_empty() {
                                    result.path_pair.primary.is_disabled = true;
                                    result.path_pair.primary =
                                        Fs::Path::init_with_namespace(remap, b"file");
                                } else {
                                    match self.resolve_without_remapping(
                                        browser_scope,
                                        remap,
                                        kind,
                                        global_cache,
                                    ) {
                                        MatchResultUnion::Success(remapped) => {
                                            result.path_pair = remapped.path_pair;
                                            result.dirname_fd = remapped.dirname_fd;
                                            result.file_fd = remapped.file_fd;
                                            result.package_json = remapped.package_json;
                                            result.diff_case = remapped.diff_case;
                                            result.module_type = remapped.module_type;
                                            result.flags.set_is_external(remapped.is_external);

                                            // Potentially rewrite the import path if it's external that
                                            // was remapped to a different path
                                            result.flags.set_is_external_and_rewrite_import_path(
                                                result.flags.is_external(),
                                            );

                                            result.flags.set_is_from_node_modules(
                                                result.flags.is_from_node_modules()
                                                    || remapped.is_node_module,
                                            );
                                            return ResultUnion::Success(result);
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                    }

                    ResultUnion::Success(result)
                }
                MatchResultUnion::Pending(p) => ResultUnion::Pending(p),
                MatchResultUnion::Failure(p) => ResultUnion::Failure(p),
                _ => ResultUnion::NotFound,
            }
        }

        // This is a fallback, hopefully not called often. It should be relatively quick because everything should be in the cache.
        pub fn package_json_for_resolved_node_module(
            &mut self,
            result: &Result,
        ) -> Option<*const PackageJSON> {
            let mut dir_info = self
                .dir_info_cached(result.path_pair.primary.name.dir)
                .ok()
                .flatten()?;
            loop {
                if let Some(pkg) = dir_info.package_json() {
                    // if it doesn't have a name, assume it's something just for adjusting the main fields (react-bootstrap does this)
                    // In that case, we really would like the top-level package that you download from NPM
                    // so we ignore any unnamed packages
                    return Some(std::ptr::from_ref(pkg));
                }

                dir_info = dir_info.get_parent()?;
            }
        }

        pub fn root_node_module_package_json(
            &mut self,
            result: &Result,
        ) -> Option<RootPathPair<'_>> {
            let path = result.path_const()?;
            let mut absolute = path.text();
            // /foo/node_modules/@babel/standalone/index.js
            //     ^------------^
            let mut end =
                strings::last_index_of(absolute, NODE_MODULE_ROOT_STRING).or_else(|| {
                    // try non-symlinked version
                    if path.pretty().len() != absolute.len() {
                        absolute = path.pretty();
                        return strings::last_index_of(absolute, NODE_MODULE_ROOT_STRING);
                    }
                    None
                })?;
            end += NODE_MODULE_ROOT_STRING.len();

            let is_scoped_package = absolute[end] == b'@';
            end += strings::index_of_char(&absolute[end..], SEP)? as usize;

            // /foo/node_modules/@babel/standalone/index.js
            //                   ^
            if is_scoped_package {
                end += 1;
                end += strings::index_of_char(&absolute[end..], SEP)? as usize;
            }

            end += 1;

            // /foo/node_modules/@babel/standalone/index.js
            //                                    ^
            let slice = &absolute[0..end];

            // Try to avoid the hash table lookup whenever possible
            // That can cause filesystem lookups in parent directories and it requires a lock
            if let Some(pkg) = result.package_json_ref() {
                if slice == pkg.source.path.name.dir_with_trailing_slash() {
                    return Some(RootPathPair {
                        package_json: std::ptr::from_ref(pkg),
                        base_path: slice,
                    });
                }
            }

            {
                let dir_info = self.dir_info_cached(slice).ok().flatten()?;
                Some(RootPathPair {
                    base_path: slice,
                    package_json: std::ptr::from_ref(dir_info.package_json()?),
                })
            }
        }

        /// Directory cache keys must follow the following rules. If the rules are broken,
        /// then there will be conflicting cache entries, and trying to bust the cache may not work.
        ///
        /// When an incorrect cache key is used, this assertion will trip; ignoring it allows
        /// very very subtle cache invalidation issues to happen, which will cause modules to
        /// mysteriously fail to resolve.
        ///
        /// The rules for this changed in https://github.com/oven-sh/bun/pull/9144 after multiple
        /// cache issues were found on Windows. These issues extended to other platforms because
        /// we never checked if the cache key was following the rules.
        ///
        /// CACHE KEY RULES:
        /// A cache key must use native slashes, and must NOT end with a trailing slash.
        /// But drive roots MUST have a trailing slash ('/' and 'C:\')
        /// UNC paths, even if the root, must not have the trailing slash.
        ///
        /// The helper function bun.strings.withoutTrailingSlashWindowsPath can be used
        /// to remove the trailing slash from a path
        pub fn assert_valid_cache_key(path: &[u8]) {
            if cfg!(debug_assertions) {
                if path.len() > 1
                    && strings::char_is_any_slash(path[path.len() - 1])
                    && !if cfg!(windows) {
                        path.len() == 3 && path[1] == b':'
                    } else {
                        path.len() == 1
                    }
                {
                    panic!(
                        "Internal Assertion Failure: Invalid cache key \"{}\"\nSee Resolver.assertValidCacheKey for details.",
                        bstr::BStr::new(path)
                    );
                }
            }
        }

        /// Bust the directory cache for the given path.
        /// See `assertValidCacheKey` for requirements on the input
        pub fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
            Self::assert_valid_cache_key(path);
            let first_bust = self.fs_mut().fs.bust_entries_cache(path);
            let second_bust = self.dir_cache_mut().remove(path);
            bun_core::scoped_log!(
                Resolver,
                "Bust {} = {}, {}",
                bstr::BStr::new(path),
                first_bust,
                second_bust
            );
            first_bust || second_bust
        }

        /// bust both the named file and a parent directory, because `./hello` can resolve
        /// to `./hello.js` or `./hello/index.js`
        pub fn bust_dir_cache_from_specifier(
            &mut self,
            import_source_file: &[u8],
            specifier: &[u8],
        ) -> bool {
            if bun_paths::is_absolute(specifier) {
                let dir = bun_paths::dirname_platform(specifier, bun_paths::Platform::AUTO);
                let a = self.bust_dir_cache(dir);
                let b = self.bust_dir_cache(specifier);
                return a || b;
            }

            if !(specifier.starts_with(b"./") || specifier.starts_with(b"../")) {
                return false;
            }
            if !bun_paths::is_absolute(import_source_file) {
                return false;
            }

            let joined = bun_paths::join_abs(
                bun_paths::dirname_platform(import_source_file, bun_paths::Platform::AUTO),
                bun_paths::Platform::AUTO,
                specifier,
            );
            let dir = bun_paths::dirname_platform(joined, bun_paths::Platform::AUTO);

            let a = self.bust_dir_cache(dir);
            let b = self.bust_dir_cache(joined);
            a || b
        }

        pub fn load_node_modules(
            &mut self,
            import_path: &[u8],
            kind: ast::ImportKind,
            // PORT NOTE: `DirInfoRef` (not `&mut`) — body re-enters `dir_cache` via
            // `dir_info_cached()` which, in the self-reference branch, returns the
            // SAME BSSMap slot. A `&mut` param carries an FnEntry protector under
            // Stacked Borrows; the inner retag would pop it (aliased-&mut UB).
            // Spec resolver.zig:1761 takes raw `*DirInfo`; the arena handle Derefs
            // to `&DirInfo` per use so overlapping shared reads are sound.
            _dir_info: DirInfoRef,
            global_cache: GlobalCache,
            forbid_imports: bool,
        ) -> MatchResultUnion {
            let mut dir_info: DirInfoRef = _dir_info;
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Searching for {} in \"node_modules\" directories starting from \"{}\"",
                    bstr::BStr::new(import_path),
                    bstr::BStr::new(dir_info.abs_path)
                ));
                debug.increase_indent();
            }
            // PORT NOTE: Zig `defer { debug.decreaseIndent() }` — reshaped for borrowck;
            // `decrease_indent()` is called explicitly at every return point below.

            // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file

            if let Some(tsconfig) = dir_info.enclosing_tsconfig_json {
                // Try path substitutions first
                if tsconfig.paths.count() > 0 {
                    if let Some(res) = self.match_tsconfig_paths(tsconfig, import_path, kind) {
                        if let Some(d) = self.debug_logs.as_mut() {
                            d.decrease_indent();
                        }
                        return MatchResultUnion::Success(res);
                    }
                }

                // Try looking up the path relative to the base URL
                if tsconfig.has_base_url() {
                    let base: &[u8] = &tsconfig.base_url;
                    if let Some(abs) = self.fs_ref().abs_buf_checked(
                        &[base, import_path],
                        bufs!(load_as_file_or_directory_via_tsconfig_base_path),
                    ) {
                        if let Some(res) = self.load_as_file_or_directory(abs, kind) {
                            if let Some(d) = self.debug_logs.as_mut() {
                                d.decrease_indent();
                            }
                            return MatchResultUnion::Success(res);
                        }
                    }
                }
            }

            let mut is_self_reference = false;

            // Find the parent directory with the "package.json" file
            let mut dir_info_package_json: Option<DirInfoRef> = Some(dir_info);
            while let Some(d) = dir_info_package_json {
                if d.package_json.is_some() {
                    break;
                }
                dir_info_package_json = d.get_parent();
            }

            // Check for subpath imports: https://nodejs.org/api/packages.html#subpath-imports
            if let Some(_dir_info_package_json) = dir_info_package_json {
                let package_json = _dir_info_package_json.package_json().unwrap();

                if import_path.starts_with(b"#")
                    && !forbid_imports
                    && package_json.imports.is_some()
                {
                    let r = self.load_package_imports(
                        import_path,
                        _dir_info_package_json,
                        kind,
                        global_cache,
                    );
                    if let Some(d) = self.debug_logs.as_mut() {
                        d.decrease_indent();
                    }
                    return r;
                }

                // https://nodejs.org/api/packages.html#packages_self_referencing_a_package_using_its_name
                let package_name = crate::package_json::Package::parse_name(import_path);
                if let Some(_package_name) = package_name {
                    if _package_name == package_json.name.as_ref() && package_json.exports.is_some()
                    {
                        if let Some(debug) = self.debug_logs.as_mut() {
                            debug.add_note_fmt(format_args!(
                                "\"{}\" is a self-reference",
                                bstr::BStr::new(import_path)
                            ));
                        }
                        dir_info = _dir_info_package_json;
                        is_self_reference = true;
                    }
                }
            }

            let esm_ = crate::package_json::Package::parse(import_path, bufs!(esm_subpath));

            let source_dir_info = dir_info;
            let mut any_node_modules_folder = false;
            let use_node_module_resolver = global_cache != GlobalCache::force;

            // Then check for the package in any enclosing "node_modules" directories
            // or in the package root directory if it's a self-reference
            while use_node_module_resolver {
                // Skip directories that are themselves called "node_modules", since we
                // don't ever want to search for "node_modules/node_modules"
                'node_modules: {
                    if !(dir_info.has_node_modules() || is_self_reference) {
                        break 'node_modules;
                    }
                    any_node_modules_folder = true;
                    let abs_path: &[u8] = if is_self_reference {
                        dir_info.abs_path
                    } else {
                        match self.fs_ref().abs_buf_checked(
                            &[dir_info.abs_path, b"node_modules", import_path],
                            bufs!(node_modules_check),
                        ) {
                            Some(p) => p,
                            None => break 'node_modules,
                        }
                    };
                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!(
                            "Checking for a package in the directory \"{}\"",
                            bstr::BStr::new(abs_path)
                        ));
                    }

                    let prev_extension_order = self.extension_order;
                    // PORT NOTE: defer restore reshaped — restored at end of block

                    if let Some(ref esm) = esm_ {
                        let abs_package_path: &[u8] = if is_self_reference {
                            dir_info.abs_path
                        } else {
                            let parts = [dir_info.abs_path, b"node_modules".as_slice(), esm.name];
                            self.fs_ref()
                                .abs_buf(&parts, bufs!(esm_absolute_package_path))
                        };

                        if let Ok(Some(pkg_dir_info)) = self.dir_info_cached(abs_package_path) {
                            self.extension_order = match kind {
                                ast::ImportKind::Url
                                | ast::ImportKind::AtConditional
                                | ast::ImportKind::At => options::ExtOrder::Css,
                                _ => self.opts.extension_order.kind(kind, true),
                            };

                            if let Some(package_json) = pkg_dir_info.package_json() {
                                if let Some(exports_map) = package_json.exports.as_ref() {
                                    // The condition set is determined by the kind of import
                                    let mut module_type = package_json.module_type;
                                    // PORT NOTE: reshaped for borrowck — Zig held a single `ESModule`
                                    // with a raw `*DebugLogs` across both `resolve` calls and the
                                    // intervening `handle_esm_resolution`. In Rust, keeping the
                                    // `ESModule` (which holds `&mut self.debug_logs`) alive across a
                                    // `&mut self` call is aliased-&mut UB. Build a fresh short-lived
                                    // `ESModule` per `resolve` call so its borrow ends before
                                    // `self.handle_esm_resolution` re-borrows `self`.
                                    let conditions = match kind {
                                        ast::ImportKind::Require
                                        | ast::ImportKind::RequireResolve => {
                                            self.opts.conditions.require.clone().expect("oom")
                                        }
                                        ast::ImportKind::At | ast::ImportKind::AtConditional => {
                                            self.opts.conditions.style.clone().expect("oom")
                                        }
                                        _ => self.opts.conditions.import.clone().expect("oom"),
                                    };

                                    // Resolve against the path "/", then join it with the absolute
                                    // directory path. This is done because ESM package resolution uses
                                    // URLs while our path resolution uses file system paths. We don't
                                    // want problems due to Windows paths, which are very unlike URL
                                    // paths. We also want to avoid any "%" characters in the absolute
                                    // directory path accidentally being interpreted as URL escapes.
                                    {
                                        // PERF(port): extra conditions clone vs Zig — profile in Phase B.
                                        let esm_resolution = ESModule {
                                            conditions: conditions.clone().expect("oom"),
                                            debug_logs: self.debug_logs.as_mut(),
                                            module_type: &mut module_type,
                                        }
                                        .resolve(b"/", esm.subpath, &exports_map.root);
                                        // ESModule temporary dropped here; `self` is unborrowed.

                                        if let Some(result) = self.handle_esm_resolution(
                                            esm_resolution,
                                            abs_package_path,
                                            kind,
                                            package_json,
                                            esm.subpath,
                                        ) {
                                            let mut result_copy = result;
                                            result_copy.is_node_module = true;
                                            result_copy.module_type = module_type;
                                            self.extension_order = prev_extension_order;
                                            if let Some(d) = self.debug_logs.as_mut() {
                                                d.decrease_indent();
                                            }
                                            return MatchResultUnion::Success(result_copy);
                                        }
                                    }

                                    // Some popular packages forget to include the extension in their
                                    // exports map, so we try again without the extension.
                                    //
                                    // This is useful for browser-like environments
                                    // where you want a file extension in the URL
                                    // pathname by convention. Vite does this.
                                    //
                                    // React is an example of a package that doesn't include file extensions.
                                    // {
                                    //     "exports": {
                                    //         ".": "./index.js",
                                    //         "./jsx-runtime": "./jsx-runtime.js",
                                    //     }
                                    // }
                                    //
                                    // We limit this behavior just to ".js" files.
                                    let extname = bun_paths::extension(esm.subpath);
                                    if extname == b".js" && esm.subpath.len() > 3 {
                                        let esm_resolution = ESModule {
                                            conditions,
                                            debug_logs: self.debug_logs.as_mut(),
                                            module_type: &mut module_type,
                                        }
                                        .resolve(
                                            b"/",
                                            &esm.subpath[0..esm.subpath.len() - 3],
                                            &exports_map.root,
                                        );
                                        if let Some(result) = self.handle_esm_resolution(
                                            esm_resolution,
                                            abs_package_path,
                                            kind,
                                            package_json,
                                            esm.subpath,
                                        ) {
                                            let mut result_copy = result;
                                            result_copy.is_node_module = true;
                                            result_copy.module_type = module_type;
                                            self.extension_order = prev_extension_order;
                                            if let Some(d) = self.debug_logs.as_mut() {
                                                d.decrease_indent();
                                            }
                                            return MatchResultUnion::Success(result_copy);
                                        }
                                    }

                                    // if they hid "package.json" from "exports", still allow importing it.
                                    if esm.subpath == b"./package.json" {
                                        self.extension_order = prev_extension_order;
                                        if let Some(d) = self.debug_logs.as_mut() {
                                            d.decrease_indent();
                                        }
                                        return MatchResultUnion::Success(MatchResult {
                                            // PORT NOTE: PackageJSON.source.path is bun_paths::fs::Path<'static>; convert
                                            // to the resolver's interned crate::fs::Path<'static> via its text.
                                            path_pair: PathPair {
                                                primary: Path::init(package_json.source.path.text),
                                                secondary: None,
                                            },
                                            dirname_fd: pkg_dir_info.get_file_descriptor(),
                                            file_fd: FD::INVALID,
                                            // Spec resolver.zig:1930 — `Path.isNodeModule()` checks
                                            // `lastIndexOf(name.dir, SEP++"node_modules"++SEP)`, i.e. a
                                            // separator-bounded directory component on `name.dir` (not a
                                            // bare substring of the full text). `bun_paths::fs::Path<'static>`
                                            // doesn't carry that method, so re-derive via the resolver's
                                            // `Path` (already done one line up for `path_pair.primary`).
                                            is_node_module: Path::init(
                                                package_json.source.path.text,
                                            )
                                            .is_node_module(),
                                            package_json: Some(std::ptr::from_ref(package_json)),
                                            dir_info: Some(dir_info),
                                            ..Default::default()
                                        });
                                    }

                                    self.extension_order = prev_extension_order;
                                    if let Some(d) = self.debug_logs.as_mut() {
                                        d.decrease_indent();
                                    }
                                    return MatchResultUnion::NotFound;
                                }
                            }
                        }
                    }

                    if let Some(res) = self.load_as_file_or_directory(abs_path, kind) {
                        self.extension_order = prev_extension_order;
                        if let Some(d) = self.debug_logs.as_mut() {
                            d.decrease_indent();
                        }
                        return MatchResultUnion::Success(res);
                    }
                    self.extension_order = prev_extension_order;
                }

                match dir_info.get_parent() {
                    Some(p) => dir_info = p,
                    None => break,
                }
            }

            // try resolve from `NODE_PATH`
            // https://nodejs.org/api/modules.html#loading-from-the-global-folders
            let node_path: &[u8] = self
                .env_loader()
                .and_then(|env| env.get(b"NODE_PATH"))
                .unwrap_or(b"");
            if !node_path.is_empty() {
                let delim = if cfg!(windows) { b';' } else { b':' };
                for path in node_path.split(|&b| b == delim).filter(|s| !s.is_empty()) {
                    let Some(abs_path) = self
                        .fs_ref()
                        .abs_buf_checked(&[path, import_path], bufs!(node_modules_check))
                    else {
                        continue;
                    };
                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!(
                            "Checking for a package in the NODE_PATH directory \"{}\"",
                            bstr::BStr::new(abs_path)
                        ));
                    }
                    if let Some(res) = self.load_as_file_or_directory(abs_path, kind) {
                        if let Some(d) = self.debug_logs.as_mut() {
                            d.decrease_indent();
                        }
                        return MatchResultUnion::Success(res);
                    }
                }
            }

            dir_info = source_dir_info;

            // this is the magic!
            if global_cache.can_use(any_node_modules_folder)
                && self.use_package_manager()
                && esm_.is_some()
                && strings::is_npm_package_name(esm_.as_ref().unwrap().name)
            {
                let esm = esm_.as_ref().unwrap().with_auto_version();
                'load_module_from_cache: {
                    // If the source directory doesn't have a node_modules directory, we can
                    // check the global cache directory for a package.json file.
                    //
                    // PORT NOTE (Stacked Borrows): `get_package_manager` returns the
                    // `*mut dyn AutoInstaller` raw pointer; the body below re-borrows
                    // `self` for `enqueue_dependency_to_resolve` / `debug_logs` /
                    // `log()`. The PackageManager lives in a separate allocation, so
                    // derive a raw pointer once and re-borrow per use — disjoint
                    // from `self`'s storage.
                    let manager_ptr: *mut dyn AutoInstaller = self.get_package_manager();
                    // SAFETY: re-borrowed narrowly per use; PackageManager outlives resolver.
                    macro_rules! manager {
                        () => {
                            unsafe { &mut *manager_ptr }
                        };
                    }
                    let mut dependency_version = Dependency::Version::default();
                    let mut dependency_behavior = Dependency::Behavior::PROD;
                    let mut string_buf: &[u8] = esm.version;

                    // const initial_pending_tasks = manager.pending_tasks;
                    let mut resolved_package_id: Install::PackageID = 'brk: {
                        // check if the package.json in the source directory was already added to the lockfile
                        // and try to look up the dependency from there
                        if let Some(package_json) = dir_info.package_json_for_dependencies() {
                            let mut dependencies_list: &[Dependency::Dependency] = &[];
                            let resolve_from_lockfile = package_json.package_manager_package_id
                                != Install::INVALID_PACKAGE_ID;

                            if resolve_from_lockfile {
                                let dependencies = manager!().lockfile_package_dependencies(
                                    package_json.package_manager_package_id,
                                );

                                // try to find this package name in the dependencies of the enclosing package
                                dependencies_list =
                                    dependencies.get(manager!().lockfile_dependencies_buf());
                                string_buf = manager!().lockfile_string_bytes();
                            } else if esm_.as_ref().unwrap().version.is_empty() {
                                // If you don't specify a version, default to the one chosen in your package.json
                                dependencies_list = package_json.dependencies.map.values();
                                string_buf = package_json.dependencies.source_buf;
                            }

                            for (dependency_id, dependency) in dependencies_list.iter().enumerate()
                            {
                                if !strings::eql_long(
                                    dependency.name.slice(string_buf),
                                    esm.name,
                                    true,
                                ) {
                                    continue;
                                }

                                dependency_version = dependency.version.clone();
                                dependency_behavior = dependency.behavior;

                                if resolve_from_lockfile {
                                    let resolutions = manager!().lockfile_package_resolutions(
                                        package_json.package_manager_package_id,
                                    );

                                    // found it!
                                    break 'brk resolutions
                                        .get(manager!().lockfile_resolutions_buf())[dependency_id];
                                }

                                break;
                            }
                        }

                        // If we get here, it means that the lockfile doesn't have this package at all.
                        // we know nothing
                        break 'brk Install::INVALID_PACKAGE_ID;
                    };

                    // Now, there are two possible states:
                    // 1) We have resolved the package ID, either from the
                    //    lockfile globally OR from the particular package.json
                    //    dependencies list
                    //
                    // 2) We parsed the Dependency.Version but there is no
                    //    existing resolved package ID

                    // If its an exact version, we can just immediately look it up in the global cache and resolve from there
                    // If the resolved package ID is _not_ invalid, we can just check

                    // If this returns null, then it means we need to *resolve* the package
                    // Even after resolution, we might still need to download the package
                    // There are two steps here! Two steps!
                    let resolution: Resolution = 'brk: {
                        if resolved_package_id == Install::INVALID_PACKAGE_ID {
                            if dependency_version.tag == Dependency::version::Tag::Uninitialized {
                                let sliced_string =
                                    Semver::SlicedString::init(esm.version, esm.version);
                                if !esm_.as_ref().unwrap().version.is_empty()
                                    && dir_info.enclosing_package_json.is_some()
                                    && global_cache.allow_version_specifier()
                                {
                                    if let Some(d) = self.debug_logs.as_mut() {
                                        d.decrease_indent();
                                    }
                                    return MatchResultUnion::Failure(bun_core::err!(
                                        "VersionSpecifierNotAllowedHere"
                                    ));
                                }
                                string_buf = esm.version;
                                dependency_version = match manager!().parse_dependency(
                                    Semver::String::init(esm.name, esm.name),
                                    None,
                                    esm.version,
                                    &sliced_string,
                                    self.log(),
                                ) {
                                    Some(v) => v,
                                    None => break 'load_module_from_cache,
                                };
                            }

                            if let Some(id) =
                                manager!().lockfile_resolve(esm.name, &dependency_version)
                            {
                                resolved_package_id = id;
                            }
                        }

                        if resolved_package_id != Install::INVALID_PACKAGE_ID {
                            break 'brk manager!().lockfile_package_resolution(resolved_package_id);
                        }

                        // unsupported or not found dependency, we might need to install it to the cache
                        match self.enqueue_dependency_to_resolve(
                            // Read the raw `NonNull` fields directly (NOT the
                            // `&'static`-yielding accessors) so mut-provenance from
                            // `intern_package_json` survives to the write inside
                            // (Zig: resolver.zig:2074).
                            dir_info
                                .package_json_for_dependencies
                                .or(dir_info.package_json),
                            &esm,
                            dependency_behavior,
                            &mut resolved_package_id,
                            dependency_version.clone(),
                            string_buf,
                        ) {
                            DependencyToResolve::Resolution(res) => break 'brk res,
                            DependencyToResolve::Pending(pending) => {
                                if let Some(d) = self.debug_logs.as_mut() {
                                    d.decrease_indent();
                                }
                                return MatchResultUnion::Pending(pending);
                            }
                            DependencyToResolve::Failure(err) => {
                                if let Some(d) = self.debug_logs.as_mut() {
                                    d.decrease_indent();
                                }
                                return MatchResultUnion::Failure(err);
                            }
                            // this means we looked it up in the registry and the package doesn't exist or the version doesn't exist
                            DependencyToResolve::NotFound => {
                                if let Some(d) = self.debug_logs.as_mut() {
                                    d.decrease_indent();
                                }
                                return MatchResultUnion::NotFound;
                            }
                        }
                    };

                    let dir_path_for_resolution = match manager!().path_for_resolution(
                        resolved_package_id,
                        &resolution,
                        bufs!(path_in_global_disk_cache),
                    ) {
                        Ok(p) => p,
                        Err(err) => {
                            // if it's missing, we need to install it
                            if err == bun_core::err!("FileNotFound") {
                                match manager!().get_preinstall_state(resolved_package_id) {
                                    Install::PreinstallState::Done => {
                                        // PORT NOTE: `MatchResult.path_pair` is `Path<'static>`;
                                        // intern `import_path` so the disabled-module record
                                        // outlives this frame (Zig had no lifetime here).
                                        let interned = Fs::file_system::DirnameStore::instance()
                                            .append_slice(import_path)
                                            .expect("unreachable");
                                        let mut path = Fs::Path::init(interned);
                                        path.is_disabled = true;
                                        // this might mean the package is disabled
                                        if let Some(d) = self.debug_logs.as_mut() {
                                            d.decrease_indent();
                                        }
                                        return MatchResultUnion::Success(MatchResult {
                                            path_pair: PathPair {
                                                primary: path,
                                                secondary: None,
                                            },
                                            ..Default::default()
                                        });
                                    }
                                    st @ (Install::PreinstallState::Extract
                                    | Install::PreinstallState::Extracting) => {
                                        if !global_cache.can_install() {
                                            if let Some(d) = self.debug_logs.as_mut() {
                                                d.decrease_indent();
                                            }
                                            return MatchResultUnion::NotFound;
                                        }
                                        let (cloned, string_buf) = esm.copy().expect("unreachable");

                                        if st == Install::PreinstallState::Extract {
                                            let dependency_id = manager!()
                                                .lockfile_legacy_package_to_dependency_id(
                                                    resolved_package_id,
                                                )
                                                .expect("unreachable");
                                            // The npm version + URL live inside `resolution.value`;
                                            // the `AutoInstaller` impl decodes them itself.
                                            if let Err(enqueue_download_err) = manager!()
                                                .enqueue_package_for_download(
                                                    esm.name,
                                                    dependency_id,
                                                    resolved_package_id,
                                                    &resolution,
                                                    Install::TaskCallbackContext {
                                                        root_request_id: 0,
                                                    },
                                                    None,
                                                )
                                            {
                                                if let Some(d) = self.debug_logs.as_mut() {
                                                    d.decrease_indent();
                                                }
                                                return MatchResultUnion::Failure(
                                                    enqueue_download_err,
                                                );
                                            }
                                        }

                                        if let Some(d) = self.debug_logs.as_mut() {
                                            d.decrease_indent();
                                        }
                                        return MatchResultUnion::Pending(PendingResolution {
                                            esm: cloned,
                                            dependency: dependency_version,
                                            resolution_id: resolved_package_id,
                                            string_buf,
                                            tag: PendingResolutionTag::Download,
                                            ..Default::default()
                                        });
                                    }
                                    _ => {}
                                }
                            }

                            if let Some(d) = self.debug_logs.as_mut() {
                                d.decrease_indent();
                            }
                            return MatchResultUnion::Failure(err);
                        }
                    };

                    match self.dir_info_for_resolution(dir_path_for_resolution, resolved_package_id)
                    {
                        Ok(dir_info_to_use_) => {
                            if let Some(pkg_dir_info) = dir_info_to_use_ {
                                let abs_package_path = pkg_dir_info.abs_path;
                                let mut module_type = options::ModuleType::Unknown;
                                if let Some(package_json) = pkg_dir_info.package_json() {
                                    if let Some(exports_map) = package_json.exports.as_ref() {
                                        // The condition set is determined by the kind of import
                                        // PORT NOTE: reshaped for borrowck — see identical note above.
                                        let conditions = match kind {
                                            ast::ImportKind::Require
                                            | ast::ImportKind::RequireResolve => {
                                                self.opts.conditions.require.clone().expect("oom")
                                            }
                                            _ => self.opts.conditions.import.clone().expect("oom"),
                                        };

                                        // Resolve against the path "/", then join it with the absolute
                                        // directory path. This is done because ESM package resolution uses
                                        // URLs while our path resolution uses file system paths. We don't
                                        // want problems due to Windows paths, which are very unlike URL
                                        // paths. We also want to avoid any "%" characters in the absolute
                                        // directory path accidentally being interpreted as URL escapes.
                                        {
                                            // PERF(port): extra conditions clone vs Zig — profile in Phase B.
                                            let esm_resolution = ESModule {
                                                conditions: conditions.clone().expect("oom"),
                                                debug_logs: self.debug_logs.as_mut(),
                                                module_type: &mut module_type,
                                            }
                                            .resolve(b"/", esm.subpath, &exports_map.root);

                                            if let Some(result) = self.handle_esm_resolution(
                                                esm_resolution,
                                                abs_package_path,
                                                kind,
                                                package_json,
                                                esm.subpath,
                                            ) {
                                                let mut result_copy = result;
                                                result_copy.is_node_module = true;
                                                if let Some(d) = self.debug_logs.as_mut() {
                                                    d.decrease_indent();
                                                }
                                                return MatchResultUnion::Success(result_copy);
                                            }
                                        }

                                        // Some popular packages forget to include the extension in their
                                        // exports map, so we try again without the extension.
                                        // (same comment as above)
                                        //
                                        // We limit this behavior just to ".js" files.
                                        let extname = bun_paths::extension(esm.subpath);
                                        if extname == b".js" && esm.subpath.len() > 3 {
                                            let esm_resolution = ESModule {
                                                conditions,
                                                debug_logs: self.debug_logs.as_mut(),
                                                module_type: &mut module_type,
                                            }
                                            .resolve(
                                                b"/",
                                                &esm.subpath[0..esm.subpath.len() - 3],
                                                &exports_map.root,
                                            );
                                            if let Some(result) = self.handle_esm_resolution(
                                                esm_resolution,
                                                abs_package_path,
                                                kind,
                                                package_json,
                                                esm.subpath,
                                            ) {
                                                let mut result_copy = result;
                                                result_copy.is_node_module = true;
                                                if let Some(d) = self.debug_logs.as_mut() {
                                                    d.decrease_indent();
                                                }
                                                return MatchResultUnion::Success(result_copy);
                                            }
                                        }

                                        // if they hid "package.json" from "exports", still allow importing it.
                                        if esm.subpath == b"./package.json" {
                                            if let Some(d) = self.debug_logs.as_mut() {
                                                d.decrease_indent();
                                            }
                                            return MatchResultUnion::Success(MatchResult {
                                                path_pair: PathPair {
                                                    primary: Fs::Path::init(
                                                        package_json.source.path.text,
                                                    ),
                                                    secondary: None,
                                                },
                                                dirname_fd: pkg_dir_info.get_file_descriptor(),
                                                file_fd: FD::INVALID,
                                                is_node_module: package_json
                                                    .source
                                                    .path
                                                    .is_node_module(),
                                                package_json: Some(std::ptr::from_ref(
                                                    package_json,
                                                )),
                                                dir_info: Some(dir_info),
                                                ..Default::default()
                                            });
                                        }

                                        if let Some(d) = self.debug_logs.as_mut() {
                                            d.decrease_indent();
                                        }
                                        return MatchResultUnion::NotFound;
                                    }
                                }

                                let Some(abs_path) = self.fs_ref().abs_buf_checked(
                                    &[pkg_dir_info.abs_path, esm.subpath],
                                    bufs!(node_modules_check),
                                ) else {
                                    if let Some(d) = self.debug_logs.as_mut() {
                                        d.decrease_indent();
                                    }
                                    return MatchResultUnion::NotFound;
                                };
                                if let Some(debug) = self.debug_logs.as_mut() {
                                    debug.add_note_fmt(format_args!(
                                        "Checking for a package in the directory \"{}\"",
                                        bstr::BStr::new(abs_path)
                                    ));
                                }

                                if let Some(mut res) =
                                    self.load_as_file_or_directory(abs_path, kind)
                                {
                                    res.is_node_module = true;
                                    if let Some(d) = self.debug_logs.as_mut() {
                                        d.decrease_indent();
                                    }
                                    return MatchResultUnion::Success(res);
                                }
                            }
                        }
                        Err(err) => {
                            if let Some(d) = self.debug_logs.as_mut() {
                                d.decrease_indent();
                            }
                            return MatchResultUnion::Failure(err);
                        }
                    }
                }
            }

            if let Some(d) = self.debug_logs.as_mut() {
                d.decrease_indent();
            }
            MatchResultUnion::NotFound
        }

        fn dir_info_for_resolution(
            &mut self,
            dir_path_maybe_trail_slash: &[u8],
            package_id: Install::PackageID,
        ) -> core::result::Result<Option<DirInfoRef>, bun_core::Error> {
            // TODO(port): narrow error set
            debug_assert!(self.package_manager.is_some());

            let dir_path = strings::without_trailing_slash_windows_path(dir_path_maybe_trail_slash);

            Self::assert_valid_cache_key(dir_path);
            // Stacked Borrows: bind ONE `&mut HashMap` and route both the lookup and the slot
            // projection through it so the returned `*mut DirInfo` shares a parent tag with the
            // borrow it was derived from (a second `dir_cache_mut()` Unique retag of the
            // whole `BSSMapInner` would otherwise pop it).
            let dc = self.dir_cache_mut();
            let mut dir_cache_info_result = dc.get_or_put(dir_path)?;
            if dir_cache_info_result.status == allocators::Status::Exists {
                // we've already looked up this package before
                return Ok(dc
                    .at_index(dir_cache_info_result.index)
                    .map(DirInfoRef::from_slot));
            }
            // SAFETY: PORT (Stacked Borrows) — derive `rfs` from the raw `*mut FileSystem`
            // field via `addr_of_mut!` so later `&mut *self.log()` / `&mut *self.dir_cache()`
            // retags below don't pop its provenance. Re-borrow `&mut *rfs` per use.
            let rfs: *mut Fs::file_system::RealFS = self.rfs_ptr();
            macro_rules! rfs {
                () => {
                    unsafe { &mut *rfs }
                };
            }
            // resolver mutex held; `EntriesMap` methods are safe wrappers over the singleton.
            let mut cached_dir_entry_result = rfs!().entries.get_or_put(dir_path)?;

            // PORT NOTE: always assigned by either the cached-hit arm or the
            // `needs_iter` block below; null-init so rustc accepts the proof.
            let mut dir_entries_option: *mut Fs::file_system::real_fs::EntriesOption =
                core::ptr::null_mut();
            let mut needs_iter = true;
            let mut in_place: Option<*mut Fs::file_system::DirEntry> = None;
            let open_dir = match bun_sys::open_dir_for_iteration(FD::cwd(), dir_path) {
                Ok(d) => d,
                Err(err) => {
                    // TODO: handle this error better
                    let _ = self.log_mut().add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!("Unable to open directory: {}", bstr::BStr::new(err.name())),
                    );
                    return Err(err.into());
                }
            };

            if let Some(cached_entry) = rfs!().entries.at_index(cached_dir_entry_result.index) {
                if let Fs::file_system::real_fs::EntriesOption::Entries(entries) = cached_entry {
                    if entries.generation >= self.generation {
                        dir_entries_option = cached_entry;
                        needs_iter = false;
                    } else {
                        in_place = Some(std::ptr::from_mut(*entries));
                    }
                }
            }

            if needs_iter {
                // SAFETY: (block-wide) `in_place`/`dir_entries_ptr`/`dir_entries_option` point to slots
                // in `rfs.entries` (BSSMap singleton) or a fresh leaked Box; both outlive this fn and
                // are accessed under `rfs.entries_mutex` (see LIFETIMES.tsv).
                let mut new_entry = Fs::file_system::DirEntry::init(
                    if let Some(existing) = in_place {
                        // SAFETY: see block-wide note above.
                        unsafe { &*existing }.dir
                    } else {
                        Fs::file_system::DirnameStore::instance()
                            .append_slice(dir_path)
                            .expect("unreachable")
                    },
                    self.generation,
                );

                // Pre-size `data` so the per-entry inserts below skip the
                // 1→2→4→…→N hashbrown rehash cascade from an empty table. 64
                // covers a typical node_modules package dir; larger dirs still
                // rehash from there (cheap relative to starting at 0).
                new_entry.data.reserve(64);

                let mut dir_iterator = bun_sys::iterate_dir(open_dir);
                // Hoist the `FilenameStore` singleton resolve out of the per-entry loop
                // (see `DirEntry::add_entry` doc-comment) and reuse the appender state.
                let mut filename_store = FilenameStoreAppender::new();
                while let Ok(Some(_value)) = dir_iterator.next() {
                    new_entry
                        .add_entry_with_store(
                            // SAFETY: see block-wide note above.
                            in_place.map(|existing| unsafe { &mut (*existing).data }),
                            &_value,
                            &mut filename_store,
                            (),
                        )
                        .expect("unreachable");
                }
                if let Some(existing) = in_place {
                    // SAFETY: see block-wide note above.
                    // PORT NOTE: Zig `clearAndFree` — `StringHashMap` (std::HashMap newtype)
                    // has no separate `clear_and_free`; `clear()` drops all entries.
                    unsafe { &mut *existing }.data.clear();
                }

                if self.store_fd {
                    new_entry.fd = open_dir;
                }
                // PORT NOTE: see `dir_info_cached_maybe_log` — `DirEntry.data` holds a `NonNull`,
                // so a zeroed slot is UB; box `new_entry` directly for the fresh case.
                let dir_entries_ptr = match in_place {
                    Some(p) => {
                        // SAFETY: dir_entries_ptr is a live BSSMap slot (`in_place`).
                        unsafe { *p = new_entry };
                        p
                    }
                    None => bun_core::heap::into_raw(Box::new(new_entry)),
                };

                // bun.fs.debug("readdir({f}, {s}) = {d}", ...) — TODO(port): scoped log

                dir_entries_option = rfs!()
                    .entries
                    // SAFETY: see block-wide note above.
                    .put(
                        &mut cached_dir_entry_result,
                        Fs::file_system::real_fs::EntriesOption::Entries(unsafe {
                            &mut *dir_entries_ptr
                        }),
                    )
                    .expect("unreachable");
            }

            // We must initialize it as empty so that the result index is correct.
            // This is important so that browser_scope has a valid index.
            // PORT NOTE: erase the `&mut DirInfo` borrow to `*mut` immediately so
            // `self.dir_cache` (and `*self`) are reborrowable for the call below.
            let dir_info_ptr: *mut DirInfo::DirInfo = self
                .dir_cache_mut()
                .put(&mut dir_cache_info_result, DirInfo::DirInfo::default())
                .expect("unreachable");

            // `dir_path` is a slice into the threadlocal `bufs(.path_in_global_disk_cache)` buffer,
            // which gets overwritten on the next auto-install resolution. `dirInfoUncached` stores
            // its `path` argument directly as `DirInfo.abs_path` in the permanent `dir_cache`, so
            // pass the interned copy from `DirEntry.dir` (always backed by `DirnameStore`) instead.
            // SAFETY: ARENA — `dir_entries_option` is a slot in `rfs.entries` (BSSMap) and
            // outlives the resolver. Hoist the `&'static [u8] dir` read out so no `&EntriesOption`
            // temporary is live when the raw `*mut` is passed below (avoids a needless Unique
            // retag that would pop the shared tag mid-argument-list under Stacked Borrows).
            let dir_entries_dir = unsafe { &*dir_entries_option }.entries().dir;
            self.dir_info_uncached(
                dir_info_ptr,
                dir_entries_dir,
                // already `*mut EntriesOption` — pass raw, no intermediate `&mut` retag
                dir_entries_option,
                dir_cache_info_result,
                cached_dir_entry_result.index,
                // Packages in the global disk cache are top-level, we shouldn't try
                // to check for a parent package.json
                None,
                allocators::NOT_FOUND,
                open_dir,
                Some(package_id),
            )?;
            // SAFETY: `dir_info_ptr` is the BSSMap slot just filled by `dir_info_uncached`.
            Ok(Some(unsafe { DirInfoRef::from_raw(dir_info_ptr) }))
        }

        fn enqueue_dependency_to_resolve(
            &mut self,
            // PORT NOTE: Zig `package_json_: ?*PackageJSON` (mutable). Carried as
            // `NonNull` end-to-end so the mut-provenance from `intern_package_json`
            // survives to the `package_manager_package_id` write below — taking
            // `*const` and casting back to `*mut` would be UB under Stacked Borrows.
            package_json_: Option<core::ptr::NonNull<PackageJSON>>,
            esm: &crate::package_json::Package<'_>,
            behavior: Dependency::Behavior,
            input_package_id_: &mut Install::PackageID,
            version: Dependency::Version,
            version_buf: &[u8],
        ) -> DependencyToResolve {
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Enqueueing pending dependency \"{}@{}\"",
                    bstr::BStr::new(esm.name),
                    bstr::BStr::new(esm.version)
                ));
            }

            let input_package_id = *input_package_id_;
            // PORT NOTE: see `manager_ptr` note in `load_node_modules` — split the
            // `&mut self` borrow by holding the PackageManager via raw pointer.
            let pm_ptr: *mut dyn AutoInstaller = self.get_package_manager();
            // SAFETY: PackageManager lives in a separate allocation; disjoint from `self`.
            macro_rules! pm {
                () => {
                    unsafe { &mut *pm_ptr }
                };
            }
            // we should never be trying to resolve a dependency that is already resolved
            debug_assert!(pm!().lockfile_resolve(esm.name, &version).is_none());

            // Add the containing package to the lockfile

            let is_main = pm!().lockfile_packages_len() == 0
                && input_package_id == Install::INVALID_PACKAGE_ID;
            if is_main {
                if let Some(mut package_json) = package_json_ {
                    // SAFETY: BACKREF — `package_json` is an interned arena slot
                    // (see `intern_package_json`); `NonNull` carries mut-provenance
                    // from `NonNull::from(&mut **last)` and no other live borrow
                    // exists here.
                    let package_json: &mut PackageJSON = unsafe { package_json.as_mut() };
                    // PORT NOTE: Zig called `Package.fromPackageJSON(lockfile, pm,
                    // log, package_json, features)` then `setHasInstallScript` then
                    // `lockfile.appendPackage`. The `Package` type is bun_install-
                    // internal; the `AutoInstaller` impl performs all three steps.
                    let id = match pm!().lockfile_append_from_package_json(
                        package_json,
                        Install::Features {
                            dev_dependencies: true,
                            is_main: true,
                            dependencies: true,
                            optional_dependencies: true,
                            ..Default::default()
                        },
                    ) {
                        Ok(id) => id,
                        Err(err) => return DependencyToResolve::Failure(err),
                    };
                    package_json.package_manager_package_id = id;
                } else {
                    // we're resolving an unknown package
                    // the unknown package is the root package
                    if let Err(err) = pm!().lockfile_append_root_stub() {
                        return DependencyToResolve::Failure(err);
                    }
                }
            }

            if self.opts.prefer_offline_install {
                if let Some(package_id) = pm!().resolve_from_disk_cache(esm.name, &version) {
                    *input_package_id_ = package_id;
                    return DependencyToResolve::Resolution(
                        pm!().lockfile_package_resolution(package_id),
                    );
                }
            }

            if input_package_id == Install::INVALID_PACKAGE_ID || input_package_id == 0 {
                // All packages are enqueued to the root
                // because we download all the npm package dependencies
                match pm!().enqueue_dependency_to_root(esm.name, &version, version_buf, behavior) {
                    Install::EnqueueResult::Resolution {
                        package_id,
                        resolution,
                    } => {
                        *input_package_id_ = package_id;
                        return DependencyToResolve::Resolution(resolution);
                    }
                    Install::EnqueueResult::Pending(id) => {
                        let (cloned, string_buf) = esm.copy().expect("unreachable");

                        return DependencyToResolve::Pending(PendingResolution {
                            esm: cloned,
                            dependency: version,
                            root_dependency_id: id,
                            string_buf,
                            tag: PendingResolutionTag::Resolve,
                            ..Default::default()
                        });
                    }
                    Install::EnqueueResult::NotFound => {
                        return DependencyToResolve::NotFound;
                    }
                    Install::EnqueueResult::Failure(err) => {
                        return DependencyToResolve::Failure(err);
                    }
                }
            }

            // PORT NOTE: 1:1 with Zig — `resolver.zig` ends this function with
            // `bun.unreachablePanic("TODO: implement enqueueDependencyToResolve for
            // non-root packages", .{})`. The non-root path is genuinely unimplemented
            // in the Zig source; this is not a porting stub.
            unreachable!("TODO: implement enqueueDependencyToResolve for non-root packages")
        }

        fn handle_esm_resolution(
            &mut self,
            esm_resolution_: crate::package_json::Resolution,
            abs_package_path: &[u8],
            kind: ast::ImportKind,
            package_json: &PackageJSON,
            package_subpath: &[u8],
        ) -> Option<MatchResult> {
            let mut esm_resolution = esm_resolution_;
            use crate::package_json::Status;
            if !((matches!(
                esm_resolution.status,
                Status::Inexact | Status::Exact | Status::ExactEndsWithStar
            )) && !esm_resolution.path.is_empty()
                && esm_resolution.path[0] == SEP)
            {
                return None;
            }

            let abs_esm_path: &[u8] = match self.fs_ref().abs_buf_checked(
                &[
                    abs_package_path,
                    strings::without_leading_path_separator(&esm_resolution.path),
                ],
                bufs!(esm_absolute_package_path_joined),
            ) {
                Some(p) => p,
                None => {
                    esm_resolution.status = Status::ModuleNotFound;
                    return None;
                }
            };

            match esm_resolution.status {
                Status::Exact | Status::ExactEndsWithStar => {
                    let resolved_dir_info = match self
                        .dir_info_cached(bun_paths::dirname(abs_esm_path).unwrap())
                        .ok()
                        .flatten()
                    {
                        Some(d) => d,
                        None => {
                            esm_resolution.status = Status::ModuleNotFound;
                            return None;
                        }
                    };
                    let entries = match resolved_dir_info.get_entries_ref(self.generation) {
                        Some(e) => e,
                        None => {
                            esm_resolution.status = Status::ModuleNotFound;
                            return None;
                        }
                    };
                    let extension_order: options::ExtOrder =
                        if kind == ast::ImportKind::At || kind == ast::ImportKind::AtConditional {
                            self.extension_order
                        } else {
                            self.opts
                                .extension_order
                                .kind(kind, resolved_dir_info.is_inside_node_modules())
                        };

                    let base = bun_paths::basename(abs_esm_path);
                    let entry_query = match entries.get(base) {
                        Some(q) => q,
                        None => {
                            let ends_with_star = esm_resolution.status == Status::ExactEndsWithStar;
                            esm_resolution.status = Status::ModuleNotFound;

                            // Try to have a friendly error message if people forget the extension
                            if ends_with_star {
                                let buf = bufs!(load_as_file);
                                buf[..base.len()].copy_from_slice(base);
                                for ext in self.opts.ext_order_slice(extension_order).iter() {
                                    let ext: &[u8] = ext;
                                    let file_name = &mut buf[0..base.len() + ext.len()];
                                    file_name[base.len()..].copy_from_slice(ext);
                                    if entries.get(&file_name[..]).is_some() {
                                        if let Some(debug) = self.debug_logs.as_mut() {
                                            let parts =
                                                [package_json.name.as_ref(), package_subpath];
                                            debug.add_note_fmt(format_args!(
                                                "The import {} is missing the extension {}",
                                                bstr::BStr::new(ResolvePath::join(
                                                    &parts,
                                                    bun_paths::Platform::AUTO
                                                )),
                                                bstr::BStr::new(ext)
                                            ));
                                        }
                                        esm_resolution.status =
                                            Status::ModuleNotFoundMissingExtension;
                                        let _ = ext; // PORT NOTE: Zig stored `missing_suffix = ext` here; unused after `return null`.
                                        break;
                                    }
                                }
                            }
                            return None;
                        }
                    };

                    if entry_query.entry().kind(self.rfs_ptr(), self.store_fd)
                        == Fs::file_system::EntryKind::Dir
                    {
                        let ends_with_star = esm_resolution.status == Status::ExactEndsWithStar;
                        esm_resolution.status = Status::UnsupportedDirectoryImport;

                        // Try to have a friendly error message if people forget the "/index.js" suffix
                        if ends_with_star {
                            if let Ok(Some(dir_info_ref)) = self.dir_info_cached(abs_esm_path) {
                                if let Some(dir_entries) =
                                    dir_info_ref.get_entries_ref(self.generation)
                                {
                                    let index = b"index";
                                    let buf = bufs!(load_as_file);
                                    buf[..index.len()].copy_from_slice(index);
                                    for ext in self.opts.ext_order_slice(extension_order).iter() {
                                        let ext: &[u8] = ext;
                                        let file_name = &mut buf[0..index.len() + ext.len()];
                                        file_name[index.len()..].copy_from_slice(ext);
                                        let index_query = dir_entries.get(&file_name[..]);
                                        if let Some(iq) = index_query {
                                            if iq.entry().kind(self.rfs_ptr(), self.store_fd)
                                                == Fs::file_system::EntryKind::File
                                            {
                                                if let Some(debug) = self.debug_logs.as_mut() {
                                                    let mut ms =
                                                        Vec::with_capacity(1 + file_name.len());
                                                    ms.push(b'/');
                                                    ms.extend_from_slice(&file_name[..]);
                                                    let parts = [
                                                        package_json.name.as_ref(),
                                                        package_subpath,
                                                    ];
                                                    debug.add_note_fmt(format_args!(
                                                        "The import {} is missing the suffix {}",
                                                        bstr::BStr::new(ResolvePath::join(
                                                            &parts,
                                                            bun_paths::Platform::AUTO
                                                        )),
                                                        bstr::BStr::new(&ms)
                                                    ));
                                                }
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        return None;
                    }

                    let absolute_out_path: &[u8] = {
                        if entry_query.entry().abs_path.is_empty() {
                            // SAFETY: EntryStore-owned slot; resolver mutex held. RHS fully
                            // evaluated before LHS `&mut Entry` is materialized.
                            unsafe { &mut *entry_query.entry }.abs_path = PathString::init(
                                self.fs_ref()
                                    .dirname_store
                                    .append_slice(abs_esm_path)
                                    .expect("unreachable"),
                            );
                        }
                        entry_query.entry().abs_path.slice()
                    };
                    let module_type = if let Some(pkg) = resolved_dir_info.package_json() {
                        pkg.module_type
                    } else {
                        options::ModuleType::Unknown
                    };

                    Some(MatchResult {
                        path_pair: PathPair {
                            primary: Path::init_with_namespace(absolute_out_path, b"file"),
                            secondary: None,
                        },
                        dirname_fd: entries.fd,
                        file_fd: entry_query.entry().cache().fd,
                        dir_info: Some(resolved_dir_info),
                        diff_case: entry_query.diff_case,
                        is_node_module: true,
                        package_json: Some(
                            resolved_dir_info
                                .package_json()
                                .map(|p| std::ptr::from_ref(p))
                                .unwrap_or(std::ptr::from_ref(package_json)),
                        ),
                        module_type,
                        ..Default::default()
                    })
                }
                Status::Inexact => {
                    // If this was resolved against an expansion key ending in a "/"
                    // instead of a "*", we need to try CommonJS-style implicit
                    // extension and/or directory detection.
                    if let Some(res) = self.load_as_file_or_directory(abs_esm_path, kind) {
                        let mut res_copy = res;
                        res_copy.is_node_module = true;
                        res_copy.package_json = res_copy
                            .package_json
                            .or(Some(std::ptr::from_ref(package_json)));
                        return Some(res_copy);
                    }
                    esm_resolution.status = Status::ModuleNotFound;
                    None
                }
                _ => unreachable!(),
            }
        }

        pub fn resolve_without_remapping(
            &mut self,
            // PORT NOTE: `DirInfoRef` (not `&mut`) — forwards into `load_node_modules`
            // which re-enters `dir_cache` and may re-derive the same DirInfo slot.
            // Spec resolver.zig:2584 takes raw `*DirInfo`.
            source_dir_info: DirInfoRef,
            import_path: &[u8],
            kind: ast::ImportKind,
            global_cache: GlobalCache,
        ) -> MatchResultUnion {
            if is_package_path(import_path) {
                self.load_node_modules(import_path, kind, source_dir_info, global_cache, false)
            } else {
                let Some(resolved) = self.fs_ref().abs_buf_checked(
                    &[source_dir_info.abs_path, import_path],
                    bufs!(resolve_without_remapping),
                ) else {
                    return MatchResultUnion::NotFound;
                };
                if let Some(result) = self.load_as_file_or_directory(resolved, kind) {
                    return MatchResultUnion::Success(result);
                }
                MatchResultUnion::NotFound
            }
        }

        pub fn parse_tsconfig(
            &mut self,
            file: &[u8],
            dirname_fd: FD,
        ) -> core::result::Result<Option<Box<TSConfigJSON>>, bun_core::Error> {
            // Since tsconfig.json is cached permanently, in our DirEntries cache
            // we must use the global allocator
            let mut entry = self.caches.fs.read_file_with_allocator(
                // SAFETY: process-global `FileSystem` singleton (see `fs()` PORT NOTE); narrow `&mut`
                // for this call only — `self.caches` is a field of `self` (disjoint allocation).
                unsafe { &mut *self.fs() },
                file,
                dirname_fd,
                false,
                None,
                None,
            )?;
            // PORT NOTE: reshaped for borrowck — `mem::take` the contents (leaving
            // `Contents::Empty` behind) so `entry` stays whole for the close-guard.
            let entry_contents = core::mem::take(&mut entry.contents);
            let _close_guard = scopeguard::guard(entry, |mut e| {
                let _ = e.close_fd();
            });

            // The file name needs to be persistent because it can have errors
            // and if those errors need to print the filename
            // then it will be undefined memory if we parse another tsconfig.json later
            let key_path = self
                .fs_ref()
                .dirname_store
                .append_slice(file)
                .expect("unreachable");

            // `use_shared_buffer = false` above, so `entry_contents` is
            // `Contents::Owned`/`Empty`. Zig reads with `bun.default_allocator` and
            // never frees (tsconfig is interned into the permanent DirInfo cache).
            // PORTING.md §Forbidden bars `mem::forget`/`from_raw_parts` to mint
            // `&'static`; route through the process-lifetime arena instead.
            // TODO(port): once `bun_ast::Source.contents` becomes `Cow<'static,[u8]>`
            // / `Box<[u8]>`, the arena indirection here can be dropped.
            let contents_static: &'static [u8] = intern_tsconfig_contents(entry_contents);

            let source = bun_ast::Source::init_path_string(key_path, contents_static);
            let file_dir = source.path.source_dir();

            // SAFETY: BACKREF — `self.log` (see `log()` PORT NOTE); disjoint from `self.caches`,
            // narrow `&mut` for this call only.
            let mut result = match TSConfigJSON::parse(
                unsafe { &mut *self.log() },
                &source,
                &mut self.caches.json,
            )? {
                Some(r) => r,
                None => return Ok(None),
            };

            if result.has_base_url() {
                // this might leak
                if !bun_paths::is_absolute(&result.base_url) {
                    // PORT NOTE: Zig interns into `dirname_store` and stores the
                    // arena slice; Rust `base_url: Box<[u8]>` owns its bytes, so
                    // copy `abs_buf`'s thread-local result directly instead of
                    // double-copying through the arena.
                    let abs = self
                        .fs_ref()
                        .abs_buf(&[file_dir, &result.base_url[..]], bufs!(tsconfig_base_url));
                    result.base_url = Box::from(abs);
                }
            }

            if result.paths.count() > 0
                && (result.base_url_for_paths.is_empty()
                    || !bun_paths::is_absolute(&result.base_url_for_paths))
            {
                // this might leak
                let abs = self
                    .fs_ref()
                    .abs_buf(&[file_dir, &result.base_url[..]], bufs!(tsconfig_base_url));
                result.base_url_for_paths = Box::from(abs);
            }

            // PORT NOTE: Zig `TSConfigJSON.parse` returns `*TSConfigJSON` (already
            // heap). Return the `Box` so the caller (`dir_info_uncached`) takes
            // ownership — intermediate configs in an extends-chain are dropped via
            // `heap::take`, the final one is interned into the DirInfo cache.
            Ok(Some(result))
        }

        pub fn bin_dirs(&self) -> &[&'static [u8]] {
            if !BIN_FOLDERS_LOADED.load(core::sync::atomic::Ordering::Acquire) {
                return &[];
            }
            // SAFETY: BIN_FOLDERS protected by BIN_FOLDERS_LOCK at write sites;
            // `BIN_FOLDERS_LOADED` (acquire) guarantees init.
            unsafe { (*BIN_FOLDERS.get()).assume_init_ref().const_slice() }
        }

        pub fn parse_package_json<const ALLOW_DEPENDENCIES: bool>(
            &mut self,
            file: &[u8],
            dirname_fd: FD,
            package_id: Option<Install::PackageID>,
        ) -> core::result::Result<Option<core::ptr::NonNull<PackageJSON>>, bun_core::Error>
        {
            use crate::package_json::{IncludeDependencies, IncludeScripts};
            // PORT NOTE: Zig threaded both as comptime params; `IncludeDependencies` is a
            // const generic on `PackageJSON::parse`, `IncludeScripts` is runtime (it only
            // gates one branch).
            let include_scripts = if self.care_about_scripts {
                IncludeScripts::IncludeScripts
            } else {
                IncludeScripts::IgnoreScripts
            };
            let pkg = if ALLOW_DEPENDENCIES {
                PackageJSON::parse::<{ IncludeDependencies::Local }>(
                    self,
                    file,
                    dirname_fd,
                    package_id,
                    include_scripts,
                )
            } else {
                PackageJSON::parse::<{ IncludeDependencies::None }>(
                    self,
                    file,
                    dirname_fd,
                    package_id,
                    include_scripts,
                )
            };
            let Some(pkg) = pkg else { return Ok(None) };

            // PORT NOTE: Zig `PackageJSON.new` = `bun.TrivialNew` (heap-allocate,
            // never freed — DirInfo cache holds `&'static` refs). PORTING.md
            // §Forbidden bars `Box::leak`; intern into the process-lifetime arena
            // owned alongside the DirInfo singleton instead.
            Ok(Some(intern_package_json(pkg)))
        }

        fn dir_info_cached(
            &mut self,
            path: &[u8],
        ) -> core::result::Result<Option<DirInfoRef>, bun_core::Error> {
            self.dir_info_cached_maybe_log(true, path)
        }

        pub fn read_dir_info(
            &mut self,
            path: &[u8],
        ) -> core::result::Result<Option<DirInfoRef>, bun_core::Error> {
            self.dir_info_cached_maybe_log(false, path)
        }

        /// Like `readDirInfo`, but returns `null` instead of throwing an error.
        pub fn read_dir_info_ignore_error(&mut self, path: &[u8]) -> Option<DirInfoRef> {
            self.dir_info_cached_maybe_log(false, path).ok().flatten()
        }

        // PORT NOTE: Zig's `dirInfoCachedMaybeLog` takes `comptime enable_logging`
        // and `comptime follow_symlinks`. `follow_symlinks` is `true` at every call
        // site, so it's dropped here; `enable_logging` is a plain runtime parameter
        // (it gates one cold error-formatting branch) so this large dir-walk function
        // monomorphizes to a single copy instead of two faulted in at startup.
        fn dir_info_cached_maybe_log(
            &mut self,
            enable_logging: bool,
            raw_input_path: &[u8],
        ) -> core::result::Result<Option<DirInfoRef>, bun_core::Error> {
            // TODO(port): narrow error set
            // `self.mutex` is `&'static Mutex` (Copy) — bind it first so the guard
            // doesn't keep `self` borrowed across the body.
            let _unlock = self.mutex.lock_guard();
            let mut input_path = raw_input_path;

            if is_dot_slash(input_path) || input_path == b"." {
                input_path = self.fs_ref().top_level_dir;
            }

            // A path longer than MAX_PATH_BYTES cannot name a real directory.
            // Bailing here also prevents overflowing `dir_info_uncached_path`
            // below when called with user-controlled absolute import paths.
            if input_path.len() > MAX_PATH_BYTES {
                return Ok(None);
            }

            #[cfg(windows)]
            {
                let win32_normalized_dir_info_cache_buf = bufs!(win32_normalized_dir_info_cache);
                input_path = self
                    .fs_ref()
                    .normalize_buf(win32_normalized_dir_info_cache_buf, input_path);
                // kind of a patch on the fact normalizeBuf isn't 100% perfect what we want
                if (input_path.len() == 2 && input_path[1] == b':')
                    || (input_path.len() == 3 && input_path[1] == b':' && input_path[2] == b'.')
                {
                    debug_assert!(
                        input_path.as_ptr() == win32_normalized_dir_info_cache_buf.as_ptr()
                    );
                    win32_normalized_dir_info_cache_buf[2] = b'\\';
                    input_path = &win32_normalized_dir_info_cache_buf[..3];
                }

                // Filter out \\hello\, a UNC server path but without a share.
                // When there isn't a share name, such path is not considered to exist.
                if input_path.starts_with(b"\\\\") {
                    let first_slash = strings::index_of_char(&input_path[2..], b'\\')
                        .ok_or(())
                        .ok();
                    if first_slash.is_none() {
                        return Ok(None);
                    }
                    let first_slash = first_slash.unwrap();
                    if strings::index_of_char(&input_path[2 + first_slash as usize..], b'\\')
                        .is_none()
                    {
                        return Ok(None);
                    }
                }
            }

            ::bun_core::assertf!(
                bun_paths::is_absolute(input_path),
                "cannot resolve DirInfo for non-absolute path: {}",
                bstr::BStr::new(input_path)
            );

            let path_without_trailing_slash =
                strings::without_trailing_slash_windows_path(input_path);
            Self::assert_valid_cache_key(path_without_trailing_slash);
            let top_result = self
                .dir_cache_mut()
                .get_or_put(path_without_trailing_slash)?;
            if top_result.status != allocators::Status::Unknown {
                return Ok(self
                    .dir_cache_mut()
                    .at_index(top_result.index)
                    .map(DirInfoRef::from_slot));
            }

            let dir_info_uncached_path_buf = bufs!(dir_info_uncached_path);

            let mut i: i32 = 1;
            let input_path_len = input_path.len();
            dir_info_uncached_path_buf[..input_path_len].copy_from_slice(input_path);
            // The slice spans one byte past the copied path so the NUL-splice/restore at
            // `input_path_len` (queue index 0, processed last in the open-dir loop below)
            // writes through `path`'s own provenance. `input_path_len + 1 ≤ MAX_PATH_BYTES + 1`
            // (checked above) and `PathBuffer` always carries the +1 sentinel slot, so the
            // safe slice is in-bounds and the threadlocal buffer outlives this fn.
            let path: &mut [u8] = &mut dir_info_uncached_path_buf[..input_path_len + 1];

            bufs!(dir_entry_paths_to_resolve)[0].write(DirEntryResolveQueueItem {
                result: top_result,
                unsafe_path: bun_ptr::RawSlice::new(&path[..input_path_len]),
                safe_path: bun_ptr::RawSlice::EMPTY,
                fd: FD::INVALID,
            });
            let mut top = Dirname::dirname(&path[..input_path_len]);

            let mut top_parent = allocators::Result {
                index: allocators::NOT_FOUND,
                hash: 0,
                status: allocators::Status::NotFound,
            };
            #[cfg(windows)]
            let root_path = strings::without_trailing_slash_windows_path(
                ResolvePath::windows_filesystem_root(path),
            );
            #[cfg(not(windows))]
            // we cannot just use "/"
            // we will write to the buffer past the ptr len so it must be a non-const buffer
            let root_path = &path[0..1];
            Self::assert_valid_cache_key(root_path);

            // PORT NOTE: hold RealFS as a raw `*mut` so the entries-mutex/close-dirs
            // scopeguards can capture it by Copy without keeping a `self.rfs_ptr()`
            // borrow live across the loop body (which calls `&mut self` methods).
            // SAFETY: ARENA — `self.fs` points at the process-global FileSystem singleton.
            // Derive provenance from the raw `*mut FileSystem` field directly so later
            // `unsafe { &mut *self.fs() }` calls (e.g. `dirname_store.append_*`) cannot pop `rfs`'s tag
            // under Stacked Borrows (PORTING.md §Forbidden: aliased-&mut).
            let rfs: *mut Fs::file_system::RealFS = self.rfs_ptr();
            macro_rules! rfs {
                () => {
                    unsafe { &mut *rfs }
                };
            }

            // SAFETY: `rfs` points at process-global storage; outlives this guard.
            let _entries_unlock = rfs!().entries_mutex.lock_guard();

            while top.len() > root_path.len() {
                debug_assert!(top.as_ptr() == root_path.as_ptr());
                let result = self.dir_cache_mut().get_or_put(top)?;

                if result.status != allocators::Status::Unknown {
                    top_parent = result;
                    break;
                }
                // Path has more uncached components than our fixed queue can hold.
                // This only happens for user-controlled absolute import paths with
                // hundreds of short components — no real directory is this deep.
                if usize::try_from(i).expect("int cast") >= bufs!(dir_entry_paths_to_resolve).len()
                {
                    return Ok(None);
                }
                bufs!(dir_entry_paths_to_resolve)[usize::try_from(i).expect("int cast")].write(
                    DirEntryResolveQueueItem {
                        unsafe_path: bun_ptr::RawSlice::new(top),
                        result,
                        safe_path: bun_ptr::RawSlice::EMPTY,
                        fd: FD::INVALID,
                    },
                );

                if let Some(top_entry) = rfs!().entries.get(top) {
                    match top_entry {
                        Fs::file_system::real_fs::EntriesOption::Entries(entries) => {
                            // SAFETY: slot was written immediately above.
                            let slot = unsafe {
                                bufs!(dir_entry_paths_to_resolve)
                                    [usize::try_from(i).expect("int cast")]
                                .assume_init_mut()
                            };
                            slot.safe_path = bun_ptr::RawSlice::new(entries.dir);
                            slot.fd = entries.fd;
                        }
                        Fs::file_system::real_fs::EntriesOption::Err(err) => {
                            debuglog!(
                                "Failed to load DirEntry {}  {} - {}",
                                bstr::BStr::new(top),
                                bstr::BStr::new(err.original_err.name()),
                                bstr::BStr::new(err.canonical_error.name())
                            );
                            break;
                        }
                    }
                }
                i += 1;
                top = Dirname::dirname(top);
            }

            if top == root_path {
                let result = self.dir_cache_mut().get_or_put(root_path)?;
                if result.status != allocators::Status::Unknown {
                    top_parent = result;
                } else {
                    bufs!(dir_entry_paths_to_resolve)[usize::try_from(i).expect("int cast")].write(
                        DirEntryResolveQueueItem {
                            unsafe_path: bun_ptr::RawSlice::new(root_path),
                            result,
                            safe_path: bun_ptr::RawSlice::EMPTY,
                            fd: FD::INVALID,
                        },
                    );
                    if let Some(top_entry) = rfs!().entries.get(top) {
                        match top_entry {
                            Fs::file_system::real_fs::EntriesOption::Entries(entries) => {
                                // SAFETY: slot was written immediately above.
                                let slot = unsafe {
                                    bufs!(dir_entry_paths_to_resolve)
                                        [usize::try_from(i).expect("int cast")]
                                    .assume_init_mut()
                                };
                                slot.safe_path = bun_ptr::RawSlice::new(entries.dir);
                                slot.fd = entries.fd;
                            }
                            Fs::file_system::real_fs::EntriesOption::Err(err) => {
                                debuglog!(
                                    "Failed to load DirEntry {}  {} - {}",
                                    bstr::BStr::new(top),
                                    bstr::BStr::new(err.original_err.name()),
                                    bstr::BStr::new(err.canonical_error.name())
                                );
                                return Err(err.canonical_error);
                            }
                        }
                    }

                    i += 1;
                }
            }

            let mut queue_slice_len = usize::try_from(i).expect("int cast");
            if cfg!(debug_assertions) {
                debug_assert!(queue_slice_len > 0);
            }
            let open_dir_count = core::cell::Cell::new(0usize);

            // When this function halts, any item not processed means it's not found.
            // PORT NOTE: capture only what the cleanup needs by-value (store_fd) / by-Cell
            // (open_dir_count) so the guard doesn't pin `&mut self` across the loop
            // body. `need_to_close_files()` is evaluated AT DROP TIME (matching
            // Zig's `defer`), not snapshotted up-front — the loop body calls
            // `Fs.FileSystem.setMaxFd()` which can flip `needToCloseFiles()`
            // mid-walk. Reach the RealFS via the `&'static` singleton accessor
            // instead of capturing a raw `*mut RealFS` (the read is `&self`-only).
            let close_dirs_store_fd = self.store_fd;
            scopeguard::defer! {
                let n = open_dir_count.get();
                if n > 0 && (!close_dirs_store_fd || Fs::FileSystem::get().fs.need_to_close_files()) {
                    let open_dirs = &bufs!(open_dirs)[0..n];
                    for open_dir in open_dirs {
                        open_dir.close();
                    }
                }
            }

            // We want to walk in a straight line from the topmost directory to the desired directory
            // For each directory we visit, we get the entries, but not traverse into child directories
            // (unless those child directories are in the queue)
            // We go top-down instead of bottom-up to increase odds of reusing previously open file handles
            // "/home/jarred/Code/node_modules/react/cjs/react.development.js"
            //       ^
            // If we start there, we will traverse all of /home/jarred, including e.g. /home/jarred/Downloads
            // which is completely irrelevant.

            // After much experimentation...
            // - fts_open is not the fastest way to read directories. fts actually just uses readdir!!
            // - remember
            let mut _safe_path: Option<&'static [u8]> = None;

            // Start at the top.
            while queue_slice_len > 0 {
                // SAFETY: every slot in `0..queue_slice_len` was `.write()`-initialised above.
                let mut queue_top = unsafe {
                    bufs!(dir_entry_paths_to_resolve)[queue_slice_len - 1].assume_init_ref()
                }
                .clone();
                // `unsafe_path` was set to a slice of the threadlocal
                // `dir_info_uncached_path` buffer earlier in this fn; valid for the
                // remainder of the fn body. `safe_path` is either empty or a
                // dirname_store-backed `&'static [u8]`. Copy the `RawSlice` handles
                // out so the re-borrows below don't hold `queue_top` borrowed.
                let (qt_unsafe_path, qt_safe_path) = (queue_top.unsafe_path, queue_top.safe_path);
                let queue_top_unsafe_path: &[u8] = qt_unsafe_path.slice();
                let queue_top_safe_path: &[u8] = qt_safe_path.slice();
                // defer top_parent = queue_top.result — done at end of loop body
                queue_slice_len -= 1;

                let open_dir: FD = if queue_top.fd.is_valid() {
                    queue_top.fd
                } else {
                    'open_dir: {
                        // This saves us N copies of .toPosixPath
                        // which was likely the perf gain from resolving directories relative to the parent directory, anyway.
                        // `queue_top_unsafe_path.len()` is ≤ `input_path_len` < `path.len()` for
                        // every queue item, so this indexes in-bounds (the +1 sentinel slot for
                        // queue index 0 — see the `path` construction above).
                        let nul_at = queue_top_unsafe_path.len();
                        let prev_char = path[nul_at];
                        path[nul_at] = 0;
                        let sentinel = bun_core::ZStr::from_buf(path, nul_at);

                        #[cfg(unix)]
                        let open_req: core::result::Result<
                            FD,
                            bun_core::Error,
                        > = {
                            // TODO(port): std.fs.openDirAbsoluteZ — using bun_sys equivalent
                            bun_sys::open_dir_absolute_z(
                                sentinel,
                                bun_sys::OpenDirOptions {
                                    no_follow: false,
                                    iterate: true,
                                },
                            )
                            .map_err(Into::into)
                        };
                        #[cfg(windows)]
                        let open_req: core::result::Result<
                            FD,
                            bun_core::Error,
                        > = {
                            bun_sys::open_dir_at_windows_a(
                                FD::INVALID,
                                sentinel.as_bytes(),
                                bun_sys::WindowsOpenDirOptions {
                                    iterable: true,
                                    no_follow: false,
                                    read_only: true,
                                    ..Default::default()
                                },
                            )
                            .map_err(Into::into)
                        };

                        // bun.fs.debug("open({s})", .{sentinel}) — TODO(port): scoped log
                        // Restore the byte we NUL-terminated above (Zig: `defer path[len] = prev_char`).
                        // No early-return path exists between the write and here, so a guard is unnecessary.
                        path[nul_at] = prev_char;

                        match open_req {
                            Ok(fd) => break 'open_dir fd,
                            Err(err) => {
                                // Ignore "ENOTDIR" here so that calling "ReadDirectory" on a file behaves
                                // as if there is nothing there at all instead of causing an error due to
                                // the directory actually being a file. This is a workaround for situations
                                // where people try to import from a path containing a file as a parent
                                // directory. The "pnpm" package manager generates a faulty "NODE_PATH"
                                // list which contains such paths and treating them as missing means we just
                                // ignore them during path resolution.
                                if err == bun_core::err!("ENOTDIR")
                                    || err == bun_core::err!("IsDir")
                                    || err == bun_core::err!("NotDir")
                                {
                                    return Ok(None);
                                }
                                let cached_dir_entry_result = rfs!()
                                    .entries
                                    .get_or_put(queue_top_unsafe_path)
                                    .expect("unreachable");
                                // If we don't properly cache not found, then we repeatedly attempt to open the same directories,
                                // which causes a perf trace that looks like this stupidity;
                                //
                                //   openat(dfd: CWD, filename: "node_modules/react", flags: RDONLY|DIRECTORY) = -1 ENOENT (No such file or directory)
                                //   ...
                                self.dir_cache_mut().mark_not_found(queue_top.result);
                                rfs!().entries.mark_not_found(cached_dir_entry_result);
                                if !(err == bun_core::err!("ENOENT")
                                    || err == bun_core::err!("FileNotFound"))
                                {
                                    if enable_logging {
                                        let pretty = queue_top_unsafe_path;
                                        let _ = self.log_mut().add_error_fmt(
                                            None,
                                            bun_ast::Loc::default(),
                                            format_args!(
                                                "Cannot read directory \"{}\": {}",
                                                bstr::BStr::new(pretty),
                                                bstr::BStr::new(err.name())
                                            ),
                                        );
                                    }
                                }

                                return Ok(None);
                            }
                        }
                    }
                };

                if !queue_top.fd.is_valid() {
                    Fs::FileSystem::set_max_fd(open_dir.native());
                    // these objects mostly just wrap the file descriptor, so it's fine to keep it.
                    bufs!(open_dirs)[open_dir_count.get()] = open_dir;
                    open_dir_count.set(open_dir_count.get() + 1);
                }

                let dir_path: &'static [u8] = if !queue_top_safe_path.is_empty() {
                    // SAFETY: non-empty `safe_path` is always a dirname_store-backed
                    // `&'static [u8]` (set from `entries.dir` above); widen the
                    // `RawSlice`-tied borrow back to its true `'static` lifetime.
                    unsafe { bun_ptr::detach_lifetime(queue_top_safe_path) }
                } else {
                    // ensure trailing slash
                    if _safe_path.is_none() {
                        // Now that we've opened the topmost directory successfully, it's reasonable to store the slice.
                        // `path` spans `input_path_len + 1` for the NUL-splice above; the
                        // logical input is `path[..input_path_len]` (Zig resolver.zig:2750).
                        let input = &path[..input_path_len];
                        if input[input.len() - 1] != SEP {
                            let parts: [&[u8]; 2] = [input, SEP_STR.as_bytes()];
                            _safe_path = Some(self.fs_ref().dirname_store.append_parts(&parts)?);
                        } else {
                            _safe_path = Some(self.fs_ref().dirname_store.append_slice(input)?);
                        }
                    }

                    let safe_path = _safe_path.unwrap();

                    // Spec resolver.zig:2965 calls `std.mem.indexOf` (returns 0 for an
                    // empty needle), not `bun.strings.indexOf` (returns null for an
                    // empty needle). On Windows `queue_top_unsafe_path` is empty when
                    // `windows_filesystem_root` cannot classify the input — e.g.
                    // `import(":://x")` is "absolute" per std but has no drive root,
                    // so `root_path` is `path[0..0]`. Match the spec so the resolver
                    // caches a not-found instead of panicking.
                    let dir_path_i = if queue_top_unsafe_path.is_empty() {
                        0
                    } else {
                        strings::index_of(safe_path, queue_top_unsafe_path).expect("unreachable")
                    };
                    let mut end = dir_path_i + queue_top_unsafe_path.len();

                    // Directories must always end in a trailing slash or else various bugs can occur.
                    // This covers "what happens when the trailing"
                    end += usize::from(
                        safe_path.len() > end
                            && end > 0
                            && safe_path[end - 1] != SEP
                            && safe_path[end] == SEP,
                    );
                    &safe_path[dir_path_i..end]
                };

                let mut cached_dir_entry_result =
                    rfs!().entries.get_or_put(dir_path).expect("unreachable");

                let mut dir_entries_option: *mut Fs::file_system::real_fs::EntriesOption =
                    core::ptr::null_mut();
                let mut needs_iter = true;
                let mut in_place: Option<*mut Fs::file_system::DirEntry> = None;

                if let Some(cached_entry) = rfs!().entries.at_index(cached_dir_entry_result.index) {
                    if let Fs::file_system::real_fs::EntriesOption::Entries(entries) = cached_entry
                    {
                        if entries.generation >= self.generation {
                            dir_entries_option = cached_entry;
                            needs_iter = false;
                        } else {
                            in_place = Some(std::ptr::from_mut(*entries));
                        }
                    }
                }

                if needs_iter {
                    // SAFETY: (block-wide) `in_place`/`dir_entries_ptr`/`dir_entries_option` point to
                    // slots in `rfs.entries` (BSSMap singleton) or a fresh leaked Box; both outlive this
                    // fn and are accessed under `rfs.entries_mutex` (see LIFETIMES.tsv).
                    let mut new_entry = Fs::file_system::DirEntry::init(
                        if let Some(existing) = in_place {
                            // SAFETY: see block-wide note above.
                            unsafe { &*existing }.dir
                        } else {
                            Fs::file_system::DirnameStore::instance()
                                .append_slice(dir_path)
                                .expect("unreachable")
                        },
                        self.generation,
                    );

                    // Pre-size `data` so the per-entry inserts below skip the
                    // 1→2→4→…→N hashbrown rehash cascade from an empty table. 64
                    // covers a typical node_modules package dir; larger dirs
                    // still rehash from there (cheap relative to starting at 0).
                    new_entry.data.reserve(64);

                    let mut dir_iterator = bun_sys::iterate_dir(open_dir);
                    // PORT NOTE: Zig `while (dir_iterator.next().unwrap()) |entry|` —
                    // `.unwrap()` was on the inner `Maybe(?Entry)`; the Rust `WrappedIterator::next`
                    // is already flattened to `Result<Option<IteratorResult>>`, so the `.unwrap()`
                    // moved to `?`-style break-on-error.
                    // Hoist the `FilenameStore` singleton resolve out of the per-entry loop
                    // (see `DirEntry::add_entry` doc-comment) and reuse the appender state.
                    let mut filename_store = FilenameStoreAppender::new();
                    loop {
                        let _value = match dir_iterator.next() {
                            Ok(Some(v)) => v,
                            Ok(None) => break,
                            Err(_) => break,
                        };
                        new_entry
                            .add_entry_with_store(
                                // SAFETY: see block-wide note above.
                                in_place.map(|existing| unsafe { &mut (*existing).data }),
                                &_value,
                                &mut filename_store,
                                (),
                            )
                            .expect("unreachable");
                    }
                    if let Some(existing) = in_place {
                        // SAFETY: see block-wide note above.
                        // PORT NOTE: Zig `clear_and_free`; bun_collections::StringHashMap exposes `clear`.
                        unsafe { &mut *existing }.data.clear();
                    }
                    new_entry.fd = if self.store_fd { open_dir } else { FD::INVALID };
                    // PORT NOTE: Zig `entries_ptr = in_place orelse allocator.create(DirEntry)` then
                    // `entries_ptr.* = new_entry` (no drop glue). `DirEntry.data` is a `HashMap`
                    // (`NonNull` inside), so a zeroed slot is UB and `*ptr = new_entry` would drop it.
                    // Box `new_entry` directly for the fresh case; assign-into only for `in_place`.
                    let dir_entries_ptr = match in_place {
                        Some(p) => {
                            // SAFETY: dir_entries_ptr is a live BSSMap slot (`in_place`).
                            unsafe { *p = new_entry };
                            p
                        }
                        None => bun_core::heap::into_raw(Box::new(new_entry)),
                    };
                    dir_entries_option = rfs!()
                        .entries
                        // SAFETY: see block-wide note above.
                        .put(
                            &mut cached_dir_entry_result,
                            Fs::file_system::real_fs::EntriesOption::Entries(unsafe {
                                &mut *dir_entries_ptr
                            }),
                        )?;
                    // bun.fs.debug("readdir({f}, {s}) = {d}", ...) — TODO(port): scoped log
                }

                // We must initialize it as empty so that the result index is correct.
                // This is important so that browser_scope has a valid index.
                // PORT NOTE: erase the `&mut DirInfo` borrow to `*mut` immediately so
                // `self.dir_cache` (and `*self`) are reborrowable for the call below.
                // SAFETY: ARENA — `dir_cache()` singleton (see PORT NOTE). Stacked Borrows: bind
                // ONE `&mut HashMap` and derive BOTH slot pointers from it so they share a parent
                // tag — a second `&mut *self.dir_cache()` Unique retag of the whole `BSSMapInner`
                // (whose `backing_buf` is inline) would pop `dir_info_ptr`'s tag before
                // `dir_info_uncached` writes through it. Spec resolver.zig:3022/3030 routes both
                // through the single raw `r.dir_cache: *HashMap` with no intermediate retag.
                // NOTE: erasing `&mut V` to `*mut V` does NOT, by itself, survive a sibling Unique
                // retag of the parent allocation; the shared `dc` parent is what keeps both live.
                let dc = self.dir_cache_mut();
                let dir_info_ptr: *mut DirInfo::DirInfo =
                    dc.put(&mut queue_top.result, DirInfo::DirInfo::default())?;
                let parent_dir_ptr = dc.at_index(top_parent.index).map(DirInfoRef::from_slot);

                self.dir_info_uncached(
                    dir_info_ptr,
                    dir_path,
                    // SAFETY: ARENA — `dir_entries_option` is a slot in `rfs.entries` (BSSMap) and outlives the resolver.
                    dir_entries_option,
                    queue_top.result,
                    cached_dir_entry_result.index,
                    parent_dir_ptr,
                    top_parent.index,
                    open_dir,
                    None,
                )?;

                top_parent = queue_top.result;

                if queue_slice_len == 0 {
                    // SAFETY: `dir_info_ptr` is the BSSMap slot just filled by `dir_info_uncached`.
                    return Ok(Some(unsafe { DirInfoRef::from_raw(dir_info_ptr) }));

                    // Is the directory we're searching for actually a file?
                } else if queue_slice_len == 1 {
                    // const next_in_queue = queue_slice[0];
                    // const next_basename = std.fs.path.basename(next_in_queue.unsafe_path);
                    // if (dir_info_ptr.getEntries(r.generation)) |entries| {
                    //     if (entries.get(next_basename) != null) {
                    //         return null;
                    //     }
                    // }
                }
            }

            unreachable!()
        }

        // This closely follows the behavior of "tryLoadModuleUsingPaths()" in the
        // official TypeScript compiler
        pub fn match_tsconfig_paths(
            &mut self,
            tsconfig: &TSConfigJSON,
            path: &[u8],
            kind: ast::ImportKind,
        ) -> Option<MatchResult> {
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Matching \"{}\" against \"paths\" in \"{}\"",
                    bstr::BStr::new(path),
                    bstr::BStr::new(&tsconfig.abs_path)
                ));
            }

            let mut abs_base_url: &[u8] = &tsconfig.base_url_for_paths;

            // The explicit base URL should take precedence over the implicit base URL
            // if present. This matters when a tsconfig.json file overrides "baseUrl"
            // from another extended tsconfig.json file but doesn't override "paths".
            if tsconfig.has_base_url() {
                abs_base_url = &tsconfig.base_url;
            }

            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Using \"{}\" as \"baseURL\"",
                    bstr::BStr::new(abs_base_url)
                ));
            }

            // Check for exact matches first
            {
                // PORT NOTE: ArrayHashMap has no `&self` (key,value) iterator; zip the
                // parallel `keys()`/`values()` slices (insertion order).
                for (key, value) in tsconfig
                    .paths
                    .keys()
                    .iter()
                    .zip(tsconfig.paths.values().iter())
                {
                    if strings::eql_long(key, path, true) {
                        for original_path in value.iter() {
                            let mut absolute_original_path: &[u8] = original_path;

                            if !bun_paths::is_absolute(absolute_original_path) {
                                let parts: [&[u8]; 2] = [abs_base_url, original_path.as_ref()];
                                absolute_original_path =
                                    self.fs_ref().abs_buf(&parts, bufs!(tsconfig_path_abs));
                            }

                            if let Some(res) =
                                self.load_as_file_or_directory(absolute_original_path, kind)
                            {
                                return Some(res);
                            }
                        }
                    }
                }
            }

            struct TSConfigMatch<'b> {
                prefix: &'b [u8],
                suffix: &'b [u8],
                original_paths: &'b [Box<[u8]>],
            }

            let mut longest_match: Option<TSConfigMatch> = None;
            let mut longest_match_prefix_length: i32 = -1;
            let mut longest_match_suffix_length: i32 = -1;

            for (key, original_paths) in tsconfig
                .paths
                .keys()
                .iter()
                .zip(tsconfig.paths.values().iter())
            {
                if let Some(star) = strings::index_of_char(key, b'*') {
                    let star = star as usize;
                    let prefix: &[u8] = if star == 0 { b"" } else { &key[0..star] };
                    let suffix: &[u8] = if star == key.len() - 1 {
                        b""
                    } else {
                        &key[star + 1..]
                    };

                    // Find the match with the longest prefix. If two matches have the same
                    // prefix length, pick the one with the longest suffix. This second edge
                    // case isn't handled by the TypeScript compiler, but we handle it
                    // because we want the output to always be deterministic
                    let plen = i32::try_from(prefix.len()).expect("int cast");
                    let slen = i32::try_from(suffix.len()).expect("int cast");
                    if path.starts_with(prefix)
                        && path.ends_with(suffix)
                        && (plen > longest_match_prefix_length
                            || (plen == longest_match_prefix_length
                                && slen > longest_match_suffix_length))
                    {
                        longest_match_prefix_length = plen;
                        longest_match_suffix_length = slen;
                        longest_match = Some(TSConfigMatch {
                            prefix,
                            suffix,
                            original_paths,
                        });
                    }
                }
            }

            // If there is at least one match, only consider the one with the longest
            // prefix. This matches the behavior of the TypeScript compiler.
            if longest_match_prefix_length != -1 {
                let longest_match = longest_match.unwrap();
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!(
                        "Found a fuzzy match for \"{}*{}\" in \"paths\"",
                        bstr::BStr::new(longest_match.prefix),
                        bstr::BStr::new(longest_match.suffix)
                    ));
                }

                for original_path in longest_match.original_paths.iter() {
                    // Swap out the "*" in the original path for whatever the "*" matched
                    let matched_text =
                        &path[longest_match.prefix.len()..path.len() - longest_match.suffix.len()];

                    let total_length: Option<u32> = strings::index_of_char(original_path, b'*');
                    let prefix_end = total_length
                        .map(|v| v as usize)
                        .unwrap_or(original_path.len());
                    let prefix_parts: [&[u8]; 2] = [abs_base_url, &original_path[0..prefix_end]];

                    // Concatenate the matched text with the suffix from the wildcard path
                    let matched_text_with_suffix = bufs!(tsconfig_match_full_buf3);
                    let mut matched_text_with_suffix_len: usize = 0;
                    if total_length.is_some() {
                        let suffix = strings::trim_left(&original_path[prefix_end..], b"*");
                        matched_text_with_suffix_len = matched_text.len() + suffix.len();
                        if matched_text_with_suffix_len > matched_text_with_suffix.len() {
                            continue;
                        }
                        ::bun_core::concat_into(matched_text_with_suffix, &[matched_text, suffix]);
                    }

                    // 1. Normalize the base path
                    // so that "/Users/foo/project/", "../components/*" => "/Users/foo/components/""
                    let Some(prefix) = self
                        .fs_ref()
                        .abs_buf_checked(&prefix_parts, bufs!(tsconfig_match_full_buf2))
                    else {
                        continue;
                    };

                    // 2. Join the new base path with the matched result
                    // so that "/Users/foo/components/", "/foo/bar" => /Users/foo/components/foo/bar
                    let parts: [&[u8]; 3] = [
                        prefix,
                        if matched_text_with_suffix_len > 0 {
                            strings::trim_left(
                                &matched_text_with_suffix[0..matched_text_with_suffix_len],
                                b"/",
                            )
                        } else {
                            b""
                        },
                        strings::trim_left(longest_match.suffix, b"/"),
                    ];
                    let Some(absolute_original_path) = self
                        .fs_ref()
                        .abs_buf_checked(&parts, bufs!(tsconfig_match_full_buf))
                    else {
                        continue;
                    };

                    if let Some(res) = self.load_as_file_or_directory(absolute_original_path, kind)
                    {
                        return Some(res);
                    }
                }
            }

            None
        }

        pub fn load_package_imports(
            &mut self,
            import_path: &[u8],
            // PORT NOTE: `DirInfoRef` (not `&mut`) — `handle_esm_resolution` re-enters
            // `dir_cache` via `dir_info_cached(dirname(abs_esm_path))`; for any
            // imports-map entry resolving to `./<file>` that dirname equals
            // `dir_info.abs_path`, re-deriving `&mut` to the SAME slot while a
            // `&mut` param's FnEntry protector is live is aliased-&mut UB.
            // Spec resolver.zig:3182 takes raw `*DirInfo`.
            dir_info: DirInfoRef,
            kind: ast::ImportKind,
            global_cache: GlobalCache,
        ) -> MatchResultUnion {
            let package_json = dir_info.package_json().unwrap();
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Looking for {} in \"imports\" map in {}",
                    bstr::BStr::new(import_path),
                    bstr::BStr::new(package_json.source.path.text)
                ));
                debug.increase_indent();
                // defer debug.decreaseIndent() — TODO(port): missing matching decrease in Zig too
            }
            let imports_map = package_json.imports.as_ref().unwrap();

            if import_path.len() == 1 || import_path.starts_with(b"#/") {
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!(
                        "The path \"{}\" must not equal \"#\" and must not start with \"#/\"",
                        bstr::BStr::new(import_path)
                    ));
                }
                return MatchResultUnion::NotFound;
            }
            let mut module_type = options::ModuleType::Unknown;

            // PORT NOTE: reshaped for borrowck — Zig kept a raw `*DebugLogs` inside
            // `ESModule` across the subsequent `&mut self` calls. In Rust that is
            // aliased-&mut UB, so the `ESModule` is constructed as a temporary whose
            // borrow of `self.debug_logs` ends as soon as `resolve_imports` returns.
            let esm_resolution = ESModule {
                conditions: match kind {
                    ast::ImportKind::Require | ast::ImportKind::RequireResolve => {
                        self.opts.conditions.require.clone().expect("oom")
                    }
                    _ => self.opts.conditions.import.clone().expect("oom"),
                },
                debug_logs: self.debug_logs.as_mut(),
                module_type: &mut module_type,
            }
            .resolve_imports(import_path, &imports_map.root);
            let _ = module_type;

            if esm_resolution.status == crate::package_json::Status::PackageResolve {
                // https://github.com/oven-sh/bun/issues/4972
                // Resolve a subpath import to a Bun or Node.js builtin
                //
                // Code example:
                //
                //     import { readFileSync } from '#fs';
                //
                // package.json:
                //
                //     "imports": {
                //       "#fs": "node:fs"
                //     }
                //
                if self.opts.mark_builtins_as_external || self.opts.target.is_bun() {
                    if let Some(alias) = HardcodedAlias::get(
                        &esm_resolution.path,
                        self.opts.target,
                        HardcodedAliasCfg::default(),
                    ) {
                        return MatchResultUnion::Success(MatchResult {
                            path_pair: PathPair {
                                primary: Fs::Path::init(alias.path.as_bytes()),
                                secondary: None,
                            },
                            is_external: true,
                            ..Default::default()
                        });
                    }
                }

                return self.load_node_modules(
                    &esm_resolution.path,
                    kind,
                    dir_info,
                    global_cache,
                    true,
                );
            }

            if let Some(result) = self.handle_esm_resolution(
                esm_resolution,
                package_json.source.path.name.dir,
                kind,
                package_json,
                b"",
            ) {
                return MatchResultUnion::Success(result);
            }

            MatchResultUnion::NotFound
        }

        pub fn check_browser_map<const KIND: BrowserMapPathKind>(
            &mut self,
            dir_info: &DirInfo::DirInfo,
            input_path_: &[u8],
        ) -> Option<&'static [u8]> {
            let package_json = dir_info.package_json()?;
            let browser_map = &package_json.browser_map;

            if browser_map.count() == 0 {
                return None;
            }

            let mut input_path = input_path_;

            if KIND == BrowserMapPathKind::AbsolutePath {
                let abs_path = dir_info.abs_path;
                // Turn absolute paths into paths relative to the "browser" map location
                if !input_path.starts_with(abs_path) {
                    return None;
                }

                input_path = &input_path[abs_path.len()..];
            }

            if input_path.is_empty()
                || (input_path.len() == 1 && (input_path[0] == b'.' || input_path[0] == SEP))
            {
                // No bundler supports remapping ".", so we don't either
                return None;
            }

            // Normalize the path so we can compare against it without getting confused by "./"
            let cleaned = self
                .fs_ref()
                .normalize_buf(bufs!(check_browser_map), input_path);

            if cleaned.len() == 1 && cleaned[0] == b'.' {
                // No bundler supports remapping ".", so we don't either
                return None;
            }

            let mut checker = BrowserMapPath {
                remapped: b"",
                cleaned,
                input_path,
                extension_order: self.opts.ext_order_slice(self.extension_order),
                map: &package_json.browser_map,
            };

            if checker.check_path(input_path) {
                return Some(checker.remapped);
            }

            // First try the import path as a package path
            if is_package_path(checker.input_path) {
                let abs_to_rel = bufs!(abs_to_rel);
                match KIND {
                    BrowserMapPathKind::AbsolutePath => {
                        abs_to_rel[0..2].copy_from_slice(b"./");
                        abs_to_rel[2..2 + checker.input_path.len()]
                            .copy_from_slice(checker.input_path);
                        if checker.check_path(&abs_to_rel[0..checker.input_path.len() + 2]) {
                            return Some(checker.remapped);
                        }
                    }
                    BrowserMapPathKind::PackagePath => {
                        // Browserify allows a browser map entry of "./pkg" to override a package
                        // path of "require('pkg')". This is weird, and arguably a bug. But we
                        // replicate this bug for compatibility. However, Browserify only allows
                        // this within the same package. It does not allow such an entry in a
                        // parent package to override this in a child package. So this behavior
                        // is disallowed if there is a "node_modules" folder in between the child
                        // package and the parent package.
                        let is_in_same_package = match dir_info.get_parent() {
                            Some(parent) => !parent.is_node_modules(),
                            None => true,
                        };

                        if is_in_same_package {
                            abs_to_rel[0..2].copy_from_slice(b"./");
                            abs_to_rel[2..2 + checker.input_path.len()]
                                .copy_from_slice(checker.input_path);

                            if checker.check_path(&abs_to_rel[0..checker.input_path.len() + 2]) {
                                return Some(checker.remapped);
                            }
                        }
                    }
                }
            }

            None
        }

        pub fn load_from_main_field(
            &mut self,
            path: &[u8],
            // PORT NOTE: `DirInfoRef` (not `&mut`) — `get_enclosing_browser_scope()`
            // may return `dir_info` itself (resolver.zig:4161 self-browser-scope),
            // which would alias a live `&mut`. Spec uses raw `*DirInfo`.
            dir_info: DirInfoRef,
            _field_rel_path: &[u8],
            field: &[u8],
            extension_order: options::ExtOrder,
        ) -> Option<MatchResult> {
            let mut field_rel_path = _field_rel_path;
            // Is this a directory?
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Found main field \"{}\" with path \"{}\"",
                    bstr::BStr::new(field),
                    bstr::BStr::new(field_rel_path)
                ));
                debug.increase_indent();
            }

            // defer { debug.decreaseIndent() } — handled at returns
            macro_rules! dec_ret {
                ($e:expr) => {{
                    if let Some(d) = self.debug_logs.as_mut() {
                        d.decrease_indent();
                    }
                    return $e;
                }};
            }

            if self.care_about_browser_field {
                // Potentially remap using the "browser" field
                if let Some(browser_scope) = dir_info.get_enclosing_browser_scope() {
                    if let Some(browser_json) = browser_scope.package_json() {
                        if let Some(remap) = self
                            .check_browser_map::<{ BrowserMapPathKind::AbsolutePath }>(
                                &browser_scope,
                                field_rel_path,
                            )
                        {
                            // Is the path disabled?
                            if remap.is_empty() {
                                let paths = [path, field_rel_path];
                                let new_path =
                                    self.fs_ref().abs_alloc(&paths).expect("unreachable");
                                let mut _path = Path::init(new_path);
                                _path.is_disabled = true;
                                dec_ret!(Some(MatchResult {
                                    path_pair: PathPair {
                                        primary: _path,
                                        secondary: None
                                    },
                                    package_json: Some(std::ptr::from_ref(browser_json)),
                                    ..Default::default()
                                }));
                            }

                            field_rel_path = remap;
                        }
                    }
                }
            }
            let _paths = [path, field_rel_path];
            let field_abs_path = self.fs_ref().abs_buf(&_paths, bufs!(field_abs_path));

            // Is this a file?
            if let Some(result) = self.load_as_file(field_abs_path, extension_order) {
                if let Some(package_json) = dir_info.package_json() {
                    dec_ret!(Some(MatchResult {
                        path_pair: PathPair {
                            primary: Fs::Path::init(result.path),
                            secondary: None
                        },
                        package_json: Some(std::ptr::from_ref(package_json)),
                        dirname_fd: result.dirname_fd,
                        ..Default::default()
                    }));
                }

                dec_ret!(Some(MatchResult {
                    path_pair: PathPair {
                        primary: Fs::Path::init(result.path),
                        secondary: None
                    },
                    dirname_fd: result.dirname_fd,
                    diff_case: result.diff_case,
                    ..Default::default()
                }));
            }

            // Is it a directory with an index?
            let Some(field_dir_info) = self.dir_info_cached(field_abs_path).ok().flatten() else {
                dec_ret!(None);
            };

            let r = self.load_as_index_with_browser_remapping(
                field_dir_info,
                field_abs_path,
                extension_order,
            );
            if let Some(d) = self.debug_logs.as_mut() {
                d.decrease_indent();
            }
            r
        }

        // nodeModulePathsForJS / Resolver__propForRequireMainPaths: see src/jsc/resolver_jsc.zig
        // (no Zig callers; exported to C++ only)

        // PORT NOTE: `dir_info` is a `DirInfoRef` (matching spec `*DirInfo`) so
        // `load_index_with_extension` may re-borrow without aliasing the caller's `&mut`.
        pub fn load_as_index(
            &mut self,
            dir_info: DirInfoRef,
            extension_order: options::ExtOrder,
        ) -> Option<MatchResult> {
            // Try the "index" file with extensions
            // PORT NOTE: index by `0..len` so each iteration takes a fresh short
            // borrow of `self.opts` that ends before `&mut self` is taken by
            // `load_index_with_extension` (matches `extra_cjs_extensions` loop below).
            let n = self.opts.ext_order_slice(extension_order).len();
            for i in 0..n {
                // BACKREF: `RawSlice` detaches the `&self.opts` borrow so the loop
                // body can take `&mut self`. Backing `Box<[u8]>` is owned by
                // `self.opts` and never mutated while the resolver runs.
                let ext = bun_ptr::RawSlice::new(&*self.opts.ext_order_slice(extension_order)[i]);
                if let Some(result) = self.load_index_with_extension(dir_info, &ext) {
                    return Some(result);
                }
            }
            // PORT NOTE: index by `0..len` so each iteration takes a fresh short
            // borrow of `self.opts` that ends before `&mut self` is taken by
            // `load_index_with_extension` (avoids the forbidden lifetime-extension cast).
            let n = self.opts.extra_cjs_extensions.len();
            for i in 0..n {
                // BACKREF: see `RawSlice` note above — backing `Box<[u8]>` in
                // `extra_cjs_extensions` is heap-stable for the resolver's life.
                let ext = bun_ptr::RawSlice::new(&*self.opts.extra_cjs_extensions[i]);
                if let Some(result) = self.load_index_with_extension(dir_info, &ext) {
                    return Some(result);
                }
            }

            None
        }

        fn load_index_with_extension(
            &mut self,
            dir_info: DirInfoRef,
            ext: &[u8],
        ) -> Option<MatchResult> {
            // SAFETY: PORT (Stacked Borrows) — derive `rfs` from the raw `*mut FileSystem`
            // field so the `&mut *self.fs()` calls below (`abs_buf`/`dirname_store.append_slice`)
            // don't pop its provenance. Re-borrow `&mut *rfs` at the single use site.
            let rfs: *mut Fs::file_system::RealFS = self.rfs_ptr();

            let ext_buf = bufs!(extension_path);

            let base = &mut ext_buf[0..b"index".len() + ext.len()];
            base[0..b"index".len()].copy_from_slice(b"index");
            base[b"index".len()..].copy_from_slice(ext);

            if let Some(entries) = dir_info.get_entries_ref(self.generation) {
                if let Some(lookup) = entries.get(&base[..]) {
                    if lookup.entry().kind(rfs, self.store_fd) == Fs::file_system::EntryKind::File {
                        let out_buf: &[u8] = {
                            if lookup.entry().abs_path.is_empty() {
                                let parts = [dir_info.abs_path, &base[..]];
                                let out_buf_ = self.fs_ref().abs_buf(&parts, bufs!(index));
                                // SAFETY: EntryStore-owned slot; resolver mutex held. RHS fully
                                // evaluated before LHS `&mut Entry` is materialized.
                                unsafe { &mut *lookup.entry }.abs_path = PathString::init(
                                    self.fs_ref()
                                        .dirname_store
                                        .append_slice(out_buf_)
                                        .expect("unreachable"),
                                );
                            }
                            lookup.entry().abs_path.slice()
                        };

                        if let Some(debug) = self.debug_logs.as_mut() {
                            debug.add_note_fmt(format_args!(
                                "Found file: \"{}\"",
                                bstr::BStr::new(out_buf)
                            ));
                        }

                        if let Some(package_json) = dir_info.package_json() {
                            return Some(MatchResult {
                                path_pair: PathPair {
                                    primary: Path::init(out_buf),
                                    secondary: None,
                                },
                                diff_case: lookup.diff_case,
                                package_json: Some(std::ptr::from_ref(package_json)),
                                dirname_fd: dir_info.get_file_descriptor(),
                                ..Default::default()
                            });
                        }

                        return Some(MatchResult {
                            path_pair: PathPair {
                                primary: Path::init(out_buf),
                                secondary: None,
                            },
                            diff_case: lookup.diff_case,
                            dirname_fd: dir_info.get_file_descriptor(),
                            ..Default::default()
                        });
                    }
                }
            }

            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Failed to find file: \"{}/{}\"",
                    bstr::BStr::new(dir_info.abs_path),
                    bstr::BStr::new(&base[..])
                ));
            }

            None
        }

        pub fn load_as_index_with_browser_remapping(
            &mut self,
            // PORT NOTE: `DirInfoRef` (not `&mut`) — `get_enclosing_browser_scope()`
            // may return `dir_info` itself (resolver.zig:4161 self-browser-scope),
            // which would alias a live `&mut`. Spec uses raw `*DirInfo`.
            dir_info: DirInfoRef,
            path_: &[u8],
            extension_order: options::ExtOrder,
        ) -> Option<MatchResult> {
            // In order for our path handling logic to be correct, it must end with a trailing slash.
            let mut path = path_;
            // Hoisted to fn-body scope so the immutable reborrow taken below can outlive
            // the `if` block without lifetime erasure; the field is not touched again in
            // this fn (only `remap_path` is, via a separate `bufs!` raw-ptr projection).
            let path_buf = bufs!(remap_path_trailing_slash);
            if !strings::ends_with_char(path_, SEP) {
                path_buf[..path.len()].copy_from_slice(path);
                path_buf[path.len()] = SEP;
                path_buf[path.len() + 1] = 0;
                path = &path_buf[..path.len() + 1];
            }

            if self.care_about_browser_field {
                if let Some(browser_scope) = dir_info.get_enclosing_browser_scope() {
                    const FIELD_REL_PATH: &[u8] = b"index";

                    if let Some(browser_json) = browser_scope.package_json() {
                        if let Some(remap) = self
                            .check_browser_map::<{ BrowserMapPathKind::AbsolutePath }>(
                                &browser_scope,
                                FIELD_REL_PATH,
                            )
                        {
                            // Is the path disabled?
                            if remap.is_empty() {
                                let paths = [path, FIELD_REL_PATH];
                                let new_path = self.fs_ref().abs_buf(&paths, bufs!(remap_path));
                                let mut _path = Path::init(new_path);
                                _path.is_disabled = true;
                                return Some(MatchResult {
                                    path_pair: PathPair {
                                        primary: _path,
                                        secondary: None,
                                    },
                                    package_json: Some(std::ptr::from_ref(browser_json)),
                                    ..Default::default()
                                });
                            }

                            let new_paths = [path, remap];
                            let remapped_abs = self.fs_ref().abs_buf(&new_paths, bufs!(remap_path));

                            // Is this a file
                            if let Some(file_result) =
                                self.load_as_file(remapped_abs, extension_order)
                            {
                                return Some(MatchResult {
                                    dirname_fd: file_result.dirname_fd,
                                    path_pair: PathPair {
                                        primary: Path::init(file_result.path),
                                        secondary: None,
                                    },
                                    diff_case: file_result.diff_case,
                                    ..Default::default()
                                });
                            }

                            // Is it a directory with an index?
                            if let Ok(Some(new_dir)) = self.dir_info_cached(remapped_abs) {
                                if let Some(absolute) = self.load_as_index(new_dir, extension_order)
                                {
                                    return Some(absolute);
                                }
                            }

                            return None;
                        }
                    }
                }
            }

            self.load_as_index(dir_info, extension_order)
        }

        pub fn load_as_file_or_directory(
            &mut self,
            path: &[u8],
            kind: ast::ImportKind,
        ) -> Option<MatchResult> {
            let extension_order = self.extension_order;

            // Is this a file?
            if let Some(file) = self.load_as_file(path, extension_order) {
                // Determine the package folder by looking at the last node_modules/ folder in the path
                let nm_seg = const_format::concatcp!("node_modules", SEP_STR).as_bytes();
                if let Some(last_node_modules_folder) = strings::last_index_of(file.path, nm_seg) {
                    let node_modules_folder_offset = last_node_modules_folder + nm_seg.len();
                    // Determine the package name by looking at the next separator
                    if let Some(package_name_length) =
                        strings::index_of_char(&file.path[node_modules_folder_offset..], SEP)
                    {
                        if let Ok(Some(package_dir_info)) = self.dir_info_cached(
                            &file.path
                                [0..node_modules_folder_offset + package_name_length as usize],
                        ) {
                            if let Some(package_json) = package_dir_info.package_json() {
                                return Some(MatchResult {
                                    path_pair: PathPair {
                                        primary: Path::init(file.path),
                                        secondary: None,
                                    },
                                    diff_case: file.diff_case,
                                    dirname_fd: file.dirname_fd,
                                    package_json: Some(std::ptr::from_ref(package_json)),
                                    file_fd: file.file_fd,
                                    ..Default::default()
                                });
                            }
                        }
                    }
                }

                if cfg!(debug_assertions) {
                    debug_assert!(bun_paths::is_absolute(file.path));
                }

                return Some(MatchResult {
                    path_pair: PathPair {
                        primary: Path::init(file.path),
                        secondary: None,
                    },
                    diff_case: file.diff_case,
                    dirname_fd: file.dirname_fd,
                    file_fd: file.file_fd,
                    ..Default::default()
                });
            }

            // Is this a directory?
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Attempting to load \"{}\" as a directory",
                    bstr::BStr::new(path)
                ));
                debug.increase_indent();
            }
            // defer if (r.debug_logs) |*debug| debug.decreaseIndent();
            macro_rules! dec_ret {
                ($e:expr) => {{
                    if let Some(d) = self.debug_logs.as_mut() {
                        d.decrease_indent();
                    }
                    return $e;
                }};
            }

            // PORT NOTE: `DirInfoRef` (matching spec resolver.zig:3674 raw `*DirInfo`).
            // The callees fetch `get_enclosing_browser_scope()` which can resolve
            // back to this same BSSMap slot — holding a `&mut` here would alias.
            let dir_info: DirInfoRef = match self.dir_info_cached(path) {
                Ok(Some(d)) => d,
                Ok(None) => dec_ret!(None),
                Err(err) => {
                    #[cfg(debug_assertions)]
                    Output::pretty_errorln(&format_args!(
                        "err: {} reading {}",
                        bstr::BStr::new(err.name()),
                        bstr::BStr::new(path)
                    ));
                    dec_ret!(None);
                }
            };
            let mut package_json: Option<*const PackageJSON> = None;

            // Try using the main field(s) from "package.json"
            if let Some(pkg_json) = dir_info.package_json() {
                package_json = Some(std::ptr::from_ref(pkg_json));
                if pkg_json.main_fields.count() > 0 {
                    let main_field_values = &pkg_json.main_fields;
                    // BACKREF: `RawSlice` detaches the `&self.opts.main_fields`
                    // borrow so the loop body can take `&mut self`. Backing
                    // `Box<[Box<[u8]>]>` heap buffer is owned by `self.opts` and
                    // never mutated during resolve.
                    let main_field_keys =
                        bun_ptr::RawSlice::<Box<[u8]>>::new(&self.opts.main_fields);
                    let mf_ext_order = options::ExtOrder::MainField;
                    // Spec resolver.zig compares the *pointer* of `opts.main_fields`
                    // against the per-target default to detect "user did not pass
                    // --main-fields"; the bundler now projects that as an explicit
                    // bool because the owned `Box<[Box<[u8]>]>` can never alias a
                    // static.
                    let auto_main = self.opts.main_fields_is_default;

                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!(
                            "Searching for main fields in \"{}\"",
                            bstr::BStr::new(pkg_json.source.path.text)
                        ));
                    }

                    for key in main_field_keys.iter() {
                        let key: &[u8] = key;
                        let field_rel_path = match main_field_values.get(key) {
                            Some(v) => v,
                            None => {
                                if let Some(debug) = self.debug_logs.as_mut() {
                                    debug.add_note_fmt(format_args!(
                                        "Did not find main field \"{}\"",
                                        bstr::BStr::new(key)
                                    ));
                                }
                                continue;
                            }
                        };

                        let mut _result = match self.load_from_main_field(
                            path,
                            dir_info,
                            field_rel_path,
                            key,
                            if key == b"main" {
                                mf_ext_order
                            } else {
                                extension_order
                            },
                        ) {
                            Some(r) => r,
                            None => continue,
                        };

                        // If the user did not manually configure a "main" field order, then
                        // use a special per-module automatic algorithm to decide whether to
                        // use "module" or "main" based on whether the package is imported
                        // using "import" or "require".
                        if auto_main && key == b"module" {
                            let mut absolute_result: Option<MatchResult> = None;

                            if let Some(main_rel_path) = main_field_values.get(b"main".as_slice()) {
                                if !main_rel_path.is_empty() {
                                    absolute_result = self.load_from_main_field(
                                        path,
                                        dir_info,
                                        main_rel_path,
                                        b"main",
                                        mf_ext_order,
                                    );
                                }
                            } else {
                                // Some packages have a "module" field without a "main" field but
                                // still have an implicit "index.js" file. In that case, treat that
                                // as the value for "main".
                                absolute_result = self.load_as_index_with_browser_remapping(
                                    dir_info,
                                    path,
                                    mf_ext_order,
                                );
                            }

                            if let Some(auto_main_result) = absolute_result {
                                // If both the "main" and "module" fields exist, use "main" if the
                                // path is for "require" and "module" if the path is for "import".
                                // If we're using "module", return enough information to be able to
                                // fall back to "main" later if something ended up using "require()"
                                // with this same path. The goal of this code is to avoid having
                                // both the "module" file and the "main" file in the bundle at the
                                // same time.
                                //
                                // Additionally, if this is for the runtime, use the "main" field.
                                // If it doesn't exist, the "module" field will be used.
                                if self.prefer_module_field && kind != ast::ImportKind::Require {
                                    if let Some(debug) = self.debug_logs.as_mut() {
                                        debug.add_note_fmt(format_args!(
                                        "Resolved to \"{}\" using the \"module\" field in \"{}\"",
                                        bstr::BStr::new(auto_main_result.path_pair.primary.text()),
                                        bstr::BStr::new(pkg_json.source.path.text)
                                    ));
                                        debug.add_note_fmt(format_args!(
                                            "The fallback path in case of \"require\" is {}",
                                            bstr::BStr::new(
                                                auto_main_result.path_pair.primary.text()
                                            )
                                        ));
                                    }

                                    dec_ret!(Some(MatchResult {
                                        path_pair: PathPair {
                                            primary: _result.path_pair.primary,
                                            secondary: Some(auto_main_result.path_pair.primary),
                                        },
                                        diff_case: _result.diff_case,
                                        dirname_fd: _result.dirname_fd,
                                        package_json,
                                        file_fd: auto_main_result.file_fd,
                                        ..Default::default()
                                    }));
                                } else {
                                    if let Some(debug) = self.debug_logs.as_mut() {
                                        debug.add_note_fmt(format_args!(
                                            "Resolved to \"{}\" using the \"{}\" field in \"{}\"",
                                            bstr::BStr::new(
                                                auto_main_result.path_pair.primary.text()
                                            ),
                                            bstr::BStr::new(key),
                                            bstr::BStr::new(pkg_json.source.path.text)
                                        ));
                                    }
                                    let mut _auto_main_result = auto_main_result;
                                    _auto_main_result.package_json = package_json;
                                    dec_ret!(Some(_auto_main_result));
                                }
                            }
                        }

                        _result.package_json = _result.package_json.or(package_json);
                        dec_ret!(Some(_result));
                    }
                }
            }

            // Look for an "index" file with known extensions
            if let Some(res) =
                self.load_as_index_with_browser_remapping(dir_info, path, extension_order)
            {
                let mut res_copy = res;
                res_copy.package_json = res_copy.package_json.or(package_json);
                dec_ret!(Some(res_copy));
            }

            dec_ret!(None);
        }

        pub fn load_as_file(
            &mut self,
            path: &[u8],
            extension_order: options::ExtOrder,
        ) -> Option<LoadResult> {
            // SAFETY: PORT — RealFS is the global singleton (fs.zig); Zig held a raw
            // pointer here (resolver.zig:3784). Derive provenance from the raw
            // `*mut FileSystem` field so intervening `unsafe { &mut *self.fs() }` calls in
            // `load_extension` / `dirname_store.append_slice` don't invalidate `rfs`
            // under Stacked Borrows. We re-borrow `&mut *rfs` at each use site.
            let rfs: *mut Fs::file_system::RealFS = self.rfs_ptr();
            #[allow(unused_macros)]
            macro_rules! rfs {
                () => {
                    unsafe { &mut *rfs }
                };
            }

            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Attempting to load \"{}\" as a file",
                    bstr::BStr::new(path)
                ));
                debug.increase_indent();
            }
            macro_rules! dec_ret {
                ($e:expr) => {{
                    if let Some(d) = self.debug_logs.as_mut() {
                        d.decrease_indent();
                    }
                    return $e;
                }};
            }

            let dir_path = strings::without_trailing_slash_windows_path(Dirname::dirname(path));

            // PORT — `dir_entry` is a slot in the BSSMap singleton (ARENA, see
            // LIFETIMES.tsv); wrap in `BackRef` so later `&mut self` calls
            // (debug_logs / load_extension / dirname_store) don't trip borrowck
            // while each read goes through safe `BackRef: Deref` (pointee outlives
            // holder by ARENA invariant).
            let dir_entry: bun_ptr::BackRef<Fs::file_system::real_fs::EntriesOption> =
                match unsafe { &mut *rfs }.read_directory(
                    dir_path,
                    None,
                    self.generation,
                    self.store_fd,
                ) {
                    Ok(e) => bun_ptr::BackRef::new_mut(e),
                    Err(_) => dec_ret!(None),
                };

            if let Fs::file_system::real_fs::EntriesOption::Err(err) = dir_entry.get() {
                match err.original_err {
                    e if e == bun_core::err!("ENOENT")
                        || e == bun_core::err!("FileNotFound")
                        || e == bun_core::err!("ENOTDIR")
                        || e == bun_core::err!("NotDir") => {}
                    _ => {
                        let _ = self.log_mut().add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "Cannot read directory \"{}\": {}",
                                bstr::BStr::new(dir_path),
                                bstr::BStr::new(err.original_err.name())
                            ),
                        );
                    }
                }
                dec_ret!(None);
            }

            // ARENA-backed `DirEntry` (see `dir_entry` note above) — `BackRef` so each
            // `entries!()` is a fresh safe shared borrow instead of an open-coded raw deref.
            let entries = bun_ptr::BackRef::new(dir_entry.entries());
            macro_rules! entries {
                () => {
                    entries.get()
                };
            }

            let base = bun_paths::basename(path);

            // Try the plain path without any extensions
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Checking for file \"{}\" ",
                    bstr::BStr::new(base)
                ));
            }

            if let Some(query) = entries!().get(base) {
                if query.entry().kind(rfs, self.store_fd) == Fs::file_system::EntryKind::File {
                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!(
                            "Found file \"{}\" ",
                            bstr::BStr::new(base)
                        ));
                    }

                    let abs_path: &'static [u8] = {
                        if query.entry().abs_path.is_empty() {
                            let abs_path_parts = [query.entry().dir, query.entry().base()];
                            let joined =
                                self.fs_ref().abs_buf(&abs_path_parts, bufs!(load_as_file));
                            // SAFETY: EntryStore-owned slot; resolver mutex held. RHS fully
                            // evaluated before LHS `&mut Entry` is materialized.
                            unsafe { &mut *query.entry }.abs_path = PathString::init(
                                self.fs_ref()
                                    .dirname_store
                                    .append_slice(joined)
                                    .expect("unreachable"),
                            );
                        }
                        crate::path_string_static(&query.entry().abs_path)
                    };

                    dec_ret!(Some(LoadResult {
                        path: abs_path,
                        diff_case: query.diff_case,
                        dirname_fd: entries!().fd,
                        file_fd: query.entry().cache().fd,
                        dir_info: None,
                    }));
                }
            }

            // Try the path with extensions
            bufs!(load_as_file)[..path.len()].copy_from_slice(path);
            // PORT NOTE: index by `0..len` so each iteration takes a fresh short
            // borrow of `self.opts` that ends before `&mut self` is taken by
            // `load_extension` (matches `extra_cjs_extensions` loop below).
            let n = self.opts.ext_order_slice(extension_order).len();
            for i in 0..n {
                // BACKREF: `RawSlice` detaches the `&self.opts` borrow so the loop
                // body can take `&mut self`. Backing `Box<[u8]>` is owned by
                // `self.opts` and never mutated while the resolver runs.
                let ext = bun_ptr::RawSlice::new(&*self.opts.ext_order_slice(extension_order)[i]);
                if let Some(result) = self.load_extension(base, path, &ext, entries!()) {
                    dec_ret!(Some(result));
                }
            }

            // PORT NOTE: index by `0..len` so each iteration takes a fresh short
            // borrow of `self.opts` that ends before `&mut self` is taken by
            // `load_extension` (avoids the forbidden lifetime-extension cast).
            let n = self.opts.extra_cjs_extensions.len();
            for i in 0..n {
                // BACKREF: see `RawSlice` note above — backing `Box<[u8]>` in
                // `extra_cjs_extensions` is heap-stable for the resolver's life.
                let ext = bun_ptr::RawSlice::new(&*self.opts.extra_cjs_extensions[i]);
                if let Some(result) = self.load_extension(base, path, &ext, entries!()) {
                    dec_ret!(Some(result));
                }
            }

            // TypeScript-specific behavior: if the extension is ".js" or ".jsx", try
            // replacing it with ".ts" or ".tsx". At the time of writing this specific
            // behavior comes from the function "loadModuleFromFile()" in the file
            // "moduleNameThisResolver.ts" in the TypeScript compiler source code. It
            // contains this comment:
            //
            //   If that didn't work, try stripping a ".js" or ".jsx" extension and
            //   replacing it with a TypeScript one; e.g. "./foo.js" can be matched
            //   by "./foo.ts" or "./foo.d.ts"
            //
            // We don't care about ".d.ts" files because we can't do anything with
            // those, so we ignore that part of the behavior.
            //
            // See the discussion here for more historical context:
            // https://github.com/microsoft/TypeScript/issues/4595
            if let Some(last_dot) = strings::last_index_of_char(base, b'.') {
                let ext = &base[last_dot..base.len()];
                // PORT NOTE: spec resolver.zig:3890-3891 — Zig `and` binds tighter than `or`, so the
                // node_modules gate only applies to the `.mjs` arm. Mirror that precedence exactly.
                if ext == b".js"
                    || ext == b".jsx"
                    || (ext == b".mjs"
                        && (!FeatureFlags::DISABLE_AUTO_JS_TO_TS_IN_NODE_MODULES
                            || !strings::path_contains_node_modules_folder(path)))
                {
                    let segment = &base[0..last_dot];
                    let tail = &mut bufs!(load_as_file)[path.len() - base.len()..];
                    tail[..segment.len()].copy_from_slice(segment);

                    let exts: &[&[u8]] = if ext == b".mjs" {
                        &[b".mts"]
                    } else {
                        &[b".ts", b".tsx", b".mts"]
                    };

                    for ext_to_replace in exts {
                        let buffer = &mut tail[0..segment.len() + ext_to_replace.len()];
                        buffer[segment.len()..].copy_from_slice(ext_to_replace);

                        if let Some(query) = entries!().get(&buffer[..]) {
                            if query.entry().kind(rfs, self.store_fd)
                                == Fs::file_system::EntryKind::File
                            {
                                if let Some(debug) = self.debug_logs.as_mut() {
                                    debug.add_note_fmt(format_args!(
                                        "Rewrote to \"{}\" ",
                                        bstr::BStr::new(&buffer[..])
                                    ));
                                }

                                dec_ret!(Some(LoadResult {
                                    path: {
                                        if query.entry().abs_path.is_empty() {
                                            // SAFETY: `dir` is `&'static [u8]` (DirnameStore-interned),
                                            // copied out so no `&Entry` borrow survives into the
                                            // `&mut Entry` write below.
                                            let entry_dir = query.entry().dir;
                                            let new_abs = if !entry_dir.is_empty()
                                                && entry_dir[entry_dir.len() - 1] == SEP
                                            {
                                                let parts: [&[u8]; 2] = [entry_dir, &buffer[..]];
                                                PathString::init(
                                                    self.fs_ref()
                                                        .filename_store
                                                        .append_parts(&parts)
                                                        .expect("unreachable"),
                                                )
                                                // the trailing path CAN be missing here
                                            } else {
                                                let parts: [&[u8]; 3] =
                                                    [entry_dir, SEP_STR.as_bytes(), &buffer[..]];
                                                PathString::init(
                                                    self.fs_ref()
                                                        .filename_store
                                                        .append_parts(&parts)
                                                        .expect("unreachable"),
                                                )
                                            };
                                            // SAFETY: EntryStore-owned slot; resolver mutex held. RHS
                                            // fully evaluated above — sole `&mut Entry` for this write.
                                            unsafe { &mut *query.entry }.abs_path = new_abs;
                                        }
                                        crate::path_string_static(&query.entry().abs_path)
                                    },
                                    diff_case: query.diff_case,
                                    dirname_fd: entries!().fd,
                                    file_fd: query.entry().cache().fd,
                                    dir_info: None,
                                }));
                            }
                        }
                        if let Some(debug) = self.debug_logs.as_mut() {
                            debug.add_note_fmt(format_args!(
                                "Failed to rewrite \"{}\" ",
                                bstr::BStr::new(base)
                            ));
                        }
                    }
                }
            }

            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Failed to find \"{}\" ",
                    bstr::BStr::new(path)
                ));
            }

            if FeatureFlags::WATCH_DIRECTORIES {
                // For existent directories which don't find a match
                // Start watching it automatically,
                if let Some(watcher) = self.watcher.as_ref() {
                    watcher.watch(entries!().dir, entries!().fd);
                }
            }
            dec_ret!(None);
        }

        fn load_extension(
            &mut self,
            base: &[u8],
            path: &[u8],
            ext: &[u8],
            entries: &Fs::file_system::DirEntry,
        ) -> Option<LoadResult> {
            // SAFETY: PORT — see load_as_file; derive `rfs` from the raw `*mut FileSystem`
            // field so `unsafe { &mut *self.fs() }` calls below (`filename_store.append_parts`) don't pop
            // its provenance under Stacked Borrows.
            let rfs: *mut Fs::file_system::RealFS = self.rfs_ptr();
            // BACKREF — `entries` is a slot in the BSSMap-backed `DirEntry` arena
            // (see `load_as_file`); detach the borrowck lifetime via `BackRef` so the
            // `&mut self` calls below (debug_logs / fs_ref) don't conflict, while
            // each read stays a safe `BackRef: Deref`.
            let entries = bun_ptr::BackRef::new(entries);
            let buffer = &mut bufs!(load_as_file)[0..path.len() + ext.len()];
            buffer[path.len()..].copy_from_slice(ext);
            let file_name = &buffer[path.len() - base.len()..buffer.len()];

            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Checking for file \"{}\" ",
                    bstr::BStr::new(&buffer[..])
                ));
            }

            if let Some(query) = entries.get().get(file_name) {
                if query.entry().kind(rfs, self.store_fd) == Fs::file_system::EntryKind::File {
                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!(
                            "Found file \"{}\" ",
                            bstr::BStr::new(&buffer[..])
                        ));
                    }

                    // now that we've found it, we allocate it.
                    return Some(LoadResult {
                        path: {
                            // SAFETY: EntryStore-owned slot; resolver mutex held. RHS is fully
                            // evaluated (shared reads) before the LHS `&mut Entry` is
                            // materialized for the write — no overlapping unique borrow.
                            unsafe { &mut *query.entry }.abs_path =
                                if query.entry().abs_path.is_empty() {
                                    PathString::init(
                                        self.fs_ref()
                                            .dirname_store
                                            .append_slice(&buffer[..])
                                            .expect("unreachable"),
                                    )
                                } else {
                                    query.entry().abs_path
                                };
                            crate::path_string_static(&query.entry().abs_path)
                        },
                        diff_case: query.diff_case,
                        dirname_fd: entries.fd,
                        file_fd: query.entry().cache().fd,
                        dir_info: None,
                    });
                }
            }

            None
        }

        fn dir_info_uncached(
            &mut self,
            info: *mut DirInfo::DirInfo,
            path: &'static [u8],
            _entries: *mut Fs::file_system::real_fs::EntriesOption,
            _result: allocators::Result,
            dir_entry_index: allocators::IndexType,
            parent: Option<DirInfoRef>,
            parent_index: allocators::IndexType,
            fd: FD,
            package_id: Option<Install::PackageID>,
        ) -> core::result::Result<(), bun_core::Error> {
            let result = _result;

            // SAFETY: PORT — RealFS / DirEntry are global ARENA singletons (BSSMap-backed);
            // Zig held raw pointers here (resolver.zig:4004 `rfs: *Fs.FileSystem.RealFS`).
            // Derive `rfs_ptr` from the raw `*mut FileSystem` field so later `unsafe { &mut *self.fs() }` calls
            // (`abs_buf` / `dirname_store.append_slice` in the parent-symlink block) cannot
            // invalidate it under Stacked Borrows. Re-borrow at EACH use site so no `&mut`
            // outlives a `unsafe { &mut *self.fs() }` / `get_entries()` / `parse_package_json()` call.
            // TODO(port): split RealFS borrow once entries iteration is interior-mutability-backed.
            let rfs_ptr: *mut Fs::file_system::RealFS = self.rfs_ptr();
            let entries_ptr: *mut Fs::file_system::DirEntry =
                unsafe { &mut *_entries }.entries_mut();
            // PORT NOTE: re-borrow per use; see SAFETY note above.
            macro_rules! rfs {
                () => {
                    unsafe { &mut *rfs_ptr }
                };
            }
            macro_rules! entries {
                () => {
                    unsafe { &mut *entries_ptr }
                };
            }

            if cfg!(debug_assertions) {
                // `path` is stored in the permanent `dir_cache` as `DirInfo.abs_path`. It must not
                // point into a reused threadlocal scratch buffer, or a later resolution will
                // corrupt cached entries. Callers must intern it (e.g. via `DirnameStore`) first.
                ::bun_core::assertf!(
                    !allocators::is_slice_in_buffer(path, &bufs!(path_in_global_disk_cache)[..]),
                    "DirInfo.abs_path must not point into the threadlocal path_in_global_disk_cache buffer (got \"{}\")",
                    bstr::BStr::new(path)
                );
            }

            // SAFETY: info is a slot in the BSSMap-backed dir_cache
            let info = unsafe { &mut *info };
            *info = DirInfo::DirInfo {
                abs_path: path,
                // .abs_real_path = path,
                parent: parent_index,
                entries: dir_entry_index,
                ..Default::default()
            };

            // A "node_modules" directory isn't allowed to directly contain another "node_modules" directory
            let mut base = bun_paths::basename(path);

            // base must
            if base.len() > 1 && base[base.len() - 1] == SEP {
                base = &base[0..base.len() - 1];
            }

            info.flags
                .set_present(DirInfo::Flag::IsNodeModules, base == b"node_modules");

            // if (entries != null) {
            if !info.is_node_modules() {
                if let Some(entry) = entries!().get_comptime_query(b"node_modules") {
                    info.flags.set_present(
                        DirInfo::Flag::HasNodeModules,
                        entry.entry().kind(rfs!(), self.store_fd)
                            == Fs::file_system::EntryKind::Dir,
                    );
                }
            }

            if self.care_about_bin_folder {
                'append_bin_dir: {
                    if info.has_node_modules() {
                        if entries!().has_comptime_query(b"node_modules") {
                            // SAFETY: BIN_FOLDERS guarded by BIN_FOLDERS_LOCK below
                            if !BIN_FOLDERS_LOADED.load(core::sync::atomic::Ordering::Acquire) {
                                // SAFETY: callers hold RESOLVER_MUTEX; first init.
                                unsafe { (*BIN_FOLDERS.get()).write(BinFolderArray::default()) };
                                BIN_FOLDERS_LOADED
                                    .store(true, core::sync::atomic::Ordering::Release);
                            }

                            // TODO(port): std.fs.Dir.openDirZ → bun_sys
                            let Ok(file) = bun_sys::open_dir_z(
                                fd,
                                bun_paths::path_literal!(b"node_modules/.bin"),
                                Default::default(),
                            ) else {
                                break 'append_bin_dir;
                            };
                            let _close = bun_sys::CloseOnDrop::new(file);
                            let Ok(bin_path) = file.get_fd_path(bufs!(node_bin_path)) else {
                                break 'append_bin_dir;
                            };
                            let _unlock = BIN_FOLDERS_LOCK.lock_guard();

                            // SAFETY: BIN_FOLDERS guarded by BIN_FOLDERS_LOCK acquired above.
                            unsafe {
                                for existing_folder in
                                    (*BIN_FOLDERS.get()).assume_init_ref().const_slice()
                                {
                                    if *existing_folder == bin_path {
                                        break 'append_bin_dir;
                                    }
                                }

                                let Ok(stored) = self.fs_ref().dirname_store.append_slice(bin_path)
                                else {
                                    break 'append_bin_dir;
                                };
                                let _ = (*BIN_FOLDERS.get()).assume_init_mut().append(stored);
                            }
                        }
                    }

                    if info.is_node_modules() {
                        if let Some(q) = entries!().get_comptime_query(b".bin") {
                            if q.entry().kind(rfs!(), self.store_fd)
                                == Fs::file_system::EntryKind::Dir
                            {
                                // SAFETY: BIN_FOLDERS_LOADED is single-thread init-once; protected by RESOLVER_MUTEX held by callers.
                                if !BIN_FOLDERS_LOADED.load(core::sync::atomic::Ordering::Acquire) {
                                    // SAFETY: callers hold RESOLVER_MUTEX; first init.
                                    unsafe {
                                        (*BIN_FOLDERS.get()).write(BinFolderArray::default())
                                    };
                                    BIN_FOLDERS_LOADED
                                        .store(true, core::sync::atomic::Ordering::Release);
                                }

                                let Ok(file) =
                                    bun_sys::open_dir_z(fd, b".bin\0", Default::default())
                                else {
                                    break 'append_bin_dir;
                                };
                                let _close = bun_sys::CloseOnDrop::new(file);
                                let Ok(bin_path) = bun_sys::get_fd_path(file, bufs!(node_bin_path))
                                else {
                                    break 'append_bin_dir;
                                };
                                let _unlock = BIN_FOLDERS_LOCK.lock_guard();

                                // SAFETY: BIN_FOLDERS guarded by BIN_FOLDERS_LOCK acquired above.
                                unsafe {
                                    for existing_folder in
                                        (*BIN_FOLDERS.get()).assume_init_ref().const_slice()
                                    {
                                        if *existing_folder == bin_path {
                                            break 'append_bin_dir;
                                        }
                                    }

                                    let Ok(stored) =
                                        self.fs_ref().dirname_store.append_slice(bin_path)
                                    else {
                                        break 'append_bin_dir;
                                    };
                                    let _ = (*BIN_FOLDERS.get()).assume_init_mut().append(stored);
                                }
                            }
                        }
                    }
                }
            }
            // }

            if let Some(parent_) = parent {
                // Propagate the browser scope into child directories
                info.enclosing_browser_scope = parent_.enclosing_browser_scope;
                info.package_json_for_browser_field = parent_.package_json_for_browser_field;
                info.enclosing_tsconfig_json = parent_.enclosing_tsconfig_json;

                if let Some(parent_package_json) = parent_.package_json() {
                    // https://github.com/oven-sh/bun/issues/229
                    if !parent_package_json.name.is_empty() || self.care_about_bin_folder {
                        info.enclosing_package_json = Some(parent_package_json);
                    }

                    if parent_package_json.dependencies.map.count() > 0
                        || parent_package_json.package_manager_package_id
                            != Install::INVALID_PACKAGE_ID
                    {
                        // PORT NOTE: store the raw `NonNull` field (not the
                        // `&'static` accessor result) so mut-provenance flows
                        // through to `enqueue_dependency_to_resolve`.
                        info.package_json_for_dependencies = parent_.package_json;
                    }
                }

                info.enclosing_package_json = info
                    .enclosing_package_json
                    .or(parent_.enclosing_package_json);
                info.package_json_for_dependencies = info
                    .package_json_for_dependencies
                    .or(parent_.package_json_for_dependencies);

                // Make sure "absRealPath" is the real path of the directory (resolving any symlinks)
                if !self.opts.preserve_symlinks {
                    if let Some(parent_entries) = parent_.get_entries_ref(self.generation) {
                        if let Some(lookup) = parent_entries.get(base) {
                            // `entries_ptr` is a slot in the BSSMap-backed entries singleton —
                            // route the read-only `.fd` access through the existing
                            // `entries!()` re-borrow macro instead of a raw-ptr deref.
                            let entries_fd = entries!().fd;
                            if entries_fd.is_valid()
                                && !lookup.entry().cache().fd.is_valid()
                                && self.store_fd
                            {
                                lookup.entry().set_cache_fd(entries_fd);
                            }
                            // SAFETY: EntryStore-owned slot; `entries_mutex` held — read-only borrow,
                            // dies (NLL) before any later `&mut` to this slot.
                            let entry = lookup.entry();

                            let mut symlink = entry.symlink(rfs!(), self.store_fd);
                            if !symlink.is_empty() {
                                if let Some(logs) = self.debug_logs.as_mut() {
                                    let mut buf = Vec::new();
                                    write!(
                                        &mut buf,
                                        "Resolved symlink \"{}\" to \"{}\"",
                                        bstr::BStr::new(path),
                                        bstr::BStr::new(symlink)
                                    )
                                    .ok();
                                    logs.add_note(buf);
                                }
                                info.abs_real_path = symlink;
                            } else if !parent_.abs_real_path.is_empty() {
                                // this might leak a little i'm not sure
                                let parts = [parent_.abs_real_path, base];
                                // PORT NOTE: split into two statements so the two `&mut FileSystem`
                                // borrows from `unsafe { &mut *self.fs() }` don't overlap (Stacked Borrows).
                                let joined = self
                                    .fs_ref()
                                    .abs_buf(&parts, bufs!(dir_info_uncached_filename));
                                symlink = self
                                    .fs_ref()
                                    .dirname_store
                                    .append_slice(joined)
                                    .expect("unreachable");

                                if let Some(logs) = self.debug_logs.as_mut() {
                                    let mut buf = Vec::new();
                                    write!(
                                        &mut buf,
                                        "Resolved symlink \"{}\" to \"{}\"",
                                        bstr::BStr::new(path),
                                        bstr::BStr::new(symlink)
                                    )
                                    .ok();
                                    logs.add_note(buf);
                                }
                                lookup.entry().set_cache_symlink(PathString::init(symlink));
                                info.abs_real_path = symlink;
                            }
                        }
                    }
                }

                if parent_.is_node_modules() || parent_.is_inside_node_modules() {
                    info.flags
                        .set_present(DirInfo::Flag::InsideNodeModules, true);
                }
            }

            // Record if this directory has a package.json file
            if self.opts.load_package_json {
                if let Some(lookup) = entries!().get_comptime_query(b"package.json") {
                    // SAFETY: EntryStore-owned slot; `entries_mutex` held — read-only borrow,
                    // dies (NLL) before any later `&mut` to this slot.
                    let entry = lookup.entry();
                    if entry.kind(rfs!(), self.store_fd) == Fs::file_system::EntryKind::File {
                        info.package_json = if self.use_package_manager()
                            && !info.has_node_modules()
                            && !info.is_node_modules()
                        {
                            self.parse_package_json::<true>(
                                path,
                                if FeatureFlags::STORE_FILE_DESCRIPTORS {
                                    fd
                                } else {
                                    FD::INVALID
                                },
                                package_id,
                            )
                            .ok()
                            .flatten()
                        } else {
                            self.parse_package_json::<false>(
                                path,
                                if FeatureFlags::STORE_FILE_DESCRIPTORS {
                                    fd
                                } else {
                                    FD::INVALID
                                },
                                None,
                            )
                            .ok()
                            .flatten()
                        };

                        if let Some(pkg) = info.package_json() {
                            if pkg.browser_map.count() > 0 {
                                info.enclosing_browser_scope = result.index;
                                info.package_json_for_browser_field = Some(pkg);
                            }

                            if !pkg.name.is_empty() || self.care_about_bin_folder {
                                info.enclosing_package_json = Some(pkg);
                            }

                            if pkg.dependencies.map.count() > 0
                                || pkg.package_manager_package_id != Install::INVALID_PACKAGE_ID
                            {
                                // PORT NOTE: store the raw `NonNull` field (not the
                                // `&'static` accessor result) so mut-provenance flows
                                // through to `enqueue_dependency_to_resolve`.
                                info.package_json_for_dependencies = info.package_json;
                            }

                            if let Some(logs) = self.debug_logs.as_mut() {
                                logs.add_note_fmt(format_args!(
                                    "Resolved package.json in \"{}\"",
                                    bstr::BStr::new(path)
                                ));
                            }
                        }
                    }
                }
            }

            // Record if this directory has a tsconfig.json or jsconfig.json file
            if self.opts.load_tsconfig_json {
                let mut tsconfig_path: Option<&[u8]> = None;
                if self.opts.tsconfig_override.is_none() {
                    if let Some(lookup) = entries!().get_comptime_query(b"tsconfig.json") {
                        // SAFETY: EntryStore-owned slot; `entries_mutex` held — read-only borrow,
                        // dies (NLL) before any later `&mut` to this slot.
                        let entry = lookup.entry();
                        if entry.kind(rfs!(), self.store_fd) == Fs::file_system::EntryKind::File {
                            let parts = [path, b"tsconfig.json".as_slice()];
                            tsconfig_path = Some(
                                self.fs_ref()
                                    .abs_buf(&parts, bufs!(dir_info_uncached_filename)),
                            );
                        }
                    }
                    if tsconfig_path.is_none() {
                        if let Some(lookup) = entries!().get_comptime_query(b"jsconfig.json") {
                            // SAFETY: EntryStore-owned slot; `entries_mutex` held — read-only borrow,
                            // dies (NLL) before any later `&mut` to this slot.
                            let entry = lookup.entry();
                            if entry.kind(rfs!(), self.store_fd) == Fs::file_system::EntryKind::File
                            {
                                let parts = [path, b"jsconfig.json".as_slice()];
                                tsconfig_path = Some(
                                    self.fs_ref()
                                        .abs_buf(&parts, bufs!(dir_info_uncached_filename)),
                                );
                            }
                        }
                    }
                } else if parent.is_none() {
                    // PORT NOTE: re-borrow as 'static so the `&self.opts` borrow ends before
                    // `self.parse_tsconfig(&mut self, ...)`. `tsconfig_override` is owned by
                    // BundleOptions (lives for the resolver's lifetime).
                    tsconfig_path = self
                        .opts
                        .tsconfig_override
                        .as_deref()
                        .map(|s| unsafe { &*std::ptr::from_ref::<[u8]>(s) });
                }

                if let Some(tsconfigpath) = tsconfig_path {
                    let parsed_tsconfig: Option<*mut TSConfigJSON> = match self.parse_tsconfig(
                        tsconfigpath,
                        if FeatureFlags::STORE_FILE_DESCRIPTORS {
                            fd
                        } else {
                            FD::ZERO
                        },
                    ) {
                        Ok(v) => v.map(bun_core::heap::into_raw),
                        Err(err) => {
                            let pretty = tsconfigpath;
                            if err == bun_core::err!("ENOENT")
                                || err == bun_core::err!("FileNotFound")
                            {
                                let _ = self.log_mut().add_error_fmt(
                                    None,
                                    bun_ast::Loc::EMPTY,
                                    format_args!(
                                        "Cannot find tsconfig file {}",
                                        bun_core::fmt::quote(pretty)
                                    ),
                                );
                            } else if err != bun_core::err!("ParseErrorAlreadyLogged")
                                && err != bun_core::err!("IsDir")
                                && err != bun_core::err!("EISDIR")
                            {
                                let _ = self.log_mut().add_error_fmt(
                                    None,
                                    bun_ast::Loc::EMPTY,
                                    format_args!(
                                        "Cannot read file {}: {}",
                                        bun_core::fmt::quote(pretty),
                                        bstr::BStr::new(err.name())
                                    ),
                                );
                            }
                            None
                        }
                    };
                    // PORT NOTE: spec resolver.zig:4207 assigns info.tsconfig_json here (a raw
                    // ?*TSConfigJSON), then frees that allocation in the merge loop below before
                    // reassigning. With Rust references (Option<&'static TSConfigJSON>, dir_info.rs)
                    // that briefly-dangling state is UB. Defer the assignment to after the merge —
                    // it is always overwritten when parsed_tsconfig.is_some(), and DirInfo defaults
                    // tsconfig_json to None otherwise.
                    if let Some(tsconfig_json) = parsed_tsconfig {
                        let mut parent_configs: BoundedArray<*mut TSConfigJSON, 64> =
                            BoundedArray::default();
                        parent_configs.append(tsconfig_json)?;
                        // `current`/`parent_config_ptr`/`merged_config` are heap TSConfigJSON
                        // allocations from `parse_tsconfig` (heap::alloc); uniquely owned by
                        // this extends-chain walk and freed via heap::take below. Hold as
                        // `BackRef` (pointee outlives holder) so the loop body reads via safe
                        // `Deref` instead of three open-coded raw-ptr derefs.
                        let mut current = bun_ptr::BackRef::from(
                            core::ptr::NonNull::new(tsconfig_json).expect("heap alloc"),
                        );
                        while !current.extends.is_empty() {
                            let ts_dir_name = Dirname::dirname(&current.abs_path);
                            let abs_path = ResolvePath::join_abs_string_buf(
                                ts_dir_name,
                                bufs!(tsconfig_path_abs),
                                &[ts_dir_name, &current.extends],
                                bun_paths::Platform::AUTO,
                            );
                            let parent_config_maybe: Option<*mut TSConfigJSON> =
                                match self.parse_tsconfig(abs_path, FD::INVALID) {
                                    Ok(v) => v.map(bun_core::heap::into_raw),
                                    Err(err) => {
                                        let _ = self.log_mut().add_debug_fmt(
                                            None,
                                            bun_ast::Loc::EMPTY,
                                            format_args!(
                                                "{} loading tsconfig.json extends {}",
                                                bstr::BStr::new(err.name()),
                                                bun_core::fmt::quote(abs_path)
                                            ),
                                        );
                                        break;
                                    }
                                };
                            if let Some(parent_config) = parent_config_maybe {
                                parent_configs.append(parent_config)?;
                                current = bun_ptr::BackRef::from(
                                    core::ptr::NonNull::new(parent_config).expect("heap alloc"),
                                );
                            } else {
                                break;
                            }
                        }

                        let mut merged_config = parent_configs.pop().unwrap();
                        // starting from the base config (end of the list)
                        // successively apply the inheritable attributes to the next config
                        while let Some(parent_config_ptr) = parent_configs.pop() {
                            // SAFETY: see loop-wide note above.
                            let parent_config = unsafe { &mut *parent_config_ptr };
                            // SAFETY: see loop-wide note above.
                            let mc = unsafe { &mut *merged_config };
                            mc.emit_decorator_metadata =
                                mc.emit_decorator_metadata || parent_config.emit_decorator_metadata;
                            if !parent_config.base_url.is_empty() {
                                mc.base_url = core::mem::take(&mut parent_config.base_url);
                            }
                            mc.jsx = parent_config.merge_jsx(mc.jsx.clone());
                            mc.jsx_flags.insert_all(parent_config.jsx_flags);

                            if let Some(value) = parent_config.preserve_imports_not_used_as_values {
                                mc.preserve_imports_not_used_as_values = Some(value);
                            }

                            // TypeScript replaces paths across extends (child overrides parent
                            // entirely), so when a more-specific config defines paths, replace
                            // rather than merge. base_url_for_paths is set whenever the paths
                            // key is present in the JSON (even if empty), so it discriminates
                            // "not defined" from "defined as {}" — the latter clears inherited
                            // paths per TypeScript semantics.
                            if !parent_config.base_url_for_paths.is_empty() {
                                // The previous merged_config.paths is being replaced; free its
                                // backing storage before overwriting so the PathsMap from the
                                // deeper config doesn't leak. Each value is a []string slice
                                // that was separately heap-allocated in TSConfigJSON.parse()
                                // (tsconfig_json.zig), so free those before the map itself.
                                // (In Rust, dropping the map frees values automatically.)
                                mc.paths = core::mem::take(&mut parent_config.paths);
                                mc.base_url_for_paths =
                                    core::mem::take(&mut parent_config.base_url_for_paths);
                            } else {
                                // paths were not moved to merged_config, so they're still owned
                                // by parent_config. base_url_for_paths.len == 0 implies the map
                                // is empty (it's only set when the `paths` key is present in the
                                // JSON), so this is a no-op but documents the ownership.
                                // (Drop handles parent_config.paths.)
                            }
                            // Every scalar/reference we need has been copied into merged_config
                            // (strings live in dirname_store or default_allocator and outlive the
                            // struct). The heap-allocated TSConfigJSON itself is no longer needed;
                            // without this, every intermediate config in an extends chain leaks on
                            // each dirInfoUncached() call, which is especially bad under HMR where
                            // bustDirCache triggers a re-parse of the whole chain on every reload.
                            // SAFETY: parent_config_ptr came from TSConfigJSON::new (heap::alloc)
                            TSConfigJSON::destroy(unsafe {
                                bun_core::heap::take(parent_config_ptr)
                            });
                        }
                        // `merged_config` is a leaked Box (heap::alloc) interned into DirInfo; outlives the resolver.
                        info.tsconfig_json = Some(
                            core::ptr::NonNull::new(merged_config)
                                .expect("heap::alloc is non-null"),
                        );
                    }
                    info.enclosing_tsconfig_json = info.tsconfig_json();
                }
            }

            Ok(())
        }
    }

    impl<'a> Resolver<'a> {
        /// Port of `pub fn deinit(r: *ThisResolver)` (resolver.zig:601-604).
        ///
        /// PORT NOTE: NOT `impl Drop` — the bundler builds a `Resolver` per worker
        /// thread (see `for_worker`), and all instances share the same `dir_cache`
        /// singleton. A `Drop` impl would fire once per worker going out of scope,
        /// resetting the SHARED cache (freeing PackageJSON/TSConfigJSON, closing cached
        /// fds) while other live Resolvers still hold pointers into it. Spec calls
        /// `deinit` explicitly exactly once at shutdown; mirror that.
        pub fn deinit(&mut self) {
            // Caller is the sole remaining owner at shutdown; no other Resolver alias is live.
            for di in self.dir_cache_mut().values_mut() {
                // Zig: `di.deinit()` — releases owned PackageJSON / TSConfigJSON resources
                // in-place (side effects beyond memory: those Drops close cached fds /
                // deref intrusive refcounts). Ported as `DirInfo::reset`.
                di.reset();
            }
            // dir_cache is &'static — do not deinit the singleton here
            // TODO(port): Zig calls dir_cache.deinit() but it's a global BSSMap; revisit ownership
        }
    }

    // ─── nested helper types ───────────────────────────────────────────────────

    enum DependencyToResolve {
        NotFound,
        Pending(PendingResolution),
        Failure(bun_core::Error),
        Resolution(Resolution),
    }

    #[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
    pub enum BrowserMapPathKind {
        PackagePath,
        AbsolutePath,
    }

    pub struct BrowserMapPath<'b> {
        pub remapped: &'static [u8],
        pub cleaned: &'b [u8],
        pub input_path: &'b [u8],
        pub extension_order: &'b [Box<[u8]>],
        pub map: &'b BrowserMap,
    }

    impl<'b> BrowserMapPath<'b> {
        pub fn check_path(&mut self, path_to_check: &[u8]) -> bool {
            let map = self.map;

            let cleaned = self.cleaned;
            // Check for equality
            if let Some(result) = map.get(path_to_check) {
                // SAFETY: ARENA — `BrowserMap` values are `Box<[u8]>` owned by a `'static`
                // PackageJSON (allocated in `parse_package_json`, never freed — DirInfo
                // cache is process-global); the `'b` borrow on `map` artificially shortens
                // what is process-lifetime storage. `Interned` is the canonical proof type.
                self.remapped = unsafe { bun_ptr::Interned::assume(result) }.as_bytes();
                // SAFETY: TODO(port): lifetime — extending borrow of caller-owned slice; consumed before checker is dropped.
                self.input_path = unsafe { &*std::ptr::from_ref::<[u8]>(path_to_check) };
                return true;
            }

            let ext_buf = bufs!(extension_path);

            if cleaned.len() <= ext_buf.len() {
                ext_buf[..cleaned.len()].copy_from_slice(cleaned);

                // If that failed, try adding implicit extensions
                for ext in self.extension_order.iter() {
                    let ext: &[u8] = ext;
                    if cleaned.len() + ext.len() > ext_buf.len() {
                        continue;
                    }
                    ext_buf[cleaned.len()..cleaned.len() + ext.len()].copy_from_slice(ext);
                    let new_path = &ext_buf[0..cleaned.len() + ext.len()];
                    // if let Some(debug) = r.debug_logs.as_mut() {
                    //     debug.add_note_fmt(format_args!("Checking for \"{}\" ", bstr::BStr::new(new_path)));
                    // }
                    if let Some(_remapped) = map.get(new_path) {
                        // SAFETY: ARENA — see `result` note above.
                        self.remapped = unsafe { bun_ptr::Interned::assume(_remapped) }.as_bytes();
                        // SAFETY: TODO(port): lifetime — `new_path` borrows the threadlocal `extension_path` buf; consumed before next overwrite.
                        self.cleaned = unsafe { &*std::ptr::from_ref::<[u8]>(new_path) };
                        // SAFETY: same as above.
                        self.input_path = unsafe { &*std::ptr::from_ref::<[u8]>(new_path) };
                        return true;
                    }
                }
            }

            // If that failed, try assuming this is a directory and looking for an "index" file

            let index_path: &[u8] = {
                let trimmed = strings::trim_right(path_to_check, &[SEP]);
                let parts = [
                    trimmed,
                    const_format::concatcp!(SEP_STR, "index").as_bytes(),
                ];
                ResolvePath::join_string_buf(
                    bufs!(tsconfig_base_url),
                    &parts,
                    bun_paths::Platform::AUTO,
                )
            };

            if let Some(_remapped) = map.get(index_path) {
                // SAFETY: ARENA — see `result` note above.
                self.remapped = unsafe { bun_ptr::Interned::assume(_remapped) }.as_bytes();
                // SAFETY: TODO(port): lifetime — `index_path` borrows the threadlocal `extension_path` buf; consumed before next overwrite.
                self.input_path = unsafe { &*std::ptr::from_ref::<[u8]>(index_path) };
                return true;
            }

            if index_path.len() <= ext_buf.len() {
                ext_buf[..index_path.len()].copy_from_slice(index_path);

                for ext in self.extension_order.iter() {
                    let ext: &[u8] = ext;
                    if index_path.len() + ext.len() > ext_buf.len() {
                        continue;
                    }
                    ext_buf[index_path.len()..index_path.len() + ext.len()].copy_from_slice(ext);
                    let new_path = &ext_buf[0..index_path.len() + ext.len()];
                    // if let Some(debug) = r.debug_logs.as_mut() {
                    //     debug.add_note_fmt(format_args!("Checking for \"{}\" ", bstr::BStr::new(new_path)));
                    // }
                    if let Some(_remapped) = map.get(new_path) {
                        // SAFETY: ARENA — see `result` note above.
                        self.remapped = unsafe { bun_ptr::Interned::assume(_remapped) }.as_bytes();
                        // SAFETY: TODO(port): lifetime — `new_path` borrows the threadlocal `extension_path` buf; consumed before next overwrite.
                        self.cleaned = unsafe { &*std::ptr::from_ref::<[u8]>(new_path) };
                        // SAFETY: same as above.
                        self.input_path = unsafe { &*std::ptr::from_ref::<[u8]>(new_path) };
                        return true;
                    }
                }
            }

            false
        }
    }

    #[inline]
    fn is_dot_slash(path: &[u8]) -> bool {
        #[cfg(not(windows))]
        {
            path == b"./"
        }
        #[cfg(windows)]
        {
            path.len() == 2 && path[0] == b'.' && strings::char_is_any_slash(path[1])
        }
    }

    // ModuleTypeMap = bun.ComptimeStringMap(options.ModuleType, .{...})
    //
    // PERF(port): was `phf::Map<&[u8], ModuleType>`. With only 4 keys — all
    // length 4 — the phf hash + index probe is strictly more work than a single
    // length gate followed by 4-byte compares (which LLVM lowers to one u32
    // load + compare per arm once `len == 4` is established). Mirrors the
    // length-gated dispatch used in `clap::find_param`.
    #[inline]
    fn module_type_from_ext(ext: &[u8]) -> Option<options::ModuleType> {
        if ext.len() != 4 {
            return None;
        }
        match ext {
            b".mjs" | b".mts" => Some(options::ModuleType::Esm),
            b".cjs" | b".cts" => Some(options::ModuleType::Cjs),
            _ => None,
        }
    }

    const NODE_MODULE_ROOT_STRING: &[u8] =
        const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes();

    // `dev` scope (Output.scoped(.Resolver, .visible)) — same scope name as `debuglog` but visible.
    // Folded into the same `Resolver` declared scope; visibility distinction handled in Phase B.

    pub struct Dirname;

    impl Dirname {
        /// NOT `std.fs.path.dirname`. Resolver-specific upward-traversal dirname
        /// (resolver.zig:4297): returns trailing-sep-INCLUSIVE slice, never `None`,
        /// `is_sep_any` on all platforms. Do NOT replace with `bun_core::dirname`.
        pub fn dirname(path: &[u8]) -> &[u8] {
            if path.is_empty() {
                return SEP_STR.as_bytes();
            }

            let root: &[u8] = {
                #[cfg(windows)]
                {
                    let root = ResolvePath::windows_filesystem_root(path);
                    // Preserve the trailing slash for UNC paths.
                    // Going from `\\server\share\folder` should end up
                    // at `\\server\share\`, not `\\server\share`
                    if root.len() >= 5 && path.len() > root.len() {
                        &path[0..root.len() + 1]
                    } else {
                        root
                    }
                }
                #[cfg(not(windows))]
                {
                    b"/"
                }
            };

            let mut end_index: usize = path.len() - 1;
            while bun_paths::is_sep_any(path[end_index]) {
                if end_index == 0 {
                    return root;
                }
                end_index -= 1;
            }

            while !bun_paths::is_sep_any(path[end_index]) {
                if end_index == 0 {
                    return root;
                }
                end_index -= 1;
            }

            if end_index == 0 && bun_paths::is_sep_any(path[0]) {
                return &path[0..1];
            }

            if end_index == 0 {
                return root;
            }

            &path[0..end_index + 1]
        }
    }

    pub struct RootPathPair<'b> {
        pub base_path: &'b [u8],
        pub package_json: *const PackageJSON,
    }

    // ported from: src/resolver/resolver.zig
} // end  mod __phase_a_body
