use bun_engine_date::TimeZone;
use bun_engine_text::Text;

use crate::format::IsoText;
use crate::relative_rounding::Span;
use crate::settings::DifferenceSettings;
use crate::time_zone::TimeZoneRules;
use crate::unit::UnitGroup;
use crate::{
    CalendarId, DateDuration, DifferenceOperation, DifferenceOptions, Disambiguation, Duration,
    Error, Fields, InputError, InternalDuration, IsoDate, IsoDateTime, Overflow, PlainDate,
    PlainTime, Precision, PrecisionOptions, Result, RoundOptions, ShowCalendar, Unit,
    ZonedDateTime, parse,
};

/// What a `Temporal.PlainDateTime` holds.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PlainDateTime {
    date: IsoDate,
    time: PlainTime,
    calendar: CalendarId,
}

/// A string that is well formed. What it says is checked by `finish`, after the options have been read.
#[derive(Clone, Copy, Debug)]
pub struct ParsedPlainDateTime(PlainDateTime);

impl ParsedPlainDateTime {
    #[inline]
    pub fn finish(self) -> Result<PlainDateTime> {
        PlainDateTime::new(self.0.iso_date_time(), self.0.calendar)
    }
}

impl PlainDateTime {
    /// The check of CreateTemporalDateTime.
    #[inline]
    pub fn new(date_time: IsoDateTime, calendar: CalendarId) -> Result<PlainDateTime> {
        if !date_time.is_within_limits() {
            return Err(Error::DateTimeOutOfRange);
        }
        Ok(PlainDateTime::from_valid(date_time, calendar))
    }

    #[inline]
    pub(crate) fn from_valid(date_time: IsoDateTime, calendar: CalendarId) -> PlainDateTime {
        debug_assert!(date_time.is_within_limits());
        PlainDateTime {
            date: date_time.date,
            time: date_time.time,
            calendar,
        }
    }

    /// For `FieldSet::DateTime`.
    pub fn from_fields(fields: &Fields, overflow: Overflow) -> Result<PlainDateTime> {
        PlainDateTime::new(fields.date_time(overflow)?, fields.calendar)
    }

    #[inline]
    pub fn parse(text: Text<'_>) -> Result<ParsedPlainDateTime, InputError<'_>> {
        let parsed = parse::plain_date_time(text).ok_or(Error::InvalidDateText)?;
        Ok(ParsedPlainDateTime(PlainDateTime {
            date: parsed.date,
            time: parsed.time.unwrap_or(PlainTime::MIDNIGHT),
            calendar: CalendarId::from_annotation(parsed.annotations.calendar)?,
        }))
    }

    #[inline]
    pub fn iso_date_time(self) -> IsoDateTime {
        IsoDateTime {
            date: self.date,
            time: self.time,
        }
    }

    #[inline]
    pub fn calendar(self) -> CalendarId {
        self.calendar
    }

    /// For `FieldSet::DateTime` in the calendar of `self`.
    pub fn with(self, fields: &Fields, overflow: Overflow) -> Result<PlainDateTime> {
        let date_time = fields.date_time_over(self.iso_date_time(), overflow)?;
        PlainDateTime::new(date_time, self.calendar)
    }

    pub fn with_calendar(self, calendar: CalendarId) -> PlainDateTime {
        PlainDateTime { calendar, ..self }
    }

    pub fn with_plain_time(self, time: PlainTime) -> Result<PlainDateTime> {
        self.to_plain_date().to_plain_date_time(time)
    }

    /// AddDurationToDateTime
    pub fn add(self, duration: &Duration, overflow: Overflow) -> Result<PlainDateTime> {
        let (days, time) = self.time.add_with_carry(duration.time_with_24_hour_days());
        let date_duration = duration.date().with_days(days);
        let date = self.calendar.add(self.date, date_duration, overflow)?;
        PlainDateTime::new(IsoDateTime { date, time }, self.calendar)
    }

    pub fn subtract(self, duration: &Duration, overflow: Overflow) -> Result<PlainDateTime> {
        self.add(&duration.negated(), overflow)
    }

    /// Comes before the options of `difference` are read.
    pub fn check_same_calendar(self, other: PlainDateTime) -> Result<()> {
        if self.calendar != other.calendar {
            return Err(Error::DateTimesInDifferentCalendars);
        }
        Ok(())
    }

    /// DifferenceTemporalPlainDateTime
    pub fn difference(
        self,
        operation: DifferenceOperation,
        other: PlainDateTime,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        let settings =
            options.resolve(operation, UnitGroup::DateTime, Unit::Nanosecond, Unit::Day)?;
        let (one, two) = (self.iso_date_time(), other.iso_date_time());
        let duration = rounded_difference(one, two, self.calendar, settings)?;
        Duration::from_difference(operation, duration, settings.largest_unit)
    }

    pub fn round(self, options: RoundOptions) -> Result<PlainDateTime> {
        let rounded = self.iso_date_time().round(options.resolve_up_to_day()?);
        PlainDateTime::new(rounded, self.calendar)
    }

    #[inline]
    pub fn to_plain_date(self) -> PlainDate {
        PlainDate::from_valid(self.date, self.calendar)
    }

    pub fn to_zoned_date_time(
        self,
        time_zone: TimeZone,
        disambiguation: Disambiguation,
    ) -> Result<ZonedDateTime> {
        let local = time_zone.instant_for(self.iso_date_time(), disambiguation)?;
        Ok(ZonedDateTime::from_local(local, time_zone, self.calendar))
    }

    #[inline]
    pub fn precision(options: PrecisionOptions) -> Result<Precision> {
        options.resolve(Unit::Minute, Error::HourInPlainDateTimeText)
    }

    /// The step of `toString` that comes before `to_text`.
    #[inline]
    pub fn round_for_text(self, precision: Precision) -> Result<PlainDateTime> {
        let rounded = self.iso_date_time().round(precision.rounding);
        PlainDateTime::new(rounded, self.calendar).or(Err(Error::RoundedDateTimeOutOfRange))
    }

    /// ISODateTimeToString
    #[inline(always)]
    pub fn to_text(self, precision: Precision, show_calendar: ShowCalendar) -> IsoText {
        let mut text = IsoText::new();
        text.push_date_time(self.iso_date_time(), precision.format);
        text.push_calendar(self.calendar, show_calendar);
        text
    }
}

/// DifferenceISODateTime
fn exact_difference(
    one: IsoDateTime,
    two: IsoDateTime,
    calendar: CalendarId,
    largest_unit: Unit,
) -> Result<InternalDuration> {
    let mut time = one.time.until(two.time);
    let mut end = two.date;
    let time_sign = time.sign();
    if time_sign == one.date.cmp(&two.date) as i8 {
        end = end.add_few_days(time_sign);
        time = time.add_days((-time_sign).into())?;
    }
    if largest_unit.is_date_unit() {
        let date = calendar.until(one.date, end, largest_unit)?;
        return Ok(InternalDuration { date, time });
    }
    Ok(InternalDuration {
        date: DateDuration::ZERO,
        time: time.add_days(one.date.days_until(end))?,
    })
}

/// DifferencePlainDateTimeWithRounding
pub(crate) fn rounded_difference(
    one: IsoDateTime,
    two: IsoDateTime,
    calendar: CalendarId,
    settings: DifferenceSettings,
) -> Result<InternalDuration> {
    if one == two {
        return Ok(InternalDuration::default());
    }
    if !one.is_within_limits() || !two.is_within_limits() {
        return Err(Error::DifferenceEndOutOfRange);
    }
    let duration = exact_difference(one, two, calendar, settings.largest_unit)?;
    if settings.rounding.is_to_one(Unit::Nanosecond) {
        return Ok(duration);
    }
    Span::plain(one, two, calendar).round(&duration, settings)
}

/// DifferencePlainDateTimeWithTotal
pub(crate) fn total_difference(
    one: IsoDateTime,
    two: IsoDateTime,
    calendar: CalendarId,
    unit: Unit,
) -> Result<f64> {
    if one == two {
        return Ok(0.0);
    }
    if !one.is_within_limits() || !two.is_within_limits() {
        return Err(Error::DateTimeOutOfRange);
    }
    let duration = exact_difference(one, two, calendar, unit)?;
    Span::plain(one, two, calendar).total(&duration, unit)
}
