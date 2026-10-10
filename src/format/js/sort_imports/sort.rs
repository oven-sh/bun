//! `Array.prototype.sort`.

use std::cmp::Ordering;

/// Sorts `items` the way V8 does. What compares equal stays in order.
///
/// Unlike `slice::sort_by`, it takes a `compare` that is not a total order, which those of the
/// plugins are not for all text. Then the result depends on which items are compared: for fewer
/// than 64 items, which V8 (14.6, of Node.js 26) sorts as one run, they are the same here.
/// `n - 1` comparisons if 8 or more `items` are sorted.
pub(super) fn stable_sort_by<T: Copy>(
    items: &mut [T],
    mut compare: impl FnMut(&T, &T) -> Ordering,
) {
    bun_lint::utils::array_sort_by(items, |a, b| compare(&a, &b) == Ordering::Less);
}
