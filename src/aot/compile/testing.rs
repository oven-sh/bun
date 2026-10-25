#[cfg(test)]
mod tests;

use super::lower_stage::find_files_to_lower;
use super::{BoundBuild, Build, LoadedBuild, LoadedProject};
#[cfg(test)]
use super::{BuildFailed, LinkedProgram, link_program};
#[cfg(test)]
use crate::diagnostics::ProgramView;
use crate::engine::ExecutableIdentity;
#[cfg(test)]
use crate::ir::Program;
use crate::known_helpers::KnownHelpers;
#[cfg(test)]
use crate::link::ProgramNames;
use crate::load::ProjectId;
use crate::load::source_provider::{SourceProvider, WithoutServices};
#[cfg(test)]
use crate::lower::LeftOutDeclarations;
use crate::lower::{LoweredFile, LoweringInputs, LoweringOptions, lower_file};
use crate::modules::{BindInput, DeferredExports};
use crate::options::{LoadOptions, Options, PathOptions, RemovableOptions};
use crate::statistics::{LimitValues, Stage};
use bstr::BStr;
use bun_ast::Log;
use bun_ast::runtime::ReactCompilerMode;
use bun_builtin_sources::VIRTUAL_ROOT;
use bun_options_types::aot_options::AotOptions;
use bun_sema::json::Json;
use bun_sema::program::FileId;
#[cfg(test)]
use bun_sema::program::Files;
use bun_sema::resolve::{CodeOptions, JsxRuntime, TranspileSettings};
use bun_sema_driver::host::from_native;
use bun_sema_driver::{Libs, RoleDecision, ThreadCaches, check_and_lower, decide_roles};
use std::fmt::Write;
use std::num::NonZeroU32;
use std::sync::Once;

const PROJECT_DIRECTORY: &[u8] = b"/project";
const CONFIGURATION_FILE: &str = "tsconfig.json";

#[cfg(test)]
pub(super) const BUNDLED_LIBS: Libs<'static> = Libs::Bundled(bun_sema_standalone::TYPESCRIPT_LIBS);

#[cfg(test)]
pub(crate) const TYPED_PACKAGE_JSON: &str = r#"{"name":"p","version":"1.0.0","type":"module","exports":{"aot":"./x.aot.ts","default":"./x.js"}}"#;

pub fn lower_program_with_libs(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    libs: Libs<'_>,
) -> Vec<(FileId, LoweredFile)> {
    with_build(libs, files, settings, &WithoutServices, |build| {
        lower_files(build, ProjectId::Application)
    })
}

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

#[cfg(test)]
pub fn lower_program(
    files: &[(&str, &str)],
    options: LoweringOptions,
) -> Vec<(FileId, LoweredFile)> {
    let settings = default_settings();
    with_build(BUNDLED_LIBS, files, &settings, &WithoutServices, |build| {
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

#[cfg(test)]
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
            let files_to_lower = find_files_to_lower(compiled_files, &roles);
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

#[cfg(test)]
pub fn lower_program_with_settings(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
) -> Vec<(FileId, LoweredFile)> {
    lower_program_with_provider(files, settings, &WithoutServices)
}

#[cfg(test)]
pub fn lower_program_with_provider(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    provider: &dyn SourceProvider,
) -> Vec<(FileId, LoweredFile)> {
    with_build(BUNDLED_LIBS, files, settings, provider, |build| {
        lower_files(build, ProjectId::Application)
    })
}

#[cfg(test)]
pub fn lower_program_with_limits(
    files: &[(&str, &str)],
    limits: LimitValues,
) -> Vec<(FileId, LoweredFile)> {
    let project = TestProject::new(files, &default_settings());
    lower_application(&TestProject { limits, ..project })
}

#[cfg(test)]
pub fn lower_and_link_program<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    then: impl FnOnce(&Program, &ProgramNames) -> R,
) -> R {
    with_build(BUNDLED_LIBS, files, settings, &WithoutServices, |build| {
        let output = build.with_loaded_projects(|build, loaded| {
            let bound = build.bind_modules(&loaded)?;
            build.stop_if_errors(Stage::BindModules)?;
            let units = build.check_and_lower(&loaded, &bound);
            build.link(loaded, bound, units)
        })?;
        Ok(then(&output.program, &output.names))
    })
}

#[cfg(test)]
pub fn link_program_with_react_compiler(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    mode: ReactCompilerMode,
) -> Result<LinkedProgram, BuildFailed> {
    link_project(&TestProject::new(files, settings).with_react_compiler(mode))
}

#[cfg(test)]
pub fn with_bind_input<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    then: impl FnOnce(&BindInput<'_, '_>) -> R,
) -> R {
    with_bind_input_and_libs(files, settings, BUNDLED_LIBS, then)
}

#[cfg(test)]
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

#[cfg(test)]
pub fn with_runtime_bind_input<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&BindInput<'_, '_>) -> R,
) -> R {
    let settings = default_settings();
    with_build(BUNDLED_LIBS, files, &settings, &WithoutServices, |build| {
        with_loaded_bind_input(build, ProjectId::Runtime, then)
    })
}

#[cfg(test)]
pub(crate) fn with_loaded_build<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    with_loaded_build_and_react_compiler(files, settings, ReactCompilerMode::Disabled, then)
}

#[cfg(test)]
pub(crate) fn with_loaded_build_and_react_compiler<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    mode: ReactCompilerMode,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    let project = TestProject::new(files, settings).with_react_compiler(mode);
    with_loaded_project(&project, then)
}

#[cfg(test)]
pub(crate) fn with_loaded_test_run<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    let mut project = TestProject::new(files, settings);
    project.runs_tests = true;
    with_loaded_project(&project, then)
}

#[cfg(test)]
pub(crate) fn with_loaded_build_and_options<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    aot: AotOptions,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    let project = TestProject::new(files, settings).with_aot_options(aot);
    with_loaded_project(&project, then)
}

#[cfg(test)]
fn with_loaded_project<R>(
    project: &TestProject,
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>) -> R,
) -> R {
    run_build(project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|build, loaded| Ok(then(build, &loaded)))
    })
}

#[cfg(test)]
pub(crate) fn with_project_view<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(ProgramView<'_, '_>) -> R,
) -> R {
    with_loaded_build(files, &default_settings(), |_, loaded| {
        then(loaded.project(ProjectId::Application).view())
    })
}

#[cfg(test)]
pub(crate) fn with_lowering_inputs<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&Files<'_>, &LoweringInputs<'_>, FileId) -> R,
) -> R {
    let settings = default_settings();
    with_build(BUNDLED_LIBS, files, &settings, &WithoutServices, |build| {
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

#[cfg(test)]
pub fn default_settings() -> TranspileSettings {
    TranspileSettings {
        jsx: bun_sema::resolve::JsxSettings::default(),
        experimental_decorators: false,
        emits_decorator_metadata: false,
        use_define_for_class_fields: None,
    }
}

#[cfg(test)]
fn lower_application(project: &TestProject) -> Vec<(FileId, LoweredFile)> {
    run_build(project, BUNDLED_LIBS, &WithoutServices, |build| {
        lower_files(build, ProjectId::Application)
    })
}

#[cfg(test)]
fn link_project(project: &TestProject) -> Result<LinkedProgram, BuildFailed> {
    let mut log = Log::init();
    link_program(&project.options(BUNDLED_LIBS), &WithoutServices, &mut log)
}

#[cfg(test)]
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
    bound: &BoundBuild<'_>,
    id: ProjectId,
    files: &[FileId],
    options: LoweringOptions,
) -> Vec<(FileId, LoweredFile)> {
    let project = loaded.project(id);
    let roles = decide_project_roles(project);
    let files_to_lower = find_files_to_lower(files, &roles);
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
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>, &BoundBuild<'s>) -> R,
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
        let view = loaded.project(project).view();
        let known_helpers = KnownHelpers::compute(view.files(), &in_parallel);
        let library = loaded.project(ProjectId::Runtime).view();
        let deferred_exports = DeferredExports::collect(library.files(), library.sources);
        Ok(then(&BindInput {
            files: view.files(),
            sources: view.sources,
            builtin_names: loaded.builtin_names,
            deferred_exports: &deferred_exports,
            platform: build.platform,
            external_packages: &[],
            application: None,
            known_helpers: &known_helpers,
            in_parallel: &in_parallel,
        }))
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

pub(crate) fn set_up_output() {
    static OUTPUT: Once = Once::new();
    // A thread of Bun's pool asserts that Bun's `main` has set up the output.
    OUTPUT.call_once(bun_core::output::stdio::init);
}

pub(super) fn run_build<R>(
    project: &TestProject,
    libs: Libs<'_>,
    provider: &dyn SourceProvider,
    run: impl FnOnce(&mut Build<'_>) -> Result<R, Stage>,
) -> R {
    let options = project.options(libs);
    let caches = ThreadCaches::default();
    let mut build = Build::new(&options, provider, &caches, project.limits.clone());
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

#[cfg(test)]
pub(crate) struct TemporaryDirectory(std::path::PathBuf);

#[cfg(test)]
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

    pub(crate) fn write_typed_package(&self, installed: &str, typed: &str) {
        self.write("node_modules/p/package.json", TYPED_PACKAGE_JSON);
        self.write("node_modules/p/x.js", installed);
        self.write("node_modules/p/x.aot.ts", typed);
    }
}

#[cfg(test)]
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

pub(super) struct TestProject {
    pub(super) aot: AotOptions,
    directory: Vec<u8>,
    pub(super) entry_points: Vec<Vec<u8>>,
    in_memory_files: Vec<(Vec<u8>, Vec<u8>)>,
    limits: LimitValues,
    paths: PathOptions,
    react_compiler: ReactCompilerMode,
    runs_tests: bool,
}

impl TestProject {
    pub(super) fn new(files: &[(&str, &str)], settings: &TranspileSettings) -> TestProject {
        TestProject::with_entry_points(files, 1, settings)
    }

    pub(super) fn with_entry_points(
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

    pub(super) fn on_disk(directory: &[u8], entry_points: &[&str]) -> TestProject {
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
            },
            react_compiler: ReactCompilerMode::Disabled,
            runs_tests: false,
        }
    }

    #[cfg(test)]
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

    #[cfg(test)]
    fn with_react_compiler(self, react_compiler: ReactCompilerMode) -> TestProject {
        TestProject {
            react_compiler,
            ..self
        }
    }

    pub(super) fn options<'a>(&'a self, libs: Libs<'a>) -> Options<'a> {
        Options {
            aot: &self.aot,
            executable_identity: ExecutableIdentity([0; 16]),
            image_form: None,
            entry_points: self.entry_points.clone(),
            code: CodeOptions::bun_run(&from_native(&self.directory)),
            typescript_libs: libs,
            load: LoadOptions {
                react_compiler: self.react_compiler,
                runs_tests: self.runs_tests,
                in_memory_files: self.in_memory_files.clone(),
                ..LoadOptions::new(self.directory.clone())
            },
            paths: self.paths.clone(),
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
