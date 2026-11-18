use bun_engine_date::TimeZone;
use bun_engine_text::Text;

use crate::calendar::DateFields;
use crate::format::IsoText;
use crate::relative_rounding::Span;
use crate::time_zone::TimeZoneRules;
use crate::unit::UnitGroup;
use crate::{
    CalendarId, DifferenceOperation, DifferenceOptions, Disambiguation, Duration, Error, Fields,
    InputError, InternalDuration, IsoDate, IsoDateTime, Overflow, PlainDateTime, PlainMonthDay,
    PlainTime, PlainYearMonth, Result, ShowCalendar, Unit, ZonedDateTime, parse,
};

/// What a `Temporal.PlainDate` holds.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PlainDate {
    date: IsoDate,
    calendar: CalendarId,
}

/// A string that is well formed. What it says is checked by `finish`, after the options have been read.
#[derive(Clone, Copy, Debug)]
pub struct ParsedPlainDate(PlainDate);

impl ParsedPlainDate {
    #[inline]
    pub fn finish(self) -> Result<PlainDate> {
        PlainDate::new(self.0.date, self.0.calendar)
    }
}

impl PlainDate {
    /// The check of CreateTemporalDate.
    #[inline]
    pub fn new(date: IsoDate, calendar: CalendarId) -> Result<PlainDate> {
        if !date.is_within_limits() {
            return Err(Error::DateTimeOutOfRange);
        }
        Ok(PlainDate { date, calendar })
    }

    #[inline]
    pub(crate) fn from_valid(date: IsoDate, calendar: CalendarId) -> PlainDate {
        debug_assert!(date.is_within_limits());
        PlainDate { date, calendar }
    }

    /// For `FieldSet::Date`.
    pub fn from_fields(fields: &Fields, overflow: Overflow) -> Result<PlainDate> {
        let date = fields.calendar.date_from_fields(&fields.date, overflow)?;
        Ok(PlainDate::from_valid(date, fields.calendar))
    }

    #[inline]
    pub fn parse(text: Text<'_>) -> Result<ParsedPlainDate, InputError<'_>> {
        let parsed = parse::plain_date_time(text).ok_or(Error::InvalidDateText)?;
        Ok(ParsedPlainDate(PlainDate {
            date: parsed.date,
            calendar: CalendarId::from_annotation(parsed.annotations.calendar)?,
        }))
    }

    #[inline]
    pub fn iso_date(self) -> IsoDate {
        self.date
    }

    #[inline]
    pub fn calendar(self) -> CalendarId {
        self.calendar
    }

    /// For `FieldSet::Date` in the calendar of `self`.
    pub fn with(self, fields: &Fields, overflow: Overflow) -> Result<PlainDate> {
        let merged = DateFields::of_date(self.calendar, self.date)?.merged(&fields.date);
        let date = self.calendar.date_from_fields(&merged, overflow)?;
        Ok(PlainDate::from_valid(date, self.calendar))
    }

    pub fn with_calendar(self, calendar: CalendarId) -> PlainDate {
        PlainDate { calendar, ..self }
    }

    /// AddDurationToDate
    pub fn add(self, duration: &Duration, overflow: Overflow) -> Result<PlainDate> {
        let duration = duration.date_with_whole_days_of_time();
        let date = self.calendar.add(self.date, duration, overflow)?;
        Ok(PlainDate::from_valid(date, self.calendar))
    }

    pub fn subtract(self, duration: &Duration, overflow: Overflow) -> Result<PlainDate> {
        self.add(&duration.negated(), overflow)
    }

    /// Comes before the options of `difference` are read.
    pub fn check_same_calendar(self, other: PlainDate) -> Result<()> {
        if self.calendar != other.calendar {
            return Err(Error::DatesInDifferentCalendars);
        }
        Ok(())
    }

    /// DifferenceTemporalPlainDate
    pub fn difference(
        self,
        operation: DifferenceOperation,
        other: PlainDate,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        let settings = options.resolve(operation, UnitGroup::Date, Unit::Day, Unit::Day)?;
        if self.date == other.date {
            return Ok(Duration::ZERO);
        }
        let mut duration: InternalDuration = (self.calendar)
            .until(self.date, other.date, settings.largest_unit)?
            .into();
        if !settings.rounding.is_to_one(Unit::Day) {
            let [start, end] = [self.date, other.date].map(IsoDateTime::at_midnight);
            duration = Span::plain(start, end, self.calendar).round(&duration, settings)?;
        }
        Duration::from_difference(operation, duration, Unit::Day)
    }

    pub fn to_plain_date_time(self, time: PlainTime) -> Result<PlainDateTime> {
        let date = self.date;
        PlainDateTime::new(IsoDateTime { date, time }, self.calendar)
    }

    pub fn to_plain_month_day(self) -> Result<PlainMonthDay> {
        PlainMonthDay::of_date(self.date, self.calendar)
    }

    pub fn to_plain_year_month(self) -> Result<PlainYearMonth> {
        PlainYearMonth::of_date(self.date, self.calendar)
    }

    /// At the start of the day if there is no time.
    pub fn to_zoned_date_time(
        self,
        time_zone: TimeZone,
        time: Option<PlainTime>,
    ) -> Result<ZonedDateTime> {
        let date = self.date;
        let local = match time.map(|time| IsoDateTime { date, time }) {
            None => time_zone.start_of_day(date)?,
            Some(date_time) if date_time.is_within_limits() => {
                time_zone.instant_for(date_time, Disambiguation::Compatible)?
            }
            Some(_) => return Err(Error::DateAndTimeOutOfRange),
        };
        Ok(ZonedDateTime::from_local(local, time_zone, self.calendar))
    }

    /// TemporalDateToString
    #[inline(always)]
    pub fn to_text(self, show_calendar: ShowCalendar) -> IsoText {
        let mut text = IsoText::new();
        text.push_date(self.date);
        text.push_calendar(self.calendar, show_calendar);
        text
    }
}
