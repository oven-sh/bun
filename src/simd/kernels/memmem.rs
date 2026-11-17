//! A text in a text.
use bun_simd::{Int, Isa, Matches, SharedU8, Source, opaque};
use core::ops::{ControlFlow, ControlFlow::*, Range};
use core::ptr;

pub(crate) trait Unit = Source<Lane: Ord + From<u8> + Into<u32>>;
type SharedU16 = [SharedU8; 2];

/// After so many bytes or false candidates, it can pay to look for better units than the ends.
const BYTES_BEFORE_LEARNING: usize = 4096;
const MISSES_BEFORE_LEARNING: usize = 16;
const MOST_MISSES: usize = 128;
/// The counts of `scan` have to fit.
const _: () = assert!(MOST_MISSES + 255 / 4 < 255);
const SAMPLE_LEN: usize = 256;
/// A step of `two_way` that goes so far is cheaper than a scan.
const FAR: usize = 64;

/// Costs are in steps of `two_way`.
const COST_OF_MISS: usize = 3;
const COST_OF_CALL: usize = 32;
const COST_OF_TURN: usize = 64;
const COST_OF_SAMPLE: usize = 4 * SAMPLE_LEN;
const SCANNED_PER_STEP: usize = 32;

/// What `two_way` could cost for the starts that a pair of units has passed, and what it has cost.
type Turn = [usize; 2];

fn beats(a: Turn, b: Turn) -> bool {
    a[0] as u128 * b[1] as u128 > b[0] as u128 * a[1] as u128
}

/// Which two units of the needle are tested.
struct Plan {
    pair: [usize; 2],
    best: [usize; 2],
    to_beat: Turn,
    /// The ends of the needle, or its rarest units.
    usual: [usize; 2],
    is_trial: bool,
    trials: usize,
    /// The misses that the best pair may have.
    patience: usize,
}

impl Plan {
    fn new(usual: [usize; 2], to_beat: Turn, starts_with_trial: bool) -> Self {
        Self {
            pair: usual,
            best: usual,
            to_beat,
            usual,
            is_trial: !starts_with_trial,
            trials: usize::from(!starts_with_trial),
            patience: MISSES_BEFORE_LEARNING / 2,
        }
    }

    fn is_usual(&self, pair: [usize; 2]) -> bool {
        pair.iter().all(|it| self.usual.contains(it))
    }

    /// Returns the misses that the next turn may have. `telling` has differed most often.
    #[inline(never)]
    fn next_turn(&mut self, turn: Turn, telling: [usize; 2], rare: Option<[usize; 2]>) -> usize {
        if self.is_trial && beats([turn[0] / 2, turn[1]], self.to_beat) {
            self.patience = MISSES_BEFORE_LEARNING / 2;
        }
        if !self.is_trial || beats(turn, self.to_beat) {
            (self.best, self.to_beat) = (self.pair, turn);
        }
        let is_too_slow = self.to_beat[1] > self.to_beat[0];
        self.is_trial = !self.is_trial || rare.is_some() || is_too_slow;
        if !self.is_trial {
            (self.pair, self.patience) = (self.best, MOST_MISSES.min(2 * self.patience));
            return self.patience;
        }
        self.pair = match (rare, self.trials % 3) {
            (Some(rare), _) => rare,
            (_, 1) if telling[0] != telling[1] => telling,
            (_, 2) if is_too_slow || !self.is_usual(self.best) => self.usual,
            _ if self.pair.contains(&telling[0]) => self.pair,
            _ => [telling[0], self.pair[self.trials % 2]],
        };
        self.trials += 1;
        MISSES_BEFORE_LEARNING
    }
}

/// What the turns may still cost.
struct Budget {
    /// Until units are ranked, this time and the next time.
    until_ranking: [usize; 2],
    /// More than `two_way` could.
    until_fallback: usize,
    /// About what it takes to prepare `two_way`.
    setup: usize,
    next_fallback: usize,
}

impl Budget {
    fn new(len: usize, is_ranked: bool, spent: usize) -> Self {
        let setup = len.saturating_add(128).saturating_mul(4);
        let ranking = if is_ranked {
            COST_OF_SAMPLE
        } else {
            len + len / 2
        };
        Self {
            until_ranking: [ranking.saturating_sub(spent), ranking],
            until_fallback: setup,
            setup,
            next_fallback: setup,
        }
    }

    fn pay_for_ranking(&mut self) {
        let next = self.until_ranking[1].saturating_add(COST_OF_SAMPLE);
        self.until_ranking = [next, next.saturating_mul(2)];
    }

    /// Returns how far `two_way` has to take over.
    #[inline(never)]
    fn pay_for(&mut self, [distance, cost]: Turn) -> usize {
        let left = (self.until_fallback + distance).checked_sub(cost + COST_OF_TURN);
        let far = left.map_or(self.next_fallback, |_| 0);
        self.until_fallback = left.map_or(4 * COST_OF_TURN, |it| self.setup.min(it));
        self.until_ranking[0] = self.until_ranking[0].saturating_sub(cost + far / 4);
        self.next_fallback += far;
        far
    }
}

/// The false candidates of a turn.
#[derive(Default)]
struct Misses {
    left: isize,
    /// Where the last one that was compared in full has differed.
    in_needle: usize,
    in_haystack: usize,
    /// How many units were looked at.
    compared: usize,
}

#[inline(always)]
fn next<const FORWARD: bool>(matches: &mut Matches) -> Option<usize> {
    match FORWARD {
        true => matches.next(),
        false => matches.next_back(),
    }
}

/// How many of the `starts` are up to and at `at`.
#[inline(always)]
fn seen_at<const FORWARD: bool>(at: usize, starts: usize) -> usize {
    if FORWARD { at + 1 } else { starts - at }
}

#[inline(always)]
fn window<S>(haystack: &[S], at: usize, len: usize) -> Option<&[S]> {
    // From this, LLVM sees that the checks below hold.
    if at > haystack.len().checked_sub(len)? {
        return None;
    }
    haystack.get(at..)?.get(..len)
}

/// `find` returns the first unit of what it found. Unlike an index, that takes one register.
#[inline(always)]
pub(crate) fn index_with<'a, S, const FORWARD: bool>(
    haystack: &'a [S],
    needle: &[S],
    find: impl FnOnce(&'a [S], &[S]) -> Option<&'a S>,
) -> Option<usize> {
    match needle.len() {
        0 => Some(if FORWARD { 0 } else { haystack.len() }),
        len if len > haystack.len() => None,
        _ => find(haystack, needle)
            .map(|found| (ptr::from_ref(found).addr() - haystack.as_ptr().addr()) / size_of::<S>()),
    }
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{Mask, U8, U16, Vector};

    #[inline(always)]
    fn have_equal_ends<S: Unit, const N: usize>(a: &[S], b: &[S]) -> Option<bool> {
        let load = |units| Vector::load(units).to_array();
        let are_first_equal = load(a.first_chunk::<N>()?) == load(b.first_chunk()?);
        Some(are_first_equal && load(a.split_last_chunk()?.1) == load(b.split_last_chunk()?.1))
    }

    /// For slices of the same length that start and end alike. `None` if they may differ in the middle.
    #[inline(always)]
    fn are_equal<S: Unit, const M: usize>(a: &[S], b: &[S]) -> Option<bool> {
        match a.len() {
            len if len > 2 * M => have_equal_ends::<S, M>(a, b).filter(|it| !it),
            len if len >= M => have_equal_ends::<S, M>(a, b),
            8.. => have_equal_ends::<S, 8>(a, b),
            4.. => have_equal_ends::<S, 4>(a, b),
            len => Some(a.get(len / 2)?.get() == b.get(len / 2)?.get()),
        }
    }

    /// How many of the `starts` are up to and in the block.
    #[inline(always)]
    fn seen_with<S: Unit<Lane: Int<N>>, const N: usize, const FORWARD: bool>(
        block: &Matches,
        starts: usize,
    ) -> usize {
        match FORWARD {
            true => block.start() + Vector::<S::Lane, N>::BLOCK_LEN,
            false => starts - block.start(),
        }
    }

    /// The first or the last index at which they differ.
    #[inline(never)]
    fn difference<S, const N: usize, const M: usize, const FORWARD: bool>(
        a: &[S],
        b: &[S],
    ) -> Option<usize>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        match a.len().min(b.len()) {
            len if len >= N => {
                Vector::<_, N>::position_near::<S, 2, FORWARD>([a, b], |[a, b]| a.simd_ne(b))
            }
            len if len >= M => {
                Vector::<_, M>::position_near::<S, 2, FORWARD>([a, b], |[a, b]| a.simd_ne(b))
            }
            _ => difference_by_units::<S, FORWARD>(a, b),
        }
    }

    /// Compares in full those that do not differ like the last one.
    #[inline(never)]
    fn first_match<'a, S, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        mut candidates: Matches,
        misses: &mut Misses,
    ) -> Option<&'a S>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        while let Some(at) = next::<FORWARD>(&mut candidates) {
            let candidate = window(haystack, at, needle.len())?;
            let differs = |i: usize| Some(needle.get(i)?.get() != candidate.get(i)?.get());
            misses.compared += 1;
            if differs(misses.in_needle)?
                || differs(misses.in_haystack.wrapping_sub(at)) == Some(true)
            {
                continue;
            }
            let Some(found) = difference::<S, N, M, FORWARD>(needle, candidate) else {
                return candidate.first();
            };
            let equal = found.abs_diff(if FORWARD { 0 } else { needle.len() - 1 });
            [misses.in_needle, misses.in_haystack] = [found, at + found];
            (misses.compared, misses.left) = (misses.compared + equal, misses.left - 3);
        }
        None
    }

    #[inline(always)]
    fn is_past<S: Unit<Lane: Int<N>>, const N: usize>(needle: &[S]) -> Mask<S::Lane, N> {
        Vector::iota().simd_ge(S::Lane::from(needle.len().min(N) as u8))
    }

    /// Returns a match, or how far `range` and the misses have lasted. Counts which units were there.
    #[inline(never)]
    fn scan<'a, S, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        &[head, tail, x, y]: &[Vector<S::Lane, N>; 4],
        places: [&[S]; 2],
        range: Range<usize>,
        (misses, counts_so_far): (&mut Misses, &mut [Vector<S::Lane, N>; 2]),
    ) -> ControlFlow<&'a S, usize>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        // If LLVM knows it, it does not add under a mask register.
        let one = if isa::Isa::HAS_MASK_REGISTERS {
            opaque(1)
        } else {
            1
        };
        let one = Vector::splat(S::Lane::from(one as u8));
        let past = is_past::<S, N>(needle);
        let test = |[a, b]: [Vector<_, N>; 2]| a.simd_eq(x) & b.simd_eq(y);
        let (mut left, mut counts, starts) = (misses.left, *counts_so_far, places[0].len());
        let mut seen = range.end;
        for mut block in Vector::matches_in::<S, 2, FORWARD>(places, range, test) {
            let mut until = seen_with::<S, N, FORWARD>(&block, starts);
            // Not in the last block of all, where the turn could end before it began.
            if block.clone().count() > left.cast_unsigned() && until < starts {
                let farthest = match FORWARD {
                    true => block.clone().nth(left.cast_unsigned() - 1),
                    false => block.clone().nth_back(left.cast_unsigned() - 1),
                };
                block.cut_at(farthest.unwrap_or_default(), !FORWARD);
                until = farthest.map_or(until, |at| seen_at::<FORWARD>(at, starts));
            }
            left -= block.clone().count().cast_signed();
            block.retain(|at| {
                let units = window(haystack, at, needle.len().max(N)).unwrap_or_default();
                let (Some(a), Some((_, b))) = (units.first_chunk(), units.split_last_chunk())
                else {
                    return true;
                };
                let mut same = head.simd_eq(Vector::load(a));
                counts[0] += same.select(one, Vector::zero());
                // Elsewhere, the branch costs more than to do the same twice.
                if needle.len() > N || !isa::Isa::HAS_MASK_REGISTERS {
                    let in_tail = tail.simd_eq(Vector::load(b));
                    counts[1] += in_tail.select(one, Vector::zero());
                    same = same & in_tail;
                }
                same.covers(!past)
            });
            if !block.is_empty() {
                misses.left = left;
                if let Some(found) =
                    first_match::<S, N, M, FORWARD>(haystack, needle, block.clone(), misses)
                {
                    return Break(found);
                }
                left = misses.left;
            }
            if left <= 0 {
                seen = until;
                break;
            }
        }
        (misses.left, *counts_so_far) = (left, counts);
        Continue(seen)
    }

    /// Runs `two_way` where six units match. Two of them are where it has found a difference last.
    #[inline(never)]
    fn cross<'a, S, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        halves @ ((split, _), _): (Halves, u64),
        usual: [usize; 2],
        [mut seen, end]: [usize; 2],
    ) -> ControlFlow<Option<&'a S>, usize>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        let (last, starts) = (needle.len() - 1, haystack.len() - needle.len() + 1);
        let index = |n: usize| last.min(n).abs_diff(if FORWARD { 0 } else { last });
        // Far steps start where the right half matches: so many candidates need nothing else.
        let (mut credit, mut learned) = ((last / FAR).cast_signed(), [split + 4, split + 5]);
        let (earned, difference) = (1 + credit / 2, difference::<S, N, M, FORWARD>);
        let [a, b, e, f] = [0, 1, 2, 3].map(|i| index(split + i));
        loop {
            let ([c, d], [e, f]) = (learned.map(index), if credit > 0 { [e, f] } else { usual });
            let units = [a, b, c, d, e, f].map(|i| Vector::<_, N>::splat(needle[i].get()));
            let places = [a, b, c, d, e, f].map(|i| &haystack[i..][..starts]);
            let has = |v: [Vector<_, N>; 6], i: usize| v[i].simd_eq(units[i]);
            let test = |v| (1..6).fold(has(v, 0), |all, i| all & has(v, i));
            let mut blocks = Vector::matches_in::<S, 6, FORWARD>(places, seen..end, test);
            let Some(block) = blocks.next() else {
                return Continue(seen.max(end));
            };
            let until = seen_with::<S, N, FORWARD>(&block, starts);
            let range = seen.max(until - Vector::<S::Lane, N>::BLOCK_LEN)..until;
            let (state, taken);
            (state, learned[1]) = ((range, block, [learned[0], end]), learned[0]);
            [seen, learned[0], taken] =
                two_way::<S, FORWARD>(haystack, needle, state, halves, difference)?;
            credit += taken.cast_signed() * if credit > 0 { -1 } else { earned };
            credit += (2 * (seen - until) / FAR).cast_signed();
        }
    }

    /// Takes turns between the best pair of units so far and another one.
    #[inline(never)]
    fn find_far<'a, S, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        mut seen: usize,
        differs: usize,
    ) -> Option<&'a S>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        let (len, last) = (needle.len(), needle.len().checked_sub(1)?);
        let starts = haystack.len().checked_sub(last)?;
        let unit = |index: usize| Some(Vector::<_, N>::splat(needle.get(index)?.get()));
        let place = |index: usize| haystack.get(index..)?.get(..starts);
        let of = |[a, b]: [usize; 2]| Some(([place(a)?, place(b)?], [unit(a)?, unit(b)?]));
        let [head] = Vector::<_, N>::load_or_zero(needle);
        let tail = needle.last_chunk().map_or(head, |it| Vector::load(it));
        let (usual, has_hint) = (if FORWARD { [last, 0] } else { [0, last] }, differs != 0);
        let spent = COST_OF_MISS * MISSES_BEFORE_LEARNING;
        // The longer the needle, the farther the steps of `two_way` can go.
        let per_step = (len / 32).clamp(1, 8);
        let (mut turn, mut telling) = ([seen / per_step, spent], [differs; 2]);
        let mut plan = Plan::new(usual, turn, has_hint);
        let (mut misses, mut counts, mut stretch) = (Misses::default(), [Vector::zero(); 2], 8 * N);
        let (mut is_ranked, mut halves) = (len <= 16, None);
        let mut budget = Budget::new(len, is_ranked, if has_hint { 0 } else { spent });
        loop {
            let mut rare = None;
            if budget.until_ranking[0] == 0 {
                let sample = match (is_ranked, FORWARD) {
                    (false, _) => needle,
                    (true, true) => haystack.get(seen..)?.chunks(SAMPLE_LEN).next()?,
                    (true, false) => haystack
                        .get(..starts - seen + last)?
                        .rchunks(SAMPLE_LEN)
                        .next()?,
                };
                rare = Some(rarest_two(needle, sample));
                plan.usual = rare.filter(|_| !is_ranked).unwrap_or(plan.usual);
                budget.pay_for_ranking();
                (is_ranked, stretch) = (true, 8 * N);
            }
            let (tried, mut left) = (plan.pair, plan.next_turn(turn, telling, rare));
            if !plan.is_trial && !plan.is_usual(plan.pair) && !plan.is_usual(tried) {
                let ((places, [x, y]), block) = (of(plan.usual)?, Vector::<S::Lane, N>::BLOCK_LEN);
                let test = |[a, b]: [Vector<_, N>; 2]| a.simd_eq(x) & b.simd_eq(y);
                let next = Vector::matches_in::<S, 2, FORWARD>(places, seen..seen + block, test);
                let count = 1 + next.flatten().count();
                if beats([block / per_step, 2 * COST_OF_MISS * count], plan.to_beat) {
                    (plan.pair, plan.is_trial, left) = (plan.usual, true, MISSES_BEFORE_LEARNING);
                }
            }
            let (began, mut cost, left) = (seen, 0, left.cast_signed());
            (misses.left, misses.compared, counts) = (left, 0, counts.map(|it| it >> 2));
            while misses.left > 0 && cost < budget.until_ranking[0] {
                let (places, [x, y]) = of(plan.pair)?;
                // From here, it could not go back to an aligned address.
                let is_early = seen < N;
                let skipped = match is_early {
                    true => seen,
                    false => Vector::skip::<S, FORWARD>(places[0], seen, |v| [v.simd_eq(x); 2]),
                };
                let has_paid = is_early || skipped >= seen + 32 * N;
                stretch = if has_paid { 8 * N } else { stretch };
                let range = skipped.max(seen)..skipped.saturating_add(stretch);
                let (units, state) = ([head, tail, x, y], (&mut misses, &mut counts));
                match scan::<S, N, M, FORWARD>(haystack, needle, &units, places, range, state) {
                    Break(found) => return Some(found),
                    Continue(until) if until >= starts => return None,
                    Continue(until) => seen = until,
                }
                if has_paid {
                    cost += if is_early { 0 } else { COST_OF_CALL };
                } else if misses.left > 0 {
                    plan.pair = [plan.pair[1], plan.pair[0]];
                    // Close to the end, a ranking would not pay.
                    cost += stretch.min(starts - seen) / SCANNED_PER_STEP;
                    stretch = stretch.saturating_mul(4);
                }
            }
            cost += COST_OF_MISS.min(len / 2) * left.abs_diff(misses.left);
            cost += misses.compared / N;
            turn = [(seen - began) / per_step, cost];
            if let far @ 1.. = budget.pay_for(turn) {
                let halves = *halves.get_or_insert_with(|| halves_and_bits::<S, FORWARD>(needle));
                let range = [seen, seen + far];
                match cross::<S, N, M, FORWARD>(haystack, needle, halves, plan.usual, range) {
                    Break(found) => return found,
                    Continue(until) if until >= starts => return None,
                    Continue(until) => seen = until,
                }
            }
            let counts = [counts[0], counts[usize::from(len > N)]];
            let [in_head, in_tail] = counts.map(|it| it | is_past::<S, N>(needle).to_vector());
            let lowest = in_head.simd_min(in_tail).to_array();
            let least = lowest.iter().fold(lowest[0], |a, &b| a.min(b));
            let a = in_head.simd_eq(least).first_set();
            let b = in_tail.simd_eq(least).last_set();
            let b = b.map(|lane| lane + len.saturating_sub(N));
            telling = match misses.compared {
                0 => [a.or(b)?, b.or(a)?],
                _ => [misses.in_needle; 2],
            };
        }
    }

    /// Learns from the nearest candidate, unless there is only this block.
    #[inline(never)]
    fn find_long<'a, S, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        mut matches: Matches,
    ) -> Option<&'a S>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        let starts = haystack.len() - needle.len() + 1;
        if starts <= Vector::<S::Lane, N>::BLOCK_LEN {
            let misses = &mut Misses::default();
            return first_match::<S, N, M, FORWARD>(haystack, needle, matches, misses);
        }
        let at = next::<FORWARD>(&mut matches)?;
        let candidate = window(haystack, at, needle.len())?;
        let Some(differs) = difference::<S, N, M, FORWARD>(needle, candidate) else {
            return candidate.first();
        };
        let seen = seen_at::<FORWARD>(at, starts);
        find_far::<S, N, M, FORWARD>(haystack, needle, seen, differs)
    }

    /// The places of the first and the last unit of the needle, and those units.
    #[inline(always)]
    fn ends<'a, S: Unit<Lane: Int<N>>, const N: usize>(
        haystack: &'a [S],
        needle: &[S],
    ) -> Option<([&'a [S]; 2], [Vector<S::Lane, N>; 2])> {
        let (first, (last, before)) = (needle.first()?, needle.split_last()?);
        let (_, at_last) = haystack.split_at_checked(before.len())?;
        let units = [Vector::splat(first.get()), Vector::splat(last.get())];
        Some(([haystack.get(..at_last.len())?, at_last], units))
    }

    /// Until there are too many candidates, or none for long.
    #[inline(never)]
    fn find_next<'a, S, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        mut seen: usize,
    ) -> Option<&'a S>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        let (places, [first, last]) = ends::<S, N>(haystack, needle)?;
        let test = |[x, y]: [Vector<_, N>; 2]| x.simd_eq(first) & y.simd_eq(last);
        let starts = places[0].len();
        if seen + 8 * N < starts {
            let (place, unit) = match FORWARD {
                true => (places[0], first),
                false => (places[1], last),
            };
            seen = Vector::skip::<S, FORWARD>(place, seen, |x| [x.simd_eq(unit); 2]);
        }
        let stretch = BYTES_BEFORE_LEARNING / size_of::<S>();
        // Close to the end, it would not pay.
        let is_close = seen + 4 * stretch >= starts;
        let range = seen..if is_close { starts } else { seen + stretch };
        let mut left = MISSES_BEFORE_LEARNING;
        for mut matches in Vector::matches_in::<S, 2, FORWARD>(places, range.clone(), test) {
            while !matches.is_empty() {
                let mut others = matches.clone();
                let at = next::<FORWARD>(&mut others)?;
                let candidate = window(haystack, at, needle.len())?;
                match are_equal::<S, M>(needle, candidate) {
                    Some(true) => return candidate.first(),
                    Some(false) if left > 0 => (matches, left) = (others, left - 1),
                    Some(false) => {
                        let seen = seen_at::<FORWARD>(at, starts);
                        return find_far::<S, N, M, FORWARD>(haystack, needle, seen, 0);
                    }
                    None => return find_long::<S, N, M, FORWARD>(haystack, needle, matches),
                }
            }
        }
        match range.end < starts {
            true => find_far::<S, N, M, FORWARD>(haystack, needle, range.end, 0),
            false => None,
        }
    }

    #[inline(always)]
    pub(crate) fn find<'a, S, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
    ) -> Option<&'a S>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        let (places, [first, last]) = ends::<S, N>(haystack, needle)?;
        let test = |[x, y]: [Vector<_, N>; 2]| x.simd_eq(first) & y.simd_eq(last);
        let (starts, block) = (places[0].len(), Vector::<S::Lane, N>::BLOCK_LEN);
        let mut matches = Vector::matches_near::<S, 2, FORWARD>(places, test);
        if matches.is_empty() && starts > block {
            if starts > block + 8 * N {
                return find_next::<S, N, M, FORWARD>(haystack, needle, block);
            }
            matches = Vector::matches_in::<S, 2, FORWARD>(places, block..starts, test).next()?;
        }
        let mut left = MISSES_BEFORE_LEARNING;
        #[rustc_unroll(never)]
        while !matches.is_empty() {
            let mut others = matches.clone();
            let at = next::<FORWARD>(&mut others)?;
            let candidate = window(haystack, at, needle.len())?;
            match are_equal::<S, M>(needle, candidate) {
                Some(true) => return candidate.first(),
                Some(false) if left > 0 => (matches, left) = (others, left - 1),
                _ => return find_long::<S, N, M, FORWARD>(haystack, needle, matches),
            }
        }
        match seen_with::<S, N, FORWARD>(&matches, starts) {
            seen if seen < starts => find_next::<S, N, M, FORWARD>(haystack, needle, seen),
            _ => None,
        }
    }

    #[export]
    pub fn memmem<'a>(haystack: &'a [u8], needle: &[u8]) -> Option<&'a u8> {
        find::<_, { U8::LEN }, 16, true>(haystack, needle)
    }

    #[export]
    pub fn memmem_shared<'a>(
        haystack: &'a [SharedU8],
        needle: &[SharedU8],
    ) -> Option<&'a SharedU8> {
        find::<_, { U8::LEN }, 16, true>(haystack, needle)
    }

    #[export]
    pub fn memrmem<'a>(haystack: &'a [u8], needle: &[u8]) -> Option<&'a u8> {
        find::<_, { U8::LEN }, 16, false>(haystack, needle)
    }

    #[export]
    pub fn memrmem_shared<'a>(
        haystack: &'a [SharedU8],
        needle: &[SharedU8],
    ) -> Option<&'a SharedU8> {
        find::<_, { U8::LEN }, 16, false>(haystack, needle)
    }

    #[export]
    pub fn memmem16_shared<'a>(
        haystack: &'a [SharedU16],
        needle: &[SharedU16],
    ) -> Option<&'a SharedU16> {
        find::<_, { U16::LEN }, 8, true>(haystack, needle)
    }

    #[export]
    pub fn memrmem16<'a>(haystack: &'a [u16], needle: &[u16]) -> Option<&'a u16> {
        find::<_, { U16::LEN }, 8, false>(haystack, needle)
    }

    #[export]
    pub fn memrmem16_shared<'a>(
        haystack: &'a [SharedU16],
        needle: &[SharedU16],
    ) -> Option<&'a SharedU16> {
        find::<_, { U16::LEN }, 8, false>(haystack, needle)
    }
}

/// The places of the two units of `needle` whose low bytes are rarest in `sample`.
#[inline(never)]
fn rarest_two<S: Unit>(needle: &[S], sample: &[S]) -> [usize; 2] {
    let (mut counts, low_byte) = ([0u32; 256], |unit: &S| unit.get().into() as usize & 0xFF);
    for unit in sample {
        counts[low_byte(unit)] = counts[low_byte(unit)].wrapping_add(1);
    }
    let [mut rarest, mut second] = [(u32::MAX, 0); 2];
    for (i, unit) in needle.iter().enumerate() {
        let it = (counts[low_byte(unit)], i);
        if it.0 < rarest.0 {
            (rarest, second) = (it, if rarest.0 < second.0 { rarest } else { second });
        } else if it.0 <= second.0 {
            second = it;
        }
    }
    [rarest.1, second.1]
}

#[inline(always)]
fn nth<S: Unit, const FORWARD: bool>(units: &[S], n: usize) -> S::Lane {
    units[if FORWARD { n } else { units.len() - 1 - n }].get()
}

#[inline(always)]
fn difference_by_units<S: Unit, const FORWARD: bool>(a: &[S], b: &[S]) -> Option<usize> {
    let (mut pairs, differ) = (a.iter().zip(b), |(a, b): (&S, &S)| a.get() != b.get());
    match FORWARD {
        true => pairs.position(differ),
        false => pairs.rposition(differ),
    }
}

type Difference<S> = fn(&[S], &[S]) -> Option<usize>;

/// Where the greatest suffix in the given order starts, and its period.
fn maximal_suffix<S: Unit, const FORWARD: bool>(needle: &[S], is_ascending: bool) -> [usize; 2] {
    let (mut start, mut candidate, mut offset, mut period) = (0, 1, 0, 1);
    while candidate + offset < needle.len() {
        let [a, b] = [candidate, start].map(|from| nth::<S, FORWARD>(needle, from + offset));
        if a == b && offset + 1 < period {
            offset += 1;
        } else if a == b {
            (candidate, offset) = (candidate + period, 0);
        } else if (a < b) == is_ascending {
            (candidate, offset) = (candidate + offset + 1, 0);
            period = candidate - start;
        } else {
            (start, candidate, offset, period) = (candidate, candidate + 1, 0, 1);
        }
    }
    [start, period]
}

/// Where to split the needle. If only the right half matches: how far to move, and what matches then.
type Halves = (usize, (usize, usize));

/// Units that differ may have the same bit.
#[inline(always)]
fn bit_of(unit: impl Into<u32>) -> u64 {
    1 << (unit.into() % 64)
}

fn halves(len: usize, [split, period]: [usize; 2], is_periodic: bool) -> Halves {
    match is_periodic && split < period {
        true => (split, (period, len - period)),
        false => (split, (split.max(len - split) + 1, 0)),
    }
}

#[inline(never)]
fn halves_and_bits<S: Unit, const FORWARD: bool>(needle: &[S]) -> (Halves, u64) {
    let nth = nth::<S, FORWARD>;
    let [ascending, descending] = [true, false].map(|it| maximal_suffix::<S, FORWARD>(needle, it));
    let [split, period] = ascending.max(descending);
    let is_periodic = (0..split).all(|i| nth(needle, i) == nth(needle, period + i));
    let (mut bits, mut units) = (0, needle.iter());
    while let Some(unit) = units.next().filter(|_| bits != u64::MAX) {
        bits |= bit_of(unit.get());
    }
    (halves(needle.len(), [split, period], is_periodic), bits)
}

/// The algorithm of Crochemore and Perrin, in linear time even if `needle` has changed since.
#[inline(never)]
fn two_way<'a, S: Unit, const FORWARD: bool>(
    haystack: &'a [S],
    needle: &[S],
    (range, mut candidates, [mut differs, until]): (Range<usize>, Matches, [usize; 2]),
    ((split, after_right_half), bits): (Halves, u64),
    difference: Difference<S>,
) -> ControlFlow<Option<&'a S>, [usize; 3]> {
    let (len, mut seen, mut is_due) = (needle.len(), range.start, false);
    let [mut known, mut taken] = [0; 2];
    // What is known has been paid for.
    while seen < range.end + 4 * FAR || known > 0 || is_due {
        let back = haystack.len().wrapping_sub(len).wrapping_sub(seen);
        let at = if FORWARD { seen } else { back };
        let Some(window) = window(haystack, at, len) else {
            return Break(None);
        };
        // The first `n` for which `nth` differs.
        let mismatch = |start: usize, end: usize| {
            let part = match FORWARD {
                true => start..end,
                false => len - end..len - start,
            };
            let (a, b) = (&needle[part.clone()], &window[part]);
            let at = match a.len() > 16 {
                true => difference(a, b)?,
                false => difference_by_units::<S, FORWARD>(a, b)?,
            };
            Some(if FORWARD { start + at } else { end - 1 - at })
        };
        if bits & bit_of(nth::<S, FORWARD>(window, len - 1)) == 0 {
            (seen, known, is_due) = (seen + len, 0, len >= FAR);
            continue;
        }
        if known == 0 && !is_due {
            candidates.cut_at(at, FORWARD);
            let Some(next) = next::<FORWARD>(&mut candidates) else {
                return Continue([seen.max(range.end), differs, taken]);
            };
            (seen, is_due, taken) = (seen + next.abs_diff(at), true, taken + 1);
            continue;
        }
        // The call pays only if much is equal, as it was the last time.
        let (start, was_near) = (split.max(known), (split..split + 16).contains(&differs));
        let end = if was_near { len.min(start + 16) } else { len };
        let step;
        ((step, known), differs) = match mismatch(start, end) {
            Some(n) => ((n - split + 1, 0), n),
            None if end < len => ((0, known), end),
            None => match mismatch(known.min(split), split) {
                Some(n) => (after_right_half, n),
                None => return Break(window.first()),
            },
        };
        (seen, is_due) = (seen + step, step == 0 || step >= FAR && seen < until);
    }
    Continue([seen, differs, taken])
}

#[cfg(all(test, not(miri)))]
mod tests {
    use super::*;
    use bun_simd::portable::U8;
    use core::cell::Cell;

    /// All that have three letters at most.
    fn texts(len: u32) -> impl Iterator<Item = Vec<u8>> {
        let letter = |n: u32| [0, 63, 64][n as usize % 3];
        let text = move |n| (0..len).map(|i| letter(n / 3u32.pow(i))).collect();
        (0..3u32.pow(len)).map(text)
    }

    thread_local!(static MAY_COMPARE: Cell<usize> = const { Cell::new(0) });

    fn difference<const FORWARD: bool>(a: &[u8], b: &[u8]) -> Option<usize> {
        let found = difference_by_units::<_, FORWARD>(a, b);
        let equal = found.map_or(a.len(), |at| if FORWARD { at } else { a.len() - 1 - at });
        MAY_COMPARE.set(MAY_COMPARE.get().checked_sub(equal).unwrap());
        found
    }

    /// Each start is a candidate.
    fn with<'a, const FORWARD: bool>(
        a: &'a [u8],
        b: &[u8],
        halves: (Halves, u64),
    ) -> Option<&'a u8> {
        let (starts, difference) = (&a[b.len() - 1..], difference::<FORWARD>);
        MAY_COMPARE.set(4 * a.len());
        let (all, mut seen, mut differs) = (|[v]: [U8; 1]| v.simd_eq(v), 0, 0);
        while seen < starts.len() {
            let block = U8::matches_in::<_, 1, FORWARD>([starts], seen..usize::MAX, all).next();
            let block = block.unwrap_or_else(|| U8::matches_near::<_, 1, FORWARD>([starts], all));
            let range = seen..starts.len().min(seen + 64);
            let state = (range, block, [differs, usize::MAX]);
            match two_way::<_, FORWARD>(a, b, state, halves, difference) {
                Break(found) => return found,
                Continue(next) => [seen, differs, _] = next,
            }
        }
        None
    }

    fn find<const FORWARD: bool>(text: &[u8], needle: &[u8]) -> Option<usize> {
        let halves = halves_and_bits::<_, FORWARD>(needle);
        index_with::<_, FORWARD>(text, needle, |a, b| with::<FORWARD>(a, b, halves))
    }

    #[test]
    fn two_way_of_short_texts() {
        let needles: Vec<_> = (1..=5).flat_map(texts).collect();
        for (text, needle) in texts(8).flat_map(|it| needles.iter().map(move |n| (it.clone(), n))) {
            let places = || (0..text.len()).filter(|&at| text[at..].starts_with(needle));
            assert_eq!(find::<true>(&text, needle), places().next());
            assert_eq!(find::<false>(&text, needle), places().next_back());
        }
    }

    #[test]
    fn greatest_suffixes() {
        for needle in (1..=9).flat_map(texts) {
            let start = (0..needle.len()).max_by_key(|&at| &needle[at..]).unwrap();
            let suffix = &needle[start..];
            let period = (1..).find(|&it| suffix.starts_with(&suffix[it..])).unwrap();
            assert_eq!(maximal_suffix::<_, true>(&needle, true), [start, period]);
            let other: Vec<_> = needle.iter().rev().map(|it| !it).collect();
            assert_eq!(maximal_suffix::<_, false>(&other, false), [start, period]);
        }
    }

    fn long_needles<const FORWARD: bool>() {
        let turn = |mut it: Vec<u8>| {
            if !FORWARD {
                it.reverse();
            }
            it
        };
        let (text, len) = (b"ab".repeat(1 << 22), 1 << 22);
        for (changed, split, period) in [(0, 1, 2), (len - 4, len - 1, 1)] {
            let mut needle = text[..len].to_vec();
            needle[changed] = b'c';
            let (text, needle) = (turn(text.clone()), turn(needle));
            assert_eq!(find::<FORWARD>(&text, &needle), None);
            let before = (halves(len, [split, period], true), u64::MAX);
            with::<FORWARD>(&text, &needle, before);
        }
        // A far step to where the right half matches, then a short one out of reach of the block.
        let runs = |from| [b'a'; 319].into_iter().chain(*b"c").cycle().skip(from);
        let needle = turn((*b"x").into_iter().chain(runs(0)).take(len).collect());
        let before = (halves(len, [1, 2], true), u64::MAX);
        with::<FORWARD>(&turn(runs(1).take(2 * len).collect()), &needle, before);
        let almost = [&text[1..len], b"c"].concat();
        let needle = turn([b"c", &text[..len]].concat());
        assert_eq!(find::<FORWARD>(&turn(almost.repeat(3)), &needle), None);
        let needle = turn([b"a", &almost[..], &almost].concat());
        assert_eq!(
            halves_and_bits::<_, FORWARD>(&needle).0,
            (len, (len + 2, 0))
        );
    }

    /// Does not end unless the time is linear.
    #[test]
    fn long_needles_that_may_have_changed() {
        long_needles::<true>();
        long_needles::<false>();
    }

    #[test]
    fn falls_back_for_ever_longer() {
        let mut budget = Budget::new(72, false, 8);
        assert_eq!((budget.until_ranking, budget.setup), ([100, 108], 800));
        assert_eq!(budget.pay_for([1 << 20, 30]), 0);
        assert_eq!((budget.until_ranking[0], budget.until_fallback), (70, 800));
        assert_eq!(budget.pay_for([100, 836]), 0);
        assert_eq!(budget.until_ranking[0], 0);
        budget.pay_for_ranking();
        assert_eq!(budget.until_ranking, [1132, 2264]);
        assert_eq!(budget.pay_for([63, 0]), 800);
        assert_eq!(budget.pay_for([10, 202]), 0);
        assert_eq!(budget.pay_for([0, 0]), 1600);
        assert_eq!(budget.until_ranking[0], 330);
        assert_eq!(budget.pay_for([1 << 20, 0]), 0);
        assert_eq!(budget.until_fallback, 800);
        budget.pay_for_ranking();
        assert_eq!(budget.until_ranking, [3288, 6576]);
        assert_eq!(Budget::new(9, true, 48).until_ranking, [976, 1024]);
    }

    #[test]
    fn keeps_the_best_pair() {
        for (far, patience) in [(383, 128), (384, 16)] {
            let mut plan = Plan::new([9, 0], [100, 48], false);
            let mut next = |turn, rare| (plan.next_turn(turn, [3, 4], rare), plan.pair);
            assert_eq!(next([100, 48], None), (16, [9, 0]));
            assert_eq!(next([202, 48], None), (16, [3, 4]));
            assert_eq!(next([203, 48], None), (32, [3, 4]));
            assert_eq!(next([400, 96], None), (16, [9, 0]));
            assert_eq!(next([200, 48], None), (64, [3, 4]));
            assert_eq!(next([191, 192], None), (16, [3, 4]));
            assert_eq!(next([16, 48], None), (16, [3, 4]));
            assert_eq!(next([16, 48], Some([5, 6])), (16, [5, 6]));
            assert_eq!(next([far, 192], None), (patience, [5, 6]));
        }
    }

    #[test]
    fn tries_other_pairs() {
        let mut plan = Plan::new([9, 0], [100, 48], true);
        let mut next = |turn, telling| (plan.next_turn(turn, telling, None), plan.pair);
        assert_eq!(next([100, 48], [3, 4]), (16, [3, 9]));
        assert_eq!(next([50, 48], [3, 4]), (16, [9, 0]));
        assert_eq!(next([400, 96], [5, 5]), (16, [5, 0]));
        // Not as far ahead, but cheaper by the unit.
        assert_eq!(next([250, 48], [5, 5]), (32, [5, 0]));
        assert_eq!(next([48, 48], [6, 7]), (16, [9, 0]));
        assert_eq!(next([48, 48], [6, 7]), (64, [5, 0]));
        assert_eq!(next([99, 48], [0, 7]), (16, [5, 0]));
        assert_eq!(next([99, 48], [0, 7]), (128, [5, 0]));
        assert_eq!(next([99, 48], [5, 5]), (16, [5, 0]));
        assert_eq!(next([99, 48], [6, 7]), (128, [5, 0]));

        for (turn, want) in [([48, 48], [3, 0]), ([47, 48], [9, 0])] {
            let mut plan = Plan::new([9, 0], turn, false);
            plan.next_turn(turn, [3, 4], None);
            plan.trials = 5;
            plan.next_turn(turn, [3, 4], None);
            assert_eq!(plan.pair, want);
            assert_eq!(plan.next_turn([999, 48], [3, 4], Some([1, 2])), 16);
        }
    }

    #[test]
    fn ranks_units_by_their_low_byte() {
        let rarest_two = rarest_two::<u8>;
        assert_eq!(rarest_two(b"abc", b"bbbcc"), [0, 2]);
        assert_eq!(rarest_two(b"abc", b"aaabcc"), [1, 2]);
        assert_eq!(rarest_two(b"abc", b"aabbbc"), [2, 0]);
        assert_eq!(rarest_two(b"abab", b"b"), [0, 2]);
        assert_eq!(rarest_two(b"aaaa", b"a"), [0, 3]);
        assert_eq!(rarest_two(b"aab", b"aab"), [2, 1]);
        for bit in (0..8).map(|it| 1 << it) {
            let needle = [255, 255, !bit, 255];
            assert_eq!(rarest_two(&needle, &needle), [2, 3]);
        }
        let needle = [0x161u16, 0x62, 0x163, 0x61];
        assert_eq!(super::rarest_two(&needle, &needle), [1, 2]);
    }
}

#[cfg(all(test, not(miri)))]
mod reads;
