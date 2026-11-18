mod support;

use core::cmp::Ordering;

use bun_engine_temporal::DifferenceOperation::{Since, Until};
use bun_engine_temporal::{
    CalendarId, Duration, Error, FieldSet, Instant, IsoDate, Overflow, PartialDuration, PlainDate,
    PlainMonthDay, PlainTime, PlainYearMonth, RelativeTo, ShowCalendar, Unit,
    to_integer_with_truncation,
};
use support::*;

#[test]
fn adding_to_dates() {
    for (start, amount, constrained, is_rejected) in [
        ("2020-01-31", "P1M", "2020-02-29", true),
        ("2020-02-29", "P1Y", "2021-02-28", true),
        ("2020-02-29", "P4Y", "2024-02-29", false),
        ("2020-01-31", "P1M1D", "2020-03-01", true),
        ("2020-03-31", "-P1M1W", "2020-02-22", true),
        ("2020-01-01", "PT47H", "2020-01-02", false),
        ("2020-01-01", "-PT47H", "2019-12-31", false),
        ("-271821-04-19", "P200000001D", "+275760-09-13", false),
    ] {
        let add = |overflow| date(start).add(&duration(amount), overflow);
        assert_eq!(date_string(add(Overflow::Constrain).unwrap()), constrained);
        assert_eq!(add(Overflow::Reject).is_err(), is_rejected);
    }
    for amount in [
        "P1D",
        "P1M",
        "P4294967295Y",
        "P104249991374D",
        "-P4294967295M",
    ] {
        for &calendar in CalendarId::ALL {
            let last = date("+275760-09-13").with_calendar(calendar);
            assert!(last.add(&duration(amount), Overflow::Constrain).is_err());
        }
    }
}

#[test]
fn differences_between_dates() {
    for (one, two, unit, until, since) in [
        ("2020-01-31", "2020-02-29", Unit::Month, "P29D", "-P29D"),
        ("2020-01-31", "2020-03-01", Unit::Month, "P1M1D", "-P1M1D"),
        ("2020-03-31", "2020-02-29", Unit::Month, "-P1M", "P1M"),
        (
            "2020-02-29",
            "2021-02-28",
            Unit::Year,
            "P11M30D",
            "-P11M30D",
        ),
        ("2020-01-01", "2020-02-01", Unit::Week, "P4W3D", "-P4W3D"),
        (
            "-271821-04-19",
            "+275760-09-13",
            Unit::Year,
            "P547581Y4M25D",
            "-P547581Y4M25D",
        ),
    ] {
        let difference = |operation| date(one).difference(operation, date(two), largest(unit));
        assert_eq!(duration_string(&difference(Until).unwrap()), until);
        assert_eq!(duration_string(&difference(Since).unwrap()), since);
    }
}

#[test]
fn a_difference_leads_from_one_value_to_the_other() {
    let step = duration("P53DT7H");
    for &calendar in CalendarId::ALL {
        let mut values = vec![date_time("2022-11-30T12:00").with_calendar(calendar)];
        for index in 0..16 {
            values.push(values[index].add(&step, Overflow::Reject).unwrap());
        }
        for (&one, &two) in values
            .iter()
            .flat_map(|one| values.iter().map(move |two| (one, two)))
        {
            for unit in Unit::ALL {
                let difference = one.difference(Until, two, largest(unit)).unwrap();
                assert_eq!(one.add(&difference, Overflow::Constrain), Ok(two));
            }
        }
    }
}

#[test]
fn times_wrap_around() {
    assert_eq!(time("23:00").add(&duration("P1DT2H")), time("01:00"));
    assert_eq!(
        time("00:00").subtract(&duration("PT0.000000001S")),
        time("23:59:59.999999999")
    );
    assert_eq!(
        time("00:00").add(&duration("PT9007199254740991S")),
        time("07:36:31")
    );
    let given = fields(
        FieldSet::Time,
        CalendarId::Iso8601,
        "minute=60 nanosecond=-1e300",
    );
    assert_eq!(
        time("10:00:01.5").with(&given, Overflow::Constrain),
        Ok(time("10:59:01.5"))
    );
    assert_eq!(
        PlainTime::from_fields(&given, Overflow::Reject),
        Err(Error::MinuteOutOfRange)
    );
}

#[test]
fn instants() {
    let last = instant("+275760-09-13T00:00Z");
    assert_eq!(last.epoch_nanoseconds(), 8_640_000_000_000_000_000_000);
    assert_eq!(Instant::new(last.epoch_nanoseconds() + 1), None);
    assert_eq!(
        last.add(&duration("PT0.000000001S")),
        Err(Error::InstantSumOutOfRange)
    );
    assert_eq!(
        last.subtract(&duration("P1D")),
        Err(Error::AddingDaysToInstant)
    );
    assert_eq!(Instant::new(-1).unwrap().epoch_milliseconds(), -1);
    let whole = instant("-271821-04-20T00:00Z").difference(Until, last, largest(Unit::Nanosecond));
    assert_eq!(whole.unwrap().get(Unit::Nanosecond), 1.728e22);
    for milliseconds in [0.5, f64::NAN, f64::INFINITY, 8.64e15 + 1.0, -1e300] {
        assert!(Instant::from_epoch_milliseconds(milliseconds).is_err());
    }
}

#[test]
fn limits_of_durations() {
    let with = |fields: &[(Unit, f64)]| {
        let mut partial = PartialDuration::default();
        for &(unit, number) in fields {
            partial.set(unit, number)?;
        }
        Duration::from_partial(&partial)
    };
    let limit = 2f64.powi(53);
    assert!(
        with(&[
            (Unit::Second, limit - 1.0),
            (Unit::Nanosecond, 999_999_999.0)
        ])
        .is_ok()
    );
    assert!(with(&[(Unit::Second, limit - 1.0), (Unit::Millisecond, 1000.0)]).is_err());
    assert!(with(&[(Unit::Nanosecond, (limit * 1e9).next_down())]).is_ok());
    assert!(with(&[(Unit::Nanosecond, limit * 1e9)]).is_err());
    assert!(with(&[(Unit::Microsecond, -f64::MAX)]).is_err());
    assert_eq!(
        with(&[(Unit::Day, 1.0), (Unit::Hour, -1.0)]),
        Err(Error::InvalidDuration)
    );
    assert_eq!(
        with(&[(Unit::Day, 1.5)]),
        Err(Error::DurationFieldNotInteger)
    );
    assert_eq!(with(&[]), Err(Error::NoDurationFields));
    let zero = with(&[(Unit::Day, -0.0)]).unwrap().negated();
    assert!(
        Unit::ALL
            .iter()
            .all(|&unit| zero.get(unit).is_sign_positive())
    );

    assert_eq!(
        duration("P1DT23H").add(&duration("PT1H")),
        Ok(duration("P2D"))
    );
    assert_eq!(
        duration("P1W").add(&Duration::ZERO),
        Err(Error::AddingCalendarUnits)
    );
    let longest = duration("PT9007199254740991S");
    assert_eq!(
        longest.add(&duration("PT1S")),
        Err(Error::DurationSumOutOfRange)
    );
}

#[test]
fn comparing_durations() {
    let compare = |one, two, start: Option<&str>| {
        let start = start.map(|it| RelativeTo::parse(text(it)).unwrap());
        duration(one).compare(&duration(two), start.as_ref())
    };
    assert_eq!(compare("P1D", "PT24H", None), Ok(Ordering::Equal));
    assert_eq!(
        compare("P1M", "P30D", None),
        Err(Error::ComparingCalendarUnits)
    );
    assert_eq!(
        compare("P1M", "P30D", Some("2020-02-01")),
        Ok(Ordering::Less)
    );
    assert_eq!(
        compare("P1M", "P30D", Some("2020-03-01")),
        Ok(Ordering::Greater)
    );
    assert_eq!(
        compare("P1W", "P1000000000D", Some("2020-03-01")),
        Ok(Ordering::Less)
    );
    let before_spring = Some("2024-03-10[America/New_York]");
    assert_eq!(compare("P1D", "PT24H", before_spring), Ok(Ordering::Less));
}

#[test]
fn year_months_and_month_days() {
    let month = PlainYearMonth::new(2020, 1, CalendarId::Iso8601, Some(31)).unwrap();
    let later = month.add(&duration("P1Y1M"), Overflow::Reject).unwrap();
    assert_eq!(
        string(&later.to_text(ShowCalendar::Always)),
        "2021-02-01[u-ca=iso8601]"
    );
    assert_eq!(
        month.difference(Until, later, largest(Unit::Month)),
        Ok(duration("P13M"))
    );
    assert_eq!(
        month.add(&duration("P1D"), Overflow::Reject),
        Err(Error::UnitsBelowMonth)
    );
    assert!(PlainYearMonth::new(-271_821, 4, CalendarId::Iso8601, None).is_ok());
    assert!(PlainYearMonth::new(275_760, 10, CalendarId::Iso8601, None).is_err());

    for (year, expected) in [
        ("1e10", "02-29"),
        ("-1e20", "02-29"),
        ("2147483647", "02-28"),
    ] {
        let source = format!("year={year} month=2 day=29");
        let given = fields(FieldSet::Date, CalendarId::Iso8601, &source);
        let day = PlainMonthDay::from_fields(&given, Overflow::Constrain).unwrap();
        assert_eq!(string(&day.to_text(ShowCalendar::Auto)), expected);
    }
}

#[test]
fn constructors() {
    assert_eq!(IsoDate::new(2021, 2, 29), Err(Error::DayOutOfRange));
    assert_eq!(IsoDate::new(2021, 257, 1), Err(Error::MonthOutOfRange));
    assert_eq!(IsoDate::new(275_761, 1, 1), Err(Error::YearOutOfRange));
    let before_first = IsoDate::new(-271_821, 4, 18).unwrap();
    assert!(PlainDate::new(before_first, CalendarId::Iso8601).is_err());
    assert!(
        date("-271821-04-19")
            .to_plain_date_time(PlainTime::MIDNIGHT)
            .is_err()
    );
    assert_eq!(
        to_integer_with_truncation(-0.9, Error::YearNotFinite),
        Ok(0)
    );
    assert_eq!(
        to_integer_with_truncation(f64::NAN, Error::YearNotFinite),
        Err(Error::YearNotFinite)
    );
}

#[test]
fn weeks() {
    for (source, day, week, year) in [
        ("2016-01-03", 7, 53, 2015),
        ("2016-01-04", 1, 1, 2016),
        ("2019-12-30", 1, 1, 2020),
        ("2020-12-31", 4, 53, 2020),
        ("2022-01-01", 6, 52, 2021),
    ] {
        let iso_date = date(source).iso_date();
        let found = CalendarId::Iso8601.week(iso_date).unwrap();
        assert_eq!(
            (iso_date.day_of_week(), found.week, found.year),
            (day, week, year)
        );
        assert_eq!(CalendarId::Gregory.week(iso_date), None);
    }
}
