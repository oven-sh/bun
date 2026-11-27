//! Indexing of fixed-size arrays that cannot panic.

pub(crate) trait At<T> {
    /// For an `index` that the caller knows to be in range. One that is not gets some other element.
    fn at(&self, index: usize) -> &T;
    fn at_mut(&mut self, index: usize) -> &mut T;
}

#[inline(always)]
const fn in_range<const N: usize>(index: usize) -> usize {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_index_gets_an_element() {
        assert_eq!([0, 1, 2, 3].map(in_range::<2>), [0, 1, 0, 1]);
        assert_eq!([0, 1, 2, 3].map(in_range::<3>), [0, 1, 2, 2]);
    }
}
