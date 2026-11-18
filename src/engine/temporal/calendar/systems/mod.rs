//! How each calendar lays its years out over the days since the epoch.

mod chinese;
mod coptic;
mod hebrew;
mod indian;
mod islamic;
mod observed;
mod persian;

use super::era::AMETE_ALEM_YEARS;
use super::year::{Year, YearMonth};
use crate::{CalendarId, Error, Result};

/// The day of 1970-01-01.
const JULIAN_DAY_OF_EPOCH: i32 = 2_440_588;

/// The months that a calendar has in some range of years.
#[derive(Clone, Copy)]
pub(super) enum Layout {
    /// Those of ISO 8601, whose year number is greater by `year_offset`.
    Iso {
        year_offset: i32,
    },
    Own(System),
}

#[derive(Clone, Copy)]
pub(super) enum System {
    Chinese(chinese::Variant),
    Coptic { year_offset: i32 },
    Hebrew,
    Indian,
    Islamic(islamic::Variant),
    Persian,
}

impl CalendarId {
    /// `year` is that of the calendar or that of ISO 8601, which are close wherever it matters.
    #[inline]
    pub(super) fn layout(self, year: i32) -> Layout {
        let iso = |year_offset| Layout::Iso { year_offset };
        let coptic = |year_offset| Layout::Own(System::Coptic { year_offset });
        match self {
            CalendarId::Gregory | CalendarId::Iso8601 | CalendarId::Japanese => iso(0),
            CalendarId::Buddhist => iso(-543),
            CalendarId::Roc => iso(1911),
            CalendarId::Chinese | CalendarId::Dangi if !chinese::is_computed(year.into()) => iso(0),
            CalendarId::Chinese => Layout::Own(System::Chinese(chinese::Variant::China)),
            CalendarId::Dangi => Layout::Own(System::Chinese(chinese::Variant::Korea)),
            CalendarId::Coptic => coptic(0),
            CalendarId::Ethiopic => coptic(-coptic::ETHIOPIC_YEARS),
            CalendarId::Ethioaa => coptic(-coptic::ETHIOPIC_YEARS - AMETE_ALEM_YEARS),
            CalendarId::Hebrew => Layout::Own(System::Hebrew),
            CalendarId::Indian => Layout::Own(System::Indian),
            CalendarId::IslamicCivil => Layout::Own(System::Islamic(islamic::Variant::Civil)),
            CalendarId::IslamicTbla => Layout::Own(System::Islamic(islamic::Variant::Tbla)),
            CalendarId::IslamicUmalqura => {
                Layout::Own(System::Islamic(islamic::Variant::UmmAlQura))
            }
            CalendarId::Persian => Layout::Own(System::Persian),
        }
    }
}

impl System {
    /// Whether arithmetic can end in the year.
    pub(super) fn has_year(self, number: i64) -> bool {
        match self {
            System::Chinese(_) => chinese::is_computed(number),
            _ => number.unsigned_abs() <= 1_000_000,
        }
    }

    #[inline]
    pub(super) fn year(self, number: i32) -> Result<Year> {
        match self {
            System::Chinese(variant) => variant.year(number),
            System::Coptic { year_offset } => Ok(coptic::year(number, year_offset)),
            System::Hebrew => Ok(hebrew::year(number)),
            System::Indian => Ok(indian::year(number)),
            System::Islamic(variant) => variant.year(number),
            System::Persian => persian::year(number),
        }
    }

    #[inline]
    pub(super) fn month_of_day(self, epoch_day: i32) -> Result<YearMonth> {
        // At most one off.
        let mut number = match self {
            System::Chinese(_) => chinese::estimate_year(epoch_day),
            System::Coptic { year_offset } => coptic::year_of_day(epoch_day, year_offset),
            System::Hebrew => hebrew::estimate_year(epoch_day),
            System::Indian => indian::year_of_day(epoch_day),
            System::Islamic(variant) => variant.estimate_year(epoch_day),
            System::Persian => persian::estimate_year(epoch_day),
        };
        for _ in 0..2 {
            let year = self.year(number)?;
            if epoch_day < year.first_day {
                number -= 1;
            } else if epoch_day >= year.end() {
                number += 1;
            } else {
                return Ok(year.month_of_day(epoch_day));
            }
        }
        Err(Error::CalendarDataUnavailable)
    }

    /// `None` if the result is outside the years that the system has.
    pub(super) fn add_months(self, start: YearMonth, months: i64) -> Result<Option<YearMonth>> {
        let elapsed = i64::from(start.month - 1) + months;
        let count = i64::from(start.year.months.count);
        if (0..count).contains(&elapsed) {
            return Ok(Some(start.year.month(elapsed as u8 + 1)));
        }
        let number = i64::from(start.year.number);
        let (number, elapsed) = match self {
            System::Chinese(_) => {
                return chinese::middle_of_month_after(start, months)
                    .map(|epoch_day| self.month_of_day(epoch_day))
                    .transpose();
            }
            System::Hebrew => hebrew::split_months(hebrew::months_before(number) + elapsed),
            _ => (
                number + elapsed.div_euclid(count),
                elapsed.rem_euclid(count),
            ),
        };
        if !self.has_year(number) {
            return Ok(None);
        }
        Ok(Some(self.year(number as i32)?.month(elapsed as u8 + 1)))
    }

    pub(super) fn months_until(self, start: YearMonth, end: YearMonth) -> i64 {
        let (first, last) = (i64::from(start.year.number), i64::from(end.year.number));
        let between_years = match self {
            System::Chinese(_) => {
                chinese::months_in_days(end.year.first_day - start.year.first_day)
            }
            System::Hebrew => hebrew::months_before(last) - hebrew::months_before(first),
            _ => (last - first) * i64::from(start.year.months.count),
        };
        between_years + i64::from(end.month) - i64::from(start.month)
    }

    pub(super) fn is_leap_year(self, year: Year) -> bool {
        match self {
            System::Chinese(_) | System::Hebrew => year.months.leap_month != 0,
            System::Islamic(_) => year.days > 354,
            System::Coptic { .. } | System::Indian | System::Persian => year.days > 365,
        }
    }

    pub(super) fn is_solar(self) -> bool {
        matches!(
            self,
            System::Coptic { .. } | System::Indian | System::Persian
        )
    }
}
