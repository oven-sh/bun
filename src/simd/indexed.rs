//! Gathers and scatters.

use crate::simd::{Cpu, Fits, Mask, Simd};

/// A bit for each lane that is enabled, and has an index below `len`. If it has 32 bits, also below 2^31.
#[inline(always)]
fn checked<S: Cpu, I: Fits<N>, const N: usize>(enable: Mask<I::Mask, N>, indices: Simd<I, N>, len: usize) -> u64 {
    const { assert!(!I::SIGNED && (I::SIZE == 4 || I::SIZE == size_of::<usize>())) };
    let end = if const { I::SIZE == 4 } { len.min(1 << 31) } else { len };
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
    let end = crate::simd::limit::<S>(end as u64);
    enable.and::<S>(indices.simd_lt::<S>(Simd::splat::<S>(I::of_bits(end as u64)))).to_bitmask::<S>()
}

/// By the sizes of indices and lanes, and their number.
macro_rules! rows { ($one:ident) => {
    #[cfg(all(target_arch = "x86_64", target_feature = "sse2", not(miri)))]
    if const { S::LEVEL >= crate::simd::AVX512 } {
        use {crate::simd::cast, core::arch::x86_64::*};
        rows! { @ $one
            4 4 4 _mm_mmask_i32gather_epi32 _mm_mask_i32scatter_epi32 4 4 8 _mm256_mmask_i32gather_epi32 _mm256_mask_i32scatter_epi32 4 4 16 _mm512_mask_i32gather_epi32 _mm512_mask_i32scatter_epi32
            4 8 2 _mm_mmask_i32gather_epi64 _mm_mask_i32scatter_epi64 4 8 4 _mm256_mmask_i32gather_epi64 _mm256_mask_i32scatter_epi64 4 8 8 _mm512_mask_i32gather_epi64 _mm512_mask_i32scatter_epi64
            8 4 2 _mm_mmask_i64gather_epi32 _mm_mask_i64scatter_epi32 8 4 4 _mm256_mmask_i64gather_epi32 _mm256_mask_i64scatter_epi32 8 4 8 _mm512_mask_i64gather_epi32 _mm512_mask_i64scatter_epi32
            8 8 2 _mm_mmask_i64gather_epi64 _mm_mask_i64scatter_epi64 8 8 4 _mm256_mmask_i64gather_epi64 _mm256_mask_i64scatter_epi64 8 8 8 _mm512_mask_i64gather_epi64 _mm512_mask_i64scatter_epi64
        }
    }
};
    (@ $one:ident $($index:literal $size:literal $n:literal $gather:ident $scatter:ident)*) => {$(
        if const { I::SIZE == $index && T::SIZE == $size && N == $n } {
            $one!($gather $scatter $size)
        }
    )*};
}

/// `table[index]`, or the lane of `or`. Indices of 32 bits reach the first 2^31 values.
#[inline(always)]
pub(crate) fn gather<S: Cpu, T: Fits<N>, I: Fits<N>, const N: usize>(
    table: &[T],
    enable: Mask<I::Mask, N>,
    indices: Simd<I, N>,
    mut or: Simd<T, N>,
) -> Simd<T, N> {
    let bits = checked::<S, I, N>(enable, indices, table.len());
    macro_rules! one {
        ($gather:ident $scatter:ident $size:literal) => {{
            let (or, bits, indices, table) = (cast(or.0), bits as _, cast(indices.0), table.as_ptr().cast());
            // SAFETY: `checked` enables a lane only if its index is in bounds, also as a signed number, and the scale is the size of `T`.
            // `rows!` gets here only if `S` has AVX-512.
            #[allow(unsafe_code)]
            return Simd::of(cast(unsafe { $gather::<$size>(or, bits, indices, table) }));
        }};
    }
    rows!(one);
    for i in 0..N {
        if bits >> i & 1 != 0 {
            or[i] = table[indices[i].bits() as usize];
        }
    }
    or
}

/// The reverse.
#[inline(always)]
pub(crate) fn scatter<S: Cpu, T: Fits<N>, I: Fits<N>, const N: usize>(
    v: Simd<T, N>,
    table: &mut [T],
    enable: Mask<I::Mask, N>,
    indices: Simd<I, N>,
) {
    let bits = checked::<S, I, N>(enable, indices, table.len());
    macro_rules! one {
        ($gather:ident $scatter:ident $size:literal) => {{
            let (table, bits, indices, v) = (table.as_mut_ptr().cast(), bits as _, cast(indices.0), cast(v.0));
            // SAFETY: as above.
            #[allow(unsafe_code)]
            return unsafe { $scatter::<$size>(table, bits, indices, v) };
        }};
    }
    rows!(one);
    for i in 0..N {
        if bits >> i & 1 != 0 {
            table[indices[i].bits() as usize] = v[i];
        }
    }
}
