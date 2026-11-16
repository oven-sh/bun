//! Shuffles that are known at compile time. `INDEX[i]` is where lane `i` comes from.
use core::array::from_fn;
use core::marker::PhantomData;
use core::simd::Swizzle;

/// For `Vector::shuffle`.
pub trait Shuffle<const N: usize> {
    /// Where each lane comes from. The lanes of the second vector follow those of the first.
    const FROM: [usize; N];
}

pub(crate) struct As<S>(PhantomData<S>);

impl<S: Shuffle<N>, const N: usize> Swizzle<N> for As<S> {
    const INDEX: [usize; N] = S::FROM;
}

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

/// Interleaves the first or the second halves of each block of 16 bytes.
pub(crate) struct InterleaveInBlocks<T, const HALF: usize>(PhantomData<T>);

impl<T, const HALF: usize, const N: usize> Swizzle<N> for InterleaveInBlocks<T, HALF> {
    const INDEX: [usize; N] = from_fn(const |i| {
        let block = 16 / size_of::<T>();
        i / block * block + (HALF * block + i % block) / 2 + i % 2 * N
    });
}

/// Every other lane of each block of 16 bytes, starting at `FIRST`.
pub(crate) struct DeinterleaveInBlocks<T, const FIRST: usize>(PhantomData<T>);

impl<T, const FIRST: usize, const N: usize> Swizzle<N> for DeinterleaveInBlocks<T, FIRST> {
    const INDEX: [usize; N] = from_fn(const |i| {
        let block = 16 / size_of::<T>();
        i / block * block + 2 * i % block + FIRST + 2 * i / block % 2 * N
    });
}
