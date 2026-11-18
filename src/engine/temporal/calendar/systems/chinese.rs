//! Months from one new moon to the next. A year has the number of the ISO 8601 year that it begins in.

use bun_engine_date::{civil_from_days, days_from_civil};

use super::observed::Observations;
use crate::Result;
use crate::calendar::year::{Year, YearMonth};

/// The astronomical model is not used for years that are further from zero.
const LAST_YEAR: i32 = 10_000;
/// The year that January of the first year belongs to.
const FIRST_YEAR: i32 = -LAST_YEAR - 1;
const YEAR_COUNT: usize = (LAST_YEAR - FIRST_YEAR + 1) as usize;

const SYNODIC_MONTH: f64 = 29.530_588_853;

static CHINA: Observations<YEAR_COUNT> = Observations::new(c"und@calendar=chinese", FIRST_YEAR);
static KOREA: Observations<YEAR_COUNT> = Observations::new(c"und@calendar=dangi", FIRST_YEAR);

#[derive(Clone, Copy)]
pub(in crate::calendar) enum Variant {
    China,
    Korea,
}

impl Variant {
    pub(super) fn year(self, number: i32) -> Result<Year> {
        let observations = match self {
            Variant::China => &CHINA,
            Variant::Korea => &KOREA,
        };
        observations.lunar_year(number, days_from_civil(number, 7, 1) as i32)
    }
}

pub(super) fn is_computed(year: i64) -> bool {
    year.unsigned_abs() <= LAST_YEAR as u64
}

/// Exact, but around the days that a year can begin on.
pub(super) fn estimate_year(epoch_day: i32) -> i32 {
    const BEFORE_EARLIEST_NEW_YEAR: i32 = 14;
    civil_from_days(epoch_day - BEFORE_EARLIEST_NEW_YEAR).year
}

/// From one new moon to another.
pub(super) fn months_in_days(days: i32) -> i64 {
    (f64::from(days) / SYNODIC_MONTH).round() as i64
}

pub(super) fn middle_of_month_after(start: YearMonth, months: i64) -> Option<i32> {
    let epoch_day = i64::from(start.first_day()) + ((months as f64 + 0.5) * SYNODIC_MONTH) as i64;
    (days_from_civil(-LAST_YEAR, 1, 1)..days_from_civil(LAST_YEAR + 1, 1, 1))
        .contains(&epoch_day)
        .then_some(epoch_day as i32)
}
