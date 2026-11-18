//! Months of 30 and 29 days in turn, with eleven leap years in 30.

use super::JULIAN_DAY_OF_EPOCH;
use super::observed::Observations;
use crate::Result;
use crate::calendar::year::{Months, Year};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(in crate::calendar) enum Variant {
    Civil,
    /// Begins a day earlier.
    Tbla,
    /// Published for 301 years, and like `Civil` outside them.
    UmmAlQura,
}

static UMM_AL_QURA: Observations<301> = Observations::new(c"und@calendar=islamic-umalqura", 1300);

impl Variant {
    fn start_of_year_one(self) -> i32 {
        1_948_440 - JULIAN_DAY_OF_EPOCH - i32::from(self == Variant::Tbla)
    }

    pub(super) fn year(self, number: i32) -> Result<Year> {
        let cycle = 11 * number + 3;
        let first_day = self.start_of_year_one() + 354 * (number - 1) + cycle.div_euclid(30);
        if self == Variant::UmmAlQura && UMM_AL_QURA.has_year(number.into()) {
            return UMM_AL_QURA.lunar_year(number, first_day + 100);
        }
        Ok(Year {
            number,
            first_day,
            days: 354 + u16::from(cycle.rem_euclid(30) >= 19),
            months: Months {
                count: 12,
                leap_month: 0,
                short_month_days: 29,
                long_months: 0b101_0101_0101,
            },
        })
    }

    pub(super) fn estimate_year(self, epoch_day: i32) -> i32 {
        let elapsed = i64::from(epoch_day - self.start_of_year_one());
        (30 * elapsed + 10_646).div_euclid(30 * 354 + 11) as i32
    }
}
