//! Sorts that are compiled once for the whole program, where those of the standard library are compiled once for each
//! type and closure, several KB each. All are stable. They cost a list of indices and a call for each comparison.

use bun_collections::index_sort::sort_slice_by;
pub(crate) use bun_collections::index_sort::sort_slice_by as sort_by;

pub(crate) fn sort<T: Ord>(items: &mut [T]) {
    sort_slice_by(items, T::cmp);
}

pub(crate) fn sort_by_key<T, K: Ord>(items: &mut [T], mut key: impl FnMut(&T) -> K) {
    sort_slice_by(items, |a, b| key(a).cmp(&key(b)));
}
