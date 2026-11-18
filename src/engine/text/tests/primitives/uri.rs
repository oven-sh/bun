use bun_engine_text::{StringRef, Text, UriError, UriSet};

use crate::support::*;

fn result<E>(text: Text<'_>, changed: Result<Option<StringRef>, E>) -> Result<Vec<u16>, E> {
    let changed = changed?;
    assert!(changed.as_ref().is_none_or(|it| it.text() != text));
    Ok(units_of(changed.as_ref().map_or(text, |it| it.text())))
}

fn encoded(text: &str, kept: &str) -> Vec<u16> {
    let form = |byte: u8| {
        if byte.is_ascii_alphanumeric() || kept.bytes().any(|it| it == byte) {
            char::from(byte).to_string()
        } else {
            format!("%{byte:02X}")
        }
    };
    text.bytes().flat_map(|byte| wide(&form(byte))).collect()
}

fn escaped(units: &[u16]) -> Vec<u16> {
    let form = |&unit: &u16| match char::from_u32(unit.into()) {
        Some(
            it @ ('a'..='z' | 'A'..='Z' | '0'..='9' | '@' | '*' | '_' | '+' | '-' | '.' | '/'),
        ) => it.to_string(),
        Some(..='\u{ff}') => format!("%{unit:02X}"),
        _ => format!("%u{unit:04X}"),
    };
    units.iter().flat_map(|unit| wide(&form(unit))).collect()
}

fn check(text: &str) {
    let units = wide(text);
    let component = encoded(text, "-_.!~*'()");
    let uri = encoded(text, "-_.!~*'();/?:@&=+$,#");
    let escaped = escaped(&units);
    each_width(&units, |it| {
        assert_eq!(
            result(it, it.encode_uri(UriSet::Component)).unwrap(),
            component
        );
        assert_eq!(result(it, it.encode_uri(UriSet::Uri)).unwrap(), uri);
        assert_eq!(result(it, it.escape()).unwrap(), escaped);
    });
    each_width(&component, |it| {
        assert_eq!(result(it, it.decode_uri(UriSet::Component)).unwrap(), units);
    });
    each_width(&uri, |it| {
        assert_eq!(result(it, it.decode_uri(UriSet::Uri)).unwrap(), units)
    });
    each_width(&escaped, |it| {
        assert_eq!(result(it, it.unescape()).unwrap(), units)
    });
}

#[test]
fn every_character_below_0x900_and_the_ends_of_the_ranges() {
    let step = if cfg!(miri) { 61 } else { 1 };
    let ends = [
        '\u{d7ff}',
        '\u{e000}',
        '\u{ffff}',
        '\u{10000}',
        '\u{10ffff}',
    ];
    for character in ('\0'..'\u{900}').step_by(step).chain(ends) {
        check(&character.to_string());
        check(&format!(
            "{0}{character}{0}",
            "a".repeat(character as usize % 40)
        ));
    }
}

#[test]
fn texts_of_any_length() {
    let mut random = Random::new();
    for alphabet in [
        "ab",
        "abcdefg %",
        "a/é",
        "漢a",
        "😀\u{ffff}",
        "abcdefghijklmnopqrstuvwxyz0123€",
    ] {
        let alphabet: Vec<char> = alphabet.chars().collect();
        for length in lengths() {
            check(
                &(0..length)
                    .map(|_| random.pick(&alphabet))
                    .collect::<String>(),
            );
        }
    }
}

#[test]
fn lone_surrogates_are_refused() {
    for units in [
        &[0xd800][..],
        &[0xdc00, 0xd800],
        &[0x61, 0xdbff, 0x61],
        &[0xd800, 0xd800, 0xdc00],
    ] {
        let result = Text::Utf16(units).encode_uri(UriSet::Uri);
        assert_eq!(result, Err(UriError::LoneSurrogate));
    }
}

#[test]
fn malformed_escapes() {
    let malformed = [
        "%",
        "%4",
        "%4g",
        "%g4",
        "%80",
        "%C0%80",
        "%C3",
        "%C3%",
        "%C3%A",
        "%C3A9a",
        "%C3%28",
        "%E0%80%80",
        "%ED%A0%80",
        "%E2%82",
        "%F0%80%80%80",
        "%F4%90%80%80",
        "%F8%88%80%80%80",
        "%u0041",
        "%\u{134}1",
    ];
    for (text, padding) in malformed.iter().flat_map(|it| [(it, 0), (it, 20)]) {
        let padding = "z".repeat(padding);
        each_width(&wide(&format!("{padding}{text}{padding}")), |it| {
            assert_eq!(
                it.decode_uri(UriSet::Component),
                Err(UriError::MalformedEscape)
            );
        });
    }
}

#[test]
fn escapes_that_stay() {
    each_width(&wide("%2f%2F%23%41%25"), |it| {
        assert_eq!(
            result(it, it.decode_uri(UriSet::Uri)).unwrap(),
            wide("%2f%2F%23A%")
        );
    });
    for (text, expected) in [
        ("%", "%"),
        ("%u00", "%u00"),
        ("%%41%u004g", "%A%u004g"),
        ("%U0041", "%U0041"),
    ] {
        each_width(&wide(text), |it| {
            assert_eq!(result(it, it.unescape()).unwrap(), wide(expected))
        });
    }
}
