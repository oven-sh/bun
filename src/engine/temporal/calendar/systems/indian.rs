//! The Gregorian year from its 81st day, with the leap day in the first month.

use bun_engine_date::{civil_from_days, days_from_civil, days_in_year, is_leap_year};

use crate::calendar::year::{Months, Year};

const YEAR_OFFSET: i32 = 78;
const DAY_OFFSET: i32 = 80;

pub(super) fn year(number: i32) -> Year {
    let gregorian = number + YEAR_OFFSET;
    Year {
        number,
        first_day: days_from_civil(gregorian, 1, 1) as i32 + DAY_OFFSET,
        days: days_in_year(gregorian),
        months: Months {
            count: 12,
            leap_month: 0,
            short_month_days: 30,
            long_months: 0b11_1110 | u16::from(is_leap_year(gregorian)),
        },
    }
}

pub(super) fn year_of_day(epoch_day: i32) -> i32 {
    civil_from_days(epoch_day - DAY_OFFSET).year - YEAR_OFFSET
}
