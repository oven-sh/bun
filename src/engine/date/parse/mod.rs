mod cookie;
mod cursor;
mod free_form;
mod iso;

use bun_engine_text::{CodeUnit, Text, with_text};

pub use cookie::parse_cookie_date;
use cursor::{Cursor, Spaces};
use iso::Attempt;

use crate::time_value::time_clip_integer;

/// In milliseconds since the epoch, and not clipped.
#[derive(Clone, Copy)]
pub(crate) enum Parsed {
    Utc(i64),
    /// The text names no zone.
    Local(i64),
}

/// The Date Time String Format of ECMA-262, and failing that what scripts have long been able to pass to `Date.parse`.
#[inline(never)]
fn parse<T: CodeUnit>(text: &[T], spaces: Spaces) -> Option<Parsed> {
    let mut cursor = Cursor::new(text, spaces);
    match iso::parse(&mut cursor) {
        Attempt::Complete(parsed) => Some(parsed),
        Attempt::Invalid => None,
        Attempt::Unfinished { numbers, count } => free_form::parse(cursor, numbers, count),
    }
}

#[inline]
pub(crate) fn parse_date(text: Text<'_>) -> Option<Parsed> {
    with_text!(text, |units| parse(units, Spaces::Unicode))
}

/// `Date.parse` for UTF-8 from outside of scripts. White space is ASCII, and a text that names no zone is in UTC.
pub fn parse_date_as_utc(bytes: &[u8]) -> f64 {
    match parse(bytes, Spaces::Ascii) {
        Some(Parsed::Utc(time) | Parsed::Local(time)) => time_clip_integer(time),
        None => f64::NAN,
    }
}
