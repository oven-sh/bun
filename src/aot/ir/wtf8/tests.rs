use super::*;

const HIGH_SURROGATE: &[u8] = b"\xED\xA0\xBD";
const LOW_SURROGATE: &[u8] = b"\xED\xB8\x80";
const SURROGATE_PAIR: &[u8] = b"\xED\xA0\xBD\xED\xB8\x80";
const JOINED_PAIR: &[u8] = "\u{1F600}".as_bytes();
const JOINED_CODE_POINT: u32 = 0x1F600;

#[track_caller]
fn assert_joined(written: &[u8], expected: &[u8]) {
    let joined = join_surrogate_pairs(written).expect("the text has a surrogate pair");
    assert_eq!(joined.as_slice(), expected, "{written:x?}");
}

#[track_caller]
fn assert_nothing_to_join(written: &[u8]) {
    assert!(join_surrogate_pairs(written).is_none(), "{written:x?}");
}

#[test]
fn first_and_last_supplementary_code_points_join() {
    assert_joined(b"\xED\xA0\x80\xED\xB0\x80", "\u{10000}".as_bytes());
    assert_joined(b"\xED\xAF\xBF\xED\xBF\xBF", "\u{10FFFF}".as_bytes());
}

#[test]
fn every_pair_in_text_joins() {
    let parts: [&[u8]; 6] = [
        b"a",
        SURROGATE_PAIR,
        "\u{D55C}".as_bytes(),
        SURROGATE_PAIR,
        SURROGATE_PAIR,
        b"z",
    ];
    let expected = "a\u{1F600}\u{D55C}\u{1F600}\u{1F600}z";
    assert_joined(&parts.concat(), expected.as_bytes());
}

#[test]
fn pair_joins_in_text_longer_than_inline_capacity() {
    let padding: &[u8] = &[b'p'; 100];
    let written = [padding, SURROGATE_PAIR, padding].concat();
    let expected = [padding, JOINED_PAIR, padding].concat();
    assert_joined(&written, &expected);
}

#[test]
fn unpaired_surrogates_stay_three_bytes() {
    assert_nothing_to_join(HIGH_SURROGATE);
    assert_nothing_to_join(LOW_SURROGATE);
    assert_nothing_to_join(&[LOW_SURROGATE, HIGH_SURROGATE].concat());
    assert_nothing_to_join(&[HIGH_SURROGATE, HIGH_SURROGATE].concat());
    assert_nothing_to_join(&[LOW_SURROGATE, LOW_SURROGATE].concat());
    assert_nothing_to_join(&[HIGH_SURROGATE, b"-", LOW_SURROGATE].concat());
}

#[test]
fn only_adjacent_halves_join() {
    let high_then_pair = [HIGH_SURROGATE, SURROGATE_PAIR].concat();
    assert_joined(&high_then_pair, &[HIGH_SURROGATE, JOINED_PAIR].concat());
    let pair_then_low = [SURROGATE_PAIR, LOW_SURROGATE].concat();
    assert_joined(&pair_then_low, &[JOINED_PAIR, LOW_SURROGATE].concat());
}

#[test]
fn pair_joins_after_stray_lead_byte() {
    let stray_lead_byte: &[u8] = b"\xED";
    let written = [stray_lead_byte, SURROGATE_PAIR].concat();
    assert_joined(&written, &[stray_lead_byte, JOINED_PAIR].concat());
}

#[test]
fn truncated_low_surrogate_does_not_join() {
    assert_nothing_to_join(b"\xED\xA0\xBD\xED\xB8");
    assert_nothing_to_join(b"\xED\xA0\xBD\xED\xB8A");
    assert_nothing_to_join(b"\xED\xA0A\xED\xB8\x80");
}

#[test]
fn text_without_surrogates_allocates_nothing() {
    assert_nothing_to_join(b"");
    assert_nothing_to_join(b"plain");
    assert_nothing_to_join("\u{E9}\u{20AC}\u{1F600}".as_bytes());
    assert_nothing_to_join("\u{D55C}\u{D55C}".as_bytes());
}

#[test]
fn joined_text_is_canonical() {
    let halves = [HIGH_SURROGATE, LOW_SURROGATE];
    for first in halves {
        for second in halves {
            for third in halves {
                let written = [first, second, third].concat();
                match join_surrogate_pairs(&written) {
                    Some(joined) => {
                        assert!(!is_canonical_wtf8(&written), "{written:x?}");
                        assert!(is_canonical_wtf8(&joined), "{written:x?}");
                    }
                    None => assert!(is_canonical_wtf8(&written), "{written:x?}"),
                }
            }
        }
    }
}

#[test]
fn search_for_pair_starts_at_offset() {
    let parts: [&[u8]; 5] = [b"a", HIGH_SURROGATE, b"b", SURROGATE_PAIR, SURROGATE_PAIR];
    let text = parts.concat();
    assert_eq!(find_surrogate_pair(&text, 0), Some((5, JOINED_CODE_POINT)));
    assert_eq!(find_surrogate_pair(&text, 5), Some((5, JOINED_CODE_POINT)));
    assert_eq!(find_surrogate_pair(&text, 6), Some((11, JOINED_CODE_POINT)));
    assert_eq!(find_surrogate_pair(&text, 12), None);
    assert_eq!(find_surrogate_pair(&text, text.len()), None);
}

#[test]
fn pair_decodes_only_from_high_then_low() {
    assert_eq!(
        decode_surrogate_pair(SURROGATE_PAIR),
        Some(JOINED_CODE_POINT)
    );
    assert_eq!(decode_surrogate_pair(HIGH_SURROGATE), None);
    assert_eq!(
        decode_surrogate_pair(&[LOW_SURROGATE, HIGH_SURROGATE].concat()),
        None
    );
    assert_eq!(
        decode_surrogate_pair(&[HIGH_SURROGATE, b"a"].concat()),
        None
    );
    assert_eq!(
        decode_surrogate_pair(&[JOINED_PAIR, LOW_SURROGATE].concat()),
        None
    );
    assert_eq!(decode_surrogate_pair(b""), None);
}

#[test]
fn code_point_decodes_with_length() {
    let decoded: [(&[u8], (u32, usize)); 10] = [
        (b"\x00", (0, 1)),
        (b"a", (0x61, 1)),
        (b"\x7Fz", (0x7F, 1)),
        ("\u{80}".as_bytes(), (0x80, 2)),
        ("\u{7FF}".as_bytes(), (0x7FF, 2)),
        ("\u{800}".as_bytes(), (0x800, 3)),
        ("\u{FFFD}".as_bytes(), (0xFFFD, 3)),
        ("\u{FFFF}".as_bytes(), (0xFFFF, 3)),
        ("\u{10000}".as_bytes(), (0x10000, 4)),
        ("\u{10FFFF}rest".as_bytes(), (0x10FFFF, 4)),
    ];
    for (bytes, expected) in decoded {
        assert_eq!(decode_wtf8_code_point(bytes), Some(expected), "{bytes:x?}");
    }
}

#[test]
fn surrogates_decode_as_three_bytes() {
    let decoded: [(&[u8], u32); 6] = [
        (b"\xED\xA0\x80", 0xD800),
        (HIGH_SURROGATE, 0xD83D),
        (b"\xED\xAF\xBF", 0xDBFF),
        (b"\xED\xB0\x80", 0xDC00),
        (LOW_SURROGATE, 0xDE00),
        (b"\xED\xBF\xBF", 0xDFFF),
    ];
    for (bytes, code_point) in decoded {
        assert_eq!(
            decode_wtf8_code_point(bytes),
            Some((code_point, 3)),
            "{bytes:x?}"
        );
    }
    assert_eq!(decode_wtf8_code_point(SURROGATE_PAIR), Some((0xD83D, 3)));
}

#[test]
fn ill_formed_sequences_do_not_decode() {
    let ill_formed: &[&[u8]] = &[
        b"",
        b"\x80",
        b"\xBFa",
        b"\xC0\x80",
        b"\xC1\xBF",
        b"\xE0\x80\x80",
        b"\xE0\x9F\xBF",
        b"\xF0\x80\x80\x80",
        b"\xF0\x8F\xBF\xBF",
        b"\xC3",
        b"\xE2\x82",
        b"\xED\xA0",
        b"\xF0\x9F\x98",
        b"\xC3A",
        b"\xE2\x82A",
        b"\xF0\x9F\x98A",
        b"\xF4\x90\x80\x80",
        b"\xF5\x80\x80\x80",
        b"\xF8\x88\x80\x80\x80",
        b"\xFF",
    ];
    for bytes in ill_formed {
        assert_eq!(decode_wtf8_code_point(bytes), None, "{bytes:x?}");
    }
}

#[test]
fn canonical_wtf8_is_accepted() {
    let long_text = ["a".repeat(40).as_bytes(), "\u{E9}".as_bytes()].concat();
    let canonical: &[&[u8]] = &[
        b"",
        b"ascii",
        b"\x00\x7F",
        &[b'a'; 40],
        &long_text,
        "\u{E9}".as_bytes(),
        "\u{80}\u{7FF}".as_bytes(),
        "\u{800}\u{D7FF}\u{E000}\u{FFFF}".as_bytes(),
        "\u{FFFD}".as_bytes(),
        "\u{10000}\u{1F600}\u{10FFFF}".as_bytes(),
        HIGH_SURROGATE,
        LOW_SURROGATE,
        b"\xED\xA0\x80\xED\xAF\xBF",
        b"\xED\xB0\x80\xED\xBF\xBF",
        b"\xED\xB8\x80\xED\xA0\xBD",
        b"\xED\xA0\xBD-\xED\xB8\x80",
        b"\xF0\x9F\x98\x80\xED\xB8\x80",
    ];
    for bytes in canonical {
        assert!(is_canonical_wtf8(bytes), "{bytes:x?}");
    }
}

#[test]
fn noncanonical_bytes_are_rejected() {
    let long_text = ["a".repeat(40).as_bytes(), b"\x80"].concat();
    let noncanonical: &[&[u8]] = &[
        SURROGATE_PAIR,
        b"\xED\xA0\x80\xED\xB0\x80",
        b"\xED\xAF\xBF\xED\xBF\xBF",
        b"a\xED\xA0\xBD\xED\xB8\x80z",
        b"\xED\xA0\xBD\xED\xA0\xBD\xED\xB8\x80",
        b"\xC0\x80",
        b"\xC1\xBF",
        b"\xE0\x80\x80",
        b"\xE0\x9F\xBF",
        b"\xF0\x80\x80\x80",
        b"\xF0\x8F\xBF\xBF",
        b"\xF4\x90\x80\x80",
        b"\xF5\x80\x80\x80",
        b"\xFF",
        b"\xC3",
        b"\xE2\x82",
        b"\xED\xA0",
        b"\xF0\x9F\x98",
        b"a\xC3",
        b"\x80",
        b"\xC3A",
        &long_text,
    ];
    for bytes in noncanonical {
        assert!(!is_canonical_wtf8(bytes), "{bytes:x?}");
    }
}
