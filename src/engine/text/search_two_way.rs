//! Crochemore and Perrin, "Two-way string-matching", Journal of the ACM 38(3), 1991.
//! Backward, it is the same search in both texts read from their ends.

use core::cmp::Ordering;

use crate::CodeUnit;
use crate::block::{self, Pairs};
use crate::compare::common_prefix_len;
use crate::search_units::Direction;

#[derive(Clone, Copy)]
pub(crate) struct TwoWay {
    /// The length of the left part of a critical factorization.
    split: usize,
    /// How far to move on when only the left part differs.
    shift: usize,
    /// How much of the needle is known to match after that.
    kept: usize,
}

#[inline(always)]
fn unit_at<T: CodeUnit, D: Direction>(units: &[T], index: usize) -> u16 {
    if D::IS_FORWARD {
        units[index].to_u16()
    } else {
        units[units.len() - 1 - index].to_u16()
    }
}

/// `length` units from `start`, which is counted in the direction.
#[inline(always)]
fn part<T, D: Direction>(units: &[T], start: usize, length: usize) -> &[T] {
    if D::IS_FORWARD {
        &units[start..start + length]
    } else {
        &units[units.len() - start - length..units.len() - start]
    }
}

/// How many units agree from the start in the direction. Both have the same length.
#[inline(always)]
fn common_len<A: CodeUnit, B: CodeUnit, D: Direction>(a: &[A], b: &[B]) -> usize {
    if D::IS_FORWARD {
        return common_prefix_len(a, b);
    }
    let last = block::last(Pairs::new(a, b, |a: A, b: B| a.to_u16() != b.to_u16()));
    last.map_or(a.len(), |at| a.len() - 1 - at)
}

/// The start and the period of the suffix that comes last, if a unit comes after those that it is `after`.
fn maximal_suffix<T: CodeUnit, D: Direction>(needle: &[T], after: Ordering) -> (usize, usize) {
    let (mut best, mut rival, mut offset, mut period) = (0, 1, 0, 1);
    while rival + offset < needle.len() {
        let order =
            unit_at::<T, D>(needle, rival + offset).cmp(&unit_at::<T, D>(needle, best + offset));
        if order == after {
            (best, offset, period) = (rival, 0, 1);
            rival += 1;
        } else if order.is_ne() {
            rival += offset + 1;
            (offset, period) = (0, rival - best);
        } else if offset + 1 == period {
            rival += period;
            offset = 0;
        } else {
            offset += 1;
        }
    }
    (best, period)
}

impl TwoWay {
    pub(crate) fn new<N: CodeUnit, D: Direction>(needle: &[N]) -> TwoWay {
        let (split, period) = maximal_suffix::<N, D>(needle, Ordering::Greater)
            .max(maximal_suffix::<N, D>(needle, Ordering::Less));
        if part::<N, D>(needle, 0, split) == part::<N, D>(needle, period, split) {
            TwoWay {
                split,
                shift: period,
                kept: needle.len() - period,
            }
        } else {
            TwoWay {
                split,
                shift: split.max(needle.len() - split) + 1,
                kept: 0,
            }
        }
    }

    /// The index of the first match in the direction, counted from the start of the slice.
    pub(crate) fn find<H: CodeUnit, N: CodeUnit, D: Direction>(
        self,
        haystack: &[H],
        needle: &[N],
    ) -> Option<usize> {
        let last = haystack.len().checked_sub(needle.len())?;
        let (mut at, mut known) = (0, 0);
        while at <= last {
            let agree = |start: usize, end: usize| {
                common_len::<H, N, D>(
                    part::<H, D>(haystack, at + start, end - start),
                    part::<N, D>(needle, start, end - start),
                )
            };
            let right = self.split.max(known);
            let differs = right + agree(right, needle.len());
            if differs < needle.len() {
                at += differs - self.split + 1;
                known = 0;
            } else if known >= self.split || known + agree(known, self.split) == self.split {
                return Some(if D::IS_FORWARD { at } else { last - at });
            } else {
                at += self.shift;
                known = self.kept;
            }
        }
        None
    }
}
