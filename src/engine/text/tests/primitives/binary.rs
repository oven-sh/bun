use bun_engine_text::Base64Alphabet::{self, Standard, Url};
use bun_engine_text::LastChunkHandling::{self, Loose, StopBeforePartial, Strict};
use bun_engine_text::{Cursor, Progress, StringRef, Text};

use crate::support::*;

/// `read`, or `None` for an error, and the bytes: FromBase64 of ECMA-262 over the characters that are no white space.
fn from_base64(
    units: &[u16],
    alphabet: Base64Alphabet,
    last: LastChunkHandling,
    most: usize,
) -> (Option<usize>, Vec<u8>) {
    let ends = if alphabet == Url { "-_" } else { "+/" };
    let digits: Vec<char> = ('A'..='Z')
        .chain('a'..='z')
        .chain('0'..='9')
        .chain(ends.chars())
        .collect();
    let mut rest = (units.iter().enumerate()).filter(|it| ![9, 10, 12, 13, 32].contains(it.1));
    let (mut read, mut bytes, mut chunk) = (0, Vec::new(), Vec::new());
    let decoded = |chunk: &[u32]| {
        let bits = (0..4).fold(0, |bits, at| bits << 6 | chunk.get(at).unwrap_or(&0));
        bits.to_be_bytes()[1..].to_vec()
    };
    while bytes.len() < most {
        let is_padded = match rest.next() {
            None if chunk.is_empty() => return (Some(units.len()), bytes),
            None if last == StopBeforePartial => break,
            None => false,
            Some((_, 0x3d)) => true,
            Some((at, &unit)) => {
                let Some(value) = digits.iter().position(|&it| it as u16 == unit) else {
                    return (None, bytes);
                };
                if chunk.len() > most - bytes.len() {
                    break;
                }
                chunk.push(value as u32);
                if chunk.len() == 4 {
                    bytes.extend(decoded(&chunk));
                    (read, chunk) = (at + 1, Vec::new());
                }
                continue;
            }
        };
        let after: Vec<u16> = rest.map(|it| *it.1).collect();
        if is_padded && chunk.len() == 2 && after.is_empty() && last == StopBeforePartial {
            break;
        }
        let padding = if is_padded && chunk.len() == 2 {
            &[0x3d][..]
        } else {
            &[]
        };
        let has_extra = chunk.len() >= 2 && decoded(&chunk)[chunk.len() - 1] != 0;
        if chunk.len() < 2 || after != padding || (last == Strict && (!is_padded || has_extra)) {
            return (None, bytes);
        }
        bytes.extend(&decoded(&chunk)[..chunk.len() - 1]);
        return (Some(units.len()), bytes);
    }
    (Some(read), bytes)
}

fn check_base64(units: &[u16], sizes: &[usize]) {
    for (alphabet, last) in [
        (Standard, Loose),
        (Url, Strict),
        (Standard, StopBeforePartial),
    ] {
        each_width(units, |text| {
            let (read, bytes) = from_base64(units, alphabet, last, usize::MAX);
            let (mut result, mut decoded) = (Ok(()), Vec::new());
            Cursor::extend_vec(&mut decoded, text.base64_decoded_capacity(), |to| {
                result = text.decode_base64(alphabet, last, to);
            })
            .unwrap();
            assert_eq!(
                (result.is_ok(), decoded),
                (read.is_some(), bytes),
                "{text:?}"
            );
            for &size in sizes {
                let (read, mut bytes) = from_base64(units, alphabet, last, size);
                let written = bytes.len();
                bytes.resize(size, 0xee);
                let mut target = vec![0xee; size];
                let result = text.decode_base64_into(alphabet, last, &mut target).ok();
                assert_eq!(
                    result,
                    read.map(|read| Progress { read, written }),
                    "{text:?} {size}"
                );
                assert_eq!(target, bytes, "{text:?} {size}");
            }
        });
    }
}

#[test]
fn every_short_base64_text() {
    let alphabet = wide("Ag= !");
    for length in 0..if cfg!(miri) { 4 } else { 8 } {
        for index in 0..5usize.pow(length) {
            let units: Vec<u16> = (0..length)
                .map(|at| alphabet[index / 5usize.pow(at) % 5])
                .collect();
            check_base64(&units, &[0, 1, 2, 3, 4]);
        }
    }
}

#[test]
fn base64_texts_of_any_length() {
    let mut random = Random::new();
    for length in lengths()
        .into_iter()
        .chain([if cfg!(miri) { 200 } else { 9000 }])
    {
        for (alphabet, end) in [
            ("AZaz09", ""),
            ("AZaz09\n", "=="),
            ("A  ", "= "),
            ("Qg", "="),
        ] {
            let mut units = random.units(length, &wide(alphabet));
            units.extend(wide(end));
            let sizes = [length / 3, length / 4 * 3, length];
            check_base64(&units, &sizes);
            let at = random.below(units.len() + 1);
            units.insert(at, random.pick(&wide("+_=!\u{141}\u{120}")));
            check_base64(&units, &sizes);
        }
    }
}

#[test]
fn base64_of_bytes() {
    for (bytes, padded) in [
        ("", ""),
        ("f", "Zg=="),
        ("fo", "Zm8="),
        ("foo", "Zm9v"),
        ("foob", "Zm9vYg=="),
    ] {
        let of = |omits| StringRef::try_base64_of(bytes.as_bytes(), Standard, omits).unwrap();
        assert!(of(false).text().eq_ascii(padded));
        assert!(of(true).text().eq_ascii(padded.trim_end_matches('=')));
    }
    for length in lengths() {
        let bytes: Vec<u8> = (0..length).map(|at| (at * 251 + at / 3) as u8).collect();
        for (alphabet, omits, last) in [
            (Standard, false, Strict),
            (Url, false, Strict),
            (Url, true, Loose),
        ] {
            let text = units_of(
                StringRef::try_base64_of(&bytes, alphabet, omits)
                    .unwrap()
                    .text(),
            );
            assert_eq!(
                from_base64(&text, alphabet, last, usize::MAX),
                (Some(text.len()), bytes.clone())
            );
            assert!(!omits || !text.contains(&0x3d));
        }
    }
}

#[test]
fn hex() {
    for length in lengths()
        .into_iter()
        .chain([if cfg!(miri) { 200 } else { 5000 }])
    {
        let bytes: Vec<u8> = (0..length).map(|at| (at * 37) as u8).collect();
        let lower: Vec<u16> = bytes
            .iter()
            .flat_map(|it| wide(&format!("{it:02x}")))
            .collect();
        let upper: Vec<u16> = bytes
            .iter()
            .flat_map(|it| wide(&format!("{it:02X}")))
            .collect();
        assert_eq!(
            units_of(StringRef::try_hex_of(&bytes).unwrap().text()),
            lower
        );
        for (units, size) in [(&lower, length), (&upper, length / 2), (&upper, length + 3)] {
            each_width(units, |text| {
                let mut target = vec![0xee; size];
                let written = size.min(length);
                let read = 2 * written;
                assert_eq!(
                    text.decode_hex_into(&mut target),
                    Ok(Progress { read, written })
                );
                assert_eq!(target[..written], bytes[..written]);
                assert!(target[written..].iter().all(|&byte| byte > 0xed));
            });
        }
        for (turn, at) in indices(2 * length).step_by(5).enumerate() {
            let mut units = lower.clone();
            units[at] = wide("/:@G`g\u{b0}\u{130}\u{10}")[turn % 9];
            each_width(&units, |text| {
                let mut target = vec![0xee; length];
                assert!(text.decode_hex_into(&mut target).is_err());
                assert_eq!(target[..at / 2], bytes[..at / 2]);
                assert!(target[at / 2..].iter().all(|&byte| byte > 0xed));
                let written = Cursor::fill(&mut target, |to| assert!(text.decode_hex(to).is_err()));
                assert_eq!(written, at / 2);
            });
        }
    }
    let mut target = [0xee];
    assert!(
        Text::from_ascii("abc")
            .decode_hex_into(&mut target)
            .is_err()
            && target == [0xee]
    );
}
