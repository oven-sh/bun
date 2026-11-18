//! Search for a needle of two units or more, in time linear in the lengths, without allocation.
//!
//! Only the places are compared that have the right units at two offsets of the needle. An offset at which a
//! comparison fails tells such places apart, so it takes over from the older of the two. Where too many are compared
//! all the same, the two-way algorithm does a stretch.

use core::marker::PhantomData;
use core::ops::Range;

use bun_highway::text as kernels;

use crate::CodeUnit;
use crate::block::{self, Pairs, WINDOW};
use crate::compare::{common_prefix_len, equal_units};
use crate::search::SHORT;
use crate::search_two_way::TwoWay;

/// The order in which the places are tried.
pub(crate) trait Direction {
    const IS_FORWARD: bool;
}

pub(crate) struct Forward;

impl Direction for Forward {
    const IS_FORWARD: bool = true;
}

pub(crate) struct Backward;

impl Direction for Backward {
    const IS_FORWARD: bool = false;
}

/// What a failed comparison costs, in places that have to be left behind to make up for it.
const COST_OF_FAILURE: usize = 3;
/// So many are gone through before it pays to set up a `Searcher`.
const NEAR_WINDOWS: usize = 2;
const INITIAL_CREDIT: usize = 64;
const SHORTEST_STRETCH: usize = 4096;

/// What a search has learned about its needle. It does not depend on the width of the needle.
#[derive(Clone, Copy)]
pub(crate) struct Experience {
    pub(crate) offsets: [usize; 2],
    two_way: Option<TwoWay>,
}

impl Experience {
    #[inline(always)]
    pub(crate) fn new(needle_length: usize) -> Experience {
        Experience {
            offsets: [0, needle_length.saturating_sub(1)],
            two_way: None,
        }
    }
}

/// The first place at or after `from`, or the last one before it. The needle fits in the haystack.
#[inline(never)]
pub(crate) fn find<H: CodeUnit, N: CodeUnit, D: Direction>(
    haystack: &[H],
    needle: &[N],
    from: usize,
) -> Option<usize> {
    let last = needle.len() - 1;
    let places = haystack.len() - last;
    let mut from = from;
    for _ in 0..NEAR_WINDOWS {
        let near = if D::IS_FORWARD {
            from..places.min(from + WINDOW)
        } else {
            from.saturating_sub(WINDOW)..from
        };
        let mut candidates = candidates(haystack, needle, [0, last], near.clone())?;
        while candidates != 0 {
            let bit = if D::IS_FORWARD {
                candidates.trailing_zeros()
            } else {
                candidates.ilog2()
            };
            let place = near.start + bit as usize;
            if equal_units(&haystack[place..][..needle.len()], needle) {
                return Some(place);
            }
            candidates ^= 1 << bit;
        }
        from = if D::IS_FORWARD { near.end } else { near.start };
        if from == if D::IS_FORWARD { places } else { 0 } {
            return None;
        }
    }
    Searcher::<N, D>::new(needle).find(haystack, from)
}

/// A bit for each of up to 64 places that has the units of the needle at the two offsets. `None` if no place can.
#[inline(always)]
pub(crate) fn candidates<H: CodeUnit, N: CodeUnit>(
    haystack: &[H],
    needle: &[N],
    [p, q]: [usize; 2],
    places: Range<usize>,
) -> Option<u64> {
    let (x, y) = (
        H::from_u16(needle[p].to_u16())?,
        H::from_u16(needle[q].to_u16())?,
    );
    Some(block::window_mask(Pairs::new(
        &haystack[places.start + p..][..places.len()],
        &haystack[places.start + q..][..places.len()],
        |a, b| (a == x) & (b == y),
    )))
}

pub(crate) struct Searcher<'a, N, D> {
    needle: &'a [N],
    pub(crate) experience: Experience,
    direction: PhantomData<D>,
}

impl<'a, N: CodeUnit, D: Direction> Searcher<'a, N, D> {
    #[inline(always)]
    fn new(needle: &'a [N]) -> Self {
        Self::with_experience(needle, Experience::new(needle.len()))
    }

    /// `experience` is from a search for the same needle in the same direction.
    #[inline(always)]
    pub(crate) fn with_experience(needle: &'a [N], experience: Experience) -> Self {
        Searcher {
            needle,
            experience,
            direction: PhantomData,
        }
    }

    /// As [`find`], for a match that is not near.
    #[inline(never)]
    pub(crate) fn find<H: CodeUnit>(&mut self, haystack: &[H], from: usize) -> Option<usize> {
        let needle = self.needle;
        let places = haystack.len() - needle.len() + 1;
        let mut left = if D::IS_FORWARD { from..places } else { 0..from };
        let mut credit = INITIAL_CREDIT + needle.len() / block::BLOCK;
        loop {
            let [older, newer] = self.experience.offsets;
            let candidate = find_pair::<H, D>(
                &haystack[left.start + older..left.end + older],
                &haystack[left.start + newer..left.end + newer],
                H::from_u16(needle[older].to_u16())?,
                H::from_u16(needle[newer].to_u16())?,
            )?;
            let place = left.start + candidate;
            let common = common_prefix_len(needle, &haystack[place..place + needle.len()]);
            if common == needle.len() {
                return Some(place);
            }
            self.experience.offsets = [newer, common];
            let before = left.len();
            if D::IS_FORWARD {
                left.start = place + 1;
            } else {
                left.end = place;
            }
            let cost = COST_OF_FAILURE + common / block::BLOCK;
            match (credit + before - left.len()).checked_sub(cost) {
                Some(rest) => credit = rest,
                None => {
                    let stretch = left.len().min(SHORTEST_STRETCH.max(needle.len()));
                    let start = if D::IS_FORWARD {
                        left.start += stretch;
                        left.start - stretch
                    } else {
                        left.end -= stretch;
                        left.end
                    };
                    let part = &haystack[start..start + stretch + needle.len() - 1];
                    if let Some(found) = self.find_two_way(part) {
                        return Some(start + found);
                    }
                    credit = INITIAL_CREDIT;
                }
            }
        }
    }

    #[cold]
    #[inline(never)]
    fn find_two_way<H: CodeUnit>(&mut self, haystack: &[H]) -> Option<usize> {
        let needle = self.needle;
        let two_way = (self.experience.two_way).get_or_insert_with(|| TwoWay::new::<N, D>(needle));
        two_way.find::<H, N, D>(haystack, needle)
    }
}

#[inline(always)]
fn find_pair<T: CodeUnit, D: Direction>(a: &[T], b: &[T], x: T, y: T) -> Option<usize> {
    let pairs = Pairs::new(a, b, |a, b| (a == x) & (b == y));
    if D::IS_FORWARD {
        block::first_or_else(pairs, SHORT, |at| {
            let at = at.min(a.len() - SHORT);
            kernels::find_pair(&a[at..], &b[at..], x, y).map(|index| at + index)
        })
    } else {
        block::last_or_else(pairs, SHORT, |end| {
            let end = end.max(SHORT);
            kernels::find_last_pair(&a[..end], &b[..end], x, y)
        })
    }
}
