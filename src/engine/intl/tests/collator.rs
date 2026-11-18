mod support;

use core::cmp::Ordering;

use bun_engine_intl::collator::{CaseFirst, Collator, Options, Sensitivity, Usage};
use bun_engine_intl::{Cache, KeywordValue, Named};
use bun_engine_text::Text;
use bun_icu::collator::{Attribute, Collator as IcuCollator, Value};
use support::{Random, locales, narrow, units, wide};

fn resolved(tag: &str, options: &Options) -> String {
    let cache = Cache::default();
    let it = Collator::new(&cache, &locales(&cache, tag), options).unwrap();
    format!(
        "{} {} {} {} {}",
        it.locale().string(),
        it.collation(),
        it.case_first().as_str(),
        it.is_numeric(),
        it.ignores_punctuation()
    )
}

#[test]
fn keywords_and_options() {
    let default = Options::default();
    let tag = "de-AT-u-co-phonebk-ka-shifted-kf-upper-kn";
    assert_eq!(
        resolved(tag, &default),
        "de-AT-u-co-phonebk-kf-upper-kn phonebk upper true false"
    );
    let overriding = Options {
        collation: Some(KeywordValue::collation(Text::from_ascii("EOR")).unwrap()),
        numeric: Some(false),
        case_first: Some(CaseFirst::Upper),
        ..Options::default()
    };
    assert_eq!(
        resolved(tag, &overriding),
        "de-AT-u-kf-upper eor upper false false"
    );
    let search = Options {
        usage: Usage::Search,
        ..Options::default()
    };
    assert_eq!(
        resolved("de-u-co-phonebk", &search),
        "de default false false false"
    );
    assert_eq!(
        resolved("en-u-co-search-kf", &default),
        "en default false false false"
    );
    assert_eq!(resolved("th", &default), "th default false false true");
}

#[test]
fn tailorings() {
    let cache = Cache::default();
    let compare = |locale: Option<&str>, a, b| {
        let locale = locale.map(narrow);
        let (a, b) = (narrow(a), narrow(b));
        Collator::compare_by_default(&cache, locale.as_deref(), a.text(), b.text()).unwrap()
    };
    assert_eq!(compare(None, "\u{e4}", "z"), Ordering::Less);
    assert_eq!(compare(Some("sv"), "\u{e4}", "z"), Ordering::Greater);
    assert_eq!(compare(Some("cs"), "ch", "h"), Ordering::Greater);
    assert_eq!(compare(Some("de"), "ch", "h"), Ordering::Less);
    assert_eq!(compare(None, "\u{212b}", "A\u{30a}"), Ordering::Equal);
}

#[test]
fn english_is_the_root_order() {
    let cache = Cache::default();
    let latin1: Vec<char> = ('\0'..='\u{ff}').collect();
    let few: Vec<char> = "aA\u{e1}\u{c0}\u{e6}lL\u{b7}0019 -\0\u{301}\u{661}\u{fdd1}4\u{3042}"
        .chars()
        .collect();
    let mut random = Random(1);
    for &sensitivity in Sensitivity::ALL {
        for &case_first in CaseFirst::ALL {
            for numeric in [false, true] {
                let options = Options {
                    sensitivity,
                    case_first: Some(case_first),
                    numeric: Some(numeric),
                    ..Options::default()
                };
                let collator = Collator::new(&cache, &locales(&cache, "en"), &options).unwrap();
                let expected = root_collator(sensitivity, case_first, numeric);
                for round in 0..6000 {
                    let (alphabet, length) = [(&latin1, 2), (&few, 5)][round % 2];
                    let prefix = random.text(alphabet, [0, 3, 20][round % 3]);
                    let a = prefix.clone() + &random.text(alphabet, length);
                    let b = prefix + &random.text(alphabet, length);
                    let order = expected.compare(&units(&a), &units(&b)).unwrap();
                    for (x, y) in [(narrow(&a), narrow(&b)), (wide(&a), narrow(&b))] {
                        assert_eq!(
                            collator.compare(x.text(), y.text()),
                            Ok(order),
                            "{a:?} {b:?}"
                        );
                    }
                }
            }
        }
    }
}

fn root_collator(sensitivity: Sensitivity, case_first: CaseFirst, numeric: bool) -> IcuCollator {
    let (strength, case_level) = match sensitivity {
        Sensitivity::Base => (Value::Primary, Value::Off),
        Sensitivity::Accent => (Value::Secondary, Value::Off),
        Sensitivity::Case => (Value::Primary, Value::On),
        Sensitivity::Variant => (Value::Tertiary, Value::Off),
    };
    let case_first = match case_first {
        CaseFirst::Upper => Value::UpperFirst,
        CaseFirst::Lower => Value::LowerFirst,
        CaseFirst::False => Value::Off,
    };
    let numeric = if numeric { Value::On } else { Value::Off };
    let mut collator = IcuCollator::open(c"en_US").unwrap();
    assert!(!collator.is_tailored());
    for (attribute, value) in [
        (Attribute::Strength, strength),
        (Attribute::CaseLevel, case_level),
        (Attribute::CaseFirst, case_first),
        (Attribute::Numeric, numeric),
        (Attribute::Normalization, Value::On),
    ] {
        collator.set(attribute, value).unwrap();
    }
    collator
}
