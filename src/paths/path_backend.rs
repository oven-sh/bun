//! Where a [`GenericPath`](crate::GenericPath) stores its units.

use core::convert::Infallible;
use core::marker::PhantomData;
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ptr::NonNull;

use bun_core::heap;

use crate::NameTooLong;
use crate::path_buffer_pool::PathBufferPoolT;
use crate::path_unit::PathUnit;

/// Not exported, so no other crate can implement it.
pub trait PathBackend {
    type Unit: PathUnit;
    /// `NameTooLong`, or `Infallible` if the backend can always grow.
    type Error;
    /// `Result<T, NameTooLong>`, or `T` if the backend can always grow.
    type Output<T>;

    /// Whether an edit whose worst case does not fit may run on a heap copy, to see if its result does.
    const RETRY_ON_HEAP: bool = true;

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

// SAFETY: the owning backend has exclusive access, and the shared static NUL is never written.
unsafe impl<U: PathUnit> Send for RawBuf<U> {}
// SAFETY: as above.
unsafe impl<U: PathUnit> Sync for RawBuf<U> {}

impl<U: PathUnit> Default for RawBuf<U> {
    #[inline(always)]
    fn default() -> Self {
        Self {
            ptr: NonNull::from_ref(U::NUL),
            capacity: 0,
        }
    }
}

impl<U: PathUnit> RawBuf<U> {
    #[inline(never)]
    fn from_pool() -> Self {
        Self {
            ptr: heap::into_raw_nn(PathBufferPoolT::<U::Buffer>::get().into_box()).cast(),
            capacity: U::BUFFER_LEN,
        }
    }

    /// SAFETY: `self` came from `from_pool` and is not used again.
    #[inline(always)]
    unsafe fn return_to_pool(self) {
        // SAFETY: the caller's contract. Pool buffers start zeroed and edits only write initialized units.
        PathBufferPoolT::put(unsafe { heap::take(self.ptr.cast::<U::Buffer>().as_ptr()) });
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
    #[inline(never)]
    unsafe fn grow_vec(self, len: usize, capacity: usize) -> Self {
        // SAFETY: the caller's contract. If `reserve` unwinds, the caller still owns the allocation.
        let mut vec = ManuallyDrop::new(unsafe { self.into_vec(len) });
        vec.reserve(capacity - len);
        Self::from_vec(ManuallyDrop::into_inner(vec))
    }

    /// SAFETY: the first `len` units are initialized.
    #[cold]
    #[inline(never)]
    unsafe fn copy_to_vec(self, len: usize, capacity: usize) -> Self {
        let mut vec = Vec::with_capacity(capacity.max(2 * self.capacity));
        // SAFETY: the caller's contract.
        vec.extend_from_slice(unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), len) });
        Self::from_vec(vec)
    }
}

macro_rules! raw_buf_accessors {
    () => {
        #[inline(always)]
        fn as_ptr(&self) -> *const U {
            self.0.ptr.as_ptr()
        }

        #[inline(always)]
        fn as_uninit_slice_mut(&mut self) -> &mut [MaybeUninit<U>] {
            // SAFETY: `capacity` units are allocated, and `self` has exclusive access to them.
            unsafe { core::slice::from_raw_parts_mut(self.0.ptr.as_ptr().cast(), self.0.capacity) }
        }
    };
}

/// A buffer from [`path_buffer_pool`](crate::path_buffer_pool), taken on the first write.
#[derive(Default)]
pub struct PoolBackend<U: PathUnit = u8>(RawBuf<U>);

impl<U: PathUnit> PathBackend for PoolBackend<U> {
    type Unit = U;
    type Error = NameTooLong;
    type Output<T> = Result<T, NameTooLong>;

    #[inline(always)]
    fn output<T>(result: Result<T, NameTooLong>) -> Result<T, NameTooLong> {
        result
    }

    raw_buf_accessors!();

    #[inline(always)]
    unsafe fn grow(&mut self, _: usize, capacity: usize) -> Result<(), NameTooLong> {
        if capacity > U::BUFFER_LEN {
            return Err(NameTooLong);
        }
        // The capacity was 0, so there is nothing to copy or free.
        self.0 = RawBuf::from_pool();
        Ok(())
    }
}

impl<U: PathUnit> Drop for PoolBackend<U> {
    #[inline]
    fn drop(&mut self) {
        if self.0.capacity != 0 {
            // SAFETY: only `from_pool` gives it a capacity.
            unsafe { self.0.return_to_pool() }
        }
    }
}

/// [`PoolBackend`] until the path outgrows the buffer, then a `Vec`.
#[derive(Default)]
pub struct PoolOrVecBackend<U: PathUnit = u8>(RawBuf<U>);

impl<U: PathUnit> PathBackend for PoolOrVecBackend<U> {
    type Unit = U;
    type Error = Infallible;
    type Output<T> = T;

    #[inline(always)]
    fn output<T>(Ok(value): Result<T, Infallible>) -> T {
        value
    }

    raw_buf_accessors!();

    #[inline(always)]
    unsafe fn grow(&mut self, len: usize, capacity: usize) -> Result<(), Infallible> {
        if capacity <= U::BUFFER_LEN {
            // The capacity was 0, so there is nothing to copy or free.
            self.0 = RawBuf::from_pool();
        } else {
            // SAFETY: the caller's contract. Assigning `*self` drops the old buffer.
            *self = Self(unsafe { self.0.copy_to_vec(len, capacity) });
        }
        Ok(())
    }
}

impl<U: PathUnit> Drop for PoolOrVecBackend<U> {
    #[inline]
    fn drop(&mut self) {
        if self.0.capacity == U::BUFFER_LEN {
            // SAFETY: `copy_to_vec` only makes larger capacities, so this came from the pool.
            unsafe { self.0.return_to_pool() }
        } else if self.0.capacity != 0 {
            core::hint::cold_path();
            // SAFETY: came from `copy_to_vec`.
            drop(unsafe { self.0.into_vec(0) });
        }
    }
}

/// A `Vec`. The first allocation is not rounded up.
#[derive(Default)]
pub struct VecBackend<U: PathUnit = u8>(RawBuf<U>);

impl<U: PathUnit> VecBackend<U> {
    /// SAFETY: the first `len` units are initialized.
    #[inline]
    pub(crate) unsafe fn into_vec(self, len: usize) -> Vec<U> {
        let buf = ManuallyDrop::new(self).0;
        if buf.capacity == 0 {
            return Vec::new();
        }
        // SAFETY: only `from_vec` gives it a capacity.
        unsafe { buf.into_vec(len) }
    }
}

impl<U: PathUnit> PathBackend for VecBackend<U> {
    type Unit = U;
    type Error = Infallible;
    type Output<T> = T;

    #[inline(always)]
    fn output<T>(Ok(value): Result<T, Infallible>) -> T {
        value
    }

    raw_buf_accessors!();

    #[inline(always)]
    unsafe fn grow(&mut self, len: usize, capacity: usize) -> Result<(), Infallible> {
        self.0 = if self.0.capacity == 0 {
            RawBuf::from_vec(Vec::with_capacity(capacity))
        } else {
            // SAFETY: the caller's contract, and only `from_vec` gives it a capacity.
            unsafe { self.0.grow_vec(len, capacity) }
        };
        Ok(())
    }
}

impl<U: PathUnit> Drop for VecBackend<U> {
    #[inline]
    fn drop(&mut self) {
        if self.0.capacity != 0 {
            // SAFETY: only `from_vec` gives it a capacity.
            drop(unsafe { self.0.into_vec(0) });
        }
    }
}

/// `N` inline units, NUL included. Never allocates, so `N` has to hold an operation's inputs, not only its result.
pub struct StackBackend<const N: usize, U: PathUnit = u8>([MaybeUninit<U>; N]);

impl<const N: usize, U: PathUnit> Default for StackBackend<N, U> {
    #[inline(always)]
    fn default() -> Self {
        const { assert!(N > 0) };
        let mut units = [MaybeUninit::uninit(); N];
        units[0] = MaybeUninit::new(*U::NUL);
        Self(units)
    }
}

impl<const N: usize, U: PathUnit> PathBackend for StackBackend<N, U> {
    type Unit = U;
    type Error = NameTooLong;
    type Output<T> = Result<T, NameTooLong>;

    const RETRY_ON_HEAP: bool = false;

    #[inline(always)]
    fn output<T>(result: Result<T, NameTooLong>) -> Result<T, NameTooLong> {
        result
    }

    #[inline(always)]
    fn as_ptr(&self) -> *const U {
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

/// A buffer that the caller provides.
pub struct SliceBackend<'a, U: PathUnit = u8>(RawBuf<U>, PhantomData<&'a mut [U]>);

impl<'a, U: PathUnit> SliceBackend<'a, U> {
    #[inline]
    pub(crate) fn new(buffer: &'a mut [U]) -> Self {
        let Some(first) = buffer.first_mut() else {
            return Self(RawBuf::default(), PhantomData);
        };
        *first = *U::NUL;
        let buf = RawBuf {
            capacity: buffer.len(),
            ptr: NonNull::from_mut(buffer).cast(),
        };
        Self(buf, PhantomData)
    }
}

impl<U: PathUnit> PathBackend for SliceBackend<'_, U> {
    type Unit = U;
    type Error = NameTooLong;
    type Output<T> = Result<T, NameTooLong>;

    #[inline(always)]
    fn output<T>(result: Result<T, NameTooLong>) -> Result<T, NameTooLong> {
        result
    }

    raw_buf_accessors!();

    #[inline(always)]
    unsafe fn grow(&mut self, _: usize, _: usize) -> Result<(), NameTooLong> {
        Err(NameTooLong)
    }
}
