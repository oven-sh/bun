//! What the numbers of `std` have, and is made of other operations.

use crate::arithmetic::known;
use crate::multiply::fns;
use crate::{Count, Float, Int, Isa, Lane, MaskOf, Operand, Signed, Simd, Unsigned, Width, X86};

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// For floating-point lanes.
    #[op]
    pub(crate) fn float_rem(self, by: Self) -> Self {
        crate::half::in_f32!(half self, by => |a, b| a.fmod(b));
        choose! { |this: Self = self, by: Self = by|
            T::BITS == 32 => this.bitcast::<f32>().fmod(by.bitcast()).bitcast(),
            _ => this.bitcast::<f64>().fmod(by.bitcast()).bitcast(),
        }
    }
    #[op]
    fn float_trunc(self) -> Self {
        crate::half::in_f32!(half self => |a| a.trunc());
        choose! { |this: Self = self|
            !T::IS_FLOAT => this,
            T::BITS == 32 => this.bitcast::<f32>().trunc().bitcast(),
            _ => this.bitcast::<f64>().trunc().bitcast(),
        }
    }
    #[op]
    fn midpoint_down(self, other: Self) -> Self {
        // A sum that follows would be mixed with this one, which is then no `uhadd`.
        const fn one<S: Isa, T: Lane>() -> bool {
            cfg!(target_arch = "aarch64") && S::NEON && T::BITS <= 32
        }
        halves_if!(one::<S, T>() && W::BYTES > S::REGISTER, |a: Self = self, b: Self = other| {
            a.tag().combine(a.upper_half().midpoint_down(b.upper_half()), a.lower_half().midpoint_down(b.lower_half()))
        });
        return_if!(one::<S, T>() && W::BYTES >= 8, self.halved_sum(other).barrier());
        self.halved_sum(other)
    }
    #[op]
    fn halved_sum(self, other: Self) -> Self {
        let (a, b) = (self.cast_unsigned(), other.cast_unsigned());
        choose! {
            T::IS_SIGNED => (self.cast_signed() & other.cast_signed()).bitcast::<T>() + (self.cast_signed().xor(other.cast_signed()) >> 1).bitcast::<T>(),
            // The logic is one instruction.
            S::AVX512VL && T::BITS <= 16 => (a.midpoint_up(b) - ((a ^ b) & T::Unsigned::ONE)).bitcast(),
            // Reads each operand once.
            (crate::X86 || S::WASM) && T::BITS <= 16 => (!(!a).midpoint_up(!b)).bitcast(),
            _ => ((a & b) + (a.xor(b) >> 1)).bitcast(),
        }
    }

    fns! {
        /// The remainder that is not negative, as in `std`. Divisors are as for `/` and `%`.
        #[doc(alias("fmod", "modulo"))]
        fn rem_euclid(self, by: impl Operand<T, W, S>) -> Self {
            let (left, by) = (self % by, self.like(by));
            choose! {
                T::IS_FLOAT => left.simd_lt(T::ZERO).select(left + self.tag().sign_bit().and_not(by), left),
                T::IS_SIGNED => left + left.to_mask().select(by.cast_signed().abs().bitcast::<T>(), T::ZERO),
                _ => left,
            }
        }
        /// The quotient that goes with [`rem_euclid`](Self::rem_euclid), as in `std`. For a positive divisor it is rounded down.
        #[doc(alias("div_floor"))]
        fn div_euclid(self, by: impl Operand<T, W, S>) -> Self {
            let (q, divisor) = ((self / by).float_trunc(), self.like(by));
            choose! {
                T::IS_FLOAT => (self % by).simd_lt(T::ZERO).select(q - (divisor & self.tag().sign_bit() | T::ONE), q),
                T::IS_SIGNED => q - (self - q * by).to_mask().select(divisor.cast_signed().signum().bitcast::<T>(), T::ZERO),
                _ => q,
            }
        }
        /// `(self + other) / 2` without overflow, as in `std`: integers are rounded toward zero. See also [`midpoint_up`](Self::midpoint_up).
        #[doc(alias("halving_add", "uhadd", "average"))]
        fn midpoint(self, other: impl Operand<T, W, S>) -> Self {
            let other = self.like(other);
            crate::half::in_f32!(@ Self::SOFT && T::FRACTION == 10, false, self, other => |a, b| (a + b) * 0.5);
            crate::half::in_f32!(@ Self::SOFT, false, self, other => |a, b| a.midpoint(b));
            return_if!(T::IS_FLOAT, {
                let (sum, half) = (self + other, T::from_f64(0.5));
                self.tag().sign_bit().and_not(sum).simd_le(T::MAX).select(sum * half, self * half + other * half)
            });
            return_if!(S::SSE2 && !S::GFNI && T::IS_SIGNED && T::BITS == 8, {
                let up = self.bitcast::<i8>().midpoint_up(other.bitcast::<i8>());
                (up - (up.simd_gt(0).to_vector() & (self ^ other).bitcast::<i8>() & 1)).bitcast()
            });
            let down = self.midpoint_down(other);
            choose! { T::IS_SIGNED => down + ((down.cast_unsigned() >> (T::BITS - 1)).bitcast::<T>() & self.xor(other)), _ => down }
        }
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    /// Whether `leading_zeros` and a shift by its result are an instruction each.
    const COUNTS_AND_SHIFTS: bool = S::AVX512CD && T::BITS >= 32 || S::NEON && (T::BITS <= 32 || S::SVE);
    const SATURATES: bool = T::BITS <= 16 || S::NEON;

    /// To the left, or to the right if the count is negative, without the sign. The lowest byte of a lane counts.
    #[on(NEON)]
    #[op]
    pub(crate) fn shift_by_sign(self, left: Self) -> Self {
        let (s, v, left) = (self.s, self.bytes(), left.bytes());
        self.with_bytes(if const { T::BITS == 8 } {
            s.shift8::<W>(v, left)
        } else if const { T::BITS == 16 } {
            s.shift16::<W>(v, left)
        } else if const { T::BITS == 32 } {
            s.shift32::<W>(v, left)
        } else {
            s.shift64::<W>(v, left)
        })
    }
    /// The halves of the products.
    #[op]
    fn low_and_high(self, other: Self) -> (Self, Self) {
        return_if!(S::AVX2 && !S::AVX512DQ && T::BITS == 64 && W::BYTES >= 32, self.mul_128(other));
        (self * other, self.mul_high(other))
    }
    #[op]
    fn smeared(self) -> Simd<T::Unsigned, W, S> {
        let mut v = self.cast_unsigned();
        v |= v >> 1;
        v |= v >> 2;
        v |= v >> 4;
        when!(T::BITS > 8, v |= v >> 8);
        when!(T::BITS > 16, v |= v >> 16);
        when!(T::BITS > 32, v |= v >> 32);
        v
    }

    fns! {
        /// Only the lowest bit that is set.
        #[doc(alias("blsi"))]
        fn isolate_lowest_one(self) -> Self { self & (self.tag().zero() - self) }
        /// Only the highest bit that is set.
        fn isolate_highest_one(self) -> Self {
            return_if!(S::A64, self.tag().sign_bit().shift_by_sign(self.tag().zero() - self.leading_zeros().bitcast()));
            return_if!(S::GFNI && T::BITS <= 16, self.reverse_bits().isolate_lowest_one().reverse_bits());
            return_if!(S::AVX512F && T::BITS >= 32, {
                let v = self.cast_unsigned();
                v.tag().sign_bit().unbounded_shr(v.leading_zeros()).bitcast()
            });
            return_if!(S::SSE41 && T::BITS == 8 && W::BYTES >= 16, {
                let (v, d) = (self.bitcast::<u8>(), self.tag().repartition::<u8>());
                let low = d.dup128([0, 1, 2, 2, 4, 4, 4, 4, 8, 8, 8, 8, 8, 8, 8, 8]);
                (low << 4).table_lookup_bytes(v >> 4).simd_max(low.table_lookup_bytes(v)).bitcast()
            });
            return_if!(S::SSE41 && !S::AVX512VL && T::BITS == 16 && W::BYTES >= 16, {
                let each = self.bitcast::<u8>().isolate_highest_one();
                (each & (self.bitcast::<u16>() >> 8).bitcast::<u8>().simd_eq(0).to_simd::<u8>()).bitcast()
            });
            return_if!(S::SSE2 && T::BITS == 64, {
                let each = self.bitcast::<u32>().isolate_highest_one();
                (each & (self.bitcast::<u64>() >> 32).bitcast::<u32>().simd_eq(0).to_simd::<u32>()).bitcast()
            });
            return_if!(S::SSE2 && T::BITS == 32, {
                // The exponent, as in `leading_zeros`. What is out of range is converted to the highest bit.
                let v = self.bitcast::<i32>();
                let float = (v >> 8).and_not(v).cast::<f32>().bitcast::<i32>() | v >> 31;
                v.with_bytes(v.s.truncate_f32_i32::<W>((float & 0x7f80_0000).bytes()))
            });
            let all = self.smeared();
            (all ^ all >> 1).bitcast()
        }
        /// `self << count`, but zero if the count, as an unsigned number, is the number of bits or more. This is what x86 does.
        #[doc(alias("vpsllv"))]
        fn unbounded_shl(self, count: impl Count<T, W, S>) -> Self { Count::unbounded(count, self, true) }
        /// `self >> count`, but zero or -1 if the count, as an unsigned number, is the number of bits or more.
        #[doc(alias("vpsrlv", "vpsrav"))]
        fn unbounded_shr(self, count: impl Count<T, W, S>) -> Self { Count::unbounded(count, self, false) }
        /// The sum, which wraps, and where it does.
        #[doc(alias("checked_add", "strict_add"))]
        fn overflowing_add(self, other: impl Operand<T, W, S>) -> (Self, MaskOf<T, W, S>) {
            let (sum, other) = (self + other, self.like(other));
            (sum, choose! {
                !T::IS_SIGNED => sum.simd_lt(self),
                Self::SATURATES => sum.simd_ne(self.saturating_add(other)),
                _ => ((sum ^ self) & (sum ^ other)).to_mask(),
            })
        }
        /// The difference, which wraps, and where it does.
        #[doc(alias("checked_sub", "strict_sub"))]
        fn overflowing_sub(self, other: impl Operand<T, W, S>) -> (Self, MaskOf<T, W, S>) {
            let (left, other) = (self - other, self.like(other));
            (left, choose! {
                !T::IS_SIGNED => self.simd_lt(other),
                Self::SATURATES => left.simd_ne(self.saturating_sub(other)),
                _ => ((self ^ other) & (self ^ left)).to_mask(),
            })
        }
        /// The product, which wraps, and where it does.
        #[doc(alias("checked_mul", "strict_mul"))]
        fn overflowing_mul(self, other: impl Operand<T, W, S>) -> (Self, MaskOf<T, W, S>) {
            let (low, high) = self.low_and_high(self.like(other));
            (low, choose! { T::IS_SIGNED => high.simd_ne(low >> (T::BITS - 1)), _ => high.simd_ne(T::ZERO) })
        }
        /// The product, or the limit of `T` that it is beyond. A power of two that is written as a number mostly makes this a shift with saturation, which is one instruction on AArch64.
        #[doc(alias("saturating_shl", "sqshl", "uqshl"))]
        fn saturating_mul(self, other: impl Operand<T, W, S>) -> Self {
            if_here!(crate::OPTIMIZED && (S::A64 || S::SSE2 || S::WASM), {
                if let Some(n) = Operand::number(other) && known(n > T::ONE && n.to_u64().is_power_of_two() && n.to_u64() <= Self::SHIFTS_UP_TO) {
                    return self.saturating_shl(n.to_u64().trailing_zeros());
                }
            });
            let other = self.like(other);
            return_if!(X86 && Self::PACKS, |this: Self = self, other: Self = other| {
                let [lower, upper] = (this * other).in_blocks().interleave(this.mul_high(other));
                lower.bitcast::<i32>().in_blocks().saturating_narrow::<i16>(upper.bitcast()).bitcast()
            });
            return_if!(Self::LANES > 1 && W::BYTES > 2 && (T::BITS == 8 || T::BITS == 16 && T::IS_SIGNED || T::BITS < 64 && S::NEON), |this: Self = self, other: Self = other| {
                let [lower, upper] = this.widening_mul(other);
                this.tag().ordered_demote2_to(lower, upper)
            });
            halves_if!(S::SSE2 && !S::SSE41 && W::BYTES > 16 && T::BITS >= 32, |a: Self = self, b: Self = other| {
                a.tag().combine(a.upper_half().saturating_mul(b.upper_half()), a.lower_half().saturating_mul(b.lower_half()))
            });
            let (low, high) = self.low_and_high(other);
            return_if!(T::IS_SIGNED, high.simd_eq(low >> (T::BITS - 1)).select(low, high >> (T::BITS - 1) ^ T::MAX));
            high.simd_eq(T::ZERO).select(low, T::MAX)
        }
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    const PACKS: bool = X86 && T::BITS == 16 && T::IS_SIGNED && W::BYTES >= 16;
    /// Products are faster beyond.
    const SHIFTS_UP_TO: u64 = match () {
        _ if S::ONLY_SSE2 && T::BITS == 64 => 0,
        _ if S::ONLY_SSE2 && T::BITS == 8 && T::IS_SIGNED && W::BYTES >= 16 => 8,
        _ if S::A64 || T::BITS > 16 => !0,
        _ if W::BYTES < 16 || S::AVX512BW && T::BITS == 16 && !T::IS_SIGNED => 4,
        _ if Self::PACKS => 8,
        _ => !0,
    };
    /// `1 << by` is a positive number above 1.
    #[op]
    fn saturating_shl(self, by: u32) -> Self {
        return_if!(S::A64, {
            // More units add than shift.
            if by == 1 {
                return self.saturating_add(self);
            }
            let by = self.like(T::from_u64(by as u64));
            self.with_bytes(self.s.saturated_shift::<W>(self.bytes(), by.bytes(), (T::BITS, T::IS_SIGNED)))
        });
        let most = always!(|by: u32| T::from_u64(T::MAX.to_u64() >> by));
        let least = always!(|by: u32| choose! { T::IS_SIGNED => T::from_u64(!(T::MAX.to_u64() >> by)), _ => T::ZERO });
        return_if!(
            X86 && S::REGISTER == 64 && W::BYTES == 64 && T::BITS > 16 && !T::IS_SIGNED,
            self.simd_gt(most(by)).select(self.tag().hidden_ones(), self << by)
        );
        return_if!(T::BITS > 16, self.simd_gt(most(by)).select(T::MAX, self.simd_max(least(by)) << by));
        let twice = always!(|v: Self| v.saturating_add(v));
        match by {
            1 => twice(self),
            2 => twice(twice(self)),
            3 => twice(twice(twice(self))),
            _ => twice(self.simd_max(least(by - 1)).simd_min(most(by - 1)) << (by - 1)),
        }
    }
}

impl<S: Isa, T: Signed, W: Width> Simd<T, W, S> {
    fns! {
        /// True where the lane is greater than zero.
        fn is_positive(self) -> MaskOf<T, W, S> { self.simd_gt(T::ZERO) }
        /// The absolute value, also of the lowest one.
        fn unsigned_abs(self) -> Simd<T::Unsigned, W, S> { self.abs().cast_unsigned() }
        /// The sum, or the highest value if it is more.
        #[doc(alias("suqadd"))]
        fn saturating_add_unsigned(self, other: impl Operand<T::Unsigned, W, S>) -> Self {
            return_if!(S::A64, self.with_bytes(self.s.add_other_sign::<W>(self.bytes(), other.vector(self.tag().repartition()).bytes(), (T::BITS, true))));
            (self ^ T::MIN).cast_unsigned().saturating_add(other).cast_signed() ^ T::MIN
        }
        /// The difference, or the lowest value if it is less.
        fn saturating_sub_unsigned(self, other: impl Operand<T::Unsigned, W, S>) -> Self {
            (self ^ T::MIN).cast_unsigned().saturating_sub(other).cast_signed() ^ T::MIN
        }
    }
}

impl<S: Isa, T: Unsigned, W: Width> Simd<T, W, S> {
    fns! {
        /// The sum, or the limit of `T` that it is beyond.
        #[doc(alias("usqadd"))]
        fn saturating_add_signed(self, other: impl Operand<T::Signed, W, S>) -> Self {
            return_if!(S::A64, self.with_bytes(self.s.add_other_sign::<W>(self.bytes(), other.vector(self.tag().repartition()).bytes(), (T::BITS, false))));
            ((self.cast_signed() ^ T::Signed::MIN).saturating_add(other) ^ T::Signed::MIN).cast_unsigned()
        }
        /// The difference, or the limit of `T` that it is beyond.
        fn saturating_sub_signed(self, other: impl Operand<T::Signed, W, S>) -> Self {
            ((self.cast_signed() ^ T::Signed::MIN).saturating_sub(other) ^ T::Signed::MIN).cast_unsigned()
        }
        /// `self + other + carry`, which wraps, and where it does: a digit of a sum of large numbers, one in each lane.
        #[doc(alias("adc"))]
        fn carrying_add(self, other: impl Operand<T, W, S>, carry: MaskOf<T, W, S>) -> (Self, MaskOf<T, W, S>) {
            let sum = self + other;
            (sum - carry.to_simd::<T>(), sum.simd_lt(self) | carry & sum.simd_eq(T::MAX))
        }
        /// `self - other - borrow`, which wraps, and where it does.
        #[doc(alias("sbb"))]
        fn borrowing_sub(self, other: impl Operand<T, W, S>, borrow: MaskOf<T, W, S>) -> (Self, MaskOf<T, W, S>) {
            (self - other + borrow.to_simd::<T>(), self.simd_lt(other) | borrow & self.simd_eq(other))
        }
        /// The upper half of `self` and `low`, as a number of twice the size that is shifted by `count` modulo the number of bits of a lane.
        #[doc(alias("vpshld", "shld", "fshl"))]
        fn funnel_shl(self, low: impl crate::Operand<T, W, S>, count: impl Count<T, W, S>) -> Self { let low = crate::Operand::vector(low, crate::Tag::new(self.s)); Count::funnel(count, self, low, true) }
        /// The lower half of `self` and `low`, as a number of twice the size that is shifted to the right by `count` modulo the number of bits of a
        /// lane. With a count of 0 it is `low`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x2::splat(0xab).funnel_shr(u8x2::splat(0xcd), u8x2::from([4, 0])), [0xbc, 0xcd]);
        /// # } example()
        /// ```
        #[doc(alias("vpshrd", "shrd", "fshr"))]
        fn funnel_shr(self, low: impl crate::Operand<T, W, S>, count: impl Count<T, W, S>) -> Self { let low = crate::Operand::vector(low, crate::Tag::new(self.s)); Count::funnel(count, self, low, false) }
        /// The number of bits up to the highest one that is set.
        fn bit_width(self) -> Self { self.like(T::from(T::BITS as u8)) - self.leading_zeros() }
        /// True where one bit is set.
        fn is_power_of_two(self) -> MaskOf<T, W, S> {
            let less = self - T::ONE;
            choose! { X86 => (self & less).simd_eq(T::ZERO) & self.simd_ne(T::ZERO), _ => (self ^ less).simd_gt(less) }
        }
        /// The least power of two that is not less than the lane, or zero if `T` can't hold it.
        #[doc(alias("wrapping_next_power_of_two"))]
        fn next_power_of_two(self) -> Self {
            return_if!(S::SSE41 && !S::AVX512VL && (T::BITS == 32 || T::BITS == 8 && W::BYTES >= 16), {
                let highest = (self - T::ONE).isolate_highest_one();
                highest + highest - self.simd_le(T::ONE).to_simd::<T>()
            });
            let less = self.saturating_sub(T::ONE);
            return_if!(S::A64, self.like(T::MAX).shift_by_sign(self.tag().zero() - less.leading_zeros()) + T::ONE);
            (choose! { Self::COUNTS_AND_SHIFTS => self.like(T::MAX).unbounded_shr(less.leading_zeros()), _ => less.smeared() }) + T::ONE
        }
        /// The quotient, rounded up. Divisors are as for `/`.
        fn div_ceil(self, by: impl Operand<T, W, S>) -> Self {
            let q = self / by;
            q - ((q * by).simd_ne(self) & self.like(by).simd_ne(T::ZERO)).to_simd::<T>()
        }
    }
}

impl<S: Isa, T: Float, W: Width> Simd<T, W, S> {
    /// The reverse of [`to_bits`](Self::to_bits).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(f32x4::from_bits(u32x4::splat(0x3f80_0000)), 1.0);
    /// # } example()
    /// ```
    #[inline(always)]
    pub fn from_bits(bits: Simd<T::Unsigned, W, S>) -> Self {
        bits.bitcast()
    }
    #[op]
    fn or_nan<const MAX: bool>(self, other: Self) -> Self {
        let nan = always!(|| {
            choose! { X86 && T::BITS >= 32 && W::BYTES >= 16 && W::BYTES <= S::REGISTER => crate::mask::Mask::of_floats(self.s, crate::raw::Raw::unordered(self.raw, other.raw)), _ => self.is_nan() | other.is_nan() }.to_simd::<T>()
        });
        choose! {
            (S::A64 || S::WASM) && !Self::SOFT => self.fmax::<MAX>(other),
            // For NaN and for two zeros, these give the second operand.
            X86 && !Self::SOFT && MAX => self.greater(other) & other.greater(self) | nan(),
            X86 && !Self::SOFT => self.lesser(other) | other.lesser(self),
            _ => (if MAX { self.simd_max(other) } else { self.simd_min(other) }) | nan(),
        }
    }

    fns! {
        /// True where the sign bit is set, as in `-0.0`.
        fn is_sign_negative(self) -> MaskOf<T, W, S> { self.to_mask() }
        /// True where the sign bit is not set.
        fn is_sign_positive(self) -> MaskOf<T, W, S> { !self.to_mask() }
        /// The lesser, or NaN if one is NaN. `-0.0` is less than `0.0`. This is faster than [`simd_min`](Self::simd_min) on x86 before `avx512`.
        #[doc(alias("fmin"))]
        fn minimum(self, other: impl Operand<T, W, S>) -> Self { self.or_nan::<false>(self.like(other)) }
        /// The greater, or NaN if one is NaN. `0.0` is greater than `-0.0`.
        #[doc(alias("fmax"))]
        fn maximum(self, other: impl Operand<T, W, S>) -> Self { self.or_nan::<true>(self.like(other)) }
        /// The least number that is greater. Infinity and NaN stay as they are.
        #[doc(alias("nextafter", "nextUp"))]
        fn next_up(self) -> Self {
            let bits = self.cast_signed();
            let bits = bits.simd_eq(T::Signed::MIN).select(T::Signed::ZERO, bits);
            self.simd_le(T::MAX).select((bits + (bits >> (T::BITS - 1) | T::Signed::ONE)).bitcast::<T>(), self)
        }
        /// The greatest number that is less. Negative infinity and NaN stay as they are.
        #[doc(alias("nextDown"))]
        fn next_down(self) -> Self { -(-self).next_up() }
        /// `self.ln() / base.ln()`, as in `std`. `f16` and `bf16` do so in `f32`.
        fn log(self, base: impl Operand<T, W, S>) -> Self {
            let base = self.like(base);
            crate::half::in_f32!(half self, base => |a, b| a.log(b));
            self.ln() / base.ln()
        }
    }
}

/// The classes of ASCII, as for `u8`. Wider lanes are units of UTF-16 or code points.
impl<S: Isa, T: Unsigned, W: Width> Simd<T, W, S> {
    #[op]
    fn from_to(self, first: u8, last: u8) -> MaskOf<T, W, S> {
        self.in_range(T::from(first), T::from(last))
    }
    #[op]
    fn flip_case<const LOWER: bool>(self, of: MaskOf<T, W, S>) -> Self {
        // AVX-512 adds under a mask for all lanes, and has logic only for those of 32 and 64 bits.
        choose! { X86 && S::HAS_MASKED_MEMORY => of.select(if LOWER { self + T::from(0x20) } else { self - T::from(0x20) }, self), _ => self ^ of.select(T::from(0x20), T::ZERO) }
    }

    fns! {
        /// True below 128.
        fn is_ascii(self) -> MaskOf<T, W, S> { choose! { T::BITS == 8 => !self.to_mask(), _ => self.simd_lt(T::from(128)) } }
        /// `A` to `Z` and `a` to `z`.
        fn is_ascii_alphabetic(self) -> MaskOf<T, W, S> { (self | T::from(0x20)).is_ascii_lowercase() }
        /// `A` to `Z`.
        fn is_ascii_uppercase(self) -> MaskOf<T, W, S> { self.from_to(b'A', b'Z') }
        /// `a` to `z`.
        fn is_ascii_lowercase(self) -> MaskOf<T, W, S> { self.from_to(b'a', b'z') }
        /// Letters and digits.
        fn is_ascii_alphanumeric(self) -> MaskOf<T, W, S> { self.is_ascii_alphabetic() | self.is_ascii_digit() }
        /// `0` to `9`.
        fn is_ascii_digit(self) -> MaskOf<T, W, S> { self.from_to(b'0', b'9') }
        /// `0` to `7`.
        fn is_ascii_octdigit(self) -> MaskOf<T, W, S> { (self & !T::from(7)).simd_eq(T::from(b'0')) }
        /// `0` to `9`, `A` to `F` and `a` to `f`.
        fn is_ascii_hexdigit(self) -> MaskOf<T, W, S> { (self | T::from(0x20)).from_to(b'a', b'f') | self.is_ascii_digit() }
        /// What is graphic, but neither a letter nor a digit.
        fn is_ascii_punctuation(self) -> MaskOf<T, W, S> {
            return_if!(T::BITS == 8 && (S::SSSE3 || S::NEON || S::WASM), |this: Self = self| {
                const { crate::text::ByteClasses::new(&[b'!'..=b'/', b':'..=b'@', b'['..=b'`', b'{'..=b'~']) }.contains(this.bitcast()).retype()
            });
            self.is_ascii_alphanumeric() ^ self.is_ascii_graphic()
        }
        /// `!` to `~`.
        fn is_ascii_graphic(self) -> MaskOf<T, W, S> { self.from_to(b'!', b'~') }
        /// Space, tab, line feed, form feed and carriage return.
        fn is_ascii_whitespace(self) -> MaskOf<T, W, S> {
            return_if!(T::BITS == 8 && W::BYTES >= 16 && (S::SSSE3 || S::NEON || S::WASM), |this: Self = self| {
                let v = this.bitcast::<u8>();
                let table = v.tag().dup128([b' ', 0, 0, 0, 0, 0, 0, 0, 0, 9, 10, 0, 12, 13, 0, 0]);
                table.in_blocks().lookup_bytes(v).simd_eq(v).retype()
            });
            self.simd_eq(T::from(b' ')) | self.from_to(9, 13) ^ self.simd_eq(T::from(11))
        }
        /// Below 32, and 127.
        fn is_ascii_control(self) -> MaskOf<T, W, S> { self.simd_lt(T::from(0x20)) | self.simd_eq(T::from(0x7f)) }
        /// With `a` to `z` in place of `A` to `Z`.
        #[doc(alias("make_ascii_lowercase", "tolower"))]
        fn to_ascii_lowercase(self) -> Self { self.flip_case::<true>(self.is_ascii_uppercase()) }
        /// With `A` to `Z` in place of `a` to `z`.
        #[doc(alias("make_ascii_uppercase", "toupper"))]
        fn to_ascii_uppercase(self) -> Self { self.flip_case::<false>(self.is_ascii_lowercase()) }
        /// True where the lanes are equal, or the same letter.
        #[doc(alias("strcasecmp"))]
        fn eq_ignore_ascii_case(self, other: impl Operand<T, W, S>) -> MaskOf<T, W, S> {
            let case = self.like(other).is_ascii_alphabetic().if_then_else_zero(T::from(0x20));
            (self | case).simd_eq(self.like(other) | case)
        }
    }
}
