//! Holds a hot reload whose event names a half-saved file: a save empties or renames the file before it writes the text.

use super::*;
use std::cell::RefCell;
use std::time::Duration;

/// A hold ends this many times the wait for one file after it starts, at the latest.
const MAX_WAITS: u32 = 10;

thread_local! {
    /// The dev servers of this thread that hold a reload.
    static HOLDING: RefCell<Vec<*mut DevServer>> = const { RefCell::new(Vec::new()) };
}

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
    /// In the order of their deadlines.
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

/// How long one half-saved file holds a reload.
fn wait() -> Duration {
    let ms = bun_core::env_var::BUN_DEBUG_TEST_DEV_SERVER_HALF_SAVED_WAIT_MS
        .get()
        .unwrap_or(100);
    Duration::from_millis(ms.min(u32::MAX as u64))
}

/// A held file has its text when no look saw its size change for this long: a writer can use more than one write.
fn settle() -> Duration {
    let ms = bun_core::env_var::BUN_DEBUG_TEST_DEV_SERVER_HALF_SAVED_SETTLE_MS
        .get()
        .unwrap_or(5);
    Duration::from_millis(ms.min(u32::MAX as u64))
}

/// `None` for a file that does not exist.
fn size_of_existing_file(path: &[u8]) -> Option<u64> {
    let mut buf = paths::path_buffer_pool::get();
    let stat = sys::stat(paths::resolve_path::z(path, &mut *buf)).ok()?;
    Some(stat.st_size as u64)
}

/// 0 for a file that does not exist.
fn size_of_file(path: &[u8]) -> u64 {
    size_of_existing_file(path).unwrap_or(0)
}

/// Ends the holds of this thread. A run loop calls this before it waits with no timers: `bun --hot` after an uncaught error.
pub(crate) fn release_half_saved_holds() {
    if HOLDING.with(|holding| holding.borrow().is_empty()) {
        return;
    }
    for dev in HOLDING.with(|holding| holding.borrow().clone()) {
        // SAFETY: a dev server leaves `HOLDING` when its hold ends, and `Drop` ends its hold.
        unsafe { (*dev).release_half_saved_hold(true) };
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
            if size_of_file(path) != 0 {
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
            let dev: *mut DevServer = self;
            HOLDING.with(|holding| holding.borrow_mut().push(dev));
        }
        let hold = self.half_saved_hold.as_mut().expect("set above");
        let mut joined = !entry_points.set.is_empty();
        // A bundle of these files now would read the half-saved files that they import.
        bun_core::handle_oom(hold.entry_points.append_list(entry_points));
        let deadline = (now + wait()).min(hold.last_deadline);
        for path in half_saved {
            if !hold.files.contains(&path) {
                let file = HeldFile {
                    size: 0,
                    size_since: now,
                    deadline,
                };
                bun_core::handle_oom(hold.files.put(&path, file));
                joined = true;
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
                hold.first_with_time_left = i + 1;
                continue;
            }
            let size = size_of_file(&hold.files.keys()[i]);
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

    /// Takes the hold out of the timer heap and out of `HOLDING`.
    pub(crate) fn take_half_saved_hold(&mut self) -> Option<HalfSavedHold> {
        let hold = self.half_saved_hold.take()?;
        if self.half_saved_hold_timer.state == EventLoopTimerState::ACTIVE {
            let timer: *mut EventLoopTimer = &raw mut self.half_saved_hold_timer;
            self.timer_heap().remove(timer);
        }
        let dev: *mut DevServer = self;
        HOLDING.with(|holding| holding.borrow_mut().retain(|held| *held != dev));
        Some(hold)
    }

    fn end_half_saved_hold(&mut self) -> HalfSavedHold {
        let hold = self.take_half_saved_hold().expect("the caller saw a hold");
        for path in hold.files.keys() {
            // This file was saved empty. The next event that finds it empty starts no hold.
            if size_of_existing_file(path) == Some(0) {
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
