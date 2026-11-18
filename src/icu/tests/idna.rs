use bun_engine_standalone as _;
use bun_icu::idna::{self, Name, Verdict};

fn convert(
    conversion: fn(&[u16], &mut Name) -> bun_icu::Result<Verdict>,
    name: &str,
) -> (String, Verdict) {
    let units: Vec<u16> = name.encode_utf16().collect();
    let mut out = Name::new();
    let verdict = conversion(&units, &mut out).unwrap();
    (String::from_utf16(&out).unwrap(), verdict)
}

#[test]
fn names_in_both_directions() {
    for (unicode, ascii) in [
        ("faß.example", "xn--fa-hia.example"),
        ("☕.example", "xn--53h.example"),
        ("إختبار", "xn--kgbechtv"),
        ("-é-..a_b", "xn-----bja..a_b"),
        ("", ""),
    ] {
        let valid = |text: &str| (text.to_owned(), Verdict::Valid);
        assert_eq!(convert(idna::to_ascii, unicode), valid(ascii));
        assert_eq!(convert(idna::to_unicode, ascii), valid(unicode));
    }
    let long = convert(idna::to_ascii, &"É。".repeat(100));
    assert_eq!(long, ("xn--9ca.".repeat(100), Verdict::Valid));
}

#[test]
fn invalid_names() {
    for name in ["\u{fffd}", "xn--a", "\u{301}a", "a\u{200d}", "0a.\u{5d0}"] {
        assert_eq!(convert(idna::to_ascii, name).1, Verdict::Invalid, "{name}");
    }
}

#[test]
fn characters_of_labels() {
    let is_mapped = |text: &str| idna::is_mapped(&text.encode_utf16().collect::<Vec<_>>()).unwrap();
    assert!(is_mapped("é") && is_mapped("ß") && is_mapped(""));
    assert!(!is_mapped("É") && !is_mapped("e\u{301}") && !is_mapped("\u{80}"));
    assert!(['\u{5d0}', '\u{627}', '\u{660}'].map(idna::is_right_to_left) == [true; 3]);
    assert!(['a', '1', '\u{301}'].map(idna::is_right_to_left) == [false; 3]);
    assert!(['\u{301}', '\u{20dd}', '\u{903}'].map(idna::is_mark) == [true; 3]);
    assert!(!idna::is_mark('a'));
}
