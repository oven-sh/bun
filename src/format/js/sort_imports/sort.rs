//! `Array.prototype.sort`.

use std::cmp::Ordering;

/// Sorts `items` the way V8 does. What compares equal stays in order.
///
/// Unlike `slice::sort_by`, it takes a `compare` that is not a total order, which those of the
/// plugins are not for all text. Then the result depends on which items are compared: for fewer
/// than 64 items, which V8 sorts as one run, they are the same here. `n - 1` comparisons if
/// `items` are sorted.
pub(super) fn stable_sort_by<T: Copy>(items: &mut [T], mut compare: impl FnMut(&T, &T) -> Ordering) {
    // `CountAndMakeRun`
    let Some(is_descending) = items.get(..2).map(|it| compare(&it[1], &it[0]) == Ordering::Less) else {
        return;
    };
    let mut run = 2;
    while run < items.len() && (compare(&items[run], &items[run - 1]) == Ordering::Less) == is_descending {
        run += 1;
    }
    if is_descending {
        items[..run].reverse();
    }
    // `BinaryInsertionSort`
    for start in run..items.len() {
        let pivot = items[start];
        let (mut left, mut right) = (0, start);
        while left < right {
            let middle = left + (right - left) / 2;
            match compare(&pivot, &items[middle]) {
                Ordering::Less => right = middle,
                _ => left = middle + 1,
            }
        }
        items.copy_within(left..start, left + 1);
        items[left] = pivot;
    }
}
