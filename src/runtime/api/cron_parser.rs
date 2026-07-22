//! Cron expression parser and next-occurrence calculator.
//!
//! Parses standard 5-field cron expressions (minute hour day month weekday)
//! into a bitset representation, and computes the next matching local time.
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

use bun_core::strings;
use bun_jsc::{GregorianDateTime, JSGlobalObject, JsResult};

/// Time zone for `CronExpression::next`.
#[derive(Clone, Copy)]
pub enum CronTz {
    /// The process's local time zone (default).
    Local,
    /// A resolved IANA time-zone ID from `JSGlobalObject::resolve_time_zone_id`.
    Named(u32),
}

impl CronTz {
    fn ms_to_gregorian(self, g: &JSGlobalObject, ms: f64) -> GregorianDateTime {
        match self {
            CronTz::Local => g.ms_to_gregorian_date_time(ms),
            CronTz::Named(id) => g.ms_to_gregorian_date_time_in_zone(ms, id),
        }
    }

    fn gregorian_to_ms(
        self,
        g: &JSGlobalObject,
        year: i32,
        month: i32,
        day: i32,
        hour: i32,
        minute: i32,
    ) -> JsResult<f64> {
        match self {
            CronTz::Local => g.gregorian_date_time_to_ms(year, month, day, hour, minute, 0, 0),
            CronTz::Named(id) => {
                Ok(g.gregorian_date_time_to_ms_in_zone(year, month, day, hour, minute, 0, 0, id))
            }
        }
    }
}

#[derive(Clone, Copy)]
pub struct CronExpression {
    pub minutes: u64,               // bits 0-59
    pub hours: u32,                 // bits 0-23
    pub days: u32,                  // bits 1-31
    pub months: u16,                // bits 1-12
    pub weekdays: u8,               // bits 0-6 (0=Sunday)
    pub days_is_wildcard: bool,     // true if day-of-month field was *
    pub weekdays_is_wildcard: bool, // true if weekday field was *
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CronError {
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

impl CronExpression {
    pub(crate) fn error_message(e: CronError) -> &'static [u8] {
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
    pub(crate) fn parse(input: &[u8]) -> Result<CronExpression, CronError> {
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

    /// Format the expression as a normalized numeric "M H D Mo W" string
    /// suitable for crontab. Returns the written slice of `buf`.
    pub(crate) fn format_numeric<'a>(&self, buf: &'a mut [u8; 512]) -> &'a [u8] {
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

    /// POSIX cron: if both DOM and DOW are restricted (not `*`), match either;
    /// otherwise match both (a `*` field matches all anyway).
    fn matches_day(&self, day: i32, weekday: i32) -> bool {
        let day_ok = bit_set(self.days, u32::try_from(day).expect("int cast"));
        let weekday_ok = bit_set(self.weekdays, u32::try_from(weekday).expect("int cast"));
        if !self.days_is_wildcard && !self.weekdays_is_wildcard {
            day_ok || weekday_ok
        } else {
            day_ok && weekday_ok
        }
    }

    /// Check if a real instant matches all five fields in `tz`.
    fn matches_instant(&self, global_object: &JSGlobalObject, tz: CronTz, ms: f64) -> bool {
        let t = tz.ms_to_gregorian(global_object, ms);
        bit_set(self.minutes, u32::try_from(t.minute).expect("int cast"))
            && bit_set(self.hours, u32::try_from(t.hour).expect("int cast"))
            && bit_set(self.months, u32::try_from(t.month).expect("int cast"))
            && self.matches_day(t.day, t.weekday)
    }

    /// Convert a matching wall-clock `dt` to a real instant strictly after
    /// `from_ms`, handling DST. Returns None if no such instant exists for
    /// this wall-clock minute (fall-back FORMER already passed and the
    /// schedule is fixed-time, so it fires once — cronie semantics).
    fn resolve_local_match(
        &self,
        global_object: &JSGlobalObject,
        tz: CronTz,
        dt: GregorianDateTime,
        from_ms: f64,
    ) -> JsResult<Option<f64>> {
        let result =
            tz.gregorian_to_ms(global_object, dt.year, dt.month, dt.day, dt.hour, dt.minute)?;
        // During fall-back, `result` is the FORMER occurrence and the wall-clock
        // walk steps over the second one. For schedules with `*` minute or `*`
        // hour, scan real-time minutes (capped at the largest DST shift) for an
        // earlier match in the repeated window.
        if self.minutes == ALL_MINUTES || self.hours == ALL_HOURS {
            let mut probe = ((from_ms / MINUTE_MS).floor() + 1.0) * MINUTE_MS;
            let cap = result.min(from_ms + (MAX_DST_SHIFT_MIN + 1.0) * MINUTE_MS);
            while probe < cap {
                if self.matches_instant(global_object, tz, probe) {
                    return Ok(Some(probe));
                }
                probe += MINUTE_MS;
            }
        }
        Ok(if result > from_ms { Some(result) } else { None })
    }

    /// Compute the next time (in ms since epoch) that matches this expression
    /// in `tz`, strictly after `from_ms`. Returns None if no match found
    /// within 8 years.
    pub(crate) fn next(
        &self,
        global_object: &JSGlobalObject,
        from_ms: f64,
        tz: CronTz,
    ) -> JsResult<Option<f64>> {
        let mut dt = tz.ms_to_gregorian(global_object, from_ms);
        let start_year = dt.year;
        dt.minute += 1;

        while dt.year - start_year <= 8 {
            // Carry hour/minute manually so the candidate {hour,minute} is
            // checked against the bitfields *before* DST shifts it; normalize
            // the date+weekday via a UTC round-trip (pure calendar math —
            // day overflow and weekday are TZ-independent).
            if dt.minute > 59 {
                dt.minute -= 60;
                dt.hour += 1;
            }
            if dt.hour > 23 {
                dt.hour -= 24;
                dt.day += 1;
            }
            let n = global_object.ms_to_gregorian_date_time_utc(
                global_object
                    .gregorian_date_time_to_ms_utc(dt.year, dt.month, dt.day, 12, 0, 0, 0)?,
            );
            dt.year = n.year;
            dt.month = n.month;
            dt.day = n.day;
            dt.weekday = n.weekday;

            if !bit_set(self.months, u32::try_from(dt.month).expect("int cast")) {
                dt.month += 1;
                dt.day = 1;
                dt.hour = 0;
                dt.minute = 0;
                continue;
            }
            if !self.matches_day(dt.day, dt.weekday) {
                dt.day += 1;
                dt.hour = 0;
                dt.minute = 0;
                continue;
            }
            if !bit_set(self.hours, u32::try_from(dt.hour).expect("int cast")) {
                dt.hour += 1;
                dt.minute = 0;
                continue;
            }
            if !bit_set(self.minutes, u32::try_from(dt.minute).expect("int cast")) {
                dt.minute += 1;
                continue;
            }

            if let Some(r) = self.resolve_local_match(global_object, tz, dt, from_ms)? {
                return Ok(Some(r));
            }
            dt.minute += 1;
        }
        Ok(None)
    }
}

// ============================================================================
// Name lookup tables
// ============================================================================

const MINUTE_MS: f64 = 60_000.0;
const MAX_DST_SHIFT_MIN: f64 = 120.0;

pub(crate) const ALL_MINUTES: u64 = (1 << 60) - 1;
pub(crate) const ALL_HOURS: u32 = (1 << 24) - 1;
pub(crate) const ALL_DAYS: u32 = ((1u64 << 32) - 1) as u32 & !1u32;
pub(crate) const ALL_MONTHS: u16 = ((1u32 << 13) - 1) as u16 & !1u16;
pub(crate) const ALL_WEEKDAYS: u8 = (1 << 7) - 1;

fn parse_nickname(expr: &[u8]) -> Option<CronExpression> {
    use bun_core::strings::eql_case_insensitive_asciii_check_length as eql;
    if eql(expr, b"@yearly") || eql(expr, b"@annually") {
        return Some(CronExpression {
            minutes: 1,
            hours: 1,
            days: 1 << 1,
            months: 1 << 1,
            weekdays: ALL_WEEKDAYS,
            days_is_wildcard: false,
            weekdays_is_wildcard: true,
        });
    }
    if eql(expr, b"@monthly") {
        return Some(CronExpression {
            minutes: 1,
            hours: 1,
            days: 1 << 1,
            months: ALL_MONTHS,
            weekdays: ALL_WEEKDAYS,
            days_is_wildcard: false,
            weekdays_is_wildcard: true,
        });
    }
    if eql(expr, b"@weekly") {
        return Some(CronExpression {
            minutes: 1,
            hours: 1,
            days: ALL_DAYS,
            months: ALL_MONTHS,
            weekdays: 1,
            days_is_wildcard: true,
            weekdays_is_wildcard: false,
        });
    }
    if eql(expr, b"@daily") || eql(expr, b"@midnight") {
        return Some(CronExpression {
            minutes: 1,
            hours: 1,
            days: ALL_DAYS,
            months: ALL_MONTHS,
            weekdays: ALL_WEEKDAYS,
            days_is_wildcard: true,
            weekdays_is_wildcard: true,
        });
    }
    if eql(expr, b"@hourly") {
        return Some(CronExpression {
            minutes: 1,
            hours: ALL_HOURS,
            days: ALL_DAYS,
            months: ALL_MONTHS,
            weekdays: ALL_WEEKDAYS,
            days_is_wildcard: true,
            weekdays_is_wildcard: true,
        });
    }
    None
}

bun_core::comptime_string_map! {
    static WEEKDAY_MAP: u8 = {
        b"sun" => 0,       b"mon" => 1,        b"tue" => 2,
        b"wed" => 3,       b"thu" => 4,        b"fri" => 5,
        b"sat" => 6,       b"sunday" => 0,     b"monday" => 1,
        b"tuesday" => 2,   b"wednesday" => 3,  b"thursday" => 4,
        b"friday" => 5,    b"saturday" => 6,
    };
}

bun_core::comptime_string_map! {
    static MONTH_MAP: u8 = {
        b"jan" => 1,        b"feb" => 2,        b"mar" => 3,
        b"apr" => 4,        b"may" => 5,        b"jun" => 6,
        b"jul" => 7,        b"aug" => 8,        b"sep" => 9,
        b"oct" => 10,       b"nov" => 11,       b"dec" => 12,
        b"january" => 1,    b"february" => 2,   b"march" => 3,
        b"april" => 4,      b"june" => 6,       b"july" => 7,
        b"august" => 8,     b"september" => 9,  b"october" => 10,
        b"november" => 11,  b"december" => 12,
    };
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
            // Steps 128-255 overflow into InvalidStep too.
            match bun_core::parse_decimal::<u8>(s) {
                Some(v @ 0..=127) => v,
                _ => return Err(CronError::InvalidStep),
            }
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
            let lo = parse_value(range_parts[0], min, max, kind)
                .map_err(|_| CronError::InvalidNumber)?;
            let hi = parse_value(range_parts[1], min, max, kind)
                .map_err(|_| CronError::InvalidNumber)?;
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
            if let Some(v) = strings::in_map_case_insensitive(str, &WEEKDAY_MAP) {
                return Ok(v);
            }
        }
        NameKind::Month => {
            if let Some(v) = strings::in_map_case_insensitive(str, &MONTH_MAP) {
                return Ok(v);
            }
        }
        NameKind::None => {}
    }

    let val = bun_core::parse_decimal::<u8>(str).ok_or(CronError::InvalidNumber)?;
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
