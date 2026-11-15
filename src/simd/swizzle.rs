//! Shuffles that are known at compile time. `INDEX[i]` is where lane `i` comes from.
use core::array::from_fn;
use core::simd::Swizzle;

/// Repeats the first `PERIOD` lanes.
pub(crate) struct Repeat<const PERIOD: usize>;

impl<const PERIOD: usize, const N: usize> Swizzle<N> for Repeat<PERIOD> {
    const INDEX: [usize; N] = from_fn(const |i| i % PERIOD);
}

/// One `ext` on NEON, unlike `Simd::shift_elements_right`.
pub(crate) struct ShiftRight<const OFFSET: usize>;

impl<const OFFSET: usize, const N: usize> Swizzle<N> for ShiftRight<OFFSET> {
    const INDEX: [usize; N] = from_fn(const |i| (N + i).saturating_sub(OFFSET));
}

pub(crate) struct SwapPairs;

impl<const N: usize> Swizzle<N> for SwapPairs {
    const INDEX: [usize; N] = from_fn(const |i| i ^ 1);
}

/// Every fourth lane, starting at `FIRST`.
pub(crate) struct EveryFourth<const FIRST: usize>;

impl<const FIRST: usize, const N: usize> Swizzle<N> for EveryFourth<FIRST> {
    const INDEX: [usize; N] = from_fn(const |i| FIRST + 4 * i);
}

/// Interleaves `K` blocks of 16 lanes.
pub(crate) struct Interleave<const K: usize>;

impl<const K: usize, const N: usize> Swizzle<N> for Interleave<K> {
    const INDEX: [usize; N] = from_fn(const |i| i / K + i % K * 16);
}
