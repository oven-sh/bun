//! A sort whose steps decide the order of items that tie. ICU4C: uarrsort.cpp

use crate::common::slice_ext::{SliceExt, SoftUnwrap};

const MIN_QSORT: usize = 9;

fn insertion_sort<T>(array: &mut [T], cmp: &mut impl FnMut(&T, &T) -> i32) {
    for end in 2..=array.len() {
        let part = array.slice_mut(..end);
        let find = |(item, sorted): (&T, &[T])| {
            sorted
                .iter()
                .take_while(|other| cmp(item, other) >= 0)
                .count()
        };
        let insertion_point = part.split_last().map(find).soft_unwrap();
        part.slice_mut(insertion_point..)
            .rotate_at(end - 1 - insertion_point);
    }
}

/// Recurses into the smaller part, so the depth is at most `log2(len)`.
fn quick_sort<T: Clone>(mut array: &mut [T], cmp: &mut impl FnMut(&T, &T) -> i32) {
    while let Some(x) = array
        .get(array.len() / 2)
        .filter(|_| array.len() > MIN_QSORT)
        .cloned()
    {
        // `cmp(x, x)` is 0, so the first pass swaps, and both parts are shorter than `array`.
        let (mut left, mut right) = (0, array.len());
        while left < right {
            left += array
                .slice(left..)
                .iter()
                .take_while(|item| cmp(item, &x) < 0)
                .count();
            right -= array
                .slice(..right)
                .iter()
                .rev()
                .take_while(|item| cmp(&x, item) < 0)
                .count();
            if left < right {
                right -= 1;
                array.swap_soft(left, right);
                left += 1;
            }
        }
        let (lower, upper) = array.split_soft_mut(left);
        let lower = lower.slice_mut(..right);
        let (smaller, larger) = if lower.len() < upper.len() {
            (lower, upper)
        } else {
            (upper, lower)
        };
        quick_sort(smaller, cmp);
        array = larger;
    }
    insertion_sort(array, cmp);
}

/// Not stable. `cmp` is negative if its first argument sorts before the second. Zero and positive results are alike.
pub(crate) fn uprv_sort_array<T: Clone>(array: &mut [T], mut cmp: impl FnMut(&T, &T) -> i32) {
    quick_sort(array, &mut cmp);
}
