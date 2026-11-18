use bun_engine_text::CodeUnit;

use crate::double::{EXPONENT_BIAS, FRACTION_BITS};
use crate::radix::DIGITS;

/// `CodeUnit::digit_value` without a branch on the kind of digit.
#[inline(always)]
pub(crate) fn digit_value<T: CodeUnit>(unit: T, radix: u32) -> Option<u32> {
    static VALUES: [u8; 256] = {
        let mut values = [u8::MAX; 256];
        let mut value = 0;
        while value < 36 {
            values[DIGITS[value] as usize] = value as u8;
            values[DIGITS[value].to_ascii_uppercase() as usize] = value as u8;
            value += 1;
        }
        values
    };
    let value = u32::from(VALUES[usize::from(unit.to_u16().min(0xff))]);
    (value < radix).then_some(value)
}

/// An integer in radix 2, 4, 8, 16 or 32, kept well enough to round it once.
pub(crate) struct BinaryInteger {
    bits_per_digit: u32,
    /// As many of the first digits as fit. The lowest bit is set if any of the others is not zero.
    leading: u64,
    dropped_bits: u32,
}

impl BinaryInteger {
    #[inline]
    pub(crate) fn new(radix: u32) -> BinaryInteger {
        debug_assert!(radix.is_power_of_two());
        BinaryInteger {
            bits_per_digit: radix.trailing_zeros(),
            leading: 0,
            dropped_bits: 0,
        }
    }

    #[inline]
    pub(crate) fn push(&mut self, digit: u32) {
        if self.leading >> (64 - self.bits_per_digit) == 0 {
            self.leading = self.leading << self.bits_per_digit | u64::from(digit);
        } else {
            self.leading |= u64::from(digit != 0);
            self.dropped_bits = self.dropped_bits.saturating_add(self.bits_per_digit);
        }
    }

    #[inline]
    pub(crate) fn value(&self) -> f64 {
        if let Ok(value) = i64::try_from(self.leading)
            && self.dropped_bits == 0
        {
            return value as f64;
        }
        let exponent = self.dropped_bits.min(EXPONENT_BIAS as u32);
        let scale = f64::from_bits(u64::from(EXPONENT_BIAS as u32 + exponent) << FRACTION_BITS);
        self.leading as f64 * scale
    }
}

/// The value and the number of the digits that `units` start with, in a radix that is a power of two.
#[inline]
pub(crate) fn scan_binary_integer<T: CodeUnit>(units: &[T], radix: u32) -> (f64, usize) {
    let mut integer = BinaryInteger::new(radix);
    let count = units
        .iter()
        .map_while(|&unit| digit_value(unit, radix))
        .map(|digit| integer.push(digit))
        .count();
    (integer.value(), count)
}
