//! Tests for the buffer, `Task::finish`, `publish`, the merge and `follow` of ids and handles, and
//! the underlying containers.

use super::*;
use crate::atom::{Atom, Atoms, Interner};
use crate::bind::SymbolId;
use crate::local::{Hashed, LOCAL, MaybeLocal, SlotNumber, spread_word};
use crate::program::Sym;
use crate::session::Session;
use crate::table::{
    Bases, Buffered, ById, ByIdIndirect, ByKey, ByNode, ByNodeIndirect, Cell as _, FileLocal,
};
use crate::types::{
    ElemFlags, List, MapperId, OriginKey, Provenance, ProvenanceKey, TypeData, TypeId, TypeKey,
    TypeStore, Types, UnionOrigin,
};
use crate::util::{GrowingPlaces, ShardedMap};
use bun_sema_standalone as _;
use std::alloc::Global;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

type Node = (FileId, u32);

fn numbered(number: u32) -> SlotNumber {
    // SAFETY: a test gives each of its tables another number.
    unsafe { SlotNumber::new(number) }
}

/// A value that holds a handle of another table, as `CachedMembers` does.
#[derive(Copy, Clone, PartialEq, Debug)]
struct Holder {
    shape: Handle,
    of: TypeId,
}
crate::types::follow_struct!(Holder { shape, of });

impl Holder {
    fn shape_mut(&mut self) -> &mut Handle {
        &mut self.shape
    }
}

/// One table of each kind, and the type store that their ids belong to.
struct Tables<'s> {
    atoms: Interner<'s>,
    types: TypeStore<'s>,
    by_node: ByNode<Node, TypeId, Buffered, &'s Session>,
    set: ByNode<Node, (), Buffered, &'s Session>,
    by_id: ById<TypeId, TypeId, Buffered, &'s Session>,
    shapes: ByIdIndirect<TypeId, Box<[TypeId]>, Buffered, &'s Session>,
    kept_by_node: ByNodeIndirect<Node, Box<[TypeId]>, Buffered, &'s Session>,
    members: ByIdIndirect<TypeId, Holder, Buffered, &'s Session>,
    by_key: ByKey<(TypeId, TypeId), TypeId, Buffered, &'s Session>,
}

const A: FileId = FileId(0);
const B: FileId = FileId(1);
const C: FileId = FileId(2);

impl<'s> Tables<'s> {
    /// Three files of 100 nodes each.
    fn new(session: &'s Session) -> Tables<'s> {
        let bases = Bases::new_in([100, 100, 100].into_iter(), &session);
        let mut tables = Tables {
            atoms: Interner::new_in(session),
            types: TypeStore::new_in(session),
            by_node: ByNode::new_in(&bases, session),
            set: ByNode::new_in(&bases, session),
            by_id: ById::new_in(session),
            shapes: ByIdIndirect::new_in(session),
            kept_by_node: ByNodeIndirect::new_in(&bases, session),
            members: ByIdIndirect::new_in(session),
            by_key: ByKey::new_in(session),
        };
        tables.by_node.set_slot(numbered(0));
        tables.set.set_slot(numbered(1));
        tables.by_id.set_slot(numbered(2));
        tables.shapes.set_slot(numbered(3));
        tables.kept_by_node.set_slot(numbered(4));
        tables.members.set_slot(numbered(5));
        tables.by_key.set_slot(numbered(6));
        (tables.members).hold_handles_of(&mut tables.shapes, Holder::shape_mut);
        tables
    }

    fn all(&self) -> [&dyn Publish<'s>; 7] {
        [
            &self.by_node,
            &self.set,
            &self.by_id,
            &self.shapes,
            &self.kept_by_node,
            &self.members,
            &self.by_key,
        ]
    }

    /// `keyof of`, which no store contains initially.
    fn keyof(&self, task: &Task<'s>, of: TypeId) -> TypeId {
        Types::new(&self.types, &task.own).intern(TypeData::Keyof(of))
    }

    /// The `this` type of a class of `file`: a type that references `file`.
    fn this_of(&self, task: &Task<'s>, file: FileId) -> TypeId {
        let class = Sym {
            file,
            id: SymbolId(7),
        };
        Types::new(&self.types, &task.own).intern(TypeData::ThisParam(class))
    }

    fn finish(&self, task: &mut Task<'s>) -> Finished<'s> {
        task.finish_tables(&self.all(), Vec::new())
    }

    fn link(&self, finished: &mut [Finished<'s>], in_parallel: InParallel<'_>) {
        let own = finished.iter_mut().map(|it| std::mem::take(&mut it.own));
        let (links, _) = (self.types).link(&self.atoms, own.collect(), in_parallel, &|_| {});
        for (finished, link) in finished.iter_mut().zip(links) {
            finished.link = link;
        }
    }

    /// Merge, then publish.
    fn barrier(&self, finished: &mut [Finished<'s>], in_parallel: InParallel<'_>) -> Published {
        self.link(finished, in_parallel);
        publish_tables(&self.all(), finished, in_parallel, Some(&self.atoms))
    }
}

fn forwards(count: usize, work: &(dyn Fn(usize) + Sync)) {
    (0..count).for_each(work);
}

fn backwards(count: usize, work: &(dyn Fn(usize) + Sync)) {
    (0..count).rev().for_each(work);
}

fn on_threads(count: usize, work: &(dyn Fn(usize) + Sync)) {
    let next = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..count.min(4) {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= count {
                        break;
                    }
                    work(i);
                }
            });
        }
    });
}

const POOLS: [fn(usize, &(dyn Fn(usize) + Sync)); 3] = [forwards, backwards, on_threads];

fn begin(session: &Session, index: u32) -> Task<'_> {
    let mut task = Task::new_in(session.arena());
    task.begin(0, index, true);
    task
}

fn begin_in(session: &Session, index: u32, file: FileId) -> Task<'_> {
    let mut task = begin(session, index);
    task.begin_file(file, true);
    task
}

fn counts(published: &Published) -> (u64, u64, u64) {
    let sum = |of: fn(&(u64, u64)) -> u64| published.by_table.iter().map(of).sum::<u64>();
    assert_eq!(
        (sum(|it| it.0), sum(|it| it.1)),
        (published.buffered, published.published)
    );
    assert_eq!(published.buffered, published.published + published.lost);
    (published.buffered, published.published, published.lost)
}

fn stored() -> Stored {
    Stored::new()
}

fn diagnostic(code: u32) -> Reported {
    Reported::bare((A, 0, 0), code)
}

// ───────────────────────────── the buffer ─────────────────────────────

#[test]
#[cfg_attr(miri, ignore)]
fn a_task_reads_the_published_state_and_its_own_buffer_and_nothing_else() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let (mut first, second) = (begin_in(&session, 0, A), begin_in(&session, 1, B));
    let own = tables.keyof(&first, TypeId::STRING);
    assert!(own.is_local());
    // A node of the task's file, a node of another file, a published id, a task-local id, a key of
    // several ids.
    tables.by_node.insert(&first, (A, 1), own, stored());
    tables
        .by_node
        .insert(&first, (C, 2), TypeId::NUMBER, stored());
    tables.by_id.insert(&first, TypeId::STRING, own, stored());
    tables.by_id.insert(&first, own, TypeId::STRING, stored());
    tables
        .by_key
        .insert(&first, (own, TypeId::ANY), own, stored());
    (tables.by_key).insert(&first, (TypeId::ANY, TypeId::ANY), own, stored());
    assert_eq!(tables.by_node.get(&first, &(A, 1)), Some(own));
    assert_eq!(tables.by_node.get(&first, &(C, 2)), Some(TypeId::NUMBER));
    assert_eq!(tables.by_id.get(&first, &TypeId::STRING), Some(own));
    assert_eq!(tables.by_id.get(&first, &own), Some(TypeId::STRING));
    assert_eq!(tables.by_key.get(&first, &(own, TypeId::ANY)), Some(own));
    assert_eq!(
        tables.by_key.get(&first, &(TypeId::ANY, TypeId::ANY)),
        Some(own)
    );
    // The neighbouring keys have no entry.
    assert_eq!(tables.by_node.get(&first, &(A, 2)), None);
    assert_eq!(tables.by_node.get(&first, &(C, 1)), None);
    assert_eq!(tables.by_id.get(&first, &TypeId::NUMBER), None);

    // During the step no other task sees any of it. In the other task the id `own` is a different
    // type, or none.
    assert_eq!(tables.by_node.get(&second, &(A, 1)), None);
    assert_eq!(tables.by_node.get(&second, &(C, 2)), None);
    assert_eq!(tables.by_id.get(&second, &TypeId::STRING), None);
    assert_eq!(tables.by_id.get(&second, &own), None);
    assert_eq!(
        tables.by_key.get(&second, &(TypeId::ANY, TypeId::ANY)),
        None
    );
    assert_eq!(tables.by_node.footprint().entries, 0);
    assert_eq!(tables.by_id.footprint().entries, 0);
    assert_eq!(tables.by_key.footprint().entries, 0);

    // After the barrier every task sees all of it, under published ids.
    let published = tables.barrier(&mut [tables.finish(&mut first)], &forwards);
    assert_eq!(counts(&published), (6, 6, 0));
    let reader = Task::new_in(session.arena());
    let keyof = tables.keyof(&reader, TypeId::STRING);
    assert!(!keyof.is_local());
    assert_eq!(tables.by_node.get(&reader, &(A, 1)), Some(keyof));
    assert_eq!(tables.by_node.get(&reader, &(C, 2)), Some(TypeId::NUMBER));
    assert_eq!(tables.by_id.get(&reader, &TypeId::STRING), Some(keyof));
    assert_eq!(tables.by_id.get(&reader, &keyof), Some(TypeId::STRING));
    assert_eq!(
        tables.by_key.get(&reader, &(keyof, TypeId::ANY)),
        Some(keyof)
    );
    assert_eq!(
        tables.by_key.get(&reader, &(TypeId::ANY, TypeId::ANY)),
        Some(keyof)
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn insert_keeps_what_is_there_and_rewrite_replaces_the_tasks_entry() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let task = begin_in(&session, 0, A);
    let own = tables.keyof(&task, TypeId::STRING);
    let (one, two) = (TypeId::STRING, TypeId::NUMBER);
    for key in [(A, 5), (B, 5)] {
        assert_eq!(tables.by_node.insert(&task, key, one, stored()), one);
        assert_eq!(tables.by_node.insert(&task, key, two, stored()), one);
        assert_eq!(tables.by_node.rewrite(&task, key, two, stored()), two);
        assert_eq!(tables.by_node.get(&task, &key), Some(two));
    }
    for key in [own, TypeId::ANY] {
        assert_eq!(tables.by_id.insert(&task, key, one, stored()), one);
        assert_eq!(tables.by_id.insert(&task, key, two, stored()), one);
        assert_eq!(tables.by_id.rewrite(&task, key, two, stored()), two);
        assert_eq!(tables.by_id.get(&task, &key), Some(two));
    }
    assert_eq!(tables.by_key.insert(&task, (own, one), one, stored()), one);
    assert_eq!(tables.by_key.insert(&task, (own, one), two, stored()), one);
    let (first, kept) = (tables.shapes).insert_ref(&task, own, Box::new([one]), stored());
    assert_eq!(**kept, [one]);
    let (second, kept) = (tables.shapes).insert_ref(&task, own, Box::new([two]), stored());
    assert_eq!((second, &**kept), (first, &[one][..]));
    // No node.
    tables.by_node.insert(&task, (A, u32::MAX), one, stored());
    assert_eq!(tables.by_node.get(&task, &(A, u32::MAX)), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_published_entry_stays_what_it_is() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut first = begin_in(&session, 0, A);
    tables
        .by_node
        .insert(&first, (A, 1), TypeId::STRING, stored());
    tables
        .by_id
        .insert(&first, TypeId::ANY, TypeId::STRING, stored());
    (tables.by_key).insert(&first, (TypeId::ANY, TypeId::ANY), TypeId::STRING, stored());
    tables.barrier(&mut [tables.finish(&mut first)], &forwards);

    // `insert` returns the value that `get` returns from then on, and buffers nothing.
    let mut later = Task::new_in(session.arena());
    later.begin(1, 0, true);
    let kept = tables
        .by_node
        .insert(&later, (A, 1), TypeId::NUMBER, stored());
    assert_eq!(kept, TypeId::STRING);
    let kept = tables
        .by_id
        .insert(&later, TypeId::ANY, TypeId::NUMBER, stored());
    assert_eq!(kept, TypeId::STRING);
    let kept = (tables.by_key).insert(&later, (TypeId::ANY, TypeId::ANY), TypeId::NUMBER, stored());
    assert_eq!(kept, TypeId::STRING);
    // The value that `rewrite` stores is shadowed by the published entry, and loses at the barrier.
    tables
        .by_node
        .rewrite(&later, (A, 1), TypeId::NUMBER, stored());
    assert_eq!(tables.by_node.get(&later, &(A, 1)), Some(TypeId::STRING));
    let published = tables.barrier(&mut [tables.finish(&mut later)], &forwards);
    assert_eq!(counts(&published), (1, 0, 1));
    assert_eq!(
        tables.by_node.get(&Task::new_in(session.arena()), &(A, 1)),
        Some(TypeId::STRING)
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn what_a_task_outside_the_plan_writes_is_dropped_with_it() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let task = Task::new_in(session.arena());
    assert!(!task.is_planned());
    tables
        .by_node
        .insert(&task, (A, 1), TypeId::STRING, stored());
    assert_eq!(tables.by_node.get(&task, &(A, 1)), Some(TypeId::STRING));
    drop(task);
    assert_eq!(
        tables.by_node.get(&Task::new_in(session.arena()), &(A, 1)),
        None
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn begin_and_finish_leave_the_task_empty() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut task = begin_in(&session, 0, A);
    assert!(task.is_planned());
    let own = tables.keyof(&task, TypeId::STRING);
    tables.by_node.insert(&task, (A, 1), own, stored());
    tables.shapes.insert(&task, own, Box::new([own]), stored());
    task.diagnostics.push((None, diagnostic(1)));
    task.closed_a_cycle = true;
    task.foreign_evaluations[3] = 2;
    let finished = tables.finish(&mut task);
    assert!(finished.closed_a_cycle);
    assert_eq!(finished.foreign_evaluations[3], 2);
    assert!(!task.is_planned() && task.file.is_none() && task.own.is_empty());
    assert!(task.diagnostics.is_empty() && !task.closed_a_cycle);
    assert_eq!(task.foreign_evaluations, [0; 14]);
    assert_eq!(tables.by_node.get(&task, &(A, 1)), None);
    // The number of the first task-local type is reused.
    task.begin(1, 0, true);
    assert_eq!(tables.keyof(&task, TypeId::NUMBER), own);
    assert_eq!(tables.shapes.get(&task, &own), None);
}

/// A task that visits the files of a cycle evaluates nodes of a later file while visiting an
/// earlier one.
#[test]
#[cfg_attr(miri, ignore)]
fn a_task_that_goes_through_several_files_has_one_entry_for_each_key() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut task = begin_in(&session, 0, A);
    let (one, two) = (TypeId::STRING, TypeId::NUMBER);
    tables.by_node.insert(&task, (A, 1), one, stored());
    tables.by_node.insert(&task, (B, 1), one, stored());
    tables.set.insert(&task, (B, 1), (), stored());
    task.begin_file(B, true);
    // Before anything of `B` is dense, and after.
    assert_eq!(tables.by_node.get(&task, &(B, 1)), Some(one));
    tables.by_node.insert(&task, (B, 2), two, stored());
    assert_eq!(tables.by_node.get(&task, &(B, 1)), Some(one));
    assert_eq!(tables.by_node.get(&task, &(B, 2)), Some(two));
    assert_eq!(tables.by_node.get(&task, &(A, 1)), Some(one));
    // The earlier entry wins.
    assert_eq!(tables.by_node.insert(&task, (B, 1), two, stored()), one);
    tables.by_node.rewrite(&task, (B, 1), two, stored());
    assert_eq!(tables.by_node.get(&task, &(B, 1)), Some(two));
    task.begin_file(C, true);
    tables.by_node.insert(&task, (C, 1), one, stored());
    for key in [(A, 1), (C, 1)] {
        assert_eq!(tables.by_node.get(&task, &key), Some(one));
    }
    for key in [(B, 1), (B, 2)] {
        assert_eq!(tables.by_node.get(&task, &key), Some(two));
    }
    // Each key once: 4 in `by_node`, 1 in `set`, and none loses.
    let published = tables.barrier(&mut [tables.finish(&mut task)], &forwards);
    assert_eq!(counts(&published), (5, 5, 0));
    assert_eq!(
        tables.by_node.get(&Task::new_in(session.arena()), &(B, 1)),
        Some(two)
    );
}

/// A chunk of files that nothing imports: no node of a file is evaluated before the task reaches
/// it, and the entries can still be looked up afterwards.
#[test]
#[cfg_attr(miri, ignore)]
fn a_task_that_goes_through_files_that_nothing_imports() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut task = begin(&session, 0);
    for file in [A, B, C] {
        task.begin_file(file, false);
        // A hashed entry, before the first entry keyed by a node of the file and after it.
        tables
            .by_id
            .insert(&task, TypeId(file.0), TypeId::ANY, stored());
        for node in 0..3 {
            assert_eq!(tables.by_node.get(&task, &(file, node)), None);
            tables
                .by_node
                .insert(&task, (file, node), TypeId(node), stored());
        }
    }
    for file in [A, B, C] {
        for node in 0..3 {
            assert_eq!(tables.by_node.get(&task, &(file, node)), Some(TypeId(node)));
            let kept = tables
                .by_node
                .insert(&task, (file, node), TypeId::ANY, stored());
            assert_eq!(kept, TypeId(node));
        }
    }
    // A file that the task visits a second time.
    task.begin_file(A, false);
    assert_eq!(tables.by_node.get(&task, &(A, 1)), Some(TypeId(1)));
    tables.by_node.insert(&task, (A, 5), TypeId::ANY, stored());
    assert_eq!(tables.by_node.get(&task, &(A, 1)), Some(TypeId(1)));
    let kept = tables.by_node.insert(&task, (A, 1), TypeId::ANY, stored());
    assert_eq!(kept, TypeId(1));
}

/// A chunk of many files, checked against a model. Every second file is imported, so its nodes are
/// also evaluated before the task reaches it.
#[test]
#[cfg_attr(miri, ignore)]
fn a_task_that_goes_through_many_files_does_what_the_model_says() {
    let session = Session::new();
    use crate::util::FxHashMap;
    const FILES: u32 = 40;
    const NODES: u32 = 30;
    let is_imported = |file: u32| file.is_multiple_of(2);
    for seed in 1..=8u64 {
        let mut state = seed;
        let mut random = |below: u32| {
            state = (state.wrapping_mul(6364136223846793005)).wrapping_add(1442695040888963407);
            (state >> 33) as u32 % below
        };
        let bases = Bases::new_in((0..FILES).map(|_| NODES as usize), &Global);
        let mut table = ByNode::<Node, TypeId, Buffered>::new_in(&bases, Global);
        table.set_slot(numbered(0));
        let mut task = begin(&session, 0);
        let mut model: FxHashMap<Node, TypeId> = FxHashMap::default();
        let mut has_come_to = [false; FILES as usize];
        // Some files are visited a second time.
        for _ in 0..FILES * 2 {
            let at_hand = random(FILES);
            task.begin_file(FileId(at_hand), is_imported(at_hand));
            has_come_to[at_hand as usize] = true;
            for _ in 0..60 {
                // Mostly the current file.
                let file = if random(3) != 0 {
                    at_hand
                } else {
                    random(FILES)
                };
                // Nothing references a file that nothing imports before the task reaches it.
                if !is_imported(file) && !has_come_to[file as usize] {
                    continue;
                }
                let (key, value) = ((FileId(file), random(NODES)), TypeId(random(20)));
                assert_eq!(table.get(&task, &key), model.get(&key).copied());
                match random(4) {
                    0 => {}
                    1 => {
                        table.rewrite(&task, key, value, stored());
                        model.insert(key, value);
                    }
                    _ => {
                        let kept = table.insert(&task, key, value, stored());
                        assert_eq!(kept, *model.entry(key).or_insert(value));
                    }
                }
                assert_eq!(table.get(&task, &key), model.get(&key).copied());
            }
        }
        for file in 0..FILES {
            for node in 0..NODES {
                let key = (FileId(file), node);
                assert_eq!(table.get(&task, &key), model.get(&key).copied());
            }
        }
        // Each key once, and an entry keyed by a node of a file that nothing imports is bound.
        model.retain(|key, _| is_imported(key.0.0));
        let mut finished = [task.finish_tables(&[&table], Vec::new())];
        let published = publish_tables(&[&table], &mut finished, &forwards, None);
        assert_eq!(
            counts(&published),
            (model.len() as u64, model.len() as u64, 0)
        );
        let reader = Task::new_in(session.arena());
        for file in 0..FILES {
            for node in 0..NODES {
                let key = (FileId(file), node);
                assert_eq!(table.get(&reader, &key), model.get(&key).copied());
            }
        }
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_reference_to_a_kept_value_stays_good_while_the_task_keeps_more() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let task = begin(&session, 0);
    let first = tables.keyof(&task, TypeId::STRING);
    let (handle, kept) = (tables.shapes).insert_ref(&task, first, Box::new([first]), stored());
    assert!(handle.is_local());
    let mut of = first;
    for _ in 0..5000 {
        of = tables.keyof(&task, of);
        tables.shapes.insert(&task, of, Box::new([of]), stored());
    }
    assert_eq!(**kept, [first]);
    assert!(std::ptr::eq(kept, tables.shapes.at(&task, handle)));
    assert_eq!(tables.shapes.handle(&task, &first), Some(handle));
}

// ───────────────────────────── the order of publishing ─────────────────────────────

#[test]
#[cfg_attr(miri, ignore)]
fn the_entry_of_the_lowest_task_stays_however_the_pool_runs() {
    let session = Session::new();
    for pool in POOLS {
        let tables = Tables::new(&session);
        let values = [TypeId::STRING, TypeId::NUMBER, TypeId::BIGINT];
        let mut finished: Vec<Finished> = (values.iter().enumerate())
            .map(|(index, &value)| {
                let mut task = begin_in(&session, index as u32, FileId(index as u32));
                // Every task has (C, 9) and the like. Only the last two have (C, 8).
                tables.by_node.insert(&task, (C, 9), value, stored());
                tables.by_id.insert(&task, TypeId::ANY, value, stored());
                (tables.by_key).insert(&task, (TypeId::ANY, TypeId::ANY), value, stored());
                tables
                    .shapes
                    .insert(&task, TypeId::ANY, Box::new([value]), stored());
                (tables.kept_by_node).insert(&task, (C, 9), Box::new([value]), stored());
                if index != 0 {
                    tables.by_node.insert(&task, (C, 8), value, stored());
                }
                tables.finish(&mut task)
            })
            .collect();
        let published = tables.barrier(&mut finished, &pool);
        // `by_node`, `set`, `by_id`, `shapes`, `kept_by_node`, `members`, `by_key`.
        let by_table = [(5, 2), (0, 0), (3, 1), (3, 1), (3, 1), (0, 0), (3, 1)];
        assert_eq!(published.by_table, by_table);
        assert_eq!(counts(&published), (17, 6, 11));
        let reader = Task::new_in(session.arena());
        assert_eq!(tables.by_node.get(&reader, &(C, 9)), Some(values[0]));
        assert_eq!(tables.by_node.get(&reader, &(C, 8)), Some(values[1]));
        assert_eq!(tables.by_id.get(&reader, &TypeId::ANY), Some(values[0]));
        assert_eq!(
            tables.by_key.get(&reader, &(TypeId::ANY, TypeId::ANY)),
            Some(values[0])
        );
        assert_eq!(
            tables.shapes.get(&reader, &TypeId::ANY),
            Some(Box::from([values[0]]))
        );
        assert_eq!(
            tables.kept_by_node.get(&reader, &(C, 9)),
            Some(Box::from([values[0]]))
        );
        // A value is pushed when its entry wins.
        assert_eq!(tables.shapes.footprint().kept, 1);
        assert_eq!(tables.kept_by_node.footprint().kept, 1);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_task_that_is_not_read_later_hands_over_nothing_but_its_diagnostics() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut task = Task::new_in(session.arena());
    task.begin(0, 0, false);
    task.begin_file(A, true);
    let own = tables.keyof(&task, TypeId::STRING);
    tables.by_node.insert(&task, (A, 1), own, stored());
    tables.by_id.insert(&task, own, own, stored());
    tables.by_key.insert(&task, (own, own), own, stored());
    let (shape, _) = tables.shapes.insert_ref(&task, own, Box::new([]), stored());
    let held = Holder { shape, of: own };
    tables.members.insert(&task, own, held, stored());
    let query = Query::Symbol(Sym {
        file: A,
        id: SymbolId(1),
    });
    let diagnostics = vec![(Some(query), diagnostic(0)), (None, diagnostic(1))];
    let mut finished = [task.finish_tables(&tables.all(), diagnostics.clone())];
    // In their original order.
    assert!(finished[0].diagnostics == diagnostics);
    let published = tables.barrier(&mut finished, &forwards);
    assert_eq!(published.digest, 0);
    assert_eq!(counts(&published), (0, 0, 0));
    assert!(
        tables
            .keyof(&Task::new_in(session.arena()), TypeId::STRING)
            .is_local()
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn the_digest_tells_the_content_of_what_was_stored_and_not_how_the_pool_ran() {
    let session = Session::new();
    let digest = |pool: InParallel<'_>, value: TypeId, with_digest: bool| {
        let tables = Tables::new(&session);
        let mut finished: Vec<Finished> = (0..3)
            .map(|index| {
                let mut task = begin_in(&session, index, A);
                let own = tables.keyof(&task, TypeId::STRING);
                tables.by_node.insert(&task, (A, index), own, stored());
                tables.set.insert(&task, (B, index), (), stored());
                tables.by_id.insert(&task, own, TypeId::ANY, stored());
                tables
                    .by_key
                    .insert(&task, (own, TypeId(index)), own, stored());
                // Of the three values for one key the first is stored.
                let kept = if index == 0 { value } else { TypeId::ANY };
                tables.shapes.insert(&task, own, Box::new([kept]), stored());
                tables.finish(&mut task)
            })
            .collect();
        tables.link(&mut finished, pool);
        let atoms = with_digest.then_some(&tables.atoms as &dyn Intern);
        publish_tables(&tables.all(), &mut finished, pool, atoms).digest
    };
    let expected = digest(&forwards, TypeId::STRING, true);
    assert_ne!(expected, 0);
    assert_eq!(digest(&backwards, TypeId::STRING, true), expected);
    assert_eq!(digest(&on_threads, TypeId::STRING, true), expected);
    // One id in one value of an indirect table.
    assert_ne!(digest(&forwards, TypeId::NUMBER, true), expected);
    assert_eq!(digest(&forwards, TypeId::STRING, false), 0);
}

/// The parser threads number the atoms in a different order in every run.
#[test]
#[cfg_attr(miri, ignore)]
fn the_digest_takes_an_atom_as_its_text() {
    let session = Session::new();
    let digest = |texts: [&[u8]; 3], used: [&[u8]; 2]| {
        let atoms = Interner::new_in(&session);
        for text in texts {
            atoms.intern(text);
        }
        let used = used.map(|text| atoms.lookup(text).unwrap());
        let mut by_id = ById::<Atom, TypeId, Buffered>::default();
        let mut by_key = ByKey::<(TypeId, Atom), TypeId, Buffered>::default();
        let mut kept = ByIdIndirect::<TypeId, Box<[Atom]>, Buffered>::default();
        by_id.set_slot(numbered(0));
        by_key.set_slot(numbered(1));
        kept.set_slot(numbered(2));
        let mut task = begin(&session, 0);
        // As a key indexed by number, in a composite key, in a value.
        by_id.insert(&task, used[0], TypeId::ANY, stored());
        by_key.insert(&task, (TypeId::ANY, used[1]), TypeId::ANY, stored());
        kept.insert(
            &task,
            TypeId::ANY,
            Box::new([used[0], Atom::NONE]),
            stored(),
        );
        let tables: [&dyn Publish; 3] = [&by_id, &by_key, &kept];
        let mut finished = [task.finish_tables(&tables, Vec::new())];
        let published = publish_tables(&tables, &mut finished, &forwards, Some(&atoms));
        assert_eq!(published.published, 3);
        (used, published.digest)
    };
    let (atoms, expected) = digest(
        [b"first text", b"second text", b"third text"],
        [b"first text", b"second text"],
    );
    let (other_atoms, same) = digest(
        [b"third text", b"second text", b"first text"],
        [b"first text", b"second text"],
    );
    assert_ne!(atoms[0], other_atoms[0]);
    assert_eq!(same, expected);
    // The same numbers, different texts.
    let (same_atoms, other) = digest(
        [b"other text", b"second text", b"third text"],
        [b"other text", b"second text"],
    );
    assert_eq!(atoms, same_atoms);
    assert_ne!(other, expected);
}

// ───────────────────────────── link and follow ─────────────────────────────

#[test]
#[cfg_attr(miri, ignore)]
fn a_type_that_two_tasks_create_is_one_key_after_the_link() {
    let session = Session::new();
    for pool in POOLS {
        let tables = Tables::new(&session);
        let mut finished: Vec<Finished> = (0..2)
            .map(|index| {
                let mut task = begin(&session, index);
                // So that the two tasks have different numbers for `keyof string`.
                if index == 1 {
                    let other = tables.keyof(&task, TypeId::NUMBER);
                    tables.by_id.insert(&task, other, other, stored());
                }
                let own = tables.keyof(&task, TypeId::STRING);
                let nested = tables.keyof(&task, own);
                tables.by_id.insert(&task, own, nested, stored());
                tables.by_key.insert(&task, (own, nested), own, stored());
                tables
                    .shapes
                    .insert(&task, own, Box::new([own, nested]), stored());
                tables.finish(&mut task)
            })
            .collect();
        let published = tables.barrier(&mut finished, &pool);
        assert_eq!(counts(&published), (7, 4, 3));
        let reader = Task::new_in(session.arena());
        let keyof = tables.keyof(&reader, TypeId::STRING);
        let nested = tables.keyof(&reader, keyof);
        let other = tables.keyof(&reader, TypeId::NUMBER);
        assert!(!keyof.is_local() && !nested.is_local() && !other.is_local());
        assert_eq!(tables.by_id.get(&reader, &keyof), Some(nested));
        assert_eq!(tables.by_id.get(&reader, &other), Some(other));
        assert_eq!(tables.by_key.get(&reader, &(keyof, nested)), Some(keyof));
        assert_eq!(
            tables.shapes.get(&reader, &keyof),
            Some(Box::from([keyof, nested]))
        );
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn an_atom_that_two_tasks_create_is_one_key_after_the_link() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut names = ById::<Atom, TypeId, Buffered>::default();
    names.set_slot(numbered(0));
    let all: [&dyn Publish; 1] = [&names];
    let values = [TypeId::STRING, TypeId::NUMBER];
    let mut finished: Vec<Finished> = (0..2)
        .map(|index| {
            let mut task = begin(&session, index);
            let atoms = Atoms::new(&tables.atoms, &task.own);
            // So that the two tasks have different numbers for the text they share.
            if index == 1 {
                let other = atoms.intern(b"only the second task has it");
                names.insert(&task, other, TypeId::ANY, stored());
            }
            let own = atoms.intern(b"new at check time");
            assert!(own.is_own());
            names.insert(&task, own, values[index as usize], stored());
            assert_eq!(names.get(&task, &own), Some(values[index as usize]));
            task.finish_tables(&all, Vec::new())
        })
        .collect();
    assert_eq!(tables.atoms.lookup(b"new at check time"), None);
    tables.link(&mut finished, &forwards);
    let published = publish_tables(&all, &mut finished, &forwards, Some(&tables.atoms));
    assert_eq!(counts(&published), (3, 2, 1));
    let atom = tables.atoms.lookup(b"new at check time").unwrap();
    assert!(!atom.is_own());
    assert_eq!(
        names.get(&Task::new_in(session.arena()), &atom),
        Some(values[0])
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn an_own_type_without_an_entry_dies_with_its_task() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut task = begin(&session, 0);
    let temporary = tables.keyof(&task, TypeId::STRING);
    let kept = tables.keyof(&task, TypeId::NUMBER);
    assert!(temporary.is_local());
    tables.by_id.insert(&task, kept, TypeId::ANY, stored());
    tables.barrier(&mut [tables.finish(&mut task)], &forwards);
    let reader = Task::new_in(session.arena());
    assert!(!tables.keyof(&reader, TypeId::NUMBER).is_local());
    assert!(tables.keyof(&reader, TypeId::STRING).is_local());
}

/// `shapes` and `members`. A handle is not a value.
#[test]
#[cfg_attr(miri, ignore)]
fn a_handle_in_a_value_becomes_the_handle_that_has_won() {
    let session = Session::new();
    for pool in POOLS {
        let tables = Tables::new(&session);
        let values = [TypeId::STRING, TypeId::NUMBER];
        let mut finished: Vec<Finished> = (0..2)
            .map(|index| {
                let mut task = begin(&session, index);
                let shared = tables.keyof(&task, TypeId::STRING);
                // So that a handle of the higher task is not the number it has in the lower one.
                if index == 1 {
                    tables
                        .shapes
                        .insert(&task, TypeId::ANY, Box::new([]), stored());
                }
                let value = Box::new([values[index as usize]]);
                let (shape, _) = tables.shapes.insert_ref(&task, shared, value, stored());
                assert!(shape.is_local());
                // Each task has an entry of its own that holds the handle.
                let holder = tables.keyof(&task, values[index as usize]);
                let held = Holder { shape, of: holder };
                tables.members.insert(&task, holder, held, stored());
                tables.finish(&mut task)
            })
            .collect();
        tables.barrier(&mut finished, &pool);
        let reader = Task::new_in(session.arena());
        let shared = tables.keyof(&reader, TypeId::STRING);
        let winner = tables.shapes.handle(&reader, &shared).unwrap();
        assert!(!winner.is_local());
        assert_eq!(**tables.shapes.at(&reader, winner), [values[0]]);
        for value in values {
            let holder = tables.keyof(&reader, value);
            let expected = Holder {
                shape: winner,
                of: holder,
            };
            assert_eq!(tables.members.get(&reader, &holder), Some(expected));
        }
        // The loser's value was not pushed.
        assert_eq!(tables.shapes.footprint().kept, 2);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_value_that_owns_memory_of_an_arena_is_followed_and_published() {
    let session = Session::new();
    for pool in POOLS {
        let tables = Tables::new(&session);
        let mut lists = ByIdIndirect::<TypeId, List<'_, TypeId>, Buffered, _>::new_in(&session);
        lists.set_slot(numbered(7));
        let mut all = tables.all().to_vec();
        all.push(&lists);
        let mut finished: Vec<Finished<'_>> = (0..2)
            .map(|index| {
                let mut task = begin(&session, index);
                let own = tables.keyof(&task, TypeId::STRING);
                let value = List::copy_from_slice_in(&[own, TypeId(index)], session.arena());
                let (_, kept) = lists.insert_ref(&task, TypeId::ANY, value, stored());
                assert_eq!(**kept, [own, TypeId(index)]);
                task.finish_tables(&all, Vec::new())
            })
            .collect();
        tables.link(&mut finished, &pool);
        publish_tables(&all, &mut finished, &pool, None);
        let reader = Task::new_in(session.arena());
        let published = tables.keyof(&reader, TypeId::STRING);
        assert!(!published.is_local());
        let kept = lists.get_ref(&reader, &TypeId::ANY).unwrap();
        assert_eq!(**kept, [published, TypeId(0)]);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_published_handle_in_a_value_stays() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut first = begin(&session, 0);
    (tables.shapes).insert(&first, TypeId::ANY, Box::new([TypeId::ANY]), stored());
    tables.barrier(&mut [tables.finish(&mut first)], &forwards);
    let mut second = Task::new_in(session.arena());
    second.begin(1, 0, true);
    let shape = tables.shapes.handle(&second, &TypeId::ANY).unwrap();
    let held = Holder {
        shape,
        of: TypeId::ANY,
    };
    tables
        .members
        .insert(&second, TypeId::STRING, held, stored());
    tables.barrier(&mut [tables.finish(&mut second)], &forwards);
    assert_eq!(
        tables
            .members
            .get(&Task::new_in(session.arena()), &TypeId::STRING),
        Some(held)
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn the_keys_of_a_by_key_reach_every_part_and_each_is_counted_once() {
    let session = Session::new();
    let outcomes = POOLS.map(|pool| {
        let tables = Tables::new(&session);
        let mut finished: Vec<Finished> = (0..3)
            .map(|index| {
                let mut task = begin(&session, index);
                let mut of = TypeId::STRING;
                // The tasks overlap: 0..2000, 500..2500, 1000..3000 of one chain of types. Enough for the pool to be used.
                for link in 0..3000 {
                    let next = tables.keyof(&task, of);
                    if (index * 500..index * 500 + 2000).contains(&link) {
                        let value =
                            [TypeId::STRING, TypeId::NUMBER, TypeId::BIGINT][index as usize];
                        tables.by_key.insert(&task, (of, next), value, stored());
                    }
                    of = next;
                }
                tables.finish(&mut task)
            })
            .collect();
        let published = tables.barrier(&mut finished, &pool);
        assert!(published.buffered >= FEW_ENTRIES);
        assert_eq!(counts(&published), (6000, 3000, 3000));
        assert_eq!(tables.by_key.footprint().entries, 3000);
        let (reader, mut of) = (Task::new_in(session.arena()), TypeId::STRING);
        (0..3000)
            .map(|_| {
                let next = tables.keyof(&reader, of);
                assert!(!next.is_local());
                let value = tables.by_key.get(&reader, &(of, next)).unwrap();
                of = next;
                (next, value)
            })
            .collect::<Vec<_>>()
    });
    // The lowest task that has the key.
    for (link, &(_, value)) in outcomes[0].iter().enumerate() {
        let expected =
            [TypeId::STRING, TypeId::NUMBER, TypeId::BIGINT][link.saturating_sub(1500) / 500];
        assert_eq!(value, expected);
    }
    // Published ids and values do not depend on how the pool schedules the work.
    assert!(outcomes[0] == outcomes[1] && outcomes[0] == outcomes[2]);
}

/// Against a model: for each key the first entry of the lowest task that has one.
#[test]
#[cfg_attr(miri, ignore)]
fn random_tasks_publish_what_the_model_says() {
    let session = Session::new();
    use crate::util::FxHashMap;
    const DEPTHS: usize = 200;
    // A type is named by its depth: `string`, `keyof string`, `keyof keyof string`, ..
    fn chain<'s>(tables: &Tables<'s>, task: &Task<'s>) -> Vec<TypeId> {
        let mut chain = vec![TypeId::STRING];
        for depth in 1..DEPTHS {
            chain.push(tables.keyof(task, chain[depth - 1]));
        }
        chain
    }
    for (seed, pool) in (1..=12u64).zip(POOLS.into_iter().cycle()) {
        let mut state = seed;
        let mut random = |below: usize| {
            state = (state.wrapping_mul(6364136223846793005)).wrapping_add(1442695040888963407);
            (state >> 33) as usize % below
        };
        let tables = Tables::new(&session);
        let mut by_node: FxHashMap<Node, usize> = FxHashMap::default();
        let mut by_id: FxHashMap<usize, usize> = FxHashMap::default();
        let mut by_key: FxHashMap<(usize, usize), usize> = FxHashMap::default();
        let mut shapes: FxHashMap<usize, usize> = FxHashMap::default();
        let mut buffered = 0;
        let mut finished: Vec<Finished> = (0..6)
            .map(|index| {
                let mut task = begin_in(&session, index, FileId(index % 3));
                let ids = chain(&tables, &task);
                for _ in 0..2000 {
                    let (a, b, value) = (random(DEPTHS), random(DEPTHS), random(DEPTHS));
                    let node = (FileId(random(3) as u32), random(100) as u32);
                    // Whether the task has no entry for the key yet.
                    let is_new = match random(4) {
                        0 => {
                            let is_new = tables.by_node.get(&task, &node).is_none();
                            tables.by_node.insert(&task, node, ids[value], stored());
                            by_node.entry(node).or_insert(value);
                            is_new
                        }
                        1 => {
                            let is_new = tables.by_id.get(&task, &ids[a]).is_none();
                            tables.by_id.insert(&task, ids[a], ids[value], stored());
                            by_id.entry(a).or_insert(value);
                            is_new
                        }
                        2 => {
                            let is_new = tables.by_key.get(&task, &(ids[a], ids[b])).is_none();
                            (tables.by_key).insert(&task, (ids[a], ids[b]), ids[value], stored());
                            by_key.entry((a, b)).or_insert(value);
                            is_new
                        }
                        _ => {
                            let is_new = tables.shapes.get(&task, &ids[a]).is_none();
                            (tables.shapes).insert(&task, ids[a], Box::new([ids[value]]), stored());
                            shapes.entry(a).or_insert(value);
                            is_new
                        }
                    };
                    buffered += u64::from(is_new);
                }
                tables.finish(&mut task)
            })
            .collect();
        let published = tables.barrier(&mut finished, &pool);
        // Enough for the pool to be used.
        assert!(published.buffered >= FEW_ENTRIES);
        let stored = (by_node.len() + by_id.len() + by_key.len() + shapes.len()) as u64;
        assert_eq!(counts(&published), (buffered, stored, buffered - stored));
        let reader = Task::new_in(session.arena());
        let ids = chain(&tables, &reader);
        for (node, value) in by_node {
            assert_eq!(tables.by_node.get(&reader, &node), Some(ids[value]));
        }
        for (a, value) in by_id {
            assert_eq!(tables.by_id.get(&reader, &ids[a]), Some(ids[value]));
        }
        for ((a, b), value) in by_key {
            let found = tables.by_key.get(&reader, &(ids[a], ids[b]));
            assert_eq!(found, Some(ids[value]));
        }
        for (a, value) in shapes {
            let found = tables.shapes.get(&reader, &ids[a]);
            assert_eq!(found, Some(Box::from([ids[value]])));
        }
    }
}

// ───────────────────────────── bound ─────────────────────────────

#[test]
#[cfg_attr(miri, ignore)]
fn nothing_that_is_bound_is_published() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut task = begin(&session, 0);
    // Nothing imports `A`.
    task.begin_file(A, false);
    let bound = tables.this_of(&task, A);
    let on_bound = tables.keyof(&task, bound);
    let free = tables.keyof(&task, TypeId::STRING);
    let any = TypeId::ANY;

    // A key that is a node of the file. A value that references the file, directly or through
    // another type. A key that does.
    tables.by_node.insert(&task, (A, 1), any, stored());
    tables.set.insert(&task, (A, 1), (), stored());
    tables
        .kept_by_node
        .insert(&task, (A, 1), Box::new([any]), stored());
    tables.by_node.insert(&task, (B, 1), bound, stored());
    tables.by_node.insert(&task, (B, 2), on_bound, stored());
    tables.by_id.insert(&task, any, on_bound, stored());
    tables.by_id.insert(&task, bound, any, stored());
    tables.by_id.insert(&task, on_bound, any, stored());
    tables.by_key.insert(&task, (any, bound), any, stored());
    tables.by_key.insert(&task, (any, any), on_bound, stored());
    (tables.kept_by_node).insert(&task, (B, 1), Box::new([any, bound]), stored());
    // A bound shape under a key that is not bound, and the entry that holds its handle, which
    // itself references nothing bound.
    let (shape, _) = (tables.shapes).insert_ref(&task, free, Box::new([on_bound]), stored());
    let held = Holder { shape, of: free };
    tables.members.insert(&task, free, held, stored());
    // The task itself finds all of it.
    assert_eq!(tables.by_node.get(&task, &(A, 1)), Some(any));
    assert_eq!(tables.by_node.get(&task, &(B, 1)), Some(bound));
    assert_eq!(tables.by_id.get(&task, &any), Some(on_bound));
    assert_eq!(tables.members.get(&task, &free), Some(held));

    // Entries that are not bound, interleaved with the others.
    tables.by_node.insert(&task, (B, 3), free, stored());
    tables.by_id.insert(&task, free, any, stored());
    tables.by_key.insert(&task, (free, any), free, stored());
    tables.shapes.insert(&task, any, Box::new([free]), stored());

    let published = tables.barrier(&mut [tables.finish(&mut task)], &forwards);
    assert_eq!(counts(&published), (4, 4, 0));
    let entries = tables.all().map(|table| table.slot());
    assert_eq!(entries, [0, 1, 2, 3, 4, 5, 6]);
    assert_eq!(tables.by_node.footprint().entries, 1);
    assert_eq!(tables.set.footprint().entries, 0);
    assert_eq!(tables.by_id.footprint().entries, 1);
    assert_eq!(tables.shapes.footprint().kept, 1);
    assert_eq!(tables.kept_by_node.footprint().kept, 0);
    assert_eq!(tables.members.footprint().kept, 0);
    assert_eq!(tables.by_key.footprint().entries, 1);
    let reader = Task::new_in(session.arena());
    let free = tables.keyof(&reader, TypeId::STRING);
    assert!(!free.is_local());
    assert_eq!(tables.by_node.get(&reader, &(B, 3)), Some(free));
    assert_eq!(tables.by_key.get(&reader, &(free, any)), Some(free));
    // The bound types are not in the shared store.
    assert!(tables.this_of(&reader, A).is_local());
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_node_without_a_published_cell_has_an_entry_in_the_task_only() {
    let session = Session::new();
    // The second file is not counted.
    let bases = Bases::new_in([10, 0].into_iter(), &Global);
    let mut table = ByNode::<Node, TypeId, Buffered>::new_in(&bases, Global);
    table.set_slot(numbered(0));
    let mut task = begin(&session, 0);
    task.begin_file(B, false);
    assert_eq!(table.get(&task, &(B, 5)), None);
    table.insert(&task, (B, 5), TypeId::STRING, stored());
    assert_eq!(table.get(&task, &(B, 5)), Some(TypeId::STRING));
    let mut finished = [task.finish_tables(&[&table], Vec::new())];
    let published = publish_tables(&[&table], &mut finished, &forwards, None);
    assert_eq!(counts(&published), (0, 0, 0));
}

// ───────────────────────────── bit storage ─────────────────────────────

#[test]
#[cfg_attr(miri, ignore)]
fn the_fields_of_a_shared_cell() {
    let cell = AtomicU32::new(0);
    assert_eq!(cell.put_field_if_empty(4, 3, 2), 2);
    // The first value wins.
    assert_eq!(cell.put_field_if_empty(4, 3, 1), 2);
    assert_eq!(cell.put_field_if_empty(6, 3, 1), 1);
    assert_eq!(cell.put_field_if_empty(31, 1, 1), 1);
    assert_eq!(cell.into_inner(), 2 << 4 | 1 << 6 | 1 << 31);
}

#[test]
#[cfg_attr(miri, ignore)]
fn published_values_of_a_bit_share_a_cell() {
    let session = Session::new();
    let tables = Tables::new(&session);
    // 300 nodes, a bit each.
    assert_eq!(tables.set.footprint().allocated, 300usize.div_ceil(32) * 4);
    let in_set = [(A, 0), (A, 31), (A, 32), (A, 99), (B, 0), (C, 99)];
    let mut finished: Vec<Finished> = (0..2)
        .map(|index| {
            let mut task = begin_in(&session, index, A);
            for key in in_set {
                tables.set.insert(&task, key, (), stored());
            }
            tables.finish(&mut task)
        })
        .collect();
    let published = tables.barrier(&mut finished, &forwards);
    assert_eq!(counts(&published), (12, 6, 6));
    let reader = Task::new_in(session.arena());
    for file in [A, B, C] {
        for index in 0..100 {
            let expected = in_set.contains(&(file, index)).then_some(());
            assert_eq!(tables.set.get(&reader, &(file, index)), expected);
        }
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn file_local_values_of_a_bit_or_two_share_a_word() {
    let session = Session::new();
    let mut set = ByNode::<Node, (), FileLocal>::new_in(&Bases::none_in(&Global), Global);
    let mut flags = ByNode::<Node, bool, FileLocal>::new_in(&Bases::none_in(&Global), Global);
    set.set_slot(numbered(0));
    flags.set_slot(numbered(1));
    let mut task = Task::new_in(session.arena());
    task.begin_file(FileId(3), true);
    // The nodes of the task's file have dense words. Those of another file have sparse ones.
    for file in [FileId(3), FileId(4)] {
        for index in [0, 1, 31, 32, 63, 64, 1000] {
            assert_eq!(set.get(&task, &(file, index)), None);
            assert_eq!(flags.get(&task, &(file, index)), None);
        }
        set.insert(&task, (file, 63), ());
        set.insert(&task, (file, 1000), ());
        assert!(flags.insert(&task, (file, 31), true));
        assert!(!flags.insert(&task, (file, 32), false));
        // `insert` keeps, `rewrite` replaces.
        assert!(flags.insert(&task, (file, 31), false));
        flags.rewrite(&task, (file, 32), true);
        let in_set = [62, 63, 64, 999, 1000, 1001].map(|index| set.get(&task, &(file, index)));
        assert_eq!(in_set, [None, Some(()), None, None, Some(()), None]);
        let known = [30, 31, 32, 33].map(|index| flags.get(&task, &(file, index)));
        assert_eq!(known, [None, Some(true), Some(true), None]);
    }
    // No node.
    set.insert(&task, (FileId(3), u32::MAX), ());
    assert_eq!(set.get(&task, &(FileId(3), u32::MAX)), None);
    // The entries are dropped at the end of the file.
    task.begin_file(FileId(4), true);
    assert_eq!(set.get(&task, &(FileId(4), 63)), None);
    assert_eq!(set.get(&task, &(FileId(3), 63)), None);
}

/// `TypeKey` is hashed and compared like the equivalent `TypeData`.
#[test]
#[cfg_attr(miri, ignore)]
fn a_borrowed_key_finds_the_type_that_was_interned_with_its_lists() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let task = begin(&session, 0);
    let types = Types::new(&tables.types, &task.own);
    let (arena, members) = (session.arena(), [TypeId::STRING, TypeId::NUMBER]);
    let list = || List::copy_from_slice_in(&members, arena);
    let target = Sym {
        file: A,
        id: SymbolId(1),
    };
    let flags = [ElemFlags::REQUIRED, ElemFlags::OPTIONAL];
    let decls = [(A, crate::hir::FnId(3))];
    let mapper = MapperId::IDENTITY;
    let pairs = [
        (TypeData::Union(list()), TypeKey::Union(&members)),
        (
            TypeData::Intersection(list()),
            TypeKey::Intersection(&members),
        ),
        (
            TypeData::Ref {
                target,
                args: list().into(),
            },
            TypeKey::Ref {
                target,
                args: &members,
            },
        ),
        (
            TypeData::Tuple {
                elems: list().into(),
                flags: List::copy_from_slice_in(&flags, arena),
                readonly: true,
            },
            TypeKey::Tuple {
                elems: &members,
                flags: &flags,
                readonly: true,
            },
        ),
        (
            TypeData::Fns {
                decls: List::copy_from_slice_in(&decls, arena),
                mapper,
            },
            TypeKey::Fns {
                decls: &decls,
                mapper,
            },
        ),
    ];
    for (data, key) in pairs {
        let id = types.intern(data);
        assert_eq!(types.intern_key(key), id);
        assert_eq!(types.intern_key(TypeKey::Data(types.get(id))), id);
    }
    // The other way round, with an alias and an origin.
    let borrowed = ProvenanceKey {
        alias: Some((target, &members)),
        origin: OriginKey::Union(&members),
        is_enum: true,
        stored_under: None,
        is_array_literal: false,
        is_array_pattern: false,
        has_other_instantiation: false,
    };
    let id = types.intern_key_with(TypeKey::Union(&members), &borrowed);
    let owned = Provenance {
        alias: Some((target, list())),
        origin: UnionOrigin::Union(list()),
        is_enum: true,
        stored_under: None,
        is_array_literal: false,
        is_array_pattern: false,
        has_other_instantiation: false,
    };
    assert_eq!(types.intern_with(TypeData::Union(list()), owned), id);
    assert_ne!(types.intern_key(TypeKey::Union(&members)), id);
}

// ───────────────────────────── the containers ─────────────────────────────

#[test]
#[cfg_attr(miri, ignore)]
fn hashed_lists_its_entries_in_insertion_order() {
    let mut hashed = Hashed::<u64, u32>::default();
    // Not in the order of the keys, nor of their hashes.
    let keys: Vec<u64> = (0..1000u64).map(|i| i.wrapping_mul(7919) % 1009).collect();
    for (place, &key) in keys.iter().enumerate() {
        assert_eq!(
            *hashed.insert(spread_word(key), key, place as u32),
            place as u32
        );
    }
    // `insert` does not overwrite. `replace` overwrites, and the entry keeps its position.
    assert_eq!(*hashed.insert(spread_word(keys[5]), keys[5], 77), 5);
    hashed.replace(spread_word(keys[6]), keys[6], 77);
    assert_eq!(hashed.place(spread_word(keys[6]), &keys[6]), Some(6));
    assert_eq!(hashed.get(spread_word(5000), &5000), None);
    let listed = hashed.take();
    assert!(hashed.is_empty());
    assert_eq!(listed.len(), 1000);
    for (place, &(key, value)) in listed.iter().enumerate() {
        let expected = if place == 6 { 77 } else { place as u32 };
        assert_eq!((key, value), (keys[place], expected));
    }
    assert_eq!(hashed.get(spread_word(keys[5]), &keys[5]), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn the_nodes_of_many_files_have_different_hashes() {
    let mut tags = crate::util::FxHashSet::default();
    for file in 0..512u64 {
        for index in 0..512u64 {
            tags.insert(spread_word(file << 32 | index) as u32);
        }
    }
    // A few of 2^18 tags among 2^32 collide by chance: 8 collisions are expected.
    assert!(tags.len() > (1 << 18) - 64);
}

#[test]
#[cfg_attr(miri, ignore)]
fn places_are_added_in_one_batch_and_found_without_a_lock() {
    let places = GrowingPlaces::<Global>::default();
    assert_eq!(places.find_frozen(spread_word(1), |_| true), None);
    places.extend(0, std::iter::empty());
    for batch in 0..3u32 {
        let added = batch * 1000..(batch + 1) * 1000;
        places.extend(1000, added.map(|i| (spread_word(u64::from(i)), i)));
    }
    for i in 0..3000u32 {
        let found = places.find_frozen(spread_word(u64::from(i)), |index| index == i);
        assert_eq!(found, Some(i));
    }
    assert_eq!(
        places.find_frozen(spread_word(3000), |index| index == 3000),
        None
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn threads_fill_and_read_a_sharded_map() {
    let map = ShardedMap::<u32, Box<u32>>::default();
    on_threads(4, &|thread| {
        for i in 0..300 {
            let key = (i * 7 + thread as u32) % 300;
            assert_eq!(**map.insert_ref(key, Box::new(key)), key);
            let other = (key + 11) % 300;
            if let Some(value) = map.get_ref(&other) {
                assert_eq!(**value, other);
            }
        }
    });
    assert_eq!(map.entries(), 300);
}

#[test]
#[cfg_attr(miri, ignore)]
fn for_each_mut_gives_every_item_to_one_call() {
    for pool in POOLS {
        let mut items = vec![0u32; 100];
        for_each_mut(&mut items, &pool, &|item| *item += 1);
        assert!(items.iter().all(|&item| item == 1));
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn local_is_bit_30() {
    assert_eq!(LOCAL, 1 << 30);
    assert!(TypeId(LOCAL).is_local() && !TypeId(LOCAL - 1).is_local());
    assert!((TypeId::ANY, TypeId(LOCAL | 5)).is_local());
}
