use core::num::NonZeroU64;

use crate::civil::{week_day, year_month_day};
use crate::time_value::{
    LOCAL_TIMES, local_time_as_integer, make_date, make_day, make_time, split_at_midnight,
};
use crate::zone::{Offset, TimeZoneId};

/// Where a field is in the bits of `DateFields`.
#[derive(Clone, Copy)]
pub struct BitField {
    pub shift: u32,
    pub width: u32,
}

impl BitField {
    const fn above(self, width: u32) -> BitField {
        BitField {
            shift: self.shift + self.width,
            width,
        }
    }

    #[inline(always)]
    pub const fn mask(self) -> u64 {
        (1 << self.width) - 1
    }
}

/// A time value as a calendar and a clock show it, down to the second. It is one word that is not zero, so that generated
/// code can test a cached one and read a field of it with a shift and a mask.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(transparent)]
pub struct DateFields(NonZeroU64);

/// The arguments of the constructor of `Date`, in their order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Component {
    Year,
    Month,
    Day,
    Hour,
    Minute,
    Second,
    Millisecond,
}

/// The fields that an offset decides.
#[derive(Clone, Copy)]
pub(crate) struct OffsetBits(u32);

impl OffsetBits {
    pub(crate) const UTC: OffsetBits = OffsetBits(0);

    #[inline]
    pub(crate) const fn new(offset: Offset) -> OffsetBits {
        let minutes = (offset.seconds / 60) as u32 & DateFields::OFFSET_MINUTES.mask() as u32;
        OffsetBits(minutes << DateFields::OFFSET_MINUTES.shift | offset.is_daylight as u32)
    }
}

impl DateFields {
    pub const IS_DAYLIGHT: BitField = BitField { shift: 0, width: 1 };
    /// Signed.
    pub const OFFSET_MINUTES: BitField = Self::IS_DAYLIGHT.above(14);
    pub const SECOND: BitField = Self::OFFSET_MINUTES.above(6);
    pub const MINUTE: BitField = Self::SECOND.above(6);
    pub const HOUR: BitField = Self::MINUTE.above(5);
    /// The first of the upper half of the word.
    pub const WEEK_DAY: BitField = Self::HOUR.above(3);
    pub const DAY: BitField = Self::WEEK_DAY.above(5);
    pub const MONTH: BitField = Self::DAY.above(4);
    /// Signed.
    pub const YEAR: BitField = Self::MONTH.above(20);

    pub const EPOCH: DateFields = DateFields::at_midnight(0, OffsetBits::UTC);

    /// `None` if `time` is more than a day outside the range of time values.
    #[inline]
    pub fn utc(time: f64) -> Option<DateFields> {
        let (days, since_midnight) = split_at_midnight(local_time_as_integer(time)?);
        Some(DateFields::at_midnight(days, OffsetBits::UTC).later(since_midnight))
    }

    /// The same, and for the local time too.
    pub fn in_zone(time: f64, zone: TimeZoneId) -> Option<DateFields> {
        let time = local_time_as_integer(time)?;
        let offset = zone.rules().span_at(time.div_euclid(1000)).offset;
        let local_time = time + i64::from(offset.seconds) * 1000;
        LOCAL_TIMES.contains(&local_time).then_some(())?;
        let (days, since_midnight) = split_at_midnight(local_time);
        Some(DateFields::at_midnight(days, OffsetBits::new(offset)).later(since_midnight))
    }

    #[inline(always)]
    pub(crate) const fn at_midnight(days: i32, offset: OffsetBits) -> DateFields {
        let (year, month, day) = year_month_day(days);
        let date = (year as u32) << (Self::YEAR.shift - 32)
            | (month - 1) << (Self::MONTH.shift - 32)
            | day << (Self::DAY.shift - 32)
            | week_day(days) as u32;
        match NonZeroU64::new((date as u64) << 32 | offset.0 as u64) {
            Some(bits) => DateFields(bits),
            None => DateFields(NonZeroU64::MIN),
        }
    }

    /// From fields at midnight to those of a time on the same day.
    #[inline(always)]
    pub(crate) fn later(self, milliseconds: u32) -> DateFields {
        // hour * 4096 + minute * 64 + second, from the whole seconds, minutes and hours.
        let clock =
            milliseconds / 1000 + milliseconds / 60_000 * 4 + milliseconds / 3_600_000 * 256;
        DateFields(self.0 | u64::from(clock) << Self::SECOND.shift)
    }

    #[inline(always)]
    pub const fn to_bits(self) -> u64 {
        self.0.get()
    }

    #[inline(always)]
    const fn unsigned(self, field: BitField) -> u8 {
        (self.to_bits() >> field.shift & field.mask()) as u8
    }

    #[inline(always)]
    const fn signed(self, field: BitField) -> i32 {
        ((self.to_bits() << (64 - field.shift - field.width)) as i64 >> (64 - field.width)) as i32
    }

    #[inline]
    pub const fn year(self) -> i32 {
        self.signed(Self::YEAR)
    }

    /// From zero.
    #[inline]
    pub const fn month(self) -> u8 {
        self.unsigned(Self::MONTH)
    }

    /// From one.
    #[inline]
    pub const fn day(self) -> u8 {
        self.unsigned(Self::DAY)
    }

    /// Sunday is 0.
    #[inline]
    pub const fn week_day(self) -> u8 {
        self.unsigned(Self::WEEK_DAY)
    }

    #[inline]
    pub const fn hour(self) -> u8 {
        self.unsigned(Self::HOUR)
    }

    #[inline]
    pub const fn minute(self) -> u8 {
        self.unsigned(Self::MINUTE)
    }

    #[inline]
    pub const fn second(self) -> u8 {
        self.unsigned(Self::SECOND)
    }

    /// What the clock is ahead of UTC, rounded towards zero.
    #[inline]
    pub const fn offset_minutes(self) -> i32 {
        self.signed(Self::OFFSET_MINUTES)
    }

    #[inline]
    pub const fn is_daylight(self) -> bool {
        self.unsigned(Self::IS_DAYLIGHT) != 0
    }

    /// What a setter of `Date.prototype` passes to UTC or TimeClip: the time on the same clock that has `values` for the
    /// components from `first` on.
    #[inline]
    pub fn with_components(self, millisecond: u16, first: Component, values: &[f64]) -> f64 {
        let value = |component: Component, current: i32| {
            let index = (component as usize).wrapping_sub(first as usize);
            values.get(index).copied().unwrap_or_else(|| current.into())
        };
        let day = make_day(
            value(Component::Year, self.year()),
            value(Component::Month, self.month().into()),
            value(Component::Day, self.day().into()),
        );
        let time = make_time(
            value(Component::Hour, self.hour().into()),
            value(Component::Minute, self.minute().into()),
            value(Component::Second, self.second().into()),
            value(Component::Millisecond, millisecond.into()),
        );
        make_date(day, time)
    }
}

const _: () = assert!(DateFields::WEEK_DAY.shift == 32 && DateFields::YEAR.above(0).shift == 64);
