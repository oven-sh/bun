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
        // Not dropped, so no drop glue of `T` is called.
        let _none = ManuallyDrop::new(self.replace(value));
        is_some
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
        assert!(!cell.is_some());
        assert_eq!(Rc::strong_count(&counted), 1);
    }
}
