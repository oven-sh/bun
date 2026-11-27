//! Day and millisecond arithmetic for time zones and calendars. ICU4C: gregoimp.cpp

pub(crate) use crate::common::putil::{UDate, double_to_int32};
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, UErrorCode};
use crate::i18n::unicode::ucal::{UCAL_MARCH, UCAL_SATURDAY, UCAL_SUNDAY, UCAL_THURSDAY};

pub(crate) const U_MILLIS_PER_SECOND: i32 = 1000;
pub(crate) const U_MILLIS_PER_MINUTE: i32 = 60000;
pub(crate) const U_MILLIS_PER_HOUR: i32 = 3600000;
pub(crate) const U_MILLIS_PER_DAY: i32 = 86400000;

pub(crate) const ONE_DAY: f64 = U_MILLIS_PER_DAY as f64;

pub(crate) const JAN_1_1_JULIAN_DAY: i32 = 1721426;
pub(crate) const EPOCH_START_AS_JULIAN_DAY: i32 = 2440588;
pub(crate) const EPOCH_YEAR: i32 = 1970;

// The range of `Calendar::set_time`.
pub(crate) const MIN_MILLIS: f64 = (-0x7F000000 - EPOCH_START_AS_JULIAN_DAY) as f64 * ONE_DAY;
pub(crate) const MAX_MILLIS: f64 = (0x7F000000 - EPOCH_START_AS_JULIAN_DAY) as f64 * ONE_DAY;

/// Returns the day and the milliseconds in the day, which are negative if the quotient is rounded up.
#[inline]
pub(crate) fn day_and_millis(time: UDate) -> (f64, i32) {
    let day = (time / ONE_DAY).floor();
    (day, double_to_int32(time.floor() - day * ONE_DAY))
}

/// The proleptic Gregorian calendar. Days count from 1 January 1970, months from 0; the year 0 is 1 BC.
pub(crate) mod grego {
    use super::*;

    const DAYS_FROM_1_TO_1970: i32 = EPOCH_START_AS_JULIAN_DAY - JAN_1_1_JULIAN_DAY;

    #[rustfmt::skip]
    const DAYS_BEFORE: [i16; 24] =
        [0,31,59,90,120,151,181,212,243,273,304,334,
         0,31,60,91,121,152,182,213,244,274,305,335];

    #[rustfmt::skip]
    const MONTH_LENGTH: [i8; 24] =
        [31,28,31,30,31,30,31,31,30,31,30,31,
         31,29,31,30,31,30,31,31,30,31,30,31];

    #[derive(Clone, Copy, Default)]
    pub(crate) struct Fields {
        pub(crate) year: i32,
        pub(crate) month: i8,
        pub(crate) dom: i8,
        pub(crate) dow: i8,
        pub(crate) doy: i16,
        /// Milliseconds in the day.
        pub(crate) mid: i32,
    }

    /// Zone data can name any month. Month 12 of a common year has the entry for January of a leap year.
    #[inline]
    fn month_entry<T: Copy + Default>(table: &[T; 24], is_leap: bool, month: i32) -> T {
        table
            .get((month as usize).wrapping_add(if is_leap { 12 } else { 0 }))
            .copied()
            .unwrap_or_default()
    }

    #[inline]
    pub(crate) fn is_leap_year(year: i32) -> bool {
        year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
    }

    #[inline]
    pub(crate) fn days_before_month(is_leap: bool, month: i32) -> i32 {
        month_entry(&DAYS_BEFORE, is_leap, month).into()
    }

    #[inline]
    pub(crate) fn days_in_month(is_leap: bool, month: i32) -> i8 {
        month_entry(&MONTH_LENGTH, is_leap, month)
    }

    #[inline]
    pub(crate) fn month_length(year: i32, month: i32) -> i8 {
        days_in_month(is_leap_year(year), month)
    }

    #[inline]
    pub(crate) fn previous_month_length(year: i32, month: i32) -> i8 {
        month_length(year, (month + 11) % 12)
    }

    /// Returns the month and the day of the month. `day_of_year` counts from 1.
    #[inline]
    pub(crate) fn month_and_day(is_leap: bool, day_of_year: i32) -> (i32, i32) {
        // From March on, the month lengths repeat every five months, which have 153 days.
        let since_march = day_of_year - days_before_month(is_leap, UCAL_MARCH) - 1;
        let month = if since_march < 0 {
            i32::from(day_of_year > 31)
        } else {
            UCAL_MARCH + (5 * since_march + 2) / 153
        };
        (month, day_of_year - days_before_month(is_leap, month))
    }

    /// Returns the Julian day before 1 January of the Julian calendar.
    #[inline]
    pub(crate) fn julian_year_start(year: i32) -> i64 {
        let years = i64::from(year) - 1;
        365 * years + (years >> 2) + i64::from(JAN_1_1_JULIAN_DAY - 3)
    }

    /// Returns the number of days to add to `julian_year_start` for the Gregorian calendar.
    #[inline]
    pub(crate) fn gregorian_shift(year: i32) -> i32 {
        let centuries = (i64::from(year) - 1).div_euclid(100) as i32;
        (centuries >> 2) - centuries + 2
    }

    pub(crate) fn fields_to_day(year: i32, month: i32, dom: i32) -> i64 {
        let before = gregorian_shift(year) + days_before_month(is_leap_year(year), month)
            - EPOCH_START_AS_JULIAN_DAY;
        julian_year_start(year) + i64::from(before) + i64::from(dom)
    }

    /// Converts days since 1 January 1970 to days since 1 January of the year 1.
    fn rebase_to_year_1(day: i32) -> Result<i32, UErrorCode> {
        day.checked_add(DAYS_FROM_1_TO_1970)
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)
    }

    /// Returns the year and the day of the year, which counts from 1.
    fn year_and_day(days_since_year_1: i32) -> (i32, i32) {
        // Neri and Schneider's algorithm: an average century has 146097 quarter days, an average year 1461.
        let quarters = 4 * i64::from(days_since_year_1) + 3;
        let centuries = quarters.div_euclid(146097) as i32;
        let quarters_in_century = quarters.rem_euclid(146097) as u32 | 3;
        let (years, days) = (quarters_in_century / 1461, quarters_in_century % 1461 / 4);
        (100 * centuries + years as i32 + 1, days as i32 + 1)
    }

    fn day_to_fields(days_since_year_1: i32, mid: i32) -> Fields {
        let (year, doy) = year_and_day(days_since_year_1);
        let (month, dom) = month_and_day(is_leap_year(year), doy);
        // Day 0 is a Monday.
        let dow = days_since_year_1.wrapping_add(1).rem_euclid(7) + UCAL_SUNDAY;
        Fields {
            year,
            month: month as i8,
            dom: dom as i8,
            dow: dow as i8,
            doy: doy as i16,
            mid,
        }
    }

    pub(crate) fn julian_day_to_fields(julian_day: i32) -> Result<Fields, UErrorCode> {
        let day = julian_day
            .checked_sub(EPOCH_START_AS_JULIAN_DAY)
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        Ok(day_to_fields(day + DAYS_FROM_1_TO_1970, 0))
    }

    pub(crate) fn day_to_year(day: i32) -> Result<i32, UErrorCode> {
        rebase_to_year_1(day).map(|day| year_and_day(day).0)
    }

    /// Fails if the whole number `day` does not fit an `i32`.
    pub(crate) fn checked_day(day: f64) -> Result<i32, UErrorCode> {
        i32::try_from(day as i64).or(Err(U_ILLEGAL_ARGUMENT_ERROR))
    }

    /// Returns the days since 1 January of the year 1, and the milliseconds in the day.
    #[inline]
    pub(crate) fn time_to_day(time: UDate) -> Result<(i32, i32), UErrorCode> {
        let (day, mid) = day_and_millis(time);
        if mid < 0 {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        Ok((rebase_to_year_1(checked_day(day)?)?, mid))
    }

    pub(crate) fn time_to_fields(time: UDate) -> Result<Fields, UErrorCode> {
        time_to_day(time).map(|(day, mid)| day_to_fields(day, mid))
    }

    pub(crate) fn time_to_year(time: UDate) -> Result<i32, UErrorCode> {
        checked_day((time / ONE_DAY).floor()).and_then(day_to_year)
    }

    pub(crate) fn day_of_week(day: i32) -> i32 {
        match day.wrapping_add(UCAL_THURSDAY).rem_euclid(7) {
            0 => UCAL_SATURDAY,
            day_of_week => day_of_week,
        }
    }

    #[inline]
    pub(crate) fn julian_day_to_millis(julian_day: i32) -> f64 {
        (f64::from(julian_day) - f64::from(EPOCH_START_AS_JULIAN_DAY)) * ONE_DAY
    }
}
