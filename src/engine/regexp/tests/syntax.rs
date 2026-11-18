mod support;

use bun_engine_regexp::Error::{self, *};
use bun_engine_regexp::{ErrorKind, Flags, Pattern, check_syntax, may_be_near_limits, summarize};
use bun_engine_text::Text;
use support::{flags, in_each_width};

fn check(source: &str, letters: &str, expected: Result<(), Error>) {
    in_each_width(source, |text| {
        let checked = check_syntax(text, Text::from_ascii(letters));
        assert_eq!(checked, expected, "/{source}/{letters}");
        assert_eq!(Pattern::new(text, flags(letters)).map(drop), expected);
    });
}

fn check_errors(letters: &str, cases: &[(Error, &[&str])]) {
    for &(error, sources) in cases {
        for source in sources {
            check(source, letters, Err(error));
        }
    }
}

#[test]
fn flags_are_known_and_unique() {
    assert_eq!(flags("yusmigd").to_text().text().to_string(), "dgimsuy");
    assert_eq!(flags("v"), Flags::UNICODE_SETS);
    for letters in ["gg", "uv", "x", "G", "g "] {
        let checked = check_syntax(Text::EMPTY, Text::from_ascii(letters));
        assert_eq!(checked, Err(InvalidFlags));
    }
}

#[test]
fn errors_in_every_mode() {
    for letters in ["", "u", "v"] {
        check_errors(
            letters,
            &[
                (QuantifierOutOfOrder, &["a{2,1}", "{2,1}", "(?<=a){2,1}"]),
                (
                    NothingToRepeat,
                    &["*", "a**", "a|+", "(?:?)", "^*", "\\b+", "{1}", "a{1}{2}"],
                ),
                (
                    QuantifierTooLarge,
                    &["a{18446744073709551615}", "{99999999999999999999,}"],
                ),
                (QuantifiedLookbehind, &["(?<=a)*", "(?<!a){1}"]),
                (UnterminatedGroup, &["(", "(?:a", "(?i", "(?<a>)\\k<b>("]),
                (UnmatchedParenthesis, &[")", "a)("]),
                (InvalidGroup, &["(?", "(?a)", "(?i)", "(?ii)x:", "(?g:)"]),
                (
                    InvalidModifier,
                    &["(?-:)", "(?ii:)", "(?i-i:)", "(?i--s:)", "(?i)hi", "(?-"],
                ),
                (
                    InvalidGroupName,
                    &["(?<", "(?<>)", "(?<1>)", "(?<a", "(?<a\\u003e)", "(?<a b>)"],
                ),
                (
                    DuplicateGroupName,
                    &[
                        "(?<a>)(?<a>)",
                        "(?<a>(?<a>))",
                        "(?<a>|(?<\\u0061>))",
                        "(?:(?<a>)|(?<a>))(?<a>)",
                        "(?<a>)(?:|(?<a>))",
                    ],
                ),
                (UnterminatedClass, &["[", "[^", "[a-", "[\\]"]),
                (RangeOutOfOrder, &["[b-a]", "[\\x62-\\x61]"]),
                (EscapeAtEnd, &["\\", "[\\", "[a-\\"]),
                (InvalidUnicodeEscape, &["(?<\\a>)", "(?<a\\u00>)"]),
                (InvalidCodePointEscape, &["(?<\\u{}>)", "(?<\\u{110000}>)"]),
                (InvalidNamedReference, &["(?<a>)\\k<b>", "\\k<b>(?<a>)"]),
            ],
        );
    }
    check_errors(
        "",
        &[(
            InvalidNamedReference,
            &["(?<a>)\\k", "\\k(?<a>", "(?<a>)[\\k]", "(?<a>)\\k<a"],
        )],
    );
}

#[test]
fn errors_with_code_points() {
    let cases: &[(Error, &[&str])] = &[
        (NothingToRepeat, &["(?=a)*", "(?!a){1}"]),
        (IncompleteQuantifier, &["{", "a{", "a{1", "a{1,", "a{,1}"]),
        (LoneBracket, &["]", "}"]),
        (InvalidRange, &["[\\d-a]", "[a-\\d]", "[\\p{L}-\\w]"]),
        (InvalidUnicodeEscape, &["\\u", "\\u123", "[\\uz]"]),
        (
            InvalidCodePointEscape,
            &["\\u{", "\\u{}", "\\u{1", "\\u{110000}"],
        ),
        (InvalidBackReference, &["\\1", "(a)\\2", "\\99999999999"]),
        (
            InvalidIdentityEscape,
            &[
                "\\a", "\\-", "\\é", "[\\😀]", "\\c", "\\x1", "\\k", "\\k<a", "[\\B]",
            ],
        ),
        (InvalidOctalEscape, &["\\00", "[\\1]"]),
        (InvalidControlEscape, &["\\c1", "[\\c_]"]),
        (
            InvalidProperty,
            &[
                "\\p",
                "\\p{",
                "\\p{}",
                "\\p{L",
                "\\p{l}",
                "\\p{sc=}",
                "\\p{L=L=L}",
            ],
        ),
    ];
    check_errors("u", cases);
    check_errors("v", cases);
    for (error, sources) in cases {
        let is_valid = |it: &&&str| *error != InvalidRange || !it.starts_with("[\\p");
        for source in sources.iter().filter(is_valid) {
            check(source, "", Ok(()));
        }
    }
    check_errors(
        "u",
        &[
            (InvalidProperty, &["\\p{RGI_Emoji}"]),
            (InvalidIdentityEscape, &["[\\&]", "[\\q{a}]"]),
        ],
    );
    check("\\k<a>", "u", Err(InvalidNamedReference));
    check("\\k<\\a>", "", Ok(()));
    check("[😀-😁]", "", Err(RangeOutOfOrder));
    check("[😀-😁]", "u", Ok(()));
}

#[test]
fn errors_in_class_sets() {
    check_errors(
        "v",
        &[
            (UnterminatedClassStrings, &["[\\q{", "[\\q{a|"]),
            (
                InvalidIdentityEscape,
                &["[\\q]", "[\\q{\\d}]", "[\\q{\\p{L}}]"],
            ),
            (
                InvalidSetOperation,
                &[
                    "[&&a]",
                    "[--a]",
                    "[ab&&c]",
                    "[a-c--b]",
                    "[a&&b--c]",
                    "[a&&bc]",
                    "[a--b-c]",
                    "[a\\d--b]",
                    "[[a][b]--c]",
                    "[a--[b][c]]",
                    "[[a]-b]",
                    "[!!]",
                    "[\\q{~~}]",
                ],
            ),
            (
                InvalidSetCharacter,
                &[
                    "[(]",
                    "[/]",
                    "[|]",
                    "[-]",
                    "[a-]",
                    "[-a]",
                    "[a&&]",
                    "[[a--]]",
                    "[a&&&b]",
                    "[a---b]",
                    "[a-[b]]",
                    "[a-\\q{b}]",
                    "[\\q{-}]",
                ],
            ),
            (
                NegatedStrings,
                &[
                    "\\P{RGI_Emoji}",
                    "[^\\p{RGI_Emoji}]",
                    "[^\\q{ab}]",
                    "[^\\q{}]",
                    "[[^\\q{a|}]]",
                    "[^\\q{ab}--a]",
                    "[^\\q{ab}&&\\q{cd}]",
                ],
            ),
        ],
    );
    for source in [
        "[]",
        "[[]]",
        "[\0]",
        "[&]",
        "[!-&]",
        "[\\&\\-\\~]",
        "[^\\q{a|b}]",
        "[^a--\\q{ab}]",
        "[\\p{L}[a&&b]]",
        "[[a][b--c]]",
    ] {
        check(source, "v", Ok(()));
    }
}

#[test]
fn many_names() {
    let groups: Vec<_> = (0..40).map(|n| format!("(?<n{n}>)")).collect();
    let groups = groups.concat();
    check(&format!("{groups}\\k<n39>|{groups}"), "", Ok(()));
    check(&format!("{groups}(?<n30>)"), "", Err(DuplicateGroupName));
    check(&format!("{groups}\\k<n40>"), "", Err(InvalidNamedReference));
}

#[test]
fn limits_of_the_source() {
    check(&"()".repeat(1 << 15), "", Ok(()));
    check(&"()".repeat((1 << 15) + 1), "", Err(TooManyCaptures));
    let filler = "a".repeat(1 << 20);
    check(&filler, "", Ok(()));
    check(&format!("[{filler}\\]]"), "", Ok(()));
    for (source, letters) in [
        (format!("{filler}a"), ""),
        (format!("[{filler}\\d]"), ""),
        (format!("[{filler}--a]"), "v"),
        (format!("[{}]", filler.repeat(4)), ""),
    ] {
        check(&source, letters, Err(PatternTooLarge));
    }
}

#[test]
fn limits_of_the_tree() {
    for (source, letters, expected) in [
        (
            "[".repeat(60_000) + &"]".repeat(60_000),
            "v",
            Err(TooDeeplyNested),
        ),
        ("a{4294967294}b".into(), "", Ok(())),
        ("a{4294967295}b".into(), "", Err(MinimumLengthTooLarge)),
        ("😀{2147483647}b".into(), "u", Ok(())),
        ("😀{2147483647}😀".into(), "u", Err(MinimumLengthTooLarge)),
        (
            "(?:a{2147483648}|)a{2147483648}".into(),
            "",
            Err(MinimumLengthTooLarge),
        ),
        ("(?:ab){4294967295}c".into(), "", Ok(())),
    ] {
        in_each_width(&source, |text| {
            assert_eq!(Pattern::new(text, flags(letters)).map(drop), expected);
            let summary = summarize(text, flags(letters)).unwrap();
            assert!(expected.is_ok() || summary.is_near_limits());
            assert!(may_be_near_limits(text));
        });
    }
    assert_eq!(TooDeeplyNested.kind(), ErrorKind::OutOfMemory);
    assert_eq!(PatternTooLarge.kind(), ErrorKind::SyntaxError);
}

#[test]
fn summary() {
    in_each_width("(a)(?:b)(?<c>c)(?=(d))\\9", |text| {
        let summary = summarize(text, flags("")).unwrap();
        assert_eq!((summary.group_count, summary.has_named_groups), (3, true));
        assert!(!summary.is_near_limits() && !may_be_near_limits(text));
    });
}
