use bun_engine_intl::duration_format::{
    Display, DurationFormat, FractionalDigits, Options, Style, UnitStyle, Units, properties,
};
use bun_engine_intl::{Cache, Named, OptionValue, Result};
use bun_engine_standalone as _;
use bun_engine_temporal::{Duration, PartialDuration, Unit};
use bun_engine_text::{StringRef, Text};

/// From `name=value` pairs.
fn make(locale: &str, pairs: &str) -> Result<DurationFormat> {
    let option = |name: &str| {
        (pairs.split_ascii_whitespace())
            .find_map(|pair| pair.strip_prefix(name)?.strip_prefix('='))
            .map(Text::from_ascii)
    };
    let style = option("style").map(Style::parse).transpose()?;
    let mut units = Units::new(style.unwrap_or_default());
    for unit in Unit::ALL {
        let [style, display] = properties(unit).map(|name| option(&name.text().to_string()));
        let style = style.map(|it| UnitStyle::parse(unit, it)).transpose()?;
        units.set(unit, style, display.map(Display::parse).transpose()?)?;
    }
    let digits = option("fractionalDigits").map(|it| it.to_string().parse().unwrap());
    let options = Options {
        numbering_system: None,
        units,
        fractional_digits: digits.map(FractionalDigits::new).transpose()?,
    };
    let cache = Cache::default();
    let tag = cache.canonicalize(&StringRef::from_str(locale))?;
    DurationFormat::new(&cache, &[tag], &options)
}

fn duration(source: &str) -> Duration {
    Duration::parse(Text::from_ascii(source)).unwrap()
}

#[test]
fn styles() {
    for (locale, pairs, source, expected) in [
        ("en", "", "P1Y2M3W4D", "1 yr, 2 mths, 3 wks, 4 days"),
        ("en", "style=long", "PT1H2S", "1 hour, 2 seconds"),
        ("en", "style=narrow", "PT1H2M3S", "1h 2m 3s"),
        ("en", "style=digital", "P1DT1H2M3.5S", "1 day, 1:02:03.5"),
        ("da", "style=digital", "PT1H2M3.5S", "1.02.03,5"),
        ("ar-EG", "style=digital", "PT1H2M3S", "١:٠٢:٠٣"),
        ("en", "", "PT0S", ""),
        ("en", "daysDisplay=always", "PT0S", "0 days"),
        ("en", "hours=2-digit", "PT1H", "01:00:00"),
        ("en", "style=digital hoursDisplay=auto", "PT2S", "00:02"),
        ("en", "seconds=numeric", "PT2M5S", "2 min, 5"),
    ] {
        let formatted = make(locale, pairs).unwrap().format(&duration(source));
        assert_eq!(formatted.unwrap().to_string(), expected, "{pairs}");
    }
}

#[test]
fn zero_minutes_are_shown_between_numeric_hours_and_seconds() {
    for (pairs, source, expected) in [
        ("hours=numeric", "PT1H", "1"),
        ("hours=numeric", "PT1H1S", "1:00:01"),
        ("hours=numeric", "PT1H0.000000001S", "1:00:00.000000001"),
        ("hours=long minutes=numeric", "PT1H1S", "1 hour, 01"),
    ] {
        let pairs = format!("{pairs} minutesDisplay=auto secondsDisplay=auto");
        let formatted = make("en", &pairs).unwrap().format(&duration(source));
        assert_eq!(formatted.unwrap().to_string(), expected);
    }
}

#[test]
fn only_the_first_number_has_a_sign() {
    for (pairs, source, expected) in [
        ("", "-P1Y2M", "-1 yr, 2 mths"),
        ("hoursDisplay=always", "-PT1S", "-0 hr, 1 sec"),
        ("style=digital", "-PT0.5S", "-0:00:00.5"),
        ("seconds=numeric", "-PT0.5S", "-0.5"),
        ("seconds=numeric fractionalDigits=0", "-PT0.5S", "-0"),
    ] {
        let formatted = make("en", pairs).unwrap().format(&duration(source));
        assert_eq!(formatted.unwrap().to_string(), expected);
    }
}

#[test]
fn fractions_are_exact_and_truncated() {
    for (pairs, source, expected) in [
        ("milliseconds=numeric", "PT0.000000001S", "0.000000001 sec"),
        ("microseconds=numeric", "PT2.00000025S", "2 sec, 0.00025 ms"),
        ("nanoseconds=numeric", "PT0.0000005S", "0.5 μs"),
        ("seconds=numeric fractionalDigits=2", "PT1.999S", "1.99"),
        ("seconds=numeric fractionalDigits=4", "PT1S", "1.0000"),
        (
            "seconds=numeric",
            "PT9007199254740991.999999999S",
            "9007199254740991.999999999",
        ),
    ] {
        let formatted = make("en", pairs).unwrap().format(&duration(source));
        assert_eq!(formatted.unwrap().to_string(), expected);
    }

    let mut fields = PartialDuration::default();
    fields
        .set(Unit::Millisecond, 4503599627370497024.0)
        .unwrap();
    fields
        .set(Unit::Microsecond, 4503599627370494951424.0)
        .unwrap();
    let format = make("en", "style=digital").unwrap();
    let formatted = format.format(fields.finish().unwrap());
    assert_eq!(
        formatted.unwrap().to_string(),
        "0:00:9007199254740991.975424"
    );
}

#[test]
fn parts() {
    let format = make("en", "style=digital").unwrap();
    let parts = format.format_to_parts(&duration("-P1000DT2H3.5S")).unwrap();
    let parts = parts.iter().map(|part| {
        let (part, value) = part.unwrap();
        let unit = part.unit.map_or("", Named::as_str);
        format!("{}:{value}:{unit}", part.kind.as_str())
    });
    assert_eq!(
        parts.collect::<Vec<_>>().join("|"),
        "minusSign:-:day|integer:1:day|group:,:day|integer:000:day|literal: :day|unit:days:day|literal:, :|\
         integer:2:hour|literal:::|integer:00:minute|literal:::|integer:03:second|decimal:.:second|fraction:5:second"
    );
}

#[test]
fn resolved_units() {
    for (pairs, expected) in [
        ("", "short short short short short short short"),
        (
            "style=digital",
            "short numeric! 2-digit! 2-digit! numeric numeric numeric",
        ),
        (
            "style=long minutes=numeric",
            "long long numeric! 2-digit! numeric numeric numeric",
        ),
        (
            "days=narrow microseconds=numeric",
            "narrow! short short short short numeric numeric",
        ),
    ] {
        let format = make("en", pairs).unwrap();
        let units = format.resolved_options().unwrap().units;
        let described = Unit::ALL[Unit::Day as usize..].iter().map(|&unit| {
            let options = units.get(unit);
            let always = ["", "!"][usize::from(options.display == Display::Always)];
            format!("{}{always}", options.style.as_str())
        });
        assert_eq!(described.collect::<Vec<_>>().join(" "), expected);
    }
}

#[test]
fn invalid_options() {
    let inconsistent = "style option is inconsistent";
    for (pairs, expected) in [
        ("hours=numeric minutes=long", inconsistent),
        ("milliseconds=numeric microseconds=short", inconsistent),
        ("style=digital nanosecondsDisplay=always", inconsistent),
        (
            "days=numeric",
            r#"style must be either "long", "short", or "narrow""#,
        ),
        (
            "milliseconds=2-digit",
            r#"style must be either "long", "short", "narrow", or "numeric""#,
        ),
        ("fractionalDigits=10", "fractionalDigits is out of range"),
    ] {
        let error = make("en", pairs).err().unwrap();
        assert_eq!(error.message().to_string(), expected);
    }
}
