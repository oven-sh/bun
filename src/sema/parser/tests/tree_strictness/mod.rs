use crate::tree_support::*;
use crate::{
    DEFAULT_PATH, TYPEDEF_BEFORE_DIRECTIVE, TextKind, atom_of, only_stmt, parsed, parsed_source,
};

use FunctionName::{Anonymous, Named};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum FunctionName<'a> {
    Named(&'a str),
    Anonymous(FnKind),
}

const FUNCTION_WITH_DIRECTIVE: &str = r#"function f() { "use strict"; }"#;
const ESCAPED_DIRECTIVE: &str = r"'use\x20strict';";
const STATIC_BLOCK: &str = r#"class A { static { "use strict"; } }"#;

const DIRECTIVE_PROLOGUES: &[(&str, &[&str], bool)] = &[
    (r#""use strict"; "b"; c; "d";"#, &["use strict", "b"], true),
    (r#""a"; 'use strict';"#, &["a", "use strict"], true),
    (FUNCTION_WITH_DIRECTIVE, &["use strict"], false),
    (ESCAPED_DIRECTIVE, &[r"use\x20strict"], false),
];

const STRINGS_OUTSIDE_PROLOGUES: &[(&str, &str)] = &[
    (DEFAULT_PATH, r#"("use strict");"#),
    (DEFAULT_PATH, "`use strict`;"),
    (DEFAULT_PATH, r#""use strict" + 1;"#),
    (DEFAULT_PATH, r#""use strict".length;"#),
    (DEFAULT_PATH, r#"x; "use strict";"#),
    (DEFAULT_PATH, r#"{ "use strict"; }"#),
    ("a.ts", r#"namespace N { "use strict"; }"#),
    ("a.ts", r#"namespace N { a b } "use strict";"#),
    (
        "a.ts",
        r#"namespace N { interface I {} namespace M { static x } } "use strict";"#,
    ),
    (
        "a.ts",
        r#"function f() { namespace N { a b } "use strict"; }"#,
    ),
];

const STRICTNESS: &[(&str, &str, bool, &[FunctionName<'static>])] = &[
    (
        "a.js",
        "function before() {} export {};",
        true,
        &[Named("before")],
    ),
    (
        "a.js",
        r#"import "m"; function g() {}"#,
        true,
        &[Named("g")],
    ),
    ("a.ts", r#"import x from "m"; function g() {}"#, false, &[]),
    (
        DEFAULT_PATH,
        "class A { m() {} } function after() {}",
        false,
        &[Named("m")],
    ),
    (
        DEFAULT_PATH,
        r#""use strict"; function s() { "use strict"; }"#,
        true,
        &[Named("s")],
    ),
    (
        DEFAULT_PATH,
        r#"class A { m() { "use strict"; } } function after() {}"#,
        false,
        &[Named("m")],
    ),
    ("a.ts", "declare function d(): void;", false, &[]),
];

const FUNCTION_DIRECTIVES: &[(&str, &[FunctionName<'static>], &[FunctionName<'static>])] = &[
    (FUNCTION_WITH_DIRECTIVE, &[Named("f")], &[]),
    (
        r#"function s() { "use strict"; const a = () => 1; function n() {} } function after() {}"#,
        &[Anonymous(FnKind::Arrow), Named("n"), Named("s")],
        &[],
    ),
    (
        r#"function s() { "use strict"; class A { m() {} } function n() {} }"#,
        &[Named("m"), Named("n"), Named("s")],
        &[Named("m")],
    ),
    (
        r#"function outer() { const s = () => { "use strict"; }; }"#,
        &[Anonymous(FnKind::Arrow)],
        &[],
    ),
];

fn with_option<'a>(path: &'a str, text: &'a str, keeps_function_directives: bool) -> Source<'a> {
    Source {
        keeps_function_directives,
        ..Source::new(path, text)
    }
}

fn directives(w: &Workspace<'_>, hir: &File<'_>) -> Vec<String> {
    let raw_text = |stmt: &Stmt| {
        let StmtKind::Directive { raw, .. } = stmt.kind else {
            return None;
        };
        Some(w.text(raw).to_owned())
    };
    hir.stmts.iter().filter_map(raw_text).collect()
}

fn function_name<'a>(w: &'a Workspace<'_>, func: &Func) -> FunctionName<'a> {
    match func.name.is_some() {
        true => Named(w.text(func.name)),
        false => Anonymous(func.kind),
    }
}

fn strict_functions<'a>(w: &'a Workspace<'_>, hir: &File<'_>) -> Vec<FunctionName<'a>> {
    let strict = hir.fns.iter().filter(|func| func.is_strict_by_syntax);
    let mut names: Vec<_> = strict.map(|func| function_name(w, func)).collect();
    names.sort_unstable_by_key(|name| match *name {
        Named(text) => Some(text),
        Anonymous(_) => None,
    });
    names
}

#[test]
fn directive_prologues() {
    for &(text, raws, is_strict) in DIRECTIVE_PROLOGUES {
        for keeps_function_directives in [true, false] {
            let source = with_option(DEFAULT_PATH, text, keeps_function_directives);
            parsed_source(&source, |w, hir| {
                assert_eq!(directives(w, hir), raws, "{text}");
                assert_eq!(hir.is_strict_by_syntax, is_strict, "{text}");
            });
        }
    }
    parsed(DEFAULT_PATH, ESCAPED_DIRECTIVE, |_, hir| {
        let directive = only_stmt(hir, |kind| matches!(kind, StmtKind::Directive { .. }));
        let StmtKind::Directive { expr, raw } = hir[directive].kind else {
            unreachable!()
        };
        assert_ne!(raw, known::use_strict);
        let cooked = atom_of(&hir[expr].kind, TextKind::String);
        assert_eq!(cooked, Some(known::use_strict));
    });
    parsed("a.js", TYPEDEF_BEFORE_DIRECTIVE, |w, hir| {
        assert_eq!(directives(w, hir), ["use strict"]);
        assert!(hir.is_strict_by_syntax);
        assert_eq!(strict_functions(w, hir), [Named("f")]);
    });
}

#[test]
fn strings_outside_prologues() {
    for &(path, text) in STRINGS_OUTSIDE_PROLOGUES {
        for keeps_function_directives in [true, false] {
            parsed_source(
                &with_option(path, text, keeps_function_directives),
                |w, hir| {
                    assert!(directives(w, hir).is_empty(), "{text}");
                    assert!(!hir.is_strict_by_syntax, "{text}");
                    assert!(strict_functions(w, hir).is_empty(), "{text}");
                },
            );
        }
    }
    parsed(DEFAULT_PATH, STATIC_BLOCK, |w, hir| {
        assert!(directives(w, hir).is_empty());
        assert!(!hir.is_strict_by_syntax);
        assert_eq!(strict_functions(w, hir), [Anonymous(FnKind::StaticBlock)]);
    });
}

#[test]
fn strictness_by_syntax() {
    for &(path, text, is_file_strict, functions) in STRICTNESS {
        for keeps_function_directives in [true, false] {
            parsed_source(
                &with_option(path, text, keeps_function_directives),
                |w, hir| {
                    assert_eq!(hir.is_strict_by_syntax, is_file_strict, "{text}");
                    assert_eq!(strict_functions(w, hir), functions, "{text}");
                },
            );
        }
    }
}

#[test]
fn function_directive_counts_only_where_kept() {
    for &(text, kept, dropped) in FUNCTION_DIRECTIVES {
        for (keeps_function_directives, functions) in [(true, kept), (false, dropped)] {
            let source = with_option(DEFAULT_PATH, text, keeps_function_directives);
            parsed_source(&source, |w, hir| {
                assert!(!hir.is_strict_by_syntax, "{text}");
                assert_eq!(strict_functions(w, hir), functions, "{text}");
                assert_eq!(directives(w, hir), ["use strict"], "{text}");
                let is_kept = hir.rare_syntax & rare::DIRECTIVE_IN_FUNCTION != 0;
                assert_eq!(is_kept, keeps_function_directives, "{text}");
                let is_dropped = hir.rare_syntax & rare::DROPPED_STRICT_DIRECTIVE != 0;
                assert_eq!(is_dropped, !keeps_function_directives, "{text}");
            });
        }
    }
}
