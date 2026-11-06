//! Shared parser for the wall-clock date/time text both SQL drivers receive
//! over their text protocols: `YYYY-MM-DD[[ |T]HH:MM:SS[.ffffff]]`.
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
    /// Astronomical: 1 BC is 0.
    pub(crate) year: i32,
    pub(crate) month: u8,
    pub(crate) day: u8,
    pub(crate) hour: u8,
    pub(crate) minute: u8,
    pub(crate) second: u8,
    /// Fractional seconds right-padded to microseconds (`.5` → 500_000).
    pub(crate) microsecond: u32,
}

/// Which bytes may separate the date from the time.
#[derive(Clone, Copy)]
enum Separator {
    Space,
    SpaceOrT,
}

pub(crate) fn parse_mysql(text: &[u8]) -> Option<DateTimeText> {
    let (dt, consumed) = parse(text, Separator::SpaceOrT)?;
    (consumed == text.len()).then_some(dt)
}

/// `DateStyle = ISO` text. The `±HH[:MM[:SS]]` offset comes back in seconds east of UTC, 0 if absent.
pub(crate) fn parse_postgres_timestamptz(text: &[u8]) -> Option<(DateTimeText, i32)> {
    let (dt, rest) = parse_postgres(text)?;
    let Some((&sign, offset)) = rest.split_first() else {
        return Some((dt, 0));
    };
    let sign: i32 = match sign {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let hours = parse_u(offset.get(0..2)?)?;
    let (minutes, seconds) = match offset.len() {
        2 => (0, 0),
        5 if offset[2] == b':' => (parse_u(&offset[3..5])?, 0),
        8 if offset[2] == b':' && offset[5] == b':' => {
            (parse_u(&offset[3..5])?, parse_u(&offset[6..8])?)
        }
        _ => return None,
    };
    if minutes > 59 || seconds > 59 {
        return None;
    }
    let offset_seconds = i32::try_from(hours * 3600 + minutes * 60 + seconds).ok()?;
    Some((dt, sign * offset_seconds))
}

/// Postgres prints a year before 1 AD as a positive number and ends the whole value with ` BC`.
fn parse_postgres(text: &[u8]) -> Option<(DateTimeText, &[u8])> {
    let (text, bc) = match text.strip_suffix(b" BC") {
        Some(text) => (text, true),
        None => (text, false),
    };
    let (mut dt, consumed) = parse(text, Separator::Space)?;
    if bc {
        dt.year = 1 - dt.year;
    }
    Some((dt, &text[consumed..]))
}

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

/// Returns the components and how many bytes of `text` they took.
fn parse(text: &[u8], separator: Separator) -> Option<(DateTimeText, usize)> {
    // Postgres pads the year to four digits and prints a longer one in full, up to 5874897.
    let year_len = text.iter().take_while(|c| c.is_ascii_digit()).count();
    if !(4..=7).contains(&year_len) {
        return None;
    }
    let (year, text) = text.split_at(year_len);
    if text.len() < 6 || text[0] != b'-' || text[3] != b'-' {
        return None;
    }
    let mut result = DateTimeText {
        year: i32::try_from(parse_u(year)?).ok()?,
        month: u8::try_from(parse_u(&text[1..3])?).ok()?,
        day: u8::try_from(parse_u(&text[4..6])?).ok()?,
        ..Default::default()
    };
    if text.len() == 6 {
        return Some((result, year_len + 6));
    }

    let separator_ok = match separator {
        Separator::Space => text[6] == b' ',
        Separator::SpaceOrT => text[6] == b' ' || text[6] == b'T',
    };
    if text.len() < 15 || !separator_ok || text[9] != b':' || text[12] != b':' {
        return None;
    }
    result.hour = u8::try_from(parse_u(&text[7..9])?).ok()?;
    result.minute = u8::try_from(parse_u(&text[10..12])?).ok()?;
    result.second = u8::try_from(parse_u(&text[13..15])?).ok()?;

    if text.len() == 15 || text[15] != b'.' {
        return Some((result, year_len + 15));
    }
    // Fractional seconds: up to 6 digits, right-padded to microseconds.
    let frac_len = text[16..].iter().take_while(|c| c.is_ascii_digit()).count();
    if frac_len == 0 || frac_len > 6 {
        return None;
    }
    let mut micro = parse_u(&text[16..16 + frac_len])?;
    for _ in 0..(6 - frac_len) {
        micro *= 10;
    }
    result.microsecond = micro;
    Some((result, year_len + 16 + frac_len))
}
