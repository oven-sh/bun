mod support;
use support::*;

use bun_sema::bind::decorator_metadata::find_metadata_binding;

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

// (file, first name of the path of a define, text). The text writes that name beside each root of a define.
const DEFINE_HEADS_BESIDE_THE_NAME: &[(&str, &str, &str)] = &[
    (
        "a.cjs",
        "target",
        "function f(target) { [KEY, target]; } [KEY, target];",
    ),
    ("a.cjs", "target", "[KEY, target]; let target;"),
    (
        "a.cjs",
        "target",
        "try {} catch (target) { [KEY, target]; }",
    ),
    ("a.cjs", "target", "(function target() { [KEY, target]; });"),
    (
        "a.cjs",
        "target",
        "class C { target; field = [KEY, target]; static { var target; [KEY, target]; } }",
    ),
    (
        "a.cjs",
        "target",
        "function f(a, b = [KEY, target]) { var target; }",
    ),
    (
        "a.mjs",
        "target",
        r#"import target from "m"; [KEY, target];"#,
    ),
    (
        "a.ts",
        "target",
        "namespace M { export const x = 1; } namespace P { import target = M.x; [KEY, target]; }",
    ),
    ("a.cjs", "exports", "[KEY, exports];"),
    (
        "a.cjs",
        "arguments",
        "[KEY, arguments]; function f() { [KEY, arguments]; (() => [KEY, arguments]); }",
    ),
    (
        "a.cjs",
        "target",
        "var target; with (o) { [import.meta, target]; }",
    ),
    ("a.cjs", "target", "with (o) { [import.meta, target]; }"),
    (
        "a.cjs",
        "target",
        r#"function f() { eval(""); [KEY, target]; }"#,
    ),
    (
        "a.cjs",
        "target",
        r#"var target; function f() { eval(""); [KEY, target]; }"#,
    ),
    (
        "a.cjs",
        "target",
        r#""use strict"; function f() { eval(""); [KEY, target]; }"#,
    ),
    (
        "a.cjs",
        "target",
        r#"function f(target, ...rest) { eval(""); [KEY, target]; }"#,
    ),
    (
        "a.cjs",
        "target",
        r#"function f(target, b = [KEY, target]) { eval(""); }"#,
    ),
    (
        "a.cjs",
        "target",
        r#"var f = (a, b = [KEY, target]) => eval("");"#,
    ),
    (
        "a.cjs",
        "target",
        r#"var f = (target, b = [KEY, target]) => eval("");"#,
    ),
    (
        "a.cjs",
        "target",
        r#"var f = (a, b = eval("")) => [KEY, target];"#,
    ),
    (
        "a.cjs",
        "target",
        r#"var f = (target, ...rest) => [eval(""), KEY, target];"#,
    ),
];

// (file, text, root of a define, whether the fold may apply a define at the root)
const ROOTS_OF_DEFINES: &[(&str, &str, &str, bool)] = &[
    ("a.cjs", "var target; KEY;", "KEY", true),
    (
        "a.cjs",
        "var target; function f(KEY) { KEY; }",
        "KEY",
        false,
    ),
    ("a.cjs", "var target; require;", "require", true),
    ("a.cjs", "var target; __filename;", "__filename", true),
    ("a.cjs", "var target; __dirname;", "__dirname", true),
    ("a.cjs", "var target; module;", "module", false),
    ("a.cjs", "var target; exports;", "exports", false),
    ("a.mjs", "var target; arguments;", "arguments", true),
    (
        "a.mjs",
        "var target; function f() { arguments; }",
        "arguments",
        false,
    ),
];

const NAMES_THAT_ARE_NO_VARIABLES: &[(&str, &str)] = &[
    (
        "a.ts",
        "namespace N { export const target = 1; KEY; } namespace N { KEY; }",
    ),
    ("a.ts", "enum E { target = 1, other = KEY }"),
    (
        "a.ts",
        "namespace A { export const target = 1; \
         export namespace N { export const target = 2; KEY; } }",
    ),
    (
        "a.ts",
        "namespace A { export const target = 1; enum E { target = 1, other = KEY } }",
    ),
    (
        "a.ts",
        "namespace M { export const x = 1; } namespace N { export import target = M.x; KEY; }",
    ),
    ("a.ts", r#"import type { target } from "m"; KEY;"#),
    (
        "a.mjs",
        r#"import { target } from "./m" with { type: "macro" }; KEY;"#,
    ),
    (
        "a.mjs",
        r#"import target from "./m" with { type: "macro" }; KEY;"#,
    ),
    (
        "a.mjs",
        r#"import * as target from "./m" with { type: "macro" }; KEY;"#,
    ),
];

const VARIABLES_AROUND_WHAT_IS_NO_VARIABLE: &[&str] = &[
    "const target = 0; namespace N { export const target = 1; KEY; }",
    "const target = 0; enum E { target = 1, other = KEY }",
    "function f() { var target = 0; enum E { target = 1, other = KEY } }",
    "const target = 0; namespace A { export const target = 1; \
     export namespace N { export const target = 2; KEY; } }",
];

// (text, whether a variable `target` is declared around the member, the keyword of the scope whose `with` object or evaluated text may declare `target`)
const DYNAMIC_SCOPES_AROUND_WHAT_IS_NO_VARIABLE: &[(&str, bool, &str)] = &[
    (
        r#"namespace N { export const target = 1; eval(""); KEY; }"#,
        false,
        "namespace",
    ),
    (
        "namespace N { export const target = 1; with (o) { import.meta; } }",
        false,
        "with",
    ),
    (
        r#"function g() { eval(""); enum E { target = 1, other = KEY } }"#,
        false,
        "function",
    ),
    (
        r#"const target = 0; namespace N { export const target = 1; eval(""); KEY; }"#,
        true,
        "namespace",
    ),
    (
        "const target = 0; namespace N { export const target = 1; \
         function g() { eval(\"\"); KEY; } }",
        true,
        "function",
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

fn define_head(w: &Workspace<'_>, root: &str, head: &str) -> DefineHead {
    let root = match root {
        "import.meta" => DefineRoot::ImportMeta,
        name => DefineRoot::Global(w.atom(name)),
    };
    DefineHead {
        root,
        head: w.atom(head),
        renames_root: false,
    }
}

fn define_roots(w: &Workspace<'_>, hir: &File<'_>) -> Vec<ExprId> {
    let key = w.atom("KEY");
    find_exprs(hir, |kind| match *kind {
        ExprKind::Ident(name) => name == key,
        ExprKind::ImportMeta => true,
        _ => false,
    })
}

fn first_scope_of(bound: &Bound<'_>, keyword: &str) -> ScopeId {
    let index = bound.scopes.iter().position(|scope| match scope.kind {
        ScopeKind::Module(_) => keyword == "namespace",
        ScopeKind::Fn(_) => keyword == "function",
        ScopeKind::With(_) => keyword == "with",
        _ => false,
    });
    ScopeId(index.unwrap() as u32)
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
fn var_beside_its_export_declares_the_exported_binding() {
    for text in [
        "export var v = 1; var v = 2; v;",
        "var v = 1; export var v = 2; v;",
        "export var v = 1; for (var v = 2; ; ) {} v;",
        "export var v = 1; for (var v of []) {} v;",
        "export var v = 1; { var v = 2; } v;",
        "export var v = 1; var [v] = [2]; v;",
        "export var [v] = [1]; var { v } = { v: 2 }; v;",
    ] {
        analyzed("a.mjs", text, |s| {
            let Symbol(exported) = s.binding("v", 0) else {
                panic!("{text}: {:?}", s.binding("v", 0));
            };
            assert_eq!(s.bound.symbol(exported).parent, s.bound.file_symbol);
            for nth in 0..2 {
                let name = s.pat("v", nth);
                assert_eq!(
                    s.bound.initialized_binding(name),
                    Symbol(exported),
                    "{text}"
                );
                assert_eq!(s.bound.declared_symbol(Decl::Var(name)), exported, "{text}");
            }
            assert!(!s.bound.is_stable_binding(exported), "{text}");
        });
    }
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
fn first_name_of_a_define_path_is_looked_up_where_the_root_is_written() {
    with_workspace(|w| {
        let text = "function f(target) { KEY; typeof KEY; KEY.member; other; } KEY;";
        let names = ["target", "arguments", "module", "absent"];
        let heads = names.map(|head| define_head(w, "KEY", head));
        let (hir, bound) = w.bind_with_heads(&Source::new("a.cjs", text), &heads);
        let record = |root: ExprId, head: &str, binding: Binding| ImplicitReference {
            node: NodeData::Expr(root),
            kind: ImplicitReferenceKind::DefineHead,
            name: w.atom(head),
            binding,
        };
        let parameter = Symbol(bound.declared_symbol(Decl::Param(w.pat(&hir, "target", 0))));
        let function = CodeUnit::Function(w.function(&hir, "f"));
        let module = Binding::CommonJs(CommonJsVariable::Module);
        let mut expected = Vec::new();
        for nth in 0..3 {
            let root = w.ident(&hir, "KEY", nth);
            expected.push(record(root, "target", parameter));
            expected.push(record(root, "arguments", Arguments(function)));
            expected.push(record(root, "module", module));
        }
        let at_top_level = w.ident(&hir, "KEY", 3);
        let arguments_of_file = Arguments(CodeUnit::File);
        expected.push(record(at_top_level, "arguments", arguments_of_file));
        expected.push(record(at_top_level, "module", module));
        assert_eq!(bound.runtime.implicit_references(), expected);
        for reference in &expected {
            let NodeData::Expr(root) = reference.node else {
                panic!("{reference:?}");
            };
            assert_eq!(bound.define_head(root, reference.name), Some(reference));
        }
        assert_eq!(bound.define_head(at_top_level, w.atom("target")), None);
        let other = w.ident(&hir, "other", 0);
        assert_eq!(bound.define_head(other, w.atom("target")), None);
    });
    with_workspace(|w| {
        let text =
            "function f(target: number) { let queried: typeof KEY; import.meta; } import.meta;";
        let heads = ["KEY", "import.meta"].map(|root| define_head(w, root, "target"));
        let (hir, bound) = w.bind_with_heads(&Source::new("a.mts", text), &heads);
        let target = w.atom("target");
        assert_eq!(bound.define_head(w.ident(&hir, "KEY", 0), target), None);
        let parameter = Symbol(bound.declared_symbol(Decl::Param(w.pat(&hir, "target", 0))));
        let metas = find_exprs(&hir, |kind| matches!(kind, ExprKind::ImportMeta));
        let found = metas.iter().map(|&meta| {
            let reference = bound.define_head(meta, target);
            reference.map(|reference| reference.binding)
        });
        assert_eq!(
            found.collect::<Vec<Option<Binding>>>(),
            [Some(parameter), None]
        );
    });
}

#[test]
fn first_name_of_a_define_path_is_looked_up_only_where_a_define_may_apply() {
    for &(path, text, root, is_looked_up) in ROOTS_OF_DEFINES {
        with_workspace(|w| {
            let heads = [define_head(w, root, "target")];
            let (hir, bound) = w.bind_with_heads(&Source::new(path, text), &heads);
            let found = bound.define_head(w.ident(&hir, root, 0), w.atom("target"));
            assert_eq!(found.is_some(), is_looked_up, "{text}");
        });
    }
}

#[test]
fn first_name_of_a_define_path_is_looked_up_as_the_name_written_beside_the_root() {
    for &(path, head, text) in DEFINE_HEADS_BESIDE_THE_NAME {
        with_workspace(|w| {
            let heads = ["KEY", "import.meta"].map(|root| define_head(w, root, head));
            let (hir, bound) = w.bind_with_heads(&Source::new(path, text), &heads);
            let name = w.atom(head);
            let roots = define_roots(w, &hir);
            let is_name =
                |kind: &ExprKind| matches!(*kind, ExprKind::Ident(found) if found == name);
            let beside = find_exprs(&hir, is_name);
            assert_eq!(roots.len(), beside.len(), "{text}");
            for (&root, &written) in roots.iter().zip(&beside) {
                let binding = bound.binding(written);
                let scope = bound.dynamic_lookup_scope(NodeData::Expr(written));
                let lookup = scope.map(|scope| DynamicLookup {
                    scope,
                    is_behind_eval_variables: bound.dynamic_lookup_end(written, scope) != scope,
                });
                let is_recorded = binding != Free || lookup.is_some();
                let expected = is_recorded.then_some(ImplicitReference {
                    node: NodeData::Expr(root),
                    kind: ImplicitReferenceKind::DefineHead,
                    name,
                    binding,
                });
                let found = bound.define_head(root, name);
                assert_eq!(found, expected.as_ref(), "{text}");
                let found_lookup = found.and_then(|reference| bound.dynamic_scope_of(reference));
                assert_eq!(found_lookup, lookup, "{text}");
            }
        });
    }
}

#[test]
fn first_name_of_a_define_path_is_a_variable_of_the_code_that_runs() {
    for &(path, text) in NAMES_THAT_ARE_NO_VARIABLES {
        with_workspace(|w| {
            let heads = [define_head(w, "KEY", "target")];
            let (hir, bound) = w.bind_with_heads(&Source::new(path, text), &heads);
            let roots = define_roots(w, &hir);
            assert!(!roots.is_empty(), "{text}");
            for root in roots {
                assert_eq!(bound.define_head(root, w.atom("target")), None, "{text}");
            }
        });
    }
    for &text in VARIABLES_AROUND_WHAT_IS_NO_VARIABLE {
        with_workspace(|w| {
            let heads = [define_head(w, "KEY", "target")];
            let (hir, bound) = w.bind_with_heads(&Source::new("a.ts", text), &heads);
            let outer = Symbol(bound.declared_symbol(Decl::Var(w.pat(&hir, "target", 0))));
            let found = bound.define_head(w.ident(&hir, "KEY", 0), w.atom("target"));
            assert_eq!(
                found.map(|reference| reference.binding),
                Some(outer),
                "{text}"
            );
        });
    }
}

#[test]
fn first_name_of_a_define_path_is_looked_for_where_the_code_that_runs_may_declare_it() {
    for &(text, has_variable, keyword) in DYNAMIC_SCOPES_AROUND_WHAT_IS_NO_VARIABLE {
        with_workspace(|w| {
            let heads = ["KEY", "import.meta"].map(|root| define_head(w, root, "target"));
            let (hir, bound) = w.bind_with_heads(&Source::new("a.cts", text), &heads);
            let [root] = define_roots(w, &hir)[..] else {
                panic!("{text}");
            };
            let binding = match has_variable {
                true => Symbol(bound.declared_symbol(Decl::Var(w.pat(&hir, "target", 0)))),
                false => Free,
            };
            let found = bound.define_head(root, w.atom("target"));
            assert_eq!(
                found.map(|reference| reference.binding),
                Some(binding),
                "{text}"
            );
            let lookup = found.and_then(|reference| bound.dynamic_scope_of(reference));
            let expected = DynamicLookup {
                scope: first_scope_of(&bound, keyword),
                is_behind_eval_variables: false,
            };
            assert_eq!(lookup, Some(expected), "{text}");
        });
    }
}

#[test]
fn store_to_a_name_that_a_define_renames_is_a_store_to_the_binding() {
    with_workspace(|w| {
        let text = "let target = 0; KEY = 1; KEY++; KEY += 2; [KEY] = a; for (KEY of a); \
                    PATH = 3; function f(KEY) { KEY = 4; } with (o) { KEY = 5; }";
        let heads = [
            DefineHead {
                renames_root: true,
                ..define_head(w, "KEY", "target")
            },
            define_head(w, "PATH", "target"),
        ];
        let (hir, bound) = w.bind_with_heads(&Source::new("a.cjs", text), &heads);
        let target = bound.declared_symbol(Decl::Var(w.pat(&hir, "target", 0)));
        let stores = bound.stores_to(target).iter();
        let stores: Vec<(ExprId, StoreKind)> =
            stores.map(|store| (store.target, store.kind)).collect();
        let kinds = [
            StoreKind::Assign,
            StoreKind::Update(UnOp::PostInc),
            StoreKind::CompoundAssign(BinOp::Add),
            StoreKind::Destructure,
            StoreKind::ForOf,
        ];
        let expected = (0..)
            .zip(kinds)
            .map(|(nth, kind)| (w.ident(&hir, "KEY", nth), kind));
        assert_eq!(stores, expected.collect::<Vec<(ExprId, StoreKind)>>());
    });
}

#[test]
fn first_name_of_a_define_path_counts_for_arguments_and_for_the_own_require() {
    with_workspace(|w| {
        let text = "function f() { KEY; } function g() { other; }";
        let heads = [define_head(w, "KEY", "arguments")];
        let (hir, bound) = w.bind_with_heads(&Source::new("a.cjs", text), &heads);
        let uses_arguments = |name: &str| {
            let flags = bound.function_flags(w.function(&hir, name));
            flags.contains(FunctionFlags::USES_ARGUMENTS)
        };
        assert!(uses_arguments("f"));
        assert!(!uses_arguments("g"));
        assert!(!bound.file_uses_arguments());
    });
    let rows = [
        ("arguments", true, false),
        ("require", false, true),
        ("module", false, true),
        ("__filename", false, true),
        ("exports", false, false),
        ("target", false, false),
    ];
    for (head, file_uses_arguments, may_name_own_require) in rows {
        with_workspace(|w| {
            let heads = [define_head(w, "KEY", head)];
            let (_, bound) = w.bind_with_heads(&Source::new("a.cjs", "KEY;"), &heads);
            assert_eq!(bound.file_uses_arguments(), file_uses_arguments, "{head}");
            assert_eq!(bound.may_name_own_require(), may_name_own_require, "{head}");
        });
    }
}

#[test]
fn define_heads_are_recorded_in_front_of_jsx_roots_and_metadata_names() {
    with_workspace(|w| {
        let text = "declare function d(...a: any[]): any; class Foo {} class C { @d a: Foo; } \
                    function f(target) { return [<a />, <></>, KEY, KEY]; }";
        let react = Some(w.atom("React"));
        let runtime = RuntimeBindOptions {
            jsx_factory_root: react,
            jsx_fragment_root: react,
            emits_decorator_metadata: true,
            ..Default::default()
        };
        let source = Source {
            experimental_decorators: true,
            runtime,
            ..Source::new("a.tsx", text)
        };
        let heads = [define_head(w, "KEY", "target")];
        let (_, bound) = w.bind_with_heads(&source, &heads);
        let references = bound.runtime.implicit_references();
        let part = |reference: &ImplicitReference| match reference.kind {
            ImplicitReferenceKind::DefineHead => 0,
            ImplicitReferenceKind::JsxFactory | ImplicitReferenceKind::JsxFragment => 1,
            ImplicitReferenceKind::DecoratorMetadata(_) => 2,
        };
        let parts: Vec<u8> = references.iter().map(part).collect();
        assert_eq!(parts, [0, 0, 1, 1, 1, 2], "{references:?}");
        for reference in references {
            match (reference.kind, reference.node) {
                (ImplicitReferenceKind::DecoratorMetadata(recorded), _) => {
                    let found = find_metadata_binding(references, recorded);
                    assert_eq!(found, Some(reference.binding));
                }
                (ImplicitReferenceKind::DefineHead, NodeData::Expr(root)) => {
                    let found = bound.define_head(root, reference.name);
                    assert_eq!(found, Some(reference));
                }
                _ => {}
            }
        }
    });
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
