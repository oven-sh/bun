use bun_engine_date::{
    DateCache, DateFields, LocalOffsets, TimeZone, TimeZoneId, days_from_civil,
    make_date_from_integers, set_time_zone_override,
};
use bun_engine_standalone as _;
use bun_engine_text::Text;
use bun_icu::calendar::{Calendar, Field, ZoneName};
use bun_icu::host_language;

const HOUR: i32 = 3600;

fn zone(name: &str) -> TimeZoneId {
    TimeZoneId::find(Text::from_ascii(name)).unwrap()
}

fn seconds(year: i32, month: u8, day: u8, hour: i64) -> i64 {
    days_from_civil(year, month, day) * 86_400 + hour * 3600
}

#[test]
fn names() {
    for (name, identifier, primary) in [
        ("utc", "UTC", "UTC"),
        ("Etc/GMT", "Etc/GMT", "UTC"),
        ("zulu", "Zulu", "UTC"),
        ("etc/gmt+5", "Etc/GMT+5", "Etc/GMT+5"),
        ("EUROPE/PARIS", "Europe/Paris", "Europe/Paris"),
        ("Japan", "Japan", "Asia/Tokyo"),
        ("est5edt", "EST5EDT", "America/New_York"),
    ] {
        assert_eq!(zone(name).identifier(), identifier);
        assert_eq!(zone(name).primary().identifier(), primary);
    }
    for name in ["", "JST", "SystemV/EST5", "Etc/Unknown", "UTC\0", "+01:00"] {
        assert_eq!(TimeZoneId::find(Text::from_ascii(name)), None);
    }
    let wide: Vec<u16> = "asia/tokyo".encode_utf16().collect();
    assert_eq!(
        TimeZoneId::find(Text::Utf16(&wide)),
        Some(zone("Asia/Tokyo"))
    );
    let kelvin_sign: Vec<u16> = "Asia/To\u{212a}yo".encode_utf16().collect();
    assert_eq!(TimeZoneId::find(Text::Utf16(&kelvin_sign)), None);

    let primaries = TimeZoneId::primaries();
    assert!(primaries.is_sorted_by(|a, b| a.identifier() < b.identifier()));
    assert!(primaries.iter().all(|&id| id.primary() == id));
    assert!(primaries.contains(&TimeZoneId::UTC) && !primaries.contains(&zone("Japan")));
}

#[test]
fn identifiers() {
    for (time_zone, identifier, icu_id) in [
        (TimeZone::Named(zone("Japan")), "Japan", "Japan"),
        (
            TimeZone::Named(zone("PST8PDT")),
            "PST8PDT",
            "America/Los_Angeles",
        ),
        (TimeZone::Offset { minutes: 0 }, "+00:00", "GMT+0000"),
        (TimeZone::Offset { minutes: 330 }, "+05:30", "GMT+0530"),
        (TimeZone::Offset { minutes: -1439 }, "-23:59", "GMT-2359"),
    ] {
        assert_eq!(&*time_zone.identifier(), identifier);
        assert!(icu_id.encode_utf16().eq(time_zone.icu_id()));
    }
    let named = |name| TimeZone::Named(zone(name));
    assert!(named("Japan").is_same_zone(named("Asia/Tokyo")));
    assert!(!named("Japan").is_same_zone(named("Asia/Seoul")));
    assert!(!named("UTC").is_same_zone(TimeZone::Offset { minutes: 0 }));
}

#[test]
fn transitions() {
    let local = |before, after| LocalOffsets { before, after };
    let new_york = zone("America/New_York").rules();
    assert_eq!(new_york.offset_at(i64::MIN), -17_762);
    assert_eq!(
        new_york.previous_transition(seconds(1883, 11, 18, 17)),
        None
    );
    assert_eq!(
        new_york.next_transition(i64::MIN),
        Some(seconds(1883, 11, 18, 17))
    );
    for (year, march, november) in [(2007, 11, 4), (2024, 10, 3), (275_759, 11, 4)] {
        let (spring, autumn) = (seconds(year, 3, march, 7), seconds(year, 11, november, 6));
        assert_eq!(new_york.offset_at(spring - 1), -5 * HOUR);
        assert_eq!(new_york.offset_at(spring), -4 * HOUR);
        assert_eq!(new_york.offset_at(autumn - 1), -4 * HOUR);
        assert_eq!(new_york.offset_at(autumn), -5 * HOUR);
        assert_eq!(new_york.next_transition(spring - 1), Some(spring));
        assert_eq!(new_york.next_transition(spring), Some(autumn));
        assert_eq!(new_york.previous_transition(autumn + 1), Some(autumn));
        assert_eq!(new_york.previous_transition(autumn), Some(spring));

        let (skipped, repeated) = (seconds(year, 3, march, 2), seconds(year, 11, november, 1));
        for (time, before, after) in [
            (skipped - 1, -5, -5),
            (skipped, -5, -4),
            (skipped + 3599, -5, -4),
            (skipped + 3600, -4, -4),
            (repeated - 1, -4, -4),
            (repeated, -4, -5),
            (repeated + 3599, -4, -5),
            (repeated + 3600, -5, -5),
        ] {
            assert_eq!(
                new_york.offsets_at_local(time),
                local(before * HOUR, after * HOUR)
            );
        }
    }

    let sydney = zone("Australia/Sydney").rules();
    assert_eq!(sydney.offset_at(seconds(2030, 1, 1, 0)), 11 * HOUR);
    assert_eq!(
        sydney.next_transition(seconds(2029, 12, 1, 0)),
        Some(seconds(2030, 4, 6, 16))
    );
    assert_eq!(
        zone("Pacific/Apia")
            .rules()
            .offsets_at_local(seconds(2011, 12, 30, 12)),
        local(-10 * HOUR, 14 * HOUR)
    );
    assert_eq!(zone("Asia/Tokyo").rules().next_transition(0), None);
    assert_eq!(TimeZoneId::UTC.rules().previous_transition(i64::MAX), None);
    assert_eq!(new_york.next_transition(i64::MAX), None);
}

#[test]
fn time_values_in_any_zone() {
    let lord_howe = zone("Australia/Lord_Howe");
    let time = seconds(2024, 10, 5, 16) as f64 * 1000.0;
    let fields = DateFields::in_zone(time, lord_howe).unwrap();
    assert_eq!((fields.day(), fields.hour(), fields.minute()), (6, 3, 0));
    assert_eq!((fields.offset_minutes(), fields.is_daylight()), (660, true));
    assert_eq!(DateFields::in_zone(8.64e15 + 8.64e7, lord_howe), None);

    let skipped = make_date_from_integers([2024, 9, 6, 2, 15, 0, 0]);
    assert_eq!(lord_howe.utc(skipped), time - 15.0 * 60_000.0);
    assert!(lord_howe.utc(f64::NAN).is_nan());
}

#[test]
fn every_zone_agrees_with_its_calendar() {
    for id in TimeZoneId::primaries() {
        let rules = id.rules();
        let mut calendar = Calendar::open(&TimeZone::Named(id).icu_id(), c"").unwrap();
        for probe in [1850, 1990, 2030].map(|year| seconds(year, 7, 1, 0)) {
            calendar.set_millis(probe as f64 * 1000.0).unwrap();
            let offsets =
                [Field::ZoneOffset, Field::DaylightOffset].map(|it| calendar.get(it).unwrap());
            assert_eq!(rules.offset_at(probe) * 1000, offsets.iter().sum());
        }
        let mut time = seconds(1800, 1, 1, 0);
        while let Some(next) = rules.next_transition(time)
            && next < seconds(2040, 1, 1, 0)
        {
            for probe in [(time + next) / 2, next - 1, next] {
                calendar.set_millis(probe as f64 * 1000.0).unwrap();
                let [standard, daylight] = [Field::ZoneOffset, Field::DaylightOffset]
                    .map(|field| calendar.get(field).unwrap());
                let fields = DateFields::in_zone(probe as f64 * 1000.0, id).unwrap();
                assert_eq!(rules.offset_at(probe) * 1000, standard + daylight);
                assert_eq!(fields.is_daylight(), daylight != 0);
            }
            time = next;
        }
    }
}

fn overrides() {
    let host = DateCache::default().time_zone();
    for (name, expected) in [
        ("Japan", Some("Asia/Tokyo")),
        ("japan", None),
        ("Etc/UTC", Some("UTC")),
        ("PST", Some("America/Los_Angeles")),
        ("GMT+5", Some("UTC")),
        ("GMT+25", None),
        ("CST6CDT", Some("America/Chicago")),
        ("SystemV/EST5", Some("UTC")),
        ("Asia/Tokyo\0", None),
        ("", Some(host.identifier())),
    ] {
        let cache = DateCache::default();
        let before = cache.time_zone();
        let is_accepted = set_time_zone_override(Text::from_ascii(name));
        assert_eq!(is_accepted, expected.is_some());
        assert_eq!(cache.is_stale(), is_accepted);
        cache.refresh();
        assert_eq!(
            cache.time_zone().identifier(),
            expected.unwrap_or_else(|| before.identifier())
        );
    }
}

fn names_agree_with_calendars() {
    for id in TimeZoneId::primaries() {
        assert!(set_time_zone_override(Text::from_ascii(id.identifier())));
        let cache = DateCache::default();
        let calendar = Calendar::open(&TimeZone::Named(id).icu_id(), c"").unwrap();
        for month in [1, 7] {
            let time = seconds(2010, month, 1, 0) as f64 * 1000.0;
            let fields = cache.local_fields(time).unwrap();
            let kind = match fields.is_daylight() {
                true => ZoneName::Daylight,
                false => ZoneName::Standard,
            };
            let name = calendar.zone_name(kind, host_language()).unwrap();
            let expected = format!(" ({})", Text::Utf16(&name));
            assert!(cache.time_string(fields).to_string().ends_with(&expected));
        }
    }
}

/// One test, because the zone is that of the process.
#[test]
fn zone_of_the_process() {
    overrides();
    names_agree_with_calendars();
}
