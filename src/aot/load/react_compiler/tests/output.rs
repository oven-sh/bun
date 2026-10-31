use bun_ast::runtime::ReactCompilerMode;
use bun_sema::bind::Parent;
use bun_sema::fold::Decision;
use bun_sema::hir::{BinOp, ExprId, ExprKind, FnBody, FnKind, StmtId, StmtKind};
use bun_sema::resolve::{JsxRuntime, JsxSettings, TranspileSettings, TreeChange};

use super::{
    CACHE_FUNCTION, CACHE_IMPORT, COMPILER_RUNTIME, DEVELOPMENT_RUNTIME, HELLO, PRODUCTION_RUNTIME,
    RULE, production_settings, settings_with_jsx, with_compiled_tree, with_defines, with_tree,
    with_tree_and_settings,
};

const MEMO_CACHE_SENTINEL: &str = "%react:memo_cache_sentinel";
const EARLY_RETURN_SENTINEL: &str = "%react:early_return_sentinel";
const JSX_DEV_IMPORT: &str = "jsxDEV as %react:jsxDEV";

fn classic_settings(factory: &[&str]) -> TranspileSettings {
    settings_with_jsx(JsxSettings {
        runtime: JsxRuntime::Classic,
        factory: factory
            .iter()
            .map(|name| name.as_bytes().to_vec())
            .collect(),
        ..JsxSettings::default()
    })
}

#[test]
fn component_reads_and_writes_the_cache() {
    with_compiled_tree(HELLO, |tree| {
        assert!(tree.has_compiled_components());
        assert_eq!(tree.imported_names(COMPILER_RUNTIME), [CACHE_IMPORT]);
        assert_eq!(tree.cache_size(tree.function_named("Hello")), Some(2.0));
        assert_eq!(tree.count_cache_comparisons(BinOp::NotEqEq), 1);
        assert_eq!(tree.count_cache_writes(), 2);
        assert_eq!(tree.count_jsx_elements(), 0);
    });
}

#[test]
fn hook_is_compiled() {
    let text = "export function useDouble(value: number) {\n\
                const [state] = useState(value);\n\
                return [state, value * 2];\n\
                }\n";
    with_compiled_tree(text, |tree| {
        assert!(tree.has_compiled_components());
        assert!(tree.cache_size(tree.function_named("useDouble")).is_some());
        assert!(tree.count_cache_writes() > 0);
        assert!(tree.imported_names(DEVELOPMENT_RUNTIME).is_empty());
    });
}

#[test]
fn memo_and_forward_ref_arguments_are_compiled() {
    let text = "import { forwardRef, memo } from 'react';\n\
                export const Label = memo(({ text }: { text: string }) => <span>{text}</span>);\n\
                export const Field = forwardRef(function (props: { id: string }, ref: unknown) {\n\
                return <input id={props.id} />;\n\
                });\n";
    with_compiled_tree(text, |tree| {
        let label = tree.wrapped_function("Label");
        assert_eq!(tree.hir()[label].kind, FnKind::Arrow);
        assert!(matches!(tree.hir()[label].body, FnBody::Block(_)));
        assert!(tree.cache_size(label).is_some());

        let field = tree.wrapped_function("Field");
        assert_eq!(tree.hir()[field].kind, FnKind::Expr);
        assert_eq!(tree.hir()[field].params.len(), 2);
        assert!(tree.cache_size(field).is_some());
        assert_eq!(tree.count_jsx_elements(), 0);
    });
}

#[test]
fn default_export_is_compiled() {
    with_compiled_tree(
        "export default function Page() { return <hr />; }\n",
        |tree| {
            assert_eq!(tree.cache_size(tree.function_named("Page")), Some(1.0));
        },
    );
}

#[test]
fn two_components_share_one_import() {
    with_compiled_tree(&[HELLO, RULE].concat(), |tree| {
        assert!(tree.cache_size(tree.function_named("Hello")).is_some());
        assert!(tree.cache_size(tree.function_named("Rule")).is_some());
        assert_eq!(tree.imports_from(COMPILER_RUNTIME).len(), 1);
        assert_eq!(tree.imported_names(COMPILER_RUNTIME), [CACHE_IMPORT]);
        assert_eq!(tree.imports_from(DEVELOPMENT_RUNTIME).len(), 1);
        assert_eq!(tree.imported_names(DEVELOPMENT_RUNTIME), [JSX_DEV_IMPORT]);
        assert_eq!(tree.calls_of(CACHE_FUNCTION).len(), 2);
    });
}

#[test]
fn generated_imports_are_plain_value_imports() {
    with_compiled_tree(HELLO, |tree| {
        for specifier in [COMPILER_RUNTIME, DEVELOPMENT_RUNTIME] {
            let [import] = tree.imports_from(specifier)[..] else {
                panic!("expected one import of {specifier}");
            };
            assert!(import.has_named_imports && !import.type_only && !import.is_deferred);
            assert!(import.default.is_none() && import.namespace.is_none());
            assert!(import.attributes.is_none());
        }
    });
}

#[test]
fn outlined_function_is_appended() {
    let text = "export function List({ items }: { items: string[] }) {\n\
                return <ul>{items.map(item => <li>{item}</li>)}</ul>;\n\
                }\n";
    with_compiled_tree(text, |tree| {
        let name = "%react:outlined:0";
        let last = *tree.top_level_statements().last().unwrap();
        let StmtKind::Fn(outlined) = tree.hir()[last].kind else {
            panic!("expected a function declaration");
        };
        assert_eq!(outlined, tree.function_named(name));
        assert_eq!(tree.hir()[outlined].kind, FnKind::Decl);
        assert_eq!(tree.hir()[outlined].params.len(), 1);
        assert_eq!(tree.count_names(name), 1);
        assert_eq!(tree.cache_size(outlined), None);
    });
}

#[test]
fn function_with_captures_is_not_outlined() {
    let text = "export function List({ items, label }: { items: string[]; label: string }) {\n\
                return <ul>{items.map(item => <li>{label}{item}</li>)}</ul>;\n\
                }\n";
    with_compiled_tree(text, |tree| {
        assert!(tree.cache_size(tree.function_named("List")).is_some());
        assert_eq!(tree.count_names("%react:outlined:0"), 0);
        let last = *tree.top_level_statements().last().unwrap();
        let StmtKind::Fn(function) = tree.hir()[last].kind else {
            panic!("expected a function declaration");
        };
        assert_eq!(function, tree.function_named("List"));
    });
}

#[test]
fn local_never_shares_a_name_with_an_outside_variable() {
    let temporary = "let t0 = 0;\n\
                     export function View(p: { n: number }) {\n\
                     const save = () => {\n\
                     t0 = p.n;\n\
                     };\n\
                     return <button onClick={save}>{p.n}</button>;\n\
                     }\n";
    let block_scoped = "let count = 0;\n\
                        export function View(p: { n: number }) {\n\
                        let text = '';\n\
                        {\n\
                        const count = p.n * 2;\n\
                        text = 'twice ' + count;\n\
                        }\n\
                        const save = () => {\n\
                        count = p.n;\n\
                        };\n\
                        return <button onClick={save}>{text}</button>;\n\
                        }\n";
    let cache = temporary.replace("t0", "$");
    for (name, text) in [
        ("t0", temporary),
        ("count", block_scoped),
        ("$", cache.as_str()),
    ] {
        with_compiled_tree(text, |tree| {
            assert!(tree.has_compiled_components());
            let (hir, bound) = (tree.hir(), tree.files.bound(tree.file));
            let outside = bound.pat_symbol[tree.declaration_named(name).pat.idx()];
            let targets = tree
                .reachable_expressions()
                .filter_map(|it| match hir[it].kind {
                    ExprKind::Assign { target, value, .. }
                        if tree.is_name(target, name) && tree.member_path(value) == ["p", "n"] =>
                    {
                        Some(bound.symbol_of_expr(target))
                    }
                    _ => None,
                });
            assert_eq!(targets.collect::<Vec<_>>(), [outside], "{name}");
        });
    }
}

#[test]
fn local_never_shares_a_name_with_the_first_name_of_a_define() {
    let temporary = "declare const NAME: string;\n\
                     export function View({ title }: { title: string }) {\n\
                     return <p>{NAME}{title}</p>;\n\
                     }\n";
    let block_scoped = "declare const NAME: string;\n\
                        export function View({ title }: { title: string }) {\n\
                        let text = '';\n\
                        {\n\
                        const count = title.length * 2;\n\
                        text = 'twice ' + count;\n\
                        }\n\
                        return <p>{NAME}{text}</p>;\n\
                        }\n";
    // The output calls the parameter `t0` and the cache `$`. Where `NAME` is written, nothing declares the name that the define gives it.
    for (name, text) in [("t0", temporary), ("count", block_scoped), ("$", temporary)] {
        with_defines(text, &[("NAME", name)], |bench| {
            let (bound, analysis) = bench.analyze(&[]);
            let (change, _) = bench.transform(ReactCompilerMode::Client, &bound, &analysis);
            assert_eq!(change, TreeChange::Changed, "{name}");

            let (bound, analysis) = bench.analyze(&[]);
            let (hir, atoms) = (&bench.tree, &bench.atoms);
            let written = |spelled: &[u8]| {
                let spelled = atoms.intern(spelled);
                let is_written = |it: &ExprId| {
                    matches!(hir[*it].kind, ExprKind::Ident(found) if found == spelled)
                        && bound.parent_of_expr(*it) != Parent::None
                };
                let expressions = (0..hir.exprs.len() as u32).map(ExprId);
                expressions.filter(is_written).collect::<Vec<_>>()
            };
            let local = [&b"%react:local:"[..], name.as_bytes()].concat();
            assert!(!written(&local).is_empty(), "{name}");
            let first_name_at = |it: ExprId| match analysis.decisions.decision(it) {
                Decision::GlobalPath(path) => path.first().copied(),
                _ => None,
            };
            let mut first_names: Vec<_> = written(b"NAME").into_iter().map(first_name_at).collect();
            first_names.dedup();
            assert_eq!(first_names, [Some(atoms.intern(name.as_bytes()))], "{name}");
        });
    }
}

#[test]
fn constant_element_uses_the_memo_cache_sentinel() {
    with_compiled_tree(RULE, |tree| {
        assert_eq!(tree.cache_size(tree.function_named("Rule")), Some(1.0));
        let key = tree.sentinel_key(MEMO_CACHE_SENTINEL);
        assert_eq!(key.as_deref(), Some("react.memo_cache_sentinel"));
        assert_eq!(tree.count_names(MEMO_CACHE_SENTINEL), 1);
        assert_eq!(tree.count_cache_comparisons(BinOp::EqEqEq), 1);
        assert_eq!(tree.sentinel_key(EARLY_RETURN_SENTINEL), None);
    });
    with_compiled_tree(HELLO, |tree| {
        assert_eq!(tree.sentinel_key(MEMO_CACHE_SENTINEL), None);
        assert_eq!(tree.count_names(MEMO_CACHE_SENTINEL), 0);
    });
}

#[test]
fn early_return_uses_the_sentinel() {
    let text = "export function useItems(props: { cond: boolean; a: number; b: number }) {\n\
                useState(0);\n\
                let x: number[] = [];\n\
                if (props.cond) {\n\
                x.push(props.a);\n\
                return x;\n\
                } else {\n\
                return [props.b];\n\
                }\n\
                }\n";
    with_compiled_tree(text, |tree| {
        assert!(tree.cache_size(tree.function_named("useItems")).is_some());
        let key = tree.sentinel_key(EARLY_RETURN_SENTINEL);
        assert_eq!(key.as_deref(), Some("react.early_return_sentinel"));
        assert_eq!(tree.count_names(EARLY_RETURN_SENTINEL), 2);

        let hir = tree.hir();
        let labels: Vec<_> = tree
            .reachable_statements()
            .filter_map(|statement| match hir[statement].kind {
                StmtKind::Labeled { label, .. } => Some(label),
                _ => None,
            })
            .collect();
        let [label] = labels[..] else {
            panic!("expected one labeled block");
        };
        let is_exit = |kind: StmtKind| matches!(kind, StmtKind::Break(target) if target == label);
        let exits = tree
            .reachable_statements()
            .filter(|&it| is_exit(hir[it].kind));
        assert_eq!(exits.count(), 2);
    });
}

#[test]
fn module_items_follow_the_directive_prologue() {
    with_compiled_tree(&["'use client';\n", RULE].concat(), |tree| {
        let hir = tree.hir();
        let statements = tree.top_level_statements();
        assert!(matches!(
            hir[statements[0]].kind,
            StmtKind::Directive { .. }
        ));
        let rule = tree.function_named("Rule");
        let is_rule = |statement: &StmtId| matches!(hir[*statement].kind, StmtKind::Fn(function) if function == rule);
        let generated = &statements[1..statements.iter().position(is_rule).unwrap()];
        let is_import = |statement: &StmtId| matches!(hir[*statement].kind, StmtKind::Import(_));
        let import_count = generated.iter().take_while(|it| is_import(it)).count();
        assert_eq!(import_count, 2);
        let [sentinel] = generated[import_count..] else {
            panic!("expected the sentinel after the imports");
        };
        assert!(matches!(hir[sentinel].kind, StmtKind::Var(_)));
    });
}

#[test]
fn development_uses_jsx_dev() {
    with_compiled_tree(HELLO, |tree| {
        assert_eq!(tree.imported_names(DEVELOPMENT_RUNTIME), [JSX_DEV_IMPORT]);
        assert!(tree.imported_names(PRODUCTION_RUNTIME).is_empty());
        let [call] = tree.calls_of("%react:jsxDEV")[..] else {
            panic!("expected one element");
        };
        assert_eq!(tree.hir()[call].args.len(), 6);
    });
}

#[test]
fn automatic_jsx_calls_import_the_runtime() {
    let text = "export function Hello({ name }: { name: string }) {\n\
                return <div><hr />{name}</div>;\n\
                }\n";
    with_tree_and_settings(text, &production_settings(), |tree| {
        let names = ["jsx as %react:jsx", "jsxs as %react:jsxs"];
        assert_eq!(tree.imported_names(PRODUCTION_RUNTIME), names);
        assert_eq!(tree.imports_from(PRODUCTION_RUNTIME).len(), 1);
        assert!(tree.imported_names(DEVELOPMENT_RUNTIME).is_empty());
        assert_eq!(tree.calls_of("%react:jsx").len(), 1);
        assert_eq!(tree.calls_of("%react:jsxs").len(), 1);
        assert_eq!(tree.count_jsx_elements(), 0);
    });
}

#[test]
fn fragment_is_imported_only_where_used() {
    let text = "export function Pair({ a }: { a: string }) { return <>{a}</>; }\n";
    with_compiled_tree(text, |tree| {
        let names = ["Fragment as %react:Fragment", JSX_DEV_IMPORT];
        assert_eq!(tree.imported_names(DEVELOPMENT_RUNTIME), names);
        assert_eq!(tree.count_names("%react:Fragment"), 1);
    });
    with_compiled_tree(HELLO, |tree| {
        assert_eq!(tree.count_names("%react:Fragment"), 0)
    });
}

#[test]
fn import_source_follows_settings() {
    let settings = settings_with_jsx(JsxSettings {
        import_source: b"preact".to_vec(),
        ..JsxSettings::default()
    });
    with_tree_and_settings(HELLO, &settings, |tree| {
        assert_eq!(
            tree.imported_names("preact/jsx-dev-runtime"),
            [JSX_DEV_IMPORT]
        );
        assert!(tree.imported_names(DEVELOPMENT_RUNTIME).is_empty());
        assert_eq!(tree.imported_names(COMPILER_RUNTIME), [CACHE_IMPORT]);
    });
}

#[test]
fn jsx_pragma_overrides_settings() {
    with_compiled_tree(
        &["/** @jsxImportSource preact */\n", HELLO].concat(),
        |tree| {
            assert_eq!(
                tree.imported_names("preact/jsx-dev-runtime"),
                [JSX_DEV_IMPORT]
            );
            assert!(tree.imported_names(DEVELOPMENT_RUNTIME).is_empty());
        },
    );
}

#[test]
fn classic_jsx_calls_the_factory() {
    let text = ["import { h } from 'preact';\n", RULE].concat();
    with_tree_and_settings(&text, &classic_settings(&["h"]), |tree| {
        assert!(tree.cache_size(tree.function_named("Rule")).is_some());
        assert_eq!(tree.calls_of("h").len(), 1);
        assert_eq!(tree.count_jsx_elements(), 0);
        assert!(tree.imported_names(DEVELOPMENT_RUNTIME).is_empty());
        assert!(tree.imported_names(PRODUCTION_RUNTIME).is_empty());
    });
}

#[test]
fn classic_factory_is_written_as_a_member_path() {
    let text = ["import React from 'react';\n", RULE].concat();
    let settings = classic_settings(&["React", "createElement"]);
    with_tree_and_settings(&text, &settings, |tree| {
        let hir = tree.hir();
        let factory_calls = tree.count_expressions(|kind| {
            matches!(
                kind,
                ExprKind::Call(call)
                    if tree.member_path(hir[call].callee) == ["React", "createElement"]
            )
        });
        assert_eq!(factory_calls, 1);
        assert_eq!(tree.count_jsx_elements(), 0);
    });
}

#[test]
fn ssr_mode_compiles_for_the_server() {
    let text = "import { useState } from 'react';\n\
                export function Counter() {\n\
                const [count] = useState(0);\n\
                return <div>{count}</div>;\n\
                }\n";
    with_tree("main.tsx", text, ReactCompilerMode::Ssr, |tree| {
        assert!(tree.has_compiled_components());
        assert_eq!(tree.cache_size(tree.function_named("Counter")), None);
        assert!(tree.imported_names(COMPILER_RUNTIME).is_empty());
        assert_eq!(tree.count_names("$"), 0);
        assert_eq!(tree.count_jsx_elements(), 0);
    });
    with_compiled_tree(text, |tree| {
        assert!(tree.cache_size(tree.function_named("Counter")).is_some());
        assert_eq!(tree.imported_names(COMPILER_RUNTIME), [CACHE_IMPORT]);
    });
}

#[test]
fn positions_are_source_positions() {
    let text = "export function Guard(props: { ok: boolean }) {\n\
                if (!props.ok) {\n\
                throw new Error('no');\n\
                }\n\
                return <div />;\n\
                }\n";
    with_compiled_tree(text, |tree| {
        let hir = tree.hir();
        assert!(tree.cache_size(tree.function_named("Guard")).is_some());
        let start_of = |is_wanted: fn(StmtKind) -> bool| {
            let statements = tree.reachable_statements();
            let starts = statements
                .filter(|&it| is_wanted(hir[it].kind))
                .map(|it| hir[it].start);
            starts.collect::<Vec<u32>>()
        };
        let offset_of = |token: &str| text.find(token).unwrap() as u32;
        assert_eq!(
            start_of(|kind| matches!(kind, StmtKind::Throw(_))),
            [offset_of("throw")]
        );
        assert_eq!(
            start_of(|kind| matches!(kind, StmtKind::Return(_))),
            [offset_of("return")]
        );

        let function = hir[tree.function_named("Guard")];
        assert_eq!(function.text_start, offset_of("function"));
    });
}
