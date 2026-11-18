use bun_engine_date::days_in_month;
use bun_engine_text::Text;

use crate::calendar::DateFields;
use crate::format::IsoText;
use crate::integer::saturate;
use crate::relative_rounding::Span;
use crate::unit::UnitGroup;
use crate::{
    CalendarId, DateDuration, DifferenceOperation, DifferenceOptions, Duration, Error, Fields,
    InputError, InternalDuration, IsoDate, IsoDateTime, Overflow, PlainDate, Result, ShowCalendar,
    TextError, Unit, parse,
};

/// What a `Temporal.PlainYearMonth` holds: a date in the month, which only the constructor can make another than the first.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PlainYearMonth {
    date: IsoDate,
    calendar: CalendarId,
}

/// A string that is well formed. What it says is checked by `finish`, after the options have been read.
#[derive(Clone, Copy, Debug)]
pub struct ParsedPlainYearMonth(PlainYearMonth);

impl ParsedPlainYearMonth {
    pub fn finish(self) -> Result<PlainYearMonth> {
        let PlainYearMonth { date, calendar } = self.0;
        if date.is_month_within_limits() {
            return PlainYearMonth::of_date(date, calendar);
        }
        Err(if calendar == CalendarId::Iso8601 {
            Error::PlainYearMonthOutOfRange
        } else if IsoDate::is_year_within_limits(date.year()) {
            Error::YearMonthFieldsOutOfRange
        } else {
            calendar.year_out_of_range(date.year(), Error::YearMonthFieldsOutOfRange)
        })
    }
}

impl PlainYearMonth {
    /// The constructor.
    pub fn new(
        year: i32,
        month: i32,
        calendar: CalendarId,
        day: Option<i32>,
    ) -> Result<PlainYearMonth> {
        let (month, day) = (saturate(month), day.map_or(1, saturate));
        if !(1..=12).contains(&month) || !(1..=days_in_month(year, month)).contains(&day) {
            return Err(Error::InvalidPlainYearMonth);
        }
        if !IsoDate::is_year_within_limits(year) {
            return Err(Error::YearOutOfRange);
        }
        let date = IsoDate::from_valid(year, month, day);
        if !date.is_month_within_limits() {
            return Err(Error::PlainYearMonthOutOfRange);
        }
        Ok(PlainYearMonth { date, calendar })
    }

    /// For `FieldSet::YearMonth`.
    pub fn from_fields(fields: &Fields, overflow: Overflow) -> Result<PlainYearMonth> {
        PlainYearMonth::from_date_fields(&fields.date, fields.calendar, overflow)
    }

    fn from_date_fields(
        fields: &DateFields,
        calendar: CalendarId,
        overflow: Overflow,
    ) -> Result<PlainYearMonth> {
        let date = calendar.year_month_from_fields(fields, overflow)?;
        Ok(PlainYearMonth { date, calendar })
    }

    pub(crate) fn of_date(date: IsoDate, calendar: CalendarId) -> Result<PlainYearMonth> {
        let fields = DateFields::of_year_month(calendar, date)?;
        PlainYearMonth::from_date_fields(&fields, calendar, Overflow::Constrain)
    }

    pub fn parse(text: Text<'_>) -> Result<ParsedPlainYearMonth, InputError<'_>> {
        let parsed = parse::year_month(text).ok_or(InputError::Text(TextError::YearMonth, text))?;
        Ok(ParsedPlainYearMonth(PlainYearMonth {
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
        DateFields::of_year_month(self.calendar, self.date)
    }

    fn date_on(self, day: u8) -> Result<IsoDate> {
        let fields = DateFields {
            day: Some(day),
            ..self.fields()?
        };
        self.calendar.date_from_fields(&fields, Overflow::Constrain)
    }

    /// For `FieldSet::YearMonth` in the calendar of `self`.
    pub fn with(self, fields: &Fields, overflow: Overflow) -> Result<PlainYearMonth> {
        let merged = self.fields()?.merged(&fields.date);
        PlainYearMonth::from_date_fields(&merged, self.calendar, overflow)
    }

    /// AddDurationToYearMonth
    pub fn add(self, duration: &Duration, overflow: Overflow) -> Result<PlainYearMonth> {
        let InternalDuration { date, time } = duration.to_internal();
        if date.weeks != 0 || date.days != 0 || time.sign() != 0 {
            return Err(Error::UnitsBelowMonth);
        }
        let added = self.calendar.add(self.date_on(1)?, date, overflow)?;
        PlainYearMonth::of_date(added, self.calendar)
    }

    pub fn subtract(self, duration: &Duration, overflow: Overflow) -> Result<PlainYearMonth> {
        self.add(&duration.negated(), overflow)
    }

    /// Comes before the options of `difference` are read.
    pub fn check_same_calendar(self, other: PlainYearMonth) -> Result<()> {
        if self.calendar != other.calendar {
            return Err(Error::YearMonthsInDifferentCalendars);
        }
        Ok(())
    }

    /// DifferenceTemporalPlainYearMonth
    pub fn difference(
        self,
        operation: DifferenceOperation,
        other: PlainYearMonth,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        let settings = options.resolve(operation, UnitGroup::Date, Unit::Month, Unit::Year)?;
        if settings.largest_unit < Unit::Month {
            return Err(Error::LargestUnitBelowMonth);
        }
        if settings.rounding.unit < Unit::Month {
            return Err(Error::SmallestUnitBelowMonth);
        }
        if self.date == other.date {
            return Ok(Duration::ZERO);
        }
        if !self.date.is_within_limits() || !other.date.is_within_limits() {
            return Err(Error::YearMonthDifferenceOutOfRange);
        }
        let (start, end) = (self.start_of_difference()?, other.start_of_difference()?);
        let difference = self.calendar.until(start, end, settings.largest_unit)?;
        let mut duration = InternalDuration::from(DateDuration {
            weeks: 0,
            days: 0,
            ..difference
        });
        if !settings.rounding.is_to_one(Unit::Month) {
            let [start, end] = [start, end].map(IsoDateTime::at_midnight);
            duration = Span::plain(start, end, self.calendar).round(&duration, settings)?;
        }
        Duration::from_difference(operation, duration, Unit::Day)
    }

    fn start_of_difference(self) -> Result<IsoDate> {
        match self.calendar {
            CalendarId::Iso8601 => self.date_on(1).or(Err(Error::YearMonthStartOutOfRange)),
            _ => self.date_on(1),
        }
    }

    /// For `FieldSet::Day`.
    pub fn to_plain_date(self, fields: &Fields) -> Result<PlainDate> {
        let day = fields.date.day.ok_or(Error::YearMonthItemWithoutDay)?;
        let date = match self.calendar {
            CalendarId::Iso8601 => self.date_on(day).or(Err(Error::DateTimeOutOfRange))?,
            _ => self.date_on(day)?,
        };
        Ok(PlainDate::from_valid(date, self.calendar))
    }

    /// TemporalYearMonthToString
    #[inline(always)]
    pub fn to_text(self, show_calendar: ShowCalendar) -> IsoText {
        let mut text = IsoText::new();
        if show_calendar.needs_full_date(self.calendar) {
            text.push_date(self.date);
        } else {
            text.push_year_month(self.date);
        }
        text.push_calendar(self.calendar, show_calendar);
        text
    }
}
