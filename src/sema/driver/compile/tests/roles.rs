use super::support::{
    BuildSummary, CheckedBuild, DEPENDENCY_MANIFEST, FAILING_DEPENDENCY, HostScript,
    IMPORTS_DEPENDENCY, PROJECT, ScriptedHost, TYPE_ERROR, TestProgram, check, check_only, codes,
    project_disk, with_host, with_program, with_runtime_project,
};
use crate::{Demotion, DemotionCause, RoleDecision, check_and_lower, decide_roles};
use bun_sema::check::aot::{DiagnosticClass, Effect, FileOrigin};
use bun_sema::program::{FileId, FileRole};
use bun_sema::util::SharedSort;
use std::sync::atomic::{AtomicUsize, Ordering};

const INSTALLED_SHAPES: &str = "export function area(side) {
  return side * side;
}
";
const MISTYPED_SHAPES: &str = "export function area(side: number): string {
  return side * side;
}
";

const STOPS_BUILD: (DiagnosticClass, Effect) = (DiagnosticClass::Semantic, Effect::StopsBuild);
const WITHDRAWS_TRUST: (DiagnosticClass, Effect) =
    (DiagnosticClass::Semantic, Effect::WithdrawsTrust);

fn type_error_in(file: FileId) -> Demotion {
    Demotion {
        file,
        cause: DemotionCause::TypeError,
    }
}

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
fn dependency_with_type_error_is_demoted() {
    let check_with_threads = |threads: usize| {
        with_program(&FAILING_DEPENDENCY, &["./main.ts"], threads, |program| {
            let dep = program.file("node_modules/dep/index.ts");
            let build = check_with_roles(program, &|roles, _| roles.role(dep));
            assert_eq!(build.roles.demoted, [type_error_in(dep)]);
            assert_eq!(build.roles.checked, [dep]);
            assert_eq!(build.roles.role(dep), FileRole::Inferred);
            assert_eq!(program.files().role(dep), FileRole::Checked);
            assert_eq!(build.reported(dep, 2322), [WITHDRAWS_TRUST]);
            assert_eq!(build.program.lowered.len(), 2);
            let mut seen_roles = build.program.lowered.iter().map(|it| it.1);
            assert!(seen_roles.all(|role| role == FileRole::Inferred));
            build.into_summary()
        })
    };
    assert_eq!(check_with_threads(1), check_with_threads(4));
}

#[test]
fn demotion_lowers_each_file_once() {
    with_program(&FAILING_DEPENDENCY, &["./main.ts"], 1, |program| {
        let files = program.files();
        let calls: Vec<AtomicUsize> = files.modules.iter().map(|_| AtomicUsize::new(0)).collect();
        let build = check(program, &|_, file| {
            calls[file.idx()].fetch_add(1, Ordering::Relaxed);
        });
        assert_eq!(
            build.demoted_files(),
            [program.file("node_modules/dep/index.ts")]
        );
        let calls: Vec<usize> = calls.iter().map(|it| it.load(Ordering::Relaxed)).collect();
        for &file in files.compiled_files() {
            assert_eq!(calls[file.idx()], 1, "{file:?}");
        }
        assert_eq!(calls.iter().sum::<usize>(), files.compiled_files().len());
    });
}

#[test]
fn dependency_without_errors_stays_checked() {
    let files = dependency_with("export const value = 2;\n");
    with_program(&files, &["./main.ts"], 1, |program| {
        let dep = program.file("node_modules/dep/index.ts");
        let build = check_only(program);
        assert!(build.roles.demoted.is_empty());
        assert_eq!(build.roles.checked, [dep]);
        assert_eq!(build.roles.role(dep), FileRole::Checked);
        assert_eq!(build.codes(), [0; 0]);
    });
}

#[test]
fn grammar_error_in_dependency_keeps_trust() {
    let files = dependency_with("declare let count: number = 1;\nexport const value = 2;\n");
    with_program(&files, &["./main.ts"], 1, |program| {
        let dep = program.file("node_modules/dep/index.ts");
        let build = check_only(program);
        assert!(build.roles.demoted.is_empty());
        assert_eq!(build.roles.role(dep), FileRole::Checked);
        assert_eq!(build.codes(), [0; 0]);
    });
}

#[test]
fn missing_declaration_in_dependency_keeps_trust() {
    let files = dependency_with("import x from \"not-installed\";\nexport const value = x;\n");
    with_program(&files, &["./main.ts"], 1, |program| {
        let dep = program.file("node_modules/dep/index.ts");
        let build = check_only(program);
        assert!(build.roles.demoted.is_empty());
        assert_eq!(build.roles.role(dep), FileRole::Checked);
        assert_eq!(build.codes(), [0; 0]);
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

#[test]
fn dependency_is_not_held_to_exact_optional_property_types_of_the_program() {
    let mut files = dependency_with(UNDEFINED_IN_OPTIONAL_PROPERTIES).to_vec();
    files.push(EXACT_OPTIONAL_CONFIG);
    assert_stays_checked(&files, "node_modules/dep/index.ts");
}

#[test]
fn project_without_exact_optional_property_types_is_not_held_to_it() {
    let files = [
        ("main.ts", IMPORTS_LIB),
        ("lib/index.ts", UNDEFINED_IN_OPTIONAL_PROPERTIES),
        ("lib/tsconfig.json", "{}"),
        EXACT_OPTIONAL_CONFIG,
    ];
    assert_stays_checked(&files, "lib/index.ts");
}

#[test]
fn file_of_the_program_is_held_to_exact_optional_property_types() {
    let files = [
        ("main.ts", IMPORTS_LIB),
        ("lib/index.ts", UNDEFINED_IN_OPTIONAL_PROPERTIES),
        EXACT_OPTIONAL_CONFIG,
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let lib = program.file("lib/index.ts");
        let build = check_only(program);
        for code in [2375, 2379, 2412] {
            assert!(build.reported(lib, code).contains(&STOPS_BUILD), "{code}");
        }
    });
}

#[test]
fn another_error_beside_exact_optional_property_types_still_demotes() {
    let text = "export interface Options { limit?: number }
export const options: Options = { limit: undefined };
const wrong: string = 1;
export const value = 2;
";
    let mut files = dependency_with(text).to_vec();
    files.push(EXACT_OPTIONAL_CONFIG);
    with_program(&files, &["./main.ts"], 1, |program| {
        let dep = program.file("node_modules/dep/index.ts");
        let build = check_only(program);
        assert_eq!(build.roles.demoted, [type_error_in(dep)]);
        assert_eq!(build.codes(), [2322]);
    });
}

#[test]
fn dependency_is_not_held_to_strict_function_types_of_the_program() {
    assert_stays_checked(
        &dependency_with(NARROWER_PARAMETER),
        "node_modules/dep/index.ts",
    );
}

#[test]
fn callback_of_the_program_is_held_to_strict_function_types() {
    let main_text = r#"import { each } from "dep";
interface Animal { name: string }
interface Dog extends Animal { bark: number }
declare const animal: Animal;
export const visited = each(animal, (dog: Dog) => dog.bark);
"#;
    let mut files = dependency_with(NARROWER_PARAMETER);
    files[0] = ("main.ts", main_text);
    with_program(&files, &["./main.ts"], 1, |program| {
        let build = check_only(program);
        assert!(build.roles.demoted.is_empty());
        assert_eq!(build.reported(program.file("main.ts"), 2741), [STOPS_BUILD]);
    });
}

#[test]
fn project_without_strict_function_types_is_not_held_to_it() {
    let files = [
        ("main.ts", IMPORTS_LIB),
        ("lib/index.ts", NARROWER_PARAMETER),
        (
            "lib/tsconfig.json",
            r#"{ "compilerOptions": { "strictFunctionTypes": false } }"#,
        ),
    ];
    assert_stays_checked(&files, "lib/index.ts");
}

#[test]
fn file_of_the_program_is_held_to_strict_function_types() {
    let files = [
        ("main.ts", IMPORTS_LIB),
        ("lib/index.ts", NARROWER_PARAMETER),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let build = check_only(program);
        assert_eq!(
            build.reported(program.file("lib/index.ts"), 2322),
            [STOPS_BUILD]
        );
    });
}

#[test]
fn related_entry_names_demoted_file() {
    let main_text = r#"import { value, type Options } from "dep";
export const copy = value;
export const options: Options = {};
"#;
    let dependency_text = "const wrong: string = 1;
export interface Options { name: string }
export const value = 2;
";
    let files = [
        ("main.ts", main_text),
        ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
        ("node_modules/dep/index.ts", dependency_text),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let main = program.file("main.ts");
        let dep = program.file("node_modules/dep/index.ts");
        let build = check_only(program);
        assert_eq!(build.roles.demoted, [type_error_in(dep)]);
        assert_eq!(build.reported(main, 2741), [STOPS_BUILD]);
        let mut diagnostics = build.diagnostics();
        let missing_property = diagnostics.find(|it| it.diagnostic.code == 2741).unwrap();
        let related = missing_property.diagnostic.related.iter();
        let related: Vec<Option<FileId>> = related.map(|it| it.file).collect();
        assert_eq!(related, [Some(dep)]);
    });
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
        assert_eq!(build.reported(own, 2322), [STOPS_BUILD]);
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
fn application_under_node_modules_is_not_demoted() {
    let tsconfig = r#"{
        "compilerOptions": { "strict": true, "noLib": true, "types": [] },
        "files": ["../../globals.d.ts"]
    }"#;
    let main_text = r#"import { value } from "./half.ts";
export const copy = value;
"#;
    let files = [
        ("node_modules/app/package.json", r#"{ "name": "app" }"#),
        ("node_modules/app/tsconfig.json", tsconfig),
        ("node_modules/app/main.ts", main_text),
        ("node_modules/app/half.ts", TYPE_ERROR),
    ];
    with_program(&files, &["./node_modules/app/main.ts"], 1, |program| {
        let half = program.file("node_modules/app/half.ts");
        let build = check_only(program);
        assert!(build.roles.demoted.is_empty());
        assert_eq!(build.reported(half, 2322), [STOPS_BUILD]);
    });
}

#[test]
fn mistyped_file_under_the_aot_condition_is_demoted() {
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
    with_program(&files, &["./main.ts"], 1, |program| {
        let shapes = program.file("node_modules/shapes/index.aot.ts");
        let build = check_only(program);
        assert_eq!(build.roles.demoted, [type_error_in(shapes)]);
        assert_eq!(build.roles.role(shapes), FileRole::Inferred);
        assert_eq!(build.reported(shapes, 2322), [WITHDRAWS_TRUST]);
    });
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
        assert!(codes(&build.roles.diagnostics).contains(&2451));
        assert!(!codes(&build.program.diagnostics).contains(&2451));
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
fn demotion_is_per_file() {
    let main_text = r#"import { value } from "dep/a.ts";
import { other } from "dep/b.ts";
export const both = [value, other];
"#;
    let files = [
        ("main.ts", main_text),
        ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
        ("node_modules/dep/a.ts", TYPE_ERROR),
        ("node_modules/dep/b.ts", "export const other = 3;\n"),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let a = program.file("node_modules/dep/a.ts");
        let b = program.file("node_modules/dep/b.ts");
        let build = check_only(program);
        assert_eq!(build.roles.demoted, [type_error_in(a)]);
        assert!(build.roles.is_checked(a) && build.roles.is_checked(b));
        assert_eq!(build.roles.role(a), FileRole::Inferred);
        assert_eq!(build.roles.role(b), FileRole::Checked);
        assert!(!build.has_diagnostics(b));
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
        assert_eq!(roles.checked, [dep]);
        assert!(has_tree(main) && has_tree(dep));
        let checked = check_and_lower(loaded, host, request, &roles, files_to_lower, &|_, file| {
            Some(has_tree(file))
        });
        assert_eq!(checked.lowered.len(), 2);
        assert!(checked.lowered.iter().all(|it| it.1));
        assert!(!has_tree(main));
    });
}

#[test]
fn runtime_project_without_type_errors_keeps_its_roles() {
    let main_text = r#"import "./plain.js";
import "./typed.ts";
import type { Size } from "./size.ts";
import type { Shape } from "./shape";
export type Both = [Size, Shape];
"#;
    let files = [
        ("main.ts", main_text),
        ("plain.js", "export {};\n"),
        ("typed.ts", "export const typed: number = 1;\n"),
        ("size.ts", "export type Size = number;\n"),
        ("shape.d.ts", "export interface Shape { side: number }\n"),
    ];
    with_runtime_project(&files, &["main.ts"], |program| {
        let build = check_only(program);
        assert!(build.roles.demoted.is_empty());
        for path in ["main.ts", "typed.ts", "size.ts"] {
            assert_eq!(
                build.roles.role(program.file(path)),
                FileRole::Checked,
                "{path}"
            );
        }
        assert_eq!(
            build.roles.role(program.file("plain.js")),
            FileRole::Inferred
        );
        assert_eq!(
            build.roles.role(program.file("shape.d.ts")),
            FileRole::TypesOnly
        );
        assert!(!program.files().is_compiled(program.file("size.ts")));
        let mut checked = ["main.ts", "typed.ts"].map(|path| program.file(path));
        checked.shared_sort_unstable();
        assert_eq!(build.roles.checked, checked);
    });
}

#[test]
fn runtime_file_without_type_errors_keeps_its_types() {
    let main_text = r#"import "./right.ts";
import "./wrong.ts";
import "./unchecked.ts";
"#;
    let files = [
        ("main.ts", main_text),
        ("right.ts", "export const right: number = 1;\n"),
        ("wrong.ts", "export const wrong: number = \"text\";\n"),
        (
            "unchecked.ts",
            "// @ts-nocheck\nexport const unchecked: number = \"text\";\n",
        ),
    ];
    with_runtime_project(&files, &["main.ts"], |program| {
        let (right, wrong) = (program.file("right.ts"), program.file("wrong.ts"));
        let unchecked = program.file("unchecked.ts");
        let build = check_only(program);
        assert_eq!(build.roles.role(right), FileRole::Checked);
        assert_eq!(build.roles.role(wrong), FileRole::Inferred);
        assert_eq!(build.roles.role(unchecked), FileRole::Inferred);
        let cause_of = |file: FileId| {
            let demotions = build.roles.demoted.iter();
            demotions
                .filter(|it| it.file == file)
                .map(|it| it.cause)
                .collect::<Vec<_>>()
        };
        assert!(cause_of(right).is_empty());
        assert_eq!(cause_of(wrong), [DemotionCause::TypeError]);
        assert_eq!(cause_of(unchecked), [DemotionCause::UnverifiedTypes]);
        assert_eq!(build.reported(wrong, 2322), [WITHDRAWS_TRUST]);
        let mut checked = [program.file("main.ts"), right, wrong];
        checked.shared_sort_unstable();
        assert_eq!(build.roles.checked, checked);
        assert!(build.reported(unchecked, 2322).is_empty());
    });
}

const DEPENDENCY_FILE_COUNT: usize = 24;

fn has_generated_error(index: usize) -> bool {
    index.is_multiple_of(3)
}

fn generated_dependency_text(index: usize) -> String {
    let error = match has_generated_error(index) {
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
        let with_error = (0..DEPENDENCY_FILE_COUNT).filter(|&index| has_generated_error(index));
        let mut expected: Vec<FileId> = with_error
            .map(|index| program.file(&format!("node_modules/dep/f{index}.ts")))
            .collect();
        expected.shared_sort_unstable();
        assert_eq!(build.demoted_files(), expected);
        assert_eq!(build.roles.checked.len(), DEPENDENCY_FILE_COUNT);
        assert!(build.roles.checked.is_sorted());
        build.into_summary()
    })
}

#[test]
fn demotions_do_not_depend_on_threads() {
    let on_one_thread = check_generated_dependency(1);
    for threads in [2, 8] {
        assert_eq!(
            check_generated_dependency(threads),
            on_one_thread,
            "{threads} threads"
        );
    }
}
