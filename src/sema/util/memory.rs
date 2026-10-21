//! Memory that the checker manages by hand. Every container in this crate that needs `unsafe` is
//! here. Apart from `bun_alloc::out_of_memory`, this file depends only on `std`, so its tests run
//! under Miri.
//!
//! An element never moves and is never freed before its container, so a reference to one stays
//! valid while others are added:
//!
//! - `AppendVec`: a vector that any thread can append to and read without a lock.
//! - `LocalVec`: the same for one thread, without atomic read-modify-write operations.
//! - `Segmented`: an `AppendVec` or a `LocalVec` with fixed-size chunks.
//! - `Cells`: atomic integers for a growing range of indices, initially all zero.
//! - `Newest`: the newest of a series of slices of cells, read without a lock.
//!
//! Each container allocates from the allocator it holds and frees to it. Any thread that adds to an
//! `AppendVec`, a `Cells` or a `Newest` may allocate, and the thread that drops it frees.

use std::alloc::{Allocator, Global, Layout};
use std::cell::Cell;
use std::marker::PhantomData;
use std::mem::MaybeUninit;
use std::ops::Range;
use std::ptr::{NonNull, null_mut, slice_from_raw_parts_mut};
use std::sync::atomic::{AtomicPtr, AtomicU16, AtomicU32, AtomicU64, Ordering};
use std::sync::{Once, OnceLock};

/// Makes its owner `Send` if `E` is `Send`, and `Sync` if `E` is `Send + Sync`, because one thread
/// can add an element through a shared reference that another thread reads or drops. `OnceLock` has
/// the same bounds.
type Owns<E> = PhantomData<OnceLock<E>>;

/// One chunk for each number of leading zeros a `u32` can have.
const CHUNKS: usize = 33;

/// Memory for elements 0, 1, 2 and so on. The first chunk has `1 << FIRST` elements, and each later
/// chunk is twice as long as the previous one. So there are few chunks, and an index's chunk is
/// found by counting leading zeros (see `locate`).
struct Chunks<E, const FIRST: u32, A: Allocator + Clone> {
    /// Null, or the address where the chunk would start if it also held the elements of all earlier
    /// chunks plus `1 << FIRST` more. Indexed by `Located::chunk`.
    bases: [AtomicPtr<E>; CHUNKS],
    /// Null, or the chunk's actual start. Nothing reads it. No address in `bases` points into a chunk, so if the process
    /// exits without dropping this, a leak checker would find no reference to the chunks and report them as leaked. It's
    /// compiled only for builds that have a leak checker, because it's as large as `bases`, a map has 64 of these, and
    /// each referenced project has a resolver with five maps.
    #[cfg(bun_asan)]
    starts: [AtomicPtr<E>; CHUNKS],
    alloc: A,
    owns: Owns<E>,
}

/// An element's location in a `Chunks`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct Located {
    chunk: usize,
    /// From the chunk's base.
    offset: usize,
}

impl<E, const FIRST: u32, A: Allocator + Clone> Chunks<E, FIRST, A> {
    fn new_in(alloc: A) -> Self {
        Chunks {
            bases: [const { AtomicPtr::new(null_mut()) }; CHUNKS],
            #[cfg(bun_asan)]
            starts: [const { AtomicPtr::new(null_mut()) }; CHUNKS],
            alloc,
            owns: PhantomData,
        }
    }

    /// Returns the chunk of element `index` and the element's offset from the chunk's base. An index
    /// within `1 << FIRST` of `u32::MAX` wraps around to a chunk that `install` rejects.
    #[inline]
    fn locate(index: u32) -> Located {
        let n = index.wrapping_add(1 << FIRST);
        Located {
            chunk: n.leading_zeros() as usize,
            offset: n as usize,
        }
    }

    /// Returns a chunk's element count, which is also the offset of its first element from its base.
    #[inline]
    fn len_of(chunk: usize) -> usize {
        1 << (31 - chunk)
    }

    /// Returns the address of element `index`. The address is meaningless if the chunk isn't allocated.
    #[inline]
    fn slot(&self, index: u32) -> *mut E {
        let Located { chunk, offset } = Self::locate(index);
        self.bases[chunk]
            .load(Ordering::Relaxed)
            .wrapping_add(offset)
    }

    /// Returns the address of element `index`. If its chunk isn't allocated yet, `make` allocates it.
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
        // Null marks an unallocated chunk.
        assert!(!base.is_null());
        match self.bases[chunk].compare_exchange(
            null_mut(),
            base,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => {
                #[cfg(bun_asan)]
                self.starts[chunk].store(fresh, Ordering::Relaxed);
                base
            }
            Err(installed) => {
                let fresh = slice_from_raw_parts_mut(fresh, len);
                // SAFETY: `fresh` came from a box with this length and this allocator above, and no
                // other thread has seen it.
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
                #[cfg(bun_asan)]
                {
                    *self.starts[chunk].get_mut() = null_mut();
                }
                let chunk = slice_from_raw_parts_mut(first, len);
                // SAFETY: `install` stored the address of a box with this length and this allocator,
                // minus `len`. It's no longer in `bases`, and `&mut self` proves that no reference
                // to an element is in use.
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
/// `Stable::push` relies on `add` to get an index that no other call gets, so no two calls may return
/// overlapping ranges.
pub unsafe trait Length: Default {
    /// True if `Stable::get` always checks the index against the length. Otherwise only debug builds do.
    const IS_CHECKED: bool;
    fn get(&self) -> u32;
    /// Adds `count` and returns the previous length. No two calls return overlapping ranges.
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

// SAFETY: `Cell` isn't `Sync`, so all calls come from one thread at a time.
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

/// A vector that's appended to through a shared reference. Its elements never move.
pub struct Stable<T, L: Length, A: Allocator + Clone = Global> {
    chunks: Chunks<MaybeUninit<T>, FIRST_CHUNK_BITS, A>,
    /// Elements below `len` are initialized, except those that an in-progress `push` or a caller of
    /// `reserve` hasn't written yet.
    len: L,
}

/// Any thread can append and read without a lock. A reader gets an index from the thread that pushed
/// the element, through something that orders the push before the read: a cell written with
/// `Release` and read with `Acquire`, a lock, or a barrier.
pub type AppendVec<T, A = Global> = Stable<T, AtomicU32, A>;

/// Single-threaded. It can be cleared and reused.
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

    /// Appends `value` and returns its index.
    #[inline]
    pub fn push(&self, value: T) -> u32 {
        let index = self.len.add(1);
        // SAFETY: `add` returns each index to only one call, and this call hasn't returned it yet.
        unsafe { self.write(index, value) };
        index
    }

    /// Reserves `count` more elements and returns the index of the first.
    ///
    /// # Safety
    /// The caller must pass each of the indices to `write` before the vector is dropped or drained,
    /// and may pass an index to `get` only after writing it.
    pub unsafe fn reserve(&self, count: u32) -> u32 {
        self.len.add(count)
    }

    /// Initializes element `index`.
    ///
    /// # Safety
    /// The index must come from `reserve` and be written only once, and no other thread may access
    /// the element at the same time.
    #[inline]
    pub unsafe fn write(&self, index: u32, value: T) {
        let slot = (self.chunks).slot_or_install(index, Box::new_uninit_slice_in);
        // SAFETY: the slot is inside its chunk, and only this call accesses it. Its old contents
        // are uninitialized, so overwriting them leaks nothing.
        unsafe { slot.write(MaybeUninit::new(value)) };
    }

    /// Returns element `index`, which must have been returned by `push` or passed to `write`. An
    /// `AppendVec` checks that only in debug builds, because the comparison would add three
    /// instructions to the checker's most frequent operation.
    #[inline]
    pub fn get(&self, index: u32) -> &T {
        if L::IS_CHECKED {
            assert!(index < self.len.get());
        } else {
            debug_assert!(index < self.len.get());
        }
        // SAFETY: the element was initialized before its index reached this thread, so its chunk is
        // allocated, and the load of the base can't return an older value. Nothing writes to the
        // element again without `&mut self`.
        unsafe { (*self.chunks.slot(index)).assume_init_ref() }
    }

    /// Drains the elements in order. Only the first chunks stay allocated, so that one large use
    /// doesn't grow its owner permanently.
    pub fn drain(&mut self, mut take: impl FnMut(u32, T)) {
        for index in 0..self.len.take() {
            // SAFETY: every element below the old length is initialized. The length is already 0,
            // so no element is read twice, even if `take` panics.
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

/// A vector that several threads fill. One thread reserves a range of elements, then
/// each reserved element is written exactly once, by any thread.
pub(crate) trait Fill<T> {
    /// # Safety
    /// See `Stable::reserve`.
    unsafe fn reserve(&self, count: u32) -> u32;

    /// # Safety
    /// See `Stable::write`.
    unsafe fn write(&self, index: u32, value: T);
}

impl<T, L: Length, A: Allocator + Clone> Fill<T> for Stable<T, L, A> {
    unsafe fn reserve(&self, count: u32) -> u32 {
        // SAFETY: the caller upholds the contract of `Stable::reserve`.
        unsafe { Stable::reserve(self, count) }
    }

    #[inline]
    unsafe fn write(&self, index: u32, value: T) {
        // SAFETY: the caller upholds the contract of `Stable::write`.
        unsafe { Stable::write(self, index, value) }
    }
}

// ───────────────────────────── segmented vectors ─────────────────────────────

/// Base-2 log of a segment's element count. Small segments waste less memory, because every task
/// has several vectors and most of them are short. Large segments keep a shared vector's directory
/// small, because it always has `OWN >> SEGMENT_BITS` entries.
const SEGMENT_BITS: u32 = 14;

const SEGMENT: usize = 1 << SEGMENT_BITS;

/// Flag in a number passed to `Segmented::get_layered`. If set, the number refers to the vector's own
/// elements, not to the shared vector underneath it. Every element index is below `OWN`.
pub(crate) const OWN: u32 = 1 << 30;

/// Pointer to a segment's first element. Null if the segment isn't allocated.
type Segment<T> = AtomicPtr<MaybeUninit<T>>;

/// A `Stable` with fixed-size chunks, called segments. An element's segment is a shift of its index
/// and its offset is a mask, so a lookup doesn't count leading zeros like `Chunks::locate`.
///
/// With `L = AtomicU32` the vector is shared between threads, like an `AppendVec`. With
/// `L = Cell<u32>` it belongs to one thread, like a `LocalVec`, and `layer_over` can layer it over a
/// shared vector so that `get_layered` reads from both.
pub(crate) struct Segmented<'a, T, L: Length, A: Allocator + Clone = Global> {
    /// Segment pointers, in order. A shared vector allocates the directory at its maximum length,
    /// so it's never replaced. A single-threaded vector starts with an empty directory and replaces
    /// it with a longer one as it grows. It's a box from `new_directory`, stored as a raw pointer
    /// because moving a box would invalidate the pointers into it in `directories` and `Elements`.
    directory: Cell<*mut [Segment<T>]>,
    /// Used by `get_layered`, indexed by the top two bits of a number. Each entry is a directory
    /// pointer, biased so that `number >> SEGMENT_BITS` indexes it with the top bits still set.
    /// Entry 0 is the shared vector's directory, entry 1 is this vector's, and entries 2 and 3 are
    /// unused.
    directories: [Cell<*const Segment<T>>; 4],
    /// Used by `get_layered`, indexed like `directories`. A number refers to an element only if it's
    /// below its limit. An unused entry's limit is 0, which rejects every number.
    limits: [L; 4],
    /// Same as the `len` field of `Stable`.
    len: L,
    alloc: A,
    /// Borrow of the shared vector passed to `layer_over`.
    base_layer: PhantomData<&'a [T]>,
    owns: Owns<T>,
}

// SAFETY: the vector owns its elements. The pointers in `directories` point into its own directory
// and into the borrowed directory of a shared vector, which any thread may read.
unsafe impl<T: Send + Sync, L: Length + Send, A: Allocator + Clone + Send> Send
    for Segmented<'_, T, L, A>
{
}
// SAFETY: with an `AtomicU32` length, nothing replaces `directory` or writes to `directories`
// through a shared reference. See `Owns` for the elements.
unsafe impl<T: Send + Sync, A: Allocator + Clone + Sync> Sync for Segmented<'_, T, AtomicU32, A> {}

impl<T, L: Length, A: Allocator + Clone> Segmented<'_, T, L, A> {
    pub(crate) fn new_in(alloc: A) -> Self {
        let segments = match L::IS_CHECKED {
            true => 0,
            false => OWN as usize >> SEGMENT_BITS,
        };
        let limits: [L; 4] = Default::default();
        limits[1].add(OWN);
        Segmented {
            directory: Cell::new(Self::new_directory(segments, &[], &alloc)),
            directories: [const { Cell::new(std::ptr::null()) }; 4],
            limits,
            len: L::default(),
            alloc,
            base_layer: PhantomData,
            owns: PhantomData,
        }
    }

    /// Returns a directory of `len` entries: a copy of `old`, then nulls. Uses the allocator's
    /// zeroed memory (see `Zeroed::zeroed_slice_in`).
    fn new_directory(len: usize, old: &[Segment<T>], alloc: &A) -> *mut [Segment<T>] {
        // SAFETY: all zero bytes are a valid null `AtomicPtr`.
        let mut new = unsafe { Box::new_zeroed_slice_in(len, alloc.clone()).assume_init() };
        for (new, old) in std::iter::zip(&mut new, old) {
            *new = AtomicPtr::new(old.load(Ordering::Relaxed));
        }
        Box::into_raw_with_allocator(new).0
    }

    /// Frees a directory, but not its segments.
    ///
    /// # Safety
    /// `directory` comes from `new_directory` with this allocator, and nothing uses it afterwards.
    unsafe fn free_directory(directory: *mut [Segment<T>], alloc: &A) {
        // SAFETY: it came from a box in this allocator, and the caller no longer uses it.
        drop(unsafe { Box::from_raw_in(directory, alloc.clone()) });
    }

    /// Returns directory entry `at`, or `None` if the directory is shorter.
    #[inline]
    fn segment(&self, at: usize) -> Option<&Segment<T>> {
        let directory = self.directory.get();
        // SAFETY: the entry is inside the directory. Only `install` replaces the directory, and
        // only in a single-threaded vector. That thread doesn't have a live reference to an entry
        // at that point.
        (at < directory.len()).then(|| unsafe { &*directory.cast::<Segment<T>>().add(at) })
    }

    #[inline]
    pub(crate) fn len(&self) -> u32 {
        self.len.get()
    }

    /// Returns a pointer to element `index`. The pointer is meaningless if the segment isn't
    /// allocated.
    #[inline]
    fn slot(&self, index: u32) -> *mut MaybeUninit<T> {
        let segment = self.segment((index >> SEGMENT_BITS) as usize);
        (segment.expect("the index is out of range"))
            .load(Ordering::Relaxed)
            .wrapping_add(index as usize % SEGMENT)
    }

    /// Allocates the segment for element `index`. If several threads race here, the first to
    /// install its segment wins.
    #[cold]
    #[inline(never)]
    fn install(&self, index: u32) {
        let at = (index >> SEGMENT_BITS) as usize;
        if at >= OWN as usize >> SEGMENT_BITS {
            bun_alloc::out_of_memory();
        }
        if self.segment(at).is_none() {
            let longer = (at + 1).next_power_of_two().max(4);
            // SAFETY: as in `segment`.
            let old = unsafe { &*self.directory.get() };
            let longer = Self::new_directory(longer, old, &self.alloc);
            // Biased by `OWN >> SEGMENT_BITS`, because `get_layered` indexes it without clearing the
            // `OWN` bit.
            let first = longer.cast_const().cast::<Segment<T>>();
            self.directories[1].set(first.wrapping_sub(OWN as usize >> SEGMENT_BITS));
            // SAFETY: a shared vector's directory already has the maximum length, so this vector is
            // single-threaded, and this thread doesn't have a live reference to the old directory.
            unsafe { Self::free_directory(self.directory.replace(longer), &self.alloc) };
        }
        let fresh = Box::<[T], A>::try_new_uninit_slice_in(SEGMENT, self.alloc.clone())
            .unwrap_or_else(|_| bun_alloc::out_of_memory());
        let fresh = Box::into_raw_with_allocator(fresh).0;
        let segment = self.segment(at).expect("the directory is long enough");
        let installed = segment.compare_exchange(
            null_mut(),
            fresh.cast(),
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        if installed.is_err() {
            // SAFETY: `fresh` came from `into_raw_with_allocator` above, and no other thread has
            // seen it.
            drop(unsafe { Box::from_raw_in(fresh, self.alloc.clone()) });
        }
    }

    /// Appends `value` and returns its index.
    #[inline]
    pub(crate) fn push(&self, value: T) -> u32 {
        let index = self.len.add(1);
        // SAFETY: `add` returns each index to only one call, and this call hasn't returned it yet,
        // so nothing else accesses the element.
        unsafe { Fill::write(self, index, value) };
        if L::IS_CHECKED {
            self.limits[1].add(1);
        }
        index
    }

    /// Returns element `index`, which must have been returned by `push` or passed to `write`. A
    /// shared vector checks that only in debug builds, like an `AppendVec`.
    #[inline]
    pub(crate) fn get(&self, index: u32) -> &T {
        if L::IS_CHECKED {
            assert!(index < self.len.get());
        } else {
            debug_assert!(index < self.len.get());
        }
        // SAFETY: the element was initialized before its index reached this thread, so its segment
        // is allocated. Nothing writes to the element again without `&mut self`, except `replace`
        // (see `Placeholder::index`).
        unsafe { (*self.slot(index)).assume_init_ref() }
    }

    /// Drains the elements in order. Only the first segment stays allocated.
    pub(crate) fn drain(&mut self, mut take: impl FnMut(u32, T)) {
        self.limits[1].take();
        self.limits[1].add(OWN);
        for index in 0..self.len.take() {
            // SAFETY: every element below the old length is initialized. The length is already 0,
            // so no element is read twice, even if `take` panics.
            take(index, unsafe { (*self.slot(index)).assume_init_read() });
        }
        self.release(1);
    }

    pub(crate) fn clear(&mut self) {
        self.drain(|_, value| drop(value));
    }

    /// Frees all but the first `keep` segments. The vector must be empty.
    fn release(&mut self, keep: usize) {
        for segment in (keep..).map_while(|at| self.segment(at)) {
            let start = segment.load(Ordering::Relaxed);
            // Every reserved index has already been written, so no segment follows a missing one.
            if start.is_null() {
                break;
            }
            segment.store(null_mut(), Ordering::Relaxed);
            // SAFETY: `install` made this pointer from a box with this length and this allocator.
            // Its directory entry is null now, so it's freed only once.
            drop(unsafe {
                Box::from_raw_in(slice_from_raw_parts_mut(start, SEGMENT), self.alloc.clone())
            });
        }
    }
}

impl<T, L: Length, A: Allocator + Clone> Drop for Segmented<'_, T, L, A> {
    fn drop(&mut self) {
        self.clear();
        self.release(0);
        // SAFETY: nothing uses the directory after the drop.
        unsafe { Self::free_directory(self.directory.get(), &self.alloc) };
    }
}

impl<T, L: Length, A: Allocator + Clone> Fill<T> for Segmented<'_, T, L, A> {
    unsafe fn reserve(&self, count: u32) -> u32 {
        self.len.add(count)
    }

    #[inline]
    unsafe fn write(&self, index: u32, value: T) {
        let segment = self.segment((index >> SEGMENT_BITS) as usize);
        if segment.is_none_or(|segment| segment.load(Ordering::Acquire).is_null()) {
            self.install(index);
        }
        // SAFETY: the segment is allocated, and only this call accesses the element. The old
        // contents, which may be uninitialized, aren't dropped.
        unsafe { self.slot(index).write(MaybeUninit::new(value)) };
    }
}

/// A run of consecutive placeholder elements in one `Segmented`. Only the owner of this value can
/// replace them.
pub(crate) struct Placeholders<'a> {
    /// Address of the `Segmented`. `Segmented::replace` checks it.
    owner_addr: usize,
    next: u32,
    end: u32,
    borrowed: PhantomData<&'a ()>,
}

/// One placeholder taken from a `Placeholders`.
pub(crate) struct Placeholder<'a> {
    owner_addr: usize,
    index: u32,
    borrowed: PhantomData<&'a ()>,
}

/// An empty run.
impl Default for Placeholders<'_> {
    fn default() -> Self {
        Placeholders {
            owner_addr: 0,
            next: 0,
            end: 0,
            borrowed: PhantomData,
        }
    }
}

impl<'a> Placeholders<'a> {
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.next == self.end
    }

    /// Returns the index of the first remaining placeholder.
    pub(crate) fn first(&self) -> Option<u32> {
        (!self.is_empty()).then_some(self.next)
    }

    #[inline]
    pub(crate) fn take_first(&mut self) -> Option<Placeholder<'a>> {
        let index = self.first()?;
        self.next += 1;
        Some(Placeholder {
            owner_addr: self.owner_addr,
            index,
            borrowed: PhantomData,
        })
    }
}

impl Placeholder<'_> {
    /// Returns the element's index. Don't pass it to `Segmented::get` until `Segmented::replace`
    /// has returned.
    #[inline]
    pub(crate) fn index(&self) -> u32 {
        self.index
    }
}

/// Read-only handle to the elements of a shared `Segmented`, including elements added later.
pub(crate) struct Elements<'a, T> {
    directory: *const Segment<T>,
    borrowed: PhantomData<&'a [T]>,
}

impl<T> Clone for Elements<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Elements<'_, T> {}

impl<T, A: Allocator + Clone> Segmented<'_, T, AtomicU32, A> {
    /// Appends `count` placeholders made by `new`. Any thread may call this.
    pub(crate) fn add_placeholders(&self, count: u32, new: impl Fn() -> T) -> Placeholders<'_> {
        // SAFETY: the loop below writes every reserved index before any of them escapes this call.
        let next = unsafe { self.reserve(count) };
        for index in next..next + count {
            // SAFETY: the index was reserved above, so no other thread writes this slot, and it's
            // written exactly once.
            unsafe { self.write(index, new()) };
        }
        Placeholders {
            owner_addr: std::ptr::from_ref(self).addr(),
            next,
            end: next + count,
            borrowed: PhantomData,
        }
    }

    /// Overwrites a placeholder with `value`, without dropping the placeholder element. Any thread
    /// may call this.
    #[inline]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "consuming the placeholder rules out a second write to its element"
    )]
    pub(crate) fn replace(&self, placeholder: Placeholder<'_>, value: T) -> &T {
        // The placeholder borrows its vector, so that vector can't have moved or been freed, and
        // its address still identifies it.
        assert!(placeholder.owner_addr == std::ptr::from_ref(self).addr());
        // SAFETY: each index has exactly one `Placeholder`, and this call consumes it, so nothing
        // else writes to the element. Nothing reads the element yet (see `Placeholder::index`).
        unsafe { self.write(placeholder.index, value) };
        self.get(placeholder.index)
    }

    pub(crate) fn elements(&self) -> Elements<'_, T> {
        Elements {
            directory: self.directory.get().cast_const().cast(),
            borrowed: PhantomData,
        }
    }
}

impl<'a, T, A: Allocator + Clone> Segmented<'a, T, Cell<u32>, A> {
    /// Layers this vector over `shared`. After this, `get_layered` maps a number without `OWN` to an
    /// element of `shared`.
    pub(crate) fn layer_over(&mut self, shared: Elements<'a, T>) {
        self.directories[0].set(shared.directory);
        self.limits[0].set(OWN);
    }

    /// True if `shared` was passed to the most recent `layer_over` call.
    pub(crate) fn is_layered_over(&self, shared: Elements<'_, T>) -> bool {
        std::ptr::eq(self.directories[0].get(), shared.directory)
    }

    /// Returns element `number - OWN` of this vector if `number` has the `OWN` bit set, and element
    /// `number` of the shared vector underneath otherwise. A number without `OWN` isn't checked
    /// against the shared vector's length, as in `get`.
    #[inline(always)]
    pub(crate) fn get_layered(&self, number: u32) -> &T {
        let which = (number >> 30) as usize;
        // Before `layer_over`, `limits[0]` is 0, so this rejects every number without `OWN`.
        assert!(number < self.limits[which].get());
        let segment =
            (self.directories[which].get()).wrapping_add((number >> SEGMENT_BITS) as usize);
        // SAFETY: the directory that the number selects has an entry for every number below the
        // limit. The shared vector's directory is still alive, because `layer_over` requires a borrow
        // of it for `'a`, which outlives this vector. The rest is as in `get`.
        unsafe {
            let start = (*segment).load(Ordering::Relaxed);
            (*start.wrapping_add(number as usize % SEGMENT)).assume_init_ref()
        }
    }
}

// ───────────────────────────── cells ─────────────────────────────

const SMALLEST_PAGE: usize = 4 << 10;

/// A type for which all zero bytes are a valid value.
///
/// # Safety
/// All zero bytes must be a valid value of the type.
pub unsafe trait Zeroed: Sized {
    /// Allocates from the allocator's zeroed memory. For a long slice that memory comes from the
    /// operating system, so a page that's never touched is never resident.
    fn zeroed_slice_in<A: Allocator>(len: usize, alloc: A) -> Box<[Self], A>;
    /// Writes to the cell without changing its value.
    fn touch(&self);
}

/// Writes to every page of `cells`. Use it for cells that are about to be read and written at random. If a zeroed page
/// from the operating system is read before it's written, its first write causes a second page fault, and that fault
/// interrupts every other thread.
fn touch_pages<C: Zeroed>(cells: &[C]) {
    (cells.iter().step_by(SMALLEST_PAGE / size_of::<C>())).for_each(C::touch);
    if let Some(last) = cells.last() {
        last.touch();
    }
}

macro_rules! zeroed {
    ($($atomic:ty),*) => {$(
        // SAFETY: an atomic integer has the same representation as the integer, for which all zero bytes are 0.
        unsafe impl Zeroed for $atomic {
            fn zeroed_slice_in<A: Allocator>(len: usize, alloc: A) -> Box<[Self], A> {
                // SAFETY: all zero bytes are a valid value, as above.
                unsafe { Box::new_zeroed_slice_in(len, alloc).assume_init() }
            }
            #[inline]
            fn touch(&self) {
                // Not `fetch_or(0)`, because the compiler may turn that into a plain load.
                let _ = self.compare_exchange(0, 0, Ordering::Relaxed, Ordering::Relaxed);
            }
        }
    )*};
}
zeroed!(AtomicU16, AtomicU32, AtomicU64);

/// One bit per page of an array of cells that starts out all zero. The bit is set once anything on the page has been
/// written. A reader that finds the bit clear treats the cell as zero without loading it. So a page that was never
/// written is never read either. It doesn't use a cache line or a page table entry, and its first write is its first
/// page fault. Reading it first would cost a second page fault (see `touch_pages`).
///
/// `index`, here and below, is the index of a cell in the array. An array longer than a page starts at a page boundary.
trait WrittenPages<C: Zeroed> {
    fn words(&self) -> &[AtomicU64];

    #[inline(always)]
    fn word_and_bit(index: usize) -> (usize, u64) {
        let page = index / (SMALLEST_PAGE / size_of::<C>());
        (page / 64, 1 << (page % 64))
    }

    /// True if the page of cell `index` may have been written. Always true for a cell past the end of the bitmap.
    #[inline(always)]
    fn may_be_written(&self, index: usize) -> bool {
        let (word, bit) = Self::word_and_bit(index);
        (self.words().get(word)).is_none_or(|word| word.load(Ordering::Relaxed) & bit != 0)
    }

    /// Marks the page of `cell` as written. Call this before writing to `cell`, which must be the cell at `index`.
    #[inline(always)]
    fn note_write(&self, index: usize, cell: &C) {
        let (word, bit) = Self::word_and_bit(index);
        if let Some(word) = self.words().get(word)
            && word.load(Ordering::Relaxed) & bit == 0
        {
            note_first_write(word, bit, cell);
        }
    }
}

/// Writes to the page before setting its bit, so that no reader loads from the page first.
#[cold]
fn note_first_write<C: Zeroed>(word: &AtomicU64, bit: u64, cell: &C) {
    cell.touch();
    word.fetch_or(bit, Ordering::Relaxed);
}

/// Cells for a fixed range of indices, initially all zero.
///
/// The memory starts out uninitialized. The first thread that writes to a page of cells zeroes that page, so creating
/// the cells costs nothing, and a page that's never written is never resident. The allocator's zeroed memory isn't a
/// substitute. If any part of a block is reused memory, the allocator clears the whole block on the calling thread.
pub struct FixedCells<C, A: Allocator = Global> {
    cells: Box<[MaybeUninit<C>], A>,
    /// One bit per page of `cells`, set once the page is zeroed.
    zeroed: Box<[AtomicU64], A>,
    /// One per page of `cells`. Of the threads that find the bit clear, one zeroes the page and the others wait.
    zeroing: Box<[Once], A>,
}

impl<C: Zeroed, A: Allocator + Clone> FixedCells<C, A> {
    const PER_PAGE: usize = SMALLEST_PAGE / size_of::<C>();

    pub fn new_in(len: usize, alloc: A) -> Self {
        let pages = len.div_ceil(Self::PER_PAGE);
        let mut zeroing = Vec::with_capacity_in(pages, alloc.clone());
        zeroing.resize_with(pages, Once::new);
        FixedCells {
            cells: Box::new_uninit_slice_in(len, alloc.clone()),
            zeroed: AtomicU64::zeroed_slice_in(pages.div_ceil(64), alloc),
            zeroing: zeroing.into_boxed_slice(),
        }
    }

    /// The load is `Acquire` so that a thread that sees the bit set also sees the zeros.
    #[inline(always)]
    fn is_zeroed(&self, page: usize) -> bool {
        let word = self.zeroed.get(page / 64);
        word.is_some_and(|word| word.load(Ordering::Acquire) & (1 << (page % 64)) != 0)
    }

    #[cold]
    fn zero(&self, page: usize) {
        self.zeroing[page].call_once(|| {
            let cells = &self.cells[page * Self::PER_PAGE..];
            let cells = &cells[..cells.len().min(Self::PER_PAGE)];
            // SAFETY: the cells are inside the allocation. Only this thread accesses them, because nothing else does
            // before the bit is set. A cell is written through a shared reference, like any atomic.
            unsafe { cells.as_ptr().cast_mut().write_bytes(0, cells.len()) };
            self.zeroed[page / 64].fetch_or(1 << (page % 64), Ordering::Release);
        });
    }

    /// Returns the cell at `index`, or `None` if the cell is known to be zero.
    #[inline]
    pub fn existing(&self, index: usize) -> Option<&C> {
        // SAFETY: its page is zeroed, and all zero bytes are a valid `C`.
        (self.is_zeroed(index / Self::PER_PAGE))
            .then(|| unsafe { self.cells[index].assume_init_ref() })
    }

    /// Returns the cell at `index` for writing.
    #[inline]
    pub fn cell(&self, index: usize) -> &C {
        let (cell, page) = (&self.cells[index], index / Self::PER_PAGE);
        if !self.is_zeroed(page) {
            self.zero(page);
        }
        // SAFETY: as in `existing`.
        unsafe { cell.assume_init_ref() }
    }

    /// Iterates over the pages that have been written.
    #[cfg(test)]
    pub fn written(&self) -> impl Iterator<Item = &[C]> {
        let pages = self.cells.chunks(Self::PER_PAGE).enumerate();
        let written = pages.filter(|&(page, _)| self.is_zeroed(page));
        // SAFETY: as in `existing`.
        written.map(|(_, cells)| unsafe { cells.assume_init_ref() })
    }

    /// Iterates over the cells in `range` that are on written pages, each with its index.
    #[inline]
    pub fn written_in(&self, range: Range<usize>) -> impl Iterator<Item = (usize, &C)> {
        let pages = range.start / Self::PER_PAGE..range.end.div_ceil(Self::PER_PAGE);
        let written = pages.filter(|&page| self.is_zeroed(page));
        written.flat_map(move |page| {
            let first = range.start.max(page * Self::PER_PAGE);
            let cells = &self.cells[first..range.end.min((page + 1) * Self::PER_PAGE)];
            // SAFETY: as in `existing`.
            (first..).zip(unsafe { cells.assume_init_ref() })
        })
    }
}

const FIRST_CELLS_BITS: u32 = 12;

/// Length of `Cells::written`. 256 words cover 16.7 million four-byte cells, about as many as a large program has
/// types.
const WRITTEN_WORDS: usize = 256;

/// Cells for a growing range of indices, initially all zero. `C` is an atomic integer, because a
/// cell is only ever accessed through a shared reference.
pub struct Cells<C, A: Allocator + Clone = Global> {
    chunks: Chunks<C, FIRST_CELLS_BITS, A>,
    /// Indexed by `Located::offset`. With that numbering, every chunk's first cell is still the first cell of a page.
    written: Box<[AtomicU64], A>,
}

impl<C: Zeroed, A: Allocator + Clone> WrittenPages<C> for Cells<C, A> {
    #[inline(always)]
    fn words(&self) -> &[AtomicU64] {
        &self.written
    }
}

impl<C: Zeroed + Sync, A: Allocator + Clone + Default> Default for Cells<C, A> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<C: Zeroed + Sync, A: Allocator + Clone> Cells<C, A> {
    pub fn new_in(alloc: A) -> Self {
        Cells {
            written: AtomicU64::zeroed_slice_in(WRITTEN_WORDS, alloc.clone()),
            chunks: Chunks::new_in(alloc),
        }
    }

    /// Returns the cell at `index`, or `None` if the cell is known to be zero. Call this only while
    /// no thread calls `cell`, and after something has ordered the earlier `cell` calls before this
    /// call.
    #[inline]
    pub fn existing(&self, index: u32) -> Option<&C> {
        self.existing_loaded(index, Ordering::Relaxed)
    }

    /// Like `existing`, but may run while other threads call `cell`.
    #[inline]
    pub fn existing_acquire(&self, index: u32) -> Option<&C> {
        self.existing_loaded(index, Ordering::Acquire)
    }

    #[inline(always)]
    fn existing_loaded(&self, index: u32, order: Ordering) -> Option<&C> {
        let Located { chunk, offset } = Chunks::<C, FIRST_CELLS_BITS, A>::locate(index);
        if !self.may_be_written(offset) {
            return None;
        }
        let base = self.chunks.bases[chunk].load(order);
        if base.is_null() {
            return None;
        }
        // SAFETY: the address is inside the chunk, which `zeroed_slice_in` initialized and only the drop frees.
        Some(unsafe { &*base.wrapping_add(offset) })
    }

    /// Returns the cell at `index` for writing, and allocates its chunk if needed.
    #[inline]
    pub fn cell(&self, index: u32) -> &C {
        // SAFETY: as in `existing`.
        let cell = unsafe { &*self.chunks.slot_or_install(index, C::zeroed_slice_in) };
        let offset = Chunks::<C, FIRST_CELLS_BITS, A>::locate(index).offset;
        self.note_write(offset, cell);
        cell
    }

    /// Iterates over the allocated chunks.
    #[cfg(test)]
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

/// Alignment of every slice in a `Newest`, the size of a cache line. This frees the low 6 bits of the address, which
/// `Slice` uses for the length.
const SLICE_ALIGNMENT: usize = 64;

/// A slice packed into one word: the address of its first cell plus log2 of its length. A reader gets both with one
/// load.
struct Slice<C>(*mut C);

impl<C> Slice<C> {
    fn new(first: *mut C, len: usize) -> Slice<C> {
        debug_assert!(len.is_power_of_two() && first.addr().is_multiple_of(SLICE_ALIGNMENT));
        Slice(first.map_addr(|first| first | len.trailing_zeros() as usize))
    }

    #[inline(always)]
    fn first(&self) -> *mut C {
        self.0.map_addr(|it| it & !(SLICE_ALIGNMENT - 1))
    }

    #[inline(always)]
    fn len(&self) -> usize {
        1 << (self.0.addr() & (SLICE_ALIGNMENT - 1))
    }

    fn layout(len: usize) -> Layout {
        let layout = Layout::array::<C>(len).and_then(|cells| cells.align_to(SLICE_ALIGNMENT));
        layout.unwrap_or_else(|_| bun_alloc::out_of_memory())
    }
}

struct Retired<C> {
    slice: Slice<C>,
    next: *mut Retired<C>,
}

/// Stores the newest `Slice` of each series in a `Newest`, or null for a series that's still empty.
///
/// # Safety
/// Every series has one pointer, which starts out null. `existing`, `entry` and `for_each` return that pointer, and the
/// implementation never writes to it.
pub unsafe trait Series<C, A>: Sized {
    fn new_in(alloc: A) -> Self;
    /// Returns the pointer of `series` for reading, or `None` if it's known to be null.
    fn existing(&self, series: usize) -> Option<&AtomicPtr<C>>;
    /// Returns the pointer of `series` for writing.
    fn entry(&self, series: usize) -> &AtomicPtr<C>;
    fn for_each(&self, visit: impl FnMut(&AtomicPtr<C>));
}

/// A fixed number of series. The pointers are adjacent, so eight share a cache line, and threads don't write anything
/// else on those lines.
pub struct Fixed<C, const N: usize>([AtomicPtr<C>; N]);

// SAFETY: a series' pointer is the array element at the series' number.
unsafe impl<C, A, const N: usize> Series<C, A> for Fixed<C, N> {
    fn new_in(_: A) -> Self {
        Fixed([const { AtomicPtr::new(null_mut()) }; N])
    }
    #[inline(always)]
    fn existing(&self, series: usize) -> Option<&AtomicPtr<C>> {
        Some(&self.0[series])
    }
    #[inline(always)]
    fn entry(&self, series: usize) -> &AtomicPtr<C> {
        &self.0[series]
    }
    fn for_each(&self, visit: impl FnMut(&AtomicPtr<C>)) {
        self.0.iter().for_each(visit);
    }
}

/// The data a `Growing` stores per series.
struct Head<C> {
    newest: AtomicPtr<C>,
    count: AtomicU32,
}

/// Number of `Head`s in the first chunk of a `Growing`, as a power of two.
const FIRST_HEADS_BITS: u32 = 6;

type Heads<C, A> = Chunks<Head<C>, FIRST_HEADS_BITS, A>;

/// A growing number of series, each with a counter. The series are numbered from 0 in each of four groups. The top bits
/// of a series number select the group (see `Growing::series`).
pub struct Growing<C, A: Allocator + Clone>([Heads<C, A>; 4]);

impl<C, A: Allocator + Clone> Growing<C, A> {
    const GROUP_SHIFT: u32 = 28;

    /// Returns the number of series `index` of `group`. `index` must be below 2^28.
    #[inline(always)]
    pub fn series(group: usize, index: u32) -> usize {
        (group << Self::GROUP_SHIFT) | index as usize
    }

    #[inline(always)]
    fn split(&self, series: usize) -> (&Heads<C, A>, u32) {
        let index = series & ((1 << Self::GROUP_SHIFT) - 1);
        (&self.0[(series >> Self::GROUP_SHIFT) % 4], index as u32)
    }

    #[inline]
    fn head(&self, series: usize) -> &Head<C> {
        fn zeroed<C, A: Allocator>(len: usize, alloc: A) -> Box<[Head<C>], A> {
            // SAFETY: all zero bytes are a valid `Head`, with a null pointer and a count of 0.
            unsafe { Box::new_zeroed_slice_in(len, alloc).assume_init() }
        }
        let (heads, index) = self.split(series);
        // SAFETY: the address is inside the chunk, which `zeroed` initialized and only the drop frees.
        unsafe { &*heads.slot_or_install(index, zeroed) }
    }

    /// Returns the counter of `series`, which starts at 0.
    #[inline]
    pub fn count(&self, series: usize) -> &AtomicU32 {
        &self.head(series).count
    }
}

// SAFETY: a series' pointer is in its `Head`, which is zeroed when its chunk is allocated and never moves.
unsafe impl<C, A: Allocator + Clone> Series<C, A> for Growing<C, A> {
    fn new_in(alloc: A) -> Self {
        Growing(std::array::from_fn(|_| Chunks::new_in(alloc.clone())))
    }
    #[inline(always)]
    fn existing(&self, series: usize) -> Option<&AtomicPtr<C>> {
        let (heads, index) = self.split(series);
        let Located { chunk, offset } = Heads::<C, A>::locate(index);
        // A writer of another series, under another lock, may have just installed the chunk.
        let base = heads.bases[chunk].load(Ordering::Acquire);
        if base.is_null() {
            return None;
        }
        // SAFETY: as in `head`.
        Some(unsafe { &(*base.wrapping_add(offset)).newest })
    }
    #[inline(always)]
    fn entry(&self, series: usize) -> &AtomicPtr<C> {
        &self.head(series).newest
    }
    fn for_each(&self, mut visit: impl FnMut(&AtomicPtr<C>)) {
        let bases = (self.0.iter()).flat_map(|heads| heads.bases.iter().enumerate());
        for (chunk, base) in bases {
            let base = base.load(Ordering::Acquire);
            if !base.is_null() {
                let len = Heads::<C, A>::len_of(chunk);
                // SAFETY: the chunk starts `len` after its base and has `len` heads. See `head`.
                let heads = unsafe { std::slice::from_raw_parts(base.wrapping_add(len), len) };
                heads.iter().for_each(|head| visit(&head.newest));
            }
        }
    }
}

/// Several series of cell slices. Readers get the newest slice of a series without a lock. Each series is a shard of a
/// table, and a bigger slice replaces the newest one when the shard fills up. Older slices stay allocated until
/// `free_retired`, because a reader may still be using one.
pub struct Newest<C, A: Allocator + Clone = Global, S: Series<C, A> = Fixed<C, 1>> {
    newest: S,
    retired: AtomicPtr<Retired<C>>,
    alloc: A,
    owns: Owns<C>,
}

impl<C: Zeroed, A: Allocator + Clone + Default, S: Series<C, A>> Default for Newest<C, A, S> {
    fn default() -> Self {
        Self::new_in(A::default())
    }
}

impl<C: Zeroed, A: Allocator + Clone, S: Series<C, A>> Newest<C, A, S> {
    pub fn new_in(alloc: A) -> Self {
        Newest {
            newest: S::new_in(alloc.clone()),
            retired: AtomicPtr::new(null_mut()),
            alloc,
            owns: PhantomData,
        }
    }

    #[inline]
    pub fn series(&self) -> &S {
        &self.newest
    }

    /// Returns the newest slice of `series`, or an empty slice if there isn't one yet. Pass `Relaxed` only if something
    /// else has ordered the last `replace` before this call.
    #[inline]
    pub fn get(&self, series: usize, order: Ordering) -> &[C] {
        let Some(newest) = self.newest.existing(series) else {
            return &[];
        };
        let newest = Slice(newest.load(order));
        if newest.0.is_null() {
            return &[];
        }
        // SAFETY: `replace` stored this address and length after it initialized that many cells. Only `free_retired`
        // frees them, and only after they're retired.
        unsafe { std::slice::from_raw_parts(newest.first(), newest.len()) }
    }

    /// Replaces the newest slice of `series` with `len` zeroed cells. `len` must be a power of two. `fill` stores into
    /// the new cells before any reader sees them. Only one thread at a time may replace a given series, so the caller
    /// must either lock the series or have exclusive use of the `Newest`.
    pub fn replace(&self, series: usize, len: usize, fill: impl FnOnce(&[C])) -> &[C] {
        assert!(len.is_power_of_two());
        let layout = Slice::<C>::layout(len);
        let Ok(block) = self.alloc.allocate_zeroed(layout) else {
            bun_alloc::out_of_memory()
        };
        let first = block.cast::<C>().as_ptr();
        // SAFETY: `block` has room for `len` cells and is aligned for them, and all zero bytes are a valid `C`.
        let cells = unsafe { std::slice::from_raw_parts(first, len) };
        touch_pages(cells);
        fill(cells);
        let old = (self.newest.entry(series)).swap(Slice::new(first, len).0, Ordering::Release);
        self.retire(Slice(old));
        cells
    }
}

impl<C, A: Allocator + Clone, S: Series<C, A>> Newest<C, A, S> {
    /// Adds `slice` to the retired list. Any thread may call this, because different series can be replaced at the same
    /// time.
    fn retire(&self, slice: Slice<C>) {
        if slice.0.is_null() {
            return;
        }
        let mut next = self.retired.load(Ordering::Relaxed);
        let retired = Box::new_in(Retired { slice, next }, self.alloc.clone());
        let retired = Box::into_raw_with_allocator(retired).0;
        while let Err(now) = (self.retired).compare_exchange_weak(
            next,
            retired,
            Ordering::Release,
            Ordering::Relaxed,
        ) {
            next = now;
            // SAFETY: `retired` came from a box above, and no other thread has seen it.
            unsafe { (*retired).next = now };
        }
    }

    /// Frees every slice except the newest of each series.
    #[inline]
    pub fn free_retired(&mut self) {
        let mut next = std::mem::replace(self.retired.get_mut(), null_mut());
        while !next.is_null() {
            // SAFETY: `retire` made `next` from a box in this allocator, and `replace` allocated the slice from the
            // same allocator with this layout. A slice is retired only once, after `newest` has stopped pointing to it.
            // The list is already unlinked, and `&mut self` proves that no reference to a cell is in use.
            next = unsafe {
                let retired = Box::from_raw_in(next, self.alloc.clone());
                let first = NonNull::new_unchecked(retired.slice.first());
                (self.alloc).deallocate(first.cast(), Slice::<C>::layout(retired.slice.len()));
                retired.next
            };
        }
    }

    /// Frees every slice.
    pub fn clear(&mut self) {
        (self.newest)
            .for_each(|newest| self.retire(Slice(newest.swap(null_mut(), Ordering::Relaxed))));
        self.free_retired();
    }
}

impl<C, A: Allocator + Clone, S: Series<C, A>> Drop for Newest<C, A, S> {
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

    /// `Global` with a count of the live blocks.
    #[derive(Copy, Clone)]
    struct Counting<'a>(&'a AtomicUsize);

    // SAFETY: every method forwards to `Global`.
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
            // SAFETY: the caller upholds `deallocate`'s contract.
            unsafe { Global.deallocate(block, layout) };
        }
    }

    /// A value that's counted while it's alive.
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
        // Indices that wrap around map to separate chunks, which are never allocated.
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
    fn panic_during_drain_leaks_but_never_double_frees() {
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
    fn drop_drops_the_elements() {
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
    fn release_frees_only_long_chunks() {
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
    fn clear_frees_only_long_chunks() {
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
    fn threads_read_each_others_pushes() {
        const THREADS: u32 = 4;
        const EACH: u32 = if cfg!(miri) { 400 } else { 20_000 };
        let alive = AtomicUsize::new(0);
        let vec = AppendVec::<Counted>::new();
        // Each value's index plus one, published the way the checker's tables publish theirs.
        let index_cells: Vec<AtomicU32> = (0..THREADS * EACH).map(|_| AtomicU32::new(0)).collect();
        std::thread::scope(|scope| {
            for thread in 0..THREADS {
                let (vec, index_cells, alive) = (&vec, &index_cells, &alive);
                scope.spawn(move || {
                    for i in 0..EACH {
                        let value = thread * EACH + i;
                        let index = vec.push(Counted::new(value, alive));
                        index_cells[value as usize].store(index + 1, Ordering::Release);
                        let other = (value * 7 + 3) % (THREADS * EACH);
                        match index_cells[other as usize].load(Ordering::Acquire) {
                            0 => {}
                            index_plus_one => assert_eq!(vec.get(index_plus_one - 1).0, other),
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
    fn threads_write_indices_reserved_by_one_thread() {
        const THREADS: u32 = 4;
        const EACH: u32 = if cfg!(miri) { 300 } else { 5_000 };
        let vec = AppendVec::<Box<u32>>::new();
        vec.push(Box::new(u32::MAX));
        // SAFETY: every reserved index is written exactly once below, before it's read.
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
    fn fixed_cells_start_at_zero_and_exist_once_their_page_is_written() {
        const PER_PAGE: usize = SMALLEST_PAGE / size_of::<AtomicU32>();
        const LEN: usize = 2 * PER_PAGE + 3;
        let cells = FixedCells::<AtomicU32>::new_in(LEN, Global);
        assert!((0..LEN).all(|index| cells.existing(index).is_none()));
        assert_eq!(cells.written().count(), 0);
        cells.cell(2 * PER_PAGE + 1).store(9, Ordering::Relaxed);
        assert!(cells.existing(2 * PER_PAGE - 1).is_none());
        let last: Vec<u32> = (2 * PER_PAGE..LEN)
            .map(|index| cells.existing(index).unwrap().load(Ordering::Relaxed))
            .collect();
        assert_eq!(last, [0, 9, 0]);
        assert_eq!(cells.cell(0).load(Ordering::Relaxed), 0);
        let lengths: Vec<usize> = cells.written().map(<[_]>::len).collect();
        assert_eq!(lengths, [PER_PAGE, 3]);
        assert_eq!(
            FixedCells::<AtomicU64>::new_in(0, Global).written().count(),
            0
        );
    }

    #[test]
    fn written_in_skips_unwritten_pages_and_clips_to_the_range() {
        const PER_PAGE: usize = SMALLEST_PAGE / size_of::<AtomicU32>();
        let cells = FixedCells::<AtomicU32>::new_in(3 * PER_PAGE, Global);
        assert_eq!(cells.written_in(0..3 * PER_PAGE).count(), 0);
        cells.cell(PER_PAGE - 1).store(7, Ordering::Relaxed);
        cells.cell(2 * PER_PAGE).store(8, Ordering::Relaxed);
        // Starts inside the first page, crosses the unwritten second page, and ends inside the third.
        let found: Vec<(usize, u32)> = (cells.written_in(PER_PAGE - 2..2 * PER_PAGE + 2))
            .map(|(index, cell)| (index, cell.load(Ordering::Relaxed)))
            .collect();
        let expected = [
            (PER_PAGE - 2, 0),
            (PER_PAGE - 1, 7),
            (2 * PER_PAGE, 8),
            (2 * PER_PAGE + 1, 0),
        ];
        assert_eq!(found, expected);
        assert_eq!(cells.written_in(PER_PAGE..2 * PER_PAGE).count(), 0);
        assert_eq!(cells.written_in(5..5).count(), 0);
        assert_eq!(cells.written_in(0..3 * PER_PAGE).count(), 2 * PER_PAGE);
    }

    #[test]
    fn threads_race_to_write_to_a_page_first() {
        const THREADS: usize = 4;
        const ROUNDS: u32 = if cfg!(miri) { 2 } else { 200 };
        for _ in 0..ROUNDS {
            let cells = FixedCells::<AtomicU64>::new_in(1_000, Global);
            let start = Barrier::new(THREADS);
            std::thread::scope(|scope| {
                for thread in 0..THREADS {
                    let (cells, start) = (&cells, &start);
                    scope.spawn(move || {
                        start.wait();
                        for index in [thread, 600 + thread, 7, 999] {
                            cells.cell(index).fetch_add(1, Ordering::Relaxed);
                        }
                    });
                }
            });
            let all = cells.written().flatten();
            let sum: u64 = all.map(|it| it.load(Ordering::Relaxed)).sum();
            assert_eq!(sum, 4 * THREADS as u64);
            assert_eq!(cells.cell(7).load(Ordering::Relaxed), THREADS as u64);
        }
    }

    #[test]
    #[should_panic]
    fn out_of_range_cell_panics() {
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
            // The end of the scope joins the threads, which orders the writes before these relaxed loads.
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
        const TABLES: u64 = if cfg!(miri) { 1 << 6 } else { 1 << 16 };
        let newest = Newest::<AtomicU64>::default();
        assert!(newest.get(0, Ordering::Acquire).is_empty());
        std::thread::scope(|scope| {
            for _ in 0..3 {
                scope.spawn(|| {
                    let mut last = 0;
                    while last < TABLES {
                        let cells = newest.get(0, Ordering::Acquire);
                        // `fill` stored the length in every cell.
                        let len = cells.len() as u64;
                        assert!(cells.iter().all(|it| it.load(Ordering::Relaxed) == len));
                        assert!(len >= last);
                        last = len;
                        std::thread::yield_now();
                    }
                });
            }
            for len in (0..=TABLES.ilog2()).map(|log| 1 << log) {
                let cells = newest.replace(0, len as usize, |cells| {
                    assert!(cells.iter().all(|it| it.load(Ordering::Relaxed) == 0));
                    cells.iter().for_each(|it| it.store(len, Ordering::Relaxed));
                });
                assert_eq!(cells.len() as u64, len);
            }
        });
    }

    #[test]
    fn segmented_vector_elements_never_move() {
        let vec = Segmented::<Box<u32>, Cell<u32>>::new_in(Global);
        let first = vec.get(vec.push(Box::new(0)));
        // More than two segments. Miri gets fewer because 131,077 elements took it a minute.
        let many = if cfg!(miri) {
            300
        } else {
            2 * SEGMENT as u32 + 5
        };
        for value in 1..many {
            assert_eq!(vec.push(Box::new(value)), value);
        }
        assert_eq!(**first, 0);
        assert_eq!(vec.len(), many);
        for value in 0..many {
            assert_eq!(**vec.get(value), value);
        }
        let (second, third) = (vec.get(1), vec.get(2));
        assert_eq!(
            std::ptr::from_ref(second).wrapping_add(1),
            std::ptr::from_ref(third)
        );
    }

    #[test]
    fn a_segmented_vector_drops_and_drains_like_the_others() {
        let alive = AtomicUsize::new(0);
        let mut vec = Segmented::<Counted, Cell<u32>>::new_in(Global);
        for round in 0..2 {
            for value in 0..100 {
                vec.push(Counted::new(value + round, &alive));
            }
            assert_eq!(alive.load(Ordering::Relaxed), 100);
            let mut expected = 0;
            vec.drain(|index, value| {
                assert_eq!((index, value.0), (expected, expected + round));
                expected += 1;
            });
            assert_eq!((expected, vec.len()), (100, 0));
            assert_eq!(alive.load(Ordering::Relaxed), 0);
        }
        vec.push(Counted::new(1, &alive));
        drop(vec);
        assert_eq!(alive.load(Ordering::Relaxed), 0);
    }

    /// 114,688 pushes take four minutes under Miri. The next test allocates segments without filling them.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn cleared_segmented_vector_keeps_its_first_segment() {
        let blocks = AtomicUsize::new(0);
        let count = || blocks.load(Ordering::Relaxed);
        let mut vec = Segmented::<u64, Cell<u32>, _>::new_in(Counting(&blocks));
        assert_eq!(count(), 0);
        for value in 0..5 * SEGMENT as u64 {
            vec.push(value);
        }
        // Five segments and the directory.
        assert_eq!(count(), 6);
        vec.clear();
        assert_eq!(count(), 2);
        for value in 0..2 * SEGMENT as u64 {
            assert_eq!(u64::from(vec.push(value)), value);
        }
        assert_eq!(*vec.get(2 * SEGMENT as u32 - 1), 2 * SEGMENT as u64 - 1);
        drop(vec);
        assert_eq!(count(), 0);
    }

    #[test]
    fn elements_do_not_move_when_the_directory_grows() {
        let mut vec = Segmented::<u64, Cell<u32>>::new_in(Global);
        vec.push(7);
        let first = vec.get_layered(OWN);
        // The directory starts with four entries.
        for segment in 1..5 {
            vec.install(segment * SEGMENT as u32);
        }
        assert_eq!(*first, 7);
        assert!(std::ptr::eq(first, vec.get_layered(OWN)) && std::ptr::eq(first, vec.get(0)));
        vec.clear();
        vec.install(SEGMENT as u32);
        assert_eq!((vec.push(8), *vec.get_layered(OWN)), (0, 8));
    }

    #[test]
    fn threads_fill_a_segmented_vector_reserved_by_one_thread() {
        const THREADS: u32 = 4;
        const EACH: u32 = if cfg!(miri) { 300 } else { SEGMENT as u32 };
        let blocks = AtomicUsize::new(0);
        let vec = Segmented::<Box<u32>, AtomicU32, _>::new_in(Counting(&blocks));
        vec.push(Box::new(u32::MAX));
        // SAFETY: every reserved index is written exactly once below, before it's read.
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
        // A thread that loses the race to install a segment frees the one it allocated.
        let segments = (vec.len() as usize).div_ceil(SEGMENT);
        assert_eq!(blocks.load(Ordering::Relaxed), segments + 1);
    }

    #[test]
    fn layered_vector_reads_the_shared_vectors_elements() {
        let shared = Segmented::<u64, AtomicU32>::new_in(Global);
        let mut own = Segmented::<u64, Cell<u32>>::new_in(Global);
        assert!(!own.is_layered_over(shared.elements()));
        own.layer_over(shared.elements());
        assert!(own.is_layered_over(shared.elements()));
        // Crosses segment boundaries, with enough segments that the directory grows twice.
        let many = if cfg!(miri) {
            300
        } else {
            9 * SEGMENT as u32 + 1
        };
        for value in 0..many {
            shared.push(u64::from(value));
            own.push(u64::from(value) + 1_000_000_000);
        }
        for number in 0..many {
            assert!(std::ptr::eq(own.get_layered(number), shared.get(number)));
            assert!(std::ptr::eq(own.get_layered(number | OWN), own.get(number)));
            assert_eq!(*own.get_layered(number), u64::from(number));
            assert_eq!(
                *own.get_layered(number | OWN),
                u64::from(number) + 1_000_000_000
            );
        }
    }

    #[test]
    #[should_panic]
    fn number_of_a_cleared_element_panics() {
        let mut own = Segmented::<u64, Cell<u32>>::new_in(Global);
        own.push(1);
        assert_eq!(*own.get_layered(OWN), 1);
        own.clear();
        own.get_layered(OWN);
    }

    #[test]
    #[should_panic]
    fn shared_number_panics_without_a_shared_vector() {
        let own = Segmented::<u64, Cell<u32>>::new_in(Global);
        own.push(1);
        own.get_layered(0);
    }

    #[test]
    fn threads_replace_their_own_placeholders() {
        // Miri needs a minute for 16 rounds.
        const ROUNDS: u32 = if cfg!(miri) { 2 } else { 16 };
        let store = Segmented::<u64, AtomicU32>::new_in(Global);
        std::thread::scope(|scope| {
            for thread in 0..8 {
                let store = &store;
                scope.spawn(move || {
                    for _ in 0..ROUNDS {
                        let mut mine = store.add_placeholders(64, || u64::MAX);
                        let first = mine.first().unwrap();
                        // The last placeholder is never replaced.
                        for index in first..first + 63 {
                            let one = mine.take_first().unwrap();
                            assert_eq!(one.index(), index);
                            let value = thread << 32 | u64::from(index);
                            assert_eq!(*store.replace(one, value), value);
                        }
                        assert_eq!(mine.first(), Some(first + 63));
                    }
                });
            }
        });
        assert_eq!(store.len(), 8 * ROUNDS * 64);
        for index in 0..store.len() {
            match index % 64 {
                63 => assert_eq!(*store.get(index), u64::MAX),
                _ => assert_eq!(*store.get(index) as u32, index),
            }
        }
        assert!(Placeholders::default().take_first().is_none());
    }

    #[test]
    #[should_panic]
    fn replacing_a_placeholder_in_another_vector_panics() {
        let [one, other] = [(), ()].map(|()| Segmented::<u64, AtomicU32>::new_in(Global));
        other.push(1);
        let placeholder = one.add_placeholders(1, || 0).take_first().unwrap();
        other.replace(placeholder, 2);
    }

    fn is_send<T: Send>() {}
    fn is_sync<T: Sync>() {}

    #[test]
    fn containers_are_send_and_sync() {
        is_send::<AppendVec<Box<u32>>>();
        is_sync::<AppendVec<Box<u32>>>();
        is_send::<LocalVec<Box<u32>>>();
        is_send::<Cells<AtomicU32>>();
        is_sync::<Cells<AtomicU32>>();
        is_sync::<Newest<AtomicU64>>();
        is_send::<Segmented<'static, Box<u32>, AtomicU32>>();
        is_sync::<Segmented<'static, Box<u32>, AtomicU32>>();
        is_send::<Segmented<'static, Box<u32>, Cell<u32>>>();
    }

    /// Each thread uses series that no other thread uses, as if it held their locks. The series share chunks of heads,
    /// so a thread reads a head in a chunk that another thread has just allocated.
    #[test]
    fn threads_use_series_that_share_a_chunk() {
        type Many = Growing<AtomicU32, Global>;
        const THREADS: u32 = 3;
        for _ in 0..8 {
            let newest = Newest::<AtomicU32, Global, Many>::default();
            let start = Barrier::new(THREADS as usize);
            std::thread::scope(|scope| {
                for thread in 0..THREADS {
                    let (newest, start) = (&newest, &start);
                    scope.spawn(move || {
                        start.wait();
                        for round in 0..40 {
                            let series = Many::series(0, round * THREADS + thread);
                            assert!(newest.get(series, Ordering::Relaxed).is_empty());
                            let mark = series as u32 + 1;
                            newest.replace(series, 2, |cells| {
                                cells[0].store(mark, Ordering::Relaxed);
                            });
                            let count = newest.series().count(series);
                            assert_eq!(count.fetch_add(1, Ordering::Relaxed), 0);
                            let cells = newest.get(series, Ordering::Relaxed);
                            assert_eq!(cells[0].load(Ordering::Relaxed), mark);
                        }
                    });
                }
            });
        }
    }

    #[test]
    fn every_block_is_returned_to_its_allocator() {
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
        // One chunk each, plus the page bits of `cells`. A thread that loses the race frees its chunk immediately.
        assert_eq!(count(), 3);
        drop((cells, vec));
        assert_eq!(count(), 0);

        let mut newest = Newest::<AtomicU32, _, Fixed<_, 2>>::new_in(alloc);
        let first = newest.replace(1, 4, |_| {});
        newest.replace(1, 8, |_| {});
        newest.replace(0, 1, |_| {});
        let len = |newest: &Newest<_, _, Fixed<_, 2>>, series| {
            newest.get(series, Ordering::Relaxed).len()
        };
        assert_eq!((first.len(), len(&newest, 1), len(&newest, 0)), (4, 8, 1));
        // One allocation per slice, plus the list node for the retired slice.
        assert_eq!(count(), 4);
        newest.free_retired();
        assert_eq!((len(&newest, 1), len(&newest, 0), count()), (8, 1, 2));
        newest.clear();
        assert_eq!((len(&newest, 1), len(&newest, 0), count()), (0, 0, 0));
        newest.replace(0, 2, |_| {});
        drop(newest);
        assert_eq!(count(), 0);

        type Many<'a> = Growing<AtomicU32, Counting<'a>>;
        let mut newest = Newest::<AtomicU32, _, Many<'_>>::new_in(alloc);
        // `far` is in the second chunk of heads. Miri needs a minute for a chunk of 4,096.
        let (near, far, other) = (Many::series(0, 3), Many::series(0, 100), Many::series(3, 3));
        let len =
            |newest: &Newest<_, _, Many<'_>>, series| newest.get(series, Ordering::Relaxed).len();
        assert_eq!((len(&newest, near), len(&newest, far), count()), (0, 0, 0));
        newest.replace(near, 4, |_| {});
        newest.replace(far, 2, |_| {});
        newest.replace(other, 1, |_| {});
        newest.replace(near, 8, |_| {});
        newest.series().count(near).store(7, Ordering::Relaxed);
        let lens = (len(&newest, near), len(&newest, far), len(&newest, other));
        assert_eq!(lens, (8, 2, 1));
        let counter = |series| newest.series().count(series).load(Ordering::Relaxed);
        assert_eq!((counter(near), counter(far), counter(other)), (7, 0, 0));
        // Three chunks of heads, four slices, and the list node for the retired slice.
        assert_eq!(count(), 8);
        newest.free_retired();
        assert_eq!((len(&newest, near), count()), (8, 6));
        newest.clear();
        assert_eq!((len(&newest, near), len(&newest, far), count()), (0, 0, 3));
        drop(newest);
        assert_eq!(count(), 0);

        drop(AtomicU64::zeroed_slice_in(10, alloc));
        assert_eq!(count(), 0);
    }
}
