use core::fmt;
use core::ops::Deref;

use bun_engine_date::TimeZone;
use bun_engine_number::write_u64;
use bun_engine_text::Text;

use crate::settings::SecondsFormat;
use crate::{
    CalendarId, Duration, IsoDate, IsoDateTime, PlainTime, ShowCalendar, TimeDuration, Unit,
};

/// More than the longest duration, or a date and time with all of its annotations.
const CAPACITY: usize = 127;
/// What is left for the name of a time zone, which is twice the longest that there is.
const ZONE_NAME_CAPACITY: usize = 62;

/// The ASCII text of a value.
#[derive(Clone, Copy)]
pub struct IsoText {
    bytes: [u8; CAPACITY],
    length: u8,
}

/// Spreads each number below 100 that starts at a byte of `mask` over that byte and the next, tens first.
#[inline(always)]
fn split_tens(numbers: u64, mask: u64) -> u64 {
    let tens = ((numbers * 103) >> 10) & mask;
    tens | (numbers - tens * 10) << 8
}

/// The two digits of each of three numbers below 100, with `separator` between them.
#[inline(always)]
fn three_fields(fields: [u32; 3], separator: u8) -> [u8; 8] {
    let [first, second, third] = fields.map(u64::from);
    let digits = split_tens(first | second << 24 | third << 48, 0x000f_0000_0f00_000f);
    let template = [b'0', b'0', separator, b'0', b'0', separator, b'0', b'0'];
    (digits | u64::from_le_bytes(template)).to_le_bytes()
}

/// The values of the digits of a number below 10^8, the first in the lowest byte.
#[inline(always)]
fn eight_digit_values(number: u32) -> u64 {
    let (upper, lower) = (u64::from(number / 10_000), u64::from(number % 10_000));
    let pairs = (upper / 100) | (upper % 100) << 16 | (lower / 100) << 32 | (lower % 100) << 48;
    split_tens(pairs, 0x000f_000f_000f_000f)
}

#[inline(always)]
const fn two_digits(value: u32) -> [u8; 2] {
    [b'0' + (value / 10) as u8, b'0' + (value % 10) as u8]
}

impl ShowCalendar {
    #[inline]
    fn shows(self, calendar: CalendarId) -> bool {
        match self {
            ShowCalendar::Auto => calendar != CalendarId::Iso8601,
            ShowCalendar::Always | ShowCalendar::Critical => true,
            ShowCalendar::Never => false,
        }
    }

    /// Whether a month of a year, or a day of a month, is written with all of the date that it holds.
    #[inline]
    pub(crate) fn needs_full_date(self, calendar: CalendarId) -> bool {
        self.shows(calendar) || calendar != CalendarId::Iso8601
    }
}

impl IsoText {
    #[inline]
    pub(crate) const fn new() -> IsoText {
        IsoText {
            bytes: [0; CAPACITY],
            length: 0,
        }
    }

    #[inline]
    pub fn text(&self) -> Text<'_> {
        Text::Latin1(self)
    }

    #[inline(always)]
    pub(crate) fn push(&mut self, character: u8) {
        self.push_prefix([character], 1);
    }

    #[inline(always)]
    fn push_slice(&mut self, ascii: &[u8]) {
        let start = usize::from(self.length);
        self.bytes[start..start + ascii.len()].copy_from_slice(ascii);
        self.length += ascii.len() as u8;
    }

    /// Writes all of `ascii` and keeps the first `count`.
    #[inline(always)]
    fn push_prefix<const N: usize>(&mut self, ascii: [u8; N], count: u8) {
        let start = usize::from(self.length);
        self.bytes[start..start + N].copy_from_slice(&ascii);
        self.length += count;
    }

    #[inline]
    fn push_integer(&mut self, number: u64) {
        let room = self.bytes[usize::from(self.length)..].first_chunk_mut();
        self.length += write_u64(number, room.expect("a duration leaves room")) as u8;
    }

    /// PadISOYear, the month and the day, without the last `omitted` characters.
    #[inline(always)]
    fn push_start_of_date(&mut self, date: IsoDate, omitted: u8) {
        let (year, magnitude) = (date.year(), date.year().unsigned_abs());
        if !(0..=9999).contains(&year) {
            self.push(if year < 0 { b'-' } else { b'+' });
            self.push_prefix(two_digits(magnitude / 10_000 % 100), 2);
        }
        self.push_prefix(two_digits(magnitude / 100 % 100), 2);
        let fields = [magnitude % 100, date.month().into(), date.day().into()];
        self.push_prefix(three_fields(fields, b'-'), 8 - omitted);
    }

    pub(crate) fn push_date(&mut self, date: IsoDate) {
        self.push_start_of_date(date, 0);
    }

    pub(crate) fn push_year_month(&mut self, date: IsoDate) {
        self.push_start_of_date(date, 3);
    }

    pub(crate) fn push_month_day(&mut self, date: IsoDate) {
        let fields = [date.month().into(), date.day().into(), 0];
        self.push_prefix(three_fields(fields, b'-'), 5);
    }

    /// FormatTimeString
    pub(crate) fn push_time(&mut self, time: PlainTime, format: SecondsFormat) {
        let seconds = time.second_of_day();
        let clock = three_fields([seconds / 3600, seconds / 60 % 60, seconds % 60], b':');
        if format == SecondsFormat::Omitted {
            return self.push_prefix(clock, 5);
        }
        self.push_prefix(clock, 8);
        self.push_fraction(time.nanosecond_of_second(), format);
    }

    /// FormatFractionalSeconds
    #[inline(always)]
    fn push_fraction(&mut self, nanoseconds: u32, format: SecondsFormat) {
        if format == SecondsFormat::Digits(0)
            || (format == SecondsFormat::Shortest && nanoseconds == 0)
        {
            return;
        }
        let rest = eight_digit_values(nanoseconds % 100_000_000);
        let count = match format {
            SecondsFormat::Digits(count) => count - 1,
            _ => 8 - (rest.leading_zeros() / 8) as u8,
        };
        self.push_prefix([b'.', b'0' + (nanoseconds / 100_000_000) as u8], 2);
        self.push_prefix(rest.to_le_bytes().map(|digit| digit | b'0'), count);
    }

    #[inline(always)]
    pub(crate) fn push_date_time(&mut self, date_time: IsoDateTime, format: SecondsFormat) {
        self.push_date(date_time.date);
        self.push(b'T');
        self.push_time(date_time.time, format);
    }

    /// FormatUTCOffsetNanoseconds
    pub(crate) fn push_offset(&mut self, seconds: i32) {
        let magnitude = seconds.unsigned_abs();
        let fields = [magnitude / 3600, magnitude / 60 % 60, magnitude % 60];
        self.push(if seconds < 0 { b'-' } else { b'+' });
        self.push_prefix(
            three_fields(fields, b':'),
            if fields[2] == 0 { 5 } else { 8 },
        );
    }

    /// FormatDateTimeUTCOffsetRounded
    #[inline]
    pub(crate) fn push_rounded_offset(&mut self, seconds: i32) {
        self.push_offset(seconds.signum() * ((seconds.abs() + 30) / 60 * 60));
    }

    #[inline]
    fn open_annotation(&mut self, is_critical: bool) {
        self.push_prefix(*b"[!", 1 + u8::from(is_critical));
    }

    pub(crate) fn push_time_zone(&mut self, time_zone: TimeZone, is_critical: bool) {
        let identifier = time_zone.identifier();
        let name = identifier.as_bytes();
        self.open_annotation(is_critical);
        self.push_slice(&name[..name.len().min(ZONE_NAME_CAPACITY)]);
        self.push(b']');
    }

    /// FormatCalendarAnnotation
    #[inline(always)]
    pub(crate) fn push_calendar(&mut self, calendar: CalendarId, show: ShowCalendar) {
        if show.shows(calendar) {
            self.push_calendar_annotation(calendar, show == ShowCalendar::Critical);
        }
    }

    fn push_calendar_annotation(&mut self, calendar: CalendarId, is_critical: bool) {
        self.open_annotation(is_critical);
        self.push_prefix(*b"u-ca=", 5);
        self.push_slice(calendar.identifier().as_bytes());
        self.push(b']');
    }

    /// TemporalDurationToString
    pub(crate) fn push_duration(&mut self, duration: &Duration, format: SecondsFormat) {
        if duration.sign() < 0 {
            self.push(b'-');
        }
        self.push(b'P');
        self.push_count(duration.get(Unit::Year), b'Y');
        self.push_count(duration.get(Unit::Month), b'M');
        self.push_count(duration.get(Unit::Week), b'W');
        self.push_count(duration.get(Unit::Day), b'D');

        let seconds = TimeDuration::from_valid(duration.nanoseconds_from(Unit::Second));
        let has_seconds = seconds != TimeDuration::ZERO
            || format != SecondsFormat::Shortest
            || duration.largest_unit() <= Unit::Second;
        let (hours, minutes) = (duration.get(Unit::Hour), duration.get(Unit::Minute));
        if hours == 0.0 && minutes == 0.0 && !has_seconds {
            return;
        }
        self.push(b'T');
        self.push_count(hours, b'H');
        self.push_count(minutes, b'M');
        if has_seconds {
            let (seconds, fraction) = seconds.magnitude_in_seconds();
            self.push_integer(seconds);
            self.push_fraction(fraction, format);
            self.push(b'S');
        }
    }

    #[inline]
    fn push_count(&mut self, count: f64, designator: u8) {
        if count != 0.0 {
            self.push_integer((count as i64).unsigned_abs());
            self.push(designator);
        }
    }
}

impl Deref for IsoText {
    type Target = [u8];

    #[inline]
    fn deref(&self) -> &[u8] {
        &self.bytes[..usize::from(self.length)]
    }
}

impl fmt::Debug for IsoText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.text().fmt(formatter)
    }
}
