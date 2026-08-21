//! Shared parser for the wall-clock date/time text both SQL drivers receive
//! over their text protocols: `YYYY-MM-DD[ |T]HH:MM:SS[.ffffff]`.
//!
//! The text carries no timezone, so callers convert the parsed components with
//! UTC arithmetic to match their binary protocol paths. Routing these strings
//! through JS `Date.parse` instead would read the wall-clock as *local* time
//! and shift the value by the host's UTC offset.
//!
//! Only the structural form is validated here (digit positions, separators,
//! fraction length). Calendar/range validation is the caller's job: MySQL
//! rejects impossible dates itself (`DateTime::from_text`), while Postgres
//! delegates to `gregorian_date_time_to_ms_utc`.

/// Components of a parsed wall-clock timestamp.
#[derive(Default, Clone, Copy)]
pub struct DateTimeText {
    pub(crate) year: u16,
    pub(crate) month: u8,
    pub(crate) day: u8,
    pub(crate) hour: u8,
    pub(crate) minute: u8,
    pub(crate) second: u8,
    /// Fractional seconds right-padded to microseconds (`.5` → 500_000).
    pub(crate) microsecond: u32,
}

/// Whether the 10-byte date-only form (`YYYY-MM-DD`) parses, or only the full
/// date-and-time shape does.
#[derive(Clone, Copy)]
enum TimePart {
    Optional,
    Required,
}

/// Which bytes may separate the date from the time.
#[derive(Clone, Copy)]
enum Separator {
    Space,
    SpaceOrT,
}

/// MySQL DATE/DATETIME/TIMESTAMP text. Accepts the 10-byte date-only form
/// (`YYYY-MM-DD`) and either `' '` or `'T'` as the date/time separator.
pub(crate) fn parse_mysql(text: &[u8]) -> Option<DateTimeText> {
    parse(text, TimePart::Optional, Separator::SpaceOrT)
}

/// Postgres `timestamp` (WITHOUT TIME ZONE) text. Requires the full
/// `YYYY-MM-DD HH:MM:SS[.ffffff]` shape — anything else (date-only, `'T'`
/// separator, `infinity`, BC dates, 5+ digit years) returns `None` so the
/// caller can fall back to `Date.parse`.
pub(crate) fn parse_postgres_timestamp(text: &[u8]) -> Option<DateTimeText> {
    parse(text, TimePart::Required, Separator::Space)
}

fn parse(text: &[u8], time_part: TimePart, separator: Separator) -> Option<DateTimeText> {
    fn parse_u(bytes: &[u8]) -> Option<u32> {
        if bytes.is_empty() {
            return None;
        }
        let mut n: u32 = 0;
        for &c in bytes {
            if !c.is_ascii_digit() {
                return None;
            }
            n = n.checked_mul(10)?.checked_add(u32::from(c - b'0'))?;
        }
        Some(n)
    }

    if text.len() < 10 || text[4] != b'-' || text[7] != b'-' {
        return None;
    }
    let mut result = DateTimeText {
        year: u16::try_from(parse_u(&text[0..4])?).ok()?,
        month: u8::try_from(parse_u(&text[5..7])?).ok()?,
        day: u8::try_from(parse_u(&text[8..10])?).ok()?,
        ..Default::default()
    };
    if text.len() == 10 {
        return match time_part {
            TimePart::Optional => Some(result),
            TimePart::Required => None,
        };
    }

    let separator_ok = match separator {
        Separator::Space => text[10] == b' ',
        Separator::SpaceOrT => text[10] == b' ' || text[10] == b'T',
    };
    if text.len() < 19 || !separator_ok || text[13] != b':' || text[16] != b':' {
        return None;
    }
    result.hour = u8::try_from(parse_u(&text[11..13])?).ok()?;
    result.minute = u8::try_from(parse_u(&text[14..16])?).ok()?;
    result.second = u8::try_from(parse_u(&text[17..19])?).ok()?;

    if text.len() == 19 {
        return Some(result);
    }
    if text[19] != b'.' {
        return None;
    }
    // Fractional seconds: up to 6 digits, right-padded to microseconds.
    let frac = &text[20..];
    if frac.is_empty() || frac.len() > 6 {
        return None;
    }
    let mut micro = parse_u(frac)?;
    for _ in 0..(6 - frac.len()) {
        micro *= 10;
    }
    result.microsecond = micro;
    Some(result)
}
