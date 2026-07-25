//! Shared parser for the ISO date/time text both SQL drivers receive over
//! their text protocols: `YYYY-MM-DD[ |T]HH:MM:SS[.ffffff]` plus, for Postgres
//! `timestamptz`, a trailing `[+-]HH[:MM[:SS]]` offset.
//!
//! Callers convert the parsed components with UTC arithmetic to match their
//! binary protocol paths. Routing these strings through JS `Date.parse` is
//! wrong: the space separator makes JSC take its non-ISO heuristic path, which
//! reads a zoneless wall-clock as *local* time and maps years 0001..0099 into
//! the 20th/21st century.
//!
//! Only the structural form is validated here (digit positions, separators,
//! fraction length). Calendar/range validation is the caller's job: MySQL
//! rejects impossible dates itself (`DateTime::from_text`), while Postgres
//! delegates to `gregorian_date_time_to_ms_utc`.

/// Components of a parsed wall-clock timestamp.
#[derive(Default, Clone, Copy)]
pub struct DateTimeText {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
    /// Fractional seconds right-padded to microseconds (`.5` → 500_000).
    pub microsecond: u32,
}

/// MySQL DATE/DATETIME/TIMESTAMP text. Accepts the 10-byte date-only form
/// (`YYYY-MM-DD`) and either `' '` or `'T'` as the date/time separator.
pub fn parse_mysql(text: &[u8]) -> Option<DateTimeText> {
    let (dt, consumed) = parse(text, true, true)?;
    (consumed == text.len()).then_some(dt)
}

/// Postgres `timestamp` (WITHOUT TIME ZONE) text. Requires the full
/// `YYYY-MM-DD HH:MM:SS[.ffffff]` shape — anything else (date-only, `'T'`
/// separator, `infinity`, BC dates, 5+ digit years) returns `None` so the
/// caller can fall back to `Date.parse`.
pub fn parse_postgres_timestamp(text: &[u8]) -> Option<DateTimeText> {
    let (dt, consumed) = parse(text, false, false)?;
    (consumed == text.len()).then_some(dt)
}

/// Postgres `timestamptz` text: `YYYY-MM-DD HH:MM:SS[.ffffff][+-]HH[:MM[:SS]]`.
/// Returns the wall-clock components and the UTC offset in seconds (positive
/// east of UTC). Anything outside this exact shape (BC dates, 5+ digit years,
/// missing offset) returns `None` so the caller can fall back to `Date.parse`.
pub fn parse_postgres_timestamptz(text: &[u8]) -> Option<(DateTimeText, i32)> {
    let (dt, consumed) = parse(text, false, false)?;
    let tail = text.get(consumed..)?;
    let (&sign, rest) = tail.split_first()?;
    let sign: i32 = match sign {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    // Offset is `HH`, `HH:MM` or `HH:MM:SS` (Postgres emits seconds for
    // pre-standardization zones).
    let hh = parse_u(rest.get(0..2)?)? as i32;
    let (mm, ss) = match rest.len() {
        2 => (0, 0),
        5 if rest[2] == b':' => (parse_u(&rest[3..5])? as i32, 0),
        8 if rest[2] == b':' && rest[5] == b':' => {
            (parse_u(&rest[3..5])? as i32, parse_u(&rest[6..8])? as i32)
        }
        _ => return None,
    };
    Some((dt, sign * (hh * 3600 + mm * 60 + ss)))
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

/// Parses `YYYY-MM-DD[ HH:MM:SS[.ffffff]]` from the head of `text`, returning
/// the parsed components and the number of bytes consumed. Trailing bytes are
/// left for the caller (the MySQL and naive-timestamp wrappers require none;
/// the timestamptz wrapper parses the UTC offset from them).
fn parse(
    text: &[u8],
    allow_date_only: bool,
    allow_t_separator: bool,
) -> Option<(DateTimeText, usize)> {
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
        return if allow_date_only { Some((result, 10)) } else { None };
    }

    let separator_ok = text[10] == b' ' || (allow_t_separator && text[10] == b'T');
    if text.len() < 19 || !separator_ok || text[13] != b':' || text[16] != b':' {
        return None;
    }
    result.hour = u8::try_from(parse_u(&text[11..13])?).ok()?;
    result.minute = u8::try_from(parse_u(&text[14..16])?).ok()?;
    result.second = u8::try_from(parse_u(&text[17..19])?).ok()?;

    if text.len() == 19 || text[19] != b'.' {
        return Some((result, 19));
    }
    // Fractional seconds: up to 6 digits, right-padded to microseconds.
    let frac_digits = text[20..].iter().take_while(|b| b.is_ascii_digit()).count();
    if frac_digits == 0 || frac_digits > 6 {
        return None;
    }
    let mut micro = parse_u(&text[20..20 + frac_digits])?;
    for _ in 0..(6 - frac_digits) {
        micro *= 10;
    }
    result.microsecond = micro;
    Some((result, 20 + frac_digits))
}
