//! Patterns whose fields are numbers or names for the Gregorian date and the time of day, or the name of the time zone.

use bun_engine_date::{CivilDate, civil_from_days, days_from_civil, week_day};
use bun_engine_temporal::CalendarId;

use super::components::Component;
use super::layout::FORMAT_FAILURE;
use super::locale_data::{LocaleData, Names};
use super::pattern::{self, Field};
use super::text::{DateText, use_plain_spaces};
use crate::error::IcuResult;
use crate::{PartKind, Result};

const MS_PER_SECOND: u32 = 1000;
const MS_PER_MINUTE: u32 = 60 * MS_PER_SECOND;
const MS_PER_HOUR: u32 = 60 * MS_PER_MINUTE;
const MS_PER_DAY: i64 = 24 * MS_PER_HOUR as i64;
/// More than a year has, or a pattern asks for.
const MAX_DIGITS: usize = 8;

struct LocalTime {
    days: i32,
    date: CivilDate,
    millisecond_of_day: u32,
}

#[derive(Clone, Copy)]
enum Number {
    Year,
    YearOfCentury,
    Month,
    Day,
    Hour0To11,
    Hour1To12,
    Hour0To23,
    Hour1To24,
    Minute,
    Second,
    /// Milliseconds divided by this.
    Fraction(u32),
}

impl Number {
    fn at(self, time: &LocalTime) -> u32 {
        let year = time.date.year;
        let year_of_era = if year > 0 { year } else { 1 - year }.unsigned_abs();
        let hour = time.millisecond_of_day / MS_PER_HOUR;
        match self {
            Number::Year => year_of_era,
            Number::YearOfCentury => year_of_era % 100,
            Number::Month => time.date.month.into(),
            Number::Day => time.date.day.into(),
            Number::Hour0To11 => hour % 12,
            Number::Hour1To12 => (hour + 11) % 12 + 1,
            Number::Hour0To23 => hour,
            Number::Hour1To24 => (hour + 23) % 24 + 1,
            Number::Minute => time.millisecond_of_day / MS_PER_MINUTE % 60,
            Number::Second => time.millisecond_of_day / MS_PER_SECOND % 60,
            Number::Fraction(divisor) => time.millisecond_of_day % MS_PER_SECOND / divisor,
        }
    }
}

#[derive(Clone, Copy)]
enum Name {
    Era,
    Month,
    Weekday,
    HalfOfDay,
}

impl Name {
    fn index_at(self, time: &LocalTime) -> usize {
        match self {
            Name::Era => usize::from(time.date.year > 0),
            Name::Month => usize::from(time.date.month) - 1,
            Name::Weekday => week_day(time.days).into(),
            Name::HalfOfDay => (time.millisecond_of_day / (12 * MS_PER_HOUR)) as usize,
        }
    }

    /// A time for each index.
    fn samples(self) -> impl Iterator<Item = f64> {
        let (count, first_day, step) = match self {
            Name::Era => (2, days_from_civil(0, 1, 1), 366 * MS_PER_DAY),
            Name::Month => (12, days_from_civil(1970, 1, 15), 30 * MS_PER_DAY),
            Name::Weekday => (7, days_from_civil(1970, 1, 4), MS_PER_DAY),
            Name::HalfOfDay => (2, 0, MS_PER_DAY / 2),
        };
        (0..count).map(move |index| (first_day * MS_PER_DAY + index * step) as f64)
    }
}

enum Item {
    Literal(Box<[u16]>),
    /// With the least count of digits.
    Number(Number, usize),
    Name(Name, Names),
    TimeZoneName,
}

impl Item {
    fn of_field(
        pattern: &[u16],
        field: Field,
        locale: &LocaleData,
    ) -> Result<Option<(PartKind, Item)>> {
        let count = field.range.len();
        let is_alone = || {
            pattern::fields(pattern)
                .all(|it| it.range == field.range || it.component() != field.component())
        };
        let number = |kind, number| Ok(Some((kind, Item::Number(number, count))));
        let (kind, name) = match (field.letter, count) {
            (b'y', 2) => return number(PartKind::Year, Number::YearOfCentury),
            (b'y', ..=MAX_DIGITS) => return number(PartKind::Year, Number::Year),
            (b'M' | b'L', ..=2) => return number(PartKind::Month, Number::Month),
            (b'd', ..=2) => return number(PartKind::Day, Number::Day),
            (b'K', ..=2) => return number(PartKind::Hour, Number::Hour0To11),
            (b'h', ..=2) => return number(PartKind::Hour, Number::Hour1To12),
            (b'H', ..=2) => return number(PartKind::Hour, Number::Hour0To23),
            (b'k', ..=2) => return number(PartKind::Hour, Number::Hour1To24),
            (b'm', ..=2) => return number(PartKind::Minute, Number::Minute),
            (b's', ..=2) => return number(PartKind::Second, Number::Second),
            (b'S', 1) => return number(PartKind::FractionalSecond, Number::Fraction(100)),
            (b'S', 2) => return number(PartKind::FractionalSecond, Number::Fraction(10)),
            (b'S', 3) => return number(PartKind::FractionalSecond, Number::Fraction(1)),
            (b'z' | b'O' | b'v', 1 | 4) if is_alone() => {
                return Ok(Some((PartKind::TimeZoneName, Item::TimeZoneName)));
            }
            (b'G', _) => (PartKind::Era, Name::Era),
            (b'M' | b'L', 3..=5) => (PartKind::Month, Name::Month),
            (b'E', _) | (b'c' | b'e', 3..) => (PartKind::Weekday, Name::Weekday),
            (b'a', _) => (PartKind::DayPeriod, Name::HalfOfDay),
            _ => return Ok(None),
        };
        let names =
            (locale.names(&pattern[field.range], name.samples())).or_type_error(FORMAT_FAILURE)?;
        // Without the field, the text on both sides of it would be one part.
        let is_complete = names.iter().all(|it| !it.is_empty());
        Ok(is_complete.then_some((kind, Item::Name(name, names))))
    }
}

pub(super) struct Template {
    items: Vec<(PartKind, Item)>,
    /// Unless they are ASCII.
    digits: Option<Names>,
    time_zone_field: Option<Box<[u16]>>,
    /// No text is longer, the name of the time zone aside.
    capacity: usize,
}

fn longest(names: &Names) -> usize {
    names.iter().map(|it| it.len()).max().unwrap_or(0)
}

struct Cursor<'a> {
    units: &'a mut [u16],
    length: usize,
}

impl Cursor<'_> {
    #[inline(always)]
    fn push(&mut self, unit: u16) {
        self.units[self.length] = unit;
        self.length += 1;
    }

    #[inline(always)]
    fn push_all(&mut self, units: &[u16]) {
        units.iter().for_each(|&unit| self.push(unit));
    }
}

impl Template {
    pub(super) fn new(pattern: &[u16], locale: &LocaleData) -> Result<Option<Template>> {
        let depends_on_calendar = |field: Field| {
            use Component::*;
            matches!(field.component(), Some(Era | Year | Month | Day))
        };
        if pattern::fields(pattern).any(depends_on_calendar)
            && !matches!(
                locale.calendar()?,
                CalendarId::Gregory | CalendarId::Iso8601
            )
        {
            return Ok(None);
        }

        let mut items = Vec::new();
        let literal = |quoted| {
            let mut literal: Box<[u16]> = pattern::unquote(quoted).collect();
            use_plain_spaces(&mut literal);
            (!literal.is_empty()).then_some((PartKind::Literal, Item::Literal(literal)))
        };
        let mut done = 0;
        for field in pattern::fields(pattern) {
            items.extend(literal(&pattern[done..field.range.start]));
            done = field.range.end;
            let Some(item) = Item::of_field(pattern, field, locale)? else {
                return Ok(None);
            };
            items.push(item);
        }
        items.extend(literal(&pattern[done..]));

        let digits = if locale.numbering_system()?.as_bytes() == b"latn" {
            None
        } else {
            let seconds = (0..10).map(|second| f64::from(second * MS_PER_SECOND));
            Some((locale.names(&[b's'.into()], seconds)).or_type_error(FORMAT_FAILURE)?)
        };
        let digit_length = digits.as_ref().map_or(1, longest);
        let capacity = items.iter().map(|(_, item)| match item {
            Item::Literal(literal) => literal.len(),
            Item::Number(..) => MAX_DIGITS * digit_length,
            Item::Name(_, names) => longest(names),
            Item::TimeZoneName => 0,
        });
        let time_zone_field = pattern::fields(pattern)
            .find(|field| field.component() == Some(Component::TimeZoneName))
            .map(|field| pattern[field.range].into());
        let template = Template {
            capacity: capacity.sum(),
            items,
            digits,
            time_zone_field,
        };
        // The library of macOS has rules of its own for some locales.
        if cfg!(target_os = "macos") && !template.reads_like_icu(pattern, locale)? {
            return Ok(None);
        }
        debug_assert_eq!(template.reads_like_icu(pattern, locale), Ok(true));
        Ok(Some(template))
    }

    fn reads_like_icu(&self, pattern: &[u16], locale: &LocaleData) -> Result<bool> {
        /// 2001-02-03T04:05:06.007Z
        const TIME: i64 = 981_173_106_007;

        let icu_text =
            |pattern| (locale.text_in_utc(pattern, TIME as f64)).or_type_error(FORMAT_FAILURE);
        let zone_name = icu_text(self.time_zone_field().unwrap_or_default())?;
        let compare = |text: &[u16]| Ok(*text == *icu_text(pattern)?);
        self.write(TIME, &zone_name, |_, _| Ok(()), compare)
    }

    /// As a pattern of its own.
    pub(super) fn time_zone_field(&self) -> Option<&[u16]> {
        self.time_zone_field.as_deref()
    }

    /// `local_time` is what a clock shows, in milliseconds since it showed the epoch.
    #[inline]
    pub(super) fn write<T>(
        &self,
        local_time: i64,
        time_zone_name: &[u16],
        mut each_part: impl FnMut(PartKind, &[u16]) -> Result<()>,
        whole: impl FnOnce(&[u16]) -> Result<T>,
    ) -> Result<T> {
        let days = local_time.div_euclid(MS_PER_DAY) as i32;
        let time = LocalTime {
            days,
            date: civil_from_days(days),
            millisecond_of_day: local_time.rem_euclid(MS_PER_DAY) as u32,
        };
        let mut buffer = DateText::from_buf([0; _]);
        let capacity = self.capacity + time_zone_name.len();
        if capacity > buffer.len() {
            buffer.resize(capacity, 0);
        }
        let mut out = Cursor {
            units: &mut buffer,
            length: 0,
        };
        for (kind, item) in &self.items {
            let start = out.length;
            match item {
                Item::Literal(literal) => out.push_all(literal),
                Item::Number(number, count) => {
                    self.push_number(number.at(&time), *count, &mut out);
                }
                Item::Name(name, names) => out.push_all(&names[name.index_at(&time)]),
                Item::TimeZoneName => out.push_all(time_zone_name),
            }
            each_part(*kind, &out.units[start..out.length])?;
        }
        whole(&out.units[..out.length])
    }

    #[inline(always)]
    fn push_number(&self, number: u32, least_count: usize, out: &mut Cursor<'_>) {
        if number >= 100 || least_count > 2 || self.digits.is_some() {
            return self.push_any_number(number, least_count, out);
        }
        out.push(u16::from(b'0') + (number / 10) as u16);
        out.length -= usize::from(number < 10 && least_count < 2);
        out.push(u16::from(b'0') + (number % 10) as u16);
    }

    fn push_any_number(&self, mut number: u32, least_count: usize, out: &mut Cursor<'_>) {
        let mut digits = [0; MAX_DIGITS];
        let mut start = MAX_DIGITS;
        while number != 0 {
            start -= 1;
            digits[start] = (number % 10) as u8;
            number /= 10;
        }
        for &digit in &digits[start.min(MAX_DIGITS - least_count)..] {
            match &self.digits {
                None => out.push((b'0' + digit).into()),
                Some(names) => out.push_all(&names[usize::from(digit)]),
            }
        }
    }
}
