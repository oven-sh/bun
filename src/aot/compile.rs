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
use self::runtime_reach::loads_modules_by_computed_names;
use crate::builtins::{BuiltinId, BuiltinNames, Platforms, RuntimeModule, table};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, Diagnostics, InternalError, LoadMessages, ProgramView};
use crate::emit::{ProgramBytes, emit_from, emit_with_external_bodies};
use crate::engine::{self, EngineOptions, EngineRequest, EngineResult, feature_of};
use crate::ir::Program;
use crate::ir::generated::{FeatureUseKind, UnseenCodeCause};
use crate::known_helpers::KnownHelpers;
use crate::link::{BodyRemap, Leftovers, ProgramNames, run_beside, run_one_after_the_other};
use crate::load::source_provider::SourceProvider;
use crate::load::sources::parsed_source;
use crate::load::typed_packages::TypedPackages;
use crate::load::{PerProject, ProjectId, Sources, host_platform};
use crate::module_list::{ImportTarget, ModuleInput, ModuleList};
use crate::modules::{ApplicationGraph, DeferredData, ModuleGraph};
use crate::options::{Options, PathOptions};
use crate::package_diagnostics::PackageView;
use crate::report::SourceTexts;
use crate::statistics::{LimitValues, Stage, StageClock, StatisticId, Statistics};
use bun_ast::{Kind, Loader, Log, Msg};
use bun_core::ZBox;
use bun_sema::atom::Interner;
use bun_sema::check::aot::BuiltinTypeSymbols;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::CodeHost;
use bun_sema::session::Session;
use bun_sema::util::SharedSort;
use bun_sema_driver::{
    CompileRequest, LoadedProgram, ThreadCaches, drop_thread_caches, for_each_parallel_in_runs,
    run_on_one_thread_while,
};
use bun_sys::{Fd, File};
use bun_trim::Feature;
use core::fmt;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::collections::BTreeSet;
use std::num::NonZeroUsize;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

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
    /// Of a build whose entry points begin programs of their own: the program of each entry point behind the first, in their order.
    /// `summary.entry_points` lists all of them then, and `engine` is the program of the first.
    pub further_programs: Vec<EngineResult>,
}

pub struct BuildFailed {
    pub stage: Stage,
    pub is_internal_error: bool,
    pub statistics: Statistics,
    pub compilation: Option<Box<Compilation>>,
    pub refused_entry_points: Option<Vec<u32>>,
    /// No failure: see `compile_program_at_each_entry_point`.
    pub is_one_program: bool,
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
    /// `QueryInputs::checked_elsewhere` of the program that is lowered as the application.
    pub(crate) checked_elsewhere: Vec<FileId>,
    /// What `report_rejected_versions` returned.
    full_types_refused_at_load: BTreeSet<Vec<u8>>,
    pub(crate) place: ProgramPlace,
    is_one_program: bool,
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
    /// Of a program that checks a typed package by itself.
    pub application: Option<&'b BoundApplication<'b>>,
    pub session: &'s Session,
    pub atoms: Interner<'s>,
    pub messages: &'b LoadMessages,
    pub builtin_names: &'b BuiltinNames,
    pub typed_packages: &'b TypedPackages<'b>,
    pub can_load_code_at_run_time: bool,
    /// Waits until the plugins have answered for every asset. False: one of them is no asset, and the caller gives up.
    pub finish_asset_reads: &'b dyn Fn() -> bool,
}

pub(crate) struct BoundApplication<'b> {
    pub graph: ApplicationGraph<'b>,
    pub left_out: &'b LeftOutCode,
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
    writes_preload: bool,
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

// The allocator gives the free blocks inside pages that are still in use back to the system. That lowers the most memory a
// build ever holds only while the build stands near it. Further down the stages take the same blocks again a moment later,
// and every block that is given back interrupts all the threads. What a stage frees when it ends stands right behind a peak:
// that is given back as ever.
struct KeepsFreeBlocksBelowThePeak {
    is_over: Arc<AtomicBool>,
    watcher: Option<JoinHandle<()>>,
}

static BUILDS_THAT_KEEP_FREE_BLOCKS: AtomicUsize = AtomicUsize::new(0);

impl KeepsFreeBlocksBelowThePeak {
    const PERCENT_OF_PEAK: usize = 85;
    const TIME_BEHIND_THE_PEAK: Duration = Duration::from_millis(1500);
    const TIME_BETWEEN_LOOKS: Duration = Duration::from_millis(20);

    fn begin() -> KeepsFreeBlocksBelowThePeak {
        let is_over = Arc::new(AtomicBool::new(false));
        let is_first = BUILDS_THAT_KEEP_FREE_BLOCKS.fetch_add(1, Ordering::AcqRel) == 0;
        let watcher = (bun_alloc::USE_MIMALLOC && is_first)
            .then(|| {
                let is_over = Arc::clone(&is_over);
                let thread = std::thread::Builder::new().name("AOT memory".into());
                thread.spawn(move || Self::watch(&is_over)).ok()
            })
            .flatten();
        KeepsFreeBlocksBelowThePeak { is_over, watcher }
    }

    fn watch(is_over: &AtomicBool) {
        let mut gives_back = true;
        let mut was_near_peak_at = Instant::now();
        while !is_over.load(Ordering::Acquire) {
            let (resident, peak) = Self::resident_now_and_at_most();
            if resident / 100 >= peak / 10_000 * Self::PERCENT_OF_PEAK {
                was_near_peak_at = Instant::now();
            }
            let should_give_back = was_near_peak_at.elapsed() < Self::TIME_BEHIND_THE_PEAK;
            if should_give_back != gives_back {
                gives_back = should_give_back;
                Self::give_back(gives_back);
            }
            std::thread::park_timeout(Self::TIME_BETWEEN_LOOKS);
        }
        Self::give_back(true);
    }

    fn give_back(gives_back: bool) {
        let option = bun_alloc::mimalloc::Option::purge_holes;
        bun_alloc::mimalloc::mi_option_set_default(option, gives_back.into());
    }

    fn resident_now_and_at_most() -> (usize, usize) {
        let (mut resident, mut peak) = (0, 0);
        let unused = core::ptr::null_mut();
        // SAFETY: it writes a number through each pointer that is not null.
        unsafe {
            bun_alloc::mimalloc::mi_process_info(
                unused,
                unused,
                unused,
                &raw mut resident,
                &raw mut peak,
                unused,
                unused,
                unused,
            );
        }
        (resident, peak)
    }
}

impl Drop for KeepsFreeBlocksBelowThePeak {
    fn drop(&mut self) {
        BUILDS_THAT_KEEP_FREE_BLOCKS.fetch_sub(1, Ordering::AcqRel);
        self.is_over.store(true, Ordering::Release);
        if let Some(watcher) = self.watcher.take() {
            watcher.thread().unpark();
            let _ = watcher.join();
        }
    }
}

// A global begins at an entry point: the process at the first, a Worker at the one that it names. What the compiler proves about a
// program holds for one global, so each entry point begins a program of its own, with an image of its own.
fn begins_program_at_each_entry_point(options: &Options<'_>) -> bool {
    let aot = options.aot;
    let is_code = |path: &Vec<u8>| {
        let mut loaders = options.load.loaders.iter().rev();
        let loader = loaders.find(|(extension, _)| path.ends_with(extension));
        loader.is_none_or(|(_, loader)| {
            matches!(loader, Loader::Js | Loader::Jsx | Loader::Ts | Loader::Tsx)
        })
    };
    // A hardened run time executes only what the loader of the system has mapped to be executed, and that is the code of one image.
    options.entry_points.len() > 1
        && !cfg!(bun_hardened)
        && !aot.checks_only
        && !aot.runs_in_place
        && !aot.runs_tests
        && options.entry_points.iter().all(is_code)
}

fn options_with_entry_points<'a>(options: &Options<'a>, entry_points: &[usize]) -> Options<'a> {
    let chosen = |all: &[Vec<u8>]| {
        entry_points
            .iter()
            .map(|&index| all[index].clone())
            .collect()
    };
    Options {
        aot: options.aot,
        executable_identity: options.executable_identity,
        image_form: options.image_form,
        entry_points: chosen(&options.entry_points),
        code: options.code.clone(),
        typescript_libs: options.typescript_libs,
        load: options.load.clone(),
        paths: PathOptions {
            entry_point_names: chosen(&options.paths.entry_point_names),
            ..options.paths.clone()
        },
        removable: options.removable,
        lists_modules: options.lists_modules,
        minifies_identifiers: options.minifies_identifiers,
    }
}

// By what the names in the files are bound to. A file that gets to the constructor in a roundabout way is not seen here, and then the build has one program, which is right too.
fn mentions_worker_constructor(loaded: &LoadedBuild<'_, '_>) -> bool {
    let files = loaded.project(ProjectId::Application).loaded.files();
    let constructor = table::find_name(b"Worker").and_then(table::global);
    let module = table::module_by_specifier(b"node:worker_threads");
    let mut imported = files.host_modules().iter();
    let is_constructor = |&id: &BuiltinId| Some(table::canonical_id(id)) == constructor;
    imported.any(|id| RuntimeModule::from_registry_id(id.0) == module)
        || files.compiled_files().iter().any(|&file| {
            parsed_source(files, file)
                .is_some_and(|source| source.builtins.mentioned().iter().any(is_constructor))
        })
}

// A name that the build does not know may be that of any entry point.
fn loads_modules_by_name(engine: &EngineResult) -> bool {
    engine.unseen_code().iter().any(|record| {
        !matches!(
            record.cause,
            UnseenCodeCause::EvaluatesText
                | UnseenCodeCause::ImportsUncompiledModule
                | UnseenCodeCause::RunsUnseenCode
                | UnseenCodeCause::RunsMachineCode
        )
    })
}

// By what the program names. Text that it evaluates, and a constructor that it finds under a computed name, are not asked.
fn names(program: &Compilation, feature: Feature) -> bool {
    let mut uses = program.engine.features_used().iter();
    uses.any(|record| {
        record.kind == FeatureUseKind::Named && feature_of(record.feature) == Some(feature)
    })
}

pub fn compile(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Compilation, BuildFailed> {
    if !begins_program_at_each_entry_point(options) {
        return compile_program(options, ProgramPlace::Only, provider, log);
    }
    let said_before = (log.msgs.len(), log.warnings, log.errors);
    if let Some(compiled) = compile_program_at_each_entry_point(options, provider, log) {
        return compiled;
    }
    log.msgs.truncate(said_before.0);
    (log.warnings, log.errors) = (said_before.1, said_before.2);
    remove_program_files_of_further_entry_points(options);
    compile_program(options, ProgramPlace::Only, provider, log)
}

fn remove_program_files_of_further_entry_points(options: &Options<'_>) {
    if let Some(path) = options.aot.ir_output_path.as_deref() {
        for index in 1..options.entry_points.len() {
            let _ = bun_sys::unlink(&ZBox::from_bytes(&numbered_program_file(path, index)));
        }
    }
}

fn numbered_program_file(path: &[u8], index: usize) -> Vec<u8> {
    [path, b".", index.to_string().as_bytes()].concat()
}

// `None`: the build has one program. Either nothing starts a Worker, so there is one global. Or entry points can meet in one global:
// its program has to hold them all, with everything that they lead to, and an executable holds nothing twice.
fn compile_program_at_each_entry_point(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Option<Result<Compilation, BuildFailed>> {
    let mut programs = Vec::with_capacity(options.entry_points.len());
    for index in 0..options.entry_points.len() {
        let said_before = log.msgs.len();
        let entry_point = options_with_entry_points(options, &[index]);
        let place = ProgramPlace::OneOfSeveral(index);
        let compiled = compile_program(&entry_point, place, provider, log);
        forget_repeated_messages(log, said_before);
        match compiled {
            Err(failure) if failure.is_one_program => return None,
            Err(failure) => return Some(Err(failure)),
            Ok(program) if loads_modules_by_name(&program.engine) => return None,
            Ok(program) => programs.push(program),
        }
    }
    // The host loads node:worker_threads into the global of a Worker of that module.
    let starts_node_workers = programs
        .iter()
        .any(|program| names(program, Feature::NodeWorker));
    let lacks_module = |program: &Compilation| !names(program, Feature::WorkerConstructor);
    if starts_node_workers && programs[1..].iter().any(lacks_module) {
        return None;
    }
    let mut programs = programs.into_iter();
    let mut first = programs.next().expect("it was pushed");
    for Compilation {
        engine, summary, ..
    } in programs
    {
        first.further_programs.push(engine);
        first.summary.entry_points.extend(summary.entry_points);
        first.summary.folders.extend(summary.folders);
        first.summary.validates_by_type |= summary.validates_by_type;
        if let (Some(listed), Some(further)) = (&mut first.summary.modules, summary.modules) {
            add_modules(listed, further);
        }
    }
    first.summary.folders.shared_sort_unstable();
    first.summary.folders.dedup();
    Some(Ok(first))
}

// A file that several programs hold is listed once, with the code that all of them have made of it.
fn add_modules(listed: &mut ModuleList, further: ModuleList) {
    let place_of: Vec<u32> = (further.inputs.iter())
        .map(|input| {
            let known = listed.inputs.iter().position(|it| it.path == input.path);
            known.unwrap_or_else(|| {
                listed.inputs.push(ModuleInput {
                    imports: Vec::new(),
                    code_byte_count: 0,
                    ..input.clone()
                });
                listed.inputs.len() - 1
            }) as u32
        })
        .collect();
    for (input, &place) in further.inputs.into_iter().zip(&place_of) {
        let known = &mut listed.inputs[place as usize];
        known.code_byte_count += input.code_byte_count;
        if known.imports.is_empty() {
            known.imports = input.imports;
            for import in &mut known.imports {
                if let ImportTarget::Input(target) = &mut import.target {
                    *target = place_of[*target as usize];
                }
            }
        }
    }
}

// What is said about a file that several programs hold is said once.
fn forget_repeated_messages(log: &mut Log, said_before: usize) {
    let place = |message: &Msg| {
        let location = message.data.location.as_ref();
        location.map(|at| (at.file.clone(), at.line, at.column))
    };
    let is_same =
        |a: &Msg, b: &Msg| a.kind == b.kind && a.data.text == b.data.text && place(a) == place(b);
    let later = log.msgs.split_off(said_before);
    for message in later {
        if message.kind != Kind::Err && log.msgs.iter().any(|earlier| is_same(earlier, &message)) {
            log.warnings -= u32::from(message.kind == Kind::Warn);
        } else {
            log.msgs.push(message);
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ProgramPlace {
    Only,
    /// By the position of its first entry point among those of the build.
    OneOfSeveral(usize),
}

fn compile_program(
    options: &Options<'_>,
    place: ProgramPlace,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Compilation, BuildFailed> {
    let _hands_out_last_freed_memory = HandsOutLastFreedMemory::begin();
    let _keeps_free_blocks_below_the_peak = KeepsFreeBlocksBelowThePeak::begin();
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
    build.place = place;
    let body_placement = match options.aot.ir_output_path {
        Some(_) => BodyPlacement::InProgramBytes,
        None => BodyPlacement::External,
    };
    let emitted = build
        .run_through_emit(body_placement)
        .and_then(|(bytes, output)| build.write_program_file(&bytes).map(|()| (bytes, output)));
    let (bytes, mut output) = match emitted {
        Ok(emitted) => emitted,
        Err(stage) => {
            let is_one_program = build.is_one_program;
            let mut failure = build.finish::<()>(Err(stage), log).unwrap_err();
            failure.is_one_program = is_one_program;
            return Err(failure);
        }
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
    let compilation = Compilation {
        engine,
        summary,
        further_programs: Vec::new(),
    };
    match has_errors {
        false => Ok(compilation),
        true => Err(BuildFailed {
            stage: Stage::Any,
            is_internal_error,
            statistics,
            compilation: Some(Box::new(compilation)),
            refused_entry_points,
            is_one_program: false,
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
        is_one_program: false,
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
            checked_elsewhere: Vec::new(),
            full_types_refused_at_load: BTreeSet::new(),
            place: ProgramPlace::Only,
            is_one_program: false,
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
            let starts_workers =
                build.place != ProgramPlace::Only && mentions_worker_constructor(&loaded);
            if build.place == ProgramPlace::OneOfSeveral(0) && !starts_workers {
                build.is_one_program = true;
                return Err(Stage::Load);
            }
            let bound = build.bind_modules(&loaded)?;
            build.stop_if_errors(Stage::BindModules)?;
            // What the engine finds out about such names comes a whole program later.
            let application = loaded.project(ProjectId::Application).loaded.files();
            if build.place != ProgramPlace::Only
                && loads_modules_by_computed_names(application, &bound.projects.application.graph)
            {
                build.is_one_program = true;
                return Err(Stage::BindModules);
            }
            let units = build.check_and_lower(&loaded, &bound);
            if !(loaded.finish_asset_reads)() {
                return Err(Stage::Load);
            }
            build.diagnostics.add_load_messages(loaded.messages);
            build.stop_if_errors(Stage::Lower)?;
            let output = build.link(loaded, bound, units);
            linked_at = Some(Instant::now());
            // The host loads what `preload` names into the global of the Worker. An object has that option only in a program that
            // writes a property of its name.
            if starts_workers && matches!(&output, Ok(output) if output.writes_preload) {
                build.is_one_program = true;
                return Err(Stage::LinkAndEmit);
            }
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
        // The program of the first entry point has the path as it is written.
        let numbered: Vec<u8>;
        let path = match self.place {
            ProgramPlace::Only | ProgramPlace::OneOfSeveral(0) => path,
            ProgramPlace::OneOfSeveral(index) => {
                numbered = numbered_program_file(path, index);
                &numbered[..]
            }
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
