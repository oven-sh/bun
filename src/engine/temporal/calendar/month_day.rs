use super::DateFields;
use super::resolve::{MonthField, Resolved, YearField};
use super::systems::{Layout, System};
use crate::{CalendarId, Error, IsoDate, MonthCode, Overflow, Result};

/// The first leap year after the epoch.
pub(crate) const ISO_REFERENCE_YEAR: i32 = 1972;

const LATEST_DATE: IsoDate = IsoDate::from_valid(ISO_REFERENCE_YEAR, 12, 31);

/// Every month other than a leap month of `chinese` and `dangi` has its greatest length in one of the years before
/// `LATEST_DATE`.
const YEARS_TO_SEARCH: i32 = 7;

/// For each leap month of `chinese` and `dangi`, the year to take days 1 to 29 from and the one to take day 30 from.
const LEAP_MONTH_YEARS: [[Option<i32>; 2]; 12] = [
    [None, None],
    [Some(1947), None],
    [Some(1966), Some(1955)],
    [Some(1963), Some(1944)],
    [Some(1971), Some(1952)],
    [Some(1960), Some(1941)],
    [Some(1968), Some(1938)],
    [Some(1957), None],
    [Some(2014), None],
    [Some(1984), None],
    [Some(2033), None],
    [None, None],
];

impl CalendarId {
    /// CalendarMonthDayFromFields
    pub(crate) fn month_day_from_fields(
        self,
        fields: &DateFields,
        overflow: Overflow,
    ) -> Result<IsoDate> {
        let mut resolved = self.resolve(fields, YearField::Optional)?;
        if let Some(year) = resolved.year {
            resolved = self.in_year(year, resolved, overflow)?;
        }
        match (self.layout(ISO_REFERENCE_YEAR), resolved.month) {
            (Layout::Own(system), MonthField::Code(code, _)) => {
                self.reference_date(system, code, resolved.day, overflow)
            }
            _ => {
                let (month, day) =
                    self.regulate_iso_month_day(ISO_REFERENCE_YEAR, resolved, overflow)?;
                Ok(IsoDate::from_valid(ISO_REFERENCE_YEAR, month, day))
            }
        }
    }

    /// A month code and a day that exist in `year`.
    fn in_year(self, year: i32, resolved: Resolved, overflow: Overflow) -> Result<Resolved> {
        let (code, day, is_within_limits) = match self.layout(year) {
            Layout::Iso { year_offset } => {
                let iso_year = year + year_offset;
                let (month, day) = self.regulate_iso_month_day(iso_year, resolved, overflow)?;
                let is_within_limits =
                    self == CalendarId::Iso8601 || IsoDate::is_year_within_limits(iso_year);
                (MonthCode::new(month, false), day, is_within_limits)
            }
            Layout::Own(system) => {
                let year = system.year(year)?;
                let (month, day) = self.regulate(year, resolved, overflow)?;
                (month.code(), day, year.has_date_within_limits())
            }
        };
        if !is_within_limits {
            return Err(self.year_out_of_range(year, Error::DateFieldsOutOfRange));
        }
        Ok(Resolved {
            year: None,
            month: MonthField::Code(code, None),
            day,
        })
    }

    /// The last steps of NonISOMonthDayToISOReferenceDate.
    fn reference_date(
        self,
        system: System,
        mut code: MonthCode,
        day: u8,
        overflow: Overflow,
    ) -> Result<IsoDate> {
        let resolved = |code| Resolved {
            year: None,
            month: MonthField::Code(code, None),
            day,
        };
        if code.is_leap_month() && self.is_chinese_or_dangi() {
            let years = LEAP_MONTH_YEARS[usize::from(code.number() - 1)];
            if let Some(year) = years[usize::from(day >= 30)] {
                let (month, day) = self.regulate(system.year(year)?, resolved(code), overflow)?;
                return Ok(month.iso_date(day));
            }
            if overflow == Overflow::Reject {
                return Err(Error::LeapMonthWithoutReferenceYear);
            }
            code = self.substitute_for_leap_month(code);
        }

        let latest_year = system.locate(LATEST_DATE)?.0.year.number;
        let mut longest = None;
        for number in (latest_year - YEARS_TO_SEARCH..=latest_year).rev() {
            let year = system.year(number)?;
            let Some(ordinal) = year.months.ordinal(code) else {
                continue;
            };
            let month = year.month(ordinal);
            let available = day.min(month.days());
            let date = month.iso_date(available);
            if date > LATEST_DATE {
                continue;
            }
            if available == day {
                return Ok(date);
            }
            if longest.is_none_or(|(days, _)| available > days) {
                longest = Some((available, year));
            }
        }
        let (_, year) = longest.ok_or(Error::CalendarDataUnavailable)?;
        let (month, day) = self.regulate(year, resolved(code), overflow)?;
        Ok(month.iso_date(day))
    }
}
