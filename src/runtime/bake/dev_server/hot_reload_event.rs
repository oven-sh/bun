//! `HotReloadEvent`: one batch of file changes from the watcher thread.

use super::*;

/// `DevServer.HotReloadEvent` — produced by the watcher thread.
// Note: cache-line alignment makes each inline `WatcherAtomics.events: [3]`
// element occupy its own cache line, avoiding false sharing on
// `contention_indicator` between watcher and dev-server threads. 128 matches
// the cache line on x86_64/aarch64 (Bun's tier-1 targets) and absorbs Intel
// adjacent-line prefetch.
#[repr(align(128))]
pub(crate) struct HotReloadEvent {
    /// BACKREF (LIFETIMES.tsv): element of `WatcherAtomics.events: [3]`.
    /// Nulled by `Drop for DevServer` when an event is still queued; `run`
    /// checks for null before dereferencing.
    pub(crate) owner: *mut DevServer,
    /// BACKREF to the owning `Box<WatcherAtomics>`; `run` reclaims it when
    /// `owner` has been nulled.
    pub(crate) atomics: *mut WatcherAtomics,
    pub(crate) concurrent_task: bun_event_loop::ConcurrentTask::ConcurrentTask,
    pub(crate) files: StringArrayHashMap<()>,
    pub(crate) dirs: StringArrayHashMap<()>,
    /// NUL-joined absolute paths.
    pub(crate) extra_files: Vec<u8>,
    pub(crate) timer: std::time::Instant,
    /// 1 if referenced, 0 if unreferenced; see `WatcherAtomics`.
    #[cfg(debug_assertions)]
    pub(crate) contention_indicator: core::sync::atomic::AtomicU32,
    #[cfg(debug_assertions)]
    pub(crate) debug_mutex: bun_threading::Mutex,
}

impl bun_event_loop::Taskable for HotReloadEvent {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::BakeHotReloadEvent;
    /// An inline slot of the watcher's `WatcherAtomics`. If its DevServer is
    /// gone (`owner` nulled by `Drop for DevServer`, which then leaves the
    /// atomics to the queued event), this was the last thing keeping the
    /// atomics alive; otherwise the DevServer still owns them.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; `atomics` is the heap WatcherAtomics `this` lives in.
        unsafe {
            if (*this).owner.is_null() {
                bun_core::heap::destroy((*this).atomics);
            }
        }
    }
    /// The dev server is the realm's.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl HotReloadEvent {
    pub(crate) fn init_empty(owner: *mut DevServer) -> HotReloadEvent {
        HotReloadEvent {
            owner,
            atomics: core::ptr::null_mut(),
            concurrent_task: Default::default(),
            files: Default::default(),
            dirs: Default::default(),
            extra_files: Vec::new(),
            timer: std::time::Instant::now(),
            #[cfg(debug_assertions)]
            contention_indicator: core::sync::atomic::AtomicU32::new(0),
            #[cfg(debug_assertions)]
            debug_mutex: bun_threading::Mutex::default(),
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        (self.files.count() + self.dirs.count()) == 0
    }

    /// Debug-asserts that the owning [`DevServer`]'s watcher thread-lock is
    /// held. Centralises the back-ref deref so the call sites in
    /// `watcher_acquire_event` / `watcher_release_and_submit_event` stay safe.
    #[inline]
    pub(crate) fn assert_watcher_thread_locked(&self) {
        // SAFETY: BACKREF — `owner` is the live DevServer whose `watcher_atomics`
        // holds this event; only reached from the watcher thread while
        // `Watcher.mutex` is held, so `owner` has not been nulled. Raw place
        // projection so this does not alias any live `&mut HotReloadEvent`.
        unsafe { (*self.owner).bun_watcher.thread_lock.assert_locked() };
    }

    /// Invalidates items in IncrementalGraph, appending all new items to `entry_points`.
    pub(crate) fn process_file_list(
        &mut self,
        dev: &mut DevServer,
        entry_points: &mut EntryPointList,
    ) {
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

    pub(crate) fn reset(&mut self) {
        #[cfg(debug_assertions)]
        self.debug_mutex.unlock();
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

    /// Main-thread side of the watcher → DevServer hand-off.
    ///
    /// # Safety
    /// `first` points into `(*(*first).atomics).events` of a live heap
    /// `WatcherAtomics`. `(*first).owner` is either the live owning
    /// `DevServer` or null (set by `Drop for DevServer` while this event was
    /// still queued). Must run on the DevServer thread.
    #[inline(never)]
    pub(crate) unsafe fn run(first: *mut HotReloadEvent) {
        bun_removable_features::removable_definition!(Bundler, Self::run);
        // SAFETY: caller contract. With a null `owner`, `atomics` (the `heap::alloc_nn` pointer) has
        // no other owner. Otherwise the slot is this thread's until it is recycled.
        let (event, dev) = unsafe {
            let Some(dev) = (*first).owner.as_mut() else {
                bun_core::heap::destroy((*first).atomics);
                return;
            };
            (&mut *first, dev)
        };
        debug_assert!(dev.magic == Magic::Valid);
        bun_core::scoped_log!(DevServer, "HMR Task start");
        scopeguard::defer! {
            bun_core::scoped_log!(DevServer, "HMR Task end");
        }

        #[cfg(debug_assertions)]
        {
            debug_assert!(event.debug_mutex.try_lock());
            debug_assert!(event.contention_indicator.load(Ordering::SeqCst) == 0);
        }

        if dev.current_bundle.is_some() {
            dev.next_bundle.reload_event = Some(first);
            return;
        }

        let mut entry_points = EntryPointList::default();
        event.process_file_list(dev, &mut entry_points);
        let timer = event.timer;
        // SAFETY: as above.
        unsafe { dev.process_reload_events(first, &mut entry_points) };

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
    /// SAFETY: `first` is a slot of `self.watcher_atomics` that was submitted and not yet recycled.
    pub(super) unsafe fn process_reload_events(
        &mut self,
        first: *mut HotReloadEvent,
        entry_points: &mut EntryPointList,
    ) {
        let mut current = first;
        // SAFETY: caller contract, which also holds for the slot that recycling returns.
        unsafe {
            loop {
                (*current).process_file_list(self, entry_points);
                let atomics = self.watcher_atomics.as_ptr();
                let Some(next) = WatcherAtomics::recycle_event_from_dev_server(atomics, current)
                else {
                    break;
                };
                current = next;
                #[cfg(debug_assertions)]
                debug_assert!((*current).debug_mutex.try_lock());
            }
        }
    }
}
