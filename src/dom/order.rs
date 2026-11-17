//! The sorts of the standard library are 5 to 15 KB for each caller.

use core::cmp::Ordering;

use bun_collections::index_sort;

/// Stable.
pub(crate) trait Order<T> {
    fn order_by(&mut self, compare: impl FnMut(&T, &T) -> Ordering);
    fn order_by_key<K: Ord>(&mut self, key: impl FnMut(&T) -> K);
    fn order_by_cached_key<K: Ord>(&mut self, key: impl FnMut(&T) -> K);
}

impl<T> Order<T> for [T] {
    fn order_by(&mut self, mut compare: impl FnMut(&T, &T) -> Ordering) {
        if self.len() > 20 {
            return index_sort::sort_slice_by(self, compare);
        }
        for end in 1..self.len() {
            let mut at = end;
            while at > 0 && compare(&self[at - 1], &self[at]).is_gt() {
                self.swap(at - 1, at);
                at -= 1;
            }
        }
    }

    fn order_by_key<K: Ord>(&mut self, mut key: impl FnMut(&T) -> K) {
        self.order_by(|a, b| key(a).cmp(&key(b)));
    }

    fn order_by_cached_key<K: Ord>(&mut self, key: impl FnMut(&T) -> K) {
        index_sort::sort_slice_by_cached_key(self, key);
    }
}
