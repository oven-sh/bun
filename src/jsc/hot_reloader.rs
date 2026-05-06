#![allow(unused_imports, unused_variables, dead_code, unreachable_code, unused_mut)]

use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_collections::{StringHashMap, StringSet};
use bun_core::{self as core_, Output};
use bun_resolver::fs::{self as Fs, FileSystem, PathName};
use bun_paths::{self, PathBuffer, SEP, SEP_STR};
use bun_resolver::__phase_a_body::ResolveWatcher;
use bun_string::{strings, ZStr};
use bun_sys::{self, Fd};
use bun_watcher::{ChangedFilePath, Op as WatchOp, WatchItemColumns, WatchItemField, Watcher};

use bun_event_loop::task_tag;
use crate::{MarkedArrayBuffer, Task as JscTask};
use crate::event_loop::{ConcurrentTaskItem as ConcurrentTask, EventLoop};
use crate::virtual_machine::VirtualMachine;

#[allow(non_upper_case_globals)]
bun_core::declare_scope!(hot_reloader, visible);

// TODO(port): Environment.isKqueue — verify exact target list matches Zig's `Environment.isKqueue`
const IS_KQUEUE: bool = cfg!(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "tvos",
    target_os = "watchos",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "dragonfly",
));

pub enum ImportWatcher {
    None,
    Hot(Box<Watcher>),
    Watch(Box<Watcher>),
}

impl ImportWatcher {
    pub fn start(&mut self) -> Result<(), bun_core::Error> {
         // TODO(b2-blocked): bun_watcher::Watcher::start
        {
            // TODO(port): narrow error set
            match self {
                ImportWatcher::Hot(w) => return w.start(),
                ImportWatcher::Watch(w) => return w.start(),
                ImportWatcher::None => return Ok(()),
            }
        }
        Ok(())
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
         // TODO(b2-blocked): bun_watcher::Watcher::index_of
        match self {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => return w.index_of(hash),
            ImportWatcher::None => {}
        }
        let _ = hash;
        None
    }

    #[inline]
    pub fn add_file_by_path_slow(
        &mut self,
        file_path: &[u8],
        loader: bun_bundler::options::Loader,
    ) -> bool {
        // PORT NOTE: bun_watcher::Loader is an opaque newtype over u8 (CYCLEBREAK);
        // wrap the bun_options_types::Loader discriminant.
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
        loader: bun_bundler::options::Loader,
        dir_fd: Fd,
        // PORT NOTE: bun_watcher::PackageJSON is an opaque forward-decl (CYCLEBREAK);
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
    fn get_loaders(&self) -> &bun_bundler::options::LoaderHashTable;

    /// Zig: `if (comptime Ctx == ImportWatcher) ... ctx.rare_data.?.closeAllListenSocketsForWatchMode()`.
    /// Default no-op; `VirtualMachine` overrides.
    fn close_all_listen_sockets_for_watch_mode(&mut self) {}

    /// Zig: `if (@hasField(Ctx, "log")) this.log.level.atLeast(.info) else false`.
    fn log_level_at_least_info(&self) -> bool {
        false
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
// TODO(port): lifetime — Zig was `?*bun.StringSet`; written once on main thread
// before watcher thread starts, then watcher-thread-only. `static mut` mirrors that.
pub static mut WATCH_CHANGED_PATHS: Option<*mut StringSet> = None;

/// Absolute path of the temp file `flush_changed_paths_for_reload` writes
/// the changed-path list into. The same path is exported via the
/// `BUN_INTERNAL_TEST_CHANGED_TRIGGER_FILE` env var so the restarted
/// process can find it. Set alongside `WATCH_CHANGED_PATHS` by
/// `test_command.zig`; the string must outlive the process.
pub static mut WATCH_CHANGED_TRIGGER_FILE: Option<&'static ZStr> = None;

#[allow(static_mut_refs)]
fn record_changed_path(path: &[u8]) {
    // SAFETY: see doc on WATCH_CHANGED_PATHS — single-writer after init.
    let Some(set) = (unsafe { WATCH_CHANGED_PATHS }) else {
        return;
    };
    if path.is_empty() {
        return;
    }
     // TODO(b2-blocked): bun_collections::StringSet::insert
    {
        // SAFETY: pointer set once by test_command before watcher thread starts;
        // only watcher thread reaches here.
        unsafe { (*set).insert(path) };
    }
    let _ = set;
}

/// Write the recorded changed paths to the trigger file so the next
/// process (after exec()) can consume them. Best-effort: if the write
/// fails, the new process falls back to querying git.
#[allow(static_mut_refs)]
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
        // SAFETY: see doc on WATCH_CHANGED_PATHS — single-writer after init.
        let Some(set) = (unsafe { WATCH_CHANGED_PATHS }) else {
            return;
        };
        let Some(dest) = (unsafe { WATCH_CHANGED_TRIGGER_FILE }) else {
            return;
        };
        // SAFETY: same single-writer invariant as above.
        let set = unsafe { &*set };
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
         // TODO(b2-blocked): bun_sys::File::write_file
        {
            let _ = bun_sys::File::write_file(Fd::cwd(), dest, &buf);
        }
        let _ = (dest, &buf);
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn BunDebugger__willHotReload();
}

// TODO(port): in Zig this was a `pub var` inside the generic struct, giving one
// static per monomorphization. Rust can't put a static in a generic impl; both
// HotReloader and WatchReloader now share this. Revisit if the per-type split
// was load-bearing.
static mut CLEAR_SCREEN: bool = false;

pub struct NewHotReloader<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool> {
    pub ctx: *mut Ctx,
    pub verbose: bool,
    pub pending_count: AtomicU32,

    pub main: MainFile,

    // TODO(b2-blocked): bun_resolver::fs::real_fs::EntriesOption — type path unconfirmed.
    // Stored as `*mut c_void` until the EntriesOption type is exported with a stable path.
    pub tombstones: StringHashMap<*mut core::ffi::c_void>,

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
         // TODO(b2-blocked): bun_watcher::Watcher::get_hash, bun_paths::dirname, bun_core::is_slice_in_buffer
        {
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

        return main;
        } // end 
        MainFile {
            file,
            ..Default::default()
        }
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
    /// Left uninitialized until .enqueue
    pub concurrent_task: MaybeUninit<ConcurrentTask>,
    pub reloader: *mut NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>,
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool>
    Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
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
            concurrent_task: MaybeUninit::uninit(),
        }
    }

    pub fn append(&mut self, id: u32) {
        if self.count == 8 {
            self.enqueue();
            self.count = 0;
        }

        self.hashes[self.count as usize] = id;
        self.count += 1;
    }

    /// Spec: hot_reloader.zig `Task.deinit`. The task is a fixed-size buffer
    /// owned by the reloader (not heap-allocated per dispatch), so this only
    /// clears `count`; the next `append` reuses the slot.
    pub fn deinit(&mut self) {
        self.count = 0;
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
        // SAFETY: reloader outlives every Task it creates (BACKREF).
        let reloader = unsafe { &mut *self.reloader };
        while reloader.pending_count.swap(0, Ordering::Relaxed) > 0 {
            // SAFETY: ctx outlives reloader (BACKREF).
            unsafe { (*reloader.ctx).reload(self) };
        }
    }

    pub fn enqueue(&mut self) {
        crate::mark_binding!();
        if self.count == 0 {
            return;
        }

         // TODO(b2-blocked): bun_core::{Output::flush, reload_process}, crate::{ConcurrentTask, Task::init, NewHotReloader::enqueue_task_concurrent}
        {
        if RELOAD_IMMEDIATELY {
            Output::flush();
            // TODO(port): `if (comptime Ctx == ImportWatcher)` — Rust cannot
            // compare a generic type parameter to a concrete type. The Zig
            // branch closed listen sockets via `ctx.rare_data` when Ctx is
            // ImportWatcher. Phase B: express via a trait method with a
            // default no-op impl.
            // if Ctx == ImportWatcher {
            //     if let Some(rare) = unsafe { (*(*self.reloader).ctx).rare_data } {
            //         rare.close_all_listen_sockets_for_watch_mode();
            //     }
            // }
            flush_changed_paths_for_reload();
            // SAFETY: CLEAR_SCREEN is only mutated during single-threaded init.
            bun_core::reload_process(unsafe { CLEAR_SCREEN }, false);
            unreachable!();
        }

        // SAFETY: reloader outlives every Task it creates (BACKREF).
        let reloader = unsafe { &mut *self.reloader };
        reloader.pending_count.fetch_add(1, Ordering::Relaxed);

        // SAFETY: extern "C" fn with no preconditions.
        unsafe { BunDebugger__willHotReload() };
        let that = Box::into_raw(Box::new(Self {
            reloader: self.reloader,
            count: self.count,
            paths: self.paths,
            hashes: self.hashes,
            concurrent_task: MaybeUninit::uninit(),
        }));
        // SAFETY: `that` was just allocated above and is exclusively owned here.
        unsafe {
            // PORT NOTE: `JscTask::init` requires `Taskable`, but const-generic
            // `Task<Ctx, _, _>` can't implement it (one tag per monomorphization).
            // The Zig source tagged the concrete `HotReloader.HotReloadTask` —
            // use the raw `(tag, ptr)` constructor.
            (*that).concurrent_task.write(ConcurrentTask {
                task: JscTask::new(task_tag::HotReloadTask, that as *mut ()),
                ..Default::default()
            });
            // TODO(port): `&that.concurrent_task` is an interior pointer into a
            // Box-allocated Task; event loop must not outlive `that`. Matches Zig.
            (*self.reloader)
                .enqueue_task_concurrent((*that).concurrent_task.assume_init_mut() as *mut _);
        }
        } // end 
        self.count = 0;
    }

    /// # Safety
    /// `this` must have been created via `Box::into_raw` in [`Self::enqueue`] and
    /// must not be used after this call.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: precondition — `this` came from Box::into_raw in `enqueue`.
        drop(unsafe { Box::from_raw(this) });
    }
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool>
    NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
where
    Ctx: HotReloaderCtx<EventLoop = EventLoopType>,
{
    pub fn init(
        ctx: *mut Ctx,
        fs: &'static FileSystem,
        verbose: bool,
        clear_screen_flag: bool,
    ) -> Box<Watcher> {
        let reloader = Box::into_raw(Box::new(Self {
            ctx,
            verbose: cfg!(feature = "debug_logs") || verbose,
            pending_count: AtomicU32::new(0),
            main: MainFile::default(),
            tombstones: StringHashMap::default(),
            _event_loop: PhantomData,
        }));

        // SAFETY: single-threaded init; watcher thread not yet started.
        unsafe { CLEAR_SCREEN = clear_screen_flag };
        // PORT NOTE: bun_watcher::FileSystem is a CYCLEBREAK forward-decl carrying only
        // `top_level_dir`; bridge from the resolver's full FileSystem here.
        let watcher_fs: &'static bun_watcher::FileSystem =
            Box::leak(Box::new(bun_watcher::FileSystem { top_level_dir: fs.top_level_dir }));
        let mut watcher = match Watcher::init(reloader, watcher_fs) {
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
            Output::panic(format_args!(
                "Failed to start File Watcher: {}",
                err.name()
            ));
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
        // SAFETY: ctx outlives reloader (BACKREF).
        unsafe { (*self.ctx).event_loop() }
    }

    pub fn enqueue_task_concurrent(&self, task: *mut ConcurrentTask) {
        if RELOAD_IMMEDIATELY {
            unreachable!();
        }

        // TODO(b2-blocked): EventLoopType::enqueue_task_concurrent — needs a trait
        // bound on `EventLoopType` (only concrete instantiation is `EventLoop`).
        let _ = task;
        todo!("blocked_on: EventLoopType::enqueue_task_concurrent trait bound");
    }

    pub fn enable_hot_module_reloading(this: *mut Ctx, entry_path: Option<&'static [u8]>) {
        // TODO(b2-blocked): Zig's `enableHotModuleReloading` reaches into
        // `ctx.bun_watcher` and `ctx.transpiler.{fs, env, resolver.watcher}`
        // by structural duck-typing — Rust needs `HotReloaderCtx` to expose
        // those as trait accessors before this body can compile generically.
        // The transcribed body is preserved in git history; restore once the
        // trait surface lands.
        let _ = (this, entry_path);
        todo!("blocked_on: HotReloaderCtx::{{bun_watcher, transpiler}} accessors");
    }

    fn put_tombstone(
        &mut self,
        key: &[u8],
        value: *mut core::ffi::c_void,
    ) {
         // TODO(b2-blocked): bun_collections::StringHashMap::put
        {
            self.tombstones.put(key, value).expect("unreachable");
        }
        let _ = (key, value);
    }

    fn get_tombstone(
        &mut self,
        key: &[u8],
    ) -> Option<*mut core::ffi::c_void> {
        self.tombstones.get(key).copied()
    }

    pub fn on_error(_: &mut Self, err: bun_sys::Error) {
        // TODO(port): Zig passed `@as(bun.sys.E, @enumFromInt(err.errno))` as
        // the error name. `bun_sys::E::from_raw` is private and `ErrName` isn't
        // yet impl'd for `bun_sys::Error`; fall back to a fixed label until the
        // sys-side ErrName impl lands.
        let _ = err.errno;
        Output::err("WatcherError", "Watcher crashed", ());
        if cfg!(debug_assertions) {
            panic!("Watcher crash");
        }
    }

    pub fn get_context(&mut self) -> &mut Watcher {
        // PORT NOTE: Zig branched three ways on `@TypeOf(this.ctx.bun_watcher)`
        // (ImportWatcher / Option / bare). Folded into `HotReloaderCtx::bun_watcher_mut`;
        // each impl picks the right unwrap.
        // SAFETY: ctx outlives reloader (BACKREF).
        unsafe { (*self.ctx).bun_watcher_mut() }
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
        // (`counts[index] = update_count`) — cast away const to match.
        // SAFETY: column 4 (`Count`) is `u32`; the watcher thread is the sole
        // writer of this column for the loop's duration.
        let counts: &mut [u32] = unsafe {
            &mut *(slice.items::<u32>(WatchItemField::Count) as *const [u32] as *mut [u32])
        };
        let kinds = slice.items_kind();
        let hashes = slice.items_hash();
        let parents = slice.items_parent_hash();
        let file_descriptors = slice.items_fd();
        // PORT NOTE: reshaped for borrowck — `ctx` is held as a raw pointer so
        // `self` can be reborrowed inside the loop body for tombstone access,
        // and so the deferred `flush_evictions` doesn't hold `&mut Watcher`
        // across the loop.
        let ctx: *mut Watcher = self.get_context() as *mut _;
        // `defer ctx.flushEvictions(); defer Output.flush();` — Zig defers run LIFO,
        // so Output.flush() fires first, then ctx.flushEvictions().
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
        let mut current_task = Task::<Ctx, EventLoopType, RELOAD_IMMEDIATELY>::init_empty(self);
        let _enqueue = scopeguard::guard((), |_| {
            // TODO(port): errdefer — current_task is borrowed mutably below; this
            // closure cannot also borrow it. Phase B: restructure to call
            // `current_task.enqueue()` at every exit point, or wrap Task itself
            // in the guard.
        });

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
                            // TODO(port): Zig used `fs.relativeTo(file_path)`; resolver's
                            // inline `fs::FileSystem` doesn't expose `relative_to` yet.
                            bstr::BStr::new(bun_paths::relative(fs.top_level_dir, file_path))
                        ));
                    }

                    if event.op.intersects(WatchOp::WRITE | WatchOp::DELETE | WatchOp::RENAME) {
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
                            if self.main.is_waiting_for_dir_change
                                && self.main.hash == current_hash
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
                        // SAFETY: ctx outlives reloader (BACKREF).
                        let _ = unsafe {
                            (*self.ctx)
                                .bust_dir_cache(strings::paths::without_trailing_slash_windows_path(
                                    file_path,
                                ))
                        };
                        continue;
                    }
                    #[cfg(not(windows))]
                    {
                        let mut affected_buf: [&[u8]; 128] =
                            [b"".as_slice(); 128];
                        let mut entries_option: Option<
                            *mut Fs::file_system::real_fs::EntriesOption,
                        > = None;

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
                                    let existing =
                                        existing as *mut Fs::EntriesOption as *mut core::ffi::c_void;
                                    self.put_tombstone(file_path, existing);
                                    entries_option = Some(existing as *mut Fs::EntriesOption);
                                } else if let Some(existing) = self.get_tombstone(file_path) {
                                    entries_option = Some(existing as *mut Fs::EntriesOption);
                                }

                                if event.op.contains(WatchOp::WRITE) {
                                    // Check if the entrypoint now exists after an atomic save.
                                    // If we previously got a NOTE_RENAME on the entrypoint (vim renamed
                                    // the file), this directory write event signals that the new
                                    // file has been re-created. Verify it exists and trigger reload.
                                    if self.main.is_waiting_for_dir_change
                                        && self.main.dir_hash == current_hash
                                    {
                                        // TODO(port): bun_sys::faccessat takes &ZStr but
                                        // basename() returns &[u8]; build a stack ZStr.
                                        let mut name_buf = [0u8; 256];
                                        let basename = bun_paths::basename(self.main.file);
                                        let exists = if basename.len() < name_buf.len() {
                                            name_buf[..basename.len()].copy_from_slice(basename);
                                            name_buf[basename.len()] = 0;
                                            // SAFETY: name_buf[..=basename.len()] is NUL-terminated.
                                            let z = unsafe {
                                                ZStr::from_raw(name_buf.as_ptr(), basename.len())
                                            };
                                            matches!(
                                                bun_sys::faccessat(
                                                    file_descriptors[event.index as usize],
                                                    z,
                                                ),
                                                Ok(true)
                                            )
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
                                            // TODO(port): std.posix.access → bun_sys::access
                                            // wants &ZStr; affected_path is &[u8]. Build a
                                            // PathBuffer-backed ZStr.
                                            let was_deleted = {
                                                let mut zbuf = PathBuffer::uninit();
                                                if affected_path.len() >= zbuf.len() {
                                                    false
                                                } else {
                                                    zbuf[..affected_path.len()]
                                                        .copy_from_slice(affected_path);
                                                    zbuf[affected_path.len()] = 0;
                                                    // SAFETY: zbuf is NUL-terminated at len.
                                                    let z = unsafe {
                                                        ZStr::from_raw(
                                                            zbuf.as_ptr(),
                                                            affected_path.len(),
                                                        )
                                                    };
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
                                let existing =
                                    existing as *mut Fs::EntriesOption as *mut core::ffi::c_void;
                                self.put_tombstone(file_path, existing);
                                entries_option = Some(existing as *mut Fs::EntriesOption);
                            } else if let Some(existing) = self.get_tombstone(file_path) {
                                entries_option = Some(existing as *mut Fs::EntriesOption);
                            }
                        }

                        // SAFETY: ctx outlives reloader (BACKREF).
                        let _ = unsafe {
                            (*self.ctx).bust_dir_cache(
                                strings::paths::without_trailing_slash_windows_path(file_path),
                            )
                        };

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
                                    // TODO(port): `bun.asByteSlice(changed_name_.?)`
                                    affected_inotify[i].as_ref().unwrap().as_bytes()
                                };
                                if changed_name.is_empty()
                                    || changed_name[0] == b'~'
                                    || changed_name[0] == b'.'
                                {
                                    continue;
                                }

                                // SAFETY: ctx outlives reloader (BACKREF).
                                let loader = unsafe { (*self.ctx).get_loaders() }
                                    .get(PathName::find_extname(changed_name))
                                    .copied()
                                    .unwrap_or(bun_bundler::options::Loader::File);
                                let mut prev_entry_id: usize = usize::MAX;
                                if loader != bun_bundler::options::Loader::File {
                                    let mut path_string: bun_string::PathString =
                                        Default::default();
                                    let mut file_hash: bun_watcher::HashType = last_file_hash;
                                    let abs_path: &[u8] = 'brk: {
                                        if let Some(file_ent) =
                                            dir_ent.entries().get(changed_name)
                                        {
                                            // reset the file descriptor
                                            // SAFETY: hot-reload runs on the JS thread holding
                                            // the entries mutex; no other live &Entry alias.
                                            unsafe {
                                                (*(*file_ent.entry).cache.get()).fd = Fd::INVALID;
                                                (*file_ent.entry).need_stat.set(true);
                                                path_string = (*file_ent.entry).abs_path;
                                            }
                                            file_hash =
                                                Watcher::get_hash(path_string.slice());
                                            for (entry_id, hash) in
                                                hashes.iter().enumerate()
                                            {
                                                if *hash == file_hash {
                                                    if file_descriptors[entry_id].is_valid() {
                                                        if prev_entry_id != entry_id {
                                                            record_changed_path(
                                                                path_string.slice(),
                                                            );
                                                            current_task
                                                                .append(hashes[entry_id]);
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
                                                    break;
                                                }
                                            }

                                            break 'brk path_string.slice();
                                        } else {
                                            let file_path_without_trailing_slash =
                                                strings::trim_right(file_path, &[SEP]);
                                            _on_file_update_path_buf
                                                [0..file_path_without_trailing_slash.len()]
                                                .copy_from_slice(
                                                    file_path_without_trailing_slash,
                                                );
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
                                            bstr::BStr::new(bun_paths::relative(
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
                                bstr::BStr::new(bun_paths::relative(fs.top_level_dir, file_path)),
                                affected_len
                            ));
                        }
                    }
                }
            }
        }

        // `defer current_task.enqueue();`
        current_task.enqueue();
        // _flush guard handles `Output::flush()` then `ctx.flush_evictions()` on drop (LIFO).
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
{
    fn on_file_update(
        &mut self,
        events: &mut [bun_watcher::WatchEvent],
        changed_files: &[bun_watcher::ChangedFilePath],
        watchlist: &bun_watcher::WatchList,
    ) {
        Self::on_file_update(self, events, changed_files, watchlist);
    }

    fn on_watch_error(&mut self, err: bun_sys::Error) {
        Self::on_error(self, err);
    }
}

pub use crate::MarkedArrayBuffer as Buffer;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/hot_reloader.zig (616 lines)
//   confidence: medium
//   todos:      18
//   notes:      heavy comptime reflection (@TypeOf/@hasField on Ctx) — Phase B needs a HotReloaderCtx trait; per-monomorphization static `clear_screen` collapsed to module static; `affected` slice element type is platform-divergent so split into two locals; possible off-by-one in path-buf copy ported verbatim
// ──────────────────────────────────────────────────────────────────────────
