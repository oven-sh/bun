use super::testing::{
    BUNDLED_LIBS, TemporaryDirectory, TestProject, decide_project_roles, default_settings,
    describe_messages, run_build, with_bound_build, with_loaded_build,
};
use super::*;
use crate::builtins::{RuntimeFunction, RuntimeModule, table};
use crate::ir::generated::{FunctionFlags, ModuleKind};
use crate::ir::{FunctionId, Id, ModuleId, print_function, print_program};
use crate::link::ModuleOrigin;
use crate::load::read_file_bytes;
use crate::load::runtime_modules::RuntimeModules;
use crate::load::source_provider::{
    DeferredLoad, Failed, LoadRequest, Loaded, MacroCall, Resolution, ResolveRequest, SourceFile,
    WithoutServices,
};
use crate::statistics::LimitId;
use bstr::{BStr, ByteSlice};
use bun_ast::{Kind, Loader};
use bun_builtin_sources::Archive;
use bun_sema::fold::FoldOptions;
use bun_sema::hir_from_data::{DataModule, DataValue};
use bun_sema::program::FileRole;
use bun_sema::session::Arena;
use bun_sema_driver::Demotion;
use bun_sema_driver::host::from_native;
use std::borrow::Cow;
use std::num::NonZeroU32;

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
const TYPE_MISMATCH: u32 = 2322;
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
    print_program(&expect_success(result, &log).program)
}

fn find_modules(program: &Program, path: &[u8]) -> Vec<ModuleId> {
    let modules = (0..program.modules.len()).map(ModuleId::new);
    modules
        .filter(|module| program.strings.get(program.modules[module.index()].path) == path)
        .collect()
}

fn count_checked_functions(program: &Program, names: &ProgramNames, origin: ModuleOrigin) -> usize {
    let functions = program.functions.iter();
    functions
        .filter(|function| names.module_origin(function.module) == origin)
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
fn output_is_deterministic() {
    let files = [
        ("a.ts", "import { b } from \"./b\";\nconsole.log(b + 1);"),
        ("b.ts", "export const b: number = 1;"),
        GLOBALS,
    ];
    let mut project = TestProject::new(&files, &default_settings());
    let first = print_linked_program(&project);
    assert_eq!(first, print_linked_program(&project));
    project.aot.thread_count = NonZeroU32::new(4);
    assert_eq!(first, print_linked_program(&project));
}

fn emit_bytes(files: &[(&str, &str)]) -> Vec<u8> {
    let project = TestProject::new(files, &default_settings());
    let mut log = Log::init();
    let result = emit_program(&project.options(BUNDLED_LIBS), &WithoutServices, &mut log);
    expect_success(result, &log).bytes.as_slice().to_vec()
}

// The configuration names no files, so every file of the folder is in the checker's program and has a number there.
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
fn type_error_fails_at_check_and_lower() {
    let (result, log) = link_files(&[("a.ts", "const x: number = \"a\";")]);
    let failed = expect_failure(result);
    assert_eq!(failed.stage, Stage::Lower);
    assert!(!failed.is_internal_error);
    assert!(failed.compilation.is_none());
    assert!(has_code(&log, Kind::Err, TYPE_MISMATCH));
    assert_eq!(failed.statistics.get(Stage::LinkAndEmit.time()), 0);
}

#[test]
fn javascript_type_error_builds() {
    let text = "/** @type {number} */\nconst x = \"a\";\nconsole.log(x);";
    let (result, log) = link_files(&[("a.js", text)]);
    expect_success(result, &log);
    assert_eq!(log.errors, 0);
}

#[test]
fn reports_all_stage_errors() {
    let text = "const x: number = \"a\";\nconst y: string = 1;";
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
        (Stage::Lower, "const x: number = \"a\";"),
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
            "import data from \"./data.json\";\nimport \"./b.js\";\nconsole.log(data);",
        ),
        ("b.js", "export {};"),
        ("data.json", "{}"),
        GLOBALS,
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

// The text of a module of Bun's that the build has read to the end, if the module is in the program of the run time.
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
    assert_eq!(is_runtime_module_read(prints, path), Some(false));
    let parses = "import { parse } from 'node:querystring'; console.log(parse('a=b'));";
    assert_eq!(is_runtime_module_read(parses, path), Some(true));
}

// Where several files of Bun's declare one interface, the order of the files is the order of its members and overloads.
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
    // A name that ends a path sorts before every name that is followed by another.
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

fn count_builtin_types_degraded_to_views(declarations: &str) -> u64 {
    let files = [SMALL_PROGRAM[0], GLOBALS, ("registry.d.ts", declarations)];
    let statistics = link_successfully(&files).summary.statistics;
    statistics.get(StatisticId::BuiltinTypesDegradedToViews)
}

#[test]
fn counts_builtin_types_degraded_to_views() {
    let without_subtype = count_builtin_types_degraded_to_views("interface Registry {}");
    let exact_base = "interface Registry extends Map<string, number> {}";
    let view_base = "interface Registry extends ReadonlyMap<string, number> {}";
    let count = count_builtin_types_degraded_to_views;
    assert_eq!(count(exact_base), without_subtype + 1);
    assert_eq!(count(view_base), without_subtype);
}

fn link_registered_functions(omits_builtin_modules: bool) -> Vec<RuntimeFunction> {
    let project = TestProject::new(&SMALL_PROGRAM, &default_settings());
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

fn count_folded_strings_over_limit(operand_length: usize) -> u64 {
    let operand = "a".repeat(operand_length);
    let text = format!("console.log(\"{operand}\" + \"{operand}\");");
    let statistics = link_successfully(&[("a.ts", text.as_str()), GLOBALS])
        .summary
        .statistics;
    statistics.get(LimitId::MaxFoldedStringBytes.hits())
}

#[test]
fn counts_folded_strings_over_limit() {
    let maximum = LimitValues::for_host().get(LimitId::MaxFoldedStringBytes) as usize;
    assert_eq!(count_folded_strings_over_limit(maximum), 1);
    assert_eq!(count_folded_strings_over_limit(maximum / 2), 0);
}

#[test]
fn counts_emitted_bytes() {
    let project = TestProject::new(&SMALL_PROGRAM, &default_settings());
    let mut log = Log::init();
    let result = emit_program(&project.options(BUNDLED_LIBS), &WithoutServices, &mut log);
    let emitted = expect_success(result, &log);
    let size = emitted.bytes.as_slice().len() as u64;
    assert!(size > 0);
    let counted = emitted.summary.statistics.get(StatisticId::ProgramBytes);
    assert_eq!(counted, size);
}

fn write_program_to(path: &[u8]) -> (Result<Vec<u8>, BuildFailed>, Log) {
    let mut project = TestProject::new(&SMALL_PROGRAM, &default_settings());
    project.aot.ir_output_path = Some(Box::from(path));
    let options = project.options(BUNDLED_LIBS);
    let caches = ThreadCaches::default();
    let mut build = Build::new(&options, &WithoutServices, &caches, LimitValues::for_host());
    let written = build
        .run_through_emit(BodyPlacement::InProgramBytes)
        .and_then(|(bytes, _)| {
            build.write_program_file(&bytes)?;
            Ok(bytes.as_slice().to_vec())
        });
    let mut log = Log::init();
    let result = build.finish(written, &mut log);
    (result.map(|(bytes, _)| bytes), log)
}

#[test]
fn unwritable_ir_output_fails_at_emit() {
    let (result, log) = write_program_to(b"/project/missing/program.bin");
    let failed = expect_failure(result);
    assert_eq!(failed.stage, Stage::LinkAndEmit);
    assert!(!failed.is_internal_error);
    assert!(has_code(&log, Kind::Err, Code::OutputNotWritten.number()));
}

#[test]
fn ir_output_holds_emitted_bytes() {
    let directory = TemporaryDirectory::new("compile_ir_output");
    let path = [directory.path(), b"/program.bin"].concat();
    let (result, log) = write_program_to(&path);
    let bytes = expect_success(result, &log);
    assert!(!bytes.is_empty());
    assert_eq!(read_file_bytes(&from_native(&path)), Some(bytes));
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
    ) -> Result<DataModule<'s>, Failed> {
        WithoutServices.parse_data(file, arena, atoms, log)
    }

    fn run_macro<'s>(
        &self,
        call: &MacroCall<'_, 's>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<&'s DataValue<'s>, Failed> {
        WithoutServices.run_macro(call, arena, atoms, log)
    }

    fn bundle_pages<'s>(
        &self,
        pages: &[&[u8]],
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<Vec<&'s DataValue<'s>>, Failed> {
        WithoutServices.bundle_pages(pages, arena, atoms, log)
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

fn print_runtime_functions(linked: &LinkedProgram) -> String {
    let (program, names) = (&linked.program, &linked.summary.names);
    let mut text = String::new();
    for (index, function) in program.functions.iter().enumerate() {
        if names.module_origin(function.module) == ModuleOrigin::Runtime {
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
        let names = &linked.summary.names;
        let checked_functions =
            count_checked_functions(&linked.program, names, ModuleOrigin::Program);
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

// The checker decides the role of each file of either project, and each file is lowered in that role.
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
    let (program, names) = (&linked.program, &linked.summary.names);
    assert!(count_checked_functions(program, names, ModuleOrigin::Program) > 0);
    assert!(count_checked_functions(program, names, ModuleOrigin::Runtime) > 0);
}

fn count_lowered_files_of_bun(source: &str) -> usize {
    let project = TestProject::new(&[("a.js", source)], &default_settings());
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        with_bound_build(build, |build, loaded, bound| {
            let units = build.check_and_lower(loaded, bound);
            let application_files = loaded.projects.application.loaded.files().compiled_files();
            units.len() - application_files.len()
        })
    })
}

#[test]
fn small_program_lowers_little_of_bun() {
    let of_empty_program = count_lowered_files_of_bun("export {};\n");
    assert!(
        of_empty_program < 70,
        "{of_empty_program} files of Bun are lowered for nothing"
    );
    let computed = "export const loaded = require(process.argv[2]);\n";
    let of_computed_name = count_lowered_files_of_bun(computed);
    assert!(
        of_computed_name < 90,
        "{of_computed_name} files of Bun are lowered for a computed name"
    );
    let listeners = "process.on('exit', () => {});\nprocess.once('SIGINT', () => {});\n";
    let of_listeners = count_lowered_files_of_bun(listeners);
    assert!(
        of_listeners < 90,
        "{of_listeners} files of Bun are lowered for two listeners"
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
fn link_error_names_the_files_and_the_import() {
    use super::link_stage::describe_link_error;
    use crate::link::{LinkError, ProgramModule, ProgramVariableKey};
    use crate::load::ProgramFile;

    let files = [
        (
            "main.js",
            "import { first } from \"./tools.cjs\";\nconsole.log(first);\n",
        ),
        ("tools.cjs", "exports.first = 1;\n"),
        GLOBALS,
    ];
    with_loaded_build(&files, &default_settings(), |_, loaded| {
        let project = ProjectId::Application;
        let by_path = &loaded.project(project).loaded.files().by_path;
        let file = |path: &[u8]| ProgramFile {
            project,
            file: by_path.get(path).expect("the program has the file"),
        };
        let (main, module) = (
            file(b"/project/main.js"),
            ProgramModule::File(file(b"/project/tools.cjs")),
        );
        let name = loaded.atoms.intern(b"first");
        let described = |key| {
            let error = LinkError::UndefinedVariable {
                key,
                referenced_in: main,
            };
            String::from_utf8(describe_link_error(loaded, &error)).unwrap()
        };
        assert_eq!(
            described(ProgramVariableKey::Copy { module, name }),
            "UndefinedVariable: what ES modules hold of `first` of /project/tools.cjs, reached from /project/main.js"
        );
        assert_eq!(
            described(ProgramVariableKey::SyntheticExport { module, name }),
            "UndefinedVariable: the export `first` of /project/tools.cjs, reached from /project/main.js"
        );
        let missing = LinkError::MissingUnit { file: main };
        assert_eq!(
            describe_link_error(loaded, &missing),
            b"MissingUnit: /project/main.js"
        );
    });
}

// With a file that is left out goes what only that file names.
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

// No build looks for type errors in Bun's own modules (`keep_verified_roles`), and what has an error has the type `any`.
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
            let describe = |demotion: &Demotion| {
                let mut errors = decision.diagnostics.iter().map(|it| &it.diagnostic);
                match errors.find(|error| error.file == Some(demotion.file)) {
                    Some(error) => format!(
                        "{}:{}:{} TS{}: {}",
                        BStr::new(&error.path),
                        error.line,
                        error.column,
                        error.code,
                        BStr::new(&error.text),
                    ),
                    None => format!("{:?}: {:?}", demotion.file, demotion.cause),
                }
            };
            let mut untyped: Vec<String> = decision.demoted.iter().map(describe).collect();
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

// See `Build::lower_projects`. A declaration with a written type is in no circle.
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
                |file: FileId| files.module(file).file_name() == b"/$bun/js/runtime.bun.js";
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
    assert_eq!(BStr::new(source.text()), files[0].1);
}

#[test]
fn text_of_a_package_is_the_file_under_the_aot_condition() {
    const TYPED: &str = "export const x: number = 1;\n";
    let directory = TemporaryDirectory::new("compile_aot_condition_text");
    directory.write("tsconfig.json", CONFIGURATION);
    directory.write("app.ts", "import \"p\";\n");
    directory.write_typed_package("export const x = 1;\n", TYPED);
    let project = TestProject::on_disk(directory.path(), &["app.ts"]);
    let (result, log) = link_project(&project, &WithoutServices);
    let linked = expect_success(result, &log);

    let modules = (0..linked.program.modules.len()).map(ModuleId::new);
    let package_sources: Vec<(&BStr, &BStr)> = modules
        .filter_map(|module| linked.summary.texts.get(module))
        .filter(|source| source.path.contains_str("/node_modules/p/"))
        .map(|source| (BStr::new(&source.path), BStr::new(source.text())))
        .collect();
    let [(path, text)] = package_sources[..] else {
        panic!("{package_sources:?}");
    };
    assert!(path.ends_with(b"/node_modules/p/x.aot.ts"));
    assert_eq!(text, TYPED);
}

fn find_refused_entry_points(files: &[(&str, &str)], entry_point_count: usize) -> Option<Vec<u32>> {
    let mut project = TestProject::with_entry_points(files, entry_point_count, &default_settings());
    project.aot.checks_only = true;
    let (result, _) = link_project(&project, &WithoutServices);
    expect_failure(result).refused_entry_points
}

#[test]
fn entry_points_that_reach_an_error_are_refused() {
    let files = [
        (
            "fine.ts",
            "import { one } from \"./shared\";\nconsole.log(one);",
        ),
        (
            "wrong.ts",
            "const n: number = \"text\";\nconsole.log(n);\nexport {};",
        ),
        (
            "imports-wrong.ts",
            "import { two } from \"./middle\";\nconsole.log(two);",
        ),
        (
            "types-of-wrong.ts",
            "import type { Two } from \"./broken\";\nconst two: Two = 2;\nconsole.log(two);",
        ),
        ("also-fine.ts", "console.log(1);\nexport {};"),
        ("shared.ts", "export const one: number = 1;"),
        ("middle.ts", "export { two } from \"./broken\";"),
        (
            "broken.ts",
            "export const two: number = \"two\";\nexport type Two = number;",
        ),
        GLOBALS,
    ];
    assert_eq!(find_refused_entry_points(&files, 5), Some(vec![1, 2, 3]));
}

#[test]
fn syntax_error_refuses_the_entry_points_that_reach_it() {
    let files = [
        ("fine.ts", "console.log(1);\nexport {};"),
        (
            "imports-wrong.ts",
            "import { two } from \"./broken\";\nconsole.log(two);",
        ),
        ("broken.ts", "export const two = ;"),
        GLOBALS,
    ];
    assert_eq!(find_refused_entry_points(&files, 2), Some(vec![1]));
}

#[test]
fn build_that_compiles_refuses_the_whole_program() {
    let files = [
        ("fine.ts", "console.log(1);\nexport {};"),
        (
            "wrong.ts",
            "const n: number = \"text\";\nconsole.log(n);\nexport {};",
        ),
        GLOBALS,
    ];
    let project = TestProject::with_entry_points(&files, 2, &default_settings());
    let (result, _) = link_project(&project, &WithoutServices);
    assert_eq!(expect_failure(result).refused_entry_points, None);
}
