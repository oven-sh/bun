use super::support::{
    ClaimsNodeFs, HostScript, PROJECT, ScriptedHost, TestProgram, project_disk, with_defines,
    with_host, with_program,
};
use bun_sema::hir::ResolutionMode;
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::{
    CodeAnswer, CompiledModule, ComputedTarget, ComputedTargets, FileId, FileRole, HostLoader,
    HostModuleId,
};
use bun_sema::resolve::{CodeFailure, ComputedUnknown, ExternalKind};
use bun_sema::util::SharedSort;

const COMPILER_OPTIONS: &str =
    r#""noLib": true, "types": [], "module": "preserve", "moduleResolution": "bundler""#;

const REACT: [(&str, &str); 4] = [
    (
        "node_modules/react/package.json",
        r#"{ "name": "react", "version": "19.0.0" }"#,
    ),
    ("node_modules/react/index.js", ""),
    ("node_modules/react/jsx-runtime.js", ""),
    ("node_modules/react/jsx-dev-runtime.js", ""),
];

const ELEMENT: &str = "export const element = <div />;\n";
const ELEMENT_WITH_KEY_AFTER_SPREAD: &str =
    "export const keyed = (props) => <div {...props} key=\"a\" />;\n";

fn tsconfig(more_compiler_options: &str, more_members: &str) -> String {
    format!(
        r#"{{ "compilerOptions": {{ {COMPILER_OPTIONS}{more_compiler_options} }}{more_members} }}"#
    )
}

fn with_react<'a>(files: &[(&'a str, &'a str)]) -> Vec<(&'a str, &'a str)> {
    [&REACT[..], files].concat()
}

fn compiled<'s>(program: &TestProgram<'_, 's>, path: &str) -> &'s CompiledModule<'s> {
    let compiled = program.files().compiled(program.file(path));
    compiled.unwrap_or_else(|| panic!("no code edge reaches {path}"))
}

fn code_answers<'s>(program: &TestProgram<'_, 's>, path: &str) -> &'s [CodeAnswer<'s>] {
    compiled(program, path).code_answers
}

fn code_edges<'s>(program: &TestProgram<'_, 's>, path: &str) -> &'s [FileId] {
    program.files().module(program.file(path)).code_edges
}

fn jsx_answers<'s>(program: &TestProgram<'_, 's>, path: &str) -> [Option<CodeAnswer<'s>>; 2] {
    let compiled = compiled(program, path);
    [ImportSiteKind::JsxRuntime, ImportSiteKind::JsxPackage].map(|kind| {
        let site = compiled.analysis.import_site_index(kind)?;
        Some(compiled.code_answers[site])
    })
}

fn is_from_external_library(program: &TestProgram<'_, '_>, path: &str) -> bool {
    let module = program.files().module(program.file(path));
    module.is_from_external_library
}

fn conditional_import(call: &str) -> String {
    format!(r#"if (process.env.X === "a") {call}("./a.js"); else {call}("./b.js");"#)
}

#[test]
fn folded_import_is_not_resolved() {
    for call in ["require", "import"] {
        let main = conditional_import(call);
        let files = [("main.js", main.as_str()), ("a.js", ""), ("b.js", "")];
        with_defines(
            &files,
            &["./main.js"],
            &[("process.env.X", "b")],
            |program| {
                let b = program.file("b.js");
                assert_eq!(code_answers(program, "main.js"), [CodeAnswer::File(b)]);
                assert_eq!(code_edges(program, "main.js"), [b]);
                assert_eq!(program.find("a.js"), None);
            },
        );
        with_program(&files, &["./main.js"], 1, |program| {
            let (a, b) = (program.file("a.js"), program.file("b.js"));
            let expected = [CodeAnswer::File(a), CodeAnswer::File(b)];
            assert_eq!(code_answers(program, "main.js"), expected);
            assert_eq!(code_edges(program, "main.js"), [a, b]);
        });
    }
}

#[test]
fn folded_import_of_missing_file_is_not_an_answer() {
    for call in ["require", "import"] {
        let main = conditional_import(call);
        let files = [("main.js", main.as_str()), ("b.js", "")];
        with_defines(
            &files,
            &["./main.js"],
            &[("process.env.X", "b")],
            |program| {
                let b = program.file("b.js");
                assert_eq!(code_answers(program, "main.js"), [CodeAnswer::File(b)]);
            },
        );
        with_program(&files, &["./main.js"], 1, |program| {
            let not_found = CodeAnswer::NotFound(CodeFailure::ModuleNotFound);
            let expected = [not_found, CodeAnswer::File(program.file("b.js"))];
            assert_eq!(code_answers(program, "main.js"), expected);
        });
    }
}

#[test]
fn answers_are_parallel_to_sites() {
    let main = r#"import "./a.js";
import "node:fs";
import "https://example.com/x.js";
import "./missing";
import { m } from "./m.ts" with { type: "macro" };
import(name);
"#;
    let disk = project_disk(&[("main.js", main), ("a.js", "")], 1);
    with_host(&ClaimsNodeFs(&disk), PROJECT, "./main.js", |program| {
        let atoms = &program.files().atoms;
        let compiled = compiled(program, "main.js");
        let sites = compiled.analysis.import_sites;
        assert_eq!(compiled.code_answers.len(), sites.len());
        let specifiers = sites.iter().map(|site| match site.specifier {
            ImportSpecifier::Constant(specifier) => Some(atoms.bytes(specifier)),
            ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => None,
        });
        let answers: Vec<(Option<&[u8]>, CodeAnswer<'_>)> = specifiers
            .zip(compiled.code_answers.iter().copied())
            .collect();
        let a = program.file("a.js");
        let external = CodeAnswer::External {
            specifier: atoms.intern(b"https://example.com/x.js"),
            kind: ExternalKind::UncompiledCode,
        };
        let unknown = CodeAnswer::Computed(ComputedTargets::All {
            cause: ComputedUnknown::NoPattern,
            host_modules: &[],
        });
        let expected: [(Option<&[u8]>, CodeAnswer<'_>); 6] = [
            (Some(b"./a.js"), CodeAnswer::File(a)),
            (Some(b"node:fs"), CodeAnswer::HostModule(HostModuleId(7))),
            (Some(b"https://example.com/x.js"), external),
            (
                Some(b"./missing"),
                CodeAnswer::NotFound(CodeFailure::ModuleNotFound),
            ),
            (Some(b"./m.ts"), CodeAnswer::Erased),
            (None, unknown),
        ];
        assert_eq!(answers, expected);
        assert_eq!(code_edges(program, "main.js"), [a]);
        assert_eq!(program.files().host_modules(), [HostModuleId(7)]);
    });
}

const PAGES: [(&str, &str); 3] = [("pages/a.js", ""), ("pages/b.js", ""), ("other.js", "")];

#[test]
fn computed_specifier_with_prefix_answers_a_set() {
    let main = (
        "main.js",
        "export const load = (name) => import(`./pages/${name}.js`);\n",
    );
    let files = [&[main][..], &PAGES[..]].concat();
    with_program(&files, &["./main.js"], 1, |program| {
        let (a, b) = (program.file("pages/a.js"), program.file("pages/b.js"));
        let mut pages = [a, b];
        pages.shared_sort_unstable();
        let atoms = &program.files().atoms;
        let expected = ComputedTargets::Modules {
            files: &pages,
            host_modules: &[],
            spellings: &[
                (atoms.intern(b"./pages/a.js"), ComputedTarget::File(a)),
                (atoms.intern(b"./pages/b.js"), ComputedTarget::File(b)),
            ],
        };
        assert_eq!(
            code_answers(program, "main.js"),
            [CodeAnswer::Computed(expected)]
        );
        assert_eq!(code_edges(program, "main.js"), [a, b]);
        assert!(program.files().is_compiled(a) && program.files().is_compiled(b));
        assert_eq!(program.find("other.js"), None);
    });
}

#[test]
fn computed_specifier_without_prefix_is_unknown() {
    let main = (
        "main.js",
        "export const load = (name) => import(`${name}.js`);\n",
    );
    let files = [&[main][..], &PAGES[..]].concat();
    with_program(&files, &["./main.js"], 1, |program| {
        let expected = ComputedTargets::All {
            cause: ComputedUnknown::NoConstantPrefix,
            host_modules: &[],
        };
        assert_eq!(
            code_answers(program, "main.js"),
            [CodeAnswer::Computed(expected)]
        );
        assert!(code_edges(program, "main.js").is_empty());
        assert_eq!(program.find("pages/a.js"), None);
    });
}

#[test]
fn macro_attribute_erases_only_statements() {
    let main = r#"import { m } from "./m.js" with { type: "macro" };
import("./m.js", { with: { type: "macro" } });
"#;
    let files = [("main.js", main), ("m.js", "export function m() {}\n")];
    let disk = project_disk(&files, 1);
    let script = HostScript {
        attribute_loader: HostLoader(1),
        ..HostScript::default()
    };
    with_host(
        &ScriptedHost(&disk, script),
        PROJECT,
        "./main.js",
        |program| {
            let m = program.file("m.js");
            let expected = [CodeAnswer::Erased, CodeAnswer::File(m)];
            assert_eq!(code_answers(program, "main.js"), expected);
            assert_eq!(code_edges(program, "main.js"), [m]);
            assert_eq!(compiled(program, "m.js").loader, HostLoader::default());
        },
    );
}

#[test]
fn jsx_imports() {
    let tsconfig = tsconfig(r#", "jsx": "react-jsx""#, "");
    let main = format!("import \"./other.js\";\n{ELEMENT}{ELEMENT_WITH_KEY_AFTER_SPREAD}");
    let files = with_react(&[
        ("tsconfig.json", tsconfig.as_str()),
        ("main.tsx", main.as_str()),
        ("other.js", ""),
    ]);
    with_program(&files, &["./main.tsx"], 1, |program| {
        let runtime = program.file("node_modules/react/jsx-runtime.js");
        let package = program.file("node_modules/react/index.js");
        let other = program.file("other.js");
        let expected = [runtime, package, other].map(CodeAnswer::File);
        assert_eq!(
            jsx_answers(program, "main.tsx"),
            [Some(expected[0]), Some(expected[1])]
        );
        assert_eq!(code_answers(program, "main.tsx"), expected);
        assert_eq!(code_edges(program, "main.tsx"), [runtime, package, other]);
        assert_eq!(program.find("node_modules/react/jsx-dev-runtime.js"), None);
        let compiled = compiled(program, "main.tsx");
        assert!(std::ptr::eq(compiled.jsx, &compiled.settings.jsx));
    });
}

#[test]
fn jsx_package_is_imported_only_for_key_after_spread() {
    let files = with_react(&[("main.tsx", ELEMENT)]);
    with_program(&files, &["./main.tsx"], 1, |program| {
        let runtime = program.file("node_modules/react/jsx-runtime.js");
        let expected = [Some(CodeAnswer::File(runtime)), None];
        assert_eq!(jsx_answers(program, "main.tsx"), expected);
        assert_eq!(code_edges(program, "main.tsx"), [runtime]);
        assert_eq!(program.find("node_modules/react/index.js"), None);
    });
}

#[test]
fn jsx_imports_need_automatic_runtime_and_live_element() {
    let classic = format!("/* @jsxRuntime classic */\n{ELEMENT}");
    let without_imports = [
        ("main.tsx", classic.as_str()),
        ("main.ts", "export const element = null;"),
    ];
    for (path, source) in without_imports {
        let entry_point = format!("./{path}");
        let files = with_react(&[(path, source)]);
        with_program(&files, &[entry_point.as_str()], 1, |program| {
            assert_eq!(jsx_answers(program, path), [None, None], "{path}");
            assert!(code_edges(program, path).is_empty(), "{path}");
        });
    }

    let conditional = r#"export const element = process.env.X === "a" ? <div /> : null;"#;
    let files = with_react(&[("main.tsx", conditional)]);
    with_defines(
        &files,
        &["./main.tsx"],
        &[("process.env.X", "b")],
        |program| {
            assert_eq!(jsx_answers(program, "main.tsx"), [None, None]);
            assert!(code_edges(program, "main.tsx").is_empty());
        },
    );
    with_program(&files, &["./main.tsx"], 1, |program| {
        assert!(jsx_answers(program, "main.tsx")[0].is_some());
        assert_eq!(code_edges(program, "main.tsx").len(), 1);
    });
}

#[test]
fn jsx_import_source_pragma_selects_package() {
    let tsconfig = tsconfig(r#", "jsx": "react-jsxdev""#, "");
    let main = format!("/* @jsxImportSource preact */\n{ELEMENT}{ELEMENT_WITH_KEY_AFTER_SPREAD}");
    let files = with_react(&[
        ("tsconfig.json", tsconfig.as_str()),
        ("main.tsx", main.as_str()),
        (
            "node_modules/preact/package.json",
            r#"{ "name": "preact", "version": "10.0.0" }"#,
        ),
        ("node_modules/preact/index.js", ""),
        ("node_modules/preact/jsx-runtime.js", ""),
        ("node_modules/preact/jsx-dev-runtime.js", ""),
    ]);
    with_program(&files, &["./main.tsx"], 1, |program| {
        let runtime = program.file("node_modules/preact/jsx-dev-runtime.js");
        let package = program.file("node_modules/preact/index.js");
        let expected = [runtime, package].map(|file| Some(CodeAnswer::File(file)));
        assert_eq!(jsx_answers(program, "main.tsx"), expected);
        assert_eq!(program.find("node_modules/preact/jsx-runtime.js"), None);
        assert_eq!(program.find("node_modules/react/index.js"), None);
        let compiled = compiled(program, "main.tsx");
        assert_eq!(compiled.jsx.import_source, b"preact");
        assert_eq!(compiled.settings.jsx.import_source, b"react");
    });
}

#[test]
fn jsx_imports_of_missing_package_are_not_found() {
    let main = format!("{ELEMENT}{ELEMENT_WITH_KEY_AFTER_SPREAD}");
    with_program(
        &[("main.tsx", main.as_str())],
        &["./main.tsx"],
        1,
        |program| {
            let expected = [
                Some(CodeAnswer::NotFound(CodeFailure::ModuleNotFound)),
                Some(CodeAnswer::NotFound(CodeFailure::PackageNotFound)),
            ];
            assert_eq!(jsx_answers(program, "main.tsx"), expected);
            assert!(code_edges(program, "main.tsx").is_empty());
        },
    );
}

#[test]
fn unreached_file_has_no_edges() {
    let tsconfig = tsconfig("", r#", "include": ["spec.test.ts", "globals.d.ts"]"#);
    let shared = [
        ("tsconfig.json", tsconfig.as_str()),
        (
            "spec.test.ts",
            r#"import { help } from "./helper.ts"; import "./untyped.js"; help();"#,
        ),
        ("helper.ts", "export function help() {}"),
        ("untyped.js", ""),
    ];

    let unreached = [&shared[..], &[("main.ts", "export {};")]].concat();
    with_program(&unreached, &["./main.ts"], 1, |program| {
        let files = program.files();
        let (spec, helper) = (program.file("spec.test.ts"), program.file("helper.ts"));
        assert_eq!(files.module(spec).edges, [helper]);
        for file in [spec, helper] {
            assert_eq!(files.role(file), FileRole::Checked);
            assert!(files.compiled(file).is_none());
            assert!(!files.is_compiled(file));
            assert!(files.code_answers(file).is_empty());
            assert!(files.module(file).code_edges.is_empty());
        }
        assert_eq!(program.find("untyped.js"), None);
        assert_eq!(files.compiled_files(), [program.file("main.ts")]);
    });

    let reached = [&shared[..], &[("main.ts", r#"import "./spec.test.ts";"#)]].concat();
    with_program(&reached, &["./main.ts"], 1, |program| {
        let (helper, untyped) = (program.file("helper.ts"), program.file("untyped.js"));
        let expected = [CodeAnswer::File(helper), CodeAnswer::File(untyped)];
        assert_eq!(code_answers(program, "spec.test.ts"), expected);
        assert_eq!(code_edges(program, "spec.test.ts"), [helper, untyped]);
        assert!(program.files().is_compiled(helper));
    });
}

#[test]
fn entering_a_package() {
    let tsconfig = tsconfig(
        r#", "paths": { "@/*": ["./src/*"] }"#,
        r#", "files": ["main.ts", "globals.d.ts"]"#,
    );
    let files = [
        ("tsconfig.json", tsconfig.as_str()),
        (
            "main.ts",
            r#"import { x } from "@/x"; import "dep"; import "./own.js"; export const y = x;"#,
        ),
        ("src/x.ts", "export const x = 1;"),
        ("own.js", ""),
        (
            "node_modules/dep/package.json",
            r#"{ "name": "dep", "version": "1.0.0" }"#,
        ),
        ("node_modules/dep/index.js", r#"require("./inner.js");"#),
        ("node_modules/dep/inner.js", ""),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        for path in ["node_modules/dep/index.js", "node_modules/dep/inner.js"] {
            assert!(is_from_external_library(program, path), "{path}");
        }
        for path in ["main.ts", "own.js", "src/x.ts"] {
            assert!(!is_from_external_library(program, path), "{path}");
        }
    });
}

#[test]
fn settings_are_shared() {
    let tsconfig = tsconfig(r#", "jsx": "react-jsx""#, "");
    let files = [
        ("tsconfig.json", tsconfig.as_str()),
        (
            "main.ts",
            r#"import "./a.ts"; import "./equal/b.ts"; import "./decorated/c.ts";"#,
        ),
        ("a.ts", "export {};"),
        ("equal/tsconfig.json", tsconfig.as_str()),
        ("equal/b.ts", "export {};"),
        (
            "decorated/tsconfig.json",
            r#"{ "compilerOptions": { "experimentalDecorators": true } }"#,
        ),
        ("decorated/c.ts", "export {};"),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let settings = |path: &str| compiled(program, path).settings;
        assert!(std::ptr::eq(settings("main.ts"), settings("a.ts")));
        assert!(std::ptr::eq(settings("main.ts"), settings("equal/b.ts")));
        assert_ne!(settings("main.ts"), settings("decorated/c.ts"));
        assert!(settings("decorated/c.ts").experimental_decorators);
    });
}

#[test]
fn types_answers_match_import_kind() {
    let files = [
        ("main.js", "import \"dual\";\nrequire(\"dual\");"),
        (
            "node_modules/dual/package.json",
            r#"{ "name": "dual", "exports": { "import": "./esm.js", "require": "./cjs.js" } }"#,
        ),
        ("node_modules/dual/esm.js", ""),
        ("node_modules/dual/cjs.js", ""),
    ];
    with_program(&files, &["./main.js"], 1, |program| {
        let esm = program.file("node_modules/dual/esm.js");
        let cjs = program.file("node_modules/dual/cjs.js");
        let expected = [CodeAnswer::File(esm), CodeAnswer::File(cjs)];
        assert_eq!(code_answers(program, "main.js"), expected);
        let files = program.files();
        let module = files.module(program.file("main.js"));
        let dual = files.atoms.lookup(b"dual").expect("a specifier of main.js");
        let types_answer = |mode: ResolutionMode| module.imports.get(&(dual, mode)).copied();
        assert_eq!(types_answer(ResolutionMode::Import), Some(esm));
        assert_eq!(types_answer(ResolutionMode::Require), Some(cjs));
        assert!(module.edges.is_empty());
    });
}

const IMPLIED_FILE: [(&str, &str); 1] = [("main.ts", "implied.js")];

fn with_implied_file<R>(files: &[(&str, &str)], then: impl FnOnce(&TestProgram<'_, '_>) -> R) -> R {
    let disk = project_disk(files, 1);
    let script = HostScript {
        implied_files: &IMPLIED_FILE,
        ..HostScript::default()
    };
    with_host(&ScriptedHost(&disk, script), PROJECT, "./entry.ts", then)
}

#[test]
fn implied_file_comes_last_in_code_edges() {
    let files = [
        ("entry.ts", r#"import "./main.ts";"#),
        (
            "main.ts",
            r#"import "./a.js"; import "./implied.js"; import "./b.js";"#,
        ),
        ("a.js", ""),
        ("b.js", ""),
        ("implied.js", ""),
    ];
    with_implied_file(&files, |program| {
        let (a, b) = (program.file("a.js"), program.file("b.js"));
        let implied = program.file("implied.js");
        let implied_answers = compiled(program, "main.ts").implied_answers;
        assert_eq!(implied_answers, [CodeAnswer::File(implied)]);
        assert_eq!(code_edges(program, "main.ts"), [a, implied, b]);
    });
    let files = [
        ("entry.ts", r#"import "./main.ts";"#),
        ("main.ts", r#"import "./a.js";"#),
        ("a.js", ""),
        ("implied.js", ""),
    ];
    with_implied_file(&files, |program| {
        let (a, implied) = (program.file("a.js"), program.file("implied.js"));
        let implied_answers = compiled(program, "main.ts").implied_answers;
        assert_eq!(implied_answers, [CodeAnswer::File(implied)]);
        assert_eq!(code_answers(program, "main.ts"), [CodeAnswer::File(a)]);
        assert_eq!(code_edges(program, "main.ts"), [a, implied]);
        assert!(compiled(program, "entry.ts").implied_answers.is_empty());
    });
}

#[test]
fn unreached_file_has_no_implied_files() {
    let tsconfig = tsconfig("", r#", "include": ["main.ts", "globals.d.ts"]"#);
    let files = [
        ("tsconfig.json", tsconfig.as_str()),
        ("entry.ts", "export {};"),
        ("main.ts", "export {};"),
        ("implied.js", ""),
    ];
    with_implied_file(&files, |program| {
        let main = program.file("main.ts");
        assert!(program.files().compiled(main).is_none());
        assert!(code_edges(program, "main.ts").is_empty());
        assert_eq!(program.find("implied.js"), None);
    });
}

#[cfg(unix)]
mod on_disk {
    use super::super::support::{GLOBAL_TYPES, TemporaryDirectory, disk, with_host};
    use super::tsconfig;
    use crate::host;

    #[test]
    fn entering_a_linked_package() {
        let directory = TemporaryDirectory::new("linked_package");
        let tsconfig = tsconfig("", r#", "files": ["main.ts", "globals.d.ts"]"#);
        directory.write("tsconfig.json", &tsconfig);
        directory.write("globals.d.ts", GLOBAL_TYPES);
        directory.write(
            "main.ts",
            r#"import { shared } from "shared"; export const own = shared;"#,
        );
        directory.write(
            "packages/shared/package.json",
            r#"{ "name": "shared", "version": "1.0.0" }"#,
        );
        directory.write("packages/shared/index.ts", "export const shared = 1;");
        directory.link("node_modules/shared", "../packages/shared");

        let root = directory.root();
        let disk = disk(1, host::AlreadyRead::default(), &root);
        with_host(&disk, &root, "./main.ts", |program| {
            let files = program.files();
            let file = |path: &str| files.by_path.get(&directory.path_of(path));
            let main = file("main.ts").expect("the entry point");
            let shared = file("packages/shared/index.ts").expect("named by its real path");
            assert_eq!(file("node_modules/shared/index.ts"), None);
            assert_eq!(files.module(main).code_edges, [shared]);
            assert!(files.module(shared).is_from_external_library);
            assert!(!files.module(main).is_from_external_library);
        });
    }
}
