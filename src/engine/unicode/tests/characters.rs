use bun_engine_standalone as _;
use bun_engine_text::Text;
use bun_engine_unicode::*;

fn property(name: &str) -> Property {
    Property::of_characters(Text::from_ascii(name)).unwrap()
}

fn has(property: Property, c: char) -> bool {
    property.ranges().any(|range| range.contains(&u32::from(c)))
}

#[test]
fn white_space_is_the_category_zs_and_four_more() {
    let mut expected: Vec<u32> = property("Zs").ranges().flatten().collect();
    expected.extend([0x09, 0x0b, 0x0c, 0xfeff]);
    for c in 0..=MAX_CODE_POINT {
        assert_eq!(is_white_space(c), expected.contains(&c), "{c:x}");
        assert_eq!(
            is_str_white_space(c),
            is_white_space(c) || is_line_terminator(c),
            "{c:x}"
        );
    }
}

#[test]
fn identifiers() {
    for (name, test) in [
        ("ID_Start", is_id_start as fn(u32) -> bool),
        ("ID_Continue", is_id_continue),
    ] {
        assert!(property(name).ranges().flatten().all(test));
        let assigned = property("Assigned").ranges().flatten();
        let members = property(name).ranges().flatten().count();
        assert_eq!(assigned.filter(|&c| test(c)).count(), members);
        assert!(!test(MAX_CODE_POINT) && !test(u32::MAX));
    }
    for c in ['$', '_', 'a', 'ª', '℘', '𠮷'] {
        assert!(is_identifier_start(c.into()) && is_identifier_part(c.into()));
    }
    for c in ['0', '·', '\u{200c}', '\u{200d}', '\u{e01ef}'] {
        assert!(!is_identifier_start(c.into()) && is_identifier_part(c.into()));
    }
}

#[test]
fn property_names() {
    let pair = |name, value| Property::with_value(Text::from_ascii(name), Text::from_ascii(value));
    assert_eq!(pair("gc", "Lu"), Some(property("Uppercase_Letter")));
    assert_eq!(pair("General_Category", "punct"), Some(property("P")));
    assert_eq!(pair("Script", "Greek"), pair("sc", "Grek"));
    assert_eq!(pair("scx", "Qaai"), pair("Script_Extensions", "Inherited"));
    assert!(!has(pair("sc", "Hira").unwrap(), 'ー') && has(pair("scx", "Hira").unwrap(), 'ー'));
    assert!(has(pair("sc", "Zyyy").unwrap(), 'ー') && !has(pair("scx", "Zyyy").unwrap(), 'ー'));
    for (name, value) in [
        ("gc", "Any"),
        ("sc", "Hrkt"),
        ("sc", "greek"),
        ("Block", "ASCII"),
    ] {
        assert_eq!(pair(name, value), None);
    }
    for name in [
        "",
        "Greek",
        "any",
        "RGI_Emoji",
        "Full_Composition_Exclusion",
    ] {
        assert_eq!(Property::of_characters(Text::from_ascii(name)), None);
    }
    let wide: Vec<u16> = "ASCII".encode_utf16().collect();
    assert_eq!(
        Property::of_characters(Text::Utf16(&wide)),
        Some(property("ASCII"))
    );
    assert_eq!(property("Any").ranges().next(), Some(0..=MAX_CODE_POINT));
}

#[test]
fn properties_of_strings() {
    let count = |name| {
        let property = Property::of_strings(Text::from_ascii(name)).unwrap();
        assert!(property.has_strings() && property.index() < Property::COUNT);
        let (mut strings, mut count) = (property.strings(), 0);
        while let Some(string) = strings.next() {
            assert!(string.len() > 1);
            count += 1;
        }
        count + property.ranges().flatten().count()
    };
    let parts = [
        ("Basic_Emoji", 1400),
        ("Emoji_Keycap_Sequence", 12),
        ("RGI_Emoji_Flag_Sequence", 259),
        ("RGI_Emoji_Modifier_Sequence", 665),
        ("RGI_Emoji_Tag_Sequence", 3),
        ("RGI_Emoji_ZWJ_Sequence", 1614),
    ];
    assert_eq!(parts.map(|(name, _)| (name, count(name))), parts);
    assert_eq!(count("RGI_Emoji"), parts.iter().map(|it| it.1).sum());
    assert!(property("L").strings().next().is_none());
}

#[test]
fn equivalents_are_the_characters_with_the_same_canonical_form() {
    for mode in [IgnoreCase::CodeUnits, IgnoreCase::CodePoints] {
        let mut sizes = vec![0u8; MAX_CODE_POINT as usize + 1];
        for c in 0..=MAX_CODE_POINT {
            sizes[mode.canonicalize(c) as usize] += 1;
        }
        for c in 0..=0x2_0000 {
            let canonical = mode.canonicalize(c);
            assert!(
                mode.equivalents(c)
                    .all(|it| mode.canonicalize(it) == canonical)
            );
            let size = mode.equivalents(c).count() + 1;
            assert_eq!(size, usize::from(sizes[canonical as usize]), "{c:x}");
        }
    }
    let of = |mode: IgnoreCase, c: char| mode.equivalents(c.into()).collect::<Vec<_>>();
    assert_eq!(of(IgnoreCase::CodeUnits, 'k'), [0x4b]);
    assert_eq!(of(IgnoreCase::CodePoints, 'k'), [0x212a, 0x4b]);
    assert_eq!(of(IgnoreCase::CodeUnits, 'ß'), []);
    assert_eq!(of(IgnoreCase::CodeUnits, '𐐀'), []);
    assert_eq!(of(IgnoreCase::CodePoints, '𐐀'), [0x1_0428]);
}

#[test]
fn only_assigned_characters_fold() {
    let mut unassigned = property("Cn").ranges().flatten();
    assert!(unassigned.all(|c| IgnoreCase::CodePoints.canonicalize(c) == c));
}

#[test]
fn closing_a_range_adds_the_equivalents_of_its_characters() {
    for mode in [IgnoreCase::CodeUnits, IgnoreCase::CodePoints] {
        for (first, size) in (0..0x600).flat_map(|first| [0, 1, 2, 7, 40].map(|size| (first, size)))
        {
            let range = first..=first + size;
            let mut closed: Vec<u32> = range.clone().collect();
            let mut expected = closed.clone();
            mode.close_over(range.clone(), |more| closed.extend(more));
            expected.extend(range.flat_map(|c| mode.equivalents(c)));
            for set in [&mut closed, &mut expected] {
                set.sort_unstable();
                set.dedup();
            }
            assert_eq!(closed, expected);
        }
    }
}
