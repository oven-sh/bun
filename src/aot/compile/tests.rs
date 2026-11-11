use super::summary::collect_entry_point_paths;
use super::testing::{
    BUNDLED_LIBS, TestProject, decide_project_roles, default_settings, describe_messages,
    run_build, with_bound_build, with_loaded_build,
};
use super::*;
use crate::builtins::{RuntimeFunction, RuntimeModule, table};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{InternalError, log_diagnostic};
use crate::engine::MissingModuleRecord;
use crate::engine::testing::ResultRecords;
use crate::ir::generated::{FunctionFlags, ModuleKind};
use crate::ir::{
    FunctionId, Id, ModuleId, OpaqueKind, Program, Type, print_function, print_program,
};
use crate::link::LinkedFunctions;
use crate::load::runtime_modules::RuntimeModules;
use crate::load::source_provider::{
    DataFailure, DeferredLoad, Failed, LoadRequest, Loaded, ModuleName, Resolution, ResolveRequest,
    SourceFile, SourceProvider, WithoutServices,
};
use crate::load::{ProjectId, host_platform};
use crate::report::ModuleOrigin;
use crate::statistics::{LimitValues, Stage, StatisticId};
use bstr::{BStr, ByteSlice};
use bun_ast::{Kind, Loader, Log};
use bun_builtin_sources::Archive;
use bun_sema::atom::Interner;
use bun_sema::check::aot::DiagnosticClass;
use bun_sema::fold::FoldOptions;
use bun_sema::hir_from_data::{DataModule, DataValue};
use bun_sema::program::{FileId, FileRole};
use bun_sema::session::Arena;
use bun_sema_driver::{Category, Demotion, Diagnostic, ThreadCaches, check_whole_files};
use std::borrow::Cow;
use std::num::NonZeroU32;
use std::sync::atomic::{AtomicU32, Ordering};

type LinkOutcome = (Result<LinkedProgram, BuildFailed>, Log);

const GLOBALS: (&str, &str) = (
    "globals.d.ts",
    "declare var console: { log(...values: unknown[]): void };",
);
const BUILTIN_MODULE_TYPES: (&str, &str) = (
    "modules.d.ts",
    "declare module \"node:path\";\ndeclare module \"bun:jsc\";",
);
const SMALL_PROGRAM: [(&str, &str); 2] = [("a.ts", "console.log(1);"), GLOBALS];
const PROGRAM_WITH_STARTUP_CODE: [(&str, &str); 2] = [
    (
        "a.ts",
        "console.log(Symbol.for(\"nodejs.util.inspect.custom\"));",
    ),
    GLOBALS,
];
const DUPLICATE_LABEL: u32 = 1114;
const CONFIGURATION: &str = concat!(
    r#"{"compilerOptions":{"lib":["ESNext"],"target":"ESNext","module":"Preserve","#,
    r#""moduleDetection":"force","allowJs":true,"moduleResolution":"bundler","noEmit":true,"#,
    r#""strict":true,"skipLibCheck":true}}"#,
);
const NARROW_CONFIGURATION: &str = concat!(
    r#"{"compilerOptions":{"lib":["ES5"],"types":[],"target":"ESNext","module":"Preserve","#,
    r#""moduleDetection":"force","allowJs":true,"moduleResolution":"bundler","noEmit":true,"#,
    r#""strict":true,"skipLibCheck":true}}"#,
);

fn link_project(project: &TestProject, provider: &dyn SourceProvider) -> LinkOutcome {
    let mut log = Log::init();
    let result = link_program(&project.options(BUNDLED_LIBS), provider, &mut log);
    (result, log)
}

fn link_files(files: &[(&str, &str)]) -> LinkOutcome {
    let project = TestProject::new(files, &default_settings());
    link_project(&project, &WithoutServices)
}

fn expect_success<T>(result: Result<T, BuildFailed>, log: &Log) -> T {
    match result {
        Ok(value) => value,
        Err(failed) => panic!(
            "the build failed in stage \"{}\":\n{}",
            failed.stage.name(),
            describe_messages(log)
        ),
    }
}

fn expect_failure<T>(result: Result<T, BuildFailed>) -> BuildFailed {
    match result {
        Ok(_) => panic!("the build succeeded"),
        Err(failed) => failed,
    }
}

fn link_successfully(files: &[(&str, &str)]) -> LinkedProgram {
    let (result, log) = link_files(files);
    expect_success(result, &log)
}

fn has_message(log: &Log, kind: Kind, prefix: &str) -> bool {
    let mut messages = log.msgs.iter().filter(|message| message.kind == kind);
    messages.any(|message| message.data.text.starts_with(prefix.as_bytes()))
}

fn has_code(log: &Log, kind: Kind, number: u32) -> bool {
    has_message(log, kind, &format!("TS{number}: "))
}

fn print_linked_program(project: &TestProject) -> String {
    let (result, log) = link_project(project, &WithoutServices);
    let program = expect_success(result, &log).program;
    assert!(!program.functions.is_empty());
    let library_function_count = program.runtime_functions.len();
    assert!(
        library_function_count > 100,
        "the program holds only {library_function_count} functions of Bun's library"
    );
    print_program(&program)
}

fn find_modules(program: &Program, path: &[u8]) -> Vec<ModuleId> {
    let modules = (0..program.modules.len()).map(ModuleId::new);
    modules
        .filter(|module| program.strings.get(program.modules[module.index()].path) == path)
        .collect()
}

fn count_checked_functions(linked: &LinkedProgram, origin: ModuleOrigin) -> usize {
    let (program, texts) = (&linked.program, &linked.summary.texts);
    assert!(!program.functions.is_empty());
    let functions = program.functions.iter();
    functions
        .filter(|function| texts.origin(function.module) == origin)
        .filter(|function| function.flags.contains(FunctionFlags::IS_CHECKED))
        .count()
}

#[test]
fn links_small_program() {
    let summary = link_successfully(&SMALL_PROGRAM).summary;
    let expected = EntryPointPaths {
        public_path: b"/$bunfs/root/a.ts".to_vec(),
        source_path: b"/project/a.ts".to_vec(),
    };
    assert_eq!(summary.entry_points, [expected]);
    assert!(summary.statistics.get(Stage::Load.time()) > 0);
    assert_eq!(summary.statistics.get(Stage::ReadAndVerify.time()), 0);
}

#[test]
fn closure_that_names_class_declared_behind_return_links() {
    let source =
        "function make() {\n  return () => new Late();\n  class Late {}\n}\nconsole.log(make);";
    link_successfully(&[("a.ts", source), GLOBALS]);
}

#[test]
fn constructor_that_is_left_out_takes_the_class_token_as_a_class_token() {
    let source = "exports.Base = class {};\n\
        exports.make = function () {\n\
        class Unread extends exports.Base { constructor(a) { super(a); } #hidden() {} } };";
    let program = link_successfully(&[("a.cjs", source)]).program;
    let index = program.functions.iter().position(|function| {
        let name = function.name.map(|name| program.strings.get(name));
        name == Some(b"Unread".as_slice())
    });
    let index = index.expect("the class is defined");
    let constructor = &program.functions[index];
    let mut text = String::new();
    print_function(
        program.name_tables(),
        FunctionId::new(index),
        constructor,
        &mut text,
    );
    assert!(text.contains("OmittedFromExecutable"), "{text}");
    let captures = constructor.captures.iter();
    let types = captures.map(|capture| program.types.get(capture.ty));
    assert!(types.eq([Type::opaque(OpaqueKind::ClassToken)]), "{text}");
}

fn has_key_with_text(statement: &str, name: &[u8]) -> bool {
    let source = format!("function Base() {{}}\n{statement}\nglobalThis.kept = Base;\n");
    let program = link_successfully(&[("a.js", &source[..])]).program;
    let mut keys = program.property_keys.as_slice().iter();
    keys.any(|key| {
        key.text
            .is_some_and(|text| program.strings.get(text) == name)
    })
}

#[test]
fn name_written_at_a_definition_by_descriptor_is_a_key_of_the_program() {
    let definitions = [
        "Object.defineProperty(Base.prototype, 'madeUpScale', { get() { return 10; } });",
        "Reflect.defineProperty(Base.prototype, 'madeUpScale', { get() { return 10; } });",
    ];
    for definition in definitions {
        assert!(
            has_key_with_text(definition, b"madeUpScale"),
            "{definition}"
        );
    }
    assert!(!has_key_with_text(
        "console.log('madeUpScale');",
        b"madeUpScale"
    ));
}

#[test]
fn output_is_deterministic() {
    let files = [
        (
            "a.ts",
            "import { b } from \"./b\";\nimport \"node:path\";\nconsole.log(b + 1);",
        ),
        ("b.ts", "export const b: number = 1;"),
        GLOBALS,
        BUILTIN_MODULE_TYPES,
    ];
    let mut project = TestProject::new(&files, &default_settings());
    let first = print_linked_program(&project);
    assert_eq!(first, print_linked_program(&project));
    project.aot.thread_count = NonZeroU32::new(4);
    assert_eq!(first, print_linked_program(&project));
}

fn emit_bytes(files: &[(&str, &str)]) -> Vec<u8> {
    let project = TestProject::new(files, &default_settings());
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        let mut output = build.run_front_end()?;
        let functions = output.functions;
        let functions = functions.into_program_functions(&build.parallel_runner());
        assert!(!functions.is_empty());
        let words = functions.iter().flat_map(|it| &it.body.code);
        let mut bytes: Vec<u8> = words.flat_map(|word| word.to_le_bytes()).collect();
        output.functions = LinkedFunctions::of_program_functions(functions);
        let (emitted, _) = build.emit(output)?;
        bytes.extend_from_slice(emitted.as_slice());
        Ok(bytes)
    })
}

#[test]
fn file_that_nothing_imports_changes_no_byte() {
    let shapes = "export interface Circle { kind: \"circle\"; radius: number }
export interface Square { kind: \"square\"; side: number }
export interface Line { kind: \"line\"; from: Point; to: Point }
export interface Point { x: number; y: number }
export type Shape = Circle | Square | Line;
export class Sheet {
  shapes: Shape[] = [];
  names = new Map<string, Shape>();
  corners = new Set<Point>();
  find(test: (shape: Shape) => boolean): Shape | undefined { return this.shapes.find(test); }
}
";
    let entry = "import { Sheet, type Point, type Shape } from \"./shapes\";
const sheet = new Sheet();
const origin: Point = { x: 0, y: 0 };
const shapes: Shape[] = [{ kind: \"circle\", radius: 1 }, { kind: \"square\", side: 2 }, { kind: \"line\", from: origin, to: origin }];
for (const shape of shapes) { sheet.shapes.push(shape); sheet.names.set(shape.kind, shape); }
sheet.corners.add(origin);
console.log(sheet.find(shape => shape.kind === \"line\"), sheet.names.size, sheet.corners.size);
";
    let program = [("b.ts", entry), ("shapes.ts", shapes), GLOBALS];
    let alone = emit_bytes(&program);
    for stranger in ["a.ts", "c.ts", "z.ts"] {
        let files = [program[0], (stranger, entry), program[1], program[2]];
        assert!(emit_bytes(&files) == alone, "{stranger}");
    }
}

#[test]
fn missing_entry_point_fails_at_load() {
    let mut project = TestProject::new(&[("a.ts", "")], &default_settings());
    project.entry_points = vec![b"nope.ts".to_vec()];
    let (result, log) = link_project(&project, &WithoutServices);
    let failed = expect_failure(result);
    assert_eq!(failed.stage, Stage::Load);
    assert!(!failed.is_internal_error);
    assert!(failed.compilation.is_none());
    assert!(has_code(&log, Kind::Err, Code::EntryPointNotFound.number()));
}

#[test]
fn unresolved_import_fails_at_bind_modules() {
    let (result, log) = link_files(&[("a.ts", "import \"./nope\";")]);
    let failed = expect_failure(result);
    assert_eq!(failed.stage, Stage::BindModules);
    assert!(!failed.is_internal_error);
    assert!(failed.compilation.is_none());
    assert!(has_code(&log, Kind::Err, Code::ModuleNotFound.number()));
}

#[test]
fn early_error_fails_at_check_and_lower() {
    let (result, log) = link_files(&[("a.ts", "again: {\n  again: {}\n}\n")]);
    let failed = expect_failure(result);
    assert_eq!(failed.stage, Stage::Lower);
    assert!(!failed.is_internal_error);
    assert!(failed.compilation.is_none());
    assert!(has_code(&log, Kind::Err, DUPLICATE_LABEL));
    assert_eq!(failed.statistics.get(Stage::LinkAndEmit.time()), 0);
}

#[test]
fn only_an_executable_refuses_a_store_to_an_import() {
    let stores = "count = 1; count++; [count] = []; for (count of []);";
    let main = format!("import {{ count }} from \"./b.js\";\nconsole.log(() => {{ {stores} }});");
    let files = [("a.js", &main[..]), ("b.js", "export let count = 1;")];
    let mut project = TestProject::new(&files, &default_settings());
    let (result, log) = link_project(&project, &WithoutServices);
    expect_success(result, &log);
    assert_eq!(log.errors, 0);
    project.builds_executable = true;
    let (result, log) = link_project(&project, &WithoutServices);
    assert_eq!(expect_failure(result).stage, Stage::Lower);
    assert_eq!(log.errors, 4);
    assert!(has_code(&log, Kind::Err, 2632));
}

#[test]
fn a_file_that_only_a_computed_name_finds_is_judged_as_the_loader_judges_it() {
    let stores = "count = 1; all = 2; all.count = 3; delete all.count;";
    let imports = "import * as all from \"./b.js\";\nimport { count } from \"./b.js\";";
    let late = format!("{imports}\nconsole.log(() => {{ {stores} }});");
    let main = "const name = process.argv.length > 9 ? \"never\" : \"late\";\nimport(\"./\" + name + \".js\");";
    let counter = "export let count = 1;";
    let files = [("a.js", main), ("late.js", &late[..]), ("b.js", counter)];
    let mut project = TestProject::new(&files, &default_settings());
    project.builds_executable = true;
    let (result, log) = link_project(&project, &WithoutServices);
    let program = print_program(&expect_success(result, &log).program);
    assert!(program.contains("late.js"));
    assert!(!program.contains("Cannot assign to") && !program.contains("cannot be a read-only"));
}

#[test]
fn nothing_names_what_a_placeholder_declares() {
    let barrel = "export * from \"./first\";\nexport * from \"./second\";\nexport function describe() {}\nexport class Unread {}";
    let first = "import { Second } from \"./index\";\nconsole.log(1);\nexport class First {\n  static last() {\n    return new Second();\n  }\n}";
    let second =
        "import { First } from \"./index\";\nconsole.log(2);\nexport class Second extends First {}";
    let files = [
        (
            "main.ts",
            "import { Second } from \"./three\";\nconsole.log(new Second());",
        ),
        ("three/index.ts", barrel),
        ("three/first.ts", first),
        ("three/second.ts", second),
        (
            "package.json",
            "{ \"name\": \"p\", \"sideEffects\": false }",
        ),
    ];
    let project = TestProject::new(&files, &default_settings());
    let (result, log) = link_project(&project, &WithoutServices);
    let program = print_program(&expect_success(result, &log).program);
    assert!(program.contains("three/index.ts") && !program.contains("describe"));
}

#[test]
fn an_executable_has_a_file_of_data_as_the_type_that_the_scan_of_the_bundler_comes_to_first() {
    let call = "console.log(await import(\"./conf.txt\", { with: { type: \"text\" } }));";
    let statement = "import conf from \"./conf.txt\" with { type: \"jsonc\" };\nconsole.log(conf);";
    let forms_of = |main: &str, below: &str, builds_executable: bool| {
        let main = format!("await import(\"./below.js\");\n{main}");
        let conf = "{ \"port\": 21 }\n";
        let files = [("a.js", &main[..]), ("below.js", below), ("conf.txt", conf)];
        let mut project = TestProject::new(&files, &default_settings());
        project.builds_executable = builds_executable;
        let (result, log) = link_project(&project, &WithoutServices);
        let text = print_program(&expect_success(result, &log).program);
        ["conf.txt?jsonc", "conf.txt?text"].map(|form| text.contains(form))
    };
    assert_eq!(forms_of(call, statement, false), [true, true]);
    assert_eq!(forms_of(statement, call, false), [true, true]);
    assert_eq!(forms_of(call, statement, true), [false, false]);
    assert_eq!(forms_of(statement, call, true), [true, false]);
    let files = [
        ("a.js", "import \"./caller.js\";\nimport \"./holder.js\";"),
        ("caller.js", call),
        ("holder.js", statement),
        ("conf.txt", "{ \"port\": 21 }\n"),
    ];
    let mut project = TestProject::new(&files, &default_settings());
    project.builds_executable = true;
    let (result, log) = link_project(&project, &WithoutServices);
    let text = print_program(&expect_success(result, &log).program);
    assert!(text.contains("conf.txt?jsonc") && !text.contains("conf.txt?text"));
}

#[test]
fn a_store_to_a_name_of_the_runner_costs_no_test_file() {
    let is_lost = |name: &str, text: &str| {
        let mut project = TestProject::new(&[(name, text)], &default_settings());
        project.runs_tests = true;
        let (result, log) = link_project(&project, &WithoutServices);
        let program = expect_success(result, &log).program;
        print_program(&program).contains("Cannot assign to")
    };
    let stores = "test('a', () => {});\nfunction never() { expect = 1; jest++; [vi] = []; }\n";
    for name in ["a.test.cjs", "a.test.js", "a.test.ts"] {
        assert!(!is_lost(name, stores), "{name}");
    }
    let own = "const own = 1;\nfunction never() { own = 2; }\ntest('a', () => {});\n";
    assert!(is_lost("a.test.cjs", own));
}

#[test]
fn type_error_stops_the_build_of_typescript_alone() {
    let typed = "const x: number = \"a\";\nconsole.log(x);";
    let (result, log) = link_files(&[("a.ts", typed)]);
    assert_eq!(expect_failure(result).stage, Stage::Lower);
    assert_eq!(log.errors, 1);
    let annotated = "/** @type {number} */\nconst x = \"a\";\nconsole.log(x);";
    let (result, log) = link_files(&[("a.js", annotated)]);
    expect_success(result, &log);
    assert_eq!(log.errors, 0);
}

#[test]
fn reports_all_stage_errors() {
    let text = "again: {\n  again: {}\n}\nmore: {\n  more: {}\n}\n";
    let (result, log) = link_files(&[("a.ts", text)]);
    assert_eq!(expect_failure(result).stage, Stage::Lower);
    assert_eq!(log.errors, 2);
}

#[test]
fn successful_build_logs_warnings() {
    let (result, log) = link_files(&[("a.js", "try {\n  require(\"./nope\");\n} catch {}")]);
    expect_success(result, &log);
    assert_eq!(log.errors, 0);
    assert!(has_code(&log, Kind::Warn, Code::ModuleNotFound.number()));
}

#[test]
fn failed_require_call_warns_and_ships() {
    let text = "function load() {\n  return require(\"./nope\");\n}\nconsole.log(load);";
    let (result, log) = link_files(&[("a.js", text)]);
    let program = expect_success(result, &log).program;
    assert!(has_code(&log, Kind::Warn, Code::ModuleNotFound.number()));
    let importer = program.entries[0].module;
    let failures = program.module_failures.iter();
    let specifiers: Vec<&BStr> = failures
        .filter(|failure| failure.importer == importer)
        .map(|failure| BStr::new(program.strings.get(failure.specifier)))
        .collect();
    assert_eq!(specifiers, ["./nope"]);
}

#[test]
fn failed_import_statement_ships_nothing() {
    let files = [
        ("a.js", "import \"./b.js\";"),
        ("b.js", "import \"./nope\";\nimport(\"./nowhere\");"),
    ];
    let (result, log) = link_files(&files);
    assert_eq!(expect_failure(result).stage, Stage::BindModules);
    assert_eq!(log.errors, 1);
    assert!(has_code(&log, Kind::Err, Code::ModuleNotFound.number()));
    assert!(has_code(&log, Kind::Warn, Code::ModuleNotFound.number()));
}

#[test]
fn front_end_failure_has_no_compilation() {
    let failures = [
        (Stage::BindModules, "import \"./nope\";"),
        (Stage::Lower, "again: {\n  again: {}\n}\n"),
    ];
    for (stage, text) in failures {
        let failed = expect_failure(link_files(&[("a.ts", text)]).0);
        assert_eq!(failed.stage, stage);
        assert!(failed.compilation.is_none());
    }
    let mut project = TestProject::new(&[("a.ts", "")], &default_settings());
    project.entry_points = vec![b"nope.ts".to_vec()];
    let failed = expect_failure(link_project(&project, &WithoutServices).0);
    assert_eq!(failed.stage, Stage::Load);
    assert!(failed.compilation.is_none());
}

#[test]
fn counts_each_file_once() {
    let files = [
        (
            "a.ts",
            "import data from \"./data.json\";\nimport \"./b.js\";\nimport \"node:path\";\nconsole.log(data);",
        ),
        ("b.js", "export {};"),
        ("data.json", "{}"),
        GLOBALS,
        BUILTIN_MODULE_TYPES,
    ];
    let statistics = link_successfully(&files).summary.statistics;
    let count = |id: StatisticId| statistics.get(id);
    assert_eq!(count(StatisticId::SourceFilesChecked), 1);
    assert_eq!(count(StatisticId::SourceFilesInferred), 1);
    assert_eq!(count(StatisticId::SourceFilesData), 1);
    assert!(count(StatisticId::SourceFilesTypesOnly) > 0);
    assert!(count(StatisticId::SourceFilesRuntime) > 0);

    let file_count = with_loaded_build(&files, &default_settings(), |_, loaded| {
        let projects = loaded.projects.iter();
        let file_counts = projects.map(|(_, project)| project.loaded.files().modules.len());
        file_counts.sum::<usize>()
    });
    let counted = [
        StatisticId::SourceFilesChecked,
        StatisticId::SourceFilesInferred,
        StatisticId::SourceFilesData,
        StatisticId::SourceFilesTypesOnly,
        StatisticId::SourceFilesRuntime,
    ];
    assert_eq!(counted.map(count).iter().sum::<u64>(), file_count as u64);
}

fn is_runtime_module_read(source: &str, path: &[u8]) -> Option<bool> {
    let files = [("main.ts", source)];
    with_loaded_build(&files, &default_settings(), |_, loaded| {
        let files = loaded.project(ProjectId::Runtime).loaded.files();
        let file = files.by_path.get(path)?;
        Some(!files.hir(file).stmts.is_empty())
    })
}

#[test]
fn module_of_bun_is_read_for_the_code_that_asks_for_it() {
    let path = b"/$bun/js/node/querystring.ts";
    let prints = "console.log('a line');";
    assert_eq!(is_runtime_module_read(prints, path), None);
    let parses = "import { parse } from 'node:querystring'; console.log(parse('a=b'));";
    assert_eq!(is_runtime_module_read(parses, path), Some(true));
}

fn compiles_runtime_module(source: &str, path: &[u8]) -> bool {
    let files = [("main.ts", source)];
    with_loaded_build(&files, &default_settings(), |_, loaded| {
        let files = loaded.project(ProjectId::Runtime).loaded.files();
        let file = files.by_path.get(path);
        file.is_some_and(|file| files.is_compiled(file))
    })
}

fn count_library_functions(text: &str) -> usize {
    let project = TestProject::new(&[("a.ts", text)], &default_settings());
    let mut log = Log::init();
    let result = link_program(&project.options(BUNDLED_LIBS), &WithoutServices, &mut log);
    expect_success(result, &log).program.runtime_functions.len()
}

#[test]
fn program_holds_the_code_of_bun_behind_what_it_names_and_what_its_text_may_reach() {
    assert_eq!(count_library_functions("console.log('a line');"), 0);
    let printing = count_library_functions("console.log(['a line']);");
    let sorting = count_library_functions("console.log([3, 1, 2].sort().join());");
    let sorting_by_a_pattern = count_library_functions(
        "const { sort } = [3, 1, 2]; console.log(Reflect.apply(sort, [3, 1, 2], []));",
    );
    let printing_with_a_method = count_library_functions(
        "console.log({ [Symbol.for('nodejs.util.inspect.custom')]() { return 'a line'; } });",
    );
    assert!(printing > 0 && printing < 30, "{printing}");
    assert!(sorting > printing && sorting < 400, "{sorting}");
    assert!(
        sorting_by_a_pattern >= sorting && sorting_by_a_pattern < 400,
        "{sorting_by_a_pattern}"
    );
    assert!(printing_with_a_method > 100, "{printing_with_a_method}");
    let writing = count_library_functions("process.stdout.write('a line');");
    assert!(writing > printing_with_a_method, "{writing}");
}

#[test]
fn module_of_bun_is_loaded_for_the_entry_that_asks_for_it() {
    let path = b"/$bun/js/bun/sql.ts";
    assert!(!compiles_runtime_module("console.log('a line');", path));
    assert!(compiles_runtime_module("console.log(Bun.sql);", path));
}

#[test]
fn each_public_module_of_bun_is_loaded_for_a_program_that_imports_it_alone() {
    let has_source = |module: &RuntimeModule| {
        let flags = table::module_data(*module).flags;
        flags.contains(table::ModuleFlags::IS_PUBLIC | table::ModuleFlags::HAS_SOURCE)
    };
    let modules: Vec<RuntimeModule> = RuntimeModule::ALL.into_iter().filter(has_source).collect();
    assert!(modules.len() > 40);
    let threads = std::thread::available_parallelism().map_or(1, usize::from);
    bun_sema_standalone::for_each_parallel(threads, modules.len(), |index| {
        let specifier = BStr::new(table::specifier_of(modules[index]));
        let text = format!("import * as it from \"{specifier}\"; console.log(typeof it);");
        with_loaded_build(&[("main.ts", &text)], &default_settings(), |_, _| {});
    });
}

#[test]
fn files_of_bun_are_ordered_as_their_directories_list_them() {
    let files = [("main.ts", "import 'node:http'; console.log('a line');")];
    let paths: Vec<Vec<u8>> = with_loaded_build(&files, &default_settings(), |_, loaded| {
        let files = loaded.project(ProjectId::Runtime).loaded.files();
        let paths = files
            .order
            .iter()
            .map(|&file| files.module(file).file_name());
        let own = paths.filter(|path| path.starts_with(b"/$bun/js/"));
        own.map(<[u8]>::to_vec).collect()
    });
    let key_of = |path: &[u8]| -> Vec<(bool, Vec<u8>)> {
        let names: Vec<&[u8]> = bun_core::strings::split(path, b"/").collect();
        let last = names.len() - 1;
        let keyed = names.iter().enumerate();
        keyed
            .map(|(at, name)| (at != last, name.to_vec()))
            .collect()
    };
    assert!(paths.len() > 100);
    assert!(paths.is_sorted_by_key(|path| key_of(path)));
}

fn link_registered_functions(omits_builtin_modules: bool) -> Vec<RuntimeFunction> {
    let project = TestProject::new(&PROGRAM_WITH_STARTUP_CODE, &default_settings());
    let mut options = project.options(BUNDLED_LIBS);
    options.load.omits_builtin_modules = omits_builtin_modules;
    let mut log = Log::init();
    let result = link_program(&options, &WithoutServices, &mut log);
    let entries = expect_success(result, &log).program.runtime_functions;
    entries.iter().map(|entry| entry.id).collect()
}

#[test]
fn only_functions_of_loaded_files_are_registered() {
    let exists_on_host = |function: RuntimeFunction| {
        let data = table::runtime_function(function).expect("the table lists the function");
        data.platforms.contains(host_platform())
    };
    assert!(table::STARTUP_FUNCTIONS.iter().copied().any(exists_on_host));

    let registered = link_registered_functions(false);
    let registered_without_modules = link_registered_functions(true);
    for &function in table::STARTUP_FUNCTIONS {
        let is_registered = registered.contains(&function);
        assert_eq!(is_registered, exists_on_host(function), "{function:?}");
        assert!(
            !registered_without_modules.contains(&function),
            "{function:?}"
        );
    }
}

#[test]
fn finish_marks_internal_errors() {
    let project = TestProject::new(&[("a.ts", "")], &default_settings());
    let options = project.options(BUNDLED_LIBS);
    let caches = ThreadCaches::default();
    let mut build = Build::new(&options, &WithoutServices, &caches, LimitValues::for_host());
    build.diagnostics.add_internal_error(InternalError {
        stage: Stage::LinkAndEmit,
        message: b"broken".to_vec(),
    });
    let mut log = Log::init();
    let failed = expect_failure(build.finish::<()>(Err(Stage::LinkAndEmit), &mut log));
    assert_eq!(failed.stage, Stage::LinkAndEmit);
    assert!(failed.is_internal_error);
    let message = "internal compiler error (LinkAndEmit): broken";
    assert!(has_message(&log, Kind::Err, message));
}

struct CollidingPluginModule;

impl SourceProvider for CollidingPluginModule {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        WithoutServices.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, _log: &mut Log) -> Result<Resolution, Failed> {
        Ok(match request.specifier {
            b"plugin-fs" => Resolution::Module {
                namespace: b"node".to_vec(),
                path: b"fs".to_vec(),
            },
            _ => Resolution::NotHandled,
        })
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        if request.module.namespace == b"file" {
            return WithoutServices.load(request, log);
        }
        Ok(Loaded::Source {
            contents: Cow::Borrowed(b"export {};"),
            loader: Loader::Js,
            is_from_plugin: true,
        })
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        WithoutServices.finish_deferred_loads(log)
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, DataFailure> {
        WithoutServices.parse_data(file, arena, atoms, log)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

#[test]
fn colliding_module_paths_fail_internally() {
    let files = [("a.js", "import \"plugin-fs\";\nimport \"node:fs\";")];
    let project = TestProject::new(&files, &default_settings());
    let (result, log) = link_project(&project, &CollidingPluginModule);
    let failed = expect_failure(result);
    assert_eq!(failed.stage, Stage::Load);
    assert!(failed.is_internal_error);
    let message = "internal compiler error (Load): two modules have the path node:fs: ";
    assert!(has_message(&log, Kind::Err, message));
}

#[derive(Default)]
struct CountsNameChecks {
    checks: AtomicU32,
}

impl SourceProvider for CountsNameChecks {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        WithoutServices.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        WithoutServices.resolve(request, log)
    }

    fn has_resolve_plugins(&self) -> bool {
        WithoutServices.has_resolve_plugins()
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        WithoutServices.load(request, log)
    }

    fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        WithoutServices.has_load_plugin(module)
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        WithoutServices.finish_deferred_loads(log)
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, DataFailure> {
        WithoutServices.parse_data(file, arena, atoms, log)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        self.checks.fetch_add(1, Ordering::Relaxed);
        WithoutServices.check_embedded_files(log)
    }
}

#[test]
fn every_build_checks_names_of_embedded_files() {
    let project = TestProject::new(&[("a.ts", "")], &default_settings());
    let provider = CountsNameChecks::default();
    let (result, log) = link_project(&project, &provider);
    expect_success(result, &log);
    assert_ne!(provider.checks.load(Ordering::Relaxed), 0);
}

struct CannotTakeOneValue;

impl SourceProvider for CannotTakeOneValue {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        WithoutServices.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        WithoutServices.resolve(request, log)
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        WithoutServices.load(request, log)
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        WithoutServices.finish_deferred_loads(log)
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, DataFailure> {
        if !file.path.ends_with(b"/list.mjs") {
            return WithoutServices.parse_data(file, arena, atoms, log);
        }
        log_diagnostic(log, Code::UnsupportedOption, &[b"the value of list.mjs"]);
        Err(DataFailure::Build)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

#[test]
fn an_error_of_the_build_is_heard_of_a_file_that_is_named_as_code() {
    let files = [
        (
            "a.mjs",
            r#"import("./data/" + process.argv[2], { with: { type: "json" } });"#,
        ),
        ("data/list.mjs", "[1, 2]"),
        ("data/other.mjs", "export {};"),
    ];
    let project = TestProject::new(&files, &default_settings());
    let (result, log) = link_project(&project, &CannotTakeOneValue);
    assert!(!expect_failure(result).is_internal_error);
    let number = Code::UnsupportedOption.number();
    assert!(
        has_code(&log, Kind::Err, number),
        "{}",
        describe_messages(&log)
    );
    let (result, log) = link_project(&project, &WithoutServices);
    expect_success(result, &log);
    assert!(
        !has_message(&log, Kind::Warn, ""),
        "{}",
        describe_messages(&log)
    );
}

struct AssetPlugin {
    answers_with: Loader,
}

impl SourceProvider for AssetPlugin {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        WithoutServices.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        WithoutServices.resolve(request, log)
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        if !request.module.path.ends_with(b"/logo.png") {
            return WithoutServices.load(request, log);
        }
        Ok(Loaded::Source {
            contents: Cow::Borrowed(b"export default 1;"),
            loader: self.answers_with,
            is_from_plugin: true,
        })
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        WithoutServices.finish_deferred_loads(log)
    }

    fn asset_paths_ignore_contents(&self) -> bool {
        true
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, DataFailure> {
        if file.loader != Loader::File {
            return WithoutServices.parse_data(file, arena, atoms, log);
        }
        Ok(DataModule::Value {
            default: arena.alloc(DataValue::String(atoms.intern(file.path))),
            exports_keys: false,
        })
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

#[test]
fn plugin_that_answers_code_for_a_file_asset_fails_the_build() {
    let files = [
        (
            "a.js",
            "import logo from \"./logo.png\";\nconsole.log(logo);\n",
        ),
        ("logo.png", "pixels"),
    ];
    let project = TestProject::new(&files, &default_settings());
    let answers_with = Loader::File;
    let (result, log) = link_project(&project, &AssetPlugin { answers_with });
    expect_success(result, &log);

    let answers_with = Loader::Js;
    let (result, log) = link_project(&project, &AssetPlugin { answers_with });
    assert!(!expect_failure(result).is_internal_error);
    let prefix = format!("TS{}: ", Code::UnsupportedOption.number());
    let mut errors = log.msgs.iter().filter(|message| message.kind == Kind::Err);
    let names_the_asset = errors.any(|message| {
        let text = &message.data.text;
        text.starts_with(prefix.as_bytes()) && text.contains_str("logo.png")
    });
    assert!(names_the_asset, "{}", describe_messages(&log));
}

fn print_runtime_functions(linked: &LinkedProgram) -> String {
    let (program, texts) = (&linked.program, &linked.summary.texts);
    assert!(!program.functions.is_empty());
    let mut text = String::new();
    for (index, function) in program.functions.iter().enumerate() {
        if texts.origin(function.module) == ModuleOrigin::Runtime {
            print_function(
                program.name_tables(),
                FunctionId::new(index),
                function,
                &mut text,
            );
        }
    }
    text
}

#[test]
fn runtime_project_ignores_application_tsconfig() {
    let print_with = |configuration: &str| {
        let files = [
            ("a.ts", "import \"node:path\";\nexport const x: number = 1;"),
            ("tsconfig.json", configuration),
            BUILTIN_MODULE_TYPES,
        ];
        print_runtime_functions(&link_successfully(&files))
    };
    let text = print_with(CONFIGURATION);
    assert!(!text.is_empty());
    assert_eq!(print_with(NARROW_CONFIGURATION), text);
}

#[test]
fn projects_share_atoms() {
    const NAME: &[u8] = b"nameOnlyTheApplicationWrites";
    let files = [("a.ts", "export const nameOnlyTheApplicationWrites = 1;")];
    with_loaded_build(&files, &default_settings(), |_, loaded| {
        let atoms_of = |project: ProjectId| &loaded.project(project).loaded.files().atoms;
        let atom = atoms_of(ProjectId::Application).lookup(NAME);
        assert!(atom.is_some());
        assert_eq!(atoms_of(ProjectId::Runtime).lookup(NAME), atom);
        assert_eq!(loaded.atoms.lookup(NAME), atom);
        assert_eq!(
            atoms_of(ProjectId::Runtime).lookup(b"nameNobodyWrites"),
            None
        );
    });
}

#[test]
fn erased_types_lower_every_file_as_inferred() {
    let link = |erases_types: bool| {
        let mut project = TestProject::new(&SMALL_PROGRAM, &default_settings());
        project.aot.erases_types = erases_types;
        let (result, log) = link_project(&project, &WithoutServices);
        let linked = expect_success(result, &log);
        let checked_functions = count_checked_functions(&linked, ModuleOrigin::Program);
        let checked_files = linked
            .summary
            .statistics
            .get(StatisticId::SourceFilesChecked);
        (checked_functions, checked_files)
    };
    assert_eq!(link(true), (0, 1));
    let (checked_functions, checked_files) = link(false);
    assert!(checked_functions > 0);
    assert_eq!(checked_files, 1);
}

#[test]
fn runtime_files_are_checked_and_lowered_with_their_types() {
    let files = [
        ("a.ts", "import \"node:path\";\nexport const x: number = 1;"),
        BUILTIN_MODULE_TYPES,
    ];
    let project = TestProject::new(&files, &default_settings());
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        with_bound_build(build, |build, loaded, bound| {
            let projects = loaded.projects.as_ref();
            let decisions = projects.map(|_, project| decide_project_roles(project));
            for (project, roles) in decisions.iter() {
                let file_count = loaded.project(project).loaded.files().modules.len();
                build.with_lowering_inputs(loaded, bound, project, roles, |inputs| {
                    assert_eq!(inputs.sources.project(), project);
                    assert_eq!(inputs.roles.len(), file_count);
                    assert_eq!(inputs.roles, roles.roles);
                });
            }
            let entry_point = loaded.projects.application.sources.entry_points()[0].file;
            assert_eq!(decisions.application.role(entry_point), FileRole::Checked);

            let runtime_sources = &loaded.projects.runtime.sources;
            let file = runtime_sources.runtime_module_file(RuntimeModule::NodePath);
            let file = file.expect("the runtime project has the source of node:path");
            assert_eq!(decisions.runtime.role(file), FileRole::Checked);
            let mut demoted = decisions.runtime.demoted.iter();
            assert!(demoted.all(|demotion| demotion.file != file));
        })
    });

    let linked = link_successfully(&files);
    assert!(count_checked_functions(&linked, ModuleOrigin::Program) > 0);
    assert!(count_checked_functions(&linked, ModuleOrigin::Runtime) > 0);
}

fn count_lowered_files_of_bun(source: &str) -> usize {
    count_lowered_files_of_bun_in(&TestProject::new(&[("a.js", source)], &default_settings()))
}

fn count_lowered_files_of_bun_in(project: &TestProject) -> usize {
    run_build(project, BUNDLED_LIBS, &WithoutServices, |build| {
        with_bound_build(build, |build, loaded, bound| {
            let units = build.check_and_lower(loaded, bound);
            let application_files = loaded.projects.application.loaded.files().compiled_files();
            units.len() - application_files.len()
        })
    })
}

#[test]
fn small_program_lowers_little_of_bun_beside_what_unseen_code_finds() {
    let of_what_operands_are_asked = count_lowered_files_of_bun("export {};\n");
    assert!(
        of_what_operands_are_asked < 12,
        "{of_what_operands_are_asked}"
    );
    let mut beside_unseen_code = TestProject::new(&[("a.js", "export {};\n")], &default_settings());
    beside_unseen_code.keeps_library_code_without_names = true;
    let of_empty_program = count_lowered_files_of_bun_in(&beside_unseen_code);
    let listeners = "process.on('exit', () => {});\nprocess.once('SIGINT', () => {});\n";
    let of_listeners = count_lowered_files_of_bun(listeners);
    let counts = format!(
        "files of Bun that are lowered: {of_empty_program} for nothing, {of_listeners} for two listeners"
    );
    assert!(of_empty_program < 70, "{counts}");
    assert!(of_listeners < of_empty_program + 20, "{counts}");
}

#[test]
#[should_panic(expected = "for a computed name")]
fn computed_name_lowers_little_more_which_is_not_met_yet_at_138_files_for_a_bound_of_78() {
    let mut beside_unseen_code = TestProject::new(&[("a.js", "export {};\n")], &default_settings());
    beside_unseen_code.keeps_library_code_without_names = true;
    let of_empty_program = count_lowered_files_of_bun_in(&beside_unseen_code);
    let computed = "export const loaded = require(process.argv[2]);\n";
    let of_computed_name = count_lowered_files_of_bun(computed);
    assert!(
        of_computed_name < of_empty_program + 20,
        "files of Bun that are lowered: {of_empty_program} for nothing, {of_computed_name} for a computed name"
    );
}

fn link_with_unused_package(importer: &str, manifest: &str, package: &str) {
    link_successfully(&[
        ("main.js", "import \"./effects.js\";\n"),
        ("effects.js", importer),
        ("node_modules/tools/package.json", manifest),
        ("node_modules/tools/index.js", package),
        GLOBALS,
    ]);
}

#[test]
fn names_of_commonjs_package_that_is_left_out_are_not_looked_for() {
    let manifest =
        r#"{ "name": "tools", "version": "1.0.0", "main": "index.js", "sideEffects": false }"#;
    let importer = "import { first, second } from \"tools\";\nconsole.log(1);\nexport function unused() { return first + second; }\n";
    for exports in [
        "Object.assign(exports, { first: 1, second: 2 });\n",
        "for (const name of [\"first\", \"second\"]) exports[name] = 1;\n",
        "module.exports = JSON.parse(\"{}\");\n",
    ] {
        link_with_unused_package(importer, manifest, exports);
    }
}

#[test]
fn commonjs_file_that_is_left_out_of_a_cycle_is_asked_for_nothing() {
    let linked = link_successfully(&[
        ("main.mjs", "import b from \"./b.mjs\";\nconsole.log(b);\n"),
        ("a.cjs", "module.exports = require(\"./b.mjs\");\n"),
        ("b.mjs", "import a from \"./a.cjs\";\nexport default 7;\n"),
        (
            "package.json",
            r#"{ "name": "program", "sideEffects": false }"#,
        ),
        GLOBALS,
    ]);
    let program = &linked.program;
    let find = |name: &str| {
        let mut modules = program.modules.iter();
        modules.find(|module| program.strings.get(module.path).ends_with_str(name))
    };
    assert!(find("a.cjs").is_none());
    let importer = find("b.mjs").expect("b.mjs has a record");
    assert!(importer.required_names.is_empty());
}

#[test]
fn package_that_is_left_out_takes_along_what_the_build_does_not_compile() {
    let importer = "import { first } from \"tools\";\nconsole.log(1);\nexport function unused() { return first; }\n";
    let commonjs =
        r#"{ "name": "tools", "version": "1.0.0", "main": "index.js", "sideEffects": false }"#;
    let es = r#"{ "name": "tools", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }"#;
    for (manifest, package) in [
        (
            es,
            "import value from \"data:text/javascript,export default 1\";\nexport const first = value;\n",
        ),
        (
            es,
            "import value from \"https://example.com/a.js\";\nexport const first = value;\n",
        ),
        (commonjs, "exports.first = new Function(\"return 1\")();\n"),
        (
            commonjs,
            "exports.first = new Function(\"return new Function('return 1')()\")();\n",
        ),
    ] {
        link_with_unused_package(importer, manifest, package);
    }
}

#[test]
fn skipped_star_barrel_still_imports_listed_side_effects() {
    let manifest = r#"{ "name": "lib", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": ["./polyfill.js", "./listed.js"] }"#;
    let linked = link_successfully(&[
        ("main.js", "import { a } from \"lib\";\na();\n"),
        ("node_modules/lib/package.json", manifest),
        (
            "node_modules/lib/index.js",
            "console.log(0);\nimport \"./polyfill.js\";\nimport \"./pure.js\";\nexport * from \"./a.js\";\nexport { listed } from \"./listed.js\";\n",
        ),
        ("node_modules/lib/polyfill.js", "console.log(1);\n"),
        ("node_modules/lib/pure.js", "console.log(2);\n"),
        ("node_modules/lib/a.js", "export function a() {}\n"),
        (
            "node_modules/lib/listed.js",
            "console.log(3);\nexport const listed = 1;\n",
        ),
        GLOBALS,
    ]);
    let program = &linked.program;
    let name_of = |module: ModuleId| {
        let path = program.strings.get(program.modules[module.index()].path);
        BStr::new(path.rsplit_str("/").next().unwrap_or_default()).to_string()
    };
    let main = (0..program.modules.len()).find(|&index| name_of(ModuleId::new(index)) == "main.js");
    let requests = &program.modules[main.expect("the entry point has a record")].requests;
    let requested: Vec<String> = requests.iter().map(|it| name_of(it.target)).collect();
    assert_eq!(requested, ["polyfill.js", "a.js", "listed.js"]);
}

fn list_evaluated_files_of_package(main: &str, page: &str, index: &str) -> Vec<String> {
    let manifest = r#"{ "name": "lib", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }"#;
    let linked = link_successfully(&[
        ("main.js", main),
        ("page.js", page),
        ("node_modules/lib/package.json", manifest),
        ("node_modules/lib/index.js", index),
        (
            "node_modules/lib/a.js",
            "console.log(1);\nexport function a() {}\n",
        ),
        (
            "node_modules/lib/b.js",
            "console.log(2);\nexport function b() {}\n",
        ),
        GLOBALS,
    ]);
    let program = &linked.program;
    let with_body = program
        .modules
        .iter()
        .filter(|module| module.body.is_some());
    let paths = with_body.map(|module| program.strings.get(module.path));
    let in_package = paths.filter_map(|path| path.split_once_str("node_modules/lib/"));
    let mut files: Vec<String> = in_package
        .map(|(_, file)| BStr::new(file).to_string())
        .collect();
    files.sort();
    files
}

#[test]
fn file_that_a_call_loads_evaluates_what_it_imports_from() {
    let by_statement = "import { page } from \"./page.js\";\npage();\n";
    let by_import_call = "const { page } = await import(\"./page.js\");\npage();\n";
    let by_require = "const { page } = require(\"./page.js\");\npage();\n";
    let uses_a = "import { a } from \"lib\";\nexport function page() { a(); }\n";
    let uses_nothing = "import { a } from \"lib\";\nexport function page() {}\n";
    let stars = "console.log(0);\nexport * from \"./a.js\";\nexport * from \"./b.js\";\n";
    let evaluated = list_evaluated_files_of_package(by_statement, uses_a, stars);
    assert_eq!(evaluated, ["a.js"]);
    for by_call in [by_import_call, by_require] {
        let evaluated = list_evaluated_files_of_package(by_call, uses_a, stars);
        assert_eq!(evaluated, ["a.js", "b.js", "index.js"], "{by_call}");
        let evaluated = list_evaluated_files_of_package(by_call, uses_nothing, stars);
        assert_eq!(evaluated, [""; 0], "{by_call}");
    }
}

#[test]
fn file_that_exports_the_object_of_a_module_under_a_name_is_evaluated() {
    let main = "import { page } from \"./page.js\";\npage();\n";
    let page = "import { inner } from \"lib\";\nexport function page() { inner.b(); }\n";
    let index = "console.log(0);\nexport * as inner from \"./b.js\";\nexport * from \"./a.js\";\n";
    let evaluated = list_evaluated_files_of_package(main, page, index);
    assert_eq!(evaluated, ["b.js", "index.js"]);
}

#[test]
fn import_of_uncompiled_code_lets_code_load_at_run_time() {
    let can_load_code = |source: &str| {
        with_loaded_build(&[("a.js", source)], &default_settings(), |_, loaded| {
            loaded.can_load_code_at_run_time
        })
    };
    assert!(can_load_code("import \"https://example.com/a.js\";\n"));
    assert!(can_load_code(
        "export const a = import(\"data:text/javascript,1\");\n"
    ));
    assert!(!can_load_code("import \"node:fs\";\n"));
}

#[test]
fn every_module_of_bun_keeps_its_types() {
    let modules = RuntimeModules::new(Archive::embedded(), false);
    let imports: String = modules
        .public_specifiers()
        .map(|specifier| format!("import \"{}\";\n", BStr::new(specifier)))
        .collect();
    let project = TestProject::new(&[("a.js", imports.as_str())], &default_settings());
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        with_bound_build(build, |_, loaded, _| {
            let runtime = &loaded.projects.runtime;
            let decision = decide_project_roles(runtime);
            let files = runtime.loaded.files();
            let typed_files: Vec<FileId> = (files.compiled_files().iter().copied())
                .filter(|&file| decision.role(file) == FileRole::Checked)
                .collect();
            let (loaded, host, request) = (runtime.loaded, runtime.host, runtime.request);
            let report = check_whole_files(loaded, host, request, &typed_files);
            let mut first_errors: Vec<&Diagnostic> = (report.diagnostics.iter())
                .filter(|error| {
                    error.file.is_some()
                        && error.category == Category::Error
                        && error.class == DiagnosticClass::Semantic
                })
                .collect();
            first_errors.dedup_by_key(|error| error.file);
            let describe_error = |error: &&Diagnostic| {
                format!(
                    "{}:{}:{} TS{}: {}",
                    BStr::new(&error.path),
                    error.line,
                    error.column,
                    error.code,
                    BStr::new(&error.text),
                )
            };
            let describe =
                |demotion: &Demotion| format!("{:?}: {:?}", demotion.file, demotion.cause);
            let mut untyped: Vec<String> = decision.demoted.iter().map(describe).collect();
            untyped.extend(first_errors.iter().map(describe_error));
            untyped.sort();
            let module_count = runtime.loaded.files().compiled_files().len();
            assert!(module_count > 150, "{module_count} modules were loaded");
            assert!(
                untyped.is_empty(),
                "{} of {module_count} modules of Bun have a type error. The first error of each:\n{}",
                untyped.len(),
                untyped.join("\n"),
            );
        })
    });
}

#[test]
fn types_of_bun_modules_lead_in_no_circle() {
    let modules = RuntimeModules::new(Archive::embedded(), false);
    let specifiers: Vec<&[u8]> = modules.public_specifiers().collect();
    let mut source = String::new();
    for (index, specifier) in specifiers.iter().enumerate() {
        source += &format!(
            "import * as module{index} from \"{}\";\n",
            BStr::new(specifier)
        );
    }
    let names: Vec<String> = (0..specifiers.len())
        .map(|index| format!("module{index}"))
        .collect();
    source += &format!("globalThis.everyModule = [{}];\n", names.join(", "));
    let project = TestProject::new(&[("a.js", source.as_str())], &default_settings());
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        with_bound_build(build, |build, loaded, bound| {
            let unit_count = build.check_and_lower(loaded, bound).len();
            assert!(unit_count > 150, "{unit_count} files were lowered");
            let files = loaded.projects.runtime.loaded.files();
            let is_excused =
                |file: FileId| files.module(file).file_name() == b"/$bun/js/runtime.out.js";
            let circular = build
                .circular_runtime_files
                .iter()
                .filter(|it| !is_excused(it.0));
            let circular: Vec<String> = circular
                .map(|&(file, count)| {
                    format!("{}: {count}", BStr::new(files.module(file).file_name()))
                })
                .collect();
            assert!(
                circular.is_empty(),
                "The checker came around a circle of types while these modules of Bun were lowered:\n{}",
                circular.join("\n"),
            );
        })
    });
}

#[test]
fn module_used_by_both_projects_has_one_record() {
    let files = [("a.js", "import \"node:events\";\nimport \"node:stream\";")];
    let program = link_successfully(&files).program;
    assert_eq!(find_modules(&program, b"node:events").len(), 1);
    assert_eq!(find_modules(&program, b"node:stream").len(), 1);
}

#[test]
fn entry_points_keep_command_line_order() {
    let files = [("z.ts", "export {};"), ("a.ts", "export {};")];
    let project = TestProject::with_entry_points(&files, 2, &default_settings());
    let (result, log) = link_project(&project, &WithoutServices);
    let linked = expect_success(result, &log);
    let source_paths = linked.summary.entry_points.iter();
    let source_paths: Vec<&BStr> = source_paths
        .map(|entry_point| BStr::new(&entry_point.source_path))
        .collect();
    assert_eq!(source_paths, ["/project/z.ts", "/project/a.ts"]);

    let program = &linked.program;
    assert_eq!(program.entries.len(), linked.summary.entry_points.len());
    for (entry, paths) in program.entries.iter().zip(&linked.summary.entry_points) {
        let module_path = program
            .strings
            .get(program.modules[entry.module.index()].path);
        assert_eq!(BStr::new(module_path), BStr::new(&paths.public_path));
    }
}

#[test]
fn worker_file_named_by_url_is_an_entry_point_after_one_load() {
    let main = "const file = new URL(\"./worker.js\", import.meta.url);\n\
        function start(path) {\n  return new Worker(path);\n}\nconsole.log(start(file));\n";
    let files = [("main.js", main), ("worker.js", "console.log(2);\n")];
    let expected = ["main.js", "worker.js"].map(|name| EntryPointPaths {
        public_path: format!("/$bunfs/root/{name}").into_bytes(),
        source_path: format!("/project/{name}").into_bytes(),
    });
    let found_by_load = with_loaded_build(&files, &default_settings(), |build, loaded| {
        assert!(build.retired_sessions.is_empty());
        collect_entry_point_paths(loaded.project(ProjectId::Application), &[])
    });
    assert_eq!(found_by_load, expected);

    let project = TestProject::new(&files, &default_settings());
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        let output = build.run_front_end()?;
        assert_eq!(build.retired_sessions.len(), ProjectId::COUNT);
        assert_eq!(output.entry_points, expected);
        assert_eq!(output.program.entries.len(), expected.len());
        Ok(())
    });
}

#[test]
fn test_file_with_syntax_error_yields_a_program() {
    let files = [
        ("broken.test.ts", "const two = ;\n"),
        ("fine.test.ts", "console.log(1);\nexport {};\n"),
        GLOBALS,
    ];
    let mut project = TestProject::with_entry_points(&files, 2, &default_settings());
    project.runs_tests = true;
    project.aot.runs_in_place = true;
    let (result, log) = link_project(&project, &WithoutServices);
    let program = expect_success(result, &log).program;
    assert_eq!(log.errors, 0, "{}", describe_messages(&log));
    let print_body = |module: ModuleId| {
        let body = program.modules[module.index()].body;
        let body = body.expect("a test file has a body");
        let mut text = String::new();
        print_function(
            program.name_tables(),
            body,
            &program.functions[body.index()],
            &mut text,
        );
        text
    };
    let entries = program.entries.iter();
    let bodies: Vec<String> = entries.map(|entry| print_body(entry.module)).collect();
    let [broken, fine] = &bodies[..] else {
        panic!("the program begins at {} files", bodies.len());
    };
    assert!(broken.contains("Throw"), "{broken}");
    assert!(!fine.contains("Throw"), "{fine}");
}

#[test]
fn module_without_source_file_has_no_text() {
    let files = [
        ("a.ts", "import \"bun:jsc\";\nconsole.log(1);"),
        GLOBALS,
        BUILTIN_MODULE_TYPES,
    ];
    let linked = link_successfully(&files);
    let (program, texts) = (&linked.program, &linked.summary.texts);
    let native_modules = find_modules(program, b"bun:jsc");
    let [native_module] = native_modules[..] else {
        panic!("{} modules have the path bun:jsc", native_modules.len());
    };
    let record = &program.modules[native_module.index()];
    assert_eq!(record.kind, ModuleKind::Runtime);
    assert_eq!(record.runtime_module, Some(RuntimeModule::BunJsc));
    assert!(texts.get(native_module).is_none());

    let source = texts.get(program.entries[0].module);
    let source = source.expect("a compiled file has its text");
    assert_eq!(BStr::new(&source.path), "/project/a.ts");
    assert_eq!(source.text().map(BStr::new), Some(BStr::new(files[0].1)));
}

#[test]
fn function_source_omits_types() {
    let text = "const greeting: string = \"gr\u{fc}\u{df}e\";\n\
        export function double(value: number): number {\n  return value * 2;\n}\n\
        console.log(greeting, double, double(21));";
    let linked = link_successfully(&[("a.ts", text), GLOBALS]);
    let (program, texts) = (&linked.program, &linked.summary.texts);
    let module = program.entries[0].module;
    let source = texts.get(module).expect("a compiled file has its text");
    assert_eq!(source.text().map(BStr::new), Some(BStr::new(text)));
    assert!(texts.size_of_texts() >= text.len());

    let function_source = source.function_source();
    assert_eq!(function_source.len(), source.function_source_len());
    assert!(function_source.len() < text.len());
    let of_module = (program.functions.iter()).filter(|function| function.module == module);
    let shown: Vec<&BStr> = of_module
        .map(|function| function.source_range)
        .map(|range| (range.start as usize, range.end as usize))
        .map(|(start, end)| BStr::new(&function_source[start..end]))
        .collect();
    let expected = BStr::new("function double(value) {\n  return value * 2;\n}");
    assert!(shown.contains(&expected), "{shown:?}");
}

#[test]
fn function_source_inlines_enums() {
    let colors = "export enum Tone { Low = \"low\" }";
    let text = "import { Tone } from \"./colors\";\n\
        enum Color { Red = -1, Green = 5 }\n\
        export function pick(Shadow: { Green: number }): unknown {\n  \
        return [Color.Green.toFixed(), 1-(Color as any).Red, Color.Red ** 2, { [-Color.Green]: Tone.Low }, Shadow.Green, Color[5]];\n}\n\
        console.log(pick, pick({ Green: 1 }));";
    let linked = link_successfully(&[("a.ts", text), ("colors.ts", colors), GLOBALS]);
    let (program, texts) = (&linked.program, &linked.summary.texts);
    let module = program.entries[0].module;
    let source = texts.get(module).expect("a compiled file has its text");
    let function_source = source.function_source();
    let of_module = (program.functions.iter()).filter(|function| function.module == module);
    let shown: Vec<&BStr> = of_module
        .map(|function| function.source_range)
        .map(|range| (range.start as usize, range.end as usize))
        .map(|(start, end)| BStr::new(&function_source[start..end]))
        .collect();
    let expected = BStr::new(
        "function pick(Shadow) {\n  return [5 .toFixed(), 1-(-1), (-1) ** 2, { [(-5)]: \"low\" }, Shadow.Green, Color[5]];\n}",
    );
    assert!(shown.contains(&expected), "{shown:?}");
}

#[test]
fn function_source_transpiles_declarations() {
    let text = "declare function f(): number;\n\
        namespace Box {\n  export let side = 4;\n  \
        export function area(): unknown {\n    \
        enum Inner { A = 7, B, \"c-d\" = \"s\", C = f() as number, D = A + f(), }\n    \
        enum Inner { E = -1 }\n    \
        side++;\n    return [{ side }, side * (side as number), Inner];\n  }\n}\n\
        console.log(Box.area, Box.area());";
    let linked = link_successfully(&[("a.ts", text), GLOBALS]);
    let (program, texts) = (&linked.program, &linked.summary.texts);
    let module = program.entries[0].module;
    let source = texts.get(module).expect("a compiled file has its text");
    let function_source = source.function_source();
    let of_module = (program.functions.iter()).filter(|function| function.module == module);
    let shown: Vec<&BStr> = of_module
        .map(|function| function.source_range)
        .map(|range| (range.start as usize, range.end as usize))
        .map(|(start, end)| BStr::new(&function_source[start..end]))
        .collect();
    let expected = BStr::new(
        "function area() {\n    \
        let Inner; ((Inner) => [Inner[Inner[\"A\"] = 7] = \"A\", Inner[Inner[\"B\"] = 8] = \"B\", Inner[\"c-d\"] = \"s\", \
        Inner[Inner[\"C\"] = f()] = \"C\", Inner[Inner[\"D\"] = Inner.A + f()] = \"D\", ])(Inner ||= {});\n    \
        ;((Inner) => [Inner[Inner[\"E\"] = (-1)] = \"E\" ])(Inner ||= {});\n    \
        Box.side++;\n    return [{ side: Box.side }, Box.side * (Box.side), Inner];\n  }",
    );
    assert!(shown.contains(&expected), "{shown:?}");
}

#[test]
fn declared_record_bears_the_position_of_its_function() {
    let library = "export const first = value => value;\n\
        export function aborted(payload) { return payload.issues.length > 0; }\n\
        export class Kept { constructor(payload) { this.payload = payload; } }\n";
    let declarations = "export interface Payload { value: unknown; issues: unknown[] }\n\
        export declare const first: <T>(value: T) => T;\n\
        export declare function aborted(payload: Payload): boolean;\n\
        export declare class Kept { constructor(payload: Payload); payload: Payload }\n";
    let main = "import { Kept, aborted, first } from \"./library.js\";\n\
        console.log(aborted(first(new Kept({ value: 1, issues: [] }).payload)));";
    let files = [
        ("main.ts", main),
        ("library.js", library),
        ("library.d.ts", declarations),
        GLOBALS,
    ];
    let program = &link_successfully(&files).program;
    assert_eq!(program.declared_records.len(), 2);
    for declared in &program.declared_records {
        let place = (declared.module, declared.position);
        let mut functions = program.functions.iter();
        assert!(functions.any(|function| (function.module, function.position) == place));
    }
}

#[test]
fn function_source_omits_dead_code() {
    let text = "declare const unbound: unknown;\n\
        export function shown(o: any): unknown {\n  \
        if (false) o.dead();\n  \
        if (false) { o.dead(); } else o.a;\n  \
        if (true) o.b; else o.dead(); // @ts-expect-error\n  \
        const kept = [true ? o.c : o.dead(), false && o.dead(), true && o.d, null ?? o.e, !true || o.f];\n  \
        (true ? o.m : 0)();\n  \
        (true ? o : 0)();\n  \
        typeof (true ? unbound : 0);\n  \
        true ? { g: 1 }.g : 0;\n  \
        for (let i: unknown = true ? \"h\" in o : 0; i; i = false) o.i;\n  \
        for (let i = [true ? \"h\" in o : 0]; i.pop(); ) o.i;\n  \
        return () => true ? { kept } : 0;\n}\n\
        console.log(shown);";
    let linked = link_successfully(&[("a.ts", text), GLOBALS]);
    let (program, texts) = (&linked.program, &linked.summary.texts);
    let module = program.entries[0].module;
    let source = texts.get(module).expect("a compiled file has its text");
    let function_source = source.function_source();
    let of_module = (program.functions.iter()).filter(|function| function.module == module);
    let shown: Vec<&BStr> = of_module
        .map(|function| function.source_range)
        .map(|range| (range.start as usize, range.end as usize))
        .map(|(start, end)| BStr::new(&function_source[start..end]))
        .collect();
    let expected = BStr::new(
        "function shown(o) {\n  if (false) ;\n  if (false) {} else o.a;\n  if (true) o.b; // @ts-expect-error\n  \
        const kept = [o.c, false, o.d, o.e, o.f];\n  (0, o.m)();\n  (o)();\n  typeof (0, unbound);\n  \
        ({ g: 1 }).g;\n  for (let i = (\"h\" in o); i; i = false) o.i;\n  \
        for (let i = [\"h\" in o]; i.pop(); ) o.i;\n  return () => ({ kept });\n}",
    );
    assert!(shown.contains(&expected), "{shown:?}");
}

#[test]
fn function_source_preserves_behavior() {
    let texts_of = |path: &str, text: &str| -> Vec<String> {
        let linked = link_successfully(&[(path, text), GLOBALS]);
        let (program, texts) = (&linked.program, &linked.summary.texts);
        let module = program.entries[0].module;
        let source = texts.get(module).expect("a compiled file has its text");
        let function_source = source.function_source();
        let of_module = (program.functions.iter()).filter(|function| function.module == module);
        of_module
            .map(|function| function.source_range)
            .map(|range| (range.start as usize, range.end as usize))
            .map(|(start, end)| String::from_utf8_lossy(&function_source[start..end]).into_owned())
            .collect()
    };
    let text = "enum Level { Below = -1, Strict = \"use strict\" }\n\
        export function shown(o: any): unknown {\n  \
        if (false) { var a: number = 1, { b, c: [d] } = o; for (var e in o) ; }\n  \
        if (false) var f = 1;\n  \
        if (false) var [] = o, {} = o;\n  \
        if (true) o.a; else { var g = 1; }\n  \
        if (o.b) if (true) o.c; else o.dead(); else o.d;\n  \
        if (true) o.e()\n  \
        else { o.dead() }\n  \
        (o.f)\n  \
        let h = o\n  \
        true && [1].map(o.g)\n  \
        let i = o\n  \
        type Gone = number;\n  \
        true ? (o.h, o.i) : 0\n  \
        if (o.j) { o.k; }\n  \
        false || `t`.length\n  \
        switch (o) { case 1: h = o\n  \
        true && -o.l }\n  \
        if (o.m) true && [o.n];\n  \
        let j = o\n  \
        Level.Below.toFixed()\n  \
        return [a!, b, d, e!, f!, g!, h, i, j];\n}\n\
        export function sloppy(this: unknown): unknown {\n  \
        true && \"use strict\";\n  \
        Level.Strict;\n  \
        return this;\n}\n\
        console.log(shown, sloppy);";
    let shown = texts_of("a.ts", text);
    for expected in [
        "function shown(o) {\n  if (false) { var a, b, d, e; }\n  if (false) var f;\n  if (false) ;\n  \
        if (true) o.a; else { var g; }\n  if (o.b) if (true) o.c; else ; else o.d;\n  \
        if (true) o.e()\n  else {}\n  (o.f)\n  let h = o\n  ;[1].map(o.g)\n  let i = o\n  \n  \
        ;(o.h, o.i)\n  if (o.j) { o.k; }\n  `t`.length\n  switch (o) { case 1: h = o\n  ;-o.l }\n  \
        if (o.m) [o.n];\n  let j = o\n  ;(-1).toFixed()\n  return [a, b, d, e, f, g, h, i, j];\n}",
        "function sloppy() {\n  ;\"use strict\";\n  \"use strict\";\n  return this;\n}",
    ] {
        assert!(shown.iter().any(|it| it == expected), "{shown:#?}");
    }
    let text = "exports.shown = function () {\n  if (false) { function g() {} }\n  return g;\n};";
    let expected = "function() {\n  if (false) { var g; }\n  return g;\n}";
    let shown = texts_of("a.cjs", text);
    assert!(shown.iter().any(|it| it == expected), "{shown:#?}");
}

#[test]
fn function_source_folds_constants() {
    let operators = "export function shown(o) {\n  \
        return [1 && o.a, \"\" || o.b, void 0 ?? o.c, 0n || o.d, !0 && o.e, -1 && o.f, /x/ && o.g,\n  \
        typeof 1 === \"number\" && o.h, (o.i++, true) ? o.j : o.k, (o.i++, 1) && o.l, [] && o.m];\n}\n\
        console.log(shown);";
    let text = "export function sloppy(this: unknown): unknown {\n  \
        type Gone = number;\n  \
        \"use strict\";\n  \
        return this;\n}\n\
        export function strict(this: unknown): unknown {\n  \"use strict\";\n  return this;\n}\n\
        export function made(this: unknown): unknown {\n  \"use strict\" as string;\n  return this;\n}\n\
        export function read(this: unknown): unknown {\n  \"text\".length;\n  return this;\n}\n\
        export function later(this: unknown): unknown {\n  let kept = 1;\n  \"use strict\";\n  return this;\n}\n\
        console.log(sloppy, strict, made, read, later);";
    let texts_of = |path: &str, text: &str| -> Vec<String> {
        let linked = link_successfully(&[(path, text), GLOBALS]);
        let (program, texts) = (&linked.program, &linked.summary.texts);
        let module = program.entries[0].module;
        let source = texts.get(module).expect("a compiled file has its text");
        let function_source = source.function_source();
        let of_module = (program.functions.iter()).filter(|function| function.module == module);
        of_module
            .map(|function| function.source_range)
            .map(|range| (range.start as usize, range.end as usize))
            .map(|(start, end)| String::from_utf8_lossy(&function_source[start..end]).into_owned())
            .collect()
    };
    let expected = "function shown(o) {\n  return [o.a, o.b, o.c, o.d, o.e, o.f, o.g,\n  \
        o.h, (o.i++, true) ? o.j : o.k, (o.i++, 1) && o.l, [] && o.m];\n}";
    let shown = texts_of("a.js", operators);
    assert!(shown.iter().any(|it| it == expected), "{shown:#?}");
    let shown = texts_of("a.ts", text);
    for expected in [
        "function sloppy() {\n  \n  ;\"use strict\";\n  return this;\n}",
        "function strict() {\n  ;\"use strict\";\n  return this;\n}",
        "function made() {\n  ;\"use strict\";\n  return this;\n}",
        "function read() {\n  ;\"text\".length;\n  return this;\n}",
        "function later() {\n  let kept = 1;\n  \"use strict\";\n  return this;\n}",
    ] {
        assert!(shown.iter().any(|it| it == expected), "{shown:#?}");
    }
}

#[test]
fn library_module_that_is_evaluated_without_code_is_named() {
    let files = [
        ("a.ts", "import \"bun:jsc\";\nconsole.log(1);"),
        GLOBALS,
        BUILTIN_MODULE_TYPES,
    ];
    let linked = link_successfully(&files);
    let native_modules = find_modules(&linked.program, b"bun:jsc");
    let [native_module] = native_modules[..] else {
        panic!("{} modules have the path bun:jsc", native_modules.len());
    };
    let paths = collect_paths_of_modules_without_bodies(&linked.program);
    let describe = |lacked: &[MissingModuleRecord]| {
        let records = ResultRecords {
            missing_library_modules: lacked,
            ..ResultRecords::default()
        };
        records.with_result(|engine| describe_missing_library_modules(engine, &paths))
    };
    assert_eq!(describe(&[]), None);

    let module = native_module.to_word();
    let message = describe(&[MissingModuleRecord { module }]);
    let message = message.expect("a module that the engine lacks stops the build");
    assert!(
        message.ends_with("that the load stage removed: bun:jsc"),
        "{message}"
    );

    let module = u32::try_from(linked.program.modules.len()).unwrap();
    let message = describe(&[MissingModuleRecord { module }]);
    let message = message.expect("so does one that the program does not list");
    assert!(message.ends_with(&format!("number {module}")), "{message}");
}

#[test]
fn library_module_that_is_evaluated_without_code_stops_the_build() {
    let files = [
        ("a.ts", "import \"bun:jsc\";\nconsole.log(1);"),
        GLOBALS,
        BUILTIN_MODULE_TYPES,
    ];
    let linked = link_successfully(&files);
    let native_modules = find_modules(&linked.program, b"bun:jsc");
    let [native_module] = native_modules[..] else {
        panic!("{} modules have the path bun:jsc", native_modules.len());
    };
    let module = native_module.to_word();
    let lacked = [MissingModuleRecord { module }];
    let records = ResultRecords {
        missing_library_modules: &lacked,
        ..ResultRecords::default()
    };

    let project = TestProject::new(&[("a.ts", "")], &default_settings());
    let finish_build = |omits_builtin_modules: bool| {
        let mut options = project.options(BUNDLED_LIBS);
        options.load.omits_builtin_modules = omits_builtin_modules;
        let caches = ThreadCaches::default();
        let mut build = Build::new(&options, &WithoutServices, &caches, LimitValues::for_host());
        build.paths_of_modules_without_bodies =
            collect_paths_of_modules_without_bodies(&linked.program);
        records.with_result(|engine| build.report_missing_library_modules(engine));
        let result = match build.diagnostics.has_errors() {
            true => Err(Stage::Any),
            false => Ok(()),
        };
        let mut log = Log::init();
        let failed = build.finish(result, &mut log).err();
        (failed, log)
    };

    let (failed, log) = finish_build(false);
    assert!(
        failed
            .expect("the record stops the build")
            .is_internal_error
    );
    let message = "internal compiler error (Load): the program evaluates built-in modules that the load stage removed";
    assert!(has_message(&log, Kind::Err, message));
    assert_eq!(log.msgs.len(), 1);

    let (failed, log) = finish_build(true);
    assert!(failed.is_none());
    assert!(log.msgs.is_empty());
}
