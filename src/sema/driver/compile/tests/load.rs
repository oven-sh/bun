use super::support::{
    ClaimsNodeFs, DEPENDENCY_MANIFEST, GLOBAL_TYPES, HostScript, PROJECT, ScriptedHost,
    SlowToQueueAgain, codes, from_bun_check, from_bun_check_without_configuration, load,
    load_with_host, load_with_tsconfig_override, project_disk, with_host, with_program,
    with_runtime_project,
};
use crate::{EntryPointFailure, Locator, global};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{bind, specifiers_of_closed_module};
use bun_sema::check::aot::{Effect, FileOrigin};
use bun_sema::program::{FileId, FileRole};
use bun_sema::resolve::{CodeFailure, Host, Options};
use bun_sema::session::Session;

const UNKNOWN_MODULE_KIND: &str =
    r#"{ "compilerOptions": { "noLib": true, "types": [], "module": "x" } }"#;

#[test]
fn entry_point_not_found() {
    let not_found = EntryPointFailure::NotFound(CodeFailure::ModuleNotFound);
    let files = [("main.ts", "export {};\n")];
    let failure = load(&files, &["./nope.ts"]).unwrap_err();
    assert_eq!(failure.unresolved_entry_points, [(0, not_found)]);
    assert!(failure.diagnostics.is_empty());

    let failure = load(&files, &["./nope.ts", "./main.ts", "./missing.ts"]).unwrap_err();
    let expected = [(0, not_found), (2, not_found)];
    assert_eq!(failure.unresolved_entry_points, expected);

    with_program(&files, &["./main.ts"], 1, |program| {
        assert_eq!(program.files().entry_points(), [program.file("main.ts")]);
    });
}

#[test]
fn entry_points_keep_written_order() {
    let files = [("a.ts", "export {};\n"), ("b.ts", "import \"./a.ts\";\n")];
    with_program(&files, &["./b.ts", "./a.ts"], 1, |program| {
        let expected = [program.file("b.ts"), program.file("a.ts")];
        assert_eq!(program.files().entry_points(), expected);
    });
}

#[test]
fn builtin_module_entry_point_fails() {
    let builtin_module = [(0, EntryPointFailure::BuiltinModule)];
    let disk = project_disk(&[], 1);
    let failure = load_with_host(&ClaimsNodeFs(&disk), &["node:fs"]).unwrap_err();
    assert_eq!(failure.unresolved_entry_points, builtin_module);

    let script = HostScript {
        runtime_modules: &["node:fs", "util"],
        ..HostScript::default()
    };
    let host = ScriptedHost(&disk, script);
    for specifier in ["node:fs", "util"] {
        let failure = load_with_host(&host, &[specifier]).unwrap_err();
        assert_eq!(
            failure.unresolved_entry_points, builtin_module,
            "{specifier}"
        );
    }

    let failure = load_with_host(&disk, &["node:fs"]).unwrap_err();
    let not_found = EntryPointFailure::NotFound(CodeFailure::BuiltinModuleNotFound);
    assert_eq!(failure.unresolved_entry_points, [(0, not_found)]);
}

#[test]
fn file_entry_point_comes_before_builtin_module() {
    let disk = project_disk(&[("util.ts", "export {};\n")], 1);
    let script = HostScript {
        runtime_modules: &["util"],
        ..HostScript::default()
    };
    with_host(&ScriptedHost(&disk, script), PROJECT, "util", |program| {
        assert_eq!(program.files().entry_points(), [program.file("util.ts")]);
    });
}

#[test]
fn external_entry_point_fails() {
    let external = [(0, EntryPointFailure::External)];
    let disk = project_disk(&[("main.ts", "export {};\n")], 1);
    let script = HostScript {
        externals: &["./main.ts"],
        ..HostScript::default()
    };
    let failure = load_with_host(&ScriptedHost(&disk, script), &["./main.ts"]).unwrap_err();
    assert_eq!(failure.unresolved_entry_points, external);

    let failure = load_with_host(&disk, &["data:text/javascript,0"]).unwrap_err();
    assert_eq!(failure.unresolved_entry_points, external);
}

#[test]
fn resolved_entry_points_are_not_resolved() {
    with_runtime_project(&[("a.ts", "export {};")], &["a.ts"], |program| {
        assert_eq!(program.files().entry_points(), [program.file("a.ts")]);
    });
}

#[test]
fn configuration_errors_do_not_stop_load() {
    let files = [("tsconfig.json", UNKNOWN_MODULE_KIND), ("main.ts", "")];
    with_program(&files, &["./main.ts"], 1, |program| {
        let diagnostics = &program.loaded.diagnostics;
        assert!(!diagnostics.is_empty());
        assert!(diagnostics.iter().all(|it| it.diagnostic.file.is_none()));
        assert!(diagnostics.iter().all(|it| it.effect == Effect::StopsBuild));
    });

    let no_roots = r#"{ "compilerOptions": { "noLib": true, "types": [] }, "include": ["x/*"] }"#;
    let files = [("tsconfig.json", no_roots), ("main.ts", "")];
    with_program(&files, &["./main.ts"], 1, |program| {
        assert_eq!(codes(&program.loaded.diagnostics), [0; 0]);
        assert_eq!(program.find("globals.d.ts"), None);
    });
}

#[test]
fn configuration_error_of_runtime_project_is_internal() {
    let files = [
        ("tsconfig.json", UNKNOWN_MODULE_KIND),
        ("a.ts", "export {};\n"),
    ];
    with_runtime_project(&files, &["a.ts"], |program| {
        let diagnostics = &program.loaded.diagnostics;
        assert!(!diagnostics.is_empty());
        assert!(
            diagnostics
                .iter()
                .all(|it| it.effect == Effect::InternalError)
        );
    });
}

#[test]
fn tsconfig_override_replaces_nearest_configuration() {
    let no_roots = r#"{ "compilerOptions": { "noLib": true, "types": [] }, "files": [] }"#;
    let files = [("main.ts", ""), ("configs/tsconfig.json", no_roots)];
    for tsconfig_override in ["configs", "configs/tsconfig.json"] {
        load_with_tsconfig_override(&files, "./main.ts", tsconfig_override, |loaded| {
            let program = loaded.expect("load_program failed");
            let config_path = &program.files().options.config_path;
            assert_eq!(config_path, b"/project/configs/tsconfig.json");
            assert_eq!(codes(&program.loaded.diagnostics), [0; 0]);
        });
    }
    load_with_tsconfig_override(&files, "./main.ts", "missing.json", |loaded| {
        let failure = loaded.map(|_| ()).unwrap_err();
        assert!(failure.unresolved_entry_points.is_empty());
        assert_eq!(codes(&failure.diagnostics), [5083]);
        assert!(
            failure
                .diagnostics
                .iter()
                .all(|it| it.effect == Effect::StopsBuild)
        );
    });
}

#[test]
fn tree_of_leaf_that_no_task_reads_is_freed() {
    let files = [
        (
            "main.ts",
            "import { a } from './used.ts';\nexport const b: number = a + version;\n",
        ),
        ("used.ts", "export const a = 1;\n"),
        (
            "unread.test.ts",
            "import { a } from './used.ts';\nimport { check } from './helper.ts';\ncheck(a);\n",
        ),
        (
            "helper.ts",
            "import { twice } from './each-other.ts';\nexport function check(value: number) { return twice(value); }\n",
        ),
        (
            "each-other.ts",
            "import { check } from './helper.ts';\nexport function twice(value: number) { return value && check(0); }\n",
        ),
        (
            "adds-global.ts",
            "import { size } from './of-global.ts';\ndeclare global { var version: typeof size; }\n",
        ),
        ("of-global.ts", "export const size = 1;\n"),
        ("leaf.d.ts", "export type Size = number;\n"),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let files = program.files();
        let has_tree = |name: &str| !files.module(program.file(name)).hir.stmts.is_empty();
        let has_text = |name: &str| !files.module(program.file(name)).hir.text.is_empty();
        for name in ["unread.test.ts", "helper.ts", "each-other.ts"] {
            assert!(files.module(program.file(name)).is_leaf, "{name}");
            assert!(!has_tree(name), "{name}");
            assert!(!has_text(name), "{name}");
        }
        for name in [
            "main.ts",
            "used.ts",
            "adds-global.ts",
            "of-global.ts",
            "leaf.d.ts",
        ] {
            assert!(has_tree(name), "{name}");
            assert!(has_text(name), "{name}");
        }
    });
}

#[test]
fn file_that_is_not_compiled_is_bound_when_a_file_that_is_read_refers_to_it() {
    let files = [
        (
            "main.ts",
            "import type { Size } from './types.ts';\nexport const b: Size = version;\n",
        ),
        (
            "types.ts",
            "import type { Inner } from './inner.ts';\nexport type Size = Inner;\n",
        ),
        (
            "inner.ts",
            "export type Inner = number;\nexport class Holder { #held = 1; get() { return this.#held; } }\n",
        ),
        (
            "unread.test.ts",
            "import { check } from './helper.ts';\ncheck();\n",
        ),
        ("helper.ts", "export function check() {}\n"),
        ("hands-on.ts", "export * from './helper.ts';\n"),
        (
            "adds-global.ts",
            "import { size } from './of-global.ts';\ndeclare global { var version: typeof size; }\n",
        ),
        ("of-global.ts", "export const size = 1;\n"),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let files = program.files();
        let is_unbound = |name: &str| files.module(program.file(name)).bound.is_unbound;
        let symbol_count = |name: &str| files.module(program.file(name)).bound.symbols.len();
        assert!(files.module(program.file("unread.test.ts")).is_leaf);
        assert_eq!(symbol_count("unread.test.ts"), 0);
        for name in [
            "types.ts",
            "inner.ts",
            "helper.ts",
            "hands-on.ts",
            "adds-global.ts",
            "of-global.ts",
        ] {
            assert!(!is_unbound(name), "{name}");
            assert!(symbol_count(name) > 0, "{name}");
        }
        let inner = &files.module(program.file("inner.ts")).hir;
        let is_spelled_for_class = |member: &bun_sema::hir::Member| match member.key {
            bun_sema::hir::PropKey::Private(name) => files.atoms.bytes(name).starts_with(b"\xFE"),
            _ => true,
        };
        assert!(inner.members.iter().all(is_spelled_for_class));
    });
}

#[test]
fn module_that_is_reached_has_the_bodies_of_its_functions() {
    let files = [
        (
            "main.ts",
            "import type { Width } from './types.ts';\nexport const b: Width = 1;\n",
        ),
        (
            "types.ts",
            "export function make() { return { width: 1 }; }\nexport type Width = ReturnType<typeof make>['width'];\n",
        ),
        (
            "unread.test.ts",
            "export function check() { return { width: 1 }; }\n",
        ),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let files = program.files();
        let returns = |name: &str| {
            let statements = files.module(program.file(name)).hir.stmts.iter();
            statements
                .filter(|it| matches!(it.kind, bun_sema::hir::StmtKind::Return(_)))
                .count()
        };
        assert_eq!(returns("types.ts"), 1);
        assert_eq!(returns("unread.test.ts"), 0);
    });
}

fn specifiers_by_both_parses(path: &str, text: &str) -> [Option<Vec<String>>; 2] {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let options = Options::default().for_parsing();
    let disk = project_disk(&[], 1);
    let spell = |list: Vec<Atom>| -> Vec<String> {
        let texts = list
            .iter()
            .map(|&it| String::from_utf8_lossy(atoms.bytes(it)));
        texts.map(|text| text.into_owned()).collect()
    };
    let top = disk.parse_top_level(arena, path.as_bytes(), text.as_bytes(), &atoms, options);
    let whole = disk.parse(arena, path.as_bytes(), text.as_bytes(), &atoms, options);
    let of_top = top.as_ref().and_then(specifiers_of_closed_module);
    [
        of_top.map(spell),
        specifiers_of_closed_module(&whole).map(spell),
    ]
}

#[test]
fn top_level_says_what_the_whole_file_says() {
    for (path, text) in [
        (
            "/project/a.ts",
            "import a from './a';\nexport function f() { return a + '}' + `${a}}` + /}/.source; }\nexport { b } from './b';",
        ),
        (
            "/project/a.ts",
            "import a from './a';\nexport function f() { return import('./late'); }",
        ),
        (
            "/project/a.ts",
            "import a from './a';\nexport function f() { let b: import('./type').T; return (a) / 2; }",
        ),
        (
            "/project/a.ts",
            "export class C { m() { return () => { if (1) { return { a: {} }; } }; } get g() { return 1; } }\nimport './effect';",
        ),
        (
            "/project/a.ts",
            "export const f = () => { return 1; };\nexport const g = function () { return 2; };\nimport './effect';",
        ),
        (
            "/project/a.ts",
            "export function f() { {} }\ndeclare global { var a: number }",
        ),
        (
            "/project/a.ts",
            "export function f() { return 1; }\ndeclare module 'm' { export const a: number }",
        ),
        (
            "/project/a.ts",
            "export function f() { return 1; }\nexport * from './a';",
        ),
        (
            "/project/a.tsx",
            "import a from './a';\nexport function f() { return <p>don't {a}</p>; }\nexport { b } from './b';",
        ),
        (
            "/project/a.tsx",
            "import a from './a';\nexport function f() { return <a href=\"x\">http://x {a}</a>; }\nexport { b } from './b';",
        ),
        (
            "/project/a.ts",
            "export function f() { // }\n return 1; /* } */ }\nimport './effect';",
        ),
    ] {
        let [of_top, of_whole] = specifiers_by_both_parses(path, text);
        assert!(
            of_top.is_none() || of_top == of_whole,
            "{text}: {of_top:?} | {of_whole:?}"
        );
    }
}

#[test]
fn top_level_is_enough_for_plain_modules() {
    let text = "import a from './a';\nexport function f(b: number) { const c = { d: [a, b] }; return c.d.map(e => { return e * 2; }); }\nexport { b } from './b';";
    let expected = ["./a", "./b"].map(String::from);
    let [of_top, of_whole] = specifiers_by_both_parses("/project/a.ts", text);
    assert_eq!(of_top.as_deref(), Some(&expected[..]));
    assert_eq!(of_whole.as_deref(), Some(&expected[..]));
}

#[test]
fn files_that_are_not_typescript_modules_have_no_parse_of_the_top_level() {
    for (path, text) in [
        ("/project/a.js", "export function f() { return 1; }"),
        ("/project/a.d.ts", "export function f(): number;"),
        ("/project/a.json", "{}"),
        ("/project/a.ts", "export function f() { return 1; } }"),
        ("/project/a.ts", "export function f() { return 1; "),
    ] {
        assert_eq!(specifiers_by_both_parses(path, text)[0], None, "{text}");
    }
}

fn specifiers_without_binding(text: &str) -> Option<Vec<String>> {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let options = Options::default().for_parsing();
    let file =
        project_disk(&[], 1).parse(arena, b"/project/case.ts", text.as_bytes(), &atoms, options);
    let spell = |list: &[Atom]| -> Vec<String> {
        let texts = list
            .iter()
            .map(|&it| String::from_utf8_lossy(atoms.bytes(it)));
        texts.map(|text| text.into_owned()).collect()
    };
    let found = specifiers_of_closed_module(&file)?;
    let bound = bind(&file, options.bind, &atoms, arena);
    assert_eq!(spell(&found), spell(&bound.specifiers));
    Some(spell(&found))
}

#[test]
fn specifiers_of_statements_come_first_and_each_specifier_once() {
    let text = r#"
        const late = import("./late");
        import a from "./a";
        import "./effect";
        type T = import("./type").T;
        export { b } from "./b";
        import c = require("./c");
        import again from "./a";
        export const d = 1;
    "#;
    let expected = ["./a", "./effect", "./b", "./c", "./late", "./type"].map(String::from);
    assert_eq!(
        specifiers_without_binding(text).as_deref(),
        Some(&expected[..])
    );
}

#[test]
fn file_that_speaks_of_other_files_has_to_be_bound() {
    for text in [
        "const script = 1;",
        "export {}; declare global { var a: number }",
        "export {}; declare module 'm' { export const a: number }",
        "export * from './a';",
        "export * as a from './a';",
        "export const a = 1; export as namespace A;",
        "export namespace N { import a = require('./a'); }",
    ] {
        assert_eq!(specifiers_without_binding(text), None, "{text}");
    }
}

#[test]
fn only_typescript_entry_points_are_type_roots() {
    let files = [
        ("lib.esnext.d.ts", GLOBAL_TYPES),
        ("node_modules/tool/main.js", "export {};\n"),
        ("node_modules/tool/main.ts", "export {};\n"),
    ];
    with_program(&files, &["./node_modules/tool/main.js"], 1, |program| {
        let files = program.files();
        let main = program.file("node_modules/tool/main.js");
        assert!(files.options.config_path.is_empty());
        assert!(files.options.files.is_empty());
        assert_eq!(files.entry_points(), [main]);
        assert_eq!(files.role(main), FileRole::Inferred);
    });
    with_program(&files, &["./node_modules/tool/main.ts"], 1, |program| {
        let options = program.files().options;
        assert!(options.config_path.is_empty());
        assert_eq!(options.files, [b"/project/node_modules/tool/main.ts"]);
    });
}

#[test]
fn origin_by_file() {
    let main_text = r#"import "./own.js";
import "dep";
import "dep/plain.js";
import "shapes";
import type { Size } from "./types";
export type Copy = Size;
"#;
    let shapes_manifest = r#"{ "name": "shapes", "version": "1.0.0", "exports": { "aot": "./index.aot.ts", "default": "./index.js" } }"#;
    let files = [
        ("main.ts", main_text),
        ("own.js", "export {};\n"),
        ("types.d.ts", "export type Size = number;\n"),
        ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
        ("node_modules/dep/index.ts", "export {};\n"),
        ("node_modules/dep/plain.js", "export {};\n"),
        ("node_modules/shapes/package.json", shapes_manifest),
        ("node_modules/shapes/index.js", "export const sides = 4;\n"),
        (
            "node_modules/shapes/index.aot.ts",
            "export const sides: number = 4;\n",
        ),
    ];
    let disk = project_disk(&files, 1);
    let script = HostScript::default();
    with_host(
        &ScriptedHost(&disk, script),
        PROJECT,
        "./main.ts",
        |program| {
            let expected = [
                ("main.ts", FileOrigin::ProgramSource),
                ("own.js", FileOrigin::ProgramJavaScript),
                ("types.d.ts", FileOrigin::Declarations),
                ("node_modules/dep/index.ts", FileOrigin::DependencySource),
                (
                    "node_modules/dep/plain.js",
                    FileOrigin::DependencyJavaScript,
                ),
                (
                    "node_modules/shapes/index.aot.ts",
                    FileOrigin::DependencySource,
                ),
            ];
            for (path, origin) in expected {
                assert_eq!(program.loaded.origin(program.file(path)), origin, "{path}");
            }
        },
    );
}

#[test]
fn every_file_of_runtime_project_is_runtime() {
    let main_text = r#"import "./plain.js";
import type { Size } from "./size";
export type Copy = Size;
"#;
    let files = [
        ("main.ts", main_text),
        ("plain.js", "export {};\n"),
        ("size.d.ts", "export type Size = number;\n"),
    ];
    with_runtime_project(&files, &["main.ts"], |program| {
        for path in ["main.ts", "plain.js", "size.d.ts", "globals.d.ts"] {
            assert!(program.find(path).is_some(), "{path}");
        }
        let file_count = program.files().modules.len() as u32;
        for file in (0..file_count).map(FileId) {
            assert_eq!(program.loaded.origin(file), FileOrigin::Runtime, "{file:?}");
        }
    });
}

const BUN_TYPES: [(&str, &str); 2] = [
    (
        "node_modules/@types/bun/package.json",
        r#"{ "name": "@types/bun", "version": "1.0.0", "types": "index.d.ts" }"#,
    ),
    (
        "node_modules/@types/bun/index.d.ts",
        "declare const Bun: number;\n",
    ),
];

fn libraries_of(options: &Options) -> (Vec<u8>, Option<Vec<Vec<u8>>>) {
    (options.lib_dir.clone(), options.types.clone())
}

#[test]
fn libraries_match_bun_check() {
    let tsconfig = r#"{
        "compilerOptions": { "noLib": true, "module": "preserve", "moduleResolution": "bundler" },
        "files": ["main.ts", "globals.d.ts"]
    }"#;
    let shared = [
        ("tsconfig.json", tsconfig),
        ("lib.esnext.d.ts", GLOBAL_TYPES),
        ("main.ts", "export {};\n"),
        ("node_modules/tool/main.ts", "export {};\n"),
    ];
    for has_bun_types in [false, true] {
        let installed: &[(&str, &str)] = if has_bun_types { &BUN_TYPES } else { &[] };
        let files = [&shared[..], installed].concat();

        let configured = with_program(&files, &["./main.ts"], 1, |program| {
            assert!(!program.files().options.config_path.is_empty());
            assert_eq!(program.loaded.has_bun_types_installed, has_bun_types);
            libraries_of(program.files().options)
        });
        let checked = from_bun_check(&files, |files| libraries_of(files.options));
        assert_eq!(configured.0, checked.0);
        assert_eq!(checked.1, None);
        assert_eq!(configured.1, has_bun_types.then(|| vec![b"bun".to_vec()]));

        let tool = "node_modules/tool/main.ts";
        let unconfigured = with_program(&files, &["./node_modules/tool/main.ts"], 1, |program| {
            assert!(program.files().options.config_path.is_empty());
            assert_eq!(program.loaded.has_bun_types_installed, has_bun_types);
            libraries_of(program.files().options)
        });
        let checked = from_bun_check_without_configuration(&files, &[tool], |files| {
            libraries_of(files.options)
        });
        assert_eq!(unconfigured, checked);
        let expected_types = has_bun_types.then(|| vec![b"bun".to_vec()]);
        assert_eq!(unconfigured.1, expected_types);
    }
}

#[test]
fn locator_names_file() {
    let files = [("main.ts", "const value = 1;\n")];
    with_program(&files, &["./main.ts"], 1, |program| {
        let main = program.file("main.ts");
        let locator = Locator::new(program.files(), main);
        assert_eq!(locator.file(), main);
        let located = locator.locate(6, 7, global(1, &[""; 0]));
        assert_eq!(located.path, b"/project/main.ts");
        assert_eq!(located.file, Some(main));
        assert_eq!((located.line, located.column), (1, 7));
        assert_eq!((located.end_line, located.end_column), (1, 8));
        for (start, column) in [(14, 15), (0, 1)] {
            let located = locator.locate(start, start + 1, global(1, &[""; 0]));
            assert_eq!((located.line, located.column), (1, column));
            assert_eq!((located.end_line, located.end_column), (1, column + 1));
        }
    });
}

#[test]
fn file_queued_again_is_read_and_parsed_again() {
    const FILES: [(&str, &str); 2] = [
        (
            "main.ts",
            "import \"./first\";\nvar flag = true;\nexport function which() { return flag ? 1 : 2; }\n",
        ),
        ("first.ts", "import { which } from \"./main\";\nwhich();\n"),
    ];
    for reads_on_other_threads in [false, true] {
        let (ended, has_ended) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let disk = match reads_on_other_threads {
                true => project_disk(&FILES, 4).reading_on_threads_of_their_own(),
                false => project_disk(&FILES, 4),
            };
            let host = SlowToQueueAgain(&disk, Default::default());
            let is_loaded = load_with_host(&host, &["./main.ts"]).is_ok();
            let times_queued = ["main.ts", "first.ts"].map(|path| host.times_queued(path));
            let _ = ended.send((is_loaded, times_queued));
        });
        let outcome = has_ended.recv_timeout(std::time::Duration::from_secs(120));
        assert_eq!(outcome, Ok((true, [2, 1])), "{reads_on_other_threads}");
    }
}
