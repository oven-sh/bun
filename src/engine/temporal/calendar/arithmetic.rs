use core::cmp::Ordering;

use super::systems::{Layout, System};
use crate::{CalendarId, DateDuration, Error, IsoDate, Overflow, Result, Unit};

impl CalendarId {
    /// CalendarDateAdd
    #[inline]
    pub(crate) fn add(
        self,
        date: IsoDate,
        duration: DateDuration,
        overflow: Overflow,
    ) -> Result<IsoDate> {
        if duration.years | duration.months == 0 {
            return add_days(date, duration.weeks_and_days_in_days());
        }
        match self.layout(date.year()) {
            Layout::Iso { .. } => iso_add(date, duration, overflow),
            Layout::Own(system) => self.non_iso_add(system, date, duration, overflow),
        }
    }

    /// NonISODateAdd
    fn non_iso_add(
        self,
        system: System,
        date: IsoDate,
        duration: DateDuration,
        overflow: Overflow,
    ) -> Result<IsoDate> {
        let days = duration.weeks_and_days_in_days();
        let out_of_range = if system.is_solar() {
            Error::CalendarSumOutOfRange
        } else if [duration.years, duration.months, days]
            .iter()
            .any(|&it| i32::try_from(it).is_err())
        {
            return Err(Error::CalendarDurationOutOfRange);
        } else {
            Error::CalendarDateOutOfRange
        };
        let beyond_system = || {
            if self.is_chinese_or_dangi() {
                iso_add(date, duration, overflow)
            } else {
                Err(out_of_range)
            }
        };

        let (mut month, day) = system.locate(date)?;
        if duration.years != 0 {
            let year = i64::from(month.year.number) + duration.years;
            if !system.has_year(year) {
                return beyond_system();
            }
            let code = month.code();
            month = self.constrain_month_code(system.year(year as i32)?, code);
            if month.code() != code && overflow == Overflow::Reject {
                return Err(Error::MonthCodeNotInTargetYear);
            }
        }
        let Some(month) = system.add_months(month, duration.months)? else {
            return beyond_system();
        };
        let day = overflow.limit(day, month.days(), Error::DayNotInTargetMonth)?;
        let regulated = month.iso_date(day);
        if system.is_solar() {
            if !regulated.is_within_limits() {
                return Err(out_of_range);
            }
            return add_days(regulated, days);
        }
        let result = (regulated.checked_add_days(days))
            .filter(|result| IsoDate::is_year_within_limits(result.year()))
            .ok_or(out_of_range)?;
        within_limits(result)
    }

    /// CalendarDateUntil. `largest_unit` is a day or longer.
    #[inline]
    pub(crate) fn until(
        self,
        one: IsoDate,
        two: IsoDate,
        largest_unit: Unit,
    ) -> Result<DateDuration> {
        match largest_unit {
            Unit::Year | Unit::Month => match (self.layout(one.year()), self.layout(two.year())) {
                (Layout::Own(system), Layout::Own(_)) => {
                    self.non_iso_until(system, one, two, largest_unit)
                }
                _ => Ok(iso_until(one, two, largest_unit)),
            },
            Unit::Week => {
                let days = one.days_until(two);
                Ok(DateDuration {
                    weeks: days / 7,
                    ..DateDuration::from_days(days % 7)
                })
            }
            _ => Ok(DateDuration::from_days(one.days_until(two))),
        }
    }

    /// NonISODateUntil, in years or in months.
    fn non_iso_until(
        self,
        system: System,
        one: IsoDate,
        two: IsoDate,
        largest_unit: Unit,
    ) -> Result<DateDuration> {
        let direction = two.cmp(&one);
        let sign = direction as i64;
        let (start, start_day) = system.locate(one)?;
        let (end, end_day) = system.locate(two)?;

        let (mut years, mut base) = (0, start);
        if largest_unit == Unit::Year && start.year.number != end.year.number {
            years = i64::from(end.year.number - start.year.number);
            base = self.constrain_month_code(end.year, start.code());
            if (start.code(), start_day).cmp(&(end.code(), end_day)) == direction
                || (base.month, start_day).cmp(&(end.month, end_day)) == direction
            {
                years -= sign;
                let year = system.year(end.year.number - sign as i32)?;
                base = self.constrain_month_code(year, start.code());
            }
        }

        let (mut months, mut reached) = (system.months_until(base, end), end);
        if direction != Ordering::Equal && start_day.cmp(&end_day) == direction {
            months -= sign;
            reached = (system.add_months(end, -sign)?).ok_or(Error::CalendarDataUnavailable)?;
        }
        let regulated = reached.first_day() + i32::from(start_day.min(reached.days())) - 1;
        Ok(DateDuration {
            years,
            months,
            weeks: 0,
            days: i64::from(two.epoch_days() - regulated),
        })
    }
}

#[inline]
fn within_limits(date: IsoDate) -> Result<IsoDate> {
    (date.is_within_limits())
        .then_some(date)
        .ok_or(Error::DateTimeOutOfRange)
}

#[inline]
fn add_days(date: IsoDate, days: i64) -> Result<IsoDate> {
    within_limits((date.checked_add_days(days)).ok_or(Error::DateTimeOutOfRange)?)
}

#[inline]
fn iso_add(date: IsoDate, duration: DateDuration, overflow: Overflow) -> Result<IsoDate> {
    let months = i64::from(date.month() - 1) + duration.months;
    let year = i64::from(date.year()) + duration.years + months.div_euclid(12);
    let year = i32::try_from(year)
        .ok()
        .filter(|&year| IsoDate::is_year_within_limits(year))
        .ok_or(Error::DateTimeOutOfRange)?;
    let month = months.rem_euclid(12) as u8 + 1;
    let regulated = IsoDate::regulate(year, month, date.day(), overflow)?;
    add_days(regulated, duration.weeks_and_days_in_days())
}

#[inline]
fn iso_until(one: IsoDate, two: IsoDate, largest_unit: Unit) -> DateDuration {
    let month_index = |date: IsoDate| date.year() * 12 + i32::from(date.month()) - 1;
    let direction = two.cmp(&one);
    let mut reached = month_index(two);
    if one.day().cmp(&two.day()) == direction {
        reached -= direction as i32;
    }
    let months = i64::from(reached - month_index(one));
    let (year, month) = (reached.div_euclid(12), reached.rem_euclid(12) as u8 + 1);
    let day = one.day().min(bun_engine_date::days_in_month(year, month));
    let days = IsoDate::from_valid(year, month, day).days_until(two);
    let years = if largest_unit == Unit::Year {
        months / 12
    } else {
        0
    };
    DateDuration {
        years,
        months: months - 12 * years,
        weeks: 0,
        days,
    }
}
