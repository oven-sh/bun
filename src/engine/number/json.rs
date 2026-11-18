use bun_engine_text::{CodeUnit, Text};

use crate::decimal_scanner::{finish_decimal, scan_whole_digits};
use crate::decimal_to_double::from_short_decimal;
use crate::digit_words::{ZEROS, gather_digits, non_digits};
use crate::double::with_sign;
use crate::powers_of_ten::SMALL_POWERS;

#[derive(Clone, Copy, Debug, PartialEq)]
/// What a number of JSON is worth, as the kinds of value that a script sees.
pub enum JsonNumber {
    Int32(i32),
    /// May be an integer too.
    Double(f64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Why the text is no number of JSON.
pub enum JsonNumberError {
    NoDigits,
    NoDigitsAfterPoint,
}

impl JsonNumberError {
    pub fn message(self) -> &'static str {
        match self {
            JsonNumberError::NoDigits => "Invalid number",
            JsonNumberError::NoDigitsAfterPoint => "Invalid digits after decimal point",
        }
    }
}

/// The value and the number of the digits at the start, if they are seven at most and can be the integer part of a
/// number. The first character is a digit.
#[inline(always)]
pub fn parse_few_json_digits(characters: [u8; 8]) -> Option<(i32, u32)> {
    debug_assert!(characters[0].is_ascii_digit());
    let characters = u64::from_le_bytes(characters);
    let stop = non_digits(characters);
    if stop == 0 || characters & 0xf0ff == ZEROS & 0xffff {
        return None;
    }
    let top_bit = stop.trailing_zeros();
    let digits = characters.wrapping_sub(ZEROS).wrapping_shl(71 - top_bit);
    Some((gather_digits(digits) as i32, top_bit / 8))
}

/// The value and the number of digits of a fraction, if they are one to seven. `whole` is from `parse_few_json_digits`,
/// and `characters` follow the point.
#[inline(always)]
pub fn parse_few_json_places(whole: i32, characters: [u8; 8]) -> Option<(f64, u32)> {
    let characters = u64::from_le_bytes(characters);
    let top_bit = non_digits(characters).trailing_zeros();
    let count = top_bit / 8;
    if !(1..8).contains(&count) {
        return None;
    }
    let digits = characters.wrapping_sub(ZEROS).wrapping_shl(71 - top_bit);
    let mantissa = whole as u64 * SMALL_POWERS[count as usize] + gather_digits(digits);
    Some((from_short_decimal(mantissa, -i64::from(count), 14), count))
}

/// `parse_json_number` for where it is not likely to be a small integer. The length is zero if there is no number.
#[inline(never)]
pub fn parse_json_double(units: &[u8]) -> (f64, usize) {
    let start = usize::from(units.first() == Some(&b'-'));
    match scan_whole(units, start) {
        Some((point, whole)) => finish(units, start, point, whole),
        None => (0.0, 0),
    }
}

#[inline(always)]
fn scan_whole<T: CodeUnit>(units: &[T], start: usize) -> Option<(usize, u64)> {
    match units.get(start)? {
        first if first.is(b'0') => Some((start + 1, 0)),
        first if first.is_ascii_digit() => Some(scan_whole_digits(units, start)),
        _ => None,
    }
}

/// The value and the length of the number (ECMA-404) that `units` start with. It ends before a digit that follows a
/// leading zero, and before an exponent that has no digits.
#[inline]
pub fn parse_json_number<T: CodeUnit>(units: &[T]) -> Result<(JsonNumber, usize), JsonNumberError> {
    const MAX_INT32_DIGITS: usize = 9;
    let start = usize::from(units.first().is_some_and(|unit| unit.is(b'-')));
    let (point, whole) = scan_whole(units, start).ok_or(JsonNumberError::NoDigits)?;
    let goes_on = units
        .get(point)
        .is_some_and(|unit| unit.is(b'.') || unit.to_u16() | 0x20 == u16::from(b'e'));
    if !goes_on && point - start <= MAX_INT32_DIGITS {
        let number = match (start, whole as i32) {
            (0, whole) => JsonNumber::Int32(whole),
            (_, 0) => JsonNumber::Double(-0.0),
            (_, whole) => JsonNumber::Int32(-whole),
        };
        return Ok((number, point));
    }
    let (value, end) = match T::text(units) {
        Text::Latin1(units) => finish_latin1(units, start, point, whole),
        Text::Utf16(units) => finish_utf16(units, start, point, whole),
    };
    if end == 0 {
        return Err(JsonNumberError::NoDigitsAfterPoint);
    }
    Ok((JsonNumber::Double(value), end))
}

fn finish_latin1(units: &[u8], start: usize, point: usize, whole: u64) -> (f64, usize) {
    finish(units, start, point, whole)
}

fn finish_utf16(units: &[u16], start: usize, point: usize, whole: u64) -> (f64, usize) {
    finish(units, start, point, whole)
}

/// The end is zero if no digit follows the point.
#[inline(always)]
fn finish<T: CodeUnit>(units: &[T], start: usize, point: usize, whole: u64) -> (f64, usize) {
    if let Some([first, rest @ ..]) = units.get(point..)
        && first.is(b'.')
        && !rest.first().is_some_and(|unit| unit.is_ascii_digit())
    {
        return (0.0, 0);
    }
    match finish_decimal(units, start, point, whole) {
        Some((magnitude, end)) => (with_sign(magnitude, start != 0), end),
        None => (0.0, 0),
    }
}
