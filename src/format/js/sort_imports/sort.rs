//! `Array.prototype.sort`.

use std::cmp::Ordering;

/// Sorts `items`. What compares equal stays in order. Unlike `slice::sort_by`, it takes a
/// `compare` that is not a total order, which those of the plugins are not for all text. `n - 1`
/// comparisons if `items` are sorted.
pub(super) fn stable_sort_by<T: Copy>(items: &mut [T], mut compare: impl FnMut(&T, &T) -> Ordering) {
    for at in 1..items.len() {
        let item = items[at];
        if compare(&items[at - 1], &item) != Ordering::Greater {
            continue;
        }
        // Where it goes: after everything that is not greater.
        let (mut low, mut high) = (0, at - 1);
        while low < high {
            let middle = low + (high - low) / 2;
            match compare(&item, &items[middle]) {
                Ordering::Less => high = middle,
                _ => low = middle + 1,
            }
        }
        items.copy_within(low..at, low + 1);
        items[low] = item;
    }
}
