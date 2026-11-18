use core::sync::atomic::{AtomicPtr, Ordering};

use super::{Trace, Visitor};

/// A box that is made on demand and then stays, so that a marker can read it at any time.
#[repr(transparent)]
#[cfg_attr(
    rootcheck,
    rootcheck::allow("made empty, and what is `Trace` changes only through its owner")
)]
pub struct OnceBox<T>(AtomicPtr<T>, core::marker::PhantomData<Box<T>>);

impl<T> Default for OnceBox<T> {
    fn default() -> OnceBox<T> {
        OnceBox::new()
    }
}

impl<T> OnceBox<T> {
    pub const fn new() -> OnceBox<T> {
        OnceBox(
            AtomicPtr::new(core::ptr::null_mut()),
            core::marker::PhantomData,
        )
    }

    #[inline(always)]
    pub fn get(&self) -> Option<&T> {
        // SAFETY: null, or a box that lives as long as `self`.
        unsafe { self.0.load(Ordering::Acquire).as_ref() }
    }

    #[inline]
    #[cfg_attr(rootcheck, rootcheck::allow("the box becomes the content"))]
    pub fn get_or_default(&self) -> &T
    where
        T: Default + Trace,
    {
        if let Some(value) = self.get() {
            return value;
        }
        let value = Box::leak(Box::<T>::default());
        let old = self.0.swap(value, Ordering::Release);
        assert!(old.is_null());
        value
    }
}

impl<T> Drop for OnceBox<T> {
    fn drop(&mut self) {
        let value = *self.0.get_mut();
        if !value.is_null() {
            // SAFETY: leaked by `get_or_default`.
            drop(unsafe { Box::from_raw(value) });
        }
    }
}

// SAFETY: visits the content.
unsafe impl<T: Trace> Trace for OnceBox<T> {
    #[inline]
    fn trace(&self, visitor: &mut Visitor) {
        if let Some(value) = self.get() {
            value.trace(visitor);
        }
    }
}
