use core::cmp::Ordering;

use bun_engine_standalone as _;
use bun_icu::collator::{Attribute, Collator, Value};
use bun_icu::formatted_value::{Category, FormattedValue};
use bun_icu::list_format::{self, ListFormatter};
use bun_icu::number_format::{
    Collapse, FormattedNumber, IdentityFallback, NumberFormatter, NumberRangeFormatter, field,
};
use bun_icu::numbering_system::NumberingSystem;
use bun_icu::resource_bundle::ResourceBundle;
use bun_icu::{Error, locale};

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn text(value: FormattedValue<'_>) -> String {
    String::from_utf16(value.text().unwrap()).unwrap()
}

#[test]
fn numbers() {
    let formatter = NumberFormatter::open(&units(".00"), c"de").unwrap();
    let mut result = FormattedNumber::open().unwrap();
    formatter.format_double(-1234.5, &mut result).unwrap();
    assert_eq!(text(result.value().unwrap()), "-1.234,50");

    let mut fields = result.value().unwrap().fields().unwrap();
    let mut found = Vec::new();
    while let Some(it) = fields.next().unwrap() {
        assert_eq!(it.category, Category::NUMBER);
        found.push((it.field, it.range));
    }
    assert_eq!(
        found,
        [
            (field::SIGN, 0..1),
            (field::GROUPING_SEPARATOR, 2..3),
            (field::INTEGER, 1..6),
            (field::DECIMAL_SEPARATOR, 6..7),
            (field::FRACTION, 7..9),
        ]
    );
    drop(fields);

    formatter
        .format_decimal(b"12345678901234567890.125", &mut result)
        .unwrap();
    assert_eq!(
        text(result.value().unwrap()),
        "12.345.678.901.234.567.890,12"
    );
    assert!(formatter.format_decimal(b"x", &mut result).is_err());
    assert!(NumberFormatter::open(&units("not-a-stem"), c"de").is_err());
}

#[test]
fn ranges() {
    let formatter = NumberRangeFormatter::open(
        &units("percent"),
        c"en",
        Collapse::Auto,
        IdentityFallback::Approximately,
    )
    .unwrap();
    let range = formatter.format_doubles(3.0, 5.0).unwrap();
    assert_eq!(text(range.value().unwrap()), "3% \u{2013} 5%");
    let mut spans = (range.value().unwrap())
        .fields_in(Category::NUMBER_RANGE_SPAN)
        .unwrap();
    assert_eq!(spans.next().unwrap().unwrap().range, 0..2);
    assert_eq!(spans.next().unwrap().unwrap().range, 5..7);
    assert_eq!(spans.next().unwrap(), None);

    let range = formatter.format_decimals(b"3", b"3.0").unwrap();
    assert_eq!(text(range.value().unwrap()), "~3%");
}

#[test]
fn lists() {
    let formatter =
        ListFormatter::open(c"en", list_format::Kind::Or, list_format::Width::Wide).unwrap();
    let strings = ["a", "", "ccc"].map(units);
    let list = formatter.format(strings.iter().map(Vec::as_slice)).unwrap();
    assert_eq!(text(list.value().unwrap()), "a, , or ccc");
    assert_eq!(text(formatter.format([]).unwrap().value().unwrap()), "");
}

#[test]
fn collation() {
    let mut collator = Collator::open(c"en").unwrap();
    assert!(!collator.is_tailored());
    assert!(Collator::open(c"sv").unwrap().is_tailored());
    assert_eq!(collator.compare_utf8(b"a", b"A"), Ok(Ordering::Less));
    collator.set(Attribute::Strength, Value::Primary).unwrap();
    assert_eq!(collator.has(Attribute::Strength, Value::Primary), Ok(true));
    assert_eq!(
        collator.compare(&units("a"), &units("\u{c1}")),
        Ok(Ordering::Equal)
    );
    assert!(collator.set(Attribute::Strength, Value::Shifted).is_err());
}

#[test]
fn collation_of_equivalent_text_with_any_number_of_marks() {
    let mut collator = Collator::open(c"en").unwrap();
    collator.set(Attribute::Normalization, Value::On).unwrap();
    for count in [10, 31, 32, 63, 64, 79, 80, 81, 160, 20_000] {
        let composed = units(&format!("\u{e1}{}", "\u{f73}".repeat(count)));
        let marks = ["\u{f72}".repeat(count), "\u{f71}".repeat(count)].concat();
        let reordered = units(&format!("a\u{301}{marks}"));
        assert_eq!(collator.compare(&composed, &reordered), Ok(Ordering::Equal));
        let upper = units(&format!("A\u{301}{marks}"));
        assert_eq!(collator.compare(&composed, &upper), Ok(Ordering::Less));
    }
}

#[test]
fn data() {
    assert_eq!(
        NumberingSystem::for_locale(c"fa").unwrap().name(),
        b"arabext"
    );
    assert!(NumberingSystem::by_name(c"roman").unwrap().is_algorithmic());
    assert!(NumberingSystem::by_name(c"none").is_err());

    let aliases = ResourceBundle::open_direct(c"metadata").unwrap();
    let aliases = aliases
        .by_key(c"alias")
        .unwrap()
        .by_key(c"language")
        .unwrap();
    assert_eq!(
        aliases.by_key(c"sh").unwrap().string_by_key(c"replacement"),
        Ok(&units("sr_Latn")[..])
    );
    assert_eq!(aliases.by_key(c"en").err(), Some(Error::MISSING_RESOURCE));

    assert!(locale::available().any(|it| it == c"sr_Latn_BA"));
    assert_eq!(
        locale::unicode_type(c"ca", c"islamicc"),
        Some(&b"islamic-civil"[..])
    );
    assert_eq!(locale::unicode_type(c"ca", c"unknown"), None);
    assert_eq!(
        &*locale::add_likely_subtags(c"zh_TW").unwrap(),
        b"zh_Hant_TW"
    );
    assert_eq!(&*locale::minimize_subtags(c"zh_Hant_TW").unwrap(), b"zh_TW");
}
