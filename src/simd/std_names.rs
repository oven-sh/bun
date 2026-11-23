//! What `std::simd` and the scalar types have, and is made of other operations.

use crate::multiply::fns;
use crate::raw::Raw;
use crate::{Float, HasSign, Int, Isa, Lane, MaskOf, Simd, Width};

impl<S: Isa, T: Float, W: Width> Simd<T, W, S> {
    /// SSE2 can't round, and LLVM would call a function for each lane.
    pub(crate) const ROUNDS_BY_SUM: bool = crate::X86 && cfg!(target_feature = "sse2") && !cfg!(target_feature = "sse4.1") && !S::SSE41
            // Nor can `core`. LLVM makes vectors of this.
            || crate::simd::ARRAYS
                && cfg!(any(target_feature = "lsx", all(target_arch = "powerpc64", target_endian = "little")));

    /// `fix` gets the nearest integer, without the sign if `ABS`, and what that is nearest to.
    #[op]
    pub(crate) fn round_by_sum<const ABS: bool>(self, fix: impl Fn(Self, Self) -> Self) -> Self {
        let (abs, sign) = (self.abs(), self & self.tag().sign_bit());
        let big = T::from_f64(if const { T::BITS == 32 } { 8388608.0 } else { 4503599627370496.0 });
        let nearest = abs + big - big;
        let fixed = if ABS { fix(nearest, abs) } else { fix(nearest | sign, self) };
        abs.simd_lt(big).select(fixed | sign, self)
    }
    pub(crate) const ROUNDS_BY_CAST: bool = S::SSE2 && T::BITS == 32;
    /// What is too large for `i32` is an integer, or NaN.
    #[op]
    pub(crate) fn round_by_cast<const NEAREST: bool>(self) -> Self {
        let v = self.bitcast::<i32>();
        let int = v.with_bytes::<i32>(if NEAREST {
            v.s.nearest_f32_i32::<W>(v.bytes())
        } else {
            v.s.truncate_f32_i32::<W>(v.bytes())
        });
        let large = int.simd_eq(i32::MIN).to_vector();
        (v & (large | i32::MIN) | large.and_not(int.cast::<f32>().bitcast())).bitcast()
    }
    #[op]
    pub(crate) fn least_normal() -> T {
        T::of_unsigned(&[Lane::from_u64(1 << T::FRACTION)])[0]
    }

    fns! {
        /// Ties go away from zero. [`round_ties_even`](Self::round_ties_even) is faster on x86.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let v = f32x4::from([0.5, 1.5, 2.5, -0.5]);
        /// assert_eq!(v.round(), [1.0, 2.0, 3.0, -1.0]);
        /// assert_eq!(v.round_ties_even(), [0.0, 2.0, 2.0, -0.0]);
        /// # } example()
        /// ```
        fn round(self) -> Self {
            return_if!(S::A64 && !Self::SOFT, self.with(self.raw.round()));
            crate::half::in_f32!(@ Self::SOFT, false, self => |x| x.stays_wide().round());
            return_if!(cfg!(all(target_arch = "x86", not(target_feature = "sse2"))) && T::BITS == 64, self.with(self.raw.round()));
            let below_half = T::from_f64(choose! { T::BITS == 16 => 0.499755859375, T::BITS == 32 => 0.5f32.next_down() as f64, _ => 0.5f64.next_down() });
            (self + (self & self.tag().sign_bit() | below_half)).trunc()
        }
        /// `self - self.trunc()`.
        fn fract(self) -> Self { self - self.trunc() }
        /// True where the lane is neither zero, subnormal, infinite nor NaN.
        fn is_normal(self) -> MaskOf<T, W, S> {
            return_if!(S::AVX512DQ && !Self::SOFT, !self.class(core::num::FpCategory::Normal));
            // The highest exponent wraps.
            return_if!(Self::HALF, crate::raw::same((self.abs().bitcast::<i16>() + (1 << T::FRACTION)).simd_gt((2 << T::FRACTION) - 1)));
            self.like(Self::least_normal()).abs_le(self) & self.is_finite()
        }
        /// True where the lane is nearer to zero than all normal numbers, but not zero.
        fn is_subnormal(self) -> MaskOf<T, W, S> {
            return_if!(S::AVX512DQ && !Self::SOFT, self.class(core::num::FpCategory::Subnormal));
            // All but zero wrap.
            return_if!(Self::HALF, crate::raw::same((self.abs().bitcast::<i16>() + i16::MAX).simd_lt(i16::MIN + (1 << T::FRACTION) - 1)));
            self.abs().simd_lt(Self::least_normal()) & self.simd_ne(T::ZERO)
        }
        /// From radians, as in `std`.
        fn to_degrees(self) -> Self { self * T::from_f64(choose! { T::BITS == 32 => 1f32.to_degrees() as f64, _ => 1f64.to_degrees() }) }
        /// From degrees, as in `std`.
        fn to_radians(self) -> Self { self * T::from_f64(choose! { T::BITS == 32 => 1f32.to_radians() as f64, _ => 1f64.to_radians() }) }
    }
}

impl<S: Isa, T: HasSign, W: Width> Simd<T, W, S> {
    fns! {
        /// -1, 0 or 1 for integers. For floating-point numbers it is 1 with the sign of the lane, or NaN.
        /// On x86 from `sse4` on, it is one instruction below 64 bits, and two for 64 bytes with AVX-512. `a.saturating_sub(b).signum()` compares signed integers.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(i8x4::from([-5, 0, 9, i8::MIN]).signum(), [-1, 0, 1, -1]);
        /// # } example()
        /// ```
        #[doc(alias("sign", "sgn", "psign", "cmp"))]
        fn signum(self) -> Self {
            return_if!(T::IS_FLOAT, self.simd_eq(self).select(self & self.tag().sign_bit() | T::ONE, self));
            return_if!(T::BITS == 64 && !S::AVX512VL || T::BITS != 16 && !S::SSE41 && crate::X86, self.is_negative().to_simd::<T>() - self.simd_gt(T::ZERO).to_simd::<T>());
            let above = self.simd_max(T::from_i64(-1));
            return_if!(S::A64, above.tag().opaque(above.raw).simd_min(T::ONE));
            return_if!(crate::X86 && S::PSIGN && T::BITS < 64 && (W::BYTES < 64 || S::REGISTER < 64), {
                // LLVM doesn't evaluate it for constants.
                let sign = self.cast_signed().if_negative_then_neg_or_undef_if_zero(self.tag().set(T::ONE).cast_signed()).bitcast();
                core::hint::select_unpredictable(are_known!(self.raw), above.simd_min(T::ONE), sign)
            });
            halves_if!(crate::X86 && S::AVX512VL && W::BYTES > S::REGISTER, |v: Self = self| v.tag().combine(v.upper_half().signum(), v.lower_half().signum()));
            // LLVM would make two comparisons and two moves from masks.
            return_if!(crate::X86 && (S::AVX512VL || S::SSE2 && T::BITS == 16), above.barrier_unless_known().simd_min(T::ONE));
            above.simd_min(T::ONE)
        }
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    fns! {
        /// The number of bits that are not set.
        fn count_zeros(self) -> Self { (!self).count_ones() }
        /// The number of ones above the highest bit that is not set.
        fn leading_ones(self) -> Self { (!self).leading_zeros() }
        /// The number of ones below the lowest bit that is not set.
        fn trailing_ones(self) -> Self { (!self).trailing_zeros() }
    }
}

impl<S: Isa, T: Lane, W: Width> Default for Simd<T, W, S>
where
    crate::Code: crate::At<S>,
{
    #[inline(always)]
    fn default() -> Self {
        Self::zero()
    }
}
impl<S: Isa, T: crate::Signed, W: Width> Default for crate::Mask<T, W, S>
where
    crate::Code: crate::At<S>,
{
    #[inline(always)]
    fn default() -> Self {
        Self::splat(false)
    }
}
macro_rules! folds { ($($trait:ident $name:ident $none:expr, $op:tt;)*) => {$(
    impl<S: Isa, T: Lane, W: Width, V: core::borrow::Borrow<Self>> core::iter::$trait<V> for Simd<T, W, S> {
        #[op]
        fn $name<I: Iterator<Item = V>>(all: I) -> Self {
            let mut result = $none;
            for v in all {
                result $op *v.borrow();
            }
            result
        }
    }
)*}; }
folds! {
    Sum sum if T::IS_FLOAT { Self::sign_bit() } else { Self::zero() }, +=;
    Product product Self::splat(T::ONE), *=;
}
impl<S: Isa, T: Lane, W: Width> AsRef<[T]> for Simd<T, W, S> {
    #[op]
    fn as_ref(&self) -> &[T] {
        on_arch!(Self::all_handed, self).raw.lanes()
    }
}
impl<S: Isa, T: Lane, W: Width> AsMut<[T]> for Simd<T, W, S> {
    #[op]
    fn as_mut(&mut self) -> &mut [T] {
        on_arch!(Self::all_handed, self).raw.lanes_mut()
    }
}
impl<S: Isa, T: Int + core::hash::Hash, W: Width> core::hash::Hash for Simd<T, W, S> {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        self.raw.lanes().hash(state)
    }
}
