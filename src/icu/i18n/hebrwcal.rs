//! The Hebrew calendar. Months are numbered 0 to 12; a common year skips number 5, Adar I. ICU4C: hebrwcal.cpp

use crate::common::slice_ext::SliceExt;
use crate::common::utypes::*;
use crate::i18n::calendar::{Calendar, Field, LAST_YEAR};

const HESHVAN: i32 = 1;
const KISLEV: i32 = 2;
const ADAR_1: i32 = 5;
const ELUL: i32 = 12;

const MONTHS_IN_CYCLE: i32 = 235;
const YEARS_IN_CYCLE: i32 = 19;

/// The Julian day before the epoch.
const EPOCH: i32 = 347_997;

// Time is counted in parts, 1080 to the hour.
const HOUR_PARTS: i64 = 1080;
const DAY_PARTS: i64 = 24 * HOUR_PARTS;
const MONTH_PARTS: i64 = 29 * DAY_PARTS + 12 * HOUR_PARTS + 793;
/// The time of the new moon at the epoch, counted from the preceding noon.
const BAHARAD: i64 = 11 * HOUR_PARTS + 204;

/// Returns true for the years 0, 3, 6, 8, 11, 14 and 17 of a cycle.
pub(crate) fn is_leap_year(year: i32) -> bool {
    (i64::from(year) * 12 + 17).rem_euclid(YEARS_IN_CYCLE.into()) >= 12
}

/// Returns the number of days from the epoch to the day before the year.
fn days_before(year: i32) -> i64 {
    let months = (235 * i64::from(year) - 234).div_euclid(19);
    let new_moon = months * MONTH_PARTS + BAHARAD;
    let (day, time) = (
        new_moon.div_euclid(DAY_PARTS),
        new_moon.rem_euclid(DAY_PARTS),
    );
    day + match day.rem_euclid(7) {
        // A year must not start on a Wednesday, Friday or Sunday, or have 356 or 382 days.
        2 | 4 | 6 => 1,
        1 if time >= 15 * HOUR_PARTS + 204 && !is_leap_year(year) => 2,
        0 if time >= 21 * HOUR_PARTS + 589 && is_leap_year(year.wrapping_sub(1)) => 1,
        _ => 0,
    }
}

fn checked_days_before(year: i32) -> Result<i32, UErrorCode> {
    i32::try_from(days_before(year)).or(Err(U_ILLEGAL_ARGUMENT_ERROR))
}

/// Returns the days before `month`, Adar I included. A common year has 353 to 355 days, a leap year 30 more.
fn leap_month_start(year_length: i32, month: i32) -> i32 {
    const IN_384_DAYS: [i32; 14] = [
        0, 30, 59, 89, 118, 148, 178, 207, 237, 266, 296, 325, 355, 384,
    ];
    IN_384_DAYS.at(month as usize) + i32::from(month > HESHVAN && year_length % 10 == 5)
        - i32::from(month > KISLEV && year_length % 10 == 3)
}

/// Returns the number of days in the year before `month`.
fn days_before_month(year: i32, year_length: i32, month: i32) -> i32 {
    leap_month_start(year_length, month)
        - if month > ADAR_1 && !is_leap_year(year) {
            30
        } else {
            0
        }
}

/// The fields must be computed.
pub(crate) fn add_months(cal: &mut Calendar, amount: i32) -> Result<(), UErrorCode> {
    let (mut year, mut month) = (
        cal.internal_get(Field::Year),
        cal.internal_get(Field::Month),
    );
    if amount > 0 {
        let mut is_across_adar_1 = month < ADAR_1;
        year += amount / MONTHS_IN_CYCLE * YEARS_IN_CYCLE;
        month += amount % MONTHS_IN_CYCLE;
        loop {
            month += i32::from(is_across_adar_1 && month >= ADAR_1 && !is_leap_year(year));
            if month <= ELUL {
                break;
            }
            month -= ELUL + 1;
            year += 1;
            is_across_adar_1 = true;
        }
    } else {
        let mut is_across_adar_1 = month > ADAR_1;
        month += amount;
        year += month / MONTHS_IN_CYCLE * YEARS_IN_CYCLE;
        month %= MONTHS_IN_CYCLE;
        loop {
            month -= i32::from(is_across_adar_1 && month <= ADAR_1 && !is_leap_year(year));
            if month >= 0 {
                break;
            }
            month += ELUL + 1;
            year -= 1;
            is_across_adar_1 = true;
        }
    }
    cal.set(Field::Month, month);
    cal.set(Field::Year, year);
    cal.pin_date()
}

pub(crate) fn month_length(year: i32, month: i32) -> Result<i32, UErrorCode> {
    // Only two months depend on the length of the year.
    let year_length = if let HESHVAN | KISLEV = month {
        year_length(year)?
    } else {
        384
    };
    Ok(leap_month_start(year_length, month + 1) - leap_month_start(year_length, month))
}

pub(crate) fn year_length(year: i32) -> Result<i32, UErrorCode> {
    Ok(checked_days_before(year.wrapping_add(1))? - checked_days_before(year)?)
}

pub(crate) fn compute_fields(cal: &mut Calendar, julian_day: i32) {
    let day = i64::from(julian_day - EPOCH);
    let months = (day * DAY_PARTS).div_euclid(MONTH_PARTS);
    // The year of the last new moon. Its first day may be some days later.
    let mut year = (19 * months + 252).div_euclid(235) as i32;
    let mut start = days_before(year);
    if day <= start {
        year -= 1;
        start = days_before(year);
    }
    let (day_of_year, year_length) = ((day - start) as i32, (days_before(year + 1) - start) as i32);
    let mut month = 0;
    while day_of_year > days_before_month(year, year_length, month + 1) {
        month += 1;
    }
    let day_of_month = day_of_year - days_before_month(year, year_length, month);
    let pinned = year.clamp(-LAST_YEAR, LAST_YEAR);
    cal.set_date_fields(pinned, month, day_of_month, day_of_year);
}

/// Returns the Julian day before the first day of the month.
pub(crate) fn month_start(year: i32, month: i32) -> Result<i64, UErrorCode> {
    let start = checked_days_before(year)?;
    let before = match month {
        0 => 0,
        _ => days_before_month(year, checked_days_before(year + 1)? - start, month),
    };
    Ok(i64::from(start) + i64::from(before + EPOCH))
}
