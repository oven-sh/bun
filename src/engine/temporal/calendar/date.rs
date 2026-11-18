use bun_engine_date::{days_in_month, days_in_year, is_leap_year};
use bun_engine_text::PropertyName;

use super::systems::{Layout, System};
use super::year::YearMonth;
use crate::{CalendarId, EraYear, IsoDate, IsoWeek, MonthCode, Result};

/// A Calendar Date Record, without what concerns weeks.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CalendarDate {
    pub era: Option<EraYear>,
    pub year: i32,
    pub month: u8,
    month_code: MonthCode,
    pub day: u8,
    pub day_of_year: u16,
    pub days_in_month: u8,
    pub days_in_year: u16,
    pub months_in_year: u8,
    pub in_leap_year: bool,
}

impl CalendarDate {
    #[inline]
    pub fn month_code(&self) -> PropertyName<'static> {
        self.month_code.name()
    }

    #[inline(always)]
    fn iso(date: IsoDate) -> CalendarDate {
        CalendarDate {
            era: None,
            year: date.year(),
            month: date.month(),
            month_code: MonthCode::new(date.month(), false),
            day: date.day(),
            day_of_year: date.day_of_year(),
            days_in_month: days_in_month(date.year(), date.month()),
            days_in_year: days_in_year(date.year()),
            months_in_year: 12,
            in_leap_year: is_leap_year(date.year()),
        }
    }
}

impl System {
    /// The month that `date` is in, and the day of the month.
    #[inline]
    pub(super) fn locate(self, date: IsoDate) -> Result<(YearMonth, u8)> {
        let epoch_day = date.epoch_days();
        let month = self.month_of_day(epoch_day)?;
        Ok((month, (epoch_day - month.first_day()) as u8 + 1))
    }
}

impl CalendarId {
    /// CalendarISOToDate
    #[inline(always)]
    pub fn date(self, date: IsoDate) -> Result<CalendarDate> {
        if self == CalendarId::Iso8601 {
            return Ok(CalendarDate::iso(date));
        }
        match self.layout(date.year()) {
            Layout::Own(system) => self.date_in_system(system, date),
            Layout::Iso { year_offset } => {
                let year = date.year() - year_offset;
                Ok(CalendarDate {
                    era: self.era_year(year, date),
                    year,
                    in_leap_year: is_leap_year(date.year()) && !self.is_chinese_or_dangi(),
                    ..CalendarDate::iso(date)
                })
            }
        }
    }

    fn date_in_system(self, system: System, date: IsoDate) -> Result<CalendarDate> {
        let (month, day) = system.locate(date)?;
        let year = month.year;
        Ok(CalendarDate {
            era: self.era_year(year.number, date),
            year: year.number,
            month: month.month,
            month_code: month.code(),
            day,
            day_of_year: year.months.days_before(month.month) + u16::from(day),
            days_in_month: month.days(),
            days_in_year: year.days,
            months_in_year: year.months.count,
            in_leap_year: system.is_leap_year(year),
        })
    }

    /// Only the ISO 8601 calendar numbers its weeks.
    #[inline]
    pub fn week(self, date: IsoDate) -> Option<IsoWeek> {
        (self == CalendarId::Iso8601).then(|| date.week())
    }

    /// The year, the month code and the day, which are what ISODateToFields chooses from.
    #[inline]
    pub(super) fn identifying_fields(self, date: IsoDate) -> Result<(i32, MonthCode, u8)> {
        let date = self.date(date)?;
        Ok((date.year, date.month_code, date.day))
    }
}
