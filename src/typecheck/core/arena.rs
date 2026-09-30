// internal/core/arena.go. An element is named by its index where upstream hands out a pointer, so one buffer that grows holds all of them.
use std::ops::Range;

// Arena allocator
#[derive(Debug)]
pub struct Arena<T> {
    data: Vec<T>,
}

impl<T> Default for Arena<T> {
    fn default() -> Self {
        Arena { data: Vec::new() }
    }
}

impl<T: Default> Arena<T> {
    // Allocate a single element in the arena and return the index of the element. If the arena is at capacity, room for the next size up is reserved. No element is allocated, and u32::MAX returned, once the indexes are used up.
    pub fn new(&mut self) -> u32 {
        if self.data.len() == self.data.capacity() {
            let next_size = next_arena_size(self.data.len() as isize);
            self.data.reserve(usize::try_from(next_size).unwrap_or(0));
        }
        let Ok(index) = u32::try_from(self.data.len()) else {
            return u32::MAX;
        };
        self.data.push(T::default());
        index
    }

    // Allocate a slice of the given size in the arena: the indexes of its elements. The range is empty for a size of zero, and once the indexes are used up.
    pub fn new_slice(&mut self, size: isize) -> Range<u32> {
        let start = self.data.len();
        let Some(end) = usize::try_from(size)
            .ok()
            .and_then(|size| start.checked_add(size))
        else {
            return 0..0;
        };
        let (Ok(first), Ok(last)) = (u32::try_from(start), u32::try_from(end)) else {
            return 0..0;
        };
        if end > self.data.capacity() {
            let next_size = next_arena_size(start as isize);
            self.data
                .reserve((end - start).max(usize::try_from(next_size).unwrap_or(0)));
        }
        self.data.resize_with(end, T::default);
        first..last
    }

    pub fn new_slice1(&mut self, t: T) -> Range<u32> {
        let slice = self.new_slice(1);
        if let Some(first) = self.get_mut(slice.start) {
            *first = t;
        }
        slice
    }

    pub fn clone(&mut self, t: &[T]) -> Range<u32>
    where
        T: Clone,
    {
        let slice = self.new_slice(t.len() as isize);
        for (target, source) in self.slice_mut(slice.clone()).iter_mut().zip(t) {
            target.clone_from(source);
        }
        slice
    }

    // The element at an index that `new` returned.
    pub fn get(&self, index: u32) -> Option<&T> {
        self.data.get(index as usize)
    }

    pub fn get_mut(&mut self, index: u32) -> Option<&mut T> {
        self.data.get_mut(index as usize)
    }

    // The elements of a range that `new_slice` returned.
    pub fn slice(&self, range: Range<u32>) -> &[T] {
        self.data
            .get(range.start as usize..range.end as usize)
            .unwrap_or(&[])
    }

    pub fn slice_mut(&mut self, range: Range<u32>) -> &mut [T] {
        self.data
            .get_mut(range.start as usize..range.end as usize)
            .unwrap_or(&mut [])
    }

    // The number of elements allocated so far.
    pub fn len(&self) -> usize {
        self.data.len()
    }
}

fn next_arena_size(size: isize) -> isize {
    // This compiles down branch-free.
    let size = size.max(1);
    size.saturating_mul(2).min(256)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexes_stay_valid_while_the_arena_grows() {
        let mut a: Arena<u64> = Arena::default();
        let first = a.new();
        if let Some(value) = a.get_mut(first) {
            *value = 7;
        }
        let many: Vec<u32> = (0..1000).map(|_| a.new()).collect();
        assert_eq!(a.get(first), Some(&7));
        assert_eq!(many.first(), Some(&1));
        assert_eq!(many.last(), Some(&1000));
        assert_eq!(a.get(500), Some(&0));

        let slice = a.new_slice(3);
        assert_eq!(
            (slice.clone(), a.slice(slice.clone())),
            (1001..1004, &[0u64, 0, 0][..])
        );
        a.slice_mut(slice.clone())[1] = 5;
        assert_eq!(a.slice(slice), &[0, 5, 0]);
        assert_eq!(a.new_slice(0), 1004..1004);
        assert_eq!(a.new_slice(-1), 0..0);
        let one = a.new_slice1(9);
        assert_eq!(a.slice(one), &[9]);
        let copy = a.clone(&[1, 2, 3]);
        assert_eq!(a.slice(copy), &[1, 2, 3]);
        assert_eq!(a.clone(&[]).len(), 0);
        assert_eq!(a.len(), 1008);
        assert_eq!(a.get(5000), None);
        assert_eq!(a.slice(4000..5000), &[] as &[u64]);
    }

    #[test]
    fn next_size_doubles_up_to_a_page() {
        assert_eq!(next_arena_size(0), 2);
        assert_eq!(next_arena_size(1), 2);
        assert_eq!(next_arena_size(100), 200);
        assert_eq!(next_arena_size(128), 256);
        assert_eq!(next_arena_size(5000), 256);
    }
}
