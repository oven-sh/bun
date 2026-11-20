use bstr::BStr;
use bun_sema::atom::{Atom, Interner};
use bun_sema::hir_from_data::DataValue;
use bun_sema::session::Session;

use super::*;
use crate::load::data_modules::parse_json;

const SHARED_VECTORS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../test/aot/builtins/name-classes.json"
));

#[track_caller]
fn assert_class(expected: NameClass, texts: &[&str]) {
    for text in texts {
        assert_eq!(classify_name(text.as_bytes()), expected, "{text:?}");
    }
}

fn column_words() -> impl Iterator<Item = (NameClass, &'static str)> {
    NameClass::ALL.into_iter().flat_map(|class| {
        let words = class.words().split_ascii_whitespace();
        words.map(move |word| (class, word))
    })
}

fn text_and_class(vector: &DataValue<'_>) -> [Atom; 2] {
    match *vector {
        DataValue::Object(&[(_, DataValue::String(text)), (_, DataValue::String(class))]) => {
            [text, class]
        }
        _ => panic!("expected an object of two strings, found {vector:?}"),
    }
}

#[test]
fn array_indexes() {
    assert_class(NameClass::Index, &["0", "7", "10", "4294967294"]);
}

#[test]
fn canonical_numeric_strings() {
    let texts = [
        "4294967295",
        "999999999999999",
        "1000000000000000",
        "9007199254740992",
        "-1",
        "1.5",
        "1e+21",
        "-0",
        "NaN",
        "Infinity",
        "-Infinity",
    ];
    assert_class(NameClass::CanonicalNumericString, &texts);
}

#[test]
fn noncanonical_numeric_texts_are_ordinary() {
    let texts = [
        "",
        "00",
        "01",
        "1.0",
        "+1",
        "1e3",
        "1e21",
        ".5",
        "-",
        "-00",
        "-NaN",
        "inf",
        "-inf",
        "Infinit",
        "9007199254740993",
        "1234567890123456789012345678901234567890",
    ];
    assert_class(NameClass::Ordinary, &texts);
}

#[test]
fn invalid_utf8_is_ordinary() {
    assert_eq!(classify_name(b"1\xff"), NameClass::Ordinary);
    assert_eq!(classify_name(b"-\xff"), NameClass::Ordinary);
    assert_eq!(classify_name(b"\xff"), NameClass::Ordinary);
}

#[test]
fn every_word_of_column_has_its_class() {
    let mut word_count = 0;
    for (class, word) in column_words() {
        assert_eq!(classify_name(word.as_bytes()), class, "{word}");
        word_count += 1;
    }
    assert_eq!(word_count, CLASSIFIED_WORD_COUNT);
    assert!(word_count > 0);
}

#[test]
fn word_with_other_case_or_suffix_is_ordinary() {
    let texts = ["Length", "lengths", "then ", " then", "toJson", "NaNs"];
    assert_class(NameClass::Ordinary, &texts);
    for (_, word) in column_words() {
        assert_class(NameClass::Ordinary, &[&format!("{word}s"), &word[1..]]);
    }
}

#[test]
fn longest_word_is_within_limit() {
    let longest = column_words().max_by_key(|(_, word)| word.len());
    let (class, longest) = longest.expect("the column has words");
    assert_eq!(longest.len(), MAX_WORD_LENGTH);
    assert_eq!(classify_word(longest.as_bytes()), class);
    assert_eq!(
        classify_word(&[b'a'; MAX_WORD_LENGTH + 1]),
        NameClass::Ordinary
    );
}

#[test]
fn words_are_split_at_runs_of_spaces() {
    assert_eq!(split_first_word(b""), None);
    assert_eq!(split_first_word(b"  "), None);
    assert_eq!(split_first_word(b"then"), Some((&b"then"[..], &b""[..])));
    assert_eq!(
        split_first_word(b"call apply"),
        Some((&b"call"[..], &b" apply"[..]))
    );
    assert_eq!(
        split_first_word(b"  bind  "),
        Some((&b"bind"[..], &b"  "[..]))
    );
}

#[test]
fn exact_integers_have_at_most_15_digits() {
    assert_eq!(parse_exact_integer(b"1"), Some(1));
    assert_eq!(parse_exact_integer(b"4294967295"), Some(4_294_967_295));
    assert_eq!(
        parse_exact_integer(b"999999999999999"),
        Some(999_999_999_999_999)
    );
    assert_eq!(parse_exact_integer(b"1000000000000000"), None);
    assert_eq!(parse_exact_integer(b"01"), None);
    assert_eq!(parse_exact_integer(b"-1"), None);
    assert_eq!(parse_exact_integer(b"1.5"), None);
}

#[test]
fn shared_vectors() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let vectors = parse_json(SHARED_VECTORS, session.arena(), &atoms);
    let Some(&DataValue::Array(vectors)) = vectors else {
        panic!("the shared vectors are a JSON array");
    };
    assert!(!vectors.is_empty());
    for vector in vectors {
        let [text, class] = text_and_class(vector).map(|atom| atoms.bytes(atom));
        let class = core::str::from_utf8(class)
            .ok()
            .and_then(NameClass::from_name);
        assert_eq!(Some(classify_name(text)), class, "{}", BStr::new(text));
    }
}
