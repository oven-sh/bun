//! Time values and the arithmetic of ECMA-262, 21.4.1.

use core::ops::RangeInclusive;

use crate::civil::days_from_civil;

const MS_PER_SECOND: f64 = 1000.0;
const MS_PER_MINUTE: f64 = 60_000.0;
const MS_PER_HOUR: f64 = 3_600_000.0;
pub const MS_PER_DAY: f64 = 86_400_000.0;
pub const MAX_TIME_VALUE: f64 = 8.64e15;
pub(crate) const TIME_VALUES: RangeInclusive<i64> =
    -(MAX_TIME_VALUE as i64)..=MAX_TIME_VALUE as i64;
pub(crate) const DAY: i64 = MS_PER_DAY as i64;
/// What a clock can show at some time value.
pub(crate) const LOCAL_TIMES: RangeInclusive<i64> =
    *TIME_VALUES.start() - DAY..=*TIME_VALUES.end() + DAY;

#[inline]
pub fn time_clip(time: f64) -> f64 {
    if time.abs() <= MAX_TIME_VALUE {
        time.trunc() + 0.0
    } else {
        f64::NAN
    }
}

#[inline]
pub(crate) fn time_clip_integer(time: i64) -> f64 {
    if TIME_VALUES.contains(&time) {
        time as f64
    } else {
        f64::NAN
    }
}

/// Rounded towards zero, if that is in the range of time values.
#[inline(always)]
pub(crate) fn time_as_integer(time: f64) -> Option<i64> {
    (time.to_int_checked()).filter(|time| TIME_VALUES.contains(time))
}

/// The same for `LOCAL_TIMES`.
#[inline(always)]
pub(crate) fn local_time_as_integer(time: f64) -> Option<i64> {
    (time.to_int_checked()).filter(|time| LOCAL_TIMES.contains(time))
}

/// Day and TimeWithinDay. `time` is within a day of the range of time values.
#[inline(always)]
pub(crate) const fn split_at_midnight(time: i64) -> (i32, u32) {
    const DAYS_BEFORE_EPOCH: u64 = 100_000_001;
    let since_start = (time as u64).wrapping_add(DAYS_BEFORE_EPOCH * DAY as u64);
    (
        (since_start / DAY as u64).wrapping_sub(DAYS_BEFORE_EPOCH) as i32,
        (since_start % DAY as u64) as u32,
    )
}

/// The result is not finite if an argument is not, which `make_date` turns into NaN.
#[inline]
pub fn make_time(hour: f64, minute: f64, second: f64, millisecond: f64) -> f64 {
    hour.trunc() * MS_PER_HOUR
        + minute.trunc() * MS_PER_MINUTE
        + second.trunc() * MS_PER_SECOND
        + millisecond.trunc()
}

/// `month` is from zero. NaN if the year that it falls in does not fit in 32 bits.
#[inline]
pub fn make_day(year: f64, month: f64, date: f64) -> f64 {
    let integers = match (year.to_int_checked(), month.to_int_checked()) {
        (Some(year), Some(month)) => Some((year, month)),
        _ => balance_large_year_and_month(year, month),
    };
    match integers.and_then(|(year, month)| first_day_of_month(year, month)) {
        Some(day) => day as f64 + date.trunc() - 1.0,
        None => f64::NAN,
    }
}

#[cold]
fn balance_large_year_and_month(year: f64, month: f64) -> Option<(i32, i32)> {
    let years_in_months = (month.trunc() / 12.0).floor();
    Some((
        (year.trunc() + years_in_months).to_int_checked()?,
        (month.trunc() - years_in_months * 12.0).to_int_checked()?,
    ))
}

#[inline(always)]
fn first_day_of_month(year: i32, month: i32) -> Option<i64> {
    let year = year.checked_add(month.div_euclid(12))?;
    Some(days_from_civil(year, month.rem_euclid(12) as u8 + 1, 1))
}

#[inline]
pub fn make_date(day: f64, time: f64) -> f64 {
    let date = day * MS_PER_DAY + time;
    if date.is_finite() { date } else { f64::NAN }
}

#[inline]
pub fn make_full_year(year: f64) -> f64 {
    let year = year.trunc();
    if (0.0..=99.0).contains(&year) {
        1900.0 + year
    } else {
        year
    }
}

/// `make_date` of `make_day` and `make_time`.
#[inline]
pub fn make_date_from_integers(components: [i32; 7]) -> f64 {
    let [year, month, day, hour, minute, second, millisecond] = components;
    let Some(first_day) = first_day_of_month(year, month) else {
        return f64::NAN;
    };
    let days = first_day + i64::from(day) - 1;
    let time = i64::from(hour) * 3_600_000
        + i64::from(minute) * 60_000
        + i64::from(second) * 1000
        + i64::from(millisecond);
    days as f64 * MS_PER_DAY + time as f64
}

/// msFromTime. Zero for NaN.
#[inline]
pub fn ms_from_time(time: f64) -> u16 {
    let time: i64 = time.to_int_checked().unwrap_or(0);
    (time.wrapping_sub(*TIME_VALUES.start()) as u64 % 1000) as u16
}
