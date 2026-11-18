use std::fmt::Write;

use bun_engine_text::{Cursor, MAX_LENGTH, StringBuilder, StringRef, Text};

use crate::support::*;

/// Does the same to the builder and to a vector.
fn run(builder: &mut StringBuilder, random: &mut Random, steps: usize) -> Vec<u16> {
    let mut expected: Vec<u16> = Vec::new();
    let turns_wide = random.below(2 * steps + 1);
    for step in 0..steps {
        let alphabet: &[u16] = if step < turns_wide {
            &[0x61, 0xff]
        } else {
            &[0x62, 0x100]
        };
        let length = random.below(40);
        let units = random.units(length, alphabet);
        let narrow: Vec<u8> = units.iter().map(|&unit| unit as u8).collect();
        match random.below(9) {
            0 => {
                builder.push_latin1(0xe9);
                expected.push(0xe9);
            }
            1 => {
                let unit = random.pick(alphabet);
                builder.push_unit(unit);
                expected.push(unit);
            }
            2 => {
                builder.push_latin1_slice(&narrow);
                expected.extend(narrow.iter().map(|&it| u16::from(it)));
            }
            3 => {
                builder.push_utf16(&units);
                expected.extend(&units);
            }
            4 => {
                builder.push_repeated(b'-', length);
                expected.extend(std::iter::repeat_n(0x2d, length));
            }
            5 => {
                builder.write_latin1(length + step % 3, |cursor| cursor.push_slice(&narrow));
                expected.extend(narrow.iter().map(|&it| u16::from(it)));
            }
            6 => {
                let start = random.below(expected.len() + 1);
                let range = start..expected.len().min(start + length);
                builder.push_from_within(range.clone());
                expected.extend_from_within(range);
            }
            7 => {
                builder.truncate(expected.len().saturating_sub(step % 5));
                expected.truncate(expected.len().saturating_sub(step % 5));
            }
            _ => builder.reserve(length),
        }
        assert_eq!(builder.len(), expected.len());
    }
    assert!(builder.text() == Text::Utf16(&expected));
    expected
}

#[test]
fn any_sequence_of_pushes() {
    let mut random = Random::new();
    for round in 0..if cfg!(miri) { 30 } else { 3000 } {
        let mut builder = StringBuilder::new();
        let expected = run(&mut builder, &mut random, round % 30);
        assert_eq!(units_of(builder.finish().unwrap().text()), expected);
        StringBuilder::on_stack::<128, _>(|builder| {
            for _ in 0..2 {
                let expected = run(builder, &mut random, round % 30);
                assert_eq!(units_of(builder.take().unwrap().text()), expected);
                assert!(builder.is_empty() && builder.is_latin1());
            }
        });
    }
}

#[test]
fn stays_narrow_while_the_characters_allow_it() {
    let mut builder = StringBuilder::new();
    builder.push_utf16(&[0x61, 0xff]);
    builder.push_code_point(0xe9);
    write!(builder, "{}é", 12).unwrap();
    assert!(builder.is_latin1());
    builder.push_code_point(0x10ffff);
    assert_eq!(units_of(builder.text()), wide("aÿé12é\u{10ffff}"));
}

#[test]
fn takes_nothing_after_an_overflow() {
    StringBuilder::on_stack::<16, _>(|builder| {
        builder.push_ascii("abc");
        builder.write_latin1(MAX_LENGTH, |_| unreachable!());
        assert!(builder.has_overflowed());
        builder.push_latin1(b'a');
        builder.push_unit(0x100);
        builder.push_from_within(0..2);
        builder.push_json_quoted(Text::from_ascii("\n"));
        builder.push_utf8_lossy("é€".as_bytes());
        builder.write_utf16(usize::MAX, |_| unreachable!());
        assert!(builder.is_empty() && builder.take().is_err());
        builder.push_ascii("again");
        assert!(builder.take().unwrap().text().eq_ascii("again"));
    });
}

#[test]
fn a_cursor_reports_what_it_has_written() {
    let mut target = [0xffu8; 12];
    let written = Cursor::fill(&mut target, |cursor| {
        cursor.push(b'a');
        cursor.push_prefix(b"bcde", 2);
        cursor.push_text(Text::Utf16(&[0x178]));
        cursor.push_pattern(Text::from_ascii("123"), 7);
        assert_eq!(cursor.remaining(), 1);
    });
    assert_eq!((written, &target), (11, b"abcx1231231\xff"));

    let mut vector = vec![1u16];
    Cursor::extend_vec(&mut vector, 5, |cursor| cursor.push_code_point(0x1f600)).unwrap();
    assert_eq!(vector, [1, 0xd83d, 0xde00]);

    for (capacity, length) in [(0, 0), (5, 0), (5, 5), (100, 99), (100, 3)] {
        let string = StringRef::try_write(capacity, |it| it.push_repeated(7u16, length)).unwrap();
        assert_eq!(units_of(string.text()), vec![7; length]);
    }
    assert!(StringRef::try_write::<u8>(MAX_LENGTH + 1, |_| unreachable!()).is_err());
}

#[test]
#[should_panic]
fn a_cursor_takes_no_more_than_fits() {
    Cursor::fill(&mut [0u8; 3], |cursor| cursor.push_slice(b"abcd"));
}
