//! A structure with an array and a length, that can be used as a slice.
//!
//! Useful to pass around small arrays whose exact size is only known at
//! runtime, but whose maximum size is known at compile time, without requiring
//! an `Allocator`.
//!
//! ```ignore
//! let actual_size = 32;
//! let mut a = BoundedArray::<u8, 64>::init(actual_size)?;
//! let slice = a.slice(); // a slice of the 64-byte array
//! let a_clone = a.clone(); // creates a copy - the structure doesn't use any internal pointers
//! ```

use core::mem::MaybeUninit;

/// `error{Overflow}`
#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Copy, Clone, Eq, PartialEq)]
pub enum OverflowError {
    #[error("Overflow")]
    Overflow,
}

/// A structure with an array and a length, that can be used as a slice.
///
/// Useful to pass around small arrays whose exact size is only known at
/// runtime, but whose maximum size is known at compile time, without requiring
/// an `Allocator`.
pub type BoundedArray<T, const BUFFER_CAPACITY: usize> = BoundedArrayAligned<T, BUFFER_CAPACITY>;
// The natural alignment of `[T; N]` is already `align_of::<T>()`, so the alias is
// transparent. The explicit `alignment` const-param is dropped (see below).

/// A structure with an array, length and alignment, that can be used as a
/// slice.
///
/// Useful to pass around small explicitly-aligned arrays whose exact size is
/// only known at runtime, but whose maximum size is known at compile time, without
/// requiring an `Allocator`.
// Stable Rust cannot express
// `#[repr(align(N))]` with a const-generic `N`. All in-tree callers use the
// default natural alignment via `BoundedArray`; a caller needing
// over-alignment would require a wrapper type per alignment.
pub struct BoundedArrayAligned<T, const BUFFER_CAPACITY: usize> {
    buffer: [MaybeUninit<T>; BUFFER_CAPACITY],
    // Stable Rust const generics cannot pick a smaller integer type
    // (the smallest byte-aligned uint that fits `0..=BUFFER_CAPACITY`)
    // from a const value without `generic_const_exprs`, so `usize` is used.
    // PERF: could be a size-optimized integer field — profile if it shows up on a hot path
    len: usize,
}

// See the `len` field note above; collapsed to `usize`.
type Length = usize;

impl<T, const BUFFER_CAPACITY: usize> Default for BoundedArrayAligned<T, BUFFER_CAPACITY> {
    fn default() -> Self {
        Self {
            buffer: [const { MaybeUninit::uninit() }; BUFFER_CAPACITY],
            len: 0,
        }
    }
}

impl<T, const BUFFER_CAPACITY: usize> Drop for BoundedArrayAligned<T, BUFFER_CAPACITY> {
    fn drop(&mut self) {
        self.clear();
    }
}

impl<T, const BUFFER_CAPACITY: usize> BoundedArrayAligned<T, BUFFER_CAPACITY> {
    /// Set the actual length of the slice.
    /// Returns error.Overflow if it exceeds the length of the backing array.
    fn init(len: usize) -> Result<Self, OverflowError> {
        if len > BUFFER_CAPACITY {
            return Err(OverflowError::Overflow);
        }
        let mut s = Self::default();
        s.len = Length::try_from(len).expect("int cast");
        Ok(s)
    }

    /// View the internal array as a slice whose size was previously set.
    // Mut/const access is split into `slice(&mut self)` and `const_slice(&self)`.
    pub fn slice(&mut self) -> &mut [T] {
        let len = self.len;
        // SAFETY: elements `[0..len]` are initialized by the public API's invariants.
        unsafe { &mut *(&raw mut self.buffer[0..len] as *mut [T]) }
    }

    /// View the internal array as a constant slice whose size was previously set.
    pub fn const_slice(&self) -> &[T] {
        let len = self.len;
        // SAFETY: elements `[0..len]` are initialized by the public API's invariants.
        unsafe { &*(&raw const self.buffer[0..len] as *const [T]) }
    }

    /// Adjust the slice's length to `len`.
    /// Does not initialize added items if any.
    pub fn resize(&mut self, len: usize) -> Result<(), OverflowError> {
        if len > BUFFER_CAPACITY {
            return Err(OverflowError::Overflow);
        }
        self.len = len;
        Ok(())
    }

    /// Remove all elements from the slice.
    pub fn clear(&mut self) {
        let len = self.len;
        self.len = 0;
        // SAFETY: `[0..len]` is initialized; `len` reset first so a panicking Drop can't double-drop.
        unsafe {
            core::ptr::drop_in_place(&raw mut self.buffer[0..len] as *mut [T]);
        }
    }

    /// Copy the content of an existing slice.
    pub fn from_slice(m: &[T]) -> Result<Self, OverflowError>
    where
        T: Copy,
    {
        let mut list = Self::init(m.len())?;
        list.slice().copy_from_slice(m);
        Ok(list)
    }
    // If a non-`Copy` caller
    // appears, add a `from_slice_clone` or use `ptr::copy_nonoverlapping`.

    /// Return the element at index `i` of the slice.
    pub fn get(&self, i: usize) -> T
    where
        T: Copy,
    {
        self.const_slice()[i]
    }

    /// Set the value of the element at index `i` of the slice.
    pub fn set(&mut self, i: usize, item: T) {
        self.slice()[i] = item;
    }

    /// Check that the slice can hold at least `additional_count` items.
    fn ensure_unused_capacity(&self, additional_count: usize) -> Result<(), OverflowError> {
        if self.len + additional_count > BUFFER_CAPACITY {
            return Err(OverflowError::Overflow);
        }
        Ok(())
    }

    /// Remove and return the last element from the slice, or return `None` if the slice is empty.
    pub fn pop(&mut self) -> Option<T> {
        if self.len == 0 {
            return None;
        }
        let i = self.len - 1;
        self.len -= 1;
        // SAFETY: index `i` was within `[0..old_len)` and is now logically removed; we move it out.
        Some(unsafe { self.buffer[i].assume_init_read() })
    }

    /// Return a slice of only the extra capacity after items.
    /// This can be useful for writing directly into it.
    /// Note that such an operation must be followed up with a
    /// call to `resize()`
    pub fn unused_capacity_slice(&mut self) -> &mut [MaybeUninit<T>] {
        &mut self.buffer[self.len..]
    }
    // Returns `&mut [MaybeUninit<T>]` instead of `&mut [T]` because the region is
    // uninitialized by definition.

    /// Extend the slice by 1 element.
    pub fn append(&mut self, item: T) -> Result<(), OverflowError> {
        // A plain `*slot = item` write would drop the (uninitialized) prior occupant
        // of the slot first — UB that manifests as a bad free when `T` owns heap memory.
        self.ensure_unused_capacity(1)?;
        self.append_assume_capacity(item);
        Ok(())
    }

    /// Extend the slice by 1 element, asserting the capacity is already
    /// enough to store the new item.
    pub fn append_assume_capacity(&mut self, item: T) {
        debug_assert!(self.len < BUFFER_CAPACITY);
        let i = self.len;
        self.len += 1;
        // Write into the `MaybeUninit` slot directly so no drop runs on the previous
        // (uninitialized) contents.
        self.buffer[i].write(item);
    }

    /// Append the slice of items to the slice.
    pub fn append_slice(&mut self, items: &[T]) -> Result<(), OverflowError>
    where
        T: Copy,
    {
        self.ensure_unused_capacity(items.len())?;
        self.append_slice_assume_capacity(items);
        Ok(())
    }

    /// Append the slice of items to the slice, asserting the capacity is already
    /// enough to store the new items.
    pub fn append_slice_assume_capacity(&mut self, items: &[T])
    where
        T: Copy,
    {
        let old_len = self.len;
        let new_len: usize = old_len + items.len();
        self.len = Length::try_from(new_len).expect("int cast");
        self.slice()[old_len..][..items.len()].copy_from_slice(items);
    }
}

// Vec-like aliases. Thin delegations; no behavior change.
impl<T, const BUFFER_CAPACITY: usize> BoundedArrayAligned<T, BUFFER_CAPACITY> {
    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    #[inline]
    pub fn as_slice(&self) -> &[T] {
        self.const_slice()
    }
    #[inline]
    pub(crate) fn as_mut_slice(&mut self) -> &mut [T] {
        self.slice()
    }
    #[inline]
    pub fn push(&mut self, item: T) -> Result<(), OverflowError> {
        self.append(item)
    }
    #[inline]
    pub(crate) fn extend_from_slice(&mut self, items: &[T]) -> Result<(), OverflowError>
    where
        T: Copy,
    {
        self.append_slice(items)
    }
}

impl<T, const N: usize> core::ops::Deref for BoundedArrayAligned<T, N> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        self.const_slice()
    }
}
impl<T, const N: usize> core::ops::DerefMut for BoundedArrayAligned<T, N> {
    fn deref_mut(&mut self) -> &mut [T] {
        self.slice()
    }
}

// Only defined for `T == u8`.
impl<const BUFFER_CAPACITY: usize> crate::io::Write for BoundedArrayAligned<u8, BUFFER_CAPACITY> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> crate::CrateResult<()> {
        self.append_slice(buf)
            .map_err(|_| crate::CrateError::NoSpaceLeft)
    }
    #[inline]
    fn written_len(&self) -> usize {
        self.len
    }
}

impl<const BUFFER_CAPACITY: usize> core::fmt::Write for BoundedArrayAligned<u8, BUFFER_CAPACITY> {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        self.append_slice(s.as_bytes())
            .map_err(|_| core::fmt::Error)
    }
}

impl<const BUFFER_CAPACITY: usize> BoundedArrayAligned<u8, BUFFER_CAPACITY> {
    /// Initializes a writer which will write into the array.
    pub fn writer(&mut self) -> &mut Self {
        self
    }
}
