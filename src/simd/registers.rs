//! What the targets with registers have in common.

/// What reads the same for all targets with registers. `$Raw` is what their intrinsics take.
macro_rules! registers {
    ($target:ident, $Raw:ty, $load_shared:ident, $store_shared:ident) => {
        use crate::lanes::{Bytes, Width};
        use crate::registers::Shuffle;
        use core::marker::PhantomData;
        use core::simd::{Simd, Swizzle, ToBytes, num::*};

        #[derive(Clone, Copy)]
        #[repr(transparent)]
        pub struct Vec<T>(Bytes<BYTES>, PhantomData<T>);

        #[derive(Clone, Copy)]
        #[repr(transparent)]
        pub struct F32(Simd<f32, { BYTES / 4 }>);

        // Without features, as the methods of traits have to be.
        impl<T: Lane> Vec<T> {
            #[inline(always)]
            fn new(raw: impl Into<Bytes<BYTES>>) -> Self {
                Self(raw.into(), PhantomData)
            }
            #[inline(always)]
            pub(crate) fn raw(self) -> $Raw {
                self.0.into()
            }
            #[inline(always)]
            fn filled(lane: T) -> Self {
                Self::new(<T as Width<BYTES>>::splat(lane))
            }
            #[inline(always)]
            fn and(self, other: impl Operand<T>) -> Self {
                Self::new(self.0 & Self::of(other).0)
            }
            #[inline(always)]
            fn or(self, other: impl Operand<T>) -> Self {
                Self::new(self.0 | Self::of(other).0)
            }
            #[inline(always)]
            fn xor(self, other: impl Operand<T>) -> Self {
                Self::new(self.0 ^ Self::of(other).0)
            }
            #[inline(always)]
            fn add(self, other: impl Operand<T>) -> Self {
                Self::new(T::sum(self.0, Self::of(other).0))
            }
            #[inline(always)]
            fn sub(self, other: impl Operand<T>) -> Self {
                Self::new(T::difference(self.0, Self::of(other).0))
            }
            #[inline(always)]
            fn shl(self, bits: u32) -> Self {
                Self::new(T::shifted_left(
                    self.0,
                    Self::filled(T::from_bits(bits.into())).0,
                ))
            }
            #[inline(always)]
            fn shr(self, bits: u32) -> Self {
                Self::new(T::shifted_right(
                    self.0,
                    Self::filled(T::from_bits(bits.into())).0,
                ))
            }
        }

        impl U16 {
            #[inline(always)]
            fn mul(self, other: Self) -> Self {
                Self::new(u16::product(self.0, other.0))
            }
        }

        impl F32 {
            #[inline(always)]
            fn add(self, other: Self) -> Self {
                Self(self.0 + other.0)
            }
            #[inline(always)]
            fn sub(self, other: Self) -> Self {
                Self(self.0 - other.0)
            }
            #[inline(always)]
            fn mul(self, other: Self) -> Self {
                Self(self.0 * other.0)
            }
        }

        #[ops($target)]
        impl<T: Lane> Vec<T> {
            fn load_nth<S: Source<BYTES, T>, const K: usize, const I: usize>(
                from: &[S; K],
            ) -> Self {
                Self::new(match S::either(from) {
                    Ok(lanes) => <T as Width<BYTES>>::to_bytes(&lanes[I]),
                    Err(bytes) => bun_simd_trusted::shared::$load_shared::<K, I>(bytes),
                })
            }
            pub fn lanes(self) -> Lanes<T> {
                T::from_bytes(self.0)
            }
            pub fn zero() -> Self {
                Self::new(Bytes::splat(0))
            }
            pub fn splat(lane: T) -> Self {
                Self::filled(lane)
            }
            pub fn cast<U: Lane>(self) -> Vec<U> {
                Vec::new(self.0)
            }
            pub fn min(self, other: impl Operand<T>) -> Self {
                Self::new(T::smaller(self.0, Self::of(other).0))
            }
            pub fn max(self, other: impl Operand<T>) -> Self {
                Self::new(T::larger(self.0, Self::of(other).0))
            }
            pub fn saturating_add(self, other: impl Operand<T>) -> Self {
                Self::new(T::saturated_sum(self.0, Self::of(other).0))
            }
            pub fn saturating_sub(self, other: impl Operand<T>) -> Self {
                Self::new(T::saturated_difference(self.0, Self::of(other).0))
            }
        }

        #[ops($target)]
        impl U8 {
            fn store_nth<const K: usize, const I: usize>(self, to: &[[AtomicU8; BYTES]; K]) {
                bun_simd_trusted::shared::$store_shared::<K, I>(self.0, to)
            }
            pub fn table(bytes: &[u8; 16]) -> Self {
                Self::new(Shuffle::<0, 15>::swizzle(Simd::from_array(*bytes)))
            }
            pub fn abs_diff(self, other: Self) -> Self {
                Self::new(self.0.abs_diff(other.0))
            }
            pub fn average_round(self, other: Self) -> Self {
                Self::new(
                    ((self.0.cast::<u16>() + other.0.cast() + Simd::splat(1)) >> 1).cast::<u8>(),
                )
            }
            pub fn widening_mul(self, other: Self) -> (U16, U16) {
                let all = self.0.cast::<u16>() * other.0.cast();
                (
                    Vec::new(all.extract::<0, { BYTES / 2 }>().to_ne_bytes()),
                    Vec::new(all.extract::<{ BYTES / 2 }, { BYTES / 2 }>().to_ne_bytes()),
                )
            }
            pub fn widen_lower(self) -> U16 {
                Vec::new(
                    self.0
                        .extract::<0, { BYTES / 2 }>()
                        .cast::<u16>()
                        .to_ne_bytes(),
                )
            }
            pub fn deinterleave(self, other: Self) -> (Self, Self) {
                let (even, odd) = self.0.deinterleave(other.0);
                (Self::new(even), Self::new(odd))
            }
        }

        #[ops($target)]
        impl U16 {
            pub fn truncate(self, other: Self) -> U8 {
                Vec::new(self.0.deinterleave(other.0).0)
            }
        }

        #[ops($target)]
        impl U32 {
            pub fn from_first(lane: u32) -> Self {
                let mut lanes = Simd::<u32, { BYTES / 4 }>::splat(0);
                lanes[0] = lane;
                Self::new(lanes.to_ne_bytes())
            }
        }

        #[ops($target)]
        impl I32 {
            pub fn load_bytes(bytes: &[u8; BYTES / 4]) -> Self {
                Self::new(Simd::from_array(*bytes).cast::<i32>().to_ne_bytes())
            }
        }

        #[ops($target)]
        impl U64 {
            pub fn mul_low32(self, other: Self) -> Self {
                let low = |v: Self| {
                    Simd::<u64, { BYTES / 8 }>::from_ne_bytes(v.0)
                        .cast::<u32>()
                        .cast::<u64>()
                };
                Self::new((low(self) * low(other)).to_ne_bytes())
            }
            pub fn swap_pairs(self) -> Self {
                let lanes = Simd::<u64, { BYTES / 8 }>::from_ne_bytes(self.0);
                Self::new(<Shuffle<1, 63> as Swizzle<{ BYTES / 8 }>>::swizzle(lanes).to_ne_bytes())
            }
        }

        #[ops($target)]
        impl F32 {
            pub fn splat(lane: f32) -> Self {
                Self(Simd::splat(lane))
            }
            pub fn from_i32(v: I32) -> Self {
                Self(Simd::<i32, { BYTES / 4 }>::from_ne_bytes(v.0).cast())
            }
        }
    };
}

/// A mask is a vector, with all bits of a lane set or none.
macro_rules! masks_in_vectors {
    ($target:ident) => {
        #[derive(Clone, Copy)]
        #[repr(transparent)]
        pub struct Mask<T>(Bytes<BYTES>, PhantomData<T>);

        impl<T: Lane> Mask<T> {
            #[inline(always)]
            fn new(raw: Bytes<BYTES>) -> Self {
                Self(raw, PhantomData)
            }
            #[inline(always)]
            fn and(self, other: Self) -> Self {
                Self::new(self.0 & other.0)
            }
            #[inline(always)]
            fn or(self, other: Self) -> Self {
                Self::new(self.0 | other.0)
            }
            #[inline(always)]
            fn xor(self, other: Self) -> Self {
                Self::new(self.0 ^ other.0)
            }
            #[inline(always)]
            fn not(self) -> Self {
                Self::new(!self.0)
            }
        }

        #[ops($target)]
        impl<T: Lane> Vec<T> {
            pub fn eq(self, other: impl Operand<T>) -> Mask<T> {
                Mask::new(T::equal(self.0, Self::of(other).0))
            }
            pub fn gt(self, other: impl Operand<T>) -> Mask<T> {
                Mask::new(T::greater(self.0, Self::of(other).0))
            }
        }

        #[ops($target)]
        impl<T: Lane> Mask<T> {
            pub fn cast<U: Lane>(self) -> Mask<U> {
                const { assert!(T::BITS == U::BITS) };
                Mask::new(self.0)
            }
            pub fn to_vec(self) -> Vec<T> {
                Vec::new(self.0)
            }
        }
    };
}

/// Lane `i` is from `(i ^ XOR) & AND`.
pub(crate) struct Shuffle<const XOR: usize, const AND: usize>;
impl<const XOR: usize, const AND: usize, const N: usize> core::simd::Swizzle<N>
    for Shuffle<XOR, AND>
{
    const INDEX: [usize; N] = {
        let (mut from, mut i) = ([0; N], 0);
        while i < N {
            from[i] = (i ^ XOR) & AND;
            i += 1;
        }
        from
    };
}

/// Fewer than 16 bytes, then zeros: loads that overlap, put together in registers.
#[inline(always)]
pub(crate) fn short(bytes: &[u8]) -> [u64; 2] {
    let len = bytes.len() as u32;
    if let (Some(&a), Some(&b)) = (bytes.first_chunk(), bytes.last_chunk()) {
        [
            u64::from_le_bytes(a),
            u64::from_le_bytes(b) >> (8 * (15 - len)) >> 8,
        ]
    } else if let (Some(&a), Some(&b)) = (bytes.first_chunk(), bytes.last_chunk()) {
        [
            u64::from(u32::from_le_bytes(a)) | u64::from(u32::from_le_bytes(b)) << (8 * (len - 4)),
            0,
        ]
    } else if let (Some(&a), Some(&b)) = (bytes.first_chunk(), bytes.last_chunk()) {
        [
            u64::from(u16::from_le_bytes(a)) | u64::from(u16::from_le_bytes(b)) << (8 * (len - 2)),
            0,
        ]
    } else {
        [bytes.first().map_or(0, |&b| b.into()), 0]
    }
}

/// For each 4 bits, the shuffle that brings the 32-bit lanes of the set ones to the front.
pub(crate) static COMPRESS_4: [[u8; 16]; 16] = {
    let mut table = [[0x80; 16]; 16];
    let mut bits = 0;
    while bits < 16 {
        let (mut from, mut to) = (0, 0);
        while from < 16 {
            if bits >> (from / 4) & 1 != 0 {
                table[bits][to] = from as u8;
                to += 1;
            }
            from += 1;
        }
        bits += 1;
    }
    table
};

#[inline(always)]
pub(crate) fn prefix_xor(mut bits: u64) -> u64 {
    for shift in [1, 2, 4, 8, 16, 32] {
        bits ^= bits << shift;
    }
    bits
}
