#![allow(clippy::result_large_err, reason = "a build fails at most once")]

#[cfg(test)]
mod barrel_tests;
mod bind_stage;
#[cfg(test)]
mod imported_constant_tests;
#[cfg(test)]
mod known_member_tests;
mod link_stage;
mod load_stage;
mod lower_stage;
mod module_list;
#[cfg(test)]
mod module_reach_tests;
#[cfg(test)]
mod paths;
mod program_reach;
pub(crate) mod removable;
pub(crate) mod runtime_reach;
#[cfg(test)]
mod runtime_reach_tests;
mod summary;
#[cfg(test)]
pub mod testing;
#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) use self::lower_stage::collect_file_inputs;
#[cfg(test)]
pub use self::paths::{EntryPointPaths, FolderPaths, FollowedName};
#[cfg(not(test))]
pub use bun_aot_interface::compile::{EntryPointPaths, FolderPaths, FollowedName};

use self::load_stage::AssetReads;
use self::module_list::ListedModules;
use self::program_reach::LeftOutCode;
use self::runtime_reach::KnownRegions;
use crate::builtins::{BuiltinNames, Platforms, RuntimeFunction, table};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, Diagnostics, InternalError, LoadMessages, ProgramView};
use crate::emit::{
    FunctionsWithoutCode, ProgramBytes, emit_with_bodies_in_bytes, emit_with_external_bodies,
};
use crate::engine::{self, EngineOptions, EngineRequest, EngineResult, position_of};
use crate::ir::generated::{UnseenCodeCause, Witness};
use crate::ir::{Id, ModuleId, Program};
use crate::known_helpers::KnownHelpers;
use crate::link::{Leftovers, LinkedFunctions, run_beside, run_one_after_the_other};
use crate::load::contents::ProgramContents;
use crate::load::contents::entry_points::{join_below_root, name_from_working_directory};
use crate::load::contents::worker_entries::{find_file_named_as_in_executable, source_path_of};
use crate::load::source_provider::SourceProvider;
use crate::load::{PerProject, ProjectId, Sources, host_platform};
use crate::module_keys::is_name_of_text;
use crate::module_list::ModuleList;
use crate::modules::ModuleGraph;
use crate::options::{Options, PathOptions};
use crate::report::{ModuleOrigin, SourceTexts};
use crate::statistics::{
    LimitValues, Stage, StageClock, Statistics, log_part_of_time_outside_stages,
    log_time_outside_stages,
};
use bun_ast::Log;
use bun_options_types::aot_options::TargetPlatform;
use bun_sema::atom::Interner;
use bun_sema::check::aot::BuiltinTypeSymbols;
use bun_sema::program::FileId;
use bun_sema::resolve::CodeHost;
use bun_sema::session::Session;
use bun_sema_driver::{
    ChosenThreads, CompileRequest, LoadedProgram, ThreadCaches, drop_thread_caches,
    for_each_parallel_in_runs, run_on_one_thread_while,
};
use bun_sys::{Fd, File};
use core::fmt;
use core::time::Duration;
use std::num::NonZeroUsize;
use std::time::Instant;

pub struct ProgramSummary {
    pub entry_points: Vec<EntryPointPaths>,
    pub folders: Vec<FolderPaths>,
    pub texts: SourceTexts,
    pub statistics: Statistics,
    pub modules: Option<ModuleList>,
}

pub struct LinkedProgram {
    pub program: Program,
    pub summary: ProgramSummary,
}

pub struct Compilation {
    pub engine: EngineResult,
    pub summary: ProgramSummary,
    #[cfg(not(test))]
    pub(crate) started_workers: StartedWorkers,
    #[cfg(not(test))]
    pub(crate) holds_source_paths: bool,
    #[cfg(not(test))]
    pub(crate) names_added_to_builtins: Vec<(u32, Vec<u8>)>,
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub(crate) enum CodeOfWorkers {
    #[default]
    NoneNamed,
    Compiled,
    Unseen,
}

#[derive(Default)]
pub(crate) struct StartedWorkers {
    pub root_folders_spelled: Vec<u8>,
    pub program_files: Vec<EntryPointPaths>,
    pub code: CodeOfWorkers,
    pub names: Vec<EntryPointPaths>,
    pub named_at: Vec<(Vec<u8>, u32)>,
    pub names_followed: Vec<FollowedName>,
    pub names_plugin: bool,
}

pub struct BuildFailed {
    pub stage: Stage,
    pub is_internal_error: bool,
    pub statistics: Statistics,
    pub compilation: Option<Box<Compilation>>,
}

impl fmt::Debug for BuildFailed {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BuildFailed")
            .field("stage", &self.stage)
            .field("is_internal_error", &self.is_internal_error)
            .field("has_compilation", &self.compilation.is_some())
            .finish_non_exhaustive()
    }
}

pub(crate) struct Build<'a> {
    options: &'a Options<'a>,
    provider: &'a dyn SourceProvider,
    caches: &'a ThreadCaches,
    threads: NonZeroUsize,
    chosen_threads: Option<ChosenThreads>,
    platform: Platforms,
    limits: LimitValues,
    pub(crate) diagnostics: Diagnostics,
    clock: StageClock,
    statistics: Statistics,
    retired_sessions: Vec<Session>,
    leftovers: Vec<Leftovers>,
    paths_of_modules_without_bodies: Vec<(usize, Vec<u8>)>,
    unreached_runtime_files: Vec<FileId>,
    circular_runtime_files: Vec<(FileId, u32)>,
    written_function_names: Vec<u8>,
    pub(crate) started_workers: StartedWorkers,
    pub(crate) stays_in_compiled_files: bool,
    keeps_library_code_without_names: bool,
    hands_code_over_beside_program: bool,
}

pub(crate) struct LoadedProject<'b, 's> {
    pub loaded: &'b LoadedProgram<'s>,
    pub host: &'b dyn CodeHost,
    pub request: &'b CompileRequest<'b, 's>,
    pub sources: Sources,
}

pub(crate) struct LoadedBuild<'b, 's> {
    pub projects: PerProject<LoadedProject<'b, 's>>,
    pub atoms: Interner<'s>,
    pub messages: &'b LoadMessages,
    pub builtin_names: &'b BuiltinNames,
    pub contents: &'b ProgramContents,
    pub can_load_code_at_run_time: bool,
    pub loads_code_by_unknown_names_alone: bool,
    pub keeps_library_code_without_names: bool,
    pub holds_what_unseen_code_finds: bool,
    pub finish_asset_reads: &'b dyn Fn(),
    pub known_library_regions: &'b dyn Fn() -> Option<KnownRegions>,
}

pub(crate) struct BoundProject {
    pub graph: ModuleGraph,
    pub left_out: LeftOutCode,
    pub known_helpers: KnownHelpers,
    pub builtin_types: BuiltinTypeSymbols,
    pub page_manifests: Vec<(FileId, Vec<u8>)>,
}

pub(crate) struct BoundBuild {
    pub projects: PerProject<BoundProject>,
}

fn put_function_texts_into(program: &mut Program, texts: &SourceTexts) {
    for (index, module) in program.modules.iter_mut().enumerate() {
        if let Some(source) = texts.get(ModuleId::new(index)) {
            module.function_text = source.function_text();
        }
    }
}

#[cfg(not(test))]
fn collect_names_added_to_builtins(program: &Program) -> Vec<(u32, Vec<u8>)> {
    let opened = program.opened_names.iter();
    opened
        .map(|opened| {
            let name = program.strings.get(opened.name);
            (opened.holder.to_wire(), name.to_vec())
        })
        .collect()
}

struct FrontEndOutput {
    program: Program,
    functions: LinkedFunctions,
    functions_without_code: Option<FunctionsWithoutCode>,
    texts: SourceTexts,
    entry_points: Vec<EntryPointPaths>,
    folders: Vec<FolderPaths>,
    #[cfg(not(test))]
    holds_source_paths: bool,
    modules: Option<ListedModules>,
}

impl FrontEndOutput {
    fn take_functions(&mut self) -> LinkedFunctions {
        let none = LinkedFunctions::of_program_functions(Vec::new());
        core::mem::replace(&mut self.functions, none)
    }

    fn into_parts(
        self,
        statistics: Statistics,
        engine: Option<&EngineResult>,
    ) -> (Program, ProgramSummary) {
        let bytes_by_module = engine.map_or(&[][..], EngineResult::bytes_by_module);
        let summary = ProgramSummary {
            entry_points: self.entry_points,
            folders: self.folders,
            texts: self.texts,
            statistics,
            modules: self.modules.map(|modules| modules.finish(bytes_by_module)),
        };
        (self.program, summary)
    }
}

impl<'s> LoadedProject<'_, 's> {
    pub(crate) fn view(&self) -> ProgramView<'_, 's> {
        ProgramView {
            loaded: self.loaded,
            sources: &self.sources,
        }
    }
}

impl<'b, 's> LoadedBuild<'b, 's> {
    pub(crate) fn project(&self, project: ProjectId) -> &LoadedProject<'b, 's> {
        self.projects.get(project)
    }
}

pub fn link_program(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<LinkedProgram, BuildFailed> {
    let caches = ThreadCaches::default();
    let mut build = Build::new(options, provider, &caches, LimitValues::for_host());
    let result = build.run_front_end().map(|mut output| {
        let functions = output.take_functions();
        output.program.functions = functions.into_program_functions(&build.parallel_runner());
        output
    });
    let (output, statistics) = build.finish(result, log)?;
    let (program, summary) = output.into_parts(statistics, None);
    Ok(LinkedProgram { program, summary })
}

fn starts_workers_out_of_sight(engine: &EngineResult) -> bool {
    let mut causes = engine.unseen_code().iter().map(|record| record.cause);
    causes.any(|cause| {
        cause == UnseenCodeCause::FlowResultDisabled || cause == UnseenCodeCause::OptionAdmitsCode
    })
}

fn collect_paths_of_modules_without_bodies(program: &Program) -> Vec<(usize, Vec<u8>)> {
    let modules = program.modules.iter().enumerate();
    modules
        .filter(|(_, module)| module.body.is_none())
        .map(|(index, module)| (index, program.strings.get(module.path).to_vec()))
        .collect()
}

fn describe_library_modules_lacked(
    engine: &EngineResult,
    paths_of_modules_without_bodies: &[(usize, Vec<u8>)],
) -> Option<String> {
    let mut names: Vec<String> = Vec::new();
    for record in engine.library_modules_lacked() {
        let module = record.module_id().index();
        let found = paths_of_modules_without_bodies.binary_search_by_key(&module, |entry| entry.0);
        names.push(match found {
            Ok(at) => bstr::BStr::new(&paths_of_modules_without_bodies[at].1).to_string(),
            Err(_) => format!("number {}", record.module),
        });
    }
    if names.is_empty() {
        return None;
    }
    Some(format!(
        "the program evaluates modules of Bun's library that the load has left out: {}",
        names.join(", ")
    ))
}

fn is_relative_path(path: &[u8]) -> bool {
    path.starts_with(b"./") || path.starts_with(b"../")
}

fn names_one_of<'f>(
    name: &[u8],
    mut files: impl Iterator<Item = &'f EntryPointPaths>,
    paths: &PathOptions,
) -> bool {
    let below_root = [&paths.module_prefix[..], name].concat();
    let on_disk = find_file_named_as_in_executable(paths, name)
        .or_else(|| find_file_named_as_in_executable(paths, &below_root))
        .map(|path| source_path_of(&path));
    let looked_under = match is_relative_path(name) {
        true => {
            let root = paths.module_prefix.iter();
            let root: Vec<u8> = root
                .map(|&byte| if byte == b'\\' { b'/' } else { byte })
                .collect();
            vec![
                join_below_root(&root, name),
                name_from_working_directory(name),
            ]
        }
        false => Vec::new(),
    };
    files.any(|file| {
        file.public_path == name
            || file.source_path == name
            || Some(&file.source_path) == on_disk.as_ref()
            || looked_under.contains(&file.public_path)
    })
}

pub fn compile(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Compilation, BuildFailed> {
    bun_threading::thread_pool::exit_without_any_thread();
    let request = EngineRequest {
        options: options.aot,
        identity: options.executable_identity,
        image_form: options.image_form,
        thread_count: options.thread_count(),
    };
    let mut engine_options = match EngineOptions::new(&request) {
        Ok(engine_options) => engine_options,
        Err(rejected) => {
            let mut diagnostics = Diagnostics::new();
            diagnostics.add_internal_error(InternalError {
                stage: Stage::Any,
                message: rejected.sentence,
            });
            return Err(fail(Stage::Any, diagnostics, Statistics::default(), log));
        }
    };
    let caches = ThreadCaches::default();
    let mut build = Build::new(options, provider, &caches, engine_options.limit_values());
    build.hands_code_over_beside_program = options.aot.ir_output_path.is_none();
    let output = match build.run_front_end() {
        Ok(output) => output,
        Err(stage) => return Err(build.finish::<()>(Err(stage), log).unwrap_err()),
    };
    #[cfg(not(test))]
    let names_added_to_builtins = collect_names_added_to_builtins(&output.program);
    let (bytes, output) = match build.emit(output) {
        Ok(emitted) => emitted,
        Err(stage) => return Err(build.finish::<()>(Err(stage), log).unwrap_err()),
    };
    if options.aot.checks_only {
        engine_options.check_only();
    }
    if build.stays_in_compiled_files {
        engine_options.refuse_code_outside_image();
    }
    engine_options.limit_threads(build.threads_of_engine(&bytes));
    let engine = build.run_engine(bytes, &engine_options, &output);
    build.finish_started_workers(&engine, &output);
    let has_errors = build.diagnostics.has_errors();
    let is_internal_error = build.diagnostics.has_internal_errors();
    #[cfg(not(test))]
    let started_workers = core::mem::take(&mut build.started_workers);
    build.clock.add_to(&mut build.statistics);
    build.diagnostics.write_to(log);
    let statistics = build.statistics;
    #[cfg(not(test))]
    let holds_source_paths = output.holds_source_paths;
    let (_, summary) = output.into_parts(statistics.clone(), Some(&engine));
    let compilation = Compilation {
        engine,
        summary,
        #[cfg(not(test))]
        started_workers,
        #[cfg(not(test))]
        holds_source_paths,
        #[cfg(not(test))]
        names_added_to_builtins,
    };
    match has_errors {
        false => Ok(compilation),
        true => Err(BuildFailed {
            stage: Stage::Any,
            is_internal_error,
            statistics,
            compilation: Some(Box::new(compilation)),
        }),
    }
}

fn fail(
    stage: Stage,
    diagnostics: Diagnostics,
    statistics: Statistics,
    log: &mut Log,
) -> BuildFailed {
    let is_internal_error = diagnostics.has_internal_errors();
    diagnostics.write_to(log);
    BuildFailed {
        stage,
        is_internal_error,
        statistics,
        compilation: None,
    }
}

impl<'a> Build<'a> {
    pub(crate) fn new(
        options: &'a Options<'a>,
        provider: &'a dyn SourceProvider,
        caches: &'a ThreadCaches,
        limits: LimitValues,
    ) -> Build<'a> {
        options.debug_assert_valid();
        Build {
            options,
            provider,
            caches,
            threads: options.thread_count(),
            chosen_threads: None,
            platform: match options.aot.platform {
                None => host_platform(),
                Some(TargetPlatform::Darwin) => Platforms::DARWIN,
                Some(TargetPlatform::Linux) => Platforms::LINUX,
                Some(TargetPlatform::Windows) => Platforms::WINDOWS,
            },
            limits,
            diagnostics: Diagnostics::new(),
            clock: StageClock::new(),
            statistics: Statistics::default(),
            retired_sessions: Vec::new(),
            leftovers: Vec::new(),
            paths_of_modules_without_bodies: Vec::new(),
            unreached_runtime_files: Vec::new(),
            circular_runtime_files: Vec::new(),
            written_function_names: Vec::new(),
            started_workers: StartedWorkers::default(),
            stays_in_compiled_files: false,
            keeps_library_code_without_names: false,
            hands_code_over_beside_program: false,
        }
    }

    fn run_front_end(&mut self) -> Result<FrontEndOutput, Stage> {
        let mut steps_behind_link = None;
        let output = self.load_in_new_sessions(AssetReads::FinishedLater, &mut |build, loaded| {
            build.keeps_library_code_without_names = loaded.keeps_library_code_without_names;
            let bound = build.bind_modules(&loaded)?;
            build.stop_if_errors(Stage::BindModules)?;
            let units = build.check_and_lower(&loaded, &bound);
            (loaded.finish_asset_reads)();
            build.diagnostics.add_load_messages(loaded.messages);
            build.stop_if_errors(Stage::Lower)?;
            let output = build.link(loaded, bound, units);
            steps_behind_link = Some(crate::statistics::StepClock::new(Stage::LinkAndEmit));
            output
        });
        drop_thread_caches(self.caches);
        if let Some(steps) = &mut steps_behind_link {
            steps.end("what the load drops behind the link");
        }
        output
    }

    fn emit(
        &mut self,
        mut output: FrontEndOutput,
    ) -> Result<(ProgramBytes, FrontEndOutput), Stage> {
        let mut program = core::mem::take(&mut output.program);
        self.paths_of_modules_without_bodies = collect_paths_of_modules_without_bodies(&program);
        let functions = output.take_functions();
        let functions_without_code = output.functions_without_code.take();
        let function_count = match &functions_without_code {
            Some(functions) => functions.function_count(),
            None => functions.function_count(),
        };
        let bodies = program.modules.iter().filter_map(|module| module.body);
        let of_library = program.runtime_functions.iter().map(|entry| entry.function);
        let mut named = bodies.chain(of_library);
        if named.any(|function| function.index() >= function_count) {
            self.diagnostics.add_internal_error(InternalError {
                stage: Stage::LinkAndEmit,
                message: b"the program names a function that the link has not handed over".to_vec(),
            });
            return Err(Stage::LinkAndEmit);
        }
        let in_parallel = self.parallel_runner();
        let sessions = core::mem::take(&mut self.retired_sessions);
        let runner_of_drops = self.parallel_runner();
        let writes_program_file = self.options.aot.ir_output_path.is_some();
        let texts = &output.texts;
        let mut steps = crate::statistics::StepClock::new(Stage::LinkAndEmit);
        let ((), emitted) = crate::link::run_steps_beside(
            &self.beside_runner(),
            &mut steps,
            ["drop the sessions", "emit"],
            move || {
                for session in sessions {
                    session.drop_in_parallel(&runner_of_drops);
                }
            },
            || match writes_program_file {
                true => {
                    put_function_texts_into(&mut program, texts);
                    let functions = functions.into_program_functions(&in_parallel);
                    let functions = LinkedFunctions::of_program_functions(functions);
                    emit_with_bodies_in_bytes(&mut program, functions, &in_parallel)
                }
                false => {
                    let functions = functions_without_code
                        .unwrap_or_else(|| FunctionsWithoutCode::new(functions, &in_parallel));
                    emit_with_external_bodies(&mut program, functions, &in_parallel)
                }
            },
        );
        self.leftovers.push(Box::new(program));
        drop_thread_caches(self.caches);
        steps.end("what the threads drop behind emit");
        match emitted {
            Ok(bytes) => {
                self.write_program_file(&bytes)?;
                steps.end("write the program to a file, if asked");
                Ok((bytes, output))
            }
            Err(error) => {
                self.diagnostics.add_emit_error(error);
                Err(Stage::LinkAndEmit)
            }
        }
    }

    fn write_program_file(&mut self, bytes: &ProgramBytes) -> Result<(), Stage> {
        let Some(path) = self.options.aot.ir_output_path.as_deref() else {
            return Ok(());
        };
        let file = File::create(Fd::cwd(), path, true);
        let Err(error) = file.and_then(|file| file.write_all(bytes.as_slice())) else {
            return Ok(());
        };
        let reason = error.to_string();
        let arguments = [path, reason.as_bytes()];
        let diagnostic = Diagnostic::new(Code::OutputNotWritten, None, &arguments);
        self.diagnostics.add(None, diagnostic);
        Err(Stage::LinkAndEmit)
    }

    fn threads_of_engine(&self, bytes: &ProgramBytes) -> NonZeroUsize {
        const PROGRAM_BYTES_PER_THREAD: usize = 256 << 10;
        let useful = bytes
            .size_with_external_bodies()
            .div_ceil(PROGRAM_BYTES_PER_THREAD);
        let useful = NonZeroUsize::new(useful).unwrap_or(NonZeroUsize::MIN);
        match self.options.aot.thread_count {
            Some(_) => self.threads,
            None => self.threads.min(useful),
        }
    }

    fn run_engine(
        &mut self,
        bytes: ProgramBytes,
        engine_options: &EngineOptions,
        output: &FrontEndOutput,
    ) -> EngineResult {
        if self.options.aot.thread_count.is_none() {
            bun_sema_driver::allow_threads(self.threads_of_engine(&bytes));
        }
        let leftovers = core::mem::take(&mut self.leftovers);
        let beside = self.beside_runner();
        let clock = &mut self.clock;
        let ((), (engine, time_in_engine)) = run_beside(
            &beside,
            move || drop(leftovers),
            || {
                clock.stop();
                let entered = Instant::now();
                let engine = engine::compile(bytes, engine_options, &output.texts);
                (engine, entered.elapsed())
            },
        );
        log_time_outside_stages("the engine");
        let times_of_stages = Stage::ALL.into_iter().map(|stage| stage.time() as usize);
        let nanoseconds_in_stages: u64 = times_of_stages
            .filter_map(|time| engine.statistics().get(time))
            .sum();
        log_part_of_time_outside_stages(
            "the engine: outside its stages",
            time_in_engine.saturating_sub(Duration::from_nanos(nanoseconds_in_stages)),
        );
        crate::test_run_report::say_code_that_build_does_not_see(&engine);
        self.statistics.add_values(engine.statistics());
        self.diagnostics
            .add_engine_records(&engine, &output.texts, self.options.aot.runs_tests);
        self.report_library_functions_lacked(&engine);
        self.report_library_modules_lacked(&engine);
        if engine_options.makes_image()
            && engine.image().is_none()
            && !self.diagnostics.has_errors()
        {
            self.diagnostics.add_internal_error(InternalError {
                stage: Stage::Any,
                message: b"the engine returned neither an image nor an error".to_vec(),
            });
        }
        engine
    }

    fn report_library_functions_lacked(&mut self, engine: &EngineResult) {
        if self.options.load.omits_builtin_modules {
            return;
        }
        let platform = self.platform;
        let holds_named_functions_of_host_alone = self.keeps_library_code_without_names;
        let lacked = engine.library_functions_lacked().iter();
        let lacked = lacked.map(|record| RuntimeFunction(record.function));
        let names: Vec<String> = lacked
            .filter_map(|function| match table::runtime_function(function) {
                Some(data) if !data.platforms.contains(platform) => None,
                Some(data)
                    if holds_named_functions_of_host_alone
                        && data.role == table::RuntimeFunctionRole::HostBuiltin =>
                {
                    None
                }
                Some(data) => Some(format!("{} of {}", data.export_name, data.file)),
                None => Some(format!("number {}", function.0)),
            })
            .collect();
        if names.is_empty() {
            return;
        }
        let message = format!(
            "the program enters functions of Bun's library that the load has left out: {}",
            names.join(", ")
        );
        self.diagnostics.add_internal_error(InternalError {
            stage: Stage::Load,
            message: message.into_bytes(),
        });
    }

    fn report_library_modules_lacked(&mut self, engine: &EngineResult) {
        if self.options.load.omits_builtin_modules {
            return;
        }
        let paths = &self.paths_of_modules_without_bodies;
        let Some(message) = describe_library_modules_lacked(engine, paths) else {
            return;
        };
        self.diagnostics.add_internal_error(InternalError {
            stage: Stage::Load,
            message: message.into_bytes(),
        });
    }

    fn is_start_followed_by_load(&self, witness: &Witness, texts: &SourceTexts) -> bool {
        let Some(position) = position_of(witness.location) else {
            return false;
        };
        if texts.origin(position.module) == ModuleOrigin::Runtime {
            return true;
        }
        let path = texts.path(position.module);
        let mut named_at = self.started_workers.named_at.iter();
        named_at.any(|place| place.0 == path && place.1 == position.offset)
    }

    fn finish_started_workers(&mut self, engine: &EngineResult, output: &FrontEndOutput) {
        let options = self.options;
        if starts_workers_out_of_sight(engine) {
            self.started_workers.code = CodeOfWorkers::Unseen;
        }
        for record in engine.worker_starts_without_name() {
            if self.is_start_followed_by_load(&record.witness, &output.texts) {
                continue;
            }
            self.started_workers.code = CodeOfWorkers::Unseen;
            self.diagnostics
                .add_worker_start_without_name(&record.witness, &output.texts);
        }
        if options.aot.checks_only {
            return;
        }
        for record in engine.worker_entries() {
            let name = engine.text(record.path);
            let compiled = output
                .entry_points
                .iter()
                .chain(&self.started_workers.names);
            if names_one_of(name, compiled, &options.paths) {
                continue;
            }
            self.started_workers.code = CodeOfWorkers::Unseen;
            let (code, arguments): (Code, &[&[u8]]) = match is_name_of_text(name) {
                true => (Code::WorkerTextNotCompiled, &[]),
                false => (Code::WorkerFileNotCompiled, &[name]),
            };
            self.diagnostics
                .add_at_witness(code, arguments, &record.witness, &output.texts);
        }
    }

    pub(crate) fn parallel_runner(&self) -> impl Fn(usize, &(dyn Fn(usize) + Sync)) + use<'a> {
        let (caches, threads) = (self.caches, self.threads.get());
        move |count, work| for_each_parallel_in_runs(caches, threads, count, 1, work)
    }

    pub(crate) fn beside_runner(
        &self,
    ) -> impl Fn(&mut (dyn FnMut() + Send), &mut dyn FnMut()) + use<'a> {
        let (caches, threads) = (self.caches, self.threads.get());
        move |on_another_thread, on_this_thread| match threads {
            1 => run_one_after_the_other(on_another_thread, on_this_thread),
            _ => {
                run_on_one_thread_while(caches, on_another_thread, on_this_thread);
            }
        }
    }

    pub(crate) fn stop_if_errors(&mut self, stage: Stage) -> Result<(), Stage> {
        match self.diagnostics.has_errors() {
            true => Err(stage),
            false => Ok(()),
        }
    }

    pub(crate) fn finish<T>(
        mut self,
        result: Result<T, Stage>,
        log: &mut Log,
    ) -> Result<(T, Statistics), BuildFailed> {
        self.clock.add_to(&mut self.statistics);
        match result {
            Ok(value) => {
                self.diagnostics.write_to(log);
                Ok((value, self.statistics))
            }
            Err(stage) => Err(fail(stage, self.diagnostics, self.statistics, log)),
        }
    }
}
