//! https://html.spec.whatwg.org/#common-microsyntaxes

use std::io::Write;

pub(crate) const DAY: f64 = 86_400_000.0;
const MAX_TIME: f64 = 8.64e15;
pub(crate) const MAX_YEAR: i64 = 275_760;

fn digits(text: &[u8]) -> usize {
    text.iter().take_while(|it| it.is_ascii_digit()).count()
}

fn exponent(text: &[u8]) -> usize {
    let [b'e' | b'E', rest @ ..] = text else {
        return 0;
    };
    let sign = usize::from(matches!(rest, [b'+' | b'-', ..]));
    match digits(&rest[sign..]) {
        0 => 0,
        count => 1 + sign + count,
    }
}

fn finite(text: &[u8]) -> Option<f64> {
    bun_core::fmt::parse_ascii::<f64>(text)
        .filter(|it| it.is_finite())
        .map(|it| it + 0.0)
}

/// https://html.spec.whatwg.org/#valid-floating-point-number
pub(crate) fn parse_valid_float(text: &[u8]) -> Option<f64> {
    let unsigned = text.strip_prefix(b"-").unwrap_or(text);
    let mut end = digits(unsigned);
    if let [b'.', fraction @ ..] = &unsigned[end..] {
        end += 1 + Some(digits(fraction)).filter(|it| *it > 0)?;
    }
    (end > 0 && end + exponent(&unsigned[end..]) == unsigned.len()).then(|| finite(text))?
}

/// https://html.spec.whatwg.org/#rules-for-parsing-floating-point-number-values
pub(crate) fn parse_float(text: &[u8]) -> Option<f64> {
    let text = text.trim_ascii_start();
    let sign = usize::from(matches!(text, [b'+' | b'-', ..]));
    let whole = digits(&text[sign..]);
    let mut end = sign + whole;
    if let [b'.', fraction @ ..] = &text[end..] {
        end += 1 + Some(digits(fraction)).filter(|it| whole + *it > 0)?;
    }
    (end > sign).then(|| finite(&text[..end + exponent(&text[end..])]))?
}

/// As `Number.prototype.toString` writes it.
pub(crate) fn write_float(value: f64) -> Vec<u8> {
    bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], value).to_vec()
}

/// Of the proleptic Gregorian calendar. `month` and `day` start at 1.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Date {
    pub(crate) year: i64,
    pub(crate) month: i64,
    pub(crate) day: i64,
}

impl Date {
    /// A `month` that is out of range is one of another year.
    pub(crate) fn first_of(year: i64, month: i64) -> Date {
        Date {
            year: year + (month - 1).div_euclid(12),
            month: (month - 1).rem_euclid(12) + 1,
            day: 1,
        }
    }

    /// https://howardhinnant.github.io/date_algorithms.html#civil_from_days
    pub(crate) fn from_days(days: i64) -> Date {
        let (era, of_era) = (
            (days + 719_468).div_euclid(146_097),
            (days + 719_468).rem_euclid(146_097),
        );
        let year = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
        let of_year = of_era - (365 * year + year / 4 - year / 100);
        let from_march = (5 * of_year + 2) / 153;
        let month = (from_march + 2) % 12 + 1;
        Date {
            year: year + era * 400 + i64::from(month <= 2),
            month,
            day: of_year - (153 * from_march + 2) / 5 + 1,
        }
    }

    /// Since 1970-01-01. https://howardhinnant.github.io/date_algorithms.html#days_from_civil
    pub(crate) fn days(self) -> i64 {
        let year = self.year - i64::from(self.month <= 2);
        let (era, of_era) = (year.div_euclid(400), year.rem_euclid(400));
        let of_year = (153 * ((self.month + 9) % 12) + 2) / 5 + self.day - 1;
        era * 146_097 + of_era * 365 + of_era / 4 - of_era / 100 + of_year - 719_468
    }

    fn at(time: f64) -> Option<Date> {
        (time.abs() <= MAX_TIME)
            .then(|| Date::from_days((time / DAY).floor() as i64))
            .filter(|it| it.year > 0)
    }
}

/// 0 is Monday.
pub(crate) fn weekday(days: i64) -> i64 {
    (days + 3).rem_euclid(7)
}

fn monday_of_first_week(year: i64) -> i64 {
    let fourth = Date {
        year,
        month: 1,
        day: 4,
    }
    .days();
    fourth - weekday(fourth)
}

struct Reader<'a>(&'a [u8]);

impl Reader<'_> {
    fn number(&mut self, min_digits: usize, max_digits: usize, min: i64, max: i64) -> Option<i64> {
        let count = digits(self.0);
        let (number, rest) = self.0.split_at(count);
        self.0 = rest;
        let value = number.iter().try_fold(0i64, |all, it| {
            Some(all * 10 + i64::from(it - b'0')).filter(|it| *it <= max)
        })?;
        (count >= min_digits && count <= max_digits && value >= min).then_some(value)
    }

    fn two(&mut self, min: i64, max: i64) -> Option<i64> {
        self.number(2, 2, min, max)
    }

    fn skip(&mut self, prefix: &[u8]) -> Option<()> {
        self.0 = self.0.strip_prefix(prefix)?;
        Some(())
    }

    fn year(&mut self) -> Option<i64> {
        self.number(4, usize::MAX, 1, MAX_YEAR)
    }

    fn month(&mut self) -> Option<Date> {
        let year = self.year()?;
        self.skip(b"-")?;
        Some(Date {
            year,
            month: self.two(1, 12)?,
            day: 1,
        })
    }

    fn date(&mut self) -> Option<f64> {
        let first = self.month()?;
        self.skip(b"-")?;
        let days = first.days() + self.two(1, 31)? - 1;
        (Date::from_days(days).month == first.month).then_some(days as f64 * DAY)
    }

    fn week(&mut self) -> Option<f64> {
        let year = self.year()?;
        self.skip(b"-W")?;
        let days = monday_of_first_week(year) + (self.two(1, 53)? - 1) * 7;
        (days < monday_of_first_week(year + 1)).then_some(days as f64 * DAY)
    }

    fn time(&mut self) -> Option<f64> {
        let mut time = self.two(0, 23)? * 3_600_000;
        self.skip(b":")?;
        time += self.two(0, 59)? * 60_000;
        if self.skip(b":").is_some() {
            time += self.two(0, 59)? * 1000;
            if self.skip(b".").is_some() {
                let count = digits(self.0);
                time += self.number(1, 3, 0, 999)? * [100, 10, 1][count - 1];
            }
        }
        Some(time as f64)
    }

    fn date_and_time(&mut self) -> Option<f64> {
        let date = self.date()?;
        self.skip(b"T").or_else(|| self.skip(b" "))?;
        Some(date + self.time()?)
    }
}

fn whole(text: &[u8], read: impl FnOnce(&mut Reader<'_>) -> Option<f64>) -> Option<f64> {
    let mut reader = Reader(text);
    read(&mut reader).filter(|it| reader.0.is_empty() && *it <= MAX_TIME)
}

/// These give milliseconds since 1970, but for `parse_month`, which gives months.
pub(crate) fn parse_date(text: &[u8]) -> Option<f64> {
    whole(text, |it| it.date())
}

pub(crate) fn parse_month(text: &[u8]) -> Option<f64> {
    whole(text, |it| {
        it.month()
            .filter(|it| it.days() as f64 * DAY <= MAX_TIME)
            .map(months_since_epoch)
    })
}

pub(crate) fn parse_week(text: &[u8]) -> Option<f64> {
    whole(text, |it| it.week())
}

pub(crate) fn parse_time(text: &[u8]) -> Option<f64> {
    whole(text, |it| it.time())
}

pub(crate) fn parse_date_and_time(text: &[u8]) -> Option<f64> {
    whole(text, |it| it.date_and_time())
}

fn months_since_epoch(date: Date) -> f64 {
    ((date.year - 1970) * 12 + date.month - 1) as f64
}

pub(crate) fn month_at(time: f64) -> Option<f64> {
    Date::at(time).map(months_since_epoch)
}

pub(crate) fn start_of_month(months: f64) -> f64 {
    Date::first_of(1970, months as i64 + 1).days() as f64 * DAY
}

pub(crate) fn write_date(time: f64) -> Option<Vec<u8>> {
    let Date { year, month, day } = Date::at(time)?;
    Some(format!("{year:04}-{month:02}-{day:02}").into_bytes())
}

pub(crate) fn write_month(months: f64) -> Option<Vec<u8>> {
    let first = Date::first_of(1970, months.round().clamp(-1e9, 1e9) as i64 + 1);
    Date::at(first.days() as f64 * DAY)
        .map(|it| format!("{:04}-{:02}", it.year, it.month).into_bytes())
}

pub(crate) fn write_week(time: f64) -> Option<Vec<u8>> {
    let date = Date::at(time)?;
    let year = (date.year - 1..=date.year + 1)
        .rev()
        .find(|it| monday_of_first_week(*it) <= date.days())
        .filter(|it| *it > 0)?;
    Some(
        format!(
            "{year:04}-W{:02}",
            (date.days() - monday_of_first_week(year)) / 7 + 1
        )
        .into_bytes(),
    )
}

/// The time of day, as precisely as it or `step` needs.
pub(crate) fn write_time(time: f64, step: f64) -> Vec<u8> {
    let time = time.round().rem_euclid(DAY) as u32;
    let needs_less_than = |unit: u32| !time.is_multiple_of(unit) || step % f64::from(unit) != 0.0;
    let mut out = format!("{:02}:{:02}", time / 3_600_000, time / 60_000 % 60).into_bytes();
    if needs_less_than(60_000) {
        let _ = write!(out, ":{:02}", time / 1000 % 60);
    }
    if needs_less_than(1000) {
        let _ = write!(out, ".{:03}", time % 1000);
    }
    out
}

pub(crate) fn write_date_and_time(time: f64) -> Option<Vec<u8>> {
    let time = time.round();
    let mut out = [&write_date(time)?[..], b"T", &write_time(time, 0.0)].concat();
    while out
        .pop_if(|it| *it == b'0' && time % 1000.0 != 0.0)
        .is_some()
    {}
    Some(out)
}

/// https://html.spec.whatwg.org/#valid-e-mail-address
pub(crate) fn is_valid_email(text: &[u8]) -> bool {
    let Some((local, domain)) = bun_core::strings::split_once_char(text, b'@') else {
        return false;
    };
    let is_atom = |it: &u8| {
        it.is_ascii_alphanumeric() || bun_core::strings::contains_char(b".!#$%&'*+/=?^_`{|}~-", *it)
    };
    let is_label = |label: &[u8]| {
        matches!(label.len(), 1..=63)
            && label
                .iter()
                .all(|it| it.is_ascii_alphanumeric() || *it == b'-')
            && !label.starts_with(b"-")
            && !label.ends_with(b"-")
    };
    !local.is_empty()
        && local.iter().all(is_atom)
        && bun_core::strings::split(domain, b".").all(is_label)
}
