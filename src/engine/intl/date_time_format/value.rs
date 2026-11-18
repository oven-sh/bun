use bun_engine_date::time_clip;
use bun_engine_temporal::{
    CalendarId, Instant, IsoDate, PlainDate, PlainDateTime, PlainMonthDay, PlainTime,
    PlainYearMonth, TemporalValue,
};

use crate::{Error, Result};

/// The result of ToDateTimeFormattable.
#[derive(Clone, Copy, Debug)]
pub enum DateTimeValue {
    Number(f64),
    Instant(Instant),
    PlainDate(PlainDate),
    PlainDateTime(PlainDateTime),
    PlainMonthDay(PlainMonthDay),
    PlainTime(PlainTime),
    PlainYearMonth(PlainYearMonth),
    ZonedDateTime,
}

/// The types of Temporal that have a format of their own.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum TemporalType {
    Instant,
    PlainDate,
    PlainDateTime,
    PlainMonthDay,
    PlainTime,
    PlainYearMonth,
}

impl TemporalType {
    pub(super) const COUNT: usize = 6;
}

/// What HandleDateTimeValue takes from a value.
pub(super) struct Moment {
    pub(super) temporal_type: Option<TemporalType>,
    /// Milliseconds since the epoch. NaN for a number that is no time value.
    pub(super) time: f64,
    /// The calendar that the format must have.
    pub(super) calendar: Option<CalendarId>,
}

impl Moment {
    /// Whether the time is what a clock shows, which is formatted in UTC.
    pub(super) fn is_plain(&self) -> bool {
        !matches!(self.temporal_type, None | Some(TemporalType::Instant))
    }
}

fn time_of_day(time: PlainTime) -> f64 {
    (time.nanosecond_of_day() / 1_000_000) as f64
}

fn midnight(date: IsoDate) -> f64 {
    f64::from(date.epoch_days()) * bun_engine_date::MS_PER_DAY
}

fn noon(date: IsoDate) -> f64 {
    midnight(date) + bun_engine_date::MS_PER_DAY / 2.0
}

impl DateTimeValue {
    /// IsTemporalObject, which does not hold for a duration.
    pub(crate) fn from_temporal(value: &TemporalValue) -> Option<DateTimeValue> {
        Some(match *value {
            TemporalValue::Duration(_) => return None,
            TemporalValue::Instant(it) => DateTimeValue::Instant(it),
            TemporalValue::PlainDate(it) => DateTimeValue::PlainDate(it),
            TemporalValue::PlainDateTime(it) => DateTimeValue::PlainDateTime(it),
            TemporalValue::PlainMonthDay(it) => DateTimeValue::PlainMonthDay(it),
            TemporalValue::PlainTime(it) => DateTimeValue::PlainTime(it),
            TemporalValue::PlainYearMonth(it) => DateTimeValue::PlainYearMonth(it),
            TemporalValue::ZonedDateTime(_) => DateTimeValue::ZonedDateTime,
        })
    }

    #[inline]
    pub(super) fn moment(self) -> Result<Moment> {
        let unless_iso = |calendar| Some(calendar).filter(|&it| it != CalendarId::Iso8601);
        let (temporal_type, time, calendar) = match self {
            DateTimeValue::Number(number) => (None, time_clip(number), None),
            DateTimeValue::Instant(instant) => (
                Some(TemporalType::Instant),
                instant.epoch_milliseconds() as f64,
                None,
            ),
            DateTimeValue::PlainDate(date) => (
                Some(TemporalType::PlainDate),
                noon(date.iso_date()),
                unless_iso(date.calendar()),
            ),
            DateTimeValue::PlainDateTime(date_time) => {
                let iso = date_time.iso_date_time();
                (
                    Some(TemporalType::PlainDateTime),
                    midnight(iso.date) + time_of_day(iso.time),
                    unless_iso(date_time.calendar()),
                )
            }
            DateTimeValue::PlainMonthDay(month_day) => (
                Some(TemporalType::PlainMonthDay),
                noon(month_day.iso_date()),
                Some(month_day.calendar()),
            ),
            DateTimeValue::PlainTime(time) => {
                (Some(TemporalType::PlainTime), time_of_day(time), None)
            }
            DateTimeValue::PlainYearMonth(year_month) => (
                Some(TemporalType::PlainYearMonth),
                noon(year_month.iso_date()),
                Some(year_month.calendar()),
            ),
            DateTimeValue::ZonedDateTime => {
                return Err(Error::Type(
                    "Temporal.ZonedDateTime is not supported in Intl.DateTimeFormat; use toLocaleString() or convert to PlainDateTime first",
                ));
            }
        };
        Ok(Moment {
            temporal_type,
            time,
            calendar,
        })
    }

    /// SameTemporalType, or two numbers.
    pub(super) fn is_same_type(&self, other: &DateTimeValue) -> bool {
        core::mem::discriminant(self) == core::mem::discriminant(other)
    }
}
