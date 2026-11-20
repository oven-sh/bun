//! Indexing that cannot panic, and allocations that may be refused.

use crate::error::{Error, Result};

pub trait At<T> {
    /// For an `index` that the caller knows to be in range. One that is not gets some other element.
    fn at(&self, index: usize) -> &T;
    fn at_mut(&mut self, index: usize) -> &mut T;
}

#[inline(always)]
pub(crate) const fn in_range<const N: usize>(index: usize) -> usize {
    const { assert!(N != 0) };
    if N.is_power_of_two() {
        index % N
    } else if index < N {
        index
    } else {
        N - 1
    }
}

#[expect(clippy::indexing_slicing, reason = "in_range() is below N")]
impl<T, const N: usize> At<T> for [T; N] {
    #[inline(always)]
    fn at(&self, index: usize) -> &T {
        debug_assert!(index < N);
        &self[in_range::<N>(index)]
    }

    #[inline(always)]
    fn at_mut(&mut self, index: usize) -> &mut T {
        debug_assert!(index < N);
        &mut self[in_range::<N>(index)]
    }
}

/// `Vec::resize()` checks each element for overlap in hardened builds.
#[inline(always)]
pub fn resize<T: Copy>(vec: &mut Vec<T>, len: usize, value: T) {
    vec.resize_with(len, || value);
}

/// Makes `vec` at least `len` long.
#[inline]
pub fn grow<T: Copy>(vec: &mut Vec<T>, value: T, len: usize) -> Result<()> {
    if let Some(more @ 1..) = len.checked_sub(vec.len()) {
        vec.try_reserve_exact(more)?;
        resize(vec, len, value);
    }
    Ok(())
}

/// Out of line, so that no other function has room for a `T` on its stack.
#[cold]
#[inline(never)]
pub fn allocate<T>(value: impl FnOnce() -> T) -> Result<Box<T>> {
    Box::try_new(value()).map_err(|_| Error::MemoryAllocation)
}

/// What is in `slot`, which is `empty()` at first.
#[inline(always)]
pub fn get_or_allocate<T>(slot: &mut Option<Box<T>>, empty: impl FnOnce() -> T) -> Result<&mut T> {
    Ok(match slot {
        Some(item) => item,
        None => slot.insert(allocate(empty)?),
    })
}

#[test]
fn resizing_goes_both_ways() {
    let mut vec = vec![1, 2];
    resize(&mut vec, 3, 7);
    assert_eq!(vec, [1, 2, 7]);
    resize(&mut vec, 1, 7);
    assert_eq!(vec, [1]);
}
