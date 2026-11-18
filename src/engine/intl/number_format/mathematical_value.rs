use bun_engine_bigint::{BigIntRef, Poll};
use bun_engine_number::{NumberText, string_to_number};
use bun_engine_text::{CodeUnit, Text, with_text};
use bun_engine_unicode::is_str_white_space;
use bun_icu::number_format::{
    FormattedNumber, FormattedNumberRange, MAX_DECIMAL_LENGTH, NumberFormatter,
    NumberRangeFormatter,
};

use super::DigitOptions;
use crate::{Error, Result};

type Decimal = bun_icu::Buffer<u8>;

/// The result of ToIntlMathematicalValue.
#[derive(Clone, Debug)]
pub struct MathematicalValue(Representation);

#[derive(Clone, Debug)]
enum Representation {
    Number(f64),
    /// Of a finite value that no Number has.
    Decimal(Decimal),
    /// An integer with more digits than can be formatted.
    TooLong,
}

/// How ICU is given a Number.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum NumberInput {
    Double,
    /// It rounds to an increment from an estimate of the last digits of a double.
    Decimal,
}

impl From<&DigitOptions> for NumberInput {
    fn from(options: &DigitOptions) -> NumberInput {
        match options.rounding_increment.get() {
            1 => NumberInput::Double,
            _ => NumberInput::Decimal,
        }
    }
}

impl From<f64> for MathematicalValue {
    #[inline]
    fn from(number: f64) -> MathematicalValue {
        let number = if number.is_nan() { f64::NAN } else { number };
        MathematicalValue(Representation::Number(number))
    }
}

impl MathematicalValue {
    pub fn from_bigint(value: BigIntRef<'_>, poll: Poll<'_>) -> Result<MathematicalValue> {
        if let Some(number) = value.to_safe_integer() {
            return Ok(number.into());
        }
        let capacity = value.max_text_length(10);
        if capacity > MAX_DECIMAL_LENGTH {
            return Ok(MathematicalValue(Representation::TooLong));
        }
        let mut decimal = Decimal::new();
        decimal.try_reserve_exact(capacity)?;
        decimal.resize(capacity, 0);
        let length = value.write_text(10, &mut decimal, poll)?.len();
        decimal.drain(..capacity - length);
        Ok(MathematicalValue(Representation::Decimal(decimal)))
    }

    pub fn from_string(text: Text<'_>) -> Result<MathematicalValue> {
        let number = string_to_number(text);
        if number == 0.0 || !number.is_finite() {
            return Ok(number.into());
        }
        let exact = with_text!(text, |units| match trim(units) {
            [_, radix, ..] if radix.is_ascii_alphabetic() && !is_exponent_mark(*radix) => {
                let integer = bun_engine_bigint::from_string(text)?.into_owned(&mut || false)?;
                return MathematicalValue::from_bigint(integer.as_ref(), &mut || false);
            }
            literal => decimal_unless_short(literal),
        });
        Ok(match exact {
            Some(decimal) => MathematicalValue(Representation::Decimal(decimal)),
            None => number.into(),
        })
    }

    #[inline]
    pub(crate) fn as_number(&self) -> Option<f64> {
        match self.0 {
            Representation::Number(number) => Some(number),
            _ => None,
        }
    }

    pub(crate) fn is_nan(&self) -> bool {
        self.as_number().is_some_and(f64::is_nan)
    }

    pub(crate) fn is_infinite(&self) -> bool {
        self.as_number().is_some_and(f64::is_infinite)
    }

    pub(crate) fn is_negative(&self) -> bool {
        match &self.0 {
            Representation::Number(number) => number.is_sign_negative(),
            Representation::Decimal(decimal) => decimal.starts_with(b"-"),
            Representation::TooLong => false,
        }
    }

    pub(crate) fn format(
        &self,
        formatter: &NumberFormatter,
        input: NumberInput,
        result: &mut FormattedNumber,
    ) -> bun_icu::Result<()> {
        match self.as_double(input) {
            Some(number) => formatter.format_double(number, result),
            None => self.with_decimal(|decimal| formatter.format_decimal(decimal, result)),
        }
    }

    pub(crate) fn format_range_to(
        &self,
        end: &MathematicalValue,
        formatter: &NumberRangeFormatter,
        input: NumberInput,
    ) -> bun_icu::Result<FormattedNumberRange> {
        match (self.as_double(input), end.as_double(input)) {
            (Some(start), Some(end)) => formatter.format_doubles(start, end),
            _ => self.with_decimal(|start| {
                end.with_decimal(|end| formatter.format_decimals(start, end))
            }),
        }
    }

    fn as_double(&self, input: NumberInput) -> Option<f64> {
        self.as_number().filter(|_| input == NumberInput::Double)
    }

    fn with_decimal<T>(
        &self,
        with: impl FnOnce(&[u8]) -> bun_icu::Result<T>,
    ) -> bun_icu::Result<T> {
        match &self.0 {
            Representation::Number(zero) if *zero == 0.0 && zero.is_sign_negative() => with(b"-0"),
            Representation::Number(number) => with(&NumberText::from(*number)),
            Representation::Decimal(decimal) => with(decimal),
            Representation::TooLong => Err(bun_icu::Error::ILLEGAL_ARGUMENT),
        }
    }
}

fn trim<T: CodeUnit>(mut units: &[T]) -> &[T] {
    while let [first, rest @ ..] = units
        && is_str_white_space(first.to_u32())
    {
        units = rest;
    }
    while let [rest @ .., last] = units
        && is_str_white_space(last.to_u32())
    {
        units = rest;
    }
    units
}

fn is_exponent_mark<T: CodeUnit>(unit: T) -> bool {
    unit.is(b'e') || unit.is(b'E')
}

/// `literal` is a StrDecimalLiteral that is nearest to a finite Number other than zero. `None` if that Number has the
/// same shortest digits.
fn decimal_unless_short<T: CodeUnit>(literal: &[T]) -> Option<Decimal> {
    /// So many digits survive the conversion to a normal Number and back.
    const SHORT_DIGITS: usize = 15;
    const MIN_NORMAL_MAGNITUDE: i64 = -307;
    /// More than the largest Number has before the point and any format shows after it.
    const MAX_DIGITS: usize = 448;

    let mut decimal = Decimal::new();
    if literal.first().is_some_and(|sign| sign.is(b'-')) {
        decimal.push(b'-');
    }
    let sign_length = decimal.len();
    let mantissa_length = (literal.iter())
        .take_while(|&&unit| !is_exponent_mark(unit))
        .count();
    let (mantissa, exponent) = literal.split_at(mantissa_length);

    // Of the last digit in `decimal`.
    let mut magnitude = parse_exponent(exponent);
    let mut is_after_point = false;
    let mut drops_nonzero_digit = false;
    for &unit in mantissa {
        is_after_point |= unit.is(b'.');
        if !unit.is_ascii_digit() {
            continue;
        }
        let digit_count = decimal.len() - sign_length;
        if digit_count == MAX_DIGITS {
            drops_nonzero_digit |= !unit.is(b'0');
            magnitude += i64::from(!is_after_point);
            continue;
        }
        if digit_count != 0 || !unit.is(b'0') {
            decimal.push(unit.to_u16() as u8);
        }
        magnitude -= i64::from(is_after_point);
    }
    if drops_nonzero_digit {
        decimal.push(b'1');
        magnitude -= 1;
    }
    while decimal.last() == Some(&b'0') {
        decimal.pop();
        magnitude += 1;
    }
    if decimal.len() - sign_length <= SHORT_DIGITS && magnitude >= MIN_NORMAL_MAGNITUDE {
        return None;
    }
    decimal.push(b'E');
    decimal.extend_from_slice(&NumberText::from(magnitude));
    Some(decimal)
}

/// `exponent` is an ExponentPart that the digits of a string can offset, or empty.
fn parse_exponent<T: CodeUnit>(exponent: &[T]) -> i64 {
    let digits = exponent.iter().filter_map(|unit| unit.digit_value(10));
    let value = digits.fold(0i64, |value, digit| {
        (value * 10 + i64::from(digit)).min(i64::from(u32::MAX))
    });
    if exponent.get(1).is_some_and(|sign| sign.is(b'-')) {
        -value
    } else {
        value
    }
}

impl From<bun_engine_bigint::Error> for Error {
    fn from(error: bun_engine_bigint::Error) -> Error {
        match error {
            bun_engine_bigint::Error::Interrupted => Error::Interrupted,
            _ => Error::OutOfMemory,
        }
    }
}
