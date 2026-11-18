//! Eight leap years in 33, except where ICU knows that the equinox departs from that.

use super::JULIAN_DAY_OF_EPOCH;
use super::observed::Observations;
use crate::calendar::year::{Months, Year};
use crate::{Error, Result};

const START_OF_YEAR_ONE: i32 = 1_948_320 - JULIAN_DAY_OF_EPOCH;

static CORRECTED: Observations<1500> = Observations::new(c"und@calendar=persian", 1500);

fn first_day(number: i32) -> Result<i32> {
    let by_cycle = START_OF_YEAR_ONE + 365 * (number - 1) + (8 * number + 21).div_euclid(33);
    if !CORRECTED.has_year(number.into()) {
        return Ok(by_cycle);
    }
    CORRECTED.first_day(number, by_cycle + 100)
}

pub(super) fn year(number: i32) -> Result<Year> {
    let (first_day, end) = (first_day(number)?, first_day(number + 1)?);
    let days @ 365..=366 = end - first_day else {
        return Err(Error::CalendarDataUnavailable);
    };
    Ok(Year {
        number,
        first_day,
        days: days as u16,
        months: Months {
            count: 12,
            leap_month: 0,
            short_month_days: 30,
            long_months: 0b11_1111,
        },
    })
}

pub(super) fn estimate_year(epoch_day: i32) -> i32 {
    let elapsed = i64::from(epoch_day - START_OF_YEAR_ONE);
    (33 * elapsed + 3).div_euclid(33 * 365 + 8) as i32 + 1
}
