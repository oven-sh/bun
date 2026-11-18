use core::io::BorrowedBuf;

use bun_engine_text::{
    Cursor, Progress, StringBuilder, StringRef, append_utf8_lossy, append_valid_utf8,
    decode_valid_utf8, unfinished_utf8_len,
};

use crate::support::*;

fn decoded(bytes: &[u8]) -> Vec<u16> {
    let mut units = Vec::new();
    for chunk in bytes.utf8_chunks() {
        units.extend(chunk.valid().encode_utf16());
        units.extend((!chunk.invalid().is_empty()).then_some(0xfffd));
    }
    units
}

fn check_decoding(bytes: &[u8]) {
    let expected = decoded(bytes);
    let lossy = StringRef::try_from_utf8_lossy(bytes).unwrap();
    assert_eq!(units_of(lossy.text()), expected, "{bytes:x?}");
    assert_eq!(lossy.is_latin1(), lossy.text().fits_latin1());
    let strict = StringRef::try_from_utf8(bytes).unwrap();
    assert_eq!(
        strict.is_some(),
        str::from_utf8(bytes).is_ok(),
        "{bytes:x?}"
    );
    assert!(strict.is_none_or(|it| it == lossy));
    let mut builder = StringBuilder::new();
    builder.push_unit(if bytes.len() % 2 == 0 { 0x61 } else { 0x100 });
    builder.push_utf8_lossy(bytes);
    assert!(builder.text().slice_from(1) == lossy.text());
    builder.truncate(1);
    assert_eq!(builder.push_utf8(bytes), str::from_utf8(bytes).is_ok());
    assert!(expected.starts_with(&units_of(builder.text())[1..]));
    let wide = StringRef::try_wide_from_utf8_lossy(bytes).unwrap();
    assert!(wide == lossy && wide.is_latin1() == bytes.is_ascii());

    let valid = bytes.utf8_chunks().next().map_or("", |chunk| chunk.valid());
    let expected: Vec<u16> = valid.encode_utf16().collect();
    let mut appended = vec![7];
    assert_eq!(
        append_valid_utf8(bytes, &mut appended, 1).unwrap(),
        valid.len()
    );
    assert!(appended[1..] == expected && appended.capacity() > appended.len());
    append_utf8_lossy(&bytes[valid.len()..], &mut appended, 1).unwrap();
    assert!(appended[1..] == decoded(bytes) && appended.capacity() > appended.len());
    let last = bytes
        .utf8_chunks()
        .last()
        .map_or(&[][..], |it| it.invalid());
    let is_unfinished = str::from_utf8(last).is_err_and(|it| it.error_len().is_none());
    let unfinished = if is_unfinished { last.len() } else { 0 };
    assert_eq!(unfinished_utf8_len(bytes), unfinished);
    for room in [expected.len() / 2, expected.len(), expected.len() + 80] {
        let (mut target, mut read) = (vec![0xfffe; room], 0);
        let written = Cursor::fill(&mut target, |it| read = it.push_valid_utf8(bytes));
        assert_eq!(target[..written], decoded(&bytes[..read]));
        let next = valid[read..].chars().next();
        assert!(next.is_none_or(|it| written + it.len_utf16() > room));

        target.fill(0xfffe);
        let mut buffer = BorrowedBuf::from(&mut target[..]);
        let read = decode_valid_utf8(bytes, buffer.unfilled());
        let written = buffer.len();
        assert!(read == valid.len() || (read < valid.len() && room < expected.len()));
        assert_eq!(target[..written], decoded(&bytes[..read]));
        assert!(target[written..].iter().all(|&unit| unit == 0xfffe));
    }
}

fn characters(units: &[u16]) -> impl Iterator<Item = (char, usize)> {
    char::decode_utf16(units.iter().copied())
        .map(|it| it.map_or(('\u{fffd}', 1), |it| (it, it.len_utf16())))
}

fn check_encoding(units: &[u16], rooms: &[usize]) {
    let expected: String = characters(units).map(|it| it.0).collect();
    let is_well_formed = char::decode_utf16(units.iter().copied()).all(|it| it.is_ok());
    each_width(units, |text| {
        assert_eq!(text.utf8_len(), expected.len());
        assert_eq!(text.try_to_utf8().unwrap(), expected.as_bytes());
        assert_eq!(text.is_well_formed(), is_well_formed);
        let repaired = text.to_well_formed().unwrap();
        assert_eq!(repaired.is_none(), is_well_formed);
        assert!(repaired.is_none_or(|it| units_of(it.text()) == wide(&expected)));
        for &room in rooms {
            let (mut read, mut written) = (0, 0);
            for (character, width) in characters(units) {
                if written + character.len_utf8() > room {
                    break;
                }
                (read, written) = (read + width, written + character.len_utf8());
            }
            let mut target = vec![0xfe; room];
            assert_eq!(
                text.encode_utf8_into(&mut target),
                Progress { read, written }
            );
            assert_eq!(target[..written], expected.as_bytes()[..written]);
            assert!(target[written..].iter().all(|&byte| byte > 0xfd));
        }
    });
}

#[test]
fn every_class_of_sequence() {
    let classes: &[u8] = if cfg!(miri) {
        &[0x41, 0x80, 0xc2, 0xed, 0xf4]
    } else {
        &[
            0x00, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xdf,
            0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf3, 0xf4, 0xf5, 0xff,
        ]
    };
    let count = classes.len();
    for index in 0..count.pow(4) {
        let sequence = [1, count, count.pow(2), count.pow(3)].map(|it| classes[index / it % count]);
        check_decoding(&sequence[..4 - usize::from(index < count.pow(3))]);
        if index % 61 == 0 {
            check_decoding(
                &[
                    "é".repeat(30 + index % 7).as_bytes(),
                    &sequence,
                    &[b'a'; 70],
                ]
                .concat(),
            );
        }
    }
}

#[test]
fn sequences_between_texts_of_other_lengths_of_sequence() {
    let (classes, marks) = (
        [0x41, 0x80, 0xa0, 0xc1, 0xc3, 0xe0, 0xed, 0xf0, 0xf4, 0xf8],
        ["a", "é", "漢", "😀"],
    );
    let step = if cfg!(miri) { 997 } else { 1 };
    for index in (0..1000 * 64).step_by(step) {
        let [a, b, c] = [1, 4, 16].map(|it| marks[index / it % 4].as_bytes());
        let mut bytes = [b'x'; 200];
        for (at, mark) in [(0, a), (64, b), (140, c)] {
            bytes[at..][..mark.len()].copy_from_slice(mark);
        }
        let sequence = [64, 640, 6400].map(|it| classes[index / it % 10]);
        for at in [126, 127] {
            let mut bytes = bytes;
            bytes[at..][..3].copy_from_slice(&sequence);
            let strict = StringRef::try_from_utf8(&bytes).unwrap();
            let expected = str::from_utf8(&bytes).ok().map(wide);
            assert_eq!(strict.map(|it| units_of(it.text())), expected, "{bytes:x?}");
        }
    }
}

#[test]
fn long_texts_in_several_scripts() {
    let mut random = Random::new();
    let scripts =
        ["ab", "aé", "éÿ", "яa", "漢字", "a😀", "aé漢😀"].map(|it| it.chars().collect::<Vec<_>>());
    let long: &[usize] = if cfg!(miri) {
        &[700]
    } else {
        &[1500, 2500, 4000, 20_000]
    };
    for &length in lengths().iter().chain(long) {
        for script in &scripts {
            let text: String = (0..length).map(|_| random.pick(script)).collect();
            check_decoding(text.as_bytes());
            let rooms = [
                0,
                text.len() / 2,
                text.len().saturating_sub(1),
                text.len(),
                3 * text.len(),
            ];
            check_encoding(&wide(&text), &rooms);

            let mut bytes = text.clone().into_bytes();
            let mut units = wide(&text);
            for _ in 0..[1, length / 40, length][length % 3].min(length) {
                let at = random.below(bytes.len());
                bytes[at] = random.pick(&[0x80, 0xc3, 0xe2, 0xf0, 0xff]);
                let at = random.below(units.len());
                units[at] = random.pick(&[0xd800, 0xdbff, 0xdc00, 0xdfff]);
            }
            check_decoding(&bytes);
            check_encoding(&units, &rooms);
        }
    }
}

#[test]
fn one_lone_surrogate_anywhere() {
    for length in lengths().into_iter().filter(|&length| length < 200) {
        for at in indices(length) {
            let mut units = vec![0x61; length];
            units[at] = if (at + length) % 2 == 0 {
                0xd800
            } else {
                0xdc00
            };
            check_encoding(&units, &[at + 2, at + 3]);
        }
    }
}
