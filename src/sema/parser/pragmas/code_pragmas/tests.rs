use crate::{Options, Rejection, Scratch};
use bun_sema::atom::{Atom, Intern};
use bun_sema::hir::*;
use bun_sema_standalone as _;

const INVALID_PRAGMAS: [(&str, u32); 2] = [
    ("/// <reference foo=\"x\" />\na;", 1084),
    (
        "/// <reference types=\"t\" resolution-mode=\"other\" />\na;",
        1453,
    ),
];

fn parsed(text: &str, options: Options) -> Result<Box<FileBuilder>, Rejection> {
    let mut scratch = Scratch::default();
    let parsed = crate::parse_with_own_atoms(text.as_bytes(), options, &mut scratch);
    parsed.map(|it| it.file).map_err(|it| it.why)
}

fn javascript(compiles: bool, recovers: bool) -> Options {
    let mut options = Options {
        is_javascript: true,
        is_jsx: true,
        compiles,
        recovers,
        ..Options::default()
    };
    options.dialect.ecmascript = true;
    options
}

#[test]
fn invalid_pragma_is_comment_in_compiled_javascript() {
    for (text, code) in INVALID_PRAGMAS {
        for recovers in [false, true] {
            let file = parsed(text, javascript(true, recovers)).unwrap();
            let [error] = &file.diagnostics[..] else {
                panic!("{text}: {:?}", file.diagnostics);
            };
            assert_eq!(error.code, code, "{text}");
            assert_eq!(error.kind, DiagnosticKind::JsDoc, "{text}");
            assert_eq!(error.class, DiagnosticClass::TypeScriptGrammar, "{text}");
            assert!(!file.has_parse_diagnostics, "{text}");
            assert_eq!(file.body.len(), 1, "{text}");
        }
    }
}

#[test]
fn invalid_pragma_is_parse_error_elsewhere() {
    for (text, code) in INVALID_PRAGMAS {
        for options in [Options::default(), javascript(false, false)] {
            assert_eq!(
                parsed(text, options).err(),
                Some(Rejection::Reported),
                "{text}"
            );
            let recovering = Options {
                recovers: true,
                ..options
            };
            let file = parsed(text, recovering).unwrap();
            let [error] = &file.diagnostics[..] else {
                panic!("{text}: {:?}", file.diagnostics);
            };
            assert_eq!(error.code, code, "{text}");
            assert_eq!(error.kind, DiagnosticKind::Parse, "{text}");
            assert_eq!(error.class, DiagnosticClass::EarlyError, "{text}");
            assert!(file.has_parse_diagnostics, "{text}");
        }
    }
}

#[test]
fn invalid_resolution_mode_keeps_reference() {
    let (text, _) = INVALID_PRAGMAS[1];
    let file = parsed(text, javascript(true, false)).unwrap();
    let [(kind, _, _, mode)] = file.references[..] else {
        panic!("{:?}", file.references);
    };
    assert_eq!((kind, mode), (ReferenceKind::Types, ResolutionMode::None));
    let (text, _) = INVALID_PRAGMAS[0];
    assert!(
        parsed(text, javascript(true, false))
            .unwrap()
            .references
            .is_empty()
    );
}

fn tsx(compiles: bool) -> Options {
    Options {
        is_jsx: true,
        compiles,
        ..Options::default()
    }
}

fn jsx_pragmas(text: &str, options: Options) -> (Option<bool>, [String; 3]) {
    let mut scratch = Scratch::default();
    let parsed = crate::parse_with_own_atoms(text.as_bytes(), options, &mut scratch);
    let pragmas = parsed.unwrap().file.jsx_pragmas;
    let atoms = scratch.atoms(text.as_bytes());
    let written = |atom: Atom| match atom.is_some() {
        true => String::from_utf8(atoms.bytes(atom).to_vec()).unwrap(),
        false => String::new(),
    };
    let arguments = [
        pragmas.factory,
        pragmas.fragment_factory,
        pragmas.import_source,
    ];
    (pragmas.classic, arguments.map(written))
}

type ExpectedPragmas = (Option<bool>, [&'static str; 3]);

fn assert_jsx_pragmas(options: &[Options], cases: &[(&str, ExpectedPragmas)]) {
    for &(text, (classic, arguments)) in cases {
        for &options in options {
            let expected = (classic, arguments.map(str::to_owned));
            assert_eq!(jsx_pragmas(text, options), expected, "{text}");
        }
    }
}

const COMPILED_JSX_PRAGMAS: &[(&str, ExpectedPragmas)] = &[
    (
        "// @jsx fn\n// @jsxFrag something\na;",
        (None, ["fn", "something", ""]),
    ),
    ("// @jsxImportSource hello\na;", (None, ["", "", "hello"])),
    (
        "// @jsxImportSource @emotion/react\na;",
        (None, ["", "", "@emotion/react"]),
    ),
    ("//#jsx h\na;", (None, ["h", "", ""])),
    (
        "a;\n/** @jsxRuntime classic */ /** @jsx h */",
        (Some(true), ["h", "", ""]),
    ),
    ("a; // @jsx R.h\nb;", (None, ["R.h", "", ""])),
    (
        "/** @jsxRuntime classic @jsx h */ a;",
        (Some(true), ["h", "", ""]),
    ),
    ("// @jsx a @jsxFrag b\na;", (None, ["a", "b", ""])),
    (
        "/** @jsx first */ a; /** @jsx second */",
        (None, ["second", "", ""]),
    ),
    ("/* @jsx\th */ a;", (None, ["h", "", ""])),
    (
        "/**\n * @jsx h\n * @jsxFrag F\r\n */ a;",
        (None, ["h", "F", ""]),
    ),
];

#[test]
fn compiled_file_reads_jsx_pragmas_like_bun_run() {
    assert_jsx_pragmas(&[javascript(true, false), tsx(true)], COMPILED_JSX_PRAGMAS);
}

#[test]
fn compiled_file_ignores_other_comment_text() {
    let none = (None, ["", "", ""]);
    let cases = [
        ("// the `@jsx` pragma\na;", none),
        ("// @jsx: h\na;", none),
        ("// @jsx\na;", none),
        ("/* @jsx\n h */ a;", none),
        ("// @jsxy h\na;", none),
        ("// @JSX h\na;", none),
        ("// @jsxfrag h\na;", none),
        ("// jsx h\na;", none),
        ("a = \"// @jsx h\";", none),
    ];
    assert_jsx_pragmas(&[javascript(true, false), tsx(true)], &cases);
}

#[test]
fn last_compiled_jsx_pragma_wins_with_unusable_argument() {
    let none = (None, ["", "", ""]);
    let cases = [
        ("// @jsx h\n// @jsx .\na;", none),
        ("// @jsxFrag F\n// @jsxFrag ..\na;", none),
        ("// @jsx h\n/* @jsx */ a;", none),
        ("// @jsxImportSource a\n/* @jsxImportSource */ b;", none),
        ("// @jsxRuntime classic\n// @jsxRuntime preserve\na;", none),
    ];
    assert_jsx_pragmas(&[javascript(true, false), tsx(true)], &cases);
}

#[test]
fn compiled_jsx_runtime_names() {
    for (name, classic) in [
        ("classic", Some(true)),
        ("react", Some(true)),
        ("automatic", Some(false)),
        ("react-jsx", Some(false)),
        ("react-jsxdev", Some(false)),
        ("Classic", None),
        ("preserve", None),
    ] {
        let text = format!("// @jsxRuntime {name}\na;");
        assert_eq!(jsx_pragmas(&text, tsx(true)).0, classic, "{name}");
    }
}

#[test]
fn line_break_is_part_of_compiled_block_comment_argument() {
    let cases = [
        ("/**\n * @jsxRuntime classic\n */ a;", (None, ["", "", ""])),
        (
            "/**\n * @jsxImportSource b\n */ a;",
            (None, ["", "", "b\n"]),
        ),
    ];
    assert_jsx_pragmas(&[javascript(true, false), tsx(true)], &cases);
}

#[test]
fn checked_file_reads_jsx_pragmas_like_tsc() {
    let none = (None, ["", "", ""]);
    let cases = [
        ("// @jsx fn\n// @jsxFrag something\na;", none),
        ("// @jsxImportSource hello\na;", none),
        ("a;\n/** @jsxRuntime classic */ /** @jsx h */", none),
        (
            "/** @jsx first */ a; /** @jsx second */",
            (None, ["first", "", ""]),
        ),
        (
            "/** @jsxRuntime classic @jsx h */ a;",
            (Some(true), ["", "", ""]),
        ),
        ("/* @JSX h */ a;", (None, ["h", "", ""])),
        (
            "/**\n * @jsxRuntime classic\n * @jsxImportSource b\n */ a;",
            (Some(true), ["", "", "b"]),
        ),
        ("/* @jsxRuntime react */ a;", none),
    ];
    assert_jsx_pragmas(&[tsx(false), javascript(false, false)], &cases);
}

#[test]
fn file_without_jsx_syntax_has_no_jsx_pragmas() {
    for compiles in [false, true] {
        let options = Options {
            compiles,
            ..Options::default()
        };
        let found = jsx_pragmas("/* @jsx h */ a; // @jsxFrag F", options);
        assert_eq!(found, (None, <[String; 3]>::default()));
    }
}
