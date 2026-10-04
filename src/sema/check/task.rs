//! Tasks, steps and barriers (bulk-synchronous parallel): fan/r8/DESIGN.md.
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

use super::sink::Reported;
use super::{Program, Query};
use crate::atom::Intern;
use crate::local::{Buffer, FileLocalTables, SlotNumber};
use crate::program::{FileId, Sym};
use crate::session::Arena;
use crate::table::{Applied, Entries, Finishing, Handle, Payload, Publish, Share};
use crate::types::{Link, Marks, OwnRecords, OwnStore};
use crate::util::{InParallel, for_each_mut};
use std::cell::UnsafeCell;

/// Permission to store a finished result. Only `Checker::leave` and the scopes in check/mod.rs
/// create one.
#[derive(Copy, Clone)]
pub struct Stored(());

impl Stored {
    #[inline]
    pub(super) fn new() -> Stored {
        Stored(())
    }
}

/// The result depends on a frame that is still in progress.
#[derive(Copy, Clone)]
pub struct Open;

/// One per `Checker`.
pub struct Task<'s> {
    /// Of the thread that runs the task: for the records that the task creates.
    arena: &'s Arena,
    /// The step, and the index of the task in it. `None`: the task is outside the plan.
    place: Option<(u32, u32)>,
    /// See `Task::begin`.
    is_read_later: bool,
    /// The `Buffered` tables of which `finish` passes nothing to the barrier: a bit set, by slot.
    withheld: u128,
    /// The file that the task is visiting.
    pub file: Option<FileId>,
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
    /// The types, signatures, mappers and component lists that the task has created.
    pub(crate) own: OwnStore<'s>,
    /// Interior-mutable because every access to a table takes `&Task`: some are made under `&Checker`. See `Task::buffer`.
    buffer: UnsafeCell<Buffer<'s>>,
    file_local: UnsafeCell<FileLocalTables>,
}

impl<'s> Task<'s> {
    /// A task outside the plan. It reads the published state, and what it writes is dropped with it.
    /// `arena`: of the calling thread, which runs the task.
    pub(super) fn new_in(arena: &'s Arena) -> Task<'s> {
        Task {
            arena,
            place: None,
            is_read_later: true,
            withheld: 0,
            file: None,
            checker_count: 0,
            diagnostics: Vec::new(),
            closed_a_cycle: false,
            foreign_evaluations: [0; 14],
            order_dependent_variances: Vec::new(),
            own: OwnStore::new_in(arena),
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

    /// From now on the task visits `file`: the entries keyed by its nodes are stored densely. The
    /// entries of the `FileLocal` tables are dropped, those of the `Buffered` tables stay. A task
    /// can visit any number of files. `is_imported`: whether another file can refer to `file`. If
    /// none can, anything that mentions `file` is bound and is never published.
    pub fn begin_file(&mut self, file: FileId, is_imported: bool) {
        self.file = Some(file);
        if !is_imported {
            self.own.add_unimported_file(file);
        }
        self.buffer.get_mut().begin_file(file.0, is_imported);
        self.file_local.get_mut().begin_file(file.0);
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
        self.withheld = 0;
        self.checker_count = 0;
        self.diagnostics.clear();
        (self.closed_a_cycle, self.foreign_evaluations) = (false, [0; 14]);
        self.order_dependent_variances.clear();
        self.own = OwnStore::new_in(self.arena);
        self.buffer.get_mut().clear();
        self.file_local.get_mut().clear();
    }

    /// The task-local parts of the `Buffered` tables.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn buffer(&self) -> &mut Buffer<'s> {
        // SAFETY: the task is not `Sync`, and no two of these references are live at the same time:
        // `crate::table` uses the reference for one call into `crate::local`, which calls nothing
        // outside itself. References returned by an indirect table point into a `LocalVec`, whose
        // elements do not move until `finish`, `begin` or the drop.
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
        self.drop_everything();
        Finished {
            step,
            index,
            diagnostics,
            closed_a_cycle,
            foreign_evaluations,
            order_dependent_variances,
            own,
            link: Link::default(),
            tables: published,
            buffered,
        }
    }
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
    /// Whether `Program::validate` can find the task invalid.
    pub fn can_be_invalid(&self) -> bool {
        let mut measured = self.order_dependent_variances.iter();
        measured.any(|it| it.compared | it.failed | it.inferred != 0)
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
            && (some(&self.variances, &|it| it & 24 != 0) != some(serial, &|it| it & 24 != 0)
                || some(&self.variances, &|it| is(it, 0)) != some(serial, &|it| is(it, 0)))
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
const TABLES_OF_RECORDS: [&str; 27] = [
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

/// The names of the `Buffered` fields of `Program`, by slot.
pub fn table_names() -> Vec<&'static str> {
    macro_rules! each {
        ($($field:ident)*) => { vec![$(stringify!($field)),*] };
    }
    super::buffered_fields!(each)
}

/// The `Buffered` tables of `program`. The slot of a table is its index here: `number_tables`.
fn tables_of<'a, 's>(program: &'a Program<'s>) -> Vec<&'a dyn Publish<'s>> {
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
        by_size.sort_by_key(|it| std::cmp::Reverse(it.1.len));
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
    chains.sort_by_key(|chain| std::cmp::Reverse(chain.len));
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
