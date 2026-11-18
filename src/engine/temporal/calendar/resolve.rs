use super::systems::Layout;
use super::year::{Year, YearMonth};
use super::{DateFields, EraYear};
use crate::{CalendarId, Error, IsoDate, MonthCode, Overflow, Result};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum YearField {
    Required,
    /// Unless it takes the year to make sense of the month.
    Optional,
}

/// How the fields name the month.
#[derive(Clone, Copy)]
pub(super) enum MonthField {
    Number(u8),
    /// One that the calendar has, and the number if that is given too.
    Code(MonthCode, Option<u8>),
}

/// The result of CalendarResolveFields, but for what depends on the months of the year.
#[derive(Clone, Copy)]
pub(super) struct Resolved {
    pub(super) year: Option<i32>,
    pub(super) month: MonthField,
    pub(super) day: u8,
}

impl CalendarId {
    /// CalendarDateFromFields
    pub(crate) fn date_from_fields(
        self,
        fields: &DateFields,
        overflow: Overflow,
    ) -> Result<IsoDate> {
        let out_of_range = Error::DateFieldsOutOfRange;
        let date = self.fields_to_iso(fields, overflow, out_of_range)?;
        date.is_within_limits().then_some(date).ok_or(out_of_range)
    }

    /// CalendarYearMonthFromFields
    pub(crate) fn year_month_from_fields(
        self,
        fields: &DateFields,
        overflow: Overflow,
    ) -> Result<IsoDate> {
        let out_of_range = Error::YearMonthFieldsOutOfRange;
        let fields = DateFields {
            day: Some(1),
            ..*fields
        };
        let date = self.fields_to_iso(&fields, overflow, out_of_range)?;
        (date.is_month_within_limits())
            .then_some(date)
            .ok_or(out_of_range)
    }

    /// CalendarResolveFields and CalendarDateToISO
    #[inline]
    fn fields_to_iso(
        self,
        fields: &DateFields,
        overflow: Overflow,
        out_of_range: Error,
    ) -> Result<IsoDate> {
        let resolved = self.resolve(fields, YearField::Required)?;
        let year = resolved.year.ok_or(Error::MissingYear)?;
        let date = match self.layout(year) {
            Layout::Iso { year_offset } => {
                self.regulate_iso_months(year + year_offset, resolved, overflow)?
            }
            Layout::Own(system) => {
                let (month, day) = self.regulate(system.year(year)?, resolved, overflow)?;
                month.iso_date(day)
            }
        };
        if !IsoDate::is_year_within_limits(date.year()) {
            return Err(self.year_out_of_range(year, out_of_range));
        }
        Ok(date)
    }

    /// The error for a date whose ISO 8601 year is outside the limits.
    pub(crate) fn year_out_of_range(self, year: i32, otherwise: Error) -> Error {
        match (self, self.layout(year)) {
            (CalendarId::Gregory, _) | (_, Layout::Own(_)) => Error::CalendarDateOutOfRange,
            _ => otherwise,
        }
    }

    #[inline]
    pub(super) fn resolve(self, fields: &DateFields, year_field: YearField) -> Result<Resolved> {
        if self != CalendarId::Iso8601 {
            return self.resolve_non_iso(fields, year_field);
        }
        if year_field == YearField::Required && fields.year.is_none() {
            return Err(Error::MissingYear);
        }
        let day = fields.day.ok_or(Error::MissingDay)?;
        let month = match (fields.month_code, fields.month) {
            (None, None) => return Err(Error::MissingMonth),
            _ if year_field == YearField::Required && is_too_far(fields.year) => {
                return Err(Error::DateFieldsOutOfRange);
            }
            (None, Some(month)) => month,
            (Some(code), _) if code.is_leap_month() => return Err(Error::LeapMonthInIsoCalendar),
            (Some(code), _) if code.number() > 12 => return Err(Error::MonthCodeNotInIsoCalendar),
            (Some(code), month) => agreeing(code.number(), month)?,
        };
        Ok(Resolved {
            year: fields.year,
            month: MonthField::Number(month),
            day,
        })
    }

    /// NonISOResolveFields
    fn resolve_non_iso(self, fields: &DateFields, year_field: YearField) -> Result<Resolved> {
        let needs_year = year_field == YearField::Required
            || fields.month_code.is_none()
            || fields.month.is_some();
        let era = fields.era.zip(fields.era_year);
        if needs_year && fields.year.is_none() && era.is_none() {
            return Err(Error::MissingYear);
        }
        if fields.era.is_some() != fields.era_year.is_some() {
            return Err(Error::EraWithoutEraYear);
        }
        let day = fields.day.ok_or(Error::MissingDay)?;
        let month = match (fields.month_code, fields.month) {
            (None, None) => return Err(Error::MissingMonth),
            (None, Some(month)) => MonthField::Number(month),
            (Some(code), month) => MonthField::Code(code, month),
        };

        if is_too_far(fields.year) {
            return Err(Error::DateFieldsOutOfRange);
        }
        if is_too_far(fields.era_year) {
            return Err(Error::EraYearOutOfRange);
        }
        let mut year = fields.year;
        if let Some((era, era_year)) = era {
            let arithmetic_year = self.arithmetic_year(EraYear {
                era: era.ok_or(Error::InvalidEra)?,
                year: era_year,
            });
            if year.is_some_and(|year| year != arithmetic_year) {
                return Err(Error::YearContradictsEra);
            }
            year = Some(arithmetic_year);
        }
        if (fields.month_code).is_some_and(|code| !self.has_month_code(code)) {
            return Err(Error::MonthCodeNotInCalendar);
        }
        Ok(Resolved { year, month, day })
    }

    /// The errors for a month and for a day that do not exist.
    fn rejections(self, year: i32) -> [Error; 2] {
        match (self, self.layout(year)) {
            (CalendarId::Iso8601, _) => [Error::DateTimeOutOfRange; 2],
            (CalendarId::Indian, _)
            | (CalendarId::Chinese | CalendarId::Dangi, Layout::Iso { .. }) => {
                [Error::MonthOutOfRange, Error::DayNotInMonth]
            }
            (CalendarId::Buddhist | CalendarId::Japanese | CalendarId::Roc, _) => {
                [Error::MonthNotInCalendar, Error::DayNotInMonth]
            }
            _ => [Error::MonthNotInYear, Error::DayNotInCalendarMonth],
        }
    }

    /// The month and the day in a year that has the months of the ISO 8601 year `iso_year`, which can be of any size.
    #[inline]
    pub(super) fn regulate_iso_month_day(
        self,
        iso_year: i32,
        resolved: Resolved,
        overflow: Overflow,
    ) -> Result<(u8, u8)> {
        let month = match resolved.month {
            MonthField::Number(month) => month,
            MonthField::Code(code, month) => {
                let month = agreeing(code.number(), month)?;
                if code.is_leap_month() && overflow == Overflow::Reject {
                    return Err(Error::MonthCodeNotInYear);
                }
                month
            }
        };
        let [no_month, no_day] = self.rejections(iso_year);
        let month = overflow.limit(month, 12, no_month)?;
        let days = bun_engine_date::days_in_month(iso_year, month);
        Ok((month, overflow.limit(resolved.day, days, no_day)?))
    }

    #[inline]
    fn regulate_iso_months(
        self,
        iso_year: i32,
        resolved: Resolved,
        overflow: Overflow,
    ) -> Result<IsoDate> {
        let (month, day) = self.regulate_iso_month_day(iso_year, resolved, overflow)?;
        Ok(IsoDate::from_valid(iso_year, month, day))
    }

    /// NonISOCalendarDateToISO, up to the conversion.
    pub(super) fn regulate(
        self,
        year: Year,
        resolved: Resolved,
        overflow: Overflow,
    ) -> Result<(YearMonth, u8)> {
        let [no_month, no_day] = self.rejections(year.number);
        let month = match resolved.month {
            MonthField::Number(month) => {
                year.month(overflow.limit(month, year.months.count, no_month)?)
            }
            MonthField::Code(code, number) => {
                let month = self.constrain_month_code(year, code);
                agreeing(month.month, number)?;
                if month.code() != code && overflow == Overflow::Reject {
                    return Err(Error::MonthCodeNotInYear);
                }
                month
            }
        };
        Ok((month, overflow.limit(resolved.day, month.days(), no_day)?))
    }

    /// ConstrainMonthCode and MonthCodeToOrdinal
    #[inline]
    pub(super) fn constrain_month_code(self, year: Year, code: MonthCode) -> YearMonth {
        let months = year.months;
        let substitute = || months.regular_ordinal(self.substitute_for_leap_month(code));
        year.month(months.ordinal(code).unwrap_or_else(substitute))
    }
}

/// No calendar has a year of such a magnitude within the limits.
fn is_too_far(year: Option<i32>) -> bool {
    year.is_some_and(|year| year.unsigned_abs() > 300_000)
}

fn agreeing(month: u8, given: Option<u8>) -> Result<u8> {
    if given.is_some_and(|given| given != month) {
        return Err(Error::MonthContradictsMonthCode);
    }
    Ok(month)
}
