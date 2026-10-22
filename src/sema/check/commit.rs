//! Commits: how tasks share what they compute while they run.
//!
//! Every thread takes the next task from one list. A task stores its results in its task-local part of the tables and
//! logs each key (`crate::local::Log`). After every file, and occasionally within a file while it's idle, the task
//! commits (`Checker::commit`): on its own thread, it stores everything it has logged since its last commit in the
//! shared part, where running tasks find it. The records are already shared (`Sharing::Publishes`), so entries don't
//! need rewriting.
//!
//! Which task gets anywhere first depends on timing. These rules keep the report a function of the program:
//!
//! - **One commit at a time.** Commits store under one mutex and are numbered from 1 in that order. The first entry for
//!   a key wins.
//! - **A task that finds an entry also finds everything stored before it.** It doesn't evaluate the entry, so it misses
//!   whatever that evaluation stored along the way unless it can find that too. A commit first stores the entries keyed
//!   by a record, in log order, each with a release store, so an entry becomes visible after everything that was stored
//!   while it was evaluated. Then it stores the entries keyed by a node or a symbol, each stamped with the commit's
//!   number (`ByNode::stamps`). Then it announces that it has stored everything (`Numbers::stored`). Only then do the
//!   entries with its number become visible, so they appear all at once, after the record-keyed entries.
//! - **A file doesn't change under a statement.** The first time a task looks up a node of some file in a table, hit or
//!   miss, it records the number of the last commit that has stored everything (`View::snapshot_of`). Until its own
//!   walk reaches the next statement or deferred node with nothing in progress, entries under that file's nodes with a
//!   higher number don't exist for it.
//! - **The file a task visits doesn't change during the visit.** Its snapshot is taken when the visit begins and kept
//!   to the end (`View::pin`). The task finds its own entries in its task-local part.
//! - **A commit is valid or none of it is stored.** Some results depend on which of two evaluations came first in their
//!   checker, and `Program::is_invalid` detects them. The serial order that a commit is compared with is the order of
//!   the commits. An invalid commit discards what the task has done since its last commit. The task ends, and the
//!   driver rechecks the file it was visiting right away, on any thread. The new task starts after the commit that the
//!   old one conflicted with, so it finds those variances.
//! - **A task that gives up at a limit isn't trusted** (`Checker::note_gave_up`). How far from a limit a computation
//!   starts depends on what was computed before, which for a task includes the entries it found. It's discarded like an
//!   invalid one, but its file waits for the last round.
//! - **A cycle is entered from the first file that leads to it.** What a query gets when it comes back around to
//!   itself, or to a partial result it already has in place, depends on where the checker entered the cycle
//!   (`Checker::close_ring_from`). `tsc --singleThreaded` enters from the first file in program order that leads there.
//!   So a task is only trusted about a cycle if every file before the one it's visiting is checked for good. None of
//!   those files leads to the cycle, or the task would have found the members' results (`Task::close_cycle`). Any other
//!   task is discarded, and the driver rechecks its file once all earlier files are done.
//!   - Earlier files that can't reach the cycle don't matter. If only importers of the current file can reach it, the task
//!     is trusted once the earlier files of its own import cycle are done (`Checker::is_reachable_only_by_importers`).
//!   - A discarded task stops at its next statement. The driver rechecks its file as soon as a commit resolves that cycle
//!     (`Program::is_cycle_resolved`), on any thread. The recheck can be discarded at the file's next unresolved cycle.
//!   - Once a file is discarded, one worker switches from the heavy files to the first unchecked files of the program, so
//!     cycles that everything uses are resolved early.
//! - **A cycle is seen whole or not at all.** A task has a snapshot per file but none for the record-keyed entries. So
//!   it could miss one member of a cycle and hit the next, which doesn't close a cycle and isn't what any entry point
//!   produces. The commit of a task that was trusted about a cycle follows a file, so none of it is withheld, and it
//!   announces itself before it stores its first entry (`Numbers::with_a_cycle`). A task that hasn't been idle since
//!   then publishes nothing immediately (`Task::overlaps_a_cycle_commit`). It's discarded if it has stored under a key
//!   that the commit lists for its cycles (`Task::take_logged_at_cycles`), because that means it missed that entry
//!   (`Checker::discard_if_missed_cycle_member`).
//! - **The last round** is one task that checks the files that are still discarded, in program order, while nothing
//!   else runs. It finds everything that was committed. Whatever it computes at a limit is final, as with a single
//!   checker. It commits once, when it ends (`Checker::is_commit_due`).
//! - **A diagnostic travels with the entry of the query that reported it**, in the same commit. It stays even if the
//!   task is discarded later, because the recheck hits the cached entry and never reports the error. If the entry loses
//!   the race, its diagnostic is dropped too (`Program::drop_diagnostics_of_losers`). Diagnostics from a file's own
//!   walk belong to the file and are published by the commit that follows the end of the file. So are the entries the
//!   task stored under the file's nodes (`Checker::withhold_until_the_file_ends`), with the diagnostics reported for
//!   them.
//! - **The first task in program order that gets to an error decides whether it's reported.** tsc ignores an error that a
//!   later file causes in an earlier one, so a task only reports in its own file and in later files
//!   (`Checker::is_left_to_an_earlier_file`). And whether tsc reports an error can depend on the context in which it first
//!   gets there. So a task ignores what a task of a later file has stored under a file, if the later task found an error
//!   there and this task would still report it (`View::hides`). A task only moves forward in program order, so it
//!   never finds such entries of its own. This covers the entries under nodes, not those under records.
//! - **What a task stores about an expression of the file it visits never leaves the task**
//!   (`crate::table::Location::KEEPS_VISITED_FILE_LOCAL`). That's most of what a check stores, and other tasks rarely
//!   look it up. It's neither logged nor counted as a `Task::hold_back`.
//! - **A record-keyed entry doesn't wait for a commit if nothing it depends on does** (`Task::may_write_immediately`).
//!   That requires that neither its key nor its value is bound, and that since its evaluation began nothing was stored
//!   that waits for a commit and nothing was read that's only valid for the checker's current stack
//!   (`Task::hold_back`). Then everything its evaluation stored was also published immediately, before it. An entry
//!   that's published immediately can't be rolled back. So a task stops publishing immediately from the moment
//!   something happens that may get it discarded, or it stores the result of a resolution cycle, until its next commit
//!   (`Task::stop_writing_immediately`).
//! - **Results that depend on how deep the checker was never leave the task**: a base constraint that was cut short, a
//!   comparison that succeeded because two types inside it counted as deeply nested, and the constraints and
//!   comparisons that follow from either (`Checker::constraints_of_this_task`, `relations_of_this_task`). In a shared
//!   table the first such result would stick for every task. They stay for the rest of the task, because its other
//!   tables keep what was derived from them for that long.
//! - Variances don't wait for a commit either. See `Claims`.

use super::task::{Task, tables_of, tables_written_immediately};
use super::{Checker, Program, Spare};
use crate::local::{Log, node_word};
use crate::program::{FileId, Sym};
use crate::session::Arena;
use crate::table::Publish;
use crate::util::{FxHashMap, SharedSort};
use bun_threading::{Condvar, Guarded};
use std::cell::{Cell, RefCell};
use std::sync::atomic::{AtomicU32, Ordering};

/// A field of `Program`.
pub(super) struct Commits<'s> {
    /// `Checker::commit`'s mutex, around the last commit's number.
    committing: Guarded<u32>,
    numbers: &'s Numbers,
    claims: Claims,
    /// The commits of tasks that `Task::close_cycle` trusted, ordered by number.
    cycle_commits: Guarded<Vec<CycleCommit>>,
    /// `Files::rank_of_file`, indexed by file.
    ranks_of_files: &'s [u32],
    /// One bit per file. Set once a task that was checking another file has found an error while evaluating something
    /// about this file, and has committed. See `View::hides`.
    with_errors: &'s [AtomicU32],
    /// `tables_written_immediately`
    immediate_tables: u128,
}

/// Allocated in an arena so that tasks can refer to it.
struct Numbers {
    /// The number of the newest commit that has started storing.
    begun: AtomicU32,
    /// This commit and all earlier ones have stored everything.
    stored: AtomicU32,
    /// The number of the newest commit by a task that `Task::close_cycle` trusted.
    with_a_cycle: AtomicU32,
    /// Indexed by commit number: the highest `Files::rank_of_file` among the files the commit's task was checking. [0]
    /// is unused. `Commits` frees it, because arena contents are never dropped.
    ranks: Guarded<Vec<u32>>,
}

/// A commit by a task that `Task::close_cycle` trusted.
pub(super) struct CycleCommit {
    number: u32,
    /// The keys from `Task::take_logged_at_cycles`, sorted. They cover the queries in the cycles and whatever else was
    /// stored in the same statements. A record key is its table's slot and `Publish::identity_of_logged`.
    record_keys: Vec<(u32, u64)>,
    node_keys: Vec<[u32; 3]>,
    /// Hashes of the queries in the cycles this commit resolves, sorted. See `Task::take_cycle_members`.
    members: Vec<u64>,
}

impl Drop for Commits<'_> {
    fn drop(&mut self) {
        *self.numbers.ranks.lock() = Vec::new();
    }
}

impl<'s> Commits<'s> {
    pub(super) fn new_in(arena: &'s Arena) -> Commits<'s> {
        Commits {
            committing: Guarded::default(),
            numbers: arena.alloc(Numbers {
                begun: AtomicU32::new(0),
                stored: AtomicU32::new(0),
                with_a_cycle: AtomicU32::new(0),
                ranks: Guarded::new(vec![0]),
            }),
            claims: Claims {
                table: Guarded::default(),
                has_changed: Condvar::new(),
            },
            cycle_commits: Guarded::default(),
            ranks_of_files: &[],
            with_errors: &[],
            immediate_tables: tables_written_immediately(),
        }
    }

    /// See `Program::release`.
    pub(super) fn release(&mut self) {
        *self.claims.table.get_mut() = FxHashMap::default();
        *self.cycle_commits.get_mut() = Vec::new();
        *self.numbers.ranks.lock() = Vec::new();
    }

    /// `ranks` is `Files::rank_of_file`, indexed by file. Without this call, no task hides anything. See `View::hides`.
    pub(super) fn for_files(mut self, ranks: &'s [u32], arena: &'s Arena) -> Commits<'s> {
        let words = (0..ranks.len().div_ceil(32)).map(|_| AtomicU32::new(0));
        (self.ranks_of_files, self.with_errors) = (ranks, arena.alloc_slice_fill_iter(words));
        self
    }

    /// Returns the highest `Files::rank_of_file` of the files that the task of `commit` was checking.
    pub(super) fn rank_of(&self, commit: u32) -> Option<u32> {
        self.numbers.ranks.lock().get(commit as usize).copied()
    }

    /// Creates the view for a new task. `files` is the number of files in the program.
    pub(super) fn view(&self, files: usize) -> View<'s> {
        View {
            numbers: self.numbers,
            ranks_of_files: self.ranks_of_files,
            with_errors: self.with_errors,
            rank: Cell::new(0),
            file_snapshots: vec![Cell::new(0); files].into_boxed_slice(),
            touched: RefCell::default(),
            pinned: Cell::new(NO_FILE),
            last_idle_commit: Cell::new(self.numbers.stored.load(Ordering::Acquire)),
            compared_with_pinned: Cell::new(0),
            own: RefCell::default(),
            times_unsettled: Cell::new(0),
        }
    }

    /// Stores the entries of `task`'s commit `number`, in the order described at the top of this file. The caller holds
    /// the mutex. `tables` is indexed by slot, and `log` is the task's. Returns how many entries it stored.
    pub(super) fn store(
        &self,
        tables: &[&dyn Publish<'s>],
        task: &Task<'s>,
        log: &mut Log,
        number: u32,
        ring: Option<CycleCommit>,
    ) -> u64 {
        let mut stored = 0;
        self.numbers.begun.store(number, Ordering::Release);
        // This comes before the first entry, so a task that finds an entry also sees this.
        if let Some(ring) = ring {
            self.cycle_commits
                .lock()
                .push(CycleCommit { number, ..ring });
            self.numbers.with_a_cycle.store(number, Ordering::Release);
        }
        for &[slot, key] in &log.record_keys {
            if let Some(table) = tables.get(slot as usize) {
                stored += u64::from(table.store_logged(task, u64::from(key), number));
            }
        }
        for &[slot, file, index] in &log.node_keys {
            if let Some(table) = tables.get(slot as usize) {
                stored += u64::from(table.store_logged(task, node_word(file, index), number));
            }
        }
        self.numbers.stored.store(number, Ordering::Release);
        stored
    }
}

/// Returns the table's slot and `Publish::identity_of_logged` for each record key that `task` has logged. `tables` is
/// indexed by slot.
fn identities_of<'s>(
    tables: &[&dyn Publish<'s>],
    task: &Task<'s>,
    logged: &[[u32; 2]],
) -> Vec<(u32, u64)> {
    let identity = |&[slot, key]: &[u32; 2]| {
        let table = tables.get(slot as usize);
        let key = u64::from(key);
        (
            slot,
            table.map_or(key, |it| it.identity_of_logged(task, key)),
        )
    };
    logged.iter().map(identity).collect()
}

/// Within a file, a task commits at its first idle moment after it has logged this many keys since its last commit. The
/// number changes how long a check takes, never its result.
const KEYS_PER_COMMIT: usize = 1024;

const NO_FILE: u32 = u32::MAX;

/// A task's view of `Commits`. It decides which entries under nodes and symbols are visible to the task.
pub(crate) struct View<'s> {
    numbers: &'s Numbers,
    /// See `Commits`.
    ranks_of_files: &'s [u32],
    with_errors: &'s [AtomicU32],
    /// `ranks_of_files[pinned]`
    rank: Cell<u32>,
    /// Indexed by file: one more than the number of the last commit the task sees there, or 0 if the task hasn't looked
    /// at the file since `forget`.
    file_snapshots: Box<[Cell<u32>]>,
    /// The files with a nonzero entry in `file_snapshots`.
    touched: RefCell<Vec<u32>>,
    /// The file that the task is visiting, or `NO_FILE`.
    pinned: Cell<u32>,
    /// The number of the last commit that had stored everything when `forget` was last called.
    last_idle_commit: Cell<u32>,
    /// Commits up to this number haven't stored anything under `pinned` that the task doesn't see.
    compared_with_pinned: Cell<u32>,
    /// The task's own commit numbers, ascending.
    own: RefCell<Vec<u32>>,
    /// How many times `state` has caught a commit in the middle of storing.
    times_unsettled: Cell<u32>,
}

impl View<'_> {
    /// Returns the number of the last commit the task sees in `file`. The caller is about to look up one of the file's
    /// nodes in a table.
    #[inline]
    pub(crate) fn snapshot_of(&self, file: FileId) -> u32 {
        match self.file_snapshots.get(file.idx()).map_or(0, Cell::get) {
            0 => self.touch(file),
            known => known - 1,
        }
    }

    #[inline(never)]
    fn touch(&self, file: FileId) -> u32 {
        let stored = self.numbers.stored.load(Ordering::Acquire);
        if let Some(file_snapshot) = self.file_snapshots.get(file.idx()) {
            file_snapshot.set(stored + 1);
            self.touched.borrow_mut().push(file.0);
        }
        stored
    }

    /// Drops the snapshots of all files except the pinned one. Call when nothing in progress in the task has looked at
    /// a table.
    pub(super) fn forget(&self) {
        self.last_idle_commit
            .set(self.numbers.stored.load(Ordering::Acquire));
        let pinned = self.pinned.get();
        self.touched.borrow_mut().retain(|&file| {
            if file != pinned
                && let Some(file_snapshot) = self.file_snapshots.get(file as usize)
            {
                file_snapshot.set(0);
            }
            file == pinned
        });
    }

    /// True if the task is visiting `file`, so what it sees there stays the same until it visits another file.
    #[inline]
    pub(crate) fn is_pinned(&self, file: FileId) -> bool {
        self.pinned.get() == file.0
    }

    /// Call when the task starts visiting `file`.
    pub(super) fn pin(&self, file: FileId) {
        self.pinned.set(NO_FILE);
        self.forget();
        let snapshot = self.snapshot_of(file);
        self.pinned.set(file.0);
        self.rank
            .set(self.ranks_of_files.get(file.idx()).copied().unwrap_or(0));
        self.compared_with_pinned.set(snapshot);
    }

    /// True if the task ignores what `commit` stored under `file`.
    ///
    /// tsc checks the files in program order, and whether it reports an error can depend on the context in which it
    /// first gets there. The first task in program order that gets to an error decides. So once a task has found an
    /// error while it evaluated something about another file, the tasks that would still report in that file ignore
    /// what tasks of later files stored under it. That way they run into the same cache misses as on one thread. Files
    /// without errors lose nothing.
    #[inline]
    pub(crate) fn hides(&self, file: FileId, commit: u32) -> bool {
        let word = self.with_errors.get(file.idx() / 32);
        word.is_some_and(|it| it.load(Ordering::Relaxed) >> (file.0 % 32) & 1 != 0)
            && self.hides_a_later_commit(file, commit)
    }

    #[cold]
    fn hides_a_later_commit(&self, file: FileId, commit: u32) -> bool {
        let rank = self.rank.get();
        // This task doesn't report in an earlier file.
        let reports_there = self
            .ranks_of_files
            .get(file.idx())
            .is_some_and(|&it| it >= rank);
        reports_there
            && self
                .numbers
                .ranks
                .lock()
                .get(commit as usize)
                .is_some_and(|&it| it > rank)
    }

    /// See `Task::overlaps_a_cycle_commit`.
    #[inline]
    pub(super) fn overlaps_a_cycle_commit(&self) -> bool {
        self.numbers.with_a_cycle.load(Ordering::Acquire) > self.last_idle_commit.get()
    }

    fn is_own(&self, commit: u32) -> bool {
        self.own.borrow().binary_search(&commit).is_ok()
    }

    /// Call after the task's commit `number`.
    pub(super) fn has_committed(&self, number: u32) {
        self.own.borrow_mut().push(number);
        self.forget();
    }

    /// Returns a greater number than last time if a commit may have added to the tables in between.
    fn state(&self) -> u64 {
        let stored = self.numbers.stored.load(Ordering::Acquire);
        if self.numbers.begun.load(Ordering::Acquire) != stored {
            // A commit is storing right now and will continue after this read. Once it's done, `stored` is greater.
            let times = self.times_unsettled.get().wrapping_add(1);
            self.times_unsettled.set(times);
        }
        u64::from(stored) << 32 | u64::from(self.times_unsettled.get())
    }
}

/// The variances that are being measured right now.
///
/// Tasks that start at about the same time need the same variances, and none of them has committed by the time the
/// others look them up. A measurement can take seconds, and its result is just a few flags per type parameter of a
/// symbol, with no ids in it. So one thread measures, the others wait, and the result is shared when the measurement
/// ends, not when its task commits.
///
/// - A thread that's about to start an outermost measurement claims the symbol (`Program::claim_variances`).
/// - A thread that finds the symbol claimed waits, and then takes the result.
/// - When an outermost measurement ends, its results are shared immediately if `Checker::share_measured_variances`
///   allows it. They go to `Program::serial_variances`, which `variances_worker` checks before it measures and which
///   every commit is compared with. So every later commit agrees with them.
/// - A claim that ends without a result wakes the waiters too. One of them claims the symbol, or they all measure.
///
/// **No deadlock.** A thread only waits here if it isn't measuring (`Checker::in_variance_computation`), and a thread
/// only has a claim while it's measuring. So a thread with a claim never waits for one, and every wait is for a running
/// thread. That thread never blocks on a lock held by a waiter, because a waiter holds none. It's in the middle of a
/// task, and the wait releases `table`'s lock. A measurement is finite, and `variances_worker` has a single exit, which
/// releases the claim.
struct Claims {
    /// Lock order: take this lock before `Program::serial_variances`'s.
    table: Guarded<FxHashMap<Sym, Claim>>,
    /// Signaled when a claim ends or variances are shared.
    has_changed: Condvar,
}

/// A symbol without an entry isn't claimed, and no claim on it has ended without a result.
#[derive(Default)]
struct Claim {
    is_taken: bool,
    /// How many claims have ended without a result.
    failures: u8,
    /// No thread claims it again or waits for it. Every thread measures for itself.
    is_given_up: bool,
}

/// The result of `Program::claim_variances`.
pub(super) enum VarianceClaim<'s> {
    /// The variances are already shared, possibly after a wait.
    Known(&'s [u8]),
    /// The caller has the claim. It measures, and then calls `Program::share_variances`.
    Mine,
    /// The caller measures, without a claim.
    Unclaimed,
}

/// Why a claim ends without a result.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum NotShared {
    /// The measurement reported a diagnostic, which a thread that takes the shared result wouldn't report. Every other
    /// thread's measurement would end the same way.
    Diagnostic,
    /// The measurement may have used something that can make this task's commit invalid.
    Notes,
    /// The result depends on a query that was in progress in this task, or was cut short.
    Open,
}

impl<'s> Program<'s> {
    /// See `Claims`. The caller is about to start an outermost measurement of `sym`'s variances. It isn't measuring
    /// yet, so it has no claim. `may_claim` is true if its result has a chance of being shared.
    pub(super) fn claim_variances(&self, sym: Sym, may_claim: bool) -> VarianceClaim<'s> {
        let claims = &self.commits.claims;
        let mut table = claims.table.lock();
        loop {
            let shared = self.serial_variances.lock().get(&sym).copied();
            if let Some(variances) = shared {
                return VarianceClaim::Known(variances);
            }
            match table.get(&sym) {
                Some(claim) if claim.is_given_up => return VarianceClaim::Unclaimed,
                Some(claim) if claim.is_taken => {}
                _ if !may_claim => return VarianceClaim::Unclaimed,
                _ => {
                    table.entry(sym).or_default().is_taken = true;
                    return VarianceClaim::Mine;
                }
            }
            claims.has_changed.wait_guarded(&mut table);
        }
    }

    /// See `Claims`. Call when an outermost measurement ends.
    /// - `measured` is what it stored. `may_share` means nothing in it depends on the task that measured it, so it's
    ///   shared.
    /// - `claimed` is the symbol the caller has claimed, with the reason it isn't shared, if any.
    ///
    /// Returns the variances that the caller keeps using even though `serial_variances` doesn't have them. Either
    /// there's a different value, registered in the meantime by a task that entered a cycle elsewhere, or there's none
    /// and this one may not be shared. Nothing has compared them with what other tasks use, so the caller notes them
    /// for its next commit.
    pub(super) fn share_variances(
        &self,
        measured: &[(Sym, &'s [u8])],
        may_share: bool,
        claimed: Option<(Sym, Option<NotShared>)>,
    ) -> Vec<(Sym, &'s [u8])> {
        let mut not_registered = Vec::new();
        if measured.is_empty() && claimed.is_none() {
            return not_registered;
        }
        let claims = &self.commits.claims;
        let mut table = claims.table.lock();
        {
            let mut serial = self.serial_variances.lock();
            for &(sym, variances) in measured {
                match serial.get(&sym) {
                    Some(&first) if first == variances => {}
                    None if may_share => {
                        serial.insert(sym, variances);
                    }
                    _ => not_registered.push((sym, variances)),
                }
            }
        }
        match claimed {
            None => {}
            Some((sym, None)) => {
                table.remove(&sym);
            }
            Some((sym, Some(reason))) => {
                let claim = table.entry(sym).or_default();
                claim.is_taken = false;
                claim.failures = claim.failures.saturating_add(1);
                // Give one more thread a chance.
                claim.is_given_up = claim.failures >= 2 || reason == NotShared::Diagnostic;
            }
        }
        drop(table);
        claims.has_changed.notify_all();
        not_registered
    }

    /// Returns the number of the last commit that has finished storing.
    pub fn last_commit(&self) -> u32 {
        self.commits.numbers.stored.load(Ordering::Acquire)
    }

    /// True if a commit numbered `after + 1..=last` resolved a cycle that contains one of `members`. See
    /// `Checker::take_unresolved_cycle`.
    pub fn is_cycle_resolved(&self, members: &[u64], after: u32, last: u32) -> bool {
        let cycle_commits = self.commits.cycle_commits.lock();
        let from = cycle_commits.partition_point(|ring| ring.number <= after);
        let mut since = cycle_commits[from..]
            .iter()
            .take_while(|ring| ring.number <= last);
        since.any(|ring| {
            let mut members = members.iter();
            members.any(|member| ring.members.binary_search(member).is_ok())
        })
    }

    /// True if the variances the task has noted contradict an earlier commit, so that this commit must be discarded.
    /// They're compared with every earlier commit. A task only notes variances it computed itself, which it only does
    /// if it found none. They stay noted, because the task keeps using them.
    fn is_invalid(&self, task: &Task<'s>) -> bool {
        let serial = self.serial_variances.lock();
        let mut noted = task.order_dependent_variances.iter();
        noted.any(|it| {
            serial
                .get(&it.sym)
                .is_some_and(|first| it.conflicts_with(first))
        })
    }

    /// Call once `task`'s commit is known to be valid. Later commits are compared with what the task noted.
    fn register_notes(&self, task: &Task<'s>) {
        let mut serial = self.serial_variances.lock();
        for it in &task.order_dependent_variances {
            serial.entry(it.sym).or_insert(it.variances);
        }
    }
}

impl<'s> Checker<'_, 's> {
    /// Call right after `begin_task`. Makes the task commit while it runs and see other tasks' commits. `is_alone`
    /// means no other task runs, as in the last round.
    pub fn see_commits(&mut self, is_alone: bool) {
        let files = self.p.files.modules.len();
        let view = self.p.commits.view(files);
        // When it's alone there's no reader, so nothing is published immediately. And at a limit it has to store, and
        // later replace, the same entries as tsgo.
        let immediate_tables = match is_alone {
            true => 0,
            false => self.p.commits.immediate_tables,
        };
        self.task.see_commits(view, is_alone, immediate_tables);
    }

    /// For a task that sees commits, returns a greater number than last time if a commit may have added to the tables
    /// in between. A memo that caches something because an entry was absent is only valid while this number stays the
    /// same. An entry that another task computed in a cycle can give a different answer than its absence did.
    pub(super) fn state_of_commits(&self) -> u64 {
        self.task.view().map_or(0, View::state)
    }

    /// Returns the number of the newest commit that resolves a cycle, as far as this task sees commits.
    pub(super) fn newest_commit_with_a_cycle(&self) -> u64 {
        let newest = |view: &View| view.numbers.with_a_cycle.load(Ordering::Acquire);
        self.task.view().map_or(0, |view| u64::from(newest(view)))
    }

    /// Call between two statements or two deferred nodes of the task's own walk.
    #[inline]
    pub(super) fn idle_between_statements(&mut self) {
        if self.task.commits()
            && self.stack.is_empty()
            && self.contextual.is_empty()
            && self.inference_contexts.is_empty()
            && !self.in_variance_computation
        {
            self.on_idle();
        }
    }

    /// True if the task has logged enough keys to commit. The last round's task never has, because no other task runs
    /// that could read its entries, and a published entry can't be replaced. A comparison that overflows caches
    /// failures, and typescript-go replaces them when a later statement repeats one of those comparisons to report an
    /// error.
    fn is_commit_due(&self) -> bool {
        self.task.commits()
            && !self.task.is_trusted()
            && self.task.buffer().logged() >= KEYS_PER_COMMIT
    }

    /// Call when nothing in progress has looked at a table or is about to store in one.
    fn on_idle(&mut self) {
        self.discard_if_missed_cycle_member();
        // A commit here would store the members of a cycle that are in other files, and withhold those in this one.
        if self.is_commit_due() && !self.task.was_discarded() && !self.task.has_resolved_a_cycle() {
            let is_between_files = false;
            self.commit(is_between_files);
        } else if let Some(view) = self.task.view() {
            view.forget();
        }
        self.task.note_idle();
    }

    /// Call when the task is idle. Discards the task if it missed a member of a cycle that some commit has. Such a task
    /// hits the other members, which doesn't close a cycle and isn't what any entry point produces. There are two signs
    /// of a miss:
    /// - The task has stored, since it was last idle, under a key that the commit has. A task that misses a member
    ///   evaluates it and stores it. See `Task::overlaps_a_cycle_commit`.
    /// - The commit has a key in the file the task is visiting, which doesn't change during the visit.
    fn discard_if_missed_cycle_member(&self) {
        let Some(view) = self.task.view() else {
            return;
        };
        let newest = view.numbers.with_a_cycle.load(Ordering::Acquire);
        let (last_idle_commit, compared) =
            (view.last_idle_commit.get(), view.compared_with_pinned.get());
        if newest <= last_idle_commit.min(compared) {
            return;
        }
        // Copied because `identities_of` borrows the task's buffer again.
        let (record_keys, node_keys) = self.task.logged_since_idle();
        let (record_keys, node_keys) = (record_keys.to_vec(), node_keys.to_vec());
        let record_keys = identities_of(&tables_of(self.p), &self.task, &record_keys);
        let cycle_commits = self.p.commits.cycle_commits.lock();
        let from =
            cycle_commits.partition_point(|ring| ring.number <= last_idle_commit.min(compared));
        let is_of_later_file = |commit: u32| {
            let rank = self.p.commits.rank_of(commit);
            (self.task.file).is_some_and(|file| rank > Some(self.p.files.rank_of_file(file)))
        };
        let has_missed = cycle_commits[from..].iter().any(|ring| {
            ring.number > compared
                && ring.node_keys.iter().any(|key| key[1] == view.pinned.get())
                && !is_of_later_file(ring.number)
                || ring.number > last_idle_commit
                    && (record_keys
                        .iter()
                        .any(|key| ring.record_keys.binary_search(key).is_ok())
                        || node_keys
                            .iter()
                            .any(|key| ring.node_keys.binary_search(key).is_ok()))
        });
        view.compared_with_pinned.set(compared.max(newest));
        if has_missed && !self.task.was_discarded() {
            // That cycle is already committed, so the file can be rechecked right away.
            drop(self.task.take_cycle_members());
            (self.task).discard_until_recheck();
        }
    }

    /// Discards the task the way an invalid commit does. Call it after `check_file`.
    pub fn discard_until_recheck(&self) {
        self.task.discard_until_recheck();
    }

    /// True if the task is discarded. Its files will be rechecked, and nothing it computes from now on is kept.
    pub fn was_discarded(&self) -> bool {
        self.task.was_discarded()
    }

    /// True if the task was discarded because of a cycle or an invalid commit, not a limit. Its files can be rechecked
    /// before the last round.
    pub fn can_recheck_early(&self) -> bool {
        self.task.can_recheck_early()
    }

    /// Returns hashes of the queries in the cycle that got this task discarded. Empty if that cycle is already committed.
    pub fn take_unresolved_cycle(&self) -> Vec<u64> {
        self.task.take_cycle_members()
    }

    /// Call before `check_file`. See `Task::set_first_in_order`.
    pub fn set_first_in_order(&self, is_first: bool, is_first_in_component: bool) {
        (self.task).set_first_in_order(is_first, is_first_in_component);
    }

    /// Call after `check_file` and any later queries about the file. `is_last` means the task ends with this file.
    ///
    /// Returns true if the file is checked for good. Otherwise the task is discarded and the file has to be rechecked. A
    /// commit follows every file, so a discarded task never takes an earlier file with it. The exception is the last
    /// round's task.
    pub fn commit_after_file(&mut self, is_last: bool) -> bool {
        self.discard_if_missed_cycle_member();
        // The last round's task commits once, when it ends. See `is_commit_due`. It's never discarded.
        if self.task.is_trusted() && !is_last && !self.task.was_discarded() {
            return true;
        }
        self.commit(true)
    }

    /// See the top of this file. Nothing may be in progress in the task.
    /// `is_between_files` means no file is being checked.
    /// Returns true if the task continues, that is, if it isn't discarded.
    fn commit(&mut self, is_between_files: bool) -> bool {
        let p = self.p;
        let Some([immediate_diagnostics, mut reported]) =
            self.take_diagnostics_for_commit(is_between_files)
        else {
            if let Some(view) = self.task.view() {
                view.forget();
            }
            return !self.task.was_discarded();
        };
        p.publish_reported(self.task.number(), immediate_diagnostics);
        if self.task.was_discarded() {
            return false;
        }
        let ranks = self.task.uncommitted_files.iter();
        let rank = ranks
            .map(|&file| p.files.rank_of_file(file))
            .max()
            .unwrap_or(0);
        let at_cycles = self.task.take_logged_at_cycles();
        let mut log = self.task.buffer().take_log();
        let ring = (!at_cycles.is_empty()).then(|| {
            let (mut record_keys, mut node_keys) = (Vec::new(), Vec::new());
            let tables = tables_of(p);
            for [from, to] in &at_cycles {
                let logged = log.record_keys.get(from[0]..to[0]).unwrap_or(&[]);
                record_keys.extend(identities_of(&tables, &self.task, logged));
                node_keys.extend_from_slice(log.node_keys.get(from[1]..to[1]).unwrap_or(&[]));
            }
            record_keys.shared_sort_unstable();
            node_keys.shared_sort_unstable();
            CycleCommit {
                number: 0,
                record_keys,
                node_keys,
                members: self.task.take_cycle_members(),
            }
        });
        self.withhold_until_the_file_ends(&mut log, is_between_files);
        let mut committing = p.commits.committing.lock();
        let is_invalid =
            !self.task.is_trusted() && self.task.view().is_some() && p.is_invalid(&self.task);
        if is_invalid {
            drop(committing);
            (self.task).discard_until_recheck();
            return false;
        }
        let number = *committing + 1;
        *committing = number;
        // Set before the commit stores, so a task that finds one of its entries also sees these.
        for file in self.files_with_errors.drain() {
            if let Some(word) = p.commits.with_errors.get(file.idx() / 32) {
                word.fetch_or(1 << (file.0 % 32), Ordering::Relaxed);
            }
        }
        p.commits.numbers.ranks.lock().push(rank);
        p.register_notes(&self.task);
        let task = &self.task;
        p.drop_diagnostics_of_losers(&mut reported, |commit| {
            task.view().is_some_and(|view| view.is_own(commit))
        });
        p.publish_reported(task.number(), reported);
        (p.commits).store(&tables_of(p), task, &mut log, number, ring);
        drop(committing);
        if let Some(view) = task.view() {
            view.has_committed(number);
        }
        task.resume_writing_immediately();
        task.buffer().recycle_log(log);
        true
    }

    /// Entries the task stored under the nodes and symbols of a file it visited wait for the commit that follows the
    /// file. If the task is discarded before that, another task rechecks the file and has to evaluate the same things
    /// again. Evaluating an expression also leaves notes for the later passes over the file, like
    /// `unresolved_identifiers`, and a task that hits a cached entry doesn't leave them.
    fn withhold_until_the_file_ends(&mut self, log: &mut Log, is_between_files: bool) {
        let withheld = &mut self.withheld_until_the_file_ends;
        if is_between_files {
            log.node_keys.append(withheld);
            self.task.uncommitted_files.clear();
            return;
        }
        let uncommitted = &self.task.uncommitted_files;
        log.node_keys.retain(|&entry| {
            let is_uncommitted = uncommitted.contains(&FileId(entry[1]));
            if is_uncommitted {
                withheld.push(entry);
            }
            !is_uncommitted
        });
    }

    /// Ends a task that `see_commits` was called for, after its last `commit_after_file`, on its own thread.
    pub fn end_task_after_commits(&mut self) {
        self.task.end(self.p)
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// Drops the checker after `end_task_after_commits`. Returns what `Program::checker_reusing` can reuse.
    pub fn into_spare(self: Box<Self>) -> Box<Spare<'s>> {
        let mut spare = Box::new(Spare {
            task: self.task,
            task_facts: self.task_facts,
            simplified: self.simplified,
            reduced_unions: self.reduced_unions,
            links: self.links,
            signature_links: self.signature_links,
            widened_types: self.widened_types,
            apparent_types_of_intersections: self.apparent_types_of_intersections,
        });
        spare.task_facts.clear();
        spare.simplified.iter_mut().for_each(|map| map.clear());
        spare.reduced_unions.clear();
        spare.links.clear();
        spare.signature_links.clear();
        spare.widened_types.clear();
        spare.apparent_types_of_intersections.clear();
        spare
    }
}
