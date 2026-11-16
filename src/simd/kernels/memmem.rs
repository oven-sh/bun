//! A text in a text.
use bun_simd::{Int, Matches, SharedU8, Source};
use core::ptr;

pub(crate) trait Unit = Source<Lane: Ord + From<u8> + Into<u32>>;
type SharedU16 = [SharedU8; 2];

/// After so many bytes or false candidates, it pays to find out which units are rare.
const BYTES_BEFORE_LEARNING: usize = 4096;
const MISSES_BEFORE_LEARNING: usize = 32;
const LONGEST_SAMPLE: usize = 4096;
/// In units that `two_way` gets through in the same time.
const COST_OF_LONG_CANDIDATE: usize = 64;

#[inline(always)]
fn next<const FORWARD: bool>(matches: &mut Matches) -> Option<usize> {
    match FORWARD {
        true => matches.next(),
        false => matches.next_back(),
    }
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
    use isa::{U8, U16, Vector};

    #[inline(always)]
    fn have_equal_ends<S: Unit, const N: usize>(a: &[S], b: &[S]) -> Option<bool> {
        let load = |units| Vector::load(units).to_array();
        let are_first_equal = load(a.first_chunk::<N>()?) == load(b.first_chunk()?);
        Some(are_first_equal && load(a.split_last_chunk()?.1) == load(b.split_last_chunk()?.1))
    }

    /// For slices of the same length that start and end alike. `None` if they are long.
    #[inline(always)]
    fn are_equal<S: Unit>(a: &[S], b: &[S]) -> Option<bool> {
        match a.len() {
            17.. => None,
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

    /// The last place where slices of the same length differ. `None` if that is below `M`.
    #[inline(always)]
    fn last_mismatch<S, const N: usize, const M: usize>(a: &[S], b: &[S]) -> Option<usize>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        match a.len() >= N {
            true => Vector::<_, N>::position_past::<S, 2, false>([a, b], 0, |[a, b]| a.simd_ne(b)),
            false => Vector::<_, M>::position_past::<S, 2, false>([a, b], 0, |[a, b]| a.simd_ne(b)),
        }
    }

    /// By Crochemore and Perrin. The time is linear even if `needle` has changed since it was split.
    #[inline(never)]
    pub(crate) fn two_way<'a, S, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        mut at: usize,
        [split, shift, known_after_shift]: [usize; 3],
    ) -> Option<&'a S>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        let (len, mut known) = (needle.len(), 0);
        let (is_near_end, split_if_short) = (len < split + M, if len < M { split } else { 0 });
        let starts = haystack.len().checked_sub(len)? + 1;
        // The unit that each window compares first while it knows nothing, and those of the windows.
        let at_split = nth::<S, FORWARD>(needle, split)?;
        let firsts = haystack.get(if FORWARD { split } else { len - 1 - split }..)?;
        let is_first = |[v]: [Vector<_, N>; 1]| v.simd_eq(Vector::splat(at_split));
        loop {
            let window = window(haystack, at, len)?;
            let differs = |&i: &usize| nth::<S, FORWARD>(needle, i) != nth::<S, FORWARD>(window, i);
            let differs_past = |seen| {
                let differ = |[a, b]: [Vector<_, M>; 2]| a.simd_ne(b);
                let at = Vector::position_past::<S, 2, FORWARD>([needle, window], seen, differ)?;
                Some(if FORWARD { at } else { len - 1 - at })
            };
            let from = split.max(known);
            let soon = if is_near_end { len } else { from + 8 };
            let by;
            (by, known) = match (from..soon).find(differs).or_else(|| differs_past(soon)) {
                // Then the classic algorithm moves by one unit, and here it would again.
                Some(first)
                    if first == split
                        && if FORWARD { at + N < starts } else { at >= N }
                        && firsts
                            .get(if FORWARD { at + 1 } else { at - 1 })
                            .is_some_and(|next| next.get() != at_split) =>
                {
                    let seen = if FORWARD { at + 1 } else { starts - at };
                    let firsts = firsts.get(..starts)?;
                    at = Vector::position_past::<S, 1, FORWARD>([firsts], seen, is_first)?;
                    known = 0;
                    continue;
                }
                Some(first) => (first + 1 - split, 0),
                None if (known..split_if_short).any(|i| differs(&i)) => (shift, known_after_shift),
                None if differs_past(known).is_some() => (shift, known_after_shift),
                None => return window.first(),
            };
            at = match FORWARD {
                true => at + by,
                false => at.checked_sub(by)?,
            };
        }
    }

    /// Replaces the units that turn out to be common. `matches` has all, or there is a whole block.
    #[inline(never)]
    fn find_far<'a, S, const N: usize, const M: usize, const FORWARD: bool>(
        haystack: &'a [S],
        needle: &[S],
        mut matches: Matches,
    ) -> Option<&'a S>
    where
        S: Unit<Lane: Int<N> + Int<M>>,
    {
        let (len, last) = (needle.len(), needle.len().checked_sub(1)?);
        let starts = haystack.len().checked_sub(last)?;
        let [mut fixed, mut learned] = if FORWARD { [0, last] } else { [last, 0] };
        // Where the last full comparison found a difference.
        let mut previous = learned;
        let (shortest, worth_skipping) = (8 * N, 64 * N);
        let (mut rare, mut stretch, mut longest) = (learned, shortest, shortest);
        let (mut patience, mut left, mut patience_to_sample) = (2isize, 2, 8);
        let mut budget = (haystack.len() / 2 + 1024).saturating_add(len.saturating_mul(8));
        let (mut offset, [mut part]) = (0, Vector::<_, M>::load_or_zero(needle));
        let is_inside = Vector::iota().simd_lt(S::Lane::from(len.min(M) as u8));
        let differ = |a: Vector<_, M>, b: &[S; M]| a.simd_ne(Vector::load(b)) & is_inside;
        let unit = |index: usize| Some(Vector::<_, N>::splat(needle.get(index)?.get()));
        let place = |index: usize| haystack.get(index..)?.get(..starts);
        let (mut seen, mut seen_before) = (0, 0);
        let at = loop {
            if let Some(at) = next::<FORWARD>(&mut matches) {
                let window = haystack.get(at..)?;
                let units = window.get(offset..)?.first_chunk();
                let is_last = seen_with::<S, N, FORWARD>(&matches, starts) >= starts;
                match units.map(|units| differ(part, units)) {
                    None if needle.iter().zip(window).any(|(a, b)| a.get() != b.get()) => {}
                    None => return window.first(),
                    Some(differ) if differ.any() && is_last => {}
                    Some(differ) if differ.any() => {
                        let lane = learned.wrapping_sub(offset).min(M);
                        let is_later = Vector::iota().simd_gt(S::Lane::from(lane as u8));
                        let [later, first] = [(differ & is_later).first_set(), differ.first_set()];
                        learned = offset + later.or(first)?;
                    }
                    // The anchor keeps one of the last two differences, the part the other.
                    Some(_) => {
                        let Some(differs) = last_mismatch::<S, N, M>(needle, window.get(..len)?)
                        else {
                            return window.first();
                        };
                        let cost = (last - differs) / 2 + COST_OF_LONG_CANDIDATE;
                        let Some(budget_left) = budget.checked_sub(cost) else {
                            break at;
                        };
                        (budget, learned, previous) = (budget_left, previous, differs);
                        left -= 8;
                        offset = differs.min(len.checked_sub(M)?);
                        part = Vector::load(needle.get(offset..)?.first_chunk()?);
                    }
                }
                if is_last {
                    match matches.is_empty() {
                        true => return None,
                        false => continue,
                    }
                }
                seen = if FORWARD { at + 1 } else { starts - at };
                (rare, stretch) = (learned, shortest);
            } else if seen + shortest < starts {
                let unit = unit(rare)?;
                let skipped =
                    Vector::skip::<S, FORWARD>(place(rare)?, seen, |x| [x.simd_eq(unit); 2]);
                if skipped < seen + worth_skipping {
                    rare = if rare == fixed { learned } else { fixed };
                    left -= (stretch / shortest).cast_signed();
                    longest = longest.max(2 * stretch);
                } else {
                    longest = shortest;
                }
                (seen, stretch) = (skipped, longest);
            }
            if seen >= starts {
                return None;
            }
            if left < 0 {
                (patience, left) = (2 * patience, 2 * patience);
                // More than a third were candidates, and that has taken long for what is left.
                let since = seen.saturating_sub(seen_before);
                if patience.cast_unsigned() > ((starts - seen) / 16 + 256).max(since / 3 * 2) {
                    break if FORWARD { seen } else { starts - 1 - seen };
                }
                seen_before = seen;
                if patience >= patience_to_sample {
                    // Longer in a long text, which pays for it.
                    let size = patience.cast_unsigned() + 32;
                    let size =
                        size.max((3 * patience.cast_unsigned() + size).min((starts - seen) / 256));
                    let size = size.min(LONGEST_SAMPLE).min(starts - seen);
                    let from = if FORWARD { seen } else { starts - seen - size };
                    rare = rarest(needle, haystack.get(from..)?.get(..size)?);
                    learned = if rare == learned { fixed } else { learned };
                    (fixed, stretch) = (rare, shortest);
                    patience_to_sample = 16 * patience + len.cast_signed();
                }
            }
            let [x, y] = [unit(fixed)?, unit(learned)?];
            let (places, range) = ([place(fixed)?, place(learned)?], seen..seen + stretch);
            let test = |[a, b]: [Vector<_, N>; 2]| a.simd_eq(x) & b.simd_eq(y);
            // Some texts have no rare unit.
            let worth_a_look = |mut block: Matches| {
                left -= block.clone().count().cast_signed();
                if left < 0 {
                    return Some(block);
                }
                loop {
                    let mut others = block.clone();
                    let units = window(haystack, next::<FORWARD>(&mut others)? + offset, M);
                    match units.and_then(<[S]>::first_chunk) {
                        Some(units) if differ(part, units).any() => block = others,
                        _ => return Some(block),
                    }
                }
            };
            let mut blocks = Vector::matches_in::<S, 2, FORWARD>(places, range, test);
            matches = blocks.find_map(worth_a_look).unwrap_or_default();
            seen += stretch;
        };
        two_way::<S, N, M, FORWARD>(haystack, needle, at, halves::<S, FORWARD>(needle))
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
        let range = seen..seen + BYTES_BEFORE_LEARNING / size_of::<S>();
        let mut left = MISSES_BEFORE_LEARNING;
        for mut matches in Vector::matches_in::<S, 2, FORWARD>(places, range.clone(), test) {
            while !matches.is_empty() {
                let mut others = matches.clone();
                let at = next::<FORWARD>(&mut others)?;
                let candidate = window(haystack, at, needle.len())?;
                match are_equal(needle, candidate) {
                    Some(true) => return candidate.first(),
                    Some(false) if left > 0 => (matches, left) = (others, left - 1),
                    _ => return find_far::<S, N, M, FORWARD>(haystack, needle, matches),
                }
            }
        }
        let done = range.end - Vector::<S::Lane, N>::BLOCK_LEN;
        let rest = match FORWARD {
            _ if starts <= range.end => return None,
            true => haystack.get(done..)?,
            false => haystack.get(..haystack.len() - done)?,
        };
        find_far::<S, N, M, FORWARD>(rest, needle, Matches::default())
    }

    #[inline(always)]
    fn find<'a, S, const N: usize, const M: usize, const FORWARD: bool>(
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
        while !matches.is_empty() {
            let mut others = matches.clone();
            let at = next::<FORWARD>(&mut others)?;
            let candidate = window(haystack, at, needle.len())?;
            match are_equal(needle, candidate) {
                Some(true) => return candidate.first(),
                Some(false) => matches = others,
                None => return find_far::<S, N, M, FORWARD>(haystack, needle, matches),
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

#[inline(always)]
fn nth<S: Unit, const FORWARD: bool>(units: &[S], n: usize) -> Option<S::Lane> {
    let from_end = units.len().wrapping_sub(n + 1);
    Some(units.get(if FORWARD { n } else { from_end })?.get())
}

/// By the low byte. Counting waits for itself in a run, which only a long sample is worth.
#[inline(never)]
fn rarest<S: Unit>(needle: &[S], sample: &[S]) -> usize {
    let (mut ranks, low_byte) = ([0; 256], |unit: &S| unit.get().into() as usize & 0xFF);
    for (i, unit) in sample.iter().enumerate() {
        let rank = &mut ranks[low_byte(unit)];
        *rank = 1 + if sample.len() > 64 { *rank } else { i as u16 };
    }
    let (mut rarest, mut lowest) = (0, u16::MAX);
    for (i, unit) in needle.iter().enumerate() {
        match ranks[low_byte(unit)] {
            0 => return i,
            rank if rank < lowest => (rarest, lowest) = (i, rank),
            _ => {}
        }
    }
    rarest
}

/// Where the greatest suffix in the given order starts, and its period.
fn maximal_suffix<S: Unit, const FORWARD: bool>(needle: &[S], is_ascending: bool) -> [usize; 2] {
    let (mut start, mut candidate, mut offset, mut period) = (0, 1, 0, 1);
    let nth = |n| nth::<S, FORWARD>(needle, n);
    while let (Some(a), Some(b)) = (nth(candidate + offset), nth(start + offset)) {
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

#[inline(never)]
fn halves<S: Unit, const FORWARD: bool>(needle: &[S]) -> [usize; 3] {
    let nth = nth::<S, FORWARD>;
    let [ascending, descending] = [true, false].map(|it| maximal_suffix::<S, FORWARD>(needle, it));
    let [split, period] = ascending.max(descending);
    let is_periodic = (0..split).all(|i| nth(needle, i) == nth(needle, period + i));
    split_at(split, needle.len(), is_periodic.then_some(period))
}

/// With how far to move if only the second half matches, and how much is known to match then.
fn split_at(split: usize, len: usize, period: Option<usize>) -> [usize; 3] {
    match period {
        Some(period) if split < period => [split, period, len - period],
        _ => [split, split.max(len - split) + 1, 0],
    }
}

#[cfg(all(test, not(miri)))]
mod tests {
    use super::{simd::portable::two_way, *};
    use core::hint::black_box;

    /// All that have three letters at most.
    fn texts(len: u32) -> impl Iterator<Item = Vec<u8>> {
        let text = move |n| (0..len).map(|i| (n / 3u32.pow(i) % 3) as u8).collect();
        (0..3u32.pow(len)).map(text)
    }

    fn find<const M: usize, const FORWARD: bool>(text: &[u8], needle: &[u8]) -> Option<usize>
    where
        u8: Int<M>,
    {
        index_with::<_, FORWARD>(text, needle, |text, needle| {
            let at = if FORWARD {
                0
            } else {
                text.len() - needle.len()
            };
            two_way::<_, M, M, FORWARD>(text, needle, at, halves::<_, FORWARD>(needle))
        })
    }

    #[test]
    fn two_way_of_short_texts() {
        let needles: Vec<_> = (1..=5).flat_map(texts).collect();
        for (text, needle) in texts(8).flat_map(|it| needles.iter().map(move |n| (it.clone(), n))) {
            let places = || (0..text.len()).filter(|&at| text[at..].starts_with(needle));
            let [first, last] = [places().next(), places().next_back()];
            assert_eq!(
                [find::<1, true>, find::<16, true>].map(|f| f(&text, needle)),
                [first; 2]
            );
            assert_eq!(
                [find::<1, false>, find::<16, false>].map(|f| f(&text, needle)),
                [last; 2]
            );
        }
    }

    /// With the vectors of the widest targets, over texts long enough to skip many of them.
    #[test]
    fn two_way_skips_like_wide_targets() {
        use super::simd::portable64::two_way;
        let mut seed = 1u32;
        let mut random = |below: usize| {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            (seed >> 16) as usize % below
        };
        for _ in 0..3000 {
            let needle: Vec<u8> = (0..1 + random(6)).map(|_| random(3) as u8).collect();
            let len = needle.len() + random(400);
            let rare = 1 + random(16);
            let mut text: Vec<u8> = (0..len)
                .map(|_| {
                    if random(rare) == 0 {
                        random(3) as u8
                    } else {
                        3
                    }
                })
                .collect();
            if random(2) == 0 {
                let at = random(len - needle.len() + 1);
                text[at..][..needle.len()].copy_from_slice(&needle);
            }
            let places = || (0..text.len()).filter(|&at| text[at..].starts_with(&needle));
            let halves = |forward| match forward {
                true => halves::<_, true>(&needle),
                false => halves::<_, false>(&needle),
            };
            let found = two_way::<_, 64, 16, true>(&text, &needle, 0, halves(true));
            let last = text.len() - needle.len();
            let found_last = two_way::<_, 64, 16, false>(&text, &needle, last, halves(false));
            let index = |found: Option<&u8>| {
                found.map(|it| ptr::from_ref(it).addr() - text.as_ptr().addr())
            };
            assert_eq!(
                [index(found), index(found_last)],
                [places().next(), places().next_back()]
            );
        }
    }

    /// Does not end unless the time is linear.
    #[test]
    fn long_needle_that_has_changed() {
        let (text, len) = (b"ab".repeat(1 << 22), 1 << 22);
        for (changed, split, period) in [(0, 1, 2), (len - 4, len - 1, 1)] {
            let mut needle = text[..len].to_vec();
            needle[changed] = b'c';
            assert_eq!(find::<16, true>(&text, &needle), None);
            let halves = split_at(split, len, Some(period));
            black_box(two_way::<_, 16, 16, true>(&text, &needle, 0, halves));
        }
    }

    /// Does not end unless the time is linear.
    #[test]
    fn long_runs() {
        let run = b"ab".repeat(1 << 21);
        let (almost, len) = ([&run[1..], b"c"].concat(), run.len());
        let needle = [b"c", &run[..]].concat();
        assert_eq!(find::<16, true>(&almost.repeat(3), &needle), None);
        let needle = [b"a", &almost[..], &almost].concat();
        assert_eq!(halves::<_, true>(&needle), [len, len + 2, 0]);
    }
}
