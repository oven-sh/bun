use crate::{Options, Scratch};
use bun_sema::atom::{Atom, Intern};
use bun_sema::hir::*;
use bun_sema::resolve::Dialect;
use bun_sema_standalone as _;

const REPLACEMENT_CHARACTER: &[u8] = b"\xEF\xBF\xBD";

const ILL_FORMED_STRINGS: &[(&[u8], &[u8])] = &[
    (b"\xFF", b"\xC3\xBF"),
    (b"a\xFFb", b"a\xC3\xBFb"),
    (b"\x80", b"\xC2\x80"),
    (b"\xBF\xF8", b"\xC2\xBF\xC3\xB8"),
    (b"caf\xE9", b"caf\xEF\xBF\xBD"),
    (b"\xE2\x82a", b"\xEF\xBF\xBD\xC2\x82a"),
    (b"\xC0\x80", b"\xEF\xBF\xBD\xC2\x80"),
    (b"\xC3(", b"\xEF\xBF\xBD("),
    (b"\xF5\x80\x80\x80", b"\xEF\xBF\xBD\xC2\x80\xC2\x80\xC2\x80"),
    (b"\xF0\x9F\x98", b"\xEF\xBF\xBD\xC2\x9F\xC2\x98"),
    (b"\xED\xA0\x80", b"\xED\xA0\x80"),
    (b"\xED\xA0\xBD\xED\xB8\x80", b"\xF0\x9F\x98\x80"),
    (b"\xC3\xA9\xFF\xE6\x97\xA5", b"\xC3\xA9\xC3\xBF\xE6\x97\xA5"),
];

fn javascript(compiles: bool) -> Options {
    Options {
        is_javascript: true,
        is_jsx: true,
        compiles,
        recovers: true,
        dialect: Dialect {
            ecmascript: true,
            ..Default::default()
        },
        ..Default::default()
    }
}

fn tsx(compiles: bool) -> Options {
    Options {
        is_jsx: true,
        compiles,
        recovers: true,
        ..Default::default()
    }
}

fn with_parsed(
    text: &[u8],
    options: Options,
    check: impl FnOnce(&FileBuilder, &dyn Fn(Atom) -> Vec<u8>),
) {
    let mut scratch = Scratch::default();
    let parsed = crate::parse_with_own_atoms(text, options, &mut scratch);
    let file = parsed.unwrap().file;
    let atoms = scratch.atoms(text);
    check(&*file, &|atom| atoms.bytes(atom).to_vec());
}

fn with_file(
    text: &[u8],
    compiles: bool,
    check: impl FnOnce(&FileBuilder, &dyn Fn(Atom) -> Vec<u8>),
) {
    with_parsed(text, javascript(compiles), check);
}

fn only_string(file: &FileBuilder) -> (ExprId, Atom) {
    let strings = file
        .exprs
        .iter()
        .zip(0..)
        .filter_map(|(expr, id)| match expr.kind {
            ExprKind::String(text) => Some((ExprId(id), text)),
            _ => None,
        });
    let [string] = strings.collect::<Vec<_>>()[..] else {
        panic!("{:?}", file.exprs);
    };
    string
}

fn jsx_texts(file: &FileBuilder, bytes: &dyn Fn(Atom) -> Vec<u8>) -> Vec<Vec<u8>> {
    let texts = file.exprs.iter().filter_map(|expr| match expr.kind {
        ExprKind::JsxText(text) => Some(bytes(text)),
        _ => None,
    });
    texts.collect()
}

#[test]
fn compiled_files_read_ill_formed_bytes_like_bun_run() {
    for &(written, expected) in ILL_FORMED_STRINGS {
        for quote in [&b"\""[..], b"'", b"`"] {
            let text = [&b"x = "[..], quote, written, quote].concat();
            for options in [javascript(true), tsx(true)] {
                with_parsed(&text, options, |file, bytes| {
                    assert_eq!(bytes(only_string(file).1), expected, "{text:?}");
                });
            }
            for options in [javascript(false), tsx(false)] {
                with_parsed(&text, options, |file, bytes| {
                    assert_eq!(bytes(only_string(file).1), written, "{text:?}");
                });
            }
        }
    }
}

#[test]
fn escaped_lone_surrogate_stays() {
    with_file(b"x = \"\\uD800\"", true, |file, bytes| {
        assert_eq!(bytes(only_string(file).1), b"\xED\xA0\x80");
    });
    with_file(b"x = \"\\uD800\xE9\"", true, |file, bytes| {
        assert_eq!(bytes(only_string(file).1), b"\xED\xA0\x80\xEF\xBF\xBD");
    });
}

#[test]
fn escaped_and_written_surrogates_join() {
    for text in [
        &b"x = \"\\uD83D\xED\xB8\x80\""[..],
        b"x = \"\xED\xA0\xBD\\uDE00\"",
        b"x = \"\\uD83D\\\xED\xB8\x80\"",
    ] {
        for options in [javascript(true), tsx(true)] {
            with_parsed(text, options, |file, bytes| {
                assert_eq!(bytes(only_string(file).1), b"\xF0\x9F\x98\x80", "{text:?}");
            });
        }
    }
}

#[test]
fn ill_formed_byte_after_backslash() {
    let cases: [(&[u8], &[u8]); 4] = [
        (b"x = \"\\\xFF\"", b"\xC3\xBF"),
        (b"x = \"\\\x80a\"", b"\xC2\x80a"),
        (b"x = \"\\\xE9\"", REPLACEMENT_CHARACTER),
        (b"x = \"\\\xED\xA0\x80\"", b"\xED\xA0\x80"),
    ];
    for (text, expected) in cases {
        for options in [javascript(true), tsx(true)] {
            with_parsed(text, options, |file, bytes| {
                assert_eq!(bytes(only_string(file).1), expected, "{text:?}");
            });
        }
    }
    for options in [javascript(false), tsx(false)] {
        with_parsed(b"x = \"\\\xFF\"", options, |file, bytes| {
            assert_eq!(bytes(only_string(file).1), REPLACEMENT_CHARACTER);
        });
    }
}

fn template_parts(file: &FileBuilder, bytes: &dyn Fn(Atom) -> Vec<u8>) -> Vec<(Vec<u8>, Vec<u8>)> {
    (file.template_parts.iter())
        .map(|part| (bytes(part.cooked.unwrap()), bytes(part.raw)))
        .collect()
}

#[test]
fn ill_formed_bytes_in_template_parts() {
    with_file(b"f`a\\n\xE9\r\n\xE8${b}\xE7`", true, |file, bytes| {
        let text = |text: &str| text.as_bytes().to_vec();
        let expected = [
            (
                text("a\n\u{FFFD}\n\u{FFFD}"),
                text("a\\n\u{FFFD}\n\u{FFFD}"),
            ),
            (text("\u{FFFD}"), text("\u{FFFD}")),
        ];
        assert_eq!(template_parts(file, bytes), expected);
    });
    for options in [javascript(true), tsx(true)] {
        with_parsed(b"f`\xFF\\n\xED\xA0\x80${b}\x80`", options, |file, bytes| {
            let expected = [
                (
                    b"\xC3\xBF\n\xED\xA0\x80".to_vec(),
                    b"\xC3\xBF\\n\xED\xA0\x80".to_vec(),
                ),
                (b"\xC2\x80".to_vec(), b"\xC2\x80".to_vec()),
            ];
            assert_eq!(template_parts(file, bytes), expected);
        });
    }
}

#[test]
fn ill_formed_bytes_in_regular_expression() {
    let pattern_of = |file: &FileBuilder| {
        let patterns = file.exprs.iter().filter_map(|expr| match expr.kind {
            ExprKind::Regex { pattern, .. } => Some(pattern),
            _ => None,
        });
        patterns.last().unwrap()
    };
    for options in [javascript(true), tsx(true)] {
        with_parsed(b"x = /a\xE9/g", options, |file, bytes| {
            assert_eq!(bytes(pattern_of(file)), "a\u{FFFD}".as_bytes());
        });
        with_parsed(b"x = /a\xFF\xED\xA0\x80/g", options, |file, bytes| {
            assert_eq!(bytes(pattern_of(file)), b"a\xC3\xBF\xED\xA0\x80");
        });
    }
    for options in [javascript(false), tsx(false)] {
        with_parsed(b"x = /a\xE9/g", options, |file, bytes| {
            assert_eq!(bytes(pattern_of(file)), b"a\xE9");
        });
    }
}

#[test]
fn ill_formed_bytes_in_jsx_attribute() {
    let cases: [(&[u8], &[u8], &[u8]); 3] = [
        (b"x = <a b=\"caf\xE9\" />", b"caf\xE9", b"caf\xEF\xBF\xBD"),
        (b"x = <a b=\"\xFF\" />", b"\xFF", b"\xC3\xBF"),
        (
            b"x = <a b=\"\xED\xA0\x80\" />",
            b"\xED\xA0\x80",
            b"\xED\xA0\x80",
        ),
    ];
    for (text, written, expected) in cases {
        for options in [javascript(true), tsx(true)] {
            with_parsed(text, options, |file, bytes| {
                let (value, string) = only_string(file);
                assert_eq!(bytes(string), expected, "{text:?}");
                assert_eq!(bytes(file.jsx_attribute_text(value)), expected, "{text:?}");
            });
        }
        for options in [javascript(false), tsx(false)] {
            with_parsed(text, options, |file, bytes| {
                let (value, string) = only_string(file);
                assert_eq!(bytes(string), written, "{text:?}");
                assert_eq!(bytes(file.jsx_attribute_text(value)), expected, "{text:?}");
            });
        }
    }
}

#[test]
fn ill_formed_bytes_in_jsx_text() {
    let cases: [(&[u8], &[u8], &str); 4] = [
        (b"x = <a>caf\xE9</a>", b"caf\xEF\xBF\xBD", "caf\u{FFFD}"),
        (b"x = <a>\xFF</a>", b"\xC3\xBF", "\u{FFFD}"),
        (
            b"x = <a>a\n  \x80 &amp;\n</a>",
            b"a \xC2\x80 &",
            "a \u{FFFD} &",
        ),
        (
            b"x = <a>\xED\xA0\x80</a>",
            b"\xED\xA0\x80",
            "\u{FFFD}\u{FFFD}\u{FFFD}",
        ),
    ];
    for (text, compiled, checked) in cases {
        for options in [javascript(true), tsx(true)] {
            with_parsed(text, options, |file, bytes| {
                assert_eq!(jsx_texts(file, bytes), [compiled], "{text:?}");
            });
        }
        for options in [javascript(false), tsx(false)] {
            with_parsed(text, options, |file, bytes| {
                assert_eq!(jsx_texts(file, bytes), [checked.as_bytes()], "{text:?}");
            });
        }
    }
}

#[test]
fn entity_and_written_surrogate_join_in_jsx_text() {
    for text in [
        &b"x = <a>&#xD83D;\xED\xB8\x80</a>"[..],
        b"x = <a>\xED\xA0\xBD&#xDE00;</a>",
    ] {
        for options in [javascript(true), tsx(true)] {
            with_parsed(text, options, |file, bytes| {
                assert_eq!(jsx_texts(file, bytes), [b"\xF0\x9F\x98\x80"], "{text:?}");
            });
        }
    }
}

#[test]
fn stray_no_break_space_is_blank_in_compiled_jsx_text() {
    let text = b"x = <a>\n\xA0\n</a>";
    for options in [javascript(true), tsx(true)] {
        with_parsed(text, options, |file, bytes| {
            assert!(jsx_texts(file, bytes).is_empty());
        });
    }
    for options in [javascript(false), tsx(false)] {
        with_parsed(text, options, |file, bytes| {
            assert_eq!(jsx_texts(file, bytes), [REPLACEMENT_CHARACTER]);
        });
    }
}
