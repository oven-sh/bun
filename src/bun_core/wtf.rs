//! `bun_core::wtf` — JSC-independent ports of WTF utilities.
//!
//! Tier-0 pure-Rust port of WebKit's `WTF::parseES5Date` (DateMath.cpp). The
//! npm registry `time` map (`publish_timestamp_ms`) needs this in `bun_install`
//! without taking the `bun_jsc` (FFI) dependency, so the parser is reimplemented
//! here byte-for-byte against the spec rather than calling `WTF__parseES5Date`.
//!
//! Source of truth: vendor/WebKit `Source/WTF/wtf/DateMath.{h,cpp}`,
//! `parseES5DatePortion` / `parseES5TimePortion` / `ymdhmsToMilliseconds`.
//!
//! PORT NOTE: WTF's `parseES5Date` sets an `isLocalTime` out-param so the JS
//! `Date` constructor can later apply the VM's tz offset. The npm caller never
//! consults it (and registry timestamps are always `Z`-suffixed), so the
//! pure-Rust API drops the out-param; local-time inputs return their naive UTC
//! value, matching what the Zig path observes after `WTF__parseES5Date` (which
//! also discards `isLocalTime`).

#![allow(clippy::manual_range_contains)]

// ── time constants (DateMath.h) ───────────────────────────────────────────
const MS_PER_SECOND: f64 = 1000.0;
const SECONDS_PER_MINUTE: f64 = 60.0;
const SECONDS_PER_HOUR: f64 = SECONDS_PER_MINUTE * 60.0;
const SECONDS_PER_DAY: f64 = SECONDS_PER_HOUR * 24.0;
/// ecma262 §21.4.1.1 Time Values and Time Range: ±100,000,000 days.
const MAX_ECMASCRIPT_TIME: f64 = 8.64e15;

/// Day-of-year of the first day of each month, [non-leap, leap].
const FIRST_DAY_OF_MONTH: [[i32; 12]; 2] = [
    [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334],
    [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335],
];

#[inline]
const fn is_leap_year(year: i32) -> bool {
    if year % 4 != 0 {
        return false;
    }
    if year % 400 == 0 {
        return true;
    }
    year % 100 != 0
}

#[inline]
fn days_from_1970_to_year(year: i32) -> f64 {
    const LEAP_DAYS_BEFORE_1971_BY_4_RULE: f64 = (1970 / 4) as f64;
    const EXCLUDED_LEAP_DAYS_BEFORE_1971_BY_100_RULE: f64 = (1970 / 100) as f64;
    const LEAP_DAYS_BEFORE_1971_BY_400_RULE: f64 = (1970 / 400) as f64;

    let year_minus_one = year as f64 - 1.0;
    let by_4 = (year_minus_one / 4.0).floor() - LEAP_DAYS_BEFORE_1971_BY_4_RULE;
    let by_100 = (year_minus_one / 100.0).floor() - EXCLUDED_LEAP_DAYS_BEFORE_1971_BY_100_RULE;
    let by_400 = (year_minus_one / 400.0).floor() - LEAP_DAYS_BEFORE_1971_BY_400_RULE;

    365.0 * (year as f64 - 1970.0) + by_4 - by_100 + by_400
}

#[inline]
fn ymdhms_to_milliseconds(
    year: i32,
    mon: i64,
    day: i64,
    hour: i64,
    minute: i64,
    second: i64,
    milliseconds: f64,
) -> f64 {
    let mday = FIRST_DAY_OF_MONTH[is_leap_year(year) as usize][(mon - 1) as usize] as f64;
    let ydays = days_from_1970_to_year(year);

    let date_ms = milliseconds
        + second as f64 * MS_PER_SECOND
        + minute as f64 * (SECONDS_PER_MINUTE * MS_PER_SECOND)
        + hour as f64 * (SECONDS_PER_HOUR * MS_PER_SECOND)
        + (mday + day as f64 - 1.0 + ydays) * (SECONDS_PER_DAY * MS_PER_SECOND);

    if date_ms < -MAX_ECMASCRIPT_TIME || date_ms > MAX_ECMASCRIPT_TIME {
        return f64::NAN;
    }
    date_ms
}

// ── parsing primitives ────────────────────────────────────────────────────
//
// WTF uses a `std::span<const Latin1Character>&` cursor. Port models that as
// an index `pos` into the original byte slice; subspan diffs (`postParse -
// current`) become `(new_pos - old_pos)`. PORT NOTE: WTF's `safeStringToInteger`
// skips leading ASCII whitespace and a single `+` before `std::from_chars`; that
// quirk is preserved even though every ES5 call site pre-checks `isASCIIDigit`.

#[inline]
fn is_ascii_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') < 10
}

#[inline]
fn is_ascii_whitespace(c: u8) -> bool {
    // isUnicodeCompatibleASCIIWhitespace: SP / TAB / LF / VT / FF / CR
    matches!(c, b' ' | b'\t' | b'\n' | 0x0B | 0x0C | b'\r')
}

#[inline]
fn skip_exactly(s: &[u8], pos: &mut usize, c: u8) -> bool {
    if *pos < s.len() && s[*pos] == c {
        *pos += 1;
        true
    } else {
        false
    }
}

/// Port of `safeStringToInteger` returning the parsed `long` value and advancing
/// `pos`. Returns `None` on parse failure or `validate` rejection. Base is
/// always 10 in the ES5 path.
fn parse_integer(s: &[u8], pos: &mut usize, validate: impl Fn(i64) -> bool) -> Option<i64> {
    let mut i = *pos;
    while i < s.len() && is_ascii_whitespace(s[i]) {
        i += 1;
    }
    // strtol-compat: skip a leading '+'.
    if i < s.len() && s[i] == b'+' {
        i += 1;
    }
    // std::from_chars<long>: optional '-' then digits.
    let neg = if i < s.len() && s[i] == b'-' {
        i += 1;
        true
    } else {
        false
    };
    let digits_start = i;
    // Accumulate as i128 so overflow saturates exactly like std::from_chars'
    // `result_out_of_range` (which fails the validate lambda).
    let mut acc: i128 = 0;
    while i < s.len() && is_ascii_digit(s[i]) {
        acc = acc.saturating_mul(10).saturating_add((s[i] - b'0') as i128);
        i += 1;
    }
    if i == digits_start {
        return None;
    }
    let value = if neg { -acc } else { acc };
    let value: i64 = value.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
    if !validate(value) {
        return None;
    }
    *pos = i;
    Some(value)
}

#[inline]
fn parse_int(s: &[u8], pos: &mut usize) -> Option<i32> {
    parse_integer(s, pos, |v| v > i32::MIN as i64 && v < i32::MAX as i64).map(|v| v as i32)
}

#[inline]
fn parse_long(s: &[u8], pos: &mut usize) -> Option<i64> {
    parse_integer(s, pos, |v| v != i64::MIN && v != i64::MAX)
}

// ── date / time portions ──────────────────────────────────────────────────

fn parse_es5_date_portion(
    s: &[u8],
    pos: &mut usize,
    year: &mut i32,
    month: &mut i64,
    day: &mut i64,
    is_single_digit: &mut bool,
) -> bool {
    let has_negative_year = *pos < s.len() && s[*pos] == b'-';
    let Some(y) = parse_int(s, pos) else { return false };
    *year = y;
    if y == 0 && has_negative_year {
        return false;
    }

    // -MM
    if !skip_exactly(s, pos, b'-') {
        return true;
    }
    if *pos >= s.len() || !is_ascii_digit(s[*pos]) {
        return false;
    }
    let before = *pos;
    let Some(m) = parse_long(s, pos) else { return false };
    *month = m;
    match *pos - before {
        1 => *is_single_digit = true,
        2 => {}
        _ => return false,
    }

    // -DD
    if !skip_exactly(s, pos, b'-') {
        return true;
    }
    if *pos >= s.len() || !is_ascii_digit(s[*pos]) {
        return false;
    }
    let before = *pos;
    let Some(d) = parse_long(s, pos) else { return false };
    *day = d;
    match *pos - before {
        1 => *is_single_digit = true,
        2 => {}
        _ => return false,
    }
    true
}

#[allow(clippy::too_many_arguments)]
fn parse_es5_time_portion(
    s: &[u8],
    pos: &mut usize,
    hours: &mut i64,
    minutes: &mut i64,
    seconds: &mut i64,
    milliseconds: &mut f64,
    is_local_time: &mut bool,
    time_zone_seconds: &mut i64,
    has_t_symbol: bool,
) -> bool {
    *is_local_time = false;

    if *pos >= s.len() || !is_ascii_digit(s[*pos]) {
        return false;
    }
    let before = *pos;
    let Some(h) = parse_long(s, pos) else { return false };
    *hours = h;
    if *pos >= s.len() || s[*pos] != b':' || (has_t_symbol && (*pos - before) != 2) {
        return false;
    }
    *pos += 1; // ':'

    if *pos >= s.len() || !is_ascii_digit(s[*pos]) {
        return false;
    }
    let before = *pos;
    let Some(m) = parse_long(s, pos) else { return false };
    *minutes = m;
    if has_t_symbol && (*pos - before) != 2 {
        return false;
    }

    // :ss[.sss]
    if skip_exactly(s, pos, b':') {
        if *pos >= s.len() || !is_ascii_digit(s[*pos]) {
            return false;
        }
        let before = *pos;
        let Some(sec) = parse_long(s, pos) else { return false };
        *seconds = sec;
        if has_t_symbol && (*pos - before) != 2 {
            return false;
        }
        if *pos < s.len() && s[*pos] == b'.' {
            *pos += 1;
            if *pos >= s.len() || !is_ascii_digit(s[*pos]) {
                return false;
            }
            let before = *pos;
            let Some(frac) = parse_long(s, pos) else { return false };
            let num_frac_digits = (*pos - before) as i32;
            *milliseconds = frac as f64 * 10.0f64.powi(-num_frac_digits + 3);
        }
    }

    if skip_exactly(s, pos, b'Z') {
        return true;
    }

    // (+|-)(00:00|0000|00)
    let tz_negative = if skip_exactly(s, pos, b'-') {
        true
    } else if skip_exactly(s, pos, b'+') {
        false
    } else {
        *is_local_time = true;
        return true;
    };

    let mut tz_hours_abs: i64;
    let mut tz_minutes: i64 = 0;

    if *pos >= s.len() || !is_ascii_digit(s[*pos]) {
        return false;
    }
    let before = *pos;
    let Some(tz_hours) = parse_long(s, pos) else { return false };
    if *pos >= s.len() || s[*pos] != b':' {
        let width = *pos - before;
        if !has_t_symbol && width == 2 {
            tz_hours_abs = tz_hours.abs();
        } else if width == 4 {
            tz_hours_abs = tz_hours.abs();
            tz_minutes = tz_hours_abs % 100;
            tz_hours_abs /= 100;
        } else {
            return false;
        }
    } else {
        if has_t_symbol && (*pos - before) != 2 {
            return false;
        }
        tz_hours_abs = tz_hours.abs();
        *pos += 1; // ':'
        if *pos >= s.len() || !is_ascii_digit(s[*pos]) {
            return false;
        }
        let before = *pos;
        let Some(m) = parse_long(s, pos) else { return false };
        tz_minutes = m;
        if has_t_symbol && (*pos - before) != 2 {
            return false;
        }
    }

    if tz_hours_abs > 23 {
        return false;
    }
    if tz_minutes < 0 || tz_minutes > 59 {
        return false;
    }

    let mut tzs = 60 * (tz_minutes + 60 * tz_hours_abs);
    if tz_negative {
        tzs = -tzs;
    }
    *time_zone_seconds = tzs;
    true
}

/// Port of `WTF::parseES5Date`. Returns milliseconds since the Unix epoch, or
/// `NaN` if the input does not parse as an ecma262 §21.4.1.18 Date Time String.
///
/// Unlike the C++ original this drops the `isLocalTime` out-param (see module
/// note); inputs without a UTC designator are returned as their naive value.
pub fn parse_es5_date_raw(s: &[u8]) -> f64 {
    const DAYS_PER_MONTH: [i64; 12] = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    let mut pos: usize = 0;
    let mut year: i32 = 0;
    let mut month: i64 = 1;
    let mut day: i64 = 1;
    let mut hours: i64 = 0;
    let mut minutes: i64 = 0;
    let mut seconds: i64 = 0;
    let mut milliseconds: f64 = 0.0;
    let mut time_zone_seconds: i64 = 0;
    let mut is_single_digit = false;
    let mut _is_local_time = false;

    if !parse_es5_date_portion(s, &mut pos, &mut year, &mut month, &mut day, &mut is_single_digit) {
        return f64::NAN;
    }

    if pos < s.len() && matches!(s[pos], b'T' | b't' | b' ') {
        let has_t_symbol = matches!(s[pos], b'T' | b't');
        pos += 1;

        if is_single_digit && has_t_symbol {
            return f64::NAN;
        }

        if !parse_es5_time_portion(
            s,
            &mut pos,
            &mut hours,
            &mut minutes,
            &mut seconds,
            &mut milliseconds,
            &mut _is_local_time,
            &mut time_zone_seconds,
            has_t_symbol,
        ) {
            return f64::NAN;
        }
    }
    if pos != s.len() {
        return f64::NAN;
    }

    if is_single_digit {
        _is_local_time = true;
    }

    if month < 1 || month > 12 {
        return f64::NAN;
    }
    if day < 1 || day > DAYS_PER_MONTH[(month - 1) as usize] {
        return f64::NAN;
    }
    if month == 2 && day > 28 && !is_leap_year(year) {
        return f64::NAN;
    }
    if hours < 0 || hours > 24 {
        return f64::NAN;
    }
    if hours == 24 && (minutes != 0 || seconds != 0) {
        return f64::NAN;
    }
    if minutes < 0 || minutes > 59 {
        return f64::NAN;
    }
    if seconds < 0 || seconds >= 61 {
        return f64::NAN;
    }
    if seconds == 60 {
        milliseconds = 0.0;
    }

    ymdhms_to_milliseconds(year, month, day, hours, minutes, seconds, milliseconds)
        - (time_zone_seconds as f64 * MS_PER_SECOND)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidDate;

impl core::fmt::Display for InvalidDate {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("InvalidDate")
    }
}
impl core::error::Error for InvalidDate {}

/// `bun.jsc.wtf.parseES5Date` shape — `Err` on empty input or non-finite result.
/// `2000-01-01T00:00:00.000Z` → `Ok(946684800000.0)`.
pub fn parse_es5_date(buf: &[u8]) -> Result<f64, InvalidDate> {
    if buf.is_empty() {
        return Err(InvalidDate);
    }
    let ms = parse_es5_date_raw(buf);
    if ms.is_finite() { Ok(ms) } else { Err(InvalidDate) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch() {
        assert_eq!(parse_es5_date(b"1970-01-01T00:00:00.000Z").unwrap(), 0.0);
    }

    #[test]
    fn y2k() {
        assert_eq!(parse_es5_date(b"2000-01-01T00:00:00.000Z").unwrap(), 946_684_800_000.0);
    }

    #[test]
    fn npm_registry_shape() {
        // Real npm `time` value: 2019-08-06T00:29:19.537Z
        assert_eq!(parse_es5_date(b"2019-08-06T00:29:19.537Z").unwrap(), 1_565_051_359_537.0);
    }

    #[test]
    fn date_only() {
        assert_eq!(parse_es5_date(b"2020-01-02").unwrap(), 1_577_923_200_000.0);
    }

    #[test]
    fn tz_offset() {
        assert_eq!(
            parse_es5_date(b"2020-01-01T00:00:00+01:00").unwrap(),
            1_577_836_800_000.0 - 3_600_000.0,
        );
    }

    #[test]
    fn invalid() {
        assert!(parse_es5_date(b"").is_err());
        assert!(parse_es5_date(b"garbage").is_err());
        assert!(parse_es5_date(b"2020-13-01").is_err());
        assert!(parse_es5_date(b"2019-02-29").is_err()); // not a leap year
        assert!(parse_es5_date(b"2020-01-01T25:00:00Z").is_err());
    }

    #[test]
    fn leap_second_clamped() {
        // seconds == 60 → milliseconds zeroed, still valid.
        assert!(parse_es5_date(b"2016-12-31T23:59:60Z").is_ok());
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     vendor/WebKit Source/WTF/wtf/DateMath.{h,cpp} (parseES5Date)
//   confidence: high — line-for-line port; cursor span → index arithmetic
//   todos:      0
//   notes:      isLocalTime out-param dropped (npm caller ignores it; the Zig
//               FFI path also discards it). `long` modelled as i64 on all
//               targets — WTF's bounds checks are width-sensitive but the ES5
//               grammar never produces values near LONG_MAX, so behaviour is
//               identical for valid inputs.
// ──────────────────────────────────────────────────────────────────────────
