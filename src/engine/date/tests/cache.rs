use bun_engine_date::{
    DateCache, DateFields, iso_string, make_date_from_integers, parse_cookie_date,
    parse_date_as_utc, set_time_zone_override, time_clip,
};
use bun_engine_standalone as _;
use bun_engine_text::Text;

/// A day more than the greatest time value.
const LIMIT: f64 = 8.64e15 + 8.64e7;

fn utc(text: &str) -> f64 {
    parse_date_as_utc(text.as_bytes())
}

fn enter(cache: &DateCache, zone: &str) {
    assert!(set_time_zone_override(Text::from_ascii(zone)));
    assert!(cache.is_stale());
    cache.refresh();
    assert!(!cache.is_stale());
}

fn to_string(cache: &DateCache, time: f64) -> String {
    let fields = cache.local_fields(time).unwrap();
    cache.date_time_string(fields).to_string()
}

fn local_times(cache: &DateCache) {
    enter(cache, "America/New_York");
    for (time, expected) in [
        (
            "2024-03-10T06:59:59Z",
            "Sun Mar 10 2024 01:59:59 GMT-0500 (Eastern Standard Time)",
        ),
        (
            "2024-03-10T07:00:00Z",
            "Sun Mar 10 2024 03:00:00 GMT-0400 (Eastern Daylight Time)",
        ),
        (
            "1800-01-01T00:00:00Z",
            "Tue Dec 31 1799 19:03:58 GMT-0456 (Eastern Standard Time)",
        ),
        (
            "-271821-04-20T00:00Z",
            "Mon Apr 19 -271821 19:03:58 GMT-0456 (Eastern Standard Time)",
        ),
        (
            "+275760-09-13T00:00Z",
            "Fri Sep 12 275760 20:00:00 GMT-0400 (Eastern Daylight Time)",
        ),
    ] {
        assert_eq!(to_string(cache, utc(time)), expected);
    }
    let fields = cache.local_fields(0.0).unwrap();
    assert_eq!(fields.offset_minutes(), -300);
    assert_eq!(
        cache.time_string(fields).to_string(),
        "19:00:00 GMT-0500 (Eastern Standard Time)"
    );
    assert_eq!(cache.local_fields(f64::NAN), None);

    for (local, expected) in [
        ("2024-03-10T01:59:59.999", "2024-03-10T06:59:59.999Z"),
        ("2024-03-10T02:30", "2024-03-10T07:30:00.000Z"),
        ("2024-03-10T03:00", "2024-03-10T07:00:00.000Z"),
        ("2024-11-03T01:30", "2024-11-03T05:30:00.000Z"),
        ("2024-11-03T02:00", "2024-11-03T07:00:00.000Z"),
        ("-271821-04-19T19:03:58", "-271821-04-20T00:00:00.000Z"),
        ("Nov 3 2024", "2024-11-03T04:00:00.000Z"),
        ("2024-11-03", "2024-11-03T00:00:00.000Z"),
    ] {
        let time = cache.parse(Text::from_ascii(local));
        assert_eq!(iso_string(time).unwrap().to_string(), expected);
    }
    for time in [LIMIT, -LIMIT + 17_762_000.0] {
        for (time, has_fields) in [(time, true), (time + time.signum(), false)] {
            let fields = cache.local_fields(time);
            assert_eq!(fields, DateFields::in_zone(time, cache.time_zone()));
            assert_eq!(fields.is_some(), has_fields);
        }
    }
    let too_late = make_date_from_integers([275_760, 8, 12, 20, 0, 0, 1]);
    assert!(time_clip(cache.utc(too_late)).is_nan());
    assert!(cache.utc(f64::NAN).is_nan());
    assert_eq!(
        parse_cookie_date(b"3 Nov 2024 1:30").map(|time| time as f64),
        Some(utc("2024-11-03T05:30Z"))
    );
}

fn white_space(cache: &DateCache) {
    let expected = utc("2022-02-03T13:05Z");
    for space in [
        0x9, 0xa, 0xb, 0xc, 0xd, 0xa0, 0x2009, 0x202f, 0x3000, 0xfeff,
    ] {
        let mut text: Vec<u16> = "2/3/2022, 1:05 PM UTC".encode_utf16().collect();
        text[14] = space;
        assert_eq!(cache.parse(Text::Utf16(&text)), expected);
    }
    assert_eq!(
        cache.parse(Text::Latin1(b"\xe9t\xe9 2/3/2022\xa013:05\xa0Z")),
        expected
    );
    for letter in [0x85, 0x130, 0x200b, 0x2028, 0xd800] {
        let mut text: Vec<u16> = "2/3/2022, 1:05 PM UTC".encode_utf16().collect();
        text[14] = letter;
        assert!(cache.parse(Text::Utf16(&text)).is_nan());
    }
}

fn transitions_that_are_days_apart(cache: &DateCache) {
    enter(cache, "America/Noronha");
    let days = [1, 7, 8, 14, 15, 25];
    for (first, second) in days.iter().flat_map(|a| days.iter().map(move |b| (a, b))) {
        let cache = DateCache::default();
        for &day in [first, second] {
            let noon = make_date_from_integers([2000, 9, day, 12, 0, 0, 0]);
            let hours = if (8..15).contains(&day) { -1 } else { -2 };
            let fields = cache.local_fields(noon).unwrap();
            assert_eq!(fields.offset_minutes(), hours * 60);
            assert_eq!(cache.utc(noon), noon - f64::from(hours * 3_600_000));
        }
    }
}

fn changes_of_zone(cache: &DateCache) {
    enter(cache, "Asia/Kolkata");
    assert!(!cache.refresh());
    assert_eq!(
        to_string(cache, 0.0),
        "Thu Jan 01 1970 05:30:00 GMT+0530 (India Standard Time)"
    );
    assert!(cache.local_fields(LIMIT - 19_800_000.0).is_some());
    assert_eq!(cache.local_fields(LIMIT - 19_799_999.0), None);
    let kolkata = cache.time_zone();
    assert!(set_time_zone_override(Text::from_ascii("IST")));
    assert!(!cache.refresh());
    assert!(set_time_zone_override(Text::from_ascii("UTC")));
    assert_eq!(cache.time_zone(), kolkata);
    assert!(cache.refresh());
    assert_eq!(
        to_string(cache, 0.0),
        "Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)"
    );
}

#[test]
fn days_in_utc() {
    for step in -40..40 {
        let time = f64::from(step) * 40_000_000.0;
        assert_eq!(DateCache::default().utc_fields(time), DateFields::utc(time));
    }
    let cache = DateCache::default();
    for time in [LIMIT - 1.0, LIMIT, LIMIT + 1.0, -LIMIT, -LIMIT - 1.0] {
        assert_eq!(cache.utc_fields(time), DateFields::utc(time));
        assert_eq!(cache.utc_fields(time).is_some(), time.abs() <= LIMIT);
    }
}

#[test]
fn texts_that_are_alike() {
    let cache = DateCache::default();
    for text in [
        "2022-02-03T13:05:09.1Z",
        "2022-02-03T13:05:09.1Z",
        "2022-02-03T13:05:09.2Z",
        "2022-02-04T13:05:09.2Z",
        "2022",
        "2022-02-04T13:05:09.2Z",
        "1/1/2000 1:00 z      (((((((()",
        "1/1/2000 1:00 z      ((((((((()",
        "1/1/2000 1:00 z +11111111111",
        "1/1/2000 1:00 z +1111",
        "(                ) 1/1/1111 z",
        "(                ) 1/11/111 z",
    ] {
        let time = cache.parse(Text::from_ascii(text));
        assert_eq!(time.to_bits(), utc(text).to_bits());
    }
}

/// One test, because the zone is that of the process.
#[test]
fn in_several_zones() {
    let cache = DateCache::default();
    local_times(&cache);
    white_space(&cache);
    transitions_that_are_days_apart(&cache);
    changes_of_zone(&cache);
}
