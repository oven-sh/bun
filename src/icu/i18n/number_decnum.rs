//! Decimal numbers of any length, with exponents of up to nine digits. ICU4C: number_utils.cpp, decNumber.cpp

use crate::common::memory::{try_filled, try_to_vec};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::utypes::*;
use std::cmp::Ordering;
use std::num::NonZero;
use std::ops::{Deref, DerefMut};

/// Maximum absolute power of ten of the most significant digit.
const MAX_MAGNITUDE: i32 = 999_999_999;
/// The minimum precision of a result. A longer left operand raises it to its own length.
const DEFAULT_DIGITS: usize = 34;

const INLINE_DIGITS: usize = 40;

/// Storage for one digit per byte. It may be longer than the number.
pub(crate) enum DigitBytes {
    Inline([u8; INLINE_DIGITS]),
    Heap(Vec<u8>),
}

impl Default for DigitBytes {
    fn default() -> Self {
        Self::Heap(Vec::new())
    }
}

impl Deref for DigitBytes {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        match self {
            Self::Inline(digits) => digits,
            Self::Heap(digits) => digits,
        }
    }
}

impl DerefMut for DigitBytes {
    fn deref_mut(&mut self) -> &mut [u8] {
        match self {
            Self::Inline(digits) => digits,
            Self::Heap(digits) => digits,
        }
    }
}

impl DigitBytes {
    /// Returns at least `count` zeros.
    #[inline]
    fn zeros(count: usize) -> Result<Self, UErrorCode> {
        if count <= INLINE_DIGITS {
            Ok(Self::Inline([0; _]))
        } else {
            try_filled(0, count).map(Self::Heap)
        }
    }

    pub(crate) fn copy_of(digits: &[u8]) -> Result<Self, UErrorCode> {
        if digits.len() > INLINE_DIGITS {
            return try_to_vec(digits).map(Self::Heap);
        }
        let mut array = [0; _];
        array.copy_at(0, digits);
        Ok(Self::Inline(array))
    }
}

#[derive(Default)]
pub(crate) struct DecNum {
    is_infinite: bool,
    is_negative: bool,
    /// Power of ten of the least significant digit.
    exponent: i32,
    /// Least significant first. Only the first `count` bytes are valid.
    bytes: DigitBytes,
    /// Number of digits: 0 for zero and infinity.
    count: usize,
}

fn without_leading_zeros(digits: &[u8]) -> &[u8] {
    digits.slice(digits.iter().take_while(|&&c| c == b'0').count()..)
}

fn without_trailing_zeros(digits: &[u8]) -> &[u8] {
    digits.slice(..digits.len() - digits.iter().rev().take_while(|&&c| c == b'0').count())
}

/// The parts of a text such as "12.5e-3".
struct DecimalLiteral<'a> {
    integer: &'a [u8],
    fraction: &'a [u8],
    /// Clamped to ±`u32::MAX`.
    exponent: i64,
}

fn split_sign(text: &[u8]) -> (bool, &[u8]) {
    match text {
        [b'-', rest @ ..] => (true, rest),
        [b'+', rest @ ..] => (false, rest),
        _ => (false, text),
    }
}

fn split_digits(text: &[u8]) -> (&[u8], &[u8]) {
    text.split_while(u8::is_ascii_digit)
}

impl<'a> DecimalLiteral<'a> {
    fn parse(text: &'a [u8]) -> Option<Self> {
        let (integer, rest) = split_digits(text);
        let (fraction, rest) = if let [b'.', rest @ ..] = rest {
            split_digits(rest)
        } else {
            (&[][..], rest)
        };
        if integer.is_empty() && fraction.is_empty() {
            return None;
        }
        let exponent = match rest {
            [] => 0,
            [b'e' | b'E', rest @ ..] => {
                let (is_negative, rest) = split_sign(rest);
                let (digits @ [_, ..], []) = split_digits(rest) else {
                    return None;
                };
                let value = digits.iter().fold(0, |sum, &c| {
                    (sum * 10 + i64::from(c - b'0')).min(u32::MAX.into())
                });
                if is_negative { -value } else { value }
            }
            _ => return None,
        };
        Some(Self {
            integer,
            fraction,
            exponent,
        })
    }
}

impl DecNum {
    /// Parses "-12.5e3" or "-infinity" and drops trailing zeros.
    pub(crate) fn parse(text: &[u8]) -> Result<Self, UErrorCode> {
        if text.len() >= i32::MAX as usize {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let precision = text.len().max(DEFAULT_DIGITS) as i32;
        let (is_negative, text) = split_sign(text);
        if text == b"infinity" {
            return Ok(Self::infinity(is_negative));
        }
        let DecimalLiteral {
            integer,
            fraction,
            exponent,
        } = DecimalLiteral::parse(text).ok_or(U_DECIMAL_NUMBER_SYNTAX_ERROR)?;
        let exponent =
            i32::try_from(exponent - fraction.len() as i64).map_err(|_| U_UNSUPPORTED_ERROR)?;

        let integer = without_leading_zeros(integer);
        let fraction = if integer.is_empty() {
            without_leading_zeros(fraction)
        } else {
            fraction
        };
        let length = (integer.len() + fraction.len()) as i32;
        // Zero counts as one digit and has a lower minimum exponent. The lower bounds wrap for more than 10^9 digits.
        let is_too_low = exponent < (-MAX_MAGNITUDE).wrapping_sub(length.max(1) - 1)
            && (length != 0 || exponent < (-MAX_MAGNITUDE).wrapping_sub(precision - 1));
        if is_too_low || exponent > MAX_MAGNITUDE - (length.max(1) - 1) {
            return Err(U_UNSUPPORTED_ERROR);
        }

        let fraction = without_trailing_zeros(fraction);
        let integer = if fraction.is_empty() {
            without_trailing_zeros(integer)
        } else {
            integer
        };
        let count = integer.len() + fraction.len();
        let exponent = exponent + (length - count as i32);
        let mut number = Self {
            is_infinite: false,
            is_negative,
            exponent,
            bytes: DigitBytes::zeros(count)?,
            count,
        };
        let (low, high) = number
            .bytes
            .split_at_mut_checked(fraction.len())
            .soft_unwrap();
        low.iter_mut()
            .zip(fraction.iter().rev())
            .for_each(|(digit, c)| *digit = c - b'0');
        high.iter_mut()
            .zip(integer.iter().rev())
            .for_each(|(digit, c)| *digit = c - b'0');
        Ok(number)
    }

    fn infinity(is_negative: bool) -> Self {
        Self {
            is_infinite: true,
            is_negative,
            ..Self::default()
        }
    }

    /// Returns `digits` (least significant first) * 10^`exponent`.
    pub(crate) fn from_digits(
        digits: &[u8],
        exponent: i32,
        is_negative: bool,
    ) -> Result<Self, UErrorCode> {
        let count = digits.len();
        if !(1..=999_999_999).contains(&count)
            || !is_in_range(i64::from(exponent) + count as i64 - 1)
        {
            return Err(U_UNSUPPORTED_ERROR);
        }
        Ok(Self {
            is_negative,
            exponent,
            bytes: DigitBytes::copy_of(digits)?,
            count,
            ..Self::default()
        })
    }

    fn precision(&self) -> usize {
        self.count.max(DEFAULT_DIGITS)
    }

    /// Returns the exact product of two finite numbers other than zero. Fails if it exceeds the precision or the range.
    pub(crate) fn multiply(&self, rhs: &DecNum) -> Result<Self, UErrorCode> {
        // The product has this many digits or one fewer.
        let max_digits = self.count + rhs.count;
        if max_digits - 1 > self.precision() {
            return Err(U_INTERNAL_PROGRAM_ERROR);
        }
        let mut bytes = DigitBytes::zeros(max_digits)?;
        for (shift, &factor) in rhs.digits().iter().enumerate() {
            let mut carry = 0;
            for (sum, &digit) in bytes
                .iter_mut()
                .skip(shift)
                .zip(self.digits().iter().chain(&[0]))
            {
                carry += u32::from(*sum) + u32::from(digit) * u32::from(factor);
                *sum = (carry % 10) as u8;
                carry /= 10;
            }
        }
        let count = max_digits - usize::from(bytes.at(max_digits - 1) == 0);
        let exponent = i64::from(self.exponent) + i64::from(rhs.exponent);
        if count > self.precision() || !is_in_range(exponent + count as i64 - 1) {
            return Err(U_INTERNAL_PROGRAM_ERROR);
        }
        Ok(Self {
            is_infinite: false,
            is_negative: self.is_negative != rhs.is_negative,
            exponent: exponent as i32,
            bytes,
            count,
        })
    }

    /// Returns the quotient of two finite numbers, rounded half to even. `rhs` is not zero and has at most 5 digits.
    pub(crate) fn divide(&self, rhs: &DecNum) -> Result<Self, UErrorCode> {
        debug_assert!(rhs.count <= 5);
        let divisor = rhs
            .digits()
            .iter()
            .rev()
            .fold(0, |divisor, &digit| divisor * 10 + u32::from(digit));
        let divisor = NonZero::new(divisor).ok_or(U_INTERNAL_PROGRAM_ERROR)?;

        // Long division to one digit more than the precision, most significant digit first.
        let precision = self.precision();
        let (mut bytes, mut count) = (DigitBytes::zeros(precision + 1)?, 0);
        let mut exponent = i64::from(self.exponent) - i64::from(rhs.exponent) + self.count as i64;
        let (mut dividend, mut remainder) = (self.digits().iter().rev(), 0);
        while count <= precision {
            let next = dividend.next();
            if next.is_none() && remainder == 0 {
                break;
            }
            remainder = remainder * 10 + next.map_or(0, |&digit| u32::from(digit));
            if remainder >= divisor.get() || count != 0 {
                let digit = remainder / divisor;
                remainder -= digit * divisor.get();
                bytes.set(count, digit as u8);
                count += 1;
            }
            exponent -= 1;
        }

        // A subnormal quotient keeps fewer digits, or none. It is an error unless it is also inexact.
        let magnitude = exponent + count as i64 - 1;
        let result_exponent =
            exponent.max(magnitude.max(-i64::from(MAX_MAGNITUDE)) - precision as i64 + 1);
        let kept = usize::try_from(magnitude - result_exponent + 1);
        let (head, dropped) = (
            bytes.slice(..kept.unwrap_or(0)),
            bytes.slice(kept.unwrap_or(0)..count),
        );
        let is_zero = |digits: &[u8]| remainder == 0 && digits.iter().all(|&digit| digit == 0);
        if magnitude < -i64::from(MAX_MAGNITUDE) && is_zero(dropped) {
            return Err(U_INTERNAL_PROGRAM_ERROR);
        }
        let rounds_up = dropped
            .split_first()
            .is_some_and(|(first, rest)| match first.cmp(&5) {
                Ordering::Less => false,
                Ordering::Equal => !is_zero(rest) || head.last().is_some_and(|last| last % 2 == 1),
                Ordering::Greater => true,
            });
        count = head.len();
        let digits = bytes.slice_mut(..count);
        digits.reverse();
        if rounds_up && kept.is_ok() {
            let nines = digits.iter().take_while(|&&digit| digit == 9).count();
            digits.iter_mut().take(nines).for_each(|nine| *nine = 0);
            if let Some(digit) = digits.get_mut(nines) {
                *digit += 1;
            } else {
                bytes.set(count, 1);
                count += 1;
            }
        }

        let is_negative = self.is_negative != rhs.is_negative;
        if result_exponent + count as i64 - 1 > i64::from(MAX_MAGNITUDE) {
            return Ok(Self::infinity(is_negative));
        }
        Ok(Self {
            is_infinite: false,
            is_negative,
            exponent: result_exponent as i32,
            bytes,
            count,
        })
    }

    pub(crate) fn is_negative(&self) -> bool {
        self.is_negative
    }

    pub(crate) fn is_infinite(&self) -> bool {
        self.is_infinite
    }

    pub(crate) fn digits(&self) -> &[u8] {
        self.bytes.slice(..self.count)
    }

    pub(crate) fn exponent(&self) -> i32 {
        self.exponent
    }
}

fn is_in_range(magnitude: i64) -> bool {
    magnitude.abs() <= i64::from(MAX_MAGNITUDE)
}
