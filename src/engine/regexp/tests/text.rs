mod support;

use core::ops::ControlFlow;

use bun_engine_regexp::{Part, Pattern, Template, escape, escape_pattern};
use bun_engine_text::{StringBuilder, Text};
use support::{flags, in_each_width};

#[test]
fn escapes_text() {
    for (text, expected) in [
        ("", ""),
        ("ab1", "\\x61b1"),
        ("1_", "\\x31_"),
        (
            "_^$\\.*+?()[]{}|/",
            "_\\^\\$\\\\\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\/",
        ),
        ("\t\n\x0b\x0c\r \u{a0}é", "\\t\\n\\v\\f\\r\\x20\\xa0é"),
        (",-=<>#&!", "\\x2c\\x2d\\x3d\\x3c\\x3e\\x23\\x26\\x21"),
        ("%:;@~'`\"", "\\x25\\x3a\\x3b\\x40\\x7e\\x27\\x60\\x22"),
        ("\u{2028}漢\u{feff}😀", "\\u2028漢\\ufeff😀"),
    ] {
        in_each_width(text, |text| {
            assert_eq!(escape(text).unwrap().to_string(), expected);
        });
    }
    let lone = escape(Text::Utf16(&[0xdc00, 0xd800, 0xd800, 0xdc00, 0xd800])).unwrap();
    assert_eq!(lone.to_string(), "\\udc00\\ud800\u{10000}\\ud800");
}

#[test]
fn escapes_patterns() {
    for (source, expected) in [
        ("", Some("(?:)")),
        ("a\\/[/]", None),
        ("/", Some("\\/")),
        ("[\\]/]/[[]/", Some("[\\]/]\\/[[]\\/")),
        ("\\\\/", Some("\\\\\\/")),
        ("\n\\\r[\n]", Some("\\n\\r[\\n]")),
        ("\u{2028}\\\u{2029}", Some("\\u2028\\u2029")),
    ] {
        in_each_width(source, |source| {
            let escaped = escape_pattern(source).unwrap().map(|it| it.to_string());
            assert_eq!(escaped.as_deref(), expected);
        });
    }
}

#[test]
fn substitutes() {
    let source = "(?<x>b)(c)|(?<x>q)";
    let pattern = Pattern::new(Text::from_ascii(source), flags("")).unwrap();
    let captures = [1, 2, 2, 3, u32::MAX, u32::MAX];
    for (template, expected) in [
        ("", ""),
        ("x", "x"),
        ("$", "$"),
        ("$$$&$`$'$$", "$bcad$"),
        ("[$1|$02|$3|$4|$0|$00|$10|$x]", "[b|c||$4|$0|$00|b0|$x]"),
        ("$<x>$<y>$<>é$<x", "bé$<x"),
    ] {
        in_each_width(template, |template| {
            let mut result = StringBuilder::new();
            let mut parsed = Template::default();
            parsed.parse(template, 3, pattern.group_names()).unwrap();
            parsed.append(&mut result, Text::from_ascii("abcd"), 1..3, &captures);
            assert_eq!(result.text().to_string(), expected);
        });
    }
    let parts = |has_names| Template::parts(Text::from_ascii("a$<b>$12"), 12, has_names);
    assert!(parts(true).eq([Part::Literal(0..1), Part::Name(3..4), Part::Group(12)]));
    assert!(parts(false).eq([Part::Literal(0..5), Part::Group(12)]));
}

#[test]
fn forms_find_all_matches() {
    let cases: &[(&str, &str, &str, usize, &[(usize, usize)])] = &[
        ("ab", "", "abab-ab", 1, &[(2, 4), (5, 7)]),
        ("\\.", "i", "a.b.", 0, &[(1, 2), (3, 4)]),
        ("aa", "", "aaaaa", 0, &[(0, 2), (2, 4)]),
        ("漢", "", "ab", 0, &[]),
        ("😀", "u", "😀😀", 1, &[(0, 2), (2, 4)]),
        (
            "\\r\\n?|\\n",
            "",
            "\r\n\n\r\r\n",
            0,
            &[(0, 2), (2, 3), (3, 4), (4, 6)],
        ),
        (
            "\\r?\\n|\\r",
            "m",
            "\r\n\ra\n",
            1,
            &[(1, 2), (2, 3), (4, 5)],
        ),
        (
            "\\r\\n|[\\r\\u2028]",
            "",
            "\n\u{2028}\r\n",
            0,
            &[(1, 2), (2, 4)],
        ),
        ("\\r?\\n", "", "\r\r\n\n", 0, &[(1, 3), (3, 4)]),
        ("[,;]", "", "a,b;;", 0, &[(1, 2), (3, 4), (4, 5)]),
        (
            "\\s+",
            "",
            " a \u{a0}b\u{3000}",
            0,
            &[(0, 1), (2, 4), (5, 6)],
        ),
        ("k+", "iu", "kK\u{212a}a", 0, &[(0, 3)]),
        ("^\\s+", "", "  a ", 0, &[(0, 2)]),
        ("^\\s+", "", "  a ", 1, &[]),
        ("/+$", "", "a/b//", 4, &[(4, 5)]),
        ("^\\s+|\\s+$", "", " a b  ", 0, &[(0, 1), (4, 6)]),
        ("\\s+$|^\\s+", "", "  ", 0, &[(0, 2)]),
        ("^\"|\"$", "", "\"\"a\"\"", 0, &[(0, 1), (4, 5)]),
        ("a$", "", "", 0, &[]),
        ("a", "", "a", 2, &[]),
    ];
    for &(source, letters, subject, start, expected) in cases {
        in_each_width(source, |source| {
            let pattern = Pattern::new(source, flags(letters)).unwrap();
            let form = pattern.form().unwrap().unwrap();
            in_each_width(subject, |subject| {
                let mut found = Vec::new();
                form.for_each(subject, start, |it| {
                    found.push((it.start, it.end));
                    ControlFlow::Continue(())
                });
                assert_eq!(found, expected, "/{source}/{letters}");
                let last = expected.last().map(|&(start, end)| start..end);
                assert_eq!(form.count(subject, start), (expected.len(), last));
            });
        });
    }
}

#[test]
fn other_patterns_have_no_form() {
    for (source, letters) in [
        ("", ""),
        ("a", "y"),
        ("(a)", ""),
        ("ab", "i"),
        ("\\ud83d", "u"),
        ("[^a]", "u"),
        ("a*", ""),
        ("a+?", ""),
        ("^a", "m"),
        ("^a+|b+$", ""),
        ("^a+|a$", ""),
        ("\\r|\\r\\n", ""),
        ("\\r\\n|a", ""),
    ] {
        let pattern = Pattern::new(Text::from_ascii(source), flags(letters)).unwrap();
        assert!(pattern.form().unwrap().is_none(), "/{source}/{letters}");
    }
}

#[test]
fn forms_find_members_at_any_distance() {
    for (source, member, other) in [
        ("[;a]", 'a', 'x'),
        ("[<>&]", '&', 'x'),
        (r"\s", '\u{a0}', 'é'),
        (r"\s", '\u{3000}', 'あ'),
        ("[、。]", '。', 'あ'),
        ("[ёЀ]", 'ё', 'Ё'),
        ("[ǰ-ȏ]", 'Ȁ', 'ď'),
        ("[^\\0-\u{fe}]", 'ÿ', 'x'),
        ("[^\\0-\u{ff}]", 'Ā', 'ÿ'),
        (r"[\x01\x12#4EVgx\x89\x9a\xab]", '\u{ab}', '\u{8a}'),
    ] {
        let units: Vec<u16> = source.encode_utf16().collect();
        let pattern = Pattern::new(Text::Utf16(&units), flags("")).unwrap();
        let form = pattern.form().unwrap().unwrap();
        for distance in 0..200 {
            let before = other.to_string().repeat(distance);
            in_each_width(&format!("{before}{member}{before}"), |subject| {
                assert_eq!(form.find(subject, 0), Some(distance..distance + 1));
                assert_eq!(form.find(subject, distance + 1), None);
            });
        }
    }
}
