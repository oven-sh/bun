use bun_ast::runtime::ReactCompilerMode;
use bun_ast::{Loader, Log};
use bun_lint_react_compiler::code_generation::GenerationError;
use bun_sema::fold::{Constant, Decision};
use bun_sema::hir::{ExprTag, FnBody};
use bun_sema::hir_from_data::{DataValue, HostValue};
use bun_sema::resolve::TreeChange;

use super::{
    COMPILER_RUNTIME, HELLO, MAIN_PATH, RULE, Tree, UNTYPED_HELLO, with_compiled_tree,
    with_project, with_tree, with_workbench,
};
use crate::compile::testing::default_settings;
use crate::diagnostics::{Diagnostics, LoadMessages};
use crate::load::react_compiler::ReactCompiler;

struct NodeShapes {
    expressions: Vec<(ExprTag, u32, u32)>,
    statement_starts: Vec<u32>,
    type_ranges: Vec<(u32, u32)>,
    function_count: usize,
}

fn node_shapes(text: &str, mode: ReactCompilerMode) -> NodeShapes {
    with_tree("main.tsx", text, mode, |tree| {
        let hir = tree.hir();
        let expressions = hir.exprs.iter();
        NodeShapes {
            expressions: expressions
                .map(|it| (it.kind.tag(), it.pos, it.end))
                .collect(),
            statement_starts: hir.stmts.iter().map(|it| it.start).collect(),
            type_ranges: hir.types.iter().map(|it| (it.pos, it.end)).collect(),
            function_count: hir.fns.len(),
        }
    })
}

fn write_messages(messages: &LoadMessages) -> (Log, bool) {
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_load_messages(messages);
    assert!(diagnostics.has_errors());
    let has_internal_errors = diagnostics.has_internal_errors();
    let mut log = Log::init();
    diagnostics.write_to(&mut log);
    (log, has_internal_errors)
}

#[test]
fn applies_to_jsx_loaders_outside_node_modules() {
    use ReactCompilerMode::{Client, Disabled, Ssr};
    let messages = LoadMessages::default();
    for (mode, path, loader, expected) in [
        (Client, "/project/a.tsx", Loader::Tsx, true),
        (Client, "/project/a.js", Loader::Jsx, true),
        (Ssr, "/project/a.tsx", Loader::Tsx, true),
        (Client, "/project/a.ts", Loader::Ts, false),
        (Client, "/project/a.mjs", Loader::Js, false),
        (Client, "/project/a.json", Loader::Json, false),
        (Client, "/project/node_modules/p/a.tsx", Loader::Tsx, false),
        (Disabled, "/project/a.tsx", Loader::Tsx, false),
    ] {
        let compiler = ReactCompiler::new(mode, &messages);
        let applies = compiler.applies_to(path.as_bytes(), loader);
        assert_eq!(applies, expected, "{mode:?} {path}");
    }
}

#[test]
fn disabled_mode_changes_nothing() {
    with_workbench(HELLO, |bench| {
        let messages = LoadMessages::default();
        let compiler = ReactCompiler::new(ReactCompilerMode::Client, &messages);
        let (bound, analysis) = bench.analyze(&[]);
        let nodes = bench.tree.exprs.as_ptr();

        let (change, source) = bench.transform(ReactCompilerMode::Disabled, &bound, &analysis);
        assert_eq!(change, TreeChange::Unchanged);
        assert!(!source.has_compiled_components);
        assert!(!compiler.needs_declarations(&source));
        assert_eq!(bench.tree.exprs.as_ptr(), nodes);

        let (change, source) = bench.transform(ReactCompilerMode::Client, &bound, &analysis);
        assert_eq!(change, TreeChange::Changed);
        assert!(source.has_compiled_components);
        assert!(compiler.needs_declarations(&source));
        assert_ne!(bench.tree.exprs.as_ptr(), nodes);
    });
}

#[test]
fn file_without_components_is_not_copied() {
    let no_candidate = "export const x: number = 1;\n\
                        export function double(value: number) { return value * 2; }\n";
    let no_component = "export function Plain() { return 1; }\n";
    for text in [no_candidate, no_component] {
        with_workbench(text, |bench| {
            let (bound, analysis) = bench.analyze(&[]);
            let nodes = bench.tree.exprs.as_ptr();
            let (change, source) = bench.transform(ReactCompilerMode::Client, &bound, &analysis);
            assert_eq!(change, TreeChange::Unchanged, "{text}");
            assert!(!source.has_compiled_components, "{text}");
            assert_eq!(bench.tree.exprs.as_ptr(), nodes, "{text}");
        });
    }
}

#[test]
fn node_modules_file_is_not_compiled() {
    let main = "export { Hello as Installed } from 'widgets';\n\
                export { Hello } from './widget.jsx';\n";
    let manifest = r#"{"name":"widgets","version":"1.0.0","main":"index.jsx"}"#;
    let files = [
        ("main.tsx", main),
        ("widget.jsx", UNTYPED_HELLO),
        ("node_modules/widgets/package.json", manifest),
        ("node_modules/widgets/index.jsx", UNTYPED_HELLO),
    ];
    with_project(
        &files,
        &default_settings(),
        ReactCompilerMode::Client,
        |project| {
            let installed = Tree::new(project, "node_modules/widgets/index.jsx");
            assert!(!installed.has_compiled_components());
            assert_eq!(installed.count_jsx_elements(), 1);
            assert!(installed.imported_names(COMPILER_RUNTIME).is_empty());

            let own = Tree::new(project, "widget.jsx");
            assert!(own.has_compiled_components());
            assert_eq!(own.count_jsx_elements(), 0);
        },
    );
}

#[test]
fn ts_loader_without_jsx_is_not_compiled() {
    let text = "export function useDouble(value: number) {\n\
                useState(value);\n\
                return [value * 2];\n\
                }\n";
    let is_compiled = |name: &str| {
        let mode = ReactCompilerMode::Client;
        with_tree(name, text, mode, |tree| tree.has_compiled_components())
    };
    assert!(!is_compiled("main.ts"));
    assert!(is_compiled("main.tsx"));
}

#[test]
fn commonjs_file_is_left_as_written() {
    let text = "function Rule() { return <hr />; }\nmodule.exports = Rule;\n";
    with_tree("main.jsx", text, ReactCompilerMode::Client, |tree| {
        assert!(!tree.has_compiled_components());
        assert_eq!(tree.count_jsx_elements(), 1);
        assert!(tree.imported_names(COMPILER_RUNTIME).is_empty());
    });
}

#[test]
fn use_no_memo_opts_out() {
    with_compiled_tree(&["'use no memo';\n", HELLO].concat(), |tree| {
        assert!(!tree.has_compiled_components());
        assert_eq!(tree.count_jsx_elements(), 1);
    });

    let skipped = "export function Skipped() {\n\
                   'use no memo';\n\
                   return <hr />;\n\
                   }\n";
    with_compiled_tree(&[skipped, HELLO].concat(), |tree| {
        assert!(tree.has_compiled_components());
        assert_eq!(tree.cache_size(tree.function_named("Skipped")), None);
        assert!(tree.cache_size(tree.function_named("Hello")).is_some());
        assert_eq!(tree.count_jsx_elements(), 1);
    });
}

#[test]
fn plain_function_is_left_alone() {
    let text = [
        "function double(value: number) {\nreturn value * 2;\n}\n",
        HELLO,
    ]
    .concat();
    let record_of_double = |mode: ReactCompilerMode| {
        with_tree("main.tsx", &text, mode, |tree| {
            let function = tree.hir()[tree.function_named("double")];
            let FnBody::Block(body) = function.body else {
                panic!("expected a block");
            };
            (tree.has_compiled_components(), function.params, body)
        })
    };
    let (is_compiled, parameters, body) = record_of_double(ReactCompilerMode::Client);
    assert!(is_compiled);
    assert_eq!(
        (false, parameters, body),
        record_of_double(ReactCompilerMode::Disabled)
    );
}

#[test]
fn rule_violation_leaves_the_function_as_written() {
    let broken = "export function Broken(props: { on: boolean }) {\n\
                  if (props.on) {\n\
                  useState(0);\n\
                  }\n\
                  return <div />;\n\
                  }\n";
    with_compiled_tree(&[broken, RULE].concat(), |tree| {
        assert!(tree.has_compiled_components());
        assert_eq!(tree.cache_size(tree.function_named("Broken")), None);
        assert!(tree.cache_size(tree.function_named("Rule")).is_some());
        assert_eq!(tree.count_jsx_elements(), 1);
    });
    with_compiled_tree(broken, |tree| assert!(!tree.has_compiled_components()));
}

#[test]
fn generation_error_is_a_build_error() {
    let messages = LoadMessages::default();
    let compiler = ReactCompiler::new(ReactCompilerMode::Client, &messages);
    let error = GenerationError {
        text: "Invalid type configuration for module".to_owned(),
    };
    compiler.report_generation_error(&error, MAIN_PATH);
    let (log, has_internal_errors) = write_messages(&messages);
    assert!(!has_internal_errors);
    assert_eq!((log.msgs.len(), log.errors), (1, 1));
    let expected =
        b"React Compiler: Invalid type configuration for module in \"/project/main.tsx\"";
    assert_eq!(&*log.msgs[0].data.text, expected);
}

#[test]
fn unsupported_node_is_an_internal_error() {
    let messages = LoadMessages::default();
    let compiler = ReactCompiler::new(ReactCompilerMode::Client, &messages);
    compiler.report_unsupported_node("EClass", MAIN_PATH);
    let (log, has_internal_errors) = write_messages(&messages);
    assert!(has_internal_errors);
    assert_eq!(log.msgs.len(), 1);
    let expected = b"React Compiler output has a EClass node in /project/main.tsx";
    assert!(log.msgs[0].data.text.ends_with(expected));
}

#[test]
fn existing_ids_keep_their_nodes() {
    let text = ["const limit: number = 2 * 3;\n", HELLO, RULE].concat();
    let written = node_shapes(&text, ReactCompilerMode::Disabled);
    let compiled = node_shapes(&text, ReactCompilerMode::Client);
    assert!(compiled.expressions.len() > written.expressions.len());
    assert_eq!(
        compiled.expressions[..written.expressions.len()],
        written.expressions[..]
    );
    assert!(compiled.statement_starts.len() > written.statement_starts.len());
    let statement_count = written.statement_starts.len();
    assert_eq!(
        compiled.statement_starts[..statement_count],
        written.statement_starts[..]
    );
    assert_eq!(
        compiled.type_ranges[..written.type_ranges.len()],
        written.type_ranges[..]
    );
    assert_eq!(compiled.function_count, written.function_count);
}

#[test]
fn macro_result_survives_the_transform() {
    let text = "import { version } from './macro.ts' with { type: 'macro' };\n\
                export const built = version();\n\
                export function Hello({ name }: { name: string }) {\n\
                return <div>{name}{built}</div>;\n\
                }\n";
    with_workbench(text, |bench| {
        let arena = bench.arena;
        let (_, analysis) = bench.analyze(&[]);
        let [call] = *analysis.pending_macro_calls else {
            panic!("expected one macro call");
        };
        let result = &*arena.alloc(DataValue::Number(7.0));
        let host_values = &*arena.alloc_slice_copy(&[(call, HostValue::Data(result))]);

        let (bound, analysis) = bench.analyze(host_values);
        let decided = Decision::Constant(Constant::Number(7.0));
        assert!(analysis.pending_macro_calls.is_empty());
        assert_eq!(analysis.decisions.decision(call), decided);

        let (change, _) = bench.transform(ReactCompilerMode::Client, &bound, &analysis);
        assert_eq!(change, TreeChange::Changed);
        let (_, analysis) = bench.analyze(host_values);
        assert!(analysis.pending_macro_calls.is_empty());
        assert_eq!(analysis.decisions.decision(call), decided);
    });
}
