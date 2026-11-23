//! Fixed-point multiplication, as in signal processing.

use crate::multiply::fns;
use crate::{Isa, Operand, Simd, Width};

impl<S: Isa, W: Width> Simd<i16, W, S> {
    fns! {
        /// `add + self.mul_q15(mul)` with saturation. The result is unspecified if both factors are `i16::MIN`.
        /// `sqrdmlah`.
        #[doc(alias("mul_fixed_point_15_add", "sqrdmlah"))]
        fn mul_q15_add_relaxed(self, mul: impl Operand<i16, W, S>, add: impl Operand<i16, W, S>) -> Self {
            return_if!(S::RDM, self.with_bytes(self.s.mul_fixed_point_15_add::<W>(self.bytes(), self.like(mul).bytes(), self.like(add).bytes())));
            self.like(add).saturating_add(self.mul_q15_relaxed(mul))
        }
        /// `(self * factor) >> 15`, for a factor in `-0x4000..0x4000`. The result is unspecified for others. If the factor
        /// is a constant, this is one instruction on all targets, which [`mul_high`](Self::mul_high) isn't on NEON. `sqdmulh`.
        #[doc(alias("sqdmulh"))]
        fn mul_high_doubled_relaxed(self, factor: impl Operand<i16, W, S>) -> Self {
            let factor = self.like(factor);
            if_here!(S::NEON, {
                return self.with_bytes(self.s.mul_high_doubled::<W>(self.bytes(), factor.bytes()));
            });
            self.mul_high(factor + factor)
        }
    }
}

impl<S: Isa, W: Width> Simd<i32, W, S> {
    fns! {
        /// `(self * other + 0x4000_0000) >> 31`. The result is unspecified if both are `i32::MIN`. `sqrdmulh`.
        #[doc(alias("mul_fixed_point_31", "sqrdmulh"))]
        fn mul_q31_relaxed(self, other: impl Operand<i32, W, S>) -> Self {
            let other = self.like(other);
            if_here!(S::NEON, {
                return self.with_bytes(self.s.mul_fixed_point_31::<W>(self.bytes(), other.bytes()));
            });
            return_if!(W::BYTES < 8, {
                let d = self.s.fixed::<i32, crate::B8>();
                self.tag().resize_bitcast(d.resize_bitcast(self).mul_q31_relaxed(d.resize_bitcast(other)))
            });
            let (even, odd) = (self.widening_mul_even(other) + 0x4000_0000, self.widening_mul_odd(other) + 0x4000_0000);
            (odd + odd).bitcast().odd_even((even.cast_unsigned() >> 31).bitcast())
        }
        /// `(self * factor) >> 31`, for a factor in `-0x4000_0000..0x4000_0000`. The result is unspecified for others. It is one instruction on NEON only.
        fn mul_high_doubled_relaxed(self, factor: impl Operand<i32, W, S>) -> Self {
            let factor = self.like(factor);
            if_here!(S::NEON, {
                return self.with_bytes(self.s.mul_high_doubled32::<W>(self.bytes(), factor.bytes()));
            });
            self.mul_high(factor + factor)
        }
        /// `add + self.mul_q31(mul)` with saturation. The result is unspecified if both factors are `i32::MIN`.
        /// `sqrdmlah`.
        #[doc(alias("mul_fixed_point_31_add", "sqrdmlah"))]
        fn mul_q31_add_relaxed(self, mul: impl Operand<i32, W, S>, add: impl Operand<i32, W, S>) -> Self {
            return_if!(S::RDM, self.with_bytes(self.s.mul_fixed_point_31_add::<W>(self.bytes(), self.like(mul).bytes(), self.like(add).bytes())));
            self.like(add).saturating_add(self.mul_q31_relaxed(mul))
        }
    }
}
