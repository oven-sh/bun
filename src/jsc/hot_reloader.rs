use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_collections::{StringHashMap, StringSet};
use bun_core::{self as core_, Output};
use bun_fs::{self as Fs, FileSystem, PathName};
use bun_jsc::{ConcurrentTask, EventLoop, MarkedArrayBuffer, Task as JscTask, VirtualMachine};
use bun_paths::{self, PathBuffer, SEP, SEP_STR};
use bun_str::{strings, ZStr};
use bun_sys::{self, Fd};
use bun_watcher::Watcher;

bun_output::declare_scope!(hot_reloader, visible);

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
        // TODO(port): narrow error set
        match self {
            ImportWatcher::Hot(w) => w.start(),
            ImportWatcher::Watch(w) => w.start(),
            ImportWatcher::None => Ok(()),
        }
    }

    #[inline]
    pub fn watchlist(&self) -> bun_watcher::WatchList {
        match self {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => w.watchlist,
            ImportWatcher::None => bun_watcher::WatchList::default(),
        }
    }

    #[inline]
    pub fn index_of(&self, hash: bun_watcher::HashType) -> Option<u32> {
        match self {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => w.index_of(hash),
            ImportWatcher::None => None,
        }
    }

    #[inline]
    pub fn add_file_by_path_slow(
        &mut self,
        file_path: &[u8],
        loader: bun_bundler::options::Loader,
    ) -> bool {
        match self {
            ImportWatcher::Hot(w) | ImportWatcher::Watch(w) => {
                w.add_file_by_path_slow(file_path, loader)
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
        package_json: Option<&mut bun_resolver::PackageJSON>,
    ) -> bun_sys::Result<()> {
        match self {
            ImportWatcher::Hot(watcher) | ImportWatcher::Watch(watcher) => watcher
                .add_file::<COPY_FILE_PATH>(fd, file_path, hash, loader, dir_fd, package_json),
            ImportWatcher::None => bun_sys::Result::success(),
        }
    }
}

pub type HotReloader = NewHotReloader<VirtualMachine, EventLoop, false>;
pub type WatchReloader = NewHotReloader<VirtualMachine, EventLoop, true>;

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

fn record_changed_path(path: &[u8]) {
    // SAFETY: see doc on WATCH_CHANGED_PATHS — single-writer after init.
    let Some(set) = (unsafe { WATCH_CHANGED_PATHS }) else {
        return;
    };
    if path.is_empty() {
        return;
    }
    // SAFETY: pointer set once by test_command before watcher thread starts;
    // only watcher thread reaches here.
    unsafe { (*set).insert(path) };
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
        let _ = bun_sys::File::write_file(Fd::cwd(), dest, &buf);
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

    pub tombstones: StringHashMap<*mut Fs::file_system::real_fs::EntriesOption>,

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

        if let Some(dir) = bun_paths::dirname(file) {
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
    /// Left uninitialized until .enqueue
    pub concurrent_task: MaybeUninit<ConcurrentTask>,
    pub reloader: *mut NewHotReloader<Ctx, EventLoopType, RELOAD_IMMEDIATELY>,
}

impl<Ctx, EventLoopType, const RELOAD_IMMEDIATELY: bool>
    Task<Ctx, EventLoopType, RELOAD_IMMEDIATELY>
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
            // TODO(port): requires `Ctx: HotReloaderCtx` trait bound for `.reload`
            unsafe { (*reloader.ctx).reload(self) };
        }
    }

    pub fn enqueue(&mut self) {
        bun_jsc::mark_binding!();
        if self.count == 0 {
            return;
        }

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
            (*that)
                .concurrent_task
                .write(ConcurrentTask { task: JscTask::init(that) });
            // TODO(port): `&that.concurrent_task` is an interior pointer into a
            // Box-allocated Task; event loop must not outlive `that`. Matches Zig.
            (*self.reloader)
                .enqueue_task_concurrent((*that).concurrent_task.assume_init_mut() as *mut _);
        }
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
{
    pub fn init(
        ctx: *mut Ctx,
        fs: &mut FileSystem,
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
        let mut watcher = match Watcher::init(reloader, fs) {
            Ok(w) => w,
            Err(err) => {
                bun_core::handle_error_return_trace(&err);
                Output::panic(format_args!(
                    "Failed to enable File Watcher: {}",
                    err.name()
                ));
            }
        };
        if let Err(err) = watcher.start() {
            bun_core::handle_error_return_trace(&err);
            Output::panic(format_args!(
                "Failed to start File Watcher: {}",
                err.name()
            ));
        }
        watcher
    }

    fn debug(args: core::fmt::Arguments<'_>) {
        if cfg!(feature = "debug_logs") {
            bun_output::scoped_log!(hot_reloader, "{}", args);
        } else {
            // TODO(port): Output.prettyErrorln with color tags
            Output::pretty_errorln(format_args!("<cyan>watcher<r><d>:<r> {}", args));
        }
    }

    pub fn event_loop(&self) -> *mut EventLoopType {
        // SAFETY: ctx outlives reloader (BACKREF).
        // TODO(port): requires `Ctx: HotReloaderCtx` trait bound for `.event_loop`
        unsafe { (*self.ctx).event_loop() }
    }

    pub fn enqueue_task_concurrent(&self, task: *mut ConcurrentTask) {
        if RELOAD_IMMEDIATELY {
            unreachable!();
        }

        // SAFETY: event_loop() returns a valid pointer for the lifetime of ctx.
        unsafe { (*self.event_loop()).enqueue_task_concurrent(task) };
    }

    pub fn enable_hot_module_reloading(this: *mut Ctx, entry_path: Option<&'static [u8]>) {
        // SAFETY: caller passes a live Ctx pointer.
        let ctx = unsafe { &mut *this };

        // TODO(port): `@TypeOf(this.bun_watcher) == ImportWatcher` — comptime
        // reflection on a field type. Phase B: express via a `HotReloaderCtx`
        // trait associated type/const (`const WATCHER_IS_IMPORT: bool`) or by
        // splitting this fn per Ctx. The two arms below are both transcribed;
        // pick one at Phase B.
        #[cfg(any())] // disabled: ImportWatcher arm
        {
            if !matches!(ctx.bun_watcher, ImportWatcher::None) {
                return;
            }
        }
        #[cfg(any())] // disabled: Option<Box<Watcher>> arm
        {
            if ctx.bun_watcher.is_some() {
                return;
            }
        }
        // TODO(port): the early-return guard above is required for correctness;
        // currently both arms are cfg'd off pending the trait split.

        let reloader = Box::into_raw(Box::new(Self {
            ctx: this,
            verbose: cfg!(feature = "debug_logs") || {
                // TODO(port): `if (@hasField(Ctx, "log")) this.log.level.atLeast(.info) else false`
                // → trait method with default `false`
                false
            },
            main: MainFile::init(entry_path.unwrap_or(b"")),
            pending_count: AtomicU32::new(0),
            tombstones: StringHashMap::default(),
            _event_loop: PhantomData,
        }));

        // TODO(port): same `@TypeOf == ImportWatcher` split as above.
        #[cfg(any())] // disabled: ImportWatcher arm
        {
            ctx.bun_watcher = if RELOAD_IMMEDIATELY {
                ImportWatcher::Watch(match Watcher::init(reloader, ctx.transpiler.fs) {
                    Ok(w) => w,
                    Err(err) => {
                        bun_core::handle_error_return_trace(&err);
                        Output::panic(format_args!(
                            "Failed to enable File Watcher: {}",
                            err.name()
                        ));
                    }
                })
            } else {
                ImportWatcher::Hot(match Watcher::init(reloader, ctx.transpiler.fs) {
                    Ok(w) => w,
                    Err(err) => {
                        bun_core::handle_error_return_trace(&err);
                        Output::panic(format_args!(
                            "Failed to enable File Watcher: {}",
                            err.name()
                        ));
                    }
                })
            };

            if RELOAD_IMMEDIATELY {
                ctx.transpiler.resolver.watcher =
                    bun_resolver::ResolveWatcher::init_with(
                        match &mut ctx.bun_watcher {
                            ImportWatcher::Watch(w) => &mut **w,
                            _ => unreachable!(),
                        },
                        Watcher::on_maybe_watch_directory,
                    );
            } else {
                ctx.transpiler.resolver.watcher =
                    bun_resolver::ResolveWatcher::init_with(
                        match &mut ctx.bun_watcher {
                            ImportWatcher::Hot(w) => &mut **w,
                            _ => unreachable!(),
                        },
                        Watcher::on_maybe_watch_directory,
                    );
            }
        }
        #[cfg(any())] // disabled: Option<Box<Watcher>> arm
        {
            ctx.bun_watcher = Some(match Watcher::init(reloader, ctx.transpiler.fs) {
                Ok(w) => w,
                Err(err) => {
                    bun_core::handle_error_return_trace(&err);
                    Output::panic(format_args!(
                        "Failed to enable File Watcher: {}",
                        err.name()
                    ));
                }
            });
            ctx.transpiler.resolver.watcher = bun_resolver::ResolveWatcher::init_with(
                &mut **ctx.bun_watcher.as_mut().unwrap(),
                Watcher::on_maybe_watch_directory,
            );
        }

        // SAFETY: single-threaded init; watcher thread not yet started.
        unsafe {
            CLEAR_SCREEN = !ctx
                .transpiler
                .env
                .has_set_no_clear_terminal_on_reload(!Output::enable_ansi_colors_stdout());
        }

        // SAFETY: reloader was just Box::into_raw'd above and is now owned by the watcher.
        unsafe { (*reloader).get_context() }
            .start()
            .expect("Failed to start File Watcher");
    }

    fn put_tombstone(
        &mut self,
        key: &[u8],
        value: *mut Fs::file_system::real_fs::EntriesOption,
    ) {
        self.tombstones.put(key, value).expect("unreachable");
    }

    fn get_tombstone(
        &mut self,
        key: &[u8],
    ) -> Option<*mut Fs::file_system::real_fs::EntriesOption> {
        self.tombstones.get(key)
    }

    pub fn on_error(_: &mut Self, err: bun_sys::Error) {
        // TODO(port): @enumFromInt(err.errno) → bun_sys::E::from_raw
        Output::err(
            bun_sys::E::from_raw(err.errno),
            format_args!("Watcher crashed"),
        );
        if cfg!(debug_assertions) {
            panic!("Watcher crash");
        }
    }

    pub fn get_context(&mut self) -> &mut Watcher {
        // TODO(port): comptime reflection on `@TypeOf(this.ctx.bun_watcher)`.
        // Zig branches three ways: ImportWatcher / Option / bare. Phase B:
        // `HotReloaderCtx::watcher(&mut self) -> &mut Watcher` trait method.
        // SAFETY: ctx outlives reloader (BACKREF).
        unsafe { (*self.ctx).bun_watcher_mut() }
    }

    #[inline(never)]
    pub fn on_file_update(
        &mut self,
        events: &[bun_watcher::WatchEvent],
        changed_files: &mut [Option<&mut ZStr>],
        watchlist: bun_watcher::WatchList,
    ) {
        let slice = watchlist.slice();
        let file_paths = slice.items_file_path();
        let counts = slice.items_count();
        let kinds = slice.items_kind();
        let hashes = slice.items_hash();
        let parents = slice.items_parent_hash();
        let file_descriptors = slice.items_fd();
        let ctx: *mut Watcher = self.get_context() as *mut _;
        // PORT NOTE: reshaped for borrowck — `ctx` is held as a raw pointer so
        // `self` can be reborrowed inside the loop body for tombstone access.
        // SAFETY: the Watcher outlives this call (it owns the Reloader that calls us).
        let ctx = unsafe { &mut *ctx };
        // `defer ctx.flushEvictions(); defer Output.flush();` — Zig defers run LIFO,
        // so Output.flush() fires first, then ctx.flushEvictions().
        let _flush = scopeguard::guard((), |_| {
            Output::flush();
            ctx.flush_evictions();
        });

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

        for event in events {
            // Stale udata: kevent.udata can outlive a swapRemove in flushEvictions.
            if event.index as usize >= file_paths.len() {
                continue;
            }
            let file_path = file_paths[event.index as usize];
            let update_count = counts[event.index as usize] + 1;
            counts[event.index as usize] = update_count;
            let kind = kinds[event.index as usize];

            // so it's consistent with the rest
            // if we use .extname we might run into an issue with whether or not the "." is included.
            // let path = Fs::PathName::init(file_path);
            let current_hash = hashes[event.index as usize];

            match kind {
                bun_watcher::Kind::File => {
                    if event.op.delete || (event.op.rename && IS_KQUEUE) {
                        ctx.remove_at_index(event.index, 0, &[], bun_watcher::Kind::File);
                    }

                    if self.verbose {
                        Self::debug(format_args!(
                            "File changed: {}",
                            bstr::BStr::new(fs.relative_to(file_path))
                        ));
                    }

                    if event.op.write || event.op.delete || event.op.rename {
                        record_changed_path(file_path);
                        if IS_KQUEUE {
                            if event.op.rename {
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
                                .bust_dir_cache(strings::without_trailing_slash_windows_path(
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
                        let mut affected_inotify: &[Option<&mut ZStr>] = &[];
                        let _ = (&mut affected_kqueue, &mut affected_inotify);

                        let affected_len: usize = 'brk: {
                            if IS_KQUEUE {
                                if let Some(existing) = rfs.entries.get(file_path) {
                                    self.put_tombstone(file_path, existing);
                                    entries_option = Some(existing);
                                } else if let Some(existing) = self.get_tombstone(file_path) {
                                    entries_option = Some(existing);
                                }

                                if event.op.write {
                                    // Check if the entrypoint now exists after an atomic save.
                                    // If we previously got a NOTE_RENAME on the entrypoint (vim renamed
                                    // the file), this directory write event signals that the new
                                    // file has been re-created. Verify it exists and trigger reload.
                                    if self.main.is_waiting_for_dir_change
                                        && self.main.dir_hash == current_hash
                                    {
                                        if bun_sys::faccessat(
                                            file_descriptors[event.index as usize],
                                            bun_paths::basename(self.main.file),
                                        )
                                        .is_ok()
                                        {
                                            self.main.is_waiting_for_dir_change = false;
                                            record_changed_path(self.main.file);
                                            current_task.append(self.main.hash);
                                        }
                                    }
                                }

                                let mut affected_i: usize = 0;

                                // if a file descriptor is stale, we need to close it
                                if event.op.delete && entries_option.is_some() {
                                    for (entry_id, parent_hash) in parents.iter().enumerate() {
                                        if *parent_hash == current_hash {
                                            let affected_path = file_paths[entry_id];
                                            let was_deleted = 'check: {
                                                // TODO(port): std.posix.access → bun_sys::access
                                                if bun_sys::access(
                                                    affected_path,
                                                    bun_sys::F_OK,
                                                )
                                                .is_err()
                                                {
                                                    break 'check true;
                                                }
                                                break 'check false;
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

                        // SAFETY: ctx outlives reloader (BACKREF).
                        let _ = unsafe {
                            (*self.ctx).bust_dir_cache(
                                strings::without_trailing_slash_windows_path(file_path),
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
                                    .unwrap_or(bun_bundler::options::Loader::File);
                                let mut prev_entry_id: usize = usize::MAX;
                                if loader != bun_bundler::options::Loader::File {
                                    let mut path_string: bun_str::PathString =
                                        Default::default();
                                    let mut file_hash: bun_watcher::HashType = last_file_hash;
                                    let abs_path: &[u8] = 'brk: {
                                        if let Some(file_ent) =
                                            dir_ent.entries.get(changed_name)
                                        {
                                            // reset the file descriptor
                                            file_ent.entry.cache.fd = Fd::invalid();
                                            file_ent.entry.need_stat = true;
                                            path_string = file_ent.entry.abs_path;
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
                                                                entry_id as u16,
                                                                0,
                                                                &[],
                                                                bun_watcher::Kind::File,
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
                                            bstr::BStr::new(fs.relative_to(abs_path))
                                        ));
                                    }
                                }
                            }
                        }

                        if self.verbose {
                            Self::debug(format_args!(
                                "Dir change: {} (affecting {})",
                                bstr::BStr::new(fs.relative_to(file_path)),
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

pub use bun_jsc::MarkedArrayBuffer as Buffer;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/hot_reloader.zig (616 lines)
//   confidence: medium
//   todos:      18
//   notes:      heavy comptime reflection (@TypeOf/@hasField on Ctx) — Phase B needs a HotReloaderCtx trait; per-monomorphization static `clear_screen` collapsed to module static; `affected` slice element type is platform-divergent so split into two locals; possible off-by-one in path-buf copy ported verbatim
// ──────────────────────────────────────────────────────────────────────────
