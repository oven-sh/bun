use core::cmp::Ordering;

use bun_engine_date::TimeZone;

use crate::ratio::nearest_double;
use crate::rounding::Rounding;
use crate::settings::DifferenceSettings;
use crate::time_zone::TimeZoneRules;
use crate::unit::NANOSECONDS_PER_DAY;
use crate::{
    CalendarId, DateDuration, Disambiguation, Error, InternalDuration, IsoDate, IsoDateTime,
    Overflow, Result, TimeDuration, Unit,
};

/// Where a duration begins and ends. Without a time zone, epoch nanoseconds are those of the same reading in UTC.
#[derive(Clone, Copy)]
pub(crate) struct Span {
    pub(crate) start: IsoDateTime,
    pub(crate) start_nanoseconds: i128,
    pub(crate) end_nanoseconds: i128,
    pub(crate) time_zone: Option<TimeZone>,
    pub(crate) calendar: CalendarId,
}

/// The two multiples of an increment of a unit that a duration is between.
struct Window {
    start_count: i64,
    start: DateDuration,
    end: DateDuration,
    start_nanoseconds: i128,
    end_nanoseconds: i128,
}

impl Window {
    fn contains(&self, nanoseconds: i128) -> bool {
        let (start, end) = (self.start_nanoseconds, self.end_nanoseconds);
        (start.min(end)..=start.max(end)).contains(&nanoseconds)
    }
}

/// A Duration Nudge Result Record.
struct Nudged {
    duration: InternalDuration,
    nanoseconds: i128,
    did_expand: bool,
}

fn direction(duration: &InternalDuration) -> i8 {
    if duration.sign() < 0 { -1 } else { 1 }
}

impl Span {
    pub(crate) fn plain(start: IsoDateTime, end: IsoDateTime, calendar: CalendarId) -> Span {
        Span {
            start,
            start_nanoseconds: start.utc_epoch_nanoseconds(),
            end_nanoseconds: end.utc_epoch_nanoseconds(),
            time_zone: None,
            calendar,
        }
    }

    /// RoundRelativeDuration
    pub(crate) fn round(
        &self,
        duration: &InternalDuration,
        settings: DifferenceSettings,
    ) -> Result<InternalDuration> {
        let (largest_unit, rounding) = (settings.largest_unit, settings.rounding);
        let sign = direction(duration);
        let nudged = if self.varies_in_length(rounding.unit) {
            self.nudge_to_calendar_unit(sign, duration.date, rounding)?
        } else if self.time_zone.is_some() {
            self.nudge_to_zoned_time(sign, duration, rounding)?
        } else {
            self.nudge_to_day_or_time(duration, largest_unit, rounding)?
        };
        if !nudged.did_expand || rounding.unit == Unit::Week {
            return Ok(nudged.duration);
        }
        self.bubble(sign, &nudged, largest_unit, rounding.unit)
    }

    /// TotalRelativeDuration
    pub(crate) fn total(&self, duration: &InternalDuration, unit: Unit) -> Result<f64> {
        if !self.varies_in_length(unit) {
            return Ok(duration.time.add_days(duration.date.days)?.total(unit));
        }
        let step = i64::from(direction(duration));
        let mut window = self.window(duration.date, unit, step, 0)?;
        if !window.contains(self.end_nanoseconds) {
            window = self.window(duration.date, unit, step, step)?;
        }
        let length = (window.end_nanoseconds - window.start_nanoseconds).abs();
        let progress = self.end_nanoseconds - window.start_nanoseconds;
        let numerator = i128::from(window.start_count) * length + progress;
        Ok(nearest_double(numerator, length))
    }

    fn varies_in_length(&self, unit: Unit) -> bool {
        unit.is_calendar_unit() || (unit == Unit::Day && self.time_zone.is_some())
    }

    fn date_after(&self, duration: DateDuration) -> Result<IsoDate> {
        (self.calendar).add(self.start.date, duration, Overflow::Constrain)
    }

    /// At the time of day that the span starts.
    fn nanoseconds_on(&self, date: IsoDate) -> Result<i128> {
        let date_time = IsoDateTime { date, ..self.start };
        Ok(match self.time_zone {
            None => date_time.utc_epoch_nanoseconds(),
            Some(zone) => (zone.instant_for(date_time, Disambiguation::Compatible)?)
                .instant
                .epoch_nanoseconds(),
        })
    }

    fn nanoseconds_after(&self, duration: DateDuration) -> Result<i128> {
        self.nanoseconds_on(self.date_after(duration)?)
    }

    /// ComputeNudgeWindow. The result is not empty.
    fn window(&self, duration: DateDuration, unit: Unit, step: i64, shift: i64) -> Result<Window> {
        let count = match unit {
            Unit::Year => duration.years,
            Unit::Month => duration.months,
            Unit::Week => duration.weeks + duration.days / 7,
            _ => duration.days,
        };
        let start_count = count - count % step + shift;
        let start = truncated(duration, unit, start_count);
        let end = truncated(duration, unit, start_count + step);
        let start_nanoseconds = if start == DateDuration::ZERO {
            self.start_nanoseconds
        } else {
            self.nanoseconds_after(start)?
        };
        let end_nanoseconds = self.nanoseconds_after(end)?;
        if start_nanoseconds == end_nanoseconds {
            return Err(Error::RoundingAcrossSkippedDay);
        }
        Ok(Window {
            start_count,
            start,
            end,
            start_nanoseconds,
            end_nanoseconds,
        })
    }

    /// NudgeToCalendarUnit
    fn nudge_to_calendar_unit(
        &self,
        sign: i8,
        duration: DateDuration,
        rounding: Rounding,
    ) -> Result<Nudged> {
        let (unit, increment) = (rounding.unit, rounding.increment.get());
        let step = increment * i64::from(sign);
        let mut window = self.window(duration, unit, step, 0)?;
        let is_outside = !window.contains(self.end_nanoseconds);
        if is_outside && unit >= Unit::Month {
            window = self.window(duration, unit, step, step)?;
        }
        let length = (window.end_nanoseconds - window.start_nanoseconds) * i128::from(sign);
        let progress = (self.end_nanoseconds - window.start_nanoseconds) * i128::from(sign);
        let lesser_is_odd = || window.start_count / increment % 2 != 0;
        let rounds_up = progress >= length
            || (progress > 0
                && (rounding.mode).rounds_up(sign < 0, (2 * progress).cmp(&length), lesser_is_odd));
        let (date, nanoseconds) = if rounds_up {
            (window.end, window.end_nanoseconds)
        } else {
            (window.start, window.start_nanoseconds)
        };
        Ok(Nudged {
            duration: date.into(),
            nanoseconds,
            did_expand: rounds_up || is_outside,
        })
    }

    /// NudgeToZonedTime
    fn nudge_to_zoned_time(
        &self,
        sign: i8,
        duration: &InternalDuration,
        rounding: Rounding,
    ) -> Result<Nudged> {
        let start_date = self.date_after(duration.date)?;
        let start = self.nanoseconds_on(start_date)?;
        let end = self.nanoseconds_on(start_date.add_few_days(sign))?;
        let rounded = duration.time.round(rounding)?;
        let beyond_day = TimeDuration::from_valid(rounded.nanoseconds() - (end - start));
        let did_expand = beyond_day.sign() != -sign;
        let (days, time, base) = if did_expand {
            (sign, beyond_day.round(rounding)?, end)
        } else {
            (0, rounded, start)
        };
        let date = (duration.date).with_days(duration.date.days + i64::from(days));
        Ok(Nudged {
            duration: InternalDuration { date, time },
            nanoseconds: base + time.nanoseconds(),
            did_expand,
        })
    }

    /// NudgeToDayOrTime
    fn nudge_to_day_or_time(
        &self,
        duration: &InternalDuration,
        largest_unit: Unit,
        rounding: Rounding,
    ) -> Result<Nudged> {
        let time = duration.time.add_days(duration.date.days)?;
        let rounded = time.round(rounding)?;
        let rounded_days = rounded.whole_days();
        let did_expand = (rounded_days - time.whole_days()).signum() == i64::from(time.sign());
        let days = if largest_unit.is_date_unit() {
            rounded_days
        } else {
            0
        };
        let remainder = rounded.nanoseconds() - i128::from(days) * i128::from(NANOSECONDS_PER_DAY);
        Ok(Nudged {
            duration: InternalDuration {
                date: duration.date.with_days(days),
                time: TimeDuration::from_valid(remainder),
            },
            nanoseconds: self.end_nanoseconds + rounded.nanoseconds() - time.nanoseconds(),
            did_expand,
        })
    }

    /// BubbleRelativeDuration
    fn bubble(
        &self,
        sign: i8,
        nudged: &Nudged,
        largest_unit: Unit,
        smallest_unit: Unit,
    ) -> Result<InternalDuration> {
        let mut duration = nudged.duration;
        for unit in [Unit::Week, Unit::Month, Unit::Year] {
            if unit <= smallest_unit
                || unit > largest_unit
                || (unit == Unit::Week && largest_unit != Unit::Week)
            {
                continue;
            }
            let count = match unit {
                Unit::Year => duration.date.years,
                Unit::Month => duration.date.months,
                _ => duration.date.weeks,
            };
            let end = truncated(duration.date, unit, count + i64::from(sign));
            let short_of_end = if sign > 0 {
                Ordering::Less
            } else {
                Ordering::Greater
            };
            if nudged.nanoseconds.cmp(&self.nanoseconds_after(end)?) == short_of_end {
                break;
            }
            duration = end.into();
        }
        Ok(duration)
    }
}

/// With `count` of `unit`, and none of the shorter ones.
fn truncated(duration: DateDuration, unit: Unit, count: i64) -> DateDuration {
    let [years, months, weeks, days] = match unit {
        Unit::Year => [count, 0, 0, 0],
        Unit::Month => [duration.years, count, 0, 0],
        Unit::Week => [duration.years, duration.months, count, 0],
        _ => [duration.years, duration.months, duration.weeks, count],
    };
    DateDuration {
        years,
        months,
        weeks,
        days,
    }
}
