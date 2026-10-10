//! The operations of JavaScript arrays whose result depends on how the engine does them.

/// `items.sort(compare)`, where `is_before(a, b)` is `compare(a, b) < 0`.
///
/// It matters for a `compare` that never answers 0, such as `(a, b) => a > b ? 1 : -1` in the fixes
/// of `sort-imports` and `sort-vars`: it is inconsistent for equal items, and where those end up
/// depends on the algorithm. This is what V8 14, of Node.js 25, does for fewer than 64 items: from 8
/// items on the run that the array starts with, reversed if it descends, and binary insertion of the
/// rest. With more items it still sorts, and is stable for a consistent `compare`.
pub fn array_sort_by<T: Copy>(items: &mut [T], mut is_before: impl FnMut(T, T) -> bool) {
    let mut run = 1;
    if items.len() >= 8 {
        let is_descending = is_before(items[1], items[0]);
        run = 2;
        while run < items.len() && is_before(items[run], items[run - 1]) == is_descending {
            run += 1;
        }
        if is_descending {
            items[..run].reverse();
        }
    }
    for start in run..items.len() {
        let pivot = items[start];
        let (mut left, mut right) = (0, start);
        while left < right {
            let middle = left + (right - left) / 2;
            match is_before(pivot, items[middle]) {
                true => right = middle,
                false => left = middle + 1,
            }
        }
        items.copy_within(left..start, left + 1);
        items[left] = pivot;
    }
}
