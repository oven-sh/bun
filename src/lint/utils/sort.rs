//! The sorts of slices, compiled once for the whole program. Those of the standard library are compiled once for each type
//! and closure, several KB each. These cost a list of indices and a call for each comparison: what is sorted for every file
//! and is long stays with the standard library.
//!
//! `items.sort_by_key(f)` is `sort::sort_by_key(&mut items, f)`, and so on. What is stable there is stable here. A list of
//! indices into something else is sorted as it is, by [`sort_indices`].
//!
//! The standard library may panic if what it sorts by isn't a total order, which ends the whole run. A key is `Ord`, so it is one. A
//! comparison of a rule, which is often a port, may go in a circle for some text. So [`sort_by`] is a merge sort that takes
//! every comparison, and so is [`merge_sort_indices`]: [`sort_indices`] is for comparing two keys.

pub use bun_collections::index_sort::{
    apply_permutation_in_place, merge_sort_indices, merge_sort_slice_by as sort_by, sort_indices,
    sort_indices_unstable, sort_slice as sort, sort_slice_by_cached_key as sort_by_cached_key,
    sort_slice_by_key as sort_by_key, sort_slice_unstable as sort_unstable,
    sort_slice_unstable_by_key as sort_unstable_by_key,
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
