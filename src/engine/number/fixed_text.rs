//! toFixed, toExponential and toPrecision of Number.prototype.

use crate::decimal_layout::{Ending, write_decimal, write_exponent, write_exponential};
use crate::digit_words::{eight_digits, split_sixteen_digits, store};
use crate::double::decompose;
use crate::integer_text::write_integer;
use crate::powers_of_ten::SMALL_POWERS;
use crate::rounded::{DigitBuffer, MAX_SCALED_DIGITS, round_by_scaling, round_exactly};
use crate::shortest_text::write_f64_with_exponent;
use crate::{FormatError, NUMBER_TEXT_CAPACITY, write_f64};

/// Room for 100 digits after the point.
pub const FIXED_TEXT_CAPACITY: usize = 128;

type Buffer = [u8; FIXED_TEXT_CAPACITY];

/// `number.toFixed(fractionDigits)`, which has to be from 0 to 100.
pub fn to_fixed(value: f64, fraction_digits: i32, out: &mut Buffer) -> Result<&[u8], FormatError> {
    let Ok(count @ 0..=100) = usize::try_from(fraction_digits) else {
        return Err(FormatError::FixedDigits);
    };
    let length = if value.abs() < (1u64 << 53) as f64 && count <= MAX_FEW_DIGITS {
        write_few_fraction_digits(value, count, out)
    } else if value.abs() < 1e21 {
        write_many_fraction_digits(value, count, out)
    } else {
        write_f64(value, short(out))
    };
    Ok(&out[..length])
}

/// `number.toExponential(fractionDigits)`. Without `fraction_digits`, as many as it takes to identify the value.
pub fn to_exponential(
    value: f64,
    fraction_digits: Option<i32>,
    out: &mut Buffer,
) -> Result<&[u8], FormatError> {
    let length = match fraction_digits {
        Some(count @ 0..=100) if value.is_finite() => {
            write_significant_digits(value, count as usize + 1, i32::MIN, out)
        }
        Some(_) if value.is_finite() => return Err(FormatError::ExponentialDigits),
        _ => write_f64_with_exponent(value, short(out)),
    };
    Ok(&out[..length])
}

/// `number.toPrecision(precision)`, which has to be from 1 to 100.
pub fn to_precision(value: f64, precision: i32, out: &mut Buffer) -> Result<&[u8], FormatError> {
    let length = match precision {
        _ if !value.is_finite() => write_f64(value, short(out)),
        1..=100 => write_significant_digits(value, precision as usize, precision, out),
        _ => return Err(FormatError::Precision),
    };
    Ok(&out[..length])
}

#[inline(always)]
fn short(out: &mut Buffer) -> &mut [u8; NUMBER_TEXT_CAPACITY] {
    &mut out.as_chunks_mut().0[0]
}

/// Twice a significand times 10^22 fits in 128 bits.
const MAX_FEW_DIGITS: usize = 22;

/// For a value below 2^53.
#[inline(always)]
fn write_few_fraction_digits(value: f64, count: usize, out: &mut Buffer) -> usize {
    let (significand, exponent) = decompose(value);
    let places = exponent.unsigned_abs();
    let (lower_count, upper_count) = (count.min(16), count.saturating_sub(16));
    let (lower_limit, upper_limit) = (SMALL_POWERS[lower_count], SMALL_POWERS[upper_count]);
    let mut whole = significand.unbounded_shr(places);
    let fraction = significand - whole.unbounded_shl(places);
    let scaled = u128::from(fraction) * u128::from(upper_limit);
    let mut upper = scaled.unbounded_shr(places) as u64;
    let doubled = (scaled * u128::from(2 * lower_limit)).unbounded_shr(places);
    let mut lower = (((doubled + 1) >> 1) as u64).wrapping_sub(upper.wrapping_mul(lower_limit));
    if lower == lower_limit {
        (upper, lower) = (upper + 1, 0);
        if upper == upper_limit {
            (whole, upper) = (whole + 1, 0);
        }
    }

    let point = write_integer(value < 0.0, whole, short(out));
    if count == 0 {
        return point;
    }
    out[point] = b'.';
    let mut at = point + 1;
    let mut append = |digits: u32, count: usize| {
        store(out, at, eight_digits(digits) >> (64 - 8 * count));
        at += count;
    };
    if count <= 8 {
        append(lower as u32, count);
        return at;
    }
    if upper_count != 0 {
        append(upper as u32, upper_count);
    }
    let (middle, lower) = split_sixteen_digits(lower);
    append(middle, lower_count - 8);
    append(lower, 8);
    at
}

fn write_many_fraction_digits(value: f64, count: usize, out: &mut Buffer) -> usize {
    let mut buffer = DigitBuffer::ZEROS;
    let (digits, point) = round_exactly(value, |point| point + count as i32, &mut buffer);
    write_positional(value < 0.0, digits, point, count, out)
}

/// With an exponent unless from -5 to `max_point` digits precede the decimal point.
#[inline(always)]
fn write_significant_digits(value: f64, count: usize, max_point: i32, out: &mut Buffer) -> usize {
    if count > MAX_SCALED_DIGITS || value == 0.0 {
        return write_many_significant_digits(value, count, max_point, out);
    }
    let (digits, point) = round_by_scaling(value, count);
    let digits = digits * SMALL_POWERS[MAX_SCALED_DIGITS - count];
    let ending = Ending {
        last: b'0' + (digits % 10) as u8,
        is_sixteenth: false,
        min_count: count as u8,
    };
    let (out, is_negative) = (short(out), value < 0.0);
    if (-5..=max_point).contains(&point) {
        return write_decimal(out, is_negative, digits / 10, ending, point);
    }
    write_exponential(out, is_negative, digits / 10, ending, point)
}

fn write_many_significant_digits(
    value: f64,
    count: usize,
    max_point: i32,
    out: &mut Buffer,
) -> usize {
    let mut buffer = DigitBuffer::ZEROS;
    let (digits, point) = round_exactly(value, |_| count as i32, &mut buffer);
    if (-5..=max_point).contains(&point) {
        let fraction_digits = (count as i32 - point) as usize;
        return write_positional(value < 0.0, digits, point, fraction_digits, out);
    }
    let end = write_positional(value < 0.0, digits, 1, count - 1, out);
    write_exponent(point - 1, out, end)
}

/// `0.digits * 10^point`
fn write_positional(
    is_negative: bool,
    digits: &[u8],
    point: i32,
    fraction_digits: usize,
    out: &mut Buffer,
) -> usize {
    let start = usize::from(is_negative);
    let (whole, zeros, rest): (&[u8], _, _) = match usize::try_from(point) {
        Ok(point @ 1..) => (&digits[..point], 0, &digits[point..]),
        _ => (b"0", point.unsigned_abs() as usize, digits),
    };
    let point_at = start + whole.len();
    out[0] = b'-';
    out[start..point_at].copy_from_slice(whole);
    if fraction_digits == 0 {
        return point_at;
    }
    out[point_at] = b'.';
    let fraction = &mut out[point_at + 1..][..fraction_digits];
    let (zeros, significant) = fraction.split_at_mut(zeros);
    zeros.fill(b'0');
    significant.copy_from_slice(&rest[..significant.len()]);
    point_at + 1 + fraction_digits
}
