use super::*;

fn fnv1a(hash: u64, bytes: &[u8]) -> u64 {
    let mut h = hash;
    for &b in bytes {
        h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

#[test]
fn table_counts() {
    assert_eq!(CODES.len(), 2206);
    let mut by_category = [0usize; 4];
    let (mut unnecessary, mut elided, mut deprecated) = (0, 0, 0);
    let mut by_args = [0usize; 8];
    for &code in &CODES {
        let m = MessageId(code);
        by_category[m.category() as usize] += 1;
        unnecessary += usize::from(m.reports_unnecessary());
        elided += usize::from(m.elided_in_compatibility_pyramid());
        deprecated += usize::from(m.reports_deprecated());
        by_args[m.argument_count()] += 1;
    }
    assert_eq!(by_category, [0, 1379, 20, 807]);
    assert_eq!((unnecessary, elided, deprecated), (9, 4, 2));
    assert_eq!(by_args, [1259, 524, 299, 110, 12, 2, 0, 0]);
    assert_eq!(TEXTS.len(), 150_299);
    assert_eq!(CODES.first().copied(), Some(1002));
    assert_eq!(CODES.last().copied(), Some(100_068));
}

#[test]
fn ids_and_texts() {
    assert_eq!(Type_0_is_not_assignable_to_type_1, MessageId(2322));
    assert_eq!(
        Type_0_is_not_assignable_to_type_1.text(),
        b"Type '{0}' is not assignable to type '{1}'."
    );
    assert_eq!(
        Type_0_is_not_assignable_to_type_1.category(),
        Category::Error
    );
    assert_eq!(
        Unterminated_string_literal.text(),
        b"Unterminated string literal."
    );
    assert_eq!(X_0_expected.key(), b"_0_expected_1005");
    assert_eq!(
        Asterisk_Slash_expected.key(),
        b"Asterisk_Slash_expected_1010"
    );
    assert_eq!(Errors_Files.text(), b"Errors  Files");
    assert_eq!(X_0_is_deprecated.category(), Category::Suggestion);
    assert!(X_0_is_deprecated.reports_deprecated());
    assert!(Unreachable_code_detected.reports_unnecessary());
    assert!(Call_signature_return_types_0_and_1_are_incompatible.elided_in_compatibility_pyramid());
    assert!(MessageId::NIL.text().is_empty());
    assert!(!MessageId(1).is_valid());
    let last = MessageId(100_068);
    assert!(last.is_valid());
    assert!(!last.text().is_empty());
}

#[test]
fn keys_agree_with_upstream() {
    let mut all: Vec<u8> = Vec::new();
    for &code in &CODES {
        all.extend_from_slice(&MessageId(code).key());
        all.push(b'\n');
    }
    assert_eq!(all.len(), 145_680);
    assert_eq!(fnv1a(0xcbf2_9ce4_8422_2325, &all), 0x3543_bc28_8699_37b6);
}

#[test]
fn format_is_one_pass() {
    let f = |text: &[u8], args: &[&[u8]]| format(text, args);
    assert_eq!(f(b"Identifier expected.", &[]).0, b"Identifier expected.");
    assert_eq!(f(b"'{0}' expected.", &[b")"]).0, b"')' expected.");
    assert_eq!(
        f(
            b"The parser expected to find a '{1}' to match the '{0}' token here.",
            &[b"{", b"}"]
        )
        .0,
        b"The parser expected to find a '}' to match the '{' token here."
    );
    assert_eq!(f(b"'{0}' and '{1}'", &[b"{1}", b"x"]).0, b"'{1}' and 'x'");
    assert_eq!(f(b"'{0}'", &[]).0, b"'{0}'");
    assert_eq!(
        f(b"export type { {0} as default }", &[b"T"]).0,
        b"export type { T as default }"
    );
    assert_eq!(f(b"`{'}'}` {a} {} {0", &[b"T"]).0, b"`{'}'}` {a} {} {0");
    assert_eq!(f(b"{{0}}", &[b"T"]).0, b"{T}");
    assert_eq!(f(b"{01}", &[b"a", b"b"]).0, b"b");
    let (text, result) = f(b"'{0}' and '{1}'", &[b"x"]);
    assert_eq!(text, b"'x' and '{1}'");
    assert_eq!(result, Err(InvalidPlaceholder));
    let (text, result) = f(b"{99999999999999999999999}", &[b"x"]);
    assert_eq!(text, b"{99999999999999999999999}");
    assert_eq!(result, Err(InvalidPlaceholder));
    assert_eq!(
        f(b"{0}", &[b"a\xffb\xff\xfe\xc0c"]).0,
        "a\u{FFFD}b\u{FFFD}c".as_bytes()
    );
    assert_eq!(f(b"{0}", &[b"\xed\xa0\x80"]).0, "\u{FFFD}".as_bytes());
    assert_eq!(
        f(b"{0}", &["\u{e9}\u{1F600}".as_bytes()]).0,
        "\u{e9}\u{1F600}".as_bytes()
    );
    assert_eq!(f(b"{0}", &[b"\xe2\x82"]).0, "\u{FFFD}".as_bytes());
    assert_eq!(f(b"{0}", &[b"\xe2\x82x"]).0, "\u{FFFD}x".as_bytes());
}

#[test]
fn decimal() {
    let mut out = Vec::new();
    write_decimal(&mut out, 0);
    out.push(b' ');
    write_decimal(&mut out, -12);
    out.push(b' ');
    write_decimal(&mut out, i64::MIN);
    assert_eq!(out, b"0 -12 -9223372036854775808");
}
