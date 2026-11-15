pub use crate::neon as x128;
use core::arch::aarch64::*;

#[cfg(target_endian = "big")]
compile_error!("these ops take the low byte of a lane to come first");

every_target!(neon, 16, false, portable);
registers!(neon, uint8x16_t, load16, store16);
masks_in_vectors!(neon);
store_first_in_pieces!(neon);

/// LLVM makes `ld4`, `st2` and `st4` of a wide load or store next to a shuffle.
mod wide {
    use super::*;
    use core::simd::u8x16;

    /// Lane `i` is from `i / K + i % K * 16`, or the other way round.
    struct Wide<const K: usize, const FIRST: usize, const GATHER: bool>;
    impl<const K: usize, const FIRST: usize, const GATHER: bool, const N: usize> Swizzle<N>
        for Wide<K, FIRST, GATHER>
    {
        const INDEX: [usize; N] = {
            let (mut from, mut i) = ([0; N], 0);
            while i < N {
                from[i] = if GATHER {
                    FIRST + i * K
                } else {
                    i / K + i % K * 16
                };
                i += 1;
            }
            from
        };
    }

    #[ops(neon)]
    impl U8 {
        pub fn store_interleaved(self, other: Self, to: &mut [[u8; 2]; 16]) {
            let both: Simd<u8, 32> = Wide::<2, 0, false>::concat_swizzle(self.0, other.0);
            both.copy_to_slice(to.as_flattened_mut());
        }
        pub fn load_interleaved4(from: &[[u8; 4]; 16]) -> [Self; 4] {
            let all = Simd::<u8, 64>::from_slice(from.as_flattened());
            let new = |v: u8x16| Self::new(v);
            [
                new(Wide::<4, 0, true>::swizzle(all)),
                new(Wide::<4, 1, true>::swizzle(all)),
                new(Wide::<4, 2, true>::swizzle(all)),
                new(Wide::<4, 3, true>::swizzle(all)),
            ]
        }
        pub fn store_interleaved4([a, b, c, d]: [Self; 4], to: &mut [[u8; 4]; 16]) {
            let concat =
                |a: Self, b: Self| -> Simd<u8, 32> { Wide::<1, 0, true>::concat_swizzle(a.0, b.0) };
            let all: Simd<u8, 64> = Wide::<4, 0, false>::concat_swizzle(concat(a, b), concat(c, d));
            all.copy_to_slice(to.as_flattened_mut());
        }
    }
}

#[ops(neon)]
pub fn prefix_xor(bits: u64) -> u64 {
    crate::registers::prefix_xor(bits)
}

#[ops(neon)]
impl<T: Lane> Vec<T> {
    pub fn interleave(self, other: Self) -> (Self, Self) {
        (
            Self::new(T::first_in_turns(self.0, other.0)),
            Self::new(T::second_in_turns(self.0, other.0)),
        )
    }
}

#[ops(neon)]
impl<T: Lane> Mask<T> {
    /// 4 bits per byte.
    fn nibbles(self) -> u64 {
        vget_lane_u64::<0>(vreinterpret_u64_u8(vshrn_n_u16::<4>(vreinterpretq_u16_u8(
            self.0.into(),
        ))))
    }
    pub fn any(self) -> bool {
        // More cores have two pipelines for this than for shifts.
        vgetq_lane_u64::<0>(vreinterpretq_u64_u8(vpmaxq_u8(
            self.0.into(),
            self.0.into(),
        ))) != 0
    }
    pub fn all(self) -> bool {
        self.nibbles() == u64::MAX
    }
    pub fn first_true(self) -> Option<usize> {
        let nibbles = self.nibbles();
        (nibbles != 0).then(|| nibbles.trailing_zeros() as usize / (4 * size_of::<T>()))
    }
    pub fn last_true(self) -> Option<usize> {
        let nibbles = self.nibbles();
        (nibbles != 0).then(|| (63 - nibbles.leading_zeros() as usize) / (4 * size_of::<T>()))
    }
    pub fn select(self, yes: impl Operand<T>, no: impl Operand<T>) -> Vec<T> {
        Vec::new(T::select_bitwise(self.0, Vec::of(yes).0, Vec::of(no).0))
    }
}

#[ops(neon)]
pub fn bits_of<const K: usize>(block: &[u8; 64], tests: impl Fn(U8) -> [M8; K]) -> [u64; K] {
    let (chunks, mut bits) = (block.as_chunks().0, [0; K]);
    let [a, b, c, d] = four!(|i| tests(U8::load(&chunks[i])));
    for k in 0..K {
        bits[k] = M8::bits64([a[k], b[k], c[k], d[k]]);
    }
    bits
}

#[ops(neon)]
impl M8 {
    fn own_bit(self) -> uint8x16_t {
        vandq_u8(self.0.into(), U64::splat(0x8040_2010_0804_0201).raw())
    }
    pub fn bits(self) -> u64 {
        let v = self.own_bit();
        let v = vpaddq_u8(v, v);
        let v = vpaddq_u8(v, v);
        vgetq_lane_u16::<0>(vreinterpretq_u16_u8(vpaddq_u8(v, v))).into()
    }
    fn bits64([a, b, c, d]: [Self; 4]) -> u64 {
        let v = vpaddq_u8(
            vpaddq_u8(a.own_bit(), b.own_bit()),
            vpaddq_u8(c.own_bit(), d.own_bit()),
        );
        vgetq_lane_u64::<0>(vreinterpretq_u64_u8(vpaddq_u8(v, v)))
    }
}

#[ops(neon)]
impl<T: Lane> Vec<T> {
    fn repeat_8s(ends: [u64; 2]) -> Self {
        U64::load(&ends).cast()
    }
    fn repeat_16s<U: Unit<Lane = T>>(_: &ChunkOf<U, 16>, _: &ChunkOf<U, 16>) -> Self {
        unreachable!()
    }
}

#[ops(neon)]
impl F32 {
    pub fn to_i32(self) -> I32 {
        Vec::new(vreinterpretq_u8_s32(vcvtq_s32_f32(self.0.into())))
    }
    pub fn mul_add(self, by: Self, plus: Self) -> Self {
        Self(vfmaq_f32(plus.0.into(), self.0.into(), by.0.into()).into())
    }
    pub fn clamp(self, low: f32, high: f32) -> Self {
        Self(
            vminq_f32(
                vmaxq_f32(self.0.into(), vdupq_n_f32(low)),
                vdupq_n_f32(high),
            )
            .into(),
        )
    }
}

#[ops(neon)]
impl U8 {
    pub fn in_range(self, first: u8, last: u8) -> M8 {
        self.sub(first).lt(last - first + 1)
    }
    pub fn load_first(bytes: &[u8]) -> Self {
        match bytes.first_chunk() {
            Some(whole) => Self::load(whole),
            None => U64::load(&crate::registers::short(bytes)).cast(),
        }
    }
    pub fn mul_add_pairs(self, other: I8) -> I16 {
        let (a, b) = (
            vreinterpretq_s16_u8(self.raw()),
            vreinterpretq_s16_u8(other.raw()),
        );
        let even = vmulq_s16(
            vandq_s16(a, vdupq_n_s16(0xFF)),
            vshrq_n_s16::<8>(vshlq_n_s16::<8>(b)),
        );
        let odd = vmulq_s16(
            vreinterpretq_s16_u8(self.cast::<u16>().shr(8).raw()),
            vshrq_n_s16::<8>(b),
        );
        Vec::new(vreinterpretq_u8_s16(vqaddq_s16(even, odd)))
    }
    pub fn sums_of_8(self) -> U64 {
        Vec::new(vreinterpretq_u8_u64(vpaddlq_u32(vpaddlq_u16(vpaddlq_u8(
            self.raw(),
        )))))
    }
    pub fn lookup(self, indices: Self) -> Self {
        Self::new(vqtbl1q_u8(self.raw(), indices.raw()))
    }
}

#[ops(neon)]
impl U16 {
    pub fn in_range(self, first: u16, last: u16) -> Mask<u16> {
        self.sub(first).lt(last - first + 1)
    }
}

#[ops(neon)]
impl I16 {
    pub fn demote(self, other: Self) -> U8 {
        Vec::new(vqmovun_high_s16(
            vqmovun_s16(vreinterpretq_s16_u8(self.raw())),
            vreinterpretq_s16_u8(other.raw()),
        ))
    }
    pub fn mul_add_pairs(self, other: Self) -> I32 {
        let (a, b) = (
            vreinterpretq_s16_u8(self.raw()),
            vreinterpretq_s16_u8(other.raw()),
        );
        Vec::new(vreinterpretq_u8_s32(vpaddq_s32(
            vmull_s16(vget_low_s16(a), vget_low_s16(b)),
            vmull_high_s16(a, b),
        )))
    }
}

#[ops(neon)]
impl U32 {
    pub fn compress(self, bits: u64) -> Self {
        self.cast::<u8>()
            .lookup(U8::load(&crate::registers::COMPRESS_4[bits as usize & 15]))
            .cast()
    }
    pub fn slide_up(self, lanes: usize) -> Self {
        let zero = vdupq_n_u8(0);
        Self::new(match lanes {
            0 => self.raw(),
            1 => vextq_u8::<12>(zero, self.raw()),
            2 => vextq_u8::<8>(zero, self.raw()),
            _ => vextq_u8::<4>(zero, self.raw()),
        })
    }
}

#[ops(neon)]
impl I32 {
    pub fn clamped_to_bytes(self) -> [u8; 4] {
        let words = vqmovun_s32(vreinterpretq_s32_u8(self.raw()));
        vget_lane_u32::<0>(vreinterpret_u32_u8(vqmovn_u16(vcombine_u16(words, words))))
            .to_le_bytes()
    }
}
