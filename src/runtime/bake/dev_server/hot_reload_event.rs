//! `HotReloadEvent`: one batch of file changes from the watcher thread.

use super::*;

use core::sync::atomic::AtomicPtr;

/// `DevServer.HotReloadEvent` — produced by the watcher thread.
#[derive(Default)]
pub(crate) struct HotReloadEvent {
    files: StringArrayHashMap<()>,
    dirs: StringArrayHashMap<()>,
    /// NUL-joined absolute paths.
    extra_files: Vec<u8>,
}

/// Hands changes from the watcher thread to the JS thread.
pub(crate) struct PendingReloadEvent {
    /// Null once the `DevServer` is dropped.
    owner: AtomicPtr<DevServer>,
    pub(super) state: bun_threading::Guarded<PendingState>,
}

pub(super) struct PendingState {
    pub(super) event: HotReloadEvent,
    /// When the first change in `event` was seen.
    pub(super) timer: Instant,
    /// No task is posted while set. `process_reload_events` clears it once `event` is empty.
    pub(super) scheduled: bool,
}

impl bun_event_loop::RefTask for PendingReloadEvent {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::BakePendingReloadEvent;
    type Ref = Arc<Self>;
    fn release_unrun(_: Self::Ref) {}
    /// The dev server is the realm's.
    fn context(_: &Self::Ref) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl HotReloadEvent {
    pub(crate) fn is_empty(&self) -> bool {
        (self.files.count() + self.dirs.count()) == 0
    }

    /// Invalidates items in IncrementalGraph, appending all new items to `entry_points`.
    fn process_file_list(&mut self, dev: &mut DevServer, entry_points: &mut EntryPointList) {
        // RAII: `ThreadLockGuard` stores a raw `*const ThreadLock` and unlocks on
        // drop, so it does not hold a borrow of `dev` for the scope.
        let _g = dev.graph_safety_lock.guard();

        // First handle directories, because this may mutate `event.files`
        if dev.directory_watchers.watches.count() > 0 {
            for changed_dir_with_slash in self.dirs.keys() {
                let changed_dir = bun_paths::string_paths::without_trailing_slash_windows_path(
                    changed_dir_with_slash,
                );

                // Bust resolution cache, but since Bun does not watch all
                // directories in a codebase, this only targets the following resolutions
                let _ = dev.server_transpiler.resolver.bust_dir_cache(changed_dir);

                // if a directory watch exists for resolution failures, check those now.
                if let Some(watcher_index) = dev.directory_watchers.watches.get_index(changed_dir) {
                    let mut new_chain: Option<u32> = None;
                    let mut it: Option<u32> =
                        Some(dev.directory_watchers.watches.values()[watcher_index].first_dep);

                    while let Some(index) = it {
                        let dep = &dev.directory_watchers.dependencies[index as usize];
                        let source_file_path = dep.source_file_path;
                        it = dep.next;

                        let resolved = dev
                            .server_transpiler
                            .resolver
                            .resolve(
                                bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                                    source_file_path.slice(),
                                ),
                                &dep.specifier,
                                bun_ast::ImportKind::Stmt,
                            )
                            .is_ok();

                        if resolved {
                            // this resolution result is not preserved as passing it
                            // into BundleV2 is too complicated. the resolution is
                            // cached, anyways.
                            // Note: inlined `append_file` body for disjoint borrow
                            // (`self.dirs.keys()` is held immutably across this loop).
                            bun_core::handle_oom(self.files.get_or_put(source_file_path.slice()));
                            dev.directory_watchers.free_dependency_index(index);
                        } else {
                            // rebuild a new linked list for unaffected files
                            dev.directory_watchers.dependencies[index as usize].next = new_chain;
                            new_chain = Some(index);
                        }
                    }

                    if let Some(new_first_dep) = new_chain {
                        dev.directory_watchers.watches.values_mut()[watcher_index].first_dep =
                            new_first_dep;
                    } else {
                        // without any files to depend on this watcher is freed
                        dev.free_directory_watch(watcher_index);
                    }
                }
            }
        }

        let mut rest_extra: &[u8] = &self.extra_files;
        while let Some(str_idx) = bun_core::strings::index_of_char_usize(rest_extra, 0) {
            bun_core::handle_oom(self.files.put(&rest_extra[0..str_idx as usize], ()));
            rest_extra = &rest_extra[str_idx as usize + 1..];
        }
        if !rest_extra.is_empty() {
            bun_core::handle_oom(self.files.put(rest_extra, ()));
        }

        let changed_file_paths = self.files.keys();
        bun_core::handle_oom(
            dev.graphs
                .server
                .invalidate(changed_file_paths, entry_points),
        );
        bun_core::handle_oom(
            dev.graphs
                .client
                .invalidate(changed_file_paths, entry_points),
        );

        if entry_points.set.count() == 0 {
            bun_core::debug_warn!("nothing to bundle");
            if !changed_file_paths.is_empty() {
                bun_core::debug_warn!(
                    "modified files: {}",
                    bun_core::fmt::fmt_slice(changed_file_paths, ", ")
                );
            }
            if self.dirs.count() > 0 {
                bun_core::debug_warn!(
                    "modified dirs: {}",
                    bun_core::fmt::fmt_slice(self.dirs.keys(), ", ")
                );
            }

            dev.publish(
                HmrTopic::TestingWatchSynchronization,
                &[MessageId::TestingWatchSynchronization.char(), 1],
                bun_uws::Opcode::BINARY,
            );
            return;
        }

        if let Some(map) = &dev.has_tailwind_plugin_hack {
            for abs_path in map.keys() {
                let Some(file) = dev.graphs.client.bundled_files.get(abs_path) else {
                    continue;
                };
                if file.file_kind() == FileKind::Css {
                    bun_core::handle_oom(entry_points.append_css(abs_path));
                }
            }
        }
    }

    fn reset(&mut self) {
        self.files.clear_retaining_capacity();
        self.dirs.clear_retaining_capacity();
        self.extra_files.clear();
    }

    /// Records a changed file path in the pending hot-reload event (deduplicated).
    pub(crate) fn append_file(&mut self, file_path: &[u8]) {
        bun_core::handle_oom(self.files.get_or_put(file_path));
    }

    /// Records a changed directory (and, when present, the changed entry
    /// within it) in the pending hot-reload event (deduplicated).
    pub(crate) fn append_dir(&mut self, dir_path: &[u8], maybe_sub_path: Option<&[u8]>) {
        if dir_path.is_empty() {
            return;
        }
        bun_core::handle_oom(self.dirs.get_or_put(dir_path));

        let Some(sub_path) = maybe_sub_path else {
            return;
        };
        if sub_path.is_empty() {
            return;
        }

        let ends_with_sep = bun_paths::Platform::AUTO.is_separator(dir_path[dir_path.len() - 1]);
        self.extra_files.extend_from_slice(if ends_with_sep {
            &dir_path[0..dir_path.len() - 1]
        } else {
            dir_path
        });
        self.extra_files.push(bun_paths::SEP);
        self.extra_files.extend_from_slice(sub_path);
        self.extra_files.push(0);
    }
}

impl PendingReloadEvent {
    pub(super) fn new(owner: *mut DevServer) -> Arc<Self> {
        Arc::new(Self {
            owner: AtomicPtr::new(owner),
            state: bun_threading::Guarded::new(PendingState {
                event: HotReloadEvent::default(),
                timer: Instant::now(),
                scheduled: false,
            }),
        })
    }

    pub(super) fn detach(&self) {
        self.owner.store(core::ptr::null_mut(), Ordering::SeqCst);
    }

    /// # Safety
    /// On the thread that owns the `DevServer`, which uses no other borrow of it during the call.
    pub(crate) unsafe fn run(&self) {
        // SAFETY: fn contract. `Drop for DevServer` clears `owner` on this thread.
        let Some(dev) = (unsafe { self.owner.load(Ordering::SeqCst).as_mut() }) else {
            return;
        };
        debug_assert!(dev.magic == Magic::Valid);
        bun_core::scoped_log!(DevServer, "HMR Task start");
        scopeguard::defer! {
            bun_core::scoped_log!(DevServer, "HMR Task end");
        }

        if dev.current_bundle.is_some() {
            dev.next_bundle.has_reload_event = true;
            return;
        }

        let mut entry_points = EntryPointList::default();
        let timer = dev.process_reload_events(&mut entry_points);

        if entry_points.set.count() == 0 {
            return;
        }

        match &mut dev.testing_batch_events {
            TestingBatchEvents::Disabled => {}
            TestingBatchEvents::Enabled(ev) | TestingBatchEvents::ReleaseAfterBundle(ev) => {
                bun_core::handle_oom(ev.append(&entry_points));
                dev.publish(
                    HmrTopic::TestingWatchSynchronization,
                    &[MessageId::TestingWatchSynchronization.char(), 1],
                    bun_uws::Opcode::BINARY,
                );
                return;
            }
            TestingBatchEvents::EnableAfterBundle => debug_assert!(false),
        }

        if let Err(_err) = dev.start_async_bundle(entry_points, true, timer) {
            return;
        }
    }
}

impl DevServer {
    /// Returns the time of the first change.
    pub(super) fn process_reload_events(&mut self, entry_points: &mut EntryPointList) -> Instant {
        let mut event = core::mem::take(&mut self.spare_reload_event);
        let mut first_seen = None;
        loop {
            {
                let mut pending = self.pending_reload_event.state.lock();
                let timer = *first_seen.get_or_insert(pending.timer);
                if pending.event.is_empty() {
                    pending.scheduled = false;
                    self.spare_reload_event = event;
                    return timer;
                }
                core::mem::swap(&mut pending.event, &mut event);
            }
            event.process_file_list(self, entry_points);
            event.reset();
        }
    }
}
