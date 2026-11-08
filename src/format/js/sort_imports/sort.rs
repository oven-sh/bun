//! `Array.prototype.sort`.

use std::cmp::Ordering;

/// Sorts `items` the way V8 does. Equal items keep their order.
///
/// Unlike `slice::sort_by`, it accepts a `compare` that isn't a total order, which the plugins' comparers aren't for
/// all text. The result then depends on which items get compared. For fewer than 64 items, which V8 (14.6, in Node.js
/// 26) sorts as one run, the same items are compared here. Takes `n - 1` comparisons if 8 or more `items` are already
/// sorted.
pub(super) fn stable_sort_by<T: Copy>(
    items: &mut [T],
    mut compare: impl FnMut(&T, &T) -> Ordering,
) {
    bun_lint::utils::array_sort_by(items, |a, b| compare(&a, &b) == Ordering::Less);
}
