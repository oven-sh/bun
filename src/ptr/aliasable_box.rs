use core::ptr::NonNull;

/// A `Box` for a value that raw pointers point into: moving a `Box` would invalidate them.
#[repr(transparent)]
pub struct AliasableBox<T>(NonNull<T>);

impl<T> AliasableBox<T> {
    pub fn new(value: T) -> Self {
        Self(bun_core::heap::alloc_nn(value))
    }

    /// # Safety
    /// As for [`Box::from_non_null`].
    pub unsafe fn from_non_null(ptr: NonNull<T>) -> Self {
        Self(ptr)
    }

    /// As [`Box::into_raw`].
    pub fn into_raw(self) -> *mut T {
        self.into_non_null().as_ptr()
    }

    /// As [`Box::into_non_null`].
    pub fn into_non_null(self) -> NonNull<T> {
        core::mem::ManuallyDrop::new(self).0
    }

    /// Invalidates the pointers into the value.
    pub fn into_box(self) -> Box<T> {
        // SAFETY: it came from a `Box`, and `self` was the only owner.
        unsafe { bun_core::heap::take(self.into_raw()) }
    }

    /// Valid until `self` is dropped.
    pub fn as_ptr(&self) -> *mut T {
        self.0.as_ptr()
    }

    /// Valid until `self` is dropped.
    pub fn as_non_null(&self) -> NonNull<T> {
        self.0
    }
}

impl<T> core::ops::Deref for AliasableBox<T> {
    type Target = T;
    fn deref(&self) -> &T {
        // SAFETY: live until `self` is dropped.
        unsafe { self.0.as_ref() }
    }
}

impl<T> core::ops::DerefMut for AliasableBox<T> {
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: as above; code that dereferences `as_ptr()` must not overlap this borrow.
        unsafe { self.0.as_mut() }
    }
}

impl<T> From<Box<T>> for AliasableBox<T> {
    fn from(value: Box<T>) -> Self {
        Self(Box::into_non_null(value))
    }
}

impl<T> Drop for AliasableBox<T> {
    fn drop(&mut self) {
        // SAFETY: it came from a `Box`, and `self` is the only owner.
        unsafe { bun_core::heap::destroy(self.0.as_ptr()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    #[test]
    fn pointer_survives_a_move() {
        let dropped = Rc::new(());
        let owner = AliasableBox::new((1u32, Rc::clone(&dropped)));
        let ptr = owner.as_ptr();
        let mut moved = vec![owner];
        (*moved[0]).0 += 1;
        // SAFETY: `moved` keeps the allocation alive, and nothing else borrows it.
        unsafe { (*ptr).0 += 1 };
        // SAFETY: as above.
        assert_eq!(unsafe { (*moved[0].as_ptr()).0 }, 3);
        drop(moved);
        assert_eq!(Rc::strong_count(&dropped), 1);
    }

    #[test]
    fn from_non_null_round_trips() {
        let dropped = Rc::new(());
        let ptr = AliasableBox::new(Rc::clone(&dropped)).into_non_null();
        assert_eq!(Rc::strong_count(&dropped), 2);
        // SAFETY: `into_non_null` gave the allocation up.
        let owner = unsafe { AliasableBox::from_non_null(ptr) };
        drop(owner.into_box());
        assert_eq!(Rc::strong_count(&dropped), 1);
    }
}
