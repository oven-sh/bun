//! Tests for the buffer, `Task::finish`, `publish`, the merge and `follow` of ids and handles, and
//! the underlying containers.

use super::*;
use crate::atom::Interner;
use crate::bind::SymbolId;
use crate::check::commit::Commits;
use crate::local::{Found, Hashed, LOCAL, MaybeLocal, SlotNumber, spread_word};
use crate::program::Sym;
use crate::session::Session;
use crate::table::{
    At, Bases, Buffered, ById, ByIdIndirect, ByKey, ByNode, ByNodeIndirect, Cell as _, FileLocal,
    Handle, Id as _, OfExpressions,
};
use crate::types::{
    ElemFlags, List, MapperId, OriginKey, Provenance, ProvenanceKey, ShortList, TypeArguments,
    TypeData, TypeId, TypeKey, TypeStore, Types, UnionOrigin,
};
use crate::util::{ShardedMap, shard_among};
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
            types: TypeStore::new_in(session, Interner::new_in(session)),
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
        (tables.members).hold_handles_of(&tables.shapes, Holder::shape_mut);
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

fn begin<'s>(session: &'s Session, types: &TypeStore<'s>, index: u32) -> Task<'s> {
    let mut task = Task::new_in(session.arena(), types);
    task.begin(0, index);
    task
}

fn begin_in<'s>(session: &'s Session, types: &TypeStore<'s>, index: u32, file: FileId) -> Task<'s> {
    let mut task = begin(session, types, index);
    task.begin_file(file, true);
    task
}

fn stored() -> Stored {
    Stored::new()
}

// ───────────────────────────── the buffer ─────────────────────────────

#[test]
#[cfg_attr(miri, ignore)]
fn insert_keeps_what_is_there_and_rewrite_replaces_the_tasks_entry() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let task = begin_in(&session, &tables.types, 0, A);
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
fn what_a_task_outside_the_plan_writes_is_dropped_with_it() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let task = Task::new_in(session.arena(), &tables.types);
    assert!(!task.is_planned());
    tables
        .by_node
        .insert(&task, (A, 1), TypeId::STRING, stored());
    assert_eq!(tables.by_node.get(&task, &(A, 1)), Some(TypeId::STRING));
    drop(task);
    assert_eq!(
        tables
            .by_node
            .get(&Task::new_in(session.arena(), &tables.types), &(A, 1)),
        None
    );
}

/// A chunk of files that nothing imports: no node of a file is evaluated before the task reaches
/// it, and the entries can still be looked up afterwards.
#[test]
#[cfg_attr(miri, ignore)]
fn a_task_that_goes_through_files_that_nothing_imports() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut task = begin(&session, &tables.types, 0);
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

#[test]
#[cfg_attr(miri, ignore)]
fn a_reference_to_a_kept_value_stays_good_while_the_task_keeps_more() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let task = begin(&session, &tables.types, 0);
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

#[test]
#[cfg_attr(miri, ignore)]
fn a_permission_tells_whether_the_task_has_held_back_since_its_computation_began() {
    let session = Session::new();
    let task = begin(
        &session,
        &TypeStore::new_in(&session, Interner::new_in(&session)),
        0,
    );
    let outer = Stored::since(task.held_back());
    assert!(!task.has_held_back_since(outer));
    task.hold_back();
    let inner = Stored::since(task.held_back());
    assert!(task.has_held_back_since(outer));
    assert!(!task.has_held_back_since(inner));
    assert!(task.has_held_back_since(Stored::new()));
}

// ───────────────────────────── the order of publishing ─────────────────────────────

// ───────────────────────────── link and follow ─────────────────────────────

// ───────────────────────────── bound ─────────────────────────────

// ───────────────────────────── rows and pages ─────────────────────────────

#[test]
#[should_panic]
#[cfg_attr(miri, ignore)]
fn a_table_that_knows_its_slot_takes_no_other() {
    let mut table = ById::<TypeId, TypeId, Buffered<At<3>>>::default();
    table.set_slot(numbered(4));
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
fn file_local_values_of_a_bit_or_two_share_a_word() {
    let session = Session::new();
    let mut set = ByNode::<Node, (), FileLocal>::new_in(&Bases::none_in(&Global), Global);
    let mut flags = ByNode::<Node, bool, FileLocal>::new_in(&Bases::none_in(&Global), Global);
    set.set_slot(numbered(0));
    flags.set_slot(numbered(1));
    let mut task = Task::new_in(
        session.arena(),
        &TypeStore::new_in(&session, Interner::new_in(&session)),
    );
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
    let task = begin(&session, &tables.types, 0);
    let types = Types::new(&tables.types, &task.own);
    let arena = session.arena();
    let target = Sym {
        file: A,
        id: SymbolId(1),
    };
    let mapper = MapperId::IDENTITY;
    // A record holds a list of up to 2, 3 or 7 items itself.
    for len in [0, 1, 2, 3, 4, 7, 8, 40] {
        let members: Vec<TypeId> = (0..len).map(|i| TypeId(1 + i % 16)).collect();
        let flags = vec![ElemFlags::OPTIONAL; len as usize];
        let decls: Vec<_> = (0..len).map(|f| (A, crate::hir::FnId(f))).collect();
        let short = || ShortList::copy_from_slice_in(&members, arena);
        let pairs = [
            (TypeData::Union(short()), TypeKey::Union(&members)),
            (
                TypeData::Intersection(short()),
                TypeKey::Intersection(&members),
            ),
            (
                TypeData::Ref {
                    target,
                    args: TypeArguments::given_in(&members, arena),
                },
                TypeKey::Ref {
                    target,
                    args: &members,
                },
            ),
            (
                TypeData::Tuple {
                    elems: TypeArguments::given_in(&members, arena),
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
                    decls: ShortList::copy_from_slice_in(&decls, arena),
                    mapper,
                },
                TypeKey::Fns {
                    decls: &decls,
                    mapper,
                },
            ),
        ];
        // Owned first for the even lengths, borrowed first for the odd ones.
        for (data, key) in pairs {
            let first = (len % 2 == 1).then(|| types.intern_key(key));
            let id = types.intern(data);
            assert!(first.is_none_or(|first| first == id));
            assert_eq!(types.intern_key(key), id);
            assert_eq!(types.intern_key(TypeKey::Data(types.get(id))), id);
            match types.get(id) {
                TypeData::Union(list) | TypeData::Intersection(list) => {
                    assert_eq!(**list, *members);
                }
                TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => {
                    assert_eq!(args.actual(), Some(&members[..]));
                }
                TypeData::Fns { decls: list, .. } => assert_eq!(**list, *decls),
                _ => unreachable!(),
            }
        }
    }
    let members = [TypeId::STRING, TypeId::NUMBER];
    let list = || List::copy_from_slice_in(&members, arena);
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
    let union = TypeData::Union(ShortList::copy_from_slice_in(&members, arena));
    assert_eq!(types.intern_with(union, owned), id);
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
    assert_eq!(hashed.len(), 1000);
    for (place, &key) in keys.iter().enumerate() {
        let expected = if place == 6 { 77 } else { place as u32 };
        assert_eq!(hashed.entry(place as u32), Some(&(key, expected)));
    }
    assert_eq!(hashed.entry(1000), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_vacancy_is_filled_only_while_it_is_one() {
    let is = |number: u32| move |found: u32| found == number;
    // Of a table without slots.
    let found = Found::default();
    assert_eq!(found.find(7, |_| true), None);
    let Err(vacancy) = found.find_or_vacancy(7, |_| true) else {
        unreachable!()
    };
    found.fill(vacancy, 7, 1);
    assert_eq!(found.find_or_vacancy(7, is(1)).ok(), Some(1));
    // Two searches for one hash end at one slot, which only the first entry gets.
    let vacancies = [0; 2].map(|_| found.find_or_vacancy(9, |_| false).unwrap_err());
    found.fill(vacancies[0], 9, 2);
    found.fill(vacancies[1], 9, 3);
    assert_eq!(found.find(9, is(2)), Some(2));
    assert_eq!(found.find(9, is(3)), Some(3));
    // The table has grown several times since.
    let stale = found.find_or_vacancy(11, |_| false).unwrap_err();
    for number in 4..3000 {
        found.add(spread_word(u64::from(number)), number);
    }
    found.fill(stale, 11, 3000);
    assert_eq!(found.find(11, is(3000)), Some(3000));
    for number in 4..3000 {
        let spread = spread_word(u64::from(number));
        assert_eq!(found.find(spread, is(number)), Some(number));
        assert_eq!(found.find(spread, |_| false), None);
    }
    assert_eq!(found.find(7, is(1)), Some(1));
    assert_eq!(found.find(9, is(3)), Some(3));
}

/// The table is replaced when an entry would make it more than three quarters full.
#[test]
#[cfg_attr(miri, ignore)]
fn what_is_found_stays_found_when_the_table_is_replaced() {
    // The first table has 256 slots.
    for count in [1, 191, 192, 193, 384, 385] {
        let mut found = Found::default();
        for number in 0..count {
            found.add(spread_word(u64::from(number)), number);
            for earlier in [0, number / 2, number] {
                let spread = spread_word(u64::from(earlier));
                assert_eq!(found.find(spread, |it| it == earlier), Some(earlier));
            }
        }
        assert_eq!(found.find(spread_word(u64::from(count)), |_| true), None);
        found.clear();
        assert_eq!(found.find(spread_word(0), |_| true), None);
        found.add(spread_word(0), 5);
        assert_eq!(found.find(spread_word(0), |_| true), Some(5));
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn the_top_bits_of_a_hash_are_its_shard() {
    for shards in [1, 2, 8, 64, 256] {
        for top in 0..256 {
            for rest in [0, (1 << 56) - 1] {
                let shard = shard_among((top as u64) << 56 | rest, shards);
                assert_eq!(shard, top / (256 / shards));
            }
        }
    }
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
fn local_is_bit_30() {
    assert_eq!(LOCAL, 1 << 30);
    assert!(TypeId(LOCAL).is_local() && !TypeId(LOCAL - 1).is_local());
    assert!((TypeId::ANY, TypeId(LOCAL | 5)).is_local());
}

// ───────────────────────────── commits ─────────────────────────────

const STRING: TypeId = TypeId::STRING;
const NUMBER: TypeId = TypeId::NUMBER;

/// A task that commits while it runs, and writes nothing at once.
fn begin_committing<'s>(
    session: &'s Session,
    tables: &Tables<'s>,
    commits: &Commits<'s>,
    index: u32,
) -> Task<'s> {
    let mut task = begin(session, &tables.types, index);
    let view = commits.view(3);
    task.see_commits(view, false, 0);
    task
}

/// .. and writes at once to the tables of `Tables` that are keyed by a record.
fn begin_writing_at_once<'s>(
    session: &'s Session,
    tables: &Tables<'s>,
    commits: &Commits<'s>,
    index: u32,
) -> Task<'s> {
    let mut task = begin(session, &tables.types, index);
    let view = commits.view(3);
    task.see_commits(view, false, 1 << 2 | 1 << 3 | 1 << 5 | 1 << 6);
    task
}

/// Permission to store the result of a computation that begins now.
fn from_now(task: &Task) -> Stored {
    Stored::since(task.held_back())
}

/// The commit `number` of `task`. Returns how many entries it has stored.
fn commit<'s>(tables: &Tables<'s>, commits: &Commits<'s>, task: &Task<'s>, number: u32) -> u64 {
    let mut log = task.buffer().take_log();
    let stored = commits.store(&tables.all(), task, &mut log, number, None);
    task.view().unwrap().has_committed(number);
    task.write_at_once_again();
    stored
}

fn next_statement(task: &Task) {
    task.view().unwrap().forget();
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_commit_stores_every_kind_of_entry_and_the_task_keeps_its_own() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let mut first = begin_committing(&session, &tables, &commits, 0);
    first.begin_file(A, true);
    let second = begin_committing(&session, &tables, &commits, 1);
    tables.by_node.insert(&first, (A, 1), STRING, stored());
    tables.by_node.insert(&first, (B, 2), NUMBER, stored());
    tables.set.insert(&first, (A, 3), (), stored());
    tables.by_id.insert(&first, STRING, NUMBER, stored());
    let (shape, _) = (tables.shapes).insert_ref(&first, STRING, Box::new([NUMBER]), stored());
    // The value is where every task can read it. Only the handle waits.
    assert!(shape.local_number().is_none());
    (tables.kept_by_node).insert_ref(&first, (A, 4), Box::new([STRING]), stored());
    let holder = Holder { shape, of: NUMBER };
    tables.members.insert(&first, STRING, holder, stored());
    (tables.by_key).insert(&first, (STRING, NUMBER), STRING, stored());
    assert_eq!(tables.by_node.get(&second, &(A, 1)), None);
    assert_eq!(tables.by_id.get(&second, &STRING), None);
    assert_eq!(tables.shapes.get_ref(&second, &STRING), None);
    assert_eq!(tables.by_key.get(&second, &(STRING, NUMBER)), None);
    assert_eq!(commit(&tables, &commits, &first, 1), 8);
    for task in [&first, &second] {
        next_statement(task);
        assert_eq!(tables.by_node.get(task, &(A, 1)), Some(STRING));
        assert_eq!(tables.by_node.get(task, &(B, 2)), Some(NUMBER));
        assert_eq!(tables.set.get(task, &(A, 3)), Some(()));
        assert_eq!(tables.set.get(task, &(A, 2)), None);
        assert_eq!(tables.by_id.get(task, &STRING), Some(NUMBER));
        assert_eq!(tables.shapes.handle(task, &STRING), Some(shape));
        assert_eq!(tables.shapes.at(task, shape)[..], [NUMBER]);
        let kept = tables.kept_by_node.get_ref(task, &(A, 4));
        assert_eq!(kept.map(|it| &it[..]), Some(&[STRING][..]));
        assert_eq!(tables.members.get(task, &STRING), Some(holder));
        assert_eq!(tables.by_key.get(task, &(STRING, NUMBER)), Some(STRING));
    }
    assert_eq!(first.buffer().logged(), 0);
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_file_that_a_task_has_looked_at_stays_as_it_was_until_the_next_statement() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let first = begin_committing(&session, &tables, &commits, 0);
    let second = begin_committing(&session, &tables, &commits, 1);
    // A miss is a look.
    assert_eq!(tables.by_node.get(&second, &(A, 1)), None);
    for key in [(A, 1), (A, 2), (B, 1)] {
        tables.by_node.insert(&first, key, STRING, stored());
    }
    tables.by_id.insert(&first, STRING, NUMBER, stored());
    assert_eq!(commit(&tables, &commits, &first, 1), 4);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), None);
    assert_eq!(tables.by_node.get(&second, &(A, 2)), None);
    assert_eq!(tables.by_node.get(&second, &(B, 1)), Some(STRING));
    assert_eq!(tables.by_id.get(&second, &STRING), Some(NUMBER));
    next_statement(&second);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), Some(STRING));
    assert_eq!(tables.by_node.get(&second, &(A, 2)), Some(STRING));
}

#[test]
#[cfg_attr(miri, ignore)]
fn the_file_that_a_task_visits_stays_as_it_was_when_the_visit_began() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let first = begin_committing(&session, &tables, &commits, 0);
    let mut second = begin_committing(&session, &tables, &commits, 1);
    second.begin_file(A, true);
    tables.by_node.insert(&first, (A, 1), STRING, stored());
    assert_eq!(commit(&tables, &commits, &first, 1), 1);
    next_statement(&second);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), None);
    // It computes its own entry, which loses.
    let kept = tables.by_node.insert(&second, (A, 1), NUMBER, stored());
    assert_eq!(kept, NUMBER);
    assert_eq!(commit(&tables, &commits, &second, 2), 0);
    assert_eq!(tables.by_node.commit_of((A, 1)), Some(1));
    assert_eq!(tables.by_node.commit_of((A, 2)), None);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), Some(NUMBER));
    second.begin_file(B, true);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), Some(STRING));
}

#[test]
#[cfg_attr(miri, ignore)]
fn an_entry_that_a_task_stored_before_it_saw_another_one_loses() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let first = begin_committing(&session, &tables, &commits, 0);
    let mut second = begin_committing(&session, &tables, &commits, 1);
    second.begin_file(B, true);
    assert_eq!(
        tables.by_node.insert(&second, (A, 1), NUMBER, stored()),
        NUMBER
    );
    assert_eq!(
        tables.by_node.insert(&second, (A, 2), NUMBER, stored()),
        NUMBER
    );
    tables.by_node.insert(&first, (A, 1), STRING, stored());
    assert_eq!(commit(&tables, &commits, &first, 1), 1);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), Some(NUMBER));
    // The row has what the task sees now, and what it has stored where it sees nothing.
    second.begin_file(A, true);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), Some(STRING));
    assert_eq!(tables.by_node.get(&second, &(A, 2)), Some(NUMBER));
    assert_eq!(
        tables.by_node.insert(&second, (A, 1), NUMBER, stored()),
        STRING
    );
    assert_eq!(commit(&tables, &commits, &second, 2), 1);
    assert_eq!(tables.by_node.commit_of((A, 1)), Some(1));
    assert_eq!(tables.by_node.commit_of((A, 2)), Some(2));
    second.begin_file(B, true);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), Some(STRING));
    assert_eq!(tables.by_node.get(&second, &(A, 2)), Some(NUMBER));
}

#[test]
#[cfg_attr(miri, ignore)]
fn what_is_stored_about_an_expression_of_the_visited_file_stays_in_the_task() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let bases = Bases::new_in([10, 10, 10].into_iter(), &Global);
    let mut table = ByNode::<Node, TypeId, Buffered<OfExpressions<0>>>::new_in(&bases, Global);
    table.set_slot(numbered(0));
    let mut task = begin_writing_at_once(&session, &tables, &commits, 0);
    task.begin_file(A, true);
    table.insert(&task, (A, 1), STRING, stored());
    table.rewrite(&task, (A, 1), NUMBER, stored());
    assert_eq!((task.buffer().logged(), task.held_back()), (0, 0));
    // On the way to the type of a declaration of another file.
    table.insert(&task, (B, 1), STRING, stored());
    assert_eq!((task.buffer().logged(), task.held_back()), (1, 1));
    let mut log = task.buffer().take_log();
    assert_eq!(commits.store(&[&table], &task, &mut log, 1, None), 1);
    let mut other = begin_committing(&session, &tables, &commits, 1);
    assert_eq!(table.get(&other, &(A, 1)), None);
    assert_eq!(table.get(&other, &(B, 1)), Some(STRING));
    other.begin_file(B, true);
    assert_eq!(table.get(&other, &(B, 1)), Some(STRING));
    assert_eq!(table.get(&task, &(A, 1)), Some(NUMBER));
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_commit_stores_nothing_that_is_bound() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let mut task = begin_committing(&session, &tables, &commits, 0);
    task.begin_file(C, false);
    let bound = tables.this_of(&task, C);
    // Not even logged.
    tables.by_node.insert(&task, (C, 1), STRING, stored());
    assert_eq!(task.buffer().logged(), 0);
    tables.by_node.insert(&task, (A, 1), bound, stored());
    tables.by_id.insert(&task, STRING, bound, stored());
    let (shape, _) = (tables.shapes).insert_ref(&task, STRING, Box::new([bound]), stored());
    assert!(shape.local_number().is_some());
    // Nothing in it is bound but the handle.
    let holder = Holder { shape, of: NUMBER };
    tables.members.insert(&task, NUMBER, holder, stored());
    (tables.by_key).insert(&task, (STRING, STRING), bound, stored());
    assert_eq!(task.buffer().logged(), 5);
    assert_eq!(commit(&tables, &commits, &task, 1), 0);
    let other = begin_committing(&session, &tables, &commits, 1);
    assert_eq!(tables.by_node.get(&other, &(A, 1)), None);
    assert_eq!(tables.by_id.get(&other, &STRING), None);
    assert_eq!(tables.shapes.handle(&other, &STRING), None);
    assert_eq!(tables.members.get(&other, &NUMBER), None);
    assert_eq!(tables.by_key.get(&other, &(STRING, STRING)), None);
    assert_eq!(tables.members.get(&task, &NUMBER), Some(holder));
}

#[test]
#[cfg_attr(miri, ignore)]
fn what_is_keyed_by_a_record_is_logged_in_the_order_in_which_it_was_stored() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_committing(&session, &tables, &commits, 0);
    (tables.by_key).insert(&task, (STRING, STRING), STRING, stored());
    tables.by_id.insert(&task, STRING, NUMBER, stored());
    tables.by_node.insert(&task, (A, 1), STRING, stored());
    (tables.by_key).insert(&task, (NUMBER, STRING), STRING, stored());
    (tables.shapes).insert_ref(&task, NUMBER, Box::new([STRING]), stored());
    let log = task.buffer().take_log();
    let of_records = [[6, 0], [2, STRING.0], [6, 1], [3, NUMBER.0]];
    assert_eq!(log.of_records, of_records);
    assert_eq!(log.of_nodes, [[0, A.0, 1]]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_commit_stores_what_a_key_has_by_then_and_the_first_entry_stays() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_committing(&session, &tables, &commits, 0);
    tables.by_id.insert(&task, STRING, NUMBER, stored());
    tables.by_id.rewrite(&task, STRING, STRING, stored());
    (tables.by_key).insert(&task, (STRING, STRING), NUMBER, stored());
    (tables.by_key).rewrite(&task, (STRING, STRING), STRING, stored());
    assert_eq!(commit(&tables, &commits, &task, 1), 2);
    let other = begin_committing(&session, &tables, &commits, 1);
    assert_eq!(tables.by_id.get(&other, &STRING), Some(STRING));
    assert_eq!(tables.by_key.get(&other, &(STRING, STRING)), Some(STRING));
    assert_eq!(
        tables.by_id.insert(&other, STRING, NUMBER, stored()),
        STRING
    );
    tables.by_id.rewrite(&other, STRING, NUMBER, stored());
    assert_eq!(commit(&tables, &commits, &other, 2), 0);
    assert_eq!(tables.by_id.get(&task, &STRING), Some(STRING));
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_task_sees_all_that_a_commit_stores_under_the_nodes_of_a_file_or_nothing_of_it() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    std::thread::scope(|scope| {
        scope.spawn(|| {
            let writer = begin_committing(&session, &tables, &commits, 0);
            for i in 0..50 {
                for at in [i, 99 - i] {
                    tables.by_node.insert(&writer, (A, at), STRING, stored());
                }
                assert_eq!(commit(&tables, &commits, &writer, i + 1), 2);
            }
        });
        for index in 1..3 {
            let (session, tables, commits) = (&session, &tables, &commits);
            scope.spawn(move || {
                let reader = begin_committing(session, tables, commits, index);
                let mut seen = 0;
                while seen < 50 {
                    next_statement(&reader);
                    let is_there = |at: u32| tables.by_node.get(&reader, &(A, at)).is_some();
                    // The later ones first: a commit that ends in between would show.
                    let pairs = (0..50).rev().map(|i| (is_there(99 - i), is_there(i)));
                    let pairs: Vec<(bool, bool)> = pairs.collect();
                    assert!(pairs.iter().all(|pair| pair.0 == pair.1));
                    seen = pairs.iter().filter(|pair| pair.0).count();
                }
            });
        }
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn an_entry_is_written_at_once_if_nothing_was_held_back_since_its_computation_began() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_writing_at_once(&session, &tables, &commits, 0);
    let other = begin_writing_at_once(&session, &tables, &commits, 1);
    let outer = from_now(&task);
    tables.by_id.insert(&task, STRING, NUMBER, from_now(&task));
    (tables.by_key).insert(&task, (STRING, STRING), NUMBER, from_now(&task));
    let (shape, _) = (tables.shapes).insert_ref(&task, STRING, Box::new([NUMBER]), outer);
    let holder = Holder { shape, of: NUMBER };
    tables.members.insert(&task, STRING, holder, outer);
    assert_eq!(task.buffer().logged(), 0);
    assert_eq!(tables.by_id.get(&other, &STRING), Some(NUMBER));
    assert_eq!(tables.by_key.get(&other, &(STRING, STRING)), Some(NUMBER));
    assert_eq!(tables.shapes.handle(&other, &STRING), Some(shape));
    assert_eq!(tables.members.get(&other, &STRING), Some(holder));
    // What is keyed by a node waits, and so does whatever was in progress when it was stored.
    (tables.by_node).insert(&task, (A, 1), STRING, from_now(&task));
    tables.by_id.insert(&task, NUMBER, STRING, outer);
    (tables.by_key).insert(&task, (NUMBER, NUMBER), STRING, outer);
    assert_eq!(task.buffer().logged(), 3);
    assert_eq!(tables.by_id.get(&other, &NUMBER), None);
    assert_eq!(tables.by_key.get(&other, &(NUMBER, NUMBER)), None);
    assert_eq!(tables.by_id.get(&task, &NUMBER), Some(STRING));
    // What begins afterwards does not.
    (tables.by_id).insert(&task, TypeId::BOOLEAN, STRING, from_now(&task));
    assert_eq!(tables.by_id.get(&other, &TypeId::BOOLEAN), Some(STRING));
    // Nobody knows when this began.
    tables.by_id.insert(&task, TypeId::ANY, STRING, stored());
    assert_eq!(tables.by_id.get(&other, &TypeId::ANY), None);
    assert_eq!(commit(&tables, &commits, &task, 1), 4);
    assert_eq!(tables.by_id.get(&other, &TypeId::ANY), Some(STRING));
}

#[test]
#[cfg_attr(miri, ignore)]
fn the_first_of_two_entries_written_immediately_is_kept() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let first = begin_writing_at_once(&session, &tables, &commits, 0);
    let second = begin_writing_at_once(&session, &tables, &commits, 1);
    (tables.by_id).rewrite(&first, STRING, NUMBER, from_now(&first));
    (tables.by_key).rewrite(&first, (STRING, STRING), NUMBER, from_now(&first));
    (tables.shapes).insert_ref(&first, STRING, Box::new([NUMBER]), from_now(&first));
    // The same again.
    let kept = (tables.by_id).rewrite(&second, STRING, NUMBER, from_now(&second));
    assert_eq!(kept, NUMBER);
    // `rewrite` looks no further than the task's own part, as for a key that `get` has not found.
    (tables.by_id).rewrite(&second, STRING, STRING, from_now(&second));
    let spread = crate::util::spread_hash(&(STRING, STRING));
    let key = (STRING, STRING);
    let kept = (tables.by_key).insert_absent(&second, spread, key, STRING, from_now(&second));
    assert_eq!(kept, NUMBER);
    for task in [&first, &second] {
        assert_eq!(tables.by_id.get(task, &STRING), Some(NUMBER));
        assert_eq!(tables.by_key.get(task, &(STRING, STRING)), Some(NUMBER));
    }
    assert_eq!(second.buffer().logged(), 0);
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_task_that_has_stopped_writes_at_once_again_after_its_next_commit() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_writing_at_once(&session, &tables, &commits, 0);
    let other = begin_writing_at_once(&session, &tables, &commits, 1);
    task.stop_writing_at_once();
    assert!(!task.writes_at_once());
    tables.by_id.insert(&task, STRING, NUMBER, from_now(&task));
    assert_eq!(tables.by_id.get(&other, &STRING), None);
    assert_eq!(commit(&tables, &commits, &task, 1), 1);
    assert_eq!(tables.by_id.get(&other, &STRING), Some(NUMBER));
    tables.by_id.insert(&task, NUMBER, NUMBER, from_now(&task));
    assert_eq!(tables.by_id.get(&other, &NUMBER), Some(NUMBER));
    // Not if it is lost.
    task.lose("a test");
    assert_eq!(commit(&tables, &commits, &task, 2), 0);
    assert!(!task.writes_at_once() && !task.shares_what_it_stores());
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_task_that_hit_a_limit_is_not_rechecked_early() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_writing_at_once(&session, &tables, &commits, 0);
    assert!(!task.can_recheck_early());
    task.discard_until_recheck("a test");
    assert!(task.is_lost() && task.can_recheck_early());
    // A limit that it hits later doesn't matter: it was already discarded.
    task.lose("a limit");
    assert!(task.can_recheck_early());
    let other = begin_writing_at_once(&session, &tables, &commits, 1);
    other.lose("a limit");
    other.discard_until_recheck("a test");
    assert!(!other.can_recheck_early());
}

#[test]
#[cfg_attr(miri, ignore)]
fn what_a_task_holds_back_under_a_key_is_what_it_goes_by() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_writing_at_once(&session, &tables, &commits, 0);
    let other = begin_writing_at_once(&session, &tables, &commits, 1);
    tables.by_id.insert(&task, STRING, NUMBER, stored());
    (tables.by_key).insert(&task, (STRING, STRING), NUMBER, stored());
    let kept = tables.by_id.insert(&task, STRING, STRING, from_now(&task));
    assert_eq!(kept, NUMBER);
    let kept = (tables.by_key).insert(&task, (STRING, STRING), STRING, from_now(&task));
    assert_eq!(kept, NUMBER);
    assert_eq!(tables.by_id.get(&other, &STRING), None);
    assert_eq!(tables.by_key.get(&other, &(STRING, STRING)), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn nothing_that_is_bound_is_written_at_once() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let mut task = begin_writing_at_once(&session, &tables, &commits, 0);
    task.begin_file(C, false);
    let other = begin_writing_at_once(&session, &tables, &commits, 1);
    let bound = tables.this_of(&task, C);
    let outer = from_now(&task);
    tables.by_id.insert(&task, STRING, bound, from_now(&task));
    (tables.by_key).insert(&task, (STRING, STRING), bound, from_now(&task));
    let (shape, _) = (tables.shapes).insert_ref(&task, STRING, Box::new([bound]), outer);
    assert!(shape.local_number().is_some());
    assert_eq!(tables.by_id.get(&other, &STRING), None);
    assert_eq!(tables.by_key.get(&other, &(STRING, STRING)), None);
    assert_eq!(tables.shapes.handle(&other, &STRING), None);
    // No other task could find those, so nothing waits for them.
    tables.by_id.insert(&task, NUMBER, STRING, outer);
    assert_eq!(tables.by_id.get(&other, &NUMBER), Some(STRING));
}

#[test]
#[cfg_attr(miri, ignore)]
fn what_a_task_finds_out_about_a_record_of_a_file_that_it_visits_stays_in_the_task() {
    let session = Session::new();
    let (mut tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    tables.types.share_records();
    let begin_publishing = |index: u32| {
        let mut task = begin_writing_at_once(&session, &tables, &commits, index);
        task.own.set_sharing(crate::types::Sharing::Publishes);
        task
    };
    let (mut task, other) = (begin_publishing(0), begin_publishing(1));
    task.begin_file(A, true);
    let of_file = tables.this_of(&task, A);
    let made_of_it = tables.keyof(&task, of_file);
    assert!(!of_file.is_local() && !made_of_it.is_local());
    let outer = from_now(&task);
    tables.by_id.insert(&task, of_file, NUMBER, from_now(&task));
    (tables.by_key).insert(&task, (made_of_it, NUMBER), NUMBER, from_now(&task));
    let (shape, _) = (tables.shapes).insert_ref(&task, made_of_it, Box::new([NUMBER]), outer);
    assert!(shape.local_number().is_some());
    assert_eq!(tables.by_id.get(&task, &of_file), Some(NUMBER));
    assert_eq!(
        tables.by_key.get(&task, &(made_of_it, NUMBER)),
        Some(NUMBER)
    );
    assert_eq!(tables.shapes.handle(&task, &made_of_it), Some(shape));
    assert_eq!(tables.by_id.get(&other, &of_file), None);
    assert_eq!(tables.by_key.get(&other, &(made_of_it, NUMBER)), None);
    assert_eq!(tables.shapes.handle(&other, &made_of_it), None);
    // No commit stores them, and nothing waits for them.
    assert_eq!(task.buffer().logged(), 0);
    assert!(!task.has_held_back_since(outer));
    // What mentions no file of the task is for all.
    let of_no_file = tables.keyof(&task, STRING);
    tables
        .by_id
        .insert(&task, of_no_file, NUMBER, from_now(&task));
    assert_eq!(tables.by_id.get(&other, &of_no_file), Some(NUMBER));
    // A task that does not visit the file shares what it finds out.
    assert_eq!(tables.this_of(&other, A), of_file);
    tables
        .by_id
        .insert(&other, of_file, NUMBER, from_now(&other));
    assert_eq!(
        tables.by_id.get(&begin_publishing(2), &of_file),
        Some(NUMBER)
    );
}
