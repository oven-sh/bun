//! `ArenaBox<'a, T>` — an owning pointer to one block of a [`MimallocArena`],
//! as wide as `Box<T>`: 8 B for a sized `T`, 16 B for a slice.
//!
//! `Box<T, &'a MimallocArena>` stores the allocator handle next to the pointer
//! (16 B / 24 B). The handle is only needed to allocate: `mi_free` finds the
//! heap of a block from its address, which `<&MimallocArena as
//! Allocator>::deallocate` and [`crate::transfer_arena`] already rely on. So an
//! `ArenaBox` is allocated through an arena that is passed in, and frees its
//! block without one. The lifetime keeps it from outliving the arena.
//!
//! Dropping it drops the value and returns the block to the heap at once, from
//! any thread. What is still allocated when the arena is dropped is bulk-freed
//! without `Drop`, like everything else in an arena.
//!
//! Not `Clone`, because a clone has to be allocated: see
//! [`ArenaBox::copy_from_slice_in`].

use core::alloc::{AllocError, Allocator, Layout};
use core::borrow::Borrow;
use core::fmt;
use core::hash::{Hash, Hasher};
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

use crate::{BabyVec, MimallocArena};

/// Frees a block of any [`MimallocArena`], and allocates nothing. Zero-sized.
///
/// Private, and not `Clone`: `Box<T, A>: Clone` would allocate through it.
struct FreesOnly<'a>(PhantomData<&'a MimallocArena>);

// SAFETY:
// - `allocate` always fails, which the contract allows. `grow` and `shrink`
//   keep their default bodies, which begin with `allocate`, so they fail too
//   and leave the block as it is.
// - `deallocate` is that of `&MimallocArena`. The only blocks it is given are
//   those of `ArenaBox::from_box`.
unsafe impl Allocator for FreesOnly<'_> {
    #[inline]
    fn allocate(&self, _: Layout) -> Result<NonNull<[u8]>, AllocError> {
        Err(AllocError)
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        // SAFETY: caller contract — `ptr` is a block that an arena allocated
        // with `layout`. `mi_free` is thread-safe.
        unsafe { crate::basic::mi_free_checked(ptr.as_ptr().cast(), layout.size(), layout.align()) }
    }
}

/// See the module doc.
pub struct ArenaBox<'a, T: ?Sized>(Box<T, FreesOnly<'a>>);

const _: () = assert!(size_of::<ArenaBox<'static, u64>>() == 8);
const _: () = assert!(size_of::<ArenaBox<'static, [u64]>>() == 16);
const _: () = assert!(size_of::<Option<ArenaBox<'static, [u64]>>>() == 16);

impl<'a, T: ?Sized> ArenaBox<'a, T> {
    /// Drops the allocator handle of a box. Nothing is copied.
    #[inline]
    pub fn from_box(boxed: Box<T, &'a MimallocArena>) -> Self {
        let (raw, _) = Box::into_raw_with_allocator(boxed);
        // SAFETY: `raw` is the block of a box, which an arena that lives for
        // `'a` allocated, and `FreesOnly` frees it as that arena would.
        ArenaBox(unsafe { Box::from_raw_in(raw, FreesOnly(PhantomData)) })
    }
}

impl<'a, T> ArenaBox<'a, T> {
    #[inline]
    pub fn new_in(value: T, arena: &'a MimallocArena) -> Self {
        Self::from_box(Box::new_in(value, arena))
    }
}

impl<'a, T> ArenaBox<'a, [T]> {
    /// No block.
    #[inline]
    pub fn empty() -> Self {
        // A zero-sized value is not allocated.
        ArenaBox(Box::<[T; 0], _>::new_in([], FreesOnly(PhantomData)))
    }

    /// One block of exactly the size of `items`, or none if there are none.
    #[inline]
    pub fn copy_from_slice_in(items: &[T], arena: &'a MimallocArena) -> Self
    where
        T: Copy,
    {
        let mut list = Vec::with_capacity_in(items.len(), arena);
        list.extend_from_slice(items);
        Self::from_box(list.into_boxed_slice())
    }

    /// If the iterator reports its exact length, one block of exactly that
    /// size. Otherwise the block is resized at the end.
    #[inline]
    pub fn from_iter_in(items: impl IntoIterator<Item = T>, arena: &'a MimallocArena) -> Self {
        let items = items.into_iter();
        let mut list = Vec::with_capacity_in(items.size_hint().0, arena);
        list.extend(items);
        Self::from_box(list.into_boxed_slice())
    }
}

impl<T> Default for ArenaBox<'_, [T]> {
    #[inline]
    fn default() -> Self {
        Self::empty()
    }
}

impl<'a, T> From<Vec<T, &'a MimallocArena>> for ArenaBox<'a, [T]> {
    /// The block is resized if the vector has spare capacity.
    #[inline]
    fn from(list: Vec<T, &'a MimallocArena>) -> Self {
        Self::from_box(list.into_boxed_slice())
    }
}

impl<'a, T> From<BabyVec<'a, T>> for ArenaBox<'a, [T]> {
    /// The block is resized if the vector has spare capacity.
    #[inline]
    fn from(list: BabyVec<'a, T>) -> Self {
        Self::from_box(list.into_boxed_slice())
    }
}

impl<T: ?Sized> Deref for ArenaBox<'_, T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T: ?Sized> DerefMut for ArenaBox<'_, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        &mut self.0
    }
}

impl<T: ?Sized> AsRef<T> for ArenaBox<'_, T> {
    #[inline]
    fn as_ref(&self) -> &T {
        self
    }
}

impl<T: ?Sized> Borrow<T> for ArenaBox<'_, T> {
    #[inline]
    fn borrow(&self) -> &T {
        self
    }
}

impl<T: ?Sized + fmt::Debug> fmt::Debug for ArenaBox<'_, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        (**self).fmt(f)
    }
}

impl<T: ?Sized + PartialEq> PartialEq for ArenaBox<'_, T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}

impl<T: ?Sized + Eq> Eq for ArenaBox<'_, T> {}

impl<T: ?Sized + Hash> Hash for ArenaBox<'_, T> {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        (**self).hash(state);
    }
}

impl<'v, T> IntoIterator for &'v ArenaBox<'_, [T]> {
    type Item = &'v T;
    type IntoIter = core::slice::Iter<'v, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<'v, T> IntoIterator for &'v mut ArenaBox<'_, [T]> {
    type Item = &'v mut T;
    type IntoIter = core::slice::IterMut<'v, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter_mut()
    }
}

// ── `BabyVec`, compared and hashed as the slice it holds, like `Vec` ────────

impl<T: PartialEq> PartialEq for BabyVec<'_, T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.as_slice() == other.as_slice()
    }
}

impl<T: Eq> Eq for BabyVec<'_, T> {}

impl<T: Hash> Hash for BabyVec<'_, T> {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.as_slice().hash(state);
    }
}
