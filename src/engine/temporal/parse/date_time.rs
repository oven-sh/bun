use bun_engine_date::days_in_month;
use bun_engine_text::{CodeUnit, Text, with_text};

use super::cursor::Cursor;
use super::{Annotations, Offset};
use crate::calendar::ISO_REFERENCE_YEAR;
use crate::{IsoDate, IsoDateTime, PlainTime};

/// An ISO Date-Time Parse Record.
#[derive(Clone, Copy)]
pub(crate) struct DateTime<'a> {
    /// Means nothing if only a time was written.
    pub(crate) date: IsoDate,
    pub(crate) time: Option<PlainTime>,
    pub(crate) offset: Offset,
    pub(crate) annotations: Annotations<'a>,
}

/// Defines a function that matches all of a text with the method of `Cursor` of the same name.
macro_rules! productions {
    ($($name:ident,)*) => {$(
        #[inline(always)]
        fn $name(text: Text<'_>) -> Option<DateTime<'_>> {
            fn fill<'a>(text: Text<'a>, parsed: &mut DateTime<'a>) -> Option<()> {
                with_text!(text, |units| Cursor::parse_all(units, |it| it.$name(parsed)))
            }
            let mut parsed = DateTime {
                date: IsoDate::MIN,
                time: None,
                offset: Offset::Absent,
                annotations: Annotations::default(),
            };
            fill(text, &mut parsed).map(|()| parsed)
        }
    )*};
}

productions! {
    annotated_date_time,
    annotated_month_day,
    annotated_time,
    annotated_year_month,
}

#[inline(always)]
fn date_time_in_calendar(text: Text<'_>) -> Option<DateTime<'_>> {
    annotated_date_time(text).filter(|parsed| parsed.annotations.can_name_calendar())
}

/// TemporalDateTimeString[~Zoned]
#[inline(always)]
pub(crate) fn plain_date_time(text: Text<'_>) -> Option<DateTime<'_>> {
    date_time_in_calendar(text).filter(|parsed| parsed.offset != Offset::Utc)
}

/// TemporalDateTimeString[+Zoned]
#[inline(always)]
pub(crate) fn zoned_date_time(text: Text<'_>) -> Option<DateTime<'_>> {
    date_time_in_calendar(text).filter(|parsed| parsed.annotations.time_zone.is_some())
}

/// Either kind of TemporalDateTimeString.
#[inline(always)]
pub(crate) fn relative_to(text: Text<'_>) -> Option<DateTime<'_>> {
    date_time_in_calendar(text)
        .filter(|parsed| parsed.offset != Offset::Utc || parsed.annotations.time_zone.is_some())
}

/// TemporalInstantString, with the offset in nanoseconds.
#[inline(always)]
pub(crate) fn instant(text: Text<'_>) -> Option<(IsoDateTime, i64)> {
    let parsed = annotated_date_time(text)?;
    let offset = match parsed.offset {
        Offset::Absent => return None,
        Offset::Utc => 0,
        Offset::Numeric { nanoseconds, .. } => nanoseconds,
    };
    let (date, time) = (parsed.date, parsed.time?);
    Some((IsoDateTime { date, time }, offset))
}

/// TemporalTimeString
#[inline(always)]
pub(crate) fn time(text: Text<'_>) -> Option<PlainTime> {
    if let Some(parsed) = annotated_time(text) {
        return parsed.time;
    }
    annotated_date_time(text)
        .filter(|parsed| parsed.offset != Offset::Utc)?
        .time
}

/// TemporalYearMonthString. The day is 1 if it is not written.
pub(crate) fn year_month(text: Text<'_>) -> Option<DateTime<'_>> {
    annotated_year_month(text).or_else(|| plain_date_time(text))
}

/// TemporalMonthDayString. The year is a leap year if it is not written.
pub(crate) fn month_day(text: Text<'_>) -> Option<DateTime<'_>> {
    annotated_month_day(text).or_else(|| plain_date_time(text))
}

/// For ParseTemporalCalendarString and ParseTemporalTimeZoneString.
pub(crate) fn any_date_or_time(text: Text<'_>) -> Option<DateTime<'_>> {
    annotated_date_time(text)
        .or_else(|| annotated_year_month(text))
        .or_else(|| annotated_month_day(text))
        .or_else(|| annotated_time(text))
}

impl<'a, T: CodeUnit> Cursor<'a, T> {
    #[inline(always)]
    fn year(&mut self) -> Option<i32> {
        let sign = self.sign();
        let mut year = i32::from(self.two_digits()?) * 100 + i32::from(self.two_digits()?);
        if let Some(sign) = sign {
            year = (year * 100 + i32::from(self.two_digits()?)) * i32::from(sign);
            if year == 0 && sign < 0 {
                return None;
            }
        }
        Some(year)
    }

    #[inline(always)]
    fn month(&mut self) -> Option<u8> {
        self.two_digits_up_to(12).filter(|&month| month != 0)
    }

    #[inline(always)]
    fn day_of(&mut self, year: i32, month: u8) -> Option<IsoDate> {
        let day = self.two_digits_up_to(days_in_month(year, month))?;
        (day != 0).then(|| IsoDate::from_valid(year, month, day))
    }

    #[inline(always)]
    fn date(&mut self) -> Option<IsoDate> {
        let year = self.year()?;
        let is_extended = self.eat(b'-');
        let month = self.month()?;
        if is_extended {
            self.expect(b'-')?;
        }
        self.day_of(year, month)
    }

    /// DateSpecYearMonth
    fn year_month(&mut self) -> Option<IsoDate> {
        let year = self.year()?;
        self.eat(b'-');
        Some(IsoDate::from_valid(year, self.month()?, 1))
    }

    /// DateSpecMonthDay
    fn month_day(&mut self) -> Option<IsoDate> {
        if self.eat(b'-') {
            self.expect(b'-')?;
        }
        let month = self.month()?;
        self.eat(b'-');
        self.day_of(ISO_REFERENCE_YEAR, month)
    }

    #[inline(always)]
    fn annotated_date_time(&mut self, parsed: &mut DateTime<'a>) -> Option<()> {
        parsed.date = self.date()?;
        if self.eat_if(|next| matches!(next, b'T' | b't' | b' ')) {
            parsed.time = Some(self.time()?);
            parsed.offset = self.date_time_offset()?;
        }
        self.annotations(&mut parsed.annotations)
    }

    fn annotated_year_month(&mut self, parsed: &mut DateTime<'a>) -> Option<()> {
        parsed.date = self.year_month()?;
        self.annotations_of_iso_calendar(&mut parsed.annotations)
    }

    fn annotated_month_day(&mut self, parsed: &mut DateTime<'a>) -> Option<()> {
        parsed.date = self.month_day()?;
        self.annotations_of_iso_calendar(&mut parsed.annotations)
    }

    fn annotations_of_iso_calendar(&mut self, annotations: &mut Annotations<'a>) -> Option<()> {
        self.annotations(annotations)?;
        annotations.is_iso_calendar().then_some(())
    }

    #[inline(always)]
    fn annotated_time(&mut self, parsed: &mut DateTime<'a>) -> Option<()> {
        let start = *self;
        let has_designator = self.eat_letter(b'T');
        parsed.time = Some(self.time()?);
        parsed.offset = self.date_time_offset().filter(|&it| it != Offset::Utc)?;
        if !has_designator
            && (start.reads_as(Cursor::month_day) || start.reads_as(Cursor::year_month))
        {
            return None;
        }
        self.annotations(&mut parsed.annotations)
    }

    /// Whether `part` accepts everything before the annotations.
    fn reads_as(mut self, part: impl FnOnce(&mut Self) -> Option<IsoDate>) -> bool {
        part(&mut self).is_some() && matches!(self.peek(), b'[' | 0)
    }
}
