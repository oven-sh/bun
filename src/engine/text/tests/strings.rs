use bun_engine_standalone as _;
use bun_engine_text::*;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

#[test]
fn both_widths_hash_alike() {
    for length in 0..130 {
        let narrow: Vec<u8> = (0..length).map(|index| (index * 7 + 33) as u8).collect();
        let wide: Vec<u16> = narrow.iter().map(|&unit| u16::from(unit)).collect();
        assert_eq!(hash_latin1(&narrow), hash_utf16(&wide));
    }
}

#[test]
fn atoms_are_unique() {
    assert!(Atom::new(Text::from_ascii("length")) == names::length);
    assert!(Atom::new(Text::Utf16(&wide("prototype"))) == names::prototype);
    let string = StringRef::from_latin1(b"not in the list");
    let atom = Atom::from_string(&string);
    assert!(atom.string().ptr_eq(&string));
    assert_eq!(atom, Atom::new(Text::Utf16(&wide("not in the list"))));
    drop((string, atom));
    assert!(Atom::find(Text::from_ascii("not in the list")).is_none());
}

#[test]
fn the_table_grows_and_shrinks() {
    let atoms: Vec<Identifier> = (0..100_000).map(Identifier::from_index).collect();
    for (index, atom) in atoms.iter().enumerate() {
        assert_eq!(atom.name().as_index(), Some(index as u32));
        assert_eq!(*atom, Identifier::from_index(index as u32));
    }
    drop(atoms);
    assert!(Atom::find(Text::from_ascii("99999")).is_none());
    assert!(Atom::find(Text::from_ascii("7")).is_some());
}

#[test]
fn array_indices() {
    let parse = |text| parse_array_index(Text::from_ascii(text));
    assert_eq!(parse("0"), Some(0));
    assert_eq!(parse("4294967294"), Some(MAX_ARRAY_INDEX));
    for text in ["", "00", "01", "-1", "1a", "4294967295", "99999999999"] {
        assert_eq!(parse(text), None, "{text}");
    }
}

#[test]
fn symbols() {
    let key = StringRef::from_latin1(b"some key");
    assert_eq!(SymbolRef::registered(&key), SymbolRef::registered(&key));
    assert_ne!(SymbolRef::new(&key), SymbolRef::new(&key));
    assert!(SymbolRef::without_description().description().is_none());
    assert!(symbols::iterator.text().eq_ascii("Symbol.iterator"));
    let name = Text::from_ascii("isObject");
    assert!(find_private_name(name, name.hash()) == Some(private_names::isObject));
    assert!(private_names::isObject.is_private() && !symbols::iterator.is_private());
    assert!(find_well_known_symbol(Text::from_ascii("species")) == Some(symbols::species));
}

#[test]
fn builder_widens() {
    let mut builder = StringBuilder::new();
    for _ in 0..100 {
        builder.push_ascii("ab");
    }
    assert!(builder.is_latin1());
    builder.push_code_point(0x1f600);
    builder.push_json_quoted(Text::Utf16(&[0x22, 0xd800, 0x0a, 0xd83d, 0xde00, 0x01]));
    let expected = "ab".repeat(100) + "😀\"\\\"\\ud800\\n😀\\u0001\"";
    assert!(builder.finish().unwrap().text() == Text::Utf16(&wide(&expected)));
}

#[test]
fn builder_overflows() {
    let mut builder = StringBuilder::new();
    builder.push_repeated(b'a', MAX_LENGTH + 1);
    builder.push_ascii("more");
    assert!(builder.finish().is_err());
}

#[test]
fn substrings_outlive_their_base() {
    let base = StringRef::from_latin1(&[b'x'; 100]);
    let inner = StringRef::substring(&StringRef::substring(&base, 10..90), 5..70);
    drop(base);
    assert!(inner.is_substring() && inner.text() == Text::Latin1(&[b'x'; 65]));
}

#[test]
fn search_across_widths() {
    let narrow = Text::from_ascii("abcabc");
    let units = wide("abcabc");
    for haystack in [narrow, Text::Utf16(&units)] {
        for needle in [Text::from_ascii("bc"), Text::Utf16(&units[1..3])] {
            assert_eq!(haystack.find(needle, 2), Some(4));
            assert_eq!(haystack.rfind(needle, 3), Some(1));
            assert_eq!(haystack.rfind(needle, usize::MAX), Some(4));
        }
        assert_eq!(haystack.find(Text::EMPTY, 6), Some(6));
        assert_eq!(haystack.find(Text::EMPTY, 7), None);
    }
}

#[test]
fn utf8_round_trip() {
    let string = StringRef::from_str("aé€😀");
    assert_eq!(string.text().try_to_utf8().unwrap(), "aé€😀".as_bytes());
    assert!(StringRef::try_from_utf8(b"\xff").unwrap().is_none());
    let lossy = StringRef::try_from_utf8_lossy(b"a\xf0\x9fb").unwrap();
    assert!(lossy.text() == Text::Utf16(&[0x61, 0xfffd, 0x62]));
}

#[test]
fn fingerprints() {
    for length in [0, 5, 300, 1 << 14, (1 << 14) + 1, 50_000] {
        let mut narrow: Vec<u8> = (0..length).map(|it| (it * 7 % 251) as u8).collect();
        let wide: Vec<u16> = narrow.iter().map(|&it| it.into()).collect();
        let fingerprint = Text::Latin1(&narrow).fingerprint();
        assert_eq!(Text::Utf16(&wide).fingerprint(), fingerprint);
        if let Some(first) = narrow.first_mut() {
            *first += 1;
            assert_ne!(Text::Latin1(&narrow).fingerprint(), fingerprint);
        }
    }
}

#[test]
fn the_collector_is_charged_once_or_by_share() {
    let own = StringRef::from_latin1(&[b'x'; 900]);
    assert_eq!([own.take_cost(), own.take_cost()], [900, 0]);

    let shared = StringRef::to_shared(&own);
    drop(own);
    assert_eq!([shared.take_cost(), shared.take_cost()], [900, 900]);
    let holders = [shared.to_string_ref(), shared.to_string_ref()];
    assert_eq!(holders[0].take_cost(), 300);

    let literal = StringRef::to_shared(&StringRef::from_literal("x y"));
    assert_eq!(StringRef::empty().take_cost(), 0);
    assert!(literal.take_cost() <= 3);

    let lasting = StringRef::from_lasting_units(&[b'x'; 900]);
    assert_eq!([lasting.take_cost(), lasting.shared_cost()], [0, 0]);
    assert_eq!(StringRef::substring(&lasting, 1..800).shared_cost(), 0);
}

#[test]
fn hashes_start_all_over_a_table_of_any_size() {
    let (highest, slots) = ((1 << 24) - 1, 1 << 26);
    assert_eq!(home_slot(highest, 15), 15);
    assert_eq!(home_slot(highest, highest as usize), highest as usize);
    assert_eq!(home_slot(highest, slots - 1), slots - 4);
}
