use core::cell::Cell;
use core::mem::ManuallyDrop;
use std::collections::VecDeque;

pub trait CellExt<T> {
    /// The cell holds `T::default()` while `f` runs, and what is stored in it meanwhile is dropped.
    fn with_taken<R>(&self, f: impl FnOnce(&mut T) -> R) -> R;
}

impl<T: Default> CellExt<T> for Cell<T> {
    fn with_taken<R>(&self, f: impl FnOnce(&mut T) -> R) -> R {
        let mut value = self.take();
        let result = f(&mut value);
        self.set(value);
        result
    }
}

pub trait OptionCellExt {
    /// One load, where `with_taken` copies a large `T` out and back.
    fn is_some(&self) -> bool;

    fn is_none(&self) -> bool {
        !self.is_some()
    }
}

impl<T> OptionCellExt for Cell<Option<T>> {
    fn is_some(&self) -> bool {
        let value = self.take();
        let is_some = value.is_some();
        // Not dropped, so no drop glue of `T` is called.
        let _none = ManuallyDrop::new(self.replace(value));
        is_some
    }
}

/// Changes the `Vec` in place, where `with_taken` copies it out and back.
pub trait VecCellExt<T> {
    fn len(&self) -> usize;

    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn capacity(&self) -> usize;

    fn push(&self, value: T);

    fn pop(&self) -> Option<T>;

    fn extend_from_slice(&self, values: &[T])
    where
        T: Copy;
}

impl<T> VecCellExt<T> for Cell<Vec<T>> {
    fn len(&self) -> usize {
        self.with_taken(|vec| vec.len())
    }

    fn capacity(&self) -> usize {
        self.with_taken(|vec| vec.capacity())
    }

    fn push(&self, value: T) {
        // SAFETY: a shared `Cell` lends no reference to its value, and moving a `T` runs no code.
        unsafe { &mut *self.as_ptr() }.push(value);
    }

    fn pop(&self) -> Option<T> {
        // SAFETY: as in `push`.
        unsafe { &mut *self.as_ptr() }.pop()
    }

    fn extend_from_slice(&self, values: &[T])
    where
        T: Copy,
    {
        // SAFETY: as in `push`. `copied` does not call `T::clone`.
        unsafe { &mut *self.as_ptr() }.extend(values.iter().copied());
    }
}

/// As [`VecCellExt`].
pub trait VecDequeCellExt<T> {
    fn len(&self) -> usize;

    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn push_back(&self, value: T);

    fn push_front(&self, value: T);

    fn pop_front(&self) -> Option<T>;
}

impl<T> VecDequeCellExt<T> for Cell<VecDeque<T>> {
    fn len(&self) -> usize {
        // SAFETY: a shared `Cell` lends no reference to its value.
        unsafe { &*self.as_ptr() }.len()
    }

    fn push_back(&self, value: T) {
        // SAFETY: as in `len`, and moving a `T` runs no code.
        unsafe { &mut *self.as_ptr() }.push_back(value);
    }

    fn push_front(&self, value: T) {
        // SAFETY: as in `push_back`.
        unsafe { &mut *self.as_ptr() }.push_front(value);
    }

    fn pop_front(&self) -> Option<T> {
        // SAFETY: as in `push_back`.
        unsafe { &mut *self.as_ptr() }.pop_front()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    #[test]
    fn is_some_leaves_the_value() {
        let counted = Rc::new(());
        let cell = Cell::new(Some(Rc::clone(&counted)));
        assert!(cell.is_some());
        assert_eq!(Rc::strong_count(&counted), 2);
        cell.set(None);
        assert!(cell.is_none());
        assert_eq!(Rc::strong_count(&counted), 1);
    }

    #[test]
    fn vec_changes_in_place() {
        let cell = Cell::new(Vec::new());
        assert!(cell.is_empty());
        cell.push(1u8);
        cell.extend_from_slice(&[2, 3]);
        assert_eq!(cell.pop(), Some(3));
        assert_eq!(cell.len(), 2);
        assert!(cell.capacity() >= 3);
        assert_eq!(cell.take(), [1, 2]);
    }

    #[test]
    fn vec_deque_changes_in_place() {
        let cell = Cell::new(VecDeque::new());
        assert!(cell.is_empty());
        cell.push_back(Box::new(2));
        cell.push_front(Box::new(1));
        assert_eq!(cell.len(), 2);
        assert_eq!(cell.pop_front(), Some(Box::new(1)));
        assert_eq!(cell.take(), [Box::new(2)]);
    }

    #[test]
    fn extend_from_slice_does_not_call_clone() {
        #[derive(Copy)]
        struct Panics;
        impl Clone for Panics {
            fn clone(&self) -> Self {
                unreachable!()
            }
        }
        let cell = Cell::new(Vec::new());
        cell.extend_from_slice(&[Panics, Panics]);
        assert_eq!(cell.len(), 2);
    }
}
