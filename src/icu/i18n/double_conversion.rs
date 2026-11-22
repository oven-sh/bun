//! Conversions between doubles and decimal digits. ICU4C: double-conversion-strtod.cpp

use crate::common::slice_ext::{SliceExt, SoftUnwrap, to_length};
use std::slice;

const HIDDEN_BIT: u64 = 1 << 52;
const DENORMAL_EXPONENT: i32 = -1074;

/// Returns `(c, q)` with `v` = c * 2^q. `v` must be finite and not negative.
fn binary_parts(v: f64) -> (u64, i32) {
    let (biased, fraction) = ((v.to_bits() >> 52) as i32, v.to_bits() % HIDDEN_BIT);
    if biased == 0 {
        (fraction, DENORMAL_EXPONENT)
    } else {
        (fraction | HIDDEN_BIT, biased - 1 + DENORMAL_EXPONENT)
    }
}

/// log10(2) * 2^22. The floor of a product with it is exact for every exponent of a double.
const LOG10_2: i32 = 1_262_611;
/// log10(4/3) * 2^22, with the same precision.
const LOG10_4_3: i32 = 524_031;

/// Returns the integer part of `n` * `limbs` / 2^`right`, which must fit 64 bits. The least significant limb is first.
fn multiply_and_shift(n: u64, limbs: &[u64], right: usize) -> u64 {
    let (mut low, mut high, mut carry) = (0, 0, 0);
    for limb in limbs.slice(..right / 64 + 2) {
        low = high;
        (high, carry) = limb.carrying_mul(n, carry);
    }
    ((u128::from(high) << 64 | u128::from(low)) >> (right % 64)) as u64
}

/// Replaces each n with n * 2^`binary` / 10^`decimal`, rounded to odd, in 1..2^63. A positive `decimal` is at most `binary`.
fn scale_round_to_odd(values: &mut [u64], binary: i32, decimal: i32) {
    const STEP: u32 = 27;
    // 5^|`decimal`| has at most 788 bits.
    let (mut fives, mut used) = ([0; 13], 1);
    fives.set(0, 5u64.pow(decimal.unsigned_abs() % STEP));
    for _ in 0..decimal.unsigned_abs() / STEP {
        let mut carry = 0;
        for limb in fives.slice_mut(..used) {
            (*limb, carry) = limb.carrying_mul(5u64.pow(STEP), carry);
        }
        fives.set(used, carry);
        used += usize::from(carry != 0);
    }

    let (left, right) = (to_length(binary - decimal), to_length(decimal - binary));
    if decimal <= 0 {
        for n in values {
            // `fives` is odd, so the product has as many trailing zero bits as `n`.
            *n = multiply_and_shift(*n << left, &fives, right)
                | u64::from(right > n.trailing_zeros() as usize);
        }
        return;
    }
    let dropped = (64 * used - fives.at(used - 1).leading_zeros() as usize).saturating_sub(64);
    let divisor = u128::from(multiply_and_shift(1, &fives, dropped));
    for n in values {
        let dividend = u128::from(*n) << (left - dropped);
        let quotient = dividend.checked_div(divisor).soft_unwrap() as u64;
        *n = if dropped == 0 {
            quotient | u64::from(u128::from(quotient) * divisor != dividend)
        } else {
            // `divisor` is cut to 64 bits, so `quotient` may be 1 too large. There is a fraction, as `fives` exceeds `n`.
            (quotient - u64::from(multiply_and_shift(quotient, &fives, left) >= *n)) | 1
        };
    }
}

/// Divides a result of `scale_round_to_odd` by 4, rounding half to even.
fn round_quarters(quarters: u64) -> u64 {
    (quarters + 1 + quarters / 4 % 2) / 4
}

/// Returns `(d, e)` for the nearest of the shortest d * 10^e that parse back to `v`, which is finite and positive.
pub(crate) fn shortest_digits(v: f64) -> (u64, i32) {
    // Giulietti's Schubfach, with exact products in place of its table. `d` may have trailing zeros.
    let (c, q) = binary_parts(v);
    // Both neighbours of `f64::MIN_POSITIVE` are equally close, but the narrower interval gives the same digits.
    let lower_is_closer = c == HIDDEN_BIT;
    // The width of the rounding interval of `v` is in 10^k..10^(k+1). The bounds are included if `c` is even.
    let k = (q * LOG10_2 - if lower_is_closer { LOG10_4_3 } else { 0 }) >> 22;
    let mut quarters = [4 * c - 2 + u64::from(lower_is_closer), 4 * c, 4 * c + 2];
    scale_round_to_odd(&mut quarters, q, k);
    let [lower, exact, upper] = quarters;
    let (lower, tens) = (lower + c % 2, (upper - c % 2) / 40);
    if tens * 40 >= lower {
        (tens, k + 1)
    } else {
        (round_quarters(exact).max(lower.div_ceil(4)), k)
    }
}

/// Returns the power of ten of the last digit other than zero that `printf("%.15e")` prints for the finite, positive `v`.
pub(crate) fn magnitude_of_last_digit(v: f64) -> i32 {
    let (c, q) = binary_parts(v);
    let mut exponent = (((q + 63 - c.leading_zeros() as i32) * LOG10_2) >> 22) - 15;
    let mut quarters = 4 * c;
    scale_round_to_odd(slice::from_mut(&mut quarters), q, exponent);
    if quarters >= 40_000_000_000_000_000 {
        quarters = (quarters / 10) | u64::from(!quarters.is_multiple_of(10));
        exponent += 1;
    }
    let mut digits = round_quarters(quarters);
    while digits.is_multiple_of(10) {
        digits /= 10;
        exponent += 1;
    }
    exponent
}

/// Each of these is exact.
pub(crate) const POWERS_OF_TEN: [f64; 22] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16,
    1e17, 1e18, 1e19, 1e20, 1e21,
];

/// Upper bound on the significant digits of a number halfway between two doubles.
const MAX_SIGNIFICANT_DIGITS: usize = 772;

/// Returns the double nearest to 0.d * 10^`point`. `digits` has the digits of d from the last to the first, which is not 0.
#[inline(always)]
pub(crate) fn digits_to_double(digits: &[u8], point: i64) -> f64 {
    let (count, mut digits) = (digits.len(), digits.iter().rev());
    // Up to 15 digits are exact, so one operation with an exact power rounds correctly.
    let exponent = point - count as i64;
    if count <= 15 && exponent.abs() < POWERS_OF_TEN.len() as i64 {
        let integer = digits.fold(0, |sum, &digit| sum * 10 + i64::from(digit)) as f64;
        let power = POWERS_OF_TEN.at(exponent.unsigned_abs() as usize);
        return if exponent < 0 {
            integer / power
        } else {
            integer * power
        };
    }
    let (mut text, mut length) = ([b'0'; MAX_SIGNIFICANT_DIGITS + 8], 1);
    let mut push = |c| {
        text.set(length, c);
        length += 1;
    };
    push(b'.');
    digits
        .by_ref()
        .take(MAX_SIGNIFICANT_DIGITS)
        .for_each(|digit| push(b'0' + digit));
    if digits.any(|&dropped| dropped != 0) {
        push(b'1');
    }
    push(b'e');
    push(if point < 0 { b'-' } else { b'+' });
    let power = point.unsigned_abs().min(999);
    [power / 100, power / 10 % 10, power % 10]
        .into_iter()
        .for_each(|digit| push(b'0' + digit as u8));
    str::from_utf8(text.slice(..length))
        .ok()
        .and_then(|text| text.parse().ok())
        .soft_unwrap()
}
