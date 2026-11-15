use crate::Int;
use crate::native::COMPRESS_4;
pub(crate) use crate::native::{load_shared, store_shared};
pub use crate::portable::prefix_xor;
pub(crate) use crate::portable::{load_shared_masked, store_shared_masked};
use core::arch::aarch64::*;
use core::simd::{ToBytes, prelude::*};

#[cfg(target_endian = "big")]
compile_error!("these ops assume little-endian lanes");

#[derive(Clone, Copy)]
pub struct Neon;

crate::isa::vector_types!(Neon, 16);

/// `addp`
#[inline(always)]
fn pairwise_add(a: u8x16, b: u8x16) -> u8x16 {
    let (even, odd) = a.deinterleave(b);
    even + odd
}

impl crate::Isa for Neon {
    const HAS_INTERLEAVED_MEMORY: bool = true;

    /// `shrn` leaves 4 bits per byte.
    #[inline(always)]
    fn movemask<T: Int<N>, const N: usize>(mask: Mask<T, N>) -> (u64, usize) {
        if size_of::<[T; N]>() != 16 {
            return (mask.to_bitmask(), 1);
        }
        let nibbles = (u16x8::from_ne_bytes(mask.to_vector().first_bytes()) >> 4).cast::<u8>();
        (u64::from_ne_bytes(nibbles.to_array()), 4 * size_of::<T>())
    }

    #[inline(always)]
    fn any<T: Int<N>, const N: usize>(mask: Mask<T, N>) -> bool {
        mask.0.any()
    }

    #[inline(always)]
    fn bitmask_of_four<const N: usize>(masks: [Mask<u8, N>; 4]) -> u64
    where
        u8: Int<N>,
    {
        let own_bit = u64x2::splat(0x8040_2010_0804_0201).to_ne_bytes();
        let [a, b, c, d] = masks.map(|mask| mask.to_vector().first_bytes::<16>() & own_bit);
        let sums = pairwise_add(pairwise_add(a, b), pairwise_add(c, d));
        u64x2::from_ne_bytes(pairwise_add(sums, sums))[0]
    }

    #[inline(always)]
    fn saturating_cast_u8<const N: usize>(v: Vector<i32, N>) -> Vector<u8, N> {
        let words = v.0.simd_max(Simd::splat(0)).simd_min(Simd::splat(0xFFFF));
        Vector::new(words.cast::<u16>().simd_min(Simd::splat(0xFF)).cast())
    }
}

impl U8 {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn lookup(self, indices: Self) -> Self {
        Self::new(vqtbl1q_u8(self.0.into(), indices.0.into()))
    }

    #[inline]
    #[target_feature(enable = "neon")]
    pub fn saturating_narrow(first: I16, second: I16) -> Self {
        Self::new(vqmovun_high_s16(
            vqmovun_s16(first.0.into()),
            second.0.into(),
        ))
    }
}

impl I16 {
    #[inline(always)]
    pub fn saturating_pairwise_dot(a: U8, b: I8) -> Self {
        let (a, b) = (a.bitcast::<U16>(), b.bitcast::<I16>());
        let even = (a & 0xFF).bitcast::<I16>() * (b << 8 >> 8);
        let odd = (a >> 8).bitcast::<I16>() * (b >> 8);
        Self::new(even.0.saturating_add(odd.0))
    }
}

impl I32 {
    #[inline(always)]
    pub fn pairwise_dot(a: I16, b: I16) -> Self {
        let products = a.0.cast::<i32>() * b.0.cast();
        let (even, odd) = products
            .extract::<0, 4>()
            .deinterleave(products.extract::<4, 4>());
        Self::new(even + odd)
    }
}

impl U32 {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn compress(self, bits: u64) -> Self {
        let indices = U8::from_array(COMPRESS_4[bits as usize & 15]);
        self.bitcast::<U8>().lookup(indices).bitcast()
    }
}

impl U64 {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn sums_of_8(bytes: U8) -> Self {
        Self::new(vpaddlq_u32(vpaddlq_u16(vpaddlq_u8(bytes.0.into()))))
    }
}

impl F32 {
    #[inline(always)]
    pub fn to_i32(self) -> I32 {
        I32::new(self.0.cast())
    }

    #[inline]
    #[target_feature(enable = "neon")]
    pub fn mul_add(self, a: Self, b: Self) -> Self {
        Self::new(vfmaq_f32(b.0.into(), self.0.into(), a.0.into()))
    }
}
