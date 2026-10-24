use super::support::{
    BuildSummary, DEPENDENCY_MANIFEST, FAILING_DEPENDENCY, IMPORTS_DEPENDENCY, TYPE_ERROR, check,
    check_only, codes, with_defines, with_program, with_runtime_project,
};
use crate::{
    BuildDiagnostic, CompileRequest, Locator, Progress, check_and_lower, decide_roles,
    equal_diagnostics, global, log_message,
};
use bun_sema::check::aot::{DiagnosticClass, Effect};
use bun_sema::program::{FileId, FileRole};
use bun_sema::util::SharedSort;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

const STOPS_BUILD: (DiagnosticClass, Effect) = (DiagnosticClass::Semantic, Effect::StopsBuild);

#[test]
fn default_project_checks_cleanly() {
    let files = [("main.ts", "export const list: number[] = [1];\n")];
    with_program(&files, &["./main.ts"], 1, |program| {
        assert_eq!(codes(&program.loaded.diagnostics), [0; 0]);
        let build = check_only(program);
        assert_eq!(codes(&build.roles.diagnostics), [0; 0]);
        assert_eq!(codes(&build.program.diagnostics), [0; 0]);
        assert!(build.roles.incomplete.is_empty());
        assert!(build.program.incomplete.is_empty());
        assert!(build.roles.demoted.is_empty());
    });
}

#[test]
fn error_under_a_directive_is_hidden_and_the_others_name_their_types() {
    let text = "declare function take(value: { a: number }): void;
declare const given: { a: string };
// @ts-expect-error
take(given);
// @ts-ignore
take(given);
take(given);
// @ts-expect-error
take({ a: 1 });
";
    with_program(&[("main.ts", text)], &["./main.ts"], 1, |program| {
        let build = check_only(program);
        assert_eq!(build.codes(), [2345, 2578]);
        let shown = build
            .diagnostics()
            .find(|it| it.diagnostic.code == 2345)
            .unwrap();
        let expected = "Argument of type '{ a: string; }' is not assignable to parameter of type '{ a: number; }'.
  Types of property 'a' are incompatible.
    Type 'string' is not assignable to type 'number'.";
        assert_eq!(String::from_utf8_lossy(&shown.diagnostic.text), expected);
    });
}

#[test]
fn requested_by_origin() {
    let main_text = r#"import "./a.js";
import "./b.js";
const wrong: string = 1;
"#;
    let files = [
        ("main.ts", main_text),
        ("a.js", "/** @type {string} */\nconst wrong = 1;\n"),
        ("b.js", "let x;\nlet x;\n"),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let build = check_only(program);
        assert_eq!(build.reported(program.file("main.ts"), 2322), [STOPS_BUILD]);
        assert!(!build.has_diagnostics(program.file("a.js")));
        let redeclarations = build.reported(program.file("b.js"), 2451);
        let early_error = (DiagnosticClass::EarlyError, Effect::StopsBuild);
        assert!(!redeclarations.is_empty());
        assert!(redeclarations.iter().all(|it| *it == early_error));
        assert!(build.roles.demoted.is_empty());
    });
}

#[test]
fn import_call_takes_one_or_two_arguments() {
    let main_text = r#"import "./none.js";
import "./three.js";
import "./spread.js";
import "./two.js";
"#;
    let files = [
        ("main.js", main_text),
        ("none.js", "export const load = () => import();\n"),
        (
            "three.js",
            "export const load = (a, b, c) => import(a, b, c);\n",
        ),
        ("spread.js", "export const load = (a) => import(...a);\n"),
        ("two.js", "export const load = (a, b) => import(a, b);\n"),
    ];
    with_program(&files, &["./main.js"], 1, |program| {
        let build = check_only(program);
        let early_error = [(DiagnosticClass::EarlyError, Effect::StopsBuild)];
        assert_eq!(build.reported(program.file("none.js"), 1450), early_error);
        assert!(
            build
                .diagnostics()
                .all(|it| log_message(&it.diagnostic).is_some())
        );
        assert_eq!(build.reported(program.file("three.js"), 1450), early_error);
        assert_eq!(build.reported(program.file("spread.js"), 1325), early_error);
        assert!(!build.has_diagnostics(program.file("two.js")));
    });
}

const REFUSED_AFTER_FUNCTION_DIRECTIVE: [&str; 19] = [
    r#"function f(a, a) { "use strict"; }"#,
    r#"function f() { "use strict"; var public; }"#,
    r#"function f() { "use strict"; var static; }"#,
    r#"function f() { "use strict"; var yield; }"#,
    r#"function f() { "use strict"; var let; }"#,
    r#"function f() { "use strict"; var interface; }"#,
    r#"function f() { "use strict"; eval = 1; }"#,
    r#"function f() { "use strict"; arguments = 1; }"#,
    r#"function f() { "use strict"; var eval; }"#,
    r#"function f() { "use strict"; var arguments; }"#,
    r#"function f() { "use strict"; function g(a, a) {} }"#,
    r#"function f() { "use strict"; function g() { var public; } }"#,
    r#"function f() { "use strict"; return () => { var public; }; }"#,
    r#"function f() { "use strict"; function eval() {} }"#,
    r#"function f() { "use strict"; function g(eval) {} }"#,
    r#"function f() { "use strict"; function g(public) {} }"#,
    r#"function f() { "use strict"; public = 1; }"#,
    r#"function f() { "use strict"; return public; }"#,
    r#""use strict"; function f() { delete f; }"#,
];

const ACCEPTED_WITH_FUNCTION_DIRECTIVE: [&str; 13] = [
    r#"function f(public) { "use strict"; }"#,
    r#"function public() { "use strict"; }"#,
    r#"function f(eval) { "use strict"; }"#,
    r#"function eval() { "use strict"; }"#,
    r#"function f() { "use strict"; with (f) {} }"#,
    r#"function f() { "use strict"; 010; }"#,
    r#"function f() { "use strict"; "\010"; }"#,
    r#"function f() { "use strict"; delete f; }"#,
    r#"function f() { "use strict"; if (1) function g() {} }"#,
    r#"function f() { "use strict"; l: function g() {} }"#,
    r#"function f(a = 1) { "use strict"; }"#,
    r#"function f() { var public; "use strict"; }"#,
    r#"function f() { var public; var eval; var arguments; }"#,
];

#[test]
fn function_directive_is_read_as_bun_run_reads_it() {
    let cases = REFUSED_AFTER_FUNCTION_DIRECTIVE
        .iter()
        .chain(&ACCEPTED_WITH_FUNCTION_DIRECTIVE);
    let case_count = cases.clone().count();
    let names: Vec<String> = (0..case_count)
        .map(|index| format!("{index}.cjs"))
        .collect();
    let require = |name: &String| format!("require(\"./{name}\");\n");
    let main_text = names.iter().map(require).collect::<String>();
    let mut files = vec![("main.cjs", main_text.as_str())];
    files.extend(names.iter().map(String::as_str).zip(cases.copied()));
    with_program(&files, &["./main.cjs"], 1, |program| {
        let build = check_only(program);
        for (index, &(name, text)) in files[1..].iter().enumerate() {
            let file = Some(program.file(name));
            let is_refused = build.diagnostics().any(|it| {
                it.diagnostic.file == file && it.diagnostic.class == DiagnosticClass::EarlyError
            });
            assert_eq!(
                is_refused,
                index < REFUSED_AFTER_FUNCTION_DIRECTIVE.len(),
                "{text}"
            );
        }
    });
}

#[test]
fn errors_in_code_that_is_never_reached_are_dropped() {
    let never_reached = r#"import { gone, here } from "./lib.ts";
        import alsoGone from "./lib.ts";
        export function early(): number {
            if (true) {
                return here;
            }
            const wrong: number = "text";
            return gone + alsoGone + missing + wrong;
        }"#;
    let reached = never_reached.replace("if (true)", "if (here)");
    let lib = ("lib.ts", "export const here = 1;");
    with_program(
        &[("main.ts", never_reached), lib],
        &["./main.ts"],
        1,
        |program| {
            assert_eq!(check_only(program).codes(), []);
        },
    );
    with_program(
        &[("main.ts", reached.as_str()), lib],
        &["./main.ts"],
        1,
        |program| {
            let mut found = check_only(program).codes();
            found.sort_unstable();
            assert_eq!(found, [1192, 2304, 2305, 2322]);
        },
    );
}

#[test]
fn file_loaded_for_its_types_alone_reports_nothing() {
    let files = [
        (
            "main.ts",
            r#"import type { Shape } from "./shapes.ts";
            export const shape: Shape = { sides: 3 };
            if (process.env.X === "a") {
                (require("./tool.ts") as typeof import("./tool.ts")).run();
            }"#,
        ),
        (
            "shapes.ts",
            "export interface Shape { sides: number }\nconst wrong: number = 'text';",
        ),
        (
            "tool.ts",
            "export function run() { const wrong: number = 'text'; return wrong; }",
        ),
    ];
    with_defines(
        &files,
        &["./main.ts"],
        &[("process.env.X", "b")],
        |program| {
            for name in ["shapes.ts", "tool.ts"] {
                assert!(!program.files().is_compiled(program.file(name)), "{name}");
            }
            assert_eq!(check_only(program).codes(), []);
        },
    );
    with_defines(
        &files,
        &["./main.ts"],
        &[("process.env.X", "a")],
        |program| {
            let build = check_only(program);
            let error = [(DiagnosticClass::Semantic, Effect::StopsBuild)];
            assert_eq!(build.reported(program.file("tool.ts"), 2322), error);
            assert_eq!(build.reported(program.file("shapes.ts"), 2322), []);
        },
    );
}

#[test]
fn one_result_per_lowered_file() {
    let main_text = r#"import "./a.ts";
import "./b.js";
import type { C } from "./c.ts";
export type D = C;
"#;
    let files = [
        ("main.ts", main_text),
        ("a.ts", "import \"./b.js\";\nexport {};\n"),
        ("b.js", "export {};\n"),
        ("c.ts", "export type C = 1;\n"),
    ];
    let check_with_threads = |threads: usize| {
        with_program(&files, &["./main.ts"], threads, |program| {
            let files = program.files();
            let build = check(program, &|_, file| files.module(file).file_name().to_vec());
            let mut compiled = files.compiled_files().to_vec();
            compiled.shared_sort_unstable();
            let lowered: Vec<FileId> = build.program.lowered.iter().map(|it| it.0).collect();
            assert_eq!(lowered, compiled);
            assert_eq!(lowered.len(), 3);
            assert!(!lowered.contains(&program.file("c.ts")));
            for (file, name) in &build.program.lowered {
                assert_eq!(name, files.module(*file).file_name());
            }
            build.into_summary()
        })
    };
    assert_eq!(check_with_threads(1), check_with_threads(4));
}

fn is_first_entry_point_held(text: &str) -> (bool, bool) {
    let sources = [("main.ts", text), ("other.ts", "export const b = 2;\n")];
    with_program(&sources, &["./main.ts", "./other.ts"], 1, |program| {
        let (files, main, other) = (
            program.files(),
            program.file("main.ts"),
            program.file("other.ts"),
        );
        assert!(files.module(main).is_leaf && files.module(other).is_leaf);
        let has_tree = || !files.hir(main).stmts.is_empty();
        let had_tree = AtomicBool::new(false);
        let build = check(program, &|_, file| {
            if file == other {
                had_tree.store(has_tree(), Ordering::Relaxed);
            }
        });
        assert_eq!(build.codes(), []);
        (had_tree.load(Ordering::Relaxed), has_tree())
    })
}

#[test]
fn tree_that_every_task_reads_stays_until_the_pass_ends() {
    let plain = "class A {\n  create() {}\n}\ninterface B {\n  b: number;\n}\nexport const a: B = { b: 1 };\nnew A().create();\n";
    assert_eq!(is_first_entry_point_held(plain), (false, false));
    let with_static_member = "class A {\n  static create() {}\n}\nA.create();\nexport {};\n";
    assert_eq!(is_first_entry_point_held(with_static_member), (true, false));
    let with_heritage = "interface B {\n  b: number;\n}\ninterface C extends B {\n  c: number;\n}\nexport const a: C = { b: 1, c: 2 };\n";
    assert_eq!(is_first_entry_point_held(with_heritage), (true, false));
}

#[test]
fn progress_counts_both_passes() {
    with_program(&FAILING_DEPENDENCY, &["./main.ts"], 1, |program| {
        let progress = Progress::default();
        let request = CompileRequest {
            progress: Some(&progress),
            ..*program.request
        };
        let files_to_lower = program.files().compiled_files();
        let (loaded, host) = (program.loaded, program.host);
        let roles = decide_roles(loaded, host, &request, files_to_lower);
        let checked = check_and_lower(loaded, host, &request, &roles, files_to_lower, &|_, _| {
            Some(())
        });
        assert_eq!(roles.checked.len(), 1);
        assert_eq!(checked.lowered.len(), 2);
        let count = |counter: &AtomicUsize| counter.load(Ordering::Relaxed);
        assert_eq!(count(&progress.to_check), 1 + 2);
        assert_eq!(count(&progress.checked), count(&progress.to_check));
        assert_ne!(count(&progress.bytes_to_check), 0);
        assert_eq!(
            count(&progress.bytes_checked),
            count(&progress.bytes_to_check)
        );
    });
}

#[test]
fn type_error_in_runtime_project_withdraws_trust() {
    with_runtime_project(&[("a.ts", TYPE_ERROR)], &["a.ts"], |program| {
        let build = check_only(program);
        let file = program.file("a.ts");
        assert_eq!(build.codes(), [2322]);
        let withdraws_trust = (DiagnosticClass::Semantic, Effect::WithdrawsTrust);
        assert_eq!(build.reported(file, 2322), [withdraws_trust]);
        assert_eq!(build.roles.role(file), FileRole::Inferred);
        let lowered: Vec<FileId> = build.program.lowered.iter().map(|it| it.0).collect();
        assert_eq!(lowered, [file]);
    });
}

#[test]
fn syntax_error_in_runtime_project_is_internal() {
    with_runtime_project(
        &[("a.ts", "export const value = ;\n")],
        &["a.ts"],
        |program| {
            let build = check_only(program);
            let reported: Vec<(DiagnosticClass, Effect)> = build
                .diagnostics()
                .map(|it| (it.diagnostic.class, it.effect))
                .collect();
            let internal_error = (DiagnosticClass::EarlyError, Effect::InternalError);
            assert!(!reported.is_empty());
            assert!(reported.iter().all(|it| *it == internal_error));
            assert!(build.has_diagnostics(program.file("a.ts")));
        },
    );
}

#[test]
fn skip_lib_check_skips_reached_declaration_file() {
    let main_text = r#"import type { Shape } from "./shape";
export type Copy = Shape;
"#;
    for skips_lib_check in [false, true] {
        let tsconfig = format!(
            r#"{{
                "compilerOptions": {{
                    "strict": true, "noLib": true, "types": [], "skipLibCheck": {skips_lib_check},
                    "module": "preserve", "moduleResolution": "bundler"
                }}
            }}"#
        );
        let files = [
            ("tsconfig.json", &tsconfig[..]),
            ("main.ts", main_text),
            ("shape.d.ts", "export interface Shape { side: }\n"),
        ];
        with_program(&files, &["./main.ts"], 1, |program| {
            let shape = program.file("shape.d.ts");
            assert!(
                program
                    .files()
                    .module(program.file("main.ts"))
                    .edges
                    .contains(&shape)
            );
            let build = check_only(program);
            assert_eq!(build.has_diagnostics(shape), !skips_lib_check);
            let lowered: Vec<FileId> = build.program.lowered.iter().map(|it| it.0).collect();
            assert_eq!(lowered, [program.file("main.ts")]);
        });
    }
}

#[test]
fn semantic_error_in_declaration_file_is_dropped() {
    let main_text = r#"import type { Shape } from "./shape";
export type Copy = Shape;
"#;
    let files = [
        ("main.ts", main_text),
        ("shape.d.ts", "export interface Shape { side: Missing }\n"),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        assert_eq!(check_only(program).codes(), [0; 0]);
    });
}

#[test]
fn only_compiled_source_files_are_checked() {
    let main_text = r#"import type { Size } from "./reached.ts";
export type Copy = Size;
"#;
    let only_types = "export type Size = number;\nconst wrong: string = 1;\n";
    let files = [
        ("main.ts", main_text),
        ("reached.ts", only_types),
        ("unreached.ts", only_types),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let (reached, unreached) = (program.file("reached.ts"), program.file("unreached.ts"));
        assert!(!program.files().is_compiled(reached));
        let build = check_only(program);
        assert!(!build.has_diagnostics(reached));
        assert!(!build.has_diagnostics(unreached));
        let lowered: Vec<FileId> = build.program.lowered.iter().map(|it| it.0).collect();
        assert_eq!(lowered, [program.file("main.ts")]);
    });
}

#[test]
fn style_rule_in_dependency_is_not_reported() {
    let tsconfig = r#"{
        "compilerOptions": { "strict": true, "noLib": true, "types": [], "noUnusedLocals": true }
    }"#;
    let main_text = r#"import { value } from "dep";
import "./own.ts";
export const copy = value;
"#;
    let unused_local = "const unused = 1;\nexport const value = 2;\n";
    let files = [
        ("tsconfig.json", tsconfig),
        ("main.ts", main_text),
        ("own.ts", unused_local),
        ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
        ("node_modules/dep/index.ts", unused_local),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let build = check_only(program);
        let style = (DiagnosticClass::Style, Effect::StopsBuild);
        assert_eq!(build.reported(program.file("own.ts"), 6133), [style]);
        assert!(!build.has_diagnostics(program.file("node_modules/dep/index.ts")));
        assert!(build.roles.demoted.is_empty());
    });
}

const GLOBAL_TYPES_WITHOUT_REGEXP: &str =
    "interface Array<T> { length: number; [index: number]: T }
interface Boolean {}
interface CallableFunction {}
interface Function {}
interface IArguments {}
interface NewableFunction {}
interface Number {}
interface Object {}
interface String {}
";

#[test]
fn each_diagnostic_is_reported_once() {
    let files = [
        ("globals.d.ts", GLOBAL_TYPES_WITHOUT_REGEXP),
        ("main.ts", IMPORTS_DEPENDENCY),
        ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
        (
            "node_modules/dep/index.ts",
            "const wrong: string = 1;\nexport const value = ;\n",
        ),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let dep = program.file("node_modules/dep/index.ts");
        let build = check_only(program);
        let all: Vec<&BuildDiagnostic> = build.diagnostics().collect();
        for (index, first) in all.iter().enumerate() {
            let mut later = all[index + 1..].iter();
            let is_repeated = later.any(|it| equal_diagnostics(&first.diagnostic, &it.diagnostic));
            assert!(!is_repeated, "TS{}", first.diagnostic.code);
        }
        assert!(codes(&build.roles.diagnostics).contains(&2318));
        assert!(!codes(&build.program.diagnostics).contains(&2318));
        let is_in_dependency = |it: &BuildDiagnostic| it.diagnostic.file == Some(dep);
        let with_roles = build
            .roles
            .diagnostics
            .iter()
            .filter(|it| is_in_dependency(it));
        let mut classes = with_roles.map(|it| it.diagnostic.class);
        assert!(classes.any(|class| class == DiagnosticClass::EarlyError));
        assert!(!build.program.diagnostics.iter().any(is_in_dependency));
    });
}

#[test]
fn javascript_goes_through_queue() {
    let files = [
        ("main.ts", "import \"./a.js\";\n"),
        ("a.js", "import \"./b.js\";\n"),
        ("b.js", "import \"./c.js\";\n"),
        ("c.js", "import \"./a.js\";\n"),
    ];
    with_program(&files, &["./main.ts"], 4, |program| {
        let build = check_only(program);
        assert_eq!(build.program.lowered.len(), 4);
        assert_eq!(build.program.rounds[0].files, 4);
        assert_eq!(build.codes(), [0; 0]);
    });
}

#[test]
fn locator_works_after_lowering() {
    let files = [("main.ts", "export {};\nconst value = 1;\n")];
    with_program(&files, &["./main.ts"], 1, |program| {
        let (files, main) = (program.files(), program.file("main.ts"));
        check_only(program);
        assert!(files.hir(main).stmts.is_empty());
        let located = Locator::new(files, main).locate(17, 22, global(1, &[""; 0]));
        assert_eq!(located.file, Some(main));
        assert_eq!((located.line, located.column), (2, 7));
        assert_eq!((located.end_line, located.end_column), (2, 12));
    });
}

const GENERATED_FILE_COUNT: usize = 36;

fn generated_name(index: usize) -> String {
    let extension = if index.is_multiple_of(4) { "js" } else { "ts" };
    format!("f{index}.{extension}")
}

fn generated_text(index: usize) -> String {
    let Some(before) = index.checked_sub(1) else {
        return "let twice;\nlet twice;\nexport const value0 = 0;\n".to_owned();
    };
    let import = format!(
        "import {{ value{before} }} from \"./{}\";\n",
        generated_name(before)
    );
    let rest = match index % 4 {
        0 => format!("let twice;\nlet twice;\nexport const value{index} = value{before};\n"),
        1 => format!("export const value{index}: number = {index};\nvalue{before};\n"),
        _ => format!("export const value{index}: string = value{before};\n"),
    };
    import + &rest
}

fn check_generated_program(threads: usize) -> BuildSummary<usize> {
    let generated: Vec<(String, String)> = (0..GENERATED_FILE_COUNT)
        .map(|index| (generated_name(index), generated_text(index)))
        .collect();
    let files = generated.iter().map(|(path, text)| (&path[..], &text[..]));
    let files: Vec<(&str, &str)> = files.collect();
    let entry_point = format!("./{}", generated_name(GENERATED_FILE_COUNT - 1));
    with_program(&files, &[&entry_point[..]], threads, |program| {
        let build = check(program, &|_, file| file.idx());
        assert_eq!(build.program.lowered.len(), GENERATED_FILE_COUNT);
        let second = program.file(&generated_name(2));
        assert_eq!(build.reported(second, 2322), [STOPS_BUILD]);
        assert!(
            !build
                .reported(program.file(&generated_name(4)), 2451)
                .is_empty()
        );
        build.into_summary()
    })
}

#[test]
fn diagnostics_do_not_depend_on_threads() {
    let on_one_thread = check_generated_program(1);
    for threads in [2, 8] {
        assert_eq!(
            check_generated_program(threads),
            on_one_thread,
            "{threads} threads"
        );
    }
}

fn count_export_collisions(files: &[(&str, &str)], threads: usize) -> Vec<usize> {
    with_program(files, &["./main.ts"], threads, |program| {
        let build = check_only(program);
        let count = |&(path, _): &(&str, &str)| build.reported(program.file(path), 2308).len();
        files.iter().map(count).collect()
    })
}

#[test]
fn module_reached_twice_exports_nothing_the_second_time() {
    let files = [
        ("main.ts", "import \"./top\";\n"),
        (
            "top.ts",
            "export * from \"./first\";\nexport * from \"./second\";\n",
        ),
        (
            "first.ts",
            "export * from \"./shared\";\nexport const a = 1;\n",
        ),
        (
            "second.ts",
            "export * from \"./inner\";\nexport * from \"./other\";\n",
        ),
        (
            "inner.ts",
            "export * from \"./shared\";\nexport const b = 1;\n",
        ),
        ("shared.ts", "export const x = 1;\n"),
        ("other.ts", "export const x = \"\";\n"),
    ];
    for threads in [1, 4] {
        assert_eq!(
            count_export_collisions(&files, threads),
            [0, 1, 0, 1, 0, 0, 0]
        );
    }
}

#[test]
fn row_of_export_stars_exports_every_name() {
    let mut row = vec![("m0.ts".to_owned(), "export const v0 = 0;\n".to_owned())];
    for index in 1..8 {
        let below = index - 1;
        let text = format!("export * from \"./m{below}\";\nexport const v{index} = {index};\n");
        row.push((format!("m{index}.ts"), text));
    }
    let main =
        "import * as all from \"./m7\";\nexport const sum: number = all.v0 + all.v7;\nall.v8;\n";
    let files = row.iter().map(|(path, text)| (&path[..], &text[..]));
    let files: Vec<(&str, &str)> = files.chain([("main.ts", main)]).collect();
    for threads in [1, 4] {
        with_program(&files, &["./main.ts"], threads, |program| {
            assert_eq!(check_only(program).codes(), [2339]);
        });
    }
}

#[test]
fn export_stars_in_a_cycle_export_every_name() {
    let files = [
        (
            "main.ts",
            "import * as a from \"./a\";\nimport * as b from \"./b\";\nimport * as above from \"./above\";\nexport const sum: number = a.a + a.b + b.a + b.b + above.a + above.b + above.c;\nabove.d;\n",
        ),
        ("above.ts", "export * from \"./a\";\nexport const c = 3;\n"),
        ("a.ts", "export * from \"./b\";\nexport const a = 1;\n"),
        ("b.ts", "export * from \"./a\";\nexport const b = 2;\n"),
    ];
    for threads in [1, 4] {
        with_program(&files, &["./main.ts"], threads, |program| {
            assert_eq!(check_only(program).codes(), [2339]);
        });
    }
}
