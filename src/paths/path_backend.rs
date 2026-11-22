//! Where a path stores its units.

use core::convert::Infallible;
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ptr::NonNull;

use crate::NameTooLong;
use crate::path_unit::PathUnit;

pub trait PathBackend: Default {
    type Unit: PathUnit;
    /// `NameTooLong`, or `Infallible` if the backend can always grow.
    type Error;
    /// `Result<T, NameTooLong>`, or `T` if the backend can always grow.
    type Output<T>;

    fn output<T>(result: Result<T, Self::Error>) -> Self::Output<T>;

    /// Points to a static NUL while there is no buffer.
    fn as_ptr(&self) -> *const Self::Unit;

    /// The whole buffer, NUL slot included.
    fn as_uninit_slice_mut(&mut self) -> &mut [MaybeUninit<Self::Unit>];

    /// SAFETY: the first `len` units are initialized and `capacity` is more than there is. Only those units are preserved.
    unsafe fn grow(&mut self, len: usize, capacity: usize) -> Result<(), Self::Error>;
}

/// Passed by value to out-of-line helpers, so that a path can stay in registers.
#[derive(Clone, Copy)]
struct RawBuf<U> {
    ptr: NonNull<U>,
    capacity: usize,
}

impl<U: PathUnit> RawBuf<U> {
    /// Leaves room for what is pushed later.
    #[inline(never)]
    fn with_room_for(capacity: usize) -> Self {
        const MIN_SPARE: usize = 64;
        // Nearly every path fits. mimalloc takes no longer for this than for less.
        const STEP: usize = 256;
        let capacity = (capacity + MIN_SPARE).next_multiple_of(STEP);
        Self::from_vec(Vec::with_capacity(capacity))
    }

    #[inline(always)]
    fn from_vec(vec: Vec<U>) -> Self {
        let (ptr, _, capacity) = vec.into_parts();
        Self { ptr, capacity }
    }

    /// SAFETY: `self` came from `from_vec`, has `len` initialized units and is not used again.
    #[inline(always)]
    unsafe fn into_vec(self, len: usize) -> Vec<U> {
        // SAFETY: the caller's contract.
        unsafe { Vec::from_parts(self.ptr, len, self.capacity) }
    }

    /// SAFETY: as for `into_vec`.
    #[cold]
    #[inline(never)]
    unsafe fn grow(self, len: usize, capacity: usize) -> Self {
        // SAFETY: the caller's contract. If `reserve` unwinds, the caller still owns the allocation.
        let mut vec = ManuallyDrop::new(unsafe { self.into_vec(len) });
        vec.reserve(capacity - len);
        Self::from_vec(ManuallyDrop::into_inner(vec))
    }
}

/// Allocates on the first write.
pub struct HeapBackend<U: PathUnit = u8>(RawBuf<U>);

// SAFETY: it has exclusive access to its allocation, and the shared static NUL is never written.
unsafe impl<U: PathUnit> Send for HeapBackend<U> {}
// SAFETY: as above.
unsafe impl<U: PathUnit> Sync for HeapBackend<U> {}

impl<U: PathUnit> Default for HeapBackend<U> {
    #[inline(always)]
    fn default() -> Self {
        Self(RawBuf {
            ptr: NonNull::from_ref(U::NUL),
            capacity: 0,
        })
    }
}

impl<U: PathUnit> PathBackend for HeapBackend<U> {
    type Unit = U;
    type Error = Infallible;
    type Output<T> = T;

    #[inline(always)]
    fn output<T>(Ok(value): Result<T, Infallible>) -> T {
        value
    }

    #[inline(always)]
    fn as_ptr(&self) -> *const U {
        // A path still live at `exit` never drops. LeakSanitizer finds it only if it keeps a stack slot.
        if bun_core::env::ENABLE_ASAN {
            core::hint::black_box(self);
        }
        self.0.ptr.as_ptr()
    }

    #[inline(always)]
    fn as_uninit_slice_mut(&mut self) -> &mut [MaybeUninit<U>] {
        // SAFETY: `capacity` units are allocated, and `self` has exclusive access to them.
        unsafe { core::slice::from_raw_parts_mut(self.0.ptr.as_ptr().cast(), self.0.capacity) }
    }

    #[inline(always)]
    unsafe fn grow(&mut self, len: usize, capacity: usize) -> Result<(), Infallible> {
        self.0 = if self.0.capacity == 0 {
            RawBuf::with_room_for(capacity)
        } else {
            // SAFETY: the caller's contract, and only `from_vec` gives it a capacity.
            unsafe { self.0.grow(len, capacity) }
        };
        Ok(())
    }
}

impl<U: PathUnit> Drop for HeapBackend<U> {
    #[inline]
    fn drop(&mut self) {
        if self.0.capacity != 0 {
            // SAFETY: only `from_vec` gives it a capacity.
            drop(unsafe { self.0.into_vec(0) });
        }
    }
}

/// `N` inline units, NUL included.
pub struct StackBackend<const N: usize, U: PathUnit = u8>([MaybeUninit<U>; N]);

impl<const N: usize, U: PathUnit> Default for StackBackend<N, U> {
    #[inline(always)]
    fn default() -> Self {
        let mut units = [MaybeUninit::uninit(); N];
        units[0] = MaybeUninit::new(*U::NUL);
        Self(units)
    }
}

impl<const N: usize, U: PathUnit> PathBackend for StackBackend<N, U> {
    type Unit = U;
    type Error = NameTooLong;
    type Output<T> = Result<T, NameTooLong>;

    #[inline(always)]
    fn output<T>(result: Result<T, NameTooLong>) -> Result<T, NameTooLong> {
        result
    }

    #[inline(always)]
    fn as_ptr(&self) -> *const U {
        const { assert!(N > 0) };
        self.0.as_ptr().cast()
    }

    #[inline(always)]
    fn as_uninit_slice_mut(&mut self) -> &mut [MaybeUninit<U>] {
        &mut self.0
    }

    #[inline(always)]
    unsafe fn grow(&mut self, _: usize, _: usize) -> Result<(), NameTooLong> {
        Err(NameTooLong)
    }
}
