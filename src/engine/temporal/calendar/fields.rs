use crate::{CalendarId, Era, IsoDate, MonthCode, Result};

/// The part of a Calendar Fields Record that identifies a date. A month or a day is positive.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(crate) struct DateFields {
    /// The inner `None` is a name that the calendar does not have.
    pub(crate) era: Option<Option<Era>>,
    pub(crate) era_year: Option<i32>,
    pub(crate) year: Option<i32>,
    pub(crate) month: Option<u8>,
    pub(crate) month_code: Option<MonthCode>,
    pub(crate) day: Option<u8>,
}

impl DateFields {
    /// ISODateToFields for `date`.
    #[inline]
    pub(crate) fn of_date(calendar: CalendarId, date: IsoDate) -> Result<DateFields> {
        let (year, month_code, day) = calendar.identifying_fields(date)?;
        Ok(DateFields {
            year: Some(year),
            month_code: Some(month_code),
            day: Some(day),
            ..DateFields::default()
        })
    }

    /// ISODateToFields for `year-month`.
    pub(crate) fn of_year_month(calendar: CalendarId, date: IsoDate) -> Result<DateFields> {
        Ok(DateFields {
            day: None,
            ..DateFields::of_date(calendar, date)?
        })
    }

    /// ISODateToFields for `month-day`.
    pub(crate) fn of_month_day(calendar: CalendarId, date: IsoDate) -> Result<DateFields> {
        Ok(DateFields {
            year: None,
            ..DateFields::of_date(calendar, date)?
        })
    }

    /// CalendarMergeFields, for fields that come from ISODateToFields and so have neither an era nor a month number.
    #[inline]
    pub(crate) fn merged(self, additional: &DateFields) -> DateFields {
        let names_era = additional.era.is_some() || additional.era_year.is_some();
        let year = self.year.filter(|_| !names_era);
        let month_code = self.month_code.filter(|_| additional.month.is_none());
        DateFields {
            year: additional.year.or(year),
            month_code: additional.month_code.or(month_code),
            day: additional.day.or(self.day),
            ..*additional
        }
    }
}
