//! Cron expression parser and next-occurrence calculator.
//!
//! Parses standard 5-field cron expressions (minute hour day month weekday)
//! into a bitset representation, and computes the next matching UTC time.
//!
//! Supports:
//!   - Wildcards: *
//!   - Lists: 1,3,5
//!   - Ranges: 1-5
//!   - Steps: */15, 1-30/2
//!   - Named days: SUN-SAT, Sun-Sat, Sunday-Saturday (case-insensitive)
//!   - Named months: JAN-DEC, Jan-Dec, January-December (case-insensitive)
//!   - Sunday as 7: weekday field accepts 7 as alias for 0
//!   - Nicknames: @yearly, @annually, @monthly, @weekly, @daily, @midnight, @hourly

use bun_jsc::{JSGlobalObject, JsResult};
use bun_str::strings;
use phf::phf_map;

#[derive(Clone, Copy)]
pub struct CronExpression {
    pub minutes: u64, // bits 0-59
    pub hours: u32,   // bits 0-23
    pub days: u32,    // bits 1-31
    pub months: u16,  // bits 1-12
    pub weekdays: u8, // bits 0-6 (0=Sunday)
    pub days_is_wildcard: bool,     // true if day-of-month field was *
    pub weekdays_is_wildcard: bool, // true if weekday field was *
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum CronError {
    #[error("InvalidField")]
    InvalidField,
    #[error("InvalidStep")]
    InvalidStep,
    #[error("InvalidRange")]
    InvalidRange,
    #[error("InvalidNumber")]
    InvalidNumber,
    #[error("TooManyFields")]
    TooManyFields,
    #[error("TooFewFields")]
    TooFewFields,
}

impl From<CronError> for bun_core::Error {
    fn from(e: CronError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

impl CronExpression {
    pub fn error_message(e: CronError) -> &'static [u8] {
        match e {
            CronError::TooFewFields => b"Invalid cron expression: expected 5 space-separated fields (minute hour day month weekday)",
            CronError::TooManyFields => b"Invalid cron expression: too many fields. Bun.cron uses 5 fields (minute hour day month weekday) \xe2\x80\x94 seconds are not supported",
            CronError::InvalidStep => b"Invalid cron expression: step value must be a positive integer",
            CronError::InvalidRange => b"Invalid cron expression: range must be ascending (use 'a,b' or 'a-max,0-b' for wrap-around)",
            CronError::InvalidNumber => b"Invalid cron expression: value out of range for field",
            CronError::InvalidField => b"Invalid cron expression: unrecognized field syntax",
        }
    }

    /// Parse a 5-field cron expression or predefined nickname into a CronExpression.
    pub fn parse(input: &[u8]) -> Result<CronExpression, CronError> {
        let expr = strings::trim(input, b" \t");

        // Check for predefined nicknames
        if !expr.is_empty() && expr[0] == b'@' {
            return parse_nickname(expr).ok_or(CronError::InvalidField);
        }

        let mut count: usize = 0;
        let mut fields: [&[u8]; 5] = [&[]; 5];
        let mut iter = expr
            .split(|b| *b == b' ' || *b == b'\t')
            .filter(|s| !s.is_empty());
        while let Some(field) = iter.next() {
            if count >= 5 {
                return Err(CronError::TooManyFields);
            }
            fields[count] = field;
            count += 1;
        }
        if count != 5 {
            return Err(CronError::TooFewFields);
        }

        Ok(CronExpression {
            minutes: parse_field::<u64>(fields[0], 0, 59, NameKind::None)?,
            hours: parse_field::<u32>(fields[1], 0, 23, NameKind::None)?,
            days: parse_field::<u32>(fields[2], 1, 31, NameKind::None)?,
            months: parse_field::<u16>(fields[3], 1, 12, NameKind::Month)?,
            weekdays: parse_field::<u8>(fields[4], 0, 7, NameKind::Weekday)?,
            days_is_wildcard: fields[2] == b"*",
            weekdays_is_wildcard: fields[4] == b"*",
        })
    }

    /// Validate a cron expression string without allocating.
    pub fn validate(expr: &[u8]) -> bool {
        Self::parse(expr).is_ok()
    }

    /// Format the expression as a normalized numeric "M H D Mo W" string
    /// suitable for crontab. Returns the written slice of `buf`.
    pub fn format_numeric<'a>(&self, buf: &'a mut [u8; 512]) -> &'a [u8] {
        use std::io::Write;
        let written = {
            let mut w: &mut [u8] = &mut buf[..];
            let start = w.len();
            format_bitfield(&mut w, self.minutes, 0, 59);
            w.write_all(b" ").expect("unreachable");
            format_bitfield(&mut w, self.hours, 0, 23);
            w.write_all(b" ").expect("unreachable");
            format_bitfield(&mut w, self.days, 1, 31);
            w.write_all(b" ").expect("unreachable");
            format_bitfield(&mut w, self.months, 1, 12);
            w.write_all(b" ").expect("unreachable");
            format_bitfield(&mut w, self.weekdays, 0, 6);
            start - w.len()
        };
        &buf[..written]
    }

    /// Compute the next UTC time (in ms since epoch) that matches this
    /// expression, strictly after `from_ms`. Returns None if no match found
    /// within 8 years.
    pub fn next(&self, global_object: &JSGlobalObject, from_ms: f64) -> JsResult<Option<f64>> {
        // TODO(port): GregorianDateTime field types assumed i32; verify in bun_jsc
        let mut dt = global_object.ms_to_gregorian_date_time_utc(from_ms);
        let start_year = dt.year;
        dt.minute += 1;
        dt.second = 0;

        while dt.year - start_year <= 8 {
            // Normalize overflow + recompute weekday via a UTC round-trip.
            dt = global_object.ms_to_gregorian_date_time_utc(
                global_object
                    .gregorian_date_time_to_ms_utc(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second, 0)?,
            );

            if !bit_set(self.months, u32::try_from(dt.month).unwrap()) {
                dt.month += 1;
                dt.day = 1;
                dt.hour = 0;
                dt.minute = 0;
                continue;
            }
            // POSIX: if both DOM and DOW are restricted (not `*`), either
            // matching is enough; otherwise the `*` field matches all anyway.
            let day_ok = bit_set(self.days, u32::try_from(dt.day).unwrap());
            let weekday_ok = bit_set(self.weekdays, u32::try_from(dt.weekday).unwrap());
            let day_match = if !self.days_is_wildcard && !self.weekdays_is_wildcard {
                day_ok || weekday_ok
            } else {
                day_ok && weekday_ok
            };
            if !day_match {
                dt.day += 1;
                dt.hour = 0;
                dt.minute = 0;
                continue;
            }
            if !bit_set(self.hours, u32::try_from(dt.hour).unwrap()) {
                dt.hour += 1;
                dt.minute = 0;
                continue;
            }
            if !bit_set(self.minutes, u32::try_from(dt.minute).unwrap()) {
                dt.minute += 1;
                continue;
            }

            return Ok(Some(
                global_object
                    .gregorian_date_time_to_ms_utc(dt.year, dt.month, dt.day, dt.hour, dt.minute, 0, 0)?,
            ));
        }
        Ok(None)
    }
}

// ============================================================================
// Name lookup tables
// ============================================================================

const ALL_HOURS: u32 = (1 << 24) - 1;
pub const ALL_DAYS: u32 = ((1u64 << 32) - 1) as u32 & !1u32;
pub const ALL_MONTHS: u16 = ((1u32 << 13) - 1) as u16 & !1u16;
pub const ALL_WEEKDAYS: u8 = (1 << 7) - 1;

fn parse_nickname(expr: &[u8]) -> Option<CronExpression> {
    use bun_str::strings::eql_case_insensitive_asciii_check_length as eql;
    if eql(expr, b"@yearly") || eql(expr, b"@annually") {
        return Some(CronExpression { minutes: 1, hours: 1, days: 1 << 1, months: 1 << 1, weekdays: ALL_WEEKDAYS, days_is_wildcard: false, weekdays_is_wildcard: true });
    }
    if eql(expr, b"@monthly") {
        return Some(CronExpression { minutes: 1, hours: 1, days: 1 << 1, months: ALL_MONTHS, weekdays: ALL_WEEKDAYS, days_is_wildcard: false, weekdays_is_wildcard: true });
    }
    if eql(expr, b"@weekly") {
        return Some(CronExpression { minutes: 1, hours: 1, days: ALL_DAYS, months: ALL_MONTHS, weekdays: 1, days_is_wildcard: true, weekdays_is_wildcard: false });
    }
    if eql(expr, b"@daily") || eql(expr, b"@midnight") {
        return Some(CronExpression { minutes: 1, hours: 1, days: ALL_DAYS, months: ALL_MONTHS, weekdays: ALL_WEEKDAYS, days_is_wildcard: true, weekdays_is_wildcard: true });
    }
    if eql(expr, b"@hourly") {
        return Some(CronExpression { minutes: 1, hours: ALL_HOURS, days: ALL_DAYS, months: ALL_MONTHS, weekdays: ALL_WEEKDAYS, days_is_wildcard: true, weekdays_is_wildcard: true });
    }
    None
}

// TODO(port): phf custom hasher for case-insensitive lookup; using lowercase keys + manual fold below
static WEEKDAY_MAP: phf::Map<&'static [u8], u8> = phf_map! {
    b"sun" => 0,       b"mon" => 1,        b"tue" => 2,
    b"wed" => 3,       b"thu" => 4,        b"fri" => 5,
    b"sat" => 6,       b"sunday" => 0,     b"monday" => 1,
    b"tuesday" => 2,   b"wednesday" => 3,  b"thursday" => 4,
    b"friday" => 5,    b"saturday" => 6,
};

static MONTH_MAP: phf::Map<&'static [u8], u8> = phf_map! {
    b"jan" => 1,        b"feb" => 2,        b"mar" => 3,
    b"apr" => 4,        b"may" => 5,        b"jun" => 6,
    b"jul" => 7,        b"aug" => 8,        b"sep" => 9,
    b"oct" => 10,       b"nov" => 11,       b"dec" => 12,
    b"january" => 1,    b"february" => 2,   b"march" => 3,
    b"april" => 4,      b"june" => 6,       b"july" => 7,
    b"august" => 8,     b"september" => 9,  b"october" => 10,
    b"november" => 11,  b"december" => 12,
};

fn get_ascii_case_insensitive(map: &phf::Map<&'static [u8], u8>, key: &[u8]) -> Option<u8> {
    // TODO(port): ComptimeStringMap.getASCIIICaseInsensitive — phf has no native CI lookup
    if key.len() > 16 {
        return None;
    }
    let mut buf = [0u8; 16];
    for (i, &b) in key.iter().enumerate() {
        buf[i] = b.to_ascii_lowercase();
    }
    map.get(&buf[..key.len()]).copied()
}

// ============================================================================
// Field parsing
// ============================================================================

#[derive(Clone, Copy, PartialEq, Eq)]
enum NameKind {
    None,
    Weekday,
    Month,
}

/// Parse a single cron field (e.g. "1,5-10,*/3") into a bitset.
fn parse_field<T: BitInt>(field: &[u8], min: u8, max: u8, kind: NameKind) -> Result<T, CronError> {
    // TODO(port): Zig used u7 for min/max/step/i; using u8 here (values 128-255 behavior may differ for step)
    if field.is_empty() {
        return Err(CronError::InvalidField);
    }
    let mut result: T = T::ZERO;
    let mut parts = field.split(|b| *b == b',');
    while let Some(part) = parts.next() {
        if part.is_empty() {
            return Err(CronError::InvalidField);
        }
        // Split by / for step
        let mut step_iter = part.split(|b| *b == b'/');
        let base = step_iter.next().ok_or(CronError::InvalidField)?;
        let step_str = step_iter.next();
        if step_iter.next().is_some() {
            return Err(CronError::InvalidStep);
        }

        let step: u8 = if let Some(s) = step_str {
            if s.is_empty() {
                return Err(CronError::InvalidStep);
            }
            parse_u8_decimal(s).ok_or(CronError::InvalidStep)?
        } else {
            1
        };
        if step == 0 {
            return Err(CronError::InvalidStep);
        }

        let range_min: u8;
        let range_max: u8;

        if base == b"*" {
            range_min = min;
            range_max = max;
        } else if let Some(range_parts) = split_range(base) {
            let lo = parse_value(range_parts[0], min, max, kind).map_err(|_| CronError::InvalidNumber)?;
            let hi = parse_value(range_parts[1], min, max, kind).map_err(|_| CronError::InvalidNumber)?;
            if lo > hi {
                return Err(CronError::InvalidRange);
            }
            range_min = lo;
            range_max = hi;
        } else {
            let lo = parse_value(base, min, max, kind).map_err(|_| CronError::InvalidNumber)?;
            range_min = lo;
            range_max = if step_str.is_some() { max } else { lo };
        }

        // Set bits
        let mut i: u8 = range_min;
        while i <= range_max {
            result |= T::ONE << u32::from(i);
            if u16::from(i) + u16::from(step) > u16::from(range_max) {
                break;
            }
            i += step;
        }
    }
    // Weekday: fold bit 7 (Sunday alias) into bit 0 *after* range expansion so
    // 5-7, 0-7, etc. work like Vixie/croner/cron-parser.
    if kind == NameKind::Weekday {
        result = (result | (result >> 7)) & T::from_u8(0x7F);
    }
    Ok(result)
}

/// Split a base expression on '-' for ranges, returning None if not a range.
fn split_range(base: &[u8]) -> Option<[&[u8]; 2]> {
    let idx = strings::index_of_char(base, b'-')? as usize;
    if idx == 0 || idx == base.len() - 1 {
        return None;
    }
    let rest = &base[idx + 1..];
    if strings::index_of_char(rest, b'-').is_some() {
        return None;
    }
    Some([&base[0..idx], rest])
}

/// Parse a single value (number or name), validating range.
fn parse_value(str: &[u8], min: u8, max: u8, kind: NameKind) -> Result<u8, CronError> {
    // Try named value first via ComptimeStringMap case-insensitive lookup
    match kind {
        NameKind::Weekday => {
            if let Some(v) = get_ascii_case_insensitive(&WEEKDAY_MAP, str) {
                return Ok(v);
            }
        }
        NameKind::Month => {
            if let Some(v) = get_ascii_case_insensitive(&MONTH_MAP, str) {
                return Ok(v);
            }
        }
        NameKind::None => {}
    }

    let val = parse_u8_decimal(str).ok_or(CronError::InvalidNumber)?;
    if val < min || val > max {
        return Err(CronError::InvalidNumber);
    }
    Ok(val)
}

// ============================================================================
// Helpers
// ============================================================================

#[inline]
fn bit_set<T: BitInt>(set: T, pos: u32) -> bool {
    (set >> pos) & T::ONE != T::ZERO
}

/// Write a bitfield as a cron field string: "*" if all bits set, or comma-separated values.
fn format_bitfield<T: BitInt>(w: &mut impl std::io::Write, bits: T, min: u8, max: u8) {
    if bits.count_ones() == u32::from(max) - u32::from(min) + 1 {
        w.write_all(b"*").expect("unreachable");
        return;
    }
    let mut first = true;
    for i in min..=max {
        if (bits >> u32::from(i)) & T::ONE != T::ZERO {
            if !first {
                w.write_all(b",").expect("unreachable");
            }
            write!(w, "{}", i).expect("unreachable");
            first = false;
        }
    }
}

/// Parse an unsigned decimal from ASCII bytes (replacement for `std.fmt.parseInt(u8, s, 10)`).
fn parse_u8_decimal(s: &[u8]) -> Option<u8> {
    // Zig's std.fmt.parseInt accepts an optional leading '+' on unsigned ints.
    let s = match s {
        [b'+', rest @ ..] => rest,
        _ => s,
    };
    if s.is_empty() {
        return None;
    }
    let mut val: u32 = 0;
    for &b in s {
        if !b.is_ascii_digit() {
            return None;
        }
        val = val * 10 + u32::from(b - b'0');
        if val > u32::from(u8::MAX) {
            return None;
        }
    }
    Some(u8::try_from(val).unwrap())
}

/// Trait bundling the integer ops needed for cron bitset fields (u8/u16/u32/u64).
trait BitInt:
    Copy
    + PartialEq
    + core::ops::BitOrAssign
    + core::ops::BitOr<Output = Self>
    + core::ops::BitAnd<Output = Self>
    + core::ops::Shl<u32, Output = Self>
    + core::ops::Shr<u32, Output = Self>
{
    const ZERO: Self;
    const ONE: Self;
    fn from_u8(v: u8) -> Self;
    fn count_ones(self) -> u32;
}

macro_rules! impl_bit_int {
    ($($t:ty),*) => {$(
        impl BitInt for $t {
            const ZERO: Self = 0;
            const ONE: Self = 1;
            #[inline] fn from_u8(v: u8) -> Self { v as Self }
            #[inline] fn count_ones(self) -> u32 { <$t>::count_ones(self) }
        }
    )*};
}
impl_bit_int!(u8, u16, u32, u64);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/cron_parser.zig (298 lines)
//   confidence: medium
//   todos:      3
//   notes:      u7→u8 throughout; phf CI lookup hand-rolled; GregorianDateTime field types/methods unverified in bun_jsc
// ──────────────────────────────────────────────────────────────────────────
