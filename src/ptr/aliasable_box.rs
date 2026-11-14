use core::ptr::NonNull;

/// A `Box` for a value that raw pointers point into: moving a `Box` would invalidate them.
#[repr(transparent)]
pub struct AliasableBox<T>(NonNull<T>);

impl<T> AliasableBox<T> {
    pub fn new(value: T) -> Self {
        Self(bun_core::heap::alloc_nn(value))
    }

    /// Valid until `self` is dropped.
    pub fn as_ptr(&self) -> *mut T {
        self.0.as_ptr()
    }
}

impl<T> Drop for AliasableBox<T> {
    fn drop(&mut self) {
        // SAFETY: `new` allocated it, and `self` is the only owner.
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
        let moved = vec![owner];
        // SAFETY: `moved` keeps the allocation alive, and nothing else borrows it.
        unsafe { (*ptr).0 += 1 };
        // SAFETY: as above.
        assert_eq!(unsafe { (*moved[0].as_ptr()).0 }, 2);
        drop(moved);
        assert_eq!(Rc::strong_count(&dropped), 1);
    }
}
