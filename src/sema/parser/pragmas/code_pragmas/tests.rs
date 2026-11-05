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
fn comment_in_tag_holds_no_pragma() {
    let none = (None, ["", "", ""]);
    let cases = [
        ("<a /* @jsx h */ b='1' />;", none),
        ("< /* @jsx h */ a />;", none),
        ("<a b /* @jsx h */ ='1' />;", none),
        ("<a b= /* @jsx h */ '1' />;", none),
        ("<a b='1' /* @jsx h */ c />;", none),
        ("<a b='1' / /* @jsx h */ >;", none),
        ("<a // @jsx h\n b='1' />;", none),
        ("<a /* x */ /* @jsx h */ />;", none),
        ("<a.b /* @jsx h */ />;", none),
        ("<a b={1} /* @jsx h */ />;", none),
        ("<a b={{ c: 1 }} /* @jsx h */ />;", none),
        ("<a {...b} /* @jsx h */ />;", none),
        ("<a /* @jsx h */ ></a>;", none),
        ("<a></ /* @jsx h */ a>;", none),
        ("<a></a /* @jsx h */ >;", none),
        ("< /* @jsx h */ ></>;", none),
        ("<></ /* @jsx h */ >;", none),
        ("<a><b /* @jsx h */ /></a>;", none),
        ("<a><b></b /* @jsx h */ ></a>;", none),
        ("<a b={<c /* @jsx h */ />} />;", none),
        ("<a>{<c /* @jsx h */ />}</a>;", none),
        ("<a>/* @jsx h */</a>;", none),
        ("// @jsx g\n<a /* @jsx h */ />;", (None, ["g", "", ""])),
        (
            "<a /* @jsxRuntime classic @jsxFrag F @jsxImportSource s */ />;",
            none,
        ),
    ];
    assert_jsx_pragmas(&[javascript(true, false), tsx(true)], &cases);
    let cases = [
        ("<A /* @jsx h */ <B> />;", none),
        ("<A<B> /* @jsx h */ />;", none),
        ("<A<B> c /* @jsx h */ />;", none),
        ("<A<B<C>> / /* @jsx h */ >;", none),
    ];
    assert_jsx_pragmas(&[tsx(true)], &cases);
}

#[test]
fn comment_in_code_inside_tag_holds_pragma() {
    let read = (None, ["h", "", ""]);
    let cases = [
        ("<a b={/* @jsx h */ 1} />;", read),
        ("<a b={1 /* @jsx h */} />;", read),
        ("<a b={(1 /* @jsx h */)} />;", read),
        ("<a b={{ c: 1 } /* @jsx h */} />;", read),
        ("<a b={() => { /* @jsx h */ }} />;", read),
        ("<a {/* @jsx h */ ...b} />;", read),
        ("<a {.../* @jsx h */ b} />;", read),
        ("<a {...b /* @jsx h */} />;", read),
        ("<a>{/* @jsx h */}</a>;", read),
        ("<a>{1 /* @jsx h */}</a>;", read),
        ("<>{/* @jsx h */}</>;", read),
        ("<a b={<c d={/* @jsx h */ 1} />} />;", read),
        ("<a><b />{/* @jsx h */}<c /></a>;", read),
        ("/* @jsx h */ <a />;", read),
        ("<a /> /* @jsx h */;", read),
        ("(<a /> /* @jsx h */);", read),
        ("<a /* @jsx g */ />; // @jsx h", read),
    ];
    assert_jsx_pragmas(&[javascript(true, false), tsx(true)], &cases);
    let cases = [
        ("<A</* @jsx h */ B> />;", read),
        ("<A<B /* @jsx h */> />;", read),
        ("<A<(B) /* @jsx h */> />;", read),
        ("<A<B, /* @jsx h */ C> />;", read),
        ("<A<B<C> /* @jsx h */> />;", read),
        ("< /* @jsx h */ T,>(a: T) => a;", read),
    ];
    assert_jsx_pragmas(&[tsx(true)], &cases);
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
    for (name, classic, is_development) in [
        ("classic", Some(true), None),
        ("react", Some(true), None),
        ("automatic", Some(false), None),
        ("react-jsx", Some(false), Some(false)),
        ("react-jsxdev", Some(false), Some(true)),
        ("Classic", None, None),
        ("React-jsx", None, None),
        ("preserve", None, None),
    ] {
        let text = format!("// @jsxRuntime {name}\na;");
        let pragmas = parsed(&text, tsx(true)).unwrap().jsx_pragmas;
        let found = (pragmas.classic, pragmas.is_development);
        assert_eq!(found, (classic, is_development), "{name}");
    }
}

#[test]
fn last_compiled_jsx_runtime_decides_alone() {
    for (first, last, is_development) in [
        ("react-jsxdev", "react-jsx", Some(false)),
        ("react-jsx", "react-jsxdev", Some(true)),
        ("react-jsxdev", "automatic", None),
        ("react-jsxdev", "preserve", None),
    ] {
        let text = format!("// @jsxRuntime {first}\n// @jsxRuntime {last}\na;");
        let pragmas = parsed(&text, tsx(true)).unwrap().jsx_pragmas;
        assert_eq!(pragmas.is_development, is_development, "{text}");
    }
    let checked = parsed("/* @jsxRuntime react-jsxdev */ a;", tsx(false)).unwrap();
    assert_eq!(checked.jsx_pragmas, JsxPragmas::default());
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

/// A line: what this program prints under `bun run` and as an executable of `bun build --compile`, then its comments. Its tsconfig.json says "jsx": "react".
///
/// ```js
/// let ran = 0;
/// function mark() { ran++; }
/// const pick = (name) => (tag) => (tag === "a" ? name : tag);
/// const React = { createElement: pick("createElement"), Fragment: "Fragment" };
/// const h = pick("h"), g = pick("g"), F = "F";
/// /* the comments */ mark();
/// console.log(ran, <a />, <></>);
/// ```
///
/// `jsxDEV` of `./tiny/jsx-dev-runtime` answers with that name. Where a line has fewer words the program has fewer elements: their factory would be no name.
const READ_BY_BUN_RUN: &str = r"
0 | /* @__PURE__ */
0 | /* #__PURE__ */
0 | /*@__PURE__*/
0 | /* text @__PURE__ */
0 | /* @other @__PURE__ */
1 | /* @__PURE__x */
0 | /* @__PURE__. */
1 | /* @ __PURE__ */
0 | /* @@__PURE__ */
1 | /* __PURE__ */
1 | /* @jsx @__PURE__ */
1 | /* @jsxFrag @__PURE__ */
1 | /* @jsxImportSource #__PURE__ */
1 | /* @jsxRuntime @__PURE__ */
1 | /* #jsx @__PURE__ */
0 h Fragment | /* @jsx h @__PURE__ */
1 | /* @jsx        @__PURE__ */
0 | /* @jsx         @__PURE__ */
1 | /* @jsx\t@__PURE__ */
0 | /* @jsx\n@__PURE__ */
0 | /* @jsx: @__PURE__ */
0 | /* @jsxy @__PURE__ */
0 | /* @JSX @__PURE__ */
1 | /* @jsx a@__PURE__ */
1 | /* @jsx h @jsxFrag @__PURE__ */
0 | /* @jsx @__PURE__ @__PURE__ */
0 h Fragment | /* @__PURE__ @jsx h */
0 | /* @jsx @__PURE__ */ /* @__PURE__ */
0 createElement Fragment | /* @jsx */ /* @__PURE__ */
1 | /*# sourceMappingURL=a@__PURE__ */
0 | /*# sourceMappingURL=a @__PURE__ */
1 | /*@ sourceMappingURL=a@__PURE__ */
0 | /*# sourceMappingURL= @__PURE__ */
1 | /*# sourceMappingURL=@__PURE__ */
0 | /*#sourceMappingURL=a@__PURE__ */
0 | /*#  sourceMappingURL=a@__PURE__ */
0 | /*# sourceMappingURL=é@__PURE__ */
0 | /*# sourceMappingURL=a\t@__PURE__ */
0 | /*# sourceMappingURL=a\n@__PURE__ */
0 | /*# sourceURL=a@__PURE__ */
0 | /*# sourcemappingurl=a@__PURE__ */
0 | // @__PURE__\n
0 | //@__PURE__\n
0 | // #__PURE__\n
0 | //\t@__PURE__\n
1 | //\u{a0}@__PURE__\n
1 | // text @__PURE__\n
1 | // @other @__PURE__\n
1 | // @jsx @__PURE__\n
0 h Fragment | // @__PURE__ @jsx h\n
1 | //# sourceMappingURL=a @__PURE__\n
1 | // @__PURE__x\n
1 h Fragment | // @jsx h\n
1 h Fragment | /* @jsx h */
1 createElement Fragment | //# sourceMappingURL=map@jsx h\n
1 h Fragment | //# sourceMappingURL=map @jsx h\n
1 createElement Fragment | /*# sourceMappingURL=map@jsx h */
1 createElement Fragment | //@ sourceMappingURL=map@jsx h\n
1 createElement Fragment | //# sourceMappingURL=@jsx h\n
1 createElement Fragment | //# sourceMappingURL=map#jsx h\n
1 h Fragment | //#sourceMappingURL=map@jsx h\n
1 h Fragment | //# sourceMappingURL=é@jsx h\n
1 createElement Fragment | //# sourceMappingURL=map@jsxFrag F\n
1 h F | // @jsx h @jsxFrag F\n
1 createElement Fragment | /* @jsxImportSource @jsx h */
1 h Fragment | /* @jsxImportSource    @jsx h */
1 h Fragment | /* @jsxImportSource     @jsx h */
1 createElement Fragment | /* @jsxRuntime @jsx h */
1 g Fragment | // @jsx h\n// @jsx g\n
1 createElement Fragment | // @jsx h\n// @jsx \n
1 h Fragment | /* @jsx h\n*/
1 h Fragment | /* @jsx h*/
1 g Fragment | // @jsx h@jsxFrag F\n// @jsx g\n
1 createElement Fragment | /* @jsxImportSource   @jsx h */
1 createElement F | // @jsxFrag F\n
1 createElement Fragment | // @jsxFragment F\n
1 createElement Fragment | // @jsx-h h\n
1 h Fragment | // @jsx\u{a0}h\n
1 h Fragment | /* @jsx h\u{a0}g */
1 h Fragment | // @jsx h\r\n
1 h Fragment | /*@jsx h*/
0 h Fragment | /**\n * @jsx h\n * @__PURE__\n */
1 h Fragment | // #jsx h\n
1 g Fragment | // @jsx h // @jsx g\n
1 h Fragment | // @@jsx h\n
1 h Fragment | // a@jsx h\n
1 | /* @jsxRuntime        @__PURE__ */
0 | /* @jsxRuntime         @__PURE__ */
1 | /* @jsx @__PURE__*/
1 | /*# sourceMappingURL=a@__PURE__*/
1 | /* @jsx a */ /* b */
0 | /* @jsx @__PURE__ */ // @__PURE__\n
0 | // @jsx @__PURE__\n/* @__PURE__ */
1 ./tiny/jsx-dev-runtime | // @jsxRuntime automatic @jsxImportSource ./tiny\n
1 createElement | // @jsxImportSource ./tiny\n//# sourceMappingURL=a@jsxRuntime automatic\n
1 ./tiny/jsx-dev-runtime | // @jsxImportSource ./tiny\n//# sourceMappingURL=a @jsxRuntime automatic\n
1 ./tiny/jsx-dev-runtime | // @jsxRuntime automatic\n// @jsxImportSource ./tiny\n//# sourceMappingURL=a@jsxImportSource ./none\n
";

#[test]
fn comments_are_walked_like_bun_run() {
    for line in READ_BY_BUN_RUN.trim().lines() {
        let (printed, comments) = line.split_once(" | ").unwrap();
        let comments = (comments.replace("\\n", "\n").replace("\\r", "\r")).replace("\\t", "\t");
        let text = format!("{} mark();", comments.replace("\\u{a0}", "\u{a0}"));
        let options = javascript(true, false);
        let file = parsed(&text, options).unwrap();
        let ran = file.calls.iter().filter(|call| !call.is_pure).count();
        let (classic, [factory, fragment, import_source]) = jsx_pragmas(&text, options);
        let or = |written: String, default: &str| match written.is_empty() {
            true => default.to_owned(),
            false => written,
        };
        let answer = match classic {
            Some(false) => format!("{ran} {import_source}/jsx-dev-runtime"),
            _ => {
                let fragment = or(fragment, "Fragment");
                format!("{ran} {} {fragment}", or(factory, "createElement"))
            }
        };
        let word_count = printed.split(' ').count();
        let words: Vec<&str> = answer.split(' ').take(word_count).collect();
        assert_eq!(words.join(" "), printed, "{line}");
    }
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
