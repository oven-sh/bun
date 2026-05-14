#![allow(dead_code)]

use core::marker::PhantomData;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_collections::{StringHashMap, StringSet};
use bun_core::ZStr;
use bun_core::{self as core_, Output};
use bun_paths::strings;
use bun_paths::{self, PathBuffer, SEP};
use bun_resolver::fs::{self as Fs, FileSystem, PathName};
use bun_sys::{self, Fd};
use bun_watcher::WatchItemColumns as _;
use bun_watcher::{ChangedFilePath, Op as WatchOp, Watcher};

use crate::Task as JscTask;
use crate::event_loop::{ConcurrentTaskItem as ConcurrentTask, EventLoop};
use crate::virtual_machine::VirtualMachine;
use bun_event_loop::task_tag;

bun_core::declare_scope!(hot_reloader, visible);

use bun_core::env::IS_KQUEUE;

pub enum ImportWatcher {
    None,
    Hot(Box<Watcher>),
    Watch(Box<Watcher>),
}

impl ImportWatcher {
    pub fn start(&mut self) -> Result<(), bun_core::Error> {
        match self {
            ImportWatcher::Hot(w) => w.start(),
            ImportWatcher::Watch(w) => w.start(),
            ImportWatcher::None => Ok(()),
        }
    }

    #[inline]
    pub fn watchlist(&self) -> Option<&bun_watcher::WatchList> {
        match self {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => Some(&w.watchlist),
            ImportWatcher::None => None,
        }
    }

    #[inline]
    pub fn index_of(&self, hash: bun_watcher::HashType) -> Option<u32> {
        match self {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => w.index_of(hash),
            ImportWatcher::None => None,
        }
    }

    /// Look up the cached fd (and `package_json` column) for `hash` under the
    /// watcher's mutex, snapshotting both before returning.
    ///
    /// The watcher thread's `flush_evictions` (called from `on_file_update`)
    /// closes the cached fd in pass 1 and `swap_remove`s the entry in pass 2.
    /// `on_file_update` orders `flush_evictions` *before* `enqueue` so the JS
    /// thread cannot observe the closed-fd window for the *same* event, but
    /// nothing serializes a *subsequent* event's `flush_evictions` against the
    /// JS thread's previous-event reload that re-added the entry: the JS
    /// thread can read the cached fd here while the watcher thread is between
    /// pass 1 (close) and pass 2 (remove), surfacing as `EBADF reading
    /// "<path>"` in `transpiler.rs:read_file_with_allocator` (hot.test.ts
    /// "should work with sourcemap generation" on debian-aarch64). Zig has
    /// the same race (`ModuleLoader.zig:173-174` reads unlocked); the port
    /// closes it by locking the same mutex `append_file_maybe_lock<true>` and
    /// `flush_evictions` take.
    pub fn snapshot_fd_and_package_json(
        &self,
        hash: bun_watcher::HashType,
    ) -> (
        Option<bun_sys::Fd>,
        Option<&'static bun_watcher::PackageJSON>,
    ) {
        let w = match self {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => w,
            ImportWatcher::None => return (None, None),
        };
        let _guard = w.mutex.lock_guard();
        let Some(index) = w.index_of(hash) else {
            return (None, None);
        };
        let watcher_fd = w.watchlist.items_fd()[index as usize];
        let package_json = w
            .watchlist
            .items::<"package_json", Option<&'static bun_watcher::PackageJSON>>()[index as usize];
        (
            if watcher_fd.is_valid() {
                Some(watcher_fd)
            } else {
                None
            },
            package_json,
        )
    }

    #[inline]
    pub fn add_file_by_path_slow(&mut self, file_path: &[u8], loader: bun_ast::Loader) -> bool {
        // PORT NOTE: bun_watcher::Loader is an opaque newtype over u8;
        // wrap the bun_ast::Loader discriminant.
        match self {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => {
                w.add_file_by_path_slow(file_path, bun_watcher::Loader(loader as u8))
            }
            ImportWatcher::None => true,
        }
    }

    #[inline]
    pub fn add_file<const COPY_FILE_PATH: bool>(
        &mut self,
        fd: Fd,
        file_path: &[u8],
        hash: bun_watcher::HashType,
        loader: bun_ast::Loader,
        dir_fd: Fd,
        // PORT NOTE: bun_watcher::PackageJSON is an opaque forward-decl;
        // callers cast from `&bun_resolver::PackageJSON`.
        package_json: Option<&'static bun_watcher::PackageJSON>,
    ) -> bun_sys::Result<()> {
        match self {
            ImportWatcher::Hot(watcher) | ImportWatcher::Watch(watcher) => watcher
                .add_file::<COPY_FILE_PATH>(
                    fd,
                    file_path,
                    hash,
                    bun_watcher::Loader(loader as u8),
                    dir_fd,
                    package_json,
                ),
            ImportWatcher::None => Ok(()),
        }
    }
}

pub type HotReloader = NewHotReloader<VirtualMachine, EventLoop, false>;
pub type WatchReloader = NewHotReloader<VirtualMachine, EventLoop, true>;

impl HotReloaderCtx for VirtualMachine {
    type EventLoop = EventLoop;

    fn event_loop(&self) -> *mut EventLoop {
        VirtualMachine::event_loop(self)
    }

    fn event_loop_ref(&self) -> &EventLoop {
        VirtualMachine::event_loop_shared(self)
    }

    fn bun_watcher_mut(&mut self) -> &mut Watcher {
        // PORT NOTE: Zig's three-way `@TypeOf(this.ctx.bun_watcher)` reflection
        // collapses here — `VirtualMachine.bun_watcher` is the type-erased
        // `*mut ImportWatcher` (TODO(b2-cycle) field comment in
        // VirtualMachine.rs), and `getContext` only runs after
        // `enable_hot_module_reloading` has populated it, so the `.None` arm
        // is unreachable.
        // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set by
        // `enable_hot_module_reloading`; non-null whenever the reloader is
        // running. The cast recovers the concrete type the field was erased to.
        let import_watcher = unsafe { &mut *self.bun_watcher.cast::<ImportWatcher>() };
        match import_watcher {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => &mut **w,
            ImportWatcher::None => unreachable!("bun_watcher_mut on un-enabled reloader"),
        }
    }

    fn reload(&mut self, _task: &mut dyn HotReloadTaskView) {
        // The inherent `reload` ignores its task argument (spec
        // VirtualMachine.zig:769 takes `_: ?*HotReloader.HotReloadTask`), so
        // pass `None` rather than threading the dyn view through.
        VirtualMachine::reload(self, None);
    }

    fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        VirtualMachine::bust_dir_cache(self, path)
    }

    fn get_loaders(&self) -> &bun_ast::LoaderHashTable {
        &self.transpiler.options.loaders
    }

    fn log_level_at_least_info(&self) -> bool {
        // Zig: `if (@hasField(Ctx, "log")) this.log.level.atLeast(.info)`.
        // Note `Level.atLeast` is `self <= other` (Verbose=0..Err=4), so this is
        // true for Verbose/Debug/Info — i.e. "verbose enough to print info".
        self.log_ref()
            .map(|l| l.level.at_least(bun_ast::Level::Info))
            .unwrap_or(false)
    }

    fn is_watcher_enabled(&self) -> bool {
        // Zig: `this.bun_watcher != .none`. The field is stored type-erased
        // (`*mut c_void` → `*mut ImportWatcher`); a null pointer means `.none`.
        if self.bun_watcher.is_null() {
            return false;
        }
        // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set by
        // `install_bun_watcher`; the cast recovers the concrete type.
        !matches!(
            unsafe { &*self.bun_watcher.cast::<ImportWatcher>() },
            ImportWatcher::None
        )
    }

    fn watcher_top_level_dir(&self) -> &'static [u8] {
        self.top_level_dir()
    }

    fn install_bun_watcher(
        &mut self,
        watcher: Box<Watcher>,
        reload_immediately: bool,
    ) -> *mut Watcher {
        // Zig: `this.bun_watcher = if (reload_immediately) .{ .watch = w } else .{ .hot = w }`
        // followed by `this.transpiler.resolver.watcher = ResolveWatcher(...).init(w)`.
        let mut iw = Box::new(if reload_immediately {
            ImportWatcher::Watch(watcher)
        } else {
            ImportWatcher::Hot(watcher)
        });
        let watcher_ptr: *mut Watcher = match &mut *iw {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => &raw mut **w,
            ImportWatcher::None => unreachable!(),
        };
        // The VM holds `bun_watcher` type-erased as `*mut c_void` (b2-cycle).
        self.bun_watcher = bun_core::heap::into_raw(iw).cast::<core::ffi::c_void>();

        // Wire the resolver's directory-watch callback at the same time.
        // Zig: `ResolveWatcher(*Watcher, Watcher.onMaybeWatchDirectory).init(w)`;
        // `Watcher::get_resolve_watcher` is the Rust-side equivalent that
        // erases the `*mut Watcher` into the resolver's `AnyResolveWatcher`
        // vtable (re-exported from `bun_watcher`, so it's the same type).
        // SAFETY: `watcher_ptr` was just installed into `self.bun_watcher`
        // via `heap::alloc` and is live for the VM's lifetime.
        self.transpiler.resolver.watcher = Some(unsafe { (*watcher_ptr).get_resolve_watcher() });

        watcher_ptr
    }

    fn compute_clear_screen(&self) -> bool {
        !self
            .env_loader()
            .has_set_no_clear_terminal_on_reload(!Output::enable_ansi_colors_stdout())
    }
}

/// The concrete `HotReloadTask` instance the JS event loop dispatches
/// (`jsc.hot_reloader.HotReloader.Task` in Zig). The dyn trait of the same
/// name below is the type-erased view used by `HotReloaderCtx::reload`.
pub type HotReloadTask = Task<VirtualMachine, EventLoop, false>;

/// Replaces Zig's structural duck-typing on `Ctx` (`this.ctx.eventLoop()`,
/// `this.ctx.bun_watcher`, `this.ctx.bustDirCache`, `this.ctx.getLoaders`,
/// `this.ctx.reload`) with an explicit trait bound. Implemented by
/// `VirtualMachine` and `bun.bake.DevServer`.
///
/// `bun_watcher_mut` collapses the three-way `@TypeOf(this.ctx.bun_watcher)`
/// reflection in `getContext` (ImportWatcher / Option / bare) into one method
/// the impl picks the right arm of.
pub trait HotReloaderCtx {
    type EventLoop;

    fn event_loop(&self) -> *mut Self::EventLoop;

    /// Safe `&EventLoop` accessor. The event loop is owned by the `Ctx` (a
    /// sibling field on `VirtualMachine`, or unreachable for the
    /// `RELOAD_IMMEDIATELY` BundleV2 instantiation) and outlives the reloader,
    /// so callers go through this instead of dereferencing the raw
    /// `event_loop()` pointer at each site.
    fn event_loop_ref(&self) -> &Self::EventLoop;

    /// Zig: `this.ctx.bun_watcher` field, with comptime `@TypeOf` reflection
    /// to unwrap `ImportWatcher`/`Option`. Implementor returns the live
    /// `Watcher` regardless of how it's stored.
    fn bun_watcher_mut(&mut self) -> &mut Watcher;

    /// Called from `Task::run` to perform the actual reload. Zig passed the
    /// concrete `*HotReloadTask`; Rust erases the const-generic via the
    /// `HotReloadTask` view so this trait isn't recursively generic.
    fn reload(&mut self, task: &mut dyn HotReloadTaskView);

    /// Zig: `this.ctx.bustDirCache(path)`. Returns whether anything was busted.
    fn bust_dir_cache(&mut self, path: &[u8]) -> bool;

    /// Zig: `this.ctx.getLoaders()` — `&transpiler.options.loaders`.
    fn get_loaders(&self) -> &bun_ast::LoaderHashTable;

    /// Zig: `if (@hasField(Ctx, "log")) this.log.level.atLeast(.info) else false`.
    fn log_level_at_least_info(&self) -> bool {
        false
    }

    // ── enable_hot_module_reloading accessors ────────────────────────────
    // Zig's `enableHotModuleReloading` reaches into `ctx.bun_watcher` and
    // `ctx.transpiler.{fs, env, resolver.watcher}` via structural duck-typing.
    // The methods below expose just enough surface for the generic body.

    /// Zig: `this.bun_watcher != .none` / `this.bun_watcher != null`.
    fn is_watcher_enabled(&self) -> bool;

    /// Zig: `this.transpiler.fs.top_level_dir` — the watcher only consumes the
    /// project root path.
    fn watcher_top_level_dir(&self) -> &'static [u8];

    /// Zig: assigns `this.bun_watcher = .{ .hot/.watch = w }` (or `= w` for
    /// non-ImportWatcher ctxs) and `this.transpiler.resolver.watcher =
    /// ResolveWatcher(*Watcher, Watcher.onMaybeWatchDirectory).init(w)`.
    /// Returns the now-installed `*mut Watcher` so the caller can `start()` it.
    fn install_bun_watcher(
        &mut self,
        watcher: Box<Watcher>,
        reload_immediately: bool,
    ) -> *mut Watcher;

    /// Zig: `!this.transpiler.env.hasSetNoClearTerminalOnReload(!Output.enable_ansi_colors_stdout)`.
    fn compute_clear_screen(&self) -> bool;
}

/// Replaces Zig's structural call `this.eventLoop().enqueueTaskConcurrent(task)`
/// with a trait bound on the `EventLoopType` generic. The only concrete event
/// loop ever instantiated is `crate::event_loop::EventLoop`.
pub trait HotReloaderEventLoop {
    /// Forward to the inherent `enqueue_task_concurrent` (safe `&self` method
    /// on every concrete event loop). Takes `&Self` so the raw-pointer
    /// dereference of the `Ctx`-owned `*mut EventLoopType` is narrowed to the
    /// two call sites, not spread across the trait + impls.
    fn enqueue_task_concurrent(this: &Self, task: *mut ConcurrentTask);
}

impl HotReloaderEventLoop for EventLoop {
    fn enqueue_task_concurrent(this: &Self, task: *mut ConcurrentTask) {
        // Inherent `EventLoop::enqueue_task_concurrent(&self, ..)` — inherent
        // methods take precedence over trait methods, so this is not recursive.
        this.enqueue_task_concurrent(task)
    }
}

/// `bun build --watch` instantiates `NewHotReloader<BundleV2, AnyEventLoop, true>`
/// (bundle_v2.zig:50). With `RELOAD_IMMEDIATELY = true`, `Task::enqueue` diverges
/// via `bun_core::reload_process()` before any concurrent task is enqueued, and
/// in the Zig spec `enqueueTaskConcurrent` is `unreachable` (hot_reloader.zig:161).
/// `BundleV2` doesn't even define `eventLoop()` — Zig's lazy compilation never
/// instantiates it. Match that here.
impl HotReloaderEventLoop for bun_event_loop::AnyEventLoop<'static> {
    fn enqueue_task_concurrent(_this: &Self, _task: *mut ConcurrentTask) {
        unreachable!()
    }
}

/// Type-erased view of a `Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>` so
/// `HotReloaderCtx::reload` doesn't need to name the const generics.
pub trait HotReloadTaskView {
    fn count(&self) -> u8;
    fn hashes(&self) -> &[u32];
    fn paths(&self) -> &[&'static [u8]];
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool> HotReloadTaskView
    for Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
{
    fn count(&self) -> u8 {
        self.count
    }
    fn hashes(&self) -> &[u32] {
        &self.hashes[..self.count as usize]
    }
    fn paths(&self) -> &[&'static [u8]] {
        &self.paths[..self.count as usize]
    }
}

/// When non-null, `on_file_update` records the absolute path of every file
/// it sees change before triggering a reload. Used by `bun test --changed
/// --watch` so the restarted process can narrow its changed-file set to
/// what the watcher actually observed (instead of re-querying git, which
/// would re-run every test affected by any uncommitted change, not just
/// the one that was just edited).
///
/// Set by `test_command.zig` on the main thread before the watcher thread
/// starts; after that point only the watcher thread touches it. Its
/// contents are written to `watch_changed_trigger_file` immediately
/// before `reload_process`; the new process reads and deletes that file.
// Zig was `?*bun.StringSet`; written once on main thread before watcher thread
// starts, then watcher-thread-only. `OnceLock` carries the publish.
pub static WATCH_CHANGED_PATHS: std::sync::OnceLock<WatchChangedPaths> = std::sync::OnceLock::new();

/// `Send + Sync` newtype around the arena-allocated `StringSet` pointer so it
/// can sit inside a `OnceLock`. The set is written once on the main thread
/// before the watcher thread starts, then mutated only from the watcher
/// thread — never concurrently — so cross-thread publication of the raw
/// pointer is sound.
pub struct WatchChangedPaths(core::ptr::NonNull<StringSet>);
impl WatchChangedPaths {
    #[inline]
    pub fn new(set: &'static mut StringSet) -> Self {
        Self(core::ptr::NonNull::from(set))
    }

    /// Reborrow the wrapped `StringSet`. Single audited `unsafe` for the
    /// set-once `NonNull` deref so the two callers below
    /// (`record_changed_path`, `flush_changed_paths_for_reload`) are safe.
    ///
    /// Soundness: published exactly once via `OnceLock` before the watcher
    /// thread starts; thereafter only the watcher thread reaches the callers,
    /// so the `&mut` is exclusive. Lives in the process-lifetime CLI arena.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn get_mut(&self) -> &mut StringSet {
        // SAFETY: see doc comment — single-writer (watcher thread) after
        // init-once publish; allocation outlives the process.
        unsafe { &mut *self.0.as_ptr() }
    }
}
// SAFETY: published exactly once before the watcher thread starts; thereafter
// only the watcher thread dereferences it (see module docs above). The
// allocation lives in the process-lifetime CLI arena.
unsafe impl Send for WatchChangedPaths {}
unsafe impl Sync for WatchChangedPaths {}

/// Absolute path of the temp file `flush_changed_paths_for_reload` writes
/// the changed-path list into. The same path is exported via the
/// `BUN_INTERNAL_TEST_CHANGED_TRIGGER_FILE` env var so the restarted
/// process can find it. Set alongside `WATCH_CHANGED_PATHS` by
/// `test_command.zig`; the string must outlive the process.
///
/// Init-once-then-read-only (main thread sets, watcher thread reads), so
/// `OnceLock` per PORTING.md §Global mutable state. `&ZStr` is a fat pointer
/// (`ZStr` is `[u8]`-backed), so `AtomicCell` would not fit anyway.
pub static WATCH_CHANGED_TRIGGER_FILE: std::sync::OnceLock<&'static ZStr> =
    std::sync::OnceLock::new();

fn record_changed_path(path: &[u8]) {
    let Some(set) = WATCH_CHANGED_PATHS.get() else {
        return;
    };
    if path.is_empty() {
        return;
    }
    bun_core::handle_oom(set.get_mut().insert(path));
}

/// Write the recorded changed paths to the trigger file so the next
/// process (after exec()) can consume them. Best-effort: if the write
/// fails, the new process falls back to querying git.
fn flush_changed_paths_for_reload() {
    // `WATCH_CHANGED_TRIGGER_FILE` is never set on Windows (see
    // `ChangedFilesFilter.initWatchTrigger`), so this body would be
    // dead there anyway; guarding lets us use POSIX path types below.
    #[cfg(windows)]
    {
        return;
    }
    #[cfg(not(windows))]
    {
        let Some(set) = WATCH_CHANGED_PATHS.get() else {
            return;
        };
        let Some(&dest) = WATCH_CHANGED_TRIGGER_FILE.get() else {
            return;
        };
        let set = set.get_mut();
        if set.count() == 0 {
            return;
        }

        let mut buf: Vec<u8> = Vec::new();
        for p in set.keys() {
            if buf.try_reserve(p.len() + 1).is_err() {
                return;
            }
            buf.extend_from_slice(p);
            buf.push(b'\n');
        }
        let _ = bun_sys::File::write_file(Fd::cwd(), dest, &buf);
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    safe fn BunDebugger__willHotReload();
}

// TODO(port): in Zig this was a `pub var` inside the generic struct, giving one
// static per monomorphization. Rust can't put a static in a generic impl; both
// HotReloader and WatchReloader now share this. Revisit if the per-type split
// was load-bearing.
static CLEAR_SCREEN: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

pub struct NewHotReloader<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool> {
    /// BACKREF to the owning context (Bundler / VM transpiler store) that
    /// created this reloader. Set once at init and never reassigned; the
    /// context outlives the reloader (and every `Task` it spawns).
    pub ctx: bun_ptr::BackRef<Ctx>,
    pub verbose: bool,
    pub pending_count: AtomicU32,

    pub main: MainFile,

    pub tombstones: StringHashMap<*mut Fs::EntriesOption>,

    _event_loop: PhantomData<*mut EventLoopType>,
}

pub struct MainFile {
    /// Includes a trailing "/"
    // TODO(port): lifetime — borrows from `entry_path` (owned by Ctx, outlives Reloader)
    pub dir: &'static [u8],
    pub dir_hash: bun_watcher::HashType,

    pub file: &'static [u8],
    pub hash: bun_watcher::HashType,

    /// On macOS, vim's atomic save triggers a race condition:
    /// 1. Old file gets NOTE_RENAME (file renamed to temp name: a.js -> a.js~)
    /// 2. We receive the event and would normally trigger reload immediately
    /// 3. But the new file hasn't been created yet - reload fails with ENOENT
    /// 4. New file gets created and written (a.js)
    /// 5. Parent directory gets NOTE_WRITE
    ///
    /// To fix this: when the entrypoint gets NOTE_RENAME, we set this flag
    /// and skip the reload. Then when the parent directory gets NOTE_WRITE,
    /// we check if the file exists and trigger the reload.
    pub is_waiting_for_dir_change: bool,
}

impl Default for MainFile {
    fn default() -> Self {
        Self {
            dir: b"",
            dir_hash: 0,
            file: b"",
            hash: 0,
            is_waiting_for_dir_change: false,
        }
    }
}

impl MainFile {
    pub fn init(file: &'static [u8]) -> MainFile {
        let mut main = MainFile {
            file,
            hash: if !file.is_empty() {
                Watcher::get_hash(file)
            } else {
                0
            },
            is_waiting_for_dir_change: false,
            ..Default::default()
        };

        if let Some(dir) = bun_core::dirname(file) {
            debug_assert!(bun_core::is_slice_in_buffer(dir, file));
            debug_assert!(file.len() > dir.len() + 1);
            main.dir = &file[0..dir.len() + 1];
            main.dir_hash = Watcher::get_hash(main.dir);
        }

        main
    }
}

pub struct Task<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool> {
    pub count: u8,
    pub hashes: [u32; 8],
    // TODO(port): in Zig this field's type is `[8][]const u8` only when
    // `Ctx == bun.bake.DevServer`, else `void`. Rust can't branch a field
    // type on a generic parameter without specialization; storing it
    // unconditionally for now.
    pub paths: [&'static [u8]; 8],
    /// Left `None` until [`Self::enqueue`] populates it on the heap copy.
    pub concurrent_task: Option<ConcurrentTask>,
    pub reloader: *mut NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>,
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool>
    Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
    EventLoopType: HotReloaderEventLoop,
{
    pub fn init_empty(
        reloader: *mut NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>,
    ) -> Self {
        Self {
            reloader,
            hashes: [0u32; 8],
            // TODO(port): was `if (Ctx == bun.bake.DevServer) [_][]const u8{&.{}} ** 8`
            paths: [b"".as_slice(); 8],
            count: 0,
            concurrent_task: None,
        }
    }

    /// Per-field raw read of the reloader's `pending_count`.
    ///
    /// `reloader` is a BACKREF: the `NewHotReloader` heap-allocates every
    /// `Task` (via [`Self::enqueue`]) and is itself leaked for the process
    /// lifetime in `enable_hot_module_reloading`, so it strictly outlives
    /// every `Task` it spawns. The pointer is never null (set in
    /// [`Self::init_empty`] / copied in [`Self::enqueue`]).
    ///
    /// We deliberately do **not** expose a whole-struct `&NewHotReloader`
    /// accessor: [`Self::run`] executes on the JS event-loop thread while the
    /// watcher thread may be inside `on_file_update(&mut self)` writing
    /// non-`UnsafeCell` fields (`main.is_waiting_for_dir_change`, `tombstones`).
    /// Materializing `&NewHotReloader` on the JS thread would assert those
    /// bytes are frozen, which is a data race / Stacked-Borrows violation even
    /// though this side never reads them. Instead, project to the single
    /// `AtomicU32` field via `addr_of!` so no `&NewHotReloader` is formed.
    #[inline]
    fn pending_count(&self) -> &AtomicU32 {
        // SAFETY: BACKREF — see doc comment above. `addr_of!` forms a place
        // projection without an intermediate `&NewHotReloader`; `pending_count`
        // is `AtomicU32` (interior-mutable) so a cross-thread `&` to it is sound.
        unsafe { &*core::ptr::addr_of!((*self.reloader).pending_count) }
    }

    /// Per-field raw read of the reloader's `ctx` pointer. See
    /// [`Self::pending_count`] for why no whole-struct `&NewHotReloader`
    /// accessor is exposed.
    #[inline]
    fn ctx_ptr(&self) -> *mut Ctx {
        // SAFETY: BACKREF — reloader outlives every Task; `addr_of!` avoids
        // forming `&NewHotReloader`. `ctx` is set once at init and never
        // mutated, so a racy raw read of the pointer value is fine.
        unsafe { (*core::ptr::addr_of!((*self.reloader).ctx)).as_ptr() }
    }

    pub fn append(&mut self, id: u32) {
        if self.count == 8 {
            self.enqueue();
            self.count = 0;
        }

        self.hashes[self.count as usize] = id;
        self.count += 1;
    }

    /// Spec: hot_reloader.zig `Task.deinit` → `bun.destroy(this)`. The
    /// dispatched task was heap-allocated in [`Self::enqueue`] via
    /// `heap::alloc`; the event loop calls this after `run()` to free it.
    ///
    /// # Safety
    /// `this` must have been created via `heap::alloc` in [`Self::enqueue`]
    /// and must not be used after this call.
    pub unsafe fn deinit(this: *mut Self) {
        // SAFETY: precondition — `this` came from heap::alloc in `enqueue`.
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn run(&mut self) {
        // Since we rely on the event loop for hot reloads, there can be
        // a delay before the next reload begins. In the time between the
        // last reload and the next one, we shouldn't schedule any more
        // hot reloads. Since we reload literally everything, we don't
        // need to worry about missing any changes.
        //
        // Note that we set the count _before_ we reload, so that if we
        // get another hot reload request while we're reloading, we'll
        // still enqueue it.
        while self.pending_count().swap(0, Ordering::Relaxed) > 0 {
            let ctx = self.ctx_ptr();
            // SAFETY: ctx outlives reloader (BACKREF).
            unsafe { (*ctx).reload(self) };
        }
    }

    pub fn enqueue(&mut self) {
        crate::mark_binding!();
        if self.count == 0 {
            return;
        }

        if RELOAD_IMMEDIATELY {
            Output::flush();
            // Zig: `if (comptime Ctx == ImportWatcher) { if (ctx.rare_data) |rare|
            // rare.closeAllListenSocketsForWatchMode(); }`. That comptime guard is
            // *never* true for any actual instantiation (Ctx is VirtualMachine or
            // BundleV2, never ImportWatcher itself), so the call is dead code in
            // the spec. Match spec literally: no-op for every Ctx.
            //
            // PORT NOTE: this is almost certainly a Zig typo — the intent was
            // likely `@TypeOf(ctx.bun_watcher) == ImportWatcher`, which would
            // close listen sockets before exec()-restarting under --watch on a
            // VirtualMachine. But fixing that here would diverge from observable
            // Zig behaviour; revisit upstream first.
            flush_changed_paths_for_reload();
            bun_core::reload_process(
                CLEAR_SCREEN.load(core::sync::atomic::Ordering::Relaxed),
                false,
            );
            unreachable!();
        }

        self.pending_count().fetch_add(1, Ordering::Relaxed);

        BunDebugger__willHotReload();
        let that = bun_core::heap::into_raw(Box::new(Self {
            reloader: self.reloader,
            count: self.count,
            paths: self.paths,
            hashes: self.hashes,
            concurrent_task: None,
        }));
        // SAFETY: `that` was just allocated above and is exclusively owned here.
        unsafe {
            // PORT NOTE: `JscTask::init` requires `Taskable`, but const-generic
            // `Task<Ctx, _, _>` can't implement it (one tag per monomorphization).
            // The Zig source tagged the concrete `HotReloader.HotReloadTask` —
            // use the raw `(tag, ptr)` constructor.
            let concurrent = (*that).concurrent_task.insert(ConcurrentTask {
                task: JscTask::new(task_tag::HotReloadTask, that.cast::<()>()),
                ..Default::default()
            });
            // TODO(port): `&that.concurrent_task` is an interior pointer into a
            // Box-allocated Task; event loop must not outlive `that`. Matches Zig.
            //
            // Inlines `NewHotReloader::enqueue_task_concurrent` to avoid forming
            // a whole-struct `&NewHotReloader` (see `Self::pending_count` doc).
            // `RELOAD_IMMEDIATELY` already diverged above so its guard is dead here.
            let ctx = self.ctx_ptr();
            // SAFETY: ctx outlives reloader (BACKREF); `event_loop()` returns
            // the live event-loop pointer owned by `Ctx`.
            let event_loop = &*(*ctx).event_loop();
            EventLoopType::enqueue_task_concurrent(event_loop, std::ptr::from_mut(concurrent));
        }
        self.count = 0;
    }
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool>
    NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
    EventLoopType: HotReloaderEventLoop,
{
    pub fn init(
        ctx: *mut Ctx,
        fs: &'static FileSystem,
        verbose: bool,
        clear_screen_flag: bool,
    ) -> Box<Watcher> {
        // SAFETY: `ctx` is the live owning context; it outlives the reloader
        // and every Task spawned from it (BACKREF).
        let reloader = bun_core::heap::into_raw(Box::new(Self {
            ctx: unsafe { bun_ptr::BackRef::from_raw(ctx) },
            verbose: cfg!(feature = "debug_logs") || verbose,
            pending_count: AtomicU32::new(0),
            main: MainFile::default(),
            tombstones: StringHashMap::default(),
            _event_loop: PhantomData,
        }));

        // SAFETY: single-threaded init; watcher thread not yet started.
        CLEAR_SCREEN.store(clear_screen_flag, core::sync::atomic::Ordering::Relaxed);
        let mut watcher = match Watcher::init(reloader, fs.top_level_dir) {
            Ok(w) => w,
            Err(err) => {
                // TODO(port): bun.handleErrorReturnTrace — debug-only diagnostics; no Rust equivalent yet
                let _ = &err;
                Output::panic(format_args!(
                    "Failed to enable File Watcher: {}",
                    err.name()
                ));
            }
        };
        if let Err(err) = watcher.start() {
            // TODO(port): bun.handleErrorReturnTrace — debug-only diagnostics; no Rust equivalent yet
            let _ = &err;
            Output::panic(format_args!("Failed to start File Watcher: {}", err.name()));
        }
        watcher
    }

    fn debug(args: core::fmt::Arguments<'_>) {
        if cfg!(feature = "debug_logs") {
            bun_core::scoped_log!(hot_reloader, "{}", args);
        } else {
            // TODO(port): Output.prettyErrorln with color tags
            bun_core::pretty_errorln!("<cyan>watcher<r><d>:<r> {}", args);
        }
    }

    pub fn event_loop(&self) -> *mut EventLoopType {
        // `ctx` is a BACKREF that outlives the reloader.
        self.ctx.event_loop()
    }

    pub fn enqueue_task_concurrent(&self, task: *mut ConcurrentTask) {
        if RELOAD_IMMEDIATELY {
            unreachable!();
        }

        // `ctx` is a `BackRef<Ctx>` (Deref) and `event_loop_ref` is the safe
        // accessor on the trait; the event loop is owned by `Ctx` and outlives
        // the reloader.
        EventLoopType::enqueue_task_concurrent(self.ctx.event_loop_ref(), task);
    }

    pub fn enable_hot_module_reloading(this: *mut Ctx, entry_path: Option<&'static [u8]>) {
        // SAFETY: caller passes the live `Ctx` (VirtualMachine / DevServer)
        // pointer; it outlives the reloader allocated below.
        let ctx = unsafe { &mut *this };

        // Zig: `if (@TypeOf(this.bun_watcher) == ImportWatcher) { if (!= .none) return; }
        //        else { if (!= null) return; }`
        if ctx.is_watcher_enabled() {
            return;
        }

        let reloader = bun_core::heap::into_raw(Box::new(Self {
            // SAFETY: `this` is the live owning context; it outlives the reloader.
            ctx: unsafe { bun_ptr::BackRef::from_raw(this) },
            verbose: cfg!(feature = "debug_logs") || ctx.log_level_at_least_info(),
            pending_count: AtomicU32::new(0),
            main: MainFile::init(entry_path.unwrap_or(b"")),
            tombstones: StringHashMap::default(),
            _event_loop: PhantomData,
        }));

        let watcher = match Watcher::init(reloader, ctx.watcher_top_level_dir()) {
            Ok(w) => w,
            Err(err) => {
                // TODO(port): bun.handleErrorReturnTrace — debug-only diagnostics; no Rust equivalent yet
                Output::panic(format_args!(
                    "Failed to enable File Watcher: {}",
                    err.name()
                ));
            }
        };

        // Zig: assigns `this.bun_watcher = .{.hot/.watch = w}` (or bare) and
        // `this.transpiler.resolver.watcher = ResolveWatcher(...).init(w)` in one
        // comptime-reflected block. Folded into the trait method.
        let watcher_ptr = ctx.install_bun_watcher(watcher, RELOAD_IMMEDIATELY);

        // SAFETY: single-threaded init; watcher thread not yet started.
        CLEAR_SCREEN.store(
            ctx.compute_clear_screen(),
            core::sync::atomic::Ordering::Relaxed,
        );

        // SAFETY: `watcher_ptr` was just installed into `ctx` and is live.
        if let Err(_) = unsafe { (*watcher_ptr).start() } {
            panic!("Failed to start File Watcher");
        }
    }

    fn put_tombstone(&mut self, key: &[u8], value: *mut Fs::EntriesOption) {
        self.tombstones.put(key, value).expect("unreachable");
    }

    fn get_tombstone(&mut self, key: &[u8]) -> Option<*mut Fs::EntriesOption> {
        self.tombstones.get(key).copied()
    }

    pub fn on_error(_: &mut Self, err: bun_sys::Error) {
        // Zig: `Output.err(@as(bun.sys.E, @enumFromInt(err.errno)), ...)`.
        // `bun_sys::Error::name()` does the same errno→tag-name lookup
        // (with the unchecked-@enumFromInt UB folded into a checked path).
        Output::err(err.name(), "Watcher crashed", ());
        if cfg!(debug_assertions) {
            panic!("Watcher crash");
        }
    }

    /// Single audited `&mut Ctx` reborrow through the [`BackRef`]. The owning
    /// context outlives this reloader (set once at init, never reassigned —
    /// see field doc), and `&mut self` ensures no other reborrow through this
    /// reloader is live. Centralizes the per-call-site `BackRef::get_mut`
    /// deref previously open-coded at each `bust_dir_cache` site.
    #[inline]
    fn ctx_mut(&mut self) -> &mut Ctx {
        // SAFETY: BACKREF invariant — ctx outlives the reloader; `&mut self`
        // gives exclusivity for the returned borrow's duration.
        unsafe { self.ctx.get_mut() }
    }

    pub fn get_context(&mut self) -> &mut Watcher {
        // PORT NOTE: Zig branched three ways on `@TypeOf(this.ctx.bun_watcher)`
        // (ImportWatcher / Option / bare). Folded into `HotReloaderCtx::bun_watcher_mut`;
        // each impl picks the right unwrap.
        self.ctx_mut().bun_watcher_mut()
    }

    #[inline(never)]
    pub fn on_file_update(
        &mut self,
        events: &mut [bun_watcher::WatchEvent],
        changed_files: &[ChangedFilePath],
        watchlist: &bun_watcher::WatchList,
    ) {
        let slice = watchlist.slice();
        let file_paths = slice.items_file_path();
        // PORT NOTE: `WatchItemColumns` doesn't expose a `count` accessor; reach
        // through the generic SoA column directly. Zig mutates this in place
        // (`counts[index] = update_count`) — build the &mut from the raw column
        // pointer rather than ref-casting `&[u32]` (which is UB).
        // SAFETY: column `Count` is `u32`; `items_raw` yields a pointer valid
        // for `slice.len()` elements; the watcher thread is the sole writer of
        // this column for the loop's duration and no other `&` to it is live.
        let counts: &mut [u32] =
            unsafe { bun_core::ffi::slice_mut(slice.items_raw::<"count", u32>(), slice.len()) };
        let kinds = slice.items_kind();
        let hashes = slice.items_hash();
        let parents = slice.items_parent_hash();
        let file_descriptors = slice.items_fd();
        // PORT NOTE: reshaped for borrowck — `ctx` is held as a raw pointer so
        // `self` can be reborrowed inside the loop body for tombstone access,
        // and so the deferred `flush_evictions` doesn't hold `&mut Watcher`
        // across the loop.
        let ctx: *mut Watcher = std::ptr::from_mut(self.get_context());
        // Zig: `defer current_task.enqueue();` — wrap the Task itself in the guard
        // so any exit path (including future early-returns) flushes the buffered
        // hashes. Dereferenced as `&mut *current_task` for the loop body below.
        //
        // PORT NOTE: declared *before* `_flush` (inverting the Zig defer order)
        // so `flush_evictions()` runs **before** `enqueue()` on drop. The Zig
        // order (`enqueue` → `Output.flush` → `flushEvictions`) opens a window
        // where the JS thread can pick up the concurrent task, look the file up
        // in the watchlist, and read the cached fd while this thread is still
        // about to `close()` + `swap_remove()` it in `flush_evictions` —
        // surfacing as `EBADF`/`EISDIR reading "<path>"` in hot.test.ts under
        // load. Evicting first is side-effect-free: `enqueue` carries hashes
        // (not indices) and never reads the watchlist.
        let mut current_task = scopeguard::guard(
            Task::<Ctx, EventLoopType, RELOAD_IMMEDIATELY>::init_empty(self),
            |mut t| t.enqueue(),
        );
        // `defer ctx.flushEvictions(); defer Output.flush();` — see PORT NOTE
        // above for why this drops *before* `current_task`.
        let _flush = scopeguard::guard(ctx, |ctx| {
            Output::flush();
            // SAFETY: the Watcher outlives this call (it owns the Reloader that calls us).
            unsafe { (*ctx).flush_evictions() };
        });
        // SAFETY: the Watcher outlives this call (it owns the Reloader that calls us).
        let ctx = unsafe { &mut *ctx };

        let fs: &mut FileSystem = FileSystem::instance();
        let rfs: &mut Fs::file_system::RealFS = &mut fs.fs;
        let mut _on_file_update_path_buf = PathBuffer::uninit();

        for event in events.iter() {
            // Stale udata: kevent.udata can outlive a swapRemove in flushEvictions.
            if event.index as usize >= file_paths.len() {
                continue;
            }
            let file_path: &[u8] = &file_paths[event.index as usize];
            let update_count = counts[event.index as usize] + 1;
            counts[event.index as usize] = update_count;
            let kind = kinds[event.index as usize];

            // so it's consistent with the rest
            // if we use .extname we might run into an issue with whether or not the "." is included.
            // let path = Fs::PathName::init(file_path);
            let current_hash = hashes[event.index as usize];

            match kind {
                bun_watcher::Kind::File => {
                    if event.op.contains(WatchOp::DELETE)
                        || (event.op.contains(WatchOp::RENAME) && IS_KQUEUE)
                    {
                        ctx.remove_at_index(bun_watcher::Kind::File, event.index, 0, &[]);
                    }

                    if self.verbose {
                        Self::debug(format_args!(
                            "File changed: {}",
                            // PORT NOTE: `fs.relative_to(file_path)` would borrow `&*fs`
                            // while `rfs = &mut fs.fs` is live; inline the body so the
                            // split-borrow on `fs.top_level_dir` is visible to borrowck.
                            bstr::BStr::new(bun_paths::resolve_path::relative(
                                fs.top_level_dir,
                                file_path
                            ))
                        ));
                    }

                    if event
                        .op
                        .intersects(WatchOp::WRITE | WatchOp::DELETE | WatchOp::RENAME)
                    {
                        record_changed_path(file_path);
                        if IS_KQUEUE {
                            if event.op.contains(WatchOp::RENAME) {
                                // Special case for entrypoint: defer reload until we get
                                // a directory write event confirming the file exists.
                                // This handles vim's save process which renames the old file
                                // before the new file is re-created with a different inode.
                                if self.main.hash == current_hash && !RELOAD_IMMEDIATELY {
                                    self.main.is_waiting_for_dir_change = true;
                                    continue;
                                }
                            }

                            // If we got a write event after rename, the file is back - proceed with reload
                            if self.main.is_waiting_for_dir_change && self.main.hash == current_hash
                            {
                                self.main.is_waiting_for_dir_change = false;
                            }
                        }

                        current_task.append(current_hash);
                    }
                }
                bun_watcher::Kind::Directory => {
                    #[cfg(windows)]
                    {
                        // on windows we receive file events for all items affected by a directory change
                        // so we only need to clear the directory cache. all other effects will be handled
                        // by the file events
                        let _ = self.ctx_mut().bust_dir_cache(
                            strings::paths::without_trailing_slash_windows_path(file_path),
                        );
                        continue;
                    }
                    #[cfg(not(windows))]
                    {
                        let mut affected_buf: [&[u8]; 128] = [b"".as_slice(); 128];
                        let mut entries_option: Option<*mut Fs::EntriesOption> = None;

                        // PORT NOTE: the Zig labeled block produced a slice whose
                        // element type differs by platform (`[]const u8` on kqueue,
                        // `?[:0]u8` on inotify). Split into two locals; only one is
                        // populated per cfg.
                        let mut affected_kqueue: &[&[u8]] = &[];
                        let mut affected_inotify: &[ChangedFilePath] = &[];
                        let _ = (&mut affected_kqueue, &mut affected_inotify);

                        let affected_len: usize = 'brk: {
                            if IS_KQUEUE {
                                // SAFETY: hot-reload runs single-threaded on the JS thread;
                                // no other live `&mut EntriesOption` for this key here.
                                if let Some(existing) = rfs.entries.get(file_path) {
                                    self.put_tombstone(file_path, existing);
                                    entries_option = Some(existing);
                                } else if let Some(existing) = self.get_tombstone(file_path) {
                                    entries_option = Some(existing);
                                }

                                if event.op.contains(WatchOp::WRITE) {
                                    // Check if the entrypoint now exists after an atomic save.
                                    // If we previously got a NOTE_RENAME on the entrypoint (vim renamed
                                    // the file), this directory write event signals that the new
                                    // file has been re-created. Verify it exists and trigger reload.
                                    if self.main.is_waiting_for_dir_change
                                        && self.main.dir_hash == current_hash
                                    {
                                        // Zig: `if (bun.sys.faccessat(fd, basename) == .result)`.
                                        // That compares the Maybe(bool) *tag*, ignoring the
                                        // payload — `.result(true)` and `.result(false)` both
                                        // match (faccessat only yields `.err` on NAMETOOLONG).
                                        // Match spec literally: `.is_ok()`. The comment above
                                        // says "Verify it exists", and this is likely a latent
                                        // Zig bug, but spec parity wins; in practice the
                                        // branch is harmless (re-watching a missing entrypoint
                                        // is a no-op downstream).
                                        let mut name_buf = [0u8; 256];
                                        let basename = bun_paths::basename(self.main.file);
                                        let exists = if basename.len() < name_buf.len() {
                                            name_buf[..basename.len()].copy_from_slice(basename);
                                            name_buf[basename.len()] = 0;
                                            // SAFETY: name_buf[..=basename.len()] is NUL-terminated.
                                            let z = ZStr::from_buf(&name_buf[..], basename.len());
                                            bun_sys::faccessat(
                                                file_descriptors[event.index as usize],
                                                z,
                                            )
                                            .is_ok()
                                        } else {
                                            false
                                        };
                                        if exists {
                                            self.main.is_waiting_for_dir_change = false;
                                            record_changed_path(self.main.file);
                                            current_task.append(self.main.hash);
                                        }
                                    }
                                }

                                let mut affected_i: usize = 0;

                                // if a file descriptor is stale, we need to close it
                                if event.op.contains(WatchOp::DELETE) && entries_option.is_some() {
                                    for (entry_id, parent_hash) in parents.iter().enumerate() {
                                        if *parent_hash == current_hash {
                                            let affected_path: &[u8] = &file_paths[entry_id];
                                            // Zig: `std.posix.access(affected_path, F_OK) != 0`.
                                            // bun_sys::access takes a &ZStr; build one on the
                                            // stack from the &[u8] watch-list slice.
                                            let was_deleted = {
                                                let mut zbuf = PathBuffer::uninit();
                                                if affected_path.len() >= zbuf.len() {
                                                    false
                                                } else {
                                                    zbuf[..affected_path.len()]
                                                        .copy_from_slice(affected_path);
                                                    zbuf[affected_path.len()] = 0;
                                                    // SAFETY: zbuf is NUL-terminated at len.
                                                    let z = ZStr::from_buf(
                                                        &zbuf[..],
                                                        affected_path.len(),
                                                    );
                                                    bun_sys::access(z, libc::F_OK).is_err()
                                                }
                                            };
                                            if !was_deleted {
                                                continue;
                                            }

                                            affected_buf[affected_i] =
                                                &affected_path[file_path.len()..];
                                            affected_i += 1;
                                            if affected_i >= affected_buf.len() {
                                                break;
                                            }
                                        }
                                    }
                                }

                                affected_kqueue = &affected_buf[0..affected_i];
                                break 'brk affected_i;
                            }

                            affected_inotify = event.names(changed_files);
                            break 'brk affected_inotify.len();
                        };

                        if affected_len > 0 && !IS_KQUEUE {
                            if let Some(existing) = rfs.entries.get(file_path) {
                                self.put_tombstone(file_path, existing);
                                entries_option = Some(existing);
                            } else if let Some(existing) = self.get_tombstone(file_path) {
                                entries_option = Some(existing);
                            }
                        }

                        let _ = self.ctx_mut().bust_dir_cache(
                            strings::paths::without_trailing_slash_windows_path(file_path),
                        );

                        // The watched entrypoint has a per-file inotify watch on its inode.
                        // An atomic rename (`rename(tmp, entrypoint)`) or a rm+recreate over
                        // the entrypoint replaces that inode, so the kernel drops the
                        // per-file watch (IN_DELETE_SELF + IN_IGNORED). When the file event
                        // and this directory event land in separate inotify-read batches,
                        // `flush_evictions` runs in between and the entry is gone from the
                        // watchlist before the recreated file is seen below — so the reload
                        // for the recreated entrypoint would be dropped and `--hot` would
                        // deadlock waiting for a reload that never happens.
                        //
                        // Recover the same way the kqueue path does (see
                        // `is_waiting_for_dir_change` above): if this directory event names
                        // the entrypoint and the file now exists, enqueue an entrypoint
                        // reload unconditionally — `main.hash` is a stored field, independent
                        // of whether the per-file watchlist entry survived. The per-file
                        // watch itself is re-armed on the JS thread by
                        // `VirtualMachine::add_main_to_watcher_if_needed` after the reload.
                        if !IS_KQUEUE && self.main.hash != 0 && self.main.dir_hash == current_hash
                        {
                            let main_basename = bun_paths::basename(self.main.file);
                            for changed_name_ in affected_inotify {
                                let changed_name: &[u8] = match changed_name_ {
                                    Some(z) => z.as_bytes(),
                                    None => continue,
                                };
                                if changed_name != main_basename {
                                    continue;
                                }
                                let main_exists = {
                                    let mut zbuf = PathBuffer::uninit();
                                    if self.main.file.len() >= zbuf.len() {
                                        false
                                    } else {
                                        zbuf[..self.main.file.len()]
                                            .copy_from_slice(self.main.file);
                                        zbuf[self.main.file.len()] = 0;
                                        // SAFETY: zbuf is NUL-terminated at len.
                                        let z = ZStr::from_buf(&zbuf[..], self.main.file.len());
                                        bun_sys::access(z, libc::F_OK).is_ok()
                                    }
                                };
                                if main_exists {
                                    record_changed_path(self.main.file);
                                    current_task.append(self.main.hash);
                                }
                                break;
                            }
                        }

                        if let Some(dir_ent) = entries_option {
                            // SAFETY: dir_ent points into rfs.entries (or a tombstoned copy);
                            // both outlive this loop iteration.
                            let dir_ent = unsafe { &mut *dir_ent };
                            let mut last_file_hash: bun_watcher::HashType =
                                bun_watcher::HashType::MAX;

                            for i in 0..affected_len {
                                let changed_name: &[u8] = if IS_KQUEUE {
                                    affected_kqueue[i]
                                } else {
                                    // Zig: `bun.asByteSlice(changed_name_.?)`
                                    affected_inotify[i].unwrap().as_bytes()
                                };
                                if changed_name.is_empty()
                                    || changed_name[0] == b'~'
                                    || changed_name[0] == b'.'
                                {
                                    continue;
                                }

                                // `ctx` is a BACKREF that outlives the reloader.
                                let loader = self
                                    .ctx
                                    .get_loaders()
                                    .get(PathName::find_extname(changed_name))
                                    .copied()
                                    .unwrap_or(bun_ast::Loader::File);
                                // PORT NOTE: Zig declares `prev_entry_id` per-iteration and
                                // reassigns it just before `break`; the write is dead there
                                // too (hot_reloader.zig:535/563). Keep the shape for
                                // fidelity; the post-assignment `_ = prev_entry_id` below
                                // documents the intentional dead store.
                                let mut prev_entry_id: usize = usize::MAX;
                                if loader != bun_ast::Loader::File {
                                    // Zig leaves these `undefined` / overwritten; both arms
                                    // of `'brk` assign before any read.
                                    let path_string: bun_core::PathString;
                                    let file_hash: bun_watcher::HashType;
                                    let abs_path: &[u8] = 'brk: {
                                        if let Some(file_ent) = dir_ent.entries().get(changed_name)
                                        {
                                            // reset the file descriptor
                                            let ent = file_ent.entry();
                                            ent.set_cache_fd(Fd::INVALID);
                                            ent.need_stat.set(true);
                                            path_string = ent.abs_path;
                                            file_hash = Watcher::get_hash(path_string.slice());
                                            for (entry_id, hash) in hashes.iter().enumerate() {
                                                if *hash == file_hash {
                                                    if file_descriptors[entry_id].is_valid() {
                                                        if prev_entry_id != entry_id {
                                                            record_changed_path(
                                                                path_string.slice(),
                                                            );
                                                            current_task.append(hashes[entry_id]);
                                                            if self.verbose {
                                                                Self::debug(format_args!(
                                                                    "Removing file: {}",
                                                                    bstr::BStr::new(
                                                                        path_string.slice()
                                                                    )
                                                                ));
                                                            }
                                                            ctx.remove_at_index(
                                                                bun_watcher::Kind::File,
                                                                entry_id as u16,
                                                                0,
                                                                &[],
                                                            );
                                                        }
                                                    }

                                                    prev_entry_id = entry_id;
                                                    _ = prev_entry_id;
                                                    break;
                                                }
                                            }

                                            break 'brk path_string.slice();
                                        } else {
                                            let file_path_without_trailing_slash =
                                                strings::trim_right(file_path, &[SEP]);
                                            _on_file_update_path_buf
                                                [0..file_path_without_trailing_slash.len()]
                                                .copy_from_slice(file_path_without_trailing_slash);
                                            _on_file_update_path_buf
                                                [file_path_without_trailing_slash.len()] = SEP;

                                            // PORT NOTE: Zig copies `changed_name` starting at
                                            // index `len` (overlapping the just-written SEP)
                                            // and then slices `len + changed_name.len + 1`
                                            // bytes — this includes one byte past the copy.
                                            // Porting verbatim; flag for Phase B review.
                                            // TODO(port): verify intended off-by-one in Zig source
                                            _on_file_update_path_buf
                                                [file_path_without_trailing_slash.len()
                                                    ..file_path_without_trailing_slash.len()
                                                        + changed_name.len()]
                                                .copy_from_slice(changed_name);
                                            let path_slice = &_on_file_update_path_buf[0
                                                ..file_path_without_trailing_slash.len()
                                                    + changed_name.len()
                                                    + 1];
                                            file_hash = Watcher::get_hash(path_slice);
                                            break 'brk path_slice;
                                        }
                                    };

                                    // skip consecutive duplicates
                                    if last_file_hash == file_hash {
                                        continue;
                                    }
                                    last_file_hash = file_hash;

                                    if self.verbose {
                                        Self::debug(format_args!(
                                            "File change: {}",
                                            bstr::BStr::new(bun_paths::resolve_path::relative(
                                                fs.top_level_dir,
                                                abs_path,
                                            ))
                                        ));
                                    }
                                }
                            }
                        }

                        if self.verbose {
                            Self::debug(format_args!(
                                "Dir change: {} (affecting {})",
                                bstr::BStr::new(bun_paths::resolve_path::relative(
                                    fs.top_level_dir,
                                    file_path
                                )),
                                affected_len
                            ));
                        }
                    }
                }
            }
        }

        // Drop order (LIFO): `_flush` guard → Output::flush() +
        // ctx.flush_evictions(), then `current_task` guard → enqueue(). See
        // PORT NOTE on `current_task` above for why this inverts the Zig
        // defer order.
    }
}

/// `Watcher::init` stores the `NewHotReloader` as its opaque context and
/// dispatches file-change/error callbacks through this trait. In Zig this
/// was structural (`@hasDecl(T, "onFileUpdate")`); the Rust watcher uses
/// `WatcherContext` instead.
impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool> bun_watcher::WatcherContext
    for NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
    EventLoopType: HotReloaderEventLoop,
{
    fn on_file_update(
        &mut self,
        events: &mut [bun_watcher::WatchEvent],
        changed_files: &[bun_watcher::ChangedFilePath],
        watchlist: &bun_watcher::WatchList,
    ) {
        Self::on_file_update(self, events, changed_files, watchlist);
    }

    fn on_error(&mut self, err: bun_sys::Error) {
        Self::on_error(self, err);
    }
}

// ── `bun build --watch` (Ctx = BundleV2) ─────────────────────────────────
// Zig: `pub const Watcher = bun.jsc.hot_reloader.NewHotReloader(BundleV2,
// EventLoop, true)` (bundle_v2.zig:50). `RELOAD_IMMEDIATELY = true` means the
// watcher thread `execve()`s on the first change (Task::enqueue diverges), so
// `event_loop()` / `reload()` are never reached; Zig doesn't even define
// `BundleV2.eventLoop()` (lazy compilation prunes it). The bundler crate (T5)
// can't name this generic, so it calls in via the `#[no_mangle]` hook below.

impl<'a> HotReloaderCtx for bun_bundler::BundleV2<'a> {
    type EventLoop = bun_event_loop::AnyEventLoop<'static>;

    fn event_loop(&self) -> *mut Self::EventLoop {
        // Zig: BundleV2 has no `eventLoop()`; with RELOAD_IMMEDIATELY=true the
        // only caller (`Task::enqueue` post-diverge) is dead code.
        unreachable!()
    }

    fn event_loop_ref(&self) -> &Self::EventLoop {
        // See `event_loop` above — dead code under RELOAD_IMMEDIATELY=true.
        unreachable!()
    }

    fn bun_watcher_mut(&mut self) -> &mut Watcher {
        // Zig: `else if (@typeInfo(@TypeOf(this.ctx.bun_watcher)) == .optional)
        //          return this.ctx.bun_watcher.?;` (hot_reloader.zig:373).
        let handle = self
            .bun_watcher
            .expect("bun_watcher_mut on un-enabled BundleV2 reloader");
        // SAFETY: `Box<Watcher>` leaked via `into_raw` in `install_bun_watcher`;
        // live for the process (BundleV2 is leaked under --watch — see
        // `generate_from_cli`).
        unsafe { &mut *handle.as_ptr() }
    }

    fn reload(&mut self, _task: &mut dyn HotReloadTaskView) {
        // RELOAD_IMMEDIATELY=true → `Task::run` is never enqueued.
        unreachable!()
    }

    fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        bun_bundler::BundleV2::bust_dir_cache(self, path)
    }

    fn get_loaders(&self) -> &bun_ast::LoaderHashTable {
        &self.transpiler.options.loaders
    }

    fn log_level_at_least_info(&self) -> bool {
        // Zig: `if (@hasField(Ctx, "log")) … else false` — BundleV2 has no
        // `log` field (the log is on `transpiler`), so this arm is `false`.
        false
    }

    fn is_watcher_enabled(&self) -> bool {
        // Zig: `else { if (this.bun_watcher != null) return; }`.
        self.bun_watcher.is_some()
    }

    fn watcher_top_level_dir(&self) -> &'static [u8] {
        FileSystem::get().top_level_dir
    }

    fn install_bun_watcher(
        &mut self,
        watcher: Box<Watcher>,
        _reload_immediately: bool,
    ) -> *mut Watcher {
        // Zig (the non-ImportWatcher arm, hot_reloader.zig:330):
        //   this.bun_watcher = Watcher.init(...);
        //   this.transpiler.resolver.watcher = ResolveWatcher(...).init(this.bun_watcher.?);
        // `watcher_nn` is a fresh non-null heap allocation; live for the
        // process (BundleV2 is leaked under --watch — see `generate_from_cli`).
        let watcher_nn = bun_core::heap::into_raw_nn(watcher);
        let watcher_ptr: *mut Watcher = watcher_nn.as_ptr();
        self.bun_watcher = Some(watcher_nn);
        // SAFETY: `watcher_ptr` was just installed; live for the process.
        self.transpiler.resolver.watcher = Some(unsafe { (*watcher_ptr).get_resolve_watcher() });
        watcher_ptr
    }

    fn compute_clear_screen(&self) -> bool {
        !self
            .transpiler
            .env()
            .has_set_no_clear_terminal_on_reload(!Output::enable_ansi_colors_stdout())
    }
}

/// Zig: `bundle_v2.Watcher = NewHotReloader(BundleV2, EventLoop, true)`
/// (bundle_v2.zig:50). `'static` because the only caller (`bun build --watch`)
/// allocates the transpiler from the process-lifetime CLI arena.
type BundlerWatcher =
    NewHotReloader<bun_bundler::BundleV2<'static>, bun_event_loop::AnyEventLoop<'static>, true>;

/// CYCLEBREAK extern hook: called from `BundleV2::init` (T5) when
/// `cli_watch_flag` is set (bundle_v2.zig:993). Erased via `*mut ()` because
/// the bundler crate can't name `NewHotReloader`.
#[unsafe(no_mangle)]
fn __bun_jsc_enable_hot_module_reloading_for_bundler(bv2: *mut ()) {
    // SAFETY: `bv2` is the `&mut *Box<BundleV2<'static>>` formed in
    // `BundleV2::init`; the lifetime is `'static` for the only caller (build
    // command leaks the CLI arena), and the box is leaked under --watch.
    let bv2 = bv2.cast::<bun_bundler::BundleV2<'static>>();
    BundlerWatcher::enable_hot_module_reloading(bv2, None);
}

pub use crate::MarkedArrayBuffer as Buffer;

// ported from: src/jsc/hot_reloader.zig
