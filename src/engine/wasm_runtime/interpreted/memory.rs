//! Linear memories.

use core::cell::Cell;
use core::ptr;
use core::sync::atomic::{AtomicU8, AtomicU16, AtomicU32, AtomicU64, Ordering};

use bun_engine_asm::{AtomicOp, Width};
use bun_engine_wasm_compiler::abi::{MemoryView, PAGE_SIZE_LOG2, Trap};
use bun_engine_wasm_format::{DataIndex, MemoryIndex};

use super::Context;
use crate::operations::memory as operations;
use crate::outcome::Failure;

/// # Safety
/// The view of an instance that lives for `'a`.
#[inline]
pub(super) unsafe fn length_in<'a>(view: *const MemoryView) -> &'a AtomicU64 {
    // SAFETY: the caller's. The instance keeps the memory, and only this thread writes to the view.
    unsafe {
        AtomicU64::from_ptr(match (*view).shared_length {
            0 => (&raw const (*view).length).cast_mut(),
            address => ptr::with_exposed_provenance_mut(address),
        })
    }
}

/// Where a memory is, and how far it reaches at least.
#[derive(Clone, Copy)]
pub struct View {
    base: *mut u8,
    length: u64,
}

mod sealed {
    pub trait Sealed {}
}

/// An integer that the processor accesses at once if it is aligned.
pub trait Scalar: Copy + sealed::Sealed {
    #[doc(hidden)]
    unsafe fn load(place: *mut u8, ordering: Ordering) -> Self;
    #[doc(hidden)]
    unsafe fn store(self, place: *mut u8, ordering: Ordering);
    #[doc(hidden)]
    unsafe fn update(self, place: *mut u8, op: AtomicOp) -> Self;
    #[doc(hidden)]
    unsafe fn compare_exchange(self, place: *mut u8, expected: Self) -> Self;

    fn from_low_bits(bits: u64) -> Self;
    fn to_bits(self) -> u64;
}

macro_rules! scalars {
    ($($type:ty => $atomic:ty),*) => {$(
        impl sealed::Sealed for $type {}

        impl Scalar for $type {
            #[inline(always)]
            unsafe fn load(place: *mut u8, ordering: Ordering) -> Self {
                // SAFETY: the caller has checked the bounds and the alignment.
                unsafe { <$atomic>::from_ptr(place.cast()) }.load(ordering)
            }

            #[inline(always)]
            unsafe fn store(self, place: *mut u8, ordering: Ordering) {
                // SAFETY: as above.
                unsafe { <$atomic>::from_ptr(place.cast()) }.store(self, ordering);
            }

            #[inline(always)]
            unsafe fn update(self, place: *mut u8, op: AtomicOp) -> Self {
                // SAFETY: as above.
                let place = unsafe { <$atomic>::from_ptr(place.cast()) };
                match op {
                    AtomicOp::Add => place.fetch_add(self, Ordering::SeqCst),
                    AtomicOp::Sub => place.fetch_sub(self, Ordering::SeqCst),
                    AtomicOp::And => place.fetch_and(self, Ordering::SeqCst),
                    AtomicOp::Or => place.fetch_or(self, Ordering::SeqCst),
                    AtomicOp::Xor => place.fetch_xor(self, Ordering::SeqCst),
                    AtomicOp::Exchange => place.swap(self, Ordering::SeqCst),
                }
            }

            #[inline(always)]
            unsafe fn compare_exchange(self, place: *mut u8, expected: Self) -> Self {
                // SAFETY: as above.
                let place = unsafe { <$atomic>::from_ptr(place.cast()) };
                let old = place.compare_exchange(expected, self, Ordering::SeqCst, Ordering::SeqCst);
                old.unwrap_or_else(|old| old)
            }

            #[inline(always)]
            fn from_low_bits(bits: u64) -> Self {
                bits as Self
            }

            #[inline(always)]
            fn to_bits(self) -> u64 {
                self.into()
            }
        }
    )*};
}

scalars!(u8 => AtomicU8, u16 => AtomicU16, u32 => AtomicU32, u64 => AtomicU64);

impl View {
    #[inline(always)]
    pub fn reaches_further_than(self, other: Self) -> bool {
        self.length > other.length
    }

    #[inline(always)]
    fn place(self, start: u64, size: usize) -> Option<*mut u8> {
        let is_in_bounds = start.checked_add(size as u64)? <= self.length;
        is_in_bounds.then(|| self.base.wrapping_add(start as usize))
    }

    /// Of a memory that is not shared.
    #[inline(always)]
    pub fn bytes<const N: usize>(&self, start: u64) -> Option<&Cell<[u8; N]>> {
        // SAFETY: in bounds, and only this thread accesses them.
        self.place(start, N).map(|place| unsafe { &*place.cast() })
    }

    /// From a memory that is shared.
    #[inline(always)]
    pub fn load_shared<T: Scalar>(self, start: u64) -> Option<T> {
        let place = self.place(start, size_of::<T>())?;
        // SAFETY: in bounds.
        Some(unsafe {
            if place.addr().is_multiple_of(size_of::<T>()) {
                T::load(place, Ordering::Relaxed)
            } else {
                let byte = |index| u8::load(place.add(index), Ordering::Relaxed).to_bits();
                let bytes = (0..size_of::<T>()).map(|index| byte(index) << (8 * index));
                T::from_low_bits(bytes.fold(0, |all, it| all | it))
            }
        })
    }

    #[inline(always)]
    pub fn store_shared<T: Scalar>(self, start: u64, value: T) -> Option<()> {
        let place = self.place(start, size_of::<T>())?;
        // SAFETY: in bounds.
        unsafe {
            if place.addr().is_multiple_of(size_of::<T>()) {
                value.store(place, Ordering::Relaxed);
            } else {
                for index in 0..size_of::<T>() {
                    let byte = (value.to_bits() >> (8 * index)) as u8;
                    byte.store(place.add(index), Ordering::Relaxed);
                }
            }
        }
        Some(())
    }

    #[inline(always)]
    fn aligned_place<T>(self, start: u64) -> Result<*mut u8, Trap> {
        let place = (self.place(start, size_of::<T>())).ok_or(Trap::MemoryOutOfBounds)?;
        match place.addr().is_multiple_of(size_of::<T>()) {
            true => Ok(place),
            false => Err(Trap::UnalignedAtomic),
        }
    }

    #[inline(always)]
    pub fn atomic_load<T: Scalar>(self, start: u64) -> Result<T, Trap> {
        // SAFETY: checked.
        Ok(unsafe { T::load(self.aligned_place::<T>(start)?, Ordering::SeqCst) })
    }

    #[inline(always)]
    pub fn atomic_store<T: Scalar>(self, start: u64, value: T) -> Result<(), Trap> {
        // SAFETY: checked.
        unsafe { value.store(self.aligned_place::<T>(start)?, Ordering::SeqCst) };
        Ok(())
    }

    /// Gives the value before.
    #[inline(always)]
    pub fn atomic_update<T: Scalar>(self, start: u64, op: AtomicOp, value: T) -> Result<T, Trap> {
        // SAFETY: checked.
        Ok(unsafe { value.update(self.aligned_place::<T>(start)?, op) })
    }

    /// The same.
    #[inline(always)]
    pub fn atomic_compare_exchange<T: Scalar>(
        self,
        start: u64,
        expected: T,
        replacement: T,
    ) -> Result<T, Trap> {
        // SAFETY: checked.
        Ok(unsafe { replacement.compare_exchange(self.aligned_place::<T>(start)?, expected) })
    }
}

impl Context<'_> {
    /// One without bytes if there is none.
    #[inline(always)]
    pub fn first_memory(&self) -> View {
        View {
            // SAFETY: in the cell.
            base: ptr::with_exposed_provenance_mut(unsafe { (*self.first_memory).base }),
            length: self.length_of_first_memory.load(Ordering::Relaxed),
        }
    }

    /// With the offset of the view. Also tells whether it is shared.
    #[inline(always)]
    pub fn memory(&self, offset: u32) -> (View, bool) {
        let view = self.cell.field::<MemoryView>(offset as i32);
        // SAFETY: from the layout.
        let (base, length, shared) =
            unsafe { ((*view).base, length_in(view), (*view).shared_length) };
        let view = View {
            base: ptr::with_exposed_provenance_mut(base),
            length: length.load(Ordering::Relaxed),
        };
        (view, shared != 0)
    }

    /// The same. In pages.
    #[inline]
    pub fn memory_size(&self, offset: u32) -> u64 {
        // SAFETY: from the layout.
        let length = unsafe { length_in(self.cell.field(offset as i32)) };
        length.load(Ordering::SeqCst) >> PAGE_SIZE_LOG2
    }

    pub fn memory_grow(&self, memory: MemoryIndex, pages: u64) -> Result<u64, Failure> {
        // SAFETY: validated, as in all that follow.
        unsafe { operations::grow(self.instance, memory, pages) }.into_result()
    }

    #[inline]
    pub fn memory_fill(&self, memory: MemoryIndex, operands: [u64; 3]) -> Result<u64, Failure> {
        let [dst, value, count] = operands;
        // SAFETY: as above.
        unsafe { operations::fill(self.instance, memory, dst, value, count) }.into_result()
    }

    #[inline]
    pub fn memory_copy(
        &self,
        to: MemoryIndex,
        from: MemoryIndex,
        [dst, src, count]: [u64; 3],
    ) -> Result<u64, Failure> {
        // SAFETY: as above.
        unsafe { operations::copy(self.instance, to, from, dst, src, count) }.into_result()
    }

    pub fn memory_init(
        &self,
        memory: MemoryIndex,
        data: DataIndex,
        [dst, src, count]: [u64; 3],
    ) -> Result<u64, Failure> {
        // SAFETY: as above.
        unsafe { operations::init(self.instance, memory, data, dst, src, count) }.into_result()
    }

    pub fn data_drop(&self, data: DataIndex) {
        self.instance.drop_data(data);
    }

    pub fn atomic_wait(
        &self,
        width: Width,
        memory: MemoryIndex,
        offset: u64,
        [address, expected, timeout]: [u64; 3],
    ) -> Result<u64, Failure> {
        let wait = match width {
            Width::W32 => operations::wait32,
            Width::W64 => operations::wait64,
        };
        // SAFETY: as above.
        unsafe {
            wait(
                self.instance,
                memory,
                offset,
                address,
                expected,
                timeout as i64,
            )
        }
        .into_result()
    }

    pub fn atomic_notify(
        &self,
        memory: MemoryIndex,
        offset: u64,
        [address, count]: [u64; 2],
    ) -> Result<u64, Failure> {
        // SAFETY: as above.
        unsafe { operations::notify(self.instance, memory, offset, address, count) }.into_result()
    }
}
