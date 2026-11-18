use bun_engine_text::{CodeUnit, Text};

use crate::convert::MAX_SAFE_INTEGER;
use crate::decimal_scanner::{long_decimal, scan_sign, scan_whole_digits};
use crate::decimal_to_double::MAX_SHORT_DIGITS;
use crate::double::with_sign;
use crate::radix_scanner::{digit_value, scan_binary_integer};
use crate::string_to_number::trim_start;

/// What `parseInt` returns for a string. `radix` is the result of ToInt32.
#[inline]
pub fn parse_int(text: Text<'_>, radix: i32) -> f64 {
    fn latin1(units: &[u8], radix: i32) -> f64 {
        parse(units, radix)
    }
    fn utf16(units: &[u16], radix: i32) -> f64 {
        parse(units, radix)
    }
    match text {
        Text::Latin1(units) => latin1(units, radix),
        Text::Utf16(units) => utf16(units, radix),
    }
}

/// What `parseInt` returns for a number in radix 10, where that takes no text.
#[inline]
pub fn parse_int_of_number(value: f64) -> Option<f64> {
    if value == 0.0 {
        return Some(0.0);
    }
    let is_positional = value >= 1e-6 || value <= -1.0;
    (is_positional && value.abs() <= MAX_SAFE_INTEGER).then(|| value.trunc())
}

#[inline(always)]
fn parse<T: CodeUnit>(units: &[T], radix: i32) -> f64 {
    let starts_with_nonzero_digit = |unit: &T| unit.is_ascii_digit() && !unit.is(b'0');
    if (radix == 10 || radix == 0) && units.first().is_some_and(starts_with_nonzero_digit) {
        return scan_decimal_integer(units).0;
    }
    parse_in_general(units, radix)
}

#[inline(never)]
fn parse_in_general<T: CodeUnit>(units: &[T], radix: i32) -> f64 {
    let units = trim_start(units);
    let (is_negative, start) = scan_sign(units, 0);
    let (digits, radix) = match (&units[start..], radix) {
        ([zero, x, rest @ ..], 0 | 16) if zero.is(b'0') && (x.is(b'x') || x.is(b'X')) => (rest, 16),
        (digits, 0) => (digits, 10),
        (digits, 2..=36) => (digits, radix as u32),
        _ => return f64::NAN,
    };
    let (magnitude, count) = if radix == 10 {
        scan_decimal_integer(digits)
    } else if radix.is_power_of_two() {
        scan_binary_integer(digits, radix)
    } else {
        scan_approximately(digits, radix)
    };
    if count == 0 {
        return f64::NAN;
    }
    with_sign(magnitude, is_negative)
}

#[inline(always)]
fn scan_decimal_integer<T: CodeUnit>(units: &[T]) -> (f64, usize) {
    let (count, value) = scan_whole_digits(units, 0);
    if count >= MAX_SHORT_DIGITS {
        return (long_decimal(&units[..count], &[], 0), count);
    }
    (value as i64 as f64, count)
}

/// From 2^53 on each digit rounds, which ECMA-262 allows in these radices.
fn scan_approximately<T: CodeUnit>(units: &[T], radix: u32) -> (f64, usize) {
    let mut digits = units.iter().map_while(|&unit| digit_value(unit, radix));
    let (mut exact, mut count) = (0i64, 0);
    while exact < 1 << 47 {
        let Some(digit) = digits.next() else {
            return (exact as f64, count);
        };
        exact = exact * i64::from(radix) + i64::from(digit);
        count += 1;
    }
    digits.fold((exact as f64, count), |(value, count), digit| {
        (value * f64::from(radix) + f64::from(digit), count + 1)
    })
}
