use crate::lanes::{ArrayOf, Lane, Width};
use bun_simd_macros::ops;
use core::arch::x86_64::*;

#[inline(always)]
fn load16<T: Lane>(lanes: &ArrayOf<T, 16>) -> __m128i {
    <T as Width<16>>::to_bytes(lanes).into()
}

#[ops(sse4)]
fn first16(bytes: &[u8]) -> __m128i {
    match bytes.first_chunk() {
        Some(whole) => load16::<u8>(whole),
        None => load16::<u64>(&crate::registers::short(bytes)),
    }
}

#[ops(avx2)]
fn first32(bytes: &[u8]) -> __m256i {
    match bytes.split_first_chunk() {
        Some((low, high)) => _mm256_set_m128i(first16(high), load16::<u8>(low)),
        None => _mm256_zextsi128_si256(first16(bytes)),
    }
}

/// Ops whose intrinsics differ in nothing but the width in their names.
macro_rules! any_width {
    ($target:ident, $bits:tt) => {
        #[ops($target, $bits)]
        impl<T: Lane> Vec<T> {
            pub fn interleave(self, other: Self) -> (Self, Self) {
                let (a, b) = (self.raw(), other.raw());
                let (low, high) = match T::BITS {
                    8 => (_mm_unpacklo_epi8(a, b), _mm_unpackhi_epi8(a, b)),
                    16 => (_mm_unpacklo_epi16(a, b), _mm_unpackhi_epi16(a, b)),
                    32 => (_mm_unpacklo_epi32(a, b), _mm_unpackhi_epi32(a, b)),
                    _ => (_mm_unpacklo_epi64(a, b), _mm_unpackhi_epi64(a, b)),
                };
                let (low, high) = blocks_in_turns(low, high);
                (Self::new(low), Self::new(high))
            }
        }

        #[ops($target, $bits)]
        impl U8 {
            pub fn mul_add_pairs(self, other: I8) -> I16 {
                Vec::new(_mm_maddubs_epi16(self.raw(), other.raw()))
            }
            pub fn sums_of_8(self) -> U64 {
                Vec::new(_mm_sad_epu8(self.raw(), _mm_setzero_si128()))
            }
            pub fn lookup(self, indices: Self) -> Self {
                Self::new(_mm_shuffle_epi8(self.raw(), indices.raw()))
            }
        }

        #[ops($target, $bits)]
        impl F32 {
            pub fn to_i32(self) -> I32 {
                Vec::new(_mm_cvttps_epi32(self.0.into()))
            }
            pub fn clamp(self, low: f32, high: f32) -> Self {
                let above = _mm_max_ps(self.0.into(), _mm_set1_ps(low));
                Self(_mm_min_ps(above, _mm_set1_ps(high)).into())
            }
        }

        #[ops($target, $bits)]
        impl I32 {
            pub fn clamped_to_bytes(self) -> [u8; BYTES / 4] {
                Simd::<i32, { BYTES / 4 }>::from_ne_bytes(self.max(0).min(255).0)
                    .cast::<u8>()
                    .to_array()
            }
        }

        #[ops($target, $bits)]
        impl I16 {
            pub fn demote(self, other: Self) -> U8 {
                Vec::new(even_halves_first(_mm_packus_epi16(self.raw(), other.raw())))
            }
            pub fn mul_add_pairs(self, other: Self) -> I32 {
                Vec::new(_mm_madd_epi16(self.raw(), other.raw()))
            }
        }
    };
}

macro_rules! movemask {
    ($target:ident, $bits:tt) => {
        #[ops($target, $bits)]
        impl U8 {
            pub fn in_range(self, first: u8, last: u8) -> M8 {
                self.add(0x80u8.wrapping_sub(first))
                    .cast::<i8>()
                    .lt((last - first).wrapping_add(0x81) as i8)
                    .cast()
            }
        }

        #[ops($target, $bits)]
        impl U16 {
            pub fn in_range(self, first: u16, last: u16) -> Mask<u16> {
                self.add(0x8000u16.wrapping_sub(first))
                    .cast::<i16>()
                    .lt((last - first).wrapping_add(0x8001) as i16)
                    .cast()
            }
        }

        #[ops($target, $bits)]
        impl<T: Lane> Mask<T> {
            fn per_byte(self) -> u32 {
                _mm_movemask_epi8(self.0.into()) as u32
            }
            pub fn any(self) -> bool {
                self.per_byte() != 0
            }
            pub fn all(self) -> bool {
                self.per_byte() == u32::MAX >> (32 - BYTES)
            }
            pub fn first_true(self) -> Option<usize> {
                let bits = self.per_byte();
                (bits != 0).then(|| bits.trailing_zeros() as usize / size_of::<T>())
            }
            pub fn last_true(self) -> Option<usize> {
                let bits = self.per_byte();
                (bits != 0).then(|| (31 - bits.leading_zeros() as usize) / size_of::<T>())
            }
            pub fn select(self, yes: impl Operand<T>, no: impl Operand<T>) -> Vec<T> {
                Vec::new(_mm_blendv_epi8(
                    Vec::of(no).raw(),
                    Vec::of(yes).raw(),
                    self.0.into(),
                ))
            }
        }

        #[ops($target, $bits)]
        impl M8 {
            pub fn bits(self) -> u64 {
                self.per_byte().into()
            }
        }
    };
}

macro_rules! xmm {
    ($module:ident, $target:ident, $load_shared:ident, $store_shared:ident) => {
        pub use super::$module as x128;
        use super::*;
        every_target!($target, 16, true, portable);
        store_first_in_pieces!($target);
        interleave_in_registers!($target);
        bits_of_each_mask!($target);
        registers!($target, __m128i, $load_shared, $store_shared);
        any_width!($target, 128);
        masks_in_vectors!($target);
        movemask!($target, 128);

        #[ops($target)]
        pub fn prefix_xor(bits: u64) -> u64 {
            crate::registers::prefix_xor(bits)
        }

        #[ops($target)]
        impl F32 {
            pub fn mul_add(self, by: Self, plus: Self) -> Self {
                self.mul(by).add(plus)
            }
        }

        #[ops($target)]
        fn blocks_in_turns(low: __m128i, high: __m128i) -> (__m128i, __m128i) {
            (low, high)
        }

        #[ops($target)]
        fn even_halves_first(v: __m128i) -> __m128i {
            v
        }

        #[ops($target)]
        impl<T: Lane> Vec<T> {
            fn repeat_8s(ends: [u64; 2]) -> Self {
                U64::load(&ends).cast()
            }
            fn repeat_16s<U: Unit<Lane = T>>(_: &ChunkOf<U, 16>, _: &ChunkOf<U, 16>) -> Self {
                unreachable!()
            }
        }

        #[ops($target)]
        impl U8 {
            pub fn load_first(bytes: &[u8]) -> Self {
                Self::new(first16(bytes))
            }
        }

        #[ops($target)]
        impl U32 {
            pub fn compress(self, bits: u64) -> Self {
                self.cast::<u8>()
                    .lookup(U8::load(&crate::registers::COMPRESS_4[bits as usize & 15]))
                    .cast()
            }
            pub fn slide_up(self, lanes: usize) -> Self {
                self.cast::<u8>()
                    .lookup(U8::iota().sub(4 * lanes as u8))
                    .cast()
            }
        }
    };
}

pub mod sse4 {
    xmm!(sse4, sse4, load16, store16);
}

/// For the targets above: the encodings of SSE are slow next to those of AVX.
pub mod avx2_128 {
    xmm!(avx2_128, avx2, load16_vex, store16_vex);
}

pub mod avx2 {
    pub use super::avx2_128 as x128;
    use super::*;
    every_target!(avx2, 32, true, portable32);
    store_first_in_pieces!(avx2);
    interleave_in_registers!(avx2);
    bits_of_each_mask!(avx2);
    registers!(avx2, __m256i, load32, store32);
    any_width!(avx2, 256);
    masks_in_vectors!(avx2);
    movemask!(avx2, 256);

    static COMPRESS_8: [i64; 256] = {
        let mut table = [0; 256];
        let mut bits = 0;
        while bits < 256 {
            let (mut from, mut to) = (0, 0);
            while from < 8 {
                if bits >> from & 1 != 0 {
                    table[bits] |= from << (8 * to);
                    to += 1;
                }
                from += 1;
            }
            bits += 1;
        }
        table
    };

    #[ops(avx2)]
    pub fn prefix_xor(bits: u64) -> u64 {
        _mm_cvtsi128_si64(_mm_clmulepi64_si128::<0>(
            _mm_cvtsi64_si128(bits as i64),
            _mm_set1_epi8(-1),
        )) as u64
    }

    #[ops(avx2)]
    impl F32 {
        pub fn mul_add(self, by: Self, plus: Self) -> Self {
            Self(_mm256_fmadd_ps(self.0.into(), by.0.into(), plus.0.into()).into())
        }
    }

    #[ops(avx2)]
    fn blocks_in_turns(low: __m256i, high: __m256i) -> (__m256i, __m256i) {
        (
            _mm256_permute2x128_si256::<0x20>(low, high),
            _mm256_permute2x128_si256::<0x31>(low, high),
        )
    }

    #[ops(avx2)]
    fn even_halves_first(v: __m256i) -> __m256i {
        _mm256_permute4x64_epi64::<0xD8>(v)
    }

    #[ops(avx2)]
    impl<T: Lane> Vec<T> {
        fn repeat_8s(ends: [u64; 2]) -> Self {
            Self::new(_mm256_broadcastsi128_si256(load16::<u64>(&ends)))
        }
        fn repeat_16s<U: Unit<Lane = T>>(first: &ChunkOf<U, 16>, last: &ChunkOf<U, 16>) -> Self {
            // Not `vinserti128` from memory, for which QEMU 7.2 to 10.0.3 reads 32 bytes.
            let (first, last) = (x128::Vec::load(first), x128::Vec::load(last));
            Self::new(_mm256_xor_si256(
                _mm256_broadcastsi128_si256(last.raw()),
                _mm256_zextsi128_si256((first ^ last).raw()),
            ))
        }
    }

    #[ops(avx2)]
    impl U8 {
        pub fn load_first(bytes: &[u8]) -> Self {
            match bytes.first_chunk() {
                Some(whole) => Self::load(whole),
                None => Self::new(first32(bytes)),
            }
        }
    }

    #[ops(avx2)]
    impl U32 {
        pub fn compress(self, bits: u64) -> Self {
            let from = _mm256_cvtepu8_epi32(_mm_cvtsi64_si128(COMPRESS_8[bits as usize & 255]));
            Self::new(_mm256_permutevar8x32_epi32(self.raw(), from))
        }
        pub fn slide_up(self, lanes: usize) -> Self {
            let from = I32::iota().sub(lanes as i32);
            from.lt(0)
                .select(
                    0,
                    I32::new(_mm256_permutevar8x32_epi32(self.raw(), from.raw())),
                )
                .cast()
        }
    }
}

macro_rules! avx512 {
    ($target:ident) => {
        use super::*;
        pub use super::{avx2::prefix_xor, avx2_128 as x128};
        use crate::lanes::is_slow_with_mask;
        every_target!($target, 64, true, portable64);
        interleave_in_registers!($target);
        bits_of_each_mask!($target);
        registers!($target, __m512i, load64, store64);
        any_width!($target, 512);

        #[derive(Clone, Copy)]
        #[repr(transparent)]
        pub struct Mask<T>(u64, PhantomData<T>);

        #[derive(Clone, Copy)]
        pub struct Short<T> {
            /// The text, and then zeros.
            pub lanes: Vec<T>,
            len: usize,
        }

        impl<T: Lane> Mask<T> {
            #[inline(always)]
            const fn new(bits: u64) -> Self {
                Self(bits, PhantomData)
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
                Self::new(self.0 ^ Self::ALL)
            }
        }

        #[ops($target)]
        impl<T: Lane> Short<T> {
            pub fn load<U: Unit<Lane = T>>(text: &[U]) -> Option<Self> {
                if text.is_empty() {
                    return None;
                }
                let lanes = match U::either(text) {
                    Ok(lanes) => T::load_fitting(lanes),
                    Err(bytes) if is_slow_with_mask(bytes) => {
                        let mut lanes = [0; BYTES];
                        lanes
                            .iter_mut()
                            .zip(bytes)
                            .for_each(|(to, from)| *to = from.get());
                        lanes.into()
                    }
                    Err(bytes) => bun_simd_trusted::shared::load_fitting(bytes),
                };
                Some(Self {
                    lanes: Vec::new(lanes),
                    len: text.len(),
                })
            }
            pub fn first(self, mask: Mask<T>) -> Option<usize> {
                let lane = mask.0.trailing_zeros() as usize;
                (lane < self.len).then_some(lane)
            }
            pub fn last(self, mask: Mask<T>) -> Option<usize> {
                let above = _bzhi_u64(mask.0, self.len as u32).leading_zeros() as usize;
                let lane = 63usize.wrapping_sub(above);
                (lane < self.len).then_some(lane)
            }
            pub fn store(lanes: Vec<T>, to: &mut [T]) {
                T::store_fitting(lanes.0, to)
            }
        }

        #[ops($target)]
        impl Short<u8> {
            pub fn store_shared(lanes: U8, to: &[AtomicU8]) {
                if is_slow_with_mask(to) {
                    let pairs = to.iter().zip(lanes.lanes());
                    return pairs.for_each(|(to, lane)| to.store(lane, Relaxed));
                }
                bun_simd_trusted::shared::store_fitting(lanes.0, to)
            }
            pub fn bits(self, mask: M8) -> u64 {
                _bzhi_u64(mask.0, self.len as u32)
            }
        }

        #[ops($target)]
        impl F32 {
            pub fn mul_add(self, by: Self, plus: Self) -> Self {
                Self(_mm512_fmadd_ps(self.0.into(), by.0.into(), plus.0.into()).into())
            }
        }

        #[ops($target)]
        fn blocks_in_turns(low: __m512i, high: __m512i) -> (__m512i, __m512i) {
            (
                _mm512_permutex2var_epi64(low, _mm512_setr_epi64(0, 1, 8, 9, 2, 3, 10, 11), high),
                _mm512_permutex2var_epi64(low, _mm512_setr_epi64(4, 5, 12, 13, 6, 7, 14, 15), high),
            )
        }

        #[ops($target)]
        fn even_halves_first(v: __m512i) -> __m512i {
            _mm512_permutexvar_epi64(_mm512_setr_epi64(0, 2, 4, 6, 1, 3, 5, 7), v)
        }

        #[ops($target)]
        impl<T: Lane> Vec<T> {
            pub fn eq(self, other: impl Operand<T>) -> Mask<T> {
                Mask::new(T::eq_bits(self.0, Self::of(other).0))
            }
            pub fn gt(self, other: impl Operand<T>) -> Mask<T> {
                Mask::new(T::gt_bits(self.0, Self::of(other).0))
            }
        }

        #[ops($target)]
        impl<T: Lane> Mask<T> {
            const ALL: u64 = u64::MAX >> (64 - Vec::<T>::LANES);

            pub fn cast<U: Lane>(self) -> Mask<U> {
                const { assert!(T::BITS == U::BITS) };
                Mask::new(self.0)
            }
            pub fn any(self) -> bool {
                self.0 != 0
            }
            pub fn all(self) -> bool {
                self.0 == Self::ALL
            }
            pub fn first_true(self) -> Option<usize> {
                (self.0 != 0).then(|| self.0.trailing_zeros() as usize)
            }
            pub fn last_true(self) -> Option<usize> {
                (self.0 != 0).then(|| 63 - self.0.leading_zeros() as usize)
            }
            pub fn select(self, yes: impl Operand<T>, no: impl Operand<T>) -> Vec<T> {
                Vec::new(T::select_bits(self.0, Vec::of(yes).0, Vec::of(no).0))
            }
            pub fn to_vec(self) -> Vec<T> {
                self.select(T::from_bits(u64::MAX), T::from_bits(0))
            }
        }

        #[ops($target)]
        impl M8 {
            pub fn bits(self) -> u64 {
                self.0
            }
        }

        #[ops($target)]
        impl U8 {
            pub fn in_range(self, first: u8, last: u8) -> M8 {
                self.sub(first).lt(last - first + 1)
            }
            pub fn load_first(bytes: &[u8]) -> Self {
                Self::new(u8::load_fitting(bytes))
            }
            pub fn store_first(self, to: &mut [u8]) {
                u8::store_fitting(self.0, to)
            }
        }

        #[ops($target)]
        impl U16 {
            pub fn in_range(self, first: u16, last: u16) -> Mask<u16> {
                self.sub(first).lt(last - first + 1)
            }
        }

        #[ops($target)]
        impl U32 {
            pub fn compress(self, bits: u64) -> Self {
                // On Zen 4 and 5, the form that fills with zeros waits for its destination.
                Self::new(_mm512_mask_compress_epi32(
                    self.raw(),
                    bits as u16,
                    self.raw(),
                ))
            }
            pub fn slide_up(self, lanes: usize) -> Self {
                Self::new(_mm512_maskz_permutexvar_epi32(
                    u16::MAX << lanes,
                    Self::iota().sub(lanes as u32).raw(),
                    self.raw(),
                ))
            }
        }
    };
}

pub mod avx512_skx {
    avx512!(avx512_skx);
}

pub mod avx512_icl {
    avx512!(avx512_icl);
}
