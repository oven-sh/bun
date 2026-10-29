#![allow(clippy::result_large_err, reason = "a build fails at most once")]

#[cfg(test)]
mod barrel_tests;
mod bind_stage;
mod import_graph;
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
mod time_tests;

use self::lower_stage::LoweredRuntimes;
#[cfg(test)]
pub(crate) use self::lower_stage::collect_file_inputs;
#[cfg(test)]
pub use self::paths::{EntryPointPaths, FolderPaths};
#[cfg(not(test))]
pub use bun_aot_interface::compile::{EntryPointPaths, FolderPaths};

use self::import_graph::ImportGraph;
use self::load_stage::{AssetReads, SharedByLoads};
use self::module_list::ListedModules;
use self::program_reach::LeftOutCode;
use self::runtime_reach::{HeldLibraryCode, KnownRegions, loads_modules_by_computed_names};
use crate::builtins::table::RuntimeFunctionRole;
use crate::builtins::{
    BuiltinId, BuiltinNames, Platforms, RuntimeFunction, RuntimeModule, RuntimeUses, table,
};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{
    Diagnostic, Diagnostics, InternalError, LoadMessages, ProgramView, ShownPosition,
    log_diagnostic_at,
};
use crate::emit::{ProgramBytes, emit_from, emit_with_external_bodies};
use crate::engine::{
    self, EngineOptions, EngineRequest, EngineResult, FlowFindings, JudgeOfFlowFindings,
    builtin_of, feature_of, position_of,
};
use crate::ir::Program;
use crate::ir::generated::{BuiltinUse, FeatureUseKind, UnseenCodeCause};
use crate::known_helpers::KnownHelpers;
use crate::link::{BodyRemap, Leftovers, ProgramNames, run_beside, run_one_after_the_other};
use crate::load::plugin_modules::is_path_of_entry_text;
use crate::load::source_provider::SourceProvider;
use crate::load::sources::parsed_source;
use crate::load::worker_files::WorkerFile;
use crate::load::{PerProject, ProjectId, Sources, host_platform};
use crate::module_list::{ImportTarget, ModuleInput, ModuleList};
use crate::modules::{ApplicationGraph, DeferredData, ModuleGraph};
use crate::options::{
    EntryText, LibraryCode, LoadOptions, Options, PathOptions, WaysBetweenModuleObjects,
};
use crate::report::{ModuleLocator, SourceTexts};
use crate::statistics::{LimitId, LimitValues, Stage, StageClock, StatisticId, Statistics};
use bun_ast::{Kind, Loader, Log, Msg};
use bun_core::ZBox;
use bun_options_types::aot_options::{Preload, TargetPlatform};
use bun_sema::atom::Interner;
use bun_sema::check::aot::BuiltinTypeSymbols;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::CodeHost;
use bun_sema::session::Session;
use bun_sema::util::SharedSort;
use bun_sema_driver::{
    ChosenThreads, CompileRequest, LoadedProgram, ThreadCaches, drop_thread_caches,
    for_each_parallel_in_runs, run_on_one_thread_while,
};
use bun_sys::{Fd, File};
use bun_threading::Guarded;
use bun_trim::Feature;
use core::cell::{Cell, RefCell};
use core::fmt;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::collections::VecDeque;
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
    /// Where `Options::lists_modules` asks for it.
    pub modules: Option<ModuleList>,
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
    pub(crate) started_workers: StartedWorkers,
    /// What of Bun's own code the programs use, by the word of the engine, and were handed over without.
    library_code_lacked: RuntimeUses,
    /// A program reads `process.mainModule`, by the word of the engine, and none of its files names a way to a module object.
    reads_main_module_without_its_name: bool,
    /// A program reads them, by the word of the engine, and lets a module object go where the front end has not followed them.
    ways_read_out_of_sight: WaysBetweenModuleObjects,
    /// No program reads them, by the word of the engine, and the front end has followed them because a file names them.
    ways_named_that_nobody_reads: WaysBetweenModuleObjects,
}

/// What the files that were loaded say about the code that their Workers start from. The later one holds of two loads together.
#[derive(Copy, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum CodeOfWorkers {
    /// No file names a constructor of Workers.
    #[default]
    NoneNamed,
    /// Each constructor is named only to be called, with a path or with code that the build has compiled.
    Compiled,
    Unseen,
}

/// What the programs that are compiled say about the Workers that they start.
#[derive(Default)]
pub(crate) struct StartedWorkers {
    pub code: CodeOfWorkers,
    /// What `find_code_that_starts_workers` found, and the `copies` that the engine saw passed to `new Worker()`.
    pub files: Vec<WorkerFile>,
    /// `CodeThatStartsWorkers::names`
    pub names: Vec<EntryPointPaths>,
    /// What `find_embedded_code_files` found.
    pub copies: Vec<WorkerFile>,
    /// Files that a Worker may start from and that the build did not compile for it.
    pub left_out: Vec<WorkerFile>,
    /// The files of the application that the programs hold, each once, with the sizes of their texts.
    pub held_texts: Vec<(Vec<u8>, usize)>,
    pub writes_preload: bool,
    /// `CodeThatStartsWorkers::constructs_node_workers`
    pub constructs_node_workers: bool,
}

impl StartedWorkers {
    /// The bytes that a plugin answers for a file are not the code on disk, so no Worker file is compiled from it.
    pub(crate) fn remove_sources(&mut self, source_paths: &[Vec<u8>]) {
        self.files
            .retain(|file| !source_paths.contains(&file.source_path));
        self.names
            .retain(|name| !source_paths.contains(&name.source_path));
        self.copies
            .retain(|file| !source_paths.contains(&file.source_path));
        self.left_out
            .retain(|file| !source_paths.contains(&file.source_path));
    }

    fn add(&mut self, further: StartedWorkers) {
        self.code = self.code.max(further.code);
        self.files.extend(further.files);
        self.names.extend(further.names);
        self.copies.extend(further.copies);
        self.left_out.extend(further.left_out);
        self.held_texts.extend(further.held_texts);
        self.held_texts.shared_sort_unstable();
        self.held_texts.dedup();
        self.writes_preload |= further.writes_preload;
        self.constructs_node_workers |= further.constructs_node_workers;
    }
}

pub struct BuildFailed {
    pub stage: Stage,
    pub is_internal_error: bool,
    pub statistics: Statistics,
    pub compilation: Option<Box<Compilation>>,
    pub refused_entry_points: Option<Vec<u32>>,
    /// No failure: see `compile_program_at_each_entry_point`.
    pub is_one_program: bool,
    /// No failure yet: see `compile`.
    pub brought_bun_types: bool,
    /// `Diagnostics::has_early_errors`
    pub has_early_errors: bool,
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
    // Nothing waits for the memory of what a stage has read for the last time, and one thread takes a while to free it.
    leftovers: Vec<Leftovers>,
    // In ascending order.
    unreached_runtime_files: Vec<FileId>,
    held_library_code: HeldLibraryCode,
    // Each with `QueryStatistics::closed_cycles`, which is not 0.
    circular_runtime_files: Vec<(FileId, u32)>,
    lowered_runtimes: LoweredRuntimes,
    import_graph: Option<ImportGraph>,
    /// `QueryInputs::checked_elsewhere` of the program that is lowered as the application.
    pub(crate) checked_elsewhere: Vec<FileId>,
    pub(crate) place: ProgramPlace,
    /// Of a build that loads the files of several programs together.
    pub(crate) programs: Option<ProgramsOfOneLoad<'a>>,
    /// Entry points that were not compiled, because their programs are not what they are by themselves when they are loaded with
    /// the others. Those of one list can be loaded together.
    pub(crate) left_entry_points: Vec<Vec<usize>>,
    /// No failure: none of the programs that were loaded together can be compiled out of that load.
    pub(crate) has_left_all_entry_points: bool,
    /// The program is the placeholder of `Preload`.
    pub(crate) is_preloading: bool,
    pub(crate) is_one_program: bool,
    pub(crate) started_workers: StartedWorkers,
    pub(crate) brings_bun_types: bool,
    pub(crate) has_withdrawn_trust: bool,
}

#[derive(Copy, Clone)]
pub(crate) struct ProgramsOfOneLoad<'a> {
    /// The position of the entry point of each among those of the build.
    pub indexes: &'a [usize],
    /// The options of each: it is the only entry point.
    pub options: &'a [Options<'a>],
    /// The build has no other entry points.
    pub are_all_of_the_build: bool,
    /// Of the program of a `WorkerFile`: `StartedWorkers::held_texts` of the programs before it.
    pub held_elsewhere: Option<&'a [(Vec<u8>, usize)]>,
    /// Nothing is compiled. The load ends with `Build::is_one_program`: whether `mentions_worker_constructor` is false of one of the programs.
    pub only_looks_for_worker_threads: bool,
}

/// What `compile_with_options` knows of the files that Workers start from while it compiles one program.
#[derive(Copy, Clone)]
struct KnownWorkerFiles<'a> {
    /// Each of them may begin a program of its own.
    splits: bool,
    /// `TextsLeftOut::names`
    left_out: &'a [Vec<u8>],
    /// Filled by a build that ends ahead of the engine, which is no failure: one program has to hold these files with all the entry points.
    of_the_one_program: &'a RefCell<Vec<WorkerFile>>,
}

#[derive(Clone)]
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
    pub can_load_code_at_run_time: bool,
    /// It can for no other reason than that a loader is given a name that the build does not know.
    pub loads_code_by_unknown_names_alone: bool,
    /// `RuntimeRoots::keeps_code_without_names`
    pub keeps_library_code_without_names: bool,
    /// `RuntimeRoots::holds_guessed_code`
    pub holds_guessed_library_code: bool,
    /// Waits until the plugins have answered for every asset. False: one of them is no asset, and the caller gives up.
    pub finish_asset_reads: &'b dyn Fn() -> bool,
    /// What the load of Bun's own code has read off its files.
    pub known_library_regions: &'b dyn Fn() -> Option<KnownRegions>,
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
    modules: Option<ListedModules>,
    writes_preload: bool,
    held_library_code: HeldLibraryCode,
    names_way_to_module_objects: bool,
    has_commonjs_entry_point: bool,
    lets_process_out_of_sight: bool,
    ways_not_followed_out_of_sight: WaysBetweenModuleObjects,
    ways_followed_for_their_names: WaysBetweenModuleObjects,
}

impl FrontEndOutput {
    // There is a main module, and the executable does not keep track of which file it is.
    fn lacks_main_module(&self) -> bool {
        self.has_commonjs_entry_point && !self.names_way_to_module_objects
    }

    fn into_parts(self, statistics: Statistics) -> (Program, ProgramSummary) {
        let summary = ProgramSummary {
            entry_points: self.entry_points,
            folders: self.folders,
            names: self.names,
            texts: self.texts,
            statistics,
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
}

/// The front end of `compile`: it starts over where `compile` does for a reason that the front end knows.
pub fn link_program(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<LinkedProgram, BuildFailed> {
    let said_before = (log.msgs.len(), log.warnings, log.errors);
    let linked = link_program_with_options(options, provider, log);
    match &linked {
        Err(failure) if starts_over_without_brought_types(&options.load, failure) => {}
        Ok(_) | Err(_) => return linked,
    }
    log.msgs.truncate(said_before.0);
    (log.warnings, log.errors) = (said_before.1, said_before.2);
    provider.clear_embedded_files();
    let all: Vec<usize> = (0..options.entry_points.len()).collect();
    let mut options = options_with_entry_points(options, &all);
    options.load.takes_runtime_as_any = true;
    link_program_with_options(&options, provider, log)
}

fn link_program_with_options(
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
    let brought_bun_types = build.brings_bun_types;
    let (output, statistics) = build.finish(result, log).map_err(|mut failure| {
        failure.brought_bun_types = brought_bun_types;
        failure
    })?;
    let (program, summary) = output.into_parts(statistics);
    Ok(LinkedProgram { program, summary })
}

/// The declarations that a build brings along hold no program to what its project has not installed.
fn starts_over_without_brought_types(load: &LoadOptions, failure: &BuildFailed) -> bool {
    failure.brought_bun_types && !failure.is_internal_error && !load.takes_runtime_as_any
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

    fn begin(starts_thread: bool) -> KeepsFreeBlocksBelowThePeak {
        let is_over = Arc::new(AtomicBool::new(false));
        let is_first = BUILDS_THAT_KEEP_FREE_BLOCKS.fetch_add(1, Ordering::AcqRel) == 0;
        let watcher = (bun_alloc::USE_MIMALLOC && is_first)
            .then(|| {
                engine::give_freed_pages_back_after(engine::DELAY_UNTIL_THE_PROGRAM_IS_READ);
                if !starts_thread {
                    return None;
                }
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
        use bun_alloc::mimalloc::{Option, mi_option_set_default};
        mi_option_set_default(Option::purge_holes, gives_back.into());
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
        if BUILDS_THAT_KEEP_FREE_BLOCKS.fetch_sub(1, Ordering::AcqRel) == 1
            && bun_alloc::USE_MIMALLOC
        {
            engine::give_freed_pages_back_after(engine::USUAL_DELAY);
        }
        self.is_over.store(true, Ordering::Release);
        if let Some(watcher) = self.watcher.take() {
            watcher.thread().unpark();
            let _ = watcher.join();
        }
    }
}

fn preload_of<'a>(options: &Options<'a>) -> Option<&'a Preload> {
    if !bun_core::Environment::ENABLE_FUZZILLI {
        return None;
    }
    let preload = options.aot.preload.as_ref();
    preload.filter(|preload| !preload.is_loaded.load(Ordering::Relaxed))
}

// A global begins at an entry point: the process at the first, a Worker at the one that it names. What the compiler proves about a
// program holds for one global, so each entry point begins a program of its own, with an image of its own.
fn begins_program_at_each_entry_point(options: &Options<'_>) -> bool {
    let is_code = |path: &Vec<u8>| {
        let mut loaders = options.load.loaders.iter().rev();
        let loader = loaders.find(|(extension, _)| path.ends_with(extension));
        loader.is_none_or(|(_, loader)| {
            matches!(loader, Loader::Js | Loader::Jsx | Loader::Ts | Loader::Tsx)
        })
    };
    options.entry_points.len() > 1
        && can_have_several_programs(options)
        && options.entry_points.iter().all(is_code)
}

fn can_have_several_programs(options: &Options<'_>) -> bool {
    let aot = options.aot;
    // A hardened run time executes only what the loader of the system has mapped to be executed, and that is the code of one image.
    // One source map describes the frames of one image.
    !cfg!(bun_hardened)
        && !aot.checks_only
        && !aot.runs_in_place
        && !aot.runs_tests
        && !aot.obfuscates
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
pub(crate) fn mentions_worker_constructor(files: &Files<'_>) -> bool {
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
fn names(program: &EngineResult, feature: Feature) -> bool {
    let mut uses = program.features_used().iter();
    uses.any(|record| {
        record.kind == FeatureUseKind::Named && feature_of(record.feature) == Some(feature)
    })
}

// The engine follows values, so it sees what no name in a source tells.
fn find_library_code_lacked(
    found: FlowFindings<'_>,
    held: &HeldLibraryCode,
    platform: Platforms,
) -> RuntimeUses {
    let used = found.builtins_used.iter();
    let used = used.filter_map(|record| builtin_of(record.builtin));
    let used: Vec<BuiltinId> = used.map(table::canonical_id).collect();
    let mut needed = RuntimeUses::of_entries_used(used.iter().copied(), platform);
    needed.add(&held.find_modules_left_out(&used));
    // It has followed nothing, and keeps all that it was handed.
    let has_followed_nothing = found.unseen_code.iter().any(|record| {
        matches!(
            record.cause,
            UnseenCodeCause::FlowResultDisabled | UnseenCodeCause::LimitReached
        )
    });
    if has_followed_nothing {
        needed.add(&RuntimeUses::of_unseen_code(platform));
    }
    // Where the host hands anything to anything, every function of the host counts as called. Such a program holds those that it names.
    let holds_named_functions_of_host_alone = table::STARTUP_MODULES
        .iter()
        .all(|module| held.holds_module(*module) || needed.modules.contains(module));
    let entered = found.library_functions_lacked.iter();
    let entered = entered.map(|record| RuntimeFunction(record.function));
    let functions = entered.filter(|&function| {
        table::runtime_function(function).is_some_and(|data| {
            data.platforms.contains(platform)
                && (!(holds_named_functions_of_host_alone
                    && data.role == RuntimeFunctionRole::HostBuiltin)
                    || held.is_left_to_engine(function))
        })
    });
    needed.add(&RuntimeUses {
        functions: functions.collect(),
        ..RuntimeUses::default()
    });
    held.find_lacked(&needed)
}

// An executable keeps track of which file is the main module where the front end has seen somebody ask.
// Code that the build does not see counts as reading all that it can get at, and is handed no module object of the program. Beside such code a read counts where code of the program lets `process` go out of sight.
fn reads_main_module(found: FlowFindings<'_>, lets_process_out_of_sight: bool) -> bool {
    (found.unseen_code.is_empty() || lets_process_out_of_sight)
        && found.builtins_used.iter().any(|record| {
            record.uses.contains(BuiltinUse::READ)
                && builtin_of(record.builtin).map(table::canonical_id)
                    == Some(BuiltinId::ProcessMainModule)
        })
}

// The files around a module object keep theirs where the front end has seen somebody ask for them. Where it has lost sight of the object the engine says whether anybody asks.
fn find_ways_read_out_of_sight(
    found: FlowFindings<'_>,
    not_followed: WaysBetweenModuleObjects,
) -> WaysBetweenModuleObjects {
    let is_used = |wanted: BuiltinId| {
        found
            .builtins_used
            .iter()
            .any(|record| builtin_of(record.builtin).map(table::canonical_id) == Some(wanted))
    };
    WaysBetweenModuleObjects {
        children: not_followed.children && is_used(BuiltinId::ModuleObjectChildren),
        parent: not_followed.parent && is_used(BuiltinId::ModuleObjectParent),
    }
}

// A name in a file is a guess at what the engine knows.
fn find_ways_named_that_nobody_reads(
    found: FlowFindings<'_>,
    followed_for_their_names: WaysBetweenModuleObjects,
) -> WaysBetweenModuleObjects {
    let read = find_ways_read_out_of_sight(found, followed_for_their_names);
    WaysBetweenModuleObjects {
        children: followed_for_their_names.children && !read.children,
        parent: followed_for_their_names.parent && !read.parent,
    }
}

pub(crate) fn library_code_of(numbers: &LibraryCode) -> RuntimeUses {
    let modules_of = |numbers: &[u32]| {
        let modules = numbers.iter().copied();
        modules
            .filter_map(RuntimeModule::from_registry_id)
            .collect()
    };
    let exports_read = numbers.exports_read.iter();
    RuntimeUses {
        modules: modules_of(&numbers.modules),
        modules_read_whole: modules_of(&numbers.modules_read_whole),
        exports_read: exports_read
            .filter_map(|&(module, name)| Some((RuntimeModule::from_registry_id(module)?, name)))
            .collect(),
        functions: numbers
            .functions
            .iter()
            .copied()
            .map(RuntimeFunction)
            .collect(),
    }
}

fn numbers_of(code: &RuntimeUses) -> LibraryCode {
    let numbers_of =
        |modules: &[RuntimeModule]| modules.iter().map(|it| it.registry_id()).collect();
    let exports_read = code.exports_read.iter();
    LibraryCode {
        modules: numbers_of(&code.modules),
        modules_read_whole: numbers_of(&code.modules_read_whole),
        exports_read: exports_read
            .map(|&(module, name)| (module.registry_id(), name))
            .collect(),
        functions: code.functions.iter().map(|function| function.0).collect(),
    }
}

fn chooses_library_code_by_names(options: &Options<'_>) -> bool {
    !options.load.keeps_library_code_without_names
        && !options.load.omits_builtin_modules
        && !options.aot.checks_only
}

// Which of Bun's own code a program needs is a guess where a member is read by its name. The engine knows.
fn find_load_options_with_library_code_lacked(
    options: &Options<'_>,
    lacked: &RuntimeUses,
) -> Option<LoadOptions> {
    if !chooses_library_code_by_names(options) || lacked.is_empty() {
        return None;
    }
    let mut load = options.load.clone();
    let asked_before = library_code_of(&load.library_code_lacked);
    let mut asked = asked_before.clone();
    asked.add(lacked);
    // There is no such code to be had.
    if asked == asked_before {
        return None;
    }
    // What came along needs more, again and again.
    load.keeps_library_code_without_names = !asked_before.is_empty();
    load.library_code_lacked = numbers_of(&asked);
    Some(load)
}

fn find_load_options_with_what_engine_found(
    options: &Options<'_>,
    compiled: &Compilation,
) -> Option<LoadOptions> {
    find_load_options_with(
        options,
        &compiled.library_code_lacked,
        compiled.reads_main_module_without_its_name,
        compiled.ways_read_out_of_sight,
        compiled.ways_named_that_nobody_reads,
    )
}

fn find_load_options_with(
    options: &Options<'_>,
    library_code_lacked: &RuntimeUses,
    reads_main_module_without_its_name: bool,
    ways_read_out_of_sight: WaysBetweenModuleObjects,
    ways_named_that_nobody_reads: WaysBetweenModuleObjects,
) -> Option<LoadOptions> {
    let mut load = find_load_options_with_library_code_lacked(options, library_code_lacked);
    if !ways_read_out_of_sight.is_empty() && !options.aot.checks_only {
        let load = load.get_or_insert_with(|| options.load.clone());
        load.ways_read_out_of_sight.add(ways_read_out_of_sight);
    }
    if !ways_named_that_nobody_reads.is_empty() && !options.aot.checks_only {
        let load = load.get_or_insert_with(|| options.load.clone());
        (load.ways_named_that_nobody_reads).add(ways_named_that_nobody_reads);
    }
    if reads_main_module_without_its_name
        && !options.load.reads_main_module_without_its_name
        && !options.aot.checks_only
    {
        let load = load.get_or_insert_with(|| options.load.clone());
        load.reads_main_module_without_its_name = true;
    }
    load
}

fn find_load_options_to_compile_again_with(
    options: &Options<'_>,
    compiled: &Result<Compilation, BuildFailed>,
) -> Option<LoadOptions> {
    let mut load = options.load.clone();
    match compiled {
        Err(failure) if starts_over_without_brought_types(&load, failure) => {
            load.takes_runtime_as_any = true;
        }
        Ok(compiled) => return find_load_options_with_what_engine_found(options, compiled),
        Err(_) => return None,
    }
    Some(load)
}

pub fn compile(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Compilation, BuildFailed> {
    let said_before = (log.msgs.len(), log.warnings, log.errors);
    let runs_before = (ENGINE_RUNS.get(), WHOLE_ENGINE_RUNS.get());
    SharedByLoads::begin_build();
    let mut changed: Option<Options<'_>> = None;
    let mut compiled = loop {
        let options = changed.as_ref().unwrap_or(options);
        let compiled = compile_with_options(options, provider, log);
        let Some(load) = find_load_options_to_compile_again_with(options, &compiled) else {
            break compiled;
        };
        log.msgs.truncate(said_before.0);
        (log.warnings, log.errors) = (said_before.1, said_before.2);
        provider.clear_embedded_files();
        let all: Vec<usize> = (0..options.entry_points.len()).collect();
        let mut options = options_with_entry_points(options, &all);
        options.load = load;
        changed = Some(options);
    };
    SharedByLoads::end_build();
    if let Ok(compiled) = &mut compiled {
        let runs = ENGINE_RUNS.get() - runs_before.0;
        let whole_runs = WHOLE_ENGINE_RUNS.get() - runs_before.1;
        let statistics = &mut compiled.summary.statistics;
        statistics.count(StatisticId::EngineRuns, runs);
        statistics.count(StatisticId::WholeEngineRuns, whole_runs);
    }
    compiled
}

thread_local! {
    // How often this thread has run the engine, also for programs that a build then threw away. A build runs it on the thread that called `compile`.
    static ENGINE_RUNS: Cell<u64> = const { Cell::new(0) };
    // Those that did not end behind the flow analysis.
    static WHOLE_ENGINE_RUNS: Cell<u64> = const { Cell::new(0) };
}

fn compile_with_options(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Compilation, BuildFailed> {
    let said_before = (log.msgs.len(), log.warnings, log.errors);
    let mut with_worker_files: Option<Options<'_>> = None;
    let mut left_out = TextsLeftOut::default();
    loop {
        let options = with_worker_files.as_ref().unwrap_or(options);
        let splits = with_worker_files.is_none() && can_have_several_programs(options);
        let of_the_one_program = RefCell::new(Vec::new());
        let known = KnownWorkerFiles {
            splits,
            left_out: &left_out.names,
            of_the_one_program: &of_the_one_program,
        };
        let compiled = match with_worker_files {
            None => compile_written_entry_points(options, known, provider, log),
            Some(_) => compile_program(options, ProgramPlace::Only, known, provider, log),
        };
        let of_the_one_program = of_the_one_program.into_inner();
        let longer = match compiled {
            Ok(compiled) => {
                let added = add_programs_of_worker_files(
                    options,
                    compiled,
                    splits,
                    &mut left_out,
                    provider,
                    log,
                )?;
                match added {
                    Ok(compiled) => {
                        left_out.said.append_to(log);
                        return Ok(compiled);
                    }
                    Err(found) => left_out.add_worker_files(options, &found),
                }
            }
            Err(_) if !of_the_one_program.is_empty() => {
                left_out.add_worker_files(options, &of_the_one_program)
            }
            Err(failure) if with_worker_files.is_none() => return Err(failure),
            Err(failure) => {
                let texts = &options.load.entry_texts;
                let starts_over = failure.brought_bun_types && !failure.is_internal_error;
                if starts_over
                    || !fails_to_load(&failure)
                    || (!left_out.take_texts_with_errors(log, said_before.0, texts, &failure)
                        && !left_out.take_files_named_by_paths(log, said_before.0, &failure))
                {
                    return Err(failure);
                }
                options_without_entry_points(options, &left_out.names)
            }
        };
        log.msgs.truncate(said_before.0);
        (log.warnings, log.errors) = (said_before.1, said_before.2);
        provider.clear_embedded_files();
        remove_program_files_of_further_entry_points(&longer);
        with_worker_files = Some(longer);
    }
}

/// The file, or one that it imports, is no program or is not found. What else is wrong with the code that a Worker starts from stops the build, as it does in any entry point.
fn fails_to_load(failure: &BuildFailed) -> bool {
    let is_found = !matches!(failure.stage, Stage::Load | Stage::BindModules);
    !failure.is_internal_error && (!is_found || failure.has_early_errors)
}

/// The texts and the files named by paths that Workers start from and that are no programs. `bun run` says what is wrong with one where the Worker starts, so the build goes on without it.
#[derive(Default)]
struct TextsLeftOut {
    names: Vec<Vec<u8>>,
    /// What the build says about them when it ends.
    said: Log,
    /// `WorkerFile::source_path` of the files named by paths that are entry points of the one program of the build.
    named_by_paths: Vec<Vec<u8>>,
}

impl TextsLeftOut {
    /// The options of the one program that holds the files too.
    fn add_worker_files<'a>(&mut self, options: &Options<'a>, files: &[WorkerFile]) -> Options<'a> {
        let named = files.iter().filter(|file| file.is_named_by_path);
        self.named_by_paths
            .extend(named.map(|file| file.source_path.clone()));
        options_with_worker_files(options, files)
    }

    /// False: the build has failed for another reason. `first`: where the messages of the failed program begin.
    fn take_texts_with_errors(
        &mut self,
        log: &mut Log,
        first: usize,
        texts: &[EntryText],
        failure: &BuildFailed,
    ) -> bool {
        let file_of = |message: &Msg| message.data.location.as_ref().map(|it| it.file.clone());
        let text_of = |message: &Msg| {
            let file = file_of(message)?;
            texts
                .iter()
                .find(|text| is_path_of_entry_text(&file, &text.name))
        };
        let mut errors = log.msgs[first..].iter().filter(|it| it.kind == Kind::Err);
        if failure.is_internal_error || !errors.clone().all(|it| text_of(it).is_some()) {
            return false;
        }
        let Some(first_error) = errors.next() else {
            return false;
        };
        debug_assert!(text_of(first_error).is_some());
        for mut message in log.msgs.split_off(first) {
            let Some(text) = text_of(&message) else {
                continue;
            };
            if !self.names.contains(&text.name) {
                self.names.push(text.name.clone());
            }
            if let Some(location) = &mut message.data.location {
                location.file = text.name.clone().into();
            }
            self.say_as_warning(message);
        }
        true
    }

    /// Nothing says which of them the errors come from, so the one program of the build is compiled without any. False: it holds none.
    fn take_files_named_by_paths(
        &mut self,
        log: &mut Log,
        first: usize,
        failure: &BuildFailed,
    ) -> bool {
        if failure.is_internal_error || self.named_by_paths.is_empty() {
            return false;
        }
        self.names.append(&mut self.named_by_paths);
        self.take_errors(log, first);
        true
    }

    fn take_errors(&mut self, log: &mut Log, first: usize) {
        for message in log.msgs.split_off(first) {
            if message.kind == Kind::Err {
                self.say_as_warning(message);
            }
        }
    }

    fn say_as_warning(&mut self, mut message: Msg) {
        message.kind = match message.kind {
            Kind::Err => Kind::Warn,
            kind => kind,
        };
        self.said.warnings += u32::from(message.kind == Kind::Warn);
        self.said.add_msg(message);
    }
}

fn options_without_entry_points<'a>(options: &Options<'a>, names: &[Vec<u8>]) -> Options<'a> {
    let kept: Vec<usize> = (0..options.entry_points.len())
        .filter(|&index| !names.contains(&options.entry_points[index]))
        .collect();
    let mut shorter = options_with_entry_points(options, &kept);
    shorter
        .load
        .entry_texts
        .retain(|text| !names.contains(&text.name));
    shorter
}

fn options_with_worker_files<'a>(options: &Options<'a>, files: &[WorkerFile]) -> Options<'a> {
    let all: Vec<usize> = (0..options.entry_points.len()).collect();
    let mut longer = options_with_entry_points(options, &all);
    for file in files {
        let prefix = &options.paths.module_prefix[..];
        let name = file.embedded_path.strip_prefix(prefix);
        longer.entry_points.push(file.source_path.clone());
        let names = &mut longer.paths.entry_point_names;
        names.push(name.unwrap_or(&file.embedded_path).to_vec());
        longer.load.entry_texts.extend(file.entry_text());
    }
    longer
}

// The build has seen the code of such a file, so it is compiled: the file is one more entry point, under the path of its copy. Nothing but a
// Worker begins there, and whoever loads the path as a module gets the text of the copy, so the file begins a program of its own whatever
// names the other programs load. `Err`: one program has to hold these files with all the entry points.
fn add_programs_of_worker_files(
    options: &Options<'_>,
    mut first: Compilation,
    splits: bool,
    left_out: &mut TextsLeftOut,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Result<Compilation, Vec<WorkerFile>>, BuildFailed> {
    let mut files = core::mem::take(&mut first.started_workers.files);
    // A file that was followed to one Worker is not a guess, and it has options if any of its Workers has.
    files.sort_by_key(|file| file.is_guess);
    for index in 0..files.len() {
        let mut same = files
            .iter()
            .filter(|it| it.source_path == files[index].source_path);
        files[index].has_options = same.any(|it| it.has_options);
    }
    let mut pending: VecDeque<WorkerFile> = files.into();
    let mut found: Vec<WorkerFile> = Vec::new();
    let mut texts_not_started: Vec<WorkerFile> = Vec::new();
    let mut are_one_program = !splits;
    while let Some(file) = pending.pop_front() {
        let mut entry_points = first.summary.entry_points.iter();
        let is_known = entry_points.any(|it| it.source_path == file.source_path)
            || found.iter().any(|it| it.source_path == file.source_path);
        // A guess is worth one small program, not a second build of everything else.
        let is_guess = file.is_guess;
        let is_named_by_path = file.is_named_by_path;
        let index = first.summary.entry_points.len();
        // The host loads what `preload` names into the global of the Worker.
        let must_be_one_program =
            are_one_program || (first.started_workers.writes_preload && file.has_options);
        if left_out.names.contains(&file.source_path) {
            texts_not_started.push(file);
            continue;
        }
        if is_known {
            continue;
        }
        if is_guess && must_be_one_program {
            first.started_workers.left_out.push(file);
            continue;
        }
        found.push(file);
        are_one_program = must_be_one_program;
        if are_one_program {
            continue;
        }
        let said_before = log.msgs.len();
        let counted_before = (log.warnings, log.errors);
        let own = options_with_worker_files(options, &found[found.len() - 1..]);
        let own = options_with_entry_points(&own, &[options.entry_points.len()]);
        let of_one_load = ProgramsOfOneLoad {
            indexes: &[index],
            options: core::slice::from_ref(&own),
            are_all_of_the_build: false,
            held_elsewhere: Some(&first.started_workers.held_texts),
            only_looks_for_worker_threads: false,
        };
        let compiled = compile_programs(&own, Some(of_one_load), None, provider, log);
        forget_repeated_messages(log, said_before);
        let program = match compiled {
            // The file was not written for a Worker. It stays a plain embedded file.
            Err(_) if is_guess => {
                log.msgs.truncate(said_before);
                (log.warnings, log.errors) = counted_before;
                first.started_workers.left_out.extend(found.pop());
                continue;
            }
            Err(failure) if failure.is_one_program => None,
            // `compile` starts over without the declarations. Only what is wrong then is wrong with the code.
            Err(failure) if failure.brought_bun_types && !failure.is_internal_error => {
                return Err(failure);
            }
            Err(failure)
                if fails_to_load(&failure)
                    && left_out.take_texts_with_errors(
                        log,
                        said_before,
                        &own.load.entry_texts,
                        &failure,
                    ) =>
            {
                (log.warnings, log.errors) = counted_before;
                texts_not_started.extend(found.pop());
                continue;
            }
            Err(failure) if is_named_by_path && fails_to_load(&failure) => {
                left_out.take_errors(log, said_before);
                (log.warnings, log.errors) = counted_before;
                left_out
                    .names
                    .extend(found.last().map(|file| file.source_path.clone()));
                texts_not_started.extend(found.pop());
                continue;
            }
            Err(failure) => return Err(failure),
            Ok(mut compiled) => compiled.programs.pop().map(|it| it.1),
        };
        // The host loads node:worker_threads into the global of a Worker of that module.
        let mut programs = core::iter::once(&first.engine).chain(&first.further_programs);
        let starts_node_workers = programs.any(|program| names(program, Feature::NodeWorker));
        match program {
            Some(program)
                if !starts_node_workers || names(&program.engine, Feature::WorkerConstructor) =>
            {
                pending.extend(program.started_workers.files.iter().cloned());
                let counted = program.summary.statistics.values();
                first.summary.statistics.add_values(counted);
                add_program(&mut first, program);
            }
            _ if is_guess => first.started_workers.left_out.extend(found.pop()),
            _ => are_one_program = true,
        }
    }
    first.summary.folders.shared_sort_unstable();
    first.summary.folders.dedup();
    found.retain(|file| !(are_one_program && file.is_guess));
    if are_one_program && !found.is_empty() {
        return Ok(Err(found));
    }
    warn_about_worker_files_left_out(&mut first, log);
    texts_not_started.sort_unstable();
    texts_not_started.dedup();
    for text in &texts_not_started {
        first.started_workers.code = CodeOfWorkers::Unseen;
        let place = text.started_at.as_ref();
        log_diagnostic_at(&mut left_out.said, Code::WorkerTextNotCompiled, &[], place);
    }
    Ok(Ok(first))
}

// A Worker that gets the path of such a file fails to load, so the build says where that can happen.
fn warn_about_worker_files_left_out(compiled: &mut Compilation, log: &mut Log) {
    const MAX_FILES_NAMED: usize = 3;
    let mut files = core::mem::take(&mut compiled.started_workers.left_out);
    let entry_points = &compiled.summary.entry_points;
    files.retain(|file| !(entry_points.iter()).any(|it| it.source_path == file.source_path));
    // Without a place: only native code might start such a Worker, and there is nothing to change in the program.
    files.retain(|file| file.started_at.is_some());
    let key = |file: &WorkerFile| (file.started_at.clone(), file.source_path.clone());
    files.sort_by_cached_key(key);
    files.dedup_by_key(|file| key(file));
    for files in files.chunk_by(|a, b| a.started_at == b.started_at) {
        let named = files.iter().take(MAX_FILES_NAMED);
        let mut list = named
            .map(|file| [&b"\""[..], &file.source_path[..], &b"\""[..]].concat())
            .collect::<Vec<_>>()
            .join(&b", "[..]);
        if let Some(more) = files.len().checked_sub(MAX_FILES_NAMED + 1) {
            list.extend_from_slice(format!(" and {} more", more + 1).as_bytes());
        }
        let place = files[0].started_at.as_ref();
        log_diagnostic_at(log, Code::WorkerFileNotCompiled, &[&list[..]], place);
    }
}

fn add_program(first: &mut Compilation, program: Compilation) {
    let summary = program.summary;
    first.further_programs.push(program.engine);
    first.summary.entry_points.extend(summary.entry_points);
    first.summary.folders.extend(summary.folders);
    if let (Some(listed), Some(further)) = (&mut first.summary.modules, summary.modules) {
        add_modules(listed, further);
    }
    first.started_workers.add(program.started_workers);
    first.library_code_lacked.add(&program.library_code_lacked);
    first.reads_main_module_without_its_name |= program.reads_main_module_without_its_name;
    (first.ways_read_out_of_sight).add(program.ways_read_out_of_sight);
    (first.ways_named_that_nobody_reads).add(program.ways_named_that_nobody_reads);
}

fn compile_written_entry_points(
    options: &Options<'_>,
    known: KnownWorkerFiles<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Compilation, BuildFailed> {
    if !begins_program_at_each_entry_point(options) {
        return compile_program(options, ProgramPlace::Only, known, provider, log);
    }
    let said_before = (log.msgs.len(), log.warnings, log.errors);
    if let Some(compiled) = compile_program_at_each_entry_point(options, provider, log) {
        return compiled;
    }
    log.msgs.truncate(said_before.0);
    (log.warnings, log.errors) = (said_before.1, said_before.2);
    remove_program_files_of_further_entry_points(options);
    compile_program(options, ProgramPlace::Only, known, provider, log)
}

fn remove_program_files_of_further_entry_points(options: &Options<'_>) {
    if let Some(path) = options.aot.ir_output_path.as_deref() {
        for index in 1..options.entry_points.len() {
            let _ = bun_sys::unlink(&ZBox::from_bytes(numbered_program_file(path, index)));
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
    let count = options.entry_points.len();
    let mut programs: Vec<Option<Compilation>> = (0..count).map(|_| None).collect();
    // The files of all programs are read, bound and checked once, and each program is what its entry point leads to among them.
    let mut loads: VecDeque<Vec<usize>> = VecDeque::from([(0..count).collect::<Vec<usize>>()]);
    // Of a program that is compiled again, with the code of Bun's own that it was found to lack. The others stay as they are.
    let mut changed_loads: Vec<Option<LoadOptions>> = (0..count).map(|_| None).collect();
    let mut workers_of_programs_compiled_again = StartedWorkers::default();
    while let Some(indexes) = loads.pop_front() {
        let said_before = log.msgs.len();
        let together = options_with_entry_points(options, &indexes);
        let each: Vec<Options<'_>> = (indexes.iter())
            .map(|&index| {
                let mut options = options_with_entry_points(options, &[index]);
                if let Some(load) = &changed_loads[index] {
                    options.load = load.clone();
                }
                options
            })
            .collect();
        let of_one_load = ProgramsOfOneLoad {
            indexes: &indexes,
            options: &each,
            are_all_of_the_build: indexes.len() == count,
            held_elsewhere: None,
            only_looks_for_worker_threads: false,
        };
        let compiled = compile_programs(&together, Some(of_one_load), None, provider, log);
        forget_repeated_messages(log, said_before);
        let compiled = match compiled {
            Err(failure) if failure.is_one_program => return None,
            Err(failure) => return Some(Err(failure)),
            Ok(compiled) => compiled,
        };
        let mut compiled_again = Vec::new();
        for (place, mut program) in compiled.programs {
            match place {
                ProgramPlace::Only => return Some(Ok(program)),
                ProgramPlace::OneOfSeveral(_)
                    if !options.aot.separates_programs
                        && loads_modules_by_name(&program.engine) =>
                {
                    return None;
                }
                ProgramPlace::OneOfSeveral(index) => {
                    let position = indexes.iter().position(|&it| it == index);
                    let own = &each[position.expect("it was handed over")];
                    match find_load_options_with_what_engine_found(own, &program) {
                        Some(load) => {
                            changed_loads[index] = Some(load);
                            compiled_again.push(index);
                            workers_of_programs_compiled_again.add(program.started_workers);
                        }
                        None => {
                            program.library_code_lacked = RuntimeUses::default();
                            program.reads_main_module_without_its_name = false;
                            program.ways_read_out_of_sight = WaysBetweenModuleObjects::default();
                            program.ways_named_that_nobody_reads =
                                WaysBetweenModuleObjects::default();
                            programs[index] = Some(program);
                        }
                    }
                }
            }
        }
        if !compiled_again.is_empty() {
            loads.push_back(compiled_again);
        }
        for left in compiled.left_entry_points {
            // A load of the same entry points would leave the same ones.
            match left.len() < indexes.len() {
                true => loads.push_back(left),
                false => loads.extend(left.into_iter().map(|index| vec![index])),
            }
        }
    }
    let programs: Vec<Compilation> = (programs.into_iter())
        .map(|program| program.expect("an entry point is compiled or left for another load"))
        .collect();
    // The host loads node:worker_threads into the global of a Worker of that module.
    let starts_node_workers = programs
        .iter()
        .any(|program| names(&program.engine, Feature::NodeWorker));
    let lacks_module = |program: &Compilation| !names(&program.engine, Feature::WorkerConstructor);
    if !options.aot.separates_programs
        && starts_node_workers
        && programs[1..].iter().any(lacks_module)
    {
        return None;
    }
    let mut programs = programs.into_iter();
    let mut first = programs.next().expect("it was pushed");
    for program in programs {
        add_program(&mut first, program);
    }
    (first.started_workers).add(workers_of_programs_compiled_again);
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
    known: KnownWorkerFiles<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Compilation, BuildFailed> {
    debug_assert!(place == ProgramPlace::Only);
    let mut compiled = compile_programs(options, None, Some(known), provider, log)?;
    Ok(compiled.programs.pop().expect("a build has a program").1)
}

/// Whether the build loads again behind a run of the engine.
#[derive(Copy, Clone, PartialEq, Eq)]
enum FurtherLoad {
    /// For another program, whatever becomes of this one.
    MayCome,
    /// Only for the program that is compiled in place of this one.
    ComesIfRunEnds,
}

struct CompiledPrograms {
    /// In the order of their entry points.
    programs: Vec<(ProgramPlace, Compilation)>,
    left_entry_points: Vec<Vec<usize>>,
}

// `options` has the entry points of all programs that are loaded together.
fn compile_programs<'a>(
    options: &'a Options<'a>,
    programs: Option<ProgramsOfOneLoad<'a>>,
    known_worker_files: Option<KnownWorkerFiles<'_>>,
    provider: &'a dyn SourceProvider,
    log: &mut Log,
) -> Result<CompiledPrograms, BuildFailed> {
    bun_threading::thread_pool::exit_without_any_thread();
    // A process that `Preload::on_loaded` forks has the calling thread alone.
    let _keeps_free_blocks_below_the_peak =
        KeepsFreeBlocksBelowThePeak::begin(preload_of(options).is_none());
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
    build.programs = programs;
    let body_placement = match options.aot.ir_output_path {
        Some(_) => BodyPlacement::InProgramBytes,
        None => BodyPlacement::External,
    };
    let mut outputs = match build.run_front_end_for_each_program() {
        Ok(outputs) => outputs,
        Err(_) if build.has_left_all_entry_points => Vec::new(),
        Err(stage) => {
            let (is_one_program, brought_bun_types) =
                (build.is_one_program, build.brings_bun_types);
            let mut failure = build.finish::<()>(Err(stage), log).unwrap_err();
            failure.is_one_program = is_one_program;
            failure.brought_bun_types = brought_bun_types;
            return Err(failure);
        }
    };
    outputs.sort_by_key(|(place, _)| match *place {
        ProgramPlace::Only => 0,
        ProgramPlace::OneOfSeveral(index) => index,
    });
    if let (Some(known), [(_, output)]) = (known_worker_files, &outputs[..]) {
        let started = &build.started_workers;
        let worker_files =
            find_files_of_the_one_program(options, known, started, output, provider, log);
        if !worker_files.is_empty() {
            known.of_the_one_program.replace(worker_files);
            return Err(build.finish::<()>(Err(Stage::Any), log).unwrap_err());
        }
    }
    // A further load of a program that holds them all is spared little by what this load has parsed: that goes with the sessions of the load.
    let holds_startup_modules = |output: &FrontEndOutput| {
        let mut modules = table::STARTUP_MODULES.iter();
        modules.all(|&module| output.held_library_code.holds_module(module))
    };
    if (outputs.iter()).all(|(_, output)| holds_startup_modules(output)) {
        let session = SharedByLoads::take().and_then(SharedByLoads::into_session);
        build.retired_sessions.extend(session);
    }
    let mut compiled = Vec::with_capacity(outputs.len());
    let mut library_code_lacked = Vec::with_capacity(outputs.len());
    // Entry points that this load has left, and the files that Workers start from, are loaded by themselves.
    let mut is_loaded_again =
        !build.left_entry_points.is_empty() || !build.started_workers.files.is_empty();
    let mut programs_to_ask = outputs.len();
    for (place, output) in outputs {
        build.place = place;
        let emitted = build
            .emit(output, body_placement)
            .and_then(|(bytes, output)| build.write_program_file(&bytes).map(|()| (bytes, output)));
        let (bytes, mut output) = match emitted {
            Ok(emitted) => emitted,
            Err(stage) => return Err(build.finish::<()>(Err(stage), log).unwrap_err()),
        };
        if options.aot.checks_only {
            engine_options.check_only();
        }
        let own = match (place, programs) {
            (ProgramPlace::OneOfSeveral(index), Some(all)) => {
                let position = all.indexes.iter().position(|&it| it == index);
                position.map_or(options, |position| &all.options[position])
            }
            _ => options,
        };
        let (held, platform) = (&output.held_library_code, build.platform);
        let lacks_main_module = output.lacks_main_module();
        let lets_process_out_of_sight = output.lets_process_out_of_sight;
        let ways_not_followed = output.ways_not_followed_out_of_sight;
        let ways_followed = output.ways_followed_for_their_names;
        // A program that is compiled again, with what the engine has found: nothing is made of it now.
        let goes_on = |found: FlowFindings<'_>| {
            let lacked = find_library_code_lacked(found, held, platform);
            let reads_main_module =
                lacks_main_module && reads_main_module(found, lets_process_out_of_sight);
            let ways = find_ways_read_out_of_sight(found, ways_not_followed);
            let nobody_reads = find_ways_named_that_nobody_reads(found, ways_followed);
            find_load_options_with(own, &lacked, reads_main_module, ways, nobody_reads).is_none()
        };
        programs_to_ask -= 1;
        let whole_runs = WHOLE_ENGINE_RUNS.get();
        let further_load = match is_loaded_again || programs_to_ask > 0 {
            true => FurtherLoad::MayCome,
            false => FurtherLoad::ComesIfRunEnds,
        };
        let engine = build.run_engine(bytes, &engine_options, &output, &goes_on, further_load);
        is_loaded_again |= WHOLE_ENGINE_RUNS.get() == whole_runs;
        let lacked = find_library_code_lacked(engine.flow_findings(), held, platform);
        library_code_lacked.push(lacked);
        if let Some(modules) = &mut output.modules {
            modules.count_code(engine.functions(), &output.names);
        }
        compiled.push((place, engine, output));
    }
    let has_errors = build.diagnostics.has_errors();
    let is_internal_error = build.diagnostics.has_internal_errors();
    let brought_bun_types = build.brings_bun_types;
    let refused_entry_points = build.find_refused_entry_points();
    let left_entry_points = core::mem::take(&mut build.left_entry_points);
    let mut started_workers = core::mem::take(&mut build.started_workers);
    started_workers.held_texts.shared_sort_unstable();
    started_workers.writes_preload = compiled.iter().any(|it| it.2.writes_preload);
    let mut reported: Vec<WorkerFile> = Vec::new();
    for (_, engine, output) in &compiled {
        let mut locator = ModuleLocator::new(&output.texts);
        for record in engine.worker_entries() {
            let path = engine.text(record.path);
            let mut copies = started_workers.copies.iter();
            let Some(copy) = copies.find(|it| it.embedded_path == path) else {
                continue;
            };
            let started_at = position_of(record.witness.location).and_then(|position| {
                Some(ShownPosition {
                    position: locator.position_of(position)?,
                    line_text: locator.source_line(position),
                })
            });
            reported.push(WorkerFile {
                is_guess: record.is_guess != 0,
                has_options: record.has_options != 0,
                started_at,
                ..copy.clone()
            });
        }
    }
    reported.sort_unstable();
    // A file that one program only starts Workers with is no guess.
    let mut certain: Vec<&[u8]> = (started_workers.files.iter())
        .chain(reported.iter().filter(|it| !it.is_guess))
        .map(|it| &it.source_path[..])
        .collect();
    certain.sort_unstable();
    let is_certain = |file: &WorkerFile| certain.binary_search(&&file.source_path[..]).is_ok();
    let mut guessed: Vec<&[u8]> = (reported.iter().filter(|it| !is_certain(it)))
        .map(|it| &it.source_path[..])
        .collect();
    guessed.dedup();
    // Many code files are more likely pages that a server sends than Workers, so none of them is compiled.
    let keeps_guesses = guessed.len() as u64 <= build.limits.get(LimitId::MaxGuessedWorkerFiles);
    let is_kept: Vec<bool> = (reported.iter())
        .map(|it| keeps_guesses || is_certain(it))
        .collect();
    if !keeps_guesses {
        let limit = LimitId::MaxGuessedWorkerFiles;
        build.statistics.gave_up(limit, None);
    }
    for (file, is_kept) in reported.into_iter().zip(is_kept) {
        match is_kept {
            true => started_workers.files.push(file),
            false => started_workers.left_out.push(file),
        }
    }
    let mut started_workers = Some(started_workers);
    build.clock.add_to(&mut build.statistics);
    build.diagnostics.write_to(log);
    let statistics = build.statistics;
    let mut programs: Vec<(ProgramPlace, Compilation)> = compiled
        .into_iter()
        .zip(library_code_lacked)
        .map(|((place, engine, output), library_code_lacked)| {
            let reads_main_module_without_its_name = output.lacks_main_module()
                && reads_main_module(engine.flow_findings(), output.lets_process_out_of_sight);
            let ways_read_out_of_sight = find_ways_read_out_of_sight(
                engine.flow_findings(),
                output.ways_not_followed_out_of_sight,
            );
            let ways_named_that_nobody_reads = find_ways_named_that_nobody_reads(
                engine.flow_findings(),
                output.ways_followed_for_their_names,
            );
            let (_, summary) = output.into_parts(statistics.clone());
            let compilation = Compilation {
                reads_main_module_without_its_name,
                ways_read_out_of_sight,
                ways_named_that_nobody_reads,
                engine,
                summary,
                further_programs: Vec::new(),
                // Of all that was loaded.
                started_workers: started_workers.take().unwrap_or_default(),
                library_code_lacked,
            };
            (place, compilation)
        })
        .collect();
    match has_errors {
        false => Ok(CompiledPrograms {
            programs,
            left_entry_points,
        }),
        true => Err(BuildFailed {
            stage: Stage::Any,
            is_internal_error,
            statistics,
            compilation: programs.pop().map(|(_, compilation)| Box::new(compilation)),
            refused_entry_points,
            is_one_program: false,
            brought_bun_types,
            has_early_errors: false,
        }),
    }
}

// What `add_programs_of_worker_files` answers with `Err`, as far as the front end can tell: the engine then runs once, for the program that holds them all.
fn find_files_of_the_one_program(
    options: &Options<'_>,
    known: KnownWorkerFiles<'_>,
    started: &StartedWorkers,
    output: &FrontEndOutput,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Vec<WorkerFile> {
    let is_entry_point = |file: &WorkerFile| {
        (output.entry_points.iter()).any(|it| it.source_path == file.source_path)
    };
    let mut files: Vec<WorkerFile> = (started.files.iter())
        .filter(|file| !is_entry_point(file) && !known.left_out.contains(&file.source_path))
        .cloned()
        .collect();
    let has_options = files.iter().any(|file| file.has_options);
    files.dedup_by(|a, b| a.source_path == b.source_path);
    let are_one_program = !files.is_empty()
        && (!known.splits
            || (output.writes_preload && has_options)
            || (started.constructs_node_workers
                && lacks_worker_threads_in_a_program(options, &files, provider, log)));
    match are_one_program {
        true => files,
        false => Vec::new(),
    }
}

// The host loads node:worker_threads into the global of a Worker of that module, so the program of such a Worker holds the module. The files are loaded and nothing more.
fn lacks_worker_threads_in_a_program(
    options: &Options<'_>,
    files: &[WorkerFile],
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> bool {
    let said_before = (log.msgs.len(), log.warnings, log.errors);
    let with_files = options_with_worker_files(options, files);
    let indexes: Vec<usize> = (options.entry_points.len()..with_files.entry_points.len()).collect();
    let together = options_with_entry_points(&with_files, &indexes);
    let each: Vec<Options<'_>> = (indexes.iter())
        .map(|&index| options_with_entry_points(&with_files, &[index]))
        .collect();
    let of_one_load = ProgramsOfOneLoad {
        indexes: &indexes,
        options: &each,
        are_all_of_the_build: false,
        held_elsewhere: None,
        only_looks_for_worker_threads: true,
    };
    let loaded = compile_programs(&together, Some(of_one_load), None, provider, log);
    log.msgs.truncate(said_before.0);
    (log.warnings, log.errors) = (said_before.1, said_before.2);
    matches!(loaded, Err(failure) if failure.is_one_program)
}

fn fail(
    stage: Stage,
    diagnostics: Diagnostics,
    statistics: Statistics,
    refused_entry_points: Option<Vec<u32>>,
    log: &mut Log,
) -> BuildFailed {
    let is_internal_error = diagnostics.has_internal_errors();
    let has_early_errors = diagnostics.has_early_errors();
    diagnostics.write_to(log);
    BuildFailed {
        stage,
        is_internal_error,
        has_early_errors,
        statistics,
        compilation: None,
        refused_entry_points,
        is_one_program: false,
        brought_bun_types: false,
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
            unreached_runtime_files: Vec::new(),
            held_library_code: HeldLibraryCode::default(),
            circular_runtime_files: Vec::new(),
            lowered_runtimes: LoweredRuntimes::default(),
            import_graph: None,
            checked_elsewhere: Vec::new(),
            place: ProgramPlace::Only,
            programs: None,
            left_entry_points: Vec::new(),
            has_left_all_entry_points: false,
            is_preloading: false,
            is_one_program: false,
            started_workers: StartedWorkers::default(),
            brings_bun_types: false,
            has_withdrawn_trust: false,
        }
    }

    /// The stages behind the load look at one program at a time. `position`: among those that were loaded together.
    pub(crate) fn begin_program(&mut self, position: usize) {
        let Some(programs) = self.programs else {
            return;
        };
        self.options = &programs.options[position];
        self.place = ProgramPlace::OneOfSeveral(programs.indexes[position]);
        self.unreached_runtime_files.clear();
        self.circular_runtime_files.clear();
        self.checked_elsewhere.clear();
    }

    fn find_refused_entry_points(&self) -> Option<Vec<u32>> {
        let paths = self.diagnostics.paths_of_errors()?;
        self.import_graph
            .as_ref()?
            .find_entry_points_that_reach(paths.into_iter())
    }

    fn run_front_end(&mut self) -> Result<FrontEndOutput, Stage> {
        let mut outputs = self.run_front_end_for_each_program()?;
        Ok(outputs.pop().expect("a build has a program").1)
    }

    fn run_front_end_for_each_program(
        &mut self,
    ) -> Result<Vec<(ProgramPlace, FrontEndOutput)>, Stage> {
        let mut linked_at = None;
        let mut outputs = Vec::new();
        let output = self.load_in_new_sessions(AssetReads::FinishedLater, &mut |build, loaded| {
            let application = loaded.project(ProjectId::Application).loaded.files();
            let starts_workers =
                build.place != ProgramPlace::Only && mentions_worker_constructor(application);
            let bound = build.bind_modules(&loaded)?;
            build.stop_if_errors(Stage::BindModules)?;
            // What the engine finds out about such names comes a whole program later.
            let begins_at_worker_file =
                (build.programs).is_some_and(|programs| programs.held_elsewhere.is_some());
            if build.place != ProgramPlace::Only
                && !begins_at_worker_file
                && !build.options.aot.separates_programs
                && loads_modules_by_computed_names(application, &bound.projects.application.graph)
            {
                build.is_one_program = true;
                return Err(Stage::BindModules);
            }
            let units = build.check_and_lower(&loaded, &bound);
            // No failure: see `compile`. A package keeps the types that it has without them.
            if build.brings_bun_types && build.has_withdrawn_trust {
                return Err(Stage::Check);
            }
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
            // A load that has to be done again begins with the first program again.
            outputs.retain(|(place, _)| *place != build.place);
            outputs.push((build.place, output?));
            Ok(())
        });
        drop_thread_caches(self.caches);
        if let Some(linked_at) = linked_at {
            self.count_time(StatisticId::ReleaseLoadedProjectsNanoseconds, linked_at);
        }
        output.map(|()| outputs)
    }

    fn run_through_emit(
        &mut self,
        body_placement: BodyPlacement,
    ) -> Result<(ProgramBytes, FrontEndOutput), Stage> {
        let output = self.run_front_end()?;
        self.emit(output, body_placement)
    }

    fn emit(
        &mut self,
        mut output: FrontEndOutput,
        body_placement: BodyPlacement,
    ) -> Result<(ProgramBytes, FrontEndOutput), Stage> {
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
        self.leftovers.push(Box::new(program));
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

    fn run_engine(
        &mut self,
        bytes: ProgramBytes,
        engine_options: &EngineOptions,
        output: &FrontEndOutput,
        goes_on: JudgeOfFlowFindings<'_>,
        further_load: FurtherLoad,
    ) -> EngineResult {
        self.clock.stop();
        ENGINE_RUNS.set(ENGINE_RUNS.get() + 1);
        let leftovers = core::mem::take(&mut self.leftovers);
        let started = Instant::now();
        let has_ended_behind_flow_analysis = AtomicBool::new(false);
        // It serves the loads that follow. Where none can, it goes while the engine goes on.
        let mut shared_by_loads = Guarded::new(SharedByLoads::take());
        let ((), engine) = run_beside(
            &self.beside_runner(),
            move || drop(leftovers),
            || {
                engine::compile(bytes, engine_options, &|found| {
                    let goes_on = goes_on(found);
                    has_ended_behind_flow_analysis.store(!goes_on, Ordering::Relaxed);
                    if goes_on && further_load == FurtherLoad::ComesIfRunEnds {
                        drop(shared_by_loads.lock().take());
                    }
                    goes_on
                })
            },
        );
        self.count_time(StatisticId::EngineCallNanoseconds, started);
        if let Some(shared) = shared_by_loads.get_mut().take() {
            SharedByLoads::keep(shared);
        }
        let has_ended_behind_flow_analysis = has_ended_behind_flow_analysis.into_inner();
        WHOLE_ENGINE_RUNS.set(WHOLE_ENGINE_RUNS.get() + u64::from(!has_ended_behind_flow_analysis));

        let returned = Instant::now();
        self.statistics.add_values(engine.statistics());
        self.diagnostics
            .add_engine_records(&engine, &output.names, &output.texts);
        if engine_options.makes_image()
            && !has_ended_behind_flow_analysis
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
