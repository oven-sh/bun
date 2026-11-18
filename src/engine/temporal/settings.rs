//! Options as they are read from an object, and the checks that involve several of them.

use bun_engine_text::Text;

use crate::rounding::Rounding;
use crate::unit::UnitGroup;
use crate::{
    Error, InputError, NumberError, Result, RoundingIncrement, RoundingMode, TextError, Unit,
    UnitOption,
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DifferenceOperation {
    Until,
    Since,
}

/// Of `until` and `since`, in the order they are read.
#[derive(Clone, Copy, Debug)]
pub struct DifferenceOptions {
    pub largest_unit: Option<UnitOption>,
    pub rounding_increment: RoundingIncrement,
    pub rounding_mode: RoundingMode,
    pub smallest_unit: Option<UnitOption>,
}

impl Default for DifferenceOptions {
    fn default() -> DifferenceOptions {
        DifferenceOptions {
            largest_unit: None,
            rounding_increment: RoundingIncrement::ONE,
            rounding_mode: RoundingMode::Trunc,
            smallest_unit: None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct DifferenceSettings {
    pub(crate) largest_unit: Unit,
    pub(crate) rounding: Rounding,
}

impl DifferenceOptions {
    /// The checks of GetDifferenceSettings.
    #[inline]
    pub(crate) fn resolve(
        self,
        operation: DifferenceOperation,
        group: UnitGroup,
        default_smallest_unit: Unit,
        default_largest_unit: Unit,
    ) -> Result<DifferenceSettings> {
        let largest_unit = match self.largest_unit.and_then(UnitOption::unit) {
            Some(unit) => Some(group.check(unit, Error::DisallowedLargestUnit)?),
            None => None,
        };
        let smallest_unit = match self.smallest_unit {
            Some(option) => option.as_smallest_unit(group)?,
            None => default_smallest_unit,
        };
        let largest_unit = largest_unit.unwrap_or_else(|| default_largest_unit.max(smallest_unit));
        if smallest_unit > largest_unit {
            return Err(Error::SmallestUnitAboveLargest);
        }
        let rounding = Rounding {
            unit: smallest_unit,
            increment: self.rounding_increment,
            mode: match operation {
                DifferenceOperation::Until => self.rounding_mode,
                DifferenceOperation::Since => self.rounding_mode.negated(),
            },
        };
        Ok(DifferenceSettings {
            largest_unit,
            rounding: rounding.within_next_unit()?,
        })
    }
}

/// Of `round`, other than that of a duration, in the order they are read.
#[derive(Clone, Copy, Debug)]
pub struct RoundOptions {
    pub rounding_increment: RoundingIncrement,
    pub rounding_mode: RoundingMode,
    pub smallest_unit: Option<UnitOption>,
}

impl Default for RoundOptions {
    fn default() -> RoundOptions {
        RoundOptions {
            rounding_increment: RoundingIncrement::ONE,
            rounding_mode: RoundingMode::HalfExpand,
            smallest_unit: None,
        }
    }
}

impl RoundOptions {
    /// For an argument that is a string.
    pub fn from_smallest_unit(name: Text<'_>) -> Result<RoundOptions> {
        let unit = Unit::find(name).ok_or(Error::InvalidSmallestUnit)?;
        Ok(RoundOptions {
            smallest_unit: Some(UnitOption::Unit(unit)),
            ..RoundOptions::default()
        })
    }

    pub(crate) fn resolve(self, group: UnitGroup) -> Result<Rounding> {
        let smallest_unit = self.smallest_unit.ok_or(Error::MissingSmallestUnit)?;
        Ok(Rounding {
            unit: smallest_unit.as_smallest_unit(group)?,
            increment: self.rounding_increment,
            mode: self.rounding_mode,
        })
    }

    /// For a date with a time.
    pub(crate) fn resolve_up_to_day(self) -> Result<Rounding> {
        let rounding = self.resolve(UnitGroup::TimeOrDay)?;
        match rounding.unit {
            Unit::Day => rounding.within_day(),
            _ => rounding.within_next_unit(),
        }
    }
}

/// The value of `fractionalSecondDigits`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FractionalSecondDigits(Option<u8>);

impl FractionalSecondDigits {
    pub const AUTO: FractionalSecondDigits = FractionalSecondDigits(None);

    /// For a value that is a Number.
    pub fn from_number(number: f64) -> Result<FractionalSecondDigits, InputError<'static>> {
        let count = number.floor();
        if !(0.0..=9.0).contains(&count) {
            return Err(InputError::Number(
                NumberError::FractionalSecondDigits,
                count,
            ));
        }
        Ok(FractionalSecondDigits(Some(count as u8)))
    }

    /// For any other value, converted to a string.
    pub fn parse(text: Text<'_>) -> Result<FractionalSecondDigits, InputError<'_>> {
        if !text.eq_ascii("auto") {
            return Err(InputError::Text(TextError::FractionalSecondDigits, text));
        }
        Ok(FractionalSecondDigits::AUTO)
    }
}

/// Those of `toString` that concern the seconds.
#[derive(Clone, Copy, Debug)]
pub struct PrecisionOptions {
    pub fractional_second_digits: FractionalSecondDigits,
    pub rounding_mode: RoundingMode,
    pub smallest_unit: Option<UnitOption>,
}

impl Default for PrecisionOptions {
    fn default() -> PrecisionOptions {
        PrecisionOptions {
            fractional_second_digits: FractionalSecondDigits::AUTO,
            rounding_mode: RoundingMode::Trunc,
            smallest_unit: None,
        }
    }
}

/// How much of a time is written after the minutes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SecondsFormat {
    Omitted,
    Shortest,
    Digits(u8),
}

/// The result of ToSecondsStringPrecisionRecord, and the rounding mode. Each type checks the options in `precision`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Precision {
    pub(crate) format: SecondsFormat,
    pub(crate) rounding: Rounding,
}

impl Precision {
    pub const AUTO: Precision = Precision {
        format: SecondsFormat::Shortest,
        rounding: Rounding {
            unit: Unit::Nanosecond,
            increment: RoundingIncrement::ONE,
            mode: RoundingMode::Trunc,
        },
    };
}

impl PrecisionOptions {
    #[inline]
    pub(crate) fn resolve(self, largest_allowed: Unit, too_large: Error) -> Result<Precision> {
        let smallest_unit = match self.smallest_unit {
            Some(option) => Some(option.as_smallest_unit(UnitGroup::Time)?),
            None => None,
        };
        let format = match (smallest_unit, self.fractional_second_digits.0) {
            (Some(unit), _) if unit > largest_allowed => return Err(too_large),
            (Some(Unit::Second), _) => SecondsFormat::Digits(0),
            (Some(Unit::Millisecond), _) => SecondsFormat::Digits(3),
            (Some(Unit::Microsecond), _) => SecondsFormat::Digits(6),
            (Some(Unit::Nanosecond), _) => SecondsFormat::Digits(9),
            (Some(_), _) => SecondsFormat::Omitted,
            (None, Some(count)) => SecondsFormat::Digits(count),
            (None, None) => return Ok(Precision::AUTO),
        };
        let (unit, exponent) = match format {
            SecondsFormat::Digits(0) => (Unit::Second, 0),
            SecondsFormat::Digits(count @ 1..=3) => (Unit::Millisecond, 3 - count),
            SecondsFormat::Digits(count @ 4..=6) => (Unit::Microsecond, 6 - count),
            SecondsFormat::Digits(count) => (Unit::Nanosecond, 9 - count),
            SecondsFormat::Omitted | SecondsFormat::Shortest => (Unit::Minute, 0),
        };
        let rounding = Rounding {
            unit,
            increment: RoundingIncrement::power_of_ten(exponent),
            mode: self.rounding_mode,
        };
        Ok(Precision { format, rounding })
    }
}
