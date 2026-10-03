//! Tasks, steps and barriers (bulk-synchronous parallel): fan/r8/DESIGN.md.
//!
//! Checking runs in STEPS. During a step the PUBLISHED state is read-only. A TASK reads the published state and what it owns, nothing
//! else, and writes only to what it owns. So its result is a function of the program and of the published state at the start of its step.
//!
//! A `Task` OWNS ITS STORES: the records it creates (`crate::types::OwnStore`, ids with `LOCAL`), its halves of the `Buffered` tables (the
//! buffer), the entries of the `FileLocal` tables, its diagnostics. There is no thread-local.
//!
//! At the end of a task, on its own thread, `Task::finish` takes out what is to be published, compactly, and frees the rest. AT THE
//! BARRIER after a step the link step gives every own id that survives a published id (`Program::link`), and then `publish` applies the
//! tasks' entries in task order, every key and value rewritten through the link (`follow`). The first entry for a key stays.

use super::sink::Reported;
use super::{Program, Query};
use crate::atom::Interner;
use crate::local::{Buffer, FileLocalTables};
use crate::program::FileId;
use crate::table::{Applied, Entries, Finishing, Handle, Payload, Publish, Share};
use crate::types::{Link, Marks, OwnRecords, OwnStore};
use crate::util::{InParallel, for_each_mut};
use std::cell::UnsafeCell;

/// Permission to store a finished result. `Checker::leave` and the scopes in check/mod.rs make one, and nothing else does.
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
pub struct Task {
    /// The step, and the place of the task in it. `None`: the task is outside the plan.
    place: Option<(u32, u32)>,
    /// See `Task::begin`.
    is_read_later: bool,
    /// The file that the task is going through.
    pub file: Option<FileId>,
    /// Not 0: the task is a checker of `checkerPool`, which has this many. Its place in the step is its index.
    pub(super) checker_count: u32,
    /// `Some(q)`: the diagnostic belongs to the entry that `q` stores. `None`: it belongs to the task.
    pub(super) diagnostics: Vec<(Option<Query>, Reported)>,
    /// Whether a query of this task has come back to itself.
    pub(super) closed_a_cycle: bool,
    /// How many queries about a source file of another component the task has evaluated, by `FOREIGN_EVALUATION_KINDS`.
    pub(super) foreign_evaluations: [u32; 14],
    /// The types, signatures, mappers and component lists that the task has created.
    pub(crate) own: OwnStore,
    /// Interior-mutable because every access to a table takes `&Task`: some are made under `&Checker`. See `Task::buffer`.
    buffer: UnsafeCell<Buffer>,
    file_local: UnsafeCell<FileLocalTables>,
}

impl Task {
    /// A task outside the plan. It reads the published state, and what it writes is dropped with it.
    pub(super) fn new() -> Task {
        Task {
            place: None,
            is_read_later: true,
            file: None,
            checker_count: 0,
            diagnostics: Vec::new(),
            closed_a_cycle: false,
            foreign_evaluations: [0; 14],
            own: OwnStore::default(),
            buffer: UnsafeCell::default(),
            file_local: UnsafeCell::default(),
        }
    }

    /// Puts the task into the plan. `step` counts from 0. `index`: the place of the task in its step, in task order. Whatever the task
    /// owned before is dropped, so no id with `LOCAL` and no reference from a kept table may be around.
    /// `is_read_later`: whether anything will read what the task publishes. If not, `finish` hands over nothing but the diagnostics.
    pub fn begin(&mut self, step: u32, index: u32, is_read_later: bool) {
        debug_assert!(
            self.own.is_empty(),
            "created before `begin`: the id would dangle"
        );
        self.drop_everything();
        (self.place, self.is_read_later) = (Some((step, index)), is_read_later);
    }

    /// `begin` has been called: what the task buffers goes to a barrier.
    #[inline]
    pub fn is_planned(&self) -> bool {
        self.place.is_some()
    }

    /// The place of the task in its step.
    pub(super) fn index(&self) -> Option<u32> {
        self.place.map(|(_, index)| index)
    }

    /// From now on the task goes through `file`: the entries under its nodes are dense. The entries of the `FileLocal` tables are dropped,
    /// those of the `Buffered` tables stay. A task can go through any number of files. `is_imported`: whether another file can refer to
    /// `file`. If none can, whatever mentions `file` is BOUND and is never published.
    pub fn begin_file(&mut self, file: FileId, is_imported: bool) {
        self.file = Some(file);
        if !is_imported {
            self.own.add_unimported_file(file);
        }
        self.buffer.get_mut().begin_file(file.0, is_imported);
        self.file_local.get_mut().begin_file(file.0);
    }

    fn drop_everything(&mut self) {
        (self.place, self.is_read_later, self.file) = (None, true, None);
        self.checker_count = 0;
        self.diagnostics.clear();
        (self.closed_a_cycle, self.foreign_evaluations) = (false, [0; 14]);
        self.own = OwnStore::default();
        self.buffer.get_mut().clear();
        self.file_local.get_mut().clear();
    }

    /// The task's halves of the `Buffered` tables.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn buffer(&self) -> &mut Buffer {
        // SAFETY: the task is not `Sync`, and no two of these references are in use at a time: `crate::table` uses the reference for one
        // call into `crate::local`, which calls nothing outside itself. What a kept table hands out points into a `Chunked`, whose
        // elements stay where they are until `finish`, `begin` or the drop.
        unsafe { &mut *self.buffer.get() }
    }

    /// The entries of the `FileLocal` tables.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn file_local(&self) -> &mut FileLocalTables {
        // SAFETY: as in `buffer`. What `FileLocalTables::kept` returns points into an allocation of its own, which stays where it is
        // until the task ends or begins another file.
        unsafe { &mut *self.file_local.get() }
    }

    /// The end of a task in the plan, ON ITS OWN THREAD. What is returned has everything that goes to the barrier: the entries whose key and
    /// value are not bound, by table, and the own records that they mention. Everything else is freed here.
    /// `diagnostics`: from `Checker::take_diagnostics`.
    pub(super) fn finish(
        &mut self,
        program: &Program,
        diagnostics: Vec<(Option<Query>, Reported)>,
    ) -> Finished {
        self.finish_tables(&tables_of(program), diagnostics)
    }

    /// `tables`: by slot.
    fn finish_tables(
        &mut self,
        tables: &[&dyn Publish],
        diagnostics: Vec<(Option<Query>, Reported)>,
    ) -> Finished {
        let (step, index) = self
            .place
            .expect("a task outside the plan goes to no barrier");
        let mut marks = Marks::new(&self.own);
        let buffer = self.buffer.get_mut();
        let mut finishing = Finishing::new(&self.own, &mut marks);
        let mut handed_over = Vec::new();
        // What nothing reads later is not even looked at. It is dropped below.
        if self.is_read_later {
            for table in tables {
                handed_over.push(table.finish(buffer.half_mut(table.slot()), &mut finishing));
            }
        }
        let buffered = (handed_over.iter().flatten())
            .map(|it| u64::from(it.len))
            .sum();

        let own = self.own.finish(marks);
        let (closed_a_cycle, foreign_evaluations) = (self.closed_a_cycle, self.foreign_evaluations);
        self.drop_everything();
        Finished {
            step,
            index,
            diagnostics,
            closed_a_cycle,
            foreign_evaluations,
            own,
            link: Link::default(),
            tables: handed_over,
            buffered,
        }
    }
}

/// What a task hands to the barrier.
pub struct Finished {
    pub step: u32,
    pub index: u32,
    /// `Some(q)`: the diagnostic belongs to the query `q`. `None`: it belongs to the task.
    pub(super) diagnostics: Vec<(Option<Query>, Reported)>,
    pub closed_a_cycle: bool,
    pub foreign_evaluations: [u32; 14],
    /// The own records that the entries mention, in creation order.
    pub own: OwnRecords,
    /// `Program::link` fills it in, `publish` follows it.
    pub link: Link,
    /// By slot.
    tables: Vec<Option<Entries>>,
    /// How many entries there are in `tables`.
    buffered: u64,
}

/// What a barrier did, for `--timing`. Each is a function of the program. `buffered == published + lost`.
#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct Published {
    /// The entries that the tasks have handed over.
    pub buffered: u64,
    pub published: u64,
    /// To a lower task of the step, or to the published state.
    pub lost: u64,
    /// See `Applied::digest`. 0 unless it is asked for.
    pub digest: u64,
    /// `(buffered, published)` of each table, in the order of `table_names`.
    pub by_table: Vec<(u64, u64)>,
}

/// The names of the `Buffered` fields of `Program`, by slot.
pub fn table_names() -> Vec<&'static str> {
    macro_rules! each {
        ($($field:ident)*) => { vec![$(stringify!($field)),*] };
    }
    super::buffered_fields!(each)
}

/// The `Buffered` tables of `program`. The slot of a table is its index here: `number_tables`.
fn tables_of(program: &Program) -> Vec<&dyn Publish> {
    macro_rules! each {
        ($($field:ident)*) => { vec![$(&program.$field as &dyn Publish),*] };
    }
    super::buffered_fields!(each)
}

/// The last thing that `Program::new` does. A table finds its half in a task by its slot, which is its place in `buffered_fields!` or in
/// `file_local_fields!`.
pub(super) fn number_tables(program: &mut Program) {
    macro_rules! each {
        ($($field:ident)*) => {{
            let mut slot = 0;
            $(
                program.$field.set_slot(slot);
                slot += 1;
            )*
            let _ = slot;
        }};
    }
    super::buffered_fields!(each);
    super::file_local_fields!(each);
    (program.members).hold_handles_of(&mut program.shapes, super::shape::KeptMembers::shape_mut);
}

/// The entries of all tasks for one table, or for one part of it.
struct Stage<'a> {
    table: &'a dyn Publish,
    part: usize,
    /// In task order.
    shares: Vec<Share<'a>>,
    /// Afterwards: how many of the entries were stored.
    published: u64,
}

/// What one thread applies: a table or a part of one, then the tables whose values hold its handles.
struct Chain<'a> {
    stages: Vec<Stage<'a>>,
    len: u64,
    applied: Applied<'a>,
}

/// AT THE BARRIER, after the link step. `finished`: the tasks of ONE step, in task order. No task is running.
///
/// 1. FOLLOW, parallel over tasks and tables: every key and value is rewritten through the link of its task.
/// 2. APPLY, parallel over tables and parts of tables: ONE thread applies all tasks' entries of one table or part, in task order, and the
///    first entry for a key stays. Two threads never touch one key, so the outcome does not depend on timing.
pub fn publish(
    program: &Program,
    finished: &mut [Finished],
    in_parallel: InParallel<'_>,
    with_digest: bool,
) -> Published {
    let atoms = with_digest.then_some(&program.files.atoms);
    publish_tables(&tables_of(program), finished, in_parallel, atoms)
}

/// A barrier with fewer entries than this does not use the pool.
const FEW_ENTRIES: u64 = 4096;

/// `tables`: by slot. `atoms`: `Some` if the digest is asked for, which takes an atom as its text.
fn publish_tables(
    tables: &[&dyn Publish],
    finished: &mut [Finished],
    in_parallel: InParallel<'_>,
    atoms: Option<&Interner>,
) -> Published {
    let mut followed: Vec<(usize, Entries)> = Vec::new();
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
    // Handing work to the pool costs more than a few entries do. The stages are the same, so the outcome is.
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
        let mut by_size: Vec<&mut (usize, Entries)> = followed.iter_mut().collect();
        by_size.sort_by_key(|it| std::cmp::Reverse(it.1.len));
        let links: Vec<&Link> = finished.iter().map(|it| &it.link).collect();
        for_each_mut(&mut by_size, in_parallel, &|(task, entries)| {
            tables[entries.slot as usize].follow(entries, links[*task]);
        });
    }

    // `followed` is in task order, so the shares of every stage are.
    let mut stages: Vec<Vec<Stage<'_>>> = (tables.iter())
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
    let mut chains: Vec<Chain<'_>> = Vec::new();
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
        // By task: the published handles of the entries of the stage before, by their places among the task's entries.
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
