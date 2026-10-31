mod support;
use support::*;

use Binding::Symbol;

const FILE_SCOPE: ScopeId = ScopeId(0);

const CLASS_EXPRESSION_DECORATORS: &[&str] = &[
    r#"const D = @(eval("d")) class C {};"#,
    r#"const D = @(eval("d")) class {};"#,
];

fn function_scope(s: &Analyzed<'_>, kind: FnKind) -> ScopeId {
    let index = s.hir.fns.iter().position(|func| func.kind == kind).unwrap();
    s.bound.fns[index].scope
}

fn only_eval_scope(s: &Analyzed<'_>) -> EvalScope {
    let [(_, scope)] = s.bound.runtime.eval_scopes()[..] else {
        panic!("{:?}", s.bound.runtime.eval_scopes());
    };
    scope
}

#[test]
fn class_is_strict_in_sloppy_file() {
    analyzed(
        "a.cjs",
        "function f() { { let a; } } class C { m() {} }",
        |s| {
            assert!(!s.bound.is_strict_scope(FILE_SCOPE));
            assert!(!s.bound.is_strict_scope(function_scope(s, FnKind::Decl)));
            assert!(
                !s.bound
                    .is_strict_scope(s.bound.symbol_scope(s.variable("a", 0)))
            );
            assert!(
                s.bound
                    .is_strict_scope(s.bound.class_scope[s.class("C").idx()])
            );
            assert!(s.bound.is_strict_scope(function_scope(s, FnKind::Method)));
        },
    );
}

#[test]
fn file_directive_makes_every_scope_strict() {
    analyzed(
        "a.cjs",
        r#""use strict"; function f() { { let a; } }"#,
        |s| {
            for scope in (0..s.bound.scopes.len() as u32).map(ScopeId) {
                assert!(s.bound.is_strict_scope(scope), "{scope:?}");
            }
        },
    );
}

#[test]
fn function_directive_makes_no_scope_strict() {
    analyzed(
        "a.cjs",
        r#"function f() { "use strict"; { let a; } }"#,
        |s| {
            for scope in (0..s.bound.scopes.len() as u32).map(ScopeId) {
                assert!(!s.bound.is_strict_scope(scope), "{scope:?}");
            }
        },
    );
}

#[test]
fn module_without_module_syntax_is_strict() {
    analyzed("a.mjs", "function f() { { let a; } }", |s| {
        assert!(!s.hir.is_strict_by_syntax);
        for scope in (0..s.bound.scopes.len() as u32).map(ScopeId) {
            assert!(s.bound.is_strict_scope(scope), "{scope:?}");
        }
    });
}

#[test]
fn class_expression_decorators_run_outside_class() {
    for &text in CLASS_EXPRESSION_DECORATORS {
        analyzed("a.cts", text, |s| {
            let eval = only_eval_scope(s);
            let kind = s.bound.scopes[eval.scope.idx()].kind;
            assert_eq!(kind, ScopeKind::ClassDecorators(ClassId(0)), "{text}");
            assert_eq!(
                s.bound.scopes[eval.scope.idx()].parent,
                s.bound.class_scope[0],
                "{text}"
            );
            assert_eq!(
                s.bound.runtime_parent_scope(&s.hir, eval.scope),
                FILE_SCOPE,
                "{text}"
            );
            assert_eq!(s.bound.code_unit(eval.scope), CodeUnit::File, "{text}");
            assert!(eval.is_sloppy, "{text}");
            assert!(!s.bound.is_strict_scope(eval.scope), "{text}");
        });
    }
}

#[test]
fn class_declaration_decorators_run_outside_class() {
    analyzed("a.cts", r#"@(eval("d")) class C {}"#, |s| {
        let eval = only_eval_scope(s);
        assert_eq!(eval.scope, FILE_SCOPE);
        assert!(eval.is_sloppy);
    });
}

#[test]
fn member_decorators_run_inside_class() {
    analyzed(
        "a.cts",
        r#"const D = class C { @(eval("d")) m() {} };"#,
        |s| {
            let eval = only_eval_scope(s);
            assert!(!eval.is_sloppy);
            assert!(s.bound.is_strict_scope(eval.scope));
        },
    );
}

#[test]
fn runtime_parent_of_other_scopes_is_parent() {
    analyzed(
        "a.cjs",
        "with (o) { class C { f = 1; m() { { let a; } } } }",
        |s| {
            for (scope, data) in (0..).map(ScopeId).zip(s.bound.scopes.iter()) {
                assert_eq!(
                    s.bound.runtime_parent_scope(&s.hir, scope),
                    data.parent,
                    "{scope:?}"
                );
            }
        },
    );
}

#[test]
fn implicit_block_symbol_is_visible_from_parameters() {
    analyzed(
        "a.cjs",
        "if (a) function f(x = f) { { function f() {} } f; }",
        |s| {
            let outer = s
                .hir
                .fns
                .iter()
                .position(|func| !func.params.is_empty())
                .unwrap();
            let outer = FnId(outer as u32);
            let [(function, block_symbol)] = s.implicit_block_symbols()[..] else {
                panic!("{:?}", s.implicit_block_symbols());
            };
            assert_eq!(function, outer);
            assert!(s.bound.is_appended_symbol(block_symbol));
            assert_eq!(s.binding("f", 0), Symbol(block_symbol));
            let hoists = s.bound.runtime.annex_b_functions();
            let inner = hoists.iter().find(|hoist| hoist.function != outer).unwrap();
            assert_ne!(inner.var_symbol, block_symbol);
            assert_eq!(s.binding("f", 1), Symbol(inner.var_symbol));
        },
    );
}

fn function_statement(s: &Analyzed<'_>, function: FnId) -> StmtId {
    find_stmts(
        &s.hir,
        |kind| matches!(kind, StmtKind::Fn(declared) if *declared == function),
    )[0]
}

#[test]
fn implicit_block_is_a_scope_around_the_function() {
    analyzed(
        "a.cjs",
        "function g(a) { if (a) function f() { f = 1; return f; } }",
        |s| {
            let function = s.function("f");
            let statement = function_statement(s, function);
            let block = s.bound.own_scope(statement);
            let block_symbol = s.bound.declared_symbol(Decl::Fn(function));
            assert_eq!(
                s.bound.scopes[block.idx()].kind,
                ScopeKind::ImplicitBlock(function)
            );
            assert_eq!(
                s.bound.scopes[s.bound.fns[function.idx()].scope.idx()].parent,
                block
            );
            assert_eq!(
                s.bound.scopes[block.idx()].parent,
                s.bound.scope_of_stmt(statement)
            );
            assert_eq!(
                s.bound.code_unit(block),
                CodeUnit::Function(s.function("g"))
            );
            assert_eq!(s.bound.symbol_scope(block_symbol), block);
            assert!(s.bound.is_appended_symbol(block_symbol));
            assert_eq!(s.binding("f", 0), Symbol(block_symbol));
            assert_eq!(s.binding("f", 1), Symbol(block_symbol));
            assert_eq!(s.bound.stores_to(block_symbol).len(), 1);
            assert_eq!(
                s.bound.binding_stability(block_symbol),
                BindingStability::Stored
            );
            assert_eq!(
                s.bound.initial_state(block_symbol),
                InitialState::Initialized
            );
        },
    );
    analyzed(
        "a.cjs",
        "function g(a) { if (a) function f() { return f; } }",
        |s| {
            let block_symbol = s.bound.declared_symbol(Decl::Fn(s.function("f")));
            assert_eq!(
                s.bound.binding_stability(block_symbol),
                BindingStability::Stable
            );
        },
    );
    for text in [
        "function f() {}",
        "{ function f() {} }",
        "label: function f() {}",
    ] {
        analyzed("a.cjs", text, |s| {
            let statement = function_statement(s, s.function("f"));
            assert_eq!(s.bound.own_scope(statement), ScopeId::NONE, "{text}");
        });
    }
}

#[test]
fn each_clause_has_its_implicit_block() {
    let text = "if (a) function f() {} else function g() {} if (b) function h() {}";
    analyzed("a.cjs", text, |s| {
        let functions = ["f", "g", "h"].map(|name| s.function(name));
        let blocks = s.implicit_block_symbols();
        assert_eq!(
            blocks.iter().map(|block| block.0).collect::<Vec<FnId>>(),
            functions
        );
        for (function, symbol) in blocks {
            let scope = s.bound.symbol_scope(symbol);
            assert_eq!(
                s.bound.scopes[scope.idx()].kind,
                ScopeKind::ImplicitBlock(function)
            );
        }
    });
}

#[test]
fn block_function_has_no_implicit_block_symbol() {
    for text in [
        "{ function f() {} }",
        "function f() {}",
        "label: function f() {}",
    ] {
        analyzed("a.cjs", text, |s| {
            assert_eq!(s.implicit_block_symbols(), [], "{text}");
        });
    }
}

#[test]
fn hoisted_require_initializes_catch_parameter() {
    analyzed(
        "a.cjs",
        r#"try {} catch (e) { var e = require("m"); e; } e;"#,
        |s| {
            let (parameter, variable) = (s.variable("e", 0), s.variable("e", 1));
            assert_ne!(parameter, variable);
            assert_eq!(
                s.bound.initialized_binding(s.pat("e", 1)),
                Symbol(parameter)
            );
            assert_eq!(s.binding("e", 0), Symbol(parameter));
            assert_eq!(s.binding("e", 1), Symbol(variable));
        },
    );
    analyzed("a.cjs", r#"{ var e = require("m"); }"#, |s| {
        assert_eq!(
            s.bound.initialized_binding(s.pat("e", 0)),
            Symbol(s.variable("e", 0))
        );
    });
}

#[test]
fn function_class_is_class_of_member() {
    analyzed(
        "a.ts",
        "class C { m() {} } function f() {} interface I { n(): void }",
        |s| {
            let functions = (0..s.hir.fns.len() as u32).map(FnId);
            let classes: Vec<ClassId> = functions
                .filter_map(|f| s.bound.function_class(f))
                .collect();
            assert_eq!(classes, [s.class("C")]);
        },
    );
}
