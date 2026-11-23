//! An in-place sort that is compiled once and never allocates. Elements that compare equal must be interchangeable.

use crate::common::slice_ext::SoftUnwrap;
use std::cmp::Ordering;

trait Sortable {
    fn is_less(&mut self, a: usize, b: usize) -> bool;
    fn swap(&mut self, a: usize, b: usize);
}

struct Slice<'a, T, F> {
    items: &'a mut [T],
    compare: F,
}

impl<T, F: FnMut(&T, &T) -> Ordering> Sortable for Slice<'_, T, F> {
    fn is_less(&mut self, a: usize, b: usize) -> bool {
        let pair = self.items.get(a).zip(self.items.get(b));
        pair.map(|(a, b)| (self.compare)(a, b).is_lt())
            .soft_unwrap()
    }

    fn swap(&mut self, a: usize, b: usize) {
        let pair = self.items.get_disjoint_mut([a, b]).ok();
        pair.map(|[a, b]| std::mem::swap(a, b)).soft_unwrap()
    }
}

pub(crate) fn sort_in_place<T: Ord>(items: &mut [T]) {
    sort_in_place_by(items, T::cmp);
}

pub(crate) fn sort_in_place_by<T>(items: &mut [T], compare: impl FnMut(&T, &T) -> Ordering) {
    sort_dyn(items.len(), &mut Slice { items, compare });
}

/// Insertion sort for short lists, else heapsort.
fn sort_dyn(count: usize, list: &mut dyn Sortable) {
    if count <= 12 {
        for next in 1..count {
            let mut at = next;
            while at > 0 && list.is_less(at, at - 1) {
                list.swap(at, at - 1);
                at -= 1;
            }
        }
        return;
    }
    // The keys of a resource table are in order.
    if !(1..count).any(|at| list.is_less(at, at - 1)) {
        return;
    }
    for top in (0..count / 2).rev() {
        sift_down(top, count, list);
    }
    for end in (1..count).rev() {
        list.swap(0, end);
        sift_down(0, end, list);
    }
}

/// Restores the max-heap `[0, end)` below `top`.
fn sift_down(mut top: usize, end: usize, list: &mut dyn Sortable) {
    loop {
        let mut child = 2 * top + 1;
        if child >= end {
            return;
        }
        if child + 1 < end && list.is_less(child, child + 1) {
            child += 1;
        }
        if !list.is_less(top, child) {
            return;
        }
        list.swap(top, child);
        top = child;
    }
}
