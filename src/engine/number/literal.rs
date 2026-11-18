//! Values of the numeric literals of source text, whose syntax the lexer has checked.

use bun_engine_text::CodeUnit;

use crate::decimal_to_double::from_long_decimal;
use crate::parse_decimal_prefix;
use crate::radix_scanner::{BinaryInteger, digit_value};

/// The value of a DecimalLiteral, which may have separators.
#[inline]
pub fn decimal_literal_value<T: CodeUnit>(literal: &[T]) -> f64 {
    match parse_decimal_prefix(literal) {
        Some((value, length)) if length == literal.len() => value,
        _ => separated_decimal_value(literal),
    }
}

#[cold]
fn separated_decimal_value<T: CodeUnit>(literal: &[T]) -> f64 {
    fn digits<T: CodeUnit>(units: &[T]) -> impl Iterator<Item = u8> + Clone {
        units
            .iter()
            .filter_map(|unit| unit.digit_value(10).map(|digit| digit as u8))
    }
    let mut parts = literal.splitn(2, |unit| unit.is(b'e') || unit.is(b'E'));
    let mantissa = parts.next().unwrap_or_default();
    let exponent_part = parts.next().unwrap_or_default();
    let whole = mantissa.split(|unit| unit.is(b'.')).next();
    let whole_count = digits(whole.unwrap_or_default()).count();
    let zeros = digits(mantissa).take_while(|&digit| digit == 0).count();
    let exponent = digits(exponent_part).fold(0i64, |exponent, digit| {
        (exponent * 10 + i64::from(digit)).min(1 << 56)
    });
    let is_negative = exponent_part.first().is_some_and(|unit| unit.is(b'-'));
    from_long_decimal(
        digits(mantissa).skip(zeros),
        whole_count as i64 - zeros as i64 + if is_negative { -exponent } else { exponent },
    )
}

/// The value of the digits of a literal in radix 2, 8 or 16: what follows its prefix, which may have separators.
pub fn radix_literal_value<T: CodeUnit>(digits: &[T], radix: u32) -> f64 {
    let mut integer = BinaryInteger::new(radix);
    for digit in digits.iter().filter_map(|&unit| digit_value(unit, radix)) {
        integer.push(digit);
    }
    integer.value()
}
