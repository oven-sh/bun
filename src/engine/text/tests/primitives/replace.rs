use bun_engine_text::{MAX_LENGTH, Text};

use crate::support::*;

#[test]
fn units() {
    let mut random = Random::new();
    for length in lengths() {
        let units = random.units(length, &[0x61, 0x62, 0x63]);
        for (from, to) in [(0x61, 0x7a), (0x61, 0x17a), (0x161, 0x7a), (0x61, 0x61)] {
            let replace = |&unit: &u16| if unit == from { to } else { unit };
            let expected: Vec<u16> = units.iter().map(replace).collect();
            each_width(&units, |text| {
                let result = text.replace_unit(from, to).unwrap();
                assert_eq!(result.is_none(), expected == units);
                assert!(result.is_none_or(|it| units_of(it.text()) == expected));
            });
        }
    }
}

#[test]
fn needles() {
    let many = ("ab".repeat(200), "x".repeat(200));
    for (text, needle, replacement, expected) in [
        ("abcabc", "b", "", Some("acac")),
        ("aaaa", "aa", "b", Some("bb")),
        ("aaa", "aa", "$&", Some("$&a")),
        ("ab", "", "-", Some("-a-b-")),
        ("", "", "x", Some("x")),
        ("a", "a", "", Some("")),
        ("a\"b", "\"", "漢", Some("a漢b")),
        ("abc", "abcd", "x", None),
        (&many.0, "ab", "x", Some(&many.1)),
    ] {
        each_pair(&wide(text), &wide(needle), |text, needle| {
            each_width(&wide(replacement), |replacement| {
                let result = text.replace_all(needle, replacement).unwrap();
                assert_eq!(result.map(|it| units_of(it.text())), expected.map(wide));
            });
        });
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn a_result_that_is_too_long() {
    let text = vec![b'a'; MAX_LENGTH.isqrt() + 1];
    let text = Text::Latin1(&text);
    assert!(text.replace_all(Text::from_ascii("a"), text).is_err());
}
