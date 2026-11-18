use crate::isa::{bitmask_of, nearest_set};
pub(crate) use crate::native::{load_shared, opaque_lanes, store_shared};
pub(crate) use crate::portable::masked::*;
pub use crate::portable::{bit_indices, prefix_xor};
use crate::vector::{from_slice, to_array};
use crate::{Int, Lane, opaque};
use bun_simd_trusted::{from_array, opaque16};
use core::arch::aarch64::*;
use core::array::from_fn;
use core::simd::{Select, ToBytes, prelude::*};

#[cfg(target_endian = "big")]
compile_error!("these ops assume little-endian lanes");

/// With SVE2, the ops are the same, but a load or a store can skip lanes.
#[derive(Clone, Copy)]
pub struct Neon<const HAS_SVE2: bool>;

crate::isa::vector_types!(Neon<false>, 16);
crate::native::x256_in_halves!("neon");

type Lanes<T, const N: usize, const S: bool> = crate::Vector<T, N, Neon<S>>;

/// A step of the CRC-32 of gzip, without the inversions.
#[inline]
#[target_feature(enable = "crc")]
pub fn crc32_u64(crc: u32, word: u64) -> u32 {
    __crc32d(crc, word)
}

/// `addp`
#[inline(always)]
fn pairwise_add(a: u8x16, b: u8x16) -> u8x16 {
    let (even, odd) = a.deinterleave(b);
    even + odd
}

/// For each byte, its index in the nearer mask that has it set, or 255. Backward: from 1 on, or 0.
#[inline(always)]
fn select_indices<T: Int<N>, const N: usize, I: crate::Isa, const FORWARD: bool>(
    low: (crate::Mask<T, N, I>, usize),
    high: (crate::Mask<T, N, I>, usize),
) -> u8x16 {
    static INDICES: [u8; 64] = from_fn(const |i| i as u8);
    let indices = |at: usize| {
        let bytes = from_slice(&INDICES[at * size_of::<T>() + usize::from(!FORWARD)..]);
        // With SVE, LLVM computes them, which takes long for wider lanes.
        if N < 16 { opaque16(bytes) } else { bytes }
    };
    let [(near, at), (far, far_at)] = if FORWARD { [low, high] } else { [high, low] };
    let far = far.to_vector().first_bytes();
    // LLVM would put an `and` before the `orn` for a union of tests, and take the `bsl` apart.
    let others = match FORWARD {
        true => indices(far_at) | !opaque16(far),
        false => opaque16(indices(far_at) & far),
    };
    let lanes = crate::Vector::from_first_bytes::<16>;
    near.select(lanes(indices(at)), lanes(others)).first_bytes()
}

impl<const S: bool> crate::Isa for Neon<S> {
    const MASKED_BYTES: usize = if S { 16 } else { 0 };
    const IS_SLOW_TO_SKIP_PAGE: bool = false;
    const HAS_INTERLEAVED_MEMORY: bool = true;
    const HAS_PAIRWISE_DOT: bool = false;
    const HAS_SINGLE_CYCLE_OPS: bool = false;

    /// LLVM would move up to 8 bits through the stack, and add up 64 in four parts.
    #[inline(always)]
    fn to_bitmask<T: Lane, const N: usize>(mask: crate::Mask<T, N, Self>) -> u64 {
        let own_bit = Simd::splat(1) << crate::Vector::<u32, N, Self>::iota().0;
        match N {
            ..8 => mask.0.select(own_bit, Simd::splat(0)).reduce_sum().into(),
            8 => (mask.0.select(own_bit.cast::<u16>(), Simd::splat(0)))
                .reduce_sum()
                .into(),
            64 => {
                let all = Lanes::<i8, 64, S>::new(mask.0.cast::<i8>().to_simd().resize(0));
                let [[a, b], [c, d]] = all.halves().map(|half| half.halves());
                let part = |lanes: Lanes<i8, 16, S>, start| (lanes.simd_lt(0), start);
                Self::bitmask_of(&[part(a, 0), part(b, 16), part(c, 32), part(d, 48)])
            }
            _ => mask.0.to_bitmask(),
        }
    }

    /// `shrn` leaves 4 bits per byte.
    #[inline(always)]
    fn movemask<T: Int<N>, const N: usize>(mask: crate::Mask<T, N, Self>) -> (u64, usize) {
        if size_of::<[T; N]>() != 16 {
            return (mask.to_bitmask(), 1);
        }
        let nibbles = (u16x8::from_ne_bytes(mask.to_vector().first_bytes()) >> 4).cast::<u8>();
        (u64::from_ne_bytes(to_array(nibbles)), 4 * size_of::<T>())
    }

    #[inline(always)]
    fn any<T: Int<N>, const N: usize>(mask: crate::Mask<T, N, Self>) -> bool {
        mask.0.any()
    }

    #[inline(always)]
    fn nearest_set<T: Int<N>, const N: usize, const FORWARD: bool>(
        masks: &[(crate::Mask<T, N, Self>, usize)],
        start: usize,
    ) -> Option<usize> {
        let select = select_indices::<T, N, Self, FORWARD>;
        let indices = match *masks {
            _ if size_of::<[T; N]>() != 16 || masks.len() == 1 => {
                return nearest_set::<T, N, Self, FORWARD>(masks, start);
            }
            [a, b] => select(a, b),
            [a, b, c, d] if FORWARD => select(a, b).simd_min(select(c, d)),
            _ => unreachable!(),
        };
        if FORWARD {
            let first = opaque(indices.reduce_min().into());
            return (first != 0xFF).then_some(start + first as usize / size_of::<T>());
        }
        let end = opaque(indices.reduce_max().into());
        (end != 0).then(|| start + (end - 1) as usize / size_of::<T>())
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
        let ones: u8x16 = from_slice(&STEP[16 - lane * size_of::<T>()..]);
        // LLVM would widen the lanes first.
        let is_set = opaque16(mask.to_vector().first_bytes());
        usize::from((is_set & ones).reduce_sum()) / size_of::<T>()
    }

    #[inline(always)]
    fn bitmask_of<T: Int<N>, const N: usize>(masks: &[(crate::Mask<T, N, Self>, usize)]) -> u64 {
        let own_bit = u64x2::splat(0x8040_2010_0804_0201).to_ne_bytes();
        let bytes = |i: usize| masks[i % masks.len()].0.to_vector().first_bytes::<16>();
        let sums = match (size_of::<T>(), N) {
            (1, 16) => {
                let [a, b, c, d] = from_fn(|i| bytes(i) & own_bit);
                pairwise_add(pairwise_add(a, b), pairwise_add(c, d))
            }
            (2, 8) => {
                let [ab, cd] = from_fn(|i| bytes(2 * i).deinterleave(bytes(2 * i + 1)).0 & own_bit);
                pairwise_add(pairwise_add(ab, cd), pairwise_add(ab, cd))
            }
            _ => return bitmask_of(masks),
        };
        let (all, mut bits) = (u64x2::from_ne_bytes(pairwise_add(sums, sums))[0], 0);
        for i in 0..masks.len() {
            bits |= (all >> (N * i) & !(u64::MAX << N)) << masks[i].1;
        }
        bits
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
    pub fn lookup2(self, upper: Self, indices: Self) -> Self {
        let both = uint8x16x2_t(self.0.into(), upper.0.into());
        Self::new(vqtbl2q_u8(both, indices.0.into()))
    }

    #[inline]
    #[target_feature(enable = "neon")]
    pub fn saturating_narrow(first: Lanes<i16, 8, S>, second: Lanes<i16, 8, S>) -> Self {
        Self::new(vqmovun_high_s16(
            vqmovun_s16(first.0.into()),
            second.0.into(),
        ))
    }

    #[inline]
    #[target_feature(enable = "neon")]
    pub fn pack(first: Lanes<i16, 8, S>, second: Lanes<i16, 8, S>) -> Self {
        Self::saturating_narrow(first, second)
    }
}

impl<const S: bool> Lanes<i8, 16, S> {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn pack(first: Lanes<i16, 8, S>, second: Lanes<i16, 8, S>) -> Self {
        Self::new(vqmovn_high_s16(vqmovn_s16(first.0.into()), second.0.into()))
    }
}

impl<const S: bool> Lanes<u16, 8, S> {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn sums_of_2(bytes: Lanes<u8, 16, S>) -> Self {
        Self::new(vpaddlq_u8(bytes.0.into()))
    }
}

impl<const S: bool> Lanes<i16, 8, S> {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn widening_mul(self, other: Self) -> Lanes<i32, 8, S> {
        let (a, b) = (self.0.into(), other.0.into());
        let low = vmull_s16(vget_low_s16(a), vget_low_s16(b));
        Lanes::<_, 8, S>::from_halves([Lanes::new(low), Lanes::new(vmull_high_s16(a, b))])
    }

    #[inline]
    #[target_feature(enable = "neon")]
    pub fn pack(first: Lanes<i32, 4, S>, second: Lanes<i32, 4, S>) -> Self {
        Self::new(vqmovn_high_s32(vqmovn_s32(first.0.into()), second.0.into()))
    }

    #[inline]
    #[target_feature(enable = "neon")]
    pub fn mul_q15(self, other: Self) -> Self {
        Self::new(vqrdmulhq_s16(self.0.into(), other.0.into()))
    }

    #[inline]
    #[target_feature(enable = "neon")]
    pub fn mul_high(self, other: Self) -> Self {
        Self::new(vqdmulhq_s16(self.0.into(), other.0.into())) >> 1
    }

    #[inline(always)]
    pub fn mul_sign(self, sign: Self) -> Self {
        (self ^ sign >> 15) - (sign >> 15)
    }

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

    #[inline]
    #[target_feature(enable = "dotprod")]
    pub fn add_dot(self, a: Lanes<u8, 16, S>, b: Lanes<i8, 16, S>) -> Self {
        debug_assert!(b.simd_ge(0).all());
        let sums = vdotq_u32(self.0.cast().into(), a.0.into(), b.0.cast().into());
        Self::new(u32x4::from(sums).cast())
    }
}

impl<const S: bool> Lanes<u32, 4, S> {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn sums_of_4_abs_diffs(a: Lanes<u8, 16, S>, b: Lanes<u8, 16, S>) -> Self {
        Self::new(vpaddlq_u16(vpaddlq_u8(a.abs_diff(b).0.into())))
    }
}

impl<const S: bool> Lanes<u64, 2, S> {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn sums_of_8(bytes: Lanes<u8, 16, S>) -> Self {
        Self::new(vpaddlq_u32(vpaddlq_u16(vpaddlq_u8(bytes.0.into()))))
    }

    #[inline]
    #[target_feature(enable = "aes")]
    pub fn carryless_mul_lower(self, other: Self) -> Self {
        Self::new(vreinterpretq_u64_p128(vmull_p64(self[0], other[0])))
    }

    #[inline]
    #[target_feature(enable = "aes")]
    pub fn carryless_mul_upper(self, other: Self) -> Self {
        let [a, b] = [self, other].map(|it| vreinterpretq_p64_u64(it.0.into()));
        Self::new(vreinterpretq_u64_p128(vmull_high_p64(a, b)))
    }
}

impl<const N: usize, const S: bool> Lanes<f64, N, S> {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn min(self, other: Self) -> Self {
        const { assert!(N.is_multiple_of(2)) };
        let (mut lanes, others) = (self.to_array(), other.to_array());
        for (a, &b) in lanes.as_chunks_mut().0.iter_mut().zip(others.as_chunks().0) {
            *a = to_array(vminnmq_f64(from_array(*a).into(), from_array(b).into()).into());
        }
        Self::from_array(lanes)
    }
}

impl<const S: bool> Lanes<f64, 4, S> {
    #[inline(always)]
    pub fn to_i32(self) -> Lanes<i32, 4, S> {
        Lanes::new(self.0.cast::<i64>().cast())
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
