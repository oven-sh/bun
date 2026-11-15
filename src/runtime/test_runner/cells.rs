//! State that script can reach is only ever shared, so what isn't `Copy` is moved out of its `Cell` to be used.

use core::cell::Cell;

use bun_jsc::{JSValue, Strong};

pub(crate) trait CellExt<T> {
    /// The cell holds `T::default()` while `f` runs, and what is stored in it meanwhile is lost: `f` must not run script.
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

#[derive(Default)]
pub(crate) struct StrongCell(Cell<Option<Strong>>);

impl From<Option<Strong>> for StrongCell {
    fn from(value: Option<Strong>) -> StrongCell {
        StrongCell(Cell::new(value))
    }
}

impl StrongCell {
    pub(crate) fn get(&self) -> Option<JSValue> {
        self.0.with_taken(|value| value.as_ref().map(Strong::get))
    }

    pub(crate) fn is_some(&self) -> bool {
        self.0.with_taken(|value| value.is_some())
    }

    pub(crate) fn set(&self, value: Strong) {
        self.0.set(Some(value));
    }

    pub(crate) fn clear(&self) {
        self.0.set(None);
    }
}
