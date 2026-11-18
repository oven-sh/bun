//! Which ranges of a space are free. The records are kept apart from the space.

use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

#[derive(Default)]
pub(crate) struct FreeSpace {
    size_by_start: BTreeMap<u32, u32>,
    by_size: BTreeSet<(u32, u32)>,
}

impl FreeSpace {
    fn insert(&mut self, range: Range<u32>) {
        if !range.is_empty() {
            self.size_by_start
                .insert(range.start, range.end - range.start);
            self.by_size.insert((range.end - range.start, range.start));
        }
    }

    fn remove(&mut self, start: u32, size: u32) {
        self.size_by_start.remove(&start);
        self.by_size.remove(&(size, start));
    }

    /// The start of `size` units such that the unit `aligned_at` from it is a multiple of `alignment`.
    pub(crate) fn allocate(&mut self, size: u32, alignment: u32, aligned_at: u32) -> Option<u32> {
        let &(found_size, found) = self
            .by_size
            .range((size.checked_add(alignment - 1)?, 0)..)
            .next()?;
        self.remove(found, found_size);
        let start = (found + aligned_at).next_multiple_of(alignment) - aligned_at;
        self.insert(found..start);
        self.insert(start + size..found + found_size);
        Some(start)
    }

    /// Returns the free range that now includes `range`.
    pub(crate) fn free(&mut self, mut range: Range<u32>) -> Range<u32> {
        if let Some((&start, &size)) = self.size_by_start.range(..range.start).next_back()
            && start + size == range.start
        {
            self.remove(start, size);
            range.start = start;
        }
        if let Some(&size) = self.size_by_start.get(&range.end) {
            self.remove(range.end, size);
            range.end += size;
        }
        self.insert(range.clone());
        range
    }
}

#[cfg(test)]
mod tests {
    use super::FreeSpace;

    #[test]
    fn takes_the_smallest_range_that_fits_and_joins_neighbours() {
        let mut space = FreeSpace::default();
        space.free(0..100);
        let blocks = [10, 20, 5, 30].map(|size| space.allocate(size, 1, 0).unwrap());
        assert_eq!(blocks, [0, 10, 30, 35]);
        assert_eq!(space.free(10..30), 10..30);
        assert_eq!(space.allocate(36, 1, 0), None);
        assert_eq!(space.allocate(15, 1, 0), Some(10));
        assert_eq!(space.free(30..35), 25..35);
        assert_eq!(space.free(35..65), 25..100);
        assert_eq!(space.allocate(4, 4, 1), Some(27));
        assert_eq!(space.allocate(2, 1, 0), Some(25));
    }
}
