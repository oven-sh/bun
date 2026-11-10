use super::{BoundBuild, Build, FrontEndOutput, LoadedBuild, LoadedProject};
use super::{BuildFailed, LinkedProgram, link_program};
use crate::builtins::BuiltinId;
use crate::diagnostics::ProgramView;
use crate::engine::ExecutableIdentity;
use crate::ir::Program;
use crate::known_helpers::KnownHelpers;
use crate::load::ProjectId;
use crate::load::source_provider::{SourceProvider, WithoutServices};
use crate::lower::LeftOutDeclarations;
use crate::lower::{LoweredFile, LoweringInputs, LoweringOptions, lower_file};
use crate::modules::{BindInput, DeferredExports, bind_modules};
use crate::options::{LoadOptions, Options, PathOptions, RemovableOptions};
use crate::statistics::{LimitValues, Stage};
use bstr::BStr;
use bun_ast::Log;
use bun_ast::runtime::ReactCompilerMode;
use bun_builtin_sources::VIRTUAL_ROOT;
use bun_options_types::aot_options::AotOptions;
use bun_sema::atom::Atom;
use bun_sema::json::Json;
use bun_sema::program::FileId;
use bun_sema::program::Files;
use bun_sema::resolve::{CodeOptions, JsxRuntime, TranspileSettings};
use bun_sema_driver::host::from_native;
use bun_sema_driver::{Libs, RoleDecision, ThreadCaches, check_and_lower, decide_roles};
use std::fmt::Write;
use std::num::NonZeroU32;
use std::sync::Once;

const PROJECT_DIRECTORY: &[u8] = b"/project";
const CONFIGURATION_FILE: &str = "tsconfig.json";

pub(crate) const BUNDLED_LIBS: Libs<'static> = Libs::Bundled(bun_sema_standalone::TYPESCRIPT_LIBS);

pub(crate) const TYPED_PACKAGE_JSON: &str = r#"{"name":"p","version":"1.0.0","type":"module","exports":{"aot":"./x.aot.ts","default":"./x.js"}}"#;

pub fn with_bind_input_and_libs<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    libs: Libs<'_>,
    then: impl FnOnce(&BindInput<'_, '_>) -> R,
) -> R {
    with_build(libs, files, settings, &WithoutServices, |build| {
        with_loaded_bind_input(build, ProjectId::Application, then)
    })
}

pub fn lower_program(
    files: &[(&str, &str)],
    options: LoweringOptions,
) -> Vec<(FileId, LoweredFile)> {
    with_build_that_keeps_library_code(files, |build| {
        with_bound_build(build, |build, loaded, bound| {
            let application = loaded.project(ProjectId::Application).loaded.files();
            let runtime = loaded.project(ProjectId::Runtime).loaded.files();
            let lower = |project: ProjectId, files: &[FileId]| {
                lower_project_files(build, loaded, bound, project, files, options)
            };
            let mut lowered = lower(ProjectId::Application, application.compiled_files());
            let replaced_sources = find_replaced_runtime_sources(runtime, files);
            if !replaced_sources.is_empty() {
                lowered.extend(lower(ProjectId::Runtime, &replaced_sources));
            }
            lowered
        })
    })
}

pub(crate) fn lower_program_without(
    files: &[(&str, &str)],
    choose: impl FnOnce(&Files<'_>) -> LeftOutDeclarations,
) -> Vec<(FileId, LoweredFile)> {
    let settings = default_settings();
    with_build(BUNDLED_LIBS, files, &settings, &WithoutServices, |build| {
        with_bound_build(build, |build, loaded, bound| {
            let project = loaded.project(ProjectId::Application);
            let roles = decide_project_roles(project);
            let compiled_files = project.loaded.files().compiled_files();
            let files_to_lower = find_files_without_early_errors(compiled_files, &roles);
            build.with_lowering_inputs(loaded, bound, ProjectId::Application, &roles, |inputs| {
                let mut library_functions = inputs.library_functions.clone();
                library_functions.leave_out_declarations(choose(project.loaded.files()));
                let inputs = LoweringInputs {
                    library_functions: &library_functions,
                    ..*inputs
                };
                let checked = check_and_lower(
                    project.loaded,
                    project.host,
                    project.request,
                    &roles,
                    &files_to_lower,
                    &|checker, file| lower_file(&inputs, checker, file),
                );
                checked.lowered
            })
        })
    })
}

pub(crate) fn lower_program_replacing(
    files: &[(&str, &str)],
    replaced_builtins: &[u32],
) -> Vec<(FileId, LoweredFile)> {
    let settings = default_settings();
    with_build(BUNDLED_LIBS, files, &settings, &WithoutServices, |build| {
        with_bound_build(build, |build, loaded, bound| {
            let project = loaded.project(ProjectId::Application);
            let roles = decide_project_roles(project);
            let compiled_files = project.loaded.files().compiled_files();
            let files_to_lower = find_files_without_early_errors(compiled_files, &roles);
            build.with_lowering_inputs(loaded, bound, ProjectId::Application, &roles, |inputs| {
                let inputs = LoweringInputs {
                    replaced_builtins,
                    ..*inputs
                };
                let checked = check_and_lower(
                    project.loaded,
                    project.host,
                    project.request,
                    &roles,
                    &files_to_lower,
                    &|checker, file| lower_file(&inputs, checker, file),
                );
                checked.lowered
            })
        })
    })
}

pub(crate) fn lower_program_below_object_prototype(
    files: &[(&str, &str)],
    names: &[&str],
) -> Vec<(FileId, LoweredFile)> {
    let settings = default_settings();
    with_build(BUNDLED_LIBS, files, &settings, &WithoutServices, |build| {
        with_bound_build(build, |build, loaded, bound| {
            let project = loaded.project(ProjectId::Application);
            let roles = decide_project_roles(project);
            let compiled_files = project.loaded.files().compiled_files();
            let files_to_lower = find_files_without_early_errors(compiled_files, &roles);
            let atoms = &project.loaded.files().atoms;
            let added: Vec<(BuiltinId, Atom)> = names
                .iter()
                .map(|name| (BuiltinId::ObjectPrototype, atoms.intern(name.as_bytes())))
                .collect();
            build.with_lowering_inputs(loaded, bound, ProjectId::Application, &roles, |inputs| {
                let inputs = LoweringInputs {
                    names_added_to_builtins: &added,
                    ..*inputs
                };
                let checked = check_and_lower(
                    project.loaded,
                    project.host,
                    project.request,
                    &roles,
                    &files_to_lower,
                    &|checker, file| lower_file(&inputs, checker, file),
                );
                checked.lowered
            })
        })
    })
}

pub fn lower_program_with_settings(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
) -> Vec<(FileId, LoweredFile)> {
    lower_program_with_provider(files, settings, &WithoutServices)
}

pub fn lower_program_with_provider(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    provider: &dyn SourceProvider,
) -> Vec<(FileId, LoweredFile)> {
    with_build(BUNDLED_LIBS, files, settings, provider, |build| {
        lower_files(build, ProjectId::Application)
    })
}

pub fn lower_program_with_limits(
    files: &[(&str, &str)],
    limits: LimitValues,
) -> Vec<(FileId, LoweredFile)> {
    let project = TestProject::new(files, &default_settings());
    lower_application(&TestProject { limits, ..project })
}

pub(crate) fn lower_test_run(files: &[(&str, &str)]) -> Vec<(FileId, LoweredFile)> {
    let mut project = TestProject::new(files, &default_settings());
    project.runs_tests = true;
    lower_application(&project)
}

pub fn lower_and_link_program<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    then: impl FnOnce(&Program) -> R,
) -> R {
    with_build(BUNDLED_LIBS, files, settings, &WithoutServices, |build| {
        let output = build.with_loaded_projects(|build, loaded| {
            let bound = build.bind_modules(&loaded)?;
            build.stop_if_errors(Stage::BindModules)?;
            let units = build.check_and_lower(&loaded, &bound);
            build.link(loaded, bound, units)
        })?;
        let FrontEndOutput {
            mut program,
            functions,
            ..
        } = output;
        program.functions = functions.into_program_functions(&build.parallel_runner());
        Ok(then(&program))
    })
}

pub fn link_program_with_react_compiler(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    mode: ReactCompilerMode,
) -> Result<LinkedProgram, BuildFailed> {
    link_project(&TestProject::new(files, settings).with_react_compiler(mode))
}

pub fn with_bind_input<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    then: impl FnOnce(&BindInput<'_, '_>) -> R,
) -> R {
    with_bind_input_and_libs(files, settings, BUNDLED_LIBS, then)
}

pub fn with_bind_input_and_provider<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    provider: &dyn SourceProvider,
    then: impl FnOnce(&BindInput<'_, '_>) -> R,
) -> R {
    with_build(BUNDLED_LIBS, files, settings, provider, |build| {
        with_loaded_bind_input(build, ProjectId::Application, then)
    })
}

pub fn with_runtime_bind_input<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&BindInput<'_, '_>) -> R,
) -> R {
    with_build_that_keeps_library_code(files, |build| {
        with_loaded_bind_input(build, ProjectId::Runtime, then)
    })
}

pub fn with_bind_input_of_test_files<R>(
    files: &[(&str, &str)],
    test_files: usize,
    preloads: usize,
    then: impl FnOnce(&BindInput<'_, '_>) -> R,
) -> R {
    let settings = default_settings();
    let mut project = TestProject::with_entry_points(files, test_files + preloads, &settings);
    project.runs_tests = true;
    project.preload_count = preloads;
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        with_loaded_bind_input(build, ProjectId::Application, then)
    })
}

pub fn with_test_run_bind_input<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&BindInput<'_, '_>) -> R,
) -> R {
    let mut project = TestProject::new(files, &default_settings());
    project.runs_tests = true;
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        with_loaded_bind_input(build, ProjectId::Application, then)
    })
}

pub(crate) fn with_loaded_build<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    with_loaded_build_and_react_compiler(files, settings, ReactCompilerMode::Disabled, then)
}

pub(crate) fn with_loaded_build_and_react_compiler<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    mode: ReactCompilerMode,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    let project = TestProject::new(files, settings).with_react_compiler(mode);
    with_loaded_project(&project, then)
}

pub(crate) fn with_loaded_test_run<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    let mut project = TestProject::new(files, settings);
    project.runs_tests = true;
    with_loaded_project(&project, then)
}

pub(crate) fn with_loaded_test_run_of_vitest<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    let mut project = TestProject::new(files, settings);
    project.runs_tests = true;
    project.entry_point_imports_vitest = true;
    with_loaded_project(&project, then)
}

pub(crate) fn with_loaded_build_and_options<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    aot: AotOptions,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    let project = TestProject::new(files, settings).with_aot_options(aot);
    with_loaded_project(&project, then)
}

fn with_loaded_project<R>(
    project: &TestProject,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    run_build(project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|build, loaded| Ok(then(build, &loaded)))
    })
}

pub(crate) fn with_project_view<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(ProgramView<'_, '_>) -> R,
) -> R {
    with_loaded_build(files, &default_settings(), |_, loaded| {
        then(loaded.project(ProjectId::Application).view())
    })
}

pub(crate) fn with_lowering_inputs<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&Files<'_>, &LoweringInputs<'_>, FileId) -> R,
) -> R {
    with_lowering_inputs_of(&TestProject::new(files, &default_settings()), then)
}

pub(crate) fn with_lowering_inputs_of_test_run<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&Files<'_>, &LoweringInputs<'_>, FileId) -> R,
) -> R {
    let mut project = TestProject::new(files, &default_settings());
    project.runs_tests = true;
    with_lowering_inputs_of(&project, then)
}

pub(crate) fn with_lowering_inputs_of_entry_that_runs_again<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&Files<'_>, &LoweringInputs<'_>, FileId) -> R,
) -> R {
    let mut project = TestProject::new(files, &default_settings());
    project.aot.entry_points_run_again = true;
    with_lowering_inputs_of(&project, then)
}

fn with_lowering_inputs_of<R>(
    project: &TestProject,
    then: impl FnOnce(&Files<'_>, &LoweringInputs<'_>, FileId) -> R,
) -> R {
    run_build(project, BUNDLED_LIBS, &WithoutServices, |build| {
        with_bound_build(build, |build, loaded, bound| {
            let application = loaded.project(ProjectId::Application);
            let roles = decide_project_roles(application);
            let entry_point = application.sources.entry_points()[0].file;
            build.with_lowering_inputs(loaded, bound, ProjectId::Application, &roles, |inputs| {
                then(application.loaded.files(), inputs, entry_point)
            })
        })
    })
}

pub fn default_settings() -> TranspileSettings {
    TranspileSettings {
        jsx: bun_sema::resolve::JsxSettings::default(),
        experimental_decorators: false,
        emits_decorator_metadata: false,
        use_define_for_class_fields: None,
        bun_run_assigns_class_fields: false,
    }
}

fn lower_application(project: &TestProject) -> Vec<(FileId, LoweredFile)> {
    run_build(project, BUNDLED_LIBS, &WithoutServices, |build| {
        lower_files(build, ProjectId::Application)
    })
}

fn link_project(project: &TestProject) -> Result<LinkedProgram, BuildFailed> {
    let mut log = Log::init();
    link_program(&project.options(BUNDLED_LIBS), &WithoutServices, &mut log)
}

fn find_replaced_runtime_sources(runtime: &Files<'_>, files: &[(&str, &str)]) -> Vec<FileId> {
    let mut replaced_sources: Vec<FileId> = files
        .iter()
        .filter_map(|&(name, _)| runtime.by_path.get(&in_memory_path(name)))
        .filter(|&file| runtime.is_compiled(file))
        .collect();
    replaced_sources.sort_unstable();
    replaced_sources.dedup();
    replaced_sources
}

fn find_files_without_early_errors(files: &[FileId], roles: &RoleDecision) -> Vec<FileId> {
    let files = files.iter().copied();
    files.filter(|&file| !roles.has_early_error(file)).collect()
}

fn lower_files(
    build: &mut Build<'_>,
    project: ProjectId,
) -> Result<Vec<(FileId, LoweredFile)>, Stage> {
    with_bound_build(build, |build, loaded, bound| {
        let files = loaded.project(project).loaded.files().compiled_files();
        let options = build.lowering_options();
        lower_project_files(build, loaded, bound, project, files, options)
    })
}

fn lower_project_files(
    build: &Build<'_>,
    loaded: &LoadedBuild<'_, '_>,
    bound: &BoundBuild,
    id: ProjectId,
    files: &[FileId],
    options: LoweringOptions,
) -> Vec<(FileId, LoweredFile)> {
    let project = loaded.project(id);
    let roles = decide_project_roles(project);
    let files_to_lower = find_files_without_early_errors(files, &roles);
    build.with_lowering_inputs(loaded, bound, id, &roles, |inputs| {
        let inputs = LoweringInputs { options, ..*inputs };
        let checked = check_and_lower(
            project.loaded,
            project.host,
            project.request,
            &roles,
            &files_to_lower,
            &|checker, file| lower_file(&inputs, checker, file),
        );
        checked.lowered
    })
}

pub(super) fn decide_project_roles(project: &LoadedProject<'_, '_>) -> RoleDecision {
    let files = project.loaded.files().compiled_files();
    decide_roles(project.loaded, project.host, project.request, files)
}

pub(super) fn with_bound_build<R>(
    build: &mut Build<'_>,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>, &BoundBuild) -> R,
) -> Result<R, Stage> {
    build.with_loaded_projects(|build, loaded| {
        let bound = build.bind_modules(&loaded)?;
        build.stop_if_errors(Stage::BindModules)?;
        Ok(then(build, &loaded, &bound))
    })
}

fn with_loaded_bind_input<R>(
    build: &mut Build<'_>,
    project: ProjectId,
    then: impl FnOnce(&BindInput<'_, '_>) -> R,
) -> Result<R, Stage> {
    build.with_loaded_projects(|build, loaded| {
        let in_parallel = build.parallel_runner();
        let beside = build.beside_runner();
        let application = loaded.project(ProjectId::Application).view();
        let library = loaded.project(ProjectId::Runtime).view();
        let deferred_exports = DeferredExports::collect(library.files(), library.sources);
        let contents = loaded.contents;
        let runs_tests = build.options.load.runs_tests;
        let known_helpers = KnownHelpers::compute_below_added_names(
            application.files(),
            &contents.names_added_to_builtins,
            &in_parallel,
        );
        let run_of_library = crate::test_runs::RunContents::default();
        let input = BindInput {
            files: application.files(),
            sources: application.sources,
            builtin_names: loaded.builtin_names,
            deferred_exports: &deferred_exports,
            known_helpers: &known_helpers,
            platform: build.platform,
            external_packages: &[],
            replaced_builtins: &contents.replaced_builtins,
            names_added_to_builtins: &contents.names_added_to_builtins,
            runs_in_place: false,
            ignores_declared_side_effects: false,
            mocks_any_module: contents.mocks_any_module,
            mocked_library_modules: &[],
            hands_on_any_module: contents.loads_by_unknown_name
                || contents.loads_by_unknown_path
                || contents.run.loader_functions_answer_requires,
            any_module_loads_again: runs_tests && contents.any_module_loads_again,
            runs_tests,
            runner_starts_entry_points: runs_tests,
            written_entry_point_count: build.options.entry_points.len(),
            entry_points_run_again: false,
            typescript_drops_absent_exports: false,
            runs_in_several_realms: false,
            files_are_named_out_of_sight: false,
            helpers_of_tests_name_files: false,
            run: &contents.run,
            in_parallel: &in_parallel,
            beside: &beside,
        };
        Ok(match project {
            ProjectId::Application => then(&input),
            ProjectId::Runtime => {
                let graph = bind_modules(&input).graph;
                let library_helpers = KnownHelpers::compute(library.files(), &in_parallel);
                then(&BindInput {
                    files: library.files(),
                    sources: library.sources,
                    known_helpers: &library_helpers,
                    mocks_any_module: false,
                    mocked_library_modules: graph.mocked_library_modules(),
                    runner_starts_entry_points: false,
                    written_entry_point_count: library.files().entry_points().len(),
                    run: &run_of_library,
                    ..input
                })
            }
        })
    })
}

fn with_build<R>(
    libs: Libs<'_>,
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    provider: &dyn SourceProvider,
    run: impl FnOnce(&mut Build<'_>) -> Result<R, Stage>,
) -> R {
    run_build(&TestProject::new(files, settings), libs, provider, run)
}

fn with_build_that_keeps_library_code<R>(
    files: &[(&str, &str)],
    run: impl FnOnce(&mut Build<'_>) -> Result<R, Stage>,
) -> R {
    let mut project = TestProject::new(files, &default_settings());
    project.keeps_library_code_without_names = true;
    run_build(&project, BUNDLED_LIBS, &WithoutServices, run)
}

pub(crate) fn set_up_output() {
    static OUTPUT: Once = Once::new();
    OUTPUT.call_once(bun_core::output::stdio::init);
}

pub(crate) fn run_build<R>(
    project: &TestProject,
    libs: Libs<'_>,
    provider: &dyn SourceProvider,
    run: impl FnOnce(&mut Build<'_>) -> Result<R, Stage>,
) -> R {
    let options = project.options(libs);
    let caches = ThreadCaches::default();
    let mut build = Build::new(&options, provider, &caches, project.limits.clone());
    build.keeps_library_code_without_names = project.keeps_library_code_without_names;
    let result = run(&mut build);
    let mut log = Log::init();
    match build.finish(result, &mut log) {
        Ok((value, _)) => value,
        Err(failed) => panic!(
            "the build failed in stage \"{}\":\n{}",
            failed.stage.name(),
            describe_messages(&log)
        ),
    }
}

pub(crate) struct TemporaryDirectory(std::path::PathBuf);

#[allow(clippy::disallowed_methods)]
impl TemporaryDirectory {
    pub(crate) fn new(name: &str) -> TemporaryDirectory {
        let name = format!("bun_aot_{name}_{}", std::process::id());
        let path = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        TemporaryDirectory(std::fs::canonicalize(&path).unwrap())
    }

    pub(crate) fn path(&self) -> &[u8] {
        self.0.as_os_str().as_encoded_bytes()
    }

    pub(crate) fn write(&self, path: &str, text: &str) {
        let path = self.0.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
}

impl Drop for TemporaryDirectory {
    #[allow(clippy::disallowed_methods)]
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn describe_messages(log: &Log) -> String {
    let mut text = String::new();
    for message in &log.msgs {
        if let Some(location) = &message.data.location {
            let file = BStr::new(&location.file);
            let _ = write!(text, "{file}:{}:{}: ", location.line, location.column);
        }
        let _ = writeln!(text, "{}", BStr::new(&message.data.text));
        for note in message.notes.iter() {
            let _ = writeln!(text, "  {}", BStr::new(&note.text));
        }
    }
    text
}

pub(crate) struct TestProject {
    pub(crate) aot: AotOptions,
    directory: Vec<u8>,
    pub(crate) entry_points: Vec<Vec<u8>>,
    in_memory_files: Vec<(Vec<u8>, Vec<u8>)>,
    limits: LimitValues,
    paths: PathOptions,
    pub(crate) root_directory: Option<&'static [u8]>,
    react_compiler: ReactCompilerMode,
    pub(crate) runs_tests: bool,
    entry_point_imports_vitest: bool,
    pub(crate) preload_count: usize,
    pub(crate) keeps_library_code_without_names: bool,
    pub(crate) builds_executable: bool,
}

impl TestProject {
    pub(crate) fn new(files: &[(&str, &str)], settings: &TranspileSettings) -> TestProject {
        TestProject::with_entry_points(files, 1, settings)
    }

    pub(crate) fn with_entry_points(
        files: &[(&str, &str)],
        entry_point_count: usize,
        settings: &TranspileSettings,
    ) -> TestProject {
        assert!(
            (1..=files.len()).contains(&entry_point_count),
            "{entry_point_count} entry points in {} files",
            files.len()
        );
        let entry_points = files[..entry_point_count].iter();
        let entry_points: Vec<&str> = entry_points.map(|&(name, _)| name).collect();
        let mut in_memory_files: Vec<(Vec<u8>, Vec<u8>)> = files
            .iter()
            .map(|(name, text)| (in_memory_path(name), text.as_bytes().to_vec()))
            .collect();
        if files.iter().all(|(name, _)| *name != CONFIGURATION_FILE) {
            let configuration = write_configuration(settings);
            in_memory_files.push((in_memory_path(CONFIGURATION_FILE), configuration));
        }
        in_memory_files.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        TestProject {
            in_memory_files,
            ..TestProject::on_disk(PROJECT_DIRECTORY, &entry_points)
        }
    }

    pub(crate) fn on_disk(directory: &[u8], entry_points: &[&str]) -> TestProject {
        set_up_output();
        let entry_points = entry_points.iter().map(|name| name.as_bytes().to_vec());
        let entry_points: Vec<Vec<u8>> = entry_points.collect();
        TestProject {
            aot: AotOptions {
                thread_count: Some(NonZeroU32::MIN),
                ..AotOptions::default()
            },
            directory: directory.to_vec(),
            entry_points: entry_points.clone(),
            in_memory_files: Vec::new(),
            limits: LimitValues::for_host(),
            paths: PathOptions {
                module_prefix: b"/$bunfs/root/".to_vec(),
                root_directory: directory.to_vec(),
                entry_point_names: entry_points,
                entry_point_file_names: Vec::new(),
            },
            root_directory: None,
            react_compiler: ReactCompilerMode::Disabled,
            runs_tests: false,
            entry_point_imports_vitest: false,
            preload_count: 0,
            keeps_library_code_without_names: false,
            builds_executable: false,
        }
    }

    fn with_aot_options(self, aot: AotOptions) -> TestProject {
        let thread_count = aot.thread_count.or(self.aot.thread_count);
        TestProject {
            aot: AotOptions {
                thread_count,
                ..aot
            },
            ..self
        }
    }

    fn with_react_compiler(self, react_compiler: ReactCompilerMode) -> TestProject {
        TestProject {
            react_compiler,
            ..self
        }
    }

    fn path_options(&self) -> PathOptions {
        let Some(root_directory) = self.root_directory else {
            return self.paths.clone();
        };
        let name_of = |entry_point: &Vec<u8>| {
            let path = [&self.directory[..], b"/", &entry_point[..]].concat();
            let name = path.strip_prefix(root_directory);
            let name = name.and_then(|name| name.strip_prefix(b"/"));
            name.expect("every entry point lies below the root directory")
                .to_vec()
        };
        PathOptions {
            root_directory: root_directory.to_vec(),
            entry_point_names: self.entry_points.iter().map(name_of).collect(),
            ..self.paths.clone()
        }
    }

    fn paths_listed_by_runner(&self) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        if !self.runs_tests {
            return (Vec::new(), Vec::new());
        }
        let path_of = |name: &Vec<u8>| [&self.directory[..], b"/", &name[..]].concat();
        let mut test_files: Vec<Vec<u8>> = self.entry_points.iter().map(path_of).collect();
        let preloads = test_files.split_off(test_files.len() - self.preload_count);
        (test_files, preloads)
    }

    pub(crate) fn options<'a>(&'a self, libs: Libs<'a>) -> Options<'a> {
        let (test_files, paths_of_preloads) = self.paths_listed_by_runner();
        Options {
            aot: &self.aot,
            executable_identity: ExecutableIdentity([0; 16]),
            image_form: None,
            entry_points: self.entry_points.clone(),
            code: CodeOptions {
                builds_executable: self.builds_executable,
                entry_points_that_run_first: (paths_of_preloads.iter())
                    .map(|path| from_native(path))
                    .collect(),
                ..CodeOptions::bun_run(&from_native(&self.directory))
            },
            typescript_libs: libs,
            load: LoadOptions {
                react_compiler: self.react_compiler,
                runs_tests: self.runs_tests,
                entry_point_imports_vitest: self.entry_point_imports_vitest,
                test_files,
                paths_of_preloads,
                in_memory_files: self.in_memory_files.clone(),
                ..LoadOptions::new(self.directory.clone())
            },
            paths: self.path_options(),
            removable: RemovableOptions::default(),
            lists_modules: false,
            minifies_identifiers: false,
        }
    }
}

fn in_memory_path(name: &str) -> Vec<u8> {
    if name.as_bytes().starts_with(VIRTUAL_ROOT) {
        return name.as_bytes().to_vec();
    }
    [PROJECT_DIRECTORY, b"/", name.as_bytes()].concat()
}

fn write_configuration(settings: &TranspileSettings) -> Vec<u8> {
    let string = |value: &[u8]| Json::String(value.to_vec());
    let dotted_name = |parts: &[Vec<u8>]| Json::String(parts.join(&b"."[..]));
    let jsx = &settings.jsx;
    let jsx_emit: &[u8] = match (jsx.runtime, jsx.is_development) {
        (JsxRuntime::Classic, _) => b"react",
        (JsxRuntime::Automatic, true) => b"react-jsxdev",
        (JsxRuntime::Automatic, false) => b"react-jsx",
    };
    let mut options = vec![
        ("lib", Json::Array(vec![string(b"ESNext")])),
        ("target", string(b"ESNext")),
        ("module", string(b"Preserve")),
        ("moduleDetection", string(b"force")),
        ("jsx", string(jsx_emit)),
        ("allowJs", Json::Bool(true)),
        ("moduleResolution", string(b"bundler")),
        ("allowImportingTsExtensions", Json::Bool(true)),
        ("noEmit", Json::Bool(true)),
        ("strict", Json::Bool(true)),
        ("skipLibCheck", Json::Bool(true)),
    ];
    match jsx.runtime {
        JsxRuntime::Classic => {
            options.push(("jsxFactory", dotted_name(&jsx.factory)));
            options.push(("jsxFragmentFactory", dotted_name(&jsx.fragment)));
        }
        JsxRuntime::Automatic => options.push(("jsxImportSource", string(&jsx.import_source))),
    }
    options.extend([
        (
            "experimentalDecorators",
            Json::Bool(settings.experimental_decorators),
        ),
        (
            "emitDecoratorMetadata",
            Json::Bool(settings.emits_decorator_metadata),
        ),
    ]);
    if let Some(uses_define) = settings.use_define_for_class_fields {
        options.push(("useDefineForClassFields", Json::Bool(uses_define)));
    }
    let options = options
        .into_iter()
        .map(|(name, value)| (name.as_bytes().to_vec(), value))
        .collect();
    let compiler_options = (b"compilerOptions".to_vec(), Json::Object(options));
    let mut text = Vec::new();
    Json::Object(vec![compiler_options]).stringify(&mut text);
    text
}
