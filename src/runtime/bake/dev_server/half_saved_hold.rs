//! Holds a hot reload whose event names a half-saved file: a save empties or renames the file before it writes the text.

use super::*;
use core::cell::RefCell;
use core::ptr::NonNull;
use std::time::Duration;

/// One half-saved file holds a reload for this long.
const WAIT_MS: u64 = 100;
/// A held file has its text when no look saw its size change for this long: a writer can use more than one write.
const SETTLE_MS: u64 = 5;
/// A hold ends this many times the wait for one file after it starts, at the latest.
const MAX_WAITS: u32 = 10;

/// The dev servers of one VM that hold a reload.
pub(crate) type HoldingDevServers = RefCell<Vec<NonNull<DevServer>>>;

struct HeldFile {
    /// At the last look. 0: empty or missing.
    size: u64,
    /// The time of the look that first saw `size`.
    size_since: Instant,
    /// This file does not hold the reload after this time.
    deadline: Instant,
}

impl HeldFile {
    /// The time at which this file stops to hold the reload, if its size stays the same.
    fn holds_until(&self) -> Instant {
        if self.size == 0 {
            self.deadline
        } else {
            (self.size_since + settle()).min(self.deadline)
        }
    }
}

pub(crate) struct HalfSavedHold {
    entry_points: EntryPointList,
    files: StringArrayHashMap<HeldFile>,
    /// The files before this index are past their deadline.
    first_with_time_left: usize,
    /// `HotReloadEvent.timer` of the first event.
    timer: Instant,
    /// No file gets a deadline after this time.
    last_deadline: Instant,
}

impl HalfSavedHold {
    pub(crate) fn memory_cost(&self) -> usize {
        super::memory_cost::memory_cost_array_hash_map(&self.entry_points.set)
            + super::memory_cost::memory_cost_array_hash_map(&self.files)
    }
}

fn wait() -> Duration {
    let ms = bun_core::env_var::BUN_DEBUG_TEST_DEV_SERVER_HALF_SAVED_WAIT_MS
        .get()
        .unwrap_or(WAIT_MS);
    Duration::from_millis(ms.min(u32::MAX as u64))
}

fn settle() -> Duration {
    let ms = bun_core::env_var::BUN_DEBUG_TEST_DEV_SERVER_HALF_SAVED_SETTLE_MS
        .get()
        .unwrap_or(SETTLE_MS);
    Duration::from_millis(ms.min(u32::MAX as u64))
}

/// `None` for a file that does not exist. A file with another `stat` error is not half-saved.
fn size_of_file(path: &[u8]) -> sys::Maybe<Option<u64>> {
    let mut buf = paths::path_buffer_pool::get();
    match sys::stat(paths::resolve_path::z(path, &mut *buf)) {
        Ok(stat) => Ok(Some(stat.st_size as u64)),
        Err(err) if err.get_errno() == sys::E::ENOENT => Ok(None),
        Err(err) => Err(err),
    }
}

/// Ends the holds of the dev servers of `vm`. A run loop calls this before it waits with no timers: `bun --hot` after an uncaught error.
pub(crate) fn release_half_saved_holds(vm: &VirtualMachine) {
    let holding = match crate::jsc_hooks::half_saved_holds(vm) {
        Some(holding) => holding.borrow().clone(),
        None => return,
    };
    for dev in holding {
        // SAFETY: a dev server leaves the list when its hold ends, and `Drop` ends its hold.
        unsafe { (*dev.as_ptr()).release_half_saved_hold(true) };
    }
}

impl DevServer {
    /// Adds to `half_saved` the files of `changed` that a graph owns and that are empty or missing now.
    pub(crate) fn find_half_saved_files(
        &mut self,
        changed: &[Box<[u8]>],
        half_saved: &mut Vec<Box<[u8]>>,
    ) {
        // A testing batch decides when its files are bundled.
        let batching = !matches!(self.testing_batch_events, TestingBatchEvents::Disabled);
        if wait().is_zero() || (batching && self.files_left_empty.is_empty()) {
            return;
        }
        let _g = self.graph_safety_lock.guard();
        for path in changed {
            if self.client_graph.bundled_files.get_index(path).is_none()
                && self.server_graph.bundled_files.get_index(path).is_none()
            {
                continue;
            }
            // The bundle reports a file that `stat` fails on.
            let Ok(size) = size_of_file(path) else {
                continue;
            };
            if size.unwrap_or(0) != 0 {
                self.files_left_empty.swap_remove(path);
            } else if !batching && !self.files_left_empty.contains(path) {
                half_saved.push(path.clone());
            }
        }
    }

    /// Returns true if `entry_points` now wait in the hold. If the hold ends here, `entry_points` and `timer` get what it held, and the caller bundles them.
    pub(crate) fn hold_half_saved(
        &mut self,
        entry_points: &mut EntryPointList,
        half_saved: Vec<Box<[u8]>>,
        timer: &mut Instant,
    ) -> bool {
        // A testing batch decides when its files are bundled. A hold that ends during the batch puts its files in it.
        if !matches!(self.testing_batch_events, TestingBatchEvents::Disabled) {
            return false;
        }
        let now = Instant::now();
        if self.half_saved_hold.is_none() {
            if half_saved.is_empty() {
                return false;
            }
            self.half_saved_hold = Some(HalfSavedHold {
                entry_points: EntryPointList::empty(),
                files: StringArrayHashMap::default(),
                first_with_time_left: 0,
                timer: *timer,
                last_deadline: now + wait() * MAX_WAITS,
            });
            let dev = NonNull::from(&mut *self);
            if let Some(holding) = crate::jsc_hooks::half_saved_holds(self.vm()) {
                holding.borrow_mut().push(dev);
            }
        }
        let hold = self.half_saved_hold.as_mut().expect("set above");
        let mut joined = !entry_points.set.is_empty();
        // A bundle of these files now would read the half-saved files that they import.
        bun_core::handle_oom(hold.entry_points.append_list(entry_points));
        let deadline = (now + wait()).min(hold.last_deadline);
        for path in half_saved {
            let file = HeldFile {
                size: 0,
                size_since: now,
                deadline,
            };
            match hold.files.get_index(&path) {
                None => {
                    bun_core::handle_oom(hold.files.put(&path, file));
                    joined = true;
                }
                // A look saw the text of this file, and a later save emptied it again.
                Some(i) if hold.files.values()[i].size != 0 => {
                    hold.files.values_mut()[i] = file;
                    hold.first_with_time_left = hold.first_with_time_left.min(i);
                }
                Some(_) => {}
            }
        }
        if joined {
            self.publish(
                HmrTopic::TestingWatchSynchronization,
                &[MessageId::TestingWatchSynchronization.char(), 5],
                Opcode::BINARY,
            );
        }
        if !self.look_at_half_saved_files() {
            return true;
        }
        let hold = self.end_half_saved_hold();
        *entry_points = hold.entry_points;
        *timer = hold.timer;
        false
    }

    /// Returns true if no held file holds the reload any more. If one does, the timer fires when the last of them stops.
    fn look_at_half_saved_files(&mut self) -> bool {
        let Some(hold) = self.half_saved_hold.as_mut() else {
            return false;
        };
        let now = Instant::now();
        let mut wait_until: Option<Instant> = None;
        for i in hold.first_with_time_left..hold.files.count() {
            if now >= hold.files.values()[i].deadline {
                if i == hold.first_with_time_left {
                    hold.first_with_time_left = i + 1;
                }
                continue;
            }
            // The bundle reports a file that `stat` fails on.
            let Ok(size) = size_of_file(&hold.files.keys()[i]) else {
                continue;
            };
            let size = size.unwrap_or(0);
            let file = &mut hold.files.values_mut()[i];
            if size != file.size {
                file.size = size;
                file.size_since = now;
            }
            let until = file.holds_until();
            if now < until {
                wait_until = Some(wait_until.map_or(until, |latest| latest.max(until)));
            }
        }
        let Some(until) = wait_until else {
            return true;
        };
        let wait_ms = until
            .saturating_duration_since(now)
            .as_micros()
            .div_ceil(1000)
            .max(1);
        let timer: *mut EventLoopTimer = &raw mut self.half_saved_hold_timer;
        let at = bun_core::Timespec::ms_from_now(
            bun_core::TimespecMockMode::ForceRealTime,
            wait_ms as i64,
        );
        self.timer_heap().update(timer, &at);
        false
    }

    /// Takes the hold out of the timer heap and out of the list of the VM.
    pub(crate) fn take_half_saved_hold(&mut self) -> Option<HalfSavedHold> {
        let hold = self.half_saved_hold.take()?;
        if self.half_saved_hold_timer.state == EventLoopTimerState::ACTIVE {
            let timer: *mut EventLoopTimer = &raw mut self.half_saved_hold_timer;
            self.timer_heap().remove(timer);
        }
        let dev: *mut DevServer = self;
        if let Some(holding) = crate::jsc_hooks::half_saved_holds(self.vm()) {
            holding.borrow_mut().retain(|held| held.as_ptr() != dev);
        }
        Some(hold)
    }

    fn end_half_saved_hold(&mut self) -> HalfSavedHold {
        let hold = self.take_half_saved_hold().expect("the caller saw a hold");
        for path in hold.files.keys() {
            // This file was saved empty. The next event that finds it empty starts no hold.
            if matches!(size_of_file(path), Ok(Some(0))) {
                bun_core::handle_oom(self.files_left_empty.put(path, ()));
            }
        }
        self.publish(
            HmrTopic::TestingWatchSynchronization,
            &[MessageId::TestingWatchSynchronization.char(), 6],
            Opcode::BINARY,
        );
        hold
    }

    pub(crate) fn on_half_saved_hold_timer(timer: *mut EventLoopTimer) {
        // SAFETY: `timer` points to the `half_saved_hold_timer` field of a DevServer.
        let dev: &mut DevServer = unsafe { &mut *DevServer::from_half_saved_hold_timer_ptr(timer) };
        debug_assert!(dev.magic == Magic::Valid);
        dev.half_saved_hold_timer.state = EventLoopTimerState::FIRED;
        dev.release_half_saved_hold(false);
    }

    /// Bundles what the hold keeps, if no file holds the reload any more or `force` is set. While another bundle runs, `finalize_bundle_cleanup` calls this again.
    pub(crate) fn release_half_saved_hold(&mut self, force: bool) {
        bun_removable_features::removable_definition!(Bundler, Self::release_half_saved_hold);
        if self.half_saved_hold.is_none() || self.current_bundle.is_some() {
            return;
        }
        if !force && !self.look_at_half_saved_files() {
            return;
        }
        let hold = self.end_half_saved_hold();
        if hold.entry_points.set.is_empty() {
            return;
        }
        match &mut self.testing_batch_events {
            TestingBatchEvents::Enabled(batch) | TestingBatchEvents::ReleaseAfterBundle(batch) => {
                bun_core::handle_oom(batch.append(&hold.entry_points));
                self.publish(
                    HmrTopic::TestingWatchSynchronization,
                    &[MessageId::TestingWatchSynchronization.char(), 1],
                    Opcode::BINARY,
                );
            }
            TestingBatchEvents::Disabled | TestingBatchEvents::EnableAfterBundle => {
                self.start_async_bundle(hold.entry_points, true, hold.timer)
                    .expect("OOM");
            }
        }
    }
}
