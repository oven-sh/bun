//! Port of highway_strings.cpp: a text in a text.
use bun_simd::{Int, Matches};
use core::hint::cold_path;

pub(crate) trait Unit: Copy + Ord + Into<u32> {}
impl Unit for u8 {}
impl Unit for u16 {}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{U8, U16, Vector};

    /// Gives `verify` the places at which the units `a` and `b` of the needle match.
    #[inline(always)]
    fn search<T: Int<N>, const N: usize, const FORWARD: bool, R>(
        haystack: &[T],
        needle: &[T],
        [a, b]: [usize; 2],
        verify: impl FnMut(Matches) -> Option<R>,
    ) -> Option<R> {
        let starts = haystack.len().checked_sub(needle.len())? + 1;
        let (at_a, at_b) = (&haystack[a..][..starts], &haystack[b..][..starts]);
        let (a, b) = (Vector::splat(needle[a]), Vector::splat(needle[b]));
        let test = |x: Vector<T, N>, y: Vector<T, N>| x.simd_eq(a) & y.simd_eq(b);
        match FORWARD {
            true => Vector::zip_find_map(at_a, at_b, test, verify),
            false => Vector::zip_rfind_map(at_a, at_b, test, verify),
        }
    }

    #[inline(never)]
    fn find_long<T: Unit + Int<N>, const N: usize, const FORWARD: bool>(
        haystack: &[T],
        needle: &[T],
    ) -> Option<usize> {
        let mut budget = 2 * haystack.len() + 32 * needle.len();
        let places = match haystack.len() / 16 < needle.len() {
            true => [0, needle.len() - 1],
            false => rarest_two(needle),
        };
        search::<T, N, FORWARD, _>(haystack, needle, places, |matches| {
            verify_long::<T, FORWARD>(matches, haystack, needle, &mut budget)
        })?
    }

    #[inline(always)]
    fn find<T: Unit + Int<N>, const N: usize, const FORWARD: bool>(
        haystack: &[T],
        needle: &[T],
    ) -> Option<usize> {
        match needle.len() {
            0 => Some(if FORWARD { 0 } else { haystack.len() }),
            17.. => find_long::<T, N, FORWARD>(haystack, needle),
            len => search::<T, N, FORWARD, _>(
                haystack,
                needle,
                [0, len - 1],
                #[inline(always)]
                |mut matches| {
                    let is_at = |&at: &usize| are_equal(&haystack[at..][..len], needle);
                    match FORWARD {
                        true => matches.find(is_at),
                        false => matches.rfind(is_at),
                    }
                },
            ),
        }
    }

    #[export]
    pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        find::<_, { U8::LEN }, true>(haystack, needle)
    }

    #[export]
    pub fn memrmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        find::<_, { U8::LEN }, false>(haystack, needle)
    }

    #[export]
    pub fn memmem16(haystack: &[u16], needle: &[u16]) -> Option<usize> {
        find::<_, { U16::LEN }, true>(haystack, needle)
    }

    #[export]
    pub fn memrmem16(haystack: &[u16], needle: &[u16]) -> Option<usize> {
        find::<_, { U16::LEN }, false>(haystack, needle)
    }
}

/// The places of the two units whose low bytes are rarest in `needle`.
#[inline(never)]
fn rarest_two<T: Unit>(needle: &[T]) -> [usize; 2] {
    let (mut counts, low_byte) = ([0usize; 256], |unit: T| unit.into() as usize & 0xFF);
    for &unit in needle {
        counts[low_byte(unit)] += 1;
    }
    let count = |&i: &usize| counts[low_byte(needle[i])];
    let first = (0..needle.len()).min_by_key(count).unwrap_or(0);
    let others = (0..needle.len()).rev().filter(|&i| i != first);
    [first, others.min_by_key(count).unwrap_or(0)]
}

#[inline(always)]
fn ends_are_equal<T: Unit, const N: usize>(a: &[T], b: &[T]) -> bool {
    a.first_chunk::<N>() == b.first_chunk() && a.last_chunk::<N>() == b.last_chunk()
}

/// For slices of the same length, up to 32.
#[inline(always)]
fn are_equal<T: Unit>(a: &[T], b: &[T]) -> bool {
    match a.len() {
        17.. => ends_are_equal::<T, 16>(a, b),
        8.. => ends_are_equal::<T, 8>(a, b),
        4.. => ends_are_equal::<T, 4>(a, b),
        2.. => ends_are_equal::<T, 2>(a, b),
        _ => a.first() == b.first(),
    }
}

/// The result, once it is known. `budget` keeps the time linear.
#[inline(never)]
fn verify_long<T: Unit, const FORWARD: bool>(
    mut matches: Matches,
    haystack: &[T],
    needle: &[T],
    budget: &mut usize,
) -> Option<Option<usize>> {
    loop {
        let at = if FORWARD {
            matches.next()
        } else {
            matches.next_back()
        }?;
        let candidate = &haystack[at..][..needle.len()];
        // For less, `memcmp` may load with a mask.
        if needle.len() > 32 && candidate == needle
            || needle.len() <= 32 && are_equal(candidate, needle)
        {
            return Some(Some(at));
        }
        if *budget <= needle.len() {
            cold_path();
            return Some(if FORWARD {
                two_way::<T, true>(&haystack[at..], needle).map(|found| at + found)
            } else {
                two_way::<T, false>(&haystack[..at + needle.len()], needle).map(|found| at - found)
            });
        }
        *budget -= needle.len();
    }
}

#[inline(always)]
fn nth<T: Unit, const FORWARD: bool>(units: &[T], n: usize) -> T {
    units[if FORWARD { n } else { units.len() - 1 - n }]
}

/// Where the greatest suffix in the given order starts, and its period.
fn maximal_suffix<T: Unit, const FORWARD: bool>(needle: &[T], is_ascending: bool) -> [usize; 2] {
    let (mut start, mut candidate, mut offset, mut period) = (0, 1, 0, 1);
    while candidate + offset < needle.len() {
        let [a, b] = [candidate, start].map(|from| nth::<T, FORWARD>(needle, from + offset));
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

/// The algorithm of Crochemore and Perrin. Returns the distance from where the search starts.
#[inline(never)]
fn two_way<T: Unit, const FORWARD: bool>(haystack: &[T], needle: &[T]) -> Option<usize> {
    let (len, nth) = (needle.len(), nth::<T, FORWARD>);
    let [ascending, descending] = [true, false].map(|it| maximal_suffix::<T, FORWARD>(needle, it));
    let [split, period] = ascending.max(descending);
    let (shift, known_after_shift) =
        match (0..split).all(|i| nth(needle, i) == nth(needle, period + i)) {
            true => (period, len - period),
            false => (split.max(len - split) + 1, 0),
        };
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
