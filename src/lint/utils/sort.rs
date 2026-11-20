//! Slice sorts that are compiled once for the whole program. The standard library's are compiled once per type and
//! closure, at several KB each. These cost a list of indices and an indirect call per comparison, so keep using the
//! standard library for long lists that are sorted for every file.
//!
//! `items.sort_by_key(f)` becomes `sort::sort_by_key(&mut items, f)`, and so on. A sort that's stable there is stable
//! here. To sort a list of indices into something else in place, use [`sort_indices`].
//!
//! The standard library's sorts may panic if the comparison isn't a total order, and a panic ends the whole run.
//! Sorting by an `Ord` key is always safe. A rule's own comparison function, often ported from JavaScript, can be
//! cyclic for some inputs. So [`sort_by`] and [`merge_sort_indices`] are merge sorts that accept any comparison. Only
//! use [`sort_indices`] to compare two keys.

pub use bun_collections::index_sort::{
    apply_permutation_in_place, merge_sort_indices, merge_sort_slice_by as sort_by, sort_indices,
    sort_indices_unstable, sort_slice as sort, sort_slice_by_cached_key as sort_by_cached_key,
    sort_slice_by_key as sort_by_key, sort_slice_unstable as sort_unstable,
    sort_slice_unstable_by_key as sort_unstable_by_key,
};

/// Returns a hash table's items sorted by `key`, which must be unique. The table's own order depends on the machine, so
/// printed output must never follow it.
pub fn collect_sorted_by_key<T, K: Ord>(
    table: impl IntoIterator<Item = T>,
    key: impl FnMut(&T) -> K,
) -> Vec<T> {
    let mut all: Vec<T> = table.into_iter().collect();
    sort_unstable_by_key(&mut all, key);
    all
}
