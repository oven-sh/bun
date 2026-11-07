use bstr::BStr;
use bun_ast::runtime::ReactCompilerMode;
use bun_sema::hir::{
    ExprId, ExprKind, Flags, Func, Keyword, Param, TypeNodeId, TypeNodeKind, UnOp,
};
use bun_sema::program::{FileId, FileRole};
use bun_sema_driver::{check_and_lower, decide_roles};

use super::{
    HELLO, MAIN_PATH, Tree, UNTYPED_HELLO, production_settings, with_compiled_tree, with_project,
    with_tree, with_tree_and_settings,
};
use crate::compile::testing::{default_settings, link_program_with_react_compiler};
use crate::load::SourceKind;
use crate::load::react_compiler::DECLARATIONS_PATH;

const REACT_PACKAGE: [(&str, &str); 6] = [
    (
        "node_modules/react/package.json",
        r#"{"name":"react","version":"19.0.0","type":"module"}"#,
    ),
    (
        "node_modules/react/index.js",
        "export function useState(initial) {\n\
         return [initial, function () {}];\n\
         }\n",
    ),
    (
        "node_modules/react/index.d.ts",
        "export function useState<T>(initial: T): [T, (value: T) => void];\n",
    ),
    (
        "node_modules/react/jsx-dev-runtime.js",
        "export function jsxDEV(type, props) {\n\
         return { type, props };\n\
         }\n\
         export const Fragment = 'fragment';\n",
    ),
    (
        "node_modules/react/jsx-dev-runtime.d.ts",
        "export namespace JSX {\n\
         interface Element {}\n\
         interface IntrinsicElements {\n\
         [name: string]: { [attribute: string]: unknown };\n\
         }\n\
         }\n\
         export function jsxDEV(\n\
         type: unknown,\n\
         props: unknown,\n\
         key: unknown,\n\
         isStatic: boolean,\n\
         source: unknown,\n\
         self: unknown,\n\
         ): JSX.Element;\n\
         export const Fragment: unknown;\n",
    ),
    (
        "node_modules/react/compiler-runtime.js",
        "export function c(size) {\n\
         return new Array(size);\n\
         }\n",
    ),
];

type Reported = (u32, String, u32);

struct Parameter {
    name: Option<String>,
    record: Param,
    is_any: bool,
    /// The `T` of an annotation `T | undefined`.
    or_undefined: Option<TypeNodeId>,
    /// The default is `void 0 as any`.
    has_any_default: bool,
}

fn with_react_package<'a>(files: &[(&'a str, &'a str)]) -> Vec<(&'a str, &'a str)> {
    [files, &REACT_PACKAGE[..]].concat()
}

fn check_project(files: &[(&str, &str)], mode: ReactCompilerMode) -> Vec<Reported> {
    with_project(files, &default_settings(), mode, |project| {
        let (loaded, host, request) = (project.loaded, project.host, project.request);
        let files_to_check = loaded.files().compiled_files();
        let roles = decide_roles(loaded, host, request, files_to_check);
        let checked = check_and_lower(loaded, host, request, &roles, files_to_check, &|_, _| {
            Some(())
        });
        let reported = roles.diagnostics.iter().chain(&checked.diagnostics);
        reported
            .map(|reported| {
                let diagnostic = &reported.diagnostic;
                let path = BStr::new(&diagnostic.path).to_string();
                (diagnostic.code, path, diagnostic.line)
            })
            .collect()
    })
}

#[track_caller]
fn assert_both_modes_report(files: &[(&str, &str)], expected: &[Reported]) {
    for mode in [ReactCompilerMode::Disabled, ReactCompilerMode::Client] {
        assert_eq!(check_project(files, mode), expected, "{mode:?}");
    }
}

fn is_any(tree: &Tree<'_>, annotation: TypeNodeId) -> bool {
    annotation.some().is_some_and(|annotation| {
        matches!(
            tree.hir()[annotation].kind,
            TypeNodeKind::Keyword(Keyword::Any)
        )
    })
}

fn or_undefined(tree: &Tree<'_>, annotation: TypeNodeId) -> Option<TypeNodeId> {
    let hir = tree.hir();
    let TypeNodeKind::Union(members) = hir[annotation.some()?].kind else {
        return None;
    };
    let [member, undefined] = hir.ids(members).collect::<Vec<TypeNodeId>>()[..] else {
        return None;
    };
    let undefined = hir[undefined].kind;
    matches!(undefined, TypeNodeKind::Keyword(Keyword::Undefined)).then_some(member)
}

fn has_any_default(tree: &Tree<'_>, default: ExprId) -> bool {
    let hir = tree.hir();
    default
        .some()
        .is_some_and(|default| match hir[default].kind {
            ExprKind::As { expr, ty } => {
                matches!(hir[expr].kind, ExprKind::Unary { op: UnOp::Void, .. }) && is_any(tree, ty)
            }
            _ => false,
        })
}

fn parameters_in(
    name: &str,
    text: &str,
    function: &str,
    mode: ReactCompilerMode,
) -> Vec<Parameter> {
    with_tree(name, text, mode, |tree| {
        let hir = tree.hir();
        let parameters = hir[tree.function_named(function)].params.iter();
        parameters
            .map(|id| Parameter {
                name: tree.pattern_name(hir[id].pat),
                record: hir[id],
                is_any: is_any(tree, hir[id].ty),
                or_undefined: or_undefined(tree, hir[id].ty),
                has_any_default: has_any_default(tree, hir[id].default),
            })
            .collect()
    })
}

fn parameters_of(text: &str, function: &str, mode: ReactCompilerMode) -> Vec<Parameter> {
    parameters_in("main.tsx", text, function, mode)
}

fn function_record(text: &str, function: &str, mode: ReactCompilerMode) -> Func {
    with_tree("main.tsx", text, mode, |tree| {
        tree.hir()[tree.function_named(function)]
    })
}

#[test]
fn file_stays_checked() {
    let files = [("main.tsx", HELLO)];
    with_project(
        &files,
        &default_settings(),
        ReactCompilerMode::Client,
        |project| {
            let tree = Tree::new(project, "main.tsx");
            assert!(tree.has_compiled_components());
            let files = project.loaded.files();
            assert_eq!(files.role(tree.file), FileRole::Checked);
            let file_ids = (0..files.modules.len() as u32).map(FileId);
            let files_at_path =
                file_ids.filter(|&file| files.module(file).file_name() == MAIN_PATH);
            assert_eq!(files_at_path.count(), 1);

            let (loaded, host, request) = (project.loaded, project.host, project.request);
            let roles = decide_roles(loaded, host, request, files.compiled_files());
            assert_eq!(roles.role(tree.file), FileRole::Checked);
            assert!(roles.demoted.is_empty());

            assert_eq!(project.sources.kind(tree.file), SourceKind::Program);
            let paths = project.sources.module_paths(tree.file);
            assert_eq!(paths.public_path, b"/$bunfs/root/main.tsx");
        },
    );
}

#[test]
fn runtime_declarations_join_the_program() {
    let role_of_declarations = |text: &str| {
        let files = [("main.tsx", text)];
        with_project(
            &files,
            &default_settings(),
            ReactCompilerMode::Client,
            |project| {
                let files = project.loaded.files();
                let declarations = files.by_path.get(DECLARATIONS_PATH)?;
                assert_eq!(project.sources.kind(declarations), SourceKind::TypesOnly);
                Some(files.role(declarations))
            },
        )
    };
    assert_eq!(role_of_declarations(HELLO), Some(FileRole::TypesOnly));
    assert_eq!(role_of_declarations("export const x: number = 1;\n"), None);
}

#[test]
fn function_record_keeps_its_signature() {
    let text = "export function Box<T extends string>({ value }: { value: T }): unknown {\n\
                return <div>{value}</div>;\n\
                }\n";
    let written = function_record(text, "Box", ReactCompilerMode::Disabled);
    let compiled = function_record(text, "Box", ReactCompilerMode::Client);
    assert_ne!(compiled.params, written.params);
    assert!(compiled.flags.contains(Flags::EXPORT));
    assert_eq!(compiled.flags, written.flags | Flags::REPLACED_BODY);
    assert_eq!(compiled.kind, written.kind);
    assert_eq!(compiled.type_params, written.type_params);
    assert_eq!(compiled.type_params.len(), 1);
    assert!(compiled.ret.is_some());
    assert_eq!(compiled.ret, written.ret);
    assert_eq!(compiled.name_pos, written.name_pos);
    assert_eq!(compiled.anchor, written.anchor);
    assert_eq!(compiled.start, written.start);
    assert_eq!(compiled.text_start, written.text_start);
}

#[test]
fn destructured_props_keep_their_annotation() {
    let written = parameters_of(HELLO, "Hello", ReactCompilerMode::Disabled);
    let compiled = parameters_of(HELLO, "Hello", ReactCompilerMode::Client);
    assert_eq!((written.len(), compiled.len()), (1, 1));
    assert_eq!(written[0].name, None);
    assert_eq!(compiled[0].name.as_deref(), Some("t0"));
    assert!(written[0].record.ty.is_some());
    assert_eq!(compiled[0].record.ty, written[0].record.ty);
    assert!(!compiled[0].record.flags.contains(Flags::OPTIONAL));
}

#[test]
fn rest_parameter_stays_last() {
    let text = "export function useJoined(first: string, ...rest: string[]) {\n\
                useState(first);\n\
                return [first, rest];\n\
                }\n";
    let written = parameters_of(text, "useJoined", ReactCompilerMode::Disabled);
    let compiled = parameters_of(text, "useJoined", ReactCompilerMode::Client);
    assert_eq!((written.len(), compiled.len()), (2, 2));
    assert_eq!(compiled[0].name.as_deref(), Some("first"));
    assert!(!compiled[0].record.flags.contains(Flags::REST));
    assert!(compiled[1].name.is_some());
    assert!(compiled[1].record.flags.contains(Flags::REST));
    for (compiled, written) in compiled.iter().zip(&written) {
        assert!(written.record.ty.is_some());
        assert_eq!(compiled.record.ty, written.record.ty);
    }
}

#[test]
fn parameter_with_default_stays_optional() {
    let text = "export function useStep(step: number = 1) {\n\
                useState(step);\n\
                return [step];\n\
                }\n";
    let written = parameters_of(text, "useStep", ReactCompilerMode::Disabled);
    let compiled = parameters_of(text, "useStep", ReactCompilerMode::Client);
    assert_eq!((written.len(), compiled.len()), (1, 1));
    assert!(written[0].record.default.is_some());
    assert!(!written[0].record.flags.contains(Flags::OPTIONAL));
    // `(t0: number | undefined = void 0)`: the default keeps the `length` of the function.
    assert!(compiled[0].record.default.is_some());
    assert!(!compiled[0].has_any_default);
    assert!(!compiled[0].record.flags.contains(Flags::OPTIONAL));
    assert!(written[0].record.ty.is_some());
    assert_eq!(compiled[0].or_undefined, Some(written[0].record.ty));
}

#[test]
fn default_after_the_first_is_optional() {
    let text = "export function useLabel(prefix: string, suffix: string = '!', mark = '?') {\n\
                useState(prefix);\n\
                return [prefix, suffix, mark];\n\
                }\n";
    let written = parameters_of(text, "useLabel", ReactCompilerMode::Disabled);
    let compiled = parameters_of(text, "useLabel", ReactCompilerMode::Client);
    assert_eq!(compiled.len(), 3);
    assert!(compiled[0].record.default.is_none());
    assert!(!compiled[0].record.flags.contains(Flags::OPTIONAL));
    assert_eq!(compiled[0].record.ty, written[0].record.ty);
    assert!(compiled[1].record.default.is_some());
    assert!(!compiled[1].record.flags.contains(Flags::OPTIONAL));
    assert_eq!(compiled[1].or_undefined, Some(written[1].record.ty));
    assert!(compiled[2].record.default.is_none());
    assert!(compiled[2].record.flags.contains(Flags::OPTIONAL));
    assert!(compiled[2].is_any);
}

#[test]
fn unannotated_parameter_with_default_is_any() {
    let text = "export function useStep(step = 1) {\n\
                useState(step);\n\
                return [step];\n\
                }\n";
    let typescript = parameters_of(text, "useStep", ReactCompilerMode::Client);
    assert!(typescript[0].record.default.is_some());
    assert!(typescript[0].is_any && !typescript[0].has_any_default);
    // JavaScript has no annotation: there the parameter has the type of its default.
    let javascript = parameters_in("main.jsx", text, "useStep", ReactCompilerMode::Client);
    assert!(javascript[0].record.ty.is_none());
    assert!(javascript[0].has_any_default);
    for parameters in [typescript, javascript] {
        assert_eq!(parameters.len(), 1);
        assert!(!parameters[0].record.flags.contains(Flags::OPTIONAL));
    }
}

#[test]
fn default_before_required_parameter_accepts_undefined() {
    let text = "export function useRange(start: number = 0, end: number) {\n\
                useState(start);\n\
                return [start, end];\n\
                }\n";
    let written = parameters_of(text, "useRange", ReactCompilerMode::Disabled);
    let compiled = parameters_of(text, "useRange", ReactCompilerMode::Client);
    assert_eq!(compiled.len(), 2);
    assert!(compiled[0].record.default.is_some());
    assert!(!compiled[0].record.flags.contains(Flags::OPTIONAL));
    assert!(compiled[0].is_any && !written[0].is_any);
    assert_eq!(compiled[1].record.ty, written[1].record.ty);
    assert!(!compiled[1].is_any);
}

#[test]
fn generated_locals_are_any_in_typescript() {
    with_compiled_tree(HELLO, |tree| {
        assert!(is_any(tree, tree.declaration_named("t1").ty));
        assert!(tree.declaration_named("$").ty.is_none());
        assert!(tree.declaration_named("$").init.is_some());
    });
    with_tree(
        "main.jsx",
        UNTYPED_HELLO,
        ReactCompilerMode::Client,
        |tree| {
            assert!(tree.has_compiled_components());
            assert!(tree.declaration_named("t1").ty.is_none());
        },
    );
}

#[test]
fn this_argument_of_jsx_dev_has_a_type() {
    with_compiled_tree(HELLO, |tree| {
        let this_parameter = tree.hir()[tree.function_named("Hello")].this_param;
        assert!(this_parameter.is_some());
        assert!(is_any(tree, tree.hir()[this_parameter].ty));
    });
    with_tree(
        "main.jsx",
        UNTYPED_HELLO,
        ReactCompilerMode::Client,
        |tree| {
            assert!(
                tree.hir()[tree.function_named("Hello")]
                    .this_param
                    .is_none()
            );
        },
    );
    with_tree_and_settings(HELLO, &production_settings(), |tree| {
        assert!(tree.has_compiled_components());
        assert!(
            tree.hir()[tree.function_named("Hello")]
                .this_param
                .is_none()
        );
    });
}

#[test]
fn exported_component_keeps_its_type() {
    let check_call_with_name = |name: &str| {
        let main = format!(
            "import {{ Hello }} from './hello';\n\
             export const element = Hello({{ name: {name} }});\n"
        );
        let files = with_react_package(&[("main.tsx", main.as_str()), ("hello.tsx", HELLO)]);
        with_project(
            &files,
            &default_settings(),
            ReactCompilerMode::Client,
            |project| {
                assert!(Tree::new(project, "hello.tsx").has_compiled_components());
            },
        );
        check_project(&files, ReactCompilerMode::Client)
    };
    let reported = check_call_with_name("'a'");
    assert!(reported.is_empty(), "{reported:?}");
    assert_eq!(
        check_call_with_name("1"),
        [(2322, "/project/main.tsx".to_owned(), 2)]
    );
}

#[test]
fn compiled_file_has_no_new_diagnostics() {
    let text = "import { useState } from 'react';\n\
                export function Hello({ name }: { name: string }) {\n\
                return <div>Hello {name}</div>;\n\
                }\n\
                export const Badge = ({ label }: { label: string }) => <b>{label}</b>;\n\
                export function Counter({ step = 1 }: { step?: number }) {\n\
                const [count, setCount] = useState(0);\n\
                return <button onClick={() => setCount(count + step)}>{count}</button>;\n\
                }\n\
                export function useLabel(prefix: string, suffix: string = '!') {\n\
                const [label] = useState(prefix);\n\
                return [label, suffix];\n\
                }\n";
    let files = with_react_package(&[("main.tsx", text)]);
    assert_both_modes_report(&files, &[]);
}

const ITEM_HOOK: &str = "import { useState } from 'react';\n\
                         export interface Item { name: string }\n\
                         export function useItem() {\n\
                         const [item] = useState<Item | null>(null);\n\
                         return item;\n\
                         }\n";

#[test]
fn call_keeps_its_written_type_arguments() {
    with_tree("main.tsx", ITEM_HOOK, ReactCompilerMode::Client, |tree| {
        assert!(tree.has_compiled_components());
        let [call] = tree.calls_of("useState")[..] else {
            panic!("expected one call of useState");
        };
        assert_eq!(tree.hir().list_at(tree.hir()[call].type_args).len, 1);
    });
}

#[test]
fn caller_of_compiled_hook_sees_written_type_arguments() {
    let main = "import { useItem } from './item';\n\
                const item = useItem();\n\
                export const name = item !== null ? item.name : '';\n";
    let files = with_react_package(&[("main.ts", main), ("item.tsx", ITEM_HOOK)]);
    assert_both_modes_report(&files, &[]);
}

#[test]
fn caller_of_compiled_hook_passes_or_omits_a_parameter_with_default() {
    let step = "import { useState } from 'react';\n\
                export function useStep(step = 1) {\n\
                useState(step);\n\
                return [step];\n\
                }\n";
    let count = "import { useState } from 'react';\n\
                 export function useCount(count: number = 1) {\n\
                 useState(count);\n\
                 return [count];\n\
                 }\n";
    let check = |main: &str, expected: &[Reported]| {
        let sources = [("main.ts", main), ("step.jsx", step), ("count.tsx", count)];
        assert_both_modes_report(&with_react_package(&sources), expected);
    };
    check(
        "import { useStep } from './step';\n\
         import { useCount } from './count';\n\
         export const steps = [useStep(), useStep(2), useStep(undefined)];\n\
         export const counts = [useCount(), useCount(3), useCount(undefined)];\n",
        &[],
    );
    check(
        "import { useCount } from './count';\n\
         export const counts = useCount('3');\n",
        &[(2345, "/project/main.ts".to_owned(), 2)],
    );
}

#[test]
fn replaced_function_reports_nothing() {
    let text = "interface Item { name: string }\n\
                export function Label({ item }: { item?: Item }) {\n\
                const name = (item as Item).name + item!.name;\n\
                return <b>{name}</b>;\n\
                }\n";
    let as_written = with_react_package(&[("main.tsx", text)]);
    assert_both_modes_report(&as_written, &[]);
    let helper = "export function read(item?: Item) {\nreturn item.name;\n}\n";
    let with_helper = [text, helper].concat();
    let files = with_react_package(&[("main.tsx", with_helper.as_str())]);
    assert_both_modes_report(&files, &[(18048, "/project/main.tsx".to_owned(), 7)]);
}

#[test]
fn compiled_component_links() {
    let files = with_react_package(&[("main.tsx", HELLO)]);
    let mode = ReactCompilerMode::Client;
    let linked = link_program_with_react_compiler(&files, &default_settings(), mode);
    let summary = linked.expect("a compiled component links").summary;
    assert_eq!(summary.entry_points.len(), 1);
    assert_eq!(summary.entry_points[0].source_path, MAIN_PATH);
}
