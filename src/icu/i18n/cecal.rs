//! The Coptic and the Ethiopic calendars: twelve months of 30 days and one of 5 or 6. ICU4C: cecal.cpp

use crate::common::utypes::*;
use crate::i18n::calendar::{Calendar, CalendarType, Field, checked_add32};

/// Amete Alem 5501 is Amete Mihret 1.
const AMETE_MIHRET_DELTA: i32 = 5500;

/// Returns the Julian day on which the year 0 begins.
fn epoch(cal: &Calendar) -> i32 {
    match cal.calendar_type() {
        CalendarType::Coptic => 1824665,
        CalendarType::EthiopicAmeteAlem => -285019,
        _ => 1723856,
    }
}

fn days_before(year: i64) -> i64 {
    365 * year + year.div_euclid(4)
}

/// Returns the Julian day before the first day of the month.
pub(crate) fn month_start(cal: &Calendar, eyear: i32, month: i32) -> i64 {
    let year = i64::from(eyear) + i64::from(month.div_euclid(13));
    days_before(year) + i64::from(epoch(cal) + 30 * month.rem_euclid(13) - 1)
}

pub(crate) fn year_length(eyear: i32) -> i32 {
    (days_before(eyear.wrapping_add(1).into()) - days_before(eyear.into())) as i32
}

pub(crate) fn compute_fields(cal: &mut Calendar, julian_day: i32) -> Result<(), UErrorCode> {
    let days = checked_add32(julian_day, -epoch(cal))?;
    // The last of four years has 366 days.
    let (cycles, day_of_cycle) = (days.div_euclid(1461), days.rem_euclid(1461));
    let year_of_cycle = (day_of_cycle / 365).min(3);
    let (eyear, day_of_year) = (
        4 * cycles + year_of_cycle,
        day_of_cycle - 365 * year_of_cycle,
    );
    let (era, year) = match cal.calendar_type() {
        CalendarType::EthiopicAmeteAlem => (0, eyear),
        _ if eyear > 0 => (1, eyear),
        CalendarType::Coptic => (0, 1 - eyear),
        _ => (0, eyear + AMETE_MIHRET_DELTA),
    };
    cal.set_date_fields(
        eyear,
        day_of_year / 30,
        day_of_year % 30 + 1,
        day_of_year + 1,
    );
    cal.internal_set(Field::Era, era);
    cal.internal_set(Field::Year, year);
    Ok(())
}
