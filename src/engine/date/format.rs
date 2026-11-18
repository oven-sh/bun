//! The strings of ECMA-262, 21.4.4. They are stored where they end up, several characters at a time.

use bun_engine_text::{CodeUnit, StringRef, StringWriter, Text, with_text};

use crate::civil::{days_from_civil, year_month_day};
use crate::fields::DateFields;
use crate::time_value::{DAY, split_at_midnight, time_as_integer};

pub const MAX_ISO_STRING_LENGTH: usize = 27;

/// As many as the bits of the field can tell apart.
const WEEK_DAYS: [[u8; 4]; 8] = [
    *b"Sun ", *b"Mon ", *b"Tue ", *b"Wed ", *b"Thu ", *b"Fri ", *b"Sat ", *b"    ",
];
const MONTHS: [[u8; 4]; 16] = [
    *b"Jan ", *b"Feb ", *b"Mar ", *b"Apr ", *b"May ", *b"Jun ", *b"Jul ", *b"Aug ", *b"Sep ",
    *b"Oct ", *b"Nov ", *b"Dec ", *b"    ", *b"    ", *b"    ", *b"    ",
];

/// `pattern` with the two digits of each number, which is below 100, added to it from the position that goes with it.
#[inline(always)]
fn fill<const N: usize, const M: usize>(pattern: &[u8; N], numbers: [(u32, u32); M]) -> [u8; N] {
    let (mut lanes, mut mask) = (0, 0);
    for (position, number) in numbers {
        lanes |= u64::from(number) << (8 * position);
        mask |= 0xf << (8 * position);
    }
    let tens = (lanes * 103) >> 10 & mask;
    let digits = (lanes << 8) - tens * (10 * 256 - 1);
    let mut word = [0; 8];
    word[..N].copy_from_slice(pattern);
    let word = (u64::from_le_bytes(word) | digits).to_le_bytes();
    core::array::from_fn(|index| word[index])
}

/// `GMT+0530`, for less than a day.
#[inline(always)]
pub(crate) fn gmt_offset(minutes: i32) -> [u8; 8] {
    let pattern = if minutes < 0 {
        b"GMT-0000"
    } else {
        b"GMT+0000"
    };
    let minutes = minutes.unsigned_abs();
    fill(pattern, [(4, minutes / 60 % 100), (6, minutes % 60)])
}

/// `+05:30`, for less than a day.
pub(crate) fn iso_offset(minutes: i32) -> [u8; 6] {
    let pattern = if minutes < 0 { b"-00:00" } else { b"+00:00" };
    let minutes = minutes.unsigned_abs();
    fill(pattern, [(1, minutes / 60 % 100), (4, minutes % 60)])
}

trait Output {
    fn put<const N: usize>(&mut self, ascii: [u8; N]);
}

impl<T: CodeUnit> Output for StringWriter<T> {
    #[inline(always)]
    fn put<const N: usize>(&mut self, ascii: [u8; N]) {
        self.push_slice(&ascii.map(T::from));
    }
}

struct Array<'a, T, const CAPACITY: usize> {
    units: &'a mut [T; CAPACITY],
    length: usize,
}

impl<T: CodeUnit, const CAPACITY: usize> Output for Array<'_, T, CAPACITY> {
    #[inline(always)]
    fn put<const N: usize>(&mut self, ascii: [u8; N]) {
        self.units[self.length..][..N].copy_from_slice(&ascii.map(T::from));
        self.length += N;
    }
}

trait Format {
    fn length(&self) -> usize;
    fn write(&self, out: &mut impl Output);

    #[inline(always)]
    fn write_to_array<T: CodeUnit, const N: usize>(&self, units: &mut [T; N]) -> usize {
        let mut array = Array { units, length: 0 };
        self.write(&mut array);
        array.length
    }

    #[inline(always)]
    fn writer<T: CodeUnit>(&self, additional: usize) -> StringWriter<T> {
        let mut writer = StringWriter::try_new(self.length() + additional)
            .unwrap_or_else(|_| bun_alloc::out_of_memory());
        self.write(&mut writer);
        writer
    }

    #[inline(always)]
    fn followed_by(&self, suffix: Text<'_>) -> StringRef {
        with_text!(suffix, |suffix| {
            let mut writer = self.writer(suffix.len());
            writer.push_slice(suffix);
            writer.finish()
        })
    }
}

/// At least four digits.
struct Year(i32);

impl Format for Year {
    #[inline(always)]
    fn length(&self) -> usize {
        let digits = self.0.unsigned_abs();
        4 + usize::from(self.0 < 0) + usize::from(digits > 9999) + usize::from(digits > 99_999)
    }

    #[inline(always)]
    fn write(&self, out: &mut impl Output) {
        let mut digits = self.0.unsigned_abs();
        if !(0..=9999).contains(&self.0) {
            if self.0 < 0 {
                out.put(*b"-");
            }
            let [first, second] = fill(b"00", [(0, digits / 10_000)]);
            if digits > 99_999 {
                out.put([first]);
            }
            if digits > 9999 {
                out.put([second]);
            }
            digits %= 10_000;
        }
        out.put(fill(b"0000", [(0, digits / 100), (2, digits % 100)]));
    }
}

#[inline(always)]
fn clock(fields: DateFields) -> [u8; 8] {
    let [hour, minute, second] = [fields.hour(), fields.minute(), fields.second()].map(u32::from);
    fill(b"00:00:00", [(0, hour), (3, minute), (6, second)])
}

struct DateString(DateFields);

impl Format for DateString {
    #[inline(always)]
    fn length(&self) -> usize {
        11 + Year(self.0.year()).length()
    }

    #[inline(always)]
    fn write(&self, out: &mut impl Output) {
        out.put(WEEK_DAYS[usize::from(self.0.week_day())]);
        out.put(MONTHS[usize::from(self.0.month())]);
        out.put(fill(b"00 ", [(0, self.0.day().into())]));
        Year(self.0.year()).write(out);
    }
}

/// TimeString, and TimeZoneString up to the name.
struct TimeString(DateFields);

impl Format for TimeString {
    #[inline(always)]
    fn length(&self) -> usize {
        17
    }

    #[inline(always)]
    fn write(&self, out: &mut impl Output) {
        out.put(clock(self.0));
        out.put(*b" ");
        out.put(gmt_offset(self.0.offset_minutes()));
    }
}

struct DateTimeString(DateFields);

impl Format for DateTimeString {
    #[inline(always)]
    fn length(&self) -> usize {
        DateString(self.0).length() + 1 + TimeString(self.0).length()
    }

    #[inline(always)]
    fn write(&self, out: &mut impl Output) {
        DateString(self.0).write(out);
        out.put(*b" ");
        TimeString(self.0).write(out);
    }
}

struct UtcString(DateFields);

impl Format for UtcString {
    #[inline(always)]
    fn length(&self) -> usize {
        25 + Year(self.0.year()).length()
    }

    #[inline(always)]
    fn write(&self, out: &mut impl Output) {
        let [first, second, third, _] = WEEK_DAYS[usize::from(self.0.week_day())];
        let pattern = [first, second, third, b',', b' ', b'0', b'0', b' '];
        out.put(fill(&pattern, [(5, self.0.day().into())]));
        out.put(MONTHS[usize::from(self.0.month())]);
        Year(self.0.year()).write(out);
        out.put(*b" ");
        out.put(clock(self.0));
        out.put(*b" GMT");
    }
}

struct IsoString(i64);

impl IsoString {
    #[inline(always)]
    fn has_extended_year(&self) -> bool {
        const START: i64 = days_from_civil(0, 1, 1) * DAY;
        const END: i64 = days_from_civil(10_000, 1, 1) * DAY;
        !(START..END).contains(&self.0)
    }
}

impl Format for IsoString {
    #[inline(always)]
    fn length(&self) -> usize {
        if self.has_extended_year() { 27 } else { 24 }
    }

    #[inline(always)]
    fn write(&self, out: &mut impl Output) {
        let (days, since_midnight) = split_at_midnight(self.0);
        let (signed_year, month, day) = year_month_day(days);
        let mut year = signed_year.unsigned_abs();
        if self.has_extended_year() {
            let pattern = if signed_year < 0 { b"-00" } else { b"+00" };
            out.put(fill(pattern, [(1, year / 10_000)]));
            year %= 10_000;
        }
        let [tenths, seconds, minutes, hour] =
            [100, 1000, 60_000, 3_600_000].map(|unit| since_midnight / unit);
        let numbers = [(0, year / 100), (2, year % 100), (5, month)];
        out.put(fill(b"0000-00-", numbers));
        let numbers = [(0, day), (3, hour), (6, minutes - hour * 60)];
        out.put(fill(b"00T00:00", numbers));
        let numbers = [
            (1, seconds - minutes * 60),
            (3, tenths - seconds * 10),
            (5, since_midnight - tenths * 100),
        ];
        out.put(fill(b":00.000Z", numbers));
    }
}

/// `Tue Feb 01 2022`
pub fn date_string(fields: DateFields) -> StringRef {
    DateString(fields).writer::<u8>(0).finish()
}

pub(crate) fn time_string(fields: DateFields, zone_name: Text<'_>) -> StringRef {
    TimeString(fields).followed_by(zone_name)
}

pub(crate) fn date_time_string(fields: DateFields, zone_name: Text<'_>) -> StringRef {
    DateTimeString(fields).followed_by(zone_name)
}

/// `Tue, 01 Feb 2022 13:05:09 GMT`, which for a year of four digits is the IMF-fixdate of RFC 9110.
pub fn utc_string(fields: DateFields) -> StringRef {
    UtcString(fields).writer::<u8>(0).finish()
}

/// `2022-02-01T13:05:09.123Z`. `None` if `time` is not in the range of time values.
pub fn iso_string(time: f64) -> Option<StringRef> {
    Some(IsoString(time_as_integer(time)?).writer::<u8>(0).finish())
}

/// Returns the length.
#[inline]
pub fn write_iso_string<T: CodeUnit>(
    time: f64,
    out: &mut [T; MAX_ISO_STRING_LENGTH],
) -> Option<usize> {
    Some(IsoString(time_as_integer(time)?).write_to_array(out))
}
