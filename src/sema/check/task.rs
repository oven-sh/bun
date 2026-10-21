//! Tasks.
//!
//! A task checks some files on one thread, with one `Checker`. It reads the shared tables and its own stores, and
//! writes only to its own stores. `super::commit` describes how its results reach the shared tables while other tasks
//! run.
//!
//! A `Task` owns its stores: the records it creates and doesn't publish (`crate::types::OwnStore`, ids with `LOCAL`),
//! the task-local parts of the `Buffered` tables (the buffer), the entries of the `FileLocal` tables, and its
//! diagnostics. There is no thread-local state.

use super::commit::View;
use super::sink::Reported;
use super::{Program, Query};
use crate::local::{Buffer, FileLocalTables, SlotNumber};
use crate::program::{FileId, Sym};
use crate::session::Arena;
use crate::table::Publish;
use crate::types::{OwnStore, TypeStore};
use crate::util::SharedSort;
use std::cell::{Cell, RefCell, UnsafeCell};

/// Permission to store a finished result. `Checker::leave` and the scopes in check/mod.rs create one that knows when the
/// computation began.
///
/// Records `Task::held_back` at the start of the computation. See `Task::has_held_back_since`.
#[derive(Copy, Clone)]
pub struct Stored(u64);

impl Stored {
    /// For a result whose computation has no known start. `Task::held_back` never reaches `u64::MAX`, so the result
    /// always counts as deferred.
    #[inline]
    pub(super) fn new() -> Stored {
        Stored(u64::MAX)
    }

    /// `held_back`: `Task::held_back` when the computation began.
    #[inline]
    pub(super) fn since(held_back: u64) -> Stored {
        Stored(held_back)
    }

    /// The same permission, but the result waits for the next commit, so a later store under the same key can still
    /// replace it.
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
    /// The round, and an index that's unique within the round. `None` until `begin`.
    round_and_index: Option<(u32, u32)>,
    /// The file the task is visiting.
    pub file: Option<FileId>,
    /// Files the task has visited with no end-of-file commit yet, so their results aren't final.
    pub(super) uncommitted_files: Vec<FileId>,
    /// `Some(q)`: the diagnostic belongs to the entry that `q` stores. `None`: it belongs to the task.
    pub(super) diagnostics: Vec<(Option<Query>, Reported)>,
    /// True if a query of this task has re-entered itself.
    pub(super) closed_a_cycle: bool,
    /// See `OrderDependent`.
    pub(super) order_dependent_variances: Vec<OrderDependent<'s>>,
    /// See `hold_back`.
    held_back: Cell<u64>,
    /// `Some`: the task commits while it runs and sees other tasks' commits. See `super::commit`.
    view: Option<View<'s>>,
    /// See `discard`. Set under `&Checker`.
    was_discarded: Cell<bool>,
    /// The task is never discarded. It's the only task of the last round.
    is_trusted: bool,
    /// See `discard_until_recheck`.
    can_recheck_early: Cell<bool>,
    /// See `close_cycle`.
    is_first_in_order: Cell<bool>,
    is_first_in_component: Cell<bool>,
    /// See `take_cycle_members`.
    cycle_members: RefCell<Vec<u64>>,
    /// `Buffer::log_lengths` at the first cycle the task has resolved since it was last idle.
    cycle_since_idle: Cell<Option<[usize; 2]>>,
    /// See `take_logged_at_cycles`.
    logged_at_cycles: RefCell<Vec<[[usize; 2]; 2]>>,
    /// `Buffer::log_lengths` when the task was last idle.
    logged_when_idle: Cell<[usize; 2]>,
    /// The tables the task writes to immediately, as a bit set by slot. See `may_write_immediately`. 0 means none, or
    /// none until the next commit (`stop_writing_immediately`).
    immediate_tables: Cell<u128>,
    /// A commit resets `immediate_tables` to this.
    immediate_tables_after_commit: u128,
    /// Length of the prefix of `diagnostics` that was logged before `stop_writing_immediately`. `usize::MAX` if it
    /// hasn't been called since the last commit.
    diagnostics_logged_before_stop: Cell<usize>,
    /// The types, signatures, mappers and component lists the task has created.
    pub(crate) own: OwnStore<'s>,
    /// Interior-mutable because every table access takes `&Task`, and some happen under `&Checker`. See `Task::buffer`.
    buffer: UnsafeCell<Buffer<'s>>,
    file_local: UnsafeCell<FileLocalTables>,
}

impl<'s> Task<'s> {
    /// Returns a task that shares nothing. It reads the shared tables, and everything it writes is dropped with it.
    /// `arena` belongs to the calling thread, which runs the task. `types` holds the published records.
    pub(super) fn new_in(arena: &'s Arena, types: &TypeStore<'s>) -> Task<'s> {
        Task {
            round_and_index: None,
            file: None,
            uncommitted_files: Vec::new(),
            diagnostics: Vec::new(),
            closed_a_cycle: false,
            order_dependent_variances: Vec::new(),
            held_back: Cell::new(0),
            view: None,
            was_discarded: Cell::new(false),
            is_trusted: false,
            can_recheck_early: Cell::new(false),
            is_first_in_order: Cell::new(false),
            is_first_in_component: Cell::new(false),
            cycle_members: RefCell::default(),
            cycle_since_idle: Cell::new(None),
            logged_at_cycles: RefCell::default(),
            logged_when_idle: Cell::new([0; 2]),
            immediate_tables: Cell::new(0),
            immediate_tables_after_commit: 0,
            diagnostics_logged_before_stop: Cell::new(usize::MAX),
            own: OwnStore::new_in(arena, types),
            buffer: UnsafeCell::new(Buffer::new()),
            file_local: UnsafeCell::new(FileLocalTables::new()),
        }
    }

    /// Starts the task. `round` counts from 0, and `index` is unique within the round. Drops everything the task owned
    /// before, so no id with `LOCAL` and no reference from a table that outlives the task may be live.
    pub fn begin(&mut self, round: u32, index: u32) {
        debug_assert!(
            self.own.is_empty(),
            "a record was created before `begin`, so its id would dangle"
        );
        self.drop_everything();
        self.round_and_index = Some((round, index));
    }

    /// True once `begin` has been called.
    #[inline]
    pub fn is_planned(&self) -> bool {
        self.round_and_index.is_some()
    }

    /// Returns a number that's unique to this task.
    pub(super) fn number(&self) -> u64 {
        (self.round_and_index).map_or(u64::MAX, |(round, index)| {
            u64::from(round) << 32 | u64::from(index)
        })
    }

    /// Call after `begin`. `is_trusted`: see the field. `immediate_tables`: the tables the task writes to immediately,
    /// as a bit set by slot.
    pub(super) fn see_commits(&mut self, view: View<'s>, is_trusted: bool, immediate_tables: u128) {
        self.buffer.get_mut().begin_log();
        (self.view, self.is_trusted) = (Some(view), is_trusted);
        self.immediate_tables_after_commit = immediate_tables;
        self.resume_writing_immediately();
    }

    /// True if an entry of the table with `slot`, stored with `stored`, is published immediately instead of at the next
    /// commit. The caller has checked that neither its key nor its value is bound.
    ///
    /// A task that hits an entry doesn't evaluate it, so it must also be able to hit everything that was stored during
    /// that evaluation. Entries keyed by syntax wait for the commit. So an entry is published immediately only if
    /// nothing was deferred since its evaluation began. Then everything that evaluation stored was also published
    /// immediately, before the entry.
    #[inline]
    pub(crate) fn may_write_immediately(&self, slot: u32, stored: Stored) -> bool {
        self.immediate_tables.get() >> slot & 1 != 0
            && !self.has_held_back_since(stored)
            && !self.overlaps_a_cycle_commit()
    }

    /// True if the task writes to any table immediately.
    #[inline]
    pub(crate) fn writes_immediately(&self) -> bool {
        self.immediate_tables.get() != 0 && !self.overlaps_a_cycle_commit()
    }

    /// Stops immediate writes until the task's next commit. An immediate write can't be rolled back, and from here on
    /// the task's results may be discarded with it, or may depend on an entry that other tasks can't see yet and would
    /// compute differently. It's called when the task is discarded, when it notes something that can make its commit
    /// invalid, and when it stores the result of a member of a resolution cycle.
    pub(super) fn stop_writing_immediately(&self) {
        if self.immediate_tables.replace(0) != 0 {
            self.diagnostics_logged_before_stop
                .set(self.diagnostics.len());
        }
    }

    /// Call at the start and after a commit. By then the task's notes are known to be valid and its deferred entries
    /// are published.
    pub(super) fn resume_writing_immediately(&self) {
        if !self.was_discarded() {
            self.immediate_tables
                .set(self.immediate_tables_after_commit);
            let logged = match self.immediate_tables_after_commit {
                0 => 0,
                _ => usize::MAX,
            };
            self.diagnostics_logged_before_stop.set(logged);
        }
    }

    /// Length of the prefix of `diagnostics` that was logged while the task wrote immediately.
    pub(super) fn logged_while_writing_immediately(&self) -> usize {
        self.diagnostics_logged_before_stop.get()
    }

    #[inline]
    pub(crate) fn view(&self) -> Option<&View<'s>> {
        self.view.as_ref()
    }

    /// True once `see_commits` has been called.
    #[inline]
    pub(crate) fn commits(&self) -> bool {
        self.view.is_some()
    }

    /// True if a commit of this task will publish what it stores now.
    #[inline]
    pub(crate) fn shares_what_it_stores(&self) -> bool {
        self.commits() && !self.was_discarded()
    }

    /// Discards everything the task has done since its last commit and everything it does from now on.
    pub(super) fn discard(&self) {
        if self.commits() && !self.is_trusted {
            self.was_discarded.set(true);
        }
        self.stop_writing_immediately();
    }

    /// Discards the task because of a cycle or an invalid commit. Another task can recheck its files while the others
    /// still run: after a cycle, once a commit resolves that cycle. After an invalid commit, right away.
    pub(super) fn discard_until_recheck(&self) {
        self.can_recheck_early
            .set(!self.was_discarded() || self.can_recheck_early.get());
        self.discard();
    }

    pub(super) fn can_recheck_early(&self) -> bool {
        self.can_recheck_early.get()
    }

    #[inline]
    pub(super) fn was_discarded(&self) -> bool {
        self.was_discarded.get()
    }

    /// Call before the task visits a file. `is_first`: every earlier file in program order is final, or this task has
    /// checked it. `is_first_in_component`: the same, counting only the earlier files in that file's import cycle.
    pub(super) fn set_first_in_order(&self, is_first: bool, is_first_in_component: bool) {
        self.is_first_in_order.set(is_first);
        (self.is_first_in_component).set(is_first_in_component);
    }

    /// The task has re-entered a query that's in progress, and the results of that cycle's members depend on where the
    /// cycle was entered. tsc enters it from the first file in program order that reaches it. That's this task if every
    /// earlier file is final: none of them reached the cycle, or the task would have hit the members' results. Any
    /// other task is discarded, and its files are rechecked once the earlier files are final.
    ///
    /// `is_reachable_only_by_importers`: returns true if only files that import the current file can reach the cycle.
    /// Then unrelated earlier files don't matter.
    ///
    /// `members`: hashes of the queries in the cycle.
    pub(super) fn close_cycle(
        &self,
        is_reachable_only_by_importers: impl FnOnce() -> bool,
        members: impl Iterator<Item = u64>,
    ) {
        if self.was_discarded() {
            return;
        }
        self.cycle_members.borrow_mut().extend(members);
        if self.is_first_in_order.get()
            || self.is_trusted
            || self.is_first_in_component.get() && is_reachable_only_by_importers()
        {
            if self.cycle_since_idle.get().is_none() {
                let logged = self.buffer().log_lengths();
                self.cycle_since_idle.set(Some(logged));
            }
            self.stop_writing_immediately();
        } else {
            self.discard_until_recheck();
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

    /// True if the task has resolved a cycle since its last commit.
    pub(super) fn has_resolved_a_cycle(&self) -> bool {
        self.cycle_since_idle.get().is_some() || !self.logged_at_cycles.borrow().is_empty()
    }

    /// Call for a commit, before `Buffer::take_log`. Returns the parts of the log that the task wrote between resolving
    /// a cycle and its next idle moment, as `Buffer::log_lengths` at both ends. Empty if it hasn't resolved a cycle
    /// since its last commit.
    ///
    /// These parts include the result of every query in a cycle, because the stack is empty at an idle moment. They
    /// don't include what the task logs in later statements. Another task that computes one of those needs the cycle's
    /// queries, so it has either hit them or stored one itself.
    pub(super) fn take_logged_at_cycles(&self) -> Vec<[[usize; 2]; 2]> {
        self.note_idle();
        self.logged_at_cycles.take()
    }

    /// True if a commit with the results of a cycle's members has begun since the task was last idle. The evaluation in
    /// progress may have missed one member and hit the next. That doesn't close a cycle, and no entry point into the
    /// cycle gives that result. So the task writes nothing immediately until it's idle again, where
    /// `Checker::discard_if_missed_cycle_member` takes a closer look.
    #[inline]
    pub(crate) fn overlaps_a_cycle_commit(&self) -> bool {
        (self.view.as_ref()).is_some_and(View::overlaps_a_cycle_commit)
    }

    /// Call when nothing is in progress in the task. Records the log lengths for `logged_since_idle` and ends the log
    /// range of a resolved cycle.
    pub(super) fn note_idle(&self) {
        let logged = self.buffer().log_lengths();
        if let Some(from) = self.cycle_since_idle.take() {
            self.logged_at_cycles.borrow_mut().push([from, logged]);
        }
        self.logged_when_idle.set(logged);
    }

    /// The keys the task has stored under since it was last idle, except for its immediate writes.
    pub(super) fn logged_since_idle(&self) -> (&[[u32; 2]], &[[u32; 3]]) {
        self.buffer().logged_since(self.logged_when_idle.get())
    }

    pub(super) fn is_trusted(&self) -> bool {
        self.is_trusted
    }

    /// Ends a task that commits, on its own thread, after its last commit.
    pub(super) fn end(&mut self, program: &Program<'s>) {
        program.types.reclaim_ids(&self.own);
        self.drop_everything();
    }

    /// Marks the computations in progress as depending on more than their key and the program. That covers every frame
    /// on the stack, so this is a counter, and each computation compares it when it ends. See `has_held_back_since`.
    #[inline]
    pub(crate) fn hold_back(&self) {
        self.held_back.set(self.held_back.get() + 1);
    }

    /// Number of `hold_back` calls so far.
    #[inline]
    pub(crate) fn held_back(&self) -> u64 {
        self.held_back.get()
    }

    /// True if `hold_back` was called since the computation behind `stored` began, or if its start is unknown.
    #[inline]
    pub(crate) fn has_held_back_since(&self, stored: Stored) -> bool {
        stored.0 != self.held_back.get()
    }

    /// Starts the visit of `file`. Entries keyed by its nodes are stored densely from now on. Drops the entries of the
    /// `FileLocal` tables and keeps those of the `Buffered` tables. A task can visit any number of files.
    /// `is_imported`: true if another file can refer to `file`. If not, anything that mentions `file` is bound and is
    /// never published.
    pub fn begin_file(&mut self, file: FileId, is_imported: bool) {
        self.file = Some(file);
        self.uncommitted_files.push(file);
        self.note_idle();
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

    /// Resets the task to what `new_in` returned but keeps its memory, which a worker's next task reuses. The pattern
    /// lists every field, so adding a field without resetting it here is a compile error.
    fn drop_everything(&mut self) {
        let Task {
            round_and_index,
            file,
            uncommitted_files,
            diagnostics,
            closed_a_cycle,
            order_dependent_variances,
            held_back,
            view,
            was_discarded,
            is_trusted,
            can_recheck_early,
            is_first_in_order,
            is_first_in_component,
            cycle_members,
            cycle_since_idle,
            logged_at_cycles,
            logged_when_idle,
            immediate_tables,
            immediate_tables_after_commit,
            diagnostics_logged_before_stop,
            own,
            buffer,
            file_local,
        } = self;
        (*round_and_index, *file, *view) = (None, None, None);
        uncommitted_files.clear();
        diagnostics.clear();
        (*closed_a_cycle, *is_trusted) = (false, false);
        order_dependent_variances.clear();
        held_back.set(0);
        was_discarded.set(false);
        can_recheck_early.set(false);
        is_first_in_order.set(false);
        is_first_in_component.set(false);
        cycle_members.get_mut().clear();
        cycle_since_idle.set(None);
        logged_at_cycles.get_mut().clear();
        logged_when_idle.set([0; 2]);
        immediate_tables.set(0);
        *immediate_tables_after_commit = 0;
        diagnostics_logged_before_stop.set(usize::MAX);
        own.clear();
        buffer.get_mut().clear();
        file_local.get_mut().clear();
    }

    /// The task-local parts of the `Buffered` tables.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn buffer(&self) -> &mut Buffer<'s> {
        // SAFETY: the task isn't `Sync`, and no two of these references are live at the same time. A method of
        // `crate::table` uses the reference for calls into `crate::local`, which calls nothing outside itself, and only
        // gets the next reference once it's done with this one. References returned by an indirect table point into a
        // `LocalVec`, whose elements don't move until `end`, `begin` or the drop.
        unsafe { &mut *self.buffer.get() }
    }

    /// The entries of the `FileLocal` tables.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn file_local(&self) -> &mut FileLocalTables {
        // SAFETY: same as in `buffer`.
        unsafe { &mut *self.file_local.get() }
    }
}

/// Variances that a task computed during a cycle (`variances_worker` was re-entered for a symbol in progress), so their
/// value depends on the entry point into the cycle. The masks record how the task used them, with one bit per type
/// parameter. The last bit covers every parameter from the 32nd on.
pub struct OrderDependent<'s> {
    pub(super) sym: Sym,
    pub(super) variances: &'s [u8],
    /// Two different type arguments were compared under this variance and are related.
    pub(super) compared: u32,
    /// Two type arguments were compared under this variance and aren't related, so comparing the type argument lists
    /// fails whatever the other variances are. `relateVariances` then tests three more properties of the list.
    pub(super) failed: u32,
    /// The target type argument was `void` in a comparison that failed (`hasCovariantVoidArgument`).
    pub(super) void_targets: u32,
    /// Inference read this variance. It only tests for contravariance.
    pub(super) inferred: u32,
}

impl OrderDependent<'_> {
    /// True if a result of the task can differ under the variances `serial`.
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

/// The `Buffered` tables keyed by a type, a signature or a mapper, except for `relations` and the small ones that
/// describe a declared type parameter or flag a type. An entry of these tables is evaluated inside an evaluation that
/// `relations` or a table keyed by a node or a symbol records, so a task that hits those entries never looks these up.
///
/// `constraints` isn't in the list. A task shares the base constraints of its own file's types (`store_constraint`) but
/// keeps the comparisons it made while it resolved them. An immediate write outlives a discard, so the recheck would
/// find those constraints resolved without the comparisons, and would compare in a different order than `tsc`.
const RECORD_KEYED_TABLES: [&str; 28] = [
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
    "plain_global_refs",
    "equivalent_base_types",
];

/// The tables that a committing task writes to immediately (`Task::may_write_immediately`), as a bit set by slot.
/// They're the tables that are keyed by a record and hold results.
pub(super) fn tables_written_immediately() -> u128 {
    let more = [
        "relations",
        "type_param_constraints",
        "type_param_defaults",
        "circular_type_param_defaults",
    ];
    let mut set = 0;
    for (slot, name) in table_names().into_iter().enumerate() {
        if RECORD_KEYED_TABLES.contains(&name) || more.contains(&name) {
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

const _: () = assert!(TABLE_NAMES.len() <= crate::local::MAX_TABLES);

pub fn table_names() -> Vec<&'static str> {
    TABLE_NAMES.to_vec()
}

/// Returns the slot of `Program`'s `Buffered` field `name`, for use in the field's type. `number_tables` assigns the
/// same slot.
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

/// The `Buffered` tables of `program`. A table's slot is its index here. See `number_tables`.
pub(super) fn tables_of<'a, 's>(program: &'a Program<'s>) -> Vec<&'a dyn Publish<'s>> {
    macro_rules! each {
        ($($field:ident)*) => { vec![$(&program.$field as &dyn Publish<'s>),*] };
    }
    super::buffered_fields!(each)
}

/// Called last by `Program::new`. A table finds its task-local part in a task by its slot, which is its index in
/// `buffered_fields!` or in `file_local_fields!`.
pub(super) fn number_tables(program: &mut Program) {
    macro_rules! each {
        ($($field:ident)*) => {{
            let mut slot = 0;
            $(
                // SAFETY: every table in the list gets a different number.
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
