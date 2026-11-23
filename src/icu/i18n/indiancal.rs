//! The Indian national calendar. ICU4C: indiancal.cpp

use crate::common::utypes::*;
use crate::i18n::calendar::{Calendar, checked_add32};
use crate::i18n::gregoimp::*;
use crate::i18n::unicode::ucal::{UCAL_JANUARY, UCAL_MARCH};

const INDIAN_ERA_START: i32 = 78;
const INDIAN_YEAR_START: i32 = 80;

pub(crate) fn month_length(eyear: i32, month: i32) -> i32 {
    match month {
        0 => first_month_length(eyear.wrapping_add(INDIAN_ERA_START)),
        ..=5 => 31,
        _ => 30,
    }
}

fn first_month_length(gregorian_year: i32) -> i32 {
    if grego::is_leap_year(gregorian_year) {
        31
    } else {
        30
    }
}

/// Returns the number of days in `months` months after the first month: five have 31 days, the next six 30.
fn days_after_first_month(months: i32) -> i32 {
    30 * months + months.min(5)
}

pub(crate) fn year_length(eyear: i32) -> i32 {
    335 + first_month_length(eyear.wrapping_add(INDIAN_ERA_START))
}

fn gregorian_to_julian_day(year: i32, month: i32, date: i32) -> i64 {
    grego::fields_to_day(year, month, date) + i64::from(EPOCH_START_AS_JULIAN_DAY)
}

/// Returns the Julian day before the first day of the month.
pub(crate) fn month_start(eyear: i32, month: i32) -> Result<i64, UErrorCode> {
    let gyear = checked_add32(eyear, month.div_euclid(12))?.wrapping_add(INDIAN_ERA_START);
    let month = month.rem_euclid(12);
    let first_length = first_month_length(gyear);
    let days_before = if month == 0 {
        0
    } else {
        first_length + days_after_first_month(month - 1)
    };
    // 21 March in a leap year, else 22 March.
    let first_day =
        gregorian_to_julian_day(gyear, UCAL_MARCH, 52 - first_length) + i64::from(days_before);
    // `first_day - 0.5`, truncated toward zero.
    Ok((2 * first_day - 1) / 2)
}

pub(crate) fn compute_fields(cal: &mut Calendar, julian_day: i32) {
    let mut gyear = cal.gregorian_date().year;
    let mut yday = (i64::from(julian_day) - gregorian_to_julian_day(gyear, UCAL_JANUARY, 1)) as i32;
    if yday < INDIAN_YEAR_START {
        gyear -= 1;
        yday += first_month_length(gyear) + (31 * 5) + (30 * 3) + 10;
    } else {
        yday -= INDIAN_YEAR_START;
    }

    let mday = yday - first_month_length(gyear);
    let (month, day_of_month) = if mday < 0 {
        (0, yday + 1)
    } else {
        let months = (mday / 31).max((mday - 5) / 30);
        (months + 1, mday - days_after_first_month(months) + 1)
    };
    cal.set_date_fields(gyear - INDIAN_ERA_START, month, day_of_month, yday + 1);
}
