//! Values kept alive, at stable addresses, for as long as their keeper.

use core::ptr::NonNull;

use crate::Guarded;

/// An append-only set of heap values: [`keep`](Self::keep) takes a value
/// and hands back a borrow that lives as long as the `KeepAlive` itself.
/// Nothing is ever removed until the whole set drops.
pub struct KeepAlive<T> {
    /// Leaked boxes (raw, so pushing/reallocating never reasserts ownership
    /// over a value already lent out); reclaimed in `Drop`.
    items: Guarded<Vec<NonNull<T>>>,
    _owns: core::marker::PhantomData<Box<T>>,
}

// SAFETY: owns its `T`s like a `Vec<Box<T>>` would.
unsafe impl<T: Send> Send for KeepAlive<T> {}
// SAFETY: `keep(&self)` moves a `T` in from, and hands `&T` out to, whichever
// thread calls it.
unsafe impl<T: Send + Sync> Sync for KeepAlive<T> {}

impl<T> Default for KeepAlive<T> {
    fn default() -> Self {
        Self {
            items: Guarded::new(Vec::new()),
            _owns: core::marker::PhantomData,
        }
    }
}

impl<T> KeepAlive<T> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Take ownership of `value`; the borrow lasts as long as `self`.
    pub fn keep(&self, value: Box<T>) -> &T {
        let ptr = NonNull::from(Box::leak(value));
        self.items.lock().push(ptr);
        // SAFETY: leaked above; freed only in `Drop`, which needs `&mut self`
        // and so outlives every borrow handed out here.
        unsafe { ptr.as_ref() }
    }
}

impl<T> Drop for KeepAlive<T> {
    fn drop(&mut self) {
        for ptr in self.items.lock().drain(..) {
            // SAFETY: from `Box::leak` in `keep`; nothing borrows it any more.
            drop(unsafe { Box::from_raw(ptr.as_ptr()) });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A kept borrow survives later keeps (the vec reallocating) and the
    /// keeper moving.
    #[test]
    fn kept_values_stay_put() {
        let keep = KeepAlive::new();
        let first: *const String = keep.keep(Box::new(String::from("a")));
        for i in 0..64 {
            keep.keep(Box::new(i.to_string()));
        }
        let moved = (keep, 1u8);
        // SAFETY: `first` is what `keep` handed out; `moved.0` still owns it.
        assert_eq!(unsafe { &*first }, "a");
        drop(moved);
    }
}
