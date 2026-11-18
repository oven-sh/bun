use core::cell::{RefCell, RefMut};
use core::mem::ManuallyDrop;

/// A table of a thread. It is on the heap, because every thread pays for what a `#[thread_local]` holds itself.
pub(crate) struct Recent<T, const N: usize>(ManuallyDrop<RefCell<Option<Box<[T; N]>>>>);

impl<T: Default, const N: usize> Recent<T, N> {
    pub(crate) const fn new() -> Self {
        Recent(ManuallyDrop::new(RefCell::new(None)))
    }

    #[inline]
    pub(crate) fn borrow_mut(&self) -> RefMut<'_, [T; N]> {
        RefMut::map(self.0.borrow_mut(), |it| {
            &mut **it.get_or_insert_with(Self::empty)
        })
    }

    #[cold]
    fn empty() -> Box<[T; N]> {
        Box::new(core::array::from_fn(|_| T::default()))
    }

    pub(crate) fn forget(&self) {
        drop(self.0.take());
    }
}
