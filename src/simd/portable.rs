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
    const HAS_PAIRWISE_DOT: bool = BYTES != 16;
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

impl<const B: usize> Lanes<u8, 64, B> {
    /// Looks up in all its lanes, then those of `upper`. The highest bit of an index does not count.
    #[inline]
    pub fn lookup2_across(self, upper: Self, indices: Self) -> Self {
        Self::from_array(array::from_fn(|i| {
            let index = usize::from(indices[i]);
            [self, upper][index / 64 % 2][index % 64]
        }))
    }

    /// The lanes with a bit in `bits` come first. The others are unspecified.
    #[inline]
    pub fn compress(self, bits: u64) -> Self {
        let mut kept = (0..64).filter(|i| bits >> i & 1 != 0);
        Self::from_array(array::from_fn(|_| kept.next().map_or(0xAA, |i| self[i])))
    }

    /// For each position in a lane, the number of lanes in which the bit is set.
    #[inline]
    pub fn count_by_position(lanes: Lanes<u64, 8, B>) -> Self {
        Self::from_array(array::from_fn(|at| {
            (0..8).map(|i| (lanes[i] >> at & 1) as u8).sum()
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

    /// Adds the products of four lanes each, wrapping. With 16 lanes, `b` must not be negative.
    #[inline]
    pub fn add_dot<const M: usize>(self, a: Lanes<u8, M, B>, b: Lanes<i8, M, B>) -> Self {
        const { assert!(M == 4 * N) };
        debug_assert!(M != 16 || b.0.reduce_min() >= 0);
        let products = a.cast::<i32>() * b.cast();
        self + Self::from_array(array::from_fn(|i| {
            (0..4).map(|j| products[4 * i + j]).sum()
        }))
    }
}

impl<const B: usize> Lanes<u32, 4, B> {
    /// The second and the last sum must be zero.
    #[inline]
    pub fn sums_of_4_abs_diffs(a: Lanes<u8, 16, B>, b: Lanes<u8, 16, B>) -> Self {
        let pairs: Self = Lanes::<u16, 8, B>::sums_of_2(a.abs_diff(b)).bitcast();
        debug_assert!(pairs[1] | pairs[3] == 0);
        (pairs & 0xFFFF) + (pairs >> 16)
    }
}

impl<const B: usize> Lanes<u32, 16, B> {
    /// Looks up in all its lanes. Only the lowest 4 bits of an index count.
    #[inline]
    pub fn lookup_across(self, indices: Self) -> Self {
        Self::from_array(array::from_fn(|i| self[indices[i] as usize % 16]))
    }

    /// Each lane by its own number of bits, modulo 32.
    #[inline]
    pub fn rotate_left(self, bits: Self) -> Self {
        Self::from_array(array::from_fn(|i| self[i].rotate_left(bits[i])))
    }
}

impl<const B: usize> Lanes<u64, 8, B> {
    /// Each lane by its own number of bits, modulo 64.
    #[inline]
    pub fn rotate_left(self, bits: Self) -> Self {
        Self::from_array(array::from_fn(|i| self[i].rotate_left(bits[i] as u32)))
    }

    /// Adds two bits to the one in each position. Returns the carries.
    #[inline]
    pub fn add_bits(&mut self, a: Self, b: Self) -> Self {
        let carries = a & b | *self & (a ^ b);
        *self ^= a ^ b;
        carries
    }
}

impl<const N: usize, const B: usize> Lanes<u64, N, B> {
    /// In each block of 16 bytes, the product of the first lanes as polynomials over GF(2).
    #[inline]
    pub fn carryless_mul_lower(self, other: Self) -> Self {
        Self::from_array(array::from_fn(|i| {
            let (a, b) = (u128::from(self[i & !1]), other[i & !1]);
            let set = (0..64).filter(|bit| b >> bit & 1 != 0);
            (set.fold(0, |all, bit| all ^ a << bit) >> (i % 2 * 64)) as u64
        }))
    }

    /// The same for the second lanes.
    #[inline]
    pub fn carryless_mul_upper(self, other: Self) -> Self {
        self.swap_pairs().carryless_mul_lower(other.swap_pairs())
    }

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

impl<const N: usize, const B: usize> Lanes<f64, N, B> {
    /// For an even number of lanes without NaN. The sign of a zero is unspecified.
    #[inline]
    pub fn min(self, other: Self) -> Self {
        const { assert!(N.is_multiple_of(2)) };
        debug_assert!(!(self.0.is_nan() | other.0.is_nan()).any());
        self.simd_lt(other).select(self, other)
    }
}

impl<const B: usize> Lanes<f64, 4, B> {
    /// The same for these.
    #[inline]
    pub fn to_i32(self) -> Lanes<i32, 4, B> {
        debug_assert!(self.0.abs().simd_lt(Simd::splat(2147483648.0)).all());
        Lanes::new(self.0.cast())
    }
}

impl<const B: usize> Lanes<u64, 4, B> {
    /// The lanes with a bit in `bits`, which must be below 16, come first. The others are unspecified.
    #[inline]
    pub fn compress(self, bits: usize) -> Self {
        debug_assert!(bits < 16);
        let mut kept = (0..4).filter(|i| bits >> i & 1 != 0);
        Self::from_array(array::from_fn(|_| kept.next().map_or(!0, |i| self[i])))
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

/// Adds the bytes of `word`, the lowest first, to the CRC-32 of gzip. Only Arm has an instruction.
#[inline(always)]
pub fn crc32_u64(crc: u32, word: u64) -> u32 {
    let step = |bits: u64, _| (bits >> 1) ^ ((bits & 1) * 0xEDB8_8320);
    (0..64).fold(word ^ u64::from(crc), step) as u32
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

pub(crate) use core::convert::identity as opaque_lanes;

crate::isa::vector_types!(Portable<16>, 16);

#[cfg(any(feature = "test_support", not(target_arch = "x86_64")))]
pub mod portable32 {
    pub use super::{bit_indices, crc32_u64, prefix_xor};
    pub(crate) use super::{load_shared, masked::*, opaque_lanes, store_shared};

    crate::isa::vector_types!(super::Portable<32>, 32);
}

#[cfg(any(feature = "test_support", not(target_arch = "x86_64")))]
pub mod portable64 {
    pub use super::{crc32_u64, prefix_xor};
    pub(crate) use super::{load_shared, masked::*, opaque_lanes, store_shared};

    crate::isa::vector_types!(super::Portable<64>, 64);

    #[inline]
    pub fn bit_indices(bits: u64) -> crate::BitIndices {
        let mut set = (0..64).filter(|i| bits >> i & 1 != 0);
        let compressed = Some(core::array::from_fn(|_| set.next().unwrap_or(0xAA)));
        crate::BitIndices { bits, compressed }
    }
}
