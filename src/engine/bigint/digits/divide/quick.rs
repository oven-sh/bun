//! Divisions that the shape of the operands makes easy.

use core::hint::cold_path;

use crate::digits::{
    add_arrays, add_assign, add_assign_digit, bit_length, compare_same_length, multiply_add_narrow,
    scale, subtract_arrays, subtract_assign_same_length, top_bits, unroll,
};

/// The quotient of trimmed `a` and `b`, where `a` is not less, if their leading bits settle it.
#[inline(always)]
pub(crate) fn small_quotient(a: &[u64], b: &[u64]) -> Option<u64> {
    const MAX_QUOTIENT_BITS: usize = 24;
    let extra_bits = bit_length(a) - bit_length(b);
    if extra_bits == 0 {
        return Some(1);
    }
    if extra_bits > MAX_QUOTIENT_BITS {
        return None;
    }
    let (dividend, divisor) = (top_bits(a), top_bits(b) >> extra_bits);
    let (quotient, left) = (dividend / divisor, dividend % divisor);
    // The bits of `b` that were left out take less than one off `left` for each time that `b` is subtracted.
    (left >= quotient).then_some(quotient)
}

/// A divisor of three digits or more that is just below a power of two. Crandall, US patent 5,159,632.
#[derive(Clone, Copy)]
pub(crate) struct NearPowerOfTwo {
    /// What it falls short by.
    gap: u64,
    /// In the top digit.
    unused_bits: u32,
}

impl NearPowerOfTwo {
    #[inline(always)]
    pub(crate) fn of(divisor: &[u64]) -> Option<NearPowerOfTwo> {
        let &[low, u64::MAX, ref middle @ .., top] = divisor else {
            return None;
        };
        let (gap, unused_bits) = (low.wrapping_neg(), top.leading_zeros());
        let is_near = top & top.wrapping_add(1) == 0
            && gap != 0
            && gap.leading_zeros() > unused_bits
            && middle.iter().all(|&digit| digit == u64::MAX);
        is_near.then_some(NearPowerOfTwo { gap, unused_bits })
    }

    /// What a digit above those of the divisor leaves. Less than 2^63.
    #[inline(always)]
    fn gap_of_digit(self) -> u64 {
        self.gap << self.unused_bits
    }

    /// Clears the unused bits of `top` and returns what they and the digit `above` leave.
    #[inline(always)]
    fn fold_top(self, top: &mut u64, above: u64) -> [u64; 2] {
        let excess = 0u64.funnel_shl(*top, self.unused_bits);
        *top &= u64::MAX >> self.unused_bits;
        above
            .carrying_mul(self.gap_of_digit(), excess.wrapping_mul(self.gap))
            .into()
    }

    /// `out = a % divisor`. `a` is no shorter than the divisor and at most twice as long.
    #[inline(always)]
    pub(crate) fn remainder(self, out: &mut [u64], a: &[u64], divisor: &[u64]) {
        if let (Some(out), Some([low, high]), Some(divisor)) = (
            out.as_mut_array::<4>(),
            a.as_array::<8>().and_then(|a| a.as_chunks().0.as_array()),
            divisor.as_array(),
        ) {
            *out = self.remainder_of_arrays(low, high, divisor);
        } else {
            self.remainder_of_slices(out, a, divisor);
        }
    }

    #[inline(always)]
    fn remainder_of_arrays<const N: usize>(
        self,
        low: &[u64; N],
        high: &[u64; N],
        divisor: &[u64; N],
    ) -> [u64; N] {
        let (product, above) = scale(high, self.gap_of_digit(), 0);
        let (mut sum, carry) = add_arrays(&product, low, false);
        let folded = self.fold_top(&mut sum[N - 1], above.wrapping_add(u64::from(carry)));
        let mut padded = [0; N];
        unroll!(i in 0, 2 => {
            padded[i] = folded[i];
        });
        let (sum, carry) = add_arrays(&sum, &padded, false);
        if carry || sum[N - 1] >= divisor[N - 1] {
            cold_path();
            let (difference, borrow) = subtract_arrays(&sum, divisor);
            if carry || !borrow {
                return difference;
            }
        }
        sum
    }

    fn remainder_of_slices(self, out: &mut [u64], a: &[u64], divisor: &[u64]) {
        let (low, high) = a.split_at(divisor.len());
        out.copy_from_slice(low);
        let mut above = 0;
        if !high.is_empty() {
            above = multiply_add_narrow(out, high, &[self.gap_of_digit()]);
        }
        if high.len() < out.len() {
            above = u64::from(add_assign_digit(&mut out[high.len()..], above));
        }
        let folded = self.fold_top(&mut out[divisor.len() - 1], above);
        if add_assign(out, &folded) || compare_same_length(out, divisor).is_ge() {
            subtract_assign_same_length(out, divisor);
        }
    }
}
