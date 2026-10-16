//! The sorts of slices, compiled once for the whole program. Those of the standard library are compiled once for each type
//! and closure, several KB each. These cost a list of indices and a call for each comparison: what is sorted for every file
//! and is long stays with the standard library.
//!
//! `items.sort_by_key(f)` is `sort::sort_by_key(&mut items, f)`, and so on. What is stable there is stable here. A list of
//! indices into something else is sorted as it is, by [`sort_indices`].

pub use bun_collections::index_sort::{
    apply_permutation_in_place, sort_indices, sort_indices_unstable, sort_slice as sort,
    sort_slice_by as sort_by, sort_slice_by_cached_key as sort_by_cached_key,
    sort_slice_by_key as sort_by_key, sort_slice_unstable as sort_unstable,
    sort_slice_unstable_by as sort_unstable_by, sort_slice_unstable_by_key as sort_unstable_by_key,
};

/// What a hash table has, by `key`, which no two of them have in common. The order of the table itself depends on the machine, so
/// nothing that is printed may follow it.
pub fn in_order_of<T, K: Ord>(
    table: impl IntoIterator<Item = T>,
    key: impl FnMut(&T) -> K,
) -> Vec<T> {
    let mut all: Vec<T> = table.into_iter().collect();
    sort_unstable_by_key(&mut all, key);
    all
}
