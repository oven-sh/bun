use bun_core::strings;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::virtual_machine_exports::{read_origin_timer, read_origin_timer_start};

/// Milliseconds since the epoch, by a clock that does not jump.
pub fn monotonic_now() -> f64 {
    let vm = VirtualMachine::get();
    read_origin_timer_start(vm) + read_origin_timer(vm) as f64 / 1e6
}

/// Seconds since the epoch.
pub fn wall_now() -> f64 {
    bun_core::time::milli_timestamp() as f64 / 1e3
}

/// The digits that `token` starts with, if there are that many, and what follows them.
fn number(token: &[u8], lengths: core::ops::RangeInclusive<usize>) -> Option<(i64, &[u8])> {
    let (digits, rest) = token.split_at(token.iter().take_while(|it| it.is_ascii_digit()).count());
    lengths.contains(&digits.len()).then(|| {
        (
            digits
                .iter()
                .fold(0, |all, it| all * 10 + i64::from(it - b'0')),
            rest,
        )
    })
}

fn time_of_day(token: &[u8]) -> Option<[i64; 3]> {
    let (hours, rest) = number(token, 1..=2)?;
    let (minutes, rest) = number(rest.strip_prefix(b":")?, 1..=2)?;
    Some([hours, minutes, number(rest.strip_prefix(b":")?, 1..=2)?.0])
}

/// https://httpwg.org/http-extensions/draft-ietf-httpbis-rfc6265bis.html#cookie-date, which the dates of HTTP fit too.
pub fn parse_date(text: &[u8]) -> Option<f64> {
    let (mut time, mut day, mut month, mut year) = (None, None, None, None);
    for token in
        text.split(|it| matches!(it, 9 | 0x20..=0x2f | 0x3b..=0x40 | 0x5b..=0x60 | 0x7b..=0x7e))
    {
        let name_at = || {
            let name = token.get(..3)?.to_ascii_lowercase();
            strings::index_of(b"jan feb mar apr may jun jul aug sep oct nov dec", &name)
                .filter(|it| it % 4 == 0)
        };
        if let (None, Some(found)) = (time, time_of_day(token)) {
            time = Some(found);
        } else if let (None, Some(found)) = (day, number(token, 1..=2)) {
            day = Some(found.0);
        } else if let (None, Some(found)) = (month, name_at()) {
            month = Some(found as i64 / 4 + 1);
        } else if let (None, Some(found)) = (year, number(token, 2..=4)) {
            year = Some(found.0);
        }
    }
    let ([hours, minutes, seconds], day, month, year) = (time?, day?, month?, year?);
    let year = year
        + if year < 70 {
            2000
        } else if year < 100 {
            1900
        } else {
            0
        };
    let is_leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = if month == 2 {
        28 + i64::from(is_leap)
    } else {
        30 + (month + month / 8) % 2
    };
    if year < 1601
        || !(1..=days_in_month).contains(&day)
        || hours > 23
        || minutes > 59
        || seconds > 59
    {
        return None;
    }
    let from_march = year - i64::from(month <= 2);
    let days = from_march * 365 + from_march / 4 - from_march / 100
        + from_march / 400
        + (153 * ((month + 9) % 12) + 2) / 5
        + day
        - 719_469;
    Some((days * 86_400 + hours * 3600 + minutes * 60 + seconds) as f64)
}
