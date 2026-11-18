//! The proleptic Gregorian calendar, over days counted from 1970-01-01.

const DAYS_PER_ERA: u64 = 146_097;
const YEARS_PER_ERA: u64 = 400;
/// From 0000-03-01, the first day of an era whose years end with February.
const DAYS_TO_EPOCH: u64 = 719_468;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct CivilDate {
    pub year: i32,
    /// From 1.
    pub month: u8,
    /// From 1.
    pub day: u8,
}

#[inline(always)]
const fn multiply_high(a: u64, b: u64) -> u64 {
    ((a as u128 * b as u128) >> 64) as u64
}

#[inline]
pub const fn civil_from_days(days: i32) -> CivilDate {
    let (year, month, day) = year_month_day(days);
    CivilDate {
        year,
        month: month as u8,
        day: day as u8,
    }
}

/// Joffe, "A very fast 64-bit date algorithm" (2025). Counted backwards from the leap day that ends an era, the long century
/// and the long year come first, so each is found with one multiplication.
#[inline(always)]
pub(crate) const fn year_month_day(days: i32) -> (i32, u32, u32) {
    const ERAS: u64 = (i32::MAX as u64 + DAYS_TO_EPOCH) / DAYS_PER_ERA + 1;
    const LAST_DAY: u64 = ERAS * DAYS_PER_ERA - DAYS_TO_EPOCH - 1;
    const LAST_YEAR: u64 = ERAS * YEARS_PER_ERA - 1;
    const PER_CENTURY: u64 = ((4u128 << 64) / DAYS_PER_ERA as u128) as u64 + 1;
    const PER_YEAR: u64 = ((4u128 << 64) / 1461) as u64 + 1;
    // A month is 2^16 units, a day about 2142 and a quarter of a day about 535.
    const UNITS_PER_YEAR: u64 = 782_432;
    const UNITS_IN_JANUARY_AND_FEBRUARY: u32 = 126_464;
    const END_OF_FEBRUARY: u32 = 191_360;

    let days_back = LAST_DAY.wrapping_sub(days as u64);
    let centuries_back = multiply_high(days_back, PER_CENTURY);
    let julian_days_back = days_back + centuries_back - centuries_back / 4;

    let years_back = julian_days_back as u128 * PER_YEAR as u128;
    let year_from_march = LAST_YEAR.wrapping_sub((years_back >> 64) as u64) as i32;
    let units_back = multiply_high(years_back as u64, UNITS_PER_YEAR) as u32;

    let is_next_year = units_back < UNITS_IN_JANUARY_AND_FEBRUARY;
    let end = END_OF_FEBRUARY + if is_next_year { 0 } else { 12 << 16 };
    let units = (year_from_march as u32 & 3) * 512 + end - units_back;
    (
        year_from_march + is_next_year as i32,
        units >> 16,
        (units & 0xffff) / 2140 + 1,
    )
}

/// Neri and Schneider, "Euclidean affine functions and their application to calendar algorithms" (2022). `month` is 1 to 12.
/// A day past the end of the month counts on into the next.
#[inline]
pub const fn days_from_civil(year: i32, month: u8, day: u8) -> i64 {
    const ERAS: u64 = (1 << 31) / YEARS_PER_ERA + 1;
    const EPOCH: u64 = ERAS * DAYS_PER_ERA + DAYS_TO_EPOCH;

    let is_next_year = month <= 2;
    let years = (year as i64 + (ERAS * YEARS_PER_ERA) as i64 - is_next_year as i64) as u64;
    let quadrennia = (years / 4) as u32;
    let centuries = quadrennia / 25;
    let leap_days = quadrennia - centuries + centuries / 4;
    let months = month as u32 + if is_next_year { 12 } else { 0 };
    let days_in_months = (979 * months - 2919) / 32;
    (365 * years + leap_days as u64 + (days_in_months + day as u32) as u64) as i64
        - (EPOCH + 1) as i64
}

/// Sunday is 0. Joffe, "A faster way to calculate the day of the week" (2026): for k below 7, k is the top three bits of the
/// fraction k / 7.
#[inline]
pub const fn week_day(days: i32) -> u8 {
    const SEVENTH: u64 = u64::MAX / 7 + 1;
    const THURSDAY: u64 = 4 * SEVENTH;
    const MARGIN: u64 = SEVENTH / 16;
    ((days as u64)
        .wrapping_mul(SEVENTH)
        .wrapping_add(THURSDAY + MARGIN)
        >> 61) as u8
}

#[inline]
pub const fn is_leap_year(year: i32) -> bool {
    year & (if year % 25 == 0 { 15 } else { 3 }) == 0
}

#[inline]
pub const fn days_in_year(year: i32) -> u16 {
    365 + is_leap_year(year) as u16
}

/// `month` is 1 to 12.
#[inline]
pub const fn days_in_month(year: i32, month: u8) -> u8 {
    if month == 2 {
        28 + is_leap_year(year) as u8
    } else {
        30 | (month ^ (month >> 3))
    }
}

/// From 1.
#[inline]
pub const fn day_of_year(date: CivilDate) -> u16 {
    (days_from_civil(date.year, date.month, date.day) - days_from_civil(date.year, 1, 0)) as u16
}
