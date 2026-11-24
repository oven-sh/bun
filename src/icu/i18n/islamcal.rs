//! The Islamic calendars: astronomical, civil and Umm al-Qura. Days count from the epoch. ICU4C: islamcal.cpp

use crate::common::utypes::*;
use crate::i18n::astro::{self, CalendarCache};
use crate::i18n::calendar::{Calendar, CalendarType, checked_add32};
use crate::i18n::gregoimp::*;
use std::f64::consts::PI;

const HIJRA_MILLIS: UDate = -42521587200000.0; // 16 July 622 (Julian)

static MONTH_CACHE: CalendarCache = CalendarCache::new();

const CIVIL_EPOCH: i32 = 1948440; // Friday, 16 July 622 (Julian)
const ASTRONOMICAL_EPOCH: i32 = 1948439; // the day before

const UMALQURA_YEAR_START: i32 = 1300;

/// A bit for each month of 30 days; bit 11 is the first month.
#[rustfmt::skip]
const UMALQURA_MONTHLENGTH: [u16; 301] = [
    0x0AAA, 0x0D54, 0x0EC9, 0x06D4, 0x06EA, 0x036C, 0x0AAD, 0x0555, 0x06A9, 0x0792, // 1300..
    0x0BA9, 0x05D4, 0x0ADA, 0x055C, 0x0D2D, 0x0695, 0x074A, 0x0B54, 0x0B6A, 0x05AD, // 1310..
    0x04AE, 0x0A4F, 0x0517, 0x068B, 0x06A5, 0x0AD5, 0x02D6, 0x095B, 0x049D, 0x0A4D, // 1320..
    0x0D26, 0x0D95, 0x05AC, 0x09B6, 0x02BA, 0x0A5B, 0x052B, 0x0A95, 0x06CA, 0x0AE9, // 1330..
    0x02F4, 0x0976, 0x02B6, 0x0956, 0x0ACA, 0x0BA4, 0x0BD2, 0x05D9, 0x02DC, 0x096D, // 1340..
    0x054D, 0x0AA5, 0x0B52, 0x0BA5, 0x05B4, 0x09B6, 0x0557, 0x0297, 0x054B, 0x06A3, // 1350..
    0x0752, 0x0B65, 0x056A, 0x0AAB, 0x052B, 0x0C95, 0x0D4A, 0x0DA5, 0x05CA, 0x0AD6, // 1360..
    0x0957, 0x04AB, 0x094B, 0x0AA5, 0x0B52, 0x0B6A, 0x0575, 0x0276, 0x08B7, 0x045B, // 1370..
    0x0555, 0x05A9, 0x05B4, 0x09DA, 0x04DD, 0x026E, 0x0936, 0x0AAA, 0x0D54, 0x0DB2, // 1380..
    0x05D5, 0x02DA, 0x095B, 0x04AB, 0x0A55, 0x0B49, 0x0B64, 0x0B71, 0x05B4, 0x0AB5, // 1390..
    0x0A55, 0x0D25, 0x0E92, 0x0EC9, 0x06D4, 0x0AE9, 0x096B, 0x04AB, 0x0A93, 0x0D49, // 1400..
    0x0DA4, 0x0DB2, 0x0AB9, 0x04BA, 0x0A5B, 0x052B, 0x0A95, 0x0B2A, 0x0B55, 0x055C, // 1410..
    0x04BD, 0x023D, 0x091D, 0x0A95, 0x0B4A, 0x0B5A, 0x056D, 0x02B6, 0x093B, 0x049B, // 1420..
    0x0655, 0x06A9, 0x0754, 0x0B6A, 0x056C, 0x0AAD, 0x0555, 0x0B29, 0x0B92, 0x0BA9, // 1430..
    0x05D4, 0x0ADA, 0x055A, 0x0AAB, 0x0595, 0x0749, 0x0764, 0x0BAA, 0x05B5, 0x02B6, // 1440..
    0x0A56, 0x0E4D, 0x0B25, 0x0B52, 0x0B6A, 0x05AD, 0x02AE, 0x092F, 0x0497, 0x064B, // 1450..
    0x06A5, 0x06AC, 0x0AD6, 0x055D, 0x049D, 0x0A4D, 0x0D16, 0x0D95, 0x05AA, 0x05B5, // 1460..
    0x02DA, 0x095B, 0x04AD, 0x0595, 0x06CA, 0x06E4, 0x0AEA, 0x04F5, 0x02B6, 0x0956, // 1470..
    0x0AAA, 0x0B54, 0x0BD2, 0x05D9, 0x02EA, 0x096D, 0x04AD, 0x0A95, 0x0B4A, 0x0BA5, // 1480..
    0x05B2, 0x09B5, 0x04D6, 0x0A97, 0x0547, 0x0693, 0x0749, 0x0B55, 0x056A, 0x0A6B, // 1490..
    0x052B, 0x0A8B, 0x0D46, 0x0DA3, 0x05CA, 0x0AD6, 0x04DB, 0x026B, 0x094B, 0x0AA5, // 1500..
    0x0B52, 0x0B69, 0x0575, 0x0176, 0x08B7, 0x025B, 0x052B, 0x0565, 0x05B4, 0x09DA, // 1510..
    0x04ED, 0x016D, 0x08B6, 0x0AA6, 0x0D52, 0x0DA9, 0x05D4, 0x0ADA, 0x095B, 0x04AB, // 1520..
    0x0653, 0x0729, 0x0762, 0x0BA9, 0x05B2, 0x0AB5, 0x0555, 0x0B25, 0x0D92, 0x0EC9, // 1530..
    0x06D2, 0x0AE9, 0x056B, 0x04AB, 0x0A55, 0x0D29, 0x0D54, 0x0DAA, 0x09B5, 0x04BA, // 1540..
    0x0A3B, 0x049B, 0x0A4D, 0x0AAA, 0x0AD5, 0x02DA, 0x095D, 0x045E, 0x0A2E, 0x0C9A, // 1550..
    0x0D55, 0x06B2, 0x06B9, 0x04BA, 0x0A5D, 0x052D, 0x0A95, 0x0B52, 0x0BA8, 0x0BB4, // 1560..
    0x05B9, 0x02DA, 0x095A, 0x0B4A, 0x0DA4, 0x0ED1, 0x06E8, 0x0B6A, 0x056D, 0x0535, // 1570..
    0x0695, 0x0D4A, 0x0DA8, 0x0DD4, 0x06DA, 0x055B, 0x029D, 0x062B, 0x0B15, 0x0B4A, // 1580..
    0x0B95, 0x05AA, 0x0AAE, 0x092E, 0x0C8F, 0x0527, 0x0695, 0x06AA, 0x0AD6, 0x055D, // 1590..
    0x029D, // 1600..
];

#[rustfmt::skip]
const UM_AL_QURA_YR_START_ESTIMATE_FIX: [i8; 301] = [
     0,  0, -1,  0, -1,  0,  0,  0,  0,  0, // 1300..
    -1,  0,  0,  0,  0,  0,  0,  0, -1,  0, // 1310..
     1,  0,  1,  1,  0,  0,  0,  0,  1,  0, // 1320..
     0,  0,  0,  0,  0,  0,  1,  0,  0,  0, // 1330..
     0,  0,  1,  0,  0, -1, -1,  0,  0,  0, // 1340..
     1,  0,  0, -1,  0,  0,  0,  1,  1,  0, // 1350..
     0,  0,  0,  0,  0,  0,  0, -1,  0,  0, // 1360..
     0,  1,  1,  0,  0, -1,  0,  1,  0,  1, // 1370..
     1,  0,  0, -1,  0,  1,  0,  0,  0, -1, // 1380..
     0,  1,  0,  1,  0,  0,  0, -1,  0,  0, // 1390..
     0,  0, -1, -1,  0, -1,  0,  1,  0,  0, // 1400..
     0, -1,  0,  0,  0,  1,  0,  0,  0,  0, // 1410..
     0,  1,  0,  0, -1, -1,  0,  0,  0,  1, // 1420..
     0,  0, -1, -1,  0, -1,  0,  0, -1, -1, // 1430..
     0, -1,  0, -1,  0,  0, -1, -1,  0,  0, // 1440..
     0,  0,  0,  0, -1,  0,  1,  0,  1,  1, // 1450..
     0,  0, -1,  0,  1,  0,  0,  0,  0,  0, // 1460..
     1,  0,  1,  0,  0,  0, -1,  0,  1,  0, // 1470..
     0, -1, -1,  0,  0,  0,  1,  0,  0,  0, // 1480..
     0,  0,  0,  0,  1,  0,  0,  0,  0,  0, // 1490..
     1,  0,  0, -1,  0,  0,  0,  1,  1,  0, // 1500..
     0, -1,  0,  1,  0,  1,  1,  0,  0,  0, // 1510..
     0,  1,  0,  0,  0, -1,  0,  0,  0,  1, // 1520..
     0,  0,  0, -1,  0,  0,  0,  0,  0, -1, // 1530..
     0, -1,  0,  1,  0,  0,  0, -1,  0,  1, // 1540..
     0,  1,  0,  0,  0,  0,  0,  1,  0,  0, // 1550..
    -1,  0,  0,  0,  0,  1,  0,  0,  0, -1, // 1560..
     0,  0,  0,  0, -1, -1,  0, -1,  0,  1, // 1570..
     0,  0, -1, -1,  0,  0,  1,  1,  0,  0, // 1580..
    -1,  0,  0,  0,  0,  1,  0,  0,  0,  0, // 1590..
     1 // 1600
];

const DHU_AL_HIJJAH: i32 = 11;

fn epoch(cal: &Calendar) -> i32 {
    match cal.calendar_type() {
        CalendarType::IslamicTbla => ASTRONOMICAL_EPOCH,
        _ => CIVIL_EPOCH,
    }
}

/// Returns the day on which a month of the astronomical calendar starts. `month` is counted from the epoch.
fn true_month_start(month: i32) -> i32 {
    if let Some(start) = MONTH_CACHE.get(month) {
        return start;
    }
    // Estimate from the average month length, then step by days until the new moon is crossed.
    let mut origin = HIJRA_MILLIS + (f64::from(month) * astro::SYNODIC_MONTH).floor() * ONE_DAY;
    if moon_age(origin) >= 0.0 {
        origin -= ONE_DAY;
        while moon_age(origin) >= 0.0 {
            origin -= ONE_DAY;
        }
    } else {
        origin += ONE_DAY;
        while moon_age(origin) < 0.0 {
            origin += ONE_DAY;
        }
    }
    let millis = ((origin as i64) as f64 - HIJRA_MILLIS) as i64;
    let start = (millis.div_euclid(U_MILLIS_PER_DAY.into()) + 1) as i32;
    MONTH_CACHE.put(month, start);
    start
}

/// Returns the angle between the moon and the sun, in degrees from -180 to 180.
fn moon_age(time: UDate) -> f64 {
    let age = astro::moon_age(time) * 180.0 / PI;
    if age > 180.0 { age - 360.0 } else { age }
}

pub(crate) fn year_length(extended_year: i32) -> i32 {
    let month = extended_year.wrapping_sub(1).wrapping_mul(12);
    true_month_start(month.wrapping_add(12)).wrapping_sub(true_month_start(month))
}

/// Returns the Julian day before the first day of a month of the civil or the Umm al-Qura calendar.
pub(crate) fn month_start(cal: &Calendar, eyear: i32, month: i32) -> Result<i64, UErrorCode> {
    let (year, month) = (
        checked_add32(eyear, month.div_euclid(12))?,
        month.rem_euclid(12),
    );
    let start = match cal.calendar_type() {
        CalendarType::IslamicUmalqura => umalqura::month_start(year, month),
        _ => civil::month_start(year, month),
    };
    Ok(start + i64::from(epoch(cal)) - 1)
}

pub(crate) fn compute_fields(cal: &mut Calendar, julian_day: i32) {
    let days = julian_day - CIVIL_EPOCH;

    // Estimate the number of full months since the epoch. Near the end of a month, assume the next month.
    let mut month = (f64::from(days) / astro::SYNODIC_MONTH).floor() as i32;
    let start_date = (f64::from(month) * astro::SYNODIC_MONTH).floor() as i32;
    if days - start_date >= 25 && moon_age(cal.internal_get_time()) > 0.0 {
        month += 1;
    }
    while true_month_start(month) > days {
        month -= 1;
    }

    let (year, month_of_year) = (month.div_euclid(12) + 1, month.rem_euclid(12));
    let day_from = |month| days.wrapping_sub(true_month_start(month)).wrapping_add(1);
    cal.set_date_fields(
        year,
        month_of_year,
        day_from(month),
        day_from(month - month_of_year),
    );
}

/// Returns an estimate of the Gregorian year, which is exact for 1846 to 2138.
pub(crate) fn related_year(year: i32) -> i32 {
    let shift = if year >= 1397 {
        2 * ((year - 1397) / 67) + i32::from((year - 1397) % 67 >= 33)
    } else {
        2 * ((year - 1396) / 67 - 1) + i32::from(-(year - 1396) % 67 <= 33)
    };
    year + 579 - shift
}

pub(crate) mod civil {
    use super::*;

    pub(super) fn year_start(year: i32) -> i64 {
        354 * (i64::from(year) - 1) + (3 + 11 * i64::from(year)).div_euclid(30)
    }

    fn days_before_month(month: i32) -> i32 {
        29 * month + (month + 1) / 2
    }

    /// `month` is in 0..=11.
    pub(super) fn month_start(year: i32, month: i32) -> i64 {
        year_start(year) + i64::from(days_before_month(month))
    }

    fn is_leap_year(year: i32) -> bool {
        year.wrapping_mul(11).wrapping_add(14).rem_euclid(30) < 11
    }

    pub(crate) fn month_length(extended_year: i32, month: i32) -> i32 {
        29 + month.wrapping_add(1) % 2
            + i32::from(month == DHU_AL_HIJJAH && is_leap_year(extended_year))
    }

    pub(crate) fn year_length(extended_year: i32) -> i32 {
        354 + i32::from(is_leap_year(extended_year))
    }

    /// The inverse of `year_start`.
    pub(super) fn year_of_day(days: i64) -> i32 {
        (30 * days + 10646).div_euclid(10631) as i32
    }

    pub(crate) fn compute_fields(cal: &mut Calendar, julian_day: i32) {
        let days = i64::from(julian_day - epoch(cal));
        let year = year_of_day(days);
        let day_of_year = (days - year_start(year)) as i32; // from 0
        let month = (2 * day_of_year / 59).min(DHU_AL_HIJJAH);
        cal.set_date_fields(
            year,
            month,
            day_of_year - days_before_month(month) + 1,
            day_of_year + 1,
        );
    }
}

/// The civil calendar, except for the years in the tables.
pub(crate) mod umalqura {
    use super::*;

    fn of_year<T: Copy>(table: &[T; 301], year: i32) -> Option<T> {
        table
            .get(year.wrapping_sub(UMALQURA_YEAR_START) as u32 as usize)
            .copied()
    }

    fn year_start(year: i32) -> i64 {
        match of_year(&UM_AL_QURA_YR_START_ESTIMATE_FIX, year) {
            // A least-squares fit plus a correction.
            Some(fix) => {
                (354.36720 * f64::from(year - UMALQURA_YEAR_START) + 460322.05 + 0.5) as i64
                    + i64::from(fix)
            }
            None => civil::year_start(year),
        }
    }

    pub(super) fn month_start(year: i32, month: i32) -> i64 {
        year_start(year) + i64::from((0..month).map(|i| month_length(year, i)).sum::<i32>())
    }

    pub(crate) fn month_length(extended_year: i32, month: i32) -> i32 {
        match of_year(&UMALQURA_MONTHLENGTH, extended_year) {
            // `month` may be out of range.
            Some(bits) => {
                29 + (u32::from(bits).wrapping_shr(11i32.wrapping_sub(month) as u32) & 1) as i32
            }
            None => civil::month_length(extended_year, month),
        }
    }

    pub(crate) fn year_length(extended_year: i32) -> i32 {
        match of_year(&UMALQURA_MONTHLENGTH, extended_year) {
            Some(bits) => 12 * 29 + bits.count_ones() as i32,
            None => civil::year_length(extended_year),
        }
    }

    pub(crate) fn compute_fields(cal: &mut Calendar, julian_day: i32) {
        let days = i64::from(julian_day - CIVIL_EPOCH);
        // A year starts within one day of the civil year, and directly after the previous year.
        let civil = civil::year_of_day(days);
        let year =
            civil + i32::from(days >= year_start(civil + 1)) - i32::from(days < year_start(civil));
        let day_of_year = (days - year_start(year) + 1) as i32;
        let (mut month, mut day) = (0, day_of_year);
        while day > month_length(year, month) {
            day -= month_length(year, month);
            month += 1;
        }
        cal.set_date_fields(year, month, day, day_of_year);
    }
}
