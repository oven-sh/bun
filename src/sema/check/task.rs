//! Tasks.
//!
//! A task checks some files on one thread, with one `Checker`. It reads the shared tables and what it owns, and it writes
//! to what it owns. `super::commit` describes how its results reach the shared tables while other tasks run.
//!
//! A `Task` owns its stores: the records it creates and doesn't publish (`crate::types::OwnStore`, ids with `LOCAL`),
//! the task-local parts of the `Buffered` tables (the buffer), the entries of the `FileLocal` tables, and its
//! diagnostics. There is no thread-local state.

use super::commit::View;
use super::sink::Reported;
use super::{Program, Query};
use crate::local::{Buffer, FileLocalTables, SlotNumber};
use crate::node::Node;
use crate::program::{FileId, Sym};
use crate::session::Arena;
use crate::table::Publish;
use crate::types::{OwnStore, Sharing, TypeStore};
use crate::util::SharedSort;
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
    /// The round, and a number that no other task of the round has. `None` until `begin`.
    place: Option<(u32, u32)>,
    /// The file that the task is visiting.
    pub file: Option<FileId>,
    /// The files that the task has visited and that no commit has followed: they are not checked for good.
    pub(super) files_in_doubt: Vec<FileId>,
    /// `Some(q)`: the diagnostic belongs to the entry that `q` stores. `None`: it belongs to the task.
    pub(super) diagnostics: Vec<(Option<Query>, Reported)>,
    /// Whether a query of this task has re-entered itself.
    pub(super) closed_a_cycle: bool,
    /// See `OrderDependent`.
    pub(super) order_dependent_variances: Vec<OrderDependent<'s>>,
    /// The functions and source files that `markNodeAssignments` has walked in this task (`Program::assignments_marked`),
    /// and whether the task was visiting the file. See `Program::is_invalid`. Added to under `&Checker`.
    pub(super) assignments_walked: RefCell<Vec<(FileId, Node, bool)>>,
    /// See `hold_back`.
    held_back: Cell<u64>,
    /// `Some`: the task commits while it runs, and sees the commits of the others. See `super::commit`.
    view: Option<View<'s>>,
    /// See `lose`. It is set under `&Checker`.
    is_lost: Cell<Option<&'static str>>,
    /// The task is never lost: it runs alone, in the last round.
    is_believed: bool,
    /// See `discard_until_recheck`.
    can_recheck_early: Cell<bool>,
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
    /// The types, signatures, mappers and component lists that the task has created.
    pub(crate) own: OwnStore<'s>,
    /// Interior-mutable because every access to a table takes `&Task`: some are made under `&Checker`. See `Task::buffer`.
    buffer: UnsafeCell<Buffer<'s>>,
    file_local: UnsafeCell<FileLocalTables>,
}

impl<'s> Task<'s> {
    /// Returns a task that shares nothing. It reads the shared tables, and whatever it writes is dropped with it.
    /// `arena`: of the calling thread, which runs the task. `types`: the published records.
    pub(super) fn new_in(arena: &'s Arena, types: &TypeStore<'s>) -> Task<'s> {
        Task {
            place: None,
            file: None,
            files_in_doubt: Vec::new(),
            diagnostics: Vec::new(),
            closed_a_cycle: false,
            order_dependent_variances: Vec::new(),
            assignments_walked: RefCell::default(),
            held_back: Cell::new(0),
            view: None,
            is_lost: Cell::new(None),
            is_believed: false,
            can_recheck_early: Cell::new(false),
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
            own: OwnStore::new_in(arena, types),
            buffer: UnsafeCell::new(Buffer::new()),
            file_local: UnsafeCell::new(FileLocalTables::new()),
        }
    }

    /// Starts the task. `round` counts from 0, and no other task of the round has `index`. Drops everything the task
    /// owned before, so no id with `LOCAL` and no reference from a kept table may be live.
    pub fn begin(&mut self, round: u32, index: u32) {
        debug_assert!(
            self.own.is_empty(),
            "created before `begin`: the id would dangle"
        );
        self.drop_everything();
        self.place = Some((round, index));
    }

    /// True once `begin` has been called.
    #[inline]
    pub fn is_planned(&self) -> bool {
        self.place.is_some()
    }

    /// Returns a number that no other task has.
    pub(super) fn number(&self) -> u64 {
        (self.place).map_or(u64::MAX, |(round, index)| {
            u64::from(round) << 32 | u64::from(index)
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

    /// Discards the task because of a cycle or an invalid commit. Another task can recheck its files while the others
    /// still run: after a cycle, once a commit resolves that cycle. After an invalid commit, right away.
    pub(super) fn discard_until_recheck(&self, why: &'static str) {
        self.can_recheck_early
            .set(!self.is_lost() || self.can_recheck_early.get());
        self.lose(why);
    }

    pub(super) fn can_recheck_early(&self) -> bool {
        self.can_recheck_early.get()
    }

    #[inline]
    pub(super) fn is_lost(&self) -> bool {
        self.is_lost.get().is_some()
    }

    /// Before the task visits a file. `is_first`: every file before that one in program order is checked for good, or the
    /// task has checked it itself. `is_first_in_component`: the same, counting only the earlier files in that file's
    /// import cycle.
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
            self.discard_until_recheck("a ring that an earlier file may enter");
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

    /// True if the task has noted a walk that can make its next commit invalid, or is already discarded. What it has
    /// computed since then may depend on that.
    pub(super) fn may_be_thrown_away(&self) -> bool {
        self.assignments_walked.borrow().iter().any(|it| it.2) || self.is_lost()
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
        }
    }

    fn drop_everything(&mut self) {
        (self.place, self.file) = (None, None);
        self.files_in_doubt.clear();
        self.diagnostics.clear();
        self.closed_a_cycle = false;
        self.order_dependent_variances.clear();
        self.assignments_walked.get_mut().clear();
        (self.view, self.is_believed) = (None, false);
        self.is_lost.set(None);
        self.can_recheck_early.set(false);
        self.is_first_in_order.set(false);
        self.is_first_in_component.set(false);
        self.cycle_members.get_mut().clear();
        self.has_closed_a_ring.set(None);
        self.logged_at_rest.set([0; 2]);
        self.committed.set([0; 2]);
        self.waits.set([Duration::ZERO; 3]);
        (self.at_once_unless_stopped, self.at_once) = (0, Cell::new(0));
        self.logged_before_the_stop.set(usize::MAX);
        // A task that hasn't begun publishes nothing.
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

/// The `Buffered` tables keyed by a type, a signature or a mapper, except for `relations` and for the small ones that say something
/// about a declared type parameter or flag a type. An entry of one of these is evaluated inside an evaluation that `relations` or a
/// table keyed by a node or a symbol records, so a task that finds those entries does not ask for these.
const TABLES_OF_RECORDS: [&str; 29] = [
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
/// keyed by a record and hold results.
pub(super) fn tables_written_at_once() -> u128 {
    let more = ["relations", "type_param_constraints", "type_param_defaults"];
    let mut set = 0;
    for (slot, name) in table_names().into_iter().enumerate() {
        if TABLES_OF_RECORDS.contains(&name) || more.contains(&name) {
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
    (program.members).hold_handles_of(&program.shapes, super::shape::CachedMembers::shape_mut);
}

#[cfg(test)]
#[path = "task_tests.rs"]
mod tests;
