mod support;

use bun_engine_temporal::DifferenceOperation::Until;
use bun_engine_temporal::{
    CalendarId, Error, FieldSet, Fields, Overflow, PlainDate, PlainMonthDay, ShowCalendar, Unit,
};
use support::*;

fn describe(date: PlainDate) -> String {
    let fields = date.calendar().date(date.iso_date()).unwrap();
    let era = (fields.era).map_or(String::new(), |it| {
        format!(" {} {}", it.era.code().text(), it.year)
    });
    let (year, month, day) = (fields.year, fields.month, fields.day);
    format!("{year} {month} {} {day}{era}", fields.month_code().text())
}

#[test]
fn identifiers() {
    assert!(CalendarId::ALL.is_sorted_by_key(|it| it.identifier()));
    for &calendar in CalendarId::ALL {
        let upper = calendar.identifier().to_ascii_uppercase();
        assert_eq!(CalendarId::find(text(&upper)), Some(calendar));
    }
    assert_eq!(
        CalendarId::find(text("islamicc")),
        Some(CalendarId::IslamicCivil)
    );
    assert_eq!(CalendarId::find(text("islamic")), None);
}

#[test]
fn first_and_last_dates() {
    for (calendar, first, last) in [
        (
            "buddhist",
            "-271278 4 M04 19 be -271278",
            "276303 9 M09 13 be 276303",
        ),
        (
            "coptic",
            "-272099 3 M03 23 am -272099",
            "275471 5 M05 22 am 275471",
        ),
        (
            "ethioaa",
            "-266323 3 M03 23 aa -266323",
            "281247 5 M05 22 aa 281247",
        ),
        (
            "ethiopic",
            "-271823 3 M03 23 aa -266323",
            "275747 5 M05 22 am 275747",
        ),
        (
            "gregory",
            "-271821 4 M04 19 bce 271822",
            "275760 9 M09 13 ce 275760",
        ),
        (
            "hebrew",
            "-268058 11 M11 4 am -268058",
            "279517 10 M09 11 am 279517",
        ),
        (
            "indian",
            "-271899 1 M01 29 shaka -271899",
            "275682 6 M06 22 shaka 275682",
        ),
        (
            "islamic-civil",
            "-280804 3 M03 21 bh 280805",
            "283583 5 M05 23 ah 283583",
        ),
        (
            "islamic-tbla",
            "-280804 3 M03 22 bh 280805",
            "283583 5 M05 24 ah 283583",
        ),
        (
            "islamic-umalqura",
            "-280804 3 M03 21 bh 280805",
            "283583 5 M05 23 ah 283583",
        ),
        (
            "japanese",
            "-271821 4 M04 19 bce 271822",
            "275760 9 M09 13 reiwa 273742",
        ),
        (
            "persian",
            "-272442 1 M01 9 ap -272442",
            "275139 7 M07 12 ap 275139",
        ),
        (
            "roc",
            "-273732 4 M04 19 broc 273733",
            "273849 9 M09 13 roc 273849",
        ),
    ] {
        let calendar = CalendarId::find(text(calendar)).unwrap();
        assert_eq!(
            describe(date("-271821-04-19").with_calendar(calendar)),
            first
        );
        assert_eq!(
            describe(date("+275760-09-13").with_calendar(calendar)),
            last
        );
    }
}

#[test]
fn leap_months() {
    for (calendar, given, expected) in [
        (
            CalendarId::Chinese,
            "year=2023 monthCode=M02L day=1",
            "2023-03-22",
        ),
        (
            CalendarId::Chinese,
            "year=2024 monthCode=M02L day=1",
            "2024-03-10",
        ),
        (
            CalendarId::Dangi,
            "year=2012 monthCode=M03L day=1",
            "2012-04-21",
        ),
        (
            CalendarId::Hebrew,
            "year=5784 monthCode=M05L day=30",
            "2024-03-10",
        ),
        (
            CalendarId::Hebrew,
            "year=5785 monthCode=M05L day=30",
            "2025-03-29",
        ),
    ] {
        let fields = fields(FieldSet::Date, calendar, given);
        let date = PlainDate::from_fields(&fields, Overflow::Constrain).unwrap();
        assert_eq!(date_string(date), expected);
    }
}

#[test]
fn each_day_follows_the_one_before() {
    let day = duration("P1D");
    for &calendar in CalendarId::ALL {
        for start in [
            "-003761-06-01",
            "0000-06-01",
            "1882-01-01",
            "2023-01-01",
            "2123-06-01",
        ] {
            let mut value = date(start).with_calendar(calendar);
            let mut before = calendar.date(value.iso_date()).unwrap();
            for _ in 0..800 {
                value = value.add(&day, Overflow::Reject).unwrap();
                let now = calendar.date(value.iso_date()).unwrap();
                let expected = if before.day_of_year == before.days_in_year {
                    assert_eq!(before.month, before.months_in_year);
                    assert_eq!(before.day, before.days_in_month);
                    (before.year + 1, 1, 1, 1)
                } else if before.day == before.days_in_month {
                    (before.year, before.month + 1, 1, before.day_of_year + 1)
                } else {
                    (
                        before.year,
                        before.month,
                        before.day + 1,
                        before.day_of_year + 1,
                    )
                };
                assert_eq!((now.year, now.month, now.day, now.day_of_year), expected);
                let source = format!(
                    "year={} monthCode={} day={}",
                    now.year,
                    now.month_code().text(),
                    now.day
                );
                let given = fields(FieldSet::Date, calendar, &source);
                assert_eq!(PlainDate::from_fields(&given, Overflow::Reject), Ok(value));
                before = now;
            }
        }
    }
}

#[test]
fn eras() {
    for (source, expected) in [
        ("1872-12-31[u-ca=japanese]", "1872 12 M12 31 ce 1872"),
        ("1873-01-01[u-ca=japanese]", "1873 1 M01 1 meiji 6"),
        ("1989-01-07[u-ca=japanese]", "1989 1 M01 7 showa 64"),
        ("1989-01-08[u-ca=japanese]", "1989 1 M01 8 heisei 1"),
        ("2019-05-01[u-ca=japanese]", "2019 5 M05 1 reiwa 1"),
        ("0000-01-01[u-ca=gregory]", "0 1 M01 1 bce 1"),
        ("1911-12-31[u-ca=roc]", "0 12 M12 31 broc 1"),
        ("0008-08-26[u-ca=ethiopic]", "0 13 M13 5 aa 5500"),
        ("0622-07-18[u-ca=islamic-civil]", "0 12 M12 29 bh 1"),
        ("2024-02-10[u-ca=chinese]", "2024 1 M01 1"),
        ("+010001-06-15[u-ca=dangi]", "10001 6 M06 15"),
    ] {
        assert_eq!(describe(date(source)), expected);
    }
}

#[test]
fn resolving_fields() {
    use CalendarId::{Coptic, Gregory, Hebrew, Iso8601, Japanese};
    for (calendar, given, expected) in [
        (Gregory, "era=BC eraYear=1 month=1 day=1", Ok("0000-01-01")),
        (
            Gregory,
            "era=ce eraYear=-1 month=1 day=1",
            Ok("-000001-01-01"),
        ),
        (
            Japanese,
            "era=heisei eraYear=32 month=1 day=1",
            Ok("2020-01-01"),
        ),
        (
            Gregory,
            "era=ce eraYear=1 year=2 month=1 day=1",
            Err(Error::YearContradictsEra),
        ),
        (
            Gregory,
            "era=am eraYear=1 month=1 day=1",
            Err(Error::InvalidEra),
        ),
        (Gregory, "era=am eraYear=1 month=1", Err(Error::MissingDay)),
        (
            Gregory,
            "era=ce year=1 month=1 day=1",
            Err(Error::EraWithoutEraYear),
        ),
        (Gregory, "eraYear=1 month=1 day=1", Err(Error::MissingYear)),
        (Iso8601, "year=1e9 day=1", Err(Error::MissingMonth)),
        (
            Iso8601,
            "year=1 monthCode=M13 day=1",
            Err(Error::MonthCodeNotInIsoCalendar),
        ),
        (
            Iso8601,
            "year=1 monthCode=M00L day=1",
            Err(Error::LeapMonthInIsoCalendar),
        ),
        (
            Iso8601,
            "year=1 month=257 monthCode=M01 day=1",
            Err(Error::MonthContradictsMonthCode),
        ),
        (
            Coptic,
            "year=1 monthCode=M14 day=1",
            Err(Error::MonthCodeNotInCalendar),
        ),
        (Coptic, "year=1 month=14 day=1", Err(Error::MonthNotInYear)),
        (
            Coptic,
            "year=1 month=13 day=6",
            Err(Error::DayNotInCalendarMonth),
        ),
        (
            Hebrew,
            "year=5785 monthCode=M05L day=1",
            Err(Error::MonthCodeNotInYear),
        ),
        (
            Hebrew,
            "year=5784 month=6 monthCode=M06 day=1",
            Err(Error::MonthContradictsMonthCode),
        ),
        (
            Hebrew,
            "year=300000 month=1 day=1",
            Err(Error::CalendarDateOutOfRange),
        ),
        (
            Hebrew,
            "year=-1e300 month=1 day=1",
            Err(Error::DateFieldsOutOfRange),
        ),
    ] {
        let found =
            PlainDate::from_fields(&fields(FieldSet::Date, calendar, given), Overflow::Reject);
        assert_eq!(
            found.map(date_string).as_deref().map_err(|it| *it),
            expected,
            "{given}"
        );
    }
}

#[test]
fn merging_fields() {
    for (start, given, expected) in [
        (
            "2024-03-01[u-ca=hebrew]",
            "year=5785",
            "5785 6 M06 21 am 5785",
        ),
        (
            "2024-04-01[u-ca=hebrew]",
            "year=5785",
            "5785 6 M06 22 am 5785",
        ),
        (
            "2024-03-01[u-ca=hebrew]",
            "month=13",
            "5784 13 M12 21 am 5784",
        ),
        (
            "2019-04-30[u-ca=japanese]",
            "month=5",
            "2019 5 M05 30 reiwa 1",
        ),
        (
            "2019-04-30[u-ca=japanese]",
            "era=showa eraYear=2",
            "1927 4 M04 30 showa 2",
        ),
    ] {
        let start = date(start);
        let given = fields(FieldSet::Date, start.calendar(), given);
        assert_eq!(
            describe(start.with(&given, Overflow::Constrain).unwrap()),
            expected
        );
    }
    let nothing = Fields::new(FieldSet::Date, CalendarId::Iso8601);
    assert_eq!(nothing.require_any(), Err(Error::NoDateFields));
}

#[test]
fn months_of_lunisolar_years() {
    for (calendar, years, months) in [
        ("hebrew", 1900, 23_500),
        ("chinese", 19, 235),
        ("dangi", 3, 37),
    ] {
        let start = date(&format!("2024-03-01[u-ca={calendar}]"));
        let by_years = start.add(&duration(&format!("P{years}Y")), Overflow::Constrain);
        let by_months = start.add(&duration(&format!("P{months}M")), Overflow::Constrain);
        assert_eq!(by_years, by_months);
        let back = by_years
            .unwrap()
            .difference(Until, start, largest(Unit::Month));
        assert_eq!(back.unwrap().get(Unit::Month), -f64::from(months));
    }
    let leap = date("2024-03-01[u-ca=hebrew]");
    let next = leap.add(&duration("P1Y"), Overflow::Reject);
    assert_eq!(next, Err(Error::MonthCodeNotInTargetYear));
    let near = date("9000-06-01[u-ca=chinese]");
    let far = date("+270000-01-01[u-ca=chinese]");
    let difference = near.difference(Until, far, largest(Unit::Year)).unwrap();
    assert_eq!(near.add(&difference, Overflow::Constrain), Ok(far));
}

#[test]
fn dates_that_stand_for_month_days() {
    for (calendar, given, expected) in [
        ("hebrew", "monthCode=M04 day=26", "1972-12-31"),
        ("hebrew", "monthCode=M04 day=27", "1972-01-14"),
        ("hebrew", "monthCode=M02 day=30", "1971-11-18"),
        ("hebrew", "monthCode=M05L day=31", "1970-03-08"),
        ("hebrew", "year=5781 month=2 day=30", "1972-11-06"),
        ("coptic", "monthCode=M13 day=7", "1971-09-11"),
        ("islamic-civil", "monthCode=M12 day=30", "1971-02-26"),
        ("islamic-umalqura", "monthCode=M07 day=30", "1969-10-12"),
        ("persian", "monthCode=M12 day=30", "1972-03-20"),
        ("chinese", "monthCode=M03 day=30", "1966-04-20"),
        ("dangi", "monthCode=M03 day=30", "1968-04-27"),
        ("chinese", "monthCode=M07L day=30", "1938-09-23"),
        ("chinese", "monthCode=M11L day=11", "2034-01-01"),
        ("chinese", "monthCode=M01L day=1", "1972-02-15"),
        ("roc", "monthCode=M02 day=30", "1972-02-29"),
    ] {
        let given = fields(
            FieldSet::Date,
            CalendarId::find(text(calendar)).unwrap(),
            given,
        );
        let found = PlainMonthDay::from_fields(&given, Overflow::Constrain).unwrap();
        assert_eq!(string(&found.to_text(ShowCalendar::Never)), expected);
    }
    let rare = fields(FieldSet::Date, CalendarId::Chinese, "monthCode=M12L day=1");
    let rejected = PlainMonthDay::from_fields(&rare, Overflow::Reject);
    assert_eq!(rejected, Err(Error::LeapMonthWithoutReferenceYear));
}
