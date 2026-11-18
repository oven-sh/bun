use crate::{Int, Lane, Mask, Vector, opaque};
use core::simd::prelude::{Simd, SimdInt, SimdOrd};

/// An instruction set. The methods are ops that LLVM lowers better from another spelling on some.
pub trait Isa: Copy {
    /// Comparisons write to them.
    const HAS_MASK_REGISTERS: bool = false;
    /// The size up to which loads and stores can skip lanes.
    const MASKED_BYTES: usize = if Self::HAS_MASK_REGISTERS { 64 } else { 0 };
    /// It takes hundreds of cycles to skip lanes in an unmapped page.
    const IS_SLOW_TO_SKIP_PAGE: bool = true;
    const HAS_UNSIGNED_COMPARE: bool = true;
    const HAS_LEADING_ZEROS: bool = true;
    /// `load_interleaved4` and `to_interleaved4` take one instruction.
    const HAS_INTERLEAVED_MEMORY: bool = false;
    /// `saturating_pairwise_dot` takes one instruction.
    const HAS_PAIRWISE_DOT: bool = true;
    /// The result of a simple op is there as soon as in a general register.
    const HAS_SINGLE_CYCLE_OPS: bool = true;

    #[doc(hidden)]
    #[inline(always)]
    fn to_bitmask<T: Lane, const N: usize>(mask: Mask<T, N, Self>) -> u64 {
        match N {
            // `core::simd` moves lanes around to have 8.
            ..8 => (0..N).fold(0, |bits, i| bits | u64::from(mask.0.test(i)) << i),
            _ => mask.0.to_bitmask(),
        }
    }

    /// The cheapest move to a general register: the bits, and the number of bits per lane.
    #[doc(hidden)]
    #[inline(always)]
    fn movemask<T: Int<N>, const N: usize>(mask: Mask<T, N, Self>) -> (u64, usize) {
        (mask.to_bitmask(), 1)
    }

    #[doc(hidden)]
    #[inline(always)]
    fn any<T: Int<N>, const N: usize>(mask: Mask<T, N, Self>) -> bool {
        Self::movemask(mask).0 != 0
    }

    #[doc(hidden)]
    #[inline(always)]
    fn count_before<T: Int<N>, const N: usize>(mask: Mask<T, N, Self>, lane: usize) -> usize {
        let (bits, bits_per_lane) = Self::movemask(mask);
        let before = bits & !u64::MAX.unbounded_shl((lane * bits_per_lane) as u32);
        before.count_ones() as usize / bits_per_lane
    }

    /// For masks with the index of their first lane, after `start`: ascending from 0, without gaps.
    #[doc(hidden)]
    #[inline(always)]
    fn nearest_set<T: Int<N>, const N: usize, const FORWARD: bool>(
        masks: &[(Mask<T, N, Self>, usize)],
        start: usize,
    ) -> Option<usize> {
        nearest_set::<T, N, Self, FORWARD>(masks, start)
    }

    /// One bit per lane.
    #[doc(hidden)]
    #[inline(always)]
    fn bitmask_of<T: Int<N>, const N: usize>(masks: &[(Mask<T, N, Self>, usize)]) -> u64 {
        bitmask_of(masks)
    }

    #[doc(hidden)]
    #[inline(always)]
    fn interleave<T: Int<N>, const N: usize>(
        a: Vector<T, N, Self>,
        b: Vector<T, N, Self>,
    ) -> (Vector<T, N, Self>, Vector<T, N, Self>) {
        let (first, second) = a.0.interleave(b.0);
        (Vector::new(first), Vector::new(second))
    }

    #[doc(hidden)]
    #[inline(always)]
    fn saturating_cast_u8<const N: usize>(v: Vector<i32, N, Self>) -> Vector<u8, N, Self> {
        Vector::new(
            v.0.simd_max(Simd::splat(0))
                .simd_min(Simd::splat(255))
                .cast(),
        )
    }
}

#[inline(always)]
pub(crate) fn nearest_set<T: Int<N>, const N: usize, I: Isa, const FORWARD: bool>(
    masks: &[(Mask<T, N, I>, usize)],
    start: usize,
) -> Option<usize> {
    debug_assert!(matches!((masks.len(), FORWARD), (1 | 2, _) | (4, true)));
    let (mut all, bits_per_lane) = I::movemask(masks[0].0);
    for &(mask, at) in &masks[1..] {
        // LLVM would put them together in a vector.
        all |= opaque(I::movemask(mask).0) << (at * bits_per_lane);
    }
    if I::HAS_MASK_REGISTERS {
        all = opaque(all);
    }
    let zeros = if FORWARD {
        all.trailing_zeros()
    } else {
        all.leading_zeros()
    } as usize;
    (all != 0).then_some(match (FORWARD, I::HAS_LEADING_ZEROS) {
        (true, _) => start + zeros / bits_per_lane,
        // For `63 - zeros`, LLVM picks `bsr`, which is slow before Zen 4.
        (false, true) => (start + 63 / bits_per_lane).wrapping_sub(zeros / bits_per_lane),
        (false, false) => start + (63 ^ zeros) / bits_per_lane,
    })
}

#[inline(always)]
pub(crate) fn bitmask_of<T: Int<N>, const N: usize, I: Isa>(
    masks: &[(Mask<T, N, I>, usize)],
) -> u64 {
    let mut all = 0;
    for &(mask, start) in masks {
        all |= mask.to_bitmask() << start;
    }
    all
}

/// The types in `isa`, for vectors of `$bytes` bytes.
macro_rules! vector_types {
    ($Isa:ty, $bytes:literal) => {
        pub type Isa = $Isa;
        pub type Vector<T, const N: usize> = crate::Vector<T, N, Isa>;
        pub type Mask<T, const N: usize> = crate::Mask<T, N, Isa>;
        crate::isa::vector_types!($bytes);

        pub mod x128 {
            pub use super::{Isa, Mask, Vector, bit_indices, prefix_xor};
            crate::isa::vector_types!(16);
        }

        pub mod x256 {
            pub use super::{Isa, Mask, Vector, bit_indices, prefix_xor};
            crate::isa::vector_types!(32);
        }
    };
    ($bytes:literal) => {
        pub type U8 = Vector<u8, $bytes>;
        pub type I8 = Vector<i8, $bytes>;
        pub type U16 = Vector<u16, { $bytes / 2 }>;
        pub type I16 = Vector<i16, { $bytes / 2 }>;
        pub type U32 = Vector<u32, { $bytes / 4 }>;
        pub type I32 = Vector<i32, { $bytes / 4 }>;
        pub type F32 = Vector<f32, { $bytes / 4 }>;
        pub type U64 = Vector<u64, { $bytes / 8 }>;
        pub type I64 = Vector<i64, { $bytes / 8 }>;
        pub type F64 = Vector<f64, { $bytes / 8 }>;
    };
}
pub(crate) use vector_types;
