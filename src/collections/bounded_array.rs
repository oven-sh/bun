//! Removed from the Zig standard library in https://github.com/ziglang/zig/pull/24699/
//!
//! Modifications:
//! - `len` is a field of integer-size instead of usize. This reduces memory usage.
//!
//! A structure with an array and a length, that can be used as a slice.
//!
//! Useful to pass around small arrays whose exact size is only known at
//! runtime, but whose maximum size is known at comptime, without requiring
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

impl From<OverflowError> for bun_core::Error {
    fn from(_: OverflowError) -> Self {
        bun_core::err!("Overflow")
    }
}

/// A structure with an array and a length, that can be used as a slice.
///
/// Useful to pass around small arrays whose exact size is only known at
/// runtime, but whose maximum size is known at comptime, without requiring
/// an `Allocator`.
pub type BoundedArray<T, const BUFFER_CAPACITY: usize> = BoundedArrayAligned<T, BUFFER_CAPACITY>;
// PORT NOTE: Zig's `BoundedArray` delegates to `BoundedArrayAligned` with `@alignOf(T)`.
// In Rust the natural alignment of `[T; N]` is already `align_of::<T>()`, so the alias is
// transparent. The explicit `alignment` const-param is dropped (see below).

/// A structure with an array, length and alignment, that can be used as a
/// slice.
///
/// Useful to pass around small explicitly-aligned arrays whose exact size is
/// only known at runtime, but whose maximum size is known at comptime, without
/// requiring an `Allocator`.
// TODO(port): Zig takes `comptime alignment: Alignment` and applies it via
// `align(alignment.toByteUnits())` on the buffer field. Stable Rust cannot express
// `#[repr(align(N))]` with a const-generic `N`. All in-tree callers use the default
// `@alignOf(T)` via `BoundedArray`, so the param is dropped for Phase A. Revisit if a
// caller needs over-alignment (would require a wrapper type per alignment).
pub struct BoundedArrayAligned<T, const BUFFER_CAPACITY: usize> {
    buffer: [MaybeUninit<T>; BUFFER_CAPACITY],
    // TODO(port): Zig uses `Length = std.math.ByteAlignedInt(std.math.IntFittingRange(0, buffer_capacity))`
    // (smallest byte-aligned uint that fits `0..=BUFFER_CAPACITY`) to shrink this field.
    // Stable Rust const generics cannot pick an integer type from a const value without
    // `generic_const_exprs`. Using `usize` for now.
    // PERF(port): was size-optimized integer field — profile in Phase B
    len: usize,
}

// `const Length = std.math.ByteAlignedInt(std.math.IntFittingRange(0, buffer_capacity));`
// — see TODO above; collapsed to `usize`.
type Length = usize;

impl<T, const BUFFER_CAPACITY: usize> Default for BoundedArrayAligned<T, BUFFER_CAPACITY> {
    fn default() -> Self {
        Self {
            // SAFETY: an array of `MaybeUninit<T>` is itself trivially inhabited when uninitialized.
            buffer: unsafe { MaybeUninit::<[MaybeUninit<T>; BUFFER_CAPACITY]>::uninit().assume_init() },
            len: 0,
        }
    }
}

/// `pub const Buffer = @FieldType(Self, "buffer");` — inherent assoc types are
/// unstable; only used for introspection in Zig, so expose as a free alias.
pub type BoundedBuffer<T, const N: usize> = [MaybeUninit<T>; N];

impl<T, const BUFFER_CAPACITY: usize> BoundedArrayAligned<T, BUFFER_CAPACITY> {

    /// Set the actual length of the slice.
    /// Returns error.Overflow if it exceeds the length of the backing array.
    pub fn init(len: usize) -> Result<Self, OverflowError> {
        if len > BUFFER_CAPACITY {
            return Err(OverflowError::Overflow);
        }
        let mut s = Self::default();
        s.len = Length::try_from(len).unwrap();
        Ok(s)
    }

    /// View the internal array as a slice whose size was previously set.
    // PORT NOTE: Zig's `slice(self: anytype)` is mut/const-polymorphic via `@TypeOf`.
    // Rust splits this into `slice(&mut self)` and `const_slice(&self)`.
    pub fn slice(&mut self) -> &mut [T] {
        let len = self.len;
        // SAFETY: elements `[0..len]` are initialized by the public API's invariants.
        unsafe { &mut *(&mut self.buffer[0..len] as *mut [MaybeUninit<T>] as *mut [T]) }
    }

    /// View the internal array as a constant slice whose size was previously set.
    pub fn const_slice(&self) -> &[T] {
        let len = self.len;
        // SAFETY: elements `[0..len]` are initialized by the public API's invariants.
        unsafe { &*(&self.buffer[0..len] as *const [MaybeUninit<T>] as *const [T]) }
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
        self.len = 0;
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
    // TODO(port): Zig `@memcpy` works for non-Copy `T` (bitwise). If a non-`Copy` caller
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
        // and must write before reading (matches Zig `addOneAssumeCapacity` contract).
        unsafe { &mut *self.buffer[i].as_mut_ptr() }
    }

    /// Resize the slice, adding `n` new elements, which have `undefined` values.
    /// The return value is a pointer to the array of uninitialized elements.
    pub fn add_many_as_array<const N: usize>(&mut self) -> Result<&mut [T; N], OverflowError> {
        let prev_len = self.len;
        self.resize((self.len as usize) + N)?;
        // SAFETY: `[prev_len .. prev_len+N]` is within capacity after resize; caller must
        // initialize before reading (Zig returns `*[n]T` over undefined storage).
        let ptr = self.buffer[prev_len..][..N].as_mut_ptr() as *mut [T; N];
        Ok(unsafe { &mut *ptr })
    }

    /// Resize the slice, adding `n` new elements, which have `undefined` values.
    /// The return value is a slice pointing to the uninitialized elements.
    pub fn add_many_as_slice(&mut self, n: usize) -> Result<&mut [T], OverflowError> {
        let prev_len = self.len;
        self.resize(self.len + n)?;
        // SAFETY: `[prev_len .. prev_len+n]` is within capacity after resize; caller must
        // initialize before reading.
        let s = &mut self.buffer[prev_len..][..n];
        Ok(unsafe { &mut *(s as *mut [MaybeUninit<T>] as *mut [T]) })
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
    // PORT NOTE: returns `&mut [MaybeUninit<T>]` instead of `&mut [T]` because the region is
    // uninitialized by definition; Zig's `[]T` over undefined memory has no safe Rust equivalent.

    /// Insert `item` at index `i` by moving `slice[n .. slice.len]` to make room.
    /// This operation is O(N).
    pub fn insert(&mut self, i: usize, item: T) -> Result<(), OverflowError> {
        if i > self.len {
            return Err(OverflowError::Overflow);
        }
        let _ = self.add_one()?;
        // PORT NOTE: reshaped for borrowck — Zig aliases `s[i+1..]` and `s[i..len-1]` from one slice.
        let s_len = self.len;
        // mem.copyBackwards(T, s[i + 1 .. s.len], s[i .. s.len - 1]);
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
        self.len += Length::try_from(items.len()).unwrap();
        // mem.copyBackwards(T, self.slice()[i + items.len .. self.len], self.constSlice()[i .. self.len - items.len]);
        let len = self.len;
        // SAFETY: ranges are within `[0..len)` after the length bump; overlapping memmove.
        unsafe {
            let base = self.buffer.as_mut_ptr();
            core::ptr::copy(base.add(i), base.add(i + items.len()), len - items.len() - i);
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
        // PORT NOTE: reshaped for borrowck — Zig holds `range` borrow across `insertSlice`.
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
            // PORT NOTE: reshaped for borrowck — Zig reads `constSlice()[after_range..]` while
            // writing `slice()[after_subrange..]` in the same loop body.
            let tail_len = self.len - after_range;
            for i in 0..tail_len {
                let item = self.const_slice()[after_range + i];
                self.slice()[after_subrange..][i] = item;
            }
            self.len = Length::try_from((self.len as usize) - (len as usize) - (new_items.len() as usize)).unwrap();
            // PORT NOTE: ported verbatim from Zig (`self.len - len - new_items.len`).
        }
        Ok(())
    }

    /// Extend the slice by 1 element.
    pub fn append(&mut self, item: T) -> Result<(), OverflowError> {
        let new_item_ptr = self.add_one()?;
        *new_item_ptr = item;
        Ok(())
    }

    /// Extend the slice by 1 element, asserting the capacity is already
    /// enough to store the new item.
    pub fn append_assume_capacity(&mut self, item: T) {
        let new_item_ptr = self.add_one_assume_capacity();
        *new_item_ptr = item;
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
        // PORT NOTE: reshaped for borrowck — Zig writes through `*b` while calling `self.get()`.
        for j in 0..(newlen - i) {
            let v = self.get(i + 1 + j);
            self.slice()[i + j] = v;
        }
        // self.set(newlen, undefined); — no-op in Rust (slot is past new len, left as-is)
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
        self.len = Length::try_from(new_len).unwrap();
        self.slice()[old_len..][..items.len()].copy_from_slice(items);
    }

    /// Append a value to the slice `n` times.
    /// Allocates more memory as necessary.
    pub fn append_n_times(&mut self, value: T, n: usize) -> Result<(), OverflowError>
    where
        T: Copy,
    {
        let old_len = self.len;
        self.resize(old_len + n)?;
        let end = self.len;
        self.slice()[old_len..end].fill(value);
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
        self.len = Length::try_from(new_len).unwrap();
        debug_assert!(self.len <= BUFFER_CAPACITY);
        let end = self.len;
        self.slice()[old_len..end].fill(value);
    }
}

// Rust-idiom aliases (Vec-like surface) so callers don't need to know the
// Zig-style names. Thin delegations; no behavior change.
impl<T, const BUFFER_CAPACITY: usize> BoundedArrayAligned<T, BUFFER_CAPACITY> {
    #[inline] pub fn len(&self) -> usize { self.len }
    #[inline] pub fn is_empty(&self) -> bool { self.len == 0 }
    #[inline] pub fn as_slice(&self) -> &[T] { self.const_slice() }
    #[inline] pub fn as_mut_slice(&mut self) -> &mut [T] { self.slice() }
    #[inline] pub fn push(&mut self, item: T) -> Result<(), OverflowError> { self.append(item) }
    #[inline] pub fn extend_from_slice(&mut self, items: &[T]) -> Result<(), OverflowError>
    where T: Copy { self.append_slice(items) }
}

impl<T, const N: usize> core::ops::Deref for BoundedArrayAligned<T, N> {
    type Target = [T];
    fn deref(&self) -> &[T] { self.const_slice() }
}
impl<T, const N: usize> core::ops::DerefMut for BoundedArrayAligned<T, N> {
    fn deref_mut(&mut self) -> &mut [T] { self.slice() }
}

// `pub const Writer = ... std.io.GenericWriter(*Self, error{Overflow}, appendWrite);`
// Only defined for `T == u8` (Zig `@compileError`s otherwise).
// TODO(port): Zig exposes a `std.io.GenericWriter`. Phase A maps to `core::fmt::Write`;
// if a byte-level `bun_io::Write` is needed, add it in Phase B.
impl<const BUFFER_CAPACITY: usize> core::fmt::Write for BoundedArrayAligned<u8, BUFFER_CAPACITY> {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        self.append_slice(s.as_bytes()).map_err(|_| core::fmt::Error)
    }
}

impl<const BUFFER_CAPACITY: usize> BoundedArrayAligned<u8, BUFFER_CAPACITY> {
    /// Initializes a writer which will write into the array.
    pub fn writer(&mut self) -> &mut Self {
        self
    }

    /// Same as `appendSlice` except it returns the number of bytes written, which is always the same
    /// as `m.len`. The purpose of this function existing is to match `std.io.GenericWriter` API.
    fn append_write(&mut self, m: &[u8]) -> Result<usize, OverflowError> {
        self.append_slice(m)?;
        Ok(m.len())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/collections/bounded_array.zig (308 lines)
//   confidence: medium
//   todos:      5
//   notes:      alignment const-param dropped (stable Rust limitation); len widened to usize (PERF); inherent assoc type is nightly-only
// ──────────────────────────────────────────────────────────────────────────
