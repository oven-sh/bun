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

/// Inherent assoc types are unstable, so this is exposed as a free alias.
pub type BoundedBuffer<T, const N: usize> = [MaybeUninit<T>; N];

impl<T, const BUFFER_CAPACITY: usize> BoundedArrayAligned<T, BUFFER_CAPACITY> {
    /// Set the actual length of the slice.
    /// Returns error.Overflow if it exceeds the length of the backing array.
    pub fn init(len: usize) -> Result<Self, OverflowError> {
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

    /// Shrink the slice's length to `len`.
    ///
    /// Returns `Overflow` if `len` is greater than the current length, because growing
    /// would expose uninitialized elements as `T` through the safe `slice`/`const_slice`
    /// views — that's unsound. To grow the slice, use one of the safe growth helpers
    /// (`append`, `append_slice`, `append_n_times`, `add_one`), one of the `unsafe`
    /// uninit-returning helpers (`add_many_as_array`, `add_many_as_slice`), or
    /// `unused_capacity_slice` + [`Self::set_len_unchecked`] for a raw
    /// write-then-commit pattern.
    //
    // PORT NOTE: the Zig original was unchecked-grow (`self.len = len`). Keeping the
    // same name + safe signature but refusing to grow matches the rest of the module's
    // design — the uninit-returning helpers are the only growth path that doesn't
    // violate the `[0..len]` initialization invariant.
    pub fn resize(&mut self, len: usize) -> Result<(), OverflowError> {
        let old_len = self.len;
        if len > old_len {
            return Err(OverflowError::Overflow);
        }
        self.len = len;
        // SAFETY: `[len..old_len]` is initialized; `len` reset first so a panicking Drop
        // can't double-drop (same pattern as `clear`).
        unsafe {
            core::ptr::drop_in_place(&raw mut self.buffer[len..old_len] as *mut [T]);
        }
        Ok(())
    }

    /// Set `len` directly without touching the buffer. UB to read the slice afterward
    /// unless `[0..len]` has been initialized first (e.g. via `unused_capacity_slice`
    /// followed by `MaybeUninit::write` for each new slot).
    ///
    /// # Safety
    /// - `len <= BUFFER_CAPACITY`
    /// - Elements at indices `[old_len .. len]` have been initialized with a valid `T`
    ///   before any subsequent read through the safe slice views.
    pub unsafe fn set_len_unchecked(&mut self, len: usize) {
        debug_assert!(len <= BUFFER_CAPACITY);
        self.len = len;
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

    /// Return the maximum length of a slice.
    pub fn capacity(&self) -> usize {
        BUFFER_CAPACITY
    }

    /// Check that the slice can hold at least `additional_count` items.
    pub fn ensure_unused_capacity(&self, additional_count: usize) -> Result<(), OverflowError> {
        if self.len + additional_count > BUFFER_CAPACITY {
            return Err(OverflowError::Overflow);
        }
        Ok(())
    }

    /// Increase length by 1, returning a pointer to the new item.
    pub fn add_one(&mut self) -> Result<&mut T, OverflowError> {
        self.ensure_unused_capacity(1)?;
        Ok(self.add_one_assume_capacity())
    }

    /// Increase length by 1, returning pointer to the new item.
    /// Asserts that there is space for the new item.
    pub fn add_one_assume_capacity(&mut self) -> &mut T {
        debug_assert!(self.len < BUFFER_CAPACITY);
        self.len += 1;
        let i = self.len - 1;
        // SAFETY: index `i` is within `[0..len)`; caller treats the slot as uninitialized
        // and must write before reading.
        unsafe { &mut *self.buffer[i].as_mut_ptr() }
    }

    /// Grow the slice by `N` uninitialized slots and return a `MaybeUninit` view
    /// of them. `len` is committed to `old_len + N` BEFORE the caller writes, so
    /// this function is `unsafe`: if the caller drops the returned reference
    /// without fully initializing every slot, a subsequent safe read
    /// (`as_slice` / `const_slice` / `Deref`) observes uninitialized memory as
    /// `T` — UB for any `T` with validity requirements.
    ///
    /// # Safety
    /// - Caller must initialize every returned slot with a valid `T` before
    ///   dropping the returned reference or calling any method on `self` that
    ///   reads `[0..len]` through a safe view.
    pub unsafe fn add_many_as_array<const N: usize>(
        &mut self,
    ) -> Result<&mut [MaybeUninit<T>; N], OverflowError> {
        let prev_len = self.len;
        let new_len = prev_len.checked_add(N).ok_or(OverflowError::Overflow)?;
        if new_len > BUFFER_CAPACITY {
            return Err(OverflowError::Overflow);
        }
        // SAFETY: `new_len <= BUFFER_CAPACITY`. Initialization obligation is forwarded to
        // our caller by this function's own `unsafe` marker.
        unsafe { self.set_len_unchecked(new_len) };
        let ptr = self.buffer[prev_len..][..N]
            .as_mut_ptr()
            .cast::<[MaybeUninit<T>; N]>();
        // SAFETY: `ptr` is non-null, properly aligned (same alignment as
        // `[MaybeUninit<T>; N]` because the source is `[MaybeUninit<T>; ...]`),
        // and points at exactly `N` slots inside `self.buffer`, which outlives
        // the returned borrow.
        Ok(unsafe { &mut *ptr })
    }

    /// Grow the slice by `n` uninitialized slots and return a `MaybeUninit`
    /// view of them. See [`Self::add_many_as_array`] for the full contract.
    ///
    /// # Safety
    /// Same as [`Self::add_many_as_array`].
    pub unsafe fn add_many_as_slice(
        &mut self,
        n: usize,
    ) -> Result<&mut [MaybeUninit<T>], OverflowError> {
        let prev_len = self.len;
        let new_len = prev_len.checked_add(n).ok_or(OverflowError::Overflow)?;
        if new_len > BUFFER_CAPACITY {
            return Err(OverflowError::Overflow);
        }
        // SAFETY: `new_len <= BUFFER_CAPACITY`. Initialization obligation is forwarded to
        // our caller by this function's own `unsafe` marker.
        unsafe { self.set_len_unchecked(new_len) };
        Ok(&mut self.buffer[prev_len..][..n])
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
    /// Note that such an operation must be followed up with a call to
    /// [`Self::set_len_unchecked`] to commit the new length; `resize` is
    /// shrink-only so it cannot be used here.
    pub fn unused_capacity_slice(&mut self) -> &mut [MaybeUninit<T>] {
        &mut self.buffer[self.len..]
    }
    // Returns `&mut [MaybeUninit<T>]` instead of `&mut [T]` because the region is
    // uninitialized by definition.

    /// Insert `item` at index `i` by moving `slice[n .. slice.len]` to make room.
    /// This operation is O(N).
    pub fn insert(&mut self, i: usize, item: T) -> Result<(), OverflowError> {
        if i > self.len {
            return Err(OverflowError::Overflow);
        }
        let _ = self.add_one()?;
        // Reshaped for borrowck.
        let s_len = self.len;
        // SAFETY: ranges are within `[0..len)`; src and dst overlap, hence `ptr::copy` (memmove).
        unsafe {
            let base = self.buffer.as_mut_ptr();
            core::ptr::copy(base.add(i), base.add(i + 1), s_len - 1 - i);
        }
        self.buffer[i].write(item);
        Ok(())
    }

    /// Insert slice `items` at index `i` by moving `slice[i .. slice.len]` to make room.
    /// This operation is O(N).
    pub fn insert_slice(&mut self, i: usize, items: &[T]) -> Result<(), OverflowError>
    where
        T: Copy,
    {
        self.ensure_unused_capacity(items.len())?;
        self.len += Length::try_from(items.len()).expect("int cast");
        let len = self.len;
        // SAFETY: ranges are within `[0..len)` after the length bump; overlapping memmove.
        unsafe {
            let base = self.buffer.as_mut_ptr();
            core::ptr::copy(
                base.add(i),
                base.add(i + items.len()),
                len - items.len() - i,
            );
        }
        self.slice()[i..][..items.len()].copy_from_slice(items);
        Ok(())
    }

    /// Replace range of elements `slice[start..][0..len]` with `new_items`.
    /// Grows slice if `len < new_items.len`.
    /// Shrinks slice if `len > new_items.len`.
    pub fn replace_range(
        &mut self,
        start: usize,
        len: usize,
        new_items: &[T],
    ) -> Result<(), OverflowError>
    where
        T: Copy,
    {
        let after_range = start + len;
        // Reshaped for borrowck.
        let range_len = after_range - start;

        if range_len == new_items.len() {
            self.slice()[start..after_range][..new_items.len()].copy_from_slice(new_items);
        } else if range_len < new_items.len() {
            let first = &new_items[..range_len];
            let rest = &new_items[range_len..];
            self.slice()[start..after_range][..first.len()].copy_from_slice(first);
            self.insert_slice(after_range, rest)?;
        } else {
            self.slice()[start..after_range][..new_items.len()].copy_from_slice(new_items);
            let after_subrange = start + new_items.len();
            // Reshaped for borrowck — read and write per element instead of
            // holding overlapping `const_slice()`/`slice()` borrows.
            let tail_len = self.len - after_range;
            for i in 0..tail_len {
                let item = self.const_slice()[after_range + i];
                self.slice()[after_subrange..][i] = item;
            }
            self.len = Length::try_from(self.len - len + new_items.len()).expect("int cast");
            // Removing `len` items and inserting `new_items.len()` items
            // yields `self.len - len + new_items.len()`.
        }
        Ok(())
    }

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

    /// Remove the element at index `i`, shift elements after index
    /// `i` forward, and return the removed element.
    /// Asserts the slice has at least one item.
    /// This operation is O(N).
    pub fn ordered_remove(&mut self, i: usize) -> T
    where
        T: Copy,
    {
        let newlen = self.len - 1;
        if newlen == i {
            return self.pop().unwrap();
        }
        let old_item = self.get(i);
        // Reshaped for borrowck.
        for j in 0..(newlen - i) {
            let v = self.get(i + 1 + j);
            self.slice()[i + j] = v;
        }
        // The slot past the new len is left as-is.
        self.len = newlen;
        old_item
    }

    /// Remove the element at the specified index and return it.
    /// The empty slot is filled from the end of the slice.
    /// This operation is O(1).
    pub fn swap_remove(&mut self, i: usize) -> T {
        if self.len - 1 == i {
            return self.pop().unwrap();
        }
        // SAFETY: `i < len-1` and the old last element is moved into slot `i`.
        let old_item = unsafe { self.buffer[i].assume_init_read() };
        let last = self.pop().unwrap();
        self.buffer[i].write(last);
        old_item
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

    /// Append a value to the slice `n` times.
    /// Allocates more memory as necessary.
    pub fn append_n_times(&mut self, value: T, n: usize) -> Result<(), OverflowError>
    where
        T: Copy,
    {
        let old_len = self.len;
        let new_len = old_len.checked_add(n).ok_or(OverflowError::Overflow)?;
        if new_len > BUFFER_CAPACITY {
            return Err(OverflowError::Overflow);
        }
        // Initialize every new slot before committing the length — keeps the
        // `[0..len]` invariant true at every observable point.
        for slot in &mut self.buffer[old_len..new_len] {
            slot.write(value);
        }
        // SAFETY: the preceding loop wrote a valid `T` into each slot in
        // `[old_len .. new_len]`, and `new_len <= BUFFER_CAPACITY`.
        unsafe { self.set_len_unchecked(new_len) };
        Ok(())
    }

    /// Append a value to the slice `n` times.
    /// Asserts the capacity is enough.
    pub fn append_n_times_assume_capacity(&mut self, value: T, n: usize)
    where
        T: Copy,
    {
        let old_len: usize = self.len;
        let new_len: usize = old_len + n;
        self.len = Length::try_from(new_len).expect("int cast");
        debug_assert!(self.len <= BUFFER_CAPACITY);
        let end = self.len;
        self.slice()[old_len..end].fill(value);
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
    pub fn as_mut_slice(&mut self) -> &mut [T] {
        self.slice()
    }
    #[inline]
    pub fn push(&mut self, item: T) -> Result<(), OverflowError> {
        self.append(item)
    }
    #[inline]
    pub fn extend_from_slice(&mut self, items: &[T]) -> Result<(), OverflowError>
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
