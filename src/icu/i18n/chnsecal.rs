//! The Chinese and Dangi calendars. Days count from 1 January 1970 in the astronomer's zone. ICU4C: chnsecal.cpp

use crate::common::utypes::*;
use crate::i18n::astro::{self, CalendarCache};
use crate::i18n::calendar::{
    Calendar, CalendarType, Field, LAST_YEAR, checked_add32, checked_f64_to_i32,
};
use crate::i18n::gregoimp::*;
use crate::i18n::unicode::ucal::*;
use std::cell::Cell;
use std::f64::consts::PI;

/// The Gregorian year in which the first cycle of 60 years begins.
const CYCLE_EPOCH: i32 = -2636;

const CHINA_OFFSET: i32 = 8 * U_MILLIS_PER_HOUR;

/// Number of days from a new moon to a day close to the next or the previous new moon.
const SYNODIC_GAP: i32 = 25;

/// New moons near midnight: the computed day and the day in the almanacs.
#[rustfmt::skip]
const NEW_MOONS: [(i32, i32); 8] = [
    (-5810, -5811), // 1954-02-03
    (-5426, -5427), // 1955-02-22
    (10609, 10608), // 1999-01-17
    (15570, 15569), // 2012-08-17
    (17842, 17843), // 2018-11-08
    (20856, 20855), // 2027-02-06
    (21947, 21948), // 2030-02-03
    (36596, 36595), // 2070-03-12
];

/// First days of months on which a major solar term begins just after midnight.
#[rustfmt::skip]
const EARLY_TERMS: [i32; 3] = [
    -19248, // 1917-04-21
    -17328, // 1922-07-24
    6444, // 1987-08-24
];

struct Caches {
    winter_solstices: CalendarCache,
    new_years: CalendarCache,
}

impl Caches {
    const fn new() -> Self {
        Self {
            winter_solstices: CalendarCache::new(),
            new_years: CalendarCache::new(),
        }
    }
}

// Apart from the settings, so that they consist of zeros and take no space in the executable.
static CHINESE_CACHES: Caches = Caches::new();
static DANGI_CACHES: Caches = Caches::new();

struct Setting {
    /// Returns the GMT offset of the astronomer's zone, or `None` if the zone rejects the time.
    zone_offset: fn(UDate) -> Option<i32>,
    caches: &'static Caches,
    new_moons: &'static [(i32, i32)],
    early_terms: &'static [i32],
}

static CHINESE: Setting = Setting {
    zone_offset: offset_in_china,
    caches: &CHINESE_CACHES,
    new_moons: &NEW_MOONS,
    early_terms: &EARLY_TERMS,
};

static DANGI: Setting = Setting {
    zone_offset: offset_in_korea,
    caches: &DANGI_CACHES,
    new_moons: &[],
    early_terms: &[],
};

fn offset_in_china(millis: UDate) -> Option<i32> {
    grego::time_to_day(millis + f64::from(CHINA_OFFSET))
        .is_ok()
        .then_some(CHINA_OFFSET)
}

/// GMT+8 until 1911 except GMT+7 in 1897, GMT+9 from 1912, in years of 365 days from 1970.
fn offset_in_korea(millis: UDate) -> Option<i32> {
    let start_of = |year: i32, hours_before: i32| {
        f64::from((year - EPOCH_YEAR) * 365) * ONE_DAY - f64::from(hours_before * U_MILLIS_PER_HOUR)
    };
    let hours = if millis >= start_of(1912, 8) {
        9
    } else if (start_of(1897, 8)..start_of(1898, 7)).contains(&millis) {
        7
    } else {
        8
    };
    Some(hours * U_MILLIS_PER_HOUR)
}

struct MonthInfo {
    /// 1-based.
    month: i32,
    ordinal_month: i32,
    this_moon: i32,
    is_leap_month: bool,
}

/// Astronomical computations for one query.
struct Astronomer {
    setting: &'static Setting,
    /// Once set, nothing is searched for or cached, numbers are meaningless, and every `Result` is an error.
    has_failed: Cell<bool>,
}

impl Astronomer {
    fn of(cal: &Calendar) -> Astronomer {
        let setting = if cal.calendar_type() == CalendarType::Dangi {
            &DANGI
        } else {
            &CHINESE
        };
        Astronomer {
            setting,
            has_failed: Cell::new(false),
        }
    }

    /// Returns `number`, or records a failure and returns 0.
    fn unwrap_or_fail(&self, number: Option<i32>) -> i32 {
        number.unwrap_or_else(|| {
            self.has_failed.set(true);
            i32::default()
        })
    }

    fn ok_unless_failed<T>(&self, answer: T) -> Result<T, UErrorCode> {
        if self.has_failed.get() {
            Err(U_ILLEGAL_ARGUMENT_ERROR)
        } else {
            Ok(answer)
        }
    }

    fn cached(&self, cache: &CalendarCache, gyear: i32, find: fn(&Astronomer, i32) -> i32) -> i32 {
        cache.get(gyear).unwrap_or_else(|| {
            let day = find(self, gyear);
            if !self.has_failed.get() {
                cache.put(gyear, day);
            }
            day
        })
    }

    fn zone_offset(&self, millis: UDate) -> f64 {
        self.unwrap_or_fail((self.setting.zone_offset)(millis))
            .into()
    }

    /// Returns the time at the start of a day. The offset is looked up with the wall time taken as UTC.
    fn days_to_millis(&self, days: f64) -> UDate {
        let millis = days * ONE_DAY;
        millis - self.zone_offset(millis)
    }

    /// Calls `find` with the start of the day `from` and returns the day of its result, or 0 after a failure.
    fn search(&self, from: f64, find: impl FnOnce(UDate) -> UDate) -> f64 {
        let from = self.days_to_millis(from);
        if self.has_failed.get() {
            return 0.0;
        }
        let found = find(from);
        let local = found + self.zone_offset(found);
        if self.has_failed.get() {
            0.0
        } else {
            (local / ONE_DAY).floor()
        }
    }

    fn winter_solstice(&self, gyear: i32) -> i32 {
        self.cached(
            &self.setting.caches.winter_solstices,
            gyear,
            |astronomer, gyear| {
                let day = astronomer.search(
                    grego::fields_to_day(gyear, UCAL_DECEMBER, 1) as f64,
                    astro::next_winter_solstice,
                );
                astronomer.unwrap_or_fail(grego::checked_day(day).ok())
            },
        )
    }

    /// Returns the day of the first new moon on or after a day, or of the last one before it.
    fn new_moon_near(&self, mut days: i32, after: bool) -> i32 {
        let moons = self.setting.new_moons;
        // At the midnight between the two days, start from the other side of the computed new moon.
        if let Some(&(wrong, right)) = moons
            .iter()
            .find(|&&(wrong, right)| days == wrong.max(right))
        {
            days += wrong - right;
        }
        let found =
            double_to_int32(self.search(days.into(), |from| astro::new_moon_time(from, after)));
        moons
            .iter()
            .find(|&&(wrong, _)| found == wrong)
            .map_or(found, |&(_, right)| right)
    }

    fn next_new_moon(&self, new_moon: i32) -> i32 {
        self.new_moon_near(new_moon.wrapping_add(SYNODIC_GAP), true)
    }

    fn previous_new_moon(&self, new_moon: i32) -> i32 {
        self.new_moon_near(new_moon.wrapping_sub(SYNODIC_GAP), false)
    }

    /// Returns the number, modulo 12, of the 30 degrees of longitude in which the sun is at the start of a day.
    fn major_solar_term(&self, days: i32) -> Result<i32, UErrorCode> {
        let days =
            self.ok_unless_failed(days)? - i32::from(self.setting.early_terms.contains(&days));
        let twelfths = 6.0 * astro::sun_longitude(self.days_to_millis(days.into())) / PI;
        // The sum matters where the conversion saturates.
        Ok(double_to_int32(twelfths).wrapping_add(2).rem_euclid(12))
    }

    fn has_no_major_solar_term(&self, new_moon: i32) -> bool {
        self.major_solar_term(new_moon) == self.major_solar_term(self.next_new_moon(new_moon))
    }

    /// Returns true if one of the months from `new_moon1` to `new_moon2`, both included, has no major solar term.
    fn is_leap_month_between(&self, new_moon1: i32, mut new_moon2: i32) -> bool {
        // After a failure no month has a term, so the loop ends.
        while new_moon2 >= new_moon1 {
            if self.has_no_major_solar_term(new_moon2) {
                return true;
            }
            new_moon2 = self.previous_new_moon(new_moon2);
        }
        false
    }

    /// Returns the day of the new year in a Gregorian year.
    fn new_year(&self, gyear: i32) -> i32 {
        self.cached(
            &self.setting.caches.new_years,
            gyear,
            |astronomer, gyear| {
                let solstice_before =
                    astronomer.winter_solstice(astronomer.unwrap_or_fail(gyear.checked_sub(1)));
                let solstice_after = astronomer.winter_solstice(gyear);
                let new_moon1 = astronomer.new_moon_near(solstice_before.wrapping_add(1), true);
                let new_moon2 = astronomer.next_new_moon(new_moon1);
                let new_moon11 = astronomer.new_moon_near(solstice_after.wrapping_add(1), false);
                let has_leap_11_or_12 = synodic_months_between(new_moon1, new_moon11) == 12
                    && (astronomer.has_no_major_solar_term(new_moon1)
                        || astronomer.has_no_major_solar_term(new_moon2));
                if has_leap_11_or_12 {
                    astronomer.next_new_moon(new_moon2)
                } else {
                    new_moon2
                }
            },
        )
    }

    fn last_new_year(&self, gyear: i32, days: i32) -> i32 {
        let new_year = self.new_year(gyear);
        if days < new_year {
            self.new_year(gyear - 1)
        } else {
            new_year
        }
    }

    /// `gyear` is the Gregorian year of `days`.
    fn month_info(&self, gyear: i32, days: i32) -> Result<MonthInfo, UErrorCode> {
        // Month 11 contains the winter solstice.
        let solstice = self.winter_solstice(gyear);
        let (solstice_before, solstice_after) = if days < solstice {
            (self.winter_solstice(gyear - 1), solstice)
        } else {
            (solstice, self.winter_solstice(gyear + 1))
        };
        if !(solstice_before..solstice_after).contains(&days) {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }

        // The month after month 11, and the next month 11.
        let first_moon = self.new_moon_near(solstice_before + 1, true);
        let last_moon = self.new_moon_near(solstice_after.wrapping_add(1), false);
        let this_moon = self.new_moon_near(days + 1, false);
        let has_leap_month = synodic_months_between(first_moon, last_moon) == 12;

        let new_year = self.last_new_year(gyear, days);
        let mut month = synodic_months_between(first_moon, this_moon);
        if has_leap_month && self.is_leap_month_between(first_moon, this_moon) {
            month -= 1;
        }
        if month < 1 {
            month += 12;
        }
        let mut ordinal_month = synodic_months_between(new_year, this_moon);
        if ordinal_month < 0 {
            ordinal_month += 12;
        }
        let is_leap_month = has_leap_month
            && self.has_no_major_solar_term(this_moon)
            && !self.is_leap_month_between(first_moon, self.previous_new_moon(this_moon));
        self.ok_unless_failed(MonthInfo {
            month,
            ordinal_month,
            this_moon,
            is_leap_month,
        })
    }

    /// `month` can be past the end of the year.
    fn month_start(&self, eyear: i32, month: i32, is_leap_month: bool) -> Result<i32, UErrorCode> {
        let new_year = self.new_year(checked_add32(eyear, month.div_euclid(12))?);
        let month = month.rem_euclid(12);
        let mut new_moon = self.new_moon_near(new_year.wrapping_add(month * 29), true);
        let info = self.month_info(grego::day_to_year(new_moon)?, new_moon)?;
        if month != info.month - 1 || is_leap_month != info.is_leap_month {
            new_moon = self.next_new_moon(new_moon);
        }
        self.ok_unless_failed(checked_add32(
            new_moon.wrapping_sub(1),
            EPOCH_START_AS_JULIAN_DAY,
        )?)
    }
}

/// Rounds to the nearest integer.
fn synodic_months_between(day1: i32, day2: i32) -> i32 {
    let months = f64::from(day2.wrapping_sub(day1)) / astro::SYNODIC_MONTH;
    (months + 0.5_f64.copysign(months)) as i32
}

/// Returns the Julian day before the first day of the month.
pub(crate) fn month_start(
    cal: &Calendar,
    eyear: i32,
    month: i32,
    is_leap_month: bool,
) -> Result<i32, UErrorCode> {
    Astronomer::of(cal).month_start(eyear, month, is_leap_month)
}

pub(crate) fn month_length(cal: &Calendar, eyear: i32, month: i32) -> Result<i32, UErrorCode> {
    let astronomer = Astronomer::of(cal);
    let is_leap_month = cal.internal_get(Field::IsLeapMonth) == 1;
    let start =
        astronomer.month_start(eyear, month, is_leap_month)? - EPOCH_START_AS_JULIAN_DAY + 1;
    astronomer.ok_unless_failed(astronomer.next_new_moon(start).wrapping_sub(start))
}

pub(crate) fn year_length(cal: &Calendar, eyear: i32) -> Result<i32, UErrorCode> {
    let next = month_start(cal, eyear.wrapping_add(1), 0, false)?;
    Ok(next.wrapping_sub(month_start(cal, eyear, 0, false)?))
}

/// Moves by `delta` months and pins the day. The fields must be computed.
pub(crate) fn add_months(cal: &mut Calendar, delta: i32) -> Result<(), UErrorCode> {
    let astronomer = Astronomer::of(cal);
    let day_of_month = cal.internal_get(Field::Date);
    let day = cal.internal_get(Field::JulianDay) - EPOCH_START_AS_JULIAN_DAY;
    let this_moon = day.wrapping_sub(day_of_month).wrapping_add(1);
    let middle_before =
        checked_f64_to_i32(f64::from(this_moon) + astro::SYNODIC_MONTH * (f64::from(delta) - 0.5))?;
    let new_moon = astronomer.ok_unless_failed(astronomer.new_moon_near(middle_before, true))?;
    let jd = checked_add32(
        checked_add32(new_moon, EPOCH_START_AS_JULIAN_DAY - 1)?,
        day_of_month,
    )?;

    if day_of_month > 29 {
        cal.set(Field::JulianDay, jd - 1);
        cal.complete()?;
        if cal.days_in_month()? < day_of_month {
            return Ok(());
        }
    }
    cal.set(Field::JulianDay, jd);
    Ok(())
}

pub(crate) fn compute_fields(cal: &mut Calendar, julian_day: i32) -> Result<(), UErrorCode> {
    let days = julian_day - EPOCH_START_AS_JULIAN_DAY;
    let grego::Fields {
        year: gyear,
        month: gmonth,
        ..
    } = cal.gregorian_date();
    let astronomer = Astronomer::of(cal);
    let info = astronomer.month_info(gyear, days)?;
    let new_year = astronomer.last_new_year(gyear, days);

    let year = if info.month < 11 || i32::from(gmonth) >= UCAL_JULY {
        gyear
    } else {
        gyear - 1
    };
    cal.set_date_fields(
        year.clamp(-LAST_YEAR, LAST_YEAR),
        info.month - 1,
        days.wrapping_sub(info.this_moon).wrapping_add(1),
        days.wrapping_sub(new_year).wrapping_add(1),
    );
    cal.internal_set(Field::Era, (year - CYCLE_EPOCH).div_euclid(60) + 1);
    cal.internal_set(Field::Year, (year - CYCLE_EPOCH).rem_euclid(60) + 1);
    cal.internal_set(Field::OrdinalMonth, info.ordinal_month);
    cal.internal_set(Field::IsLeapMonth, i32::from(info.is_leap_month));
    Ok(())
}
