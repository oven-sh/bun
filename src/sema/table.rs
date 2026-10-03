//! Tables that are indexed by the number a thing already has.
//!
//! Nodes and symbols are numbered within their file and types as they are made, so what is worked out about one needs no hashing: it
//! goes in an array. A cell starts out as zero, "not worked out", and is written once. Reading is one load.
//!
//! The memory comes zero-filled from the allocator, which for arrays this size means from the system: a page nobody touches is never
//! there.
//!
//! WHO WRITES AN ENTRY, AND WHO SEES IT WHEN, IS THE THIRD TYPE PARAMETER OF A TABLE: `Frozen`, `Buffered`, `FileLocal`. See `Policy`.

use crate::atom::{Atom, Interner};
use crate::check::task::{Stored, Task};
use crate::local::{Chunked, Half, Hashed, LOCAL, MaybeLocal, is_local_number, node_word};
use crate::program::{FileId, Sym};
use crate::types::{ComponentsId, Follow, Link, MapperId, Marks, OwnStore, SigId, TypeId, Visitor};
use crate::util::{AppendVec, FxHasher, SHARDS, ShardedMap, shard_of, spread_hash};
use std::alloc::Layout;
use std::any::Any;
use std::hash::{Hash, Hasher};
use std::marker::PhantomData;
use std::ptr::NonNull;
use std::sync::Arc;
use std::sync::atomic::{AtomicPtr, AtomicU32, AtomicU64, Ordering};

/// An atomic integer. All bits zero is a valid one, holding zero.
///
/// # Safety
/// That has to be true.
pub unsafe trait Cell: Sync + Send {
    type Raw: Copy + PartialEq + Default;
    fn widen(raw: Self::Raw) -> u64;
    fn narrow(raw: u64) -> Self::Raw;
    /// A PLAIN LOAD. Nobody writes to a cell while tasks run, and a barrier has ordered what was written before.
    fn load(&self) -> Self::Raw;
    /// What the cell holds afterwards: `raw`, or what was there first.
    fn put_if_empty(&self, raw: Self::Raw) -> Self::Raw;
    /// `put_if_empty` for the bits of `mask` from `shift` on. The other bits of the cell belong to other keys.
    fn put_field_if_empty(&self, shift: u32, mask: u64, raw: Self::Raw) -> Self::Raw;
}

macro_rules! cell {
    ($atomic:ty, $raw:ty) => {
        // SAFETY: an atomic integer has the layout of the integer.
        unsafe impl Cell for $atomic {
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

/// A value that fits a cell. It is never packed as zero.
pub trait Packed: Copy {
    type Cell: Cell;
    /// How many bits a packed value needs, if the values of several keys are to share a cell. 0: a value has a cell to itself.
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

/// Something that goes by a number, counted from zero without gaps worth speaking of.
pub trait Id: Copy {
    fn number(self) -> u32;
    fn from_number(number: u32) -> Self;
    /// `Some`: it belongs to a task, and this is its number among those of the task.
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
/// Files and nodes are numbered before the first step. For the keys of a `ByKey` that have one beside an id.
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

// ───────────────────────────── the memory ─────────────────────────────

/// So many cells, all zero to begin with.
struct Flat<C> {
    cells: NonNull<C>,
    len: usize,
}

// SAFETY: owns its cells, which are `Sync` and `Send`.
unsafe impl<C: Cell> Sync for Flat<C> {}
// SAFETY: as above.
unsafe impl<C: Cell> Send for Flat<C> {}

impl<C: Cell> Flat<C> {
    fn new(len: usize) -> Flat<C> {
        if len == 0 {
            return Flat {
                cells: NonNull::dangling(),
                len,
            };
        }
        let layout = Layout::array::<C>(len).unwrap();
        // SAFETY: the size is not zero.
        let cells = unsafe { std::alloc::alloc_zeroed(layout) }.cast::<C>();
        Flat {
            cells: NonNull::new(cells).unwrap_or_else(|| std::alloc::handle_alloc_error(layout)),
            len,
        }
    }

    fn footprint(&self) -> Footprint {
        // SAFETY: the allocation, or no cell at all. All zero is a valid `C`.
        Footprint::of_cells(unsafe { std::slice::from_raw_parts(self.cells.as_ptr(), self.len) })
    }

    #[inline]
    fn cell(&self, index: usize) -> &C {
        assert!(index < self.len);
        // SAFETY: inside the allocation, and all zero is a valid `C`.
        unsafe { &*self.cells.as_ptr().add(index) }
    }
}

impl<C> Drop for Flat<C> {
    fn drop(&mut self) {
        if self.len != 0 {
            // SAFETY: allocated in `new` with this layout. Cells have nothing to drop.
            unsafe {
                std::alloc::dealloc(
                    self.cells.as_ptr().cast::<u8>(),
                    Layout::array::<C>(self.len).unwrap(),
                );
            }
        }
    }
}

const FIRST_SEGMENT_BITS: u32 = 12;
/// One for each number of leading zeros a `u64` can have.
const SEGMENTS: usize = 65;

/// Cells for numbers that keep coming, all zero to begin with. Each segment is as long as all the ones before it together, so there are
/// few of them, they never move, and which one a number is in takes counting its leading zeros. What is kept of a segment is where it
/// would begin if it held the cells before it as well: see `locate`.
struct Segmented<C> {
    segments: [AtomicPtr<C>; SEGMENTS],
}

// SAFETY: owns its cells, which are `Sync` and `Send`.
unsafe impl<C: Cell> Sync for Segmented<C> {}
// SAFETY: as above.
unsafe impl<C: Cell> Send for Segmented<C> {}

/// Which segment `index` is in, and how far its cell is from what is kept of the segment.
#[inline]
fn locate(index: u32) -> (usize, usize) {
    let n = u64::from(index) + (1 << FIRST_SEGMENT_BITS);
    (n.leading_zeros() as usize, n as usize)
}

/// Also how far the segment is from what is kept of it.
#[inline]
fn segment_len(segment: usize) -> usize {
    1usize << (63 - segment)
}

impl<C: Cell> Segmented<C> {
    fn new() -> Segmented<C> {
        Segmented {
            segments: [const { AtomicPtr::new(std::ptr::null_mut()) }; SEGMENTS],
        }
    }

    fn footprint(&self) -> Footprint {
        let mut all = Footprint::default();
        for (segment, base) in self.segments.iter().enumerate() {
            let (base, len) = (base.load(Ordering::Acquire), segment_len(segment));
            if !base.is_null() {
                // SAFETY: what is kept of a segment is as far before it as it is long. All zero is a valid `C`.
                let cells = unsafe { std::slice::from_raw_parts(base.wrapping_add(len), len) };
                all = all.plus(Footprint::of_cells(cells));
            }
        }
        all
    }

    /// `None`: nothing has been written anywhere near. While tasks run: plain loads.
    #[inline]
    fn existing_cell(&self, index: u32) -> Option<&C> {
        let (segment, offset) = locate(index);
        // SAFETY: there is a place for every number of leading zeros.
        let base = unsafe { self.segments.get_unchecked(segment) }.load(Ordering::Relaxed);
        if base.is_null() {
            return None;
        }
        // SAFETY: inside the segment, and all zero is a valid `C`.
        Some(unsafe { &*base.wrapping_add(offset) })
    }

    #[inline]
    fn cell(&self, index: u32) -> &C {
        let (segment, offset) = locate(index);
        // SAFETY: there is a place for every number of leading zeros.
        let mut base = unsafe { self.segments.get_unchecked(segment) }.load(Ordering::Acquire);
        if base.is_null() {
            base = self.install(segment);
        }
        // SAFETY: inside the segment, and all zero is a valid `C`.
        unsafe { &*base.wrapping_add(offset) }
    }

    /// Several threads may get here at once. The first to put its segment in place wins.
    #[cold]
    fn install(&self, segment: usize) -> *mut C {
        let layout = Layout::array::<C>(segment_len(segment)).unwrap();
        // SAFETY: the size is not zero.
        let fresh = unsafe { std::alloc::alloc_zeroed(layout) }.cast::<C>();
        if fresh.is_null() {
            std::alloc::handle_alloc_error(layout);
        }
        let base = fresh.wrapping_sub(segment_len(segment));
        // Null is for a segment that is not there.
        assert!(!base.is_null());
        match self.segments[segment].compare_exchange(
            std::ptr::null_mut(),
            base,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => base,
            Err(installed) => {
                // SAFETY: allocated above with this layout, and shown to nobody.
                unsafe { std::alloc::dealloc(fresh.cast::<u8>(), layout) };
                installed
            }
        }
    }
}

impl<C> Drop for Segmented<C> {
    fn drop(&mut self) {
        for (segment, slot) in self.segments.iter_mut().enumerate() {
            let base = *slot.get_mut();
            if !base.is_null() {
                // SAFETY: allocated in `install` with this layout. Cells have nothing to drop.
                unsafe {
                    std::alloc::dealloc(
                        base.wrapping_add(segment_len(segment)).cast::<u8>(),
                        Layout::array::<C>(segment_len(segment)).unwrap(),
                    );
                }
            }
        }
    }
}

// ───────────────────────────── by node ─────────────────────────────

/// Where the nodes of one kind of each file begin when those of all files are laid end to end. One more entry says where they end.
#[derive(Clone)]
pub struct Bases(Arc<[u32]>);

impl Bases {
    pub fn new(lengths: impl Iterator<Item = usize>) -> Bases {
        let mut total = 0usize;
        let mut bases = vec![0u32];
        for len in lengths {
            total += len;
            bases.push(u32::try_from(total).expect("more nodes of a kind than fit 32 bits"));
        }
        Bases(bases.into())
    }

    /// No file has a node.
    pub(crate) fn none() -> Bases {
        Bases(Arc::from([0]))
    }

    #[inline]
    fn total(&self) -> usize {
        *self.0.last().unwrap() as usize
    }

    /// `None`: there is no such node. `NONE` is asked about now and then.
    #[inline]
    fn at(&self, file: FileId, index: u32) -> Option<usize> {
        // The later one first: where that is in bounds the other is, and is not checked.
        let (end, start) = (self.0[file.idx() + 1], self.0[file.idx()]);
        (index < end - start).then(|| (start + index) as usize)
    }
}

/// A node or a symbol: a file, and a number within it.
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

impl From<crate::bind::ScopeId> for u32 {
    #[inline]
    fn from(scope: crate::bind::ScopeId) -> u32 {
        scope.0
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

/// Who writes an entry of a table, and who sees it when.
pub trait Policy {
    const IS_FILE_LOCAL: bool = false;
}

/// WRITTEN BEFORE THE FIRST STEP, OR AT A BARRIER. READ-ONLY WHILE TASKS RUN, so `get` is plain loads. For the tables of the loader, the link
/// step and the type store. Many threads of a link step can fill one at once: a cell is written with a compare and swap, and the
/// first value is kept. Whoever reads what another thread has written has a barrier in between.
pub struct Frozen;

/// THE DEFAULT FOR A FIELD OF `Program`. The table has the PUBLISHED half, which only `publish` writes, at a barrier. What a task
/// stores goes to the task's own half (`crate::local::Half`), which no other task sees. `Task::finish` hands it to the barrier.
pub struct Buffered;

/// The entries are in the task and end with the file that the task goes through. No other task ever sees one.
pub struct FileLocal;

impl Policy for Frozen {}
impl Policy for Buffered {}
impl Policy for FileLocal {
    const IS_FILE_LOCAL: bool = true;
}

/// What a table holds, for `--timing`. Finding out reads every cell.
#[derive(Copy, Clone, Default, Debug)]
pub struct Footprint {
    /// Bytes asked of the allocator: cells, map entries, kept values without what they point to.
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

    fn with_indirect<T>(self, kept: &AppendVec<T>) -> Footprint {
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

/// No slot: `number_tables` has not come by. A `Frozen` table needs none.
const NO_SLOT: u32 = u32::MAX;

/// A value for each node of one kind in the program.
pub struct ByNode<K, V: Packed, P: Policy = Frozen> {
    bases: Bases,
    cells: Flat<V::Cell>,
    /// By which the table finds what a task has for it.
    slot: u32,
    key: PhantomData<fn(K, P)>,
}

impl<K: NodeKey, V: Packed, P: Policy> ByNode<K, V, P> {
    /// How many keys share a cell.
    const PER_CELL: usize = if V::BITS != 0 {
        size_of::<V::Cell>() * 8 / V::BITS as usize
    } else {
        1
    };
    /// The bits of one key, once they are shifted down.
    const MASK: u64 = if V::BITS != 0 {
        (1 << V::BITS) - 1
    } else {
        u64::MAX
    };

    pub fn new(bases: &Bases) -> Self {
        let bases = if P::IS_FILE_LOCAL {
            Bases::none()
        } else {
            bases.clone()
        };
        ByNode {
            cells: Flat::new(bases.total().div_ceil(Self::PER_CELL)),
            bases,
            slot: NO_SLOT,
            key: PhantomData,
        }
    }

    pub(crate) fn set_slot(&mut self, slot: u32) {
        self.slot = slot;
    }

    /// The cell of the key at `at` when all keys are laid end to end, and where in it the bits of the key begin.
    #[inline]
    fn field_at(&self, at: usize) -> (&V::Cell, u32) {
        let shift = (at % Self::PER_CELL) as u32 * V::BITS;
        (self.cells.cell(at / Self::PER_CELL), shift)
    }

    /// `None`: there is no such node.
    #[inline]
    fn field(&self, key: K) -> Option<(&V::Cell, u32)> {
        Some(self.field_at(self.bases.at(key.file(), key.index())?))
    }

    pub fn footprint(&self) -> Footprint {
        self.cells.footprint()
    }
}

/// For a table whose owner lays out the bits.
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

impl<K: NodeKey> ByNode<K, RawWord, Frozen> {
    #[inline]
    pub fn raw(&self, key: K) -> u32 {
        self.get(&key).map_or(0, |word| word.0)
    }
}

/// Where a kept table has a value. With `LOCAL`: in the task. A HANDLE IS NOT A VALUE: it is not an id of the type store, and the link of
/// a task says nothing about it. See `ByIdIndirect::hold_handles_of`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Handle(pub u32);
packed_ids!(Handle);
crate::types::has_no_references!(Handle);

/// Something that does not fit a cell for some of the nodes of one kind. It is kept on the side and never moves.
pub struct ByNodeIndirect<K, T, P: Policy = Frozen> {
    handles: ByNode<K, Handle, P>,
    kept: AppendVec<T>,
}

impl<K: NodeKey, T: 'static, P: Policy> ByNodeIndirect<K, T, P> {
    pub fn footprint(&self) -> Footprint {
        self.handles.footprint().with_indirect(&self.kept)
    }

    pub fn new(bases: &Bases) -> Self {
        ByNodeIndirect {
            handles: ByNode::new(bases),
            kept: AppendVec::new(),
        }
    }

    pub(crate) fn set_slot(&mut self, slot: u32) {
        self.handles.slot = slot;
    }
}

/// A value for each of the things that are numbered as they are made.
pub struct ById<I, V: Packed, P: Policy = Frozen> {
    cells: Segmented<V::Cell>,
    slot: u32,
    key: PhantomData<fn(I, P)>,
}

impl<I: Id, V: Packed, P: Policy> Default for ById<I, V, P> {
    fn default() -> Self {
        ById {
            cells: Segmented::new(),
            slot: NO_SLOT,
            key: PhantomData,
        }
    }
}

impl<I: Id, V: Packed, P: Policy> ById<I, V, P> {
    pub fn footprint(&self) -> Footprint {
        self.cells.footprint()
    }

    pub(crate) fn set_slot(&mut self, slot: u32) {
        self.slot = slot;
    }
}

/// Something that does not fit a cell for some of the things that are numbered as they are made.
pub struct ByIdIndirect<I, T, P: Policy = Frozen> {
    handles: ById<I, Handle, P>,
    kept: AppendVec<T>,
    holding: Holding<T>,
}

impl<I: Id, T, P: Policy> Default for ByIdIndirect<I, T, P> {
    fn default() -> Self {
        ByIdIndirect {
            handles: ById::default(),
            kept: AppendVec::new(),
            holding: Holding::default(),
        }
    }
}

impl<I: Id, T: 'static, P: Policy> ByIdIndirect<I, T, P> {
    pub fn footprint(&self) -> Footprint {
        self.handles.footprint().with_indirect(&self.kept)
    }

    pub(crate) fn set_slot(&mut self, slot: u32) {
        self.handles.slot = slot;
    }
}

/// A memo table for what goes by more than a number.
pub struct ByKey<K, V, P: Policy = Frozen> {
    published: ShardedMap<K, V>,
    slot: u32,
    policy: PhantomData<fn(P)>,
}

impl<K: std::hash::Hash + Eq, V, P: Policy> ByKey<K, V, P> {
    /// Without the index of the map, which has a few bytes for each entry.
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

    pub(crate) fn set_slot(&mut self, slot: u32) {
        self.slot = slot;
    }
}

impl<K: std::hash::Hash + Eq, V, P: Policy> Default for ByKey<K, V, P> {
    fn default() -> Self {
        ByKey {
            published: Default::default(),
            slot: NO_SLOT,
            policy: PhantomData,
        }
    }
}

// ───────────────────────────── `Frozen` ─────────────────────────────

impl<K: NodeKey, V: Packed> ByNode<K, V, Frozen> {
    #[inline]
    pub fn get(&self, key: &K) -> Option<V> {
        let (cell, shift) = self.field(*key)?;
        let raw = V::Cell::narrow(V::Cell::widen(cell.load()) >> shift & Self::MASK);
        (raw != Default::default()).then(|| V::unpack(raw))
    }

    /// Keeps what is there already, and returns what is kept.
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

impl<K: NodeKey, T: 'static> ByNodeIndirect<K, T, Frozen> {
    #[inline]
    pub fn get_ref(&self, key: &K) -> Option<&T> {
        self.handles.get(key).map(|handle| self.kept.get(handle.0))
    }

    /// Keeps what is there already, and returns what is kept. The value is in place before its handle is in a cell. If another handle is
    /// kept there, the value is never reached.
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

impl<I: Id, V: Packed> ById<I, V, Frozen> {
    /// `None` for an id with `LOCAL`: nothing is published about it.
    #[inline]
    pub fn get(&self, key: &I) -> Option<V> {
        let raw = self.cells.existing_cell(key.number())?.load();
        (raw != Default::default()).then(|| V::unpack(raw))
    }

    /// Keeps what is there already, and returns what is kept.
    #[inline]
    pub fn insert(&self, key: I, value: V) -> V {
        assert!(key.local_number().is_none());
        V::unpack(self.cells.cell(key.number()).put_if_empty(value.pack()))
    }
}

// ───────────────────────────── `Buffered`: during a step ─────────────────────────────
//
// `get`: A HIT ON A PUBLISHED ENTRY IS ONE PLAIN LOAD. The published half is frozen during a step, and the barrier before the step has
// ordered what was written to it, so the load is relaxed. Only if the cell is empty, the task's half is asked. An id with `LOCAL` has
// no published cell: the task's dense half.
// `insert`: into the task's half. It keeps what is there, published or not, and returns what is kept: what `get` returns from now on.
// `rewrite`: replaces the task's entry. A published entry stays what it is.

impl<K: NodeKey, V: Packed<Cell = AtomicU32>> ByNode<K, V, Buffered> {
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
        // `NONE` is asked about now and then.
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

impl<I: Id, V: Packed<Cell = AtomicU32>> ById<I, V, Buffered> {
    /// 0: nothing is published for the id `number`.
    #[inline]
    fn published(&self, number: u32) -> u32 {
        (self.cells.existing_cell(number)).map_or(0, |cell| cell.load(Ordering::Relaxed))
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

/// The values that a task keeps for a kept table, each with its key as the task's half has it, by handle without `LOCAL`.
type IndirectInTask<T> = Chunked<(u64, T)>;

/// What `handle` stands for. THE REFERENCE HAS THE LIFETIME OF THE TABLE. One to a value that is in the task is good until the task ends
/// (`Task::finish`, `Task::begin`, the drop): whoever holds on to one, in a cache of the checker for example, lets go of it by then.
#[inline]
fn indirect_at<'p, T: 'static>(
    kept: &'p AppendVec<T>,
    slot: u32,
    task: &Task,
    handle: Handle,
) -> &'p T {
    match handle.local_number() {
        None => kept.get(handle.0),
        Some(number) => {
            let half = task.buffer().half(slot).unwrap();
            // SAFETY: the slot is that of a kept table of `T`, which has given out the handle.
            let value = &unsafe { half.typed::<IndirectInTask<T>>() }
                .unwrap()
                .get(number as usize)
                .1;
            // SAFETY: an element of a `Chunked` does not move, and is there until the task ends. See above.
            unsafe { &*std::ptr::from_ref(value) }
        }
    }
}

fn store_in_task<T: Send + 'static>(slot: u32, task: &Task, key: u64, value: T) -> Handle {
    // SAFETY: the slot is that of a kept table of `T`.
    let kept = unsafe {
        task.buffer()
            .half_mut(slot)
            .typed_mut::<IndirectInTask<T>>()
    };
    Handle(kept.push((key, value)) as u32 | LOCAL)
}

impl<K: NodeKey, T: Send + 'static> ByNodeIndirect<K, T, Buffered> {
    #[inline]
    pub fn get_ref(&self, task: &Task, key: &K) -> Option<&T> {
        let handle = self.handles.get(task, key)?;
        Some(indirect_at(&self.kept, self.handles.slot, task, handle))
    }

    /// Keeps what is there already, and returns what is kept.
    pub fn insert_ref(&self, task: &Task, key: K, value: T, stored: Stored) -> &T {
        let slot = self.handles.slot;
        let handle = self.handles.get(task, &key).unwrap_or_else(|| {
            let word = node_word(key.file().0, key.index());
            (self.handles).insert(task, key, store_in_task(slot, task, word, value), stored)
        });
        indirect_at(&self.kept, slot, task, handle)
    }

    #[inline]
    pub fn get(&self, task: &Task, key: &K) -> Option<T>
    where
        T: Clone,
    {
        self.get_ref(task, key).cloned()
    }

    pub fn insert(&self, task: &Task, key: K, value: T, stored: Stored) -> T
    where
        T: Clone,
    {
        self.insert_ref(task, key, value, stored).clone()
    }
}

impl<I: Id, T: Send + 'static> ByIdIndirect<I, T, Buffered> {
    #[inline]
    pub fn get_ref(&self, task: &Task, key: &I) -> Option<&T> {
        self.handles
            .get(task, key)
            .map(|handle| self.at(task, handle))
    }

    #[inline]
    pub fn handle(&self, task: &Task, key: &I) -> Option<Handle> {
        self.handles.get(task, key)
    }

    /// See `indirect_at` for how long the reference is good.
    #[inline]
    pub fn at(&self, task: &Task, handle: Handle) -> &T {
        indirect_at(&self.kept, self.handles.slot, task, handle)
    }

    /// Keeps what is there already, and returns what is kept.
    pub fn insert_ref(&self, task: &Task, key: I, value: T, stored: Stored) -> (Handle, &T) {
        let handle = self.handles.get(task, &key).unwrap_or_else(|| {
            let kept = store_in_task(self.handles.slot, task, u64::from(key.number()), value);
            self.handles.insert(task, key, kept, stored)
        });
        (handle, self.at(task, handle))
    }

    #[inline]
    pub fn get(&self, task: &Task, key: &I) -> Option<T>
    where
        T: Clone,
    {
        self.get_ref(task, key).cloned()
    }

    pub fn insert(&self, task: &Task, key: I, value: T, stored: Stored) -> T
    where
        T: Clone,
    {
        self.insert_ref(task, key, value, stored).1.clone()
    }

    /// THE VALUES OF THIS TABLE HOLD HANDLES OF `held`, in the field that `field` returns. So an entry of this table is handed to the
    /// barrier only if the entry of `held` is, and one thread applies `held` and then this table, and puts the handle that WON into
    /// the field. `held` comes before this table in `buffered_fields!`. After `set_slot`.
    pub(crate) fn hold_handles_of<J: Id, U>(
        &mut self,
        held: &mut ByIdIndirect<J, U, Buffered>,
        field: fn(&mut T) -> &mut Handle,
    ) {
        assert!(held.handles.slot < self.handles.slot);
        held.holding.is_held = true;
        self.holding.holds = Some((held.handles.slot, field));
    }
}

impl<K, V> ByKey<K, V, Buffered>
where
    K: std::hash::Hash + Eq + MaybeLocal + Send + 'static,
    V: Copy + Send + 'static,
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
    pub fn get(&self, task: &Task, key: &K) -> Option<V> {
        let spread = spread_hash(key);
        if let Some(value) = self.published(spread, key) {
            return Some(value);
        }
        // SAFETY: the slot is this table's own.
        let buffered = unsafe { task.buffer().half(self.slot)?.typed::<Hashed<K, V>>() }?;
        buffered.get(spread, key).copied()
    }

    #[inline]
    pub fn insert(&self, task: &Task, key: K, value: V, _: Stored) -> V {
        let spread = spread_hash(&key);
        if let Some(value) = self.published(spread, &key) {
            return value;
        }
        // SAFETY: the slot is this table's own.
        let buffered = unsafe { (task.buffer().half_mut(self.slot)).typed_mut::<Hashed<K, V>>() };
        *buffered.insert(spread, key, value)
    }
}

// ───────────────────────────── `Buffered`: the end of a task, and the barrier ─────────────────────────────

/// A `Buffered` table, as `Task::finish` and `publish` see it.
pub(crate) trait Publish: Sync {
    fn slot(&self) -> u32;

    /// The slot of the table whose handles the values of this one hold.
    fn holds_handles_of(&self) -> Option<u32> {
        None
    }

    /// How many threads can apply entries at a time.
    fn parts(&self) -> usize {
        1
    }

    /// ON THE TASK'S OWN THREAD. Takes everything out of `half`. The entries whose key and value are not bound are returned, and what they
    /// mention is marked. The rest is dropped.
    fn finish(&self, half: &mut Half, finishing: &mut Finishing<'_>) -> Option<Entries>;

    /// AT THE BARRIER, on any thread. Rewrites every key and value of one task through the link of that task.
    fn follow(&self, entries: &mut Entries, link: &Link);

    /// AT THE BARRIER, BY THE ONE THREAD THAT HAS THIS PART OF THE TABLE. `shares`: in task order. The first entry for a key stays.
    /// `handles`, by task: see `Holding`.
    fn apply(
        &self,
        part: usize,
        shares: &mut [Share<'_>],
        handles: &mut [Vec<Handle>],
        applied: &mut Applied<'_>,
    );
}

/// What `Task::finish` lends to the tables.
pub(crate) struct Finishing<'a> {
    own: &'a OwnStore,
    marks: &'a mut Marks,
    /// For each table whose handles another one holds, by slot: for each handle of the task, 1 + the place of its entry among those that
    /// are handed over. 0: the entry is dropped.
    held: Vec<(u32, Vec<u32>)>,
}

impl<'a> Finishing<'a> {
    pub(crate) fn new(own: &'a OwnStore, marks: &'a mut Marks) -> Finishing<'a> {
        Finishing {
            own,
            marks,
            held: Vec::new(),
        }
    }

    /// Whether `key -> value` goes to the barrier. If it does, what it mentions is marked: THE ENTRIES ARE THE ROOTS.
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

/// What one task hands to the barrier for one table.
pub(crate) struct Entries {
    pub(crate) slot: u32,
    pub(crate) len: u32,
    /// `Vec<(u32, u32)>`, `Vec<(u32, T)>` or `Keyed<K, V>`: the table knows.
    typed: Box<dyn Any + Send + Sync>,
}

impl Entries {
    /// `None`: there are none.
    fn new<T: Send + Sync + 'static>(slot: u32, len: usize, typed: T) -> Option<Entries> {
        (len != 0).then(|| Entries {
            slot,
            len: len as u32,
            typed: Box::new(typed),
        })
    }

    fn typed<T: 'static>(&self) -> &T {
        self.typed.downcast_ref().unwrap()
    }

    fn typed_mut<T: 'static>(&mut self) -> &mut T {
        self.typed.downcast_mut().unwrap()
    }
}

pub(crate) enum Payload<'a> {
    /// The table has one part.
    Whole(&'a mut Entries),
    /// Each part has the same reference, and looks at its own entries.
    Part(&'a Entries),
}

/// The entries of one task in a `Stage` of `publish`.
pub(crate) struct Share<'a> {
    pub(crate) task: u32,
    pub(crate) len: u32,
    payload: Payload<'a>,
}

impl<'a> Share<'a> {
    pub(crate) fn new(task: u32, len: u32, payload: Payload<'a>) -> Share<'a> {
        Share { task, len, payload }
    }

    fn whole(&mut self) -> &mut Entries {
        match &mut self.payload {
            Payload::Whole(entries) => entries,
            Payload::Part(_) => unreachable!(),
        }
    }
}

/// What one thread has applied.
pub(crate) struct Applied<'a> {
    pub(crate) published: u64,
    /// The sum of the hashes of (slot, key, value) of the entries that were stored, if it is asked for. A FUNCTION OF THE PROGRAM: keys and
    /// values hold published ids only, which are given out in (step, task, index) order, an atom goes in as its text, and a sum
    /// does not depend on how the entries are split among the threads.
    pub(crate) digest: u64,
    /// `Some`: the digest is asked for.
    atoms: Option<&'a Interner>,
}

impl<'a> Applied<'a> {
    pub(crate) fn new(atoms: Option<&'a Interner>) -> Applied<'a> {
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
        atoms: &Interner,
        slot: u32,
        key: &impl Follow,
        value: &impl Follow,
    ) {
        let mut hash = HashOfEntry(FxHasher::default(), atoms);
        hash.0.write_u32(slot);
        key.visit(&mut hash);
        value.visit(&mut hash);
        // A sum of hashes whose low bits are poor is poor.
        let hash = hash.0.finish();
        self.digest =
            (self.digest).wrapping_add((hash ^ hash >> 32).wrapping_mul(0x9E37_79B9_7F4A_7C15));
    }
}

struct HashOfEntry<'a>(FxHasher, &'a Interner);

impl Visitor for HashOfEntry<'_> {
    /// THE TEXT, NOT THE NUMBER: the parser threads number the atoms in the order in which they come upon them, which is another in
    /// every run. WHATEVER SHOWS AN ATOM TO `plain`, OR A NUMBER THAT IS MADE OF ONE, MAKES THE DIGEST DEPEND ON TIMING.
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

/// The published half of a table with a cell for each key, as the end of a task and the barrier see it. On the way to the barrier a key is
/// one number: where the node is when all are laid end to end, or the number of the id.
pub(crate) trait Dense: Sync {
    type Value: Packed<Cell = AtomicU32>;
    /// What a key on the way to the barrier stands for, for the digest.
    type Key: Follow;
    fn key(key: u32) -> Self::Key;
    fn table_slot(&self) -> u32;
    /// The key of the dense cell `index` of `half`, as `Half::sparse` would have it.
    fn dense_key(half: &Half, index: u32) -> u64;
    /// `None`: `key -> value` is bound. `key`: as the task's half has it.
    fn hand_over(
        &self,
        key: u64,
        value: &impl Follow,
        finishing: &mut Finishing<'_>,
    ) -> Option<u32>;
    fn follow_key(key: u32, link: &Link) -> u32;
    /// 0: nothing.
    fn load(&self, key: u32) -> u32;
    /// The cell is empty, and the caller is the one thread that writes to the table.
    fn store(&self, key: u32, raw: u32);
}

impl<K: NodeKey, V: Packed<Cell = AtomicU32>> Dense for ByNode<K, V, Buffered> {
    type Value = V;
    /// Files and nodes are numbered in an order that is a function of the program.
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
        finishing: &mut Finishing<'_>,
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

impl<I: Id + Follow, V: Packed<Cell = AtomicU32>> Dense for ById<I, V, Buffered> {
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
        finishing: &mut Finishing<'_>,
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

/// A table whose values fit a cell. The entries on the way to the barrier: `Vec<(u32, u32)>`, a key and a packed value.
impl<D: Dense<Value: Follow>> Publish for D {
    fn slot(&self) -> u32 {
        self.table_slot()
    }

    fn finish(&self, half: &mut Half, finishing: &mut Finishing<'_>) -> Option<Entries> {
        let mut entries = Vec::new();
        half.take_cells(D::dense_key, |key, raw| {
            if let Some(key) = self.hand_over(key, &D::Value::unpack(raw), finishing) {
                entries.push((key, raw));
            }
        });
        Entries::new(self.table_slot(), entries.len(), entries)
    }

    fn follow(&self, entries: &mut Entries, link: &Link) {
        for (key, raw) in entries.typed_mut::<Vec<(u32, u32)>>() {
            let mut value = D::Value::unpack(*raw);
            value.follow(link);
            (*key, *raw) = (D::follow_key(*key, link), value.pack());
        }
    }

    fn apply(
        &self,
        _: usize,
        shares: &mut [Share<'_>],
        _: &mut [Vec<Handle>],
        applied: &mut Applied<'_>,
    ) {
        for share in shares {
            for &(key, raw) in share.whole().typed::<Vec<(u32, u32)>>() {
                if self.load(key) == 0 {
                    self.store(key, raw);
                    applied.store(self.table_slot(), &D::key(key), &D::Value::unpack(raw));
                }
            }
        }
    }
}

/// How the handles of one kept table get into the values of another: `ByIdIndirect::hold_handles_of`.
///
/// `finish` of the table that is held notes which of the task's handles are handed over, and in which place. `finish` of the holder
/// drops an entry whose handle is not, and otherwise puts the place into the field, with `LOCAL`. `apply` of the table that is held
/// leaves in `handles[task][place]` the published handle: that of the entry if it has won, else the winner's. `apply` of the holder,
/// which the same thread calls next, puts that into the field.
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

/// The entries of a kept table on the way to the barrier: `Vec<(u32, T)>`, a key and a value, IN INSERTION ORDER.
fn finish_indirect<D: Dense<Value = Handle>, T: Follow + Send + Sync + 'static>(
    handles: &D,
    holding: &Holding<T>,
    half: &mut Half,
    finishing: &mut Finishing<'_>,
) -> Option<Entries> {
    // Every handle in a cell is that of a value below.
    half.clear_cells();
    // SAFETY: the slot is that of a kept table of `T`.
    let kept = unsafe { half.existing_typed_mut::<IndirectInTask<T>>() }?;
    let mut entries = Vec::new();
    let mut places = vec![0; if holding.is_held { kept.len() } else { 0 }];
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
                places[handle] = entries.len() as u32;
            }
        }
    });
    if holding.is_held {
        finishing.held.push((handles.table_slot(), places));
    }
    Entries::new(handles.table_slot(), entries.len(), entries)
}

fn follow_indirect<D: Dense, T: Follow + 'static>(entries: &mut Entries, link: &Link) {
    for (key, value) in entries.typed_mut::<Vec<(u32, T)>>() {
        *key = D::follow_key(*key, link);
        value.follow(link);
    }
}

/// A VALUE IS PUSHED WHEN ITS ENTRY WINS. A loser is dropped.
fn apply_indirect<D: Dense<Value = Handle>, T: Follow + 'static>(
    handles: &D,
    kept: &AppendVec<T>,
    holding: &Holding<T>,
    shares: &mut [Share<'_>],
    links: &mut [Vec<Handle>],
    applied: &mut Applied<'_>,
) {
    for share in shares {
        let task = share.task as usize;
        let values = std::mem::take(share.whole().typed_mut::<Vec<(u32, T)>>());
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

impl<K: NodeKey, T: Follow + Send + Sync + 'static> Publish for ByNodeIndirect<K, T, Buffered> {
    fn slot(&self) -> u32 {
        self.handles.slot
    }

    fn finish(&self, half: &mut Half, finishing: &mut Finishing<'_>) -> Option<Entries> {
        finish_indirect(&self.handles, &Holding::<T>::default(), half, finishing)
    }

    fn follow(&self, entries: &mut Entries, link: &Link) {
        follow_indirect::<ByNode<K, Handle, Buffered>, T>(entries, link);
    }

    fn apply(
        &self,
        _: usize,
        shares: &mut [Share<'_>],
        handles: &mut [Vec<Handle>],
        applied: &mut Applied<'_>,
    ) {
        let holding = Holding::default();
        apply_indirect(
            &self.handles,
            &self.kept,
            &holding,
            shares,
            handles,
            applied,
        );
    }
}

impl<I: Id + Follow, T: Follow + Send + Sync + 'static> Publish for ByIdIndirect<I, T, Buffered> {
    fn slot(&self) -> u32 {
        self.handles.slot
    }

    fn holds_handles_of(&self) -> Option<u32> {
        Some(self.holding.holds?.0)
    }

    fn finish(&self, half: &mut Half, finishing: &mut Finishing<'_>) -> Option<Entries> {
        finish_indirect(&self.handles, &self.holding, half, finishing)
    }

    fn follow(&self, entries: &mut Entries, link: &Link) {
        follow_indirect::<ById<I, Handle, Buffered>, T>(entries, link);
    }

    fn apply(
        &self,
        _: usize,
        shares: &mut [Share<'_>],
        handles: &mut [Vec<Handle>],
        applied: &mut Applied<'_>,
    ) {
        let (table, holding) = (&self.handles, &self.holding);
        apply_indirect(table, &self.kept, holding, shares, handles, applied);
    }
}

/// How many threads can fill a `ByKey` at a time. Each has as many shards of the map as the next.
const PARTS: usize = 8;

#[inline]
fn part_of(spread: u64) -> usize {
    shard_of(spread) / (SHARDS / PARTS)
}

/// The entries of a `ByKey` on the way to the barrier.
struct Keyed<K, V> {
    /// IN INSERTION ORDER.
    entries: Vec<(K, V)>,
    // THE SHARD OF A KEY IS KNOWN ONLY AFTER THE LINK, so `follow` fills in the rest.
    /// The hash of each key.
    spreads: Vec<u64>,
    /// The places of the entries of part 0, in order, then those of part 1, and so on.
    by_part: Vec<u32>,
    /// Where in `by_part` each part begins. One more says where the last one ends.
    starts: [u32; PARTS + 1],
}

impl<K, V> Publish for ByKey<K, V, Buffered>
where
    K: std::hash::Hash + Eq + Clone + Follow + Send + Sync + 'static,
    V: Copy + Follow + Send + Sync + 'static,
{
    fn slot(&self) -> u32 {
        self.slot
    }

    fn parts(&self) -> usize {
        PARTS
    }

    fn finish(&self, half: &mut Half, finishing: &mut Finishing<'_>) -> Option<Entries> {
        // SAFETY: the slot is this table's own.
        let mut entries = unsafe { half.existing_typed_mut::<Hashed<K, V>>() }?.take();
        entries.retain(|(key, value)| finishing.is_published(key, value));
        entries.shrink_to_fit();
        let len = entries.len();
        let keyed = Keyed {
            entries,
            spreads: Vec::new(),
            by_part: Vec::new(),
            starts: [0; PARTS + 1],
        };
        Entries::new(self.slot, len, keyed)
    }

    fn follow(&self, entries: &mut Entries, link: &Link) {
        let keyed = entries.typed_mut::<Keyed<K, V>>();
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
        shares: &mut [Share<'_>],
        _: &mut [Vec<Handle>],
        applied: &mut Applied<'_>,
    ) {
        for share in shares {
            let Payload::Part(entries) = share.payload else {
                unreachable!()
            };
            let keyed = entries.typed::<Keyed<K, V>>();
            let (from, to) = (keyed.starts[part] as usize, keyed.starts[part + 1] as usize);
            for &place in &keyed.by_part[from..to] {
                let (key, value) = &keyed.entries[place as usize];
                if (self.published).add_if_absent(keyed.spreads[place as usize], key, *value) {
                    applied.store(self.slot, key, value);
                }
            }
        }
    }
}

// ───────────────────────────── `FileLocal` ─────────────────────────────

/// There is no published half. The storage is in words of 64 bits. A value of a bit or two shares its word with the values of the
/// neighbouring nodes.
impl<K: NodeKey, V: Packed> ByNode<K, V, FileLocal> {
    /// The word for the node `index`, and where in it the bits of the node begin.
    #[inline]
    fn place(index: u32) -> (u32, u32) {
        match V::BITS {
            0 => (index, 0),
            bits => (index / (64 / bits), index % (64 / bits) * bits),
        }
    }

    #[inline]
    pub fn get(&self, task: &Task, key: &K) -> Option<V> {
        let (word, shift) = Self::place(key.index());
        let raw = task.file_local().cell(self.slot, key.file().0, word) >> shift & Self::MASK;
        (raw != 0).then(|| V::unpack(V::Cell::narrow(raw)))
    }

    /// Keeps what is there already, and returns what is kept.
    #[inline]
    pub fn insert(&self, task: &Task, key: K, value: V) -> V {
        // `NONE` is asked about now and then.
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

    /// Stores `value` whatever is there.
    #[inline]
    pub fn rewrite(&self, task: &Task, key: K, value: V) {
        if key.index() == u32::MAX {
            return;
        }
        let (file, raw) = (key.file().0, V::Cell::widen(value.pack()));
        let (word, shift) = Self::place(key.index());
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

impl<K: NodeKey, T: 'static> ByNodeIndirect<K, T, FileLocal> {
    #[inline]
    pub fn get_ref(&self, task: &Task, key: &K) -> Option<&T> {
        let handle = self.handles.get(task, key)?;
        // SAFETY: `insert_ref` kept a `T` there. Nothing that is handed out here outlives the file that the task goes through.
        Some(unsafe { task.file_local().kept(self.handles.slot, handle.0) })
    }

    /// Keeps what is there already, and returns what is kept.
    pub fn insert_ref(&self, task: &Task, key: K, value: T) -> &T {
        let handle = match self.handles.get(task, &key) {
            Some(handle) => handle,
            None => {
                let handle = Handle(task.file_local().keep(self.handles.slot, value));
                self.handles.insert(task, key, handle)
            }
        };
        // SAFETY: as in `get_ref`.
        unsafe { task.file_local().kept(self.handles.slot, handle.0) }
    }

    #[inline]
    pub fn get(&self, task: &Task, key: &K) -> Option<T>
    where
        T: Clone,
    {
        self.get_ref(task, key).cloned()
    }

    pub fn insert(&self, task: &Task, key: K, value: T) -> T
    where
        T: Clone,
    {
        self.insert_ref(task, key, value).clone()
    }
}
