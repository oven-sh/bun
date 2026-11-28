use super::{Aligned, MAX_SYMBOLS};
use bun_simd::prelude::*;
use core::mem::MaybeUninit;

targets!(Upto<B32>);

/// How many elements after the leaves [`sort_leaves`] may copy to the same index.
pub(crate) const LEAF_SLACK: usize = 16;
const GROUP: usize = LEAF_SLACK;
const BEFORE: usize = 2 * GROUP;
const AFTER: usize = 3 * GROUP;
/// The padding after the counts. No count is greater, so the sort leaves it at the end.
const LAST: i16 = i16::MAX - 1;
/// The distances that are no sum of the gaps 4, 10 and 23. After their passes, leaves at all others are in order.
const LAST_DISTANCES: [usize; 15] = [1, 2, 3, 5, 6, 7, 9, 11, 13, 15, 17, 19, 21, 25, 29];
/// The last multiple of 4 that is no sum of the gaps 10, 23, 57 and 132.
const REACH_OF_GAP_4: usize = 128;

/// Finds where a stable sort puts `GROUP` counts, by how many of the others go before each.
#[simd]
struct Group {
    ours: i16x16<S>,
    above: i16x16<S>,
    negated_rank: i16x16<S>,
}

#[simd]
impl Group<S> {
    fn new(ours: i16x16<S>) -> Self {
        Self {
            ours,
            above: ours + 1,
            negated_rank: i16x16::zero(),
        }
    }
    fn compare_with_earlier(&mut self, others: i16x16<S>) {
        self.negated_rank += self.above.simd_gt(others).to_simd::<i16>();
    }
    fn compare_with_later(&mut self, others: i16x16<S>) {
        self.negated_rank += self.ours.simd_gt(others).to_simd::<i16>();
    }
    /// Rank 0 of the first lane is at `base`.
    fn finish(self, base: usize, gap: usize, from: &[u64], to: &mut [u64]) {
        let target = i16x16::iota(base as i16) - self.negated_rank * gap as i16;
        // Four indices leave the vector at once. Through memory, many CPUs wait for the store.
        let targets = target
            .cast_unsigned()
            .simd_min((to.len() - 1) as u16)
            .bitcast::<u64>()
            .to_array();
        let (from, few) = (&from[..GROUP], from.len() <= GROUP + GROUP / 2);
        unroll!(for i in 0..16 {
            if i == GROUP / 2 && few {
                return;
            }
            to[usize::from((targets[i / 4] >> (i % 4 * 16)) as u16)] = from[i];
        });
    }
}

/// One pass of a Shell sort. Counts that are more than `reach` apart are in order.
#[simd]
fn sort_with_gap(padded: &[i16], gap: u8, reach: usize, from: &[u64], to: &mut [u64]) {
    let count = from.len() - GROUP;
    let gap = usize::from(gap);
    for first in (0..count).step_by(GROUP) {
        let ours = BEFORE + first;
        let mut earlier = &padded[ours - reach.min(first + GROUP - 1)..ours + GROUP];
        let later = &padded[ours..ours + GROUP + reach.min(count - 1 - first)];
        let mut group = Group::new(i16x16::load(later));
        let reached = earlier.len();
        while earlier.len() >= gap + GROUP {
            earlier = &earlier[..earlier.len() - gap];
            group.compare_with_earlier(i16x16::load_last(earlier));
        }
        let mut at = gap;
        while at <= later.len() - GROUP {
            group.compare_with_later(i16x16::load(&later[at..]));
            at += gap;
        }
        group.finish(
            first.wrapping_sub(reached - earlier.len()),
            gap,
            &from[first..],
            to,
        );
    }
}

/// The pass with a gap of half of the leaves or more, in which each meets one other at most. `to` is a copy of `from`.
#[simd]
fn sort_pairs(padded: &mut [i16], gap: usize, from: &[u64], to: &mut [u64]) {
    let pairs = from.len() - GROUP - gap;
    for first in (BEFORE..BEFORE + pairs).step_by(GROUP) {
        let (earlier, later) = (
            i16x16::load_at(padded, first),
            i16x16::load_at(padded, first + gap),
        );
        earlier.simd_min(later).store_at(padded, first);
        earlier.simd_max(later).store_at(padded, first + gap);
    }
    let (earlier, later) = (&from[..pairs], &from[gap..][..pairs]);
    let (lower, higher) = to.split_at_mut(gap);
    let (lower, higher) = (&mut lower[..pairs], &mut higher[..pairs]);
    for i in 0..pairs {
        let (a, b) = (earlier[i], later[i]);
        (lower[i], higher[i]) = if b >> 32 < a >> 32 { (b, a) } else { (a, b) };
    }
}

#[simd]
fn sort_at_last_distances(padded: &[i16], from: &[u64], to: &mut [u64]) {
    for first in (0..from.len() - GROUP).step_by(GROUP) {
        let around = &padded[first..][..2 * BEFORE + GROUP];
        let mut group = Group::new(i16x16::load(&around[BEFORE..]));
        unroll!(for i in 0..15 {
            group.compare_with_earlier(i16x16::load(&around[BEFORE - LAST_DISTANCES[i]..]));
            group.compare_with_later(i16x16::load(&around[BEFORE + LAST_DISTANCES[i]..]));
        });
        group.finish(
            first.wrapping_sub(LAST_DISTANCES.len()),
            1,
            &from[first..],
            to,
        );
    }
}

/// What does not fit becomes `i16::MAX` or negative. The last `GROUP` are no leaves.
#[simd]
fn for_counts(leaves: &[u64], mut put: impl FnMut(usize, i16x16<S>)) {
    let (count, mut indices) = ((leaves.len() - GROUP) as i16, i16x16::iota(0));
    let (groups, _) = leaves[..leaves.len() - 1].as_chunks::<GROUP>();
    for (nth, leaves) in groups.iter().enumerate() {
        let halves = |at: usize| u64x4::load_at(leaves, at).bitcast::<i32>();
        let counts_at = |at: usize| halves(at).deinterleave(halves(at + 4))[1];
        let counts = counts_at(0).saturating_narrow::<i16>(counts_at(8));
        put(nth, indices.simd_lt(count).select(counts, LAST));
        indices += GROUP as i16;
    }
}

/// Sorts the first `count` of `leaves` by their high halves, unless one is above 32766 or a slice is too short.
/// `like_shell_sort` is with the gaps 132, 57, 23, 10, 4 and 1. Otherwise, ties keep their order.
#[inline]
#[shared]
pub(crate) fn sort_leaves(
    leaves: &[u64],
    count: usize,
    like_shell_sort: bool,
    sorted: &mut [u64],
) -> bool {
    // Two kernels, which keeps the buffer of one off the stack of the other.
    if like_shell_sort {
        sort_with_gaps(leaves, count, sorted)
    } else {
        sort_stably(leaves, count, sorted)
    }
}

#[kernel]
#[inline(never)]
pub(super) fn sort_with_gaps(leaves: &[u64], count: usize, sorted: &mut [u64]) -> bool {
    sort_by_rank(leaves, count, true, sorted)
}

#[kernel]
#[inline(never)]
pub(super) fn sort_stably(leaves: &[u64], count: usize, sorted: &mut [u64]) -> bool {
    sort_by_rank(leaves, count, false, sorted)
}

#[simd]
fn sort_by_rank(leaves: &[u64], count: usize, like_shell_sort: bool, sorted: &mut [u64]) -> bool {
    if count > MAX_SYMBOLS || count + GROUP > leaves.len().min(sorted.len()) {
        return false;
    }
    let (leaves, sorted) = (&leaves[..count + GROUP], &mut sorted[..count + GROUP]);
    let mut padded = Aligned([MaybeUninit::uninit(); BEFORE + MAX_SYMBOLS + AFTER]);
    let mut padded = Output::new(&mut padded.0);
    padded.push(&[0; BEFORE]);
    let mut signs = i16x16::zero();
    for_counts(leaves, |_, counts| {
        padded.push(counts);
        signs |= counts | (counts + 1);
    });
    padded.push(&[LAST; AFTER]);
    let padded = padded.into_filled();
    if signs.is_negative().any() {
        return false;
    }
    if like_shell_sort {
        shell_sort(padded, leaves, sorted);
    } else {
        sort_with_gap(padded, 1, count, leaves, sorted);
    }
    true
}

#[simd]
fn shell_sort(padded: &mut [i16], leaves: &[u64], sorted: &mut [u64]) {
    const ALL: usize = MAX_SYMBOLS;
    const GAPS: [(u8, usize); 5] = [
        (132, ALL),
        (57, ALL),
        (23, ALL),
        (10, ALL),
        (4, REACH_OF_GAP_4),
    ];
    let count = leaves.len() - GROUP;
    let gaps = &GAPS[GAPS.partition_point(|&(gap, _)| usize::from(gap) >= count)..];
    let mut spare = [MaybeUninit::uninit(); MAX_SYMBOLS + 2 * GROUP];
    let mut spare = Output::new(&mut spare);
    spare.push(leaves);
    let spare = spare.into_filled();
    // The passes go back and forth, and the last one ends in `sorted`.
    let (mut previous, mut to) = match gaps.len() % 2 {
        0 => (spare, sorted),
        _ => (sorted, spare),
    };
    let (mut from, mut gaps) = (leaves, gaps);
    if let [(gap, _), rest @ ..] = gaps
        && 2 * usize::from(*gap) >= count
    {
        if gaps.len() % 2 == 0 {
            to.copy_from_slice(leaves);
        }
        sort_pairs(padded, usize::from(*gap), leaves, to);
        (previous, to) = (to, previous);
        (from, gaps) = (&*previous, rest);
    }
    for &(gap, reach) in gaps {
        sort_with_gap(padded, gap, reach, from, to);
        for_counts(to, |nth, counts| {
            counts.store(&mut padded[BEFORE + nth * GROUP..])
        });
        (previous, to) = (to, previous);
        from = previous;
    }
    sort_at_last_distances(padded, from, to);
}
