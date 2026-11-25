use core::fmt;

use bun_core::strings;

/// Bit `n` of a field is set if the value `n` matches.
#[derive(Clone, Copy)]
pub struct CronExpression {
    pub(crate) minutes: u64,
    pub(crate) hours: u64,
    days: u64,
    pub(crate) months: u64,
    /// 0 is Sunday.
    weekdays: u64,
    /// Neither the day nor the weekday was written `*`, so POSIX has either of them match.
    day_or_weekday: bool,
}

#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq)]
pub enum CronError {
    #[error("Invalid cron expression: unrecognized field syntax")]
    InvalidField,
    #[error("Invalid cron expression: step value must be a positive integer")]
    InvalidStep,
    #[error(
        "Invalid cron expression: range must be ascending (use 'a,b' or 'a-max,0-b' for wrap-around)"
    )]
    InvalidRange,
    #[error("Invalid cron expression: value out of range for field")]
    InvalidNumber,
    #[error(
        "Invalid cron expression: too many fields. Bun.cron uses 5 fields (minute hour day month weekday) \u{2014} seconds are not supported"
    )]
    TooManyFields,
    #[error(
        "Invalid cron expression: expected 5 space-separated fields (minute hour day month weekday)"
    )]
    TooFewFields,
}

/// `month` and `day` count from 1, `weekday` from Sunday.
#[derive(Clone, Copy)]
pub struct WallClock {
    pub year: i32,
    pub month: i32,
    pub day: i32,
    pub hour: i32,
    pub minute: i32,
    pub weekday: i32,
}

pub trait TimeZone {
    type Error;
    /// No instant further than this from the epoch is converted.
    const MAX_MS: f64;
    fn utc(&self) -> Self;
    fn wall_clock(&self, ms: f64) -> WallClock;
    /// The earlier instant of a repeated time, and the one after the shift of a skipped time. UTC carries a month or day past its end.
    fn instant(&self, at: WallClock) -> Result<f64, Self::Error>;
}

impl CronExpression {
    /// Five fields, or a nickname.
    pub fn parse(input: &[u8]) -> Result<CronExpression, CronError> {
        let expr = strings::trim(input, b" \t");
        if expr.first() == Some(&b'@') {
            return strings::in_map_case_insensitive(expr, &NICKNAMES)
                .ok_or(CronError::InvalidField);
        }

        let mut fields = strings::tokenize_any(expr, b" \t");
        let mut field = || fields.next().ok_or(CronError::TooFewFields);
        let (minute, hour, day, month, weekday) =
            (field()?, field()?, field()?, field()?, field()?);
        if field().is_ok() {
            return Err(CronError::TooManyFields);
        }

        let unnamed = |_: &[u8]| None;
        let month_named = |name: &[u8]| strings::in_map_case_insensitive(name, &MONTHS);
        let weekday_named = |name: &[u8]| strings::in_map_case_insensitive(name, &WEEKDAYS);
        Ok(CronExpression {
            minutes: parse_field(minute, 0, 59, unnamed)?,
            hours: parse_field(hour, 0, 23, unnamed)?,
            days: parse_field(day, 1, 31, unnamed)?,
            months: parse_field(month, 1, 12, month_named)?,
            // 7 becomes Sunday after ranges are expanded, so that `5-7` ascends.
            weekdays: parse_field(weekday, 0, 7, weekday_named)
                .map(|set| (set | set >> 7) & ALL_WEEKDAYS)?,
            day_or_weekday: day != b"*" && weekday != b"*",
        })
    }

    /// The five fields as the OS schedulers see them: `None` where every value matches, however it was written.
    pub(crate) fn restricted_fields(&self) -> [Option<u64>; 5] {
        [
            (self.minutes, ALL_MINUTES),
            (self.hours, ALL_HOURS),
            (self.days, ALL_DAYS),
            (self.months, ALL_MONTHS),
            (self.weekdays, ALL_WEEKDAYS),
        ]
        .map(|(set, all)| (set != all).then_some(set))
    }

    fn matches_day(&self, at: WallClock) -> bool {
        let (day, weekday) = (has(self.days, at.day), has(self.weekdays, at.weekday));
        if self.day_or_weekday {
            day || weekday
        } else {
            day && weekday
        }
    }

    fn matches(&self, at: WallClock) -> bool {
        has(self.minutes, at.minute)
            && has(self.hours, at.hour)
            && has(self.months, at.month)
            && self.matches_day(at)
    }

    /// The instant after `from_ms` for the matching time `at`. `None`: a fixed time fires once when clocks go back, as in cronie.
    fn resolve_match<Z: TimeZone>(
        &self,
        zone: &Z,
        at: WallClock,
        from_ms: f64,
        from: WallClock,
    ) -> Result<Option<f64>, Z::Error> {
        let result = zone.instant(at)?;
        // The walk steps over the repeated hour, in which a `*` minute or hour fires again.
        if self.minutes == ALL_MINUTES || self.hours == ALL_HOURS {
            let wall_from = zone.utc().instant(from)?;
            let wall_at = zone.utc().instant(at)?;
            // Clocks went back if `at` has passed, or more real time than wall time separates the two.
            if result <= from_ms || result - from_ms > wall_at - wall_from {
                let mut probe = ((from_ms / MINUTE_MS).floor() + 1.0) * MINUTE_MS;
                let mut cap = from_ms + (MAX_DST_SHIFT_MIN + 1.0) * MINUTE_MS;
                if result > from_ms {
                    cap = cap.min(result);
                }
                while probe < cap {
                    if self.matches(zone.wall_clock(probe)) {
                        return Ok(Some(probe));
                    }
                    probe += MINUTE_MS;
                }
            }
        }
        Ok((result > from_ms).then_some(result))
    }

    /// The first match strictly after `from_ms`, within 8 years and within `Z::MAX_MS`.
    pub fn next<Z: TimeZone>(&self, zone: &Z, from_ms: f64) -> Result<Option<f64>, Z::Error> {
        if from_ms.is_nan() || from_ms.abs() > Z::MAX_MS {
            return Ok(None);
        }
        let from = zone.wall_clock(from_ms);
        let mut at = from;
        at.minute += 1;

        while at.year - from.year <= 8 {
            // Carried by hand, so that the fields see the hour and minute before DST shifts them.
            if at.minute > 59 {
                at.minute -= 60;
                at.hour += 1;
            }
            if at.hour > 23 {
                at.hour -= 24;
                at.day += 1;
            }
            let noon_ms = zone.utc().instant(WallClock {
                hour: 12,
                minute: 0,
                ..at
            })?;
            // No instant of a later day is in range in any zone, and converting this one asserts or gives year 0.
            if noon_ms > Z::MAX_MS + 12.0 * 60.0 * MINUTE_MS {
                return Ok(None);
            }
            at = WallClock {
                hour: at.hour,
                minute: at.minute,
                ..zone.utc().wall_clock(noon_ms)
            };

            if !has(self.months, at.month) {
                (at.month, at.day, at.hour, at.minute) = (at.month + 1, 1, 0, 0);
            } else if !self.matches_day(at) {
                (at.day, at.hour, at.minute) = (at.day + 1, 0, 0);
            } else if !has(self.hours, at.hour) {
                (at.hour, at.minute) = (at.hour + 1, 0);
            } else if has(self.minutes, at.minute)
                && let Some(ms) = self.resolve_match(zone, at, from_ms, from)?
                && ms <= Z::MAX_MS
            {
                return Ok(Some(ms));
            } else {
                at.minute += 1;
            }
        }
        Ok(None)
    }
}

/// The numeric form, which every OS scheduler's entry carries: `*` or a list in each field.
impl fmt::Display for CronExpression {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut separator = "";
        for field in self.restricted_fields() {
            match field {
                None => write!(f, "{separator}*")?,
                Some(set) => {
                    for value in values(set) {
                        write!(f, "{separator}{value}")?;
                        separator = ",";
                    }
                }
            }
            separator = " ";
        }
        Ok(())
    }
}

const MINUTE_MS: f64 = 60_000.0;
const MAX_DST_SHIFT_MIN: f64 = 120.0;

const ALL_MINUTES: u64 = (1 << 60) - 1;
pub(crate) const ALL_HOURS: u64 = (1 << 24) - 1;
pub(crate) const ALL_DAYS: u64 = (1 << 32) - 2;
const ALL_MONTHS: u64 = (1 << 13) - 2;
const ALL_WEEKDAYS: u64 = (1 << 7) - 1;

const HOURLY: CronExpression = CronExpression {
    minutes: 1,
    hours: ALL_HOURS,
    days: ALL_DAYS,
    months: ALL_MONTHS,
    weekdays: ALL_WEEKDAYS,
    day_or_weekday: false,
};
const DAILY: CronExpression = CronExpression { hours: 1, ..HOURLY };
const WEEKLY: CronExpression = CronExpression {
    weekdays: 1,
    ..DAILY
};
const MONTHLY: CronExpression = CronExpression { days: 2, ..DAILY };
const YEARLY: CronExpression = CronExpression {
    months: 2,
    ..MONTHLY
};

bun_core::comptime_string_map! {
    static NICKNAMES: CronExpression = {
        b"@yearly" => YEARLY,   b"@annually" => YEARLY,
        b"@monthly" => MONTHLY, b"@weekly" => WEEKLY,
        b"@daily" => DAILY,     b"@midnight" => DAILY,
        b"@hourly" => HOURLY,
    };
}

bun_core::comptime_string_map! {
    static WEEKDAYS: u8 = {
        b"sun" => 0,       b"mon" => 1,        b"tue" => 2,
        b"wed" => 3,       b"thu" => 4,        b"fri" => 5,
        b"sat" => 6,       b"sunday" => 0,     b"monday" => 1,
        b"tuesday" => 2,   b"wednesday" => 3,  b"thursday" => 4,
        b"friday" => 5,    b"saturday" => 6,
    };
}

bun_core::comptime_string_map! {
    static MONTHS: u8 = {
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

/// A list of `*`, `a` or `a-b`, each with an optional `/step`.
fn parse_field(
    field: &[u8],
    min: u8,
    max: u8,
    named: fn(&[u8]) -> Option<u8>,
) -> Result<u64, CronError> {
    let value = |text: &[u8]| {
        named(text)
            .or_else(|| bun_core::parse_decimal::<u8>(text).filter(|n| (min..=max).contains(n)))
            .ok_or(CronError::InvalidNumber)
    };
    let mut set = 0;
    for part in strings::split(field, b",") {
        if part.is_empty() {
            return Err(CronError::InvalidField);
        }
        let (base, step) = match strings::split_once_char(part, b'/') {
            None => (part, None),
            Some((base, step)) => match bun_core::parse_decimal::<u8>(step) {
                Some(step @ 1..=127) => (base, Some(step)),
                _ => return Err(CronError::InvalidStep),
            },
        };
        let (low, high) = if base == b"*" {
            (min, max)
        } else if let Some((low @ [_, ..], high)) = strings::split_once_char(base, b'-')
            && !strings::contains_char(high, b'-')
        {
            (value(low)?, value(high)?)
        } else {
            let low = value(base)?;
            (low, if step.is_some() { max } else { low })
        };
        if low > high {
            return Err(CronError::InvalidRange);
        }
        for n in (low..=high).step_by(step.unwrap_or(1).into()) {
            set |= 1 << n;
        }
    }
    Ok(set)
}

fn has(set: u64, value: i32) -> bool {
    (set.checked_shr(value.cast_unsigned())).is_some_and(|shifted| shifted & 1 != 0)
}

/// Ascending.
pub(crate) fn values(set: u64) -> impl Iterator<Item = u32> {
    (0..u64::BITS).filter(move |n| set >> n & 1 != 0)
}
