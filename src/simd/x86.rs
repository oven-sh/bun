use crate::native::{self, as_group};
use crate::{BitIndices, Int, Isa, Mask, Out, Vector};
use bun_simd_trusted::{SharedOutU8, SharedU8, shared};
use core::arch::x86_64::*;
use core::simd::ToBytes;
use core::simd::prelude::{Simd, SimdPartialOrd, SimdUint, simd_swizzle, u8x64, u64x8};

#[derive(Clone, Copy)]
pub struct Sse4;
#[derive(Clone, Copy)]
pub struct Avx2;
#[derive(Clone, Copy)]
pub struct Avx512Skx;
#[derive(Clone, Copy)]
pub struct Avx512Icl;

/// One bit per byte.
#[inline(always)]
fn pmovmskb<T: Int<N>, const N: usize, I: Isa>(mask: Mask<T, N, I>) -> (u64, usize) {
    let bytes = mask.to_vector();
    let bits = match size_of::<[T; N]>() {
        16 => bytes
            .first_bytes::<16>()
            .cast::<i8>()
            .simd_lt(Simd::splat(0))
            .to_bitmask(),
        32 => bytes
            .first_bytes::<32>()
            .cast::<i8>()
            .simd_lt(Simd::splat(0))
            .to_bitmask(),
        _ => return (mask.to_bitmask(), 1),
    };
    (bits, size_of::<T>())
}

impl Isa for Sse4 {
    const HAS_UNSIGNED_COMPARE: bool = false;
    const HAS_LEADING_ZEROS: bool = false;

    #[inline(always)]
    fn movemask<T: Int<N>, const N: usize>(mask: Mask<T, N, Self>) -> (u64, usize) {
        pmovmskb(mask)
    }
}

impl Isa for Avx2 {
    const HAS_UNSIGNED_COMPARE: bool = false;

    #[inline(always)]
    fn movemask<T: Int<N>, const N: usize>(mask: Mask<T, N, Self>) -> (u64, usize) {
        pmovmskb(mask)
    }
}

impl Isa for Avx512Skx {
    const HAS_MASK_REGISTERS: bool = true;

    /// There is no shuffle of bytes across blocks of 16.
    #[inline(always)]
    fn interleave<T: Int<N>, const N: usize>(
        a: Vector<T, N, Self>,
        b: Vector<T, N, Self>,
    ) -> (Vector<T, N, Self>, Vector<T, N, Self>) {
        if size_of::<T>() != 1 || N != 64 {
            let (first, second) = a.0.interleave(b.0);
            return (Vector::new(first), Vector::new(second));
        }
        let [a, b] = [a, b].map(|it| Vector::<u8, 64, Self>::new(it.first_bytes()));
        let (low, high) = a.interleave_in_blocks(b);
        let [low, high] = [low, high].map(|it| u64x8::from_ne_bytes(it.0));
        let first = simd_swizzle!(low, high, [0, 1, 8, 9, 2, 3, 10, 11]);
        let second = simd_swizzle!(low, high, [4, 5, 12, 13, 6, 7, 14, 15]);
        (
            Vector::from_first_bytes(first.to_ne_bytes()),
            Vector::from_first_bytes(second.to_ne_bytes()),
        )
    }
}

impl Isa for Avx512Icl {
    const HAS_MASK_REGISTERS: bool = true;
}

/// Has the 128-bit ops.
pub trait Xmm: Isa {}
impl Xmm for Sse4 {}
impl Xmm for Avx2 {}
impl Xmm for Avx512Skx {}
impl Xmm for Avx512Icl {}

/// Has the 256-bit ops.
pub trait Ymm: Isa {}
impl Ymm for Avx2 {}
impl Ymm for Avx512Skx {}
impl Ymm for Avx512Icl {}

/// Has the 512-bit ops.
pub trait Zmm: Isa {}
impl Zmm for Avx512Skx {}
impl Zmm for Avx512Icl {}

impl<I: Xmm> Vector<u8, 16, I> {
    #[inline]
    #[target_feature(enable = "ssse3")]
    pub fn lookup(self, indices: Self) -> Self {
        Self::new(_mm_shuffle_epi8(self.0.into(), indices.0.into()))
    }

    #[inline]
    #[target_feature(enable = "ssse3")]
    pub fn lookup2(self, upper: Self, indices: Self) -> Self {
        self.lookup(indices + 0x70) | upper.lookup(indices - 16)
    }

    #[inline]
    #[target_feature(enable = "sse2")]
    pub fn saturating_narrow(first: Vector<i16, 8, I>, second: Vector<i16, 8, I>) -> Self {
        Self::new(_mm_packus_epi16(first.0.into(), second.0.into()))
    }

    #[inline]
    #[target_feature(enable = "sse2")]
    pub fn pack(first: Vector<i16, 8, I>, second: Vector<i16, 8, I>) -> Self {
        Self::saturating_narrow(first, second)
    }
}

impl<I: Xmm> Vector<i8, 16, I> {
    #[inline]
    #[target_feature(enable = "sse2")]
    pub fn pack(first: Vector<i16, 8, I>, second: Vector<i16, 8, I>) -> Self {
        Self::new(_mm_packs_epi16(first.0.into(), second.0.into()))
    }
}

impl<I: Xmm> Vector<u16, 8, I> {
    #[inline]
    #[target_feature(enable = "ssse3")]
    pub fn sums_of_2(bytes: Vector<u8, 16, I>) -> Self {
        Self::new(_mm_maddubs_epi16(bytes.0.into(), _mm_set1_epi8(1)))
    }
}

impl<I: Xmm> Vector<i16, 8, I> {
    #[inline(always)]
    pub fn widening_mul(self, other: Self) -> Vector<i32, 8, I> {
        self.full_products(other)
    }

    #[inline]
    #[target_feature(enable = "sse2")]
    pub fn pack(first: Vector<i32, 4, I>, second: Vector<i32, 4, I>) -> Self {
        Self::new(_mm_packs_epi32(first.0.into(), second.0.into()))
    }

    #[inline]
    #[target_feature(enable = "ssse3")]
    pub fn mul_q15(self, other: Self) -> Self {
        Self::new(_mm_mulhrs_epi16(self.0.into(), other.0.into()))
    }

    #[inline]
    #[target_feature(enable = "sse2")]
    pub fn mul_high(self, other: Self) -> Self {
        Self::new(_mm_mulhi_epi16(self.0.into(), other.0.into()))
    }

    #[inline]
    #[target_feature(enable = "ssse3")]
    pub fn mul_sign(self, sign: Self) -> Self {
        Self::new(_mm_sign_epi16(self.0.into(), sign.0.into()))
    }

    #[inline]
    #[target_feature(enable = "ssse3")]
    pub fn saturating_pairwise_dot(a: Vector<u8, 16, I>, b: Vector<i8, 16, I>) -> Self {
        Self::new(_mm_maddubs_epi16(a.0.into(), b.0.into()))
    }
}

impl<I: Xmm> Vector<i32, 4, I> {
    #[inline]
    #[target_feature(enable = "sse2")]
    pub fn pairwise_dot(a: Vector<i16, 8, I>, b: Vector<i16, 8, I>) -> Self {
        Self::new(_mm_madd_epi16(a.0.into(), b.0.into()))
    }
}

impl<I: Xmm> Vector<u64, 2, I> {
    #[inline]
    #[target_feature(enable = "sse2")]
    pub fn sums_of_8(bytes: Vector<u8, 16, I>) -> Self {
        Self::new(_mm_sad_epu8(bytes.0.into(), _mm_setzero_si128()))
    }
}

impl<I: Xmm> Vector<f32, 4, I> {
    #[inline]
    #[target_feature(enable = "sse2")]
    pub fn to_i32(self) -> Vector<i32, 4, I> {
        Vector::new(_mm_cvttps_epi32(self.0.into()))
    }

    #[inline(always)]
    pub fn mul_add(self, a: Self, b: Self) -> Self {
        self * a + b
    }
}

impl<I: Ymm> Vector<u8, 32, I> {
    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn lookup(self, indices: Self) -> Self {
        Self::new(_mm256_shuffle_epi8(self.0.into(), indices.0.into()))
    }

    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn lookup2(self, upper: Self, indices: Self) -> Self {
        self.lookup(indices + 0x70) | upper.lookup(indices - 16)
    }

    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn saturating_narrow(first: Vector<i16, 16, I>, second: Vector<i16, 16, I>) -> Self {
        let packed = _mm256_packus_epi16(first.0.into(), second.0.into());
        Self::new(_mm256_permute4x64_epi64::<0b11_01_10_00>(packed))
    }

    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn pack(first: Vector<i16, 16, I>, second: Vector<i16, 16, I>) -> Self {
        Self::new(_mm256_packus_epi16(first.0.into(), second.0.into()))
    }
}

impl<I: Ymm> Vector<i8, 32, I> {
    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn pack(first: Vector<i16, 16, I>, second: Vector<i16, 16, I>) -> Self {
        Self::new(_mm256_packs_epi16(first.0.into(), second.0.into()))
    }
}

impl<I: Ymm> Vector<u16, 16, I> {
    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn sums_of_2(bytes: Vector<u8, 32, I>) -> Self {
        Self::new(_mm256_maddubs_epi16(bytes.0.into(), _mm256_set1_epi8(1)))
    }
}

impl<I: Ymm> Vector<i16, 16, I> {
    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn pack(first: Vector<i32, 8, I>, second: Vector<i32, 8, I>) -> Self {
        Self::new(_mm256_packs_epi32(first.0.into(), second.0.into()))
    }

    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn mul_q15(self, other: Self) -> Self {
        Self::new(_mm256_mulhrs_epi16(self.0.into(), other.0.into()))
    }

    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn mul_high(self, other: Self) -> Self {
        Self::new(_mm256_mulhi_epi16(self.0.into(), other.0.into()))
    }

    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn mul_sign(self, sign: Self) -> Self {
        Self::new(_mm256_sign_epi16(self.0.into(), sign.0.into()))
    }

    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn saturating_pairwise_dot(a: Vector<u8, 32, I>, b: Vector<i8, 32, I>) -> Self {
        Self::new(_mm256_maddubs_epi16(a.0.into(), b.0.into()))
    }
}

impl<I: Ymm> Vector<i32, 8, I> {
    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn pairwise_dot(a: Vector<i16, 16, I>, b: Vector<i16, 16, I>) -> Self {
        Self::new(_mm256_madd_epi16(a.0.into(), b.0.into()))
    }
}

impl<I: Ymm> Vector<u64, 4, I> {
    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn sums_of_8(bytes: Vector<u8, 32, I>) -> Self {
        Self::new(_mm256_sad_epu8(bytes.0.into(), _mm256_setzero_si256()))
    }
}

impl<I: Ymm> Vector<f32, 8, I> {
    #[inline]
    #[target_feature(enable = "avx")]
    pub fn to_i32(self) -> Vector<i32, 8, I> {
        Vector::new(_mm256_cvttps_epi32(self.0.into()))
    }

    #[inline]
    #[target_feature(enable = "fma")]
    pub fn mul_add(self, a: Self, b: Self) -> Self {
        Self::new(_mm256_fmadd_ps(self.0.into(), a.0.into(), b.0.into()))
    }
}

impl<I: Zmm> Vector<u8, 64, I> {
    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn lookup(self, indices: Self) -> Self {
        Self::new(_mm512_shuffle_epi8(self.0.into(), indices.0.into()))
    }

    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn lookup2(self, upper: Self, indices: Self) -> Self {
        self.lookup(indices + 0x70) | upper.lookup(indices - 16)
    }

    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn saturating_narrow(first: Vector<i16, 32, I>, second: Vector<i16, 32, I>) -> Self {
        let packed = _mm512_packus_epi16(first.0.into(), second.0.into());
        Self::new(_mm512_permutexvar_epi64(
            _mm512_setr_epi64(0, 2, 4, 6, 1, 3, 5, 7),
            packed,
        ))
    }

    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn pack(first: Vector<i16, 32, I>, second: Vector<i16, 32, I>) -> Self {
        Self::new(_mm512_packus_epi16(first.0.into(), second.0.into()))
    }
}

impl<I: Zmm> Vector<i8, 64, I> {
    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn pack(first: Vector<i16, 32, I>, second: Vector<i16, 32, I>) -> Self {
        Self::new(_mm512_packs_epi16(first.0.into(), second.0.into()))
    }
}

impl<I: Zmm> Vector<u16, 32, I> {
    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn sums_of_2(bytes: Vector<u8, 64, I>) -> Self {
        Self::new(_mm512_maddubs_epi16(bytes.0.into(), _mm512_set1_epi8(1)))
    }
}

impl<I: Zmm> Vector<i16, 32, I> {
    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn pack(first: Vector<i32, 16, I>, second: Vector<i32, 16, I>) -> Self {
        Self::new(_mm512_packs_epi32(first.0.into(), second.0.into()))
    }

    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn mul_q15(self, other: Self) -> Self {
        Self::new(_mm512_mulhrs_epi16(self.0.into(), other.0.into()))
    }

    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn mul_high(self, other: Self) -> Self {
        Self::new(_mm512_mulhi_epi16(self.0.into(), other.0.into()))
    }

    #[inline(always)]
    pub fn mul_sign(self, sign: Self) -> Self {
        sign.simd_lt(0).select(self.wrapping_neg(), self)
    }

    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn saturating_pairwise_dot(a: Vector<u8, 64, I>, b: Vector<i8, 64, I>) -> Self {
        Self::new(_mm512_maddubs_epi16(a.0.into(), b.0.into()))
    }
}

impl<I: Zmm> Vector<i32, 16, I> {
    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn pairwise_dot(a: Vector<i16, 32, I>, b: Vector<i16, 32, I>) -> Self {
        Self::new(_mm512_madd_epi16(a.0.into(), b.0.into()))
    }
}

impl<I: Zmm> Vector<u64, 8, I> {
    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn sums_of_8(bytes: Vector<u8, 64, I>) -> Self {
        Self::new(_mm512_sad_epu8(bytes.0.into(), _mm512_setzero_si512()))
    }
}

impl<I: Zmm> Vector<f32, 16, I> {
    #[inline]
    #[target_feature(enable = "avx512f")]
    pub fn to_i32(self) -> Vector<i32, 16, I> {
        Vector::new(_mm512_cvttps_epi32(self.0.into()))
    }

    #[inline]
    #[target_feature(enable = "avx512f")]
    pub fn mul_add(self, a: Self, b: Self) -> Self {
        Self::new(_mm512_fmadd_ps(self.0.into(), a.0.into(), b.0.into()))
    }
}

pub mod sse4 {
    pub(crate) use crate::native::{load_shared, store_shared};
    pub(crate) use crate::portable::masked::*;
    pub use crate::portable::{bit_indices, prefix_xor};

    crate::isa::vector_types!(super::Sse4, 16);
    crate::native::x256_in_halves!("ssse3");
}

pub mod avx2 {
    use super::*;
    pub use crate::portable::bit_indices;
    pub(crate) use crate::portable::masked::*;

    crate::isa::vector_types!(Avx2, 32);

    #[inline]
    #[target_feature(enable = "pclmulqdq")]
    pub fn prefix_xor(bits: u64) -> u64 {
        let product = _mm_clmulepi64_si128::<0>(_mm_cvtsi64_si128(bits as i64), _mm_set1_epi8(-1));
        _mm_cvtsi128_si64(product) as u64
    }

    #[inline]
    #[target_feature(enable = "avx")]
    pub(crate) fn load_shared<A, const K: usize, const AT: usize>(from: &[SharedU8]) -> u8x64 {
        match const { size_of::<A>() } {
            32 => shared::load32::<K, AT>(as_group(from)).resize(0),
            16 => shared::load16_vex::<K, AT>(as_group(from)).resize(0),
            _ => native::load_shared::<A, K, AT>(from),
        }
    }

    #[inline]
    #[target_feature(enable = "avx")]
    pub(crate) fn store_shared<const N: usize, const K: usize, const AT: usize>(
        v: Simd<u8, N>,
        to: &[SharedOutU8],
    ) {
        match N {
            32 => shared::store32::<K, AT>(v.resize(0), as_group(to)),
            16 => shared::store16_vex::<K, AT>(v.resize(0), as_group(to)),
            _ => native::store_shared::<N, K, AT>(v, to),
        }
    }
}

mod avx512 {
    pub(crate) use super::shared::load64_masked as load_shared_masked;
    pub(crate) use super::shared::store64_masked as store_shared_masked;
    use super::*;

    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub(crate) fn load_to_last<T: Int<N>, const N: usize>(from: &[T]) -> u8x64 {
        shared::load64_masked::<true>(from)
    }

    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub(crate) fn fill_from_last<T: Int<N>, const N: usize>(v: u8x64, to: Out<'_, T>) -> &mut [T] {
        to.fill_from_last(v)
    }

    #[inline]
    #[target_feature(enable = "avx512f")]
    pub(crate) fn load_shared<A, const K: usize, const AT: usize>(from: &[SharedU8]) -> u8x64 {
        match const { size_of::<A>() } {
            64 => shared::load64::<K, AT>(as_group(from)),
            _ => avx2::load_shared::<A, K, AT>(from),
        }
    }

    #[inline]
    #[target_feature(enable = "avx512f")]
    pub(crate) fn store_shared<const N: usize, const K: usize, const AT: usize>(
        v: Simd<u8, N>,
        to: &[SharedOutU8],
    ) {
        match N {
            64 => shared::store64::<K, AT>(v.resize(0), as_group(to)),
            _ => avx2::store_shared::<N, K, AT>(v, to),
        }
    }
}

pub mod avx512_skx {
    pub use super::avx2::prefix_xor;
    pub(crate) use super::avx512::*;
    use super::*;
    pub use crate::portable::bit_indices;

    crate::isa::vector_types!(Avx512Skx, 64);

    #[inline]
    #[target_feature(enable = "avx512f")]
    pub(crate) fn rotate_bytes(v: u8x64, by: usize) -> u8x64 {
        let words = _mm512_permutexvar_epi64((U64::iota() - by as u64 / 8).0.into(), v.into());
        let before = _mm512_alignr_epi64::<7>(words, words);
        let bits = by as u64 % 8 * 8;
        (u64x8::from(words) << bits | u64x8::from(before) >> 1 >> (63 - bits)).to_ne_bytes()
    }
}

pub mod avx512_icl {
    pub use super::avx2::prefix_xor;
    pub(crate) use super::avx512::*;
    use super::*;

    crate::isa::vector_types!(Avx512Icl, 64);

    #[inline]
    #[target_feature(enable = "avx512vbmi2")]
    pub fn bit_indices(bits: u64) -> BitIndices {
        // The zeroing form has a false dependency on Zen 4 and 5: https://github.com/golang/go/issues/81609
        let all = U8::iota().0.into();
        let compressed = Some(U8::new(_mm512_mask_compress_epi8(all, bits, all)).to_array());
        BitIndices { bits, compressed }
    }

    #[inline]
    #[target_feature(enable = "avx512vbmi")]
    pub(crate) fn rotate_bytes(v: u8x64, by: usize) -> u8x64 {
        _mm512_permutexvar_epi8((U8::iota() - by as u8).0.into(), v.into()).into()
    }
}
