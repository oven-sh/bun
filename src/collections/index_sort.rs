//! Non-generic sorts over index arrays. Every distinct `slice::sort_by` element/comparator pair
//! instantiates several KB of driftsort; sorting `u32` indices through a `dyn` comparator shares one.

use core::cmp::Ordering;

/// Stable sort of `indices` by `cmp` (called with the two indices being compared).
#[inline(never)]
pub fn sort_indices(indices: &mut [u32], cmp: &mut dyn FnMut(u32, u32) -> Ordering) {
    indices.sort_by(|&a, &b| cmp(a, b));
}

/// Unstable sort of `indices` by `cmp`.
#[inline(never)]
pub fn sort_indices_unstable(indices: &mut [u32], cmp: &mut dyn FnMut(u32, u32) -> Ordering) {
    indices.sort_unstable_by(|&a, &b| cmp(a, b));
}

/// `0..len` as a `Vec<u32>`, the usual starting point for the sorts above.
pub fn identity(len: usize) -> Vec<u32> {
    (0..u32::try_from(len).expect("index sort length fits u32")).collect()
}

/// Reorders `items` in place so that `items[i]` becomes the element that was at `order[i]`;
/// `order` must be a permutation of `0..items.len()`.
pub fn apply_permutation<T>(items: &mut Vec<T>, order: &[u32]) {
    debug_assert_eq!(items.len(), order.len());
    let mut taken: Vec<Option<T>> = items.drain(..).map(Some).collect();
    items.extend(
        order
            .iter()
            .map(|&i| taken[i as usize].take().expect("order is a permutation")),
    );
}

/// Sorts a `Vec` of arbitrary elements through the shared index sort: one driftsort instance
/// per program instead of one per element type, at the cost of an index array and one pass to reorder.
pub fn sort_vec_by<T>(items: &mut Vec<T>, mut cmp: impl FnMut(&T, &T) -> Ordering) {
    if items.len() < 2 {
        return;
    }
    let mut order = identity(items.len());
    sort_indices(&mut order, &mut |a, b| {
        cmp(&items[a as usize], &items[b as usize])
    });
    apply_permutation(items, &order);
}

/// Unstable counterpart of [`sort_vec_by`].
pub fn sort_vec_unstable_by<T>(items: &mut Vec<T>, mut cmp: impl FnMut(&T, &T) -> Ordering) {
    if items.len() < 2 {
        return;
    }
    let mut order = identity(items.len());
    sort_indices_unstable(&mut order, &mut |a, b| {
        cmp(&items[a as usize], &items[b as usize])
    });
    apply_permutation(items, &order);
}

/// Stable partition: elements for which `pred` is true move to the front, relative order preserved.
pub fn stable_partition<T>(items: &mut [T], mut pred: impl FnMut(&T) -> bool) -> usize {
    let mut front = 0;
    for i in 0..items.len() {
        if pred(&items[i]) {
            items[front..=i].rotate_right(1);
            front += 1;
        }
    }
    front
}
