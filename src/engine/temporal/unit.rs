use core::cmp::Ordering;

use bun_engine_text::Text;

use crate::{Error, Result};

pub(crate) const NANOSECONDS_PER_SECOND: i64 = 1_000_000_000;
pub(crate) const NANOSECONDS_PER_MINUTE: i64 = 60 * NANOSECONDS_PER_SECOND;
pub(crate) const NANOSECONDS_PER_HOUR: i64 = 60 * NANOSECONDS_PER_MINUTE;
pub(crate) const NANOSECONDS_PER_DAY: i64 = 24 * NANOSECONDS_PER_HOUR;

/// The longer unit compares greater.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Unit {
    Year,
    Month,
    Week,
    Day,
    Hour,
    Minute,
    Second,
    Millisecond,
    Microsecond,
    Nanosecond,
}

impl Unit {
    /// From the longest, which is the order of the arguments of the constructors.
    pub const ALL: [Unit; 10] = [
        Unit::Year,
        Unit::Month,
        Unit::Week,
        Unit::Day,
        Unit::Hour,
        Unit::Minute,
        Unit::Second,
        Unit::Millisecond,
        Unit::Microsecond,
        Unit::Nanosecond,
    ];

    pub const fn singular(self) -> &'static str {
        match self {
            Unit::Year => "year",
            Unit::Month => "month",
            Unit::Week => "week",
            Unit::Day => "day",
            Unit::Hour => "hour",
            Unit::Minute => "minute",
            Unit::Second => "second",
            Unit::Millisecond => "millisecond",
            Unit::Microsecond => "microsecond",
            Unit::Nanosecond => "nanosecond",
        }
    }

    /// By the singular or the plural name.
    pub fn find(name: Text<'_>) -> Option<Unit> {
        let singular = if name.ends_with(Text::from_ascii("s")) {
            name.slice(0..name.len() - 1)
        } else {
            name
        };
        Unit::ALL
            .into_iter()
            .find(|unit| singular.eq_ascii(unit.singular()))
    }

    /// IsCalendarUnit
    pub(crate) fn is_calendar_unit(self) -> bool {
        self > Unit::Day
    }

    /// Whether TemporalUnitCategory is `date`.
    pub(crate) fn is_date_unit(self) -> bool {
        self >= Unit::Day
    }

    /// A calendar unit has no fixed length.
    pub(crate) fn nanoseconds(self) -> i64 {
        match self {
            Unit::Year | Unit::Month | Unit::Week => unreachable!("the length of {self:?} varies"),
            Unit::Day => NANOSECONDS_PER_DAY,
            Unit::Hour => NANOSECONDS_PER_HOUR,
            Unit::Minute => NANOSECONDS_PER_MINUTE,
            Unit::Second => NANOSECONDS_PER_SECOND,
            Unit::Millisecond => 1_000_000,
            Unit::Microsecond => 1_000,
            Unit::Nanosecond => 1,
        }
    }

    /// MaximumTemporalDurationRoundingIncrement
    pub(crate) fn count_in_next_unit(self) -> Option<i64> {
        match self {
            Unit::Year | Unit::Month | Unit::Week | Unit::Day => None,
            Unit::Hour => Some(24),
            Unit::Minute | Unit::Second => Some(60),
            Unit::Millisecond | Unit::Microsecond | Unit::Nanosecond => Some(1000),
        }
    }
}

impl Ord for Unit {
    #[inline]
    fn cmp(&self, other: &Unit) -> Ordering {
        (*other as u8).cmp(&(*self as u8))
    }
}

impl PartialOrd for Unit {
    #[inline]
    fn partial_cmp(&self, other: &Unit) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// The value of `largestUnit` or `smallestUnit`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UnitOption {
    Auto,
    Unit(Unit),
}

impl UnitOption {
    /// The conversion of GetTemporalUnitValuedOption.
    pub fn parse(text: Text<'_>) -> Result<UnitOption> {
        if text.eq_ascii("auto") {
            return Ok(UnitOption::Auto);
        }
        Unit::find(text)
            .map(UnitOption::Unit)
            .ok_or(Error::InvalidUnit)
    }

    pub(crate) fn unit(self) -> Option<Unit> {
        match self {
            UnitOption::Auto => None,
            UnitOption::Unit(unit) => Some(unit),
        }
    }

    /// ValidateTemporalUnitValue for `smallestUnit`.
    pub(crate) fn as_smallest_unit(self, group: UnitGroup) -> Result<Unit> {
        let unit = self.unit().ok_or(Error::SmallestUnitIsAuto)?;
        group.check(unit, Error::DisallowedSmallestUnit)
    }
}

/// The units that an option accepts.
#[derive(Clone, Copy)]
pub(crate) enum UnitGroup {
    Date,
    Time,
    TimeOrDay,
    DateTime,
}

impl UnitGroup {
    pub(crate) fn check(self, unit: Unit, disallowed: Error) -> Result<Unit> {
        let is_member = match self {
            UnitGroup::Date => unit.is_date_unit(),
            UnitGroup::Time => !unit.is_date_unit(),
            UnitGroup::TimeOrDay => !unit.is_calendar_unit(),
            UnitGroup::DateTime => true,
        };
        if is_member { Ok(unit) } else { Err(disallowed) }
    }
}
