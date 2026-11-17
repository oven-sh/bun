#[path = "../parsers/native_test_shims.rs"]
mod native_test_shims;

use bstr::BStr;
use bun_core::strings;

use crate::{
    CronError, CronExpression, Registration, TimeZone, Title, WallClock, crontab, launchd, schtasks,
};

fn parse(text: &str) -> CronExpression {
    CronExpression::parse(text.as_bytes()).unwrap()
}

fn job<'a>(schedule: &str, exe: &'a [u8], script: &'a [u8]) -> Registration<'a> {
    Registration {
        title: Title::new(b"my_Job-1").unwrap(),
        schedule: parse(schedule),
        exe,
        script,
    }
}

/// What lies between the lines `after` and `before`.
fn between<'a>(text: &'a str, after: &str, before: &str) -> &'a BStr {
    let (_, rest) = strings::split_once(text.as_bytes(), after.as_bytes()).unwrap();
    BStr::new(strings::split_once(rest, before.as_bytes()).unwrap().0)
}

#[test]
fn normalizes() {
    for (text, numeric) in [
        ("* * * * *", "* * * * *"),
        (" \t0  0\t1 1 * ", "0 0 1 1 *"),
        (
            "*/20 1-3 */10 */5 */3",
            "0,20,40 1,2,3 1,11,21,31 1,6,11 0,3,6",
        ),
        (
            "50/4 5-23/9 3,1,2 jan,DEC Mon-wednesday",
            "50,54,58 5,14,23 1,2,3 1,12 1,2,3",
        ),
        ("0-59 */1 1-31 1-12 0-7", "* * * * *"),
        ("0 0 * * 5-7", "0 0 * * 0,5,6"),
        ("0 0 * * 7", "0 0 * * 0"),
        ("*/127 -0 +1 1_0 *", "0 0 1 10 *"),
        ("@yearly", "0 0 1 1 *"),
        ("@ANNUALLY", "0 0 1 1 *"),
        ("@monthly", "0 0 1 * *"),
        ("@weekly", "0 0 * * 0"),
        ("@daily", "0 0 * * *"),
        (" @Midnight\t", "0 0 * * *"),
        ("@hourly", "0 * * * *"),
    ] {
        assert_eq!(parse(text).to_string(), numeric, "{text}");
    }
}

#[test]
fn refuses() {
    use CronError::*;
    for (text, error) in [
        ("", TooFewFields),
        ("x x x x", TooFewFields),
        ("x x x x x x", TooManyFields),
        ("@reboot", InvalidField),
        ("@daily x", InvalidField),
        ("1,,2 * * * *", InvalidField),
        ("*/0 * * * *", InvalidStep),
        ("*/128 * * * *", InvalidStep),
        ("*/ * * * *", InvalidStep),
        ("99/1/1 * * * *", InvalidStep),
        ("5-1 * * * *", InvalidRange),
        ("* * * * sat-sun", InvalidRange),
        ("60 * * * *", InvalidNumber),
        ("* * 0 * *", InvalidNumber),
        ("* * * * 8", InvalidNumber),
        ("mon * * * *", InvalidNumber),
        ("1- * * * *", InvalidNumber),
        ("0--0 * * * *", InvalidNumber),
        ("/5 * * * *", InvalidNumber),
        ("60 */0 * * *", InvalidNumber),
    ] {
        assert_eq!(
            CronExpression::parse(text.as_bytes()).err(),
            Some(error),
            "{text}"
        );
    }
}

const MINUTE: i64 = 60_000;

/// Minutes since 1970 of a time whose month and day may be past their end.
fn minutes(year: i32, month: i32, day: i32, hour: i32, minute: i32) -> i64 {
    let months = i64::from(year) * 12 + i64::from(month) - 3;
    let (y, m) = (months.div_euclid(12), months.rem_euclid(12));
    let leap_days = y.div_euclid(4) - y.div_euclid(100) + y.div_euclid(400);
    let days = y * 365 + leap_days + (153 * m + 2) / 5 + i64::from(day) - 719_469;
    days * 1440 + i64::from(hour * 60 + minute)
}

/// UTC, but `shift` minutes ahead from 02:00 on 8 March until 02:00 on 1 November 2026.
struct Zone {
    shift: i64,
}

impl Zone {
    fn offset(&self, utc: i64) -> i64 {
        let summer = minutes(2026, 3, 8, 2, 0)..minutes(2026, 11, 1, 2, 0) - self.shift;
        if summer.contains(&utc) { self.shift } else { 0 }
    }
}

impl TimeZone for Zone {
    type Error = core::convert::Infallible;
    const MAX_MS: f64 = 4_102_444_800_000.0;

    fn utc(&self) -> Zone {
        Zone { shift: 0 }
    }

    fn wall_clock(&self, ms: f64) -> WallClock {
        let utc = (ms as i64).div_euclid(MINUTE);
        let local = utc + self.offset(utc);
        let month = (1..)
            .find(|&m| minutes(1970, m + 1, 1, 0, 0) > local)
            .unwrap();
        let rest = (local - minutes(1970, month, 1, 0, 0)) as i32;
        WallClock {
            year: 1970 + (month - 1) / 12,
            month: (month - 1) % 12 + 1,
            day: rest / 1440 + 1,
            hour: rest / 60 % 24,
            minute: rest % 60,
            weekday: ((local / 1440 + 4) % 7) as i32,
        }
    }

    fn instant(&self, at: WallClock) -> Result<f64, Self::Error> {
        let local = minutes(at.year, at.month, at.day, at.hour, at.minute);
        Ok(((local - self.offset(local - self.shift)) * MINUTE) as f64)
    }
}

/// The instant of `"2026-06-15 09:00"` in UTC.
fn utc(text: &str) -> f64 {
    let number = |part| bun_core::parse_decimal::<u16>(part).unwrap().into();
    let parts: Vec<i32> = (strings::tokenize_any(text.as_bytes(), b"- :").map(number)).collect();
    let [year, month, day, hour, minute] = parts.try_into().unwrap();
    (minutes(year, month, day, hour, minute) * MINUTE) as f64
}

#[track_caller]
fn assert_next(zone: &Zone, text: &str, after: &str, expected: Option<&str>) {
    let Ok(next) = parse(text).next(zone, utc(after));
    assert_eq!(next, expected.map(utc), "{text} after {after}");
}

#[test]
fn next() {
    let zone = Zone { shift: 0 };
    for (text, after, expected) in [
        ("0 9 * * *", "2026-06-15 09:00", Some("2026-06-16 09:00")),
        ("* * * * *", "2026-12-31 23:59", Some("2027-01-01 00:00")),
        ("0 0 13 * fri", "2026-01-01 00:00", Some("2026-01-02 00:00")),
        ("0 0 * * mon", "2026-11-16 12:00", Some("2026-11-23 00:00")),
        ("0 0 1-31 * 1", "2026-11-16 12:00", Some("2026-11-17 00:00")),
        ("0 0 29 feb *", "2026-01-01 00:00", Some("2028-02-29 00:00")),
        ("0 0 30 feb *", "2026-01-01 00:00", None),
        // `Zone::MAX_MS` is 2100-01-01 00:00.
        ("* * * * *", "2099-12-31 23:59", Some("2100-01-01 00:00")),
        ("* * * * *", "2100-01-01 00:00", None),
        ("* * * * *", "2100-01-01 00:01", None),
        ("0 0 2 jan *", "2099-06-01 00:00", None),
    ] {
        assert_next(&zone, text, after, expected);
    }
    let Ok(next) = parse("* * * * *").next(&zone, f64::NAN);
    assert_eq!(next, None);
}

#[test]
fn next_when_clocks_change() {
    let zone = Zone { shift: 60 };
    for (text, after, expected) in [
        // 02:30 is skipped, and fires at 03:30, which is 02:30 UTC.
        ("30 2 * * *", "2026-03-08 00:00", "2026-03-08 02:30"),
        // 01:30 comes at 00:30 and at 01:30 UTC: a fixed time fires once, a `*` twice.
        ("30 1 * * *", "2026-10-31 23:00", "2026-11-01 00:30"),
        ("30 1 * * *", "2026-11-01 00:30", "2026-11-02 01:30"),
        ("30 * * * *", "2026-11-01 00:30", "2026-11-01 01:30"),
        ("* 1 * * *", "2026-11-01 00:59", "2026-11-01 01:00"),
    ] {
        assert_next(&zone, text, after, Some(expected));
    }
    for (shift, text, after, expected) in [
        (30, "45 * * * *", "2026-11-01 01:15", "2026-11-01 01:45"),
        (120, "30 * * * *", "2026-10-31 23:30", "2026-11-01 00:30"),
    ] {
        assert_next(&Zone { shift }, text, after, Some(expected));
    }
}

#[test]
fn titles() {
    assert_eq!(Title::new(b"aZ09-_").unwrap().to_string(), "aZ09-_");
    for title in ["", "a b", "a/b", "a.b", "a\n", "a'", "<", "\u{e9}"] {
        assert!(Title::new(title.as_bytes()).is_none(), "{title}");
    }
}

#[test]
fn crontab_entry() {
    assert_eq!(
        crontab::entry(&job("@weekly", b"/x/bun", b"/a b/\xff.ts")),
        "# bun-cron: my_Job-1\n0 0 * * 0 '/x/bun' run --cron-title=my_Job-1 --cron-period='0 0 * * 0' '/a b/\u{fffd}.ts'\n"
    );
}

#[test]
fn crontab_without_entry() {
    for (table, kept) in [
        ("", ""),
        ("a\n\nb", "a\nb\n"),
        ("a\n# bun-cron: t\nold\nb\n", "a\nb\n"),
        (" \t# bun-cron: t \nold\n# bun-cron: t\nolder\n", ""),
        ("# bun-cron: t2\nother\n", "# bun-cron: t2\nother\n"),
        ("# bun-cron: t\r\nx\n", "# bun-cron: t\r\nx\n"),
        ("# bun-cron: t\n\nx\n", "x\n"),
        ("a\n# bun-cron: t", "a\n"),
    ] {
        let without = crontab::without_entry(table.as_bytes(), &Title::new(b"t").unwrap());
        assert_eq!(BStr::new(&without), kept, "{table:?}");
    }
}

#[test]
fn plist() {
    assert_eq!(
        launchd::plist(&job("30 2 * * 1", b"/a&b/<bun>", b"/\"it's\"/\xff.ts")),
        include_str!("tests/job.plist")
    );
    let dict = |keys: &[(&str, u8)]| {
        let keys = keys.iter().map(|(key, value)| {
            format!("        <key>{key}</key>\n        <integer>{value}</integer>\n")
        });
        format!(
            "    <dict>\n{}    </dict>\n",
            keys.collect::<Vec<_>>().concat()
        )
    };
    let array = |dicts: &[&[(&str, u8)]]| {
        let dicts = dicts.iter().map(|keys| dict(keys));
        format!(
            "    <array>\n{}    </array>\n",
            dicts.collect::<Vec<_>>().concat()
        )
    };
    for (text, interval) in [
        ("* * * * *", dict(&[])),
        (
            "0 0 1-31 * 1",
            dict(&[("Minute", 0), ("Hour", 0), ("Weekday", 1)]),
        ),
        (
            "0,30 1,2 * * *",
            array(&[
                &[("Minute", 0), ("Hour", 1)],
                &[("Minute", 0), ("Hour", 2)],
                &[("Minute", 30), ("Hour", 1)],
                &[("Minute", 30), ("Hour", 2)],
            ]),
        ),
        (
            "* * 13 2 5",
            array(&[
                &[("Day", 13), ("Month", 2)],
                &[("Month", 2), ("Weekday", 5)],
            ]),
        ),
    ] {
        let plist = launchd::plist(&job(text, b"", b""));
        let (after, before) = ("<key>StartCalendarInterval</key>\n", "<key>StandardOutPath");
        assert_eq!(between(&plist, after, before), interval, "{text}");
    }
}

#[test]
fn task_xml() {
    let xml =
        |text| schtasks::task_xml(&job(text, b"C:\\a&b\\bun.exe", b"C:\\<\"it's\">\\\xff.ts"));
    assert_eq!(
        xml("5 1,13 1,15 2 1").unwrap(),
        include_str!("tests/task.xml")
    );

    for (text, start, interval) in [
        ("* * * * *", "00:00", "PT1M"),
        ("5/15 * * * *", "00:05", "PT15M"),
        ("0 * * * *", "00:00", "PT60M"),
        ("30 1/6 * * *", "01:30", "PT6H"),
        ("30 5 1-31 * 0-7", "05:30", "PT24H"),
    ] {
        let xml = xml(text).unwrap();
        assert_eq!(between(&xml, "2000-01-01T", ":00<"), start, "{text}");
        assert_eq!(between(&xml, "<Interval>", "<"), interval, "{text}");
    }

    for (text, triggers, schedule) in [
        ("0 */5 * * *", 5, "ScheduleByDay"),
        ("0,30 0,12 * * *", 4, "ScheduleByDay"),
        ("0 0 * * 1-5", 1, "ScheduleByWeek"),
        ("0 0 * 2 1", 1, "ScheduleByMonthDayOfWeek"),
        ("0 0 1 * *", 1, "ScheduleByMonth"),
        ("0 0 * 2 *", 1, "ScheduleByMonth"),
        ("0-47 0 * * *", 48, "ScheduleByDay"),
        ("0-23 0 1 * 1", 48, "ScheduleByMonth"),
    ] {
        let xml = xml(text).unwrap();
        let parts = strings::split(xml.as_bytes(), b"<CalendarTrigger>");
        assert_eq!(parts.count() - 1, triggers, "{text}");
        assert_eq!(
            between(&xml, "</StartBoundary>\n      <", ">"),
            schedule,
            "{text}"
        );
    }
    for text in ["0-48 0 * * *", "0-24 0 1 * 1", "*/7 * * * *", "* * * * 1"] {
        assert_eq!(xml(text), Err(schtasks::TooManyTriggers), "{text}");
    }
}

#[test]
fn schtasks_failure() {
    assert_eq!(
        schtasks::explain_failure(b" \r\nERROR: x\r\n\x0b\x0c"),
        b"ERROR: x"
    );
    assert_eq!(schtasks::explain_failure(b" \r\n"), b"");
    let sid =
        schtasks::explain_failure(b"ERROR: No mapping between account names and security IDs");
    assert!(sid.starts_with(b"Failed to register cron job: your Windows account's Security"));
    assert!(sid.ends_with(b" with: schtasks /create /xml <file> /tn <name> /ru SYSTEM /f"));
}
