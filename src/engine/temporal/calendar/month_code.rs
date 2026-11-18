use bun_engine_text::{CodeUnit, PropertyName, Text, names};

use crate::{CalendarId, Error, Result};

/// In the order of the code units of its text.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct MonthCode(u8);

impl MonthCode {
    /// CreateMonthCode
    #[inline]
    pub(crate) const fn new(number: u8, is_leap_month: bool) -> MonthCode {
        MonthCode(number << 1 | is_leap_month as u8)
    }

    /// The part of ParseMonthCode that follows the conversion to a string.
    pub(crate) fn parse(text: Text<'_>) -> Result<MonthCode> {
        let is_leap_month = text.len() == 4 && text.at(3).is(b'L');
        if (text.len() == 3 || is_leap_month)
            && text.at(0).is(b'M')
            && let Some(tens) = text.at(1).digit_value(10)
            && let Some(ones) = text.at(2).digit_value(10)
            && (tens + ones > 0 || is_leap_month)
        {
            return Ok(MonthCode::new((tens * 10 + ones) as u8, is_leap_month));
        }
        Err(Error::InvalidMonthCode)
    }

    #[inline]
    pub(crate) const fn number(self) -> u8 {
        self.0 >> 1
    }

    #[inline]
    pub(crate) const fn is_leap_month(self) -> bool {
        self.0 & 1 == 1
    }

    /// Of a code that some calendar has.
    #[inline]
    pub(crate) fn name(self) -> PropertyName<'static> {
        use names::*;
        const NAMES: [PropertyName<'static>; 25] = [
            M01, M01L, M02, M02L, M03, M03L, M04, M04L, M05, M05L, M06, M06L, M07, M07L, M08, M08L,
            M09, M09L, M10, M10L, M11, M11L, M12, M12L, M13,
        ];
        NAMES[usize::from(self.0 - MonthCode::new(1, false).0)]
    }
}

impl CalendarId {
    /// IsValidMonthCodeForCalendar
    pub(super) fn has_month_code(self, code: MonthCode) -> bool {
        match (code.number(), code.is_leap_month()) {
            (1..=12, false) => true,
            (13, false) => matches!(
                self,
                CalendarId::Coptic | CalendarId::Ethioaa | CalendarId::Ethiopic
            ),
            (5, true) if self == CalendarId::Hebrew => true,
            (1..=12, true) => self.is_chinese_or_dangi(),
            _ => false,
        }
    }

    /// The month that stands in for a leap month in a year that lacks it.
    pub(super) fn substitute_for_leap_month(self, code: MonthCode) -> MonthCode {
        let skips_forward = self == CalendarId::Hebrew;
        MonthCode::new(code.number() + u8::from(skips_forward), false)
    }
}
