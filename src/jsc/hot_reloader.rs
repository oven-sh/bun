use core::marker::PhantomData;
use core::sync::atomic::{AtomicU32, Ordering};

#[cfg(not(windows))]
use bun_collections::StringHashMap;
use bun_collections::StringSet;
use bun_core::Output;
use bun_core::ZStr;
#[cfg(not(windows))]
use bun_paths::SEP;
use bun_paths::strings;
#[cfg(not(windows))]
use bun_resolver::fs::PathName;
use bun_resolver::fs::{self as Fs, FileSystem};
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
    /// Look up the `package_json` column for `hash` under the watcher's
    /// mutex.
    ///
    /// Deliberately does NOT hand out the stored fd: the watchlist owns it
    /// and `flush_evictions` closes it concurrently, so a reader would hit
    /// `EBADF`/`EISDIR` after the mutex is released (watch-many-dirs.test.ts)
    /// or read the stale pre-rename inode after an atomic save. Reloads open
    /// the file by path; `Watcher::add_file` adopts the fresh descriptor.
    pub fn snapshot_package_json(
        &self,
        hash: bun_watcher::HashType,
    ) -> Option<&'static bun_watcher::PackageJSON> {
        let w = match self {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => w,
            ImportWatcher::None => return None,
        };
        let _guard = w.mutex.lock_guard();
        let index = w.index_of(hash)?;
        w.watchlist
            .items::<"package_json", Option<&'static bun_watcher::PackageJSON>>()[index as usize]
    }

    #[inline]
    pub fn add_file_by_path_slow(&mut self, file_path: &[u8]) -> bool {
        match self {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => w.add_file_by_path_slow(file_path),
            ImportWatcher::None => true,
        }
    }

    #[inline]
    pub fn add_file<const COPY_FILE_PATH: bool>(
        &mut self,
        fd: Fd,
        file_path: &[u8],
        hash: bun_watcher::HashType,
        dir_fd: Fd,
        // Note: bun_watcher::PackageJSON is an opaque forward-decl;
        // callers cast from `&bun_resolver::PackageJSON`.
        package_json: Option<&'static bun_watcher::PackageJSON>,
    ) -> bun_sys::Result<bun_watcher::FdOwnership> {
        match self {
            ImportWatcher::Hot(watcher) | ImportWatcher::Watch(watcher) => {
                watcher.add_file::<COPY_FILE_PATH>(fd, file_path, hash, dir_fd, package_json)
            }
            ImportWatcher::None => Ok(bun_watcher::FdOwnership::Caller),
        }
    }
}

pub type HotReloader = NewHotReloader<VirtualMachine, EventLoop, false>;
pub type WatchReloader = NewHotReloader<VirtualMachine, EventLoop, true>;

impl HotReloaderCtx for VirtualMachine {
    type EventLoop = EventLoop;

    fn reload_handle(&self) -> Option<crate::VmHandle> {
        Some(self.handle())
    }

    fn bun_watcher_mut(&mut self) -> &mut Watcher {
        // `VirtualMachine.bun_watcher` is the
        // `*mut ImportWatcher` (see the field comment in
        // VirtualMachine.rs), and `get_context` only runs after
        // `enable_hot_module_reloading` has populated it, so the `.None` arm
        // is unreachable.
        // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set by
        // `enable_hot_module_reloading`; non-null whenever the reloader is
        // running. The cast recovers the concrete type the field was erased to.
        match unsafe { &mut *self.bun_watcher.cast::<ImportWatcher>() } {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => &mut **w,
            ImportWatcher::None => unreachable!("bun_watcher_mut on un-enabled reloader"),
        }
    }

    fn reload(&mut self, _task: &mut dyn HotReloadTaskView) {
        // The inherent `reload` ignores its task argument, so pass `None`
        // rather than threading the dyn view through.
        VirtualMachine::reload(self, None);
    }

    fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        VirtualMachine::bust_dir_cache(self, path)
    }

    fn get_loaders(&self) -> &bun_ast::LoaderHashTable {
        &self.transpiler.options.loaders
    }

    fn log_level_at_least_info(&self) -> bool {
        // Note `Level.atLeast` is `self <= other` (Verbose=0..Err=4), so this is
        // true for Verbose/Debug/Info — i.e. "verbose enough to print info".
        self.log_ref()
            .map(|l| l.level.at_least(bun_ast::Level::Info))
            .unwrap_or(false)
    }

    fn is_watcher_enabled(&self) -> bool {
        // The field is a typed `*mut ImportWatcher`; a null pointer means no
        // watcher is installed.
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
        let mut iw = Box::new(if reload_immediately {
            ImportWatcher::Watch(watcher)
        } else {
            ImportWatcher::Hot(watcher)
        });
        let watcher_ptr: *mut Watcher = match &mut *iw {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => &raw mut **w,
            ImportWatcher::None => unreachable!(),
        };
        self.bun_watcher = bun_core::heap::into_raw(iw);

        // Wire the resolver's directory-watch callback at the same time.
        // `Watcher::get_resolve_watcher` erases the `*mut Watcher` into the
        // resolver's `AnyResolveWatcher` vtable (re-exported from
        // `bun_watcher`, so it's the same type).
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

/// The concrete `HotReloadTask` instance the JS event loop dispatches.
/// The dyn trait below is the type-erased view used by
/// `HotReloaderCtx::reload`.
pub type HotReloadTask = Task<VirtualMachine, EventLoop, false>;
/// `bun run --watch` reload routed through the event loop (only when
/// `--watch-kill-signal` listeners exist; see `Task::enqueue`).
pub type WatchReloadTask = Task<VirtualMachine, EventLoop, true>;

/// Trait bound on `Ctx` exposing the operations the reloader needs.
/// Implemented by `VirtualMachine` and `bun.bake.DevServer`.
pub trait HotReloaderCtx {
    type EventLoop;

    /// The handle the watcher thread posts reload tasks through (captured
    /// once at reloader init, on the owning thread). `None` for contexts that
    /// reload the whole process before ever enqueueing (`bun build --watch`).
    fn reload_handle(&self) -> Option<crate::VmHandle>;

    /// Implementor returns the live `Watcher` regardless of how it's stored.
    fn bun_watcher_mut(&mut self) -> &mut Watcher;

    /// Called from `Task::run` to perform the actual reload. The const-generic
    /// task is erased via the `HotReloadTaskView` so this trait isn't
    /// recursively generic.
    fn reload(&mut self, task: &mut dyn HotReloadTaskView);

    /// Returns whether anything was busted.
    fn bust_dir_cache(&mut self, path: &[u8]) -> bool;

    /// `&transpiler.options.loaders`.
    fn get_loaders(&self) -> &bun_ast::LoaderHashTable;

    fn log_level_at_least_info(&self) -> bool {
        false
    }

    // ── enable_hot_module_reloading accessors ────────────────────────────
    // The methods below expose just enough surface for the generic body.

    fn is_watcher_enabled(&self) -> bool;

    /// The watcher only consumes the project root path.
    fn watcher_top_level_dir(&self) -> &'static [u8];

    /// Installs the watcher and wires the resolver's watch callback.
    /// Returns the now-installed `*mut Watcher` so the caller can `start()` it.
    fn install_bun_watcher(
        &mut self,
        watcher: Box<Watcher>,
        reload_immediately: bool,
    ) -> *mut Watcher;

    fn compute_clear_screen(&self) -> bool;
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
/// Set by `ChangedFilesFilter` on the main thread before the watcher thread
/// starts; after that point only the watcher thread touches it. Its
/// contents are written to `watch_changed_trigger_file` immediately
/// before `reload_process`; the new process reads and deletes that file.
// Written once on main thread before watcher thread starts, then
// watcher-thread-only. `OnceLock` carries the publish.
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
// SAFETY: `&WatchChangedPaths` is shared via `OnceLock`, but the only mutating
// access (`get_mut`) is confined to the watcher thread after the init-once
// publish, so no two threads ever hold `&mut StringSet` concurrently.
unsafe impl Sync for WatchChangedPaths {}

/// Absolute path of the temp file `flush_changed_paths_for_reload` writes
/// the changed-path list into. The same path is exported via the
/// `BUN_INTERNAL_TEST_CHANGED_TRIGGER_FILE` env var so the restarted
/// process can find it. Set alongside `WATCH_CHANGED_PATHS` by
/// `ChangedFilesFilter`; the string must outlive the process.
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

unsafe extern "C" {
    safe fn BunDebugger__willHotReload();
}

// Rust can't put a static in a generic impl, so HotReloader and WatchReloader
// share this. That is fine in practice: the flag is derived from the same CLI
// clear-screen setting and written only during single-threaded reloader init,
// before the watcher thread starts.
static CLEAR_SCREEN: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

pub struct NewHotReloader<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool> {
    /// BACKREF to the owning context (Bundler / VM transpiler store) that
    /// created this reloader. Set once at init and never reassigned; the
    /// context outlives the reloader (and every `Task` it spawns).
    pub ctx: bun_ptr::BackRef<Ctx, bun_ptr::Mut>,
    pub(crate) verbose: bool,
    pub(crate) pending_count: AtomicU32,

    pub(crate) main: MainFile,

    #[cfg(not(windows))]
    pub(crate) tombstones: StringHashMap<*mut Fs::EntriesOption>,

    /// See [`HotReloaderCtx::reload_handle`].
    pub(crate) reload_handle: Option<crate::VmHandle>,

    _event_loop: PhantomData<*mut EventLoopType>,
}

pub struct MainFile {
    /// Includes a trailing "/"
    // `'static` is the API contract of `enable_hot_module_reloading`
    // (`entry_path: Option<&'static [u8]>`): the entry path is owned by the
    // Ctx, which outlives the leaked Reloader for the process lifetime.
    pub(crate) dir: &'static [u8],
    pub(crate) dir_hash: bun_watcher::HashType,

    pub file: &'static [u8],
    pub(crate) hash: bun_watcher::HashType,

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
    pub(crate) is_waiting_for_dir_change: bool,
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
    pub(crate) fn init(file: &'static [u8]) -> MainFile {
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
    pub(crate) count: u8,
    pub(crate) hashes: [u32; 8],
    // Only meaningful for the DevServer Ctx, but Rust can't branch a field
    // type on a generic parameter without specialization, so it is stored
    // unconditionally (8 fat pointers of overhead for non-DevServer Ctx).
    pub(crate) paths: [&'static [u8]; 8],
    /// Left `None` until [`Self::enqueue`] populates it on the heap copy.
    pub(crate) concurrent_task: Option<ConcurrentTask>,
    pub(crate) reloader: *mut NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>,
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool>
    Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
{
    pub(crate) fn init_empty(
        reloader: *mut NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>,
    ) -> Self {
        Self {
            reloader,
            hashes: [0u32; 8],
            // See the `paths` field comment for why this is unconditional.
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

    pub(crate) fn append(&mut self, id: u32) {
        if self.count == 8 {
            self.enqueue();
            self.count = 0;
        }

        self.hashes[self.count as usize] = id;
        self.count += 1;
    }

    /// The dispatched task was heap-allocated in [`Self::enqueue`] via
    /// `heap::alloc`; the event loop calls this after `run()` to free it.
    ///
    /// # Safety
    /// `this` must have been created via `heap::alloc` in [`Self::enqueue`]
    /// and must not be used after this call.
    pub unsafe fn deinit(this: *mut Self) {
        // SAFETY: precondition — `this` came from heap::alloc in `enqueue`.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool> bun_event_loop::Taskable
    for Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
{
    const TAG: bun_event_loop::TaskTag = if RELOAD_IMMEDIATELY {
        task_tag::WatchReloadTask
    } else {
        task_tag::HotReloadTask
    };
    /// A file change the watcher thread posted that will not reload anything.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box `enqueue` posted.
        unsafe { Self::deinit(this) }
    }
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool>
    Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
{
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

    pub(crate) fn enqueue(&mut self) {
        crate::mark_binding!();
        if self.count == 0 {
            return;
        }

        // With --watch-kill-signal listeners registered, reload via the event
        // loop so the JS thread emits them before execve (node runs the child's
        // handlers on kill); otherwise execve immediately (node's default kill).
        if RELOAD_IMMEDIATELY && !crate::posix_signal_handle::watch_kill_signal_has_listeners() {
            crate::node_compile_cache::persist_now();
            Output::flush();
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
            let concurrent = (*that).concurrent_task.insert(ConcurrentTask {
                task: JscTask::init(that),
                ..Default::default()
            });
            // `&that.concurrent_task` is an interior pointer into the
            // Box-allocated Task. `RELOAD_IMMEDIATELY` already diverged above, so
            // a handle is always present here.
            // Field-only access to avoid forming a whole-struct `&NewHotReloader`
            // (see `Self::pending_count` doc).
            let handle = (*core::ptr::addr_of!((*self.reloader).reload_handle))
                .as_ref()
                .expect("reload_handle set for a reloader that enqueues");
            if let crate::vm_handle::Posted::Refused(_) = handle.post(
                crate::LoopKind::Regular,
                core::ptr::NonNull::from(concurrent),
            ) {
                // VM torn down while a change was pending: drop the reload task.
                Self::deinit(that);
            }
        }
        self.count = 0;

        // The JS thread emits kill-signal listeners then execve; if it's stuck in sync code it
        // never drains the posted task. Arm a one-shot timer that forces the reload after a
        // bounded window (node's watcher SIGKILLs an unresponsive child after its grace period).
        if RELOAD_IMMEDIATELY {
            arm_watch_reload_grace_timer();
        }
    }
}

static WATCH_RELOAD_GRACE_ARMED: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

fn arm_watch_reload_grace_timer() {
    if WATCH_RELOAD_GRACE_ARMED.load(core::sync::atomic::Ordering::Relaxed) {
        return;
    }
    let reload_started = bun_core::is_process_reload_in_progress_on_another_thread;
    let handler_running = crate::posix_signal_handle::is_emitting_watch_kill_signal;
    let force = || -> ! {
        // Same as the sibling reload paths: execve never reaches on_exit, so
        // flush the compile cache first (safe off the JS thread; generation
        // runs on its own worker VM).
        crate::node_compile_cache::persist_now();
        Output::flush();
        bun_core::reload_process(
            CLEAR_SCREEN.load(core::sync::atomic::Ordering::Relaxed),
            false,
        );
        unreachable!();
    };
    let spawned = std::thread::Builder::new()
        .name("WatchReloadGrace".into())
        .spawn(move || {
            // `force()` clears the terminal through this thread's `Output`
            // writers; they are zeroed until the thread is configured.
            Output::Source::configure_thread_no_js();
            const STEP_MS: u64 = 10;
            // Budget to drain the posted WatchReloadTask; extended once when
            // the kill-signal emit is observed so a bounded synchronous
            // handler has time to finish before being torn down mid-run.
            const DRAIN_MS: u64 = 500;
            const HANDLER_MS: u64 = 2000;
            let mut deadline = DRAIN_MS;
            let mut extended = false;
            let mut waited = 0u64;
            while waited < deadline {
                if reload_started() {
                    // execve prep has begun; park until it tears this thread down.
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(3600));
                    }
                }
                if !extended && handler_running() {
                    deadline = waited + HANDLER_MS;
                    extended = true;
                }
                std::thread::sleep(std::time::Duration::from_millis(STEP_MS));
                waited += STEP_MS;
            }
            // Deadline hit without reload_process starting: either the task
            // never drained, or the handler itself is wedged. Force it (node
            // SIGKILLs the child after its own grace period either way).
            force();
        })
        .is_ok();
    if spawned {
        WATCH_RELOAD_GRACE_ARMED.store(true, core::sync::atomic::Ordering::Relaxed);
    } else {
        force();
    }
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool>
    NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
{
    fn debug(args: core::fmt::Arguments<'_>) {
        bun_core::pretty_errorln!("<cyan>watcher<r><d>:<r> {}", args);
    }

    /// # Safety
    /// `this` must point to a live `Ctx` (VirtualMachine / DevServer / BundleV2)
    /// that outlives the leaked `NewHotReloader` allocated here — i.e. for the
    /// process lifetime.
    pub unsafe fn enable_hot_module_reloading(this: *mut Ctx, entry_path: Option<&'static [u8]>) {
        // SAFETY: precondition — `this` is the live owning `Ctx`; it outlives
        // the reloader allocated below. Borrows are scoped per access.
        if unsafe { (*this).is_watcher_enabled() } {
            return;
        }

        let reloader = bun_core::heap::into_raw(Box::new(Self {
            // SAFETY: `this` is the live owning context; it outlives the reloader.
            ctx: unsafe { bun_ptr::BackRef::from_raw_mut(this) },
            // SAFETY: see above.
            verbose: unsafe { (*this).log_level_at_least_info() },
            pending_count: AtomicU32::new(0),
            main: MainFile::init(entry_path.unwrap_or(b"")),
            #[cfg(not(windows))]
            tombstones: StringHashMap::default(),
            // SAFETY: see above.
            reload_handle: unsafe { (*this).reload_handle() },
            _event_loop: PhantomData,
        }));

        // SAFETY: see above; `watcher_top_level_dir` returns `&'static [u8]`.
        let watcher = match Watcher::init(reloader, unsafe { (*this).watcher_top_level_dir() }) {
            Ok(w) => w,
            Err(err) => {
                bun_core::handle_error_return_trace(&err);
                Output::panic(format_args!(
                    "Failed to enable File Watcher: {}",
                    err.name()
                ));
            }
        };

        // SAFETY: see above.
        let watcher_ptr = unsafe { (*this).install_bun_watcher(watcher, RELOAD_IMMEDIATELY) };

        // SAFETY: single-threaded init; watcher thread not yet started.
        CLEAR_SCREEN.store(
            // SAFETY: see above.
            unsafe { (*this).compute_clear_screen() },
            core::sync::atomic::Ordering::Relaxed,
        );

        // SAFETY: `watcher_ptr` was just installed into the ctx and is live.
        if let Err(err) = unsafe { (*watcher_ptr).start() } {
            bun_core::handle_error_return_trace(&err);
            bun_core::pretty_errorln!(
                "<red>error<r><d>:<r> Failed to start File Watcher: {}",
                err.name()
            );
            Output::flush();
            bun_core::Global::exit(1);
        }
    }

    #[cfg(not(windows))]
    fn put_tombstone(&mut self, key: &[u8], value: *mut Fs::EntriesOption) {
        self.tombstones.put(key, value).expect("unreachable");
    }

    #[cfg(not(windows))]
    fn get_tombstone(&mut self, key: &[u8]) -> Option<*mut Fs::EntriesOption> {
        self.tombstones.get(key).copied()
    }

    pub(crate) fn on_error(_: &mut Self, err: &bun_sys::Error) {
        // `bun_sys::Error::name()` does the errno→tag-name lookup.
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

    pub(crate) fn get_context(&mut self) -> &mut Watcher {
        self.ctx_mut().bun_watcher_mut()
    }

    #[inline(never)]
    pub(crate) fn on_file_update(
        &mut self,
        events: &mut [bun_watcher::WatchEvent],
        changed_files: &[ChangedFilePath],
        watchlist: &bun_watcher::WatchList,
    ) {
        let slice = watchlist.slice();
        let file_paths = slice.items_file_path();
        // Note: `WatchItemColumns` doesn't expose a `count` accessor; reach
        // through the generic SoA column directly. The loop below mutates the
        // column in place — build the &mut from the raw column pointer rather
        // than ref-casting `&[u32]` (which is UB).
        // SAFETY: column `Count` is `u32`; `items_raw` yields a pointer valid
        // for `slice.len()` elements; the watcher thread is the sole writer of
        // this column for the loop's duration and no other `&` to it is live.
        let counts: &mut [u32] =
            unsafe { bun_core::ffi::slice_mut(slice.items_raw::<"count", u32>(), slice.len()) };
        let kinds = slice.items_kind();
        let hashes = slice.items_hash();
        let parents = slice.items_parent_hash();
        let file_descriptors = slice.items_fd();
        // Note: reshaped for borrowck — `ctx` is held as a raw pointer so
        // `self` can be reborrowed inside the loop body for tombstone access,
        // and so the deferred `flush_evictions` doesn't hold `&mut Watcher`
        // across the loop.
        let ctx: *mut Watcher = std::ptr::from_mut(self.get_context());
        // Wrap the Task itself in a guard so any exit path (including future
        // early-returns) flushes the buffered hashes via `enqueue()`.
        // Dereferenced as `&mut *current_task` for the loop body below.
        //
        // Note: declared *before* `_flush` so `flush_evictions()` runs
        // **before** `enqueue()` on drop. The reverse order opens a window
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
        // See the note above for why this drops *before* `current_task`.
        let _flush = scopeguard::guard(ctx, |ctx| {
            Output::flush();
            // SAFETY: the Watcher outlives this call (it owns the Reloader that calls us).
            unsafe { (*ctx).flush_evictions() };
        });
        let fs: &mut FileSystem = FileSystem::instance();
        let rfs: &mut Fs::file_system::RealFS = &mut fs.fs;
        #[cfg(windows)]
        let _ = (changed_files, parents, file_descriptors, rfs);
        let mut _on_file_update_path_buf = bun_paths::path_buffer_pool::get();

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
                        // SAFETY: the Watcher outlives this call (it owns the
                        // Reloader that calls us); `remove_at_index::<false>`
                        // only buffers the eviction, and the borrow is scoped
                        // to this call so it never overlaps the watchlist
                        // column slices above.
                        unsafe {
                            (*ctx).remove_at_index::<false>(
                                bun_watcher::Kind::File,
                                event.index,
                                0,
                                &[],
                            )
                        };
                    }

                    if self.verbose {
                        Self::debug(format_args!(
                            "File changed: {}",
                            // Note: `fs.relative_to(file_path)` would borrow `&*fs`
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

                        // Note: the affected-name element type differs by
                        // platform (kqueue vs inotify). Split into two locals;
                        // only one is populated per cfg.
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
                                        // `.is_ok()` only checks faccessat didn't
                                        // error (it errs only on NAMETOOLONG), not
                                        // that the file exists; harmless in
                                        // practice (re-watching a missing
                                        // entrypoint is a no-op downstream).
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
                                            // bun_sys::access takes a &ZStr; build one on the
                                            // stack from the &[u8] watch-list slice.
                                            let was_deleted = {
                                                let mut zbuf = bun_paths::path_buffer_pool::get();
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
                        if !IS_KQUEUE && self.main.hash != 0 && self.main.dir_hash == current_hash {
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
                                    let mut zbuf = bun_paths::path_buffer_pool::get();
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
                            // both outlive this loop iteration. Shared access only —
                            // `entries()` takes `&self` and per-entry mutation below goes
                            // through the entry's own mutex + cells.
                            let dir_ent = unsafe { &*dir_ent };
                            let mut last_file_hash: bun_watcher::HashType =
                                bun_watcher::HashType::MAX;

                            for i in 0..affected_len {
                                let changed_name: &[u8] = if IS_KQUEUE {
                                    affected_kqueue[i]
                                } else {
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
                                // Note: the post-assignment `_ = prev_entry_id`
                                // below documents the intentional dead store.
                                let mut prev_entry_id: usize = usize::MAX;
                                if loader != bun_ast::Loader::File {
                                    // Both arms of `'brk` assign these before
                                    // any read.
                                    let path_string: bun_ptr::Interned;
                                    let file_hash: bun_watcher::HashType;
                                    let abs_path: &[u8] = 'brk: {
                                        // Probe `.data` under `entries_mutex`; a
                                        // resolver at a newer generation rewrites
                                        // the map in place under that lock. The
                                        // entry pointer stays valid after unlock
                                        // (EntryStore-owned).
                                        let looked_up = {
                                            let _entries_lock = rfs.entries_mutex.lock_guard();
                                            dir_ent.entries().get(changed_name)
                                        };
                                        if let Some(file_ent) = looked_up {
                                            // reset the file descriptor
                                            let ent = file_ent.entry();
                                            {
                                                // Every cached-`Entry` rewrite takes
                                                // the per-entry mutex.
                                                let _entry_guard = ent.mutex.lock_guard();
                                                ent.set_cache_fd(Fd::INVALID);
                                                ent.need_stat.store(
                                                    true,
                                                    core::sync::atomic::Ordering::Release,
                                                );
                                            }
                                            path_string = ent.abs_path;
                                            file_hash = Watcher::get_hash(path_string.as_bytes());
                                            for (entry_id, hash) in hashes.iter().enumerate() {
                                                if *hash == file_hash {
                                                    if file_descriptors[entry_id].is_valid() {
                                                        if prev_entry_id != entry_id {
                                                            record_changed_path(
                                                                path_string.as_bytes(),
                                                            );
                                                            current_task.append(hashes[entry_id]);
                                                            if self.verbose {
                                                                Self::debug(format_args!(
                                                                    "Removing file: {}",
                                                                    bstr::BStr::new(
                                                                        path_string.as_bytes()
                                                                    )
                                                                ));
                                                            }
                                                            // SAFETY: see the
                                                            // File-arm call
                                                            // above.
                                                            unsafe {
                                                                (*ctx).remove_at_index::<false>(
                                                                    bun_watcher::Kind::File,
                                                                    entry_id as u16,
                                                                    0,
                                                                    &[],
                                                                )
                                                            };
                                                        }
                                                    }

                                                    prev_entry_id = entry_id;
                                                    _ = prev_entry_id;
                                                    break;
                                                }
                                            }

                                            break 'brk path_string.as_bytes();
                                        } else {
                                            let file_path_without_trailing_slash =
                                                strings::trim_right(file_path, &[SEP]);
                                            _on_file_update_path_buf
                                                [0..file_path_without_trailing_slash.len()]
                                                .copy_from_slice(file_path_without_trailing_slash);
                                            _on_file_update_path_buf
                                                [file_path_without_trailing_slash.len()] = SEP;

                                            // The separator written at index `len` is
                                            // immediately overwritten by the
                                            // `changed_name` copy, and the slice takes
                                            // one stale byte past the copy. Deliberate:
                                            // changing it would change the resulting
                                            // path hash.
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
        // the note on `current_task` above for why this order matters.
    }
}

/// `Watcher::init` stores the `NewHotReloader` as its opaque context and
/// dispatches file-change/error callbacks through this trait.
impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool> bun_watcher::WatcherContext
    for NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
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
        Self::on_error(self, &err);
    }
}

// ── `bun build --watch` (Ctx = BundleV2) ─────────────────────────────────
// `RELOAD_IMMEDIATELY = true` means the watcher thread `execve()`s on the
// first change (Task::enqueue diverges), so `event_loop()` / `reload()` are
// never reached. The bundler crate (T5) can't name this generic, so it calls
// in via the `#[no_mangle]` hook below.

impl<'a> HotReloaderCtx for bun_bundler::BundleV2<'a> {
    type EventLoop = bun_event_loop::AnyEventLoop;

    fn reload_handle(&self) -> Option<crate::VmHandle> {
        // RELOAD_IMMEDIATELY=true, and BundleV2 never has watch-kill-signal
        // listeners: `Task::enqueue` re-execs the process before it would post.
        None
    }

    fn bun_watcher_mut(&mut self) -> &mut Watcher {
        let handle = self
            .bun_watcher
            .expect("bun_watcher_mut on un-enabled BundleV2 reloader");
        // SAFETY: `Box<Watcher>` leaked via `into_raw` in `install_bun_watcher`;
        // live for the process (BundleV2 is leaked under --watch — see
        // `generate_from_cli`).
        unsafe { &mut *handle.as_ptr() }
    }

    fn reload(&mut self, _task: &mut dyn HotReloadTaskView) {
        // RELOAD_IMMEDIATELY=true never enqueues `Task::run` for BundleV2
        // (diverges or kill-signal branch; no listeners registered there).
        unreachable!()
    }

    fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        bun_bundler::BundleV2::bust_dir_cache(self, path)
    }

    fn get_loaders(&self) -> &bun_ast::LoaderHashTable {
        &self.transpiler.options.loaders
    }

    fn log_level_at_least_info(&self) -> bool {
        // BundleV2 has no `log` field (the log is on `transpiler`), so `false`.
        false
    }

    fn is_watcher_enabled(&self) -> bool {
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

/// `'static` because the only caller (`bun build --watch`)
/// allocates the transpiler from the process-lifetime CLI arena.
type BundlerWatcher =
    NewHotReloader<bun_bundler::BundleV2<'static>, bun_event_loop::AnyEventLoop, true>;

/// CYCLEBREAK extern hook: called from `BundleV2::init` (T5) when
/// `cli_watch_flag` is set. Defined here (not in
/// `bun_bundler`) because the bundler crate can't name `NewHotReloader`.
#[unsafe(no_mangle)]
fn __bun_jsc_enable_hot_module_reloading_for_bundler(
    bv2: core::ptr::NonNull<bun_bundler::BundleV2<'static>>,
) {
    // SAFETY: `bv2` is the `&mut *Box<BundleV2<'static>>` formed in
    // `BundleV2::init`; the lifetime is `'static` for the only caller (build
    // command leaks the CLI arena), and the box is leaked under --watch.
    unsafe { BundlerWatcher::enable_hot_module_reloading(bv2.as_ptr(), None) };
}
