//! The memory of an object outside its cell. The pointer is to element 0. In the word before it are the lengths, and
//! before that the out-of-line slots, in descending order. An object without elements has no word for the lengths.

use core::cell::Cell;
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use bun_alloc::AllocError;

use crate::heap::{LARGE_CUTOFF, PRECISE_BIT, barrier, optimal_size};
use crate::{ElementKind, Field, GcFree, Value, Vm};

const WORD: usize = size_of::<u64>();

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub struct Storage(usize);

impl !GcFree for Storage {}
impl !Send for Storage {}

impl Storage {
    pub const NONE: Storage = Storage(0);
    pub const OFFSET_OF_PUBLIC_LENGTH: isize = -8;
    pub const OFFSET_OF_VECTOR_LENGTH: isize = -4;
    pub const MAX_VECTOR_LENGTH: u32 = 1 << 28;
    pub const MIN_VECTOR_LENGTH: u32 = 3;
    pub const EMPTY_ARRAY_VECTOR_LENGTH: u32 = 5;

    #[inline(always)]
    pub const fn from_address(address: usize) -> Storage {
        Storage(address)
    }

    #[inline(always)]
    pub const fn address(self) -> usize {
        self.0
    }

    #[inline(always)]
    pub const fn is_none(self) -> bool {
        self.0 == 0
    }

    /// `vector_length` is `None` for an object without elements.
    #[inline(always)]
    pub const fn size(capacity: usize, vector_length: Option<u32>) -> usize {
        (capacity
            + match vector_length {
                Some(length) => length as usize + 1,
                None => 0,
            })
            * WORD
    }

    /// What to allocate at least for that many elements.
    #[inline(always)]
    pub fn min_vector_length(length: u32) -> u32 {
        match length {
            0 => Self::EMPTY_ARRAY_VECTOR_LENGTH,
            _ => length.max(Self::MIN_VECTOR_LENGTH),
        }
    }

    /// At least `length`, and as many more as the allocation has room for anyway.
    #[inline]
    pub fn optimal_vector_length(capacity: usize, length: u32) -> u32 {
        let length = Self::min_vector_length(length);
        let words = optimal_size(Self::size(capacity, Some(length))) / WORD;
        ((words - capacity - 1) as u32).min(Self::MAX_VECTOR_LENGTH)
    }

    #[inline(always)]
    pub const fn from_base(base: usize, capacity: usize) -> Storage {
        Storage(base + (capacity + 1) * WORD)
    }

    /// The address of the lowest slot.
    #[inline(always)]
    pub const fn base(self, capacity: usize) -> usize {
        self.0 - (capacity + 1) * WORD
    }

    /// Nothing is initialized. May collect.
    #[inline(always)]
    pub(crate) fn try_allocate(
        vm: &Vm,
        pre_capacity: usize,
        capacity: usize,
        vector_length: Option<u32>,
    ) -> Result<Storage, AllocError> {
        let size = Self::size(pre_capacity + capacity, vector_length);
        match vm.heap.auxiliary.try_allocate(&vm.heap, size) {
            0 => Err(AllocError),
            base => Ok(Storage::from_base(base, pre_capacity + capacity)),
        }
    }

    /// The same, with `optimal_vector_length`, which it returns too.
    #[inline(always)]
    pub(super) fn try_allocate_optimal(
        vm: &Vm,
        capacity: usize,
        length: u32,
    ) -> Result<(Storage, u32), AllocError> {
        let size = Self::size(capacity, Some(Self::min_vector_length(length)));
        let Some(allocator) = vm.heap.auxiliary.allocator_for(size) else {
            return Ok((Self::try_allocate(vm, 0, capacity, Some(length))?, length));
        };
        let vector_length = (allocator.cell_size() / WORD - capacity - 1) as u32;
        match allocator.try_allocate(&vm.heap) {
            0 => Err(AllocError),
            base => Ok((Storage::from_base(base, capacity), vector_length)),
        }
    }

    /// The slots are empty and the elements are holes. May collect.
    #[inline]
    pub(crate) fn try_create(
        vm: &Vm,
        capacity: usize,
        kind: ElementKind,
        public_length: u32,
        vector_length: u32,
    ) -> Result<Storage, AllocError> {
        let size = Self::size(capacity, Some(vector_length));
        if size > LARGE_CUTOFF && kind.hole() == 0 {
            let base = vm.heap.auxiliary.try_allocate_large_zeroed(&vm.heap, size);
            if base == 0 {
                return Err(AllocError);
            }
            let storage = Storage::from_base(base, capacity);
            // SAFETY: new, and of that size.
            unsafe { storage.set_lengths(public_length, vector_length) };
            return Ok(storage);
        }
        let storage = Self::try_allocate(vm, 0, capacity, Some(vector_length))?;
        // SAFETY: as above.
        unsafe {
            storage.clear_slots(0, capacity);
            storage.set_lengths(public_length, vector_length);
            storage.clear_elements(kind, 0, vector_length);
        }
        Ok(storage)
    }

    /// The new elements are not initialized. `None` if it takes a copy. May collect.
    ///
    /// # Safety
    /// As for `Heap::try_grow_precise`. There is no pre-capacity, and the vector gets longer.
    #[inline]
    pub(super) unsafe fn try_grow(
        self,
        vm: &Vm,
        capacity: usize,
        vector_length: u32,
    ) -> Option<Storage> {
        let (base, size) = (
            self.base(capacity),
            Self::size(capacity, Some(vector_length)),
        );
        if base & PRECISE_BIT == 0 {
            return None;
        }
        // SAFETY: the caller's.
        match unsafe { vm.heap.try_grow_precise(base, size) } {
            0 => None,
            base => Some(Storage::from_base(base, capacity)),
        }
    }

    #[inline(always)]
    fn word(self, index: isize) -> *mut u64 {
        core::ptr::with_exposed_provenance_mut(self.0.wrapping_add_signed(index * WORD as isize))
    }

    #[inline(always)]
    pub(crate) fn elements_ptr(self) -> *mut u64 {
        self.word(0)
    }

    #[inline(always)]
    fn length_at(self, offset: isize) -> *mut u32 {
        core::ptr::with_exposed_provenance_mut(self.0.wrapping_add_signed(offset))
    }

    /// # Safety
    /// The storage is alive and has lengths, as for all that follow and concern elements.
    #[inline(always)]
    pub unsafe fn public_length(self) -> u32 {
        // SAFETY: the caller's. Only this thread writes it.
        unsafe { *self.length_at(Self::OFFSET_OF_PUBLIC_LENGTH) }
    }

    #[inline(always)]
    pub(crate) unsafe fn public_length_concurrently(self) -> u32 {
        // SAFETY: the caller's.
        unsafe { AtomicU32::from_ptr(self.length_at(Self::OFFSET_OF_PUBLIC_LENGTH)) }
            .load(Ordering::Relaxed)
    }

    /// # Safety
    /// As above.
    #[inline(always)]
    pub unsafe fn vector_length(self) -> u32 {
        // SAFETY: the caller's.
        unsafe { *self.length_at(Self::OFFSET_OF_VECTOR_LENGTH) }
    }

    /// # Safety
    /// At most the vector length if the elements are dense. Those from the public length on are holes.
    #[inline(always)]
    pub unsafe fn set_public_length(self, length: u32) {
        // SAFETY: the caller's.
        unsafe { AtomicU32::from_ptr(self.length_at(Self::OFFSET_OF_PUBLIC_LENGTH)) }
            .store(length, Ordering::Relaxed);
    }

    #[inline(always)]
    pub(crate) unsafe fn set_lengths(self, public_length: u32, vector_length: u32) {
        let lengths = u64::from(vector_length) << 32 | u64::from(public_length);
        // SAFETY: the caller's.
        unsafe { AtomicU64::from_ptr(self.word(-1)) }.store(lengths, Ordering::Relaxed);
    }

    /// # Safety
    /// Below the vector length, and the elements are values.
    #[inline(always)]
    pub unsafe fn value_at<'a>(self, index: u32) -> &'a Field<Option<Value>> {
        // SAFETY: the caller's.
        unsafe { &*self.word(index as isize).cast() }
    }

    /// # Safety
    /// Below the vector length, and the elements are doubles.
    #[inline(always)]
    pub unsafe fn double_at<'a>(self, index: u32) -> &'a Cell<f64> {
        // SAFETY: the caller's.
        unsafe { &*self.word(index as isize).cast() }
    }

    #[inline(always)]
    pub(crate) unsafe fn values<'a>(self, length: u32) -> &'a [Field<Option<Value>>] {
        // SAFETY: the caller's.
        unsafe { core::slice::from_raw_parts(self.word(0).cast(), length as usize) }
    }

    /// Of a storage whose elements nothing else looks at.
    #[inline(always)]
    pub(super) unsafe fn uninitialized_elements<'a>(
        self,
        from: u32,
        to: u32,
    ) -> &'a mut [MaybeUninit<u64>] {
        let (first, count) = (self.word(from as isize), (to - from) as usize);
        // SAFETY: the caller's.
        unsafe { core::slice::from_raw_parts_mut(first.cast(), count) }
    }

    /// The first `count` out-of-line slots, the last one first.
    #[inline(always)]
    pub(crate) unsafe fn slots<'a>(self, count: usize) -> &'a [Field<Option<Value>>] {
        // SAFETY: the caller's.
        unsafe { core::slice::from_raw_parts(self.word(-1 - count as isize).cast(), count) }
    }

    #[inline(always)]
    pub(crate) unsafe fn clear_slots(self, from: usize, to: usize) {
        // SAFETY: the caller's.
        unsafe { barrier::fill_words(self.word(-1 - to as isize), to - from, 0) }
    }

    #[inline(always)]
    pub(crate) unsafe fn clear_elements(self, kind: ElementKind, from: u32, to: u32) {
        let (first, count) = (self.word(from as isize), (to - from) as usize);
        // SAFETY: the caller's.
        unsafe { barrier::fill_words(first, count, kind.hole()) }
    }

    #[inline(always)]
    pub(crate) unsafe fn move_elements(self, from: u32, to: u32, count: u32) {
        let (source, target) = (self.word(from as isize), self.word(to as isize));
        // SAFETY: the caller's.
        unsafe { barrier::move_words(source, target, count as usize) }
    }

    /// Into a storage that nothing refers to yet.
    #[inline(always)]
    pub(crate) unsafe fn copy_words_to(self, target: Storage, first: isize, count: usize) {
        // SAFETY: the caller's.
        unsafe { core::ptr::copy_nonoverlapping(self.word(first), target.word(first), count) }
    }

    /// The same, to another index.
    #[inline(always)]
    pub(super) unsafe fn copy_elements_to(self, from: u32, target: Storage, to: u32, count: u32) {
        let (source, target) = (self.word(from as isize), target.word(to as isize));
        // SAFETY: the caller's.
        unsafe { core::ptr::copy_nonoverlapping(source, target, count as usize) }
    }

    /// The count is in the last of the unused words.
    #[inline(always)]
    pub(crate) unsafe fn pre_capacity(self, capacity: usize) -> usize {
        // SAFETY: the caller's.
        unsafe { AtomicU64::from_ptr(self.word(-2 - capacity as isize)) }.load(Ordering::Relaxed)
            as usize
    }

    #[inline(always)]
    pub(crate) unsafe fn set_pre_capacity(self, capacity: usize, words: usize) {
        // SAFETY: the caller's.
        unsafe { AtomicU64::from_ptr(self.word(-2 - capacity as isize)) }
            .store(words as u64, Ordering::Relaxed);
    }

    /// Moves the slots and the lengths by `words`, and returns the storage that starts there.
    #[inline]
    pub(crate) unsafe fn shift_header(self, capacity: usize, words: isize) -> Storage {
        let first = -1 - capacity as isize;
        // SAFETY: the caller's.
        unsafe { barrier::move_words(self.word(first), self.word(first + words), capacity + 1) };
        Storage(self.word(words).addr())
    }
}
