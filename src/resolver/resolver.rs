//! The [`Resolver`] state machine: import-path resolution against the on-disk
//! filesystem, `node_modules` tree, `tsconfig.json` paths, package `exports`,
//! `browser` maps, and the standalone (compiled) module graph. Holds the
//! `Resolver` struct and its impl,
//! plus the local helper shims (`bun_paths` value-dispatch joins,
//! `bun_sys` dir-open wrappers, `FdExt`) and threadlocal scratch buffers.

use crate::{is_package_path, is_package_path_not_absolute};

use core::ptr::NonNull;
use std::io::Write as _;

// ── Cross-crate type surface ──────────────────────────────────────────────
// Higher-tier symbols are reached through lower-tier crates:
//   • install value types + AutoInstaller trait — bun_install_types (MOVE_DOWN)
//   • HardcodedModule alias table              — bun_resolve_builtins
//   • StandaloneModuleGraph                    — trait below; impl in bun_standalone_graph
//   • perf / crash_handler                     — real bun_perf / bun_crash_handler
use ::bun_install_types::resolver_hooks as Install;
use ::bun_install_types::resolver_hooks::{AutoInstaller, Resolution};
use ::bun_semver as Semver;
// Re-exported so downstream (bun_bundler) can name the trait in
// `Transpiler::get_package_manager`'s return type without a direct
// `bun_install_types` dep (LAYERING: pass-through, no new edge).
pub use ::bun_install_types::resolver_hooks::AutoInstaller as PackageManagerTrait;

// LAYERING: `PackageManager.initWithRuntime` lives in
// `bun_install`, which depends on this crate. The lazy-init body is defined
// `#[no_mangle]` in `bun_install::auto_installer` and resolved at link time
// (same pattern as `__bun_regex_*` / `__BUN_RUNTIME_HOOKS`). `install` is the
// `?*Api.BunInstall` (`self.opts.install`); `env` is the `*DotEnv.Loader`
// (lifetime-erased to `'static` — the install crate stores it as a raw
// `NonNull<Loader<'static>>`).
unsafe extern "Rust" {
    /// SAFETY (genuine FFI precondition — NOT a `safe fn` candidate): impl
    /// reborrows `&mut *log` / `&mut *env` and reads `*install` if non-null.
    /// All three must point at process-lifetime Transpiler-owned storage; the
    /// returned `NonNull` names the `'static` `PackageManager` singleton.
    /// Errs when the one-time init fails (e.g. the top-level directory is
    /// unreadable); the failure is sticky across calls.
    fn __bun_resolver_init_package_manager(
        log: NonNull<bun_ast::Log>,
        install: Option<NonNull<bun_options_types::schema::api::BunInstall>>,
        env: NonNull<bun_dotenv::Loader<'static>>,
    ) -> core::result::Result<NonNull<dyn AutoInstaller>, bun_errno::SystemErrno>;
}
use crate::cache::Set as CacheSet;
use ::bun_resolve_builtins::{Alias as HardcodedAlias, Cfg as HardcodedAliasCfg};

/// `Dependency` namespace as the body spells it (`Dependency::Version` /
/// `Dependency::Behavior`). Re-exports the canonical `bun_install_types` items.
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
pub(crate) mod __forward_decls {}
// bun_paths shim — value-dispatched join helpers over `resolve_path::Platform`.
// `dirname` (`Option`-returning) and
// `PosixToWinNormalizer` are the real `::bun_paths` items — brought in by the
// glob / explicit re-export below, no local re-implementation.
mod bun_paths {
    pub(super) use ::bun_paths::resolve_path::PosixToWinNormalizer;
    pub(super) use ::bun_paths::resolve_path::is_sep_any;
    pub(super) use ::bun_paths::*;

    /// Value-dispatch over `Platform` to the const-generic `PlatformT`
    /// monomorphizations in `resolve_path`. The resolver body threads
    /// `Platform::AUTO` / `Platform::Loose` at runtime.
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
        // NOTE: `resolve_path::join_abs` ties the result lifetime to `cwd`, but the
        // returned slice always points into the threadlocal `PARSER_JOIN_INPUT_BUFFER`
        // (or is `cwd` itself when `parts.is_empty()`, which never happens here — we
        // pass exactly one part). Re-erase to `'static` so the resolver can hold it
        // across `&mut self` calls.
        let s = dispatch_platform!(platform, |P| ::bun_paths::resolve_path::join_abs::<P>(
            cwd, part
        ));
        // SAFETY: see NOTE — slice borrows threadlocal storage, valid 'static per-thread.
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
    /// Compile-time platform-separator literal (`/` → `\` on Windows). A
    /// const fn can't transform a borrowed `&'static [u8]`, so this is a
    /// macro that emits a fresh const array with the swap applied. Result is
    /// `&'static [u8; N]` (coerces to `&[u8]`).
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
    #[cfg(windows)]
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
}
// bun_sys shim — adds the `std.fs`-shaped dir-open surface the resolver names
// (`openDirAbsoluteZ` / `Dir.openDirZ`) on top of the real `::bun_sys` crate.
// `open` / `open_dir_for_iteration` / `get_fd_path` / `OpenDirOptions` /
// `iterate_dir` are now provided by the `pub use ::bun_sys::*` glob.
mod bun_sys {
    pub(super) use ::bun_sys::*;

    /// `open(path, O_DIRECTORY|O_RDONLY|O_CLOEXEC[|O_NOFOLLOW])`.
    /// `opts.iterate` is a no-op on POSIX (just an open mode hint).
    #[cfg(not(windows))]
    pub(super) fn open_dir_absolute_z(
        path: &::bun_core::ZStr,
        opts: OpenDirOptions,
    ) -> crate::CrateResult<Fd> {
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
    /// Opens a directory relative to `dir`: `openat(dir, path, O_DIRECTORY|O_RDONLY|O_CLOEXEC)`.
    pub(super) fn open_dir_z(
        dir: Fd,
        path: &[u8],
        _opts: OpenDirOptions,
    ) -> crate::CrateResult<Fd> {
        // NOTE: callers pass either a `&'static [u8]` literal or a NUL-terminated
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
}

/// `bun_sys::Fd` extension surface — thin method-syntax wrappers over the
/// free functions `::bun_sys::{close, get_fd_path}` and `Fd::native`, so the
/// resolver body can spell `fd.close()` / `fd.get_fd_path(buf)`.
trait FdExt: Sized {
    fn close(self);
    fn get_fd_path<'b>(self, buf: &'b mut ::bun_paths::PathBuffer) -> crate::CrateResult<&'b [u8]>;
}
impl FdExt for ::bun_sys::Fd {
    #[inline]
    fn close(self) {
        let _ = ::bun_sys::close(self);
    }
    #[inline]
    fn get_fd_path<'b>(self, buf: &'b mut ::bun_paths::PathBuffer) -> crate::CrateResult<&'b [u8]> {
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

use self::bun_paths as ResolvePath;
use ::bun_ast::import_record as ast;
use ::bun_core::{FeatureFlags, Generation};
use bun_ast::Msg;
use bun_collections::BoundedArray;
use bun_dotenv::env_loader as DotEnv;
use bun_paths::{MAX_PATH_BYTES, PathBuffer, SEP, SEP_STR};
use bun_perf::system_timer::Timer;
use bun_ptr::Interned;
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

// Sibling resolver modules. They retain the same item names so cross-references
// inside `impl Resolver` resolve unchanged.
use crate::options;
use crate::result::{
    DebugLogs, DirEntryResolveQueueItem, FlushMode, LoadResult, MatchResult, MatchStatus, PathPair,
    PendingResolution, PendingResolutionTag, Result, ResultFlags, ResultUnion,
};
use crate::standalone_module_graph::StandaloneModuleGraph;
use bun_alloc as allocators;
// `bun.resolver.SideEffects` — same type as `Result.primary_side_effects_data`
// (re-exported from `bun_ast`; see `result.rs`).
use bun_ast::SideEffects;

// ── Process-lifetime arenas for DirInfo-cached parses ─────────────────────
// The DirInfo cache (`DirInfo::hash_map_instance()`) is a true process-lifetime
// singleton; entries hold `&'static PackageJSON` / `&'static TSConfigJSON` and
// borrow `&'static [u8]` source bytes. PORTING.md §Forbidden bars `Box::leak`/
// `mem::forget` for this — process-lifetime storage must go through
// `LazyLock`. These append-only arenas are that storage; the `Box<T>` heap
// address is stable across `Vec` growth, so handing out `&'static T` is sound.

/// Intern a parsed `PackageJSON` into the process-lifetime DirInfo arena.
/// Returns `NonNull` (not `&'static`) so the mut-provenance survives into
/// `DirInfo::reset()`'s `drop_in_place` -- handing out `&T` here and casting
/// back to `*mut T` at the drop site would be UB under Stacked Borrows.
fn intern_package_json(pkg: PackageJSON) -> core::ptr::NonNull<PackageJSON> {
    // `Box` is load-bearing: returns `NonNull<PackageJSON>` derived from the
    // box interior, treated as `'static`; unboxing would dangle on `Vec` realloc.
    #[expect(clippy::vec_box)]
    static ARENA: std::sync::LazyLock<bun_threading::Guarded<Vec<Box<PackageJSON>>>> =
        std::sync::LazyLock::new(Default::default);
    let mut guard = ARENA.lock();
    guard.push(Box::new(pkg));
    // SAFETY: ARENA is `'static` (LazyLock); entries are never removed; the
    // `Box<PackageJSON>` heap address is stable across `Vec` reallocation.
    // Derive from `&mut **last` so the returned pointer carries mut-provenance.
    core::ptr::NonNull::from(&mut **guard.last_mut().unwrap())
}

// `bun_core::declare_scope!` emits the per-scope `static ScopedLogger`; the
// `debuglog!` macro forwards to the real `bun_core::scoped_log!` so debug builds
// emit and release builds dead-strip (PORTING.md §Logging).
//
bun_core::define_scoped_log!(debuglog, Resolver, hidden);

// Used by `bustDirCache`. Same `Resolver` tag as `debuglog` above (so
// `BUN_DEBUG_Resolver` controls both) but visible by default. `declare_scope!`
// derives the tag from the static's ident, so this one is hand-declared to
// keep the printed tag identical.
#[allow(non_upper_case_globals)]
static ResolverDev: bun_core::output::ScopedLogger =
    bun_core::output::ScopedLogger::new("Resolver", bun_core::output::Visibility::Visible);

// NOTE: `Path` in the body is the `'static`-interned variant (paths borrow
// DirnameStore/FilenameStore). Alias here so the ~80 bare-`Path` use sites
// resolve without a per-site lifetime annotation.
type Path = crate::fs::Path<'static>;

use crate::dir_info::HashMapExt as _;

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

    // NOTE: `DirEntryResolveQueueItem` holds
    // `&'static [u8]` fields, so a zeroed bit-pattern is UB. Use
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
// `Bufs` is modeled as a `thread_local! { static BUFS_PTR: BufsSlot }` caching a
// leaked `Box<Bufs>` pointer. `BufsSlot`'s `Drop` reclaims that box when a
// worker/transpiler-pool thread exits; the main thread's lives process-lifetime.
// The `bufs!()` macro hands out `&mut` to a
// single field. This relies on the caller never holding two `bufs!()` borrows
// simultaneously across the same field.
struct BufsSlot(core::cell::Cell<*mut Bufs>);
impl Drop for BufsSlot {
    fn drop(&mut self) {
        // Reclaim the per-thread `Box<Bufs>` when a worker/transpiler-pool
        // thread exits. Main-thread Bufs lives as long as the process, but
        // every worker that touches the resolver allocates a fresh ~116 KiB
        // box that was previously stranded.
        let p = self.0.get();
        if !p.is_null() {
            // SAFETY: produced by `Box::leak` in `bufs_storage_init`; this
            // thread is exiting so no resolver call frame holds a `bufs!()`
            // borrow into it.
            drop(unsafe { Box::from_raw(p) });
        }
    }
}
thread_local! {
    static BUFS_PTR: BufsSlot = const { BufsSlot(core::cell::Cell::new(core::ptr::null_mut())) };
}

#[inline(always)]
fn bufs_storage_get() -> *mut Bufs {
    // Fast path: TLS access + null check. `BUFS_PTR` is a `BufsSlot` (it has a
    // `Drop`), so `with()` goes through `thread_local!`'s destructor-state check
    // before the `Cell::get` load — still only a few instructions, no
    // RefCell/Option/closure machinery on the hot path (benches: misc/require-fs).
    let p = BUFS_PTR.with(|s| s.0.get());
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
    // all-zero — is a valid `Bufs`. Each
    // field is scratch (write-then-read within a single resolve call,
    // including `open_dirs` which is bounded by `open_dir_count`), so
    // there is no need to pay for zero-filling ~100 KiB on first use.
    let p: *mut Bufs = Box::leak(unsafe { Box::<Bufs>::new_uninit().assume_init() });
    BUFS_PTR.with(|s| s.0.set(p));
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

// This is a global so even if multiple resolvers are created, the mutex will still work
// `pub(crate)` so the `fs::EntriesMap::inner` debug-assert can verify it is held
// (the resolver mutex is one of the two documented guards for the entries singleton).
pub(crate) static RESOLVER_MUTEX: Mutex = Mutex::new();

type BinFolderArray = BoundedArray<&'static [u8], 128>;
// `BoundedArray` has no const constructor; init lazily under
// `BIN_FOLDERS_LOADED`.
static BIN_FOLDERS: bun_core::RacyCell<core::mem::MaybeUninit<BinFolderArray>> =
    bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());
static BIN_FOLDERS_LOCK: Mutex = Mutex::new();
static BIN_FOLDERS_LOADED: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

// LAYERING: `AnyResolveWatcher` is the erased vtable the resolver calls to
// register directory watches. The concrete callback lives in `bun_watcher`
// (lower tier); defining the vtable shape there and re-exporting here keeps a
// single type so `Watcher::get_resolve_watcher()` flows directly into
// `Resolver.watcher` without a seam converter.
pub use bun_watcher::AnyResolveWatcher;

// NOTE: const fn-pointer generics (`adt_const_params` for fn ptrs) and
// const params depending on type params are both forbidden. Carry a
// runtime fn-pointer alongside the context — `init` produces the
// `AnyResolveWatcher` erased shim.

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
            // (Rust-ABI, thin-ptr first arg). The callback body discharges its
            // own type-recovery.
            callback: unsafe {
                bun_ptr::cast_fn_ptr::<fn(*mut C, &[u8], FD), fn(*mut (), &[u8], FD)>(self.on_watch)
            },
        }
    }
}

pub struct Resolver<'a> {
    pub opts: options::BundleOptions,
    // NOTE: `fs` / `log` are raw aliasing
    // pointers — the bundler builds a `Resolver` per worker thread sharing the
    // process-wide `FileSystem` singleton, so `&'a mut` here would manufacture
    // aliased unique refs across threads (instant UB). Model as `*mut` /
    // `NonNull` (never-null but raw-aliasing) and deref through the `fs()` /
    // `log()` accessors below.
    pub fs: *mut Fs::FileSystem,
    pub log: NonNull<bun_ast::Log>,
    // allocator dropped — global mimalloc
    /// NOTE: saved/restored across nested resolves.
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
    /// below `bun_install` in the dep graph. `None` until the auto-install
    /// path is first reached: [`get_package_manager`] then initializes the
    /// singleton through the link-time `__bun_resolver_init_package_manager`
    /// factory and caches the pointer here. A failed init (e.g. unreadable
    /// top-level directory) is returned as an error and leaves this `None`.
    pub package_manager: Option<NonNull<dyn AutoInstaller>>,
    pub on_wake_package_manager: Install::WakeHandler,
    // Stored as `NonNull` (not `&'a Loader`) because the same allocation is
    // mutably reborrowed via `Transpiler.env: *mut Loader` after this field is
    // set (e.g. bake/production.rs assigns this then calls `configure_defines()`
    // → `run_env_loader()` which takes `&mut *self.env`). Holding a live
    // `&Loader` across that `&mut Loader` would be aliased-&mut UB; a raw
    // pointer carries no aliasing guarantee.
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
    // NOTE: a raw aliasing pointer to the
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
/// `Resolver::log` pointer on drop.
pub struct ResolverLogScope {
    slot: *mut NonNull<bun_ast::Log>,
    prev: NonNull<bun_ast::Log>,
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
    /// copy-from-`from` for the resolver
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
        log: NonNull<bun_ast::Log>,
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
            caches: CacheSet::init(),
            generation: from.generation,
            package_manager: from.package_manager,
            on_wake_package_manager: from.on_wake_package_manager,
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

    /// NOTE (Stacked Borrows): returns the RAW `*mut` (NOT `&'a mut`). A
    /// `&'a mut` accessor would let two `fs()` calls manufacture coexisting
    /// aliased unique refs to the same singleton (PORTING.md §Forbidden:
    /// aliased-&mut), and any later `&mut *self.fs` retag would pop a previously
    /// returned `&'a mut`'s SB tag while it's still nominally live for `'a`.
    /// Callers must `unsafe { &mut *r.fs() }` at the narrowest use site and let
    /// the projection die at end-of-expression.
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
    /// inside `self.opts`.
    #[inline(always)]
    pub fn extension_order(&self) -> &[Box<[u8]>] {
        self.opts.ext_order_slice(self.extension_order)
    }

    /// Raw-pointer projection to the inner `RealFS` (`self.fs.fs`).
    ///
    /// NOTE (Stacked Borrows): derived directly from the raw `*mut
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

    /// NOTE (Stacked Borrows): returns RAW `*mut` (see `fs()` note). BACKREF
    /// — owner (Transpiler/BundleV2) outlives the Resolver; worker clones share
    /// the same Log under the resolver mutex. Caller `unsafe { &mut *r.log() }`
    /// at each use site; do not bind the projected `&mut Log` across another
    /// `log()` deref.
    #[inline(always)]
    pub fn log(&self) -> *mut bun_ast::Log {
        self.log.as_ptr()
    }

    /// Temporarily redirect `self.log` to `log`, returning a guard that
    /// restores the previous pointer on drop.
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
    pub unsafe fn scoped_log(self_: *mut Self, log: NonNull<bun_ast::Log>) -> ResolverLogScope {
        // SAFETY: caller contract — `self_` is live; `addr_of_mut!` projects
        // the field place without an intermediate `&mut Resolver`.
        let slot = unsafe { core::ptr::addr_of_mut!((*self_).log) };
        // SAFETY: `slot` just derived from a live resolver.
        let prev = unsafe { *slot };
        // SAFETY: same as above — `slot` points at a live resolver field.
        unsafe { *slot = log };
        ResolverLogScope { slot, prev }
    }

    /// Shared-borrow of the resolver's `Log` for read-only inspection
    /// (e.g. `log.level`). Preferred over `unsafe { &*self.log() }`.
    #[inline(always)]
    pub fn log_ref(&self) -> &bun_ast::Log {
        // SAFETY: BACKREF — `self.log` is set in `init1` / `scoped_log`,
        // owner-allocated, outlives the Resolver. Resolver mutex serializes
        // mutation; a Shared `&` here pushes no Unique tag and so cannot
        // alias-UB with the narrow `log_mut()` retags elsewhere (none are live
        // across a `log_ref()` call).
        unsafe { self.log.as_ref() }
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
        // SAFETY: BACKREF — `self.log` is set in `init1` / `scoped_log`; the
        // pointee (owner-allocated `Log`, or a stack `Log` pinned by a live
        // `ResolverLogScope`) outlives every borrow returned here. Resolver
        // mutex serializes mutation across worker clones.
        unsafe { self.log.as_mut() }
    }

    /// NOTE (Stacked Borrows): returns RAW `*mut` (see `fs()` note). ARENA —
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
    /// `dir_cache_mut()` borrow is popped. Slot pointers that must survive a
    /// subsequent map access are re-derived from the raw singleton via
    /// `DirInfo::put_slot` / `DirInfo::slot_ptr_at`; refs from `at_index` /
    /// `ref_at_index` are only durable until the next map access.
    #[inline(always)]
    pub fn dir_cache_mut(&mut self) -> &mut DirInfo::HashMap {
        // SAFETY: ARENA — `self.dir_cache` is the never-null
        // `DirInfo::hash_map_instance()` static (set in `init1`, never
        // reassigned, never freed). Resolver mutex serializes all mutation
        // across worker clones; `&mut self` rules out intra-instance aliasing.
        unsafe { &mut *self.dir_cache }
    }

    /// Lazily initializing
    /// `PackageManager.initWithRuntime` here directly would
    /// be a `bun_resolver → bun_install` cycle, so the lazy init is
    /// dispatched through the link-time `extern "Rust"` factory
    /// [`__bun_resolver_init_package_manager`] (defined `#[no_mangle]` in
    /// `bun_install::auto_installer`). The factory performs
    /// `HTTPThread.init` + `PackageManager.initWithRuntime` and returns the
    /// process-static singleton as a `dyn AutoInstaller`. We then wire
    /// `on_wake` and cache the pointer. Reached from
    /// the auto-install path (`load_node_modules` global-cache block) when
    /// [`use_package_manager`] is `true`. Errs (without caching, but sticky
    /// inside the factory) when the one-time init fails, e.g. the top-level
    /// directory was deleted or is unreadable — callers surface that as a
    /// resolve failure rather than panicking.
    pub fn get_package_manager(&mut self) -> crate::CrateResult<*mut dyn AutoInstaller> {
        if let Some(pm) = self.package_manager {
            return Ok(pm.as_ptr());
        }
        // SAFETY: `DotEnv::Loader<'a>` is layout-identical across `'a`;
        // `init_with_runtime` only borrows it for the synchronous init (the
        // static `PackageManager` retains a raw `NonNull<Loader<'static>>`).
        let env: NonNull<DotEnv::Loader<'static>> = self
            .env_loader
            .expect("Resolver.env_loader must be set before auto-install")
            .cast::<DotEnv::Loader<'static>>();
        // SAFETY: `__bun_resolver_init_package_manager` is defined
        // `#[no_mangle]` in `bun_install::auto_installer` and linked into the
        // final binary; `self.log` / `self.opts.install` / `env` point at
        // process-lifetime storage (Transpiler-owned). The returned pointer
        // names the `PackageManager` singleton (`'static`).
        let pm: NonNull<dyn AutoInstaller> =
            unsafe { __bun_resolver_init_package_manager(self.log, self.opts.install, env) }?;
        // SAFETY: `pm` is the just-initialized singleton; sole `&mut` here.
        unsafe { (*pm.as_ptr()).set_on_wake(self.on_wake_package_manager) };
        self.package_manager = Some(pm);
        Ok(pm.as_ptr())
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
        // TODO: make this configurable. the rationale for disabling
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
        log: NonNull<bun_ast::Log>,
        _fs: *mut Fs::FileSystem,
        opts: options::BundleOptions,
    ) -> Self {
        // resolver_Mutex_loaded check elided; static is const-inited in Rust.

        let care_about_browser_field = opts.target == options::Target::Browser;
        Resolver {
            // allocator dropped
            // Route through the per-monomorphization singleton so this field and
            // `DirInfo::get_parent()` / `get_enclosing_browser_scope()` share storage.
            dir_cache: DirInfo::hash_map_instance(),
            mutex: &RESOLVER_MUTEX,
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
        out: &mut MatchResult,
    ) -> MatchStatus {
        // SAFETY: `import_path` is caller-interned (DirnameStore/source text)
        // and outlives the returned MatchResult.
        // TODO: thread an explicit `'a` through MatchResult instead.
        let import_path: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(import_path) };
        if source_dir.is_empty() {
            return MatchStatus::NotFound;
        }
        if !bun_paths::is_absolute(source_dir) {
            return MatchStatus::NotFound;
        }
        let Some(dir_info) = self.dir_info_cached(source_dir).ok().flatten() else {
            return MatchStatus::NotFound;
        };
        let Some(tsconfig) = dir_info.enclosing_tsconfig_json else {
            return MatchStatus::NotFound;
        };
        if tsconfig.paths.count() == 0 {
            return MatchStatus::NotFound;
        }
        self.match_tsconfig_paths(tsconfig, import_path, kind, out)
    }

    pub fn flush_debug_logs(&mut self, flush_mode: FlushMode) -> crate::CrateResult<()> {
        // NOTE: capture `log` before partially borrowing `self.debug_logs`
        // so the method call doesn't conflict with the field borrow (`log()`
        // derefs the raw `*mut Log` and is lifetime-decoupled from `&self`).
        // SAFETY: BACKREF — `self.log` points at owner-allocated `Log`; disjoint from
        // `self.debug_logs` (separate allocation), so the `&mut Log` does not alias the
        // `self.debug_logs.as_mut()` borrow below.
        let log = unsafe { &mut *self.log() };
        if let Some(debug) = self.debug_logs.as_mut() {
            // NOTE: only consume `what`/`notes` inside
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
        // SAFETY: `import_path` is caller-interned (source text / DirnameStore)
        // and outlives the returned Result.
        // TODO: thread an explicit lifetime through Result instead.
        let import_path: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(import_path) };
        let _tracer = ::bun_perf::trace(::bun_perf::PerfEvent::ModuleResolverResolve);

        // Only setting 'current_action' in debug mode because module resolution
        // is done very often, and has a very low crash rate.
        #[cfg(debug_assertions)]
        let _crash_guard =
            ::bun_crash_handler::set_current_action_resolver(source_dir, import_path, kind);

        #[cfg(debug_assertions)]
        if bun_core::debug_flags::has_resolve_breakpoint(import_path) {
            bun_core::debug!(
                "Resolving <green>{}<r> from <blue>{}<r>",
                bstr::BStr::new(import_path),
                bstr::BStr::new(source_dir),
            );
            // Trap into an attached debugger.
            // NOTE: `core::arch::breakpoint()` is still unstable on the pinned
            // toolchain; emit the trap instruction directly via stable `asm!`.
            #[cfg(target_arch = "x86_64")]
            // SAFETY: `int3` only raises SIGTRAP/EXCEPTION_BREAKPOINT; no memory or
            // register state is touched.
            unsafe {
                core::arch::asm!("int3")
            };
            #[cfg(target_arch = "aarch64")]
            // SAFETY: `brk` only raises SIGTRAP/EXCEPTION_BREAKPOINT; no memory or
            // register state is touched.
            unsafe {
                core::arch::asm!("brk #0xf000")
            };
        }

        let original_order = self.extension_order;
        // NOTE: the restore happens explicitly at every return point below.
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

        // The tracing-elapsed accumulation
        // fires on EVERY return path. Capture raw field ptrs (Copy) so the closure
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
            let mut res = MatchResult::default();
            if self
                .resolve_via_tsconfig_paths(source_dir, import_path, kind, &mut res)
                .is_success()
            {
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note(
                        b"Resolved via tsconfig.json \"paths\" before applying packages=external"
                            .to_vec(),
                    );
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
                return ResultUnion::Failure(crate::Error::InvalidDataURL);
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
                        debug.add_note(b"Putting this path in the \"dataurl\" namespace".to_vec());
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
                if ::bun_options_types::standalone_path::is_bun_standalone_file_path(import_path) {
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
                // return ResultUnion::Failure(crate::Error::MissingResolveDir);
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
                // return ResultUnion::Failure(crate::Error::InvalidResolveDir);
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

        let mut tmp =
            self.resolve_without_symlinks(source_dir_normalized, import_path, kind, global_cache);

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
                if cfg!(debug_assertions) {
                    // `debuglog!` self-gates on `debug_assertions`, the outer `if`
                    // dead-strips the `resolved_text` computation in release too.
                    let resolved_text: &[u8] =
                        result.path().map_or(&b"<NULL>"[..], |path| path.text());
                    let opts = bun_core::fmt::PathFormatOptions::default;
                    if let Some(secondary) = result.path_pair.secondary.as_ref() {
                        debuglog!(
                            "resolve({}, from: {}, {}) = {} (secondary: {})",
                            bun_core::fmt::fmt_path(import_path, opts()),
                            bun_core::fmt::fmt_path(source_dir, opts()),
                            bstr::BStr::new(kind.label()),
                            bun_core::fmt::fmt_path(resolved_text, opts()),
                            bun_core::fmt::fmt_path(secondary.text(), opts()),
                        );
                    } else {
                        debuglog!(
                            "resolve({}, from: {}, {}) = {}",
                            bun_core::fmt::fmt_path(import_path, opts()),
                            bun_core::fmt::fmt_path(source_dir, opts()),
                            bstr::BStr::new(kind.label()),
                            bun_core::fmt::fmt_path(resolved_text, opts()),
                        );
                    }
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
    ) -> crate::CrateResult<Result> {
        match self.resolve_and_auto_install(source_dir, import_path, kind, GlobalCache::disable) {
            ResultUnion::Success(result) => Ok(result),
            ResultUnion::Pending(_) | ResultUnion::NotFound => Err(crate::Error::ModuleNotFound),
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
    ) -> crate::CrateResult<Result> {
        // SAFETY: `import_path` is caller-interned (source text / DirnameStore)
        // and outlives the returned Result. TODO: thread an explicit lifetime.
        let import_path: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(import_path) };
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
                        // NOTE: copy out `path` so the `&self.opts.framework` borrow
                        // ends before `self.resolve(&mut self, ...)`.
                        // SAFETY: `path` borrows `self.opts.framework`, which lives for the
                        // resolver's lifetime; the `'static` erase only releases the `&self` borrow.
                        let path: &'static [u8] =
                            unsafe { &*std::ptr::from_ref::<[u8]>(path.as_ref()) };
                        let top = self.fs_ref().top_level_dir;
                        return self.resolve(top, path, ast::ImportKind::EntryPointBuild);
                    }
                }
            }
        }
        self.resolve(source_dir, import_path, kind)
    }

    pub fn finalize_result(
        &mut self,
        result: &mut Result,
        kind: ast::ImportKind,
    ) -> crate::CrateResult<()> {
        if result.flags.is_external() {
            return Ok(());
        }

        let mut iter = result.path_pair.iter();
        let mut module_type = result.module_type;
        while let Some(path) = iter.next() {
            let name = path.name();
            let Ok(Some(dir)) = self.read_dir_info(name.dir) else {
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
                    PJSideEffects::Unspecified | PJSideEffects::Glob(_) | PJSideEffects::Mixed(_)
                );

                result.primary_side_effects_data = match &existing.side_effects {
                    PJSideEffects::Unspecified => SideEffects::HasSideEffects,
                    PJSideEffects::False => SideEffects::NoSideEffectsPackageJson,
                    PJSideEffects::Map(map) => {
                        if map.contains_key(&crate::package_json::StringHashMapUnownedKey::init(
                            path.text(),
                        )) {
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
                .or_else(|| dir.enclosing_package_json.map(std::ptr::from_ref));

            if needs_side_effects {
                if let Some(package_json) = Result::deref_package_json(result.package_json) {
                    use crate::package_json::SideEffects as PJSideEffects;
                    result.primary_side_effects_data = match &package_json.side_effects {
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
                result.jsx = tsconfig.merge_jsx(core::mem::take(&mut result.jsx));
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
                && name.ext.len() == 4
            {
                module_type =
                    module_type_from_ext(name.ext).unwrap_or(options::ModuleType::Unknown);
            }

            if let Some(entries) = dir.get_entries_ref(self.generation) {
                if let Some(query) = entries.get(name.filename) {
                    // SAFETY: entries_mutex held; rfs points at the process-global RealFS.
                    let symlink_path =
                        unsafe { query.entry().symlink(self.rfs_ptr(), self.store_fd) };
                    // A composed realpath cached by a realpath-mode resolver
                    // (`symlink_is_composed`) must not leak into a
                    // `preserve_symlinks` resolution: the entry is not a
                    // symlink, and rewriting the path would undo the
                    // preserved link spelling. An actual symlink's target is
                    // applied in both modes.
                    if !symlink_path.is_empty()
                        && !(self.opts.preserve_symlinks
                            && query.entry().cache().symlink_is_composed)
                    {
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
                        let parts = [dir.abs_real_path, query.entry().base()];
                        let mut buf = bun_paths::PathBuffer::uninit();

                        // NOTE: `abs_buf` returns a borrow of `buf`; capture only the
                        // length so `buf` can be re-borrowed for null-termination below.
                        let out_len = self.fs_ref().abs_buf(&parts, &mut buf).len();

                        let store_fd = self.store_fd;

                        if !query.entry().cache().fd.is_valid() && store_fd {
                            buf[out_len] = 0;
                            // SAFETY: buf[out_len] == 0 written above
                            let span = bun_core::ZStr::from_buf(&buf[..], out_len);
                            // I/O errors propagate so `resolveAndAutoInstall` can
                            // return them as `Result.Union.failure` — never
                            // panic on EACCES/EMFILE/ELOOP here.
                            let file = bun_sys::open(span, bun_sys::O::RDONLY, 0)
                                .map_err(Into::<crate::Error>::into)?;
                            {
                                // Every cached-`Entry` rewrite takes the per-entry mutex.
                                let _entry_guard = query.entry().mutex.lock_guard();
                                query.entry().set_cache_fd(file);
                            }
                            Fs::FileSystem::set_max_fd(file.native());
                        }

                        // NOTE: snapshot `need_to_close_files` and raw-ptr the entry so
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
                                // Every cached-`Entry` rewrite takes the per-entry mutex.
                                let _entry_guard = e.mutex.lock_guard();
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
                        {
                            // Every cached-`Entry` rewrite takes the per-entry mutex.
                            let _entry_guard = query.entry().mutex.lock_guard();
                            query
                                .entry()
                                .set_cache_symlink(Interned::from_static(symlink));
                        }
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
                        let mut res = MatchResult::default();
                        if self
                            .match_tsconfig_paths(tsconfig, import_path, kind, &mut res)
                            .is_success()
                        {
                            // We don't set the directory fd here because it might remap an entirely different directory
                            return ResultUnion::Success(Result {
                                path_pair: res.path_pair,
                                diff_case: res.diff_case,
                                package_json: res.package_json,
                                dirname_fd: res.dirname_fd,
                                file_fd: res.file_fd,
                                jsx: tsconfig.merge_jsx(self.opts.jsx.clone()),
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
            let mut entry = MatchResult::default();
            if self
                .load_as_file_or_directory(
                    normalizer.resolve(source_dir, import_path),
                    kind,
                    &mut entry,
                )
                .is_success()
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
                result.jsx = self.opts.jsx.clone();
                let had_node_prefix = import_path.starts_with(b"node:");
                let import_path_without_node_prefix = if had_node_prefix {
                    &import_path[b"node:".len()..]
                } else {
                    import_path
                };

                if let Some(fallback_module) =
                    NodeFallbackModules::map().get(import_path_without_node_prefix)
                {
                    result.path_pair.primary = fallback_module.path;
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
                if let Some(import_dir_info) = import_dir_info_outer.get_enclosing_browser_scope() {
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

                        let mut match_result = MatchResult::default();
                        if self
                            .resolve_without_remapping(
                                import_dir_info,
                                remap,
                                kind,
                                global_cache,
                                &mut match_result,
                            )
                            .is_success()
                        {
                            let mut flags = ResultFlags::default();
                            flags.set_is_external(match_result.is_external);
                            flags.set_is_external_and_rewrite_import_path(match_result.is_external);
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
                    }
                }
            }
        }

        let prev_extension_order = self.extension_order;
        // NOTE: defer restore reshaped — restored before each return
        if strings::path_contains_node_modules_folder(abs_path) {
            self.extension_order = self.opts.extension_order.kind(kind, true);
        }
        let mut res = MatchResult::default();
        let ret = if self
            .load_as_file_or_directory(abs_path, kind, &mut res)
            .is_success()
        {
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
                debug_assert!(is_package_path(import_path));
                let mut closest_dir = source_dir;
                // `dirname` returns `None` once the entire directory tree
                // has been visited. `None` is theoretically impossible since
                // the drive root should always exist.
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
                            let mut node_module = MatchResult::default();
                            if self
                                .load_node_modules(
                                    import_path,
                                    kind,
                                    source_dir_info,
                                    global_cache,
                                    false,
                                    &mut node_module,
                                )
                                .is_success()
                            {
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
                            } else {
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

                        import_path = remapped;
                        source_dir_info = browser_scope;
                    }
                }
            }
        }

        let mut res = MatchResult::default();
        match self.resolve_without_remapping(
            source_dir_info,
            import_path,
            kind,
            global_cache,
            &mut res,
        ) {
            MatchStatus::Success => {
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
                result.module_type = res.module_type;
                result.flags.set_is_external(res.is_external);
                // Potentially rewrite the import path if it's external that
                // was remapped to a different path
                result
                    .flags
                    .set_is_external_and_rewrite_import_path(result.flags.is_external());

                if result.path_pair.primary.is_disabled && result.path_pair.secondary.is_none() {
                    return ResultUnion::Success(result);
                }

                if res.package_json.is_some() && self.care_about_browser_field {
                    let base_dir_info = match res.dir_info {
                        Some(d) => d,
                        None => match self.read_dir_info(result.path_pair.primary.name().dir) {
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
                                let mut remapped = MatchResult::default();
                                if self
                                    .resolve_without_remapping(
                                        browser_scope,
                                        remap,
                                        kind,
                                        global_cache,
                                        &mut remapped,
                                    )
                                    .is_success()
                                {
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
                            }
                        }
                    }
                }

                ResultUnion::Success(result)
            }
            MatchStatus::Pending(p) => ResultUnion::Pending(*p),
            MatchStatus::Failure(p) => ResultUnion::Failure(p),
            MatchStatus::NotFound => ResultUnion::NotFound,
        }
    }

    // This is a fallback, hopefully not called often. It should be relatively quick because everything should be in the cache.
    pub fn package_json_for_resolved_node_module(
        &mut self,
        result: &Result,
    ) -> Option<*const PackageJSON> {
        let mut dir_info = self
            .dir_info_cached(result.path_pair.primary.name().dir)
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

    pub fn root_node_module_package_json(&mut self, result: &Result) -> Option<RootPathPair<'_>> {
        let path = result.path_const()?;
        let mut absolute = path.text();
        // /foo/node_modules/@babel/standalone/index.js
        //     ^------------^
        let mut end = strings::last_index_of(absolute, NODE_MODULE_ROOT_STRING).or_else(|| {
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
            if slice == pkg.source.path.name().dir_with_trailing_slash() {
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
            ResolverDev,
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
        // NOTE: `DirInfoRef` (not `&mut`) — body re-enters `dir_cache` via
        // `dir_info_cached()` which, in the self-reference branch, returns the
        // SAME BSSMap slot. A `&mut` param carries an FnEntry protector under
        // Stacked Borrows; the inner retag would pop it (aliased-&mut UB).
        // The arena handle Derefs
        // to `&DirInfo` per use so overlapping shared reads are sound.
        _dir_info: DirInfoRef,
        global_cache: GlobalCache,
        forbid_imports: bool,
        out: &mut MatchResult,
    ) -> MatchStatus {
        let mut dir_info: DirInfoRef = _dir_info;
        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!(
                "Searching for {} in \"node_modules\" directories starting from \"{}\"",
                bstr::BStr::new(import_path),
                bstr::BStr::new(dir_info.abs_path)
            ));
            debug.increase_indent();
        }
        // NOTE: `decrease_indent()` is called explicitly at every return point below.

        // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file

        if let Some(tsconfig) = dir_info.enclosing_tsconfig_json {
            // Try path substitutions first
            if tsconfig.paths.count() > 0 {
                if self
                    .match_tsconfig_paths(tsconfig, import_path, kind, out)
                    .is_success()
                {
                    if let Some(d) = self.debug_logs.as_mut() {
                        d.decrease_indent();
                    }
                    return MatchStatus::Success;
                }
            }

            // Try looking up the path relative to the base URL
            if tsconfig.has_base_url() {
                let base: &[u8] = &tsconfig.base_url;
                if let Some(abs) = self.fs_ref().abs_buf_checked(
                    &[base, import_path],
                    bufs!(load_as_file_or_directory_via_tsconfig_base_path),
                ) {
                    if self.load_as_file_or_directory(abs, kind, out).is_success() {
                        if let Some(d) = self.debug_logs.as_mut() {
                            d.decrease_indent();
                        }
                        return MatchStatus::Success;
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

            if import_path.starts_with(b"#") && !forbid_imports && package_json.imports.is_some() {
                let r = self.load_package_imports(
                    import_path,
                    _dir_info_package_json,
                    kind,
                    global_cache,
                    out,
                );
                if let Some(d) = self.debug_logs.as_mut() {
                    d.decrease_indent();
                }
                return r;
            }

            // https://nodejs.org/api/packages.html#packages_self_referencing_a_package_using_its_name
            let package_name = crate::package_json::Package::parse_name(import_path);
            if let Some(_package_name) = package_name {
                if _package_name == package_json.name.as_ref() && package_json.exports.is_some() {
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
        if use_node_module_resolver {
            loop {
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
                    // NOTE: defer restore reshaped — restored at end of block

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
                                    // NOTE: keeping a single
                                    // `ESModule` (which holds `&mut self.debug_logs`) alive across a
                                    // `&mut self` call is aliased-&mut UB. Build a fresh short-lived
                                    // `ESModule` per `resolve` call so its borrow ends before
                                    // `self.handle_esm_resolution` re-borrows `self`.
                                    // Resolve against the path "/", then join it with the absolute
                                    // directory path. This is done because ESM package resolution uses
                                    // URLs while our path resolution uses file system paths. We don't
                                    // want problems due to Windows paths, which are very unlike URL
                                    // paths. We also want to avoid any "%" characters in the absolute
                                    // directory path accidentally being interpreted as URL escapes.
                                    {
                                        let esm_resolution = ESModule {
                                            conditions: match kind {
                                                ast::ImportKind::Require
                                                | ast::ImportKind::RequireResolve => {
                                                    &self.opts.conditions.require
                                                }
                                                ast::ImportKind::At
                                                | ast::ImportKind::AtConditional => {
                                                    &self.opts.conditions.style
                                                }
                                                _ => &self.opts.conditions.import,
                                            },
                                            debug_logs: self.debug_logs.as_mut(),
                                            module_type: &mut module_type,
                                        }
                                        .resolve(b"/", esm.subpath, &exports_map.root);
                                        // ESModule temporary dropped here; `self` is unborrowed.

                                        if self
                                            .handle_esm_resolution(
                                                esm_resolution,
                                                abs_package_path,
                                                kind,
                                                package_json,
                                                esm.subpath,
                                                out,
                                            )
                                            .is_success()
                                        {
                                            out.is_node_module = true;
                                            out.module_type = module_type;
                                            self.extension_order = prev_extension_order;
                                            if let Some(d) = self.debug_logs.as_mut() {
                                                d.decrease_indent();
                                            }
                                            return MatchStatus::Success;
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
                                            conditions: match kind {
                                                ast::ImportKind::Require
                                                | ast::ImportKind::RequireResolve => {
                                                    &self.opts.conditions.require
                                                }
                                                ast::ImportKind::At
                                                | ast::ImportKind::AtConditional => {
                                                    &self.opts.conditions.style
                                                }
                                                _ => &self.opts.conditions.import,
                                            },
                                            debug_logs: self.debug_logs.as_mut(),
                                            module_type: &mut module_type,
                                        }
                                        .resolve(
                                            b"/",
                                            &esm.subpath[0..esm.subpath.len() - 3],
                                            &exports_map.root,
                                        );
                                        if self
                                            .handle_esm_resolution(
                                                esm_resolution,
                                                abs_package_path,
                                                kind,
                                                package_json,
                                                esm.subpath,
                                                out,
                                            )
                                            .is_success()
                                        {
                                            out.is_node_module = true;
                                            out.module_type = module_type;
                                            self.extension_order = prev_extension_order;
                                            if let Some(d) = self.debug_logs.as_mut() {
                                                d.decrease_indent();
                                            }
                                            return MatchStatus::Success;
                                        }
                                    }

                                    // if they hid "package.json" from "exports", still allow importing it.
                                    if esm.subpath == b"./package.json" {
                                        self.extension_order = prev_extension_order;
                                        if let Some(d) = self.debug_logs.as_mut() {
                                            d.decrease_indent();
                                        }
                                        *out = MatchResult {
                                            // NOTE: PackageJSON.source.path is bun_paths::fs::Path<'static>; convert
                                            // to the resolver's interned crate::fs::Path<'static> via its text.
                                            path_pair: PathPair {
                                                primary: Path::init(package_json.source.path.text),
                                                secondary: None,
                                            },
                                            dirname_fd: pkg_dir_info.get_file_descriptor(),
                                            file_fd: FD::INVALID,
                                            // `Path.isNodeModule()` checks
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
                                        };
                                        return MatchStatus::Success;
                                    }

                                    self.extension_order = prev_extension_order;
                                    if let Some(d) = self.debug_logs.as_mut() {
                                        d.decrease_indent();
                                    }
                                    return MatchStatus::NotFound;
                                }
                            }
                        }
                    }

                    if self
                        .load_as_file_or_directory(abs_path, kind, out)
                        .is_success()
                    {
                        self.extension_order = prev_extension_order;
                        if let Some(d) = self.debug_logs.as_mut() {
                            d.decrease_indent();
                        }
                        return MatchStatus::Success;
                    }
                    self.extension_order = prev_extension_order;
                }

                match dir_info.get_parent() {
                    Some(p) => dir_info = p,
                    None => break,
                }
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
                if self
                    .load_as_file_or_directory(abs_path, kind, out)
                    .is_success()
                {
                    if let Some(d) = self.debug_logs.as_mut() {
                        d.decrease_indent();
                    }
                    return MatchStatus::Success;
                }
            }
        }

        dir_info = source_dir_info;

        // this is the magic!
        if global_cache.can_use(any_node_modules_folder)
            && self.use_package_manager()
            && let Some(esm_ref) = esm_.as_ref()
            && strings::is_npm_package_name(esm_ref.name)
        {
            let esm = esm_ref.with_auto_version();
            'load_module_from_cache: {
                // If the source directory doesn't have a node_modules directory, we can
                // check the global cache directory for a package.json file.
                //
                // NOTE (Stacked Borrows): `get_package_manager` returns the
                // `*mut dyn AutoInstaller` raw pointer; the body below re-borrows
                // `self` for `enqueue_dependency_to_resolve` / `debug_logs` /
                // `log()`. The PackageManager lives in a separate allocation, so
                // derive a raw pointer once and re-borrow per use — disjoint
                // from `self`'s storage.
                let manager_ptr: *mut dyn AutoInstaller = match self.get_package_manager() {
                    Ok(pm) => pm,
                    Err(err) => {
                        // One-time init reads the top-level directory, which
                        // can fail at runtime (cwd deleted, EACCES, a dropped
                        // network drive). Report it as a catchable resolve
                        // error; the `Metadata::Resolve` msg carries the text
                        // for `import.meta.resolveSync` & co.
                        let top_level_dir = self.fs_ref().top_level_dir;
                        self.log_mut().add_resolve_error(
                            None,
                            bun_ast::Range::NONE,
                            format_args!(
                                "Cannot read directory \"{}\": {} while resolving \"{}\"",
                                bstr::BStr::new(top_level_dir),
                                bstr::BStr::new(err.name()),
                                bstr::BStr::new(import_path)
                            ),
                            import_path,
                            kind,
                            bun_ast::Error::ModuleNotFound,
                        );
                        if let Some(d) = self.debug_logs.as_mut() {
                            d.decrease_indent();
                        }
                        return MatchStatus::Failure(err);
                    }
                };
                macro_rules! manager {
                    () => {
                        // SAFETY: re-borrowed narrowly per use; PackageManager outlives resolver.
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
                        let resolve_from_lockfile =
                            package_json.package_manager_package_id != Install::INVALID_PACKAGE_ID;

                        if resolve_from_lockfile {
                            let dependencies = manager!().lockfile_package_dependencies(
                                package_json.package_manager_package_id,
                            );

                            // try to find this package name in the dependencies of the enclosing package
                            dependencies_list =
                                dependencies.get(manager!().lockfile_dependencies_buf());
                            string_buf = manager!().lockfile_string_bytes();
                        } else if esm_ref.version.is_empty() {
                            // If you don't specify a version, default to the one chosen in your package.json
                            dependencies_list = package_json.dependencies.map.values();
                            string_buf = package_json.dependencies.source_buf;
                        }

                        for (dependency_id, dependency) in dependencies_list.iter().enumerate() {
                            if !strings::eql_long(dependency.name.slice(string_buf), esm.name, true)
                            {
                                continue;
                            }

                            dependency_version = dependency.version.clone();
                            dependency_behavior = dependency.behavior;

                            if resolve_from_lockfile {
                                let resolutions = manager!().lockfile_package_resolutions(
                                    package_json.package_manager_package_id,
                                );

                                // found it!
                                break 'brk resolutions.get(manager!().lockfile_resolutions_buf())
                                    [dependency_id];
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
                            if !esm_ref.version.is_empty()
                                && dir_info.enclosing_package_json.is_some()
                                && global_cache.allow_version_specifier()
                            {
                                if let Some(d) = self.debug_logs.as_mut() {
                                    d.decrease_indent();
                                }
                                return MatchStatus::Failure(
                                    crate::Error::VersionSpecifierNotAllowedHere,
                                );
                            }
                            string_buf = esm.version;
                            dependency_version = match manager!().parse_dependency(
                                Semver::String::init(esm.name, esm.name),
                                None,
                                esm.version,
                                &sliced_string,
                                Some(self.log_mut()),
                            ) {
                                Some(v) => v,
                                None => break 'load_module_from_cache,
                            };
                        }

                        if let Some(id) = manager!().lockfile_resolve(esm.name, &dependency_version)
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
                        // `intern_package_json` survives to the write inside.
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
                            return MatchStatus::Pending(pending);
                        }
                        DependencyToResolve::Failure(err) => {
                            if let Some(d) = self.debug_logs.as_mut() {
                                d.decrease_indent();
                            }
                            return MatchStatus::Failure(err);
                        }
                        // this means we looked it up in the registry and the package doesn't exist or the version doesn't exist
                        DependencyToResolve::NotFound => {
                            if let Some(d) = self.debug_logs.as_mut() {
                                d.decrease_indent();
                            }
                            return MatchStatus::NotFound;
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
                        if err == bun_core::Error::FileNotFound {
                            match manager!().get_preinstall_state(resolved_package_id) {
                                Install::PreinstallState::Done => {
                                    // NOTE: `MatchResult.path_pair` is `Path<'static>`;
                                    // intern `import_path` so the disabled-module record
                                    // outlives this frame.
                                    let interned = Fs::file_system::DirnameStore::instance()
                                        .append_slice(import_path)
                                        .expect("unreachable");
                                    let mut path = Fs::Path::init(interned);
                                    path.is_disabled = true;
                                    // this might mean the package is disabled
                                    if let Some(d) = self.debug_logs.as_mut() {
                                        d.decrease_indent();
                                    }
                                    *out = MatchResult {
                                        path_pair: PathPair {
                                            primary: path,
                                            secondary: None,
                                        },
                                        ..Default::default()
                                    };
                                    return MatchStatus::Success;
                                }
                                st @ (Install::PreinstallState::Extract
                                | Install::PreinstallState::Extracting) => {
                                    if !global_cache.can_install() {
                                        if let Some(d) = self.debug_logs.as_mut() {
                                            d.decrease_indent();
                                        }
                                        return MatchStatus::NotFound;
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
                                                Install::TaskCallbackContext { root_request_id: 0 },
                                                None,
                                            )
                                        {
                                            if let Some(d) = self.debug_logs.as_mut() {
                                                d.decrease_indent();
                                            }
                                            return MatchStatus::Failure(
                                                enqueue_download_err.into(),
                                            );
                                        }
                                    }

                                    if let Some(d) = self.debug_logs.as_mut() {
                                        d.decrease_indent();
                                    }
                                    return MatchStatus::Pending(Box::new(PendingResolution {
                                        esm: cloned,
                                        dependency: dependency_version,
                                        resolution_id: resolved_package_id,
                                        string_buf,
                                        tag: PendingResolutionTag::Download,
                                        ..Default::default()
                                    }));
                                }
                                _ => {}
                            }
                        }

                        if let Some(d) = self.debug_logs.as_mut() {
                            d.decrease_indent();
                        }
                        return MatchStatus::Failure(err.into());
                    }
                };

                match self.dir_info_for_resolution(dir_path_for_resolution, resolved_package_id) {
                    Ok(dir_info_to_use_) => {
                        if let Some(pkg_dir_info) = dir_info_to_use_ {
                            let abs_package_path = pkg_dir_info.abs_path;
                            let mut module_type = options::ModuleType::Unknown;
                            if let Some(package_json) = pkg_dir_info.package_json() {
                                if let Some(exports_map) = package_json.exports.as_ref() {
                                    // The condition set is determined by the kind of import
                                    // NOTE: reshaped for borrowck — see identical note above.
                                    // Resolve against the path "/", then join it with the absolute
                                    // directory path. This is done because ESM package resolution uses
                                    // URLs while our path resolution uses file system paths. We don't
                                    // want problems due to Windows paths, which are very unlike URL
                                    // paths. We also want to avoid any "%" characters in the absolute
                                    // directory path accidentally being interpreted as URL escapes.
                                    {
                                        let esm_resolution = ESModule {
                                            conditions: match kind {
                                                ast::ImportKind::Require
                                                | ast::ImportKind::RequireResolve => {
                                                    &self.opts.conditions.require
                                                }
                                                _ => &self.opts.conditions.import,
                                            },
                                            debug_logs: self.debug_logs.as_mut(),
                                            module_type: &mut module_type,
                                        }
                                        .resolve(b"/", esm.subpath, &exports_map.root);

                                        if self
                                            .handle_esm_resolution(
                                                esm_resolution,
                                                abs_package_path,
                                                kind,
                                                package_json,
                                                esm.subpath,
                                                out,
                                            )
                                            .is_success()
                                        {
                                            out.is_node_module = true;
                                            if let Some(d) = self.debug_logs.as_mut() {
                                                d.decrease_indent();
                                            }
                                            return MatchStatus::Success;
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
                                            conditions: match kind {
                                                ast::ImportKind::Require
                                                | ast::ImportKind::RequireResolve => {
                                                    &self.opts.conditions.require
                                                }
                                                _ => &self.opts.conditions.import,
                                            },
                                            debug_logs: self.debug_logs.as_mut(),
                                            module_type: &mut module_type,
                                        }
                                        .resolve(
                                            b"/",
                                            &esm.subpath[0..esm.subpath.len() - 3],
                                            &exports_map.root,
                                        );
                                        if self
                                            .handle_esm_resolution(
                                                esm_resolution,
                                                abs_package_path,
                                                kind,
                                                package_json,
                                                esm.subpath,
                                                out,
                                            )
                                            .is_success()
                                        {
                                            out.is_node_module = true;
                                            if let Some(d) = self.debug_logs.as_mut() {
                                                d.decrease_indent();
                                            }
                                            return MatchStatus::Success;
                                        }
                                    }

                                    // if they hid "package.json" from "exports", still allow importing it.
                                    if esm.subpath == b"./package.json" {
                                        if let Some(d) = self.debug_logs.as_mut() {
                                            d.decrease_indent();
                                        }
                                        *out = MatchResult {
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
                                            package_json: Some(std::ptr::from_ref(package_json)),
                                            dir_info: Some(dir_info),
                                            ..Default::default()
                                        };
                                        return MatchStatus::Success;
                                    }

                                    if let Some(d) = self.debug_logs.as_mut() {
                                        d.decrease_indent();
                                    }
                                    return MatchStatus::NotFound;
                                }
                            }

                            let Some(abs_path) = self.fs_ref().abs_buf_checked(
                                &[pkg_dir_info.abs_path, esm.subpath],
                                bufs!(node_modules_check),
                            ) else {
                                if let Some(d) = self.debug_logs.as_mut() {
                                    d.decrease_indent();
                                }
                                return MatchStatus::NotFound;
                            };
                            if let Some(debug) = self.debug_logs.as_mut() {
                                debug.add_note_fmt(format_args!(
                                    "Checking for a package in the directory \"{}\"",
                                    bstr::BStr::new(abs_path)
                                ));
                            }

                            if self
                                .load_as_file_or_directory(abs_path, kind, out)
                                .is_success()
                            {
                                out.is_node_module = true;
                                if let Some(d) = self.debug_logs.as_mut() {
                                    d.decrease_indent();
                                }
                                return MatchStatus::Success;
                            }
                        }
                    }
                    Err(err) => {
                        if let Some(d) = self.debug_logs.as_mut() {
                            d.decrease_indent();
                        }
                        return MatchStatus::Failure(err);
                    }
                }
            }
        }

        if let Some(d) = self.debug_logs.as_mut() {
            d.decrease_indent();
        }
        MatchStatus::NotFound
    }

    fn dir_info_for_resolution(
        &mut self,
        dir_path_maybe_trail_slash: &[u8],
        package_id: Install::PackageID,
    ) -> crate::CrateResult<Option<DirInfoRef>> {
        debug_assert!(self.package_manager.is_some());

        // The body's SAFETY comments assume the resolver mutex, and the mode
        // sync below must be serialized with the dir-cache fill. Callers never
        // hold it: the sole caller (`load_node_modules`) re-enters
        // `dir_info_cached`, which takes this mutex itself.
        let _unlock = self.mutex.lock_guard();

        let dir_path = strings::without_trailing_slash_windows_path(dir_path_maybe_trail_slash);

        DirInfo::sync_preserve_symlinks_mode(self.opts.preserve_symlinks);
        Self::assert_valid_cache_key(dir_path);
        let mut dir_cache_info_result = self.dir_cache_mut().get_or_put(dir_path)?;
        if dir_cache_info_result.status == allocators::ItemStatus::Exists {
            // we've already looked up this package before
            // SAFETY: `Exists` index was assigned by `put`; resolver mutex held.
            // The slot pointer is rooted at the singleton, so the returned ref
            // survives the caller's later map reborrows.
            return Ok(unsafe { DirInfo::slot_ptr_at(dir_cache_info_result.index) }
                .map(|p| unsafe { DirInfoRef::from_raw(p) }));
        }
        // SAFETY: PORT (Stacked Borrows) — derive `rfs` from the raw `*mut FileSystem`
        // field via `addr_of_mut!` so later `&mut *self.log()` / `&mut *self.dir_cache()`
        // retags below don't pop its provenance. Re-borrow `&mut *rfs` per use.
        let rfs: *mut Fs::file_system::RealFS = self.rfs_ptr();
        macro_rules! rfs {
            () => {
                // SAFETY: `rfs` points at the process-global RealFS singleton; see note above.
                unsafe { &mut *rfs }
            };
        }
        // Hold `entries_mutex` across the in-place `DirEntry` rewrite below and
        // the `dir_info_uncached` call, mirroring `dir_info_cached_miss`: the
        // route loaders iterate the `DirEntry.data` map under this lock.
        let _entries_unlock = rfs!().entries_mutex.lock_guard();
        let mut cached_dir_entry_result = rfs!().entries.get_or_put(dir_path)?;

        // NOTE: always assigned by either the cached-hit arm or the
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
                // NOTE: `StringHashMap` (std::HashMap newtype)
                // has no separate `clear_and_free`; `clear()` drops all entries.
                unsafe { &mut *existing }.data.clear();
            }

            if self.store_fd {
                new_entry.fd = open_dir;
            }
            // NOTE: see `dir_info_cached_maybe_log` — `DirEntry.data` holds a `NonNull`,
            // so a zeroed slot is UB; box `new_entry` directly for the fresh case.
            let dir_entries_ptr = match in_place {
                Some(p) => {
                    // SAFETY: dir_entries_ptr is a live BSSMap slot (`in_place`).
                    unsafe { *p = new_entry };
                    p
                }
                None => bun_core::heap::into_raw(Box::new(new_entry)),
            };

            bun_core::scoped_log!(
                crate::fs_full::Fs,
                "readdir({}, {}) = {}",
                open_dir,
                bstr::BStr::new(dir_path),
                // SAFETY: `dir_entries_ptr` is a live BSSMap slot (`in_place`) or a freshly
                // boxed entry (see block-wide note above).
                unsafe { (*dir_entries_ptr).data.count() },
            );

            dir_entries_option = rfs!()
                .entries
                .put(
                    &mut cached_dir_entry_result,
                    Fs::file_system::real_fs::EntriesOption::Entries(
                        // SAFETY: `dir_entries_ptr` is a live BSSMap slot (`in_place`) or a freshly boxed entry.
                        unsafe { &mut *dir_entries_ptr },
                    ),
                )
                .expect("unreachable");
        }

        // We must initialize it as empty so that the result index is correct.
        // This is important so that browser_scope has a valid index.
        // SAFETY: `dir_cache()` is the live singleton; resolver mutex held.
        let dir_info_ptr: *mut DirInfo::DirInfo = unsafe {
            DirInfo::put_slot(
                self.dir_cache(),
                &mut dir_cache_info_result,
                DirInfo::DirInfo::default(),
            )
        }
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
        // NOTE: carried as
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
        // NOTE: see `manager_ptr` note in `load_node_modules` — split the
        // `&mut self` borrow by holding the PackageManager via raw pointer.
        // Init failure is unreachable in practice (`load_node_modules`
        // initialized the manager before calling here), but propagate rather
        // than unwrap so the invariant isn't load-bearing for safety.
        let pm_ptr: *mut dyn AutoInstaller = match self.get_package_manager() {
            Ok(pm) => pm,
            Err(err) => return DependencyToResolve::Failure(err),
        };
        macro_rules! pm {
            () => {
                // SAFETY: PackageManager lives in a separate allocation; disjoint from `self`.
                unsafe { &mut *pm_ptr }
            };
        }
        // we should never be trying to resolve a dependency that is already resolved
        debug_assert!(pm!().lockfile_resolve(esm.name, &version).is_none());

        // Add the containing package to the lockfile

        let is_main =
            pm!().lockfile_packages_len() == 0 && input_package_id == Install::INVALID_PACKAGE_ID;
        if is_main {
            if let Some(mut package_json) = package_json_ {
                // SAFETY: BACKREF — `package_json` is an interned arena slot
                // (see `intern_package_json`); `NonNull` carries mut-provenance
                // from `NonNull::from(&mut **last)` and no other live borrow
                // exists here.
                let package_json: &mut PackageJSON = unsafe { package_json.as_mut() };
                // NOTE: the `Package` type is bun_install-internal; the
                // `AutoInstaller` impl performs the from-package-json /
                // setHasInstallScript / appendPackage steps.
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
                    Err(err) => return DependencyToResolve::Failure(err.into()),
                };
                package_json.package_manager_package_id = id;
            } else {
                // we're resolving an unknown package
                // the unknown package is the root package
                if let Err(err) = pm!().lockfile_append_root_stub() {
                    return DependencyToResolve::Failure(err.into());
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

                    return DependencyToResolve::Pending(Box::new(PendingResolution {
                        esm: cloned,
                        dependency: version,
                        root_dependency_id: id,
                        string_buf,
                        tag: PendingResolutionTag::Resolve,
                        ..Default::default()
                    }));
                }
                Install::EnqueueResult::NotFound => {
                    return DependencyToResolve::NotFound;
                }
                Install::EnqueueResult::Failure(err) => {
                    return DependencyToResolve::Failure(err.into());
                }
            }
        }

        // NOTE: the non-root path is genuinely unimplemented; this is not a stub.
        unreachable!("TODO: implement enqueueDependencyToResolve for non-root packages")
    }

    fn handle_esm_resolution(
        &mut self,
        esm_resolution_: crate::package_json::Resolution,
        abs_package_path: &[u8],
        kind: ast::ImportKind,
        package_json: &PackageJSON,
        package_subpath: &[u8],
        out: &mut MatchResult,
    ) -> MatchStatus {
        let mut esm_resolution = esm_resolution_;
        use crate::package_json::Status;
        if !((matches!(
            esm_resolution.status,
            Status::Inexact | Status::Exact | Status::ExactEndsWithStar
        )) && !esm_resolution.path.is_empty()
            && esm_resolution.path[0] == SEP)
        {
            return MatchStatus::NotFound;
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
                return MatchStatus::NotFound;
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
                        return MatchStatus::NotFound;
                    }
                };
                let entries = match resolved_dir_info.get_entries_ref(self.generation) {
                    Some(e) => e,
                    None => {
                        esm_resolution.status = Status::ModuleNotFound;
                        return MatchStatus::NotFound;
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
                                        let parts = [package_json.name.as_ref(), package_subpath];
                                        debug.add_note_fmt(format_args!(
                                            "The import {} is missing the extension {}",
                                            bstr::BStr::new(ResolvePath::join(
                                                &parts,
                                                bun_paths::Platform::AUTO
                                            )),
                                            bstr::BStr::new(ext)
                                        ));
                                    }
                                    esm_resolution.status = Status::ModuleNotFoundMissingExtension;
                                    let _ = ext;
                                    break;
                                }
                            }
                        }
                        return MatchStatus::NotFound;
                    }
                };

                // SAFETY: entries_mutex held; rfs points at the process-global RealFS.
                if unsafe { entry_query.entry().kind(self.rfs_ptr(), self.store_fd) }
                    == Fs::file_system::EntryKind::Dir
                {
                    let ends_with_star = esm_resolution.status == Status::ExactEndsWithStar;
                    esm_resolution.status = Status::UnsupportedDirectoryImport;

                    // Try to have a friendly error message if people forget the "/index.js" suffix
                    if ends_with_star {
                        if let Ok(Some(dir_info_ref)) = self.dir_info_cached(abs_esm_path) {
                            if let Some(dir_entries) = dir_info_ref.get_entries_ref(self.generation)
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
                                        // SAFETY: entries_mutex held; rfs points at the process-global RealFS.
                                        if unsafe { iq.entry().kind(self.rfs_ptr(), self.store_fd) }
                                            == Fs::file_system::EntryKind::File
                                        {
                                            if let Some(debug) = self.debug_logs.as_mut() {
                                                let mut ms =
                                                    Vec::with_capacity(1 + file_name.len());
                                                ms.push(b'/');
                                                ms.extend_from_slice(&file_name[..]);
                                                let parts =
                                                    [package_json.name.as_ref(), package_subpath];
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

                    return MatchStatus::NotFound;
                }

                let absolute_out_path: &[u8] = {
                    if entry_query.entry().abs_path.is_empty() {
                        // SAFETY: EntryStore-owned slot; resolver mutex held. RHS fully
                        // evaluated before LHS `&mut Entry` is materialized.
                        unsafe { &mut *entry_query.entry }.abs_path = Interned::from_static(
                            self.fs_ref()
                                .dirname_store
                                .append_slice(abs_esm_path)
                                .expect("unreachable"),
                        );
                    }
                    entry_query.entry().abs_path.as_bytes()
                };
                let module_type = if let Some(pkg) = resolved_dir_info.package_json() {
                    pkg.module_type
                } else {
                    options::ModuleType::Unknown
                };

                *out = MatchResult {
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
                            .map(std::ptr::from_ref)
                            .unwrap_or_else(|| std::ptr::from_ref(package_json)),
                    ),
                    module_type,
                    ..Default::default()
                };
                MatchStatus::Success
            }
            Status::Inexact => {
                // If this was resolved against an expansion key ending in a "/"
                // instead of a "*", we need to try CommonJS-style implicit
                // extension and/or directory detection.
                if self
                    .load_as_file_or_directory(abs_esm_path, kind, out)
                    .is_success()
                {
                    out.is_node_module = true;
                    out.package_json = out
                        .package_json
                        .or_else(|| Some(std::ptr::from_ref(package_json)));
                    return MatchStatus::Success;
                }
                esm_resolution.status = Status::ModuleNotFound;
                MatchStatus::NotFound
            }
            _ => unreachable!(),
        }
    }

    pub fn resolve_without_remapping(
        &mut self,
        // NOTE: `DirInfoRef` (not `&mut`) — forwards into `load_node_modules`
        // which re-enters `dir_cache` and may re-derive the same DirInfo slot.
        source_dir_info: DirInfoRef,
        import_path: &[u8],
        kind: ast::ImportKind,
        global_cache: GlobalCache,
        out: &mut MatchResult,
    ) -> MatchStatus {
        if is_package_path(import_path) {
            self.load_node_modules(import_path, kind, source_dir_info, global_cache, false, out)
        } else {
            let Some(resolved) = self.fs_ref().abs_buf_checked(
                &[source_dir_info.abs_path, import_path],
                bufs!(resolve_without_remapping),
            ) else {
                return MatchStatus::NotFound;
            };
            self.load_as_file_or_directory(resolved, kind, out)
        }
    }

    pub fn parse_tsconfig(
        &mut self,
        file: &[u8],
        dirname_fd: FD,
    ) -> crate::CrateResult<Option<Box<TSConfigJSON>>> {
        // Since tsconfig.json is cached permanently, in our DirEntries cache
        // we must use the global allocator
        let mut entry = self.caches.fs.read_file_with_allocator(
            // SAFETY: process-global `FileSystem` singleton (see `fs()` NOTE); narrow `&mut`
            // for this call only — `self.caches` is a field of `self` (disjoint allocation).
            unsafe { &mut *self.fs() },
            file,
            dirname_fd,
            false,
            None,
            None,
        )?;
        // NOTE: reshaped for borrowck — `mem::take` the contents (leaving
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
        // `Contents::Owned`/`Empty`. `TSConfigJSON` owns `Box<[u8]>` copies of
        // every field, so the source bytes are dead once `parse` returns and
        // can be dropped with the local `Source`.
        let contents = match entry_contents {
            crate::cache::Contents::Owned(v) => v,
            crate::cache::Contents::Empty => Vec::new(),
            other => other.as_slice().to_vec(),
        };

        let source = bun_ast::Source::init_path_string_owned(key_path, contents);
        let file_dir = source.path.source_dir();

        // SAFETY: BACKREF — `self.log` (see `log()` NOTE); disjoint from `self.caches`,
        // narrow `&mut` for this call only.
        let mut result =
            match TSConfigJSON::parse(unsafe { &mut *self.log() }, &source, &mut self.caches.json)?
            {
                Some(r) => r,
                None => return Ok(None),
            };

        if result.has_base_url() {
            // this might leak
            if !bun_paths::is_absolute(&result.base_url) {
                // NOTE: `base_url: Box<[u8]>` owns its bytes, so
                // copy `abs_buf`'s thread-local result directly instead of
                // double-copying through the `dirname_store` arena.
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

        // NOTE: return the `Box` so the caller (`dir_info_uncached`) takes
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
    ) -> crate::CrateResult<Option<core::ptr::NonNull<PackageJSON>>> {
        use crate::package_json::{IncludeDependencies, IncludeScripts};
        // NOTE: `IncludeDependencies` is a
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

        // NOTE: the DirInfo cache holds `&'static` refs. PORTING.md
        // §Forbidden bars `Box::leak`; intern into the process-lifetime arena
        // owned alongside the DirInfo singleton instead.
        Ok(Some(intern_package_json(pkg)))
    }

    fn dir_info_cached(&mut self, path: &[u8]) -> crate::CrateResult<Option<DirInfoRef>> {
        self.dir_info_cached_maybe_log(true, path)
    }

    pub fn read_dir_info(&mut self, path: &[u8]) -> crate::CrateResult<Option<DirInfoRef>> {
        self.dir_info_cached_maybe_log(false, path)
    }

    /// Like `readDirInfo`, but returns `null` instead of throwing an error.
    pub fn read_dir_info_ignore_error(&mut self, path: &[u8]) -> Option<DirInfoRef> {
        self.dir_info_cached_maybe_log(false, path).ok().flatten()
    }

    // NOTE: `follow_symlinks` is `true` at every call
    // site, so it's dropped here; `enable_logging` is a plain runtime parameter
    // (it gates one cold error-formatting branch) so this large dir-walk function
    // monomorphizes to a single copy instead of two faulted in at startup.
    fn dir_info_cached_maybe_log(
        &mut self,
        enable_logging: bool,
        raw_input_path: &[u8],
    ) -> crate::CrateResult<Option<DirInfoRef>> {
        // `self.mutex` is `&'static Mutex` (Copy) — bind it first so the guard
        // doesn't keep `self` borrowed across the body.
        let _unlock = self.mutex.lock_guard();
        DirInfo::sync_preserve_symlinks_mode(self.opts.preserve_symlinks);
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
                debug_assert!(input_path.as_ptr() == win32_normalized_dir_info_cache_buf.as_ptr());
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
                if strings::index_of_char(&input_path[2 + first_slash as usize..], b'\\').is_none()
                {
                    return Ok(None);
                }
            }
        }

        assert!(
            bun_paths::is_absolute(input_path),
            "cannot resolve DirInfo for non-absolute path: {}",
            bstr::BStr::new(input_path)
        );

        let path_without_trailing_slash = strings::without_trailing_slash_windows_path(input_path);
        Self::assert_valid_cache_key(path_without_trailing_slash);
        let top_result = self
            .dir_cache_mut()
            .get_or_put(path_without_trailing_slash)?;
        if top_result.status != allocators::ItemStatus::Unknown {
            return Ok(self
                .dir_cache_mut()
                .at_index(top_result.index)
                .map(DirInfoRef::from_slot));
        }

        self.dir_info_cached_miss(enable_logging, input_path, top_result)
    }

    /// Cold tail of [`dir_info_cached_maybe_log`]: the directory walk +
    /// `readdir` + `dir_info_uncached` fill that runs only on a cache miss.
    /// Split out so the hot cache-hit path above doesn't pay the ~8.6 KB stack
    /// frame (and the per-page stack-probe sequence) that the readdir
    /// temporaries below force on every call.
    #[cold]
    #[inline(never)]
    fn dir_info_cached_miss(
        &mut self,
        enable_logging: bool,
        input_path: &[u8],
        top_result: allocators::Result,
    ) -> crate::CrateResult<Option<DirInfoRef>> {
        let dir_info_uncached_path_buf = bufs!(dir_info_uncached_path);

        let mut i: usize = 1;
        let queue = bufs!(dir_entry_paths_to_resolve);
        let input_path_len = input_path.len();
        dir_info_uncached_path_buf[..input_path_len].copy_from_slice(input_path);
        // The slice spans one byte past the copied path so the NUL-splice/restore at
        // `input_path_len` (queue index 0, processed last in the open-dir loop below)
        // writes through `path`'s own provenance. `input_path_len + 1 ≤ MAX_PATH_BYTES + 1`
        // (checked above) and `PathBuffer` always carries the +1 sentinel slot, so the
        // safe slice is in-bounds and the threadlocal buffer outlives this fn.
        let path: &mut [u8] = &mut dir_info_uncached_path_buf[..input_path_len + 1];

        queue[0].write(DirEntryResolveQueueItem {
            result: top_result,
            unsafe_path: bun_ptr::RawSlice::new(&path[..input_path_len]),
            safe_path: bun_ptr::RawSlice::EMPTY,
            fd: FD::INVALID,
        });
        let mut top = Dirname::dirname(&path[..input_path_len]);

        let mut top_parent = allocators::Result {
            index: allocators::NOT_FOUND,
            hash: 0,
            status: allocators::ItemStatus::NotFound,
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

        // NOTE: hold RealFS as a raw `*mut` so the entries-mutex/close-dirs
        // scopeguards can capture it by Copy without keeping a `self.rfs_ptr()`
        // borrow live across the loop body (which calls `&mut self` methods).
        // SAFETY: ARENA — `self.fs` points at the process-global FileSystem singleton.
        // Derive provenance from the raw `*mut FileSystem` field directly so later
        // `unsafe { &mut *self.fs() }` calls (e.g. `dirname_store.append_*`) cannot pop `rfs`'s tag
        // under Stacked Borrows (PORTING.md §Forbidden: aliased-&mut).
        let rfs: *mut Fs::file_system::RealFS = self.rfs_ptr();
        macro_rules! rfs {
            () => {
                // SAFETY: `rfs` points at the process-global RealFS singleton; see note above.
                unsafe { &mut *rfs }
            };
        }

        // SAFETY: `rfs` points at process-global storage; outlives this guard.
        let _entries_unlock = rfs!().entries_mutex.lock_guard();

        while top.len() > root_path.len() {
            debug_assert!(top.as_ptr() == root_path.as_ptr());
            let result = self.dir_cache_mut().get_or_put(top)?;

            if result.status != allocators::ItemStatus::Unknown {
                top_parent = result;
                break;
            }
            // Path has more uncached components than our fixed queue can hold.
            // This only happens for user-controlled absolute import paths with
            // hundreds of short components — no real directory is this deep.
            if i >= queue.len() {
                return Ok(None);
            }
            queue[i].write(DirEntryResolveQueueItem {
                unsafe_path: bun_ptr::RawSlice::new(top),
                result,
                safe_path: bun_ptr::RawSlice::EMPTY,
                fd: FD::INVALID,
            });

            if let Some(top_entry) = rfs!().entries.get(top) {
                match top_entry {
                    Fs::file_system::real_fs::EntriesOption::Entries(entries) => {
                        // SAFETY: slot was written immediately above.
                        let slot = unsafe { queue[i].assume_init_mut() };
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
            if result.status != allocators::ItemStatus::Unknown {
                top_parent = result;
            } else {
                queue[i].write(DirEntryResolveQueueItem {
                    unsafe_path: bun_ptr::RawSlice::new(root_path),
                    result,
                    safe_path: bun_ptr::RawSlice::EMPTY,
                    fd: FD::INVALID,
                });
                if let Some(top_entry) = rfs!().entries.get(top) {
                    match top_entry {
                        Fs::file_system::real_fs::EntriesOption::Entries(entries) => {
                            // SAFETY: slot was written immediately above.
                            let slot = unsafe { queue[i].assume_init_mut() };
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

        let mut queue_slice_len = i;
        debug_assert!(queue_slice_len > 0);
        let open_dir_count = core::cell::Cell::new(0usize);

        // When this function halts, any item not processed means it's not found.
        // NOTE: capture only what the cleanup needs by-value (store_fd) / by-Cell
        // (open_dir_count) so the guard doesn't pin `&mut self` across the loop
        // body. `need_to_close_files()` is evaluated AT DROP TIME,
        // not snapshotted up-front — the loop body calls
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
            let mut queue_top = unsafe { queue[queue_slice_len - 1].assume_init_ref() }.clone();
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
                    let open_req: crate::CrateResult<FD> = {
                        bun_sys::open_dir_absolute_z(
                            sentinel,
                            bun_sys::OpenDirOptions {
                                no_follow: false,
                                iterate: true,
                            },
                        )
                    };
                    #[cfg(windows)]
                    let open_req: crate::CrateResult<FD> = {
                        bun_sys::open_dir_at_windows_a(
                            FD::INVALID,
                            sentinel.as_bytes(),
                            bun_sys::WindowsOpenDirOptions {
                                iterable: true,
                                no_follow: false,
                                ..Default::default()
                            },
                        )
                        .map_err(Into::into)
                    };

                    bun_core::scoped_log!(
                        crate::fs_full::Fs,
                        "open({})",
                        bstr::BStr::new(sentinel.as_bytes()),
                    );
                    // Restore the byte we NUL-terminated above.
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
                            if err == crate::Error::Sys(bun_errno::SystemErrno::ENOTDIR)
                                || err == crate::Error::Sys(bun_errno::SystemErrno::EISDIR)
                            {
                                return Ok(None);
                            }
                            // A permission-denied ancestor (sandboxed drive roots, x-only
                            // shared dirs) is treated as opaque and empty, like the
                            // ENOTDIR tolerance; the requested directory itself stays fatal.
                            if queue_slice_len > 0
                                && matches!(
                                    err,
                                    crate::Error::Sys(bun_errno::SystemErrno::EPERM)
                                        | crate::Error::Sys(bun_errno::SystemErrno::EACCES)
                                )
                            {
                                debuglog!(
                                    "treating permission-denied ancestor \"{}\" as empty: {}",
                                    bstr::BStr::new(queue_top_unsafe_path),
                                    bstr::BStr::new(err.name())
                                );
                                break 'open_dir FD::INVALID;
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
                            if err != crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
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

            // `open_dir` is INVALID for a permission-denied ancestor treated as
            // an opaque directory; there is nothing to track or close then.
            if !queue_top.fd.is_valid() && open_dir.is_valid() {
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
                    // logical input is `path[..input_path_len]`.
                    let input = &path[..input_path_len];
                    if input[input.len() - 1] != SEP {
                        let parts: [&[u8]; 2] = [input, SEP_STR.as_bytes()];
                        _safe_path = Some(self.fs_ref().dirname_store.append_parts(&parts)?);
                    } else {
                        _safe_path = Some(self.fs_ref().dirname_store.append_slice(input)?);
                    }
                }

                let safe_path = _safe_path.unwrap();

                // An empty needle must yield index 0, not None. On Windows
                // `queue_top_unsafe_path` is empty when
                // `windows_filesystem_root` cannot classify the input — e.g.
                // `import(":://x")` is "absolute" per std but has no drive root,
                // so `root_path` is `path[0..0]`. Treat that as 0 so the
                // resolver caches a not-found instead of panicking.
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

                // A permission-denied ancestor has no fd to enumerate; its
                // entry set stays empty.
                if open_dir.is_valid() {
                    let mut dir_iterator = bun_sys::iterate_dir(open_dir);
                    // NOTE: `WrappedIterator::next` returns
                    // `Result<Option<IteratorResult>>`, so use `?`-style break-on-error.
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
                }
                if let Some(existing) = in_place {
                    // SAFETY: see block-wide note above.
                    // NOTE: bun_collections::StringHashMap exposes `clear`, which drops all entries.
                    unsafe { &mut *existing }.data.clear();
                }
                new_entry.fd = if self.store_fd { open_dir } else { FD::INVALID };
                // NOTE: `DirEntry.data` is a `HashMap`
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
                // NOTE (Stacked Borrows): log BEFORE `entries.put` stores the
                // `&'static mut DirEntry` — a later read through the parent raw
                // pointer would pop that reference's Unique tag (the ordering
                // is unobservable).
                bun_core::scoped_log!(
                    crate::fs_full::Fs,
                    "readdir({}, {}) = {}",
                    open_dir,
                    bstr::BStr::new(dir_path),
                    // SAFETY: `dir_entries_ptr` is a live BSSMap slot (`in_place`) or a
                    // freshly boxed entry (see block-wide note above).
                    unsafe { (*dir_entries_ptr).data.count() },
                );
                dir_entries_option = rfs!().entries.put(
                    &mut cached_dir_entry_result,
                    Fs::file_system::real_fs::EntriesOption::Entries(
                        // SAFETY: `dir_entries_ptr` is a live BSSMap slot (`in_place`) or a freshly boxed entry.
                        unsafe { &mut *dir_entries_ptr },
                    ),
                )?;
            }

            // We must initialize it as empty so that the result index is correct.
            // This is important so that browser_scope has a valid index.
            // SAFETY: `dir_cache()` is the live singleton; resolver mutex held.
            // Both slot pointers are rooted at the singleton, so the map
            // reborrows inside `dir_info_uncached` cannot pop them.
            let dir_info_ptr: *mut DirInfo::DirInfo = unsafe {
                DirInfo::put_slot(
                    self.dir_cache(),
                    &mut queue_top.result,
                    DirInfo::DirInfo::default(),
                )
            }?;
            // SAFETY: `top_parent.index` is a sentinel or a slot assigned by
            // `put`; resolver mutex held.
            let parent_dir_ptr = unsafe { DirInfo::slot_ptr_at(top_parent.index) }
                .map(|p| unsafe { DirInfoRef::from_raw(p) });

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
                // (Unimplemented fast path: if this directory's entries already
                // contain the next queue entry's basename, the "directory" being
                // searched for is actually a file and resolution could bail early.)
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
        out: &mut MatchResult,
    ) -> MatchStatus {
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
            // NOTE: ArrayHashMap has no `&self` (key,value) iterator; zip the
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

                        if self
                            .load_as_file_or_directory(absolute_original_path, kind, out)
                            .is_success()
                        {
                            return MatchStatus::Success;
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
                if path.len() >= prefix.len() + suffix.len()
                    && path.starts_with(prefix)
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

                if self
                    .load_as_file_or_directory(absolute_original_path, kind, out)
                    .is_success()
                {
                    return MatchStatus::Success;
                }
            }
        }

        MatchStatus::NotFound
    }

    pub fn load_package_imports(
        &mut self,
        import_path: &[u8],
        // NOTE: `DirInfoRef` (not `&mut`) — `handle_esm_resolution` re-enters
        // `dir_cache` via `dir_info_cached(dirname(abs_esm_path))`; for any
        // imports-map entry resolving to `./<file>` that dirname equals
        // `dir_info.abs_path`, re-deriving `&mut` to the SAME slot while a
        // `&mut` param's FnEntry protector is live is aliased-&mut UB.
        dir_info: DirInfoRef,
        kind: ast::ImportKind,
        global_cache: GlobalCache,
        out: &mut MatchResult,
    ) -> MatchStatus {
        let package_json = dir_info.package_json().unwrap();
        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!(
                "Looking for {} in \"imports\" map in {}",
                bstr::BStr::new(import_path),
                bstr::BStr::new(package_json.source.path.text)
            ));
            debug.increase_indent();
            // No matching `decreaseIndent()` — the indent is intentionally leaked here.
        }
        let imports_map = package_json.imports.as_ref().unwrap();

        if import_path.len() == 1 || import_path.starts_with(b"#/") {
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "The path \"{}\" must not equal \"#\" and must not start with \"#/\"",
                    bstr::BStr::new(import_path)
                ));
            }
            return MatchStatus::NotFound;
        }
        let mut module_type = options::ModuleType::Unknown;

        // NOTE: keeping the `ESModule`'s borrow of `self.debug_logs` alive
        // across the subsequent `&mut self` calls would be aliased-&mut UB, so
        // the `ESModule` is constructed as a temporary whose
        // borrow of `self.debug_logs` ends as soon as `resolve_imports` returns.
        let esm_resolution = ESModule {
            conditions: match kind {
                ast::ImportKind::Require | ast::ImportKind::RequireResolve => {
                    &self.opts.conditions.require
                }
                _ => &self.opts.conditions.import,
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
                    *out = MatchResult {
                        path_pair: PathPair {
                            primary: Fs::Path::init(alias.path.as_bytes()),
                            secondary: None,
                        },
                        is_external: true,
                        ..Default::default()
                    };
                    return MatchStatus::Success;
                }
            }

            return self.load_node_modules(
                &esm_resolution.path,
                kind,
                dir_info,
                global_cache,
                true,
                out,
            );
        }

        self.handle_esm_resolution(
            esm_resolution,
            package_json.source.path.name().dir,
            kind,
            package_json,
            b"",
            out,
        )
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
                    abs_to_rel[2..2 + checker.input_path.len()].copy_from_slice(checker.input_path);
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
        // NOTE: `DirInfoRef` (not `&mut`) — `get_enclosing_browser_scope()`
        // may return `dir_info` itself (self-browser-scope),
        // which would alias a live `&mut`.
        dir_info: DirInfoRef,
        _field_rel_path: &[u8],
        field: &[u8],
        extension_order: options::ExtOrder,
        out: &mut MatchResult,
    ) -> MatchStatus {
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
                            let new_path = self.fs_ref().abs_alloc(&paths).expect("unreachable");
                            let mut _path = Path::init(new_path);
                            _path.is_disabled = true;
                            *out = MatchResult {
                                path_pair: PathPair {
                                    primary: _path,
                                    secondary: None,
                                },
                                package_json: Some(std::ptr::from_ref(browser_json)),
                                ..Default::default()
                            };
                            dec_ret!(MatchStatus::Success);
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
                *out = MatchResult {
                    path_pair: PathPair {
                        primary: Fs::Path::init(result.path),
                        secondary: None,
                    },
                    package_json: Some(std::ptr::from_ref(package_json)),
                    dirname_fd: result.dirname_fd,
                    ..Default::default()
                };
                dec_ret!(MatchStatus::Success);
            }

            *out = MatchResult {
                path_pair: PathPair {
                    primary: Fs::Path::init(result.path),
                    secondary: None,
                },
                dirname_fd: result.dirname_fd,
                diff_case: result.diff_case,
                ..Default::default()
            };
            dec_ret!(MatchStatus::Success);
        }

        // Is it a directory with an index?
        let Some(field_dir_info) = self.dir_info_cached(field_abs_path).ok().flatten() else {
            dec_ret!(MatchStatus::NotFound);
        };

        let r = self.load_as_index_with_browser_remapping(
            field_dir_info,
            field_abs_path,
            extension_order,
            out,
        );
        if let Some(d) = self.debug_logs.as_mut() {
            d.decrease_indent();
        }
        r
    }

    // nodeModulePathsForJS / Resolver__propForRequireMainPaths: see src/jsc/resolver_jsc.rs
    // (exported to C++ only)

    // NOTE: `dir_info` is a `DirInfoRef` (matching spec `*DirInfo`) so
    // `load_index_with_extension` may re-borrow without aliasing the caller's `&mut`.
    pub fn load_as_index(
        &mut self,
        dir_info: DirInfoRef,
        extension_order: options::ExtOrder,
        out: &mut MatchResult,
    ) -> MatchStatus {
        // Try the "index" file with extensions
        // NOTE: index by `0..len` so each iteration takes a fresh short
        // borrow of `self.opts` that ends before `&mut self` is taken by
        // `load_index_with_extension` (matches `extra_cjs_extensions` loop below).
        let n = self.opts.ext_order_slice(extension_order).len();
        for i in 0..n {
            // BACKREF: `RawSlice` detaches the `&self.opts` borrow so the loop
            // body can take `&mut self`. Backing `Box<[u8]>` is owned by
            // `self.opts` and never mutated while the resolver runs.
            let ext = bun_ptr::RawSlice::new(&*self.opts.ext_order_slice(extension_order)[i]);
            if self
                .load_index_with_extension(dir_info, &ext, out)
                .is_success()
            {
                return MatchStatus::Success;
            }
        }
        // NOTE: index by `0..len` so each iteration takes a fresh short
        // borrow of `self.opts` that ends before `&mut self` is taken by
        // `load_index_with_extension` (avoids the forbidden lifetime-extension cast).
        let n = self.opts.extra_cjs_extensions.len();
        for i in 0..n {
            // BACKREF: see `RawSlice` note above — backing `Box<[u8]>` in
            // `extra_cjs_extensions` is heap-stable for the resolver's life.
            let ext = bun_ptr::RawSlice::new(&*self.opts.extra_cjs_extensions[i]);
            if self
                .load_index_with_extension(dir_info, &ext, out)
                .is_success()
            {
                return MatchStatus::Success;
            }
        }

        MatchStatus::NotFound
    }

    fn load_index_with_extension(
        &mut self,
        dir_info: DirInfoRef,
        ext: &[u8],
        out: &mut MatchResult,
    ) -> MatchStatus {
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
                // SAFETY: entries_mutex held; rfs points at the process-global RealFS.
                if unsafe { lookup.entry().kind(rfs, self.store_fd) }
                    == Fs::file_system::EntryKind::File
                {
                    let out_buf: &[u8] = {
                        if lookup.entry().abs_path.is_empty() {
                            let parts = [dir_info.abs_path, &base[..]];
                            let out_buf_ = self.fs_ref().abs_buf(&parts, bufs!(index));
                            // SAFETY: EntryStore-owned slot; resolver mutex held. RHS fully
                            // evaluated before LHS `&mut Entry` is materialized.
                            unsafe { &mut *lookup.entry }.abs_path = Interned::from_static(
                                self.fs_ref()
                                    .dirname_store
                                    .append_slice(out_buf_)
                                    .expect("unreachable"),
                            );
                        }
                        lookup.entry().abs_path.as_bytes()
                    };

                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!(
                            "Found file: \"{}\"",
                            bstr::BStr::new(out_buf)
                        ));
                    }

                    if let Some(package_json) = dir_info.package_json() {
                        *out = MatchResult {
                            path_pair: PathPair {
                                primary: Path::init(out_buf),
                                secondary: None,
                            },
                            diff_case: lookup.diff_case,
                            package_json: Some(std::ptr::from_ref(package_json)),
                            dirname_fd: dir_info.get_file_descriptor(),
                            ..Default::default()
                        };
                        return MatchStatus::Success;
                    }

                    *out = MatchResult {
                        path_pair: PathPair {
                            primary: Path::init(out_buf),
                            secondary: None,
                        },
                        diff_case: lookup.diff_case,
                        dirname_fd: dir_info.get_file_descriptor(),
                        ..Default::default()
                    };
                    return MatchStatus::Success;
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

        MatchStatus::NotFound
    }

    pub fn load_as_index_with_browser_remapping(
        &mut self,
        // NOTE: `DirInfoRef` (not `&mut`) — `get_enclosing_browser_scope()`
        // may return `dir_info` itself (self-browser-scope),
        // which would alias a live `&mut`.
        dir_info: DirInfoRef,
        path_: &[u8],
        extension_order: options::ExtOrder,
        out: &mut MatchResult,
    ) -> MatchStatus {
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
                            *out = MatchResult {
                                path_pair: PathPair {
                                    primary: _path,
                                    secondary: None,
                                },
                                package_json: Some(std::ptr::from_ref(browser_json)),
                                ..Default::default()
                            };
                            return MatchStatus::Success;
                        }

                        let new_paths = [path, remap];
                        let remapped_abs = self.fs_ref().abs_buf(&new_paths, bufs!(remap_path));

                        // Is this a file
                        if let Some(file_result) = self.load_as_file(remapped_abs, extension_order)
                        {
                            *out = MatchResult {
                                dirname_fd: file_result.dirname_fd,
                                path_pair: PathPair {
                                    primary: Path::init(file_result.path),
                                    secondary: None,
                                },
                                diff_case: file_result.diff_case,
                                ..Default::default()
                            };
                            return MatchStatus::Success;
                        }

                        // Is it a directory with an index?
                        if let Ok(Some(new_dir)) = self.dir_info_cached(remapped_abs) {
                            if self
                                .load_as_index(new_dir, extension_order, out)
                                .is_success()
                            {
                                return MatchStatus::Success;
                            }
                        }

                        return MatchStatus::NotFound;
                    }
                }
            }
        }

        self.load_as_index(dir_info, extension_order, out)
    }

    pub fn load_as_file_or_directory(
        &mut self,
        path: &[u8],
        kind: ast::ImportKind,
        out: &mut MatchResult,
    ) -> MatchStatus {
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
                        &file.path[0..node_modules_folder_offset + package_name_length as usize],
                    ) {
                        if let Some(package_json) = package_dir_info.package_json() {
                            *out = MatchResult {
                                path_pair: PathPair {
                                    primary: Path::init(file.path),
                                    secondary: None,
                                },
                                diff_case: file.diff_case,
                                dirname_fd: file.dirname_fd,
                                package_json: Some(std::ptr::from_ref(package_json)),
                                file_fd: file.file_fd,
                                ..Default::default()
                            };
                            return MatchStatus::Success;
                        }
                    }
                }
            }

            debug_assert!(bun_paths::is_absolute(file.path));

            *out = MatchResult {
                path_pair: PathPair {
                    primary: Path::init(file.path),
                    secondary: None,
                },
                diff_case: file.diff_case,
                dirname_fd: file.dirname_fd,
                file_fd: file.file_fd,
                ..Default::default()
            };
            return MatchStatus::Success;
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

        // NOTE: `DirInfoRef` (not `&mut`).
        // The callees fetch `get_enclosing_browser_scope()` which can resolve
        // back to this same BSSMap slot — holding a `&mut` here would alias.
        let dir_info: DirInfoRef = match self.dir_info_cached(path) {
            Ok(Some(d)) => d,
            Ok(None) => dec_ret!(MatchStatus::NotFound),
            Err(_err) => {
                #[cfg(debug_assertions)]
                bun_core::pretty_errorln!(
                    "err: {} reading {}",
                    bstr::BStr::new(_err.name()),
                    bstr::BStr::new(path)
                );
                dec_ret!(MatchStatus::NotFound);
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
                let main_field_keys = bun_ptr::RawSlice::<Box<[u8]>>::new(&self.opts.main_fields);
                let mf_ext_order = options::ExtOrder::MainField;
                // The bundler projects "user did not pass --main-fields" as an
                // explicit bool because the owned `Box<[Box<[u8]>]>` can never
                // alias a static default to compare pointers against.
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

                    if !self
                        .load_from_main_field(
                            path,
                            dir_info,
                            field_rel_path,
                            key,
                            if key == b"main" {
                                mf_ext_order
                            } else {
                                extension_order
                            },
                            out,
                        )
                        .is_success()
                    {
                        continue;
                    }

                    // If the user did not manually configure a "main" field order, then
                    // use a special per-module automatic algorithm to decide whether to
                    // use "module" or "main" based on whether the package is imported
                    // using "import" or "require".
                    if auto_main && key == b"module" {
                        let mut auto_main_result = MatchResult::default();
                        let mut auto_main_found = false;

                        if let Some(main_rel_path) = main_field_values.get(b"main".as_slice()) {
                            if !main_rel_path.is_empty() {
                                auto_main_found = self
                                    .load_from_main_field(
                                        path,
                                        dir_info,
                                        main_rel_path,
                                        b"main",
                                        mf_ext_order,
                                        &mut auto_main_result,
                                    )
                                    .is_success();
                            }
                        } else {
                            // Some packages have a "module" field without a "main" field but
                            // still have an implicit "index.js" file. In that case, treat that
                            // as the value for "main".
                            auto_main_found = self
                                .load_as_index_with_browser_remapping(
                                    dir_info,
                                    path,
                                    mf_ext_order,
                                    &mut auto_main_result,
                                )
                                .is_success();
                        }

                        if auto_main_found {
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
                                        bstr::BStr::new(auto_main_result.path_pair.primary.text())
                                    ));
                                }

                                let primary =
                                    core::mem::replace(&mut out.path_pair.primary, Path::empty());
                                *out = MatchResult {
                                    path_pair: PathPair {
                                        primary,
                                        secondary: Some(auto_main_result.path_pair.primary),
                                    },
                                    diff_case: out.diff_case,
                                    dirname_fd: out.dirname_fd,
                                    package_json,
                                    file_fd: auto_main_result.file_fd,
                                    ..Default::default()
                                };
                                dec_ret!(MatchStatus::Success);
                            } else {
                                if let Some(debug) = self.debug_logs.as_mut() {
                                    debug.add_note_fmt(format_args!(
                                        "Resolved to \"{}\" using the \"{}\" field in \"{}\"",
                                        bstr::BStr::new(auto_main_result.path_pair.primary.text()),
                                        bstr::BStr::new(key),
                                        bstr::BStr::new(pkg_json.source.path.text)
                                    ));
                                }
                                auto_main_result.package_json = package_json;
                                *out = auto_main_result;
                                dec_ret!(MatchStatus::Success);
                            }
                        }
                    }

                    out.package_json = out.package_json.or(package_json);
                    dec_ret!(MatchStatus::Success);
                }
            }
        }

        // Look for an "index" file with known extensions
        if self
            .load_as_index_with_browser_remapping(dir_info, path, extension_order, out)
            .is_success()
        {
            out.package_json = out.package_json.or(package_json);
            dec_ret!(MatchStatus::Success);
        }

        dec_ret!(MatchStatus::NotFound);
    }

    pub fn load_as_file(
        &mut self,
        path: &[u8],
        extension_order: options::ExtOrder,
    ) -> Option<LoadResult> {
        // SAFETY: RealFS is the global singleton. Derive provenance from the raw
        // `*mut FileSystem` field so intervening `unsafe { &mut *self.fs() }` calls in
        // `load_extension` / `dirname_store.append_slice` don't invalidate `rfs`
        // under Stacked Borrows. We re-borrow `&mut *rfs` at each use site.
        let rfs: *mut Fs::file_system::RealFS = self.rfs_ptr();

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
        // SAFETY: `rfs` points at the process-global RealFS singleton (see note at fn top).
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
                crate::Error::Sys(bun_errno::SystemErrno::ENOENT)
                | crate::Error::Sys(bun_errno::SystemErrno::ENOTDIR) => {}
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
            // SAFETY: entries_mutex held; rfs points at the process-global RealFS.
            if unsafe { query.entry().kind(rfs, self.store_fd) } == Fs::file_system::EntryKind::File
            {
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!("Found file \"{}\" ", bstr::BStr::new(base)));
                }

                let abs_path: &'static [u8] = {
                    if query.entry().abs_path.is_empty() {
                        let abs_path_parts = [query.entry().dir, query.entry().base()];
                        let joined = self.fs_ref().abs_buf(&abs_path_parts, bufs!(load_as_file));
                        // SAFETY: EntryStore-owned slot; resolver mutex held. RHS fully
                        // evaluated before LHS `&mut Entry` is materialized.
                        unsafe { &mut *query.entry }.abs_path = Interned::from_static(
                            self.fs_ref()
                                .dirname_store
                                .append_slice(joined)
                                .expect("unreachable"),
                        );
                    }
                    query.entry().abs_path.as_bytes()
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
        // NOTE: index by `0..len` so each iteration takes a fresh short
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

        // NOTE: index by `0..len` so each iteration takes a fresh short
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
            // NOTE: the node_modules gate only applies to the `.mjs` arm.
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
                        // SAFETY: entries_mutex held; rfs points at the process-global RealFS.
                        if unsafe { query.entry().kind(rfs, self.store_fd) }
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
                                            Interned::from_static(
                                                self.fs_ref()
                                                    .filename_store
                                                    .append_parts(&parts)
                                                    .expect("unreachable"),
                                            )
                                            // the trailing path CAN be missing here
                                        } else {
                                            let parts: [&[u8]; 3] =
                                                [entry_dir, SEP_STR.as_bytes(), &buffer[..]];
                                            Interned::from_static(
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
                                    query.entry().abs_path.as_bytes()
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
            // SAFETY: entries_mutex held; rfs points at the process-global RealFS.
            if unsafe { query.entry().kind(rfs, self.store_fd) } == Fs::file_system::EntryKind::File
            {
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
                        unsafe { &mut *query.entry }.abs_path = if query.entry().abs_path.is_empty()
                        {
                            Interned::from_static(
                                self.fs_ref()
                                    .dirname_store
                                    .append_slice(&buffer[..])
                                    .expect("unreachable"),
                            )
                        } else {
                            query.entry().abs_path
                        };
                        query.entry().abs_path.as_bytes()
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
    ) -> crate::CrateResult<()> {
        let result = _result;

        // SAFETY: RealFS is the process-global ARENA singleton. `Entry::kind` /
        // `Entry::symlink` take it by raw pointer and reborrow only internally,
        // so the interleaved `&mut self` calls below cannot invalidate `rfs_ptr`
        // under Stacked Borrows.
        let rfs_ptr: *mut Fs::file_system::RealFS = self.rfs_ptr();
        // SAFETY: `_entries` is a live slot (caller contract); the payload
        // `DirEntry` is a separate process-lifetime allocation, so the shared
        // `BackRef` survives entries-map traffic. All uses below are `&self`
        // reads under `entries_mutex`.
        let dir_entries = bun_ptr::BackRef::new(unsafe { &*_entries }.entries());
        macro_rules! entries {
            () => {
                dir_entries.get()
            };
        }

        if cfg!(debug_assertions) {
            // `path` is stored in the permanent `dir_cache` as `DirInfo.abs_path`. It must not
            // point into a reused threadlocal scratch buffer, or a later resolution will
            // corrupt cached entries. Callers must intern it (e.g. via `DirnameStore`) first.
            assert!(
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
                    // SAFETY: entries_mutex held; `rfs_ptr` points at the process-global RealFS.
                    unsafe { entry.entry().kind(rfs_ptr, self.store_fd) }
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
                            BIN_FOLDERS_LOADED.store(true, core::sync::atomic::Ordering::Release);
                        }

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
                        // SAFETY: entries_mutex held; `rfs_ptr` points at the process-global RealFS.
                        if unsafe { q.entry().kind(rfs_ptr, self.store_fd) }
                            == Fs::file_system::EntryKind::Dir
                        {
                            // SAFETY: BIN_FOLDERS_LOADED is single-thread init-once; protected by RESOLVER_MUTEX held by callers.
                            if !BIN_FOLDERS_LOADED.load(core::sync::atomic::Ordering::Acquire) {
                                // SAFETY: callers hold RESOLVER_MUTEX; first init.
                                unsafe { (*BIN_FOLDERS.get()).write(BinFolderArray::default()) };
                                BIN_FOLDERS_LOADED
                                    .store(true, core::sync::atomic::Ordering::Release);
                            }

                            let Ok(file) = bun_sys::open_dir_z(fd, b".bin\0", Default::default())
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

                                let Ok(stored) = self.fs_ref().dirname_store.append_slice(bin_path)
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
                    || parent_package_json.package_manager_package_id != Install::INVALID_PACKAGE_ID
                {
                    // NOTE: store the raw `NonNull` field (not the
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
                // The only caller that reaches this with `parent` set
                // (`dir_info_cached_miss`) already holds `entries_mutex`, and that
                // mutex is non-recursive, so go through the `_locked` accessor.
                if let Some(parent_entries) = parent_.get_entries_ref_locked(self.generation) {
                    if let Some(lookup) = parent_entries.get(base) {
                        let entries_fd = entries!().fd;
                        if entries_fd.is_valid()
                            && !lookup.entry().cache().fd.is_valid()
                            && self.store_fd
                        {
                            // Every cached-`Entry` rewrite takes the per-entry mutex.
                            let _entry_guard = lookup.entry().mutex.lock_guard();
                            lookup.entry().set_cache_fd(entries_fd);
                        }
                        // SAFETY: EntryStore-owned slot — read-only borrow,
                        // dies (NLL) before any later `&mut` to this slot.
                        let entry = lookup.entry();

                        // SAFETY: `rfs_ptr` points at the process-global RealFS; the lazy-stat
                        // rewrite inside `symlink()` is serialized on `Entry.mutex`.
                        let mut symlink = unsafe { entry.symlink(rfs_ptr, self.store_fd) };
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
                            // NOTE: split into two statements so the two `&mut FileSystem`
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
                            {
                                // Every cached-`Entry` rewrite takes the per-entry mutex.
                                let _entry_guard = lookup.entry().mutex.lock_guard();
                                lookup
                                    .entry()
                                    .set_cache_symlink(Interned::from_static(symlink));
                            }
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
                // SAFETY: entries_mutex held; `rfs_ptr` points at the process-global RealFS.
                if unsafe { entry.kind(rfs_ptr, self.store_fd) } == Fs::file_system::EntryKind::File
                {
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
                            // NOTE: store the raw `NonNull` field (not the
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
                    // SAFETY: entries_mutex held; `rfs_ptr` points at the process-global RealFS.
                    if unsafe { entry.kind(rfs_ptr, self.store_fd) }
                        == Fs::file_system::EntryKind::File
                    {
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
                        // SAFETY: entries_mutex held; `rfs_ptr` points at the process-global RealFS.
                        if unsafe { entry.kind(rfs_ptr, self.store_fd) }
                            == Fs::file_system::EntryKind::File
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
                // NOTE: re-borrow as 'static so the `&self.opts` borrow ends before
                // `self.parse_tsconfig(&mut self, ...)`. `tsconfig_override` is owned by
                // BundleOptions (lives for the resolver's lifetime).
                // SAFETY: `tsconfig_override` is owned by `self.opts` (resolver-lifetime);
                // the `'static` erase only ends the `&self` borrow for the `&mut self` call below.
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
                        if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                            let _ = self.log_mut().add_error_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "Cannot find tsconfig file {}",
                                    bun_core::fmt::quote(pretty)
                                ),
                            );
                        } else if err != crate::Error::ParseErrorAlreadyLogged
                            && err != crate::Error::Sys(bun_errno::SystemErrno::EISDIR)
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
                // NOTE: assigning info.tsconfig_json here and then freeing that
                // allocation in the merge loop below before reassigning would
                // leave a briefly-dangling reference
                // (Option<&'static TSConfigJSON>, dir_info.rs) — UB.
                // Defer the assignment to after the merge —
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

                    let merged_config = parent_configs.pop().unwrap();
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
                            // The previous merged_config.paths is being replaced;
                            // dropping the map frees the values automatically, so the
                            // PathsMap from the deeper config doesn't leak.
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
                        TSConfigJSON::destroy(unsafe { bun_core::heap::take(parent_config_ptr) });
                    }
                    // `merged_config` is a leaked Box (heap::alloc) interned into DirInfo; outlives the resolver.
                    info.tsconfig_json = Some(
                        core::ptr::NonNull::new(merged_config).expect("heap::alloc is non-null"),
                    );
                }
                info.enclosing_tsconfig_json = info.tsconfig_json();
            }
        }

        Ok(())
    }
}

impl<'a> Resolver<'a> {
    /// NOTE: NOT `impl Drop` — the bundler builds a `Resolver` per worker
    /// thread (see `for_worker`), and all instances share the same `dir_cache`
    /// singleton. A `Drop` impl would fire once per worker going out of scope,
    /// resetting the SHARED cache (freeing PackageJSON/TSConfigJSON, closing cached
    /// fds) while other live Resolvers still hold pointers into it. Call
    /// `deinit` explicitly exactly once at shutdown.
    pub fn deinit(&mut self) {
        // Caller is the sole remaining owner at shutdown; no other Resolver alias is live.
        for di in self.dir_cache_mut().values_mut() {
            // `DirInfo::reset` releases owned PackageJSON / TSConfigJSON resources
            // in-place (side effects beyond memory: those Drops close cached fds /
            // deref intrusive refcounts).
            di.reset();
        }
        // dir_cache is &'static — do not deinit the singleton here. `dir_cache`
        // is the process-global
        // BSSMap singleton (`DirInfo.HashMap` / `hash_map_instance()`); the
        // entries' owned resources are released by the `reset()` loop above and
        // the map storage itself lives for the process.
    }
}

// ─── nested helper types ───────────────────────────────────────────────────

enum DependencyToResolve {
    NotFound,
    Pending(Box<PendingResolution>),
    Failure(crate::Error),
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
    /// On a match only `self.remapped` is updated; the matched candidate may
    /// borrow threadlocal scratch buffers and must never be stored back into
    /// the checker.
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

bun_core::comptime_string_map! {
    static MODULE_TYPE_FROM_EXT: options::ModuleType = {
        b".mjs" => options::ModuleType::Esm,
        b".mts" => options::ModuleType::Esm,
        b".cjs" => options::ModuleType::Cjs,
        b".cts" => options::ModuleType::Cjs,
    };
}

#[inline]
fn module_type_from_ext(ext: &[u8]) -> Option<options::ModuleType> {
    MODULE_TYPE_FROM_EXT.get(ext).copied()
}

const NODE_MODULE_ROOT_STRING: &[u8] =
    const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes();

pub struct Dirname;

impl Dirname {
    /// Resolver-specific upward-traversal dirname:
    /// returns trailing-sep-INCLUSIVE slice, never `None`,
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
