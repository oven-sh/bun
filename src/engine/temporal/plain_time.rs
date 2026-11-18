use core::fmt;

use bun_engine_text::Text;

use crate::format::IsoText;
use crate::rounding::Rounding;
use crate::time_duration::split_days;
use crate::unit::{
    NANOSECONDS_PER_DAY, NANOSECONDS_PER_HOUR, NANOSECONDS_PER_MINUTE, NANOSECONDS_PER_SECOND,
    UnitGroup,
};
use crate::{
    DifferenceOperation, DifferenceOptions, Duration, Error, Fields, Overflow, Precision,
    PrecisionOptions, Result, RoundOptions, TimeDuration, Unit, parse,
};

/// A Time Record, which is all that a `Temporal.PlainTime` holds: nanoseconds since midnight.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PlainTime(u64);

impl PlainTime {
    pub const MIDNIGHT: PlainTime = PlainTime(0);

    #[inline]
    pub(crate) const fn from_nanosecond_of_day(nanoseconds: i64) -> PlainTime {
        debug_assert!(nanoseconds >= 0 && nanoseconds < NANOSECONDS_PER_DAY);
        PlainTime(nanoseconds as u64)
    }

    /// IsValidTime and CreateTimeRecord. The fields go from the hour to the nanosecond.
    #[inline]
    pub fn new(fields: [i32; 6]) -> Result<PlainTime> {
        PlainTime::regulate(fields, Overflow::Reject)
    }

    /// RegulateTime
    #[inline]
    pub(crate) fn regulate(fields: [i32; 6], overflow: Overflow) -> Result<PlainTime> {
        const LIMITS: [(i32, Error); 6] = [
            (24, Error::HourOutOfRange),
            (60, Error::MinuteOutOfRange),
            (60, Error::SecondOutOfRange),
            (1000, Error::MillisecondOutOfRange),
            (1000, Error::MicrosecondOutOfRange),
            (1000, Error::NanosecondOutOfRange),
        ];
        let mut nanoseconds = 0;
        for (field, (limit, error)) in fields.into_iter().zip(LIMITS) {
            let constrained = field.clamp(0, limit - 1);
            if constrained != field && overflow == Overflow::Reject {
                return Err(error);
            }
            nanoseconds = nanoseconds * i64::from(limit) + i64::from(constrained);
        }
        Ok(PlainTime::from_nanosecond_of_day(nanoseconds))
    }

    /// The conversion of an argument of the constructor.
    pub fn argument(number: f64) -> Result<i32> {
        if number.is_nan() {
            return Err(Error::PlainTimeArgumentIsNaN);
        }
        crate::to_integer_with_truncation(number, Error::PlainTimeArgumentNotFinite)
    }

    /// For `FieldSet::Time`.
    pub fn from_fields(fields: &Fields, overflow: Overflow) -> Result<PlainTime> {
        PlainTime::MIDNIGHT.with(fields, overflow)
    }

    #[inline]
    pub fn parse(text: Text<'_>) -> Result<PlainTime> {
        parse::time(text).ok_or(Error::InvalidTimeText)
    }

    #[inline]
    pub const fn nanosecond_of_day(self) -> i64 {
        self.0 as i64
    }

    #[inline]
    pub(crate) const fn second_of_day(self) -> u32 {
        (self.0 / NANOSECONDS_PER_SECOND as u64) as u32
    }

    #[inline]
    pub(crate) const fn nanosecond_of_second(self) -> u32 {
        (self.0 % NANOSECONDS_PER_SECOND as u64) as u32
    }

    #[inline]
    pub const fn hour(self) -> u8 {
        (self.0 / NANOSECONDS_PER_HOUR as u64) as u8
    }

    #[inline]
    pub const fn minute(self) -> u8 {
        ((self.0 / NANOSECONDS_PER_MINUTE as u64) as u32 % 60) as u8
    }

    #[inline]
    pub const fn second(self) -> u8 {
        (self.second_of_day() % 60) as u8
    }

    #[inline]
    pub const fn millisecond(self) -> u16 {
        ((self.0 / 1_000_000) as u32 % 1000) as u16
    }

    #[inline]
    pub const fn microsecond(self) -> u16 {
        (self.nanosecond_of_second() / 1000 % 1000) as u16
    }

    #[inline]
    pub const fn nanosecond(self) -> u16 {
        (self.0 % 1000) as u16
    }

    #[inline]
    pub(crate) fn fields(self) -> [i32; 6] {
        [
            self.hour().into(),
            self.minute().into(),
            self.second().into(),
            self.millisecond().into(),
            self.microsecond().into(),
            self.nanosecond().into(),
        ]
    }

    /// For `FieldSet::Time`.
    pub fn with(self, fields: &Fields, overflow: Overflow) -> Result<PlainTime> {
        fields.time_over(self, overflow)
    }

    pub fn add(self, duration: &Duration) -> PlainTime {
        self.add_with_carry(duration.time()).1
    }

    pub fn subtract(self, duration: &Duration) -> PlainTime {
        self.add_with_carry(-duration.time()).1
    }

    /// AddTime
    #[inline]
    pub(crate) fn add_with_carry(self, duration: TimeDuration) -> (i64, PlainTime) {
        let (days, rest) = split_days(i128::from(self.0) + duration.nanoseconds());
        (days, PlainTime::from_nanosecond_of_day(rest))
    }

    /// DifferenceTime
    #[inline]
    pub(crate) fn until(self, other: PlainTime) -> TimeDuration {
        TimeDuration::from_valid(i128::from(
            other.nanosecond_of_day() - self.nanosecond_of_day(),
        ))
    }

    /// DifferenceTemporalPlainTime
    pub fn difference(
        self,
        operation: DifferenceOperation,
        other: PlainTime,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        let settings = options.resolve(operation, UnitGroup::Time, Unit::Nanosecond, Unit::Hour)?;
        let time = self.until(other).round(settings.rounding)?;
        Duration::from_difference(operation, time.into(), settings.largest_unit)
    }

    pub fn round(self, options: RoundOptions) -> Result<PlainTime> {
        let rounding = options.resolve(UnitGroup::Time)?.within_next_unit()?;
        Ok(self.round_with_carry(rounding).1)
    }

    /// RoundTime, and whether the result is on the next day. The increment divides the next larger unit.
    #[inline(always)]
    pub(crate) fn round_with_carry(self, rounding: Rounding) -> (bool, PlainTime) {
        if rounding.is_to_one(Unit::Nanosecond) {
            return (false, self);
        }
        self.round_to_step(rounding)
    }

    fn round_to_step(self, rounding: Rounding) -> (bool, PlainTime) {
        let step = rounding.step_nanoseconds() as u64;
        let remainder = self.0 % step;
        if remainder == 0 {
            return (false, self);
        }
        // Multiples are counted from the start of the next larger unit.
        let lesser_is_odd = || {
            let unit = rounding.unit;
            let span = unit.nanoseconds() * unit.count_in_next_unit().unwrap_or(1);
            self.0 % span as u64 / step % 2 == 1
        };
        let position = (2 * remainder).cmp(&step);
        let mut rounded = self.0 - remainder;
        if rounding.mode.rounds_up(false, position, lesser_is_odd) {
            rounded += step;
        }
        if rounded == NANOSECONDS_PER_DAY as u64 {
            return (true, PlainTime::MIDNIGHT);
        }
        (false, PlainTime(rounded))
    }

    #[inline]
    pub fn precision(options: PrecisionOptions) -> Result<Precision> {
        options.resolve(Unit::Minute, Error::HourInPlainTimeText)
    }

    #[inline(always)]
    pub fn to_text(self, precision: Precision) -> IsoText {
        let mut text = IsoText::new();
        text.push_time(
            self.round_with_carry(precision.rounding).1,
            precision.format,
        );
        text
    }
}

impl fmt::Debug for PlainTime {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.to_text(Precision::AUTO).fmt(formatter)
    }
}
