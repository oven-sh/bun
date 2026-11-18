//! Tests of sixteen positions at a time, in the shape that the compiler turns into one vector comparison.
//! A test keeps to that shape if it has no branch: `|` and `&`, not `||` and `&&`.

use core::hint::assert_unchecked;

pub(crate) const BLOCK: usize = 16;
pub(crate) const QUARTER: usize = BLOCK / 4;
pub(crate) const WINDOW: usize = 4 * BLOCK;

/// Positions that pass or fail a test.
pub(crate) trait Positions: Copy {
    fn len(self) -> usize;

    /// The `SIZE` positions from `start`.
    fn window<const SIZE: usize>(self, start: usize) -> Self;

    /// Whether the position `lane` of the `SIZE` from `start` passes.
    fn passes<const SIZE: usize>(self, start: usize, lane: usize) -> bool;

    /// A bit for each of the `SIZE` positions from each of `starts`, the first one lowest: [`BLOCK`] bits at most.
    #[inline(always)]
    fn gather<const SIZE: usize, const PARTS: usize>(self, starts: [usize; PARTS]) -> u32 {
        collect::<SIZE, PARTS>(
            #[inline(always)]
            |part, lane| self.passes::<SIZE>(starts[part], lane),
        )
    }

    /// Whether `gather` is not zero. Asked in that way, the compiler takes the test apart.
    #[inline(always)]
    fn any_gathered<const SIZE: usize, const PARTS: usize>(self, starts: [usize; PARTS]) -> bool {
        let failing = collect::<SIZE, PARTS>(
            #[inline(always)]
            |part, lane| !self.passes::<SIZE>(starts[part], lane),
        );
        failing != (1 << (SIZE * PARTS)) - 1
    }

    /// Whether a position passes in one of the blocks from `starts`.
    #[inline(always)]
    fn any_in<const PARTS: usize>(self, starts: [usize; PARTS]) -> bool {
        !all_lanes::<PARTS>(
            #[inline(always)]
            |part, lane| !self.passes::<BLOCK>(starts[part], lane),
        )
    }

    #[inline(always)]
    fn mask(self, at: usize) -> u32 {
        self.gather::<BLOCK, 1>([at])
    }
}

#[inline(always)]
pub(crate) fn block<T, const N: usize>(units: &[T], at: usize) -> &[T; N] {
    // In this form the compiler finds the check redundant where it is.
    assert!(N <= units.len() && at <= units.len() - N);
    // SAFETY: inside the slice.
    unsafe { &*units.as_ptr().add(at).cast() }
}

#[inline(always)]
pub(crate) fn block_mut<T, const N: usize>(units: &mut [T], at: usize) -> &mut [T; N] {
    assert!(N <= units.len() && at <= units.len() - N);
    // SAFETY: inside the slice.
    unsafe { &mut *units.as_mut_ptr().add(at).cast() }
}

/// Where the parts start that cover 4 to 16 positions, whatever their number.
#[inline(always)]
pub(crate) fn quarters(length: usize) -> [usize; 4] {
    let last = length - QUARTER;
    [0, last.min(QUARTER), last.min(2 * QUARTER), last]
}

/// The same in no order.
#[inline(always)]
pub(crate) fn unordered_quarters(length: usize) -> [usize; 4] {
    assert!(length >= QUARTER);
    let (last, inward) = (length - QUARTER, length / 8 * QUARTER);
    // SAFETY: `inward` is zero, or else half of a length of two quarters or more at most.
    unsafe { assert_unchecked(inward <= last && last - inward <= last) };
    [0, inward, last - inward, last]
}

/// The union of what `word` gives for the starts of four parts that cover 4 to 16 positions.
#[inline(always)]
pub(crate) fn union_of_quarters(length: usize, word: impl Fn(usize) -> u32) -> u32 {
    let [a, b, c, d] = unordered_quarters(length);
    word(a) | word(b) | word(c) | word(d)
}

/// All of 1 to 3 positions.
#[inline(always)]
pub(crate) fn singles(length: usize) -> [usize; 3] {
    assert!(length.wrapping_sub(1) < QUARTER - 1);
    // SAFETY: half of it.
    unsafe { assert_unchecked(length / 2 < length) };
    [0, length / 2, length - 1]
}

/// The bits for the lanes of `PARTS` parts, each of which `test` is given as the part and the lane in it.
#[inline(always)]
fn collect<const SIZE: usize, const PARTS: usize>(test: impl Fn(usize, usize) -> bool) -> u32 {
    let mut mask = 0;
    // A loop is unrolled only if the test is small.
    macro_rules! lanes {
        ($($lane:literal)*) => {$(
            if $lane < SIZE * PARTS {
                mask |= u32::from(test($lane / SIZE, $lane % SIZE)) << $lane;
            }
        )*};
    }
    lanes!(0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15);
    // Else the last lanes of two masks may be merged, or a loop around this be taken for one over lanes.
    core::hint::black_box(());
    mask
}

/// Whether all lanes of `PARTS` blocks pass.
#[inline(always)]
fn all_lanes<const PARTS: usize>(test: impl Fn(usize, usize) -> bool) -> bool {
    let mask = collect::<BLOCK, 1>(
        #[inline(always)]
        |_, lane| {
            let mut all = true;
            for part in 0..PARTS {
                all &= test(part, lane);
            }
            all
        },
    );
    mask == (1 << BLOCK) - 1
}

/// The units that pass a test.
#[derive(Clone, Copy)]
pub(crate) struct Units<'a, T, F>(pub(crate) &'a [T], pub(crate) F);

impl<T: Copy, F: Fn(T) -> bool + Copy> Positions for Units<'_, T, F> {
    #[inline(always)]
    fn len(self) -> usize {
        self.0.len()
    }

    #[inline(always)]
    fn window<const SIZE: usize>(self, start: usize) -> Self {
        Units(block::<T, SIZE>(self.0, start), self.1)
    }

    #[inline(always)]
    fn passes<const SIZE: usize>(self, start: usize, lane: usize) -> bool {
        self.1(block::<T, SIZE>(self.0, start)[lane])
    }
}

/// The indices at which the units of two slices pass a test together.
#[derive(Clone, Copy)]
pub(crate) struct Pairs<'a, A, B, F> {
    a: &'a [A],
    b: &'a [B],
    test: F,
}

impl<'a, A, B, F> Pairs<'a, A, B, F> {
    /// As far as both go.
    #[inline(always)]
    pub(crate) fn new(a: &'a [A], b: &'a [B], test: F) -> Self {
        let length = a.len().min(b.len());
        Pairs {
            a: &a[..length],
            b: &b[..length],
            test,
        }
    }
}

impl<A: Copy, B: Copy, F: Fn(A, B) -> bool + Copy> Positions for Pairs<'_, A, B, F> {
    #[inline(always)]
    fn len(self) -> usize {
        self.a.len()
    }

    #[inline(always)]
    fn window<const SIZE: usize>(self, start: usize) -> Self {
        Pairs {
            a: block::<A, SIZE>(self.a, start),
            b: block::<B, SIZE>(self.b, start),
            test: self.test,
        }
    }

    #[inline(always)]
    fn passes<const SIZE: usize>(self, start: usize, lane: usize) -> bool {
        let (a, b) = (
            block::<A, SIZE>(self.a, start),
            block::<B, SIZE>(self.b, start),
        );
        (self.test)(a[lane], b[lane])
    }
}

/// The positions that fail. A test for the highest bit alone keeps to the shape only as one for its absence.
#[derive(Clone, Copy)]
pub(crate) struct Not<P>(pub(crate) P);

impl<P: Positions> Positions for Not<P> {
    #[inline(always)]
    fn len(self) -> usize {
        self.0.len()
    }

    #[inline(always)]
    fn window<const SIZE: usize>(self, start: usize) -> Self {
        Not(self.0.window::<SIZE>(start))
    }

    #[inline(always)]
    fn passes<const SIZE: usize>(self, start: usize, lane: usize) -> bool {
        !self.0.passes::<SIZE>(start, lane)
    }

    #[inline(always)]
    fn gather<const SIZE: usize, const PARTS: usize>(self, starts: [usize; PARTS]) -> u32 {
        !self.0.gather::<SIZE, PARTS>(starts) & ((1 << (SIZE * PARTS)) - 1)
    }
}

/// The mask of all positions, which are a block at most.
#[inline(always)]
pub(crate) fn short_mask(positions: impl Positions) -> u32 {
    let length = positions.len();
    debug_assert!(length <= BLOCK);
    if let Some(last) = length.checked_sub(QUARTER) {
        let gathered = positions.gather::<QUARTER, 4>(quarters(length));
        gathered & ((1 << last) - 1) | gathered >> (3 * QUARTER) << last
    } else if length > 0 {
        positions.gather::<1, 3>(singles(length)) & ((1 << length) - 1)
    } else {
        0
    }
}

/// The mask of all positions, which are a window at most.
#[inline(always)]
pub(crate) fn window_mask(positions: impl Positions) -> u64 {
    let Some(last) = positions.len().checked_sub(BLOCK) else {
        return u64::from(short_mask(positions));
    };
    debug_assert!(positions.len() <= WINDOW);
    let mut mask = bits_at(positions, 0) | bits_at(positions, last);
    if last > BLOCK {
        mask |= bits_at(positions, BLOCK) | bits_at(positions, last - BLOCK);
    }
    mask
}

#[inline(always)]
fn bits_at(positions: impl Positions, at: usize) -> u64 {
    u64::from(positions.mask(at)) << at
}

#[inline(always)]
fn lowest(mask: u32) -> Option<usize> {
    (mask != 0).then(|| mask.trailing_zeros() as usize)
}

#[inline(always)]
fn highest(mask: u32) -> Option<usize> {
    mask.checked_ilog2().map(|bit| bit as usize)
}

/// Among less than a block of positions, the one for the bit that `pick` picks.
#[inline(always)]
fn pick_short(positions: impl Positions, pick: impl Fn(u32) -> Option<usize>) -> Option<usize> {
    let length = positions.len();
    if let Some(last) = length.checked_sub(QUARTER) {
        let lane = pick(positions.gather::<QUARTER, 4>(quarters(length)))?;
        Some((lane & !(QUARTER - 1)).min(last) + lane % QUARTER)
    } else if length > 0 {
        let lane = pick(positions.gather::<1, 3>(singles(length)))?;
        Some(lane.min(length - 1))
    } else {
        None
    }
}

#[inline(always)]
pub(crate) fn any(positions: impl Positions) -> bool {
    let length = positions.len();
    let Some(last) = length.checked_sub(BLOCK) else {
        return match length {
            0 => false,
            1..QUARTER => positions.any_gathered::<1, 3>(singles(length)),
            _ => positions.any_gathered::<QUARTER, 4>(unordered_quarters(length)),
        };
    };
    let last_but_one = length.saturating_sub(2 * BLOCK);
    let mut at = 0;
    while at < last_but_one {
        if positions.window::<{ 2 * BLOCK }>(at).any_in([0, BLOCK]) {
            return true;
        }
        at += 2 * BLOCK;
    }
    positions.any_in([last_but_one, last])
}

/// [`any`] of four blocks or more, for a test that costs little.
#[inline(always)]
pub(crate) fn any_of_many(positions: impl Positions) -> bool {
    const STARTS: [usize; 4] = [0, BLOCK, 2 * BLOCK, 3 * BLOCK];
    assert!(positions.len() >= 4 * BLOCK);
    let last = positions.len() - 4 * BLOCK;
    let mut at = 0;
    while at < last {
        if positions.window::<{ 4 * BLOCK }>(at).any_in(STARTS) {
            return true;
        }
        at += 4 * BLOCK;
    }
    positions.window::<{ 4 * BLOCK }>(last).any_in(STARTS)
}

#[inline(always)]
pub(crate) fn first(positions: impl Positions) -> Option<usize> {
    first_or_else(positions, usize::MAX, |_| None)
}

/// Past `limit`, a whole number of blocks, `rest` looks from the position it is given, which has more than a block
/// behind it.
#[inline(always)]
pub(crate) fn first_or_else(
    positions: impl Positions,
    limit: usize,
    rest: impl FnOnce(usize) -> Option<usize>,
) -> Option<usize> {
    let Some(last) = positions.len().checked_sub(BLOCK) else {
        return pick_short(positions, lowest);
    };
    let mut at = 0;
    while at < last {
        if at == limit {
            return rest(at);
        }
        if let Some(lane) = lowest(positions.mask(at)) {
            return Some(at + lane);
        }
        at += BLOCK;
    }
    lowest(positions.mask(last)).map(|lane| last + lane)
}

#[inline(always)]
pub(crate) fn last(positions: impl Positions) -> Option<usize> {
    last_or_else(positions, usize::MAX, |_| None)
}

/// [`first_or_else`] from the end: `rest` looks before the position it is given.
#[inline(always)]
pub(crate) fn last_or_else(
    positions: impl Positions,
    limit: usize,
    rest: impl FnOnce(usize) -> Option<usize>,
) -> Option<usize> {
    let length = positions.len();
    if length < BLOCK {
        return pick_short(positions, highest);
    }
    let mut end = length;
    while end > BLOCK {
        if length - end == limit {
            return rest(end);
        }
        end -= BLOCK;
        if let Some(lane) = highest(positions.mask(end)) {
            return Some(end + lane);
        }
    }
    highest(positions.mask(0))
}

#[inline(always)]
pub(crate) fn count(positions: impl Positions) -> usize {
    let Some(last) = positions.len().checked_sub(BLOCK) else {
        return short_mask(positions).count_ones() as usize;
    };
    let (mut at, mut count) = (0, 0);
    while at < last {
        count += positions.mask(at).count_ones() as usize;
        at += BLOCK;
    }
    count + (positions.mask(last) >> (at - last)).count_ones() as usize
}
