//! The decimal number that is scaled, rounded and written. ICU4C: number_decimalquantity.cpp

use crate::common::memory::TryClone;
use crate::common::slice_ext::{SliceExt, slices_equal, to_index, to_int32, to_length};
use crate::common::utypes::UErrorCode;
use crate::i18n::double_conversion::{POWERS_OF_TEN, digits_to_double, shortest_digits};
use crate::i18n::number_decnum::{DecNum, DigitBytes};
use crate::i18n::plurrule::{IFixedDecimal, PluralOperand};
use std::cmp::Ordering;

#[derive(Clone, Copy)]
pub(crate) enum Signum {
    Neg,
    NegZero,
    PosZero,
    Pos,
}

#[derive(Clone, Copy)]
pub(crate) enum RoundingMode {
    Ceiling,
    Floor,
    Down,
    Up,
    HalfEven,
    HalfDown,
    HalfUp,
    HalfCeiling,
    HalfFloor,
}

impl RoundingMode {
    fn rounds_at_midpoint(self) -> bool {
        !matches!(self, Self::Up | Self::Down | Self::Ceiling | Self::Floor)
    }

    /// `to_midpoint` compares the absolute value with the midpoint of the candidates, the lower of which `is_even`.
    fn rounds_toward_zero(self, is_even: bool, is_negative: bool, to_midpoint: Ordering) -> bool {
        match self {
            _ if self.rounds_at_midpoint() && to_midpoint.is_ne() => to_midpoint.is_lt(),
            Self::Up | Self::HalfUp => false,
            Self::Down | Self::HalfDown => true,
            Self::Ceiling | Self::HalfCeiling => is_negative,
            Self::Floor | Self::HalfFloor => !is_negative,
            Self::HalfEven => is_even,
        }
    }
}

const NEGATIVE_FLAG: u8 = 1;
const INFINITY_FLAG: u8 = 2;
const NAN_FLAG: u8 = 4;

enum Bcd {
    /// Up to 16 digits of 4 bits: 12345 is 0x12345.
    Long(u64),
    /// One digit per byte, least significant first. Only the first `precision` bytes are valid.
    Bytes(DigitBytes),
}

impl Default for Bcd {
    fn default() -> Self {
        Bcd::Long(0)
    }
}

impl Bcd {
    /// Packs at most 16 digits, most significant first.
    fn long<'a>(digits: impl Iterator<Item = &'a u8>) -> Self {
        Bcd::Long(digits.fold(0, |bcd, &digit| bcd << 4 | u64::from(digit)))
    }
}

/// The digits have no leading or trailing zeros. Sums of magnitudes wrap.
#[derive(Default)]
pub(crate) struct DecimalQuantity {
    /// Power of ten of the least significant digit: -2 for 3.14.
    scale: i32,
    /// Number of digits.
    precision: i32,
    flags: u8,
    /// The digits come from the fast conversion of `orig_double`; about 14 are reliable. Rounding clears this flag.
    is_approximate: bool,
    orig_double: f64,
    /// Change in magnitude relative to `orig_double`.
    orig_delta: i32,
    /// Minimum number of integer digits.
    l_req_pos: i32,
    /// Magnitude of the last required trailing zero.
    r_req_pos: i32,
    /// Power of ten that the notation has factored out: 3 for "1K" and "1E3".
    exponent: i32,
    bcd: Bcd,
}

impl TryClone for DecimalQuantity {
    fn try_clone(&self) -> Result<Self, UErrorCode> {
        let bcd = match &self.bcd {
            Bcd::Long(bcd_long) => Bcd::Long(*bcd_long),
            Bcd::Bytes(bytes) => Bcd::Bytes(DigitBytes::copy_of(
                bytes.slice(..to_length(self.precision)),
            )?),
        };
        Ok(Self { bcd, ..*self })
    }
}

impl DecimalQuantity {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn clear(&mut self) {
        *self = Self::new();
    }

    pub(crate) fn increase_min_integer_to(&mut self, min_int: i32) {
        self.l_req_pos = self.l_req_pos.max(min_int);
    }

    pub(crate) fn set_min_fraction(&mut self, min_frac: i32) {
        self.r_req_pos = min_frac.wrapping_neg();
    }

    /// Removes the digits at 10^`max_int` and above.
    pub(crate) fn apply_max_integer(&mut self, max_int: i32) {
        if self.precision == 0 {
            return;
        }
        if max_int <= self.scale {
            self.set_bcd_to_zero();
        } else if max_int <= self.get_magnitude() {
            self.precision = max_int.wrapping_sub(self.scale);
            if let Bcd::Long(bcd_long) = &mut self.bcd {
                *bcd_long &= (1 << (self.precision * 4)) - 1;
            }
            self.compact();
        }
    }

    /// Rounds to a multiple of `increment` * 10^`magnitude`. `increment` has at most 17 digits, and 0 fails.
    pub(crate) fn round_to_increment(
        &mut self,
        increment: u64,
        magnitude: i32,
        rounding_mode: RoundingMode,
    ) -> Result<(), UErrorCode> {
        if self.is_zeroish() {
            return Ok(());
        }
        let mut increment_dq = DecimalQuantity::from_integer(increment);
        increment_dq.adjust_magnitude(magnitude);
        let increment_dn = increment_dq.to_dec_num()?;
        self.set_to_dec_num(&self.to_dec_num()?.divide(&increment_dn)?)?;
        self.round_to_magnitude(0, rounding_mode);
        self.multiply_by(&increment_dn)
    }

    fn multiply_by(&mut self, multiplicand: &DecNum) -> Result<(), UErrorCode> {
        if self.is_zeroish() {
            return Ok(());
        }
        self.set_to_dec_num(&self.to_dec_num()?.multiply(multiplicand)?)
    }

    pub(crate) fn negate(&mut self) {
        self.flags ^= NEGATIVE_FLAG;
    }

    /// Returns the power of ten of the most significant digit, or -1 for zero.
    pub(crate) fn get_magnitude(&self) -> i32 {
        self.scale.wrapping_add(self.precision).wrapping_sub(1)
    }

    /// Multiplies by 10^`delta`.
    pub(crate) fn adjust_magnitude(&mut self, delta: i32) {
        if self.precision != 0 {
            self.scale = self.scale.wrapping_add(delta);
            self.orig_delta = self.orig_delta.wrapping_add(delta);
        }
    }

    /// Sets the scale to 0 and returns the old scale.
    pub(crate) fn adjust_to_zero_scale(&mut self) -> i32 {
        std::mem::take(&mut self.scale)
    }

    pub(crate) fn adjust_exponent(&mut self, delta: i32) {
        self.exponent = self.exponent.wrapping_add(delta);
    }

    pub(crate) fn has_integer_value(&self) -> bool {
        self.scale >= 0
    }

    pub(crate) fn get_upper_display_magnitude(&self) -> i32 {
        self.l_req_pos
            .max(self.scale.wrapping_add(self.precision))
            .wrapping_sub(1)
    }

    pub(crate) fn get_lower_display_magnitude(&self) -> i32 {
        self.r_req_pos.min(self.scale)
    }

    /// Returns the digit at 10^`magnitude`.
    pub(crate) fn get_digit(&self, magnitude: i32) -> u8 {
        self.get_digit_pos(magnitude.wrapping_sub(self.scale))
    }

    pub(crate) fn is_negative(&self) -> bool {
        self.flags & NEGATIVE_FLAG != 0
    }

    /// Treats NaN as zero.
    pub(crate) fn signum(&self) -> Signum {
        match (self.is_zeroish() && !self.is_infinite(), self.is_negative()) {
            (true, true) => Signum::NegZero,
            (true, false) => Signum::PosZero,
            (false, true) => Signum::Neg,
            (false, false) => Signum::Pos,
        }
    }

    pub(crate) fn is_infinite(&self) -> bool {
        self.flags & INFINITY_FLAG != 0
    }

    pub(crate) fn is_nan(&self) -> bool {
        self.flags & NAN_FLAG != 0
    }

    /// Returns whether the number is zero, infinite or NaN.
    pub(crate) fn is_zeroish(&self) -> bool {
        self.precision == 0
    }

    pub(crate) fn from_integer(n: u64) -> Self {
        let mut quantity = Self::new();
        if n != 0 {
            quantity.read_long_to_bcd(n, 0);
        }
        quantity
    }

    pub(crate) fn from_long(n: i64) -> Self {
        Self {
            flags: if n < 0 { NEGATIVE_FLAG } else { 0 },
            ..Self::from_integer(n.unsigned_abs())
        }
    }

    pub(crate) fn set_to_double(&mut self, n: f64) {
        self.set_bcd_to_zero();
        self.flags = if n.is_sign_negative() {
            NEGATIVE_FLAG
        } else {
            0
        };
        if n.is_nan() {
            self.flags |= NAN_FLAG;
        } else if n.is_infinite() {
            self.flags |= INFINITY_FLAG;
        } else if n != 0.0 {
            self.set_to_double_fast(n.abs());
        }
    }

    fn set_to_double_fast(&mut self, mut n: f64) {
        let exponent = (n.to_bits() >> 52) as i32 - 0x3ff;
        let integer = n as i64;
        // The digits of an integer below 2^53 are its shortest digits.
        if exponent <= 52 && integer as f64 == n {
            return self.read_long_to_bcd(integer.unsigned_abs(), 0);
        }
        self.is_approximate = true;
        self.orig_double = n;
        if n.is_subnormal() {
            return self.convert_to_accurate_double();
        }

        let frac_length = (f64::from(52 - exponent) / std::f64::consts::LOG2_10) as i32;
        // 1e22 is the largest power of ten that a double represents exactly.
        let (steps, rest) = (
            frac_length.abs() / 22,
            POWERS_OF_TEN.at(to_index(frac_length.abs() % 22)),
        );
        if frac_length >= 0 {
            (0..steps).for_each(|_| n *= 1e22);
            n *= rest;
        } else {
            (0..steps).for_each(|_| n /= 1e22);
            n /= rest;
        }
        self.read_long_to_bcd((n + 0.5) as u64, -frac_length);
    }

    fn convert_to_accurate_double(&mut self) {
        let (delta, (digits, exponent)) = (self.orig_delta, shortest_digits(self.orig_double));
        self.set_bcd_to_zero();
        self.read_long_to_bcd(digits, exponent.wrapping_add(delta));
    }

    pub(crate) fn set_to_dec_num(&mut self, decnum: &DecNum) -> Result<(), UErrorCode> {
        self.set_bcd_to_zero();
        self.flags = if decnum.is_negative() {
            NEGATIVE_FLAG
        } else {
            0
        };
        if decnum.is_infinite() {
            self.flags |= INFINITY_FLAG;
        }
        let digits = decnum.digits();
        self.bcd = if digits.len() <= 16 {
            Bcd::long(digits.iter().rev())
        } else {
            Bcd::Bytes(DigitBytes::copy_of(digits)?)
        };
        self.scale = decnum.exponent();
        self.precision = to_int32(digits.len());
        self.compact();
        Ok(())
    }

    /// Returns the last 18 digits of the integer part of the absolute value, with the exponent applied.
    fn truncated_integer(&self) -> i64 {
        let shift = self.scale.wrapping_add(self.exponent);
        let upper_magnitude = self.get_magnitude().wrapping_add(self.exponent).min(17);
        (0..=upper_magnitude).rev().fold(0, |result, magnitude| {
            result * 10 + i64::from(self.get_digit_pos(magnitude.wrapping_sub(shift)))
        })
    }

    /// Returns the last 18 digits of the integer part, with the exponent applied.
    pub(crate) fn to_long(&self) -> i64 {
        let integer = self.truncated_integer();
        if self.is_negative() {
            -integer
        } else {
            integer
        }
    }

    /// Returns the fraction digits as an integer, with the exponent applied.
    pub(crate) fn to_fraction_long(&self, include_trailing_zeros: bool) -> u64 {
        let lower_magnitude = if include_trailing_zeros {
            self.get_lower_display_magnitude()
        } else {
            self.scale
        };
        let top_magnitude = self.get_magnitude();
        let mut magnitude = (-1i32).wrapping_sub(self.exponent);
        let mut result: u64 = 0;
        while magnitude >= lower_magnitude && result <= 1_000_000_000_000_000_000 {
            if result == 0 && !(0..self.precision).contains(&magnitude.wrapping_sub(self.scale)) {
                if top_magnitude >= magnitude {
                    break;
                }
                magnitude = top_magnitude;
                continue;
            }
            result = result * 10 + u64::from(self.get_digit(magnitude));
            let Some(next) = magnitude.checked_sub(1) else {
                break;
            };
            magnitude = next;
        }
        while !include_trailing_zeros && result != 0 && result.is_multiple_of(10) {
            result /= 10;
        }
        result
    }

    /// Returns the absolute value of a finite number, with the exponent applied.
    #[inline(always)]
    fn absolute_value(&self) -> f64 {
        let point = i64::from(self.get_magnitude().wrapping_add(self.exponent)) + 1;
        digits_to_double(self.digits(&mut [0; _]), point)
    }

    pub(crate) fn to_double(&self) -> f64 {
        if self.is_nan() {
            return f64::NAN;
        }
        let magnitude = if self.is_infinite() {
            f64::INFINITY
        } else {
            self.absolute_value()
        };
        if self.is_negative() {
            -magnitude
        } else {
            magnitude
        }
    }

    fn to_dec_num(&self) -> Result<DecNum, UErrorCode> {
        DecNum::from_digits(self.digits(&mut [0; _]), self.scale, self.is_negative())
    }

    /// Rounds to a multiple of 5 * 10^`magnitude`.
    pub(crate) fn round_to_nickel(&mut self, magnitude: i32, rounding_mode: RoundingMode) {
        self.round_to_multiple(5, magnitude, rounding_mode)
    }

    pub(crate) fn round_to_magnitude(&mut self, magnitude: i32, rounding_mode: RoundingMode) {
        self.round_to_multiple(1, magnitude, rounding_mode)
    }

    /// `step` is 1 or 5. ICU4C: number_decimalquantity.cpp, DecimalQuantity::roundToMagnitude
    fn round_to_multiple(&mut self, step: u8, magnitude: i32, rounding_mode: RoundingMode) {
        if self.is_approximate {
            if self.needs_accurate_double(step, magnitude.saturating_sub(self.scale), rounding_mode)
            {
                self.convert_to_accurate_double();
            }
            self.is_approximate = false;
            self.orig_delta = 0;
        }
        // The digits below `position` are rounded away.
        let position = magnitude.saturating_sub(self.scale);
        let trailing_digit = self.get_digit_pos(position);
        let remainder = trailing_digit % step;
        if (position <= 0 && remainder == 0) || self.precision == 0 {
            return;
        }

        // The least significant digit is never 0, so a midpoint has no digit after the 5.
        let to_midpoint =
            (remainder, self.get_digit_pos(position - 1), position != 1).cmp(&(step / 2, 5, false));
        // With `step` 5, half-even rounds to the multiple of 10.
        let is_even = trailing_digit.is_multiple_of(2);
        let round_down = rounding_mode.rounds_toward_zero(is_even, self.is_negative(), to_midpoint);

        if position >= self.precision {
            self.set_bcd_to_zero();
            self.scale = magnitude;
        } else {
            self.shift_right(position);
        }
        let mut last_digit = trailing_digit - remainder + if round_down { 0 } else { step };
        if last_digit == 10 {
            let nines = (1..self.precision)
                .take_while(|&position| self.get_digit_pos(position) == 9)
                .count();
            self.shift_right(1 + nines as i32);
            last_digit = self.get_digit_pos(0) + 1;
        }
        match &mut self.bcd {
            Bcd::Long(bcd_long) => *bcd_long = *bcd_long & !0xf | u64::from(last_digit),
            Bcd::Bytes(bytes) => bytes.set(0, last_digit),
        }
        self.precision = self.precision.max(1);
        self.compact();
    }

    /// Returns whether the reliable digits are too few to round at `position`, or too close to the rounding boundary.
    fn needs_accurate_double(&self, step: u8, position: i32, rounding_mode: RoundingMode) -> bool {
        let lowest_reliable = self.precision - 14;
        let leading = position.saturating_sub(1);
        if leading < lowest_reliable {
            return true;
        }
        let rest = lowest_reliable.max(0)..leading.min(self.precision);
        let rest_is = |digit| {
            rest.clone()
                .all(|position| self.get_digit_pos(position) == digit)
        };
        let digits = (
            self.get_digit_pos(position) % step,
            self.get_digit_pos(leading),
        );
        if rounding_mode.rounds_at_midpoint() {
            (digits == (step / 2, 4) && rest_is(9)) || (digits == (step / 2, 5) && rest_is(0))
        } else {
            (digits == (step - 1, 9) && rest_is(9)) || (digits == (0, 0) && rest_is(0))
        }
    }

    /// Replaces approximate digits with the shortest digits of the double.
    pub(crate) fn round_to_infinity(&mut self) {
        if self.is_approximate {
            self.convert_to_accurate_double();
        }
    }

    /// Returns the digit at `position`, counted from the least significant digit, or 0 if out of range.
    #[inline]
    fn get_digit_pos(&self, position: i32) -> u8 {
        match &self.bcd {
            Bcd::Bytes(bytes) if (0..self.precision).contains(&position) => {
                bytes.at(to_index(position))
            }
            Bcd::Long(bcd_long) if (0..16).contains(&position) => {
                (bcd_long >> (position * 4)) as u8 & 0xf
            }
            _ => 0,
        }
    }

    /// Returns the digits, least significant first. Those of a `Bcd::Long` are unpacked into `buffer`.
    fn digits<'a>(&'a self, buffer: &'a mut [u8; 16]) -> &'a [u8] {
        let count = to_length(self.precision);
        match self.bcd {
            Bcd::Long(mut bcd_long) => {
                let digits = buffer.slice_mut(..count);
                for digit in &mut *digits {
                    *digit = bcd_long as u8 & 0xf;
                    bcd_long >>= 4;
                }
                digits
            }
            Bcd::Bytes(ref bytes) => bytes.slice(..count),
        }
    }

    /// Removes the `count` least significant digits. `count` must not be negative. Call `compact` afterwards.
    fn shift_right(&mut self, count: i32) {
        match &mut self.bcd {
            Bcd::Bytes(bytes) => {
                let digits = bytes.slice_mut(..to_length(self.precision));
                digits.copy_within(to_index(count).min(digits.len()).., 0);
            }
            Bcd::Long(bcd_long) => *bcd_long = bcd_long.unbounded_shr(count as u32 * 4),
        }
        self.scale = self.scale.wrapping_add(count);
        self.precision -= count;
    }

    /// Keeps the flags and the required positions.
    #[inline]
    fn set_bcd_to_zero(&mut self) {
        *self = Self {
            flags: self.flags,
            l_req_pos: self.l_req_pos,
            r_req_pos: self.r_req_pos,
            ..Self::new()
        };
    }

    /// Sets the digits to those of `n` * 10^`scale`. Call after `set_bcd_to_zero`. `n` must not be 0.
    fn read_long_to_bcd(&mut self, mut n: u64, scale: i32) {
        const MAX_LONG: u64 = 9_999_999_999_999_999;
        self.scale = scale;
        while n > MAX_LONG && n.is_multiple_of(10) {
            n /= 10;
            self.scale = self.scale.wrapping_add(1);
        }
        if n > MAX_LONG {
            self.precision = n.ilog10() as i32 + 1;
            let mut bytes = [0; _];
            for digit in bytes.slice_mut(..to_length(self.precision)) {
                *digit = (n % 10) as u8;
                n /= 10;
            }
            self.bcd = Bcd::Bytes(DigitBytes::Inline(bytes));
            return;
        }
        let (mut bcd_long, mut shift) = (0, 0);
        while n != 0 {
            bcd_long |= (n % 10) << shift;
            n /= 10;
            shift += 4;
        }
        self.set_compact_long(bcd_long);
    }

    /// Stores `bcd_long`, which must not be 0, without its trailing zeros.
    #[inline]
    fn set_compact_long(&mut self, bcd_long: u64) {
        let delta = bcd_long.trailing_zeros() / 4;
        self.bcd = Bcd::Long(bcd_long >> (delta * 4));
        self.scale = self.scale.wrapping_add(delta as i32);
        self.precision = (16 - delta - bcd_long.leading_zeros() / 4) as i32;
    }

    /// Removes leading and trailing zeros, and switches to `Bcd::Long` if the digits fit.
    fn compact(&mut self) {
        match self.bcd {
            Bcd::Long(0) => self.set_bcd_to_zero(),
            Bcd::Long(bcd_long) => self.set_compact_long(bcd_long),
            Bcd::Bytes(ref bytes) => {
                let digits = bytes.slice(..to_length(self.precision));
                let delta = digits.iter().take_while(|&&digit| digit == 0).count() as i32;
                if delta == self.precision {
                    return self.set_bcd_to_zero();
                }
                self.precision -=
                    digits.iter().rev().take_while(|&&digit| digit == 0).count() as i32;
                self.shift_right(delta);
                if self.precision <= 16 {
                    self.bcd = Bcd::long(self.digits(&mut [0; _]).iter().rev());
                }
            }
        }
    }
}

/// Neither number may be approximate.
impl PartialEq for DecimalQuantity {
    fn eq(&self, other: &Self) -> bool {
        let fields = |dq: &Self| (dq.scale, dq.precision, dq.flags, dq.l_req_pos, dq.r_req_pos);
        fields(self) == fields(other)
            && slices_equal(self.digits(&mut [0; _]), other.digits(&mut [0; _]))
    }
}

impl IFixedDecimal for DecimalQuantity {
    fn get_plural_operand(&self, operand: PluralOperand) -> f64 {
        match operand {
            PluralOperand::I => self.truncated_integer() as f64,
            PluralOperand::F => self.to_fraction_long(true) as f64,
            PluralOperand::T => self.to_fraction_long(false) as f64,
            PluralOperand::V => f64::from(
                self.get_lower_display_magnitude()
                    .wrapping_neg()
                    .wrapping_sub(self.exponent)
                    .max(0),
            ),
            PluralOperand::E => f64::from(self.exponent),
            PluralOperand::N => self.absolute_value(),
        }
    }
}
