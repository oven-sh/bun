//! Indexing of slices that cannot panic.

use core::cell::Cell;
use core::slice::SliceIndex;

use crate::error::{Error, Result};

thread_local! {
    static WAS_WRONG: Cell<bool> = const { Cell::new(false) };
}

/// What `run` returns, unless something that was `known()` to be there was not.
pub(crate) fn checked<T>(run: impl FnOnce() -> Result<T>) -> Result<T> {
    WAS_WRONG.set(false);
    let result = run();
    if WAS_WRONG.get() {
        return Err(Error::Internal);
    }
    result
}

/// For what no input can make `None`. The caller goes on without it, and `checked()` fails.
#[inline(always)]
pub(crate) fn known<T>(found: Option<T>) -> Option<T> {
    #[cold]
    #[inline(never)]
    fn was_wrong() {
        WAS_WRONG.set(true);
    }
    debug_assert!(found.is_some() || cfg!(test));
    if found.is_none() {
        was_wrong();
    }
    found
}

/// For positions that are `known()` to be in bounds. What is read from others is empty or the default, and nothing is
/// written to them.
pub(crate) trait InBounds<T> {
    fn part(&self, range: impl SliceIndex<[T], Output = [T]>) -> &[T];
    fn part_mut(&mut self, range: impl SliceIndex<[T], Output = [T]>) -> &mut [T];
    fn update<R: Default>(&mut self, index: usize, change: impl FnOnce(&mut T) -> R) -> R;
    fn set(&mut self, index: usize, value: T);
    fn set_chunk<const N: usize>(&mut self, start: usize, values: [T; N]);
    fn value(&self, index: usize) -> T
    where
        T: Copy + Default;
    fn chunk<const N: usize>(&self, start: usize) -> [T; N]
    where
        [T; N]: Copy + Default;
}

impl<T> InBounds<T> for [T] {
    #[inline(always)]
    fn part(&self, range: impl SliceIndex<[T], Output = [T]>) -> &[T] {
        known(self.get(range)).unwrap_or_default()
    }

    #[inline(always)]
    fn part_mut(&mut self, range: impl SliceIndex<[T], Output = [T]>) -> &mut [T] {
        known(self.get_mut(range)).unwrap_or_default()
    }

    #[inline(always)]
    fn update<R: Default>(&mut self, index: usize, change: impl FnOnce(&mut T) -> R) -> R {
        known(self.get_mut(index)).map(change).unwrap_or_default()
    }

    #[inline(always)]
    fn set(&mut self, index: usize, value: T) {
        self.update(index, |it| *it = value);
    }

    #[inline(always)]
    fn set_chunk<const N: usize>(&mut self, start: usize, values: [T; N]) {
        let chunk = self.get_mut(start..).and_then(<[T]>::first_chunk_mut);
        if let Some(chunk) = known(chunk) {
            *chunk = values;
        }
    }

    #[inline(always)]
    fn value(&self, index: usize) -> T
    where
        T: Copy + Default,
    {
        known(self.get(index)).copied().unwrap_or_default()
    }

    #[inline(always)]
    fn chunk<const N: usize>(&self, start: usize) -> [T; N]
    where
        [T; N]: Copy + Default,
    {
        let chunk = self.get(start..).and_then(<[T]>::first_chunk);
        known(chunk).copied().unwrap_or_default()
    }
}

/// As many as both have.
#[inline(always)]
pub(crate) fn copy<T: Copy>(from: &[T], to: &mut [T]) {
    let len = from.len().min(to.len());
    to.part_mut(..len).copy_from_slice(from.part(..len));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn there_is_nothing_out_of_bounds() {
        let accesses: [fn(&mut [u8]); _] = [
            |two| assert_eq!(two.part(1..3), []),
            |two| assert_eq!(two.part_mut(3..), []),
            |two| assert_eq!(two.update(2, |it| *it), 0),
            |two| assert_eq!(two.value(2), 0),
            |two| assert_eq!(two.chunk(1), [0, 0]),
            |two| two.set(2, 3),
            |two| two.set_chunk(1, [3, 4]),
        ];
        for access in accesses {
            let mut two = [1, 2];
            let result = checked(|| {
                access(&mut two);
                Ok(())
            });
            assert_eq!((result, two), (Err(Error::Internal), [1, 2]));
            assert_eq!(checked(|| Ok(two.value(1))), Ok(2));
        }
    }
}
