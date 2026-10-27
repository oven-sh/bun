//! The hold of a file that was renamed away or deleted.
//!
//! A removal is a delete, or the first step of a save. Vim moves the file to a
//! backup name and writes a new file. For some milliseconds nothing is at the
//! path, and a bundle in that gap fails: the page shows the error overlay, and
//! the next bundle reloads it.
//!
//! So the dev server holds a removed file, and a watcher event starts no
//! bundle while a file is held. The files that change in that time wait. When
//! each held file is back, or its time to come back has ended, one bundle
//! reads all of them. A file that is not back by then is a deleted file.
//! Watcher events and `DevServer.removal_timer` look for the held files.

use super::*;
use bun_core::{Timespec, TimespecMockMode, ZStr};

/// How long a removed file has to come back. chokidar's `atomic` option uses the same time.
const HOLD_MS: u64 = 100;

/// How often `removal_timer` looks for the held files. Not every file that comes back
/// makes a watcher event: the watcher has no directory watch outside the project root.
const POLL_MS: i64 = 10;

struct Hold {
    /// When the file counts as deleted.
    deadline: Timespec,
    /// `removal_timer` found the file back. A watcher event that reports the file also
    /// starts a bundle, so the timer takes the file only when it finds it back again.
    seen_back: bool,
}

/// The removed files that the dev server holds, and the changed files that wait for them.
#[derive(Default)]
pub(crate) struct Removals {
    held: StringArrayHashMap<Hold>,
    /// The files that changed while a file was held. Empty when no file is held.
    waiting: StringArrayHashMap<()>,
}

impl Removals {
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.held.is_empty()
    }

    pub(crate) fn holds(&self, path: &[u8]) -> bool {
        !self.held.is_empty() && self.held.contains(path)
    }

    fn hold(&mut self, path: &[u8]) {
        let hold_ms = bun_core::env_var::BUN_DEBUG_TEST_DEV_SERVER_REMOVAL_HOLD_MS
            .get()
            .filter(|_| bun_jsc::module_loader::is_allowed_to_use_internal_testing_apis())
            .unwrap_or(HOLD_MS);
        let deadline = Timespec::ms_from_now(
            TimespecMockMode::ForceRealTime,
            i64::try_from(hold_ms).unwrap_or(i64::MAX),
        );
        let hold = Hold {
            deadline,
            seen_back: false,
        };
        bun_core::handle_oom(self.held.put(path, hold));
    }

    pub(crate) fn memory_cost(&self) -> usize {
        memory_cost::memory_cost_array_hash_map(&self.held)
            + memory_cost::memory_cost_array_hash_map(&self.waiting)
            + self
                .held
                .keys()
                .iter()
                .chain(self.waiting.keys())
                .map(|path| path.len())
                .sum::<usize>()
    }
}

/// A save creates the file before it writes it, so a file with no content is not back.
fn is_back(path: &[u8]) -> bool {
    let mut buf = bun_paths::path_buffer_pool::get();
    if path.len() >= buf.0.len() {
        return false;
    }
    buf.0[..path.len()].copy_from_slice(path);
    buf.0[path.len()] = 0;
    let path = ZStr::from_buf(&buf.0[..], path.len());
    bun_sys::stat(path).is_ok_and(|stat| stat.st_size > 0)
}

impl DevServer {
    /// A testing batch bundles when the harness says so, and then reads what is on disk.
    /// Without `removal_timer` a file that does not come back is held until the next event.
    fn holds_removals(&self) -> bool {
        matches!(self.testing_batch_events, TestingBatchEvents::Disabled) && self.timers_fire()
    }

    /// `bun --hot` and `bun --watch` stop the timers when a run has an unhandled error
    /// (`VirtualMachine::reload`). libuv fires them on Windows.
    fn timers_fire(&self) -> bool {
        let vm = self.vm();
        cfg!(windows) || !vm.is_watcher_enabled() || vm.unhandled_error_counter == 0
    }

    /// Holds the bundled files of `removed`. The other files of `removed` join `files`.
    pub(super) fn hold_removed_files(
        &mut self,
        removed: &StringArrayHashMap<()>,
        files: &mut StringArrayHashMap<()>,
    ) {
        let holds_removals = self.holds_removals();
        for path in removed.keys() {
            if holds_removals && self.has_bundled_file(path) {
                self.pending_removals.hold(path);
            } else {
                bun_core::handle_oom(files.get_or_put(path));
            }
        }
    }

    /// Only a file with a graph record is bundled when it changes.
    fn has_bundled_file(&self, path: &[u8]) -> bool {
        self.client_graph.bundled_files.get_index(path).is_some()
            || self.server_graph.bundled_files.get_index(path).is_some()
    }

    /// Ends the hold of each file that is back, and of each file whose time to come back has
    /// ended. While a file is still held, `files` joins the files that wait, and this returns
    /// false. When no file is held, `files` gets the files that waited, and this returns true.
    pub(super) fn settle_removals(
        &mut self,
        files: &mut StringArrayHashMap<()>,
        by_timer: bool,
    ) -> bool {
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let mut index = 0;
        while index < self.pending_removals.held.count() {
            let is_back = is_back(&self.pending_removals.held.keys()[index]);
            let hold = &mut self.pending_removals.held.values_mut()[index];
            let ends = if is_back {
                !by_timer || core::mem::replace(&mut hold.seen_back, true)
            } else {
                hold.seen_back = false;
                !hold.deadline.greater(&now)
            };
            if !ends {
                index += 1;
                continue;
            }
            let (path, _) = self.pending_removals.held.swap_remove_at(index);
            if !is_back {
                // The bundle that reads `path` reports it as deleted.
                for graph_files in [
                    &mut self.client_graph.bundled_files,
                    &mut self.server_graph.bundled_files,
                ] {
                    if let Some(file) = graph_files.get_mut(&path) {
                        file.deleted = true;
                    }
                }
            }
            bun_core::handle_oom(self.pending_removals.waiting.put(&path, ()));
        }
        self.schedule_removal_timer();

        let removals = &mut self.pending_removals;
        if !removals.held.is_empty() {
            for path in files.keys() {
                bun_core::handle_oom(removals.waiting.get_or_put(path));
            }
            files.clear_retaining_capacity();
            return false;
        }
        for path in removals.waiting.keys() {
            bun_core::handle_oom(files.get_or_put(path));
        }
        removals.waiting.clear_and_free();
        true
    }

    /// A bundle that a watcher event started did not find `abs_path` (`not_found`), or a
    /// plugin could not load it. The removal of a file starts no bundle, so another change
    /// started this one before the removal was known here: a second file of the same save,
    /// or a stylesheet that every reload bundles again. The file is held like one whose
    /// removal the watcher reported, and the bundle goes on without it.
    pub(super) fn holds_missing_file(
        &mut self,
        abs_path: &[u8],
        graph: bake::Graph,
        not_found: bool,
    ) -> bool {
        if self.bundle_trigger != BundleTrigger::Watcher || !self.holds_removals() {
            return false;
        }
        let file = match graph {
            bake::Graph::Client => self.client_graph.bundled_files.get(abs_path),
            bake::Graph::Server | bake::Graph::Ssr => self.server_graph.bundled_files.get(abs_path),
        };
        // A bundle reports a deleted file each time it does not find the file.
        if !file.is_some_and(|file| !file.deleted) {
            return false;
        }
        // The error of a plugin does not say that the file is not there.
        if !not_found && bun_sys::exists(abs_path) {
            return false;
        }
        self.pending_removals.hold(abs_path);
        self.schedule_removal_timer();
        true
    }

    /// `removal_timer` runs while a file is held.
    fn schedule_removal_timer(&mut self) {
        let timer: *mut EventLoopTimer = &raw mut self.removal_timer;
        if !self.pending_removals.is_empty() {
            let next = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, POLL_MS);
            self.timer_heap().update(timer, &next);
        } else if self.removal_timer.state == EventLoopTimerState::ACTIVE {
            self.timer_heap().remove(timer);
        }
    }

    /// `removal_timer` fired: a held file can be back, or its time to come back can be at an end.
    pub(crate) fn on_removal_timer(timer: *mut EventLoopTimer) {
        // SAFETY: `timer` points to the `removal_timer` field of a DevServer.
        let dev: &mut DevServer = unsafe { &mut *DevServer::from_removal_timer_ptr(timer) };
        debug_assert!(dev.magic == Magic::Valid);
        dev.removal_timer.state = EventLoopTimerState::FIRED;
        // One bundle runs at a time.
        if dev.current_bundle.is_some() {
            dev.schedule_removal_timer();
            return;
        }

        let mut files = StringArrayHashMap::default();
        let mut entry_points = EntryPointList::empty();
        {
            let _g = dev.graph_safety_lock.guard();
            if !dev.settle_removals(&mut files, true) {
                return;
            }
            bun_core::handle_oom(dev.server_graph.invalidate(files.keys(), &mut entry_points));
            bun_core::handle_oom(dev.client_graph.invalidate(files.keys(), &mut entry_points));
            if entry_points.set.count() == 0 {
                return;
            }
            dev.append_tailwind_stylesheets(&mut entry_points);
        }
        dev.start_reload_bundle(entry_points, Instant::now());
    }
}
