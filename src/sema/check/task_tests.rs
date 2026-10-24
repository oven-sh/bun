//! Tests for `Task`, its buffer, commits and immediate writes, and the underlying containers.
//!
//! Miri needs half a minute to build a `TypeStore`, so it runs only a few of the tests that have one. It also skips
//! the tests that insert thousands of entries.

use super::*;
use crate::atom::Interner;
use crate::bind::SymbolId;
use crate::check::commit::Commits;
use crate::local::{HashIndex, Hashed, LOCAL, MaybeLocal, SlotNumber, spread_word};
use crate::program::Sym;
use crate::session::Session;
use crate::table::{
    At, Bases, Buffered, ById, ByIdIndirect, ByKey, ByNode, ByNodeIndirect, Cell as _, FileLocal,
    Handle, Id as _, OfExpressions,
};
use crate::types::{
    ElemFlags, List, MapperId, OriginKey, Provenance, ProvenanceKey, Sharing, ShortList,
    TypeArguments, TypeData, TypeId, TypeKey, TypeStore, Types, UnionOrigin,
};
use crate::util::{ShardedMap, WindowedMap, shard_among, spread_in_window};
use bun_sema_standalone as _;
use std::alloc::Global;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

type Node = (FileId, u32);

fn numbered(number: u32) -> SlotNumber {
    // SAFETY: each test gives every one of its tables a different number.
    unsafe { SlotNumber::new(number) }
}

/// A value that holds a handle into another table, like `CachedMembers`.
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

/// One table of each kind, and the type store their ids belong to.
struct Tables<'s> {
    types: TypeStore<'s>,
    by_node: ByNode<Node, TypeId, Buffered, &'s Session>,
    set: ByNode<Node, (), Buffered, &'s Session>,
    by_id: ById<TypeId, TypeId, Buffered, &'s Session>,
    shapes: ByIdIndirect<TypeId, Box<[TypeId]>, Buffered, &'s Session>,
    indirect_by_node: ByNodeIndirect<Node, Box<[TypeId]>, Buffered, &'s Session>,
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
            indirect_by_node: ByNodeIndirect::new_in(&bases, session),
            members: ByIdIndirect::new_in(session),
            by_key: ByKey::new_in(session),
        };
        tables.by_node.set_slot(numbered(0));
        tables.set.set_slot(numbered(1));
        tables.by_id.set_slot(numbered(2));
        tables.shapes.set_slot(numbered(3));
        tables.indirect_by_node.set_slot(numbered(4));
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
            &self.indirect_by_node,
            &self.members,
            &self.by_key,
        ]
    }

    /// Returns `keyof of`, which isn't in any store initially.
    fn keyof(&self, task: &Task<'s>, of: TypeId) -> TypeId {
        Types::new(&self.types, &task.own).intern(TypeData::Keyof(of))
    }

    /// Returns the `this` type of a class in `file`, which is a type that references `file`.
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
fn insert_keeps_existing_entry_and_rewrite_replaces_it() {
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
    let (first, in_table) = (tables.shapes).insert_ref(&task, own, Box::new([one]), stored());
    assert_eq!(**in_table, [one]);
    let (second, in_table) = (tables.shapes).insert_ref(&task, own, Box::new([two]), stored());
    assert_eq!((second, &**in_table), (first, &[one][..]));
    // `u32::MAX` isn't a node, so nothing is stored.
    tables.by_node.insert(&task, (A, u32::MAX), one, stored());
    assert_eq!(tables.by_node.get(&task, &(A, u32::MAX)), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn unplanned_task_drops_its_writes() {
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

/// A chunk of files that nothing imports. No node of a file is evaluated before the task reaches the file, and the
/// entries can still be looked up afterwards.
#[test]
#[cfg_attr(miri, ignore)]
fn task_visits_unimported_files() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let mut task = begin(&session, &tables.types, 0);
    for file in [A, B, C] {
        task.begin_file(file, false);
        // A hashed entry before each file's first node-keyed entry, so hashed and node-keyed entries alternate.
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
            let in_table = tables
                .by_node
                .insert(&task, (file, node), TypeId::ANY, stored());
            assert_eq!(in_table, TypeId(node));
        }
    }
    // The task visits a file a second time.
    task.begin_file(A, false);
    assert_eq!(tables.by_node.get(&task, &(A, 1)), Some(TypeId(1)));
    tables.by_node.insert(&task, (A, 5), TypeId::ANY, stored());
    assert_eq!(tables.by_node.get(&task, &(A, 1)), Some(TypeId(1)));
    let in_table = tables.by_node.insert(&task, (A, 1), TypeId::ANY, stored());
    assert_eq!(in_table, TypeId(1));
}

#[test]
#[cfg_attr(miri, ignore)]
fn reference_to_stored_value_survives_later_inserts() {
    let session = Session::new();
    let tables = Tables::new(&session);
    let task = begin(&session, &tables.types, 0);
    let first = tables.keyof(&task, TypeId::STRING);
    let (handle, in_table) = (tables.shapes).insert_ref(&task, first, Box::new([first]), stored());
    assert!(handle.is_local());
    let mut of = first;
    for _ in 0..5000 {
        of = tables.keyof(&task, of);
        tables.shapes.insert(&task, of, Box::new([of]), stored());
    }
    assert_eq!(**in_table, [first]);
    assert!(std::ptr::eq(in_table, tables.shapes.at(&task, handle)));
    assert_eq!(tables.shapes.handle(&task, &first), Some(handle));
}

#[test]
#[cfg_attr(miri, ignore)]
fn permission_detects_hold_back_since_computation_began() {
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

// ───────────────────────────── rows and pages ─────────────────────────────

#[test]
#[should_panic]
fn table_with_fixed_slot_rejects_another_slot() {
    let mut table = ById::<TypeId, TypeId, Buffered<At<3>>>::default();
    table.set_slot(numbered(4));
}

// ───────────────────────────── bit storage ─────────────────────────────

#[test]
fn shared_cell_fields_keep_first_value() {
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
fn one_and_two_bit_file_local_values_share_a_word() {
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
    // Nodes of the task's file use dense words. Nodes of other files use sparse ones.
    for file in [FileId(3), FileId(4)] {
        for index in [0, 1, 31, 32, 63, 64, 1000] {
            assert_eq!(set.get(&task, &(file, index)), None);
            assert_eq!(flags.get(&task, &(file, index)), None);
        }
        set.insert(&task, (file, 63), ());
        set.insert(&task, (file, 1000), ());
        assert!(flags.insert(&task, (file, 31), true));
        assert!(!flags.insert(&task, (file, 32), false));
        // `insert` keeps the existing value, `rewrite` replaces it.
        assert!(flags.insert(&task, (file, 31), false));
        flags.rewrite(&task, (file, 32), true);
        let in_set = [62, 63, 64, 999, 1000, 1001].map(|index| set.get(&task, &(file, index)));
        assert_eq!(in_set, [None, Some(()), None, None, Some(()), None]);
        let known = [30, 31, 32, 33].map(|index| flags.get(&task, &(file, index)));
        assert_eq!(known, [None, Some(true), Some(true), None]);
    }
    // `u32::MAX` isn't a node, so nothing is stored.
    set.insert(&task, (FileId(3), u32::MAX), ());
    assert_eq!(set.get(&task, &(FileId(3), u32::MAX)), None);
    // The entries are dropped at the end of the file.
    task.begin_file(FileId(4), true);
    assert_eq!(set.get(&task, &(FileId(4), 63)), None);
    assert_eq!(set.get(&task, &(FileId(3), 63)), None);
}

/// `TypeKey` is hashed and compared like the equivalent `TypeData`.
#[test]
fn borrowed_key_finds_type_interned_with_owned_lists() {
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
    // A record stores a list of up to 2, 3 or 7 items inline.
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
        // Interns the owned form first for even lengths and the borrowed form first for odd ones.
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
    // Borrowed first, then owned, with an alias and an origin.
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
    // Neither in key order nor in hash order.
    let keys: Vec<u64> = (0..1000u64).map(|i| i.wrapping_mul(7919) % 1009).collect();
    for (position, &key) in keys.iter().enumerate() {
        assert_eq!(
            *hashed.insert(spread_word(key), key, position as u32),
            position as u32
        );
    }
    // `insert` doesn't overwrite. `replace` does, and the entry keeps its position.
    assert_eq!(*hashed.insert(spread_word(keys[5]), keys[5], 77), 5);
    hashed.replace(spread_word(keys[6]), keys[6], 77);
    assert_eq!(hashed.index_of(spread_word(keys[6]), &keys[6]), Some(6));
    assert_eq!(hashed.get(spread_word(5000), &5000), None);
    assert_eq!(hashed.len(), 1000);
    for (position, &key) in keys.iter().enumerate() {
        let expected = if position == 6 { 77 } else { position as u32 };
        assert_eq!(hashed.entry(position as u32), Some(&(key, expected)));
    }
    assert_eq!(hashed.entry(1000), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn stale_vacancy_does_not_overwrite_an_entry() {
    let is = |number: u32| move |found: u32| found == number;
    // A vacancy in a table that has no slots yet.
    let found = HashIndex::default();
    assert_eq!(found.find(7, |_| true), None);
    let Err(vacancy) = found.find_or_vacancy(7, |_| true) else {
        unreachable!()
    };
    found.fill(vacancy, 7, 1);
    assert_eq!(found.find_or_vacancy(7, is(1)).ok(), Some(1));
    // Two searches for the same hash end at the same slot, and only the first entry gets it.
    let vacancies = [0; 2].map(|_| found.find_or_vacancy(9, |_| false).unwrap_err());
    found.fill(vacancies[0], 9, 2);
    found.fill(vacancies[1], 9, 3);
    assert_eq!(found.find(9, is(2)), Some(2));
    assert_eq!(found.find(9, is(3)), Some(3));
    // A stale vacancy: the table grows several times before it's filled.
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
fn entries_survive_table_growth() {
    // The first table has 256 slots.
    for count in [1, 191, 192, 193, 384, 385] {
        let mut found = HashIndex::default();
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
fn shard_is_top_bits_of_hash() {
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
fn nodes_of_many_files_rarely_collide() {
    let mut tags = crate::util::FxHashSet::default();
    for file in 0..512u64 {
        for index in 0..512u64 {
            tags.insert(spread_word(file << 32 | index) as u32);
        }
    }
    // A few of the 2^18 tags collide by chance in a space of 2^32. About 8 collisions are expected.
    assert!(tags.len() > (1 << 18) - 64);
}

#[test]
fn threads_fill_and_read_a_sharded_map() {
    // About 75 keys in each of four shards, so a shard's table is replaced three times while other threads read it.
    let map = ShardedMap::<u32, Box<u32>, Global, 4>::default();
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
fn threads_fill_and_read_a_windowed_map() {
    // Miri needs four minutes for 3,000 keys.
    const KEYS: u32 = if cfg!(miri) { 200 } else { 3000 };
    // With a step of 37 a window has two keys, so the threads keep adding windows. With a step of 3 it has 21 or 22, so
    // its table is replaced twice while other threads read it.
    for step in [37, 3] {
        let map = WindowedMap::<(TypeId, TypeId), u32>::new_in(Global);
        let key_of = |i: u32| (TypeId(i * step), TypeId(i % 5));
        on_threads(4, &|thread| {
            for i in 0..KEYS {
                let i = (i * 7 + thread as u32) % KEYS;
                let key = key_of(i);
                map.add_if_absent(spread_in_window(&key), &key, i);
                assert_eq!(map.get_acquire(spread_in_window(&key), &key), Some(&i));
                let other = key_of((i + 11) % KEYS);
                if let Some(value) = map.get_acquire(spread_in_window(&other), &other) {
                    assert_eq!(*value, (i + 11) % KEYS);
                }
            }
        });
        assert_eq!(map.entries(), KEYS as usize);
        for i in 0..KEYS {
            let key = key_of(i);
            assert_eq!(map.get_frozen(spread_in_window(&key), &key), Some(&i));
        }
        let absent = (TypeId(1), TypeId(1));
        assert_eq!(map.get_frozen(spread_in_window(&absent), &absent), None);
    }
}

#[test]
fn local_is_bit_30() {
    assert_eq!(LOCAL, 1 << 30);
    assert!(TypeId(LOCAL).is_local() && !TypeId(LOCAL - 1).is_local());
    assert!((TypeId::ANY, TypeId(LOCAL | 5)).is_local());
}

// ───────────────────────────── commits ─────────────────────────────

const STRING: TypeId = TypeId::STRING;
const NUMBER: TypeId = TypeId::NUMBER;

/// Returns a task that commits while it runs and writes nothing immediately.
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

/// Like `begin_committing`, but the task writes immediately to the tables of `Tables` that are keyed by a record.
fn begin_writing_immediately<'s>(
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

/// Returns permission to store the result of a computation that begins now.
fn from_now(task: &Task) -> Stored {
    Stored::since(task.held_back())
}

/// Runs commit `number` for `task`. Returns the number of entries it stored.
fn commit<'s>(tables: &Tables<'s>, commits: &Commits<'s>, task: &Task<'s>, number: u32) -> u64 {
    let mut log = task.buffer().take_log();
    let stored = commits.store(&tables.all(), task, &mut log, number, None);
    task.view().unwrap().has_committed(number);
    task.resume_writing_immediately();
    stored
}

fn next_statement(task: &Task) {
    task.view().unwrap().forget();
}

#[test]
fn commit_publishes_every_kind_of_entry() {
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
    // The value is already where every task can read it. Only the handle waits for the commit.
    assert!(shape.local_number().is_none());
    (tables.indirect_by_node).insert_ref(&first, (A, 4), Box::new([STRING]), stored());
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
        let in_table = tables.indirect_by_node.get_ref(task, &(A, 4));
        assert_eq!(in_table.map(|it| &it[..]), Some(&[STRING][..]));
        assert_eq!(tables.members.get(task, &STRING), Some(holder));
        assert_eq!(tables.by_key.get(task, &(STRING, NUMBER)), Some(STRING));
    }
    assert_eq!(first.buffer().logged(), 0);
}

#[test]
fn begin_drops_earlier_entries() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let mut task = begin_committing(&session, &tables, &commits, 0);
    task.begin_file(A, true);
    tables.by_node.insert(&task, (A, 1), STRING, stored());
    tables.by_node.insert(&task, (B, 2), NUMBER, stored());
    tables.set.insert(&task, (A, 3), (), stored());
    tables.by_id.insert(&task, STRING, NUMBER, stored());
    (tables.shapes).insert_ref(&task, STRING, Box::new([NUMBER]), stored());
    (tables.indirect_by_node).insert_ref(&task, (A, 4), Box::new([STRING]), stored());
    (tables.by_key).insert(&task, (STRING, NUMBER), STRING, stored());
    assert_ne!(task.buffer().logged(), 0);
    // Nothing was committed, so a new task finds nothing.
    task.begin(0, 1);
    task.see_commits(commits.view(3), false, 0);
    task.begin_file(A, true);
    assert_eq!(task.buffer().logged(), 0);
    assert_eq!(tables.by_node.get(&task, &(A, 1)), None);
    assert_eq!(tables.by_node.get(&task, &(B, 2)), None);
    assert_eq!(tables.set.get(&task, &(A, 3)), None);
    assert_eq!(tables.by_id.get(&task, &STRING), None);
    assert_eq!(tables.shapes.get_ref(&task, &STRING), None);
    assert_eq!(tables.indirect_by_node.get_ref(&task, &(A, 4)), None);
    assert_eq!(tables.by_key.get(&task, &(STRING, NUMBER)), None);
}

/// True if `task` is in the state that `Task::new_in` returns. The pattern lists every field, so adding a field without
/// checking it here is a compile error.
fn is_like_new(task: &mut Task) -> bool {
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
    } = task;
    round_and_index.is_none()
        && file.is_none()
        && uncommitted_files.is_empty()
        && diagnostics.is_empty()
        && !*closed_a_cycle
        && order_dependent_variances.is_empty()
        && held_back.get() == 0
        && view.is_none()
        && !was_discarded.get()
        && !*is_trusted
        && !can_recheck_early.get()
        && !is_first_in_order.get()
        && !is_first_in_component.get()
        && cycle_members.get_mut().is_empty()
        && cycle_since_idle.get().is_none()
        && logged_at_cycles.borrow().is_empty()
        && logged_when_idle.get() == [0; 2]
        && immediate_tables.get() == 0
        && *immediate_tables_after_commit == 0
        && diagnostics_logged_before_stop.get() == usize::MAX
        && own.is_like_new()
        && buffer.get_mut().is_like_new()
        && file_local.get_mut().is_like_new()
}

/// Applies `change` to a new task, checks that the task no longer looks new, ends it, and checks that it looks new
/// again.
fn ends_like_new<'s>(
    tables: &Tables<'s>,
    session: &'s Session,
    change: impl FnOnce(&mut Task<'s>),
) {
    let mut task = Task::new_in(session.arena(), &tables.types);
    assert!(is_like_new(&mut task));
    change(&mut task);
    assert!(!is_like_new(&mut task));
    tables.types.reclaim_ids(&task.own);
    task.drop_everything();
    assert!(is_like_new(&mut task));
}

#[test]
#[cfg_attr(miri, ignore)]
fn ended_task_is_like_new() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let check = |change: &dyn Fn(&mut Task<'_>)| ends_like_new(&tables, &session, change);
    let sym = Sym {
        file: A,
        id: SymbolId(7),
    };
    check(&|task| task.round_and_index = Some((0, 1)));
    check(&|task| task.file = Some(A));
    check(&|task| task.uncommitted_files.push(A));
    check(&|task| {
        let reported = Reported::bare((A, 0, 0), 2322);
        task.diagnostics.push((None, reported));
    });
    check(&|task| task.closed_a_cycle = true);
    check(&|task| {
        task.order_dependent_variances.push(OrderDependent {
            sym,
            variances: &[],
            compared: 0,
            failed: 0,
            void_targets: 0,
            inferred: 0,
        });
    });
    check(&|task| task.hold_back());
    ends_like_new(&tables, &session, |task| {
        task.view = Some(commits.view(3));
    });
    check(&|task| task.was_discarded.set(true));
    check(&|task| task.is_trusted = true);
    check(&|task| task.can_recheck_early.set(true));
    check(&|task| task.set_first_in_order(true, false));
    check(&|task| task.set_first_in_order(false, true));
    check(&|task| task.cycle_members.get_mut().push(1));
    check(&|task| task.cycle_since_idle.set(Some([0; 2])));
    check(&|task| task.logged_at_cycles.borrow_mut().push([[0; 2]; 2]));
    check(&|task| task.logged_when_idle.set([0, 1]));
    check(&|task| task.immediate_tables.set(1));
    check(&|task| task.immediate_tables_after_commit = 1);
    check(&|task| task.diagnostics_logged_before_stop.set(0));
    // The task's own records.
    check(&|task| task.own.add_visited_file(A));
    check(&|task| task.own.add_unimported_file(A));
    check(&|task| task.own.set_sharing(Sharing::Publishes));
    // The task-local parts of the tables.
    check(&|task| task.buffer().begin_log());
    check(&|task| task.buffer().begin_file(A.0, false));
    check(&|task| task.file_local().begin_file(A.0));
}

#[test]
#[cfg_attr(miri, ignore)]
fn ended_task_has_no_records_or_entries() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let mut flags = ByNode::<Node, bool, FileLocal>::new_in(&Bases::none_in(&Global), Global);
    flags.set_slot(numbered(0));
    // A task-local record.
    ends_like_new(&tables, &session, |task| {
        assert!(tables.keyof(task, STRING).is_local());
    });
    // A record the task publishes under one of its reserved ids.
    ends_like_new(&tables, &session, |task| {
        task.own.set_sharing(Sharing::Publishes);
        assert!(!tables.keyof(task, NUMBER).is_local());
    });
    // A record bound to a file that nothing imports.
    ends_like_new(&tables, &session, |task| {
        task.own.set_sharing(Sharing::Publishes);
        task.begin_file(C, false);
        assert!(tables.this_of(task, C).is_local());
    });
    // One entry of each kind at a time: in a row, in a page, under an id, an indirect value, under a key.
    type Store<'a, 's> = &'a dyn Fn(&Task<'s>);
    let stores: [Store; 8] = [
        &|task| _ = tables.by_node.insert(task, (A, 1), STRING, stored()),
        &|task| _ = tables.by_node.insert(task, (B, 2), NUMBER, stored()),
        &|task| tables.set.insert(task, (A, 3), (), stored()),
        &|task| _ = tables.by_id.insert(task, STRING, NUMBER, stored()),
        &|task| _ = (tables.shapes).insert_ref(task, STRING, Box::new([NUMBER]), stored()),
        &|task| {
            _ = (tables.indirect_by_node).insert_ref(task, (A, 4), Box::new([STRING]), stored())
        },
        &|task| _ = (tables.by_key).insert(task, (STRING, NUMBER), STRING, stored()),
        &|task| _ = flags.insert(task, (B, 5), true),
    ];
    for store in stores {
        ends_like_new(&tables, &session, |task| {
            task.begin(0, 0);
            task.see_commits(commits.view(3), false, 0);
            task.begin_file(A, true);
            store(task);
        });
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn file_snapshot_lasts_until_next_statement() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let first = begin_committing(&session, &tables, &commits, 0);
    let second = begin_committing(&session, &tables, &commits, 1);
    // A miss takes the file's snapshot too.
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
fn visited_file_snapshot_lasts_for_the_visit() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let first = begin_committing(&session, &tables, &commits, 0);
    let mut second = begin_committing(&session, &tables, &commits, 1);
    second.begin_file(A, true);
    tables.by_node.insert(&first, (A, 1), STRING, stored());
    assert_eq!(commit(&tables, &commits, &first, 1), 1);
    next_statement(&second);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), None);
    // It computes its own entry, which loses to the committed one.
    let in_table = tables.by_node.insert(&second, (A, 1), NUMBER, stored());
    assert_eq!(in_table, NUMBER);
    assert_eq!(commit(&tables, &commits, &second, 2), 0);
    assert_eq!(tables.by_node.commit_of((A, 1)), Some(1));
    assert_eq!(tables.by_node.commit_of((A, 2)), None);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), Some(NUMBER));
    second.begin_file(B, true);
    assert_eq!(tables.by_node.get(&second, &(A, 1)), Some(STRING));
}

#[test]
#[cfg_attr(miri, ignore)]
fn own_entry_loses_to_earlier_commit() {
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
    // The row now has the committed entries the task can see, and the task's own entries where there are none.
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
fn expression_entries_of_visited_file_stay_local() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let bases = Bases::new_in([10, 10, 10].into_iter(), &Global);
    let mut table = ByNode::<Node, TypeId, Buffered<OfExpressions<0>>>::new_in(&bases, Global);
    table.set_slot(numbered(0));
    let mut task = begin_writing_immediately(&session, &tables, &commits, 0);
    task.begin_file(A, true);
    table.insert(&task, (A, 1), STRING, stored());
    table.rewrite(&task, (A, 1), NUMBER, stored());
    assert_eq!((task.buffer().logged(), task.held_back()), (0, 0));
    // An expression of another file, evaluated to get the type of a declaration there.
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
fn commit_skips_bound_entries() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let mut task = begin_committing(&session, &tables, &commits, 0);
    task.begin_file(C, false);
    let bound = tables.this_of(&task, C);
    // An entry under a node of an unimported file isn't even logged.
    tables.by_node.insert(&task, (C, 1), STRING, stored());
    assert_eq!(task.buffer().logged(), 0);
    tables.by_node.insert(&task, (A, 1), bound, stored());
    tables.by_id.insert(&task, STRING, bound, stored());
    let (shape, _) = (tables.shapes).insert_ref(&task, STRING, Box::new([bound]), stored());
    assert!(shape.local_number().is_some());
    // Only the handle in it is bound.
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
fn record_keys_are_logged_in_store_order() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_committing(&session, &tables, &commits, 0);
    (tables.by_key).insert(&task, (STRING, STRING), STRING, stored());
    tables.by_id.insert(&task, STRING, NUMBER, stored());
    tables.by_node.insert(&task, (A, 1), STRING, stored());
    (tables.by_key).insert(&task, (NUMBER, STRING), STRING, stored());
    (tables.shapes).insert_ref(&task, NUMBER, Box::new([STRING]), stored());
    let log = task.buffer().take_log();
    let record_keys = [[6, 0], [2, STRING.0], [6, 1], [3, NUMBER.0]];
    assert_eq!(log.record_keys, record_keys);
    assert_eq!(log.node_keys, [[0, A.0, 1]]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn commit_publishes_latest_value_and_first_commit_wins() {
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
fn node_entries_of_a_commit_appear_atomically() {
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
                    let is_stored = |at: u32| tables.by_node.get(&reader, &(A, at)).is_some();
                    // Later entries first, so a commit that finishes during the scan would be noticed.
                    let pairs = (0..50).rev().map(|i| (is_stored(99 - i), is_stored(i)));
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
fn entry_is_written_immediately_unless_held_back_since_computation_began() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_writing_immediately(&session, &tables, &commits, 0);
    let other = begin_writing_immediately(&session, &tables, &commits, 1);
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
    // An entry keyed by a node waits for the commit, and so does every computation that was in progress when it was
    // stored.
    (tables.by_node).insert(&task, (A, 1), STRING, from_now(&task));
    tables.by_id.insert(&task, NUMBER, STRING, outer);
    (tables.by_key).insert(&task, (NUMBER, NUMBER), STRING, outer);
    assert_eq!(task.buffer().logged(), 3);
    assert_eq!(tables.by_id.get(&other, &NUMBER), None);
    assert_eq!(tables.by_key.get(&other, &(NUMBER, NUMBER)), None);
    assert_eq!(tables.by_id.get(&task, &NUMBER), Some(STRING));
    // A computation that begins afterwards doesn't wait.
    (tables.by_id).insert(&task, TypeId::BOOLEAN, STRING, from_now(&task));
    assert_eq!(tables.by_id.get(&other, &TypeId::BOOLEAN), Some(STRING));
    // This computation's start is unknown, so its result waits.
    tables.by_id.insert(&task, TypeId::ANY, STRING, stored());
    assert_eq!(tables.by_id.get(&other, &TypeId::ANY), None);
    assert_eq!(commit(&tables, &commits, &task, 1), 4);
    assert_eq!(tables.by_id.get(&other, &TypeId::ANY), Some(STRING));
}

#[test]
#[cfg_attr(miri, ignore)]
fn first_immediate_write_wins() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let first = begin_writing_immediately(&session, &tables, &commits, 0);
    let second = begin_writing_immediately(&session, &tables, &commits, 1);
    (tables.by_id).rewrite(&first, STRING, NUMBER, from_now(&first));
    (tables.by_key).rewrite(&first, (STRING, STRING), NUMBER, from_now(&first));
    (tables.shapes).insert_ref(&first, STRING, Box::new([NUMBER]), from_now(&first));
    // The second task stores the same value.
    let in_table = (tables.by_id).rewrite(&second, STRING, NUMBER, from_now(&second));
    assert_eq!(in_table, NUMBER);
    // `rewrite` only looks in the task's own part, as it does for a key that `get` didn't find.
    (tables.by_id).rewrite(&second, STRING, STRING, from_now(&second));
    let spread = spread_in_window(&(STRING, STRING));
    let key = (STRING, STRING);
    let in_table = (tables.by_key).insert_absent(&second, spread, key, STRING, from_now(&second));
    assert_eq!(in_table, NUMBER);
    for task in [&first, &second] {
        assert_eq!(tables.by_id.get(task, &STRING), Some(NUMBER));
        assert_eq!(tables.by_key.get(task, &(STRING, STRING)), Some(NUMBER));
    }
    assert_eq!(second.buffer().logged(), 0);
}

#[test]
#[cfg_attr(miri, ignore)]
fn immediate_writes_resume_after_next_commit() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_writing_immediately(&session, &tables, &commits, 0);
    let other = begin_writing_immediately(&session, &tables, &commits, 1);
    task.stop_writing_immediately();
    assert!(!task.writes_immediately());
    tables.by_id.insert(&task, STRING, NUMBER, from_now(&task));
    assert_eq!(tables.by_id.get(&other, &STRING), None);
    assert_eq!(commit(&tables, &commits, &task, 1), 1);
    assert_eq!(tables.by_id.get(&other, &STRING), Some(NUMBER));
    tables.by_id.insert(&task, NUMBER, NUMBER, from_now(&task));
    assert_eq!(tables.by_id.get(&other, &NUMBER), Some(NUMBER));
    // A discarded task doesn't resume.
    task.discard();
    assert_eq!(commit(&tables, &commits, &task, 2), 0);
    assert!(!task.writes_immediately() && !task.shares_what_it_stores());
}

#[test]
#[cfg_attr(miri, ignore)]
fn task_that_hit_a_limit_is_not_rechecked_early() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_writing_immediately(&session, &tables, &commits, 0);
    assert!(!task.can_recheck_early());
    task.discard_until_recheck();
    assert!(task.was_discarded() && task.can_recheck_early());
    // Hitting a limit later doesn't matter, because the task was already discarded.
    task.discard();
    assert!(task.can_recheck_early());
    let other = begin_writing_immediately(&session, &tables, &commits, 1);
    other.discard();
    other.discard_until_recheck();
    assert!(!other.can_recheck_early());
}

#[test]
#[cfg_attr(miri, ignore)]
fn commit_lists_log_ranges_from_each_cycle_to_next_idle_moment() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let mut task = begin_committing(&session, &tables, &commits, 0);
    task.set_first_in_order(true, true);
    let resolve_a_cycle = |task: &Task| task.close_cycle(|| false, std::iter::once(1));
    // Before the first cycle.
    tables.by_id.insert(&task, STRING, NUMBER, stored());
    assert!(!task.has_resolved_a_cycle());
    resolve_a_cycle(&task);
    assert!(task.has_resolved_a_cycle());
    tables.by_id.insert(&task, NUMBER, NUMBER, stored());
    // A second cycle in the same statement doesn't start another part.
    resolve_a_cycle(&task);
    tables.by_node.insert(&task, (A, 1), STRING, stored());
    task.note_idle();
    // A statement without a cycle.
    tables.by_node.insert(&task, (A, 2), STRING, stored());
    task.note_idle();
    assert!(task.has_resolved_a_cycle());
    // The commit follows this cycle without an idle moment in between.
    resolve_a_cycle(&task);
    tables.by_node.insert(&task, (A, 3), STRING, stored());
    assert_eq!(
        task.take_logged_at_cycles(),
        [[[1, 0], [2, 1]], [[2, 2], [2, 3]]]
    );
    assert!(!task.has_resolved_a_cycle());
    assert_eq!(task.take_logged_at_cycles(), [[[0; 2]; 2]; 0]);
    // `begin` forgets the resolved cycles.
    resolve_a_cycle(&task);
    task.note_idle();
    resolve_a_cycle(&task);
    task.begin(0, 1);
    assert!(!task.has_resolved_a_cycle());
}

#[test]
#[cfg_attr(miri, ignore)]
fn held_back_entry_wins_over_later_immediate_write() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let task = begin_writing_immediately(&session, &tables, &commits, 0);
    let other = begin_writing_immediately(&session, &tables, &commits, 1);
    tables.by_id.insert(&task, STRING, NUMBER, stored());
    (tables.by_key).insert(&task, (STRING, STRING), NUMBER, stored());
    let in_table = tables.by_id.insert(&task, STRING, STRING, from_now(&task));
    assert_eq!(in_table, NUMBER);
    let in_table = (tables.by_key).insert(&task, (STRING, STRING), STRING, from_now(&task));
    assert_eq!(in_table, NUMBER);
    assert_eq!(tables.by_id.get(&other, &STRING), None);
    assert_eq!(tables.by_key.get(&other, &(STRING, STRING)), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn bound_entries_are_not_written_immediately() {
    let session = Session::new();
    let (tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    let mut task = begin_writing_immediately(&session, &tables, &commits, 0);
    task.begin_file(C, false);
    let other = begin_writing_immediately(&session, &tables, &commits, 1);
    let bound = tables.this_of(&task, C);
    let outer = from_now(&task);
    tables.by_id.insert(&task, STRING, bound, from_now(&task));
    (tables.by_key).insert(&task, (STRING, STRING), bound, from_now(&task));
    let (shape, _) = (tables.shapes).insert_ref(&task, STRING, Box::new([bound]), outer);
    assert!(shape.local_number().is_some());
    assert_eq!(tables.by_id.get(&other, &STRING), None);
    assert_eq!(tables.by_key.get(&other, &(STRING, STRING)), None);
    assert_eq!(tables.shapes.handle(&other, &STRING), None);
    // No other task could hit those entries, so they don't defer anything.
    tables.by_id.insert(&task, NUMBER, STRING, outer);
    assert_eq!(tables.by_id.get(&other, &NUMBER), Some(STRING));
}

#[test]
#[cfg_attr(miri, ignore)]
fn entries_about_records_of_visited_file_stay_local() {
    let session = Session::new();
    let (mut tables, commits) = (Tables::new(&session), Commits::new_in(session.arena()));
    tables.types.share_records();
    let begin_publishing = |index: u32| {
        let mut task = begin_writing_immediately(&session, &tables, &commits, index);
        task.own.set_sharing(crate::types::Sharing::Publishes);
        task
    };
    let (mut task, other) = (begin_publishing(0), begin_publishing(1));
    task.begin_file(A, true);
    let file_type = tables.this_of(&task, A);
    let derived_type = tables.keyof(&task, file_type);
    assert!(!file_type.is_local() && !derived_type.is_local());
    let outer = from_now(&task);
    tables
        .by_id
        .insert(&task, file_type, NUMBER, from_now(&task));
    (tables.by_key).insert(&task, (derived_type, NUMBER), NUMBER, from_now(&task));
    let (shape, _) = (tables.shapes).insert_ref(&task, derived_type, Box::new([NUMBER]), outer);
    assert!(shape.local_number().is_some());
    assert_eq!(tables.by_id.get(&task, &file_type), Some(NUMBER));
    assert_eq!(
        tables.by_key.get(&task, &(derived_type, NUMBER)),
        Some(NUMBER)
    );
    assert_eq!(tables.shapes.handle(&task, &derived_type), Some(shape));
    assert_eq!(tables.by_id.get(&other, &file_type), None);
    assert_eq!(tables.by_key.get(&other, &(derived_type, NUMBER)), None);
    assert_eq!(tables.shapes.handle(&other, &derived_type), None);
    // No commit stores them, and they don't defer anything.
    assert_eq!(task.buffer().logged(), 0);
    assert!(!task.has_held_back_since(outer));
    // An entry that doesn't mention any of the task's files is published.
    let unrelated_type = tables.keyof(&task, STRING);
    tables
        .by_id
        .insert(&task, unrelated_type, NUMBER, from_now(&task));
    assert_eq!(tables.by_id.get(&other, &unrelated_type), Some(NUMBER));
    // A task that isn't visiting the file publishes its results about the file's records.
    assert_eq!(tables.this_of(&other, A), file_type);
    tables
        .by_id
        .insert(&other, file_type, NUMBER, from_now(&other));
    assert_eq!(
        tables.by_id.get(&begin_publishing(2), &file_type),
        Some(NUMBER)
    );
}
