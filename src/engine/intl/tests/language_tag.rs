use bun_engine_intl::{AvailableLocales, Cache, ErrorKind, LocaleList};
use bun_engine_standalone as _;
use bun_engine_text::StringRef;

fn canonical(tag: &str) -> Option<String> {
    let tag = Cache::default().canonicalize(&StringRef::from_str(tag));
    tag.ok().map(|tag| tag.string().to_string())
}

#[test]
fn canonical_syntax() {
    for (tag, expected) in [
        ("de", "de"),
        ("DE-de", "de-DE"),
        ("zh-hANT-tw", "zh-Hant-TW"),
        ("es-419", "es-419"),
        ("und", "und"),
        ("enochian-enochian", "enochian-enochian"),
        ("sl-rozaj-biske-1994", "sl-1994-biske-rozaj"),
        ("en-z-dd-u-kn-a-bb-t-en-0-cc", "en-0-cc-a-bb-t-en-u-kn-z-dd"),
        ("it-u-nu-latn-ca-gregory", "it-u-ca-gregory-nu-latn"),
        ("en-u-bbb-aaa-bbb", "en-u-aaa-bbb"),
        ("en-u-ca-gregory-ca-buddhist", "en-u-ca-gregory"),
        ("en-u-kn-true", "en-u-kn"),
        ("en-u-kn-true-true", "en-u-kn-true-true"),
        ("en-u-foo-true", "en-u-foo-true"),
        ("en-u-0c", "en-u-0c"),
        ("DE-T-M0-DIN-K0-QWERTZ", "de-t-k0-qwertz-m0-din"),
        ("en-t-m0-true", "en-t-m0-true"),
        ("en-t-und-Latn-US", "en-t-und-latn-us"),
        ("en-x-U-FOO-x-a", "en-x-u-foo-x-a"),
        ("en-US-posix", "en-US-u-va-posix"),
    ] {
        assert_eq!(canonical(tag).as_deref(), Some(expected), "{tag}");
    }
}

#[test]
fn aliases() {
    for (tag, expected) in [
        ("iw", "he"),
        ("cmn-hans-cn", "zh-Hans-CN"),
        ("sh", "sr-Latn"),
        ("sh-Cyrl", "sr-Cyrl"),
        ("cnr-BA", "sr-BA"),
        ("sgn-DD", "gsg"),
        ("art-lojban-u-kn", "jbo-u-kn"),
        ("zh-hakka-xiang", "hak"),
        ("arm-AM-arevmda", "hyw-AM"),
        ("sv-aaland", "sv-AX"),
        ("ja-latn-hepburn-heploc", "ja-Latn-alalc97"),
        ("el-polytoni-polyton", "el-polyton"),
        ("und-Qaai", "und-Zinh"),
        ("en-SU", "en-RU"),
        ("hy-SU", "hy-AM"),
        ("und-Armn-810", "und-Armn-AM"),
        ("az-NT", "az-SA"),
        ("en-t-sh", "en-t-sr-latn"),
        ("und-t-m0-names", "und-t-m0-prprname"),
        ("und-u-ca-islamicc", "und-u-ca-islamic-civil"),
        ("und-u-ca-ethiopic-amete-alem", "und-u-ca-ethioaa"),
        ("und-u-kn-yes", "und-u-kn"),
        ("und-u-ka-yes", "und-u-ka-yes"),
        ("und-u-tz-eire", "und-u-tz-iedub"),
        ("und-u-rg-lud", "und-u-rg-lucl"),
        ("und-u-sd-usas", "und-u-sd-aszzzz"),
    ] {
        assert_eq!(canonical(tag).as_deref(), Some(expected), "{tag}");
    }
}

#[test]
fn invalid_tags() {
    for tag in [
        "",
        "-",
        "a",
        "abcd",
        "abcdefghi",
        "en-",
        "-en",
        "en--US",
        "en_US",
        "en-*",
        "e\u{f1}",
        "en-\u{ff21}\u{ff21}",
        "i-klingon",
        "x-foo",
        "root",
        "zh-cmn-Hans",
        "de-419-DE",
        "en-u",
        "en-u-c0",
        "en-u-kn-u-ko",
        "en-t",
        "en-t-a0",
        "en-t-en-a0-b0-abc",
        "en-t-latn",
        "en-a",
        "en-a-bb-a-cc",
        "en-x",
        "en-x-abcdefghi",
        "de-1901-1901",
        "en-t-de-1901-1901",
        "en\0",
    ] {
        assert_eq!(canonical(tag), None, "{tag}");
    }
    let error = (Cache::default().canonicalize(&StringRef::from_str("\u{3042}"))).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::RangeError);
    assert_eq!(
        error.message().to_string(),
        "invalid language tag: \u{3042}"
    );
}

#[test]
fn any_number_of_subtags() {
    let variants: Vec<String> = (10_000..30_000).map(|it| it.to_string()).collect();
    let descending: Vec<&str> = variants.iter().rev().map(String::as_str).collect();
    assert_eq!(
        canonical(&format!("en-{}", descending.join("-"))),
        Some(format!("en-{}", variants.join("-")))
    );
    let value = ["abcdefgh"; 5000].join("-");
    let tag = format!("en-t-m0-{value}-u-ca-{value}-x-{value}");
    assert_eq!(canonical(&tag), Some(tag));
}

#[test]
fn lists_keep_the_first_of_equal_tags() {
    let cache = Cache::default();
    let mut list = LocaleList::default();
    for round in 0..2 {
        for index in 0..100 {
            let language = ["en", "EN"][round];
            let tag = StringRef::from_str(&format!("{language}-x-{index}"));
            list.push(cache.canonicalize(&tag).unwrap()).unwrap();
        }
    }
    assert_eq!(list.len(), 100);
    assert_eq!(list[99].string().to_string(), "en-x-99");
}

#[test]
fn supported_locales() {
    let cache = Cache::default();
    let mut list = LocaleList::default();
    for tag in ["zxx", "de-XX-u-kn", "und", "zh-TW", "ca-ES-valencia-x-a"] {
        list.push(cache.canonicalize(&StringRef::from_str(tag)).unwrap())
            .unwrap();
    }
    for available in [AvailableLocales::general(), AvailableLocales::collator()] {
        let supported: Vec<String> = (available.filter(&list))
            .map(|tag| tag.string().to_string())
            .collect();
        assert_eq!(supported, ["de-XX-u-kn", "zh-TW", "ca-ES-valencia-x-a"]);
    }
}
