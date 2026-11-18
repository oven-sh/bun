use bun_engine_text::{CodeUnit, Cursor, StringBuilder, Text};

use crate::support::*;

fn quoted(units: &[u16]) -> Vec<u16> {
    let mut result = vec![0x22];
    for character in char::decode_utf16(units.iter().copied()) {
        let escaped = match character {
            Ok('\u{8}') => "\\b".into(),
            Ok('\t') => "\\t".into(),
            Ok('\n') => "\\n".into(),
            Ok('\u{c}') => "\\f".into(),
            Ok('\r') => "\\r".into(),
            Ok(it @ ('"' | '\\')) => format!("\\{it}"),
            Ok(it @ ..' ') => format!("\\u{:04x}", u32::from(it)),
            Ok(it) => it.to_string(),
            Err(lone) => format!("\\u{:04x}", lone.unpaired_surrogate()),
        };
        result.extend(escaped.encode_utf16());
    }
    result.push(0x22);
    result
}

/// All or nothing.
fn check_attempts<T: CodeUnit>(text: Text<'_>, expected: &[u16]) {
    for room in [0, text.len() + 1, text.len() + 2, 6 * text.len() + 200] {
        let (mut target, mut is_done) = (vec![T::default(); room], false);
        let length = Cursor::fill(&mut target, |to| is_done = to.try_push_json_quoted(text));
        let written = units_of(T::text(&target[..length]));
        assert_eq!(written, if is_done { expected } else { &[] });
        let is_sure = text.len() <= 64 && room > 200 && (!T::IS_LATIN1 || text.fits_latin1());
        assert!(is_done || !is_sure);
    }
}

fn check(units: &[u16]) {
    let expected = quoted(units);
    each_width(units, |text| {
        check_attempts::<u8>(text, &expected);
        check_attempts::<u16>(text, &expected);
        let mut builder = StringBuilder::new();
        builder.push_json_quoted(text);
        assert_eq!(units_of(builder.text()), expected);
        for first in [0x61, 0x100] {
            StringBuilder::on_stack::<512, _>(|builder| {
                builder.push_unit(first);
                builder.push_json_quoted(text);
                assert_eq!(units_of(builder.text().slice_from(1)), expected);
                assert!(builder.is_latin1() || first > 0xff || !text.fits_latin1());
                builder.truncate(1);
                builder.push_json_key(b',', text);
                let key = units_of(builder.text().slice_from(1));
                assert_eq!(key, [&[0x2c], &expected[..], &[0x3a]].concat());
            });
        }
    });
}

#[test]
fn every_unit_below_0x180() {
    for unit in 0..0x180 {
        for length in [1, 5, 16, 70] {
            check(&vec![unit; length]);
        }
    }
}

#[test]
fn one_special_character_anywhere() {
    let specials: [&[u16]; 8] = [
        &[0x22],
        &[0x0a],
        &[0x1f],
        &[0x10a],
        &[0xd800],
        &[0xdfff],
        &[0xdbff, 0xdc00],
        &[0xdc00, 0xd800],
    ];
    for length in lengths().into_iter().filter(|&length| length < 300) {
        check(&vec![0x61; length]);
        for (turn, at) in indices(length).enumerate() {
            let mut units = vec![0x61; length];
            units.splice(at..=at, specials[(turn + length) % 8].iter().copied());
            check(&units);
        }
    }
}

#[test]
fn many_special_characters() {
    let alphabets: [&[u16]; 4] = [
        &[0x22, 0x5c, 0x61, 0x0a, 0x09],
        &[0x22, 0x61, 0x62, 0x63, 0x64, 0x01, 0xff],
        &[0x22, 0x4e00, 0x0d, 0x225c],
        &[0x22, 0x61, 0xd83d, 0xde00, 0xde01],
    ];
    let mut random = Random::new();
    for length in lengths() {
        for alphabet in alphabets {
            check(&random.units(length, alphabet));
        }
    }
}
