//! `Date`, and the ranges of time that a script can ask about.

use crate::builtins::nth;
use crate::machine::*;

const DAY: f64 = 86_400_000.0;
const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

struct Fields {
    year: i64,
    /// From 0.
    month: i64,
    date: i64,
    day: i64,
    hours: i64,
    minutes: i64,
    seconds: i64,
    milliseconds: i64,
}

impl Fields {
    /// <https://howardhinnant.github.io/date_algorithms.html#civil_from_days>
    fn of(time: f64) -> Fields {
        let (days, rest) = (time.div_euclid(DAY) as i64, time.rem_euclid(DAY) as i64);
        let (era, of_era) = (
            (days + 719_468).div_euclid(146_097),
            (days + 719_468).rem_euclid(146_097),
        );
        let year = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
        let of_year = of_era - (365 * year + year / 4 - year / 100);
        let from_march = (5 * of_year + 2) / 153;
        Fields {
            year: year + era * 400 + i64::from(from_march >= 10),
            month: (from_march + 2) % 12,
            date: of_year - (153 * from_march + 2) / 5 + 1,
            day: (days + 4).rem_euclid(7),
            hours: rest / 3_600_000,
            minutes: rest / 60_000 % 60,
            seconds: rest / 1000 % 60,
            milliseconds: rest % 1000,
        }
    }
}

fn time_of([year, month, date, hours, minutes, seconds, milliseconds]: [f64; 7]) -> f64 {
    let (year, from_march) = (
        year + (month - 2.0).div_euclid(12.0),
        (month - 2.0).rem_euclid(12.0),
    );
    let days = year * 365.0 + year.div_euclid(4.0) - year.div_euclid(100.0)
        + year.div_euclid(400.0)
        + (153.0 * from_march + 2.0).div_euclid(5.0);
    (days + date - 719_469.0) * DAY
        + hours * 3_600_000.0
        + minutes * 60_000.0
        + seconds * 1000.0
        + milliseconds
}

pub(crate) fn new_date(
    it: &mut Machine<'_>,
    name: &str,
    _: &Value,
    arguments: &[Value],
) -> Outcome {
    let time = match arguments {
        _ if name == "now" => return Ok(it.host.now().into()),
        [] => it.host.now(),
        [Value::String(text)] => bun_core::wtf::parse_date(text).unwrap_or(f64::NAN),
        [time] => it.number(time)?,
        _ => {
            let mut parts = [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0];
            for (part, given) in parts.iter_mut().zip(arguments) {
                *part = it.number(given)?.trunc();
            }
            parts[0] += if (0.0..100.0).contains(&parts[0]) {
                1900.0
            } else {
                0.0
            };
            let local = time_of(parts);
            local - it.host.offset_at(local)
        }
    };
    let time = if time.abs() <= 8.64e15 {
        time.trunc()
    } else {
        f64::NAN
    };
    Ok(Value::Object(it.allocate(Kind::Date(time), Some(DATES))))
}

pub(crate) const DATE_METHODS: &[&str] = &[
    "getDate",
    "getDay",
    "getFullYear",
    "getHours",
    "getMinutes",
    "getMonth",
    "getSeconds",
    "getTime",
    "getTimezoneOffset",
    "getUTCDate",
    "getUTCDay",
    "getUTCFullYear",
    "getUTCHours",
    "getUTCMinutes",
    "getUTCMonth",
    "getUTCSeconds",
    "toISOString",
    "toString",
    "valueOf",
];

pub(crate) fn date_method(it: &mut Machine<'_>, name: &str, this: &Value, _: &[Value]) -> Outcome {
    let Some(&Kind::Date(time)) = it.kind(this) else {
        return it.incompatible();
    };
    match name {
        "toISOString" if time.is_nan() => return it.throw("RangeError", "Invalid time value"),
        "toString" if time.is_nan() => return Ok(b"Invalid Date"[..].into()),
        _ if time.is_nan() || matches!(name, "getTime" | "valueOf") => return Ok(time.into()),
        _ => {}
    }
    let offset = if name.starts_with("getUTC") || name == "toISOString" {
        0.0
    } else {
        it.host.offset_at(time)
    };
    let Fields {
        year,
        month,
        date,
        day,
        hours,
        minutes,
        seconds,
        milliseconds,
    } = Fields::of(time + offset);
    let field = match name.trim_start_matches("get").trim_start_matches("UTC") {
        "Date" => date,
        "Day" => day,
        "FullYear" => year,
        "Hours" => hours,
        "Minutes" => minutes,
        "Month" => month,
        "Seconds" => seconds,
        "TimezoneOffset" => (-offset / 60_000.0) as i64,
        "toISOString" => {
            return Ok(format!(
                "{year:04}-{:02}-{date:02}T{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}Z",
                month + 1
            )
            .as_bytes()
            .into());
        }
        _ => {
            let (day, month, ahead) = (
                DAYS[day as usize],
                MONTHS[month as usize],
                (offset / 60_000.0) as i64,
            );
            let zone = ahead / 60 * 100 + ahead % 60;
            return Ok(format!("{day} {month} {date:02} {year:04} {hours:02}:{minutes:02}:{seconds:02} GMT{zone:+05}").as_bytes().into());
        }
    };
    Ok((field as f64).into())
}

fn position_in(names: &[&str], value: &Value) -> f64 {
    let found = names.iter().position(
        |it| matches!(value, Value::String(text) if **text == *it.to_ascii_uppercase().as_bytes()),
    );
    found.map_or(-1.0, |it| it as f64)
}

/// `weekdayRange`, `timeRange` and `dateRange`
pub(crate) fn range(
    it: &mut Machine<'_>,
    name: &str,
    _: &Value,
    mut arguments: &[Value],
) -> Outcome {
    let mut now = it.host.now();
    match arguments {
        [before @ .., Value::String(last)] if **last == *b"GMT" => arguments = before,
        _ => now += it.host.offset_at(now),
    }
    if arguments.is_empty() {
        return Ok(false.into());
    }
    let (now, size) = (Fields::of(now), (arguments.len() / 2).max(1));
    let (from, to) = (&arguments[..size], &arguments[arguments.len() - size..]);
    let [now, from, to] = match name {
        "weekdayRange" => [
            now.day as f64,
            position_in(&DAYS, &from[0]),
            position_in(&DAYS, &to[0]),
        ],
        "timeRange" => {
            let mut seconds = |parts: &[Value], rest: f64| -> Outcome<f64> {
                Ok(it.integer(&parts[0], 0.0)? * 3600.0
                    + it.integer(nth(parts, 1), rest)? * 60.0
                    + it.integer(nth(parts, 2), rest)?)
            };
            [
                (now.hours * 3600 + now.minutes * 60 + now.seconds) as f64,
                seconds(from, 0.0)?,
                seconds(to, 59.0)?,
            ]
        }
        _ => {
            // What it weighs, and what the same part of today does.
            let weigh = |part: &Value| match *part {
                Value::Number(year) if year > 31.0 => [year * 512.0, now.year as f64 * 512.0],
                Value::Number(date) => [date, now.date as f64],
                _ => [position_in(&MONTHS, part) * 32.0, now.month as f64 * 32.0],
            };
            let total =
                |parts: &[Value], which: usize| parts.iter().map(|it| weigh(it)[which]).sum();
            [total(from, 1), total(from, 0), total(to, 0)]
        }
    };
    Ok(if from <= to {
        from <= now && now <= to
    } else {
        now >= from || now <= to
    }
    .into())
}
