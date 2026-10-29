mod support;
use support::*;

use Binding::{Free, Symbol};

const STRICT_LABELED_FUNCTIONS: &[&str] = &[
    "class C { m() { label: function f() {} f; } }",
    "class C { m() { outer: inner: function f() {} f; } }",
    "class C { m() { { label: function f() {} f; } } }",
    r#""use strict"; function g() { label: function f() {} f; }"#,
    r#""use strict"; label: function f() {} f;"#,
];

const SLOPPY_LABELED_FUNCTIONS: &[&str] = &[
    "label: function f() {} f;",
    "function g() { label: function f() {} f; }",
    "function g() { outer: inner: function f() {} f; }",
    r#"function g() { "use strict"; label: function f() {} f; }"#,
];

fn only_implicit_block_symbol(s: &Analyzed<'_>) -> SymbolId {
    let [(function, symbol)] = s.implicit_block_symbols()[..] else {
        panic!("{:?}", s.implicit_block_symbols());
    };
    assert_eq!(function, s.function("f"));
    assert!(s.bound.is_appended_symbol(symbol));
    symbol
}

#[test]
fn strict_labeled_function_ends_with_statement() {
    for &text in STRICT_LABELED_FUNCTIONS {
        analyzed("a.cjs", text, |s| {
            let symbol = only_implicit_block_symbol(s);
            assert_eq!(
                s.bound.binding_kind(symbol),
                BindingKind::Function,
                "{text}"
            );
            assert_eq!(s.binding("f", 0), Free, "{text}");
            assert!(s.bound.runtime.annex_b_functions().is_empty(), "{text}");
        });
    }
}

#[test]
fn strict_labeled_function_sees_own_name() {
    analyzed(
        "a.cjs",
        "class C { m() { label: function f() { f; } } }",
        |s| {
            assert_eq!(s.binding("f", 0), Symbol(only_implicit_block_symbol(s)));
        },
    );
}

#[test]
fn strict_labeled_function_leaves_outer_binding() {
    let text = "class C { m() { const f = 1; label: function f() {} f; } }";
    analyzed("a.cjs", text, |s| {
        only_implicit_block_symbol(s);
        assert_eq!(s.binding("f", 0), Symbol(s.variable("f", 0)));
        assert!(s.bound.runtime.early_redeclarations().is_empty());
    });
}

#[test]
fn sloppy_labeled_function_is_hoisted() {
    for &text in SLOPPY_LABELED_FUNCTIONS {
        analyzed("a.cjs", text, |s| {
            assert!(s.implicit_block_symbols().is_empty(), "{text}");
            let declared = s.bound.declared_symbol(Decl::Fn(s.function("f")));
            assert_eq!(s.binding("f", 0), Symbol(declared), "{text}");
        });
    }
}

#[test]
fn module_goal_rebinds_labeled_function() {
    analyzed("a.mjs", "label: function f() {} f;", |s| {
        assert!(!s.hir.is_strict_by_syntax);
        only_implicit_block_symbol(s);
        assert_eq!(s.binding("f", 0), Free);
    });
}
