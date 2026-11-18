mod support;

use bun_engine_intl::collator::CaseFirst;
use bun_engine_intl::locale::{Direction, Locale, Options};
use bun_engine_intl::{Cache, HourCycle, KeywordValue, supported_values_of};
use bun_engine_text::Text;
use support::{describe_error, narrow, strings};

fn locale(tag: &str) -> Locale {
    Locale::new(&Cache::default(), &narrow(tag)).unwrap()
}

fn tag(locale: &Locale) -> String {
    locale.tag().string().to_string()
}

#[test]
fn getters() {
    let it =
        locale("de-latn-de-fonipa-1996-u-ca-gregory-co-phonebk-fw-tue-hc-h23-kf-kn-nu-latn-x-a");
    let present = [
        it.script(),
        it.region(),
        it.variants(),
        it.calendar(),
        it.collation(),
        it.first_day_of_week(),
        it.hour_cycle(),
        it.case_first(),
        it.numbering_system(),
    ];
    assert_eq!(
        strings(&present.map(Option::unwrap)),
        [
            "Latn",
            "DE",
            "1996-fonipa",
            "gregory",
            "phonebk",
            "tue",
            "h23",
            "",
            "latn"
        ]
    );
    assert_eq!(
        strings(&[it.base_name(), it.language()]),
        ["de-Latn-DE-1996-fonipa", "de"]
    );
    assert!(it.is_numeric());

    let it = locale("und-a-ca-foo-u-kn-false-x-u-nu-arab");
    let absent = [it.script(), it.region(), it.variants(), it.calendar()];
    assert_eq!(absent, [None, None, None, None]);
    assert_eq!(it.numbering_system(), None);
    assert!(!it.is_numeric());
}

#[test]
fn options_override_the_tag() {
    let text = Text::from_ascii;
    let mut options = Options::default();
    options.set_language(text("HY")).unwrap();
    options.set_region(text("su")).unwrap();
    options.set_variants(text("Fonipa-1996")).unwrap();
    options.set_first_day_of_week(text("0")).unwrap();
    options.calendar = Some(KeywordValue::calendar(text("ISLAMICC")).unwrap());
    options.hour_cycle = Some(HourCycle::H11);
    options.case_first = Some(CaseFirst::False);
    options.numeric = Some(true);
    let changed = locale("en-Armn-US-abcde-u-attr-hc-h12-nu-thai-x-a").with_options(options);
    assert_eq!(
        tag(&changed.unwrap()),
        "hy-Armn-AM-1996-fonipa-u-attr-ca-islamic-civil-fw-sun-hc-h11-kf-false-kn-nu-thai-x-a"
    );

    let mut options = Options::default();
    assert!(options.set_language(text("abcd")).is_err());
    assert!(options.set_script(text("abc")).is_err());
    assert!(options.set_region(text("a1")).is_err());
    assert!(options.set_first_day_of_week(text("8")).is_err());
    for variants in ["", "abc", "abcde-ABCDE", "abcde-", "abcde--fghij"] {
        assert!(options.set_variants(text(variants)).is_err(), "{variants}");
    }
    let error = Locale::new(&Cache::default(), &narrow("a")).err();
    assert_eq!(
        describe_error(&error.unwrap()),
        "RangeError: invalid language tag"
    );
}

#[test]
fn likely_subtags() {
    for (source, maximal, minimal) in [
        ("zh-Hant", "zh-Hant-TW", "zh-TW"),
        ("und", "en-Latn-US", "en"),
        ("und-Thai", "th-Thai-TH", "th"),
        ("posix", "posix", "posix"),
        (
            "es-ES-preeuro-a-bc-u-kn-x-y",
            "es-Latn-ES-preeuro-a-bc-u-kn-x-y",
            "es-preeuro-a-bc-u-kn-x-y",
        ),
    ] {
        assert_eq!(tag(&locale(source).maximize().unwrap()), maximal);
        assert_eq!(tag(&locale(source).minimize().unwrap()), minimal);
    }
}

#[test]
fn regional_preferences() {
    for (source, calendar, hour_cycle, first_day, weekend) in [
        ("en", "gregory", "h12", 7, &[6, 7][..]),
        ("fr-CA", "gregory", "h23", 7, &[6, 7]),
        ("fa", "persian", "h23", 6, &[5]),
        ("fa-u-sd-inka", "gregory", "h12", 7, &[7]),
        ("fa-GB-u-sd-inka", "gregory", "h23", 1, &[6, 7]),
        ("fa-GB-u-rg-thzzzz", "buddhist", "h23", 7, &[6, 7]),
        ("th-u-rg-xxzzzz", "buddhist", "h23", 7, &[6, 7]),
        ("eo", "gregory", "h23", 1, &[6, 7]),
        ("en-u-ca-iso8601-hc-h24", "iso8601", "h24", 1, &[6, 7]),
        ("en-u-ca-fw-wed-hc", "gregory", "h12", 3, &[6, 7]),
    ] {
        let it = locale(source);
        assert_eq!(it.calendars().unwrap()[0].to_string(), calendar, "{source}");
        assert_eq!(
            strings(&it.hour_cycles().unwrap()),
            [hour_cycle],
            "{source}"
        );
        let week = it.week_info().unwrap();
        assert_eq!(
            (week.first_day, &*week.weekend),
            (first_day, weekend),
            "{source}"
        );
    }
}

#[test]
fn data_of_the_language() {
    let collations = |source| strings(&locale(source).collations().unwrap());
    assert_eq!(collations("de-CH"), ["emoji", "eor", "phonebk"]);
    assert_eq!(collations("qfz"), ["emoji", "eor"]);
    let numbering_systems = |source| strings(&locale(source).numbering_systems().unwrap());
    assert_eq!(numbering_systems("fa"), ["arabext"]);
    assert_eq!(numbering_systems("qfz"), ["latn"]);
    assert_eq!(locale("dv").direction(), Ok(Direction::RightToLeft));
    assert_eq!(locale("ar-Latn").direction(), Ok(Direction::LeftToRight));
    assert_eq!(locale("en").time_zones(), Ok(None));
    assert_eq!(
        strings(&locale("en-NZ").time_zones().unwrap().unwrap()),
        ["Pacific/Auckland", "Pacific/Chatham"]
    );
}

#[test]
fn supported_values() {
    for (key, member) in [
        ("calendar", "iso8601"),
        ("collation", "phonebk"),
        ("currency", "VES"),
        ("numberingSystem", "hanidec"),
        ("timeZone", "Asia/Kolkata"),
        ("unit", "mile-scandinavian"),
    ] {
        let values = strings(&supported_values_of(Text::from_ascii(key)).unwrap());
        assert!(values.is_sorted_by(|a, b| a < b), "{key}");
        assert!(values.iter().any(|it| it == member), "{key}");
    }
    assert!(supported_values_of(Text::from_ascii("region")).is_err());
}
