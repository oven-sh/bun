use super::support::{
    BringsBunTypes, BuildSummary, DEPENDENCY_MANIFEST, FAILING_DEPENDENCY, IMPORTS_DEPENDENCY,
    LacksBunTypes, PROJECT, TYPE_ERROR, check, check_only, codes, project_disk, with_defines,
    with_host, with_look_for_type_errors, with_program, with_runtime_project,
};
use crate::compile::BunTypes;
use crate::{
    BuildDiagnostic, CompileRequest, Locator, Progress, check_and_lower, decide_roles,
    equal_diagnostics, global, log_message,
};
use bun_sema::check::aot::{
    BuiltinTypeSymbols, DiagnosticClass, Effect, NamedValue, NamedValues, QueryInputs,
};
use bun_sema::hir::ExprId;
use bun_sema::program::{FileId, FileRole};
use bun_sema::util::SharedSort;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

const STOPS_BUILD: (DiagnosticClass, Effect) = (DiagnosticClass::Semantic, Effect::StopsBuild);

const NAMES_BUN_TYPES: (&str, &str) = (
    "tsconfig.json",
    r#"{ "compilerOptions": { "strict": true, "noLib": true, "types": ["bun"], "module": "preserve", "moduleResolution": "bundler" } }"#,
);

struct NoNamedValues;

impl NamedValues for NoNamedValues {
    fn find_named_value(&self, _: FileId, _: ExprId) -> Option<NamedValue> {
        None
    }
}

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
fn type_errors_are_looked_for_where_the_program_says_what_the_project_says() {
    let returns_undefined = "export function first(list: number[]): number {
  return list.length ? list[0] : undefined;
}
";
    let files = [
        ("main.ts", "import \"./lib/index\";\n"),
        ("lib/index.ts", returns_undefined),
        (
            "lib/tsconfig.json",
            r#"{ "extends": "../tsconfig.json", "compilerOptions": { "strictNullChecks": false } }"#,
        ),
    ];
    with_look_for_type_errors(&files, &["./main.ts"], |program| {
        assert_eq!(check_only(program).codes(), [0; 0]);
    });
    let same_program = (
        "lib/tsconfig.json",
        r#"{ "extends": "../tsconfig.json", "compilerOptions": { "noUnusedLocals": true } }"#,
    );
    let with_same_program = [files[0], files[1], same_program];
    for files in [&files[..2], &with_same_program[..]] {
        with_look_for_type_errors(files, &["./main.ts"], |program| {
            assert_eq!(check_only(program).codes(), [2322]);
        });
    }
    let early_error = ("lib/index.ts", "let x;\nlet x;\nexport {};\n");
    let with_early_error = [files[0], early_error, files[2]];
    with_look_for_type_errors(&with_early_error, &["./main.ts"], |program| {
        assert!(check_only(program).codes().contains(&2451));
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

const REFUSED_AFTER_FUNCTION_DIRECTIVE: [&str; 26] = [
    r#"function f(a, a) { "use strict"; }"#,
    r#"function f(public) { "use strict"; }"#,
    r#"function public() { "use strict"; }"#,
    r#"function f(eval) { "use strict"; }"#,
    r#"function eval() { "use strict"; }"#,
    r#"function f(a = 1) { "use strict"; }"#,
    r#"function f() { "use strict"; with (f) {} }"#,
    r#"function f() { "use strict"; delete f; }"#,
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

const ACCEPTED_WITH_FUNCTION_DIRECTIVE: [&str; 6] = [
    r#"function f() { "use strict"; 010; }"#,
    r#"function f() { "use strict"; "\010"; }"#,
    r#"function f() { "use strict"; if (1) function g() {} }"#,
    r#"function f() { "use strict"; l: function g() {} }"#,
    r#"function f() { var public; "use strict"; }"#,
    r#"function f() { var public; var eval; var arguments; }"#,
];

#[test]
fn function_directive_makes_strict_mode_code() {
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
        assert!(files.module(main).is_leaf != files.module(main).is_read_by_every_task);
        assert!(files.module(other).is_leaf);
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
fn progress_counts_each_file_once() {
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
        assert!(roles.checked.is_empty());
        assert_eq!(checked.lowered.len(), 2);
        let count = |counter: &AtomicUsize| counter.load(Ordering::Relaxed);
        assert_eq!(count(&progress.to_check), 2);
        assert_eq!(count(&progress.checked), count(&progress.to_check));
        assert_ne!(count(&progress.bytes_to_check), 0);
        assert_eq!(
            count(&progress.bytes_checked),
            count(&progress.bytes_to_check)
        );
    });
}

#[test]
fn nobody_looks_for_type_errors_in_a_runtime_project() {
    with_runtime_project(&[("a.ts", TYPE_ERROR)], &["a.ts"], |program| {
        let build = check_only(program);
        let file = program.file("a.ts");
        assert_eq!(build.codes(), [0; 0]);
        assert_eq!(build.roles.role(file), FileRole::Checked);
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
fn each_diagnostic_is_reported_once() {
    let files = [
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
        assert!(build.roles.diagnostics.is_empty());
        assert!(!all.is_empty());
        for reported in all {
            assert_eq!(reported.diagnostic.file, Some(dep));
            assert_eq!(reported.diagnostic.class, DiagnosticClass::EarlyError);
        }
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
        // SAFETY: no task runs, and nothing refers to the file.
        unsafe { files.free_tree(main) };
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

fn ask_for_member_accesses(files: &[(&str, &str)], threads: usize) -> Vec<Option<String>> {
    with_program(files, &["./main.ts"], threads, |program| {
        let all = program.files();
        let roles: Vec<FileRole> = (0..all.modules.len() as u32)
            .map(|file| all.role(FileId(file)))
            .collect();
        let inputs = QueryInputs {
            roles: &roles,
            checked_elsewhere: &[],
            builtin_types: &BuiltinTypeSymbols::compute(all, &[], Box::new(|| &[])),
            named_values: &NoNamedValues,
            max_inference_nodes: 0,
            limits: Default::default(),
        };
        let main = program.file("main.ts");
        let build = check(program, &|checker, file| {
            if file != main {
                return Vec::new();
            }
            checker.with_queries(file, &inputs, |queries| {
                let hir = queries.hir();
                let mut accesses: Vec<(u32, ExprId)> = (hir.exprs.iter().enumerate())
                    .map(|(index, it)| (it.pos, ExprId(index as u32)))
                    .filter(|&(_, expression)| hir.member_key(expression).is_some())
                    .collect();
                accesses.sort();
                let mut texts = Vec::new();
                for (_, access) in accesses {
                    let ty = queries.expression_type(access).ok();
                    texts.push(ty.map(|ty| String::from_utf8(queries.type_text(ty)).unwrap()));
                }
                texts
            })
        });
        assert_eq!(build.codes(), [2339]);
        let lowered = build.program.lowered.into_iter();
        lowered.flat_map(|(_, texts)| texts).collect()
    })
}

#[test]
fn row_of_export_stars_exports_every_name() {
    let mut row = vec![("m0.ts".to_owned(), "export const v0 = 0;\n".to_owned())];
    for index in 1..8 {
        let below = index - 1;
        let text = format!("export * from \"./m{below}\";\nexport const v{index} = {index};\n");
        row.push((format!("m{index}.ts"), text));
    }
    let main = "import * as all from \"./m7\";\nexport const sum = [all.v0, all.v7, all.v8];\n";
    let files = row.iter().map(|(path, text)| (&path[..], &text[..]));
    let files: Vec<(&str, &str)> = files.chain([("main.ts", main)]).collect();
    for threads in [1, 4] {
        let found = ask_for_member_accesses(&files, threads);
        let found: Vec<Option<&str>> = found.iter().map(Option::as_deref).collect();
        assert_eq!(found, [Some("0"), Some("7"), None], "{threads} threads");
    }
}

#[test]
fn export_stars_in_a_cycle_export_every_name() {
    let files = [
        (
            "main.ts",
            "import * as a from \"./a\";\nimport * as b from \"./b\";\nimport * as above from \"./above\";\nexport const sum = [a.a, a.b, b.a, b.b, above.a, above.b, above.c, above.d];\n",
        ),
        ("above.ts", "export * from \"./a\";\nexport const c = 3;\n"),
        ("a.ts", "export * from \"./b\";\nexport const a = 1;\n"),
        ("b.ts", "export * from \"./a\";\nexport const b = 2;\n"),
    ];
    for threads in [1, 4] {
        let found = ask_for_member_accesses(&files, threads);
        let found: Vec<Option<&str>> = found.iter().map(Option::as_deref).collect();
        let expected = ["1", "2", "1", "2", "1", "2", "3"].map(Some);
        assert_eq!(found[..7], expected, "{threads} threads");
        assert_eq!(found[7], None, "{threads} threads");
    }
}

#[test]
fn parameters_without_types_in_a_list_of_functions_close_no_cycle() {
    let files = [
        (
            LacksBunTypes::DECLARATIONS,
            "declare const provided: any;\n",
        ),
        ("main.ts", "provided([(a, b) => {}, (c, d) => {}]);\n"),
    ];
    let disk = project_disk(&files, 1);
    with_host(&LacksBunTypes(&disk), PROJECT, "./main.ts", |program| {
        let all = program.files();
        let roles: Vec<FileRole> = (0..all.modules.len() as u32)
            .map(|file| all.role(FileId(file)))
            .collect();
        let inputs = QueryInputs {
            roles: &roles,
            checked_elsewhere: &[],
            builtin_types: &BuiltinTypeSymbols::compute(all, &[], Box::new(|| &[])),
            named_values: &NoNamedValues,
            max_inference_nodes: 0,
            limits: Default::default(),
        };
        let build = check(program, &|checker, file| {
            let asked = checker.with_queries(file, &inputs, |queries| {
                let patterns: Vec<_> = queries.hir().params.iter().map(|it| it.pat).collect();
                let answers = patterns.into_iter().map(|it| queries.binding_type(it));
                answers.filter(Result::is_ok).count()
            });
            assert_eq!(asked, 4);
            checker.closed_cycle_count()
        });
        assert_eq!(build.codes(), [0; 0]);
        assert_eq!(build.program.lowered, [(program.file("main.ts"), 0)]);
    });
}

#[test]
fn untyped_package_stops_only_a_project_with_bun_types_installed() {
    for is_installed in [false, true] {
        let folder = match is_installed {
            true => "node_modules/@types/bun".to_owned(),
            false => format!("{}/bun", BringsBunTypes::TYPE_ROOT),
        };
        let manifest = format!("{folder}/package.json");
        let declarations = format!("{folder}/index.d.ts");
        let files = [
            (
                "main.ts",
                "import { x } from \"untyped\";\nexport const one: number = x;\n\
                 x((a, b) => {});\nx([c => {}]);\n",
            ),
            (
                "node_modules/untyped/package.json",
                "{ \"name\": \"untyped\", \"version\": \"1.0.0\", \"main\": \"index.js\" }",
            ),
            ("node_modules/untyped/index.js", "exports.x = () => 1;\n"),
            (
                &manifest[..],
                "{ \"name\": \"@types/bun\", \"version\": \"1.0.0\", \"types\": \"index.d.ts\" }",
            ),
            (&declarations[..], "declare const Bun: number;\n"),
            NAMES_BUN_TYPES,
        ];
        let disk = project_disk(&files, 1);
        with_host(&BringsBunTypes(&disk), PROJECT, "./main.ts", |program| {
            let is_brought = matches!(program.loaded.bun_types, BunTypes::Brought);
            assert_eq!(is_brought, !is_installed);
            let build = check_only(program);
            let codes: &[u32] = match is_installed {
                true => &[7016, 7006, 7006, 7006],
                false => &[],
            };
            assert_eq!(build.codes(), codes);
            assert!(
                build
                    .diagnostics()
                    .all(|it| it.effect == Effect::StopsBuild)
            );
        });
    }
}

#[test]
fn brought_declarations_hold_no_program_to_what_is_not_installed() {
    for is_installed in [false, true] {
        let folder = match is_installed {
            true => "node_modules/@types/bun".to_owned(),
            false => format!("{}/bun", BringsBunTypes::TYPE_ROOT),
        };
        let manifest = format!("{folder}/package.json");
        let declarations = format!("{folder}/index.d.ts");
        let files = [
            (
                "main.ts",
                "const odd: number = Bun.version;\n\
                 const kept = Bun.version;\nconst far: number = kept;\n\
                 Bun.take(1);\nconst take = Bun.take;\ntake(2);\n\
                 declare const held: Held;\nheld.b;\n\
                 export const made: Made = Bun.make();\ninterface Made { own: number }\n\
                 export const wrong: number = \"text\";\nBun.take(missing);\n",
            ),
            (
                &manifest[..],
                "{ \"name\": \"@types/bun\", \"version\": \"1.0.0\", \"types\": \"index.d.ts\" }",
            ),
            (
                &declarations[..],
                "declare const Bun: { version: string; take(text: string): void; make(): Held };\n\
                 interface Held { a: number }\n",
            ),
        ];
        for names_them in [false, true] {
            let with_names = [&files[..], &[NAMES_BUN_TYPES]].concat();
            let disk = project_disk(if names_them { &with_names } else { &files }, 1);
            with_host(&BringsBunTypes(&disk), PROJECT, "./main.ts", |program| {
                let is_held = matches!(program.loaded.bun_types, BunTypes::Installed);
                assert_eq!(is_held, is_installed && names_them);
                let codes: &[u32] = match is_held {
                    true => &[2322, 2322, 2345, 2345, 2339, 2741, 2322, 2304],
                    false => &[2322, 2304],
                };
                assert_eq!(check_only(program).codes(), codes);
            });
        }
    }
}

#[test]
fn a_name_of_the_brought_declarations_is_free_for_a_script_of_the_program() {
    let folder = format!("{}/bun", BringsBunTypes::TYPE_ROOT);
    let (manifest, declarations) = (
        format!("{folder}/package.json"),
        format!("{folder}/index.d.ts"),
    );
    let files = [
        (
            "main.ts",
            "type Listeners = { two: number };\ntype Twice = 1;\ntype Twice = 2;\n",
        ),
        (
            &manifest[..],
            "{ \"name\": \"@types/bun\", \"version\": \"1.0.0\", \"types\": \"index.d.ts\" }",
        ),
        (&declarations[..], "interface Listeners { one: number }\n"),
    ];
    let disk = project_disk(&files, 1);
    with_host(&BringsBunTypes(&disk), PROJECT, "./main.ts", |program| {
        assert_eq!(check_only(program).codes(), [2300, 2300]);
    });
}

#[test]
fn what_the_types_of_bun_refer_to_is_brought_with_them() {
    let manifest = |name: &str| {
        format!(r#"{{ "name": "{name}", "version": "1.0.0", "types": "index.d.ts" }}"#)
    };
    let (of_bun, of_node) = (manifest("@types/bun"), manifest("@types/node"));
    let files = [
        ("main.ts", "export const id: number = later();\n"),
        ("node_modules/@types/bun/package.json", &of_bun[..]),
        (
            "node_modules/@types/bun/index.d.ts",
            "/// <reference types=\"node\" />\n",
        ),
        ("node_modules/@types/node/package.json", &of_node[..]),
        (
            "node_modules/@types/node/index.d.ts",
            "declare function later(): { ref(): void };\n",
        ),
    ];
    let names_node = (
        "tsconfig.json",
        r#"{ "compilerOptions": { "strict": true, "noLib": true, "types": ["node"] } }"#,
    );
    for (names_them, codes) in [(false, &[][..]), (true, &[2322][..])] {
        let with_names = [&files[..], &[names_node]].concat();
        let disk = project_disk(if names_them { &with_names } else { &files }, 1);
        with_host(&BringsBunTypes(&disk), PROJECT, "./main.ts", |program| {
            assert_eq!(check_only(program).codes(), codes, "{names_them}");
        });
    }
}

#[test]
fn a_project_that_writes_no_check_is_told_of_early_errors_alone() {
    let no_check = (
        "tsconfig.json",
        r#"{ "compilerOptions": { "strict": true, "noLib": true, "types": [], "noCheck": true } }"#,
    );
    let wrong = ("main.ts", "export const weight: number = \"three\";\n");
    with_look_for_type_errors(&[wrong], &["./main.ts"], |program| {
        assert_eq!(check_only(program).codes(), [2322]);
    });
    with_look_for_type_errors(&[wrong, no_check], &["./main.ts"], |program| {
        assert_eq!(check_only(program).codes(), [0; 0]);
    });
    let declared_twice = ("main.ts", "let x;\nlet x;\nexport {};\n");
    with_look_for_type_errors(&[declared_twice, no_check], &["./main.ts"], |program| {
        assert!(check_only(program).codes().contains(&2451));
    });
}

#[test]
fn what_is_an_error_only_in_a_module_stops_nothing_in_a_script_of_the_project() {
    let reports_unused = (
        "tsconfig.json",
        r#"{ "compilerOptions": { "strict": true, "noLib": true, "types": [], "noUnusedLocals": true } }"#,
    );
    let umd = (
        "shapes.d.ts",
        "export declare function area(): number;\nexport as namespace Shapes;\n",
    );
    let global = (
        "kept.d.ts",
        "interface KeptConstructor { one: number }\ndeclare var Kept: KeptConstructor;\n",
    );
    let cases: [(&str, &[(&str, &str)], u32); 5] = [
        ("const kept = this.kept;\nkept;\n", &[], 2532),
        ("class Unused {}\n", &[reports_unused], 6196),
        (
            "declare module \"made-up\" {\n  const one: number;\n}\n",
            &[],
            2664,
        ),
        ("Shapes.area();\n", &[umd], 2686),
        ("var Kept: KeptConstructor;\nKept.one;\n", &[global], 2454),
    ];
    for (script, beside, code) in cases {
        let module = format!("{script}export {{}};\n");
        for (text, codes) in [(script, &[][..]), (&module[..], &[code][..])] {
            let files = [&[("main.ts", text)], beside].concat();
            with_look_for_type_errors(&files, &["./main.ts"], |program| {
                assert_eq!(check_only(program).codes(), codes, "{text}");
            });
        }
    }
    let inside = "function outer() {\n  const inner = 1;\n}\nouter();\n";
    with_look_for_type_errors(
        &[("main.ts", inside), reports_unused],
        &["./main.ts"],
        |program| {
            assert_eq!(check_only(program).codes(), [6133]);
        },
    );
}

#[test]
fn an_entry_point_that_the_project_excludes_is_told_of_early_errors_alone() {
    let options = r#""compilerOptions": { "strict": true, "noLib": true, "types": [] }"#;
    let excludes = format!(r#"{{ {options}, "exclude": ["job.worker.ts"] }}"#);
    let main = ("main.ts", "export const one: number = 1;\n");
    let worker = (
        "job.worker.ts",
        "import { part } from \"./part\";\nexport const wrong: number = part;\n",
    );
    let part = ("part.ts", "export const part: string = 1;\n");
    let entry_points = ["./main.ts", "./job.worker.ts"];
    with_look_for_type_errors(&[main, worker, part], &entry_points, |program| {
        assert_eq!(check_only(program).codes(), [2322, 2322]);
    });
    let excluded = [main, worker, part, ("tsconfig.json", &excludes[..])];
    with_look_for_type_errors(&excluded, &entry_points, |program| {
        assert_eq!(check_only(program).codes(), [0; 0]);
    });
    let imports_part = ("main.ts", "export { part } from \"./part\";\n");
    let shared = [imports_part, worker, part, ("tsconfig.json", &excludes[..])];
    with_look_for_type_errors(&shared, &entry_points, |program| {
        assert_eq!(check_only(program).codes(), [2322]);
    });
    let declared_twice = ("job.worker.ts", "let x;\nlet x;\nexport {};\n");
    let early = [main, declared_twice, ("tsconfig.json", &excludes[..])];
    with_look_for_type_errors(&early, &entry_points, |program| {
        assert!(check_only(program).codes().contains(&2451));
    });
}

#[test]
fn a_field_declared_again_below_a_class_is_reported_from_the_target_on_that_defines_fields() {
    let main = (
        "main.ts",
        "class Parcel { label: string | number = \"plain\"; }\n\
         export class Numbered extends Parcel { label!: number; }\n",
    );
    for (target, codes) in [("es2020", &[][..]), ("es2022", &[2612][..])] {
        let written = format!(
            r#"{{ "compilerOptions": {{ "strict": true, "noLib": true, "types": [], "target": "{target}" }} }}"#
        );
        let files = [main, ("tsconfig.json", &written[..])];
        with_look_for_type_errors(&files, &["./main.ts"], |program| {
            assert_eq!(check_only(program).codes(), codes, "{target}");
        });
    }
}

#[test]
fn a_thread_gives_memory_back_under_a_hundred_times_in_a_long_check() {
    let mut before = 30_000;
    let mut is_due = |files_left: &usize| {
        let is_due = crate::has_fallen_by_an_eighth(before, *files_left);
        if is_due {
            before = *files_left;
        }
        is_due
    };
    let due: Vec<usize> = (0..30_000).rev().filter(&mut is_due).collect();
    assert_eq!(due.len(), 74);
    assert_eq!(due[..4], [26_250, 22_969, 20_098, 17_586]);
    assert_eq!(due[due.len() - 4..], [3, 2, 1, 0]);
    assert!(!crate::has_fallen_by_an_eighth(0, 0));
}

pub(super) fn codes_beside_declarations(
    is_installed: bool,
    declared: &str,
    main: &str,
    other: &str,
) -> Vec<u32> {
    let folder = match is_installed {
        true => "node_modules/@types/bun".to_owned(),
        false => format!("{}/bun", BringsBunTypes::TYPE_ROOT),
    };
    let manifest = format!("{folder}/package.json");
    let declarations = format!("{folder}/index.d.ts");
    let files = [
        ("main.ts", main),
        ("other.ts", other),
        (
            &manifest[..],
            "{ \"name\": \"@types/bun\", \"version\": \"1.0.0\", \"types\": \"index.d.ts\" }",
        ),
        (&declarations[..], declared),
        NAMES_BUN_TYPES,
    ];
    let disk = project_disk(&files[..files.len() - usize::from(!is_installed)], 1);
    let mut codes = Vec::new();
    with_host(&BringsBunTypes(&disk), PROJECT, "./main.ts", |program| {
        codes = check_only(program).codes();
    });
    codes
}

#[test]
fn a_failed_comparison_that_names_a_brought_type_stops_nothing() {
    let declared = "interface Held { a: number }\ndeclare const kept: Held;\n";
    let main = "function later(): Held { return kept; }\n\
                const id: number = later();\n\
                function stop(id: number) {}\nstop(later());\n\
                export const pair: { inner: number } = { inner: later() };\n\
                export const lacks: { a: number; b: number } = later();\n\
                export const list: number[] = [later()];\n\
                export const wrong: number = \"text\";\nexport { id };\n";
    let installed = codes_beside_declarations(true, declared, main, "");
    assert_eq!(installed, [2322, 2345, 2322, 2741, 2322, 2322]);
    assert_eq!(codes_beside_declarations(false, declared, main, ""), [2322]);
}

#[test]
fn what_has_no_written_type_is_followed_to_the_brought_name_it_is_made_of() {
    let declared = "declare const Bun: { size(): number; parse(): unknown };\n";
    let other =
        "export const far = Bun.size();\nexport function farther() { return Bun.size(); }\n";
    let main = "import { far, farther } from \"./other\";\n\
                function open() { return Bun.size(); }\n\
                function twice() { return open(); }\n\
                class Crate {\n  weight = Bun.size();\n  heavier() { return Bun.size(); }\n  get most() { return Bun.size(); }\n}\n\
                export const a: string = open();\n\
                export const b: string = twice();\n\
                export const c: string = new Crate().weight;\n\
                export const d: string = new Crate().heavier();\n\
                export const e: string = new Crate().most;\n\
                export const f: string = far;\n\
                export const g: string = farther();\n\
                function parse() { return Bun.parse(); }\n\
                parse().weight;\n\
                const parcel = parse();\nparcel.weight;\n\
                function written(): number { return Bun.size(); }\n\
                export const h: string = written();\n\
                function calls(list: string[]) { Bun.size(); return list.length; }\n\
                export const i: string = calls([]);\n";
    let installed = codes_beside_declarations(true, declared, main, other);
    assert_eq!(
        installed,
        [
            2322, 2322, 2322, 2322, 2322, 2322, 2322, 2571, 18046, 2322, 2322
        ]
    );
    assert_eq!(
        codes_beside_declarations(false, declared, main, other),
        [2322, 2322]
    );
}

#[test]
fn how_a_class_below_a_brought_class_is_made_stops_nothing() {
    let declared = "interface Signal<T = unknown> { detail: T }\n\
                    declare var Signal: { prototype: Signal; new <T>(name: string, detail: T): Signal<T> };\n";
    let other = "export class Far extends Signal {}\n";
    let main = "import { Far } from \"./other\";\n\
                class Below extends Signal {}\n\
                export const made = [new Below(\"a\", 1), new Far(\"a\", 1)];\n\
                class Own extends Signal<number> { weight = 1; }\n\
                export const wrong: string = new Own(\"a\", 1).weight;\n\
                const crate = { weight: 3 };\nnew crate();\n";
    let installed = codes_beside_declarations(true, declared, main, other);
    assert_eq!(installed, [2508, 2351, 2351, 2322, 2351, 2508]);
    assert_eq!(
        codes_beside_declarations(false, declared, main, other),
        [2322, 2351]
    );
}

#[test]
fn a_name_without_a_written_type_that_nobody_follows_to_its_maker_stops_nothing() {
    let declared = "declare const Bun: { size(): number };\n";
    let main = "function show(text: string) {}\n\
                declare function each<T>(list: T[], run: (one: T) => void): void;\n\
                for (const size of [Bun.size()]) show(size);\n\
                each([Bun.size()], size => show(size));\n\
                let late;\nlate = Bun.size();\nshow(late);\n\
                function own(size: number) { show(size); }\nown(1);\n";
    let installed = codes_beside_declarations(true, declared, main, "");
    assert_eq!(installed, [2345, 2345, 2345, 2345]);
    assert_eq!(codes_beside_declarations(false, declared, main, ""), [2345]);
}

#[test]
fn an_error_that_names_nothing_is_asked_by_what_it_stands_at() {
    let declared = "interface Held { a: number }\ndeclare const Bun: { start(): Held };\n";
    let main = "let id = Bun.start();\n\
                declare function order<T>(list: T[], by: (a: T, b: T) => number): T[];\n\
                export const all = [id * 1, 2 % id, order([id, id], (a, b) => a - b)];\n\
                id++;\n\
                function typed(held: Held) { return held * 2; }\ntyped(id);\n\
                const label: string = \"ab\";\nexport const wrong = label * 2;\n";
    let installed = codes_beside_declarations(true, declared, main, "");
    assert_eq!(installed, [2362, 2363, 2362, 2363, 2356, 2362, 2362]);
    assert_eq!(codes_beside_declarations(false, declared, main, ""), [2362]);
}
