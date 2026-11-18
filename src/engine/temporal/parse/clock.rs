use bun_engine_text::{CodeUnit, Text, with_text};

use super::cursor::Cursor;
use crate::PlainTime;
use crate::unit::NANOSECONDS_PER_SECOND;

/// What follows a time.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Offset {
    Absent,
    /// UTCDesignator
    Utc,
    Numeric {
        nanoseconds: i64,
        has_seconds: bool,
    },
}

/// ParseDateTimeUTCOffset
pub(crate) fn utc_offset(text: Text<'_>) -> Option<i64> {
    with_text!(text, |units| Cursor::parse_all(units, Cursor::utc_offset))
        .map(|(nanoseconds, _)| nanoseconds)
}

impl<T: CodeUnit> Cursor<'_, T> {
    /// Nanoseconds since midnight, and whether seconds were written.
    #[inline(always)]
    fn clock(&mut self, last_second: u8) -> Option<(i64, bool)> {
        let mut seconds = u32::from(self.two_digits_up_to(23)?) * 3600;
        let mut fraction = 0;
        let mut has_seconds = false;
        let is_extended = self.eat(b':');
        if is_extended || self.peek().is_ascii_digit() {
            seconds += u32::from(self.two_digits_up_to(59)?) * 60;
            has_seconds = if is_extended {
                self.eat(b':')
            } else {
                self.peek().is_ascii_digit()
            };
        }
        if has_seconds {
            seconds += u32::from(self.two_digits_up_to(last_second)?.min(59));
            fraction = self.fraction()?.unwrap_or(0);
        }
        let nanoseconds = i64::from(seconds) * NANOSECONDS_PER_SECOND + i64::from(fraction);
        Some((nanoseconds, has_seconds))
    }

    #[inline(always)]
    pub(super) fn time(&mut self) -> Option<PlainTime> {
        let (nanoseconds, _) = self.clock(60)?;
        Some(PlainTime::from_nanosecond_of_day(nanoseconds))
    }

    pub(super) fn utc_offset(&mut self) -> Option<(i64, bool)> {
        let sign = self.sign()?;
        let (nanoseconds, has_seconds) = self.clock(59)?;
        Some((i64::from(sign) * nanoseconds, has_seconds))
    }

    /// An optional DateTimeUTCOffset.
    #[inline(always)]
    pub(super) fn date_time_offset(&mut self) -> Option<Offset> {
        if self.eat_letter(b'Z') {
            return Some(Offset::Utc);
        }
        if !matches!(self.peek(), b'+' | b'-') {
            return Some(Offset::Absent);
        }
        let (nanoseconds, has_seconds) = self.utc_offset()?;
        Some(Offset::Numeric {
            nanoseconds,
            has_seconds,
        })
    }
}
