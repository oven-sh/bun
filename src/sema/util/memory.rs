//! The memory that the checker manages by hand. The containers of this crate that need `unsafe` are
//! here. The file depends on `std`, and on `libc` for the three calls of `os`, which have a stand-in
//! under Miri: so its tests run there.
//!
//! An element never moves and is never freed before its container, so a reference to one stays
//! valid while others are added:
//!
//! - `AppendVec`: a vector that any thread appends to and reads without a lock.
//! - `LocalVec`: the same for one thread, without atomic read-modify-write operations.
//! - `Flat`: either of the two with its elements next to each other, in a range of addresses that is
//!   reserved at the start. The address of an element is a multiplication and an addition.
//! - `Cells`: atomic integers for a range of indices that keeps growing, initially all zero.
//! - `Newest`: the newest of a series of slices of cells, read without a lock.
//!
//! All but a `Flat` get their memory from the allocator that they hold, and return it there. Any
//! thread that adds to an `AppendVec`, a `Cells` or a `Newest` may allocate, and the thread that drops
//! it frees.

use std::alloc::{Allocator, Global};
use std::cell::Cell;
use std::marker::PhantomData;
use std::mem::MaybeUninit;
use std::ptr::{NonNull, null_mut, slice_from_raw_parts_mut};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, AtomicU64, AtomicUsize, Ordering};

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
    /// Null, or where the chunk starts. Nothing reads it: no address in `bases` is in a chunk, so to a tool that looks for
    /// what a process still refers to when it ends without dropping this, the chunks would be lost. Only where there is such
    /// a tool: it is as large as `bases`, a map has 64 of these, and a resolver for each referenced project has five maps.
    #[cfg(bun_asan)]
    starts: [AtomicPtr<E>; CHUNKS],
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
            #[cfg(bun_asan)]
            starts: [const { AtomicPtr::new(null_mut()) }; CHUNKS],
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
            Ok(_) => {
                #[cfg(bun_asan)]
                self.starts[chunk].store(fresh, Ordering::Relaxed);
                base
            }
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
                #[cfg(bun_asan)]
                {
                    *self.starts[chunk].get_mut() = null_mut();
                }
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

/// What a vector that several threads fill at a barrier offers: one thread makes room, and each
/// element of the room is written once, by any thread.
pub(crate) trait Fill<T> {
    /// See `Stable::get`.
    fn get(&self, index: u32) -> &T;

    /// # Safety
    /// See `Stable::reserve`.
    unsafe fn reserve(&self, count: u32) -> u32;

    /// # Safety
    /// See `Stable::write`.
    unsafe fn write(&self, index: u32, value: T);
}

impl<T, L: Length, A: Allocator + Clone> Fill<T> for Stable<T, L, A> {
    #[inline]
    fn get(&self, index: u32) -> &T {
        Stable::get(self, index)
    }

    unsafe fn reserve(&self, count: u32) -> u32 {
        // SAFETY: the caller's.
        unsafe { Stable::reserve(self, count) }
    }

    #[inline]
    unsafe fn write(&self, index: u32, value: T) {
        // SAFETY: the caller's.
        unsafe { Stable::write(self, index, value) }
    }
}

// ───────────────────────────── reserved addresses ─────────────────────────────

/// A range gets memory in steps of this many bytes: a multiple of the page size of every platform.
const STEP: usize = 64 << 10;

/// A range starts at a multiple of this.
const SMALLEST_PAGE: usize = 4 << 10;

/// A range of addresses is reserved first, which takes no memory. Parts of it get memory later.
#[cfg(all(unix, not(miri)))]
mod os {
    use std::ptr::null_mut;

    #[cfg(any(target_os = "linux", target_os = "android"))]
    const WITHOUT_MEMORY: libc::c_int = libc::MAP_PRIVATE | libc::MAP_ANON | libc::MAP_NORESERVE;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    const WITHOUT_MEMORY: libc::c_int = libc::MAP_PRIVATE | libc::MAP_ANON;

    // A tool that looks for what a process still refers to when it ends does not look into a mapping
    // that it is not told about.
    #[cfg(bun_asan)]
    unsafe extern "C" {
        safe fn __lsan_register_root_region(start: *const std::ffi::c_void, len: usize);
        safe fn __lsan_unregister_root_region(start: *const std::ffi::c_void, len: usize);
    }

    /// Null: the addresses are not to be had.
    pub(super) fn reserve(len: usize) -> *mut u8 {
        // SAFETY: no address is asked for, so no mapping that exists changes.
        let at = unsafe { libc::mmap(null_mut(), len, libc::PROT_NONE, WITHOUT_MEMORY, -1, 0) };
        if at == libc::MAP_FAILED {
            return null_mut();
        }
        #[cfg(bun_asan)]
        __lsan_register_root_region(at, len);
        at.cast()
    }

    /// Whether the range has memory now. What had memory keeps its content.
    ///
    /// # Safety
    /// The range is part of one that `reserve` returned and `release` has not been given.
    pub(super) unsafe fn commit(at: *mut u8, len: usize) -> bool {
        // SAFETY: the caller's.
        unsafe { libc::mprotect(at.cast(), len, libc::PROT_READ | libc::PROT_WRITE) == 0 }
    }

    /// # Safety
    /// As for `commit`, and nothing in the range is in use.
    pub(super) unsafe fn decommit(at: *mut u8, len: usize) {
        let fixed = WITHOUT_MEMORY | libc::MAP_FIXED;
        // SAFETY: the caller's. A new mapping replaces the pages of the range, which stays reserved.
        // If it fails, the range has kept its memory, which `commit` allows for.
        unsafe { libc::mmap(at.cast(), len, libc::PROT_NONE, fixed, -1, 0) };
    }

    /// # Safety
    /// `reserve(len)` returned `at`, this is the only call for it, and nothing in the range is in
    /// use.
    pub(super) unsafe fn release(at: *mut u8, len: usize) {
        #[cfg(bun_asan)]
        __lsan_unregister_root_region(at.cast(), len);
        // SAFETY: the caller's.
        unsafe { libc::munmap(at.cast(), len) };
    }
}

#[cfg(all(windows, not(miri)))]
mod os {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    const MEM_COMMIT: u32 = 0x1000;
    const MEM_RESERVE: u32 = 0x2000;
    const MEM_DECOMMIT: u32 = 0x4000;
    const MEM_RELEASE: u32 = 0x8000;
    const PAGE_NOACCESS: u32 = 0x01;
    const PAGE_READWRITE: u32 = 0x04;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn VirtualAlloc(at: *mut c_void, len: usize, kind: u32, protection: u32) -> *mut c_void;
        fn VirtualFree(at: *mut c_void, len: usize, kind: u32) -> i32;
    }

    /// Null: the addresses are not to be had.
    pub(super) fn reserve(len: usize) -> *mut u8 {
        // SAFETY: no address is asked for, so no allocation that exists changes.
        unsafe { VirtualAlloc(null_mut(), len, MEM_RESERVE, PAGE_NOACCESS) }.cast()
    }

    /// Whether the range has memory now. What had memory keeps its content.
    ///
    /// # Safety
    /// The range is part of one that `reserve` returned and `release` has not been given.
    pub(super) unsafe fn commit(at: *mut u8, len: usize) -> bool {
        // SAFETY: the caller's.
        !unsafe { VirtualAlloc(at.cast(), len, MEM_COMMIT, PAGE_READWRITE) }.is_null()
    }

    /// # Safety
    /// As for `commit`, and nothing in the range is in use.
    pub(super) unsafe fn decommit(at: *mut u8, len: usize) {
        // SAFETY: the caller's. If it fails, the range has kept its memory, which `commit` allows
        // for.
        unsafe { VirtualFree(at.cast(), len, MEM_DECOMMIT) };
    }

    /// # Safety
    /// `reserve` returned `at`, this is the only call for it, and nothing in the range is in use.
    pub(super) unsafe fn release(at: *mut u8, _: usize) {
        // SAFETY: the caller's.
        unsafe { VirtualFree(at.cast(), 0, MEM_RELEASE) };
    }
}

/// All of a range has memory from the start: for short ranges.
#[cfg(any(miri, not(any(unix, windows))))]
mod os {
    use std::alloc::{Layout, alloc_zeroed, dealloc};
    use std::ptr::null_mut;

    fn layout(len: usize) -> Option<Layout> {
        Layout::from_size_align(len, super::SMALLEST_PAGE).ok()
    }

    /// Null: the memory is not to be had.
    pub(super) fn reserve(len: usize) -> *mut u8 {
        match layout(len) {
            // SAFETY: the length is not 0: see `Reserved::new`.
            Some(layout) => unsafe { alloc_zeroed(layout) },
            None => null_mut(),
        }
    }

    /// # Safety
    /// None: there is nothing to do.
    pub(super) unsafe fn commit(_: *mut u8, _: usize) -> bool {
        true
    }

    /// # Safety
    /// None: there is nothing to do.
    pub(super) unsafe fn decommit(_: *mut u8, _: usize) {}

    /// # Safety
    /// `reserve(len)` returned `at`, this is the only call for it, and nothing in the range is in
    /// use.
    pub(super) unsafe fn release(at: *mut u8, len: usize) {
        if let Some(layout) = layout(len) {
            // SAFETY: the caller's.
            unsafe { dealloc(at, layout) };
        }
    }
}

#[cold]
#[inline(never)]
fn out_of_memory(bytes: usize) -> ! {
    match std::alloc::Layout::from_size_align(bytes, SMALLEST_PAGE) {
        Ok(layout) => std::alloc::handle_alloc_error(layout),
        Err(_) => std::alloc::handle_alloc_error(std::alloc::Layout::new::<u8>()),
    }
}

/// What a `Reserved` is made for.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct Room {
    pub(crate) bytes: usize,
}

/// A range of addresses that nothing else in the process gets. Its first bytes have memory, as many
/// as were asked for so far. It is used through a `Taken`, by one owner after the other.
pub(crate) struct Reserved {
    base: NonNull<u8>,
    /// In bytes: a multiple of `STEP`, and so is `committed`.
    len: usize,
    /// What `new` was given.
    room: Room,
    /// How many bytes have memory.
    committed: AtomicUsize,
    is_taken: AtomicBool,
}

// SAFETY: it owns the range, and its own fields are atomic or never change. What is in the range is
// reached through a `Taken` only, and what may be done with that from which thread is up to `Flat`.
unsafe impl Send for Reserved {}
// SAFETY: as above.
unsafe impl Sync for Reserved {}

impl Reserved {
    /// Where as many addresses as `room` has bytes are not to be had, it has half as many, or half
    /// of that, and so on: whoever needs more than it has is out of memory.
    pub(crate) fn new(room: Room) -> Reserved {
        let mut len = room.bytes.next_multiple_of(STEP);
        let mut base = NonNull::dangling();
        while len != 0 {
            match NonNull::new(os::reserve(len)) {
                Some(start) => {
                    base = start;
                    break;
                }
                None if len == STEP => out_of_memory(len),
                None => len = (len / 2).next_multiple_of(STEP),
            }
        }
        Reserved {
            base,
            len,
            room,
            committed: AtomicUsize::new(0),
            is_taken: AtomicBool::new(false),
        }
    }

    /// Its first address, as that of a `T`.
    fn first<T>(&self) -> NonNull<T> {
        self.base.cast()
    }

    /// How many of its bytes have memory.
    pub(crate) fn committed_bytes(&self) -> usize {
        self.committed.load(Ordering::Relaxed)
    }

    /// `None`: somebody has it, or it was made for another `Room`.
    pub(crate) fn take(&self, room: Room) -> Option<Taken<'_>> {
        // Looked at first, so that a search does not write to what others have.
        if self.room != room || self.is_taken.load(Ordering::Relaxed) {
            return None;
        }
        let taken =
            (self.is_taken).compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed);
        taken.is_ok().then(|| Taken(self))
    }

    /// Gives memory to the first `bytes` bytes, and to some more. Returns how many have it. Any
    /// thread: two that are here at a time ask for ranges that overlap, which does no harm.
    fn commit(&self, bytes: usize) -> usize {
        if bytes > self.len {
            out_of_memory(bytes);
        }
        let had = self.committed.load(Ordering::Acquire);
        if bytes <= had {
            return had;
        }
        // Half as much again, so that the number of calls grows with the logarithm of the size.
        let wanted = (bytes.max(had + had / 2).next_multiple_of(STEP)).min(self.len);
        // SAFETY: `had <= wanted <= len`, so the range is in the one that `new` reserved.
        if !unsafe { os::commit(self.base.as_ptr().add(had), wanted - had) } {
            out_of_memory(wanted - had);
        }
        (self.committed.fetch_max(wanted, Ordering::Release)).max(wanted)
    }

    /// Takes the memory back from all but the first `keep` bytes. Returns how many have memory.
    ///
    /// # Safety
    /// Nothing beyond the first `keep` bytes is in use, and no other thread is in `commit`.
    unsafe fn decommit(&self, keep: usize) -> usize {
        let keep = keep.next_multiple_of(STEP);
        let had = self.committed.load(Ordering::Relaxed);
        if keep >= had {
            return had;
        }
        // SAFETY: `keep < had <= len`, so the range is in the one that `new` reserved. The rest is
        // the caller's.
        unsafe { os::decommit(self.base.as_ptr().add(keep), had - keep) };
        self.committed.store(keep, Ordering::Relaxed);
        keep
    }
}

impl Drop for Reserved {
    fn drop(&mut self) {
        if self.len != 0 {
            // SAFETY: `new` reserved it, and a `Taken` borrows this, so there is none.
            unsafe { os::release(self.base.as_ptr(), self.len) };
        }
    }
}

/// The right to use a `Reserved`, which one owner has at a time.
pub(crate) struct Taken<'a>(&'a Reserved);

impl Drop for Taken<'_> {
    fn drop(&mut self) {
        self.0.is_taken.store(false, Ordering::Release);
    }
}

// ───────────────────────────── flat vectors ─────────────────────────────

/// The number of elements that a `Flat` which threads share has addresses for: as many as an id can
/// number.
#[cfg(not(any(miri, target_os = "android")))]
const MOST: usize = 1 << 30;
/// There a process may have 512 GB of addresses in all.
#[cfg(all(target_os = "android", not(miri)))]
const MOST: usize = 1 << 24;
/// There all of a range has memory from the start.
#[cfg(miri)]
const MOST: usize = 1 << 14;

/// A `Flat` of one thread has addresses for one in so many of `MOST`. There is a dozen of them for
/// each thread, and a process has 128 TB of addresses.
const SHARE_OF_ONE_THREAD: usize = 4;

/// How many elements of a `Flat` keep their memory when it is emptied, so that one large use does not
/// grow its owner permanently.
const KEPT: usize = 1 << 16;

/// The address of the first element of a `Flat`, or an address at a fixed distance from it.
struct Base<T>(*mut MaybeUninit<T>);

impl<T> Clone for Base<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Base<T> {}

// SAFETY: it stands for the elements, which one thread adds and another reads or drops.
unsafe impl<T: Send + Sync> Send for Base<T> {}
// SAFETY: as above.
unsafe impl<T: Send + Sync> Sync for Base<T> {}

/// In a number that `Flat::of_either` takes: the element is in the vector itself, not in the one
/// that it is laid over.
pub(crate) const OWN: u32 = 1 << 30;

/// A `Stable` whose elements are next to each other: the address of an element is that of the first
/// plus the index times the size. They never move, because the addresses for all that can ever be
/// added are reserved from the start.
pub(crate) struct Flat<'a, T, L: Length> {
    base: Base<T>,
    /// For `of_either`, by the two highest bits of a number: the address that the number times the
    /// size is added to ..
    bases: [Base<T>; 4],
    /// .. and what the number is less than, if it stands for an element.
    limits: [L; 4],
    /// As in `Stable`.
    len: L,
    /// The elements below it have memory.
    committed: AtomicU32,
    block: Taken<'a>,
}

impl<'a, T, L: Length> Flat<'a, T, L> {
    /// How many elements it has addresses for.
    const MOST: usize = match L::IS_CHECKED {
        true => MOST / SHARE_OF_ONE_THREAD,
        false => MOST,
    };

    /// What to ask of `Reserved::new`.
    pub(crate) const ROOM: Room = Room {
        bytes: size_of::<T>() * Self::MOST,
    };

    /// `block`: whatever it holds is lost. With less room than `ROOM` it is out of memory earlier.
    pub(crate) fn new_in(block: Taken<'a>) -> Self {
        const { assert!(size_of::<T>() != 0 && align_of::<T>() <= SMALLEST_PAGE) };
        let committed = block.0.committed.load(Ordering::Relaxed);
        let base = Base(block.0.first().as_ptr());
        let mut bases = [Base(NonNull::dangling().as_ptr()); 4];
        bases[1] = Base(base.0.wrapping_sub(OWN as usize));
        let limits: [L; 4] = Default::default();
        limits[1].add(OWN);
        Flat {
            base,
            bases,
            limits,
            len: L::default(),
            committed: AtomicU32::new(Self::elements_in(committed)),
            block,
        }
    }

    fn elements_in(bytes: usize) -> u32 {
        (bytes / size_of::<T>()).min(Self::MOST) as u32
    }

    #[inline]
    pub(crate) fn len(&self) -> u32 {
        self.len.get()
    }

    /// The address of the element `index`. Meaningless if it has no memory.
    #[inline]
    fn slot(&self, index: u32) -> *mut MaybeUninit<T> {
        self.base.0.wrapping_add(index as usize)
    }

    /// Any thread.
    #[cold]
    #[inline(never)]
    fn commit(&self, index: u32) {
        if index as usize >= Self::MOST {
            out_of_memory(Self::ROOM.bytes);
        }
        let committed = self.block.0.commit((index as usize + 1) * size_of::<T>());
        (self.committed).fetch_max(Self::elements_in(committed), Ordering::Release);
    }

    /// Returns the index of the element.
    #[inline]
    pub(crate) fn push(&self, value: T) -> u32 {
        let index = self.len.add(1);
        // SAFETY: `add` has given the index to this call alone, which has not returned it yet.
        unsafe { Fill::write(self, index, value) };
        if L::IS_CHECKED {
            self.limits[1].add(1);
        }
        index
    }

    /// `index` was returned by `push`, or passed to `write`. One that threads share trusts that, like
    /// an `AppendVec`.
    #[inline]
    pub(crate) fn get(&self, index: u32) -> &T {
        if L::IS_CHECKED {
            assert!(index < self.len.get());
        } else {
            debug_assert!(index < self.len.get());
        }
        // SAFETY: the element was initialized before its index reached this thread. Nothing writes
        // to it again before `&mut self`.
        unsafe { (*self.slot(index)).assume_init_ref() }
    }

    /// Moves the elements out, in order, and leaves it empty. See `KEPT`.
    pub(crate) fn drain(&mut self, mut take: impl FnMut(u32, T)) {
        self.limits[1].take();
        self.limits[1].add(OWN);
        for index in 0..self.len.take() {
            // SAFETY: the elements below the length are initialized. The length is 0 by now, so
            // none is read again, even if `take` panics.
            take(index, unsafe { (*self.slot(index)).assume_init_read() });
        }
        // SAFETY: there is no element, and `&mut self` shows that no thread is adding one.
        let committed = unsafe { self.block.0.decommit(KEPT * size_of::<T>()) };
        *self.committed.get_mut() = Self::elements_in(committed);
    }

    pub(crate) fn clear(&mut self) {
        self.drain(|_, value| drop(value));
    }
}

impl<T, L: Length> Drop for Flat<'_, T, L> {
    fn drop(&mut self) {
        self.clear();
    }
}

impl<T, L: Length> Fill<T> for Flat<'_, T, L> {
    #[inline]
    fn get(&self, index: u32) -> &T {
        Flat::get(self, index)
    }

    unsafe fn reserve(&self, count: u32) -> u32 {
        let first = self.len.add(count);
        if count != 0 && first + (count - 1) >= self.committed.load(Ordering::Acquire) {
            self.commit(first + (count - 1));
        }
        first
    }

    #[inline]
    unsafe fn write(&self, index: u32, value: T) {
        if index >= self.committed.load(Ordering::Acquire) {
            self.commit(index);
        }
        // SAFETY: the element has memory. Only this call accesses it, and what it holds is not
        // dropped.
        unsafe { self.slot(index).write(MaybeUninit::new(value)) };
    }
}

/// Elements of one `Flat` that stand for what is to come, one after the other. Nobody but the owner of
/// this can replace them.
pub(crate) struct Placeholders<'a> {
    /// The address of the first element of the vector.
    of: usize,
    next: u32,
    end: u32,
    borrowed: PhantomData<&'a ()>,
}

/// One of `Placeholders`.
pub(crate) struct Placeholder<'a> {
    of: usize,
    index: u32,
    borrowed: PhantomData<&'a ()>,
}

/// None.
impl Default for Placeholders<'_> {
    fn default() -> Self {
        Placeholders {
            of: 0,
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

    /// The index of the first.
    pub(crate) fn first(&self) -> Option<u32> {
        (!self.is_empty()).then_some(self.next)
    }

    #[inline]
    pub(crate) fn take_first(&mut self) -> Option<Placeholder<'a>> {
        let index = self.first()?;
        self.next += 1;
        Some(Placeholder {
            of: self.of,
            index,
            borrowed: PhantomData,
        })
    }
}

impl Placeholder<'_> {
    /// Not for `Flat::get` before `Flat::replace` has returned.
    #[inline]
    pub(crate) fn index(&self) -> u32 {
        self.index
    }
}

/// The elements of a `Flat` that threads share, those to come too, for reading. Like a `&'a [T]` it
/// can pass for one of elements that live for a shorter time.
pub(crate) struct Elements<'a, T> {
    first: NonNull<MaybeUninit<T>>,
    borrowed: PhantomData<&'a [T]>,
}

impl<T> Clone for Elements<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Elements<'_, T> {}

impl<T> Flat<'_, T, AtomicU32> {
    /// Adds `count` elements. Any thread.
    pub(crate) fn add_placeholders(&self, count: u32, new: impl Fn() -> T) -> Placeholders<'_> {
        // SAFETY: each index is written below, and goes nowhere before.
        let next = unsafe { self.reserve(count) };
        for index in next..next + count {
            // SAFETY: once, and no other thread has the index.
            unsafe { self.write(index, new()) };
        }
        Placeholders {
            of: self.base.0.addr(),
            next,
            end: next + count,
            borrowed: PhantomData,
        }
    }

    /// Puts `value` in the place of a placeholder, which is not dropped. Any thread.
    #[inline]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "the placeholder ends here, so no second write has one"
    )]
    pub(crate) fn replace(&self, placeholder: Placeholder<'_>, value: T) -> &T {
        // It borrows its vector, so the range has had no other owner since.
        assert!(placeholder.of == self.base.0.addr());
        // SAFETY: there is one `Placeholder` for the index, which ends here, so nothing else writes to
        // the element. Nothing reads it: see `Placeholder::index`.
        unsafe { self.write(placeholder.index, value) };
        self.get(placeholder.index)
    }

    pub(crate) fn elements(&self) -> Elements<'_, T> {
        Elements {
            first: self.block.0.first(),
            borrowed: PhantomData,
        }
    }
}

impl<'a, T> Flat<'a, T, Cell<u32>> {
    /// From now on `of_either` finds `shared` too.
    pub(crate) fn lay_over(&mut self, shared: Elements<'a, T>) {
        self.bases[0] = Base(shared.first.as_ptr());
        self.limits[0].set(OWN);
    }

    /// Whether `lay_over(shared)` was the last call of `lay_over`.
    pub(crate) fn is_laid_over(&self, shared: Elements<'_, T>) -> bool {
        std::ptr::eq(self.bases[0].0, shared.first.as_ptr())
    }

    /// The element `number` of the vector that this one is laid over, or with `OWN` in `number` the
    /// element `number - OWN` of this one. A number without `OWN` is trusted, as in `get`.
    #[inline(always)]
    pub(crate) fn of_either(&self, number: u32) -> &T {
        let which = (number >> 30) as usize;
        // No number without `OWN` is less than its limit before `lay_over`.
        assert!(number < self.limits[which].get());
        // SAFETY: as in `get`, for the one of the two that the number is an index of: `lay_over` was
        // given a borrow of the other that lasts as long as this one can exist.
        unsafe { (*self.bases[which].0.wrapping_add(number as usize)).assume_init_ref() }
    }
}

// ───────────────────────────── cells ─────────────────────────────

/// A type for which all zero bytes are a value.
pub trait Zeroed: Sized {
    /// From the allocator's zeroed memory, which for a long slice comes from the operating system: a
    /// page that is never touched is never resident.
    fn zeroed_slice_in<A: Allocator>(len: usize, alloc: A) -> Box<[Self], A>;
    /// Writes to the cell without changing it.
    fn touch(&self);
}

/// Writes to every page of `cells`, which are about to be read and written all over. A page of zeroed memory from the
/// operating system that is read first takes a second page fault at its first write, which interrupts every other thread.
fn touch_pages<C: Zeroed>(cells: &[C]) {
    (cells.iter().step_by(SMALLEST_PAGE / size_of::<C>())).for_each(C::touch);
    if let Some(last) = cells.last() {
        last.touch();
    }
}

macro_rules! zeroed {
    ($($atomic:ty),*) => {$(
        impl Zeroed for $atomic {
            fn zeroed_slice_in<A: Allocator>(len: usize, alloc: A) -> Box<[Self], A> {
                // SAFETY: an atomic integer has the representation of the integer, for which all
                // zero bytes are 0.
                unsafe { Box::new_zeroed_slice_in(len, alloc).assume_init() }
            }
            #[inline]
            fn touch(&self) {
                // Not `fetch_or(0)`, which may be compiled to a load.
                let _ = self.compare_exchange(0, 0, Ordering::Relaxed, Ordering::Relaxed);
            }
        }
    )*};
}
zeroed!(AtomicU32, AtomicU64);

/// A bit for each page of an array of cells that are initially all zero: whether anything was written there. Who finds the
/// bit clear knows that the cell is zero without reading it. So a page that was never written is never read either: it
/// takes no cache line and no entry of a page table, and its first write is its first page fault. A page of zeroed
/// memory from the operating system that is read first takes a second one then, which interrupts every other thread.
///
/// `index`, here and below: of a cell in the array, which starts at a page boundary if it is longer than a page.
trait Written<C: Zeroed> {
    fn words(&self) -> &[AtomicU64];

    #[inline(always)]
    fn place(index: usize) -> (usize, u64) {
        let page = index / (SMALLEST_PAGE / size_of::<C>());
        (page / 64, 1 << (page % 64))
    }

    /// `true` for a cell beyond those that have a bit.
    #[inline(always)]
    fn may_be_written(&self, index: usize) -> bool {
        let (word, bit) = Self::place(index);
        (self.words().get(word)).is_none_or(|word| word.load(Ordering::Relaxed) & bit != 0)
    }

    /// `cell`, which is the one at `index`, is about to be written.
    #[inline(always)]
    fn note_write(&self, index: usize, cell: &C) {
        let (word, bit) = Self::place(index);
        if let Some(word) = self.words().get(word)
            && word.load(Ordering::Relaxed) & bit == 0
        {
            note_first_write(word, bit, cell);
        }
    }
}

/// The page is written before anyone is told to read it.
#[cold]
fn note_first_write<C: Zeroed>(word: &AtomicU64, bit: u64, cell: &C) {
    cell.touch();
    word.fetch_or(bit, Ordering::Relaxed);
}

/// Cells for a range of indices that is known from the start, initially all zero.
pub struct FixedCells<C, A: Allocator = Global> {
    cells: Box<[C], A>,
    written: Box<[AtomicU64], A>,
}

impl<C: Zeroed, A: Allocator> Written<C> for FixedCells<C, A> {
    #[inline(always)]
    fn words(&self) -> &[AtomicU64] {
        &self.written
    }
}

impl<C: Zeroed, A: Allocator + Clone> FixedCells<C, A> {
    pub fn new_in(len: usize, alloc: A) -> Self {
        let pages = (len * size_of::<C>()).div_ceil(SMALLEST_PAGE);
        FixedCells {
            cells: C::zeroed_slice_in(len, alloc.clone()),
            written: AtomicU64::zeroed_slice_in(pages.div_ceil(64), alloc),
        }
    }

    /// `None`: the cell is zero.
    #[inline]
    pub fn existing(&self, index: usize) -> Option<&C> {
        self.may_be_written(index).then(|| &self.cells[index])
    }

    /// For one who writes to it.
    #[inline]
    pub fn cell(&self, index: usize) -> &C {
        let cell = &self.cells[index];
        self.note_write(index, cell);
        cell
    }

    pub fn all(&self) -> &[C] {
        &self.cells
    }
}

const FIRST_CELLS_BITS: u32 = 12;

/// As many cells of four bytes have a bit in `Cells::written` as a large program has types.
const WRITTEN_WORDS: usize = 256;

/// Cells for a range of indices that keeps growing, initially all zero. `C` is an atomic integer: a
/// cell is only ever accessed through a shared reference.
pub struct Cells<C, A: Allocator + Clone = Global> {
    chunks: Chunks<C, FIRST_CELLS_BITS, A>,
    /// By `Located::offset`: the first cell of every chunk is the first of a page by that count too.
    written: Box<[AtomicU64], A>,
}

impl<C: Zeroed, A: Allocator + Clone> Written<C> for Cells<C, A> {
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

    /// `None`: the cell is zero. For a time when no thread calls `cell`, and something has ordered
    /// the earlier calls before this one.
    #[inline]
    pub fn existing(&self, index: u32) -> Option<&C> {
        self.existing_loaded(index, Ordering::Relaxed)
    }

    /// `existing`, while other threads call `cell`.
    #[inline]
    pub fn existing_by_now(&self, index: u32) -> Option<&C> {
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
        // SAFETY: inside the chunk, which `zeroed_slice_in` has initialized and the drop frees.
        Some(unsafe { &*base.wrapping_add(offset) })
    }

    /// For one who writes to it.
    #[inline]
    pub fn cell(&self, index: u32) -> &C {
        // SAFETY: as in `existing`.
        let cell = unsafe { &*self.chunks.slot_or_install(index, C::zeroed_slice_in) };
        let offset = Chunks::<C, FIRST_CELLS_BITS, A>::locate(index).offset;
        self.note_write(offset, cell);
        cell
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
        touch_pages(&cells);
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

    fn room_of(bytes: usize) -> Room {
        Room { bytes }
    }

    #[test]
    fn a_range_has_one_owner_at_a_time() {
        let (room, other) = (room_of(STEP), room_of(2 * STEP));
        let range = Reserved::new(room);
        let taken = range.take(room).unwrap();
        // Being refused takes it from nobody.
        for _ in 0..2 {
            assert!(range.take(room).is_none());
            assert!(range.take(other).is_none());
        }
        drop(taken);
        assert!(range.take(other).is_none());
        assert!(range.take(room).is_some());
        assert!(range.take(room).is_some());
    }

    #[test]
    fn a_range_of_no_bytes_is_not_reserved() {
        let room = room_of(0);
        let range = Reserved::new(room);
        assert_eq!(range.len, 0);
        let flat = Flat::<u32, Cell<u32>>::new_in(range.take(room).unwrap());
        assert_eq!(flat.len(), 0);
    }

    #[test]
    fn a_flat_vector_keeps_its_elements_where_they_are() {
        let room = room_of(4 * STEP);
        let range = Reserved::new(room);
        let vec = Flat::<Box<u32>, Cell<u32>>::new_in(range.take(room).unwrap());
        let first = vec.get(vec.push(Box::new(0)));
        // More than the first step has room for.
        let many = (STEP / size_of::<Box<u32>>()) as u32 + 5;
        let many = if cfg!(miri) { 300 } else { many };
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
    fn a_flat_vector_drops_and_drains_like_the_others() {
        let alive = AtomicUsize::new(0);
        let room = room_of(STEP);
        let range = Reserved::new(room);
        let mut vec = Flat::<Counted, Cell<u32>>::new_in(range.take(room).unwrap());
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
        // The next owner finds the memory that the last one had.
        let next = Flat::<u64, Cell<u32>>::new_in(range.take(room).unwrap());
        assert_eq!(
            next.committed.load(Ordering::Relaxed) as usize,
            STEP / size_of::<u64>()
        );
    }

    /// 65,537 elements and more take a minute under Miri.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn an_emptied_flat_vector_keeps_the_memory_of_its_first_elements() {
        let room = room_of(64 * STEP);
        let range = Reserved::new(room);
        let mut vec = Flat::<u64, Cell<u32>>::new_in(range.take(room).unwrap());
        for value in 0..3 * KEPT as u64 {
            vec.push(value);
        }
        assert!(vec.committed.load(Ordering::Relaxed) as usize >= 3 * KEPT);
        vec.clear();
        assert_eq!(vec.committed.load(Ordering::Relaxed) as usize, KEPT);
        for value in 0..2 * KEPT as u64 {
            assert_eq!(u64::from(vec.push(value)), value);
        }
        assert_eq!(*vec.get(2 * KEPT as u32 - 1), 2 * KEPT as u64 - 1);
    }

    #[test]
    fn threads_fill_a_flat_vector_that_one_thread_made_room_in() {
        const THREADS: u32 = 4;
        const EACH: u32 = if cfg!(miri) { 300 } else { 5_000 };
        let room = room_of(8 * STEP);
        let range = Reserved::new(room);
        let vec = Flat::<Box<u32>, AtomicU32>::new_in(range.take(room).unwrap());
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

    /// Under Miri a range has memory from the start, and these are of gigabytes.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn a_flat_vector_finds_the_elements_of_the_one_that_it_is_laid_over() {
        let rooms = (Flat::<u64, AtomicU32>::ROOM, Flat::<u64, Cell<u32>>::ROOM);
        let (below, above) = (Reserved::new(rooms.0), Reserved::new(rooms.1));
        let shared = Flat::<u64, AtomicU32>::new_in(below.take(rooms.0).unwrap());
        let mut own = Flat::<u64, Cell<u32>>::new_in(above.take(rooms.1).unwrap());
        assert!(!own.is_laid_over(shared.elements()));
        own.lay_over(shared.elements());
        assert!(own.is_laid_over(shared.elements()));
        for value in 0..MANY {
            shared.push(u64::from(value));
            own.push(u64::from(value) + 1_000_000);
        }
        for number in 0..MANY {
            assert!(std::ptr::eq(own.of_either(number), shared.get(number)));
            assert!(std::ptr::eq(own.of_either(number | OWN), own.get(number)));
            assert_eq!(*own.of_either(number), u64::from(number));
            assert_eq!(*own.of_either(number | OWN), u64::from(number) + 1_000_000);
        }
    }

    #[test]
    #[should_panic]
    fn a_number_of_an_element_that_is_gone_is_refused() {
        let room = room_of(STEP);
        let range = Reserved::new(room);
        let mut own = Flat::<u64, Cell<u32>>::new_in(range.take(room).unwrap());
        own.push(1);
        assert_eq!(*own.of_either(OWN), 1);
        own.clear();
        own.of_either(OWN);
    }

    #[test]
    #[should_panic]
    fn a_number_of_the_vector_below_is_refused_if_there_is_none() {
        let room = room_of(STEP);
        let range = Reserved::new(room);
        let own = Flat::<u64, Cell<u32>>::new_in(range.take(room).unwrap());
        own.push(1);
        own.of_either(0);
    }

    #[test]
    fn threads_replace_the_placeholders_that_they_add() {
        let room = room_of(16 * STEP);
        let range = Reserved::new(room);
        let store = Flat::<u64, AtomicU32>::new_in(range.take(room).unwrap());
        std::thread::scope(|scope| {
            for thread in 0..8 {
                let store = &store;
                scope.spawn(move || {
                    for _ in 0..16 {
                        let mut mine = store.add_placeholders(64, || u64::MAX);
                        let first = mine.first().unwrap();
                        // The last one stays.
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
        assert_eq!(store.len(), 8 * 16 * 64);
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
    fn a_placeholder_is_replaced_in_its_own_vector_only() {
        let room = room_of(STEP);
        let ranges = [Reserved::new(room), Reserved::new(room)];
        let [one, other] = (ranges.each_ref())
            .map(|range| Flat::<u64, AtomicU32>::new_in(range.take(room).unwrap()));
        other.push(1);
        let placeholder = one.add_placeholders(1, || 0).take_first().unwrap();
        other.replace(placeholder, 2);
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
        is_send::<Flat<'static, Box<u32>, AtomicU32>>();
        is_sync::<Flat<'static, Box<u32>, AtomicU32>>();
        is_send::<Flat<'static, Box<u32>, Cell<u32>>>();
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
