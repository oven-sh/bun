//! Division by one digit. Möller and Granlund, Improved division by invariant integers.

use core::hint::{cold_path, select_unpredictable};

use crate::digits::{add_with_carry, join, unroll};

/// `high < divisor`. Returns the quotient and the remainder.
#[inline(always)]
fn divide_pair(high: u64, low: u64, divisor: u64) -> (u64, u64) {
    let quotient = (join(low, high) / u128::from(divisor)) as u64;
    (quotient, low.wrapping_sub(quotient.wrapping_mul(divisor)))
}

/// `(2^128 - 1) / divisor - 2^64`, where the top bit of `divisor` is set.
#[inline(always)]
pub(super) const fn reciprocal(divisor: u64) -> u64 {
    (((!divisor as u128) << 64 | u64::MAX as u128) / divisor as u128) as u64
}

/// A divisor that is ready to be divided by without a division instruction.
#[derive(Clone, Copy)]
pub(crate) struct DigitDivisor {
    /// With its top bit set.
    shifted: u64,
    shift: u32,
    reciprocal: u64,
}

impl DigitDivisor {
    #[inline]
    pub(crate) const fn new(divisor: u64) -> DigitDivisor {
        let shift = divisor.leading_zeros();
        DigitDivisor {
            shifted: divisor << shift,
            shift,
            reciprocal: reciprocal(divisor << shift),
        }
    }

    /// By the shifted divisor, which is more than `high`.
    #[inline(always)]
    fn step(self, high: u64, low: u64) -> (u64, u64) {
        let estimate = (u128::from(self.reciprocal) * u128::from(high))
            .wrapping_add(join(low, high.wrapping_add(1)));
        let (fraction, quotient) = (estimate as u64, (estimate >> 64) as u64);
        let left = low.wrapping_sub(quotient.wrapping_mul(self.shifted));
        let is_over = left > fraction;
        let quotient = quotient.wrapping_sub(u64::from(is_over));
        let left = select_unpredictable(is_over, left.wrapping_add(self.shifted), left);
        if left >= self.shifted {
            cold_path();
            return (quotient.wrapping_add(1), left - self.shifted);
        }
        (quotient, left)
    }

    /// For a run of divisions that starts with `left` at zero. It stays shifted.
    #[inline(always)]
    pub(crate) fn divide_next(self, left: &mut u64, next: u64) -> u64 {
        let quotient;
        let high = *left | 0u64.funnel_shl(next, self.shift);
        (quotient, *left) = self.step(high, next << self.shift);
        quotient
    }

    /// The quotient and the remainder of two digits.
    #[inline(always)]
    pub(crate) fn divide_pair(self, low: u64, high: u64) -> (u128, u64) {
        let (mut quotient_high, mut left) = (0, high.funnel_shl(low, self.shift));
        if high >= self.shifted >> self.shift {
            (quotient_high, left) = self.step(0u64.funnel_shl(high, self.shift), left);
        }
        let (quotient_low, left) = self.step(left, low << self.shift);
        (join(quotient_low, quotient_high), left >> self.shift)
    }

    /// `out = (above, a) / self`, where `above` is less than the divisor. Returns the remainder.
    #[inline(always)]
    fn divide_below(self, out: &mut [u64], a: &[u64], above: u64) -> u64 {
        let out = &mut out[..a.len()];
        let Some(&top) = a.last() else {
            return above;
        };
        let mut left = above.funnel_shl(top, self.shift);
        for index in (1..a.len()).rev() {
            let next = a[index].funnel_shl(a[index - 1], self.shift);
            (out[index], left) = self.step(left, next);
        }
        (out[0], left) = self.step(left, a[0] << self.shift);
        left >> self.shift
    }

    /// `out = a / self`. `out` is as long as `a`, or one digit shorter if the quotient fits. Returns the remainder.
    pub(crate) fn divide(self, out: &mut [u64], a: &[u64]) -> u64 {
        let (a, top) = a.split_at(out.len());
        self.divide_below(out, a, top.first().copied().unwrap_or(0))
    }

    pub(crate) fn remainder(self, a: &[u64]) -> u64 {
        const MIN_FOLDED_LENGTH: usize = 12;
        if a.len() >= MIN_FOLDED_LENGTH {
            return self.remainder_by_steps(&self.fold(a));
        }
        self.remainder_by_steps(a)
    }

    #[inline(always)]
    fn remainder_by_steps(self, a: &[u64]) -> u64 {
        let Some(&top) = a.last() else {
            return 0;
        };
        let mut left = 0u64.funnel_shl(top, self.shift);
        for &[low, high] in a.array_windows().rev() {
            left = self.step(left, high.funnel_shl(low, self.shift)).1;
        }
        self.step(left, a[0] << self.shift).1 >> self.shift
    }

    /// Three digits that leave the same remainder as `a`. No multiplication waits for the one before it.
    fn fold(self, a: &[u64]) -> [u64; 3] {
        const RUN: usize = 4;
        // At `i` is 2^(64 * (i + 1)) modulo the divisor.
        let mut powers = [0; RUN + 2];
        let mut power = select_unpredictable(self.shifted == 1 << self.shift, 0, 1 << self.shift);
        unroll!(i in 0, RUN + 2 => {
            power = self.step(power, 0).1;
            powers[i] = power >> self.shift;
        });
        let (runs, top) = a.as_chunks::<RUN>();
        let mut sum = [0; 3];
        sum[..top.len()].copy_from_slice(top);
        for run in runs.iter().rev() {
            let terms = [run[1], run[2], run[3], sum[0], sum[1], sum[2]];
            sum = [run[0], 0, 0];
            unroll!(i in 0, RUN + 2 => {
                let (low, high) = terms[i].carrying_mul(powers[i], 0);
                let mut carry;
                (sum[0], carry) = sum[0].overflowing_add(low);
                (sum[1], carry) = add_with_carry(sum[1], high, carry);
                sum[2] = sum[2].wrapping_add(u64::from(carry));
            });
        }
        sum
    }
}

/// Up to this length the division instruction takes no longer than finding the reciprocal.
const MAX_DIRECT_LENGTH: usize = if cfg!(target_arch = "x86_64") { 6 } else { 1 };

/// `out = a / divisor`. `out` is as long as `a`, or one digit shorter if the quotient fits. Returns the remainder.
#[inline]
pub(crate) fn divide_by_digit(out: &mut [u64], a: &[u64], divisor: u64) -> u64 {
    if out.len() > MAX_DIRECT_LENGTH {
        return DigitDivisor::new(divisor).divide(out, a);
    }
    let (a, top) = a.split_at(out.len());
    let mut pairs = out.iter_mut().zip(a).rev();
    let mut left = 0;
    if let [top] = *top {
        left = top;
    } else if let Some((out, &a)) = pairs.next() {
        (*out, left) = (a / divisor, a % divisor);
    }
    for (out, &a) in pairs {
        (*out, left) = divide_pair(left, a, divisor);
    }
    left
}

#[inline]
pub(crate) fn remainder_by_digit(a: &[u64], divisor: u64) -> u64 {
    if a.len() > MAX_DIRECT_LENGTH {
        return DigitDivisor::new(divisor).remainder(a);
    }
    let [rest @ .., top] = a else {
        return 0;
    };
    rest.iter().rev().fold(top % divisor, |left, &a| {
        (join(a, left) % u128::from(divisor)) as u64
    })
}
