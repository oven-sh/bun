use crate::Int;
use crate::isa::movemask_of;
pub(crate) use crate::native::{load_shared, store_shared};
pub use crate::portable::{bit_indices, prefix_xor};
pub(crate) use crate::portable::{load_shared_masked, store_shared_masked};
use core::arch::aarch64::*;
use core::simd::{ToBytes, prelude::*};

#[cfg(target_endian = "big")]
compile_error!("these ops assume little-endian lanes");

/// With SVE2, the ops are the same, but a load or a store can skip lanes.
#[derive(Clone, Copy)]
pub struct Neon<const HAS_SVE2: bool>;

crate::isa::vector_types!(Neon<false>, 16);

type Lanes<T, const N: usize, const S: bool> = crate::Vector<T, N, Neon<S>>;

/// `addp`
#[inline(always)]
fn pairwise_add(a: u8x16, b: u8x16) -> u8x16 {
    let (even, odd) = a.deinterleave(b);
    even + odd
}

/// For each byte, `offset` and its index in the last mask that has it set, or else `none`.
#[inline(always)]
fn select_indices<T: Int<N>, const N: usize, I: crate::Isa>(
    masks: impl Iterator<Item = (crate::Mask<T, N, I>, usize)>,
    offset: usize,
    none: u8,
) -> u8x16 {
    static INDICES: [u8; 65] = core::array::from_fn(const |i| i as u8);
    masks.fold(u8x16::splat(none), |others, (mask, start)| {
        let is_set = mask.to_vector().first_bytes::<16>();
        let indices = u8x16::from_slice(&INDICES[offset + start * size_of::<T>()..]);
        is_set & indices | !is_set & others
    })
}

impl<const S: bool> crate::Isa for Neon<S> {
    const MASKED_BYTES: usize = if S { 16 } else { 0 };
    const IS_SLOW_TO_SKIP_PAGE: bool = false;
    const HAS_INTERLEAVED_MEMORY: bool = true;
    const HAS_SINGLE_CYCLE_OPS: bool = false;

    /// `shrn` leaves 4 bits per byte.
    #[inline(always)]
    fn movemask<T: Int<N>, const N: usize>(mask: crate::Mask<T, N, Self>) -> (u64, usize) {
        if size_of::<[T; N]>() != 16 {
            return (mask.to_bitmask(), 1);
        }
        let nibbles = (u16x8::from_ne_bytes(mask.to_vector().first_bytes()) >> 4).cast::<u8>();
        (u64::from_ne_bytes(nibbles.to_array()), 4 * size_of::<T>())
    }

    #[inline(always)]
    fn any<T: Int<N>, const N: usize>(mask: crate::Mask<T, N, Self>) -> bool {
        mask.0.any()
    }

    #[inline(always)]
    fn first_set_of<T: Int<N>, const N: usize, const K: usize>(
        masks: [(crate::Mask<T, N, Self>, usize); K],
    ) -> Option<usize> {
        if size_of::<[T; N]>() != 16 {
            return movemask_of(masks).0.lowest_one().map(|lane| lane as usize);
        }
        let first = crate::opaque(
            select_indices(masks.into_iter().rev(), 0, 0xFF)
                .reduce_min()
                .into(),
        );
        (first != 0xFF).then_some(first as usize / size_of::<T>())
    }

    #[inline(always)]
    fn last_set_of<T: Int<N>, const N: usize, const K: usize>(
        masks: [(crate::Mask<T, N, Self>, usize); K],
    ) -> Option<usize> {
        if size_of::<[T; N]>() != 16 {
            return movemask_of(masks).0.highest_one().map(|lane| lane as usize);
        }
        let end = crate::opaque(select_indices(masks.into_iter(), 1, 0).reduce_max().into());
        (end != 0).then_some(end.wrapping_sub(1) as usize / size_of::<T>())
    }

    /// There is no `popcnt` for general registers.
    #[inline(always)]
    fn count_before<T: Int<N>, const N: usize>(
        mask: crate::Mask<T, N, Self>,
        lane: usize,
    ) -> usize {
        const STEP: &[u8; 32] = &core::array::from_fn(const |i| 1 - i as u8 / 16);
        if size_of::<[T; N]>() != 16 {
            return (mask.to_bitmask() & !u64::MAX.unbounded_shl(lane as u32)).count_ones()
                as usize;
        }
        let ones = u8x16::from_slice(&STEP[16 - lane * size_of::<T>()..]);
        // LLVM would widen the lanes first.
        let is_set = bun_simd_trusted::opaque16(mask.to_vector().first_bytes());
        usize::from((is_set & ones).reduce_sum()) / size_of::<T>()
    }

    #[inline(always)]
    fn bitmask_of_four<const N: usize>(masks: [crate::Mask<u8, N, Self>; 4]) -> u64
    where
        u8: Int<N>,
    {
        let own_bit = u64x2::splat(0x8040_2010_0804_0201).to_ne_bytes();
        let [a, b, c, d] = masks.map(|mask| mask.to_vector().first_bytes::<16>() & own_bit);
        let sums = pairwise_add(pairwise_add(a, b), pairwise_add(c, d));
        u64x2::from_ne_bytes(pairwise_add(sums, sums))[0]
    }

    #[inline(always)]
    fn saturating_cast_u8<const N: usize>(v: Lanes<i32, N, S>) -> Lanes<u8, N, S> {
        let words = v.0.simd_max(Simd::splat(0)).simd_min(Simd::splat(0xFFFF));
        Lanes::new(words.cast::<u16>().simd_min(Simd::splat(0xFF)).cast())
    }
}

impl<const S: bool> Lanes<u8, 16, S> {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn lookup(self, indices: Self) -> Self {
        Self::new(vqtbl1q_u8(self.0.into(), indices.0.into()))
    }

    #[inline]
    #[target_feature(enable = "neon")]
    pub fn saturating_narrow(first: Lanes<i16, 8, S>, second: Lanes<i16, 8, S>) -> Self {
        Self::new(vqmovun_high_s16(
            vqmovun_s16(first.0.into()),
            second.0.into(),
        ))
    }
}

impl<const S: bool> Lanes<i16, 8, S> {
    #[inline(always)]
    pub fn saturating_pairwise_dot(a: Lanes<u8, 16, S>, b: Lanes<i8, 16, S>) -> Self {
        let (a, b) = (
            a.bitcast::<Lanes<u16, 8, S>>(),
            b.bitcast::<Lanes<i16, 8, S>>(),
        );
        let even = (a & 0xFF).bitcast::<Lanes<i16, 8, S>>() * (b << 8 >> 8);
        let odd = (a >> 8).bitcast::<Lanes<i16, 8, S>>() * (b >> 8);
        Self::new(even.0.saturating_add(odd.0))
    }
}

impl<const S: bool> Lanes<i32, 4, S> {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn pairwise_dot(a: Lanes<i16, 8, S>, b: Lanes<i16, 8, S>) -> Self {
        let (a, b) = (a.0.into(), b.0.into());
        let low = vmull_s16(vget_low_s16(a), vget_low_s16(b));
        Self::new(vpaddq_s32(low, vmull_high_s16(a, b)))
    }
}

impl<const S: bool> Lanes<u64, 2, S> {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn sums_of_8(bytes: Lanes<u8, 16, S>) -> Self {
        Self::new(vpaddlq_u32(vpaddlq_u16(vpaddlq_u8(bytes.0.into()))))
    }
}

impl<const S: bool> Lanes<f32, 4, S> {
    #[inline(always)]
    pub fn to_i32(self) -> Lanes<i32, 4, S> {
        Lanes::new(self.0.cast())
    }

    #[inline]
    #[target_feature(enable = "neon")]
    pub fn mul_add(self, a: Self, b: Self) -> Self {
        Self::new(vfmaq_f32(b.0.into(), self.0.into(), a.0.into()))
    }
}
