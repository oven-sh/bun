mod support;
use support::*;

use Binding::{Arguments, Free, Symbol};

const EXPORTED_BLOCK_BINDINGS: &[&str] = &[
    "namespace N { v; export function v() {} } namespace N { v; }",
    "namespace N { export class v {} v; } namespace N { v; }",
    "namespace N { export enum v { A } v; } namespace N { v; }",
    "namespace N { export namespace v { export const a = 1; } v; } namespace N { v; }",
    "namespace N { export function v() {} export namespace v { export const a = 1; } v; } \
     namespace N { v; }",
    "namespace N { export interface v {} export class v {} v; } namespace N { v; }",
    "namespace N { export function v() {} function g() { return v; } } namespace N { v; }",
];

const EXPORTED_VARIABLES: &[&str] = &[
    "namespace N { export var v = 1; v; } namespace N { v; }",
    "namespace N { export let v = 1; v; } namespace N { v; }",
    "namespace N { export const v = 1; v; } namespace N { v; }",
    "namespace N { export const { v } = { v: 1 }; v; } namespace N { v; }",
];

const CAST_DIRECT_EVALS: &[&str] = &[
    r#"eval!("x");"#,
    r#"(eval as any)!("x");"#,
    r#"((eval satisfies unknown) as any)("x");"#,
];

const CAST_INDIRECT_EVALS: &[&str] = &[
    r#"f(eval as any);"#,
    r#"f(eval!)("x");"#,
    r#"(eval as any)?.("x");"#,
    r#"(eval as any).call("x");"#,
];

const DECORATED_MEMBER_KEY_IMPORTS: &[(&str, bool)] = &[
    (
        r#"import { k } from "m"; class A { @d declare [k]: number; }"#,
        false,
    ),
    (
        r#"import { k } from "m"; abstract class A { @d abstract [k]: number; }"#,
        false,
    ),
    (
        r#"import { k } from "m"; abstract class A { @d abstract [k](): void; }"#,
        true,
    ),
    (
        r#"import { k } from "m"; class A { @d [k](): void; [k]() {} }"#,
        false,
    ),
    (
        r#"import { k } from "m"; declare class A { @d [k]: number; }"#,
        true,
    ),
];

fn block_symbol(s: &Analyzed<'_>, name: &str) -> SymbolId {
    let name = s.workspace.atom(name);
    let scopes = s.bound.scopes.iter();
    let mut blocks = scopes.filter(|scope| matches!(scope.kind, ScopeKind::Module(_)));
    blocks
        .find_map(|scope| s.bound.lookup(scope.locals, name))
        .unwrap()
}

fn member_symbol(s: &Analyzed<'_>, block_symbol: SymbolId) -> SymbolId {
    let member = s.bound.symbol(block_symbol).export_symbol;
    assert!(member.is_some());
    assert_ne!(member, block_symbol);
    member
}

fn calls(s: &Analyzed<'_>) -> Vec<ExprId> {
    find_exprs(&s.hir, |kind| matches!(kind, ExprKind::Call(_)))
}

fn outer_and_inner_hoists(s: &Analyzed<'_>) -> (AnnexBFunction, AnnexBFunction) {
    let [first, second] = s.bound.runtime.annex_b_functions()[..] else {
        panic!("{:?}", s.bound.runtime.annex_b_functions());
    };
    if s.bound.symbol_scope(first.var_symbol) == ScopeId(0) {
        (first, second)
    } else {
        (second, first)
    }
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

#[test]
fn exported_declaration_binds_in_namespace_block() {
    for &text in EXPORTED_BLOCK_BINDINGS {
        analyzed("a.ts", text, |s| {
            let block = block_symbol(s, "v");
            let member = member_symbol(s, block);
            assert_eq!(s.binding("v", 0), Symbol(block), "{text}");
            assert_eq!(s.binding("v", 1), Symbol(member), "{text}");
            for &decl in s.bound.symbol(block).decls {
                if !matches!(decl, Decl::Interface(_)) {
                    assert_eq!(s.bound.declared_symbol(decl), block, "{text}: {decl:?}");
                    assert_eq!(
                        s.bound.symbol_of_declaration(decl),
                        member,
                        "{text}: {decl:?}"
                    );
                }
            }
        });
    }
}

#[test]
fn exported_variable_is_namespace_member() {
    for &text in EXPORTED_VARIABLES {
        analyzed("a.ts", text, |s| {
            let member = member_symbol(s, block_symbol(s, "v"));
            assert_eq!(s.variable("v", 0), member, "{text}");
            assert_eq!(s.binding("v", 0), Symbol(member), "{text}");
            assert_eq!(s.binding("v", 1), Symbol(member), "{text}");
        });
    }
}

#[test]
fn unexported_declaration_is_invisible_in_other_block() {
    analyzed(
        "a.ts",
        "namespace N { function v() {} v; } namespace N { v; }",
        |s| {
            let block = block_symbol(s, "v");
            assert_eq!(s.bound.symbol(block).export_symbol, SymbolId::NONE);
            assert_eq!(s.bound.declared_symbol(Decl::Fn(s.function("v"))), block);
            assert_eq!(s.binding("v", 0), Symbol(block));
            assert_eq!(s.binding("v", 1), Free);
        },
    );
}

#[test]
fn file_export_keeps_export_symbol() {
    analyzed("a.ts", "export function v() {} v;", |s| {
        let exported = s.bound.fn_symbol[s.function("v").idx()];
        assert_eq!(s.bound.symbol(exported).parent, s.bound.file_symbol);
        assert_eq!(s.bound.declared_symbol(Decl::Fn(s.function("v"))), exported);
        assert_eq!(s.binding("v", 0), Symbol(exported));
    });
}

#[test]
fn reopened_namespace_has_block_binding_per_block() {
    let text = "namespace N { export namespace v { export const a = 1; } v; } \
                namespace N { export namespace v { export const b = 2; } v; }";
    analyzed("a.ts", text, |s| {
        let (Symbol(first), Symbol(second)) = (s.binding("v", 0), s.binding("v", 1)) else {
            panic!("{:?} {:?}", s.binding("v", 0), s.binding("v", 1));
        };
        assert_ne!(first, second);
        assert_eq!(member_symbol(s, first), member_symbol(s, second));
    });
}

#[test]
fn block_binding_stores_and_eval() {
    analyzed(
        "a.ts",
        "namespace N { export function v() {} v = null!; }",
        |s| {
            let block = block_symbol(s, "v");
            assert_eq!(s.bound.stores_to(block).len(), 1);
            assert_eq!(s.bound.stores_to(member_symbol(s, block)), []);
        },
    );
    let text = r#"namespace N { export function v() {} export const w = 1; eval(""); }"#;
    analyzed("a.ts", text, |s| {
        let (v, w) = (block_symbol(s, "v"), block_symbol(s, "w"));
        assert!(s.bound.is_visible_to_eval(v));
        assert!(!s.bound.is_visible_to_eval(member_symbol(s, v)));
        assert!(!s.bound.is_visible_to_eval(w));
        assert!(!s.bound.is_visible_to_eval(member_symbol(s, w)));
    });
}

#[test]
fn entity_root_is_block_binding() {
    let text = "namespace N { export namespace v { export const a = 1; } import b = v.a; b; }";
    analyzed("a.ts", text, |s| {
        let root = s.bound.entity_root_binding(ImportEqualsId(0));
        assert_eq!(root, Symbol(block_symbol(s, "v")));
    });
}

#[test]
fn implicit_block_binding_is_visible_from_parameters() {
    analyzed(
        "a.cjs",
        "if (a) function f(x = f) { { function f() {} } }",
        |s| {
            let (outer, inner) = outer_and_inner_hoists(s);
            assert_ne!(outer.block_symbol, inner.var_symbol);
            assert_eq!(s.binding("f", 0), Symbol(outer.block_symbol));
        },
    );
    analyzed(
        "a.cjs",
        "if (a) function f(x = f) { { function f() {} } f; }",
        |s| {
            let (outer, inner) = outer_and_inner_hoists(s);
            assert_eq!(s.binding("f", 0), Symbol(outer.block_symbol));
            assert_eq!(s.binding("f", 1), Symbol(inner.var_symbol));
        },
    );
    analyzed("a.cjs", "if (a) function f(f) { f; }", |s| {
        let parameter = s.bound.declared_symbol(Decl::Param(s.pat("f", 0)));
        assert_eq!(s.binding("f", 0), Symbol(parameter));
    });
}

#[test]
fn implicit_block_binding_is_outside_function_scope() {
    analyzed("a.cjs", "if (a) function arguments() { arguments; }", |s| {
        let owner = CodeUnit::Function(s.function("arguments"));
        assert_eq!(s.binding("arguments", 0), Arguments(owner));
    });
    analyzed(
        "a.cjs",
        r#"if (a) function f() { eval("var f"); f; }"#,
        |s| {
            let function = s.function("f");
            let scope = s.bound.fns[function.idx()].scope;
            let block = s.bound.declared_symbol(Decl::Fn(function));
            assert_eq!(s.binding("f", 0), Symbol(block));
            assert_eq!(
                s.bound
                    .dynamic_lookup_scope(NodeData::Expr(s.ident("f", 0))),
                Some(scope)
            );
            assert!(s.bound.is_visible_to_eval(block));
        },
    );
    analyzed("a.cjs", "if (a) function f() { f; }", |s| {
        assert_eq!(
            s.bound
                .dynamic_lookup_scope(NodeData::Expr(s.ident("f", 0))),
            None
        );
    });
}

#[test]
fn hoisted_require_initializes_catch_parameter() {
    analyzed(
        "a.cjs",
        r#"try {} catch (e) { var e = require("m"); }"#,
        |s| {
            let (parameter, variable) = (s.variable("e", 0), s.variable("e", 1));
            assert_ne!(parameter, variable);
            assert_eq!(
                s.bound.initialized_binding(s.pat("e", 1)),
                Symbol(parameter)
            );
        },
    );
    analyzed("a.cjs", r#"{ var e = require("m"); }"#, |s| {
        assert_eq!(
            s.bound.initialized_binding(s.pat("e", 0)),
            Symbol(s.variable("e", 0))
        );
    });
    analyzed(
        "a.cjs",
        r#"try {} catch (e) { { const e = require("m"); } }"#,
        |s| {
            assert_eq!(
                s.bound.initialized_binding(s.pat("e", 1)),
                Symbol(s.variable("e", 1))
            );
        },
    );
}

#[test]
fn class_expression_decorator_skips_class_scopes() {
    analyzed("a.ts", "let C; const D = @(C = d) class C {};", |s| {
        let class = s.bound.class_symbol[s.class("C").idx()];
        assert_eq!(s.bound.stores_to(s.variable("C", 0)).len(), 1);
        assert_eq!(s.bound.stores_to(class), []);
    });
    analyzed(
        "a.ts",
        "function g() { let C; return @d(() => C) class C {}; }",
        |s| {
            assert_eq!(s.binding("C", 0), Symbol(s.variable("C", 0)));
        },
    );
    analyzed(
        "a.ts",
        r#"const D = @(eval("")) class C { static m() { eval(""); } };"#,
        |s| {
            let class = s.bound.class_symbol[s.class("C").idx()];
            let lists_class = |call: ExprId| {
                let symbols = s.bound.eval_scope(call).unwrap().symbols;
                s.bound.ids(symbols).any(|symbol| symbol == class)
            };
            let [decorator, method] = calls(s)[..] else {
                panic!("{:?}", calls(s));
            };
            assert!(!lists_class(decorator));
            assert!(lists_class(method));
        },
    );
    analyzed(
        "a.ts",
        "function g() { let x; return @d(() => x) class {}; }",
        |s| {
            assert_eq!(s.binding("x", 0), Symbol(s.variable("x", 0)));
        },
    );
}

#[test]
fn direct_eval_through_type_assertions() {
    for &text in CAST_DIRECT_EVALS {
        analyzed("a.ts", text, |s| {
            assert_eq!(s.bound.runtime.eval_scopes().len(), 1, "{text}");
            assert!(s.bound.eval_scope(calls(s)[0]).is_some(), "{text}");
        });
    }
    for &text in CAST_INDIRECT_EVALS {
        analyzed("a.ts", text, |s| {
            assert_eq!(s.bound.runtime.eval_scopes(), [], "{text}");
        });
    }
}

#[test]
fn decorated_declaration_only_member_keys() {
    for &(text, expected) in DECORATED_MEMBER_KEY_IMPORTS {
        analyzed("a.ts", text, |s| {
            let import = s.bound.declared_symbol(Decl::ImportSpec(ImportSpecId(0)));
            let is_unused = s.analysis.unused_import_symbols.contains(&import);
            assert_eq!(is_unused, expected, "{text}");
        });
    }
}

#[test]
fn jsx_reference_names() {
    analyzed_classic_jsx("const e = <></>;", |s| {
        let react = s.workspace.atom("React");
        let references = s.bound.runtime.implicit_references();
        let names: Vec<Atom> = references.iter().map(|reference| reference.name).collect();
        assert_eq!(names, [react, react]);
    });
    let text = "/** @jsx h.create */ /** @jsxFrag h.Fragment */ const e = <><a/></>;";
    analyzed_classic_jsx(text, |s| {
        let h = s.workspace.atom("h");
        let references = s.bound.runtime.implicit_references();
        assert_eq!(references.len(), 3);
        assert!(references.iter().all(|reference| reference.name == h));
        let order = |reference: &ImplicitReference| match (reference.node, reference.kind) {
            (NodeData::Expr(element), ImplicitReferenceKind::JsxFactory) => (element, false),
            (NodeData::Expr(element), ImplicitReferenceKind::JsxFragment) => (element, true),
            other => panic!("{other:?}"),
        };
        assert!(references.is_sorted_by_key(order));
    });
}
