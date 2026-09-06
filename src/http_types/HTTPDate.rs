//! RFC 9110 §5.6.7 `HTTP-date` parser: IMF-fixdate, rfc850-date, asctime-date.
//!
//! ```text
//! Sun, 06 Nov 1994 08:49:37 GMT
//! Sunday, 06-Nov-94 08:49:37 GMT
//! Sun Nov  6 08:49:37 1994
//! ```

use bun_core::strings;

const DAY_NAMES: [&[u8]; 7] = [b"Sun", b"Mon", b"Tue", b"Wed", b"Thu", b"Fri", b"Sat"];
const DAY_NAMES_LONG: [&[u8]; 7] = [
    b"Sunday",
    b"Monday",
    b"Tuesday",
    b"Wednesday",
    b"Thursday",
    b"Friday",
    b"Saturday",
];
const MONTH_NAMES: [&[u8]; 12] = [
    b"Jan", b"Feb", b"Mar", b"Apr", b"May", b"Jun", b"Jul", b"Aug", b"Sep", b"Oct", b"Nov", b"Dec",
];

/// A parsed calendar date and time of day in UTC.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Civil {
    year: u32,
    /// 1..=12
    month: u32,
    /// 1..=31
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
}

/// Parse an `HTTP-date` into milliseconds since the Unix epoch. `None` for
/// any other grammar, a calendar date that does not exist, or a date before 1970.
pub fn parse(value: &[u8]) -> Option<u64> {
    let value = strings::trim(value, b" \t");
    let civil = parse_imf_fixdate(value)
        .or_else(|| parse_rfc850(value))
        .or_else(|| parse_asctime(value))?;
    civil.to_unix_ms()
}

fn parse_imf_fixdate(value: &[u8]) -> Option<Civil> {
    let mut p = Parser { rest: value };
    p.one_of(&DAY_NAMES)?;
    p.literal(b", ")?;
    let day = p.digits(2)?;
    p.literal(b" ")?;
    let month = p.one_of(&MONTH_NAMES)? + 1;
    p.literal(b" ")?;
    let year = p.digits(4)?;
    p.literal(b" ")?;
    let (hour, minute, second) = p.time_of_day()?;
    p.literal(b" GMT")?;
    p.end()?;
    Civil::new(year, month, day, hour, minute, second)
}

fn parse_rfc850(value: &[u8]) -> Option<Civil> {
    let mut p = Parser { rest: value };
    p.one_of(&DAY_NAMES_LONG)?;
    p.literal(b", ")?;
    let day = p.digits(2)?;
    p.literal(b"-")?;
    let month = p.one_of(&MONTH_NAMES)? + 1;
    p.literal(b"-")?;
    let now_year = civil_year_from_unix_seconds(bun_core::time::timestamp());
    let year = two_digit_year(p.digits(2)?, now_year);
    p.literal(b" ")?;
    let (hour, minute, second) = p.time_of_day()?;
    p.literal(b" GMT")?;
    p.end()?;
    Civil::new(year, month, day, hour, minute, second)
}

fn parse_asctime(value: &[u8]) -> Option<Civil> {
    let mut p = Parser { rest: value };
    p.one_of(&DAY_NAMES)?;
    p.literal(b" ")?;
    let month = p.one_of(&MONTH_NAMES)? + 1;
    p.literal(b" ")?;
    let day = if p.literal(b" ").is_some() {
        p.digits(1)?
    } else {
        p.digits(2)?
    };
    p.literal(b" ")?;
    let (hour, minute, second) = p.time_of_day()?;
    p.literal(b" ")?;
    let year = p.digits(4)?;
    p.end()?;
    Civil::new(year, month, day, hour, minute, second)
}

/// §5.6.7: the year with these two digits in the window `(now - 50, now + 50]`.
fn two_digit_year(yy: u32, now_year: u32) -> u32 {
    let year = now_year - now_year % 100 + yy;
    if year > now_year + 50 {
        year - 100
    } else if year + 50 <= now_year {
        year + 100
    } else {
        year
    }
}

struct Parser<'a> {
    rest: &'a [u8],
}

impl Parser<'_> {
    fn literal(&mut self, lit: &[u8]) -> Option<()> {
        let head = self.rest.get(..lit.len())?;
        if !head.eq_ignore_ascii_case(lit) {
            return None;
        }
        self.rest = &self.rest[lit.len()..];
        Some(())
    }

    /// Match one of `names` (ASCII case-insensitive). Returns its index.
    fn one_of(&mut self, names: &[&[u8]]) -> Option<u32> {
        names
            .iter()
            .position(|name| self.literal(name).is_some())
            .map(|i| i as u32)
    }

    fn digits(&mut self, n: usize) -> Option<u32> {
        let head = self.rest.get(..n)?;
        let mut value = 0u32;
        for &b in head {
            if !b.is_ascii_digit() {
                return None;
            }
            value = value * 10 + u32::from(b - b'0');
        }
        self.rest = &self.rest[n..];
        Some(value)
    }

    fn time_of_day(&mut self) -> Option<(u32, u32, u32)> {
        let hour = self.digits(2)?;
        self.literal(b":")?;
        let minute = self.digits(2)?;
        self.literal(b":")?;
        let second = self.digits(2)?;
        // Seconds run to 60 for a leap second.
        if hour > 23 || minute > 59 || second > 60 {
            return None;
        }
        Some((hour, minute, second))
    }

    fn end(&self) -> Option<()> {
        self.rest.is_empty().then_some(())
    }
}

impl Civil {
    fn new(year: u32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> Option<Self> {
        if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
            return None;
        }
        Some(Self {
            year,
            month,
            day,
            hour,
            minute,
            second,
        })
    }

    fn to_unix_ms(self) -> Option<u64> {
        let days = days_from_civil(self.year, self.month, self.day);
        if days < 0 {
            return None;
        }
        let seconds = days as u64 * 86_400
            + u64::from(self.hour) * 3_600
            + u64::from(self.minute) * 60
            + u64::from(self.second);
        Some(seconds * 1_000)
    }
}

fn is_leap_year(year: u32) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Days since 1970-01-01 (Howard Hinnant's `days_from_civil`).
fn days_from_civil(year: u32, month: u32, day: u32) -> i64 {
    let y = i64::from(year) - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = i64::from(month);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Calendar year of a Unix timestamp (Howard Hinnant's `civil_from_days`).
fn civil_year_from_unix_seconds(seconds: i64) -> u32 {
    let z = seconds.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (y + i64::from(m <= 2)) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOV_6_1994: u64 = 784_111_777_000;

    #[test]
    fn accepts_the_three_rfc_grammars() {
        assert_eq!(parse(b"Sun, 06 Nov 1994 08:49:37 GMT"), Some(NOV_6_1994));
        assert_eq!(parse(b"Sunday, 06-Nov-94 08:49:37 GMT"), Some(NOV_6_1994));
        assert_eq!(parse(b"Sun Nov  6 08:49:37 1994"), Some(NOV_6_1994));
        assert_eq!(
            parse(b"Wed, 01 Jan 2025 00:00:00 GMT"),
            Some(1_735_689_600_000)
        );
        assert_eq!(parse(b"Thu, 01 Jan 1970 00:00:00 GMT"), Some(0));
        assert_eq!(
            parse(b"  Sun, 06 Nov 1994 08:49:37 GMT\t"),
            Some(NOV_6_1994)
        );
        assert_eq!(parse(b"sun, 06 nov 1994 08:49:37 gmt"), Some(NOV_6_1994));
    }

    #[test]
    fn rejects_date_parse_only_grammars() {
        for junk in [
            &b""[..],
            b"2030",
            b"12345",
            b"10",
            b"1/1/2030",
            b"January 2030",
            b"March 2001",
            b"2025-01-01T00:00:00Z",
            b"Tue, 31 Dec 2024 16:00:01 PST",
            b"Wed, 01 Jan 2025 00:00:00 UTC",
            b"Wed, 01 Jan 2025 00:00:00 +0000",
            b"Wed, 01 Jan 2025 00:00:00",
            b"Wed, 1 Jan 2025 00:00:00 GMT",
            b"Wed, 01 Jan 2025 00:00 GMT",
            b"Wed, 01 Jan 2025 24:00:00 GMT",
            b"Wed, 01 Jan 2025 00:60:00 GMT",
            b"Wed, 01 Jan 2025 00:00:00 GMT garbage",
            b"Sun, 30 Feb 2025 00:00:00 GMT",
            b"Sat, 31 Apr 2025 00:00:00 GMT",
            b"Wed, 01 Jan 1969 00:00:00 GMT",
            b"garbage",
        ] {
            assert_eq!(parse(junk), None, "{}", bstr::BStr::new(junk));
        }
    }

    #[test]
    fn leap_day_and_leap_second() {
        assert_eq!(
            parse(b"Thu, 29 Feb 2024 00:00:00 GMT"),
            Some(1_709_164_800_000)
        );
        assert_eq!(parse(b"Thu, 29 Feb 2023 00:00:00 GMT"), None);
        assert_eq!(parse(b"Thu, 29 Feb 1900 00:00:00 GMT"), None);
        assert_eq!(
            parse(b"Tue, 31 Dec 2024 23:59:60 GMT"),
            Some(1_735_689_600_000)
        );
    }

    #[test]
    fn two_digit_year_is_never_more_than_50_years_ahead() {
        for now in [2000, 2026, 2049, 2050, 2051, 2099, 2100] {
            for yy in 0..100 {
                let year = two_digit_year(yy, now);
                assert_eq!(year % 100, yy);
                assert!(
                    year <= now + 50 && year > now - 50,
                    "{yy} -> {year} (now {now})"
                );
            }
        }
        assert_eq!(two_digit_year(94, 2026), 1994);
        assert_eq!(two_digit_year(76, 2026), 2076);
        assert_eq!(two_digit_year(77, 2026), 1977);
        assert_eq!(two_digit_year(0, 2050), 2100);
        assert_eq!(two_digit_year(0, 2049), 2000);
    }

    #[test]
    fn civil_year_round_trips() {
        assert_eq!(civil_year_from_unix_seconds(0), 1970);
        assert_eq!(civil_year_from_unix_seconds(NOV_6_1994 as i64 / 1000), 1994);
        assert_eq!(civil_year_from_unix_seconds(1_735_689_600), 2025);
        assert_eq!(civil_year_from_unix_seconds(1_735_689_599), 2024);
    }
}
