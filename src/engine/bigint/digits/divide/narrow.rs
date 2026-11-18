//! Division by a few digits, one digit of the quotient at a time, with what is left of the dividend in registers.
//! Knuth, The Art of Computer Programming, 4.3.1, algorithm D.

use core::hint::{cold_path, select_unpredictable};

use super::digit::reciprocal;
use crate::digits::{
    Argument, MAX_WIDTH, NO_BORROW, add_arrays, add_with_carry, join, subtract_with_flag, unroll,
};

/// The two top digits of a divisor whose top bit is set. Möller and Granlund, Improved division by invariant integers.
#[derive(Clone, Copy)]
pub(super) struct DivisorTop {
    high: u64,
    low: u64,
    /// `(2^192 - 1) / (high, low) - 2^64`
    reciprocal: u64,
}

impl DivisorTop {
    #[inline]
    pub(super) fn new(high: u64, low: u64) -> DivisorTop {
        let mut reciprocal = reciprocal(high);
        let (mut left, carry) = high.wrapping_mul(reciprocal).overflowing_add(low);
        if carry {
            let is_over = left >= high;
            reciprocal = reciprocal.wrapping_sub(1 + u64::from(is_over));
            left = left.wrapping_sub(high);
            left = left.wrapping_sub(select_unpredictable(is_over, high, 0));
        }
        let (product_low, product_high) = low.carrying_mul(reciprocal, 0);
        let (left, carry) = left.overflowing_add(product_high);
        let is_over = join(product_low, left) >= join(low, high);
        DivisorTop {
            high,
            low,
            reciprocal: reciprocal.wrapping_sub(u64::from(carry) + u64::from(carry & is_over)),
        }
    }

    pub(super) fn of(divisor: &[u64]) -> DivisorTop {
        DivisorTop::new(divisor[divisor.len() - 1], divisor[divisor.len() - 2])
    }

    #[inline(always)]
    pub(super) fn is(self, high: u64, low: u64) -> bool {
        high == self.high && low == self.low
    }

    /// The quotient and remainder of three digits, the upper two of which are less than the divisor.
    #[inline(always)]
    pub(super) fn step(self, high: u64, middle: u64, low: u64) -> (u64, u128) {
        let divisor = join(self.low, self.high);
        let estimate =
            (u128::from(self.reciprocal) * u128::from(high)).wrapping_add(join(middle, high));
        let (fraction, quotient) = (estimate as u64, (estimate >> 64) as u64);
        let left = join(low, middle.wrapping_sub(quotient.wrapping_mul(self.high)))
            .wrapping_sub(divisor)
            .wrapping_sub(u128::from(quotient) * u128::from(self.low));
        let is_over = (left >> 64) as u64 >= fraction;
        let quotient = quotient.wrapping_add(u64::from(!is_over));
        let left = left.wrapping_add(join(
            select_unpredictable(is_over, self.low, 0),
            select_unpredictable(is_over, self.high, 0),
        ));
        if left >= divisor {
            cold_path();
            return (quotient.wrapping_add(1), left - divisor);
        }
        (quotient, left)
    }
}

/// Brings `next` in below `left`, which is less than `divisor` before and after. Returns the digit of the quotient.
#[inline(always)]
fn step<const N: usize>(
    left: &mut [u64; N],
    next: u64,
    divisor: &[u64; N],
    top: DivisorTop,
) -> u64 {
    let mut lower = [next; N];
    unroll!(i in 1, N => {
        lower[i] = left[i - 1];
    });
    let is_largest = top.is(left[N - 1], left[N - 2]);
    let (quotient, upper) = if is_largest {
        cold_path();
        // The carry out of this sum cancels the borrow below.
        let top = join(top.low, top.high);
        (u64::MAX, top.wrapping_add(u128::from(lower[N - 2])))
    } else {
        top.step(left[N - 1], lower[N - 1], lower[N - 2])
    };
    let (mut low, mut high) = ([0; N], [0; N]);
    unroll!(i in 0, N - 2 => {
        (low[i], high[i + 1]) = divisor[i].carrying_mul(quotient, 0);
    });
    let mut carry = false;
    unroll!(i in 1, N - 1 => {
        (low[i], carry) = add_with_carry(low[i], high[i], carry);
    });
    (lower[N - 2], lower[N - 1]) = (upper as u64, (upper >> 64) as u64);
    let mut flag = NO_BORROW;
    unroll!(i in 0, N => {
        (left[i], flag) = subtract_with_flag(lower[i], low[i], flag);
    });
    if flag != NO_BORROW && !is_largest {
        cold_path();
        *left = add_arrays(left, divisor, false).0;
        return quotient - 1;
    }
    quotient
}

macro_rules! for_each_length {
    ($function:ident) => {
        [
            $function::<2>,
            $function::<3>,
            $function::<4>,
            $function::<5>,
            $function::<6>,
            $function::<7>,
            $function::<8>,
        ]
    };
}

/// `divisor` has its top bit set and from 2 to [`MAX_WIDTH`] digits, and the top digits of `a` are less. `a` is as
/// long as `quotient` and `divisor` together, and its low digits become the remainder.
#[inline]
pub(super) fn divide_in_place(
    quotient: &mut [u64],
    a: &mut [u64],
    divisor: &[u64],
    top: &DivisorTop,
) {
    type Divide = fn(&mut [u64], &mut [u64], Argument<&[u64]>, &DivisorTop);
    static BY_LENGTH: [Divide; MAX_WIDTH - 1] = for_each_length!(divide_in_place_by_array);
    BY_LENGTH[divisor.len() - 2](quotient, a, Argument::new(divisor), top);
}

fn divide_in_place_by_array<const N: usize>(
    quotient: &mut [u64],
    a: &mut [u64],
    divisor: Argument<&[u64]>,
    &top: &DivisorTop,
) {
    let divisor = divisor.first_chunk::<N>().unwrap();
    let mut left = *a.last_chunk::<N>().unwrap();
    for (quotient, &next) in quotient.iter_mut().zip(&*a).rev() {
        *quotient = step(&mut left, next, divisor, top);
    }
    a[..N].copy_from_slice(&left);
}

/// `b` is trimmed, has from 2 to [`MAX_WIDTH`] digits and is no longer than `a`. `quotient` is empty or has
/// `a.len() - b.len() + 1` digits, or one less if the quotient fits. `remainder` is empty or as long as `b`.
#[inline]
pub(super) fn divide(quotient: &mut [u64], remainder: &mut [u64], a: &[u64], b: &[u64]) {
    type Divide = fn(&mut [u64], &mut [u64], &[u64], &[u64]);
    static BY_LENGTH: [Divide; MAX_WIDTH - 1] = for_each_length!(divide_by_array);
    BY_LENGTH[b.len() - 2](quotient, remainder, a, b);
}

fn divide_by_array<const N: usize>(
    quotient: &mut [u64],
    remainder: &mut [u64],
    a: &[u64],
    b: &[u64],
) {
    let b = b.first_chunk::<N>().unwrap();
    let shift = b[N - 1].leading_zeros();
    let mut divisor = [b[0] << shift; N];
    unroll!(i in 1, N => {
        divisor[i] = b[i].funnel_shl(b[i - 1], shift);
    });
    let top = DivisorTop::new(divisor[N - 1], divisor[N - 2]);

    let upper = a.last_chunk::<N>().unwrap();
    let mut left = [0u64.funnel_shl(upper[N - 1], shift); N];
    unroll!(i in 1, N => {
        left[i - 1] = upper[i].funnel_shl(upper[i - 1], shift);
    });
    let mut rest = &a[..=a.len() - N];
    let mut take = || {
        let (&digit, below) = rest.split_last()?;
        rest = below;
        let next = digit.funnel_shl(below.last().copied().unwrap_or(0), shift);
        Some((below.len(), next))
    };
    if left[N - 1] == 0
        && left[N - 2] < divisor[N - 1]
        && let Some((index, next)) = take()
    {
        unroll!(i in 1, N => {
            left[N - i] = left[N - i - 1];
        });
        left[0] = next;
        if let Some(out) = quotient.get_mut(index) {
            *out = 0;
        }
    }
    while let Some((index, next)) = take() {
        let digit = step(&mut left, next, &divisor, top);
        if let Some(out) = quotient.get_mut(index) {
            *out = digit;
        }
    }
    if let Some(remainder) = remainder.first_chunk_mut::<N>() {
        unroll!(i in 1, N => {
            remainder[i - 1] = left[i].funnel_shr(left[i - 1], shift);
        });
        remainder[N - 1] = left[N - 1] >> shift;
    }
}
