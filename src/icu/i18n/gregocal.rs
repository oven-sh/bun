//! The Gregorian calendar and those that only count its years differently. ICU4C: gregocal.cpp, japancal.cpp

use crate::common::umutex::OnceBox;
use crate::common::utypes::*;
use crate::i18n::calendar::{Calendar, Field};
use crate::i18n::erarules::EraRules;
use crate::i18n::gregoimp::*;
use bun_core::{getenv_z, zstr};

const BC: i32 = 0;
const AD: i32 = 1;

/// The change from the Julian to the Gregorian rules.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Cutover {
    julian_day: i32,
    year: i32,
}

impl Cutover {
    /// 15 October 1582.
    pub(crate) const PAPAL: Cutover = Cutover {
        julian_day: 2299161,
        year: 1582,
    };

    pub(crate) fn new(date: UDate, year: i32) -> Cutover {
        let day = (date / ONE_DAY).floor() as i32;
        Cutover {
            julian_day: day.saturating_add(EPOCH_START_AS_JULIAN_DAY),
            year,
        }
    }

    pub(crate) fn is_leap_year(self, year: i32) -> bool {
        if year >= self.year {
            grego::is_leap_year(year)
        } else {
            year % 4 == 0
        }
    }

    pub(crate) fn julian_day_of(
        self,
        year: i32,
        month: i32,
        day: i32,
        is_day_of_year: bool,
    ) -> i64 {
        let by_rules = |is_gregorian| {
            let (shift, is_leap) = if is_gregorian {
                (grego::gregorian_shift(year), grego::is_leap_year(year))
            } else {
                (0, year % 4 == 0)
            };
            let before = shift + grego::days_before_month(is_leap, month);
            grego::julian_year_start(year) + i64::from(before) + i64::from(day)
        };
        let is_gregorian = year >= self.year;
        let julian_day = by_rules(is_gregorian);
        if is_gregorian != (julian_day >= i64::from(self.julian_day)) {
            by_rules(!is_gregorian)
        } else if is_day_of_year && year == self.year {
            // The days of this year count from the Julian 1 January.
            julian_day - i64::from(grego::gregorian_shift(year))
        } else {
            julian_day
        }
    }
}

pub(crate) fn compute_fields(cal: &mut Calendar, julian_day: i32) {
    let (eyear, month, day_of_month, mut day_of_year);
    if julian_day >= cal.cutover.julian_day {
        let date = cal.gregorian_date();
        (month, day_of_month) = (date.month.into(), date.dom.into());
        (eyear, day_of_year) = (date.year, date.doy.into());
        if eyear == cal.cutover.year {
            day_of_year += grego::gregorian_shift(eyear);
        }
    } else {
        // Day 0 of the proleptic Julian calendar is 30 December 0 (Gregorian).
        eyear =
            (4 * i64::from(julian_day - (JAN_1_1_JULIAN_DAY - 2)) + 1464).div_euclid(1461) as i32;
        day_of_year = (i64::from(julian_day) - grego::julian_year_start(eyear)) as i32;
        (month, day_of_month) = grego::month_and_day(eyear % 4 == 0, day_of_year);
    }
    cal.set_date_fields(eyear, month, day_of_month, day_of_year);
    set_era_and_year(cal, eyear);
}

/// The two eras of the ROC calendar have the numbers of BC and AD.
fn set_era_and_year(cal: &mut Calendar, year: i32) {
    let (era, year) = if year < 1 { (BC, 1 - year) } else { (AD, year) };
    cal.internal_set(Field::Era, era);
    cal.internal_set(Field::Year, year);
}

pub(crate) fn compute_buddhist_fields(cal: &mut Calendar, julian_day: i32) {
    compute_fields(cal, julian_day);
    cal.internal_set(Field::Era, 0);
    cal.internal_set(Field::Year, cal.internal_get(Field::ExtendedYear) + 543);
}

pub(crate) fn compute_roc_fields(cal: &mut Calendar, julian_day: i32) {
    compute_fields(cal, julian_day);
    set_era_and_year(cal, cal.internal_get(Field::ExtendedYear) - 1911);
}

pub(crate) fn japanese_eras() -> Result<&'static EraRules, UErrorCode> {
    static RULES: OnceBox<Result<EraRules, UErrorCode>> = OnceBox::new();
    RULES.get_or_init_caching_err(|| {
        let setting = getenv_z(zstr!("ICU_ENABLE_TENTATIVE_ERA")).unwrap_or_default();
        EraRules::load(b"japanese", setting.eq_ignore_ascii_case(b"true"))
    })
}

pub(crate) fn compute_japanese_fields(
    cal: &mut Calendar,
    julian_day: i32,
) -> Result<(), UErrorCode> {
    compute_fields(cal, julian_day);
    let eyear = cal.internal_get(Field::ExtendedYear);
    let (month, day) = (
        cal.internal_get(Field::Month) + 1,
        cal.internal_get(Field::Date),
    );
    let eras = japanese_eras()?;
    let era = eras.get_era_code(eyear, month, day);
    let year = match era {
        BC => 1 - eyear,
        AD => eyear,
        _ => eyear - eras.get_start_year(era)? + 1,
    };
    cal.internal_set(Field::Era, era);
    cal.internal_set(Field::Year, year);
    Ok(())
}
