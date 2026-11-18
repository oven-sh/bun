mod support;

use bun_engine_temporal::{
    CalendarId, Duration, FractionalSecondDigits, Instant, PlainDate, PlainDateTime, PlainMonthDay,
    PlainTime, PlainYearMonth, Precision, PrecisionOptions, RelativeTo, RoundingMode, ShowCalendar,
    ShowOffset, ShowTimeZone, Unit, UnitOption, ZonedDateTime, ZonedDisplay, find_time_zone,
    parse_time_zone,
};
use bun_engine_text::Text;
use support::*;

/// A letter for each type that takes the string, whichever width it is stored in.
fn accepted_by(source: &str) -> String {
    let check = |text: Text<'_>| -> String {
        [
            ('d', PlainDate::parse(text).is_ok()),
            ('t', PlainTime::parse(text).is_ok()),
            ('y', PlainYearMonth::parse(text).is_ok()),
            ('m', PlainMonthDay::parse(text).is_ok()),
            ('i', Instant::parse(text).is_ok()),
            ('z', ZonedDateTime::parse(text).is_ok()),
            ('r', RelativeTo::parse(text).is_ok()),
            ('c', CalendarId::parse(text).is_ok()),
            ('o', parse_time_zone(text).is_ok()),
        ]
        .into_iter()
        .filter_map(|(letter, is_accepted)| is_accepted.then_some(letter))
        .collect()
    };
    let wide: Vec<u16> = source.encode_utf16().collect();
    let letters = check(Text::Utf16(&wide));
    if source.is_ascii() {
        assert_eq!(check(text(source)), letters);
    }
    letters
}

#[test]
fn goal_symbols() {
    for (source, expected) in [
        ("2020-02-29", "dymrc"),
        ("20200229", "dymrc"),
        ("+002020-02-29", "dymrc"),
        ("2020-0229", "tco"),
        ("202002-29", ""),
        ("2021-02-29", ""),
        ("-000000-01-01", ""),
        ("\u{2212}002020-01-01", ""),
        ("2020-01-01T12", "dtymrc"),
        ("2020-01-01 12:30", "dtymrc"),
        ("2020-01-01t123060,123456789", "dtymrc"),
        ("2020-01-01T12:30:00.1234567890", ""),
        ("2020-01-01T12:3000", ""),
        ("2020-01-01T24:00", ""),
        ("2020-01-01T12:30.5", ""),
        ("2020-01-01T12Z", "ico"),
        ("2020-01-01Z", ""),
        ("2020-01-01T12+01", "dtymirco"),
        ("2020-01-01T12+01:00:00.5", "dtymirc"),
        ("2020-01-01T12+01:00:60", ""),
        ("2020-01-01T12Z[UTC]", "izrco"),
        ("2020-01-01[!Europe/Paris]", "dymzrco"),
        ("2020-01-01[+01:00]", "dymzrco"),
        ("2020-01-01[+01:00:00]", ""),
        ("2020-01-01[Not/Known]", "dymc"),
        ("2020-01-01[Trailing/]", ""),
        ("2020-01-01[UTC][UTC]", ""),
        ("2020-01-01[u-ca=iso8601][UTC]", ""),
        ("2020-01-01[u-ca=HEBREW]", "dymrc"),
        ("2020-01-01[U-CA=hebrew]", ""),
        ("2020-01-01[u-ca=hebrew][u-ca=x]", "dymrc"),
        ("2020-01-01[!u-ca=hebrew][u-ca=roc]", ""),
        ("2020-01-01[u-ca=hebrew][!u-ca=roc]", ""),
        ("2020-01-01T12Z[u-ca=gregorian]", "io"),
        ("2020-01-01[_x-1=a-b]", "dymrc"),
        ("2020-01-01[!x=a]", ""),
        ("2020-01-01[x=a--b]", ""),
        ("2020-01-01[x=-]", ""),
        ("2020-01", "yc"),
        ("202001", "yc"),
        ("2020-01[u-ca=hebrew]", ""),
        ("--02-29", "mc"),
        ("0229", "mc"),
        ("0230", "tc"),
        ("12-14", "mc"),
        ("T12-14", "tc"),
        ("T12:00-14", "tco"),
        ("2021-13", "tco"),
        ("12:30Z", ""),
        ("12:30[UTC]", "tco"),
        ("", ""),
        ("utc", "o"),
        ("-0130", "o"),
        ("iso8601", "c"),
        ("2020-01-01\0", ""),
    ] {
        assert_eq!(accepted_by(source), expected, "{source}");
    }
}

#[test]
fn durations() {
    for (source, expected) in [
        ("P1Y2M3W4DT5H6M7.00800901S", "P1Y2M3W4DT5H6M7.00800901S"),
        ("-p1y2dt1.5h", "-P1Y2DT1H30M"),
        ("+PT0,000000001H", "PT0.0000036S"),
        ("PT1.000000001M", "PT1M0.00000006S"),
        ("-PT0S", "PT0S"),
        ("P0D", "PT0S"),
        (
            "PT9007199254740991.999999999S",
            "PT9007199254740991.999999999S",
        ),
        ("P4294967295Y", "P4294967295Y"),
    ] {
        assert_eq!(duration_string(&duration(source)), expected);
    }
    for source in [
        "",
        "P",
        "PT",
        "P1DT",
        "P1",
        "P1D1Y",
        "PT1S1M",
        "P1.5D",
        "PT1.5H1M",
        "PT1.S",
        "PT.5S",
        "1D",
        "PT1.1234567890S",
        "P1D ",
        "--P1D",
    ] {
        assert_eq!(
            message(Duration::parse(text(source)).unwrap_err()),
            format!("'{source}' is not a valid Duration string")
        );
    }
    for source in [
        "P4294967296Y",
        "PT9007199254740992S",
        &format!("P{}D", "9".repeat(400)),
    ] {
        assert_eq!(
            message(Duration::parse(text(source)).unwrap_err()),
            "Temporal.Duration properties must be finite and of consistent sign"
        );
    }
}

fn digits(count: u8, rounding_mode: RoundingMode) -> PrecisionOptions {
    PrecisionOptions {
        fractional_second_digits: FractionalSecondDigits::from_number(count.into()).unwrap(),
        rounding_mode,
        smallest_unit: None,
    }
}

#[test]
fn precision() {
    let value = date_time("1999-12-31T23:59:59.987654321");
    let write = |options| {
        let precision = PlainDateTime::precision(options).unwrap();
        let rounded = value.round_for_text(precision).unwrap();
        string(&rounded.to_text(precision, ShowCalendar::Auto))
    };
    for count in 1..=9 {
        assert_eq!(
            write(digits(count, RoundingMode::Trunc)),
            "1999-12-31T23:59:59.987654321"[..20 + usize::from(count)]
        );
    }
    assert_eq!(write(digits(0, RoundingMode::Trunc)), "1999-12-31T23:59:59");
    assert_eq!(
        write(digits(1, RoundingMode::Ceil)),
        "2000-01-01T00:00:00.0"
    );
    let minute = PrecisionOptions {
        smallest_unit: Some(UnitOption::Unit(Unit::Minute)),
        ..digits(3, RoundingMode::Floor)
    };
    assert_eq!(write(minute), "1999-12-31T23:59");

    let write = |source, options| {
        let precision = Duration::precision(options).unwrap();
        let rounded = duration(source).round_for_text(precision).unwrap();
        string(&rounded.to_text(precision))
    };
    assert_eq!(
        write("PT1H90M", digits(9, RoundingMode::Trunc)),
        "PT1H90M0.000000000S"
    );
    assert_eq!(
        write("PT1H90M", digits(8, RoundingMode::Trunc)),
        "PT2H30M0.00000000S"
    );
    assert_eq!(write("-PT59.9S", digits(0, RoundingMode::Floor)), "-PT60S");
    assert!(Duration::precision(minute).is_err());
}

#[test]
fn years_offsets_and_annotations() {
    for source in [
        "0000-01-01",
        "9999-12-31",
        "+010000-01-01",
        "-000001-12-31",
        "-271821-04-19",
    ] {
        assert_eq!(date_string(date(source)), source);
    }
    let value = zoned("1970-01-01T00:00[africa/monrovia][u-ca=roc]");
    assert_eq!(string(&value.offset_text()), "-00:44:30");
    assert_eq!(
        zoned_string(&value),
        "1970-01-01T00:00:00-00:45[Africa/Monrovia][u-ca=roc]"
    );
    let display = ZonedDisplay {
        calendar: ShowCalendar::Critical,
        offset: ShowOffset::Never,
        time_zone: ShowTimeZone::Critical,
    };
    assert_eq!(
        string(&value.to_text(Precision::AUTO, display)),
        "1970-01-01T00:00:00[!Africa/Monrovia][!u-ca=roc]"
    );
    let epoch = instant("1970-01-01T01:00:00.5+01:00:01");
    assert_eq!(
        string(&epoch.to_text(None, Precision::AUTO)),
        "1969-12-31T23:59:59.5Z"
    );
    assert_eq!(
        string(&epoch.to_text(find_time_zone(text("-00")), Precision::AUTO)),
        "1969-12-31T23:59:59.5+00:00"
    );

    let month = date("2020-03-15").to_plain_year_month().unwrap();
    assert_eq!(string(&month.to_text(ShowCalendar::Auto)), "2020-03");
    assert_eq!(
        string(&month.to_text(ShowCalendar::Always)),
        "2020-03-01[u-ca=iso8601]"
    );
    let day = date("2020-03-15[u-ca=hebrew]")
        .to_plain_month_day()
        .unwrap();
    assert_eq!(string(&day.to_text(ShowCalendar::Never)), "1972-03-05");
}

#[test]
fn messages_shorten_what_they_quote() {
    let long = "x".repeat(101);
    assert_eq!(
        message(CalendarId::parse(text(&long)).unwrap_err()),
        format!(
            "'{}\u{2026}' is not a valid calendar identifier",
            &long[..99]
        )
    );
    assert_eq!(
        message(PlainDate::parse(text("2020-01-01[u-ca=foo]")).unwrap_err()),
        "'foo' is not a valid calendar identifier"
    );
    assert_eq!(
        message(FractionalSecondDigits::from_number(10.5).unwrap_err()),
        "fractionalSecondDigits must be 'auto' or 0 through 9, not 10"
    );
}
