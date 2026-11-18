//! Seven leap months in 19 years. A year begins with the mean new moon, or up to two days later.

use super::JULIAN_DAY_OF_EPOCH;
use crate::calendar::year::{Months, Year};

/// A Monday.
const START_OF_YEAR_ONE: i32 = 347_998 - JULIAN_DAY_OF_EPOCH;

const PARTS_PER_HOUR: i64 = 1080;
const PARTS_PER_DAY: i64 = 24 * PARTS_PER_HOUR;
const PARTS_PER_MONTH: i64 = 29 * PARTS_PER_DAY + 12 * PARTS_PER_HOUR + 793;
/// Times are counted from noon, because a new moon after noon belongs to the next day.
const FIRST_NEW_MOON: i64 = 11 * PARTS_PER_HOUR + 204;

fn is_leap_year(number: i64) -> bool {
    (7 * number + 1).rem_euclid(19) < 7
}

/// Since the start of year 1.
pub(super) fn months_before(number: i64) -> i64 {
    (235 * number - 234).div_euclid(19)
}

/// The year that a month is in, and how many months of that year come before it.
pub(super) fn split_months(months: i64) -> (i64, i64) {
    let number = (19 * months + 252).div_euclid(235);
    (number, months - months_before(number))
}

fn first_day(number: i64) -> i32 {
    const MONDAY: i64 = 0;
    const TUESDAY: i64 = 1;
    const WEDNESDAY: i64 = 2;
    const FRIDAY: i64 = 4;
    const SUNDAY: i64 = 6;

    let new_moon = months_before(number) * PARTS_PER_MONTH + FIRST_NEW_MOON;
    let (day, time) = (
        new_moon.div_euclid(PARTS_PER_DAY),
        new_moon.rem_euclid(PARTS_PER_DAY),
    );
    let delay = match day.rem_euclid(7) {
        WEDNESDAY | FRIDAY | SUNDAY => 1,
        // The year would have 356 days.
        TUESDAY if time >= 15 * PARTS_PER_HOUR + 204 && !is_leap_year(number) => 2,
        // The year before would have 382 days.
        MONDAY if time >= 21 * PARTS_PER_HOUR + 589 && is_leap_year(number - 1) => 1,
        _ => 0,
    };
    START_OF_YEAR_ONE + (day + delay) as i32
}

pub(super) fn year(number: i32) -> Year {
    const HESHVAN: u16 = 0b010;
    const KISLEV: u16 = 0b100;

    let wide = i64::from(number);
    let (first_day, end) = (first_day(wide), first_day(wide + 1));
    let days = (end - first_day) as u16;
    let (count, leap_month, fixed) = if is_leap_year(wide) {
        (13, 6, 0b1010_1011_0001)
    } else {
        (12, 0, 0b101_0101_0001)
    };
    let variable = match days % 10 {
        3 => 0,
        4 => KISLEV,
        _ => HESHVAN | KISLEV,
    };
    Year {
        number,
        first_day,
        days,
        months: Months {
            count,
            leap_month,
            short_month_days: 29,
            long_months: fixed | variable,
        },
    }
}

pub(super) fn estimate_year(epoch_day: i32) -> i32 {
    let elapsed = i64::from(epoch_day - START_OF_YEAR_ONE);
    split_months((elapsed * PARTS_PER_DAY).div_euclid(PARTS_PER_MONTH)).0 as i32
}
