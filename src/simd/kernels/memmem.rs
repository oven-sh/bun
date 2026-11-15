//! Port of highway_strings.cpp: a text in a text.
use bun_simd::{Int, Matches, SharedU8, Source};
use core::hint::cold_path;

trait Unit = Source<Lane: Ord + Into<u32>>;

#[inline(always)]
fn next(matches: &mut Matches, is_forward: bool) -> Option<usize> {
    match is_forward {
        true => matches.next(),
        false => matches.next_back(),
    }
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{U8, U16, Vector};

    /// Gives `verify` the places at which the units `a` and `b` of the needle match.
    #[inline(always)]
    fn search<S: Unit<Lane: Int<N>>, const N: usize, const FORWARD: bool, R>(
        haystack: &[S],
        needle: &[S],
        [a, b]: [usize; 2],
        verify: impl FnMut(Matches) -> Option<R>,
    ) -> Option<R> {
        let starts = haystack.len() - needle.len() + 1;
        let (at_a, at_b) = (&haystack[a..][..starts], &haystack[b..][..starts]);
        let (a, b) = (
            Vector::splat(needle[a].get()),
            Vector::splat(needle[b].get()),
        );
        let test = |x: Vector<_, N>, y: Vector<_, N>| x.simd_eq(a) & y.simd_eq(b);
        match FORWARD {
            true => Vector::zip_find_map(at_a, at_b, test, verify),
            false => Vector::zip_rfind_map(at_a, at_b, test, verify),
        }
    }

    #[inline(always)]
    fn ends<S: Unit, const N: usize>(units: &[S]) -> Option<[[S::Lane; N]; 2]> {
        let (first, (_, last)) = (units.first_chunk()?, units.split_last_chunk()?);
        Some([
            Vector::load(first).to_array(),
            Vector::load(last).to_array(),
        ])
    }

    /// For slices of the same length, up to 16.
    #[inline(always)]
    fn are_equal<S: Unit>(a: &[S], b: &[S]) -> bool {
        match a.len() {
            8.. => ends::<S, 8>(a) == ends(b),
            4.. => ends::<S, 4>(a) == ends(b),
            2.. => ends::<S, 2>(a) == ends(b),
            _ => ends::<S, 1>(a) == ends(b),
        }
    }

    /// The result, once it is known. `budget` keeps the time linear.
    #[inline(never)]
    fn verify_long<S: Unit<Lane: Int<N>>, const N: usize>(
        mut matches: Matches,
        is_forward: bool,
        haystack: &[S],
        needle: &[S],
        budget: &mut usize,
    ) -> Option<Option<usize>> {
        loop {
            let at = next(&mut matches, is_forward)?;
            let differ = |a: Vector<_, N>, b: Vector<_, N>| a.simd_ne(b);
            if Vector::zip_find_map_near(&haystack[at..], needle, differ, Some).is_none() {
                return Some(Some(at));
            }
            if *budget <= needle.len() {
                cold_path();
                return Some(if is_forward {
                    two_way::<S, true>(&haystack[at..], needle).map(|found| at + found)
                } else {
                    let until = at + needle.len();
                    two_way::<S, false>(&haystack[..until], needle).map(|found| at - found)
                });
            }
            *budget -= needle.len();
        }
    }

    #[inline(never)]
    fn find_long<S: Unit<Lane: Int<N>>, const N: usize, const FORWARD: bool>(
        haystack: &[S],
        needle: &[S],
    ) -> Option<usize> {
        let mut budget = 2 * haystack.len() + 32 * needle.len();
        let places = match haystack.len() / 16 < needle.len() {
            true => [0, needle.len() - 1],
            false => rarest_two(needle),
        };
        search::<S, N, FORWARD, _>(haystack, needle, places, |matches| {
            verify_long::<S, N>(matches, FORWARD, haystack, needle, &mut budget)
        })?
    }

    /// Would take registers from the search.
    #[inline(never)]
    fn verify_short<S: Unit>(
        mut matches: Matches,
        is_forward: bool,
        haystack: &[S],
        needle: &[S],
    ) -> Option<usize> {
        loop {
            let at = next(&mut matches, is_forward)?;
            if are_equal(&haystack[at..][..needle.len()], needle) {
                return Some(at);
            }
        }
    }

    #[inline(always)]
    fn find<S: Unit<Lane: Int<N>>, const N: usize, const FORWARD: bool>(
        haystack: &[S],
        needle: &[S],
    ) -> Option<usize> {
        match needle.len() {
            0 => Some(if FORWARD { 0 } else { haystack.len() }),
            len if len > haystack.len() => None,
            17.. => find_long::<S, N, FORWARD>(haystack, needle),
            len => search::<S, N, FORWARD, _>(haystack, needle, [0, len - 1], |matches| {
                verify_short(matches, FORWARD, haystack, needle)
            }),
        }
    }

    #[export]
    pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        find::<_, { U8::LEN }, true>(haystack, needle)
    }

    #[export]
    pub fn memmem_shared(haystack: &[SharedU8], needle: &[SharedU8]) -> Option<usize> {
        find::<_, { U8::LEN }, true>(haystack, needle)
    }

    #[export]
    pub fn memrmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        find::<_, { U8::LEN }, false>(haystack, needle)
    }

    #[export]
    pub fn memrmem_shared(haystack: &[SharedU8], needle: &[SharedU8]) -> Option<usize> {
        find::<_, { U8::LEN }, false>(haystack, needle)
    }

    #[export]
    pub fn memmem16_shared(haystack: &[[SharedU8; 2]], needle: &[[SharedU8; 2]]) -> Option<usize> {
        find::<_, { U16::LEN }, true>(haystack, needle)
    }

    #[export]
    pub fn memrmem16(haystack: &[u16], needle: &[u16]) -> Option<usize> {
        find::<_, { U16::LEN }, false>(haystack, needle)
    }

    #[export]
    pub fn memrmem16_shared(haystack: &[[SharedU8; 2]], needle: &[[SharedU8; 2]]) -> Option<usize> {
        find::<_, { U16::LEN }, false>(haystack, needle)
    }
}

/// The places of the two units whose low bytes are rarest in `needle`.
#[inline(never)]
fn rarest_two<S: Unit>(needle: &[S]) -> [usize; 2] {
    let (mut counts, low_byte) = ([0usize; 256], |unit: &S| unit.get().into() as usize & 0xFF);
    for unit in needle {
        counts[low_byte(unit)] += 1;
    }
    let count = |&i: &usize| counts[low_byte(&needle[i])];
    let first = (0..needle.len()).min_by_key(count).unwrap_or(0);
    let others = (0..needle.len()).rev().filter(|&i| i != first);
    [first, others.min_by_key(count).unwrap_or(0)]
}

#[inline(always)]
fn nth<S: Unit, const FORWARD: bool>(units: &[S], n: usize) -> S::Lane {
    units[if FORWARD { n } else { units.len() - 1 - n }].get()
}

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

/// How far to move if only the right half matches, and how much is known to match then.
fn after_right_half(is_periodic: bool, len: usize, split: usize, period: usize) -> [usize; 2] {
    match is_periodic {
        true => [period, len - period],
        false => [split.max(len - split) + 1, 0],
    }
}

/// The algorithm of Crochemore and Perrin. Returns the distance from where the search starts.
#[inline(never)]
fn two_way<S: Unit, const FORWARD: bool>(haystack: &[S], needle: &[S]) -> Option<usize> {
    let (len, nth) = (needle.len(), nth::<S, FORWARD>);
    let [ascending, descending] = [true, false].map(|it| maximal_suffix::<S, FORWARD>(needle, it));
    let [split, period] = ascending.max(descending);
    let is_periodic = (0..split).all(|i| nth(needle, i) == nth(needle, period + i));
    let [shift, known_after_shift] = after_right_half(is_periodic, len, split, period);
    let (mut at, mut known) = (0, 0);
    while let Some(left) = haystack.len().checked_sub(at + len) {
        let window = &haystack[if FORWARD { at } else { left }..][..len];
        let differs = |&i: &usize| nth(needle, i) != nth(window, i);
        if let Some(i) = (split.max(known)..len).find(differs) {
            (at, known) = (at + i - split + 1, 0);
        } else if (known..split).rev().any(|i| differs(&i)) {
            (at, known) = (at + shift, known_after_shift);
        } else {
            return Some(at);
        }
    }
    None
}
