use bun_engine_date::{
    Component, DateFields, MAX_ISO_STRING_LENGTH, date_string, iso_string, ms_from_time, time_clip,
    utc_string, write_iso_string,
};
use bun_engine_standalone as _;

#[test]
fn strings_in_utc() {
    for (time, iso, utc, date) in [
        (
            0.0,
            "1970-01-01T00:00:00.000Z",
            "Thu, 01 Jan 1970 00:00:00 GMT",
            "Thu Jan 01 1970",
        ),
        (
            -1.0,
            "1969-12-31T23:59:59.999Z",
            "Wed, 31 Dec 1969 23:59:59 GMT",
            "Wed Dec 31 1969",
        ),
        (
            1_709_211_909_045.0,
            "2024-02-29T13:05:09.045Z",
            "Thu, 29 Feb 2024 13:05:09 GMT",
            "Thu Feb 29 2024",
        ),
        (
            -62_167_219_200_000.0,
            "0000-01-01T00:00:00.000Z",
            "Sat, 01 Jan 0000 00:00:00 GMT",
            "Sat Jan 01 0000",
        ),
        (
            -62_167_219_200_001.0,
            "-000001-12-31T23:59:59.999Z",
            "Fri, 31 Dec -0001 23:59:59 GMT",
            "Fri Dec 31 -0001",
        ),
        (
            253_402_300_800_000.0,
            "+010000-01-01T00:00:00.000Z",
            "Sat, 01 Jan 10000 00:00:00 GMT",
            "Sat Jan 01 10000",
        ),
        (
            8.64e15,
            "+275760-09-13T00:00:00.000Z",
            "Sat, 13 Sep 275760 00:00:00 GMT",
            "Sat Sep 13 275760",
        ),
        (
            -8.64e15,
            "-271821-04-20T00:00:00.000Z",
            "Tue, 20 Apr -271821 00:00:00 GMT",
            "Tue Apr 20 -271821",
        ),
    ] {
        let fields = DateFields::utc(time).unwrap();
        assert_eq!(iso_string(time).unwrap().to_string(), iso);
        assert_eq!(utc_string(fields).to_string(), utc);
        assert_eq!(date_string(fields).to_string(), date);

        let mut units = [0u16; MAX_ISO_STRING_LENGTH];
        let length = write_iso_string(time, &mut units).unwrap();
        assert!(iso.encode_utf16().eq(units[..length].iter().copied()));
    }
    for time in [f64::NAN, f64::INFINITY, -f64::MAX, 8.65e15] {
        assert_eq!(DateFields::utc(time), None);
        assert!(iso_string(time).is_none());
    }
    assert!(iso_string(8.64e15 + 1.0).is_none());
}

#[test]
fn every_second_of_a_day() {
    for second in 0..86_400 {
        let fields = DateFields::utc(f64::from(second * 1000 + 999)).unwrap();
        assert_eq!(
            [fields.hour(), fields.minute(), fields.second()].map(i32::from),
            [second / 3600, second / 60 % 60, second % 60]
        );
    }
}

#[test]
fn layout() {
    let bits = DateFields::utc(-62_198_755_200_000.0).unwrap().to_bits();
    assert_eq!(bits as i64 >> DateFields::YEAR.shift, -1);
    assert_eq!(bits >> DateFields::DAY.shift & DateFields::DAY.mask(), 1);
    assert_eq!(size_of::<Option<DateFields>>(), 8);
}

#[test]
fn setters() {
    let time = 1_709_211_909_045.0;
    let set = |first, values: &[f64]| {
        let fields = DateFields::utc(time).unwrap();
        let time = time_clip(fields.with_components(ms_from_time(time), first, values));
        iso_string(time).map(|text| text.to_string())
    };
    for (first, values, expected) in [
        (Component::Year, &[2023.0][..], "2023-03-01T13:05:09.045Z"),
        (
            Component::Year,
            &[5.0, 13.9, 0.0],
            "0006-01-31T13:05:09.045Z",
        ),
        (Component::Month, &[-1.0], "2023-12-29T13:05:09.045Z"),
        (Component::Day, &[31.0], "2024-03-02T13:05:09.045Z"),
        (Component::Hour, &[24.0, -1.0], "2024-02-29T23:59:09.045Z"),
        (
            Component::Minute,
            &[0.0, 0.0, -0.5],
            "2024-02-29T13:00:00.000Z",
        ),
        (Component::Second, &[61.0], "2024-02-29T13:06:01.045Z"),
        (Component::Millisecond, &[-1.0], "2024-02-29T13:05:08.999Z"),
        (
            Component::Year,
            &[300_000.0, -1_200_000.0, 1.0],
            "+200000-01-01T13:05:09.045Z",
        ),
    ] {
        assert_eq!(set(first, values).as_deref(), Some(expected));
    }
    assert_eq!(set(Component::Day, &[f64::NAN]), None);
    assert_eq!(set(Component::Hour, &[1.0, f64::INFINITY]), None);
    assert_eq!(set(Component::Year, &[275_761.0]), None);
}
