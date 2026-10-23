//! Tables indexed by a dense id.
//!
//! Nodes and symbols are numbered within their file, and types in creation order, so a result
//! computed for one is stored in an array and needs no hashing. A cell starts at zero, meaning "not
//! computed", and is written once. A read is one load.
//!
//! The memory comes zero-filled from the allocator, which for arrays of this size gets it from the
//! operating system, so a page that's never touched is never resident.
//!
//! A table's third type parameter determines who writes an entry and when it becomes visible to
//! whom: `Frozen`, `Buffered`, `FileLocal`. See `Policy`.

use crate::check::task::{Stored, Task};
use crate::local::{
    Buffer, HashedInTask, LOCAL, ListInTask, MaybeLocal, Slot, SlotNumber, is_local_number,
    node_word,
};
use crate::program::{FileId, Sym};
use crate::session::Session;
use crate::types::{Follow, OwnStore, Visitor};
use crate::util::memory::{Cells, FixedCells, Zeroed};
use crate::util::{AppendVec, Windowed, WindowedMap, spread_hash, spread_in_window};
use std::alloc::{Allocator, Global};
use std::hash::Hash;
use std::marker::PhantomData;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

/// The allocator for a table's shared part, which any thread may allocate from. Either `&Session` or
/// `Global`.
pub trait Alloc: Allocator + Clone + Send + Sync {
    /// A list of numbers, allocated from it, that several tables share.
    type Shared: std::ops::Deref<Target = [u32]> + Clone + Send + Sync;
    fn share(&self, list: &[u32]) -> Self::Shared;
}

impl Alloc for Global {
    type Shared = Arc<[u32]>;
    fn share(&self, list: &[u32]) -> Arc<[u32]> {
        list.into()
    }
}

/// The list isn't freed before the session ends, so it needs no reference count.
impl<'s> Alloc for &'s Session {
    type Shared = &'s [u32];
    fn share(&self, list: &[u32]) -> &'s [u32] {
        let session: &'s Session = self;
        session.arena().alloc_slice_copy(list)
    }
}

/// An atomic integer.
pub trait Cell: Zeroed + Sync + Send {
    type Raw: Copy + PartialEq + Default;
    fn widen(raw: Self::Raw) -> u64;
    fn narrow(raw: u64) -> Self::Raw;
    /// A relaxed load, for a table that no thread is writing to. The caller must order earlier
    /// writes before it.
    fn load(&self) -> Self::Raw;
    /// Stores `raw` if the cell is empty. Returns the cell's value afterwards: `raw`, or the value
    /// that was already there.
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
    /// Bit width of a packed value if several keys' values share a cell, or 0 if each value has its
    /// own cell.
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

/// A table of `()` is a set.
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

impl Packed for (Option<crate::types::TypeId>, bool) {
    type Cell = AtomicU32;
    #[inline]
    fn pack(self) -> u32 {
        self.0.pack() << 1 | u32::from(self.1)
    }
    #[inline]
    fn unpack(raw: u32) -> Self {
        (
            <Option<crate::types::TypeId>>::unpack(raw >> 1),
            raw & 1 != 0,
        )
    }
}

impl Packed for (Option<crate::types::SigId>, bool) {
    type Cell = AtomicU32;
    #[inline]
    fn pack(self) -> u32 {
        self.0.pack() << 1 | u32::from(self.1)
    }
    #[inline]
    fn unpack(raw: u32) -> Self {
        (
            <Option<crate::types::SigId>>::unpack(raw >> 1),
            raw & 1 != 0,
        )
    }
}

/// A dense id: an index counted from zero without significant gaps.
pub trait Id: Copy {
    fn number(self) -> u32;
    fn from_number(number: u32) -> Self;
    /// Returns the id's index among the task's ids if it's task-local, or `None` if it isn't.
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
/// Files and nodes are numbered before the first task starts, so they're never task-local. These
/// impls are for `ByKey` keys that contain one alongside an id.
impl MaybeLocal for FileId {
    #[inline]
    fn is_local(&self) -> bool {
        false
    }
}

impl MaybeLocal for Sym {
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

impl MaybeLocal for crate::node::Node {
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
/// concatenated. The last entry is the end index.
///
/// The second list is empty, or has each file's node count. See `with_counts`.
pub struct Bases<A: Alloc = Global>(A::Shared, A::Shared);

impl<A: Alloc> Clone for Bases<A> {
    fn clone(&self) -> Self {
        Bases(self.0.clone(), self.1.clone())
    }
}

impl<A: Alloc> Bases<A> {
    pub fn new_in(lengths: impl Iterator<Item = usize>, alloc: &A) -> Self {
        let mut total = 0usize;
        let mut bases = vec![0u32];
        for len in lengths {
            total += len;
            bases.push(u32::try_from(total).expect("too many nodes of one kind for 32 bits"));
        }
        Bases(alloc.share(&bases), alloc.share(&[]))
    }

    /// Records each file's real node count. It differs from the length passed to `new_in` for a file that gets no
    /// range in the concatenation.
    pub fn with_counts(self, counts: impl Iterator<Item = usize>, alloc: &A) -> Self {
        let counts: Vec<u32> = counts.map(|count| count as u32).collect();
        Bases(self.0, alloc.share(&counts))
    }

    /// Returns the bases for a table in which no file has a node.
    pub(crate) fn none_in(alloc: &A) -> Self {
        Bases(alloc.share(&[0]), alloc.share(&[]))
    }

    /// Returns the number of nodes in `file`.
    fn count_in(&self, file: FileId) -> usize {
        match self.1.get(file.idx()) {
            Some(&count) => count as usize,
            None => self.range_of(file).len(),
        }
    }

    #[inline]
    fn total(&self) -> usize {
        *self.0.last().unwrap() as usize
    }

    /// Returns the node's index in the concatenation, or `None` if there's no such node. Callers
    /// occasionally pass `NONE`.
    #[inline]
    fn at(&self, file: FileId, index: u32) -> Option<usize> {
        // Reads the higher index first. If it's in bounds, so is the lower one, which then isn't
        // bounds-checked.
        let (end, start) = (self.0[file.idx() + 1], self.0[file.idx()]);
        (index < end - start).then(|| (start + index) as usize)
    }

    /// Returns the range of `file`'s nodes in the concatenation.
    fn range_of(&self, file: FileId) -> std::ops::Range<usize> {
        let (end, start) = (self.0[file.idx() + 1], self.0[file.idx()]);
        start as usize..end as usize
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
    /// `Location::SLOT` of a `Buffered` table.
    const SLOT: u32 = NO_SLOT;
}

/// Not buffered. `insert` writes the shared cell with a compare-and-swap, and the first value wins,
/// so several threads can fill one table concurrently. `get` uses relaxed loads, so the caller must
/// order another thread's write before its read. Used for the loader's and the type store's tables.
pub struct Frozen;

/// The default for a field of `Program`. A task stores into the table's task-local part
/// (`crate::local::Half`), which no other task sees. The table holds the shared part. Commits write
/// to it (`Publish::store_logged`), and so does `insert` where `Task::may_write_immediately` allows it.
pub struct Buffered<W: Location = AtRunTime>(PhantomData<fn() -> W>);

/// Where a task stores the task-local part of a `Buffered` table.
pub trait Location {
    /// The table's slot, or `NO_SLOT` if it's only known at run time, from `set_slot`.
    const SLOT: u32;
    /// For a table keyed by node. If true, entries that a task stores under a node of the file it's visiting never
    /// leave the task. Used for results about expressions. Nearly all of those are computed by the task that checks the
    /// file, which is the only one that looks up all of them. Another task only reaches an expression on the way to a
    /// declaration's type. Its entries are shared, and the task that checks the file finds them.
    const KEEPS_VISITED_FILE_LOCAL: bool = false;
}

/// The slot is a field of the table.
pub struct AtRunTime;

impl Location for AtRunTime {
    const SLOT: u32 = NO_SLOT;
}

/// The slot is part of the table's type, so its task-local part is at a fixed offset from the task.
pub(crate) struct At<const SLOT: u32>;

impl<const SLOT: u32> Location for At<SLOT> {
    const SLOT: u32 = SLOT;
}

/// `At`, for a table with `Location::KEEPS_VISITED_FILE_LOCAL`.
pub(crate) struct OfExpressions<const SLOT: u32>;

impl<const SLOT: u32> Location for OfExpressions<SLOT> {
    const SLOT: u32 = SLOT;
    const KEEPS_VISITED_FILE_LOCAL: bool = true;
}

/// The entries are task-local and are dropped when the task begins its next file. No other task
/// ever sees one.
pub struct FileLocal;

impl Policy for Frozen {}
impl<W: Location> Policy for Buffered<W> {
    const SLOT: u32 = W::SLOT;
}
impl Policy for FileLocal {
    const IS_FILE_LOCAL: bool = true;
}

// ───────────────────────────── the tables ─────────────────────────────

/// `number_tables` hasn't assigned a slot yet. A `Frozen` table doesn't need one.
const NO_SLOT: u32 = u32::MAX;

/// Returns the slot of a table with policy `P` whose `slot` field is `slot`.
#[inline]
fn known_slot<P: Policy>(slot: u32) -> u32 {
    match P::SLOT {
        NO_SLOT => slot,
        known => known,
    }
}

/// A value for each node of one kind in the program.
pub struct ByNode<K, V: Packed, P: Policy = Frozen, A: Alloc = Global> {
    bases: Bases<A>,
    cells: FixedCells<V::Cell, A>,
    /// For each key, the number of the commit that stored its entry (see `crate::check::commit`). 0 or a missing cell
    /// means that no commit has.
    stamps: Cells<AtomicU32, A>,
    /// Index of this table's task-local part within a task.
    slot: u32,
    key: PhantomData<fn(K, P)>,
}

impl<K: NodeKey, V: Packed, P: Policy, A: Alloc> ByNode<K, V, P, A> {
    /// Number of keys that share a cell.
    const PER_CELL: usize = if V::BITS != 0 {
        size_of::<V::Cell>() * 8 / V::BITS as usize
    } else {
        1
    };
    /// Mask for one key's bits after they're shifted down.
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
            stamps: Cells::new_in(alloc.clone()),
            cells: FixedCells::new_in(bases.total().div_ceil(Self::PER_CELL), alloc),
            bases,
            slot: NO_SLOT,
            key: PhantomData,
        }
    }

    pub(crate) fn set_slot(&mut self, slot: SlotNumber) {
        self.set_slot_number(slot.number());
    }

    fn set_slot_number(&mut self, slot: u32) {
        assert!(P::SLOT == NO_SLOT || P::SLOT == slot);
        self.slot = slot;
    }

    /// Returns the cell index of the key at `at` in the concatenation of all keys, and the key's bit offset in it.
    #[inline]
    fn cell_and_shift(at: usize) -> (usize, u32) {
        (at / Self::PER_CELL, (at % Self::PER_CELL) as u32 * V::BITS)
    }

    /// Returns the cell contents for the key at `at`, shifted down to the key's bits. Higher keys' bits aren't masked.
    #[inline]
    fn bits_at(&self, at: usize, load: impl FnOnce(&V::Cell) -> <V::Cell as Cell>::Raw) -> u64 {
        let (cell, shift) = Self::cell_and_shift(at);
        (self.cells.existing(cell)).map_or(0, |cell| V::Cell::widen(load(cell)) >> shift)
    }

    /// Returns the cell of the key at `at` for writing, and the key's bit offset in the cell.
    #[inline]
    fn field_at(&self, at: usize) -> (&V::Cell, u32) {
        let (cell, shift) = Self::cell_and_shift(at);
        (self.cells.cell(cell), shift)
    }

    /// `field_at` for `key`, or `None` if there's no such node.
    #[inline]
    fn field(&self, key: K) -> Option<(&V::Cell, u32)> {
        Some(self.field_at(self.bases.at(key.file(), key.index())?))
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

/// The index of a value in an indirect table. With `LOCAL` set, it indexes the task-local part. A
/// handle isn't a value, because it isn't an id of the type store. See
/// `ByIdIndirect::hold_handles_of`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Handle(pub u32);
packed_ids!(Handle);

impl Follow for Handle {
    #[inline]
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        visitor.handle(self.0);
    }
}

/// A value too large for a cell, for some of the nodes of one kind. It's stored out of line and
/// never moves.
pub struct ByNodeIndirect<K, T, P: Policy = Frozen, A: Alloc = Global> {
    handles: ByNode<K, Handle, P, A>,
    values: AppendVec<T, A>,
    in_task: Slot<IndirectInTask<T>>,
}

impl<K: NodeKey, T, P: Policy, A: Alloc> ByNodeIndirect<K, T, P, A> {
    pub fn new_in(bases: &Bases<A>, alloc: A) -> Self {
        ByNodeIndirect {
            handles: ByNode::new_in(bases, alloc.clone()),
            values: AppendVec::new_in(alloc),
            in_task: Slot::NONE,
        }
    }
}

impl<K: NodeKey, T, P: Policy, A: Alloc> ByNodeIndirect<K, T, P, A> {
    pub(crate) fn set_slot(&mut self, slot: SlotNumber) {
        self.in_task = slot.typed();
        self.handles.set_slot_number(self.in_task.number());
    }
}

/// A value for each id of a kind that's numbered in creation order.
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

    pub(crate) fn set_slot(&mut self, slot: SlotNumber) {
        self.set_slot_number(slot.number());
    }

    fn set_slot_number(&mut self, slot: u32) {
        assert!(P::SLOT == NO_SLOT || P::SLOT == slot);
        self.slot = slot;
    }
}

/// A value too large for a cell, for some of the ids of a kind that's numbered in creation order.
pub struct ByIdIndirect<I, T, P: Policy = Frozen, A: Alloc = Global> {
    handles: ById<I, Handle, P, A>,
    values: AppendVec<T, A>,
    in_task: Slot<IndirectInTask<T>>,
    /// See `hold_handles_of`.
    held_handle: Option<fn(&mut T) -> &mut Handle>,
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
            values: AppendVec::new_in(alloc),
            in_task: Slot::NONE,
            held_handle: None,
        }
    }
}

impl<I: Id, T, P: Policy, A: Alloc> ByIdIndirect<I, T, P, A> {
    pub(crate) fn set_slot(&mut self, slot: SlotNumber) {
        self.in_task = slot.typed();
        self.handles.set_slot_number(self.in_task.number());
    }
}

/// A memo table for keys that are more than a single id.
pub struct ByKey<K, V, P: Policy = Frozen, A: Alloc = Global> {
    published: WindowedMap<K, V, A>,
    slot: Slot<HashedInTask<K, V>>,
    policy: PhantomData<fn(P)>,
}

impl<K: std::hash::Hash + Eq, V, P: Policy, A: Alloc> ByKey<K, V, P, A> {
    pub fn new_in(alloc: A) -> Self {
        ByKey {
            published: WindowedMap::new_in(alloc),
            slot: Slot::NONE,
            policy: PhantomData,
        }
    }

    pub(crate) fn set_slot(&mut self, slot: SlotNumber) {
        self.slot = slot.typed();
        assert!(P::SLOT == NO_SLOT || P::SLOT == self.slot.number());
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
        let at = self.bases.at(key.file(), key.index())?;
        let raw = V::Cell::narrow(self.bits_at(at, Cell::load) & Self::MASK);
        (raw != Default::default()).then(|| V::unpack(raw))
    }

    /// Doesn't overwrite an existing value. Returns the stored value.
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
        self.handles
            .get(key)
            .map(|handle| self.values.get(handle.0))
    }

    /// Doesn't overwrite an existing value. Returns the stored value. The value is written before
    /// its handle is stored in a cell. If the cell already holds another handle, the new value is
    /// unreachable.
    pub fn insert_ref(&self, key: K, value: T) -> &T {
        let handle = Handle(self.values.push(value));
        self.values.get(self.handles.insert(key, handle).0)
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
    /// Returns `None` for an id with `LOCAL`, because no entry is ever published for one.
    #[inline]
    pub fn get(&self, key: &I) -> Option<V> {
        let raw = self.cells.existing(key.number())?.load();
        (raw != Default::default()).then(|| V::unpack(raw))
    }

    /// Doesn't overwrite an existing value. Returns the stored value.
    #[inline]
    pub fn insert(&self, key: I, value: V) -> V {
        assert!(key.local_number().is_none());
        V::unpack(self.cells.cell(key.number()).put_if_empty(value.pack()))
    }
}

// ───────────────────────────── `Buffered`: what a task reads and writes ─────────────────────────────
//
// `get`: a hit on a published entry is one load. The task-local part is searched only if the cell is
// empty. An id with `LOCAL` has no shared cell, so it's looked up in the dense task-local part.
// `insert`: stores into the task-local part. It doesn't overwrite an existing entry, published or
// not, and returns the stored value, which `get` returns from then on.
// `rewrite`: replaces the task-local entry. A published entry is unchanged.
//
// A checker without a task runs while nothing commits, so its loads are relaxed. A task that sees commits
// (`Task::view`) reads the shared part while it's being written, so its loads are `Acquire`, and:
// - A published entry can appear at any time. From then on `get` returns it, even if the task already has its own
//   entry.
// - An entry under a node or a symbol counts as absent, for `get` and for `insert`, if it was stored by a commit that
//   the task doesn't see in that file (`ByNode::seen`). The task computes its own entry, which loses when it commits.
// - A value that's stored out of line goes to the shared `values` when it's inserted, unless the entry is bound. A
//   commit stores only the handle.
// - `insert` and `rewrite` of a table keyed by a record store into the shared part immediately where
//   `Task::may_write_immediately` allows it. `get` doesn't change. It reads the shared part, then the task-local part,
//   which has the entries that are bound or waiting for a commit.
// - What the task sees under the nodes of the file it's visiting doesn't change during the visit. It's copied into the
//   task-local part, which then answers without the shared part (`ByNode::adopt`).

/// True if an entry under `key` that may be written immediately stays in the task anyway and is freed with it.
///
/// Nine out of ten entries are never read by another task, and they're most of what a check holds at its end. A record
/// made from a file's syntax is looked up by the task that visits the file, and rarely by another. So that task doesn't
/// share its entries about such a record. Another task that needs one recomputes it and shares it, because it hasn't
/// visited the file.
///
/// An entry that may be written immediately is a function of its key, and nothing it depends on is waiting for a
/// commit. So no other task is affected by not finding it, and it isn't a `Task::hold_back`.
#[inline]
fn stays_in_task(task: &Task, key: &impl Follow) -> bool {
    key.is_of_visited_file(&task.own)
}

/// True if an entry with a published key and `value` can be written immediately, provided its table and its `Stored`
/// allow it. That requires a task that writes immediately at all and a value that isn't bound. If such an entry goes to
/// the task-local part anyway, that's a `Task::hold_back`.
#[inline]
fn is_for_all_tasks(task: &Task, value: &impl Follow) -> bool {
    task.writes_immediately() && !value.is_bound(&task.own)
}

impl<K: NodeKey, V: Packed<Cell = AtomicU32>, W: Location, A: Alloc> ByNode<K, V, Buffered<W>, A> {
    #[inline]
    fn own_slot(&self) -> u32 {
        known_slot::<Buffered<W>>(self.slot)
    }

    /// Returns the published entry of the key at `at`, or 0 if there is none.
    #[inline]
    fn published_at(&self, at: usize) -> u32 {
        (self.bits_at(at, |cell| cell.load(Ordering::Relaxed)) & Self::MASK) as u32
    }

    /// `published_at` for a task that sees the commits up to `snapshot` in the key's file.
    #[inline]
    fn seen_up_to(&self, snapshot: u32, at: usize) -> u32 {
        let raw = (self.bits_at(at, |cell| cell.load(Ordering::Acquire)) & Self::MASK) as u32;
        match raw != 0 && self.stamp_at(at) > snapshot {
            true => 0,
            false => raw,
        }
    }

    /// `published_at`, limited to what `task` sees. `file` is the key's file.
    #[inline]
    fn seen_at(&self, task: &Task, file: u32, at: usize) -> u32 {
        match task.view() {
            None => self.published_at(at),
            // `snapshot_of` runs before the load, because a miss counts as a look at the file too.
            Some(view) => {
                let raw = self.seen_up_to(view.snapshot_of(FileId(file)), at);
                match raw != 0 && view.hides(FileId(file), self.stamp_at(at)) {
                    true => 0,
                    false => raw,
                }
            }
        }
    }

    /// Returns the `stamps` value of the key at `at`. The caller has already loaded the key's entry.
    #[inline]
    fn stamp_at(&self, at: usize) -> u32 {
        let stamp = self.stamps.existing_acquire(at as u32);
        stamp.map_or(0, |stamp| stamp.load(Ordering::Relaxed))
    }

    /// Returns the number of the commit that stored the entry under `key`, or `None` if nothing is published there.
    /// Call it only while no commit is storing.
    pub(crate) fn commit_of(&self, key: K) -> Option<u32> {
        let at = self.bases.at(key.file(), key.index())?;
        (self.published_at(at) != 0).then(|| self.stamp_at(at))
    }

    #[inline]
    pub fn get(&self, task: &Task, key: &K) -> Option<V> {
        let (file, index) = (key.file().0, key.index());
        let raw = match task.buffer().in_row(self.own_slot(), file, index) {
            Some(raw) => raw,
            None => self.get_outside_the_row(task, file, index),
        };
        (raw != 0).then(|| V::unpack(raw))
    }

    /// True if the row of `file`, which `task` is visiting, can answer for the published part too. It can if what the
    /// task sees of the published part doesn't change while it visits the file.
    #[inline]
    fn has_a_whole_row(task: &Task, file: u32) -> bool {
        task.view().is_none_or(|view| view.is_pinned(FileId(file)))
    }

    /// Returns the published entry that `task` sees for the node, and the node's index among the nodes of all files. A
    /// node that `Bases` doesn't count has no cell, and nothing is ever published for it.
    #[inline]
    fn seen(&self, task: &Task, file: u32, index: u32) -> (u32, Option<usize>) {
        let at = self.bases.at(FileId(file), index);
        (at.map_or(0, |at| self.seen_at(task, file, at)), at)
    }

    /// `get` for when `Buffer::in_row` returns `None`.
    #[inline(never)]
    fn get_outside_the_row(&self, task: &Task, file: u32, index: u32) -> u32 {
        let (slot, buffer) = (self.own_slot(), task.buffer());
        if file == buffer.file() && Self::has_a_whole_row(task, file) {
            self.adopt(task, buffer, file);
            return buffer.in_row(slot, file, index).unwrap_or(0);
        }
        match self.seen(task, file, index) {
            (0, at) => buffer.node_anywhere(slot, file, index, at),
            (raw, _) => raw,
        }
    }

    /// Called when the task, which is visiting `file`, first reads or writes this table for that file. From now on the
    /// row belongs to `file` and holds the published entries that the task sees. `buffer` is `task`'s buffer, here and
    /// below.
    #[cold]
    #[inline(never)]
    fn adopt(&self, task: &Task, buffer: &mut Buffer<'_>, file: u32) {
        let (slot, nodes) = (self.own_slot(), self.bases.range_of(FileId(file)));
        buffer.cover(slot, file, &nodes, self.bases.count_in(FileId(file)));
        if !Self::has_a_whole_row(task, file) {
            return;
        }
        let mut has_seeds = false;
        // Most nodes have nothing published, so the empty cells are skipped before asking what the task sees.
        let cells = nodes.start / Self::PER_CELL..nodes.end.div_ceil(Self::PER_CELL);
        for (cell, published) in self.cells.written_in(cells) {
            if published.load(Ordering::Acquire) == 0 {
                continue;
            }
            let first = cell * Self::PER_CELL;
            for at in first.max(nodes.start)..(first + Self::PER_CELL).min(nodes.end) {
                let raw = self.seen_at(task, file, at);
                if raw == 0 {
                    continue;
                }
                has_seeds = true;
                let index = (at - nodes.start) as u32;
                let own = buffer.seed(slot, index, raw);
                if own != 0 && own != raw {
                    buffer.shadow(slot, file, index, own);
                }
            }
        }
        buffer.set_whole(slot, has_seeds);
    }

    /// Returns the cell that holds the task's entry for the node, or that a new entry goes into. If the task sees a
    /// published entry, returns `Err` with that entry.
    fn cell_for<'b>(
        &self,
        task: &Task,
        buffer: &'b mut Buffer<'_>,
        file: u32,
        index: u32,
    ) -> Result<&'b mut u32, u32> {
        let slot = self.own_slot();
        if file == buffer.file() {
            let is_adopted = match Self::has_a_whole_row(task, file) {
                true => buffer.has_whole_row(slot, file),
                false => buffer.covers(slot, file),
            };
            if !is_adopted {
                self.adopt(task, buffer, file);
            }
        }
        // Everything in a whole row is the task's own, unless something is published for a node of the file.
        if buffer.has_whole_row(slot, file) && !buffer.has_seeds(slot) {
            return Ok(buffer.cell_in_row(slot, index));
        }
        match self.seen(task, file, index) {
            (0, at) => Ok(buffer.cell_anywhere(slot, file, index, at)),
            (published, _) => Err(published),
        }
    }

    /// `insert` of a packed value, or `rewrite` if `replaces` is set. Returns what `get` returns from now on.
    #[inline(never)]
    fn put(&self, task: &Task, file: u32, index: u32, raw: u32, replaces: bool) -> u32 {
        let buffer = task.buffer();
        let (current, is_stored) = match self.cell_for(task, buffer, file, index) {
            Ok(cell) => {
                let is_stored = replaces || *cell == 0;
                if is_stored {
                    *cell = raw;
                }
                (*cell, is_stored)
            }
            Err(published) if !replaces => return published,
            Err(published) => {
                buffer.shadow(self.own_slot(), file, index, raw);
                (published, true)
            }
        };
        if W::KEEPS_VISITED_FILE_LOCAL && file == buffer.file() {
            return current;
        }
        if is_stored {
            buffer.log_node(self.own_slot(), file, index);
        }
        // The entry waits in the task-local part for a commit, unless `Bases` doesn't count the node. Nothing is ever
        // published under such a node, so no other task could find the entry.
        if task.writes_immediately() && self.bases.at(FileId(file), index).is_some() {
            task.hold_back();
        }
        current
    }

    #[inline]
    pub fn insert(&self, task: &Task, key: K, value: V, _: Stored) -> V {
        // Callers occasionally pass `NONE`.
        if key.index() == u32::MAX {
            return value;
        }
        V::unpack(self.put(task, key.file().0, key.index(), value.pack(), false))
    }

    pub fn rewrite(&self, task: &Task, key: K, value: V, _: Stored) -> V {
        if key.index() != u32::MAX {
            self.put(task, key.file().0, key.index(), value.pack(), true);
        }
        value
    }
}

impl<I: Id, V: Packed<Cell = AtomicU32>, W: Location, A: Alloc> ById<I, V, Buffered<W>, A> {
    #[inline]
    fn own_slot(&self) -> u32 {
        known_slot::<Buffered<W>>(self.slot)
    }

    /// Returns the published entry of the id `number`, or 0 if there is none.
    #[inline]
    fn published(&self, number: u32) -> u32 {
        (self.cells.existing(number)).map_or(0, |cell| cell.load(Ordering::Relaxed))
    }

    /// `published`, as `task` sees it.
    #[inline]
    fn seen(&self, task: &Task, number: u32) -> u32 {
        if !task.commits() {
            return self.published(number);
        }
        (self.cells.existing_acquire(number)).map_or(0, |cell| cell.load(Ordering::Acquire))
    }

    /// Returns `task`'s own entry under the published id `number`, or 0 if there is none.
    #[inline]
    fn in_task(&self, task: &Task, number: u32) -> u32 {
        task.buffer().published_id(self.own_slot(), number)
    }

    #[inline]
    pub fn get(&self, task: &Task, key: &I) -> Option<V> {
        let raw = match key.local_number() {
            Some(number) => task.buffer().own_id(self.own_slot(), number),
            None => match self.seen(task, key.number()) {
                0 => self.in_task(task, key.number()),
                raw => raw,
            },
        };
        (raw != 0).then(|| V::unpack(raw))
    }

    /// `insert` into the task-local part.
    #[inline]
    fn insert_in_task(&self, task: &Task, key: I, value: V) -> V {
        let (slot, new) = (self.own_slot(), value.pack());
        V::unpack(match key.local_number() {
            Some(number) => task.buffer().put_own_id_if_empty(slot, number, new),
            None => match self.seen(task, key.number()) {
                0 => (task.buffer()).put_published_id_if_empty(slot, key.number(), new),
                raw => raw,
            },
        })
    }

    /// `insert_in_task` for an entry under a published id that `stays_in_task`.
    #[inline]
    fn insert_for_this_task(&self, task: &Task, key: I, value: V) -> V {
        V::unpack(match self.seen(task, key.number()) {
            0 => (task.buffer()).put_unlogged_if_empty(self.own_slot(), key.number(), value.pack()),
            raw => raw,
        })
    }

    /// Stores `raw` in the shared cell of the published id `number`, unless the key already has an entry there or in
    /// the task-local part. Returns the key's entry afterwards.
    #[inline]
    fn put_immediately(&self, task: &Task, number: u32, raw: u32) -> u32 {
        let own = self.in_task(task, number);
        if own != 0 && self.seen(task, number) == 0 {
            return own;
        }

        self.cells.cell(number).put_if_empty(raw)
    }
}

impl<I: Id + Follow, V: Packed<Cell = AtomicU32> + Follow, W: Location, A: Alloc>
    ById<I, V, Buffered<W>, A>
{
    #[inline]
    pub fn insert(&self, task: &Task, key: I, value: V, stored: Stored) -> V {
        self.insert_where::<true>(task, key, value, stored)
    }

    /// `insert` for an entry that isn't a function of only its key, so another task might compute a different value. It
    /// never `stays_in_task`.
    #[inline]
    pub fn insert_for_every_task(&self, task: &Task, key: I, value: V, stored: Stored) -> V {
        self.insert_where::<false>(task, key, value, stored)
    }

    #[inline]
    fn insert_where<const MAY_STAY_IN_TASK: bool>(
        &self,
        task: &Task,
        key: I,
        value: V,
        stored: Stored,
    ) -> V {
        if key.local_number().is_none() && is_for_all_tasks(task, &value) {
            if task.may_write_immediately(self.own_slot(), stored) {
                if MAY_STAY_IN_TASK && stays_in_task(task, &key) {
                    return self.insert_for_this_task(task, key, value);
                }
                return self.put_value_immediately(task, key, value);
            }
            task.hold_back();
        }
        self.insert_in_task(task, key, value)
    }

    /// `put_immediately` for a value that isn't packed yet.
    #[inline]
    fn put_value_immediately(&self, task: &Task, key: I, value: V) -> V {
        let raw = value.pack();
        V::unpack(self.put_immediately(task, key.number(), raw))
    }

    /// An entry that was written immediately is published, so this doesn't change it. Code that stores an entry it will
    /// replace later must store it with `Stored::held_back`.
    pub fn rewrite(&self, task: &Task, key: I, value: V, stored: Stored) -> V {
        let Some(number) = key.local_number() else {
            let number = key.number();
            if is_for_all_tasks(task, &value) {
                if task.may_write_immediately(self.own_slot(), stored)
                    && self.in_task(task, number) == 0
                {
                    match stays_in_task(task, &key) {
                        true => self.insert_for_this_task(task, key, value),
                        false => self.put_value_immediately(task, key, value),
                    };
                    return value;
                }
                task.hold_back();
            }
            (task.buffer()).store_published_id(self.own_slot(), number, value.pack());
            return value;
        };
        task.buffer()
            .store_own_id(self.own_slot(), number, value.pack());
        value
    }
}

/// An indirect table's task-local values, each with its key as the task-local part encodes it,
/// indexed by handle without `LOCAL`.
type IndirectInTask<T> = ListInTask<(u64, T)>;

/// Returns the value `handle` refers to. The reference has the table's lifetime, but a reference to
/// a task-local value is valid only until the task ends (`Task::end`, `Task::begin`, the drop).
/// Any holder, such as one of the checker's caches, must release it by then.
#[inline]
fn indirect_at<'p, 's, T: Send + 's, A: Alloc>(
    values: &'p AppendVec<T, A>,
    slot: &Slot<IndirectInTask<T>>,
    task: &Task<'s>,
    handle: Handle,
) -> &'p T {
    match handle.local_number() {
        None => values.get(handle.0),
        Some(number) => {
            let value = &task.buffer().typed(slot).unwrap().get(number).1;
            // SAFETY: a `LocalVec` element never moves and lives until the task ends. See above.
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

/// Stores a new entry's value, in the shared `values` or in the task, and returns its handle. `may_be_shared` means
/// that only `value` can make the entry bound. A value in `values` whose handle is never committed stays there,
/// unreachable, until the program is freed.
fn store_value<'s, T: Follow + Send + 's, A: Alloc>(
    (values, slot): (&AppendVec<T, A>, &Slot<IndirectInTask<T>>),
    task: &Task<'s>,
    (key, may_be_shared): (u64, bool),
    value: T,
) -> Handle {
    if may_be_shared && task.shares_what_it_stores() && !value.is_bound(&task.own) {
        return Handle(values.push(value));
    }
    store_in_task(slot, task, key, value)
}

impl<'s, K: NodeKey, T: Follow + Send + 's, W: Location, A: Alloc>
    ByNodeIndirect<K, T, Buffered<W>, A>
{
    #[inline]
    pub fn get_ref(&self, task: &Task<'s>, key: &K) -> Option<&T> {
        let handle = self.handles.get(task, key)?;
        Some(indirect_at(&self.values, &self.in_task, task, handle))
    }

    /// See `ByNode::commit_of`.
    pub(crate) fn commit_of(&self, key: K) -> Option<u32> {
        self.handles.commit_of(key)
    }

    /// Doesn't overwrite an existing value. Returns the stored value.
    pub fn insert_ref(&self, task: &Task<'s>, key: K, value: T, stored: Stored) -> &T {
        let slot = &self.in_task;
        let handle = self.handles.get(task, &key).unwrap_or_else(|| {
            let word = node_word(key.file().0, key.index());
            let has_cell = self.handles.bases.at(key.file(), key.index()).is_some();
            let new_handle = store_value((&self.values, slot), task, (word, has_cell), value);
            self.handles.insert(task, key, new_handle, stored)
        });
        indirect_at(&self.values, slot, task, handle)
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

impl<'s, I: Id + Follow, T: Follow + Send + 's, W: Location, A: Alloc>
    ByIdIndirect<I, T, Buffered<W>, A>
{
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
        indirect_at(&self.values, &self.in_task, task, handle)
    }

    /// Doesn't overwrite an existing value. Returns the stored value.
    pub fn insert_ref(&self, task: &Task<'s>, key: I, value: T, stored: Stored) -> (Handle, &T) {
        let known = self.handles.get(task, &key);
        let handle = known.unwrap_or_else(|| self.insert_absent(task, key, value, stored));
        (handle, self.at(task, handle))
    }

    /// `insert_ref` for a key that the task has just looked up and not found.
    fn insert_absent(&self, task: &Task<'s>, key: I, mut value: T, stored: Stored) -> Handle {
        let is_for_all = key.local_number().is_none()
            && task.shares_what_it_stores()
            && !value.is_bound(&task.own);
        let is_immediate = task.may_write_immediately(self.handles.slot, stored);
        if is_for_all && is_immediate && stays_in_task(task, &key) {
            let new_handle = store_in_task(&self.in_task, task, u64::from(key.number()), value);
            return self.handles.insert_for_this_task(task, key, new_handle);
        }
        // A handle with `LOCAL` is meaningless to another task.
        let holds_own =
            (self.held_handle).is_some_and(|field| field(&mut value).local_number().is_some());
        if !is_for_all || holds_own {
            if is_for_all {
                task.hold_back();
            }
            let new_handle = store_in_task(&self.in_task, task, u64::from(key.number()), value);
            return self.handles.insert_in_task(task, key, new_handle);
        }
        // A value that loses the race stays allocated, and nothing refers to it.
        let new_handle = Handle(self.values.push(value));
        self.handles.insert(task, key, new_handle, stored)
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

    /// Declares that this table's values hold handles of `referenced`, in the field that `field`
    /// returns. A value whose handle is task-local stays in the task. `referenced` must come before
    /// this table in `buffered_fields!`. Call this after `set_slot`.
    pub(crate) fn hold_handles_of<J: Id, U, X: Location>(
        &mut self,
        referenced: &ByIdIndirect<J, U, Buffered<X>, A>,
        field: fn(&mut T) -> &mut Handle,
    ) {
        assert!(referenced.handles.slot < self.handles.slot);
        self.held_handle = Some(field);
    }
}

impl<'s, K, V, W: Location, A: Alloc> ByKey<K, V, Buffered<W>, A>
where
    K: Windowed + Eq + Clone + MaybeLocal + Follow + Send + 's,
    V: Copy + Follow + Send + 's,
{
    /// Tries to store the entry in the shared part. Returns `Ok` with the key's shared entry if that worked or another
    /// task got there first. Returns `Err` if the caller has to store the entry in the task-local part, with true if a
    /// commit should store it later. `spread` is `key`'s hash.
    #[inline]
    fn put_immediately(
        &self,
        task: &Task<'s>,
        (spread, key, value): (u64, &K, V),
        stored: Stored,
    ) -> Result<V, bool> {
        if !task.writes_immediately() || key.is_bound(&task.own) || value.is_bound(&task.own) {
            return Err(true);
        }
        // If the task already has a deferred entry under the key, it keeps using that one.
        let own = || task.buffer().typed(&self.slot)?.get(spread, key).copied();
        if !task.may_write_immediately(self.slot.number(), stored) || own().is_some() {
            task.hold_back();
            return Err(true);
        }
        if stays_in_task(task, key) {
            return Err(false);
        }
        let is_first = self.published.add_if_absent(spread, key, value);
        if is_first {
            return Ok(value);
        }
        (self.published.get_acquire(spread, key).copied()).ok_or(true)
    }

    /// `spread` is `key`'s hash.
    #[inline]
    fn published(&self, task: &Task<'s>, spread: u64, key: &K) -> Option<V> {
        if key.is_local() {
            return None;
        }
        match task.commits() {
            true => self.published.get_acquire(spread, key).copied(),
            false => self.published.get_frozen(spread, key).copied(),
        }
    }

    /// Stores immediately if possible, otherwise in the task-local part. An existing task-local entry is replaced if
    /// `replaces` is set, and stays otherwise. Returns the key's entry afterwards.
    #[inline]
    fn put(
        &self,
        task: &Task<'s>,
        (spread, key, value): (u64, K, V),
        stored: Stored,
        replaces: bool,
    ) -> V {
        let is_committed = match self.put_immediately(task, (spread, &key, value), stored) {
            Ok(shared_value) => return shared_value,
            Err(is_committed) => is_committed,
        };
        let is_shared = is_committed && !key.is_local();
        let own = task.buffer().typed_or_new(&self.slot);
        let new_index = own.len();
        let current = match replaces {
            true => {
                own.replace(spread, key, value);
                value
            }
            false => *own.insert(spread, key, value),
        };
        // An existing entry is already logged, and a commit stores whatever value it has at that point.
        if is_shared && own.len() != new_index {
            task.buffer()
                .log_record(self.slot.number(), new_index as u32);
        }
        current
    }

    #[inline]
    pub fn get(&self, task: &Task<'s>, key: &K) -> Option<V> {
        let spread = spread_in_window(key);
        if let Some(value) = self.published(task, spread, key) {
            return Some(value);
        }
        (task.buffer().typed(&self.slot)?.get(spread, key)).copied()
    }

    #[inline]
    pub fn insert(&self, task: &Task<'s>, key: K, value: V, stored: Stored) -> V {
        let spread = spread_in_window(&key);
        if let Some(value) = self.published(task, spread, &key) {
            return value;
        }
        self.put(task, (spread, key, value), stored, false)
    }

    /// An entry that was written immediately is published, so this doesn't change it. Code that stores an entry it will
    /// replace later must store it with `Stored::held_back`.
    pub fn rewrite(&self, task: &Task<'s>, key: K, value: V, stored: Stored) {
        let spread = spread_in_window(&key);
        if self.published(task, spread, &key).is_none() {
            self.put(task, (spread, key, value), stored, true);
        }
    }

    /// `get`, but a miss returns `Err` with `key`'s hash, for `insert_absent` and `rewrite_absent`.
    #[inline]
    pub fn get_or_hash(&self, task: &Task<'s>, key: &K) -> Result<V, u64> {
        let spread = spread_in_window(key);
        if let Some(value) = self.published(task, spread, key) {
            return Ok(value);
        }
        let own = task.buffer().typed(&self.slot);
        own.and_then(|own| own.get(spread, key))
            .copied()
            .ok_or(spread)
    }

    /// `insert` for a key for which `get_or_hash` returned `Err(spread)` in this task. If a commit has
    /// stored an entry in the meantime, `get` returns that one from now on.
    #[inline]
    pub fn insert_absent(
        &self,
        task: &Task<'s>,
        spread: u64,
        key: K,
        value: V,
        stored: Stored,
    ) -> V {
        self.put(task, (spread, key, value), stored, false)
    }

    /// `rewrite` for a key for which `get_or_hash` returned `Err(spread)` in this task.
    #[inline]
    pub fn rewrite_absent(&self, task: &Task<'s>, spread: u64, key: K, value: V, stored: Stored) {
        self.put(task, (spread, key, value), stored, true);
    }
}

// ───────────────────────────── `Buffered`: commits ─────────────────────────────

/// The part of a `Buffered` table's interface that commits use.
pub(crate) trait Publish<'s>: Sync {
    /// Stores `task`'s entry under `key` in the shared part, unless the entry is bound or the shared part already has
    /// one. Returns true if it was stored. The task keeps its entry. Runs in a commit of `task`, on its thread, under
    /// the commit mutex, while other tasks read the table. `key` comes from the task's `Log`. `number` is the commit's
    /// number.
    fn store_logged(&self, task: &Task<'s>, key: u64, number: u32) -> bool;

    /// Returns a number that identifies the entry `task` has logged under `key`, and that's the same in every task that
    /// stores an entry for the same thing. A published id and a node are already such numbers.
    fn identity_of_logged(&self, _task: &Task<'s>, key: u64) -> u64 {
        key
    }
}

/// The shared part of a table with one cell per key, as commits use it. A shared-part key is one
/// number: the node's index in the concatenation of all nodes, or the id's number.
pub(crate) trait Dense: Sync {
    type Value: Packed<Cell = AtomicU32>;
    /// Returns the published entry, or 0 if there is none.
    fn load(&self, key: u32) -> u32;
    /// Precondition: the cell is empty, and the caller is the only thread that writes to the table.
    /// The store is a release, because other threads read during a commit.
    fn store(&self, key: u32, raw: u32);
    /// Returns a task's entry under `key`, which comes from its `Log`, or 0 if there is none.
    fn own(&self, buffer: &Buffer<'_>, key: u64) -> u32;
    /// Returns the shared-part key for `key`, which comes from a `Log`, or `None` if `key -> value` is bound.
    fn shared_key(&self, key: u64, value: &impl Follow, own: &OwnStore) -> Option<u32>;
    /// Called in commit `number`. Stores `raw` under `key` unless there's already an entry. Returns true if it stored.
    fn store_in_commit(&self, key: u32, raw: u32, number: u32) -> bool;
}

impl<K: NodeKey, V: Packed<Cell = AtomicU32>, W: Location, A: Alloc> Dense
    for ByNode<K, V, Buffered<W>, A>
{
    type Value = V;

    #[inline]
    fn load(&self, key: u32) -> u32 {
        self.published_at(key as usize)
    }

    #[inline]
    fn store(&self, key: u32, raw: u32) {
        let (cell, shift) = self.field_at(key as usize);
        cell.store(
            cell.load(Ordering::Relaxed) | raw << shift,
            Ordering::Release,
        );
    }

    #[inline]
    fn own(&self, buffer: &Buffer<'_>, key: u64) -> u32 {
        let (file, index) = ((key >> 32) as u32, key as u32);
        match buffer.shadowed(self.slot, file, index) {
            0 => {
                let at = self.bases.at(FileId(file), index);
                buffer.node_anywhere(self.slot, file, index, at)
            }
            raw => raw,
        }
    }

    #[inline]
    fn shared_key(&self, key: u64, value: &impl Follow, own: &OwnStore) -> Option<u32> {
        let file = FileId((key >> 32) as u32);
        let at = self.bases.at(file, key as u32)?;
        (!file.is_bound(own) && !value.is_bound(own)).then_some(at as u32)
    }

    /// Only commits write to the table, one at a time. The commit number is stored before the entry.
    #[inline]
    fn store_in_commit(&self, key: u32, raw: u32, number: u32) -> bool {
        let is_first = self.load(key) == 0;
        if is_first {
            self.stamps.cell(key).store(number, Ordering::Relaxed);
            self.store(key, raw);
        }
        is_first
    }
}

impl<I: Id + Follow, V: Packed<Cell = AtomicU32>, W: Location, A: Alloc> Dense
    for ById<I, V, Buffered<W>, A>
{
    type Value = V;

    #[inline]
    fn load(&self, key: u32) -> u32 {
        self.published(key)
    }

    #[inline]
    fn store(&self, key: u32, raw: u32) {
        self.cells.cell(key).store(raw, Ordering::Release);
    }

    #[inline]
    fn own(&self, buffer: &Buffer<'_>, key: u64) -> u32 {
        buffer.published_id(self.slot, key as u32)
    }

    #[inline]
    fn shared_key(&self, key: u64, value: &impl Follow, own: &OwnStore) -> Option<u32> {
        let id = I::from_number(key as u32);
        (!id.is_bound(own) && !value.is_bound(own)).then_some(key as u32)
    }

    /// Other tasks may write to the table immediately at the same time. An entry under a record is visible to every
    /// task as soon as it's stored.
    #[inline]
    fn store_in_commit(&self, key: u32, raw: u32, _: u32) -> bool {
        let cell = self.cells.cell(key);
        cell.load(Ordering::Relaxed) == 0 && cell.put_if_empty(raw) == raw
    }
}

/// `Publish::store_logged` for a table with one cell per key.
fn store_logged_cell<D: Dense<Value: Follow>>(
    table: &D,
    task: &Task,
    key: u64,
    number: u32,
) -> bool {
    let raw = table.own(task.buffer(), key);
    if raw == 0 {
        return false;
    }
    let computed = D::Value::unpack(raw);
    let Some(shared_key) = table.shared_key(key, &computed, &task.own) else {
        return false;
    };
    table.store_in_commit(shared_key, raw, number)
}

/// `Publish::store_logged` for an indirect table. A value whose handle has `LOCAL` is bound (see `store_value`).
fn store_logged_handle<D: Dense<Value = Handle>>(
    handles: &D,
    task: &Task,
    key: u64,
    number: u32,
) -> bool {
    let raw = handles.own(task.buffer(), key);
    if raw == 0 || Handle::unpack(raw).local_number().is_some() {
        return false;
    }
    store_logged_cell(handles, task, key, number)
}

/// A table whose values fit in a cell.
impl<'s, D: Dense<Value: Follow>> Publish<'s> for D {
    fn store_logged(&self, task: &Task<'s>, key: u64, number: u32) -> bool {
        store_logged_cell(self, task, key, number)
    }
}

impl<'s, K: NodeKey, T: Follow + Send + Sync + 's, W: Location, A: Alloc> Publish<'s>
    for ByNodeIndirect<K, T, Buffered<W>, A>
{
    fn store_logged(&self, task: &Task<'s>, key: u64, number: u32) -> bool {
        store_logged_handle(&self.handles, task, key, number)
    }
}

impl<'s, I: Id + Follow, T: Follow + Send + Sync + 's, W: Location, A: Alloc> Publish<'s>
    for ByIdIndirect<I, T, Buffered<W>, A>
{
    fn store_logged(&self, task: &Task<'s>, key: u64, number: u32) -> bool {
        store_logged_handle(&self.handles, task, key, number)
    }
}

impl<'s, K, V, W: Location, A: Alloc> Publish<'s> for ByKey<K, V, Buffered<W>, A>
where
    K: Windowed + Eq + Clone + Follow + Send + Sync + 's,
    V: Copy + Follow + Send + Sync + 's,
{
    /// `key` is the entry's index in the task's `Hashed`.
    fn store_logged(&self, task: &Task<'s>, key: u64, _: u32) -> bool {
        let own = task.buffer().typed(&self.slot);
        let Some((key, value)) = own.and_then(|own| own.entry(key as u32)) else {
            return false;
        };
        if key.is_bound(&task.own) || value.is_bound(&task.own) {
            return false;
        }
        let spread = spread_in_window(key);
        self.published.add_if_absent(spread, key, *value)
    }

    /// `key` is an index into the task's own `Hashed`, which is meaningless to another task. Only keys without
    /// task-local ids are logged, so the hash is the same in every task.
    fn identity_of_logged(&self, task: &Task<'s>, key: u64) -> u64 {
        let own = task.buffer().typed(&self.slot);
        own.and_then(|own| own.entry(key as u32))
            .map_or(key, |(key, _)| spread_hash(key))
    }
}

// ───────────────────────────── `FileLocal` ─────────────────────────────

/// Where a `FileLocal` table stores a node's value.
struct WordAndShift {
    /// Index of the word among the file's words.
    word: u32,
    /// Bit offset of the node's value within the word.
    shift: u32,
}

/// There's no shared part. Values are stored in 64-bit words. A one- or two-bit value shares its word
/// with the neighboring nodes' values.
impl<K: NodeKey, V: Packed, A: Alloc> ByNode<K, V, FileLocal, A> {
    #[inline]
    fn word_and_shift(index: u32) -> WordAndShift {
        match V::BITS {
            0 => WordAndShift {
                word: index,
                shift: 0,
            },
            bits => WordAndShift {
                word: index / (64 / bits),
                shift: index % (64 / bits) * bits,
            },
        }
    }

    #[inline]
    pub fn get(&self, task: &Task, key: &K) -> Option<V> {
        let WordAndShift { word, shift } = Self::word_and_shift(key.index());
        let raw = task.file_local().cell(self.slot, key.file().0, word) >> shift & Self::MASK;
        (raw != 0).then(|| V::unpack(V::Cell::narrow(raw)))
    }

    /// Doesn't overwrite an existing value. Returns the stored value.
    #[inline]
    pub fn insert(&self, task: &Task, key: K, value: V) -> V {
        // Callers occasionally pass `NONE`.
        if key.index() == u32::MAX {
            return value;
        }
        if V::BITS != 0 {
            if let Some(previous) = self.get(task, &key) {
                return previous;
            }
            self.rewrite(task, key, value);
            return value;
        }
        let raw = V::Cell::widen(value.pack());
        let current = (task.file_local()).put_if_empty(self.slot, key.file().0, key.index(), raw);
        V::unpack(V::Cell::narrow(current))
    }

    /// Stores `value`, overwriting any existing value.
    #[inline]
    pub fn rewrite(&self, task: &Task, key: K, value: V) {
        if key.index() == u32::MAX {
            return;
        }
        let (file, raw) = (key.file().0, V::Cell::widen(value.pack()));
        let WordAndShift { word, shift } = Self::word_and_shift(key.index());
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
