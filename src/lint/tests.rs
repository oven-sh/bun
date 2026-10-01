use std::borrow::Cow;

use bun_ast::{Data, Kind, Loc, Log, Msg, Range, Source, range_data};
use bun_core::BStr;

use crate::code_frame::write_code_frames;
use crate::diagnostic::{
    Category, Code, Diagnostic, FileId, MessageChain, SourceFile, compare_diagnostics,
};
use crate::diagnosticwriter::{FormattingOptions, write_format_diagnostics};
use crate::program::sort_and_deduplicate_diagnostics;
use crate::scanner::{
    compute_ecma_line_starts, get_ecma_line_and_utf16_character_of_position, utf16_len,
};
use crate::tspath::{ComparePathsOptions, convert_to_relative_path, get_normalized_absolute_path};

fn file(name: &'static str, display: &'static str, text: &'static str) -> SourceFile {
    SourceFile::new(
        name.as_bytes().into(),
        Source::init_path_string(display.as_bytes(), text.as_bytes()),
    )
}

fn rule(file: u32, start: u32, length: u32, name: &'static str, text: &'static str) -> Diagnostic {
    Diagnostic {
        file: Some(FileId(file)),
        start,
        length,
        category: Category::Error,
        code: Code::Name(name),
        text: Cow::Borrowed(text.as_bytes()),
        chain: Vec::new(),
        related: Vec::new(),
    }
}

fn ts(start: u32, length: u32, number: u32, text: &'static str) -> Diagnostic {
    Diagnostic {
        file: Some(FileId(0)),
        start,
        length,
        category: Category::Error,
        code: Code::Ts(number),
        text: Cow::Borrowed(text.as_bytes()),
        chain: Vec::new(),
        related: Vec::new(),
    }
}

fn link(text: &'static str, next: Vec<MessageChain>) -> MessageChain {
    MessageChain {
        text: Cow::Borrowed(text.as_bytes()),
        next,
    }
}

fn opts(current_directory: &'static str) -> FormattingOptions<'static> {
    FormattingOptions {
        compare_paths_options: ComparePathsOptions {
            use_case_sensitive_file_names: true,
            current_directory: current_directory.as_bytes(),
        },
        new_line: b"\n",
    }
}

fn plain(files: &[SourceFile], diagnostics: &[Diagnostic], cwd: &'static str) -> Vec<u8> {
    let mut out = Vec::new();
    write_format_diagnostics(&mut out, files, diagnostics, &opts(cwd));
    out
}

fn frames<const COLORS: bool>(
    files: &[SourceFile],
    diagnostics: &[Diagnostic],
    cwd: &'static str,
) -> Vec<u8> {
    let mut out = Vec::new();
    write_code_frames::<COLORS>(&mut out, files, diagnostics, &opts(cwd));
    out
}

#[track_caller]
fn assert_bytes(got: &[u8], expected: &str) {
    assert_eq!(BStr::new(got), BStr::new(expected.as_bytes()));
}

const B_JS: &str = "debugger;\nx === NaN === NaN;\n({a, a} = {a});\nNaN === -0;\n";

fn the_run() -> (Vec<SourceFile>, Vec<Diagnostic>) {
    let files = vec![
        file("/proj/sub/d.js", "sub/d.js", "return\n1;\n"),
        file("/proj/c.js", "c.js", "let x = 1 }"),
        file("/proj/b.js", "b.js", B_JS),
        file("/proj/a.ts", "a.ts", "let x: = 1;\n"),
    ];
    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    let mut log = Log::init();
    log.add_warning(
        Some(files[0].source()),
        Loc { start: 7 },
        b"The following expression is not returned because of an automatically-inserted semicolon"
            as &[u8],
    );
    for msg in log.msgs.drain(..) {
        diagnostics.extend(Diagnostic::from_msg(FileId(0), msg));
    }

    let mut log = Log::init();
    log.add_range_error_fmt(
        Some(files[1].source()),
        Range {
            loc: Loc { start: 10 },
            len: 1,
        },
        format_args!("Unexpected }}"),
    );
    for msg in log.msgs.drain(..) {
        diagnostics.extend(Diagnostic::from_msg(FileId(1), msg));
    }

    let isnan = "Use the isNaN function to compare with NaN.";
    let self_assign = "'a' is assigned to itself.";
    diagnostics.push(rule(2, 45, 10, "use-isnan", isnan));
    diagnostics.push(rule(
        2,
        45,
        10,
        "no-compare-neg-zero",
        "Do not use the '===' operator to compare against -0.",
    ));
    diagnostics.push(rule(2, 40, 1, "no-self-assign", self_assign));
    diagnostics.push(rule(2, 40, 1, "no-self-assign", self_assign));
    diagnostics.push(rule(2, 10, 17, "use-isnan", isnan));
    diagnostics.push(rule(2, 10, 9, "use-isnan", isnan));
    diagnostics.push(rule(
        2,
        0,
        9,
        "no-debugger",
        "Unexpected 'debugger' statement.",
    ));

    let mut log = Log::init();
    log.add_range_error_with_code(
        Some(files[3].source()),
        Range {
            loc: Loc { start: 7 },
            len: 1,
        },
        1110,
        Cow::Borrowed(b"Type expected."),
        Box::default(),
    );
    for msg in log.msgs.drain(..) {
        diagnostics.extend(Diagnostic::from_msg(FileId(3), msg));
    }

    diagnostics.push(Diagnostic {
        file: None,
        start: 0,
        length: 0,
        category: Category::Error,
        code: Code::CANNOT_READ_FILE,
        text: Cow::Borrowed(b"File 'nope.ts' not found."),
        chain: Vec::new(),
        related: Vec::new(),
    });
    (files, diagnostics)
}

#[test]
fn the_plain_format_is_sorted_and_has_no_duplicate() {
    let (files, diagnostics) = the_run();
    assert_eq!(diagnostics.len(), 11);
    let diagnostics = sort_and_deduplicate_diagnostics(&files, diagnostics);
    assert_eq!(diagnostics.len(), 10);
    assert_bytes(
        &plain(&files, &diagnostics, "/proj"),
        "error cannot-read-file: File 'nope.ts' not found.\n\
         a.ts(1,8): error TS1110: Type expected.\n\
         b.js(1,1): error no-debugger: Unexpected 'debugger' statement.\n\
         b.js(2,1): error use-isnan: Use the isNaN function to compare with NaN.\n\
         b.js(2,1): error use-isnan: Use the isNaN function to compare with NaN.\n\
         b.js(3,12): error no-self-assign: 'a' is assigned to itself.\n\
         b.js(4,1): error no-compare-neg-zero: Do not use the '===' operator to compare against -0.\n\
         b.js(4,1): error use-isnan: Use the isNaN function to compare with NaN.\n\
         c.js(1,11): error syntax: Unexpected }\n\
         sub/d.js(2,1): warning syntax: The following expression is not returned because of an automatically-inserted semicolon\n",
    );
    // The shorter of two diagnostics with one start comes first.
    assert_eq!((diagnostics[3].length, diagnostics[4].length), (9, 17));
    // Only a diagnostic of the category error makes the run fail.
    let errors = diagnostics
        .iter()
        .filter(|d| d.category == Category::Error)
        .count();
    assert_eq!(errors, 9);
}

#[test]
fn the_frame_format() {
    let (files, diagnostics) = the_run();
    let diagnostics = sort_and_deduplicate_diagnostics(&files, diagnostics);
    let picked: Vec<Diagnostic> = [0usize, 1, 2, 8, 9]
        .iter()
        .filter_map(|&i| diagnostics.get(i).cloned())
        .collect();
    assert_bytes(
        &frames::<false>(&files, &picked, "/proj"),
        "error: cannot-read-file: File 'nope.ts' not found.\n\
         \n\
         1 | let x: = 1;\n           ^\n\
         error: TS1110: Type expected.\n    at a.ts:1:8\n\
         \n\
         1 | debugger;\n    ^\n\
         error: no-debugger: Unexpected 'debugger' statement.\n    at b.js:1:1\n\
         \n\
         1 | let x = 1 }\n              ^\n\
         error: syntax: Unexpected }\n    at c.js:1:11\n\
         \n\
         2 | 1;\n    ^\n\
         warn: syntax: The following expression is not returned because of an automatically-inserted semicolon\n   at sub/d.js:2:1\n",
    );
    let colored: Vec<Diagnostic> = picked.iter().take(2).cloned().collect();
    assert_bytes(
        &frames::<true>(&files, &colored, "/proj"),
        "\x1b[31merror\x1b[0m\x1b[2m: \x1b[0m\x1b[1mcannot-read-file: File 'nope.ts' not found.\x1b[0m\n\
         \n\
         \x1b[1m1 | \x1b[0m\x1b[0m\x1b[35mlet\x1b[0m x: = \x1b[0m\x1b[33m1\x1b[0m\x1b[0m\x1b[2m;\x1b[0m\n           \x1b[1m\x1b[31m\x1b[1m^\x1b[0m\n\
         \x1b[31merror\x1b[0m\x1b[2m: \x1b[0m\x1b[1mTS1110: Type expected.\x1b[0m\n    \x1b[2mat \x1b[0m\x1b[36ma.ts\x1b[0m\x1b[2m:\x1b[0m\x1b[33m1\x1b[0m\x1b[2m:\x1b[0m\x1b[33m8\x1b[0m\n",
    );
}

#[test]
fn a_chain_is_indented_and_related_information_is_a_note() {
    let files = vec![file(
        "/proj/m.ts",
        "m.ts",
        "let a: {x: number} = {x: \"s\"};\nlet b = 1;\nlet b = 2;\n",
    )];
    let chain = Diagnostic {
        file: Some(FileId(0)),
        start: 4,
        length: 1,
        category: Category::Error,
        code: Code::Ts(2322),
        text: Cow::Borrowed(b"Type '{ x: string; }' is not assignable to type '{ x: number; }'."),
        chain: vec![MessageChain {
            text: Cow::Borrowed(b"Types of property 'x' are incompatible."),
            next: vec![MessageChain {
                text: Cow::Borrowed(b"Type 'string' is not assignable to type 'number'."),
                next: Vec::new(),
            }],
        }],
        related: Vec::new(),
    };
    let mut log = Log::init();
    log.add_symbol_already_declared_error(
        files[0].source(),
        b"b",
        Loc { start: 46 },
        Loc { start: 35 },
    );
    let mut diagnostics = vec![chain];
    for msg in log.msgs.drain(..) {
        diagnostics.extend(Diagnostic::from_msg(FileId(0), msg));
    }
    let diagnostics = sort_and_deduplicate_diagnostics(&files, diagnostics);
    assert_bytes(
        &plain(&files, &diagnostics, "/proj"),
        "m.ts(1,5): error TS2322: Type '{ x: string; }' is not assignable to type '{ x: number; }'.\n  \
         Types of property 'x' are incompatible.\n    \
         Type 'string' is not assignable to type 'number'.\n\
         m.ts(3,5): error syntax: \"b\" has already been declared\n",
    );
    assert_bytes(
        &frames::<false>(&files, &diagnostics, "/proj"),
        "1 | let a: {x: number} = {x: \"s\"};\n        ^\n\
         error: TS2322: Type '{ x: string; }' is not assignable to type '{ x: number; }'.\n  \
         Types of property 'x' are incompatible.\n    \
         Type 'string' is not assignable to type 'number'.\n    at m.ts:1:5\n\
         \n\
         3 | let b = 2;\n        ^\n\
         error: syntax: \"b\" has already been declared\n    at m.ts:3:5\n\
         \n\
         2 | let b = 1;\n        ^\n\
         note: \"b\" was originally declared here\n   at m.ts:2:5\n",
    );
    assert_eq!(diagnostics[1].related.len(), 1);
    assert_eq!(
        (
            diagnostics[1].related[0].start,
            diagnostics[1].related[0].length
        ),
        (35, 1)
    );
}

#[test]
fn a_column_counts_utf16_code_units() {
    let text = "const s = \"\u{1F600}\u{e9}\"; debugger;";
    let files = vec![file("/proj/e.ts", "e.ts", text)];
    let start = 20;
    assert_eq!(text.as_bytes().get(20..), Some(&b"debugger;"[..]));
    let diagnostics = vec![rule(
        0,
        start,
        9,
        "no-debugger",
        "Unexpected 'debugger' statement.",
    )];
    assert_bytes(
        &plain(&files, &diagnostics, "/proj"),
        "e.ts(1,18): error no-debugger: Unexpected 'debugger' statement.\n",
    );
    assert_bytes(
        &frames::<false>(&files, &diagnostics, "/proj"),
        "1 | const s = \"\u{1F600}\u{e9}\"; debugger;\n                     ^\n\
         error: no-debugger: Unexpected 'debugger' statement.\n    at e.ts:1:18\n",
    );
    assert_eq!(utf16_len("a\u{1F600}\u{e9}".as_bytes()), 4);
    assert_eq!(utf16_len(b"a\xF0\x9F\x98"), 4);
    assert_eq!(utf16_len(b"\xED\xA0\x80"), 3);
}

#[test]
fn every_line_terminator_of_ecmascript_starts_a_line() {
    let text = "a\rb\r\nc\u{2028}d\u{2029}e\nf";
    let starts = compute_ecma_line_starts(text.as_bytes());
    assert_eq!(starts, vec![0, 2, 5, 9, 13, 15]);
    let at = |pos: u32| {
        let (line, character) =
            get_ecma_line_and_utf16_character_of_position(text.as_bytes(), &starts, pos);
        (line + 1, character + 1)
    };
    assert_eq!(at(0), (1, 1));
    assert_eq!(at(1), (1, 2));
    assert_eq!(at(2), (2, 1));
    assert_eq!(at(4), (2, 3));
    assert_eq!(at(5), (3, 1));
    assert_eq!(at(9), (4, 1));
    assert_eq!(at(13), (5, 1));
    assert_eq!(at(15), (6, 1));
    // The end of the text is a position, and a position behind it is taken as the end.
    assert_eq!(at(16), (6, 2));
    assert_eq!(at(1000), (6, 2));
    assert_eq!(compute_ecma_line_starts(b""), vec![0]);
    assert_eq!(compute_ecma_line_starts(b"a\n"), vec![0, 2]);
}

#[test]
fn bun_and_tsc_differ_at_the_end_of_the_file_and_after_a_lone_cr() {
    let files = vec![
        file("/proj/eof.js", "eof.js", "function f() {\n"),
        file("/proj/cr.js", "cr.js", "a\rb c"),
    ];
    let diagnostics = vec![
        rule(1, 4, 1, "x", "after a lone CR"),
        rule(0, 15, 0, "x", "end of file"),
    ];
    let diagnostics = sort_and_deduplicate_diagnostics(&files, diagnostics);
    assert_bytes(
        &plain(&files, &diagnostics, "/proj"),
        "cr.js(2,3): error x: after a lone CR\neof.js(2,1): error x: end of file\n",
    );
    assert_bytes(
        &frames::<false>(&files, &diagnostics, "/proj"),
        "2 | b c\n     ^\nerror: x: after a lone CR\n    at cr.js:2:2\n\
         \n\
         1 | function f() {\n                  ^\nerror: x: end of file\n    at eof.js:1:15\n",
    );
}

#[test]
fn an_operand_is_named_from_the_current_directory() {
    // The current directory, whether file names are case sensitive, the operand, its absolute name, its printed name.
    let cases: [(&str, bool, &str, &str, &str); 14] = [
        ("/proj", true, "a.ts", "/proj/a.ts", "a.ts"),
        ("/proj", true, "./src/../a.ts", "/proj/a.ts", "a.ts"),
        ("/proj", true, "sub/a.ts", "/proj/sub/a.ts", "sub/a.ts"),
        ("/proj", true, "../z.ts", "/z.ts", "../z.ts"),
        ("/proj", true, "/proj/a.ts", "/proj/a.ts", "a.ts"),
        ("/proj", true, "/other/z.ts", "/other/z.ts", "../other/z.ts"),
        ("/proj", true, "/Proj/a.ts", "/Proj/a.ts", "../Proj/a.ts"),
        ("/proj", false, "/Proj/a.ts", "/Proj/a.ts", "a.ts"),
        ("C:\\proj", false, "a.ts", "C:/proj/a.ts", "a.ts"),
        (
            "C:\\proj",
            false,
            "sub\\a.ts",
            "C:/proj/sub/a.ts",
            "sub/a.ts",
        ),
        ("C:\\proj", false, "..\\z.ts", "C:/z.ts", "../z.ts"),
        ("C:\\proj", false, "c:/proj/a.ts", "c:/proj/a.ts", "a.ts"),
        ("C:\\proj", false, "D:\\x\\a.ts", "D:/x/a.ts", "D:/x/a.ts"),
        (
            "C:\\proj",
            false,
            "\\\\server\\share\\a.ts",
            "//server/share/a.ts",
            "//server/share/a.ts",
        ),
    ];
    for (current_directory, use_case_sensitive_file_names, operand, absolute, printed) in cases {
        let name = get_normalized_absolute_path(operand.as_bytes(), current_directory.as_bytes());
        assert_bytes(&name, absolute);
        let options = ComparePathsOptions {
            use_case_sensitive_file_names,
            current_directory: current_directory.as_bytes(),
        };
        assert_bytes(&convert_to_relative_path(&name, options), printed);
    }
}

#[test]
fn the_order_of_the_reference() {
    let files = vec![file("/proj/a.ts", "a.ts", "0123456789")];
    let d =
        |start: u32, length: u32, code: Code, category: Category, text: &'static str| Diagnostic {
            file: Some(FileId(0)),
            start,
            length,
            category,
            code,
            text: Cow::Borrowed(text.as_bytes()),
            chain: Vec::new(),
            related: Vec::new(),
        };
    let less = |a: &Diagnostic, b: &Diagnostic| {
        compare_diagnostics(&files, a, b) == core::cmp::Ordering::Less
    };
    let e = Category::Error;
    // The end comes before the code: arithmeticOnInvalidTypes has TS2454 with the end 39 before TS2365 with the end 43.
    assert!(less(
        &d(1, 2, Code::Ts(2454), e, "x"),
        &d(1, 6, Code::Ts(2365), e, "x")
    ));
    // A code is compared as a number.
    assert!(less(
        &d(1, 2, Code::Ts(2322), e, "x"),
        &d(1, 2, Code::Ts(10000), e, "x")
    ));
    // A name is the number 0: it comes before every TypeScript number at one span.
    assert!(less(
        &d(1, 2, Code::Name("use-isnan"), e, "x"),
        &d(1, 2, Code::Ts(1005), e, "x")
    ));
    // The category comes before the name: a warning is 0, an error is 1.
    assert!(less(
        &d(1, 2, Code::Name("z-rule"), Category::Warning, "x"),
        &d(1, 2, Code::Name("a-rule"), e, "x")
    ));
    assert!(less(
        &d(1, 2, Code::Name("a-rule"), e, "x"),
        &d(1, 2, Code::Name("b-rule"), e, "x")
    ));
    assert!(less(
        &d(1, 2, Code::Ts(2322), e, "a"),
        &d(1, 2, Code::Ts(2322), e, "b")
    ));
    // A diagnostic without a file comes first.
    let mut global = d(9, 0, Code::Ts(6053), e, "x");
    global.file = None;
    assert!(less(&global, &d(0, 0, Code::Ts(1005), e, "x")));
    // More chain comes first, then more related information.
    let mut chained = d(1, 2, Code::Ts(2322), e, "a");
    chained.chain.push(MessageChain {
        text: Cow::Borrowed(b"c"),
        next: Vec::new(),
    });
    assert!(less(&chained, &d(1, 2, Code::Ts(2322), e, "a")));
    let mut related = d(1, 2, Code::Ts(2322), e, "a");
    related
        .related
        .push(d(0, 1, Code::Ts(2728), Category::Message, "r"));
    assert!(less(&related, &d(1, 2, Code::Ts(2322), e, "a")));
}

#[test]
fn a_line_break_inside_a_text_is_one_space() {
    let files = vec![file("/proj/t1.js", "t1.js", "class A { `a\nb` }\n")];
    let mut log = Log::init();
    log.add_range_error_fmt(
        Some(files[0].source()),
        Range {
            loc: Loc { start: 10 },
            len: 5,
        },
        format_args!("Expected identifier but found \"`a\nb`\""),
    );
    let mut diagnostics = Vec::new();
    for msg in log.msgs.drain(..) {
        diagnostics.extend(Diagnostic::from_msg(FileId(0), msg));
    }
    assert_bytes(
        &plain(&files, &diagnostics, "/proj"),
        "t1.js(1,11): error syntax: Expected identifier but found \"`a b`\"\n",
    );
}

#[test]
fn a_message_of_the_log_becomes_a_diagnostic() {
    let files = vec![file("/proj/a.ts", "a.ts", "let x: = 1;\n")];
    let source = files[0].source();
    let at = Range {
        loc: Loc { start: 7 },
        len: 1,
    };
    let mut log = Log::init();
    log.add_range_error_with_code(
        Some(source),
        at,
        1110,
        Cow::Borrowed(b"Type expected."),
        Box::new([range_data(
            Some(source),
            Range {
                loc: Loc { start: 4 },
                len: 1,
            },
            b"a note" as &[u8],
        )]),
    );
    log.add_range_error_fmt(Some(source), at, format_args!("Unexpected ="));
    log.add_warning(Some(source), Loc { start: 4 }, b"a warning" as &[u8]);
    log.add_error(Some(source), Loc::EMPTY, b"no position" as &[u8]);
    log.add_error(None, Loc::EMPTY, b"no file" as &[u8]);
    for kind in [Kind::Note, Kind::Debug, Kind::Verbose] {
        log.add_msg(Msg {
            kind,
            data: Data {
                text: Cow::Borrowed(b"no error"),
                location: None,
            },
            ..Default::default()
        });
    }
    let diagnostics: Vec<Diagnostic> = log
        .msgs
        .drain(..)
        .filter_map(|msg| Diagnostic::from_msg(FileId(0), msg))
        .collect();
    let key = |d: &Diagnostic| (d.file, d.start, d.length, d.category, d.code);
    let here = Some(FileId(0));
    // A message without a number is `syntax`; a debug and a verbose message are no diagnostics.
    assert_eq!(
        diagnostics.iter().map(key).collect::<Vec<_>>(),
        vec![
            (here, 7, 1, Category::Error, Code::Ts(1110)),
            (here, 7, 1, Category::Error, Code::SYNTAX),
            (here, 4, 0, Category::Warning, Code::SYNTAX),
            (here, 0, 0, Category::Error, Code::SYNTAX),
            (None, 0, 0, Category::Error, Code::SYNTAX),
            (None, 0, 0, Category::Message, Code::SYNTAX),
        ]
    );
    // A note is related information and has no number of its own.
    assert_eq!(
        diagnostics[0].related.iter().map(key).collect::<Vec<_>>(),
        vec![(here, 4, 1, Category::Message, Code::SYNTAX)]
    );
    assert_bytes(
        &plain(&files, &diagnostics, "/proj"),
        "a.ts(1,8): error TS1110: Type expected.\n\
         a.ts(1,8): error syntax: Unexpected =\n\
         a.ts(1,5): warning syntax: a warning\n\
         a.ts(1,1): error syntax: no position\n\
         error syntax: no file\n\
         message syntax: no error\n",
    );
}

#[test]
fn a_chain_is_written_in_pre_order() {
    let files = vec![file("/proj/m.ts", "m.ts", "f(a);\n")];
    let diagnostics = [Diagnostic {
        chain: vec![
            link(
                "one",
                vec![
                    link("one.one", vec![link("one.one.one", Vec::new())]),
                    link("one\r\ntwo", Vec::new()),
                ],
            ),
            link("two", Vec::new()),
        ],
        ..ts(2, 1, 2345, "top")
    }];
    assert_bytes(
        &plain(&files, &diagnostics, "/proj"),
        "m.ts(1,3): error TS2345: top\n  one\n    one.one\n      one.one.one\n    one two\n  two\n",
    );
    assert_bytes(
        &frames::<false>(&files, &diagnostics, "/proj"),
        "1 | f(a);\n      ^\n\
         error: TS2345: top\n  one\n    one.one\n      one.one.one\n    one two\n  two\n    at m.ts:1:3\n",
    );
}

#[test]
fn a_chain_takes_part_in_the_order_and_in_what_is_equal() {
    let files = vec![file("/proj/m.ts", "m.ts", "x;\n")];
    let with = |chain: Vec<MessageChain>| Diagnostic {
        chain,
        ..ts(0, 1, 2322, "t")
    };
    let under_x = |next: Vec<MessageChain>| vec![link("x", next)];
    let p = || link("p", Vec::new());
    let q = || link("q", Vec::new());
    let diagnostics = sort_and_deduplicate_diagnostics(
        &files,
        vec![
            with(Vec::new()),
            with(under_x(vec![q()])),
            with(under_x(vec![p()])),
            with(under_x(vec![p(), q()])),
            with(under_x(vec![p()])),
            with(vec![link("x", Vec::new()), link("y", Vec::new())]),
        ],
    );
    // More of a chain comes first, level by level; then its texts decide; two equal chains are one diagnostic.
    assert_bytes(
        &plain(&files, &diagnostics, "/proj"),
        "m.ts(1,1): error TS2322: t\n  x\n  y\n\
         m.ts(1,1): error TS2322: t\n  x\n    p\n    q\n\
         m.ts(1,1): error TS2322: t\n  x\n    p\n\
         m.ts(1,1): error TS2322: t\n  x\n    q\n\
         m.ts(1,1): error TS2322: t\n",
    );
}

#[test]
fn related_information_can_be_in_another_file() {
    let files = vec![
        file("/proj/use.ts", "use.ts", "f(1);\n"),
        file(
            "/proj/lib/decl.ts",
            "lib/decl.ts",
            "\ndeclare function f(): void;\n",
        ),
    ];
    let diagnostics = [Diagnostic {
        related: vec![Diagnostic {
            file: Some(FileId(1)),
            category: Category::Message,
            ..ts(18, 1, 2728, "'f' is declared here.")
        }],
        ..ts(2, 1, 2554, "Expected 0 arguments, but got 1.")
    }];
    // The plain format has no related information, as the plain format of tsc has none.
    assert_bytes(
        &plain(&files, &diagnostics, "/proj"),
        "use.ts(1,3): error TS2554: Expected 0 arguments, but got 1.\n",
    );
    assert_bytes(
        &frames::<false>(&files, &diagnostics, "/proj"),
        "1 | f(1);\n      ^\n\
         error: TS2554: Expected 0 arguments, but got 1.\n    at use.ts:1:3\n\
         \n\
         2 | declare function f(): void;\n                     ^\n\
         note: 'f' is declared here.\n   at lib/decl.ts:2:18\n",
    );
}

#[test]
fn the_four_categories() {
    let files = vec![file("/proj/a.ts", "a.ts", "x;\n")];
    let of = |category: Category| Diagnostic {
        category,
        ..rule(0, 0, 1, "r", "t")
    };
    let diagnostics = sort_and_deduplicate_diagnostics(
        &files,
        vec![
            of(Category::Message),
            of(Category::Suggestion),
            of(Category::Error),
            of(Category::Warning),
        ],
    );
    assert_bytes(
        &plain(&files, &diagnostics, "/proj"),
        "a.ts(1,1): warning r: t\n\
         a.ts(1,1): error r: t\n\
         a.ts(1,1): suggestion r: t\n\
         a.ts(1,1): message r: t\n",
    );
    // A frame has three kinds: a suggestion and a message are both a note.
    assert_bytes(
        &frames::<false>(&files, &diagnostics, "/proj"),
        "1 | x;\n    ^\nwarn: r: t\n   at a.ts:1:1\n\
         \n\
         1 | x;\n    ^\nerror: r: t\n    at a.ts:1:1\n\
         \n\
         1 | x;\n    ^\nnote: r: t\n   at a.ts:1:1\n\
         \n\
         1 | x;\n    ^\nnote: r: t\n   at a.ts:1:1\n",
    );
}
