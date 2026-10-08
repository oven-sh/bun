//! The conversions between numbers and strings that ECMAScript defines.
//!
//! | JavaScript | here |
//! | --- | --- |
//! | `Number(text)`, `+text` | [`string_to_number`](crate::utils::text::string_to_number) |
//! | `parseInt(text, radix)`, `parseFloat(text)` | [`parse_int`], [`parse_float`] |
//! | `n.toFixed(digits)` | [`to_fixed`] |
//! | `n.toExponential(digits)` | [`to_exponential`] |
//! | `n.toPrecision(precision)` | [`to_precision`], and only its digits and its exponent: [`decimal_digits`] |
//! | `n.toString(radix)` | [`to_radix_string`] |
//! | `n \| 0`, `n >>> 0` | [`to_int32`], [`to_uint32`] |
//! | `String(n)` | [`number_to_string`](crate::utils::text::number_to_string) |

use crate::utils::text::{number_to_string, trim, trim_start};

/// `n | 0`: `ToInt32`.
pub fn to_int32(n: f64) -> i32 {
    to_uint32(n) as i32
}

/// `n >>> 0`: `ToUint32`.
pub fn to_uint32(n: f64) -> u32 {
    if !n.is_finite() {
        return 0;
    }
    n.trunc().rem_euclid(4_294_967_296.0) as u32
}

/// The length of the `StrUnsignedDecimalLiteral` that `text` starts with, without `Infinity`.
fn decimal_literal_len(text: &[u8]) -> usize {
    let digits = |from: usize| {
        text.get(from..)
            .unwrap_or_default()
            .iter()
            .take_while(|c| c.is_ascii_digit())
            .count()
    };
    let whole = digits(0);
    let mut len = whole;
    let mut fraction = 0;
    if text.get(len) == Some(&b'.') {
        fraction = digits(len + 1);
        if whole + fraction > 0 {
            len += 1 + fraction;
        }
    }
    if whole + fraction == 0 {
        return 0;
    }
    if matches!(text.get(len), Some(b'e' | b'E')) {
        let sign = usize::from(matches!(text.get(len + 1), Some(b'+' | b'-')));
        let exponent = digits(len + 1 + sign);
        if exponent > 0 {
            len += 1 + sign + exponent;
        }
    }
    len
}

/// The value of ASCII text that `decimal_literal_len` accepts.
fn decimal_value(text: &[u8]) -> f64 {
    std::str::from_utf8(text)
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(f64::NAN)
}

/// The number that `digits` are in `radix`. `None` if it is not a number, or has more digits than
/// can be rounded correctly here.
fn integer_value(digits: &[u8], radix: u32) -> Option<f64> {
    if radix == 10 {
        return Some(decimal_value(digits));
    }
    let mut value: u128 = 0;
    for &digit in digits {
        let digit = char::from(digit).to_digit(radix)?;
        value = value
            .checked_mul(u128::from(radix))?
            .checked_add(u128::from(digit))?;
    }
    Some(value as f64)
}

fn split_sign(text: &[u8]) -> (f64, &[u8]) {
    match text {
        [b'-', rest @ ..] => (-1.0, rest),
        [b'+', rest @ ..] => (1.0, rest),
        _ => (1.0, text),
    }
}

/// `Number(text)`: `StringToNumber`. `None` for more digits in a radix other than 10 than can be
/// rounded correctly here.
pub(super) fn string_to_number(text: &[u8]) -> Option<f64> {
    let text = trim(text);
    if text.is_empty() {
        return Some(0.0);
    }
    if let [b'0', prefix, digits @ ..] = text
        && let Some(radix) = match prefix {
            b'x' | b'X' => Some(16),
            b'o' | b'O' => Some(8),
            b'b' | b'B' => Some(2),
            _ => None,
        }
    {
        if digits.is_empty() || !digits.iter().all(|&c| char::from(c).is_digit(radix)) {
            return Some(f64::NAN);
        }
        return integer_value(digits, radix);
    }
    let (sign, unsigned) = split_sign(text);
    if unsigned == b"Infinity" {
        return Some(sign * f64::INFINITY);
    }
    Some(match decimal_literal_len(unsigned) == unsigned.len() {
        true => sign * decimal_value(unsigned),
        false => f64::NAN,
    })
}

/// `parseFloat(text)`
pub fn parse_float(text: &[u8]) -> f64 {
    let (sign, unsigned) = split_sign(trim_start(text));
    if unsigned.starts_with(b"Infinity") {
        return sign * f64::INFINITY;
    }
    match decimal_literal_len(unsigned) {
        0 => f64::NAN,
        len => sign * decimal_value(&unsigned[..len]),
    }
}

/// `parseInt(text, radix)`, where `radix` has gone through `ToInt32`. `None` if the result cannot
/// be computed here.
pub fn parse_int(text: &[u8], radix: i32) -> Option<f64> {
    let (sign, mut digits) = split_sign(trim_start(text));
    let mut radix = radix;
    if radix != 0 && !(2..=36).contains(&radix) {
        return Some(f64::NAN);
    }
    if matches!(radix, 0 | 16)
        && let [b'0', b'x' | b'X', rest @ ..] = digits
    {
        digits = rest;
        radix = 16;
    }
    let radix = if radix == 0 { 10 } else { radix as u32 };
    let len = digits
        .iter()
        .take_while(|&&c| char::from(c).is_digit(radix))
        .count();
    if len == 0 {
        return Some(f64::NAN);
    }
    Some(sign * integer_value(&digits[..len], radix)?)
}

/// The decimal digits of a finite `n > 0`, all of them, and the exponent of the first:
/// `n == d1.d2d3.. * 10 ** exponent`.
fn exact_digits(n: f64) -> (Vec<u8>, i32) {
    // A double has at most 767 significant digits.
    let text = format!("{n:.800e}");
    let (mantissa, exponent) = text
        .as_bytes()
        .split_at(text.len() - text.bytes().rev().take_while(|&c| c != b'e').count());
    let digits = mantissa
        .iter()
        .copied()
        .filter(u8::is_ascii_digit)
        .collect();
    (
        digits,
        std::str::from_utf8(exponent)
            .ok()
            .and_then(|it| it.parse().ok())
            .unwrap_or(0),
    )
}

/// Rounds `digits` to the first `count`, half up. Returns whether that carried into a new first
/// digit, which makes the exponent one more.
fn round_digits(digits: &mut Vec<u8>, count: usize) -> bool {
    let rounds_up = digits.get(count).is_some_and(|&next| next >= b'5');
    digits.resize(count, b'0');
    if !rounds_up {
        return false;
    }
    for digit in digits.iter_mut().rev() {
        if *digit != b'9' {
            *digit += 1;
            return false;
        }
        *digit = b'0';
    }
    digits.insert(0, b'1');
    digits.truncate(count.max(1));
    true
}

/// `n.toPrecision(precision)` in parts: the first `precision` decimal digits of the absolute value
/// of a finite `n`, rounded half up as JavaScript does, and the exponent of the first:
/// `d1.d2d3.. * 10 ** exponent`. For 0 the digits are zeros and the exponent is 0.
pub fn decimal_digits(n: f64, precision: usize) -> (Vec<u8>, i32) {
    let (mut digits, mut exponent) = (vec![b'0'], 0);
    if n != 0.0 {
        (digits, exponent) = exact_digits(n.abs());
    }
    exponent += i32::from(round_digits(&mut digits, precision));
    (digits, exponent)
}

fn with_sign(n: f64, unsigned: Vec<u8>) -> Vec<u8> {
    match n < 0.0 {
        true => [b"-", &unsigned[..]].concat(),
        false => unsigned,
    }
}

/// `n.toFixed(digits)` for `digits` in `0..=100`.
pub fn to_fixed(n: f64, fraction_digits: usize) -> Vec<u8> {
    if !n.is_finite() || n.abs() >= 1e21 {
        return number_to_string(n);
    }
    let mut digits = vec![b'0'];
    let mut exponent = 0;
    if n != 0.0 {
        (digits, exponent) = exact_digits(n.abs());
    }
    // As many zeros in front as it takes for the first digit to be that of the units.
    if exponent < 0 {
        digits.splice(
            0..0,
            std::iter::repeat_n(b'0', exponent.unsigned_abs() as usize),
        );
        exponent = 0;
    }
    let mut whole = exponent as usize + 1;
    if round_digits(&mut digits, whole + fraction_digits) {
        whole += 1;
        digits.push(b'0');
    }
    if fraction_digits > 0 {
        digits.insert(whole, b'.');
    }
    with_sign(n, digits)
}

fn exponential(digits: &[u8], exponent: i32) -> Vec<u8> {
    let mut text = Vec::with_capacity(digits.len() + 6);
    text.extend_from_slice(digits.get(..1).unwrap_or(b"0"));
    if let Some(fraction @ [_, ..]) = digits.get(1..) {
        text.push(b'.');
        text.extend_from_slice(fraction);
    }
    text.extend_from_slice(if exponent < 0 { b"e-" } else { b"e+" });
    text.extend_from_slice(exponent.unsigned_abs().to_string().as_bytes());
    text
}

/// `n.toExponential(digits)` for `digits` in `0..=100`, or `undefined`: as many as necessary.
pub fn to_exponential(n: f64, fraction_digits: Option<usize>) -> Vec<u8> {
    if !n.is_finite() {
        return number_to_string(n);
    }
    let (mut digits, mut exponent) = (vec![b'0'], 0);
    match fraction_digits {
        None if n != 0.0 => {
            // The shortest digits that read back as `n`.
            let text = format!("{:e}", n.abs());
            let at = text.len() - text.bytes().rev().take_while(|&c| c != b'e').count();
            digits = text.as_bytes()[..at]
                .iter()
                .copied()
                .filter(u8::is_ascii_digit)
                .collect();
            exponent = text[at..].parse().unwrap_or(0);
        }
        None => {}
        Some(count) => (digits, exponent) = decimal_digits(n, count + 1),
    }
    with_sign(n, exponential(&digits, exponent))
}

/// `n.toPrecision(precision)` for `precision` in `1..=100`.
pub fn to_precision(n: f64, precision: usize) -> Vec<u8> {
    if !n.is_finite() {
        return number_to_string(n);
    }
    let (mut digits, exponent) = decimal_digits(n, precision);
    if exponent < -6 || exponent >= precision as i32 {
        return with_sign(n, exponential(&digits, exponent));
    }
    if exponent < 0 {
        let zeros = std::iter::repeat_n(b'0', exponent.unsigned_abs() as usize - 1);
        digits.splice(0..0, b"0.".iter().copied().chain(zeros));
    } else if exponent as usize + 1 < precision {
        digits.insert(exponent as usize + 1, b'.');
    }
    with_sign(n, digits)
}

/// `n.toString(radix)` for `radix` in `2..=36`, otherwise in 10. The specification leaves the digits open for a
/// radix other than 10: this is the algorithm of V8.
pub fn to_radix_string(n: f64, radix: u32) -> Vec<u8> {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if radix == 10 || !(2..=36).contains(&radix) || !n.is_finite() {
        return number_to_string(n);
    }
    let base = f64::from(radix);
    let value = n.abs();
    let mut integer = value.floor();
    let mut fraction = value - integer;
    // Half the distance to the next number: digits beyond it say nothing.
    let mut delta = (0.5 * (value.next_up() - value)).max(5e-324);
    let mut fraction_digits: Vec<u8> = Vec::new();
    if fraction >= delta {
        loop {
            fraction *= base;
            delta *= base;
            let digit = fraction as u8;
            fraction_digits.push(digit);
            fraction -= f64::from(digit);
            if (fraction > 0.5 || (fraction == 0.5 && digit & 1 == 1)) && fraction + delta > 1.0 {
                // Round up, with the carry.
                loop {
                    match fraction_digits.pop() {
                        None => {
                            integer += 1.0;
                            break;
                        }
                        Some(digit) if u32::from(digit) + 1 < radix => {
                            fraction_digits.push(digit + 1);
                            break;
                        }
                        Some(_) => {}
                    }
                }
                break;
            }
            if fraction < delta {
                break;
            }
        }
    }
    // The least significant first.
    let mut digits: Vec<u8> = Vec::new();
    while integer / base >= 9_007_199_254_740_992.0 {
        integer /= base;
        digits.push(b'0');
    }
    loop {
        let remainder = integer % base;
        digits.push(DIGITS[remainder as usize % 36]);
        integer = (integer - remainder) / base;
        if integer <= 0.0 {
            break;
        }
    }
    if n < 0.0 {
        digits.push(b'-');
    }
    digits.reverse();
    if !fraction_digits.is_empty() {
        digits.push(b'.');
        digits.extend(
            fraction_digits
                .iter()
                .map(|&digit| DIGITS[usize::from(digit) % 36]),
        );
    }
    digits
}
