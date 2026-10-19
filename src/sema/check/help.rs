//! Lets idle workers help with a slow type comparison.
//!
//! A task checks a file on one thread, and a single comparison can take half a second, for example between two
//! instantiations of an interface with a hundred generic methods. Once the queue is empty, the other workers would
//! only wait for that thread. Instead each of them runs the same comparison in a separate task, called a helper.
//!
//! - **A helper visits no file and never commits.** Like any task, it writes entries that don't have to wait for a commit
//!   to the shared tables (`Task::may_write_immediately`), and publishes the diagnostics that belong to them.
//! - **Comparison results are stored in the request's cache** (`HelpRequest::cache`), not in `Program::relations`. That applies to
//!   the helpers, and to the requesting task once it has a helper. All of them fall back to that cache on a miss in
//!   `Program::relations`. The requesting task also stores what it computes, and what it finds there, in its own
//!   buffer, so its next commit publishes those entries.
//! - **Each helper starts at a different property.** Tasks that do the same work in the same order compute every entry at
//!   the same time, so none of them gets a cache hit. See `Checker::property_order`. The requesting task keeps
//!   TypeScript's order.
//! - **Nothing waits for a helper.** The requesting task runs as if it had none, and closes the request when its
//!   comparison ends. A helper notices at its next comparison and exits through `Relater::overflow`, like a
//!   comparison that runs out of stack. No query is refused, so whatever else the helper is evaluating finishes
//!   normally.
//! - **A thread that waits for a variance claim helps too** (`commit::Claims`). Its helper runs on top of the waiting task's
//!   stack, and exits at its first comparison after the claim has ended. To keep that delay short, such a helper exits
//!   instead of waiting for a claim. It never has one either, because an aborted measurement counts as a failed claim.
//! - **Help doesn't move a limit.** TypeScript gives up on a comparison that leads to too many others (2859) and on a
//!   statement that instantiates too much (2589). A cache hit skips everything below that comparison, so a task counts
//!   less with help than without. Without help it can't count more than the task and its helpers do together. If that sum
//!   reaches a limit, the task is discarded like any task that gives up at a limit: its file waits for the last round,
//!   whose task never requests help. The request's cache is dropped, so that task hits none of those entries.

use super::Checker;
use super::commit::{IfTaken, VarianceClaim};
use super::relate::{Key, Relater, Relation};
use super::task::Stored;
use crate::program::Sym;
use crate::table::Id;
use crate::types::TypeId;
use crate::util::{FxHashMap, fx_hash};
use bun_threading::{Condvar, Guarded};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

/// The work that a task requests help with.
#[derive(Copy, Clone)]
enum Work {
    /// The arguments of `Checker::related`.
    Comparison(TypeId, TypeId, Relation),
}

pub struct HelpRequest {
    work: Work,
    is_open: AtomicBool,
    /// True once a helper has finished the work. The requesting task is about to hit its result.
    is_answered: AtomicBool,
    /// Bit `n` is set if no helper has the number `n`.
    free_numbers: AtomicU32,
    has_had_helper: AtomicBool,
    /// Entries for `Program::relations`, sharded by the key's hash.
    cache: [Guarded<FxHashMap<Key, u8>>; CACHE_SHARDS],
    cache_len: AtomicU64,
    /// Sum of the helpers' `Checker::instantiation_count`.
    instantiations: AtomicU64,
}

const CACHE_SHARDS: usize = 16;

/// See `Checker::property_order`.
const MAX_HELPERS: u32 = 3;

impl HelpRequest {
    /// Returns the caller's helper number, starting at 1. Returns `None` if the request needs no helper or has enough.
    /// Only one thread at a time calls this.
    fn join(&self) -> Option<u32> {
        let free = self.free_numbers.load(Ordering::Relaxed);
        let needs_help =
            self.is_open.load(Ordering::Acquire) && !self.is_answered.load(Ordering::Relaxed);
        if !needs_help || free == 0 {
            return None;
        }
        let number = free.trailing_zeros();
        (self.free_numbers).fetch_and(!(1 << number), Ordering::Relaxed);
        self.has_had_helper.store(true, Ordering::Relaxed);
        Some(number)
    }

    fn shard(&self, key: &Key) -> &Guarded<FxHashMap<Key, u8>> {
        &self.cache[(fx_hash(key) >> 60) as usize % CACHE_SHARDS]
    }
}

/// State that a round's workers wait on, and where tasks post help requests.
#[derive(Default)]
pub struct HelpBoard {
    pub activity: Guarded<Activity>,
    pub activity_has_changed: Condvar,
    helpers_started: AtomicU32,
}

/// The round number of helper tasks.
const HELPER_ROUND: u32 = u32::MAX;

/// State that a worker with no files left waits on.
#[derive(Default)]
pub struct Activity {
    /// Number of workers looking for a file or running a task other than a helper.
    pub active: usize,
    /// Number of workers waiting.
    pub waiting: usize,
    /// Counts commits, discards and help requests.
    pub changes: u64,
    requests: Vec<Arc<HelpRequest>>,
}

impl Activity {
    /// Joins an open request that isn't in `excluded`. Returns it with the caller's helper number.
    pub fn join_request(&self, excluded: &[Arc<HelpRequest>]) -> Option<(Arc<HelpRequest>, u32)> {
        let is_excluded =
            |it: &Arc<HelpRequest>| excluded.iter().any(|other| Arc::ptr_eq(it, other));
        let mut requests = self.requests.iter().filter(|it| !is_excluded(it));
        requests.find_map(|it| Some((Arc::clone(it), it.join()?)))
    }
}

/// A task requests help with a comparison that has led to this many others. The value affects speed, never results.
const COMPARISONS_BEFORE_REQUEST: u32 = 2048;

/// Number of comparisons between two limit checks in the requesting task.
const COMPARISONS_PER_LIMIT_CHECK: u32 = 1024;

/// The fields of `Checker` that only this module uses.
#[derive(Default)]
pub(super) struct HelpState {
    /// Where the task posts requests. `None` if it never does.
    board: Option<Arc<HelpBoard>>,
    /// The outermost property comparison in progress.
    in_progress: Option<Work>,
    /// `Relater::relation_count` when `in_progress` began.
    budget: i32,
    /// Number of comparisons since `in_progress` began. In a helper, since the helper began.
    comparisons: u32,
    /// The task's open request, or the request that it helps with.
    request: Option<Arc<HelpRequest>>,
    /// 0 unless the task is a helper.
    helper_number: u32,
    /// In a helper, `Checker::instantiation_count` at the last report.
    instantiations_reported: u32,
    /// In a helper on a waiting thread, the symbol whose variance claim that thread waits for.
    exits_after_claim: Option<Sym>,
}

impl<'s> Checker<'_, 's> {
    /// Call after `see_commits`. Makes the task post a request on `board` when a comparison is slow.
    pub fn request_help_on(&mut self, board: Arc<HelpBoard>) {
        self.help.board = Some(board);
    }

    /// Call before comparing the properties of `source` and `target`. Returns true if this is the outermost such
    /// comparison and another task could run it. The caller must then call `end_property_comparison`.
    #[inline]
    pub(super) fn begin_property_comparison(
        &mut self,
        source: TypeId,
        target: TypeId,
        r: &Relater,
    ) -> bool {
        let is_outermost = self.help.in_progress.is_none()
            && self.help.board.is_some()
            && !self.in_variance_computation
            && source.local_number().is_none()
            && target.local_number().is_none();
        if is_outermost {
            self.help.in_progress = Some(Work::Comparison(source, target, r.relation));
            self.help.budget = r.relation_count;
            self.help.comparisons = 0;
        }
        is_outermost
    }

    #[inline]
    pub(super) fn end_property_comparison(&mut self) {
        self.help.in_progress = None;
        if self.help.request.is_some() {
            self.close_request();
        }
    }

    #[cold]
    fn close_request(&mut self) {
        self.discard_if_near_limit();
        if let Some(request) = self.help.request.take() {
            request.is_open.store(false, Ordering::Release);
            if let Some(board) = &self.help.board {
                let mut activity = board.activity.lock();
                activity.requests.retain(|it| !Arc::ptr_eq(it, &request));
            }
        }
    }

    /// See "Help doesn't move a limit" in the module docs. Call while the task has an open request.
    fn discard_if_near_limit(&mut self) {
        let Some(request) = &self.help.request else {
            return;
        };
        let comparisons =
            u64::from(self.help.comparisons) + request.cache_len.load(Ordering::Relaxed);
        let budget = u64::try_from(self.help.budget).unwrap_or(0);
        let instantiations =
            u64::from(self.instantiation_count) + request.instantiations.load(Ordering::Relaxed);
        // The margin is for what the helpers have instantiated since their last comparison.
        if comparisons >= budget || instantiations >= 5_000_000 - 1_000_000 {
            self.note_gave_up("a limit that it may have reached without help");
        }
    }

    /// Call before a comparison that missed every cache. Returns true in a helper that has no reason to continue.
    #[inline]
    pub(super) fn count_comparison(&mut self) -> bool {
        if self.help.in_progress.is_none() && self.help.helper_number == 0 {
            return false;
        }
        self.help.comparisons = self.help.comparisons.saturating_add(1);
        if self.help.request.is_none() && self.help.comparisons != COMPARISONS_BEFORE_REQUEST {
            return false;
        }
        self.after_counting_comparison()
    }

    #[cold]
    fn after_counting_comparison(&mut self) -> bool {
        if self.help.helper_number != 0 {
            return self.report_as_helper();
        }
        if self.help.request.is_none() {
            self.post_request();
        } else if (self.help.comparisons).is_multiple_of(COMPARISONS_PER_LIMIT_CHECK) {
            self.discard_if_near_limit();
        }
        false
    }

    fn post_request(&mut self) {
        let (Some(work), Some(board)) = (self.help.in_progress, self.help.board.clone()) else {
            return;
        };
        if self.task.was_discarded() {
            return;
        }
        let request = Arc::new(HelpRequest {
            work,
            is_open: AtomicBool::new(true),
            is_answered: AtomicBool::new(false),
            free_numbers: AtomicU32::new(((1 << MAX_HELPERS) - 1) << 1),
            has_had_helper: AtomicBool::new(false),
            cache: Default::default(),
            cache_len: AtomicU64::new(0),
            instantiations: AtomicU64::new(0),
        });
        self.help.request = Some(Arc::clone(&request));
        let mut activity = board.activity.lock();
        activity.requests.push(request);
        activity.changes += 1;
        if activity.waiting != 0 {
            board.activity_has_changed.notify_all();
        }
        drop(activity);
        self.p.wake_claim_waiters();
    }

    /// Adds the helper's instantiations to the request's count. Discards the helper and returns true if it has no
    /// reason to continue.
    fn report_as_helper(&mut self) -> bool {
        let Some(request) = &self.help.request else {
            return false;
        };
        let (now, reported) = (self.instantiation_count, self.help.instantiations_reported);
        // The count restarts from 0 whenever nothing is in progress.
        let more = now.checked_sub(reported).unwrap_or(now);
        (request.instantiations).fetch_add(u64::from(more), Ordering::Relaxed);
        self.help.instantiations_reported = now;
        // A discarded task shares nothing anymore.
        let is_useless = !request.is_open.load(Ordering::Acquire) || self.task.was_discarded();
        let is_wait_over =
            !is_useless && (self.help.exits_after_claim).is_some_and(|sym| !self.p.is_claimed(sym));
        if is_wait_over {
            self.make_room_for_another_helper();
        }
        if is_useless || is_wait_over {
            self.task.discard("the early exit of a helper");
        }
        is_useless || is_wait_over
    }

    /// Call in a helper right before it's discarded for a reason that doesn't apply to other threads. One of them can
    /// continue where this one stops.
    fn make_room_for_another_helper(&self) {
        if let Some(request) = &self.help.request {
            let number = self.help.helper_number;
            (request.free_numbers).fetch_or(1 << number, Ordering::Relaxed);
        }
    }

    #[inline]
    pub(super) fn is_helper(&self) -> bool {
        self.help.helper_number != 0
    }

    /// True if the task's comparison results are stored in `HelpRequest::cache`: it's a helper, or it has one. Entries
    /// stored during a variance measurement can be replaced, so they aren't.
    #[inline]
    pub(super) fn uses_request_cache(&self) -> bool {
        (self.help.request.as_ref()).is_some_and(|it| it.has_had_helper.load(Ordering::Relaxed))
            && !self.in_variance_computation
    }

    /// Stores an entry for `Program::relations` in the request's cache and in the task's buffer. Returns false and stores
    /// nothing if the entry couldn't be shared right away.
    pub(super) fn store_in_request_cache(&mut self, key: Key, entry: u8, stored: Stored) -> bool {
        let Some(request) = &self.help.request else {
            return false;
        };
        if !(self.p.relations).insert_deferred(&self.task, key, entry, stored) {
            return false;
        }
        if request.shard(&key).lock().insert(key, entry).is_none() {
            request.cache_len.fetch_add(1, Ordering::Relaxed);
        }
        true
    }

    /// Returns the entry in the request's cache, and copies it to the task's buffer.
    pub(super) fn find_in_request_cache(&mut self, key: &Key) -> Option<u8> {
        let entry = *self.help.request.as_ref()?.shard(key).lock().get(key)?;
        let stored = Stored::since(self.task.held_back());
        (self.p.relations).insert_deferred(&self.task, *key, entry, stored);
        Some(entry)
    }

    /// Returns the order in which the task compares `count` properties: the index of the first one, and true if it
    /// continues with lower indexes. It wraps around at the end.
    ///
    /// The requesting task starts at 0 and moves up. Helper 1 starts at the end and moves down, so the two meet where
    /// each has done half of the work, wherever the slow properties are. Helpers 2 and 3 start in the middle and move
    /// apart, which does the same for each half.
    #[inline]
    pub(super) fn property_order(&self, count: usize) -> (usize, bool) {
        let number = self.help.helper_number as usize;
        if number == 0 || count == 0 {
            return (0, false);
        }
        let start = if number == 1 { 0 } else { count / 2 };
        match number % 2 {
            0 => (start % count, false),
            _ => ((start + count - 1) % count, true),
        }
    }

    /// Runs the work of `request` as its helper `number`, in a separate task. Call on a new checker.
    pub fn run_as_helper(&mut self, board: &HelpBoard, request: Arc<HelpRequest>, number: u32) {
        let index = board.helpers_started.fetch_add(1, Ordering::Relaxed);
        self.begin_task(HELPER_ROUND, index);
        self.see_commits(false);
        let work = request.work;
        (self.help.request, self.help.helper_number) = (Some(request), number);
        match work {
            Work::Comparison(source, target, relation) => {
                self.related(source, target, relation);
            }
        }
        if !self.report_as_helper()
            && let Some(request) = &self.help.request
        {
            request.is_answered.store(true, Ordering::Relaxed);
        }
        self.task.discard("the end of a helper");
        // Publishes the diagnostics that belong to the entries that the task wrote to the shared tables.
        self.commit_after_file(true);
        self.end_task_after_commits();
    }

    /// `Program::claim_variances`, except that the thread helps with open requests while `sym` is claimed. Returns
    /// `VarianceClaim::Taken` only in a helper that's now discarded and exits at its next comparison.
    pub(super) fn claim_variances_or_help(
        &mut self,
        sym: Sym,
        may_claim: bool,
    ) -> VarianceClaim<'s> {
        if self.help.exits_after_claim.is_some() {
            let claim = self.p.claim_variances(sym, false, IfTaken::Return);
            if matches!(claim, VarianceClaim::Taken) && !self.task.was_discarded() {
                self.make_room_for_another_helper();
                self.task
                    .discard("a claim that a helper would have to wait for");
            }
            return claim;
        }
        let Some(board) = self.help.board.clone() else {
            return self.p.claim_variances(sym, may_claim, IfTaken::Wait);
        };
        // The thread helps with each request at most once, so every turn of the loop that doesn't wait adds to this.
        let mut excluded: Vec<Arc<HelpRequest>> = self.help.request.iter().cloned().collect();
        loop {
            match self.p.claim_variances(sym, may_claim, IfTaken::Return) {
                VarianceClaim::Taken => {}
                claim => return claim,
            }
            let joined = board.activity.lock().join_request(&excluded);
            let Some((request, number)) = joined else {
                self.p.wait_while_claimed(sym);
                continue;
            };
            excluded.push(Arc::clone(&request));
            let mut helper = Box::new(self.p.checker_reusing(None));
            helper.set_requested(self.expected);
            (helper.stack_base, helper.stack_limit) = (self.stack_base, self.stack_limit);
            helper.help.exits_after_claim = Some(sym);
            helper.run_as_helper(&board, request, number);
        }
    }
}
