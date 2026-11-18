//! A text in a text.
use crate::{index_of_char, index_of_char_shared, last_index_of_char, last_index_of_char_shared};
use bun_simd::{Int, Matches, SharedU8, Source};
use core::ops::{ControlFlow, ControlFlow::*, Range};
use core::ptr;

trait Unit = Source<Lane: Ord + Into<u32>>;
/// For vectors of `N` and of `M` lanes.
trait Fits<const N: usize, const M: usize> = Unit<Lane: Int<N> + Int<M>>;
type SharedU16 = [SharedU8; 2];

/// After so many bytes or false candidates, it can pay to look for better units than the ends.
const BYTES_BEFORE_LEARNING: usize = 4096;
const MISSES_BEFORE_LEARNING: usize = 16;
/// Up to this length, the ends of a needle are as safe as its rarest units.
const SHORT: usize = 16;
/// A step of `two_way` that goes so far is cheaper than a scan.
const FAR: usize = 64;
/// One that goes so far is cheaper than a scan that leaves its start out.
const VERY_FAR: usize = 4 * FAR;

/// In vectors: what makes up for a try to skip. It has room for a step back and a block.
const LEAST_STRETCH: usize = 8;
/// In vectors: a skip that has paid.
const GOOD_SKIP: usize = 32;
/// In vectors: the text that it takes to try a skip for one more unit of the needle.
const TEXT_PER_TRY: usize = 8 * GOOD_SKIP;
const MOST_TRIES: usize = 32;

const _: () = assert!(usize::BITS == 64, "costs overflow otherwise");
/// The unit of costs is a scan of so many starts for two units. A rate is a cost for as many.
const SCANNED: usize = 32;
const RATE_OF_SIX: usize = 4;
const COST_OF_STEP: usize = 4;
const COST_OF_MISS: usize = 3;
const COST_OF_FALLBACK: usize = 512;
/// What the misses of a pair of units may cost until it is the turn of the other pair.
const LEAST_PATIENCE: usize = COST_OF_MISS * MISSES_BEFORE_LEARNING;
const MOST_PATIENCE: usize = 16 * LEAST_PATIENCE;

#[derive(Default)]
struct Misses {
    /// What they may still cost.
    left: isize,
    /// Where the last one that was compared in full has differed.
    in_needle: usize,
    /// The same for the last one that starts and ends like the needle.
    in_haystack: usize,
}

/// Two pairs of places in the needle, which take turns. No result depends on them.
struct Pairs {
    /// One changes. The usual one is the ends, or the rarest units of a needle that is not short.
    indices: [[usize; 2]; 2],
    is_usual: bool,
    patience: [usize; 2],
    rates: [usize; 2],
}

impl Pairs {
    fn now(&self) -> usize {
        self.is_usual.into()
    }

    /// `rare` is the place of a unit that is rare in the text.
    #[inline(never)]
    fn rank(&mut self, rarest: [usize; 2], rare: Option<usize>, len: usize) {
        self.is_usual = len > SHORT;
        self.indices[self.now()] = rarest;
        if let Some(rare) = rare {
            self.is_usual = false;
            self.indices[0] = [rare, rarest[1]];
        }
    }

    #[inline(never)]
    fn end_turn(&mut self, missed: usize, covered: usize, differs: usize) {
        let now = self.now();
        self.rates[now] = SCANNED * missed / (covered + 1);
        let wins = self.rates[now] <= self.rates[1 - now];
        self.patience[now] = match wins {
            true => MOST_PATIENCE.min(2 * self.patience[now]),
            false => LEAST_PATIENCE,
        };
        if self.is_usual && wins {
            (self.indices[0], self.patience[0]) = ([differs, self.indices[1][0]], LEAST_PATIENCE);
        }
        self.is_usual = !self.is_usual;
    }
}

/// When `two_way` takes over, and for how many starts.
struct Fallback {
    /// About what it takes to prepare it.
    setup: usize,
    /// A rate that is not worth it.
    calm: usize,
    /// What misses may still cost.
    left: usize,
    far: usize,
}

impl Fallback {
    #[inline(never)]
    fn new(len: usize) -> Self {
        let [setup, left, far] = [2 * len + COST_OF_FALLBACK; 3];
        let calm = if len < VERY_FAR { RATE_OF_SIX } else { 1 };
        Self {
            setup,
            calm,
            left,
            far,
        }
    }

    #[inline(never)]
    fn charge(&mut self, missed: usize, covered: usize) {
        let saved = (self.left + covered * self.calm / SCANNED).saturating_sub(missed);
        self.left = saved.min(self.setup);
        // The text is calm again.
        if saved >= self.setup {
            self.far = self.setup;
        }
    }

    fn end(&mut self, has_paid: bool) {
        (self.left, self.far) = match has_paid {
            true => (2 * LEAST_PATIENCE, 2 * self.far),
            false => (self.setup, self.setup),
        };
    }
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

#[inline(always)]
fn differ_at<S: Unit>(a: &[S], b: &[S], i: usize) -> bool {
    matches!((a.get(i), b.get(i)), (Some(a), Some(b)) if a.get() != b.get())
}

/// `find` returns the first unit of what it found. Unlike an index, that takes one register.
#[inline(always)]
fn index_with<'a, S, const FORWARD: bool>(
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

#[inline(always)]
pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    match *needle {
        [byte] => index_of_char(haystack, byte),
        _ => index_with::<_, true>(haystack, needle, simd::memmem),
    }
}

#[inline(always)]
pub fn memmem_shared(haystack: &[SharedU8], needle: &[SharedU8]) -> Option<usize> {
    match needle {
        [byte] => index_of_char_shared(haystack, byte.get()),
        _ => index_with::<_, true>(haystack, needle, simd::memmem_shared),
    }
}

#[inline(always)]
pub fn memrmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    match *needle {
        [byte] => last_index_of_char(haystack, byte),
        _ => index_with::<_, false>(haystack, needle, simd::memrmem),
    }
}

#[inline(always)]
pub fn memrmem_shared(haystack: &[SharedU8], needle: &[SharedU8]) -> Option<usize> {
    match needle {
        [byte] => last_index_of_char_shared(haystack, byte.get()),
        _ => index_with::<_, false>(haystack, needle, simd::memrmem_shared),
    }
}

#[inline(always)]
pub fn memmem16_shared(haystack: &[[SharedU8; 2]], needle: &[[SharedU8; 2]]) -> Option<usize> {
    index_with::<_, true>(haystack, needle, simd::memmem16_shared)
}

#[inline(always)]
pub fn memrmem16(haystack: &[u16], needle: &[u16]) -> Option<usize> {
    index_with::<_, false>(haystack, needle, simd::memrmem16)
}

#[inline(always)]
pub fn memrmem16_shared(haystack: &[[SharedU8; 2]], needle: &[[SharedU8; 2]]) -> Option<usize> {
    index_with::<_, false>(haystack, needle, simd::memrmem16_shared)
}

#[bun_simd::foreach_target]
mod simd {
    use isa::{U8, U16, Vector};

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

    /// In the first, the last or the middle vector, with no branch on which end it is.
    #[inline(always)]
    pub(crate) fn differ_in_part<S: Unit<Lane: Int<N>>, const N: usize>(
        a: &[S],
        b: &[S],
    ) -> Option<bool> {
        let differ = |a, b| Vector::<_, N>::load(a).simd_ne(Vector::load(b));
        let first = differ(a.first_chunk()?, b.first_chunk()?);
        let ends = first | differ(a.split_last_chunk()?.1, b.split_last_chunk()?.1);
        // Two vectors with so few lanes leave too much out.
        if N == 8 && (2 * N + 1..=4 * N).contains(&a.len()) {
            let at = (a.len() - N) / 2;
            let middle = differ(a[at..].first_chunk()?, b.get(at..)?.first_chunk()?);
            return Some(ends.any() | middle.any());
        }
        Some(ends.any())
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

    fn difference_by_vectors<S: Unit<Lane: Int<N>>, const N: usize, const FORWARD: bool>(
        a: &[S],
        b: &[S],
    ) -> Option<usize> {
        match FORWARD {
            true => Vector::<_, N>::position_near([a, b], |[a, b]| a.simd_ne(b)),
            false => Vector::<_, N>::rposition_near([a, b], |[a, b]| a.simd_ne(b)),
        }
    }

    /// The first or the last index at which they differ.
    #[inline(never)]
    fn difference<S: Fits<N, M>, const N: usize, const M: usize, const FORWARD: bool>(
        a: &[S],
        b: &[S],
    ) -> Option<usize> {
        match a.len().min(b.len()) {
            len if len >= N => difference_by_vectors::<S, N, FORWARD>(a, b),
            len if len >= M => difference_by_vectors::<S, M, FORWARD>(a, b),
            _ => difference_by_units::<S, FORWARD>(a, b),
        }
    }

    #[inline(never)]
    fn skip<S: Unit<Lane: Int<N>>, const N: usize, const FORWARD: bool>(
        place: &[S],
        unit: &S,
        seen: usize,
    ) -> usize {
        let unit = Vector::<_, N>::splat(unit.get());
        Vector::skip::<S, FORWARD>(place, seen, |v| [v.simd_eq(unit); 2])
    }

    /// Returns a match, or how far `range` and what was `left` have lasted.
    #[inline(never)]
    fn scan<'a, S: Fits<N, M>, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        (places, [x, y]): ([&[S]; 2], [Vector<S::Lane, N>; 2]),
        range: Range<usize>,
        misses: &mut Misses,
    ) -> ControlFlow<Option<&'a S>, usize> {
        let test = |[a, b]: [Vector<_, N>; 2]| a.simd_eq(x) & b.simd_eq(y);
        for mut block in Vector::matches_in::<S, 2, FORWARD>(places, range.clone(), test) {
            while let Some(at) = next::<FORWARD>(&mut block) {
                let Some(candidate) = window(haystack, at, needle.len()) else {
                    return Break(None);
                };
                misses.left -= COST_OF_MISS.cast_signed();
                if misses.left > 0
                    && differ_in_part::<S, N>(needle, candidate)
                        .or_else(|| differ_in_part::<S, M>(needle, candidate))
                        .unwrap_or_else(|| are_equal::<S, M>(needle, candidate) == Some(false))
                {
                    continue;
                }
                if !differ_at(needle, candidate, misses.in_haystack.wrapping_sub(at)) {
                    let Some(found) = difference::<S, N, M, FORWARD>(needle, candidate) else {
                        return Break(candidate.first());
                    };
                    let equal = found.abs_diff(if FORWARD { 0 } else { needle.len() - 1 });
                    misses.in_needle = found;
                    if misses.left > 0 {
                        misses.in_haystack = at + found;
                    }
                    misses.left -= (COST_OF_MISS + equal / N).cast_signed();
                }
                if misses.left <= 0 {
                    return Continue(seen_at::<FORWARD>(at, places[0].len()));
                }
            }
        }
        Continue(range.end)
    }

    /// Runs `two_way` where six units match. Returns how far, and whether it has kept to `rate`.
    #[inline(never)]
    fn cross<'a, S: Fits<N, M>, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        halves @ ((split, _), _): (Halves, u64),
        [mut seen, end, rate]: [usize; 3],
    ) -> ControlFlow<Option<&'a S>, (usize, bool)> {
        let (last, starts) = (needle.len() - 1, haystack.len() - needle.len() + 1);
        let index = |n: usize| n.abs_diff(if FORWARD { 0 } else { last });
        // Far steps start where the right half matches: other units would hide those places.
        let most = if last < FAR { usize::MAX } else { last };
        let mut six = [0, 1, 2, 3, 4, 5].map(|i| index(most.min(split + i) % needle.len()));
        let ([mut reach, mut limit, mut cost], began) = ([0; 3], seen);
        let difference = difference::<S, N, M, FORWARD>;
        loop {
            let units = six.map(|i| Vector::<_, N>::splat(needle[i].get()));
            let has = |v: [Vector<_, N>; 6], i: usize| v[i].simd_eq(units[i]);
            let test = |v| (1..6).fold(has(v, 0), |all, i| all & has(v, i));
            let places = six.map(|i| &haystack[i..][..starts]);
            let mut blocks = Vector::matches_in::<S, 6, FORWARD>(places, seen..end, test);
            let Some(block) = blocks.next() else {
                return Continue((seen.max(end), true));
            };
            let until = seen_with::<S, N, FORWARD>(&block, starts);
            let range = seen.max(until - Vector::<S::Lane, N>::BLOCK_LEN)..until;
            // While each block has candidates, it goes on without a scan, farther each time.
            let is_dense = range.start == seen && seen >= limit;
            reach = if is_dense { reach + FAR } else { 0 };
            (limit, cost) = (until + reach, cost + (until - seen) * RATE_OF_SIX / SCANNED);
            let (state, differs, steps);
            state = (range, block, [limit, end]);
            [seen, differs, steps] =
                two_way::<S, FORWARD>(haystack, needle, state, halves, difference)?;
            cost += COST_OF_STEP * steps;
            if !six.contains(&index(differs)) {
                six = [index(differs), six[0], six[1], six[2], six[3], six[4]];
            }
            // A far step could make up for as much.
            let over = SCANNED * cost.saturating_sub(last + 2 * FAR);
            if over > rate.saturating_mul(seen - began) {
                return Continue((seen, false));
            }
        }
    }

    /// Looks for two units while their false candidates cost less than to look for six.
    #[inline(never)]
    fn find_far<'a, S: Fits<N, M>, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        mut seen: usize,
        differs: usize,
    ) -> Option<&'a S> {
        let (len, last) = (needle.len(), needle.len().checked_sub(1)?);
        let starts = haystack.len().checked_sub(last)?;
        let unit = |index: usize| Some(Vector::<_, N>::splat(needle.get(index)?.get()));
        let place = |index: usize| haystack.get(index..)?.get(..starts);
        let of = |[a, b]: [usize; 2]| Some(([place(a)?, place(b)?], [unit(a)?, unit(b)?]));
        let skip = |i: usize, seen| Some(skip::<S, N, FORWARD>(place(i)?, needle.get(i)?, seen));
        let ends = if FORWARD { [last, 0] } else { [0, last] };
        let mut pairs = Pairs {
            indices: [[differs, ends[0]], ends],
            is_usual: differs == 0,
            patience: [LEAST_PATIENCE; 2],
            rates: [usize::MAX, 0],
        };
        let (mut halves, mut stretch, mut misses) = (None, LEAST_STRETCH * N, Misses::default());
        let spent = if pairs.is_usual { LEAST_PATIENCE } else { 0 };
        // About what the ranking costs, less what has been spent.
        let mut until_ranking = (len + len / 2).saturating_sub(spent);
        let mut fallback = Fallback::new(len);
        loop {
            let began = seen;
            if until_ranking == 0 {
                let (mut farthest, mut rare) = (GOOD_SKIP * N, None);
                for i in 0..len.min(MOST_TRIES) {
                    if starts - seen < (i + 1) * TEXT_PER_TRY * N {
                        break;
                    }
                    let far = skip(i, seen)?.saturating_sub(seen);
                    if far >= farthest {
                        (farthest, rare) = (far, Some(i));
                    }
                    seen += far;
                }
                pairs.rank(rarest_two(needle), rare, len);
                (until_ranking, stretch) = (usize::MAX, LEAST_STRETCH * N);
            }
            let now = pairs.now();
            let (both, skipped) = (of(pairs.indices[now])?, skip(pairs.indices[now][0], seen)?);
            // The last block overlaps what has been seen: a turn could end before it began.
            let most = match starts - seen < Vector::<S::Lane, N>::BLOCK_LEN {
                true => isize::MAX,
                false => until_ranking.min(pairs.patience[now]).cast_signed(),
            };
            misses.left = most;
            let range = skipped.max(seen)..skipped + stretch;
            match scan::<S, N, M, FORWARD>(haystack, needle, both, range, &mut misses) {
                Break(found) => return found,
                Continue(until) if until >= starts => return None,
                Continue(until) => seen = until,
            }
            let missed = most.abs_diff(misses.left);
            until_ranking = until_ranking.saturating_sub(missed);
            if skipped >= began + GOOD_SKIP * N {
                stretch = LEAST_STRETCH * N;
            } else if misses.left > 0 {
                // The next skip is for the other unit, and the one after it comes later.
                pairs.indices[now].swap(0, 1);
                // Close to the end, a ranking would not pay.
                until_ranking = until_ranking.saturating_sub(stretch.min(starts - seen) / SCANNED);
                stretch *= 4;
            }
            fallback.charge(missed, seen - began);
            if misses.left <= 0 || fallback.left == 0 {
                pairs.end_turn(missed, seen - began, misses.in_needle);
            }
            if fallback.left == 0 {
                let halves = *halves.get_or_insert_with(|| halves_and_bits::<S, FORWARD>(needle));
                let [a, b] = pairs.rates;
                let range = [seen, seen + fallback.far, a.min(b)];
                let has_paid;
                match cross::<S, N, M, FORWARD>(haystack, needle, halves, range) {
                    Break(found) => return found,
                    Continue((until, _)) if until >= starts => return None,
                    Continue(it) => (seen, has_paid) = it,
                }
                fallback.end(has_paid);
                if has_paid {
                    pairs.patience = [LEAST_PATIENCE; 2];
                }
                stretch = LEAST_STRETCH * N;
            }
        }
    }

    /// Learns from the nearest candidate, unless there is only this block.
    #[inline(never)]
    fn find_long<'a, S: Fits<N, M>, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        mut matches: Matches,
    ) -> Option<&'a S> {
        let starts = haystack.len() - needle.len() + 1;
        let [mut in_needle, mut in_haystack] = [usize::MAX; 2];
        loop {
            let at = next::<FORWARD>(&mut matches)?;
            let candidate = window(haystack, at, needle.len())?;
            let differs = |i| differ_at(needle, candidate, i);
            if differs(in_needle) || differs(in_haystack.wrapping_sub(at)) {
                continue;
            }
            let Some(found) = difference::<S, N, M, FORWARD>(needle, candidate) else {
                return candidate.first();
            };
            if starts > Vector::<S::Lane, N>::BLOCK_LEN {
                let seen = seen_at::<FORWARD>(at, starts);
                return find_far::<S, N, M, FORWARD>(haystack, needle, seen, found);
            }
            [in_needle, in_haystack] = [found, at + found];
        }
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
    fn find_next<'a, S: Fits<N, M>, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        mut seen: usize,
    ) -> Option<&'a S> {
        let (places, [first, last]) = ends::<S, N>(haystack, needle)?;
        let test = |[x, y]: [Vector<_, N>; 2]| x.simd_eq(first) & y.simd_eq(last);
        let starts = places[0].len();
        if seen + LEAST_STRETCH * N < starts {
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
    pub(crate) fn find<'a, S: Fits<N, M>, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
    ) -> Option<&'a S> {
        let (places, [first, last]) = ends::<S, N>(haystack, needle)?;
        let test = |[x, y]: [Vector<_, N>; 2]| x.simd_eq(first) & y.simd_eq(last);
        let (starts, block) = (places[0].len(), Vector::<S::Lane, N>::BLOCK_LEN);
        let mut matches = Vector::matches_near::<S, 2, FORWARD>(places, test);
        if matches.is_empty() && starts > block {
            if starts > block + LEAST_STRETCH * N {
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

/// The places of the two units of `needle` whose low bytes are rarest in it.
#[inline(never)]
fn rarest_two<S: Unit>(needle: &[S]) -> [usize; 2] {
    let (mut counts, low_byte) = ([0u32; 256], |unit: &S| unit.get().into() as usize & 0xFF);
    for unit in needle {
        counts[low_byte(unit)] = counts[low_byte(unit)].wrapping_add(1);
    }
    let [mut rarest, mut second] = [(u32::MAX, 0); 2];
    for (i, unit) in needle.iter().enumerate() {
        let it = (counts[low_byte(unit)], i);
        if it.0 < rarest.0 {
            rarest = it;
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
    (range, mut candidates, [mut limit, until]): (Range<usize>, Matches, [usize; 2]),
    ((split, after_right_half), bits): (Halves, u64),
    difference: Difference<S>,
) -> ControlFlow<Option<&'a S>, [usize; 3]> {
    let (len, mut seen, mut is_due) = (needle.len(), range.start, false);
    let ([mut known, mut taken, mut steps], mut differs) = ([0; 3], split);
    // What is known has been paid for.
    while seen < limit || known > 0 {
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
            // The call pays only for a long part.
            let at = match a.len() > 16 {
                true => difference(a, b)?,
                false => difference_by_units::<S, FORWARD>(a, b)?,
            };
            Some(if FORWARD { start + at } else { end - 1 - at })
        };
        let is_there = bits & bit_of(nth::<S, FORWARD>(window, len - 1)) != 0;
        if is_there && known == 0 && !is_due {
            if seen >= range.end {
                break;
            }
            candidates.cut_at(at, FORWARD);
            seen = next::<FORWARD>(&mut candidates).map_or(range.end, |it| seen + it.abs_diff(at));
            (is_due, taken) = (seen < limit, taken + usize::from(seen < range.end));
            continue;
        }
        let (step, found);
        ((step, known), found) = if !is_there {
            ((len, 0), if len < FAR / 2 { len - 1 } else { differs })
        } else {
            match mismatch(split.max(known), len) {
                Some(n) => ((n - split + 1, 0), n),
                None => match mismatch(known.min(split), split) {
                    Some(n) => (after_right_half, n),
                    None => return Break(window.first()),
                },
            }
        };
        // To leave such candidates out does not pay if they lead far.
        if is_due && seen < range.end && step < VERY_FAR {
            differs = found;
        }
        (seen, steps) = (seen + step, steps + usize::from(seen >= range.end));
        // The next one may start close by.
        if step >= FAR {
            limit = limit.max(until.min(seen + FAR / 2));
        }
        // Past the block, as long as the steps cost less than it has.
        is_due = (range.end..limit).contains(&seen)
            && steps * FAR <= (4 + 2 * taken) * (seen - range.end);
    }
    // How far it got, a place to look at, and the time. A candidate takes three steps, the call six.
    Continue([seen, differs, 3 * (2 + taken) + steps])
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

    /// The length of a block, and how far to go past it.
    const BLOCKS: [[usize; 2]; 4] = [[64, 0], [2, 0], [2, 3], [1, 1 << 30]];

    /// Each start is a candidate.
    fn with<'a, const FORWARD: bool>(
        a: &'a [u8],
        b: &[u8],
        halves: (Halves, u64),
        [block_len, reach]: [usize; 2],
    ) -> Option<&'a u8> {
        let (starts, difference) = (&a[b.len() - 1..], difference::<FORWARD>);
        MAY_COMPARE.set(4 * a.len());
        let (all, mut seen) = (|[v]: [U8; 1]| v.simd_eq(v), 0);
        while seen < starts.len() {
            let block = U8::matches_in::<_, 1, FORWARD>([starts], seen..usize::MAX, all).next();
            let block = block.unwrap_or_else(|| U8::matches_near::<_, 1, FORWARD>([starts], all));
            let until = starts.len().min(seen + block_len);
            let state = (seen..until, block, [until + reach, usize::MAX]);
            match two_way::<_, FORWARD>(a, b, state, halves, difference) {
                Break(found) => return found,
                Continue(next) => [seen, ..] = next,
            }
        }
        None
    }

    fn find<const FORWARD: bool>(text: &[u8], needle: &[u8]) -> Option<usize> {
        let halves = halves_and_bits::<_, FORWARD>(needle);
        let [found, others @ ..] = BLOCKS.map(|it| {
            index_with::<_, FORWARD>(text, needle, |a, b| with::<FORWARD>(a, b, halves, it))
        });
        assert_eq!(others, [found; 3]);
        found
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
            _ = BLOCKS.map(|it| with::<FORWARD>(&text, &needle, before, it));
        }
        // A far step to where the right half matches, then a short one out of reach of the block.
        let runs = |from| [b'a'; 319].into_iter().chain(*b"c").cycle().skip(from);
        let needle = turn((*b"x").into_iter().chain(runs(0)).take(len).collect());
        let before = (halves(len, [1, 2], true), u64::MAX);
        let shifted = turn(runs(1).take(2 * len).collect());
        _ = BLOCKS.map(|it| with::<FORWARD>(&shifted, &needle, before, it));
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
    fn three_vectors_leave_nothing_out() {
        for (len, at) in (8..=24).flat_map(|len| (0..len).map(move |at| (len, at))) {
            let (a, mut b) = (vec![7u16; len], vec![7; len]);
            assert_eq!(simd::portable::differ_in_part::<_, 8>(&a, &b), Some(false));
            b[at] = 8;
            assert_eq!(simd::portable::differ_in_part::<_, 8>(&a, &b), Some(true));
        }
    }

    #[test]
    fn ranks_units_by_their_low_byte() {
        let rarest_two = rarest_two::<u8>;
        assert_eq!(rarest_two(b"abbbcc"), [0, 5]);
        assert_eq!(rarest_two(b"aaabcc"), [3, 5]);
        assert_eq!(rarest_two(b"aabbbc"), [5, 1]);
        assert_eq!(rarest_two(b"bbbaac"), [5, 4]);
        assert_eq!(rarest_two(b"abbbca"), [4, 5]);
        assert_eq!(rarest_two(b"abcb"), [0, 2]);
        assert_eq!(rarest_two(b"aaaa"), [0, 3]);
        assert_eq!(rarest_two(b"aab"), [2, 1]);
        for bit in (0..8).map(|it| 1 << it) {
            assert_eq!(rarest_two(&[255, 255, !bit, 255]), [2, 3]);
        }
        assert_eq!(super::rarest_two(&[0x161u16, 0x62, 0x163, 0x61]), [1, 2]);
    }
}

#[cfg(all(test, not(miri)))]
mod reads;
