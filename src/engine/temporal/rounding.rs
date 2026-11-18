use core::cmp::Ordering;

use crate::{Error, Result, RoundingMode, Unit};

impl RoundingMode {
    /// NegateRoundingMode
    pub(crate) fn negated(self) -> RoundingMode {
        match self {
            RoundingMode::Ceil => RoundingMode::Floor,
            RoundingMode::Floor => RoundingMode::Ceil,
            RoundingMode::HalfCeil => RoundingMode::HalfFloor,
            RoundingMode::HalfFloor => RoundingMode::HalfCeil,
            _ => self,
        }
    }

    /// GetUnsignedRoundingMode and ApplyUnsignedRoundingMode: whether a magnitude that is strictly between two multiples
    /// goes to the greater one. `position` compares it with their midpoint.
    #[inline]
    pub(crate) fn rounds_up(
        self,
        is_negative: bool,
        position: Ordering,
        lesser_is_odd: impl FnOnce() -> bool,
    ) -> bool {
        match (self, position) {
            (RoundingMode::Trunc, _) => false,
            (RoundingMode::Expand, _) => true,
            (RoundingMode::Ceil, _) => !is_negative,
            (RoundingMode::Floor, _) => is_negative,
            (_, Ordering::Less) => false,
            (_, Ordering::Greater) => true,
            (RoundingMode::HalfTrunc, _) => false,
            (RoundingMode::HalfExpand, _) => true,
            (RoundingMode::HalfCeil, _) => !is_negative,
            (RoundingMode::HalfFloor, _) => is_negative,
            (RoundingMode::HalfEven, _) => lesser_is_odd(),
        }
    }

    /// RoundNumberToIncrement. Both numbers are below 2^126 in magnitude, and `increment` is positive.
    pub(crate) fn round(self, value: i128, increment: i128) -> i128 {
        let (magnitude, increment) = (value.unsigned_abs(), increment.unsigned_abs());
        let (quotient, remainder) = match (u64::try_from(magnitude), u64::try_from(increment)) {
            (Ok(magnitude), Ok(increment)) => (
                u128::from(magnitude / increment),
                u128::from(magnitude % increment),
            ),
            _ => (magnitude / increment, magnitude % increment),
        };
        if remainder == 0 {
            return value;
        }
        let position = (2 * remainder).cmp(&increment);
        let mut rounded = magnitude - remainder;
        if self.rounds_up(value < 0, position, || quotient & 1 == 1) {
            rounded += increment;
        }
        if value < 0 {
            -(rounded as i128)
        } else {
            rounded as i128
        }
    }
}

/// From 1 to 10^9.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RoundingIncrement(u32);

impl RoundingIncrement {
    pub const ONE: RoundingIncrement = RoundingIncrement(1);

    /// The validation of GetRoundingIncrementOption.
    pub fn new(number: f64) -> Result<RoundingIncrement> {
        if number.is_nan() {
            return Err(Error::IncrementIsNaN);
        }
        if number.is_infinite() {
            return Err(Error::IncrementNotFinite);
        }
        match number as u32 {
            increment @ 1..=1_000_000_000 => Ok(RoundingIncrement(increment)),
            _ => Err(Error::IncrementOutOfRange),
        }
    }

    pub(crate) const fn power_of_ten(exponent: u8) -> RoundingIncrement {
        RoundingIncrement(10u32.pow(exponent as u32))
    }

    #[inline]
    pub(crate) fn get(self) -> i64 {
        i64::from(self.0)
    }

    /// ValidateTemporalRoundingIncrement
    fn check(self, dividend: i64, maximum: i64) -> Result<()> {
        if self.get() > maximum {
            return Err(Error::IncrementAboveMaximum);
        }
        if dividend % self.get() != 0 {
            return Err(Error::IncrementDoesNotDivide);
        }
        Ok(())
    }
}

/// To a multiple of `increment` units.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Rounding {
    pub(crate) unit: Unit,
    pub(crate) increment: RoundingIncrement,
    pub(crate) mode: RoundingMode,
}

impl Rounding {
    /// Fails unless the increment divides the next larger unit of time into several parts.
    pub(crate) fn within_next_unit(self) -> Result<Rounding> {
        if let Some(count) = self.unit.count_in_next_unit() {
            self.increment.check(count, count - 1)?;
        }
        Ok(self)
    }

    /// Fails unless the increment divides a day. The unit is not a calendar unit.
    pub(crate) fn within_day(self) -> Result<Rounding> {
        let count = Unit::Day.nanoseconds() / self.unit.nanoseconds();
        self.increment.check(count, count)?;
        Ok(self)
    }

    /// Whether every multiple of `resolution` stays as it is.
    #[inline]
    pub(crate) fn is_to_one(self, resolution: Unit) -> bool {
        self.unit == resolution && self.increment == RoundingIncrement::ONE
    }

    /// The unit is not a calendar unit.
    #[inline]
    pub(crate) fn step_nanoseconds(self) -> i128 {
        i128::from(self.unit.nanoseconds()) * i128::from(self.increment.get())
    }
}
