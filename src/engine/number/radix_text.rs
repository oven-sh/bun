//! Number::toString of ECMA-262 in any radix.

use core::cmp::Ordering;

use crate::double::{IMPLICIT_BIT, MIN_EXPONENT, decompose};
use crate::expansion::multiply;
use crate::radix::DIGITS;
use crate::{Radix, exact_int52, is_integer, write_f64};

/// A sign and 64 binary digits.
pub const RADIX_INTEGER_CAPACITY: usize = 65;

/// A sign and eight digits of any radix, rounded up to a word that one store writes.
const SMALL_CAPACITY: usize = 16;

/// `radix^8`, the lowest number that `SMALL_CAPACITY` has no room for.
static EIGHT_DIGITS: [u64; 37] = {
    let mut powers = [0; 37];
    let mut radix = 2;
    while radix < powers.len() {
        powers[radix] = (radix as u64).pow(8);
        radix += 1;
    }
    powers
};

/// The digits of an integer in `radix`, with a sign if it is negative.
pub fn integer_to_radix(
    number: i64,
    radix: Radix,
    out: &mut [u8; RADIX_INTEGER_CAPACITY],
) -> &[u8] {
    let start = write_backward(number.unsigned_abs(), radix, out);
    let start = with_sign(number < 0, out, start);
    &out[start..]
}

/// Hands the text to `consume`: it can have more than a thousand characters.
#[inline]
pub fn with_radix_text<R>(value: f64, radix: Radix, consume: impl FnOnce(&[u8]) -> R) -> R {
    if radix == Radix::DECIMAL || !value.is_finite() {
        let mut out = [0; _];
        let length = write_f64(value, &mut out);
        consume(&out[..length])
    } else if let Some(integer) = exact_int52(value + 0.0) {
        let magnitude = integer.unsigned_abs();
        if magnitude < EIGHT_DIGITS[radix.get() as usize % EIGHT_DIGITS.len()] {
            // A buffer that one store clears, which is most of the work for a number of a few digits.
            let out = &mut [0; SMALL_CAPACITY];
            let at = write_backward(magnitude, radix, out);
            let start = with_sign(integer < 0, out, at);
            return consume(&out[start..]);
        }
        consume(integer_to_radix(integer, radix, &mut [0; _]))
    } else if (1.0 / 1024.0..IMPLICIT_BIT as f64).contains(&value.abs()) && !is_integer(value) {
        consume(write_fractional::<1, 128>(value, radix, &mut [0; _]))
    } else {
        consume(write_long(value, radix, &mut [0; _]))
    }
}

/// Room for `RADIX_INTEGER_CAPACITY`, a point and 1074 binary digits.
type LongBuffer = [u8; 1140];

#[cold]
fn write_long(value: f64, radix: Radix, out: &mut LongBuffer) -> &[u8] {
    if value.abs() >= 1.0 {
        write_large_integer(value, radix, out)
    } else if value.abs() >= 1.0 / (1u128 << 74) as f64 {
        write_fractional::<2, _>(value, radix, out)
    } else {
        write_fractional::<17, _>(value, radix, out)
    }
}

fn with_sign(is_negative: bool, out: &mut [u8], start: usize) -> usize {
    out[start - 1] = b'-';
    start - usize::from(is_negative)
}

/// Fills the end of `out`. Returns where the digits start.
#[inline(always)]
fn write_backward(mut number: u64, radix: Radix, out: &mut [u8]) -> usize {
    /// 2^64 over each radix, rounded up: it gives the exact quotient of a number below 2^58.
    static RECIPROCALS: [u64; 37] = {
        let mut reciprocals = [0; 37];
        let mut radix = 2;
        while radix < reciprocals.len() {
            reciprocals[radix] = u64::MAX / radix as u64 + 1;
            radix += 1;
        }
        reciprocals
    };
    let radix = u64::from(radix.get());
    let mut at = out.len();
    let mut prepend = |digit: u64| {
        at -= 1;
        out[at] = DIGITS[digit as usize % DIGITS.len()];
    };
    if radix.is_power_of_two() {
        while number >= radix {
            prepend(number & (radix - 1));
            number >>= radix.trailing_zeros();
        }
    } else {
        while number >> 58 != 0 {
            prepend(number % radix);
            number /= radix;
        }
        let reciprocal = RECIPROCALS[radix as usize];
        while number >= radix {
            let quotient = number.carrying_mul(reciprocal, 0).1;
            prepend(number - quotient * radix);
            number = quotient;
        }
    }
    prepend(number);
    at
}

/// Every digit is exact.
fn write_large_integer(value: f64, radix: Radix, out: &mut LongBuffer) -> &[u8] {
    let (significand, exponent) = decompose(value);
    let significand = significand >> -exponent.min(0);
    let exponent = exponent.max(0) as usize;
    let shifted = u128::from(significand) << (exponent % 32);
    let mut limbs = [0u32; 33];
    for (index, limb) in limbs[exponent / 32..].iter_mut().take(3).enumerate() {
        *limb = (shifted >> (32 * index)) as u32;
    }
    let (power, digits_per_power) = radix.largest_power();
    let mut count = exponent / 32 + 3;
    let mut end = out.len();
    loop {
        let mut remainder = 0;
        for limb in limbs[..count].iter_mut().rev() {
            let dividend = remainder << 32 | u64::from(*limb);
            *limb = (dividend / u64::from(power)) as u32;
            remainder = dividend % u64::from(power);
        }
        while count > 0 && limbs[count - 1] == 0 {
            count -= 1;
        }
        let start = write_backward(remainder, radix, &mut out[..end]);
        if count == 0 {
            let start = with_sign(value < 0.0, out, start);
            return &out[start..];
        }
        end -= digits_per_power;
        out[end..start].fill(b'0');
    }
}

/// A number below one, the least significant limb first.
#[derive(Clone, Copy)]
struct Fraction<const LIMBS: usize>([u64; LIMBS]);

impl<const LIMBS: usize> Fraction<LIMBS> {
    /// `numerator / 2^places`
    fn new(numerator: u64, places: usize) -> Self {
        let shift = LIMBS * 64 - places;
        let shifted = u128::from(numerator) << (shift % 64);
        let mut limbs = [0; LIMBS];
        for (limb, part) in limbs[shift / 64..].iter_mut().zip([shifted, shifted >> 64]) {
            *limb = part as u64;
        }
        Fraction(limbs)
    }

    /// Returns the integer part of the product.
    fn multiply(&mut self, factor: u32) -> u64 {
        multiply(&mut self.0, u64::from(factor))
    }

    /// A product of one or more becomes the largest fraction.
    fn multiply_saturating(&mut self, factor: u32) {
        if self.multiply(factor) != 0 {
            self.0 = [u64::MAX; LIMBS];
        }
    }

    fn compare(&self, other: &Self) -> Ordering {
        self.0.iter().rev().cmp(other.0.iter().rev())
    }

    fn sum_exceeds_one(&self, other: &Self) -> bool {
        let (mut carry, mut any_bits) = (false, 0);
        for (&a, &b) in self.0.iter().zip(&other.0) {
            let sum;
            (sum, carry) = a.carrying_add(b, carry);
            any_bits |= sum;
        }
        carry && any_bits != 0
    }
}

/// Digits are added until what is left over is less than half the distance to the next double on the side of the
/// closer of the two ways to stop. `LIMBS` have room for two binary places more than the value has.
fn write_fractional<const LIMBS: usize, const CAPACITY: usize>(
    value: f64,
    radix: Radix,
    out: &mut [u8; CAPACITY],
) -> &[u8] {
    const POINT: usize = RADIX_INTEGER_CAPACITY;
    let (significand, exponent) = decompose(value);
    let places = exponent.unsigned_abs();
    let mut whole = significand.unbounded_shr(places);
    let numerator = significand - whole.unbounded_shl(places);
    let places = places as usize;
    let is_closer_below = significand == IMPLICIT_BIT && exponent > MIN_EXPONENT;

    let half = Fraction::<LIMBS>::new(1, 1);
    let mut fraction = Fraction::<LIMBS>::new(numerator, places);
    let mut margin_above = Fraction::new(1, places + 1);
    let mut margin_below = Fraction::new(1, places + 1 + usize::from(is_closer_below));
    let mut end = POINT + 1;

    let (power, digits_per_power) = radix.largest_power();
    while LIMBS > 1 && fraction.0[LIMBS - 1] >> 32 == 0 {
        fraction.multiply(power);
        margin_above.multiply(power);
        margin_below.multiply(power);
        out[end..end + digits_per_power].fill(b'0');
        end += digits_per_power;
    }

    let mut is_odd = whole % 2 != 0;
    let rounds_up = loop {
        let ordering = fraction.compare(&half);
        if ordering.is_gt() || (ordering.is_eq() && is_odd) {
            if fraction.sum_exceeds_one(&margin_above) {
                break true;
            }
        } else if fraction.compare(&margin_below).is_lt() {
            break false;
        }
        let digit = fraction.multiply(radix.get());
        margin_above.multiply_saturating(radix.get());
        margin_below.multiply_saturating(radix.get());
        out[end] = DIGITS[digit as usize];
        end += 1;
        // An odd radix keeps the parity of what came before.
        is_odd = (is_odd && radix.get() % 2 != 0) ^ (digit % 2 != 0);
    };

    out[POINT] = b'.';
    let dropped = if rounds_up {
        DIGITS[radix.get() as usize - 1]
    } else {
        b'0'
    };
    while out[end - 1] == dropped {
        end -= 1;
    }
    match out[end - 1] {
        b'.' => {
            end -= 1;
            whole += u64::from(rounds_up);
        }
        b'9' if rounds_up => out[end - 1] = b'a',
        _ => out[end - 1] += u8::from(rounds_up),
    }
    let start = write_backward(whole, radix, &mut out[..POINT]);
    let start = with_sign(value < 0.0, out, start);
    &out[start..end]
}
