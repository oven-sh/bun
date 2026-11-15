use crate::{Int, Mask, Vector, opaque};
use core::simd::prelude::{Simd, SimdInt, SimdOrd};

/// An instruction set. The methods are ops that LLVM lowers better from another spelling on some.
pub trait Isa: Copy {
    /// Comparisons write to them.
    const HAS_MASK_REGISTERS: bool = false;
    /// Loads and stores can skip lanes.
    const HAS_MASKED_MEMORY: bool = Self::HAS_MASK_REGISTERS;
    const HAS_UNSIGNED_COMPARE: bool = true;
    /// `load_interleaved4` and `store_interleaved4` take one instruction.
    const HAS_INTERLEAVED_MEMORY: bool = false;
    /// The result of a simple op is there as soon as in a general register.
    const HAS_SINGLE_CYCLE_OPS: bool = true;

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

    /// For masks with the index of their first lane: two halves without gaps, within 64 bytes.
    #[doc(hidden)]
    #[inline(always)]
    fn first_set_of<T: Int<N>, const N: usize, const K: usize>(
        masks: [(Mask<T, N, Self>, usize); K],
    ) -> Option<usize> {
        let (bits, bits_per_lane) = movemask_of(masks);
        (bits != 0).then_some(bits.trailing_zeros() as usize / bits_per_lane)
    }

    #[doc(hidden)]
    #[inline(always)]
    fn last_set_of<T: Int<N>, const N: usize, const K: usize>(
        masks: [(Mask<T, N, Self>, usize); K],
    ) -> Option<usize> {
        let (bits, bits_per_lane) = movemask_of(masks);
        (bits != 0).then_some((63 ^ bits.leading_zeros()) as usize / bits_per_lane)
    }

    /// For masks of 16 lanes.
    #[doc(hidden)]
    #[inline(always)]
    fn bitmask_of_four<const N: usize>([a, b, c, d]: [Mask<u8, N, Self>; 4]) -> u64
    where
        u8: Int<N>,
    {
        a.to_bitmask() | b.to_bitmask() << 16 | c.to_bitmask() << 32 | d.to_bitmask() << 48
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
pub(crate) fn movemask_of<T: Int<N>, const N: usize, I: Isa, const K: usize>(
    masks: [(Mask<T, N, I>, usize); K],
) -> (u64, usize) {
    let (mut all, bits_per_lane) = I::movemask(masks[0].0);
    for (mask, start) in &masks[1..] {
        // LLVM would put them together in a vector.
        all |= opaque(I::movemask(*mask).0) << (start * bits_per_lane);
    }
    (if K == 1 { opaque(all) } else { all }, bits_per_lane)
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
    };
}
pub(crate) use vector_types;
