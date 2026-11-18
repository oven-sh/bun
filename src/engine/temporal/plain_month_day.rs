use bun_engine_text::Text;

use crate::calendar::DateFields;
use crate::format::IsoText;
use crate::{
    CalendarId, Error, Fields, InputError, IsoDate, Overflow, PlainDate, Result, ShowCalendar,
    TextError, parse,
};

/// What a `Temporal.PlainMonthDay` holds: a date that has the month code and the day.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PlainMonthDay {
    date: IsoDate,
    calendar: CalendarId,
}

/// A string that is well formed. What it says is checked by `finish`, after the options have been read.
#[derive(Clone, Copy, Debug)]
pub struct ParsedPlainMonthDay(PlainMonthDay);

impl ParsedPlainMonthDay {
    pub fn finish(self) -> Result<PlainMonthDay> {
        let PlainMonthDay { date, calendar } = self.0;
        if calendar != CalendarId::Iso8601 && !date.is_within_limits() {
            return Err(Error::MonthDayTextOutOfRange);
        }
        PlainMonthDay::of_date(date, calendar)
    }
}

impl PlainMonthDay {
    /// The constructor.
    pub fn new(
        month: i32,
        day: i32,
        calendar: CalendarId,
        year: Option<i32>,
    ) -> Result<PlainMonthDay> {
        let year = year.unwrap_or(crate::calendar::ISO_REFERENCE_YEAR);
        match IsoDate::new(year, month, day) {
            Ok(date) if date.is_within_limits() => Ok(PlainMonthDay { date, calendar }),
            _ => Err(Error::PlainMonthDayOutOfRange),
        }
    }

    /// For `FieldSet::Date`.
    pub fn from_fields(fields: &Fields, overflow: Overflow) -> Result<PlainMonthDay> {
        PlainMonthDay::from_date_fields(&fields.date, fields.calendar, overflow)
    }

    fn from_date_fields(
        fields: &DateFields,
        calendar: CalendarId,
        overflow: Overflow,
    ) -> Result<PlainMonthDay> {
        let date = calendar.month_day_from_fields(fields, overflow)?;
        Ok(PlainMonthDay { date, calendar })
    }

    pub(crate) fn of_date(date: IsoDate, calendar: CalendarId) -> Result<PlainMonthDay> {
        let fields = DateFields::of_month_day(calendar, date)?;
        PlainMonthDay::from_date_fields(&fields, calendar, Overflow::Constrain)
    }

    pub fn parse(text: Text<'_>) -> Result<ParsedPlainMonthDay, InputError<'_>> {
        let parsed = parse::month_day(text).ok_or(InputError::Text(TextError::MonthDay, text))?;
        Ok(ParsedPlainMonthDay(PlainMonthDay {
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

    fn fields(self) -> Result<DateFields> {
        DateFields::of_month_day(self.calendar, self.date)
    }

    /// For `FieldSet::Date` in the calendar of `self`.
    pub fn with(self, fields: &Fields, overflow: Overflow) -> Result<PlainMonthDay> {
        let merged = self.fields()?.merged(&fields.date);
        PlainMonthDay::from_date_fields(&merged, self.calendar, overflow)
    }

    /// For `FieldSet::Year` in the calendar of `self`.
    pub fn to_plain_date(self, fields: &Fields) -> Result<PlainDate> {
        let given = fields.date;
        if given.year.is_none() && given.era.zip(given.era_year).is_none() {
            return Err(Error::MonthDayItemWithoutYear);
        }
        let merged = self.fields()?.merged(&given);
        let date = (self.calendar).date_from_fields(&merged, Overflow::Constrain)?;
        Ok(PlainDate::from_valid(date, self.calendar))
    }

    /// TemporalMonthDayToString
    #[inline(always)]
    pub fn to_text(self, show_calendar: ShowCalendar) -> IsoText {
        let mut text = IsoText::new();
        if show_calendar.needs_full_date(self.calendar) {
            text.push_date(self.date);
        } else {
            text.push_month_day(self.date);
        }
        text.push_calendar(self.calendar, show_calendar);
        text
    }
}
