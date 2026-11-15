use core::cell::Cell;

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
