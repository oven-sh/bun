//! This task informs the DevServer's thread about new files to be bundled.

use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_collections::StringArrayHashMap;
use bun_core::Output;
use bun_jsc::ConcurrentTask;
use bun_paths::Platform;
use bun_str::strings;

use crate::dev_server::directory_watch_store::{self, DirectoryWatchStore};
use crate::dev_server::{DevServer, EntryPointList, MessageId};

/// This task informs the DevServer's thread about new files to be bundled.
///
/// Align to cache lines to eliminate false sharing.
// TODO(port): std.atomic.cache_line is 128 on aarch64-macos, 64 elsewhere — pick via cfg in Phase B
#[repr(align(64))]
pub struct HotReloadEvent {
    pub owner: *const DevServer,
    /// Initialized in WatcherAtomics.watcherReleaseAndSubmitEvent
    pub concurrent_task: MaybeUninit<ConcurrentTask>,
    /// The watcher is not able to peek into IncrementalGraph to know what files
    /// to invalidate, so the watch events are de-duplicated and passed along.
    /// The keys are owned by the file watcher.
    // TODO(port): keys are borrowed slices owned by the file watcher — verify StringArrayHashMap key ownership semantics
    pub files: StringArrayHashMap<()>,
    /// Directories are watched so that resolution failures can be solved.
    /// The keys are owned by the file watcher.
    pub dirs: StringArrayHashMap<()>,
    /// Same purpose as `files` but keys do not have an owner.
    pub extra_files: Vec<u8>,
    /// Initialized by the WatcherAtomics.watcherAcquireEvent
    // TODO(port): std.time.Timer — confirm bun_core has a Timer wrapper or use Instant
    pub timer: MaybeUninit<std::time::Instant>,
    /// This event may be referenced by either DevServer or Watcher thread.
    /// 1 if referenced, 0 if unreferenced; see WatcherAtomics
    pub contention_indicator: AtomicU32,

    #[cfg(debug_assertions)]
    pub debug_mutex: bun_threading::Mutex,
}

impl HotReloadEvent {
    pub fn init_empty(owner: *const DevServer) -> HotReloadEvent {
        HotReloadEvent {
            owner,
            concurrent_task: MaybeUninit::uninit(),
            files: StringArrayHashMap::default(),
            dirs: StringArrayHashMap::default(),
            timer: MaybeUninit::uninit(),
            contention_indicator: AtomicU32::new(0),
            #[cfg(debug_assertions)]
            debug_mutex: bun_threading::Mutex::default(),
            extra_files: Vec::new(),
        }
    }

    pub fn reset(&mut self) {
        #[cfg(debug_assertions)]
        self.debug_mutex.unlock();

        self.files.clear_retaining_capacity();
        self.dirs.clear_retaining_capacity();
        self.extra_files.clear();
        self.timer = MaybeUninit::uninit();
    }

    pub fn is_empty(&self) -> bool {
        (self.files.count() + self.dirs.count()) == 0
    }

    pub fn append_file(&mut self, file_path: &[u8]) {
        let _ = self.files.get_or_put(file_path);
    }

    pub fn append_dir(&mut self, dir_path: &[u8], maybe_sub_path: Option<&[u8]>) {
        if dir_path.is_empty() {
            return;
        }
        let _ = self.dirs.get_or_put(dir_path);

        let Some(sub_path) = maybe_sub_path else {
            return;
        };
        if sub_path.is_empty() {
            return;
        }

        let platform = Platform::auto();
        let ends_with_sep = platform.is_separator(dir_path[dir_path.len() - 1]);
        let starts_with_sep = platform.is_separator(sub_path[0]);
        let sep_offset: i32 = if ends_with_sep && starts_with_sep { -1 } else { 1 };

        let needed = i32::try_from(dir_path.len() + sub_path.len()).unwrap() + sep_offset + 1;
        self.extra_files.reserve(usize::try_from(needed).unwrap());
        // PERF(port): was appendSliceAssumeCapacity / appendAssumeCapacity — profile in Phase B
        self.extra_files.extend_from_slice(if ends_with_sep {
            &dir_path[0..dir_path.len() - 1]
        } else {
            dir_path
        });
        self.extra_files.push(platform.separator());
        self.extra_files.extend_from_slice(sub_path);
        self.extra_files.push(0);
    }

    /// Invalidates items in IncrementalGraph, appending all new items to `entry_points`
    pub fn process_file_list(
        &mut self,
        dev: &mut DevServer,
        entry_points: &mut EntryPointList,
    ) {
        let _guard = dev.graph_safety_lock.lock();

        // First handle directories, because this may mutate `event.files`
        if dev.directory_watchers.watches.count() > 0 {
            for changed_dir_with_slash in self.dirs.keys() {
                let changed_dir =
                    strings::without_trailing_slash_windows_path(changed_dir_with_slash);

                // Bust resolution cache, but since Bun does not watch all
                // directories in a codebase, this only targets the following resolutions
                let _ = dev.server_transpiler.resolver.bust_dir_cache(changed_dir);

                // if a directory watch exists for resolution failures, check those now.
                if let Some(watcher_index) =
                    dev.directory_watchers.watches.get_index(changed_dir)
                {
                    // PORT NOTE: reshaped for borrowck — Zig held `entry` ref while mutating
                    // `dev.directory_watchers.dependencies` and `self.files` in the loop body.
                    let mut new_chain: directory_watch_store::DepIndexOptional =
                        directory_watch_store::DepIndexOptional::NONE;
                    let mut it: Option<directory_watch_store::DepIndex> =
                        Some(dev.directory_watchers.watches.values()[watcher_index].first_dep);

                    while let Some(index) = it {
                        // PORT NOTE: reshaped for borrowck — re-index per iteration instead of
                        // holding `dep` ref across resolver call + appendFile + freeDependencyIndex
                        let (source_file_path, specifier, next) = {
                            let dep =
                                &dev.directory_watchers.dependencies[index.get()];
                            (dep.source_file_path, dep.specifier, dep.next.unwrap())
                        };
                        it = next;

                        if dev
                            .server_transpiler
                            .resolver
                            .resolve(
                                bun_paths::dirname(source_file_path, Platform::auto()),
                                specifier,
                                bun_options_types::ImportKind::Stmt,
                            )
                            .ok()
                            .is_some()
                        {
                            // this resolution result is not preserved as passing it
                            // into BundleV2 is too complicated. the resolution is
                            // cached, anyways.
                            self.append_file(source_file_path);
                            dev.directory_watchers.free_dependency_index(index);
                        } else {
                            // rebuild a new linked list for unaffected files
                            dev.directory_watchers.dependencies[index.get()].next = new_chain;
                            new_chain = index.to_optional();
                        }
                    }

                    if let Some(new_first_dep) = new_chain.unwrap() {
                        dev.directory_watchers.watches.values_mut()[watcher_index].first_dep =
                            new_first_dep;
                    } else {
                        // without any files to depend on this watcher is freed
                        dev.directory_watchers.free_entry(watcher_index);
                    }
                }
            }
        }

        let mut rest_extra: &[u8] = &self.extra_files;
        while let Some(str_idx) = strings::index_of_char(rest_extra, 0) {
            self.files.put(&rest_extra[0..str_idx as usize], ());
            rest_extra = &rest_extra[str_idx as usize + 1..];
        }
        if !rest_extra.is_empty() {
            self.files.put(rest_extra, ());
        }

        let changed_file_paths = self.files.keys();
        // PORT NOTE: Zig used `inline for` over a 2-tuple; written out as two calls.
        dev.server_graph.invalidate(changed_file_paths, entry_points);
        dev.client_graph.invalidate(changed_file_paths, entry_points);

        if entry_points.set.count() == 0 {
            Output::debug_warn(format_args!("nothing to bundle"));
            if !changed_file_paths.is_empty() {
                Output::debug_warn(format_args!(
                    "modified files: {}",
                    bun_core::fmt::fmt_slice(changed_file_paths, ", ")
                ));
            }

            if self.dirs.count() > 0 {
                Output::debug_warn(format_args!(
                    "modified dirs: {}",
                    bun_core::fmt::fmt_slice(self.dirs.keys(), ", ")
                ));
            }

            dev.publish(
                MessageId::TestingWatchSynchronization,
                &[MessageId::TestingWatchSynchronization.char(), 1],
                bun_uws::Opcode::Binary,
            );
            return;
        }

        if let Some(map) = &mut dev.has_tailwind_plugin_hack {
            for abs_path in map.keys() {
                let Some(file) = dev.client_graph.bundled_files.get(abs_path) else {
                    continue;
                };
                let file = file.unpack();
                if file.kind() == crate::dev_server::incremental_graph::FileKind::Css {
                    entry_points.append_css(abs_path);
                }
            }
        }
    }

    pub fn run(first: &mut HotReloadEvent) {
        // SAFETY: owner is a BACKREF to the DevServer that owns the WatcherAtomics array
        // containing this event; DevServer outlives all HotReloadEvents it holds.
        // TODO(port): LIFETIMES.tsv classifies owner as *const, but run() mutates DevServer —
        // verify field should be *mut in Phase B.
        let dev: &mut DevServer = unsafe { &mut *(first.owner as *mut DevServer) };
        debug_assert!(dev.magic == DevServer::Magic::Valid);
        bun_output::scoped_log!(DevServer, "HMR Task start");
        // PORT NOTE: `defer debug.log("HMR Task end")` — use scopeguard for the trailing log.
        let _end_log = scopeguard::guard((), |_| {
            bun_output::scoped_log!(DevServer, "HMR Task end");
        });

        #[cfg(debug_assertions)]
        {
            debug_assert!(first.debug_mutex.try_lock());
            debug_assert!(first.contention_indicator.load(Ordering::SeqCst) == 0);
        }

        if dev.current_bundle.is_some() {
            dev.next_bundle.reload_event = Some(first as *mut HotReloadEvent);
            return;
        }

        // PERF(port): was stack-fallback allocator (4096 bytes) — profile in Phase B
        let mut entry_points = EntryPointList::default();

        first.process_file_list(dev, &mut entry_points);

        // SAFETY: timer was initialized by WatcherAtomics.watcherAcquireEvent before this
        // event was submitted to the DevServer thread.
        let timer = unsafe { first.timer.assume_init() };

        let mut current: &mut HotReloadEvent = first;
        loop {
            current.process_file_list(dev, &mut entry_points);
            match dev.watcher_atomics.recycle_event_from_dev_server(current) {
                Some(next) => {
                    current = next;
                    #[cfg(debug_assertions)]
                    {
                        debug_assert!(current.debug_mutex.try_lock());
                    }
                }
                None => break,
            }
        }

        if entry_points.set.count() == 0 {
            return;
        }

        match &mut dev.testing_batch_events {
            DevServer::TestingBatchEvents::Disabled => {}
            DevServer::TestingBatchEvents::Enabled(ev) => {
                ev.append(dev, &entry_points);
                dev.publish(
                    MessageId::TestingWatchSynchronization,
                    &[MessageId::TestingWatchSynchronization.char(), 1],
                    bun_uws::Opcode::Binary,
                );
                return;
            }
            DevServer::TestingBatchEvents::EnableAfterBundle => debug_assert!(false),
        }

        match dev.start_async_bundle(entry_points, true, timer) {
            Ok(()) => {}
            Err(_err) => {
                // TODO(port): bun.handleErrorReturnTrace(err, @errorReturnTrace()) — Zig error
                // return trace has no Rust equivalent; consider logging in Phase B.
                return;
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/HotReloadEvent.zig (253 lines)
//   confidence: medium
//   todos:      5
//   notes:      owner BACKREF is *const per TSV but run() needs &mut DevServer; StringArrayHashMap key ownership (borrowed from watcher) needs Phase B review; process_file_list reshaped for borrowck (re-indexing instead of held refs)
// ──────────────────────────────────────────────────────────────────────────
