#![allow(clippy::result_large_err, reason = "a build fails at most once")]

#[cfg(test)]
mod barrel_tests;
mod bind_stage;
mod import_graph;
mod link_stage;
mod load_stage;
mod lower_stage;
mod module_list;
#[cfg(test)]
mod module_reach_tests;
mod program_reach;
pub(crate) mod removable;
mod runtime_reach;
mod summary;
pub mod testing;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod time_tests;

#[cfg(test)]
pub(crate) use self::lower_stage::collect_file_inputs;

use self::import_graph::ImportGraph;
use self::module_list::ListedModules;
use self::program_reach::LeftOutCode;
use crate::builtins::{BuiltinNames, Platforms};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, Diagnostics, InternalError, LoadMessages, ProgramView};
use crate::emit::{ProgramBytes, emit_from, emit_with_external_bodies};
use crate::engine::{self, EngineOptions, EngineRequest, EngineResult};
use crate::ir::Program;
use crate::known_helpers::KnownHelpers;
use crate::link::{BodyRemap, Leftovers, ProgramNames, run_beside, run_one_after_the_other};
use crate::load::source_provider::SourceProvider;
use crate::load::typed_packages::TypedPackages;
use crate::load::{PerProject, ProjectId, Sources, host_platform};
use crate::module_list::ModuleList;
use crate::modules::{DeferredData, ModuleGraph};
use crate::options::Options;
use crate::package_diagnostics::PackageView;
use crate::report::SourceTexts;
use crate::statistics::{LimitValues, Stage, StageClock, StatisticId, Statistics};
use bun_ast::Log;
use bun_sema::atom::Interner;
use bun_sema::check::aot::BuiltinTypeSymbols;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::CodeHost;
use bun_sema::session::Session;
use bun_sema_driver::{
    CompileRequest, LoadedProgram, ThreadCaches, drop_thread_caches, for_each_parallel_in_runs,
    run_on_one_thread_while,
};
use bun_sys::{Fd, File};
use core::fmt;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::num::NonZeroUsize;
use std::time::Instant;

pub struct ProgramSummary {
    pub entry_points: Vec<EntryPointPaths>,
    /// The folders that hold compiled files of a program with further entry points, each once.
    pub folders: Vec<FolderPaths>,
    pub names: ProgramNames,
    pub texts: SourceTexts,
    pub statistics: Statistics,
    pub validates_by_type: bool,
    /// Where `Options::lists_modules` asks for it.
    pub modules: Option<ModuleList>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EntryPointPaths {
    pub public_path: Vec<u8>,
    pub source_path: Vec<u8>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct FolderPaths {
    pub public_path: Vec<u8>,
    pub source_path: Vec<u8>,
}

pub struct LinkedProgram {
    pub program: Program,
    pub summary: ProgramSummary,
}

pub struct EmittedProgram {
    pub bytes: ProgramBytes,
    pub summary: ProgramSummary,
}

pub struct Compilation {
    pub engine: EngineResult,
    pub summary: ProgramSummary,
}

pub struct BuildFailed {
    pub stage: Stage,
    pub is_internal_error: bool,
    pub statistics: Statistics,
    pub compilation: Option<Box<Compilation>>,
    pub refused_entry_points: Option<Vec<u32>>,
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
    platform: Platforms,
    limits: LimitValues,
    pub(crate) diagnostics: Diagnostics,
    clock: StageClock,
    statistics: Statistics,
    retired_sessions: Vec<Session>,
    leftovers: Vec<Leftovers>,
    // In ascending order.
    unreached_runtime_files: Vec<FileId>,
    // Each with `QueryStatistics::closed_cycles`, which is not 0.
    circular_runtime_files: Vec<(FileId, u32)>,
    import_graph: Option<ImportGraph>,
    /// While the modules of a typed package's own program are bound: what the application leaves out of its files.
    pub(crate) left_out_of_world: Option<LeftOutCode>,
    /// `QueryInputs::checked_elsewhere` of the program that is lowered as the application.
    pub(crate) checked_elsewhere: Vec<FileId>,
}

pub(crate) struct LoadedProject<'b, 's> {
    pub loaded: &'b LoadedProgram<'s>,
    pub host: &'b dyn CodeHost,
    pub request: &'b CompileRequest<'b, 's>,
    pub sources: Sources,
}

pub(crate) struct LoadedBuild<'b, 's> {
    pub projects: PerProject<LoadedProject<'b, 's>>,
    /// One for each program that checks a typed package by itself.
    pub world_sessions: &'s [Session],
    pub session: &'s Session,
    pub atoms: Interner<'s>,
    pub messages: &'b LoadMessages,
    pub builtin_names: &'b BuiltinNames,
    pub typed_packages: &'b TypedPackages<'b>,
    pub can_load_code_at_run_time: bool,
    /// Waits until the plugins have answered for every asset. False: one of them is no asset, and the caller gives up.
    pub finish_asset_reads: &'b dyn Fn() -> bool,
}

pub(crate) struct BoundProject<'s> {
    pub graph: ModuleGraph,
    pub left_out: LeftOutCode,
    pub known_helpers: KnownHelpers,
    pub deferred_data: DeferredData<'s>,
    pub builtin_types: BuiltinTypeSymbols,
}

pub(crate) struct BoundBuild<'s> {
    pub projects: PerProject<BoundProject<'s>>,
}

#[derive(Copy, Clone)]
enum BodyPlacement {
    InProgramBytes,
    External,
}

struct FrontEndOutput {
    program: Program,
    body_remap: BodyRemap,
    names: ProgramNames,
    texts: SourceTexts,
    entry_points: Vec<EntryPointPaths>,
    folders: Vec<FolderPaths>,
    validates_by_type: bool,
    modules: Option<ListedModules>,
}

impl FrontEndOutput {
    fn into_parts(self, statistics: Statistics) -> (Program, ProgramSummary) {
        let summary = ProgramSummary {
            entry_points: self.entry_points,
            folders: self.folders,
            names: self.names,
            texts: self.texts,
            statistics,
            validates_by_type: self.validates_by_type,
            modules: self.modules.map(|modules| modules.list),
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

    pub(crate) fn packages(&self, project: ProjectId) -> PackageView<'_, 's> {
        PackageView {
            view: self.project(project).view(),
            packages: self.typed_packages,
        }
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
        let body_remap = core::mem::take(&mut output.body_remap);
        output.program.functions = body_remap.into_program_functions(&build.parallel_runner());
        output
    });
    let (output, statistics) = build.finish(result, log)?;
    let (program, summary) = output.into_parts(statistics);
    Ok(LinkedProgram { program, summary })
}

pub fn emit_program(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<EmittedProgram, BuildFailed> {
    let caches = ThreadCaches::default();
    let mut build = Build::new(options, provider, &caches, LimitValues::for_host());
    let result = build.run_through_emit(BodyPlacement::InProgramBytes);
    let ((bytes, output), statistics) = build.finish(result, log)?;
    let (_, summary) = output.into_parts(statistics);
    Ok(EmittedProgram { bytes, summary })
}

struct HandsOutLastFreedMemory;

static BUILDS_THAT_HAND_OUT_LAST_FREED_MEMORY: AtomicUsize = AtomicUsize::new(0);

impl HandsOutLastFreedMemory {
    fn begin() -> HandsOutLastFreedMemory {
        if bun_alloc::USE_MIMALLOC
            && BUILDS_THAT_HAND_OUT_LAST_FREED_MEMORY.fetch_add(1, Ordering::AcqRel) == 0
        {
            bun_alloc::mimalloc::mi_option_set_default(
                bun_alloc::mimalloc::Option::hand_out_last_freed,
                1,
            );
        }
        HandsOutLastFreedMemory
    }
}

impl Drop for HandsOutLastFreedMemory {
    fn drop(&mut self) {
        if bun_alloc::USE_MIMALLOC
            && BUILDS_THAT_HAND_OUT_LAST_FREED_MEMORY.fetch_sub(1, Ordering::AcqRel) == 1
        {
            bun_alloc::mimalloc::mi_option_set_default(
                bun_alloc::mimalloc::Option::hand_out_last_freed,
                0,
            );
        }
    }
}

pub fn compile(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Compilation, BuildFailed> {
    let _hands_out_last_freed_memory = HandsOutLastFreedMemory::begin();
    let request = EngineRequest {
        options: options.aot,
        identity: options.executable_identity,
        image_form: options.image_form,
        thread_count: options.thread_count(),
        reports_functions: options.lists_modules,
    };
    let mut engine_options = match EngineOptions::new(&request) {
        Ok(engine_options) => engine_options,
        Err(rejected) => {
            let mut diagnostics = Diagnostics::new();
            diagnostics.add_internal_error(InternalError {
                stage: Stage::Any,
                message: rejected.sentence,
            });
            return Err(fail(
                Stage::Any,
                diagnostics,
                Statistics::default(),
                None,
                log,
            ));
        }
    };
    let caches = ThreadCaches::default();
    let mut build = Build::new(options, provider, &caches, engine_options.limit_values());
    let body_placement = match options.aot.ir_output_path {
        Some(_) => BodyPlacement::InProgramBytes,
        None => BodyPlacement::External,
    };
    let emitted = build
        .run_through_emit(body_placement)
        .and_then(|(bytes, output)| build.write_program_file(&bytes).map(|()| (bytes, output)));
    let (bytes, mut output) = match emitted {
        Ok(emitted) => emitted,
        Err(stage) => return Err(build.finish::<()>(Err(stage), log).unwrap_err()),
    };
    if options.aot.checks_only && !output.validates_by_type {
        engine_options.check_only();
    }
    let engine = build.run_engine(bytes, &engine_options, &output);
    if let Some(modules) = &mut output.modules {
        modules.count_code(engine.functions(), &output.names);
    }
    let has_errors = build.diagnostics.has_errors();
    let is_internal_error = build.diagnostics.has_internal_errors();
    let refused_entry_points = build.find_refused_entry_points();
    let statistics = build.finish_writing_messages(log);
    let (_, summary) = output.into_parts(statistics.clone());
    let compilation = Compilation { engine, summary };
    match has_errors {
        false => Ok(compilation),
        true => Err(BuildFailed {
            stage: Stage::Any,
            is_internal_error,
            statistics,
            compilation: Some(Box::new(compilation)),
            refused_entry_points,
        }),
    }
}

fn fail(
    stage: Stage,
    diagnostics: Diagnostics,
    statistics: Statistics,
    refused_entry_points: Option<Vec<u32>>,
    log: &mut Log,
) -> BuildFailed {
    let is_internal_error = diagnostics.has_internal_errors();
    diagnostics.write_to(log);
    BuildFailed {
        stage,
        is_internal_error,
        statistics,
        compilation: None,
        refused_entry_points,
    }
}

fn write_file(path: &[u8], bytes: &[u8]) -> bun_sys::Maybe<()> {
    File::create(Fd::cwd(), path, true)?.write_all(bytes)
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
            platform: host_platform(),
            limits,
            diagnostics: Diagnostics::new(),
            clock: StageClock::new(),
            statistics: Statistics::default(),
            retired_sessions: Vec::new(),
            leftovers: Vec::new(),
            unreached_runtime_files: Vec::new(),
            circular_runtime_files: Vec::new(),
            import_graph: None,
            left_out_of_world: None,
            checked_elsewhere: Vec::new(),
        }
    }

    pub(crate) fn keep_import_graph(&mut self, files: &Files<'_>) {
        if self.options.aot.checks_only && self.options.entry_points.len() > 1 {
            self.import_graph = Some(ImportGraph::of(files));
        }
    }

    fn find_refused_entry_points(&self) -> Option<Vec<u32>> {
        let paths = self.diagnostics.paths_of_errors()?;
        self.import_graph
            .as_ref()?
            .find_entry_points_that_reach(paths.into_iter())
    }

    fn run_front_end(&mut self) -> Result<FrontEndOutput, Stage> {
        let mut linked_at = None;
        let output = self.with_loaded_projects_before_assets(|build, loaded| {
            let bound = build.bind_modules(&loaded)?;
            build.stop_if_errors(Stage::BindModules)?;
            let units = build.check_and_lower(&loaded, &bound);
            if !(loaded.finish_asset_reads)() {
                return Err(Stage::Load);
            }
            build.diagnostics.add_load_messages(loaded.messages);
            build.stop_if_errors(Stage::Lower)?;
            let output = build.link(loaded, bound, units);
            linked_at = Some(Instant::now());
            output
        });
        drop_thread_caches(self.caches);
        if let Some(linked_at) = linked_at {
            self.count_time(StatisticId::ReleaseLoadedProjectsNanoseconds, linked_at);
        }
        output
    }

    pub(crate) fn retire_sessions(&mut self, sessions: PerProject<Session>) {
        let PerProject {
            application,
            runtime,
        } = sessions;
        self.retired_sessions.extend([application, runtime]);
    }

    pub(crate) fn retire_world_sessions(&mut self, sessions: Vec<Session>) {
        let used = sessions.into_iter().filter(|session| !session.is_unused());
        self.retired_sessions.extend(used);
    }

    // Nothing waits for the memory of what a stage has read for the last time, and one thread takes a while to free it.
    pub(crate) fn retire(&mut self, leftovers: Leftovers) {
        self.leftovers.push(leftovers);
    }

    fn run_through_emit(
        &mut self,
        body_placement: BodyPlacement,
    ) -> Result<(ProgramBytes, FrontEndOutput), Stage> {
        let mut output = self.run_front_end()?;
        let mut program = core::mem::take(&mut output.program);
        let body_remap = core::mem::take(&mut output.body_remap);
        let in_parallel = self.parallel_runner();
        let started = Instant::now();
        // Emit asks nothing of the sessions, and few threads have something to free.
        let sessions = core::mem::take(&mut self.retired_sessions);
        let runner_of_drops = self.parallel_runner();
        let ((), emitted) = run_beside(
            &self.beside_runner(),
            move || {
                for session in sessions {
                    session.drop_in_parallel(&runner_of_drops);
                }
            },
            || match body_placement {
                BodyPlacement::InProgramBytes => {
                    program.functions = body_remap.into_program_functions(&in_parallel);
                    emit_from(&mut program, &in_parallel)
                }
                BodyPlacement::External => {
                    emit_with_external_bodies(&mut program, body_remap, &in_parallel)
                }
            },
        );
        self.retire(Box::new(program));
        drop_thread_caches(self.caches);
        self.count_time(StatisticId::EmitNanoseconds, started);
        match emitted {
            Ok(bytes) => {
                let byte_count = bytes.size_with_external_bodies() as u64;
                self.statistics.count(StatisticId::ProgramBytes, byte_count);
                Ok((bytes, output))
            }
            Err(error) => {
                self.statistics.gave_up(error.limit(), None);
                self.diagnostics.add_emit_error(error);
                Err(Stage::LinkAndEmit)
            }
        }
    }

    fn write_program_file(&mut self, bytes: &ProgramBytes) -> Result<(), Stage> {
        let Some(path) = self.options.aot.ir_output_path.as_deref() else {
            return Ok(());
        };
        let Err(error) = write_file(path, bytes.as_slice()) else {
            return Ok(());
        };
        let reason = error.to_string();
        let arguments = [path, reason.as_bytes()];
        let diagnostic = Diagnostic::new(Code::OutputNotWritten, None, &arguments);
        self.diagnostics.add(None, diagnostic);
        Err(Stage::LinkAndEmit)
    }

    fn run_engine(
        &mut self,
        bytes: ProgramBytes,
        engine_options: &EngineOptions,
        output: &FrontEndOutput,
    ) -> EngineResult {
        self.clock.stop();
        let leftovers = core::mem::take(&mut self.leftovers);
        let started = Instant::now();
        let ((), engine) = run_beside(
            &self.beside_runner(),
            move || drop(leftovers),
            || engine::compile(bytes, engine_options),
        );
        self.count_time(StatisticId::EngineCallNanoseconds, started);

        let returned = Instant::now();
        self.statistics.add_values(engine.statistics());
        self.diagnostics
            .add_engine_records(&engine, &output.names, &output.texts);
        if engine_options.makes_image()
            && engine.image().is_none()
            && !self.diagnostics.has_errors()
        {
            self.diagnostics.add_internal_error(InternalError {
                stage: Stage::Any,
                message: b"the engine returned neither an image nor an error".to_vec(),
            });
        }
        self.count_time(StatisticId::AfterEngineNanoseconds, returned);
        engine
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

    fn count_time(&mut self, id: StatisticId, started: Instant) {
        let nanoseconds = u64::try_from(started.elapsed().as_nanos()).unwrap_or(u64::MAX);
        self.statistics.count(id, nanoseconds);
    }

    pub(crate) fn stop_if_errors(&self, stage: Stage) -> Result<(), Stage> {
        match self.diagnostics.has_errors() {
            true => Err(stage),
            false => Ok(()),
        }
    }

    fn finish_writing_messages(mut self, log: &mut Log) -> Statistics {
        self.clock.add_to(&mut self.statistics);
        self.diagnostics.write_to(log);
        self.statistics
    }

    pub(crate) fn finish<T>(
        mut self,
        result: Result<T, Stage>,
        log: &mut Log,
    ) -> Result<(T, Statistics), BuildFailed> {
        let refused_entry_points = self.find_refused_entry_points();
        self.clock.add_to(&mut self.statistics);
        match result {
            Ok(value) => {
                self.diagnostics.write_to(log);
                Ok((value, self.statistics))
            }
            Err(stage) => Err(fail(
                stage,
                self.diagnostics,
                self.statistics,
                refused_entry_points,
                log,
            )),
        }
    }
}
