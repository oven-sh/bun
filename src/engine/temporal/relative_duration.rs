//! The methods of a duration that take `relativeTo`.

use core::cmp::Ordering;

use bun_engine_text::Text;

use crate::plain_date_time::{rounded_difference, total_difference};
use crate::rounding::Rounding;
use crate::settings::DifferenceSettings;
use crate::unit::UnitGroup;
use crate::{
    DateDuration, Duration, Error, IsoDateTime, Overflow, PlainDate, PlainTime, RelativeTo, Result,
    RoundOptions, RoundingIncrement, TimeDuration, Unit, UnitOption,
};

/// Of `Duration.prototype.round`, in the order they are read.
#[derive(Clone, Copy, Default, Debug)]
pub struct DurationRoundOptions {
    pub largest_unit: Option<UnitOption>,
    pub relative_to: Option<RelativeTo>,
    pub rounding: RoundOptions,
}

impl Duration {
    pub fn compare(&self, other: &Duration, relative_to: Option<&RelativeTo>) -> Result<Ordering> {
        if self == other {
            return Ok(Ordering::Equal);
        }
        let largest_unit = self.largest_unit().max(other.largest_unit());
        match relative_to {
            Some(RelativeTo::Zoned(start)) if largest_unit.is_date_unit() => {
                let one = start.add(self, Overflow::Constrain)?;
                let two = start.add(other, Overflow::Constrain)?;
                Ok(one.instant().cmp(&two.instant()))
            }
            _ if !largest_unit.is_calendar_unit() => Ok(self
                .time_with_24_hour_days()
                .cmp(&other.time_with_24_hour_days())),
            Some(&RelativeTo::Plain(start)) => {
                let days = [
                    days_from(start, self.date())?,
                    days_from(start, other.date())?,
                ];
                let one = self.time().add_days(days[0])?;
                Ok(one.cmp(&other.time().add_days(days[1])?))
            }
            _ => Err(Error::ComparingCalendarUnits),
        }
    }

    pub fn round(&self, options: &DurationRoundOptions) -> Result<Duration> {
        let settings = self.round_settings(options)?;
        let (largest_unit, rounding) = (settings.largest_unit, settings.rounding);
        match options.relative_to {
            Some(RelativeTo::Zoned(start)) => {
                let end = start.add(self, Overflow::Constrain)?;
                let rounded = start.rounded_difference(&end, settings)?;
                Duration::from_internal(rounded, largest_unit.min(Unit::Hour))
            }
            Some(RelativeTo::Plain(date)) => {
                let (start, end) = self.ends_from(date)?;
                let rounded = rounded_difference(start, end, date.calendar(), settings)?;
                Duration::from_internal(rounded, largest_unit)
            }
            None if self.date().has_calendar_units() || largest_unit.is_calendar_unit() => {
                Err(Error::RoundingCalendarUnits)
            }
            None => {
                let rounded = self.time_with_24_hour_days().round(rounding);
                let rounded: TimeDuration = match rounding.unit {
                    Unit::Day => rounded.or(Err(Error::DurationOutOfRange))?,
                    _ => rounded?,
                };
                Duration::from_internal(rounded.into(), largest_unit)
            }
        }
    }

    fn round_settings(&self, options: &DurationRoundOptions) -> Result<DifferenceSettings> {
        let smallest_unit = match options.rounding.smallest_unit {
            Some(option) => option.as_smallest_unit(UnitGroup::DateTime)?,
            None if options.largest_unit.is_none() => return Err(Error::MissingRoundingUnit),
            None => Unit::Nanosecond,
        };
        let largest_unit = (options.largest_unit)
            .and_then(UnitOption::unit)
            .unwrap_or_else(|| self.largest_unit().max(smallest_unit));
        if smallest_unit > largest_unit {
            return Err(Error::SmallestUnitAboveLargest);
        }
        let rounding = Rounding {
            unit: smallest_unit,
            increment: options.rounding.rounding_increment,
            mode: options.rounding.rounding_mode,
        }
        .within_next_unit()?;
        if rounding.increment != RoundingIncrement::ONE
            && largest_unit != smallest_unit
            && smallest_unit.is_date_unit()
        {
            return Err(Error::IncrementWithBalancing);
        }
        Ok(DifferenceSettings {
            largest_unit,
            rounding,
        })
    }

    /// The conversion of the `unit` option of `total`.
    pub fn total_unit(name: Text<'_>) -> Result<Unit> {
        Unit::find(name).ok_or(Error::InvalidTotalUnit)
    }

    pub fn total(&self, unit: Unit, relative_to: Option<&RelativeTo>) -> Result<f64> {
        match relative_to {
            Some(RelativeTo::Zoned(start)) => {
                start.total_difference(&start.add(self, Overflow::Constrain)?, unit)
            }
            Some(&RelativeTo::Plain(date)) => {
                let (start, end) = self.ends_from(date)?;
                total_difference(start, end, date.calendar(), unit)
            }
            None if self.date().has_calendar_units() || unit.is_calendar_unit() => {
                Err(Error::TotalOfCalendarUnits)
            }
            None => Ok(self.time_with_24_hour_days().total(unit)),
        }
    }

    fn ends_from(&self, date: PlainDate) -> Result<(IsoDateTime, IsoDateTime)> {
        let (start, calendar) = (date.iso_date(), date.calendar());
        let (days, time) = PlainTime::MIDNIGHT.add_with_carry(self.time_with_24_hour_days());
        let date = calendar.add(start, self.date().with_days(0), Overflow::Constrain)?;
        let date = calendar.add(date, DateDuration::from_days(days), Overflow::Constrain)?;
        Ok((IsoDateTime::at_midnight(start), IsoDateTime { date, time }))
    }
}

/// DateDurationDays
fn days_from(start: PlainDate, duration: DateDuration) -> Result<i64> {
    let date = start.iso_date();
    let later = (start.calendar()).add(date, duration.with_days(0), Overflow::Constrain)?;
    Ok(duration.days + date.days_until(later))
}
