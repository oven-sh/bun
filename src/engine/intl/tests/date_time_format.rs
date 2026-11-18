use bun_engine_date::{TimeZone, TimeZoneId};
use bun_engine_intl::date_time_format::{
    Component, ComponentValue, DateTimeFormat, DateTimeValue, Options, Purpose, Style,
    parse_time_zone,
};
use bun_engine_intl::{Cache, Error, HourCycle, KeywordValue, Named, OptionValue, Parts, Result};
use bun_engine_standalone as _;
use bun_engine_temporal::{
    CalendarId, Instant, PlainDate, PlainDateTime, PlainMonthDay, PlainTime, PlainYearMonth,
    ZonedDateTime,
};
use bun_engine_text::{StringRef, Text};

const ALL_DIGITS: &str = "year=numeric month=2-digit day=2-digit hour=2-digit minute=2-digit second=2-digit hourCycle=h23";

fn text(ascii: &str) -> Text<'_> {
    Text::from_ascii(ascii)
}

/// From `name=value` pairs. The time zone is UTC unless they name one.
fn options(pairs: &str) -> Result<(Options, TimeZone)> {
    let mut options = Options::default();
    let mut time_zone = TimeZone::Named(TimeZoneId::UTC);
    for pair in pairs.split_ascii_whitespace() {
        let (name, value) = pair.split_at(pair.bytes().take_while(|&it| it != b'=').count());
        let value = text(&value[1..]);
        match name {
            "calendar" => options.calendar = Some(KeywordValue::calendar(value)?),
            "numberingSystem" => {
                options.numbering_system = Some(KeywordValue::numbering_system(value)?);
            }
            "hour12" => options.hour12 = Some(value.eq_ascii("true")),
            "hourCycle" => options.hour_cycle = Some(HourCycle::parse(value)?),
            "timeZone" => time_zone = parse_time_zone(value)?,
            "fractionalSecondDigits" => (options.components)
                .set_fractional_second_digits(value.to_string().parse().unwrap())?,
            "dateStyle" => options.date_style = Some(Style::parse_date_style(value)?),
            "timeStyle" => options.time_style = Some(Style::parse_time_style(value)?),
            _ => {
                let component = (Component::ALL.into_iter())
                    .find(|it| it.property().text().eq_ascii(name))
                    .unwrap();
                options.components.set_style(component, value)?;
            }
        }
    }
    Ok((options, time_zone))
}

struct Format {
    cache: Cache,
    format: DateTimeFormat,
}

fn make(cache: &Cache, locale: &str, pairs: &str, purpose: Purpose) -> Result<DateTimeFormat> {
    let tag = cache.canonicalize(&StringRef::from_str(locale))?;
    let (options, time_zone) = options(pairs)?;
    DateTimeFormat::new(cache, &[tag], &options, time_zone, purpose)
}

fn describe(parts: &Parts) -> String {
    let parts = parts.iter().map(|part| {
        let (part, value) = part.unwrap();
        let source = part.source.map_or("", |it| &it.as_str()[..2]);
        format!("{source}{}:{value}", part.kind.as_str())
    });
    parts.collect::<Vec<_>>().join("|")
}

impl Format {
    fn new(locale: &str, pairs: &str) -> Format {
        let cache = Cache::default();
        let format = make(&cache, locale, pairs, Purpose::Constructor).unwrap();
        Format { cache, format }
    }

    fn try_format(&self, value: DateTimeValue) -> Result<String> {
        (self.format.format(&self.cache, value)).map(|it| it.to_string())
    }

    fn format(&self, value: DateTimeValue) -> String {
        self.try_format(value).unwrap()
    }

    fn parts(&self, value: DateTimeValue) -> String {
        describe(&self.format.format_to_parts(&self.cache, value).unwrap())
    }

    fn try_range(&self, start: DateTimeValue, end: DateTimeValue) -> Result<String> {
        (self.format.format_range(&self.cache, start, end)).map(|it| it.to_string())
    }

    fn range_parts(&self, start: DateTimeValue, end: DateTimeValue) -> String {
        let parts = (self.format).format_range_to_parts(&self.cache, start, end);
        describe(&parts.unwrap())
    }

    fn resolved(&self) -> String {
        let resolved = self.format.resolved_options().unwrap();
        let mut items = vec![
            resolved.locale.string().to_string(),
            resolved.calendar.identifier().to_owned(),
            resolved.numbering_system.to_string_ref().to_string(),
            resolved.time_zone.identifier().to_owned(),
        ];
        items.extend(resolved.hour_cycle.map(|it| it.as_str().to_owned()));
        items.extend(resolved.components.iter().map(|(component, value)| {
            let name = component.property().text();
            match value {
                ComponentValue::Style(style) => format!("{name}={}", style.as_str()),
                ComponentValue::Digits(digits) => format!("{name}={digits}"),
            }
        }));
        let styles = [resolved.date_style, resolved.time_style];
        items.extend(styles.iter().flatten().map(|it| it.as_str().to_owned()));
        items.join(" ")
    }
}

fn instant(source: &str) -> Instant {
    Instant::parse(text(source)).unwrap()
}

fn at(source: &str) -> DateTimeValue {
    DateTimeValue::Number(instant(source).epoch_milliseconds() as f64)
}

fn date(source: &str) -> DateTimeValue {
    DateTimeValue::PlainDate(PlainDate::parse(text(source)).unwrap().finish().unwrap())
}

fn time(source: &str) -> DateTimeValue {
    DateTimeValue::PlainTime(PlainTime::parse(text(source)).unwrap())
}

fn date_time(source: &str) -> DateTimeValue {
    let parsed = PlainDateTime::parse(text(source)).unwrap();
    DateTimeValue::PlainDateTime(parsed.finish().unwrap())
}

fn year_month(source: &str) -> DateTimeValue {
    let parsed = PlainYearMonth::parse(text(source)).unwrap();
    DateTimeValue::PlainYearMonth(parsed.finish().unwrap())
}

fn month_day(source: &str) -> DateTimeValue {
    let parsed = PlainMonthDay::parse(text(source)).unwrap();
    DateTimeValue::PlainMonthDay(parsed.finish().unwrap())
}

#[test]
fn defaults_follow_the_purpose() {
    let cache = Cache::default();
    for (pairs, purpose, expected) in [
        ("", Purpose::Constructor, "3/4/2021"),
        ("", Purpose::DateAndTime, "3/4/2021, 5:06:07 AM"),
        ("", Purpose::Date, "3/4/2021"),
        ("", Purpose::Time, "5:06:07 AM"),
        ("", Purpose::ZonedDateTime, "3/4/2021, 5:06:07 AM UTC"),
        ("hour=numeric", Purpose::Constructor, "5 AM"),
        ("hour=numeric", Purpose::Date, "3/4/2021, 5 AM"),
        ("hour=numeric", Purpose::ZonedDateTime, "5 AM"),
        ("weekday=long", Purpose::Time, "Thursday 5:06:07 AM"),
        ("era=short", Purpose::Constructor, "3/4/2021 AD"),
        ("timeZoneName=short", Purpose::Date, "3/4/2021, UTC"),
    ] {
        let format = make(&cache, "en-US", pairs, purpose).unwrap();
        let formatted = format.format(&cache, at("2021-03-04T05:06:07Z"));
        assert_eq!(formatted.unwrap().to_string(), expected, "{pairs}");
    }
}

#[test]
fn invalid_options() {
    let cache = Cache::default();
    let message = |pairs, purpose| {
        let error = make(&cache, "en", pairs, purpose).err().unwrap();
        format!("{:?}: {}", error.kind(), error.message())
    };
    for (pairs, expected) in [
        ("year=long", r#"year must be "2-digit" or "numeric""#),
        ("era=numeric", r#"era must be "narrow", "short", or "long""#),
        (
            "fractionalSecondDigits=0",
            "fractionalSecondDigits is out of range",
        ),
        (
            "timeStyle=narrow",
            r#"timeStyle must be "full", "long", "medium", or "short""#,
        ),
        ("timeZone=Mars/Olympus", "invalid time zone: Mars/Olympus"),
        ("timeZone=+24:00", "invalid time zone: +24:00"),
        ("timeZone=+01:00:00", "invalid time zone: +01:00:00"),
    ] {
        let message = message(pairs, Purpose::Constructor);
        assert_eq!(message, format!("RangeError: {expected}"));
    }
    assert_eq!(
        message("dateStyle=full era=short", Purpose::Constructor),
        "TypeError: dateStyle and timeStyle may not be used with other DateTimeFormat options"
    );
    assert_eq!(
        message("timeStyle=full", Purpose::Date),
        "TypeError: timeStyle is specified while formatting date is requested"
    );
    assert_eq!(
        message("dateStyle=full", Purpose::Time),
        "TypeError: dateStyle is specified while formatting time is requested"
    );
}

#[test]
fn resolved_options() {
    let date = "year=numeric month=numeric day=numeric";
    for (locale, pairs, expected) in [
        ("en", "", format!("en gregory latn UTC {date}")),
        (
            "th",
            "timeZone=asia/calcutta",
            format!("th buddhist latn Asia/Calcutta {date}"),
        ),
        (
            "en-u-ca-islamic-rgsa-nu-arab",
            "timeZone=-0000",
            format!("en-u-ca-islamic-rgsa-nu-arab gregory arab +00:00 {date}"),
        ),
        (
            "en-u-ca-japanese",
            "calendar=islamic month=long",
            "en islamic-tbla latn UTC month=long".into(),
        ),
        (
            "en-u-hc-h11",
            "hour=numeric",
            "en-u-hc-h11 gregory latn UTC h11 hour=numeric".into(),
        ),
        (
            "en-u-hc-h11",
            "hour=numeric hour12=false",
            "en gregory latn UTC h23 hour=2-digit".into(),
        ),
        (
            "ja",
            "hour=numeric hour12=true",
            "ja gregory latn UTC h11 hour=numeric".into(),
        ),
        (
            "de",
            "hour=numeric",
            "de gregory latn UTC h23 hour=2-digit".into(),
        ),
        (
            "en",
            "second=numeric fractionalSecondDigits=2 timeZoneName=longGeneric",
            "en gregory latn UTC second=numeric fractionalSecondDigits=2 timeZoneName=longGeneric"
                .into(),
        ),
        (
            "de-u-hc-h12",
            "dateStyle=full",
            "de-u-hc-h12 gregory latn UTC full".into(),
        ),
        (
            "de",
            "timeStyle=short hourCycle=h24",
            "de gregory latn UTC h24 short".into(),
        ),
    ] {
        assert_eq!(Format::new(locale, pairs).resolved(), expected);
    }
}

#[test]
fn hour_cycles() {
    let midnight = at("2021-03-04T00:06:07Z");
    for (locale, pairs, expected) in [
        ("en", "timeStyle=short hourCycle=h11", "0:06 AM"),
        ("en", "timeStyle=short hourCycle=h12", "12:06 AM"),
        ("en", "timeStyle=short hourCycle=h23", "00:06"),
        ("en", "timeStyle=short hourCycle=h24", "24:06"),
        ("de", "timeStyle=short hour12=true", "12:06 AM"),
        ("de", "hour=numeric hourCycle=h24", "24 Uhr"),
        ("fr-CA", "timeStyle=short hourCycle=h24", "24 h 06"),
    ] {
        assert_eq!(Format::new(locale, pairs).format(midnight), expected);
    }
}

#[test]
fn time_zones() {
    for (zone, utc, expected) in [
        (
            "America/Los_Angeles",
            "2024-03-10T09:59:59Z",
            "03/10/2024, 01:59:59",
        ),
        (
            "America/Los_Angeles",
            "2024-03-10T10:00:00Z",
            "03/10/2024, 03:00:00",
        ),
        (
            "America/Los_Angeles",
            "1800-01-01T00:00:00Z",
            "12/31/1799, 16:07:02",
        ),
        ("+05:45", "1970-01-01T00:00:00Z", "01/01/1970, 05:45:00"),
        ("-23:59", "1970-01-01T00:00:00Z", "12/31/1969, 00:01:00"),
    ] {
        let format = Format::new("en", &format!("{ALL_DIGITS} timeZone={zone}"));
        assert_eq!(format.format(at(utc)), expected);
    }
    for (name, expected) in [
        ("short", "PDT"),
        ("long", "Pacific Daylight Time"),
        ("shortOffset", "GMT-7"),
        ("longOffset", "GMT-07:00"),
        ("shortGeneric", "PT"),
        ("longGeneric", "Pacific Time"),
    ] {
        let pairs = format!("timeZone=America/Los_Angeles timeZoneName={name}");
        let formatted = Format::new("en", &pairs).format(at("2024-07-01T12:00Z"));
        assert_eq!(formatted, format!("7/1/2024, {expected}"));
    }
}

#[test]
fn formats_with_the_same_arguments_but_the_zone() {
    let cache = Cache::default();
    for (zone, expected) in [("Asia/Tokyo", "09 GMT+9"), ("UTC", "00 UTC")].repeat(2) {
        let pairs = format!("hour=2-digit hourCycle=h23 timeZoneName=short timeZone={zone}");
        let format = make(&cache, "en", &pairs, Purpose::Constructor).unwrap();
        let formatted = format.format(&cache, DateTimeValue::Number(0.0));
        assert_eq!(formatted.unwrap().to_string(), expected);
    }
}

#[test]
fn the_gregorian_calendar_is_proleptic() {
    let format = Format::new("en", "era=short");
    for (time, expected) in [
        (at("1582-10-10T00:00Z"), "10/10/1582 AD"),
        (at("0001-01-01T00:00Z"), "1/1/1 AD"),
        (at("0000-12-31T00:00Z"), "12/31/1 BC"),
        (DateTimeValue::Number(8.64e15), "9/13/275760 AD"),
        (DateTimeValue::Number(-8.64e15), "4/20/271822 BC"),
        (date("-271821-04-19"), "4/19/271822 BC"),
    ] {
        assert_eq!(format.format(time), expected);
    }
    let (old, new) = (at("1500-01-01T00:00Z"), at("2000-01-01T00:00Z"));
    let format = Format::new("en", "");
    assert_eq!(format.try_range(old, new).unwrap(), "1/1/1500 – 1/1/2000");
    assert_eq!(format.try_range(new, old).unwrap(), "1/1/2000 – 1/1/1500");
}

#[test]
fn every_calendar_formats_the_first_and_the_last_time_value() {
    for calendar in CalendarId::ALL {
        let format = Format::new("en", &format!("calendar={}", calendar.identifier()));
        for time in [-8.64e15, 8.64e15] {
            assert!(format.try_format(DateTimeValue::Number(time)).is_ok());
        }
    }
}

#[test]
fn numbers_that_are_no_time_values() {
    let format = Format::new("en", "");
    for number in [f64::NAN, f64::INFINITY, 8.64e15 + 1.0, -8.64e15 - 1.0] {
        let (number, zero) = (DateTimeValue::Number(number), DateTimeValue::Number(0.0));
        assert_eq!(
            format.try_format(number),
            Err(Error::Range(
                "date value is not finite in DateTimeFormat format()"
            ))
        );
        for (start, end) in [(number, zero), (zero, number)] {
            assert_eq!(
                format.try_range(start, end),
                Err(Error::Range("Passed date is out of range"))
            );
        }
    }
}

#[test]
fn parts() {
    let time = at("2024-12-31T17:08:09.123Z");
    for (locale, pairs, expected) in [
        (
            "en",
            "timeStyle=long",
            "hour:5|literal::|minute:08|literal::|second:09|literal: |dayPeriod:PM|literal: |timeZoneName:UTC",
        ),
        (
            "en",
            "second=numeric fractionalSecondDigits=2",
            "second:9|literal:.|fractionalSecond:12",
        ),
        (
            "en",
            "hour=numeric dayPeriod=long",
            "hour:5|literal: |dayPeriod:in the afternoon",
        ),
        (
            "es",
            "dateStyle=long",
            "day:31|literal: de |month:diciembre|literal: de |year:2024",
        ),
        (
            "zh-u-ca-chinese",
            "year=numeric",
            "relatedYear:2024|yearName:甲辰|literal:年",
        ),
        (
            "ar-EG",
            "year=2-digit month=2-digit",
            "month:١٢|literal:\u{200f}/|year:٢٤",
        ),
        (
            "gl-u-ca-buddhist",
            "dateStyle=full",
            "weekday:martes|literal:, |day:31|literal: de |month:decembro|literal: de |year:2567|literal: |era:BE",
        ),
    ] {
        assert_eq!(Format::new(locale, pairs).parts(time), expected);
    }
}

#[test]
fn first_year_of_a_japanese_era() {
    let cache = Cache::default();
    for (pairs, expected) in [("dateStyle=long", "令和元年5月1日"), ("", "R1/5/1")].repeat(2)
    {
        let format = make(&cache, "ja-u-ca-japanese", pairs, Purpose::Date).unwrap();
        let formatted = format.format(&cache, at("2019-05-01T00:00Z"));
        assert_eq!(formatted.unwrap().to_string(), expected);
    }
}

#[test]
fn years_before_the_first() {
    let format = Format::new("en-u-ca-islamic-civil", "year=numeric era=long");
    assert_eq!(format.format(at("0622-07-19T00:00Z")), "1 Anno Hegirae");
    assert_eq!(format.format(at("0622-07-18T23:59Z")), "1 Before Hijra");
    let early = at("0300-01-01T00:00Z");
    assert_eq!(format.parts(early), "year:333|literal: |era:Before Hijra");
    assert_eq!(
        format.range_parts(early, early),
        "shyear:333|shliteral: |shera:Before Hijra"
    );
    let format = Format::new("en-u-ca-islamic-civil-nu-arab", "year=2-digit era=long");
    assert_eq!(format.format(at("0429-01-01T00:00Z")), "٠٠ Before Hijra");
    let format = Format::new("en-u-ca-coptic", "year=numeric era=long");
    assert_eq!(format.format(at("0200-01-01T00:00Z")), "85 Anno Martyrum");
    let format = Format::new("en-u-ca-coptic", "month=long day=numeric");
    assert_eq!(format.format(at("0200-01-01T00:00Z")), "Toba 6");
}

#[test]
fn ranges() {
    let format = Format::new("en", "year=numeric month=short day=numeric");
    let (start, end) = (at("2007-01-10T10:00Z"), at("2007-01-20T10:00Z"));
    assert_eq!(format.try_range(start, end).unwrap(), "Jan 10 – 20, 2007");
    assert_eq!(
        format.range_parts(start, end),
        "shmonth:Jan|shliteral: |stday:10|shliteral: – |enday:20|shliteral:, |shyear:2007"
    );
    assert_eq!(
        format.range_parts(start, at("2007-01-10T11:00Z")),
        "shmonth:Jan|shliteral: |shday:10|shliteral:, |shyear:2007"
    );
    let format = Format::new("en", "hour=numeric minute=numeric hourCycle=h24");
    let range = format.try_range(at("2007-01-10T00:30Z"), at("2007-01-10T01:30Z"));
    assert_eq!(range.unwrap(), "24:30 – 01:30");
}

#[test]
fn each_type_of_temporal_shows_what_it_has() {
    let exact = DateTimeValue::Instant(instant("2021-03-04T05:06:07Z"));
    let values = [
        exact,
        date_time("2021-03-04T05:06:07"),
        date("2021-03-04"),
        time("05:06:07"),
        year_month("2021-03-01[u-ca=gregory]"),
        month_day("1972-03-04[u-ca=gregory]"),
    ];
    for (pairs, expected) in [
        (
            "",
            "3/4/2021, 2:06:07 PM; 3/4/2021, 5:06:07 AM; 3/4/2021; 5:06:07 AM; 3/2021; 3/4",
        ),
        (
            "hourCycle=h23",
            "3/4/2021, 14:06:07; 3/4/2021, 05:06:07; 3/4/2021; 05:06:07; 3/2021; 3/4",
        ),
        (
            "era=short timeZoneName=short",
            "3/4/2021 AD, 2:06:07 PM GMT+9; 3/4/2021 AD, 5:06:07 AM; 3/4/2021 AD; 5:06:07 AM; 3/2021 AD; 3/4",
        ),
        ("day=numeric", "4; 4; 4; -; -; 4"),
        ("hour=numeric", "2 PM; 5 AM; -; 5 AM; -; -"),
        (
            "dateStyle=medium",
            "Mar 4, 2021; Mar 4, 2021; Mar 4, 2021; -; Mar 2021; Mar 4",
        ),
        (
            "timeStyle=long",
            "2:06:07 PM GMT+9; 5:06:07 AM; -; 5:06:07 AM; -; -",
        ),
    ] {
        let format = Format::new("en", &format!("timeZone=Asia/Tokyo {pairs}"));
        let formatted = values.map(|value| match format.try_format(value) {
            Err(Error::Type("DateTimeFormat has no fields applicable to this Temporal type")) => {
                "-".into()
            }
            formatted => formatted.unwrap(),
        });
        assert_eq!(formatted.join("; "), expected, "{pairs}");
    }
}

#[test]
fn a_style_keeps_the_cyclic_year() {
    let format = Format::new("en-u-ca-chinese", "dateStyle=long timeStyle=long");
    assert_eq!(
        format.format(date("2020-01-02")),
        "Twelfth Month 8, 2019(ji-hai)"
    );
}

#[test]
fn nanoseconds_are_rounded_down() {
    let format = Format::new("en", ALL_DIGITS);
    for value in [
        DateTimeValue::Instant(Instant::new(-1).unwrap()),
        date_time("1969-12-31T23:59:59.999999999"),
    ] {
        assert_eq!(format.format(value), "12/31/1969, 23:59:59");
    }
}

#[test]
fn calendars_must_match() {
    let mismatch = Err(Error::Range(
        "Temporal object's calendar does not match DateTimeFormat calendar",
    ));
    let format = Format::new("en", "");
    assert_eq!(format.try_format(date("2021-03-04[u-ca=hebrew]")), mismatch);
    assert_eq!(format.try_format(year_month("2021-03")), mismatch);
    assert_eq!(format.try_format(month_day("03-04")), mismatch);
    let format = Format::new("en-u-ca-iso8601", "");
    assert_eq!(format.format(year_month("-271821-04")), "271822-04");
    assert_eq!(format.format(year_month("+275760-09")), "275760-09");
}

#[test]
fn ranges_of_temporal_values() {
    let format = Format::new("en", "timeZone=Asia/Tokyo");
    let range = format.try_range(date("2021-03-04"), date("2021-03-06"));
    assert_eq!(range.unwrap(), "3/4/2021 – 3/6/2021");
    let range = format.try_range(time("05:06:07"), time("05:06:07.5"));
    assert_eq!(range.unwrap(), "5:06:07 AM");
    for other in [time("05:06"), DateTimeValue::Number(0.0)] {
        assert_eq!(
            format.try_range(date("2021-03-04"), other),
            Err(Error::Type(
                "formatRange requires both arguments to be the same Temporal type"
            ))
        );
    }
}

#[test]
fn zoned_date_times() {
    let cache = Cache::default();
    let format = |locale, zone: &str, calendar| {
        let format = make(
            &cache,
            locale,
            &format!("timeZone={zone}"),
            Purpose::ZonedDateTime,
        )?;
        let zone = parse_time_zone(text(zone))?;
        let value = ZonedDateTime::new(Instant::new(0).unwrap(), zone, calendar);
        (format.format_zoned_date_time(&cache, &value)).map(|it| it.to_string())
    };
    assert_eq!(
        format("en", "+01:00", CalendarId::Iso8601).unwrap(),
        "1/1/1970, 1:00:00 AM GMT+1"
    );
    assert_eq!(
        format("en", "+00:00", CalendarId::Gregory).unwrap(),
        "1/1/1970, 12:00:00 AM GMT"
    );
    assert_eq!(
        format("en", "UTC", CalendarId::Hebrew),
        Err(Error::Range(
            "ZonedDateTime calendar does not match locale calendar"
        ))
    );
    let formatted = Format::new("en", "").try_format(DateTimeValue::ZonedDateTime);
    assert!(matches!(formatted, Err(Error::Type(_))));
}
