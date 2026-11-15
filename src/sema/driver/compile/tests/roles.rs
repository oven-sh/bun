use super::support::{
    BuildSummary, CheckedBuild, DEPENDENCY_MANIFEST, FAILING_DEPENDENCY, HostScript,
    IMPORTS_DEPENDENCY, PROJECT, ScriptedHost, TYPE_ERROR, TestProgram, check, check_only, codes,
    project_disk, with_check_of_dependencies, with_host, with_program, with_runtime_project,
};
use crate::{Demotion, DemotionCause, RoleDecision, check_and_lower, decide_roles};
use bun_sema::check::aot::{DiagnosticClass, Effect, FileOrigin};
use bun_sema::program::{FileId, FileRole};
use std::sync::atomic::{AtomicUsize, Ordering};

const INSTALLED_SHAPES: &str = "export function area(side) {
  return side * side;
}
";
const MISTYPED_SHAPES: &str = "export function area(side: number): string {
  return side * side;
}
";

fn check_with_roles<'s, T: Send>(
    program: &TestProgram<'_, 's>,
    lower: &(dyn Fn(&RoleDecision, FileId) -> T + Sync),
) -> CheckedBuild<T> {
    let files_to_lower = program.files().compiled_files();
    let (loaded, host, request) = (program.loaded, program.host, program.request);
    let roles = decide_roles(loaded, host, request, files_to_lower);
    let program = check_and_lower(loaded, host, request, &roles, files_to_lower, &|_, file| {
        Some(lower(&roles, file))
    });
    CheckedBuild { roles, program }
}

fn dependency_with(text: &'static str) -> [(&'static str, &'static str); 3] {
    [
        ("main.ts", IMPORTS_DEPENDENCY),
        ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
        ("node_modules/dep/index.ts", text),
    ]
}

const TEXT_WITH_EARLY_ERROR: &str = "(function anonymous(\n) {\nbreak;\n})";
const TEXT_WITHOUT_ERROR: &str = "(function anonymous(\n) {\nfor (;;) { break; }\n})";

#[test]
fn evaluated_text_with_early_error_is_demoted_and_not_reported() {
    let files = [
        ("main.js", ""),
        ("failing.cjs", TEXT_WITH_EARLY_ERROR),
        ("valid.cjs", TEXT_WITHOUT_ERROR),
    ];
    let disk = project_disk(&files, 1);
    let script = HostScript {
        implied_files: &[("main.js", "failing.cjs"), ("main.js", "valid.cjs")],
        evaluated_texts: &["failing.cjs", "valid.cjs"],
        ..HostScript::default()
    };
    with_host(
        &ScriptedHost(&disk, script),
        PROJECT,
        "./main.js",
        |program| {
            let [failing, valid] = ["failing.cjs", "valid.cjs"].map(|path| program.file(path));
            for text in [failing, valid] {
                assert_eq!(program.loaded.origin(text), FileOrigin::EvaluatedText);
                assert_eq!(program.files().role(text), FileRole::Inferred);
            }
            let main = program.file("main.js");
            assert_eq!(program.loaded.origin(main), FileOrigin::ProgramJavaScript);

            let compiled_files = program.files().compiled_files();
            let (loaded, host, request) = (program.loaded, program.host, program.request);
            let roles = decide_roles(loaded, host, request, compiled_files);
            let early_error = Demotion {
                file: failing,
                cause: DemotionCause::EarlyError,
            };
            assert_eq!(roles.demoted, [early_error]);
            assert!(roles.has_early_error(failing));
            assert!(!roles.has_early_error(valid) && !roles.has_early_error(main));
            assert!(
                roles.is_checked(failing) && roles.is_checked(valid) && !roles.is_checked(main)
            );
            assert!(roles.diagnostics.is_empty());

            let files_to_lower = [main, valid];
            let checked =
                check_and_lower(loaded, host, request, &roles, &files_to_lower, &|_, _| {
                    Some(())
                });
            assert!(checked.diagnostics.is_empty());
        },
    );
}

#[test]
fn lowering_is_told_the_early_error_that_decided_a_role() {
    let files = [("main.js", ""), ("failing.cjs", TEXT_WITH_EARLY_ERROR)];
    let disk = project_disk(&files, 1);
    let script = HostScript {
        implied_files: &[("main.js", "failing.cjs")],
        evaluated_texts: &["failing.cjs"],
        ..HostScript::default()
    };
    with_host(
        &ScriptedHost(&disk, script),
        PROJECT,
        "./main.js",
        |program| {
            let failing = program.file("failing.cjs");
            let build = check(program, &|checker, file| checker.found_early_error(file));
            assert!(build.roles.has_early_error(failing));
            for &(file, found) in &build.program.lowered {
                assert_eq!(found, file == failing, "{file:?}");
            }
            assert_eq!(build.codes(), [0; 0]);
        },
    );
}

#[test]
fn early_error_in_file_of_the_program_stops_the_build() {
    let files = [
        ("main.js", "import \"./failing.cjs\";\n"),
        ("failing.cjs", TEXT_WITH_EARLY_ERROR),
    ];
    with_program(&files, &["./main.js"], 1, |program| {
        let failing = program.file("failing.cjs");
        let build = check_only(program);
        assert!(build.roles.demoted.is_empty());
        assert!(!build.roles.has_early_error(failing));
        let in_file = build
            .diagnostics()
            .filter(|it| it.diagnostic.file == Some(failing));
        let reported: Vec<(DiagnosticClass, Effect)> =
            in_file.map(|it| (it.diagnostic.class, it.effect)).collect();
        assert_eq!(
            reported,
            [(DiagnosticClass::EarlyError, Effect::StopsBuild)]
        );
    });
}

#[test]
fn nobody_looks_for_type_errors_in_a_dependency() {
    let check_with_threads = |threads: usize| {
        with_program(&FAILING_DEPENDENCY, &["./main.ts"], threads, |program| {
            let dep = program.file("node_modules/dep/index.ts");
            let build = check_with_roles(program, &|roles, _| roles.role(dep));
            assert!(build.roles.demoted.is_empty());
            assert!(build.roles.checked.is_empty());
            assert!(build.roles.rounds.is_empty());
            assert_eq!(build.roles.role(dep), FileRole::Checked);
            assert_eq!(build.codes(), [0; 0]);
            assert_eq!(build.program.lowered.len(), 2);
            let mut seen_roles = build.program.lowered.iter().map(|it| it.1);
            assert!(seen_roles.all(|role| role == FileRole::Checked));
            build.into_summary()
        })
    };
    assert_eq!(check_with_threads(1), check_with_threads(4));
}

#[test]
fn each_file_is_lowered_once() {
    with_program(&FAILING_DEPENDENCY, &["./main.ts"], 1, |program| {
        let files = program.files();
        let calls: Vec<AtomicUsize> = files.modules.iter().map(|_| AtomicUsize::new(0)).collect();
        check(program, &|_, file| {
            calls[file.idx()].fetch_add(1, Ordering::Relaxed);
        });
        let calls: Vec<usize> = calls.iter().map(|it| it.load(Ordering::Relaxed)).collect();
        for &file in files.compiled_files() {
            assert_eq!(calls[file.idx()], 1, "{file:?}");
        }
        assert_eq!(calls.iter().sum::<usize>(), files.compiled_files().len());
    });
}

const EXACT_OPTIONAL_CONFIG: (&str, &str) = (
    "tsconfig.json",
    r#"{
    "compilerOptions": {
        "strict": true,
        "exactOptionalPropertyTypes": true,
        "noLib": true,
        "types": [],
        "module": "preserve",
        "moduleResolution": "bundler"
    }
}"#,
);
const IMPORTS_LIB: &str = r#"import { value } from "./lib/index";
export const copy = value;
"#;
const UNDEFINED_IN_OPTIONAL_PROPERTIES: &str = "export interface Options { limit?: number }
export const options: Options = { limit: undefined };
export const nested: { inner: Options }[] = [{ inner: { limit: undefined } }];
export function reset(target: Options) { target.limit = undefined; }
export function take(given: Options) {}
const given = { limit: undefined };
take(given);
export const value = 2;
";
const NARROWER_PARAMETER: &str = "interface Animal { name: string }
interface Dog extends Animal { bark: number }
type Handler = (animal: Animal) => number;
export const handler: Handler = (dog: Dog) => dog.bark;
export function each<T>(item: T, visit: (item: T) => number) { return visit(item); }
declare const animal: Animal;
export const visited = each(animal, (dog: Dog) => dog.bark);
export const value = 2;
";

fn assert_stays_checked(files: &[(&str, &str)], path: &str) {
    let check_with_threads = |threads: usize| {
        with_program(files, &["./main.ts"], threads, |program| {
            let build = check_only(program);
            assert_eq!(build.codes(), [0; 0]);
            assert!(build.roles.demoted.is_empty());
            assert_eq!(build.roles.role(program.file(path)), FileRole::Checked);
        });
    };
    check_with_threads(1);
    check_with_threads(4);
}

fn assert_has_unverified_types(files: &[(&str, &str)], path: &str) {
    with_program(files, &["./main.ts"], 1, |program| {
        let file = program.file(path);
        let build = check_only(program);
        let expected = Demotion {
            file,
            cause: DemotionCause::UnverifiedTypes,
        };
        assert_eq!(build.codes(), [0; 0]);
        assert_eq!(build.roles.demoted, [expected]);
        assert_eq!(build.roles.role(file), FileRole::Inferred);
        assert_eq!(build.roles.role(program.file("main.ts")), FileRole::Checked);
    });
}

#[test]
fn mistakes_that_are_no_early_errors_keep_a_dependency_typed() {
    for text in [
        "export const value = 2;\n",
        "declare let count: number = 1;\nexport const value = 2;\n",
        "import x from \"not-installed\";\nexport const value = x;\n",
        NARROWER_PARAMETER,
    ] {
        assert_stays_checked(&dependency_with(text), "node_modules/dep/index.ts");
    }
}

const UNDEFINED_FOR_A_NUMBER: &str = "export function first(list: number[]): number {
  return list.length ? list[0] : undefined;
}
export const value = 2;
";

fn lib_under(compiler_options: &str) -> String {
    format!(r#"{{ "extends": "../tsconfig.json", "compilerOptions": {{ {compiler_options} }} }}"#)
}

#[test]
fn project_without_null_checks_has_unverified_types() {
    let config = lib_under(r#""strictNullChecks": false"#);
    let files = [
        ("main.ts", IMPORTS_LIB),
        ("lib/index.ts", UNDEFINED_FOR_A_NUMBER),
        ("lib/tsconfig.json", &config[..]),
    ];
    assert_has_unverified_types(&files, "lib/index.ts");
}

#[test]
fn type_error_in_file_of_the_program_stops_the_build_and_takes_no_types_away() {
    for text in [
        UNDEFINED_FOR_A_NUMBER,
        NARROWER_PARAMETER,
        UNDEFINED_IN_OPTIONAL_PROPERTIES,
    ] {
        let files = [
            ("main.ts", IMPORTS_LIB),
            ("lib/index.ts", text),
            EXACT_OPTIONAL_CONFIG,
        ];
        with_program(&files, &["./main.ts"], 1, |program| {
            let (build, lib) = (check_only(program), program.file("lib/index.ts"));
            assert!(build.has_diagnostics(lib), "{text}");
            assert!(
                build
                    .diagnostics()
                    .all(|it| it.effect == Effect::StopsBuild)
            );
            assert!(build.roles.demoted.is_empty());
            assert_eq!(build.roles.role(lib), FileRole::Checked);
        });
    }
}

#[test]
fn project_that_needs_another_program_has_unverified_types() {
    for answer in [
        r#""strictNullChecks": false"#,
        r#""strictFunctionTypes": false"#,
        r#""strictBindCallApply": false"#,
        r#""strictBuiltinIteratorReturn": false"#,
        r#""exactOptionalPropertyTypes": true"#,
        r#""allowJs": true"#,
        r#""maxNodeModuleJsDepth": 1"#,
        r#""resolveJsonModule": false"#,
        r#""allowArbitraryExtensions": true"#,
        r#""noLib": false"#,
    ] {
        let config = lib_under(answer);
        let files = [
            ("main.ts", IMPORTS_LIB),
            ("lib/index.ts", "export const value = 2;\n"),
            ("lib/tsconfig.json", &config[..]),
        ];
        assert_has_unverified_types(&files, "lib/index.ts");
    }
}

#[test]
fn project_that_makes_the_same_program_keeps_its_types() {
    let config = lib_under(r#""noImplicitAny": false, "noUnusedLocals": true"#);
    let files = [
        ("main.ts", IMPORTS_LIB),
        ("lib/index.ts", "export const value = 2;\n"),
        ("lib/tsconfig.json", &config[..]),
    ];
    assert_stays_checked(&files, "lib/index.ts");
}

#[test]
fn project_without_exact_optional_property_types_has_unverified_types() {
    let files = [
        ("main.ts", IMPORTS_LIB),
        ("lib/index.ts", UNDEFINED_IN_OPTIONAL_PROPERTIES),
        ("lib/tsconfig.json", "{}"),
        EXACT_OPTIONAL_CONFIG,
    ];
    assert_has_unverified_types(&files, "lib/index.ts");
}

#[test]
fn project_without_strict_function_types_has_unverified_types() {
    let files = [
        ("main.ts", IMPORTS_LIB),
        ("lib/index.ts", NARROWER_PARAMETER),
        (
            "lib/tsconfig.json",
            r#"{ "compilerOptions": { "strictFunctionTypes": false } }"#,
        ),
    ];
    assert_has_unverified_types(&files, "lib/index.ts");
}

#[test]
fn own_file_with_type_error_stays_checked() {
    let main_text = r#"import { value } from "./own.ts";
export const copy = value;
"#;
    let files = [("main.ts", main_text), ("own.ts", TYPE_ERROR)];
    with_program(&files, &["./main.ts"], 1, |program| {
        let own = program.file("own.ts");
        let calls = AtomicUsize::new(0);
        let build = check(program, &|_, _| {
            calls.fetch_add(1, Ordering::Relaxed);
        });
        assert!(build.roles.demoted.is_empty());
        assert!(build.roles.checked.is_empty());
        assert!(build.roles.rounds.is_empty());
        assert_eq!(build.roles.role(own), FileRole::Checked);
        let stops_build = (DiagnosticClass::Semantic, Effect::StopsBuild);
        assert_eq!(build.reported(own, 2322), [stops_build]);
        assert_eq!(calls.load(Ordering::Relaxed), 2);
    });
}

#[test]
fn own_file_exempt_from_checking_has_unverified_types() {
    let main_text = r#"import { value } from "./own.ts";
export const copy = value;
"#;
    let exempt_text = "// @ts-nocheck\nexport const value: number = \"text\";\n";
    let files = [("main.ts", main_text), ("own.ts", exempt_text)];
    with_program(&files, &["./main.ts"], 1, |program| {
        let own = program.file("own.ts");
        let build = check_only(program);
        let expected = Demotion {
            file: own,
            cause: DemotionCause::UnverifiedTypes,
        };
        assert_eq!(build.roles.demoted, [expected]);
        assert_eq!(program.files().role(own), FileRole::Checked);
        assert_eq!(build.roles.role(own), FileRole::Inferred);
        assert_eq!(build.roles.role(program.file("main.ts")), FileRole::Checked);
        assert!(build.reported(own, 2322).is_empty());
    });
}

#[test]
fn package_under_the_aot_condition_keeps_its_types_where_it_needs_another_program() {
    for compiler_options in [
        r#""strictNullChecks": false"#,
        r#""strictFunctionTypes": false"#,
        r#""strictBindCallApply": false"#,
        r#""strictBuiltinIteratorReturn": false"#,
        r#""exactOptionalPropertyTypes": true"#,
        r#""allowJs": true"#,
        r#""maxNodeModuleJsDepth": 1"#,
        r#""resolveJsonModule": false"#,
        r#""allowArbitraryExtensions": true"#,
        r#""lib": ["es5"]"#,
    ] {
        let manifest = format!(
            r#"{{
                "name": "shapes",
                "version": "1.0.0",
                "exports": {{ ".": {{ "aot": "./index.aot.ts", "default": "./index.js" }} }},
                "compilerOptions": {{ {compiler_options} }}
            }}"#
        );
        let typed_text = format!("import \"./side.ts\";\n{MISTYPED_SHAPES}");
        let installed = [
            ("main.ts", r#"import "shapes";"#),
            ("node_modules/shapes/package.json", &manifest[..]),
            ("node_modules/shapes/index.js", INSTALLED_SHAPES),
            ("node_modules/shapes/index.aot.ts", &typed_text[..]),
            ("node_modules/shapes/side.ts", UNDEFINED_FOR_A_NUMBER),
        ];
        let linked = [
            ("main.ts", r#"import "./linked/index.aot.ts";"#),
            ("linked/package.json", &manifest[..]),
            ("linked/index.js", INSTALLED_SHAPES),
            ("linked/index.aot.ts", &typed_text[..]),
            ("linked/side.ts", UNDEFINED_FOR_A_NUMBER),
        ];
        for files in [installed, linked] {
            with_program(&files, &["./main.ts"], 1, |program| {
                let build = check_only(program);
                assert_eq!(build.codes(), [0; 0], "{compiler_options}");
                assert!(build.roles.demoted.is_empty(), "{compiler_options}");
                for (path, _) in &files[3..] {
                    let file = program.file(path);
                    assert!(
                        program.files().needs_another_program(file),
                        "{path} {compiler_options}"
                    );
                    assert_eq!(build.roles.role(file), FileRole::Checked, "{path}");
                }
            });
        }
    }
}

#[test]
fn mistyped_file_under_the_aot_condition_keeps_its_types() {
    let manifest = r#"{
        "name": "shapes",
        "version": "1.0.0",
        "exports": { ".": { "aot": "./index.aot.ts", "default": "./index.js" } }
    }"#;
    let files = [
        ("main.ts", r#"import "shapes";"#),
        ("node_modules/shapes/package.json", manifest),
        ("node_modules/shapes/index.js", INSTALLED_SHAPES),
        ("node_modules/shapes/index.aot.ts", MISTYPED_SHAPES),
    ];
    assert_stays_checked(&files, "node_modules/shapes/index.aot.ts");
}

#[test]
fn type_errors_of_dependencies_are_returned_where_asked() {
    let manifest = r#"{
        "name": "shapes",
        "version": "1.0.0",
        "exports": { ".": { "aot": "./index.aot.ts", "default": "./index.js" } }
    }"#;
    let under_aot_condition = [
        ("main.ts", r#"import "shapes";"#),
        ("node_modules/shapes/package.json", manifest),
        ("node_modules/shapes/index.js", INSTALLED_SHAPES),
        ("node_modules/shapes/index.aot.ts", MISTYPED_SHAPES),
    ];
    let plain_source = dependency_with(TYPE_ERROR);
    let cases: [(&[(&str, &str)], &str); 2] = [
        (&plain_source, "node_modules/dep/index.ts"),
        (&under_aot_condition, "node_modules/shapes/index.aot.ts"),
    ];
    for (files, path) in cases {
        with_check_of_dependencies(files, &["./main.ts"], |program| {
            let file = program.file(path);
            let build = check_only(program);
            assert_eq!(
                build.reported(file, 2322),
                [(DiagnosticClass::Semantic, Effect::WithdrawsTrust)],
                "{path}: {:?}, needs another program: {}",
                program.loaded.origin(file),
                program.files().needs_another_program(file),
            );
            assert!(build.roles.demoted.is_empty(), "{path}");
            assert_eq!(build.roles.role(file), FileRole::Checked, "{path}");
        });
        with_program(files, &["./main.ts"], 1, |program| {
            assert_eq!(check_only(program).codes(), [0; 0], "{path}");
        });
    }
}

#[test]
fn early_error_in_dependency_demotes_nothing() {
    let files = dependency_with("let x = 1;\nlet x = 2;\nexport const value = 2;\n");
    with_program(&files, &["./main.ts"], 1, |program| {
        let dep = program.file("node_modules/dep/index.ts");
        let build = check_only(program);
        let redeclarations = build.reported(dep, 2451);
        let early_error = (DiagnosticClass::EarlyError, Effect::StopsBuild);
        assert!(!redeclarations.is_empty());
        assert!(redeclarations.iter().all(|it| *it == early_error));
        assert!(build.roles.diagnostics.is_empty());
        assert!(codes(&build.program.diagnostics).contains(&2451));
        assert!(build.roles.demoted.is_empty());
        assert_eq!(build.roles.role(dep), FileRole::Checked);
    });
}

#[test]
fn type_only_dependency_file_is_not_checked() {
    let main_text = r#"import type { Client } from "dep/client.ts";
export const client: Client = { name: "a" };
"#;
    let client_text = "export interface Client { name: string }
const wrong: string = 1;
";
    let files = [
        ("main.ts", main_text),
        ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
        ("node_modules/dep/client.ts", client_text),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let client = program.file("node_modules/dep/client.ts");
        assert!(!program.files().is_compiled(client));
        let build = check_only(program);
        assert_eq!(build.codes(), [0; 0]);
        assert!(build.roles.demoted.is_empty());
        assert!(build.roles.checked.is_empty());
        assert_eq!(build.roles.role(client), FileRole::Checked);
    });
}

#[test]
fn trees_stay_until_lowering() {
    with_program(&FAILING_DEPENDENCY, &["./main.ts"], 1, |program| {
        let files = program.files();
        let main = program.file("main.ts");
        let dep = program.file("node_modules/dep/index.ts");
        let has_tree = |file: FileId| !files.hir(file).stmts.is_empty();
        assert!(files.module(main).is_leaf);
        let files_to_lower = files.compiled_files();
        let (loaded, host, request) = (program.loaded, program.host, program.request);
        let roles = decide_roles(loaded, host, request, files_to_lower);
        assert!(has_tree(main) && has_tree(dep));
        let checked = check_and_lower(loaded, host, request, &roles, files_to_lower, &|_, file| {
            Some(has_tree(file))
        });
        assert_eq!(checked.lowered.len(), 2);
        assert!(checked.lowered.iter().all(|it| it.1));
    });
}

#[test]
fn runtime_project_keeps_its_roles() {
    let main_text = r#"import "./plain.js";
import "./typed.ts";
import "./wrong.ts";
import "./unchecked.ts";
import type { Size } from "./size.ts";
import type { Shape } from "./shape";
export type Both = [Size, Shape];
"#;
    let files = [
        ("main.ts", main_text),
        ("plain.js", "export {};\n"),
        ("typed.ts", "export const typed: number = 1;\n"),
        ("wrong.ts", "export const wrong: number = \"text\";\n"),
        (
            "unchecked.ts",
            "// @ts-nocheck\nexport const unchecked: number = \"text\";\n",
        ),
        ("size.ts", "export type Size = number;\n"),
        ("shape.d.ts", "export interface Shape { side: number }\n"),
    ];
    with_runtime_project(&files, &["main.ts"], |program| {
        let build = check_only(program);
        let unchecked = program.file("unchecked.ts");
        let expected = Demotion {
            file: unchecked,
            cause: DemotionCause::UnverifiedTypes,
        };
        assert_eq!(build.roles.demoted, [expected]);
        for path in ["main.ts", "typed.ts", "wrong.ts", "size.ts"] {
            assert_eq!(
                build.roles.role(program.file(path)),
                FileRole::Checked,
                "{path}"
            );
        }
        for path in ["plain.js", "unchecked.ts"] {
            assert_eq!(
                build.roles.role(program.file(path)),
                FileRole::Inferred,
                "{path}"
            );
        }
        assert_eq!(
            build.roles.role(program.file("shape.d.ts")),
            FileRole::TypesOnly
        );
        assert!(!program.files().is_compiled(program.file("size.ts")));
        assert!(build.roles.checked.is_empty());
        assert_eq!(build.codes(), [0; 0]);
    });
}

const DEPENDENCY_FILE_COUNT: usize = 24;

fn generated_dependency_text(index: usize) -> String {
    let error = match index.is_multiple_of(3) {
        true => "const wrong: string = 1;\n",
        false => "",
    };
    match index.checked_sub(1) {
        Some(before) => format!(
            "import {{ value{before} }} from \"./f{before}.ts\";\n\
             {error}export const value{index} = value{before} + 1;\n"
        ),
        None => format!("{error}export const value{index} = 0;\n"),
    }
}

fn generated_dependency() -> Vec<(String, String)> {
    let (mut imports, mut names) = (String::new(), String::new());
    for index in 0..DEPENDENCY_FILE_COUNT {
        imports += &format!("import {{ value{index} }} from \"dep/f{index}.ts\";\n");
        names += &format!("value{index}, ");
    }
    let manifest = "node_modules/dep/package.json".to_owned();
    let mut files = vec![
        (
            "main.ts".to_owned(),
            format!("{imports}export const all = [{names}];\n"),
        ),
        (manifest, DEPENDENCY_MANIFEST.to_owned()),
    ];
    files.extend((0..DEPENDENCY_FILE_COUNT).map(|index| {
        let path = format!("node_modules/dep/f{index}.ts");
        (path, generated_dependency_text(index))
    }));
    files
}

fn check_generated_dependency(threads: usize) -> BuildSummary<Vec<u8>> {
    let generated = generated_dependency();
    let files = generated.iter().map(|(path, text)| (&path[..], &text[..]));
    let files: Vec<(&str, &str)> = files.collect();
    with_program(&files, &["./main.ts"], threads, |program| {
        let files = program.files();
        let build = check(program, &|_, file| files.module(file).file_name().to_vec());
        assert!(build.roles.demoted.is_empty());
        assert!(build.roles.checked.is_empty());
        build.into_summary()
    })
}

#[test]
fn what_is_decided_does_not_depend_on_threads() {
    let on_one_thread = check_generated_dependency(1);
    for threads in [2, 8] {
        assert_eq!(
            check_generated_dependency(threads),
            on_one_thread,
            "{threads} threads"
        );
    }
}
