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

#[cfg(test)]
mod tests {
    use super::*;

    /// The pointer handed out for an element stays usable while the owner
    /// keeps writing to the element by index and the collection itself
    /// moves and grows.
    #[test]
    fn foreign_pointer_survives_owner_access_and_moves() {
        let mut v = StableVec::new();
        let i = v.push(Box::new(1u32));
        let foreign = v.ptr(i);
        for n in 0..64u32 {
            v.push(Box::new(n));
        }
        let mut moved = (v, ());
        *moved.0.get_mut(i) += 1;
        // SAFETY: what the foreign holder does with the address it was handed.
        unsafe { *foreign.as_ptr() += 1 };
        assert_eq!(*moved.0.get(i), 3);
        // SAFETY: as above.
        assert_eq!(unsafe { *foreign.as_ptr() }, 3);
    }

    struct Request {
        this: Option<NonNull<Request>>,
        hits: u32,
    }

    /// The shape plugin requests use: the element records its own stable
    /// pointer when pushed, and a holder that only has `&mut self` hands
    /// *that* out (not a pointer re-derived from the `&mut`), so the owner's
    /// later `get_mut` does not invalidate what the foreign side holds.
    #[test]
    fn pointer_recorded_at_push_survives_owner_get_mut() {
        let mut v = StableVec::new();
        let i = v.push(Box::new(Request {
            this: None,
            hits: 0,
        }));
        let this = v.ptr(i);
        v.get_mut(i).this = Some(this);
        // What `run_on_js_thread(&mut self)` hands to C++:
        let handed_out: *mut Request = {
            let me: &mut Request = v.get_mut(i);
            me.this.expect("set at push").as_ptr()
        };
        v.get_mut(i).hits += 1; // the owner, later (`on_notify_defer`)
        // SAFETY: the foreign side answering through the pointer it was handed.
        unsafe { (*handed_out).hits += 1 };
        assert_eq!(v.get(i).hits, 2);
    }

    /// The hazard the previous test avoids: a pointer re-derived from a
    /// `&mut` into the element is a child of that borrow, and the owner's
    /// next `get_mut` invalidates it. (Run under Miri to see it rejected.)
    #[test]
    #[ignore = "demonstrates UB; `cargo miri test -- --ignored` rejects it"]
    fn pointer_derived_from_a_borrow_does_not_survive_owner_get_mut() {
        let mut v = StableVec::new();
        let i = v.push(Box::new(Request {
            this: None,
            hits: 0,
        }));
        let handed_out: *mut Request = {
            let me: &mut Request = v.get_mut(i);
            core::ptr::from_mut(me)
        };
        v.get_mut(i).hits += 1;
        // SAFETY: none — this is the invalidated access.
        unsafe { (*handed_out).hits += 1 };
        assert_eq!(v.get(i).hits, 2);
    }
}
