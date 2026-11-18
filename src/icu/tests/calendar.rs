use bun_engine_standalone as _;
use bun_icu::calendar::{self, Calendar, Field, ZoneName};
use bun_icu::{Enumeration, Error, time_zone};

const HOUR: i32 = 3_600_000;

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn items(mut enumeration: Enumeration) -> Vec<Vec<u8>> {
    let mut items = Vec::new();
    while let Some(item) = enumeration.next().unwrap() {
        items.push(item.to_vec());
    }
    items
}

fn date(calendar: &mut Calendar) -> [i32; 3] {
    [Field::ExtendedYear, Field::Month, Field::DayOfMonth].map(|it| calendar.get(it).unwrap())
}

#[test]
fn fields() {
    let mut hebrew = Calendar::open(&units("UTC"), c"und@calendar=hebrew").unwrap();
    hebrew.set_millis(0.0).unwrap();
    assert_eq!(date(&mut hebrew), [5730, 3, 23]);
    assert_eq!(hebrew.set_gregorian_change(0.0), Err(Error::UNSUPPORTED));

    let mut copy = hebrew.try_clone().unwrap();
    copy.set_millis(7.0 * 86_400_000.0).unwrap();
    assert_eq!(date(&mut copy), [5730, 4, 1]);
    assert_eq!(date(&mut hebrew), [5730, 3, 23]);
    assert_eq!(copy.set_millis(f64::NAN), Err(Error::ILLEGAL_ARGUMENT));
}

#[test]
fn gregorian_change() {
    let mut calendar = Calendar::open(&units("UTC"), c"").unwrap();
    calendar.set_millis(-12_219_379_200_000.0).unwrap();
    assert_eq!(date(&mut calendar), [1582, 9, 4]);
    calendar.set_gregorian_change(-8.64e15).unwrap();
    calendar.set_millis(-12_219_379_200_000.0).unwrap();
    assert_eq!(date(&mut calendar), [1582, 9, 14]);
}

#[test]
fn zones() {
    let mut calendar = Calendar::open(&units("America/Los_Angeles"), c"").unwrap();
    calendar.set_millis(1_710_064_800_000.0).unwrap();
    assert_eq!(calendar.get(Field::ZoneOffset), Ok(-8 * HOUR));
    assert_eq!(calendar.get(Field::DaylightOffset), Ok(HOUR));

    let name = |kind| calendar.zone_name(kind, c"en-US").unwrap().to_vec();
    assert_eq!(name(ZoneName::Standard), units("Pacific Standard Time"));
    assert_eq!(name(ZoneName::Daylight), units("Pacific Daylight Time"));

    calendar.set_time_zone(&units("GMT+0530")).unwrap();
    assert_eq!(calendar.get(Field::ZoneOffset), Ok(11 * HOUR / 2));
}

#[test]
fn systems() {
    let common = items(calendar::common_systems(c"th_TH").unwrap());
    assert_eq!(common, [&b"buddhist"[..], b"gregorian"]);
}

#[test]
fn zone_identifiers() {
    let canonical = |id| time_zone::canonical_id(&units(id)).map(|it| it.to_vec());
    assert_eq!(canonical("Asia/Kolkata"), Ok(units("Asia/Calcutta")));
    assert_eq!(canonical("GMT+5"), Ok(units("GMT+05:00")));
    assert!(canonical("Nowhere").is_err());
    assert!(canonical("").is_err());
    if let Ok(id) = time_zone::iana_id(&units("Asia/Calcutta")) {
        assert_eq!(id.to_vec(), units("Asia/Kolkata"));
    }

    let japan = items(time_zone::canonical_ids(Some(c"JP")).unwrap());
    assert_eq!(japan, [b"Asia/Tokyo"]);

    assert_eq!(time_zone::host(), time_zone::host());
}
