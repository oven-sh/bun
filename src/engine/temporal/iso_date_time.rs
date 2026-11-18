use crate::rounding::Rounding;
use crate::unit::{NANOSECONDS_PER_DAY, NANOSECONDS_PER_SECOND};
use crate::{IsoDate, PlainTime};

/// An ISO Date-Time Record.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct IsoDateTime {
    pub date: IsoDate,
    pub time: PlainTime,
}

impl IsoDateTime {
    #[inline]
    pub(crate) fn at_midnight(date: IsoDate) -> IsoDateTime {
        IsoDateTime {
            date,
            time: PlainTime::MIDNIGHT,
        }
    }

    /// GetUTCEpochNanoseconds
    #[inline]
    pub(crate) fn utc_epoch_nanoseconds(self) -> i128 {
        i128::from(self.date.epoch_days()) * i128::from(NANOSECONDS_PER_DAY)
            + i128::from(self.time.nanosecond_of_day())
    }

    #[inline]
    pub(crate) fn utc_epoch_seconds(self) -> i64 {
        i64::from(self.date.epoch_days()) * (NANOSECONDS_PER_DAY / NANOSECONDS_PER_SECOND)
            + i64::from(self.time.second_of_day())
    }

    /// ISODateTimeWithinLimits
    #[inline]
    pub(crate) fn is_within_limits(self) -> bool {
        self.date.is_within_limits() && self != IsoDateTime::at_midnight(IsoDate::MIN)
    }

    /// RoundISODateTime
    #[inline]
    pub(crate) fn round(self, rounding: Rounding) -> IsoDateTime {
        let (is_next_day, time) = self.time.round_with_carry(rounding);
        IsoDateTime {
            date: self.date.add_few_days(i8::from(is_next_day)),
            time,
        }
    }
}
