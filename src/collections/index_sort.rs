//! Non-generic sorts over index arrays. Every distinct `slice::sort_by` element/comparator pair
//! instantiates several KB of driftsort; sorting `u32` indices through a `dyn` comparator shares one.

use core::cmp::Ordering;

/// What the sorts of slices and `Vec`s below compare with. A `dyn FnMut` would do, but its vtable also has `call_once`, so each
/// of their comparisons would be compiled twice.
trait Compare {
    fn compare(&mut self, a: u32, b: u32) -> Ordering;
}

impl<F: FnMut(u32, u32) -> Ordering> Compare for F {
    #[inline]
    fn compare(&mut self, a: u32, b: u32) -> Ordering {
        self(a, b)
    }
}

/// Either kind of comparison, so that both go through the same two instances of the standard library's sorts.
enum By<'a> {
    Function(&'a mut dyn FnMut(u32, u32) -> Ordering),
    Comparison(&'a mut dyn Compare),
}

impl By<'_> {
    #[inline]
    fn compare(&mut self, a: u32, b: u32) -> Ordering {
        match self {
            By::Function(cmp) => cmp(a, b),
            By::Comparison(cmp) => cmp.compare(a, b),
        }
    }
}

#[inline(never)]
fn sort_stable(indices: &mut [u32], mut by: By<'_>) {
    indices.sort_by(|&a, &b| by.compare(a, b));
}

#[inline(never)]
fn sort_unstable(indices: &mut [u32], mut by: By<'_>) {
    indices.sort_unstable_by(|&a, &b| by.compare(a, b));
}

/// The standard library sorts up to this many items by insertion too. So the result for those is what it gives, and what the tools
/// that are written in Rust give, even if the comparison isn't a total order.
const INSERTION_RUN: usize = 20;

/// See [`merge_sort_indices`].
#[inline(never)]
fn merge_sort(indices: &mut [u32], mut by: By<'_>) {
    for run in indices.chunks_mut(INSERTION_RUN) {
        for end in 1..run.len() {
            let mut at = end;
            while at > 0 && by.compare(run[end], run[at - 1]) == Ordering::Less {
                at -= 1;
            }
            run[at..=end].rotate_right(1);
        }
    }
    let mut left = Vec::new();
    let mut width = INSERTION_RUN;
    while width < indices.len() {
        for both in indices.chunks_mut(2 * width) {
            merge(both, width, &mut left, &mut by);
        }
        width *= 2;
    }
}

/// Merges `both[..middle]` with `both[middle..]`. `left` is for the copy of the first.
fn merge(both: &mut [u32], middle: usize, left: &mut Vec<u32>, by: &mut By<'_>) {
    if middle >= both.len() || by.compare(both[middle], both[middle - 1]) != Ordering::Less {
        return;
    }
    left.clear();
    left.extend_from_slice(&both[..middle]);
    let (mut from_left, mut from_right, mut to) = (0, middle, 0);
    while from_left < middle && from_right < both.len() {
        if by.compare(both[from_right], left[from_left]) == Ordering::Less {
            both[to] = both[from_right];
            from_right += 1;
        } else {
            both[to] = left[from_left];
            from_left += 1;
        }
        to += 1;
    }
    both[to..from_right].copy_from_slice(&left[from_left..]);
}

/// Stable sort of `indices` by `cmp` (called with the two indices being compared).
pub fn sort_indices(indices: &mut [u32], cmp: &mut dyn FnMut(u32, u32) -> Ordering) {
    sort_stable(indices, By::Function(cmp));
}

/// Unstable sort of `indices` by `cmp`.
pub fn sort_indices_unstable(indices: &mut [u32], cmp: &mut dyn FnMut(u32, u32) -> Ordering) {
    sort_unstable(indices, By::Function(cmp));
}

/// [`sort_indices`] for a `cmp` that may not be a total order: one that goes in a circle (`a < b < c < a`), as ports of other people's
/// comparisons do. The sorts of the standard library may panic on it. This one moves the items by counting alone, so it ends with
/// the same items whatever `cmp` answers.
///
/// If `cmp` is a total order, the result is that of [`sort_indices`]. If it is not, but says the opposite of `(b, a)` for `(a, b)`, then
/// still no item is less than the one before it: each pair of neighbors was compared, or was a pair of neighbors before. What
/// is like that already stays as it is, so to sort a second time changes nothing.
pub fn merge_sort_indices(indices: &mut [u32], cmp: &mut dyn FnMut(u32, u32) -> Ordering) {
    merge_sort(indices, By::Function(cmp));
}

/// `0..len` in the order of `cmp`, ties in their order.
#[inline(never)]
fn sorted(len: usize, cmp: &mut dyn Compare) -> Vec<u32> {
    let mut order = identity(len);
    sort_stable(&mut order, By::Comparison(cmp));
    order
}

/// `0..len` in the order of `cmp`, ties in any order.
#[inline(never)]
fn sorted_unstable(len: usize, cmp: &mut dyn Compare) -> Vec<u32> {
    let mut order = identity(len);
    sort_unstable(&mut order, By::Comparison(cmp));
    order
}

/// `0..len` as a `Vec<u32>`, the usual starting point for the sorts above. Out of line: its vectorized loop is bigger than most
/// of what calls it.
#[inline(never)]
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
    let order = sorted(items.len(), &mut |a: u32, b: u32| {
        cmp(&items[a as usize], &items[b as usize])
    });
    apply_permutation(items, &order);
}

/// Unstable counterpart of [`sort_vec_by`].
pub fn sort_vec_unstable_by<T>(items: &mut Vec<T>, mut cmp: impl FnMut(&T, &T) -> Ordering) {
    if items.len() < 2 {
        return;
    }
    let order = sorted_unstable(items.len(), &mut |a: u32, b: u32| {
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
    let mut order = sorted(items.len(), &mut |a: u32, b: u32| {
        cmp(&items[a as usize], &items[b as usize])
    });
    apply_permutation_in_place(items, &mut order);
}

/// `0..len` as [`merge_sort_indices`] sorts it.
#[inline(never)]
fn merge_sorted(len: usize, cmp: &mut dyn Compare) -> Vec<u32> {
    let mut order = identity(len);
    merge_sort(&mut order, By::Comparison(cmp));
    order
}

/// [`sort_slice_by`] for a `cmp` that may not be a total order. See [`merge_sort_indices`].
pub fn merge_sort_slice_by<T>(items: &mut [T], mut cmp: impl FnMut(&T, &T) -> Ordering) {
    if items.len() < 2 {
        return;
    }
    let mut order = merge_sorted(items.len(), &mut |a: u32, b: u32| {
        cmp(&items[a as usize], &items[b as usize])
    });
    apply_permutation_in_place(items, &mut order);
}

/// Unstable counterpart of [`sort_slice_by`].
pub fn sort_slice_unstable_by<T>(items: &mut [T], mut cmp: impl FnMut(&T, &T) -> Ordering) {
    if items.len() < 2 {
        return;
    }
    let mut order = sorted_unstable(items.len(), &mut |a: u32, b: u32| {
        cmp(&items[a as usize], &items[b as usize])
    });
    apply_permutation_in_place(items, &mut order);
}

/// `items.sort()` through [`sort_slice_by`].
pub fn sort_slice<T: Ord>(items: &mut [T]) {
    sort_slice_by(items, T::cmp);
}

/// `items.sort_unstable()` through [`sort_slice_unstable_by`].
pub fn sort_slice_unstable<T: Ord>(items: &mut [T]) {
    sort_slice_unstable_by(items, T::cmp);
}

/// `items.sort_by_key(key)` through [`sort_slice_by`].
pub fn sort_slice_by_key<T, K: Ord>(items: &mut [T], mut key: impl FnMut(&T) -> K) {
    sort_slice_by(items, |a, b| key(a).cmp(&key(b)));
}

/// `items.sort_unstable_by_key(key)` through [`sort_slice_unstable_by`].
pub fn sort_slice_unstable_by_key<T, K: Ord>(items: &mut [T], mut key: impl FnMut(&T) -> K) {
    sort_slice_unstable_by(items, |a, b| key(a).cmp(&key(b)));
}

/// `items.sort_by_cached_key(key)`: stable, and `key` is called once for each element.
pub fn sort_slice_by_cached_key<T, K: Ord>(items: &mut [T], key: impl FnMut(&T) -> K) {
    if items.len() < 2 {
        return;
    }
    let keys: Vec<K> = items.iter().map(key).collect();
    let mut order = sorted(items.len(), &mut |a: u32, b: u32| {
        keys[a as usize].cmp(&keys[b as usize])
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
    fn sorts_by_key_match_std() {
        let mut a: Vec<(u64, usize)> = (0..1000).map(|i| ((i as u64 * 7919) % 257, i)).collect();
        let mut b = a.clone();
        sort_slice_by_key(&mut a, |it| it.0);
        b.sort_by_key(|it| it.0);
        assert_eq!(a, b);
        sort_slice_by_cached_key(&mut a, |it| core::cmp::Reverse(it.0 % 10));
        b.sort_by_cached_key(|it| core::cmp::Reverse(it.0 % 10));
        assert_eq!(a, b);
        sort_slice_unstable_by_key(&mut a, |it| it.1);
        b.sort_unstable_by_key(|it| it.1);
        assert_eq!(a, b);
        sort_slice(&mut a);
        b.sort();
        assert_eq!(a, b);
        a.reverse();
        sort_slice_unstable(&mut a);
        assert_eq!(a, b);
    }

    // Around the length of a run, and of two.
    const LENGTHS: [usize; 11] = [0, 1, 2, 19, 20, 21, 22, 40, 41, 100, 1000];

    fn shuffled(len: usize) -> Vec<u32> {
        (0..len as u32)
            .map(|i| i.wrapping_mul(7919) % 257)
            .collect()
    }

    #[test]
    fn merge_sort_matches_std_for_an_order() {
        for len in LENGTHS {
            let mut a: Vec<(u32, usize)> = shuffled(len).into_iter().zip(0..).collect();
            let mut b = a.clone();
            merge_sort_slice_by(&mut a, |x, y| x.0.cmp(&y.0));
            b.sort_by_key(|x| x.0);
            assert_eq!(a, b, "{len}");
            merge_sort_slice_by(&mut a, |x, y| y.0.cmp(&x.0));
            b.sort_by_key(|x| std::cmp::Reverse(x.0));
            assert_eq!(a, b, "{len}");
        }
    }

    #[test]
    fn merge_sort_keeps_the_items_whatever_the_comparison() {
        const ANSWERS: [Ordering; 11] = [
            Ordering::Less,
            Ordering::Greater,
            Ordering::Greater,
            Ordering::Equal,
            Ordering::Less,
            Ordering::Less,
            Ordering::Greater,
            Ordering::Equal,
            Ordering::Greater,
            Ordering::Less,
            Ordering::Equal,
        ];
        let mut asked = 0;
        let comparisons: [&mut dyn FnMut(u32, u32) -> Ordering; 5] = [
            &mut |_, _| Ordering::Less,
            &mut |_, _| Ordering::Greater,
            &mut |_, _| Ordering::Equal,
            &mut |_, _| {
                asked += 1;
                ANSWERS[asked % ANSWERS.len()]
            },
            // 0 < 1 < 2 < 0
            &mut |a, b| {
                [Ordering::Equal, Ordering::Greater, Ordering::Less][((a + 3 - b % 3) % 3) as usize]
            },
        ];
        for cmp in comparisons {
            for len in LENGTHS {
                let mut sorted = identity(len);
                merge_sort_indices(&mut sorted, cmp);
                sorted.sort_unstable();
                assert_eq!(sorted, identity(len));
                let mut items = shuffled(len);
                merge_sort_slice_by(&mut items, |a, b| cmp(*a, *b));
                let mut expected = shuffled(len);
                items.sort_unstable();
                expected.sort_unstable();
                assert_eq!(items, expected);
            }
        }
    }

    #[test]
    fn merge_sort_leaves_no_item_less_than_the_one_before_it_and_then_changes_nothing() {
        // Which of two is less is a coin toss, the same both ways round.
        let cmp = |a: u32, b: u32| {
            let (low, high) = (a.min(b), a.max(b));
            let toss =
                (low.wrapping_mul(0x9E37_79B1) ^ high.wrapping_mul(0x85EB_CA6B)).count_ones() % 2
                    == 0;
            match a.cmp(&b) {
                Ordering::Equal => Ordering::Equal,
                order if toss => order,
                order => order.reverse(),
            }
        };
        for len in LENGTHS {
            let mut sorted = identity(len);
            merge_sort_indices(&mut sorted, &mut |a, b| cmp(a, b));
            let mut neighbors = sorted.iter().zip(sorted.iter().skip(1));
            assert!(
                neighbors.all(|(a, b)| cmp(*b, *a) != Ordering::Less),
                "{len}"
            );
            let once = sorted.clone();
            merge_sort_indices(&mut sorted, &mut |a, b| cmp(a, b));
            assert_eq!(sorted, once, "{len}");
        }
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
