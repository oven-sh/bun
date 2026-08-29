use core::marker::PhantomData;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

#[cfg(not(windows))]
use bun_collections::StringHashMap;
use bun_collections::StringSet;
use bun_core::Output;
use bun_core::ZStr;
#[cfg(not(windows))]
use bun_paths::SEP;
use bun_paths::strings;
use bun_paths::{self, PathBuffer};
use bun_ptr::ThreadBound;
#[cfg(not(windows))]
use bun_resolver::fs::PathName;
use bun_resolver::fs::{self as Fs, FileSystem};
use bun_sys::{self, Fd};
#[cfg(not(windows))]
use bun_watcher::ChangedFilePath;
use bun_watcher::WatchItemColumns as _;
use bun_watcher::{Op as WatchOp, Watcher};

use crate::event_loop::EventLoop;
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

    fn post_reload_task<const RELOAD_IMMEDIATELY: bool>(
        handle: &crate::VmHandle,
        task: Box<Task<Self, EventLoop, RELOAD_IMMEDIATELY>>,
    ) {
        handle.post_boxed(crate::LoopKind::Regular, task);
    }

    fn reload(&self, _task: &dyn HotReloadTaskView) {
        // The inherent `reload` ignores its task argument, so pass `None`
        // rather than threading the dyn view through.
        VirtualMachine::reload(self.as_mut(), None);
    }

    fn bust_dir_cache(&self, path: &[u8]) -> bool {
        VirtualMachine::bust_dir_cache(self.as_mut(), path)
    }

    fn loaders(&self) -> &bun_ast::LoaderHashTable {
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
        // `install_bun_watcher` only ever installs `Hot`/`Watch`, so a
        // non-null pointer is an enabled watcher.
        !self.bun_watcher_ptr().is_null()
    }

    fn watcher_top_level_dir(&self) -> &'static [u8] {
        self.top_level_dir()
    }

    fn install_bun_watcher(
        &mut self,
        watcher: Box<Watcher>,
        reload_immediately: bool,
    ) -> &mut Watcher {
        // Leaked: the watcher (and this enum around it) live for the process.
        let import_watcher: &'static mut ImportWatcher =
            Box::leak(Box::new(if reload_immediately {
                ImportWatcher::Watch(watcher)
            } else {
                ImportWatcher::Hot(watcher)
            }));
        self.bun_watcher = core::ptr::from_mut(import_watcher);
        let watcher = match import_watcher {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => &mut **w,
            ImportWatcher::None => unreachable!(),
        };
        // Wire the resolver's directory-watch callback at the same time.
        self.transpiler.resolver.watcher = Some(watcher.get_resolve_watcher());
        watcher
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
/// Implemented by `VirtualMachine` and `bun_bundler::BundleV2`.
///
/// The watcher thread never touches the `Ctx`: everything it needs is copied
/// in [`NewHotReloader::enable_hot_module_reloading`] (on the owning thread),
/// and `reload` / `bust_dir_cache` run on the owning thread from the posted
/// [`Task`].
pub trait HotReloaderCtx: Sized + 'static {
    type EventLoop;

    /// The handle the watcher thread posts reload tasks through (captured
    /// once at reloader init, on the owning thread). `None` for contexts that
    /// reload the whole process before ever enqueueing (`bun build --watch`).
    fn reload_handle(&self) -> Option<crate::VmHandle>;

    /// Watcher thread: queue `task` on the owning thread through `handle`
    /// (from [`reload_handle`](Self::reload_handle)); it is dropped unrun if
    /// the owner is already closed. Only contexts with a handle are ever asked.
    fn post_reload_task<const RELOAD_IMMEDIATELY: bool>(
        handle: &crate::VmHandle,
        task: Box<Task<Self, Self::EventLoop, RELOAD_IMMEDIATELY>>,
    );

    /// Called from `Task::run` (owning thread) to perform the actual reload.
    /// The const-generic task is erased via the `HotReloadTaskView` so this
    /// trait isn't recursively generic.
    fn reload(&self, task: &dyn HotReloadTaskView);

    /// Called from `Task::run` (owning thread) for each directory the watcher
    /// saw change. Returns whether anything was busted.
    fn bust_dir_cache(&self, path: &[u8]) -> bool;

    /// `&transpiler.options.loaders`; snapshotted at init for the watcher
    /// thread's extension → loader lookups.
    fn loaders(&self) -> &bun_ast::LoaderHashTable;

    fn log_level_at_least_info(&self) -> bool {
        false
    }

    // ── enable_hot_module_reloading accessors ────────────────────────────
    // The methods below expose just enough surface for the generic body.

    fn is_watcher_enabled(&self) -> bool;

    /// The watcher only consumes the project root path.
    fn watcher_top_level_dir(&self) -> &'static [u8];

    /// Installs the watcher and wires the resolver's watch callback.
    /// Returns the now-installed watcher so the caller can `start()` it.
    fn install_bun_watcher(
        &mut self,
        watcher: Box<Watcher>,
        reload_immediately: bool,
    ) -> &mut Watcher;

    fn compute_clear_screen(&self) -> bool;
}

/// Type-erased view of a `Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>` so
/// `HotReloaderCtx::reload` doesn't need to name the const generics.
pub trait HotReloadTaskView {
    fn count(&self) -> u8;
    fn hashes(&self) -> &[u32];
}

impl<Ctx: HotReloaderCtx, EventLoopType, const RELOAD_IMMEDIATELY: bool> HotReloadTaskView
    for Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
{
    fn count(&self) -> u8 {
        self.count
    }
    fn hashes(&self) -> &[u32] {
        &self.hashes[..self.count as usize]
    }
}

/// When set, `on_file_update` records the absolute path of every file
/// it sees change before triggering a reload. Used by `bun test --changed
/// --watch` so the restarted process can narrow its changed-file set to
/// what the watcher actually observed (instead of re-querying git, which
/// would re-run every test affected by any uncommitted change, not just
/// the one that was just edited).
///
/// Set by `ChangedFilesFilter` on the main thread before the watcher thread
/// starts; after that point only the watcher thread uses it (the set itself
/// is behind a mutex). Its contents are written to
/// `WATCH_CHANGED_TRIGGER_FILE` immediately before `reload_process`; the new
/// process reads and deletes that file.
pub static WATCH_CHANGED_PATHS: std::sync::OnceLock<WatchChangedPaths> = std::sync::OnceLock::new();

/// The set behind [`WATCH_CHANGED_PATHS`]. Written by the watcher thread,
/// read back on the same thread right before the process is replaced.
pub struct WatchChangedPaths(bun_threading::Guarded<StringSet>);
impl WatchChangedPaths {
    #[inline]
    pub fn new(set: StringSet) -> Self {
        Self(bun_threading::Guarded::new(set))
    }
}

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
    bun_core::handle_oom(set.0.lock().insert(path));
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
        let set = set.0.lock();
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

/// The watcher thread's half of hot reloading: owned by the [`Watcher`] as its
/// [`bun_watcher::WatcherHandler`], it turns file-change batches into
/// [`Task`]s posted to the owning thread.
pub struct NewHotReloader<Ctx: HotReloaderCtx, EventLoopType, const RELOAD_IMMEDIATELY: bool> {
    /// The owning context (VM / bundler); carried into each [`Task`] and only
    /// followed there, on the owning thread. The context outlives the
    /// reloader (both live for the process).
    ctx: ThreadBound<Ctx>,
    pub(crate) verbose: bool,
    /// Reloads and directory busts posted and not yet run; shared with every
    /// [`Task`].
    pending: Arc<Pending>,

    pub(crate) main: MainFile,

    /// `Ctx::loaders()` as of init.
    #[cfg(not(windows))]
    loaders: bun_ast::LoaderHashTable,

    /// Directory-entry slots seen for a directory, kept so later kqueue events
    /// for it can still map changed names after the resolver evicted the slot
    /// from its index. The slots are process-lifetime BSS storage.
    #[cfg(not(windows))]
    pub(crate) tombstones: StringHashMap<bun_ptr::BackRef<Fs::EntriesOption>>,

    /// See [`HotReloaderCtx::reload_handle`].
    pub(crate) reload_handle: Option<crate::VmHandle>,

    _event_loop: PhantomData<fn() -> EventLoopType>,
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

/// What the watcher thread has handed the owning thread and it has not yet
/// consumed. Whichever [`Task`] runs first takes all of it, so a later task
/// finding nothing left is a no-op (reloads and busts coalesce alike).
struct Pending {
    /// Reloads posted and not yet run.
    count: AtomicU32,
    /// Directories whose resolver caches to bust before the next reload.
    dirs: bun_threading::Guarded<Vec<Box<[u8]>>>,
}

/// One batch of changes for the owning thread: the hashes of changed watched
/// files (a reload if any). Built on the watcher thread, posted boxed, run and
/// dropped on the owning thread, where it first drains [`Pending::dirs`].
pub struct Task<Ctx: HotReloaderCtx, EventLoopType, const RELOAD_IMMEDIATELY: bool> {
    pub(crate) count: u8,
    pub(crate) hashes: [u32; 8],
    /// Directories that changed in this batch; moved to [`Pending::dirs`] on enqueue.
    dirs: Vec<Box<[u8]>>,
    ctx: ThreadBound<Ctx>,
    pending: Arc<Pending>,
    _event_loop: PhantomData<fn() -> EventLoopType>,
}

// SAFETY: the only task type for `task_tag::WatchReloadTask` /
// `task_tag::HotReloadTask` (one per `RELOAD_IMMEDIATELY`); only the VM's
// tasks are ever queued (`bun build --watch` has no loop) and the carrier owns
// the box (`VmHandle::post_boxed`). A task released unrun or refused is a file
// change that will not reload anything: dropping it is all there is to do.
unsafe impl<const RELOAD_IMMEDIATELY: bool> bun_event_loop::BoxedTask
    for Task<VirtualMachine, EventLoop, RELOAD_IMMEDIATELY>
{
    const TAG: bun_event_loop::TaskTag = if RELOAD_IMMEDIATELY {
        task_tag::WatchReloadTask
    } else {
        task_tag::HotReloadTask
    };
    fn run(self: Box<Self>) -> bun_event_loop::JsResult<()> {
        Task::run(self);
        Ok(())
    }
    fn release_unrun(self: Box<Self>) {}
    fn refused(self: Box<Self>) {}
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool>
    Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
{
    fn new(reloader: &NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>) -> Self {
        Self {
            count: 0,
            hashes: [0u32; 8],
            dirs: Vec::new(),
            ctx: reloader.ctx.clone(),
            pending: Arc::clone(&reloader.pending),
            _event_loop: PhantomData,
        }
    }

    /// Whether [`run`](Self::run) reloads (the dispatcher then leaves the
    /// tick early without draining microtasks) or only busts directory caches.
    pub fn reloads(&self) -> bool {
        self.count > 0
    }

    /// Owning thread: bust the pending directory caches, then reload if this
    /// batch carries changed files.
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub fn run(self: Box<Self>) {
        let ctx = self.ctx.get();
        let dirs = core::mem::take(&mut *self.pending.dirs.lock());
        for dir in &dirs {
            let _ = ctx.bust_dir_cache(dir);
        }
        if self.count == 0 {
            return;
        }
        // Since we rely on the event loop for hot reloads, there can be
        // a delay before the next reload begins. In the time between the
        // last reload and the next one, we shouldn't schedule any more
        // hot reloads. Since we reload literally everything, we don't
        // need to worry about missing any changes.
        //
        // Note that we set the count _before_ we reload, so that if we
        // get another hot reload request while we're reloading, we'll
        // still enqueue it.
        while self.pending.count.swap(0, Ordering::Relaxed) > 0 {
            ctx.reload(&*self);
        }
    }

    pub(crate) fn append(
        &mut self,
        reloader: &NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>,
        id: u32,
    ) {
        if self.count == 8 {
            self.enqueue(reloader);
            self.count = 0;
        }

        self.hashes[self.count as usize] = id;
        self.count += 1;
    }

    fn bust_dir(&mut self, path: &[u8]) {
        self.dirs.push(path.into());
    }

    /// Watcher thread: post what this batch collected (if anything) to the
    /// owning thread, leaving `self` empty.
    pub(crate) fn enqueue(
        &mut self,
        reloader: &NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>,
    ) {
        crate::mark_binding!();
        if self.count == 0 && self.dirs.is_empty() {
            return;
        }

        if self.count > 0 {
            // With --watch-kill-signal listeners registered, reload via the event
            // loop so the JS thread emits them before execve (node runs the child's
            // handlers on kill); otherwise execve immediately (node's default kill).
            if RELOAD_IMMEDIATELY && !crate::posix_signal_handle::watch_kill_signal_has_listeners()
            {
                crate::node_compile_cache::persist_now();
                Output::flush();
                flush_changed_paths_for_reload();
                bun_core::reload_process(
                    CLEAR_SCREEN.load(core::sync::atomic::Ordering::Relaxed),
                    false,
                );
                unreachable!();
            }

            self.pending.count.fetch_add(1, Ordering::Relaxed);

            BunDebugger__willHotReload();
        }
        let reloads = self.count > 0;
        // `bun build --watch` has no loop to post to; it only ever reaches
        // here for directory busts, which its idle process has no use for.
        if let Some(handle) = &reloader.reload_handle {
            self.pending.dirs.lock().append(&mut self.dirs);
            let task = Box::new(Self {
                count: self.count,
                hashes: self.hashes,
                dirs: Vec::new(),
                ctx: self.ctx.clone(),
                pending: Arc::clone(&self.pending),
                _event_loop: PhantomData,
            });
            Ctx::post_reload_task(handle, task);
        }
        self.dirs.clear();

        // The JS thread emits kill-signal listeners then execve; if it's stuck in sync code it
        // never drains the posted task. Arm a one-shot timer that forces the reload after a
        // bounded window (node's watcher SIGKILLs an unresponsive child after its grace period).
        if RELOAD_IMMEDIATELY && reloads {
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

impl<Ctx, EventLoopType: 'static, const RELOAD_IMMEDIATELY: bool>
    NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
{
    fn debug(args: core::fmt::Arguments<'_>) {
        bun_core::pretty_errorln!("<cyan>watcher<r><d>:<r> {}", args);
    }

    /// Owning thread. `this` (VirtualMachine / BundleV2) lives for the
    /// process, as do the watcher and reloader started here.
    pub fn enable_hot_module_reloading(this: &mut Ctx, entry_path: Option<&'static [u8]>) {
        if this.is_watcher_enabled() {
            return;
        }

        let reloader = Box::new(Self {
            ctx: ThreadBound::new(this),
            verbose: this.log_level_at_least_info(),
            pending: Arc::new(Pending {
                count: AtomicU32::new(0),
                dirs: bun_threading::Guarded::new(Vec::new()),
            }),
            main: MainFile::init(entry_path.unwrap_or(b"")),
            #[cfg(not(windows))]
            loaders: bun_core::handle_oom(this.loaders().clone()),
            #[cfg(not(windows))]
            tombstones: StringHashMap::default(),
            reload_handle: this.reload_handle(),
            _event_loop: PhantomData,
        });

        let watcher = match Watcher::init_with_handler(reloader, this.watcher_top_level_dir()) {
            Ok(w) => w,
            Err(err) => {
                bun_core::handle_error_return_trace(&err);
                Output::panic(format_args!(
                    "Failed to enable File Watcher: {}",
                    err.name()
                ));
            }
        };

        let clear_screen = this.compute_clear_screen();
        let watcher = this.install_bun_watcher(watcher, RELOAD_IMMEDIATELY);

        // Single-threaded init; watcher thread not yet started.
        CLEAR_SCREEN.store(clear_screen, core::sync::atomic::Ordering::Relaxed);

        if let Err(err) = watcher.start() {
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
    fn put_tombstone(&mut self, key: &[u8], value: bun_ptr::BackRef<Fs::EntriesOption>) {
        self.tombstones.put(key, value).expect("unreachable");
    }

    #[cfg(not(windows))]
    fn get_tombstone(&mut self, key: &[u8]) -> Option<bun_ptr::BackRef<Fs::EntriesOption>> {
        self.tombstones.get(key).copied()
    }

    pub(crate) fn on_error(_: &mut Self, err: &bun_sys::Error) {
        // `bun_sys::Error::name()` does the errno→tag-name lookup.
        Output::err(err.name(), "Watcher crashed", ());
        if cfg!(debug_assertions) {
            panic!("Watcher crash");
        }
    }

    #[inline(never)]
    pub(crate) fn on_file_update(&mut self, batch: &mut bun_watcher::FileUpdateBatch<'_>) {
        // `Slice` is a by-value set of column pointers into the watchlist;
        // evictions below are only buffered (`remove_at_index::<false>`) and
        // applied by `flush_evictions` after the loop, so the columns stay put.
        let slice = batch.watcher().watchlist.slice();
        let mut counts = slice;
        let counts = counts.items_mut::<"count", u32>();
        let file_paths = slice.items_file_path();
        let kinds = slice.items_kind();
        let hashes = slice.items_hash();
        let parents = slice.items_parent_hash();
        let file_descriptors = slice.items_fd();
        let event_count = batch.events().len();
        let mut current_task = Task::<Ctx, EventLoopType, RELOAD_IMMEDIATELY>::new(self);
        let fs: &mut FileSystem = FileSystem::instance();
        let rfs: &mut Fs::file_system::RealFS = &mut fs.fs;
        #[cfg(windows)]
        let _ = (parents, file_descriptors, rfs);
        let mut _on_file_update_path_buf = PathBuffer::uninit();

        for event_i in 0..event_count {
            let event = batch.events()[event_i];
            // Stale udata: kevent.udata can outlive a swapRemove in flushEvictions.
            if event.index as usize >= file_paths.len() {
                continue;
            }
            let file_path: &[u8] = &file_paths[event.index as usize];
            counts[event.index as usize] += 1;
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
                        batch.watcher_mut().remove_at_index::<false>(
                            bun_watcher::Kind::File,
                            event.index,
                            0,
                            &[],
                        );
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

                        current_task.append(self, current_hash);
                    }
                }
                bun_watcher::Kind::Directory => {
                    #[cfg(windows)]
                    {
                        // on windows we receive file events for all items affected by a directory change
                        // so we only need to clear the directory cache. all other effects will be handled
                        // by the file events
                        current_task.bust_dir(strings::paths::without_trailing_slash_windows_path(
                            file_path,
                        ));
                        continue;
                    }
                    #[cfg(not(windows))]
                    {
                        let mut affected_buf: [&[u8]; 128] = [b"".as_slice(); 128];
                        // inotify names live in the watcher's event buffer; copied
                        // out so the watcher can be borrowed for evictions below.
                        let mut names_buf: [ChangedFilePath; bun_watcher::MAX_COUNT] =
                            [None; bun_watcher::MAX_COUNT];
                        let mut entries_option: Option<bun_ptr::BackRef<Fs::EntriesOption>> = None;

                        // Note: the affected-name element type differs by
                        // platform (kqueue vs inotify). Split into two locals;
                        // only one is populated per cfg.
                        let mut affected_kqueue: &[&[u8]] = &[];
                        let mut affected_inotify: &[ChangedFilePath] = &[];
                        let _ = (&mut affected_kqueue, &mut affected_inotify);

                        let affected_len: usize = 'brk: {
                            if IS_KQUEUE {
                                if let Some(existing) = rfs.entries.get(file_path) {
                                    let existing = bun_ptr::BackRef::new(existing);
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
                                            current_task.append(self, self.main.hash);
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
                                                let mut zbuf = PathBuffer::uninit();
                                                if affected_path.len() >= zbuf.len() {
                                                    false
                                                } else {
                                                    zbuf[..affected_path.len()]
                                                        .copy_from_slice(affected_path);
                                                    zbuf[affected_path.len()] = 0;
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

                            let names = event.names(batch.changed_files());
                            names_buf[..names.len()].copy_from_slice(names);
                            affected_inotify = &names_buf[..names.len()];
                            break 'brk affected_inotify.len();
                        };

                        if affected_len > 0 && !IS_KQUEUE {
                            if let Some(existing) = rfs.entries.get(file_path) {
                                let existing = bun_ptr::BackRef::new(existing);
                                self.put_tombstone(file_path, existing);
                                entries_option = Some(existing);
                            } else if let Some(existing) = self.get_tombstone(file_path) {
                                entries_option = Some(existing);
                            }
                        }

                        current_task.bust_dir(strings::paths::without_trailing_slash_windows_path(
                            file_path,
                        ));

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
                                    let mut zbuf = PathBuffer::uninit();
                                    if self.main.file.len() >= zbuf.len() {
                                        false
                                    } else {
                                        zbuf[..self.main.file.len()]
                                            .copy_from_slice(self.main.file);
                                        zbuf[self.main.file.len()] = 0;
                                        let z = ZStr::from_buf(&zbuf[..], self.main.file.len());
                                        bun_sys::access(z, libc::F_OK).is_ok()
                                    }
                                };
                                if main_exists {
                                    record_changed_path(self.main.file);
                                    current_task.append(self, self.main.hash);
                                }
                                break;
                            }
                        }

                        if let Some(dir_ent) = entries_option {
                            // Shared access only — `entries()` takes `&self` and
                            // per-entry mutation below goes through the entry's
                            // own mutex + cells.
                            let dir_ent: &Fs::EntriesOption = dir_ent.get();
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

                                let loader = self
                                    .loaders
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
                                            if let Some(entry_id) =
                                                hashes.iter().position(|hash| *hash == file_hash)
                                            {
                                                if file_descriptors[entry_id].is_valid() {
                                                    if prev_entry_id != entry_id {
                                                        record_changed_path(path_string.as_bytes());
                                                        current_task.append(self, hashes[entry_id]);
                                                        if self.verbose {
                                                            Self::debug(format_args!(
                                                                "Removing file: {}",
                                                                bstr::BStr::new(
                                                                    path_string.as_bytes()
                                                                )
                                                            ));
                                                        }
                                                        batch
                                                            .watcher_mut()
                                                            .remove_at_index::<false>(
                                                                bun_watcher::Kind::File,
                                                                entry_id as u16,
                                                                0,
                                                                &[],
                                                            );
                                                    }
                                                }

                                                prev_entry_id = entry_id;
                                                _ = prev_entry_id;
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

        // Evict *before* enqueueing. The reverse order opens a window where the
        // JS thread can pick up the task, look the file up in the watchlist,
        // and read the cached fd while this thread is still about to `close()`
        // + `swap_remove()` it in `flush_evictions` — surfacing as
        // `EBADF`/`EISDIR reading "<path>"` in hot.test.ts under load. Evicting
        // first is side-effect-free: `enqueue` carries hashes (not indices) and
        // never reads the watchlist.
        Output::flush();
        batch.watcher_mut().flush_evictions();
        current_task.enqueue(self);
    }
}

/// `Watcher::init_with_handler` owns the `NewHotReloader` and dispatches
/// file-change/error callbacks (watcher thread) through this trait.
impl<Ctx, EventLoopType: 'static, const RELOAD_IMMEDIATELY: bool> bun_watcher::WatcherHandler
    for NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
    Self: Send,
{
    fn on_file_update(&mut self, batch: &mut bun_watcher::FileUpdateBatch<'_>) {
        Self::on_file_update(self, batch);
    }

    fn on_error(&mut self, err: bun_sys::Error) {
        Self::on_error(self, &err);
    }
}

// ── `bun build --watch` (Ctx = BundleV2) ─────────────────────────────────
// `RELOAD_IMMEDIATELY = true` means the watcher thread `execve()`s on the
// first file change (Task::enqueue diverges) and there is no loop to post
// directory busts to, so `reload()` / `bust_dir_cache()` are never reached.
// The bundler crate (T5) can't name this generic, so it calls in via the
// `extern "Rust"` hook below.

impl HotReloaderCtx for bun_bundler::BundleV2<'static> {
    type EventLoop = bun_event_loop::AnyEventLoop;

    fn reload_handle(&self) -> Option<crate::VmHandle> {
        // RELOAD_IMMEDIATELY=true, and BundleV2 never has watch-kill-signal
        // listeners: `Task::enqueue` re-execs the process before it would post.
        None
    }

    fn post_reload_task<const RELOAD_IMMEDIATELY: bool>(
        _handle: &crate::VmHandle,
        _task: Box<Task<Self, Self::EventLoop, RELOAD_IMMEDIATELY>>,
    ) {
        // No handle (see `reload_handle`), so never asked.
        unreachable!()
    }

    fn reload(&self, _task: &dyn HotReloadTaskView) {
        // No handle, so no task ever runs for BundleV2.
        unreachable!()
    }

    fn bust_dir_cache(&self, _path: &[u8]) -> bool {
        // No handle, so no task ever runs for BundleV2.
        unreachable!()
    }

    fn loaders(&self) -> &bun_ast::LoaderHashTable {
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
    ) -> &mut Watcher {
        // Leaked: live for the process (BundleV2 is leaked under --watch — see
        // `generate_from_cli`).
        let watcher: &'static mut Watcher = Box::leak(watcher);
        self.bun_watcher = Some(core::ptr::NonNull::from(&mut *watcher));
        self.transpiler.resolver.watcher = Some(watcher.get_resolve_watcher());
        watcher
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

/// CYCLEBREAK hook: called from `BundleV2::init` (T5) when `cli_watch_flag`
/// is set. Defined here (not in `bun_bundler`) because the bundler crate
/// can't name `NewHotReloader`.
// HOST_EXPORT(__bun_jsc_enable_hot_module_reloading_for_bundler, rust)
pub fn enable_hot_module_reloading_for_bundler(bv2: &'static mut bun_bundler::BundleV2<'static>) {
    BundlerWatcher::enable_hot_module_reloading(bv2, None);
}
