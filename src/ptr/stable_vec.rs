//! Heap values at stable addresses whose pointers are handed to foreign code
//! (C++, other threads) while their owner keeps using them by index.
//!
//! A `Vec<Box<T>>` is not enough for that: every access through the `Box`
//! reasserts unique ownership of the pointee and invalidates the pointer that
//! was handed out. [`StableVec`] keeps leaked pointers instead and goes
//! through the same pointer for its own accesses; the boxes are reclaimed when
//! the collection drops.

use core::ptr::NonNull;

/// See the module doc.
pub struct StableVec<T> {
    items: Vec<NonNull<T>>,
    _owns: core::marker::PhantomData<Box<T>>,
}

impl<T> Default for StableVec<T> {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            _owns: core::marker::PhantomData,
        }
    }
}

impl<T> StableVec<T> {
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Take ownership of `value`; its address stays fixed until `self` drops.
    pub fn push(&mut self, value: Box<T>) -> usize {
        self.items.push(NonNull::from(Box::leak(value)));
        self.items.len() - 1
    }

    /// The address handed out for `index` (what foreign code holds).
    #[inline]
    pub fn ptr(&self, index: usize) -> NonNull<T> {
        self.items[index]
    }

    #[inline]
    pub fn get(&self, index: usize) -> &T {
        // SAFETY: leaked in `push`, freed only in `Drop`.
        unsafe { self.items[index].as_ref() }
    }

    /// Exclusive access to `index`. The owner's obligation: foreign holders
    /// of the pointer do not access the value concurrently with this borrow.
    #[inline]
    pub fn get_mut(&mut self, index: usize) -> &mut T {
        // SAFETY: as `get`; `&mut self` makes it exclusive on this side.
        unsafe { self.items[index].as_mut() }
    }

    /// Drop every value (their pointers must no longer be held).
    pub fn clear(&mut self) {
        for ptr in self.items.drain(..) {
            // SAFETY: from `Box::leak` in `push`; nothing holds it any more.
            drop(unsafe { Box::from_raw(ptr.as_ptr()) });
        }
    }
}

impl<T> Drop for StableVec<T> {
    fn drop(&mut self) {
        self.clear();
    }
}
