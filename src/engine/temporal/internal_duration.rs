use core::ops::Neg;

use crate::TimeDuration;

/// A Date Duration Record. No two fields have opposite signs.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub(crate) struct DateDuration {
    pub(crate) years: i64,
    pub(crate) months: i64,
    pub(crate) weeks: i64,
    pub(crate) days: i64,
}

impl DateDuration {
    pub(crate) const ZERO: DateDuration = DateDuration::from_days(0);

    #[inline]
    pub(crate) const fn from_days(days: i64) -> DateDuration {
        DateDuration {
            years: 0,
            months: 0,
            weeks: 0,
            days,
        }
    }

    /// DateDurationSign
    #[inline]
    pub(crate) fn sign(self) -> i8 {
        (self.years | self.months | self.weeks | self.days).signum() as i8
    }

    #[inline]
    pub(crate) fn has_calendar_units(self) -> bool {
        self.years | self.months | self.weeks != 0
    }

    #[inline]
    pub(crate) fn with_days(self, days: i64) -> DateDuration {
        DateDuration { days, ..self }
    }

    #[inline]
    pub(crate) fn weeks_and_days_in_days(self) -> i64 {
        7 * self.weeks + self.days
    }
}

/// An Internal Duration Record.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub(crate) struct InternalDuration {
    pub(crate) date: DateDuration,
    pub(crate) time: TimeDuration,
}

impl InternalDuration {
    /// InternalDurationSign
    #[inline]
    pub(crate) fn sign(self) -> i8 {
        match self.date.sign() {
            0 => self.time.sign(),
            sign => sign,
        }
    }
}

impl Neg for InternalDuration {
    type Output = InternalDuration;

    #[inline]
    fn neg(self) -> InternalDuration {
        InternalDuration {
            date: DateDuration {
                years: -self.date.years,
                months: -self.date.months,
                weeks: -self.date.weeks,
                days: -self.date.days,
            },
            time: -self.time,
        }
    }
}

impl From<DateDuration> for InternalDuration {
    #[inline]
    fn from(date: DateDuration) -> InternalDuration {
        InternalDuration {
            date,
            time: TimeDuration::ZERO,
        }
    }
}

impl From<TimeDuration> for InternalDuration {
    #[inline]
    fn from(time: TimeDuration) -> InternalDuration {
        InternalDuration {
            date: DateDuration::ZERO,
            time,
        }
    }
}
