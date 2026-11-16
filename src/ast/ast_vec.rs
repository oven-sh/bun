//! `Vec` and `Box` in an [`AstArena`]. They do not store the arena: methods that allocate take it.

use core::alloc::Layout;
use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

use crate::{AstArena, StoreSlice};

/// Not generic, so that `grow` and `with_capacity_in` are compiled once.
struct RawAstVec {
    ptr: NonNull<u8>,
    len: u32,
    cap: u32,
}

// SAFETY: only `AstVec<T>` holds a `RawAstVec`. It owns its items as `Vec<T>` does, and its `PhantomData`
// requires `T: Send`.
unsafe impl Send for RawAstVec {}
// SAFETY: as for `Send`, with `T: Sync`. `&AstVec<T>` only hands out `&T`.
unsafe impl Sync for RawAstVec {}

impl RawAstVec {
    #[inline]
    fn layout(item: Layout, cap: usize) -> (Layout, u32) {
        match (item.repeat_packed(cap), u32::try_from(cap)) {
            (Ok(layout), Ok(cap)) => (layout, cap),
            _ => bun_alloc::out_of_memory(),
        }
    }

    #[inline(never)]
    fn with_capacity_in(cap: usize, item: Layout, arena: &AstArena) -> RawAstVec {
        let (layout, cap) = RawAstVec::layout(item, cap);
        RawAstVec {
            ptr: arena.alloc_layout(layout),
            len: 0,
            cap,
        }
    }

    /// # Safety
    /// `item` is the layout that `self` was allocated for.
    #[inline(never)]
    unsafe fn grow(&mut self, arena: &AstArena, item: Layout, additional: usize) {
        // The growth policy of `Vec`.
        let min_cap = match item.size() {
            1 => 8,
            ..=1024 => 4,
            _ => 1,
        };
        let doubled = (self.cap as usize * 2).min(u32::MAX as usize);
        let cap = (self.len as usize).saturating_add(additional);
        let (layout, cap) = RawAstVec::layout(item, cap.max(doubled).max(min_cap));
        // SAFETY: `ptr` is an arena allocation of `self.cap` items, or `self.cap` is 0. `cap >= self.cap`.
        self.ptr = unsafe { arena.grow(self.ptr, item.size() * self.cap as usize, layout) };
        self.cap = cap;
    }
}

/// Items are never dropped. An outgrown buffer is freed when the arena resets.
pub struct AstVec<'a, T> {
    /// `ptr` is aligned for `T` and valid for `cap` items during `'a`. The first `len` are initialized.
    buf: RawAstVec,
    _marker: PhantomData<(&'a (), T)>,
}

const _: () = assert!(size_of::<AstVec<u64>>() == 16);

impl<'a, T> AstVec<'a, T> {
    #[inline]
    pub const fn new() -> Self {
        const { assert!(!core::mem::needs_drop::<T>()) };
        AstVec {
            buf: RawAstVec {
                ptr: NonNull::<T>::dangling().cast(),
                len: 0,
                cap: 0,
            },
            _marker: PhantomData,
        }
    }

    #[inline]
    pub fn with_capacity_in(capacity: usize, arena: &'a AstArena) -> Self {
        let mut list = Self::new();
        if capacity > 0 {
            list.buf = RawAstVec::with_capacity_in(capacity, Layout::new::<T>(), arena);
        }
        list
    }

    #[inline]
    pub fn from_slice_in(items: &[T], arena: &'a AstArena) -> Self
    where
        T: Copy,
    {
        let (layout, len) = RawAstVec::layout(Layout::new::<T>(), items.len());
        let mut list = Self::new();
        list.buf.ptr = arena.alloc_layout(layout);
        list.buf.cap = len;
        list.spare_capacity_mut().write_copy_of_slice(items);
        list.buf.len = len;
        list
    }

    pub fn from_iter_in(items: impl IntoIterator<Item = T>, arena: &'a AstArena) -> Self {
        let items = items.into_iter();
        let mut list = Self::with_capacity_in(items.size_hint().0, arena);
        list.extend(arena, items);
        list
    }

    #[inline]
    pub fn len_u32(&self) -> u32 {
        self.buf.len
    }

    #[inline]
    pub(crate) fn capacity(&self) -> usize {
        self.buf.cap as usize
    }

    #[inline]
    pub fn slice(&self) -> &[T] {
        // SAFETY: the first `len` items are initialized.
        unsafe {
            NonNull::slice_from_raw_parts(self.buf.ptr.cast(), self.buf.len as usize).as_ref()
        }
    }

    #[inline]
    pub fn slice_mut(&mut self) -> &mut [T] {
        // SAFETY: the first `len` items are initialized, and `self` owns them.
        unsafe {
            NonNull::slice_from_raw_parts(self.buf.ptr.cast(), self.buf.len as usize).as_mut()
        }
    }

    #[inline]
    fn spare_capacity_mut(&mut self) -> &mut [MaybeUninit<T>] {
        let RawAstVec { ptr, len, cap } = self.buf;
        // SAFETY: `ptr` is valid for `cap` items, and `len <= cap`.
        unsafe {
            NonNull::slice_from_raw_parts(ptr.cast().add(len as usize), (cap - len) as usize)
                .as_mut()
        }
    }

    #[inline]
    pub fn at(&self, index: usize) -> &T {
        &self[index]
    }

    #[inline]
    pub fn mut_(&mut self, index: usize) -> &mut T {
        &mut self[index]
    }

    #[inline]
    pub fn reserve(&mut self, arena: &'a AstArena, additional: usize) {
        if additional > (self.buf.cap - self.buf.len) as usize {
            // SAFETY: every allocation of `self.buf` uses the layout of `T`.
            unsafe { self.buf.grow(arena, Layout::new::<T>(), additional) };
        }
    }

    #[inline]
    pub fn push(&mut self, arena: &'a AstArena, item: T) {
        self.reserve(arena, 1);
        // SAFETY: `len < cap` after `reserve`.
        unsafe { self.buf.ptr.cast::<T>().add(self.len()).write(item) };
        self.buf.len += 1;
    }

    #[inline]
    pub fn extend_from_slice(&mut self, arena: &'a AstArena, items: &[T])
    where
        T: Copy,
    {
        self.reserve(arena, items.len());
        self.spare_capacity_mut()[..items.len()].write_copy_of_slice(items);
        self.buf.len += items.len() as u32;
    }

    pub fn extend(&mut self, arena: &'a AstArena, items: impl IntoIterator<Item = T>) {
        let items = items.into_iter();
        self.reserve(arena, items.size_hint().0);
        for item in items {
            self.push(arena, item);
        }
    }

    #[inline]
    pub(crate) fn pop(&mut self) -> Option<T> {
        self.buf.len = self.buf.len.checked_sub(1)?;
        // SAFETY: the item at the new `len` is initialized, and no longer part of the list.
        Some(unsafe { self.spare_capacity_mut()[0].assume_init_read() })
    }

    #[inline]
    pub fn remove(&mut self, index: usize) -> T
    where
        T: Copy,
    {
        let item = self[index];
        self.copy_within(index + 1.., index);
        self.buf.len -= 1;
        item
    }

    #[inline]
    pub(crate) fn swap_remove(&mut self, index: usize) -> T {
        let last = self.len().wrapping_sub(1);
        self.swap(index, last);
        self.pop().expect("index is in bounds")
    }

    #[inline]
    pub fn truncate(&mut self, len: usize) {
        self.buf.len = len.min(self.len()) as u32;
    }

    #[inline]
    pub fn clear(&mut self) {
        self.buf.len = 0;
    }

    pub fn retain(&mut self, mut keep: impl FnMut(&T) -> bool) {
        let mut kept = 0;
        for i in 0..self.len() {
            if keep(&self[i]) {
                self.swap(kept, i);
                kept += 1;
            }
        }
        self.truncate(kept);
    }

    #[inline]
    pub fn leak(self) -> &'a mut [T] {
        // SAFETY: the first `len` items are initialized and valid for `'a`, and `self` gives them up.
        unsafe {
            NonNull::slice_from_raw_parts(self.buf.ptr.cast(), self.buf.len as usize).as_mut()
        }
    }

    #[inline]
    pub fn into_store_slice(self) -> StoreSlice<'a, T> {
        StoreSlice::new_mut(self.leak())
    }
}

impl<T> Default for AstVec<'_, T> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<T> Deref for AstVec<'_, T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        self.slice()
    }
}

impl<T> DerefMut for AstVec<'_, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [T] {
        self.slice_mut()
    }
}

impl<'a, T> IntoIterator for &'a AstVec<'_, T> {
    type Item = &'a T;
    type IntoIter = core::slice::Iter<'a, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<'a, T> IntoIterator for &'a mut AstVec<'_, T> {
    type Item = &'a mut T;
    type IntoIter = core::slice::IterMut<'a, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter_mut()
    }
}

/// The value is never dropped. Covariant in `T`, unlike [`crate::StoreRef`], because it is not `Copy`.
#[repr(C, packed(4))]
pub struct AstBox<'a, T>(NonNull<T>, PhantomData<(&'a (), T)>);

// SAFETY: it owns its value as `Box<T>` does.
unsafe impl<T: Send> Send for AstBox<'_, T> {}
// SAFETY: as for `Send`. `&AstBox<T>` only hands out `&T`.
unsafe impl<T: Sync> Sync for AstBox<'_, T> {}

impl<'a, T> AstBox<'a, T> {
    #[inline]
    pub fn new_in(value: T, arena: &'a AstArena) -> Self {
        const { assert!(!core::mem::needs_drop::<T>()) };
        AstBox(
            NonNull::from(arena.alloc_node(value).into_mut()),
            PhantomData,
        )
    }
}

impl<T> Deref for AstBox<'_, T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: the value is valid for `'a`, and `self` has the only pointer to it.
        unsafe { &*self.0.as_ptr() }
    }
}

impl<T> DerefMut for AstBox<'_, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: as for `deref`.
        unsafe { &mut *self.0.as_ptr() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_keeps_items_when_the_buffer_moves() {
        let arena = AstArena::new();
        let (mut a, mut b) = (AstVec::new(), AstVec::new());
        for i in 0..2000u32 {
            a.push(&arena, i);
            b.push(&arena, [i as u8; 3]);
        }
        assert!(a.iter().copied().eq(0..2000));
        assert!(b.iter().copied().eq((0..2000u32).map(|i| [i as u8; 3])));
    }

    #[test]
    fn last_allocation_grows_in_place() {
        let arena = AstArena::new();
        let mut list = AstVec::from_slice_in(b"abc", &arena);
        let start = list.as_ptr();
        list.extend_from_slice(&arena, &[b'd'; 100]);
        assert_eq!(list.as_ptr(), start);

        let node = arena.alloc_node(1u64);
        list.extend_from_slice(&arena, &[b'e'; 100]);
        assert_ne!(list.as_ptr(), start);
        assert_eq!((&list[..4], list.len(), *node), (&b"abcd"[..], 203, 1));
    }

    #[test]
    fn list_can_grow_in_another_arena() {
        let (first, second) = (AstArena::new(), AstArena::new());
        let mut list = AstVec::from_slice_in(&[1u64, 2], &first);
        list.push(&second, 3);
        assert_eq!(*list, [1, 2, 3]);
    }

    #[test]
    fn empty_list_does_not_allocate() {
        let arena = AstArena::new();
        let before = arena.alloc_node(1u64);
        let mut list = AstVec::<u64>::from_slice_in(&[], &arena);
        list.extend(&arena, []);
        assert_eq!(list.capacity(), 0);
        assert_eq!(arena.dupe_str(b"").slice(), b"");
        let after = arena.alloc_node(2u64);
        assert_eq!(after.as_ptr(), before.as_ptr().wrapping_add(1));
    }

    #[test]
    fn removals_match_vec() {
        let arena = AstArena::new();
        let mut expected: Vec<u32> = (0..10).collect();
        let mut list = AstVec::from_iter_in(0..10, &arena);
        assert_eq!(list.remove(2), expected.remove(2));
        assert_eq!(list.remove(8), expected.remove(8));
        assert_eq!(list.swap_remove(1), expected.swap_remove(1));
        assert_eq!(list.swap_remove(6), expected.swap_remove(6));
        list.retain(|&item| item != 4);
        expected.retain(|&item| item != 4);
        assert_eq!(*list, *expected);
        list.truncate(9);
        assert_eq!(*list, *expected);
        list.truncate(2);
        assert_eq!(*list, expected[..2]);
    }

    #[test]
    #[should_panic]
    fn remove_panics_at_len() {
        let arena = AstArena::new();
        AstVec::from_slice_in(&[1u8], &arena).remove(1);
    }
}
