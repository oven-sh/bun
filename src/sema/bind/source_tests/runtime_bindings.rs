mod runtime_binding_cases;
mod runtime_declarations;
mod support;
use runtime_binding_cases::*;
use support::*;

use Binding::{Arguments, Free, Symbol};
use ImplicitReferenceKind::{JsxFactory, JsxFragment};
use StoreKind::{Assign, Destructure, Update};

fn parameter(s: &Analyzed<'_>, name: &str, nth: usize) -> SymbolId {
    s.bound.declared_symbol(Decl::Param(s.pat(name, nth)))
}

fn function_symbol(s: &Analyzed<'_>, name: &str) -> SymbolId {
    s.bound.declared_symbol(Decl::Fn(s.function(name)))
}

fn top_level(s: &Analyzed<'_>, name: &str) -> SymbolId {
    s.bound
        .lookup(s.bound.scopes[0].locals, s.workspace.atom(name))
        .unwrap()
}

fn exported(s: &Analyzed<'_>, name: Atom) -> SymbolId {
    let exports = s.bound.symbol(s.bound.file_symbol).exports;
    s.bound.lookup(exports, name).unwrap()
}

fn info<'a>(s: &'a Analyzed<'_>, f: FnId) -> &'a FnInfo {
    &s.bound.fns[f.idx()]
}

fn uses_arguments(s: &Analyzed<'_>, f: FnId) -> bool {
    s.bound
        .function_flags(f)
        .contains(FunctionFlags::USES_ARGUMENTS)
}

fn has_direct_eval(s: &Analyzed<'_>, f: FnId) -> bool {
    s.bound
        .function_flags(f)
        .contains(FunctionFlags::HAS_DIRECT_EVAL)
}

fn early<'a>(s: &'a Analyzed<'_>) -> &'a [EarlyRedeclaration] {
    s.bound.runtime.early_redeclarations()
}

fn store_kinds(s: &Analyzed<'_>, symbol: SymbolId) -> Vec<StoreKind> {
    s.bound
        .stores_to(symbol)
        .iter()
        .map(|store| store.kind)
        .collect()
}

fn first_function(s: &Analyzed<'_>, kind: FnKind) -> FnId {
    let index = s.hir.fns.iter().position(|func| func.kind == kind).unwrap();
    FnId(index as u32)
}

fn arrow(s: &Analyzed<'_>) -> FnId {
    first_function(s, FnKind::Arrow)
}

fn inner_and_outer(s: &Analyzed<'_>) -> (SymbolId, SymbolId) {
    let class = s.class("C");
    (
        s.bound.inner_class_symbol(class),
        s.bound.class_symbol[class.idx()],
    )
}

fn first_stmt(s: &Analyzed<'_>, test: impl Fn(&StmtKind) -> bool) -> StmtId {
    find_stmts(&s.hir, test)[0]
}

fn calls(s: &Analyzed<'_>) -> Vec<ExprId> {
    find_exprs(&s.hir, |kind| {
        matches!(kind, ExprKind::Call(_) | ExprKind::New(_))
    })
}

fn jsx(s: &Analyzed<'_>) -> ExprId {
    find_exprs(&s.hir, |kind| matches!(kind, ExprKind::Jsx(_)))[0]
}

fn labeled(s: &Analyzed<'_>, name: &str) -> StmtId {
    let name = s.workspace.atom(name);
    first_stmt(
        s,
        |kind| matches!(kind, StmtKind::Labeled { label, .. } if *label == name),
    )
}

fn resolved_jumps(s: &Analyzed<'_>) -> Vec<Option<StmtId>> {
    find_stmts(&s.hir, |kind| {
        matches!(kind, StmtKind::Break(_) | StmtKind::Continue(_))
    })
    .into_iter()
    .map(|jump| s.bound.jump_target(jump))
    .collect()
}

fn import_spec(s: &Analyzed<'_>, index: u32) -> SymbolId {
    s.bound
        .declared_symbol(Decl::ImportSpec(ImportSpecId(index)))
}

fn is_unused(s: &Analyzed<'_>, symbol: SymbolId) -> bool {
    s.analysis.unused_import_symbols.contains(&symbol)
}

fn position(list: &[SymbolId], symbol: SymbolId) -> usize {
    list.iter().position(|&entry| entry == symbol).unwrap()
}

fn eval_symbols(s: &Analyzed<'_>) -> Vec<SymbolId> {
    s.bound
        .ids(s.bound.runtime.eval_scopes()[0].1.symbols)
        .collect()
}

fn analyzed_classic_jsx(text: &str, test: impl for<'s> FnOnce(&Analyzed<'s>) + Send) {
    with_workspace(|w| {
        let react = Some(w.atom("React"));
        let runtime = RuntimeBindOptions {
            jsx_factory_root: react,
            jsx_fragment_root: react,
            ..Default::default()
        };
        let source = Source {
            runtime,
            ..Source::new("a.tsx", text)
        };
        test(&w.analyze(&source));
    });
}

fn analyzed_hoist(text: &str, test: impl for<'s> FnOnce(&Analyzed<'s>, AnnexBFunction) + Send) {
    analyzed("a.cjs", text, |s| {
        let hoists = s.bound.runtime.annex_b_functions();
        assert_eq!(hoists.len(), 1, "{text}");
        test(s, hoists[0]);
    });
}

#[test]
fn merged_redeclarations() {
    analyzed("a.cjs", "var f = 1; function f() {} f;", |s| {
        let f = function_symbol(s, "f");
        assert_eq!(s.variable("f", 0), f);
        assert_eq!(s.binding("f", 0), Symbol(f));
        assert!(early(s).is_empty());
        assert!(!s.bound.is_early_error_redeclaration(0));
    });
    analyzed(
        "a.cjs",
        "function g(a) { function a() {} return a; }",
        |s| {
            assert_eq!(parameter(s, "a", 0), function_symbol(s, "a"));
            assert_eq!(s.binding("a", 0), Symbol(parameter(s, "a", 0)));
        },
    );
    analyzed("a.cjs", "function h(a, a) { return a; }", |s| {
        assert_eq!(parameter(s, "a", 0), parameter(s, "a", 1));
    });
}

#[test]
fn import_beside_a_jsdoc_tag_of_the_same_name_is_the_binding() {
    const TAG: &str = r#"/** @import { a } from "m" */"#;
    const IMPORT: &str = r#"import { a } from "m";"#;
    for text in [
        format!("{TAG}\n{IMPORT}\na;"),
        format!("{IMPORT}\n{TAG}\na;"),
    ] {
        analyzed("a.mjs", &text, |s| {
            let Symbol(bound_to) = s.binding("a", 0) else {
                panic!("{text}: {:?}", s.binding("a", 0));
            };
            assert_eq!(
                s.bound.binding_kind(bound_to),
                BindingKind::Import,
                "{text}"
            );
            assert!(early(s).is_empty(), "{text}");
        });
    }
    analyzed("a.mjs", &format!("{TAG}\na;"), |s| {
        assert_eq!(s.binding("a", 0), Free)
    });
}

#[test]
fn separate_declarations() {
    analyzed("a.cjs", "let x; { let x; x; } x;", |s| {
        assert_ne!(s.variable("x", 0), s.variable("x", 1));
        assert_eq!(s.binding("x", 0), Symbol(s.variable("x", 1)));
        assert_eq!(s.binding("x", 1), Symbol(s.variable("x", 0)));
    });
    analyzed("a.cjs", "var x; function k() { var x; }", |s| {
        assert_ne!(s.variable("x", 0), s.variable("x", 1));
    });
}

#[test]
fn early_redeclarations() {
    let expected_counts = [(ONE_EARLY_REDECLARATION, 1), (NO_EARLY_REDECLARATION, 0)];
    for (table, expected) in expected_counts {
        for &(path, texts) in table {
            for &text in texts {
                analyzed(path, text, |s| {
                    assert_eq!(early(s).len(), expected, "{path}: {text}");
                });
            }
        }
    }
}

#[test]
fn early_pairs() {
    analyzed("a.cjs", "let a; var a;", |s| {
        let pair = EarlyRedeclaration {
            earlier: Decl::Var(s.pat("a", 0)),
            later: Decl::Var(s.pat("a", 1)),
        };
        assert!(early(s).contains(&pair), "{:?}", early(s));
    });
    analyzed("a.cjs", "function g(a) { let a; }", |s| {
        let pair = EarlyRedeclaration {
            earlier: Decl::Param(s.pat("a", 0)),
            later: Decl::Var(s.pat("a", 1)),
        };
        assert!(early(s).contains(&pair), "{:?}", early(s));
    });
    analyzed("a.cjs", "let a; let a;", |s| {
        assert!(s.bound.is_early_error_redeclaration(0));
    });
}

#[test]
fn annex_b_hoists() {
    analyzed_hoist("{ function f() {} f; } f;", |s, hoist| {
        assert_eq!(hoist.function, s.function("f"));
        assert_eq!(hoist.block_symbol, function_symbol(s, "f"));
        assert_eq!(s.binding("f", 0), Symbol(hoist.block_symbol));
        assert_eq!(s.binding("f", 1), Symbol(hoist.var_symbol));
        assert_ne!(hoist.block_symbol, hoist.var_symbol);
        assert!(s.bound.is_appended_symbol(hoist.var_symbol));
        assert_eq!(s.bound.symbol_scope(hoist.var_symbol), ScopeId(0));
    });
    analyzed_hoist("switch (0) { case 0: function f() {} } f;", |s, hoist| {
        assert_eq!(s.binding("f", 0), Symbol(hoist.var_symbol));
    });
    analyzed_hoist("if (a) function f() { f; } f;", |s, hoist| {
        assert_eq!(s.binding("f", 0), Symbol(hoist.block_symbol));
        assert_eq!(s.binding("f", 1), Symbol(hoist.var_symbol));
    });
    analyzed_hoist("try {} catch (f) { { function f() {} } } f;", |s, hoist| {
        assert_eq!(s.binding("f", 0), Symbol(hoist.var_symbol));
    });
    analyzed_hoist("var f; { function f() {} } f;", |s, hoist| {
        assert_eq!(hoist.var_symbol, s.variable("f", 0));
    });
    analyzed_hoist(
        "function o() { { function f() {} } return f; }",
        |s, hoist| {
            let scope = s.bound.symbol_scope(hoist.var_symbol);
            assert_eq!(
                s.bound.scopes[scope.idx()].kind,
                ScopeKind::Fn(s.function("o"))
            );
        },
    );
    analyzed_hoist("{ function f() {} { function f() {} } }", |s, hoist| {
        assert_eq!(hoist.function, s.function("f"));
    });
    let text = r#"function s() { "use strict"; } function o() { { function f() {} } return f; }"#;
    analyzed_hoist(text, |s, hoist| {
        assert_eq!(s.binding("f", 0), Symbol(hoist.var_symbol));
    });
}

#[test]
fn annex_b_shared_variable() {
    for text in [
        "{ function f() {} } { function f() {} } f;",
        "{ function f() {} function f() {} } f;",
        "if (a) function f() {} else function f() {} f;",
    ] {
        analyzed("a.cjs", text, |s| {
            let hoists = s.bound.runtime.annex_b_functions();
            assert_eq!(hoists.len(), 2, "{text}");
            assert_eq!(hoists[0].var_symbol, hoists[1].var_symbol, "{text}");
        });
    }
}

#[test]
fn annex_b_blocked() {
    for &(path, text) in UNHOISTED_FREE_FUNCTIONS {
        analyzed(path, text, |s| {
            assert_eq!(s.bound.runtime.annex_b_functions(), [], "{path}: {text}");
            assert_eq!(s.binding("f", 0), Free, "{path}: {text}");
        });
    }
    analyzed("a.cjs", "let f; { function f() {} } f;", |s| {
        assert_eq!(s.bound.runtime.annex_b_functions(), []);
        assert_eq!(s.binding("f", 0), Symbol(s.variable("f", 0)));
    });
    analyzed("a.cjs", "{ let f; { function f() {} } }", |s| {
        assert_eq!(s.bound.runtime.annex_b_functions(), []);
    });
    analyzed(
        "a.cjs",
        "function g(f) { { function f() {} } return f; }",
        |s| {
            assert_eq!(s.bound.runtime.annex_b_functions(), []);
            assert_eq!(s.binding("f", 0), Symbol(parameter(s, "f", 0)));
        },
    );
    for text in [
        r#"function s() { "use strict"; { function f() {} } return f; }"#,
        r#"function s() { "use strict"; if (a) { function f() {} } return f; }"#,
        r#"function s() { "use strict"; if (a) function f() {} return f; }"#,
        r#"function s() { "use strict"; switch (0) { case 0: function f() {} } return f; }"#,
        r#"const s = () => { "use strict"; { function f() {} } return f; };"#,
        r#"function s() { "use strict"; function n() { { function f() {} } return f; } }"#,
        r#"function s() { "use strict"; return () => { { function f() {} } return f; }; }"#,
    ] {
        analyzed("a.cjs", text, |s| {
            assert_eq!(s.bound.runtime.annex_b_functions(), [], "{text}");
            assert_eq!(s.binding("f", 0), Free, "{text}");
        });
    }
    for text in [
        r#"function f() {} function s() { "use strict"; { function f() {} } return f; }"#,
        r#"function s() { "use strict"; function f() {} { function f() {} } return f; }"#,
    ] {
        analyzed("a.cjs", text, |s| {
            assert_eq!(s.bound.runtime.annex_b_functions(), [], "{text}");
            assert_eq!(s.binding("f", 0), Symbol(function_symbol(s, "f")), "{text}");
        });
    }
}

#[test]
fn parameter_scopes() {
    analyzed("a.cjs", "function f(a = () => b) { var b; }", |s| {
        assert_eq!(s.binding("b", 0), Free);
    });
    analyzed("a.cjs", "var b; function f(a = () => b) { var b; }", |s| {
        assert_eq!(s.binding("b", 0), Symbol(s.variable("b", 0)));
    });
    analyzed("a.cjs", "function f(a = g) { function g() {} }", |s| {
        assert_eq!(s.binding("g", 0), Free);
    });
    analyzed(
        "a.cjs",
        "function f(a, h = () => a) { var a; return a; }",
        |s| {
            let (parameter, variable) = (parameter(s, "a", 0), s.variable("a", 1));
            let copy = ParameterVarCopy {
                function: s.function("f"),
                parameter,
                variable,
            };
            assert_eq!(s.bound.runtime.parameter_var_copies(), [copy]);
            assert_ne!(parameter, variable);
            assert_eq!(s.binding("a", 0), Symbol(parameter));
            assert_eq!(s.binding("a", 1), Symbol(variable));
        },
    );
    analyzed(
        "a.cjs",
        "function f(a, h = () => a) { function a() {} return a; }",
        |s| {
            assert_eq!(s.bound.runtime.parameter_var_copies(), []);
            assert_ne!(function_symbol(s, "a"), parameter(s, "a", 0));
            assert_eq!(s.binding("a", 1), Symbol(function_symbol(s, "a")));
        },
    );
    analyzed("a.cjs", "function f(a) { var a; return a; }", |s| {
        assert_eq!(s.bound.runtime.parameter_var_copies(), []);
        assert_eq!(s.variable("a", 1), parameter(s, "a", 0));
    });
}

#[test]
fn has_parameter_expressions() {
    for &(text, expected) in PARAMETER_EXPRESSIONS {
        analyzed("a.cjs", text, |s| {
            let flags = s.bound.function_flags(s.function("f"));
            let actual = flags.contains(FunctionFlags::HAS_PARAMETER_EXPRESSIONS);
            assert_eq!(actual, expected, "{text}");
        });
    }
}

#[test]
fn class_bindings() {
    analyzed("a.cjs", "class C { m() { return C; } } C;", |s| {
        let (inner, outer) = inner_and_outer(s);
        assert_ne!(inner, outer);
        assert!(s.bound.is_appended_symbol(inner));
        assert_eq!(s.binding("C", 0), Symbol(inner));
        assert_eq!(s.binding("C", 1), Symbol(outer));
    });
    for text in ["class C extends (() => C)() {}", "class C { [C.k]() {} }"] {
        analyzed("a.cjs", text, |s| {
            assert_eq!(s.binding("C", 0), Symbol(inner_and_outer(s).0), "{text}");
        });
    }
    analyzed("a.cjs", "class C { static m() { C = 1; } }", |s| {
        let (inner, outer) = inner_and_outer(s);
        assert_eq!(store_kinds(s, inner), [Assign]);
        assert_eq!(s.bound.stores_to(outer), []);
    });
    analyzed("a.cjs", "const D = class C { m() { return C; } };", |s| {
        let (inner, outer) = inner_and_outer(s);
        assert_eq!(inner, outer);
        assert!(!s.bound.is_appended_symbol(inner));
        assert_eq!(s.binding("C", 0), Symbol(inner));
    });
    analyzed("a.cjs", "const D = class {};", |s| {
        assert_eq!(s.bound.inner_class_symbol(ClassId(0)), SymbolId::NONE);
    });
}

#[test]
fn class_decorators() {
    analyzed("a.ts", "@d(() => C) class C {}", |s| {
        assert_eq!(s.binding("C", 0), Symbol(inner_and_outer(s).1));
    });
    analyzed("a.ts", "const D = @d(() => C) class C {};", |s| {
        assert_eq!(s.binding("C", 0), Free);
    });
    analyzed("a.ts", "const D = @C class C {};", |s| {
        assert_eq!(s.binding("C", 0), Free);
    });
    analyzed(
        "a.ts",
        "const C = 1; const D = @d(() => C) class C {};",
        |s| {
            assert_eq!(s.binding("C", 0), Symbol(s.variable("C", 0)));
        },
    );
    analyzed(
        "a.ts",
        "const C = 1; const D = @d(() => C) class {};",
        |s| {
            assert_eq!(s.binding("C", 0), Symbol(s.variable("C", 0)));
        },
    );
    analyzed("a.ts", "const D = class C { @d(() => C) m() {} };", |s| {
        assert_eq!(s.binding("C", 0), Symbol(inner_and_outer(s).0));
    });
}

#[test]
fn function_expression_name() {
    analyzed(
        "a.cjs",
        "const g = function f() { f = 1; return f; };",
        |s| {
            let f = function_symbol(s, "f");
            assert_eq!(s.binding("f", 0), Symbol(f));
            assert_eq!(s.binding("f", 1), Symbol(f));
            assert_eq!(store_kinds(s, f), [Assign]);
        },
    );
}

#[test]
fn catch_parameters() {
    analyzed("a.cjs", "try {} catch (e) { var e = 1; e; } e;", |s| {
        let (parameter, variable) = (s.variable("e", 0), s.variable("e", 1));
        assert_ne!(parameter, variable);
        assert_eq!(
            s.bound.initialized_binding(s.pat("e", 1)),
            Symbol(parameter)
        );
        assert_eq!(s.binding("e", 0), Symbol(parameter));
        assert_eq!(s.binding("e", 1), Symbol(variable));
    });
    analyzed("a.cjs", "var e = 1;", |s| {
        assert_eq!(
            s.bound.initialized_binding(s.pat("e", 0)),
            Symbol(s.variable("e", 0))
        );
    });
    let text = "function f() { try {} catch (arguments) { var arguments = 1; } }";
    analyzed("a.cjs", text, |s| {
        let parameter = s.variable("arguments", 0);
        assert_eq!(
            s.bound.initialized_binding(s.pat("arguments", 1)),
            Symbol(parameter)
        );
    });
}

#[test]
fn arguments_object() {
    for &text in ARGUMENTS_OBJECT_USES {
        analyzed("a.cjs", text, |s| {
            let f = s.function("f");
            assert_eq!(
                s.binding("arguments", 0),
                Arguments(CodeUnit::Function(f)),
                "{text}"
            );
            assert!(uses_arguments(s, f), "{text}");
            assert!(!has_direct_eval(s, f), "{text}");
        });
    }
    analyzed("a.cjs", "function f() { return () => arguments; }", |s| {
        assert!(!uses_arguments(s, arrow(s)));
        assert!(!has_direct_eval(s, arrow(s)));
    });
    analyzed(
        "a.cjs",
        "function f(arguments) { return arguments; }",
        |s| {
            let f = s.function("f");
            assert_eq!(
                s.binding("arguments", 0),
                Symbol(parameter(s, "arguments", 0))
            );
            assert!(!uses_arguments(s, f));
            assert!(!has_direct_eval(s, f));
        },
    );
    analyzed(
        "a.cjs",
        "function f() { var arguments = 1; return arguments; }",
        |s| {
            let name = s.pat("arguments", 0);
            let owner = CodeUnit::Function(s.function("f"));
            assert_eq!(s.bound.initialized_binding(name), Arguments(owner));
        },
    );
    for &text in FREE_ARGUMENTS {
        analyzed("a.mjs", text, |s| {
            assert_eq!(s.binding("arguments", 0), Free, "{text}");
        });
    }
}

#[test]
fn commonjs_wrapper_arguments_object() {
    for &text in WRAPPER_ARGUMENTS_USES {
        analyzed("a.cjs", text, |s| {
            assert_eq!(
                s.binding("arguments", 0),
                Arguments(CodeUnit::File),
                "{text}"
            );
        });
        analyzed("a.mjs", text, |s| {
            assert_eq!(s.binding("arguments", 0), Free, "{text}");
        });
    }
    for &text in NO_ARGUMENTS_OBJECT {
        analyzed("a.cjs", text, |s| {
            assert_eq!(s.binding("arguments", 0), Free, "{text}");
        });
    }
    analyzed("a.cjs", "var arguments = 1; arguments;", |s| {
        let name = s.pat("arguments", 0);
        assert_eq!(s.bound.initialized_binding(name), Arguments(CodeUnit::File));
        assert_eq!(s.binding("arguments", 0), Arguments(CodeUnit::File));
    });
    for text in [
        "let arguments = 1; arguments;",
        "function arguments() {} arguments;",
    ] {
        analyzed("a.cjs", text, |s| {
            assert_eq!(
                s.binding("arguments", 0),
                Symbol(top_level(s, "arguments")),
                "{text}"
            );
        });
    }
    analyzed(
        "a.cjs",
        "function f() { return arguments; } arguments;",
        |s| {
            assert_eq!(
                s.binding("arguments", 0),
                Arguments(CodeUnit::Function(s.function("f")))
            );
            assert_eq!(s.binding("arguments", 1), Arguments(CodeUnit::File));
            assert_eq!(s.bound.top_scope(&s.hir, CodeUnit::File), ScopeId(0));
        },
    );
}

#[test]
fn eval_flags() {
    for &(text, expects_arguments, expects_eval) in EVAL_FLAGS {
        analyzed("a.cjs", text, |s| {
            let f = s.function("f");
            assert_eq!(uses_arguments(s, f), expects_arguments, "{text}");
            assert_eq!(has_direct_eval(s, f), expects_eval, "{text}");
        });
    }
    analyzed("a.cjs", r#"function f() { return () => eval(""); }"#, |s| {
        assert!(!uses_arguments(s, arrow(s)));
        assert!(has_direct_eval(s, arrow(s)));
    });
}

#[test]
fn free_and_commonjs_names() {
    for path in ["a.cjs", "a.mjs"] {
        analyzed(
            path,
            "require; module; exports; __filename; __dirname; other;",
            |s| {
                for &(name, expected) in COMMONJS_NAMES {
                    assert_eq!(s.binding(name, 0), expected, "{path}: {name}");
                }
            },
        );
    }
    analyzed("a.cjs", "function f(require) { require; }", |s| {
        assert_eq!(s.binding("require", 0), Symbol(parameter(s, "require", 0)));
    });
    analyzed("a.ts", "declare const A: number; A;", |s| {
        assert_eq!(s.binding("A", 0), Free);
    });
    analyzed("a.ts", "const A = 1; A;", |s| {
        assert_eq!(s.binding("A", 0), Symbol(s.variable("A", 0)));
    });
    analyzed("a.jsx", "const Div = 1; <Div/>;", |s| {
        assert_eq!(s.binding("Div", 0), Symbol(s.variable("Div", 0)));
    });
}

#[test]
fn redeclared_commonjs_variables() {
    let text = "var exports = exports || {}; if (!module) { var module = {}; }";
    analyzed("a.cjs", text, |s| {
        let (exports, module) = (s.variable("exports", 0), s.variable("module", 0));
        let redeclared = s.bound.runtime.redeclared_commonjs_variables();
        assert_eq!(redeclared.len(), 2, "{redeclared:?}");
        assert!(
            redeclared.contains(&(exports, CommonJsVariable::Exports)),
            "{redeclared:?}"
        );
        assert!(
            redeclared.contains(&(module, CommonJsVariable::Module)),
            "{redeclared:?}"
        );
        assert_eq!(s.binding("exports", 0), Symbol(exports));
        assert_eq!(s.binding("module", 0), Symbol(module));
    });
    for &text in SHADOWED_COMMONJS_VARIABLES {
        analyzed("a.cjs", text, |s| {
            assert_eq!(
                s.bound.runtime.redeclared_commonjs_variables(),
                [],
                "{text}"
            );
        });
    }
}

#[test]
fn type_only_member_keys() {
    for &(text, expected) in MEMBER_KEY_IMPORTS {
        analyzed("a.ts", text, |s| {
            assert_eq!(is_unused(s, import_spec(s, 0)), expected, "{text}");
        });
    }
}

#[test]
fn entity_roots() {
    analyzed(
        "a.ts",
        r#"import * as ns from "m"; import a = ns.b; a;"#,
        |s| {
            let namespace = s.bound.declared_symbol(Decl::ImportNamespace(ImportId(0)));
            assert_eq!(
                s.bound.entity_root_binding(ImportEqualsId(0)),
                Symbol(namespace)
            );
        },
    );
    analyzed(
        "a.ts",
        "namespace N { export const b = 1; } import a = N.b; a;",
        |s| {
            assert_eq!(
                s.bound.entity_root_binding(ImportEqualsId(0)),
                Symbol(top_level(s, "N"))
            );
        },
    );
    for &text in UNRESOLVED_ENTITY_ROOTS {
        analyzed("a.ts", text, |s| {
            assert_eq!(
                s.bound.entity_root_binding(ImportEqualsId(0)),
                Free,
                "{text}"
            );
        });
    }
}

#[test]
fn eval_visibility_and_code_units() {
    analyzed("a.cjs", r#"function f() { let a; eval(""); }"#, |s| {
        assert!(s.bound.is_visible_to_eval(s.variable("a", 0)));
    });
    analyzed("a.cjs", r#"function f() { let a; (0, eval)(""); }"#, |s| {
        assert!(!s.bound.is_visible_to_eval(s.variable("a", 0)));
    });
    analyzed("a.cjs", "function f() { let a; class C { x = a; } }", |s| {
        assert_eq!(s.bound.code_unit(ScopeId(0)), CodeUnit::File);
        let initializers: Vec<(ScopeId, MemberId)> = (0u32..)
            .zip(s.bound.scopes.iter())
            .filter_map(|(index, scope)| match scope.kind {
                ScopeKind::FieldInitializer(member) => Some((ScopeId(index), member)),
                _ => None,
            })
            .collect();
        let [(scope, member)] = initializers[..] else {
            panic!("{initializers:?}");
        };
        assert_eq!(s.bound.code_unit(scope), CodeUnit::FieldInitializer(member));
        assert_eq!(s.bound.field_initializer_scope(member), Some(scope));
    });
    analyzed("a.cjs", "class C { static { let z; z; } }", |s| {
        let scope = s.bound.symbol_scope(s.variable("z", 0));
        let block = first_function(s, FnKind::StaticBlock);
        assert_eq!(s.bound.code_unit(scope), CodeUnit::Function(block));
    });
    analyzed("a.cjs", "function f() { { let a; } }", |s| {
        let scope = s.bound.symbol_scope(s.variable("a", 0));
        assert_eq!(s.bound.scopes[scope.idx()].kind, ScopeKind::Block);
        assert_eq!(
            s.bound.code_unit(scope),
            CodeUnit::Function(s.function("f"))
        );
    });
}

#[test]
fn with_statement() {
    let text = "var o = {}, x; with (o) { x; let y; y; var v = 1; (function () { x; }); } x;";
    analyzed("a.cjs", text, |s| {
        let with = first_stmt(s, |kind| matches!(kind, StmtKind::With { .. }));
        let scope = s.bound.own_scope(with);
        assert_eq!(s.bound.scopes[scope.idx()].kind, ScopeKind::With(with));
        let lookup = |name, nth| {
            s.bound
                .dynamic_lookup_scope(NodeData::Expr(s.ident(name, nth)))
        };
        assert_eq!(lookup("x", 0), Some(scope));
        assert_eq!(lookup("x", 1), Some(scope));
        assert_eq!(lookup("o", 0), None);
        assert_eq!(lookup("y", 0), None);
        assert_eq!(lookup("x", 2), None);
        let declarator = NodeData::Pat(s.pat("v", 0));
        assert_eq!(s.bound.dynamic_lookup_scope(declarator), Some(scope));
        assert_eq!(s.binding("x", 0), Symbol(s.variable("x", 0)));
    });
    let text = "var o = {}; with (o) { for (var x of [1]); for (var k in o); var u; }";
    analyzed("a.cjs", text, |s| {
        let with = first_stmt(s, |kind| matches!(kind, StmtKind::With { .. }));
        let scope = s.bound.own_scope(with);
        let lookup = |name| s.bound.dynamic_lookup_scope(NodeData::Pat(s.pat(name, 0)));
        assert_eq!(lookup("x"), Some(scope));
        assert_eq!(lookup("k"), Some(scope));
        assert_eq!(lookup("u"), None);
    });
}

#[test]
fn direct_and_indirect_eval() {
    for &(path, text) in DIRECT_EVALS {
        analyzed(path, text, |s| {
            assert_eq!(s.bound.runtime.eval_scopes().len(), 1, "{path}: {text}");
            assert!(s.bound.eval_scope(calls(s)[0]).is_some(), "{path}: {text}");
        });
    }
    for &text in INDIRECT_EVALS {
        analyzed("a.cjs", text, |s| {
            assert_eq!(s.bound.runtime.eval_scopes(), [], "{text}");
            let found = calls(s);
            assert!(!found.is_empty(), "{text}");
            for call in found {
                assert_eq!(s.bound.eval_scope(call), None, "{text}");
            }
        });
    }
    for &(path, text, expected) in SLOPPY_EVALS {
        analyzed(path, text, |s| {
            let is_sloppy = s.bound.runtime.eval_scopes()[0].1.is_sloppy;
            assert_eq!(is_sloppy, expected, "{path}: {text}");
        });
    }
}

#[test]
fn eval_visible_symbols() {
    let text = r#"var g; function f(a) { let b; { let a; eval(""); } }"#;
    analyzed("a.cjs", text, |s| {
        let scope = s.bound.runtime.eval_scopes()[0].1;
        let symbols: Vec<SymbolId> = s.bound.ids(scope.symbols).collect();
        let inner_a = position(&symbols, s.variable("a", 1));
        let b = position(&symbols, s.variable("b", 0));
        let g = position(&symbols, s.variable("g", 0));
        assert!(inner_a < b && b < g, "{symbols:?}");
        assert!(symbols.contains(&function_symbol(s, "f")), "{symbols:?}");
        assert!(!symbols.contains(&parameter(s, "a", 0)), "{symbols:?}");
    });
}

#[test]
fn eval_symbols_behind_simple_catch_parameters() {
    analyzed(
        "a.cjs",
        r#"function f() { var e; try {} catch (e) { eval(""); } }"#,
        |s| {
            let (variable, caught) = (s.variable("e", 0), s.variable("e", 1));
            let symbols = eval_symbols(s);
            assert!(
                position(&symbols, caught) < position(&symbols, variable),
                "{symbols:?}"
            );
            assert!(s.bound.is_visible_to_eval(variable));
        },
    );
    analyzed(
        "a.cjs",
        r#"function f(e) { try {} catch (e) { eval(""); } }"#,
        |s| {
            let (parameter, caught) = (parameter(s, "e", 0), s.variable("e", 1));
            let symbols = eval_symbols(s);
            assert!(
                position(&symbols, caught) < position(&symbols, parameter),
                "{symbols:?}"
            );
        },
    );
    let nested = r#"function f() { var e; try {} catch (e) { try {} catch (e) { eval(""); } } }"#;
    analyzed("a.cjs", nested, |s| {
        let symbols = eval_symbols(s);
        let position_of = |nth| position(&symbols, s.variable("e", nth));
        let (variable, outer, inner) = (position_of(0), position_of(1), position_of(2));
        assert!(inner < outer && outer < variable, "{symbols:?}");
    });
    for text in [
        r#"function f() { var e; { let e; try {} catch (e) { eval(""); } } }"#,
        r#"function f() { var e; try {} catch ({ e }) { eval(""); } }"#,
        r#""use strict"; function f() { var e; try {} catch (e) { eval(""); } }"#,
    ] {
        analyzed("a.cjs", text, |s| {
            let variable = s.variable("e", 0);
            assert!(!eval_symbols(s).contains(&variable), "{text}");
            assert!(!s.bound.is_visible_to_eval(variable), "{text}");
        });
    }
}

#[test]
fn eval_dynamic_lookups() {
    analyzed(
        "a.cjs",
        r#"var x; function f() { eval(""); return x; }"#,
        |s| {
            let x = NodeData::Expr(s.ident("x", 0));
            let scope = s.bound.dynamic_lookup_scope(x).unwrap();
            assert_eq!(
                s.bound.scopes[scope.idx()].kind,
                ScopeKind::Fn(s.function("f"))
            );
        },
    );
    let strict = r#""use strict"; var x; function f() { eval(""); return x; }"#;
    analyzed("a.cjs", strict, |s| {
        let x = NodeData::Expr(s.ident("x", 0));
        assert_eq!(s.bound.dynamic_lookup_scope(x), None);
    });
    analyzed(
        "a.cjs",
        r#"function f() { var y; eval(""); return y; }"#,
        |s| {
            let y = NodeData::Expr(s.ident("y", 0));
            assert_eq!(s.bound.dynamic_lookup_scope(y), None);
        },
    );
    analyzed("a.cjs", r#"eval(""); require("a"); other;"#, |s| {
        let lookup = |name| {
            s.bound
                .dynamic_lookup_scope(NodeData::Expr(s.ident(name, 0)))
        };
        assert_eq!(lookup("require"), None);
        assert_eq!(lookup("other"), Some(ScopeId(0)));
    });
    analyzed(
        "a.cjs",
        r#"function f() { eval(""); require("a"); }"#,
        |s| {
            let require = NodeData::Expr(s.ident("require", 0));
            let scope = s.bound.dynamic_lookup_scope(require).unwrap();
            assert_eq!(
                s.bound.scopes[scope.idx()].kind,
                ScopeKind::Fn(s.function("f"))
            );
        },
    );
}

#[test]
fn stores() {
    for &(statement, kind) in STORES {
        let text = format!("let x; {statement}");
        analyzed("a.ts", &text, |s| {
            let x = s.variable("x", 0);
            assert_eq!(store_kinds(s, x), [kind], "{statement}");
            assert_eq!(
                s.bound.stores_to(x)[0].target,
                s.ident("x", 0),
                "{statement}"
            );
        });
    }
    for &(path, text) in NO_STORES {
        analyzed(path, text, |s| {
            assert_eq!(store_kinds(s, s.variable("x", 0)), [], "{path}: {text}");
        });
    }
    analyzed("a.ts", "let x; x = 1; x++; [x] = a;", |s| {
        let expected = [Assign, Update(UnOp::PostInc), Destructure];
        assert_eq!(store_kinds(s, s.variable("x", 0)), expected);
    });
}

#[test]
fn unbound_name_stores() {
    analyzed("a.cjs", "y = 1; module = 2; exports = {}; [z] = a;", |s| {
        let expected = [
            (s.ident("y", 0), Assign),
            (s.ident("module", 0), Assign),
            (s.ident("exports", 0), Assign),
            (s.ident("z", 0), Destructure),
        ];
        assert_eq!(s.bound.runtime.unbound_name_stores(), expected);
    });
    analyzed("a.cjs", "function f() { arguments = 1; }", |s| {
        assert_eq!(
            s.bound.runtime.unbound_name_stores(),
            [(s.ident("arguments", 0), Assign)]
        );
        for symbol in 0..s.bound.symbols.len() {
            assert_eq!(s.bound.stores_to(SymbolId(symbol as u32)), [], "{symbol}");
        }
    });
}

#[test]
fn exports() {
    analyzed("a.mjs", "const a = 1; export { a as b };", |s| {
        assert_eq!(
            s.bound.exported_binding(ExportSpecId(0)),
            Symbol(s.variable("a", 0))
        );
    });
    analyzed("a.mjs", "export { missing };", |s| {
        assert_eq!(s.bound.exported_binding(ExportSpecId(0)), Free);
    });
    analyzed("a.mjs", r#"import { x } from "m"; export { x };"#, |s| {
        assert_eq!(
            s.bound.exported_binding(ExportSpecId(0)),
            Symbol(import_spec(s, 0))
        );
    });
    analyzed("a.mjs", r#"import d, * as n from "m"; d; n;"#, |s| {
        let default = s.bound.declared_symbol(Decl::ImportDefault(ImportId(0)));
        let namespace = s.bound.declared_symbol(Decl::ImportNamespace(ImportId(0)));
        assert_eq!(s.binding("d", 0), Symbol(default));
        assert_eq!(s.binding("n", 0), Symbol(namespace));
    });
    analyzed("a.mjs", "export const v = 1; v;", |s| {
        let v = s.variable("v", 0);
        assert_eq!(v, exported(s, s.workspace.atom("v")));
        assert_eq!(s.binding("v", 0), Symbol(v));
    });
}

#[test]
fn default_exports() {
    analyzed("a.mjs", "export default 1 + 1;", |s| {
        let statement = first_stmt(s, |kind| matches!(kind, StmtKind::ExportDefault(_)));
        let symbol = s.bound.declared_symbol(Decl::ExportExpr(statement));
        assert_eq!(symbol, exported(s, known::default));
    });
    analyzed("a.mjs", "export default function () {}", |s| {
        let symbol = s.bound.declared_symbol(Decl::Fn(FnId(0)));
        assert_eq!(symbol, exported(s, known::default));
    });
    analyzed("a.mjs", "export default class {}", |s| {
        let symbol = s.bound.declared_symbol(Decl::Class(ClassId(0)));
        assert_eq!(symbol, exported(s, known::default));
    });
    analyzed("a.mjs", "export default function named() {} named;", |s| {
        let default = exported(s, known::default);
        assert_eq!(function_symbol(s, "named"), default);
        assert_eq!(s.binding("named", 0), Symbol(default));
    });
    analyzed("a.cts", "export = 1;", |s| {
        let statement = first_stmt(s, |kind| matches!(kind, StmtKind::ExportAssign(_)));
        let symbol = s.bound.declared_symbol(Decl::ExportExpr(statement));
        assert_eq!(symbol, exported(s, known::export_equals));
    });
}

#[test]
fn has_runtime_value() {
    for &(text, name, expected) in RUNTIME_VALUES {
        analyzed("a.ts", text, |s| {
            let actual = s.bound.has_runtime_value(top_level(s, name));
            assert_eq!(actual, expected, "{text}");
        });
    }
}

#[test]
fn classic_jsx() {
    let with_import = r#"import React from "react"; const e = <a/>;"#;
    analyzed_classic_jsx(with_import, |s| {
        let react = s.bound.declared_symbol(Decl::ImportDefault(ImportId(0)));
        let expected = ImplicitReference {
            node: NodeData::Expr(jsx(s)),
            kind: JsxFactory,
            name: s.workspace.atom("React"),
            binding: Symbol(react),
        };
        assert_eq!(s.bound.runtime.implicit_references(), [expected]);
        assert_eq!(s.analysis.unused_import_symbols, []);
    });
    analyzed_classic_jsx(r#"import React from "react"; const e = <></>;"#, |s| {
        let references = s.bound.runtime.implicit_references();
        let kinds: Vec<ImplicitReferenceKind> = references.iter().map(|r| r.kind).collect();
        assert_eq!(kinds, [JsxFactory, JsxFragment]);
    });
    analyzed_classic_jsx("const e = <a/>;", |s| {
        assert_eq!(s.bound.runtime.implicit_references()[0].binding, Free);
    });
    for text in [
        "/** @jsx h */ const h = 0; const e = <a/>;",
        "// @jsx h\nconst h = 0; const e = <a/>;",
        "const h = 0; const e = <a/>; /* @jsx h.create */",
    ] {
        analyzed_classic_jsx(text, |s| {
            let binding = s.bound.runtime.implicit_references()[0].binding;
            assert_eq!(binding, Symbol(s.variable("h", 0)), "{text}");
        });
    }
    analyzed_classic_jsx("// @jsx .\nconst e = <a/>;", |s| {
        let name = s.bound.runtime.implicit_references()[0].name;
        assert_eq!(name, s.workspace.atom("React"));
    });
    analyzed("a.tsx", with_import, |s| {
        let react = s.bound.declared_symbol(Decl::ImportDefault(ImportId(0)));
        assert_eq!(s.bound.runtime.implicit_references(), []);
        assert!(is_unused(s, react));
    });
}

#[test]
fn jump_targets() {
    analyzed(
        "a.cjs",
        "a: for (;;) { b: for (;;) { continue a; break b; break; } }",
        |s| {
            let expected = [Some(labeled(s, "a")), Some(labeled(s, "b")), None];
            assert_eq!(resolved_jumps(s), expected);
        },
    );
    analyzed("a.cjs", "a: { break a; break a; }", |s| {
        let a = Some(labeled(s, "a"));
        assert_eq!(resolved_jumps(s), [a, a]);
    });
    for text in [
        "x: for (;;) { break y; }",
        "a: for (;;) { () => { break a; }; }",
    ] {
        analyzed("a.cjs", text, |s| {
            assert_eq!(resolved_jumps(s), [None], "{text}");
        });
    }
}

#[test]
fn own_scopes() {
    let text = "{ let a; } for (let i = 0;;) {} switch (0) { case 0: let p; case 1: let q; } try {} catch (e) { let h; } {}";
    analyzed("a.cjs", text, |s| {
        let variable_scope = |name| s.bound.symbol_scope(s.variable(name, 0));
        let blocks = find_stmts(&s.hir, |kind| matches!(kind, StmtKind::Block(_)));
        let for_loop = first_stmt(s, |kind| matches!(kind, StmtKind::For { .. }));
        let switch = first_stmt(s, |kind| matches!(kind, StmtKind::Switch { .. }));
        let try_stmt = first_stmt(s, |kind| matches!(kind, StmtKind::Try { .. }));
        let StmtKind::Try { handler, .. } = s.hir[try_stmt].kind else {
            panic!("{text}");
        };
        assert_eq!(variable_scope("a"), s.bound.own_scope(blocks[0]));
        assert_eq!(variable_scope("i"), s.bound.own_scope(for_loop));
        assert_eq!(variable_scope("p"), s.bound.own_scope(switch));
        assert_eq!(variable_scope("q"), s.bound.own_scope(switch));
        assert_eq!(variable_scope("e"), s.bound.own_scope(try_stmt));
        assert_eq!(variable_scope("h"), s.bound.own_scope(handler));
        let handler_scope = s.bound.own_scope(handler);
        let parent = s.bound.scopes[handler_scope.idx()].parent;
        assert_eq!(parent, s.bound.own_scope(try_stmt));
        assert_eq!(s.bound.own_scope(*blocks.last().unwrap()), ScopeId::NONE);
    });
}

#[test]
fn every_program() {
    for_each_program(&SOURCE_EXTENSIONS, |w, path, text| {
        let source = Source::from_bytes(path, text);
        let mut first = w.analyze(&source);
        if first.bound.ran_out_of_stack {
            return;
        }
        let bindings = describe_runtime(&first.bound);
        let (bound, _) = w.analyze_tree(&mut first.hir, &source);
        assert!(describe_runtime(&bound) == bindings, "{path}");
    });
}
