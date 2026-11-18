//! Allocation that fails with an error, for what grows with the module.

use std::collections::TryReserveError;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct OutOfMemory;

impl From<TryReserveError> for OutOfMemory {
    fn from(_: TryReserveError) -> Self {
        Self
    }
}

pub(crate) trait TryPush<T> {
    fn try_push(&mut self, item: T) -> Result<(), OutOfMemory>;
}

impl<T> TryPush<T> for Vec<T> {
    #[inline(always)]
    fn try_push(&mut self, item: T) -> Result<(), OutOfMemory> {
        if self.len() == self.capacity() {
            grow(self)?;
        }
        self.push(item);
        Ok(())
    }
}

#[cold]
#[inline(never)]
fn grow<T>(vec: &mut Vec<T>) -> Result<(), OutOfMemory> {
    Ok(vec.try_reserve(1)?)
}

/// Leaves it as it is if there is no memory for the move.
pub(crate) fn shrink<T>(vec: &mut Vec<T>) {
    let mut exact = Vec::new();
    if vec.capacity() - vec.len() > vec.len() / 8 && exact.try_reserve_exact(vec.len()).is_ok() {
        exact.append(vec);
        *vec = exact;
    }
}

pub(crate) fn try_boxed<T>(
    items: impl ExactSizeIterator<Item = T>,
) -> Result<Box<[T]>, OutOfMemory> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(items.len())?;
    vec.extend(items);
    Ok(vec.into_boxed_slice())
}
