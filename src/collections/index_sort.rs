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

/// Reorders `items` in place so that `items[i]` becomes the element that was at `order[i]`,
/// without a scratch `Vec`; `order` must be a permutation of `0..items.len()` and is consumed.
pub fn apply_permutation_in_place<T>(items: &mut [T], order: &mut [u32]) {
    debug_assert_eq!(items.len(), order.len());
    const DONE: u32 = u32::MAX;
    for start in 0..items.len() {
        if order[start] == DONE {
            continue;
        }
        // Walk the cycle starting at `start`; each swap puts the right element into `cur`
        // and carries the displaced one forward until it lands back at `start`.
        let mut cur = start;
        loop {
            let next = order[cur] as usize;
            order[cur] = DONE;
            if next == start {
                break;
            }
            items.swap(cur, next);
            cur = next;
        }
    }
}

/// [`sort_vec_by`] for a slice.
pub fn sort_slice_by<T>(items: &mut [T], mut cmp: impl FnMut(&T, &T) -> Ordering) {
    if items.len() < 2 {
        return;
    }
    let mut order = identity(items.len());
    sort_indices(&mut order, &mut |a, b| {
        cmp(&items[a as usize], &items[b as usize])
    });
    apply_permutation_in_place(items, &mut order);
}

/// Unstable counterpart of [`sort_slice_by`].
pub fn sort_slice_unstable_by<T>(items: &mut [T], mut cmp: impl FnMut(&T, &T) -> Ordering) {
    if items.len() < 2 {
        return;
    }
    let mut order = identity(items.len());
    sort_indices_unstable(&mut order, &mut |a, b| {
        cmp(&items[a as usize], &items[b as usize])
    });
    apply_permutation_in_place(items, &mut order);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slice_sorts_match_std() {
        let mut a: Vec<u64> = (0..1000u64).map(|i| (i * 7919) % 257).collect();
        let mut b = a.clone();
        sort_slice_by(&mut a, |x, y| x.cmp(y));
        b.sort();
        assert_eq!(a, b);
        sort_slice_unstable_by(&mut a, |x, y| y.cmp(x));
        b.sort_by(|x, y| y.cmp(x));
        assert_eq!(a, b);
    }

    #[test]
    fn slice_sort_is_stable() {
        let mut v: Vec<(u8, usize)> = (0..500).map(|i| ((i * 31 % 7) as u8, i)).collect();
        sort_slice_by(&mut v, |x, y| x.0.cmp(&y.0));
        assert!(
            v.windows(2)
                .all(|w| w[0].0 < w[1].0 || (w[0].0 == w[1].0 && w[0].1 < w[1].1))
        );
    }
}
