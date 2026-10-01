//! Tables that are indexed by the number a thing already has.
//!
//! Nodes and symbols are numbered within their file and types as they are made, so what is worked out about one needs no hashing: it
//! goes in an array. Many threads fill these tables at once. A cell starts out as zero, "not worked out", and is written once with a compare
//! and swap. Reading is one load. Nothing takes a lock. Two threads may work out the same cell; they come to the same value, and the
//! first one is kept.
//!
//! The memory comes zero-filled from the allocator, which for arrays this size means from the system: a page nobody touches is never
//! there.

use crate::local::{self, LOCAL, MaybeLocal, is_local_number};
use crate::program::{FileId, Sym};
use crate::util::AppendVec;
use std::alloc::Layout;
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
    fn load(&self) -> Self::Raw;
    /// What the cell holds afterwards: `raw`, or what was there first.
    fn put_if_empty(&self, raw: Self::Raw) -> Self::Raw;
    fn store(&self, raw: Self::Raw);
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
                self.load(Ordering::Acquire)
            }
            #[inline]
            fn put_if_empty(&self, raw: $raw) -> $raw {
                match self.compare_exchange(0, raw, Ordering::AcqRel, Ordering::Acquire) {
                    Ok(_) => raw,
                    Err(first) => first,
                }
            }
            #[inline]
            fn store(&self, raw: $raw) {
                self.store(raw, Ordering::Release);
            }
        }
    };
}
cell!(AtomicU32, u32);
cell!(AtomicU64, u64);

/// A value that fits a cell. It is never packed as zero.
pub trait Packed: Copy + MaybeLocal {
    type Cell: Cell;
    fn pack(self) -> <Self::Cell as Cell>::Raw;
    fn unpack(raw: <Self::Cell as Cell>::Raw) -> Self;
}

impl Packed for bool {
    type Cell = AtomicU32;
    #[inline]
    fn pack(self) -> u32 {
        1 + u32::from(self)
    }
    #[inline]
    fn unpack(raw: u32) -> bool {
        raw == 2
    }
}

/// Something that goes by a number, counted from zero without gaps worth speaking of.
pub trait Id: Copy {
    fn number(self) -> u32;
    fn from_number(number: u32) -> Self;
    /// `Some`: it is local, and this is its number among the local ones.
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
impl Id for FileId {
    #[inline]
    fn number(self) -> u32 {
        self.0
    }
    #[inline]
    fn from_number(number: u32) -> Self {
        FileId(number)
    }
    #[inline]
    fn local_number(self) -> Option<u32> {
        (self.0 == local::file()).then_some(0)
    }
}

impl MaybeLocal for FileId {
    #[inline]
    fn is_local(&self) -> bool {
        self.0 == local::file()
    }
}

/// A node is as local as the file that goes with it.
impl MaybeLocal for crate::hir::TypeNodeId {
    #[inline]
    fn is_local(&self) -> bool {
        false
    }
}

impl MaybeLocal for Sym {
    #[inline]
    fn is_local(&self) -> bool {
        self.file.is_local()
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
const SEGMENTS: usize = 21;

/// Cells for numbers that keep coming, all zero to begin with. Each segment is as long as all the ones before it together, so there are
/// few of them, they never move, and which one a number is in takes counting its leading zeros.
struct Segmented<C> {
    segments: [AtomicPtr<C>; SEGMENTS],
}

// SAFETY: owns its cells, which are `Sync` and `Send`.
unsafe impl<C: Cell> Sync for Segmented<C> {}
// SAFETY: as above.
unsafe impl<C: Cell> Send for Segmented<C> {}

#[inline]
fn locate(index: u32) -> (usize, usize) {
    let n = u64::from(index) + (1 << FIRST_SEGMENT_BITS);
    let segment = 63 - n.leading_zeros() - FIRST_SEGMENT_BITS;
    (
        segment as usize,
        (n - (1 << (segment + FIRST_SEGMENT_BITS))) as usize,
    )
}

#[inline]
fn segment_len(segment: usize) -> usize {
    1usize << (segment as u32 + FIRST_SEGMENT_BITS)
}

impl<C: Cell> Segmented<C> {
    fn new() -> Segmented<C> {
        Segmented {
            segments: [const { AtomicPtr::new(std::ptr::null_mut()) }; SEGMENTS],
        }
    }

    /// `None`: nothing has been written anywhere near.
    #[inline]
    fn existing_cell(&self, index: u32) -> Option<&C> {
        let (segment, offset) = locate(index);
        let base = self.segments[segment].load(Ordering::Acquire);
        if base.is_null() {
            return None;
        }
        // SAFETY: inside the segment, and all zero is a valid `C`.
        Some(unsafe { &*base.add(offset) })
    }

    #[inline]
    fn cell(&self, index: u32) -> &C {
        let (segment, offset) = locate(index);
        let mut base = self.segments[segment].load(Ordering::Acquire);
        if base.is_null() {
            base = self.install(segment);
        }
        // SAFETY: inside the segment, and all zero is a valid `C`.
        unsafe { &*base.add(offset) }
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
        match self.segments[segment].compare_exchange(
            std::ptr::null_mut(),
            fresh,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => fresh,
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
                        base.cast::<u8>(),
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

    #[inline]
    fn total(&self) -> usize {
        *self.0.last().unwrap() as usize
    }

    /// `None`: there is no such node. `NONE` is asked about now and then.
    #[inline]
    fn at(&self, file: FileId, index: u32) -> Option<usize> {
        let (start, end) = (self.0[file.idx()], self.0[file.idx() + 1]);
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

/// A value for each node of one kind in the program.
pub struct ByNode<K, V: Packed> {
    bases: Bases,
    cells: Flat<V::Cell>,
    slot: u32,
    key: PhantomData<fn(K)>,
}

impl<K: NodeKey, V: Packed> ByNode<K, V> {
    /// How many cells there are and how many hold something, and the size of one.
    pub fn fill(&self) -> (usize, usize, usize) {
        let used = (0..self.cells.len)
            .filter(|&i| self.cells.cell(i).load() != Default::default())
            .count();
        (self.cells.len, used, size_of::<V::Cell>())
    }

    pub fn new(bases: &Bases) -> Self {
        ByNode {
            cells: Flat::new(bases.total()),
            bases: bases.clone(),
            slot: local::new_slot(),
            key: PhantomData,
        }
    }

    #[inline]
    fn cell(&self, key: K) -> Option<&V::Cell> {
        Some(self.cells.cell(self.bases.at(key.file(), key.index())?))
    }

    #[inline]
    pub fn get(&self, key: &K) -> Option<V> {
        let raw = match self.cell(*key) {
            Some(cell) => cell.load(),
            None if key.file().is_local() => V::Cell::narrow(local::cell(self.slot, key.index())),
            None => return None,
        };
        (raw != Default::default()).then(|| V::unpack(raw))
    }

    /// Keeps what is there already, and returns what is kept.
    #[inline]
    pub fn insert(&self, key: K, value: V) -> V {
        match self.cell(key) {
            // What is local is gone before what is shared is.
            Some(_) if value.is_local() => value,
            Some(cell) => V::unpack(cell.put_if_empty(value.pack())),
            None if key.file().is_local() && key.index() != u32::MAX => V::unpack(V::Cell::narrow(
                local::put_if_empty(self.slot, key.index(), V::Cell::widen(value.pack())),
            )),
            None => value,
        }
    }
}

impl<K: NodeKey> ByNode<K, RawWord> {
    #[inline]
    pub fn raw(&self, key: K) -> u32 {
        match self.cell(key) {
            Some(cell) => Cell::load(cell),
            None if key.file().is_local() => local::cell(self.slot, key.index()) as u32,
            None => 0,
        }
    }
    /// Whatever was there is gone. `is_local`: what `raw` stands for is.
    #[inline]
    pub fn set_raw(&self, key: K, raw: u32, is_local: bool) {
        match self.cell(key) {
            Some(_) if is_local => {}
            Some(cell) => Cell::store(cell, raw),
            None if key.file().is_local() && key.index() != u32::MAX => {
                local::store(self.slot, key.index(), u64::from(raw));
            }
            None => {}
        }
    }
}

/// For a table whose owner lays out the bits.
#[derive(Copy, Clone)]
pub struct RawWord(pub u32);

impl MaybeLocal for RawWord {
    #[inline]
    fn is_local(&self) -> bool {
        false
    }
}

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

/// Some of the nodes of one kind: a bit for each.
pub struct NodeSet<K> {
    bases: Bases,
    bits: Flat<AtomicU32>,
    len: AtomicU32,
    slot: u32,
    key: PhantomData<fn(K)>,
}

impl<K: NodeKey> NodeSet<K> {
    pub fn new(bases: &Bases) -> Self {
        NodeSet {
            bits: Flat::new(bases.total().div_ceil(32)),
            bases: bases.clone(),
            len: AtomicU32::new(0),
            slot: local::new_slot(),
            key: PhantomData,
        }
    }

    #[inline]
    pub fn get(&self, key: &K) -> Option<()> {
        match self.bases.at(key.file(), key.index()) {
            Some(at) => (self.bits.cell(at / 32).load(Ordering::Acquire) & 1 << (at % 32) != 0)
                .then_some(()),
            None if key.file().is_local() => local::bit(self.slot, key.index()).then_some(()),
            None => None,
        }
    }

    #[inline]
    pub fn insert(&self, key: K, (): ()) {
        match self.bases.at(key.file(), key.index()) {
            Some(at) => {
                let bit = 1 << (at % 32);
                if self.bits.cell(at / 32).fetch_or(bit, Ordering::AcqRel) & bit == 0 {
                    self.len.fetch_add(1, Ordering::Relaxed);
                }
            }
            None if key.file().is_local() && key.index() != u32::MAX => {
                // Counted with the rest, and never taken off again: all the count is asked is whether it is zero.
                if local::set_bit(self.slot, key.index()) {
                    self.len.fetch_add(1, Ordering::Relaxed);
                }
            }
            None => {}
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len.load(Ordering::Relaxed) as usize
    }
}

/// Where something is kept.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Handle(pub u32);
packed_ids!(Handle);

/// Something that does not fit a cell for some of the nodes of one kind. It is kept on the side and never moves.
pub struct ByNodeKept<K, T> {
    handles: ByNode<K, Handle>,
    kept: AppendVec<T>,
    slot: u32,
}

impl<K: NodeKey, T: 'static> ByNodeKept<K, T> {
    pub fn fill(&self) -> (usize, usize, usize) {
        self.handles.fill()
    }

    pub fn kept(&self) -> impl Iterator<Item = &T> {
        (0..self.kept.len()).map(|i| self.kept.get(i))
    }

    pub fn new(bases: &Bases) -> Self {
        ByNodeKept {
            handles: ByNode::new(bases),
            kept: AppendVec::new(),
            slot: local::new_slot(),
        }
    }

    #[inline]
    fn at(&self, handle: Handle) -> &T {
        match handle.local_number() {
            // SAFETY: nothing that is handed out here outlives the check of the file at hand.
            Some(index) => unsafe { local::kept(self.slot, index) },
            None => self.kept.get(handle.0),
        }
    }

    #[inline]
    pub fn get_ref(&self, key: &K) -> Option<&T> {
        self.handles.get(key).map(|handle| self.at(handle))
    }

    /// Keeps what is there already, and returns what is kept.
    pub fn insert_ref(&self, key: K, value: T) -> &T {
        let handle = if key.file().is_local() {
            Handle(local::keep(self.slot, value) | LOCAL)
        } else {
            Handle(self.kept.push(value))
        };
        self.at(self.handles.insert(key, handle))
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

// ───────────────────────────── by number ─────────────────────────────

/// A value for each of the things that are numbered as they are made.
pub struct ById<I, V: Packed> {
    cells: Segmented<V::Cell>,
    slot: u32,
    key: PhantomData<fn(I)>,
}

impl<I: Id, V: Packed> Default for ById<I, V> {
    fn default() -> Self {
        ById {
            cells: Segmented::new(),
            slot: local::new_slot(),
            key: PhantomData,
        }
    }
}

impl<I: Id, V: Packed> ById<I, V> {
    #[inline]
    pub fn get(&self, key: &I) -> Option<V> {
        let raw = match key.local_number() {
            Some(index) => V::Cell::narrow(local::cell(self.slot, index)),
            None => self.cells.existing_cell(key.number())?.load(),
        };
        (raw != Default::default()).then(|| V::unpack(raw))
    }

    /// Keeps what is there already, and returns what is kept.
    #[inline]
    pub fn insert(&self, key: I, value: V) -> V {
        match key.local_number() {
            Some(index) => V::unpack(V::Cell::narrow(local::put_if_empty(
                self.slot,
                index,
                V::Cell::widen(value.pack()),
            ))),
            // What is local is gone before what is shared is.
            None if value.is_local() => value,
            None => V::unpack(self.cells.cell(key.number()).put_if_empty(value.pack())),
        }
    }
}

/// Some of the things that are numbered as they are made: a bit for each.
pub struct IdSet<I> {
    bits: Segmented<AtomicU32>,
    slot: u32,
    key: PhantomData<fn(I)>,
}

impl<I: Id> Default for IdSet<I> {
    fn default() -> Self {
        IdSet {
            bits: Segmented::new(),
            slot: local::new_slot(),
            key: PhantomData,
        }
    }
}

impl<I: Id> IdSet<I> {
    #[inline]
    pub fn get(&self, key: &I) -> Option<()> {
        if let Some(index) = key.local_number() {
            return local::bit(self.slot, index).then_some(());
        }
        let at = key.number();
        let word = self.bits.existing_cell(at / 32)?.load(Ordering::Acquire);
        (word & 1 << (at % 32) != 0).then_some(())
    }

    #[inline]
    pub fn insert(&self, key: I, (): ()) {
        if let Some(index) = key.local_number() {
            local::set_bit(self.slot, index);
            return;
        }
        let at = key.number();
        self.bits
            .cell(at / 32)
            .fetch_or(1 << (at % 32), Ordering::AcqRel);
    }
}

/// Something that does not fit a cell for some of the things that are numbered as they are made.
pub struct ByIdKept<I, T> {
    handles: ById<I, Handle>,
    kept: AppendVec<T>,
    slot: u32,
}

impl<I: Id, T> Default for ByIdKept<I, T> {
    fn default() -> Self {
        ByIdKept {
            handles: ById::default(),
            kept: AppendVec::new(),
            slot: local::new_slot(),
        }
    }
}

impl<I: Id, T: 'static> ByIdKept<I, T> {
    pub fn kept(&self) -> impl Iterator<Item = &T> {
        (0..self.kept.len()).map(|i| self.kept.get(i))
    }

    #[inline]
    pub fn get_ref(&self, key: &I) -> Option<&T> {
        self.handles.get(key).map(|handle| self.at(handle))
    }

    #[inline]
    pub fn handle(&self, key: &I) -> Option<Handle> {
        self.handles.get(key)
    }

    #[inline]
    pub fn at(&self, handle: Handle) -> &T {
        match handle.local_number() {
            // SAFETY: nothing that is handed out here outlives the check of the file at hand.
            Some(index) => unsafe { local::kept(self.slot, index) },
            None => self.kept.get(handle.0),
        }
    }

    /// Keeps what is there already, and returns what is kept.
    pub fn insert_ref(&self, key: I, value: T) -> (Handle, &T) {
        let handle = if key.local_number().is_some() {
            Handle(local::keep(self.slot, value) | LOCAL)
        } else {
            Handle(self.kept.push(value))
        };
        let handle = self.handles.insert(key, handle);
        (handle, self.at(handle))
    }

    #[inline]
    pub fn get(&self, key: &I) -> Option<T>
    where
        T: Clone,
    {
        self.get_ref(key).cloned()
    }

    pub fn insert(&self, key: I, value: T) -> T
    where
        T: Clone,
    {
        self.insert_ref(key, value).1.clone()
    }

    pub fn len(&self) -> usize {
        self.kept.len() as usize
    }
}

/// A memo table for what goes by more than a number.
pub struct ByKey<K, V> {
    shared: crate::util::ShardedMap<K, V>,
    slot: u32,
}

impl<K: std::hash::Hash + Eq, V> Default for ByKey<K, V> {
    fn default() -> Self {
        ByKey {
            shared: Default::default(),
            slot: local::new_slot(),
        }
    }
}

impl<K: std::hash::Hash + Eq + MaybeLocal + 'static, V: Clone + MaybeLocal + 'static> ByKey<K, V> {
    #[inline]
    pub fn get(&self, key: &K) -> Option<V> {
        if key.is_local() {
            local::map_get(self.slot, key)
        } else {
            self.shared.get(key)
        }
    }

    /// Keeps what is there already, and returns what is kept.
    #[inline]
    pub fn insert(&self, key: K, value: V) -> V {
        if key.is_local() {
            local::map_insert(self.slot, key, value)
        } else if value.is_local() {
            // What is local is gone before what is shared is.
            value
        } else {
            self.shared.insert(key, value)
        }
    }

    pub fn len(&self) -> usize {
        self.shared.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_cover_every_number_once() {
        let mut expected = (0usize, 0usize);
        for index in 0..300_000u32 {
            assert_eq!(locate(index), expected);
            expected.1 += 1;
            if expected.1 == segment_len(expected.0) {
                expected = (expected.0 + 1, 0);
            }
        }
        assert!(locate(u32::MAX).0 < SEGMENTS);
    }

    #[test]
    fn the_first_value_of_many_threads_is_kept() {
        let bases = Bases::new([3usize, 0, 50_000].into_iter());
        let by_node = ByNode::<(FileId, u32), Handle>::new(&bases);
        let set = NodeSet::<(FileId, u32)>::new(&bases);
        let by_id = ById::<Handle, Option<Handle>>::default();
        let ids = IdSet::<Handle>::default();
        let kept = ByIdKept::<Handle, String>::default();
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    for i in 0..50_000u32 {
                        let key = (FileId(2), i);
                        assert_eq!(by_node.insert(key, Handle(i * 2)), Handle(i * 2));
                        assert_eq!(by_node.get(&key), Some(Handle(i * 2)));
                        if i % 3 == 0 {
                            set.insert(key, ());
                            ids.insert(Handle(i), ());
                        }
                        let value = (i % 2 == 0).then_some(Handle(i));
                        assert_eq!(by_id.insert(Handle(i * 7), value), value);
                        if i % 64 == 0 {
                            assert_eq!(kept.insert(Handle(i), i.to_string()), i.to_string());
                        }
                    }
                });
            }
        });
        assert_eq!(by_node.get(&(FileId(0), 2)), None);
        assert_eq!(by_node.get(&(FileId(0), u32::MAX)), None);
        assert_eq!(by_node.get(&(FileId(1), 0)), None);
        for i in 0..50_000u32 {
            assert_eq!(set.get(&(FileId(2), i)).is_some(), i % 3 == 0);
            assert_eq!(ids.get(&Handle(i)).is_some(), i % 3 == 0);
        }
        assert_eq!(by_id.get(&Handle(7)), Some(None));
        assert_eq!(by_id.get(&Handle(14)), Some(Some(Handle(2))));
        assert_eq!(by_id.get(&Handle(15)), None);
        assert_eq!(by_id.get(&Handle(4_000_000_000)), None);
        assert_eq!(kept.get_ref(&Handle(128)).map(String::as_str), Some("128"));
        assert_eq!(kept.get_ref(&Handle(129)), None);
    }
}
