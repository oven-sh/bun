mod support;

use bun_engine_intl::display_names::{self, DisplayNames, Fallback, LanguageDisplay};
use bun_engine_intl::list_format::{self, ListFormat};
use bun_engine_intl::relative_time_format::{Numeric, RelativeTimeFormat};
use bun_engine_intl::{Cache, Named, Style};
use bun_engine_text::Text;
use bun_icu::CText;
use bun_icu::list_format::{Kind, ListFormatter, Width};
use support::{describe_error, describe_parts, languages, locales, narrow, units};

#[test]
fn relative_time() {
    let cache = Cache::default();
    let requested = locales(&cache, "en");
    let format = RelativeTimeFormat::new(&cache, &requested, None, Style::Long, Numeric::Auto);
    let format = format.unwrap();
    let text = |value, unit| match format.format(value, Text::from_ascii(unit)) {
        Ok(text) => text.to_string(),
        Err(error) => describe_error(&error),
    };
    assert_eq!(text(-1.0, "day"), "yesterday");
    assert_eq!(text(-0.0, "seconds"), "now");
    assert_eq!(text(0.999, "day"), "in 0.999 days");
    assert_eq!(text(1.0005, "quarters"), "in 1.001 quarters");
    assert_eq!(
        text(f64::NAN, "x"),
        "RangeError: number argument must be finite"
    );
    assert_eq!(
        text(1.0, "millisecond"),
        "RangeError: unit argument is not a recognized unit type"
    );
    let parts = format.format_to_parts(-1000.5, Text::from_ascii("years"));
    assert_eq!(
        describe_parts(&parts.unwrap()).join("|"),
        "integer:1:year|group:,:year|integer:000:year|decimal:.:year|fraction:5:year|literal: years ago"
    );
}

#[test]
fn list_parts() {
    let cache = Cache::default();
    let kind = list_format::Type::Conjunction;
    let format = ListFormat::new(&cache, &locales(&cache, "en"), kind, Style::Long).unwrap();
    let describe = |list: &[&str]| {
        let list: Vec<_> = list.iter().map(|it| narrow(it)).collect();
        let parts = format.format_to_parts(&list).unwrap();
        let parts: Vec<_> = (parts.iter())
            .map(|(kind, value)| format!("{}:{value}", kind.as_str()))
            .collect();
        parts.join("|")
    };
    assert_eq!(describe(&[]), "");
    assert_eq!(describe(&[""]), "element:");
    assert_eq!(
        describe(&["", "a", ""]),
        "element:|literal:, |element:a|literal:, and |element:"
    );
}

#[test]
fn lists_in_every_language() {
    let cache = Cache::default();
    let last_words: Vec<String> = ('a'..='z')
        .chain("018\u{e9}\u{3b1}\u{430}\u{5d0}\u{627}\u{e01}\u{3042}\u{4e00}\u{ac00}".chars())
        .map(String::from)
        .chain(["", "hi", "hie", "ho", "11", "11 a", "110"].map(String::from))
        .collect();
    for language in languages() {
        for (kind, icu_kind) in [
            (list_format::Type::Conjunction, Kind::And),
            (list_format::Type::Disjunction, Kind::Or),
            (list_format::Type::Unit, Kind::Units),
        ] {
            let requested = locales(&cache, language);
            let format = ListFormat::new(&cache, &requested, kind, Style::Long).unwrap();
            let locale = CText::new(language.as_bytes()).unwrap();
            let expected = ListFormatter::open(&locale, icu_kind, Width::Wide).unwrap();
            for (index, last) in last_words.iter().enumerate() {
                let list = vec![last.as_str(); 1 + index % 6];
                let elements: Vec<_> = list.iter().map(|it| units(it)).collect();
                let expected = expected.format(elements.iter().map(Vec::as_slice)).unwrap();
                let strings: Vec<_> = list.iter().map(|it| narrow(it)).collect();
                assert_eq!(
                    format.format(&strings).unwrap().text(),
                    Text::Utf16(expected.value().unwrap().text().unwrap()),
                    "{language}"
                );
            }
        }
    }
}

#[test]
fn display_names() {
    use display_names::{Style, Type};

    let cache = Cache::default();
    let of = |kind, style, fallback, code: &str| {
        let options = display_names::Options {
            style,
            kind,
            fallback,
            language_display: LanguageDisplay::Dialect,
        };
        let names = DisplayNames::new(&cache, &locales(&cache, "en"), options).unwrap();
        match names.of(&cache, narrow(code).text()) {
            Ok(name) => name.map_or_else(|| "undefined".into(), |it| it.to_string()),
            Err(error) => describe_error(&error),
        }
    };
    let long_calendar = ["abcdefgh"; 40].join("-");
    for (kind, style, code, expected) in [
        (Type::Language, Style::Long, "EN-gb", "British English"),
        (Type::Language, Style::Long, "tl", "Filipino"),
        (Type::Language, Style::Long, "EN-ab", "en-AB"),
        (
            Type::Language,
            Style::Long,
            "en-u-kn",
            "RangeError: argument is not a language id",
        ),
        (Type::Region, Style::Short, "us", "US"),
        (
            Type::Region,
            Style::Long,
            "u",
            "RangeError: argument is not a region subtag",
        ),
        (Type::Script, Style::Long, "cYRL", "Cyrillic"),
        (Type::Script, Style::Long, "aBCD", "Abcd"),
        (Type::Currency, Style::Narrow, "cad", "$"),
        (Type::Currency, Style::Short, "cad", "CA$"),
        (Type::Currency, Style::Long, "abc", "ABC"),
        (Type::Calendar, Style::Long, "GREGORY", "Gregorian Calendar"),
        (Type::Calendar, Style::Long, &long_calendar, &long_calendar),
        (Type::DateTimeField, Style::Short, "weekOfYear", "wk."),
        (
            Type::DateTimeField,
            Style::Short,
            "week",
            "RangeError: argument is not a dateTimeField code",
        ),
    ] {
        assert_eq!(of(kind, style, Fallback::Code, code), expected, "{code}");
    }
    assert_eq!(
        of(Type::Region, Style::Long, Fallback::None, "ab"),
        "undefined"
    );
}
