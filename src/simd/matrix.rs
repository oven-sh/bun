//! Small matrices, and products of quantized numbers.

use crate::f16;
use crate::products::Dot;
use crate::{Isa, Lane, Operand, Simd, Width, X86};

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// What [`store_interleaved`](crate::Simd::store_interleaved) stores, as four vectors. With four lanes, this transposes
    /// the matrix of which the vectors are the rows.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let [a, ..] = u32x4::iota(0).interleave4(u32x4::iota(10), u32x4::iota(20), u32x4::iota(30));
    /// assert_eq!(a, [0, 10, 20, 30]);
    /// # } example()
    /// ```
    #[op]
    pub fn interleave4(
        self,
        b: impl crate::Operand<T, W, S>,
        c: impl crate::Operand<T, W, S>,
        d: impl crate::Operand<T, W, S>,
    ) -> [Self; 4] {
        let b = crate::Operand::vector(b, crate::Tag::new(self.s));
        let c = crate::Operand::vector(c, crate::Tag::new(self.s));
        let d = crate::Operand::vector(d, crate::Tag::new(self.s));
        let tag = self.tag();
        halves_if!(S::SSE2 && S::REGISTER < 64 && W::BYTES > S::REGISTER, |a: Self = self, b: Self = b, c: Self = c, d: Self = d| {
            let [e, f, g, h] = a.lower_half().interleave4(b.lower_half(), c.lower_half(), d.lower_half());
            let [i, j, k, l] = a.upper_half().interleave4(b.upper_half(), c.upper_half(), d.upper_half());
            [a.tag().combine(f, e), a.tag().combine(h, g), a.tag().combine(j, i), a.tag().combine(l, k)]
        });
        return_if!(W::BYTES < 32 || W::BYTES > S::REGISTER || W::BYTES == 64 && size_of::<T>() > 2, {
            let (ac0, ac1) = (self.interleave_whole_lower(c), self.interleave_whole_upper(c));
            let (bd0, bd1) = (b.interleave_whole_lower(d), b.interleave_whole_upper(d));
            [
                ac0.interleave_whole_lower(bd0),
                ac0.interleave_whole_upper(bd0),
                ac1.interleave_whole_lower(bd1),
                ac1.interleave_whole_upper(bd1),
            ]
        });
        // Within the blocks, and then whole blocks.
        return_if!(size_of::<T>() == 8, {
            let (ab0, ab1, cd0, cd1) =
                (self.interleave_lower(b), self.interleave_upper(b), c.interleave_lower(d), c.interleave_upper(d));
            [
                tag.concat_lower_lower(cd0, ab0),
                tag.concat_lower_lower(cd1, ab1),
                tag.concat_upper_upper(cd0, ab0),
                tag.concat_upper_upper(cd1, ab1),
            ]
        });
        // Of four blocks, each gets its quarter of each result first.
        let turn = always!(
            |v: Self| choose! { W::BYTES == 64 => v.reinterpret::<u32>().swizzle(#[inline(always)] |i| i % 4 * 4 + i / 4).settled().reinterpret(), _ => v }
        );
        let (a, b, c, d) = (turn(self), turn(b), turn(c), turn(d));
        let (ac0, ac1, bd0, bd1) =
            (a.interleave_lower(c), a.interleave_upper(c), b.interleave_lower(d), b.interleave_upper(d));
        let (v0, v1, v2, v3) = (
            ac0.interleave_lower(bd0),
            ac0.interleave_upper(bd0),
            ac1.interleave_lower(bd1),
            ac1.interleave_upper(bd1),
        );
        return_if!(W::BYTES == 64, [v0, v1, v2, v3]);
        // LLVM would compute the upper halves again.
        let (v0, v1, v2, v3) = choose! {
            crate::X86 && size_of::<T>() <= 2 => (v0.hidden_unless_known(), v1.hidden_unless_known(), v2.hidden_unless_known(), v3.hidden_unless_known()),
            _ => (v0, v1, v2, v3),
        };
        [
            tag.concat_lower_lower(v1, v0),
            tag.concat_lower_lower(v3, v2),
            tag.concat_upper_upper(v1, v0),
            tag.concat_upper_upper(v3, v2),
        ]
    }
}

/// In each block: the rows 0, 0, 1, 1 and the columns 0, 1, 0, 1, four bytes at a time.
macro_rules! mat_mul {
    ($($a:ty, $name:ident($b:ty) -> $sum:ty = $op:ident, $dot:ident;)*) => {$(
        impl<S: Isa, W: Width> Simd<$a, W, S> {
            /// In each block: `self` has two rows of eight, `other` two columns of eight, and their product is added to
            /// the two rows of two in `sum`. It is one instruction if `has!(i8mm)`, which does twice the work of
            /// [`dot_add`](Self::dot_add). Elsewhere that is faster.
            #[op]
            #[track_caller]
            pub(crate) fn $name(self, other: Simd<$b, W, S>, sum: impl Operand<$sum, W, S>) -> Simd<$sum, W, S> {
                require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
                let (a, b, d) = (self.bitcast::<u32>(), other.bitcast::<u32>(), self.tag().repartition::<$sum>());
                if S::HAS_MAT_MUL {
                    return self.with_bytes(self.s.$op::<W>(self.bytes(), other.bytes(), sum.vector(d).bytes()));
                }
                let sum = a.dup_even().bitcast::<$a>().$dot(b.shuffle4::<0b10_00_10_00>().bitcast(), sum);
                a.dup_odd().bitcast::<$a>().$dot(b.shuffle4::<0b11_01_11_01>().bitcast(), sum)
            }
        }
    )*};
}
mat_mul! {
    i8, mat_mul_accumulate(i8) -> i32 = mat_mul_i8_i8, sum_of_mul_quad_accumulate;
    u8, mat_mul_accumulate(u8) -> u32 = mat_mul_u8_u8, sum_of_mul_quad_accumulate;
    u8, mat_mul_accumulate_i8(i8) -> i32 = mat_mul_u8_i8, sum_of_mul_quad_accumulate_i8;
}

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// [`dot_add`](Self::dot_add) with a small factor, which is faster on most targets. Times `i8` into `i32`, the result is unspecified
    /// if a lane of `self` is 128 or more. Into `u16` and `u32`, that limit is for `other`, and the products of an even lane
    /// and the next have to add up to less than 32768. They do if these lanes of `other` add up to 128 or less.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (pixels, weights) = (u8x4::from([255, 255, 10, 20]), u8x4::from([38, 75, 15, 0]));
    /// assert_eq!(pixels.dot_add_relaxed::<u32>(weights, 64), [29029]);
    /// assert_eq!(weights.dot_add_relaxed::<i32>(-128, 0), [-16384]);
    /// # } example()
    /// ```
    #[op]
    #[track_caller]
    #[doc(alias("sum_of_mul_quad_accumulate_u7", "dot4_add_u7"))]
    pub fn dot_add_relaxed<U: Lane>(
        self,
        other: impl crate::Factor<u8, U, W, S>,
        sum: impl Operand<U, W, S>,
    ) -> Simd<U, W, S>
    where
        u8: Dot<U>,
    {
        self.small_dot(other.vector(self.tag().repartition()), sum.vector(self.tag().repartition()))
    }
    #[op]
    fn small_dot<U: Lane>(self, other: Simd<<u8 as Dot<U>>::Other, W, S>, sum: Simd<U, W, S>) -> Simd<U, W, S>
    where
        u8: Dot<U>,
    {
        choose! {
            S::SSSE3 && U::BITS == 16 => sum + self.saturating_dot(other.bitcast()).bitcast(),
            S::HAS_DOT_U8_I8 && (X86 || !S::HAS_DOT) && U::BITS == 32 => self.sum_of_mul_quad_accumulate_i8(other.bitcast(), sum.bitcast::<i32>()).bitcast(),
            S::RELAXED && U::IS_SIGNED => self.with_bytes(self.s.dot_u7_i8::<W>(self.bytes(), other.bytes(), sum.bytes())),
            S::SSSE3 => self.saturating_dot(other.bitcast()).sums_of_2().bitcast() + sum,
            U::IS_SIGNED => self.cast_signed().dot_add_relaxed(other.bitcast(), sum.bitcast::<i32>()).bitcast(),
            S::A64 && !S::HAS_DOT && U::BITS == 32 && W::BYTES >= 8 => self.widen_mul_pairwise_add(other.bitcast()).sums_of_2().bitcast() + sum,
            _ => self.dot_add(other, sum),
        }
    }
}

impl<S: Isa, W: Width> Simd<i8, W, S> {
    /// [`dot_add`](Self::dot_add) into `i32`, which is faster on x86. The result is
    /// unspecified if a lane of `other` is -128, which symmetric quantization leaves out.
    #[op]
    #[doc(alias("sum_of_mul_quad_accumulate_symmetric", "dot4_add_symmetric"))]
    pub fn dot_add_relaxed<U>(self, other: impl Operand<i8, W, S>, sum: impl Operand<i32, W, S>) -> Simd<i32, W, S>
    where
        i32: crate::lane::Is<U>,
    {
        let other = self.like(other);
        choose! {
            S::SSSE3 && !S::HAS_DOT => {
                // 128 times 127 twice doesn't saturate.
                self.abs().cast_unsigned().dot_add_relaxed::<i32>(self.if_negative_then_neg_or_undef_if_zero(other), sum)
            },
            S::A64 && !S::HAS_DOT && W::BYTES >= 8 => self.widen_mul_pairwise_add(other).sums_of_2() + sum,
            S::ARM && !S::HAS_DOT && W::BYTES == 16 => {
                let (lower, upper) = self.mul_halves(other);
                lower.pairwise_add128(upper).sums_of_2() + sum
            },
            _ => self.sum_of_mul_quad_accumulate(other, sum),
        }
    }
}

impl<S: Isa, W: Width> Simd<crate::bf16, W, S> {
    /// [`dot_add`](Self::dot_add) into `f32`, which is one instruction if `has!(bf16)`. How it rounds is unspecified, and so is
    /// whether subnormal numbers count as zero.
    #[op]
    #[doc(alias("vdpbf16ps", "bfdot"))]
    pub fn dot_add_relaxed<U>(
        self,
        other: impl Operand<crate::bf16, W, S>,
        sum: impl Operand<f32, W, S>,
    ) -> Simd<f32, W, S>
    where
        f32: crate::lane::Is<U>,
    {
        let (other, sum) = (self.like(other), sum.vector(self.tag().repartition()));
        if const { S::HAS_BF16 } {
            return self.with_bytes(self.s.dot_bf16::<W>(self.bytes(), other.bytes(), sum.bytes()));
        }
        self.even().mul_add_relaxed(other.even(), self.odd().mul_add_relaxed(other.odd(), sum))
    }
}

impl<S: Isa, W: Width> Simd<crate::bf16, W, S> {
    /// In each block: `self` has two rows of four, `other` two columns of four, and their product is added to the two rows
    /// of two in `sum`. On Arm with `has!(bf16)` it is one instruction, which does twice the work of
    /// [`dot_add_relaxed`](Self::dot_add_relaxed). It rounds like that.
    #[op]
    #[track_caller]
    #[doc(alias("bfmmla"))]
    pub fn mat_mul_add_relaxed<U>(
        self,
        other: impl Operand<crate::bf16, W, S>,
        sum: impl Operand<f32, W, S>,
    ) -> Simd<f32, W, S>
    where
        f32: crate::lane::Is<U>,
    {
        require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
        let (other, sum) = (self.like(other), sum.vector(self.tag().repartition()));
        if_here!(S::A64 && S::HAS_BF16, {
            return self.with_bytes(self.s.mat_mul_bf16::<W>(self.bytes(), other.bytes(), sum.bytes()));
        });
        let (a, b) = (self.bitcast::<u32>(), other.bitcast::<u32>());
        let sum = a.dup_even().bitcast::<crate::bf16>().dot_add_relaxed(b.shuffle4::<0b10_00_10_00>().bitcast(), sum);
        a.dup_odd().bitcast::<crate::bf16>().dot_add_relaxed(b.shuffle4::<0b11_01_11_01>().bitcast(), sum)
    }
    #[op]
    pub(crate) fn fused_dot(self, other: Self, sum: Simd<f32, W, S>) -> Simd<f32, W, S> {
        if_here!(S::A64 && S::HAS_BF16, {
            return self.with_bytes(self.s.fused_dot_bf16::<W>(self.bytes(), other.bytes(), sum.bytes()));
        });
        self.even().mul_add(other.even(), self.odd().mul_add(other.odd(), sum))
    }
}

macro_rules! wide { ($($t:ty, $exact:ident $(, $has:ident)?;)*) => {$(
    impl<S: Isa, W: Width> Simd<$t, W, S> {
        /// Adds the products of the lower halves to the first sum, and those of the upper halves to the second. Each rounds once.
        /// For `f16` it is two instructions with `neon86 + fhm`.
        #[op]
        #[doc(alias("fmlal", "bfmlal", "fhm"))]
        pub fn widening_mul_add(self, other: impl Operand<$t, W, S>, sums: [Simd<f32, W, S>; 2]) -> [Simd<f32, W, S>; 2] {
            $(return_if!(S::$has && W::BYTES == 16, |a: Self = self, b: Self = (self.like(other)), sums: [Simd<f32, W, S>; 2] = sums| {
                [a.with_bytes(a.s.wide_mul_add_f16::<W>(a.bytes(), b.bytes(), sums[0].bytes(), false)), a.with_bytes(a.s.wide_mul_add_f16::<W>(a.bytes(), b.bytes(), sums[1].bytes(), true))]
            });
            return_if!(S::$has && W::BYTES > 16, |a: Self = self, b: Self = (self.like(other)), sums: [Simd<f32, W, S>; 2] = sums| {
                let ([p, q], [r, s]) = (a.lower_half().widening_mul_add(b.lower_half(), sums[0].split()), a.upper_half().widening_mul_add(b.upper_half(), sums[1].split()));
                [sums[0].tag().combine(q, p), sums[0].tag().combine(s, r)]
            });)?
            let ([a, b], [c, d]) = (self.widen::<f32>(), self.like(other).widen::<f32>());
            [a.$exact(c, sums[0]), b.$exact(d, sums[1])]
        }
    }
)*}; }
// A product of two `f16` is exact in `f32`.
wide! { f16, mul_add_relaxed, FHM; crate::bf16, mul_add; }
