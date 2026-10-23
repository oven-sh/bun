use super::*;

fn name_text<'a>(atoms: &'a FileAtoms<'_>, key: PropKey) -> Option<&'a str> {
    match key {
        PropKey::Name(name) => Some(atom_text(atoms, name)),
        PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => None,
    }
}

#[test]
fn bigint_property_name_is_decimal_text() {
    let cases: &[(&str, &[Option<&str>])] = &[
        ("({ 1n: a })", &[Some("1")]),
        ("({ 0n: a, 1_000n: b })", &[Some("0"), Some("1000")]),
        (
            "({ 0x10n: a, 0o17n: b, 0b101n: c })",
            &[Some("16"), Some("15"), Some("5")],
        ),
        ("({ 1n() {} })", &[Some("1")]),
        ("({ get 1n() { return a } })", &[Some("1")]),
        ("({ 1n: a } = b)", &[Some("1")]),
        (
            "({ a: { 2n: b }, 3n: c })",
            &[Some("2"), Some("a"), Some("3")],
        ),
        ("({ 1: a })", &[Some("1")]),
        ("({ \"1n\": a })", &[Some("1n")]),
        ("({ [1n]: a })", &[None]),
    ];
    for &(text, expected) in cases {
        for options in [typescript(), compiled_javascript()] {
            let (file, scratch) = parsed(text, options);
            let atoms = scratch.atoms(text.as_bytes());
            let keys = (0..file.props.len() as u32).map(|id| file.runtime_property_key(PropId(id)));
            let found: Vec<Option<&str>> = keys.map(|key| name_text(&atoms, key)).collect();
            assert_eq!(found, expected, "{text}");
        }
    }
}

#[test]
fn bigint_name_declares_nothing() {
    let (file, _) = parsed("({ 1n: a }); class A { 2n = 0 }", typescript());
    assert_eq!(file.props[0].key, PropKey::None);
    assert_eq!(file.members[0].key, PropKey::None);
    assert_eq!(file.bigint_names.len(), 2);
    assert!(file.bigint_names.is_sorted_by_key(|it| it.0));
}

#[test]
fn bigint_member_name_is_decimal_text() {
    let cases: &[(&str, &[&str])] = &[
        ("class A { 1n = 0 }", &["1"]),
        ("class A { 0x10n() {} }", &["16"]),
        (
            "class A { static 1_000n; get 2n() { return 0 } }",
            &["1000", "2"],
        ),
        ("class A { 1 = 0 }", &["1"]),
        ("class A { '1n' = 0 }", &["1n"]),
    ];
    for &(text, expected) in cases {
        let (file, scratch) = parsed(text, typescript());
        let atoms = scratch.atoms(text.as_bytes());
        let keys = (0..file.members.len() as u32).map(|id| file.runtime_member_key(MemberId(id)));
        let found: Vec<Option<&str>> = keys.map(|key| name_text(&atoms, key)).collect();
        let expected: Vec<Option<&str>> = expected.iter().map(|&name| Some(name)).collect();
        assert_eq!(found, expected, "{text}");
    }
}

#[test]
fn bigint_binding_key_is_decimal_text() {
    for (text, name) in [
        ("const { 1n: a } = b", "1"),
        ("const { 0n: a } = b", "0"),
        ("const { 1_000n: a } = b", "1000"),
        ("const { 0x10n: a } = b", "16"),
        ("const { 0X1Fn: a } = b", "31"),
        ("const { 0o17n: a } = b", "15"),
        ("const { 0b101n: a } = b", "5"),
        ("const { 1n: a = c } = b", "1"),
        (
            "const { 12345678901234567890n: a } = b",
            "12345678901234567890",
        ),
        ("const { '1n': a } = b", "1n"),
        ("const { a } = b", "a"),
    ] {
        let (file, scratch) = parsed(text, typescript());
        let [property] = file.pat_props[..] else {
            panic!("{text}: {:?}", file.pat_props);
        };
        let atoms = scratch.atoms(text.as_bytes());
        let key = file.runtime_binding_key(PatPropId(0));
        assert_eq!(name_text(&atoms, key), Some(name), "{text}");
        assert!(
            matches!(file[property.value].kind, PatKind::Ident(_)),
            "{text}"
        );
    }
}

#[test]
fn speculation_leaves_one_entry() {
    for text in [
        "({ 1n: a }) => a",
        "({ 1n: a })",
        "x = ({ 1n: a } = b) => a",
    ] {
        let (file, _) = parsed(text, typescript());
        assert_eq!(file.bigint_names.len(), 1, "{text}");
    }
}
