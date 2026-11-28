//! Substring search. A filter compares a few units of the needle at many places at once.
//!
//! Another thread can change shared memory at any time. Then the result is still in range, and nothing panics.

use bun_simd::mem::Shared;
use bun_simd::prelude::*;
use core::hint::cold_path;
use core::sync::atomic::AtomicU8;

#[cfg(all(test, not(miri)))]
mod tests;

/// For slices of the same length, between one and two vectors.
#[simd]
fn same_ends<T: Unsigned, W: Width, E: Readable<T>>(a: &[E], b: &[E]) -> bool {
    let differ = |at| Simd::<T, W, S>::load_at(a, at) ^ Simd::load_at(b, at);
    let both = differ(0) | differ(b.len() - Simd::<T, W, S>::LANES);
    match W::BYTES {
        2 => both.bitcast::<u16>()[0] == 0,
        4 => both.bitcast::<u32>()[0] == 0,
        8 => both.bitcast::<u64>()[0] == 0,
        _ => both == Simd::zero(),
    }
}

#[simd]
fn starts_with<T: Unsigned, E: Readable<T>>(hay: &[E], needle: &[E]) -> bool {
    let hay = &hay[..needle.len()];
    match size_of_val(needle) {
        65.. => {
            let (n, mut at) = (Simd::<T, B32, S>::LANES, 0);
            let same = |at| Simd::<T, B32, S>::load_at(hay, at) == Simd::load_at(needle, at);
            while at < needle.len() - n {
                if !same(at) {
                    return false;
                }
                at += n;
            }
            same(needle.len() - n)
        }
        33.. => same_ends::<T, B32, E, S>(hay, needle),
        16.. => same_ends::<T, B16, E, S>(hay, needle),
        8.. => same_ends::<T, B8, E, S>(hay, needle),
        4.. => same_ends::<T, B4, E, S>(hay, needle),
        2.. => same_ends::<T, B2, E, S>(hay, needle),
        _ => hay[0].value() == needle[0].value(),
    }
}

#[kernel]
#[inline(always)]
fn is_at<T: Unsigned, E: Readable<T>>(hay: &[E], needle: &[E], at: usize) -> bool {
    starts_with::<T, E, S>(&hay[at..], needle)
}

/// Index `i` from the start or from the end.
struct Directed<'a, E, const FORWARD: bool>(&'a [E]);
impl<E, const FORWARD: bool> Directed<'_, E, FORWARD> {
    fn at<T: Lane>(&self, i: usize) -> T
    where
        E: Readable<T>,
    {
        self.0[if FORWARD { i } else { self.0.len() - 1 - i }].value()
    }

    /// The first such index from `start` on. Both have the same length.
    fn differs_from<T: Lane>(&self, other: &Self, start: usize) -> Option<usize>
    where
        E: Readable<T>,
    {
        let [a, b] = [self, other].map(|it| skip::<E, FORWARD>(it.0, start));
        let (mut pairs, differ) = (a.iter().zip(b), |(a, b): (&E, &E)| a.value() != b.value());
        let at = if FORWARD {
            pairs.position(differ)
        } else {
            pairs.rev().position(differ)
        };
        Some(start + at?)
    }
}

/// Two-Way search (Crochemore and Perrin, 1991): linear time, constant space.
/// Derived from musl libc's memmem (MIT; see LICENSE.md).
#[cold]
#[inline(never)]
fn two_way<T: Unsigned, E: Readable<T>, const FORWARD: bool>(
    hay: &[E],
    needle: &[E],
    start: usize,
) -> usize {
    let (n, m) = (hay.len(), needle.len());
    let needle = Directed::<_, FORWARD>(needle);
    // The start of the maximal suffix, and its period.
    let suffix = |greater: bool| {
        let (mut start, mut j, mut k, mut period) = (0, 0, 1, 1);
        while j + k < m {
            let (a, b) = (needle.at::<T>(j + k), needle.at(start + k - 1));
            if a == b {
                if k == period {
                    (j, k) = (j + period, 1)
                } else {
                    k += 1
                }
            } else if (a > b) == greater {
                (j, k) = (j + k, 1);
                period = j + 1 - start;
            } else {
                j += 1;
                (start, k, period) = (j, 1, 1);
            }
        }
        (start, period)
    };
    let (x, y) = (suffix(true), suffix(false));
    let (split, mut period) = if x.0 > y.0 { x } else { y };
    let periodic = (0..split).all(|i| needle.at::<T>(i) == needle.at(i + period));
    let known = if periodic { m - period } else { 0 };
    if !periodic {
        period = split.max(m - split) + 1;
    }
    let (lanes, pivot) = (16 / size_of::<T>(), needle.at::<T>(split));
    let mut rest = skip::<E, FORWARD>(hay, if FORWARD { start } else { n - start - m });
    let (mut memory, mut misses) = (0, 0usize);
    while let Some(spare) = rest.len().checked_sub(m) {
        let window = Directed::<_, FORWARD>(near::<E, FORWARD>(rest, m));
        let mut shift = period;
        if let Some(k) = needle.differs_from::<T>(&window, split.max(memory)) {
            (shift, memory) = (k + 1 - split, 0);
            misses = if k == split { misses + 1 } else { 0 };
            // Skips the windows that differ in the first unit that is compared.
            while misses >= 4 && shift + lanes <= spare {
                let from = if FORWARD {
                    shift + split
                } else {
                    rest.len() - shift - split - lanes
                };
                let same = Simd::<T, B16, Baseline>::load_at(rest, from).simd_eq(pivot);
                if let Some(k) = if FORWARD {
                    same.first_set()
                } else {
                    same.last_set()
                } {
                    shift += if FORWARD { k } else { lanes - 1 - k };
                    break;
                }
                shift += lanes;
            }
        } else if (memory..split.min(m))
            .rev()
            .all(|k| needle.at::<T>(k) == window.at(k))
        {
            return if FORWARD { n - rest.len() } else { spare };
        } else {
            memory = known;
        }
        if shift > spare {
            break;
        }
        rest = skip::<E, FORWARD>(rest, shift);
    }
    NOT_FOUND
}

/// A bit for each place that has both units, where they fill between one and two vectors.
#[simd]
fn with_both<T: Unsigned, W: Width, E: Readable<T>>([(at_a, a), (at_b, b)]: [(&[E], T); 2]) -> u64 {
    let last = at_a.len() - Simd::<T, W, S>::LANES;
    let has = |it, at, unit: T| Simd::<T, W, S>::load_at(it, at).simd_eq(unit);
    let bits = |at| (has(at_a, at, a) & has(at_b, at, b)).to_bitmask();
    bits(0) | bits(last) << last
}

#[simd]
fn few_with<T: Unsigned, E: Readable<T>>(units: [(&[E], T); 2]) -> u64 {
    match size_of_val(units[0].0) {
        33.. => with_both::<T, B32, E, S>(units),
        16.. => with_both::<T, B16, E, S>(units),
        8.. => with_both::<T, B8, E, S>(units),
        4.. => with_both::<T, B4, E, S>(units),
        2.. => with_both::<T, B2, E, S>(units),
        _ => 1,
    }
}

#[kernel]
#[inline(never)]
fn few_with_rarest<T: Unsigned, E: Readable<T>>(hay: &[E], needle: &[E]) -> u64 {
    let ([a, b], count) = (rarest(needle), hay.len() + 1 - needle.len());
    let unit = |k: usize| (&hay[k..][..count], needle[k].value());
    few_with::<T, E, S>([unit(a), unit(b)])
}

/// For up to 64 bytes of places.
#[kernel]
#[inline(never)]
fn search_few<T: Unsigned, E: Readable<T>, const FORWARD: bool>(hay: &[E], needle: &[E]) -> usize {
    let end = needle.len() - 1;
    let places = &hay[..hay.len() - end];
    let units = [
        (places, needle[0].value()),
        (&hay[end..], needle[end].value()),
    ];
    let bits = few_with::<T, E, S>(units);
    if bits == 0 {
        return NOT_FOUND;
    }
    first_match::<T, E, FORWARD>(hay, needle, bits)
}

#[inline(never)]
fn first_match<T: Unsigned, E: Readable<T>, const FORWARD: bool>(
    hay: &[E],
    needle: &[E],
    mut bits: u64,
) -> usize {
    if needle.len() > 16 && bits.count_ones() > 16 {
        bits &= few_with_rarest::baseline::<T, E>(hay, needle);
    }
    while bits != 0 {
        let at = next::<FORWARD>(bits);
        if is_at::baseline::<T, E>(hay, needle, at) {
            return at;
        }
        bits = others::<FORWARD>(bits, at);
    }
    NOT_FOUND
}

/// The places that are looked at in one step.
#[simd]
type Wide = Twice<Upto<B32, S>>;

/// A unit of the needle, and where it is.
#[simd]
type Unit<T> = (usize, Simd<T, Wide<S>, S>);

#[simd]
fn unit<T: Unsigned, E: Readable<T>>(needle: &[E], k: usize) -> Unit<T, S> {
    (k, Simd::splat(needle[k].value()))
}

/// The places at the start of `block` that have all of these, one or two.
#[simd]
fn with_all<T: Unsigned, E: Readable<T>, const K: usize>(
    block: &[E],
    units: [Unit<T, S>; K],
) -> MaskOf<T, Wide<S>, S> {
    let each = array::map(units, |(k, unit)| Simd::load_at(block, k).simd_eq(unit));
    each[0] & each[K - 1]
}

/// The first block of `rest` that has such places, where it starts, and these. If there is none, it is the last of `hay`,
/// which overlaps the one before it.
#[simd]
fn next_block<'a, T: Unsigned, E: Readable<T>, const FORWARD: bool>(
    hay: &'a [E],
    rest: &mut &'a [E],
    span: usize,
    units: [Unit<T, S>; 2],
) -> (&'a [E], usize, MaskOf<T, Wide<S>, S>) {
    let start = |left| {
        if FORWARD {
            hay.len() - left
        } else {
            left - span
        }
    };
    while rest.len() > span {
        let block = near::<E, FORWARD>(rest, span);
        let found = with_all(block, units);
        if found.any() {
            cold_path();
            return (block, start(rest.len()), found);
        }
        *rest = skip::<E, FORWARD>(rest, Simd::<T, Wide<S>, S>::LANES);
    }
    let block = skip::<E, FORWARD>(hay, hay.len() - span);
    (block, start(span), with_all(block, units))
}

/// For more than 64 bytes of places.
#[kernel]
#[inline(never)]
fn search_many<T: Unsigned, E: Readable<T>, const FORWARD: bool>(hay: &[E], needle: &[E]) -> usize {
    assert!(!needle.is_empty());
    let (n, end) = (Simd::<T, Wide<S>, S>::LANES, needle.len() - 1);
    let (span, first, last, mut rest) = (n + end, unit(needle, 0), unit(needle, end), hay);
    let block = near::<E, FORWARD>(hay, span);
    // Past `block`, and more places without unit `k` if it `lacks` that. Its loads are aligned then, if the units are.
    let after = |k: usize, lacks: bool| {
        let over = (block.as_ptr().addr() / size_of::<T>() + k) % n;
        let mut rest = skip::<E, FORWARD>(hay, if FORWARD { n - over } else { over });
        let (four, unit) = (4 * SimdN::<T, S>::LANES, needle[k].value());
        let has = |it| Simd::<T, Twice<Twice<Native<S>>>, S>::load_at(it, k).simd_eq(unit);
        while lacks && rest.len() >= four + end && has(near::<E, FORWARD>(rest, four + end)).none()
        {
            rest = skip::<E, FORWARD>(rest, four);
        }
        rest
    };
    // The compiler can't merge loads of shared memory, so the masks are kept.
    let (block, start, mut found) = 'found: {
        let with_first = with_all(block, [first]);
        if with_first.none() {
            rest = if hay.len() >= span + 4 * SimdN::<T, S>::LANES {
                after(0, true)
            } else {
                skip::<E, FORWARD>(hay, n)
            };
        } else {
            let with_last = with_all(block, [last]);
            if (with_first & with_last).any() {
                let start = if FORWARD { 0 } else { hay.len() - span };
                break 'found (block, start, with_first & with_last);
            }
            rest = if size_of_val(hay) > LONG || size_of_val(hay) > LONG / 2 && with_last.none() {
                after(end, with_last.none())
            } else {
                skip::<E, FORWARD>(hay, n)
            };
        }
        next_block::<T, E, FORWARD, S>(hay, &mut rest, span, [first, last])
    };
    if end > 1 {
        found &= with_all(block, [unit(needle, end / 2)]);
    }
    if let Some(at) = if FORWARD {
        found.first_set()
    } else {
        found.last_set()
    } {
        if end < 3 || size_of_val(needle) <= 32 && starts_with::<T, E, S>(&block[at..], needle) {
            return start + at;
        }
        let (unused, bits) = (if FORWARD { 64 - n } else { 0 }, found.to_bitmask());
        return here_or_later::<T, E, FORWARD>(
            hay,
            needle,
            start.wrapping_sub(unused),
            bits << unused,
        );
    }
    if rest.len() <= span {
        return NOT_FOUND;
    }
    search_rest::here::<T, E, FORWARD, S>(hay, needle, rest.len() - n)
}

/// Tries some of the 64 places from `start` on.
#[inline(never)]
fn here_or_later<T: Unsigned, E: Readable<T>, const FORWARD: bool>(
    hay: &[E],
    needle: &[E],
    start: usize,
    mut bits: u64,
) -> usize {
    let mut tries = 6;
    loop {
        not_unrolled();
        let bit = next::<FORWARD>(bits);
        let at = start.wrapping_add(bit);
        if is_at::baseline::<T, E>(hay, needle, at) {
            return at;
        }
        (bits, tries) = (others::<FORWARD>(bits, bit), tries - 1);
        if bits == 0 || tries == 0 {
            break;
        }
    }
    let left = if FORWARD {
        hay.len() - start.wrapping_add(next::<true>(bits))
    } else {
        start + needle.len() + 63 - bits.leading_zeros() as usize
    };
    if left < needle.len() {
        return NOT_FOUND;
    }
    search_rest::<T, E, FORWARD>(hay, needle, left)
}

/// From here on it pays to align loads, and from half of it if the first block lacks the last unit.
const LONG: usize = 2048;

/// The two units that are the rarest in the needle itself, by their lower bytes.
#[inline(never)]
fn rarest<T: Unsigned, E: Readable<T>>(needle: &[E]) -> [usize; 2] {
    let end = needle.len() - 1;
    let (mut counts, byte) = ([0u32; 256], |it: &E| usize::from(it.value().to_u64() as u8));
    for it in needle {
        let count = &mut counts[byte(it)];
        *count = count.wrapping_add(1);
    }
    // The first of the rarest, and the last of the rarest among the others.
    let (mut a, mut b) = ((u32::MAX, 0), (u32::MAX, end));
    for (i, it) in needle.iter().enumerate() {
        let count = counts[byte(it)];
        if count < a.0 {
            cold_path();
            (a, b) = ((count, i), if a.0 < b.0 { a } else { b });
        } else if count <= b.0 {
            b = (count, i);
        }
    }
    [a.1, b.1]
}

/// Goes on where so many units are `left`.
#[kernel]
#[inline(never)]
fn search_rest<T: Unsigned, E: Readable<T>, const FORWARD: bool>(
    hay: &[E],
    needle: &[E],
    left: usize,
) -> usize {
    let (n, end) = (Simd::<T, Wide<S>, S>::LANES, needle.len() - 1);
    let (span, mut rest) = (n + end, skip::<E, FORWARD>(hay, hay.len() - left));
    let ks = if end < 16 { [0, end] } else { rarest(needle) };
    if size_of_val(rest) > LONG && left > span {
        // One of the loads is aligned, if the units are.
        let over = (near::<E, FORWARD>(rest, span).as_ptr().addr() / size_of::<T>() + ks[0]) % n;
        let back = if FORWARD { over } else { (n - over) % n };
        rest = skip::<E, FORWARD>(hay, (hay.len() - left).saturating_sub(back));
    }
    let mut budget = 2 * hay.len() + 32 * needle.len();
    let [a, b, c] = array::map([ks[0], ks[1], end / 2], |k| unit(needle, k));
    loop {
        let (block, start, found) = next_block::<T, E, FORWARD, S>(hay, &mut rest, span, [a, b]);
        let mut bits = (found & with_all(block, [c])).to_bitmask();
        if !(span..=left).contains(&rest.len()) {
            cold_path();
            let done = rest.len().max(span) - rest.len().min(left);
            bits &= if FORWARD {
                !0 << done
            } else {
                !0 >> (64 - n + done)
            };
        }
        while bits != 0 {
            let at = next::<FORWARD>(bits);
            if starts_with::<T, E, S>(&block[at..], needle) {
                return start + at;
            }
            // The time stays linear.
            if budget <= needle.len() {
                return two_way::<T, E, FORWARD>(hay, needle, start + at);
            }
            (bits, budget) = (others::<FORWARD>(bits, at), budget - needle.len());
        }
        if rest.len() <= span {
            return NOT_FOUND;
        }
        rest = skip::<E, FORWARD>(rest, n);
    }
}

/// The first or the last `count`.
#[inline(always)]
fn near<E, const FORWARD: bool>(values: &[E], count: usize) -> &[E] {
    if FORWARD {
        &values[..count]
    } else {
        &values[values.len() - count..]
    }
}

/// Without the first or the last `count`.
#[inline(always)]
fn skip<E, const FORWARD: bool>(values: &[E], count: usize) -> &[E] {
    if FORWARD {
        &values[count..]
    } else {
        &values[..values.len() - count]
    }
}

const NOT_FOUND: usize = usize::MAX;

#[inline(always)]
fn next<const FORWARD: bool>(bits: u64) -> usize {
    if FORWARD {
        bits.trailing_zeros() as usize
    } else {
        63 - bits.leading_zeros() as usize
    }
}

/// Without the next bit that is set, which is `at`.
#[inline(always)]
fn others<const FORWARD: bool>(bits: u64, at: usize) -> u64 {
    bits & if FORWARD { bits - 1 } else { !(!0 << at) }
}

#[inline(always)]
fn search<T: Unsigned, E: Readable<T>, const FORWARD: bool>(hay: &[E], needle: &[E]) -> usize {
    if needle.is_empty() {
        return if FORWARD { 0 } else { hay.len() };
    }
    match hay.len().checked_sub(needle.len()) {
        None => NOT_FOUND,
        Some(spare) if spare < 64 / size_of::<T>() => {
            search_few::baseline::<T, E, FORWARD>(hay, needle)
        }
        Some(_) => search_many::<T, E, FORWARD>(hay, needle),
    }
}

#[inline(always)]
fn found(at: usize) -> Option<usize> {
    (at != NOT_FOUND).then_some(at)
}

pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if let &[byte] = needle {
        return super::search::index_of_char(haystack, byte);
    }
    found(search::<u8, _, true>(haystack, needle))
}

/// The start of the last occurrence. An empty needle matches at `haystack.len()`.
pub fn memrmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if let &[byte] = needle {
        return super::search::last_index_of_char(haystack, byte);
    }
    found(search::<u8, _, false>(haystack, needle))
}

#[kernel]
#[inline(never)]
fn index_of_unit(text: &[u16], unit: u16) -> Option<usize> {
    over(text).position(|v| v.simd_eq(unit))
}

pub fn memmem16(haystack: &[u16], needle: &[u16]) -> Option<usize> {
    if let (33.., &[unit]) = (haystack.len(), needle) {
        return index_of_unit(haystack, unit);
    }
    found(search::<u16, _, true>(haystack, needle))
}

/// The start of the last occurrence. An empty needle matches at `haystack.len()`.
pub fn memrmem16(haystack: &[u16], needle: &[u16]) -> Option<usize> {
    found(search::<u16, _, false>(haystack, needle))
}

pub(crate) fn memmem_shared(haystack: &[AtomicU8], needle: &[AtomicU8]) -> usize {
    search::<u8, _, true>(haystack, needle)
}

pub(crate) fn memrmem_shared(haystack: &[AtomicU8], needle: &[AtomicU8]) -> usize {
    if let [byte] = needle {
        return super::shared::last(haystack, byte.value(), NOT_FOUND);
    }
    search::<u8, _, false>(haystack, needle)
}

pub(crate) fn memmem16_shared(haystack: &[Shared<2>], needle: &[Shared<2>]) -> usize {
    search::<u16, _, true>(haystack, needle)
}

pub(crate) fn memrmem16_shared(haystack: &[Shared<2>], needle: &[Shared<2>]) -> usize {
    search::<u16, _, false>(haystack, needle)
}
