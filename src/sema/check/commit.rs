//! Commits: how tasks share what they compute while they run.
//!
//! Every thread takes the next task of one list. What a task stores goes to its own part of the tables, as ever, and the
//! key goes to a log (`crate::local::Log`). After every file, and from time to time within a file while nothing is in
//! progress in it, the task commits (`Checker::commit`): on its own thread it stores what it has logged since its last
//! commit in the shared part, where the tasks that are running find it. The records are shared already
//! (`Sharing::Publishes`), so an entry needs no rewriting.
//!
//! Which task is first anywhere depends on timing. These rules keep the report a function of the program:
//!
//! - **One commit at a time.** They store under one mutex and are numbered from 1 in that order. The first entry for a key
//!   stays.
//! - **Whoever finds an entry finds what was stored before it.** He does not evaluate it, so he goes without whatever
//!   that evaluation has stored on the way, unless he finds that too. A commit first stores what is keyed by a record, in
//!   the order of the log, each with a release: an entry is there after everything that was stored while it was
//!   evaluated. Then it stores what is keyed by a node or a symbol, each with the number of the commit beside it
//!   (`ByNode::stamps`). Then it says that it has stored everything (`Numbers::stored`), and only then do the entries with
//!   its number count for anybody. So they appear all at once, after the entries of the first kind.
//! - **A file does not change under a statement.** The first time that a task looks at a table for a node of a file, hit or
//!   miss, it notes the number of the last commit that has stored everything (`View::snapshot_of`). Until its own walk
//!   comes to the next statement or deferred node with nothing in progress, an entry under a node of that file with a
//!   higher number does not exist for it.
//! - **The file that a task visits does not change during the visit.** Its number is noted when the visit begins and kept to
//!   the end (`View::pin`). What the task stores itself it finds in its own part.
//! - **A commit is valid or nothing of it is stored.** Some results depend on which of two evaluations came first in their
//!   checker, and `Program::is_invalid` says which. The serial order that a commit is compared with is the order of the
//!   commits. What is thrown away is what the task has done since its last commit. It ends then, and the driver rechecks the
//!   file that it was visiting right away, on any thread. The new task starts after the commit that the old one
//!   conflicted with, so it finds those variances and walks.
//! - **A task that gives up at a limit is not believed** (`Checker::note_gave_up`). How far from a limit a computation
//!   begins depends on what was computed before, which for a task includes what it has found. It is thrown away like an
//!   invalid one, but its file waits for the last round.
//! - **A ring is entered from the first file that leads to it.** What a query gets that comes round to itself, or to what
//!   it has in place, depends on where the checker came in (`Checker::close_ring_from`). `tsc --singleThreaded` comes in
//!   from the first file in program order that leads there. So a task is believed about a ring only if every file before
//!   the one that it visits is checked for good: none of those leads there, or the task would have found what the members
//!   got (`Task::close_ring`). Any other task is discarded, and the driver rechecks its file once all earlier files are
//!   done.
//!   - Earlier files that can't reach the cycle don't matter. If only importers of the current file can reach it, the task
//!     is trusted once the earlier files of its own import cycle are done (`Checker::is_reachable_only_by_importers`).
//!   - A discarded task stops at its next statement. The driver rechecks its file as soon as a commit resolves that cycle
//!     (`Program::is_cycle_resolved`), on any thread. The recheck can be discarded at the file's next unresolved cycle.
//!   - Once a file is discarded, one worker switches from the heavy files to the first unchecked files of the program, so
//!     cycles that everything uses are resolved early.
//! - **A ring is seen whole or not at all.** A task has a snapshot for each file, and none for the entries under records. So
//!   it could miss one member of a ring and find the next, which closes no ring and is right from no entry. The commit of
//!   a task that was believed about a ring follows a file, so nothing of it is withheld, and says so before it stores its
//!   first entry (`Numbers::with_a_ring`). A task that has not been at rest since then writes nothing at once
//!   (`Task::is_beside_a_ring`). It is lost if it has stored under a key of that commit: it has missed that one
//!   (`Checker::lose_what_has_missed_a_ring`).
//! - **The last round** is one task that checks the files that are still discarded, in program order, while nothing else
//!   runs. It finds all that was committed. What it computes at a limit is what counts, as with one checker. It commits
//!   once, when it ends (`Checker::is_commit_due`).
//! - **A diagnostic goes with the entry of the query that has reported it**, in the same commit, and stays if the task is
//!   lost later: whoever checks the file again finds the entry and does not report. If the entry loses, so does the
//!   diagnostic (`Program::drop_diagnostics_of_losers`). What the walk of a file reports belongs to the file, and goes when a
//!   commit follows the end of the file. So does what the task has stored under the nodes of the file
//!   (`Checker::withhold_until_the_file_ends`), with what was reported for it.
//! - **The first task in program order that gets to an error decides whether it's reported.** tsc ignores an error that a
//!   later file causes in an earlier one, so a task only reports in its own file and in later files
//!   (`Checker::is_left_to_an_earlier_file`). And whether tsc reports an error can depend on the context in which it first
//!   gets there. So a task ignores what a task of a later file has stored under a file, if the later task found an error
//!   there and this task would still report it (`View::hides`). A task only moves forward in program order, so it
//!   never finds such entries of its own. This covers the entries under nodes, not those under records.
//! - **What a task stores about an expression of the file that it visits never leaves the task**
//!   (`crate::table::Location::KEEPS_THE_VISITED_FILE`). It is most of what a check stores, and hardly anybody else asks for it.
//!   It is neither logged nor a `Task::hold_back`.
//! - **An entry under a record does not wait for a commit if nothing that it rests on does** (`Task::may_write_at_once`):
//!   neither its key nor its value is bound, and since its evaluation began nothing was stored that waits, and nothing was
//!   read that holds only while the stack of the checker is as it is (`Task::hold_back`). So whatever its evaluation has
//!   stored was written at once too, before it. What is written at once can't be taken back. So a task writes nothing
//!   at once from the moment at which something happens for which it may be thrown away, or at which it stores the result
//!   of a resolution cycle, until its next commit (`Task::stop_writing_at_once`).
//! - **What depends on how deep the checker was never leaves the task**: a base constraint that was cut short, a comparison
//!   that holds because two types inside it counted as deeply nested, and what follows from either
//!   (`Checker::constraints_of_this_task`, `relations_of_this_task`). In a table the first of them would stay for everybody.
//! - Variances do not wait for a commit either. See `Claims`.

use super::task::{Ended, Task, tables_of, tables_written_at_once};
use super::{Checker, Program};
use crate::local::{Log, node_word};
use crate::node::Node;
use crate::program::{FileId, Sym};
use crate::session::Arena;
use crate::table::Publish;
use crate::util::{FxHashMap, SharedSort};
use bun_threading::{Condvar, Guarded};
use std::cell::{Cell, RefCell};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

/// A field of `Program`.
pub(super) struct Commits<'s> {
    /// The mutex of `Checker::commit`.
    committing: Guarded<Committing>,
    numbers: &'s Numbers,
    claims: Claims,
    /// The commits of the tasks that `Task::close_ring` has believed, by number.
    rings: Guarded<Vec<Ring>>,
    /// `Files::rank_of_file`, by file.
    ranks_of_files: &'s [u32],
    /// One bit for each file: a task that was checking another file has found an error while it evaluated something about
    /// this one, and has committed. See `View::hides`.
    with_errors: &'s [AtomicU32],
    /// `tables_written_at_once`
    at_once: u128,
}

/// In an arena, so that a task can refer to it.
struct Numbers {
    /// The number of the newest commit that has begun to store.
    begun: AtomicU32,
    /// That commit, and every one before it, has stored everything.
    stored: AtomicU32,
    /// The number of the newest commit of a task that `Task::close_ring` has believed.
    with_a_ring: AtomicU32,
    /// For each commit, by number: the highest `Files::rank_of_file` of the files its task was checking. [0] is unused.
    /// `Commits` frees it: nothing drops what is in an arena.
    ranks: Guarded<Vec<u32>>,
}

/// A commit of a task that `Task::close_ring` has believed.
pub(super) struct Ring {
    number: u32,
    /// The keys that the task has logged from then on, sorted: those of the members, and of what follows from them.
    of_records: Vec<[u32; 2]>,
    of_nodes: Vec<[u32; 3]>,
    /// Hashes of the queries in the cycles this commit resolves, sorted. See `Task::take_cycle_members`.
    members: Vec<u64>,
}

#[derive(Default)]
struct Committing {
    /// Of the last commit.
    number: u32,
    /// `Task::assignments_walked` of the commits so far, each with the number of its commit, in their order.
    walked: Vec<(u32, FileId, Node)>,
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
                with_a_ring: AtomicU32::new(0),
                ranks: Guarded::new(vec![0]),
            }),
            claims: Claims {
                table: Guarded::default(),
                has_changed: Condvar::new(),
            },
            rings: Guarded::default(),
            ranks_of_files: &[],
            with_errors: &[],
            at_once: tables_written_at_once(),
        }
    }

    /// See `Program::release`.
    pub(super) fn release(&mut self) {
        *self.committing.get_mut() = Committing::default();
        *self.claims.table.get_mut() = FxHashMap::default();
        *self.rings.get_mut() = Vec::new();
        *self.numbers.ranks.lock() = Vec::new();
    }

    /// `ranks`: `Files::rank_of_file`, by file. Without this call no task hides anything: see `View::hides`.
    pub(super) fn for_files(mut self, ranks: &'s [u32], arena: &'s Arena) -> Commits<'s> {
        let words = (0..ranks.len().div_ceil(32)).map(|_| AtomicU32::new(0));
        (self.ranks_of_files, self.with_errors) = (ranks, arena.alloc_slice_fill_iter(words));
        self
    }

    /// Returns the highest `Files::rank_of_file` of the files that the task of `commit` was checking.
    pub(super) fn rank_of(&self, commit: u32) -> Option<u32> {
        self.numbers.ranks.lock().get(commit as usize).copied()
    }

    /// For a task that begins. `files`: how many the program has.
    pub(super) fn view(&self, files: usize) -> View<'s> {
        View {
            numbers: self.numbers,
            ranks_of_files: self.ranks_of_files,
            with_errors: self.with_errors,
            rank: Cell::new(0),
            of_files: vec![Cell::new(0); files].into_boxed_slice(),
            touched: RefCell::default(),
            pinned: Cell::new(NO_FILE),
            at_rest: Cell::new(self.numbers.stored.load(Ordering::Acquire)),
            compared_with_pinned: Cell::new(0),
            oldest_pin: Cell::new(u32::MAX),
            own: RefCell::default(),
            times_unsettled: Cell::new(0),
        }
    }

    /// The part of the commit `number` of `task` that stores, in the order that the head of this file gives. The caller
    /// has the mutex. `tables`: by slot. `log`: of the task. Returns how many entries it has stored.
    pub(super) fn store(
        &self,
        tables: &[&dyn Publish<'s>],
        task: &Task<'s>,
        log: &mut Log,
        number: u32,
        ring: Option<Ring>,
    ) -> u64 {
        let mut stored = 0;
        self.numbers.begun.store(number, Ordering::Release);
        // Before the first entry: whoever finds one finds this.
        if let Some(ring) = ring {
            self.rings.lock().push(Ring { number, ..ring });
            self.numbers.with_a_ring.store(number, Ordering::Release);
        }
        for &[slot, key] in &log.of_records {
            if let Some(table) = tables.get(slot as usize) {
                stored += u64::from(table.store_logged(task, u64::from(key), number));
            }
        }
        for &[slot, file, index] in &log.of_nodes {
            if let Some(table) = tables.get(slot as usize) {
                stored += u64::from(table.store_logged(task, node_word(file, index), number));
            }
        }
        self.numbers.stored.store(number, Ordering::Release);
        stored
    }
}

/// Within a file, a task commits at its first idle moment after it has logged this many keys since its last commit. The
/// number changes how long a check takes, never its result.
const KEYS_PER_COMMIT: usize = 1024;

const NO_FILE: u32 = u32::MAX;

/// What a task has of `Commits`: which entries under nodes and symbols exist for it.
pub(crate) struct View<'s> {
    numbers: &'s Numbers,
    /// See `Commits`.
    ranks_of_files: &'s [u32],
    with_errors: &'s [AtomicU32],
    /// `ranks_of_files` of `pinned`.
    rank: Cell<u32>,
    /// By file: one more than the number of the last commit that the task sees there. 0: the task has not looked at the
    /// file since `forget`.
    of_files: Box<[Cell<u32>]>,
    /// The files that have a number there.
    touched: RefCell<Vec<u32>>,
    /// The file that the task is visiting, or `NO_FILE`.
    pinned: Cell<u32>,
    /// The number of the last commit that had stored everything when `forget` was last called.
    at_rest: Cell<u32>,
    /// The commits up to this number have stored nothing under `pinned` that the task does not see.
    compared_with_pinned: Cell<u32>,
    /// The lowest number that a file had while it was `pinned`, since the last commit of the task.
    oldest_pin: Cell<u32>,
    /// The numbers of the commits of the task, ascending.
    own: RefCell<Vec<u32>>,
    /// How many times `state` has found a commit storing.
    times_unsettled: Cell<u32>,
}

impl View<'_> {
    /// The number of the last commit that the task sees in `file`. The caller is about to look at a table for a node of it.
    #[inline]
    pub(crate) fn snapshot_of(&self, file: FileId) -> u32 {
        match self.of_files.get(file.idx()).map_or(0, Cell::get) {
            0 => self.touch(file),
            known => known - 1,
        }
    }

    #[inline(never)]
    fn touch(&self, file: FileId) -> u32 {
        let stored = self.numbers.stored.load(Ordering::Acquire);
        if let Some(of_file) = self.of_files.get(file.idx()) {
            of_file.set(stored + 1);
            self.touched.borrow_mut().push(file.0);
        }
        stored
    }

    /// Nothing is in progress in the task that has looked at a table.
    pub(super) fn forget(&self) {
        self.at_rest
            .set(self.numbers.stored.load(Ordering::Acquire));
        let pinned = self.pinned.get();
        self.touched.borrow_mut().retain(|&file| {
            if file != pinned
                && let Some(of_file) = self.of_files.get(file as usize)
            {
                of_file.set(0);
            }
            file == pinned
        });
    }

    /// Whether the task is visiting `file`, so that what it sees there stays the same until it visits another file.
    #[inline]
    pub(crate) fn is_pinned(&self, file: FileId) -> bool {
        self.pinned.get() == file.0
    }

    /// The task begins to visit `file`.
    pub(super) fn pin(&self, file: FileId) {
        self.pinned.set(NO_FILE);
        self.forget();
        let snapshot = self.snapshot_of(file);
        self.pinned.set(file.0);
        self.rank
            .set(self.ranks_of_files.get(file.idx()).copied().unwrap_or(0));
        self.compared_with_pinned.set(snapshot);
        self.oldest_pin.set(self.oldest_pin.get().min(snapshot));
    }

    /// True if the task ignores what `commit` stored under `file`.
    ///
    /// tsc checks the files in program order, and whether it reports an error can depend on the context in which it first
    /// gets there. The first task in program order that gets to an error decides. So once a task has found an error while
    /// it evaluated something about another file, the tasks that would still report in that file ignore what tasks of
    /// later files stored under it: they run into the same cache misses as on one thread. Files without errors lose
    /// nothing.
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

    /// See `Task::is_beside_a_ring`.
    #[inline]
    pub(super) fn is_beside_a_ring(&self) -> bool {
        self.numbers.with_a_ring.load(Ordering::Acquire) > self.at_rest.get()
    }

    fn is_own(&self, commit: u32) -> bool {
        self.own.borrow().binary_search(&commit).is_ok()
    }

    /// The task has committed, under `number`.
    pub(super) fn has_committed(&self, number: u32) {
        self.own.borrow_mut().push(number);
        self.forget();
        self.oldest_pin.set(match self.pinned.get() {
            NO_FILE => u32::MAX,
            file => self.snapshot_of(FileId(file)),
        });
    }

    /// A greater number than last time if a commit may have added to the tables in between.
    fn state(&self) -> u64 {
        let stored = self.numbers.stored.load(Ordering::Acquire);
        if self.numbers.begun.load(Ordering::Acquire) != stored {
            // One is storing right now, and goes on after this. When it is through, `stored` is greater.
            let times = self.times_unsettled.get().wrapping_add(1);
            self.times_unsettled.set(times);
        }
        u64::from(stored) << 32 | u64::from(self.times_unsettled.get())
    }
}

/// The variances that are being measured right now.
///
/// Tasks that begin at about the same time need the same variances, and none of them has committed when the others ask. A
/// measurement can take seconds, and its result is a few flags for each type parameter of a symbol: no id is in it. So
/// one thread measures, the others wait, and the result is shared when the measurement ends, not when its task commits.
///
/// - A thread that is about to begin an outermost measurement claims the symbol (`Program::claim_variances`).
/// - A thread that finds the symbol claimed waits, and then takes the result.
/// - When an outermost measurement ends, what it has measured is shared at once if `Checker::share_what_was_measured`
///   finds that it may be: it goes to `Program::serial_variances`, where `variances_worker` looks before it measures and
///   which a commit compares with. So every later commit agrees with it.
/// - A claim that ends without a result wakes the waiters too. One of them claims the symbol, or they all measure.
///
/// **No deadlock.** A thread waits here only if it is not measuring (`Checker::in_variance_computation`), and a thread has a
/// claim only while it is measuring. So no thread that has a claim ever waits for one: every wait is for a thread that is
/// running. That thread takes no lock that a waiter holds, because a waiter holds none: it is in the middle of a task,
/// and the wait releases the lock of `table`. A measurement is finite, and `variances_worker` has one way out, which
/// gives the claim back.
struct Claims {
    /// Whoever takes the lock of `Program::serial_variances` as well takes this one first.
    table: Guarded<FxHashMap<Sym, Claim>>,
    /// A claim has ended, or variances were shared.
    has_changed: Condvar,
}

/// A symbol that has no entry is not claimed, and no claim of it has ended without a result.
#[derive(Default)]
struct Claim {
    is_taken: bool,
    /// How many claims have ended without a result.
    failures: u8,
    /// Nobody claims it again, and nobody waits: every thread measures for itself.
    is_given_up: bool,
}

/// What `Program::claim_variances` has found.
pub(super) enum VarianceClaim<'s> {
    /// They are shared, perhaps after a wait.
    Known(&'s [u8]),
    /// The caller has the claim. It measures, and then calls `Program::share_variances`.
    Mine,
    /// The caller measures, without a claim.
    Unclaimed,
}

/// Why a claim ends without a result.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum NotShared {
    /// A thread that takes the result would not report it. So it will for every other thread.
    Diagnostic,
    /// The measurement may have used something for which a commit can find this task invalid.
    Notes,
    /// The result depends on a query that was in progress in this task, or was cut short.
    Open,
}

impl<'s> Program<'s> {
    /// See `Claims`. The caller is about to begin an outermost measurement of the variances of `sym`: it is not measuring,
    /// so it has no claim. `may_claim`: whether its result has a chance to be shared.
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

    /// See `Claims`. An outermost measurement has ended.
    /// - `measured`: what it has stored. `may_share`: nothing in it depends on the task that has
    ///   measured it, so it is shared.
    /// - `claimed`: the symbol that the caller has the claim of, and why it is not shared, if it is not.
    ///
    /// Returns what the caller goes on with although it is not what `serial_variances` has: there is another value, which
    /// a task that entered a cycle elsewhere has registered in the meantime, or there is none and this one may not be shared. Nothing
    /// has compared it with what other tasks use, so the caller notes it for its next commit.
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
                // Another thread may do better, once.
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
        let rings = self.commits.rings.lock();
        let from = rings.partition_point(|ring| ring.number <= after);
        let mut since = rings[from..].iter().take_while(|ring| ring.number <= last);
        since.any(|ring| {
            let mut members = members.iter();
            members.any(|member| ring.members.binary_search(member).is_ok())
        })
    }

    /// True if something the task has noted contradicts an earlier commit, so that this commit must be discarded.
    /// - Variances are compared with every earlier commit. A task notes only what it has computed, which it does only if it
    ///   has found nothing. The variances that it has noted stay noted, because it goes on using them.
    /// - Walks: what `markNodeAssignments` finds about a variable depends on which of the functions around the assignments
    ///   was walked first. The task is invalid if it walked a function of the file it was visiting that contains, or is
    ///   nested in, a function that another task walked, unless it saw that task's commit in the file when its visit
    ///   began. Then it also saw what was evaluated along with the walk.
    fn is_invalid(&self, task: &Task<'s>, view: &View<'s>, committing: &Committing) -> bool {
        let has_other_variances = {
            let serial = self.serial_variances.lock();
            let mut noted = task.order_dependent_variances.iter();
            noted.any(|it| {
                serial
                    .get(&it.sym)
                    .is_some_and(|first| it.conflicts_with(first))
            })
        };
        if has_other_variances {
            return true;
        }
        let oldest_pin = view.oldest_pin.get();
        let from = committing.walked.partition_point(|it| it.0 <= oldest_pin);
        let unseen = committing.walked[from..].iter();
        let unseen: Vec<(FileId, Node)> = (unseen.filter(|it| !view.is_own(it.0)))
            .map(|it| (it.1, it.2))
            .collect();
        self.has_walked_across_earlier_walk(&task.assignments_walked.borrow(), &unseen)
    }

    /// The commit `number` of `task` is valid: what the task has noted is what later commits are compared with.
    fn register_notes(&self, task: &mut Task<'s>, committing: &mut Committing, number: u32) {
        {
            let mut serial = self.serial_variances.lock();
            for it in &task.order_dependent_variances {
                serial.entry(it.sym).or_insert(it.variances);
            }
        }
        let walked = task.assignments_walked.get_mut().drain(..);
        committing
            .walked
            .extend(walked.map(|it| (number, it.0, it.1)));
    }
}

impl<'s> Checker<'_, 's> {
    /// Right after `begin_task`: the task commits while it runs, and sees the commits of the others.
    /// `is_alone`: no other task runs, as in the last round.
    pub fn see_commits(&mut self, is_alone: bool) {
        let files = self.p.files.modules.len();
        let view = self.p.commits.view(files);
        // Alone it writes nothing at once: nobody is there to read it, and at a limit it stores, and replaces, what tsgo
        // does.
        let at_once = match is_alone {
            true => 0,
            false => self.p.commits.at_once,
        };
        self.task.see_commits(view, is_alone, at_once);
    }

    /// For a task that sees commits: a greater number than last time if a commit may have added to the tables in between.
    /// A memo that keeps something on the strength of an absence keeps it no longer than this stays the same: an entry
    /// that another task has computed in a cycle says what its absence did not.
    pub(super) fn state_of_commits(&self) -> u64 {
        self.task.view().map_or(0, View::state)
    }

    /// Between two statements or two deferred nodes of the task's own walk.
    #[inline]
    pub(super) fn rest_between_statements(&mut self) {
        if self.task.commits()
            && self.stack.is_empty()
            && self.contextual.is_empty()
            && self.inference_contexts.is_empty()
            && !self.in_variance_computation
        {
            self.rest();
        }
    }

    /// True if the task has logged enough keys to commit. The last round's task never has: no other task runs that could
    /// read its entries, and a published entry can't be replaced. A comparison that overflows caches failures, and
    /// typescript-go replaces them when a later statement repeats one of those comparisons to report an error.
    fn is_commit_due(&self) -> bool {
        self.task.commits()
            && !self.task.is_believed()
            && self.task.buffer().logged() >= KEYS_PER_COMMIT
    }

    /// Nothing is in progress that has looked at a table or is about to store in one.
    fn rest(&mut self) {
        self.lose_what_has_missed_a_ring();
        // A commit here would store the members of a ring that are in other files, and withhold those in this one.
        if self.is_commit_due() && !self.task.is_lost() && !self.task.has_closed_a_ring() {
            let (is_between_files, is_read) = (false, true);
            self.commit(is_between_files, is_read);
        } else if let Some(view) = self.task.view() {
            view.forget();
        }
        self.task.note_what_is_logged_at_rest();
    }

    /// At rest. The task is lost if it has missed a member of a ring that a commit has: then it finds the other members, which
    /// closes no ring and is right from no entry.
    /// - See `Task::is_beside_a_ring`. Whoever misses a member evaluates it, and stores it: the task has stored, since it
    ///   was last at rest, under a key that the commit has.
    /// - The file that the task visits does not change during the visit: the commit has a key in that file.
    fn lose_what_has_missed_a_ring(&self) {
        let Some(view) = self.task.view() else {
            return;
        };
        let newest = view.numbers.with_a_ring.load(Ordering::Acquire);
        let (at_rest, compared) = (view.at_rest.get(), view.compared_with_pinned.get());
        if newest <= at_rest.min(compared) {
            return;
        }
        let (of_records, of_nodes) = self.task.logged_since_rest();
        let rings = self.p.commits.rings.lock();
        let from = rings.partition_point(|ring| ring.number <= at_rest.min(compared));
        let is_of_later_file = |commit: u32| {
            let rank = self.p.commits.rank_of(commit);
            (self.task.file).is_some_and(|file| rank > Some(self.p.files.rank_of_file(file)))
        };
        let has_missed = rings[from..].iter().any(|ring| {
            ring.number > compared
                && ring.of_nodes.iter().any(|key| key[1] == view.pinned.get())
                && !is_of_later_file(ring.number)
                || ring.number > at_rest
                    && (of_records
                        .iter()
                        .any(|key| ring.of_records.binary_search(key).is_ok())
                        || of_nodes
                            .iter()
                            .any(|key| ring.of_nodes.binary_search(key).is_ok()))
        });
        view.compared_with_pinned.set(compared.max(newest));
        if has_missed && !self.task.is_lost() {
            // That cycle is already committed, so the file can be rechecked right away.
            drop(self.task.take_cycle_members());
            (self.task).discard_until_recheck("a ring of which it has missed a member");
        }
    }

    /// True if the task is discarded: its files will be rechecked, and nothing it computes from now on is kept.
    pub fn is_lost(&self) -> bool {
        self.task.is_lost()
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

    /// Before `check_file`: see `Task::set_first_in_order`.
    pub fn set_first_in_order(&self, is_first: bool, is_first_in_component: bool) {
        (self.task).set_first_in_order(is_first, is_first_in_component);
    }

    /// Call after `check_file` and whatever is asked about the file afterwards. `is_last`: the task ends with this file.
    /// `is_read`: see `commit`.
    ///
    /// Returns true if the file is checked for good. Otherwise the task is discarded and the file has to be rechecked. A
    /// commit follows every file, so a discarded task never takes an earlier file with it. The exception is the last
    /// round's task.
    pub fn commit_after_file(&mut self, is_last: bool, is_read: bool) -> bool {
        self.lose_what_has_missed_a_ring();
        // The last round's task commits once, when it ends: see `is_commit_due`. It is never discarded.
        if self.task.is_believed() && !is_last && !self.task.is_lost() {
            return true;
        }
        self.commit(true, is_read)
    }

    /// See the head of this file. Nothing is in progress in the task.
    /// `is_between_files`: no file is being checked.
    /// `is_read`: whether anything will look at the tables afterwards. If not, nothing is stored in them.
    /// Returns whether the task goes on: it is not lost.
    fn commit(&mut self, is_between_files: bool, is_read: bool) -> bool {
        let p = self.p;
        let Some([of_entries_written_at_once, mut reported]) =
            self.take_diagnostics_for_commit(is_between_files)
        else {
            if let Some(view) = self.task.view() {
                view.forget();
            }
            return !self.task.is_lost();
        };
        p.publish_reported(self.task.number(), of_entries_written_at_once);
        if self.task.is_lost() {
            return false;
        }
        let ranks = self.task.files_in_doubt.iter();
        let rank = ranks
            .map(|&file| p.files.rank_of_file(file))
            .max()
            .unwrap_or(0);
        let mut log = self.task.buffer().take_log();
        let ring = self.task.take_has_closed_a_ring().map(|[records, nodes]| {
            let of_records = log.of_records.get(records..).unwrap_or(&log.of_records);
            let of_nodes = log.of_nodes.get(nodes..).unwrap_or(&log.of_nodes);
            let (mut of_records, mut of_nodes) = (of_records.to_vec(), of_nodes.to_vec());
            of_records.shared_sort_unstable();
            of_nodes.shared_sort_unstable();
            Ring {
                number: 0,
                of_records,
                of_nodes,
                members: self.task.take_cycle_members(),
            }
        });
        self.withhold_until_the_file_ends(&mut log, is_between_files);
        let asked = Instant::now();
        let mut committing = p.commits.committing.lock();
        let entered = Instant::now();
        let is_invalid = !self.task.is_believed()
            && (self.task.view()).is_some_and(|view| p.is_invalid(&self.task, view, &committing));
        if is_invalid {
            drop(committing);
            (self.task).discard_until_recheck("a commit that is invalid");
            return false;
        }
        let number = committing.number + 1;
        committing.number = number;
        // Before the commit stores: whoever finds one of its entries finds these too.
        for file in self.files_with_errors.drain() {
            if let Some(word) = p.commits.with_errors.get(file.idx() / 32) {
                word.fetch_or(1 << (file.0 % 32), Ordering::Relaxed);
            }
        }
        p.commits.numbers.ranks.lock().push(rank);
        p.register_notes(&mut self.task, &mut committing, number);
        let task = &self.task;
        p.drop_diagnostics_of_losers(&mut reported, |commit| {
            task.view().is_some_and(|view| view.is_own(commit))
        });
        p.publish_reported(task.number(), reported);
        let stored = match is_read || ring.is_some() {
            true => (p.commits).store(&tables_of(p), task, &mut log, number, ring),
            false => 0,
        };
        drop(committing);
        task.count_waits([entered - asked, entered.elapsed(), Duration::ZERO]);
        task.count_committed(log.len() as u64, stored);
        if let Some(view) = task.view() {
            view.has_committed(number);
        }
        task.write_at_once_again();
        if task.closed_a_cycle {
            p.closed_a_cycle.store(true, Ordering::Relaxed);
        }
        task.buffer().give_back_log(log);
        true
    }

    /// What the task has stored under the nodes and symbols of a file that it has visited waits for a commit that follows
    /// the file. If the task is lost before that, another one checks the file again, and has to evaluate what this one
    /// has: to evaluate an expression is also to leave notes for the later passes over the file, like
    /// `unresolved_identifiers`, and whoever finds an entry leaves none.
    fn withhold_until_the_file_ends(&mut self, log: &mut Log, is_between_files: bool) {
        let withheld = &mut self.withheld_until_the_file_ends;
        if is_between_files {
            log.of_nodes.append(withheld);
            self.task.files_in_doubt.clear();
            return;
        }
        let in_doubt = &self.task.files_in_doubt;
        log.of_nodes.retain(|&entry| {
            let is_in_doubt = in_doubt.contains(&FileId(entry[1]));
            if is_in_doubt {
                withheld.push(entry);
            }
            !is_in_doubt
        });
    }

    /// Ends a task that `see_commits` was called for, after its last `commit_after_file`, on its own thread.
    pub fn end_task_after_commits(&mut self) -> Ended {
        self.task.end(self.p)
    }
}
