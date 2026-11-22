//! The Persian calendar. ICU4C: persncal.cpp

use crate::common::utypes::*;
use crate::i18n::calendar::{Calendar, checked_add32};

/// Leap years by the 33-year rule for which the astronomical leap year is the following year.
#[rustfmt::skip]
const NON_LEAP_YEARS: [i16; 78] = [
   1502, 1601, 1634, 1667, 1700, 1733, 1766, 1799, 1832, 1865, 1898, 1931, 1964, 1997, 2030, 2059,
   2063, 2096, 2129, 2158, 2162, 2191, 2195, 2224, 2228, 2257, 2261, 2290, 2294, 2323, 2327, 2356,
   2360, 2389, 2393, 2422, 2426, 2455, 2459, 2488, 2492, 2521, 2525, 2554, 2558, 2587, 2591, 2620,
   2624, 2653, 2657, 2686, 2690, 2719, 2723, 2748, 2752, 2756, 2781, 2785, 2789, 2818, 2822, 2847,
   2851, 2855, 2880, 2884, 2888, 2913, 2917, 2921, 2946, 2950, 2954, 2979, 2983, 2987,
];

const PERSIAN_EPOCH: i64 = 1948320;
const LAST_MONTH: i32 = 11;

fn is_corrected(year: i64) -> bool {
    // Present-day years skip the search.
    let [first, ..] = NON_LEAP_YEARS;
    i16::try_from(year)
        .is_ok_and(|year| year >= first && NON_LEAP_YEARS.binary_search(&year).is_ok())
}

fn is_leap_year(year: i32) -> bool {
    let year = i64::from(year);
    !is_corrected(year) && (is_corrected(year - 1) || (year * 25 + 11).rem_euclid(33) < 8)
}

/// Six months have 31 days, the next five 30.
fn days_before_month(month: i32) -> i32 {
    30 * month + month.min(6)
}

fn days_before_year(year: i32) -> i64 {
    // The numerator has 32 bits.
    let leap_days = year.wrapping_mul(8).wrapping_add(21).div_euclid(33);
    let before = i64::from(year) - 1;
    365 * before + i64::from(leap_days) - i64::from(is_corrected(before))
}

pub(crate) fn month_length(extended_year: i32, month: i32) -> i32 {
    match month {
        0..6 => 31,
        LAST_MONTH => 29 + i32::from(is_leap_year(extended_year)),
        _ => 30,
    }
}

pub(crate) fn year_length(extended_year: i32) -> i32 {
    365 + i32::from(is_leap_year(extended_year))
}

/// Returns the Julian day before the first day of the month.
pub(crate) fn month_start(eyear: i32, month: i32) -> Result<i64, UErrorCode> {
    let year = checked_add32(eyear, month.div_euclid(12))?;
    Ok(PERSIAN_EPOCH - 1
        + days_before_year(year)
        + i64::from(days_before_month(month.rem_euclid(12))))
}

pub(crate) fn compute_fields(cal: &mut Calendar, julian_day: i32) {
    let days = i64::from(julian_day) - PERSIAN_EPOCH;
    let mut year = (33 * days + 3).div_euclid(12053) as i32 + 1;
    let mut day_of_year = (days - days_before_year(year)) as i32; // from 0
    if day_of_year == 365 && is_corrected(year.into()) {
        year += 1;
        day_of_year = 0;
    }
    let month = (day_of_year / 31).max((day_of_year - 6) / 30);
    let day_of_month = day_of_year - days_before_month(month) + 1;
    cal.set_date_fields(year, month, day_of_month, day_of_year + 1);
}
