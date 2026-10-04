//! Tables indexed by a dense id.
//!
//! Nodes and symbols are numbered within their file, and types in creation order, so a result
//! computed for one needs no hashing: it is stored in an array. A cell starts as zero, meaning "not
//! computed", and is written once. A read is one load.
//!
//! The memory comes zero-filled from the allocator, which for arrays of this size means from the
//! operating system: a page that is never touched is never resident.
//!
//! The third type parameter of a table determines who writes an entry and when it becomes visible
//! to whom: `Frozen`, `Buffered`, `FileLocal`. See `Policy`.

use crate::atom::{Atom, Intern};
use crate::check::task::{Stored, Task};
use crate::local::{
    Buffer, Half, HashedInTask, InTask, LOCAL, ListInTask, MaybeLocal, Slot, SlotNumber, Typed,
    is_local_number, node_word,
};
use crate::program::{FileId, Sym};
use crate::session::Session;
use crate::types::{ComponentsId, Follow, Link, MapperId, Marks, OwnStore, SigId, TypeId, Visitor};
use crate::util::memory::{Cells, Zeroed};
use crate::util::{AppendVec, FxHasher, SHARDS, ShardedMap, shard_of, spread_hash};
use std::alloc::{Allocator, Global};
use std::hash::{Hash, Hasher};
use std::marker::PhantomData;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

/// The allocator of the shared part of a table: any thread may allocate. `&Session`, or `Global`.
pub trait Alloc: Allocator + Clone + Send + Sync {
    /// A list of numbers in its memory that several tables hold.
    type Shared: std::ops::Deref<Target = [u32]> + Clone + Send + Sync;
    fn share(&self, list: &[u32]) -> Self::Shared;
}

impl Alloc for Global {
    type Shared = Arc<[u32]>;
    fn share(&self, list: &[u32]) -> Arc<[u32]> {
        list.into()
    }
}

/// Nothing frees it before the session ends, so nothing counts who holds it.
impl<'s> Alloc for &'s Session {
    type Shared = &'s [u32];
    fn share(&self, list: &[u32]) -> &'s [u32] {
        let session: &'s Session = *self;
        session.arena().alloc_slice_copy(list)
    }
}

/// An atomic integer.
pub trait Cell: Zeroed + Sync + Send {
    type Raw: Copy + PartialEq + Default;
    fn widen(raw: Self::Raw) -> u64;
    fn narrow(raw: u64) -> Self::Raw;
    /// A plain load. No cell is written while tasks run, and a barrier has ordered the earlier
    /// writes.
    fn load(&self) -> Self::Raw;
    /// Returns the value the cell holds afterwards: `raw`, or the value that was already there.
    fn put_if_empty(&self, raw: Self::Raw) -> Self::Raw;
    /// `put_if_empty` for the bit field `mask` that starts at bit `shift`. The other bits of the
    /// cell belong to other keys.
    fn put_field_if_empty(&self, shift: u32, mask: u64, raw: Self::Raw) -> Self::Raw;
}

macro_rules! cell {
    ($atomic:ty, $raw:ty) => {
        impl Cell for $atomic {
            type Raw = $raw;
            #[inline]
            fn widen(raw: $raw) -> u64 {
                u64::from(raw)
            }
            #[inline]
            fn narrow(raw: u64) -> $raw {
                raw as $raw
            }
            #[inline]
            fn load(&self) -> $raw {
                self.load(Ordering::Relaxed)
            }
            #[inline]
            fn put_if_empty(&self, raw: $raw) -> $raw {
                match self.compare_exchange(0, raw, Ordering::AcqRel, Ordering::Acquire) {
                    Ok(_) => raw,
                    Err(first) => first,
                }
            }
            #[inline]
            fn put_field_if_empty(&self, shift: u32, mask: u64, raw: $raw) -> $raw {
                let mut whole = self.load(Ordering::Acquire);
                loop {
                    let first = whole >> shift & mask as $raw;
                    if first != 0 {
                        return first;
                    }
                    let new = whole | raw << shift;
                    match self.compare_exchange_weak(
                        whole,
                        new,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    ) {
                        Ok(_) => return raw,
                        Err(now) => whole = now,
                    }
                }
            }
        }
    };
}
cell!(AtomicU32, u32);
cell!(AtomicU64, u64);

/// A value that fits in a cell. Its packed form is never zero.
pub trait Packed: Copy {
    type Cell: Cell;
    /// Bit width of a packed value, if the values of several keys share a cell. 0: each value has
    /// its own cell.
    const BITS: u32 = 0;
    fn pack(self) -> <Self::Cell as Cell>::Raw;
    fn unpack(raw: <Self::Cell as Cell>::Raw) -> Self;
}

impl Packed for bool {
    type Cell = AtomicU32;
    const BITS: u32 = 2;
    #[inline]
    fn pack(self) -> u32 {
        1 + u32::from(self)
    }
    #[inline]
    fn unpack(raw: u32) -> bool {
        raw == 2
    }
}

/// For a set: a table of `()`.
impl Packed for () {
    type Cell = AtomicU32;
    const BITS: u32 = 1;
    #[inline]
    fn pack(self) -> u32 {
        1
    }
    #[inline]
    fn unpack(_: u32) {}
}

impl Packed for u8 {
    type Cell = AtomicU32;
    #[inline]
    fn pack(self) -> u32 {
        1 + u32::from(self)
    }
    #[inline]
    fn unpack(raw: u32) -> u8 {
        (raw - 1) as u8
    }
}

impl Packed for (crate::types::TypeId, bool) {
    type Cell = AtomicU32;
    #[inline]
    fn pack(self) -> u32 {
        (self.0.0 + 1) << 1 | u32::from(self.1)
    }
    #[inline]
    fn unpack(raw: u32) -> Self {
        (crate::types::TypeId((raw >> 1) - 1), raw & 1 != 0)
    }
}

/// A dense id: an index counted from zero without significant gaps.
pub trait Id: Copy {
    fn number(self) -> u32;
    fn from_number(number: u32) -> Self;
    /// `Some`: the id is task-local, and this is its index among the task's ids.
    #[inline]
    fn local_number(self) -> Option<u32> {
        let number = self.number();
        is_local_number(number).then_some(number & !LOCAL)
    }
}

#[macro_export]
macro_rules! packed_ids {
    ($($id:ty),* $(,)?) => {$(
        impl $crate::table::Id for $id {
            #[inline]
            fn number(self) -> u32 {
                self.0
            }
            #[inline]
            fn from_number(number: u32) -> Self {
                Self(number)
            }
        }
        impl $crate::local::MaybeLocal for $id {
            #[inline]
            fn is_local(&self) -> bool {
                $crate::local::is_local_number(self.0)
            }
        }
        impl $crate::table::Packed for $id {
            type Cell = std::sync::atomic::AtomicU32;
            #[inline]
            fn pack(self) -> u32 {
                self.0 + 1
            }
            #[inline]
            fn unpack(raw: u32) -> Self {
                Self(raw - 1)
            }
        }
        impl $crate::table::Packed for Option<$id> {
            type Cell = std::sync::atomic::AtomicU32;
            #[inline]
            fn pack(self) -> u32 {
                self.map_or(1, |id| id.0 + 2)
            }
            #[inline]
            fn unpack(raw: u32) -> Self {
                (raw != 1).then(|| Self::Some(<$id as $crate::table::Id>::from_number(raw - 2))).flatten()
            }
        }
    )*};
}
/// Files and nodes are numbered before the first step. For `ByKey` keys that contain one alongside
/// an id.
impl MaybeLocal for FileId {
    #[inline]
    fn is_local(&self) -> bool {
        false
    }
}

impl MaybeLocal for crate::hir::TypeNodeId {
    #[inline]
    fn is_local(&self) -> bool {
        false
    }
}

impl Packed for Option<Sym> {
    type Cell = AtomicU64;
    #[inline]
    fn pack(self) -> u64 {
        self.map_or(1, |sym| {
            (u64::from(sym.file.0) << 32 | u64::from(sym.id.0)) + 2
        })
    }
    #[inline]
    fn unpack(raw: u64) -> Self {
        (raw != 1).then(|| Sym {
            file: FileId(((raw - 2) >> 32) as u32),
            id: crate::bind::SymbolId((raw - 2) as u32),
        })
    }
}

// ───────────────────────────── by node ─────────────────────────────

/// For each file, the start index of its nodes of one kind when the nodes of all files are
/// concatenated. A final entry is the end index.
pub struct Bases<A: Alloc = Global>(A::Shared);

impl<A: Alloc> Clone for Bases<A> {
    fn clone(&self) -> Self {
        Bases(self.0.clone())
    }
}

impl<A: Alloc> Bases<A> {
    pub fn new_in(lengths: impl Iterator<Item = usize>, alloc: &A) -> Self {
        let mut total = 0usize;
        let mut bases = vec![0u32];
        for len in lengths {
            total += len;
            bases.push(u32::try_from(total).expect("more nodes of a kind than fit 32 bits"));
        }
        Bases(alloc.share(&bases))
    }

    /// No file has a node.
    pub(crate) fn none_in(alloc: &A) -> Self {
        Bases(alloc.share(&[0]))
    }

    #[inline]
    fn total(&self) -> usize {
        *self.0.last().unwrap() as usize
    }

    /// `None`: there is no such node. Callers occasionally pass `NONE`.
    #[inline]
    fn at(&self, file: FileId, index: u32) -> Option<usize> {
        // The higher index is read first: if it is in bounds so is the lower one, which is then not
        // bounds-checked.
        let (end, start) = (self.0[file.idx() + 1], self.0[file.idx()]);
        (index < end - start).then(|| (start + index) as usize)
    }
}

/// A node or a symbol: a file and an index within it.
pub trait NodeKey: Copy {
    fn file(self) -> FileId;
    fn index(self) -> u32;
}

impl<I: Copy + Into<u32>> NodeKey for (FileId, I) {
    #[inline]
    fn file(self) -> FileId {
        self.0
    }
    #[inline]
    fn index(self) -> u32 {
        self.1.into()
    }
}

impl NodeKey for Sym {
    #[inline]
    fn file(self) -> FileId {
        self.file
    }
    #[inline]
    fn index(self) -> u32 {
        self.id.0
    }
}

// ───────────────────────────── policies ─────────────────────────────

/// Determines who writes an entry of a table and when it becomes visible to whom.
pub trait Policy {
    const IS_FILE_LOCAL: bool = false;
}

/// Written before the first step or at a barrier. Read-only while tasks run, so `get` is plain
/// loads. For the tables of the loader, the merge step and the type store. Several threads of a
/// merge step can fill one concurrently: a cell is written with a compare-and-swap, and the first
/// value wins. A barrier separates every read from a write by another thread.
pub struct Frozen;

/// The default for a field of `Program`. The table holds the shared part, which only `publish`
/// writes, at a barrier. A task's stores go to its task-local part (`crate::local::Half`), which no
/// other task sees. `Task::finish` passes it to the barrier.
pub struct Buffered;

/// The entries are task-local and are dropped when the task finishes the file it is visiting. No
/// other task ever sees one.
pub struct FileLocal;

impl Policy for Frozen {}
impl Policy for Buffered {}
impl Policy for FileLocal {
    const IS_FILE_LOCAL: bool = true;
}

/// The memory usage of a table, for `--timing`. Computing it reads every cell.
#[derive(Copy, Clone, Default, Debug)]
pub struct Footprint {
    /// Bytes requested from the allocator: cells, map entries, and stored values, excluding the
    /// memory they point to.
    pub allocated: usize,
    /// `allocated` without the pages of a cell array in which every cell is zero. Such a page of a zeroed allocation was never written, so
    /// it is not resident.
    pub touched: usize,
    /// Cells that are not zero, or map entries.
    pub entries: usize,
    /// Kept values.
    pub kept: usize,
}

impl Footprint {
    const PAGE: usize = 16 << 10;

    fn of_cells<C: Cell>(cells: &[C]) -> Footprint {
        let mut all = Footprint {
            allocated: size_of_val(cells),
            ..Footprint::default()
        };
        for page in cells.chunks(Footprint::PAGE / size_of::<C>()) {
            let entries = (page.iter().filter(|cell| cell.load() != Default::default())).count();
            all.entries += entries;
            all.touched += if entries != 0 { size_of_val(page) } else { 0 };
        }
        all
    }

    fn plus(self, other: Footprint) -> Footprint {
        Footprint {
            allocated: self.allocated + other.allocated,
            touched: self.touched + other.touched,
            entries: self.entries + other.entries,
            kept: self.kept + other.kept,
        }
    }

    fn with_indirect<T, A: Alloc>(self, kept: &AppendVec<T, A>) -> Footprint {
        let bytes = kept.len() as usize * size_of::<T>();
        Footprint {
            allocated: self.allocated + bytes,
            touched: self.touched + bytes,
            kept: kept.len() as usize,
            ..self
        }
    }
}

// ───────────────────────────── the tables ─────────────────────────────

/// No slot: `number_tables` has not assigned one yet. A `Frozen` table needs none.
const NO_SLOT: u32 = u32::MAX;

/// A value for each node of one kind in the program.
pub struct ByNode<K, V: Packed, P: Policy = Frozen, A: Alloc = Global> {
    bases: Bases<A>,
    /// Initially all zero.
    cells: Box<[V::Cell], A>,
    /// The index at which a task holds the task-local part of this table.
    slot: u32,
    key: PhantomData<fn(K, P)>,
}

impl<K: NodeKey, V: Packed, P: Policy, A: Alloc> ByNode<K, V, P, A> {
    /// How many keys share a cell.
    const PER_CELL: usize = if V::BITS != 0 {
        size_of::<V::Cell>() * 8 / V::BITS as usize
    } else {
        1
    };
    /// Mask for the bits of one key after they are shifted down.
    const MASK: u64 = if V::BITS != 0 {
        (1 << V::BITS) - 1
    } else {
        u64::MAX
    };

    pub fn new_in(bases: &Bases<A>, alloc: A) -> Self {
        let bases = if P::IS_FILE_LOCAL {
            Bases::none_in(&alloc)
        } else {
            bases.clone()
        };
        ByNode {
            cells: V::Cell::zeroed_slice_in(bases.total().div_ceil(Self::PER_CELL), alloc),
            bases,
            slot: NO_SLOT,
            key: PhantomData,
        }
    }

    pub(crate) fn set_slot(&mut self, slot: SlotNumber) {
        self.slot = slot.number();
    }

    /// The cell of the key at `at` in the concatenation of all keys, and the bit offset of the key
    /// within the cell.
    #[inline]
    fn field_at(&self, at: usize) -> (&V::Cell, u32) {
        let shift = (at % Self::PER_CELL) as u32 * V::BITS;
        (&self.cells[at / Self::PER_CELL], shift)
    }

    /// `None`: there is no such node.
    #[inline]
    fn field(&self, key: K) -> Option<(&V::Cell, u32)> {
        Some(self.field_at(self.bases.at(key.file(), key.index())?))
    }

    pub fn footprint(&self) -> Footprint {
        Footprint::of_cells(&self.cells)
    }
}

/// For a table whose owner defines the bit layout.
#[derive(Copy, Clone)]
pub struct RawWord(pub u32);

impl Packed for RawWord {
    type Cell = AtomicU32;
    #[inline]
    fn pack(self) -> u32 {
        self.0
    }
    #[inline]
    fn unpack(raw: u32) -> Self {
        RawWord(raw)
    }
}

impl<K: NodeKey, A: Alloc> ByNode<K, RawWord, Frozen, A> {
    #[inline]
    pub fn raw(&self, key: K) -> u32 {
        self.get(&key).map_or(0, |word| word.0)
    }
}

/// The index of a value in an indirect table. With `LOCAL`: in the task-local part. A handle is not
/// a value: it is not an id of the type store, and the merge of a task has no mapping for it. See
/// `ByIdIndirect::hold_handles_of`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Handle(pub u32);
packed_ids!(Handle);
crate::types::has_no_references!(Handle);

/// A value too large for a cell, for some of the nodes of one kind. It is stored out of line and
/// never moves.
pub struct ByNodeIndirect<K, T, P: Policy = Frozen, A: Alloc = Global> {
    handles: ByNode<K, Handle, P, A>,
    kept: AppendVec<T, A>,
    in_task: Slot<IndirectInTask<T>>,
}

impl<K: NodeKey, T, P: Policy, A: Alloc> ByNodeIndirect<K, T, P, A> {
    pub fn footprint(&self) -> Footprint {
        self.handles.footprint().with_indirect(&self.kept)
    }

    pub fn new_in(bases: &Bases<A>, alloc: A) -> Self {
        ByNodeIndirect {
            handles: ByNode::new_in(bases, alloc.clone()),
            kept: AppendVec::new_in(alloc),
            in_task: Slot::NONE,
        }
    }
}

impl<K: NodeKey, T, P: Policy, A: Alloc> ByNodeIndirect<K, T, P, A> {
    pub(crate) fn set_slot(&mut self, slot: SlotNumber) {
        self.in_task = slot.typed();
        self.handles.slot = self.in_task.number();
    }
}

/// A value for each id of a kind that is numbered in creation order.
pub struct ById<I, V: Packed, P: Policy = Frozen, A: Alloc = Global> {
    cells: Cells<V::Cell, A>,
    slot: u32,
    key: PhantomData<fn(I, P)>,
}

impl<I: Id, V: Packed, P: Policy, A: Alloc + Default> Default for ById<I, V, P, A> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<I: Id, V: Packed, P: Policy, A: Alloc> ById<I, V, P, A> {
    pub fn new_in(alloc: A) -> Self {
        ById {
            cells: Cells::new_in(alloc),
            slot: NO_SLOT,
            key: PhantomData,
        }
    }

    pub fn footprint(&self) -> Footprint {
        let chunks = self.cells.allocated().map(Footprint::of_cells);
        chunks.fold(Footprint::default(), Footprint::plus)
    }

    pub(crate) fn set_slot(&mut self, slot: SlotNumber) {
        self.slot = slot.number();
    }
}

/// A value too large for a cell, for some of the ids of a kind that is numbered in creation order.
pub struct ByIdIndirect<I, T, P: Policy = Frozen, A: Alloc = Global> {
    handles: ById<I, Handle, P, A>,
    kept: AppendVec<T, A>,
    in_task: Slot<IndirectInTask<T>>,
    holding: Holding<T>,
}

impl<I: Id, T, P: Policy, A: Alloc + Default> Default for ByIdIndirect<I, T, P, A> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<I: Id, T, P: Policy, A: Alloc> ByIdIndirect<I, T, P, A> {
    pub fn new_in(alloc: A) -> Self {
        ByIdIndirect {
            handles: ById::new_in(alloc.clone()),
            kept: AppendVec::new_in(alloc),
            in_task: Slot::NONE,
            holding: Holding::default(),
        }
    }
}

impl<I: Id, T, P: Policy, A: Alloc> ByIdIndirect<I, T, P, A> {
    pub fn footprint(&self) -> Footprint {
        self.handles.footprint().with_indirect(&self.kept)
    }

    pub(crate) fn set_slot(&mut self, slot: SlotNumber) {
        self.in_task = slot.typed();
        self.handles.slot = self.in_task.number();
    }
}

/// A memo table for keys that are more than a single id.
pub struct ByKey<K, V, P: Policy = Frozen, A: Alloc = Global> {
    published: ShardedMap<K, V, A>,
    slot: Slot<HashedInTask<K, V>>,
    policy: PhantomData<fn(P)>,
}

impl<K: std::hash::Hash + Eq, V, P: Policy, A: Alloc> ByKey<K, V, P, A> {
    pub fn new_in(alloc: A) -> Self {
        ByKey {
            published: ShardedMap::new_in(alloc),
            slot: Slot::NONE,
            policy: PhantomData,
        }
    }

    /// Excludes the index of the map, which takes a few bytes per entry.
    pub fn footprint(&self) -> Footprint {
        let entries = self.published.entries();
        let bytes = entries * size_of::<(K, V)>();
        Footprint {
            allocated: bytes,
            touched: bytes,
            entries,
            kept: 0,
        }
    }

    pub(crate) fn set_slot(&mut self, slot: SlotNumber) {
        self.slot = slot.typed();
    }
}

impl<K: std::hash::Hash + Eq, V, P: Policy, A: Alloc + Default> Default for ByKey<K, V, P, A> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

// ───────────────────────────── `Frozen` ─────────────────────────────

impl<K: NodeKey, V: Packed, A: Alloc> ByNode<K, V, Frozen, A> {
    #[inline]
    pub fn get(&self, key: &K) -> Option<V> {
        let (cell, shift) = self.field(*key)?;
        let raw = V::Cell::narrow(V::Cell::widen(cell.load()) >> shift & Self::MASK);
        (raw != Default::default()).then(|| V::unpack(raw))
    }

    /// Does not overwrite an existing value. Returns the stored value.
    #[inline]
    pub fn insert(&self, key: K, value: V) -> V {
        match self.field(key) {
            Some((cell, _)) if Self::PER_CELL == 1 => V::unpack(cell.put_if_empty(value.pack())),
            Some((cell, shift)) => {
                V::unpack(cell.put_field_if_empty(shift, Self::MASK, value.pack()))
            }
            None => value,
        }
    }
}

impl<K: NodeKey, T, A: Alloc> ByNodeIndirect<K, T, Frozen, A> {
    #[inline]
    pub fn get_ref(&self, key: &K) -> Option<&T> {
        self.handles.get(key).map(|handle| self.kept.get(handle.0))
    }

    /// Does not overwrite an existing value. Returns the stored value. The value is written before
    /// its handle is stored in a cell. If the cell already holds another handle, the new value is
    /// unreachable.
    pub fn insert_ref(&self, key: K, value: T) -> &T {
        let handle = Handle(self.kept.push(value));
        self.kept.get(self.handles.insert(key, handle).0)
    }

    #[inline]
    pub fn get(&self, key: &K) -> Option<T>
    where
        T: Clone,
    {
        self.get_ref(key).cloned()
    }

    pub fn insert(&self, key: K, value: T) -> T
    where
        T: Clone,
    {
        self.insert_ref(key, value).clone()
    }
}

impl<I: Id, V: Packed, A: Alloc> ById<I, V, Frozen, A> {
    /// `None` for an id with `LOCAL`: no entry is published for it.
    #[inline]
    pub fn get(&self, key: &I) -> Option<V> {
        let raw = self.cells.existing(key.number())?.load();
        (raw != Default::default()).then(|| V::unpack(raw))
    }

    /// Does not overwrite an existing value. Returns the stored value.
    #[inline]
    pub fn insert(&self, key: I, value: V) -> V {
        assert!(key.local_number().is_none());
        V::unpack(self.cells.cell(key.number()).put_if_empty(value.pack()))
    }
}

// ───────────────────────────── `Buffered`: during a step ─────────────────────────────
//
// `get`: a hit on a published entry is one plain load. The shared part is read-only during a step,
// and the barrier before the step has ordered the writes to it, so the load is relaxed. The
// task-local part is queried only if the cell is empty. An id with `LOCAL` has no shared cell: it
// is looked up in the dense task-local part.
// `insert`: stores into the task-local part. It does not overwrite an existing entry, published or
// not, and returns the stored value, which `get` returns from then on.
// `rewrite`: replaces the task-local entry. A published entry is unchanged.

impl<K: NodeKey, V: Packed<Cell = AtomicU32>, A: Alloc> ByNode<K, V, Buffered, A> {
    /// 0: nothing is published for the key at `at`.
    #[inline]
    fn published_at(&self, at: usize) -> u32 {
        let (cell, shift) = self.field_at(at);
        cell.load(Ordering::Relaxed) >> shift & Self::MASK as u32
    }

    /// 0: nothing is published for `key`. A node that `Bases` does not count has no cell, and nothing is ever published for it.
    #[inline]
    fn published(&self, key: K) -> u32 {
        (self.bases.at(key.file(), key.index())).map_or(0, |at| self.published_at(at))
    }

    #[inline]
    pub fn get(&self, task: &Task, key: &K) -> Option<V> {
        let mut raw = self.published(*key);
        if raw == 0 {
            raw = (task.buffer()).node(self.slot, key.file().0, key.index());
        }
        (raw != 0).then(|| V::unpack(raw))
    }

    #[inline]
    pub fn insert(&self, task: &Task, key: K, value: V, _: Stored) -> V {
        // Callers occasionally pass `NONE`.
        if key.index() == u32::MAX {
            return value;
        }
        let mut raw = self.published(key);
        if raw == 0 {
            let (file, index) = (key.file().0, key.index());
            raw = (task.buffer()).put_node_if_empty(self.slot, file, index, value.pack());
        }
        V::unpack(raw)
    }

    pub fn rewrite(&self, task: &Task, key: K, value: V, _: Stored) -> V {
        if key.index() != u32::MAX {
            (task.buffer()).store_node(self.slot, key.file().0, key.index(), value.pack());
        }
        value
    }
}

impl<I: Id, V: Packed<Cell = AtomicU32>, A: Alloc> ById<I, V, Buffered, A> {
    /// 0: nothing is published for the id `number`.
    #[inline]
    fn published(&self, number: u32) -> u32 {
        (self.cells.existing(number)).map_or(0, |cell| cell.load(Ordering::Relaxed))
    }

    #[inline]
    pub fn get(&self, task: &Task, key: &I) -> Option<V> {
        let raw = match key.local_number() {
            Some(number) => task.buffer().own_id(self.slot, number),
            None => match self.published(key.number()) {
                0 => task.buffer().published_id(self.slot, key.number()),
                raw => raw,
            },
        };
        (raw != 0).then(|| V::unpack(raw))
    }

    #[inline]
    pub fn insert(&self, task: &Task, key: I, value: V, _: Stored) -> V {
        let (slot, new) = (self.slot, value.pack());
        V::unpack(match key.local_number() {
            Some(number) => task.buffer().put_own_id_if_empty(slot, number, new),
            None => match self.published(key.number()) {
                0 => (task.buffer()).put_published_id_if_empty(slot, key.number(), new),
                raw => raw,
            },
        })
    }

    pub fn rewrite(&self, task: &Task, key: I, value: V, _: Stored) -> V {
        match key.local_number() {
            Some(number) => task.buffer().store_own_id(self.slot, number, value.pack()),
            None => (task.buffer()).store_published_id(self.slot, key.number(), value.pack()),
        }
        value
    }
}

/// The task-local values of an indirect table, each with its key in the encoding of the task-local
/// part, indexed by handle without `LOCAL`.
type IndirectInTask<T> = ListInTask<(u64, T)>;

/// The value `handle` refers to. The reference has the lifetime of the table. A reference to a
/// task-local value is valid only until the task ends (`Task::finish`, `Task::begin`, the drop):
/// any holder, for example a cache of the checker, must release it by then.
#[inline]
fn indirect_at<'p, 's, T: Send + 's, A: Alloc>(
    kept: &'p AppendVec<T, A>,
    slot: &Slot<IndirectInTask<T>>,
    task: &Task<'s>,
    handle: Handle,
) -> &'p T {
    match handle.local_number() {
        None => kept.get(handle.0),
        Some(number) => {
            let value = &task.buffer().typed(slot).unwrap().get(number).1;
            // SAFETY: an element of a `LocalVec` does not move, and lives until the task ends. See
            // above.
            unsafe { &*std::ptr::from_ref(value) }
        }
    }
}

fn store_in_task<'s, T: Send + 's>(
    slot: &Slot<IndirectInTask<T>>,
    task: &Task<'s>,
    key: u64,
    value: T,
) -> Handle {
    Handle(task.buffer().typed_or_new(slot).push((key, value)) | LOCAL)
}

impl<'s, K: NodeKey, T: Send + 's, A: Alloc> ByNodeIndirect<K, T, Buffered, A> {
    #[inline]
    pub fn get_ref(&self, task: &Task<'s>, key: &K) -> Option<&T> {
        let handle = self.handles.get(task, key)?;
        Some(indirect_at(&self.kept, &self.in_task, task, handle))
    }

    /// Does not overwrite an existing value. Returns the stored value.
    pub fn insert_ref(&self, task: &Task<'s>, key: K, value: T, stored: Stored) -> &T {
        let slot = &self.in_task;
        let handle = self.handles.get(task, &key).unwrap_or_else(|| {
            let word = node_word(key.file().0, key.index());
            (self.handles).insert(task, key, store_in_task(slot, task, word, value), stored)
        });
        indirect_at(&self.kept, slot, task, handle)
    }

    #[inline]
    pub fn get(&self, task: &Task<'s>, key: &K) -> Option<T>
    where
        T: Clone,
    {
        self.get_ref(task, key).cloned()
    }

    pub fn insert(&self, task: &Task<'s>, key: K, value: T, stored: Stored) -> T
    where
        T: Clone,
    {
        self.insert_ref(task, key, value, stored).clone()
    }
}

impl<'s, I: Id, T: Send + 's, A: Alloc> ByIdIndirect<I, T, Buffered, A> {
    #[inline]
    pub fn get_ref(&self, task: &Task<'s>, key: &I) -> Option<&T> {
        self.handles
            .get(task, key)
            .map(|handle| self.at(task, handle))
    }

    #[inline]
    pub fn handle(&self, task: &Task<'s>, key: &I) -> Option<Handle> {
        self.handles.get(task, key)
    }

    /// See `indirect_at` for how long the reference is valid.
    #[inline]
    pub fn at(&self, task: &Task<'s>, handle: Handle) -> &T {
        indirect_at(&self.kept, &self.in_task, task, handle)
    }

    /// Does not overwrite an existing value. Returns the stored value.
    pub fn insert_ref(&self, task: &Task<'s>, key: I, value: T, stored: Stored) -> (Handle, &T) {
        let handle = self.handles.get(task, &key).unwrap_or_else(|| {
            let kept = store_in_task(&self.in_task, task, u64::from(key.number()), value);
            self.handles.insert(task, key, kept, stored)
        });
        (handle, self.at(task, handle))
    }

    #[inline]
    pub fn get(&self, task: &Task<'s>, key: &I) -> Option<T>
    where
        T: Clone,
    {
        self.get_ref(task, key).cloned()
    }

    pub fn insert(&self, task: &Task<'s>, key: I, value: T, stored: Stored) -> T
    where
        T: Clone,
    {
        self.insert_ref(task, key, value, stored).1.clone()
    }

    /// The values of this table hold handles of `held`, in the field that `field` returns. So an
    /// entry of this table is passed to the barrier only if the entry of `held` is, and one thread
    /// applies `held` and then this table, and stores the winning handle into the field. `held`
    /// comes before this table in `buffered_fields!`. Call after `set_slot`.
    pub(crate) fn hold_handles_of<J: Id, U>(
        &mut self,
        held: &mut ByIdIndirect<J, U, Buffered, A>,
        field: fn(&mut T) -> &mut Handle,
    ) {
        assert!(held.handles.slot < self.handles.slot);
        held.holding.is_held = true;
        self.holding.holds = Some((held.handles.slot, field));
    }
}

impl<'s, K, V, A: Alloc> ByKey<K, V, Buffered, A>
where
    K: std::hash::Hash + Eq + MaybeLocal + Send + 's,
    V: Copy + Send + 's,
{
    /// `spread`: the hash of `key`.
    #[inline]
    fn published(&self, spread: u64, key: &K) -> Option<V> {
        if key.is_local() {
            return None;
        }
        self.published.get_frozen(spread, key).copied()
    }

    #[inline]
    pub fn get(&self, task: &Task<'s>, key: &K) -> Option<V> {
        let spread = spread_hash(key);
        if let Some(value) = self.published(spread, key) {
            return Some(value);
        }
        (task.buffer().typed(&self.slot)?.get(spread, key)).copied()
    }

    #[inline]
    pub fn insert(&self, task: &Task<'s>, key: K, value: V, _: Stored) -> V {
        let spread = spread_hash(&key);
        if let Some(value) = self.published(spread, &key) {
            return value;
        }
        *(task.buffer().typed_or_new(&self.slot)).insert(spread, key, value)
    }
}

// ───────────────────────────── `Buffered`: the end of a task, and the barrier ─────────────────────────────

/// The interface of a `Buffered` table used by `Task::finish` and `publish`.
pub(crate) trait Publish<'s>: Sync {
    fn slot(&self) -> u32;

    /// The slot of the table whose handles the values of this one hold.
    fn holds_handles_of(&self) -> Option<u32> {
        None
    }

    /// How many threads can apply entries concurrently.
    fn parts(&self) -> usize {
        1
    }

    /// Runs on the task's own thread. Drains the task-local part of the table. Returns the entries
    /// whose key and value are not bound, and marks the records they reference. The rest is
    /// dropped.
    fn finish(
        &self,
        buffer: &mut Buffer<'s>,
        finishing: &mut Finishing<'_, '_>,
    ) -> Option<Entries<'s>>;

    /// Runs at the barrier, on any thread. Remaps every key and value of one task through that
    /// task's `link`.
    fn follow(&self, entries: &mut Entries<'s>, link: &Link);

    /// Runs at the barrier, on the one thread that owns this part of the table. `shares`: in task
    /// order. The first entry for a key wins.
    /// `handles`, indexed by task: see `Holding`.
    fn apply(
        &self,
        part: usize,
        shares: &mut [Share<'_, 's>],
        handles: &mut [Vec<Handle>],
        applied: &mut Applied<'_>,
    );
}

/// The state `Task::finish` lends to the tables.
pub(crate) struct Finishing<'a, 's> {
    own: &'a OwnStore<'s>,
    marks: &'a mut Marks,
    /// For each table whose handles another table holds, keyed by slot: for each task-local handle,
    /// 1 + the index of its entry among the entries passed to the barrier. 0: the entry is dropped.
    held: Vec<(u32, Vec<u32>)>,
}

impl<'a, 's> Finishing<'a, 's> {
    pub(crate) fn new(own: &'a OwnStore<'s>, marks: &'a mut Marks) -> Finishing<'a, 's> {
        Finishing {
            own,
            marks,
            held: Vec::new(),
        }
    }

    /// Whether `key -> value` is passed to the barrier. If it is, the records it references are
    /// marked: the entries are the roots.
    #[inline]
    fn is_published(&mut self, key: &impl Follow, value: &impl Follow) -> bool {
        if key.is_bound(self.own) || value.is_bound(self.own) {
            return false;
        }
        key.mark(self.marks);
        value.mark(self.marks);
        true
    }
}

/// What a table with a `Slot<S>` passes to the barrier.
trait Handing: InTask {
    type Handed: Send + Sync;
}

impl<T: Send + Sync> Handing for IndirectInTask<T> {
    /// A key and a value, in insertion order.
    type Handed = Vec<(u32, T)>;
}

impl<K: Eq + Send + Sync, V: Send + Sync> Handing for HashedInTask<K, V> {
    type Handed = Keyed<K, V>;
}

/// The entries one task passes to the barrier for one table.
pub(crate) struct Entries<'s> {
    pub(crate) slot: u32,
    pub(crate) len: u32,
    handed: Handed<'s>,
}

enum Handed<'s> {
    /// Of a table whose values fit in a cell: a key and a packed value.
    Cells(Vec<(u32, u32)>),
    /// `S::Handed` of the table's `Slot<S>`.
    Typed(Box<dyn Typed + Send + Sync + 's>),
}

impl<'s> Entries<'s> {
    /// `None`: there are none.
    fn of_cells(slot: u32, cells: Vec<(u32, u32)>) -> Option<Entries<'s>> {
        (!cells.is_empty()).then(|| Entries {
            slot,
            len: cells.len() as u32,
            handed: Handed::Cells(cells),
        })
    }

    fn cells(&mut self) -> &mut Vec<(u32, u32)> {
        match &mut self.handed {
            Handed::Cells(cells) => cells,
            Handed::Typed(_) => unreachable!(),
        }
    }

    /// `None`: there are none.
    fn new<S: Handing>(slot: &Slot<S>, len: usize, handed: S::Handed) -> Option<Entries<'s>>
    where
        S::Handed: 's,
    {
        (len != 0).then(|| Entries {
            slot: slot.number(),
            len: len as u32,
            handed: Handed::Typed(Box::new(handed)),
        })
    }

    fn typed<S: Handing>(&self, slot: &Slot<S>) -> &S::Handed {
        assert!(self.slot == slot.number());
        let Handed::Typed(handed) = &self.handed else {
            unreachable!()
        };
        debug_assert_eq!((**handed).name(), std::any::type_name::<S::Handed>());
        // SAFETY: only `new` stores one, with the number of a `Slot`, and all slots with that number
        // have the type `S`: see `SlotNumber::new`.
        unsafe { &*std::ptr::from_ref(&**handed).cast::<S::Handed>() }
    }

    fn typed_mut<S: Handing>(&mut self, slot: &Slot<S>) -> &mut S::Handed {
        assert!(self.slot == slot.number());
        let Handed::Typed(handed) = &mut self.handed else {
            unreachable!()
        };
        debug_assert_eq!((**handed).name(), std::any::type_name::<S::Handed>());
        // SAFETY: as in `typed`.
        unsafe { &mut *std::ptr::from_mut(&mut **handed).cast::<S::Handed>() }
    }
}

pub(crate) enum Payload<'a, 's> {
    /// The table has one part.
    Whole(&'a mut Entries<'s>),
    /// Every part gets the same reference and reads only its own entries.
    Part(&'a Entries<'s>),
}

/// The entries of one task in a `Stage` of `publish`.
pub(crate) struct Share<'a, 's> {
    pub(crate) task: u32,
    pub(crate) len: u32,
    payload: Payload<'a, 's>,
}

impl<'a, 's> Share<'a, 's> {
    pub(crate) fn new(task: u32, len: u32, payload: Payload<'a, 's>) -> Share<'a, 's> {
        Share { task, len, payload }
    }

    fn whole(&mut self) -> &mut Entries<'s> {
        match &mut self.payload {
            Payload::Whole(entries) => entries,
            Payload::Part(_) => unreachable!(),
        }
    }
}

/// Summary of the entries one thread has applied.
pub(crate) struct Applied<'a> {
    pub(crate) published: u64,
    /// The sum of the hashes of (slot, key, value) of the stored entries, if requested.
    /// Deterministic for a given program: keys and values hold only published ids, which are
    /// assigned in (step, task, index) order, an atom is hashed as its text, and a sum does not
    /// depend on how the entries are partitioned among the threads.
    pub(crate) digest: u64,
    /// `Some`: the digest is requested.
    atoms: Option<&'a dyn Intern>,
}

impl<'a> Applied<'a> {
    pub(crate) fn new(atoms: Option<&'a dyn Intern>) -> Applied<'a> {
        Applied {
            published: 0,
            digest: 0,
            atoms,
        }
    }

    /// `key -> value` has been stored, or is about to be.
    #[inline]
    fn store(&mut self, slot: u32, key: &impl Follow, value: &impl Follow) {
        self.published += 1;
        if let Some(atoms) = self.atoms {
            self.add_to_digest(atoms, slot, key, value);
        }
    }

    #[cold]
    fn add_to_digest(
        &mut self,
        atoms: &dyn Intern,
        slot: u32,
        key: &impl Follow,
        value: &impl Follow,
    ) {
        let mut hash = HashOfEntry(FxHasher::default(), atoms);
        hash.0.write_u32(slot);
        key.visit(&mut hash);
        value.visit(&mut hash);
        // A sum of hashes with weak low bits is itself weak.
        let hash = hash.0.finish();
        self.digest =
            (self.digest).wrapping_add((hash ^ hash >> 32).wrapping_mul(0x9E37_79B9_7F4A_7C15));
    }
}

struct HashOfEntry<'a>(FxHasher, &'a dyn Intern);

impl Visitor for HashOfEntry<'_> {
    /// Hashes the text, not the id: the parser threads number the atoms in the order they encounter
    /// them, which differs between runs. Passing an atom, or a number derived from one, to `plain`
    /// makes the digest depend on timing.
    fn atom(&mut self, atom: Atom) {
        let text = if atom.is_none() {
            &[][..]
        } else {
            self.1.bytes(atom)
        };
        self.0.write_u64(6 << 32 | text.len() as u64);
        self.0.write(text);
    }
    fn components(&mut self, id: ComponentsId) {
        self.0.write_u64(1 << 32 | u64::from(id.0));
    }
    fn mapper(&mut self, id: MapperId) {
        self.0.write_u64(2 << 32 | u64::from(id.0));
    }
    fn sig(&mut self, id: SigId) {
        self.0.write_u64(3 << 32 | u64::from(id.0));
    }
    fn ty(&mut self, id: TypeId) {
        self.0.write_u64(4 << 32 | u64::from(id.0));
    }
    fn file(&mut self, file: FileId) {
        self.0.write_u64(5 << 32 | u64::from(file.0));
    }
    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        value.hash(&mut self.0);
    }
}

/// The shared part of a table with one cell per key, as used at the end of a task and at the
/// barrier. In an entry passed to the barrier a key is one number: the index of the node in the
/// concatenation of all nodes, or the number of the id.
pub(crate) trait Dense: Sync {
    type Value: Packed<Cell = AtomicU32>;
    /// The type that a key passed to the barrier represents, for the digest.
    type Key: Follow;
    fn key(key: u32) -> Self::Key;
    fn table_slot(&self) -> u32;
    /// The key of the dense cell `index` of `half`, in the encoding of `Half::sparse`.
    fn dense_key(half: &Half, index: u32) -> u64;
    /// `None`: `key -> value` is bound. `key`: in the encoding of the task-local part.
    fn hand_over(
        &self,
        key: u64,
        value: &impl Follow,
        finishing: &mut Finishing<'_, '_>,
    ) -> Option<u32>;
    fn follow_key(key: u32, link: &Link) -> u32;
    /// 0: nothing.
    fn load(&self, key: u32) -> u32;
    /// Precondition: the cell is empty, and the caller is the only thread that writes to the table.
    fn store(&self, key: u32, raw: u32);
}

impl<K: NodeKey, V: Packed<Cell = AtomicU32>, A: Alloc> Dense for ByNode<K, V, Buffered, A> {
    type Value = V;
    /// The numbering of files and nodes is deterministic for a given program.
    type Key = u32;

    #[inline]
    fn key(key: u32) -> u32 {
        key
    }

    fn table_slot(&self) -> u32 {
        self.slot
    }

    #[inline]
    fn dense_key(half: &Half, index: u32) -> u64 {
        node_word(half.file(), index)
    }

    #[inline]
    fn hand_over(
        &self,
        key: u64,
        value: &impl Follow,
        finishing: &mut Finishing<'_, '_>,
    ) -> Option<u32> {
        let file = FileId((key >> 32) as u32);
        let at = self.bases.at(file, key as u32)?;
        finishing.is_published(&file, value).then_some(at as u32)
    }

    #[inline]
    fn follow_key(key: u32, _: &Link) -> u32 {
        key
    }

    #[inline]
    fn load(&self, key: u32) -> u32 {
        self.published_at(key as usize)
    }

    #[inline]
    fn store(&self, key: u32, raw: u32) {
        let (cell, shift) = self.field_at(key as usize);
        cell.store(
            cell.load(Ordering::Relaxed) | raw << shift,
            Ordering::Relaxed,
        );
    }
}

impl<I: Id + Follow, V: Packed<Cell = AtomicU32>, A: Alloc> Dense for ById<I, V, Buffered, A> {
    type Value = V;
    type Key = I;

    #[inline]
    fn key(key: u32) -> I {
        I::from_number(key)
    }

    fn table_slot(&self) -> u32 {
        self.slot
    }

    #[inline]
    fn dense_key(_: &Half, index: u32) -> u64 {
        u64::from(index | LOCAL)
    }

    #[inline]
    fn hand_over(
        &self,
        key: u64,
        value: &impl Follow,
        finishing: &mut Finishing<'_, '_>,
    ) -> Option<u32> {
        (finishing.is_published(&I::from_number(key as u32), value)).then_some(key as u32)
    }

    #[inline]
    fn follow_key(key: u32, link: &Link) -> u32 {
        let mut key = I::from_number(key);
        key.follow(link);
        debug_assert!(key.local_number().is_none());
        key.number()
    }

    #[inline]
    fn load(&self, key: u32) -> u32 {
        self.published(key)
    }

    #[inline]
    fn store(&self, key: u32, raw: u32) {
        self.cells.cell(key).store(raw, Ordering::Relaxed);
    }
}

/// A table whose values fit in a cell. The entries passed to the barrier: `Vec<(u32, u32)>`, a key
/// and a packed value.
impl<'s, D: Dense<Value: Follow>> Publish<'s> for D {
    fn slot(&self) -> u32 {
        self.table_slot()
    }

    fn finish(
        &self,
        buffer: &mut Buffer<'s>,
        finishing: &mut Finishing<'_, '_>,
    ) -> Option<Entries<'s>> {
        let mut entries = Vec::new();
        (buffer.half_mut(self.table_slot())).take_cells(D::dense_key, |key, raw| {
            if let Some(key) = self.hand_over(key, &D::Value::unpack(raw), finishing) {
                entries.push((key, raw));
            }
        });
        Entries::of_cells(self.table_slot(), entries)
    }

    fn follow(&self, entries: &mut Entries<'s>, link: &Link) {
        for (key, raw) in entries.cells() {
            let mut value = D::Value::unpack(*raw);
            value.follow(link);
            (*key, *raw) = (D::follow_key(*key, link), value.pack());
        }
    }

    fn apply(
        &self,
        _: usize,
        shares: &mut [Share<'_, 's>],
        _: &mut [Vec<Handle>],
        applied: &mut Applied<'_>,
    ) {
        for share in shares {
            for &mut (key, raw) in share.whole().cells() {
                if self.load(key) == 0 {
                    self.store(key, raw);
                    applied.store(self.table_slot(), &D::key(key), &D::Value::unpack(raw));
                }
            }
        }
    }
}

/// How the handles of one indirect table are translated inside the values of another:
/// `ByIdIndirect::hold_handles_of`.
///
/// `finish` of the held table records which task-local handles are passed to the barrier, and at
/// which index. `finish` of the holder drops an entry whose handle is not passed, and otherwise
/// stores the index into the field, with `LOCAL`. `apply` of the held table stores the published
/// handle in `handles[task][place]`: that of the entry if it won, else the winner's. `apply` of the
/// holder, which the same thread calls next, stores that handle into the field.
struct Holding<T> {
    is_held: bool,
    holds: Option<(u32, fn(&mut T) -> &mut Handle)>,
}

impl<T> Default for Holding<T> {
    fn default() -> Self {
        Holding {
            is_held: false,
            holds: None,
        }
    }
}

/// The entries of an indirect table passed to the barrier: `Vec<(u32, T)>`, a key and a value, in
/// insertion order.
fn finish_indirect<'s, D: Dense<Value = Handle>, T: Follow + Send + Sync + 's>(
    (handles, slot): (&D, &Slot<IndirectInTask<T>>),
    holding: &Holding<T>,
    buffer: &mut Buffer<'s>,
    finishing: &mut Finishing<'_, '_>,
) -> Option<Entries<'s>> {
    // Every handle in a cell refers to one of the values below.
    buffer.half_mut(slot.number()).clear_cells();
    let kept = buffer.typed_mut(slot)?;
    let mut entries = Vec::new();
    let held = if holding.is_held { kept.len() } else { 0 };
    let mut places = vec![0; held as usize];
    kept.drain(|handle, (key, mut value)| {
        if let Some((held, field)) = holding.holds
            && let field = field(&mut value)
            && let Some(number) = field.local_number()
        {
            let places = &finishing.held.iter().find(|it| it.0 == held).unwrap().1;
            match places[number as usize] {
                0 => return,
                place => *field = Handle(place - 1 | LOCAL),
            }
        }
        if let Some(key) = handles.hand_over(key, &value, finishing) {
            entries.push((key, value));
            if holding.is_held {
                places[handle as usize] = entries.len() as u32;
            }
        }
    });
    if holding.is_held {
        finishing.held.push((handles.table_slot(), places));
    }
    Entries::new(slot, entries.len(), entries)
}

fn follow_indirect<D: Dense, T: Follow + Send + Sync>(
    slot: &Slot<IndirectInTask<T>>,
    entries: &mut Entries<'_>,
    link: &Link,
) {
    for (key, value) in entries.typed_mut(slot) {
        *key = D::follow_key(*key, link);
        value.follow(link);
    }
}

/// A value is pushed when its entry wins. A losing value is dropped.
fn apply_indirect<'s, D: Dense<Value = Handle>, T: Follow + Send + Sync, A: Alloc>(
    (handles, slot): (&D, &Slot<IndirectInTask<T>>),
    kept: &AppendVec<T, A>,
    holding: &Holding<T>,
    shares: &mut [Share<'_, 's>],
    links: &mut [Vec<Handle>],
    applied: &mut Applied<'_>,
) {
    for share in shares {
        let task = share.task as usize;
        let values = std::mem::take(share.whole().typed_mut(slot));
        let mut own_link = Vec::with_capacity(if holding.is_held { values.len() } else { 0 });
        for (key, mut value) in values {
            let handle = match handles.load(key) {
                0 => {
                    if let Some((_, field)) = holding.holds
                        && let field = field(&mut value)
                        && let Some(place) = field.local_number()
                    {
                        *field = links[task][place as usize];
                    }
                    applied.store(handles.table_slot(), &D::key(key), &value);
                    let handle = Handle(kept.push(value));
                    handles.store(key, handle.pack());
                    handle
                }
                winner => Handle::unpack(winner),
            };
            if holding.is_held {
                own_link.push(handle);
            }
        }
        if holding.is_held {
            links[task] = own_link;
        }
    }
}

impl<'s, K: NodeKey, T: Follow + Send + Sync + 's, A: Alloc> Publish<'s>
    for ByNodeIndirect<K, T, Buffered, A>
{
    fn slot(&self) -> u32 {
        self.handles.slot
    }

    fn finish(
        &self,
        buffer: &mut Buffer<'s>,
        finishing: &mut Finishing<'_, '_>,
    ) -> Option<Entries<'s>> {
        let table = (&self.handles, &self.in_task);
        finish_indirect(table, &Holding::<T>::default(), buffer, finishing)
    }

    fn follow(&self, entries: &mut Entries<'s>, link: &Link) {
        follow_indirect::<ByNode<K, Handle, Buffered, A>, T>(&self.in_task, entries, link);
    }

    fn apply(
        &self,
        _: usize,
        shares: &mut [Share<'_, 's>],
        handles: &mut [Vec<Handle>],
        applied: &mut Applied<'_>,
    ) {
        let holding = Holding::default();
        apply_indirect(
            (&self.handles, &self.in_task),
            &self.kept,
            &holding,
            shares,
            handles,
            applied,
        );
    }
}

impl<'s, I: Id + Follow, T: Follow + Send + Sync + 's, A: Alloc> Publish<'s>
    for ByIdIndirect<I, T, Buffered, A>
{
    fn slot(&self) -> u32 {
        self.handles.slot
    }

    fn holds_handles_of(&self) -> Option<u32> {
        Some(self.holding.holds?.0)
    }

    fn finish(
        &self,
        buffer: &mut Buffer<'s>,
        finishing: &mut Finishing<'_, '_>,
    ) -> Option<Entries<'s>> {
        let table = (&self.handles, &self.in_task);
        finish_indirect(table, &self.holding, buffer, finishing)
    }

    fn follow(&self, entries: &mut Entries<'s>, link: &Link) {
        follow_indirect::<ById<I, Handle, Buffered, A>, T>(&self.in_task, entries, link);
    }

    fn apply(
        &self,
        _: usize,
        shares: &mut [Share<'_, 's>],
        handles: &mut [Vec<Handle>],
        applied: &mut Applied<'_>,
    ) {
        let (table, holding) = ((&self.handles, &self.in_task), &self.holding);
        apply_indirect(table, &self.kept, holding, shares, handles, applied);
    }
}

/// How many threads can fill a `ByKey` concurrently. Each owns an equal number of the map's shards.
const PARTS: usize = 8;

#[inline]
fn part_of(spread: u64) -> usize {
    shard_of(spread) / (SHARDS / PARTS)
}

/// The entries of a `ByKey` passed to the barrier.
struct Keyed<K, V> {
    /// In insertion order.
    entries: Vec<(K, V)>,
    // The shard of a key is known only after the merge, so `follow` fills in the remaining fields.
    /// The hash of each key.
    spreads: Vec<u64>,
    /// The indices of the entries of part 0, in order, then those of part 1, and so on.
    by_part: Vec<u32>,
    /// The start of each part in `by_part`. A final entry is the end of the last part.
    starts: [u32; PARTS + 1],
}

impl<'s, K, V, A: Alloc> Publish<'s> for ByKey<K, V, Buffered, A>
where
    K: std::hash::Hash + Eq + Clone + Follow + Send + Sync + 's,
    V: Copy + Follow + Send + Sync + 's,
{
    fn slot(&self) -> u32 {
        self.slot.number()
    }

    fn parts(&self) -> usize {
        PARTS
    }

    fn finish(
        &self,
        buffer: &mut Buffer<'s>,
        finishing: &mut Finishing<'_, '_>,
    ) -> Option<Entries<'s>> {
        let all = buffer.typed_mut(&self.slot)?.take().into_iter();
        let mut entries: Vec<(K, V)> =
            (all.filter(|(key, value)| finishing.is_published(key, value))).collect();
        entries.shrink_to_fit();
        let len = entries.len();
        let keyed = Keyed {
            entries,
            spreads: Vec::new(),
            by_part: Vec::new(),
            starts: [0; PARTS + 1],
        };
        Entries::new(&self.slot, len, keyed)
    }

    fn follow(&self, entries: &mut Entries<'s>, link: &Link) {
        let keyed = entries.typed_mut(&self.slot);
        let mut counts = [0u32; PARTS];
        keyed.spreads = (keyed.entries.iter_mut())
            .map(|(key, value)| {
                key.follow(link);
                value.follow(link);
                let spread = spread_hash(key);
                counts[part_of(spread)] += 1;
                spread
            })
            .collect();
        for part in 0..PARTS {
            keyed.starts[part + 1] = keyed.starts[part] + counts[part];
        }
        let mut next = keyed.starts;
        keyed.by_part = vec![0; keyed.entries.len()];
        for (place, &spread) in keyed.spreads.iter().enumerate() {
            let at = &mut next[part_of(spread)];
            keyed.by_part[*at as usize] = place as u32;
            *at += 1;
        }
    }

    fn apply(
        &self,
        part: usize,
        shares: &mut [Share<'_, 's>],
        _: &mut [Vec<Handle>],
        applied: &mut Applied<'_>,
    ) {
        // A task has no key twice, so about this many entries are added at least. The hash spreads
        // them evenly over the shards of the part.
        let of_largest_share = (shares.iter())
            .map(|share| {
                let Payload::Part(entries) = share.payload else {
                    unreachable!()
                };
                let keyed = entries.typed(&self.slot);
                (keyed.starts[part + 1] - keyed.starts[part]) as usize
            })
            .max()
            .unwrap_or(0);
        let shards = SHARDS / PARTS;
        (self.published).reserve(
            part * shards..(part + 1) * shards,
            of_largest_share / shards,
        );
        for share in shares {
            let Payload::Part(entries) = share.payload else {
                unreachable!()
            };
            let keyed = entries.typed(&self.slot);
            let (from, to) = (keyed.starts[part] as usize, keyed.starts[part + 1] as usize);
            for &place in &keyed.by_part[from..to] {
                let (key, value) = &keyed.entries[place as usize];
                if (self.published).add_if_absent(keyed.spreads[place as usize], key, *value) {
                    applied.store(self.slot.number(), key, value);
                }
            }
        }
    }
}

// ───────────────────────────── `FileLocal` ─────────────────────────────

/// Where a `FileLocal` table has the value of a node.
struct Place {
    /// The index of the word among those of the file.
    word: u32,
    /// The bit offset of the node within the word.
    shift: u32,
}

/// There is no shared part. The storage is in 64-bit words. A value of one or two bits shares its
/// word with the values of the neighbouring nodes.
impl<K: NodeKey, V: Packed, A: Alloc> ByNode<K, V, FileLocal, A> {
    #[inline]
    fn place(index: u32) -> Place {
        match V::BITS {
            0 => Place {
                word: index,
                shift: 0,
            },
            bits => Place {
                word: index / (64 / bits),
                shift: index % (64 / bits) * bits,
            },
        }
    }

    #[inline]
    pub fn get(&self, task: &Task, key: &K) -> Option<V> {
        let Place { word, shift } = Self::place(key.index());
        let raw = task.file_local().cell(self.slot, key.file().0, word) >> shift & Self::MASK;
        (raw != 0).then(|| V::unpack(V::Cell::narrow(raw)))
    }

    /// Does not overwrite an existing value. Returns the stored value.
    #[inline]
    pub fn insert(&self, task: &Task, key: K, value: V) -> V {
        // Callers occasionally pass `NONE`.
        if key.index() == u32::MAX {
            return value;
        }
        if V::BITS != 0 {
            if let Some(kept) = self.get(task, &key) {
                return kept;
            }
            self.rewrite(task, key, value);
            return value;
        }
        let raw = V::Cell::widen(value.pack());
        let kept = (task.file_local()).put_if_empty(self.slot, key.file().0, key.index(), raw);
        V::unpack(V::Cell::narrow(kept))
    }

    /// Stores `value`, overwriting any existing value.
    #[inline]
    pub fn rewrite(&self, task: &Task, key: K, value: V) {
        if key.index() == u32::MAX {
            return;
        }
        let (file, raw) = (key.file().0, V::Cell::widen(value.pack()));
        let Place { word, shift } = Self::place(key.index());
        let raw = match V::BITS {
            0 => raw,
            _ => {
                task.file_local().cell(self.slot, file, word) & !(Self::MASK << shift)
                    | raw << shift
            }
        };
        task.file_local().store(self.slot, file, word, raw);
    }
}
