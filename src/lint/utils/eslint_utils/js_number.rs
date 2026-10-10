//! The conversions between numbers and strings that ECMAScript defines.
//!
//! | JavaScript | here |
//! | --- | --- |
//! | `Number(text)`, `+text` | [`bun_core::fmt::js_string_to_number`] |
//! | `parseInt(text, radix)`, `parseFloat(text)` | [`parse_int`], [`parse_float`] |
//! | `n.toFixed(digits)`, `n.toExponential(digits)`, `n.toPrecision(precision)` | [`bun_core::fmt::FormatDouble`]: `to_fixed`, `to_exponential`, `to_precision` |
//! | `n.toString(radix)` | [`to_radix_string`] |
//! | `n \| 0`, `n >>> 0` | [`to_int32`], [`to_uint32`] |
//! | `String(n)` | [`number_to_string`](crate::utils::text::number_to_string) |

use crate::utils::text::number_to_string;

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

/// The value of ASCII text that `js_decimal_literal_len` accepts.
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

/// `parseFloat(text)`
pub fn parse_float(text: &[u8]) -> f64 {
    let (sign, unsigned) = split_sign(bun_core::strings::trim_js_whitespace_start(text));
    if unsigned.starts_with(b"Infinity") {
        return sign * f64::INFINITY;
    }
    match bun_core::fmt::js_decimal_literal_len(unsigned) {
        0 => f64::NAN,
        len => sign * decimal_value(&unsigned[..len]),
    }
}

/// `parseInt(text, radix)`, where `radix` has gone through `ToInt32`. `None` if the result cannot
/// be computed here.
pub fn parse_int(text: &[u8], radix: i32) -> Option<f64> {
    let (sign, mut digits) = split_sign(bun_core::strings::trim_js_whitespace_start(text));
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

/// `n.toString(radix)` for `radix` in `2..=36`, otherwise in 10. The specification leaves the digits open for a
/// radix other than 10: this is the algorithm of V8, on which ESLint runs. JavaScriptCore writes other digits for one number
/// in four.
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
