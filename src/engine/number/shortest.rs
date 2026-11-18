//! The shortest decimal that rounds to a double, and of those the closest.
//!
//! As in Giulietti, "The Schubfach way to render doubles": with 10^k the largest power of ten that is no wider than the
//! rounding interval, the interval has at most one multiple of 10^(k+1), which is the result if it is there, and
//! otherwise the result is a multiple of 10^k. As in Jeon, "Dragonbox", the upper end of the interval is what gets
//! scaled. Divided by 10^(k+1), its integer part is the only candidate for the former and all but the last digit of
//! the latter.

use crate::double::{IMPLICIT_BIT, decompose};
use crate::integer_text::decimal_length;
use crate::powers_of_ten::{
    PowerOfTen, SMALL_POWERS, floor_log2_of_power_of_ten, power_just_below_inverse_of_power_of_two,
    power_of_ten,
};

/// `(leading * 10 + last) * 10^exponent`, with zero for `last` unless `needs_last`.
#[derive(Clone, Copy)]
pub(crate) struct Shortest {
    /// 15 or 16 digits.
    pub(crate) leading: u64,
    /// A character.
    pub(crate) last: u8,
    pub(crate) needs_last: bool,
    pub(crate) exponent: i32,
}

/// The integer part, and the fraction in units of 2^-64, of a product that has `128 + extra_bits` binary places.
#[inline(always)]
fn scale(factor: u64, power: PowerOfTen, extra_bits: u32) -> (u64, u64) {
    let factor = u128::from(factor);
    let product = factor * u128::from(power.high) + ((factor * u128::from(power.low)) >> 64);
    (
        (product >> (64 + extra_bits)) as u64,
        (product >> extra_bits) as u64,
    )
}

#[inline(always)]
fn integer_part_of_product(fraction: u64, factor: u64) -> u64 {
    ((u128::from(fraction) * u128::from(factor)) >> 64) as u64
}

/// The character for ten times `fraction`, rounded. The only ties are at 2.5 and 7.5, and go to the even digit.
#[inline(always)]
fn closest_digit(fraction: u64) -> u8 {
    let rounded_up = (integer_part_of_product(fraction, 20) as u32 + 2 * u32::from(b'0') + 1) >> 1;
    rounded_up as u8 - u8::from(fraction == TIE_THAT_GOES_DOWN)
}

const TIE_THAT_GOES_DOWN: u64 = 1 << 62;

/// For a value as far from the double below as from the one above. With `IS_QUICK`, nothing in the rare cases.
#[inline(always)]
pub(crate) fn between_equal_gaps<const IS_QUICK: bool>(
    significand: u64,
    exponent: i32,
) -> Option<Shortest> {
    let (power, shift) = power_just_below_inverse_of_power_of_two(exponent);
    let inverse = power_of_ten(power);
    let gap = inverse.high >> shift;
    let (integer, fraction) = scale((significand << 11 | 1 << 10) >> shift, inverse, 11);
    let of_value = fraction.wrapping_sub(gap / 2);
    if IS_QUICK && (fraction == 0 || of_value == TIE_THAT_GOES_DOWN) {
        return None;
    }
    // The ends of the interval read as the even one of the doubles beside them.
    let is_odd = significand % 2;
    let is_excluded = fraction == 0 && is_odd != 0;
    Some(Shortest {
        leading: integer - u64::from(is_excluded),
        last: closest_digit(of_value),
        needs_last: is_excluded || fraction > gap - is_odd,
        exponent: -power - 1,
    })
}

/// For `IMPLICIT_BIT * 2^exponent`: the double below is half as far as the one above. It is not for the smallest normal
/// value, where that makes no difference.
#[inline]
fn of_power_of_two(exponent: i32) -> Shortest {
    // The interval is 3/4 as wide: this is floor(log10(3/4 * 2^exponent)).
    let k = (exponent * 315_653 - 131_008) >> 20;
    let inverse = power_of_ten(-k - 1);
    let shift = -exponent - floor_log2_of_power_of_ten(-k - 1);
    let half_gap = inverse.high >> shift;
    let (leading, fraction) = scale((IMPLICIT_BIT << 11 | 1 << 10) >> shift, inverse, 10);
    let lower_end = fraction.saturating_sub(half_gap + half_gap / 2);
    let closest = closest_digit(fraction.wrapping_sub(half_gap));
    Shortest {
        leading,
        last: closest.max(b'1' + integer_part_of_product(lower_end.wrapping_sub(1), 10) as u8),
        needs_last: lower_end != 0,
        exponent: k,
    }
}

impl Shortest {
    /// Of the magnitude of a value that is finite and not zero.
    #[inline]
    pub(crate) fn of(value: f64) -> Option<Shortest> {
        if value == 0.0 || !value.is_finite() {
            return None;
        }
        match decompose(value) {
            (IMPLICIT_BIT, exponent) => Some(of_power_of_two(exponent)),
            (significand @ IMPLICIT_BIT.., exponent) => {
                between_equal_gaps::<false>(significand, exponent)
            }
            (significand, exponent) => {
                between_equal_gaps::<false>(significand, exponent).map(Shortest::padded)
            }
        }
    }

    /// Gives the result for a subnormal value the usual number of digits.
    #[cold]
    fn padded(self) -> Shortest {
        let last = if self.needs_last { self.last - b'0' } else { 0 };
        let digits = self.leading * 10 + u64::from(last);
        let missing = 17 - decimal_length(digits);
        let digits = digits * SMALL_POWERS[missing];
        Shortest {
            leading: digits / 10,
            last: b'0' + (digits % 10) as u8,
            needs_last: digits % 10 != 0,
            exponent: self.exponent - missing as i32,
        }
    }
}
