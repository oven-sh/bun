//! Twelve months of 30 days and one of five, or of six before each year that is divisible by four.

use super::JULIAN_DAY_OF_EPOCH;
use crate::calendar::year::{Months, Year};

/// What the number of a year of Amete Mihret is above that of the Coptic year.
pub(super) const ETHIOPIC_YEARS: i32 = 276;

const START_OF_YEAR_ZERO: i32 = 1_824_665 - JULIAN_DAY_OF_EPOCH;

pub(super) fn year(number: i32, year_offset: i32) -> Year {
    let coptic = number + year_offset;
    Year {
        number,
        first_day: START_OF_YEAR_ZERO + 365 * coptic + coptic.div_euclid(4),
        days: 365 + u16::from(coptic.rem_euclid(4) == 3),
        months: Months {
            count: 13,
            leap_month: 0,
            short_month_days: 30,
            long_months: 0,
        },
    }
}

pub(super) fn year_of_day(epoch_day: i32, year_offset: i32) -> i32 {
    let elapsed = i64::from(epoch_day - START_OF_YEAR_ZERO);
    (4 * elapsed + 3).div_euclid(1461) as i32 - year_offset
}
