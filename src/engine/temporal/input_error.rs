use bun_engine_number::NumberText;
use bun_engine_text::{PropertyName, StringRef, Text, names};

use crate::{Error, ErrorKind};

/// A failure whose message can quote the input.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum InputError<'a> {
    Fixed(Error),
    Text(TextError, Text<'a>),
    Number(NumberError, f64),
    /// RequireInternalSlot failed in `Temporal.<class>.prototype.<member>`.
    Receiver {
        class: &'static str,
        member: PropertyName<'a>,
    },
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TextError {
    Calendar,
    Duration,
    FractionalSecondDigits,
    Instant,
    /// Quotes the digits of the BigInt.
    InstantEpochNanoseconds,
    MonthDay,
    Offset,
    RelativeTo,
    RelativeToOutOfRange,
    RelativeToTimeZone,
    TimeZone,
    YearMonth,
    ZonedDateTime,
    /// Quotes the digits of the BigInt.
    ZonedDateTimeEpochNanoseconds,
    ZonedDateTimeTimeZone,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NumberError {
    EpochMillisecondsNotInteger,
    EpochMillisecondsOutOfRange,
    FractionalSecondDigits,
    OverriddenClock,
}

const FRACTIONAL_SECOND_DIGITS: &str = "fractionalSecondDigits must be 'auto' or 0 through 9, not ";
const INVALID_TIME_ZONE_INSIDE: &str = "' contains an invalid time zone identifier";

impl TextError {
    /// What comes before the quotation, its greatest length, and what comes after it.
    const fn template(self) -> (&'static str, usize, &'static str) {
        match self {
            TextError::Calendar => ("'", 100, "' is not a valid calendar identifier"),
            TextError::Duration => ("'", 3090, "' is not a valid Duration string"),
            TextError::FractionalSecondDigits => (FRACTIONAL_SECOND_DIGITS, 100, ""),
            TextError::Instant => ("'", 100, "' is not a valid Temporal.Instant string"),
            TextError::InstantEpochNanoseconds => (
                "",
                100,
                " epoch nanoseconds is outside of the supported range for Temporal.Instant",
            ),
            TextError::MonthDay => (
                "Temporal.PlainMonthDay.from: invalid date string ",
                usize::MAX,
                "",
            ),
            TextError::Offset => ("'", 100, "' is not a valid UTC offset string"),
            TextError::RelativeTo => ("'", 200, "' is not a valid date or ZonedDateTime string"),
            TextError::RelativeToOutOfRange => (
                "'",
                200,
                "' is outside the representable range for a relativeTo parameter",
            ),
            TextError::RelativeToTimeZone => ("'", 200, INVALID_TIME_ZONE_INSIDE),
            TextError::TimeZone => ("'", 100, "' is not a valid time zone identifier"),
            TextError::YearMonth => (
                "Temporal.PlainYearMonth.from: invalid year-month string ",
                usize::MAX,
                "",
            ),
            TextError::ZonedDateTime => {
                ("'", 100, "' is not a valid Temporal.ZonedDateTime string")
            }
            TextError::ZonedDateTimeEpochNanoseconds => (
                "",
                100,
                " epoch nanoseconds is outside of the supported range for Temporal.ZonedDateTime",
            ),
            TextError::ZonedDateTimeTimeZone => ("'", 100, INVALID_TIME_ZONE_INSIDE),
        }
    }
}

impl NumberError {
    fn template(self, number: f64) -> (&'static str, NumberText, &'static str) {
        match self {
            NumberError::EpochMillisecondsNotInteger => (
                "",
                number.into(),
                " is not a valid integer number of epoch milliseconds",
            ),
            NumberError::EpochMillisecondsOutOfRange => (
                "",
                (number as i64).into(),
                "000000 epoch nanoseconds is outside of supported range for Temporal.Instant",
            ),
            NumberError::FractionalSecondDigits => (FRACTIONAL_SECOND_DIGITS, number.into(), ""),
            NumberError::OverriddenClock => (
                "Overridden current time ",
                number.into(),
                " ms is outside of supported range for Temporal.Now",
            ),
        }
    }
}

impl InputError<'_> {
    pub const fn kind(&self) -> ErrorKind {
        match self {
            InputError::Fixed(error) => error.kind(),
            InputError::Text(..) | InputError::Number(..) => ErrorKind::Range,
            InputError::Receiver { .. } => ErrorKind::Type,
        }
    }

    pub fn message(&self) -> StringRef {
        const ELLIPSIS: Text<'static> = Text::Utf16(&[0x2026]);
        match *self {
            InputError::Fixed(error) => StringRef::from_literal(error.message()),
            InputError::Text(error, text) => {
                let (before, limit, after) = error.template();
                if text.len() <= limit {
                    return sentence(before, [text, Text::EMPTY], after);
                }
                sentence(before, [text.slice(0..limit - 1), ELLIPSIS], after)
            }
            InputError::Number(error, number) => {
                let (before, digits, after) = error.template(number);
                sentence(before, [digits.text(), Text::EMPTY], after)
            }
            InputError::Receiver { class, member } => {
                let article = if member == names::toZonedDateTimeISO {
                    "an"
                } else {
                    "a"
                };
                let member = match class {
                    "PlainMonthDay" | "PlainYearMonth" if member == names::calendarId => {
                        names::calendar.text()
                    }
                    _ => member.text(),
                };
                StringRef::from_str(&format!(
                    "Temporal.{class}.prototype.{member} called on value that's not {article} {class}"
                ))
            }
        }
    }
}

/// Leaves the quotation out if it is too long for a string.
fn sentence(before: &'static str, quotation: [Text<'_>; 2], after: &'static str) -> StringRef {
    let [text, ellipsis] = quotation;
    let parts = [
        Text::from_ascii(before),
        text,
        ellipsis,
        Text::from_ascii(after),
    ];
    StringRef::try_concat(&parts)
        .unwrap_or_else(|_| StringRef::from_literal(before.trim_ascii_end()))
}

impl From<Error> for InputError<'_> {
    fn from(error: Error) -> Self {
        InputError::Fixed(error)
    }
}
