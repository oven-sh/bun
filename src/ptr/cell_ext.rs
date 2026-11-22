use core::cell::Cell;
use core::mem::ManuallyDrop;

pub trait CellExt<T> {
    /// The cell holds `T::default()` while `f` runs, and what is stored in it meanwhile is dropped.
    fn with_taken<R>(&self, f: impl FnOnce(&mut T) -> R) -> R;

    /// `set` after a `take()`, without the drop glue of `T`: what was stored meanwhile is leaked.
    fn put_back(&self, value: T);
}

impl<T: Default> CellExt<T> for Cell<T> {
    fn with_taken<R>(&self, f: impl FnOnce(&mut T) -> R) -> R {
        let mut value = self.take();
        let result = f(&mut value);
        self.set(value);
        result
    }

    fn put_back(&self, value: T) {
        let _default = ManuallyDrop::new(self.replace(value));
    }
}

pub trait OptionCellExt {
    /// One load, where `with_taken` copies a large `T` out and back.
    fn is_some(&self) -> bool;
}

impl<T> OptionCellExt for Cell<Option<T>> {
    fn is_some(&self) -> bool {
        let value = self.take();
        let is_some = value.is_some();
        self.put_back(value);
        is_some
    }
}

/// Reads and changes the `Vec` without the copies and the drop glue of `with_taken`.
pub trait VecCellExt<T> {
    fn len(&self) -> usize;

    fn capacity(&self) -> usize;

    fn extend_from_slice(&self, values: &[T])
    where
        T: Copy;

    fn clear(&self)
    where
        T: Copy;
}

impl<T> VecCellExt<T> for Cell<Vec<T>> {
    fn len(&self) -> usize {
        // SAFETY: a shared `Cell` lends no reference to its value.
        unsafe { &*self.as_ptr() }.len()
    }

    fn capacity(&self) -> usize {
        // SAFETY: as in `len`.
        unsafe { &*self.as_ptr() }.capacity()
    }

    fn extend_from_slice(&self, values: &[T])
    where
        T: Copy,
    {
        loop {
            // SAFETY: as in `len`, and the new length covers what was just written.
            unsafe {
                let vec = &mut *self.as_ptr();
                if let Some(spare) = vec.spare_capacity_mut().get_mut(..values.len()) {
                    spare.write_copy_of_slice(values);
                    return vec.set_len(vec.len() + values.len());
                }
            }
            reserve_vec(self, values.len());
        }
    }

    fn clear(&self)
    where
        T: Copy,
    {
        // SAFETY: as in `len`, and a `Copy` `T` has no drop glue.
        unsafe { &mut *self.as_ptr() }.clear();
    }
}

/// Taken, because the panic hook runs if this fails.
#[cold]
fn reserve_vec<T>(cell: &Cell<Vec<T>>, additional: usize) {
    cell.with_taken(|vec| vec.reserve(additional));
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
        assert!(!cell.is_some());
        assert_eq!(Rc::strong_count(&counted), 1);
    }

    #[test]
    fn vec_changes_in_place() {
        let cell = Cell::new(Vec::new());
        assert_eq!(cell.len(), 0);
        cell.extend_from_slice(&[1u8]);
        cell.extend_from_slice(&[2, 3]);
        assert_eq!(cell.len(), 3);
        assert!(cell.capacity() >= 3);
        assert_eq!(cell.take(), [1, 2, 3]);
    }

    #[test]
    fn clear_keeps_the_capacity() {
        let cell = Cell::new(vec![1u8, 2, 3]);
        cell.clear();
        assert_eq!(cell.len(), 0);
        assert!(cell.capacity() >= 3);
    }
}
