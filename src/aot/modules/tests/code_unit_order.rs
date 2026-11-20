use crate::modules::compare_code_units;
use core::cmp::Ordering;

const GRINNING_FACE: &[u8] = "\u{1F600}".as_bytes();
const LEAD_SURROGATE_OF_GRINNING_FACE: &[u8] = b"\xED\xA0\xBD";
const FIRST_TRAIL_SURROGATE: &[u8] = b"\xED\xB0\x80";

fn assert_order(a: &[u8], b: &[u8], expected: Ordering) {
    assert_eq!(compare_code_units(a, b), expected, "{a:?} {b:?}");
    assert_eq!(compare_code_units(b, a), expected.reverse(), "{b:?} {a:?}");
}

#[test]
fn ascii_orders_by_byte() {
    assert_order(b"a", b"b", Ordering::Less);
    assert_order(b"Z", b"a", Ordering::Less);
    assert_order(b"ab", b"ac", Ordering::Less);
    assert_order(b"$", b"_", Ordering::Less);
}

#[test]
fn prefix_orders_first() {
    assert_order(b"", b"a", Ordering::Less);
    assert_order(b"a", b"ab", Ordering::Less);
    assert_order("\u{E9}".as_bytes(), "\u{E9}a".as_bytes(), Ordering::Less);
    assert_order(
        GRINNING_FACE,
        &[GRINNING_FACE, b"a"].concat(),
        Ordering::Less,
    );
}

#[test]
fn equal_texts_are_equal() {
    let texts: [&[u8]; 5] = [
        b"",
        b"ab",
        "\u{FF5E}".as_bytes(),
        GRINNING_FACE,
        FIRST_TRAIL_SURROGATE,
    ];
    for text in texts {
        assert_order(text, text, Ordering::Equal);
    }
}

#[test]
fn supplementary_character_orders_before_end_of_basic_plane() {
    for character in ["\u{E000}", "\u{FF5E}", "\u{FFFF}"] {
        assert!(character.as_bytes() < GRINNING_FACE, "{character:?}");
        assert_order(character.as_bytes(), GRINNING_FACE, Ordering::Greater);
    }
    assert_order("\u{D7FF}".as_bytes(), GRINNING_FACE, Ordering::Less);
}

#[test]
fn supplementary_characters_order_by_code_point() {
    assert_order(
        "\u{10000}".as_bytes(),
        "\u{10001}".as_bytes(),
        Ordering::Less,
    );
    assert_order(
        "\u{103FF}".as_bytes(),
        "\u{10400}".as_bytes(),
        Ordering::Less,
    );
    assert_order(GRINNING_FACE, "\u{10FFFF}".as_bytes(), Ordering::Less);
}

#[test]
fn lone_surrogates_order_as_code_units() {
    assert_order(
        LEAD_SURROGATE_OF_GRINNING_FACE,
        GRINNING_FACE,
        Ordering::Less,
    );
    assert_order(FIRST_TRAIL_SURROGATE, GRINNING_FACE, Ordering::Greater);
    assert_order(
        LEAD_SURROGATE_OF_GRINNING_FACE,
        FIRST_TRAIL_SURROGATE,
        Ordering::Less,
    );
    assert_order(FIRST_TRAIL_SURROGATE, "\u{E000}".as_bytes(), Ordering::Less);
    assert_order(
        "\u{D7FF}".as_bytes(),
        LEAD_SURROGATE_OF_GRINNING_FACE,
        Ordering::Less,
    );
}

#[test]
fn order_matches_utf16_encoding() {
    let characters = "a\u{80}\u{7FF}\u{CFFF}\u{D000}\u{D7FF}\u{E000}\u{FFFF}\u{10000}\u{10FFFF}";
    let texts: Vec<String> = characters
        .chars()
        .map(|character| format!("a{character}b"))
        .collect();
    for a in &texts {
        for b in &texts {
            let expected = a.encode_utf16().cmp(b.encode_utf16());
            let order = compare_code_units(a.as_bytes(), b.as_bytes());
            assert_eq!(order, expected, "{a:?} {b:?}");
        }
    }
}
