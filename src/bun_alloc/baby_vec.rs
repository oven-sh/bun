//! `BabyVec<'a, T>` — arena-backed growable array with `u32` length/capacity.
//!
//! `(ptr: [*]T, len: u32, cap: u32)` plus the owning
//! `&'a MimallocArena` stored inline (lifetime-checked allocator), so 24 B.
//! Still 8 B smaller than `Vec<T, &'a MimallocArena>` (32 B), which
//! matters for AST node lists embedded in `Part` / `BundledAst` columns.
//!
//! `len`/`cap` are stored as `u32` (`usize` on the public API for ergonomics).
//! No bundler list approaches 2³² elements; debug-asserted on every grow path.

use core::alloc::{Allocator, Layout};
use core::mem::{ManuallyDrop, size_of};
use core::ops::{Deref, DerefMut, RangeBounds};
use core::ptr::{self, NonNull};
use core::{fmt, slice};

use crate::MimallocArena;

/// Arena-backed `Vec` with `u32` length/capacity. See module doc.
pub struct BabyVec<'a, T> {
    ptr: NonNull<T>,
    len: u32,
    cap: u32,
    alloc: &'a MimallocArena,
}

const _: () = assert!(size_of::<BabyVec<'static, u8>>() == 24);

// SAFETY: same as `Vec<T, &MimallocArena>` — `Send`/`Sync` follow `T` and the
// allocator handle (`&MimallocArena: Sync` is already declared upstream; the
// raw `NonNull<T>` is the only auto-trait opt-out).
unsafe impl<'a, T: Send> Send for BabyVec<'a, T> {}
// SAFETY: `&MimallocArena: Sync` and the only auto-trait opt-out is the raw
// `NonNull<T>`; with `T: Sync` the owned `[T]` is shareable across threads.
unsafe impl<'a, T: Sync> Sync for BabyVec<'a, T> {}

impl<'a, T> BabyVec<'a, T> {
    const T_IS_ZST: bool = size_of::<T>() == 0;

    #[inline]
    pub const fn new_in(alloc: &'a MimallocArena) -> Self {
        BabyVec {
            ptr: NonNull::dangling(),
            len: 0,
            cap: if Self::T_IS_ZST { u32::MAX } else { 0 },
            alloc,
        }
    }

    #[inline]
    pub fn with_capacity_in(cap: usize, alloc: &'a MimallocArena) -> Self {
        let mut v = Self::new_in(alloc);
        if cap > 0 {
            v.grow_to(cap);
        }
        v
    }

    /// # Safety
    /// `(ptr, len, cap)` must describe a valid allocation owned by `alloc`
    /// (i.e. obtainable from a prior `BabyVec::into_raw_parts` or
    /// `<&MimallocArena as Allocator>::allocate` with `Layout::array::<T>(cap)`),
    /// with `len <= cap` initialized elements.
    #[inline]
    pub unsafe fn from_raw_parts_in(
        ptr: *mut T,
        len: usize,
        cap: usize,
        alloc: &'a MimallocArena,
    ) -> Self {
        debug_assert!(len <= cap && cap <= u32::MAX as usize);
        BabyVec {
            // SAFETY: caller contract — `ptr` is a valid (or dangling-for-empty)
            // allocation pointer; `Vec` uses the same dangling-NonNull encoding.
            ptr: unsafe { NonNull::new_unchecked(ptr) },
            len: len as u32,
            cap: if Self::T_IS_ZST { u32::MAX } else { cap as u32 },
            alloc,
        }
    }

    #[inline]
    pub fn into_raw_parts(self) -> (*mut T, usize, usize, &'a MimallocArena) {
        let me = ManuallyDrop::new(self);
        (me.ptr.as_ptr(), me.len as usize, me.cap as usize, me.alloc)
    }

    #[inline]
    pub fn allocator(&self) -> &&'a MimallocArena {
        &self.alloc
    }

    /// Re-tag the stored allocator handle. See [`crate::transfer_arena`].
    #[inline]
    pub(crate) fn set_allocator(&mut self, alloc: &'a MimallocArena) {
        self.alloc = alloc;
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len as usize
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    #[inline]
    pub fn capacity(&self) -> usize {
        self.cap as usize
    }

    #[inline]
    pub fn as_ptr(&self) -> *const T {
        self.ptr.as_ptr()
    }
    #[inline]
    pub fn as_mut_ptr(&mut self) -> *mut T {
        self.ptr.as_ptr()
    }
    #[inline]
    pub fn as_slice(&self) -> &[T] {
        // SAFETY: `[ptr, ptr+len)` are `len` initialized `T` (struct invariant).
        unsafe { slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }
    #[inline]
    pub fn as_mut_slice(&mut self) -> &mut [T] {
        // SAFETY: as above; `&mut self` proves exclusive access.
        unsafe { slice::from_raw_parts_mut(self.ptr.as_ptr(), self.len as usize) }
    }

    /// # Safety
    /// `new_len <= capacity()`, and `[old_len, new_len)` must be initialized
    /// when growing.
    #[inline]
    pub unsafe fn set_len(&mut self, new_len: usize) {
        debug_assert!(new_len <= self.cap as usize);
        self.len = new_len as u32;
    }

    #[inline]
    pub fn reserve(&mut self, additional: usize) {
        let need = self.len as usize + additional;
        if need > self.cap as usize {
            self.grow_to(need);
        }
    }

    #[inline]
    pub fn reserve_exact(&mut self, additional: usize) {
        let need = self.len as usize + additional;
        if need > self.cap as usize {
            self.grow_exact(need);
        }
    }

    #[inline]
    pub fn push(&mut self, value: T) {
        if self.len == self.cap {
            self.grow_to(self.len as usize + 1);
        }
        // SAFETY: `len < cap` after grow; slot is in-bounds and uninit.
        unsafe { self.ptr.as_ptr().add(self.len as usize).write(value) };
        self.len += 1;
    }

    #[inline]
    pub fn pop(&mut self) -> Option<T> {
        if self.len == 0 {
            return None;
        }
        self.len -= 1;
        // SAFETY: slot was initialized; ownership moves out, len already
        // decremented so it won't be dropped again.
        Some(unsafe { self.ptr.as_ptr().add(self.len as usize).read() })
    }

    pub fn insert(&mut self, index: usize, value: T) {
        let len = self.len as usize;
        assert!(index <= len, "BabyVec::insert index {index} > len {len}");
        if self.len == self.cap {
            self.grow_to(len + 1);
        }
        // SAFETY: `index <= len < cap` after grow; shifting `len - index`
        // initialized elements one slot right stays within `[0, cap)`.
        unsafe {
            let p = self.ptr.as_ptr().add(index);
            ptr::copy(p, p.add(1), len - index);
            p.write(value);
        }
        self.len += 1;
    }

    pub fn swap_remove(&mut self, index: usize) -> T {
        let len = self.len as usize;
        assert!(
            index < len,
            "BabyVec::swap_remove index {index} >= len {len}"
        );
        // SAFETY: `index < len`; reading the hole then overwriting with the
        // last element (possibly itself) is the standard swap-remove. Len is
        // decremented before the read of `last` so the moved-from tail slot
        // is no longer considered initialized.
        unsafe {
            let p = self.ptr.as_ptr();
            let v = p.add(index).read();
            self.len -= 1;
            ptr::copy(p.add(self.len as usize), p.add(index), 1);
            v
        }
    }

    /// `Vec::append` parity — bitwise-move all elements from `other` to the
    /// end of `self`, leaving `other` empty.
    pub fn append(&mut self, other: &mut Self) {
        let n = other.len as usize;
        if n == 0 {
            return;
        }
        self.reserve(n);
        // SAFETY: `reserve` guarantees room for `n` more; `self`/`other` are
        // distinct (`&mut` × 2). Elements are bitwise-moved; `other.len` is
        // zeroed so it relinquishes ownership before `self` claims it.
        unsafe {
            ptr::copy_nonoverlapping(
                other.ptr.as_ptr(),
                self.ptr.as_ptr().add(self.len as usize),
                n,
            );
            other.len = 0;
            self.len += n as u32;
        }
    }

    /// Bitwise-move all elements from `src` to the *front* of `self`, leaving
    /// `src` empty. Mirrors `bun_collections::prepend_from` for `Vec`.
    pub fn prepend_from(&mut self, src: &mut Self) {
        let src_len = src.len as usize;
        if src_len == 0 {
            return;
        }
        let dst_len = self.len as usize;
        self.reserve(src_len);
        // SAFETY: capacity holds `dst_len + src_len`; the right-shift memmove
        // and front copy together fully initialize `[0, dst_len+src_len)`.
        // `src.len` is zeroed before `self.len` is grown so no element is ever
        // owned by both.
        unsafe {
            let base = self.ptr.as_ptr();
            ptr::copy(base, base.add(src_len), dst_len);
            ptr::copy_nonoverlapping(src.ptr.as_ptr(), base, src_len);
            src.len = 0;
            self.len += src_len as u32;
        }
    }

    pub fn remove(&mut self, index: usize) -> T {
        let len = self.len as usize;
        assert!(index < len, "BabyVec::remove index {index} >= len {len}");
        // SAFETY: `index < len`; read moves out the element, then shift the
        // `len-1-index` initialized tail down by one. `len` decremented after.
        unsafe {
            let p = self.ptr.as_ptr().add(index);
            let v = p.read();
            ptr::copy(p.add(1), p, len - index - 1);
            self.len -= 1;
            v
        }
    }

    #[inline]
    pub fn truncate(&mut self, new_len: usize) {
        if new_len >= self.len as usize {
            return;
        }
        let drop_from = new_len;
        let drop_count = self.len as usize - new_len;
        self.len = new_len as u32;
        // SAFETY: `[drop_from, drop_from+drop_count)` were initialized; len
        // already shortened so a panic in a destructor doesn't double-drop.
        unsafe {
            ptr::drop_in_place(ptr::slice_from_raw_parts_mut(
                self.ptr.as_ptr().add(drop_from),
                drop_count,
            ));
        }
    }

    #[inline]
    pub fn clear(&mut self) {
        self.truncate(0);
    }

    /// `Vec::leak` parity — forget the `BabyVec`, return the buffer as an
    /// arena-lifetime slice. Reclaimed when the arena resets/drops.
    #[inline]
    pub fn leak(self) -> &'a mut [T] {
        let me = ManuallyDrop::new(self);
        // SAFETY: `[ptr, ptr+len)` are `len` initialized `T` valid for `'a`
        // (the buffer is owned by `me.alloc`, which outlives `'a`).
        unsafe { slice::from_raw_parts_mut(me.ptr.as_ptr(), me.len as usize) }
    }

    /// Drain all elements. Only the full range is supported — the `RangeBounds`
    /// parameter exists for drop-in `ArenaVec` alias parity with `Vec::drain(..)`.
    /// No caller needs a partial drain.
    pub fn drain<R: RangeBounds<usize>>(&mut self, range: R) -> IntoIter<'a, T> {
        use core::ops::Bound::*;
        // Const-folded for `..`; guards release builds against partial ranges.
        assert!(
            matches!(range.start_bound(), Unbounded | Included(0))
                && match range.end_bound() {
                    Unbounded => true,
                    Excluded(n) => *n == self.len as usize,
                    Included(n) => *n + 1 == self.len as usize,
                },
            "BabyVec::drain only supports the full range",
        );
        core::mem::replace(self, BabyVec::new_in(self.alloc)).into_iter()
    }

    pub fn extend_from_slice(&mut self, other: &[T])
    where
        T: Copy,
    {
        let n = other.len();
        self.reserve(n);
        // SAFETY: `reserve` guarantees `cap >= len + n`; the source/destination
        // ranges are disjoint (`other` borrows immutably, `self` exclusively).
        unsafe {
            ptr::copy_nonoverlapping(other.as_ptr(), self.ptr.as_ptr().add(self.len as usize), n);
            self.len += n as u32;
        }
    }

    #[cold]
    fn grow_to(&mut self, at_least: usize) {
        assert!(at_least <= u32::MAX as usize, "BabyVec capacity overflow");
        if Self::T_IS_ZST {
            return;
        }
        // Same growth as `Vec`: max(2×cap, at_least, 4), capped at u32::MAX.
        let new_cap = (self.cap as usize * 2)
            .max(at_least)
            .max(4)
            .min(u32::MAX as usize);
        self.grow_exact(new_cap);
    }

    #[cold]
    fn grow_exact(&mut self, new_cap: usize) {
        if Self::T_IS_ZST {
            return;
        }
        assert!(new_cap <= u32::MAX as usize, "BabyVec capacity overflow");
        let new_layout = Layout::array::<T>(new_cap).unwrap_or_else(|_| crate::out_of_memory());
        let new_ptr = if self.cap == 0 {
            (&self.alloc)
                .allocate(new_layout)
                .unwrap_or_else(|_| crate::out_of_memory())
        } else {
            let old_layout = Layout::array::<T>(self.cap as usize).unwrap();
            // SAFETY: `self.ptr` was returned by `(&self.alloc).allocate` (or
            // `grow`) with `old_layout`; `new_layout.size() >= old_layout.size()`.
            unsafe {
                (&self.alloc)
                    .grow(self.ptr.cast::<u8>(), old_layout, new_layout)
                    .unwrap_or_else(|_| crate::out_of_memory())
            }
        };
        self.ptr = new_ptr.cast::<T>();
        self.cap = new_cap as u32;
    }
}

impl<'a, T> Drop for BabyVec<'a, T> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `[ptr, ptr+len)` are `len` initialized `T`.
        unsafe {
            ptr::drop_in_place(ptr::slice_from_raw_parts_mut(
                self.ptr.as_ptr(),
                self.len as usize,
            ));
        }
        if !Self::T_IS_ZST && self.cap != 0 {
            let layout = Layout::array::<T>(self.cap as usize).unwrap();
            // SAFETY: `ptr` was allocated by `(&self.alloc)` with `layout`.
            unsafe { (&self.alloc).deallocate(self.ptr.cast::<u8>(), layout) };
        }
    }
}

impl<'a, T> Deref for BabyVec<'a, T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        self.as_slice()
    }
}
impl<'a, T> DerefMut for BabyVec<'a, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [T] {
        self.as_mut_slice()
    }
}

impl<'a, T> Extend<T> for BabyVec<'a, T> {
    fn extend<I: IntoIterator<Item = T>>(&mut self, iter: I) {
        let iter = iter.into_iter();
        let (lo, _) = iter.size_hint();
        self.reserve(lo);
        for v in iter {
            self.push(v);
        }
    }
}

impl<'a, 'b, T: Copy> Extend<&'b T> for BabyVec<'a, T> {
    #[inline]
    fn extend<I: IntoIterator<Item = &'b T>>(&mut self, iter: I) {
        for v in iter {
            self.push(*v);
        }
    }
}

impl<'a, 'b, T> IntoIterator for &'b BabyVec<'a, T> {
    type Item = &'b T;
    type IntoIter = slice::Iter<'b, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.as_slice().iter()
    }
}
impl<'a, 'b, T> IntoIterator for &'b mut BabyVec<'a, T> {
    type Item = &'b mut T;
    type IntoIter = slice::IterMut<'b, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.as_mut_slice().iter_mut()
    }
}
impl<'a, T> IntoIterator for BabyVec<'a, T> {
    type Item = T;
    type IntoIter = IntoIter<'a, T>;
    #[inline]
    fn into_iter(self) -> IntoIter<'a, T> {
        let me = ManuallyDrop::new(self);
        IntoIter {
            ptr: me.ptr,
            idx: 0,
            len: me.len,
            cap: me.cap,
            alloc: me.alloc,
        }
    }
}

/// Consuming iterator. Drops any unyielded tail and frees the buffer on drop.
pub struct IntoIter<'a, T> {
    ptr: NonNull<T>,
    idx: u32,
    len: u32,
    cap: u32,
    alloc: &'a MimallocArena,
}

impl<'a, T> Iterator for IntoIter<'a, T> {
    type Item = T;
    #[inline]
    fn next(&mut self) -> Option<T> {
        if self.idx == self.len {
            return None;
        }
        let i = self.idx as usize;
        self.idx += 1;
        // SAFETY: `i < len` and slot has not been read yet (idx monotone).
        Some(unsafe { self.ptr.as_ptr().add(i).read() })
    }
    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let n = (self.len - self.idx) as usize;
        (n, Some(n))
    }
}
impl<'a, T> ExactSizeIterator for IntoIter<'a, T> {}

impl<'a, T> Drop for IntoIter<'a, T> {
    fn drop(&mut self) {
        // SAFETY: `[idx, len)` are the unyielded initialized elements.
        unsafe {
            ptr::drop_in_place(ptr::slice_from_raw_parts_mut(
                self.ptr.as_ptr().add(self.idx as usize),
                (self.len - self.idx) as usize,
            ));
        }
        if size_of::<T>() != 0 && self.cap != 0 {
            let layout = Layout::array::<T>(self.cap as usize).unwrap();
            // SAFETY: buffer was allocated by `(&self.alloc)` with `layout`.
            unsafe { (&self.alloc).deallocate(self.ptr.cast::<u8>(), layout) };
        }
    }
}

impl<'a, T: fmt::Debug> fmt::Debug for BabyVec<'a, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.as_slice().fmt(f)
    }
}

impl<'a, T> core::borrow::Borrow<[T]> for BabyVec<'a, T> {
    #[inline]
    fn borrow(&self) -> &[T] {
        self.as_slice()
    }
}
impl<'a, T> AsRef<[T]> for BabyVec<'a, T> {
    #[inline]
    fn as_ref(&self) -> &[T] {
        self.as_slice()
    }
}
