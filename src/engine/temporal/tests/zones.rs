mod support;

use bun_engine_temporal::DifferenceOperation::Until;
use bun_engine_temporal::Disambiguation::{Compatible, Earlier, Later, Reject};
use bun_engine_temporal::{
    CalendarId, Direction, Error, FieldSet, OffsetOption, Overflow, RoundOptions, Unit,
    ZonedDateTime, ZonedOptions, find_time_zone,
};
use support::*;

#[test]
fn skipped_and_repeated_times() {
    let zone = find_time_zone(text("America/New_York")).unwrap();
    for (local, disambiguation, expected) in [
        ("2024-03-10T02:30", Compatible, Ok("2024-03-10T07:30Z")),
        ("2024-03-10T02:30", Earlier, Ok("2024-03-10T06:30Z")),
        ("2024-03-10T02:30", Later, Ok("2024-03-10T07:30Z")),
        ("2024-03-10T02:30", Reject, Err(Error::LocalTimeSkipped)),
        ("2024-11-03T01:30", Compatible, Ok("2024-11-03T05:30Z")),
        ("2024-11-03T01:30", Earlier, Ok("2024-11-03T05:30Z")),
        ("2024-11-03T01:30", Later, Ok("2024-11-03T06:30Z")),
        ("2024-11-03T01:30", Reject, Err(Error::LocalTimeRepeated)),
        ("+275760-09-12T20:00", Reject, Ok("+275760-09-13T00:00Z")),
        (
            "+275760-09-12T20:00:00.1",
            Reject,
            Err(Error::LocalTimeOutOfRange),
        ),
    ] {
        let found = date_time(local).to_zoned_date_time(zone, disambiguation);
        assert_eq!(
            found.map(|it| it.instant()),
            expected.map(instant),
            "{local}"
        );
        if let Ok(found) = found {
            let looked_up = found.with_time_zone(zone).offset_nanoseconds();
            assert_eq!(found.offset_nanoseconds(), looked_up);
        }
    }
}

#[test]
fn offsets_in_strings_and_fields() {
    let read = |source, option| {
        let parsed = ZonedDateTime::parse(text(source)).unwrap();
        parsed.finish(Compatible, option).map(|it| it.instant())
    };
    let wrong = "2024-01-01T12:00+01:00[America/New_York]";
    assert_eq!(
        read(wrong, OffsetOption::Use),
        Ok(instant("2024-01-01T11:00Z"))
    );
    assert_eq!(
        read(wrong, OffsetOption::Ignore),
        Ok(instant("2024-01-01T17:00Z"))
    );
    assert_eq!(
        read(wrong, OffsetOption::Prefer),
        Ok(instant("2024-01-01T17:00Z"))
    );
    assert_eq!(
        read(wrong, OffsetOption::Reject),
        Err(Error::OffsetContradictsTimeZone)
    );
    let second = "2024-11-03T01:30-05:00[America/New_York]";
    assert_eq!(
        read(second, OffsetOption::Reject),
        Ok(instant("2024-11-03T06:30Z"))
    );
    let exact = "2024-01-01T12:00Z[America/New_York]";
    assert_eq!(
        read(exact, OffsetOption::Ignore),
        Ok(instant("2024-01-01T12:00Z"))
    );
    assert!(
        read(
            "1970-01-01T00:00-00:45[Africa/Monrovia]",
            OffsetOption::Reject
        )
        .is_ok()
    );
    assert!(
        read(
            "1970-01-01T00:00-00:45:00[Africa/Monrovia]",
            OffsetOption::Reject
        )
        .is_err()
    );

    let given = "year=1970 month=1 day=1 timeZone=Africa/Monrovia offset=-00:45";
    let given = fields(FieldSet::Zoned, CalendarId::Iso8601, given);
    assert!(ZonedDateTime::from_fields(&given, ZonedOptions::DEFAULT_FOR_FROM).is_err());
    let minute = fields(FieldSet::PartialZoned, CalendarId::Iso8601, "minute=45");
    let later = zoned(second).with(&minute, ZonedOptions::DEFAULT_FOR_WITH);
    assert_eq!(later.unwrap().instant(), instant("2024-11-03T06:45Z"));
}

#[test]
fn days() {
    for (source, start, hours) in [
        (
            "2024-03-10T12:00[America/New_York]",
            "2024-03-10T05:00Z",
            23.0,
        ),
        (
            "2018-11-04T12:00[America/Sao_Paulo]",
            "2018-11-04T03:00Z",
            23.0,
        ),
        (
            "1919-03-31T12:00[America/Toronto]",
            "1919-03-31T04:30Z",
            23.5,
        ),
        (
            "2024-04-07T12:00[Australia/Lord_Howe]",
            "2024-04-06T13:00Z",
            24.5,
        ),
        ("2011-12-29T12:00[Pacific/Apia]", "2011-12-29T10:00Z", 24.0),
        ("2024-01-01T12:00[-01:30]", "2024-01-01T01:30Z", 24.0),
    ] {
        let value = zoned(source);
        assert_eq!(
            value.start_of_day().unwrap().instant(),
            instant(start),
            "{source}"
        );
        assert_eq!(value.hours_in_day(), Ok(hours), "{source}");
    }
    let day = RoundOptions::from_smallest_unit(text("days")).unwrap();
    let rounded = zoned("2024-03-10T12:29[America/New_York]").round(day);
    assert_eq!(rounded, Ok(zoned("2024-03-10[America/New_York]")));
    let rounded = zoned("2024-03-10T12:30[America/New_York]").round(day);
    assert_eq!(rounded, Ok(zoned("2024-03-11[America/New_York]")));
}

#[test]
fn transitions() {
    let spring = zoned("2024-03-10T03:00[America/New_York]");
    let just_after = spring
        .add(&duration("PT0.000000001S"), Overflow::Reject)
        .unwrap();
    let just_before = spring
        .subtract(&duration("PT0.000000001S"), Overflow::Reject)
        .unwrap();
    assert_eq!(
        just_after.time_zone_transition(Direction::Previous),
        Some(spring)
    );
    assert_eq!(
        just_before.time_zone_transition(Direction::Next),
        Some(spring)
    );
    let next = spring.time_zone_transition(Direction::Next).unwrap();
    assert_eq!(next.instant(), instant("2024-11-03T06:00Z"));
    for source in [
        "2024-01-01[UTC]",
        "2024-01-01[+01:00]",
        "+275760-09-01[Europe/Paris]",
    ] {
        assert_eq!(zoned(source).time_zone_transition(Direction::Next), None);
    }
}

#[test]
fn arithmetic() {
    let start = zoned("2024-03-09T02:30[America/New_York]");
    let add = |amount| zoned_string(&start.add(&duration(amount), Overflow::Reject).unwrap());
    assert_eq!(add("P1D"), "2024-03-10T03:30:00-04:00[America/New_York]");
    assert_eq!(add("P2D"), "2024-03-11T02:30:00-04:00[America/New_York]");
    assert_eq!(add("PT48H"), "2024-03-11T03:30:00-04:00[America/New_York]");

    for (one, two, expected) in [
        (
            "2024-03-09T02:30[America/New_York]",
            "2024-03-10T03:15[America/New_York]",
            "PT23H45M",
        ),
        (
            "2024-03-11T02:30[America/New_York]",
            "2024-03-10T03:15[America/New_York]",
            "-PT23H15M",
        ),
        (
            "2024-11-03T01:30-05:00[America/New_York]",
            "2024-11-03T01:45-04:00[America/New_York]",
            "-PT45M",
        ),
        (
            "2011-12-29T12:00[Pacific/Apia]",
            "2011-12-31T11:00[Pacific/Apia]",
            "PT23H",
        ),
        (
            "2006-10-29T00:00:59-02:30[America/St_Johns]",
            "2006-10-28T23:01-03:30[America/St_Johns]",
            "PT1S",
        ),
        (
            "2010-03-05T00:00+08:00[Antarctica/Casey]",
            "2010-03-04T23:59+08:00[Antarctica/Casey]",
            "-PT1M",
        ),
    ] {
        let difference = zoned(one).difference(Until, &zoned(two), largest(Unit::Year));
        assert_eq!(difference, Ok(duration(expected)), "{one}");
    }

    let (kolkata, calcutta) = (
        zoned("2024-01-01[Asia/Kolkata]"),
        zoned("2024-01-01[Asia/Calcutta]"),
    );
    assert!(kolkata.equals(&calcutta) && kolkata != calcutta);
    let offset = zoned("2024-01-01[+05:30]");
    assert!(!kolkata.equals(&offset));
    let in_days = kolkata.difference(Until, &offset, largest(Unit::Day));
    assert_eq!(in_days, Err(Error::DifferentTimeZones));
    assert!(
        kolkata
            .difference(Until, &offset, largest(Unit::Hour))
            .is_ok()
    );
}
