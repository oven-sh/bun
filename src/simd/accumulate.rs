//! Sums that are spread over the lanes in the way that is cheapest for the target.

use crate::{Isa, Operand, Simd, Width};

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// Adds each absolute difference to some lane of `sum`. From zero, 32 calls don't overflow. It is `psadbw` and an
    /// addition, or `uabd` and `uadalp`, where [`abs_diff_sum`](Self::abs_diff_sum) takes four
    /// instructions on NEON.
    #[op]
    pub(crate) fn reorder_abs_diff_accumulate(self, other: Self, sum: Simd<u16, W, S>) -> Simd<u16, W, S> {
        const X86: bool = cfg!(any(target_arch = "x86", target_arch = "x86_64"));
        if const { X86 && W::BYTES >= 8 } {
            sum + self.sums_of_8_abs_diff(other).bitcast()
        } else if X86 {
            let d = self.s.fixed::<u8, crate::B8>();
            sum + sum.tag().resize_bitcast(d.resize_bitcast(self).sums_of_8_abs_diff(d.resize_bitcast(other)))
        } else {
            sum + self.abs_diff(other).sums_of_2()
        }
    }
}

impl<S: Isa, W: Width> Simd<i16, W, S> {
    /// Adds two adjacent products to each lane of `sum`. The result is unspecified if it overflows. With VNNI it is
    /// `vpdpwssds`, since LLVM splits `vpdpwssd` into a multiplication and an addition. Without, it is these two, where
    /// [`saturating_dot_add`](Self::saturating_dot_add) takes many more.
    #[op]
    #[doc(alias("widen_mul_pairwise_accumulate"))]
    pub fn dot_add_relaxed<U>(self, other: impl Operand<i16, W, S>, sum: impl Operand<i32, W, S>) -> Simd<i32, W, S>
    where
        i32: crate::lane::Is<U>,
    {
        let sum = sum.vector(self.tag().repartition());
        return_if!(
            S::AVX512VNNI || S::AVXVNNI,
            self.with_bytes(self.s.saturated_dot_i16::<W>(self.bytes(), other.vector(self.tag()).bytes(), sum.bytes()))
        );
        self.widen_mul_pairwise_add_to(other.vector(self.tag()), sum)
    }
}
