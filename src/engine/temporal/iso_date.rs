use core::fmt;

use bun_engine_date::{
    CivilDate, civil_from_days, day_of_year, days_from_civil, days_in_month, days_in_year, week_day,
};

use crate::integer::saturate;
use crate::{Error, Overflow, Result};

/// An ISO Date Record: a date that exists in the proleptic Gregorian calendar. It can be outside the limits of the `Temporal`
/// types, but its year has at most 22 bits.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct IsoDate(i32);

/// ISOWeekOfYear
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct IsoWeek {
    pub year: i32,
    pub week: u8,
}

impl IsoDate {
    pub(crate) const MIN: IsoDate = IsoDate::from_valid(-271_821, 4, 19);
    pub(crate) const MAX: IsoDate = IsoDate::from_valid(275_760, 9, 13);

    #[inline]
    pub(crate) const fn from_valid(year: i32, month: u8, day: u8) -> IsoDate {
        debug_assert!(year.unsigned_abs() < 1 << 22 && month >= 1 && month <= 12);
        debug_assert!(day >= 1 && day <= days_in_month(year, month));
        IsoDate(year << 9 | (month as i32) << 5 | day as i32)
    }

    /// IsValidISODate and CreateISODateRecord, for a year that the `Temporal` types can have.
    pub fn new(year: i32, month: i32, day: i32) -> Result<IsoDate> {
        if !IsoDate::is_year_within_limits(year) {
            return Err(Error::YearOutOfRange);
        }
        let month @ 1..=12 = saturate(month) else {
            return Err(Error::MonthOutOfRange);
        };
        let day = saturate(day);
        if day < 1 || day > days_in_month(year, month) {
            return Err(Error::DayOutOfRange);
        }
        Ok(IsoDate::from_valid(year, month, day))
    }

    /// RegulateISODate, for a month that exists and a day that is positive.
    #[inline]
    pub(crate) fn regulate(year: i32, month: u8, day: u8, overflow: Overflow) -> Result<IsoDate> {
        let day = overflow.limit(day, days_in_month(year, month), Error::DateTimeOutOfRange)?;
        Ok(IsoDate::from_valid(year, month, day))
    }

    /// `None` if the date is far outside the limits.
    #[inline]
    pub(crate) fn checked_from_epoch_days(days: i64) -> Option<IsoDate> {
        (days.unsigned_abs() < 1 << 29).then(|| IsoDate::from_epoch_days(days as i32))
    }

    /// `days` is below 2^30 in magnitude.
    #[inline]
    pub(crate) fn from_epoch_days(days: i32) -> IsoDate {
        let date = civil_from_days(days);
        IsoDate::from_valid(date.year, date.month, date.day)
    }

    #[inline]
    pub const fn year(self) -> i32 {
        self.0 >> 9
    }

    #[inline]
    pub const fn month(self) -> u8 {
        (self.0 >> 5 & 0xf) as u8
    }

    #[inline]
    pub const fn day(self) -> u8 {
        (self.0 & 0x1f) as u8
    }

    /// ISODateToEpochDays
    #[inline]
    pub const fn epoch_days(self) -> i32 {
        days_from_civil(self.year(), self.month(), self.day()) as i32
    }

    /// Monday is 1 and Sunday is 7.
    #[inline]
    pub fn day_of_week(self) -> u8 {
        match week_day(self.epoch_days()) {
            0 => 7,
            day => day,
        }
    }

    #[inline]
    pub(crate) fn day_of_year(self) -> u16 {
        day_of_year(CivilDate {
            year: self.year(),
            month: self.month(),
            day: self.day(),
        })
    }

    /// A week belongs to the year that has its Thursday.
    pub(crate) fn week(self) -> IsoWeek {
        let mut year = self.year();
        let mut thursday = i32::from(self.day_of_year()) + 4 - i32::from(self.day_of_week());
        if thursday < 1 {
            year -= 1;
            thursday += i32::from(days_in_year(year));
        } else if thursday > i32::from(days_in_year(year)) {
            thursday -= i32::from(days_in_year(year));
            year += 1;
        }
        IsoWeek {
            year,
            week: ((thursday + 6) / 7) as u8,
        }
    }

    #[inline]
    pub(crate) fn first_of_month(self) -> IsoDate {
        IsoDate::from_valid(self.year(), self.month(), 1)
    }

    /// AddDaysToISODate. `None` if the result is far outside the limits.
    #[inline]
    pub(crate) fn checked_add_days(self, days: i64) -> Option<IsoDate> {
        let day = i64::from(self.day()) + days;
        if (1..=28).contains(&day) {
            return Some(IsoDate::from_valid(self.year(), self.month(), day as u8));
        }
        IsoDate::checked_from_epoch_days(i64::from(self.epoch_days()) + days)
    }

    /// AddDaysToISODate
    #[inline]
    pub(crate) fn add_few_days(self, days: i8) -> IsoDate {
        let day = i32::from(self.day()) + i32::from(days);
        if (1..=28).contains(&day) {
            return IsoDate::from_valid(self.year(), self.month(), day as u8);
        }
        IsoDate::from_epoch_days(self.epoch_days() + i32::from(days))
    }

    #[inline]
    pub(crate) fn days_until(self, other: IsoDate) -> i64 {
        i64::from(other.epoch_days()) - i64::from(self.epoch_days())
    }

    #[inline]
    pub(crate) fn is_year_within_limits(year: i32) -> bool {
        (IsoDate::MIN.year()..=IsoDate::MAX.year()).contains(&year)
    }

    /// ISODateWithinLimits
    #[inline]
    pub(crate) fn is_within_limits(self) -> bool {
        (IsoDate::MIN..=IsoDate::MAX).contains(&self)
    }

    /// ISOYearMonthWithinLimits
    #[inline]
    pub(crate) fn is_month_within_limits(self) -> bool {
        (IsoDate::MIN.first_of_month()..=IsoDate::MAX).contains(&self.first_of_month())
    }

    /// CheckISODaysRange
    #[inline]
    pub(crate) fn is_within_days_range(self) -> bool {
        self > IsoDate::MIN && self <= IsoDate::MAX
    }
}

impl fmt::Debug for IsoDate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (year, month, day) = (self.year(), self.month(), self.day());
        write!(formatter, "{year:04}-{month:02}-{day:02}")
    }
}
