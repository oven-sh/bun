use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use bun_bundler::Transpiler;
#[cfg(not(windows))]
use bun_collections::StringHashMap;
use bun_collections::StringSet;
#[cfg(not(windows))]
use bun_core::ZStr;
use bun_core::{Output, ZBox};
#[cfg(not(windows))]
use bun_paths::SEP;
#[cfg(not(windows))]
use bun_paths::strings;
#[cfg(not(windows))]
use bun_ptr::BackRef;
use bun_resolver::Resolver;
#[cfg(not(windows))]
use bun_resolver::fs::PathName;
use bun_resolver::fs::{self as Fs, FileSystem};
use bun_sys::Fd;
use bun_watcher::WatchItemColumns as _;
use bun_watcher::{Op as WatchOp, OwnedWatcher, Watcher};

use crate::virtual_machine::{HotReload, VirtualMachine};
use bun_event_loop::task_tag;

bun_core::declare_scope!(hot_reloader, visible);

use bun_core::env::IS_KQUEUE;

/// `bun run` and `bun test` with `--hot` or `--watch`.
pub fn enable_hot_module_reloading(
    vm: &VirtualMachine,
    entry_path: Option<&'static [u8]>,
    trigger_file: Option<ZBox>,
) {
    if vm.is_watcher_enabled() {
        return;
    }
    let reloader = HotReloader {
        reload_immediately: vm.hot_reload.get() == HotReload::Watch,
        verbose: (vm.log_ref()).is_some_and(|l| l.level.at_least(bun_ast::Level::Info)),
        main: MainFile::init(entry_path.unwrap_or(b"")),
        reload_handle: Some(vm.handle()),
        changed_paths: ChangedPaths {
            trigger_file,
            ..Default::default()
        },
        ..HotReloader::new(vm.transpiler.get())
    };
    let watcher = reloader.start();
    vm.transpiler
        .with_mut(|t| t.resolver.watcher = Some(Arc::clone(&watcher)));
    vm.bun_watcher.set(Some(watcher));
}

/// `bun build --watch`.
pub fn enable_hot_module_reloading_for_bundler(transpiler: &mut Transpiler<'_>) -> OwnedWatcher {
    let watcher = HotReloader::new(transpiler).start();
    transpiler.resolver.watcher = Some(Arc::clone(&watcher));
    watcher
}

/// `bun test --changed --watch` reruns for these only, not for every change git knows of.
#[derive(Default)]
struct ChangedPaths {
    /// The restarted process reads and deletes it. Nothing is recorded without one.
    trigger_file: Option<ZBox>,
    paths: StringSet,
}

impl ChangedPaths {
    fn record(&mut self, path: &[u8]) {
        if self.trigger_file.is_some() && !path.is_empty() {
            bun_core::handle_oom(self.paths.insert(path));
        }
    }

    /// Best-effort: if the write fails, the new process falls back to querying git.
    fn write_trigger_file(&self) {
        let Some(trigger_file) = &self.trigger_file else {
            return;
        };
        if self.paths.is_empty() {
            return;
        }

        let mut buf: Vec<u8> = Vec::new();
        for p in self.paths.keys() {
            if buf.try_reserve(p.len() + 1).is_err() {
                return;
            }
            buf.extend_from_slice(p);
            buf.push(b'\n');
        }
        let _ = bun_sys::File::write_file(Fd::cwd(), trigger_file, &buf);
    }
}

unsafe extern "C" {
    safe fn BunDebugger__willHotReload();
}

struct HotReloader {
    /// Replace the process instead of evaluating the entry point again.
    reload_immediately: bool,
    clear_screen: bool,
    /// A copy for the watcher thread: the transpiler belongs to another one.
    #[cfg(not(windows))]
    loaders: bun_ast::LoaderHashTable,
    verbose: bool,

    main: MainFile,

    #[cfg(not(windows))]
    tombstones: StringHashMap<BackRef<Fs::EntriesOption>>,

    /// `None` for `bun build --watch`, which replaces the process before it would post a task.
    reload_handle: Option<crate::VmHandle>,

    changed_paths: ChangedPaths,
}

#[derive(Default)]
struct MainFile {
    /// Hash of the directory path, with its trailing `/`.
    dir_hash: bun_watcher::HashType,

    #[cfg(not(windows))]
    file: &'static [u8],
    hash: bun_watcher::HashType,

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
    is_waiting_for_dir_change: bool,
}

impl MainFile {
    fn init(file: &'static [u8]) -> MainFile {
        let mut main = MainFile {
            #[cfg(not(windows))]
            file,
            hash: if !file.is_empty() {
                Watcher::get_hash(file)
            } else {
                0
            },
            ..Default::default()
        };

        if let Some(dir) = bun_core::dirname(file) {
            debug_assert!(bun_core::is_slice_in_buffer(dir, file));
            debug_assert!(file.len() > dir.len() + 1);
            main.dir_hash = Watcher::get_hash(&file[0..dir.len() + 1]);
        }

        main
    }
}

/// Reloads that the watcher thread asked for and the JS thread has not started.
static PENDING_RELOADS: AtomicU32 = AtomicU32::new(0);

/// Posted by the watcher thread. `--watch` posts it only if `--watch-kill-signal` has listeners.
pub struct HotReloadTask;

impl bun_event_loop::BoxedTask for HotReloadTask {
    const TAG: bun_event_loop::TaskTag = task_tag::HotReloadTask;
    fn release_unrun(self: Box<Self>) {}
    /// Reloads the realm.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl HotReloadTask {
    pub fn run(vm: &VirtualMachine) {
        // Since we rely on the event loop for hot reloads, there can be
        // a delay before the next reload begins. In the time between the
        // last reload and the next one, we shouldn't schedule any more
        // hot reloads. Since we reload literally everything, we don't
        // need to worry about missing any changes.
        //
        // Note that we set the count _before_ we reload, so that if we
        // get another hot reload request while we're reloading, we'll
        // still enqueue it.
        while PENDING_RELOADS.swap(0, Ordering::Relaxed) > 0 {
            vm.reload();
        }
    }
}

impl HotReloader {
    fn reload(&self) {
        crate::mark_binding!();

        // With --watch-kill-signal listeners registered, reload via the event
        // loop so the JS thread emits them before execve (node runs the child's
        // handlers on kill); otherwise execve immediately (node's default kill).
        if self.reload_immediately && !crate::posix_signal_handle::watch_kill_signal_has_listeners()
        {
            crate::node_compile_cache::persist_now();
            Output::flush();
            self.changed_paths.write_trigger_file();
            bun_removable_features::removable_body!(HotReload, Abort, {
                bun_core::reload_process(self.clear_screen, false);
            });
            unreachable!();
        }

        let handle = (self.reload_handle.as_ref()).expect("set for a reloader that posts");
        PENDING_RELOADS.fetch_add(1, Ordering::Relaxed);

        BunDebugger__willHotReload();
        let _ = handle.post(crate::LoopKind::Regular, Box::new(HotReloadTask));

        // The JS thread emits kill-signal listeners then execve; if it's stuck in sync code it
        // never drains the posted task. Arm a one-shot timer that forces the reload after a
        // bounded window (node's watcher SIGKILLs an unresponsive child after its grace period).
        if self.reload_immediately {
            arm_watch_reload_grace_timer(self.clear_screen);
        }
    }
}

static WATCH_RELOAD_GRACE_ARMED: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

fn arm_watch_reload_grace_timer(clear_screen: bool) {
    if WATCH_RELOAD_GRACE_ARMED.load(core::sync::atomic::Ordering::Relaxed) {
        return;
    }
    let reload_started = bun_core::is_process_reload_in_progress_on_another_thread;
    let handler_running = crate::posix_signal_handle::is_emitting_watch_kill_signal;
    let force = move || -> ! {
        // Same as the sibling reload paths: execve never reaches on_exit, so
        // flush the compile cache first (safe off the JS thread; generation
        // runs on its own worker VM).
        crate::node_compile_cache::persist_now();
        Output::flush();
        bun_removable_features::removable_body!(HotReload, Abort, {
            bun_core::reload_process(clear_screen, false);
        });
        unreachable!();
    };
    let spawned = std::thread::Builder::new()
        .name("WatchReloadGrace".into())
        .spawn(move || {
            // `force()` clears the terminal through this thread's `Output`
            // writers, which print nothing until the thread is configured.
            Output::Source::configure_thread_no_js();
            const STEP_MS: u64 = 10;
            // Budget to drain the posted HotReloadTask; extended once when
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

impl HotReloader {
    fn debug(args: core::fmt::Arguments<'_>) {
        bun_core::pretty_errorln!("<cyan>watcher<r><d>:<r> {}", args);
    }

    fn new(transpiler: &Transpiler<'_>) -> Self {
        Self {
            reload_immediately: true,
            clear_screen: !transpiler
                .env()
                .has_set_no_clear_terminal_on_reload(!Output::enable_ansi_colors_stdout()),
            #[cfg(not(windows))]
            loaders: bun_core::handle_oom(transpiler.options.loaders.clone()),
            verbose: false,
            main: MainFile::default(),
            #[cfg(not(windows))]
            tombstones: StringHashMap::default(),
            reload_handle: None,
            changed_paths: ChangedPaths::default(),
        }
    }

    fn start(self) -> OwnedWatcher {
        let watcher = match Watcher::init(Box::new(self), FileSystem::get().top_level_dir()) {
            Ok(w) => w,
            Err(err) => {
                bun_core::pretty_errorln!(
                    "<red>error<r><d>:<r> Failed to enable File Watcher: {}",
                    err.name()
                );
                Output::flush();
                bun_core::Global::exit(1);
            }
        };

        if let Err(err) = watcher.start() {
            bun_core::handle_error_return_trace(&err);
            bun_core::pretty_errorln!(
                "<red>error<r><d>:<r> Failed to start File Watcher: {}",
                err.name()
            );
            Output::flush();
            bun_core::Global::exit(1);
        }
        watcher
    }

    #[cfg(not(windows))]
    fn put_tombstone(&mut self, key: &[u8], value: BackRef<Fs::EntriesOption>) {
        self.tombstones.put(key, value).expect("unreachable");
    }

    #[cfg(not(windows))]
    fn get_tombstone(&mut self, key: &[u8]) -> Option<BackRef<Fs::EntriesOption>> {
        self.tombstones.get(key).copied()
    }

    /// Returns `key`'s cached listing, or `None` if it isn't cached or the cached result is a read error.
    /// Resolver threads rewrite the cache under `entries_mutex`. The slot is never freed.
    #[cfg(not(windows))]
    fn cached_dir_entry(
        rfs: &mut Fs::file_system::RealFS,
        key: &[u8],
    ) -> Option<BackRef<Fs::EntriesOption>> {
        let _entries_lock = rfs.entries_mutex.lock_guard();
        match rfs.entries.get(key) {
            Some(existing @ Fs::EntriesOption::Entries(_)) => Some(BackRef::new(existing)),
            _ => None,
        }
    }
}

impl bun_watcher::WatcherContext for HotReloader {
    fn on_error(&mut self, err: bun_sys::Error) {
        // `bun_sys::Error::name()` does the errno→tag-name lookup.
        Output::err(err.name(), "Watcher crashed", ());
        if cfg!(debug_assertions) {
            panic!("Watcher crash");
        }
    }

    fn on_file_update(
        &mut self,
        events: &[bun_watcher::WatchEvent],
        changed_files: &[&[u8]],
        watchlist: &bun_watcher::WatchList,
        evictions: &mut bun_watcher::Evictions,
    ) {
        let file_paths = watchlist.items_file_path();
        let kinds = watchlist.items_kind();
        let hashes = watchlist.items_hash();
        let parents = watchlist.items_parent_hash();
        let files = watchlist.items_file();
        let mut changed = false;
        let fs: &mut FileSystem = FileSystem::instance();
        let top_level_dir = fs.top_level_dir();
        let rfs: &mut Fs::file_system::RealFS = &mut fs.fs;
        #[cfg(windows)]
        let _ = (changed_files, parents, files);
        let mut _on_file_update_path_buf = bun_paths::path_buffer_pool::get();

        for event in events.iter() {
            // Stale udata: kevent.udata can outlive a swapRemove in flushEvictions.
            if event.index as usize >= file_paths.len() {
                continue;
            }
            let file_path: &[u8] = &file_paths[event.index as usize];
            let kind = kinds[event.index as usize];

            // so it's consistent with the rest
            // if we use .extname we might run into an issue with whether or not the "." is included.
            // let path = Fs::PathName::init(file_path);
            let current_hash = hashes[event.index as usize];

            match kind {
                bun_watcher::Kind::File => {
                    if !bun_watcher::WATCHES_BY_PATH
                        && (event.op.contains(WatchOp::DELETE)
                            || (event.op.contains(WatchOp::RENAME) && IS_KQUEUE))
                    {
                        evictions.append_assume_capacity(event.index);
                    }

                    if self.verbose {
                        Self::debug(format_args!(
                            "File changed: {}",
                            bstr::BStr::new(bun_paths::resolve_path::relative(
                                top_level_dir,
                                file_path
                            ))
                        ));
                    }

                    if event
                        .op
                        .intersects(WatchOp::WRITE | WatchOp::DELETE | WatchOp::RENAME)
                    {
                        self.changed_paths.record(file_path);
                        if IS_KQUEUE {
                            if event.op.contains(WatchOp::RENAME) {
                                // Special case for entrypoint: defer reload until we get
                                // a directory write event confirming the file exists.
                                // This handles vim's save process which renames the old file
                                // before the new file is re-created with a different inode.
                                if self.main.hash == current_hash && !self.reload_immediately {
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

                        changed = true;
                    }
                }
                bun_watcher::Kind::Directory => {
                    #[cfg(windows)]
                    {
                        // on windows we receive file events for all items affected by a directory change
                        // so we only need to clear the directory cache. all other effects will be handled
                        // by the file events
                        let _ = Resolver::bust_dir_cache_in(rfs, file_path);
                        continue;
                    }
                    #[cfg(not(windows))]
                    {
                        let mut affected_buf: [&[u8]; 128] = [b"".as_slice(); 128];
                        let mut entries_option: Option<BackRef<Fs::EntriesOption>> = None;

                        let affected: &[&[u8]] = 'brk: {
                            if IS_KQUEUE {
                                if let Some(existing) = Self::cached_dir_entry(rfs, file_path) {
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
                                            let z =
                                                ZStr::nul_terminate(&mut name_buf, basename.len());
                                            files[event.index as usize].as_ref().is_some_and(
                                                |dir| bun_sys::faccessat(dir.fd(), z).is_ok(),
                                            )
                                        } else {
                                            false
                                        };
                                        if exists {
                                            self.main.is_waiting_for_dir_change = false;
                                            self.changed_paths.record(self.main.file);
                                            changed = true;
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
                                                    let z = ZStr::nul_terminate(
                                                        &mut zbuf,
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

                                break 'brk &affected_buf[0..affected_i];
                            }

                            event.names(changed_files)
                        };

                        if !affected.is_empty() && !IS_KQUEUE {
                            if let Some(existing) = Self::cached_dir_entry(rfs, file_path) {
                                self.put_tombstone(file_path, existing);
                                entries_option = Some(existing);
                            } else if let Some(existing) = self.get_tombstone(file_path) {
                                entries_option = Some(existing);
                            }
                        }

                        let _ = Resolver::bust_dir_cache_in(rfs, file_path);

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
                            for &changed_name in affected {
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
                                        let z =
                                            ZStr::nul_terminate(&mut zbuf, self.main.file.len());
                                        bun_sys::access(z, libc::F_OK).is_ok()
                                    }
                                };
                                if main_exists {
                                    self.changed_paths.record(self.main.file);
                                    changed = true;
                                }
                                break;
                            }
                        }

                        if let Some(dir_ent) = entries_option {
                            let mut last_file_hash: bun_watcher::HashType =
                                bun_watcher::HashType::MAX;

                            'names: for &changed_name in affected {
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
                                            (dir_ent.try_entries().ok())
                                                .and_then(|it| it.get(changed_name))
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
                                            path_string = ent.abs_path();
                                            file_hash = Watcher::get_hash(path_string.as_bytes());
                                            for (entry_id, hash) in hashes.iter().enumerate() {
                                                if *hash == file_hash {
                                                    if files[entry_id].is_some() {
                                                        if prev_entry_id != entry_id {
                                                            self.changed_paths
                                                                .record(path_string.as_bytes());
                                                            changed = true;
                                                            if self.verbose {
                                                                Self::debug(format_args!(
                                                                    "Removing file: {}",
                                                                    bstr::BStr::new(
                                                                        path_string.as_bytes()
                                                                    )
                                                                ));
                                                            }
                                                            evictions.append_assume_capacity(
                                                                entry_id
                                                                    as bun_watcher::WatchItemIndex,
                                                            );
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
                                            if file_path_without_trailing_slash.len()
                                                + changed_name.len()
                                                >= _on_file_update_path_buf.len()
                                            {
                                                continue 'names;
                                            }
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
                                                top_level_dir,
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
                                    top_level_dir,
                                    file_path
                                )),
                                affected.len()
                            ));
                        }
                    }
                }
            }
        }

        Output::flush();
        if changed {
            self.reload();
        }
    }
}
