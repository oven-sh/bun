use crate::support::*;
use crate::{analyzed_hoist, import_spec, info, parameter};

use Binding::Symbol;

const IMPLICIT_BLOCK_FUNCTIONS: &[(&str, usize)] = &[
    ("if (a) function f() {} var f = 1; f;", 1),
    ("var f = 1; if (a) function f() {} f;", 1),
    (
        "function g() { if (a) function f() {} for (var f = 0; ; ) f; }",
        1,
    ),
    ("if (a) function f() {} let f = 1; f;", 0),
    ("let f = 1; if (a) function f() {} f;", 0),
    ("{ if (a) function f() {} let f = 1; f; }", 0),
];

const REQUIRE_SCOPES: &[(&str, &[usize])] = &[
    (
        r#"const a = 1; function g(k) { if (k) { const a = require("a"); a; } a; }"#,
        &[1, 0],
    ),
    (
        r#"function g(k) { if (k) { const a = require("a"); a; } else { const a = require("b"); a; } }"#,
        &[0, 1],
    ),
    (r#"var a; { const { a } = require("a"); a; } a;"#, &[1, 0]),
    (r#"for (const a = require("a"); ; ) a;"#, &[0]),
    (r#"function g() { const a = require("a"); { a; } }"#, &[0]),
];

const IMPORT_EQUALS_USES: &[&str] = &[
    r#"import a = require("m"); a;"#,
    r#"export import a = require("m"); a;"#,
    "namespace N { export const b = 1 } import a = N.b; a;",
    "namespace N { export const b = 1 } export import a = N.b; a;",
];

fn import_equals(s: &Analyzed<'_>, index: u32) -> SymbolId {
    s.bound
        .declared_symbol(Decl::ImportEquals(ImportEqualsId(index)))
}

#[test]
fn implicit_block_functions() {
    for &(text, hoist_count) in IMPLICIT_BLOCK_FUNCTIONS {
        analyzed("a.cjs", text, |s| {
            let variable = s.variable("f", 0);
            let hoists = s.bound.runtime.annex_b_functions();
            assert_eq!(hoists.len(), hoist_count, "{text}");
            assert!(
                hoists.iter().all(|hoist| hoist.var_symbol == variable),
                "{text}"
            );
            assert_eq!(s.binding("f", 0), Symbol(variable), "{text}");
        });
    }
}

#[test]
fn implicit_block_function_with_inner_variable() {
    analyzed(
        "a.cjs",
        "if (a) function f() { f; { function f() {} } }",
        |s| {
            let [first, second] = s.bound.runtime.annex_b_functions()[..] else {
                panic!("{:?}", s.bound.runtime.annex_b_functions());
            };
            let is_first_outer = s.bound.symbol_scope(first.var_symbol) == ScopeId(0);
            let (outer, inner) = if is_first_outer {
                (first, second)
            } else {
                (second, first)
            };
            let inner_scope = s.bound.symbol_scope(inner.var_symbol);
            assert_eq!(inner_scope, info(s, outer.function).scope);
            assert_ne!(inner.var_symbol, outer.block_symbol);
            assert_eq!(s.binding("f", 0), Symbol(inner.var_symbol));
        },
    );
}

#[test]
fn require_scopes() {
    for &(text, patterns) in REQUIRE_SCOPES {
        analyzed("a.cjs", text, |s| {
            for (ident, &pattern) in patterns.iter().enumerate() {
                let expected = Symbol(s.variable("a", pattern));
                assert_eq!(s.binding("a", ident), expected, "{text}: {ident}");
            }
        });
    }
    analyzed(
        "a.cjs",
        r#"function g() { { const a = require("a"); } }"#,
        |s| {
            let scope = s.bound.symbol_scope(s.variable("a", 0));
            assert_eq!(s.bound.scopes[scope.idx()].kind, ScopeKind::Block);
        },
    );
    analyzed(
        "a.cjs",
        r#"function g() { const a = require("a"); }"#,
        |s| {
            assert!(!s.bound.is_appended_symbol(s.variable("a", 0)));
        },
    );
    let text = r#"function g() { { const f = require("x"); } { function f() {} } return f; }"#;
    analyzed_hoist(text, |s, hoist| {
        assert_eq!(s.binding("f", 0), Symbol(hoist.var_symbol));
    });
}

#[test]
fn replaced_imports() {
    analyzed(
        "a.ts",
        r#"import { A } from "m"; export const A = 1; A;"#,
        |s| {
            assert_eq!(import_spec(s, 0), SymbolId::NONE);
            assert_eq!(s.binding("A", 0), Symbol(s.variable("A", 0)));
        },
    );
    analyzed("a.ts", r#"import { A } from "m"; interface A {} A;"#, |s| {
        assert_eq!(s.binding("A", 0), Symbol(import_spec(s, 0)));
    });
}

#[test]
fn import_equals_symbols() {
    for &text in IMPORT_EQUALS_USES {
        analyzed("a.ts", text, |s| {
            let alias = import_equals(s, 0);
            assert!(alias.is_some(), "{text}");
            assert_eq!(s.binding("a", 0), Symbol(alias), "{text}");
            assert!(s.bound.has_runtime_value(alias), "{text}");
        });
    }
    analyzed("a.ts", r#"import type a = require("m");"#, |s| {
        let alias = import_equals(s, 0);
        assert!(alias.is_some());
        assert!(!s.bound.has_runtime_value(alias));
    });
}

#[test]
fn appended_symbol_range() {
    analyzed_hoist("{ function f() {} } f;", |s, _| {
        let end = s.bound.symbols.len() as u32;
        assert!(s.bound.is_appended_symbol(SymbolId(end - 1)));
        assert!(!s.bound.is_appended_symbol(SymbolId(end)));
    });
    analyzed("a.cjs", "let a;", |s| {
        let end = s.bound.symbols.len() as u32;
        assert!(!s.bound.is_appended_symbol(SymbolId(end - 1)));
        assert!(!s.bound.is_appended_symbol(SymbolId(end)));
    });
}

#[test]
fn this_parameter() {
    analyzed("a.ts", "function f(this: Window, a: number) {}", |s| {
        assert!(!s.bound.has_runtime_value(parameter(s, "this", 0)));
        assert!(s.bound.has_runtime_value(parameter(s, "a", 0)));
    });
}
