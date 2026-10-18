//! Tasks, steps and barriers (bulk-synchronous parallel).
//!
//! Checking runs in steps. During a step the published state is read-only. A task reads only the
//! published state and what it owns, and writes only to what it owns. So its result is a function
//! of the program and of the published state at the start of its step.
//!
//! A `Task` owns its stores: the records it creates (`crate::types::OwnStore`, ids with `LOCAL`),
//! the task-local parts of the `Buffered` tables (the buffer), the entries of the `FileLocal`
//! tables, its diagnostics. There is no thread-local state.
//!
//! At the end of a task, on its own thread, `Task::finish` extracts what is to be published,
//! compactly, and frees the rest. At the barrier after a step, the link step assigns a published id
//! to every task-local id that survives (`Program::link`), and then `publish` applies the tasks'
//! entries in task order, with every key and value rewritten through the link (`follow`). The first
//! entry for a key wins.
//!
//! The other way to run tasks, without steps and barriers, is in `super::commit`.

use super::commit::View;
use super::self_check::DifferingEntries;
use super::sink::Reported;
use super::{Program, Query};
use crate::atom::Intern;
use crate::jitter::Place;
use crate::local::{Buffer, FileLocalTables, SlotNumber};
use crate::node::Node;
use crate::program::{FileId, Sym};
use crate::session::Arena;
use crate::table::{Applied, Entries, Finishing, Handle, Payload, Publish, Share};
use crate::types::{Link, Marks, OwnRecords, OwnStore, Sharing, TypeStore};
use crate::util::SharedSort;
use crate::util::{InParallel, for_each_mut};
use std::cell::{Cell, RefCell, UnsafeCell};
use std::time::Duration;

/// Permission to store a finished result. Only `Checker::leave` and the scopes in check/mod.rs
/// create one.
///
/// It holds `Task::held_back` as of the beginning of the computation: see `Task::has_held_back_since`.
#[derive(Copy, Clone)]
pub struct Stored(u64);

impl Stored {
    /// For a result of which nobody knows when its computation began. `Task::held_back` never gets this far.
    #[inline]
    pub(super) fn new() -> Stored {
        Stored(u64::MAX)
    }

    /// `held_back`: `Task::held_back` when the computation began.
    #[inline]
    pub(super) fn since(held_back: u64) -> Stored {
        Stored(held_back)
    }

    /// The same permission for a result that waits for the next commit: another store under its key is to replace it.
    #[inline]
    pub(super) fn held_back(self) -> Stored {
        Stored::new()
    }
}

/// The result depends on a frame that is still in progress.
#[derive(Copy, Clone)]
pub struct Open;

/// One per `Checker`.
pub struct Task<'s> {
    /// The step, and the index of the task in it. `None`: the task is outside the plan.
    place: Option<(u32, u32)>,
    /// See `Task::begin`.
    is_read_later: bool,
    /// The `Buffered` tables of which `finish` passes nothing to the barrier: a bit set, by slot.
    withheld: u128,
    /// The file that the task is visiting.
    pub file: Option<FileId>,
    /// The files that the task has visited and that no commit has followed: they are not checked for good.
    pub(super) files_in_doubt: Vec<FileId>,
    /// Nonzero: the task is one checker of a `checkerPool` of this size. Its index in the step is
    /// its checker index.
    pub(super) checker_count: u32,
    /// `Some(q)`: the diagnostic belongs to the entry that `q` stores. `None`: it belongs to the task.
    pub(super) diagnostics: Vec<(Option<Query>, Reported)>,
    /// Whether a query of this task has re-entered itself.
    pub(super) closed_a_cycle: bool,
    /// How many queries about a source file of another component the task has evaluated, by `FOREIGN_EVALUATION_KINDS`.
    pub(super) foreign_evaluations: [u32; 14],
    /// See `Finished::order_dependent_variances`.
    pub(super) order_dependent_variances: Vec<OrderDependent<'s>>,
    /// See `Finished::listings`.
    pub(super) listings: Vec<(Sym, bool)>,
    /// See `Finished::assignments_walked`. It is added to under `&Checker`.
    pub(super) assignments_walked: RefCell<Vec<(FileId, Node, bool)>>,
    /// See `hold_back`.
    held_back: Cell<u64>,
    /// `Some`: the task commits while it runs, and sees the commits of the others. See `super::commit`.
    view: Option<View<'s>>,
    /// See `lose`. It is set under `&Checker`.
    is_lost: Cell<Option<&'static str>>,
    /// The task is never lost: it runs alone, in the last round.
    is_believed: bool,
    /// See `discard_for_cycle`.
    is_discarded_for_cycle: Cell<bool>,
    /// See `close_ring`.
    is_first_in_order: Cell<bool>,
    is_first_in_component: Cell<bool>,
    /// See `take_cycle_members`.
    cycle_members: RefCell<Vec<u64>>,
    /// `Some`: `close_ring` has believed the task since its last commit. `Buffer::lengths_of_log` the first time.
    has_closed_a_ring: Cell<Option<[usize; 2]>>,
    /// `Buffer::lengths_of_log` when the task was last at rest.
    logged_at_rest: Cell<[usize; 2]>,
    /// How many keys the task had logged at its commits, and how many entries they have stored.
    committed: Cell<[u64; 2]>,
    /// How long the task has waited for the mutex of the commits, has had it, and has waited for claims of variances.
    waits: Cell<[Duration; 3]>,
    /// The tables to which the task writes at once, as a bit set by slot: see `may_write_at_once`. 0: none, or none before
    /// its next commit (`stop_writing_at_once`).
    at_once: Cell<u128>,
    /// What `at_once` is again after a commit.
    at_once_unless_stopped: u128,
    /// How many of `diagnostics`, from the first on, were logged before `stop_writing_at_once`. `usize::MAX`: it was not
    /// called since the last commit.
    logged_before_the_stop: Cell<usize>,
    /// See `super::self_check`.
    pub(crate) differing: RefCell<DifferingEntries>,
    /// The types, signatures, mappers and component lists that the task has created.
    pub(crate) own: OwnStore<'s>,
    /// Interior-mutable because every access to a table takes `&Task`: some are made under `&Checker`. See `Task::buffer`.
    buffer: UnsafeCell<Buffer<'s>>,
    file_local: UnsafeCell<FileLocalTables>,
}

impl<'s> Task<'s> {
    /// A task outside the plan. It reads the published state, and what it writes is dropped with it.
    /// `arena`: of the calling thread, which runs the task. `types`: the published records.
    pub(super) fn new_in(arena: &'s Arena, types: &TypeStore<'s>) -> Task<'s> {
        Task {
            place: None,
            is_read_later: true,
            withheld: 0,
            file: None,
            files_in_doubt: Vec::new(),
            checker_count: 0,
            diagnostics: Vec::new(),
            closed_a_cycle: false,
            foreign_evaluations: [0; 14],
            order_dependent_variances: Vec::new(),
            listings: Vec::new(),
            assignments_walked: RefCell::default(),
            held_back: Cell::new(0),
            view: None,
            is_lost: Cell::new(None),
            is_believed: false,
            is_discarded_for_cycle: Cell::new(false),
            is_first_in_order: Cell::new(false),
            is_first_in_component: Cell::new(false),
            cycle_members: RefCell::default(),
            has_closed_a_ring: Cell::new(None),
            logged_at_rest: Cell::new([0; 2]),
            committed: Cell::new([0; 2]),
            waits: Cell::new([Duration::ZERO; 3]),
            at_once: Cell::new(0),
            at_once_unless_stopped: 0,
            logged_before_the_stop: Cell::new(usize::MAX),
            differing: RefCell::default(),
            own: OwnStore::new_in(arena, types),
            buffer: UnsafeCell::new(Buffer::new()),
            file_local: UnsafeCell::new(FileLocalTables::new()),
        }
    }

    /// Puts the task into the plan. `step` counts from 0. `index`: the index of the task in its
    /// step, in task order. Everything the task owned before is dropped, so no id with `LOCAL` and
    /// no reference from a kept table may be live.
    /// `is_read_later`: whether anything will read what the task publishes. If not, `finish`
    /// returns only the diagnostics.
    pub fn begin(&mut self, step: u32, index: u32, is_read_later: bool) {
        debug_assert!(
            self.own.is_empty(),
            "created before `begin`: the id would dangle"
        );
        self.drop_everything();
        self.own.set_is_read_later(is_read_later);
        (self.place, self.is_read_later) = (Some((step, index)), is_read_later);
    }

    /// `begin` has been called: the entries the task buffers go to a barrier.
    #[inline]
    pub fn is_planned(&self) -> bool {
        self.place.is_some()
    }

    /// The index of the task in its step.
    pub(super) fn index(&self) -> Option<u32> {
        self.place.map(|(_, index)| index)
    }

    /// A number that no other task of the plan has.
    pub(super) fn number(&self) -> u64 {
        (self.place).map_or(u64::MAX, |(step, index)| {
            u64::from(step) << 32 | u64::from(index)
        })
    }

    /// After `begin`. `is_believed`: see the field. `at_once`: the tables to which it writes at once, as a bit set by slot.
    pub(super) fn see_commits(&mut self, view: View<'s>, is_believed: bool, at_once: u128) {
        self.buffer.get_mut().begin_log();
        (self.view, self.is_believed) = (Some(view), is_believed);
        self.at_once_unless_stopped = at_once;
        self.write_at_once_again();
    }

    /// Whether an entry of the table with `slot`, stored with `stored`, goes to the shared part now and not at the next
    /// commit. The caller has found that neither its key nor its value is bound.
    ///
    /// Whoever finds an entry does not evaluate it. So he has to find whatever was stored while it was evaluated as well.
    /// What is keyed by syntax waits for the commit. So an entry is written at once only if nothing was held back since
    /// its evaluation began: then whatever that has stored was written at once too, before it.
    #[inline]
    pub(crate) fn may_write_at_once(&self, slot: u32, stored: Stored) -> bool {
        self.at_once.get() >> slot & 1 != 0
            && !self.has_held_back_since(stored)
            && !self.is_beside_a_ring()
    }

    /// Whether the task writes to any table at once.
    #[inline]
    pub(crate) fn writes_at_once(&self) -> bool {
        self.at_once.get() != 0 && !self.is_beside_a_ring()
    }

    /// Until its next commit the task writes nothing at once. What is written at once can't be taken back, and what the
    /// task computes from here on may be thrown away with it, or follows from an entry that no other task sees yet and
    /// would compute differently: it is lost, it has noted something for which the commit can find it invalid, or it
    /// has stored what a member of a resolution cycle gets.
    pub(super) fn stop_writing_at_once(&self) {
        if self.at_once.replace(0) != 0 {
            self.logged_before_the_stop.set(self.diagnostics.len());
        }
    }

    /// At the beginning, and after a commit: what the task had noted is valid, and what it had held back is there for all.
    pub(super) fn write_at_once_again(&self) {
        if !self.is_lost() {
            self.at_once.set(self.at_once_unless_stopped);
            let logged = match self.at_once_unless_stopped {
                0 => 0,
                _ => usize::MAX,
            };
            self.logged_before_the_stop.set(logged);
        }
    }

    /// How many of `diagnostics`, from the first on, were logged while the task wrote at once.
    pub(super) fn logged_while_writing_at_once(&self) -> usize {
        self.logged_before_the_stop.get()
    }

    #[inline]
    pub(crate) fn view(&self) -> Option<&View<'s>> {
        self.view.as_ref()
    }

    /// `see_commits` was called.
    #[inline]
    pub(crate) fn commits(&self) -> bool {
        self.view.is_some()
    }

    /// `CommitPolicy::compares_lost`
    pub(crate) fn compares_lost_entries(&self) -> bool {
        self.view.as_ref().is_some_and(View::compares_lost)
    }

    /// Whether a commit of the task will store what it stores now.
    #[inline]
    pub(crate) fn shares_what_it_stores(&self) -> bool {
        self.commits() && !self.is_lost()
    }

    /// What the task has done since its last commit is thrown away, and so is what it does from now on.
    /// `why`: for `--timing`.
    pub(super) fn lose(&self, why: &'static str) {
        if self.commits() && !self.is_believed && !self.is_lost() {
            self.is_lost.set(Some(why));
        }
        self.stop_writing_at_once();
    }

    /// Discards the task because of a cycle. Its files can be rechecked once a commit resolves that cycle.
    pub(super) fn discard_for_cycle(&self, why: &'static str) {
        self.is_discarded_for_cycle
            .set(!self.is_lost() || self.is_discarded_for_cycle.get());
        self.lose(why);
    }

    pub(super) fn is_discarded_for_cycle(&self) -> bool {
        self.is_discarded_for_cycle.get()
    }

    #[inline]
    pub(super) fn is_lost(&self) -> bool {
        self.is_lost.get().is_some()
    }

    /// Before the task visits a file. `is_first`: every file before that one in program order is checked for good, or the
    /// task has checked it itself. `is_first_in_component`: the same, counting only the earlier files in that file's
    /// import cycle and the files they import, directly or through other files.
    pub(super) fn set_first_in_order(&self, is_first: bool, is_first_in_component: bool) {
        self.is_first_in_order.set(is_first);
        (self.is_first_in_component).set(is_first_in_component);
    }

    /// The task has come round to something that is in progress, and what the members of that ring get depends on where
    /// it was entered. tsc enters it from the first file in program order that leads there. That is this task if every
    /// file before is checked for good: none of them has led there, or the task would have found what the members got.
    /// Any other task is lost. Its files are checked again when the files before them are.
    ///
    /// `is_reachable_only_by_importers`: returns true if only files that import the current file can reach the cycle. Then
    /// unrelated earlier files don't matter.
    ///
    /// `members`: hashes of the queries in the cycle.
    pub(super) fn close_ring(
        &self,
        is_reachable_only_by_importers: impl FnOnce() -> bool,
        members: impl Iterator<Item = u64>,
    ) {
        if self.is_lost() {
            return;
        }
        self.cycle_members.borrow_mut().extend(members);
        if self.is_first_in_order.get()
            || self.is_believed
            || self.is_first_in_component.get() && is_reachable_only_by_importers()
        {
            if self.has_closed_a_ring.get().is_none() {
                let logged = self.buffer().lengths_of_log();
                self.has_closed_a_ring.set(Some(logged));
            }
            self.stop_writing_at_once();
        } else {
            self.discard_for_cycle("a ring that an earlier file may enter");
        }
    }

    /// Returns the `members` of the cycles this task has resolved since its last commit, sorted. For a task that was
    /// discarded because of a cycle, that cycle is included.
    pub(super) fn take_cycle_members(&self) -> Vec<u64> {
        let mut members = self.cycle_members.take();
        members.shared_sort_unstable();
        members.dedup();
        members
    }

    /// Whether `close_ring` has believed the task since its last commit.
    pub(super) fn has_closed_a_ring(&self) -> bool {
        self.has_closed_a_ring.get().is_some()
    }

    /// For a commit: `Buffer::lengths_of_log` when `close_ring` first believed the task since the last one.
    pub(super) fn take_has_closed_a_ring(&self) -> Option<[usize; 2]> {
        self.has_closed_a_ring.take()
    }

    /// Whether a commit with what the members of a ring got has begun since the task was last at rest. What the task is
    /// evaluating may have missed one member and found the next, which closes no ring and is right from no entry. So it
    /// writes nothing at once before it is at rest again, where `Checker::lose_what_has_missed_a_ring` looks closer.
    #[inline]
    pub(crate) fn is_beside_a_ring(&self) -> bool {
        (self.view.as_ref()).is_some_and(View::is_beside_a_ring)
    }

    /// Nothing is in progress in the task.
    pub(super) fn note_what_is_logged_at_rest(&self) {
        self.logged_at_rest.set(self.buffer().lengths_of_log());
    }

    /// The keys under which the task has stored since it was last at rest, but for what it has written at once.
    pub(super) fn logged_since_rest(&self) -> (&[[u32; 2]], &[[u32; 3]]) {
        self.buffer().logged_since(self.logged_at_rest.get())
    }

    pub(super) fn is_believed(&self) -> bool {
        self.is_believed
    }

    /// A commit had `logged` keys to go through and has stored `stored` entries.
    pub(super) fn count_committed(&self, logged: u64, stored: u64) {
        let [so_far, stored_so_far] = self.committed.get();
        (self.committed).set([so_far + logged, stored_so_far + stored]);
    }

    /// Adds to `waits`.
    pub(super) fn count_waits(&self, more: [Duration; 3]) {
        let [for_commits, in_commits, for_claims] = self.waits.get();
        (self.waits).set([
            for_commits + more[0],
            in_commits + more[1],
            for_claims + more[2],
        ]);
    }

    /// Whether the task has noted a listing or a walk for which its next commit can find it invalid
    /// (`Finished::can_be_invalid`), or is lost. What it has computed since then may depend on that.
    pub(super) fn may_be_thrown_away(&self) -> bool {
        !self.listings.is_empty()
            || self.assignments_walked.borrow().iter().any(|it| it.2)
            || self.is_lost()
    }

    /// Ends a task that commits, on its own thread, after its last commit.
    pub(super) fn end(&mut self, program: &Program<'s>) -> Ended {
        program.types.take_back_ids(&self.own);
        let [logged, stored] = self.committed.get();
        let ended = Ended {
            logged,
            stored,
            waits: self.waits.get(),
            lost_because_of: self.is_lost.get(),
            foreign_evaluations: self.foreign_evaluations,
            differing: self.differing.take(),
        };
        self.drop_everything();
        ended
    }

    /// Whatever is being computed now depends on more than its key and the program. Every computation in progress is
    /// meant, so this is a count, which each of them compares when it ends: `has_held_back_since`.
    #[inline]
    pub(crate) fn hold_back(&self) {
        self.held_back.set(self.held_back.get() + 1);
    }

    /// How often `hold_back` was called.
    #[inline]
    pub(crate) fn held_back(&self) -> u64 {
        self.held_back.get()
    }

    /// Whether `hold_back` was called since the computation began whose result `stored` permits to store, or nobody knows
    /// when that was.
    #[inline]
    pub(crate) fn has_held_back_since(&self, stored: Stored) -> bool {
        stored.0 != self.held_back.get()
    }

    /// From now on the task visits `file`: the entries keyed by its nodes are stored densely. The
    /// entries of the `FileLocal` tables are dropped, those of the `Buffered` tables stay. A task
    /// can visit any number of files. `is_imported`: whether another file can refer to `file`. If
    /// none can, anything that mentions `file` is bound and is never published.
    pub fn begin_file(&mut self, file: FileId, is_imported: bool) {
        self.file = Some(file);
        self.files_in_doubt.push(file);
        self.note_what_is_logged_at_rest();
        self.own.add_visited_file(file);
        if !is_imported {
            self.own.add_unimported_file(file);
        }
        self.buffer.get_mut().begin_file(file.0, is_imported);
        self.file_local.get_mut().begin_file(file.0);
        if let Some(view) = &self.view {
            view.pin(file);
            self.own.wait_at(Place::FileBegins);
        }
    }

    /// The entries keyed by the nodes of `file` are stored densely from now on, as after
    /// `begin_file`. The task does not visit `file`: see `Checker::check_statements_ahead`.
    pub(super) fn store_densely(&mut self, file: FileId) {
        self.file_local.get_mut().begin_file(file.0);
        self.buffer.get_mut().begin_file(file.0, true);
    }

    /// `finish` passes no entry of `TABLES_OF_RECORDS` to the barrier.
    pub(super) fn withhold_tables_of_records(&mut self) {
        for (slot, name) in table_names().into_iter().enumerate() {
            if TABLES_OF_RECORDS.contains(&name) {
                self.withheld |= 1 << slot;
            }
        }
        debug_assert_eq!(self.withheld.count_ones() as usize, TABLES_OF_RECORDS.len());
    }

    fn drop_everything(&mut self) {
        (self.place, self.is_read_later, self.file) = (None, true, None);
        self.files_in_doubt.clear();
        self.withheld = 0;
        self.checker_count = 0;
        self.diagnostics.clear();
        (self.closed_a_cycle, self.foreign_evaluations) = (false, [0; 14]);
        self.order_dependent_variances.clear();
        self.listings.clear();
        self.assignments_walked.get_mut().clear();
        (self.view, self.is_believed) = (None, false);
        self.is_lost.set(None);
        self.is_discarded_for_cycle.set(false);
        self.is_first_in_order.set(false);
        self.is_first_in_component.set(false);
        self.cycle_members.get_mut().clear();
        self.has_closed_a_ring.set(None);
        self.logged_at_rest.set([0; 2]);
        self.committed.set([0; 2]);
        self.waits.set([Duration::ZERO; 3]);
        (self.at_once_unless_stopped, self.at_once) = (0, Cell::new(0));
        self.logged_before_the_stop.set(usize::MAX);
        *self.differing.get_mut() = DifferingEntries::default();
        // Outside the plan it publishes nothing.
        let sharing = self.own.sharing().min(Sharing::Finds);
        self.own.clear();
        self.own.set_sharing(sharing);
        self.buffer.get_mut().clear();
        self.file_local.get_mut().clear();
    }

    /// The task-local parts of the `Buffered` tables.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn buffer(&self) -> &mut Buffer<'s> {
        // SAFETY: the task is not `Sync`, and no two of these references are live at the same time:
        // a method of `crate::table` uses the reference for calls into `crate::local`, which calls
        // nothing outside itself, and asks for the next one when it is done with this one.
        // References returned by an indirect table point into a `LocalVec`, whose elements do not
        // move until `finish`, `begin` or the drop.
        unsafe { &mut *self.buffer.get() }
    }

    /// The entries of the `FileLocal` tables.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn file_local(&self) -> &mut FileLocalTables {
        // SAFETY: as in `buffer`.
        unsafe { &mut *self.file_local.get() }
    }

    /// Ends a task in the plan, on its own thread. The result holds everything that goes to the
    /// barrier: the entries whose key and value are not bound, by table, and the task-local records
    /// that they mention. Everything else is freed here.
    /// `diagnostics`: from `Checker::take_diagnostics`.
    pub(super) fn finish(
        &mut self,
        program: &Program<'s>,
        diagnostics: Vec<(Option<Query>, Reported)>,
    ) -> Finished<'s> {
        program.types.take_back_ids(&self.own);
        self.finish_tables(&tables_of(program), diagnostics)
    }

    /// `tables`: by slot.
    fn finish_tables(
        &mut self,
        tables: &[&dyn Publish<'s>],
        diagnostics: Vec<(Option<Query>, Reported)>,
    ) -> Finished<'s> {
        let (step, index) = self
            .place
            .expect("a task outside the plan goes to no barrier");
        let mut marks = Marks::new(&self.own);
        let buffer = self.buffer.get_mut();
        let mut finishing = Finishing::new(&self.own, &mut marks);
        let mut published = Vec::new();
        // Entries that nothing reads later are not inspected. They are dropped below.
        if self.is_read_later {
            for table in tables {
                if (self.withheld >> table.slot()) & 1 != 0 {
                    published.push(None);
                    continue;
                }
                published.push(table.finish(buffer, &mut finishing));
            }
        }
        let buffered = (published.iter().flatten())
            .map(|it| u64::from(it.len))
            .sum();

        let own = self.own.finish(marks);
        let (closed_a_cycle, foreign_evaluations) = (self.closed_a_cycle, self.foreign_evaluations);
        let order_dependent_variances = std::mem::take(&mut self.order_dependent_variances);
        let listings = std::mem::take(&mut self.listings);
        let assignments_walked = self.assignments_walked.take();
        self.drop_everything();
        Finished {
            step,
            index,
            diagnostics,
            closed_a_cycle,
            foreign_evaluations,
            order_dependent_variances,
            listings,
            assignments_walked,
            own,
            link: Link::default(),
            tables: published,
            buffered,
        }
    }
}

/// What is left of a task that has committed what it had to publish, for `--timing`.
pub struct Ended {
    /// How many keys the task had logged at its commits, and how many entries they have stored. The others were bound, or
    /// another task was first.
    pub logged: u64,
    pub stored: u64,
    /// How long the task has waited for the mutex of the commits, has had it, and has waited for claims of variances.
    pub waits: [Duration; 3],
    /// `Some`: the task was lost, and why.
    pub lost_because_of: Option<&'static str>,
    pub foreign_evaluations: [u32; 14],
    pub differing: DifferingEntries,
}

/// The result a task passes to the barrier.
pub struct Finished<'s> {
    pub step: u32,
    pub index: u32,
    /// `Some(q)`: the diagnostic belongs to the query `q`. `None`: it belongs to the task.
    pub(super) diagnostics: Vec<(Option<Query>, Reported)>,
    pub closed_a_cycle: bool,
    pub foreign_evaluations: [u32; 14],
    /// See `Program::validate`.
    pub(super) order_dependent_variances: Vec<OrderDependent<'s>>,
    /// The lists of properties that the task assigned to intersections, by the type alias that
    /// names the intersection: whether the members of a mapped type among its constituents were
    /// in place, so that the list lacks them (`Program::listed_properties`), or it has them all.
    /// Which of the two a checker keeps depends on which statement gets there first. See
    /// `Program::validate`.
    pub(super) listings: Vec<(Sym, bool)>,
    /// The functions and source files that `markNodeAssignments` has walked in the task
    /// (`Program::assignments_marked`), and whether the task was visiting the file. See
    /// `Program::validate`.
    pub(super) assignments_walked: Vec<(FileId, Node, bool)>,
    /// The task-local records that the entries mention, in creation order.
    pub own: OwnRecords<'s>,
    /// `Program::link` fills it in, `publish` follows it.
    pub link: Link,
    /// By slot.
    tables: Vec<Option<Entries<'s>>>,
    /// The number of entries in `tables`.
    buffered: u64,
}

impl Finished<'_> {
    /// Everything another task could notice about this task if its tables were never published, provided that is only
    /// variances. `None`: the task also reported a diagnostic, or left something else that `Program::validate` compares.
    ///
    /// The tables are caches. Nothing is published after the last step of a plan, which is where most files are checked, so
    /// no result may depend on them.
    pub fn only_variances(&self) -> Option<impl Iterator<Item = (Sym, &[u8])>> {
        // No `..`: whoever adds a field has to decide here whether another task can notice it.
        let Finished {
            step: _,
            index: _,
            diagnostics,
            // Nothing reads `Program::closed_a_cycle`.
            closed_a_cycle: _,
            // A statistic.
            foreign_evaluations: _,
            order_dependent_variances,
            listings,
            assignments_walked,
            // The tables, and the records their entries refer to.
            own: _,
            link: _,
            tables: _,
            buffered: _,
        } = self;
        (diagnostics.is_empty() && listings.is_empty() && assignments_walked.is_empty()).then(
            || {
                order_dependent_variances
                    .iter()
                    .map(|it| (it.sym, it.variances))
            },
        )
    }

    /// Whether `Program::validate` can find the task invalid.
    pub fn can_be_invalid(&self) -> bool {
        let mut measured = self.order_dependent_variances.iter();
        measured.any(|it| it.compared | it.failed | it.inferred != 0)
            || self.assignments_walked.iter().any(|it| it.2)
            || !self.listings.is_empty()
    }
}

impl<'s> Program<'s> {
    /// Call before the first task. Behaves as if an earlier task had left these variances in `Finished::only_variances`.
    pub fn assume_variances(&self, sym: Sym, variances: &[u8]) {
        let variances = self.session.arena().alloc_slice_copy(variances);
        self.serial_variances.lock().entry(sym).or_insert(variances);
    }

    /// Whether some task so far wrote to one of the two sets that tasks write to directly, not through their `Finished`.
    pub fn has_notes_outside_finished(&self) -> bool {
        !self.properties_referenced_before.lock().is_empty()
            || !self.emit_helper_errors_of_earlier_files.lock().is_empty()
    }
}

/// Variances that a task computed during a cycle (`variances_worker` was re-entered for a symbol in progress), so their value depends on
/// the entry point into the cycle. The masks record how the task used them: one bit per type parameter, the last bit for the 32nd on.
pub struct OrderDependent<'s> {
    pub(super) sym: Sym,
    pub(super) variances: &'s [u8],
    /// Two different type arguments were compared under this variance and are related.
    pub(super) compared: u32,
    /// Two type arguments were compared under this variance and are not related, so the comparison of the type argument lists fails
    /// whatever the other variances are. `relateVariances` then tests three more properties of the list.
    pub(super) failed: u32,
    /// The target type argument was `void` in a comparison that failed (`hasCovariantVoidArgument`).
    pub(super) void_targets: u32,
    /// Inference read this variance. It only tests for contravariance.
    pub(super) inferred: u32,
}

impl OrderDependent<'_> {
    /// Whether a result of the task can differ under the variances `serial`.
    pub(super) fn conflicts_with(&self, serial: &[u8]) -> bool {
        // `VarianceFlagsVarianceMask`: invariant, covariant, contravariant. `VarianceFlagsAllowsStructuralFallback`.
        let is = |variance: u8, kind: u8| variance & 7 == kind;
        let some =
            |variances: &[u8], test: &dyn Fn(u8) -> bool| variances.iter().any(|&it| test(it));
        let pairs = self.variances.iter().zip(serial).enumerate();
        pairs.into_iter().any(|(i, (&own, &serial))| {
            let bit = 1 << i.min(31);
            (self.compared | self.failed) & bit != 0 && own != serial
                || self.void_targets & bit != 0 && is(own, 1) != is(serial, 1)
                || self.inferred & bit != 0 && is(own, 2) != is(serial, 2)
        }) || self.failed != 0
            && (some(self.variances, &|it| it & 24 != 0) != some(serial, &|it| it & 24 != 0)
                || some(self.variances, &|it| is(it, 0)) != some(serial, &|it| is(it, 0)))
    }
}

/// Statistics of a barrier, for `--timing`. Each is a function of the program. `buffered ==
/// published + lost`.
#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct Published {
    /// The entries that the tasks passed to the barrier.
    pub buffered: u64,
    pub published: u64,
    /// Lost to a task with a lower index in the step, or to the published state.
    pub lost: u64,
    /// See `Applied::digest`. 0 unless requested.
    pub digest: u64,
    /// `(buffered, published)` of each table, in the order of `table_names`.
    pub by_table: Vec<(u64, u64)>,
}

/// The `Buffered` tables keyed by a type, a signature or a mapper, except for `relations` and for the small ones that say something
/// about a declared type parameter or flag a type. An entry of one of these is evaluated inside an evaluation that `relations` or a
/// table keyed by a node or a symbol records, so a task that finds those entries does not ask for these.
const TABLES_OF_RECORDS: [&str; 30] = [
    "shapes",
    "members",
    "sig_params",
    "sig_type_params",
    "call_signatures",
    "construct_signatures",
    "candidate_orders",
    "resolved_type_arguments",
    "key_properties",
    "instantiations",
    "composed",
    "distributed_intersections",
    "mapped_prop_types",
    "reverse_mapped_cache",
    "intersected_props",
    "union_properties",
    "union_objects",
    "intersection_objects",
    "listed_properties",
    "keys_of_properties",
    "conditionals",
    "resolved_return_types",
    "awaited_types",
    "optional_properties",
    "never_intersections",
    "mapped_targets",
    "inferred_constraints",
    "constraints",
    "plain_global_refs",
    "equivalent_base_types",
];

/// The tables to which a task that commits writes at once (`Task::may_write_at_once`), as a bit set by slot: those that are
/// keyed by a record and hold results. Not `listed_properties`: which list an intersection keeps is compared at a commit.
pub(super) fn tables_written_at_once() -> u128 {
    let more = ["relations", "type_param_constraints", "type_param_defaults"];
    let mut set = 0;
    for (slot, name) in table_names().into_iter().enumerate() {
        if name != "listed_properties"
            && (TABLES_OF_RECORDS.contains(&name) || more.contains(&name))
        {
            set |= 1 << slot;
        }
    }
    set
}

/// The names of the `Buffered` fields of `Program`, by slot.
const TABLE_NAMES: &[&str] = {
    macro_rules! each {
        ($($field:ident)*) => { &[$(stringify!($field)),*] };
    }
    super::buffered_fields!(each)
};

const _: () = assert!(TABLE_NAMES.len() <= crate::local::MOST_TABLES);

pub fn table_names() -> Vec<&'static str> {
    TABLE_NAMES.to_vec()
}

/// The slot of the `Buffered` field `name` of `Program`, for the type of the field. `number_tables` gives it the same.
pub(super) const fn slot_of(name: &str) -> u32 {
    let (name, mut slot) = (name.as_bytes(), 0);
    while slot < TABLE_NAMES.len() {
        let other = TABLE_NAMES[slot].as_bytes();
        let mut same = 0;
        while same < name.len() && same < other.len() && name[same] == other[same] {
            same += 1;
        }
        if same == name.len() && same == other.len() {
            return slot as u32;
        }
        slot += 1;
    }
    panic!("not in `buffered_fields!`")
}

/// The `Buffered` tables of `program`. The slot of a table is its index here: `number_tables`.
pub(super) fn tables_of<'a, 's>(program: &'a Program<'s>) -> Vec<&'a dyn Publish<'s>> {
    macro_rules! each {
        ($($field:ident)*) => { vec![$(&program.$field as &dyn Publish<'s>),*] };
    }
    super::buffered_fields!(each)
}

/// Called last by `Program::new`. A table finds its task-local part in a task by its slot, which is
/// its index in `buffered_fields!` or in `file_local_fields!`.
pub(super) fn number_tables(program: &mut Program) {
    macro_rules! each {
        ($($field:ident)*) => {{
            let mut slot = 0;
            $(
                // SAFETY: every table of the list gets another number.
                program.$field.set_slot(unsafe { SlotNumber::new(slot) });
                slot += 1;
            )*
            let _ = slot;
        }};
    }
    super::buffered_fields!(each);
    super::file_local_fields!(each);
    (program.members).hold_handles_of(&mut program.shapes, super::shape::CachedMembers::shape_mut);
}

/// The entries of all tasks for one table, or for one part of it.
struct Stage<'a, 's> {
    table: &'a dyn Publish<'s>,
    part: usize,
    /// In task order.
    shares: Vec<Share<'a, 's>>,
    /// Set afterwards: the number of entries that were stored.
    published: u64,
}

/// The work of one thread: it applies a table or a part of one, then the tables whose values hold
/// its handles.
struct Chain<'a, 's> {
    stages: Vec<Stage<'a, 's>>,
    len: u64,
    applied: Applied<'a>,
}

/// Runs at the barrier, after the link step. `finished`: the tasks of one step, in task order. No
/// task is running.
///
/// 1. Follow, parallel over tasks and tables: every key and value is rewritten through the link of
///    its task.
/// 2. Apply, parallel over tables and parts of tables: one thread applies all tasks' entries of one
///    table or part, in task order, and the first entry for a key wins. Two threads never touch one
///    key, so the outcome does not depend on timing.
pub fn publish<'s>(
    program: &Program<'s>,
    finished: &mut [Finished<'s>],
    in_parallel: InParallel<'_>,
    with_digest: bool,
) -> Published {
    let atoms = with_digest.then_some(&program.files.atoms as &dyn Intern);
    publish_tables(&tables_of(program), finished, in_parallel, atoms)
}

/// A barrier with fewer entries than this does not use the pool.
const FEW_ENTRIES: u64 = 4096;

/// `tables`: indexed by slot. `atoms`: `Some` if the digest is requested, which treats an atom as
/// its text.
fn publish_tables<'s>(
    tables: &[&dyn Publish<'s>],
    finished: &mut [Finished<'s>],
    in_parallel: InParallel<'_>,
    atoms: Option<&dyn Intern>,
) -> Published {
    let mut followed: Vec<(usize, Entries<'s>)> = Vec::new();
    for (task, finished) in finished.iter_mut().enumerate() {
        followed.extend((finished.tables.drain(..).flatten()).map(|entries| (task, entries)));
    }
    let mut by_table = vec![(0, 0); tables.len()];
    if followed.is_empty() {
        return Published {
            by_table,
            ..Published::default()
        };
    }
    let buffered: u64 = finished.iter().map(|it| it.buffered).sum();
    // Dispatching to the pool costs more than applying a few entries. The stages are the same, so
    // the outcome is too.
    let inline = |count: usize, work: &(dyn Fn(usize) + Sync)| (0..count).for_each(work);
    let in_parallel: InParallel<'_> = if buffered < FEW_ENTRIES {
        &inline
    } else {
        in_parallel
    };
    for (_, entries) in &followed {
        by_table[entries.slot as usize].0 += u64::from(entries.len);
    }
    {
        // The largest first, so that no thread begins it when the others are nearly done.
        let mut by_size: Vec<&mut (usize, Entries<'s>)> = followed.iter_mut().collect();
        by_size.shared_sort_by_key(|it| std::cmp::Reverse(it.1.len));
        let links: Vec<&Link> = finished.iter().map(|it| &it.link).collect();
        for_each_mut(&mut by_size, in_parallel, &|(task, entries)| {
            tables[entries.slot as usize].follow(entries, links[*task]);
        });
    }

    // `followed` is in task order, so the shares of every stage are.
    let mut stages: Vec<Vec<Stage<'_, 's>>> = (tables.iter())
        .map(|&table| {
            let stage = |part| Stage {
                table,
                part,
                shares: Vec::new(),
                published: 0,
            };
            (0..table.parts()).map(stage).collect()
        })
        .collect();
    for (task, entries) in &mut followed {
        let (task, len) = (*task as u32, entries.len);
        match &mut stages[entries.slot as usize][..] {
            [whole] => whole
                .shares
                .push(Share::new(task, len, Payload::Whole(entries))),
            parts => {
                let entries = &*entries;
                for part in parts {
                    (part.shares).push(Share::new(task, len, Payload::Part(entries)));
                }
            }
        }
    }
    let mut chains: Vec<Chain<'_, 's>> = Vec::new();
    // By slot: the chain that the table is in.
    let mut chain_of: Vec<usize> = Vec::new();
    for (table, stages) in tables.iter().zip(stages) {
        chain_of.push(chains.len());
        let parts = stages.len() as u64;
        for stage in stages {
            let len =
                (stage.shares.iter().map(|it| u64::from(it.len)).sum::<u64>()).div_ceil(parts);
            match table.holds_handles_of() {
                Some(held) => {
                    let chain = &mut chains[chain_of[held as usize]];
                    chain.stages.push(stage);
                    chain.len += len;
                    *chain_of.last_mut().unwrap() = chain_of[held as usize];
                }
                None => chains.push(Chain {
                    stages: vec![stage],
                    len,
                    applied: Applied::new(atoms),
                }),
            }
        }
    }
    chains.retain(|chain| chain.len != 0);
    chains.shared_sort_by_key(|chain| std::cmp::Reverse(chain.len));
    let tasks = finished.len();
    for_each_mut(&mut chains, in_parallel, &|chain| {
        // By task: the published handles of the entries of the previous stage, indexed by their
        // positions among the task's entries.
        let has_handles = chain.stages.len() > 1;
        let mut handles: Vec<Vec<Handle>> = vec![Vec::new(); if has_handles { tasks } else { 0 }];
        for stage in &mut chain.stages {
            let (shares, applied) = (&mut stage.shares, &mut chain.applied);
            let before = applied.published;
            stage.table.apply(stage.part, shares, &mut handles, applied);
            stage.published = applied.published - before;
        }
    });

    let (mut published, mut digest) = (0, 0u64);
    for chain in chains {
        published += chain.applied.published;
        digest = digest.wrapping_add(chain.applied.digest);
        for stage in chain.stages {
            by_table[stage.table.slot() as usize].1 += stage.published;
        }
    }
    Published {
        buffered,
        published,
        lost: buffered - published,
        digest,
        by_table,
    }
}

#[cfg(test)]
#[path = "task_tests.rs"]
mod tests;
