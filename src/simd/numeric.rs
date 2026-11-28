//! Fused operations, floating-point numbers, bits, cryptography and masks.

use crate::half::in_f32;
use crate::lane::Kind;
use crate::linear::LinearMap;
use crate::multiply::fns;
use crate::raw::RawMask;
use crate::{Float, HasSign, Isa, Lane, MaskOf, Operand, Simd, Tag, Width, X86};

#[rules]
macro_rules! fcma { ($v:ident, $op:ident($($a:ident),+)) => {{
    require!("the vector has too few lanes", Self::LANES >= 2);
    $v.with_bytes(match size_of::<T>() {
        2 => $v.s.${concat($op, _f16)}::<W>($($a.bytes()),+),
        4 => $v.s.${concat($op, _f32)}::<W>($($a.bytes()),+),
        _ => $v.s.${concat($op, _f64)}::<W>($($a.bytes()),+),
    })
}}; }

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    const FCMA: bool = S::FCMA && (!Self::HALF || !Self::SOFT && S::FHM);
    /// `vfmaddcph` takes the real part first.
    const FCMA_RELAXED: bool = Self::FCMA || Self::X86_HALF;
    /// With the sign in a factor, it can leave a loop, and is not in the chain of sums.
    #[on(A64)]
    #[op]
    fn times_i(self) -> Self {
        self.swap_pairs().neg_alternating::<false>()
    }
    pub(crate) const X86_HALF: bool = X86 && Self::HALF && !Self::SOFT;
    const FUSED: bool = S::HAS_FMA && matches!(T::KIND, Kind::Float);

    /// LLVM would turn a fused operation with a factor that it knows into two additions and a blend.
    #[on(X86)]
    #[op]
    fn hidden_one(self) -> Self {
        let (one, two) = (self.tag().set(T::from_usize(1)).bytes(), self.tag().set(T::from_usize(2)).bytes());
        self.with_bytes(choose! {
            S::REGISTER < 64 => self.s.sign_i32::<W>(one, one),
            size_of::<T>() == 4 => self.s.exponent_f32::<W>(two),
            _ => self.s.exponent_f64::<W>(two),
        })
    }
    /// `-self` in the even or in the odd lanes.
    #[op]
    pub(crate) fn neg_alternating<const ODD: bool>(self) -> Self {
        let (d, zero) = (self.tag(), self.tag().zero());
        choose! {
            matches!(T::KIND, Kind::Float) => self ^ if ODD { d.sign_bit().odd_even(zero) } else { zero.odd_even(d.sign_bit()) },
            ODD => (zero - self).odd_even(self),
            _ => self.odd_even(zero - self),
        }
    }
    /// For floating-point lanes. Unlike `-`, it keeps a constant in sight.
    #[op]
    pub(crate) fn negated(self) -> Self {
        return_if!(
            S::A64 && Self::HALF && !Self::SOFT && W::BYTES >= 16,
            self.with_bytes(self.s.neg_f16::<W>(self.bytes()))
        );
        return_if!(
            Self::X86_HALF && crate::OPTIMIZED,
            self.with_bytes(self.s.on_f16::<W>(self.bytes(), self.bytes(), crate::half::Op::Neg))
        );
        self.with(crate::raw::Raw::neg(self.raw))
    }

    fns! {
        /// `self * mul + add`. It rounds once if `has!(fma)`, and twice otherwise. `bf16`, and `f16` without `has!(fp16)` or in more than 64 lanes, do so in
        /// `f32`, and round again. The other signs are written with `-`: with FMA on x86, `a.mul_add_relaxed(b, -c)` and `(-a).mul_add_relaxed(b, c)` are one instruction. A negative constant is best written as one, not as `-V::splat(c)`. `MulAdd`.
        #[doc(alias("MulAdd", "fma", "mul_sub", "neg_mul_add", "neg_mul_sub", "fmadd", "fmsub", "fnmadd", "fnmsub"))]
        fn mul_add_relaxed(self, mul: impl Operand<T, W, S>, add: impl Operand<T, W, S>) -> Self {
            in_f32!(soft self, self.like(mul), self.like(add) => |a, b, c| a.mul_add_relaxed(b, c));
            return_if!(!Self::FUSED, self * mul + add);
            let (mul, add) = (self.like(mul), self.like(add));
            if const { Self::HALF } {
                return self.with_bytes(self.s.fma_f16::<W>(self.bytes(), mul.bytes(), add.bytes()));
            }
            // LLVM doesn't always make vectors of what `crate::float` does lane by lane. In a function that is not inlined into
            // its kernel, it would call the C library.
            return_if!((crate::X86 || S::A64) && (W::BYTES >= 16 || !S::A64), {
                let fma = always!(|| {
                    let (a, b, c) = (self.bytes(), mul.bytes(), add.bytes());
                    self.with_bytes(if const { T::BITS == 32 } { self.s.fma_f32::<W>(a, b, c) } else { self.s.fma_f64::<W>(a, b, c) })
                });
                // Apart, wider ones lose `vfmaddsub`.
                choose! { W::BYTES <= S::REGISTER => apart!(self.s, fma()), _ => fma() }
            });
            self.with(crate::raw::Raw::fma(self.raw, mul.raw, add.raw))
        }
        /// `add - self * mul`. `NegMulAdd`.
        pub(crate) fn neg_mul_add(self, mul: impl Operand<T, W, S>, add: impl Operand<T, W, S>) -> Self {
            choose! { Self::FUSED => self.negated().mul_add_relaxed(mul, add), _ => self.like(add) - self * mul }
        }
        /// `self * mul - sub`. `MulSub`.
        pub(crate) fn mul_sub(self, mul: impl Operand<T, W, S>, sub: impl Operand<T, W, S>) -> Self {
            choose! { Self::FUSED => self.mul_add_relaxed(mul, self.like(sub).negated()), _ => self * mul - sub }
        }
        /// The difference in even lanes and the sum in odd lanes. `AddSub`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x4::splat(10.0).add_sub([1.0, 2.0, 3.0, 4.0]), [9.0, 12.0, 7.0, 14.0]);
        /// # } example()
        /// ```
        fn add_sub(self, other: impl Operand<T, W, S>) -> Self {
            choose! {
                // Not `vfmaddsub` by one, which takes 100 cycles more for subnormal numbers on Intel.
                Self::FUSED && (!X86 || W::BYTES == 64 && S::REGISTER == 64) => self + self.like(other).neg_alternating::<false>(),
                _ => (self + other).odd_even(self - other),
            }
        }
        /// `self * mul - other` in even lanes and `self * mul + other` in odd lanes. `MulAddSub`.
        #[doc(alias("MulAddSub"))]
        fn mul_add_sub_relaxed(self, mul: impl Operand<T, W, S>, other: impl Operand<T, W, S>) -> Self {
            choose! {
                // LLVM does not join these for `f16`.
                X86 && Self::FUSED && !Self::X86_HALF => self.mul_add_relaxed(mul, other).odd_even(self.mul_sub(mul, other)),
                X86 && !Self::X86_HALF => (self * mul).add_sub(other),
                _ => self.mul_add_relaxed(mul, self.like(other).neg_alternating::<false>()),
            }
        }
        /// `self * mul + other` in even lanes and `self * mul - other` in odd lanes. `MulSubAdd`.
        #[doc(alias("MulSubAdd"))]
        fn mul_sub_add_relaxed(self, mul: impl Operand<T, W, S>, other: impl Operand<T, W, S>) -> Self {
            choose! {
                X86 && Self::FUSED && !Self::X86_HALF => self.mul_sub(mul, other).odd_even(self.mul_add_relaxed(mul, other)),
                _ => self.mul_add_relaxed(mul, self.like(other).neg_alternating::<true>()),
            }
        }
    }
}

impl<S: Isa, T: HasSign, W: Width> Simd<T, W, S> {
    /// For floating-point lanes.
    #[op]
    fn magnitude_lt(self, other: Self) -> MaskOf<T, W, S> {
        let (a, b) = (self.abs(), other.abs());
        a.simd_lt(b) | a.simd_eq(b) & self.is_negative()
    }
    fns! {
        /// The one nearer to zero, or else the lesser, also of `-0.0` and `0.0`. If one is NaN, `other`. `MinMagnitude`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let v = i32x2::from([-5, 2]);
        /// assert_eq!((v.min_magnitude(3).to_array(), v.max_magnitude(3).to_array()), ([3, 2], [-5, 3]));
        /// # } example()
        /// ```
        fn min_magnitude(self, other: impl Operand<T, W, S>) -> Self {
            let other = self.like(other);
            return_if!(S::AVX512DQ && T::IS_FLOAT && T::BITS >= 32, self.with_bytes(self.s.magnitude::<W>(other.bytes(), self.bytes(), (T::BITS == 64, false))));
            return_if!(matches!(T::KIND, Kind::Float), self.magnitude_lt(other).if_then_else(self, other));
            let (a, b) = (self.abs().cast_unsigned(), other.abs().cast_unsigned());
            a.simd_lt(b).if_then_else(self, a.simd_eq(b).if_then_else(self.simd_min_relaxed(other), other))
        }
        /// The one farther from zero, or else the greater. If one is NaN, `self`. It takes about seven instructions (two for `f32` and `f64` with AVX-512), and the maximum of the `abs` three. `MaxMagnitude`.
        fn max_magnitude(self, other: impl Operand<T, W, S>) -> Self {
            let other = self.like(other);
            return_if!(S::AVX512DQ && T::IS_FLOAT && T::BITS >= 32, self.with_bytes(self.s.magnitude::<W>(self.bytes(), other.bytes(), (T::BITS == 64, true))));
            return_if!(matches!(T::KIND, Kind::Float), self.magnitude_lt(other).if_then_else(other, self));
            let (a, b) = (self.abs().cast_unsigned(), other.abs().cast_unsigned());
            a.simd_lt(b).if_then_else(other, a.simd_eq(b).if_then_else(self.simd_max_relaxed(other), self))
        }
    }
}

impl<S: Isa, T: Float, W: Width> Simd<T, W, S> {
    const FRACTION: u32 = T::FRACTION;
    const BIAS: usize = (1 << (T::BITS - Self::FRACTION - 2)) - 1;

    #[op]
    fn scale(self, by: Self) -> Self {
        let (v, by) = (self.bytes(), by.bytes());
        self.with_bytes(if const { size_of::<T>() == 2 } {
            self.s.scale_f16::<W>(v, by)
        } else if const { size_of::<T>() == 4 } {
            self.s.scale_f32::<W>(v, by)
        } else {
            self.s.scale_f64::<W>(v, by)
        })
    }

    fns! {
        /// The bits of the exponent. `GetBiasedExponent`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x2::from([1.0, -4.0]).biased_exponent(), [127, 129]);
        /// # } example()
        /// ```
        #[doc(alias("get_biased_exponent", "GetBiasedExponent"))]
        fn biased_exponent(self) -> Simd<T::Unsigned, W, S> { self.abs().cast_unsigned() >> Self::FRACTION }
        /// `floor(log2(|self|))`. The result is unspecified unless `self` is normal. `GetExponent`.
        #[doc(alias("get_exponent", "GetExponent"))]
        fn exponent_relaxed(self) -> Self {
            if_here!(Self::X86_HALF, { return self.with_bytes(self.s.exponent_f16::<W>(self.bytes())); });
            return_if!(Self::HALF && !Self::SOFT, Self::of_small(self.biased_exponent().bitcast::<i16>() - Self::BIAS as i16));
            in_f32!(half self => |x| x.exponent_relaxed());
            choose! {
                const { S::AVX512VL } && size_of::<T>() == 4 => self.with_bytes(self.s.exponent_f32::<W>(self.bytes())),
                const { S::AVX512VL } => self.with_bytes(self.s.exponent_f64::<W>(self.bytes())),
                // 2^52 plus the exponent: there is no conversion.
                X86 && size_of::<T>() == 8 => {
                    let big = self.tag().set(T::from_usize(1 << 26)) * T::from_usize(1 << 26);
                    (self.biased_exponent().bitcast() | big) - (big + T::from_usize(Self::BIAS))
                },
                _ => self.tag().convert_to(self.biased_exponent().bitcast::<T::Signed>() - T::Signed::from_usize(Self::BIAS)),
            }
        }
        /// `self * 2^exponent`, like `ldexp`. `MulByPow2`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x2::from([1.5, 8.0]).ldexp([2, -1]), [6.0, 4.0]);
        /// # } example()
        /// ```
        #[doc(alias("mul_by_pow2", "MulByPow2"))]
        fn ldexp(self, exponent: impl Operand<T::Signed, W, S>) -> Self { apart_unoptimized!(self.s, {
            let d = self.tag().to_signed();
            let n = exponent.vector(d);
            return_if!(Self::X86_HALF, self.scale(self.tag().convert(n)));
            // The bits of 1024 plus the biased exponent of the factor. 60 takes the greatest number to zero, and the least to infinity.
            in_f32!(@ Self::HALF && T::FRACTION == 10, false, self, (n.simd_clamp(T::Signed::from_i64(-60), T::Signed::from_i64(60)) + T::Signed::from_i64(0x6400 + 127)).bitcast() =>
                |x, a| x * (a.cast_unsigned() << 10).bitcast::<f32>());
            // In two parts, which `bf16` can hold.
            let part = always!(|more| self.tag().convert((n.simd_clamp(T::Signed::from_i64(-300), T::Signed::from_i64(300)) + T::Signed::from_i64(more)) >> 1));
            in_f32!(half self, part(0), part(1) => |x, a, b| x.ldexp(x.tag().to_signed().convert_in_range_to(a + b)));
            return_if!(S::AVX512VL, self.scale(self.tag().convert_to(n)));
            return_if!(S::SVE2, self.scale(n.bitcast()));
            // `self * 2^a * 2^a * 2^c`, with normal factors. `a` is half of what `n` is outside of `5 - BIAS..BIAS`, rounded
            // down, and `c = n - 2 * a`. If `a < 0`, then `c <= 6 - BIAS`: where one of the first products is subnormal
            // and rounds, the result is zero anyway. If `a > 0`, they are exact, or overflow like the result.
            let (bias, half) = (Self::BIAS as i64, Self::FRACTION - 1);
            let k = |value: i64| d.set(T::Signed::from_i64(value));
            // This takes the greatest number to zero, and the least to infinity.
            let limit = 2 * bias + Self::FRACTION as i64 + 1;
            // Numbers are shifted to one bit below the exponent, which halves them and leaves the lowest 16 bits zero:
            // the order of the lanes is that of their highest 16 bits, for which every target has instructions.
            let u = (n.simd_max(k(-limit)).simd_min(k(limit)) - k(bias + 4)) << half;
            let (narrow, low, high) = (u.bitcast::<i16>(), k((1 - 2 * bias) << half), k(-5 << half));
            // With the median of the three, these two add up to `u + low + high`. So this is `n` less the clamped `n`, plus
            // `low + high`, which is `2 * BIAS` up to the sign bit. The mask drops that, and the half.
            let outside = narrow.simd_min(low.bitcast::<i16>()).bitcast::<T::Signed>() + narrow.simd_max(high.bitcast::<i16>()).bitcast::<T::Signed>();
            let first = outside & k((2 * bias + 1) << Self::FRACTION);
            // `n - BIAS - 4 - 2 * (a + BIAS)` is `c + BIAS` up to the sign bit, which the doubling drops.
            let last = u - first;
            let first = first.bitcast::<T>();
            self * first * first * (last + last).bitcast::<T>()
        }) }
        /// [`ldexp`](Self::ldexp), but unspecified unless `2^exponent` is a normal number. Without AVX-512 and SVE it takes three instructions for sixteen.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f64x2::from([1.5, 8.0]).ldexp_relaxed([2, -1022]), [6.0, 8.0 * f64::MIN_POSITIVE]);
        /// # } example()
        /// ```
        #[doc(alias("scalbn", "scale_by_power_of_two"))]
        fn ldexp_relaxed(self, exponent: impl Operand<T::Signed, W, S>) -> Self {
            let n = exponent.vector(self.tag().to_signed());
            return_if!(S::AVX512VL && (!Self::HALF || Self::X86_HALF), self.ldexp(n));
            return_if!(S::SVE2 && !Self::HALF, self.ldexp(n));
            self * ((n + T::Signed::from_usize(Self::BIAS)) << Self::FRACTION).bitcast::<T>()
        }
        /// `self * 2^floor(exponent)`. It is unspecified whether the result is NaN for NaN and an infinite exponent.
        /// `MulByFloorPow2`.
        pub(crate) fn mul_by_floor_pow2(self, exponent: impl Operand<T, W, S>) -> Self {
            let exponent = self.like(exponent);
            return_if!(S::AVX512VL, self.scale(exponent));
            let limit = self.tag().set(T::from_usize(1 << 14));
            let finite = self.ldexp(self.tag().to_signed().convert_to(exponent.floor().simd_clamp_relaxed(-limit, limit)));
            exponent.is_finite().if_then_else(finite, self * exponent.simd_lt(T::default()).if_then_zero_else(exponent))
        }
        /// Negates the odd lanes, which are the imaginary parts of the even ones. `ComplexConj`.
        fn complex_conj(self) -> Self { self.neg_alternating::<true>() }
        /// [`complex_mul`](Self::complex_mul), which is faster. How it rounds depends on the target.
        #[doc(alias("mul_complex", "MulComplex"))]
        fn complex_mul_relaxed(self, other: impl crate::Operand<T, W, S>) -> Self {
            let other = crate::Operand::vector(other, crate::Tag::new(self.s));
            return_if!(Self::FCMA_RELAXED, self.complex_mul_add_relaxed(other, self.tag().sign_bit()));
            halves_if!(W::BYTES > S::REGISTER && S::REGISTER == 64, |this: Self = self, other: Self = other| {
                let ((a0, a1), (b0, b1)) = (this.registers(), other.registers());
                this.tag().combine(a1.complex_mul_relaxed(b1), a0.complex_mul_relaxed(b0))
            });
            return_if!(S::A64, self.dup_even().mul_add_relaxed(other, self.dup_odd() * other.times_i()));
            self.dup_even().mul_add_sub_relaxed(other, self.dup_odd() * other.swap_pairs())
        }
        /// The product of complex numbers, whose real parts are in the even lanes: `self.complex_mul_add(other, -0.0)`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// // (1 + 2i)(3 + 4i) and (0 + 1i)(0 + 1i)
        /// assert_eq!(f32x4::from([1.0, 2.0, 0.0, 1.0]).complex_mul([3.0, 4.0, 0.0, 1.0]), [-5.0, 10.0, -1.0, 0.0]);
        /// # } example()
        /// ```
        fn complex_mul(self, other: impl Operand<T, W, S>) -> Self { self.complex_mul_add(other, self.tag().sign_bit()) }
        /// By the conjugate of `other`.
        fn complex_mul_conj(self, other: impl Operand<T, W, S>) -> Self { self.complex_mul_conj_add(other, self.tag().sign_bit()) }
        /// `self * other + add`. Each part takes two fused steps, with the imaginary part of `self` first.
        fn complex_mul_add(self, other: impl Operand<T, W, S>, add: impl Operand<T, W, S>) -> Self {
            let (other, add) = (self.like(other), self.like(add));
            return_if!(Self::FCMA, fcma!(self, complex_mul_add(self, other, add)));
            self.dup_even().mul_add(other, self.dup_odd().neg_alternating::<false>().mul_add(other.swap_pairs(), add))
        }
        /// By the conjugate of `other`, with its imaginary part first.
        fn complex_mul_conj_add(self, other: impl Operand<T, W, S>, add: impl Operand<T, W, S>) -> Self {
            let (other, add) = (self.like(other), self.like(add));
            return_if!(Self::FCMA, fcma!(self, conjugate_mul_add(other, self, add)));
            self.mul_add(other.dup_even(), self.swap_pairs().mul_add(other.dup_odd().complex_conj(), add))
        }
        /// `self + i * other`, for complex numbers.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x2::from([1.0, 2.0]).add_times_i(f32x2::from([10.0, 20.0])), [-19.0, 12.0]);
        /// # } example()
        /// ```
        fn add_times_i(self, other: impl crate::Operand<T, W, S>) -> Self {
            let other = crate::Operand::vector(other, crate::Tag::new(self.s));
            return_if!(Self::FCMA, fcma!(self, add_times_i(self, other)));
            self.add_sub(other.swap_pairs())
        }
        /// `self - i * other`, for complex numbers.
        fn sub_times_i(self, other: impl crate::Operand<T, W, S>) -> Self {
            let other = crate::Operand::vector(other, crate::Tag::new(self.s));
            choose! {
                Self::FCMA => fcma!(self, sub_times_i(self, other)),
                X86 && Self::FUSED && !Self::HALF => self.mul_sub_add_relaxed(self.hidden_one(), other.swap_pairs()),
                X86 => self + other.swap_pairs().complex_conj(),
                _ => self - other.swap_pairs().neg_alternating::<false>(),
            }
        }
        /// [`complex_mul_conj`](Self::complex_mul_conj), by the conjugate of `other`, but faster. How it rounds depends on the target.
        #[doc(alias("mul_complex_conj", "MulComplexConj"))]
        fn complex_mul_conj_relaxed(self, other: impl crate::Operand<T, W, S>) -> Self {
            let other = crate::Operand::vector(other, crate::Tag::new(self.s));
            return_if!(Self::FCMA_RELAXED, self.complex_mul_conj_add_relaxed(other, self.tag().sign_bit()));
            return_if!(S::A64, self.mul_add_relaxed(other.dup_even(), self.swap_pairs().complex_conj() * other.dup_odd()));
            self.mul_sub_add_relaxed(other.dup_even(), self.swap_pairs() * other.dup_odd())
        }
        /// [`complex_mul_add`](Self::complex_mul_add), which is faster. How it rounds depends on the target.
        #[doc(alias("mul_complex_add", "MulComplexAdd"))]
        fn complex_mul_add_relaxed(self, other: impl crate::Operand<T, W, S>, add: impl crate::Operand<T, W, S>) -> Self {
            let other = crate::Operand::vector(other, crate::Tag::new(self.s));
            let add = crate::Operand::vector(add, crate::Tag::new(self.s));
            return_if!(Self::FCMA_RELAXED, fcma!(self, complex_mul_add(self, other, add)));
            return_if!(S::A64, self.dup_even().mul_add_relaxed(other, self.dup_odd().mul_add_relaxed(other.times_i(), add)));
            self.dup_even().mul_add_sub_relaxed(other, self.dup_odd().mul_add_sub_relaxed(other.swap_pairs(), add))
        }
        /// [`complex_mul_conj_add`](Self::complex_mul_conj_add), by the conjugate of `other`, but faster. How it rounds depends on the target.
        #[doc(alias("mul_complex_conj_add", "MulComplexConjAdd"))]
        fn complex_mul_conj_add_relaxed(self, other: impl crate::Operand<T, W, S>, add: impl crate::Operand<T, W, S>) -> Self {
            let other = crate::Operand::vector(other, crate::Tag::new(self.s));
            let add = crate::Operand::vector(add, crate::Tag::new(self.s));
            return_if!(Self::FCMA_RELAXED, fcma!(self, conjugate_mul_add(other, self, add)));
            return_if!(S::A64, self.mul_add_relaxed(other.dup_even(), self.swap_pairs().complex_conj().mul_add_relaxed(other.dup_odd(), add)));
            self.mul_sub_add_relaxed(other.dup_even(), self.swap_pairs().mul_sub_add_relaxed(other.dup_odd(), add))
        }
        /// About `1 / self`, within 1%. It is unspecified unless `self` and all within 1% of the result are normal numbers. `ApproximateReciprocal`.
        ///
        /// An `f32` has 14 bits that are right in registers of 64 bytes, 11 otherwise on x86 and 8 on Arm. Each step of `y * (2 - x * y)` doubles them.
        /// With steps it beat `/` only with AVX-512 on Intel, and lost on Neoverse V2 and N3.
        #[doc(alias("approximate_reciprocal", "ApproximateReciprocal"))]
        fn recip_relaxed(self) -> Self {
            if const { Self::HALF && !Self::SOFT && (X86 || S::A64) } { return self.with_bytes(self.s.approximate_reciprocal_f16::<W>(self.bytes())); }
            in_f32!(half self => |x| x.recip_relaxed());
            let v = self.bytes();
            self.with_bytes(if const { size_of::<T>() == 4 } { self.s.approximate_reciprocal::<W>(v) } else { self.s.approximate_reciprocal_f64::<W>(v) })
        }
        /// About `1 / sqrt(self)`, within 1%. It is unspecified unless `self` is normal and positive. `ApproximateReciprocalSqrt`.
        ///
        /// An `f32` has 14 bits that are right in registers of 64 bytes, 11 otherwise on x86 and 8 on Arm. Each step about doubles them.
        /// Alone in a loop, two steps with FMA took 0.2 to 0.9 of the time of `sqrt().recip()`, but 1.3 on an Apple M4. Among other work they won only with AVX-512, and took 1.2 to 1.7 times as long on Neoverse.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let x = f32x4::from([1.0, 2.0, 0.3, 1e9]);
        /// let step = |y: f32x4<S>| y * (x * y * -0.5).mul_add_relaxed(y, 1.5);
        /// let y = if has!(sse2) { step(x.recip_sqrt_relaxed()) } else { x.sqrt().recip() };
        /// assert!((y * x.sqrt() - 1.0).abs().simd_lt(1e-6).all());
        /// # } example()
        /// ```
        #[doc(alias("approximate_reciprocal_sqrt", "ApproximateReciprocalSqrt", "rsqrt"))]
        fn recip_sqrt_relaxed(self) -> Self {
            if const { Self::HALF && !Self::SOFT && (X86 || S::A64) } { return self.with_bytes(self.s.approximate_reciprocal_sqrt_f16::<W>(self.bytes())); }
            in_f32!(half self => |x| x.recip_sqrt_relaxed());
            return_if!(S::SSE41 && size_of::<T>() == 8 && !S::AVX512VL, {
                // Halves and negates the exponent. The product with the root is then in 0.866..0.919, which a cubic takes to 1 within
                // 0.07%: see tools/reciprocal_root.py.
                let (x, y) = (self.bitcast::<f64>(), ((0x5fe4u64 << 48) - (self.bitcast::<u64>() >> 1)).bitcast::<f64>());
                (y * (x * -0.70395 * y).mul_add_relaxed(y, 1.68191)).bitcast()
            });
            let v = self.bytes();
            self.with_bytes(if const { size_of::<T>() == 4 } {
                self.s.approximate_reciprocal_sqrt::<W>(v)
            } else {
                self.s.approximate_reciprocal_sqrt_f64::<W>(v)
            })
        }
    }
}

// Each block is a key in the upper lane and a value in the lower one. Both lanes of a mask are the same.
impl<S: Isa, W: Width> Simd<u64, W, S> {
    fns! {
        /// `Lt128Upper`.
        pub(crate) fn lt128_upper(self, other: Self) -> MaskOf<u64, W, S> {
            choose! { S::REGISTER == 64 => self.dup_odd().simd_lt(other.dup_odd()), _ => self.simd_lt(other).to_vector().dup_odd().moved_mask() }
        }
        /// `Eq128Upper`.
        pub(crate) fn eq128_upper(self, other: Self) -> MaskOf<u64, W, S> { self.simd_eq(other).into_vector().dup_odd().moved_mask() }
        /// `Min128Upper`.
        pub(crate) fn min128_upper(self, other: Self) -> Self { self.lt128_upper(other).if_then_else(self, other) }
        /// `Max128Upper`.
        pub(crate) fn max128_upper(self, other: Self) -> Self { other.lt128_upper(self).if_then_else(self, other) }
        /// Byte `j` of each lane is the lowest byte of the lane rotated right by byte `j` of `counts`, modulo 64.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let nibbles = u64x1::splat(0x8765_4321).rotate_bytes_from(u8x8::iota(0) * 4).bitcast::<u8>() & 15;
        /// assert_eq!(nibbles, [1, 2, 3, 4, 5, 6, 7, 8]);
        /// # } example()
        /// ```
        #[doc(alias("MultiRotateRight", "vpmultishiftqb"))]
        fn rotate_bytes_from(self, counts: impl crate::Operand<u8, W, S>) -> Self {
            let counts = crate::Operand::vector(counts, crate::Tag::new(self.s));
            if_here!(S::AVX512VBMI, {
                return self.with_bytes(self.s.multi_shift::<W>(self.bytes(), counts.bytes()));
            });
            return_if!(S::SCALAR, {
                let (lanes, by) = (self.to_array(), counts.to_array());
                counts.tag().from_fn(#[inline(always)] |i| lanes.as_ref()[i / 8].rotate_right(by.as_ref()[i] as u32) as u8).bitcast()
            });
            let (d, byte, bit) = (counts.tag(), counts >> 3, counts & 7);
            let lane = d.iota(0) & 8;
            let (low, high) = (byte & 7 | lane, (byte + 1) & 7 | lane);
            return_if!(!crate::X86, {
                let (low, high) = (self.table_lookup_bytes(low), self.table_lookup_bytes(high));
                (low >> bit | (high + high) << (bit ^ 7)).bitcast()
            });
            let factor = d.dup128([128, 64, 32, 16, 8, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0]).table_lookup_bytes(bit).bitcast::<u16>();
            let even = self.table_lookup_bytes(low.interleave_even(high)).bitcast::<u16>() * (factor & 0xff);
            let odd = self.table_lookup_bytes(low.interleave_odd(high)).bitcast::<u16>() * (factor >> 8);
            (odd + odd).bitcast::<u8>().odd_even((even >> 7).bitcast()).bitcast()
        }
    }
}

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// In each block: the substituted words 1 and 3, and these rotated and with `RCON`, as on x86. `AESKeyGenAssist`.
    #[op]
    #[track_caller]
    pub fn aes_key_gen_assist<const RCON: u8>(self) -> Self {
        let d = self.tag();
        // The order of the result, through the inverse of the shift of the rows.
        let order = d.dup128([4, 14, 14, 4, 5, 5, 15, 15, 12, 6, 6, 12, 13, 13, 7, 7]);
        let moved = if const { S::LOOKS_UP_IN_REGISTERS || S::BY_HAND } {
            self.table_lookup_bytes(order)
        } else {
            self.aes_key_order()
        };
        moved.aes_last_round(d.dup128([0, 0, 0, 0, RCON, 0, 0, 0, 0, 0, 0, 0, RCON, 0, 0, 0]))
    }
    fns! {
        /// The same. The lookup would be a loop with branches, if that isn't unrolled.
        pub(crate) fn aes_key_order(self) -> Self { self.with_bytes(self.s.aes_key_order::<W>(self.bytes())) }
        /// The product in GF(2^8), modulo the polynomial of AES. For another one, see [`galois_matrix`](crate::math::galois_matrix).
        ///
        /// Unless `has!(gfni)`, it is two lookups if `other` is a number that doesn't change in the loop. A vector takes 10 instructions on Arm, and 40 to 80 on x86.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x16::splat(0x57).galois_mul(0x83), [0xc1; 16]);
        /// # } example()
        /// ```
        #[doc(alias("gf2p8mulb"))]
        fn galois_mul(self, other: impl Operand<u8, W, S>) -> Self {
            if const { !S::GFNI } && let Some(factor) = Operand::number(other) {
                return LinearMap::by_columns(self, crate::linear::powers(factor, 0x1b));
            }
            // Small factors take fewer steps bit by bit.
            if_here!(S::AVX2 && !S::GFNI && matches!(W::BYTES, 16..=64), if !are_known!((self & 0xc0).raw) && !are_known!((self.like(other) & 0xc0).raw) {
                return live!(S::AVX2 && !S::GFNI && matches!(W::BYTES, 16..=64), crate::linear::product(self, self.like(other)));
            });
            self.with_bytes(self.s.galois_mul::<W>(self.bytes(), self.like(other).bytes()))
        }
        /// Bit `i` of each byte is the parity of the byte and byte `7 - i` of the 64-bit lane of `matrix` that it is in,
        /// as in `gf2p8affineqb`.
        ///
        /// Unless `has!(gfni)`, it is two lookups if `matrix` is a number that doesn't change in the loop, and 45 to 110 instructions if it is a
        /// vector. [`LinearMap`] has one function for each block.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let reverse_bits = 0x8040_2010_0804_0201;
        /// assert_eq!(u8x16::splat(0b0000_0011).galois_affine(reverse_bits), [0b1100_0000; 16]);
        /// # } example()
        /// ```
        #[doc(alias("gf2p8affineqb", "transpose_bits"))]
        fn galois_affine(self, matrix: impl Operand<u64, W, S>) -> Self { apart_unoptimized!(self.s, {
            return_if!(W::BYTES < 8, LinearMap::by_columns(self, crate::linear::transposed(Operand::alone(matrix, self.s).swap_bytes())));
            if const { !S::GFNI } && let Some(rows) = Operand::number(matrix) {
                return live!(!S::GFNI, LinearMap::by_columns(self, crate::linear::transposed(rows.swap_bytes())));
            }
            let matrix = matrix.vector(Tag::new(self.s));
            if_here!(S::GFNI, {
                return self.with_bytes(self.s.galois_affine::<W>(self.bytes(), matrix.bytes()));
            });
            let (lane, mut result) = (self.tag().iota(0) & 8, self.tag().zero());
            macro_rules! bit { ($($i:literal)*) => {$(
                result = result + result | (self & matrix.table_lookup_bytes(lane + $i)).count_ones() & 1;
            )*}; }
            bit!(0 1 2 3 4 5 6 7);
            result
        }) }
    }
}

impl<S: Isa, W: Width> Simd<u8, W, S> {
    fns! {
        /// [`galois_affine`](Self::galois_affine) of the inverses, where zero is its own.
        #[doc(alias("gf2p8affineinvqb"))]
        fn galois_affine_inverse(self, matrix: impl Operand<u64, W, S>) -> Self {
            return_if!(W::BYTES < 8, self.tag().resize_bitcast(self.s.fixed::<u8, crate::B8>().resize_bitcast(self).galois_affine_inverse(Operand::alone(matrix, self.s))));
            if_here!(S::GFNI, {
                return self.with_bytes(self.s.galois_affine_inverse::<W>(self.bytes(), matrix.vector(Tag::new(self.s)).bytes()));
            });
            return_if!(W::BYTES < 16, {
                let d = self.s.fixed::<u8, crate::B16>();
                let all = d.resize_bitcast(self).inverse();
                self.tag().resize_bitcast(all).galois_affine(matrix)
            });
            self.inverse().galois_affine(matrix)
        }
    }
}

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// The S-box of AES is the inverse and an affine map, which this undoes.
    #[inline(always)]
    fn inverse(self) -> Self {
        apart_unoptimized!(self.s, {
            let unshifted =
                self.table_lookup_bytes(self.tag().dup128([0, 13, 10, 7, 4, 1, 14, 11, 8, 5, 2, 15, 12, 9, 6, 3]));
            let mapped = unshifted.aes_last_round(0x63);
            mapped.rotate_left(1) ^ mapped.rotate_left(3) ^ mapped.rotate_left(6)
        })
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    fns! {
        /// The same in all lanes. `SetMask`.
        fn set_mask(self, value: bool) -> MaskOf<T, W, S> {
            return_if!(X86 && MaskOf::<T, W, S>::BOTH, crate::mask::Mask::new(self.simd(), RawMask::splat(value)).also(self.repartition::<i32>().set(-(value as i32)), false, true));
            return_if!(MaskOf::<T, W, S>::IS_BITS || W::BYTES < 4, crate::mask::Mask::new(self.simd(), RawMask::splat(value)));
            crate::mask::Mask::from_full(self.repartition::<i32>().set(-(value as i32)))
        }
    }
}

impl<S: Isa, T: crate::Signed, W: Width> crate::mask::Mask<T, W, S> {
    fns! {
        /// The result is unspecified if all are false. `FindKnownFirstTrue`.
        #[doc(alias("FindKnownFirstTrue"))]
        fn first_set_relaxed(self) -> usize { apart_unoptimized!(self.s, {
            return_if!(Self::LANES > 64, self.count_before_first());
            let (bits, per_lane) = self.wide_bits();
            // The same for no lane in both ways.
            return_if!(Self::BOTH && T::BITS == 16, ((bits as u32 | (2 - per_lane) << 16).trailing_zeros() / per_lane) as usize);
            (bits.trailing_zeros() / per_lane) as usize
        }) }
        /// The result is unspecified if all are false. `FindKnownLastTrue`.
        #[doc(alias("FindKnownLastTrue"))]
        fn last_set_relaxed(self) -> usize { apart_unoptimized!(self.s, {
            return_if!(Self::LANES > 64, self.last_set().unwrap_or(0));
            let (bits, per_lane) = self.wide_bits();
            // After a test for any, or with an exclusive or, it would become `bsr`, which is slow before Zen 4.
            let bits = choose! { X86 && !S::LZCNT => bits | 1, X86 && !S::AVX512F => crate::regs::number(bits), _ => bits };
            return_if!(Self::BOTH && T::BITS == 16, ((63 - bits.leading_zeros() as i32) >> (per_lane - 1)) as u32 as usize);
            (63u32.wrapping_sub(bits.leading_zeros()) / per_lane) as usize
        }) }
    }
}
