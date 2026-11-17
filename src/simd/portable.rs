//! The definition of the ops that have intrinsics. Debug builds panic on input for which targets differ.
use crate::{BitIndices, Int, Out, SharedOutU8, SharedU8};
use bun_simd_trusted::{from_array, load_or_default};
use core::array;
use core::simd::{ToBytes, prelude::*};
pub(crate) use masked::*;

/// Runs anywhere, and takes the paths of the targets whose vectors have `BYTES` bytes.
#[derive(Clone, Copy)]
pub struct Portable<const BYTES: usize>;

impl<const BYTES: usize> crate::Isa for Portable<BYTES> {
    const HAS_MASK_REGISTERS: bool = BYTES == 64;
    const HAS_UNSIGNED_COMPARE: bool = BYTES != 32;
    const HAS_INTERLEAVED_MEMORY: bool = BYTES == 16;
    const HAS_SINGLE_CYCLE_OPS: bool = BYTES != 16;
}

type Lanes<T, const N: usize, const BYTES: usize> = crate::Vector<T, N, Portable<BYTES>>;

impl<const N: usize, const B: usize> Lanes<u8, N, B> {
    /// Looks up within each block of 16 bytes. An index must be below 16, or at least 128 for a zero.
    #[inline]
    pub fn lookup(self, indices: Self) -> Self {
        Self::from_array(array::from_fn(|i| {
            let index = usize::from(indices[i]);
            debug_assert!(!(16..128).contains(&index));
            if index < 128 {
                self[i / 16 * 16 + index % 16]
            } else {
                0
            }
        }))
    }

    /// The same for indices below 32. Those from 16 on go into `upper`.
    #[inline]
    pub fn lookup2(self, upper: Self, indices: Self) -> Self {
        Self::from_array(array::from_fn(|i| {
            let index = usize::from(indices[i]);
            debug_assert!(index < 32);
            [self, upper][index / 16 % 2][i / 16 * 16 + index % 16]
        }))
    }

    /// The lanes of `first`, then of `second`, clamped to `0..=255`.
    #[inline]
    pub fn saturating_narrow<const M: usize>(
        first: Lanes<i16, M, B>,
        second: Lanes<i16, M, B>,
    ) -> Self
    where
        Simd<i16, M>: ToBytes<Bytes = Simd<u8, N>>,
    {
        Self::from_array(array::from_fn(|i| {
            [first, second][i / M][i % M].clamp(0, 255) as u8
        }))
    }

    /// Like `saturating_narrow` for each block of 16 bytes.
    #[inline]
    pub fn pack<const M: usize>(first: Lanes<i16, M, B>, second: Lanes<i16, M, B>) -> Self
    where
        Simd<i16, M>: ToBytes<Bytes = Simd<u8, N>>,
    {
        Self::from_array(array::from_fn(|i| {
            [first, second][i / 8 % 2][i / 16 * 8 + i % 8].clamp(0, 255) as u8
        }))
    }
}

impl<const N: usize, const B: usize> Lanes<i8, N, B> {
    #[inline]
    pub fn pack<const M: usize>(first: Lanes<i16, M, B>, second: Lanes<i16, M, B>) -> Self
    where
        Simd<i16, M>: ToBytes<Bytes = Simd<u8, N>>,
    {
        Self::from_array(array::from_fn(|i| {
            [first, second][i / 8 % 2][i / 16 * 8 + i % 8].clamp(-128, 127) as i8
        }))
    }
}

impl<const N: usize, const B: usize> Lanes<u16, N, B> {
    #[inline]
    pub fn sums_of_2<const M: usize>(bytes: Lanes<u8, M, B>) -> Self
    where
        Simd<u16, N>: ToBytes<Bytes = Simd<u8, M>>,
    {
        let pairs = Simd::<u16, N>::from_ne_bytes(bytes.0);
        Self::new((pairs & Simd::splat(0xFF)) + (pairs >> 8))
    }
}

impl<const N: usize, const B: usize> Lanes<i16, N, B> {
    /// `a[2i] * b[2i] + a[2i + 1] * b[2i + 1]`, saturated.
    #[inline]
    pub fn saturating_pairwise_dot<const M: usize>(a: Lanes<u8, M, B>, b: Lanes<i8, M, B>) -> Self
    where
        Simd<i16, N>: ToBytes<Bytes = Simd<u8, M>>,
    {
        let products = a.0.cast::<i16>() * b.0.cast();
        let (even, odd) = products.deinterleave(products);
        Self::new(even.saturating_add(odd).extract::<0, N>())
    }

    #[inline]
    pub fn pack<const M: usize>(first: Lanes<i32, M, B>, second: Lanes<i32, M, B>) -> Self
    where
        Simd<i32, M>: ToBytes<Bytes = <Simd<i16, N> as ToBytes>::Bytes>,
        Simd<i16, N>: ToBytes,
    {
        Self::from_array(array::from_fn(|i| {
            [first, second][i / 4 % 2][i / 8 * 4 + i % 4].clamp(-32768, 32767) as i16
        }))
    }

    /// `a * b / 2^15`, with halves rounded up. They must not both be `i16::MIN`.
    #[inline]
    pub fn mul_q15(self, other: Self) -> Self {
        let product = self.0.cast::<i32>() * other.0.cast();
        debug_assert!(product.simd_ne(Simd::splat(1 << 30)).all());
        Self::new(((product + Simd::splat(1 << 14)) >> 15).cast())
    }

    /// `(a * b) >> 16`. They must not both be `i16::MIN`.
    #[inline]
    pub fn mul_high(self, other: Self) -> Self {
        let product = self.0.cast::<i32>() * other.0.cast();
        debug_assert!(product.simd_ne(Simd::splat(1 << 30)).all());
        Self::new((product >> 16).cast())
    }

    /// Negated where `sign` is negative. It must be zero where `sign` is.
    #[inline]
    pub fn mul_sign(self, sign: Self) -> Self {
        debug_assert!((0..N).all(|i| sign[i] != 0 || self[i] == 0));
        Self::new(self.0 * sign.0.signum())
    }
}

impl<const B: usize> Lanes<i16, 8, B> {
    /// The full products.
    #[inline]
    pub fn widening_mul(self, other: Self) -> Lanes<i32, 8, B> {
        self.full_products(other)
    }
}

impl<const N: usize, const B: usize> Lanes<i32, N, B> {
    /// `a[2i] * b[2i] + a[2i + 1] * b[2i + 1]`
    #[inline]
    pub fn pairwise_dot<const M: usize>(a: Lanes<i16, M, B>, b: Lanes<i16, M, B>) -> Self
    where
        Simd<i16, M>: ToBytes<Bytes = <Simd<i32, N> as ToBytes>::Bytes>,
        Simd<i32, N>: ToBytes,
    {
        let products = a.0.cast::<i32>() * b.0.cast();
        let (even, odd) = products.deinterleave(products);
        Self::new((even + odd).extract::<0, N>())
    }
}

impl<const B: usize> Lanes<u32, 4, B> {
    /// The sum of the absolute differences of each 4 lanes. The second and the last must be zero.
    #[inline]
    pub fn distances(a: Lanes<u8, 16, B>, b: Lanes<u8, 16, B>) -> Self {
        let pairs: Self = Lanes::<u16, 8, B>::sums_of_2(a.abs_diff(b)).bitcast();
        debug_assert!(pairs[1] | pairs[3] == 0);
        (pairs & 0xFFFF) + (pairs >> 16)
    }
}

impl<const N: usize, const B: usize> Lanes<u64, N, B> {
    #[inline]
    pub fn sums_of_8<const M: usize>(bytes: Lanes<u8, M, B>) -> Self
    where
        Simd<u64, N>: ToBytes<Bytes = Simd<u8, M>>,
    {
        let words = Simd::<u64, N>::from_ne_bytes(bytes.0);
        let even = Simd::splat(0x00FF_00FF_00FF_00FF);
        let pairs = (words & even) + (words >> 8 & even);
        let quads = pairs + (pairs >> 16);
        Self::new((quads + (quads >> 32)) & Simd::splat(0xFFFF))
    }
}

impl<const N: usize, const B: usize> Lanes<f32, N, B> {
    /// Rounds towards zero. The result for a lane out of range is unspecified.
    #[inline]
    pub fn to_i32(self) -> Lanes<i32, N, B> {
        debug_assert!(self.0.abs().simd_lt(Simd::splat(2147483648.0)).all());
        Lanes::new(self.0.cast())
    }

    /// `self * a + b`, rounded once or twice.
    #[inline]
    pub fn mul_add(self, a: Self, b: Self) -> Self {
        self * a + b
    }
}

/// Bit `i` of the result is the parity of bits `0..=i`.
#[inline(always)]
pub fn prefix_xor(mut bits: u64) -> u64 {
    for shift in [1, 2, 4, 8, 16, 32] {
        bits ^= bits << shift;
    }
    bits
}

/// The indices of the bits that are set.
#[inline(always)]
pub fn bit_indices(bits: u64) -> BitIndices {
    let compressed = None;
    BitIndices { bits, compressed }
}

pub(crate) mod masked {
    use super::*;

    /// To the first or the last lanes if `from` is too short. The others are zero.
    #[inline(always)]
    pub(crate) fn load_shared_masked<const TO_LAST: bool>(from: &[SharedU8]) -> u8x64 {
        let skipped = if TO_LAST { 64 - from.len().min(64) } else { 0 };
        let mut bytes = [0; 64];
        for (to, from) in bytes[skipped..].iter_mut().zip(from) {
            *to = from.get();
        }
        from_array(bytes)
    }

    /// As many of the first or the last lanes as fit.
    #[inline(always)]
    pub(crate) fn store_shared_masked<const FROM_LAST: bool>(v: u8x64, to: &[SharedOutU8]) {
        let skipped = if FROM_LAST { 64 - to.len().min(64) } else { 0 };
        for (to, &byte) in to.iter().zip(&v[skipped..]) {
            to.set(byte);
        }
    }

    #[inline(always)]
    pub(crate) fn load_to_last<T: Int<N>, const N: usize>(from: &[T]) -> u8x64 {
        let first = Lanes::<T, N, 64>::new(load_or_default(from)).to_64_bytes();
        rotate_bytes(first, size_of_val(from).wrapping_neg())
    }

    #[inline(always)]
    pub(crate) fn fill_from_last<T: Int<N>, const N: usize>(v: u8x64, to: Out<'_, T>) -> &mut [T] {
        let first = rotate_bytes(v, to.len() * size_of::<T>());
        to.fill_masked(Lanes::<T, N, 64>::from_first_bytes(first).0)
    }

    /// Lane `i` goes to lane `(i + by) % 64`.
    #[inline(always)]
    pub(crate) fn rotate_bytes(v: u8x64, by: usize) -> u8x64 {
        from_array(array::from_fn(|i| v[i.wrapping_sub(by) % 64]))
    }
}

/// The `A` at index `AT`, followed by zeros.
#[inline(always)]
pub(crate) fn load_shared<A, const K: usize, const AT: usize>(from: &[SharedU8]) -> u8x64 {
    load_shared_masked::<false>(&from[AT * size_of::<A>()..][..size_of::<A>()])
}

#[inline(always)]
pub(crate) fn store_shared<const N: usize, const K: usize, const AT: usize>(
    v: Simd<u8, N>,
    to: &[SharedOutU8],
) {
    store_shared_masked::<false>(v.resize(0), &to[AT * N..][..N]);
}

crate::isa::vector_types!(Portable<16>, 16);

#[cfg(any(feature = "test_support", not(target_arch = "x86_64")))]
pub mod portable32 {
    pub use super::{bit_indices, prefix_xor};
    pub(crate) use super::{load_shared, masked::*, store_shared};

    crate::isa::vector_types!(super::Portable<32>, 32);
}

#[cfg(any(feature = "test_support", not(target_arch = "x86_64")))]
pub mod portable64 {
    pub use super::prefix_xor;
    pub(crate) use super::{load_shared, masked::*, store_shared};

    crate::isa::vector_types!(super::Portable<64>, 64);

    #[inline]
    pub fn bit_indices(bits: u64) -> crate::BitIndices {
        let mut set = (0..64).filter(|i| bits >> i & 1 != 0);
        let compressed = Some(core::array::from_fn(|_| set.next().unwrap_or(0xAA)));
        crate::BitIndices { bits, compressed }
    }
}
