//! Bits that change places with bytes or lanes.

use crate::{B8, B16, B32, B64, Isa, Scaled, Simd, Tag, Unsigned, Width};

macro_rules! makers { ($then:ident $target:ident $S:ty) => { crate::make::$then! { $target;
    /// The reverse of [`bit_planes`](crate::Simd::bit_planes): bit `k` of lane `i` is bit `i` of `planes[k]`. The bits from `K` on are zero.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from_bit_planes([0b0101, 0b0110]), [1, 2, 3, 0]);
    /// # } example()
    /// ```
    #[doc(alias("bitunshuffle", "p2s", "unslice"))]
    from_bit_planes[const K: usize](planes: [u64; K]) -> crate::Simd<T, W, $S> where [T: crate::Unsigned] = const crate::make::Fits::<K, T>::PLANES; |d| d.join_planes(planes);
} }; }
pub(crate) use makers;

impl<S: Isa, W: Width> Simd<u64, W, S> {
    /// Transposes each lane as a square of bits: bit `j` of byte `i` goes to bit `i` of byte `j`, where byte 0 is the lowest.
    /// It takes two instructions with GFNI, and 12 to 18 elsewhere.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u64x2::from([0xff, 0x0302]).transpose_bits(), [0x0101_0101_0101_0101, 0x0302]);
    /// # } example()
    /// ```
    #[doc(alias("transpose8x8", "bit_matrix", "vgbbd", "bitslice"))]
    #[op]
    pub fn transpose_bits(self) -> Self {
        return_if!(
            S::GFNI,
            self.like(0x8040_2010_0804_0201).bitcast::<u8>().galois_affine(self.swap_bytes()).bitcast()
        );
        let step = always!(|x: Self, lower: u64, by: u32| {
            choose! {
                crate::X86 || S::SCALAR => {
                    let differ = (x ^ x >> by) & lower;
                    x ^ differ ^ differ << by
                },
                // Or LLVM takes the selections apart.
                _ => x.like(lower).barrier().selects().bit_select(x >> by, x.like(lower << by).barrier().selects().bit_select(x << by, x).barrier()),
            }
        });
        step(step(step(self, 0x00aa_00aa_00aa_00aa, 7), 0x0000_cccc_0000_cccc, 14), 0x0000_0000_f0f0_f0f0, 28)
    }
}

/// In each byte, the bits of `x` that are not in `keep` change places with those of `y` that are.
#[op]
fn exchange<S: Isa, W: Width>(x: Simd<u8, W, S>, y: Simd<u8, W, S>, keep: u8, by: u32) -> [Simd<u8, W, S>; 2] {
    return_if!(S::ARM, [x.like(keep).bit_select(x, y << by), x.like(keep).bit_select(x >> by, y)]);
    let (x, y) = (x.bitcast::<u16>(), y.bitcast::<u16>());
    let differ = (x >> by ^ y) & (keep as u16 * 0x0101);
    [(x ^ differ << by).bitcast(), (y ^ differ).bitcast()]
}

#[op]
fn zip<U: Unsigned, S: Isa, W: Width>(x: Simd<u8, W, S>, y: Simd<u8, W, S>) -> [Simd<u8, W, S>; 2] {
    let [lower, upper] = x.bitcast::<U>().in_blocks().interleave(y.bitcast::<U>());
    [lower.bitcast(), upper.bitcast()]
}

const FOURS: [usize; 16] = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
const EVEN_ODD: [usize; 8] = [0, 2, 4, 6, 1, 3, 5, 7];
const ZIPPED: [usize; 8] = [0, 4, 1, 5, 2, 6, 3, 7];

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// Byte 0 of each 8, then byte 1 and so on. Without `vpermb`, wider lanes cross the blocks.
    #[op]
    fn bytes_by_place(self) -> Self {
        return_if!(S::AVX2 && !S::AVX512VBMI && W::BYTES >= 32 && (W::BYTES == 32 || S::REGISTER == 32), {
            let v = self.bitcast::<u32>().swizzle_groups(EVEN_ODD).barrier().bitcast::<u8>().swizzle_groups(FOURS);
            return_if!(W::BYTES == 32, v);
            let [a, b] = v.same::<u8, B64>().split();
            let [a, b] = zip::<u32, _, _>(a, b);
            let [a, b] = a.as_u128s().interleave(b);
            a.concat(b).same()
        });
        self.swizzle(
            #[inline(always)]
            |i| i % (W::BYTES / 8) * 8 + i / (W::BYTES / 8),
        )
    }
    /// The reverse, with the bytes of each 8 in reverse order if `flip` is 7.
    #[op]
    fn bytes_to_place(self, flip: usize) -> Self {
        return_if!(S::AVX2 && !S::AVX512VBMI && W::BYTES >= 32 && (W::BYTES == 32 || S::REGISTER == 32), {
            let v = choose! {
                W::BYTES == 32 => self,
                _ => {
                    let [a, b] = self.same::<u8, B64>().split();
                    let [a, b] = a.as_u128s().interleave(b);
                    let [a, b] = a.bitcast::<u32>().in_blocks().deinterleave(b.bitcast::<u32>());
                    a.concat(b).bitcast::<u8>().same()
                },
            };
            let v = v
                .swizzle(
                    #[inline(always)]
                    |i| i / 16 * 16 + FOURS[(i % 16) ^ flip & 3],
                )
                .barrier();
            v.bitcast::<u32>()
                .swizzle(
                    #[inline(always)]
                    |i| i / 8 * 8 + ZIPPED[(i % 8) ^ (flip >> 2)],
                )
                .bitcast()
        });
        return_if!(S::AVX512BW && !S::AVX512VBMI && W::BYTES == 64, {
            let v = self
                .swizzle(
                    #[inline(always)]
                    |i| i / 16 * 16 + (i ^ flip) % 2 * 8 + i / 2 % 8,
                )
                .barrier();
            v.bitcast::<u16>()
                .swizzle(
                    #[inline(always)]
                    |i| (i ^ flip >> 1) % 4 * 8 + i / 4,
                )
                .bitcast()
        });
        self.swizzle(
            #[inline(always)]
            |i| (i ^ flip) % 8 * (W::BYTES / 8) + i / 8,
        )
    }
    /// For 8 to 64 bytes.
    #[op]
    fn planes(self) -> Simd<u64, B64, S> {
        return_if!(S::ARM && W::BYTES >= 32, {
            // The place of a byte among four goes to the number of the register, and from there to the number of the bit.
            let [lower, upper] = self.resize::<B64>().split();
            let ([a, b], [c, d]) = (lower.split(), upper.split());
            let ([a, b], [c, d]) = (a.deinterleave(b), c.deinterleave(d));
            let ([a, c], [b, d]) = (a.deinterleave(c), b.deinterleave(d));
            let ([a, b], [c, d]) = (exchange(a, b, 0x55, 1), exchange(c, d, 0x55, 1));
            let ([a, c], [b, d]) = (exchange(a, c, 0x33, 2), exchange(b, d, 0x33, 2));
            let ([a, b], [c, d]) = (a.deinterleave(b), c.deinterleave(d));
            let ([a, b], [c, d]) = (exchange(a, b, 0x0f, 4), exchange(c, d, 0x0f, 4));
            a.concat(c).concat(b.concat(d)).bitcast()
        });
        return_if!((S::SSSE3 || S::WASM) && !S::GFNI && S::REGISTER == 16 && W::BYTES == 64, {
            let v = self.same::<u8, B64>().swizzle_groups([0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15]);
            let [lower, upper] = v.split();
            let ([a, b], [c, d]) = (lower.split(), upper.split());
            let ([a, b], [c, d]) = (zip::<u16, _, _>(a, b), zip::<u16, _, _>(c, d));
            let ([a, c], [b, d]) = (zip::<u32, _, _>(a, c), zip::<u32, _, _>(b, d));
            let ([a, b], [c, d]) = (exchange(a, b, 0x55, 1), exchange(c, d, 0x55, 1));
            let ([a, c], [b, d]) = (exchange(a, c, 0x33, 2), exchange(b, d, 0x33, 2));
            let ([a, b], [c, d]) = (zip::<u64, _, _>(a, b), zip::<u64, _, _>(c, d));
            let ([a, b], [c, d]) = (exchange(a, b, 0x0f, 4), exchange(c, d, 0x0f, 4));
            a.concat(c).concat(b.concat(d)).bitcast()
        });
        let v = self.bitcast::<u64>().transpose_bits().bitcast::<u8>().bytes_by_place();
        choose! {
            W::BYTES == 8 => v.same::<u8, B8>().cast(),
            W::BYTES == 16 => v.same::<u8, B16>().bitcast::<u16>().cast(),
            W::BYTES == 32 => v.same::<u8, B32>().bitcast::<u32>().cast(),
            _ => v.same::<u8, B64>().bitcast(),
        }
    }
}

impl<S: Isa, W: Width> Tag<S, u8, W> {
    /// The reverse.
    #[op]
    fn join_eight(self, planes: Simd<u64, B64, S>) -> Simd<u8, W, S> {
        return_if!(S::REGISTER == 16 && !S::GFNI && !S::SCALAR && W::BYTES >= if S::SSSE3 { 64 } else { 32 }, {
            let [lower, upper] = planes.bitcast::<u8>().split();
            let ([a, c], [b, d]) = (lower.split(), upper.split());
            let ([a, b], [c, d]) = (exchange(a, b, 0x0f, 4), exchange(c, d, 0x0f, 4));
            let ([a, b], [c, d]) = (a.interleave(b), c.interleave(d));
            let ([a, c], [b, d]) = (exchange(a, c, 0x33, 2), exchange(b, d, 0x33, 2));
            let ([a, b], [c, d]) = (exchange(a, b, 0x55, 1), exchange(c, d, 0x55, 1));
            let ([a, c], [b, d]) = (a.interleave(c), b.interleave(d));
            let ([a, b], [c, d]) = (a.interleave(b), c.interleave(d));
            a.concat(b).concat(c.concat(d)).resize()
        });
        return_if!(S::AVX2 && S::REGISTER == 32 && !S::GFNI && W::BYTES == 64, {
            let [a, b] = planes.bitcast::<u8>().split();
            let [a, b] = exchange(a, b, 0x0f, 4);
            let [a, b] = a.as_u128s().interleave(b);
            let [a, b] = exchange(a, b, 0x33, 2);
            let [a, b] = a.in_blocks().interleave(b);
            let [a, b] = exchange(a, b, 0x55, 1);
            let [a, b] = a.in_blocks().interleave(b);
            a.concat(b).bitcast::<u32>().swizzle_groups(ZIPPED).bitcast::<u8>().same()
        });
        let v: Simd<u8, W, S> = choose! {
            W::BYTES == 8 => planes.cast::<u8>().same(),
            W::BYTES == 16 => planes.cast::<u16>().bitcast::<u8>().same(),
            W::BYTES == 32 => planes.cast::<u32>().bitcast::<u8>().same(),
            _ => planes.bitcast::<u8>().same(),
        };
        // One shuffle does for both.
        return_if!(S::GFNI, {
            let rows = v.bytes_to_place(7).bitcast::<u64>();
            rows.like(0x8040_2010_0804_0201).bitcast::<u8>().galois_affine(rows)
        });
        v.bytes_to_place(0).bitcast::<u64>().transpose_bits().bitcast()
    }
}

impl<S: Isa, T: Unsigned, W: Width> Simd<T, W, S> {
    /// The lowest `K` bits of all lanes, as bitmasks: bit `i` of `planes[k]` is bit `k` of lane `i`. It doesn't build for more than 64 lanes.
    /// For many planes it transposes with GFNI and on NEON, which takes half of the time of `any_bits(1 << k).to_bitmask()` for each `k` there.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let [ones, twos] = u8x4::from([1, 2, 3, 4]).bit_planes();
    /// assert_eq!((ones, twos), (0b0101, 0b0110));
    /// # } example()
    /// ```
    #[doc(alias("bitshuffle", "bitslice", "s2p", "bit_transpose"))]
    #[op]
    #[track_caller]
    pub fn bit_planes<const K: usize>(self) -> [u64; K] {
        const { crate::make::Fits::<K, T>::PLANES };
        require!("a `u64` has no bit for each of more than 64 lanes", Self::LANES <= 64);
        self.to_planes()
    }
    /// Up to so many planes are as fast one by one.
    const BY_MASKS: usize = if S::GFNI || (S::SSSE3 || S::WASM) && S::REGISTER == 16 && Self::LANES == 64 {
        6
    } else if S::ARM || S::SCALAR {
        if Self::LANES == 64 { 2 } else { 4 }
    } else {
        64
    };
    #[op]
    fn to_planes<const K: usize>(self) -> [u64; K] {
        return_if!(Self::LANES >= 8 && K > Self::BY_MASKS, {
            let mut planes = [0; K];
            unrolled!(8, for byte in 0..const (K.div_ceil(8)) {
                let eight = (self >> (8 * byte as u32)).cast::<u8>().planes().to_array();
                unrolled!(8, for k in 0..(8.min(K - 8 * byte)) {
                    planes[8 * byte + k] = eight[k];
                });
            });
            planes
        });
        crate::array::own::from_fn(
            #[inline(always)]
            |k| self.any_bits(T::ONE << k as u32).to_bitmask(),
        )
    }
}

impl<S: Isa, T: Unsigned, W: Width> Tag<S, T, W> {
    #[op]
    #[track_caller]
    pub(crate) fn join_planes<const K: usize>(self, planes: [u64; K]) -> Simd<T, W, S> {
        require!("a `u64` has no bit for each of more than 64 lanes", Self::LANES <= 64);
        self.joined_planes(planes)
    }
    const BY_MASKS: usize = if S::GFNI || Self::LANES >= 4 * S::REGISTER {
        2
    } else if S::ARM || Self::LANES > S::REGISTER {
        4 + S::ARM as usize
    } else {
        6
    };
    #[op]
    fn joined_planes<const K: usize>(self, planes: [u64; K]) -> Simd<T, W, S> {
        let mut v = self.zero();
        return_if!(Self::LANES >= 8 && K > Self::BY_MASKS, {
            let mut v = v;
            unrolled!(8, for byte in 0..const (K.div_ceil(8)) {
                let eight = self.simd().fixed::<u64, B64>().from_fn(
                    #[inline(always)]
                    |k| if 8 * byte + k < K { planes[8 * byte + k] } else { 0 },
                );
                let bytes = self.simd().fixed::<u8, Scaled<T, u8, W>>().join_eight(eight);
                v |= bytes.cast::<T>().same::<T, W>() << (8 * byte as u32);
            });
            v
        });
        unrolled!(64, for i in 0..const K {
            v |= self.mask_from_bits(planes[i]).if_then_else_zero(self.set(T::ONE << i as u32));
        });
        v
    }
}
