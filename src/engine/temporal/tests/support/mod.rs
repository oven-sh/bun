#![allow(dead_code)]

use bun_engine_standalone as _;
use bun_engine_temporal::{
    CalendarId, Conversion, DifferenceOptions, Disambiguation, Duration, Field, FieldSet, Fields,
    InputError, Instant, IsoText, OffsetOption, PlainDate, PlainDateTime, PlainTime, Precision,
    RoundingIncrement, RoundingMode, ShowCalendar, Unit, UnitOption, ZonedDateTime, ZonedDisplay,
};
use bun_engine_text::Text;

pub(crate) fn text(ascii: &str) -> Text<'_> {
    Text::from_ascii(ascii)
}

pub(crate) fn string(text: &IsoText) -> String {
    text.text().to_string()
}

pub(crate) fn message<'a>(error: impl Into<InputError<'a>>) -> String {
    error.into().message().to_string()
}

pub(crate) fn date(source: &str) -> PlainDate {
    PlainDate::parse(text(source)).unwrap().finish().unwrap()
}

pub(crate) fn time(source: &str) -> PlainTime {
    PlainTime::parse(text(source)).unwrap()
}

pub(crate) fn date_time(source: &str) -> PlainDateTime {
    let parsed = PlainDateTime::parse(text(source)).unwrap();
    parsed.finish().unwrap()
}

pub(crate) fn instant(source: &str) -> Instant {
    Instant::parse(text(source)).unwrap()
}

pub(crate) fn zoned(source: &str) -> ZonedDateTime {
    ZonedDateTime::parse(text(source))
        .unwrap()
        .finish(Disambiguation::Compatible, OffsetOption::Reject)
        .unwrap()
}

pub(crate) fn duration(source: &str) -> Duration {
    Duration::parse(text(source)).unwrap()
}

pub(crate) fn date_string(date: PlainDate) -> String {
    string(&date.to_text(ShowCalendar::Never))
}

pub(crate) fn date_time_string(date_time: PlainDateTime) -> String {
    string(&date_time.to_text(Precision::AUTO, ShowCalendar::Never))
}

pub(crate) fn zoned_string(zoned: &ZonedDateTime) -> String {
    string(&zoned.to_text(Precision::AUTO, ZonedDisplay::AUTO))
}

pub(crate) fn duration_string(duration: &Duration) -> String {
    string(&duration.to_text(Precision::AUTO))
}

pub(crate) fn largest(unit: Unit) -> DifferenceOptions {
    DifferenceOptions {
        largest_unit: Some(UnitOption::Unit(unit)),
        ..DifferenceOptions::default()
    }
}

pub(crate) fn rounded(
    largest_unit: Unit,
    smallest_unit: Unit,
    increment: u32,
    rounding_mode: RoundingMode,
) -> DifferenceOptions {
    DifferenceOptions {
        largest_unit: Some(UnitOption::Unit(largest_unit)),
        rounding_increment: RoundingIncrement::new(increment.into()).unwrap(),
        rounding_mode,
        smallest_unit: Some(UnitOption::Unit(smallest_unit)),
    }
}

/// From `name=value` pairs.
pub(crate) fn fields(set: FieldSet, calendar: CalendarId, source: &str) -> Fields {
    let mut fields = Fields::new(set, calendar);
    let properties: Vec<Field> = fields.properties().collect();
    for pair in source.split_ascii_whitespace() {
        let (field, value) = properties
            .iter()
            .find_map(|&field| {
                let name = field.property().text().to_string();
                let value = pair.strip_prefix(&name)?.strip_prefix('=')?;
                Some((field, value))
            })
            .unwrap();
        match field.conversion() {
            Conversion::Number => fields.set_number(field, value.parse().unwrap()).unwrap(),
            Conversion::TimeZone => {
                fields.set_time_zone(bun_engine_temporal::parse_time_zone(text(value)).unwrap())
            }
            _ => fields.set_text(field, text(value)).unwrap(),
        }
    }
    fields
}
