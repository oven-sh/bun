//! Where a [`PathIn`](crate::PathIn) keeps its units.

use core::convert::Infallible;
use core::marker::PhantomData;
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ptr::NonNull;

use bun_core::heap;

use crate::PathUnit;
use crate::path_buffer_pool::PathBufferPoolT;
use crate::path_unit::sealed::Kernels;

/// The path does not fit in a backend of a fixed size. It is what it was before the call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NameTooLong;

impl From<NameTooLong> for bun_errno::SystemErrno {
    #[inline]
    fn from(_: NameTooLong) -> Self {
        Self::ENAMETOOLONG
    }
}

/// [`NameTooLong`] or [`Infallible`].
pub trait Overflow: Sized {
    type Out<T>;
    fn out<T>(result: Result<T, Self>) -> Self::Out<T>;
}

impl Overflow for NameTooLong {
    type Out<T> = Result<T, NameTooLong>;
    #[inline(always)]
    fn out<T>(result: Result<T, Self>) -> Result<T, Self> {
        result
    }
}

impl Overflow for Infallible {
    type Out<T> = T;
    #[inline(always)]
    fn out<T>(result: Result<T, Self>) -> T {
        let Ok(value) = result;
        value
    }
}

/// What an operation that can lengthen a path returns: `T` if `B` grows, else `Result<T, NameTooLong>`.
pub type Out<B, T> = <<B as sealed::Storage>::Error as Overflow>::Out<T>;

pub trait Backend: sealed::Storage {}
impl<B: sealed::Storage> Backend for B {}

/// The backends that do not grow.
pub trait Fixed: Backend<Error = NameTooLong> {}
impl<B: Backend<Error = NameTooLong>> Fixed for B {}

/// The backends that are a pointer, which makes a path cheap to return.
pub trait Boxed: Backend + sealed::Empty {}
impl<B: Backend + sealed::Empty> Boxed for B {}

/// The backends that start with a buffer of the pool.
pub trait Pooled: Boxed + sealed::Adopt {}
impl<B: Boxed + sealed::Adopt> Pooled for B {}

pub(crate) mod sealed {
    use super::*;

    pub trait Storage {
        type Unit: PathUnit;
        type Error: Overflow;

        /// Whether an edit that there is no room for is made on the heap, to see if its result fits.
        const RETRIES_ON_HEAP: bool = true;

        fn as_ptr(&self) -> *const Self::Unit;

        /// Includes the place of the NUL. Without any, `as_ptr` is that of a static NUL.
        fn capacity(&self) -> usize;

        fn all(&mut self) -> &mut [MaybeUninit<Self::Unit>];

        /// SAFETY: `len` units are initialized, and only they stay. `capacity` is more than there is.
        unsafe fn grow(&mut self, len: usize, capacity: usize) -> Result<(), Self::Error>;
    }

    pub trait Empty {
        const EMPTY: Self;
    }

    pub trait Adopt: Storage {
        /// SAFETY: `self` has no capacity.
        unsafe fn adopt(&mut self, buffer: Box<<Self::Unit as Kernels>::Buffer>);
    }
}

/// What is not inlined takes and returns this by value, so that a path can stay in registers.
#[derive(Clone, Copy)]
struct Block<U> {
    units: NonNull<U>,
    capacity: usize,
}

// SAFETY: the backend that has a `Block` is the only way to its units, unless they are the static NUL, which nothing writes.
unsafe impl<U: PathUnit> Send for Block<U> {}
// SAFETY: as above.
unsafe impl<U: PathUnit> Sync for Block<U> {}

impl<U: PathUnit> Block<U> {
    const EMPTY: Self = Self {
        units: NonNull::from_ref(U::NUL),
        capacity: 0,
    };

    #[inline(always)]
    fn from_buffer(buffer: Box<U::Buffer>) -> Self {
        Self {
            units: heap::into_raw_nn(buffer).cast(),
            capacity: U::POOLED_LEN,
        }
    }

    #[inline(never)]
    fn from_pool() -> Self {
        Self::from_buffer(PathBufferPoolT::<U::Buffer>::get().into_box())
    }

    /// SAFETY: `self` is of `from_buffer` and is not used again.
    #[inline(always)]
    unsafe fn return_to_pool(self) {
        // SAFETY: the caller's contract. Nothing writes an uninitialized value, so all of it is initialized.
        PathBufferPoolT::put(unsafe { heap::take(self.units.cast::<U::Buffer>().as_ptr()) });
    }

    #[inline(always)]
    fn from_vec(vec: Vec<U>) -> Self {
        let (units, _, capacity) = vec.into_parts();
        Self { units, capacity }
    }

    /// SAFETY: `self` is of `from_vec`, has `len` initialized units and is not used again.
    #[inline(always)]
    unsafe fn into_vec(self, len: usize) -> Vec<U> {
        // SAFETY: the caller's contract.
        unsafe { Vec::from_parts(self.units, len, self.capacity) }
    }

    /// SAFETY: as for `into_vec`.
    #[inline(never)]
    unsafe fn regrown(self, len: usize, capacity: usize) -> Self {
        // SAFETY: the caller's contract. If `reserve` unwinds, the allocation is still the caller's.
        let mut vec = ManuallyDrop::new(unsafe { self.into_vec(len) });
        vec.reserve(capacity - len);
        Self::from_vec(ManuallyDrop::into_inner(vec))
    }

    /// SAFETY: `len` units are initialized.
    #[cold]
    #[inline(never)]
    unsafe fn copied_to_heap(self, len: usize, capacity: usize) -> Self {
        let mut vec = Vec::with_capacity(capacity.max(2 * self.capacity));
        // SAFETY: the caller's contract.
        vec.extend_from_slice(unsafe { core::slice::from_raw_parts(self.units.as_ptr(), len) });
        Self::from_vec(vec)
    }
}

macro_rules! block_storage {
    ($error:ty) => {
        type Unit = U;
        type Error = $error;

        #[inline(always)]
        fn as_ptr(&self) -> *const U {
            self.0.units.as_ptr()
        }
        #[inline(always)]
        fn capacity(&self) -> usize {
            self.0.capacity
        }
        #[inline(always)]
        fn all(&mut self) -> &mut [MaybeUninit<U>] {
            // SAFETY: `capacity` units are allocated, and `self` is the only way to them.
            unsafe {
                core::slice::from_raw_parts_mut(self.0.units.as_ptr().cast(), self.0.capacity)
            }
        }
    };
}

macro_rules! impl_empty {
    ($($backend:ident),*) => {$(
        impl<U: PathUnit> sealed::Empty for $backend<U> {
            const EMPTY: Self = Self(Block::EMPTY);
        }
    )*};
}
impl_empty!(Pool, Spill, Heap);

macro_rules! impl_adopt {
    ($($backend:ident),*) => {$(
        impl<U: PathUnit> sealed::Adopt for $backend<U> {
            #[inline]
            unsafe fn adopt(&mut self, buffer: Box<U::Buffer>) {
                self.0 = Block::from_buffer(buffer);
            }
        }
    )*};
}
impl_adopt!(Pool, Spill);

/// A buffer of [`path_buffer_pool`](crate::path_buffer_pool), taken at the first write.
pub struct Pool<U: PathUnit = u8>(Block<U>);

impl<U: PathUnit> sealed::Storage for Pool<U> {
    block_storage!(NameTooLong);

    #[inline(always)]
    unsafe fn grow(&mut self, _: usize, capacity: usize) -> Result<(), NameTooLong> {
        if capacity > U::POOLED_LEN {
            return Err(NameTooLong);
        }
        self.0 = Block::from_pool();
        Ok(())
    }
}

impl<U: PathUnit> Drop for Pool<U> {
    #[inline]
    fn drop(&mut self) {
        if self.0.capacity != 0 {
            // SAFETY: only `from_buffer` gives it a capacity.
            unsafe { self.0.return_to_pool() }
        }
    }
}

/// [`Pool`], until the path is too long for it and moves to the heap.
pub struct Spill<U: PathUnit = u8>(Block<U>);

impl<U: PathUnit> sealed::Storage for Spill<U> {
    block_storage!(Infallible);

    #[inline(always)]
    unsafe fn grow(&mut self, len: usize, capacity: usize) -> Result<(), Infallible> {
        if capacity <= U::POOLED_LEN {
            self.0 = Block::from_pool();
        } else {
            // SAFETY: the caller's contract.
            *self = Self(unsafe { self.0.copied_to_heap(len, capacity) });
        }
        Ok(())
    }
}

impl<U: PathUnit> Drop for Spill<U> {
    #[inline]
    fn drop(&mut self) {
        if self.0.capacity == U::POOLED_LEN {
            // SAFETY: what is on the heap is longer.
            unsafe { self.0.return_to_pool() }
        } else if self.0.capacity != 0 {
            core::hint::cold_path();
            // SAFETY: of `copied_to_heap`.
            drop(unsafe { self.0.into_vec(0) });
        }
    }
}

/// The allocation of a `Vec`. The first one is as long as what is written to it.
pub struct Heap<U: PathUnit = u8>(Block<U>);

impl<U: PathUnit> Heap<U> {
    /// SAFETY: `len` units are initialized.
    #[inline]
    pub(crate) unsafe fn into_vec(self, len: usize) -> Vec<U> {
        let block = ManuallyDrop::new(self).0;
        if block.capacity == 0 {
            return Vec::new();
        }
        // SAFETY: only `from_vec` gives it a capacity.
        unsafe { block.into_vec(len) }
    }

    /// `vec` ends with the NUL.
    #[inline]
    pub(crate) fn from_vec(vec: Vec<U>) -> Self {
        Self(Block::from_vec(vec))
    }
}

impl<U: PathUnit> sealed::Storage for Heap<U> {
    block_storage!(Infallible);

    #[inline(always)]
    unsafe fn grow(&mut self, len: usize, capacity: usize) -> Result<(), Infallible> {
        self.0 = match self.0.capacity {
            0 => Block::from_vec(Vec::with_capacity(capacity)),
            // SAFETY: the caller's contract, and only `from_vec` gives it a capacity.
            _ => unsafe { self.0.regrown(len, capacity) },
        };
        Ok(())
    }
}

impl<U: PathUnit> Drop for Heap<U> {
    #[inline]
    fn drop(&mut self) {
        if self.0.capacity != 0 {
            // SAFETY: only `from_vec` gives it a capacity.
            drop(unsafe { self.0.into_vec(0) });
        }
    }
}

/// `N` units in the path itself, the NUL among them. They are not zeroed. Nothing is ever allocated, so they have to hold the arguments of an operation and not just its result.
pub struct Stack<const N: usize, U: PathUnit = u8>([MaybeUninit<U>; N]);

impl<const N: usize, U: PathUnit> Stack<N, U> {
    // An associated `const` would be copied to its place, all `N` units of it.
    #[inline(always)]
    pub(crate) const fn new() -> Self {
        const { assert!(N > 0) };
        let mut units = [MaybeUninit::uninit(); N];
        units[0] = MaybeUninit::new(*U::NUL);
        Self(units)
    }
}

impl<const N: usize, U: PathUnit> sealed::Storage for Stack<N, U> {
    type Unit = U;
    type Error = NameTooLong;

    const RETRIES_ON_HEAP: bool = false;

    #[inline(always)]
    fn as_ptr(&self) -> *const U {
        self.0.as_ptr().cast()
    }
    #[inline(always)]
    fn capacity(&self) -> usize {
        N
    }
    #[inline(always)]
    fn all(&mut self) -> &mut [MaybeUninit<U>] {
        &mut self.0
    }
    #[inline(always)]
    unsafe fn grow(&mut self, _: usize, _: usize) -> Result<(), NameTooLong> {
        Err(NameTooLong)
    }
}

/// Somebody else's buffer.
pub struct Borrowed<'a, U: PathUnit = u8>(Block<U>, PhantomData<&'a mut [U]>);

impl<'a, U: PathUnit> Borrowed<'a, U> {
    #[inline]
    pub(crate) fn new(buffer: &'a mut [U]) -> Self {
        let block = match buffer.first_mut() {
            Some(first) => {
                *first = *U::NUL;
                Block {
                    capacity: buffer.len(),
                    units: NonNull::from_mut(buffer).cast(),
                }
            }
            None => Block::EMPTY,
        };
        Self(block, PhantomData)
    }
}

impl<U: PathUnit> sealed::Storage for Borrowed<'_, U> {
    block_storage!(NameTooLong);

    #[inline(always)]
    unsafe fn grow(&mut self, _: usize, _: usize) -> Result<(), NameTooLong> {
        Err(NameTooLong)
    }
}
