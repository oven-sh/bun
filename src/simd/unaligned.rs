//! Gathers that clamp the indices, and need no alignment, as those of `crate::simd` do.

use crate::simd::{ToBytes, u8x32, u8x64, u32x8, u32x16};
#[cfg(target_arch = "x86")]
use core::arch::x86::*;
#[cfg(target_arch = "x86_64")]
use core::arch::x86_64::*;

macro_rules! gather { ($($name:ident $feature:literal $bytes:ident $indices:ident $size:literal $out:ident $gather:ident($($arg:ident),*) $p:ident $i:ident $min:ident $splat:ident;)*) => {$(
    /// The bytes from each index on, which counts steps. An index that is too large, or 2^31 and more, becomes the largest. Panics if `from` is shorter than a lane.
    #[inline]
    #[target_feature(enable = $feature)]
    pub fn $name<const STEP: i32, S: crate::simd::Cpu>(from: &[u8], at: $bytes) -> $out where crate::simd::Here: crate::simd::In<S> {
        const { assert!(matches!(STEP, 1 | 2 | 4 | 8)) };
        assert!(from.len() >= $size);
        let last = ((from.len() - $size) / STEP as usize).min(i32::MAX as usize) as u32;
        let ($p, $i) = (from.as_ptr().cast(), $min($indices::from_ne_bytes(at).into(), $splat(last as i32)));
        // SAFETY: no index is negative as an `i32`, and the lane at each ends in the slice.
        #[allow(unsafe_code)]
        unsafe { $gather::<STEP>($($arg),*) }.into()
    }
)*}; }
gather! {
    four_32 "avx2" u8x32 u32x8 4 u8x32 _mm256_i32gather_epi32(p, i) p i _mm256_min_epu32 _mm256_set1_epi32;
    four "avx512f" u8x64 u32x16 4 u8x64 _mm512_i32gather_epi32(i, p) p i _mm512_min_epu32 _mm512_set1_epi32;
    eight "avx512f" u8x32 u32x8 8 u8x64 _mm512_i32gather_epi64(i, p) p i _mm256_min_epu32 _mm256_set1_epi32;
}
