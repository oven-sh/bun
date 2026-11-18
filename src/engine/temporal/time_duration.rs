use core::ops::Neg;

use crate::ratio::nearest_double;
use crate::rounding::Rounding;
use crate::unit::{NANOSECONDS_PER_DAY, NANOSECONDS_PER_SECOND};
use crate::{Error, Result, Unit};

/// A number of nanoseconds that is less than 2^53 seconds in magnitude.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Debug)]
pub(crate) struct TimeDuration(i128);

impl TimeDuration {
    pub(crate) const ZERO: TimeDuration = TimeDuration(0);
    const LIMIT: u128 = (1 << 53) * NANOSECONDS_PER_SECOND as u128;

    #[inline]
    pub(crate) fn new(nanoseconds: i128) -> Option<TimeDuration> {
        (nanoseconds.unsigned_abs() < TimeDuration::LIMIT).then_some(TimeDuration(nanoseconds))
    }

    #[inline]
    pub(crate) fn from_valid(nanoseconds: i128) -> TimeDuration {
        debug_assert!(nanoseconds.unsigned_abs() < TimeDuration::LIMIT);
        TimeDuration(nanoseconds)
    }

    #[inline]
    pub(crate) const fn nanoseconds(self) -> i128 {
        self.0
    }

    /// TimeDurationSign
    #[inline]
    pub(crate) fn sign(self) -> i8 {
        self.0.signum() as i8
    }

    /// Add24HourDaysToTimeDuration
    #[inline]
    pub(crate) fn add_days(self, days: i64) -> Result<TimeDuration> {
        TimeDuration::new(self.0 + i128::from(days) * i128::from(NANOSECONDS_PER_DAY))
            .ok_or(Error::TotalTimeOutOfRange)
    }

    /// RoundTimeDuration
    #[inline]
    pub(crate) fn round(self, rounding: Rounding) -> Result<TimeDuration> {
        if rounding.is_to_one(Unit::Nanosecond) {
            return Ok(self);
        }
        TimeDuration::new(rounding.mode.round(self.0, rounding.step_nanoseconds()))
            .ok_or(Error::RoundedTimeOutOfRange)
    }

    /// TotalTimeDuration
    pub(crate) fn total(self, unit: Unit) -> f64 {
        nearest_double(self.0, i128::from(unit.nanoseconds()))
    }

    /// Whole seconds, and the nanoseconds that remain.
    #[inline]
    pub(crate) fn magnitude_in_seconds(self) -> (u64, u32) {
        const SECOND: u64 = NANOSECONDS_PER_SECOND as u64;
        let magnitude = self.0.unsigned_abs();
        let seconds = match u64::try_from(magnitude) {
            Ok(magnitude) => magnitude / SECOND,
            Err(_) => (magnitude / u128::from(SECOND)) as u64,
        };
        let rest = (magnitude as u64).wrapping_sub(seconds.wrapping_mul(SECOND));
        (seconds, rest as u32)
    }

    /// Truncated.
    #[inline]
    pub(crate) fn whole_days(self) -> i64 {
        let (days, _) = split_days(self.0.abs());
        days * i64::from(self.sign())
    }
}

impl Neg for TimeDuration {
    type Output = TimeDuration;

    #[inline]
    fn neg(self) -> TimeDuration {
        TimeDuration(-self.0)
    }
}

/// The floor of the number of days, and the nanoseconds that remain. The magnitude of `nanoseconds` is below 2^100.
#[inline]
pub(crate) fn split_days(nanoseconds: i128) -> (i64, i64) {
    const SHIFT: u32 = NANOSECONDS_PER_DAY.trailing_zeros();
    let days = match i64::try_from(nanoseconds >> SHIFT) {
        Ok(shifted) => shifted.div_euclid(NANOSECONDS_PER_DAY >> SHIFT),
        Err(_) => nanoseconds.div_euclid(i128::from(NANOSECONDS_PER_DAY)) as i64,
    };
    let rest = (nanoseconds as i64).wrapping_sub(days.wrapping_mul(NANOSECONDS_PER_DAY));
    (days, rest)
}
