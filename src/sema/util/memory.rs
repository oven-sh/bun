//! The memory that the checker manages by hand. The containers of this crate that need `unsafe` are
//! here, and the file depends on nothing but `std`, so its tests run under Miri.
//!
//! An element never moves and is never freed before its container, so a reference to one stays
//! valid while others are added:
//!
//! - `AppendVec`: a vector that any thread appends to and reads without a lock.
//! - `LocalVec`: the same for one thread, without atomic read-modify-write operations.
//! - `Cells`: atomic integers for a range of indices that keeps growing, initially all zero.
//! - `Newest`: the newest of a series of slices of cells, read without a lock.
//!
//! Each gets its memory from the allocator that it holds, and returns it there. Any thread that
//! adds to an `AppendVec`, a `Cells` or a `Newest` may allocate, and the thread that drops it frees.

use std::alloc::{Allocator, Global};
use std::cell::Cell;
use std::marker::PhantomData;
use std::mem::MaybeUninit;
use std::ptr::{null_mut, slice_from_raw_parts_mut};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicPtr, AtomicU32, AtomicU64, Ordering};

/// Makes its owner `Send` if `E` is, and `Sync` if `E` is both: through a shared reference one
/// thread adds an element that another thread reads or drops. Those are the bounds of `OnceLock`.
type Owns<E> = PhantomData<OnceLock<E>>;

/// One for each number of leading zeros a `u32` can have.
const CHUNKS: usize = 33;

/// Memory for the elements 0, 1, 2 and so on. The first chunk has `1 << FIRST` elements, and every
/// other chunk is twice as long as the one before it. So there are few chunks, and the chunk of an
/// index is found by counting leading zeros: see `locate`.
struct Chunks<E, const FIRST: u32, A: Allocator + Clone> {
    /// Null, or the address at which the chunk would start if it also held the elements of the
    /// chunks before it and `1 << FIRST` more. Indexed by `Located::chunk`.
    bases: [AtomicPtr<E>; CHUNKS],
    alloc: A,
    owns: Owns<E>,
}

/// Where `Chunks` has an element.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct Located {
    chunk: usize,
    /// From the base of the chunk.
    offset: usize,
}

impl<E, const FIRST: u32, A: Allocator + Clone> Chunks<E, FIRST, A> {
    fn new_in(alloc: A) -> Self {
        Chunks {
            bases: [const { AtomicPtr::new(null_mut()) }; CHUNKS],
            alloc,
            owns: PhantomData,
        }
    }

    /// The chunk of the element `index`, and the offset of the element from the base of the chunk.
    /// An index within `1 << FIRST` of `u32::MAX` wraps around, to a chunk that `install` refuses.
    #[inline]
    fn locate(index: u32) -> Located {
        let n = index.wrapping_add(1 << FIRST);
        Located {
            chunk: n.leading_zeros() as usize,
            offset: n as usize,
        }
    }

    /// The number of elements of a chunk, which is also the offset of its first element from its
    /// base.
    #[inline]
    fn len_of(chunk: usize) -> usize {
        1 << (31 - chunk)
    }

    /// The address of the element `index`. Meaningless if its chunk is not allocated.
    #[inline]
    fn slot(&self, index: u32) -> *mut E {
        let Located { chunk, offset } = Self::locate(index);
        self.bases[chunk]
            .load(Ordering::Relaxed)
            .wrapping_add(offset)
    }

    /// The address of the element `index`, whose chunk comes from `make` if it is not allocated.
    #[inline]
    fn slot_or_install(&self, index: u32, make: fn(usize, A) -> Box<[E], A>) -> *mut E {
        let Located { chunk, offset } = Self::locate(index);
        let mut base = self.bases[chunk].load(Ordering::Acquire);
        if base.is_null() {
            base = self.install(chunk, make);
        }
        base.wrapping_add(offset)
    }

    /// Several threads may race here. The first to install its chunk wins.
    #[cold]
    fn install(&self, chunk: usize, make: fn(usize, A) -> Box<[E], A>) -> *mut E {
        assert!(chunk <= (31 - FIRST) as usize, "the index is out of range");
        let len = Self::len_of(chunk);
        let fresh = Box::into_raw_with_allocator(make(len, self.alloc.clone()))
            .0
            .cast::<E>();
        let base = fresh.wrapping_sub(len);
        // Null marks a chunk that is not allocated.
        assert!(!base.is_null());
        match self.bases[chunk].compare_exchange(
            null_mut(),
            base,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => base,
            Err(installed) => {
                let fresh = slice_from_raw_parts_mut(fresh, len);
                // SAFETY: it was a box of this length and this allocator above, and no other thread
                // has seen it.
                drop(unsafe { Box::from_raw_in(fresh, self.alloc.clone()) });
                installed
            }
        }
    }

    /// Frees the chunks that are longer than `longest`.
    fn release(&mut self, longest: usize) {
        for (chunk, base) in self.bases.iter_mut().enumerate().take(32) {
            let len = Self::len_of(chunk);
            let base = base.get_mut();
            if len > longest && !base.is_null() {
                let first = std::mem::replace(base, null_mut()).wrapping_add(len);
                let chunk = slice_from_raw_parts_mut(first, len);
                // SAFETY: `install` stored the address of a box of this length and this allocator,
                // less `len`. It is not in `bases` any more, and `&mut self` shows that no
                // reference to an element is in use.
                drop(unsafe { Box::from_raw_in(chunk, self.alloc.clone()) });
            }
        }
    }
}

impl<E, const FIRST: u32, A: Allocator + Clone> Drop for Chunks<E, FIRST, A> {
    fn drop(&mut self) {
        self.release(0);
    }
}

// ───────────────────────────── vectors ─────────────────────────────

/// The length of a `Stable`.
///
/// # Safety
/// `Stable::push` relies on `add` for an index of its own: no two calls return overlapping ranges.
pub unsafe trait Length: Default {
    /// Whether `Stable::get` compares the index with the length.
    const IS_CHECKED: bool;
    fn get(&self) -> u32;
    /// Returns the length before. No two calls return overlapping ranges.
    fn add(&self, count: u32) -> u32;
    /// Returns the length and sets it to 0.
    fn take(&mut self) -> u32;
}

// SAFETY: `fetch_add` is atomic.
unsafe impl Length for AtomicU32 {
    const IS_CHECKED: bool = false;
    #[inline]
    fn get(&self) -> u32 {
        self.load(Ordering::Acquire)
    }
    #[inline]
    fn add(&self, count: u32) -> u32 {
        self.fetch_add(count, Ordering::Relaxed)
    }
    fn take(&mut self) -> u32 {
        std::mem::take(self.get_mut())
    }
}

// SAFETY: it is not `Sync`, so all calls come from one thread at a time.
unsafe impl Length for Cell<u32> {
    const IS_CHECKED: bool = true;
    #[inline]
    fn get(&self) -> u32 {
        Cell::get(self)
    }
    #[inline]
    fn add(&self, count: u32) -> u32 {
        self.replace(Cell::get(self) + count)
    }
    fn take(&mut self) -> u32 {
        std::mem::take(self.get_mut())
    }
}

const FIRST_CHUNK_BITS: u32 = 10;

/// A vector that is appended to through a shared reference and whose elements never move.
pub struct Stable<T, L: Length, A: Allocator + Clone = Global> {
    chunks: Chunks<MaybeUninit<T>, FIRST_CHUNK_BITS, A>,
    /// The elements below it are initialized, except for those that a `push` in progress or the
    /// caller of `reserve` has yet to write.
    len: L,
}

/// Any thread appends and reads, without a lock. A reader gets an index from the thread that pushed
/// the element, through something that orders the push before the read: a cell written with
/// `Release` and read with `Acquire`, a lock, or a barrier.
pub type AppendVec<T, A = Global> = Stable<T, AtomicU32, A>;

/// For one thread. It can be emptied and used again.
pub type LocalVec<T, A = Global> = Stable<T, Cell<u32>, A>;

impl<T, L: Length, A: Allocator + Clone + Default> Default for Stable<T, L, A> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<T, L: Length, A: Allocator + Clone> Stable<T, L, A> {
    pub fn new() -> Self
    where
        A: Default,
    {
        Self::default()
    }

    pub fn new_in(alloc: A) -> Self {
        Stable {
            chunks: Chunks::new_in(alloc),
            len: L::default(),
        }
    }

    #[inline]
    pub fn len(&self) -> u32 {
        self.len.get()
    }

    /// Returns the index of the element.
    #[inline]
    pub fn push(&self, value: T) -> u32 {
        let index = self.len.add(1);
        // SAFETY: `add` has given the index to this call alone, which has not returned it yet.
        unsafe { self.write(index, value) };
        index
    }

    /// Makes room for `count` more elements and returns the index of the first.
    ///
    /// # Safety
    /// The caller passes each of the indices to `write` before the vector is dropped or drained,
    /// and to `get` only after that.
    pub unsafe fn reserve(&self, count: u32) -> u32 {
        self.len.add(count)
    }

    /// Initializes the element `index`.
    ///
    /// # Safety
    /// The index comes from `reserve`, it is written once, and no other thread accesses the element
    /// at the same time.
    #[inline]
    pub unsafe fn write(&self, index: u32, value: T) {
        let slot = (self.chunks).slot_or_install(index, Box::new_uninit_slice_in);
        // SAFETY: the slot is inside its chunk. Only this call accesses it, and what it holds is
        // not initialized, so nothing is leaked.
        unsafe { slot.write(MaybeUninit::new(value)) };
    }

    /// `index` was returned by `push`, or passed to `write`. An `AppendVec` trusts that: the
    /// comparison would be three more instructions in the most frequent operation of the checker.
    #[inline]
    pub fn get(&self, index: u32) -> &T {
        if L::IS_CHECKED {
            assert!(index < self.len.get());
        } else {
            debug_assert!(index < self.len.get());
        }
        // SAFETY: the element was initialized before its index reached this thread, so its chunk is
        // allocated, and the load of the base cannot return an older value. Nothing writes to the
        // element again before `&mut self`.
        unsafe { (*self.chunks.slot(index)).assume_init_ref() }
    }

    /// Moves the elements out, in order, and leaves it empty. Only the first chunks stay allocated,
    /// so that one large use does not grow its owner permanently.
    pub fn drain(&mut self, mut take: impl FnMut(u32, T)) {
        for index in 0..self.len.take() {
            // SAFETY: the elements below the length are initialized. The length is 0 by now, so
            // none is read again, even if `take` panics.
            take(index, unsafe {
                (*self.chunks.slot(index)).assume_init_read()
            });
        }
        self.chunks.release(1 << 15);
    }

    pub fn clear(&mut self) {
        if std::mem::needs_drop::<T>() {
            self.drain(|_, value| drop(value));
        } else {
            self.len.take();
            self.chunks.release(1 << 15);
        }
    }
}

impl<T, L: Length, A: Allocator + Clone> Drop for Stable<T, L, A> {
    fn drop(&mut self) {
        self.clear();
    }
}

// ───────────────────────────── cells ─────────────────────────────

/// A type for which all zero bytes are a value.
pub trait Zeroed: Sized {
    /// From the allocator's zeroed memory, which for a long slice comes from the operating system: a
    /// page that is never touched is never resident.
    fn zeroed_slice_in<A: Allocator>(len: usize, alloc: A) -> Box<[Self], A>;
}

macro_rules! zeroed {
    ($($atomic:ty),*) => {$(
        impl Zeroed for $atomic {
            fn zeroed_slice_in<A: Allocator>(len: usize, alloc: A) -> Box<[Self], A> {
                // SAFETY: an atomic integer has the representation of the integer, for which all
                // zero bytes are 0.
                unsafe { Box::new_zeroed_slice_in(len, alloc).assume_init() }
            }
        }
    )*};
}
zeroed!(AtomicU32, AtomicU64);

const FIRST_CELLS_BITS: u32 = 12;

/// Cells for a range of indices that keeps growing, initially all zero. `C` is an atomic integer: a
/// cell is only ever accessed through a shared reference.
pub struct Cells<C, A: Allocator + Clone = Global> {
    chunks: Chunks<C, FIRST_CELLS_BITS, A>,
}

impl<C: Zeroed + Sync, A: Allocator + Clone + Default> Default for Cells<C, A> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<C: Zeroed + Sync, A: Allocator + Clone> Cells<C, A> {
    pub fn new_in(alloc: A) -> Self {
        Cells {
            chunks: Chunks::new_in(alloc),
        }
    }

    /// `None`: nothing has been written to the chunk of `index`. For a time when no thread calls
    /// `cell`, and something has ordered the earlier calls before this one.
    #[inline]
    pub fn existing(&self, index: u32) -> Option<&C> {
        let Located { chunk, offset } = Chunks::<C, FIRST_CELLS_BITS, A>::locate(index);
        let base = self.chunks.bases[chunk].load(Ordering::Relaxed);
        if base.is_null() {
            return None;
        }
        // SAFETY: inside the chunk, which `zeroed_slice_in` has initialized and the drop frees.
        Some(unsafe { &*base.wrapping_add(offset) })
    }

    #[inline]
    pub fn cell(&self, index: u32) -> &C {
        // SAFETY: as in `existing`.
        unsafe { &*self.chunks.slot_or_install(index, C::zeroed_slice_in) }
    }

    /// The chunks that are allocated.
    pub fn allocated(&self) -> impl Iterator<Item = &[C]> {
        (self.chunks.bases.iter().enumerate()).filter_map(|(chunk, base)| {
            let base = base.load(Ordering::Acquire);
            if base.is_null() {
                return None;
            }
            let len = Chunks::<C, FIRST_CELLS_BITS, A>::len_of(chunk);
            // SAFETY: the chunk starts `len` after its base and has `len` cells. See `existing`.
            Some(unsafe { std::slice::from_raw_parts(base.wrapping_add(len), len) })
        })
    }
}

// ───────────────────────────── the newest of a series ─────────────────────────────

struct Table<C> {
    cells: *mut [C],
}

struct Retired<C> {
    table: *mut Table<C>,
    next: *mut Retired<C>,
}

/// The newest of a series of slices of cells, read without a lock: a table that is replaced by a
/// bigger one when it fills up. The older ones stay allocated until `forget_older`, because a reader
/// may still hold one.
pub struct Newest<C, A: Allocator + Clone = Global> {
    newest: AtomicPtr<Table<C>>,
    retired: AtomicPtr<Retired<C>>,
    alloc: A,
    owns: Owns<C>,
}

impl<C: Zeroed, A: Allocator + Clone + Default> Default for Newest<C, A> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<C: Zeroed, A: Allocator + Clone> Newest<C, A> {
    pub fn new_in(alloc: A) -> Self {
        Newest {
            newest: AtomicPtr::new(null_mut()),
            retired: AtomicPtr::new(null_mut()),
            alloc,
            owns: PhantomData,
        }
    }

    /// Empty: there is none yet. `Relaxed`: something else has ordered the last `replace` before
    /// this call.
    #[inline]
    pub fn get(&self, order: Ordering) -> &[C] {
        let newest = self.newest.load(order);
        // SAFETY: null, or the address of a box from `replace`, and so is `cells`. Only
        // `forget_older` frees them, once they are retired.
        unsafe { newest.as_ref().map_or(&[][..], |it| &*it.cells) }
    }

    /// Replaces it by `len` cells, all zero but for what `fill` stores before any reader sees them.
    /// One thread at a time: the caller holds a lock, or the owner is not shared.
    pub fn replace(&self, len: usize, fill: impl FnOnce(&[C])) -> &[C] {
        let cells = C::zeroed_slice_in(len, self.alloc.clone());
        fill(&cells);
        let cells = Box::into_raw_with_allocator(cells).0;
        let newest = Box::new_in(Table { cells }, self.alloc.clone());
        let newest = Box::into_raw_with_allocator(newest).0;
        let old = self.newest.load(Ordering::Relaxed);
        let swapped =
            (self.newest).compare_exchange(old, newest, Ordering::Release, Ordering::Relaxed);
        assert!(swapped.is_ok(), "two threads at a time");
        self.retire(old);
        self.get(Ordering::Relaxed)
    }
}

impl<C, A: Allocator + Clone> Newest<C, A> {
    /// One thread at a time.
    fn retire(&self, table: *mut Table<C>) {
        if !table.is_null() {
            let next = self.retired.load(Ordering::Relaxed);
            let retired = Box::new_in(Retired { table, next }, self.alloc.clone());
            let retired = Box::into_raw_with_allocator(retired).0;
            self.retired.store(retired, Ordering::Relaxed);
        }
    }

    /// Frees all but the newest.
    #[inline]
    pub fn forget_older(&mut self) {
        let mut next = std::mem::replace(self.retired.get_mut(), null_mut());
        while !next.is_null() {
            // SAFETY: the three were boxes of this allocator in `replace` and `retire`. A table is
            // retired once, when `newest` has ceased to point to it, the list is unlinked, and
            // `&mut self` shows that no reference to a cell is in use.
            next = unsafe {
                let retired = Box::from_raw_in(next, self.alloc.clone());
                let table = Box::from_raw_in(retired.table, self.alloc.clone());
                drop(Box::from_raw_in(table.cells, self.alloc.clone()));
                retired.next
            };
        }
    }

    /// Frees all of them.
    pub fn clear(&mut self) {
        let newest = std::mem::replace(self.newest.get_mut(), null_mut());
        self.retire(newest);
        self.forget_older();
    }
}

impl<C, A: Allocator + Clone> Drop for Newest<C, A> {
    fn drop(&mut self) {
        self.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::alloc::{AllocError, Layout};
    use std::ptr::NonNull;
    use std::sync::Barrier;
    use std::sync::atomic::AtomicUsize;

    /// `Global`, with a count of the blocks that are allocated.
    #[derive(Copy, Clone)]
    struct Counting<'a>(&'a AtomicUsize);

    // SAFETY: `Global` does the work.
    unsafe impl Allocator for Counting<'_> {
        fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Global.allocate(layout)
        }
        fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Global.allocate_zeroed(layout)
        }
        unsafe fn deallocate(&self, block: NonNull<u8>, layout: Layout) {
            self.0.fetch_sub(1, Ordering::Relaxed);
            // SAFETY: the caller's.
            unsafe { Global.deallocate(block, layout) };
        }
    }

    /// Counts the values that are alive.
    struct Counted<'a>(u32, &'a AtomicUsize);

    impl<'a> Counted<'a> {
        fn new(value: u32, alive: &'a AtomicUsize) -> Self {
            alive.fetch_add(1, Ordering::Relaxed);
            Counted(value, alive)
        }
    }

    impl Drop for Counted<'_> {
        fn drop(&mut self) {
            self.1.fetch_sub(1, Ordering::Relaxed);
        }
    }

    /// Enough for three chunks.
    const MANY: u32 = (1 << FIRST_CHUNK_BITS) * 3 + 5;

    #[test]
    fn every_index_has_its_own_slot() {
        type Small = Chunks<u8, 2, Global>;
        let mut next = 0;
        for chunk in (0..=29).rev() {
            for at in 0..Small::len_of(chunk).min(64) {
                let offset = Small::len_of(chunk) + at;
                assert_eq!(Small::locate(next + at as u32), Located { chunk, offset });
            }
            next = next.wrapping_add(Small::len_of(chunk) as u32);
        }
        // The indices that wrap around have chunks of their own, which are never allocated.
        let (chunk, offset) = (30, 3);
        assert_eq!(Small::locate(u32::MAX), Located { chunk, offset });
        let (chunk, offset) = (32, 0);
        assert_eq!(Small::locate(u32::MAX - 3), Located { chunk, offset });
    }

    #[test]
    fn a_reference_survives_later_pushes() {
        let vec = LocalVec::<Box<u32>>::new();
        let first = vec.get(vec.push(Box::new(0)));
        for value in 1..MANY {
            assert_eq!(vec.push(Box::new(value)), value);
        }
        assert_eq!(**first, 0);
        assert_eq!(vec.len(), MANY);
        for value in 0..MANY {
            assert_eq!(**vec.get(value), value);
        }
    }

    #[test]
    #[should_panic]
    fn a_local_vector_checks_the_index() {
        let vec = LocalVec::<u32>::new();
        vec.push(1);
        vec.get(1);
    }

    #[test]
    fn drain_moves_every_element_out_once() {
        let alive = AtomicUsize::new(0);
        let mut vec = LocalVec::<Counted>::new();
        for round in 0..2 {
            for value in 0..MANY {
                vec.push(Counted::new(value + round, &alive));
            }
            assert_eq!(alive.load(Ordering::Relaxed), MANY as usize);
            let mut expected = 0;
            vec.drain(|index, value| {
                assert_eq!((index, value.0), (expected, expected + round));
                expected += 1;
            });
            assert_eq!(expected, MANY);
            assert_eq!(vec.len(), 0);
            assert_eq!(alive.load(Ordering::Relaxed), 0);
        }
    }

    #[test]
    fn a_panic_during_drain_leaks_and_frees_nothing_twice() {
        let alive = AtomicUsize::new(0);
        let mut vec = LocalVec::<Counted>::new();
        for value in 0..10 {
            vec.push(Counted::new(value, &alive));
        }
        let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            vec.drain(|index, _| assert!(index < 3));
        }));
        assert!(unwound.is_err());
        assert_eq!(vec.len(), 0);
        drop(vec);
        assert_eq!(alive.load(Ordering::Relaxed), 6);
    }

    #[test]
    fn the_drop_drops_the_elements() {
        let alive = AtomicUsize::new(0);
        let shared = AppendVec::<Counted>::new();
        let local = LocalVec::<Counted>::new();
        for value in 0..MANY {
            shared.push(Counted::new(value, &alive));
            local.push(Counted::new(value, &alive));
        }
        drop(shared);
        assert_eq!(alive.load(Ordering::Relaxed), MANY as usize);
        drop(local);
        assert_eq!(alive.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn release_frees_the_long_chunks_only() {
        let blocks = AtomicUsize::new(0);
        let mut chunks = Chunks::<MaybeUninit<u8>, 2, _>::new_in(Counting(&blocks));
        // Chunks of 4, 8, 16 and 32.
        for index in [0, 4, 12, 28] {
            chunks.slot_or_install(index, Box::new_uninit_slice_in);
        }
        assert_eq!(blocks.load(Ordering::Relaxed), 4);
        chunks.release(8);
        assert_eq!(blocks.load(Ordering::Relaxed), 2);
        let (first, fourth) = (
            chunks.slot(0),
            chunks.bases[Chunks::<u8, 2, Global>::locate(28).chunk].load(Ordering::Relaxed),
        );
        assert!(!first.is_null() && fourth.is_null());
        chunks.slot_or_install(28, Box::new_uninit_slice_in);
        assert_eq!(blocks.load(Ordering::Relaxed), 3);
        drop(chunks);
        assert_eq!(blocks.load(Ordering::Relaxed), 0);
    }

    /// 65,537 pushes take a minute under Miri. `release` is tested above.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn clear_frees_the_long_chunks_only() {
        let mut vec = LocalVec::<u8>::new();
        for _ in 0..(1 << 16) + 1 {
            vec.push(7);
        }
        let allocated = |vec: &LocalVec<u8>| {
            let bases = vec.chunks.bases.iter();
            bases
                .filter(|it| !it.load(Ordering::Relaxed).is_null())
                .count()
        };
        assert_eq!(allocated(&vec), 7);
        vec.clear();
        assert_eq!(allocated(&vec), 6);
        assert_eq!(vec.push(1), 0);
    }

    #[test]
    fn threads_push_and_read_what_the_others_pushed() {
        const THREADS: u32 = 4;
        const EACH: u32 = if cfg!(miri) { 400 } else { 20_000 };
        let alive = AtomicUsize::new(0);
        let vec = AppendVec::<Counted>::new();
        // The index of a value, plus one, published as the tables of the checker do.
        let places: Vec<AtomicU32> = (0..THREADS * EACH).map(|_| AtomicU32::new(0)).collect();
        std::thread::scope(|scope| {
            for thread in 0..THREADS {
                let (vec, places, alive) = (&vec, &places, &alive);
                scope.spawn(move || {
                    for i in 0..EACH {
                        let value = thread * EACH + i;
                        let index = vec.push(Counted::new(value, alive));
                        places[value as usize].store(index + 1, Ordering::Release);
                        let other = (value * 7 + 3) % (THREADS * EACH);
                        match places[other as usize].load(Ordering::Acquire) {
                            0 => {}
                            place => assert_eq!(vec.get(place - 1).0, other),
                        }
                    }
                });
            }
        });
        assert_eq!(vec.len(), THREADS * EACH);
        let mut seen: Vec<u32> = (0..vec.len()).map(|index| vec.get(index).0).collect();
        seen.sort_unstable();
        assert!(seen.iter().copied().eq(0..THREADS * EACH));
        drop(vec);
        assert_eq!(alive.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn threads_write_what_one_thread_reserved() {
        const THREADS: u32 = 4;
        const EACH: u32 = if cfg!(miri) { 300 } else { 5_000 };
        let vec = AppendVec::<Box<u32>>::new();
        vec.push(Box::new(u32::MAX));
        // SAFETY: every index is written below, once, before it is read.
        let first = unsafe { vec.reserve(THREADS * EACH) };
        assert_eq!(first, 1);
        std::thread::scope(|scope| {
            for thread in 0..THREADS {
                let vec = &vec;
                scope.spawn(move || {
                    for index in (first + thread..first + THREADS * EACH).step_by(THREADS as usize)
                    {
                        // SAFETY: the threads write disjoint indices of the reserved range.
                        unsafe { vec.write(index, Box::new(index)) };
                    }
                });
            }
        });
        for index in first..vec.len() {
            assert_eq!(**vec.get(index), index);
        }
    }

    #[test]
    fn cells_start_at_zero_and_exist_once_written() {
        let cells = Cells::<AtomicU64>::default();
        assert!(cells.existing(0).is_none());
        assert!(cells.existing(u32::MAX).is_none());
        assert!(cells.existing(1 << 30).is_none());
        assert_eq!(cells.allocated().count(), 0);
        cells.cell(5000).store(9, Ordering::Relaxed);
        assert!(cells.existing(0).is_none());
        assert_eq!(cells.existing(5000).unwrap().load(Ordering::Relaxed), 9);
        assert_eq!(cells.existing(5001).unwrap().load(Ordering::Relaxed), 0);
        let lengths: Vec<usize> = cells.allocated().map(<[_]>::len).collect();
        assert_eq!(lengths, [1 << (FIRST_CELLS_BITS + 1)]);
        let all = cells.allocated().flatten();
        assert_eq!(all.map(|it| it.load(Ordering::Relaxed)).sum::<u64>(), 9);
    }

    #[test]
    #[should_panic]
    fn a_cell_beyond_the_range_is_refused() {
        Cells::<AtomicU32>::default().cell(u32::MAX);
    }

    #[test]
    fn threads_race_to_install_a_chunk() {
        const THREADS: u32 = 4;
        const ROUNDS: u32 = if cfg!(miri) { 2 } else { 200 };
        for _ in 0..ROUNDS {
            let cells = Cells::<AtomicU32>::default();
            let start = Barrier::new(THREADS as usize);
            std::thread::scope(|scope| {
                for thread in 0..THREADS {
                    let (cells, start) = (&cells, &start);
                    scope.spawn(move || {
                        start.wait();
                        for index in [0, 1 << FIRST_CELLS_BITS, 3 << FIRST_CELLS_BITS] {
                            cells.cell(index).fetch_add(1, Ordering::Relaxed);
                            cells
                                .cell(index + 1 + thread)
                                .store(thread + 1, Ordering::Relaxed);
                        }
                    });
                }
            });
            // The end of the scope orders the writes before these plain loads.
            for index in [0, 1 << FIRST_CELLS_BITS, 3 << FIRST_CELLS_BITS] {
                assert_eq!(
                    cells.existing(index).unwrap().load(Ordering::Relaxed),
                    THREADS
                );
                for thread in 0..THREADS {
                    let cell = cells.existing(index + 1 + thread).unwrap();
                    assert_eq!(cell.load(Ordering::Relaxed), thread + 1);
                }
            }
            assert_eq!(cells.allocated().count(), 3);
        }
    }

    #[test]
    fn zeroed_slices() {
        assert!(AtomicU32::zeroed_slice_in(0, Global).is_empty());
        let cells = AtomicU64::zeroed_slice_in(100, Global);
        assert!(cells.iter().all(|it| it.load(Ordering::Relaxed) == 0));
    }

    #[test]
    fn readers_see_a_filled_table_while_one_thread_replaces_it() {
        const TABLES: u64 = if cfg!(miri) { 40 } else { 2_000 };
        let newest = Newest::<AtomicU64>::default();
        assert!(newest.get(Ordering::Acquire).is_empty());
        std::thread::scope(|scope| {
            for _ in 0..3 {
                scope.spawn(|| {
                    let mut last = 0;
                    while last < TABLES {
                        let cells = newest.get(Ordering::Acquire);
                        // Every cell holds the length, which `fill` stored.
                        let len = cells.len() as u64;
                        assert!(cells.iter().all(|it| it.load(Ordering::Relaxed) == len));
                        assert!(len >= last);
                        last = len;
                        std::thread::yield_now();
                    }
                });
            }
            for len in 1..=TABLES {
                let cells = newest.replace(len as usize, |cells| {
                    assert!(cells.iter().all(|it| it.load(Ordering::Relaxed) == 0));
                    cells.iter().for_each(|it| it.store(len, Ordering::Relaxed));
                });
                assert_eq!(cells.len() as u64, len);
            }
        });
    }

    fn is_send<T: Send>() {}
    fn is_sync<T: Sync>() {}

    #[test]
    fn what_is_shared_between_threads() {
        is_send::<AppendVec<Box<u32>>>();
        is_sync::<AppendVec<Box<u32>>>();
        is_send::<LocalVec<Box<u32>>>();
        is_send::<Cells<AtomicU32>>();
        is_sync::<Cells<AtomicU32>>();
        is_sync::<Newest<AtomicU64>>();
    }

    #[test]
    fn every_block_goes_back_to_its_allocator() {
        let blocks = AtomicUsize::new(0);
        let alloc = Counting(&blocks);
        let count = || blocks.load(Ordering::Relaxed);

        let mut vec = LocalVec::new_in(alloc);
        for value in 0..MANY {
            vec.push(value);
        }
        assert_eq!(count(), 3);
        vec.clear();
        assert_eq!(count(), 3);
        drop(vec);
        assert_eq!(count(), 0);

        let cells = Cells::<AtomicU32, _>::new_in(alloc);
        let vec = AppendVec::new_in(alloc);
        let start = Barrier::new(4);
        std::thread::scope(|scope| {
            for _ in 0..4 {
                scope.spawn(|| {
                    start.wait();
                    cells.cell(0).fetch_add(1, Ordering::Relaxed);
                    vec.push(1u8);
                });
            }
        });
        // A thread that loses the race frees its chunk at once.
        assert_eq!(count(), 2);
        drop((cells, vec));
        assert_eq!(count(), 0);

        let mut newest = Newest::<AtomicU32, _>::new_in(alloc);
        let first = newest.replace(4, |_| {});
        newest.replace(8, |_| {});
        assert_eq!((first.len(), newest.get(Ordering::Relaxed).len()), (4, 8));
        // Two blocks for each table, and one for the one that is retired.
        assert_eq!(count(), 5);
        newest.forget_older();
        assert_eq!((newest.get(Ordering::Relaxed).len(), count()), (8, 2));
        newest.clear();
        assert!(newest.get(Ordering::Relaxed).is_empty());
        assert_eq!(count(), 0);
        newest.replace(2, |_| {});
        drop(newest);
        assert_eq!(count(), 0);

        drop(AtomicU64::zeroed_slice_in(10, alloc));
        assert_eq!(count(), 0);
    }
}
