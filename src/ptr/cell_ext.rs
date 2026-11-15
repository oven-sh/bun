use core::cell::Cell;
use core::mem::ManuallyDrop;

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
}

impl<T> OptionCellExt for Cell<Option<T>> {
    fn is_some(&self) -> bool {
        let value = self.take();
        let is_some = value.is_some();
        let _none = ManuallyDrop::new(self.replace(value));
        is_some
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    #[test]
    fn with_taken_keeps_changes() {
        let cell = Cell::new(vec![1]);
        cell.with_taken(|v| v.push(2));
        assert_eq!(cell.with_taken(|v| v.len()), 2);
        assert_eq!(cell.take(), [1, 2]);
    }

    #[test]
    fn with_taken_borrow_survives_writes_to_the_cell() {
        let cell = Cell::new(vec![1, 2, 3]);
        cell.with_taken(|v| {
            let borrowed = &v[..];
            assert!(cell.with_taken(|v| v.is_empty()));
            cell.with_taken(|v| v.extend(0..100));
            cell.set(vec![4]);
            drop(cell.take());
            assert_eq!(borrowed, [1, 2, 3]);
        });
        assert_eq!(cell.take(), [1, 2, 3]);
    }

    #[test]
    fn with_taken_drops_a_displaced_value_once() {
        let (kept, displaced) = (Rc::new(()), Rc::new(()));
        let cell = Cell::new(Some(Rc::clone(&kept)));
        cell.with_taken(|_| cell.set(Some(Rc::clone(&displaced))));
        assert_eq!(Rc::strong_count(&displaced), 1);
        assert_eq!(Rc::strong_count(&kept), 2);
        drop(cell);
        assert_eq!(Rc::strong_count(&kept), 1);
    }

    #[test]
    fn displaced_value_can_use_the_cell_in_drop() {
        struct ClearsOnDrop<'a>(&'a Cell<Option<Box<ClearsOnDrop<'a>>>>, &'a Cell<u32>);
        impl Drop for ClearsOnDrop<'_> {
            fn drop(&mut self) {
                self.1.update(|dropped| dropped + 1);
                self.0.set(None);
            }
        }
        let dropped = Cell::new(0);
        let cell = ManuallyDrop::new(Cell::new(None));
        cell.set(Some(Box::new(ClearsOnDrop(&cell, &dropped))));
        cell.with_taken(|_| cell.set(Some(Box::new(ClearsOnDrop(&cell, &dropped)))));
        assert_eq!(dropped.get(), 2);
        assert!(!cell.is_some());
    }

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
}
